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
  const receiverMatch = source.slice(i).match(/^(?:self\.|[A-Z][A-Za-z0-9_]*\.)/);
  if (receiverMatch) {
    i += receiverMatch[0].length;
  }
  skipWs();
  // Method name: identifier with optional ? or !, or operator
  const identMatch = source.slice(i).match(/^(?:[a-zA-Z_][a-zA-Z0-9_]*[?!=]?|\[\]=?|<=>|===|==|=~|!=|!~|<=|>=|<<|>>|\*\*|[+\-*/%&|^<>~!])/);
  if (!identMatch) return false;
  i += identMatch[0].length;
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

  // Single-character binary operators: |, &
  if (ch === '|' || ch === '&') return true;

  return false;
}

// Checks if 'rescue' is used as a postfix modifier (e.g., risky rescue nil)
export function isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
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
  // not operators - the keyword IS postfix in this case
  if (/[a-zA-Z0-9_][!?]$/.test(beforeKeyword)) {
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

// Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
export function isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: RubyValidationCallbacks): boolean {
  // Find logical line start (following backslash continuations)
  const lineStart = findLogicalLineStart(source, position, excludedRegions, callbacks);

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
  return true;
}
