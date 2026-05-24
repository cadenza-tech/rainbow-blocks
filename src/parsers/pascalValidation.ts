// Pascal block validation helpers for isValidBlockOpen/tokenize keyword checks

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by validation functions
export interface PascalValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Type modifier keywords that can appear between '=' and class/object/interface
// 'partial' is the Delphi 2009+ partial-class modifier.
export const TYPE_MODIFIERS = ['abstract', 'sealed', 'packed', 'partial'];

// Keywords that, when seen scanning backward from `=`, prove the `=` is a comparison,
// not a type definition. Kept as a string set so both pascalParser.ts (the
// isValidBlockOpen scan) and pascalValidation.ts (the record-context scan) can use it.
export const COMPARISON_CONTEXT_KEYWORDS = new Set([
  'if',
  'while',
  'until',
  'then',
  'or',
  'and',
  'not',
  'xor',
  'else',
  'for',
  'in',
  'is',
  'as',
  'div',
  'mod',
  'shl',
  'shr',
  'try',
  'begin',
  'on',
  'repeat'
]);

// Statement-context scope keywords (cross-`;` scope decides comparison).
export const STATEMENT_CONTEXT_SCOPE_KEYWORDS = new Set(['begin', 'try', 'repeat', 'asm', 'do', 'then', 'else', 'finally', 'except']);

// Declaration-context scope keywords (cross-`;` scope decides type definition).
export const DECLARATION_CONTEXT_SCOPE_KEYWORDS = new Set(['type', 'var', 'const']);

// Returns true if the `=` that precedes the keyword at `keywordStart` (with optional
// type modifiers between) is a comparison operator, not a type definition. Implements
// the same scan as PascalBlockParser.isValidBlockOpen but as a standalone helper so
// the record-context keyword classifier can reuse the comparison check.
//
// Walks backward past whitespace and type modifiers; if the first significant character
// is not `=` (or it is `:=`), returns false. Otherwise scans backward from the `=` to a
// `;` or start-of-source, looking for COMPARISON_CONTEXT_KEYWORDS (=> comparison) or
// DECLARATION_CONTEXT_SCOPE_KEYWORDS (=> declaration). On `;` boundaries the scan
// continues across them using STATEMENT_CONTEXT_SCOPE_KEYWORDS / DECLARATION_CONTEXT_SCOPE_KEYWORDS
// to decide the enclosing scope, mirroring the pascalParser scan.
export function isPrecededByComparisonEquals(
  source: string,
  keywordStart: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  // Walk backward over whitespace/excluded regions and type modifiers to find the
  // significant character. Mirrors the modifier-skipping loop in pascalParser.
  let i = skipWsExcludedBackward(source, keywordStart - 1, excludedRegions, callbacks);
  let foundModifier = true;
  while (foundModifier) {
    foundModifier = false;
    for (const modifier of TYPE_MODIFIERS) {
      const len = modifier.length;
      if (i >= len - 1 && source.slice(i - len + 1, i + 1).toLowerCase() === modifier && (i < len || !/[a-zA-Z0-9_]/.test(source[i - len]))) {
        i = skipWsExcludedBackward(source, i - len, excludedRegions, callbacks);
        foundModifier = true;
        break;
      }
    }
  }
  // Must be '=' but not ':=' / '>=' / '<=' / '+=' / '-=' / '*=' / '/=' (compound ops).
  if (!(i >= 0 && source[i] === '=' && (i === 0 || ![':', '>', '<', '+', '-', '*', '/'].includes(source[i - 1])))) {
    return false;
  }

  // Scan backward from before the `=` to the statement boundary.
  let ci = i - 1;
  let hitSemicolon = false;
  let hitDeclarationKeyword = false;
  while (ci >= 0) {
    if (callbacks.isInExcludedRegion(ci, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(ci, excludedRegions);
      if (region) {
        ci = region.start - 1;
        continue;
      }
    }
    const ch = source[ci];
    if (ch === ';') {
      hitSemicolon = true;
      break;
    }
    // ':=' assignment operator: any later `=` is a comparison expression.
    if (ch === '=' && ci > 0 && source[ci - 1] === ':') {
      return true;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const wordEnd = ci;
      while (ci > 0 && /[a-zA-Z0-9_]/.test(source[ci - 1])) ci--;
      const word = source.slice(ci, wordEnd + 1).toLowerCase();
      if (COMPARISON_CONTEXT_KEYWORDS.has(word)) {
        return true;
      }
      if (DECLARATION_CONTEXT_SCOPE_KEYWORDS.has(word)) {
        hitDeclarationKeyword = true;
        break;
      }
    }
    ci--;
  }

  // Cross-`;` scope scan: if we hit `;` first, the enclosing scope decides.
  if (hitSemicolon && !hitDeclarationKeyword) {
    let si = ci - 1;
    while (si >= 0) {
      if (callbacks.isInExcludedRegion(si, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(si, excludedRegions);
        if (region) {
          si = region.start - 1;
          continue;
        }
      }
      const ch = source[si];
      if (/[a-zA-Z_]/.test(ch)) {
        const wordEnd = si;
        while (si > 0 && /[a-zA-Z0-9_]/.test(source[si - 1])) si--;
        const word = source.slice(si, wordEnd + 1).toLowerCase();
        if (STATEMENT_CONTEXT_SCOPE_KEYWORDS.has(word)) {
          return true;
        }
        if (DECLARATION_CONTEXT_SCOPE_KEYWORDS.has(word)) {
          return false;
        }
      }
      si--;
    }
  }
  return false;
}

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

// Skips whitespace, newlines, and excluded regions backward from `start` (inclusive).
// Returns the index of the first significant character, or -1 if none.
function skipWsExcludedBackward(source: string, start: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): number {
  let i = start;
  while (i >= 0) {
    if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
      i--;
      continue;
    }
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.start - 1;
      continue;
    }
    break;
  }
  return i;
}

