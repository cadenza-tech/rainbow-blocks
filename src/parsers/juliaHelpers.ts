// Julia helper functions: pure utility functions with no parser state dependencies

import type { ExcludedRegion } from '../types';
import { isInExcludedRegion } from './parserUtils';

// Callbacks for base parser methods needed by scanning functions
export interface JuliaHelperCallbacks {
  isAdjacentToUnicodeLetter: (source: string, startOffset: number, keywordLength: number) => boolean;
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

// Skips a nested string inside interpolation (handles both regular and triple-quoted)
export function skipNestedJuliaString(source: string, pos: number): number {
  // Check for triple-quoted string
  if (source.slice(pos, pos + 3) === '"""') {
    let i = pos + 3;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        return i + 3;
      }
      i++;
    }
    return i;
  }
  // Regular double-quoted string
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
      i = skipJuliaInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Skips a backtick command string (for use inside interpolation/nested string scanning)
export function skipBacktickString(source: string, pos: number): number {
  const isPrefixed = pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1]);
  // Check for triple backtick
  if (source.slice(pos, pos + 3) === '```') {
    let i = pos + 3;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '```') {
        let end = i + 3;
        if (isPrefixed) {
          while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
        }
        return end;
      }
      i++;
    }
    return i;
  }
  // Single backtick
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
      i = skipJuliaInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '`') {
      let end = i + 1;
      if (isPrefixed) {
        while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
      }
      return end;
    }
    i++;
  }
  return i;
}

// Skips $() interpolation block, tracking paren depth
export function skipJuliaInterpolation(source: string, pos: number): number {
  let depth = 1;
  let i = pos;
  while (i < source.length && depth > 0) {
    // Handle #= multi-line comments inside interpolation
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '=') {
      i += 2;
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
      i = skipBacktickString(source, i);
      continue;
    }
    if (source[i] === '(') {
      depth++;
    } else if (source[i] === ')') {
      depth--;
    } else if (source[i] === '"') {
      // Check for prefixed string (string macro like r"...", raw"...", etc.)
      // Prefixed strings have no interpolation support
      if (i > pos) {
        let prefixStart = i - 1;
        while (prefixStart >= pos && /[a-zA-Z0-9_]/.test(source[prefixStart])) {
          prefixStart--;
        }
        prefixStart++;
        if (prefixStart < i && /[a-zA-Z]/.test(source[prefixStart])) {
          const prefixText = source.slice(prefixStart, i);
          i = skipPrefixedStringInInterpolation(source, i, prefixText === 'b');
          continue;
        }
      }
      i = skipNestedJuliaString(source, i);
      continue;
    }
    i++;
  }
  return i;
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
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (prevChar === ':' || /[\w)\]}]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
      return false;
    }
  }

  return true;
}

// Determines if a '[' at the given position is an indexing bracket (a[...]) vs array construction ([...])
export function isIndexingBracket(source: string, bracketPos: number): boolean {
  let i = bracketPos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  if (i < 0) return false;
  const prevChar = source[i];
  // Identifiers, closing brackets/parens/braces, quotes, Unicode -> indexing
  if (/[a-zA-Z0-9_)\]}'"`]/.test(prevChar) || prevChar.charCodeAt(0) > 127) return true;
  // '[' before '[' means the outer bracket is indexing (e.g., a[[end]])
  // In this context, end still means lastindex, so treat as indexing
  if (prevChar === '[') return isIndexingBracket(source, i);
  // Everything else (operators, (, =, comma, newline, etc.) -> array construction
  return false;
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
  const openers = blockOpeners.filter((kw) => kw !== 'for');
  let depth = 0;

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

  for (let i = start; i < end; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    // Check for 'end' keyword (block closer)
    if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
      const before = i > 0 ? source[i - 1] : ' ';
      const after = i + 3 < source.length ? source[i + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
        if (!callbacks.isAdjacentToUnicodeLetter(source, i, 3)) {
          // Skip dot-preceded end (field access like obj.end, not block closer)
          if (before !== '.') {
            if (depth > 0) depth--;
          }
          i += 2;
          continue;
        }
      }
    }
    // Check for block openers
    for (const keyword of openers) {
      if (i + keyword.length <= end && source[i] === keyword[0] && source.slice(i, i + keyword.length) === keyword) {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
        if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
        if (callbacks.isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
        // Skip dot-preceded keywords (field access like range.begin, not block opener)
        if (before === '.') continue;
        // abstract/primitive are only block openers when followed by 'type'
        if (keyword === 'abstract' || keyword === 'primitive') {
          const afterKeyword = source.slice(i + keyword.length);
          if (!/^[ \t]+type\b/.test(afterKeyword)) continue;
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
  callbacks: JuliaHelperCallbacks
): boolean {
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

// Checks if there is only whitespace between two positions
export function isOnlyWhitespaceBetween(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') return false;
  }
  return true;
}
