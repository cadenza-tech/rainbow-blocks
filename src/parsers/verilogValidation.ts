// Verilog block validation helpers for isValidBlockOpen/isValidBlockClose checks

import type { ExcludedRegion, LanguageKeywords } from '../types';
import type { BracketIndex } from './bracketIndex';
import { trySkipLabel } from './verilogHelpers';

// Callbacks for base parser methods needed by validation functions
export interface VerilogValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Assertion verb keywords that can precede 'property' or 'sequence'
const ASSERTION_VERBS = ['assert', 'assume', 'cover', 'expect', 'restrict'];

// Qualifier keywords that can appear between 'extern' and the target keyword.
// Note: 'const' and 'pure' cannot precede `extern function`/`extern task` per
// IEEE 1800-2017 grammar (LRM A.1.6 / A.2.6), so they are not included here.
const QUALIFIER_KEYWORDS = new Set(['protected', 'local', 'static', 'automatic', 'virtual', 'forkjoin']);

// Modifier keywords that indicate non-block usage per keyword
const MODIFIER_MAP: Readonly<Record<string, readonly string[]>> = {
  class: ['typedef', 'extern'],
  interface: ['extern'],
  function: ['extern'],
  task: ['extern'],
  module: ['extern'],
  macromodule: ['extern'],
  program: ['extern']
};

// Validates 'wait': rejects `wait fork;` statement (SystemVerilog statement that
// blocks until all forked processes complete; not a control-keyword that opens a
// begin block). The `wait` keyword in `wait fork;` must NOT trigger CONTROL_KEYWORD
// chain consumption, otherwise it falsely pairs with a subsequent `end`.
// Returns true when this `wait` should be treated as a valid block-opener (i.e.,
// it is NOT the `wait fork;` form), false when it should be rejected.
export function isValidWaitOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  // Scan forward past 'wait' to detect `fork ;` form.
  let i = position + 4; // length of 'wait'
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    // Skip excluded regions (comments)
    let inExcluded = false;
    for (const region of excludedRegions) {
      if (i >= region.start && i < region.end) {
        i = region.end;
        inExcluded = true;
        break;
      }
    }
    if (inExcluded) continue;
    break;
  }
  // Check 'fork' as the next token
  if (source.slice(i, i + 4) !== 'fork') return true;
  const afterFork = i + 4;
  if (afterFork < source.length && /[a-zA-Z0-9_$]/.test(source[afterFork])) return true;
  // Skip whitespace/comments after 'fork'
  let j = afterFork;
  while (j < source.length) {
    const ch = source[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      j++;
      continue;
    }
    let inExcluded = false;
    for (const region of excludedRegions) {
      if (j >= region.start && j < region.end) {
        j = region.end;
        inExcluded = true;
        break;
      }
    }
    if (inExcluded) continue;
    break;
  }
  // `wait fork;` is the rejected form
  if (j < source.length && source[j] === ';') return false;
  return true;
}

