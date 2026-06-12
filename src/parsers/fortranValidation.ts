// Fortran block validation helpers for isValidBlockClose and isValidProcedureOpen

import type { ExcludedRegion } from '../types';
import { findInlineCommentIndex, findLineEnd } from './fortranHelpers';

// Upper bound on how many characters isInsideParentheses scans backward looking for an
// unmatched `(`. A real enclosing paren (function argument list / if-condition) sits at
// most a few lines back even across `&` continuations, so a generous 2048-char cap never
// rejects genuine code. Without it, a single logical line carrying many keywords inside
// an unclosed `(` degrades to O(N^2) (every keyword scanning back to the line start).
// Bounding the scan keeps it O(1) per call. Mirrors MAX_OR_BOUNDARY_SCAN_CHARS in
// adaParser.ts. Exceeding the cap returns false (treat as not inside parentheses): the
// cost-minimal default that avoids phantom block suppression on pathological input.
const MAX_PAREN_SCAN_CHARS = 2048;

// Scans backward from pos looking for an unclosed 'interface' block.
// Returns true when the nearest enclosing unclosed block is 'interface'.
function isInsideInterfaceBlock(
  source: string,
  pos: number,
  isInExcludedRegion: (p: number, regions: ExcludedRegion[]) => boolean,
  excludedRegions: ExcludedRegion[]
): boolean {
  const beforeLower = source.slice(0, pos).toLowerCase();
  // `end[ \t]*interface` is listed first so the concatenated `endinterface` and the
  // spaced `end interface` both match the end-form before the standalone `interface`
  // alternative is tried. `[ \t]*` (not `\s+`) keeps a stray `end\ninterface` across a
  // line break from being miscounted as a single end-form, matching the [ \t]* spacing
  // used by COMPOUND_END_PATTERN in fortranParser.ts.
  const pattern = /\bend[ \t]*interface\b|\binterface\b/g;
  let depth = 0;
  let match = pattern.exec(beforeLower);
  const matches: { start: number; isEnd: boolean }[] = [];
  while (match !== null) {
    if (!isInExcludedRegion(match.index, excludedRegions)) {
      matches.push({ start: match.index, isEnd: match[0].startsWith('end') });
    }
    match = pattern.exec(beforeLower);
  }
  for (const m of matches) {
    if (m.isEnd) depth--;
    else depth++;
  }
  return depth > 0;
}

// Checks if position is at line start allowing leading whitespace (for # preprocessor)
export function isAtLineStartAllowingWhitespace(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  return i < 0 || source[i] === '\n' || source[i] === '\r';
}

// Validates 'procedure': rejects type-bound procedure declarations (with ::)
// and 'module procedure NAME' statements inside interface blocks
export function isValidProcedureOpen(
  keyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean
): boolean {
  // Reject 'module procedure NAME' when inside an unclosed 'interface' block.
  // Within a module/submodule body (outside of interface), 'module procedure'
  // introduces a procedure body and is a real block opener.
  let k = position - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--;
  if (k >= 5) {
    const maybeModule = source.slice(k - 5, k + 1).toLowerCase();
    if (maybeModule === 'module' && (k - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[k - 6]))) {
      if (isInsideInterfaceBlock(source, position, isInExcludedRegion, excludedRegions)) {
        return false;
      }
    }
  }
  let j = position + keyword.length;
  while (j < source.length) {
    const lineEnd = findLineEnd(source, j);
    const lineContent = source.slice(j, lineEnd);
    // Strip inline comment before checking for continuation & and ::
    let trimmedLine = lineContent.trimEnd();
    const commentPos = findInlineCommentIndex(trimmedLine);
    if (commentPos >= 0) {
      trimmedLine = trimmedLine.slice(0, commentPos).trimEnd();
    }
    // Skip comment-only lines (empty after stripping comment)
    if (trimmedLine.trimStart().length === 0 && commentPos >= 0) {
      j = lineEnd;
      if (j < source.length && source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
        j += 2;
      } else if (j < source.length) {
        j++;
      }
      continue;
    }
    let colonSearchIdx = 0;
    while (colonSearchIdx < lineContent.length - 1) {
      const colonIdx = lineContent.indexOf('::', colonSearchIdx);
      if (colonIdx < 0) break;
      if (!isInExcludedRegion(j + colonIdx, excludedRegions)) {
        return false;
      }
      colonSearchIdx = colonIdx + 2;
    }
    if (!trimmedLine.endsWith('&')) {
      break;
    }
    // Skip past line break (\r\n, \n, or standalone \r)
    j = lineEnd;
    if (j < source.length && source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
      j += 2;
    } else if (j < source.length) {
      j++;
    }
  }
  // Reject bare 'procedure NAME' inside a generic interface block.
  // Generic interfaces list referenced procedures with lines like:
  //   interface op
  //     procedure op1
  //     procedure op2
  //   end interface op
  // These 'procedure' lines are NOT block openers - they reference existing
  // procedures and have no matching 'end procedure'.
  if (isInsideInterfaceBlock(source, position, isInExcludedRegion, excludedRegions)) {
    return false;
  }
  // Reject assignment forms: 'procedure = expr' and 'procedure(N) = expr'
  // (variable name / array element assignment, e.g., when 'procedure' is used as identifier).
  const after = source.slice(position + keyword.length);
  if (/^[ \t]*=[^=]/.test(after) || /^[ \t]*=[ \t]*$/.test(after)) {
    return false;
  }
  if (/^[ \t]*\(/.test(after)) {
    let pdepth = 0;
    let pi = 0;
    while (pi < after.length) {
      const ch = after[pi];
      if (ch === "'" || ch === '"') {
        pi++;
        while (pi < after.length) {
          if (after[pi] === ch) {
            if (pi + 1 < after.length && after[pi + 1] === ch) {
              pi += 2;
              continue;
            }
            pi++;
            break;
          }
          pi++;
        }
        continue;
      }
      if (ch === '(') pdepth++;
      else if (ch === ')') {
        pdepth--;
        if (pdepth === 0) {
          const rest = after.slice(pi + 1);
          if (/^[ \t]*=[^=]/.test(rest) || /^[ \t]*=[ \t]*$/.test(rest)) {
            return false;
          }
          break;
        }
      }
      pi++;
    }
  }
  return true;
}

