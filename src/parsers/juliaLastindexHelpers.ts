// Julia lastindex/firstindex helpers: classify end/begin keywords inside indexing brackets

import type { ExcludedRegion } from '../types';
import type { JuliaHelperCallbacks } from './juliaHelpers';
import { isIndexingBracket, isTransposeOperator } from './juliaHelpers';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Checks whether the character at `pos` is the start of a binary or postfix operator
// that can follow `end` as lastindex (e.g., `!=`, `==`, `+`, `-`, `<`, `>`, `<=`, `>=`,
// `:`, `&`, `&&`, `|`, `||`, `=>`, `\` left-division, `'` transpose, `.` broadcast
// prefix, Unicode operators, plus `::` type-assertion and `<:` `>:` subtype/supertype
// operators which are syntactically valid after lastindex inside indexing brackets).
// This must stay in sync with isPrecededByBinaryOperator so that `<op>end<op>` is
// rejected from both sides rather than only the trailing side.
function isBinaryOperatorStart(source: string, pos: number): boolean {
  const c = source[pos];
  const c2 = pos + 1 < source.length ? source[pos + 1] : '';
  if (c === '!' && c2 === '=') return true;
  if (c === '=' && c2 === '=') return true;
  if (c === '=' && c2 === '>') return true;
  if (c === '<' && c2 === '=') return true;
  if (c === '>' && c2 === '=') return true;
  // `<` (less than) and `<:` (subtype). `<:` would otherwise be rejected because the
  // parser's outside-indexing rejection path (`isPrecededBySubtypeOperator`) handles it
  // from the trailing side; but inside indexing brackets `end<:T` is a valid subtype
  // check on lastindex, so include it here as a "follower" that classifies the prior
  // `end` as lastindex.
  if (c === '<') return true;
  if (c === '>') return true;
  if (c === '+') return true;
  if (c === '-') return true;
  if (c === '*') return true;
  if (c === '/') return true;
  if (c === '%') return true;
  if (c === '^') return true;
  // Left division operator: `end \ 2` is lastindex left-divided by 2.
  if (c === '\\') return true;
  // Both bare `:` (range/Pair start, ternary) and `::` (type assertion) classify the
  // preceding `end` as lastindex. The trailing-side check (`isPrecededByBinaryOperator`)
  // also accepts both forms, so this stays symmetrical.
  if (c === ':') return true;
  if (c === '&') return true;
  if (c === '|') return true;
  // Postfix transpose: `end'` is transpose(lastindex). Treated as an operator so
  // `arr[end' == x]` recognizes the inner `end` as lastindex rather than a block close.
  if (c === "'") return true;
  // Broadcast operator prefix: `end .+ 1`, `end .== x`. `.` followed by an ASCII
  // operator character (or `=`) is a broadcasted operator. `end` cannot have field
  // access (it's a numeric lastindex value inside indexing brackets), so `.` here
  // is always a broadcast prefix.
  if (c === '.' && c2 !== '' && /[!%&*+\-/<=>?\\^|~]/.test(c2)) return true;
  // Unicode operators (math symbols outside the ASCII range), e.g., × U+00D7, ÷
  // U+00F7. Identifiers are excluded via the keyword-boundary check upstream, so a
  // non-ASCII char reaching here is an operator.
  if (c !== undefined && c.charCodeAt(0) > 127 && !/[\p{L}\p{N}]/u.test(c)) return true;
  return false;
}

// Checks if the `end` at `position` is followed by a binary operator (after optional
// whitespace and excluded regions like block comments `#= ... =#`). The excluded-region
// skip lets `arr[if end #= cmt =# != 2; ...; end]` correctly classify the inner `end`
// as `lastindex != 2` rather than as a block close. Newlines are NOT skipped: a binary
// operator on a later line does not bind to `end` on this line (so `end # cmt\n + 1`
// stops at the newline). Single-line comments inherently stop at the newline because
// their excluded region ends there, so they also do not let the scan cross lines.
export function isFollowedByBinaryOperator(source: string, position: number, excludedRegions: ExcludedRegion[] = []): boolean {
  let i = position + 3;
  while (i < source.length) {
    if (source[i] === ' ' || source[i] === '\t') {
      i++;
      continue;
    }
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    break;
  }
  if (i >= source.length) return false;
  return isBinaryOperatorStart(source, i);
}

