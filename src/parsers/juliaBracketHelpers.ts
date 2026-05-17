// Julia bracket-context helpers: classify keywords by surrounding (), [], {} context

import type { ExcludedRegion } from '../types';
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

// Checks if there is a matching ']' that closes the current bracket group after 'from'
function hasMatchingCloseBracket(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return true;
    }
  }
  return false;
}

// Checks if there is a matching ')' that closes the current paren group after 'from'
function hasMatchingCloseParen(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return true;
    }
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

// Checks if position is inside curly braces (type parameters like Dict{begin, end})
export function isInsideCurlyBraces(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const char = source[i];
    if (char === '}') {
      braceDepth++;
    } else if (char === '{') {
      if (braceDepth === 0) return true;
      braceDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) return false;
      parenDepth--;
    } else if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) return false;
      bracketDepth--;
    }
  }
  return false;
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
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === ']') {
      bracketDepth++;
    } else if (ch === '[') {
      if (bracketDepth === 0) {
        // Found the enclosing `[`. Skip if it's indexing (already handled elsewhere).
        if (isIndexingBracket(source, i)) {
          return false;
        }
        // Array construction: check if there's ANY block opener (for/if/begin/...)
        // inside the bracket. Use hasAnyBlockOpenerBetween (includes for) to avoid
        // the generator-vs-block-form ambiguity in hasUnmatchedBlockOpenerBetween.
        if (hasAnyBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        // No opener at all: this `end` is lone (lastindex / not block close).
        return true;
      }
      bracketDepth--;
    } else if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth === 0) return false;
      parenDepth--;
    }
  }
  return false;
}

// Checks if position is inside any indexing bracket (a[...]) at any depth.
// Skips nested ()s and []s.
export function isInsideAnyIndexingBracket(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === ']') {
      bracketDepth++;
    } else if (ch === '[') {
      if (bracketDepth === 0) {
        if (isIndexingBracket(source, i)) {
          return true;
        }
        // Array construction: keep scanning outward.
      } else {
        bracketDepth--;
      }
    } else if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth === 0) continue;
      parenDepth--;
    }
  }
  return false;
}

// Checks if position is inside any brackets (for for/if comprehension check)
// Returns true only when the keyword is directly inside [] without intervening () or block expressions
export function isInsideBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const char = source[i];
    if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) {
        // Check if there's an unmatched block opener between [ and position
        // [begin for i in 1:n ... end end] → for is inside a block expression
        // [begin i^2 end for i in 1:10] → begin...end is complete, for is a comprehension
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        // Comma at depth 0 may indicate trailing generator: [a, b for b in iter]
        // If `for` is preceded by a value expression, treat as generator
        if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
          return isPrecededByValueExpression(source, position, excludedRegions);
        }
        // for at start of brackets is a block, not a generator (generators need expr before for)
        if (isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
          return false;
        }
        return true;
      }
      bracketDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) {
        // Inside a parenthesized expression, not directly in brackets
        return false;
      }
      parenDepth--;
    }
  }
  return false;
}

// Checks if position is inside indexing brackets only (not array construction)
// Used for 'end' to distinguish a[end] (indexing) from [begin...end] (array construction)
export function isInsideIndexingBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const char = source[i];
    if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) {
        const isIndexing = isIndexingBracket(source, i);
        // For indexing brackets, use a variant that does not count `end<binary-op>`
        // as a block close (those are lastindex expressions like `end!=2`).
        const hasUnmatched = isIndexing
          ? hasUnmatchedBlockOpenerBetweenInIndexing(source, i + 1, position, excludedRegions, blockOpen, callbacks)
          : hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks);
        if (hasUnmatched) {
          // In indexing brackets, the parser filters bare `begin` as firstindex
          // (whether or not followed by `:`). If every unmatched opener is such a
          // filtered `begin`, treat this `end` as lastindex too.
          if (isIndexing && allUnmatchedOpenersAreFilteredBegins(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
            // fall through to return isIndexing
          } else {
            return false;
          }
        }
        // Unmatched '[' (no closing ']') means the bracket is unclosed (likely during editing).
        if (!hasMatchingCloseBracket(source, position + 3, excludedRegions)) {
          // For an unclosed indexing bracket, an `end` that is the first non-whitespace
          // token after `[` (e.g., `a[end`) is the lastindex reference, not a block
          // close. Treat it as inside indexing brackets so it is not mis-paired with a
          // surrounding block opener. Other `end`s after the unclosed `[` (separated by
          // identifiers, newlines, or other tokens) keep their block-keyword meaning so
          // the trailing real `end` still pairs with its opener.
          if (isIndexing && isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
            return true;
          }
          // Otherwise keep the editing-friendly behavior: the keyword after the unclosed
          // bracket is still a valid block keyword.
          return false;
        }
        return isIndexing;
      }
      bracketDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0 && bracketDepth === 0) {
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          // If all unmatched begins are firstindex form (begin:) and there are no
          // other unmatched openers, continue scanning so the outer `[` can mark
          // `end` as lastindex (e.g., arr[(begin:end)]).
          // Note: at this point we haven't yet seen the outer `[`, so we use the
          // strict firstindex check (begin: form). The looser check is applied
          // once we confirm we're inside indexing brackets above.
          if (!allUnmatchedBeginsAreFirstindex(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
            // For the indexing-bracket case (bug 1a: arr[(begin x end)]), if the
            // unmatched opener is a bare `begin` (not followed by `:`), we still
            // need to check whether we're inside an outer indexing bracket. In
            // that case the parser also filters `begin` as firstindex, so we must
            // continue scanning.
            if (!allUnmatchedOpenersAreFilteredBeginsInsideIndexing(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
              return false;
            }
          }
          continue;
        }
        // No block opener between ( and end: check if this paren group closes after end
        // f(end + 1) -> reject end (paren closes after end)
        // function foo(\nend -> accept end (unmatched paren)
        if (
          !hasAnyBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks) &&
          hasMatchingCloseParen(source, position + 3, excludedRegions)
        ) {
          return true;
        }
        parenDepth--;
      } else {
        parenDepth--;
      }
    }
  }
  return false;
}

