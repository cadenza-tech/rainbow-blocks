// AppleScript helper functions for validation and logical line navigation

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by helper functions
export interface ApplescriptHelperCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Returns the index of the first excluded region whose end is greater than `rangeStart`.
// Because excludedRegions is sorted by start and individual regions never overlap
// (each region's end is at most the next region's start), the `end` property is
// monotonically non-decreasing, so binary search on `end` is valid.
function firstRegionEndingAfter(regions: ExcludedRegion[], rangeStart: number): number {
  let lo = 0;
  let hi = regions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (regions[mid].end > rangeStart) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

// Returns the offset one past the n-th physical newline starting at `start`.
// If fewer than `lineCount` newlines exist, returns `source.length`. Used to cap
// the after-keyword scan window inside isKeywordAsVariableName to a bounded
// number of physical lines, so each call's cost stays bounded regardless of
// the total source length.
export function findNthPhysicalLineEnd(source: string, start: number, lineCount: number): number {
  let seen = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\r') {
      seen++;
      if (i + 1 < source.length && source[i + 1] === '\n') i++;
      if (seen >= lineCount) return i + 1;
      continue;
    }
    if (ch === '\n') {
      seen++;
      if (seen >= lineCount) return i + 1;
    }
  }
  return source.length;
}

// Returns source.substring(rangeStart, rangeEnd) with every character whose
// offset falls inside an excluded region replaced with a single-space character.
// Uses binary search on the sorted excludedRegions array so the cost is
// O(log N + K) where K is the number of regions overlapping the range, instead
// of the O(N) `excludedRegions.filter(...)` pattern that scans the whole array
// for every keyword being validated.
export function stripExcludedRegionsInRange(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  excludedRegions: ExcludedRegion[] | undefined
): string {
  let result = source.substring(rangeStart, rangeEnd);
  if (!excludedRegions || excludedRegions.length === 0 || rangeStart >= rangeEnd) {
    return result;
  }
  for (let i = firstRegionEndingAfter(excludedRegions, rangeStart); i < excludedRegions.length; i++) {
    const region = excludedRegions[i];
    if (region.start >= rangeEnd) break;
    const overlapStart = Math.max(region.start, rangeStart);
    const overlapEnd = Math.min(region.end, rangeEnd);
    const regionLen = overlapEnd - overlapStart;
    const relStart = overlapStart - rangeStart;
    result = result.substring(0, relStart) + ' '.repeat(regionLen) + result.substring(relStart + regionLen);
  }
  return result;
}

