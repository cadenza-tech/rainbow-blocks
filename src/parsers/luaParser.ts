// Lua block parser: handles repeat-until, long strings [[ ]], and multi-line comments --[[ ]]

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';

export class LuaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'while', 'for', 'repeat', 'function', 'do'],
    blockClose: ['end', 'until'],
    blockMiddle: ['then', 'else', 'elseif']
  };

  // Validates block open keywords, excluding do that's part of while/for loop
  // Also rejects keywords preceded by '.' or ':' (table field/method access like t.end, obj:repeat)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByDotOrColon(source, position)) {
      return false;
    }

    if (keyword !== 'do') {
      return true;
    }

    return !this.isDoPartOfLoop(source, position, excludedRegions);
  }

  // Validates block close: rejects keywords preceded by '.' or ':'
  protected isValidBlockClose(_keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return !this.isPrecededByDotOrColon(source, position);
  }

  // Checks if keyword is preceded by '.' or ':' (table field/method access)
  // But not '..' (concatenation) or '::' (goto label syntax)
  // Skips whitespace between operator and keyword since Lua allows 'obj . end'
  private isPrecededByDotOrColon(source: string, position: number): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i--;
    }
    if (i < 0) return false;
    if (source[i] === '.') {
      // .. is string concatenation operator, not field access
      return !(i >= 1 && source[i - 1] === '.');
    }
    if (source[i] === ':') {
      // :: is goto label closing, not method call
      return !(i >= 1 && source[i - 1] === ':');
    }
    return false;
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
      if (this.isAdjacentToUnicodeLetter(source, loopAbsolutePos, loopMatch[0].length)) {
        continue;
      }
      if (this.isPrecededByDotOrColon(source, loopAbsolutePos)) {
        continue;
      }

      // Find the matching 'do' for this loop keyword, accounting for nested loops
      // Each nested for/while consumes one do, so we track nesting
      // Also track other block openers (function, if, repeat) that can contain standalone do
      const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
      const searchRange = source.slice(afterLoopStart, position + 2);
      const blockPattern = /\b(do|for|while|function|if|repeat|end|until)\b/g;
      const matches = [...searchRange.matchAll(blockPattern)];

      let nestedLoopDepth = 0;
      // Track nested loop do...end blocks that need their end consumed
      let nestedLoopEndDepth = 0;
      let otherBlockDepth = 0;
      let foundOurDo = false;
      // Track pending for/while inside non-loop blocks that await their do keyword
      let pendingLoopDo = 0;

      for (const innerMatch of matches) {
        const absolutePos = afterLoopStart + innerMatch.index;
        if (this.isInExcludedRegion(absolutePos, excludedRegions)) {
          continue;
        }
        if (this.isAdjacentToUnicodeLetter(source, absolutePos, innerMatch[0].length)) {
          continue;
        }
        if (this.isPrecededByDotOrColon(source, absolutePos)) {
          continue;
        }
        const word = innerMatch[1];
        // Track non-loop block openers (function, if, repeat) that can contain standalone do
        if (word === 'function' || word === 'if' || word === 'repeat') {
          otherBlockDepth++;
        } else if ((word === 'end' || word === 'until') && otherBlockDepth > 0) {
          otherBlockDepth--;
          if (otherBlockDepth === 0) {
            pendingLoopDo = 0;
          }
        } else if (otherBlockDepth > 0) {
          // Inside a non-loop block, track sub-blocks so their end keywords
          // don't prematurely close the outer scope
          if (word === 'for' || word === 'while') {
            otherBlockDepth++;
            pendingLoopDo++;
          } else if (word === 'do') {
            if (pendingLoopDo > 0) {
              pendingLoopDo--;
            } else {
              otherBlockDepth++;
            }
          }
        } else if ((word === 'end' || word === 'until') && nestedLoopEndDepth > 0) {
          // Consume end that closes a nested loop's do...end block
          nestedLoopEndDepth--;
        } else if (word === 'end' || word === 'until') {
          // end/until at depth 0 with no pending closers means the loop scope ended
          break;
        } else if (word === 'for' || word === 'while') {
          // Nested loop found; its do will be consumed by this nested loop
          nestedLoopDepth++;
        } else if (word === 'do') {
          if (nestedLoopDepth > 0) {
            // This do belongs to a nested loop
            nestedLoopDepth--;
            nestedLoopEndDepth++;
          } else if (absolutePos === position) {
            // This is our do, and it belongs to this loop
            foundOurDo = true;
            break;
          } else {
            // A different do at depth 0 before our position - this loop already has a do
            break;
          }
        }
      }

      if (foundOurDo) {
        return true;
      }
    }

    return false;
  }

  // Filters out middle keywords preceded by '.' or ':' (table field/method access)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      if (token.type === 'block_middle' && this.isPrecededByDotOrColon(source, token.startOffset)) {
        return false;
      }
      return true;
    });
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
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
            const repeatIndex = findLastOpenerByType(stack, 'repeat');
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
            const nonRepeatIndex = findLastNonRepeatIndex(stack);
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
          while (
            i < source.length &&
            (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r' || source[i] === '\v' || source[i] === '\f')
          ) {
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
