// Ada block parser: procedure, function, if, loop, case with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = ['if', 'loop', 'case', 'select', 'record', 'procedure', 'function', 'package', 'task', 'protected', 'accept'];

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Keywords after 'is' that indicate a non-body declaration
const IS_NON_BODY_KEYWORDS = ['abstract', 'separate', 'new', 'null'];

// Keywords that can precede 'begin' and are closed together with it
const BEGIN_CONTEXT_KEYWORDS = ['declare', 'procedure', 'function', 'task', 'protected', 'package', 'entry', 'accept'];

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

    // 'entry' declarations (entry Name; or entry Name(params);) are not blocks
    // Only entry bodies (entry Name ... is begin ... end) are blocks
    if (lowerKeyword === 'entry') {
      let j = position + keyword.length;
      let parenDepth = 0;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === '(') parenDepth++;
        else if (source[j] === ')') parenDepth--;
        else if (parenDepth === 0) {
          if (source[j] === ';') return false;
          if (
            source.slice(j, j + 2).toLowerCase() === 'is' &&
            (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) &&
            (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))
          ) {
            return true;
          }
        }
        j++;
      }
      return false;
    }

    // 'function'/'procedure' after 'access' are access subprogram types, not blocks
    // Declarations without body (ending with ; before is) are not blocks
    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      // Check for 'access' keyword before, ensuring it's not in an excluded region
      const textBefore = source.slice(0, position);
      const accessMatch = textBefore.match(/\b(access)\s*$/i);
      if (accessMatch) {
        const accessPos = position - accessMatch[0].length + accessMatch[0].indexOf(accessMatch[1]);
        if (!this.isInExcludedRegion(accessPos, excludedRegions)) {
          return false;
        }
      }
      // Scan forward: if ';' comes before 'is', it's a declaration, not a body
      let j = position + keyword.length;
      let parenDepth = 0;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === '(') parenDepth++;
        else if (source[j] === ')') parenDepth--;
        else if (parenDepth === 0) {
          if (source[j] === ';') return false;
          if (
            source.slice(j, j + 2).toLowerCase() === 'is' &&
            (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) &&
            (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))
          ) {
            // Check if 'is' is followed by abstract/separate/new/null
            // Skip whitespace including newlines for multi-line cases
            let k = j + 2;
            while (k < source.length && /[ \t\r\n]/.test(source[k])) {
              k++;
            }
            const afterIs = source.slice(k).match(/^([a-zA-Z_]\w*)/);
            if (afterIs && IS_NON_BODY_KEYWORDS.includes(afterIs[1].toLowerCase())) {
              return false;
            }
            break;
          }
        }
        j++;
      }
    }

    if (lowerKeyword !== 'loop') {
      return true;
    }

    // Look backwards to find if 'for' or 'while' precedes this 'loop'
    // Check current line and previous lines for multi-line for/while statements
    const textBefore = source.slice(0, position);
    // Split on \r\n, \r, or \n to handle all line ending types
    const lineParts = textBefore.split(/\r\n|\r|\n/);
    const maxLines = Math.min(lineParts.length, 5);

    // Calculate absolute offset for the start of each line by scanning backward
    // We use findLineStart to correctly handle any line ending type
    let lineStartOffset = textBefore.length;
    for (let idx = 0; idx < maxLines; idx++) {
      const lineIdx = lineParts.length - 1 - idx;
      const lineText = lineParts[lineIdx];
      lineStartOffset -= lineText.length;
      if (idx > 0) {
        // Account for the line terminator (1 for \n or \r, 2 for \r\n)
        // Check what's at lineStartOffset - 1 and lineStartOffset - 2
        if (lineStartOffset >= 2 && source[lineStartOffset - 2] === '\r' && source[lineStartOffset - 1] === '\n') {
          lineStartOffset -= 2;
        } else {
          lineStartOffset -= 1;
        }
      }

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
        // Count non-excluded 'loop' keywords on the same line
        let loopCount = 0;
        for (const loopMatch of lineText.matchAll(/\bloop\b/gi)) {
          const loopAbsPos = lineStartOffset + loopMatch.index;
          if (!this.isInExcludedRegion(loopAbsPos, excludedRegions)) {
            loopCount++;
          }
        }
        // If all for/while are already paired with loops, this loop is standalone
        return loopCount >= prefixCount;
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

  // Finds excluded regions: comments and strings
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchAdaString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return this.matchCharacterLiteral(source, pos);
    }

    return null;
  }

  // Matches Ada string: "..."
  private matchAdaString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        // Check for doubled quote escape ""
        if (i + 1 < source.length && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in Ada
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches character literal: 'x' (single character only)
  // Also handles attribute tick: Type'Attribute (skip the attribute name)
  private matchCharacterLiteral(source: string, pos: number): ExcludedRegion {
    // Character literal is 'x' where x is a single character
    // It could also be an attribute tick, so we need to be careful
    if (pos + 2 < source.length && source[pos + 2] === "'") {
      return { start: pos, end: pos + 3 };
    }
    // Attribute tick: skip the attribute name to avoid matching keywords
    let i = pos + 1;
    while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    return { start: pos, end: i };
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
      const type = this.getTokenTypeCaseInsensitive(keyword);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip 'is' in type/subtype declarations (type T is ... / subtype S is ...)
      // Also handles multi-line: type T\n  is range 1..100;
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = this.findLineStart(source, startOffset);
        const lineBefore = source.slice(lineStart, startOffset).toLowerCase().trimStart();
        if (/^(type|subtype)\b/.test(lineBefore)) {
          continue;
        }
        // Check previous lines if current line has only whitespace before 'is'
        if (lineBefore.length === 0) {
          let scanPos = lineStart - 1;
          // Skip line terminator (\n, \r\n, or \r)
          if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
          if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          let isTypeDecl = false;
          while (scanPos >= 0) {
            const prevStart = this.findLineStart(source, scanPos);
            const prevLine = source
              .slice(prevStart, scanPos + 1)
              .toLowerCase()
              .trimStart();
            if (prevLine.length > 0) {
              if (/^(type|subtype)\b/.test(prevLine)) {
                isTypeDecl = true;
              }
              break;
            }
            // Move past line terminator to previous line
            scanPos = prevStart - 1;
            if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
            if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          }
          if (isTypeDecl) {
            continue;
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

    // Process tokens to handle compound keywords
    const result: Token[] = [];

    for (const token of tokens) {
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

    return result;
  }

  // Returns the token type for a keyword (case-insensitive)
  private getTokenTypeCaseInsensitive(keyword: string): 'block_open' | 'block_close' | 'block_middle' {
    const lowerKeyword = keyword.toLowerCase();
    if (this.keywords.blockClose.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_close';
    }
    if (this.keywords.blockMiddle.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_middle';
    }
    return 'block_open';
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
            // 'or' is only a valid intermediate for 'select' blocks
            if (token.value.toLowerCase() === 'or') {
              if (stack[stack.length - 1].token.value.toLowerCase() === 'select') {
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
          const compoundMatch = closeValue.match(/^end\s+(\S+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            let matchIndex = -1;

            // Special case: 'end loop' can close 'for', 'while', or 'loop'
            if (endType === 'loop') {
              matchIndex = this.findLastOpenerForLoop(stack);
            } else {
              matchIndex = this.findLastOpenerByType(stack, endType);
            }

            // If no compound match found, try simple end
            if (matchIndex < 0 && stack.length > 0) {
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
          } else {
            // Simple 'end' or 'end;' - closes begin and preceding context keyword
            const beginIndex = this.findLastOpenerByType(stack, 'begin');

            if (beginIndex >= 0) {
              // Check for context keyword immediately before begin
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
                const beginBlock = stack.splice(beginIndex, 1)[0];
                pairs.push({
                  openKeyword: beginBlock.token,
                  closeKeyword: token,
                  intermediates: beginBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            } else {
              // No begin found, close the last opener
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

  // Find the last opener that matches the given type
  private findLastOpenerByType(stack: OpenBlock[], endType: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value.toLowerCase() === endType) {
        return i;
      }
    }
    return -1;
  }

  // Finds the start of the line containing the given position
  // Handles \n, \r\n, and \r-only line endings
  private findLineStart(source: string, pos: number): number {
    for (let i = pos - 1; i >= 0; i--) {
      if (source[i] === '\n' || source[i] === '\r') {
        return i + 1;
      }
    }
    return 0;
  }

  // Find the last opener for 'end loop' (can be 'for', 'while', or 'loop')
  private findLastOpenerForLoop(stack: OpenBlock[]): number {
    const validOpeners = ['for', 'while', 'loop'];
    for (let i = stack.length - 1; i >= 0; i--) {
      if (validOpeners.includes(stack[i].token.value.toLowerCase())) {
        return i;
      }
    }
    return -1;
  }
}