// Returns the index of the last code character on the physical line that begins at
// `lineStart` (line break / EOF determines the end). The inline comment portion (text
// after an unquoted `!`) is excluded so a backward paren-depth scan does not count
// parentheses that live inside a comment. Strings are skipped (Fortran uses doubled
// quotes as escape) so a `!` inside a string is not treated as a comment start.
// Returns lineStart - 1 when the line has no code characters (comment-only / blank).
function findLineCodePortionEnd(source: string, lineStart: number): number {
  let commentStart = -1;
  let i = lineStart;
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      i++;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        if (source[i] === ch) {
          if (i + 1 < source.length && source[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '!') {
      commentStart = i;
      break;
    }
    i++;
  }
  const lineEnd = commentStart >= 0 ? commentStart : i;
  let codeEnd = lineEnd - 1;
  while (codeEnd >= lineStart && (source[codeEnd] === ' ' || source[codeEnd] === '\t')) {
    codeEnd--;
  }
  return codeEnd;
}

// Returns true when `lineStart` is a genuine physical-line boundary: offset 0 or the
// character just before it is a line terminator. Used to avoid following a (bogus)
// continuation when the backward paren scan stopped at the MAX_PAREN_SCAN_CHARS floor
// mid-line rather than at a real boundary.
function isLineBoundary(source: string, lineStart: number): boolean {
  return lineStart === 0 || source[lineStart - 1] === '\n' || source[lineStart - 1] === '\r';
}

// Checks if a position is inside parentheses by scanning backward for unmatched '('
// Also treats `[` / `]` (Fortran 2003+ array constructors and coarray image selectors)
// the same as `(` / `)` so a keyword inside `[expr, ...]` or `x[expr]` is recognized as
// being inside a bracket-grouped expression.
// Skips characters inside string literals (single/double quoted with doubled-quote escaping)
// and comments (! to end of line)
// Follows & continuation lines backward to handle multi-line expressions
export function isInsideParentheses(source: string, position: number): boolean {
  // Floor for every backward scan in this call. A genuine enclosing `(` sits at most a
  // few lines back, so refusing to look past MAX_PAREN_SCAN_CHARS never rejects real
  // code while keeping the call O(1) instead of O(position). This bounds BOTH the
  // line-start search below and the main paren-depth loop; a `(` farther back than the
  // floor is treated as unreachable (the cost-minimal `not inside parentheses` default).
  const scanFloor = position - MAX_PAREN_SCAN_CHARS > 0 ? position - MAX_PAREN_SCAN_CHARS : 0;

  // Find start of current physical line (bounded by scanFloor)
  let lineStart = position;
  while (lineStart > scanFloor && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }

  let depth = 0;
  let depthBeforeLine = 0;
  let i = position - 1;
  // Pre-check: if keyword is at column 0 of a continuation line, extend backward.
  // Only follow a continuation when lineStart is a genuine line boundary; when it was
  // clamped to scanFloor mid-line (long line beyond the cap) there is no boundary to
  // cross and the scan simply ends.
  if (i < lineStart && isLineBoundary(source, lineStart)) {
    const prevLineStart = findContinuationLineStart(source, lineStart);
    if (prevLineStart >= 0) {
      // Resume scanning at the last code character of the continuation line so any
      // inline comment on that line (which holds the `&` continuation) is skipped.
      i = findLineCodePortionEnd(source, prevLineStart);
      lineStart = prevLineStart;
    }
  }
  while (i >= lineStart) {
    // Cap the backward scan so a long logical line with many keywords stays O(1) per
    // call instead of O(line-length). A genuine enclosing `(` is only a few lines back.
    if (position - i > MAX_PAREN_SCAN_CHARS) {
      return false;
    }
    const char = source[i];
    // Skip backward over string literals (look for closing quote and find opening quote)
    if (char === "'" || char === '"') {
      const quote = char;
      i--;
      let foundOpenQuote = false;
      while (i >= lineStart) {
        if (source[i] === quote) {
          if (i > lineStart && source[i - 1] === quote) {
            i -= 2;
            continue;
          }
          foundOpenQuote = true;
          break;
        }
        i--;
      }
      // If opening quote not found, extend search across continuation lines
      while (!foundOpenQuote && isLineBoundary(source, lineStart) && lineStart > 0) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart < 0) break;
        depthBeforeLine = depth;
        lineStart = prevLineStart;
        while (i >= lineStart) {
          if (source[i] === quote) {
            if (i > lineStart && source[i - 1] === quote) {
              i -= 2;
              continue;
            }
            foundOpenQuote = true;
            break;
          }
          i--;
        }
      }
      i--;
      continue;
    }
    // Comment indicator: when scanning backward, hitting ! means we've passed through
    // comment text (to the right of !) and reached the code/comment boundary.
    // We need to skip back to the start of the code portion on this line,
    // undoing any depth changes from characters inside the comment.
    if (char === '!') {
      // Rescan code portion (before !) to get correct depth, preserving depth from other lines
      let rescanDepth = 0;
      for (let s = lineStart; s < i; s++) {
        if (source[s] === "'" || source[s] === '"') {
          const q = source[s];
          s++;
          while (s < i) {
            if (source[s] === q) {
              if (s + 1 < i && source[s + 1] === q) {
                s++;
              } else {
                break;
              }
            }
            s++;
          }
          continue;
        }
        if (source[s] === '(' || source[s] === '[') rescanDepth++;
        else if (source[s] === ')' || source[s] === ']') rescanDepth--;
      }
      // Check if code portion has more ( than can be matched by pending )
      if (rescanDepth > depthBeforeLine) return true;
      depth = depthBeforeLine - rescanDepth;
      i = lineStart - 1;
      // When reaching line start, check if previous line has & continuation
      if (i < lineStart && isLineBoundary(source, lineStart)) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart >= 0) {
          depthBeforeLine = depth;
          // Resume at the last code char of the previous line so its inline comment
          // (text after `!`, which may hold stray parentheses) is not scanned.
          i = findLineCodePortionEnd(source, prevLineStart);
          lineStart = prevLineStart;
        }
      }
      continue;
    }
    // Skip & continuation character
    if (char === '&') {
      i--;
      // Check if we've crossed the line boundary after skipping &
      if (i < lineStart && isLineBoundary(source, lineStart)) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart >= 0) {
          depthBeforeLine = depth;
          // Resume at the last code char of the previous line so its inline comment
          // (text after `!`, which may hold stray parentheses) is not scanned.
          i = findLineCodePortionEnd(source, prevLineStart);
          lineStart = prevLineStart;
        }
      }
      continue;
    }
    if (char === ')' || char === ']') depth++;
    else if (char === '(' || char === '[') {
      if (depth === 0) return true;
      depth--;
    }
    i--;
    // When reaching line start, check if previous line has & continuation
    if (i < lineStart && isLineBoundary(source, lineStart)) {
      const prevLineStart = findContinuationLineStart(source, lineStart);
      if (prevLineStart >= 0) {
        depthBeforeLine = depth;
        // Resume at the last code char of the previous line so its inline comment
        // (text after `!`, which may hold stray parentheses) is not scanned.
        i = findLineCodePortionEnd(source, prevLineStart);
        lineStart = prevLineStart;
      }
    }
  }
  return false;
}

