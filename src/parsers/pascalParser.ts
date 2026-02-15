// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

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
      // Tagged variant: case Tag: Type of
      if (/^\s+[a-zA-Z_]\w*\s*:/i.test(afterCase)) {
        return false;
      }
      // Tagless variant: case TypeName of (identifier followed by 'of', no colon)
      // TypeName can be qualified (e.g., Types.MyEnum)
      if (/^\s+[a-zA-Z_][\w.]*\s+of\b/i.test(afterCase)) {
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

    // 'class of' is a class reference type, not a block
    // 'class;' and 'class(TParent);' are forward declarations, not blocks
    if (keyword === 'class') {
      const afterClass = source.slice(position + keyword.length);
      if (/^\s+of\b/i.test(afterClass)) {
        return false;
      }
      if (/^\s*;/.test(afterClass)) {
        return false;
      }
      // Forward declaration with parent: class(TParent);
      // Handle nested parentheses like class(TBase(TParam))
      if (/^\s*\(/.test(afterClass)) {
        let j = position + keyword.length;
        // Skip leading whitespace to find '('
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
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

    return i >= 0 && source[i] === '=';
  }

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
      // Look for 'end', 'begin', 'record', or 'object'
      // 'begin' cancels out 'end' (begin-end pairs are not records)
      if (
        i >= 4 &&
        lowerSource.slice(i - 4, i + 1) === 'begin' &&
        (i - 5 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 5])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth > 0) depth--;
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
