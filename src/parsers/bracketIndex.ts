// Bracket index: pre-computes bracket pairing in a single O(n) pass so per-keyword
// context checks can locate the enclosing bracket in O(log n) instead of rescanning
// the source prefix on every keyword (which made parsing O(n^2)).
//
// `trackedOpeners` selects which bracket kinds participate. The default tracks all
// three ((), [], {}); callers that only care about one kind (e.g. VHDL `()` depth,
// Verilog `{}` depth) pass a single-element set, making the index behave identically
// to a single-kind backward scan.

import type { ExcludedRegion } from '../types';
import { isInExcludedRegion } from './parserUtils';

// One open bracket with its matched close offset (-1 when unmatched / unclosed).
export interface BracketSpan {
  // Offset of the opening character `(`, `[`, or `{`.
  open: number;
  // Offset of the matching close character, or -1 if the bracket is never closed.
  close: number;
  // The opening character: '(', '[', or '{'.
  type: string;
}

const CLOSE_TO_OPEN: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

// Default tracked openers: all three bracket kinds.
const ALL_OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);

// A bracket-structure-changing position (an opener or closer outside excluded
// regions), paired with the innermost enclosing bracket span that is in effect
// immediately AFTER this character is consumed.
interface BracketEvent {
  // Offset of the bracket character.
  offset: number;
  // The innermost bracket span enclosing positions just past `offset`, or null.
  enclosingAfter: BracketSpan | null;
}

// Pre-computed bracket structure for a source string. Built once per parse and
// reused by every bracket-context helper. The previous design re-scanned the
// source prefix from each keyword position, yielding O(n^2) work for files with
// many block keywords; this index makes the enclosing-bracket lookup O(log n).
export class BracketIndex {
  // Bracket events (openers and closers) sorted by offset ascending. Each event
  // carries the enclosing span in effect just after that character, so the
  // enclosing bracket at any position is found by one binary search.
  private readonly events: BracketEvent[];

  // `trackedOpeners` defaults to all three bracket kinds. Pass a narrower set to
  // index only one kind; a single-kind index matches a single-kind backward scan.
  constructor(source: string, excludedRegions: ExcludedRegion[], trackedOpeners: ReadonlySet<string> = ALL_OPENERS) {
    this.events = BracketIndex.computeEvents(source, excludedRegions, trackedOpeners);
  }

  // Single pass over the source: a stack pairs every opener with its closer and
  // records, for each bracket character, the enclosing span in effect afterward.
  // Brackets inside excluded regions (strings, comments, char literals, symbols)
  // are skipped entirely so they never affect block-keyword classification.
  // Bracket kinds outside `trackedOpeners` are ignored entirely.
  private static computeEvents(source: string, excludedRegions: ExcludedRegion[], trackedOpeners: ReadonlySet<string>): BracketEvent[] {
    const events: BracketEvent[] = [];
    // Stack of currently-open brackets. Each entry is a mutable span whose
    // `close` is filled in when the matching closer is found.
    const stack: BracketSpan[] = [];

    for (let i = 0; i < source.length; i++) {
      if (isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const ch = source[i];
      if (ch === '(' || ch === '[' || ch === '{') {
        if (!trackedOpeners.has(ch)) {
          continue;
        }
        const span: BracketSpan = { open: i, close: -1, type: ch };
        stack.push(span);
        // After consuming this opener, the new innermost enclosing span is the
        // opener itself.
        events.push({ offset: i, enclosingAfter: span });
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        const expectedOpen = CLOSE_TO_OPEN[ch];
        if (!trackedOpeners.has(expectedOpen)) {
          continue;
        }
        // Find the nearest opener of the matching type so `( [ )` does not pair
        // `(` with `)` across the `[`. Mismatched closers with no matching
        // opener are tolerated and dropped (best-effort parsing).
        let matchIdx = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s].type === expectedOpen) {
            matchIdx = s;
            break;
          }
        }
        if (matchIdx === -1) {
          continue;
        }
        // Brackets above the matched opener are unclosed within this group;
        // pop them (their `close` stays -1).
        stack.length = matchIdx + 1;
        const opener = stack[matchIdx];
        opener.close = i;
        stack.pop();
        // After consuming this closer, the innermost enclosing span is whatever
        // is left on top of the stack.
        events.push({ offset: i, enclosingAfter: stack.length > 0 ? stack[stack.length - 1] : null });
      }
    }
    return events;
  }

  // Returns the innermost bracket span enclosing `pos`, or null when `pos` is
  // not inside any bracket. O(log n): binary-search the last bracket event
  // before `pos`; the enclosing span recorded there is the answer (positions
  // between two consecutive events share the same enclosing bracket).
  enclosing(pos: number): BracketSpan | null {
    let lo = 0;
    let hi = this.events.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].offset < pos) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx === -1) {
      return null;
    }
    return this.events[idx].enclosingAfter;
  }
}
