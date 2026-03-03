// Fortran block parser: program, subroutine, function, if, do with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  collapseContinuationLines,
  findInlineCommentIndex,
  findLineEnd,
  isAfterDoubleColon,
  isBlockWhereOrForall,
  isPrecedingContinuationKeyword,
  isTypeSpecifier,
  matchElseWhere,
  matchFortranString
} from './fortranHelpers';
import { findLastOpenerByType, findLineStart, getTokenTypeCaseInsensitive } from './parserUtils';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = [
  'program',
  'subroutine',
  'function',
  'module',
  'submodule',
  'if',
  'do',
  'select',
  'block',
  'associate',
  'critical',
  'forall',
  'where',
  'interface',
  'type',
  'enum',
  'procedure'
];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

// Pattern to match compound end keywords with continuation line: end &\n[&]keyword
// Also handles comment-only lines between end & and keyword
const CONTINUATION_COMPOUND_END_PATTERN = new RegExp(
  `\\bend[ \\t]*&[ \\t]*(?:![^\\r\\n]*)?(?:\\r\\n|\\r|\\n)(?:[ \\t]*![^\\r\\n]*(?:\\r\\n|\\r|\\n))*[ \\t]*&?[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`,
  'gi'
);

export class FortranBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'program',
      'subroutine',
      'function',
      'module',
      'submodule',
      'procedure',
      'if',
      'do',
      'select',
      'block',
      'associate',
      'critical',
      'forall',
      'where',
      'interface',
      'type',
      'enum'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'elsewhere', 'case', 'then', 'contains']
  };

  // Finds excluded regions: comments and strings

  // Validates block open keywords
  // Single-line 'if' (without 'then') is not a block opener
  // 'if' preceded by 'else' on the same line is part of 'else if', not a new block
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();

    if (lowerKeyword === 'type') {
      return this.isValidTypeOpen(keyword, source, position, excludedRegions);
    }

    // 'select' must be followed by 'type' or 'case' to be a block opener
    // Handles line continuation with &, including comment-only lines between
    if (lowerKeyword === 'select') {
      let afterSelect = source.slice(position + keyword.length);
      afterSelect = collapseContinuationLines(afterSelect);
      if (!/^[ \t]+(type|case|rank)\b/i.test(afterSelect)) {
        return false;
      }
    }

    // 'module procedure' inside submodule is not a new module block
    if (lowerKeyword === 'module') {
      let afterModule = source.slice(position + keyword.length);
      afterModule = collapseContinuationLines(afterModule);
      if (/^[ \t]+procedure\b/i.test(afterModule)) {
        return false;
      }
    }

    if (lowerKeyword === 'procedure') {
      return this.isValidProcedureOpen(keyword, source, position, excludedRegions);
    }

    // Single-line where/forall: has (condition) followed by statement on same line
    if (lowerKeyword === 'where' || lowerKeyword === 'forall') {
      return isBlockWhereOrForall(source, position, keyword);
    }

    if (lowerKeyword === 'if') {
      return this.isValidIfOpen(keyword, source, position, excludedRegions);
    }

    return true;
  }

  // Validates 'type': rejects select type guards, type specifiers, continuation patterns
  private isValidTypeOpen(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    const typeLineStart = findLineStart(source, position);
    const lineBeforeType = source.slice(typeLineStart, position).toLowerCase().trimEnd();
    if (lineBeforeType.endsWith('select')) {
      return false;
    }
    // Check continuation: select &\n  type
    if (isPrecedingContinuationKeyword(source, position, 'select')) {
      return false;
    }
    // 'type is(...)' or 'type is (...)' is a guard in select type, not a block
    // Also handles continuation: type &\n  is (integer)
    let afterKeyword = source.slice(position + keyword.length);
    afterKeyword = collapseContinuationLines(afterKeyword);
    if (/^[ \t]+is\s*\(/i.test(afterKeyword)) {
      return false;
    }
    // type(name) as type specifier: type(identifier) followed by :: or ,
    // Use collapsed text to handle continuation lines between type and (
    if (/^\s*\(/i.test(afterKeyword)) {
      if (isTypeSpecifier(afterKeyword, 0)) {
        return false;
      }
    }
    return true;
  }

  // Validates 'procedure': rejects type-bound procedure declarations (with ::)
  private isValidProcedureOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
        if (!this.isInExcludedRegion(j + colonIdx, excludedRegions)) {
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

  // Validates 'if': checks for 'then' keyword handling & continuation lines
  private isValidIfOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position + keyword.length;
    while (i < source.length) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      // Check for 'then' keyword
      if (
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1])) &&
        (i + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 4]))
      ) {
        return true;
      }

      // Handle line continuation with &
      // Detect line break: \n or standalone \r (not followed by \n)
      const isLineBreak = source[i] === '\n' || (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n'));
      if (isLineBreak) {
        let j = i - 1;
        // Skip whitespace and excluded regions (comments between & and newline)
        while (j >= 0) {
          const backRegion = this.findExcludedRegionAt(j, excludedRegions);
          if (backRegion) {
            j = backRegion.start - 1;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r') {
            j--;
            continue;
          }
          break;
        }
        if (j >= 0 && source[j] === '&') {
          i++;
          // Skip comment-only continuation lines (& ! comment \n)
          while (i < source.length) {
            // Skip whitespace at start of next line
            while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
              i++;
            }
            // Skip leading & on continuation line (Fortran free-form)
            if (i < source.length && source[i] === '&') {
              i++;
            }
            // If line starts with !, it's a comment-only continuation
            if (i < source.length && source[i] === '!') {
              const commentEnd = findLineEnd(source, i);
              i = commentEnd;
              // Skip past the line break
              if (i < source.length) {
                if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
                  i += 2;
                } else {
                  i++;
                }
              }
              continue;
            }
            break;
          }
          continue;
        }
        break;
      }

      i++;
    }

    return false;
  }

  // Validates block close keywords
  // Rejects 'end' used as variable name (followed by = but not ==)
  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
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
      // Skip comment-only lines between end & and continuation content
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
        break;
      }
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
      let j = i;
      // Skip consecutive parenthesized groups: end(1)(2)(3)
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
      // Handle & continuation after paren: end(1) &\n  = value
      if (j < source.length && source[j] === '&') {
        j++;
        while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
          j++;
        }
        if (j < source.length && source[j] === '\r') j++;
        if (j < source.length && source[j] === '\n') j++;
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

  // Checks if position is at line start allowing leading whitespace (for # preprocessor)
  private isAtLineStartAllowingWhitespace(source: string, pos: number): boolean {
    if (pos === 0) return true;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // C preprocessor directive: # at line start (after optional whitespace)
    if (char === '#' && this.isAtLineStartAllowingWhitespace(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    // Fixed-form comment: * in column 1, or C/c in column 1 followed by non-identifier char
    if (char === '*' && this.isAtLineStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }
    // Fixed-form: C/c in column 1 is a comment only if followed by non-alphanumeric
    // In free-form code, identifiers like call, character, count start with c/C
    if ((char === 'C' || char === 'c') && this.isAtLineStart(source, pos)) {
      const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
      if (!/[a-zA-Z0-9_]/.test(nextChar)) {
        return this.matchSingleLineComment(source, pos);
      }
    }

    // Single-line comment: ! (Fortran 90+)
    if (char === '!') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return matchFortranString(source, pos, "'");
    }

    // Double-quoted string
    if (char === '"') {
      return matchFortranString(source, pos, '"');
    }

    return null;
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();

    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      if (!this.isInExcludedRegion(pos, excludedRegions) && !isAfterDoubleColon(source, pos, excludedRegions)) {
        const fullMatch = match[0];
        const endType = match[1].toLowerCase();
        compoundEndPositions.set(pos, {
          keyword: fullMatch, // Preserve original case
          length: fullMatch.length,
          endType
        });
      }
      match = COMPOUND_END_PATTERN.exec(source);
    }

    // Also detect compound end with continuation line: end &\n[&]keyword
    CONTINUATION_COMPOUND_END_PATTERN.lastIndex = 0;
    let contMatch = CONTINUATION_COMPOUND_END_PATTERN.exec(source);
    while (contMatch !== null) {
      const pos = contMatch.index;
      if (!this.isInExcludedRegion(pos, excludedRegions) && !isAfterDoubleColon(source, pos, excludedRegions) && !compoundEndPositions.has(pos)) {
        const fullMatch = contMatch[0];
        const endType = contMatch[1].toLowerCase();
        // Normalize keyword to "end <type>" for consistent matching in matchBlocks
        compoundEndPositions.set(pos, {
          keyword: `end ${contMatch[1]}`,
          length: fullMatch.length,
          endType
        });
      }
      contMatch = CONTINUATION_COMPOUND_END_PATTERN.exec(source);
    }

    // Tokenize with case-insensitive matching
    const tokens: Token[] = [];
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    // Use 'gi' flag for case-insensitive global matching
    const keywordPattern = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');
    const newlinePositions = this.buildNewlinePositions(source);

    for (const keywordMatch of source.matchAll(keywordPattern)) {
      const startOffset = keywordMatch.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = keywordMatch[1];
      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      // Skip keywords on variable declaration lines (after ::)
      if (isAfterDoubleColon(source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block open keywords (e.g., skip single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block close keywords (e.g., skip end used as variable)
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset: startOffset + keyword.length,
        line,
        column
      });
    }

    // Merge 'else' + 'if' into a single blockMiddle token (token-based merge)
    // Also merge 'else' + 'where' by scanning source text (where may be absent
    // from token list when it failed isValidBlockOpen without a condition)
    const mergedTokens: Token[] = [];
    for (let ti = 0; ti < tokens.length; ti++) {
      const current = tokens[ti];
      if (current.value.toLowerCase() === 'else' && current.type === 'block_middle') {
        // Try token-based merge for else + if or else + where (when where is tokenized)
        if (ti + 1 < tokens.length) {
          const nextValue = tokens[ti + 1].value.toLowerCase();
          const isMergeTarget =
            (nextValue === 'if' && tokens[ti + 1].type === 'block_open') || (nextValue === 'where' && tokens[ti + 1].type === 'block_open');
          if (isMergeTarget) {
            const textBetween = source.slice(current.endOffset, tokens[ti + 1].startOffset);
            // Same line: else if / else where
            const isSameLine = /^\s+$/.test(textBetween) && !textBetween.includes('\n') && !textBetween.includes('\r');
            // Continuation line: else &[optional comment]\n[optional comment lines][optional &] if/where
            const isContinuation = /^\s*&\s*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:\s*![^\r\n]*(?:\r\n|\r|\n))*\s*&?\s*$/.test(textBetween);
            if (isSameLine || isContinuation) {
              mergedTokens.push({
                type: 'block_middle',
                value: source.slice(current.startOffset, tokens[ti + 1].endOffset),
                startOffset: current.startOffset,
                endOffset: tokens[ti + 1].endOffset,
                line: current.line,
                column: current.column
              });
              ti++;
              continue;
            }
          }
        }
        // Source-based merge for else + where (when where was not tokenized)
        const elseWhereMatch = matchElseWhere(source, current.endOffset, excludedRegions);
        if (elseWhereMatch) {
          // Check that no other token starts between else and where
          const nextTokenStart = ti + 1 < tokens.length ? tokens[ti + 1].startOffset : source.length;
          if (elseWhereMatch.whereStart >= nextTokenStart) {
            // Another token exists between; don't merge
            mergedTokens.push(current);
            continue;
          }
          mergedTokens.push({
            type: 'block_middle',
            value: source.slice(current.startOffset, elseWhereMatch.end),
            startOffset: current.startOffset,
            endOffset: elseWhereMatch.end,
            line: current.line,
            column: current.column
          });
          continue;
        }
      }
      mergedTokens.push(current);
    }

    // Process tokens to handle compound keywords
    const result: Token[] = [];
    const processedCompoundPositions = new Set<number>();

    for (const token of mergedTokens) {
      // Check if this token is the start of a compound end
      const compound = compoundEndPositions.get(token.startOffset);
      if (compound && token.value.toLowerCase() === 'end') {
        // Replace with compound keyword
        result.push({
          ...token,
          value: compound.keyword,
          endOffset: token.startOffset + compound.length,
          type: 'block_close'
        });
        processedCompoundPositions.add(token.startOffset);
        continue;
      }

      // Check if this token should be skipped (it's the type part of compound end)
      let shouldSkip = false;
      for (const [endPos, comp] of compoundEndPositions) {
        if (token.startOffset > endPos && token.startOffset < endPos + comp.length && token.value.toLowerCase() === comp.endType) {
          shouldSkip = true;
          break;
        }
      }

      if (!shouldSkip) {
        result.push(token);
      }
    }

    // Add concatenated compound end keywords (e.g., enddo, endif) that had no
    // matching 'end' token because \b word boundary doesn't match inside them
    for (const [pos, compound] of compoundEndPositions) {
      if (!processedCompoundPositions.has(pos)) {
        const { line, column } = this.getLineAndColumn(pos, newlinePositions);
        result.push({
          type: 'block_close',
          value: compound.keyword,
          startOffset: pos,
          endOffset: pos + compound.length,
          line,
          column
        });
      }
    }

    // Re-sort by position after adding concatenated forms
    if (compoundEndPositions.size > processedCompoundPositions.size) {
      result.sort((a, b) => a.startOffset - b.startOffset);
    }

    return result;
  }

  // Custom matching to handle compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];
    // Track select blocks that have had their first case skipped
    const firstCaseSkipped = new Set<OpenBlock>();

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topBlock = stack[stack.length - 1];
            const middleValue = token.value.toLowerCase();
            const openerValue = topBlock.token.value.toLowerCase();
            // Skip the first case after select case (it's the opening guard)
            if (middleValue === 'case' && openerValue === 'select' && !firstCaseSkipped.has(topBlock)) {
              firstCaseSkipped.add(topBlock);
              break;
            }
            // Restrict intermediates to correct parent block types
            if (middleValue === 'then' && openerValue !== 'if') {
              break;
            }
            if (middleValue === 'case' && openerValue !== 'select') {
              break;
            }
            // Check if this is an else-where variant (elsewhere, else where, else &\n where)
            // The merged token value may include &, comments (!...), and newlines between else and where
            const isElseWhereVariant = /^else(?:where$|\b[\s\S]*\bwhere$)/i.test(middleValue);
            // elsewhere / else where -> only for where blocks
            if (isElseWhereVariant && openerValue !== 'where') {
              break;
            }
            // else / elseif / else if (but not elsewhere/else where) -> only for if blocks
            if (!isElseWhereVariant && (middleValue === 'elseif' || /^else\b/i.test(middleValue)) && openerValue !== 'if') {
              break;
            }
            if (
              middleValue === 'contains' &&
              !['program', 'module', 'submodule', 'function', 'subroutine', 'procedure', 'type'].includes(openerValue)
            ) {
              break;
            }
            topBlock.intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's a compound end (e.g., "end program", "endprogram")
          const compoundMatch = closeValue.match(/^end\s*(.+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            matchIndex = findLastOpenerByType(stack, endType, true);
          }

          // If no compound match found, only fallback for simple 'end' (not compound end keywords)
          if (matchIndex < 0 && !compoundMatch && stack.length > 0) {
            matchIndex = stack.length - 1;
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
}
