// Shared utility functions used across multiple parsers

import type { ExcludedRegion, LanguageKeywords, OpenBlock, Token, TokenType } from '../types';

// Find the last opener in the stack matching the given keyword value
// Used by Ada, VHDL, Fortran, COBOL, Octave (case-insensitive) and Bash, AppleScript (case-sensitive)
export function findLastOpenerByType(stack: OpenBlock[], targetValue: string, caseInsensitive = false): number {
  if (caseInsensitive) {
    const lowerTarget = targetValue.toLowerCase();
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value.toLowerCase() === lowerTarget) {
        return i;
      }
    }
  } else {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value === targetValue) {
        return i;
      }
    }
  }
  return -1;
}

// Cache of lowercased close/middle keyword sets keyed by LanguageKeywords object
// identity. LanguageKeywords is readonly and fixed per parser instance, so the
// cached sets never go stale; the WeakMap lets them be collected with the parser
const lowerKeywordSetCache = new WeakMap<LanguageKeywords, { close: Set<string>; middle: Set<string> }>();

// Determine token type with case-insensitive keyword matching
// Used by Ada, Fortran, VHDL for case-insensitive languages
export function getTokenTypeCaseInsensitive(keyword: string, keywords: LanguageKeywords): TokenType {
  let sets = lowerKeywordSetCache.get(keywords);
  if (sets === undefined) {
    sets = {
      close: new Set(keywords.blockClose.map((k) => k.toLowerCase())),
      middle: new Set(keywords.blockMiddle.map((k) => k.toLowerCase()))
    };
    lowerKeywordSetCache.set(keywords, sets);
  }
  const lowerKeyword = keyword.toLowerCase();
  if (sets.close.has(lowerKeyword)) {
    return 'block_close';
  }
  if (sets.middle.has(lowerKeyword)) {
    return 'block_middle';
  }
  return 'block_open';
}

// Escape regex metacharacters in a string
// Standalone version for use outside class context; see also BaseBlockParser.escapeRegex
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a case-insensitive keyword-matching regex from LanguageKeywords
// Sorts keywords by length descending so longer keywords match first
// Used by Ada, VHDL, Fortran, COBOL, Pascal in their case-insensitive tokenize overrides
export function buildCaseInsensitiveKeywordPattern(keywords: LanguageKeywords): RegExp {
  const allKeywords = [...keywords.blockOpen, ...keywords.blockClose, ...keywords.blockMiddle];
  const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
  const escapedKeywords = sortedKeywords.map((kw) => escapeRegex(kw));
  return new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');
}

// Paired delimiters for percent literals in line-level scanning
const LINE_PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Skip a paired-delimiter percent literal body with nesting support
function skipPairedPercentLiteral(lineContent: string, pos: number, openChar: string, closeChar: string): number {
  let depth = 1;
  let j = pos;
  while (j < lineContent.length && depth > 0) {
    if (lineContent[j] === '\\' && j + 1 < lineContent.length) {
      j += 2;
      continue;
    }
    if (lineContent[j] === openChar) {
      depth++;
    } else if (lineContent[j] === closeChar) {
      depth--;
    }
    j++;
  }
  return j;
}

// Find line comment and string regions in a single line (for Ruby/Crystal heredoc indent detection)
export function findLineCommentAndStringRegions(
  lineContent: string,
  heredocPrefixes: string[],
  stringQuotes: string[]
): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];
  let i = 0;
  while (i < lineContent.length) {
    const ch = lineContent[i];
    // Skip heredoc openers (<<TERM, <<-TERM, <<~TERM, etc.)
    if (ch === '<' && i + 1 < lineContent.length && lineContent[i + 1] === '<') {
      i += 2;
      if (i < lineContent.length && heredocPrefixes.includes(lineContent[i])) i++;
      if (i < lineContent.length && (lineContent[i] === '"' || lineContent[i] === "'" || lineContent[i] === '`')) {
        const quote = lineContent[i];
        i++;
        while (i < lineContent.length && lineContent[i] !== quote) i++;
        if (i < lineContent.length) i++;
      } else {
        while (i < lineContent.length && /[A-Za-z0-9_]/.test(lineContent[i])) i++;
      }
      continue;
    }
    if (ch === '#') {
      regions.push({ start: i, end: lineContent.length });
      break;
    }
    if (stringQuotes.includes(ch)) {
      const start = i;
      i++;
      while (i < lineContent.length && lineContent[i] !== ch) {
        if (lineContent[i] === '\\' && i + 1 < lineContent.length) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < lineContent.length) i++;
      regions.push({ start, end: i });
      continue;
    }
    // Percent literals (%w[...], %Q{...}, %|...|, etc.)
    if (ch === '%' && (i === 0 || !/[a-zA-Z0-9_]/.test(lineContent[i - 1]))) {
      let j = i + 1;
      // Optional specifier letter (q, Q, w, W, i, I, r, x, s)
      if (j < lineContent.length && /[a-zA-Z]/.test(lineContent[j])) {
        j++;
      }
      if (j < lineContent.length) {
        const delimChar = lineContent[j];
        // Skip alphanumeric or whitespace delimiters (not valid percent literal)
        if (!/[a-zA-Z0-9\s]/.test(delimChar)) {
          const start = i;
          j++;
          if (delimChar in LINE_PAIRED_DELIMITERS) {
            j = skipPairedPercentLiteral(lineContent, j, delimChar, LINE_PAIRED_DELIMITERS[delimChar]);
          } else {
            while (j < lineContent.length && lineContent[j] !== delimChar) {
              if (lineContent[j] === '\\' && j + 1 < lineContent.length) {
                j += 2;
                continue;
              }
              j++;
            }
            if (j < lineContent.length) j++;
          }
          regions.push({ start, end: j });
          i = j;
          continue;
        }
      }
    }
    // Regex literal (/.../), not preceded by identifier/number/bracket
    if (ch === '/' && (i === 0 || !/[a-zA-Z0-9_)\]}"'`]/.test(lineContent[i - 1]))) {
      const start = i;
      i++;
      while (i < lineContent.length && lineContent[i] !== '/') {
        if (lineContent[i] === '\\' && i + 1 < lineContent.length) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i < lineContent.length) i++;
      regions.push({ start, end: i });
      continue;
    }
    i++;
  }
  return regions;
}

