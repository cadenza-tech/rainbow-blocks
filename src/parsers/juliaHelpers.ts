// Julia helper functions: pure utility functions with no parser state dependencies

import type { ExcludedRegion } from '../types';
import type { BracketIndex } from './bracketIndex';
import { getBracketScan, queryHABO, queryHFB, queryUBOB } from './juliaBracketScan';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Callbacks and pre-computed context passed to bracket-aware scanning functions.
// `bracketIndex` lets backward scans locate the enclosing bracket in O(log n)
// instead of rescanning the source prefix on every keyword.
export interface JuliaHelperCallbacks {
  isAdjacentToUnicodeLetter: (source: string, startOffset: number, keywordLength: number) => boolean;
  bracketIndex: BracketIndex;
}

// Checks if single quote at position is a transpose operator (not a character literal)
export function isTransposeOperator(source: string, pos: number): boolean {
  if (pos === 0) {
    return false;
  }

  const prevChar = source[pos - 1];

  // Transpose follows closing brackets or dot (broadcasted adjoint: A.')
  if (prevChar === ')' || prevChar === ']' || prevChar === '}' || prevChar === '.') {
    return true;
  }

  // Double transpose: A'' (second ' is also transpose)
  if (prevChar === "'") {
    return true;
  }

  // Transpose follows identifiers or Unicode letters
  if (/[\w]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
    return true;
  }

  return false;
}

// Skips a character literal (for use inside interpolation scanning)
export function skipCharLiteral(source: string, pos: number): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      // Don't let escape skip past newline - character literals can't span lines
      if (source[i + 1] === '\n' || source[i + 1] === '\r') {
        return i + 1;
      }
      i += 2;
      continue;
    }
    if (source[i] === "'") {
      return i + 1;
    }
    // Character literals don't span lines
    if (source[i] === '\n' || source[i] === '\r') {
      return i;
    }
    i++;
  }
  return i;
}