// Skips whitespace, newlines, and excluded regions forward from `start` (inclusive).
// Returns the index of the first significant character, or source.length if none.
function skipWsExcludedForward(source: string, start: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): number {
  let i = start;
  while (i < source.length) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      i++;
      continue;
    }
    if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
      i++;
      continue;
    }
    break;
  }
  return i;
}

// Returns true when the keyword at `keywordStart` is preceded (past whitespace, newlines
// and excluded regions) by a `.` that is field-access, not a `..` range operator. Used
// to filter out member-access expressions like `Foo.record`/`Foo.object` so they do not
// pollute the record-context scan.
function isPrecededByFieldDotForRecordContext(
  source: string,
  keywordStart: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  const i = skipWsExcludedBackward(source, keywordStart - 1, excludedRegions, callbacks);
  if (i < 0 || source[i] !== '.') return false;
  // Distinguish field access (`Foo.record`) from a range operator (`..record`).
  return i === 0 || source[i - 1] !== '.';
}

// The structural role a block keyword plays for record-context tracking.
//  - 'open-record': record/object — an enclosing block of this kind means "inside a record"
//  - 'open-block': begin/class/interface/try/asm — a non-record block boundary
//  - 'close': end — closes the nearest block
//  - 'ignore': the keyword is not a block boundary here (forward decl, class-of, field type, etc.)
type RecordContextRole = 'open-record' | 'open-block' | 'close' | 'ignore';