// Validates 'fork': rejects 'disable fork' and 'wait fork' statements
export function isValidForkOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let j = position - 1;
  while (j >= 0) {
    // Treat newlines as whitespace (SystemVerilog free-form: a newline between
    // `disable`/`wait` and `fork` is equivalent to a space, so `disable\nfork`
    // is the same statement as `disable fork`). This mirrors the forward scan in
    // isValidWaitOpen, which already skips newlines after `fork`.
    if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
      j--;
      continue;
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
    // Skip '#<digits>' delay qualifier (e.g., #0, # 5 with optional whitespace/comments)
    if (j >= 0 && /[0-9]/.test(source[j])) {
      let k = j;
      while (k >= 0 && /[0-9]/.test(source[k])) {
        k--;
      }
      // Allow whitespace/comments between `#` and the digits
      const beforeDigits = skipBackwardWhitespaceAndComments(source, k, excludedRegions, callbacks);
      if (beforeDigits >= 0 && source[beforeDigits] === '#') {
        j = skipBackwardWhitespaceAndComments(source, beforeDigits - 1, excludedRegions, callbacks);
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

// Information about the word that precedes a label colon: the word text and the
// offset where it starts. Returned by getPrecedingLabelColonWord when `position`
// is immediately preceded by a single `:` (a label colon).
export interface LabelColonWord {
  word: string;
  wordStart: number;
}

// When `position` is immediately preceded by a label colon (`<word> : keyword`),
// returns the preceding word and its start offset; otherwise returns null.
// Rejects scope-resolution `::` and colons inside excluded regions.
export function getPrecedingLabelColonWord(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): LabelColonWord | null {
  let j = position - 1;
  // Skip whitespace including newlines (label name and `:` may span lines)
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j--;
  }
  if (j < 0 || source[j] !== ':') return null;
  if (j > 0 && source[j - 1] === ':') return null;
  if (callbacks.isInExcludedRegion(j, excludedRegions)) return null;
  let k = j - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r')) {
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
  if (k < 0) return null;
  const wordEnd = k;
  while (k >= 0 && /[a-zA-Z0-9_]/.test(source[k])) {
    k--;
  }
  if (wordEnd > k) {
    return { word: source.slice(k + 1, wordEnd + 1), wordStart: k + 1 };
  }
  return null;
}

// Returns true if keyword at position is preceded by a label colon (e.g., begin : module, end : end)
export function isPrecededByLabelColon(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  keywords: LanguageKeywords,
  callbacks: VerilogValidationCallbacks
): boolean {
  const labelWord = getPrecedingLabelColonWord(source, position, excludedRegions, callbacks);
  if (labelWord === null) return false;
  const allKeywords = new Set([...keywords.blockOpen, ...keywords.blockClose]);
  return allKeywords.has(labelWord.word);
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

// Returns true if function/task at position is on a DPI import/export statement
// (e.g., import "DPI-C" function void f(); or export "DPI-C" task t;).
// Looks back to the start of the current statement (after the last unquoted semicolon)
// so that multi-line DPI declarations (`import "DPI-C"\n  function void f();`) are
// recognised. Strips leading attributes/block comments from the statement prefix.
export function isOnDpiLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  // Find statement start: position after the most recent unquoted semicolon.
  let stmtStart = 0;
  for (let i = position - 1; i >= 0; i--) {
    let inExcluded = false;
    for (const region of excludedRegions) {
      if (i >= region.start && i < region.end) {
        inExcluded = true;
        break;
      }
    }
    if (inExcluded) continue;
    if (source[i] === ';') {
      stmtStart = i + 1;
      break;
    }
  }
  let i = stmtStart;
  while (i < position) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
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
  return /^(?:import|export)\s+"DPI[^"]*"/.test(lineBeforeKeyword);
}

// Returns true if position is inside a properly closed pair of parentheses
// (e.g., a port list `(...)`). An unclosed `(` before `position` is incomplete
// syntax (the user is still typing) and must NOT suppress later keywords: it
// would otherwise treat every following construct as part of a port list. Only
// when the innermost enclosing `(` is actually closed by a matching `)` after
// `position` is `position` considered to be inside parentheses.
//
// `parenIndex` must be a `(`-only BracketIndex. The enclosing `(` is found in
// O(log n); an unclosed `(` reports `close === -1`, which the strict `> position`
// predicate rejects (`-1 > position` is false) — load-bearing: that `-1` is how a
// still-being-typed unclosed paren is excluded.
//
// The predicate is strict (`>`) by design. The enclosing-span lookup never
// returns a span whose close is the keyword's own offset, because the sole
// caller passes `position` = the start offset of the `interface` keyword and a
// `)` cannot share that offset; so `> position` and `>= position` are identical
// here, and the strict form mirrors the intent ("closed strictly after the
// keyword"). The legacy forward scan started at `position` and would also count
// a `)` exactly at `position`, but that case is unreachable from this caller.
export function isInsideParens(position: number, parenIndex: BracketIndex): boolean {
  const span = parenIndex.enclosing(position);
  return span !== null && span.close > position;
}

// case-statement openers. Used to decide whether a label colon belongs to a
// case_item (whose label name may be a reserved word).
const CASE_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['case', 'casex', 'casez', 'randcase']);

