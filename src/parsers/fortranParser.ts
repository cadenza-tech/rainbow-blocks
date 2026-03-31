// Fortran block parser: program, subroutine, function, if, do with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  collapseContinuationLines,
  findLineEnd,
  isAfterDoubleColon,
  isBlockWhereOrForall,
  isPrecedingContinuationKeyword,
  isTypeSpecifier,
  matchElseWhere,
  matchFortranString
} from './fortranHelpers';
import { isAtLineStartAllowingWhitespace, isInsideParentheses, isValidFortranBlockClose, isValidProcedureOpen } from './fortranValidation';
import { findLastOpenerByType, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';

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
// Also handles comment-only lines and bare continuation-only lines between end & and keyword
const CONTINUATION_COMPOUND_END_PATTERN = new RegExp(
  `\\bend[ \\t]*&[ \\t]*(?:![^\\r\\n]*)?(?:\\r\\n|\\r|\\n)(?:[ \\t]*(?:![^\\r\\n]*|&[ \\t]*(?:![^\\r\\n]*)?)(?:\\r\\n|\\r|\\n))*[ \\t]*&?[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`,
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
      return isValidProcedureOpen(keyword, source, position, excludedRegions, (pos, regions) => this.isInExcludedRegion(pos, regions));
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
    if (/^[ \t]+is[ \t]*\(/i.test(afterKeyword)) {
      return false;
    }
    // type(name) as type specifier: type(identifier) followed by :: or ,
    // Use collapsed text to handle continuation lines between type and (
    if (/^[ \t]*\(/i.test(afterKeyword)) {
      if (isTypeSpecifier(afterKeyword, 0)) {
        return false;
      }
      // Check for constructor call: type(name)(args) - not a block opener
      let depth = 0;
      let j = 0;
      while (j < afterKeyword.length) {
        if (afterKeyword[j] === '(') depth++;
        else if (afterKeyword[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth === 0 && j < afterKeyword.length) {
        let k = j + 1;
        while (k < afterKeyword.length && (afterKeyword[k] === ' ' || afterKeyword[k] === '\t')) k++;
        if (k < afterKeyword.length && afterKeyword[k] === '(') {
          return false;
        }
      }
    }
    return true;
  }

  // Validates 'if': checks for 'then' keyword handling & continuation lines
  private isValidIfOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position + keyword.length;
    let parenDepth = 0;
    while (i < source.length) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      // Track parenthesis depth
      if (source[i] === '(') {
        parenDepth++;
        i++;
        continue;
      }
      if (source[i] === ')') {
        parenDepth--;
        i++;
        continue;
      }

      // Check for 'then' keyword only at top-level (not inside parentheses)
      // 'then' must directly follow ')' (with only whitespace/comments between) to be a block if
      // If other content exists between ')' and 'then', it's a single-line if with 'then' as variable
      if (
        parenDepth === 0 &&
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1])) &&
        (i + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 4]))
      ) {
        // Verify no executable content between closing ')' and 'then'
        let hasContentBeforeThen = false;
        for (let bi = i - 1; bi >= position + keyword.length; bi--) {
          const btRegion = this.findExcludedRegionAt(bi, excludedRegions);
          if (btRegion) {
            bi = btRegion.start;
            continue;
          }
          if (source[bi] === ' ' || source[bi] === '\t' || source[bi] === '&') continue;
          if (source[bi] === ')') break;
          if (source[bi] === '\n' || source[bi] === '\r') continue;
          hasContentBeforeThen = true;
          break;
        }
        if (hasContentBeforeThen) {
          i += 4;
          continue;
        }
        // Verify 'then' is at end-of-line (only whitespace, comments, or & follow)
        // If other content follows, 'then' is a variable name, not a block keyword
        let k = i + 4;
        let isBlockThen = true;
        while (k < source.length) {
          const thenRegion = this.findExcludedRegionAt(k, excludedRegions);
          if (thenRegion) {
            k = thenRegion.end;
            continue;
          }
          if (source[k] === ' ' || source[k] === '\t') {
            k++;
            continue;
          }
          if (source[k] === '\n' || source[k] === '\r' || source[k] === '&') break;
          isBlockThen = false;
          break;
        }
        if (isBlockThen) return true;
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

  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return isValidFortranBlockClose(keyword, source, position);
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // C preprocessor directive: # at line start (after optional whitespace)
    if (char === '#' && isAtLineStartAllowingWhitespace(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    // Fixed-form comment: * in column 1, or C/c in column 1 followed by non-identifier char
    if (char === '*' && this.isAtLineStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }
    // Fixed-form: C/c in column 1 is a comment only when followed by non-alphanumeric
    // (space, tab, or line end). When followed by an alphanumeric character, treat as
    // free-form code (keyword or identifier) to support modern Fortran identifiers like
    // count, compute, current, etc.
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

      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

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

      // Skip block_middle keywords inside parenthesized expressions (conditions, function arguments)
      if (type === 'block_middle' && isInsideParentheses(source, startOffset)) {
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
            const isSameLine = /^[ \t]+$/.test(textBetween);
            // Continuation line: else &[optional comment]\n[optional comment lines][optional &] if/where
            const isContinuation =
              /^[ \t]*&[ \t]*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:[ \t]*(?:![^\r\n]*|&[ \t]*(?:![^\r\n]*)?)(?:\r\n|\r|\n))*[ \t]*&?[ \t]*$/.test(
                textBetween
              );
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

    const { tokens: result, processedPositions: processedCompoundPositions } = mergeCompoundEndTokens(mergedTokens, compoundEndPositions);

    // Add concatenated compound end keywords (e.g., enddo, endif) that had no
    // matching 'end' token because \b word boundary doesn't match inside them
    for (const [pos, compound] of compoundEndPositions) {
      if (!processedCompoundPositions.has(pos)) {
        // Validate concatenated compound end keywords (reject variable assignments like enddo = 10)
        if (!isValidFortranBlockClose(compound.keyword, source, pos)) {
          continue;
        }
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
              // If opener is 'if', accept just the 'else' part as intermediate
              if (openerValue === 'if') {
                topBlock.intermediates.push({
                  type: 'block_middle',
                  value: token.value.slice(0, 4),
                  startOffset: token.startOffset,
                  endOffset: token.startOffset + 4,
                  line: token.line,
                  column: token.column
                });
              }
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
          const compoundMatch = closeValue.match(/^end[ \t]*(.+)/);
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