// Skips a prefixed string (no interpolation except b"...") inside interpolation
export function skipPrefixedStringInInterpolation(source: string, pos: number, hasEscapes = false): number {
  // Check for triple-quoted prefixed string
  if (source.slice(pos, pos + 3) === '"""') {
    let i = pos + 3;
    while (i < source.length) {
      // Only b"..." strings support escape sequences; non-b prefixed strings treat \ as literal
      if (hasEscapes && source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        i += 3;
        while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
        return i;
      }
      i++;
    }
    return source.length;
  }
  // Regular prefixed string
  let i = pos + 1;
  while (i < source.length) {
    // All prefixed strings treat \" and \\ as escape sequences
    if (source[i] === '\\' && i + 1 < source.length && (hasEscapes || source[i + 1] === '"' || source[i + 1] === '\\')) {
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      i++;
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return source.length;
}

// Skips a nested string inside interpolation (handles both regular and triple-quoted).
// `blockKeywords` is forwarded to nested `$()` interpolation handling so backtick
// macro prefix detection knows which prefixes are reserved.
export function skipNestedJuliaString(source: string, pos: number, blockKeywords: ReadonlySet<string>): number {
  return runInterpolationEngine(source, blockKeywords, makeStringFrame(source, pos));
}

// Returns true if `source[pos]` (a backtick) is preceded by a valid Julia identifier
// prefix, meaning the backtick is part of a prefixed command macro call (e.g.
// `prefix\`cmd\``). Walks backward collecting identifier-continuation chars (ASCII word,
// Unicode Letter/Number), then validates:
//   - the prefix starts with a valid identifier-start char (letter or `_`, not a digit
//     -- Julia identifiers cannot start with a digit); and
//   - the prefix is not a Julia reserved word (block keywords and non-block reserved
//     words like `where`, `import`, `in`, etc. — none of these can be macro names).
// Handles BMP-outside characters encoded as surrogate pairs (e.g. 𝐀 U+1D400).
// `reservedWords` is the full Julia reserved-word set (see JULIA_RESERVED_WORDS in
// juliaParser.ts). The parameter is named generically because the helper itself only
// needs to do `reservedWords.has(prefix)`.
export function isPrecededByCommandMacroPrefix(source: string, pos: number, reservedWords: ReadonlySet<string>): boolean {
  if (pos <= 0) return false;
  // Walk backward collecting identifier-continuation chars.
  let prefixStart = pos;
  while (prefixStart > 0) {
    const prevPos = prefixStart - 1;
    const c = source[prevPos];
    // BMP-outside char: low surrogate at prevPos, high surrogate at prevPos - 1.
    if (c >= '\uDC00' && c <= '\uDFFF' && prevPos >= 1) {
      const cp = source.codePointAt(prevPos - 1);
      if (cp !== undefined && cp > 0xffff && /[\p{L}\p{N}]/u.test(String.fromCodePoint(cp))) {
        prefixStart -= 2;
        continue;
      }
      break;
    }
    if (/[a-zA-Z0-9_]/.test(c)) {
      prefixStart--;
      continue;
    }
    if (c.charCodeAt(0) > 127 && /[\p{L}\p{N}]/u.test(c)) {
      prefixStart--;
      continue;
    }
    break;
  }
  if (prefixStart === pos) return false;
  // The first char of the prefix must be a valid identifier-start (letter or `_`),
  // not a digit. Handle BMP-outside letters via surrogate pair lookup.
  const firstChar = source[prefixStart];
  let startIsIdentStart = false;
  if (/[a-zA-Z_]/.test(firstChar)) {
    startIsIdentStart = true;
  } else if (firstChar >= '\uD800' && firstChar <= '\uDBFF' && prefixStart + 1 < source.length) {
    const cp = source.codePointAt(prefixStart);
    if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) {
      startIsIdentStart = true;
    }
  } else if (firstChar.charCodeAt(0) > 127 && /\p{L}/u.test(firstChar)) {
    startIsIdentStart = true;
  }
  if (!startIsIdentStart) return false;
  // Julia reserved words cannot be macro names.
  const prefix = source.slice(prefixStart, pos);
  if (reservedWords.has(prefix)) return false;
  return true;
}

// Skips a backtick command string (for use inside interpolation/nested string scanning).
// `blockKeywords` is the full set of block-related reserved words; prefixes matching
// these are rejected (reserved words cannot be macro names).
export function skipBacktickString(source: string, pos: number, blockKeywords: ReadonlySet<string>): number {
  return runInterpolationEngine(source, blockKeywords, makeBacktickFrame(source, pos, blockKeywords));
}

// Skips $() interpolation block, tracking paren depth. `blockKeywords` is forwarded
// to backtick scanning so command macro prefix detection can reject reserved words.
export function skipJuliaInterpolation(source: string, pos: number, blockKeywords: ReadonlySet<string>): number {
  return runInterpolationEngine(source, blockKeywords, makeInterpFrame(pos, pos));
}

// Iterative engine shared by skipJuliaInterpolation, skipNestedJuliaString, and
// skipBacktickString. Tracks contexts on an explicit stack to avoid mutual recursion,
// which would overflow on deeply nested inputs like `"$("$( ... )")"` thousands of
// levels deep. Frames map 1:1 to a single scanner step (`runFrame`). When a frame
// finds a child construct (`$(...)`, nested `"..."`, backtick command), it pauses
// itself (saving its updated `i`), pushes a child frame, and the loop resumes with
// the child. When a frame completes, the next iteration resumes the saved parent.
type InterpFrame =
  | { kind: 'interp'; i: number; startPos: number; depth: number }
  | { kind: 'string'; i: number; triple: boolean }
  | { kind: 'backtick'; i: number; triple: boolean; isPrefixed: boolean };

// Result of a single scanner step. `done` carries the end position to return to
// the parent frame (or to the caller, if this is the root frame). `child` carries
// a new frame to push and run before resuming this frame.
type FrameStep = { done: number } | { child: InterpFrame };

function makeInterpFrame(pos: number, startPos: number): InterpFrame {
  return { kind: 'interp', i: pos, startPos, depth: 1 };
}

function makeStringFrame(source: string, pos: number): InterpFrame {
  const triple = source.slice(pos, pos + 3) === '"""';
  return { kind: 'string', i: triple ? pos + 3 : pos + 1, triple };
}

function makeBacktickFrame(source: string, pos: number, blockKeywords: ReadonlySet<string>): InterpFrame {
  const triple = source.slice(pos, pos + 3) === '```';
  const isPrefixed = isPrecededByCommandMacroPrefix(source, pos, blockKeywords);
  return { kind: 'backtick', i: triple ? pos + 3 : pos + 1, triple, isPrefixed };
}

// Skips a `#= ... =#` block comment, returning the position right after `=#`. The
// caller guarantees `source[start..start+2] === '#='`. Used by the interpolation
// frame so multi-line comments inside `$()` don't leak into stack-pushed sub-frames.
function skipNestedBlockComment(source: string, start: number): number {
  let i = start + 2;
  let commentDepth = 1;
  while (i < source.length && commentDepth > 0) {
    if (source.slice(i, i + 2) === '#=') {
      commentDepth++;
      i += 2;
      continue;
    }
    if (source.slice(i, i + 2) === '=#') {
      commentDepth--;
      i += 2;
      continue;
    }
    i++;
  }
  return i;
}

// Advances the given frame by one logical step. Returns either a completion
// (`{ done: endPos }`) or a child frame to push (`{ child: ... }`). The frame is
// mutated in-place so resumption picks up where it paused; this keeps the stack
// representation small (no copy on push).
function runFrame(source: string, blockKeywords: ReadonlySet<string>, frame: InterpFrame): FrameStep {
  if (frame.kind === 'interp') {
    let i = frame.i;
    while (i < source.length && frame.depth > 0) {
      // Handle #= multi-line comments inside interpolation
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '=') {
        i = skipNestedBlockComment(source, i);
        continue;
      }
      // Handle # line comments inside interpolation
      if (source[i] === '#') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Handle char literals inside interpolation (e.g. ')')
      if (source[i] === "'" && !isTransposeOperator(source, i)) {
        i = skipCharLiteral(source, i);
        continue;
      }
      // Handle backtick command strings inside interpolation
      if (source[i] === '`') {
        frame.i = i;
        return { child: makeBacktickFrame(source, i, blockKeywords) };
      }
      if (source[i] === '(') {
        frame.depth++;
        i++;
        continue;
      }
      if (source[i] === ')') {
        frame.depth--;
        i++;
        continue;
      }
      if (source[i] === '"') {
        // Check for prefixed string (string macro like r"...", raw"...", etc.)
        // Prefixed strings have no interpolation support, so they are skipped inline
        // (no stack frame needed — the helper is itself iterative).
        if (i > frame.startPos) {
          let prefixStart = i - 1;
          while (prefixStart >= frame.startPos && /[a-zA-Z0-9_]/.test(source[prefixStart])) {
            prefixStart--;
          }
          prefixStart++;
          if (prefixStart < i && /[a-zA-Z_]/.test(source[prefixStart])) {
            const prefixText = source.slice(prefixStart, i);
            i = skipPrefixedStringInInterpolation(source, i, prefixText === 'b');
            continue;
          }
        }
        frame.i = i;
        return { child: makeStringFrame(source, i) };
      }
      i++;
    }
    return { done: i };
  }

  if (frame.kind === 'string') {
    let i = frame.i;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        frame.i = i + 2;
        return { child: makeInterpFrame(i + 2, i + 2) };
      }
      if (frame.triple) {
        if (source.slice(i, i + 3) === '"""') {
          return { done: i + 3 };
        }
      } else if (source[i] === '"') {
        return { done: i + 1 };
      }
      i++;
    }
    return { done: i };
  }

  // backtick frame
  let i = frame.i;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
      frame.i = i + 2;
      return { child: makeInterpFrame(i + 2, i + 2) };
    }
    if (frame.triple) {
      if (source.slice(i, i + 3) === '```') {
        let end = i + 3;
        if (frame.isPrefixed) {
          while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
        }
        return { done: end };
      }
    } else if (source[i] === '`') {
      let end = i + 1;
      if (frame.isPrefixed) {
        while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
      }
      return { done: end };
    }
    i++;
  }
  return { done: i };
}

