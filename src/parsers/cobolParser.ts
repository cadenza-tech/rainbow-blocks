// COBOL block parser: PERFORM->END-PERFORM, IF->END-IF, EVALUATE->END-EVALUATE

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import type { CobolHelperCallbacks } from './cobolHelpers';
import { isInPseudoTextContext, matchExecBlock, matchPseudoText, skipBackwardWhitespaceAndComments } from './cobolHelpers';
import { findLastOpenerByType } from './parserUtils';

// COBOL verbs that take data-name operands. When a reserved word like WHEN/ELSE
// immediately follows one of these on the same line, treat it as an identifier.
const DATA_NAME_VERBS = new Set([
  'MOVE',
  'ADD',
  'SUBTRACT',
  'MULTIPLY',
  'DIVIDE',
  'COMPUTE',
  'SET',
  'DISPLAY',
  'ACCEPT',
  'INSPECT',
  'STRING',
  'UNSTRING',
  'INITIALIZE',
  'TO',
  'INTO',
  'FROM',
  'OF',
  'IN',
  'USING',
  'AT',
  // Arithmetic operand introducers: MULTIPLY A BY <data>, DIVIDE A BY <data>
  'BY',
  // Result data name: ADD/SUBTRACT/MULTIPLY/DIVIDE ... GIVING <data>
  'GIVING',
  // DIVIDE ... REMAINDER <data>
  'REMAINDER'
]);

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

  private get helperCallbacks(): CobolHelperCallbacks {
    return {
      isFixedFormatCommentLine: (source, lineStart) => this.isFixedFormatCommentLine(source, lineStart)
    };
  }

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
      // Skip keywords in the fixed-format identification area (cols 73-80, 0-based 72+).
      // This must mirror the same exclusion in tokenize() — otherwise a fake opener at
      // col >= 72 may pair with the real closer here, then be dropped by tokenize, leaving
      // the real opener unmatched.
      let lineStart = pos;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      const column = pos - lineStart;
      if (column >= 72 && lineStart + 6 <= source.length) {
        const sequenceArea = source.slice(lineStart, lineStart + 6);
        if (/^[ \t\d]{6}$/.test(sequenceArea)) {
          continue;
        }
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
              // Check for PERFORM <variable> TIMES pattern (accept both alpha and numeric counts)
              const secondWord = afterNextWord.match(/^[ \t]+([a-zA-Z0-9][a-zA-Z0-9_-]*)/i);
              // PERFORM TEST BEFORE/AFTER ... is a structured form (WITH is optional per COBOL standard)
              if (word === 'test' && secondWord) {
                const sw = secondWord[1].toLowerCase();
                if (sw === 'before' || sw === 'after') {
                  openerPositions.push(pos);
                  continue;
                }
              }
              if (secondWord && secondWord[1].toLowerCase() === 'times') {
                // PERFORM <variable> TIMES → structured block, accept
              } else if (
                secondWord &&
                (secondWord[1].toLowerCase() === 'thru' ||
                  secondWord[1].toLowerCase() === 'through' ||
                  secondWord[1].toLowerCase() === 'until' ||
                  secondWord[1].toLowerCase() === 'varying' ||
                  secondWord[1].toLowerCase() === 'with' ||
                  secondWord[1].toLowerCase() === 'after' ||
                  secondWord[1].toLowerCase() === 'before')
              ) {
                // PERFORM para THRU/THROUGH/UNTIL/VARYING/WITH/AFTER/BEFORE → paragraph call with iteration, reject
                continue;
              } else if (secondWord) {
                // Check for PERFORM <para> <count> TIMES pattern (paragraph call with iteration count)
                const afterSecondWord = afterNextWord.slice(secondWord[0].length);
                const thirdWord = afterSecondWord.match(/^[ \t]+([a-zA-Z][a-zA-Z0-9_-]*)/i);
                if (thirdWord && thirdWord[1].toLowerCase() === 'times') {
                  // PERFORM para <count> TIMES → paragraph call with iteration, reject
                  continue;
                }
                // PERFORM <para-name> <extra-token> with no recognised iteration verb is
                // a paragraph call with stray text (or invalid syntax). Reject so we do
                // not mark it as a structured PERFORM.
                const isBlockOpenerVerb = this.keywords.blockOpen.some((kw) => kw === word);
                if (!isBlockOpenerVerb) {
                  continue;
                }
                openerPositions.push(pos);
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

  // Checks if keyword position is part of a COPY statement (e.g., `COPY END-IF.`)
  // where the keyword is being used as a copybook/filename, not as a block close
  private isInCopyStatement(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '\n' || ch === '\r' || ch === '.') {
        break;
      }
      i--;
    }
    let j = i + 1;
    while (j < position && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
    if (j + 4 > position) return false;
    const candidate = source.slice(j, j + 4).toUpperCase();
    if (candidate !== 'COPY') return false;
    const afterCopy = source[j + 4];
    if (afterCopy && afterCopy !== ' ' && afterCopy !== '\t') return false;
    return true;
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

      // Skip keywords used as filename in COPY statements (e.g., COPY END-IF.)
      if (type === 'block_close' && this.isInCopyStatement(source, startOffset, excludedRegions)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      // Skip keywords in the fixed-format identification area (columns 73-80, 0-based 72+).
      // Detect fixed format by checking the 6-char sequence area (cols 1-6) on the same line:
      // it must consist of digits and whitespace only.
      if (column >= 72) {
        const lineStart = startOffset - column;
        if (lineStart + 6 <= source.length) {
          const sequenceArea = source.slice(lineStart, lineStart + 6);
          if (/^[ \t\d]{6}$/.test(sequenceArea)) {
            continue;
          }
        }
      }

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset,
        line,
        column
      });
    }

    // Filter WHEN/ELSE used as data names (e.g., MOVE ELSE TO Y, ADD WHEN TO Y, COMPUTE Y = X + ELSE).
    return tokens.filter((token) => {
      if (token.type !== 'block_middle') return true;
      const lower = token.value.toLowerCase();
      if (lower !== 'when' && lower !== 'else') return true;
      if (this.isPrecedingWordDataNameVerb(source, token.startOffset)) return false;
      if (this.isInExpressionContext(source, token.startOffset)) return false;
      return true;
    });
  }

  // Returns true when the immediately preceding word on the same line is a COBOL verb
  // that takes data names as operands (so the keyword is being used as an identifier,
  // not as a control-flow intermediate). Skips intervening *> inline comments,
  // fixed-format column-7 comment lines, and >> compiler directive lines so multi-line
  // statements like
  //   MOVE
  //   *> comment
  //   ELSE TO Y
  // are recognized as data-name verb contexts. String literals are not skipped, since a
  // string source operand consumes the data-name slot (e.g., DISPLAY "yes"\nELSE leaves
  // ELSE as an IF intermediate, not a data name).
  private isPrecedingWordDataNameVerb(source: string, position: number): boolean {
    const i = skipBackwardWhitespaceAndComments(source, position - 1, this.helperCallbacks);
    if (i < 0) return false;
    const wordEnd = i + 1;
    let wordStart = i;
    while (wordStart > 0 && /[a-zA-Z0-9_-]/.test(source[wordStart - 1])) wordStart--;
    const word = source.slice(wordStart, wordEnd).toUpperCase();
    return DATA_NAME_VERBS.has(word);
  }

  // Returns true when the keyword is preceded by an expression-context character
  // (arithmetic operator, separator, or open parenthesis), indicating that the
  // keyword is used as an operand/data name rather than a control-flow intermediate.
  // Examples: `COMPUTE Y = X + ELSE`, `CALL "P" USING A, ELSE`, `(ELSE + 1)`.
  private isInExpressionContext(source: string, position: number): boolean {
    let i = position - 1;
    // Skip whitespace including newlines (continuation across lines is permitted).
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i--;
    if (i < 0) return false;
    const ch = source[i];
    // Arithmetic operators: + - * / = < >
    // Separators: , ;
    // Parentheses: ( )
    // Note: `**` is two `*` characters, so checking `*` covers it.
    return (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '=' ||
      ch === '<' ||
      ch === '>' ||
      ch === ',' ||
      ch === ';' ||
      ch === '(' ||
      ch === ')'
    );
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
      const execRegion = matchExecBlock(source, pos, this.helperCallbacks);
      if (execRegion) {
        return execRegion;
      }
    }

    // Pseudo-text delimiter ==...== (only in COPY REPLACING / REPLACE context)
    if (char === '=' && pos + 1 < source.length && source[pos + 1] === '=') {
      if (isInPseudoTextContext(source, pos, this.helperCallbacks)) {
        return matchPseudoText(source, pos);
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

  // Matches COBOL string with specified quote character. Supports fixed-format continuation
  // lines (column-7 `-`): when the literal hits a newline unterminated, the next non-blank,
  // non-comment line beginning with `-` in column 7 followed by a matching opening quote
  // continues the literal.
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
      // String hit a newline - check for fixed-format continuation
      if (source[i] === '\n' || source[i] === '\r') {
        const continuation = this.findFixedFormStringContinuation(source, i, quote);
        if (continuation === null) {
          return { start: pos, end: i };
        }
        i = continuation;
        continue;
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Locates a fixed-format string-literal continuation starting at or after `newlinePos`.
  // Skips blank and column-7 comment lines before looking for a continuation indicator.
  // Returns the position immediately after the opening quote on the continuation line, or
  // null when no valid continuation is present.
  private findFixedFormStringContinuation(source: string, newlinePos: number, quote: string): number | null {
    let i = newlinePos;
    while (i < source.length) {
      // Advance past the newline character(s) (CRLF, LF, or CR-only)
      if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
        i += 2;
      } else if (source[i] === '\n' || source[i] === '\r') {
        i += 1;
      } else {
        return null;
      }
      if (i >= source.length) return null;

      const lineStart = i;

      // Walk to visual column 6 (i.e., column 7 in 1-indexed COBOL columns)
      let visualCol = 0;
      let j = i;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r' && visualCol < 6) {
        if (source[j] === '\t') {
          visualCol = Math.floor(visualCol / 8 + 1) * 8;
        } else {
          visualCol++;
        }
        j++;
      }

      // Line shorter than 7 columns: blank line is allowed (skip), otherwise no continuation
      if (visualCol !== 6 || j >= source.length || source[j] === '\n' || source[j] === '\r') {
        const lineContent = source.slice(lineStart, j);
        if (/^[ \t]*$/.test(lineContent)) {
          i = j;
          continue;
        }
        return null;
      }

      // Sequence area (columns 1-6) must be digits/whitespace
      const sequenceArea = source.slice(lineStart, j);
      if (!/^[\d \t]*$/.test(sequenceArea)) {
        return null;
      }

      const indicator = source[j];

      // Whitespace-only line beyond column 7 is a blank line and should be skipped
      // (per COBOL spec, blank lines between continuation halves are ignored).
      if (indicator === ' ' || indicator === '\t') {
        let k = j;
        while (k < source.length && source[k] !== '\n' && source[k] !== '\r') {
          if (source[k] !== ' ' && source[k] !== '\t') break;
          k++;
        }
        if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
          i = k;
          continue;
        }
      }

      // Comment lines (`*`, `/` at column 7): skip
      if (indicator === '*' || indicator === '/') {
        while (j < source.length && source[j] !== '\n' && source[j] !== '\r') j++;
        i = j;
        continue;
      }
      // Debug indicator `D`/`d`: only treat as comment when there is at least one digit
      // in the sequence area AND the next char (column 8) is not an identifier char
      // (mirrors isFixedFormatCommentLine logic).
      if (indicator === 'D' || indicator === 'd') {
        const hasSequenceDigit = /\d/.test(sequenceArea);
        const nextCh = source[j + 1];
        const isIdentifierChar = nextCh !== undefined && /[a-zA-Z0-9_-]/.test(nextCh);
        if (hasSequenceDigit && !isIdentifierChar) {
          while (j < source.length && source[j] !== '\n' && source[j] !== '\r') j++;
          i = j;
          continue;
        }
      }

      // Continuation indicator must be `-`
      if (indicator !== '-') {
        return null;
      }

      // Past the `-`, scan area B for a matching opening quote. Per COBOL spec the gap
      // between the indicator and the continuation quote is typically blank, but any
      // non-blank text there is part of continuation processing — include it in the
      // excluded region so that COBOL keywords appearing as padding text are not
      // tokenised as block keywords.
      j++;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === quote) {
          return j + 1;
        }
        j++;
      }
      return null;
    }
    return null;
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
