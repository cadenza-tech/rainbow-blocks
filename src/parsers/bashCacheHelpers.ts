// Bash per-parse cache builder: innermost enclosing unmatched parenthesis index

import type { ExcludedRegion } from '../types';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Pre-computes, for every position p in source, the offset of the innermost `(`
// that is still open (unmatched) at p, or -1 when no `(` encloses p. `(`/`)`
// inside excluded regions (comments / strings / substitutions) are ignored, so
// the result matches the original backward scans that skipped excluded chars.
//
// enclosingParen[p] === q means: the nearest enclosing open paren of p is at q.
// For a `(` token itself, enclosingParen[p] is the paren that encloses that `(`
// (the `(` does not enclose itself); for a `)` token, it is the paren that
// encloses the just-closed pair. Single forward pass: O(source.length).
//
// Replaces the O(N^2) backward scans in isInsideExtglob and the array-literal
// check of isAtCommandPosition: both only need the innermost enclosing `(`,
// which this array yields in O(1).
export function computeEnclosingParenAtPos(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
  const len = source.length;
  const enclosing = new Int32Array(len + 1).fill(-1);
  const parenStack: number[] = [];
  let i = 0;
  while (i < len) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        // Positions inside the excluded region keep the current enclosing paren.
        const top = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
        for (let p = i; p < region.end && p < len; p++) {
          enclosing[p] = top;
        }
        i = region.end;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(') {
      // The `(` is enclosed by the paren currently on top of the stack.
      enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
      parenStack.push(i);
    } else if (ch === ')') {
      // The `)` reports the paren enclosing the pair it closes.
      enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
      parenStack.pop();
    } else {
      enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
    }
    i++;
  }
  enclosing[len] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
  return enclosing;
}
