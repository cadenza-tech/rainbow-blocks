// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';

// Type modifier keywords that can appear between '=' and class/object/interface
const TYPE_MODIFIERS = ['abstract', 'sealed', 'packed'];

// Keywords that indicate comparison context (= is comparison, not type definition)
const COMPARISON_CONTEXT_KEYWORDS = new Set(['if', 'while', 'until', 'then', 'or', 'and', 'not', 'xor', 'else']);

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
      if (this.isVariantRecordCase(source, position, excludedRegions)) {
        return false;
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

  // Checks if 'case' at position is a variant record case (tagged or tagless)
  // Skips excluded regions (comments) between 'case' and the identifier
  private isVariantRecordCase(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!this.isInsideRecord(source, position, excludedRegions)) {
      return false;
    }
    // Scan forward from after 'case', skipping whitespace and excluded regions, looking for identifier
    let j = position + 4; // skip 'case'
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
        j++;
        continue;
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    // Expect an identifier
    if (j < source.length && /[a-zA-Z_]/i.test(source[j])) {
      // Tagged variant: identifier followed by ':'
      // Tagless variant: identifier followed by 'of'
      let k = j;
      while (k < source.length && /[\w.]/i.test(source[k])) {
        k++;
      }
      // Skip whitespace and excluded regions after identifier
      while (k < source.length) {
        if (this.isInExcludedRegion(k, excludedRegions)) {
          const region = this.findExcludedRegionAt(k, excludedRegions);
          if (region) {
            k = region.end;
            continue;
          }
          k++;
          continue;
        }
        if (source[k] === ' ' || source[k] === '\t') {
          k++;
          continue;
        }
        break;
      }
      if (k < source.length && source[k] === ':') {
        return true; // Tagged variant
      }
      if (k + 2 <= source.length && /^of\b/i.test(source.slice(k, k + 3))) {
        return true; // Tagless variant
      }
    }
    return false;
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
        // Skip 'object' in method pointer syntax: procedure of object, function of object
        let oi = i - 6;
        while (oi >= 0) {
          if (source[oi] === ' ' || source[oi] === '\t' || source[oi] === '\n' || source[oi] === '\r') {
            oi--;
            continue;
          }
          const rgn = this.findExcludedRegionAt(oi, excludedRegions);
          if (rgn) {
            oi = rgn.start - 1;
            continue;
          }
          break;
        }
        if (oi >= 1 && lowerSource.slice(oi - 1, oi + 1) === 'of' && (oi - 2 < 0 || !/[a-zA-Z0-9_]/.test(source[oi - 2]))) {
          i -= 6;
          continue;
        }
        // Skip 'object' as field type reference (preceded by ':')
        if (oi >= 0 && source[oi] === ':') {
          i -= 6;
          continue;
        }
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
        // Skip 'class' as field type reference (preceded by ':')
        let ci = i - 5;
        while (ci >= 0) {
          if (source[ci] === ' ' || source[ci] === '\t' || source[ci] === '\n' || source[ci] === '\r') {
            ci--;
            continue;
          }
          const rgn = this.findExcludedRegionAt(ci, excludedRegions);
          if (rgn) {
            ci = rgn.start - 1;
            continue;
          }
          break;
        }
        if (ci >= 0 && source[ci] === ':') {
          i -= 5;
          continue;
        }
        // Skip 'class' as forward declaration (class; or class(Parent);)
        if (this.isForwardDeclarationAfter(source, i + 1, excludedRegions)) {
          i -= 5;
          continue;
        }
        // Skip 'class of' (class reference type, no matching end)
        // Also skips excluded regions (comments) between 'class' and 'of'
        // Stop at newlines: 'class\n  of' is NOT a reference type (consistent with isValidBlockOpen)
        {
          let ck = i + 1;
          let hasNewline = false;
          while (ck < source.length) {
            if (source[ck] === '\n' || source[ck] === '\r') {
              hasNewline = true;
              break;
            }
            if (source[ck] === ' ' || source[ck] === '\t') {
              ck++;
              continue;
            }
            if (this.isInExcludedRegion(ck, excludedRegions)) {
              const rgn = this.findExcludedRegionAt(ck, excludedRegions);
              if (rgn) {
                // Track newlines inside excluded regions (multi-line comments)
                for (let ri = rgn.start; ri < rgn.end; ri++) {
                  if (source[ri] === '\n' || source[ri] === '\r') {
                    hasNewline = true;
                    break;
                  }
                }
                if (hasNewline) break;
                ck = rgn.end;
                continue;
              }
            }
            break;
          }
          if (
            !hasNewline &&
            ck + 1 < source.length &&
            lowerSource.slice(ck, ck + 2) === 'of' &&
            (ck + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[ck + 2]))
          ) {
            i -= 5;
            continue;
          }
        }
        // Check if preceded by '=' (type definition): skip method modifier check
        {
          let eqCheck = ci;
          // Skip type modifiers (abstract, sealed, packed) to find '='
          // Loop to handle multiple modifiers (e.g., 'sealed abstract class')
          let foundModifier = true;
          while (foundModifier && eqCheck >= 0 && /[a-zA-Z]/.test(source[eqCheck])) {
            foundModifier = false;
            let wordStart = eqCheck;
            while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) wordStart--;
            const word = lowerSource.slice(wordStart, eqCheck + 1);
            if (TYPE_MODIFIERS.includes(word)) {
              foundModifier = true;
              eqCheck = wordStart - 1;
              while (eqCheck >= 0 && (source[eqCheck] === ' ' || source[eqCheck] === '\t' || source[eqCheck] === '\n' || source[eqCheck] === '\r'))
                eqCheck--;
            }
          }
          // If preceded by '=', it's a type definition - don't check for method modifier
          if (eqCheck < 0 || source[eqCheck] !== '=') {
            // Skip 'class' as method modifier (followed by function, procedure, var, property, constructor, destructor, operator)
            let cj = i + 2;
            while (cj < source.length) {
              if (this.isInExcludedRegion(cj, excludedRegions)) {
                const region = this.findExcludedRegionAt(cj, excludedRegions);
                if (region) {
                  cj = region.end;
                  continue;
                }
                cj++;
                continue;
              }
              if (source[cj] === ' ' || source[cj] === '\t' || source[cj] === '\n' || source[cj] === '\r') {
                cj++;
                continue;
              }
              break;
            }
            const afterClass = lowerSource.slice(cj, cj + 12);
            if (/^(function|procedure|var|property|constructor|destructor|operator)\b/.test(afterClass)) {
              i -= 5;
              continue;
            }
          }
        }
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
        // Skip 'interface' as field type reference (preceded by ':')
        let ii = i - 9;
        while (ii >= 0) {
          if (source[ii] === ' ' || source[ii] === '\t' || source[ii] === '\n' || source[ii] === '\r') {
            ii--;
            continue;
          }
          const rgn = this.findExcludedRegionAt(ii, excludedRegions);
          if (rgn) {
            ii = rgn.start - 1;
            continue;
          }
          break;
        }
        if (ii >= 0 && source[ii] === ':') {
          i -= 9;
          continue;
        }
        // Skip 'interface' as forward declaration (interface; or interface(IParent);)
        if (this.isForwardDeclarationAfter(source, i + 1, excludedRegions)) {
          i -= 9;
          continue;
        }
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
      // Track standalone case...end pairs (depth >= 1) only when the case is NOT a variant case
      // Variant cases have parenthesized field lists after 'of' labels, e.g. 0: (Field: Type)
      // Standalone cases have statements after labels, e.g. 1: WriteLn
      if (
        i >= 3 &&
        lowerSource.slice(i - 3, i + 1) === 'case' &&
        (i - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 4])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        if (depth >= 1 && !this.isVariantCase(source, i - 3, excludedRegions)) depth--;
        i -= 4;
        continue;
      }
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

  // Checks if a case at the given position is a variant case (record variant part)
  // Variant cases have parenthesized field lists after labels: case Tag of 0: (Field: Type)
  // Standalone cases have statements after labels: case X of 1: WriteLn
  private isVariantCase(source: string, caseStart: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerSource = source.toLowerCase();
    // Find 'of' after 'case', skipping excluded regions and newlines
    let j = caseStart + 4;
    while (j + 1 < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
        j++;
        continue;
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      if (
        lowerSource[j] === 'o' &&
        lowerSource[j + 1] === 'f' &&
        (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) &&
        (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))
      ) {
        j += 2;
        break;
      }
      // Stop at semicolons (statement boundary)
      if (source[j] === ';') return false;
      j++;
    }
    if (j >= source.length) return false;
    // After 'of', find the first label pattern: digits/identifier/char constant followed by ':'
    // Then check if after ':' there's '(' (variant) or something else (standalone)
    while (j < source.length) {
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      // Skip excluded regions (comments, strings) and check for ':' after char constants
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.end;
        // After an excluded region (e.g., char constant 'a'), check if ':' follows
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
        if (j < source.length && source[j] === ':') {
          j++;
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
          return j < source.length && source[j] === '(';
        }
        continue;
      }
      // Look for label: digits, identifier, range (..), negative (-), comma-separated, hex ($xx), char constant (#nn) followed by ':'
      if (/[a-zA-Z0-9_$#-]/.test(source[j])) {
        // Consume initial label token (identifier, number, $hex, #charcode)
        if (source[j] === '#') {
          j++;
          while (j < source.length && /[0-9]/.test(source[j])) j++;
        } else {
          while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j++;
        }
        // Continue scanning past range dots, negatives, commas, spaces, newlines, qualified names, parentheses, char constants
        while (j < source.length && (/[.,# \t()\p{L}0-9_$-]/u.test(source[j]) || source[j] === '\n' || source[j] === '\r')) {
          // Skip excluded regions within labels (e.g., char constants in range labels)
          const innerRegion = this.findExcludedRegionAt(j, excludedRegions);
          if (innerRegion) {
            j = innerRegion.end;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            // Peek ahead past whitespace/newlines to see if next non-space is ':'
            let peek = j;
            while (peek < source.length && (source[peek] === ' ' || source[peek] === '\t' || source[peek] === '\n' || source[peek] === '\r')) peek++;
            if (peek < source.length && source[peek] === ':') break;
          }
          j++;
        }
        // Skip whitespace between label and ':'
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
        if (j < source.length && source[j] === ':') {
          j++;
          // Skip whitespace and newlines after ':'
          while (j < source.length && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) j++;
          // '(' indicates variant case field list
          return j < source.length && source[j] === '(';
        }
      }
      break;
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

      // Filter 'else' from if-then-else (not a case/try intermediate)
      if (type === 'block_middle' && keyword === 'else') {
        if (this.isIfThenElse(source, startOffset, excludedRegions)) {
          continue;
        }
      }

      // Filter 'of' from type declarations (array of, set of, file of)
      if (type === 'block_middle' && keyword === 'of') {
        if (this.isTypeDeclarationOf(source, startOffset, excludedRegions)) {
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

  // Checks if 'else' at position is part of an if-then-else (not a case/try else)
  // Scans backward tracking begin/end depth to find 'then' at the same nesting level
  private isIfThenElse(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 0;
    let i = position - 1;
    while (i >= 0) {
      if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
        i--;
        continue;
      }
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i--;
        continue;
      }
      if (source[i] === ';' && depth === 0) {
        return false;
      }
      if (/[a-zA-Z_]/i.test(source[i])) {
        const wordEnd = i;
        while (i >= 0 && /[a-zA-Z0-9_]/i.test(source[i])) {
          i--;
        }
        const word = source.slice(i + 1, wordEnd + 1).toLowerCase();
        if (word === 'end' || word === 'until') {
          depth++;
        } else if (word === 'begin' || word === 'case' || word === 'try' || word === 'repeat' || word === 'record' || word === 'asm') {
          depth--;
          if (depth < 0) return false;
        } else if (word === 'then' && depth === 0) {
          return true;
        }
        continue;
      }
      i--;
    }
    return false;
  }

  // Checks if 'of' at position is from a type declaration (array of, set of, file of)
  private isTypeDeclarationOf(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i--;
    }
    if (i < 0) return false;
    if (this.isInExcludedRegion(i, excludedRegions)) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
      } else {
        i--;
      }
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
        i--;
      }
    }
    if (i < 0 || !/[a-zA-Z]/i.test(source[i])) return false;
    const wordEnd = i;
    while (i >= 0 && /[a-zA-Z0-9_]/i.test(source[i])) {
      i--;
    }
    const word = source.slice(i + 1, wordEnd + 1).toLowerCase();
    return word === 'array' || word === 'set' || word === 'file';
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

  // Checks if a class/interface keyword is a forward declaration (followed by ';', '(Parent);', or '[GUID];')
  private isForwardDeclarationAfter(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = pos;
    // Skip whitespace, newlines, and excluded regions (comments)
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
        j++;
        continue;
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    if (j >= source.length) return false;
    // class; or interface;
    if (source[j] === ';') return true;
    // class(TBase); or interface(IBase); or class(TBase, IFace);
    if (source[j] === '(') {
      let depth = 1;
      j++;
      while (j < source.length && depth > 0) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
        }
        if (source[j] === '(') depth++;
        else if (source[j] === ')') depth--;
        j++;
      }
      // Skip whitespace, newlines, and excluded regions after closing paren
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
          j++;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
          j++;
          continue;
        }
        break;
      }
      if (j < source.length && source[j] === ';') return true;
    }
    // interface['{GUID}']; (Delphi GUID bracket syntax)
    if (source[j] === '[') {
      let depth = 1;
      j++;
      while (j < source.length && depth > 0) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
        }
        if (source[j] === '[') depth++;
        else if (source[j] === ']') depth--;
        j++;
      }
      // Skip whitespace, newlines, and excluded regions after closing bracket
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
          j++;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
          j++;
          continue;
        }
        break;
      }
      if (j < source.length && source[j] === ';') return true;
    }
    return false;
  }
}
