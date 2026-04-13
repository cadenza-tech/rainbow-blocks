// Verilog block validation helpers for isValidBlockOpen/isValidBlockClose checks

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { trySkipLabel } from './verilogHelpers';

// Callbacks for base parser methods needed by validation functions
export interface VerilogValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Assertion verb keywords that can precede 'property' or 'sequence'
const ASSERTION_VERBS = ['assert', 'assume', 'cover', 'expect', 'restrict'];

// Qualifier keywords that can appear between 'extern' and the target keyword
const QUALIFIER_KEYWORDS = new Set(['protected', 'local', 'static', 'virtual', 'forkjoin']);

// Modifier keywords that indicate non-block usage per keyword
const MODIFIER_MAP: Readonly<Record<string, readonly string[]>> = {
  class: ['typedef', 'extern'],
  interface: ['extern'],
  function: ['extern'],
  task: ['extern'],
  module: ['extern'],
  program: ['extern']
};

// Validates 'fork': rejects 'disable fork' and 'wait fork' statements
export function isValidForkOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let j = position - 1;
  while (j >= 0) {
    if (source[j] === ' ' || source[j] === '\t') {
      j--;
      continue;
    }
    // Stop at line boundaries so we don't cross lines
    if (source[j] === '\n' || source[j] === '\r') {
      break;
    }
    // Skip over excluded regions (comments)
    let inExcluded = false;
    for (const region of excludedRegions) {
      if (j >= region.start && j < region.end) {
        j = region.start - 1;
        inExcluded = true;
        break;
      }
    }
    if (inExcluded) continue;
    break;
  }
  // Check 'disable' (7 chars): ensure it's a word boundary before it
  if (j >= 6 && source.slice(j - 6, j + 1) === 'disable') {
    const beforeDisable = j - 7;
    if (beforeDisable < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeDisable])) {
      return false;
    }
  }
  // Check 'wait' (4 chars): ensure it's a word boundary before it
  if (j >= 3 && source.slice(j - 3, j + 1) === 'wait') {
    const beforeWait = j - 4;
    if (beforeWait < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeWait])) {
      return false;
    }
  }
  return true;
}

