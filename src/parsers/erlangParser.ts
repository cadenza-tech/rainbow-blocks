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
    // Reject keywords followed by => (map key: #{begin => 1})
    const afterKeyword = source.slice(position + keyword.length);
    if (/^\s*=>/.test(afterKeyword)) {
      return false;
    }

    if (keyword !== 'fun') {
      return true;
    }

    // 'fun' in -spec/-type/-callback/-opaque declarations is a type, not a block
    const lineStart = source.lastIndexOf('\n', position) + 1;
    const lineBefore = source.slice(lineStart, position).trimStart();
    if (/^-\s*(spec|type|callback|opaque)\b/.test(lineBefore)) {
      return false;
    }

    // Check if fun is followed by an identifier and '/' (function reference)
    const afterFun = source.slice(position + 3);
    // fun Module:Function/Arity or fun Function/Arity
    // Module can be a quoted atom: fun 'my.module':func/N
    const atomOrIdent = "(?:[a-zA-Z_][a-zA-Z0-9_]*|'(?:[^'\\\\]|\\\\.)*')";
    const funRefModPattern = new RegExp(`^\\s+${atomOrIdent}\\s*:\\s*${atomOrIdent}\\s*/\\s*\\d`);
    if (funRefModPattern.test(afterFun)) {
      return false;
    }
    if (/^\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\/\s*\d/.test(afterFun)) {
      return false;
    }

    // fun() in type context (inside parentheses of -spec/-type)
    if (/^\s*\(/.test(afterFun)) {
      // Check if in a -spec/-type context by scanning back for attribute
      // Must search for actual attribute pattern, not just '-'
      // (to avoid matching '-' in '->' operator)
      const textBefore = source.slice(0, position);
      const attrPattern = /-\s*(?:spec|type|callback|opaque)\b/g;
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
        let foundPeriod = false;
        for (let j = lastAttr; j < position; j++) {
          if (source[j] === '.' && !this.isInExcludedRegion(j, excludedRegions)) {
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

  // Filter out keywords used as map keys (followed by =>)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      const afterToken = source.slice(token.endOffset);
      if (/^\s*=>/.test(afterToken)) {
        return false;
      }
      return true;
    });
  }

  // Finds excluded regions: comments, strings, atoms
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Character literal: $x (must check before %, ", ' to avoid false matches)
    if (char === '$') {
      return this.matchCharacterLiteral(source, pos);
    }

    // Single-line comment: % to end of line
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Triple-quoted string (OTP 27+)
    if (char === '"' && source.slice(pos, pos + 3) === '"""') {
      return this.matchTripleQuotedString(source, pos);
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
    // $x where x is any character
    return { start: pos, end: pos + 2 };
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
        if (/^\s*$/.test(source.slice(lineStart, i))) {
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
      i++;
    }

    return { start: pos, end: source.length };
  }
}
