// VHDL block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';
import type { BracketIndex } from './bracketIndex';

// Callbacks for base parser methods needed by validation functions
export interface VhdlValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Window sizes (in lines) for the backward prefix scans of isValidForOpen and
// isValidLoopOpen. Both functions only ever inspect a bounded number of lines
// before the keyword (isValidForOpen: current line + an `attempt < 10` loop that
// steps back at most 10 lines; isValidLoopOpen: `Math.min(lines.length, 15)`).
// Slicing only this window instead of the whole prefix turns the per-keyword
// O(N) prefix scan into O(window), so total parsing stays linear.
//
// The windows are deliberately larger than the strict bound (22 > 1 + 10, and
// 20 > 15) so the loop ALWAYS terminates before reaching the window start: a
// `prevNl <= 0` / `lastNewline > 0` check therefore detects the real source
// start only, never the window edge. When the source is smaller than the
// window, windowStart is 0 and local offsets equal absolute offsets, so the
// behavior is byte-for-byte identical to scanning the full prefix.
const FOR_OPEN_WINDOW_LINES = 22;
const LOOP_OPEN_WINDOW_LINES = 20;

// Window size (in lines) for the backward prefix scans of isValidEntityOrConfigOpen. The
// function inspects the current line plus two `attempt < 5` loops (one for `use`, one for
// a trailing `:`), each stepping back at most 5 lines. 12 (> 1 + 5) exceeds that bound so
// the loops always terminate before reaching the window start, keeping the `lastNl > 0` /
// `prevNl <= 0` source-start checks faithful (see findWindowStart and isValidForOpen).
const ENTITY_OPEN_WINDOW_LINES = 12;

// Returns the offset of the line start that is `lineCount` newlines before
// `position` (i.e. the start of the window that includes `position`'s line and
// the `lineCount` lines above it). Returns 0 when fewer than `lineCount`
// newlines precede `position`. The returned offset is always a line start:
// just after a `\n`, a lone `\r`, or 0. `\r\n` is counted as a single newline
// so the offset never lands between the `\r` and the `\n`. All three line
// ending styles (LF, CRLF, CR) are handled uniformly.
function findWindowStart(source: string, position: number, lineCount: number): number {
  let newlinesSeen = 0;
  for (let i = position - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === '\n') {
      newlinesSeen++;
      if (newlinesSeen >= lineCount) {
        return i + 1;
      }
      continue;
    }
    if (ch === '\r') {
      // Skip the `\r` of a `\r\n` pair: the following `\n` already counted it.
      if (i + 1 < source.length && source[i + 1] === '\n') {
        continue;
      }
      newlinesSeen++;
      if (newlinesSeen >= lineCount) {
        return i + 1;
      }
    }
  }
  return 0;
}

