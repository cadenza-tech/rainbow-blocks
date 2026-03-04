// Abstract base class for block parsers using a 2-pass algorithm

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token, TokenType } from '../types';

export abstract class BaseBlockParser {
  protected abstract readonly keywords: LanguageKeywords;

  // Parses source code and returns matched block pairs
  parse(source: string): BlockPair[] {
    const excludedRegions = this.findExcludedRegions(source);
    const tokens = this.tokenize(source, excludedRegions);
    const pairs = this.matchBlocks(tokens);
    this.recalculateNestLevels(pairs);
    return pairs;
  }

  // Recalculate nest levels based on actual matched pairs containment
  // Fixes incorrect levels caused by unmatched block openers on the stack
  private recalculateNestLevels(pairs: BlockPair[]): void {
    for (const pair of pairs) {
      let level = 0;
      for (const other of pairs) {
        if (
          other !== pair &&
          other.openKeyword.startOffset < pair.openKeyword.startOffset &&
          other.closeKeyword.startOffset >= pair.closeKeyword.startOffset
        ) {
          level++;
        }
      }
      pair.nestLevel = level;
    }
  }

  // Finds regions to exclude from keyword detection (comments, strings, etc)
  // Must return regions sorted by start position for binary search
  // Override findExcludedRegions for custom scanning, or override tryMatchExcludedRegion for simple dispatch
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
  // Override to dispatch to string/comment matchers
  protected tryMatchExcludedRegion(_source: string, _pos: number): ExcludedRegion | null {
    return null;
  }

  // Validates if a block open keyword is valid at the given position
  // Override to handle postfix conditions, one-liners, etc
  protected isValidBlockOpen(_keyword: string, _source: string, _position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return true;
  }

  // Validates if a block close keyword is valid at the given position
  // Override to handle special cases like keyword arguments
  protected isValidBlockClose(_keyword: string, _source: string, _position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return true;
  }

  // Tokenizes source code to find block keywords
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];

    // Sort keywords by length descending to match longer keywords first
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    // Escape regex metacharacters in keywords for safe pattern construction
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    const keywordPattern = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'g');

    // Pre-compute newline positions for O(log n) line/column lookup
    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(keywordPattern)) {
      const startOffset = match.index;

      // Skip keywords in excluded regions
      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = match[1];

      // JavaScript \b only handles ASCII word boundaries, so check for adjacent Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }
      const type = this.getTokenType(keyword);

      // Validate block open keywords
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block close keywords
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

    return tokens;
  }

  // Matches blocks using a stack-based algorithm
  // Override for special cases like Lua's repeat-until or Bash's fi/esac/done
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
          const openBlock = stack.pop();
          if (openBlock) {
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

  // Checks if a position is within an excluded region using binary search
  // See also standalone isInExcludedRegion in parserUtils.ts for use outside class context
  protected isInExcludedRegion(pos: number, regions: ExcludedRegion[]): boolean {
    return this.findExcludedRegionAt(pos, regions) !== null;
  }

  // Finds the excluded region containing the given position using binary search
  protected findExcludedRegionAt(pos: number, regions: ExcludedRegion[]): ExcludedRegion | null {
    let left = 0;
    let right = regions.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const region = regions[mid];

      if (pos >= region.start && pos < region.end) {
        return region;
      }
      if (pos < region.start) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return null;
  }

  // Returns the token type for a keyword
  protected getTokenType(keyword: string): TokenType {
    if (this.keywords.blockClose.includes(keyword)) {
      return 'block_close';
    }
    if (this.keywords.blockMiddle.includes(keyword)) {
      return 'block_middle';
    }
    return 'block_open';
  }

  // Calculates line and column for a position using binary search
  protected getLineAndColumn(offset: number, newlinePositions: number[]): { line: number; column: number } {
    let left = 0;
    let right = newlinePositions.length - 1;
    let line = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (newlinePositions[mid] < offset) {
        line = mid + 1;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // Column is the distance from the previous newline
    const lastNewline = line > 0 ? newlinePositions[line - 1] : -1;
    return {
      line,
      column: offset - lastNewline - 1
    };
  }

  // Builds an array of newline positions for efficient line/column lookup
  protected buildNewlinePositions(source: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        positions.push(i);
      } else if (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n')) {
        // CR-only line ending (not part of CRLF)
        positions.push(i);
      }
    }
    return positions;
  }

  // Matches a quoted string with escape sequence handling
  protected matchQuotedString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches a single-line comment (from position to end of line)
  protected matchSingleLineComment(source: string, pos: number): ExcludedRegion {
    let end = pos;
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
      end++;
    }
    return { start: pos, end };
  }

  // Checks if a position is at the start of a line
  protected isAtLineStart(source: string, pos: number): boolean {
    return pos === 0 || source[pos - 1] === '\n' || source[pos - 1] === '\r';
  }

  // Checks if a keyword match is adjacent to a non-ASCII Unicode letter
  // JavaScript \b treats non-ASCII letters as non-word characters, causing false matches like `αend`
  protected isAdjacentToUnicodeLetter(source: string, startOffset: number, keywordLength: number): boolean {
    if (startOffset > 0) {
      const before = source[startOffset - 1];
      if (!/\w/.test(before) && /\p{L}/u.test(before)) return true;
    }
    const afterPos = startOffset + keywordLength;
    if (afterPos < source.length) {
      const after = source[afterPos];
      if (!/\w/.test(after) && /\p{L}/u.test(after)) return true;
    }
    return false;
  }

  // Escapes regex metacharacters in a string
  protected escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Returns all tokens for testing purposes

  getTokens(source: string): Token[] {
    const excludedRegions = this.findExcludedRegions(source);
    return this.tokenize(source, excludedRegions);
  }

  // Returns excluded regions for testing purposes
  getExcludedRegions(source: string): ExcludedRegion[] {
    return this.findExcludedRegions(source);
  }
}
