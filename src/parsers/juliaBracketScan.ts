// Per-bracket forward-scan cache. The bracket-context helpers in juliaHelpers and
// juliaLastindexHelpers each scan from `enclosing.open + 1` forward to a keyword
// position. When N block keywords sit inside the same bracket of size O(N), every
// per-keyword call rescans an O(N) prefix → O(N^2) total work. This file factors
// the shared forward pass: each bracket is scanned ONCE, recording the running
// helper state at every block-keyword position inside it. Subsequent queries from
// the helpers become O(log N) binary searches.
//
// The fused scan is intentionally a faithful merge of the six individual helper
// loops (no semantic change). The wrappers in juliaHelpers / juliaLastindexHelpers
// route their work here when a bracket scan is available; otherwise they fall back
// to the original linear scan (e.g. when no bracket index is wired in).

import type { ExcludedRegion } from '../types';
import type { BracketSpan } from './bracketIndex';
import { isTypeKeywordAfterAbstractOrPrimitive } from './juliaHelpers';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Predicate used by the scanner to test Unicode-letter adjacency. Threaded in from
// BaseBlockParser via JuliaHelperCallbacks; supplied here as a plain function so
// the scan stays a free function (no class dependency).
type UnicodeLetterFn = (source: string, startOffset: number, keywordLength: number) => boolean;

// One snapshot per block-keyword candidate offset inside a bracket. Captures the
// running state of all six fused helpers immediately BEFORE the candidate token is
// consumed. The snapshot at position p is therefore the answer each helper would
// give if asked `(open+1, p)`.
interface BracketSnapshot {
  // Offset inside the source at which this snapshot is valid.
  pos: number;
  // hasUnmatchedBlockOpenerBetween (general): `depth > 0` here is the result.
  uBOB_depth: number;
  // hasAnyBlockOpenerBetween: monotonic once true.
  hABO_seen: boolean;
  // hasForBetween: monotonic once true.
  hFB_found: boolean;
  // hasUnmatchedBlockOpenerBetweenInIndexing: `depth > 0` here is the result.
  uBOBI_depth: number;
  // allUnmatchedOpenersAreFilteredBegins: stack size and non-'begin' count.
  // The helper returns true when every remaining opener is a 'begin'; equivalently
  // when nonBeginStackCount === 0.
  aUO_nonBeginStackCount: number;
  // allUnmatchedBeginsAreFirstindex: result is `depth === 0 && nonFirstindexBegins === 0`.
  aUB_depth: number;
  aUB_nonFirstindexBegins: number;
}

// A bracket's precomputed scan. `snapshots` is sorted by `pos` ascending.
// Snapshot semantics: each entry records the helper state immediately BEFORE the
// loop would consume the byte at `pos`. A query for `helper(open+1, p)` finds the
// snapshot whose `pos == p` and reads the corresponding field.
//
// Callers should pass a position that matches a recorded snapshot. The bracket-
// context helpers always do this because they only query keyword start offsets
// that are themselves consumed by the same fused scan.
export interface BracketScan {
  // Snapshots sorted by pos ascending.
  snapshots: BracketSnapshot[];
  // Position of the leading block-form `for` inside the bracket (after whitespace
  // and excluded regions), or -1 when no leading `for`. Used by hasForBetween's
  // leading-for handling at the call site.
  leadingForPos: number;
}

// Module-level cache keyed by BracketSpan identity. The bracket spans come from a
// BracketIndex that is itself cached per source by the parser, so spans for the
// same source are stable. A WeakMap lets entries be reclaimed when the index goes
// out of scope, and avoids cross-parser state leakage.
const SCAN_CACHE = new WeakMap<BracketSpan, BracketScan>();

// Builds (or returns the cached) per-bracket scan. The scan is a single forward
// pass over the bracket's interior; snapshots are appended at the start of every
// block-keyword candidate offset (including `end`). Callers should NOT mutate the
// returned data.
export function getBracketScan(
  span: BracketSpan,
  source: string,
  excludedRegions: ExcludedRegion[],
  blockOpeners: readonly string[],
  isAdjacentToUnicodeLetter: UnicodeLetterFn
): BracketScan {
  const cached = SCAN_CACHE.get(span);
  if (cached !== undefined) {
    return cached;
  }
  const scan = computeBracketScan(span, source, excludedRegions, blockOpeners, isAdjacentToUnicodeLetter);
  SCAN_CACHE.set(span, scan);
  return scan;
}

