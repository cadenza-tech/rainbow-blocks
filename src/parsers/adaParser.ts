// Ada block parser: procedure, function, if, loop, case with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import {
  isAdaWordAt,
  isOrElseShortCircuit,
  matchAdaString,
  matchCharacterLiteral,
  scanForwardToIs,
  skipAdaWhitespaceAndComments
} from './adaHelpers';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType, findLastOpenerForLoop, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = ['if', 'loop', 'case', 'select', 'record', 'procedure', 'function', 'package', 'task', 'protected', 'accept'];

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Keywords after 'is' that indicate a non-body declaration
const IS_NON_BODY_KEYWORDS = ['abstract', 'separate', 'new', 'null'];

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

  // Validates if 'loop' keyword is a valid block opener
  // 'loop' is invalid if preceded by 'for' or 'while' on the same logical statement
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();

    if (lowerKeyword === 'entry') {
      return scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions)) >= 0;
    }

    if (lowerKeyword === 'task') {
      return this.isValidTaskOpen(source, position, keyword, excludedRegions);
    }

    if (lowerKeyword === 'package') {
      return this.isValidPackageOpen(source, position, keyword, excludedRegions);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return this.isValidSubprogramOpen(source, position, keyword, excludedRegions);
    }

    if (lowerKeyword === 'accept') {
      return this.isValidAcceptOpen(source, position, keyword, excludedRegions);
    }

    if (lowerKeyword === 'record') {
      return this.isValidRecordOpen(source, position, excludedRegions);
    }

    if (lowerKeyword === 'protected') {
      return this.isValidProtectedOpen(source, position, keyword, excludedRegions);
    }

    if (lowerKeyword === 'if' || lowerKeyword === 'case') {
      return !this.isInsideParens(source, position, excludedRegions);
    }

    if (lowerKeyword === 'for') {
      return this.isValidForOpen(source, position, excludedRegions);
    }

    if (lowerKeyword === 'loop') {
      return this.isValidLoopOpen(source, position, excludedRegions);
    }

    return true;
  }

  // Validates 'task': forward declarations (task Name;) are not blocks
  private isValidTaskOpen(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions));
    if (isPos < 0) return false;
    const k = skipAdaWhitespaceAndComments(source, isPos + 2);
    if (isAdaWordAt(source, k, 'separate')) return false;
    return true;
  }

  // Validates 'package': renames and instantiations (is new) are not blocks
  private isValidPackageOpen(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions), ['renames']);
    if (isPos < 0) return false;
    const k = skipAdaWhitespaceAndComments(source, isPos + 2);
    if (isAdaWordAt(source, k, 'new')) return false;
    if (isAdaWordAt(source, k, 'separate')) return false;
    return true;
  }

  // Validates 'function'/'procedure': access types and declarations are not blocks
  private isValidSubprogramOpen(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    // Check for 'access' keyword before, skipping whitespace and comments
    let scanPos = position - 1;
    while (scanPos >= 0) {
      const ch = source[scanPos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        scanPos--;
        continue;
      }
      if (this.isInExcludedRegion(scanPos, excludedRegions)) {
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
    const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions));
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
  private isValidAcceptOpen(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    let j = position + keyword.length;
    let parenDepth = 0;
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
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
  private isValidRecordOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Scan backward from record, skipping whitespace and excluded regions, to find null
    let j = position - 1;
    while (j >= 0) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
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
        if (!this.isInExcludedRegion(j - 3, excludedRegions)) {
          return false;
        }
      }
    }
    return true;
  }

  // Validates 'protected': access types and forward declarations are not blocks
  private isValidProtectedOpen(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    const textBefore = source.slice(0, position);
    const accessMatch = textBefore.match(/\b(access)([ \t]+(all|constant))?[ \t]*$/i);
    if (accessMatch) {
      const accessPos = position - accessMatch[0].length + accessMatch[0].indexOf(accessMatch[1]);
      if (!this.isInExcludedRegion(accessPos, excludedRegions)) {
        return false;
      }
    }
    // Scan forward: if ';' comes before 'is', it's a forward declaration
    const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions));
    if (isPos < 0) return false;
    const k = skipAdaWhitespaceAndComments(source, isPos + 2);
    if (isAdaWordAt(source, k, 'separate')) return false;
    return true;
  }

  // Validates 'for': representation clauses and quantified expressions are not blocks
  private isValidForOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Ada 2022 quantified expressions: (for all I in S => I > 0) inside parens
    if (this.isInsideParens(source, position, excludedRegions)) {
      return false;
    }
    const afterFor = source.slice(position + 3);
    // for X'Attribute use ... (attribute representation clause)
    // Also handles dotted names like Pkg.Type'Size
    if (/^[ \t]+[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*[ \t]*'/.test(afterFor)) {
      return false;
    }
    // for T use record ... end record; or for Color use (...);
    if (/^[ \t]+[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*[ \t]+use\b/i.test(afterFor)) {
      return false;
    }
    return true;
  }

  // Validates 'loop': checks for preceding for/while prefix keywords
  private isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
          if (!this.isInExcludedRegion(absolutePos, excludedRegions)) {
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
            if (!this.isInExcludedRegion(absolutePos, excludedRegions)) {
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
            if (!this.isInExcludedRegion(loopAbsPos, excludedRegions)) {
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
          if (lineText[ci] === ';' && !this.isInExcludedRegion(lineStartOffset + ci, excludedRegions)) {
            return true;
          }
        }
      }
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

  // Checks if 'if' is directly preceded by '(' (Ada 2012 conditional expression)
  // Checks if position is inside parentheses using proper nesting tracking
  // Ada 2012 conditional/case expressions can appear inside any parentheses,
  // including function call arguments: F(X, if A > 0 then B else C)
  private isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let crossedNewline = false;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
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
          if (crossedNewline && this.hasUnterminatedStringAfterParen(source, i, excludedRegions)) {
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
  private hasUnterminatedStringAfterParen(source: string, parenPos: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = parenPos + 1;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j < source.length && source[j] === '"') {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        // Terminated string ends with closing quote and has at least 2 chars
        const isTerminated = region.end > region.start + 1 && source[region.end - 1] === '"';
        return !isTerminated;
      }
    }
    return false;
  }
}
