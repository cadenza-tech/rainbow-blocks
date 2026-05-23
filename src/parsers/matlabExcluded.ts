// MATLAB excluded-region matchers: block comments, single/double-quoted strings

import type { ExcludedRegion } from '../types';
import { isAtLineStartWithWhitespace } from './matlabHelpers';

// Checks if %{ is alone on the line (no trailing non-whitespace content).
// Treats space, tab, vertical tab (\v = \x0B), and form feed (\f = \x0C) as whitespace.
export function isBlockCommentStart(source: string, pos: number): boolean {
  let i = pos + 2;
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\v' && ch !== '\f') {
      return false;
    }
    i++;
  }
  return true;
}

// Matches block comment: %{ ... %} with nesting support
export function matchBlockComment(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  let depth = 1;

  while (i < source.length) {
    // Look for nested %{ at the start of a line
    if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '{') {
      if (isAtLineStartWithWhitespace(source, i) && isBlockCommentStart(source, i)) {
        depth++;
        i += 2;
        continue;
      }
    }
    // Look for %} at the start of a line (allowing leading whitespace, no trailing content)
    if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
      if (isAtLineStartWithWhitespace(source, i)) {
        // Verify no trailing content after %} (whitespace includes space, tab, \v, \f)
        let trailingPos = i + 2;
        let hasTrailingContent = false;
        while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
          const tch = source[trailingPos];
          if (tch !== ' ' && tch !== '\t' && tch !== '\v' && tch !== '\f') {
            hasTrailingContent = true;
            break;
          }
          trailingPos++;
        }
        if (!hasTrailingContent) {
          depth--;
          if (depth === 0) {
            let lineEnd = i + 2;
            while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
              lineEnd++;
            }
            return { start: pos, end: lineEnd };
          }
          i += 2;
          continue;
        }
      }
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches MATLAB string: '...' with '' as escape
export function matchMatlabString(source: string, pos: number): ExcludedRegion {
  // Check if this is a transpose operator (after identifier, number, ], }, or .)
  if (pos > 0) {
    const prevChar = source[pos - 1];
    // Handle surrogate pairs: low surrogate preceded by high surrogate
    const isSurrogatePairLetter =
      pos >= 2 &&
      prevChar >= '\uDC00' &&
      prevChar <= '\uDFFF' &&
      (() => {
        const cp = source.codePointAt(pos - 2);
        return cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp));
      })();
    if (/[a-zA-Z0-9_)\]}.'"]/.test(prevChar) || /\p{L}/u.test(prevChar) || isSurrogatePairLetter) {
      // This `'` sits in a transpose position (it follows a value-like character).
      // The transpose operator cannot be validly followed by an identifier character
      // (letter or `_`): in that case the `'` actually begins a string literal, e.g.
      // `disp'end'` is `disp` followed by the string `'end'`, and `[1'text']` is
      // `1` followed by `'text'`. So fall through to string matching when the next
      // character is an identifier char; otherwise treat it as transpose. `A''`
      // (double transpose) stays transpose because the second `'` is followed by
      // another `'` (not an identifier char). Unicode identifier letters (`\p{L}`)
      // are treated identically to ASCII so `]'ε...'` is a string, symmetric with
      // the prev-char Unicode handling above.
      const nextChar = pos + 1 < source.length ? source[pos + 1] : undefined;
      const nextIsIdentifierLetter = nextChar !== undefined && (/[a-zA-Z_]/.test(nextChar) || /\p{L}/u.test(nextChar));
      if (!nextIsIdentifierLetter) {
        return { start: pos, end: pos + 1 };
      }
    }
  }

  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === "'") {
      // Check for escaped quote ''
      if (i + 1 < source.length && source[i + 1] === "'") {
        i += 2;
        continue;
      }
      return { start: pos, end: i + 1 };
    }
    // Unterminated string ends at newline
    if (source[i] === '\n' || source[i] === '\r') {
      return { start: pos, end: i };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches double-quoted string: "..." with "" as escape (MATLAB does not support backslash escapes)
export function matchDoubleQuotedString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '"') {
      // Check for escaped quote ""
      if (i + 1 < source.length && source[i + 1] === '"') {
        i += 2;
        continue;
      }
      return { start: pos, end: i + 1 };
    }
    // Unterminated string ends at newline
    if (source[i] === '\n' || source[i] === '\r') {
      return { start: pos, end: i };
    }
    i++;
  }

  return { start: pos, end: source.length };
}
