// Crystal block parser: handles macro templates, heredocs, percent literals, regex, and postfix conditionals

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { isForIn, isLoopDo, isPostfixConditional, isPostfixRescue, matchCharLiteral, matchHeredoc, matchMacroTemplate } from './crystalExcluded';
import {
  isRegexStart,
  matchBacktickString,
  matchInterpolatedString,
  matchPercentLiteral,
  matchRegexLiteral,
  skipNestedBacktickString,
  skipNestedRegex,
  skipNestedString
} from './rubyFamilyHelpers';

// Valid Crystal regex flags
const REGEX_FLAGS_PATTERN = /[imx]/;

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrx]/;

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

// Crystal interpolation check: %Q, %W, %I, %x, %r and bare % interpolate
function isCrystalInterpolatingPercent(specifier: string, hasSpecifier: boolean): boolean {
  if (!hasSpecifier) return true;
  return specifier === 'Q' || specifier === 'W' || specifier === 'I' || specifier === 'x' || specifier === 'r';
}

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
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Macro template {% %} or {{ }}
    if (char === '{') {
      const region = matchMacroTemplate(source, pos);
      if (region) return region;
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return this.matchInterpolatedString(source, pos);
    }

    // Single-quoted char literal (Crystal: only single characters)
    if (char === "'") {
      const charLiteral = matchCharLiteral(source, pos);
      if (charLiteral) return charLiteral;
      // Invalid char literal (multi-char): skip to next ' on same line
      // to prevent keywords between quotes from being detected
      let j = pos + 1;
      while (j < source.length && source[j] !== "'" && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '\\' && j + 1 < source.length) {
          j += 2;
          continue;
        }
        j++;
      }
      if (j < source.length && source[j] === "'") {
        return { start: pos, end: j + 1 };
      }
      return null;
    }

    // Regex literal
    if (char === '/' && this.isRegexStart(source, pos)) {
      return this.matchRegexLiteral(source, pos);
    }

    // Heredoc
    if (char === '<' && pos + 1 < source.length && source[pos + 1] === '<') {
      const result = matchHeredoc(source, pos);
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

    // Colon after identifier/number/closing bracket is ternary, not symbol
    // Only check the immediately preceding character (do not skip whitespace)
    // because `puts :do` is a valid symbol argument to method `puts`
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}]/.test(prevChar)) {
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
      if (/[a-zA-Z0-9_]/.test(char)) {
        i++;
        continue;
      }
      // ? and ! can only appear at the end of a symbol name
      if (char === '?' || char === '!') {
        i++;
        break;
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
      // But NOT range operators (.., ...) - those end with '.' but are not method calls
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        if (token.startOffset < 2 || source[token.startOffset - 2] !== '.') {
          return false;
        }
      }
      // Filter out :: scope resolution (e.g., Module::Class::Begin)
      if (token.startOffset > 1 && source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':') {
        return false;
      }
      // Filter out keywords preceded by @ (instance/class variable names like @end, @@end, @do)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '@') {
        return false;
      }
      // Filter out tokens immediately followed by colon (named tuple key)
      if (source[token.endOffset] === ':') {
        return false;
      }
      // Filter out keywords in heredoc openers (<<-end, <<-'do', <<-"if" etc.)
      if (token.startOffset >= 3 && source.slice(token.startOffset - 3, token.startOffset) === '<<-') {
        return false;
      }
      if (token.startOffset >= 4 && /<<-['"]$/.test(source.slice(token.startOffset - 4, token.startOffset))) {
        return false;
      }
      // Filter out keywords followed by ? or = (method names like end?, do=)
      // But not != (not-equal) or == / === / =~ (comparison operators)
      const afterChar = source[token.endOffset];
      if (afterChar === '?') {
        return false;
      }
      if (
        afterChar === '=' &&
        token.endOffset + 1 < source.length &&
        source[token.endOffset + 1] !== '=' &&
        source[token.endOffset + 1] !== '~' &&
        source[token.endOffset + 1] !== '>'
      ) {
        return false;
      }
      if (afterChar === '=' && token.endOffset + 1 >= source.length) {
        return false;
      }
      // Filter out ! as method suffix but not != (not-equal operator)
      if (afterChar === '!' && (token.endOffset + 1 >= source.length || source[token.endOffset + 1] !== '=')) {
        return false;
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      // Filter out 'in' after 'for' on the same line (for x in collection)
      if (token.type === 'block_middle' && token.value === 'in') {
        return !isForIn(source, token.startOffset, excludedRegions);
      }
      return true;
    });
  }

  // Matches regex literal with #{} interpolation
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    return matchRegexLiteral(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipRegexInterpolation(s, p), false);
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
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
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
    return isRegexStart(source, pos, REGEX_PRECEDING_KEYWORDS);
  }

  // Checks if % at position is a modulo operator (not a percent literal)
  private isModuloOperator(source: string, pos: number): boolean {
    if (pos === 0) return false;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    if (!/[a-zA-Z0-9_)\]}"'`/]/.test(source[i])) return false;
    // %<type><delimiter> is always a percent literal, even after identifiers
    // e.g. puts %w[a b], raise %q{error}
    const next = pos + 1;
    if (next < source.length && /[qQwWiIrx]/.test(source[next]) && next + 1 < source.length && /[^a-zA-Z0-9_ \t]/.test(source[next + 1])) {
      return false;
    }
    return true;
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    return matchPercentLiteral(source, pos, PERCENT_SPECIFIERS_PATTERN, isCrystalInterpolatingPercent, (s, p) => this.skipInterpolation(s, p));
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    return matchInterpolatedString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    let depth = 1;
    let i = pos;
    let heredocSkipEnd = -1;
    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle # line comments (but not #{} interpolation)
      if (source[i] === '#' && (i + 1 >= source.length || source[i + 1] !== '{')) {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // At line break, skip pending heredoc body
      if ((source[i] === '\n' || source[i] === '\r') && heredocSkipEnd > i) {
        if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        i = heredocSkipEnd;
        heredocSkipEnd = -1;
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
      } else if (source[i] === '<' && i + 1 < source.length && source[i + 1] === '<' && heredocSkipEnd < 0) {
        const heredocResult = matchHeredoc(source, i);
        if (heredocResult) {
          heredocSkipEnd = heredocResult.end;
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
    // Operators and punctuation after which / starts a regex, not division
    return /[(,=!~|&{[:;+\-*%<>^?]/.test(source[j]);
  }

  // Skips a regex literal inside interpolation
  private skipNestedRegex(source: string, pos: number): number {
    return skipNestedRegex(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a nested string inside interpolation
  private skipNestedString(source: string, pos: number): number {
    return skipNestedString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a backtick string inside interpolation (supports #{} interpolation)
  private skipNestedBacktickString(source: string, pos: number): number {
    return skipNestedBacktickString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Matches backtick command string with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
    return matchBacktickString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Validates block open keywords, excluding postfix conditionals and loop do
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj.begin)
    // But NOT range operators (.., ...) - those end with '.' but are not method calls
    if (position > 0 && source[position - 1] === '.') {
      if (position < 2 || source[position - 2] !== '.') {
        return false;
      }
    }

    // 'do' as loop separator (while/until/for condition do) is not a block
    if (keyword === 'do') {
      return !isLoopDo(source, position, excludedRegions);
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

    return !isPostfixConditional(source, position, excludedRegions);
  }
}