// Checks if the `end` at `position` is immediately followed (no whitespace) by a postfix
// marker that signals `end` is being used as a value (lastindex-style): `?` (ternary
// condition), `(` (call), `[` (indexing), `{` (parameterized-type application), or `.`
// (field access or other non-operator follower). These appear in expressions like
// `end?(x):(y)`, `end(x)`, `end[x]`, `end{T}`, `end.foo`, `end..1`, `end.0`. Outside
// indexing brackets these are invalid Julia syntax, but classifying `end` as block_close
// in such contexts would mis-pair the surrounding block's real `end`.
//
// `.` handling: `.<op>` (broadcast operator like `.+`, `.==`, `.<`) is intentionally
// excluded so that value-returning blocks like `begin x end .+ 1` still close `begin`
// with the inner `end`. The broadcast operator chars are the ASCII operator characters
// `+ - * / % ^ \ < > = ! ? & | ~`. Any other follower after `.` (letter for field access,
// digit, quote, brace, dot, whitespace, EOF) means `end` is being used as a value, not as
// a block close.
//
// Note: `,` (tuple/argument separator) is intentionally NOT treated as a postfix marker
// here. In a call site like `f(begin 1 end, if ... end)`, the inner `end,` is a legitimate
// block close terminating the `begin` argument. The pathological `function f() end, more
// end` form is left as-is rather than rejecting `,` globally, because rejecting `,` would
// break the common valid `end,` pattern in calls and tuples (cost minimization: 1 invalid
// pattern preserved vs. many valid patterns broken).
export function isFollowedByPostfixIndexMarker(source: string, position: number): boolean {
  const i = position + 3;
  if (i >= source.length) return false;
  const c = source[i];
  if (c === '?' || c === '(' || c === '[' || c === '{') return true;
  if (c === '.') {
    const c2 = i + 1 < source.length ? source[i + 1] : '';
    // `.<broadcast-op>` (e.g. `.+`, `.==`, `.<=`) is a broadcast operator on `end`; treat
    // it as a binary-operator follower (block-close on a value-returning block). Mirrors
    // the broadcast-vs-field-access distinction in isBinaryOperatorStart's `.` handling.
    if (c2 !== '' && /[!%&*+\-/<=>?\\^|~]/.test(c2)) return false;
    // Any other follower after `.` (letter for field access, digit, quote, brace, dot,
    // whitespace, EOF) means `end` is being used as a value, not as a block close. Reject.
    return true;
  }
  return false;
}

// Checks if `end` at `position` is preceded by `<:` or `>:` (subtype/supertype operator).
// Skips intervening tabs/spaces (and excluded regions like comments) but stops at newlines
// or any other token. Used to reject `end` as a block_close in `where T<:end` and similar
// invalid syntax where `end` is being used as a (nonexistent) type. Newlines terminate the
// scan because `where T <:\nend` is best-effort treated as a mid-edit state where the
// trailing `end` should still pair with the surrounding block.
export function isPrecededBySubtypeOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '\n' || ch === '\r') {
      // Stop at newline: `<:` on a previous line should not affect this `end`.
      return false;
    }
    if (ch === ' ' || ch === '\t') {
      i--;
      continue;
    }
    // Found a non-whitespace char. Check if it's `:` preceded by `<` or `>`.
    if (ch === ':' && i > 0 && (source[i - 1] === '<' || source[i - 1] === '>')) {
      return true;
    }
    return false;
  }
  return false;
}

