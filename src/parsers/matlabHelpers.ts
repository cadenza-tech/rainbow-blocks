// MATLAB scan helpers: keyword-context detection by source and excluded-region scanning

import type { ExcludedRegion } from '../types';
import { findExcludedRegionAt } from './parserUtils';

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
// compound assignment operator: `+= -= *= /= ^= \= &= |=` and the `.`-prefixed
// element-wise forms `.^= .*= ./= .\=`. Such a form (`end += 1` ≡ `end = end + 1`,
// `end &= 1` ≡ `end = end & 1`) uses the keyword as an assignment target, so the keyword
// is a variable, not a block close. The operator set is kept symmetric with the block-open
// side (isFollowedByBinaryOperator) which already rejects `&= |=`. Comparison operators
// (`==`, `~=`, `<=`, `>=`, `!=`) are intentionally NOT matched: they are not compound
// assignments, and a real block close may be followed by a stray comparison.
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
  // Plain compound assignment: arithmetic/division/logical operator directly followed by
  // `=` (`+= -= *= /= ^= \= &= |=`). The `&`/`|` forms are logical compound assignments
  // (`end &= 1` ≡ `end = end & 1`) and must reject `end` as a block close, symmetric with
  // the block-open side (isFollowedByBinaryOperator).
  if (next === '=' && (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\' || ch === '&' || ch === '|')) {
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
//   * For `for`/`parfor`/`try`/`spmd`/`classdef` only, also the prefix-capable
//     operators `+ - ~ !` — a `for` header must be `for var = ...`, and `try`/`spmd`/
//     `classdef` either take no expression (`try`), an optional parenthesised worker
//     count (`spmd`), or an identifier name (`classdef`). None of them can legitimately
//     begin with any operator, so `try + 1` / `spmd ~x` / `classdef + 1` are invalid.
//     `if`/`while`/`switch` take an expression that legitimately can start with a unary
//     `+ - ~ !` (e.g. `if ~isempty(x)`), so those are NOT rejected.
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
  // including the prefix-capable `+ - ~ !`. try/spmd/classdef likewise take no
  // expression in their header (try: nothing, spmd: optional `(n)`, classdef: a name),
  // so they cannot begin with any operator either. if/while/switch DO take an
  // expression that can legitimately start with `+ - ~ !`, so they are NOT rejected.
  if (
    (keyword === 'for' || keyword === 'parfor' || keyword === 'try' || keyword === 'spmd' || keyword === 'classdef') &&
    (ch === '+' || ch === '-' || ch === '~' || ch === '!')
  ) {
    return true;
  }
  return false;
}

// Returns true when `end` (whose end is `afterPos`) is immediately followed by a binary
// operator that makes `end` a left operand: arithmetic `+ - * / ^ \`, logical `& |`, or
// element-wise `.^ .* ./ .\` (without `=`, which would be a compound assignment caught
// separately). Comparison operators (`==`, `~=`, `<=`, `>=`, `!=`) and `<`/`>`/`:` are
// deliberately NOT matched: a real block close may be followed by a stray comparison,
// and `end:5` belongs to a for-header range (already handled by isEndInForHeaderRange).
// Compound-assignment operators (`+= -= *=` ...) are NOT matched here because
// isFollowedByCompoundAssignment already covers them. Symmetric (but more permissive on
// comparisons) with the block-open side's isFollowedByBinaryOperator.
export function isEndFollowedByBinaryOperator(source: string, afterPos: number): boolean {
  let i = afterPos;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  if (i >= source.length) {
    return false;
  }
  const ch = source[i];
  const next = i + 1 < source.length ? source[i + 1] : '';
  // Strictly-binary arithmetic / logical operators that put `end` in left-operand context.
  // The trailing `=` check rules out compound-assignment forms (`+=`, `&=` ...) which the
  // compound-assignment helper handles separately.
  if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\' || ch === '&' || ch === '|') {
    if (next === '=') {
      return false;
    }
    return true;
  }
  // Element-wise binary operators (`.*`, `./`, `.^`, `.\`) — `.+` and `.-` are not MATLAB
  // syntax, so they are not matched. The `..` (continuation marker prefix) and `...` cases
  // are excluded by requiring a known operator char as the second char.
  if (ch === '.' && i + 1 < source.length) {
    const op = next;
    if (op === '*' || op === '/' || op === '^' || op === '\\') {
      // Reject only when this is NOT a compound assignment (`.*=`); that form is handled
      // by isFollowedByCompoundAssignment.
      const third = i + 2 < source.length ? source[i + 2] : '';
      if (third === '=') {
        return false;
      }
      return true;
    }
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

// Returns true when `end` at position is preceded by an expression operator that makes
// `end` an operand outside any array-indexing context. Such uses (`x = end`, `x = 1:end`,
// `x = ~end`, `for i = end-1:5`) are invalid MATLAB outside indexing; treating them as
// block_close destroys outer block pairing. The for-header range check (isEndInForHeaderRange)
// is invoked before this and handles legitimate `for i = N:end` / `for i = end:N` cases.
export function isPrecededByBinaryOperator(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    // Skip excluded regions backward for line continuations (... in MATLAB and \ in Octave).
    // The continuation region spans from the marker through the trailing newline; jumping
    // to region.start - 1 lands us on the character that immediately precedes the
    // continuation on the previous logical line.
    if (excludedRegions) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
        i = region.start - 1;
        continue;
      }
    }
    if (source[i] === ' ' || source[i] === '\t') {
      i--;
      continue;
    }
    // A bare newline reached during backward scan may sit immediately after a `...`
    // (or `\`) line continuation. matchSingleLineComment for `...` ends at the newline
    // start, so an excluded region whose end == nlStart and which begins with `.` or `\`
    // signals a continuation; in that case we keep walking past the prior logical line.
    if ((source[i] === '\n' || source[i] === '\r') && excludedRegions) {
      let nlStart = i;
      if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') {
        nlStart = i - 1;
      }
      const regionBeforeNl = findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
      if (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) {
        i = regionBeforeNl.start - 1;
        continue;
      }
    }
    break;
  }
  if (i < 0) return false;
  const ch = source[i];
  // Operators that put `end` in an expression context.
  // `\` is MATLAB's left-division operator; treat it like other binary operators.
  // `!` is logical-NOT (Octave) / a unary operator; `!end` puts `end` in operand context.
  if ('+*/^<>&|~:\\!'.includes(ch)) return true;
  // `=` marks an operator. Both single `=` (assignment) and compound comparison operators
  // (`==`, `>=`, `<=`, `!=`, `~=`) put `end` in expression context (operand): `end` on the
  // RHS / after a comparison is invalid outside indexing, so return true to reject the
  // bogus block_close.
  if (ch === '=') {
    return true;
  }
  // `-` could be unary; treat it as a value-context marker (i.e. end is operand) when
  // (a) it follows a value-like char (binary minus), or
  // (b) it follows `=`, `(`, `,`, `;`, `[`, `{`, or another operator (unary minus on RHS).
  if (ch === '-') {
    let j = i - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) j--;
    if (j < 0) return false;
    const prev = source[j];
    if (/[a-zA-Z0-9_)\]}]/.test(prev)) return true;
    if (prev === '=' || prev === '(' || prev === ',' || prev === ';' || prev === '[' || prev === '{') return true;
    if ('+*/^<>&|~:\\!'.includes(prev)) return true;
    return false;
  }
  return false;
}

