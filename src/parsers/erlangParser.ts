// Erlang block parser: handles single-line comments, strings, atoms, and spec types

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Matches a module attribute followed by '(' at line start: -define(, -module(, -export(, etc.
const MODULE_ATTR_PAREN_PATTERN = /^[ \t]*-[ \t]*[a-zA-Z_][a-zA-Z0-9_]*[ \t]*\($/;

// Matches -record( specifically at line start (record brace bodies contain real expressions)
const RECORD_ATTR_PATTERN = /^[ \t]*-[ \t]*record[ \t]*\($/;

// Keywords that can precede 'catch' as expression prefix (catch is first expression in block body)
const CATCH_EXPR_PRECEDING_KEYWORDS = new Set(['begin', 'case', 'receive', 'if', 'fun', 'maybe', 'when', 'catch']);

// Keywords where catch can be either expression prefix or clause separator depending on context
const CATCH_AMBIGUOUS_KEYWORDS = new Set(['try', 'of', 'after']);

export class ErlangBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'if', 'case', 'receive', 'try', 'fun', 'maybe'],
    blockClose: ['end'],
    blockMiddle: ['of', 'after', 'catch', 'else']
  };

  // Validates block open: 'fun' references and spec context are not blocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords followed by => or := (map key/update: #{begin => 1, end := 2})
    // Allow one line break (possibly with trailing comment) plus zero or more comment-only lines
    // Blank lines without comments do NOT continue the map key detection
    const afterKeyword = source.slice(position + keyword.length);
    if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterKeyword)) {
      return false;
    }

    if (keyword !== 'fun') {
      return true;
    }

    // 'fun' in -spec/-type/-callback/-opaque declarations is a type, not a block
    // Note: -record is excluded because fun() inside records defines real anonymous functions
    const lineStart = Math.max(source.lastIndexOf('\n', position), source.lastIndexOf('\r', position)) + 1;
    const rawLineBefore = source.slice(lineStart, position);
    const trimmedLength = rawLineBefore.length - rawLineBefore.trimStart().length;
    const lineBefore = rawLineBefore.trimStart();
    if (/^-[ \t]*(spec|type|callback|opaque)\b/.test(lineBefore)) {
      // Check if there is a period (declaration separator) between the attribute and this fun
      // If so, this fun is in a separate declaration, not part of the type
      const attrMatch = lineBefore.match(/^-[ \t]*(spec|type|callback|opaque)\b/) as RegExpMatchArray;
      const afterAttr = lineStart + trimmedLength + lineBefore.indexOf(attrMatch[0]) + attrMatch[0].length;
      let foundPeriod = false;
      for (let j = afterAttr; j < position; j++) {
        if (source[j] === '.' && !this.isInExcludedRegion(j, excludedRegions)) {
          if (j + 1 < source.length && source[j + 1] === '.') {
            j++;
            continue;
          }
          if (j > 0 && source[j - 1] === '.') {
            continue;
          }
          if (j > 0 && j + 1 < source.length && /[0-9]/.test(source[j - 1]) && /[0-9]/.test(source[j + 1])) {
            continue;
          }
          foundPeriod = true;
          break;
        }
      }
      if (!foundPeriod) {
        return false;
      }
    }

    // Check if fun is followed by an identifier and '/' (function reference)
    const afterFun = source.slice(position + 3);
    // fun Module:Function/Arity or fun Function/Arity
    // Module can be a quoted atom: fun 'my.module':func/N
    // Module/Function can be a macro: fun ?MODULE:handler/N, fun ?MY_FUNC/N
    const atomOrIdent = "(?:\\??[a-zA-Z_][a-zA-Z0-9_]*|\\??'(?:[^'\\\\\\n\\r]|\\\\.)*')";
    const funRefModPattern = new RegExp(`^\\s+${atomOrIdent}\\s*:\\s*${atomOrIdent}\\s*/\\s*\\d`);
    if (funRefModPattern.test(afterFun)) {
      return false;
    }
    if (/^\s+\??[a-zA-Z_][a-zA-Z0-9_]*\s*\/\s*\d/.test(afterFun)) {
      return false;
    }
    // fun 'quoted-atom'/Arity or fun ?'quoted-atom'/Arity (function reference without module prefix)
    const quotedFunRef = /^\s+\??'(?:[^'\\\n\r]|\\.)*'\s*\/\s*\d/;
    if (quotedFunRef.test(afterFun)) {
      return false;
    }

    // fun() in type annotation context (after ::)
    // Handles: handler :: fun((atom()) -> ok) in -record declarations
    if (/^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)?\(/.test(afterFun)) {
      let j = position - 1;
      while (j >= 0) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j--;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
          j--;
          continue;
        }
        break;
      }
      if (j > 0 && source[j] === ':' && source[j - 1] === ':' && !this.isInExcludedRegion(j - 1, excludedRegions)) {
        return false;
      }
      // Extended scan: look for :: through type expression chars (union |, tuples {}, etc.)
      if (j >= 0 && source[j] !== '=' && source[j] !== ';' && source[j] !== '.') {
        let k = j;
        let depth = 0;
        while (k >= 0) {
          if (this.isInExcludedRegion(k, excludedRegions)) {
            k--;
            continue;
          }
          const ch = source[k];
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            k--;
            continue;
          }
          if (ch === ')' || ch === '}' || ch === ']') {
            depth++;
            k--;
            continue;
          }
          if (ch === '(' || ch === '{' || ch === '[') {
            depth = Math.max(0, depth - 1);
            k--;
            continue;
          }
          if (depth > 0) {
            k--;
            continue;
          }
          if (k > 0 && ch === ':' && source[k - 1] === ':' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            if (!this.hasTopLevelCommaBetween(source, k + 1, position, excludedRegions)) {
              return false;
            }
            break;
          }
          // Skip => (map arrow) and := (map update) inside type expressions
          if (ch === '=' && k + 1 < source.length && source[k + 1] === '>') {
            k--;
            continue;
          }
          if (ch === '=' && k > 0 && source[k - 1] === ':' && (k < 2 || source[k - 2] !== ':')) {
            k -= 2;
            continue;
          }
          // Skip .. (range operator) and decimal points in float literals
          if (ch === '.' && ((k + 1 < source.length && source[k + 1] === '.') || (k > 0 && source[k - 1] === '.'))) {
            k--;
            continue;
          }
          if (ch === '.' && k > 0 && k + 1 < source.length && /[0-9]/.test(source[k - 1]) && /[0-9]/.test(source[k + 1])) {
            k--;
            continue;
          }
          if (ch === '=' || ch === ';' || ch === '.') break;
          k--;
        }
      }
    }

    // fun() in type context (inside parentheses of -spec/-type)
    if (/^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)?\(/.test(afterFun)) {
      // Check if in a -spec/-type context by scanning back for attribute
      // Must search for actual attribute pattern, not just '-'
      // (to avoid matching '-' in '->' operator)
      const textBefore = source.slice(0, position);
      const attrPattern = /-[ \t]*(?:spec|type|callback|opaque)\b/g;
      let lastAttr = -1;
      for (const match of textBefore.matchAll(attrPattern)) {
        // Skip matches inside excluded regions (strings, comments)
        if (this.isInExcludedRegion(match.index, excludedRegions)) {
          continue;
        }
        // Verify the '-' is at the start of a line (module attributes must be at line start)
        const dashPos = match.index;
        let atLineStart = dashPos === 0;
        if (!atLineStart) {
          let k = dashPos - 1;
          while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
            k--;
          }
          atLineStart = k < 0 || source[k] === '\n' || source[k] === '\r';
        }
        if (!atLineStart) {
          continue;
        }
        lastAttr = match.index;
      }
      if (lastAttr >= 0) {
        // Only reject if no period between the attribute and this fun
        // (period separates Erlang declarations)
        // Verify the period is not inside an excluded region
        // Skip periods in float literals (digit.digit) and range operators (..)
        let foundPeriod = false;
        for (let j = lastAttr; j < position; j++) {
          if (source[j] === '.' && !this.isInExcludedRegion(j, excludedRegions)) {
            // Skip range operator (..)
            if (j + 1 < source.length && source[j + 1] === '.') {
              j++;
              continue;
            }
            if (j > 0 && source[j - 1] === '.') {
              continue;
            }
            // Skip float literals (digit.digit)
            if (j > 0 && j + 1 < source.length && /[0-9]/.test(source[j - 1]) && /[0-9]/.test(source[j + 1])) {
              continue;
            }
            foundPeriod = true;
            break;
          }
        }
        if (!foundPeriod) {
          return false;
        }
      }
    }

    return true;
  }

  // Filter out keywords used as map keys (followed by =>),
  // record field access (preceded by .), and preprocessor directives (preceded by -)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      const afterToken = source.slice(token.endOffset);
      // Allow at most one line break to handle multi-line map expressions
      // Also skip trailing comments (% ...) before line break
      // Filter keywords used as map keys (followed by => or :=)
      // For block_close (end), only filter when it's a bare map key (directly after #{)
      if (token.type === 'block_close') {
        if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterToken)) {
          // Check if 'end' is a map key (preceded by #{ or by comma/whitespace inside a map)
          // Skip whitespace, newlines, and excluded regions (comments) backward
          let k = token.startOffset - 1;
          while (k >= 0) {
            if (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r') {
              k--;
              continue;
            }
            const region = this.findExcludedRegionAt(k, excludedRegions);
            if (region) {
              k = region.start - 1;
              continue;
            }
            break;
          }
          if (k >= 0 && source[k] === '{' && k > 0 && source[k - 1] === '#') {
            return false;
          }
          // Also filter 'end' preceded by comma (non-first map key)
          if (k >= 0 && source[k] === ',') {
            return false;
          }
        }
      } else if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterToken)) {
        return false;
      }
      // Reject keywords preceded by '.' (record field access like Rec#state.end)
      // But allow '..' range operator (Erlang/OTP 26+)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        if (token.startOffset < 2 || source[token.startOffset - 2] !== '.') {
          return false;
        }
      }
      // Reject keywords preceded by '?' (macro invocations like ?begin, ?end)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '?') {
        return false;
      }
      // Reject keywords preceded by '#' (record names like #begin, #end)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '#') {
        return false;
      }
      // Reject keywords preceded by '-' at line start (preprocessor directives like -if, -else)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '-') {
        let j = token.startOffset - 2;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j < 0 || source[j] === '\n' || source[j] === '\r') {
          return false;
        }
      }
      // Reject keywords inside module attribute arguments: -define(...), -module(...), etc.
      if (this.isInsideModuleAttributeArgs(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Reject 'catch' expression prefix (preceded by =, (, [, {, ,, !, operator)
      if (token.value === 'catch' && token.type === 'block_middle') {
        if (this.isCatchExpressionPrefix(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      return true;
    });
  }

  // Checks if 'catch' at position is an expression prefix (e.g., X = catch throw(hello))
  // rather than a try-catch clause separator
  private isCatchExpressionPrefix(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = position - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    while (j >= 0) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        // Comments are transparent: skip and continue scanning backward
        // String/atom/char literals are expression values: catch after them is a clause separator
        if (source[region.start] !== '%') {
          return false;
        }
        j = region.start - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
          j--;
        }
        continue;
      }
      break;
    }
    if (j < 0) return false;
    const ch = source[j];
    // Preceded by operator, assignment, or opening bracket → expression prefix
    if (
      ch === '=' ||
      ch === '(' ||
      ch === '[' ||
      ch === '{' ||
      ch === '!' ||
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '<' ||
      ch === '|'
    ) {
      return true;
    }
    // Closing bracket/paren: end of sub-expression.
    // Use forward heuristic to distinguish expression-prefix from clause separator
    if (ch === ')' || ch === ']' || ch === '}') {
      return !this.isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
    }
    // Comma: could be end of sequence before catch expression,
    // or end of last expression before catch clause separator.
    // If catch is followed by a clause pattern (->), it's a clause separator
    if (ch === ',') {
      return !this.isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
    }
    // > as comparison operator → expression prefix
    // -> (clause arrow): catch in a clause body is expression prefix,
    // but catch starting a try-catch section is a clause separator
    if (ch === '>') {
      if (j > 0 && source[j - 1] === '-') {
        return !this.isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
      }
      // >> (binary close): catch after binary expression is likely a clause separator
      if (j > 0 && source[j - 1] === '>') {
        return !this.isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
      }
      return true;
    }
    // Preceded by a block-opening or intermediate keyword → expression prefix
    if (/[a-z]/i.test(ch)) {
      const wordEnd = j + 1;
      let wordStart = j;
      while (wordStart > 0 && /[a-z_]/i.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.slice(wordStart, wordEnd);
      if (CATCH_EXPR_PRECEDING_KEYWORDS.has(word)) {
        return true;
      }
      // For try/of/after, check forward: if catch is followed by a clause pattern (->),
      // it's a clause separator, not an expression prefix
      if (CATCH_AMBIGUOUS_KEYWORDS.has(word)) {
        return !this.isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
      }
    }
    return false;
  }

  // Checks if there's a comma at bracket depth 0 between two positions (forward scan)
  private hasTopLevelCommaBetween(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 0;
    for (let i = start; i < end; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === '(' || ch === '{' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth = Math.max(0, depth - 1);
      } else if (ch === ',' && depth === 0) {
        return true;
      }
    }
    return false;
  }

  // Checks if there's a -> (clause arrow) after catch before the next catch/after/end/;.
  // Tracks block nesting depth so -> inside nested blocks (e.g. fun(X) -> X end) is ignored
  private isCatchFollowedByClausePattern(source: string, afterCatch: number, excludedRegions: ExcludedRegion[]): boolean {
    let k = afterCatch;
    let depth = 0;
    while (k < source.length) {
      if (this.isInExcludedRegion(k, excludedRegions)) {
        k++;
        continue;
      }
      const ch = source[k];
      // Only match -> at top level (not inside nested blocks)
      if (depth === 0 && ch === '-' && k + 1 < source.length && source[k + 1] === '>') {
        return true;
      }
      // Hit a structural boundary at top level without finding -> it's an expression prefix
      if (depth === 0 && (ch === ';' || ch === '.')) return false;
      // Check for structural keywords
      if (/[a-z]/i.test(ch)) {
        let wEnd = k + 1;
        while (wEnd < source.length && /[a-z_]/i.test(source[wEnd])) wEnd++;
        const w = source.slice(k, wEnd);
        if (depth === 0 && (w === 'catch' || w === 'after' || w === 'end')) return false;
        // Track block nesting: openers increase depth, end decreases depth
        if (w === 'if' || w === 'case' || w === 'receive' || w === 'try' || w === 'begin' || w === 'fun' || w === 'maybe') {
          depth++;
        } else if (w === 'end' && depth > 0) {
          depth--;
        }
        k = wEnd;
        continue;
      }
      k++;
    }
    return false;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Character literal: $x (must check before %, ", ' to avoid false matches)
    if (char === '$') {
      return this.matchCharacterLiteral(source, pos);
    }

    // Single-line comment: % to end of line
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Triple-quoted string (OTP 27+): """ must be followed by a newline
    if (char === '"' && source.slice(pos, pos + 3) === '"""') {
      // Check if next non-horizontal-whitespace char on the same line is newline or EOF
      let k = pos + 3;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
        return this.matchTripleQuotedString(source, pos);
      }
      // Not a valid triple-quoted string: treat as "" (empty string) + " (regular string start)
      // Return the empty string "" as excluded region; the " will be matched on the next iteration
      return { start: pos, end: pos + 2 };
    }

    // OTP 27+ tilde-sigil: ~"...", ~'...' (verbatim, no backslash escapes)
    // Also handles triple-quoted sigils: ~""", ~'''
    if (char === '~' && pos + 1 < source.length) {
      let offset = pos + 1;
      // Skip optional sigil modifier letter (e.g., ~S, ~B)
      if (/[a-zA-Z]/.test(source[offset]) && offset + 1 < source.length) {
        offset++;
      }
      if (source[offset] === '"') {
        // Check for triple-quoted sigil string: ~""" or ~s"""
        if (source.slice(offset, offset + 3) === '"""') {
          let k = offset + 3;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
            k++;
          }
          if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
            return this.matchTripleQuotedString(source, pos, offset);
          }
        }
        return this.matchVerbatimString(source, pos, offset, '"');
      }
      if (source[offset] === "'") {
        // Check for triple-quoted sigil atom: ~''' or ~s'''
        if (source.slice(offset, offset + 3) === "'''") {
          let k = offset + 3;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
            k++;
          }
          if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
            return this.matchTripleQuotedAtom(source, pos, offset);
          }
        }
        return this.matchVerbatimString(source, pos, offset, "'");
      }
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Triple-quoted atom (OTP 27+): ''' must be followed by a newline
    if (char === "'" && source.slice(pos, pos + 3) === "'''") {
      let k = pos + 3;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
        return this.matchTripleQuotedAtom(source, pos);
      }
      // Not a valid triple-quoted atom: treat as '' (empty atom) + ' (regular atom start)
      return { start: pos, end: pos + 2 };
    }

    // Single-quoted atom
    if (char === "'") {
      return this.matchAtom(source, pos);
    }

    return null;
  }

  // Matches OTP 27+ verbatim string/atom (no backslash escapes)
  // Unterminated at newline extends to source.length to prevent phantom string/atom from orphaned quote
  private matchVerbatimString(source: string, regionStart: number, quoteStart: number, quoteChar: string): ExcludedRegion {
    let i = quoteStart + 1;
    while (i < source.length) {
      if (source[i] === quoteChar) {
        return { start: regionStart, end: i + 1 };
      }
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: regionStart, end: source.length };
      }
      i++;
    }
    return { start: regionStart, end: source.length };
  }

  // Matches Erlang character literal: $x, $\n, $\\, etc
  private matchCharacterLiteral(source: string, pos: number): ExcludedRegion | null {
    if (pos + 1 >= source.length) {
      return null;
    }
    // $\ followed by escape character
    if (source[pos + 1] === '\\' && pos + 2 < source.length) {
      const escChar = source[pos + 2];

      // $\x{HH...} - hex with braces
      if (escChar === 'x' && pos + 3 < source.length && source[pos + 3] === '{') {
        let i = pos + 4;
        while (i < source.length && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        // Skip closing brace if present
        if (i < source.length && source[i] === '}') {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\xHH - hex without braces (up to 2 hex digits)
      if (escChar === 'x') {
        let i = pos + 3;
        const limit = Math.min(i + 2, source.length);
        while (i < limit && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\OOO - octal (up to 3 octal digits)
      if (escChar >= '0' && escChar <= '7') {
        let i = pos + 3;
        const limit = Math.min(i + 2, source.length);
        while (i < limit && source[i] >= '0' && source[i] <= '7') {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\^X - control character (4 chars total)
      if (escChar === '^' && pos + 3 < source.length) {
        return { start: pos, end: pos + 4 };
      }

      // $\n, $\t, $\\, etc - basic escape (3 chars)
      return { start: pos, end: pos + 3 };
    }
    // $x where x is any character (handle surrogate pairs for characters outside BMP)
    const code = source.codePointAt(pos + 1);
    const charLen = code !== undefined && code > 0xffff ? 2 : 1;
    return { start: pos, end: pos + 1 + charLen };
  }

  // Matches triple-quoted string (OTP 27+): """..."""
  // No escape processing; closing """ must be at start of line
  // quoteStart: position of the first " (defaults to pos for bare """, differs for ~""" or ~S""")
  private matchTripleQuotedString(source: string, pos: number, quoteStart = pos): ExcludedRegion {
    let i = quoteStart + 3;
    while (i < source.length) {
      if (source[i] === '"' && source.slice(i, i + 3) === '"""') {
        // Closing """ must be preceded only by whitespace on its line
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (/^[ \t]*$/.test(source.slice(lineStart, i))) {
          return { start: pos, end: i + 3 };
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches triple-quoted atom (OTP 27+): '''...'''
  // No escape processing; closing ''' must be at start of line
  // quoteStart: position of the first ' (defaults to pos for bare ''', differs for ~''' or ~S''')
  private matchTripleQuotedAtom(source: string, pos: number, quoteStart = pos): ExcludedRegion {
    let i = quoteStart + 3;
    while (i < source.length) {
      if (source[i] === "'" && source.slice(i, i + 3) === "'''") {
        // Closing ''' must be preceded only by whitespace on its line
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (/^[ \t]*$/.test(source.slice(lineStart, i))) {
          return { start: pos, end: i + 3 };
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Custom block matching: restricts intermediates to their valid block types
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topOpener = stack[stack.length - 1].token.value;
            // 'catch' is only a valid intermediate for 'try' blocks
            if (token.value === 'catch') {
              if (topOpener === 'try') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (token.value === 'of') {
              // 'of' is only valid for 'case' and 'try' blocks
              if (topOpener === 'case' || topOpener === 'try') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (token.value === 'after') {
              // 'after' is only valid for 'receive' and 'try' blocks
              if (topOpener === 'receive' || topOpener === 'try') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (token.value === 'else') {
              // 'else' is only valid for 'if', 'try', and 'maybe' blocks
              if (topOpener === 'if' || topOpener === 'try' || topOpener === 'maybe') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const openBlock = stack.pop();
          if (openBlock) {
            pairs.push({
              openKeyword: openBlock.token,
              closeKeyword: token,
              intermediates: openBlock.intermediates,
              nestLevel: stack.length
            });
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Checks if a position is inside parenthesized arguments of a module attribute
  // e.g. -define(begin, start), -module(begin), -export([end/0]), -ifdef(begin)
  // For -record, stops at unmatched '{' because record bodies contain real expressions (fun() -> ok end)
  // For -define and other attributes, tuple bodies inside braces still filter keywords
  private isInsideModuleAttributeArgs(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let braceDepth = 0;
    let insideUnmatchedBrace = false;
    for (let i = pos - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const ch = source[i];
      if (ch === ')' || ch === ']') {
        parenDepth++;
      } else if (ch === '(' || ch === '[') {
        if (parenDepth > 0) {
          parenDepth--;
        } else if (ch === '(') {
          if (!MODULE_ATTR_PAREN_PATTERN.test(this.getTextFromLineStart(source, i))) {
            // This '(' belongs to a nested function call (e.g. nested( in -define(MACRO, nested(begin))).
            // Continue scanning backward to find the enclosing module attribute '('.
            continue;
          }
          // For -record, unmatched braces contain real expressions
          if (insideUnmatchedBrace && RECORD_ATTR_PATTERN.test(this.getTextFromLineStart(source, i))) {
            return false;
          }
          return true;
        }
      } else if (ch === '}') {
        braceDepth++;
      } else if (ch === '{') {
        if (braceDepth > 0) {
          braceDepth--;
        } else {
          // Unmatched '{' at depth 0: check if this is a record (#name{...}) or map (#{...}) literal
          // Both record and map brace bodies contain real expressions that should not be filtered
          let j = i - 1;
          while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) j--;
          if (j >= 0 && source[j] === '#') {
            return false;
          }
          // Non-record/map brace (tuple in -define): continue scanning
          insideUnmatchedBrace = true;
        }
      }
    }
    return false;
  }

  private getTextFromLineStart(source: string, pos: number): string {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    return source.slice(lineStart, pos + 1);
  }

  // Matches single-quoted atom with escape handling
  // Handles \xNN, \x{...}, and \OOO (octal) escape sequences
  private matchAtom(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        const escChar = source[i + 1];

        // \x{HH...} - hex with braces
        if (escChar === 'x' && i + 2 < source.length && source[i + 2] === '{') {
          let j = i + 3;
          while (j < source.length && /[0-9a-fA-F]/.test(source[j])) {
            j++;
          }
          if (j < source.length && source[j] === '}') {
            j++;
          }
          i = j;
          continue;
        }

        // \xHH - hex without braces (up to 2 hex digits)
        if (escChar === 'x') {
          let j = i + 2;
          const limit = Math.min(j + 2, source.length);
          while (j < limit && /[0-9a-fA-F]/.test(source[j])) {
            j++;
          }
          i = j;
          continue;
        }

        // \OOO - octal (up to 3 octal digits)
        if (escChar >= '0' && escChar <= '7') {
          let j = i + 2;
          const limit = Math.min(j + 2, source.length);
          while (j < limit && source[j] >= '0' && source[j] <= '7') {
            j++;
          }
          i = j;
          continue;
        }

        // \^X - control character
        if (escChar === '^' && i + 2 < source.length) {
          i += 3;
          continue;
        }

        // Atoms cannot span lines - backslash before newline terminates
        if (escChar === '\n' || escChar === '\r') {
          return { start: pos, end: i };
        }
        // Basic escape: \n, \t, \\, \', etc
        i += 2;
        continue;
      }
      if (source[i] === "'") {
        return { start: pos, end: i + 1 };
      }
      // Atoms cannot span multiple lines - unterminated atom ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
