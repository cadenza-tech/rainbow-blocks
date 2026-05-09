// Standalone helper functions for Ada parser (no class dependency)

import type { ExcludedRegion } from '../types';

// Whitespace characters recognized by the Ada parser. Covers Ada LRM 2.1
// format_effector (HT, VT, FF, CR, LF, NEL) and the Unicode Zs category
// (NBSP, U+1680, U+2000-200A, U+202F, U+205F, U+3000), plus Unicode line
// and paragraph separators (LS U+2028, PS U+2029). Kept in sync with the
// separator class in COMPOUND_END_PATTERN (adaParser.ts).
export function isAdaWhitespace(ch: string): boolean {
  if (ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f' || ch === '\r' || ch === '\n') return true;
  const code = ch.charCodeAt(0);
  if (code === 0x0085 || code === 0x00a0 || code === 0x1680) return true;
  if (code >= 0x2000 && code <= 0x200a) return true;
  if (code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000) return true;
  return false;
}

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
    // Character literals cannot span lines - reject if character between ticks is a newline
    const innerChar = source[pos + 1];
    if (pos + 1 + charLen < source.length && source[pos + 1 + charLen] === "'" && innerChar !== '\n' && innerChar !== '\r') {
      // Qualified expression: type_name'(expr) -- tick before '(' preceded by identifier
      // is not a character literal, treat as attribute tick
      if (source[pos + 1] === '(' && pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) {
        return { start: pos, end: pos + 1 };
      }
      // Character literal containing single quote: '''' (four single quotes)
      if (source[pos + 1] === "'" && pos + 3 < source.length && source[pos + 3] === "'") {
        return { start: pos, end: pos + 4 };
      }
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
// (ASCII identifier chars + non-ASCII Unicode letters are treated as word chars).
export function isAdaWordAt(source: string, pos: number, word: string): boolean {
  if (source.slice(pos, pos + word.length).toLowerCase() !== word) return false;
  const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch) || ch.charCodeAt(0) > 127;
  if (pos > 0 && isWordChar(source[pos - 1])) return false;
  if (pos + word.length < source.length && isWordChar(source[pos + word.length])) return false;
  return true;
}

// Checks if source between 'or' end and 'else' start contains only whitespace and comments
// If true, it's the 'or else' short-circuit operator; if false, they are separate tokens
export function isOrElseShortCircuit(source: string, orEnd: number, elseStart: number, isInExcluded: (pos: number) => boolean): boolean {
  for (let i = orEnd; i < elseStart; i++) {
    if (isInExcluded(i)) continue;
    const ch = source[i];
    if (isAdaWhitespace(ch)) continue;
    // Ada comment starts with '--', skip to end of line
    if (ch === '-' && i + 1 < source.length && source[i + 1] === '-') {
      while (i < elseStart && source[i] !== '\n' && source[i] !== '\r') i++;
      continue;
    }
    return false;
  }
  return true;
}

// Scan forward from startPos tracking parens, looking for 'is' keyword
// Returns position of 'is' if found, or -1 if ';' or a reject keyword is found first (or end of source)
export function scanForwardToIs(
  source: string,
  startPos: number,
  isInExcluded: (pos: number) => boolean,
  rejectKeywords?: readonly string[]
): number {
  let j = startPos;
  let parenDepth = 0;
  while (j < source.length) {
    if (isInExcluded(j)) {
      j++;
      continue;
    }
    if (source[j] === '(') parenDepth++;
    else if (source[j] === ')') parenDepth--;
    else if (parenDepth === 0) {
      if (source[j] === ';') return -1;
      if (rejectKeywords) {
        for (const rk of rejectKeywords) {
          if (isAdaWordAt(source, j, rk)) return -1;
        }
      }
      if (isAdaWordAt(source, j, 'is')) return j;
    }
    j++;
  }
  return -1;
}

// Skips whitespace and comments starting from the given position
// Returns the position of the first non-whitespace, non-comment character
export function skipAdaWhitespaceAndComments(source: string, pos: number): number {
  let k = pos;
  while (k < source.length) {
    if (isAdaWhitespace(source[k])) {
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
