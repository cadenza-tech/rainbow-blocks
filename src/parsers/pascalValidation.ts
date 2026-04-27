// Pascal block validation helpers for isValidBlockOpen/tokenize keyword checks

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by validation functions
export interface PascalValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Type modifier keywords that can appear between '=' and class/object/interface
export const TYPE_MODIFIERS = ['abstract', 'sealed', 'packed'];

// Checks if a position sits inside unbalanced parentheses (e.g. 'if (x = class)')
// Stops at ';' (statement terminator) or start of file.
export function isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): boolean {
  let parenDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === ')') {
      parenDepth++;
    } else if (ch === '(') {
      if (parenDepth > 0) {
        parenDepth--;
      } else {
        return true;
      }
    } else if (ch === ';' && parenDepth === 0) {
      return false;
    }
  }
  return false;
}

// Checks if 'case' at position is a variant record case (tagged or tagless)
export function isVariantRecordCase(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  if (!isInsideRecord(source, position, excludedRegions, callbacks)) {
    return false;
  }
  // Scan forward from after 'case', skipping whitespace and excluded regions, looking for identifier
  let j = position + 4; // skip 'case'
  while (j < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
      if (callbacks.isInExcludedRegion(k, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(k, excludedRegions);
        if (region) {
          k = region.end;
          continue;
        }
        k++;
        continue;
      }
      if (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r') {
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
export function isInsideRecord(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): boolean {
  const lowerSource = source.toLowerCase();
  let depth = 0;
  let i = position - 1;
  while (i >= 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
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
        const rgn = callbacks.findExcludedRegionAt(oi, excludedRegions);
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
        const rgn = callbacks.findExcludedRegionAt(ci, excludedRegions);
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
      if (isForwardDeclarationAfter(source, i + 1, excludedRegions, callbacks)) {
        i -= 5;
        continue;
      }
      // Skip 'class of' (class reference type, no matching end)
      // Newlines and comments between 'class' and 'of' do not change the meaning per Pascal grammar.
      {
        let ck = i + 1;
        while (ck < source.length) {
          if (source[ck] === ' ' || source[ck] === '\t' || source[ck] === '\n' || source[ck] === '\r') {
            ck++;
            continue;
          }
          if (callbacks.isInExcludedRegion(ck, excludedRegions)) {
            const rgn = callbacks.findExcludedRegionAt(ck, excludedRegions);
            if (rgn) {
              ck = rgn.end;
              continue;
            }
          }
          break;
        }
        if (ck + 1 < source.length && lowerSource.slice(ck, ck + 2) === 'of' && (ck + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[ck + 2]))) {
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
            if (callbacks.isInExcludedRegion(cj, excludedRegions)) {
              const region = callbacks.findExcludedRegionAt(cj, excludedRegions);
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
        const rgn = callbacks.findExcludedRegionAt(ii, excludedRegions);
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
      if (isForwardDeclarationAfter(source, i + 1, excludedRegions, callbacks)) {
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
      if (depth >= 1 && !isVariantCase(source, i - 3, excludedRegions, callbacks)) depth--;
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
export function isVariantCase(source: string, caseStart: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): boolean {
  const lowerSource = source.toLowerCase();
  // Find 'of' after 'case', skipping excluded regions and newlines
  let j = caseStart + 4;
  while (j + 1 < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
        const innerRegion = callbacks.findExcludedRegionAt(j, excludedRegions);
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

// Checks if 'else' at position is part of an if-then-else (not a case/try else)
// Scans backward tracking begin/end depth to find 'then' at the same nesting level
export function isIfThenElse(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): boolean {
  let depth = 0;
  let i = position - 1;
  while (i >= 0) {
    if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
      i--;
      continue;
    }
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
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
export function isTypeDeclarationOf(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  let i = position - 1;
  const skipWsAndComments = () => {
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i--;
    }
    while (i >= 0 && callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
      } else {
        i--;
      }
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
        i--;
      }
    }
  };
  skipWsAndComments();
  if (i < 0) return false;
  // Skip a bracketed dimension list: `array [0..N] of`, `array [TKind] of`
  if (source[i] === ']') {
    let depth = 1;
    i--;
    while (i >= 0 && depth > 0) {
      if (callbacks.isInExcludedRegion(i, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === ']') depth++;
      else if (source[i] === '[') depth--;
      i--;
    }
    skipWsAndComments();
  }
  if (i < 0 || !/[a-zA-Z]/i.test(source[i])) return false;
  let wordEnd = i;
  while (i >= 0 && /[a-zA-Z0-9_]/i.test(source[i])) {
    i--;
  }
  let word = source.slice(i + 1, wordEnd + 1).toLowerCase();
  // `array packed of` (FreePascal): skip past `packed` to find `array`
  if (word === 'packed') {
    skipWsAndComments();
    if (i < 0 || !/[a-zA-Z]/i.test(source[i])) return false;
    wordEnd = i;
    while (i >= 0 && /[a-zA-Z0-9_]/i.test(source[i])) {
      i--;
    }
    word = source.slice(i + 1, wordEnd + 1).toLowerCase();
  }
  return word === 'array' || word === 'set' || word === 'file';
}

// Checks if a class/interface keyword is a forward declaration (followed by ';', '(Parent);', or '[GUID];')
export function isForwardDeclarationAfter(
  source: string,
  pos: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  let j = pos;
  // Skip whitespace, newlines, and excluded regions (comments)
  while (j < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
      if (callbacks.isInExcludedRegion(j, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
      if (callbacks.isInExcludedRegion(j, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
      if (callbacks.isInExcludedRegion(j, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
      if (callbacks.isInExcludedRegion(j, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(j, excludedRegions);
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
