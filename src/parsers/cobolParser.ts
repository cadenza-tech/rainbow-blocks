// COBOL block parser: PERFORM->END-PERFORM, IF->END-IF, EVALUATE->END-EVALUATE

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  getVisualColumn,
  isFixedFormatCommentLine,
  isInExpressionContext,
  isPrecedingWordDataNameVerb,
  isPrecedingWordDataNameVerbSameLine,
  matchCobolString
} from './cobolFixedFormat';
import type { CobolHelperCallbacks } from './cobolHelpers';
import {
  isInCopyStatement as isInCopyStatementHelper,
  isInPseudoTextContext,
  isUnicodeIdentifierChar,
  matchExecBlock,
  matchPseudoText
} from './cobolHelpers';
import { buildPeriodPositions, findBlockVerbAfterCopybook, getPseudoTextStarts } from './cobolPseudoText';
import { buildCaseInsensitiveKeywordPattern, findLastOpenerByType } from './parserUtils';

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
      isFixedFormatCommentLine: (source, lineStart) => this.isFixedFormatCommentLine(source, lineStart),
      isInCopyStatementCached: (posBeforeKeyword) => this.isInCopyStatementCached(posBeforeKeyword),
      pseudoChainWalkCache: this.cachedPseudoChainWalk,
      findLineStart: (pos) => this.findLineStart(pos),
      firstInlineCommentFrom: (lineStart, endInclusive) => this.firstInlineCommentFrom(lineStart, endInclusive)
    };
  }

  // Regex cache for combined patterns
  private readonly regexCache = new Map<string, RegExp>();

  // Cache of valid opener positions per keyword type, computed once per parse
  private validOpenPositions = new Map<string, Set<number>>();

  // Per-parse caches reset at the start of each findExcludedRegions() call.
  // These let pseudo-text / COPY-context queries run in roughly O(log n) per
  // call instead of O(n^2), preventing super-linear blowups on large COPY
  // REPLACING blocks.
  private cachedSource: string | null = null;
  private cachedPeriods: number[] | null = null;
  private cachedCopyStatement = new Map<number, boolean>();
  // Positions of `==` characters that begin a pseudo-text delimiter region.
  // Precomputed in O(n) at the start of each parse via a single forward scan
  // that tracks COPY REPLACING / REPLACE statement context, eliminating the
  // per-`==` backward walk that previously gave O(n^2) behaviour for large
  // multi-pair COPY REPLACING blocks.
  private cachedPseudoTextStarts: Set<number> | null = null;
  // Per-parse memo for the backward `==`-chain walk in cobolHelpers. Keyed by the
  // right-end offset of a closing `==`. A long run of consecutive `=` (a divider
  // banner like `====...`) falls through to the per-position pseudo-text check,
  // whose backward walk would otherwise re-scan all preceding `==` pairs — O(n^2)
  // per pass, O(n^3) overall. Memoizing the walk per parse makes it O(n).
  private cachedPseudoChainWalk = new Map<number, number>();
  // Newline offsets and `*>` inline-comment offsets, precomputed once per parse so
  // cobolHelpers' backward scans can locate line starts and inline comments in
  // O(log n) instead of re-walking the line on every `==`.
  private cachedNewlines: number[] | null = null;
  private cachedInlineComments: number[] | null = null;

  // Override findExcludedRegions to reset per-parse caches before scanning.
  // Without this, repeated parser.parse() calls on different sources would
  // reuse stale cached data.
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    if (this.cachedSource !== source) {
      this.cachedSource = source;
      this.cachedPeriods = null;
      this.cachedCopyStatement.clear();
      this.cachedPseudoTextStarts = null;
      this.cachedPseudoChainWalk.clear();
      this.cachedNewlines = null;
      this.cachedInlineComments = null;
    }
    return super.findExcludedRegions(source);
  }

  // Returns offset of the last period outside strings/comments at or before
  // `endExclusive`. Computed in O(n) once per parse via the cached period
  // array, then served in O(log n) per call.
  private findLastPeriodOutsideStringsBefore(endExclusive: number): number {
    if (this.cachedSource === null) return -1;
    if (this.cachedPeriods === null) {
      this.cachedPeriods = this.buildPeriodPositions(this.cachedSource);
    }
    const periods = this.cachedPeriods;
    // Binary search for the largest period <= endExclusive
    let lo = 0;
    let hi = periods.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (periods[mid] <= endExclusive) {
        result = periods[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }

  // Single-pass scan to collect all period positions outside strings/comments/comment-lines
  private buildPeriodPositions(source: string): number[] {
    return buildPeriodPositions(source);
  }

  // Returns the start offset of the line containing `pos` (just after the prior
  // \n/\r, or 0). Uses a per-parse newline table for O(log n) lookup.
  private findLineStart(pos: number): number {
    if (this.cachedSource === null) return 0;
    if (this.cachedNewlines === null) {
      this.cachedNewlines = this.buildNewlinePositions(this.cachedSource);
    }
    const newlines = this.cachedNewlines;
    // Binary search for the largest newline offset < pos; the line starts after it.
    let lo = 0;
    let hi = newlines.length - 1;
    let lastNewline = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (newlines[mid] < pos) {
        lastNewline = newlines[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return lastNewline + 1;
  }

  // Returns the offset of the first `*>` inline-comment marker fully contained in
  // [lineStart, endInclusive] (i.e., both the `*` and `>` are within range), or -1
  // if none. Mirrors the plain-substring semantics of the previous
  // `source.slice(lineStart, endInclusive + 1).indexOf('*>')` scan (which requires
  // both characters to fall inside the slice) using a per-parse sorted table of
  // every `*>` occurrence for O(log n) lookup.
  private firstInlineCommentFrom(lineStart: number, endInclusive: number): number {
    if (this.cachedSource === null) return -1;
    if (this.cachedInlineComments === null) {
      this.cachedInlineComments = this.buildInlineCommentPositions(this.cachedSource);
    }
    const markers = this.cachedInlineComments;
    // Binary search for the smallest marker offset >= lineStart.
    let lo = 0;
    let hi = markers.length - 1;
    let candidate = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (markers[mid] >= lineStart) {
        candidate = markers[mid];
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    // The marker spans [candidate, candidate + 1]; require its `>` to be at or
    // before endInclusive so it matches the original slice that excluded a
    // trailing lone `*`.
    if (candidate === -1 || candidate + 1 > endInclusive) return -1;
    return candidate;
  }

  // Single-pass scan collecting the offset of every `*>` two-character sequence.
  private buildInlineCommentPositions(source: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i + 1 < source.length; i++) {
      if (source[i] === '*' && source[i + 1] === '>') {
        positions.push(i);
      }
    }
    return positions;
  }

  // Builds (lazily, once per parse) the set of `==` offsets that begin a pseudo-text region
  private getPseudoTextStarts(source: string): Set<number> {
    if (this.cachedPseudoTextStarts !== null && this.cachedSource === source) {
      return this.cachedPseudoTextStarts;
    }
    const starts = getPseudoTextStarts(source, this.helperCallbacks);
    this.cachedPseudoTextStarts = starts;
    return starts;
  }

  // Cached wrapper around the helper isInCopyStatement. Without this, every
  // `==` pseudo-text check re-scans the source for COPY and rebuilds string
  // exclusions, which is O(n^2) per call and produces O(n^3) overall for
  // COPY REPLACING blocks with many pseudo-text pairs.
  private isInCopyStatementCached(posBeforeKeyword: number): boolean {
    const cached = this.cachedCopyStatement.get(posBeforeKeyword);
    if (cached !== undefined) {
      return cached;
    }
    if (this.cachedSource === null) return false;
    // Build callbacks that bypass the cache to avoid infinite recursion in the
    // helper. The non-cached helper itself uses findLastPeriodOutsideStringsBefore
    // when available, so the inner scan remains O(log n).
    const innerCallbacks: CobolHelperCallbacks = {
      isFixedFormatCommentLine: (source, lineStart) => this.isFixedFormatCommentLine(source, lineStart),
      findLastPeriodOutsideStringsBefore: (endExclusive) => this.findLastPeriodOutsideStringsBefore(endExclusive)
    };
    const result = isInCopyStatementHelper(this.cachedSource, posBeforeKeyword, innerCallbacks);
    this.cachedCopyStatement.set(posBeforeKeyword, result);
    return result;
  }

  // Validates block open: checks pre-computed valid positions (O(1) per call)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    if (!this.validOpenPositions.has(lowerKeyword)) {
      this.validOpenPositions.set(lowerKeyword, this.computeValidPositions(lowerKeyword, source, excludedRegions));
    }
    return this.validOpenPositions.get(lowerKeyword)?.has(position) ?? false;
  }

  // Returns the number of characters at the start of `rest` that form the
  // decimal (`.<digits>`) and/or scientific (`E[+-]?<digits>`) tail of a
  // numeric literal whose integer head is `head`. Returns 0 when `head` is
  // not purely digits or `rest` does not begin with a numeric tail. This lets
  // PERFORM-validation lookahead skip past `.5` in `PERFORM 5.5 TIMES` so the
  // TIMES verb that follows it is still picked up by the next-word regex.
  private skipNumericLiteralTail(head: string, rest: string): number {
    if (head.length === 0 || !/^[0-9]+$/.test(head)) {
      return 0;
    }
    let i = 0;
    if (i + 1 < rest.length && rest[i] === '.' && rest.charCodeAt(i + 1) >= 0x30 && rest.charCodeAt(i + 1) <= 0x39) {
      i++;
      while (i < rest.length && rest.charCodeAt(i) >= 0x30 && rest.charCodeAt(i) <= 0x39) {
        i++;
      }
    }
    if (i < rest.length && (rest[i] === 'e' || rest[i] === 'E')) {
      let j = i + 1;
      if (j < rest.length && (rest[j] === '+' || rest[j] === '-')) {
        j++;
      }
      if (j < rest.length && rest.charCodeAt(j) >= 0x30 && rest.charCodeAt(j) <= 0x39) {
        i = j + 1;
        while (i < rest.length && rest.charCodeAt(i) >= 0x30 && rest.charCodeAt(i) <= 0x39) {
          i++;
        }
      }
    }
    return i;
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
      // Skip keywords used as a copybook name in a COPY statement (e.g.,
      // `COPY IF.`). tokenize() drops these from the token stream; this
      // pre-pass must drop them too, otherwise a copybook name like the `IF`
      // in `COPY IF.` is pushed onto the opener stack here and steals the
      // matching END-IF from the real opener, dropping the whole pair.
      if (this.isInCopyStatement(source, pos, excludedRegions)) {
        continue;
      }
      // Skip keywords used as data names on the SAME line as the preceding
      // verb — operands of MOVE/ADD/SET/... whose value happens to spell a
      // reserved word (`MOVE IF TO X`, `MOVE END-IF TO Y`). tokenize() drops
      // these from the token stream; this pre-pass must drop them too,
      // otherwise the inner `IF` (or `END-IF`) is pushed onto the opener/closer
      // stack here and pairs with the real END-IF (or real IF), leaving the
      // real opener / closer orphan. Block openers / closers always begin a
      // new statement, so the same-line variant is correct — a DATA_NAME_VERB
      // dangling at the end of the previous line cannot turn a next-line block
      // keyword into an operand (`PERFORM DISPLAY\nEND-PERFORM` must keep the
      // END-PERFORM token even though DISPLAY is in DATA_NAME_VERBS). The
      // general `isInExpressionContext` check (`=`, relational words, ...) is
      // intentionally NOT applied here — current de-facto behaviour treats
      // expression-position reserved words like `==IF` as the real block opener.
      if (this.isPrecedingWordDataNameVerbSameLine(source, pos)) {
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
      // the real opener unmatched. The column is the tab-expanded visual column (matching
      // tokenize / tryMatchExcludedRegion / isFixedFormatCommentLine) so a keyword pushed
      // past column 72 by tabs in the sequence area is also excluded.
      let lineStart = pos;
      while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
        lineStart--;
      }
      if (lineStart + 6 <= source.length && this.getVisualColumn(source, lineStart, pos) >= 72) {
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
          // PERFORM. (verb followed directly by a period, optionally preceded by
          // blanks) terminates the statement with no body or iteration phrase: it
          // is a paragraph-call PERFORM with no operand, never a structured opener.
          // Reject so the trailing END-PERFORM is left orphan. A structured PERFORM
          // whose UNTIL/VARYING/... phrase begins on the next line still passes
          // because that case has no period before the newline.
          if (!nextWord && /^[ \t]*\./.test(afterInner)) {
            continue;
          }
          if (nextWord) {
            const word = nextWord[1].toLowerCase();
            if (word === `end-${lowerKeyword}`) {
              // The next word is the matching END-PERFORM closer, not a paragraph name
            } else if (word !== 'until' && word !== 'varying' && word !== 'with') {
              // The `nextWord` regex `[a-zA-Z0-9][a-zA-Z0-9_-]*` stops at the first `.`,
              // so a decimal numeric literal like `5.5` (or scientific `1.5E+2`) is read
              // as the integer head only. Skip the literal's decimal (`.<digits>`) and
              // scientific (`E[+-]?<digits>`) tail so the TIMES verb that follows it is
              // still picked up by the `secondWord` lookahead. Word-final `-` after a
              // numeric head (`5-`) is not COBOL syntax for a continued identifier, so
              // we only skip the numeric tail when the head is purely digits.
              const afterNextWord = afterInner.slice(nextWord[0].length + this.skipNumericLiteralTail(word, afterInner.slice(nextWord[0].length)));
              // Strip `*>` and `>>` comment runs (each to end of its line) before
              // looking for the iteration verb so an inline comment between the
              // count operand and TIMES (`PERFORM 5 *> comment\nTIMES`) does not
              // hide TIMES from the `secondWord` lookahead. `.` does not match
              // newline so each replace targets a single comment line at a time;
              // the global flag handles multiple consecutive comment lines.
              const afterNextWordNoComment = afterNextWord.replace(/\*>.*|>>.*/g, '');
              // Check for PERFORM <variable> TIMES pattern (accept both alpha and numeric counts).
              // `\s+` (rather than `[ \t]+`) lets the iteration phrase wrap across a newline,
              // because a structured PERFORM may continue on the next line. The `\s+` does NOT
              // match a `.` so a period preceding the would-be second word still ends the
              // statement and leaves the regex empty (the same as before), preserving the
              // `PERFORM <name>.` paragraph-call rejection path.
              const secondWord = afterNextWordNoComment.match(/^\s+([a-zA-Z0-9][a-zA-Z0-9_-]*)/i);
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
                // Check for PERFORM <para> <count> TIMES pattern (paragraph call with iteration count).
                // `\s+` mirrors the `secondWord` widening so the TIMES verb is still recognised when
                // a paragraph-call iteration count and its TIMES verb are split across a newline
                // (e.g. `PERFORM PARA-A 5\n  TIMES`). Apply the same numeric-tail skip as the
                // first operand so a decimal count like `5.5` does not break the `thirdWord`
                // lookup and `PERFORM PARA-A 5.5 TIMES` stays rejected as a paragraph call.
                // Mirror the `*>` / `>>` comment strip from above so a comment line between
                // the count operand and TIMES does not hide the verb from the thirdWord lookahead.
                const secondTailSkip = this.skipNumericLiteralTail(secondWord[1].toLowerCase(), afterNextWordNoComment.slice(secondWord[0].length));
                const afterSecondWord = afterNextWordNoComment.slice(secondWord[0].length + secondTailSkip);
                const thirdWord = afterSecondWord.match(/^\s+([a-zA-Z][a-zA-Z0-9_-]*)/i);
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
  // where the keyword is being used as a copybook/filename, not as a block close.
  // Uses the cached statement-boundary table so multi-line `COPY\n  IF.` and
  // fixed-format sequence-area prefixes (`001000 COPY ...`) are handled
  // correctly, while honouring excludedRegions to skip COPY tokens that live
  // inside EXEC/strings/comments.
  private isInCopyStatement(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Statement boundary is the previous period outside strings/comments.
    const lastPeriod = this.findLastPeriodOutsideStringsBefore(position);
    const stmtStart = lastPeriod + 1;
    if (stmtStart >= position) return false;
    // Scan the statement for the COPY keyword with proper word-boundary
    // matching. The regex avoids matching identifiers like MY-COPY or COPY-X.
    // The ASCII-only lookbehind/lookahead cannot reject non-ASCII Unicode
    // identifier characters, so check the immediate neighbours below for any
    // Unicode letter / mark / digit / connector — e.g. `αCOPY` and `COPYα`
    // must not be matched as the bare COPY keyword.
    const COPY_PATTERN = /(?<![a-zA-Z0-9_-])COPY(?![a-zA-Z0-9_-])/gi;
    COPY_PATTERN.lastIndex = 0;
    const statement = source.slice(stmtStart, position);
    for (const match of statement.matchAll(COPY_PATTERN)) {
      const absPos = stmtStart + match.index;
      // Reject the match when an adjacent Unicode identifier character makes
      // this a mid-identifier occurrence (e.g. `αCOPY`, `COPYβ`).
      if (absPos > 0 && isUnicodeIdentifierChar(source[absPos - 1])) continue;
      const afterPos = absPos + 4;
      if (afterPos < source.length && isUnicodeIdentifierChar(source[afterPos])) continue;
      // Skip COPY tokens inside excluded regions (strings, comments, EXEC
      // blocks, compiler directive lines, etc.)
      if (this.isInExcludedRegion(absPos, excludedRegions)) continue;
      // Reject if an unterminated pseudo-text region intervenes between
      // the COPY keyword and the keyword position. matchPseudoText reports
      // unterminated `==` as a 2-char excluded region, indicating a mid-edit
      // state where the rest of the statement is ambiguous. We must not
      // suppress real keywords past that ambiguity.
      if (this.hasUnterminatedPseudoTextBetween(absPos, position, excludedRegions)) continue;
      // A period-less COPY statement otherwise extends to the next period (or
      // end of source), wrongly swallowing later blocks. Only the copybook name
      // (and an optional OF/IN library qualifier) may follow COPY; once a
      // block-opening verb appears past the copybook name the COPY statement is
      // over. If `position` is at or past that verb, it is not in the COPY.
      const copyEnd = absPos + 4;
      // `position + 1` so the block verb that sits exactly at `position` (the
      // very keyword being classified) is itself recognised as the boundary.
      const verbBoundary = this.findBlockVerbAfterCopybook(source, copyEnd, position + 1, excludedRegions);
      if (verbBoundary >= 0 && position >= verbBoundary) continue;
      return true;
    }
    return false;
  }

  // Scans from just after a COPY keyword for the first block-opening verb past the copybook name
  private findBlockVerbAfterCopybook(source: string, copyEnd: number, limit: number, excludedRegions: ExcludedRegion[]): number {
    return findBlockVerbAfterCopybook(source, copyEnd, limit, excludedRegions, this.keywords.blockOpen);
  }

  // Returns true if there is an excluded region between `from` and `to` that
  // represents an unterminated pseudo-text delimiter (a 2-char `==` region).
  // Used by isInCopyStatement to avoid wrongly extending the COPY statement
  // context past a half-typed `==`.
  private hasUnterminatedPseudoTextBetween(from: number, to: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.cachedSource === null) return false;
    const source = this.cachedSource;
    for (const region of excludedRegions) {
      if (region.start <= from) continue;
      if (region.start >= to) break;
      if (region.end - region.start === 2 && source[region.start] === '=' && source[region.start + 1] === '=') {
        return true;
      }
    }
    return false;
  }

  // Override tokenize for case-insensitive keyword matching
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    this.validOpenPositions.clear();
    const tokens: Token[] = [];
    const keywordPattern = buildCaseInsensitiveKeywordPattern(this.keywords);

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

      // Skip keywords used as filename in COPY statements (e.g., COPY END-IF., COPY IF., COPY WHEN., COPY ELSE.).
      // The check covers all three token types: a copybook name that happens to spell a
      // COBOL keyword must not be tokenised at all, regardless of whether the keyword is
      // an opener (IF/PERFORM), closer (END-IF/...) or a middle keyword (WHEN/ELSE).
      // Without the block_middle branch, `COPY WHEN.` injected a phantom WHEN as an
      // intermediate of the surrounding EVALUATE.
      if (
        (type === 'block_close' || type === 'block_open' || type === 'block_middle') &&
        this.isInCopyStatement(source, startOffset, excludedRegions)
      ) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      // Skip keywords in the fixed-format identification area (columns 73-80, 0-based 72+).
      // Detect fixed format by checking the 6-char sequence area (cols 1-6) on the same line:
      // it must consist of digits and whitespace only. The identification-area check uses
      // the tab-expanded visual column (mirroring computeValidPositions and
      // tryMatchExcludedRegion) so a keyword pushed past column 72 by tabs is also excluded.
      const lineStart = startOffset - column;
      if (lineStart + 6 <= source.length && this.getVisualColumn(source, lineStart, startOffset) >= 72) {
        const sequenceArea = source.slice(lineStart, lineStart + 6);
        if (/^[ \t\d]{6}$/.test(sequenceArea)) {
          continue;
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

    // Filter block keywords used as data names. WHEN/ELSE (middle) keep the
    // original cross-line / expression-context filter — a same- or prior-line
    // data-name verb suppresses them, and so do expression-position operators.
    // IF/PERFORM/... (open) and END-IF/END-PERFORM/... (close) use a stricter
    // same-line variant: a block keyword always begins a new statement, so a
    // DATA_NAME_VERB on the previous line cannot turn it into an operand
    // (`PERFORM DISPLAY\nEND-PERFORM` must keep END-PERFORM even though DISPLAY
    // is in DATA_NAME_VERBS), and an expression operator dangling before it is
    // not enough to demote it (current de-facto behaviour treats
    // expression-position reserved words like `==IF` as the real block opener).
    // The same-line operand filter still suppresses the inner `IF` of
    // `MOVE IF TO X` and the inner `END-IF` of `MOVE END-IF TO Y`, which was
    // the actual reported bug.
    return tokens.filter((token) => {
      if (token.type === 'block_middle') {
        const lower = token.value.toLowerCase();
        if (lower !== 'when' && lower !== 'else') return true;
        if (this.isPrecedingWordDataNameVerb(source, token.startOffset)) return false;
        if (this.isInExpressionContext(source, token.startOffset, excludedRegions)) return false;
        return true;
      }
      if (token.type === 'block_open' || token.type === 'block_close') {
        if (this.isPrecedingWordDataNameVerbSameLine(source, token.startOffset)) return false;
      }
      return true;
    });
  }

  // Returns true when WHEN/ELSE is used as a data name (operand of a COBOL data-name verb)
  private isPrecedingWordDataNameVerb(source: string, position: number): boolean {
    return isPrecedingWordDataNameVerb(source, position, this.helperCallbacks);
  }

  // Same-line variant for block_open / block_close tokens. See
  // isPrecedingWordDataNameVerbSameLine in cobolFixedFormat.ts for the rationale.
  private isPrecedingWordDataNameVerbSameLine(source: string, position: number): boolean {
    return isPrecedingWordDataNameVerbSameLine(source, position, this.helperCallbacks);
  }

  // Returns true when the keyword is preceded by an expression-context character
  private isInExpressionContext(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInExpressionContext(source, position, excludedRegions);
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

    // >> compiler directives (>>IF, >>ELSE, >>END-IF, >>EVALUATE, etc.).
    // A directive must be the first non-blank token on its line. A `>>` that
    // appears mid-expression is a relational/data context, not a directive, so
    // the rest of the line must stay tokenised (e.g. PERFORM ... >> ... END-PERFORM).
    if (char === '>' && pos + 1 < source.length && source[pos + 1] === '>' && this.isDirectiveLineStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    // EXEC/EXECUTE ... END-EXEC block
    if (char === 'E' || char === 'e') {
      const execRegion = matchExecBlock(source, pos, this.helperCallbacks);
      if (execRegion) {
        return execRegion;
      }
    }

    // Pseudo-text delimiter ==...== (only in COPY REPLACING / REPLACE context).
    // We consult a precomputed Set of pseudo-text start positions built once
    // per parse, falling back to the per-position scan for any positions the
    // single-pass scan failed to recognise (e.g. malformed contexts).
    if (char === '=' && pos + 1 < source.length && source[pos + 1] === '=') {
      const pseudoStarts = this.getPseudoTextStarts(source);
      if (pseudoStarts.has(pos)) {
        return matchPseudoText(source, pos);
      }
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
    return getVisualColumn(source, lineStart, pos);
  }

  // Returns true when `pos` is the first non-blank token on its line — the
  // position where a `>>` compiler directive is allowed. The leading run may be
  // pure whitespace (free format) or a 6-char digit/whitespace sequence area
  // followed by whitespace (fixed format).
  private isDirectiveLineStart(source: string, pos: number): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    const prefix = source.slice(lineStart, pos);
    // Free format: nothing but blanks before the directive.
    if (/^[ \t]*$/.test(prefix)) {
      return true;
    }
    // Fixed format: a digit/blank sequence area (cols 1-6) followed by blanks.
    return /^[\d \t]{6}[ \t]*$/.test(prefix);
  }

  // Checks if a line starting at lineStart is a fixed-format column 7 comment line
  private isFixedFormatCommentLine(source: string, lineStart: number): boolean {
    return isFixedFormatCommentLine(source, lineStart);
  }

  // Matches COBOL string with specified quote character, including fixed-format continuation
  private matchCobolString(source: string, pos: number, quote: string): ExcludedRegion {
    return matchCobolString(source, pos, quote);
  }

  // Custom block matching for COBOL-specific pairing rules
  protected matchBlocks(tokens: import('../types').Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    // Count, per opener type, how many of its close keywords appear in the whole
    // token stream. As we walk forward we decrement each close's own contribution
    // first, so the map reflects only closes that come *after* the current token.
    // This drives the crossing check below: a close must not pair with a deeper
    // opener when an opener sitting above it still has a matching close pending,
    // because consuming the deeper opener first would force that pending close to
    // cross the pair we are about to build.
    const remainingCloseCounts = new Map<string, number>();
    for (const token of tokens) {
      if (token.type === 'block_close') {
        const opener = CLOSE_TO_OPEN[token.value.toLowerCase()];
        if (opener) {
          remainingCloseCounts.set(opener, (remainingCloseCounts.get(opener) ?? 0) + 1);
        }
      }
    }

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle': {
          // ELSE belongs to the nearest enclosing IF; WHEN to the nearest
          // enclosing EVALUATE or SEARCH. The owner is not necessarily the
          // stack top: an unclosed inner block (e.g. PERFORM) may sit above it.
          // Search the stack downward instead of only inspecting the top, so
          // ELSE/WHEN is not silently dropped when an inner block is unclosed.
          const middleValue = token.value.toLowerCase();
          let ownerIndex = -1;
          if (middleValue === 'else') {
            ownerIndex = findLastOpenerByType(stack, 'if', true);
          } else if (middleValue === 'when') {
            // WHEN matches the innermost EVALUATE or SEARCH — take whichever
            // opener sits higher (deeper) on the stack.
            const evaluateIndex = findLastOpenerByType(stack, 'evaluate', true);
            const searchIndex = findLastOpenerByType(stack, 'search', true);
            ownerIndex = Math.max(evaluateIndex, searchIndex);
          }
          if (ownerIndex >= 0) {
            stack[ownerIndex].intermediates.push(token);
          }
          break;
        }

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          const validOpener = CLOSE_TO_OPEN[closeValue];

          if (validOpener) {
            // This close was counted above; remove its own contribution so the
            // map reflects only closes after it (used by the crossing check).
            remainingCloseCounts.set(validOpener, (remainingCloseCounts.get(validOpener) ?? 0) - 1);

            let matchIndex = findLastOpenerByType(stack, validOpener, true);

            // Reject the match when pairing with this opener would cross an inner
            // unclosed block: if an opener sitting above matchIndex still has a
            // matching close pending later in the token stream, consuming the
            // deeper matchIndex now would force that pending close to cross this
            // pair. Per CLAUDE.md best-effort parsing (anchor-set principle),
            // leave the crossed-over opener orphan (no color) rather than emit two
            // overlapping pairs. An above opener with no remaining close (e.g. a
            // truly unclosed PERFORM) does NOT block the match, keeping orphan
            // count minimal (cost-minimization).
            if (matchIndex >= 0 && matchIndex < stack.length - 1) {
              for (let s = matchIndex + 1; s < stack.length; s++) {
                const aboveOpener = stack[s].token.value.toLowerCase();
                if ((remainingCloseCounts.get(aboveOpener) ?? 0) > 0) {
                  matchIndex = -1;
                  break;
                }
              }
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
          }
          break;
        }
      }
    }

    return pairs;
  }
}
