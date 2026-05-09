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

// Matches Verilog/SystemVerilog string. Per IEEE 1800-2017 §5.9, `\<LF>` (and `\<CR>`,
// `\<CRLF>`) inside a string is a line continuation: the backslash and the line break are
// consumed and the string continues on the next line. A bare unescaped newline still
// terminates the string.
export function matchVerilogString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      const nextChar = source[i + 1];
      if (nextChar === '\n') {
        i += 2;
        continue;
      }
      if (nextChar === '\r') {
        const skip = i + 2 < source.length && source[i + 2] === '\n' ? 3 : 2;
        i += skip;
        continue;
      }
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      return { start: pos, end: i + 1 };
    }
    // Bare newline terminates an unfinished string in Verilog
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
    // Skip string literals inside attributes. If a backslash-newline is encountered,
    // probe forward for a closing `"` before the attribute closer `*)`: if one exists,
    // treat `\<LF>` as a line continuation and consume both; otherwise treat it as a
    // string terminator (matching matchVerilogString's defensive behavior).
    if (source[i] === '"') {
      i++;
      while (i < source.length && source[i] !== '"' && source[i] !== '\n' && source[i] !== '\r') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const nextChar = source[i + 1];
          if (nextChar === '\n' || nextChar === '\r') {
            const newlineLen = nextChar === '\r' && source[i + 2] === '\n' ? 2 : 1;
            const afterNewline = i + 1 + newlineLen;
            // Look ahead for a closing `"` before the attribute closer `*)` or EOF
            let probe = afterNewline;
            let foundQuote = false;
            while (probe < source.length) {
              const pch = source[probe];
              if (pch === '"') {
                foundQuote = true;
                break;
              }
              if (pch === '*' && probe + 1 < source.length && source[probe + 1] === ')') {
                break;
              }
              probe++;
            }
            if (foundQuote) {
              i = afterNewline;
              continue;
            }
            // No closing quote on continuation: treat `\<LF>` as terminator
            break;
          }
          i += 2;
          continue;
        }
        i++;
      }
      if (i < source.length && source[i] === '"') {
        i++;
      } else if (i < source.length && (source[i] === '\n' || source[i] === '\r')) {
        // String terminated by bare newline. Scan forward for `*)` directly without
        // re-entering string mode, since further `"` chars are likely stale text from
        // the unterminated string and should not toggle parsing state again.
        let j = i;
        while (j < source.length) {
          if (source[j] === '*' && j + 1 < source.length && source[j + 1] === ')') {
            return { start: pos, end: j + 2 };
          }
          j++;
        }
        return { start: pos, end: source.length };
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

// Excludes `pragma directive contents to end of line. Pragma arguments may contain
// keyword-like tokens (e.g. `pragma protect begin / end) that must not be tokenized.
// Special case: `pragma protect begin opens a protected region that extends to the
// matching `pragma protect end (IEEE 1800-2017 §28.10). The entire region between
// them is excluded so block keywords inside protected source are not tokenized.
export function matchPragmaDirective(source: string, pos: number): ExcludedRegion {
  let i = pos + 7;
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    i++;
  }
  const lineEnd = i;
  // Check whether this `pragma directive is `pragma protect begin (with optional whitespace).
  // If so, extend the excluded region through the matching `pragma protect end line.
  if (isPragmaProtectBegin(source, pos + 7, lineEnd)) {
    const protectEnd = findPragmaProtectEnd(source, lineEnd);
    if (protectEnd !== -1) {
      return { start: pos, end: protectEnd };
    }
    // No matching end: exclude through end of source (defensive)
    return { start: pos, end: source.length };
  }
  return { start: pos, end: lineEnd };
}

// Returns true when the `pragma directive arguments contain `protect begin` as
// the first significant tokens (after whitespace), with optional trailing args.
function isPragmaProtectBegin(source: string, argStart: number, argEnd: number): boolean {
  let i = argStart;
  while (i < argEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source.slice(i, i + 7) !== 'protect') return false;
  i += 7;
  if (i >= argEnd || !(source[i] === ' ' || source[i] === '\t')) return false;
  while (i < argEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source.slice(i, i + 5) !== 'begin') return false;
  i += 5;
  // 'begin' must be followed by word boundary (space, tab, end of line/args, comma/semicolon/etc)
  if (i < argEnd && /[a-zA-Z0-9_$]/.test(source[i])) return false;
  return true;
}

// Searches for `pragma protect end (with optional whitespace) starting from `from`.
// Returns the position immediately after the matching directive line (i.e., the position
// of the line terminator), or -1 if not found.
function findPragmaProtectEnd(source: string, from: number): number {
  const pattern = /`pragma\b/g;
  pattern.lastIndex = from;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match !== null) {
    const lineStart = match.index + match[0].length;
    let lineEnd = lineStart;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }
    if (isPragmaProtectEnd(source, lineStart, lineEnd)) {
      return lineEnd;
    }
    pattern.lastIndex = lineEnd;
    match = pattern.exec(source);
  }
  return -1;
}

// Returns true when the `pragma directive arguments are `protect end` (with optional whitespace and trailing args).
function isPragmaProtectEnd(source: string, argStart: number, argEnd: number): boolean {
  let i = argStart;
  while (i < argEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source.slice(i, i + 7) !== 'protect') return false;
  i += 7;
  if (i >= argEnd || !(source[i] === ' ' || source[i] === '\t')) return false;
  while (i < argEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source.slice(i, i + 3) !== 'end') return false;
  i += 3;
  if (i < argEnd && /[a-zA-Z0-9_$]/.test(source[i])) return false;
  return true;
}

// Excludes a `MACRO(arg, arg, ...) macro invocation including the argument list.
// `pos` points to the backtick; `parenStart` points to the opening `(`. The match
// runs until the matched closing `)`, tracking nested parens, strings, and comments
// so block keywords inside macro args are not tokenized.
export function matchMacroArgList(source: string, pos: number, parenStart: number): ExcludedRegion {
  let i = parenStart + 1;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '"') {
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '\n' || source[i] === '\r') break;
        i++;
      }
      if (i < source.length && source[i] === '"') i++;
      continue;
    }
    if (c === '/' && i + 1 < source.length && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && i + 1 < source.length && source[i + 1] === '*') {
      i += 2;
      while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      if (i + 1 < source.length) i += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0) {
      i++;
      break;
    }
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