// Finds the start of the previous continuation line (if previous line ends with & outside comments)
// Returns the line start position, or -1 if no continuation
function findContinuationLineStart(source: string, currentLineStart: number): number {
  let searchStart = currentLineStart;
  // Loop to skip comment-only lines and blank lines
  // (Fortran allows comment-only and blank lines between continuation lines)
  while (true) {
    let prevEnd = searchStart - 1;
    // Skip line terminator (\r\n as a unit, then standalone \n or \r)
    if (prevEnd >= 1 && source[prevEnd] === '\n' && source[prevEnd - 1] === '\r') {
      prevEnd -= 2;
    } else if (prevEnd >= 0 && (source[prevEnd] === '\n' || source[prevEnd] === '\r')) {
      prevEnd--;
    }
    if (prevEnd < 0) return -1;

    // If prevEnd still points at a line terminator, the previous line is blank
    // (e.g., `&\n\n    end)`). Skip the blank line and continue scanning the line before.
    if (source[prevEnd] === '\n' || source[prevEnd] === '\r') {
      searchStart = prevEnd + 1;
      continue;
    }

    // Find start of previous line
    let prevLineStart = prevEnd;
    while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
      prevLineStart--;
    }

    // Check if line is comment-only (first non-whitespace is !) or blank
    // (only whitespace, including no characters at all). Blank lines are valid
    // between continuation lines in free-form Fortran and must be skipped.
    let firstNonWs = prevLineStart;
    while (firstNonWs <= prevEnd && (source[firstNonWs] === ' ' || source[firstNonWs] === '\t')) {
      firstNonWs++;
    }
    if (firstNonWs > prevEnd) {
      // Blank line (only whitespace), skip and check the line before
      searchStart = prevLineStart;
      continue;
    }
    if (source[firstNonWs] === '!') {
      // Comment-only line, skip and check the line before
      searchStart = prevLineStart;
      continue;
    }

    // Find end of code portion (before ! comment), skipping strings
    let codeEnd = prevEnd;
    let inString = false;
    let quoteChar = '';
    for (let c = prevLineStart; c <= prevEnd; c++) {
      if (inString) {
        if (source[c] === quoteChar) {
          if (c + 1 <= prevEnd && source[c + 1] === quoteChar) {
            c++;
          } else {
            inString = false;
          }
        }
      } else if (source[c] === "'" || source[c] === '"') {
        inString = true;
        quoteChar = source[c];
      } else if (source[c] === '!') {
        codeEnd = c - 1;
        break;
      }
    }

    // Find last non-whitespace in code portion
    while (codeEnd >= prevLineStart && (source[codeEnd] === ' ' || source[codeEnd] === '\t')) {
      codeEnd--;
    }
    if (codeEnd >= prevLineStart && source[codeEnd] === '&') {
      return prevLineStart;
    }
    return -1;
  }
}