// Detects Unicode whitespace characters that may separate words in compound keywords:
// NBSP (U+00A0), EN/EM/IDEOGRAPHIC SPACEs, and zero-width space.
export function isUnicodeWhitespace(ch: string): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (
    code === 0x00a0 ||
    code === 0x200b ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

// Pre-compiled regex patterns used by isKeywordAsVariableName and the parser's
// compound-keyword variable-name guards. The character class `[ \t  -...]`
// matches ASCII space/tab plus Unicode whitespace characters recognized by
// isUnicodeWhitespace, so that `set<NBSP>tell<NBSP>to`-style patterns (with NBSP
// or other Unicode whitespace between words) are recognized the same way as their
// ASCII-whitespace counterparts. Pre-compiling avoids re-parsing the patterns on
// every keyword and keeps tokenize linear under large inputs.
const WSC = '[ \\t\\u00A0\\u2000-\\u200B\\u2028\\u2029\\u202F\\u205F\\u3000]';
export const VAR_NAME_PATTERNS = {
  setBefore: new RegExp(`(?:^|${WSC})set${WSC}+$`),
  copyBefore: new RegExp(`(?:^|${WSC})copy${WSC}+$`),
  possessiveBefore: new RegExp(`'s${WSC}+$`),
  ofToAfter: new RegExp(`^${WSC}+to\\b`),
  ofBefore: new RegExp(`\\bof${WSC}+$`),
  inBefore: new RegExp(`\\bin${WSC}+$`),
  exitBefore: new RegExp(`\\bexit${WSC}+$`),
  commandBefore: new RegExp(`\\b(?:return|log|get)${WSC}+$`),
  prepositionBefore: new RegExp(`\\b(?:to|thru|through|from|by|before|after|at)${WSC}+$`, 'i'),
  ofAfter: new RegExp(`^${WSC}+of\\b`),
  ofLineStart: new RegExp(`^${WSC}*of\\b`),
  setOrCopyBefore: new RegExp(`^(set|copy)${WSC}+$`)
} as const;

// Matches a compound keyword allowing flexible whitespace between words
// Also handles line continuation character (U+00AC) between words
// Returns the end position if matched, or -1 if not matched
export function matchCompoundKeyword(source: string, pos: number, keyword: string): number {
  const words = keyword.split(' ');
  let j = pos;
  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    if (source.slice(j, j + word.length).toLowerCase() !== word) {
      return -1;
    }
    j += word.length;
    // After each word except the last, consume whitespace including continuation and block comments
    if (w < words.length - 1) {
      if (
        j >= source.length ||
        (source[j] !== ' ' && source[j] !== '\t' && source[j] !== '\u00AC' && source.slice(j, j + 2) !== '(*' && !isUnicodeWhitespace(source[j]))
      ) {
        return -1;
      }
      // Consume spaces, tabs, and Unicode whitespace; also handle block comments
      while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
        j++;
      }
      // Skip block comments (* *) between words
      while (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
        let commentDepth = 1;
        j += 2;
        while (j < source.length && commentDepth > 0) {
          if (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
            commentDepth++;
            j += 2;
          } else if (j + 1 < source.length && source[j] === '*' && source[j + 1] === ')') {
            commentDepth--;
            j += 2;
          } else {
            j++;
          }
        }
        while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
          j++;
        }
      }
      // Handle continuation character(s) followed by optional whitespace/comments, newline, then optional whitespace
      while (j < source.length && source[j] === '\u00AC') {
        j++;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
          j++;
        }
        // Skip single-line comment (-- to end of line) after continuation
        if (j + 1 < source.length && source[j] === '-' && source[j + 1] === '-') {
          while (j < source.length && source[j] !== '\r' && source[j] !== '\n') {
            j++;
          }
        }
        // Skip block comment (* *) after continuation
        while (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
          let commentDepth = 1;
          j += 2;
          while (j < source.length && commentDepth > 0) {
            if (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
              commentDepth++;
              j += 2;
            } else if (j + 1 < source.length && source[j] === '*' && source[j + 1] === ')') {
              commentDepth--;
              j += 2;
            } else {
              j++;
            }
          }
          while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
            j++;
          }
        }
        let foundNewline = false;
        if (j < source.length && source[j] === '\r') {
          j++;
          foundNewline = true;
        }
        if (j < source.length && source[j] === '\n') {
          j++;
          foundNewline = true;
        }
        if (!foundNewline) {
          return -1;
        }
        while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
          j++;
        }
        // After the continuation's newline, consume any comments on the following line
        // so the next word can still be matched as part of the compound keyword.
        let changed = true;
        while (changed) {
          changed = false;
          // Single-line comment -- to end of line
          if (j + 1 < source.length && source[j] === '-' && source[j + 1] === '-') {
            while (j < source.length && source[j] !== '\r' && source[j] !== '\n') {
              j++;
            }
            changed = true;
          }
          // Block comment (* ... *) with nested depth
          while (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
            let commentDepth = 1;
            j += 2;
            while (j < source.length && commentDepth > 0) {
              if (j + 1 < source.length && source[j] === '(' && source[j + 1] === '*') {
                commentDepth++;
                j += 2;
              } else if (j + 1 < source.length && source[j] === '*' && source[j + 1] === ')') {
                commentDepth--;
                j += 2;
              } else {
                j++;
              }
            }
            changed = true;
          }
          while (j < source.length && (source[j] === ' ' || source[j] === '\t' || isUnicodeWhitespace(source[j]))) {
            j++;
            changed = true;
          }
          // Consume additional trailing newlines that follow the comments
          if (j < source.length && (source[j] === '\r' || source[j] === '\n')) {
            if (source[j] === '\r') j++;
            if (j < source.length && source[j] === '\n') j++;
            changed = true;
          }
        }
      }
    }
  }
  return j;
}