// Returns true if 'property' or 'sequence' at the given position is preceded by an assertion verb
// (assert, assume, cover, expect, restrict) with whitespace or comments between them.
// Handles assertion qualifiers like 'final' and '#0' that may appear between the verb and keyword
export function isPrecededByAssertionVerb(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  let j = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  // Skip assertion qualifiers: 'final' and '#<digits>' (e.g., #0)
  // These can appear in any combination between the verb and property/sequence
  let skipped = true;
  while (skipped) {
    skipped = false;
    // Skip 'final' qualifier
    if (j >= 4 && source.slice(j - 4, j + 1) === 'final') {
      const beforeFinal = j - 5;
      if (beforeFinal < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeFinal])) {
        j = skipBackwardWhitespaceAndComments(source, j - 5, excludedRegions, callbacks);
        skipped = true;
        continue;
      }
    }
    // Skip '#<digits>' delay qualifier (e.g., #0)
    if (j >= 0 && /[0-9]/.test(source[j])) {
      let k = j;
      while (k >= 0 && /[0-9]/.test(source[k])) {
        k--;
      }
      if (k >= 0 && source[k] === '#') {
        j = skipBackwardWhitespaceAndComments(source, k - 1, excludedRegions, callbacks);
        skipped = true;
      }
    }
  }
  for (const verb of ASSERTION_VERBS) {
    const verbStart = j - verb.length + 1;
    if (verbStart >= 0 && source.slice(verbStart, j + 1) === verb) {
      if (verbStart === 0 || !/[a-zA-Z0-9_$]/.test(source[verbStart - 1])) {
        if (!callbacks.isInExcludedRegion(verbStart, excludedRegions)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Skips backward over whitespace and excluded regions (comments), returning the new position
export function skipBackwardWhitespaceAndComments(
  source: string,
  startPos: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): number {
  let pos = startPos;
  while (pos >= 0 && (source[pos] === ' ' || source[pos] === '\t' || source[pos] === '\n' || source[pos] === '\r')) {
    pos--;
  }
  while (pos >= 0 && callbacks.isInExcludedRegion(pos, excludedRegions)) {
    const region = callbacks.findExcludedRegionAt(pos, excludedRegions);
    if (region) {
      pos = region.start - 1;
      while (pos >= 0 && (source[pos] === ' ' || source[pos] === '\t' || source[pos] === '\n' || source[pos] === '\r')) {
        pos--;
      }
    } else {
      pos--;
    }
  }
  return pos;
}

// Returns true if keyword at position is preceded by a label colon (e.g., begin : module, end : end)
export function isPrecededByLabelColon(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  keywords: LanguageKeywords,
  callbacks: VerilogValidationCallbacks
): boolean {
  let j = position - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j < 0 || source[j] !== ':') return false;
  if (j > 0 && source[j - 1] === ':') return false;
  if (callbacks.isInExcludedRegion(j, excludedRegions)) return false;
  let k = j - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
    k--;
  }
  while (k >= 0 && callbacks.isInExcludedRegion(k, excludedRegions)) {
    const region = callbacks.findExcludedRegionAt(k, excludedRegions);
    if (region) {
      k = region.start - 1;
      // After skipping a block comment, skip whitespace before it
      // But not after escaped identifiers (\name) which are word-like excluded regions
      if (source[region.start] !== '\\') {
        while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
          k--;
        }
      }
    } else {
      k--;
    }
  }
  if (k < 0) return false;
  const wordEnd = k;
  while (k >= 0 && /[a-zA-Z0-9_]/.test(source[k])) {
    k--;
  }
  if (wordEnd > k) {
    const word = source.slice(k + 1, wordEnd + 1);
    const allKeywords = new Set([...keywords.blockOpen, ...keywords.blockClose]);
    return allKeywords.has(word);
  }
  return false;
}

// Returns true if keyword is preceded by a modifier keyword that indicates a non-block usage
// (e.g., extern module/function/task, typedef class, pure virtual function/task)
export function isPrecededByModifierKeyword(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  const validModifiers = MODIFIER_MAP[keyword];

  let j = position - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j--;
  }
  // Skip over excluded regions (comments, strings) between modifier and keyword
  while (j >= 0 && callbacks.isInExcludedRegion(j, excludedRegions)) {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      j = region.start - 1;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
    } else {
      j--;
    }
  }
  if (j < 0) return false;
  const wordEnd = j;
  while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
    j--;
  }
  if (wordEnd === j) return false;
  const word = source.slice(j + 1, wordEnd + 1);

  // For function/task: "pure virtual function/task" has no body, but "virtual function/task" does
  // Also check for "extern [qualifiers] virtual function/task"
  if (word === 'virtual' && (keyword === 'function' || keyword === 'task')) {
    if (isPrecededByWord(source, j, 'pure', excludedRegions, callbacks)) {
      return true;
    }
    if (isPrecededByWord(source, j, 'extern', excludedRegions, callbacks)) {
      return true;
    }
    // Check for "extern qualifier virtual function/task" (e.g., extern local virtual function)
    if (validModifiers?.includes('extern')) {
      if (isPrecededByExternThroughQualifiers(source, j, excludedRegions, callbacks)) {
        return true;
      }
    }
    return false;
  }

  // Check for 'virtual interface' (variable type declaration, not a block)
  if (word === 'virtual' && keyword === 'interface') {
    if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
      return true;
    }
  }

  // Check for qualifiers between extern and keyword (e.g., extern protected static function)
  // Iteratively scan backward through all qualifiers to reach extern
  if (QUALIFIER_KEYWORDS.has(word) && validModifiers?.includes('extern')) {
    if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
      if (isPrecededByWord(source, j, 'extern', excludedRegions, callbacks)) {
        return true;
      }
      // Check through additional qualifiers (e.g., extern protected static function)
      if (isPrecededByExternThroughQualifiers(source, j, excludedRegions, callbacks)) {
        return true;
      }
    }
  }

  if (validModifiers?.includes(word)) {
    if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
      return true;
    }
  }
  return false;
}

