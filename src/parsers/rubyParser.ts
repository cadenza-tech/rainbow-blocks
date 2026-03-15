// Ruby block parser: handles heredocs, percent literals, regex, symbols, and postfix conditionals

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
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
  skipNestedString,
  skipRegexInterpolationShared
} from './rubyFamilyHelpers';

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

  // Validates block open keywords, excluding postfix conditionals
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj.begin)
    // But allow range operator (..) — x..end is valid
    if (position > 0 && source[position - 1] === '.' && !(position > 1 && source[position - 2] === '.')) {
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
      // Filter out keywords in heredoc identifiers (<<end, <<-do, <<~if, <<'end', <<"do", etc.)
      // Only filter when the << is actually a heredoc (excluded region starts after opener line), not a shift operator
      if (token.startOffset >= 2) {
        const prefixStart = Math.max(0, token.startOffset - 4);
        const prefix = source.slice(prefixStart, token.startOffset);
        if (/<<[~-]?\\?['"`]?$/.test(prefix)) {
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
      // Filter out dot-preceded tokens (method calls like obj.end, obj.class)
      // But allow range operator (..) — x..end is valid
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.' && !(token.startOffset > 1 && source[token.startOffset - 2] === '.')) {
        return false;
      }
      // Filter out :: scope resolution (e.g., Module::Class::Begin)
      if (token.startOffset > 1 && source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':') {
        return false;
      }
      // Filter out keywords preceded by $ or @ (variable names like $end, @end, @@end)
      if (token.startOffset > 0 && (source[token.startOffset - 1] === '$' || source[token.startOffset - 1] === '@')) {
        return false;
      }
      // Filter out tokens immediately followed by colon (hash key syntax)
      if (source[token.endOffset] === ':') {
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

  // Checks if 'rescue' is used as a postfix modifier (e.g., risky rescue nil)
  // Find the start of a logical line, following backslash line continuations
  private findLogicalLineStart(source: string, position: number, excludedRegions?: ExcludedRegion[]): number {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    // Check if previous line ends with backslash continuation
    while (lineStart >= 2) {
      const prevChar = source[lineStart - 1];
      // Previous line must end with \n or \r
      if (prevChar !== '\n' && prevChar !== '\r') break;
      // Find the end of the line before the newline
      let checkPos = lineStart - 1;
      // Skip \r\n pair
      if (prevChar === '\n' && checkPos > 0 && source[checkPos - 1] === '\r') {
        checkPos--;
      }
      // Check if line ends with backslash (count consecutive backslashes for even/odd check)
      if (checkPos > 0 && source[checkPos - 1] === '\\') {
        // Count consecutive backslashes before newline
        let bsCount = 0;
        let bsPos = checkPos - 1;
        while (bsPos >= 0 && source[bsPos] === '\\') {
          bsCount++;
          bsPos--;
        }
        // Even number of backslashes means they are all escaped (not continuation)
        if (bsCount % 2 === 0) {
          break;
        }
        // Skip if the backslash is inside an excluded region (e.g., comment ending with \)
        if (excludedRegions && this.isInExcludedRegion(checkPos - 1, excludedRegions)) {
          break;
        }
        // Go to start of previous line
        let prevLineStart = checkPos - 1;
        while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
          prevLineStart--;
        }
        lineStart = prevLineStart;
      } else {
        break;
      }
    }
    return lineStart;
  }

  private isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineStart = this.findLogicalLineStart(source, position, excludedRegions);
    // Find last semicolon in original source (not after replace) to avoid index mapping errors
    let lastSemicolonPos = -1;
    for (let i = position - 1; i >= lineStart; i--) {
      if (source[i] === ';' && !this.isInExcludedRegion(i, excludedRegions)) {
        lastSemicolonPos = i;
        break;
      }
    }
    const sliceStart = lastSemicolonPos >= 0 ? lastSemicolonPos + 1 : lineStart;
    // Strip backslash continuation sequences so they don't affect keyword detection
    let before = source.slice(sliceStart, position).replace(/\\\r?\n|\\\r/g, ' ');
    before = before.trim();
    if (before.length === 0) return false;
    const blockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in', 'not', 'and', 'or'];
    const normalizedRescueBefore = before.replace(/[ \t]+/g, ' ');
    for (const kw of blockKeywords) {
      if (normalizedRescueBefore === kw || normalizedRescueBefore.endsWith(` ${kw}`)) {
        return false;
      }
    }
    return true;
  }

  // Checks if a conditional is postfix (e.g., "return value if condition")
  private isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find logical line start (following backslash continuations)
    const lineStart = this.findLogicalLineStart(source, position, excludedRegions);

    // Find last semicolon in original source (not after replace) to avoid index mapping errors
    let lastSemicolonPos = -1;
    for (let i = position - 1; i >= lineStart; i--) {
      if (source[i] === ';' && !this.isInExcludedRegion(i, excludedRegions)) {
        lastSemicolonPos = i;
        break;
      }
    }

    const sliceStart = lastSemicolonPos >= 0 ? lastSemicolonPos + 1 : lineStart;
    // Strip backslash continuation sequences so they don't affect keyword detection
    let beforeKeyword = source.slice(sliceStart, position).replace(/\\\r?\n|\\\r/g, ' ');
    beforeKeyword = beforeKeyword.trim();

    // No content before keyword means not postfix
    if (beforeKeyword.length === 0) {
      return false;
    }

    // Block keyword before means not postfix
    const precedingBlockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in', 'not', 'and', 'or'];

    const normalizedBefore = beforeKeyword.replace(/[ \t]+/g, ' ');
    for (const kw of precedingBlockKeywords) {
      if (normalizedBefore === kw || normalizedBefore.endsWith(` ${kw}`)) {
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
      // If the last character before keyword is inside an excluded region
      // (e.g., closing / of a regex literal), it's a complete expression, not an operator
      let checkPos = position - 1;
      while (checkPos >= lineStart && (source[checkPos] === ' ' || source[checkPos] === '\t')) {
        checkPos--;
      }
      if (checkPos >= lineStart && this.isInExcludedRegion(checkPos, excludedRegions)) {
        return true;
      }
      return false;
    }

    // Non-keyword content before means postfix
    return true;
  }

  // Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
  private isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find logical line start (following backslash continuations)
    const lineStart = this.findLogicalLineStart(source, position, excludedRegions);

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

      // Reject loop keywords preceded by dot (method calls like obj.while),
      // :: (scope resolution), @ or $ (variable prefixes)
      if (loopAbsolutePos > 0) {
        const prevChar = source[loopAbsolutePos - 1];
        if (prevChar === '$' || prevChar === '@') {
          continue;
        }
        if (prevChar === ':' && loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === ':') {
          continue;
        }
        if (prevChar === '.' && !(loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === '.')) {
          continue;
        }
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
      if (pos === 0 || !/[a-zA-Z0-9_)\]}]/.test(source[pos - 1])) {
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

  // Matches regex literal with flags and #{} interpolation
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    return matchRegexLiteral(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipRegexInterpolation(s, p), true);
  }

  // Skips #{} interpolation inside regex, tracking brace depth
  private skipRegexInterpolation(source: string, pos: number): number {
    return skipRegexInterpolationShared(source, pos, this.interpolationHandlers);
  }

  // Checks if slash is regex start (not division)
  private isRegexStart(source: string, pos: number): boolean {
    return isRegexStart(source, pos, REGEX_PRECEDING_KEYWORDS);
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
    if (next < source.length && /[^a-zA-Z0-9_ \t\r\n]/.test(source[next])) {
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
    return result;
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchInterpolatedString(source, pos, (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState));
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
