// Ruby block parser: handles heredocs, percent literals, regex, symbols, and postfix conditionals

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { matchHeredoc, matchMultiLineComment } from './rubyExcluded';
import type { HeredocState, InterpolationHandlers } from './rubyFamilyHelpers';
import {
  isRegexStart,
  matchBacktickString,
  matchInterpolatedString,
  matchPercentLiteral,
  matchRegexLiteral,
  skipInterpolationShared,
  skipNestedBacktickString,
  skipNestedRegex,
  skipNestedString
} from './rubyFamilyHelpers';
import type { RubyValidationCallbacks } from './rubyValidation';
import {
  isDotPreceded as isDotPrecededShared,
  isEndlessMethodDef as isEndlessMethodDefShared,
  isLoopDo as isLoopDoShared,
  isPostfixConditional as isPostfixConditionalShared,
  isPostfixRescue as isPostfixRescueShared
} from './rubyValidation';

// Valid Ruby regex flags
const REGEX_FLAGS_PATTERN = /[imxonesu]/;

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrsx]/;

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

// Ruby interpolation check: %q, %w, %i, %s do not interpolate
function isRubyInterpolatingPercent(_specifier: string, hasSpecifier: boolean): boolean {
  if (!hasSpecifier) return true;
  return !/[qwis]/.test(_specifier);
}