// Returns true if the position is preceded (skipping whitespace and excluded regions) by the given word with a word boundary
export function isPrecededByWord(
  source: string,
  pos: number,
  targetWord: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  let j = pos;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j--;
  }
  while (j >= 0 && callbacks.isInExcludedRegion(j, excludedRegions)) {
    const region = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (region) {
      j = region.start - 1;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
    } else {
      j--;
    }
  }
  if (j < 0) return false;
  const wordEnd = j;
  while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
    j--;
  }
  if (wordEnd === j) return false;
  const word = source.slice(j + 1, wordEnd + 1);
  if (word === targetWord) {
    return j < 0 || !/[a-zA-Z0-9_$]/.test(source[j]);
  }
  return false;
}

// Iteratively scans backward through qualifier keywords to find 'extern'
export function isPrecededByExternThroughQualifiers(
  source: string,
  pos: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  let j = pos;
  for (let depth = 0; depth < 5; depth++) {
    // Skip whitespace and excluded regions
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    while (j >= 0 && callbacks.isInExcludedRegion(j, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.start - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
          j--;
        }
      } else {
        j--;
      }
    }
    if (j < 0) return false;
    const wordEnd = j;
    while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
      j--;
    }
    if (wordEnd === j) return false;
    const word = source.slice(j + 1, wordEnd + 1);
    if (word === 'extern') {
      return j < 0 || !/[a-zA-Z0-9_$]/.test(source[j]);
    }
    if (!QUALIFIER_KEYWORDS.has(word)) return false;
    if (j >= 0 && /[a-zA-Z0-9_$]/.test(source[j])) return false;
  }
  return false;
}

// Returns true if the position is followed (after whitespace, comments, attributes)
// by targetWord as a complete word. Used to detect "interface class" (SV-2012+)
// where "interface" qualifies "class" rather than opening an interface block.
export function isFollowedByWord(
  source: string,
  pos: number,
  targetWord: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  let j = pos;
  while (j < source.length) {
    const ch = source[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      j++;
      continue;
    }
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.end;
        continue;
      }
      j++;
      continue;
    }
    break;
  }
  if (!source.startsWith(targetWord, j)) return false;
  const after = j + targetWord.length;
  if (after < source.length && /[a-zA-Z0-9_$]/.test(source[after])) return false;
  return true;
}

// Returns true if function/task at position is on a DPI import/export line
// (e.g., import "DPI-C" function void f(); or export "DPI-C" task t;)
// Strips leading attributes (* ... *) and block comments /* ... */ from the
// line prefix so DPI is still detected after attribute/comment decoration.
export function isOnDpiLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  let i = lineStart;
  while (i < position) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    // Skip attribute (* ... *) or block comment /* ... */ starting at i
    let skipped = false;
    for (const region of excludedRegions) {
      if (region.start === i && region.end <= position) {
        i = region.end;
        skipped = true;
        break;
      }
    }
    if (skipped) continue;
    break;
  }
  const lineBeforeKeyword = source.slice(i, position);
  return /^\s*(?:import|export)\s+"DPI/.test(lineBeforeKeyword);
}

// Returns true if position is inside unmatched parentheses (e.g., port list)
export function isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VerilogValidationCallbacks): boolean {
  let depth = 0;
  for (let i = 0; i < position; i++) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      if (depth > 0) depth--;
    }
  }
  return depth > 0;
}

