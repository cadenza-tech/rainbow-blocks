// COBOL block parser: PERFORM→END-PERFORM, IF→END-IF, EVALUATE→END-EVALUATE

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token, TokenType } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping of close keywords to their valid openers (case insensitive comparison)
const CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
  'end-perform': 'perform',
  'end-if': 'if',
  'end-evaluate': 'evaluate',
  'end-read': 'read',
  'end-write': 'write',
  'end-rewrite': 'rewrite',
  'end-delete': 'delete',
  'end-start': 'start',
  'end-return': 'return',
  'end-search': 'search',
  'end-string': 'string',
  'end-unstring': 'unstring',
  'end-accept': 'accept',
  'end-display': 'display',
  'end-call': 'call',
  'end-invoke': 'invoke',
  'end-compute': 'compute',
  'end-add': 'add',
  'end-subtract': 'subtract',
  'end-multiply': 'multiply',
  'end-divide': 'divide'
};

export class CobolBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'perform',
      'if',
      'evaluate',
      'read',
      'write',
      'rewrite',
      'delete',
      'start',
      'return',
      'search',
      'string',
      'unstring',
      'accept',
      'display',
      'call',
      'invoke',
      'compute',
      'add',
      'subtract',
      'multiply',
      'divide'
    ],
    blockClose: [
      'end-perform',
      'end-if',
      'end-evaluate',
      'end-read',
      'end-write',
      'end-rewrite',
      'end-delete',
      'end-start',
      'end-return',
      'end-search',
      'end-string',
      'end-unstring',
      'end-accept',
      'end-display',
      'end-call',
      'end-invoke',
      'end-compute',
      'end-add',
      'end-subtract',
      'end-multiply',
      'end-divide'
    ],
    blockMiddle: ['else', 'when']
  };

  // Regex cache for combined patterns
  private readonly regexCache = new Map<string, RegExp>();

  // Cache of valid opener positions per keyword type, computed once per parse
  private validOpenPositions = new Map<string, Set<number>>();

  // Validates block open: checks pre-computed valid positions (O(1) per call)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    if (!this.validOpenPositions.has(lowerKeyword)) {
      this.validOpenPositions.set(lowerKeyword, this.computeValidPositions(lowerKeyword, source, excludedRegions));
    }
    return this.validOpenPositions.get(lowerKeyword)?.has(position) ?? false;
  }

  // Single-pass computation of all valid opener positions for a keyword type
  private computeValidPositions(lowerKeyword: string, source: string, excludedRegions: ExcludedRegion[]): Set<number> {
    const endKeyword = `end-${lowerKeyword}`;
    let combinedPattern = this.regexCache.get(lowerKeyword);
    if (!combinedPattern) {
      const escaped = this.escapeRegex(lowerKeyword);
      const escapedEnd = this.escapeRegex(endKeyword);
      combinedPattern = new RegExp(`(?<![a-zA-Z0-9_\\-])(?:${escapedEnd}|${escaped})(?![a-zA-Z0-9_\\-])`, 'gi');
      this.regexCache.set(lowerKeyword, combinedPattern);
    }
    const pattern = new RegExp(combinedPattern.source, combinedPattern.flags);

    // Collect all openers and closers in source order
    const openerPositions: number[] = [];
    const closerPositions = new Set<number>();
    for (const match of source.matchAll(pattern)) {
      const pos = match.index;
      if (this.isInExcludedRegion(pos, excludedRegions)) {
        continue;
      }
      // Skip hyphenated identifiers
      if (pos > 0 && source[pos - 1] === '-') {
        continue;
      }
      const end = pos + match[0].length;
      if (end < source.length && source[end] === '-') {
        continue;
      }
      const isClose = match[0].length > lowerKeyword.length;
      if (isClose) {
        closerPositions.add(pos);
      } else {
        // For PERFORM, skip paragraph calls (PERFORM paragraph-name)
        // Structured forms: PERFORM UNTIL, PERFORM VARYING, PERFORM WITH, PERFORM <expr> TIMES
        // Paragraph calls: PERFORM name (single identifier + newline/period/EOF)
        // Paragraph ranges: PERFORM name THRU/THROUGH name
        // Block forms: PERFORM DISPLAY ..., PERFORM COMPUTE ... (statement on same line)
        if (lowerKeyword === 'perform') {
          const afterInner = source.slice(pos + match[0].length);
          const nextWord = afterInner.match(/^[ \t]+([a-zA-Z0-9][a-zA-Z0-9_-]*)/i);
          if (nextWord) {
            const word = nextWord[1].toLowerCase();
            if (word !== 'until' && word !== 'varying' && word !== 'with' && word !== 'times') {
              const afterNextWord = afterInner.slice(nextWord[0].length);
              // Check for PERFORM <variable> TIMES pattern
              const secondWord = afterNextWord.match(/^[ \t]+([a-zA-Z][a-zA-Z0-9_-]*)/i);
              if (secondWord && secondWord[1].toLowerCase() === 'times') {
                // PERFORM <variable> TIMES → structured block, accept
              } else if (secondWord && (secondWord[1].toLowerCase() === 'thru' || secondWord[1].toLowerCase() === 'through')) {
                // PERFORM para THRU para → paragraph range call, reject
                continue;
              } else {
                // Check if only whitespace/newline/period follows the first word (paragraph call)
                // If there's more content on the same line, it's likely a block PERFORM with inline statements
                // Strip inline COBOL comments (*>) before checking
                const afterNextWordNoComment = afterNextWord.replace(/\*>.*/, '');
                const hasMoreContent = afterNextWordNoComment.match(/^[ \t]*([^\n\r. \t])/);
                if (!hasMoreContent) {
                  continue;
                }
              }
            }
          }
        }
        openerPositions.push(pos);
      }
    }

    // Match openers to closers using a stack (forward pass, O(n))
    const validPositions = new Set<number>();
    const stack: number[] = [];
    // Interleave openers and closers in position order
    let oi = 0;
    const closerList = [...closerPositions].sort((a, b) => a - b);
    let ci = 0;
    while (oi < openerPositions.length || ci < closerList.length) {
      const openerPos = oi < openerPositions.length ? openerPositions[oi] : Number.MAX_SAFE_INTEGER;
      const closerPos = ci < closerList.length ? closerList[ci] : Number.MAX_SAFE_INTEGER;
      if (openerPos < closerPos) {
        stack.push(openerPos);
        oi++;
      } else {
        if (stack.length > 0) {
          const pos = stack.pop();
          if (pos !== undefined) {
            validPositions.add(pos);
          }
        }
        ci++;
      }
    }
    return validPositions;
  }

  // Override tokenize for case-insensitive keyword matching
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    this.validOpenPositions.clear();
    const tokens: Token[] = [];
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];

    // Sort keywords by length descending to match longer keywords first
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    // Escape regex metacharacters in keywords for safe pattern construction
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    // Use 'gi' flag for case-insensitive global matching
    const keywordPattern = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');

    // Pre-compute newline positions for O(log n) line/column lookup
    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(keywordPattern)) {
      const startOffset = match.index;

      // Skip keywords in excluded regions
      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = match[1];
      const endOffset = startOffset + keyword.length;

      // Skip keywords that are part of hyphenated identifiers
      // COBOL identifiers use hyphens (e.g., PERFORM-COUNT, END-IF-FLAG)
      if (startOffset > 0 && source[startOffset - 1] === '-') {
        continue;
      }
      if (endOffset < source.length && source[endOffset] === '-') {
        continue;
      }

      const type = this.getTokenType(keyword.toLowerCase());

      // Validate block open keywords
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset,
        line,
        column
      });
    }

    return tokens;
  }

  // Returns the token type for a keyword (case-insensitive)
  protected getTokenType(keyword: string): TokenType {
    const lowerKeyword = keyword.toLowerCase();
    if (this.keywords.blockClose.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_close';
    }
    if (this.keywords.blockMiddle.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_middle';
    }
    return 'block_open';
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Inline comment: *>
    if (char === '*' && pos + 1 < source.length && source[pos + 1] === '>') {
      return this.matchSingleLineComment(source, pos);
    }

    // Fixed-format column 7 comment indicator (*, /, D, d)
    // Only treat as comment if columns 1-6 look like fixed-format sequence area
    if (char === '*' || char === '/' || char === 'D' || char === 'd') {
      let lineStart = pos;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      if (this.getVisualColumn(source, lineStart, pos) === 6) {
        const sequenceArea = source.slice(lineStart, pos);
        if (/^[\d \t]*$/.test(sequenceArea)) {
          if (char === 'D' || char === 'd') {
            const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
            if (/[a-zA-Z0-9_-]/.test(nextChar)) {
              return null;
            }
          }
          return this.matchSingleLineComment(source, pos);
        }
      }
    }

    // >> compiler directives (>>IF, >>ELSE, >>END-IF, >>EVALUATE, etc.)
    if (char === '>' && pos + 1 < source.length && source[pos + 1] === '>') {
      return this.matchSingleLineComment(source, pos);
    }

    // EXEC/EXECUTE ... END-EXEC block
    if (char === 'E' || char === 'e') {
      const execRegion = this.matchExecBlock(source, pos);
      if (execRegion) {
        return execRegion;
      }
    }

    // Pseudo-text delimiter ==...==
    if (char === '=' && pos + 1 < source.length && source[pos + 1] === '=') {
      return this.matchPseudoText(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchCobolString(source, pos, "'");
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchCobolString(source, pos, '"');
    }

    return null;
  }

  // Calculates the visual column of a position, expanding tabs to 8-character stops
  private getVisualColumn(source: string, lineStart: number, pos: number): number {
    let visualCol = 0;
    for (let i = lineStart; i < pos; i++) {
      if (source[i] === '\t') {
        visualCol = Math.floor(visualCol / 8 + 1) * 8;
      } else {
        visualCol++;
      }
    }
    return visualCol;
  }

  // Checks if a line starting at lineStart is a fixed-format column 7 comment line
  private isFixedFormatCommentLine(source: string, lineStart: number): boolean {
    // Find position at visual column 6 (0-indexed)
    let visualCol = 0;
    let i = lineStart;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r' && visualCol < 6) {
      if (source[i] === '\t') {
        visualCol = Math.floor(visualCol / 8 + 1) * 8;
      } else {
        visualCol++;
      }
      i++;
    }
    if (visualCol !== 6 || i >= source.length) {
      return false;
    }
    const indicator = source[i];
    if (indicator !== '*' && indicator !== '/' && indicator !== 'D' && indicator !== 'd') {
      return false;
    }
    // Validate columns 1-6 look like fixed-format sequence area
    const sequenceArea = source.slice(lineStart, i);
    return /^[\d \t]*$/.test(sequenceArea);
  }

  // Matches COBOL string with specified quote character
  private matchCobolString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === quote) {
        // Check for doubled quote escape
        if (i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in COBOL
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Match EXEC/EXECUTE ... END-EXEC block
  private matchExecBlock(source: string, pos: number): ExcludedRegion | null {
    const upper = source.slice(pos, pos + 7).toUpperCase();
    const isExec = upper.startsWith('EXEC') && (source.length <= pos + 4 || !/[a-zA-Z0-9_-]/.test(source[pos + 4]));
    const isExecute = upper.startsWith('EXECUTE') && (source.length <= pos + 7 || !/[a-zA-Z0-9_-]/.test(source[pos + 7]));

    if (!isExec && !isExecute) {
      return null;
    }

    // Check word boundary before
    if (pos > 0 && /[a-zA-Z0-9_-]/.test(source[pos - 1])) {
      return null;
    }

    // Search for END-EXEC (case-insensitive), skipping string literals and inline comments
    const startWord = isExecute ? 'EXECUTE' : 'EXEC';
    let i = pos + startWord.length;
    while (i < source.length) {
      const ch = source[i];
      // Skip fixed-format column 7 comment lines inside EXEC block
      if (ch === '\n' || ch === '\r') {
        let lineStart = i + 1;
        if (ch === '\r' && lineStart < source.length && source[lineStart] === '\n') {
          lineStart++;
        }
        if (lineStart < source.length && this.isFixedFormatCommentLine(source, lineStart)) {
          i = lineStart;
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
            i++;
          }
          continue;
        }
        i = lineStart;
        continue;
      }
      // Skip *> inline comments inside EXEC block
      if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip single/double-quoted strings inside EXEC block
      if (ch === "'" || ch === '"') {
        i++;
        while (i < source.length) {
          if (source[i] === ch) {
            if (i + 1 < source.length && source[i + 1] === ch) {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (source[i] === '\n' || source[i] === '\r') {
            break;
          }
          i++;
        }
        continue;
      }
      // Check for END-EXEC keyword
      if ((ch === 'E' || ch === 'e') && i + 7 < source.length) {
        const candidate = source.slice(i, i + 8).toUpperCase();
        if (candidate === 'END-EXEC') {
          // Check word boundaries
          const beforeOk = i === 0 || !/[a-zA-Z0-9_-]/.test(source[i - 1]);
          const afterOk = i + 8 >= source.length || !/[a-zA-Z0-9_-]/.test(source[i + 8]);
          if (beforeOk && afterOk) {
            return { start: pos, end: i + 8 };
          }
        }
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Match pseudo-text delimiters ==...==
  private matchPseudoText(source: string, pos: number): ExcludedRegion | null {
    // Look for closing ==
    let i = pos + 2;
    while (i + 1 < source.length) {
      if (source[i] === '=' && source[i + 1] === '=') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Custom block matching for COBOL-specific pairing rules
  protected matchBlocks(tokens: import('../types').Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle': {
          if (stack.length > 0) {
            const middleValue = token.value.toLowerCase();
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            // ELSE only applies to IF blocks
            if (middleValue === 'else' && topOpener !== 'if') {
              break;
            }
            // WHEN only applies to EVALUATE and SEARCH blocks
            if (middleValue === 'when' && topOpener !== 'evaluate' && topOpener !== 'search') {
              break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;
        }

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          const validOpener = CLOSE_TO_OPEN[closeValue];

          if (validOpener) {
            const matchIndex = findLastOpenerByType(stack, validOpener, true);

            if (matchIndex >= 0) {
              const openBlock = stack.splice(matchIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          }
          break;
        }
      }
    }

    return pairs;
  }
}
