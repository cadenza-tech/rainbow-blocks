// AppleScript block parser: handles compound keywords (end tell), nested comments, case-insensitive matching

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import type { ApplescriptHelperCallbacks } from './applescriptHelpers';
import {
  findLogicalLineEnd,
  findLogicalLineStart,
  isInsideIfCondition,
  isKeywordAsVariableName,
  isUnicodeWhitespace,
  matchCompoundKeyword,
  stripExcludedRegionsInRange,
  VAR_NAME_PATTERNS
} from './applescriptHelpers';
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

// Upper bound on the backward scan in isAtRecordKeyPosition. The scan walks back
// looking for the record literal's opening '{'. An unclosed '{' followed by many
// colon-suffixed close keywords would otherwise make each scan O(N), degrading
// tokenize to O(N^2). A generous 2048-character cap never rejects a real record
// literal (which fits well within that span) while keeping the call O(1) per use,
// mirroring the MAX_PAREN_SCAN_CHARS bound in adaValidation.
const MAX_RECORD_KEY_SCAN_CHARS = 2048;

// Whitespace characters allowed as line-leading indentation. Includes ASCII space/tab
// and common Unicode whitespace (NBSP U+00A0, ZWSP U+200B, EN/EM/HAIR spaces U+2000-U+200A,
// LSEP/PSEP U+2028/U+2029, NNBSP U+202F, MMSP U+205F, IDEO SPACE U+3000) so that
// AppleScript files indented with non-ASCII whitespace are parsed correctly.
const LINE_LEADING_WHITESPACE_PATTERN = /^[ \t\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]*$/;

// Reserved words that are syntax errors when used as bare handler names after
// `on`/`to` (e.g., `on if`, `to tell`). Function-style invocation `on tell()` is
// still permitted because the trailing parens disambiguate it as a handler
// declaration named after a reserved word.
const RESERVED_HANDLER_NAMES = new Set([
  'if',
  'tell',
  'repeat',
  'try',
  'script',
  'else',
  'end',
  'to',
  'on',
  'considering',
  'ignoring',
  'true',
  'false',
  'with',
  'using',
  'return',
  'exit'
]);

export class ApplescriptBlockParser extends BaseBlockParser {
  // Source captured during tokenize for use in matchBlocks (handler-name lookup).
  private _currentSource = '';
  // Excluded regions captured during tokenize so handlerName() can transparently
  // skip block comments `(* ... *)` between the keyword and the identifier.
  private _currentExcludedRegions: ExcludedRegion[] = [];