// Check if an offset falls inside any of the given regions
export function isInsideRegion(offset: number, regions: { start: number; end: number }[]): boolean {
  for (const region of regions) {
    if (offset >= region.start && offset < region.end) return true;
  }
  return false;
}

// Find the last opener in the stack matching for/while/loop keywords (case-insensitive)
// Used by Ada and VHDL for loop keyword matching
export function findLastOpenerForLoop(stack: OpenBlock[]): number {
  const validOpeners = ['for', 'while', 'loop'];
  for (let i = stack.length - 1; i >= 0; i--) {
    if (validOpeners.includes(stack[i].token.value.toLowerCase())) {
      return i;
    }
  }
  return -1;
}

// Find the last non-repeat block in the stack
// Used by Lua and Pascal where 'end' closes any block except 'repeat' (which is closed by 'until')
export function findLastNonRepeatIndex(stack: OpenBlock[]): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].token.value !== 'repeat') {
      return i;
    }
  }
  return -1;
}

// Find the start of the line containing the given position
export function findLineStart(source: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    if (source[i] === '\n' || source[i] === '\r') {
      return i + 1;
    }
  }
  return 0;
}

// Returns the largest element of the ascending-sorted array strictly less than
// `value`, or -1 when no element is smaller
function largestLessThan(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo > 0 ? sorted[lo - 1] : -1;
}

// Merge compound end keywords (e.g., "end if", "end loop") into single tokens
// Used by Ada, VHDL, and Fortran for compound close keyword handling
export function mergeCompoundEndTokens(
  tokens: Token[],
  compoundEndPositions: Map<number, { keyword: string; length: number; endType: string }>
): { tokens: Token[]; processedPositions: Set<number> } {
  const result: Token[] = [];
  const processedPositions = new Set<number>();

  // Compound spans [endPos, endPos + length) never overlap: each starts at a
  // distinct `end` token and stops within the trailing type keyword, so any
  // token is covered by at most one compound. Sort the compound start offsets
  // once and binary-search the single candidate per token, instead of scanning
  // every compound position for every token (which made this O(T*M))
  const sortedCompoundStarts = [...compoundEndPositions.keys()].sort((a, b) => a - b);

  for (const token of tokens) {
    // Check if this token is the start of a compound end
    const compound = compoundEndPositions.get(token.startOffset);
    if (compound && token.value.toLowerCase() === 'end') {
      // Replace with compound keyword
      result.push({
        ...token,
        value: compound.keyword,
        endOffset: token.startOffset + compound.length,
        type: 'block_close'
      });
      processedPositions.add(token.startOffset);
      continue;
    }

    // Check if this token is the type part of a compound end (e.g. the `if` in
    // `end if`). Only the nearest compound starting strictly before the token
    // can cover it, since compound spans never overlap
    let shouldSkip = false;
    const candidateStart = largestLessThan(sortedCompoundStarts, token.startOffset);
    if (candidateStart !== -1) {
      const comp = compoundEndPositions.get(candidateStart);
      if (comp !== undefined && token.startOffset < candidateStart + comp.length && token.value.toLowerCase() === comp.endType) {
        shouldSkip = true;
      }
    }

    if (!shouldSkip) {
      result.push(token);
    }
  }

  return { tokens: result, processedPositions };
}

// Binary search to check if a position falls within any excluded region
// Standalone version for use in helper modules; see also BaseBlockParser.isInExcludedRegion
export function isInExcludedRegion(pos: number, regions: { start: number; end: number }[]): boolean {
  let left = 0;
  let right = regions.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const region = regions[mid];

    if (pos >= region.start && pos < region.end) {
      return true;
    }
    if (pos < region.start) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  return false;
}

// Binary search to find the excluded region containing a position; returns null if none
// Standalone version for use in helper modules; see also BaseBlockParser.findExcludedRegionAt
export function findExcludedRegionAt(pos: number, regions: ExcludedRegion[]): ExcludedRegion | null {
  let left = 0;
  let right = regions.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const region = regions[mid];

    if (pos >= region.start && pos < region.end) {
      return region;
    }
    if (pos < region.start) {
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }

  return null;
}
