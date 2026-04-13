// Erlang helper functions for catch expression analysis and comma detection

import type { ExcludedRegion } from '../types';
import { isInExcludedRegion } from './parserUtils';

// Callbacks for base parser methods needed by catch analysis functions
export interface ErlangHelperCallbacks {
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Keywords that can precede 'catch' as expression prefix (catch is first expression in block body)
const CATCH_EXPR_PRECEDING_KEYWORDS = new Set(['begin', 'case', 'receive', 'if', 'fun', 'maybe', 'when', 'catch']);

// Keywords where catch can be either expression prefix or clause separator depending on context
const CATCH_AMBIGUOUS_KEYWORDS = new Set(['try', 'of', 'after']);

// Word operators that imply catch is an expression prefix (e.g., X div catch throw(e))
const CATCH_EXPR_WORD_OPERATORS = new Set(['div', 'rem', 'band', 'bor', 'bxor', 'bsl', 'bsr', 'not', 'and', 'or', 'xor', 'andalso', 'orelse']);

// Checks if 'catch' at position is an expression prefix (e.g., X = catch throw(hello))
// rather than a try-catch clause separator
export function isCatchExpressionPrefix(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: ErlangHelperCallbacks
): boolean {
  let j = position - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j--;
  }
  while (j >= 0) {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      // Comments are transparent: skip and continue scanning backward
      // String/atom/char literals are expression values: catch after them is a clause separator
      if (source[region.start] !== '%') {
        return false;
      }
      j = region.start - 1;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      continue;
    }
    break;
  }
  if (j < 0) return false;
  const ch = source[j];
  // Preceded by operator, assignment, or opening bracket -> expression prefix
  if (
    ch === '=' ||
    ch === '(' ||
    ch === '[' ||
    ch === '{' ||
    ch === '!' ||
    ch === '+' ||
    ch === '-' ||
    ch === '*' ||
    ch === '/' ||
    ch === '<' ||
    ch === '|'
  ) {
    return true;
  }
  // Closing bracket/paren: end of sub-expression.
  // Use forward heuristic to distinguish expression-prefix from clause separator
  if (ch === ')' || ch === ']' || ch === '}') {
    return !isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
  }
  // Comma: could be end of sequence before catch expression,
  // or end of last expression before catch clause separator.
  // If catch is followed by a clause pattern (->), it's a clause separator
  if (ch === ',') {
    return !isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
  }
  // > as comparison operator -> expression prefix
  // -> (clause arrow): catch in a clause body is expression prefix,
  // but catch starting a try-catch section is a clause separator
  if (ch === '>') {
    if (j > 0 && source[j - 1] === '-') {
      return !isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
    }
    // >> (binary close): catch after binary expression is likely a clause separator
    if (j > 0 && source[j - 1] === '>') {
      return !isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
    }
    return true;
  }
  // Preceded by a block-opening or intermediate keyword -> expression prefix
  if (/[a-z]/i.test(ch)) {
    const wordEnd = j + 1;
    let wordStart = j;
    while (wordStart > 0 && /[a-z0-9_]/i.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.slice(wordStart, wordEnd);
    if (CATCH_EXPR_PRECEDING_KEYWORDS.has(word)) {
      return true;
    }
    // For try/of/after, check forward: if catch is followed by a clause pattern (->),
    // it's a clause separator, not an expression prefix
    if (CATCH_AMBIGUOUS_KEYWORDS.has(word)) {
      return !isCatchFollowedByClausePattern(source, position + 5, excludedRegions);
    }
    // Word operators (div/rem/band/bor/bxor/bsl/bsr/not/and/or/xor/andalso/orelse) -> expression prefix
    if (CATCH_EXPR_WORD_OPERATORS.has(word)) {
      return true;
    }
  }
  return false;
}

// Checks if there's a comma at bracket depth 0 between two positions (forward scan)
export function hasTopLevelCommaBetween(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      return true;
    }
  }
  return false;
}

// Checks if there's a -> (clause arrow) after catch before the next catch/after/end/;.
// Tracks block nesting depth so -> inside nested blocks (e.g. fun(X) -> X end) is ignored
export function isCatchFollowedByClausePattern(source: string, afterCatch: number, excludedRegions: ExcludedRegion[]): boolean {
  let k = afterCatch;
  let depth = 0;
  while (k < source.length) {
    if (isInExcludedRegion(k, excludedRegions)) {
      k++;
      continue;
    }
    const ch = source[k];
    // Only match -> at top level (not inside nested blocks)
    if (depth === 0 && ch === '-' && k + 1 < source.length && source[k + 1] === '>') {
      return true;
    }
    // Hit a structural boundary at top level without finding -> it's an expression prefix
    if (depth === 0 && (ch === ';' || ch === '.')) return false;
    // Check for structural keywords
    if (/[a-z]/i.test(ch)) {
      let wEnd = k + 1;
      while (wEnd < source.length && /[a-z0-9_]/i.test(source[wEnd])) wEnd++;
      const w = source.slice(k, wEnd);
      if (depth === 0 && (w === 'catch' || w === 'after' || w === 'end')) return false;
      // Track block nesting: openers increase depth, end decreases depth
      if (w === 'if' || w === 'case' || w === 'receive' || w === 'try' || w === 'begin' || w === 'fun' || w === 'maybe') {
        depth++;
      } else if (w === 'end' && depth > 0) {
        depth--;
      }
      k = wEnd;
      continue;
    }
    k++;
  }
  return false;
}