  // Returns the handler name (lowercased) for an `on`/`to` open block, or '' when none.
  // Reads from the source stored during tokenize. Skips ASCII space/tab, Unicode
  // whitespace, `¬<newline>` line continuations, and block comments `(* ... *)` to
  // match the same whitespace handling used by the handler-declaration probe.
  // Accepts both bare ASCII identifiers (`foo`, `_x`) and pipe-delimited identifiers
  // (`|tell|`, `|my handler|`) so that handlers named after reserved words via pipe
  // quoting (e.g. `on |tell|()`) still resolve to the inner name (`tell`) for the
  // matchBlocks fallback that pairs them with `end tell`.
  private handlerName(block: OpenBlock): string {
    const source = this._currentSource;
    const i = this.skipHandlerProbeWhitespace(source, block.token.endOffset, this._currentExcludedRegions);
    if (i >= source.length) return '';
    // Pipe-delimited identifier: `|name|`. Read up to the next `|` (the pipe
    // identifier excluded region already consumes the closing `|` at tokenize time,
    // so scan independently here over the source slice.) Backslash escapes inside
    // the identifier mirror tryMatchExcludedRegion: `\|` is a literal pipe, but
    // newlines terminate even an unclosed identifier.
    if (source[i] === '|') {
      let end = i + 1;
      const name: string[] = [];
      while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
        if (source[end] === '\\' && end + 1 < source.length && source[end + 1] !== '\n' && source[end + 1] !== '\r') {
          name.push(source[end + 1]);
          end += 2;
          continue;
        }
        if (source[end] === '|') break;
        name.push(source[end]);
        end++;
      }
      return name.join('').toLowerCase();
    }
    if (!/[a-zA-Z_]/.test(source[i])) return '';
    let end = i;
    while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
    return source.slice(i, end).toLowerCase();
  }

  private get helperCallbacks(): ApplescriptHelperCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

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
    if (isKeywordAsVariableName(source, position, keyword, excludedRegions, this.helperCallbacks)) {
      return false;
    }

    // 'tell ... to action' on one line is a one-liner, not a block
    if (keyword === 'tell') {
      // Reject the `tell()` function-call form (e.g., `set x to tell()`, `tell ()`),
      // but only when the parentheses are empty. `tell (window 1)` and `tell(window 1)`
      // are valid blocks targeting a parenthesized object specifier, so a non-empty
      // `(...)` must not be rejected. Optional whitespace before `(` is allowed.
      if (this.isEmptyParenCall(source, position + keyword.length)) {
        return false;
      }
      if (this.isTellToOneLiner(source, position, excludedRegions)) {
        return false;
      }
      // Reject 'tell' when used as a condition value in 'if ... then' pattern
      if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
        return false;
      }
      return true;
    }

    // Reject block keywords used as condition values in 'if ... then' pattern
    // (repeat, try, considering, ignoring are affected; script/on/to are already protected by isAtLogicalLineStart)
    if (keyword === 'repeat' || keyword === 'try' || keyword === 'considering' || keyword === 'ignoring') {
      // Reject function-call form (e.g., `repeat()`, `repeat ()`). Allow
      // optional ASCII or Unicode whitespace between the keyword and `(`.
      let parenScan = position + keyword.length;
      while (parenScan < source.length && (source[parenScan] === ' ' || source[parenScan] === '\t' || isUnicodeWhitespace(source[parenScan]))) {
        parenScan++;
      }
      if (parenScan < source.length && source[parenScan] === '(') {
        return false;
      }
      if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
        return false;
      }
      return true;
    }

    if (keyword !== 'if') {
      return true;
    }

    // Reject the `if(...)` function-call form (no whitespace before `(`, or only
    // Unicode whitespace). The parenthesized variant `if (cond) then` (with ASCII
    // space/tab) is still valid as a multi-line block opener, so only the tight
    // `if(` shape and `if<unicodewhitespace>(` are rejected here. Without this
    // guard, `if(x)` would be tokenized as a block opener and steal an enclosing
    // `end`/`end if`, producing a geometrically crossing pair.
    if (position + keyword.length < source.length) {
      const nextCh = source[position + keyword.length];
      if (nextCh === '(') return false;
      if (isUnicodeWhitespace(nextCh)) {
        let parenScan = position + keyword.length;
        while (parenScan < source.length && isUnicodeWhitespace(source[parenScan])) parenScan++;
        if (parenScan < source.length && source[parenScan] === '(') {
          return false;
        }
      }
    }

    // Check if 'if' is inside another if/repeat condition (e.g., 'if if then')
    if (isInsideIfCondition(source, position, keyword.length, excludedRegions, this.helperCallbacks)) {
      return false;
    }

    // Find end of logical line (following ¬ continuations)
    const lineEnd = findLogicalLineEnd(source, position + keyword.length, excludedRegions, this.helperCallbacks);

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
      // Check if there's non-excluded content after 'then' on the same logical line
      // Comments are not content, but strings, pipes, and chevrons ARE content
      let j = thenPos + 4;
      let effectiveLineEnd = lineEnd;
      while (j < effectiveLineEnd) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          // Only skip comments (-- and (* *)), not strings/pipes/chevrons
          if (
            source[region.start] === '-' ||
            (source[region.start] === '(' && region.start + 1 < source.length && source[region.start + 1] === '*')
          ) {
            j = region.end;
            // If the comment extends past the current line end, extend to the next line end
            if (j > effectiveLineEnd) {
              effectiveLineEnd = j;
              while (effectiveLineEnd < source.length && source[effectiveLineEnd] !== '\n' && source[effectiveLineEnd] !== '\r') {
                effectiveLineEnd++;
              }
            }
            continue;
          }
          // Non-comment excluded region (string, pipe, chevron) is real content -> single-line if
          return false;
        }
        if (source[j] !== ' ' && source[j] !== '\t' && source[j] !== '\r' && source[j] !== '\n' && source[j] !== '\u00AC') {
          // Non-whitespace, non-excluded content after 'then' -> single-line if
          return false;
        }
        j++;
      }
    }

    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: -- to end of line
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: (* *) with nesting support
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchNestedComment(source, pos);
    }

    // Double-quoted string with backslash and doubled-quote escaping (AppleScript strings are single-line)
    if (char === '"') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '\\' && j + 1 < source.length && source[j + 1] !== '\n' && source[j + 1] !== '\r') {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          // Doubled quote ("") is an escaped quote in legacy AppleScript
          if (j + 1 < source.length && source[j + 1] === '"') {
            j += 2;
            continue;
          }
          return { start: pos, end: j + 1 };
        }
        j++;
      }
      return { start: pos, end: j };
    }

    // Smart double quotes (U+201C left, U+201D right). Script Editor auto-converts
    // ASCII `"` to these in source files, and they are valid string delimiters.
    if (char === '“') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '”') {
          return { start: pos, end: j + 1 };
        }
        j++;
      }
      return { start: pos, end: j };
    }

    // Pipe-delimited identifier: |identifier| (with backslash escape support: |a\|b|)
    // Backslash never escapes a newline (consistent with the string literal handling
    // above), so an unterminated pipe identifier ends at the first newline.
    if (char === '|') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '\\' && j + 1 < source.length && source[j + 1] !== '\n' && source[j + 1] !== '\r') {
          j += 2;
          continue;
        }
        if (source[j] === '|') break;
        j++;
      }
      if (j < source.length && source[j] === '|') {
        return { start: pos, end: j + 1 };
      }
      return { start: pos, end: j };
    }

    // Chevron/guillemet syntax: \u00AB...\u00BB (raw Apple Events, data constants, class/property references).
    // AppleScript chevron text never nests, so the first \u00BB always closes it; a stray
    // inner \u00AB must not extend the region. When the closing \u00BB is missing, the region
    // runs to the end of the source (unterminated).
    if (char === '\u00AB') {
      let j = pos + 1;
      while (j < source.length && source[j] !== '\u00BB') {
        j++;
      }
      if (j < source.length) {
        return { start: pos, end: j + 1 };
      }
      return { start: pos, end: source.length };
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
    this._currentSource = source;
    this._currentExcludedRegions = excludedRegions;
    const tokens: Token[] = [];
    const newlinePositions = this.buildNewlinePositions(source);
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

      // Try compound keywords first (longest first, flexible whitespace)
      const compoundResult = this.tryMatchCompoundKeywordToken(source, i, excludedRegions, newlinePositions);
      if (compoundResult) {
        if (compoundResult.token) {
          if (!this.isAdjacentToUnicodeLetter(source, compoundResult.token.startOffset, compoundResult.nextPos - compoundResult.token.startOffset)) {
            tokens.push(compoundResult.token);
          }
        }
        i = compoundResult.nextPos;
        continue;
      }

      // Try single-word keywords
      const singleResult = this.tryMatchSingleKeywordToken(source, i, excludedRegions, newlinePositions);
      if (singleResult) {
        if (singleResult.token) {
          if (
            !this.isAdjacentToUnicodeLetter(source, singleResult.token.startOffset, singleResult.token.endOffset - singleResult.token.startOffset)
          ) {
            tokens.push(singleResult.token);
          }
        }
        i = singleResult.nextPos;
        continue;
      }

      i++;
    }

    return tokens;
  }

  // Tries to match a compound keyword at position, returns match result or null
  private tryMatchCompoundKeywordToken(
    source: string,
    i: number,
    excludedRegions: ExcludedRegion[],
    newlinePositions: number[]
  ): { nextPos: number; token?: Token } | null {
    for (const keyword of COMPOUND_KEYWORDS) {
      const flexMatch = matchCompoundKeyword(source, i, keyword);
      if (flexMatch < 0) continue;

      // Check word boundary at end
      if (flexMatch < source.length && /\w/.test(source[flexMatch])) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // Reject compound block openers/middles followed by `(` (with optional whitespace) — these
      // are function call forms (e.g., `with timeout(5)`, `with timeout (5)`, `on error()`)
      // rather than block keywords. For compound keywords whose first word is itself a
      // single-word opener (`on error` -> `on`, `else if` -> `else`), break out of the
      // compound loop so the caller falls back to the single-word matcher. That lets
      // `on error()` be parsed as a handler declaration named `error` rather than
      // swallowing the whole `on error` span and discarding the bare `on` opener.
      if (type === 'block_open' || type === 'block_middle') {
        let parenScan = flexMatch;
        while (parenScan < source.length && (source[parenScan] === ' ' || source[parenScan] === '\t' || isUnicodeWhitespace(source[parenScan]))) {
          parenScan++;
        }
        if (parenScan < source.length && source[parenScan] === '(') {
          if (keyword === 'on error' || keyword === 'else if') {
            return null;
          }
          return { nextPos: flexMatch };
        }
      }

      // Reject compound block closers not at physical line start (covers mid-line
      // occurrences of `end tell`, `end if`, etc. inside expressions). Also reject
      // compound closers that appear on a continuation line of a previous statement
      // (e.g. `set x to 5 ¬\n  end tell` — the trailing `end tell` is part of the
      // expression, not a block close).
      if (type === 'block_close') {
        if (!this.isAtPhysicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
        if (this.isOnContinuationLine(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Reject compound block_close used as a record key (e.g., multi-line
      // `{\n  end if: 5\n}`). Even when the keyword sits at physical line start,
      // it may be a property name inside a record literal that spans multiple
      // lines, in which case it must not pair with an outer block opener.
      if (type === 'block_close' && this.isAtRecordKeyPosition(source, i, flexMatch, excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // Check if compound close keyword is used as a variable name
      if (type === 'block_close' && isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions, this.helperCallbacks)) {
        return { nextPos: flexMatch };
      }

      // Check if compound middle keyword is used as a variable name
      if (type === 'block_middle' && isKeywordAsVariableName(source, i, source.slice(i, flexMatch), excludedRegions, this.helperCallbacks)) {
        return { nextPos: flexMatch };
      }

      // Reject compound block_middle in record key position (e.g., `{else if: 5}`)
      if (type === 'block_middle' && this.isAtRecordKeyPosition(source, i, flexMatch, excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // Reject a compound block_middle keyword immediately followed by a record-key
      // colon (e.g., `else if: 5`, `on error: 5`). AppleScript has no `else if:`/
      // `on error:` section syntax, so the colon makes the keyword a record property
      // name (or invalid code), never an intermediate of the enclosing block. Mirrors
      // the single-keyword guard at tryMatchSingleKeywordToken: it fires regardless of
      // whether an enclosing record literal is reachable, since a colon-suffixed middle
      // keyword is never a real section delimiter.
      if (type === 'block_middle' && this.isFollowedByRecordKeyColon(source, flexMatch, excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // 'on error' is only a keyword at logical line start (like single-word 'on')
      if (type === 'block_middle' && keyword === 'on error') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // `else if` is only a valid block_middle at the start of a logical line.
      // Mid-line occurrences (e.g., `set y to else if`) are identifier/value
      // usages, not intermediates of the enclosing `if` block.
      if (type === 'block_middle' && keyword === 'else if') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Check if compound middle keyword is used in set/copy/possessive patterns.
      // The VAR_NAME_PATTERNS regexes accept ASCII space/tab plus Unicode whitespace
      // (NBSP etc.) so `set<NBSP>else if<NBSP>to`-style sources are recognized the
      // same way as their ASCII-whitespace counterparts.
      if (type === 'block_middle') {
        const ls = findLogicalLineStart(source, i, excludedRegions, this.helperCallbacks);
        const lineBefore = source
          .slice(ls, i)
          .toLowerCase()
          .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
          .trimStart();
        if (VAR_NAME_PATTERNS.setOrCopyBefore.test(lineBefore) || VAR_NAME_PATTERNS.possessiveBefore.test(lineBefore)) {
          return { nextPos: flexMatch };
        }
      }

      // Reject compound block openers not at logical line start (covers if-condition, tell...to one-liner, and mid-line contexts)
      if (type === 'block_open') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: flexMatch };
        }
      }

      // Reject compound block_open used as a record key (e.g., multi-line
      // `{\n  with timeout: 5\n}`). Mirrors the block_close/block_middle guards:
      // even at logical line start the keyword may be a property name inside a
      // record literal that spans multiple lines, in which case it must not
      // open a block and steal an outer block's close keyword.
      if (type === 'block_open' && this.isAtRecordKeyPosition(source, i, flexMatch, excludedRegions)) {
        return { nextPos: flexMatch };
      }

      // Check if compound open keyword is used as a variable name
      if (type === 'block_open') {
        const ls = findLogicalLineStart(source, i, excludedRegions, this.helperCallbacks);
        // Strip excluded regions first (before toLowerCase to preserve positions). Use the
        // binary-search-backed helper so the cost is O(log N + K) per keyword rather than
        // O(N) per keyword via excludedRegions.filter(...), which made tokenize O(N^2) when
        // every block carried a trailing comment.
        // VAR_NAME_PATTERNS accept ASCII space/tab plus Unicode whitespace (NBSP etc.) so
        // `set<NBSP>with timeout<NBSP>to`-style sources are recognized the same way as
        // their ASCII-whitespace counterparts.
        const lineBefore = stripExcludedRegionsInRange(source, ls, i, excludedRegions)
          .toLowerCase()
          .replace(/\u00AC[^\r\n]*(?:\r\n|\r|\n)[ \t]*/g, ' ')
          .trimStart();
        if (
          VAR_NAME_PATTERNS.setOrCopyBefore.test(lineBefore) ||
          VAR_NAME_PATTERNS.possessiveBefore.test(lineBefore) ||
          VAR_NAME_PATTERNS.ofBefore.test(lineBefore) ||
          VAR_NAME_PATTERNS.inBefore.test(lineBefore) ||
          VAR_NAME_PATTERNS.commandBefore.test(lineBefore)
        ) {
          return { nextPos: flexMatch };
        }
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      // endOffset spans the actual source range from the first word to the end of the
      // last word so the entire compound keyword is decorated. Earlier code used
      // `startOffset + value.length`, which under-decorates when the words are
      // separated by extra whitespace, comments, or `¬` continuations.
      return {
        nextPos: flexMatch,
        token: { type, value: keyword, startOffset: i, endOffset: flexMatch, line, column }
      };
    }

    return null;
  }

  // Tries to match a single-word keyword at position, returns match result or null
  private tryMatchSingleKeywordToken(
    source: string,
    i: number,
    excludedRegions: ExcludedRegion[],
    newlinePositions: number[]
  ): { nextPos: number; token?: Token } | null {
    const singleKeywords = ['tell', 'if', 'repeat', 'try', 'considering', 'ignoring', 'script', 'on', 'to', 'else', 'end'];

    for (const keyword of singleKeywords) {
      if (source.slice(i, i + keyword.length).toLowerCase() !== keyword) continue;

      const endPos = i + keyword.length;
      if (endPos < source.length && /\w/.test(source[endPos])) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // 'to', 'on', 'script', 'considering', 'ignoring', and 'try' are only block
      // openers at logical line start. 'tell'/'if'/'repeat' are allowed mid-line
      // only within condition contexts (e.g., 'if tell then' or 'repeat while ...').
      if (
        type === 'block_open' &&
        (keyword === 'to' || keyword === 'on' || keyword === 'script' || keyword === 'considering' || keyword === 'ignoring' || keyword === 'try')
      ) {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
        // 'to' and 'on' as handler-definition openers must be followed by an identifier
        // (the handler name). Reject `to 5`, `to "string"`, etc., which are typos or
        // continuations of the previous statement, not handler declarations.
        // The probe skips ASCII space/tab, Unicode whitespace, `¬<newline>` line
        // continuations, and block comments `(* ... *)` between the keyword and the
        // identifier. A pipe-delimited identifier `|name|` is accepted as a valid
        // identifier start; bare Unicode letters (e.g. `Ωfoo`) are rejected because
        // AppleScript requires non-ASCII identifiers to be enclosed in pipes.
        if (keyword === 'to' || keyword === 'on') {
          const probe = this.skipHandlerProbeWhitespace(source, endPos, excludedRegions);
          if (probe >= source.length || !this.isHandlerIdentifierStart(source[probe])) {
            return { nextPos: endPos };
          }
          // Reject bare reserved words as handler names (e.g., `on if`, `to tell`,
          // `on repeat`). These are syntax errors. However, when the reserved word
          // is followed by `(`, treat it as a function-style handler declaration
          // (`on tell()`, `to tell()`) so the existing fallback pairing kicks in.
          if (this.isReservedHandlerName(source, probe)) {
            return { nextPos: endPos };
          }
        }
      }

      // 'tell', 'if', 'repeat' may appear mid-line in condition contexts (after 'if',
      // 'repeat while'/'until'), but must be rejected when preceded by an expression
      // terminator like ')', ']', '}', a binary operator (& + - * / = < > etc.), or
      // a value across line continuations (e.g., 'set x to ¬\ntell ...' where tell is
      // the right operand of `to`).
      if (type === 'block_open' && (keyword === 'tell' || keyword === 'if' || keyword === 'repeat')) {
        if (this.isPrecededByExpressionTerminator(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // Reject single block_open used as a record key (e.g., multi-line
      // `{\n  tell: 5\n}`). Mirrors the block_close/block_middle guards: even at
      // logical line start the keyword may be a property name inside a record
      // literal that spans multiple lines, in which case it must not open a
      // block and steal an outer block's close keyword.
      if (type === 'block_open' && this.isAtRecordKeyPosition(source, i, endPos, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Validate block open keywords (e.g., single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, i, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if block opener is used as a variable/property name or in expression context
      if (type === 'block_open' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
        return { nextPos: endPos };
      }

      // Bare 'end' is only a block close at physical line start. Also reject when
      // the previous physical line ends with `¬` (continuation), e.g.
      // `set x to 5 ¬\n  end` — the trailing `end` is part of the expression,
      // not a block close.
      if (type === 'block_close' && keyword === 'end') {
        if (!this.isAtPhysicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
        if (this.isOnContinuationLine(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
      }

      // Reject bare 'end' used as a record key (e.g., multi-line
      // `{\n  end: 5\n}`). Mirrors the compound block_close guard at
      // tryMatchCompoundKeywordToken lines 511-513: even at physical line start,
      // the keyword may be a property name inside a record literal that spans
      // multiple lines, in which case it must not pair with an outer block opener.
      if (type === 'block_close' && keyword === 'end' && this.isAtRecordKeyPosition(source, i, endPos, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Check if 'end' is used as a variable/property name
      if (type === 'block_close' && keyword === 'end' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
        return { nextPos: endPos };
      }

      // Check if middle keyword is used as a variable/property name
      if (type === 'block_middle' && isKeywordAsVariableName(source, i, keyword, excludedRegions, this.helperCallbacks)) {
        return { nextPos: endPos };
      }

      // Reject single block_middle in record key position (e.g., `{else: 5}`)
      if (type === 'block_middle' && this.isAtRecordKeyPosition(source, i, endPos, excludedRegions)) {
        return { nextPos: endPos };
      }

      // Reject a block_middle keyword immediately followed by a record-key colon
      // (e.g., `else: 5`, `on error: ...`). AppleScript has no `else:`/`on error:`
      // syntax, so the colon makes the keyword a record property name (or invalid
      // code), never an intermediate of the enclosing block. Unlike the record-key
      // guard above, this fires regardless of whether an enclosing record literal
      // is reachable, since a colon-suffixed middle keyword is never a real
      // section delimiter.
      if (type === 'block_middle' && this.isFollowedByRecordKeyColon(source, endPos, excludedRegions)) {
        return { nextPos: endPos };
      }

      // `else` is only a valid block_middle when it appears at the start of a
      // logical line. Mid-line occurrences (e.g., `set y to else`, `display dialog else`,
      // `beep else`, `(1)else`) are identifier/value usages, not intermediates of
      // the enclosing `if` block. Also reject `else(` (function-call form, with
      // optional whitespace before `(`) regardless of line position.
      if (type === 'block_middle' && keyword === 'else') {
        if (!this.isAtLogicalLineStart(source, i, excludedRegions)) {
          return { nextPos: endPos };
        }
        let parenScan = endPos;
        while (parenScan < source.length && (source[parenScan] === ' ' || source[parenScan] === '\t' || isUnicodeWhitespace(source[parenScan]))) {
          parenScan++;
        }
        if (parenScan < source.length && source[parenScan] === '(') {
          return { nextPos: endPos };
        }
        // Reject `else if(...)` (function-call form of `if`). The compound `else if`
        // matcher already rejects the tight `else if(` shape, but falls back to the
        // single-keyword path, which would otherwise attach a bare `else` as an
        // intermediate. Detect `if` followed directly by `(` (no ASCII space/tab
        // between them, which would have been recognized as a real `else if` block).
        if (parenScan + 2 <= source.length && source.slice(parenScan, parenScan + 2).toLowerCase() === 'if') {
          const afterIf = parenScan + 2;
          if (afterIf >= source.length || !/\w/.test(source[afterIf])) {
            let parenScan2 = afterIf;
            while (parenScan2 < source.length && isUnicodeWhitespace(source[parenScan2])) parenScan2++;
            if (parenScan2 < source.length && source[parenScan2] === '(') {
              return { nextPos: endPos };
            }
          }
        }
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      return {
        nextPos: endPos,
        token: { type, value: keyword, startOffset: i, endOffset: endPos, line, column }
      };
    }

    return null;
  }

  // Returns true when the keyword ending at `endPos` is immediately followed
  // (skipping spaces/tabs, `¬` line continuations, and excluded regions) by a
  // record-key colon `:`. Shared by isAtRecordKeyPosition (record literal key
  // detection) and the block_middle colon-suffix guard.
  private isFollowedByRecordKeyColon(source: string, endPos: number, excludedRegions: ExcludedRegion[]): boolean {
    let after = endPos;
    while (after < source.length) {
      const ch = source[after];
      if (ch === ' ' || ch === '\t') {
        after++;
        continue;
      }
      if (ch === '¬') {
        after++;
        if (after < source.length && source[after] === '\r') after++;
        if (after < source.length && source[after] === '\n') after++;
        continue;
      }
      const region = this.findExcludedRegionAt(after, excludedRegions);
      if (region) {
        after = region.end;
        continue;
      }
      break;
    }
    return after < source.length && source[after] === ':';
  }

  // Checks if the keyword at [pos, endPos) is in a record-key position, e.g.
  // `{else: 5}`, `{a: 1, else: 5}`, or a multi-line record:
  //   {
  //     end if: 5
  //   }
  // Such positions use the keyword as a property name in a record literal,
  // not as a block keyword. Brace depth is tracked so that nested {} groups
  // are skipped transparently and we only consider the most recent token at
  // the keyword's own brace level.
  private isAtRecordKeyPosition(source: string, pos: number, endPos: number, excludedRegions: ExcludedRegion[]): boolean {
    // A record-key colon must follow the keyword; otherwise it is not a key.
    if (!this.isFollowedByRecordKeyColon(source, endPos, excludedRegions)) return false;

    // Before the keyword, walk backward looking for the '{' that opens the
    // enclosing record literal at the keyword's own brace level. Track {/} depth
    // so that nested {} groups (e.g. {a: {x: 1}, else: 2}) are skipped
    // transparently. The keyword is a record key when that '{' is reachable; the
    // intervening characters are the preceding record entries (`a: 1`), their
    // separators (','), values, and whitespace, which may span multiple physical
    // lines because record literals can wrap across newlines even without a
    // trailing comma on the preceding entry.
    //
    // A statement-terminating newline followed by content that cannot be part of
    // a record entry would normally distinguish a real block keyword, but the
    // after-keyword ':' check above already filters those out: a bare/compound
    // block keyword that is genuinely closing a block is not followed by ':'.
    // So once we know a ':' follows, treating any reachable enclosing '{' as a
    // record context yields the cost-minimizing result (zero orphans) without
    // misclassifying real block keywords.
    let before = pos - 1;
    let depth = 0;
    let scanned = 0;
    while (before >= 0) {
      // Bound the backward walk so an unclosed '{' far away (or a long run of
      // colon-suffixed keywords) does not make this scan O(N). Counting every
      // iteration — including skipped excluded-region characters — keeps the call
      // O(1) per use. Exceeding the cap means no enclosing record '{' is within a
      // plausible distance, so the keyword is treated as a real block keyword.
      scanned++;
      if (scanned > MAX_RECORD_KEY_SCAN_CHARS) return false;
      const region = this.findExcludedRegionAt(before, excludedRegions);
      if (region) {
        before = region.start - 1;
        continue;
      }
      const ch = source[before];
      if (ch === '}') {
        depth++;
        before--;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) {
          // Found the enclosing brace at our level — keyword is a record key.
          return true;
        }
        depth--;
        before--;
        continue;
      }
      // Any other character (record entries, separators, values, whitespace, or
      // characters inside a nested {} group) is skipped while we search backward
      // for the enclosing '{'. Reaching the start of the source without finding
      // one means the keyword is not inside a record literal.
      before--;
    }
    return false;
  }

  // Checks whether the previous physical line ends with a `¬` continuation marker
  // (i.e. the keyword at `pos` lives on a continuation of the previous statement).
  // Used to suppress close keywords like `end tell` that appear at the start of a
  // physical line but are actually mid-statement (e.g. `set x to 5 ¬\n  end tell`).
  private isOnContinuationLine(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    if (lineStart === 0) return false;
    let prevEnd = lineStart - 1;
    if (prevEnd >= 0 && source[prevEnd] === '\n') prevEnd--;
    if (prevEnd >= 0 && source[prevEnd] === '\r') prevEnd--;
    while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
      prevEnd--;
    }
    // Skip excluded regions backward (e.g., single-line comments like "-- comment")
    while (prevEnd >= 0) {
      const region = this.findExcludedRegionAt(prevEnd, excludedRegions);
      if (region) {
        prevEnd = region.start - 1;
        while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
          prevEnd--;
        }
        continue;
      }
      break;
    }
    return prevEnd >= 0 && source[prevEnd] === '¬' && !this.isInExcludedRegion(prevEnd, excludedRegions);
  }

  // Checks if a keyword is at the start of a physical line (only whitespace
  // before it on the same physical line, skipping excluded regions). Unlike
  // isAtLogicalLineStart, continuation from a previous line via ¬ is allowed.
  private isAtPhysicalLineStart(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    // Use the binary-search-backed strip helper so this stays O(log N + K) per call
    // instead of O(N) via excludedRegions.filter(...), which dominated tokenize when
    // many block keywords coexisted with many excluded regions (e.g. trailing comments).
    const beforeText = stripExcludedRegionsInRange(source, lineStart, pos, excludedRegions);
    return LINE_LEADING_WHITESPACE_PATTERN.test(beforeText);
  }

  // Checks if a keyword is at the start of a logical line (allowing block comments before)
  // Checks if the keyword at pos is preceded by an expression terminator (), ], }, or
  // a word character immediately adjacent (mid-line after an expression). Used to reject
  // tell/if/repeat appearing mid-line after a non-keyword expression (e.g., 'doStuff() tell').
  private isPrecededByExpressionTerminator(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = pos - 1;
    // Skip whitespace (ASCII space/tab and Unicode whitespace such as NBSP), excluded
    // regions, and `¬<newline>` line continuations (so the preceding logical token across
    // continuations is examined).
    while (i >= 0) {
      if (source[i] === ' ' || source[i] === '\t' || isUnicodeWhitespace(source[i])) {
        i--;
        continue;
      }
      if (source[i] === '\n' || source[i] === '\r') {
        // Probe for `¬` before the newline (with optional intermediate whitespace)
        let probe = i;
        if (source[probe] === '\n' && probe > 0 && source[probe - 1] === '\r') probe--;
        probe--;
        while (probe >= 0 && (source[probe] === ' ' || source[probe] === '\t' || isUnicodeWhitespace(source[probe]))) probe--;
        if (probe >= 0 && source[probe] === '¬') {
          i = probe - 1;
          continue;
        }
        break;
      }
      if (source[i] === '¬') {
        i--;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        // The opening character of the region tells us what kind of region it is.
        // Value-producing literals (double-quoted/smart-quoted strings, pipe-delimited
        // identifiers, chevron `«…»` references) act as expression terminators: a
        // following tell/if/repeat is the right operand of an implicit concatenation,
        // not a new block opener. Line comments (`--`) and block comments (`(*`) are
        // not value expressions, so they must keep transparently skipping backward to
        // find the actual preceding token.
        const opener = source[region.start];
        if (opener === '"' || opener === '“' || opener === '|' || opener === '«') {
          return true;
        }
        i = region.start - 1;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    const ch = source[i];
    // Expression terminators: closing brackets/parens/braces
    if (ch === ')' || ch === ']' || ch === '}') return true;
    // Expression operands: opening brackets/parens/braces, commas, or record key separator
    // (e.g., (tell), {tell, repeat}, {key: tell}). The keyword is being used as a value
    // inside a literal/grouping, not as a block opener.
    if (ch === '(' || ch === '[' || ch === '{' || ch === ',' || ch === ':') return true;
    // AppleScript binary operators: keyword used as right operand
    // (e.g., `set x to 1 & tell`, `set x to 1 + tell`, `if x = tell ...`, `set x to 2 ^ tell`)
    // Includes ASCII operator chars and Unicode operators (≤ ≥ ≠ ÷ × and the U+2212
    // minus sign that Script Editor produces when auto-converting ASCII `-`).
    if ('&+\\-*/=<>^'.includes(ch)) return true;
    if (ch === '≤' || ch === '≥' || ch === '≠' || ch === '÷' || ch === '×' || ch === '−') return true;
    // Stray right double quotation mark `”` (U+201D) without its opening `“`: a balanced
    // `“…”` is consumed as an excluded string region before this scan runs, so reaching a
    // lone `”` here means it terminated a (malformed) string literal. Treat it as an
    // expression terminator so a following tell/if/repeat is the right operand, not a block
    // opener. This only fires on stray `”`, leaving valid smart-quoted strings untouched.
    if (ch === '”') return true;
    // String/literal value terminator: any alphanumeric/underscore that is not part of a
    // known control keyword. We conservatively accept if preceding char is any word character
    // and look back for the preceding token (simple heuristic: if it's a control keyword,
    // allow; otherwise reject as mid-line after expression).
    if (/[a-zA-Z0-9_]/.test(ch)) {
      // Extract the preceding word token
      const wordEnd = i + 1;
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.slice(wordStart, wordEnd).toLowerCase();
      // Control keywords and intermediates that legitimately precede tell/if/repeat mid-line
      // (e.g., 'if tell', 'else tell', 'repeat while tell')
      // Note: `tell` and `repeat` are intentionally excluded so that constructs like
      // `end tell tell ...` or `end repeat repeat ...` do not let the trailing tell/repeat
      // be detected as a new mid-line block opener. Condition contexts (`if tell then`,
      // `repeat while tell`) are still handled by the dedicated isInsideIfCondition check.
      // Control flow keywords that can legitimately be followed by another block keyword
      // (e.g., `if tell then`, `else if`, `repeat while ...`).
      // Note: modifier-style keywords (is/as/with/where/given/returning/in/of/by/from/to/without)
      // are intentionally excluded — after these, the next word is a value (e.g., `whose name is tell`).
      // 'on' is excluded because handler definitions like `on tell()` use the next word as the handler name.
      // Boolean operators (`and`, `or`, `not`) and the `when` modifier are also excluded:
      // they take an expression as right operand, so `set x to a and tell` treats the
      // trailing `tell` as an identifier value, not a block opener.
      // `then` is excluded because a block keyword after `then` on the same physical line is
      // the action of a single-line `if ... then <action>` (e.g., `if x then tell app`), not a
      // new multi-line block opener — admitting it would let the action `tell`/`if`/`repeat`
      // steal a following `end`/`end tell` and produce a spurious block. The condition-context
      // `if tell then` (keyword before `then`) is unaffected, handled by isInsideIfCondition.
      const allowedPrecedingKeywords = new Set(['if', 'else', 'while', 'until', 'considering', 'ignoring', 'try']);
      if (allowedPrecedingKeywords.has(word)) {
        return false;
      }
      return true;
    }
    return false;
  }

  private isAtLogicalLineStart(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      // Skip over excluded regions (multi-line block comments may contain newlines)
      const region = this.findExcludedRegionAt(lineStart - 1, excludedRegions);
      if (region) {
        lineStart = region.start;
        continue;
      }
      lineStart--;
    }
    // Check if previous physical line ends with continuation character
    if (lineStart > 0) {
      let prevEnd = lineStart - 1;
      if (prevEnd >= 0 && source[prevEnd] === '\n') prevEnd--;
      if (prevEnd >= 0 && source[prevEnd] === '\r') prevEnd--;
      while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
        prevEnd--;
      }
      // Skip excluded regions backward (e.g., single-line comments like "-- comment")
      while (prevEnd >= 0) {
        const region = this.findExcludedRegionAt(prevEnd, excludedRegions);
        if (region) {
          prevEnd = region.start - 1;
          while (prevEnd >= 0 && (source[prevEnd] === ' ' || source[prevEnd] === '\t')) {
            prevEnd--;
          }
          continue;
        }
        break;
      }
      if (prevEnd >= 0 && source[prevEnd] === '\u00AC' && !this.isInExcludedRegion(prevEnd, excludedRegions)) {
        return false;
      }
    }
    // Strip excluded regions (block comments) from the text before the keyword.
    // Binary-search-backed to keep the cost O(log N + K) per call (same reason as
    // isAtPhysicalLineStart above).
    const beforeText = stripExcludedRegionsInRange(source, lineStart, pos, excludedRegions);
    return LINE_LEADING_WHITESPACE_PATTERN.test(beforeText);
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
          // 'on error' outside a try block is a standalone handler (block_open)
          if (token.value === 'on error') {
            // Only treat as intermediate if try is the direct parent (top of stack)
            if (stack.length > 0 && stack[stack.length - 1].token.value === 'try') {
              stack[stack.length - 1].intermediates.push(token);
              break;
            }
            // Otherwise, treat as standalone handler (block_open)
            stack.push({ token, intermediates: [] });
            break;
          }
          // 'else' and 'else if' are only valid as intermediates of an 'if' block.
          // Attach to the nearest ancestor 'if' on the stack so the intermediate is
          // preserved even when an inner block (e.g. 'repeat') is still open. When no
          // ancestor 'if' exists the keyword is dropped (syntax error, e.g. inside a
          // 'try' with no enclosing 'if').
          if (token.value === 'else' || token.value === 'else if') {
            for (let i = stack.length - 1; i >= 0; i--) {
              if (stack[i].token.value === 'if') {
                stack[i].intermediates.push(token);
                break;
              }
            }
            break;
          }
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
            // Compound openers like `with transaction` map their close keyword to
            // the full opener string. Handler-name fallbacks (e.g. `on transaction()`)
            // store only the last word as the handler name, so use the last word for
            // handler-name comparison.
            //
            // Exception: `using terms from` ends in the generic preposition `from`.
            // Falling back to `from` would pair `on from()` (a legitimate handler
            // declaration named `from`) with `end using terms from`, producing a
            // semantically wrong cross-pair. Per the cost-minimization principle
            // (CLAUDE.md), suppressing fallback here yields zero orphans for the
            // most common authoring intent (`on from()` matched by `end from` or
            // bare `end`) and only forgoes a speculative handler-name pairing for
            // the unlikely `on using terms from()` form.
            //
            // `with timeout` / `with transaction` keep the fallback because their
            // last word (`timeout` / `transaction`) is a plausible handler name and
            // existing regression tests pin that behavior.
            const allowHandlerFallback = expectedOpener !== 'using terms from';
            const handlerNameTarget = expectedOpener.includes(' ') ? (expectedOpener.split(' ').pop() as string) : expectedOpener;
            // Walk the stack from the most recently pushed opener back to the bottom
            // and pair with the first opener that matches either by direct keyword
            // (e.g., `tell`) or by handler-name fallback (e.g., `on tell()` / `to tell()`).
            // This ensures LIFO pairing when a handler named like a block keyword is
            // nested inside an outer block of the same type.
            for (let i = stack.length - 1; i >= 0; i--) {
              const block = stack[i];
              const value = block.token.value;
              if (value === expectedOpener) {
                matchIndex = i;
                break;
              }
              if (allowHandlerFallback && (value === 'on' || value === 'to') && this.handlerName(block) === handlerNameTarget) {
                matchIndex = i;
                break;
              }
            }
          } else {
            // Generic "end" closes any block
            matchIndex = stack.length > 0 ? stack.length - 1 : -1;
          }

          if (matchIndex >= 0) {
            // Any openers pushed after matchIndex are inner scopes that the matched
            // opener encloses. Closing the matched opener while those inner scopes are
            // still unclosed would let their own close keywords pair into geometrically
            // crossing BlockPairs. Per the anchor-set / cost-minimization principle,
            // discard those inner openers as unclosed so the matched pair stays the only
            // non-overlapping result; their orphan close keywords are left uncolored.
            const removed = stack.splice(matchIndex);
            const openBlock = removed[0];
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

  // Checks if an empty parenthesized call `()` starts at `pos`, allowing optional
  // ASCII whitespace before `(` and whitespace-only content between the parens.
  // `tell ()`, `tell( )`, and `tell  ( )` are function-call forms (rejected),
  // whereas `tell (window 1)` carries a real object specifier and must NOT match.
  private isEmptyParenCall(source: string, pos: number): boolean {
    let i = pos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
    if (i >= source.length || source[i] !== '(') return false;
    i++;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
    return i < source.length && source[i] === ')';
  }

  // Checks if 'tell' is followed by a top-level 'to' on the same logical line
  // (one-liner form like `tell app to activate`). A `to` nested inside parentheses
  // (e.g. `tell application (path to me)`) belongs to the target expression — such
  // as the Standard Additions `path to` command — and must NOT be treated as the
  // one-liner marker, otherwise a real multi-line `tell` block is dropped. Paren
  // depth is tracked so only depth-0 occurrences of `to` count; parentheses inside
  // excluded regions (strings, comments, chevrons) are skipped and do not affect it.
  private isTellToOneLiner(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineEnd = findLogicalLineEnd(source, position + 4, excludedRegions, this.helperCallbacks);

    let i = position + 4;
    let parenDepth = 0;
    while (i < lineEnd) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      if (ch === '(') {
        parenDepth++;
        i++;
        continue;
      }
      if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
        i++;
        continue;
      }
      if (
        parenDepth === 0 &&
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

  // Skips whitespace between a handler-opening keyword (`on`/`to`) and the handler
  // name. Handles ASCII space/tab, Unicode whitespace (NBSP etc.), `¬<newline>`
  // line continuations, and block comments `(* ... *)`. Returns the position of
  // the next non-skippable character.
  private skipHandlerProbeWhitespace(source: string, pos: number, excludedRegions: ExcludedRegion[]): number {
    let probe = pos;
    while (probe < source.length) {
      const ch = source[probe];
      if (ch === ' ' || ch === '\t' || isUnicodeWhitespace(ch)) {
        probe++;
        continue;
      }
      // Line continuation: `¬` followed by optional whitespace and an optional
      // single-line comment (`-- ...`), then a newline. The whitespace between
      // `¬` and the newline may include Unicode whitespace (NBSP, IDEOGRAPHIC
      // SPACE, ZWSP, etc.) so this consumes the same set as the loop's leading
      // whitespace handling above.
      if (ch === '¬') {
        let next = probe + 1;
        while (next < source.length && (source[next] === ' ' || source[next] === '\t' || isUnicodeWhitespace(source[next]))) next++;
        if (next + 1 < source.length && source[next] === '-' && source[next + 1] === '-') {
          while (next < source.length && source[next] !== '\r' && source[next] !== '\n') next++;
        }
        if (next < source.length && (source[next] === '\r' || source[next] === '\n')) {
          if (source[next] === '\r') next++;
          if (next < source.length && source[next] === '\n') next++;
          probe = next;
          continue;
        }
        break;
      }
      // Block comment `(* ... *)` produced by tryMatchExcludedRegion
      const region = this.findExcludedRegionAt(probe, excludedRegions);
      if (region && source[region.start] === '(' && region.start + 1 < source.length && source[region.start + 1] === '*') {
        probe = region.end;
        continue;
      }
      break;
    }
    return probe;
  }

  // Returns true when `ch` may legitimately start a handler-name identifier
  // following an `on`/`to` keyword: ASCII letter/underscore (`foo`, `_x`) or
  // pipe-delimited identifier (`|my handler|`). Bare Unicode letters are
  // rejected because AppleScript requires them to be wrapped in pipes.
  private isHandlerIdentifierStart(ch: string): boolean {
    if (ch === '|') return true;
    return /[a-zA-Z_]/.test(ch);
  }

  // Returns true when the ASCII identifier starting at `pos` is a reserved word
  // (e.g., `if`, `tell`, `repeat`) and is NOT immediately followed by `(`. Such
  // sequences (`on if`, `on tell`, `to repeat`) are syntax errors rather than
  // handler declarations. The `(` exception lets `on tell()` / `to tell()`
  // continue to pair via the handler-name fallback in matchBlocks.
  private isReservedHandlerName(source: string, pos: number): boolean {
    if (pos >= source.length || !/[a-zA-Z_]/.test(source[pos])) return false;
    let end = pos;
    while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) end++;
    const name = source.slice(pos, end).toLowerCase();
    if (!RESERVED_HANDLER_NAMES.has(name)) return false;
    // Allow `on tell(...)` / `to tell(...)` (function-style handler invocation).
    // Skip ASCII or Unicode whitespace between the handler name and `(` so that
    // `on tell<NBSP>()` and similar Unicode-whitespace forms continue to qualify
    // as function-style handler declarations.
    let parenScan = end;
    while (parenScan < source.length && (source[parenScan] === ' ' || source[parenScan] === '\t' || isUnicodeWhitespace(source[parenScan]))) {
      parenScan++;
    }
    if (parenScan < source.length && source[parenScan] === '(') {
      return false;
    }
    return true;
  }
}
