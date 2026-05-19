// Julia bracket-context helpers: classify keywords by surrounding (), [], {} context

import type { ExcludedRegion } from '../types';
import type { JuliaBracketIndex } from './juliaBracketIndex';
import type { JuliaHelperCallbacks } from './juliaHelpers';
import {
  hasAnyBlockOpenerBetween,
  hasAssignmentBetween,
  hasCommaAtDepthZero,
  hasForBetween,
  hasUnmatchedBlockOpenerBetween,
  isIndexingBracket,
  isOnlyWhitespaceBetween
} from './juliaHelpers';
import {
  allUnmatchedBeginsAreFirstindex,
  allUnmatchedOpenersAreFilteredBegins,
  allUnmatchedOpenersAreFilteredBeginsInsideIndexing,
  hasUnmatchedBlockOpenerBetweenInIndexing
} from './juliaLastindexHelpers';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Checks if `for` (or `if`) keyword is preceded by a value expression (identifier, digit,
// closing bracket/paren, string, etc). Used to detect trailing generators like
// `f(x, y for y in iter)` where `for` follows a value-bearing expression after a comma.
function isPrecededByValueExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        // Strings and char literals are value expressions
        const startCh = source[region.start];
        if (startCh === '"' || startCh === '`' || startCh === "'") {
          return true;
        }
        i = region.start - 1;
        continue;
      }
    }
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i--;
      continue;
    }
    // Value-ending characters indicate a value expression
    if (/[a-zA-Z0-9_)\]}]/.test(c)) {
      return true;
    }
    if (c.charCodeAt(0) > 127 && /[\p{L}\p{N}]/u.test(c)) {
      return true;
    }
    return false;
  }
  return false;
}

// Forward-scan from `from` looking for the `end` that matches the current opener.
// Returns true if a matching `end` is found before the enclosing indexing `]` closes.
function hasMatchingEndBeforeBracketClose(
  source: string,
  from: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let bracketDepth = 0;
  let blockDepth = 1;
  let i = from;
  while (i < source.length) {
    if (isInExcludedRegion(i, excludedRegions)) {
      i++;
      continue;
    }
    const ch = source[i];
    if (ch === '[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (ch === ']') {
      if (bracketDepth === 0) {
        return false;
      }
      bracketDepth--;
      i++;
      continue;
    }
    if (ch === 'e' && i + 3 <= source.length && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.' && !callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
        // Inside [ ] brackets, `end` is the lastindex reference, not a block close.
        if (bracketDepth === 0) {
          blockDepth--;
          if (blockDepth === 0) {
            return true;
          }
        }
        i += 3;
        continue;
      }
    }
    let matchedOpener = false;
    // Block openers inside [ ] are also not real block-form openers (they could be value
    // names like `Dict[begin]`). Skip opener matching while inside brackets.
    if (bracketDepth === 0) {
      for (const kw of blockOpen) {
        if (i + kw.length <= source.length && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
          const before = i > 0 ? source[i - 1] : ' ';
          const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
          if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
          if (before === '.') continue;
          if (callbacks.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
          blockDepth++;
          i += kw.length;
          matchedOpener = true;
          break;
        }
      }
    }
    if (matchedOpener) continue;
    i++;
  }
  return false;
}

// Checks if position is inside curly braces (type parameters like Dict{begin, end}).
// The innermost enclosing bracket fully determines the answer: `position` is inside
// curly braces exactly when its innermost enclosing bracket is `{`.
export function isInsideCurlyBraces(position: number, bracketIndex: JuliaBracketIndex): boolean {
  return bracketIndex.enclosing(position)?.type === '{';
}

