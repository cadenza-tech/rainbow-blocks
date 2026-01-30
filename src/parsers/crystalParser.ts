// Crystal block parser: handles macro templates, heredocs, percent literals, regex, and postfix conditionals

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Valid Crystal regex flags
const REGEX_FLAGS_PATTERN = /[imx]/;

// Paired bracket delimiters for percent literals
const PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrx]/;

// Characters that indicate the preceding / is division, not regex
const DIVISION_PRECEDERS_PATTERN = /[a-zA-Z0-9_)\]}"'`]/;

export class CrystalBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      // Ruby-like
      'do',
      'if',
      'unless',
      'while',
      'until',
      'begin',
      'def',
      'class',
      'module',
      'case',
      'for',
      // Crystal-specific
      'macro',
      'lib',
      'struct',
      'enum',
      'union',
      'annotation',
      'select'
      // Note: "fun" is excluded because inside "lib" blocks it's used
      // as a declaration without "end"
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in']
  };

  // Finds excluded regions: comments, strings, regex, heredocs, macro templates
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
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Macro template {% %} or {{ }}
    if (char === '{') {
      const region = this.matchMacroTemplate(source, pos);
      if (region) return region;
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted char literal
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
      if (result) return { start: pos, end: result.end };
    }

    // Percent literals
    if (char === '%' && pos + 1 < source.length) {
      const result = this.matchPercentLiteral(source, pos);
      if (result) return { start: pos, end: result.end };
    }

    // Symbol literal
    if (char === ':' && this.isSymbolStart(source, pos)) {
      return this.matchSymbolLiteral(source, pos);
    }

    // Backtick string (command)
    if (char === '`') {
      return this.matchQuotedString(source, pos, '`');
    }

    return null;
  }

  // Matches macro template {% %} or {{ }}, handling strings inside
  private matchMacroTemplate(source: string, pos: number): ExcludedRegion | null {
    // {% ... %}
    if (source.slice(pos, pos + 2) === '{%') {
      let i = pos + 2;
      while (i < source.length) {
        const char = source[i];
        // Skip strings inside macro template
        if (char === '"' || char === "'") {
          i = this.skipMacroString(source, i, char);
          continue;
        }
        if (source.slice(i, i + 2) === '%}') {
          return { start: pos, end: i + 2 };
        }
        i++;
      }
      return { start: pos, end: source.length };
    }

    // {{ ... }}
    if (source.slice(pos, pos + 2) === '{{') {
      let i = pos + 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        const char = source[i];
        // Skip strings inside macro template
        if (char === '"' || char === "'") {
          i = this.skipMacroString(source, i, char);
          continue;
        }
        if (source.slice(i, i + 2) === '{{') {
          depth++;
          i += 2;
          continue;
        }
        if (source.slice(i, i + 2) === '}}') {
          depth--;
          if (depth === 0) {
            return { start: pos, end: i + 2 };
          }
          i += 2;
          continue;
        }
        i++;
      }
      return { start: pos, end: source.length };
    }

    return null;
  }

  // Skips a string inside macro template, returning position after closing quote
  private skipMacroString(source: string, pos: number, quote: string): number {
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

  // Checks if colon starts a symbol (not ternary or named tuple key)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, or quote
    if (!/[a-zA-Z_"']/.test(nextChar)) {
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

    // Quoted symbol
    if (nextChar === '"' || nextChar === "'") {
      const quote = nextChar;
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
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

  // Filters out keywords used as named tuple keys (e.g., { if: value })
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    // Filter out tokens immediately followed by colon
    return tokens.filter((token) => {
      const afterKeyword = source[token.endOffset];
      return afterKeyword !== ':';
    });
  }

  // Matches regex literal
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
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
      if (source[i] === '\n') {
        // Unterminated regex
        return { start: pos, end: i };
      }
      i++;
    }
    return { start: pos, end: i };
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
    return !DIVISION_PRECEDERS_PATTERN.test(source[i]);
  }

  // Matches heredoc (Crystal doesn't have <<~ like Ruby)
  private matchHeredoc(source: string, pos: number): { end: number } | null {
    const heredocPattern = /<<(-)?(['"])?([A-Za-z_][A-Za-z0-9_]*)\2?/g;

    // Find line end
    let lineEnd = pos;
    while (lineEnd < source.length && source[lineEnd] !== '\n') {
      lineEnd++;
    }

    // Collect all heredoc terminators on this line
    const lineContent = source.slice(pos, lineEnd);
    const terminators: { terminator: string; allowIndented: boolean }[] = [];

    for (const match of lineContent.matchAll(heredocPattern)) {
      terminators.push({
        terminator: match[3],
        allowIndented: match[1] === '-'
      });
    }

    if (terminators.length === 0) return null;

    // Search for terminators after current line
    let i = lineEnd;
    if (i < source.length) i++;

    let terminatorIndex = 0;

    while (i < source.length && terminatorIndex < terminators.length) {
      const contentLineStart = i;
      let contentLineEnd = i;
      while (contentLineEnd < source.length && source[contentLineEnd] !== '\n') {
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
          return {
            end: contentLineEnd + (contentLineEnd < source.length ? 1 : 0)
          };
        }
      }

      i = contentLineEnd + 1;
    }

    return { end: source.length };
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    const specifier = source[pos + 1];

    let delimiterPos = pos + 1;
    if (PERCENT_SPECIFIERS_PATTERN.test(specifier)) {
      delimiterPos = pos + 2;
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
      if (isPaired && source[i] === openDelimiter) {
        depth++;
      } else if (source[i] === closeDelimiter) {
        depth--;
      }
      i++;
    }

    return { end: i };
  }

  // Returns matching close delimiter for percent literals
  private getMatchingDelimiter(open: string): string | null {
    if (open in PAIRED_DELIMITERS) {
      return PAIRED_DELIMITERS[open];
    }
    // Any non-alphanumeric character can be its own delimiter
    return /[^a-zA-Z0-9]/.test(open) ? open : null;
  }

  // Validates block open keywords, excluding postfix conditionals
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Only if and unless can be postfix conditionals in Crystal
    if (keyword !== 'if' && keyword !== 'unless') {
      return true;
    }

    return !this.isPostfixConditional(source, position, excludedRegions);
  }

  // Checks if a conditional is postfix (e.g., "return value if condition")
  private isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find line start
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') {
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
    const precedingBlockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in'];

    for (const kw of precedingBlockKeywords) {
      if (beforeKeyword === kw || beforeKeyword.endsWith(` ${kw}`)) {
        return false;
      }
    }

    // Operator expecting expression means not postfix
    if (/[=&|,([{:?]$/.test(beforeKeyword)) {
      return false;
    }

    // Non-keyword content before means postfix
    return true;
  }
}