// Classifies a block keyword occurrence for record-context tracking. This mirrors the
// per-keyword accept/reject logic that the record scan needs: 'class'/'object'/'interface'
// have several non-block uses (forward declarations, class-of references, field types,
// method modifiers) that must not count as block boundaries.
function recordContextKeywordRole(
  source: string,
  keywordStart: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): RecordContextRole {
  const lowerSource = source.toLowerCase();
  switch (keyword) {
    case 'end':
      return 'close';
    case 'begin':
    case 'try':
    case 'asm':
      return 'open-block';
    case 'record':
      // Skip 'record' used as field access (e.g. `Foo.record`). Without this guard, a
      // member-access expression spelled `.record` pushes 'record' on the context stack
      // and the following inner `end` pops it instead of the surrounding case block.
      if (isPrecededByFieldDotForRecordContext(source, keywordStart, excludedRegions, callbacks)) {
        return 'ignore';
      }
      return 'open-record';
    case 'object': {
      // Skip 'object' used as field access (e.g. `Foo.object`). Without this guard, a
      // member-access expression spelled `.object` pushes 'record' on the context stack
      // (object behaves like record for record-context tracking) and corrupts the
      // surrounding case..end pair.
      if (isPrecededByFieldDotForRecordContext(source, keywordStart, excludedRegions, callbacks)) {
        return 'ignore';
      }
      // Skip 'object' in method pointer syntax: `procedure of object`
      const oi = skipWsExcludedBackward(source, keywordStart - 1, excludedRegions, callbacks);
      if (oi >= 1 && lowerSource.slice(oi - 1, oi + 1) === 'of' && (oi - 2 < 0 || !/[a-zA-Z0-9_]/.test(source[oi - 2]))) {
        return 'ignore';
      }
      // Skip 'object' as field type reference (preceded by ':')
      if (oi >= 0 && source[oi] === ':') {
        return 'ignore';
      }
      // `=` followed by `object` can be either a type definition (`TFoo = object`) or
      // a comparison expression (`if X = object then`). Without the comparison check
      // the latter is classified as 'open-record' and a following inner `end` pops
      // the wrong stack entry.
      if (oi >= 0 && source[oi] === '=' && isPrecededByComparisonEquals(source, keywordStart, excludedRegions, callbacks)) {
        return 'ignore';
      }
      return 'open-record';
    }
    case 'interface': {
      const ii = skipWsExcludedBackward(source, keywordStart - 1, excludedRegions, callbacks);
      // Skip 'interface' as field type reference (preceded by ':')
      if (ii >= 0 && source[ii] === ':') {
        return 'ignore';
      }
      // Skip 'interface' as forward declaration (interface; or interface(IParent);)
      if (isForwardDeclarationAfter(source, keywordStart + 9, excludedRegions, callbacks)) {
        return 'ignore';
      }
      // `=` followed by `interface` can be either a type definition (`IFoo = interface`)
      // or a comparison expression (`if X = interface then`). Reuse the comparison-context
      // scan so the keyword is classified as 'ignore' for the latter.
      if (ii >= 0 && source[ii] === '=' && isPrecededByComparisonEquals(source, keywordStart, excludedRegions, callbacks)) {
        return 'ignore';
      }
      return 'open-block';
    }
    case 'class': {
      const ci = skipWsExcludedBackward(source, keywordStart - 1, excludedRegions, callbacks);
      // Skip 'class' as field type reference (preceded by ':')
      if (ci >= 0 && source[ci] === ':') {
        return 'ignore';
      }
      // Skip 'class' as forward declaration (class; or class(Parent);)
      if (isForwardDeclarationAfter(source, keywordStart + 5, excludedRegions, callbacks)) {
        return 'ignore';
      }
      // Skip 'class of' (class reference type, no matching end)
      {
        const ck = skipWsExcludedForward(source, keywordStart + 5, excludedRegions, callbacks);
        if (ck + 1 < source.length && lowerSource.slice(ck, ck + 2) === 'of' && (ck + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[ck + 2]))) {
          return 'ignore';
        }
      }
      // Check if preceded by '=' (type definition): skip method modifier check
      let eqCheck = ci;
      let foundModifier = true;
      while (foundModifier && eqCheck >= 0 && /[a-zA-Z]/.test(source[eqCheck])) {
        foundModifier = false;
        let wordStart = eqCheck;
        while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) wordStart--;
        const modWord = lowerSource.slice(wordStart, eqCheck + 1);
        if (TYPE_MODIFIERS.includes(modWord)) {
          foundModifier = true;
          eqCheck = wordStart - 1;
          while (eqCheck >= 0 && (source[eqCheck] === ' ' || source[eqCheck] === '\t' || source[eqCheck] === '\n' || source[eqCheck] === '\r'))
            eqCheck--;
        }
      }
      if (eqCheck >= 0 && source[eqCheck] === '=') {
        // `=` precedes class: this could be either a type definition (TFoo = class)
        // or a comparison expression (if X = class then). Only the former is a block
        // opener; for the latter the keyword is not a block boundary and must be
        // 'ignore' so the surrounding record-context scan is not corrupted.
        if (isPrecededByComparisonEquals(source, keywordStart, excludedRegions, callbacks)) {
          return 'ignore';
        }
      } else {
        // Skip 'class' as method modifier (followed by function, procedure, var, etc.)
        // Also handles `class const`, `class type`, `class threadvar` (Delphi/FreePascal
        // class-level declarations) so they are not classified as block openers.
        const cj = skipWsExcludedForward(source, keywordStart + 6, excludedRegions, callbacks);
        const afterClass = lowerSource.slice(cj, cj + 12);
        if (/^(function|procedure|var|property|constructor|destructor|operator|threadvar|type|const)\b/.test(afterClass)) {
          return 'ignore';
        }
      }
      return 'open-block';
    }
    default:
      return 'ignore';
  }
}

