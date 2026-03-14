// VHDL block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by validation functions
export interface VhdlValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Validates 'for' keyword: rejects 'wait for' timing statements
export function isValidForOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  const textBefore = source.slice(0, position).toLowerCase();
  const lastNewline = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const lineStart = lastNewline + 1;
  const rawLineBefore = textBefore.slice(lineStart);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  // Strip trailing comments (-- ...) before checking for wait
  const lineBeforeNoComment = stripTrailingComment(lineBefore, lineStart + trimOffset, excludedRegions, callbacks);
  if (isWaitBeforeFor(lineBeforeNoComment, lineStart, rawLineBefore, excludedRegions, callbacks)) {
    return false;
  }
  // Check previous lines for 'wait' (multi-line wait for, skip blank lines)
  if (/^[ \t]*$/.test(lineBefore) && lastNewline > 0) {
    let scanEnd = lastNewline;
    // Skip the \r in \r\n pairs
    if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
      scanEnd--;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
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
      const prevLineNoComment = stripTrailingComment(prevLine, prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      if (isWaitBeforeFor(prevLineNoComment, prevNl + 1, rawPrevLine, excludedRegions, callbacks)) {
        return false;
      }
      break;
    }
  }
  return true;
}

// Validates 'entity'/'configuration': rejects 'use entity', 'label: entity' direct instantiation
export function isValidEntityOrConfigOpen(
  lowerKeyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const textBefore = source.slice(0, position).toLowerCase();
  const lastNl = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const rawLineBefore = textBefore.slice(lastNl + 1);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  const lineBeforeNoComment = stripTrailingComment(lineBefore, lastNl + 1 + trimOffset, excludedRegions, callbacks);
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
      const prevNoComment = stripTrailingComment(trimmedPrev, prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      const useMatch = prevNoComment.match(/\buse[ \t]*$/);
      if (useMatch && useMatch.index !== undefined) {
        // Check that the 'use' is not inside an excluded region (e.g., comment)
        const useOffset = prevNl + 1 + prevTrimOffset + useMatch.index;
        if (!callbacks.isInExcludedRegion(useOffset, excludedRegions)) {
          return false;
        }
      }
      break;
    }
  }
  if (lowerKeyword === 'entity') {
    const colonMatch = lineBeforeNoComment.match(/:[ \t]*$/);
    if (colonMatch) {
      const colonOffset = lastNl + 1 + trimOffset + (lineBeforeNoComment.length - colonMatch[0].length);
      if (!callbacks.isInExcludedRegion(colonOffset, excludedRegions)) {
        return false;
      }
    }
    if (/^[ \t]*$/.test(lineBeforeNoComment) && lastNl > 0) {
      // Skip the \r in \r\n pair to avoid finding the same line ending
      let searchEnd = lastNl - 1;
      if (searchEnd >= 0 && textBefore[searchEnd] === '\r') {
        searchEnd--;
      }
      const prevNl = Math.max(textBefore.lastIndexOf('\n', searchEnd), textBefore.lastIndexOf('\r', searchEnd));
      let prevLineEnd = lastNl;
      if (prevLineEnd > 0 && textBefore[prevLineEnd - 1] === '\r') {
        prevLineEnd--;
      }
      const prevLine = textBefore.slice(prevNl + 1, prevLineEnd);
      const prevColonMatch = prevLine.match(/:[ \t]*$/);
      if (prevColonMatch) {
        const prevColonOffset = prevNl + 1 + (prevLine.length - prevColonMatch[0].length);
        if (!callbacks.isInExcludedRegion(prevColonOffset, excludedRegions)) {
          return false;
        }
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
        return true;
      }
    }
    j++;
  }
  return false;
}

// Validates 'loop': checks for prefix keywords (for/while) and rejects standalone 'loop' in 'end loop'
export function isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  // Reject 'loop' preceded by a dot (e.g., record.loop or record . loop)
  let dotCheck = position - 1;
  while (dotCheck >= 0 && (source[dotCheck] === ' ' || source[dotCheck] === '\t')) {
    dotCheck--;
  }
  if (dotCheck >= 0 && source[dotCheck] === '.') {
    return false;
  }

  // Look backwards across multiple lines to find if a prefix keyword precedes this
  const textBefore = source.slice(0, position).toLowerCase();
  // Split on \r\n, \r, or \n to handle all line ending types
  const lines = textBefore.split(/\r\n|\r|\n/);
  const maxLines = Math.min(lines.length, 5);

  // Track loop positions that have been paired with a preceding for/while
  const pairedLoopPositions = new Set<number>();

  // Calculate absolute offsets for each line
  let lineStartOffset = textBefore.length;
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
        // If the line also contains 'loop' not in excluded region, the for/while is already paired
        // Skip 'loop' that is part of 'end loop' (not a real loop opener) or already paired
        const loopPattern = /\bloop\b/g;
        let foundPairedLoop = false;
        for (const loopMatch of lineText.matchAll(loopPattern)) {
          const loopAbsPos = lineStartOffset + loopMatch.index;
          if (callbacks.isInExcludedRegion(loopAbsPos, excludedRegions)) {
            continue;
          }
          // Check if this 'loop' is preceded by 'end' (part of 'end loop')
          const beforeLoop = lineText.slice(0, loopMatch.index).trimEnd();
          if (/\bend$/i.test(beforeLoop)) {
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
  // Search backwards for <= or statement/block boundaries
  const lowerSource = source.toLowerCase();
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
      const whenSlice = lowerSource.slice(i - 3, i + 1);
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
        return true;
      }
      // Skip past the < of <= and continue scanning for the real signal assignment <=
      i -= 2;
      continue;
    }
    // Port/generic map association: => (e.g., sig => val when cond else other)
    if (ch === '>' && i > 0 && source[i - 1] === '=') {
      return keyword === 'when' || foundWhen;
    }
    // Variable assignment :=
    if (ch === '=' && i > 0 && source[i - 1] === ':') {
      return keyword === 'when' || foundWhen;
    }
    // 'return' starts a conditional expression context (return X when C else Y)
    if (i >= 5) {
      const retSlice = lowerSource.slice(i - 5, i + 1);
      if (
        retSlice === 'return' &&
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
          lowerSource.slice(start, start + len) === boundary &&
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

// Checks if 'wait' at the end of line text is a real wait statement
// (not inside an excluded region like a string or comment)
// Finds the LAST valid wait on the line, since earlier waits may be terminated by semicolons
function isWaitBeforeFor(
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
