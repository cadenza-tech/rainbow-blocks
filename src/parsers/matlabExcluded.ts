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
      // After a digit, check if ' starts a string (e.g., [1'text'])
      // If immediately followed by a letter, it's more likely a string
      if (/[0-9]/.test(prevChar)) {
        const nextChar = pos + 1 < source.length ? source[pos + 1] : undefined;
        if (nextChar && /[a-zA-Z_]/.test(nextChar)) {
          // Fall through to string matching
        } else {
          return { start: pos, end: pos + 1 };
        }
      } else if (prevChar === "'") {
        // Quote immediately after another quote: still transpose
        // A'' = two transposes, each ' follows a value (result of prior transpose)
        return { start: pos, end: pos + 1 };
      } else {
        // This is transpose, not string - return minimal region
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