// Drives the frame stack to completion. Repeatedly steps the top frame: on
// completion, pops and forwards the end position to the new top; on child push,
// stacks the child without touching the parent's saved cursor. Returns the final
// end position of the root frame.
function runInterpolationEngine(source: string, blockKeywords: ReadonlySet<string>, root: InterpFrame): number {
  const stack: InterpFrame[] = [root];
  let lastDone = root.i;
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const step = runFrame(source, blockKeywords, top);
    if ('done' in step) {
      lastDone = step.done;
      stack.pop();
      // Hand the child's end position back to the new top frame so it resumes
      // scanning after the child construct. For the root frame, this becomes the
      // function's return value.
      if (stack.length > 0) {
        stack[stack.length - 1].i = step.done;
      }
      continue;
    }
    stack.push(step.child);
  }
  return lastDone;
}

// Returns true when `afterKeyword` (the source immediately following an
// `abstract`/`primitive` keyword) reaches the `type` keyword, treating Julia
// block comments `#= ... =#` (which may nest and may contain internal newlines)
// as separators in addition to horizontal whitespace. A newline OUTSIDE a comment
// is rejected (`abstract\ntype` is not an abstract-type declaration), matching the
// original `/^[ \t]+type\b/` behavior while treating comments as trivia.
export function isTypeKeywordAfterAbstractOrPrimitive(afterKeyword: string): boolean {
  const n = afterKeyword.length;
  let i = 0;
  while (i < n) {
    const ch = afterKeyword[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    // Julia block comment `#= ... =#` (nestable); internal newlines are trivia.
    if (ch === '#' && afterKeyword[i + 1] === '=') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (afterKeyword[i] === '#' && afterKeyword[i + 1] === '=') {
          depth++;
          i += 2;
        } else if (afterKeyword[i] === '=' && afterKeyword[i + 1] === '#') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    break;
  }
  if (!afterKeyword.startsWith('type', i)) return false;
  const after = afterKeyword[i + 4];
  return after === undefined || !/[a-zA-Z0-9_]/.test(after);
}

// Checks if colon at position starts a symbol (not ternary or type annotation)
export function isSymbolStart(source: string, pos: number): boolean {
  const nextChar = source[pos + 1];
  if (!nextChar) {
    return false;
  }

  // Symbol must start with letter, underscore, @, or certain operators
  if (!/[\w!%&*+\-/<=>?\\^|~@]/.test(nextChar) && nextChar.charCodeAt(0) <= 127) {
    return false;
  }

  // Colon after identifier/number/bracket is ternary, not symbol
  // :: (type annotation) second colon is not a symbol start
  // <: and >: (subtype/supertype operators) are single tokens; the colon does not start a symbol
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (prevChar === ':' || /[\w)\]}]/.test(prevChar)) {
      return false;
    }
    // Only reject when prevChar is a Unicode letter/identifier-continuation character.
    // Unicode operators (e.g., × U+00D7) are NOT identifiers; after them `:` starts a symbol.
    if (prevChar.charCodeAt(0) > 127 && /\p{L}/u.test(prevChar)) {
      return false;
    }
    // Handle surrogate pairs for BMP-outside characters: when prevChar is a low surrogate,
    // the actual code point is at pos - 2 (high surrogate). Reject only if the full code
    // point is a Unicode letter.
    if (prevChar >= '\uDC00' && prevChar <= '\uDFFF' && pos >= 2) {
      const cp = source.codePointAt(pos - 2);
      if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) {
        return false;
      }
    }
    if (prevChar === '<' || prevChar === '>') {
      return false;
    }
  }

  return true;
}

