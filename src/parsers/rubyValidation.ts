// Ruby block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by validation functions
export interface RubyValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Detects Ruby 3.0+ endless method definitions: `def name [(args)] = expr`.
// Scans forward from after `def` past whitespace, the method name (possibly with
// receiver like self.foo or Class.foo, operator-style names, and ?/! suffixes),
// optional parameter list, optional return type (Sorbet style ignored), and checks
// whether the next significant character is `=` (but not `==`, `=~`, `=>`).
export function isEndlessMethodDef(source: string, start: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
  let i = start;
  const skipWs = () => {
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      // Backslash line continuation: `\<LF>`, `\<CR>`, or `\<CR><LF>` joins the next
      // physical line into the current logical statement. Required so that
      // `def \<NL>name = value` is still recognised as a Ruby 3.0+ endless method def.
      if (ch === '\\' && i + 1 < source.length) {
        const next = source[i + 1];
        if (next === '\n') {
          i += 2;
          continue;
        }
        if (next === '\r') {
          // Step past \r and an optional following \n (CRLF)
          i += 2;
          if (i < source.length && source[i] === '\n') i++;
          continue;
        }
      }
      if (callbacks.isInExcludedRegion(i, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      break;
    }
  };
  skipWs();
  // Optional receiver: self., Class., obj.
  // Ruby class names start with an uppercase/titlecase letter or an "other letter"
  // codepoint (e.g. CJK ideographs like 日本語), followed by identifier-continuation
  // characters. Match this Unicode-aware variant in addition to `self.`.
  const receiverMatch = source.slice(i).match(/^(?:self\.|[\p{Lu}\p{Lt}\p{Lo}][\p{L}\p{M}\p{N}\p{Pc}]*\.)/u);
  if (receiverMatch) {
    i += receiverMatch[0].length;
  }
  skipWs();
  // Method name: identifier with optional ? or !, or operator
  // Ruby permits non-ASCII characters in method names; the leading char must be a
  // letter (including non-ASCII letters) or underscore, with subsequent identifier-
  // continuation chars (letters, marks, numbers, connectors).
  const identMatch = source
    .slice(i)
    .match(/^(?:[\p{L}_][\p{L}\p{M}\p{N}\p{Pc}]*[?!=]?|\[\]=?|<=>|===|==|=~|!=|!~|<=|>=|<<|>>|\*\*|[+\-*/%&|^<>~!])/u);
  if (!identMatch) return false;
  i += identMatch[0].length;
  // The `[?!=]?` suffix above greedily consumes a trailing `=`. That `=` is part of
  // a setter method name (`def name=(value)`) only when a parameter list `(` follows.
  // Otherwise (`def a=1`) the `=` is the endless-method separator written without a
  // space, so rewind one char to let the `=` check below recognize it.
  if (identMatch[0].endsWith('=') && /^[\p{L}_]/u.test(identMatch[0])) {
    let peek = i;
    while (peek < source.length) {
      const ch = source[peek];
      if (ch === ' ' || ch === '\t') {
        peek++;
        continue;
      }
      if (callbacks.isInExcludedRegion(peek, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(peek, excludedRegions);
        if (region) {
          peek = region.end;
          continue;
        }
      }
      break;
    }
    if (source[peek] !== '(') {
      i--;
    }
  }
  skipWs();
  // Optional parameter list in parens
  if (source[i] === '(') {
    let depth = 1;
    i++;
    while (i < source.length && depth > 0) {
      if (callbacks.isInExcludedRegion(i, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
  }
  skipWs();
  // Must be `=` but not `==`, `=~`, `=>`
  if (source[i] !== '=') return false;
  const next = source[i + 1];
  if (next === '=' || next === '~' || next === '>') return false;
  return true;
}

// Find the start of a logical line, following backslash and implicit operator continuations
export function findLogicalLineStart(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: RubyValidationCallbacks
): number {
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  // Check if previous line ends with backslash or operator continuation
  while (lineStart >= 2) {
    const prevChar = source[lineStart - 1];
    // Previous line must end with \n or \r
    if (prevChar !== '\n' && prevChar !== '\r') break;
    // Implicit continuation: current line starts with `.` (method chain), `)` (closing
    // paren of multi-line condition), `]` (closing bracket of multi-line array literal),
    // or `}` (closing brace of multi-line hash/block literal). All indicate the previous
    // line is logically the same statement.
    let cursor = lineStart;
    while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t')) cursor++;
    if (cursor < source.length) {
      const firstCh = source[cursor];
      const inExcluded = excludedRegions && callbacks.isInExcludedRegion(cursor, excludedRegions);
      if (!inExcluded && (firstCh === ')' || firstCh === ']' || firstCh === '}' || (firstCh === '.' && source[cursor + 1] !== '.'))) {
        let prevLineStart = lineStart - 1;
        if (prevChar === '\n' && prevLineStart > 0 && source[prevLineStart - 1] === '\r') prevLineStart--;
        while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
          prevLineStart--;
        }
        lineStart = prevLineStart;
        continue;
      }
    }
    // Find the end of the line before the newline
    let checkPos = lineStart - 1;
    // Skip \r\n pair
    if (prevChar === '\n' && checkPos > 0 && source[checkPos - 1] === '\r') {
      checkPos--;
    }
    // Check if line ends with backslash (count consecutive backslashes for even/odd check)
    if (checkPos > 0 && source[checkPos - 1] === '\\') {
      // Count consecutive backslashes before newline
      let bsCount = 0;
      let bsPos = checkPos - 1;
      while (bsPos >= 0 && source[bsPos] === '\\') {
        bsCount++;
        bsPos--;
      }
      // Even number of backslashes means they are all escaped (not continuation)
      if (bsCount % 2 === 0) {
        break;
      }
      // Ruby's $\ global variable: a single backslash preceded by `$` is the global
      // output record separator value, NOT a line continuation marker.
      if (bsCount === 1 && bsPos >= 0 && source[bsPos] === '$') {
        break;
      }
      // Skip if the backslash is inside an excluded region (e.g., comment ending with \)
      if (excludedRegions && callbacks.isInExcludedRegion(checkPos - 1, excludedRegions)) {
        break;
      }
      // Go to start of previous line
      let prevLineStart = checkPos - 1;
      while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
        prevLineStart--;
      }
      lineStart = prevLineStart;
    } else if (endsWithContinuationOperator(source, checkPos, excludedRegions, callbacks)) {
      // Implicit continuation: line ends with binary operator or opening bracket
      let prevLineStart = checkPos;
      while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
        prevLineStart--;
      }
      lineStart = prevLineStart;
    } else {
      break;
    }
  }
  return lineStart;
}

// Checks if the content before checkPos (a newline position) ends with an operator
// that causes implicit line continuation in Ruby
export function endsWithContinuationOperator(
  source: string,
  checkPos: number,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: RubyValidationCallbacks
): boolean {
  // Scan backward from checkPos, skipping whitespace
  let i = checkPos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  if (i < 0) return false;

  // Skip if the trailing character is inside an excluded region (e.g., string or comment)
  if (excludedRegions && callbacks.isInExcludedRegion(i, excludedRegions)) {
    return false;
  }

  const ch = source[i];

  // Opening brackets always cause continuation
  if (ch === '(' || ch === '[' || ch === '{') return true;

  // Special global variables ($&, $|, $+, $~, $<, $>, $=, $*, $%, $^, $-, $., $,, etc.)
  // end with what looks like an operator character but are values, not operators.
  // They never imply line continuation.
  if (i > 0 && source[i - 1] === '$') return false;

  // Comma causes continuation
  if (ch === ',') return true;

  // Dot causes continuation (method chain)
  if (ch === '.') {
    // Range operators (.., ...) also cause continuation in Ruby
    if (i > 0 && source[i - 1] === '.') return true;
    return true;
  }

  // Two-character operators: &&, ||
  if (ch === '&' && i > 0 && source[i - 1] === '&') return true;
  if (ch === '|' && i > 0 && source[i - 1] === '|') return true;

  // Binary arithmetic/comparison/bitwise operators that imply line continuation when at line end
  // Includes: |, &, +, -, *, %, ^, <, >, =, ~
  // (covers `==`, `!=`, `<=`, `>=`, `<=>`, `=~`, `!~`, assignments, `**`, `<<`, `>>`, etc. since
  // we only need to look at the trailing character)
  // `/` is intentionally excluded because it is context-sensitive (division vs regex literal
  // vs global variable `$/`). Trailing `/` rarely indicates line continuation in practice.
  if ('|&+-*%^<>=~'.includes(ch)) return true;

  return false;
}

// Checks if 'rescue' is used as a postfix modifier (e.g., risky rescue nil)
export function isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
  // `rescue` always starts a new clause inside a begin/def/module/class body, so it
  // never continues the previous logical line. When the physical line above `rescue`
  // ends with an implicit-continuation operator (e.g. `x = 1 +`, `foo(`), that line is
  // an incomplete expression -- joining `rescue` onto it would mis-detect it as a
  // postfix rescue. Treat such a `rescue` as having no preceding content (not postfix).
  // Backslash continuation is excluded here: `begin \<NL>rescue` legitimately joins to
  // `begin rescue`, which the block-keyword check below already handles correctly.
  let physicalLineStart = position;
  while (physicalLineStart > 0 && source[physicalLineStart - 1] !== '\n' && source[physicalLineStart - 1] !== '\r') {
    physicalLineStart--;
  }
  if (physicalLineStart > 0) {
    const prevNewline = physicalLineStart - 1;
    const prevLineEnd = source[prevNewline] === '\n' && prevNewline > 0 && source[prevNewline - 1] === '\r' ? prevNewline - 1 : prevNewline;
    const endsWithBackslash = prevLineEnd > 0 && source[prevLineEnd - 1] === '\\';
    if (!endsWithBackslash && endsWithContinuationOperator(source, prevLineEnd, excludedRegions, callbacks)) {
      return false;
    }
  }
  const lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);
  // Find last semicolon in original source (not after replace) to avoid index mapping errors
  // Skip semicolons that are part of $; global variable
  let lastSemicolonPos = -1;
  for (let i = position - 1; i >= lineStart; i--) {
    if (
      source[i] === ';' &&
      !callbacks.isInExcludedRegion(i, excludedRegions) &&
      !(i > 0 && source[i - 1] === '$' && (i < 2 || source[i - 2] !== '$'))
    ) {
      lastSemicolonPos = i;
      break;
    }
  }
  const sliceStart = lastSemicolonPos >= 0 ? lastSemicolonPos + 1 : lineStart;
  // Strip backslash continuation sequences so they don't affect keyword detection
  let before = source.slice(sliceStart, position).replace(/\\\r?\n|\\\r/g, ' ');
  before = before.trim();
  if (before.length === 0) return false;
  const blockKeywords = [
    'if',
    'unless',
    'while',
    'until',
    'for',
    'case',
    'do',
    'then',
    'else',
    'elsif',
    'begin',
    'rescue',
    'ensure',
    'when',
    'in',
    'not',
    'and',
    'or'
  ];
  const normalizedRescueBefore = before.replace(/[ \t]+/g, ' ');
  for (const kw of blockKeywords) {
    if (normalizedRescueBefore === kw || normalizedRescueBefore.endsWith(` ${kw}`)) {
      return false;
    }
  }
  return true;
}

