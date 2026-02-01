// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class PascalBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'case', 'repeat', 'try', 'record', 'class', 'object', 'interface'],
    blockClose: ['end', 'until'],
    blockMiddle: ['else', 'except', 'finally', 'of']
  };

  // Finds excluded regions: comments (3 styles), strings
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

    // Single-line comment: // to end of line
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      return this.matchSingleLineComment(source, pos);
    }

    // Brace comment: { }
    if (char === '{') {
      return this.matchBraceComment(source, pos);
    }

    // Paren-star comment: (* *)
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchParenStarComment(source, pos);
    }

    // Single-quoted string with Pascal escaping ('')
    if (char === "'") {
      return this.matchPascalString(source, pos);
    }

    return null;
  }

  // Matches brace comment: { ... }
  private matchBraceComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '}') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches paren-star comment: (* ... *)
  private matchParenStarComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    while (i < source.length) {
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === ')') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Override tokenize to handle case-insensitivity (Pascal is case-insensitive)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];

    // Sort keywords by length descending to match longer keywords first
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    // Add 'i' flag for case-insensitive matching
    const keywordPattern = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');

    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(keywordPattern)) {
      const startOffset = match.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      // Normalize to lowercase for type lookup
      const keyword = match[1].toLowerCase();
      const type = this.getTokenType(keyword);

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

    return tokens;
  }

  // Matches Pascal string with '' escape (not backslash)
  private matchPascalString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === "'") {
        // Check for doubled quote (escape)
        if (i + 1 < source.length && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches blocks with special handling: until only closes repeat, end closes others
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
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          // until only closes repeat
          if (token.value === 'until') {
            const repeatIndex = this.findLastRepeatIndex(stack);
            if (repeatIndex >= 0) {
              const openBlock = stack.splice(repeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          } else {
            // end closes any block except repeat
            const nonRepeatIndex = this.findLastNonRepeatIndex(stack);
            if (nonRepeatIndex >= 0) {
              const openBlock = stack.splice(nonRepeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Finds the index of the last repeat block in the stack
  private findLastRepeatIndex(stack: OpenBlock[]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value === 'repeat') {
        return i;
      }
    }
    return -1;
  }

  // Finds the index of the last non-repeat block in the stack
  private findLastNonRepeatIndex(stack: OpenBlock[]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value !== 'repeat') {
        return i;
      }
    }
    return -1;
  }
}
