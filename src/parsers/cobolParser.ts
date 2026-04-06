// COBOL block parser: PERFORM→END-PERFORM, IF→END-IF, EVALUATE→END-EVALUATE

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
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
      // Skip keywords adjacent to Unicode letters (consistent with tokenize)
      if (this.isAdjacentToUnicodeLetter(source, pos, match[0].length)) {
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
            if (word === `end-${lowerKeyword}`) {
              // The next word is the matching END-PERFORM closer, not a paragraph name
            } else if (word !== 'until' && word !== 'varying' && word !== 'with') {
              const afterNextWord = afterInner.slice(nextWord[0].length);
              // Check for PERFORM <variable> TIMES pattern
              const secondWord = afterNextWord.match(/^[ \t]+([a-zA-Z][a-zA-Z0-9_-]*)/i);
              if (secondWord && secondWord[1].toLowerCase() === 'times') {
                // PERFORM <variable> TIMES → structured block, accept
              } else if (
                secondWord &&
                (secondWord[1].toLowerCase() === 'thru' ||
                  secondWord[1].toLowerCase() === 'through' ||
                  secondWord[1].toLowerCase() === 'until' ||
                  secondWord[1].toLowerCase() === 'varying' ||
                  secondWord[1].toLowerCase() === 'with')
              ) {
                // PERFORM para THRU/THROUGH/UNTIL/VARYING/WITH → paragraph call with iteration, reject
                continue;
              } else {
                // Check if only whitespace/newline/period follows the first word (paragraph call)
                // If there's more content on the same line, it's likely a block PERFORM with inline statements
                // Exception: if the word is a known COBOL block opener verb (DISPLAY, IF, etc.),
                // it's an inline statement even when alone on the line (e.g., PERFORM DISPLAY\nEND-PERFORM)
                const isBlockOpenerVerb = this.keywords.blockOpen.some((kw) => kw === word);
                if (!isBlockOpenerVerb) {
                  // Strip inline COBOL comments (*>) before checking
                  const afterNextWordNoComment = afterNextWord.replace(/\*>.*|>>.*/, '');
                  const hasMoreContent = afterNextWordNoComment.match(/^[ \t]*([^\n\r. \t])/);
                  if (!hasMoreContent) {
                    continue;
                  }
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

      // Skip keywords adjacent to Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

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

      // Validate block close keywords
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
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
            // In fixed-format (sequence area contains at least one digit),
            // D/d at column 7 is always a debug indicator regardless of what follows
            const hasDigit = /\d/.test(sequenceArea);
            if (!hasDigit) {
              const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
              if (/[a-zA-Z0-9_-]/.test(nextChar)) {
                return null;
              }
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

    // Pseudo-text delimiter ==...== (only in COPY REPLACING / REPLACE context)
    if (char === '=' && pos + 1 < source.length && source[pos + 1] === '=') {
      if (this.isInPseudoTextContext(source, pos)) {
        return this.matchPseudoText(source, pos);
      }
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
    if (!/^[\d \t]*$/.test(sequenceArea)) {
      return false;
    }
    // D/d special handling: in free-format (no digits in sequence area),
    // only treat as comment if next char is not alphanumeric
    if (indicator === 'D' || indicator === 'd') {
      const hasDigit = /\d/.test(sequenceArea);
      if (!hasDigit) {
        const nextChar = i + 1 < source.length ? source[i + 1] : '';
        if (/[a-zA-Z0-9_-]/.test(nextChar)) {
          return false;
        }
      }
    }
    return true;
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

    // Verify a recognized sub-language keyword follows
    const startWord = isExecute ? 'EXECUTE' : 'EXEC';
    const afterExec = source.slice(pos + startWord.length).match(/^[ \t]+([a-zA-Z]+)/);
    if (!afterExec || !/^(SQL|CICS|DLI|SQLIMS|HTML|XML|JAVA|ADO|ADABAS|DB2|IMS|IDMS|ORACLE|DATACOM)$/i.test(afterExec[1])) {
      return null;
    }

    // Search for END-EXEC (case-insensitive), skipping string literals and inline comments
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
      // Skip >> compiler directives inside EXEC block
      if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
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
      // Skip pseudo-text delimiters ==...== inside EXEC block
      if (ch === '=' && i + 1 < source.length && source[i + 1] === '=') {
        const savedPos = i;
        i += 2;
        let foundClose = false;
        while (i + 1 < source.length) {
          if (source[i] === '=' && source[i + 1] === '=') {
            i += 2;
            foundClose = true;
            break;
          }
          i++;
        }
        if (!foundClose) {
          i = savedPos + 2;
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
      // Check for END-EXECUTE keyword (11 chars, must check before END-EXEC)
      if ((ch === 'E' || ch === 'e') && i + 10 < source.length) {
        const candidate11 = source.slice(i, i + 11).toUpperCase();
        if (candidate11 === 'END-EXECUTE') {
          const beforeOk = i === 0 || !/[a-zA-Z0-9_-]/.test(source[i - 1]);
          const afterOk = i + 11 >= source.length || !/[a-zA-Z0-9_-]/.test(source[i + 11]);
          if (beforeOk && afterOk) {
            return { start: pos, end: i + 11 };
          }
        }
      }
      // Check for END-EXEC keyword (8 chars)
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

  // Checks if == at pos is in a COPY REPLACING or REPLACE statement context
  // Scans backward for REPLACING, REPLACE, or BY keywords (preceded by another ==...==)
  private isInPseudoTextContext(source: string, pos: number): boolean {
    // Scan backward from pos, skipping whitespace and newlines, looking for context keywords
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
      i--;
    }
    // If preceded by closing == of another pseudo-text, scan backward through the == chain
    // to find the actual context keyword (REPLACING/REPLACE) and verify COPY context
    if (i >= 1 && source[i] === '=' && source[i - 1] === '=') {
      return this.isPrecededByReplacingOrReplace(source, i);
    }
    // Extract the word ending at position i
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z]/.test(source[i])) {
      i--;
    }
    const word = source.slice(i + 1, wordEnd).toUpperCase();
    // REPLACE (in REPLACE ==old== BY ==new==) - standalone statement
    if (word === 'REPLACE') {
      return true;
    }
    // REPLACING (in COPY ... REPLACING ==old== BY ==new==) - must be in a COPY statement
    if (word === 'REPLACING') {
      return this.isInCopyStatement(source, i);
    }
    // ALSO (in REPLACE ALSO ==old== BY ==new==) - must be preceded by REPLACE, not EVALUATE
    if (word === 'ALSO') {
      return this.isPrecededByKeyword(source, i, 'REPLACE');
    }
    // BY (in ==old== BY ==new==) - must be preceded by REPLACING (in COPY context), REPLACE, or ALSO
    if (word === 'BY') {
      return this.isPrecededByReplacingOrReplace(source, i);
    }
    return false;
  }

  // Checks if position is within a COPY statement by looking for COPY before the last period
  // Scans backward for COPY, skipping content inside strings, comments, and directive lines
  private isInCopyStatement(source: string, posBeforeKeyword: number): boolean {
    const beforeKeyword = source.slice(0, posBeforeKeyword + 1);
    const lastPeriod = this.findLastPeriodOutsideStrings(beforeKeyword);
    const stmtStart = lastPeriod + 1;
    // Search for COPY word-boundary match, verifying each match is not inside a string or comment
    const copyPattern = /\bCOPY\b/gi;
    const statement = beforeKeyword.slice(stmtStart);
    for (const match of statement.matchAll(copyPattern)) {
      const absPos = stmtStart + match.index;
      // Skip if on a fixed-format comment line or >> compiler directive line
      if (this.isOnExcludedLine(source, absPos)) continue;
      // Quick check: skip if inside a quoted string (scan backward for unmatched quote)
      let inString = false;
      for (let k = stmtStart; k < absPos; k++) {
        if (source[k] === "'" || source[k] === '"') {
          const quote = source[k];
          k++;
          while (k < absPos) {
            if (source[k] === quote) {
              if (k + 1 < source.length && source[k + 1] === quote) {
                k += 2;
                continue;
              }
              break;
            }
            // String cannot span multiple lines in COBOL
            if (source[k] === '\n' || source[k] === '\r') {
              break;
            }
            k++;
          }
          if (k >= absPos) {
            inString = true;
            break;
          }
        } else if (source[k] === '*' && k + 1 < source.length && source[k + 1] === '>') {
          // Skip inline comment *> to end of line
          k += 2;
          while (k < absPos && source[k] !== '\n' && source[k] !== '\r') k++;
          if (k >= absPos) {
            inString = true;
            break;
          }
        }
      }
      if (!inString) return true;
    }
    return false;
  }

  // Finds the last period that is not inside a string literal, inline comment, compiler directive, or column-7 comment line
  // Scans forward tracking quote state with COBOL doubled-quote escaping ('' and "")
  private findLastPeriodOutsideStrings(text: string): number {
    let lastPeriod = -1;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      // Skip *> inline comments to end of line
      if (ch === '*' && i + 1 < text.length && text[i + 1] === '>') {
        i += 2;
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip >> compiler directives to end of line
      if (ch === '>' && i + 1 < text.length && text[i + 1] === '>') {
        i += 2;
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
          i++;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === ch) {
            if (i + 1 < text.length && text[i + 1] === ch) {
              i += 2;
              continue;
            }
            break;
          }
          // String cannot span multiple lines in COBOL
          if (text[i] === '\n' || text[i] === '\r') {
            break;
          }
          i++;
        }
        i++;
        continue;
      }
      if (ch === '.') {
        if (!this.isOnFixedFormatCommentLine(text, i)) {
          lastPeriod = i;
        }
      }
      i++;
    }
    return lastPeriod;
  }

  // Checks if the given position is on a fixed-format column 7 comment line (*, /, D, d)
  private isOnFixedFormatCommentLine(source: string, pos: number): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    return this.isFixedFormatCommentLine(source, lineStart);
  }

  // Checks if the given position is on a fixed-format comment line or >> compiler directive line
  private isOnExcludedLine(source: string, pos: number): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    // Check fixed-format column 7 comment line
    if (this.isFixedFormatCommentLine(source, lineStart)) return true;
    // Check >> compiler directive line (skip leading whitespace)
    let j = lineStart;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j + 1 < source.length && source[j] === '>' && source[j + 1] === '>') return true;
    return false;
  }

  // Scans backward through pseudo-text blocks and BY keywords to find REPLACING or REPLACE
  // For REPLACING, additionally verifies it is part of a COPY statement
  private isPrecededByReplacingOrReplace(source: string, posEnd: number): boolean {
    const replacingPos = this.findPrecedingKeywordPosition(source, posEnd, 'REPLACING');
    if (replacingPos >= 0) {
      return this.isInCopyStatement(source, replacingPos);
    }
    if (this.isPrecededByKeyword(source, posEnd, 'REPLACE')) {
      return true;
    }
    return this.isPrecededByKeyword(source, posEnd, 'ALSO');
  }

  // Scans backward from position i to check if the preceding word matches target keyword
  // Skips whitespace, pseudo-text (==...==), and BY keywords between replacement pairs
  private isPrecededByKeyword(source: string, i: number, target: string): boolean {
    let j = i;
    // Skip whitespace
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    if (j < 0) {
      return false;
    }
    // Skip multiple consecutive pseudo-text blocks and BY keywords
    // (e.g., ==a== BY ==b== ==c== BY ==d== ← need to traverse all to reach REPLACING)
    while (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
      j -= 2;
      // Skip pseudo-text content to find opening ==
      while (j >= 1) {
        if (source[j] === '=' && source[j - 1] === '=') {
          j -= 2;
          break;
        }
        j--;
      }
      // Skip whitespace
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      if (j < 0) {
        return false;
      }
      // If we landed on another closing ==, let the loop handle it directly
      if (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
        continue;
      }
      // Check if the preceding word is BY; if so, skip it and continue the loop
      const byEnd = j + 1;
      let byStart = j;
      while (byStart >= 0 && /[a-zA-Z]/.test(source[byStart])) {
        byStart--;
      }
      const byWord = source.slice(byStart + 1, byEnd).toUpperCase();
      if (byWord !== 'BY') {
        break;
      }
      // Skip past BY and whitespace, then continue to next pseudo-text block
      j = byStart;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      if (j < 0) {
        return false;
      }
    }
    // Extract the preceding word
    const wordEnd = j + 1;
    while (j >= 0 && /[a-zA-Z]/.test(source[j])) {
      j--;
    }
    const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
    return prevWord === target;
  }

  // Like isPrecededByKeyword but returns the position before the found keyword (for context verification)
  // Returns -1 if the target keyword is not found
  private findPrecedingKeywordPosition(source: string, i: number, target: string): number {
    let j = i;
    // Skip whitespace
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    if (j < 0) {
      return -1;
    }
    // Skip multiple consecutive pseudo-text blocks and BY keywords
    while (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
      j -= 2;
      // Skip pseudo-text content to find opening ==
      while (j >= 1) {
        if (source[j] === '=' && source[j - 1] === '=') {
          j -= 2;
          break;
        }
        j--;
      }
      // Skip whitespace
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      if (j < 0) {
        return -1;
      }
      // If we landed on another closing ==, let the loop handle it directly
      if (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
        continue;
      }
      // Check if the preceding word is BY; if so, skip it and continue the loop
      const byEnd = j + 1;
      let byStart = j;
      while (byStart >= 0 && /[a-zA-Z]/.test(source[byStart])) {
        byStart--;
      }
      const byWord = source.slice(byStart + 1, byEnd).toUpperCase();
      if (byWord !== 'BY') {
        break;
      }
      // Skip past BY and whitespace, then continue to next pseudo-text block
      j = byStart;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      if (j < 0) {
        return -1;
      }
    }
    // Extract the preceding word
    const wordEnd = j + 1;
    while (j >= 0 && /[a-zA-Z]/.test(source[j])) {
      j--;
    }
    const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
    if (prevWord === target) {
      return j;
    }
    return -1;
  }

  // Match pseudo-text delimiters ==...==
  private matchPseudoText(source: string, pos: number): ExcludedRegion {
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