// Fortran logical/relational operator patterns: built-in (.eq., .ne., ..., .neqv.)
// plus user-defined operators (.<letter-list>.) per Fortran spec.
const FORTRAN_DOT_OPERATOR_PATTERN = /\.[a-zA-Z][a-zA-Z0-9_]*\.$/i;

// Fortran statement keywords that take identifiers as arguments
// When `end` or a compound-end keyword appears after one of these, it is an entity name
const FORTRAN_STATEMENT_KEYWORDS = new Set([
  'call',
  'save',
  'data',
  'dimension',
  'goto',
  'common',
  'equivalence',
  'namelist',
  'external',
  'intrinsic',
  'implicit',
  // 'to' covers both `assign N to LABEL` and `go to LABEL` (space-separated form)
  'to',
  // 'cycle NAME' / 'exit NAME' reference construct labels; NAME may match a block keyword
  'cycle',
  'exit',
  // 'end' followed by a compound-end type keyword is an expression where the inner type
  // keyword (do/function/etc.) must not be treated as a block opener.
  // Example: `x = end do / 2` (a literal `end` value used in expression). Without `end`
  // here, the inner `do`/`function` would be a phantom block_open.
  'end'
]);

// Skips backward across & continuation line boundaries
// Given position i pointing at a newline character, checks if the previous line
// ends with & (outside comments/strings). If so, returns the position of the last
// non-whitespace character before the &. Otherwise returns i unchanged.
function skipContinuationBackward(source: string, i: number): number {
  // Find the start of the line after the newline (the keyword's physical line)
  let keywordLineStart = i + 1;
  // For \r\n pair where i points at \r, advance past \n
  if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
    keywordLineStart = i + 2;
  }

  const prevLineStart = findContinuationLineStart(source, keywordLineStart);
  if (prevLineStart < 0) return i;

  // Previous line ends with &. Find the last non-whitespace before &.
  let prevEnd = keywordLineStart - 1;
  // Skip line terminator
  if (prevEnd >= 1 && source[prevEnd] === '\n' && source[prevEnd - 1] === '\r') {
    prevEnd -= 2;
  } else if (prevEnd >= 0) {
    prevEnd--;
  }

  // Scan forward to find ! comment boundary (skipping strings)
  let codeEnd = prevEnd;
  let inString = false;
  let quoteChar = '';
  for (let c = prevLineStart; c <= prevEnd; c++) {
    if (inString) {
      if (source[c] === quoteChar) {
        if (c + 1 <= prevEnd && source[c + 1] === quoteChar) {
          c++;
        } else {
          inString = false;
        }
      }
    } else if (source[c] === "'" || source[c] === '"') {
      inString = true;
      quoteChar = source[c];
    } else if (source[c] === '!') {
      codeEnd = c - 1;
      break;
    }
  }

  // Find & at end of code portion
  while (codeEnd >= prevLineStart && (source[codeEnd] === ' ' || source[codeEnd] === '\t')) {
    codeEnd--;
  }
  if (codeEnd < prevLineStart || source[codeEnd] !== '&') return i;

  // Return position of last non-whitespace character before &
  let result = codeEnd - 1;
  while (result >= prevLineStart && (source[result] === ' ' || source[result] === '\t')) {
    result--;
  }
  return result;
}

