// MATLAB pure scan helpers: keyword-context detection by source character inspection

// Checks if position is at line start allowing leading whitespace.
// Also skips a leading UTF-8/UTF-16 BOM (U+FEFF) so files saved with a byte-order mark
// still recognise block comments (`%{`/`#{`) and shell escapes (`!`) at the file start.
export function isAtLineStartWithWhitespace(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '﻿')) {
    i--;
  }
  return i < 0 || source[i] === '\n' || source[i] === '\r';
}

// Checks if position is at the start of a statement (line start or after ; , )
// Also skips a leading UTF-8/UTF-16 BOM (U+FEFF) so files saved with a byte-order mark
// still recognise the leading shell escape (`!`) at the file start.
export function isAtStatementStart(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '﻿')) {
    i--;
  }
  if (i < 0) return true;
  const ch = source[i];
  return ch === '\n' || ch === '\r' || ch === ';' || ch === ',';
}

// Returns true when `position` lies at the start of its line (only whitespace before).
// Used by phantom section detection to identify cases where a stray `end` is likely.
export function isAtLineStartForSectionKeyword(source: string, position: number): boolean {
  const lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
  return !/\S/.test(source.slice(lineStart, position));
}

// Checks if position is preceded by `@` (function handle prefix: @keyword)
// Strictly speaking MATLAB requires `@name` with no whitespace, but to avoid
// destroying outer block pairing in code like `h = @ for x;`, we also treat
// `@` with intervening same-line whitespace (space/tab) as a function handle
// marker. This follows the best-effort parsing principle: invalid syntax should
// not corrupt surrounding valid blocks.
export function isPrecededByAtSign(source: string, position: number): boolean {
  if (position <= 0) return false;
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  return i >= 0 && source[i] === '@';
}

// Checks if keyword is followed by = (but not ==) indicating variable assignment
export function isFollowedBySimpleAssignment(source: string, afterPos: number): boolean {
  let i = afterPos;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  return i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=');
}

// Checks if a keyword (whose end is `afterPos`) is followed (after whitespace) by a
// compound assignment operator: `+= -= *= /= ^= \=` and the `.`-prefixed element-wise
// forms `.^= .*= ./= .\=`. Such a form (`end += 1` ≡ `end = end + 1`) uses the keyword
// as an assignment target, so the keyword is a variable, not a block close. Comparison
// operators (`==`, `~=`, `<=`, `>=`, `!=`) are intentionally NOT matched: they are not
// compound assignments, and a real block close may be followed by a stray comparison.
export function isFollowedByCompoundAssignment(source: string, afterPos: number): boolean {
  let i = afterPos;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  if (i >= source.length) {
    return false;
  }
  const ch = source[i];
  const next = i + 1 < source.length ? source[i + 1] : '';
  // Plain compound assignment: arithmetic/division operator directly followed by `=`.
  if (next === '=' && (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\')) {
    return true;
  }
  // Element-wise compound assignment: `.` then an operator then `=` (`.^=`, `.*=` ...).
  if (ch === '.' && i + 2 < source.length && source[i + 2] === '=') {
    return next === '*' || next === '/' || next === '^' || next === '\\';
  }
  return false;
}

// Returns true when a block-opener keyword (whose end is `afterPos`) is immediately
// followed (after whitespace) by an operator that makes the keyword an operand or an
// assignment target rather than a real block opener:
//   * A compound assignment (`+= -= *= /= ^= \= .^= .*=` ...) — the keyword is the
//     assignment target (`for += 1` ≡ `for = for + 1`). Rejected for every keyword.
//   * A strictly-binary operator (`* / ^ \ < > & |` or `:`) and the comparison
//     operators (`== ~= != <= >=`) — these can never start an expression, so the
//     keyword is the left operand (`while * 2`). Rejected for every keyword.
//   * For `for`/`parfor` only, also the prefix-capable operators `+ - ~ !` — a
//     for-header must be `for var = ...`, so it can never start with any operator
//     (`for + 1`). `if`/`while`/`switch` take an expression that legitimately can
//     start with a unary `+ - ~ !` (e.g. `if ~isempty(x)`), so those are NOT rejected.
// A single `=` (plain assignment, e.g. `for = 5`) is intentionally NOT handled here —
// isFollowedBySimpleAssignment covers that variable-name case.
export function isFollowedByBinaryOperator(source: string, afterPos: number, keyword: string): boolean {
  let i = afterPos;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  if (i >= source.length) {
    return false;
  }
  const ch = source[i];
  const next = i + 1 < source.length ? source[i + 1] : '';
  // Compound assignment: operator char (optionally `.`-prefixed) directly followed by
  // `=`, but not the comparison operators `==`/`~=`/`<=`/`>=`/`!=`.
  if (next === '=') {
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\' || ch === '&' || ch === '|') {
      return true;
    }
  }
  // `.`-prefixed compound assignment (`.^=`, `.*=`, `./=`, `.\=`).
  if (ch === '.' && i + 2 < source.length && source[i + 2] === '=') {
    const op = next;
    if (op === '*' || op === '/' || op === '^' || op === '\\') {
      return true;
    }
  }
  // Strictly-binary operators that can never begin an expression.
  if ('*/^\\<>&|:'.includes(ch)) {
    return true;
  }
  // Comparison operators built on `=`/`~`/`!`: `==`, `~=`, `!=`.
  if (ch === '=' && next === '=') {
    return true;
  }
  if ((ch === '~' || ch === '!') && next === '=') {
    return true;
  }
  // for/parfor headers must be `for var = ...` and can never start with any operator,
  // including the prefix-capable `+ - ~ !`.
  if ((keyword === 'for' || keyword === 'parfor') && (ch === '+' || ch === '-' || ch === '~' || ch === '!')) {
    return true;
  }
  return false;
}

// Checks if a classdef section keyword is used as a function call
// Returns true if the keyword is followed by '(' and preceded by
// assignment, expression operator, or appears inside an expression
export function isKeywordUsedAsFunctionCall(source: string, position: number, keyword: string): boolean {
  // Check if followed by '(' (skip whitespace)
  let afterPos = position + keyword.length;
  while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
    afterPos++;
  }
  if (afterPos >= source.length || source[afterPos] !== '(') {
    return false;
  }

  // Check if preceded by an expression context on the same line
  let beforePos = position - 1;
  while (beforePos >= 0 && (source[beforePos] === ' ' || source[beforePos] === '\t')) {
    beforePos--;
  }
  if (beforePos < 0 || source[beforePos] === '\n' || source[beforePos] === '\r') {
    // At start of line followed by '(' - function call like properties(obj)
    // But classdef section keywords at line start with '(' after are also
    // valid as access modifiers: properties (Access = public)
    // Check if there's a matching ')' then look at what follows
    // A simpler heuristic: if preceded by '=', ',', '(', '[', '{', or ';' it's a call
    return false;
  }

  const prevChar = source[beforePos];
  // If preceded by =, (, [, {, , or ; it's being used in an expression context
  if (prevChar === '=' || prevChar === '(' || prevChar === '[' || prevChar === '{' || prevChar === ',' || prevChar === ';') {
    return true;
  }

  return false;
}
