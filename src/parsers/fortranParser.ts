// Fortran block parser: program, subroutine, function, if, do with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

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
const COMPOUND_END_PATTERN = new RegExp(`\\bend\\s*(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

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
    blockMiddle: ['else', 'elseif', 'case', 'then', 'contains']
  };

  // Finds excluded regions: comments and strings

  // Validates block open keywords
  // Single-line 'if' (without 'then') is not a block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (keyword.toLowerCase() !== 'if') {
      return true;
    }

    // Check if 'then' exists on the same line after the 'if'
    let i = position + keyword.length;
    while (i < source.length && source[i] !== '\n') {
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
      i++;
    }

    return false;
  }

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

    // Single-line comment: ! (Fortran 90+)
    if (char === '!') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchFortranString(source, pos, "'");
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchFortranString(source, pos, '"');
    }

    return null;
  }

  // Matches Fortran string with specified quote character
  private matchFortranString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === quote) {
        // Check for doubled quote escape
        if (i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in standard Fortran
      if (source[i] === '\n') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
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

      // Validate block open keywords (e.g., skip single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
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

    // Process tokens to handle compound keywords
    const result: Token[] = [];
    const processedCompoundPositions = new Set<number>();

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
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's a compound end (e.g., "end program", "endprogram")
          const compoundMatch = closeValue.match(/^end\s*(.+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
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
}