// Performs the fused forward scan. The logic mirrors each individual helper:
//   - hasUnmatchedBlockOpenerBetween: depth tracks block openers minus `end`
//     closers (excluding `end` inside `[`/`]` brackets and `end` after `.`).
//     `inComprehensionContext` switches `if` off as an opener once a `for x in y`
//     pattern is seen at depth 0. `for` is excluded from openers (comprehension
//     generator); a leading block-form `for` is counted by an externally applied
//     +1 to depth before the loop starts.
//   - hasAnyBlockOpenerBetween: a saturating "any opener seen" flag.
//   - hasForBetween: a saturating "non-leading `for` at paren depth 0 outside
//     active block bodies" flag. Paren/bracket depth is tracked separately because
//     `for` inside `(...)`/`[...]` does not count; blockDepth tracks unmatched
//     block openers so a nested generator inside a real block body is ignored.
//   - hasUnmatchedBlockOpenerBetweenInIndexing: like uBOB but `for` is a block
//     opener at depth > 0, and `end<bin-op>` is lastindex (not a closer).
//   - allUnmatchedOpenersAreFilteredBegins: an opener stack of 'begin'/'other'
//     plus a parallel nonBeginStackCount. `end` pops LIFO (skipping `end<bin-op>`).
//   - allUnmatchedBeginsAreFirstindex: `depth` is non-`begin` block openers minus
//     ends; `nonFirstindexBegins` is bare `begin` (not followed by `:`) minus the
//     `end`s that cancel them after `depth` is already 0.
function computeBracketScan(
  span: BracketSpan,
  source: string,
  excludedRegions: ExcludedRegion[],
  blockOpeners: readonly string[],
  isAdjacentToUnicodeLetter: UnicodeLetterFn
): BracketScan {
  const start = span.open + 1;
  const end = span.close === -1 ? source.length : span.close;
  const snapshots: BracketSnapshot[] = [];

  // hasUnmatchedBlockOpenerBetween state.
  let uBOB_depth = 0;
  let uBOB_bracketDepth = 0;
  let uBOB_inComprehensionContext = false;

  // hasAnyBlockOpenerBetween state.
  let hABO_seen = false;

  // hasUnmatchedBlockOpenerBetweenInIndexing state.
  let uBOBI_depth = 0;
  let uBOBI_bracketDepth = 0;
  let uBOBI_inComprehensionContext = false;

  // hasForBetween state.
  let hFB_parenBracketDepth = 0;
  let hFB_blockDepth = 0; // counts unmatched block openers tracked for `for` scoping
  let hFB_found = false;

  // allUnmatchedOpenersAreFilteredBegins state.
  // We track only the count of stack entries that are NOT 'begin'. The helper's
  // return value is `nonBeginStackCount === 0`.
  let aUO_nonBeginStackCount = 0;
  // Stack of 'begin'/'other' markers (per-entry kind) so LIFO popping by `end`
  // can correctly decrement nonBeginStackCount when the popped kind is 'other'.
  const aUO_stackKinds: ('begin' | 'other')[] = [];
  let aUO_bracketDepth = 0;

  // allUnmatchedBeginsAreFirstindex state.
  let aUB_depth = 0;
  let aUB_nonFirstindexBegins = 0;
  let aUB_bracketDepth = 0;

  // Detect leading block-form `for` (after whitespace and excluded regions).
  // Mirrors the per-helper pre-loop in hasUnmatchedBlockOpenerBetween and
  // hasUnmatchedBlockOpenerBetweenInIndexing — but the depth contributions are
  // applied LATER (when the scan reaches the leading-for position) rather than
  // up front. The original helpers gate the pre-add on `firstNonWhite + 3 <= end`
  // where `end` is the query position; a query at `end <= leadingForPos + 2`
  // would NOT include the leading-for contribution. By applying the contribution
  // only when the scan REACHES the leading-for, snapshots before that position
  // correctly exclude it.
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
  let leadingForPos = -1;
  if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
    const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
    const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
    if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
      if (!isAdjacentToUnicodeLetter(source, firstNonWhite, 3) && before !== '.') {
        leadingForPos = firstNonWhite;
      }
    }
  }

  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];

    // Snapshot BEFORE processing this byte. Recorded at every byte position is
    // overkill memory; instead we snapshot only at positions where a candidate
    // block keyword (or `end`) STARTS. The helper callers only query keyword
    // offsets, so this covers every reachable query position.
    // (The decision of whether `i` is a candidate is made just below; for
    // efficiency we postpone the push until we know it is.)

    // --- bracket-depth updates (used by uBOB and aUB) ---
    if (ch === '[') {
      uBOB_bracketDepth++;
      uBOBI_bracketDepth++;
      aUO_bracketDepth++;
      aUB_bracketDepth++;
      hFB_parenBracketDepth++;
      continue;
    }
    if (ch === ']') {
      if (uBOB_bracketDepth > 0) uBOB_bracketDepth--;
      if (uBOBI_bracketDepth > 0) uBOBI_bracketDepth--;
      if (aUO_bracketDepth > 0) aUO_bracketDepth--;
      if (aUB_bracketDepth > 0) aUB_bracketDepth--;
      hFB_parenBracketDepth--;
      continue;
    }
    if (ch === '(') {
      hFB_parenBracketDepth++;
      continue;
    }
    if (ch === ')') {
      hFB_parenBracketDepth--;
      continue;
    }

    // --- comprehension-context detection (uBOB / uBOBI share `for x in y`) ---
    if (
      ch === 'f' &&
      i + 3 <= end &&
      source.slice(i, i + 3) === 'for' &&
      !/[a-zA-Z0-9_]/.test(i > 0 ? source[i - 1] : ' ') &&
      !/[a-zA-Z0-9_]/.test(i + 3 < source.length ? source[i + 3] : ' ') &&
      !isAdjacentToUnicodeLetter(source, i, 3)
    ) {
      // uBOB: always evaluated (no depth gate); uBOBI: only at depth 0.
      // At i == leadingForPos, the original uBOBI pre-incremented depth to 1
      // before this check, so the leading-for itself does NOT enter comprehension
      // mode in uBOBI (it is the block-form generator, not a comprehension).
      const tail = source.slice(i + 3, end);
      const isForInPattern = /^[ \t]+\S+.*?(?:\bin\b|\b∈\b|=)/.test(tail);
      if (isForInPattern) {
        if (!uBOB_inComprehensionContext) {
          uBOB_inComprehensionContext = true;
        }
        const uBOBIEffectiveDepth = uBOBI_depth + (i === leadingForPos ? 1 : 0);
        if (!uBOBI_inComprehensionContext && uBOBIEffectiveDepth === 0) {
          uBOBI_inComprehensionContext = true;
        }
      }
    }

    // --- `end` keyword ---
    if (ch === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && !isAdjacentToUnicodeLetter(source, i, 3)) {
        // Snapshot for this candidate before any of the helpers' state changes.
        snapshots.push({
          pos: i,
          uBOB_depth,
          hABO_seen,
          hFB_found,
          uBOBI_depth,
          aUO_nonBeginStackCount,
          aUB_depth,
          aUB_nonFirstindexBegins
        });

        // uBOB: dot-preceded `end` skipped; inside `[...]` skipped (lastindex).
        // Otherwise decrement depth when positive.
        if (before !== '.' && uBOB_bracketDepth === 0) {
          if (uBOB_depth > 0) uBOB_depth--;
        }

        // uBOBI: same as uBOB but `end<bin-op>` is lastindex (do not decrement).
        if (before !== '.' && uBOBI_bracketDepth === 0) {
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
          if (!isLastindex && uBOBI_depth > 0) uBOBI_depth--;
        }

        // aUO (allUnmatchedOpenersAreFilteredBegins): LIFO pop, with `end<bin-op>`
        // recognized as lastindex (do not pop).
        if (before !== '.' && aUO_bracketDepth === 0) {
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
          if (!isLastindex) {
            const popped = aUO_stackKinds.pop();
            if (popped === 'other') {
              aUO_nonBeginStackCount--;
            }
          }
        }

        // aUB (allUnmatchedBeginsAreFirstindex): cancel depth first, then non-firstindex begins.
        if (before !== '.' && aUB_bracketDepth === 0) {
          if (aUB_depth > 0) {
            aUB_depth--;
          } else if (aUB_nonFirstindexBegins > 0) {
            aUB_nonFirstindexBegins--;
          }
        }

        // hFB (hasForBetween): `end` at paren depth 0 decrements blockDepth.
        if (hFB_parenBracketDepth === 0 && before !== '.') {
          if (hFB_blockDepth > 0) hFB_blockDepth--;
        }

        i += 2;
        continue;
      }
    }

    // --- block opener candidates ---
    // Each helper has its own opener list:
    //   uBOB / aUO / aUB: openersWithoutFor (no 'for')
    //   uBOBI: openersWithoutFor at depth 0, full blockOpen at depth > 0
    //   hABO: full blockOpen
    //   hFB: 'for' only (and `end` decrement above)
    // We do one scan of the full blockOpeners list, then apply per-helper logic.
    for (const keyword of blockOpeners) {
      if (i + keyword.length <= end && source[i] === keyword[0] && source.slice(i, i + keyword.length) === keyword) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
        // Dot-preceded keywords skipped uniformly (field access like range.begin).
        if (before === '.') continue;
        // abstract/primitive are only block openers when followed by 'type'.
        if (keyword === 'abstract' || keyword === 'primitive') {
          const afterKeyword = source.slice(i + keyword.length);
          if (!isTypeKeywordAfterAbstractOrPrimitive(afterKeyword)) continue;
        }

        // Snapshot BEFORE this opener's state changes are applied. This is what
        // a query for `helper(open+1, i)` should observe.
        snapshots.push({
          pos: i,
          uBOB_depth,
          hABO_seen,
          hFB_found,
          uBOBI_depth,
          aUO_nonBeginStackCount,
          aUB_depth,
          aUB_nonFirstindexBegins
        });

        // hABO: any opener (including 'for') flips the saturating flag.
        hABO_seen = true;

        // Leading block-form `for` at the very start of the bracket has special
        // semantics in three helpers: it contributes +1 to uBOB_depth / uBOBI_depth
        // (matching the per-helper pre-loop check `firstNonWhite + 3 <= end`) and
        // +1 to hFB_blockDepth (matching hasForBetween's pre-loop init). It does
        // NOT trigger hFB_found (it is block-form, not a generator). By applying
        // these contributions only when the scan REACHES leadingForPos (after the
        // snapshot is taken just above), queries at pos == leadingForPos correctly
        // exclude the contribution while queries at later pos include it.
        const isLeadingFor = keyword === 'for' && i === leadingForPos;
        if (isLeadingFor) {
          uBOB_depth++;
          uBOBI_depth++;
          hFB_blockDepth++;
        } else {
          // hFB: a non-leading `for` at paren depth 0 outside an active block
          // body is a generator. Snapshots after this position observe hFB_found.
          if (keyword === 'for' && hFB_parenBracketDepth === 0 && hFB_blockDepth === 0) {
            hFB_found = true;
          }

          // uBOB: depth++ for non-'for' openers, with comprehension-context filter for 'if'.
          if (keyword !== 'for') {
            if (!(uBOB_inComprehensionContext && keyword === 'if')) {
              uBOB_depth++;
            }
          }

          // uBOBI: at depth 0, openersWithoutFor; at depth > 0, full set (so 'for'
          // counts as a nested block-form loop). Comprehension filter for 'if' same
          // as uBOB.
          const allowedHere = uBOBI_depth > 0 ? true : keyword !== 'for';
          if (allowedHere) {
            if (!(uBOBI_inComprehensionContext && keyword === 'if')) {
              uBOBI_depth++;
            }
          }
        }

        // aUO: push opener kind, increment aUO_nonBeginStackCount when not 'begin'.
        if (aUO_bracketDepth === 0) {
          if (keyword === 'begin') {
            aUO_stackKinds.push('begin');
          } else {
            aUO_stackKinds.push('other');
            aUO_nonBeginStackCount++;
          }
        }

        // aUB: 'begin' followed by ':' (firstindex) is not an opener; bare 'begin'
        // is a non-firstindex opener; other keywords increment aUB_depth.
        if (aUB_bracketDepth === 0) {
          if (keyword === 'begin') {
            let k = i + keyword.length;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
            if (k < source.length && source[k] === ':' && source[k + 1] !== ':') {
              // firstindex; do not open
            } else {
              aUB_nonFirstindexBegins++;
            }
          } else {
            aUB_depth++;
          }
        }

        i += keyword.length - 1;
        break;
      }
    }
  }

  // Snapshots are appended in source order (the for-loop walks `i` ascending).
  return { snapshots, leadingForPos };
}