// Validates 'for' keyword: rejects 'wait for' timing statements, 'use entity/configuration ... for' binding clauses,
// and configuration specifications ('for <id/all/others> : <id> use entity/configuration ... ;')
export function isValidForOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  // Slice only the bounded window the scan can reach instead of the whole prefix.
  // `textBefore` offsets are window-relative; add `windowStart` to convert any of
  // them to an absolute source offset. When windowStart is 0 (small source) the
  // two coincide and behavior matches the original full-prefix scan exactly.
  const windowStart = findWindowStart(source, position, FOR_OPEN_WINDOW_LINES);
  const textBefore = source.slice(windowStart, position).toLowerCase();
  const lastNewline = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const lineStart = lastNewline + 1;
  const rawLineBefore = textBefore.slice(lineStart);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  // Strip trailing comments (-- ...) before checking for wait
  const lineBeforeNoComment = stripTrailingComment(lineBefore, windowStart + lineStart + trimOffset, excludedRegions, callbacks);
  // Reject 'for' in 'use entity ... for ...' or 'use configuration ... for ...' binding clauses
  const useEntityMatch = lineBeforeNoComment.match(/\buse[ \t]+(entity|configuration)\b/);
  if (useEntityMatch && useEntityMatch.index !== undefined) {
    const useAbsOffset = windowStart + lineStart + trimOffset + useEntityMatch.index;
    if (!callbacks.isInExcludedRegion(useAbsOffset, excludedRegions)) {
      let hasSemicolon = false;
      for (let ci = useAbsOffset + useEntityMatch[0].length; ci < position; ci++) {
        if (source[ci] === ';' && !callbacks.isInExcludedRegion(ci, excludedRegions)) {
          hasSemicolon = true;
          break;
        }
      }
      if (!hasSemicolon) {
        return false;
      }
    }
  }
  if (isWaitBeforeFor(source, lineBeforeNoComment, windowStart + lineStart, rawLineBefore, excludedRegions, callbacks)) {
    return false;
  }
  // Check previous lines for 'wait' or 'use entity/configuration' (multi-line, skip blank lines).
  // `lastNewline > 0` (and the `prevNl <= 0` checks below) detect the source start;
  // with windowStart > 0 the window always has multiple lines, so a window-relative
  // lastNewline is either -1 or >= 1 there — never 0 — and the loop (`attempt < 10`)
  // terminates well before reaching the window edge, keeping these checks faithful.
  if (lastNewline > 0) {
    let scanEnd = lastNewline;
    // Skip the \r in \r\n pairs
    if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
      scanEnd--;
    }
    let mapParenDepth = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const prevNl = Math.max(textBefore.lastIndexOf('\n', scanEnd - 1), textBefore.lastIndexOf('\r', scanEnd - 1));
      const rawPrevLine = textBefore.slice(prevNl + 1, scanEnd);
      const prevLine = rawPrevLine.trimStart();
      if (/^[ \t]*$/.test(prevLine)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevTrimOffset = rawPrevLine.length - prevLine.length;
      const prevLineNoComment = stripTrailingComment(prevLine, windowStart + prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      // Skip comment-only lines (line content is entirely inside a comment)
      if (/^[ \t]*$/.test(prevLineNoComment)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevUseMatch = prevLineNoComment.match(/\buse[ \t]+(entity|configuration)\b/);
      if (prevUseMatch && prevUseMatch.index !== undefined) {
        const prevUseAbsOffset = windowStart + prevNl + 1 + prevTrimOffset + prevUseMatch.index;
        if (!callbacks.isInExcludedRegion(prevUseAbsOffset, excludedRegions)) {
          let prevHasSemicolon = false;
          for (let ci = prevUseAbsOffset + prevUseMatch[0].length; ci < position; ci++) {
            if (source[ci] === ';' && !callbacks.isInExcludedRegion(ci, excludedRegions)) {
              prevHasSemicolon = true;
              break;
            }
          }
          if (!prevHasSemicolon) {
            return false;
          }
        }
      }
      if (isWaitBeforeFor(source, prevLineNoComment, windowStart + prevNl + 1, rawPrevLine, excludedRegions, callbacks)) {
        return false;
      }
      // A previous line that ends with `;` outside excluded regions terminates the
      // statement, so it cannot be a continuation of a wait clause or port/generic map.
      // Without this guard, e.g. `wait\n  for 10 ns;\nfor i in 0 to 7 loop` would be
      // misread as a 3-line wait statement and the second `for` would be rejected.
      const prevLineEndsWithSemicolon = lineEndsWithSemicolonOutsideExcluded(
        windowStart + prevNl + 1 + prevTrimOffset,
        prevLineNoComment,
        excludedRegions,
        callbacks
      );
      // Continue scanning upward through wait-clause continuation lines (`on signal_list`,
      // `until cond`, `for time`) so a multi-line wait statement is detected as a whole.
      if (!prevLineEndsWithSemicolon && /^[ \t]*(on|until|for)\b/i.test(prevLineNoComment)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      // Continue scanning upward through port map / generic map lines
      if (!prevLineEndsWithSemicolon && /\b(port|generic)[ \t]+map\b/.test(prevLineNoComment)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      // Track parenthesis depth: continue scanning upward through multi-line port/generic map content
      // Accumulate depth across lines (not reset per line)
      {
        const lineAbsStart = windowStart + prevNl + 1;
        for (let ci = lineAbsStart + rawPrevLine.length - 1; ci >= lineAbsStart; ci--) {
          if (callbacks.isInExcludedRegion(ci, excludedRegions)) continue;
          if (source[ci] === ')') mapParenDepth++;
          else if (source[ci] === '(') mapParenDepth--;
        }
        if (mapParenDepth > 0) {
          if (prevNl <= 0) break;
          scanEnd = prevNl;
          if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
            scanEnd--;
          }
          continue;
        }
      }
      break;
    }
  }
  // Forward scan: reject 'for' in configuration specifications where
  // 'use entity' or 'use configuration' appears AFTER the 'for' keyword
  // Pattern: for <id/all/others> : <id> use entity/configuration ... ;
  if (hasUseEntityOrConfigAfterFor(source, position, excludedRegions, callbacks)) {
    return false;
  }
  return true;
}

// Scans forward from a 'for' keyword to detect configuration specification pattern
// Pattern: for <id/all/others> : <id> use entity/configuration ... ;
// Only matches when 'use entity' or 'use configuration' appears on the same line as 'for'
// (configuration blocks have 'use entity' on a separate indented line)
// Detects a block-form configuration (`for label : comp use entity ...; end for;`)
// by checking whether the first `end` keyword appearing after `pos` (within ~10 lines)
// is an `end for`. A block configuration is the only construct whose `for` is closed by
// `end for` (LRM 7.3.1), so the trailing keyword after `end` must be `for`.
//
// Returning true only for `end for` is load-bearing: a single-line config spec
// (`for all : comp use entity work.impl;`) that merely SITS INSIDE another block must not
// be mistaken for a block-form `for`. The first `end` it reaches is the enclosing block's
// `end loop`/`end block`/`end architecture`, never `end for`, so it correctly returns false
// and the `for` is treated as a single-line statement instead of a block opener.
function hasEndForKeyword(source: string, pos: number, len: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  let j = pos;
  let lineCount = 0;
  const maxLines = 10;
  while (j < len && lineCount <= maxLines) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    const ch = source[j];
    if (ch === '\n') {
      lineCount++;
      j++;
      continue;
    }
    if (ch === '\r') {
      lineCount++;
      j++;
      if (j < len && source[j] === '\n') j++;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const ws = j;
      while (j < len && /[a-zA-Z0-9_]/.test(source[j])) j++;
      if (source.slice(ws, j).toLowerCase() === 'end') {
        // Found the first `end`. Skip whitespace and excluded regions (comments) to the
        // trailing keyword and require it to be `for`. Any other `end <type>` belongs to an
        // enclosing block, so this `for` is a single-line config spec, not a block opener.
        let k = j;
        while (k < len) {
          if (callbacks.isInExcludedRegion(k, excludedRegions)) {
            const region = callbacks.findExcludedRegionAt(k, excludedRegions);
            if (region) {
              k = region.end;
              continue;
            }
          }
          const wc = source[k];
          if (wc === ' ' || wc === '\t' || wc === '\n' || wc === '\r') {
            k++;
            continue;
          }
          break;
        }
        if (k < len && /[a-zA-Z_]/.test(source[k])) {
          const ts = k;
          while (k < len && /[a-zA-Z0-9_]/.test(source[k])) k++;
          if (source.slice(ts, k).toLowerCase() === 'for') return true;
        }
        return false;
      }
      continue;
    }
    j++;
  }
  return false;
}