// Checks if the keyword is preceded by an expression-context token
// (operator, assignment =, or closing paren) indicating it is used
// as a variable in an expression, not as a block closer.
// Follows & continuation lines backward when the keyword is at a line boundary.
export function isPrecededByOperator(source: string, position: number): boolean {
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  // Skip leading & on continuation line (e.g., "x = &\n  &end")
  if (i >= 0 && source[i] === '&') {
    i--;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
  }
  // Follow & continuation backward when at a line boundary. Track whether the scan
  // actually crossed a continuation so that the digit-predecessor heuristic (used for
  // numeric-literal continuations like `42 &\n end`) is only applied across continuations
  // and does not collide with labeled statements (`100 end do`) on a single physical line.
  let crossedContinuation = false;
  if (i >= 0 && (source[i] === '\n' || source[i] === '\r')) {
    const newI = skipContinuationBackward(source, i);
    if (newI !== i) {
      crossedContinuation = true;
    }
    i = newI;
  }
  if (i < 0) return false;
  const char = source[i];
  // Arithmetic operators: +, -, *, /
  // Component access operator: % (derived type member access like obj%enddo)
  if (char === '+' || char === '-' || char === '/' || char === '*' || char === '%') {
    return true;
  }
  // Comparison operators: >, <
  if (char === '>' || char === '<') {
    return true;
  }
  // Comma: I/O list separator (e.g., print *, end), but only when comma is
  // not at statement start (continuation lines may start with comma inside parens)
  if (char === ',') {
    let c = i - 1;
    while (c >= 0 && (source[c] === ' ' || source[c] === '\t')) {
      c--;
    }
    if (c >= 0 && source[c] !== '\n' && source[c] !== '\r') {
      return true;
    }
  }
  // Closing paren: I/O format spec or function result context (e.g., write(*,*) end)
  if (char === ')') return true;
  // Assignment operator (x = end) or comparison operators (<=, >=, ==, /=)
  // All indicate expression context where keyword is used as a variable
  if (char === '=') {
    return true;
  }
  // Fortran dot-operators: .eq., .ne., .lt., .gt., .le., .ge., .and., .or., .not., .eqv., .neqv.,
  // plus user-defined operators .<letter-list>. (up to 63 chars per Fortran spec).
  // Scan backward to the matching opening `.` rather than capping at a fixed slice length.
  if (char === '.') {
    const minStart = Math.max(0, i - 64);
    for (let k = i - 1; k >= minStart; k--) {
      const c = source[k];
      if (c === '.') {
        const textBefore = source.slice(k, i + 1);
        if (FORTRAN_DOT_OPERATOR_PATTERN.test(textBefore)) {
          return true;
        }
        break;
      }
      if (!/[a-zA-Z]/.test(c)) {
        break;
      }
    }
  }
  // Fortran statement keywords that take identifiers: call end, save enddo, etc.
  if (/[a-zA-Z]/.test(char)) {
    let wordStart = i;
    while (wordStart > 0 && /[a-zA-Z]/.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.slice(wordStart, i + 1).toLowerCase();
    if (FORTRAN_STATEMENT_KEYWORDS.has(word)) {
      return true;
    }
  }
  // Digit predecessor indicates the keyword is the tail of a numeric-literal expression
  // continued across a `&` line break, e.g. `x = 42 &\n  end` (where `end` is a variable
  // being assigned). Without this, a bare `end` following a digit-ending expression would
  // be misread as a real block_close and phantom-close the enclosing block.
  // Both integer literals (`42`) and floating-point literals (`1.5e10`, `1.0d-3`) end with
  // a digit so the same check handles both.
  // Restricted to continuations (`crossedContinuation`) so single-line labeled statements
  // (`100 end do`) are not classified as expression context.
  if (crossedContinuation && char >= '0' && char <= '9') {
    return true;
  }
  return false;
}

// Detects block_middle keyword in expression context (used as variable, not as block intermediate)
// Stricter than isPrecededByOperator: excludes ')' since it is a valid predecessor for `then` after `if (...)`
export function isMiddleInExpressionContext(source: string, position: number): boolean {
  // A fixed-form column-6 continuation marker (`+`, `$`, `*`, etc.) is a continuation
  // token, not an arithmetic operator. Without this guard, `if (a)\n     +then` would
  // read the col-6 `+` as a `+ then` expression and drop the `then` intermediate.
  if (isAfterFixedFormContinuationMarker(source, position)) {
    return false;
  }
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  if (i < 0) return false;
  const char = source[i];
  if (char === '+' || char === '-' || char === '/' || char === '*' || char === '%') {
    return true;
  }
  if (char === '>' || char === '<') {
    return true;
  }
  if (char === ',') {
    let c = i - 1;
    while (c >= 0 && (source[c] === ' ' || source[c] === '\t')) {
      c--;
    }
    if (c >= 0 && source[c] !== '\n' && source[c] !== '\r') {
      return true;
    }
  }
  if (char === '=') {
    return true;
  }
  // Fortran dot-operators: .eq., .ne., .lt., .gt., .le., .ge., .and., .or., .not., .eqv., .neqv.,
  // and user-defined operators .<letter-list>. (up to 63 chars per Fortran spec).
  // Scan backward to the matching opening `.` then validate against the dot-operator pattern.
  if (char === '.') {
    // Fortran user-defined operator names are letters only and at most 63 chars,
    // so the matching `.` is within (63 + 1) = 64 chars to the left.
    const minStart = Math.max(0, i - 64);
    for (let k = i - 1; k >= minStart; k--) {
      const c = source[k];
      if (c === '.') {
        const textBefore = source.slice(k, i + 1);
        if (FORTRAN_DOT_OPERATOR_PATTERN.test(textBefore)) {
          return true;
        }
        break;
      }
      if (!/[a-zA-Z]/.test(c)) {
        break;
      }
    }
  }
  return false;
}

// Returns true if `position` immediately follows a fixed-form column-6 continuation
// marker, i.e. `position` is column 7 (offset lineStart + 6) of a physical line whose
// columns 1-5 are blank or a numeric label and whose column 6 holds a valid fixed-form
// continuation marker (non-blank, non-letter, non-0, non-comment). Mirrors the rule used
// by the parser's isFixedFormContinuationMarkerAt / fixedFormContinuationContentStart.
function isAfterFixedFormContinuationMarker(source: string, position: number): boolean {
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  const col6 = lineStart + 5;
  // The keyword must begin in column 7 (just past the column-6 marker).
  if (position !== col6 + 1 || col6 >= source.length) {
    return false;
  }
  // A comment marker in column 1 (C/c/*/!) disqualifies the line.
  const col1 = source[lineStart];
  if (col1 === 'C' || col1 === 'c' || col1 === '*' || col1 === '!') {
    return false;
  }
  // Columns 1-5 must be blank or a numeric label (spaces/digits only).
  for (let c = lineStart; c < col6; c++) {
    const ch = source[c];
    if (ch !== ' ' && !(ch >= '0' && ch <= '9')) {
      return false;
    }
  }
  const marker = source[col6];
  if (marker === ' ' || marker === '\t' || marker === '\n' || marker === '\r' || marker === '0' || marker === '!') {
    return false;
  }
  if ((marker >= 'a' && marker <= 'z') || (marker >= 'A' && marker <= 'Z')) {
    return false;
  }
  return true;
}

// Walks backward from the physical line that begins at `lineStart`, skipping blank and
// comment-only lines, and returns the index of the last code character (stripping the
// inline comment, respecting strings) of the first preceding content-bearing line.
// Returns -1 when no such line exists.
function findPrevLineLastCodeCharIndex(source: string, lineStart: number): number {
  let cursor = lineStart;
  while (cursor > 0) {
    let lineEnd = cursor - 1;
    if (source[lineEnd] === '\n' && lineEnd > 0 && source[lineEnd - 1] === '\r') {
      lineEnd--;
    }
    let prevStart = lineEnd;
    while (prevStart > 0 && source[prevStart - 1] !== '\n' && source[prevStart - 1] !== '\r') {
      prevStart--;
    }
    const codeEnd = findLineCodePortionEnd(source, prevStart);
    if (codeEnd >= prevStart) {
      return codeEnd;
    }
    // Blank or comment-only line: continue scanning the line before it.
    cursor = prevStart;
  }
  return -1;
}

// Validates that `then` follows a closing paren `)` from an if-construct header.
// A bare `then` at line start (with only whitespace/&-continuation before it on its
// physical line and no `)` reachable through backward continuation) is not a real
// block_middle - it's a misplaced identifier and must be skipped.
export function isThenAfterParen(source: string, position: number): boolean {
  // Fixed-form column-6 continuation: `if (a)` on one line, then `     +then` on the
  // next where column 6 holds the continuation marker. The if-header `)` is the last
  // code char of the previous physical line. Recognize this before the same-line scan
  // so `then` is captured as an intermediate.
  if (isAfterFixedFormContinuationMarker(source, position)) {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    const prevEnd = findPrevLineLastCodeCharIndex(source, lineStart);
    return prevEnd >= 0 && source[prevEnd] === ')';
  }
  let i = position - 1;
  // Skip same-line whitespace
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  if (i < 0) return false;
  // Direct predecessor `)`: this is the standard `if (cond) then` form
  if (source[i] === ')') return true;
  // Allow leading `&` on the current physical line (continuation)
  if (source[i] === '&') {
    i--;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    if (source[i] === ')') return true;
  }
  // Cross-line: backtrack through `&` continuation lines, comment-only lines, blank
  // lines. Look for `)` at the end of the previous code line.
  while (i >= 0 && (source[i] === '\n' || source[i] === '\r')) {
    // Find start of previous physical line
    let lineEnd = i;
    if (source[lineEnd] === '\n' && lineEnd > 0 && source[lineEnd - 1] === '\r') {
      lineEnd--;
    }
    let lineStart = lineEnd;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    let lineContent = source.slice(lineStart, lineEnd);
    // Strip inline comment
    const commentIdx = findInlineCommentIndex(lineContent);
    if (commentIdx >= 0) {
      lineContent = lineContent.slice(0, commentIdx);
    }
    const trimmed = lineContent.trimEnd();
    // Comment-only / blank line: keep walking backward
    if (trimmed.length === 0) {
      i = lineStart - 1;
      continue;
    }
    // Previous line must end with `&` (continuation) for cross-line scan to be valid
    if (!trimmed.endsWith('&')) {
      return false;
    }
    // Look at the last code character before the `&`
    let endIdx = trimmed.length - 1; // points at '&'
    endIdx--;
    while (endIdx >= 0 && (trimmed[endIdx] === ' ' || trimmed[endIdx] === '\t')) {
      endIdx--;
    }
    if (endIdx < 0) {
      // Bare `&` line, walk back further
      i = lineStart - 1;
      continue;
    }
    return trimmed[endIdx] === ')';
  }
  return false;
}

// Validates block close keywords
// Rejects 'end' used as variable name (followed by = but not ==) or component access (% before end)
export function isValidFortranBlockClose(keyword: string, source: string, position: number): boolean {
  // Reject end keywords inside parentheses (conditions, function arguments)
  if (isInsideParentheses(source, position)) {
    return false;
  }
  // Reject end/compound-end preceded by operator or comma (used as variable in expression)
  if (isPrecededByOperator(source, position)) {
    return false;
  }
  // For compound end keywords (enddo, endif, etc.), check after the full keyword
  const lowerKw = keyword.toLowerCase();
  if (lowerKw !== 'end' && lowerKw.startsWith('end')) {
    let i = position + keyword.length;
    const firstCharAfterKw = i < source.length ? source[i] : '';
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Handle & continuation: enddo &\n  = ... (assignment across lines)
    if (i < source.length && source[i] === '&') {
      i++;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      if (i < source.length && source[i] === '\r') i++;
      if (i < source.length && source[i] === '\n') i++;
      i = skipCommentAndContinuationLines(source, i);
      while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
        i++;
      }
      if (i < source.length && source[i] === '&') {
        i++;
        while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
          i++;
        }
      }
    }
    if (i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
      return false;
    }
    if (i < source.length && (source[i] === '(' || source[i] === '[')) {
      const j = skipConsecutiveBracketGroups(source, i);
      let k = j;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k < source.length && source[k] === '=' && (k + 1 >= source.length || source[k + 1] !== '=')) {
        return false;
      }
      // Keyword directly followed by ( or [ with no = or % after groups:
      // function call / array indexing / coarray image selector pattern (e.g., `enddo[1]`)
      if (firstCharAfterKw === '(' || firstCharAfterKw === '[') {
        return false;
      }
    }
    if (i < source.length && source[i] === '%') {
      return false;
    }
    // Compound-end keyword followed by // is string concatenation, not block close
    if (i + 1 < source.length && source[i] === '/' && source[i + 1] === '/') {
      return false;
    }
    return true;
  }
  if (lowerKw !== 'end') {
    return true;
  }
  // component%end is derived type component access, not block close
  let j = position - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j >= 0 && source[j] === '%') {
    return false;
  }
  let i = position + keyword.length;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  // Reject I/O statements that begin with a bare END followed by an I/O keyword:
  //   END FILE [unit], END RECORD, END STREAM (Fortran 77/90+ I/O statements).
  // The compound forms ENDFILE, ENDRECORD, ENDSTREAM (no space) are not affected
  // because they don't match `\bend\b` boundary.
  if (i < source.length) {
    const remaining = source.slice(i);
    if (/^(?:file|record|stream)\b/i.test(remaining)) {
      return false;
    }
  }
  // end%component is derived type component access, not block close
  if (i < source.length && source[i] === '%') {
    return false;
  }
  // end // "world" is string concatenation, not block close
  if (i + 1 < source.length && source[i] === '/' && source[i + 1] === '/') {
    return false;
  }
  // Handle & continuation: end &\n  = ... (assignment across lines)
  if (i < source.length && source[i] === '&') {
    i++;
    // Skip to next line
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      i++;
    }
    if (i < source.length && source[i] === '\r') i++;
    if (i < source.length && source[i] === '\n') i++;
    // Skip comment-only lines and bare & continuation lines between end & and content
    i = skipCommentAndContinuationLines(source, i);
    // Skip whitespace on next line
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Skip optional & continuation marker on the next line
    if (i < source.length && source[i] === '&') {
      i++;
      while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
        i++;
      }
    }
  }
  // end &\n// "text" (string concatenation across continuation)
  if (i + 1 < source.length && source[i] === '/' && source[i + 1] === '/') {
    return false;
  }
  // end &\n%component (derived type component access across continuation)
  if (i < source.length && source[i] === '%') {
    return false;
  }
  // end &\n  file/record/stream (I/O statements across continuation)
  if (i < source.length) {
    const remainingAfterContinuation = source.slice(i);
    if (/^(?:file|record|stream)\b/i.test(remainingAfterContinuation)) {
      return false;
    }
  }
  // end = ... (assignment) but not end == ... (comparison)
  if (i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
    return false;
  }
  // end(1) = ... / end[1] = ... / end(1)(2) = ... / end[1][2] = ... (array element / coarray image assignment)
  if (i < source.length && (source[i] === '(' || source[i] === '[')) {
    let j = skipConsecutiveBracketGroups(source, i);
    // Handle & continuation after group: end(1) &\n  = value
    if (j < source.length && source[j] === '&') {
      j++;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        j++;
      }
      if (j < source.length && source[j] === '\r') j++;
      if (j < source.length && source[j] === '\n') j++;
      // Skip comment-only lines and bare & continuation lines
      j = skipCommentAndContinuationLines(source, j);
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
        j++;
      }
      if (j < source.length && source[j] === '&') {
        j++;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }
      }
    }
    if (j < source.length && source[j] === '=' && (j + 1 >= source.length || source[j + 1] !== '=')) {
      return false;
    }
    // end(1)%x = ... (derived type component access)
    if (j < source.length && source[j] === '%') {
      return false;
    }
  }
  return true;
}

