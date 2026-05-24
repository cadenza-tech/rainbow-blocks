// Shared helpers for Ruby and Crystal parsers (same language family)

import type { ExcludedRegion } from '../types';

// Callback type for skipping #{} interpolation content
type SkipInterpolationFn = (source: string, pos: number) => number;

// State for tracking pending heredoc end position across interpolation boundaries
export interface HeredocState {
  pendingEnd: number;
}

// Paired delimiters for percent literals and heredocs
const PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Characters that indicate the preceding / is division, not regex.
// Includes Unicode identifier-continue (Letter, Mark, Number, Connector Punctuation)
// so non-ASCII identifiers (e.g. `メソッド / 2`, `α / 2`) trigger division detection
// instead of being treated as regex starts. Surrogate-pair codepoints (e.g. mathematical
// bold letters) are handled by the explicit codepoint check in isDivisionPreceder below.
const DIVISION_PRECEDERS_PATTERN = /[a-zA-Z0-9_)\]}"'`$\p{L}\p{M}\p{N}\p{Pc}]/u;

// Unicode identifier-continue character class for surrogate-pair codepoint checks.
const UNICODE_IDENT_CONTINUE_PATTERN = /[\p{L}\p{M}\p{N}\p{Pc}]/u;

// Returns true when the character at index `pos` is a division-preceder. Handles
// surrogate pairs: when `source[pos]` is a low surrogate (U+DC00-U+DFFF) and is
// preceded by a high surrogate, combine the pair into a codepoint and test the
// codepoint against the Unicode identifier-continue class.
function isDivisionPreceder(source: string, pos: number): boolean {
  const ch = source[pos];
  if (DIVISION_PRECEDERS_PATTERN.test(ch)) return true;
  if (pos >= 1 && ch >= '\uDC00' && ch <= '\uDFFF') {
    const cp = source.codePointAt(pos - 1);
    if (cp !== undefined && cp > 0xffff) {
      return UNICODE_IDENT_CONTINUE_PATTERN.test(String.fromCodePoint(cp));
    }
  }
  return false;
}

// Closing bracket characters (reserved as paired-delimiter closers, never valid as openers)
const CLOSE_BRACKET_CHARS: ReadonlySet<string> = new Set([')', ']', '}', '>']);

// Returns the matching close delimiter for an open delimiter
function getMatchingDelimiter(open: string): string | null {
  if (open in PAIRED_DELIMITERS) {
    return PAIRED_DELIMITERS[open];
  }
  // Any non-alphanumeric, non-whitespace character can be its own delimiter,
  // except closing bracket characters which are reserved as paired-delimiter closers.
  if (CLOSE_BRACKET_CHARS.has(open)) return null;
  return /[^\sa-zA-Z0-9]/.test(open) ? open : null;
}

// Determines whether / at pos is a regex start (true) or division operator (false)
// lastExcludedRegion: the most recently found excluded region (for context-aware scanning)
// methodLikeKeywords: optional set of identifier-like keywords (e.g., `p`, `puts`, `raise`)
// that are method names rather than true control keywords. For these, `/` is treated as
// regex only when the method-call spacing rule applies (space before, no space after);
// otherwise it stays division (`puts / 2` is division, `puts /re/` is a regex argument).
export function isRegexStart(
  source: string,
  pos: number,
  regexPrecedingKeywords: ReadonlySet<string>,
  lastExcludedRegion?: ExcludedRegion,
  methodLikeKeywords?: ReadonlySet<string>
): boolean {
  if (pos === 0) return true;

  // Look back for context, skipping whitespace
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }

  if (i < 0) return true;

  // If backward scan lands inside the last excluded region, the region itself provides context
  if (lastExcludedRegion && i >= lastExcludedRegion.start && i < lastExcludedRegion.end) {
    // Comments are not value expressions: skip past and continue scanning
    if (source[lastExcludedRegion.start] === '#' || source.slice(lastExcludedRegion.start, lastExcludedRegion.start + 6) === '=begin') {
      i = lastExcludedRegion.start - 1;
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
        i--;
      }
      if (i < 0) return true;
      // Fall through to normal checks below
    } else {
      // Regex literal closing /: the next / may be either a new regex (`/r1/ /r2/`)
      // or a division operator (`/a/ / 2`). If our `/` is immediately followed by whitespace,
      // it is more likely division than the start of a new regex literal.
      if (source[lastExcludedRegion.start] === '/') {
        if (pos + 1 < source.length && (source[pos + 1] === ' ' || source[pos + 1] === '\t')) {
          return false;
        }
        i = lastExcludedRegion.start - 1;
        while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
          i--;
        }
        if (i < 0) return true;
        // Fall through to normal checks below
      } else {
        // Value expressions (strings, char literals, etc.): / is division
        return false;
      }
    }
  }

  // Check ? and ! - could be method name suffix or operator
  if (source[i] === '?' || source[i] === '!') {
    // If preceded by $, it's a special global variable ($? or $!), / is division
    if (i > 0 && source[i - 1] === '$') {
      return false;
    }
    // If preceded by a word character, it's a method name suffix (valid? / 2 = division)
    if (i > 0 && /[a-zA-Z0-9_]/.test(source[i - 1])) {
      return false;
    }
    // Otherwise, it's an operator (ternary ? or logical not !), / is regex start
    return true;
  }

  // After these characters, / is likely division
  if (!isDivisionPreceder(source, i)) {
    // If preceded by $, it's a special global variable ($~, $&, $+, etc.), / is division
    if (i > 0 && source[i - 1] === '$') {
      return false;
    }
    return true;
  }

  // After keywords, / is regex start (e.g., if /pattern/)
  if (/[a-zA-Z_]/.test(source[i])) {
    let wordStart = i;
    while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.substring(wordStart, i + 1);
    // True control keywords always force regex interpretation (e.g. `if /re/`).
    // Method-like identifiers (p, puts, raise, ...) skip this branch and fall through
    // to the spacing rule so that `p / 2` stays division.
    if (regexPrecedingKeywords.has(word) && !methodLikeKeywords?.has(word)) {
      return true;
    }
    // Method-call regex argument: `method /regex/`. When an identifier is
    // followed by whitespace, then /, then a non-whitespace character, the /
    // starts a regex literal passed as an argument (e.g. `str.match /re/`).
    // This matches the Ruby/Crystal disambiguation rule: `a / b` (spaces both
    // sides) stays division, `a /b` is a regex argument.
    if (i < pos - 1) {
      const after = source[pos + 1];
      if (after !== undefined && after !== ' ' && after !== '\t' && after !== '\n' && after !== '\r' && after !== '=') {
        return true;
      }
    }
  }

  return false;
}