// Checks if `end` at `position` is preceded by a binary or postfix operator
// (e.g., `+`, `-`, `*`, `/`, `%`, `^`, `\`, `==`, `!=`, `<=`, `>=`, `<`, `>`, `=`, `:`,
// `::`, `&`, `&&`, `|`, `||`, `~`, `'` transpose).
// Skips intervening tabs/spaces but stops at newlines (so `A\n end` is unaffected).
// Used to reject `end` as block_close in expressions like `A+end`, `A*end`, `A'end`,
// `x = end`, `1:end`, `x::end`, `c && end`, `~end`, which are invalid syntax outside of
// indexing brackets but otherwise cause the inner `end` to pair with the surrounding
// block opener. `end` inside indexing brackets (e.g. `arr[1:end]`) is `lastindex` and is
// handled earlier by isInsideIndexingBrackets, so this check never sees it.
export function isPrecededByBinaryOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '\n' || ch === '\r') {
      return false;
    }
    if (ch === ' ' || ch === '\t') {
      i--;
      continue;
    }
    // Found a non-whitespace char. Check if it's a binary/postfix operator.
    // Single-char binary operators: + - * / % ^ \ ~
    // `\` is left division, `~` is the unary/bitwise-not operator.
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^' || ch === '\\' || ch === '~') {
      return true;
    }
    // Postfix transpose operator: ' (preceded by identifier or closing bracket).
    // We use the existing isTransposeOperator helper for accuracy.
    if (ch === "'" && isTransposeOperator(source, i)) {
      return true;
    }
    // Comparison operators: ==, !=, <=, >= (the `=` is the char immediately before `end`).
    if (ch === '=' && i > 0 && (source[i - 1] === '=' || source[i - 1] === '!' || source[i - 1] === '<' || source[i - 1] === '>')) {
      return true;
    }
    // Bare `=` assignment operator (not part of ==, !=, <=, >= handled just above).
    if (ch === '=') {
      return true;
    }
    // Bare < or >: bare comparison (not part of <: or >:, since those would have ':' here).
    if (ch === '<' || ch === '>') {
      return true;
    }
    // Colon `:` covers the range operator (`1:end`) and the type-annotation operator
    // (`x::end`, where the char before `end` is still `:`). The subtype operators `<:`
    // and `>:` are rejected earlier by isPrecededBySubtypeOperator, so a `:` reaching
    // here is always a range/annotation/ternary colon.
    if (ch === ':') {
      return true;
    }
    // Boolean operators: & (and `&&`), | (and `||`). The trailing `&`/`|` of the
    // short-circuit forms is the char immediately before `end`.
    if (ch === '&' || ch === '|') {
      return true;
    }
    // Unary `!` (logical NOT) before `end` is invalid syntax (`end` is not a value).
    // Distinguish from the trailing `!` of an identifier (`foo!end` was already filtered
    // by the tokenize step) and from the `!` of `!=` (which would have `=` immediately
    // after, but we scanned backward from `end` so the `=` would be at position+1, not
    // i+1). At this point `i` points at the `!` immediately preceding `end`, so
    // `source[i + 1]` is the first char of `end`. A `!` here is therefore a standalone
    // unary operator, never part of `!=`.
    if (ch === '!') {
      return true;
    }
    // Unicode binary operators (math symbols outside the ASCII range), e.g., × U+00D7,
    // ÷ U+00F7, ± U+00B1. Identifier characters (Unicode Letters and Numbers) are
    // excluded; what remains is operator-class. Mirrors isBinaryOperatorStart's Unicode
    // check so `<op>end<op>` is rejected from both sides rather than only the trailing
    // side. The tokenize step already rejects `end` adjacent to a Unicode letter (e.g.
    // `αend`), so a non-ASCII non-letter/non-number char reaching here is an operator.
    if (ch.charCodeAt(0) > 127 && !/[\p{L}\p{N}]/u.test(ch)) {
      return true;
    }
    return false;
  }
  return false;
}