// Find the end of a logical line, following line continuations backward
// Checks if 'tell' is followed by 'to' on the same line (one-liner form)
// Find the end of a logical line, following U+00AC line continuations
export function findLogicalLineEnd(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: ApplescriptHelperCallbacks
): number {
  let lineEnd = position;
  while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
    // Skip over excluded regions (multi-line block comments may contain newlines)
    if (excludedRegions) {
      const region = callbacks.findExcludedRegionAt(lineEnd, excludedRegions);
      if (region) {
        lineEnd = region.end;
        continue;
      }
    }
    lineEnd++;
  }
  // Check if line ends with continuation
  while (lineEnd < source.length) {
    // Find last non-whitespace before line end. Skip ASCII whitespace and Unicode
    // whitespace (NBSP etc.) so `\u00AC<NBSP>\n` is still recognized as a continuation.
    let checkPos = lineEnd - 1;
    while (checkPos > position && (source[checkPos] === ' ' || source[checkPos] === '\t' || isUnicodeWhitespace(source[checkPos]))) {
      checkPos--;
    }
    // Skip excluded regions backward (e.g., single-line comments like "-- comment")
    if (excludedRegions) {
      while (checkPos > position) {
        const region = callbacks.findExcludedRegionAt(checkPos, excludedRegions);
        if (region) {
          checkPos = region.start - 1;
          while (checkPos > position && (source[checkPos] === ' ' || source[checkPos] === '\t' || isUnicodeWhitespace(source[checkPos]))) {
            checkPos--;
          }
          continue;
        }
        break;
      }
    }
    if (source[checkPos] !== '\u00AC') break;
    // Skip if the continuation is inside an excluded region (e.g., single-line comment)
    if (excludedRegions && callbacks.isInExcludedRegion(checkPos, excludedRegions)) break;
    // Skip newline (\n, \r\n, or \r)
    if (lineEnd < source.length && source[lineEnd] === '\r') {
      lineEnd++;
    }
    if (lineEnd < source.length && source[lineEnd] === '\n') {
      lineEnd++;
    }
    // Continue to next line end
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      if (excludedRegions) {
        const region = callbacks.findExcludedRegionAt(lineEnd, excludedRegions);
        if (region) {
          lineEnd = region.end;
          continue;
        }
      }
      lineEnd++;
    }
  }
  return lineEnd;
}

// Find the start of a logical line, following U+00AC line continuations backward
export function findLogicalLineStart(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: ApplescriptHelperCallbacks
): number {
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    // Skip over excluded regions (multi-line block comments may contain newlines)
    if (excludedRegions) {
      const region = callbacks.findExcludedRegionAt(lineStart - 1, excludedRegions);
      if (region) {
        lineStart = region.start;
        continue;
      }
    }
    lineStart--;
  }
  // Check if previous line ends with continuation
  while (lineStart >= 2) {
    const prevChar = source[lineStart - 1];
    if (prevChar !== '\n' && prevChar !== '\r') break;
    // Find end of previous line content (skip \r\n pair)
    let checkPos = lineStart - 1;
    if (prevChar === '\n' && checkPos > 0 && source[checkPos - 1] === '\r') {
      checkPos--;
    }
    // Find last non-whitespace before newline. Skip ASCII whitespace and Unicode
    // whitespace (NBSP etc.) so `\u00AC<NBSP>\n` is still recognized as a continuation.
    let contentEnd = checkPos - 1;
    while (contentEnd >= 0 && (source[contentEnd] === ' ' || source[contentEnd] === '\t' || isUnicodeWhitespace(source[contentEnd]))) {
      contentEnd--;
    }
    // Skip excluded regions backward (e.g., single-line comments like "-- comment")
    if (excludedRegions) {
      while (contentEnd >= 0) {
        const region = callbacks.findExcludedRegionAt(contentEnd, excludedRegions);
        if (region) {
          contentEnd = region.start - 1;
          while (contentEnd >= 0 && (source[contentEnd] === ' ' || source[contentEnd] === '\t' || isUnicodeWhitespace(source[contentEnd]))) {
            contentEnd--;
          }
          continue;
        }
        break;
      }
    }
    if (contentEnd < 0 || source[contentEnd] !== '\u00AC') break;
    // Skip if the continuation is inside an excluded region (e.g., single-line comment)
    if (excludedRegions && callbacks.isInExcludedRegion(contentEnd, excludedRegions)) break;
    // Go to start of previous line
    let prevLineStart = contentEnd;
    while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
      if (excludedRegions) {
        const region = callbacks.findExcludedRegionAt(prevLineStart - 1, excludedRegions);
        if (region) {
          prevLineStart = region.start;
          continue;
        }
      }
      prevLineStart--;
    }
    lineStart = prevLineStart;
  }
  return lineStart;
}