// Block keywords scanned for record-context tracking
const RECORD_CONTEXT_KEYWORD_PATTERN = /\b(begin|end|record|object|class|interface|try|asm|case)\b/gi;

// Builds a map from each `case` keyword start offset to whether that `case` sits inside a
// record block. This replaces per-`case` backward scans (which were O(N) each, O(N^2)
// overall) with a single forward sweep: a stack tracks enclosing block openers, and each
// `case` resolves "inside a record" by inspecting the nearest non-`case` enclosing block.
//
// `case` blocks are transparent for the record question (a `case` is never a record), but
// a standalone `case` still has a matching `end`, so it is pushed; a variant `case` has no
// own `end`, so it is not pushed.
export function buildRecordContextMap(source: string, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): Map<number, boolean> {
  const map = new Map<number, boolean>();
  // Stack of enclosing block kinds: 'record'/'object' count as record context,
  // 'block' is a non-record block, 'case' is transparent for the record question.
  const stack: ('record' | 'block' | 'case')[] = [];

  for (let match = RECORD_CONTEXT_KEYWORD_PATTERN.exec(source); match !== null; match = RECORD_CONTEXT_KEYWORD_PATTERN.exec(source)) {
    const keywordStart = match.index;
    if (callbacks.isInExcludedRegion(keywordStart, excludedRegions)) {
      continue;
    }
    const keyword = match[1].toLowerCase();

    if (keyword === 'case') {
      // The record question for this `case`: the nearest non-`case` enclosing block.
      let inRecord = false;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s] === 'case') continue;
        inRecord = stack[s] === 'record';
        break;
      }
      map.set(keywordStart, inRecord);
      // A standalone case has its own matching `end`; a variant case does not.
      if (!isVariantCase(source, keywordStart, excludedRegions, callbacks)) {
        stack.push('case');
      }
      continue;
    }

    const role = recordContextKeywordRole(source, keywordStart, keyword, excludedRegions, callbacks);
    if (role === 'close') {
      if (stack.length > 0) stack.pop();
    } else if (role === 'open-record') {
      stack.push('record');
    } else if (role === 'open-block') {
      stack.push('block');
    }
    // 'ignore' keywords are not block boundaries
  }

  return map;
}