// Scans forward from a control keyword to find 'begin' before any statement terminator
export function scanForBeginAfterControl(
  source: string,
  startPos: number,
  excludedRegions: ExcludedRegion[],
  controlKeywords: readonly string[],
  callbacks: VerilogValidationCallbacks
): boolean {
  let i = startPos;
  while (i < source.length) {
    // Skip whitespace
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }

    // Skip excluded regions (e.g., escaped identifiers \name)
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      i++;
      continue;
    }

    // Check for 'begin'
    if (source.slice(i, i + 5) === 'begin') {
      const afterBegin = source[i + 5];
      if (afterBegin === undefined || !/[a-zA-Z0-9_$]/.test(afterBegin)) {
        return true;
      }
    }

    // Check for 'fork' (par_block body, same role as begin/end but fork/join)
    if (source.slice(i, i + 4) === 'fork') {
      const afterFork = source[i + 4];
      if (afterFork === undefined || !/[a-zA-Z0-9_$]/.test(afterFork)) {
        return true;
      }
    }

    // Check for another control keyword (e.g., "always @(...) if (...) begin")
    // Continue scanning past chained control keywords instead of early return
    let isControlKw = false;
    for (const ck of controlKeywords) {
      if (source.slice(i, i + ck.length) === ck) {
        const afterCk = source[i + ck.length];
        if (afterCk === undefined || !/[a-zA-Z0-9_$]/.test(afterCk)) {
          i += ck.length;
          isControlKw = true;
          break;
        }
      }
    }
    if (isControlKw) {
      continue;
    }

    // Check for sensitivity list @(...) and skip it
    if (source[i] === '@') {
      i = skipSensitivityList(source, i + 1, excludedRegions, callbacks);
      continue;
    }

    // Check for condition in parentheses and skip it
    if (source[i] === '(') {
      i = skipParenGroup(source, i, excludedRegions, callbacks);
      continue;
    }

    // Skip #delay: #number, #(expr), #identifier
    if (source[i] === '#') {
      i = skipDelayExpression(source, i + 1, excludedRegions, callbacks);
      continue;
    }

    // Skip label colon separator (e.g., after escaped identifier labels from excluded regions)
    // But not :: (scope resolution operator)
    if (source[i] === ':') {
      if (i + 1 < source.length && source[i + 1] === ':') {
        return false;
      }
      i++;
      continue;
    }

    // Skip labels: identifier followed by ':'
    // Support both regular identifiers and escaped identifiers (\name)
    if (/[a-zA-Z_]/.test(source[i]) || source[i] === '\\') {
      const labelEnd = trySkipLabel(source, i, excludedRegions);
      if (labelEnd > i) {
        i = labelEnd;
        continue;
      }
    }

    // Skip backtick-prefixed preprocessor directives and macro invocations
    // (`ifdef, `endif, `include, `MY_MACRO, etc.)
    // Note: `define and `undef are excluded regions and handled above
    if (source[i] === '`') {
      let j = i + 1;
      while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) {
        j++;
      }
      if (j > i + 1) {
        const directive = source.slice(i + 1, j);
        // Directives with arguments (`ifdef, `ifndef, `elsif):
        // skip whitespace + one identifier argument
        if (/^(ifdef|ifndef|elsif)$/i.test(directive)) {
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
            j++;
          }
          while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) {
            j++;
          }
        }
        i = j;
        continue;
      }
    }

    // Any other non-whitespace, non-begin token means no begin follows
    return false;
  }

  return false;
}

// Skips a sensitivity list @(...) or @*
export function skipSensitivityList(source: string, pos: number, excludedRegions: ExcludedRegion[], callbacks: VerilogValidationCallbacks): number {
  let i = pos;
  // Skip whitespace
  while (i < source.length && /\s/.test(source[i])) i++;
  if (i < source.length && source[i] === '(') {
    return skipParenGroup(source, i, excludedRegions, callbacks);
  }
  if (i < source.length && source[i] === '*') {
    return i + 1;
  }
  // @identifier: single signal sensitivity (e.g., always @clk begin)
  if (i < source.length && /[a-zA-Z_]/.test(source[i])) {
    while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
    return i;
  }
  return i;
}

// Skips a parenthesized group, handling nested parens and excluded regions
export function skipParenGroup(source: string, pos: number, excludedRegions: ExcludedRegion[], callbacks: VerilogValidationCallbacks): number {
  let depth = 1;
  let i = pos + 1;
  while (i < source.length && depth > 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      i++;
      continue;
    }
    if (source[i] === '(') depth++;
    else if (source[i] === ')') depth--;
    i++;
  }
  return i;
}