// Checks if a keyword is used inside an 'if ... then' condition
// e.g., 'if tell then' uses 'tell' as a condition value, not a block opener
export function isInsideIfCondition(
  source: string,
  position: number,
  keywordLength: number,
  excludedRegions: ExcludedRegion[],
  callbacks: ApplescriptHelperCallbacks
): boolean {
  const lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);
  // Strip excluded regions first (before toLowerCase to preserve positions)
  let rawBefore = source.slice(lineStart, position);
  for (const region of excludedRegions) {
    const overlapStart = Math.max(region.start, lineStart);
    const overlapEnd = Math.min(region.end, position);
    if (overlapStart < overlapEnd) {
      const relStart = overlapStart - lineStart;
      const relEnd = overlapEnd - lineStart;
      rawBefore = rawBefore.slice(0, relStart) + ' '.repeat(relEnd - relStart) + rawBefore.slice(relEnd);
    }
  }
  rawBefore = rawBefore.toLowerCase();
  // Normalize continuation characters for backward scan
  const beforeText = rawBefore.replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ');
  // Check if a condition-opening keyword appears before this keyword on the same logical line
  // Handles both simple cases (if tell then) and complex expressions (if not tell then, if true and tell then)
  // Ensure no 'then' appears between the condition opener and our keyword
  const condMatch = beforeText.match(/(?:^|[^a-z0-9_])(?:if|else\s+if|repeat\s+while|repeat\s+until)\b/);
  if (!condMatch) {
    return false;
  }
  // Verify no 'then' between the condition opener and our keyword
  const afterCond = beforeText.slice((condMatch.index ?? 0) + condMatch[0].length);
  if (/\bthen\b/.test(afterCond)) {
    return false;
  }
  // 'repeat while/until' conditions don't use 'then', so return true immediately.
  // Strip leading non-alphabetic prefix chars (e.g., `(` in `(repeat while ...`) before testing.
  const condMatchStr = condMatch[0].replace(/^[^a-z]+/i, '').trim();
  if (/^repeat\s+(while|until)$/i.test(condMatchStr)) {
    return true;
  }
  // Check if 'then' appears after this keyword on the same logical line
  const lineEnd = findLogicalLineEnd(source, position, excludedRegions, callbacks);
  let i = position + keywordLength;
  while (i < lineEnd) {
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.end;
      continue;
    }
    if (
      source.slice(i, i + 4).toLowerCase() === 'then' &&
      (i === 0 || !/\w/.test(source[i - 1])) &&
      (i + 4 >= source.length || !/\w/.test(source[i + 4]))
    ) {
      return true;
    }
    i++;
  }
  return false;
}

