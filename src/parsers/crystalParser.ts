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
  'ensure',
  'select'
]);

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
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in', 'then']
  };

  // Finds excluded regions: comments, strings, regex, heredocs, macro templates
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

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Macro template {% %} or {{ }}
    if (char === '{') {
      const region = this.matchMacroTemplate(source, pos);
      if (region) return region;
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return this.matchInterpolatedString(source, pos);
    }

    // Single-quoted char literal (Crystal: only single characters)
    if (char === "'") {
      return this.matchCharLiteral(source, pos);
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

    // Backtick string (command) with #{} interpolation
    if (char === '`') {
      return this.matchBacktickString(source, pos);
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

  // Checks if colon starts a symbol (not ternary, named tuple key, type annotation, or scope resolution)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // :: is scope resolution (e.g., Foo::Bar), not a symbol
    if (nextChar === ':') {
      return false;
    }

    // Check if preceded by : (second half of ::)
    if (pos > 0 && source[pos - 1] === ':') {
      return false;
    }

    // Symbol must start with letter, underscore, or quote
    if (!/[a-zA-Z_"']/.test(nextChar)) {
      return false;
    }

    // Look back, skipping whitespace, to find the actual preceding character
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }

    // Colon after identifier/number/bracket is ternary or type annotation, not symbol
    if (i >= 0) {
      const prevChar = source[i];
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

  // Filters out keywords used as named tuple keys, rescue modifiers, and method calls
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    return tokens.filter((token) => {
      // Filter out dot-preceded tokens (method calls like obj.end, obj.rescue)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        return false;
      }
      // Filter out tokens immediately followed by colon (named tuple key)
      if (source[token.endOffset] === ':') {
        return false;
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !this.isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      // Filter out 'in' after 'for' on the same line (for x in collection)
      if (token.type === 'block_middle' && token.value === 'in') {
        return !this.isForIn(source, token.startOffset, excludedRegions);
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

  // Checks if 'in' is part of a for-in loop (for x in collection)
  private isForIn(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    let before = source.slice(lineStart, position);
    // Find last semicolon not in excluded region
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
    // Check if this statement starts with 'for'
    return /^\s*for\b/.test(before);
  }

  // Matches regex literal with #{} interpolation
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
        // Unterminated regex
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

  // Matches heredoc (Crystal doesn't have <<~ like Ruby)
  private matchHeredoc(source: string, pos: number): { contentStart: number; end: number } | null {
    // Crystal requires <<- (with dash) for heredocs; <<IDENT is not valid
    if (pos + 2 >= source.length || source[pos + 2] !== '-') {
      return null;
    }

    // Pattern requires dash: <<-'EOF', <<-"EOF", <<-EOF
    const heredocPattern = /<<-(['"])([A-Za-z_][A-Za-z0-9_]*)\1|<<-([A-Za-z_][A-Za-z0-9_]*)/g;

    // Find line end
    let lineEnd = pos;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    // Collect all heredoc terminators on this line
    const lineContent = source.slice(pos, lineEnd);
    const terminators: { terminator: string }[] = [];

    for (const match of lineContent.matchAll(heredocPattern)) {
      // Pattern has two alternatives: quoted (match[2]) or unquoted (match[3])
      const terminator = match[2] || match[3];
      terminators.push({ terminator });
    }

    if (terminators.length === 0) return null;

    // contentStart is the position after the newline ending the heredoc opener line
    let contentStart = lineEnd;
    if (contentStart < source.length) {
      // Skip \r\n or \r or \n
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

      const line = source.slice(contentLineStart, contentLineEnd);

      // Crystal <<- always allows indented terminators
      const trimmedLine = line.trimStart();

      if (trimmedLine === terminators[terminatorIndex].terminator) {
        terminatorIndex++;
        if (terminatorIndex === terminators.length) {
          let end = contentLineEnd;
          if (end < source.length) {
            // Skip \r\n or \r or \n
            if (source[end] === '\r' && end + 1 < source.length && source[end + 1] === '\n') {
              end += 2;
            } else {
              end += 1;
            }
          }
          return { contentStart, end };
        }
      }

      // Advance past line ending (\r\n or \r or \n)
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
    if (PERCENT_SPECIFIERS_PATTERN.test(specifier)) {
      delimiterPos = pos + 2;
    }

    if (delimiterPos >= source.length) return null;

    const openDelimiter = source[delimiterPos];
    const closeDelimiter = this.getMatchingDelimiter(openDelimiter);

    if (!closeDelimiter) return null;

    // Specifiers that support #{} interpolation: %Q, %W, %I, %x, %r, and bare %
    const interpolating =
      !PERCENT_SPECIFIERS_PATTERN.test(specifier) ||
      specifier === 'Q' ||
      specifier === 'W' ||
      specifier === 'I' ||
      specifier === 'x' ||
      specifier === 'r';

    let i = delimiterPos + 1;
    let depth = 1;
    const isPaired = openDelimiter !== closeDelimiter;

    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation in interpolating percent literals
      if (interpolating && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
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
      if (source[i] === '\n' || source[i] === '\r') {
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
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{' && quote !== "'") {
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

  // Matches backtick command string with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
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
      if (source[i] === '`') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches Crystal char literal: 'X', '\X', '\uXXXX', '\u{XXXX}'
  private matchCharLiteral(source: string, pos: number): ExcludedRegion | null {
    let i = pos + 1;
    if (i >= source.length) return null;

    if (source[i] === '\\') {
      // Escape sequence: '\n', '\t', '\uXXXX', '\u{...}', etc.
      i++;
      if (i >= source.length) return null;
      if (source[i] === 'u') {
        i++;
        if (i < source.length && source[i] === '{') {
          // \u{XXXX} form
          i++;
          while (i < source.length && source[i] !== '}') {
            i++;
          }
          if (i < source.length) i++; // skip '}'
        } else {
          // \uXXXX form (4 hex digits)
          const end = Math.min(i + 4, source.length);
          while (i < end && /[0-9a-fA-F]/.test(source[i])) {
            i++;
          }
        }
      } else if (source[i] === 'x') {
        // \xNN form (2 hex digits)
        i++;
        const end = Math.min(i + 2, source.length);
        while (i < end && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
      } else if (source[i] === 'o') {
        // \oNNN form (octal digits)
        i++;
        while (i < source.length && /[0-7]/.test(source[i])) {
          i++;
        }
      } else if (/[0-7]/.test(source[i])) {
        // \NNN form (octal digits, legacy)
        while (i < source.length && /[0-7]/.test(source[i])) {
          i++;
        }
      } else {
        // Single escape char: '\n', '\t', '\\', '\0', etc.
        i++;
      }
    } else {
      // Single character: 'a', 'z', '😀', etc.
      // Handle surrogate pairs (characters outside BMP)
      const code = source.codePointAt(i);
      if (code !== undefined && code > 0xffff) {
        i += 2;
      } else {
        i++;
      }
    }

    if (i < source.length && source[i] === "'") {
      return { start: pos, end: i + 1 };
    }

    // Not a valid char literal, don't exclude
    return null;
  }

  // Returns matching close delimiter for percent literals
  private getMatchingDelimiter(open: string): string | null {
    if (open in PAIRED_DELIMITERS) {
      return PAIRED_DELIMITERS[open];
    }
    // Any non-alphanumeric, non-whitespace character can be its own delimiter
    return /[^\sa-zA-Z0-9]/.test(open) ? open : null;
  }

  // Validates block open keywords, excluding postfix conditionals and loop do
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj.begin)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // 'do' as loop separator (while/until/for condition do) is not a block
    if (keyword === 'do') {
      return !this.isLoopDo(source, position, excludedRegions);
    }

    // 'abstract def' has no body and no 'end'
    if (keyword === 'def') {
      const textBefore = source.slice(0, position);
      if (/\babstract[ \t]+$/.test(textBefore)) {
        return false;
      }
    }

    // if, unless, while, until can be postfix conditionals in Crystal
    if (!['if', 'unless', 'while', 'until'].includes(keyword)) {
      return true;
    }

    return !this.isPostfixConditional(source, position, excludedRegions);
  }

  // Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
  private isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }

    let beforeDo = source.slice(lineStart, position);
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

    const loopPattern = /\b(while|until|for)\b/g;
    const loopMatches = [...beforeDo.matchAll(loopPattern)];

    for (const loopMatch of loopMatches) {
      const loopAbsolutePos = searchStart + loopMatch.index;
      if (this.isInExcludedRegion(loopAbsolutePos, excludedRegions)) {
        continue;
      }

      const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
      const searchRange = source.slice(afterLoopStart, position + 2);
      const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

      for (const doMatch of doMatches) {
        const doAbsolutePos = afterLoopStart + doMatch.index;
        if (this.isInExcludedRegion(doAbsolutePos, excludedRegions)) {
          continue;
        }
        if (doAbsolutePos === position) {
          return true;
        }
        break;
      }
    }

    return false;
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
    const precedingBlockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in'];

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
}