// Checks if the `end` at `position` is directly inside an array construction `[...]`
// (not indexing) AND there is no block opener (including for/if) inside the same
// bracket between `[` and `position`. For example: `[end]` after `return`, `[1, end]`,
// `f([end])` — all return true. But `[begin ... end]`, `[for ... end]`, `[if ... end]`
// return false because there is a matching opener inside.
export function isLoneEndInArrayConstruction(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  const enclosing = callbacks.bracketIndex.enclosing(position);
  // Only an enclosing `[` (array construction, not indexing) can make this a lone end.
  // An enclosing `(` or `{`, or no enclosing bracket at all, means it is not.
  if (enclosing === null || enclosing.type !== '[') {
    return false;
  }
  if (isIndexingBracket(source, enclosing.open)) {
    return false;
  }
  // Array construction: check if there's ANY block opener (for/if/begin/...)
  // inside the bracket. Use hasAnyBlockOpenerBetween (includes for) to avoid
  // the generator-vs-block-form ambiguity in hasUnmatchedBlockOpenerBetween.
  if (hasAnyBlockOpenerBetween(source, enclosing.open + 1, position, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  // No opener at all: this `end` is lone (lastindex / not block close).
  return true;
}

// Checks if position is inside any indexing bracket (a[...]) at any depth.
// Walks the chain of enclosing brackets outward: returns true as soon as an
// enclosing `[` is an indexing bracket. Array-construction `[` and `(`/`{` are
// transparent — scanning continues to their own enclosing bracket.
export function isInsideAnyIndexingBracket(source: string, position: number, bracketIndex: JuliaBracketIndex): boolean {
  let enclosing = bracketIndex.enclosing(position);
  while (enclosing !== null) {
    if (enclosing.type === '[' && isIndexingBracket(source, enclosing.open)) {
      return true;
    }
    // Not an indexing bracket: continue with the bracket enclosing this one.
    enclosing = bracketIndex.enclosing(enclosing.open);
  }
  return false;
}

// Checks if position is inside any brackets (for for/if comprehension check)
// Returns true only when the keyword is directly inside [] without intervening () or block expressions.
// `{}` is transparent to this check (type-parameter braces never define the array/generator
// context), so an enclosing `{` is skipped to whatever encloses it.
export function isInsideBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let enclosing = callbacks.bracketIndex.enclosing(position);
  while (enclosing !== null && enclosing.type === '{') {
    enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
  }
  if (enclosing === null) {
    return false;
  }
  if (enclosing.type === '(') {
    // Inside a parenthesized expression, not directly in brackets.
    return false;
  }
  // enclosing.type === '[': directly inside square brackets.
  const open = enclosing.open;
  // Check if there's an unmatched block opener between [ and position
  // [begin for i in 1:n ... end end] → for is inside a block expression
  // [begin i^2 end for i in 1:10] → begin...end is complete, for is a comprehension
  if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  // Comma at depth 0 may indicate trailing generator: [a, b for b in iter]
  // If `for` is preceded by a value expression, treat as generator
  if (hasCommaAtDepthZero(source, open + 1, position, excludedRegions)) {
    return isPrecededByValueExpression(source, position, excludedRegions);
  }
  // for at start of brackets is a block, not a generator (generators need expr before for)
  if (isOnlyWhitespaceBetween(source, open + 1, position, excludedRegions)) {
    return false;
  }
  return true;
}

// Checks if position is inside indexing brackets only (not array construction)
// Used for 'end' to distinguish a[end] (indexing) from [begin...end] (array construction).
// Walks the chain of enclosing brackets outward: `{}` is transparent; an enclosing `[`
// resolves the answer; an enclosing `(` may resolve it or, for firstindex-only contents,
// defer to the bracket enclosing the paren (e.g. `arr[(begin:end)]`).
export function isInsideIndexingBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let enclosing = callbacks.bracketIndex.enclosing(position);
  while (enclosing !== null) {
    if (enclosing.type === '{') {
      // Curly braces are transparent to indexing-bracket detection.
      enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
      continue;
    }
    const open = enclosing.open;
    if (enclosing.type === '[') {
      const isIndexing = isIndexingBracket(source, open);
      // For indexing brackets, use a variant that does not count `end<binary-op>`
      // as a block close (those are lastindex expressions like `end!=2`).
      const hasUnmatched = isIndexing
        ? hasUnmatchedBlockOpenerBetweenInIndexing(source, open + 1, position, excludedRegions, blockOpen, callbacks)
        : hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks);
      if (hasUnmatched) {
        // In indexing brackets, the parser filters bare `begin` as firstindex
        // (whether or not followed by `:`). If every unmatched opener is such a
        // filtered `begin`, treat this `end` as lastindex too.
        if (!(isIndexing && allUnmatchedOpenersAreFilteredBegins(source, open + 1, position, excludedRegions, blockOpen, callbacks))) {
          return false;
        }
        // else: fall through to return isIndexing
      }
      // Unmatched '[' (no closing ']') means the bracket is unclosed (likely during editing).
      if (enclosing.close === -1) {
        // For an unclosed indexing bracket, an `end` that is the first non-whitespace
        // token after `[` (e.g., `a[end`) is the lastindex reference, not a block
        // close. Treat it as inside indexing brackets so it is not mis-paired with a
        // surrounding block opener. Other `end`s after the unclosed `[` (separated by
        // identifiers, newlines, or other tokens) keep their block-keyword meaning so
        // the trailing real `end` still pairs with its opener.
        if (isIndexing && isOnlyWhitespaceBetween(source, open + 1, position, excludedRegions)) {
          return true;
        }
        // Otherwise keep the editing-friendly behavior: the keyword after the unclosed
        // bracket is still a valid block keyword.
        return false;
      }
      return isIndexing;
    }
    // enclosing.type === '(': a parenthesized group.
    if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
      // If all unmatched begins are firstindex form (begin:) and there are no
      // other unmatched openers, continue scanning so an outer `[` can mark
      // `end` as lastindex (e.g., arr[(begin:end)]).
      if (!allUnmatchedBeginsAreFirstindex(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
        // For the indexing-bracket case (arr[(begin x end)]), if the unmatched
        // opener is a bare `begin` (not followed by `:`), we still need to check
        // whether we're inside an outer indexing bracket; the parser also filters
        // `begin` as firstindex there, so we must continue scanning.
        if (!allUnmatchedOpenersAreFilteredBeginsInsideIndexing(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
      }
      enclosing = callbacks.bracketIndex.enclosing(open);
      continue;
    }
    // No block opener between ( and end: check if this paren group closes after end
    // f(end + 1) -> reject end (paren closes after end)
    // function foo(\nend -> accept end (unmatched paren)
    if (!hasAnyBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks) && enclosing.close !== -1) {
      return true;
    }
    enclosing = callbacks.bracketIndex.enclosing(open);
  }
  return false;
}

