// Erlang block parser: handles single-line comments, strings, atoms, and spec types

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class ErlangBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'if', 'case', 'receive', 'try', 'fun', 'maybe'],
    blockClose: ['end'],
    blockMiddle: ['of', 'after', 'catch', 'else']
  };

  // Validates block open: 'fun' references and spec context are not blocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords followed by => or := (map key/update: #{begin => 1, end := 2})
    // Allow at most one line break to handle multi-line map expressions
    // Also skip trailing comments (% ...) before line break
    const afterKeyword = source.slice(position + keyword.length);
    if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*)?(?:=>|:=)/.test(afterKeyword)) {
      return false;
    }

    if (keyword !== 'fun') {
      return true;
    }

    // 'fun' in -spec/-type/-callback/-opaque declarations is a type, not a block
    // Note: -record is excluded because fun() inside records defines real anonymous functions
    const lineStart = Math.max(source.lastIndexOf('\n', position), source.lastIndexOf('\r', position)) + 1;
    const lineBefore = source.slice(lineStart, position).trimStart();
    if (/^-[ \t]*(spec|type|callback|opaque)\b/.test(lineBefore)) {
      // Check if there is a period (declaration separator) between the attribute and this fun
      // If so, this fun is in a separate declaration, not part of the type
      const attrMatch = lineBefore.match(/^-[ \t]*(spec|type|callback|opaque)\b/);
      const afterAttr = lineStart + lineBefore.indexOf(attrMatch![0]) + attrMatch![0].length;
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
    const atomOrIdent = "(?:[a-zA-Z_][a-zA-Z0-9_]*|'(?:[^'\\\\\\n\\r]|\\\\.)*')";
    const funRefModPattern = new RegExp(`^[ \\t]+${atomOrIdent}[ \\t]*:[ \\t]*${atomOrIdent}[ \\t]*/[ \\t]*\\d`);
    if (funRefModPattern.test(afterFun)) {
      return false;
    }
    if (/^[ \t]+[a-zA-Z_][a-zA-Z0-9_]*[ \t]*\/[ \t]*\d/.test(afterFun)) {
      return false;
    }
    // fun 'quoted-atom'/Arity (function reference without module prefix)
    const quotedFunRef = /^[ \t]+'(?:[^'\\\n\r]|\\.)*'[ \t]*\/[ \t]*\d/;
    if (quotedFunRef.test(afterFun)) {
      return false;
    }

    // fun() in type annotation context (after ::)
    // Handles: handler :: fun((atom()) -> ok) in -record declarations
    if (/^[ \t]*\(/.test(afterFun)) {
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
    }

    // fun() in type context (inside parentheses of -spec/-type)
    if (/^[ \t]*\(/.test(afterFun)) {
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
      // Exempt block_close tokens (end) to support block expressions as map keys
      if (token.type !== 'block_close' && /^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*)?(?:=>|:=)/.test(afterToken)) {
        return false;
      }
      // Reject keywords preceded by '.' (record field access like Rec#state.end)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        return false;
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
      return true;
    });
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

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted atom
    if (char === "'") {
      return this.matchAtom(source, pos);
    }

    return null;
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
  private matchTripleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;
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