// Checks if 'if' is a comprehension filter inside brackets (for...if pattern)
// Returns true only when there's a 'for' keyword between the unmatched '[' and position
// If there's an unmatched block opener in the range, 'if' is inside a block body, not a filter.
export function isComprehensionFilterInBrackets(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const char = source[i];
    if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) {
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        return hasForBetween(source, i + 1, position, excludedRegions, callbacks);
      }
      bracketDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) return false;
      parenDepth--;
    }
  }
  return false;
}

// Checks if 'if' is a generator filter inside parentheses (for...if pattern)
// If there's an unmatched block opener in the range, 'if' is inside a block body, not a filter.
export function isGeneratorFilterIf(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const char = source[i];
    if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) {
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        return hasForBetween(source, i + 1, position, excludedRegions, callbacks);
      }
      parenDepth--;
    }
  }
  return false;
}

// Checks if a position is inside unmatched parentheses (for generator expressions)
// Returns false if there's a block opener between the unmatched '(' and position
// (which indicates a block expression like f(if x > 0 x else -x end))
// Also returns false for named tuple context: (a = for ...) where '=' before 'for'
// indicates assignment, not a generator expression
export function isInsideParentheses(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const char = source[i];
    if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) {
        // The keyword is directly inside `[...]` (possibly nested in `(...)`).
        // Bracket-form constructs like `[for ...]` handled separately by isInsideSquareBrackets.
        return false;
      }
      bracketDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) {
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        // Comma at depth 0 may indicate trailing generator: f(x, y for y in iter)
        // If `for` is preceded by a value expression, treat as generator
        if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
          return isPrecededByValueExpression(source, position, excludedRegions);
        }
        // for at start of parentheses is a block, not a generator (generators need expr before for)
        if (isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
          return false;
        }
        // Check for named tuple context: (name = for ...)
        // If there's a '=' (not '==') between '(' and the keyword, it could be either:
        //   - Assignment with block-form RHS: (name = for ...) — keyword IS block opener.
        //   - Generator with named binding: (name = value for x in iter) — keyword is generator.
        // Distinguish by whether the keyword is preceded by a value expression.
        // For assignment-with-block-form, `for` is immediately after `=` (no value between).
        if (hasAssignmentBetween(source, i + 1, position, excludedRegions)) {
          return isPrecededByValueExpression(source, position, excludedRegions);
        }
        return true;
      }
      parenDepth--;
    }
  }
  return false;
}

// Checks if position is inside square brackets only (for other block keywords)
// Julia allows block expressions inside parentheses, so only [] excludes them
// Keywords inside parentheses within brackets are valid (e.g., a[map(1:3) do x ... end])
export function isInsideSquareBrackets(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const char = source[i];
    if (char === ']') {
      bracketDepth++;
    } else if (char === '[') {
      if (bracketDepth === 0) {
        // If inside parentheses within brackets, only `begin` (firstindex) cares about
        // the outer indexing context. Other block keywords are valid inside parens.
        if (parenDepth > 0 && keyword !== 'begin') return false;
        // If there's a block opener between [ and the keyword, the block expression is valid
        if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, blockOpen, callbacks)) {
          return false;
        }
        // Only indexing brackets exclude block keywords, not array construction
        if (!isIndexingBracket(source, i)) {
          return false;
        }
        // `begin` inside indexing brackets is normally the firstindex keyword. But if the
        // bracket has no matching `]` (e.g., user editing in progress), treat as a real
        // block opener so the begin/end pair is detected.
        if (keyword === 'begin') {
          if (!hasMatchingCloseBracket(source, i + 1, excludedRegions)) {
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
      bracketDepth--;
    } else if (char === ')') {
      parenDepth++;
    } else if (char === '(') {
      if (parenDepth === 0) {
        // We've exited a paren going backward. For `begin`, continue scanning so that
        // `arr[(begin:end)]` is recognized: outer `[` makes begin a firstindex.
        if (keyword === 'begin') {
          continue;
        }
        return false;
      }
      parenDepth--;
    }
  }
  return false;
}
