// Bash leaf helper functions: independent pure functions with no internal dependencies

import type { ExcludedRegion } from '../types';

// Checks if '#' at position is a comment start (at word boundary, not mid-word)
export function isCommentStart(source: string, pos: number): boolean {
  if (pos === 0) return true;
  const prev = source[pos - 1];
  // $ before # is handled separately (for $#, ${#, $$# special cases)
  if (prev === '$') return true;
  // # after shell metacharacters or whitespace starts a comment
  // Note: < and > are excluded because >#file and <#file are redirects to files starting with #
  return /[ \t\n\r;|&(){}"'`\]]/.test(prev);
}

// Checks if '#' at position is part of $# variable (odd consecutive $ count before #)
// $# → true (argument count), $$# → false ($$ is PID, # is comment), $$$# → true ($$ + $#)
export function isDollarHashVariable(source: string, pos: number): boolean {
  let count = 0;
  let p = pos - 1;
  while (p >= 0 && source[p] === '$') {
    count++;
    p--;
  }
  return count > 0 && count % 2 === 1;
}

// Checks if source matches a whole word at position (word boundary check)
export function matchesWord(source: string, pos: number, word: string): boolean {
  if (pos + word.length > source.length) return false;
  if (source.slice(pos, pos + word.length) !== word) return false;
  if (pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) return false;
  const after = pos + word.length;
  if (after < source.length && /[a-zA-Z0-9_]/.test(source[after])) return false;
  return true;
}

// Parses a heredoc operator (<<, <<-) and extracts the delimiter
export function parseHeredocOperator(source: string, pos: number): { stripTabs: boolean; terminator: string; matchLength: number } | null {
  // Quoted delimiters: match anything between quotes; unquoted: allow hyphens, dots, and numeric-only
  const heredocPattern = /^<<(-)?[\t ]*\\?(?:(['"])(.*?)\2|([A-Za-z_0-9][A-Za-z0-9_\-.]*))/;
  const match = source.slice(pos).match(heredocPattern);
  if (!match) return null;
  return {
    stripTabs: match[1] === '-',
    terminator: match[3] ?? match[4],
    matchLength: match[0].length
  };
}

// Matches the body of a heredoc (from body start to terminator line)
// When inSubshell is true, also recognizes terminator immediately followed by ')' (e.g., EOF))
export function matchHeredocBody(
  source: string,
  bodyStart: number,
  stripTabs: boolean,
  terminator: string,
  inSubshell = false
): ExcludedRegion | null {
  let i = bodyStart;

  while (i < source.length) {
    const lineStart = i;
    let lineEnd = i;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    const line = source.slice(lineStart, lineEnd);
    const trimmedLine = stripTabs ? line.replace(/^\t*/, '') : line;

    if (trimmedLine === terminator) {
      let regionEnd = lineEnd;
      if (regionEnd < source.length) {
        if (source[regionEnd] === '\r' && regionEnd + 1 < source.length && source[regionEnd + 1] === '\n') {
          regionEnd += 2;
        } else {
          regionEnd += 1;
        }
      }
      return {
        start: bodyStart,
        end: regionEnd
      };
    }

    // Inside subshell: terminator at line start followed by ')' closes the heredoc
    // Content after ')' (e.g., 'EOF) file') belongs outside the subshell
    if (inSubshell && trimmedLine.startsWith(`${terminator})`)) {
      // End the heredoc region at the position of the ')', not past it
      const trimOffset = stripTabs ? line.length - line.replace(/^\t*/, '').length : 0;
      const parenPos = lineStart + trimOffset + terminator.length;
      return {
        start: bodyStart,
        end: parenPos
      };
    }

    // Skip past line ending
    if (lineEnd < source.length) {
      if (source[lineEnd] === '\r' && lineEnd + 1 < source.length && source[lineEnd + 1] === '\n') {
        i = lineEnd + 2;
      } else {
        i = lineEnd + 1;
      }
    } else {
      i = lineEnd;
    }
  }

  return { start: bodyStart, end: source.length };
}

// Matches $'...' (ANSI-C quoting) strings with escape handling
export function matchDollarSingleQuote(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches single-quoted strings (no escape handling)
export function matchSingleQuotedString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Finds the end of a single-quoted string (no escape handling)
export function findSingleQuoteEnd(source: string, pos: number): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === "'") {
      return i + 1;
    }
    i++;
  }
  return source.length;
}
