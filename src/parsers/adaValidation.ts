// Ada block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';
import { isAdaWhitespace, isAdaWordAt, scanForwardToIs, skipAdaWhitespaceAndComments } from './adaHelpers';

// Intra-line whitespace per Ada LRM 2.1: any Ada whitespace except a line
// terminator (LF, CR, NEL U+0085, LS U+2028, PS U+2029). The access-prefix
// detection for `protected` needs this distinction so that `access<NBSP>protected`
// (same line) suppresses the block while `access\nprotected` (different lines)
// does not.
function isAdaIntraLineWhitespace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) return false;
  return isAdaWhitespace(ch);
}

// Scans backward from `end` (exclusive) skipping intra-line whitespace and
// returns the position immediately after the last non-whitespace char, or -1
// if the scan reached a line terminator (cross-line gap) or start of source.
function skipIntraLineWhitespaceBackward(source: string, end: number): number {
  let p = end - 1;
  while (p >= 0) {
    const ch = source[p];
    const code = ch.charCodeAt(0);
    if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) return -1;
    if (!isAdaIntraLineWhitespace(ch)) return p + 1;
    p--;
  }
  return 0;
}

// Returns true if the slice of `source` ending at `end` (exclusive) ends with
// the word `target` preceded by either start-of-source or a non-word char
// (treating only ASCII identifier chars as word chars). The match is
// case-insensitive.
function endsWithWord(source: string, end: number, target: string): boolean {
  if (end < target.length) return false;
  const start = end - target.length;
  if (source.slice(start, end).toLowerCase() !== target) return false;
  if (start === 0) return true;
  return !/[a-zA-Z0-9_]/.test(source[start - 1]);
}

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
  // Check for 'access' keyword before, skipping intra-line whitespace and
  // comments. Per Ada LRM 2.1, intra-line whitespace covers ASCII space/tab,
  // NBSP (U+00A0) and the Zs category; line terminators (LF, CR, NEL, LS, PS)
  // break the scan so that cross-line cases like `access\nprocedure` are not
  // confused with same-line access prefixes.
  let scanPos = position - 1;
  while (scanPos >= 0) {
    const ch = source[scanPos];
    const code = ch.charCodeAt(0);
    if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) {
      break;
    }
    if (isAdaIntraLineWhitespace(ch)) {
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
  // 'is (expr)' is an Ada 2012 expression function, not a block body
  if (k < source.length && source[k] === '(') {
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
      if (isAdaWordAt(source, j, 'do')) {
        return true;
      }
    }
    j++;
  }
  return false;
}