// Checks if 'if' is a comprehension filter inside brackets (for...if pattern)
// Returns true only when there's a 'for' keyword between the enclosing '[' and position.
// If there's an unmatched block opener in the range, 'if' is inside a block body, not a
// filter. `{}` is transparent; an enclosing `(` means 'if' is not a bracket comprehension.
export function isComprehensionFilterInBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let enclosing = callbacks.bracketIndex.enclosing(position);
  while (enclosing !== null && enclosing.type === '{') {
    enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
  }
  if (enclosing === null || enclosing.type === '(') {
    return false;
  }
  // enclosing.type === '[': directly inside square brackets.
  const open = enclosing.open;
  if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  return hasForBetween(source, open + 1, position, excludedRegions, callbacks);
}

// Checks if 'if' is a generator filter inside parentheses (for...if pattern)
// The nearest enclosing '(' decides; '[' and '{' are transparent (the old scan
// tracked only paren depth). Walking the bracket-index chain terminates because
// each step moves to a strictly outer bracket
// An unmatched block opener in the range means 'if' is inside a block body, not a filter
export function isGeneratorFilterIf(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let enclosing = callbacks.bracketIndex.enclosing(position);
  while (enclosing !== null && enclosing.type !== '(') {
    enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
  }
  if (enclosing === null) {
    return false;
  }
  const open = enclosing.open;
  if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  return hasForBetween(source, open + 1, position, excludedRegions, callbacks);
}