function hasUseEntityOrConfigAfterFor(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const forKeywordLength = 3;
  let j = position + forKeywordLength;
  const len = source.length;
  while (j < len) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    const ch = source[j];
    // Newline ends the same-line scan; config specs are single-line statements
    if (ch === '\n' || ch === '\r') {
      return false;
    }
    // Semicolon terminates the statement; no use entity/configuration found
    if (ch === ';') {
      return false;
    }
    // Check for word boundaries to detect keywords
    if (/[a-zA-Z_]/.test(ch)) {
      const wordStart = j;
      while (j < len && /[a-zA-Z0-9_]/.test(source[j])) {
        j++;
      }
      const word = source.slice(wordStart, j).toLowerCase();
      // If we hit 'loop' or 'generate', this is a real block opener (not a config spec)
      if (word === 'loop' || word === 'generate') {
        return false;
      }
      // Check for 'use' followed by 'entity' or 'configuration'
      if (word === 'use') {
        // Skip whitespace (spaces/tabs only, not newlines) after 'use'
        let k = j;
        while (k < len && (source[k] === ' ' || source[k] === '\t')) {
          k++;
        }
        if (k < len && /[a-zA-Z_]/.test(source[k])) {
          const nextWordStart = k;
          while (k < len && /[a-zA-Z0-9_]/.test(source[k])) {
            k++;
          }
          const nextWord = source.slice(nextWordStart, k).toLowerCase();
          if (nextWord === 'entity' || nextWord === 'configuration') {
            if (!callbacks.isInExcludedRegion(wordStart, excludedRegions)) {
              // If the next `end` after the use clause is `end for`, this is a block-form
              // configuration (a real block), not a single-line config spec
              if (hasEndForKeyword(source, k, len, excludedRegions, callbacks)) {
                return false;
              }
              return true;
            }
          }
        }
      }
      continue;
    }
    j++;
  }
  return false;
}

// Returns true when the keyword at `position` is preceded (after skipping whitespace,
// newlines, and excluded regions like comments) by a literal `.` — indicating a
// hierarchical reference like `inst.process` or `rec . end`.
export function isPrecededByDot(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  const i = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  return i >= 0 && source[i] === '.' && !callbacks.isInExcludedRegion(i, excludedRegions);
}

// Keywords that can validly appear immediately before an `end` close keyword on the
// same line (empty/single-line block bodies). After these keywords, `end` is a
// legitimate block close. Any other identifier-context token before `end` strongly
// suggests `end` is sitting inside an expression (e.g., `sig <= a end b;`).
const VALID_PRE_END_KEYWORDS = new Set<string>([
  'then',
  'else',
  'loop',
  'begin',
  'is',
  'generate',
  'record',
  'units',
  'body',
  'case',
  'process',
  'block',
  'function',
  'procedure',
  'entity',
  'architecture',
  'package',
  'component',
  'configuration',
  'context',
  'protected',
  'end'
]);

// Returns true if `end` at `position` is at a statement boundary: line start, after `;`,
// after `=>`, at start of source, or directly after a valid block-context keyword on
// the same line. Returns false if the preceding non-whitespace, non-excluded text is an
// identifier or arbitrary expression token, which means the `end` is inside an
// expression (e.g., `sig <= a end b;`) and must not be treated as a block close.
export function isAtStatementBoundary(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  // Scan backward over whitespace and excluded regions; remember if we crossed a newline.
  let crossedNewline = false;
  let i = position - 1;
  while (i >= 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '\n' || ch === '\r') {
      crossedNewline = true;
      i--;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      i--;
      continue;
    }
    break;
  }
  // Start of source or crossed a newline → line start, valid boundary.
  if (i < 0 || crossedNewline) return true;
  const ch = source[i];
  // After `;` (previous statement terminated) — valid boundary.
  if (ch === ';') return true;
  // After `=>` (case branch arrow with empty body, e.g., `when 0 => end case;`).
  if (ch === '>' && i > 0 && source[i - 1] === '=') return true;
  // After an identifier-like character: the preceding word may be a block-context
  // keyword (e.g., `loop end loop;`, `then end if;`). Read the word and check.
  if (/[a-zA-Z0-9_]/.test(ch)) {
    let wordStart = i;
    while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.slice(wordStart, i + 1).toLowerCase();
    if (VALID_PRE_END_KEYWORDS.has(word)) return true;
  }
  return false;
}

