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

  // Validates block open: single-line 'if' and 'tell...to' one-liners are not blocks
  // Also rejects keywords used as variable names in 'set X to' / 'copy X to' patterns
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Check if this keyword is used as a variable/property name
    // Patterns: 'set X to', 'copy X to', 'get X', 'X of Y', 'Y's X'
    if (this.isKeywordAsVariableName(source, position, keyword)) {
      return false;
    }

    // 'tell ... to action' on one line is a one-liner, not a block
    if (keyword === 'tell') {
      return !this.isTellToOneLiner(source, position, excludedRegions);
    }

    if (keyword !== 'if') {
      return true;
    }

    // Find end of current line
    let lineEnd = position + keyword.length;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    // Search for 'then' after 'if', skipping excluded regions
    let i = position + keyword.length;
    let thenPos = -1;
    while (i < lineEnd) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      // Check for 'then' keyword
      if (
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !/\w/.test(source[i - 1])) &&
        (i + 4 >= source.length || !/\w/.test(source[i + 4]))
      ) {
        thenPos = i;
        break;
      }
      i++;
    }

    if (thenPos >= 0) {
      // Check if there's non-excluded content after 'then' on the same line
      let j = thenPos + 4;
      while (j < lineEnd) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
        if (source[j] !== ' ' && source[j] !== '\t' && source[j] !== '\r') {
          // Non-whitespace, non-excluded content after 'then' → single-line if
          return false;
        }
        j++;
      }
    }

    return true;
  }

  // Finds excluded regions: comments and strings
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

          // 'to' and 'on' are block openers only at line start (handler defs)
          if (type === 'block_open' && (keyword === 'to' || keyword === 'on')) {
            let lineStart = i;
            while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
              lineStart--;
            }
            if (!/^\s*$/.test(source.substring(lineStart, i))) {
              i = endPos;
              matched = true;
              break;
            }
          }

          // Validate block open keywords (e.g., single-line if)
          if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, i, excludedRegions)) {
            i = endPos;
            matched = true;
            break;
          }

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

  // Checks if 'tell' is followed by 'to' on the same line (one-liner form)
  private isTellToOneLiner(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineEnd = position + 4;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    let i = position + 4;
    while (i < lineEnd) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      if (
        source.slice(i, i + 2).toLowerCase() === 'to' &&
        (i === 0 || !/\w/.test(source[i - 1])) &&
        (i + 2 >= source.length || !/\w/.test(source[i + 2]))
      ) {
        return true;
      }
      i++;
    }
    return false;
  }

  // Checks if a block keyword is being used as a variable name
  // e.g., 'set repeat to 5', 'set script to "test"', 'copy tell to x'
  private isKeywordAsVariableName(source: string, position: number, keyword: string): boolean {
    const lowerSource = source.toLowerCase();
    // Find start of current line
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    const lineBefore = lowerSource.slice(lineStart, position).trimStart();

    // 'set <keyword> to' pattern
    if (/^set\s+$/.test(lineBefore)) {
      const afterKw = lowerSource.slice(position + keyword.length);
      if (/^\s+to\b/.test(afterKw)) {
        return true;
      }
    }

    // 'copy <keyword> to' pattern
    if (/^copy\s+$/.test(lineBefore)) {
      const afterKw = lowerSource.slice(position + keyword.length);
      if (/^\s+to\b/.test(afterKw)) {
        return true;
      }
    }

    // '<keyword> of' pattern (property access)
    const afterKw = lowerSource.slice(position + keyword.length);
    if (/^\s+of\b/.test(afterKw) && !/^\s*$/.test(lineBefore) && !/^(if|tell|repeat)\s/i.test(lineBefore.trimStart())) {
      return true;
    }

    return false;
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