// Like hasUnmatchedBlockOpenerBetween, but treats `end` followed by a binary
// operator (e.g., `end!=`, `end+`, `end<`) as lastindex rather than block close.
// Used inside indexing brackets where lastindex expressions are common.
//
// Block-form vs comprehension disambiguation: a `for` at the very start of the bracket
// content is block-form (a comprehension generator must be preceded by a value expression).
// When the leading `for` is recognized as block-form, subsequent `for`/`if` keywords inside
// its body (depth > 0) are also block-form (nested loops, nested conditionals). Only at
// depth 0 (no active block scope) does `<expr> for <var> in <iter>` switch the scan into
// comprehension mode, in which case `for` does not open a block and `if` becomes a filter.
export function hasUnmatchedBlockOpenerBetweenInIndexing(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  const openersWithoutFor = blockOpen.filter((kw) => kw !== 'for');
  let depth = 0;
  let inComprehensionContext = false;
  let bracketDepth = 0;

  // Detect leading block-form 'for' (after whitespace and excluded regions)
  let firstNonWhite = start;
  while (firstNonWhite < end) {
    if (isInExcludedRegion(firstNonWhite, excludedRegions)) {
      firstNonWhite++;
      continue;
    }
    const ch = source[firstNonWhite];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    firstNonWhite++;
  }
  let leadingForRecognized = false;
  if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
    const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
    const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
    if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
      if (!callbacks.isAdjacentToUnicodeLetter(source, firstNonWhite, 3) && before !== '.') {
        depth++;
        leadingForRecognized = true;
      }
    }
  }

  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '[') {
      bracketDepth++;
      continue;
    }
    if (source[i] === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    // Comprehension-context detection: `<value> for <var> in <iter>` switches subsequent
    // `if` into a filter. Only activates at depth 0 (no active block scope). Inside a
    // block body (e.g. the body of a leading block-form `for`), a `for ... in` is a
    // nested block-form loop and `if` is a nested conditional, not a comprehension.
    if (
      depth === 0 &&
      !inComprehensionContext &&
      source[i] === 'f' &&
      i + 3 <= end &&
      source.slice(i, i + 3) === 'for' &&
      !/[a-zA-Z0-9_]/.test(i > 0 ? source[i - 1] : ' ') &&
      !/[a-zA-Z0-9_]/.test(i + 3 < source.length ? source[i + 3] : ' ') &&
      !callbacks.isAdjacentToUnicodeLetter(source, i, 3)
    ) {
      const tail = source.slice(i + 3, end);
      if (/^[ \t]+\S+.*?(?:\bin\b|\b∈\b|=)/.test(tail)) {
        inComprehensionContext = true;
      }
    }
    // Check for 'end' keyword
    if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
        if (!callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
          if (before !== '.' && bracketDepth === 0) {
            // Check if `end` is followed by a binary operator (lastindex expression).
            // Skip whitespace and excluded regions (block comments) after `end` to find
            // the next non-whitespace, non-comment char.
            let k = i + 3;
            while (k < source.length) {
              if (source[k] === ' ' || source[k] === '\t') {
                k++;
                continue;
              }
              if (isInExcludedRegion(k, excludedRegions)) {
                const region = findExcludedRegionAt(k, excludedRegions);
                if (region) {
                  k = region.end;
                  continue;
                }
              }
              break;
            }
            const isLastindex = k < source.length && isBinaryOperatorStart(source, k);
            if (!isLastindex && depth > 0) depth--;
          }
          i += 2;
          continue;
        }
      }
    }
    // Block opener loop. Inside a block body (depth > 0), `for` is a nested block-form
    // loop and is counted as an opener. At depth 0, `for` is either the leading block-form
    // for (already counted above) or a comprehension generator that opens no block, so it
    // is excluded from the opener list. The leading-for keyword position itself is skipped
    // here because the pre-loop check already incremented depth for it.
    const openers = depth > 0 ? blockOpen : openersWithoutFor;
    for (const keyword of openers) {
      if (i + keyword.length <= end && source[i] === keyword[0] && source.slice(i, i + keyword.length) === keyword) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
        if (before === '.') continue;
        if (inComprehensionContext && keyword === 'if') continue;
        if (keyword === 'abstract' || keyword === 'primitive') {
          const afterKeyword = source.slice(i + keyword.length);
          if (!/^[ \t]+type\b/.test(afterKeyword)) continue;
        }
        // Skip the leading-for keyword position: it was already counted by the pre-loop
        // detection, so re-counting it here would double-count.
        if (keyword === 'for' && leadingForRecognized && i === firstNonWhite) {
          i += keyword.length - 1;
          break;
        }
        depth++;
        i += keyword.length - 1;
        break;
      }
    }
  }
  return depth > 0;
}