// Walks backward from `start` over whitespace and comments, returning the offset of the
// next non-whitespace/non-comment character (or -1 if start of source is reached).
export function skipBackwardWhitespaceAndComments(
  source: string,
  start: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): number {
  let i = start;
  while (i >= 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
    }
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i--;
      continue;
    }
    break;
  }
  return i;
}

// Validates 'while' keyword: rejects 'wait while' (not a loop construct).
// Walks backward through arbitrary tokens (whitespace, comments, signal names, commas,
// operators, parens, etc.) until reaching a `wait`/`on`/`until` keyword (reject case),
// a statement boundary like `;` or block keywords (accept case), or start of source.
// This handles multi-token wait clauses such as:
//   - `wait on sig while running;`
//   - `wait until clk = '1' while running;`
//   - `wait on a, b, c while running;`
//   - `wait\n  on sig\n  while running;` (multi-line)
export function isValidWhileOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  let i = position - 1;
  // Walk back through arbitrary tokens looking for `wait`. Stop at `;` or block-boundary
  // keywords. The walk is bounded by SCAN_LIMIT to prevent worst-case behavior on huge files.
  const SCAN_LIMIT = 4096;
  let scanned = 0;
  while (i >= 0 && scanned < SCAN_LIMIT) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        scanned++;
        continue;
      }
    }
    const ch = source[i];
    // Statement boundary: definitely not in a wait clause
    if (ch === ';') return true;
    // Identifier-like sequence: extract word and check if it's a stop keyword
    if (/[a-zA-Z0-9_]/.test(ch)) {
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) wordStart--;
      const word = source.slice(wordStart, i + 1).toLowerCase();
      // `wait` keyword: this `while` belongs to a wait statement, reject
      if (word === 'wait') return false;
      // Block boundary keywords: we've left the statement scope
      if (word === 'begin' || word === 'is' || word === 'then' || word === 'loop' || word === 'else' || word === 'elsif' || word === 'end') {
        return true;
      }
      i = wordStart - 1;
      scanned++;
      continue;
    }
    // Other characters (whitespace, operators, parens, commas, quotes etc.) — keep scanning back
    i--;
    scanned++;
  }
  return true;
}

// Validates 'component': rejects 'label: component' instantiation (not a declaration)
// Walks backward through whitespace, newlines, and excluded regions (comments) so that
// an instantiation written across multiple lines or with intervening comments is detected:
//   inst :
//     -- comment
//     component foo port map();
export function isValidComponentOpen(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const i = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  // If preceded by ':', this is a component instantiation (label: component name ...)
  if (i >= 0 && source[i] === ':') {
    if (!callbacks.isInExcludedRegion(i, excludedRegions)) {
      return false;
    }
  }
  return true;
}