// Skips comment-only lines and bare & continuation lines
function skipCommentAndContinuationLines(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    let lineContentStart = i;
    while (lineContentStart < source.length && (source[lineContentStart] === ' ' || source[lineContentStart] === '\t')) {
      lineContentStart++;
    }
    if (lineContentStart < source.length && source[lineContentStart] === '!') {
      // Comment-only line: skip to end of line
      let lineEnd = lineContentStart;
      while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
        lineEnd++;
      }
      if (lineEnd < source.length && source[lineEnd] === '\r') lineEnd++;
      if (lineEnd < source.length && source[lineEnd] === '\n') lineEnd++;
      i = lineEnd;
      continue;
    }
    // Bare & continuation line or & with inline comment
    if (lineContentStart < source.length && source[lineContentStart] === '&') {
      let afterAmp = lineContentStart + 1;
      while (afterAmp < source.length && (source[afterAmp] === ' ' || source[afterAmp] === '\t')) {
        afterAmp++;
      }
      // Bare & or & followed by comment
      if (afterAmp >= source.length || source[afterAmp] === '\n' || source[afterAmp] === '\r' || source[afterAmp] === '!') {
        let lineEnd = afterAmp;
        while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
          lineEnd++;
        }
        if (lineEnd < source.length && source[lineEnd] === '\r') lineEnd++;
        if (lineEnd < source.length && source[lineEnd] === '\n') lineEnd++;
        i = lineEnd;
        continue;
      }
    }
    break;
  }
  return i;
}

// Skips consecutive bracket groups: end(1)(2)(3) or end[1][2] or end(1)[2]
// Handles both parenthesis groups (array indexing / function calls) and square bracket
// groups (Fortran 2008+ coarray image selectors).
function skipConsecutiveBracketGroups(source: string, start: number): number {
  let j = start;
  while (j < source.length && (source[j] === '(' || source[j] === '[')) {
    const open = source[j];
    const close = open === '(' ? ')' : ']';
    let depth = 1;
    j++;
    while (j < source.length && depth > 0) {
      // Skip string literals inside grouped expressions
      if ((source[j] === "'" || source[j] === '"') && depth > 0) {
        const quote = source[j];
        j++;
        while (j < source.length) {
          if (source[j] === quote) {
            j++;
            // Doubled quote is an escape, not a terminator
            if (j < source.length && source[j] === quote) {
              j++;
              continue;
            }
            break;
          }
          j++;
        }
        continue;
      }
      if (source[j] === open) depth++;
      else if (source[j] === close) depth--;
      j++;
    }
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
  }
  return j;
}