// Keywords that introduce a value expression where `[` starts an array construction,
// not an indexing operation. e.g. `return [1, 2]`, `yield [x]`, `throw [...]`.
const VALUE_KEYWORDS_BEFORE_BRACKET = new Set([
  'return',
  'yield',
  'throw',
  'in',
  'if',
  'elseif',
  'else',
  'while',
  'until',
  'for',
  'do',
  'begin',
  'and',
  'or',
  'not',
  'global',
  'local',
  'const'
]);

// Determines if a '[' at the given position is an indexing bracket (a[...]) vs array construction ([...])
export function isIndexingBracket(source: string, bracketPos: number): boolean {
  // Iteratively skip past chained '[' (e.g., `a[[[end]]]`). Each outer '[' before
  // an inner '[' inherits the indexing classification of whatever stands before
  // the leftmost '[' in the chain. Using a loop instead of recursion avoids stack
  // overflow on pathological inputs like `'['.repeat(10000) + 'begin\nend'`.
  let bracketCursor = bracketPos;
  while (true) {
    let i = bracketCursor - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    const prevChar = source[i];
    // Identifiers, closing brackets/parens/braces, quotes, Unicode -> indexing,
    // unless the identifier is a keyword introducing a value expression (return, yield, throw, ...).
    if (/[a-zA-Z0-9_]/.test(prevChar)) {
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.slice(wordStart, i + 1);
      // Reject if the candidate word is preceded by a non-identifier character (so it stands as a token).
      const charBeforeWord = wordStart > 0 ? source[wordStart - 1] : '';
      if (charBeforeWord !== '.' && VALUE_KEYWORDS_BEFORE_BRACKET.has(word)) {
        return false;
      }
      return true;
    }
    if (/[)\]}'"`]/.test(prevChar)) return true;
    // Non-ASCII char before '[': a Unicode identifier (letter/number) means indexing,
    // a Unicode operator (e.g. `×`, U+00D7) means array construction. For BMP-outside
    // chars, prevChar is the low surrogate, so look up the full codepoint at i - 1.
    if (prevChar >= '\uDC00' && prevChar <= '\uDFFF' && i >= 1) {
      const cp = source.codePointAt(i - 1);
      return cp !== undefined && cp > 0xffff && /[\p{L}\p{N}]/u.test(String.fromCodePoint(cp));
    }
    if (prevChar.charCodeAt(0) > 127) return /[\p{L}\p{N}]/u.test(prevChar);
    // '[' before '[' means the outer bracket is indexing (e.g., a[[end]])
    // In this context, end still means lastindex, so treat as indexing. Continue
    // the loop with the inner '[' to inspect what stands before it.
    if (prevChar === '[') {
      bracketCursor = i;
      continue;
    }
    // Everything else (operators, (, =, comma, newline, etc.) -> array construction
    return false;
  }
}

