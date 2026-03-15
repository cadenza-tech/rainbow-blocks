// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';

export class PascalBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'case', 'repeat', 'try', 'record', 'class', 'object', 'interface', 'asm'],
    blockClose: ['end', 'until'],
    blockMiddle: ['else', 'except', 'finally', 'of']
  };

  // Validates block open: 'interface' is only valid after '=' (type definition)
  // The unit-level 'interface' section keyword is not a block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Variant record case: case Tag: Type of (inside a record, no own end)
    // Also handles tagless variant: case Integer of (no colon)
    if (keyword === 'case') {
      const afterCase = source.slice(position + keyword.length);
      // Tagged variant: case Tag: Type of (only inside record)
      if (/^[ \t]+[a-zA-Z_]\w*[ \t]*:/i.test(afterCase)) {
        if (this.isInsideRecord(source, position, excludedRegions)) {
          return false;
        }
      }
      // Tagless variant: case TypeName of (identifier followed by 'of', no colon)
      // TypeName can be qualified (e.g., Types.MyEnum)
      // 'of' may appear on a separate line
      if (/^[ \t]+[a-zA-Z_][\w.]*\s+of\b/i.test(afterCase)) {
        // Check if we're inside a record block by scanning backward
        if (this.isInsideRecord(source, position, excludedRegions)) {
          return false;
        }
      }
    }

    // 'interface', 'class', 'object' are only block opens after '=' (type definitions)
    // e.g. TMyClass = class(TObject) ... end;
    // Not: class function Create, class procedure Destroy (modifiers)
    // Not: procedure of object (method pointer syntax)
    if (keyword !== 'interface' && keyword !== 'class' && keyword !== 'object') {
      return true;
    }

    // 'class of' is a class reference type, not a block (same line only)
    if (keyword === 'class') {
      let j = position + keyword.length;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === '\n' || source[j] === '\r') break;
        if (source[j] === ' ' || source[j] === '\t') {
          j++;
          continue;
        }
        break;
      }
      if (j + 2 <= source.length && /^of\b/i.test(source.slice(j, j + 3))) {
        return false;
      }
    }

    // Forward declarations: keyword followed by ';' (e.g. class;, interface;, object;)
    // Applies to class, interface, and object
    {
      let j = position + keyword.length;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r' || source[j] === '\n') {
          j++;
          continue;
        }
        break;
      }
      if (j < source.length && source[j] === ';') {
        return false;
      }
    }

    // Forward declaration with parent: class(TParent);, interface(IUnknown);, object(TBase);
    // Handle nested parentheses like class(TBase(TParam))
    if (keyword === 'class' || keyword === 'interface' || keyword === 'object') {
      // Skip whitespace and comments between keyword and '('
      {
        let j = position + keyword.length;
        while (j < source.length) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            j++;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            j++;
            continue;
          }
          break;
        }
        if (j < source.length && source[j] === '(') {
          let parenDepth = 1;
          j++;
          while (j < source.length && parenDepth > 0) {
            if (this.isInExcludedRegion(j, excludedRegions)) {
              j++;
              continue;
            }
            if (source[j] === '(') parenDepth++;
            else if (source[j] === ')') parenDepth--;
            j++;
          }
          // Skip whitespace and comments between ')' and ';'
          while (j < source.length) {
            if (this.isInExcludedRegion(j, excludedRegions)) {
              j++;
              continue;
            }
            if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r' || source[j] === '\n') {
              j++;
              continue;
            }
            break;
          }
          if (j < source.length && source[j] === ';') {
            return false;
          }
        }
      }
    }

    // Look backward (skipping whitespace and excluded regions) for '='
    let i = position - 1;
    while (i >= 0) {
      // Skip excluded regions
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i--;
        continue;
      }
      if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
        i--;
        continue;
      }
      break;
    }

    // If we found 'packed' keyword before 'object', scan further back for '='
    if (i >= 5 && source.slice(i - 5, i + 1).toLowerCase() === 'packed' && (i < 6 || !/[a-zA-Z0-9_]/.test(source[i - 6]))) {
      i -= 6;
      while (i >= 0) {
        if (this.isInExcludedRegion(i, excludedRegions)) {
          i--;
          continue;
        }
        if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
          i--;
          continue;
        }
        break;
      }
    }

    return i >= 0 && source[i] === '=';
  }

  // Extends base to add ASM block excluded regions
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions = super.findExcludedRegions(source);
    this.addAsmExcludedRegions(source, regions);
    return regions;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
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

  // Exclude the interior of asm...end blocks so assembly labels (begin:, case:) are not treated as keywords
  private addAsmExcludedRegions(source: string, regions: ExcludedRegion[]): void {
    const asmPattern = /\basm\b/gi;
    const asmRegions: ExcludedRegion[] = [];

    for (let match = asmPattern.exec(source); match !== null; match = asmPattern.exec(source)) {
      const asmStart = match.index;

      // Skip asm found inside existing excluded regions
      if (this.isInExcludedRegion(asmStart, regions)) {
        continue;
      }

      // Search for matching 'end' after asm
      const contentStart = asmStart + 3;
      const endPattern = /\bend\b/gi;
      endPattern.lastIndex = contentStart;

      let foundEnd = false;

      for (let endMatch = endPattern.exec(source); endMatch !== null; endMatch = endPattern.exec(source)) {
        const endPos = endMatch.index;

        // Skip end inside existing excluded regions
        if (this.isInExcludedRegion(endPos, regions)) {
          continue;
        }

        // Skip end: (assembly label) - check if followed by colon
        // Skip whitespace and excluded regions (comments) between 'end' and ':'
        let checkPos = endPos + 3;
        while (checkPos < source.length) {
          if (this.isInExcludedRegion(checkPos, regions)) {
            checkPos++;
            continue;
          }
          if (source[checkPos] === ' ' || source[checkPos] === '\t') {
            checkPos++;
            continue;
          }
          break;
        }
        if (checkPos < source.length && source[checkPos] === ':') {
          continue;
        }

        // This is the real closing 'end' - exclude from asm keyword end to end keyword start
        asmRegions.push({ start: contentStart, end: endPos });
        foundEnd = true;
        break;
      }

      // Unterminated asm - exclude to end of source
      if (!foundEnd) {
        asmRegions.push({ start: contentStart, end: source.length });
      }
    }

    // Merge asm regions into the main regions array
    // Remove inner regions that overlap with asm body to prevent binary search failure
    if (asmRegions.length > 0) {
      for (const asmRegion of asmRegions) {
        for (let ri = regions.length - 1; ri >= 0; ri--) {
          if (regions[ri].start >= asmRegion.start && regions[ri].end <= asmRegion.end) {
            regions.splice(ri, 1);
          }
        }
      }
      regions.push(...asmRegions);
      regions.sort((a, b) => a.start - b.start);
    }
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

  // Checks if a position is inside a record block (for variant case detection)
  private isInsideRecord(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerSource = source.toLowerCase();
    let depth = 0;
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i--;
        continue;
      }
      // Look for 'end', 'begin', 'record', 'object', 'class', 'interface',
      // 'try', 'case', 'asm'
      // 'begin' and other block openers cancel out 'end'
      if (
        i >= 4 &&
        lowerSource.slice(i - 4, i + 1) === 'begin' &&
        (i - 5 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 5])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
        else return false;
        i -= 5;
        continue;
      }
      if (
        i >= 2 &&
        lowerSource.slice(i - 2, i + 1) === 'end' &&
        (i - 3 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 3])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        depth++;
        i -= 3;
        continue;
      }
      if (
        i >= 5 &&
        lowerSource.slice(i - 5, i + 1) === 'record' &&
        (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth === 0) return true;
        depth--;
        i -= 6;
        continue;
      }
      if (
        i >= 5 &&
        lowerSource.slice(i - 5, i + 1) === 'object' &&
        (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth === 0) return true;
        depth--;
        i -= 6;
        continue;
      }
      // 'class' closes an 'end' (class...end pairs are not records)
      if (
        i >= 4 &&
        lowerSource.slice(i - 4, i + 1) === 'class' &&
        (i - 5 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 5])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
        else return false;
        i -= 5;
        continue;
      }
      // 'interface' closes an 'end'
      if (
        i >= 8 &&
        lowerSource.slice(i - 8, i + 1) === 'interface' &&
        (i - 9 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 9])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
        else return false;
        i -= 9;
        continue;
      }
      // 'try' closes an 'end'
      if (
        i >= 2 &&
        lowerSource.slice(i - 2, i + 1) === 'try' &&
        (i - 3 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 3])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
        else return false;
        i -= 3;
        continue;
      }
      // Note: 'case' is NOT tracked here because variant case (inside record/object) has no matching 'end'
      // Tracking case would cause variant case to consume the record's 'end', breaking depth accounting
      // 'asm' closes an 'end'
      if (
        i >= 2 &&
        lowerSource.slice(i - 2, i + 1) === 'asm' &&
        (i - 3 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 3])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
        else return false;
        i -= 3;
        continue;
      }
      i--;
    }
    return false;
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
      // Pascal strings cannot span multiple lines
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
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
            const topValue = stack[stack.length - 1].token.value.toLowerCase();
            const middleValue = token.value.toLowerCase();
            // 'of' only applies to 'case' blocks
            if (middleValue === 'of' && topValue !== 'case') break;
            // 'except' and 'finally' only apply to 'try' blocks
            if ((middleValue === 'except' || middleValue === 'finally') && topValue !== 'try') break;
            // 'else' applies to 'case' and 'try' blocks (if/else is not block-level in Pascal)
            if (middleValue === 'else' && topValue !== 'case' && topValue !== 'try') break;
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
}
