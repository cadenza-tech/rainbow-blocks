// Ada block parser: procedure, function, if, loop, case with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { isOrElseShortCircuit, matchAdaString, matchCharacterLiteral, scanForwardToIs } from './adaHelpers';
import type { AdaValidationCallbacks } from './adaValidation';
import {
  isInsideParens,
  isValidAcceptOpen,
  isValidForOpen,
  isValidLoopOpen,
  isValidPackageOpen,
  isValidProtectedOpen,
  isValidRecordOpen,
  isValidSubprogramOpen,
  isValidTaskOpen
} from './adaValidation';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType, findLastOpenerForLoop, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = ['if', 'loop', 'case', 'select', 'record', 'procedure', 'function', 'package', 'task', 'protected', 'accept'];

// Keywords that can precede 'begin' and are closed together with it
const BEGIN_CONTEXT_KEYWORDS = ['declare', 'procedure', 'function', 'task', 'protected', 'package', 'entry'];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]+(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

export class AdaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'if',
      'loop',
      'for',
      'while',
      'case',
      'select',
      'record',
      'declare',
      'begin',
      'procedure',
      'function',
      'package',
      'task',
      'protected',
      'accept',
      'entry'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'exception', 'or', 'is']
  };

  private get validationCallbacks(): AdaValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Validates if keyword is a valid block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const cb = this.validationCallbacks;

    if (lowerKeyword === 'entry') {
      return scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions)) >= 0;
    }

    if (lowerKeyword === 'task') {
      return isValidTaskOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'package') {
      return isValidPackageOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return isValidSubprogramOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'accept') {
      return isValidAcceptOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'record') {
      return isValidRecordOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'protected') {
      return isValidProtectedOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'if' || lowerKeyword === 'case') {
      return !isInsideParens(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'for') {
      return isValidForOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'loop') {
      return isValidLoopOpen(source, position, excludedRegions, cb);
    }

    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchAdaString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return matchCharacterLiteral(source, pos);
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
      if (!this.isInExcludedRegion(pos, excludedRegions)) {
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

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip 'is' in type/subtype declarations (type T is ... / subtype S is ...)
      // Also handles multi-line: type T\n  is range 1..100;
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = findLineStart(source, startOffset);
        const lineBefore = source.slice(lineStart, startOffset).toLowerCase().trimStart();
        if (/^(type|subtype)\b/.test(lineBefore)) {
          // Only skip if no ';' between type/subtype and this 'is' on the same line
          let hasSemicolon = false;
          for (let si = lineStart; si < startOffset; si++) {
            if (source[si] === ';' && !this.isInExcludedRegion(si, excludedRegions)) {
              hasSemicolon = true;
              break;
            }
          }
          if (!hasSemicolon) {
            continue;
          }
        }
        // Check previous lines if current line has only whitespace before 'is'
        if (lineBefore.length === 0) {
          let scanPos = lineStart - 1;
          // Skip line terminator (\n, \r\n, or \r)
          if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
          if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          let isTypeDecl = false;
          let typeDeclStart = -1;
          while (scanPos >= 0) {
            const prevStart = findLineStart(source, scanPos);
            const prevLine = source
              .slice(prevStart, scanPos + 1)
              .toLowerCase()
              .trimStart();
            if (prevLine.length > 0) {
              // Skip comment lines (starting with --)
              if (/^--/.test(prevLine)) {
                scanPos = prevStart - 1;
                if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
                if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
                continue;
              }
              if (/^(type|subtype)\b/.test(prevLine)) {
                isTypeDecl = true;
                typeDeclStart = prevStart;
              }
              break;
            }
            // Move past line terminator to previous line
            scanPos = prevStart - 1;
            if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
            if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          }
          // Only skip if no ';' between type/subtype and this 'is'
          if (isTypeDecl) {
            let hasSemicolon = false;
            for (let si = typeDeclStart; si < startOffset; si++) {
              if (source[si] === ';' && !this.isInExcludedRegion(si, excludedRegions)) {
                hasSemicolon = true;
                break;
              }
            }
            if (!hasSemicolon) {
              continue;
            }
          }
        }
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

    const { tokens: result } = mergeCompoundEndTokens(tokens, compoundEndPositions);

    // Filter out 'or else' and 'and then' short-circuit operators
    const filtered: Token[] = [];
    for (let i = 0; i < result.length; i++) {
      const token = result[i];
      const lowerValue = token.value.toLowerCase();

      // 'or else' short-circuit: remove both 'or' and 'else' tokens
      // In a select block, 'or' and 'else' can be separate intermediates with statements between them.
      // To distinguish: check if only whitespace/comments exist between 'or' and 'else' in source.
      if (lowerValue === 'else' && filtered.length > 0 && filtered[filtered.length - 1].value.toLowerCase() === 'or') {
        const orToken = filtered[filtered.length - 1];
        if (isOrElseShortCircuit(source, orToken.endOffset, token.startOffset, (pos) => this.isInExcludedRegion(pos, excludedRegions))) {
          filtered.pop();
          continue;
        }
      }

      // 'and then' short-circuit: 'and' is not a keyword, so scan backward from 'then'
      // skipping whitespace and excluded regions (comments between 'and' and 'then')
      if (lowerValue === 'then') {
        let j = token.startOffset - 1;
        // Skip whitespace, newlines, and excluded regions backward
        while (j >= 0) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            const region = this.findExcludedRegionAt(j, excludedRegions);
            if (region) {
              j = region.start - 1;
            } else {
              j--;
            }
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            j--;
            continue;
          }
          break;
        }
        // Check if the word ending at j is 'and'
        if (j >= 2 && source.slice(j - 2, j + 1).toLowerCase() === 'and') {
          const beforeAnd = j - 3;
          if (beforeAnd < 0 || !/[a-zA-Z0-9_]/.test(source[beforeAnd])) {
            if (!this.isInExcludedRegion(j - 2, excludedRegions)) {
              continue;
            }
          }
        }
      }

      filtered.push(token);
    }

    return filtered;
  }

  // Custom matching to handle compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            const middleKw = token.value.toLowerCase();
            // 'or' is only a valid intermediate for 'select' blocks
            if (middleKw === 'or') {
              if (topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'when') {
              // 'when' is valid for 'case', 'select', 'begin' (exception), 'entry' (guard), and 'accept' (guard)
              if (topOpener === 'case' || topOpener === 'select' || topOpener === 'begin' || topOpener === 'entry' || topOpener === 'accept') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'then') {
              // 'then' is valid for 'if' and 'select' (select...then abort)
              if (topOpener === 'if' || topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();

          // Check if it's a compound end
          const compoundMatch = closeValue.match(/^end[ \t]+(\S+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            let matchIndex = -1;

            // Special case: 'end loop' can close 'for', 'while', or 'loop'
            if (endType === 'loop') {
              matchIndex = findLastOpenerForLoop(stack);
            } else {
              matchIndex = findLastOpenerByType(stack, endType, true);
            }

            // If no compound match found, try simple end
            if (matchIndex < 0 && stack.length > 0) {
              matchIndex = stack.length - 1;
            }

            if (matchIndex >= 0) {
              // Check if 'begin' is on the stack above the matched opener
              const beginIndex = matchIndex + 1;
              if (beginIndex < stack.length && stack[beginIndex].token.value.toLowerCase() === 'begin') {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(matchIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                const openBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          } else {
            // Simple 'end' or 'end;' - always closes the top of the stack
            if (stack.length === 0) break;

            const top = stack[stack.length - 1];
            const topValue = top.token.value.toLowerCase();

            if (topValue === 'begin') {
              // Check for context keyword immediately before begin
              const beginIndex = stack.length - 1;
              const contextIndex = beginIndex - 1;

              if (contextIndex >= 0 && BEGIN_CONTEXT_KEYWORDS.includes(stack[contextIndex].token.value.toLowerCase())) {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(contextIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(contextIndex, 1)[0];

                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                // No context keyword, just close begin
                const beginBlock = stack.pop();
                if (beginBlock) {
                  pairs.push({
                    openKeyword: beginBlock.token,
                    closeKeyword: token,
                    intermediates: beginBlock.intermediates,
                    nestLevel: stack.length
                  });
                }
              }
            } else {
              // Top is not begin, just close it
              const openBlock = stack.pop();
              if (openBlock) {
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          }
          break;
        }
      }
    }

    return pairs;
  }
}