// Checks if there's an unmatched block opener between two positions
// Tracks depth by counting openers and 'end' closers to handle completed block expressions
// e.g., "begin i^2 end" -> depth 0 (matched), "begin i^2" -> depth 1 (unmatched)
// A 'for' at the start of the range (after whitespace/comments) is counted as a
// block-form opener (not a generator); later 'for's are treated as generator
// expressions and ignored.
export function hasUnmatchedBlockOpenerBetween(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpeners: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  // Fast path: when (start, end) matches the precomputed bracket scan exactly
  // (start == enclosing.open + 1 and end is one of the bracket's recorded
  // keyword offsets), answer in O(log K) via the snapshot table. The fused
  // scan in juliaBracketScan mirrors this helper's loop exactly, so the
  // returned value is identical to the linear fallback below.
  const enclosing = callbacks.bracketIndex.enclosing(start);
  if (enclosing !== null && enclosing.open + 1 === start) {
    const scan = getBracketScan(enclosing, source, excludedRegions, blockOpeners, callbacks.isAdjacentToUnicodeLetter);
    const fast = queryUBOB(scan, end);
    if (fast !== null) return fast;
  }
  // 'for' is excluded from openers because in comprehension context it acts as a generator
  // (no end). 'if' is conditionally excluded once we've seen a 'for x in y' pattern, since
  // subsequent 'if's are comprehension filters.
  const openersWithoutFor = blockOpeners.filter((kw) => kw !== 'for');
  let depth = 0;
  let inComprehensionContext = false;

  // Detect leading block-form 'for' (after whitespace and excluded regions)
  let firstNonWhite = start;
  while (firstNonWhite < end) {
    if (isInExcludedRegion(firstNonWhite, excludedRegions)) {
      firstNonWhite++;
      continue;
    }
    const ch = source[firstNonWhite];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    firstNonWhite++;
  }
  if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
    const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
    const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
    if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
      if (!callbacks.isAdjacentToUnicodeLetter(source, firstNonWhite, 3) && before !== '.') {
        depth++;
      }
    }
  }

  // Track [ ] bracket depth so an `end` inside `arr[end]` (lastindex) does NOT decrement
  // the block depth meant to track block openers.
  let bracketDepth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '[') {
      bracketDepth++;
      continue;
    }
    if (source[i] === ']') {
      if (bracketDepth > 0) bracketDepth--;
      continue;
    }
    // Detect 'for x in y' or 'for x = y' pattern — entering comprehension context.
    // Subsequent 'if's are filters, not block openers.
    if (
      !inComprehensionContext &&
      source[i] === 'f' &&
      i + 3 <= end &&
      source.slice(i, i + 3) === 'for' &&
      !/[a-zA-Z0-9_]/.test(i > 0 ? source[i - 1] : ' ') &&
      !/[a-zA-Z0-9_]/.test(i + 3 < source.length ? source[i + 3] : ' ') &&
      !callbacks.isAdjacentToUnicodeLetter(source, i, 3)
    ) {
      // Look ahead within range for 'in' or '=' on the same logical scan.
      // Bare 'for' followed by 'in' or '=' indicates a generator/comprehension clause.
      const tail = source.slice(i + 3, end);
      if (/^[ \t]+\S+.*?(?:\bin\b|\b∈\b|=)/.test(tail)) {
        inComprehensionContext = true;
      }
    }
    // Check for 'end' keyword (block closer)
    if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
        if (!callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
          // Skip dot-preceded end (field access like obj.end, not block closer)
          // Skip end inside [ ] brackets (lastindex reference, not block close)
          if (before !== '.' && bracketDepth === 0) {
            if (depth > 0) depth--;
          }
          i += 2;
          continue;
        }
      }
    }
    // Check for block openers
    for (const keyword of openersWithoutFor) {
      if (i + keyword.length <= end && source[i] === keyword[0] && source.slice(i, i + keyword.length) === keyword) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
        // Skip dot-preceded keywords (field access like range.begin, not block opener)
        if (before === '.') continue;
        // In comprehension context, 'if' is a filter rather than a block opener.
        if (inComprehensionContext && keyword === 'if') continue;
        // abstract/primitive are only block openers when followed by 'type'
        if (keyword === 'abstract' || keyword === 'primitive') {
          const afterKeyword = source.slice(i + keyword.length);
          if (!isTypeKeywordAfterAbstractOrPrimitive(afterKeyword)) continue;
        }
        depth++;
        i += keyword.length - 1;
        break;
      }
    }
  }
  return depth > 0;
}