// Validates 'entity'/'configuration': rejects 'use entity', 'label: entity' direct instantiation.
// Slices only the bounded window the backward scans can reach (current line + two
// `attempt < 5` loops stepping back at most 5 lines each) instead of the whole source
// prefix, so the per-keyword cost is O(window) rather than O(position). `textBefore`
// offsets are window-relative; add `windowStart` to convert any of them to an absolute
// source offset. ENTITY_OPEN_WINDOW_LINES (12 > 1 + 5) exceeds the strict scan bound, so
// the loops always terminate before reaching the window edge: a window-relative
// `lastNl`/`prevNl` is either -1 or >= 1 (never 0) when windowStart > 0, so the
// `lastNl > 0` / `prevNl <= 0` source-start checks detect the real source start only.
// When windowStart is 0 (small source) local and absolute offsets coincide and behavior
// is byte-for-byte identical to scanning the full prefix.
export function isValidEntityOrConfigOpen(
  lowerKeyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const windowStart = findWindowStart(source, position, ENTITY_OPEN_WINDOW_LINES);
  const textBefore = source.slice(windowStart, position).toLowerCase();
  const lastNl = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const rawLineBefore = textBefore.slice(lastNl + 1);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  const lineBeforeNoComment = stripTrailingComment(lineBefore, windowStart + lastNl + 1 + trimOffset, excludedRegions, callbacks);
  if (/\buse[ \t]+$/.test(lineBeforeNoComment)) {
    return false;
  }
  // Check previous lines for 'use' (multi-line use entity/configuration)
  if (/^[ \t]*$/.test(lineBeforeNoComment) && lastNl > 0) {
    let scanEnd = lastNl;
    if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
      scanEnd--;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const prevNl = Math.max(textBefore.lastIndexOf('\n', scanEnd - 1), textBefore.lastIndexOf('\r', scanEnd - 1));
      const prevLine = textBefore.slice(prevNl + 1, scanEnd);
      const trimmedPrev = prevLine.trimStart();
      const prevTrimOffset = prevLine.length - trimmedPrev.length;
      if (trimmedPrev.trim().length === 0) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevNoComment = stripTrailingComment(trimmedPrev, windowStart + prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      const useMatch = prevNoComment.match(/\buse[ \t]*$/);
      if (useMatch && useMatch.index !== undefined) {
        // Check that the 'use' is not inside an excluded region (e.g., comment)
        const useOffset = windowStart + prevNl + 1 + prevTrimOffset + useMatch.index;
        if (!callbacks.isInExcludedRegion(useOffset, excludedRegions)) {
          return false;
        }
      }
      break;
    }
  }
  if (lowerKeyword === 'entity' || lowerKeyword === 'configuration') {
    const colonMatch = lineBeforeNoComment.match(/:[ \t]*$/);
    if (colonMatch) {
      const colonOffset = windowStart + lastNl + 1 + trimOffset + (lineBeforeNoComment.length - colonMatch[0].length);
      if (!callbacks.isInExcludedRegion(colonOffset, excludedRegions)) {
        return false;
      }
    }
    if (/^[ \t]*$/.test(lineBeforeNoComment) && lastNl > 0) {
      // Skip blank lines to find the preceding non-blank line with a colon
      let currentEnd = lastNl;
      for (let attempt = 0; attempt < 5; attempt++) {
        let searchEnd = currentEnd - 1;
        if (searchEnd >= 0 && textBefore[searchEnd] === '\r') {
          searchEnd--;
        }
        if (searchEnd < 0) break;
        const prevNl = Math.max(textBefore.lastIndexOf('\n', searchEnd), textBefore.lastIndexOf('\r', searchEnd));
        let prevLineEnd = currentEnd;
        if (prevLineEnd > 0 && textBefore[prevLineEnd - 1] === '\r') {
          prevLineEnd--;
        }
        const prevLine = textBefore.slice(prevNl + 1, prevLineEnd);
        if (/^[ \t]*$/.test(prevLine)) {
          currentEnd = prevNl >= 0 ? prevNl : 0;
          if (currentEnd <= 0) break;
          continue;
        }
        const prevColonMatch = prevLine.match(/:[ \t]*$/);
        if (prevColonMatch) {
          const prevColonOffset = windowStart + prevNl + 1 + (prevLine.length - prevColonMatch[0].length);
          if (!callbacks.isInExcludedRegion(prevColonOffset, excludedRegions)) {
            return false;
          }
        }
        break;
      }
    }
  }
  return true;
}

// Validates 'function'/'procedure': rejects declarations (ending with ;) that are not blocks
export function isValidFuncProcOpen(
  keyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  let j = position + keyword.length;
  let parenDepth = 0;
  while (j < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    if (source[j] === '(') parenDepth++;
    else if (source[j] === ')') parenDepth--;
    else if (parenDepth === 0) {
      if (source[j] === ';') return false;
      const twoChars = source.slice(j, j + 2).toLowerCase();
      if (twoChars === 'is' && (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) && (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))) {
        // Check if this is a 'null procedure' declaration (`is null;`), a VHDL-2019
        // expression function (`is (expression);`), or a VHDL-2008 subprogram
        // instantiation (`is new <generic_subprogram>;`) - none open a block.
        let k = j + 2;
        while (k < source.length && (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r')) {
          k++;
        }
        if (k < source.length && source[k] === '(') {
          return false;
        }
        const nullWord = source.slice(k, k + 4).toLowerCase();
        if (nullWord === 'null' && (k + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[k + 4]))) {
          return false;
        }
        const newWord = source.slice(k, k + 3).toLowerCase();
        if (newWord === 'new' && (k + 3 >= source.length || !/[a-zA-Z0-9_]/.test(source[k + 3]))) {
          return false;
        }
        return true;
      }
    }
    j++;
  }
  return false;
}

