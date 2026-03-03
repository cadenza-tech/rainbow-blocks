// Standalone helper functions for Ada parser (no class dependency)

import type { ExcludedRegion } from '../types';

// Matches an Ada double-quoted string with "" escape sequences
// Ada strings cannot span multiple lines
export function matchAdaString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '"') {
      // Check for doubled quote escape ""
      if (i + 1 < source.length && source[i + 1] === '"') {
        i += 2;
        continue;
      }
      return { start: pos, end: i + 1 };
    }
    // String cannot span multiple lines in Ada
    if (source[i] === '\n' || source[i] === '\r') {
      return { start: pos, end: i };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches a character literal ('x') or attribute tick ('Name)
// Handles surrogate pairs (codepoints > U+FFFF use 2 UTF-16 code units)
export function matchCharacterLiteral(source: string, pos: number): ExcludedRegion {
  // Character literal is 'x' where x is a single character
  // It could also be an attribute tick, so we need to be careful
  // Handle surrogate pairs (codepoints > U+FFFF use 2 UTF-16 code units)
  if (pos + 1 < source.length) {
    const codePoint = source.codePointAt(pos + 1);
    const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    if (pos + 1 + charLen < source.length && source[pos + 1 + charLen] === "'") {
      return { start: pos, end: pos + 1 + charLen + 1 };
    }
  }
  // Attribute tick: skip the attribute name to avoid matching keywords
  let i = pos + 1;
  while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
    i++;
  }
  return { start: pos, end: i };
}

// Checks if a given word appears at the given position with word boundaries
export function isAdaWordAt(source: string, pos: number, word: string): boolean {
  if (source.slice(pos, pos + word.length).toLowerCase() !== word) return false;
  if (pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) return false;
  if (pos + word.length < source.length && /[a-zA-Z0-9_]/.test(source[pos + word.length])) return false;
  return true;
}

// Skips whitespace and comments starting from the given position
// Returns the position of the first non-whitespace, non-comment character
export function skipAdaWhitespaceAndComments(source: string, pos: number): number {
  let k = pos;
  while (k < source.length) {
    if (source[k] === ' ' || source[k] === '\t' || source[k] === '\r' || source[k] === '\n') {
      k++;
      continue;
    }
    if (k + 1 < source.length && source[k] === '-' && source[k + 1] === '-') {
      k += 2;
      while (k < source.length && source[k] !== '\n' && source[k] !== '\r') {
        k++;
      }
      continue;
    }
    break;
  }
  return k;
}
