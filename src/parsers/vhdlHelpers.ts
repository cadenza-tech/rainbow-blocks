// Standalone helper functions for VHDL parser (no class dependency)

import type { ExcludedRegion } from '../types';

// Matches block comment: /* ... */ (VHDL-2008)
export function matchVhdlBlockComment(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;

  while (i < source.length) {
    if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
      return { start: pos, end: i + 2 };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches VHDL string: "..." with doubled quote escape ""
// VHDL strings cannot span multiple lines
export function matchVhdlString(source: string, pos: number): ExcludedRegion {
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
    // String cannot span multiple lines in VHDL
    if (source[i] === '\n' || source[i] === '\r') {
      return { start: pos, end: i };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches character literal: 'x' (single character only)
// Handles qualified expressions, character literal containing single quote, and attribute ticks
export function matchVhdlCharacterLiteral(source: string, pos: number): ExcludedRegion {
  // Character literal is 'x' where x is a single character
  // It could also be an attribute tick, so we need to be careful
  // Handle surrogate pairs (codepoints > U+FFFF use 2 UTF-16 code units)
  if (pos + 1 >= source.length) return { start: pos, end: pos + 1 };
  const codePoint = source.codePointAt(pos + 1);
  const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  const innerChar = source[pos + 1];
  if (pos + 1 + charLen < source.length && source[pos + 1 + charLen] === "'" && innerChar !== '\n' && innerChar !== '\r') {
    // Qualified expression: type_name'(expr) — tick before '(' preceded by identifier
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
  // Attribute tick: skip the attribute name to avoid matching keywords
  let i = pos + 1;
  while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
    i++;
  }
  return { start: pos, end: i };
}
