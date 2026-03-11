// Fortran block validation helpers for isValidBlockClose and isValidProcedureOpen

import type { ExcludedRegion } from '../types';
import { findInlineCommentIndex, findLineEnd } from './fortranHelpers';

// Checks if position is at line start allowing leading whitespace (for # preprocessor)
export function isAtLineStartAllowingWhitespace(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  return i < 0 || source[i] === '\n' || source[i] === '\r';
}

// Validates 'procedure': rejects type-bound procedure declarations (with ::)
export function isValidProcedureOpen(
  keyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean
): boolean {
  let j = position + keyword.length;
  while (j < source.length) {
    const lineEnd = findLineEnd(source, j);
    const lineContent = source.slice(j, lineEnd);
    // Strip inline comment before checking for continuation & and ::
    let trimmedLine = lineContent.trimEnd();
    const commentPos = findInlineCommentIndex(trimmedLine);
    if (commentPos >= 0) {
      trimmedLine = trimmedLine.slice(0, commentPos).trimEnd();
    }
    // Skip comment-only lines (empty after stripping comment)
    if (trimmedLine.trimStart().length === 0 && commentPos >= 0) {
      j = lineEnd;
      if (j < source.length && source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
        j += 2;
      } else if (j < source.length) {
        j++;
      }
      continue;
    }
    let colonSearchIdx = 0;
    while (colonSearchIdx < lineContent.length - 1) {
      const colonIdx = lineContent.indexOf('::', colonSearchIdx);
      if (colonIdx < 0) break;
      if (!isInExcludedRegion(j + colonIdx, excludedRegions)) {
        return false;
      }
      colonSearchIdx = colonIdx + 2;
    }
    if (!trimmedLine.endsWith('&')) {
      break;
    }
    // Skip past line break (\r\n, \n, or standalone \r)
    j = lineEnd;
    if (j < source.length && source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
      j += 2;
    } else if (j < source.length) {
      j++;
    }
  }
  return true;
}

// Validates block close keywords
// Rejects 'end' used as variable name (followed by = but not ==)
export function isValidFortranBlockClose(keyword: string, source: string, position: number): boolean {
  if (keyword.toLowerCase() !== 'end') {
    return true;
  }
  let i = position + keyword.length;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  // end%component is derived type component access, not block close
  if (i < source.length && source[i] === '%') {
    return false;
  }
  // Handle & continuation: end &\n  = ... (assignment across lines)
  if (i < source.length && source[i] === '&') {
    i++;
    // Skip to next line
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      i++;
    }
    if (i < source.length && source[i] === '\r') i++;
    if (i < source.length && source[i] === '\n') i++;
    // Skip comment-only lines and bare & continuation lines between end & and content
    i = skipCommentAndContinuationLines(source, i);
    // Skip whitespace on next line
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Skip optional & continuation marker on the next line
    if (i < source.length && source[i] === '&') {
      i++;
      while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
        i++;
      }
    }
  }
  // end &\n%component (derived type component access across continuation)
  if (i < source.length && source[i] === '%') {
    return false;
  }
  // end = ... (assignment) but not end == ... (comparison)
  if (i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
    return false;
  }
  // end(1) = ... or end(1)(2) = ... (array element/section assignment)
  if (i < source.length && source[i] === '(') {
    let j = skipConsecutiveParenGroups(source, i);
    // Handle & continuation after paren: end(1) &\n  = value
    if (j < source.length && source[j] === '&') {
      j++;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        j++;
      }
      if (j < source.length && source[j] === '\r') j++;
      if (j < source.length && source[j] === '\n') j++;
      // Skip comment-only lines and bare & continuation lines
      j = skipCommentAndContinuationLines(source, j);
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
        j++;
      }
      if (j < source.length && source[j] === '&') {
        j++;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }
      }
    }
    if (j < source.length && source[j] === '=' && (j + 1 >= source.length || source[j + 1] !== '=')) {
      return false;
    }
  }
  return true;
}

// Skips comment-only lines and bare & continuation lines
function skipCommentAndContinuationLines(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    let lineContentStart = i;
    while (lineContentStart < source.length && (source[lineContentStart] === ' ' || source[lineContentStart] === '\t')) {
      lineContentStart++;
    }
    if (lineContentStart < source.length && source[lineContentStart] === '!') {
      // Comment-only line: skip to end of line
      let lineEnd = lineContentStart;
      while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
        lineEnd++;
      }
      if (lineEnd < source.length && source[lineEnd] === '\r') lineEnd++;
      if (lineEnd < source.length && source[lineEnd] === '\n') lineEnd++;
      i = lineEnd;
      continue;
    }
    // Bare & continuation line or & with inline comment
    if (lineContentStart < source.length && source[lineContentStart] === '&') {
      let afterAmp = lineContentStart + 1;
      while (afterAmp < source.length && (source[afterAmp] === ' ' || source[afterAmp] === '\t')) {
        afterAmp++;
      }
      // Bare & or & followed by comment
      if (afterAmp >= source.length || source[afterAmp] === '\n' || source[afterAmp] === '\r' || source[afterAmp] === '!') {
        let lineEnd = afterAmp;
        while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
          lineEnd++;
        }
        if (lineEnd < source.length && source[lineEnd] === '\r') lineEnd++;
        if (lineEnd < source.length && source[lineEnd] === '\n') lineEnd++;
        i = lineEnd;
        continue;
      }
    }
    break;
  }
  return i;
}

// Skips consecutive parenthesized groups: end(1)(2)(3)
function skipConsecutiveParenGroups(source: string, start: number): number {
  let j = start;
  while (j < source.length && source[j] === '(') {
    let depth = 1;
    j++;
    while (j < source.length && depth > 0) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
      j++;
    }
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
  }
  return j;
}