// Checks if a position is inside unmatched parentheses (for generator expressions)
// Returns false if there's a block opener between the unmatched '(' and position
// (which indicates a block expression like f(if x > 0 x else -x end))
// Also returns false for named tuple context: (a = for ...) where '=' before 'for'
// indicates assignment, not a generator expression
// The innermost enclosing bracket (via the bracket index) decides: '(' analyzes,
// '[' or none returns false. It is never '{' here: isValidBlockOpen rejects a
// keyword inside '{}' earlier via isInsideCurlyBraces
export function isInsideParentheses(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  const enclosing = callbacks.bracketIndex.enclosing(position);
  // '[' means the keyword is directly inside `[...]` (handled by isInsideSquareBrackets);
  // no enclosing bracket means it is not parenthesized
  if (enclosing === null || enclosing.type !== '(') {
    return false;
  }
  const open = enclosing.open;
  if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
    return false;
  }
  // Comma at depth 0 may indicate trailing generator: f(x, y for y in iter)
  // If `for` is preceded by a value expression, treat as generator
  if (hasCommaAtDepthZero(source, open + 1, position, excludedRegions)) {
    return isPrecededByValueExpression(source, position, excludedRegions);
  }
  // for at start of parentheses is a block, not a generator (generators need expr before for)
  if (isOnlyWhitespaceBetween(source, open + 1, position, excludedRegions)) {
    return false;
  }
  // Check for named tuple context: (name = for ...)
  // If there's a '=' (not '==') between '(' and the keyword, it could be either:
  //   - Assignment with block-form RHS: (name = for ...) — keyword IS block opener.
  //   - Generator with named binding: (name = value for x in iter) — keyword is generator.
  // Distinguish by whether the keyword is preceded by a value expression.
  // For assignment-with-block-form, `for` is immediately after `=` (no value between).
  if (hasAssignmentBetween(source, open + 1, position, excludedRegions)) {
    return isPrecededByValueExpression(source, position, excludedRegions);
  }
  return true;
}

// Checks if position is inside square brackets only (for other block keywords)
// Julia allows block expressions inside parentheses, so only [] excludes them
// Keywords inside parentheses within brackets are valid (e.g., a[map(1:3) do x ... end])
// Walks the enclosing-bracket chain via the bracket index. The old backward scan
// tracked only '[]'/'()' depth and ignored '{}', so curly braces are transparent
// here. The walk terminates: each step moves to a strictly outer bracket
export function isInsideSquareBrackets(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let enclosing = callbacks.bracketIndex.enclosing(position);
  while (enclosing !== null) {
    if (enclosing.type === '{') {
      // Curly braces are transparent (type-parameter braces never define indexing context)
      enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
      continue;
    }
    if (enclosing.type === '(') {
      // Inside a parenthesized expression block keywords are valid, so non-`begin`
      // keywords are not "inside square brackets". `begin` (firstindex) still cares
      // about an outer indexing bracket (e.g. arr[(begin:end)]), so scan outward
      if (keyword !== 'begin') {
        return false;
      }
      enclosing = callbacks.bracketIndex.enclosing(enclosing.open);
      continue;
    }
    // enclosing.type === '[': the keyword is inside square brackets
    const open = enclosing.open;
    // If there's a block opener between [ and the keyword, the block expression is valid
    if (hasUnmatchedBlockOpenerBetween(source, open + 1, position, excludedRegions, blockOpen, callbacks)) {
      return false;
    }
    // Only indexing brackets exclude block keywords, not array construction
    if (!isIndexingBracket(source, open)) {
      return false;
    }
    // `begin` inside indexing brackets is normally the firstindex keyword. But if the
    // bracket has no matching `]` (e.g., user editing in progress), treat as a real
    // block opener so the begin/end pair is detected
    if (keyword === 'begin') {
      if (enclosing.close === -1) {
        return false;
      }
      return true;
    }
    // Other block keywords inside indexing brackets may form a block expression
    // if a matching `end` exists before the bracket closes
    // (e.g., a[quote x = 1 end] — the `quote/end` block evaluates to a value used as the index)
    if (hasMatchingEndBeforeBracketClose(source, position + keyword.length, excludedRegions, blockOpen, callbacks)) {
      return false;
    }
    return true;
  }
  return false;
}
