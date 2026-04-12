// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';
import type { PascalValidationCallbacks } from './pascalValidation';
import { isIfThenElse, isInsideParens, isTypeDeclarationOf, isVariantRecordCase, TYPE_MODIFIERS } from './pascalValidation';

// Keywords that indicate comparison context (= is comparison, not type definition)
const COMPARISON_CONTEXT_KEYWORDS = new Set(['if', 'while', 'until', 'then', 'or', 'and', 'not', 'xor', 'else']);

export class PascalBlockParser extends BaseBlockParser {
  private get validationCallbacks(): PascalValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

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
      if (isVariantRecordCase(source, position, excludedRegions, this.validationCallbacks)) {
        return false;
      }
    }

    // 'asm' must be at statement position (not used as identifier/field/parameter).
    if (keyword === 'asm') {
      // Reject when followed by ':' (type annotation like 'asm: Integer') or
      // ':=' (assignment), or '.' (field access), or '(' (function call), or ','.
      {
        let fp = position + 3;
        while (fp < source.length) {
          if (this.isInExcludedRegion(fp, excludedRegions)) {
            const region = this.findExcludedRegionAt(fp, excludedRegions);
            if (region) {
              fp = region.end;
              continue;
            }
          }
          if (source[fp] === ' ' || source[fp] === '\t') {
            fp++;
            continue;
          }
          break;
        }
        if (fp < source.length) {
          const next = source[fp];
          if (next === ':' || next === '.' || next === ',' || next === ')' || next === '=') {
            return false;
          }
        }
      }
      // Scan backward on the same physical line; reject expression/declaration context.
      let bp = position - 1;
      while (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
        if (this.isInExcludedRegion(bp, excludedRegions)) {
          const region = this.findExcludedRegionAt(bp, excludedRegions);
          if (region) {
            bp = region.start - 1;
            continue;
          }
        }
        if (source[bp] === ' ' || source[bp] === '\t') {
          bp--;
          continue;
        }
        break;
      }
      if (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
        const prev = source[bp];
        if (prev === ';') {
          return true;
        }
        if (prev === '.' || prev === ':' || prev === ',' || prev === '(' || prev === '=') {
          return false;
        }
        if (/[a-zA-Z0-9_]/.test(prev)) {
          return false;
        }
      }
      return true;
    }

    // 'interface', 'class', 'object' are only block opens after '=' (type definitions)
    // e.g. TMyClass = class(TObject) ... end;
    // Not: class function Create, class procedure Destroy (modifiers)
    // Not: procedure of object (method pointer syntax)
    if (keyword !== 'interface' && keyword !== 'class' && keyword !== 'object') {
      return true;
    }

    // Type declarations never appear inside parentheses. If the keyword is inside
    // unbalanced '(', it is a comparison expression like 'if (x = class)' and
    // must not be treated as a block opener.
    if (isInsideParens(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }

    // 'class of' is a class reference type, not a block (same line only)
    if (keyword === 'class') {
      let j = position + keyword.length;
      let hasNewline = false;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          // Track newlines inside excluded regions (multi-line comments)
          if (source[j] === '\n' || source[j] === '\r') hasNewline = true;
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
      if (!hasNewline && j + 2 <= source.length && /^of\b/i.test(source.slice(j, j + 3))) {
        return false;
      }
    }

    // Forward declarations: keyword followed by ';' (e.g. class;, interface;, object;)
    // Also handles Delphi GUID bracket syntax: interface['{GUID}'];
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
      // Skip bracket expression [...] (Delphi GUID syntax)
      if (j < source.length && source[j] === '[') {
        let bracketDepth = 1;
        j++;
        while (j < source.length && bracketDepth > 0) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            j++;
            continue;
          }
          if (source[j] === '[') bracketDepth++;
          else if (source[j] === ']') bracketDepth--;
          j++;
        }
        // Skip whitespace and comments after ']'
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

    // If we found type modifier keywords (packed, sealed, abstract) before class/object/interface, scan further back for '='
    // Multiple modifiers can appear: e.g. 'packed sealed class'
    {
      let foundModifier = true;
      while (foundModifier) {
        foundModifier = false;
        for (const modifier of TYPE_MODIFIERS) {
          const len = modifier.length;
          if (i >= len - 1 && source.slice(i - len + 1, i + 1).toLowerCase() === modifier && (i < len || !/[a-zA-Z0-9_]/.test(source[i - len]))) {
            i -= len;
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
            foundModifier = true;
            break;
          }
        }
      }
    }

    // Must be '=' but not ':=' (assignment operator)
    if (!(i >= 0 && source[i] === '=' && (i === 0 || ![':', '>', '<', '+', '-', '*', '/'].includes(source[i - 1])))) {
      return false;
    }

    // Check if '=' is in a comparison context (not a type definition)
    // e.g. 'if x = class' should not treat class as block opener
    {
      let ci = i - 1;
      while (ci >= 0) {
        if (this.isInExcludedRegion(ci, excludedRegions)) {
          ci--;
          continue;
        }
        if (source[ci] === ' ' || source[ci] === '\t' || source[ci] === '\n' || source[ci] === '\r') {
          ci--;
          continue;
        }
        break;
      }
      // Extract the word ending at ci
      if (ci >= 0 && /[a-zA-Z0-9_]/.test(source[ci])) {
        const wordEnd = ci;
        while (ci > 0 && /[a-zA-Z0-9_]/.test(source[ci - 1])) ci--;
        const word = source.slice(ci, wordEnd + 1).toLowerCase();
        if (COMPARISON_CONTEXT_KEYWORDS.has(word)) {
          return false;
        }
        // Also check one more word back (e.g. 'if x = class' where x is an identifier)
        let ci2 = ci - 1;
        while (ci2 >= 0) {
          if (this.isInExcludedRegion(ci2, excludedRegions)) {
            ci2--;
            continue;
          }
          if (source[ci2] === ' ' || source[ci2] === '\t' || source[ci2] === '\n' || source[ci2] === '\r') {
            ci2--;
            continue;
          }
          break;
        }
        if (ci2 >= 0 && /[a-zA-Z0-9_]/.test(source[ci2])) {
          const wordEnd2 = ci2;
          while (ci2 > 0 && /[a-zA-Z0-9_]/.test(source[ci2 - 1])) ci2--;
          const word2 = source.slice(ci2, wordEnd2 + 1).toLowerCase();
          if (COMPARISON_CONTEXT_KEYWORDS.has(word2)) {
            return false;
          }
        }
      }
    }

    return true;
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
      return this.matchPascalString(source, pos, "'");
    }

    // Double-quoted string (FreePascal) with Pascal escaping ("")
    if (char === '"') {
      return this.matchPascalString(source, pos, '"');
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

      // Skip asm used as an identifier (variable, field, parameter, etc.).
      // Forward check: reject when followed by ':' (type annotation like 'asm: Integer'),
      // ':=' (assignment), '.', ',', ')', '='.
      {
        let fp = asmStart + 3;
        while (fp < source.length && (source[fp] === ' ' || source[fp] === '\t')) fp++;
        if (fp < source.length) {
          const next = source[fp];
          if (next === ':' || next === '.' || next === ',' || next === ')' || next === '=') {
            continue;
          }
        }
      }
      // Backward check on the same physical line: reject expression/declaration context.
      {
        let bp = asmStart - 1;
        while (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
          if (this.isInExcludedRegion(bp, regions)) {
            const region = this.findExcludedRegionAt(bp, regions);
            if (region) {
              bp = region.start - 1;
              continue;
            }
          }
          if (source[bp] === ' ' || source[bp] === '\t') {
            bp--;
            continue;
          }
          break;
        }
        if (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
          const prev = source[bp];
          if (prev !== ';') {
            if (prev === '.' || prev === ':' || prev === ',' || prev === '(' || prev === '=') {
              continue;
            }
            if (/[a-zA-Z0-9_]/.test(prev)) {
              continue;
            }
          }
        }
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

      // Filter 'else' from if-then-else (not a case/try intermediate)
      if (type === 'block_middle' && keyword === 'else') {
        if (isIfThenElse(source, startOffset, excludedRegions, this.validationCallbacks)) {
          continue;
        }
      }

      // Filter 'of' from type declarations (array of, set of, file of)
      if (type === 'block_middle' && keyword === 'of') {
        if (isTypeDeclarationOf(source, startOffset, excludedRegions, this.validationCallbacks)) {
          continue;
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

    return tokens;
  }

  // Matches Pascal string with '' escape (not backslash)
  private matchPascalString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === quote) {
        // Check for doubled quote (escape)
        if (i + 1 < source.length && source[i + 1] === quote) {
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
