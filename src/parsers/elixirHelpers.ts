// Elixir string, sigil, atom, and interpolation matching helpers

import type { ExcludedRegion } from '../types';

// Callback type for skipping #{} interpolation content
type SkipInterpolationFn = (source: string, pos: number) => number;

// Sigil delimiter pairs
const SIGIL_PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Returns matching close delimiter for sigils
function getSigilCloseDelimiter(open: string): string | null {
  if (open in SIGIL_PAIRED_DELIMITERS) {
    return SIGIL_PAIRED_DELIMITERS[open];
  }

  // Non-paired delimiters (/, |, ", ', etc)
  if (/[^a-zA-Z0-9\s]/.test(open)) {
    return open;
  }

  return null;
}

// Checks if colon starts an atom (not keyword list key)
export function isAtomStart(source: string, pos: number): boolean {
  const nextChar = source[pos + 1];
  if (!nextChar) {
    return false;
  }

  // Atom must start with letter, underscore, or quote
  if (!/[a-zA-Z_"']/.test(nextChar)) {
    return false;
  }

  // Colon after identifier/number/closing bracket is not an atom (keyword list key)
  // Note: > is excluded from check because x>:atom is a valid comparison with atom
  // Includes ? and ! since Elixir identifiers can end with them (e.g., ok?: true)
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (/[a-zA-Z0-9_)\]}?!]/.test(prevChar)) {
      return false;
    }
  }

  return true;
}

