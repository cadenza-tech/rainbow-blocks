// Bash per-parse cache builder: innermost enclosing unmatched parenthesis index

import type { ExcludedRegion } from '../types';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Tracks one `case ... in ... esac` scope during the forward pass.
// parenDepth: parenStack depth at the case's `in` keyword. A POSIX-style case
// pattern close `)` only "doesn't pop" when the current parenStack depth equals
// this value (no `(` has been opened since `in`/the last `;;`).
// inArmHeader: true between `in` (or `;;`/`;&`/`;;&`) and the next pattern's `)`.
interface CaseScope {
  parenDepth: number;
  inArmHeader: boolean;
}

// Skips backward to find the start of a word ending at endPos (inclusive). Used
// to verify word boundaries when matching `case`/`in`/`esac` and the case-arm
// separators `;;`/`;&`/`;;&` during the forward pass.
function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}

// Returns true when the substring source[pos..pos+word.length] equals `word`
// with ASCII word boundaries on both sides. Used to identify case/in/esac
// reserved words while building the enclosing-paren cache.
function matchKeywordAt(source: string, pos: number, word: string): boolean {
  if (pos + word.length > source.length) return false;
  if (source.slice(pos, pos + word.length) !== word) return false;
  if (pos > 0 && isWordChar(source[pos - 1])) return false;
  const after = pos + word.length;
  if (after < source.length && isWordChar(source[after])) return false;
  return true;
}

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
//
// Case-pattern handling: a POSIX case pattern close like `a)` inside `case x in
// a) ... ;; esac` is NOT a subshell `(` close. Popping the paren stack at that
// `)` confuses the scope barrier (matchBlocks would report the wrong enclosing
// scope for subsequent tokens) so a doubly nested `( ( case x in a) ... esac ) )`
// fails to pair. The forward pass tracks case-arm state and skips the paren-stack
// pop when the `)` is a POSIX case pattern close.
export function computeEnclosingParenAtPos(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
  const len = source.length;
  const enclosing = new Int32Array(len + 1).fill(-1);
  const parenStack: number[] = [];
  // Stack of active `case ... in ... esac` scopes. The innermost scope's
  // inArmHeader flag drives the case-pattern detection for `)`.
  const caseStack: CaseScope[] = [];
  // True when we have seen a `case WORD` and are waiting for `in` (the case
  // header `in`). Once seen, the case scope is pushed onto caseStack.
  let awaitingCaseIn = false;
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
      i++;
      continue;
    }
    if (ch === ')') {
      // The `)` reports the paren enclosing the pair it closes.
      enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
      // POSIX case pattern close: when the innermost active case scope is in
      // arm-header state AND no `(` has been opened since `in`/the last `;;`,
      // this `)` closes a case pattern, not a subshell. Skip the parenStack pop
      // so the enclosing-paren scope for subsequent tokens stays accurate.
      const topCase = caseStack.length > 0 ? caseStack[caseStack.length - 1] : null;
      if (topCase?.inArmHeader && parenStack.length === topCase.parenDepth) {
        // Transition into the arm body; the next `;;`/`;&`/`;;&` returns us to
        // arm-header for the following pattern.
        topCase.inArmHeader = false;
        i++;
        continue;
      }
      parenStack.pop();
      i++;
      continue;
    }
    // `;;`, `;&`, `;;&` are case-arm separators. When seen in arm body at the
    // matching paren depth, they return the topmost case scope to arm-header
    // state so the next pattern's `)` is recognised as a case pattern close.
    if (ch === ';') {
      const topCase = caseStack.length > 0 ? caseStack[caseStack.length - 1] : null;
      if (topCase !== null && !topCase.inArmHeader && parenStack.length === topCase.parenDepth) {
        // `;;` or `;;&`
        if (i + 1 < len && source[i + 1] === ';') {
          topCase.inArmHeader = true;
          // Skip the second `;` and optional `&`
          i += 2;
          if (i < len && source[i] === '&') i++;
          continue;
        }
        // `;&`
        if (i + 1 < len && source[i + 1] === '&') {
          topCase.inArmHeader = true;
          i += 2;
          continue;
        }
      }
      enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
      i++;
      continue;
    }
    // Reserved word detection: only attempt when the previous character is NOT
    // a word character (cheap word-boundary check). This keeps the common case
    // (non-word chars in source) fast.
    if ((i === 0 || !isWordChar(source[i - 1])) && (ch === 'c' || ch === 'i' || ch === 'e')) {
      if (ch === 'c' && matchKeywordAt(source, i, 'case')) {
        // Begin awaiting the case header `in`. Nested case in arm body is
        // handled because the outer scope's inArmHeader flag is already false
        // when we enter the inner case (we set awaitingCaseIn here without
        // touching the outer scope).
        awaitingCaseIn = true;
        const top = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
        for (let p = i; p < i + 4; p++) enclosing[p] = top;
        i += 4;
        continue;
      }
      if (ch === 'i' && awaitingCaseIn && matchKeywordAt(source, i, 'in')) {
        // Push the new case scope: subsequent `)` at this paren depth in
        // arm-header state are case-pattern closes.
        caseStack.push({ parenDepth: parenStack.length, inArmHeader: true });
        awaitingCaseIn = false;
        const top = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
        for (let p = i; p < i + 2; p++) enclosing[p] = top;
        i += 2;
        continue;
      }
      if (ch === 'e' && matchKeywordAt(source, i, 'esac')) {
        // Pop the topmost case scope; an unmatched `esac` (no scope on the
        // stack) is left alone, the forward pass just records the enclosing
        // paren and moves on.
        if (caseStack.length > 0) {
          caseStack.pop();
        }
        // If a `case` was awaiting `in` but `esac` came first (e.g. malformed
        // `case ; esac`), drop the awaiting flag so subsequent tokens are not
        // misinterpreted as case-header content.
        awaitingCaseIn = false;
        const top = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
        for (let p = i; p < i + 4; p++) enclosing[p] = top;
        i += 4;
        continue;
      }
    }
    enclosing[i] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
    i++;
  }
  enclosing[len] = parenStack.length > 0 ? parenStack[parenStack.length - 1] : -1;
  return enclosing;
}