// Locate the snapshot for an exact keyword offset. Returns null when no snapshot
// matches (e.g., the caller queried a position that was not consumed by the fused
// scan — should not happen in practice for keyword offsets, but the wrappers will
// then fall back to the original linear scan).
function findSnapshot(scan: BracketScan, pos: number): BracketSnapshot | null {
  const { snapshots } = scan;
  let lo = 0;
  let hi = snapshots.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midPos = snapshots[mid].pos;
    if (midPos === pos) return snapshots[mid];
    if (midPos < pos) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

// O(log K) wrapper for hasUnmatchedBlockOpenerBetween.
export function queryUBOB(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.uBOB_depth > 0;
}

// O(log K) wrapper for hasAnyBlockOpenerBetween. A "before-pos" snapshot's
// hABO_seen reports any opener strictly before `pos` (i.e., in `[open+1, pos)`),
// matching the helper's semantics.
export function queryHABO(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.hABO_seen;
}

// O(log K) wrapper for hasForBetween.
export function queryHFB(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.hFB_found;
}

// O(log K) wrapper for hasUnmatchedBlockOpenerBetweenInIndexing.
export function queryUBOBI(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.uBOBI_depth > 0;
}

// O(log K) wrapper for allUnmatchedOpenersAreFilteredBegins. The helper returns
// true when every unmatched opener in [open+1, pos) is a 'begin' that the parser
// filters as firstindex inside indexing brackets. Our snapshot records the count
// of non-'begin' entries on the LIFO opener stack at this point; zero means every
// remaining opener is 'begin'.
export function queryAUO(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.aUO_nonBeginStackCount === 0;
}

// O(log K) wrapper for allUnmatchedBeginsAreFirstindex.
export function queryAUB(scan: BracketScan, pos: number): boolean | null {
  const snap = findSnapshot(scan, pos);
  if (snap === null) return null;
  return snap.aUB_depth === 0 && snap.aUB_nonFirstindexBegins === 0;
}

// Subset of juliaLastindexHelpers' isBinaryOperatorStart needed by the fused scan
// (only used inside `end` handling to detect `end<bin-op>` as lastindex). Mirrors
// the original verbatim; kept private so importers do not couple to it.
function isBinaryOperatorStart(source: string, pos: number): boolean {
  const c = source[pos];
  const c2 = pos + 1 < source.length ? source[pos + 1] : '';
  if (c === '!' && c2 === '=') return true;
  if (c === '=' && c2 === '=') return true;
  if (c === '=' && c2 === '>') return true;
  if (c === '<' && c2 === '=') return true;
  if (c === '>' && c2 === '=') return true;
  if (c === '<') return true;
  if (c === '>') return true;
  if (c === '+') return true;
  if (c === '-') return true;
  if (c === '*') return true;
  if (c === '/') return true;
  if (c === '%') return true;
  if (c === '^') return true;
  if (c === '\\') return true;
  if (c === ':') return true;
  if (c === '&') return true;
  if (c === '|') return true;
  if (c === "'") return true;
  if (c === '.' && c2 !== '' && /[!%&*+\-/<=>?\\^|~]/.test(c2)) return true;
  if (c !== undefined && c.charCodeAt(0) > 127 && !/[\p{L}\p{N}]/u.test(c)) return true;
  return false;
}
