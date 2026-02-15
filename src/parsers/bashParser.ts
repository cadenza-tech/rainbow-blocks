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
        // If region starts after current position (heredoc opener line gap),
        // scan the gap for excluded regions (comments, strings)
        if (result.start > i) {
          let j = i + 1;
          while (j < result.start) {
            // Skip `<<` heredoc operator to avoid re-matching
            if (source[j] === '<' && j + 1 < source.length && source[j + 1] === '<' && (j + 2 >= source.length || source[j + 2] !== '<')) {
              // Skip past the heredoc operator and delimiter
              j += 2;
              continue;
            }
            const gapResult = this.tryMatchExcludedRegion(source, j);
            if (gapResult) {
              regions.push({
                start: gapResult.start,
                end: Math.min(gapResult.end, result.start)
              });
              j = gapResult.end;
            } else {
              j++;
            }
          }
        }
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

    // Process substitution <(...) and >(...)
    if (char === '(' && pos > 0 && (source[pos - 1] === '<' || source[pos - 1] === '>')) {
      // Make sure it's not <<( which would be heredoc-related
      if (source[pos - 1] !== '<' || pos < 2 || source[pos - 2] !== '<') {
        return this.matchProcessSubstitution(source, pos);
      }
    }

    // Arithmetic evaluation (( ... )) - not preceded by $
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '(' && (pos === 0 || source[pos - 1] !== '$')) {
      return this.matchBareArithmeticEvaluation(source, pos);
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

      // Skip escaped characters (handles \{ and \} among others)
      if (char === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }

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

      // Skip nested parameter expansion ${...}
      if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
        const nested = this.matchParameterExpansion(source, i);
        i = nested.end;
        continue;
      }

      // Skip backtick command substitution
      if (char === '`') {
        const region = this.matchBacktickCommand(source, i);
        i = region.end;
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
  // Tracks case/esac nesting so `)` in case patterns doesn't close prematurely
  private matchCommandSubstitution(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    // Check for arithmetic expansion $((...))
    if (source[i] === '(') {
      return this.matchArithmeticExpansion(source, pos);
    }

    let depth = 1;
    let caseDepth = 0;

    while (i < source.length && depth > 0) {
      const char = source[i];

      // Skip double-quoted strings
      if (char === '"') {
        const stringEnd = this.findStringEnd(source, i, '"');
        i = stringEnd;
        continue;
      }

      // Skip $'...' ANSI-C quoting (must check before single quote)
      if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
        const region = this.matchDollarSingleQuote(source, i);
        i = region.end;
        continue;
      }

      // Skip single-quoted strings
      if (char === "'") {
        const stringEnd = this.findSingleQuoteEnd(source, i);
        i = stringEnd;
        continue;
      }

      // Skip comments (# to end of line)
      if (char === '#') {
        while (i < source.length && source[i] !== '\n') {
          i++;
        }
        continue;
      }

      // Skip nested command substitution
      if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
        const nested = this.matchCommandSubstitution(source, i);
        i = nested.end;
        continue;
      }

      // Skip parameter expansion ${...}
      if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
        const nested = this.matchParameterExpansion(source, i);
        i = nested.end;
        continue;
      }

      // Skip backtick command substitution
      if (char === '`') {
        const region = this.matchBacktickCommand(source, i);
        i = region.end;
        continue;
      }

      // Track case/esac nesting to avoid `)` in case patterns closing `$(...)`
      if (this.matchesWord(source, i, 'case')) {
        caseDepth++;
        i += 4;
        continue;
      }
      if (this.matchesWord(source, i, 'esac')) {
        if (caseDepth > 0) caseDepth--;
        i += 4;
        continue;
      }

      if (char === '(') {
        depth++;
      } else if (char === ')') {
        // Inside a case block, `)` that doesn't reduce paren depth below
        // the command substitution boundary is a case pattern terminator
        if (caseDepth > 0 && depth === 1) {
          i++;
          continue;
        }
        depth--;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Checks if source has a whole word match at position
  private matchesWord(source: string, pos: number, word: string): boolean {
    if (pos + word.length > source.length) return false;
    if (source.slice(pos, pos + word.length) !== word) return false;
    if (pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) return false;
    const after = pos + word.length;
    if (after < source.length && /[a-zA-Z0-9_]/.test(source[after])) return false;
    return true;
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

      // Skip parameter expansion ${...}
      if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
        const nested = this.matchParameterExpansion(source, i);
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

  // Matches bare arithmetic evaluation (( ... )) (not preceded by $)
  private matchBareArithmeticEvaluation(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 2;

    while (i < source.length && depth > 0) {
      const char = source[i];

      // Skip strings inside arithmetic evaluation
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

      // Skip parameter expansion ${...}
      if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
        const nested = this.matchParameterExpansion(source, i);
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

  // Matches process substitution <(...) or >(...) with nested parens
  private matchProcessSubstitution(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
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
      if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
        const nested = this.matchCommandSubstitution(source, i);
        i = nested.end;
        continue;
      }

      // Skip parameter expansion ${...}
      if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
        const nested = this.matchParameterExpansion(source, i);
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

    // Include the preceding < or > in the excluded region
    return { start: pos - 1, end: i };
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
    const heredocPattern = /^<<(-)?[\t ]*\\?(['"])?([A-Za-z_][A-Za-z0-9_]*)\2?/;
    const match = source.slice(pos).match(heredocPattern);

    if (!match) return null;

    const stripTabs = match[1] === '-';
    const terminator = match[3];
    let i = pos + match[0].length;

    // Find the end of the current line (\n or \r)
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      i++;
    }

    // If no line ending found, heredoc has no body
    if (i >= source.length) return null;

    // Skip past line ending (\r\n counts as one)
    let contentStart: number;
    if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
      contentStart = i + 2;
    } else {
      contentStart = i + 1;
    }
    i = contentStart;

    // Find the terminator line
    while (i < source.length) {
      const lineStart = i;
      let lineEnd = i;
      while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
        lineEnd++;
      }

      const line = source.slice(lineStart, lineEnd);
      const trimmedLine = stripTabs ? line.replace(/^\t*/, '') : line;

      if (trimmedLine === terminator) {
        // Skip past the line ending after the terminator
        let regionEnd = lineEnd;
        if (regionEnd < source.length) {
          if (source[regionEnd] === '\r' && regionEnd + 1 < source.length && source[regionEnd + 1] === '\n') {
            regionEnd += 2;
          } else {
            regionEnd += 1;
          }
        }
        return {
          start: contentStart,
          end: regionEnd
        };
      }

      // Skip past line ending
      if (lineEnd < source.length) {
        if (source[lineEnd] === '\r' && lineEnd + 1 < source.length && source[lineEnd + 1] === '\n') {
          i = lineEnd + 2;
        } else {
          i = lineEnd + 1;
        }
      } else {
        i = lineEnd;
      }
    }

    return { start: contentStart, end: source.length };
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

  // Check if a keyword is at shell command position (start of a simple command)
  private isAtCommandPosition(source: string, position: number): boolean {
    let i = position - 1;
    // Skip whitespace (spaces, tabs) but not line endings
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }

    // At start of file or after line ending (\n or \r)
    if (i < 0 || source[i] === '\n' || source[i] === '\r') {
      return true;
    }

    // After command separators: ; | & ( { )
    if (';|&({)'.includes(source[i])) {
      return true;
    }

    // After backtick (end of command substitution)
    if (source[i] === '`') {
      return true;
    }

    // After ! (pipeline negation, POSIX)
    if (source[i] === '!') {
      return true;
    }

    // After `}` (end of command group) — allows `} && if ...` or `} || for ...`
    if (source[i] === '}') {
      return true;
    }

    // After shell keywords that introduce a new command context
    const commandStarters = ['then', 'do', 'else', 'elif', 'time'];
    for (const kw of commandStarters) {
      const kwStart = i - kw.length + 1;
      if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
        if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
          return true;
        }
      }
    }

    // After block close keywords followed by control operators (&&, ||)
    const blockCloseKws = ['fi', 'done', 'esac'];
    for (const kw of blockCloseKws) {
      const kwStart = i - kw.length + 1;
      if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
        if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
          return true;
        }
      }
    }

    return false;
  }

  // Check if keyword is followed by ) → case pattern (e.g., for), done))
  // But not inside subshell (...) where ) closes the subshell
  private isCasePattern(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    let j = position + keyword.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
    if (j >= source.length) return false;

    // Handle pipe-separated alternatives: if|then), for|while|until)
    if (source[j] === '|') {
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === ')') break;
        j++;
      }
      if (j >= source.length || source[j] !== ')') {
        return false;
      }
    } else if (source[j] !== ')') {
      return false;
    }

    // Check if inside unmatched parentheses (subshell or POSIX case pattern)
    let parenDepth = 0;
    for (let k = position - 1; k >= 0; k--) {
      if (this.isInExcludedRegion(k, excludedRegions)) continue;
      if (source[k] === ')') parenDepth++;
      else if (source[k] === '(') {
        if (parenDepth === 0) {
          // Check if ( is a POSIX case pattern opening vs subshell
          // Case pattern: (pattern) has no semicolons/newlines between ( and keyword
          // Subshell: (commands; ...) has semicolons/newlines between ( and keyword
          const contentBetween = source.slice(k + 1, position);
          if (contentBetween.includes(';') || contentBetween.includes('\n')) {
            return false;
          }
          const lineStart = source.lastIndexOf('\n', k) + 1;
          const textBefore = source.slice(lineStart, k);
          if (/^\s*$/.test(textBefore) || /;;\s*$|;&\s*$|;;&\s*$/.test(textBefore)) {
            return true;
          }
          return false;
        }
        parenDepth--;
      }
    }

    // Check if keyword is preceded by `(` on the same line (POSIX case pattern)
    // e.g., `(for)` in a case statement
    let k = position - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
      k--;
    }
    if (k >= 0 && source[k] === '(') {
      const lineStart = source.lastIndexOf('\n', k) + 1;
      const textBefore = source.slice(lineStart, k);
      if (/^\s*$/.test(textBefore) || /;;\s*$|;&\s*$|;;&\s*$/.test(textBefore)) {
        return true;
      }
    }

    // Default: check if preceded by case separator (;;, ;&, ;;&) or `in` keyword
    // to distinguish case patterns from keywords followed by stray )
    let s = position - 1;
    while (s >= 0 && (source[s] === ' ' || source[s] === '\t' || source[s] === '\n' || source[s] === '\r')) {
      s--;
    }
    if (s >= 1 && source[s] === ';' && source[s - 1] === ';') {
      return true;
    }
    if (s >= 1 && source[s] === '&') {
      if (source[s - 1] === ';') return true;
      if (s >= 2 && source[s - 1] === ';' && source[s - 2] === ';') return true;
    }
    if (s >= 1 && source[s] === 'n' && source[s - 1] === 'i' && (s < 2 || !/[a-zA-Z0-9_]/.test(source[s - 2]))) {
      return true;
    }
    return false;
  }

  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!this.isAtCommandPosition(source, position)) {
      return false;
    }
    if (this.isCasePattern(source, position, keyword, excludedRegions)) {
      return false;
    }
    return true;
  }

  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!this.isAtCommandPosition(source, position)) {
      return false;
    }
    if (this.isCasePattern(source, position, keyword, excludedRegions)) {
      return false;
    }
    return true;
  }

  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    let tokens = super.tokenize(source, excludedRegions);

    // Validate block_middle keywords at command position (echo then, echo else, etc.)
    tokens = tokens.filter((token) => {
      if (token.type !== 'block_middle') return true;
      if (!this.isAtCommandPosition(source, token.startOffset)) return false;
      if (this.isCasePattern(source, token.startOffset, token.value, excludedRegions)) return false;
      return true;
    });

    const newlinePositions = this.buildNewlinePositions(source);

    // Match { } for command grouping (not brace expansion)
    const bracePattern = /[{}]/g;
    for (const match of source.matchAll(bracePattern)) {
      const i = match.index;
      const char = match[0];

      // Skip if in excluded region (covers ${...}, strings, comments, etc)
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }

      // Skip if part of parameter expansion ${
      if (char === '{' && i > 0 && source[i - 1] === '$') {
        continue;
      }

      // Command grouping '{' must be followed by whitespace
      if (char === '{') {
        const nextChar = source[i + 1];
        if (nextChar !== undefined && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r') {
          continue;
        }
      }

      // Command grouping '}' must be preceded by ';', newline, or block close keyword
      if (char === '}') {
        let j = i - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j >= 0 && source[j] !== ';' && source[j] !== '\n' && source[j] !== '\r' && source[j] !== '&') {
          // Check if preceded by block close keywords (fi, done, esac)
          const blockCloseKeywords = ['fi', 'done', 'esac', '}'];
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
