// Ruby block parser: handles heredocs, percent literals, regex, symbols, and postfix conditionals

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Valid Ruby regex flags
const REGEX_FLAGS_PATTERN = /[imxo]/;

// Paired bracket delimiters for percent literals
const PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrsx]/;

// Characters that indicate the preceding / is division, not regex
const DIVISION_PRECEDERS_PATTERN = /[a-zA-Z0-9_?!)\]}"'`]/;

// Keywords after which / starts a regex, not division
const REGEX_PRECEDING_KEYWORDS = new Set([
  'if',
  'unless',
  'while',
  'until',
  'when',
  'case',
  'and',
  'or',
  'not',
  'return',
  'yield',
  'puts',
  'print',
  'raise',
  'in',
  'then',
  'else',
  'elsif',
  'do',
  'begin',
  'rescue',
  'ensure'
]);

export class RubyBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['do', 'if', 'unless', 'while', 'until', 'begin', 'def', 'class', 'module', 'case', 'for'],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in', 'then']
  };

  // Validates block open keywords, excluding postfix conditionals
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj.begin)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // Check if 'do' is a loop separator (while/until/for ... do)
    if (keyword === 'do') {
      return !this.isLoopDo(source, position, excludedRegions);
    }

    // Only if, unless, while, until can be postfix conditionals
    if (!['if', 'unless', 'while', 'until'].includes(keyword)) {
      return true;
    }

    return !this.isPostfixConditional(source, position, excludedRegions);
  }

  // Filters out keywords used as hash keys, rescue modifiers, and method calls
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    return tokens.filter((token) => {
      // Filter out dot-preceded tokens (method calls like obj.end, obj.class)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        return false;
      }
      // Filter out tokens immediately followed by colon (hash key syntax)
      if (source[token.endOffset] === ':') {
        return false;
      }
      // Filter out keywords followed by ?, !, or = (method names like end?, begin!, do=)
      const afterChar = source[token.endOffset];
      if (afterChar === '?' || afterChar === '!' || afterChar === '=') {
        return false;
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !this.isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      return true;
    });
  }

  // Checks if 'rescue' is used as a postfix modifier (e.g., risky rescue nil)
  private isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    let before = source.slice(lineStart, position);
    let lastSemicolon = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i] === ';' && !this.isInExcludedRegion(lineStart + i, excludedRegions)) {
        lastSemicolon = i;
        break;
      }
    }
    if (lastSemicolon >= 0) {
      before = before.slice(lastSemicolon + 1);
    }
    before = before.trim();
    if (before.length === 0) return false;
    const blockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in'];
    for (const kw of blockKeywords) {
      if (before === kw || before.endsWith(` ${kw}`) || before.endsWith(`\t${kw}`)) {
        return false;
      }
    }
    return true;
  }

  // Checks if a conditional is postfix (e.g., "return value if condition")
  private isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find line start
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }

    // Get content before keyword on this line
    let beforeKeyword = source.slice(lineStart, position);

    // Find last semicolon not in excluded region
    let lastValidSemicolon = -1;
    for (let i = beforeKeyword.length - 1; i >= 0; i--) {
      if (beforeKeyword[i] === ';') {
        const absolutePos = lineStart + i;
        if (!this.isInExcludedRegion(absolutePos, excludedRegions)) {
          lastValidSemicolon = i;
          break;
        }
      }
    }

    if (lastValidSemicolon >= 0) {
      beforeKeyword = beforeKeyword.slice(lastValidSemicolon + 1);
    }

    beforeKeyword = beforeKeyword.trim();

    // No content before keyword means not postfix
    if (beforeKeyword.length === 0) {
      return false;
    }

    // Block keyword before means not postfix
    const precedingBlockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in', 'not', 'and', 'or'];

    for (const kw of precedingBlockKeywords) {
      if (beforeKeyword === kw || beforeKeyword.endsWith(` ${kw}`) || beforeKeyword.endsWith(`\t${kw}`)) {
        return false;
      }
    }

    // ! and ? after identifier are method name suffixes (save!, valid?),
    // not operators - the keyword IS postfix in this case
    if (/[a-zA-Z0-9_][!?]$/.test(beforeKeyword)) {
      return true;
    }

    // Operator expecting expression means not postfix
    // Includes: assignment, logical, comparison, arithmetic, range, and other operators
    if (/[=&|,([{:?+\-*/%<>^~!.]$/.test(beforeKeyword)) {
      return false;
    }

    // Non-keyword content before means postfix
    return true;
  }

  // Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
  private isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find line start
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }

    // Get content before 'do' on this line
    let beforeDo = source.slice(lineStart, position);

    // Find last semicolon not in excluded region
    let lastValidSemicolon = -1;
    for (let i = beforeDo.length - 1; i >= 0; i--) {
      if (beforeDo[i] === ';') {
        const absolutePos = lineStart + i;
        if (!this.isInExcludedRegion(absolutePos, excludedRegions)) {
          lastValidSemicolon = i;
          break;
        }
      }
    }

    const searchStart = lastValidSemicolon >= 0 ? lineStart + lastValidSemicolon + 1 : lineStart;
    beforeDo = source.slice(searchStart, position);

    // Find loop keywords (while, until, for) before this 'do'
    const loopPattern = /\b(while|until|for)\b/g;
    const loopMatches = [...beforeDo.matchAll(loopPattern)];

    for (const loopMatch of loopMatches) {
      const loopAbsolutePos = searchStart + loopMatch.index;
      if (this.isInExcludedRegion(loopAbsolutePos, excludedRegions)) {
        continue;
      }

      // Find the first 'do' after this loop keyword, skipping excluded regions
      const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
      const searchRange = source.slice(afterLoopStart, position + 2);
      const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

      for (const doMatch of doMatches) {
        const doAbsolutePos = afterLoopStart + doMatch.index;
        // Skip 'do' in excluded regions (strings, comments)
        if (this.isInExcludedRegion(doAbsolutePos, excludedRegions)) {
          continue;
        }
        // This is the first valid 'do' after the loop keyword
        if (doAbsolutePos === position) {
          return true;
        }
        // Found a different valid 'do' before our position
        break;
      }
    }

    return false;
  }

  // Finds excluded regions: comments, strings, regex, heredocs, percent literals, symbols
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
            // Skip '<' to avoid re-matching heredoc
            if (source[j] === '<') {
              j++;
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

    // __END__ marker: everything after is data
    if (char === '_' && this.isAtLineStart(source, pos)) {
      if (source.slice(pos, pos + 7) === '__END__') {
        const afterEnd = source[pos + 7];
        if (afterEnd === undefined || afterEnd === '\n' || afterEnd === '\r' || afterEnd === ' ' || afterEnd === '\t') {
          return { start: pos, end: source.length };
        }
      }
    }

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: =begin ... =end
    if (char === '=' && this.isAtLineStart(source, pos)) {
      const region = this.matchMultiLineComment(source, pos);
      if (region) return region;
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return this.matchInterpolatedString(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchQuotedString(source, pos, "'");
    }

    // Regex literal
    if (char === '/' && this.isRegexStart(source, pos)) {
      return this.matchRegexLiteral(source, pos);
    }

    // Heredoc
    if (char === '<' && pos + 1 < source.length && source[pos + 1] === '<') {
      const result = this.matchHeredoc(source, pos);
      if (result) return { start: result.contentStart, end: result.end };
    }

    // Percent literals (skip modulo operator: number/identifier % delimiter)
    if (char === '%' && pos + 1 < source.length && !this.isModuloOperator(source, pos)) {
      const result = this.matchPercentLiteral(source, pos);
      if (result) return { start: pos, end: result.end };
    }

    // Symbol literal
    if (char === ':' && this.isSymbolStart(source, pos)) {
      return this.matchSymbolLiteral(source, pos);
    }

    // Backtick string (command) with #{} interpolation support
    if (char === '`') {
      return this.matchBacktickString(source, pos);
    }

    return null;
  }

  // Matches multi-line comment: =begin ... =end
  // Both =begin and =end must be at line start and followed by whitespace/newline/EOF
  private matchMultiLineComment(source: string, pos: number): ExcludedRegion | null {
    if (source.slice(pos, pos + 6) !== '=begin') {
      return null;
    }

    // =begin must be followed by whitespace, newline, or EOF
    const afterBegin = source[pos + 6];
    if (afterBegin !== undefined && afterBegin !== ' ' && afterBegin !== '\t' && afterBegin !== '\n' && afterBegin !== '\r') {
      return null;
    }

    let i = pos + 6;
    while (i < source.length) {
      if (source[i] === '=' && this.isAtLineStart(source, i) && source.slice(i, i + 4) === '=end') {
        // =end must be followed by whitespace, newline, or EOF
        const afterEnd = source[i + 4];
        if (afterEnd === undefined || afterEnd === ' ' || afterEnd === '\t' || afterEnd === '\n' || afterEnd === '\r') {
          // Exclude the entire =end line (content after =end is still a comment)
          let lineEnd = i + 4;
          while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
            lineEnd++;
          }
          return { start: pos, end: lineEnd };
        }
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Checks if colon starts a symbol (not ternary, hash key, or scope resolution)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, or quote
    if (!/[a-zA-Z_"']/.test(nextChar)) {
      return false;
    }

    // Colon after another colon is scope resolution (::), not symbol
    if (pos > 0 && source[pos - 1] === ':') {
      return false;
    }

    // Colon after identifier/number/bracket is ternary, not symbol
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}>]/.test(prevChar)) {
        return false;
      }
    }

    return true;
  }

  // Matches symbol literal: :symbol, :"quoted", :'quoted'
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    const nextChar = source[pos + 1];

    // Double-quoted symbol with interpolation support
    if (nextChar === '"') {
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          i = this.skipInterpolation(source, i + 2);
          continue;
        }
        if (source[i] === '"') {
          return { start: pos, end: i + 1 };
        }
        i++;
      }
      return { start: pos, end: i };
    }

    // Single-quoted symbol (no interpolation)
    if (nextChar === "'") {
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
      return { start: pos, end: i };
    }

    // Simple symbol
    let i = pos + 1;
    while (i < source.length) {
      const char = source[i];
      if (/[a-zA-Z0-9_!?]/.test(char)) {
        i++;
        continue;
      }
      break;
    }

    return { start: pos, end: i };
  }

  // Matches regex literal with flags and #{} interpolation
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation inside regex
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipRegexInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '/') {
        i++;
        // Skip regex flags
        while (i < source.length && REGEX_FLAGS_PATTERN.test(source[i])) {
          i++;
        }
        return { start: pos, end: i };
      }
      if (source[i] === '\n' || source[i] === '\r') {
        // Unterminated regex ends at newline
        return { start: pos, end: i };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Skips #{} interpolation inside regex, tracking brace depth
  private skipRegexInterpolation(source: string, pos: number): number {
    let depth = 1;
    let i = pos;
    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle # line comments (but not #{} interpolation)
      if (source[i] === '#' && (i + 1 >= source.length || source[i + 1] !== '{')) {
        while (i < source.length && source[i] !== '\n') {
          i++;
        }
        continue;
      }
      if (source[i] === '{') {
        depth++;
      } else if (source[i] === '}') {
        depth--;
      } else if (source[i] === '"') {
        i = this.skipNestedString(source, i);
        continue;
      } else if (source[i] === "'") {
        i = this.skipNestedString(source, i);
        continue;
      } else if (source[i] === '`') {
        i = this.skipNestedBacktickString(source, i);
        continue;
      } else if (source[i] === '%' && i + 1 < source.length && !this.isModuloOperator(source, i)) {
        const result = this.matchPercentLiteral(source, i);
        if (result) {
          i = result.end;
          continue;
        }
      }
      i++;
    }
    return i;
  }

  // Checks if slash is regex start (not division)
  private isRegexStart(source: string, pos: number): boolean {
    if (pos === 0) return true;

    // Look back for context, skipping whitespace
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }

    if (i < 0) return true;

    // After these characters, / is likely division
    if (!DIVISION_PRECEDERS_PATTERN.test(source[i])) {
      return true;
    }

    // After keywords, / is regex start (e.g., if /pattern/)
    if (/[a-zA-Z_]/.test(source[i])) {
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.substring(wordStart, i + 1);
      if (REGEX_PRECEDING_KEYWORDS.has(word)) {
        return true;
      }
    }

    return false;
  }

  // Matches heredoc, handling multiple heredocs on same line
  private matchHeredoc(source: string, pos: number): { contentStart: number; end: number } | null {
    // Reject bare <<IDENT when preceded by identifier/number/closing bracket (likely shift operator)
    if (pos > 0) {
      let i = pos - 1;
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
        i--;
      }
      if (i >= 0 && /[a-zA-Z0-9_)\]}]/.test(source[i])) {
        // After identifier/number/bracket, only allow heredoc with flag (- or ~)
        // Rejects ambiguous cases like x <<"EOF" (could be shift + string)
        const afterLtLt = source.slice(pos + 2);
        if (!/^[~-]/.test(afterLtLt)) {
          return null;
        }
      }
    }

    // Pattern requires matching quotes: <<'EOF', <<"EOF", <<EOF (no quotes)
    // The backreference \2 ensures opening and closing quotes match
    const heredocPattern = /<<([~-]?)(['"`])([A-Za-z_][A-Za-z0-9_]*)\2|<<([~-]?)([A-Za-z_][A-Za-z0-9_]*)/g;

    // Find line end
    let lineEnd = pos;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    // Collect all heredoc terminators on this line
    const lineContent = source.slice(pos, lineEnd);
    const terminators: { terminator: string; allowIndented: boolean }[] = [];

    for (const match of lineContent.matchAll(heredocPattern)) {
      // Pattern has two alternatives: quoted (match[3]) or unquoted (match[5])
      const terminator = match[3] || match[5];
      const flag = match[1] || match[4];
      terminators.push({
        terminator,
        allowIndented: flag === '~' || flag === '-'
      });
    }

    if (terminators.length === 0) return null;

    // contentStart is the position after the line ending (skip \r\n or \r or \n)
    let contentStart = lineEnd;
    if (contentStart < source.length) {
      if (source[contentStart] === '\r' && contentStart + 1 < source.length && source[contentStart + 1] === '\n') {
        contentStart += 2;
      } else {
        contentStart += 1;
      }
    }

    // Search for terminators after current line
    let i = contentStart;

    let terminatorIndex = 0;

    while (i < source.length && terminatorIndex < terminators.length) {
      const contentLineStart = i;
      let contentLineEnd = i;
      while (contentLineEnd < source.length && source[contentLineEnd] !== '\n' && source[contentLineEnd] !== '\r') {
        contentLineEnd++;
      }

      // Handle CRLF
      let line = source.slice(contentLineStart, contentLineEnd);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      const currentTerminator = terminators[terminatorIndex];
      const trimmedLine = currentTerminator.allowIndented ? line.trimStart() : line;

      if (trimmedLine === currentTerminator.terminator) {
        terminatorIndex++;
        if (terminatorIndex === terminators.length) {
          let endPos = contentLineEnd;
          if (endPos < source.length) {
            if (source[endPos] === '\r' && endPos + 1 < source.length && source[endPos + 1] === '\n') {
              endPos += 2;
            } else {
              endPos += 1;
            }
          }
          return {
            contentStart,
            end: endPos
          };
        }
      }

      // Advance past the line ending (\r\n, \r, or \n)
      if (contentLineEnd < source.length) {
        if (source[contentLineEnd] === '\r' && contentLineEnd + 1 < source.length && source[contentLineEnd + 1] === '\n') {
          i = contentLineEnd + 2;
        } else {
          i = contentLineEnd + 1;
        }
      } else {
        i = contentLineEnd;
      }
    }

    return { contentStart, end: source.length };
  }

  // Checks if % at position is a modulo operator (not a percent literal)
  private isModuloOperator(source: string, pos: number): boolean {
    if (pos === 0) return false;
    // Look back, skipping whitespace
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    // After identifier, number, closing bracket, string/regex close, % is modulo
    return /[a-zA-Z0-9_)\]}"'`/]/.test(source[i]);
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    const specifier = source[pos + 1];

    let delimiterPos = pos + 1;
    let hasInterpolation = true;
    if (PERCENT_SPECIFIERS_PATTERN.test(specifier)) {
      delimiterPos = pos + 2;
      // %q, %w, %i, %s do not support interpolation
      if (/[qwis]/.test(specifier)) {
        hasInterpolation = false;
      }
    }

    if (delimiterPos >= source.length) return null;

    const openDelimiter = source[delimiterPos];
    const closeDelimiter = this.getMatchingDelimiter(openDelimiter);

    if (!closeDelimiter) return null;

    let i = delimiterPos + 1;
    let depth = 1;
    const isPaired = openDelimiter !== closeDelimiter;

    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation in interpolating percent literals
      if (hasInterpolation && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (isPaired && source[i] === openDelimiter) {
        depth++;
      } else if (source[i] === closeDelimiter) {
        depth--;
      }
      i++;
    }

    return { end: i };
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '"') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches backtick string (command) with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '`') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    let depth = 1;
    let i = pos;
    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle # line comments (but not #{} interpolation)
      if (source[i] === '#' && (i + 1 >= source.length || source[i + 1] !== '{')) {
        while (i < source.length && source[i] !== '\n') {
          i++;
        }
        continue;
      }
      if (source[i] === '{') {
        depth++;
      } else if (source[i] === '}') {
        depth--;
      } else if (source[i] === '"') {
        i = this.skipNestedString(source, i);
        continue;
      } else if (source[i] === "'") {
        i = this.skipNestedString(source, i);
        continue;
      } else if (source[i] === '`') {
        i = this.skipNestedBacktickString(source, i);
        continue;
      } else if (source[i] === '/' && this.isRegexInInterpolation(source, i, pos)) {
        i = this.skipNestedRegex(source, i);
        continue;
      } else if (source[i] === '%' && i + 1 < source.length && !this.isModuloOperator(source, i)) {
        const result = this.matchPercentLiteral(source, i);
        if (result) {
          i = result.end;
          continue;
        }
      }
      i++;
    }
    return i;
  }

  // Checks if / inside interpolation starts a regex (not division)
  private isRegexInInterpolation(source: string, pos: number, interpStart: number): boolean {
    if (pos === interpStart) return true;
    let j = pos - 1;
    while (j >= interpStart && (source[j] === ' ' || source[j] === '\t')) {
      j--;
    }
    if (j < interpStart) return true;
    return /[(,=!~|&{[:]/.test(source[j]);
  }

  // Skips a regex literal inside interpolation
  private skipNestedRegex(source: string, pos: number): number {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} inside regex
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '/') {
        i++;
        // Skip regex flags
        while (i < source.length && REGEX_FLAGS_PATTERN.test(source[i])) {
          i++;
        }
        return i;
      }
      if (source[i] === '\n') {
        return i;
      }
      i++;
    }
    return i;
  }

  // Skips a nested string inside interpolation
  private skipNestedString(source: string, pos: number): number {
    const quote = source[pos];
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{' && quote === '"') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === quote) {
        return i + 1;
      }
      i++;
    }
    return i;
  }

  // Skips a backtick string inside interpolation (supports #{} interpolation)
  private skipNestedBacktickString(source: string, pos: number): number {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = this.skipInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '`') {
        return i + 1;
      }
      i++;
    }
    return i;
  }

  // Returns matching close delimiter for percent literals
  private getMatchingDelimiter(open: string): string | null {
    if (open in PAIRED_DELIMITERS) {
      return PAIRED_DELIMITERS[open];
    }
    // Any non-alphanumeric, non-whitespace character can be its own delimiter
    return /[^\sa-zA-Z0-9]/.test(open) ? open : null;
  }
}
