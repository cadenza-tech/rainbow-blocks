// AppleScript block parser: handles compound keywords (end tell), nested comments, case-insensitive matching

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import type { ApplescriptHelperCallbacks } from './applescriptHelpers';
import { findLogicalLineEnd, findLogicalLineStart, isInsideIfCondition, isKeywordAsVariableName, matchCompoundKeyword } from './applescriptHelpers';
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
  private get helperCallbacks(): ApplescriptHelperCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

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
    if (isKeywordAsVariableName(source, position, keyword, excludedRegions, this.helperCallbacks)) {
      return false;
    }

    // 'tell ... to action' on one line is a one-liner, not a block
    if (keyword === 'tell') {
      if (this.isTellToOneLiner(source, position, excludedRegions)) {
        return false;
      }
      // Reject 'tell' when used as a condition value in 'if ... then' pattern
      if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
        return false;
      }
      return true;
    }

    // Reject block keywords used as condition values in 'if ... then' pattern
    // (repeat, try, considering, ignoring are affected; script/on/to are already protected by isAtLogicalLineStart)
    if (keyword === 'repeat' || keyword === 'try' || keyword === 'considering' || keyword === 'ignoring') {
      if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
        return false;
      }
      return true;
    }

    if (keyword !== 'if') {
      return true;
    }

    // Check if 'if' is inside another if/repeat condition (e.g., 'if if then')
    if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
      return false;
    }

    // Find end of logical line (following ¬ continuations)
    const lineEnd = findLogicalLineEnd(source, position + keyword.length, excludedRegions, this.helperCallbacks);

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
      const flexMatch = matchCompoundKeyword(source, i, keyword);
      if (flexMatch < 0) continue;

      // Check word boundary at end
      if (flexMatch < source.length && /\w/.test(source[flexMatch])) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // Reject compound block closers not at physical line start (covers mid-line
      // occurrences of `end tell`, `end if`, etc. inside expressions). Continuation
      // lines from a previous physical line are still allowed.
      if (type === 'block_close') {
        if (!this.isAtPhysicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Check if compound close keyword is used as a variable name
      if (type === 'block_close' && isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions, this.helperCallbacks)) {
        return { nextPos: flexMatch };
      }

      // Check if compound middle keyword is used as a variable name
      if (type === 'block_middle' && isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions, this.helperCallbacks)) {
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
        const ls = findLogicalLineStart(source, i, excludedRegions, this.helperCallbacks);
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
        const ls = findLogicalLineStart(source, i, excludedRegions, this.helperCallbacks);
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

      // 'to', 'on', 'script', 'considering', 'ignoring', and 'try' are only block
      // openers at logical line start. 'tell'/'if'/'repeat' are allowed mid-line
      // only within condition contexts (e.g., 'if tell then' or 'repeat while ...').
      if (
        type === 'block_open' &&
        (keyword === 'to' || keyword === 'on' || keyword === 'script' || keyword === 'considering' || keyword === 'ignoring' || keyword === 'try')
      ) {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // 'tell', 'if', 'repeat' may appear mid-line in condition contexts (after 'if',
      // 'repeat while'/'until'), but must be rejected when preceded by an expression
      // terminator like ')', ']', '}' on the same logical line (e.g., 'doStuff() tell')
      // which would otherwise consume outer blocks' 'end'.
      if (type === 'block_open' && (keyword === 'tell' || keyword === 'if' || keyword === 'repeat')) {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          if (this.isPrecededByExpressionTerminator(source, i, excludedRegions)) {
            return { nextPos: endPos };
          }
        }
      }

      // Validate block open keywords (e.g., single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, i, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if block opener is used as a variable/property name or in expression context
      if (type === 'block_open' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
        return { nextPos: endPos };
      }

      // Bare 'end' is only a block close at physical line start (allowing
      // continuation from a previous line via ¬)
      if (type === 'block_close' && keyword === 'end') {
        if (!this.isAtPhysicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // Check if 'end' is used as a variable/property name
      if (type === 'block_close' && keyword === 'end' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
        return { nextPos: endPos };
      }

      // Check if middle keyword is used as a variable/property name
      if (type === 'block_middle' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
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

  // Checks if a keyword is at the start of a physical line (only whitespace
  // before it on the same physical line, skipping excluded regions). Unlike
  // isAtLogicalLineStart, continuation from a previous line via ¬ is allowed.
  private isAtPhysicalLineStart(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
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

  // Checks if a keyword is at the start of a logical line (allowing block comments before)
  // Checks if the keyword at pos is preceded by an expression terminator (), ], }, or
  // a word character immediately adjacent (mid-line after an expression). Used to reject
  // tell/if/repeat appearing mid-line after a non-keyword expression (e.g., 'doStuff() tell').
  private isPrecededByExpressionTerminator(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = pos - 1;
    // Skip whitespace and excluded regions (e.g., comments between expression and keyword)
    while (i >= 0) {
      if (source[i] === ' ' || source[i] === '\t') {
        i--;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    const ch = source[i];
    // Expression terminators: closing brackets/parens/braces
    if (ch === ')' || ch === ']' || ch === '}') return true;
    // String/literal value terminator: any alphanumeric/underscore that is not part of a
    // known control keyword. We conservatively accept if preceding char is any word character
    // and look back for the preceding token (simple heuristic: if it's a control keyword,
    // allow; otherwise reject as mid-line after expression).
    if (/[a-zA-Z0-9_]/.test(ch)) {
      // Extract the preceding word token
      const wordEnd = i + 1;
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.slice(wordStart, wordEnd).toLowerCase();
      // Control keywords and intermediates that legitimately precede tell/if/repeat mid-line
      // (e.g., 'if tell', 'else tell', 'repeat while tell')
      const allowedPrecedingKeywords = new Set([
        'if',
        'else',
        'repeat',
        'while',
        'until',
        'when',
        'then',
        'and',
        'or',
        'not',
        'is',
        'of',
        'in',
        'to',
        'from',
        'by',
        'as',
        'with',
        'without',
        'where',
        'considering',
        'ignoring',
        'tell',
        'try',
        'on',
        'given',
        'returning'
      ]);
      if (allowedPrecedingKeywords.has(word)) {
        return false;
      }
      return true;
    }
    return false;
  }

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
          // 'else' and 'else if' are only valid as intermediates of an 'if' block;
          // ignore them in other contexts (e.g. 'else if' inside a 'try' block is a
          // syntax error and must not attach to the enclosing block).
          if (token.value === 'else' || token.value === 'else if') {
            if (stack.length > 0 && stack[stack.length - 1].token.value === 'if') {
              stack[stack.length - 1].intermediates.push(token);
            }
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
  private isTellToOneLiner(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineEnd = findLogicalLineEnd(source, position + 4, excludedRegions, this.helperCallbacks);

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
}
