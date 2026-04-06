// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class MatlabBlockParser extends BaseBlockParser {
  // Validates block close: 'end' inside parentheses or brackets is array indexing, not block close
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject end preceded by dot (struct field access like s.end or s . end)
    if (this.isPrecededByDot(source, position, excludedRegions)) {
      return false;
    }
    // Reject end used as variable name (end = 5)
    if (this.isFollowedBySimpleAssignment(source, position + keyword.length)) {
      return false;
    }
    // Check all close keywords (end, endfunction, endif, etc.) for parenthesis/bracket context
    return !this.isInsideParensOrBrackets(source, position, excludedRegions);
  }

  // Classdef section keywords that can also be used as function calls
  private static readonly CLASSDEF_SECTION_KEYWORDS = new Set(['properties', 'methods', 'events', 'enumeration', 'arguments']);

  // Reject struct field access for block openers (s.if, s.for, s . if, etc)
  // Reject classdef section keywords used as function calls (properties(obj))
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByDot(source, position, excludedRegions)) {
      return false;
    }
    if (MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      if (this.isKeywordUsedAsFunctionCall(source, position, keyword)) {
        return false;
      }
      // Check if keyword is used as a variable (followed by =, but not ==)
      let afterPos = position + keyword.length;
      while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
        afterPos++;
      }
      if (afterPos < source.length && source[afterPos] === '=' && (afterPos + 1 >= source.length || source[afterPos + 1] !== '=')) {
        return false;
      }
      // Reject classdef section keywords inside parentheses or brackets
      if (this.isInsideParensOrBrackets(source, position, excludedRegions)) {
        return false;
      }
      // Classdef section keywords must appear at line start (after whitespace only)
      const lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
      const textBefore = source.slice(lineStart, position);
      if (/\S/.test(textBefore)) {
        return false;
      }
      // Reject if followed by operator, punctuation, or string literal (used as variable, not section keyword)
      // Valid section keywords are followed by newline, EOF, '(' (attribute list), comment (% or #), or line continuation (...)
      let nextPos = position + keyword.length;
      while (nextPos < source.length && (source[nextPos] === ' ' || source[nextPos] === '\t')) {
        nextPos++;
      }
      if (nextPos < source.length) {
        const excludedRegion = this.findExcludedRegionAt(nextPos, excludedRegions);
        if (excludedRegion) {
          // Reject if inside a string literal (starts with ' or ")
          const regionStart = source[excludedRegion.start];
          if (regionStart === "'" || regionStart === '"') {
            return false;
          }
          // Accept if inside a comment (%), line continuation (...), or shell escape (!)
        } else {
          const nextChar = source[nextPos];
          if (nextChar !== '\n' && nextChar !== '\r' && nextChar !== '(' && nextChar !== '%' && !this.isCommentChar(nextChar)) {
            return false;
          }
        }
      }
    }
    // Reject block opener keywords used as variable names (for = 10, if = 5)
    if (!MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      if (this.isFollowedBySimpleAssignment(source, position + keyword.length)) {
        return false;
      }
    }
    // Reject any block opener inside parentheses or brackets
    if (this.isInsideParensOrBrackets(source, position, excludedRegions)) {
      return false;
    }
    return true;
  }

  // Checks if a classdef section keyword is used as a function call
  // Returns true if the keyword is followed by '(' and preceded by
  // assignment, expression operator, or appears inside an expression
  private isKeywordUsedAsFunctionCall(source: string, position: number, keyword: string): boolean {
    // Check if followed by '(' (skip whitespace)
    let afterPos = position + keyword.length;
    while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
      afterPos++;
    }
    if (afterPos >= source.length || source[afterPos] !== '(') {
      return false;
    }

    // Check if preceded by an expression context on the same line
    let beforePos = position - 1;
    while (beforePos >= 0 && (source[beforePos] === ' ' || source[beforePos] === '\t')) {
      beforePos--;
    }
    if (beforePos < 0 || source[beforePos] === '\n' || source[beforePos] === '\r') {
      // At start of line followed by '(' - function call like properties(obj)
      // But classdef section keywords at line start with '(' after are also
      // valid as access modifiers: properties (Access = public)
      // Check if there's a matching ')' then look at what follows
      // A simpler heuristic: if preceded by '=', ',', '(', '[', '{', or ';' it's a call
      return false;
    }

    const prevChar = source[beforePos];
    // If preceded by =, (, [, {, , or ; it's being used in an expression context
    if (prevChar === '=' || prevChar === '(' || prevChar === '[' || prevChar === '{' || prevChar === ',' || prevChar === ';') {
      return true;
    }

    return false;
  }

  // Filter out block_middle keywords that are struct field access (s.else, s . case)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      if (this.isPrecededByDot(source, token.startOffset, excludedRegions)) {
        return false;
      }
      return true;
    });
  }

  // Validates intermediate keywords against their opener type
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
            const middleValue = token.value.toLowerCase();
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            if (middleValue === 'else' || middleValue === 'elseif') {
              if (topOpener !== 'if') break;
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
            }
            stack[stack.length - 1].intermediates.push(token);
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

  // Checks if position is preceded by dot (possibly with whitespace: s . end)
  // Handles ... line continuation: obj. ...\n    end is struct field access
  protected isPrecededByDot(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      // Skip excluded regions backward for line continuations (... and \ in Octave)
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === ' ' || source[i] === '\t') {
        i--;
        continue;
      }
      // Skip newlines that are immediately after an excluded region that is a ... line continuation
      // matchSingleLineComment sets region.end to the newline position, so check if any
      // excluded region ends exactly at this newline position AND starts with '.' (continuation)
      if ((source[i] === '\n' || source[i] === '\r') && excludedRegions) {
        let nlStart = i;
        if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') {
          nlStart = i - 1;
        }
        const regionBeforeNl = this.findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
        const regionBeforeLf = this.findExcludedRegionAt(i > 0 ? i - 1 : 0, excludedRegions);
        if (
          (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) ||
          (regionBeforeLf?.end === i && (source[regionBeforeLf.start] === '.' || source[regionBeforeLf.start] === '\\'))
        ) {
          i = nlStart - 1;
          continue;
        }
        // Note: bare trailing dot without ... is NOT a continuation in MATLAB/Octave
        // obj.\nend means end is on a new line (not preceded by dot for struct access)
      }
      break;
    }
    // Distinguish struct field access dot (obj.end, data1.end) from numeric decimal point (10.)
    if (i >= 0 && source[i] === '.') {
      // Scan backward past digits, hex letters, and hex/binary prefix letters that form numeric literals
      let j = i - 1;
      while (j >= 0 && /[0-9a-fA-FxXbB_]/.test(source[j])) {
        j--;
      }
      // Check for numeric literal patterns: digits only, exponent (1e5), imaginary (1i/5j),
      // hex prefix (0xFF), binary prefix (0b1010)
      if (j < i - 1) {
        const numPart = source.slice(j + 1, i);
        // Pure digits, hex literals (0x...), binary literals (0b...), or digits with suffixes
        if (
          (/^[0-9][0-9a-fA-F_]*$/.test(numPart) || /^0[xX][0-9a-fA-F_]+$/.test(numPart) || /^0[bB][01_]+$/.test(numPart)) &&
          (j < 0 || !(/[a-zA-Z_]/.test(source[j]) || /\p{L}/u.test(source[j])))
        ) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  // Checks if position is inside parentheses, square brackets, or curly braces
  protected isInsideParensOrBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ')') parenDepth++;
      else if (char === '(') {
        if (parenDepth === 0) return true;
        parenDepth--;
      } else if (char === ']') bracketDepth++;
      else if (char === '[') {
        if (bracketDepth === 0) return true;
        bracketDepth--;
      } else if (char === '}') braceDepth++;
      else if (char === '{') {
        if (braceDepth === 0) return true;
        braceDepth--;
      }
    }
    return false;
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'function',
      'if',
      'for',
      'while',
      'switch',
      'try',
      'parfor',
      'spmd',
      'classdef',
      'methods',
      'properties',
      'events',
      'enumeration',
      'arguments'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch']
  };

  // Checks if keyword is followed by = (but not ==) indicating variable assignment
  protected isFollowedBySimpleAssignment(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    return i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=');
  }

  // Checks if a character is a comment prefix (overridden in Octave to include #)
  protected isCommentChar(_char: string): boolean {
    return false;
  }

  // Checks if position is at line start allowing leading whitespace
  protected isAtLineStartWithWhitespace(source: string, pos: number): boolean {
    if (pos === 0) return true;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (only if %{ is alone on the line)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Single-line comment: %
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // String literal: '...' (MATLAB uses '' for escaped single quote)
    if (char === "'") {
      return this.matchMatlabString(source, pos);
    }

    // Double-quoted string (MATLAB R2017a+)
    if (char === '"') {
      return this.matchDoubleQuotedString(source, pos);
    }

    // Line continuation: ... to end of line (treated as comment)
    if (char === '.' && pos + 2 < source.length && source[pos + 1] === '.' && source[pos + 2] === '.') {
      return this.matchSingleLineComment(source, pos);
    }

    // Shell escape command: ! to end of line (only at line start)
    if (char === '!' && this.isAtLineStartWithWhitespace(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if %{ is alone on the line (no trailing non-whitespace content)
  private isBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      if (source[i] !== ' ' && source[i] !== '\t') {
        return false;
      }
      i++;
    }
    return true;
  }

  // Matches block comment: %{ ... %} with nesting support
  protected matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      // Look for nested %{ at the start of a line
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      // Look for %} at the start of a line (allowing leading whitespace, no trailing content)
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
          // Verify no trailing content after %}
          let trailingPos = i + 2;
          let hasTrailingContent = false;
          while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
            if (source[trailingPos] !== ' ' && source[trailingPos] !== '\t') {
              hasTrailingContent = true;
              break;
            }
            trailingPos++;
          }
          if (!hasTrailingContent) {
            depth--;
            if (depth === 0) {
              let lineEnd = i + 2;
              while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
                lineEnd++;
              }
              return { start: pos, end: lineEnd };
            }
            i += 2;
            continue;
          }
        }
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches MATLAB string: '...' with '' as escape
  private matchMatlabString(source: string, pos: number): ExcludedRegion {
    // Check if this is a transpose operator (after identifier, number, ], }, or .)
    if (pos > 0) {
      const prevChar = source[pos - 1];
      // Handle surrogate pairs: low surrogate preceded by high surrogate
      const isSurrogatePairLetter =
        pos >= 2 &&
        prevChar >= '\uDC00' &&
        prevChar <= '\uDFFF' &&
        (() => {
          const cp = source.codePointAt(pos - 2);
          return cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp));
        })();
      if (/[a-zA-Z0-9_)\]}.'"]/.test(prevChar) || /\p{L}/u.test(prevChar) || isSurrogatePairLetter) {
        // After a digit, check if ' starts a string (e.g., [1'text'])
        // If immediately followed by a letter, it's more likely a string
        if (/[0-9]/.test(prevChar)) {
          const nextChar = pos + 1 < source.length ? source[pos + 1] : undefined;
          if (nextChar && /[a-zA-Z_]/.test(nextChar)) {
            // Fall through to string matching
          } else {
            return { start: pos, end: pos + 1 };
          }
        } else if (prevChar === "'") {
          // Quote immediately after another quote: still transpose
          // A'' = two transposes, each ' follows a value (result of prior transpose)
          return { start: pos, end: pos + 1 };
        } else {
          // This is transpose, not string - return minimal region
          return { start: pos, end: pos + 1 };
        }
      }
    }

    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        // Check for escaped quote ''
        if (i + 1 < source.length && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches double-quoted string: "..." with "" as escape (MATLAB does not support backslash escapes)
  private matchDoubleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        // Check for escaped quote ""
        if (i + 1 < source.length && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