// Validates 'loop': checks for prefix keywords (for/while) and rejects standalone 'loop' in 'end loop'
export function isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  // Reject 'loop' preceded by a dot (e.g., record.loop, record . loop, or record . /* c */ loop).
  // Helper skips whitespace, newlines, and excluded regions.
  if (isPrecededByDot(source, position, excludedRegions, callbacks)) {
    return false;
  }

  // Look backwards across multiple lines to find if a prefix keyword precedes this.
  // Only the bounded window the scan can reach is sliced (the loop visits at most
  // `Math.min(lines.length, 15)` lines from the end). LOOP_OPEN_WINDOW_LINES (20)
  // exceeds that 15-line bound, so the visited lines are always the same as a
  // full-prefix scan. When the source has fewer lines than the window, windowStart
  // is 0 and the slice equals the full prefix, so behavior is unchanged.
  const windowStart = findWindowStart(source, position, LOOP_OPEN_WINDOW_LINES);
  const textBefore = source.slice(windowStart, position).toLowerCase();
  // Split on \r\n, \r, or \n to handle all line ending types
  const lines = textBefore.split(/\r\n|\r|\n/);
  const maxLines = Math.min(lines.length, 15);

  // Track loop positions that have been paired with a preceding for/while
  const pairedLoopPositions = new Set<number>();

  // Calculate absolute offsets for each line. Seeded with the absolute `position`
  // (not `textBefore.length`, which is window-relative) so every offset derived
  // from `lineStartOffset` below is a true source offset.
  let lineStartOffset = position;
  for (let idx = 0; idx < maxLines; idx++) {
    const lineIdx = lines.length - 1 - idx;
    const lineText = lines[lineIdx];
    if (idx > 0) {
      // Account for the line terminator (1 for \n or \r, 2 for \r\n)
      if (lineStartOffset >= 2 && source[lineStartOffset - 2] === '\r' && source[lineStartOffset - 1] === '\n') {
        lineStartOffset -= 2;
      } else {
        lineStartOffset -= 1;
      }
    }
    lineStartOffset -= lineText.length;

    for (const prefix of LOOP_PREFIX_KEYWORDS) {
      const pattern = new RegExp(`\\b${prefix}\\b`, 'g');
      for (const prefixMatch of lineText.matchAll(pattern)) {
        const absolutePos = lineStartOffset + prefixMatch.index;
        if (callbacks.isInExcludedRegion(absolutePos, excludedRegions)) {
          continue;
        }
        // Reject prefix keyword preceded by '.' (hierarchical reference like inst.for)
        let prefixDotCheck = absolutePos - 1;
        while (prefixDotCheck >= 0 && (source[prefixDotCheck] === ' ' || source[prefixDotCheck] === '\t')) {
          prefixDotCheck--;
        }
        if (prefixDotCheck >= 0 && source[prefixDotCheck] === '.') {
          continue;
        }
        // Check if 'generate' appears between the for/while and 'loop' (not in excluded region)
        // Must check all lines between prefix and loop, since generate may be on a different line
        const textBetween = source.slice(absolutePos, position).toLowerCase();
        const generatePattern = /\bgenerate\b/g;
        let isGeneratePrefix = false;
        for (const genMatch of textBetween.matchAll(generatePattern)) {
          const genAbsPos = absolutePos + genMatch.index;
          if (!callbacks.isInExcludedRegion(genAbsPos, excludedRegions)) {
            isGeneratePrefix = true;
            break;
          }
        }
        if (isGeneratePrefix) {
          continue;
        }
        // Check if 'for' is part of a 'wait for' timing statement (not a loop prefix)
        if (prefix === 'for' && !isValidForOpen(source, absolutePos, excludedRegions, callbacks)) {
          continue;
        }
        // Check if there's a 'loop' between this for/while and our loop position (already paired)
        // Search the text between the prefix and our position, not just the same line
        const searchStart = absolutePos + prefix.length;
        const textBetweenPrefixAndLoop = source.slice(searchStart, position).toLowerCase();
        const loopPattern = /\bloop\b/g;
        let foundPairedLoop = false;
        for (const loopMatch of textBetweenPrefixAndLoop.matchAll(loopPattern)) {
          const loopAbsPos = searchStart + loopMatch.index;
          if (callbacks.isInExcludedRegion(loopAbsPos, excludedRegions)) {
            continue;
          }
          // Check if this 'loop' is preceded by 'end' (part of 'end loop')
          const beforeLoopText = source
            .slice(Math.max(0, loopAbsPos - 10), loopAbsPos)
            .trimEnd()
            .toLowerCase();
          if (/\bend$/.test(beforeLoopText)) {
            continue;
          }
          // Skip loop positions already paired with a previous for/while
          if (pairedLoopPositions.has(loopAbsPos)) {
            continue;
          }
          pairedLoopPositions.add(loopAbsPos);
          foundPairedLoop = true;
          break;
        }
        if (foundPairedLoop) {
          continue;
        }
        // Check if a semicolon terminates the for/while before reaching our loop
        const prefixEnd = absolutePos + prefix.length;
        const textFromPrefixToLoop = source.slice(prefixEnd, position);
        let foundSemicolon = false;
        for (let si = 0; si < textFromPrefixToLoop.length; si++) {
          if (textFromPrefixToLoop[si] === ';') {
            const semiAbsPos = prefixEnd + si;
            if (!callbacks.isInExcludedRegion(semiAbsPos, excludedRegions)) {
              foundSemicolon = true;
              break;
            }
          }
        }
        if (foundSemicolon) {
          continue;
        }
        return false;
      }
    }

    // Stop at a previous statement (indicated by semicolon not in excluded region)
    if (idx > 0) {
      for (let ci = 0; ci < lineText.length; ci++) {
        if (lineText[ci] === ';' && !callbacks.isInExcludedRegion(lineStartOffset + ci, excludedRegions)) {
          return true;
        }
      }
    }
  }

  return true;
}