// Scans backward from `fromPos` to find the nearest enclosing unclosed block
// opener and returns true when it is a case-statement (case/casex/casez/randcase).
// Each block-close keyword increments a depth counter; each block-open keyword
// either decrements it (closing an inner block) or, at depth 0, is the enclosing
// opener. Reserved-word keywords used as label names are rare enough that the
// approximate scan is acceptable; an incorrect result only falls back to the
// existing label-colon suppression behavior.
export function isEnclosingBlockCase(
  source: string,
  fromPos: number,
  excludedRegions: ExcludedRegion[],
  keywords: LanguageKeywords,
  callbacks: VerilogValidationCallbacks
): boolean {
  const openSet = new Set(keywords.blockOpen);
  const closeSet = new Set(keywords.blockClose);
  let depth = 0;
  let i = fromPos;
  while (i >= 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      i = region ? region.start - 1 : i - 1;
      continue;
    }
    if (!/[a-zA-Z0-9_]/.test(source[i])) {
      i--;
      continue;
    }
    // Collect the identifier word ending at i
    let wordStart = i;
    while (wordStart >= 0 && /[a-zA-Z0-9_]/.test(source[wordStart])) {
      wordStart--;
    }
    // Reject identifier chunks touching `$` or `\` (system tasks / escaped identifiers)
    const boundaryChar = wordStart >= 0 ? source[wordStart] : '';
    const word = source.slice(wordStart + 1, i + 1);
    if (boundaryChar !== '$' && boundaryChar !== '\\') {
      if (closeSet.has(word)) {
        depth++;
      } else if (openSet.has(word)) {
        if (depth === 0) {
          return CASE_OPEN_KEYWORDS.has(word);
        }
        depth--;
      }
    }
    i = wordStart;
  }
  return false;
}

// Returns true when the keyword at `position` is immediately preceded (skipping
// whitespace and comments) by an assignment operator: `=`, `<=` (non-blocking),
// or a compound assignment (`+=`, `-=`, `<<=`, ...). Comparison operators (`==`,
// `!=`, `>=`, `===`, ...) are NOT treated as assignment operators.
// A case-statement keyword (`case`/`casex`/`casez`/`randcase`) can only appear at
// statement position, never as an expression operand, so a preceding assignment
// operator means the keyword is being misused as an identifier.
export function isPrecededByAssignmentOperator(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  const eqPos = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  if (eqPos < 0 || source[eqPos] !== '=') return false;
  const prev = eqPos > 0 ? source[eqPos - 1] : '';
  // `==`, `!=`, `>=`, `===`, `!==`, `==?`, `!=?` are comparisons, not assignments.
  if (prev === '=' || prev === '!' || prev === '>') return false;
  // `<=` (non-blocking / shift assignment), `+=`, `-=`, `*=`, `/=`, `%=`, `&=`,
  // `|=`, `^=` and the bare `=` are all assignment operators.
  return true;
}

// Trailing characters of a binary/comparison/arithmetic/bitwise/logical operator
// that can sit on the operator's right-hand side. A case-statement keyword can
// only appear at statement position, never as an expression operand, so when one
// of these characters immediately precedes a case keyword (skipping whitespace and
// comments) the keyword is being misused as an identifier inside an expression
// (e.g., `x == casez`, `a + casex`, `b & casez`).
// `:` and `,` are excluded: a `:` may be a case_item label colon (`0: casez`) and
// a `,` a list separator; both are handled by other suppression paths.
const OPERATOR_TAIL_CHARS = new Set(['=', '<', '>', '!', '+', '-', '*', '/', '%', '&', '|', '^', '~', '?']);

// Returns true when the keyword at `position` is immediately preceded (skipping
// whitespace and comments) by a character that terminates a binary operator
// (comparison, arithmetic, bitwise, or logical). Used to reject case-statement
// keywords (`case`/`casex`/`casez`/`randcase`) misused as expression operands,
// e.g. `if (x == casez)`. This generalizes the assignment-operator suppression:
// a case keyword never appears as an operand, so any preceding operator means it
// is being used as an identifier.
export function isPrecededByBinaryOperator(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  const opPos = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  if (opPos < 0) return false;
  if (callbacks.isInExcludedRegion(opPos, excludedRegions)) return false;
  return OPERATOR_TAIL_CHARS.has(source[opPos]);
}

// Control keywords that take a parenthesized header `(condition)` immediately
// followed by their single-statement body. When a `default` keyword sits right
// after such a header's closing `)`, it is inside that single statement body,
// not at a case_item position — e.g. `if (c) default: x = 1;`.
const PAREN_HEADER_CONTROL_KEYWORDS: ReadonlySet<string> = new Set(['if', 'for', 'while', 'foreach', 'repeat']);

