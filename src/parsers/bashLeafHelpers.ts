// Bash leaf helper functions: independent pure functions with no internal dependencies

import type { ExcludedRegion } from '../types';

// Checks if '#' at position is a comment start (at word boundary, not mid-word)
// Real bash: `#` is only a comment when preceded by whitespace, start-of-line, or
// unquoted command separators (;|&). After closing quotes/parens/braces/brackets,
// `#` is part of the current word (e.g., echo "foo"#tag prints foo#tag).
export function isCommentStart(source: string, pos: number): boolean {
  if (pos === 0) return true;
  const prev = source[pos - 1];
  // $ before # is handled separately (for $#, ${#, $$# special cases)
  if (prev === '$') return true;
  // Extglob pattern: @(, !(, ?(, *(, +( — `#` directly after these `(` is a literal
  // pattern character, not a comment marker.
  if (prev === '(' && pos >= 2 && /[@!?*+]/.test(source[pos - 2])) {
    return false;
  }
  // Note: < and > are excluded because >#file and <#file are redirects to files starting with #
  return /[ \t\n\r;|&(]/.test(prev);
}

// Checks if '#' at position is preceded by '$' (a $-prefixed token like $#, $$#, $$$#).
// Real bash never starts a comment with `#` immediately after `$`: even when `$$` is the
// PID and the trailing `#` is literal, the `#` is part of the same word (e.g., `echo $$#tag`
// prints `<PID>#tag`, not `<PID>` followed by a comment).
export function isDollarHashVariable(source: string, pos: number): boolean {
  let count = 0;
  let p = pos - 1;
  while (p >= 0 && source[p] === '$') {
    count++;
    p--;
  }
  return count > 0;
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

// Parses a heredoc operator (<<, <<-) and extracts the delimiter.
// Real bash supports concatenating multiple delimiter parts like <<"EOF"'TAIL' or
// <<X"Y" — the actual terminator is the concatenation of all parts.
export function parseHeredocOperator(source: string, pos: number): { stripTabs: boolean; terminator: string; matchLength: number } | null {
  // Match the operator <<(-)? and trailing tabs/spaces
  const opMatch = source.slice(pos).match(/^<<(-)?[\t ]*/);
  if (!opMatch) return null;
  const stripTabs = opMatch[1] === '-';
  let i = pos + opMatch[0].length;
  let terminator = '';
  let matched = false;

  // Consume one or more concatenated delimiter parts: 'quoted', "quoted",
  // \escaped, or a bare identifier-like run.
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const close = source.indexOf(ch, i + 1);
      if (close < 0) {
        if (!matched) return null;
        break;
      }
      terminator += source.slice(i + 1, close);
      i = close + 1;
      matched = true;
      continue;
    }
    if (ch === '\\' && i + 1 < source.length) {
      // \\ is an escaped backslash: terminator gets a literal backslash, then continue parsing
      if (source[i + 1] === '\\') {
        terminator += '\\';
        i += 2;
        matched = true;
        continue;
      }
      const startWord = i + 1;
      let end = startWord;
      while (end < source.length && !/[\s'"\\]/.test(source[end])) end++;
      if (end === startWord) {
        if (!matched) return null;
        break;
      }
      terminator += source.slice(startWord, end);
      i = end;
      matched = true;
      continue;
    }
    if (matched ? /[A-Za-z0-9_\-.+:%,=!*?]/.test(ch) : /[A-Za-z_0-9.+:%,=!*?]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_\-.+:%,=!*?]/.test(source[i])) i++;
      terminator += source.slice(start, i);
      matched = true;
      continue;
    }
    break;
  }

  if (!matched) return null;
  // Empty delimiter (e.g., `<<''` or `<<""`) is bash's "blank-line-terminated" heredoc.
  // The terminator is an empty string, matched against the first blank line in the body.
  return {
    stripTabs,
    terminator,
    matchLength: i - pos
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
      // Stop region at end of terminator line (before the newline) so the trailing
      // newline can serve as a command separator for following tokens like '}'.
      return {
        start: bodyStart,
        end: lineEnd
      };
    }

    // Inside subshell: terminator at line start followed by ')' closes the heredoc
    // Content after ')' (e.g., 'EOF) file') belongs outside the subshell
    // Empty terminator (<<""): only blank line terminates, so a bare ')' line is body content
    if (inSubshell && terminator !== '' && trimmedLine.startsWith(`${terminator})`)) {
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