// Skips a balanced parenthesized group starting at `openParen` (which must be a '(').
// Excluded regions (comments, strings) are skipped. Returns the index just past the
// matching ')', or source.length if the group is unterminated.
function skipParenGroup(source: string, openParen: number, excludedRegions: ExcludedRegion[], callbacks: PascalValidationCallbacks): number {
  let depth = 1;
  let i = openParen + 1;
  while (i < source.length && depth > 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
    i++;
  }
  return i;
}

// Checks if 'case' at position is a variant record case (tagged or tagless)
// `recordContextMap` (built once per parse) provides O(1) "inside a record" lookup.
export function isVariantRecordCase(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks,
  recordContextMap: Map<number, boolean>
): boolean {
  if (!recordContextMap.get(position)) {
    return false;
  }
  // Scan forward from after 'case', skipping whitespace and excluded regions, to the
  // selector tag.
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
  if (j >= source.length) {
    return false;
  }
  // Determine the end of the selector tag token. The tag is one of:
  //  - an identifier (possibly qualified, e.g. Types.MyEnum)
  //  - a parenthesized group: an anonymous ordinal type `(Foo, Bar)` (FreePascal) or a
  //    numeric-tag-with-no-name variant. Only inside a record, so a parenthesized
  //    selector expression of a standalone `case` is never reached here.
  //  - a numeric literal (digits, `$hex`, `#charcode`) used as a (malformed) tag
  let k: number;
  if (/[a-zA-Z_]/i.test(source[j])) {
    k = j;
    while (k < source.length && /[\w.]/i.test(source[k])) {
      k++;
    }
  } else if (source[j] === '(') {
    k = skipParenGroup(source, j, excludedRegions, callbacks);
  } else if (/[0-9$#]/.test(source[j])) {
    k = j;
    while (k < source.length && /[\w$#]/i.test(source[k])) {
      k++;
    }
  } else {
    return false;
  }
  // Skip whitespace and excluded regions after the tag token
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
  // Tagged variant: tag followed by ':' (the field-name-to-type colon).
  if (k < source.length && source[k] === ':') {
    return true;
  }
  // Tagless variant: tag followed by 'of'.
  if (k + 2 <= source.length && /^of\b/i.test(source.slice(k, k + 3))) {
    return true;
  }
  return false;
}

// Returns true when the parentheses opening at `openParen` enclose a variant-record field
// list rather than a parenthesized expression. A variant field list is either empty `()`
// or contains a field-declaration colon (a `:` that is not part of `:=`). A parenthesized
// expression — e.g. a malformed standalone case arm like `9: (HandleNine)` — contains no
// such colon, so it is rejected. Excluded regions (comments, strings) are skipped.
function parenBodyIsVariantFieldList(
  source: string,
  openParen: number,
  excludedRegions: ExcludedRegion[],
  callbacks: PascalValidationCallbacks
): boolean {
  let depth = 1;
  let i = openParen + 1;
  while (i < source.length) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        // Reached the matching ')' without finding a field-declaration colon: empty
        // body is a (valid) empty variant field list; a non-empty body is an expression.
        return isWhitespaceRun(source, openParen + 1, i);
      }
    } else if (ch === ':' && source[i + 1] !== '=') {
      // A field-declaration colon confirms a variant field list.
      return true;
    }
    i++;
  }
  return false;
}

// Returns true when source[start, end) contains only whitespace and newlines.
function isWhitespaceRun(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return false;
  }
  return true;
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
        return j < source.length && source[j] === '(' && parenBodyIsVariantFieldList(source, j, excludedRegions, callbacks);
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
        // '(' that opens a variant field list (not a parenthesized expression)
        return j < source.length && source[j] === '(' && parenBodyIsVariantFieldList(source, j, excludedRegions, callbacks);
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
  // `procedure of object`, `function of object` (Delphi method-pointer types) and
  // `class of TBase` (class-reference type) are type declarations whose `of` is part of
  // the type syntax, not a case-statement intermediate.
  return word === 'array' || word === 'set' || word === 'file' || word === 'procedure' || word === 'function' || word === 'class';
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