// Skips a #delay expression: #number, #(expr), #identifier
export function skipDelayExpression(source: string, pos: number, excludedRegions: ExcludedRegion[], callbacks: VerilogValidationCallbacks): number {
  let i = pos;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (i < source.length && source[i] === '(') {
    return skipParenGroup(source, i, excludedRegions, callbacks);
  }
  if (i < source.length && /[0-9]/.test(source[i])) {
    while (i < source.length && /[0-9_.]/.test(source[i])) i++;
    // Handle base-specifier format: [size]'[s/S][base]digits (e.g., 32'd0, 8'hFF, 4'sb1010)
    if (i < source.length && source[i] === "'") {
      i = skipBaseSpecifierSuffix(source, i);
    }
    // Handle exponent notation (e.g., 1.5e-3, 2.0E+6)
    if (i < source.length && (source[i] === 'e' || source[i] === 'E')) {
      i++;
      if (i < source.length && (source[i] === '+' || source[i] === '-')) {
        i++;
      }
      while (i < source.length && /[0-9_]/.test(source[i])) i++;
    }
    // Skip time unit (e.g., ns, ps)
    while (i < source.length && /[a-zA-Z]/.test(source[i])) i++;
    // Skip arithmetic operators (allowing leading whitespace) and continue parsing
    let op = i;
    while (op < source.length && (source[op] === ' ' || source[op] === '\t')) op++;
    if (op < source.length && /[+\-*/%]/.test(source[op])) {
      return skipDelayExpression(source, op + 1, excludedRegions, callbacks);
    }
    return i;
  }
  // Handle unsized base-specifier literals: '[s/S][base]digits (e.g., 'd5, 'hFF)
  // and bare tick fill literals: '0, '1, 'x, 'X, 'z, 'Z
  if (i < source.length && source[i] === "'") {
    const next = i + 1 < source.length ? source[i + 1] : '';
    if (/[sS]/.test(next) || /[bBoOdDhH]/.test(next)) {
      i = skipBaseSpecifierSuffix(source, i);
      return i;
    }
    if (/[01xXzZ]/.test(next)) {
      return i + 2;
    }
  }
  if (i < source.length && /[a-zA-Z_]/.test(source[i])) {
    while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
    let op = i;
    while (op < source.length && (source[op] === ' ' || source[op] === '\t')) op++;
    if (op < source.length && /[+\-*/%]/.test(source[op])) {
      return skipDelayExpression(source, op + 1, excludedRegions, callbacks);
    }
    return i;
  }
  // Backtick-prefixed macro identifier: `MACRO_NAME or `(expr)
  if (i < source.length && source[i] === '`') {
    i++;
    if (i < source.length && source[i] === '(') {
      return skipParenGroup(source, i, excludedRegions, callbacks);
    }
    while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
    let op = i;
    while (op < source.length && (source[op] === ' ' || source[op] === '\t')) op++;
    if (op < source.length && /[+\-*/%]/.test(source[op])) {
      return skipDelayExpression(source, op + 1, excludedRegions, callbacks);
    }
    return i;
  }
  return i;
}

// Skips the tick and base-specifier portion of a Verilog number literal
// Handles '[s/S][base]digits where base is b/B/o/O/d/D/h/H
// Digits include hex digits (a-f, A-F), x, X, z, Z, ?, and _
export function skipBaseSpecifierSuffix(source: string, pos: number): number {
  let i = pos;
  // Skip the tick
  i++;
  // Skip optional signed indicator
  if (i < source.length && (source[i] === 's' || source[i] === 'S')) {
    i++;
  }
  // Skip base specifier
  if (i < source.length && /[bBoOdDhH]/.test(source[i])) {
    i++;
  }
  // Skip base digits (hex digits, x, z, ?, _)
  while (i < source.length && /[0-9a-fA-F_xXzZ?]/.test(source[i])) i++;
  return i;
}
