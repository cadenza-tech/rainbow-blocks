// Bash block parser: if→fi, case→esac, for/while/until/select→done, {→}, with heredoc and parameter expansion exclusion

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Keywords that are closed by `done`
const DONE_OPENERS = new Set(['for', 'while', 'until', 'select']);

export class BashBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'case', 'for', 'while', 'until', 'select'],
    blockClose: ['fi', 'esac', 'done'],
    blockMiddle: ['then', 'else', 'elif', 'do']
  };

  // Finds excluded regions: comments, strings, heredocs, parameter expansions
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

    // Single-line comment
    if (char === '#' && !this.isParameterExpansion(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    // $'...' ANSI-C quoting (must check before single quote)
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === "'") {
      return this.matchDollarSingleQuote(source, pos);
    }

    // Parameter expansion ${...}
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '{') {
      return this.matchParameterExpansion(source, pos);
    }

    // Command substitution $(...), also handles arithmetic expansion $((...))
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '(') {
      return this.matchCommandSubstitution(source, pos);
    }

    // Arithmetic expansion $[...] (deprecated but still used)
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '[') {
      return this.matchArithmeticBracket(source, pos);
    }

    // Heredoc detection: <<WORD, <<-WORD, <<'WORD', <<"WORD" (not here-string <<<)
    if (char === '<' && pos + 2 < source.length && source[pos + 1] === '<' && source[pos + 2] !== '<' && (pos === 0 || source[pos - 1] !== '<')) {
      const result = this.matchHeredoc(source, pos);
      if (result) return result;
    }

    // Single-quoted string (no escape sequences)
    if (char === "'") {
      return this.matchSingleQuotedString(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Backtick command substitution
    if (char === '`') {
      return this.matchBacktickCommand(source, pos);
    }

    return null;
  }

  // Checks if # at position is part of parameter expansion (${#var})
  private isParameterExpansion(source: string, pos: number): boolean {
    if (pos >= 2 && source[pos - 1] === '{' && source[pos - 2] === '$') {
      return true;
    }
    return false;
  }

  // Matches $'...' ANSI-C quoting
  private matchDollarSingleQuote(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
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

  // Matches parameter expansion ${...} with nested braces
  private matchParameterExpansion(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length && depth > 0) {
      const char = source[i];

      // Skip ANSI-C quoted strings $'...'
      if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
        const region = this.matchDollarSingleQuote(source, i);
        i = region.end;
        continue;
      }

      // Skip double-quoted strings
      if (char === '"') {
        const stringEnd = this.findStringEnd(source, i, '"');
        i = stringEnd;
        continue;
      }

      // Skip single-quoted strings
      if (char === "'") {
        const stringEnd = this.findSingleQuoteEnd(source, i);
        i = stringEnd;
        continue;
      }

      // Skip nested command substitution $(...)
      if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
        const nested = this.matchCommandSubstitution(source, i);
        i = nested.end;
        continue;
      }

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches command substitution $(...) with nested parentheses
  private matchCommandSubstitution(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    // Check for arithmetic expansion $((...))
    if (source[i] === '(') {
      return this.matchArithmeticExpansion(source, pos);
    }

    let depth = 1;

    while (i < source.length && depth > 0) {
      const char = source[i];

      // Skip strings
      if (char === '"') {
        const stringEnd = this.findStringEnd(source, i, '"');
        i = stringEnd;
        continue;
      }
      if (char === "'") {
        const stringEnd = this.findSingleQuoteEnd(source, i);
        i = stringEnd;
        continue;
      }

      // Skip nested command substitution
      if (char === '$' && source[i + 1] === '(') {
        const nested = this.matchCommandSubstitution(source, i);
        i = nested.end;
        continue;
      }

      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches arithmetic expansion $((...)) with string skipping
  private matchArithmeticExpansion(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;
    let depth = 2;

    while (i < source.length && depth > 0) {
      const char = source[i];

      // Skip strings inside arithmetic expansion
      if (char === '"') {
        const stringEnd = this.findStringEnd(source, i, '"');
        i = stringEnd;
        continue;
      }
      if (char === "'") {
        const stringEnd = this.findSingleQuoteEnd(source, i);
        i = stringEnd;
        continue;
      }

      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches arithmetic bracket $[...] (deprecated syntax)
  private matchArithmeticBracket(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length && depth > 0) {
      if (source[i] === '[') {
        depth++;
      } else if (source[i] === ']') {
        depth--;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches single-quoted string (no escape sequences in bash single quotes)
  private matchSingleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches backtick command substitution with limited escape handling
  private matchBacktickCommand(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        // In backticks, only \`, \\, \$, and \newline are escape sequences
        const nextChar = source[i + 1];
        if (nextChar === '`' || nextChar === '\\' || nextChar === '$') {
          i += 2;
          continue;
        }
      }
      if (source[i] === '`') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches heredoc: <<EOF, <<'EOF', <<"EOF", <<-EOF, <<-'EOF', <<-"EOF"
  private matchHeredoc(source: string, pos: number): ExcludedRegion | null {
    const heredocPattern = /^<<(-)?(['"])?([A-Za-z_][A-Za-z0-9_]*)\2?/;
    const match = source.slice(pos).match(heredocPattern);

    if (!match) return null;

    const stripTabs = match[1] === '-';
    const terminator = match[3];
    let i = pos + match[0].length;

    // Find the end of the current line
    while (i < source.length && source[i] !== '\n') {
      i++;
    }
    if (i < source.length) i++;

    // Find the terminator line
    while (i < source.length) {
      const lineStart = i;
      let lineEnd = i;
      while (lineEnd < source.length && source[lineEnd] !== '\n') {
        lineEnd++;
      }

      // Handle CRLF line endings by removing trailing \r
      let line = source.slice(lineStart, lineEnd);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      const trimmedLine = stripTabs ? line.replace(/^\t*/, '') : line;

      if (trimmedLine === terminator) {
        return {
          start: pos,
          end: lineEnd + (lineEnd < source.length ? 1 : 0)
        };
      }

      i = lineEnd + 1;
    }

    return { start: pos, end: source.length };
  }

  // Finds end of double-quoted string with escape sequence handling
  private findStringEnd(source: string, pos: number, quote: string): number {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return i + 1;
      }
      i++;
    }
    return source.length;
  }

  // Finds end of single-quoted string (no escapes)
  private findSingleQuoteEnd(source: string, pos: number): number {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        return i + 1;
      }
      i++;
    }
    return source.length;
  }

  // Tokenizes with additional { } matching for command grouping
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    const newlinePositions = this.buildNewlinePositions(source);

    // Match { } for command grouping (not brace expansion)
    const bracePattern = /[{}]/g;
    for (const match of source.matchAll(bracePattern)) {
      const i = match.index;
      const char = match[0];

      // Skip if in excluded region
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }

      // Skip if part of parameter expansion ${
      if (char === '{' && i > 0 && source[i - 1] === '$') {
        continue;
      }
      // Skip if inside a parameter expansion
      if (char === '}' && this.isInsideParameterExpansion(source, i, excludedRegions)) {
        continue;
      }

      // Command grouping '{' must be followed by whitespace
      if (char === '{') {
        const nextChar = source[i + 1];
        if (nextChar !== undefined && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n') {
          continue;
        }
      }

      // Command grouping '}' must be preceded by ';', newline, or block close keyword
      if (char === '}') {
        let j = i - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j >= 0 && source[j] !== ';' && source[j] !== '\n') {
          // Check if preceded by block close keywords (fi, done, esac)
          const blockCloseKeywords = ['fi', 'done', 'esac'];
          let isAfterBlockClose = false;
          for (const kw of blockCloseKeywords) {
            const start = j - kw.length + 1;
            if (start >= 0 && source.slice(start, j + 1) === kw) {
              // Verify word boundary before keyword
              if (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) {
                isAfterBlockClose = true;
                break;
              }
            }
          }
          if (!isAfterBlockClose) {
            continue;
          }
        }
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      tokens.push({
        type: char === '{' ? 'block_open' : 'block_close',
        value: char,
        startOffset: i,
        endOffset: i + 1,
        line,
        column
      });
    }

    // Sort by position
    return tokens.sort((a, b) => a.startOffset - b.startOffset);
  }

  // Checks if } at position is inside a parameter expansion
  private isInsideParameterExpansion(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 0;
    for (let i = pos - 1; i >= 0; i--) {
      // Skip characters in excluded regions (strings, comments, etc.)
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      if (source[i] === '}') {
        depth++;
      } else if (source[i] === '{' && i > 0 && source[i - 1] === '$') {
        if (depth === 0) {
          return true;
        }
        depth--;
      }
    }
    return false;
  }

  // Matches blocks with Bash-specific pairing: fi→if, esac→case, done→for/while/until/select, }→{
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
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value;
          let matchIndex = -1;

          // Find the matching opener based on the close keyword
          if (closeValue === 'fi') {
            matchIndex = this.findLastOpenerIndex(stack, 'if');
          } else if (closeValue === 'esac') {
            matchIndex = this.findLastOpenerIndex(stack, 'case');
          } else if (closeValue === 'done') {
            matchIndex = this.findLastDoneOpenerIndex(stack);
          } else if (closeValue === '}') {
            matchIndex = this.findLastOpenerIndex(stack, '{');
          }

          if (matchIndex >= 0) {
            const openBlock = stack.splice(matchIndex, 1)[0];
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

  // Finds the index of the last opener with the given value
  private findLastOpenerIndex(stack: OpenBlock[], opener: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value === opener) {
        return i;
      }
    }
    return -1;
  }

  // Finds the index of the last opener that can be closed by `done`
  private findLastDoneOpenerIndex(stack: OpenBlock[]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (DONE_OPENERS.has(stack[i].token.value)) {
        return i;
      }
    }
    return -1;
  }
}
