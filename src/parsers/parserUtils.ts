// Shared utility functions used across multiple parsers

import type { LanguageKeywords, OpenBlock, Token, TokenType } from '../types';

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

// Determine token type with case-insensitive keyword matching
// Used by Ada, Fortran, VHDL for case-insensitive languages
export function getTokenTypeCaseInsensitive(keyword: string, keywords: LanguageKeywords): TokenType {
  const lowerKeyword = keyword.toLowerCase();
  if (keywords.blockClose.some((k) => k.toLowerCase() === lowerKeyword)) {
    return 'block_close';
  }
  if (keywords.blockMiddle.some((k) => k.toLowerCase() === lowerKeyword)) {
    return 'block_middle';
  }
  return 'block_open';
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
        if (lineContent[i] === '\\') i++;
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

// Find the start of the line containing the given position
export function findLineStart(source: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    if (source[i] === '\n' || source[i] === '\r') {
      return i + 1;
    }
  }
  return 0;
}

// Merge compound end keywords (e.g., "end if", "end loop") into single tokens
// Used by Ada, VHDL, and Fortran for compound close keyword handling
export function mergeCompoundEndTokens(
  tokens: Token[],
  compoundEndPositions: Map<number, { keyword: string; length: number; endType: string }>
): { tokens: Token[]; processedPositions: Set<number> } {
  const result: Token[] = [];
  const processedPositions = new Set<number>();

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

    // Check if this token should be skipped (it's the type part of compound end)
    let shouldSkip = false;
    for (const [endPos, comp] of compoundEndPositions) {
      if (token.startOffset > endPos && token.startOffset < endPos + comp.length && token.value.toLowerCase() === comp.endType) {
        shouldSkip = true;
        break;
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