// Checks whether every unmatched opener in [start, end) is a `begin` keyword that
// the parser would filter as firstindex inside indexing brackets. The parser filters
// any bare `begin` inside indexing brackets (regardless of whether it is followed by `:`),
// so this method counts ALL bare `begin`s as filtered. Other block openers (if/for/let/...)
// are real block expressions in indexing brackets, and would NOT be filtered.
//
// Openers and closes are matched in LIFO order, mirroring Julia's parser: each `end`
// cancels the most recently opened block. This is the only correct way to know which
// opener remains unmatched at the end of the range (a non-LIFO heuristic would let an
// inner `end` belonging to one opener cancel a different opener, distorting the result).
export function allUnmatchedOpenersAreFilteredBegins(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  // Stack of opener types in source order. 'begin' tracks bare begin (filtered as
  // firstindex inside indexing brackets); 'other' tracks every other block opener.
  const openerStack: ('begin' | 'other')[] = [];
  let bracketDepth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '[') {
      bracketDepth++;
      continue;
    }
    if (source[i] === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.') {
        if (!callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
          if (bracketDepth === 0) {
            // Skip `end<binary-op>` (lastindex expression like `end!=2`, `end+1`).
            // Skip whitespace and excluded regions (block comments) after `end` to find
            // the next non-whitespace, non-comment char (matches isFollowedByBinaryOperator).
            let k = i + 3;
            while (k < source.length) {
              if (source[k] === ' ' || source[k] === '\t') {
                k++;
                continue;
              }
              if (isInExcludedRegion(k, excludedRegions)) {
                const region = findExcludedRegionAt(k, excludedRegions);
                if (region) {
                  k = region.end;
                  continue;
                }
              }
              break;
            }
            const isLastindex = k < source.length && isBinaryOperatorStart(source, k);
            if (isLastindex) {
              i += 2;
              continue;
            }
            // LIFO close: pop the most recently opened block.
            openerStack.pop();
          }
          i += 2;
          continue;
        }
      }
    }
    if (bracketDepth > 0) continue;
    for (const kw of blockOpen) {
      if (i + kw.length <= end && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (before === '.') continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
        if (kw === 'abstract' || kw === 'primitive') {
          const afterKeyword = source.slice(i + kw.length);
          if (!/^[ \t]+type\b/.test(afterKeyword)) continue;
        }
        openerStack.push(kw === 'begin' ? 'begin' : 'other');
        i += kw.length - 1;
        break;
      }
    }
  }
  return openerStack.every((kind) => kind === 'begin');
}

// Like allUnmatchedOpenersAreFilteredBegins, but also requires there to be an enclosing
// indexing `[` outside the current paren scope. Used for paren-handling in
// isInsideIndexingBrackets to recognize cases like `arr[(begin x end)]` where the
// inner `begin` is filtered as firstindex by virtue of the outer indexing bracket.
export function allUnmatchedOpenersAreFilteredBeginsInsideIndexing(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  if (!allUnmatchedOpenersAreFilteredBegins(source, start, end, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  // Confirm there is an enclosing indexing bracket outside the current paren.
  // Scan backward from start - 1 to find `[` at depth 0, ignoring ()s and []s that close.
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = start - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth === 0) continue;
      parenDepth--;
    } else if (ch === ']') {
      bracketDepth++;
    } else if (ch === '[') {
      if (bracketDepth === 0) {
        return isIndexingBracket(source, i);
      }
      bracketDepth--;
    }
  }
  return false;
}

// Checks whether every unmatched `begin` in [start, end) is the firstindex keyword
// (i.e., followed by `:`). Used to accept `arr[begin:end]` where `begin` is firstindex
// rather than a block opener. Scans with the full blockOpen list for openers and
// returns true only when the depth imbalance is entirely due to `begin:` occurrences.
export function allUnmatchedBeginsAreFirstindex(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  // Walk range; for each `begin` not followed by `:`, fail. Also count ends so that a
  // genuine block (`begin ... end`) cancels out. If no unmatched non-firstindex begin
  // remains, return true. Track [ ] bracket depth so `end` inside arr[end] (lastindex)
  // does not erroneously cancel a real block opener.
  let depth = 0;
  let nonFirstindexBegins = 0;
  let bracketDepth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '[') {
      bracketDepth++;
      continue;
    }
    if (source[i] === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.') {
        if (!callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
          if (bracketDepth === 0) {
            if (depth > 0) {
              depth--;
            } else if (nonFirstindexBegins > 0) {
              nonFirstindexBegins--;
            }
          }
          i += 2;
          continue;
        }
      }
    }
    // Skip block-opener detection inside [ ] (those are value contexts, not blocks).
    if (bracketDepth > 0) continue;
    for (const kw of blockOpen) {
      if (i + kw.length <= end && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (before === '.') continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
        if (kw === 'begin') {
          // Check if followed by `:` (firstindex syntax). Skip whitespace in between.
          let k = i + kw.length;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
          if (k < source.length && source[k] === ':' && source[k + 1] !== ':') {
            // firstindex; does not open a block
            i += kw.length - 1;
            break;
          }
          nonFirstindexBegins++;
          i += kw.length - 1;
          break;
        }
        depth++;
        i += kw.length - 1;
        break;
      }
    }
  }
  return depth === 0 && nonFirstindexBegins === 0;
}
