// COBOL block parser: PERFORM->END-PERFORM, IF->END-IF, EVALUATE->END-EVALUATE

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import type { CobolHelperCallbacks } from './cobolHelpers';
import {
  isInCopyStatement as isInCopyStatementHelper,
  isInPseudoTextContext,
  matchExecBlock,
  matchPseudoText,
  skipBackwardWhitespaceAndComments
} from './cobolHelpers';
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

// The subset of DATA_NAME_VERBS that are operand introducers rather than
// statement verbs (TO/BY/INTO/...). When the backward WHEN/ELSE walk crosses a
// newline on its first hop and lands on one of these, the introducer belongs
// to the *previous* line's (incomplete) statement; the next line's WHEN/ELSE is
// a new statement's control-flow keyword and must not be suppressed.
const OPERAND_INTRODUCERS = new Set(['TO', 'INTO', 'FROM', 'OF', 'IN', 'USING', 'AT', 'BY', 'GIVING', 'REMAINDER']);

// Block-opening verbs (uppercase). When such a verb appears past the copybook
// name of a COPY statement, the COPY statement is over: a period-less COPY does
// not extend across a following block-opening statement. Used by the
// pseudo-text forward scan to drop COPY context once a block verb is seen.
const COPY_TERMINATING_VERBS = new Set([
  'PERFORM',
  'IF',
  'EVALUATE',
  'READ',
  'WRITE',
  'REWRITE',
  'DELETE',
  'START',
  'RETURN',
  'SEARCH',
  'STRING',
  'UNSTRING',
  'ACCEPT',
  'DISPLAY',
  'CALL',
  'INVOKE',
  'COMPUTE',
  'ADD',
  'SUBTRACT',
  'MULTIPLY',
  'DIVIDE'
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
      isFixedFormatCommentLine: (source, lineStart) => this.isFixedFormatCommentLine(source, lineStart),
      isInCopyStatementCached: (posBeforeKeyword) => this.isInCopyStatementCached(posBeforeKeyword)
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

  // Override findExcludedRegions to reset per-parse caches before scanning.
  // Without this, repeated parser.parse() calls on different sources would
  // reuse stale cached data.
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    if (this.cachedSource !== source) {
      this.cachedSource = source;
      this.cachedPeriods = null;
      this.cachedCopyStatement.clear();
      this.cachedPseudoTextStarts = null;
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

  // Single-pass scan to collect all period positions that are not inside
  // strings, *> inline comments, >> compiler directives, or fixed-format
  // column-7 comment lines. Builds a sorted array of every such period so
  // findLastPeriodOutsideStringsBefore can binary-search the result.
  private buildPeriodPositions(source: string): number[] {
    const periods: number[] = [];
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      // Skip *> inline comments to end of line
      if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip >> compiler directives to end of line
      if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        i++;
        while (i < source.length) {
          if (source[i] === ch) {
            if (i + 1 < source.length && source[i + 1] === ch) {
              i += 2;
              continue;
            }
            break;
          }
          // String cannot span multiple lines in COBOL
          if (source[i] === '\n' || source[i] === '\r') {
            break;
          }
          i++;
        }
        i++;
        continue;
      }
      if (ch === '.') {
        // Defer fixed-format-comment-line check until needed
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (!this.isFixedFormatCommentLine(source, lineStart)) {
          periods.push(i);
        }
      }
      i++;
    }
    return periods;
  }

  // Builds (lazily, once per parse) the set of source offsets that begin a
  // pseudo-text region (`==`) inside a COPY REPLACING / REPLACE / ALSO context.
  // The single forward scan tracks statement boundaries, the active COPY/
  // REPLACE state, and known string/comment regions, so each `==` is classified
  // in O(1) at lookup time and the total cost is O(n) per parse.
  // Falls back gracefully: positions not recognised here are still re-checked
  // via the existing per-position helper, so we cannot regress correctness
  // even if the scan misses an edge case.
  private getPseudoTextStarts(source: string): Set<number> {
    if (this.cachedPseudoTextStarts !== null && this.cachedSource === source) {
      return this.cachedPseudoTextStarts;
    }
    const starts = new Set<number>();
    // Track statement-level state:
    //   - sawCopy: a COPY keyword was seen since the last period
    //   - inReplaceContext: a REPLACING/REPLACE/ALSO was seen, so following
    //     `==...==` pairs are pseudo-text. REPLACING additionally requires sawCopy.
    //   - copyWordsSeen: words seen since COPY (word 0 is the copybook name).
    //     Used to drop sawCopy when a block-opening verb ends a period-less COPY.
    //   - expectCopyLibrary: the next word is the library name of `COPY name OF`.
    let sawCopy = false;
    let inReplaceContext = false;
    let copyWordsSeen = 0;
    let expectCopyLibrary = false;
    let i = 0;
    while (i < source.length) {
      const ch = source[i];
      // End of statement: period (outside strings/comments — those are handled
      // by the if-cases below). Reset all statement-level flags.
      if (ch === '.') {
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (!this.isFixedFormatCommentLine(source, lineStart)) {
          sawCopy = false;
          inReplaceContext = false;
          copyWordsSeen = 0;
          expectCopyLibrary = false;
        }
        i++;
        continue;
      }
      // Newline: also resets COPY state if we are not in a REPLACE chain.
      // Period termination is the canonical statement end, so just advance.
      if (ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      // *> inline comment: skip to end of line
      if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // >> compiler directives: skip to end of line. Do NOT alter state — the
      // directive line is not part of program text.
      if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
        i += 2;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Fixed-format column 7 comment line indicator: if at column 6 (i.e.,
      // we are about to enter column 7), skip to end of line.
      if (ch === '*' || ch === '/' || ch === 'D' || ch === 'd') {
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (this.isFixedFormatCommentLine(source, lineStart) && lineStart + 6 === i) {
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
            i++;
          }
          continue;
        }
      }
      // String literals: skip past them so keywords inside strings are ignored.
      if (ch === "'" || ch === '"') {
        const quote = ch;
        i++;
        while (i < source.length) {
          if (source[i] === quote) {
            if (i + 1 < source.length && source[i + 1] === quote) {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          // COBOL strings cannot span line breaks (without fixed-format
          // continuation). Be lenient — let the dedicated string matcher
          // handle continuation logic; here we only need a coarse skip.
          if (source[i] === '\n' || source[i] === '\r') {
            break;
          }
          i++;
        }
        continue;
      }
      // EXEC/EXECUTE ... END-EXEC block: skip the whole block. Its body is a
      // foreign sub-language (SQL/CICS/...), so a REPLACE/REPLACING token inside
      // it must NOT alter COBOL pseudo-text state. Without this skip, a REPLACE
      // in an EXEC body sets inReplaceContext=true; since EXEC blocks need no
      // terminating period, the flag would leak past END-EXEC and mis-classify
      // later `==` as pseudo-text delimiters.
      if (ch === 'E' || ch === 'e') {
        const execRegion = matchExecBlock(source, i, this.helperCallbacks);
        if (execRegion) {
          i = execRegion.end;
          continue;
        }
      }
      // `==` pseudo-text delimiter: if currently in a recognised REPLACE
      // context, record the opening offset and skip past the closing `==`.
      if (ch === '=' && i + 1 < source.length && source[i + 1] === '=') {
        if (inReplaceContext) {
          starts.add(i);
        }
        // Always skip past the `==...==` payload to the next `==` so we don't
        // mis-tokenise content inside the pseudo text. If unterminated, only
        // skip the opening `==` (consistent with matchPseudoText behaviour).
        // Pseudo-text content may span newlines (e.g., REPLACING ==a\nb== BY
        // ==c==), so we do not stop at line boundaries.
        let j = i + 2;
        let foundClose = false;
        while (j + 1 < source.length) {
          if (source[j] === '=' && source[j + 1] === '=') {
            j += 2;
            foundClose = true;
            break;
          }
          j++;
        }
        i = foundClose ? j : i + 2;
        continue;
      }
      // Identifier / keyword scan: only walk ASCII letter characters that
      // begin words to avoid duplicate work mid-identifier.
      if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
        const prev = i > 0 ? source[i - 1] : '';
        // Must be at a word boundary
        if (prev && (prev === '-' || /[a-zA-Z0-9_]/.test(prev))) {
          i++;
          continue;
        }
        let end = i + 1;
        while (end < source.length && /[a-zA-Z0-9_-]/.test(source[end])) {
          end++;
        }
        const word = source.slice(i, end).toUpperCase();
        // Reject hyphenated identifiers like X-REPLACING by checking the next char
        if (word === 'COPY') {
          sawCopy = true;
          copyWordsSeen = 0;
          expectCopyLibrary = false;
        } else if (word === 'REPLACE') {
          inReplaceContext = true;
        } else if (word === 'REPLACING' && sawCopy) {
          inReplaceContext = true;
        } else if (sawCopy) {
          // Words inside an in-progress COPY statement. word 0 is the copybook
          // name; `OF`/`IN <lib>` may qualify it. A block-opening verb past the
          // copybook name ends a period-less COPY, so drop sawCopy — this stops
          // a later REPLACING from being treated as part of this COPY.
          if (copyWordsSeen === 0) {
            copyWordsSeen = 1;
          } else if (expectCopyLibrary) {
            expectCopyLibrary = false;
          } else if (word === 'OF' || word === 'IN') {
            expectCopyLibrary = true;
          } else if (COPY_TERMINATING_VERBS.has(word)) {
            sawCopy = false;
          } else {
            copyWordsSeen++;
          }
        }
        i = end;
        continue;
      }
      i++;
    }
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
    const COPY_PATTERN = /(?<![a-zA-Z0-9_-])COPY(?![a-zA-Z0-9_-])/gi;
    COPY_PATTERN.lastIndex = 0;
    const statement = source.slice(stmtStart, position);
    for (const match of statement.matchAll(COPY_PATTERN)) {
      const absPos = stmtStart + match.index;
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

  // Scans from just after a COPY keyword for the first block-opening verb that
  // appears past the copybook name. The copybook name is the first word after
  // COPY; an optional `OF`/`IN <library>` qualifier may follow it. Returns the
  // offset of that verb, or -1 when none is found before `limit`. Keywords
  // inside excluded regions (strings, comments, EXEC blocks, pseudo-text) are
  // skipped so they cannot be mistaken for a statement boundary.
  private findBlockVerbAfterCopybook(source: string, copyEnd: number, limit: number, excludedRegions: ExcludedRegion[]): number {
    const WORD_PATTERN = /[a-zA-Z0-9][a-zA-Z0-9_-]*/g;
    WORD_PATTERN.lastIndex = copyEnd;
    let wordIndex = 0;
    let expectLibrary = false;
    let match = WORD_PATTERN.exec(source);
    while (match !== null && match.index < limit) {
      const wordPos = match.index;
      if (this.isInExcludedRegion(wordPos, excludedRegions)) {
        match = WORD_PATTERN.exec(source);
        continue;
      }
      const upper = match[0].toUpperCase();
      // Word 0 is the copybook name itself — never a statement boundary.
      if (wordIndex === 0) {
        wordIndex++;
        match = WORD_PATTERN.exec(source);
        continue;
      }
      // `COPY name OF lib` / `COPY name IN lib`: the library name follows the
      // OF/IN qualifier and is also part of the COPY statement.
      if (expectLibrary) {
        expectLibrary = false;
        match = WORD_PATTERN.exec(source);
        continue;
      }
      if (upper === 'OF' || upper === 'IN') {
        expectLibrary = true;
        match = WORD_PATTERN.exec(source);
        continue;
      }
      // A block-opening verb after the copybook name ends the COPY statement.
      if (this.keywords.blockOpen.some((kw) => kw === upper.toLowerCase())) {
        return wordPos;
      }
      wordIndex++;
      match = WORD_PATTERN.exec(source);
    }
    return -1;
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

      // Skip keywords used as filename in COPY statements (e.g., COPY END-IF., COPY IF.)
      if ((type === 'block_close' || type === 'block_open') && this.isInCopyStatement(source, startOffset, excludedRegions)) {
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
      if (this.isInExpressionContext(source, token.startOffset, excludedRegions)) return false;
      return true;
    });
  }

  // Returns true when the keyword is part of an operand list begun by a COBOL verb that
  // takes data names as operands (so the keyword is being used as an identifier, not as a
  // control-flow intermediate). Walks backward past any number of intervening data-name
  // operands (and the `,`/`;` separators that may appear between them) on the same
  // physical line to find the verb itself.
  //
  // Examples recognised as data-name verb contexts:
  //   MOVE ELSE TO Y                — immediately preceded by MOVE
  //   MOVE A TO B WHEN              — preceded by chain B<-TO<-A<-MOVE (TO is a
  //                                   DATA_NAME_VERB introducer; both A and B are operands)
  //   CALL "P" USING WHEN ELSE      — preceded by chain WHEN<-USING (USING list)
  //   ADD A B GIVING C ELSE         — preceded by chain C<-GIVING (GIVING list)
  //
  // Skips intervening *> inline comments, fixed-format column-7 comment lines, and >>
  // compiler directive lines so multi-line statements like
  //   MOVE
  //   *> comment
  //   ELSE TO Y
  // are recognized as data-name verb contexts.
  //
  // Cross-line policy: only the first hop may cross a newline (to recognise multi-line
  // statements). Once we have crossed a newline, we treat the preceding word as the
  // immediate verb-or-operand context and do NOT walk back further. This prevents
  // `USING WHEN ELSE\n  ELSE` from chaining the line-2 ELSE←WHEN←USING and incorrectly
  // suppressing the line-3 ELSE intermediate.
  //
  // Stops walking back when an operator, period (statement boundary), parenthesis, string
  // literal, or other non-operand character is encountered. String literals are treated as
  // a non-data-name source operand (e.g., DISPLAY "yes"\nELSE leaves ELSE as an IF
  // intermediate, not a data name) — the same is true of any quoted source operand.
  private isPrecedingWordDataNameVerb(source: string, position: number): boolean {
    const keywordLineStart = this.findLineStartFor(source, position);
    let pos = position;
    let crossedNewline = false;
    // The bound prevents pathological inputs from causing super-linear scans on each
    // ELSE/WHEN candidate. A real USING/INTO/TO list with 32 operands is far beyond
    // typical COBOL.
    for (let step = 0; step < 32; step++) {
      let i = skipBackwardWhitespaceAndComments(source, pos - 1, this.helperCallbacks);
      if (i < 0) return false;
      // Skip a single `,` or `;` separator (followed by more whitespace/comments) so
      // `USING A, B` and `USING A; B` both treat B as a list continuation.
      if (source[i] === ',' || source[i] === ';') {
        i = skipBackwardWhitespaceAndComments(source, i - 1, this.helperCallbacks);
        if (i < 0) return false;
      }
      // Only identifier-like chars (letters/digits/_/-) form a word. Anything else is a
      // statement boundary, operator, parenthesis, or string-literal close — stop.
      if (!/[a-zA-Z0-9_-]/.test(source[i])) return false;
      const wordEnd = i + 1;
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_-]/.test(source[wordStart - 1])) wordStart--;
      const wordLineStart = this.findLineStartFor(source, wordStart);
      // Did this hop cross a newline? On the first hop, compare against the original
      // keyword's line; on subsequent hops, we already require same-line so this only
      // tells us whether we have already crossed once.
      const hopCrossedNewline = step === 0 ? wordLineStart !== keywordLineStart : false;
      if (hopCrossedNewline) {
        crossedNewline = true;
      }
      const word = source.slice(wordStart, wordEnd).toUpperCase();
      // A first hop that crosses a newline onto a bare operand introducer
      // (`MOVE X TO` <newline> WHEN) means the introducer belongs to the prior
      // line's incomplete statement. The next line's WHEN/ELSE starts a new
      // statement and is a real control-flow intermediate — do not suppress it.
      // Checked before DATA_NAME_VERBS so introducers like TO stop here.
      if (hopCrossedNewline && OPERAND_INTRODUCERS.has(word)) return false;
      if (DATA_NAME_VERBS.has(word)) return true;
      // Once we have crossed a newline, we examine exactly one preceding word on the
      // prior line; no further walk-back is permitted. The operand chain logically
      // resides on a single physical line.
      if (crossedNewline) return false;
      pos = wordStart;
    }
    return false;
  }

  // Returns the offset of the line start (0 or position right after a CR/LF) for the
  // line containing the given offset.
  private findLineStartFor(source: string, offset: number): number {
    let lineStart = offset;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    return lineStart;
  }

  // Returns true when the keyword is preceded by an expression-context character
  // (arithmetic operator, separator, or open parenthesis), indicating that the
  // keyword is used as an operand/data name rather than a control-flow intermediate.
  // Examples: `COMPUTE Y = X + ELSE`, `CALL "P" USING A, ELSE`, `(ELSE + 1)`.
  // Skips excluded regions (*> inline comments, >> compiler directives, strings) so
  // expression-like characters appearing inside them are not mistaken for real operators.
  private isInExpressionContext(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    // Skip whitespace including newlines (continuation across lines is permitted)
    // and any excluded regions (comments, directives, strings) encountered along the way.
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    const ch = source[i];
    // Arithmetic operators: + - * / = < >
    // Separators: , ;
    // Open parenthesis: (   — followed token is an operand inside an expression.
    // NOTE: closing parenthesis `)` is intentionally NOT treated as an
    // expression-context character. `)` terminates an expression/condition
    // (e.g., `IF (X > 0)`); the next reserved word is therefore in statement
    // position, not operand position, so ELSE/WHEN after `)` are real
    // control-flow intermediates.
    // Note: `**` is two `*` characters, so checking `*` covers it.
    return ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '=' || ch === '<' || ch === '>' || ch === ',' || ch === ';' || ch === '(';
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
