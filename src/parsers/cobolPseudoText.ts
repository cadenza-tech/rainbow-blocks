// COBOL pseudo-text helpers: period positions, COPY REPLACING pseudo-text classification

import type { ExcludedRegion } from '../types';
import { isFixedFormatCommentLine } from './cobolFixedFormat';
import type { CobolHelperCallbacks } from './cobolHelpers';
import { COPY_TERMINATING_NONBLOCK_VERBS, COPY_TERMINATING_VERBS, matchExecBlock } from './cobolHelpers';
import { isInExcludedRegion } from './parserUtils';

// Single-pass scan to collect all period positions that are not inside
// strings, *> inline comments, >> compiler directives, or fixed-format
// column-7 comment lines. Builds a sorted array of every such period so
// findLastPeriodOutsideStringsBefore can binary-search the result.
export function buildPeriodPositions(source: string): number[] {
  const periods: number[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    // Skip *> inline comments to end of line
    if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Skip >> compiler directives to end of line
    if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === ch) {
          if (i + 1 < source.length && source[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        // String cannot span multiple lines in COBOL
        if (source[i] === '\n' || source[i] === '\r') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '.') {
      // Defer fixed-format-comment-line check until needed
      let lineStart = i;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      if (!isFixedFormatCommentLine(source, lineStart)) {
        periods.push(i);
      }
    }
    i++;
  }
  return periods;
}

// Scans from just after a COPY keyword for the first block-opening verb that
// appears past the copybook name. The copybook name is the first word after
// COPY; an optional `OF`/`IN <library>` qualifier may follow it. Returns the
// offset of that verb, or -1 when none is found before `limit`. Keywords
// inside excluded regions (strings, comments, EXEC blocks, pseudo-text) are
// skipped so they cannot be mistaken for a statement boundary.
export function findBlockVerbAfterCopybook(
  source: string,
  copyEnd: number,
  limit: number,
  excludedRegions: ExcludedRegion[],
  blockOpen: readonly string[]
): number {
  const WORD_PATTERN = /[a-zA-Z0-9][a-zA-Z0-9_-]*/g;
  WORD_PATTERN.lastIndex = copyEnd;
  let wordIndex = 0;
  let expectLibrary = false;
  let match = WORD_PATTERN.exec(source);
  while (match !== null && match.index < limit) {
    const wordPos = match.index;
    if (isInExcludedRegion(wordPos, excludedRegions)) {
      match = WORD_PATTERN.exec(source);
      continue;
    }
    const upper = match[0].toUpperCase();
    // Word 0 is the copybook name itself — never a statement boundary.
    if (wordIndex === 0) {
      wordIndex++;
      match = WORD_PATTERN.exec(source);
      continue;
    }
    // `COPY name OF lib` / `COPY name IN lib`: the library name follows the
    // OF/IN qualifier and is also part of the COPY statement.
    if (expectLibrary) {
      expectLibrary = false;
      match = WORD_PATTERN.exec(source);
      continue;
    }
    if (upper === 'OF' || upper === 'IN') {
      expectLibrary = true;
      match = WORD_PATTERN.exec(source);
      continue;
    }
    // A block-opening verb after the copybook name ends the COPY statement.
    if (blockOpen.some((kw) => kw === upper.toLowerCase())) {
      return wordPos;
    }
    wordIndex++;
    match = WORD_PATTERN.exec(source);
  }
  return -1;
}

// Scans the source and returns the set of source offsets that begin a pseudo-text
// region (`==`) inside a COPY REPLACING / REPLACE / ALSO context. The single forward
// scan tracks statement boundaries, the active COPY/REPLACE state, and known
// string/comment regions, so each `==` is classified in O(1) at lookup time and the
// total cost is O(n). Memoization per parse is handled by the parser-side wrapper.
// Falls back gracefully: positions not recognised here are still re-checked via the
// existing per-position helper, so we cannot regress correctness even if the scan
// misses an edge case.
export function getPseudoTextStarts(source: string, callbacks: CobolHelperCallbacks): Set<number> {
  const starts = new Set<number>();
  // Track statement-level state:
  //   - sawCopy: a COPY keyword was seen since the last period
  //   - inReplaceContext: a REPLACING/REPLACE/ALSO was seen, so following
  //     `==...==` pairs are pseudo-text. REPLACING additionally requires sawCopy.
  //   - copyWordsSeen: words seen since COPY (word 0 is the copybook name).
  //     Used to drop sawCopy when a block-opening verb ends a period-less COPY.
  //   - expectCopyLibrary: the next word is the library name of `COPY name OF`.
  let sawCopy = false;
  let inReplaceContext = false;
  let copyWordsSeen = 0;
  let expectCopyLibrary = false;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    // End of statement: period (outside strings/comments — those are handled
    // by the if-cases below). Reset all statement-level flags.
    if (ch === '.') {
      let lineStart = i;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      if (!isFixedFormatCommentLine(source, lineStart)) {
        sawCopy = false;
        inReplaceContext = false;
        copyWordsSeen = 0;
        expectCopyLibrary = false;
      }
      i++;
      continue;
    }
    // Newline: not a statement boundary on its own. A period-less COPY is
    // ended by the next statement verb (handled in the identifier scan below),
    // not by a line break, so just advance — COPY state is preserved across
    // newlines until either a period or a following statement verb is seen.
    if (ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // *> inline comment: skip to end of line
    if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // >> compiler directives: skip to end of line. Do NOT alter state — the
    // directive line is not part of program text.
    if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Fixed-format column 7 comment line indicator: if at column 6 (i.e.,
    // we are about to enter column 7), skip to end of line.
    if (ch === '*' || ch === '/' || ch === 'D' || ch === 'd') {
      let lineStart = i;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      if (isFixedFormatCommentLine(source, lineStart) && lineStart + 6 === i) {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
    }
    // String literals: skip past them so keywords inside strings are ignored.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === quote) {
          if (i + 1 < source.length && source[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        // COBOL strings cannot span line breaks (without fixed-format
        // continuation). Be lenient — let the dedicated string matcher
        // handle continuation logic; here we only need a coarse skip.
        if (source[i] === '\n' || source[i] === '\r') {
          break;
        }
        i++;
      }
      continue;
    }
    // EXEC/EXECUTE ... END-EXEC block: skip the whole block. Its body is a
    // foreign sub-language (SQL/CICS/...), so a REPLACE/REPLACING token inside
    // it must NOT alter COBOL pseudo-text state. Without this skip, a REPLACE
    // in an EXEC body sets inReplaceContext=true; since EXEC blocks need no
    // terminating period, the flag would leak past END-EXEC and mis-classify
    // later `==` as pseudo-text delimiters.
    if (ch === 'E' || ch === 'e') {
      const execRegion = matchExecBlock(source, i, callbacks);
      if (execRegion) {
        i = execRegion.end;
        continue;
      }
    }
    // `==` pseudo-text delimiter: if currently in a recognised REPLACE
    // context, record the opening offset and skip past the closing `==`.
    if (ch === '=' && i + 1 < source.length && source[i + 1] === '=') {
      if (inReplaceContext) {
        starts.add(i);
      }
      // Always skip past the `==...==` payload to the next `==` so we don't
      // mis-tokenise content inside the pseudo text. If unterminated, only
      // skip the opening `==` (consistent with matchPseudoText behaviour).
      // Pseudo-text content may span newlines (e.g., REPLACING ==a\nb== BY
      // ==c==), so we do not stop at line boundaries.
      let j = i + 2;
      let foundClose = false;
      while (j + 1 < source.length) {
        if (source[j] === '=' && source[j + 1] === '=') {
          j += 2;
          foundClose = true;
          break;
        }
        j++;
      }
      i = foundClose ? j : i + 2;
      continue;
    }
    // Identifier / keyword scan: only walk ASCII letter characters that
    // begin words to avoid duplicate work mid-identifier.
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
      const prev = i > 0 ? source[i - 1] : '';
      // Must be at a word boundary
      if (prev && (prev === '-' || /[a-zA-Z0-9_]/.test(prev))) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < source.length && /[a-zA-Z0-9_-]/.test(source[end])) {
        end++;
      }
      const word = source.slice(i, end).toUpperCase();
      // Reject hyphenated identifiers like X-REPLACING by checking the next char
      if (word === 'COPY') {
        sawCopy = true;
        copyWordsSeen = 0;
        expectCopyLibrary = false;
      } else if (word === 'REPLACE') {
        inReplaceContext = true;
      } else if (word === 'REPLACING' && sawCopy) {
        inReplaceContext = true;
      } else if (sawCopy) {
        // Words inside an in-progress COPY statement. word 0 is the copybook
        // name; `OF`/`IN <lib>` may qualify it. Any statement verb past the
        // copybook name ends a period-less COPY, so drop sawCopy — this stops
        // a later REPLACING from being treated as part of this COPY. Both
        // block-opening verbs (IF, PERFORM, ...) and non-block verbs (MOVE,
        // SET, ...) end the COPY; only data-name words are walked over.
        if (copyWordsSeen === 0) {
          copyWordsSeen = 1;
        } else if (expectCopyLibrary) {
          expectCopyLibrary = false;
        } else if (word === 'OF' || word === 'IN') {
          expectCopyLibrary = true;
        } else if (COPY_TERMINATING_VERBS.has(word) || COPY_TERMINATING_NONBLOCK_VERBS.has(word)) {
          sawCopy = false;
        } else {
          copyWordsSeen++;
        }
      }
      i = end;
      continue;
    }
    i++;
  }
  return starts;
}
