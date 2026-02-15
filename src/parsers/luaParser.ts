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
  // Searches backwards from do position, crossing newlines since Lua allows multi-line loop headers
  private isDoPartOfLoop(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Search backwards from the do position for a while/for keyword
    const beforeDo = source.slice(0, position);
    const loopPattern = /\b(while|for)\b/g;
    const loopMatches = [...beforeDo.matchAll(loopPattern)];

    // Check matches in reverse order (closest first)
    for (let m = loopMatches.length - 1; m >= 0; m--) {
      const loopMatch = loopMatches[m];
      const loopAbsolutePos = loopMatch.index;
      if (this.isInExcludedRegion(loopAbsolutePos, excludedRegions)) {
        continue;
      }

      // Find the first 'do' after this loop keyword, skipping excluded regions
      const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
      const searchRange = source.slice(afterLoopStart, position + 2);
      const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

      for (const doMatch of doMatches) {
        const doAbsolutePos = afterLoopStart + doMatch.index;
        // Skip 'do' in excluded regions (strings, comments)
        if (this.isInExcludedRegion(doAbsolutePos, excludedRegions)) {
          continue;
        }
        // This is the first valid 'do' after the loop keyword
        if (doAbsolutePos === position) {
          return true;
        }
        // Found a different valid 'do' before our position - this loop already has a do
        break;
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
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchComment(source, pos);
    }

    // Goto label ::identifier::
    if (char === ':' && pos + 1 < source.length && source[pos + 1] === ':') {
      const region = this.matchGotoLabel(source, pos);
      if (region) return region;
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
    if (pos + 2 < source.length && source[pos + 2] === '[') {
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

    // Check bounds and opening bracket
    if (i >= source.length || source[i] !== '[') {
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
  // Only returns a match if the topmost block is not repeat,
  // preventing end from skipping over unmatched repeat blocks
  private findLastNonRepeatIndex(stack: OpenBlock[]): number {
    if (stack.length === 0) {
      return -1;
    }
    // If the topmost block is repeat, end cannot close it
    if (stack[stack.length - 1].token.value === 'repeat') {
      return -1;
    }
    return stack.length - 1;
  }

  // Matches Lua regular strings, stopping at unescaped newlines
  // Lua regular strings cannot span multiple lines (syntax error),
  // but \z (skip whitespace including newlines) and \<newline> (line
  // continuation) are supported in Lua 5.2+
  protected matchQuotedString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        const next = source[i + 1];
        // \z skips following whitespace including newlines
        if (next === 'z') {
          i += 2;
          while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
            i++;
          }
          continue;
        }
        // \<newline> is a line continuation
        if (next === '\n') {
          i += 2;
          continue;
        }
        if (next === '\r') {
          i += 2;
          // \r\n counts as single newline continuation
          if (i < source.length && source[i] === '\n') {
            i++;
          }
          continue;
        }
        // Any other escape sequence
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      // Unescaped newline terminates the string (unterminated)
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches goto label ::identifier:: allowing newlines in whitespace
  private matchGotoLabel(source: string, pos: number): ExcludedRegion | null {
    let i = pos + 2;
    // Skip whitespace (including newlines) after ::
    while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i++;
    }
    // Match identifier
    if (i >= source.length || !/[a-zA-Z_]/.test(source[i])) {
      return null;
    }
    while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    // Skip whitespace (including newlines) before closing ::
    while (i < source.length && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i++;
    }
    // Check closing ::
    if (i + 1 < source.length && source[i] === ':' && source[i + 1] === ':') {
      return { start: pos, end: i + 2 };
    }
    return null;
  }
}