// Checks if there's ANY block-opening keyword (including if/for) between two positions
// Used to distinguish f(end) from f(if...end)
export function hasAnyBlockOpenerBetween(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpeners: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  // Fast path: see hasUnmatchedBlockOpenerBetween for the rationale. The fused
  // scan tracks a saturating "any opener seen" flag whose snapshot at `end` is
  // the helper's return value.
  const enclosing = callbacks.bracketIndex.enclosing(start);
  if (enclosing !== null && enclosing.open + 1 === start) {
    const scan = getBracketScan(enclosing, source, excludedRegions, blockOpeners, callbacks.isAdjacentToUnicodeLetter);
    const fast = queryHABO(scan, end);
    if (fast !== null) return fast;
  }
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    for (const keyword of blockOpeners) {
      if (i + keyword.length <= end && source.slice(i, i + keyword.length) === keyword) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
        // Skip dot-preceded keywords (field access like range.begin, not block opener)
        if (before === '.') continue;
        return true;
      }
    }
  }
  return false;
}

// Checks if there's an unmatched generator 'for' keyword at depth 0 between positions.
// A leading 'for' (first non-whitespace token) is considered a block-form for; it is
// skipped and paired with its matching 'end'. Only subsequent (generator-form) 'for's
// without matching 'end' cause this to return true.
export function hasForBetween(
  source: string,
  start: number,
  end: number,
  excludedRegions: ExcludedRegion[],
  blockOpeners: readonly string[],
  callbacks: JuliaHelperCallbacks
): boolean {
  // Fast path: see hasUnmatchedBlockOpenerBetween. The fused scan tracks the
  // "non-leading generator `for` at paren depth 0 outside active block bodies"
  // outcome and answers it in O(log K).
  const enclosing = callbacks.bracketIndex.enclosing(start);
  if (enclosing !== null && enclosing.open + 1 === start) {
    const scan = getBracketScan(enclosing, source, excludedRegions, blockOpeners, callbacks.isAdjacentToUnicodeLetter);
    const fast = queryHFB(scan, end);
    if (fast !== null) return fast;
  }
  // Detect a leading block-form 'for' (after whitespace/excluded regions)
  let firstNonWhite = start;
  while (firstNonWhite < end) {
    if (isInExcludedRegion(firstNonWhite, excludedRegions)) {
      firstNonWhite++;
      continue;
    }
    const ch = source[firstNonWhite];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
    firstNonWhite++;
  }
  let leadingBlockForPos = -1;
  if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
    const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
    const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
    if (
      !/[a-zA-Z0-9_]/.test(before) &&
      !/[a-zA-Z0-9_]/.test(after) &&
      !callbacks.isAdjacentToUnicodeLetter(source, firstNonWhite, 3) &&
      before !== '.'
    ) {
      leadingBlockForPos = firstNonWhite;
    }
  }

  let depth = 0;
  let blockDepth = leadingBlockForPos >= 0 ? 1 : 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0 && i + 3 <= end && source.slice(i, i + 3) === 'for') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && !callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
        // Skip dot-preceded for (field access like obj.for, not keyword)
        if (before !== '.') {
          if (i === leadingBlockForPos) {
            i += 2;
            continue;
          }
          // Generator 'for': only counts if not inside an unmatched block (e.g., outer for/begin)
          if (blockDepth === 0) {
            return true;
          }
        }
      }
    } else if (depth === 0 && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && !callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
        if (before !== '.') {
          if (blockDepth > 0) blockDepth--;
          i += 2;
        }
      }
    }
  }
  return false;
}

