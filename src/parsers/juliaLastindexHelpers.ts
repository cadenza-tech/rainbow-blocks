// Julia lastindex/firstindex helpers: classify end/begin keywords inside indexing brackets

import type { ExcludedRegion } from '../types';
import type { JuliaHelperCallbacks } from './juliaHelpers';
import { isIndexingBracket, isTransposeOperator } from './juliaHelpers';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Checks whether the character at `pos` is the start of a binary operator that can
// follow `end` as lastindex (e.g., `!=`, `==`, `+`, `-`, `<`, `>`, `<=`, `>=`, `:`,
// `&`, `&&`, `|`, `||`, `=>`). The colon case excludes `::` (type assertion) because
// the parser already classifies `end::` via isPrecededByBinaryOperator on the closing
// side; here we only care about the bare range/Pair-start `:`. This must stay in sync
// with isPrecededByBinaryOperator so that `<op>end<op>` is rejected from both sides
// rather than only the trailing side.
function isBinaryOperatorStart(source: string, pos: number): boolean {
  const c = source[pos];
  const c2 = pos + 1 < source.length ? source[pos + 1] : '';
  if (c === '!' && c2 === '=') return true;
  if (c === '=' && c2 === '=') return true;
  if (c === '=' && c2 === '>') return true;
  if (c === '<' && c2 === '=') return true;
  if (c === '>' && c2 === '=') return true;
  if (c === '<' && c2 !== ':') return true;
  if (c === '>' && c2 !== ':') return true;
  if (c === '+') return true;
  if (c === '-') return true;
  if (c === '*') return true;
  if (c === '/') return true;
  if (c === '%') return true;
  if (c === '^') return true;
  if (c === ':' && c2 !== ':') return true;
  if (c === '&') return true;
  if (c === '|') return true;
  return false;
}

// Checks if the `end` at `position` is followed by a binary operator (after optional whitespace).
export function isFollowedByBinaryOperator(source: string, position: number): boolean {
  let i = position + 3;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  if (i >= source.length) return false;
  return isBinaryOperatorStart(source, i);
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
    return false;
  }
  return false;
}

// Like hasUnmatchedBlockOpenerBetween, but treats `end` followed by a binary
// operator (e.g., `end!=`, `end+`, `end<`) as lastindex rather than block close.
// Used inside indexing brackets where lastindex expressions are common.
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
  if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
    const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
    const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
    if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
      if (!callbacks.isAdjacentToUnicodeLetter(source, firstNonWhite, 3) && before !== '.') {
        depth++;
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
    if (
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
            // Skip whitespace after `end` to find the next non-whitespace char.
            let k = i + 3;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
            const isLastindex = k < source.length && isBinaryOperatorStart(source, k);
            if (!isLastindex && depth > 0) depth--;
          }
          i += 2;
          continue;
        }
      }
    }
    // Check for block openers
    for (const keyword of openersWithoutFor) {
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
export function allUnmatchedOpenersAreFilteredBegins(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let nonBeginDepth = 0;
  let beginDepth = 0;
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
            let k = i + 3;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
            const isLastindex = k < source.length && isBinaryOperatorStart(source, k);
            if (isLastindex) {
              i += 2;
              continue;
            }
            // Prefer canceling non-begin openers first (they are real blocks).
            if (nonBeginDepth > 0) {
              nonBeginDepth--;
            } else if (beginDepth > 0) {
              beginDepth--;
            }
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
        if (kw === 'begin') {
          beginDepth++;
        } else {
          nonBeginDepth++;
        }
        i += kw.length - 1;
        break;
      }
    }
  }
  return nonBeginDepth === 0;
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
