// Ada block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';
import { isAdaWordAt, scanForwardToIs, skipAdaWhitespaceAndComments } from './adaHelpers';

// Callbacks for base parser methods needed by validation functions
export interface AdaValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Keywords after 'is' that indicate a non-body declaration
const IS_NON_BODY_KEYWORDS = ['abstract', 'separate', 'new', 'null'];

// Validates 'task': forward declarations (task Name;) are not blocks
export function isValidTaskOpen(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  const isPos = scanForwardToIs(source, position + keyword.length, (pos) => callbacks.isInExcludedRegion(pos, excludedRegions));
  if (isPos < 0) return false;
  const k = skipAdaWhitespaceAndComments(source, isPos + 2);
  if (isAdaWordAt(source, k, 'separate')) return false;
  return true;
}

// Validates 'package': renames and instantiations (is new) are not blocks
export function isValidPackageOpen(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  const isPos = scanForwardToIs(source, position + keyword.length, (pos) => callbacks.isInExcludedRegion(pos, excludedRegions), ['renames']);
  if (isPos < 0) return false;
  const k = skipAdaWhitespaceAndComments(source, isPos + 2);
  if (isAdaWordAt(source, k, 'new')) return false;
  if (isAdaWordAt(source, k, 'separate')) return false;
  return true;
}

// Validates 'function'/'procedure': access types and declarations are not blocks
export function isValidSubprogramOpen(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  // Check for 'access' keyword before, skipping whitespace and comments
  let scanPos = position - 1;
  while (scanPos >= 0) {
    const ch = source[scanPos];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      scanPos--;
      continue;
    }
    if (callbacks.isInExcludedRegion(scanPos, excludedRegions)) {
      scanPos--;
      continue;
    }
    break;
  }
  if (scanPos >= 5) {
    const candidate = source.slice(scanPos - 5, scanPos + 1);
    if (candidate.toLowerCase() === 'access') {
      const beforeAccess = scanPos - 6;
      if (beforeAccess < 0 || !/[a-zA-Z0-9_]/.test(source[beforeAccess])) {
        return false;
      }
    }
  }
  // Scan forward: if ';' comes before 'is', it's a declaration, not a body
  const isPos = scanForwardToIs(source, position + keyword.length, (pos) => callbacks.isInExcludedRegion(pos, excludedRegions));
  if (isPos < 0) return false;
  const k = skipAdaWhitespaceAndComments(source, isPos + 2);
  const afterIs = source.slice(k).match(/^([a-zA-Z_]\w*)/);
  if (afterIs && IS_NON_BODY_KEYWORDS.includes(afterIs[1].toLowerCase())) {
    return false;
  }
  // 'is <>' is a generic default, not a body
  if (k < source.length && source[k] === '<' && k + 1 < source.length && source[k + 1] === '>') {
    return false;
  }
  return true;
}

// Validates 'accept': without 'do' is not a block opener
export function isValidAcceptOpen(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  let j = position + keyword.length;
  let parenDepth = 0;
  while (j < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    const ch = source[j];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (parenDepth === 0) {
      if (ch === ';') return false;
      const slice = source.slice(j, j + 2).toLowerCase();
      if (slice === 'do' && (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) && (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))) {
        return true;
      }
    }
    j++;
  }
  return false;
}

// Validates 'record': 'null record' is not a block opener
export function isValidRecordOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  // Scan backward from record, skipping whitespace and excluded regions, to find null
  let j = position - 1;
  while (j >= 0) {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      j = region.start - 1;
      continue;
    }
    if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
      j--;
      continue;
    }
    break;
  }
  // Check if the word ending at j is "null"
  if (j >= 3 && source.slice(j - 3, j + 1).toLowerCase() === 'null') {
    const beforeNull = j - 4;
    if (beforeNull < 0 || !/[a-zA-Z0-9_]/.test(source[beforeNull])) {
      if (!callbacks.isInExcludedRegion(j - 3, excludedRegions)) {
        return false;
      }
    }
  }
  return true;
}

// Validates 'protected': access types and forward declarations are not blocks
export function isValidProtectedOpen(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  const textBefore = source.slice(0, position);
  const accessMatch = textBefore.match(/\b(access)([ \t]+(all|constant))?[ \t]*$/i);
  if (accessMatch) {
    const accessPos = position - accessMatch[0].length + accessMatch[0].indexOf(accessMatch[1]);
    if (!callbacks.isInExcludedRegion(accessPos, excludedRegions)) {
      return false;
    }
  }
  // Scan forward: if ';' comes before 'is', it's a forward declaration
  const isPos = scanForwardToIs(source, position + keyword.length, (pos) => callbacks.isInExcludedRegion(pos, excludedRegions));
  if (isPos < 0) return false;
  const k = skipAdaWhitespaceAndComments(source, isPos + 2);
  if (isAdaWordAt(source, k, 'separate')) return false;
  return true;
}

