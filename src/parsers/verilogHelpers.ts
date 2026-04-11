// Verilog/SystemVerilog pure helper functions for excluded region matching

import type { ExcludedRegion } from '../types';
import { isInExcludedRegion } from './parserUtils';

// Rejects any keyword preceded or followed by $ (part of identifier like $end, fork$sig)
export function hasDollarAdjacent(source: string, position: number, keyword: string): boolean {
  if (position > 0 && source[position - 1] === '$') {
    return true;
  }
  const afterPos = position + keyword.length;
  if (afterPos < source.length && source[afterPos] === '$') {
    return true;
  }
  return false;
}

// Matches Verilog string (cannot span multiple lines)
export function matchVerilogString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      // Don't skip newline - Verilog strings can't span lines
      // Include the backslash in the excluded region since it's part of the string content
      if (source[i + 1] === '\n' || source[i + 1] === '\r') {
        return { start: pos, end: i + 1 };
      }
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      return { start: pos, end: i + 1 };
    }
    // String cannot span multiple lines in Verilog
    if (source[i] === '\n' || source[i] === '\r') {
      return { start: pos, end: i };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches escaped identifier: \<chars> terminated by whitespace
export function matchEscapedIdentifier(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length && !/\s/.test(source[i])) {
    i++;
  }
  return { start: pos, end: i };
}

// Matches SystemVerilog attribute: (* ... *)
export function matchAttribute(source: string, pos: number): ExcludedRegion {
  // Handle malformed '(*)': close immediately when the char after '(*' is ')'
  if (pos + 2 < source.length && source[pos + 2] === ')') {
    return { start: pos, end: pos + 3 };
  }
  let i = pos + 2;
  while (i < source.length) {
    // Skip string literals inside attributes (terminate at newlines like Verilog strings)
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"' && source[i] !== '\n' && source[i] !== '\r') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const nextChar = source[i + 1];
          if (nextChar === '\n' || nextChar === '\r') break;
          i += 2;
          continue;
        }
        i++;
      }
      if (i < source.length && source[i] === '"') {
        i++;
      } else if (i < source.length && (source[i] === '\n' || source[i] === '\r')) {
        // String terminated by newline: skip newline and any stray closing quote
        if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
          i++;
        }
        if (i < source.length && source[i] === '"') {
          i++;
        }
      }
      continue;
    }
    // Skip block comments /* ... */ inside attributes
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '*') {
      i += 2;
      while (i < source.length) {
        if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }
    // Skip single-line comments // ... inside attributes
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    if (source[i] === '*' && i + 1 < source.length && source[i + 1] === ')') {
      return { start: pos, end: i + 2 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches block comment: /* ... */
export function matchBlockComment(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;

  while (i < source.length) {
    if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
      return { start: pos, end: i + 2 };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Matches `define directive to end of line, following backslash-newline continuation
export function matchDefineDirective(source: string, pos: number): ExcludedRegion {
  let i = pos + 7;
  while (i < source.length) {
    // Skip block comments inside define body
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '*') {
      i += 2;
      while (i < source.length) {
        if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
          i += 2;
          break;
        }
        // Unterminated block comment: stop at define boundary (newline without continuation)
        if (source[i] === '\n' || (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n'))) {
          let j = i - 1;
          if (source[i] === '\n' && j >= 0 && source[j] === '\r') {
            j--;
          }
          let backslashCount = 0;
          while (j >= 0 && source[j] === '\\') {
            backslashCount++;
            j--;
          }
          if (backslashCount % 2 === 1) {
            i++;
            continue;
          }
          return { start: pos, end: i };
        }
        i++;
      }
      continue;
    }
    // Skip single-line comments inside define body (terminates the define line)
    if (source[i] === '/' && i + 1 < source.length && source[i + 1] === '/') {
      // Per IEEE 1800-2017 section 22.5.1, single-line comments inside `define
      // are not part of the substituted text. The comment runs to end of line,
      // and any backslash before the newline is inside the comment, NOT a continuation.
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      // End the define at this newline (the comment consumed any trailing backslash)
      return { start: pos, end: i };
    }
    // Skip string literals inside define body (backslash escapes apply)
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const nextChar = source[i + 1];
          if (nextChar === '\n' || nextChar === '\r') {
            // Backslash before newline inside string: string is unterminated
            // The backslash is part of the string content, not a define continuation
            // End the define at this newline
            return { start: pos, end: i + 1 };
          }
          i += 2;
          continue;
        }
        if (source[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      // After exiting string, if we stopped at newline, the outer loop handles it
      continue;
    }
    if (source[i] === '\n') {
      // Count consecutive backslashes before the newline (skipping CR)
      let j = i - 1;
      if (j >= 0 && source[j] === '\r') {
        j--;
      }
      let backslashCount = 0;
      while (j >= 0 && source[j] === '\\') {
        backslashCount++;
        j--;
      }
      // Odd number of backslashes means line continuation
      if (backslashCount % 2 === 1) {
        i++;
        continue;
      }
      return { start: pos, end: i };
    }
    if (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n')) {
      // CR-only line ending
      let j = i - 1;
      let backslashCount = 0;
      while (j >= 0 && source[j] === '\\') {
        backslashCount++;
        j--;
      }
      if (backslashCount % 2 === 1) {
        i++;
        continue;
      }
      return { start: pos, end: i };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches `undef directive to end of line (always single-line, no continuation)
export function matchUndefDirective(source: string, pos: number): ExcludedRegion {
  let i = pos + 6;
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    i++;
  }
  return { start: pos, end: i };
}

// Tries to skip a label (identifier: or \escaped_name:), returns new position or original if not a label
// Skips whitespace, comments, and newlines between identifier and colon
export function trySkipLabel(source: string, pos: number, excludedRegions: ExcludedRegion[] = []): number {
  let i = pos;
  if (source[i] === '\\') {
    // Escaped identifier: \name terminated by whitespace
    i++;
    while (i < source.length && !/\s/.test(source[i])) i++;
    // Bare backslash (no non-whitespace chars consumed) is not a valid escaped identifier
    if (i === pos + 1) return pos;
  } else {
    while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
  }
  // Skip whitespace, newlines, and excluded regions (comments) after identifier
  let afterIdent = i;
  while (afterIdent < source.length) {
    if (source[afterIdent] === ' ' || source[afterIdent] === '\t' || source[afterIdent] === '\n' || source[afterIdent] === '\r') {
      afterIdent++;
      continue;
    }
    if (isInExcludedRegion(afterIdent, excludedRegions)) {
      // Find end of excluded region
      for (const region of excludedRegions) {
        if (afterIdent >= region.start && afterIdent < region.end) {
          afterIdent = region.end;
          break;
        }
      }
      continue;
    }
    break;
  }
  if (afterIdent < source.length && source[afterIdent] === ':' && (afterIdent + 1 >= source.length || source[afterIdent + 1] !== ':')) {
    return afterIdent + 1;
  }
  // Not a label
  return pos;
}