// Matches atom literal: :atom, :"quoted", :'quoted'
export function matchAtomLiteral(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  const nextChar = source[pos + 1];

  // Quoted atom
  if (nextChar === '"' || nextChar === "'") {
    const quote = nextChar;
    let i = pos + 2;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation in quoted atoms
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i += 2;
        i = skipInterpolation(source, i);
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Simple atom
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

// Matches Elixir double-quoted string with #{} interpolation
export function matchElixirString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
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

// Matches Elixir single-quoted charlist with #{} interpolation
export function matchElixirCharlist(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
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
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Checks if position is at line start allowing leading whitespace
function isAtLineStartAllowingWhitespace(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  return i < 0 || source[i] === '\n' || source[i] === '\r';
}

// Matches triple-quoted string (heredoc) with #{} interpolation for """ and '''
export function matchTripleQuotedString(source: string, pos: number, delimiter: string, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  // Both """ and ''' support interpolation in Elixir
  let i = pos + 3;
  // Track whether we've passed a newline (heredoc mode vs single-line triple quote)
  let isHeredoc = false;
  while (i < source.length) {
    if (source[i] === '\n' || source[i] === '\r') {
      isHeredoc = true;
    }
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation in """ and ''' heredocs
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source.slice(i, i + 3) === delimiter && (!isHeredoc || isAtLineStartAllowingWhitespace(source, i))) {
      return { start: pos, end: i + 3 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Skips a triple-quoted string (heredoc) inside interpolation, handling escapes and nested interpolation
export function skipNestedTripleQuotedString(source: string, pos: number, delimiter: string, skipInterpolation: SkipInterpolationFn): number {
  let i = pos + 3;
  let isHeredoc = false;
  while (i < source.length) {
    if (source[i] === '\n' || source[i] === '\r') {
      isHeredoc = true;
    }
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source.slice(i, i + 3) === delimiter && (!isHeredoc || isAtLineStartAllowingWhitespace(source, i))) {
      return i + 3;
    }
    i++;
  }
  return i;
}

// Skips a nested string inside interpolation
export function skipNestedString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): number {
  const quote = source[pos];
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
    if (source[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Skips a sigil inside interpolation, returning position after it
export function skipNestedSigil(source: string, pos: number, skipInterpolation: SkipInterpolationFn): number {
  // pos points to '~', pos+1 is the sigil letter
  const sigilChar = source[pos + 1];
  const isLowercase = /[a-z]/.test(sigilChar);

  // Skip past sigil letter(s) to find delimiter
  // Only uppercase sigils (custom sigils) allow multi-character names
  let delimiterPos = pos + 2;
  if (/[A-Z]/.test(sigilChar)) {
    while (delimiterPos < source.length && /[a-zA-Z]/.test(source[delimiterPos])) {
      delimiterPos++;
    }
  }

  if (delimiterPos >= source.length) {
    return pos;
  }

  const openDelimiter = source[delimiterPos];
  const closeDelimiter = getSigilCloseDelimiter(openDelimiter);

  if (!closeDelimiter) {
    return pos;
  }

  // Check for heredoc-style triple-quote delimiter (~s""", ~s''', ~S""", ~S''')
  if (
    (openDelimiter === '"' || openDelimiter === "'") &&
    delimiterPos + 2 < source.length &&
    source[delimiterPos + 1] === openDelimiter &&
    source[delimiterPos + 2] === openDelimiter
  ) {
    const tripleDelim = openDelimiter.repeat(3);
    let j = delimiterPos + 3;
    let isHeredoc = false;
    while (j < source.length) {
      if (source[j] === '\n' || source[j] === '\r') {
        isHeredoc = true;
      }
      if (isLowercase && source[j] === '\\' && j + 1 < source.length) {
        j += 2;
        continue;
      }
      if (isLowercase && source[j] === '#' && j + 1 < source.length && source[j + 1] === '{') {
        j = skipInterpolation(source, j + 2);
        continue;
      }
      if (source.slice(j, j + 3) === tripleDelim && (!isHeredoc || isAtLineStartAllowingWhitespace(source, j))) {
        j += 3;
        // Skip optional modifiers
        while (j < source.length && /[a-zA-Z]/.test(source[j])) {
          j++;
        }
        return j;
      }
      j++;
    }
    return j;
  }

  let i = delimiterPos + 1;
  let depth = 1;
  const isPaired = openDelimiter !== closeDelimiter;

  while (i < source.length && depth > 0) {
    if (isLowercase && source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation inside lowercase sigils
    if (isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
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

  // Skip optional modifiers
  while (i < source.length && /[a-zA-Z]/.test(source[i])) {
    i++;
  }

  return i;
}

// Matches sigil (~r/.../, ~s(...), ~w[...], etc)
export function matchSigil(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion | null {
  const nextChar = source[pos + 1];

  // Must be a valid sigil specifier (letter)
  if (!/[a-zA-Z]/.test(nextChar)) {
    return null;
  }

  // Find delimiter position (skip additional letters only for uppercase/custom sigils)
  // Lowercase sigils are always single-letter (r, s, w, c, etc.)
  let delimiterPos = pos + 2;
  if (/[A-Z]/.test(nextChar)) {
    while (delimiterPos < source.length && /[a-zA-Z]/.test(source[delimiterPos])) {
      delimiterPos++;
    }
  }

  if (delimiterPos >= source.length) {
    return null;
  }

  const openDelimiter = source[delimiterPos];
  const closeDelimiter = getSigilCloseDelimiter(openDelimiter);

  if (!closeDelimiter) {
    return null;
  }

  // Check for heredoc-style sigil (~S""")
  if (source.slice(delimiterPos, delimiterPos + 3) === '"""' || source.slice(delimiterPos, delimiterPos + 3) === "'''") {
    const tripleDelim = source.slice(delimiterPos, delimiterPos + 3);
    const isLowercase = /[a-z]/.test(nextChar);
    let i = delimiterPos + 3;
    let isSigilHeredoc = false;
    while (i < source.length) {
      if (source[i] === '\n' || source[i] === '\r') {
        isSigilHeredoc = true;
      }
      // Handle escape sequences for lowercase sigils
      if (isLowercase && source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation for lowercase sigils
      if (isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = skipInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === tripleDelim && (!isSigilHeredoc || isAtLineStartAllowingWhitespace(source, i))) {
        // Skip optional modifiers after closing
        let end = i + 3;
        while (end < source.length && /[a-zA-Z]/.test(source[end])) {
          end++;
        }
        return { start: pos, end };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  let i = delimiterPos + 1;
  let depth = 1;
  const isPaired = openDelimiter !== closeDelimiter;
  const isLowercase = /[a-z]/.test(nextChar);

  while (i < source.length && depth > 0) {
    // Handle escape sequences for lowercase sigils
    if (isLowercase && source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation for lowercase sigils
    if (isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
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

  // Skip optional modifiers after closing delimiter
  while (i < source.length && /[a-zA-Z]/.test(source[i])) {
    i++;
  }

  return { start: pos, end: i };
}