export class RubyBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['do', 'if', 'unless', 'while', 'until', 'begin', 'def', 'class', 'module', 'case', 'for'],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in', 'then']
  };

  // Tracks the last excluded region found during findExcludedRegions scanning,
  // so tryMatchExcludedRegion can avoid misinterpreting characters inside prior regions
  private _lastExcludedRegion: ExcludedRegion | null = null;

  private get validationCallbacks(): RubyValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Skip 'in' intermediate when attached to 'for' (for x in collection)
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
            // 'in' is a syntactic separator in 'for x in collection', not a section boundary
            if (token.value === 'in' && stack[stack.length - 1].token.value === 'for') {
              break;
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

  // Validates block open keywords, excluding postfix conditionals
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj. begin)
    // But allow range operator (..) — x..end is valid
    if (this.isDotPreceded(source, position, excludedRegions)) {
      return false;
    }

    // Check if 'do' is a loop separator (while/until/for ... do)
    if (keyword === 'do') {
      return !this.isLoopDo(source, position, excludedRegions);
    }

    // Reject Ruby 3.0+ endless method definitions (e.g., `def foo = expr`)
    // which have no matching `end`.
    if (keyword === 'def') {
      if (this.isEndlessMethodDef(source, position + keyword.length, excludedRegions)) {
        return false;
      }
    }

    // Only if, unless, while, until can be postfix conditionals
    if (!['if', 'unless', 'while', 'until'].includes(keyword)) {
      return true;
    }

    return !this.isPostfixConditional(source, position, excludedRegions);
  }

  private isEndlessMethodDef(source: string, start: number, excludedRegions: ExcludedRegion[]): boolean {
    return isEndlessMethodDefShared(source, start, excludedRegions, this.validationCallbacks);
  }

  // Filters out keywords used as hash keys, rescue modifiers, and method calls
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    return tokens.filter((token) => {
      // Filter out keywords in heredoc identifiers (<<end, <<-do, <<~if, <<'end', <<"do", etc.)
      // Only filter when the << is actually a heredoc (excluded region starts after opener line), not a shift operator
      if (token.startOffset >= 2) {
        const prefixStart = Math.max(0, token.startOffset - 4);
        const prefix = source.slice(prefixStart, token.startOffset);
        if (/<<[~-]?['"`]?$/.test(prefix)) {
          // Find the position after the opener line's newline
          let lineEnd = token.endOffset;
          // Skip past optional closing quote of the heredoc identifier
          if (lineEnd < source.length && (source[lineEnd] === "'" || source[lineEnd] === '"' || source[lineEnd] === '`')) {
            lineEnd++;
          }
          // Find the actual end of the line
          while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
            lineEnd++;
          }
          // Calculate contentStart (position after newline)
          let contentStart = lineEnd;
          if (contentStart < source.length) {
            if (source[contentStart] === '\r' && contentStart + 1 < source.length && source[contentStart + 1] === '\n') {
              contentStart += 2;
            } else {
              contentStart++;
            }
          }
          // Only filter if this was a real heredoc (its body starts an excluded region)
          if (excludedRegions.some((r) => r.start === contentStart)) {
            return false;
          }
        }
      }
      // Filter out dot-preceded tokens (method calls like obj.end, obj. class)
      // But allow range operator (..) — x..end is valid
      if (this.isDotPreceded(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Filter out keywords used as method names after 'def' (e.g., def do, def begin, def end)
      if (this.isAfterDefKeyword(source, token.startOffset)) {
        return false;
      }
      // Filter out :: scope resolution (e.g., Module::Class::Begin)
      if (token.startOffset > 1 && source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':') {
        return false;
      }
      // Filter out keyword followed by :: (e.g., class::Method, module::Nested)
      // But allow end:: because end::to_s means "close the block, then call method on result"
      const afterEnd = token.endOffset;
      if (token.type !== 'block_close' && afterEnd + 1 < source.length && source[afterEnd] === ':' && source[afterEnd + 1] === ':') {
        return false;
      }
      // Filter out keywords preceded by $ or @ (variable names like $end, @end, @@end)
      if (token.startOffset > 0 && (source[token.startOffset - 1] === '$' || source[token.startOffset - 1] === '@')) {
        return false;
      }
      // Filter out tokens immediately followed by colon (hash key syntax)
      // But not :: (scope resolution operator)
      if (source[token.endOffset] === ':' && source[token.endOffset + 1] !== ':') {
        return false;
      }
      // Filter out keywords followed by ? (method names like end?, begin?)
      const afterChar = source[token.endOffset];
      if (afterChar === '?') {
        return false;
      }
      // Filter out keywords followed by = but not ==, =~, => (method names like do=, end=)
      if (afterChar === '=') {
        const afterAfter = source[token.endOffset + 1];
        if (afterAfter !== '=' && afterAfter !== '~' && afterAfter !== '>') {
          return false;
        }
      }
      // Filter out keywords followed by ! but not != (method names like end!, begin!)
      if (afterChar === '!') {
        if (token.endOffset + 1 >= source.length || source[token.endOffset + 1] !== '=') {
          return false;
        }
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !this.isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      return true;
    });
  }

  // Checks if keyword is used as a method name after 'def' (e.g., def do, def begin, def end)
  private isAfterDefKeyword(source: string, position: number): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i >= 2 && source.slice(i - 2, i + 1) === 'def') {
      const defStart = i - 2;
      return defStart === 0 || !/[a-zA-Z0-9_]/.test(source[defStart - 1]);
    }
    return false;
  }

  private isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPostfixRescueShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPostfixConditionalShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isLoopDoShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isDotPreceded(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isDotPrecededShared(source, position, excludedRegions, this.validationCallbacks);
  }

  // Finds excluded regions: comments, strings, regex, heredocs, percent literals, symbols
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    this._lastExcludedRegion = null;
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
              const gapRegion = {
                start: gapResult.start,
                end: Math.min(gapResult.end, result.start)
              };
              regions.push(gapRegion);
              this._lastExcludedRegion = gapRegion;
              j = gapResult.end;
            } else {
              j++;
            }
          }
        }
        regions.push(result);
        this._lastExcludedRegion = result;
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

    // __END__ marker: everything after is data
    if (char === '_' && this.isAtLineStart(source, pos)) {
      if (source.slice(pos, pos + 7) === '__END__') {
        const afterEnd = source[pos + 7];
        if (afterEnd === undefined || afterEnd === '\n' || afterEnd === '\r' || afterEnd === ' ' || afterEnd === '\t') {
          return { start: pos, end: source.length };
        }
      }
    }

    // Ruby character literal: ?x (must check before #, ", ' to prevent false matches)
    if (char === '?' && pos + 1 < source.length) {
      if (pos === 0 || !/[a-zA-Z0-9_)\]}"'`]/.test(source[pos - 1])) {
        const nextChar = source[pos + 1];
        if (nextChar === '\\' && pos + 2 < source.length) {
          const escChar = source[pos + 2];
          // \C-x, \M-x (5 chars total: ?\C-x), \M-\C-x (8 chars total: ?\M-\C-x)
          if ((escChar === 'C' || escChar === 'M') && pos + 3 < source.length && source[pos + 3] === '-') {
            if (
              escChar === 'M' &&
              pos + 4 < source.length &&
              source[pos + 4] === '\\' &&
              pos + 5 < source.length &&
              source[pos + 5] === 'C' &&
              pos + 6 < source.length &&
              source[pos + 6] === '-' &&
              pos + 7 < source.length
            ) {
              return { start: pos, end: pos + 8 };
            }
            if (pos + 4 < source.length) {
              return { start: pos, end: pos + 5 };
            }
            return { start: pos, end: pos + 4 };
          }
          // \uXXXX (7 chars: ?\uXXXX) or \u{...} (variable)
          if (escChar === 'u') {
            if (pos + 3 < source.length && source[pos + 3] === '{') {
              // Scan for closing } but stop at line break to avoid scanning entire source
              let closeIdx = -1;
              for (let ci = pos + 4; ci < source.length; ci++) {
                if (source[ci] === '}') {
                  closeIdx = ci;
                  break;
                }
                if (source[ci] === '\n' || source[ci] === '\r') {
                  break;
                }
              }
              return { start: pos, end: closeIdx >= 0 ? closeIdx + 1 : pos + 4 };
            }
            // Scan up to 4 hex digits, stopping at newlines and non-hex characters
            let uEnd = pos + 3;
            const uMax = Math.min(pos + 7, source.length);
            while (uEnd < uMax && /[0-9a-fA-F]/.test(source[uEnd]) && source[uEnd] !== '\n' && source[uEnd] !== '\r') {
              uEnd++;
            }
            return { start: pos, end: uEnd };
          }
          // \xN or \xNN (4 or 5 chars: ?\xN or ?\xNN)
          if (escChar === 'x') {
            // Scan up to 2 hex digits, stopping at newlines and non-hex characters
            let hexEnd = pos + 3;
            const hexMax = Math.min(pos + 5, source.length);
            while (hexEnd < hexMax && /[0-9a-fA-F]/.test(source[hexEnd]) && source[hexEnd] !== '\n' && source[hexEnd] !== '\r') {
              hexEnd++;
            }
            return { start: pos, end: hexEnd };
          }
          return { start: pos, end: pos + 3 };
        }
        if (nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r') {
          // Handle surrogate pairs (codepoints > U+FFFF use 2 UTF-16 code units)
          const codePoint = source.codePointAt(pos + 1);
          const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
          return { start: pos, end: pos + 1 + charLen };
        }
      }
    }

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: =begin ... =end
    if (char === '=' && this.isAtLineStart(source, pos)) {
      const region = matchMultiLineComment(source, pos);
      if (region) return region;
    }

    // $', $", $` are global variables, not string/backtick starts
    if (pos > 0 && source[pos - 1] === '$' && (char === '"' || char === "'" || char === '`')) {
      const dollarInLastRegion =
        this._lastExcludedRegion !== null && pos - 1 >= this._lastExcludedRegion.start && pos - 1 < this._lastExcludedRegion.end;
      // Skip if $ is inside previous excluded region (e.g., ?$ char literal)
      // or if preceded by another $ not in excluded region ($$ global variable)
      if (!dollarInLastRegion && !(pos >= 2 && source[pos - 2] === '$' && !this.isPrevCharInLastRegion(pos - 2))) {
        return { start: pos, end: pos + 1 };
      }
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

    // Backtick string (command) with #{} interpolation support
    if (char === '`') {
      return this.matchBacktickString(source, pos);
    }

    return null;
  }

  // Checks if colon starts a symbol (not ternary, hash key, or scope resolution)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, quote, or operator character
    // Operator symbols: :+, :-, :*, :/, :%, :**, :<, :>, :<=, :>=, :==, :===,
    // :<=>, :!=, :=~, :!~, :&, :|, :^, :~, :<<, :>>, :[], :[]=, :-@, :+@, :`
    if (!/[a-zA-Z_"'+\-*/%<>=!~&|^[`]/.test(nextChar)) {
      return false;
    }

    // Colon after another colon is scope resolution (::), not symbol
    if (pos > 0 && source[pos - 1] === ':') {
      return false;
    }

    // Colon after identifier/number/bracket is ternary, not symbol
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

    // Double-quoted symbol with interpolation support (propagate heredocState)
    if (nextChar === '"') {
      const heredocState: HeredocState = { pendingEnd: -1 };
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          i = skipInterpolationShared(source, i + 2, this.interpolationHandlers, heredocState);
          continue;
        }
        if (source[i] === '"') {
          const end = i + 1;
          if (heredocState.pendingEnd > end) {
            return { start: pos, end: heredocState.pendingEnd };
          }
          return { start: pos, end };
        }
        i++;
      }
      if (heredocState.pendingEnd > i) {
        return { start: pos, end: heredocState.pendingEnd };
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

    // Operator symbol: :+, :-, :*, :/, :%, :**, :<, :>, :<=, :>=, :==, :===,
    // :<=>, :!=, :=~, :!~, :&, :|, :^, :~, :<<, :>>, :[], :[]=, :-@, :+@, :`
    if (/[+\-*/%<>=!~&|^[`]/.test(nextChar)) {
      if (nextChar === '`') return { start: pos, end: pos + 2 };
      if (nextChar === '[') {
        let i = pos + 2;
        if (i < source.length && source[i] === ']') {
          i++;
          if (i < source.length && source[i] === '=') i++;
        }
        return { start: pos, end: i };
      }
      let i = pos + 2;
      while (i < source.length && /[+\-*/%<>=!~&|^@]/.test(source[i])) {
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

  // Matches regex literal with flags and #{} interpolation (including heredoc support)
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchRegexLiteral(
      source,
      pos,
      REGEX_FLAGS_PATTERN,
      (s, p) => {
        return skipInterpolationShared(s, p, this.interpolationHandlers, heredocState);
      },
      true
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Checks if slash is regex start (not division)
  private isRegexStart(source: string, pos: number): boolean {
    return isRegexStart(source, pos, REGEX_PRECEDING_KEYWORDS, this._lastExcludedRegion ?? undefined);
  }

  // Checks if position is inside the last excluded region
  private isPrevCharInLastRegion(charPos: number): boolean {
    return this._lastExcludedRegion !== null && charPos >= this._lastExcludedRegion.start && charPos < this._lastExcludedRegion.end;
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
    if (!/[a-zA-Z0-9_)\]}"'`/]/.test(source[i])) return false;
    // %<type><delimiter> is always a percent literal, even after identifiers
    // e.g. puts %w[a b], raise %q{error}
    const next = pos + 1;
    if (next < source.length && /[qQwWiIrxs]/.test(source[next]) && next + 1 < source.length && /[^a-zA-Z0-9_ \t]/.test(source[next + 1])) {
      return false;
    }
    // %<paired_delimiter> without specifier is a percent literal, not modulo
    // e.g. puts %{text}, raise %(message)
    if (next < source.length && '({[<'.includes(source[next])) {
      return false;
    }
    // %= is always compound assignment, not a percent literal
    if (next < source.length && source[next] === '=') {
      return true;
    }
    // Non-paired delimiter without specifier is also a percent literal
    // e.g. puts %|text|, %~text~
    // Exclude %% (double percent) — treat first % as modulo to avoid unterminated literals
    if (next < source.length && source[next] !== '%' && /[^a-zA-Z0-9_ \t\r\n]/.test(source[next])) {
      return false;
    }
    return true;
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchPercentLiteral(source, pos, PERCENT_SPECIFIERS_PATTERN, isRubyInterpolatingPercent, (s, p) =>
      skipInterpolationShared(s, p, this.interpolationHandlers, heredocState)
    );
    if (result && heredocState.pendingEnd > result.end) {
      return { end: heredocState.pendingEnd };
    }
    if (!result) return null;
    // For %r (percent regex), include trailing regex flags in excluded region
    const specifier = source[pos + 1];
    if (specifier === 'r') {
      let flagEnd = result.end;
      while (flagEnd < source.length && REGEX_FLAGS_PATTERN.test(source[flagEnd])) {
        flagEnd++;
      }
      if (flagEnd > result.end) {
        return { end: flagEnd };
      }
    }
    return result;
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchInterpolatedString(
      source,
      pos,
      (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState),
      heredocState
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Matches backtick string (command) with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchBacktickString(source, pos, (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState));
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  private get interpolationHandlers(): InterpolationHandlers {
    return {
      skipNestedString: (s, p) => this.skipNestedString(s, p),
      skipNestedBacktickString: (s, p) => this.skipNestedBacktickString(s, p),
      skipNestedRegex: (s, p) => this.skipNestedRegex(s, p),
      matchPercentLiteral: (s, p) => this.matchPercentLiteral(s, p),
      isModuloOperator: (s, p) => this.isModuloOperator(s, p),
      matchHeredoc: (s, p) => matchHeredoc(s, p)
    };
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    return skipInterpolationShared(source, pos, this.interpolationHandlers);
  }

  // Skips a regex literal inside interpolation (Ruby regexes can be multiline)
  private skipNestedRegex(source: string, pos: number): number {
    return skipNestedRegex(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipInterpolation(s, p), true);
  }

  // Skips a nested string inside interpolation
  private skipNestedString(source: string, pos: number): number {
    return skipNestedString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a backtick string inside interpolation (supports #{} interpolation)
  private skipNestedBacktickString(source: string, pos: number): number {
    return skipNestedBacktickString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }
}