// Checks if position is within a signal assignment (has <= before it in the same statement)
// keyword parameter indicates which keyword ('when' or 'else') is being checked
export function isInSignalAssignment(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  keyword: string,
  callbacks: VhdlValidationCallbacks
): boolean {
  // Search backwards for <= or statement/block boundaries.
  //
  // PERFORMANCE: avoid materializing `source.toLowerCase()` per call. With many `when ...
  // else` chains (one validator call per intermediate `when`/`else`), an upfront
  // whole-source toLowerCase makes each call O(N) and the parse O(N^2). For
  // case-insensitive keyword checks we lowercase only the bounded local slice we are
  // about to compare (each slice is <= 6 chars), keeping per-check work O(1). This is
  // safe for the ASCII keywords compared below (`when`, `then`, `return`, `assert`,
  // `begin`, `loop`, `generate`, `is`, `end`) because their length is preserved by
  // `String.prototype.toLowerCase`, so offsets stay aligned with `source`.
  let i = position - 1;
  let foundWhen = false;
  while (i >= 0) {
    // Skip over excluded regions (comments, strings)
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.start - 1;
      continue;
    }
    const ch = source[i];
    if (ch === ';') return false;
    // Track 'when' keyword presence (conditional signal assignments require when before else)
    if (i >= 3) {
      const whenSlice = source.slice(i - 3, i + 1).toLowerCase();
      if (
        whenSlice === 'when' &&
        (i - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 4])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        foundWhen = true;
      }
    }
    if (ch === '=' && i > 0 && source[i - 1] === '<') {
      // For 'when': finding <= is sufficient (first when in conditional assignment)
      // For 'else': require a 'when' between <= and else
      // If scanning for 'else' and no 'when' found yet, this <= may be a comparison
      // operator (e.g., `sig <= '1' when x <= 5 else '0'`), so continue scanning
      if (keyword === 'when' || foundWhen) {
        // For 'else': verify the <= is not inside a then-branch of an if/elsif block
        // by scanning backward from <= looking for 'then' before ';'
        if (keyword === 'else') {
          let j = i - 2;
          let foundThenBeforeLe = false;
          while (j >= 0) {
            const rj = callbacks.findExcludedRegionAt(j, excludedRegions);
            if (rj) {
              j = rj.start - 1;
              continue;
            }
            // Semicolon means the <= starts a new statement; it's a valid signal assignment
            if (source[j] === ';') break;
            // Check for 'then' keyword boundary
            if (j >= 3) {
              const thenSlice = source.slice(j - 3, j + 1).toLowerCase();
              if (
                thenSlice === 'then' &&
                (j - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[j - 4])) &&
                (j + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 1]))
              ) {
                foundThenBeforeLe = true;
                break;
              }
            }
            j--;
          }
          // When 'then' is found before '<=' (first statement in if/elsif block),
          // the <= IS a signal assignment. Check if this 'else' has a value expression
          // on the same line (e.g., "else b;") to confirm it is part of the signal
          // assignment, not the if-block's else on its own line
          if (foundThenBeforeLe) {
            const elseEnd = position + keyword.length;
            let k = elseEnd;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
              k++;
            }
            // If next non-space character is a newline, end of source, or inline comment,
            // this else is likely the if-block's else, not part of the signal assignment
            if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
              return false;
            }
            // Inline comment (--) after else means no value expression follows
            if (k + 1 < source.length && source[k] === '-' && source[k + 1] === '-') {
              return false;
            }
            // Otherwise, there's content on the same line after else (value expression),
            // so this else IS part of the conditional signal assignment
            return true;
          }
        }
        return true;
      }
      // Skip past the < of <= and continue scanning for the real signal assignment <=
      i -= 2;
      continue;
    }
    // Port/generic map association: => (e.g., sig => val when cond else other)
    // But NOT case branch arrow (when choice =>)
    if (ch === '>' && i > 0 && source[i - 1] === '=') {
      if (isCaseBranchArrow(source, i - 1, excludedRegions, callbacks)) {
        i -= 2;
        continue;
      }
      return keyword === 'when' || foundWhen;
    }
    // Variable assignment :=
    if (ch === '=' && i > 0 && source[i - 1] === ':') {
      return keyword === 'when' || foundWhen;
    }
    // 'return' starts a conditional expression context (return X when C else Y)
    if (i >= 5) {
      const retSlice = source.slice(i - 5, i + 1).toLowerCase();
      if (
        retSlice === 'return' &&
        (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        return keyword === 'when' || foundWhen;
      }
    }
    // 'assert' starts a (concurrent or sequential) assertion statement that may carry a
    // trailing `when condition` (concurrent assertion guard). The trailing `when` is NOT
    // a case branch intermediate, so filter it out the same way as a conditional signal
    // assignment. The boundary keywords below (then/begin/loop/generate/is/end) and `;`
    // already stop the scan from leaking out of the assertion's enclosing statement.
    if (i >= 5) {
      const assertSlice = source.slice(i - 5, i + 1).toLowerCase();
      if (
        assertSlice === 'assert' &&
        (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        return keyword === 'when' || foundWhen;
      }
    }
    // Stop at block boundary keywords that start a new context
    // Note: 'else'/'elsif' are NOT boundaries here because chained conditional
    // signal assignments use else (e.g., sig <= a when c1 else b when c2 else c;)
    // The 'then' keyword already acts as a boundary for if branches.
    for (const boundary of ['then', 'begin', 'loop', 'generate', 'is', 'end']) {
      const len = boundary.length;
      if (i >= len - 1) {
        const start = i - len + 1;
        if (
          source.slice(start, start + len).toLowerCase() === boundary &&
          (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) &&
          (start + len >= source.length || !/[a-zA-Z0-9_]/.test(source[start + len]))
        ) {
          return false;
        }
      }
    }
    i--;
  }
  return false;
}