// Checks if a conditional is postfix (e.g., "return value if condition")
export function isPostfixConditional(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: RubyValidationCallbacks
): boolean {
  // Find logical line start (following backslash continuations)
  const lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);

  // Find last semicolon in original source (not after replace) to avoid index mapping errors
  // Skip semicolons that are part of $; global variable
  let lastSemicolonPos = -1;
  for (let i = position - 1; i >= lineStart; i--) {
    if (
      source[i] === ';' &&
      !callbacks.isInExcludedRegion(i, excludedRegions) &&
      !(i > 0 && source[i - 1] === '$' && (i < 2 || source[i - 2] !== '$'))
    ) {
      lastSemicolonPos = i;
      break;
    }
  }

  const sliceStart = lastSemicolonPos >= 0 ? lastSemicolonPos + 1 : lineStart;
  // Strip backslash continuation sequences so they don't affect keyword detection
  let beforeKeyword = source.slice(sliceStart, position).replace(/\\\r?\n|\\\r/g, ' ');
  beforeKeyword = beforeKeyword.trim();

  // No content before keyword means not postfix
  if (beforeKeyword.length === 0) {
    return false;
  }

  // Block keyword before means not postfix
  const precedingBlockKeywords = [
    'if',
    'unless',
    'while',
    'until',
    'for',
    'case',
    'do',
    'then',
    'else',
    'elsif',
    'begin',
    'rescue',
    'ensure',
    'when',
    'in',
    'not',
    'and',
    'or'
  ];

  const normalizedBefore = beforeKeyword.replace(/[ \t]+/g, ' ');
  for (const kw of precedingBlockKeywords) {
    if (normalizedBefore === kw || normalizedBefore.endsWith(` ${kw}`)) {
      return false;
    }
  }

  // ! and ? after identifier are method name suffixes (save!, valid?),
  // not operators - the keyword IS postfix in this case.
  // Ruby permits non-ASCII characters in method names (e.g. `メソッド?`, `α!`),
  // so accept Unicode identifier-continue characters (Letter, Mark, Number,
  // Connector Punctuation) before the trailing ! or ?.
  if (/[\p{L}\p{M}\p{N}\p{Pc}_][!?]$/u.test(beforeKeyword)) {
    return true;
  }

  // Global variables with special chars ($!, $?, $~, etc.) are complete expressions
  if (/\$[!?~&/.<>*+,;:=\\@$^`|%-]$/.test(beforeKeyword)) {
    return true;
  }

  // Operator expecting expression means not postfix
  // Includes: assignment, logical, comparison, arithmetic, range, and other operators
  if (/[=&|,([{:?+\-*/%<>^~!.]$/.test(beforeKeyword)) {
    // If the last character before keyword is inside an excluded region
    // (e.g., closing / of a regex literal), it's a complete expression, not an operator
    let checkPos = position - 1;
    while (checkPos >= lineStart) {
      const ch = source[checkPos];
      if (ch === ' ' || ch === '\t') {
        checkPos--;
        continue;
      }
      // Skip backslash continuation: \<newline> or \<CR><LF>
      if (ch === '\n') {
        checkPos--;
        if (checkPos >= lineStart && source[checkPos] === '\r') {
          checkPos--;
        }
        if (checkPos >= lineStart && source[checkPos] === '\\') {
          checkPos--;
          continue;
        }
        break;
      }
      if (ch === '\r') {
        checkPos--;
        if (checkPos >= lineStart && source[checkPos] === '\\') {
          checkPos--;
          continue;
        }
        break;
      }
      break;
    }
    if (checkPos >= lineStart && callbacks.isInExcludedRegion(checkPos, excludedRegions)) {
      return true;
    }
    return false;
  }

  // Non-keyword content before means postfix
  return true;
}

// Checks whether a 'do' at doPos is prevented from being the loop separator of the
// loop keyword at loopPos. A 'do' is blocked when, between the loop keyword and the
// 'do', either (1) a `then` keyword appears (the loop body is already opened, so the
// 'do' belongs to an iterator inside the body), or (2) the 'do' sits at a positive
// bracket nesting depth (it is inside a parenthesized sub-expression of the condition,
// e.g. `while (compute do |x| x end)`), so it is an iterator block, not the separator.
function isDoBlockedFromLoopKeyword(
  source: string,
  loopPos: number,
  doPos: number,
  excludedRegions: ExcludedRegion[],
  callbacks: RubyValidationCallbacks
): boolean {
  let depth = 0;
  let i = loopPos;
  while (i < doPos) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) {
      const region = callbacks.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    // `then` keyword: only counts as a real keyword when bounded by word boundaries
    // and not part of a method call (`.then`), scope resolution (`::then`), or a
    // variable name (`@then`, `$then`).
    if (ch === 't' && source.slice(i, i + 4) === 'then') {
      const before = source[i - 1];
      const after = source[i + 4];
      const wordBefore = before !== undefined && /[a-zA-Z0-9_]/.test(before);
      const wordAfter = after !== undefined && /[a-zA-Z0-9_]/.test(after);
      if (!wordBefore && !wordAfter) {
        const prefixed =
          before === '@' ||
          before === '$' ||
          (before === '.' && !(i > 1 && source[i - 2] === '.')) ||
          (before === ':' && i > 1 && source[i - 2] === ':');
        if (!prefixed) {
          return true;
        }
      }
      i += 4;
      continue;
    }
    i++;
  }
  return depth > 0;
}

// Returns true when `do` at `doPosition` is the first non-whitespace character on its
// physical line (defined by `lineStart`).
function isDoFirstOnPhysicalLine(source: string, doPosition: number, lineStart: number): boolean {
  let physicalLineStart = doPosition;
  while (physicalLineStart > 0 && source[physicalLineStart - 1] !== '\n' && source[physicalLineStart - 1] !== '\r') {
    physicalLineStart--;
  }
  // The logical line start may already lie on a previous physical line via backslash
  // or operator continuation. In that case, `do` is not "first" — return false.
  if (lineStart < physicalLineStart) return false;
  for (let i = physicalLineStart; i < doPosition; i++) {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

// Returns true when the physical line ending at `lineEnd` (exclusive of the line break)
// has a trailing `#` comment as its last syntactic element. The line need not be entirely
// a comment — `while cond # tail` also qualifies, since the line ends inside the comment
// region.
function prevLineEndsWithComment(
  source: string,
  lineEnd: number,
  excludedRegions: ExcludedRegion[] | undefined,
  callbacks: RubyValidationCallbacks
): boolean {
  // Scan back from lineEnd-1 skipping whitespace; the last non-ws char must be inside
  // an excluded region whose start contains `#` (single-line comment).
  let i = lineEnd - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  if (i < 0) return false;
  if (!excludedRegions) return false;
  const region = callbacks.findExcludedRegionAt(i, excludedRegions);
  if (!region) return false;
  // The region must be a single-line comment, identified by `#` at its start.
  return source[region.start] === '#';
}

// Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
export function isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
  // Find logical line start (following backslash continuations)
  let lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);

  // If `do` is the first non-whitespace token on its physical line and the previous
  // physical line ends with a comment (and is not itself blank), pretend the comment
  // is whitespace and join the previous line. Ruby's strict grammar rejects this form
  // (`while cond # comment\ndo\nbody\nend`), but typing this is a common mistake and
  // recognising the loop-do here lets `while` pair correctly with `end` rather than
  // creating a misleading `do`/`end` pair that hides the `while` orphan.
  if (isDoFirstOnPhysicalLine(source, position, lineStart) && lineStart > 0) {
    const prevLineEnd = lineStart - 1; // points at \n or \r before the do line
    let prevContentEnd = prevLineEnd;
    if (source[prevLineEnd] === '\n' && prevLineEnd > 0 && source[prevLineEnd - 1] === '\r') {
      prevContentEnd = prevLineEnd - 1;
    }
    // The previous line must end with a comment (`# ...`) at its tail to qualify.
    if (prevLineEndsWithComment(source, prevContentEnd, excludedRegions, callbacks)) {
      // Recompute logical line start from the previous line.
      let prevPhysicalLineStart = prevContentEnd;
      while (prevPhysicalLineStart > 0 && source[prevPhysicalLineStart - 1] !== '\n' && source[prevPhysicalLineStart - 1] !== '\r') {
        prevPhysicalLineStart--;
      }
      lineStart = findLogicalLineStart(source, prevPhysicalLineStart, excludedRegions, callbacks);
    }
  }

  // Get content before 'do' on this line
  let beforeDo = source.slice(lineStart, position);

  // Find last semicolon not in excluded region
  // Skip semicolons that are part of $; global variable
  let lastValidSemicolon = -1;
  for (let i = beforeDo.length - 1; i >= 0; i--) {
    if (beforeDo[i] === ';') {
      const absolutePos = lineStart + i;
      if (
        !callbacks.isInExcludedRegion(absolutePos, excludedRegions) &&
        !(absolutePos > 0 && source[absolutePos - 1] === '$' && (absolutePos < 2 || source[absolutePos - 2] !== '$'))
      ) {
        lastValidSemicolon = i;
        break;
      }
    }
  }

  const searchStart = lastValidSemicolon >= 0 ? lineStart + lastValidSemicolon + 1 : lineStart;
  beforeDo = source.slice(searchStart, position);

  // Find loop keywords (while, until, for) before this 'do'
  const loopPattern = /\b(while|until|for)\b/g;
  const loopMatches = [...beforeDo.matchAll(loopPattern)];

  for (const loopMatch of loopMatches) {
    const loopAbsolutePos = searchStart + loopMatch.index;
    if (callbacks.isInExcludedRegion(loopAbsolutePos, excludedRegions)) {
      continue;
    }

    // Reject loop keywords preceded by dot (method calls like obj.while),
    // :: (scope resolution), @ or $ (variable prefixes)
    if (loopAbsolutePos > 0) {
      const prevChar = source[loopAbsolutePos - 1];
      if (prevChar === '$' || prevChar === '@') {
        continue;
      }
      if (prevChar === ':' && loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === ':') {
        continue;
      }
      if (prevChar === '.' && !(loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === '.')) {
        continue;
      }
    }

    // Find the first 'do' after this loop keyword, skipping excluded regions
    const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
    const searchRange = source.slice(afterLoopStart, position + 2);
    const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

    for (const doMatch of doMatches) {
      const doAbsolutePos = afterLoopStart + doMatch.index;
      // Skip 'do' in excluded regions (strings, comments)
      if (callbacks.isInExcludedRegion(doAbsolutePos, excludedRegions)) {
        continue;
      }
      // Skip 'do' preceded by dot (method call), :: (scope resolution), @ or $ (variable prefix)
      if (doAbsolutePos > 0) {
        const prevChar = source[doAbsolutePos - 1];
        if (prevChar === '$' || prevChar === '@') {
          continue;
        }
        if (prevChar === ':' && doAbsolutePos > 1 && source[doAbsolutePos - 2] === ':') {
          continue;
        }
        if (prevChar === '.' && !(doAbsolutePos > 1 && source[doAbsolutePos - 2] === '.')) {
          continue;
        }
      }
      // Skip 'do' that is shielded from the loop keyword by a `then` keyword or by
      // an enclosing parenthesized sub-expression: such a 'do' is an iterator block,
      // not the loop separator. Keep scanning for a later, unshielded 'do'.
      if (isDoBlockedFromLoopKeyword(source, loopAbsolutePos, doAbsolutePos, excludedRegions, callbacks)) {
        continue;
      }
      // This is the first valid 'do' after the loop keyword
      if (doAbsolutePos === position) {
        return true;
      }
      // Found a different valid 'do' before our position
      break;
    }
  }

  return false;
}

// Checks if a keyword at the given position is preceded by a dot (method call),
// skipping whitespace (spaces, tabs, and newlines) between the dot and the keyword.
// Returns false for range operator (..) -- x..end is valid Ruby.
export function isDotPreceded(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
  let i = position - 1;
  while (i >= 0) {
    // Skip excluded regions (comments between dot and keyword)
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.start - 1;
      continue;
    }
    if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
      i--;
      continue;
    }
    break;
  }
  if (i < 0 || source[i] !== '.') {
    return false;
  }
  // Check for range operator (..) -- if the character before the dot is also a dot, it's a range
  if (i > 0 && source[i - 1] === '.') {
    return false;
  }
  // Ruby's $. global variable (current line number): a `.` preceded by `$` is part of a
  // special global, not a method-call dot.
  if (i > 0 && source[i - 1] === '$') {
    return false;
  }
  return true;
}
