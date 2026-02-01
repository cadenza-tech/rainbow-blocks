// AppleScript block parser: handles compound keywords (end tell), nested comments, case-insensitive matching

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Mapping from compound end keywords to their opening keywords
const END_KEYWORD_MAP: Readonly<Record<string, string>> = {
  'end tell': 'tell',
  'end if': 'if',
  'end repeat': 'repeat',
  'end try': 'try',
  'end considering': 'considering',
  'end ignoring': 'ignoring',
  'end using terms from': 'using terms from',
  'end timeout': 'with timeout',
  'end transaction': 'with transaction',
  'end script': 'script'
};

// All compound keywords sorted by length (longest first) for matching
const COMPOUND_KEYWORDS = [
  'using terms from',
  'end using terms from',
  'with transaction',
  'end transaction',
  'end considering',
  'with timeout',
  'end ignoring',
  'end timeout',
  'end repeat',
  'end script',
  'end tell',
  'end try',
  'on error',
  'else if',
  'end if'
];

export class ApplescriptBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'tell',
      'if',
      'repeat',
      'try',
      'considering',
      'ignoring',
      'using terms from',
      'with timeout',
      'with transaction',
      'script',
      'on',
      'to'
    ],
    blockClose: [
      'end',
      'end tell',
      'end if',
      'end repeat',
      'end try',
      'end considering',
      'end ignoring',
      'end using terms from',
      'end timeout',
      'end transaction',
      'end script'
    ],
    blockMiddle: ['else', 'else if', 'on error']
  };

  // Finds excluded regions: comments (3 styles), strings
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: -- to end of line
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-line comment: # to end of line (AppleScript 2.0+)
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: (* *) with nesting support
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchNestedComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    return null;
  }

  // Matches nested multi-line comment: (* ... *)
  private matchNestedComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length && depth > 0) {
      if (source[i] === '(' && i + 1 < source.length && source[i + 1] === '*') {
        depth++;
        i += 2;
        continue;
      }
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === ')') {
        depth--;
        i += 2;
        continue;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Override tokenize to handle compound keywords and case-insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const newlinePositions = this.buildNewlinePositions(source);
    const lowerSource = source.toLowerCase();
    let i = 0;

    while (i < source.length) {
      // Skip excluded regions
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }

      // Check word boundary at start
      if (i > 0 && /\w/.test(source[i - 1])) {
        i++;
        continue;
      }

      // Try to match compound keywords first (longest first)
      let matched = false;
      for (const keyword of COMPOUND_KEYWORDS) {
        if (lowerSource.slice(i, i + keyword.length) === keyword) {
          // Check word boundary at end
          const endPos = i + keyword.length;
          if (endPos < source.length && /\w/.test(source[endPos])) {
            continue;
          }

          const type = this.getTokenType(keyword);
          const { line, column } = this.getLineAndColumn(i, newlinePositions);

          tokens.push({
            type,
            value: keyword,
            startOffset: i,
            endOffset: endPos,
            line,
            column
          });

          i = endPos;
          matched = true;
          break;
        }
      }

      if (matched) {
        continue;
      }

      // Try to match single-word keywords
      const singleKeywords = ['tell', 'if', 'repeat', 'try', 'considering', 'ignoring', 'script', 'on', 'to', 'else', 'end'];

      for (const keyword of singleKeywords) {
        if (lowerSource.slice(i, i + keyword.length) === keyword) {
          const endPos = i + keyword.length;
          if (endPos < source.length && /\w/.test(source[endPos])) {
            continue;
          }

          const type = this.getTokenType(keyword);
          const { line, column } = this.getLineAndColumn(i, newlinePositions);

          tokens.push({
            type,
            value: keyword,
            startOffset: i,
            endOffset: endPos,
            line,
            column
          });

          i = endPos;
          matched = true;
          break;
        }
      }

      if (!matched) {
        i++;
      }
    }

    return tokens;
  }

  // Matches blocks with specific pairing for compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value;
          let matchIndex = -1;

          // Check for specific end keyword (end tell, end if, etc.)
          const expectedOpener = END_KEYWORD_MAP[closeValue];
          if (expectedOpener) {
            matchIndex = this.findLastOpenerIndex(stack, expectedOpener);
          } else {
            // Generic "end" closes any block
            matchIndex = stack.length > 0 ? stack.length - 1 : -1;
          }

          if (matchIndex >= 0) {
            const openBlock = stack.splice(matchIndex, 1)[0];
            pairs.push({
              openKeyword: openBlock.token,
              closeKeyword: token,
              intermediates: openBlock.intermediates,
              nestLevel: stack.length
            });
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Finds the index of the last opener with the given keyword
  private findLastOpenerIndex(stack: OpenBlock[], opener: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value === opener) {
        return i;
      }
    }
    return -1;
  }
}