// Checks if a block keyword is being used as a variable name
// e.g., 'set repeat to 5', 'set script to "test"', 'copy tell to x'
export function isKeywordAsVariableName(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: ApplescriptHelperCallbacks
): boolean {
  // Find start of logical line (following continuations backward)
  const lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);
  // Strip excluded regions (block comments) from lineBefore, replacing with spaces.
  // Normalize continuations to spaces so regexes match across line breaks.
  // toLowerCase to avoid case mismatch.
  const lineBefore = stripExcludedRegionsInRange(source, lineStart, position, excludedRegions)
    .toLowerCase()
    .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
    .trimStart();

  // Strip excluded regions from after-keyword text first (before toLowerCase to preserve positions).
  // The patterns below only inspect up to the first few physical lines (and the first logical line
  // after \u00AC-continuation normalization), so cap the scan at a small bounded window instead of the
  // entire remaining source. Capping is required to keep tokenize linear when many keywords appear
  // in the same file \u2014 otherwise each keyword would pay O(remaining source) for the strip+regex pass.
  const kwEnd = position + keyword.length;
  const afterEnd = findNthPhysicalLineEnd(source, kwEnd, 10);
  let rawAfterKwText = stripExcludedRegionsInRange(source, kwEnd, afterEnd, excludedRegions);
  rawAfterKwText = rawAfterKwText.toLowerCase();
  const afterKwNorm = rawAfterKwText.replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ');

  // 'set <keyword> to' pattern (only on same logical line, not across plain newlines)
  if (VAR_NAME_PATTERNS.setBefore.test(lineBefore)) {
    if (VAR_NAME_PATTERNS.ofToAfter.test(afterKwNorm)) {
      return true;
    }
  }

  // 'copy <keyword> to' pattern (only on same logical line, not across plain newlines)
  if (VAR_NAME_PATTERNS.copyBefore.test(lineBefore)) {
    if (VAR_NAME_PATTERNS.ofToAfter.test(afterKwNorm)) {
      return true;
    }
  }

  // Possessive form: 'X's <keyword>' pattern (property access)
  if (VAR_NAME_PATTERNS.possessiveBefore.test(lineBefore)) {
    return true;
  }

  // '<keyword> of' pattern (property access, same physical line)
  // Use rawAfterKwText (excluded regions stripped but NOT continuation-normalized)
  // to avoid matching 'of' across continuation lines
  const afterPhysLines = rawAfterKwText.split(/\r\n|\r|\n/);
  const firstPhysLine = afterPhysLines[0];
  if (!keyword.includes(' ') && !keyword.includes('\t') && VAR_NAME_PATTERNS.ofAfter.test(firstPhysLine)) {
    return true;
  }
  // '<keyword> of' across continuation (only when keyword is in expression context)
  if (lineBefore.length > 0 && !keyword.includes(' ') && VAR_NAME_PATTERNS.ofAfter.test(afterKwNorm.split(/\r\n|\r|\n/)[0])) {
    return true;
  }
  // '<keyword> continuation\nof' at line start: suppress only when the line after 'of <value>' is
  // absent or not indented (not a block body). Compound keywords (e.g. 'end tell') are
  // never property access, so skip them.
  if (lineBefore.length === 0 && !keyword.includes(' ') && afterPhysLines.length >= 2) {
    if (/^[ \t]*\u00AC[ \t]*$/.test(firstPhysLine) && VAR_NAME_PATTERNS.ofLineStart.test(afterPhysLines[1])) {
      const lineAfterOf = afterPhysLines.length > 2 ? afterPhysLines[2] : '';
      if (lineAfterOf.length === 0 || !/^[ \t]/.test(lineAfterOf)) {
        return true;
      }
    }
  }

  // 'of <keyword>' pattern (keyword as object in property access)
  if (VAR_NAME_PATTERNS.ofBefore.test(lineBefore)) {
    return true;
  }

  // 'in <keyword>' pattern (keyword as list expression in repeat with X in <expr>)
  if (VAR_NAME_PATTERNS.inBefore.test(lineBefore)) {
    return true;
  }

  // 'exit repeat' is a control flow statement, not a block opener
  if (keyword === 'repeat' && VAR_NAME_PATTERNS.exitBefore.test(lineBefore)) {
    return true;
  }

  // Keywords used as values in command expression contexts
  // e.g., 'return tell', 'log repeat', 'get tell'
  if (lineBefore.length > 0) {
    if (VAR_NAME_PATTERNS.commandBefore.test(lineBefore)) {
      return true;
    }
  }

  // Bare 'end' used as a value in control flow contexts
  // e.g., 'if end then', 'if not end then', 'if true and end then', 'if (end > 0) then'
  if (keyword === 'end' && excludedRegions && isInsideIfCondition(source, position, keyword.length, excludedRegions, callbacks)) {
    return true;
  }

  // Bare 'end' after prepositions in expression context
  // e.g., 'repeat with i from 1 to end', 'items thru end', 'by end', 'before end', 'after end', 'at end'
  if (keyword === 'end' && VAR_NAME_PATTERNS.prepositionBefore.test(lineBefore)) {
    return true;
  }

  return false;
}