// Validates 'record': 'null record' is not a block opener
export function isValidRecordOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  // Scan backward from record, skipping Ada whitespace (LRM 2.1: ASCII
  // space/tab/CR/LF/VT/FF, NEL U+0085, NBSP U+00A0 and the Zs category,
  // plus line/paragraph separators) and excluded regions, to find null.
  let j = position - 1;
  while (j >= 0) {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      j = region.start - 1;
      continue;
    }
    if (isAdaWhitespace(source[j])) {
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
  // Look for an `access` prefix on the same physical line: skip intra-line
  // whitespace (Ada LRM 2.1: any Ada whitespace except a line terminator;
  // covers NBSP, NEL, LS, PS, and the Zs category in addition to space/tab),
  // optionally consume `all` or `constant`, then look for `access`. A
  // line-terminator break aborts the scan so cross-line cases like
  // `access\nprotected` still fall through to the forward-`is` check.
  const afterPrefixWord = skipIntraLineWhitespaceBackward(source, position);
  if (afterPrefixWord >= 0) {
    let accessEnd = afterPrefixWord;
    for (const optWord of ['all', 'constant']) {
      if (endsWithWord(source, accessEnd, optWord)) {
        const before = skipIntraLineWhitespaceBackward(source, accessEnd - optWord.length);
        if (before >= 0) {
          accessEnd = before;
          break;
        }
      }
    }
    if (endsWithWord(source, accessEnd, 'access')) {
      const accessPos = accessEnd - 'access'.length;
      if (!callbacks.isInExcludedRegion(accessPos, excludedRegions)) {
        return false;
      }
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

// Upper bound on the number of characters isValidLoopOpen scans backward from
// a `loop` keyword while looking for a for/while prefix. A for/while loop
// header and its `loop` keyword span only a few lines in real Ada code, so a
// generous 2048-character cap never rejects real code, while it keeps the scan
// O(1) per call — without it, a file with many `loop` keywords degrades to
// O(n^2) (every opener slicing and splitting all preceding source).
const MAX_LOOP_PREFIX_SCAN_CHARS = 2048;

// Validates 'loop': checks for preceding for/while prefix keywords
export function isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  // Bound the backward scan to the last MAX_LOOP_PREFIX_SCAN_CHARS characters.
  // A for/while prefix farther back than that cannot be this loop's header, so
  // the loop is then treated as a standalone opener. Snap the start to a line
  // boundary so the first scanned line is whole and absolute offsets stay exact.
  let scanStart = Math.max(0, position - MAX_LOOP_PREFIX_SCAN_CHARS);
  if (scanStart > 0) {
    while (scanStart < position && source[scanStart] !== '\n' && source[scanStart] !== '\r') {
      scanStart++;
    }
    if (scanStart < position) {
      scanStart += source[scanStart] === '\r' && source[scanStart + 1] === '\n' ? 2 : 1;
    }
  }
  const textBefore = source.slice(scanStart, position);
  // Split on \r\n, \r, or \n to handle all line ending types
  const lineParts = textBefore.split(/\r\n|\r|\n/);
  const maxLines = lineParts.length;

  // Calculate absolute offset for the start of each line by scanning backward
  let lineStartOffset = position;
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
      // Check if a semicolon appears after the rightmost for/while on this line
      // If so, the for/while is a complete statement (e.g., for T use 32;), not a loop prefix
      for (let ci = lastPrefixEnd; ci < lineText.length; ci++) {
        if (lineText[ci] === ';' && !callbacks.isInExcludedRegion(lineStartOffset + ci, excludedRegions)) {
          return true;
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

// Upper bound on the number of characters the isInsideParens backward scan may
// visit while at paren depth 0 before giving up. A parenthesized Ada
// conditional / quantified expression containing an if/case/for keyword spans
// only a small region (well under a few hundred characters in practice), so a
// generous cap of 2048 characters never rejects real code, while it keeps the
// scan O(1) per call — without it, deeply nested blocks (each opener scanning
// back to offset 0) degrade to O(n^2).
const MAX_PAREN_SCAN_CHARS = 2048;

// Scans forward from `position` and returns true if the position is enclosed
// by an unmatched `)` ahead — i.e., a `)` appears before any top-level `;`,
// without a balancing `(` between `position` and that `)`. Used to recognize
// when a backward-scan `;` is actually a parameter-list separator (e.g.,
// `F(X : Integer; Y : Integer := if A then 0 else 1)`) rather than a real
// statement terminator. Bounded by MAX_PAREN_SCAN_CHARS to keep the call O(1)
// per use, matching the backward-scan bound.
function isEnclosedByForwardCloseParen(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: AdaValidationCallbacks
): boolean {
  let depth = 0;
  let scanned = 0;
  for (let i = position; i < source.length; i++) {
    scanned++;
    if (scanned > MAX_PAREN_SCAN_CHARS) return false;
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end - 1;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      if (depth === 0) return true;
      depth--;
    } else if (ch === ';' && depth === 0) {
      return false;
    }
  }
  return false;
}

// Checks if position is inside parentheses using proper nesting tracking
// Ada 2012 conditional/case expressions can appear inside any parentheses,
// including function call arguments: F(X, if A > 0 then B else C)
export function isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  // Pre-check via forward scan: if a `)` ahead is unmatched at our depth, the
  // position is inside parens regardless of what the backward scan finds.
  // This handles parameter lists that use `;` as a separator, where the naive
  // backward scan would otherwise see the `;` at depth 0 and conclude (wrongly)
  // that we are at statement-top-level.
  const enclosedByForwardClose = isEnclosedByForwardCloseParen(source, position, excludedRegions, callbacks);
  let parenDepth = 0;
  let crossedNewline = false;
  let scannedChars = 0;
  for (let i = position - 1; i >= 0; i--) {
    // At paren depth 0 the position is not yet known to be inside any
    // parentheses. If the scan has visited more characters than any real
    // parenthesized expression would contain, stop early: an unmatched `(`
    // that far back is an in-progress edit and would be rejected anyway.
    // This bound (counting every iteration, including skipped comment /
    // string characters) is what keeps the scan O(1) per call.
    scannedChars++;
    if (parenDepth === 0 && scannedChars > MAX_PAREN_SCAN_CHARS) {
      return false;
    }
    if (callbacks.isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '\n' || ch === '\r') {
      crossedNewline = true;
    }
    // A top-level `;` terminates the previous statement. Ada parentheses
    // cannot span a statement boundary, so at paren depth 0 a `;` means the
    // position is not inside parentheses. This also bounds the scan to the
    // current statement.
    //
    // Exception: a parameter list (`procedure F(X : Integer; Y : Integer := ...) is`)
    // uses `;` as an intra-paren separator. When the forward scan already
    // confirmed an enclosing `)` ahead with no top-level `;` before it, this
    // `;` cannot be a real statement terminator — keep scanning so the matching
    // `(` (when reachable within the bound) is found.
    if (ch === ';' && parenDepth === 0 && !enclosedByForwardClose) {
      return false;
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
        // When ( is on a different line, also check if the ( itself is unterminated
        // (no matching ) anywhere ahead) — typical of in-progress edits or typos
        if (crossedNewline && !hasMatchingCloseParen(source, i, excludedRegions, callbacks)) {
          return false;
        }
        return true;
      }
      parenDepth--;
    }
  }
  return false;
}

// Scans forward from ( looking for a matching ), tracking nested parens and skipping excluded regions
function hasMatchingCloseParen(source: string, parenPos: number, excludedRegions: ExcludedRegion[], callbacks: AdaValidationCallbacks): boolean {
  let depth = 1;
  let i = parenPos + 1;
  while (i < source.length) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return true;
    }
    i++;
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