// Checks if there's an assignment '=' (not '==') between two positions at depth 0
export function hasAssignmentBetween(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (depth === 0 && ch === '=') {
      // Skip '==' (equality) and '=>' (pair): forward check
      if (i + 1 < end && (source[i + 1] === '=' || source[i + 1] === '>')) continue;
      // Skip second '=' of '==', '===', '!==': preceded by '='
      if (i > start && source[i - 1] === '=') continue;
      // Skip '!=' (not-equal): preceded by '!'
      if (i > start && source[i - 1] === '!') continue;
      // Skip '<=' and '>=': preceded by '<' or '>' but not compound assignments like '<<=', '>>=', '>>>='
      if (i > start && (source[i - 1] === '<' || source[i - 1] === '>')) {
        if (i - 2 >= start && (source[i - 2] === '>' || source[i - 2] === '<')) {
          // Could be <<=, >>=, or >>>=, which are compound assignments
          return true;
        }
        continue;
      }
      return true;
    }
  }
  return false;
}

// Checks if there's a comma at depth 0 between two positions (not in excluded regions)
// Used to distinguish generator (expr for x in 1:n) from tuple/call (a, for x in 1:n ...)
export function hasCommaAtDepthZero(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 0;
  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ';')) {
      return true;
    }
  }
  return false;
}

// Checks if there is only whitespace (or comment-style excluded regions) between two positions.
// Comments are treated as whitespace-equivalent. String/char/symbol/command literals are
// value-bearing expressions and cause this to return false (they should NOT be considered
// whitespace, e.g., `("x" for i in iter)` is a generator with a value before `for`).
export function isOnlyWhitespaceBetween(source: string, start: number, end: number, excludedRegions: ExcludedRegion[] = []): boolean {
  let i = start;
  while (i < end) {
    const region = findExcludedRegionAt(i, excludedRegions);
    if (region) {
      // Comments start with '#' (single-line `#` or multi-line `#=`); treat as whitespace.
      // All other excluded regions (strings, char literals, symbols, command literals)
      // are value expressions and disqualify the range from being "only whitespace".
      if (source[region.start] !== '#') {
        return false;
      }
      i = region.end;
      continue;
    }
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return false;
    i++;
  }
  return true;
}