// Checks if => at position is part of a case branch (preceded by 'when' keyword).
//
// PERFORMANCE: mirrors isInSignalAssignment — case-insensitive keyword checks lowercase
// the bounded local slice instead of relying on a precomputed full-source lowercase
// string (which would re-introduce the O(N^2) cost the caller deliberately removed).
function isCaseBranchArrow(source: string, eqPos: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  let j = eqPos - 1;
  while (j >= 0) {
    const rj = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (rj) {
      j = rj.start - 1;
      continue;
    }
    const c = source[j];
    if (c === ';') return false;
    // Check for 'when' keyword (4 chars ending at j)
    if (j >= 3) {
      const slice = source.slice(j - 3, j + 1).toLowerCase();
      if (slice === 'when' && (j - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[j - 4])) && (j + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 1]))) {
        return true;
      }
    }
    // Stop at block boundary keywords
    for (const boundary of ['then', 'begin', 'is', 'end']) {
      const len = boundary.length;
      if (j >= len - 1) {
        const start = j - len + 1;
        if (
          source.slice(start, start + len).toLowerCase() === boundary &&
          (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) &&
          (start + len >= source.length || !/[a-zA-Z0-9_]/.test(source[start + len]))
        ) {
          return false;
        }
      }
    }
    j--;
  }
  return false;
}

// Checks if position is inside parenthesized expression (port map, generic map, function call,
// VHDL-2008 generic subprogram default declarations). Uses a pre-computed BracketIndex
// (built once per parse, `()` only) to find the innermost enclosing `(` span in O(log n)
// instead of rescanning the source prefix per keyword. To avoid false-positives from
// broken/in-progress paren state (e.g., `port map (a => b;` followed by a fresh statement),
// the enclosing `(` is required to have a matching `)` strictly after `position`.
//
// IMPORTANT: `span.close === -1` marks an enclosing `(` that is never closed. Such an
// unclosed `(` must NOT count as "inside parens" — `-1 > position` is false, which is
// exactly the behavior of the previous `hasMatchingCloseParen` (it returned false when
// no matching `)` was found). This `-1` interpretation is load-bearing for parity.
export function isInsideParens(position: number, parenIndex: BracketIndex): boolean {
  const span = parenIndex.enclosing(position);
  return span !== null && span.close > position;
}

// Strips trailing comment content from a line using excluded regions
// textAbsOffset is the absolute offset where lineText starts in the source
function stripTrailingComment(
  lineText: string,
  textAbsOffset: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): string {
  for (let ci = 0; ci < lineText.length - 1; ci++) {
    if (lineText[ci] === '-' && lineText[ci + 1] === '-') {
      const absPos = textAbsOffset + ci;
      // Only strip if this is the start of a comment (excluded region starts here)
      // not if we're inside a string (excluded region starts before here)
      const region = callbacks.findExcludedRegionAt(absPos, excludedRegions);
      if (region && region.start === absPos) {
        return lineText.slice(0, ci).trimEnd();
      }
    }
  }
  return lineText;
}

// Returns true when the trimmed line text (with trailing comment stripped) ends with `;`,
// where the `;` is not inside an excluded region. The absolute offset corresponds to the
// first character of `lineTextNoComment` in the source. Used to detect terminated
// statements that cannot be continuations of multi-line wait clauses or port/generic maps.
function lineEndsWithSemicolonOutsideExcluded(
  lineAbsOffset: number,
  lineTextNoComment: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  for (let ci = lineTextNoComment.length - 1; ci >= 0; ci--) {
    const ch = lineTextNoComment[ci];
    if (ch === ' ' || ch === '\t') continue;
    if (ch !== ';') return false;
    return !callbacks.isInExcludedRegion(lineAbsOffset + ci, excludedRegions);
  }
  return false;
}

// Checks if 'wait' at the end of line text is a real wait statement
// (not inside an excluded region like a string or comment)
// Finds the LAST valid wait on the line, since earlier waits may be terminated by semicolons
function isWaitBeforeFor(
  source: string,
  trimmedLineText: string,
  lineAbsOffset: number,
  rawLineText: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const trimOffset = rawLineText.length - rawLineText.trimStart().length;
  const waitPattern = /\bwait\b/gi;
  let lastUnterminatedWait = false;
  for (const match of trimmedLineText.matchAll(waitPattern)) {
    const waitAbsPos = lineAbsOffset + trimOffset + match.index;
    if (callbacks.isInExcludedRegion(waitAbsPos, excludedRegions)) {
      continue;
    }
    // Reject wait preceded by '.' (hierarchical reference like rec.wait, also
    // `rec . /* c */ wait` after comments). Use the full source for the dot check so
    // that excluded regions (block/line comments) are correctly traversed.
    if (isPrecededByDot(source, waitAbsPos, excludedRegions, callbacks)) {
      continue;
    }
    // Check if this wait is terminated by a semicolon
    const afterWait = trimmedLineText.slice(match.index + 4);
    let terminated = false;
    for (let ci = 0; ci < afterWait.length; ci++) {
      if (afterWait[ci] === ';') {
        const semiAbsPos = waitAbsPos + 4 + ci;
        if (!callbacks.isInExcludedRegion(semiAbsPos, excludedRegions)) {
          terminated = true;
          break;
        }
      }
    }
    lastUnterminatedWait = !terminated;
  }
  return lastUnterminatedWait;
}
