// Lua block parser: handles repeat-until, long strings [[ ]], and multi-line comments --[[ ]]

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class LuaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'while', 'for', 'repeat', 'function', 'do'],
    blockClose: ['end', 'until'],
    blockMiddle: ['then', 'else', 'elseif']
  };

  // Validates block open keywords, excluding do that's part of while/for loop
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (keyword !== 'do') {
      return true;
    }

    return !this.isDoPartOfLoop(source, position, excludedRegions);
  }

  // Checks if do at position is part of a while/for loop (not standalone)
  private isDoPartOfLoop(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Find line start
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') {
      lineStart--;
    }

    // Check for while or for on same line
    const beforeDo = source.slice(lineStart, position);
    const pattern = /\b(while|for)\b/g;
    const matches = beforeDo.matchAll(pattern);

    for (const match of matches) {
      const absolutePos = lineStart + match.index;
      if (!this.isInExcludedRegion(absolutePos, excludedRegions)) {
        return true;
      }
    }

    return false;
  }

  // Finds excluded regions: comments, long strings, quoted strings
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

    // Comment (-- single line or --[[ multi-line)
    if (char === '-' && source[pos + 1] === '-') {
      return this.matchComment(source, pos);
    }

    // Long string [[ ]] or [=[ ]=]
    if (char === '[') {
      const region = this.matchLongString(source, pos);
      if (region) return region;
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchQuotedString(source, pos, "'");
    }

    return null;
  }

  // Matches comment (single-line -- or multi-line --[[ ]])
  private matchComment(source: string, pos: number): ExcludedRegion {
    // Check for multi-line comment --[[ or --[=[ etc
    if (source[pos + 2] === '[') {
      const longStringRegion = this.matchLongString(source, pos + 2);
      if (longStringRegion) {
        return { start: pos, end: longStringRegion.end };
      }
    }

    // Single-line comment
    return this.matchSingleLineComment(source, pos);
  }

  // Matches long string [[ ]] or [=[ ]=] with varying equal signs
  private matchLongString(source: string, pos: number): ExcludedRegion | null {
    if (source[pos] !== '[') {
      return null;
    }

    // Count equal signs
    let equalCount = 0;
    let i = pos + 1;
    while (i < source.length && source[i] === '=') {
      equalCount++;
      i++;
    }

    // Check for opening bracket
    if (source[i] !== '[') {
      return null;
    }

    // Build closing pattern
    const closePattern = `]${'='.repeat(equalCount)}]`;

    // Find closing pattern
    i++;
    while (i < source.length) {
      if (source.slice(i, i + closePattern.length) === closePattern) {
        return { start: pos, end: i + closePattern.length };
      }
      i++;
    }

    // Unterminated long string
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
