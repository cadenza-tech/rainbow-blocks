// Shared helpers for Ruby and Crystal parsers (same language family)

import type { ExcludedRegion } from '../types';

// Callback type for skipping #{} interpolation content
type SkipInterpolationFn = (source: string, pos: number) => number;

// Paired delimiters for percent literals and heredocs
const PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Characters that indicate the preceding / is division, not regex
const DIVISION_PRECEDERS_PATTERN = /[a-zA-Z0-9_)\]}"'`]/;

// Returns the matching close delimiter for an open delimiter
export function getMatchingDelimiter(open: string): string | null {
  if (open in PAIRED_DELIMITERS) {
    return PAIRED_DELIMITERS[open];
  }
  // Any non-alphanumeric, non-whitespace character can be its own delimiter
  return /[^\sa-zA-Z0-9]/.test(open) ? open : null;
}

// Determines whether / at pos is a regex start (true) or division operator (false)
export function isRegexStart(source: string, pos: number, regexPrecedingKeywords: ReadonlySet<string>): boolean {
  if (pos === 0) return true;

  // Look back for context, skipping whitespace
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }

  if (i < 0) return true;

  // Check ? and ! - could be method name suffix or operator
  if (source[i] === '?' || source[i] === '!') {
    // If preceded by a word character, it's a method name suffix (valid? / 2 = division)
    if (i > 0 && /[a-zA-Z0-9_]/.test(source[i - 1])) {
      return false;
    }
    // Otherwise, it's an operator (ternary ? or logical not !), / is regex start
    return true;
  }

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
    if (regexPrecedingKeywords.has(word)) {
      return true;
    }
  }

  return false;
}

// Matches a double-quoted interpolated string starting at pos
export function matchInterpolatedString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '"') {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Matches a backtick command string starting at pos
export function matchBacktickString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '`') {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Matches a regex literal /.../ starting at pos
// Ruby allows multiline regex; Crystal does not
export function matchRegexLiteral(
  source: string,
  pos: number,
  regexFlagsPattern: RegExp,
  skipInterpolation: SkipInterpolationFn,
  allowMultiline: boolean
): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation inside regex
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '/') {
      i++;
      // Skip regex flags
      while (i < source.length && regexFlagsPattern.test(source[i])) {
        i++;
      }
      return { start: pos, end: i };
    }
    if (!allowMultiline && (source[i] === '\n' || source[i] === '\r')) {
      // Unterminated regex
      return { start: pos, end: i };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Skips a nested string literal inside interpolation
export function skipNestedString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): number {
  const quote = source[pos];
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{' && quote === '"') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Skips a nested regex literal inside interpolation
// allowMultiline: true for Ruby (regexes can span lines), false for Crystal (single-line only)
export function skipNestedRegex(
  source: string,
  pos: number,
  regexFlagsPattern: RegExp,
  skipInterpolation: SkipInterpolationFn,
  allowMultiline = false
): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} inside regex
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '/') {
      i++;
      // Skip regex flags
      while (i < source.length && regexFlagsPattern.test(source[i])) {
        i++;
      }
      return i;
    }
    if (!allowMultiline && (source[i] === '\n' || source[i] === '\r')) {
      return i;
    }
    i++;
  }
  return i;
}

// Skips a nested backtick command string inside interpolation
export function skipNestedBacktickString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '`') {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Matches a percent literal (%w[], %q{}, etc.) starting at pos
export function matchPercentLiteral(
  source: string,
  pos: number,
  percentSpecifiersPattern: RegExp,
  isInterpolating: (specifier: string, hasSpecifier: boolean) => boolean,
  skipInterpolation: SkipInterpolationFn
): { end: number } | null {
  const specifier = source[pos + 1];

  let delimiterPos = pos + 1;
  const hasSpecifier = percentSpecifiersPattern.test(specifier);
  if (hasSpecifier) {
    delimiterPos = pos + 2;
  }

  if (delimiterPos >= source.length) return null;

  const openDelimiter = source[delimiterPos];
  const closeDelimiter = getMatchingDelimiter(openDelimiter);

  if (!closeDelimiter) return null;

  const interpolating = isInterpolating(specifier, hasSpecifier);

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
      i = skipInterpolation(source, i + 2);
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
