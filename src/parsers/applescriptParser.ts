// AppleScript block parser: handles compound keywords (end tell), nested comments, case-insensitive matching

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping from compound end keywords to their opening keywords
const END_KEYWORD_MAP: Readonly<Record<string, string>> = {
  'end tell': 'tell',
  'end if': 'if',
  'end repeat': 'repeat',
  'end try': 'try',
  'end considering': 'considering',
  'end ignoring': 'ignoring',
  'end using terms from': 'using terms from',
  'end timeout': 'with timeout',
  'end transaction': 'with transaction',
  'end script': 'script'
};

// All compound keywords sorted by length (longest first) for matching
const COMPOUND_KEYWORDS = [
  'using terms from',
  'end using terms from',
  'with transaction',
  'end transaction',
  'end considering',
  'with timeout',
  'end ignoring',
  'end timeout',
  'end repeat',
  'end script',
  'end tell',
  'end try',
  'on error',
  'else if',
  'end if'
];

export class ApplescriptBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'tell',
      'if',
      'repeat',
      'try',
      'considering',
      'ignoring',
      'using terms from',
      'with timeout',
      'with transaction',
      'script',
      'on',
      'to'
    ],
    blockClose: [
      'end',
      'end tell',
      'end if',
      'end repeat',
      'end try',
      'end considering',
      'end ignoring',
      'end using terms from',
      'end timeout',
      'end transaction',
      'end script'
    ],
    blockMiddle: ['else', 'else if', 'on error']
  };

  // Validates block open: single-line 'if' and 'tell...to' one-liners are not blocks
  // Also rejects keywords used as variable names in 'set X to' / 'copy X to' patterns
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Check if this keyword is used as a variable/property name
    // Patterns: 'set X to', 'copy X to', 'get X', 'X of Y', 'Y's X'
    if (this.isKeywordAsVariableName(source, position, keyword, excludedRegions)) {
      return false;
    }

    // 'tell ... to action' on one line is a one-liner, not a block
    if (keyword === 'tell') {
      if (this.isTellToOneLiner(source, position, excludedRegions)) {
        return false;
      }
      // Reject 'tell' when used as a condition value in 'if ... then' pattern
      if (this.isInsideIfCondition(source, position, keyword.length, excludedRegions)) {
        return false;
      }
      return true;
    }

    // Reject block keywords used as condition values in 'if ... then' pattern
    // (repeat, try, considering, ignoring are affected; script/on/to are already protected by isAtLogicalLineStart)
    if (keyword === 'repeat' || keyword === 'try' || keyword === 'considering' || keyword === 'ignoring') {
      if (this.isInsideIfCondition(source, position, keyword.length, excludedRegions)) {
        return false;
      }
      return true;
    }

    if (keyword !== 'if') {
      return true;
    }

    // Check if 'if' is inside another if/repeat condition (e.g., 'if if then')
    if (this.isInsideIfCondition(source, position, keyword.length, excludedRegions)) {
      return false;
    }

    // Find end of logical line (following ¬ continuations)
    const lineEnd = this.findLogicalLineEnd(source, position + keyword.length, excludedRegions);

    // Search for 'then' after 'if', skipping excluded regions
    let i = position + keyword.length;
    let thenPos = -1;
    while (i < lineEnd) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      // Check for 'then' keyword
      if (
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !/\w/.test(source[i - 1])) &&
        (i + 4 >= source.length || !/\w/.test(source[i + 4]))
      ) {
        thenPos = i;
        break;
      }
      i++;
    }

    if (thenPos >= 0) {
      // Check if there's non-excluded content after 'then' on the same logical line
      // Comments are not content, but strings, pipes, and chevrons ARE content
      let j = thenPos + 4;
      let effectiveLineEnd = lineEnd;
      while (j < effectiveLineEnd) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          // Only skip comments (-- and (* *)), not strings/pipes/chevrons
          if (
            source[region.start] === '-' ||
            (source[region.start] === '(' && region.start + 1 < source.length && source[region.start + 1] === '*')
          ) {
            j = region.end;
            // If the comment extends past the current line end, extend to the next line end
            if (j > effectiveLineEnd) {
              effectiveLineEnd = j;
              while (effectiveLineEnd < source.length && source[effectiveLineEnd] !== '\n' && source[effectiveLineEnd] !== '\r') {
                effectiveLineEnd++;
              }
            }
            continue;
          }
          // Non-comment excluded region (string, pipe, chevron) is real content -> single-line if
          return false;
        }
        if (source[j] !== ' ' && source[j] !== '\t' && source[j] !== '\r' && source[j] !== '\n' && source[j] !== '\u00AC') {
          // Non-whitespace, non-excluded content after 'then' -> single-line if
          return false;
        }
        j++;
      }
    }

    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: -- to end of line
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: (* *) with nesting support
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchNestedComment(source, pos);
    }

    // Double-quoted string with backslash and doubled-quote escaping (AppleScript strings are single-line)
    if (char === '"') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '\\' && j + 1 < source.length && source[j + 1] !== '\n' && source[j + 1] !== '\r') {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          // Doubled quote ("") is an escaped quote in legacy AppleScript
          if (j + 1 < source.length && source[j + 1] === '"') {
            j += 2;
            continue;
          }
          return { start: pos, end: j + 1 };
        }
        j++;
      }
      return { start: pos, end: j };
    }

    // Pipe-delimited identifier: |identifier|
    if (char === '|') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '|' && source[j] !== '\n' && source[j] !== '\r') {
        j++;
      }
      if (j < source.length && source[j] === '|') {
        return { start: pos, end: j + 1 };
      }
      return { start: pos, end: j };
    }

    // Chevron/guillemet syntax: \u00AB...\u00BB (raw Apple Events, data constants, class/property references)
    // Supports nesting: \u00ABa \u00ABb\u00BB c\u00BB
    if (char === '\u00AB') {
      let j = pos + 1;
      let depth = 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '\u00AB') depth++;
        else if (source[j] === '\u00BB') depth--;
        j++;
      }
      return { start: pos, end: j };
    }

    return null;
  }

  // Matches nested multi-line comment: (* ... *)
  private matchNestedComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length && depth > 0) {
      if (source[i] === '(' && i + 1 < source.length && source[i + 1] === '*') {
        depth++;
        i += 2;
        continue;
      }
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === ')') {
        depth--;
        i += 2;
        continue;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Override tokenize to handle compound keywords and case-insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const newlinePositions = this.buildNewlinePositions(source);
    let i = 0;

    while (i < source.length) {
      // Skip excluded regions
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }

      // Check word boundary at start
      if (i > 0 && /\w/.test(source[i - 1])) {
        i++;
        continue;
      }

      // Try compound keywords first (longest first, flexible whitespace)
      const compoundResult = this.tryMatchCompoundKeywordToken(source, i, excludedRegions, newlinePositions);
      if (compoundResult) {
        if (compoundResult.token) {
          if (!this.isAdjacentToUnicodeLetter(source, compoundResult.token.startOffset, compoundResult.nextPos - compoundResult.token.startOffset)) {
            tokens.push(compoundResult.token);
          }
        }
        i = compoundResult.nextPos;
        continue;
      }

      // Try single-word keywords
      const singleResult = this.tryMatchSingleKeywordToken(source, i, excludedRegions, newlinePositions);
      if (singleResult) {
        if (singleResult.token) {
          if (
            !this.isAdjacentToUnicodeLetter(source, singleResult.token.startOffset, singleResult.token.endOffset - singleResult.token.startOffset)
          ) {
            tokens.push(singleResult.token);
          }
        }
        i = singleResult.nextPos;
        continue;
      }

      i++;
    }

    return tokens;
  }

  // Tries to match a compound keyword at position, returns match result or null
  private tryMatchCompoundKeywordToken(
    source: string,
    i: number,
    excludedRegions: ExcludedRegion[],
    newlinePositions: number[]
  ): { nextPos: number; token?: Token } | null {
    for (const keyword of COMPOUND_KEYWORDS) {
      const flexMatch = this.matchCompoundKeyword(source, i, keyword);
      if (flexMatch < 0) continue;

      // Check word boundary at end
      if (flexMatch < source.length && /\w/.test(source[flexMatch])) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // Check if compound close keyword is used as a variable name
      if (type === 'block_close' && this.isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // Check if compound middle keyword is used as a variable name
      if (type === 'block_middle' && this.isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // 'on error' is only a keyword at logical line start (like single-word 'on')
      if (type === 'block_middle' && keyword === 'on error') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Check if compound middle keyword is used in set/copy/possessive patterns
      if (type === 'block_middle') {
        const ls = this.findLogicalLineStart(source, i, excludedRegions);
        const lineBefore = source
          .slice(ls, i)
          .toLowerCase()
          .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
          .trimStart();
        if (/^(set|copy)[ \t]+$/.test(lineBefore) || /'s[ \t]+$/.test(lineBefore)) {
          return { nextPos: flexMatch };
        }
      }

      // Reject compound block openers not at logical line start (covers if-condition, tell...to one-liner, and mid-line contexts)
      if (type === 'block_open') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Check if compound open keyword is used as a variable name
      if (type === 'block_open') {
        const ls = this.findLogicalLineStart(source, i, excludedRegions);
        let lineBeforeRaw = source.slice(ls, i);
        // Strip excluded regions first (before toLowerCase to preserve positions)
        if (excludedRegions) {
          const regionsBefore = excludedRegions.filter((region) => region.end > ls && region.start < i);
          for (const region of regionsBefore) {
            const overlapStart = Math.max(region.start, ls);
            const overlapEnd = Math.min(region.end, i);
            const regionLen = overlapEnd - overlapStart;
            const relStart = overlapStart - ls;
            lineBeforeRaw = lineBeforeRaw.substring(0, relStart) + ' '.repeat(regionLen) + lineBeforeRaw.substring(relStart + regionLen);
          }
        }
        const lineBefore = lineBeforeRaw
          .toLowerCase()
          .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
          .trimStart();
        if (
          /^(set|copy)[ \t]+$/.test(lineBefore) ||
          /'s[ \t]+$/.test(lineBefore) ||
          /\bof[ \t]+$/.test(lineBefore) ||
          /\bin[ \t]+$/.test(lineBefore) ||
          /\b(?:return|log|get)[ \t]+$/.test(lineBefore)
        ) {
          return { nextPos: flexMatch };
        }
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      return {
        nextPos: flexMatch,
        token: { type, value: keyword, startOffset: i, endOffset: flexMatch, line, column }
      };
    }

    return null;
  }

  // Tries to match a single-word keyword at position, returns match result or null
  private tryMatchSingleKeywordToken(
    source: string,
    i: number,
    excludedRegions: ExcludedRegion[],
    newlinePositions: number[]
  ): { nextPos: number; token?: Token } | null {
    const singleKeywords = ['tell', 'if', 'repeat', 'try', 'considering', 'ignoring', 'script', 'on', 'to', 'else', 'end'];

    for (const keyword of singleKeywords) {
      if (source.slice(i, i + keyword.length).toLowerCase() !== keyword) continue;

      const endPos = i + keyword.length;
      if (endPos < source.length && /\w/.test(source[endPos])) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // 'to', 'on', and 'script' are block openers only at line start
      if (type === 'block_open' && (keyword === 'to' || keyword === 'on' || keyword === 'script')) {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // 'considering' and 'ignoring' are block openers only at logical line start
      if (type === 'block_open' && (keyword === 'considering' || keyword === 'ignoring')) {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // Validate block open keywords (e.g., single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, i, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if block opener is used as a variable/property name or in expression context
      if (type === 'block_open' && this.isKeywordAsVariableName(source, i, keyword, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if 'end' is used as a variable/property name
      if (type === 'block_close' && keyword === 'end' && this.isKeywordAsVariableName(source, i, keyword, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if middle keyword is used as a variable/property name
      if (type === 'block_middle' && this.isKeywordAsVariableName(source, i, keyword, excludedRegions)) {
        return { nextPos: endPos };
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      return {
        nextPos: endPos,
        token: { type, value: keyword, startOffset: i, endOffset: endPos, line, column }
      };
    }

    return null;
  }

  // Checks if a keyword is at the start of a logical line (allowing block comments before)
  private isAtLogicalLineStart(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      // Skip over excluded regions (multi-line block comments may contain newlines)
      const region = this.findExcludedRegionAt(lineStart - 1, excludedRegions);
      if (region) {
        lineStart = region.start;
        continue;
      }
      lineStart--;
    }
    // Check if previous physical line ends with continuation character
    if (lineStart > 0) {
      let prevEnd = lineStart - 1;
      if (prevEnd >= 0 && source[prevEnd] === '\n') prevEnd--;
      if (prevEnd >= 0 && source[prevEnd] === '\r') prevEnd--;
      while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
        prevEnd--;
      }
      // Skip excluded regions backward (e.g., single-line comments like "-- comment")
      while (prevEnd >= 0) {
        const region = this.findExcludedRegionAt(prevEnd, excludedRegions);
        if (region) {
          prevEnd = region.start - 1;
          while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
            prevEnd--;
          }
          continue;
        }
        break;
      }
      if (prevEnd >= 0 && source[prevEnd] === '\u00AC' && !this.isInExcludedRegion(prevEnd, excludedRegions)) {
        return false;
      }
    }
    // Strip excluded regions (block comments) from the text before the keyword
    let beforeText = source.substring(lineStart, pos);
    const regionsBefore = excludedRegions.filter((region) => region.end > lineStart && region.start < pos);
    for (const region of regionsBefore) {
      const overlapStart = Math.max(region.start, lineStart);
      const overlapEnd = Math.min(region.end, pos);
      const regionLen = overlapEnd - overlapStart;
      const relStart = overlapStart - lineStart;
      beforeText = beforeText.substring(0, relStart) + ' '.repeat(regionLen) + beforeText.substring(relStart + regionLen);
    }
    return /^[ \t]*$/.test(beforeText);
  }

  // Matches blocks with specific pairing for compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          // 'on error' outside a try block is a standalone handler (block_open)
          if (token.value === 'on error') {
            // Only treat as intermediate if try is the direct parent (top of stack)
            if (stack.length > 0 && stack[stack.length - 1].token.value === 'try') {
              stack[stack.length - 1].intermediates.push(token);
              break;
            }
            // Otherwise, treat as standalone handler (block_open)
            stack.push({ token, intermediates: [] });
            break;
          }
          if (stack.length > 0) {
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value;
          let matchIndex = -1;

          // Check for specific end keyword (end tell, end if, etc.)
          const expectedOpener = END_KEYWORD_MAP[closeValue];
          if (expectedOpener) {
            matchIndex = findLastOpenerByType(stack, expectedOpener);
          } else {
            // Generic "end" closes any block
            matchIndex = stack.length > 0 ? stack.length - 1 : -1;
          }

          if (matchIndex >= 0) {
            const openBlock = stack.splice(matchIndex, 1)[0];
            pairs.push({
              openKeyword: openBlock.token,
              closeKeyword: token,
              intermediates: openBlock.intermediates,
              nestLevel: stack.length
            });
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Checks if 'tell' is followed by 'to' on the same line (one-liner form)
  // Find the end of a logical line, following ¬ (U+00AC) line continuations
  private findLogicalLineEnd(source: string, position: number, excludedRegions?: ExcludedRegion[]): number {
    let lineEnd = position;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      // Skip over excluded regions (multi-line block comments may contain newlines)
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(lineEnd, excludedRegions);
        if (region) {
          lineEnd = region.end;
          continue;
        }
      }
      lineEnd++;
    }
    // Check if line ends with ¬ continuation
    while (lineEnd < source.length) {
      // Find last non-whitespace before line end
      let checkPos = lineEnd - 1;
      while (checkPos > position && (source[checkPos] === ' ' || source[checkPos] === '\t')) {
        checkPos--;
      }
      // Skip excluded regions backward (e.g., single-line comments like "-- comment")
      if (excludedRegions) {
        while (checkPos > position) {
          const region = this.findExcludedRegionAt(checkPos, excludedRegions);
          if (region) {
            checkPos = region.start - 1;
            while (checkPos > position && (source[checkPos] === ' ' || source[checkPos] === '\t')) {
              checkPos--;
            }
            continue;
          }
          break;
        }
      }
      if (source[checkPos] !== '\u00AC') break;
      // Skip if the ¬ is inside an excluded region (e.g., single-line comment)
      if (excludedRegions && this.isInExcludedRegion(checkPos, excludedRegions)) break;
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
          const region = this.findExcludedRegionAt(lineEnd, excludedRegions);
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

  // Find the start of a logical line, following ¬ (U+00AC) line continuations backward
  private findLogicalLineStart(source: string, position: number, excludedRegions?: ExcludedRegion[]): number {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      // Skip over excluded regions (multi-line block comments may contain newlines)
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(lineStart - 1, excludedRegions);
        if (region) {
          lineStart = region.start;
          continue;
        }
      }
      lineStart--;
    }
    // Check if previous line ends with ¬ continuation
    while (lineStart >= 2) {
      const prevChar = source[lineStart - 1];
      if (prevChar !== '\n' && prevChar !== '\r') break;
      // Find end of previous line content (skip \r\n pair)
      let checkPos = lineStart - 1;
      if (prevChar === '\n' && checkPos > 0 && source[checkPos - 1] === '\r') {
        checkPos--;
      }
      // Find last non-whitespace before newline
      let contentEnd = checkPos - 1;
      while (contentEnd >= 0 && (source[contentEnd] === ' ' || source[contentEnd] === '\t')) {
        contentEnd--;
      }
      // Skip excluded regions backward (e.g., single-line comments like "-- comment")
      if (excludedRegions) {
        while (contentEnd >= 0) {
          const region = this.findExcludedRegionAt(contentEnd, excludedRegions);
          if (region) {
            contentEnd = region.start - 1;
            while (contentEnd >= 0 && (source[contentEnd] === ' ' || source[contentEnd] === '\t')) {
              contentEnd--;
            }
            continue;
          }
          break;
        }
      }
      if (contentEnd < 0 || source[contentEnd] !== '\u00AC') break;
      // Skip if the ¬ is inside an excluded region (e.g., single-line comment)
      if (excludedRegions && this.isInExcludedRegion(contentEnd, excludedRegions)) break;
      // Go to start of previous line
      let prevLineStart = contentEnd;
      while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
        if (excludedRegions) {
          const region = this.findExcludedRegionAt(prevLineStart - 1, excludedRegions);
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

  private isTellToOneLiner(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineEnd = this.findLogicalLineEnd(source, position + 4, excludedRegions);

    let i = position + 4;
    while (i < lineEnd) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      if (
        source.slice(i, i + 2).toLowerCase() === 'to' &&
        (i === 0 || !/\w/.test(source[i - 1])) &&
        (i + 2 >= source.length || !/\w/.test(source[i + 2]))
      ) {
        return true;
      }
      i++;
    }
    return false;
  }

  // Checks if a keyword is used inside an 'if ... then' condition
  // e.g., 'if tell then' uses 'tell' as a condition value, not a block opener
  private isInsideIfCondition(source: string, position: number, keywordLength: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineStart = this.findLogicalLineStart(source, position, excludedRegions);
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
    // 'repeat while/until' conditions don't use 'then', so return true immediately
    const condMatchStr = condMatch[0].trim();
    if (/^repeat\s+(while|until)$/i.test(condMatchStr)) {
      return true;
    }
    // Check if 'then' appears after this keyword on the same logical line
    const lineEnd = this.findLogicalLineEnd(source, position, excludedRegions);
    let i = position + keywordLength;
    while (i < lineEnd) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
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
  private isKeywordAsVariableName(source: string, position: number, keyword: string, excludedRegions?: ExcludedRegion[]): boolean {
    // Find start of logical line (following ¬ continuations backward)
    const lineStart = this.findLogicalLineStart(source, position, excludedRegions);
    // Strip excluded regions (block comments) from lineBefore, replacing with spaces
    let rawLineBefore = source.slice(lineStart, position);
    if (excludedRegions) {
      const regionsBefore = excludedRegions.filter((region) => region.end > lineStart && region.start < position);
      for (const region of regionsBefore) {
        const overlapStart = Math.max(region.start, lineStart);
        const overlapEnd = Math.min(region.end, position);
        const regionLen = overlapEnd - overlapStart;
        const relStart = overlapStart - lineStart;
        rawLineBefore = rawLineBefore.substring(0, relStart) + ' '.repeat(regionLen) + rawLineBefore.substring(relStart + regionLen);
      }
    }
    // Normalize ¬ continuations to spaces so regexes match across line breaks
    // toLowerCase to avoid case mismatch
    const lineBefore = rawLineBefore
      .toLowerCase()
      .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
      .trimStart();

    // Strip excluded regions from after-keyword text first (before toLowerCase to preserve positions)
    const kwEnd = position + keyword.length;
    let rawAfterKwText = source.slice(kwEnd);
    if (excludedRegions) {
      const regionsAfter = excludedRegions.filter((region) => region.end > kwEnd && region.start < source.length);
      for (const region of regionsAfter) {
        const overlapStart = Math.max(region.start, kwEnd);
        const overlapEnd = region.end;
        const regionLen = overlapEnd - overlapStart;
        const relStart = overlapStart - kwEnd;
        rawAfterKwText = rawAfterKwText.substring(0, relStart) + ' '.repeat(regionLen) + rawAfterKwText.substring(relStart + regionLen);
      }
    }
    rawAfterKwText = rawAfterKwText.toLowerCase();
    const afterKwNorm = rawAfterKwText.replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ');

    // 'set <keyword> to' pattern (only on same logical line, not across plain newlines)
    if (/(?:^|[ \t])set[ \t]+$/.test(lineBefore)) {
      if (/^[ \t]+to\b/.test(afterKwNorm)) {
        return true;
      }
    }

    // 'copy <keyword> to' pattern (only on same logical line, not across plain newlines)
    if (/(?:^|[ \t])copy[ \t]+$/.test(lineBefore)) {
      if (/^[ \t]+to\b/.test(afterKwNorm)) {
        return true;
      }
    }

    // Possessive form: 'X's <keyword>' pattern (property access)
    if (/'s[ \t]+$/.test(lineBefore)) {
      return true;
    }

    // '<keyword> of' pattern (property access, same physical line)
    // Use rawAfterKwText (excluded regions stripped but NOT continuation-normalized)
    // to avoid matching 'of' across continuation lines
    const afterPhysLines = rawAfterKwText.split(/\r\n|\r|\n/);
    const firstPhysLine = afterPhysLines[0];
    if (!keyword.includes(' ') && !keyword.includes('\t') && /^[ \t]+of\b/.test(firstPhysLine)) {
      return true;
    }
    // '<keyword> of' across continuation (only when keyword is in expression context)
    if (lineBefore.length > 0 && !keyword.includes(' ') && /^[ \t]+of\b/.test(afterKwNorm.split(/\r\n|\r|\n/)[0])) {
      return true;
    }
    // '<keyword> ¬\nof' at line start: suppress only when the line after 'of <value>' is
    // absent or not indented (not a block body). Compound keywords (e.g. 'end tell') are
    // never property access, so skip them.
    if (lineBefore.length === 0 && !keyword.includes(' ') && afterPhysLines.length >= 2) {
      if (/^[ \t]*\u00AC[ \t]*$/.test(firstPhysLine) && /^[ \t]*of\b/.test(afterPhysLines[1])) {
        const lineAfterOf = afterPhysLines.length > 2 ? afterPhysLines[2] : '';
        if (lineAfterOf.length === 0 || !/^[ \t]/.test(lineAfterOf)) {
          return true;
        }
      }
    }

    // 'of <keyword>' pattern (keyword as object in property access)
    if (/\bof[ \t]+$/.test(lineBefore)) {
      return true;
    }

    // 'in <keyword>' pattern (keyword as list expression in repeat with X in <expr>)
    if (/\bin[ \t]+$/.test(lineBefore)) {
      return true;
    }

    // 'exit repeat' is a control flow statement, not a block opener
    if (keyword === 'repeat' && /\bexit[ \t]+$/.test(lineBefore)) {
      return true;
    }

    // Keywords used as values in command expression contexts
    // e.g., 'return tell', 'log repeat', 'get tell'
    if (lineBefore.length > 0) {
      if (/\b(?:return|log|get)[ \t]+$/.test(lineBefore)) {
        return true;
      }
    }

    // Bare 'end' used as a value in control flow contexts
    // e.g., 'if end then', 'if not end then', 'if true and end then', 'if (end > 0) then'
    if (keyword === 'end' && excludedRegions && this.isInsideIfCondition(source, position, keyword.length, excludedRegions)) {
      return true;
    }

    // Bare 'end' after prepositions in expression context
    // e.g., 'repeat with i from 1 to end', 'items thru end', 'by end', 'before end', 'after end', 'at end'
    if (keyword === 'end' && /\b(?:to|thru|through|from|by|before|after|at)[ \t]+$/i.test(lineBefore)) {
      return true;
    }

    return false;
  }

  // Matches a compound keyword allowing flexible whitespace between words
  // Also handles line continuation character (U+00AC) between words
  // Returns the end position if matched, or -1 if not matched
  private matchCompoundKeyword(source: string, pos: number, keyword: string): number {
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
        if (j >= source.length || (source[j] !== ' ' && source[j] !== '\t' && source[j] !== '\u00AC' && source.slice(j, j + 2) !== '(*')) {
          return -1;
        }
        // Consume spaces/tabs and block comments, then optionally a continuation + newline + more spaces/tabs
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
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
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
            j++;
          }
        }
        // Handle continuation character(s) followed by optional whitespace/comments, newline, then optional whitespace
        while (j < source.length && source[j] === '\u00AC') {
          j++;
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
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
            while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
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
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
            j++;
          }
        }
      }
    }
    return j;
  }
}