// Returns true when the `default` keyword at `position` is the single-statement
// body of a parenthesized-header control statement (if/for/while/foreach/repeat).
// Detection: the nearest non-trivia char before `position` is `)`, that `)`
// matches an earlier `(`, and the word immediately before that `(` is one of the
// paren-header control keywords. In that situation `default` is a misused
// identifier-like token inside the control body, not a case_item label, so it
// must not be tokenized as a case `block_middle`.
// A case statement's own header `case (expr) default: ...` is intentionally NOT
// matched because the word before `(` is `case`/`casex`/`casez`/`randcase`,
// which is excluded from PAREN_HEADER_CONTROL_KEYWORDS.
export function isInsideParenHeaderControlBody(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VerilogValidationCallbacks
): boolean {
  const closeParenPos = skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions, callbacks);
  if (closeParenPos < 0 || source[closeParenPos] !== ')') return false;
  if (callbacks.isInExcludedRegion(closeParenPos, excludedRegions)) return false;
  // Walk back from the `)` to its matching `(`, tracking nested parens and
  // skipping excluded regions (comments/strings) so parens inside them are ignored.
  let depth = 1;
  let i = closeParenPos - 1;
  while (i >= 0 && depth > 0) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      i = region ? region.start - 1 : i - 1;
      continue;
    }
    if (source[i] === ')') depth++;
    else if (source[i] === '(') depth--;
    if (depth > 0) i--;
  }
  if (depth !== 0 || i < 0) return false;
  // i points at the matching `(`; find the word immediately before it.
  let w = skipBackwardWhitespaceAndComments(source, i - 1, excludedRegions, callbacks);
  if (w < 0 || !/[a-zA-Z0-9_]/.test(source[w])) return false;
  const wordEnd = w;
  while (w >= 0 && /[a-zA-Z0-9_]/.test(source[w])) w--;
  // Reject when the word boundary touches `$` (system tasks) or `\` (escaped id).
  if (w >= 0 && (source[w] === '$' || source[w] === '\\')) return false;
  const word = source.slice(w + 1, wordEnd + 1);
  return PAREN_HEADER_CONTROL_KEYWORDS.has(word);
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

    // Skip SystemVerilog violation/check qualifiers that legitimately appear between a
    // control keyword and the case/if statement: `unique`, `unique0`, `priority`.
    // (LRM IEEE 1800-2017 §12.4 / §12.5)
    for (const qualifier of ['unique0', 'unique', 'priority']) {
      if (source.slice(i, i + qualifier.length) === qualifier) {
        const after = source[i + qualifier.length];
        if (after === undefined || !/[a-zA-Z0-9_$]/.test(after)) {
          i += qualifier.length;
          isControlKw = true;
          break;
        }
      }
    }
    if (isControlKw) {
      continue;
    }

    // Check for `case` keyword (case_statement is a valid statement body for control
    // keywords like always/initial/if). Continue scanning so the trailing endcase can
    // chain-consume back to the control keyword.
    for (const caseKw of ['casez', 'casex', 'case']) {
      if (source.slice(i, i + caseKw.length) === caseKw) {
        const after = source[i + caseKw.length];
        if (after === undefined || !/[a-zA-Z0-9_$]/.test(after)) {
          return true;
        }
      }
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
        // skip whitespace + one identifier argument.
        // Per IEEE 1800-2017 §22, preprocessor directives are case-sensitive (lowercase only),
        // so uppercase macro names like `IFDEF must NOT be treated as directives.
        if (/^(ifdef|ifndef|elsif)$/.test(directive)) {
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
// Iterates over arithmetic operator chains (`a + b * c`) instead of recursing per
// operator. A long delay like `#1+1+1+...` previously recursed once per operator
// and overflowed the call stack (JS does not tail-call optimize); the loop keeps
// stack usage constant for any expression length while producing the same result.
export function skipDelayExpression(source: string, pos: number, excludedRegions: ExcludedRegion[], callbacks: VerilogValidationCallbacks): number {
  let i = pos;
  while (true) {
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
        i = op + 1;
        continue;
      }
      return i;
    }
    // Handle unsized base-specifier literals: '[s/S][base]digits (e.g., 'd5, 'hFF)
    // and bare tick fill literals: '0, '1, 'x, 'X, 'z, 'Z
    if (i < source.length && source[i] === "'") {
      const next = i + 1 < source.length ? source[i + 1] : '';
      if (/[sS]/.test(next) || /[bBoOdDhH]/.test(next)) {
        return skipBaseSpecifierSuffix(source, i);
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
        i = op + 1;
        continue;
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
        i = op + 1;
        continue;
      }
      return i;
    }
    return i;
  }
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
