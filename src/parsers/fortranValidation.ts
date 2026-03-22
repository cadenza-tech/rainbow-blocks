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

// Checks if a position is inside parentheses by scanning backward for unmatched '('
// Skips characters inside string literals (single/double quoted with doubled-quote escaping)
// and comments (! to end of line)
// Follows & continuation lines backward to handle multi-line expressions
function isInsideParentheses(source: string, position: number): boolean {
  // Find start of current physical line
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }

  let depth = 0;
  let depthBeforeLine = 0;
  let i = position - 1;
  // Pre-check: if keyword is at column 0 of a continuation line, extend backward
  if (i < lineStart && lineStart > 0) {
    const prevLineStart = findContinuationLineStart(source, lineStart);
    if (prevLineStart >= 0) {
      lineStart = prevLineStart;
    }
  }
  while (i >= lineStart) {
    const char = source[i];
    // Skip backward over string literals (look for closing quote and find opening quote)
    if (char === "'" || char === '"') {
      const quote = char;
      i--;
      let foundOpenQuote = false;
      while (i >= lineStart) {
        if (source[i] === quote) {
          if (i > lineStart && source[i - 1] === quote) {
            i -= 2;
            continue;
          }
          foundOpenQuote = true;
          break;
        }
        i--;
      }
      // If opening quote not found, extend search across continuation lines
      while (!foundOpenQuote && lineStart > 0) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart < 0) break;
        depthBeforeLine = depth;
        lineStart = prevLineStart;
        while (i >= lineStart) {
          if (source[i] === quote) {
            if (i > lineStart && source[i - 1] === quote) {
              i -= 2;
              continue;
            }
            foundOpenQuote = true;
            break;
          }
          i--;
        }
      }
      i--;
      continue;
    }
    // Comment indicator: when scanning backward, hitting ! means we've passed through
    // comment text (to the right of !) and reached the code/comment boundary.
    // We need to skip back to the start of the code portion on this line,
    // undoing any depth changes from characters inside the comment.
    if (char === '!') {
      // Rescan code portion (before !) to get correct depth, preserving depth from other lines
      let rescanDepth = 0;
      for (let s = lineStart; s < i; s++) {
        if (source[s] === "'" || source[s] === '"') {
          const q = source[s];
          s++;
          while (s < i) {
            if (source[s] === q) {
              if (s + 1 < i && source[s + 1] === q) {
                s++;
              } else {
                break;
              }
            }
            s++;
          }
          continue;
        }
        if (source[s] === '(') rescanDepth++;
        else if (source[s] === ')') rescanDepth--;
      }
      // Check if code portion has more ( than can be matched by pending )
      if (rescanDepth > depthBeforeLine) return true;
      depth = depthBeforeLine - rescanDepth;
      i = lineStart - 1;
      // When reaching line start, check if previous line has & continuation
      if (i < lineStart && lineStart > 0) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart >= 0) {
          depthBeforeLine = depth;
          lineStart = prevLineStart;
        }
      }
      continue;
    }
    // Skip & continuation character
    if (char === '&') {
      i--;
      // Check if we've crossed the line boundary after skipping &
      if (i < lineStart && lineStart > 0) {
        const prevLineStart = findContinuationLineStart(source, lineStart);
        if (prevLineStart >= 0) {
          depthBeforeLine = depth;
          lineStart = prevLineStart;
        }
      }
      continue;
    }
    if (char === ')') depth++;
    else if (char === '(') {
      if (depth === 0) return true;
      depth--;
    }
    i--;
    // When reaching line start, check if previous line has & continuation
    if (i < lineStart && lineStart > 0) {
      const prevLineStart = findContinuationLineStart(source, lineStart);
      if (prevLineStart >= 0) {
        depthBeforeLine = depth;
        lineStart = prevLineStart;
      }
    }
  }
  return false;
}

// Finds the start of the previous continuation line (if previous line ends with & outside comments)
// Returns the line start position, or -1 if no continuation
function findContinuationLineStart(source: string, currentLineStart: number): number {
  let searchStart = currentLineStart;
  // Loop to skip comment-only lines (Fortran allows comment lines between continuation lines)
  while (true) {
    let prevEnd = searchStart - 1;
    // Skip line terminator (\r\n as a unit, then standalone \n or \r)
    if (prevEnd >= 1 && source[prevEnd] === '\n' && source[prevEnd - 1] === '\r') {
      prevEnd -= 2;
    } else if (prevEnd >= 0 && (source[prevEnd] === '\n' || source[prevEnd] === '\r')) {
      prevEnd--;
    }
    if (prevEnd < 0) return -1;

    // Find start of previous line
    let prevLineStart = prevEnd;
    while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
      prevLineStart--;
    }

    // Check if line is comment-only (first non-whitespace is !)
    let firstNonWs = prevLineStart;
    while (firstNonWs <= prevEnd && (source[firstNonWs] === ' ' || source[firstNonWs] === '\t')) {
      firstNonWs++;
    }
    if (firstNonWs <= prevEnd && source[firstNonWs] === '!') {
      // Comment-only line, skip and check the line before
      searchStart = prevLineStart;
      continue;
    }

    // Find end of code portion (before ! comment), skipping strings
    let codeEnd = prevEnd;
    let inString = false;
    let quoteChar = '';
    for (let c = prevLineStart; c <= prevEnd; c++) {
      if (inString) {
        if (source[c] === quoteChar) {
          if (c + 1 <= prevEnd && source[c + 1] === quoteChar) {
            c++;
          } else {
            inString = false;
          }
        }
      } else if (source[c] === "'" || source[c] === '"') {
        inString = true;
        quoteChar = source[c];
      } else if (source[c] === '!') {
        codeEnd = c - 1;
        break;
      }
    }

    // Find last non-whitespace in code portion
    while (codeEnd >= prevLineStart && (source[codeEnd] === ' ' || source[codeEnd] === '\t')) {
      codeEnd--;
    }
    if (codeEnd >= prevLineStart && source[codeEnd] === '&') {
      return prevLineStart;
    }
    return -1;
  }
}

// Validates block close keywords
// Rejects 'end' used as variable name (followed by = but not ==) or component access (% before end)
export function isValidFortranBlockClose(keyword: string, source: string, position: number): boolean {
  // Reject end keywords inside parentheses (conditions, function arguments)
  if (isInsideParentheses(source, position)) {
    return false;
  }
  // For compound end keywords (enddo, endif, etc.), check after the full keyword
  const lowerKw = keyword.toLowerCase();
  if (lowerKw !== 'end' && lowerKw.startsWith('end')) {
    let i = position + keyword.length;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Handle & continuation: enddo &\n  = ... (assignment across lines)
    if (i < source.length && source[i] === '&') {
      i++;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      if (i < source.length && source[i] === '\r') i++;
      if (i < source.length && source[i] === '\n') i++;
      i = skipCommentAndContinuationLines(source, i);
      while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
        i++;
      }
      if (i < source.length && source[i] === '&') {
        i++;
        while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
          i++;
        }
      }
    }
    if (i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
      return false;
    }
    if (i < source.length && source[i] === '(') {
      const j = skipConsecutiveParenGroups(source, i);
      let k = j;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k < source.length && source[k] === '=' && (k + 1 >= source.length || source[k + 1] !== '=')) {
        return false;
      }
    }
    if (i < source.length && source[i] === '%') {
      return false;
    }
    return true;
  }
  if (lowerKw !== 'end') {
    return true;
  }
  // component%end is derived type component access, not block close
  let j = position - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j >= 0 && source[j] === '%') {
    return false;
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