// Checks if position is preceded by dot (possibly with whitespace: s . end)
// Handles ... line continuation: obj. ...\n    end is struct field access
export function isPrecededByDot(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    // Skip excluded regions backward for line continuations (... and \ in Octave)
    if (excludedRegions) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
        i = region.start - 1;
        continue;
      }
    }
    if (source[i] === ' ' || source[i] === '\t') {
      i--;
      continue;
    }
    // Skip newlines that are immediately after an excluded region that is a ... line continuation
    // matchSingleLineComment sets region.end to the newline position, so check if any
    // excluded region ends exactly at this newline position AND starts with '.' (continuation)
    if ((source[i] === '\n' || source[i] === '\r') && excludedRegions) {
      let nlStart = i;
      if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') {
        nlStart = i - 1;
      }
      const regionBeforeNl = findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
      const regionBeforeLf = findExcludedRegionAt(i > 0 ? i - 1 : 0, excludedRegions);
      if (
        (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) ||
        (regionBeforeLf?.end === i && (source[regionBeforeLf.start] === '.' || source[regionBeforeLf.start] === '\\'))
      ) {
        i = nlStart - 1;
        continue;
      }
      // Note: bare trailing dot without ... is NOT a continuation in MATLAB/Octave
      // obj.\nend means end is on a new line (not preceded by dot for struct access)
    }
    break;
  }
  // Distinguish struct field access dot (obj.end, data1.end) from numeric decimal point (10.)
  if (i >= 0 && source[i] === '.') {
    // Scan backward past digits, hex letters, and hex/binary prefix letters that form numeric literals
    let j = i - 1;
    while (j >= 0 && /[0-9a-fA-FxXbB_]/.test(source[j])) {
      j--;
    }
    // Check for numeric literal patterns: digits only, exponent (1e5), imaginary (1i/5j),
    // hex prefix (0xFF), binary prefix (0b1010)
    if (j < i - 1) {
      const numPart = source.slice(j + 1, i);
      // Reject when the run is preceded by another `.` — this means
      // the digits are part of a larger expression like `1.5.end`, not a clean numeric literal
      const beforeNum = j >= 0 ? source[j] : '';
      if (beforeNum === '.') {
        return true;
      }
      // Reject scientific notation followed by `.` (e.g., `1e5.end`):
      // `1e5.` is not a valid number suffix, so `.end` is struct field access
      if (/[eE]/.test(numPart)) {
        return true;
      }
      // Pure digits, hex literals (0x...), binary literals (0b...), or digits with suffixes
      // followed by `.keyword` form invalid syntax (e.g., `10.end`, `0xFF.if`).
      // When keyword directly abuts the dot (no whitespace/continuation), treat as filtered
      // to avoid breaking outer block highlighting. When separated, the dot is a decimal
      // point and the keyword is a separate statement opener.
      if (
        (/^[0-9][0-9a-fA-F_]*$/.test(numPart) || /^0[xX][0-9a-fA-F_]+$/.test(numPart) || /^0[bB][01_]+$/.test(numPart)) &&
        (j < 0 || !(/[a-zA-Z_]/.test(source[j]) || /\p{L}/u.test(source[j])))
      ) {
        if (i + 1 === position) {
          return true;
        }
        return false;
      }
    }
    return true;
  }
  return false;
}