// Validates 'for': representation clauses and quantified expressions are not blocks
export function isValidForOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  // Ada 2022 quantified expressions: (for all I in S => I > 0) inside parens
  if (isInsideParens(source, position, excludedRegions, callbacks)) {
    return false;
  }
  // Scan forward past the identifier (and dots, whitespace, newlines, comments)
  // looking for 'use' keyword or attribute tick "'"
  let i = skipAdaWhitespaceAndComments(source, position + 3);
  // Expect an identifier
  if (i >= source.length || !/[a-zA-Z_]/.test(source[i])) {
    return true;
  }
  // Skip identifier
  while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
    i++;
  }
  // Continue past dotted names (Pkg.Type.Component) with whitespace/comments between parts
  while (i < source.length) {
    const j = skipAdaWhitespaceAndComments(source, i);
    if (j < source.length && source[j] === '.') {
      i = skipAdaWhitespaceAndComments(source, j + 1);
      // Skip identifier after dot
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
        i++;
      }
    } else {
      i = j;
      break;
    }
  }
  // Skip whitespace/comments after the full name
  i = skipAdaWhitespaceAndComments(source, i);
  // Check for attribute tick (for X'Attribute use ...)
  if (i < source.length && source[i] === "'") {
    return false;
  }
  // Check for 'use' keyword (for T use record ... / for Color use (...))
  if (isAdaWordAt(source, i, 'use')) {
    return false;
  }
  return true;
}

// Validates 'loop': checks for preceding for/while prefix keywords
export function isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  const textBefore = source.slice(0, position);
  // Split on \r\n, \r, or \n to handle all line ending types
  const lineParts = textBefore.split(/\r\n|\r|\n/);
  const maxLines = Math.min(lineParts.length, 20);

  // Calculate absolute offset for the start of each line by scanning backward
  let lineStartOffset = textBefore.length;
  for (let idx = 0; idx < maxLines; idx++) {
    const lineIdx = lineParts.length - 1 - idx;
    const lineText = lineParts[lineIdx];
    if (idx > 0) {
      // Account for the line terminator (1 for \n or \r, 2 for \r\n)
      if (lineStartOffset >= 2 && source[lineStartOffset - 2] === '\r' && source[lineStartOffset - 1] === '\n') {
        lineStartOffset -= 2;
      } else {
        lineStartOffset -= 1;
      }
    }
    lineStartOffset -= lineText.length;

    // Count non-excluded for/while keywords on this line
    let prefixCount = 0;
    for (const prefix of LOOP_PREFIX_KEYWORDS) {
      const pattern = new RegExp(`\\b${prefix}\\b`, 'gi');
      for (const prefixMatch of lineText.matchAll(pattern)) {
        const absolutePos = lineStartOffset + prefixMatch.index;
        if (!callbacks.isInExcludedRegion(absolutePos, excludedRegions)) {
          prefixCount++;
        }
      }
    }
    if (prefixCount > 0) {
      // Find the rightmost non-excluded for/while position on this line
      let lastPrefixEnd = -1;
      for (const prefix of LOOP_PREFIX_KEYWORDS) {
        const pattern = new RegExp(`\\b${prefix}\\b`, 'gi');
        for (const prefixMatch of lineText.matchAll(pattern)) {
          const absolutePos = lineStartOffset + prefixMatch.index;
          if (!callbacks.isInExcludedRegion(absolutePos, excludedRegions)) {
            const end = prefixMatch.index + prefix.length;
            if (end > lastPrefixEnd) lastPrefixEnd = end;
          }
        }
      }
      // Check if any non-excluded 'loop' appears AFTER the rightmost for/while
      let hasLoopAfterPrefix = false;
      for (const loopMatch of lineText.matchAll(/\bloop\b/gi)) {
        if (loopMatch.index >= lastPrefixEnd) {
          const loopAbsPos = lineStartOffset + loopMatch.index;
          if (!callbacks.isInExcludedRegion(loopAbsPos, excludedRegions)) {
            hasLoopAfterPrefix = true;
            break;
          }
        }
      }
      // If the rightmost for/while already has a loop after it, this loop is standalone
      return hasLoopAfterPrefix;
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

// Checks if position is inside parentheses using proper nesting tracking
// Ada 2012 conditional/case expressions can appear inside any parentheses,
// including function call arguments: F(X, if A > 0 then B else C)
export function isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  let parenDepth = 0;
  let crossedNewline = false;
  for (let i = position - 1; i >= 0; i--) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '\n' || ch === '\r') {
      crossedNewline = true;
    }
    if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth === 0) {
        // When ( is on a different line, check for unterminated string after (
        // e.g. Put("unterminated\nif ...) should not treat if as inside parens
        if (crossedNewline && hasUnterminatedStringAfterParen(source, i, excludedRegions, callbacks)) {
          return false;
        }
        return true;
      }
      parenDepth--;
    }
  }
  return false;
}

// Checks if the char after ( is an unterminated string literal
function hasUnterminatedStringAfterParen(
  source: string,
  parenPos: number,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  let j = parenPos + 1;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
  if (j < source.length && source[j] === '"') {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      // Count consecutive quotes at the end of the region (starting from region.end - 1)
      // Odd count = last quote is a closing quote (terminated)
      // Even count = all quotes are doubled-quote escapes (unterminated)
      let quoteCount = 0;
      let qi = region.end - 1;
      while (qi > region.start && source[qi] === '"') {
        quoteCount++;
        qi--;
      }
      const isTerminated = region.end > region.start + 1 && quoteCount > 0 && quoteCount % 2 === 1;
      return !isTerminated;
    }
  }
  return false;
}