// Matches a double-quoted interpolated string starting at pos
export function matchInterpolatedString(
  source: string,
  pos: number,
  skipInterpolation: SkipInterpolationFn,
  heredocState?: HeredocState
): ExcludedRegion {
  let i = pos + 1;
  let pendingHeredocEnd = -1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      // Track pending heredoc body to skip later
      if (heredocState && heredocState.pendingEnd > i) {
        pendingHeredocEnd = heredocState.pendingEnd;
        heredocState.pendingEnd = -1;
      }
      continue;
    }
    // Skip heredoc body: at newline, if a heredoc is pending, jump past it
    if (pendingHeredocEnd > i && (source[i] === '\n' || source[i] === '\r')) {
      i = pendingHeredocEnd;
      pendingHeredocEnd = -1;
      continue;
    }
    if (source[i] === '"') {
      // Propagate pending heredoc end back to heredocState so the caller can skip the body
      if (pendingHeredocEnd > i + 1 && heredocState) {
        heredocState.pendingEnd = pendingHeredocEnd;
      }
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
  allowMultiline: boolean,
  heredocState?: HeredocState
): ExcludedRegion {
  let i = pos + 1;
  let inCharClass = false;
  let pendingHeredocEnd = -1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation inside regex
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      // Track pending heredoc body to skip later
      if (heredocState && heredocState.pendingEnd > i) {
        pendingHeredocEnd = heredocState.pendingEnd;
        heredocState.pendingEnd = -1;
      }
      continue;
    }
    // Skip heredoc body: at newline, if a heredoc is pending, jump past it
    if (pendingHeredocEnd > i && (source[i] === '\n' || source[i] === '\r')) {
      i = pendingHeredocEnd;
      pendingHeredocEnd = -1;
      continue;
    }
    // Track character class brackets: [/] should not terminate regex
    if (source[i] === '[' && !inCharClass) {
      inCharClass = true;
      i++;
      continue;
    }
    if (source[i] === ']' && inCharClass) {
      inCharClass = false;
      i++;
      continue;
    }
    if (source[i] === '/' && !inCharClass) {
      i++;
      // Skip regex flags
      while (i < source.length && regexFlagsPattern.test(source[i])) {
        i++;
      }
      // Propagate pending heredoc end back to caller
      if (pendingHeredocEnd > i && heredocState) {
        heredocState.pendingEnd = pendingHeredocEnd;
      }
      return { start: pos, end: i };
    }
    if (!allowMultiline && (source[i] === '\n' || source[i] === '\r')) {
      // Unterminated regex
      if (pendingHeredocEnd > i && heredocState) {
        heredocState.pendingEnd = pendingHeredocEnd;
      }
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
  let inCharClass = false;
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
    // Track character class brackets: [/] should not terminate regex
    if (source[i] === '[' && !inCharClass) {
      inCharClass = true;
      i++;
      continue;
    }
    if (source[i] === ']' && inCharClass) {
      inCharClass = false;
      i++;
      continue;
    }
    if (source[i] === '/' && !inCharClass) {
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

  // When backslash is the delimiter, it cannot also serve as an escape character
  const escapeEnabled = closeDelimiter !== '\\';

  while (i < source.length && depth > 0) {
    if (escapeEnabled && source[i] === '\\' && i + 1 < source.length) {
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

// Interface for interpolation handler callbacks
export interface InterpolationHandlers {
  skipNestedString: (source: string, pos: number) => number;
  skipNestedBacktickString: (source: string, pos: number) => number;
  skipNestedRegex: (source: string, pos: number) => number;
  matchPercentLiteral: (source: string, pos: number) => { end: number } | null;
  isModuloOperator: (source: string, pos: number) => boolean;
  matchHeredoc: (source: string, pos: number) => { contentStart: number; end: number } | null;
}

// Check if / starts a regex (not division) inside interpolation
function isRegexInInterpolation(source: string, pos: number, interpStart: number): boolean {
  if (pos === interpStart) return true;
  let j = pos - 1;
  while (j >= interpStart && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j < interpStart) return true;
  return /[(,=!~|&{[:;+\-*%<>^?]/.test(source[j]);
}

// Shared skip logic for #{} interpolation in strings (with heredoc support)
export function skipInterpolationShared(source: string, pos: number, handlers: InterpolationHandlers, heredocState?: HeredocState): number {
  let depth = 1;
  let i = pos;
  let heredocSkipEnd = -1;
  while (i < source.length && depth > 0) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Character literal: ?', ?", ?`, ?{, ?}, ?#, ?/, ?%, ?<
    if (
      (source[i] === "'" ||
        source[i] === '"' ||
        source[i] === '`' ||
        source[i] === '{' ||
        source[i] === '}' ||
        source[i] === '#' ||
        source[i] === '/' ||
        source[i] === '%' ||
        source[i] === '<') &&
      i > pos &&
      source[i - 1] === '?' &&
      (i - 1 === pos || !/\w/.test(source[i - 2]))
    ) {
      i++;
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
      i = handlers.skipNestedString(source, i);
      continue;
    } else if (source[i] === "'") {
      i = handlers.skipNestedString(source, i);
      continue;
    } else if (source[i] === '`') {
      i = handlers.skipNestedBacktickString(source, i);
      continue;
    } else if (source[i] === '/' && isRegexInInterpolation(source, i, pos)) {
      i = handlers.skipNestedRegex(source, i);
      continue;
    } else if (source[i] === '%' && i + 1 < source.length && source[i + 1] !== '}' && !handlers.isModuloOperator(source, i)) {
      const result = handlers.matchPercentLiteral(source, i);
      if (result) {
        i = result.end;
        continue;
      }
    } else if (source[i] === '<' && i + 1 < source.length && source[i + 1] === '<' && heredocSkipEnd < 0) {
      const heredocResult = handlers.matchHeredoc(source, i);
      if (heredocResult) {
        heredocSkipEnd = heredocResult.end;
      }
    }
    i++;
  }
  // Communicate pending heredoc to caller when interpolation closes before line break
  if (heredocSkipEnd > i && heredocState) {
    heredocState.pendingEnd = Math.max(heredocState.pendingEnd, heredocSkipEnd);
  }
  return i;
}

// Shared skip logic for #{} interpolation in regex
export function skipRegexInterpolationShared(source: string, pos: number, handlers: InterpolationHandlers, heredocState?: HeredocState): number {
  let depth = 1;
  let i = pos;
  let heredocSkipEnd = -1;
  while (i < source.length && depth > 0) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Character literal: ?', ?", ?`, ?{, ?}, ?#, ?/, ?%, ?<
    if (
      (source[i] === "'" ||
        source[i] === '"' ||
        source[i] === '`' ||
        source[i] === '{' ||
        source[i] === '}' ||
        source[i] === '#' ||
        source[i] === '/' ||
        source[i] === '%' ||
        source[i] === '<') &&
      i > pos &&
      source[i - 1] === '?' &&
      (i - 1 === pos || !/\w/.test(source[i - 2]))
    ) {
      i++;
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
      i = handlers.skipNestedString(source, i);
      continue;
    } else if (source[i] === "'") {
      i = handlers.skipNestedString(source, i);
      continue;
    } else if (source[i] === '`') {
      i = handlers.skipNestedBacktickString(source, i);
      continue;
    } else if (source[i] === '/' && isRegexInInterpolation(source, i, pos)) {
      i = handlers.skipNestedRegex(source, i);
      continue;
    } else if (source[i] === '%' && i + 1 < source.length && source[i + 1] !== '}' && !handlers.isModuloOperator(source, i)) {
      const result = handlers.matchPercentLiteral(source, i);
      if (result) {
        i = result.end;
        continue;
      }
    } else if (source[i] === '<' && i + 1 < source.length && source[i + 1] === '<' && heredocSkipEnd < 0) {
      const heredocResult = handlers.matchHeredoc(source, i);
      if (heredocResult) {
        heredocSkipEnd = heredocResult.end;
      }
    }
    i++;
  }
  // Communicate pending heredoc to caller when interpolation closes before line break
  if (heredocSkipEnd > i && heredocState) {
    heredocState.pendingEnd = Math.max(heredocState.pendingEnd, heredocSkipEnd);
  }
  return i;
}
