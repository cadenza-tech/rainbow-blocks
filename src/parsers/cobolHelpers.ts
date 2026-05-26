// COBOL helper functions for pseudo-text context detection and EXEC block matching

import type { ExcludedRegion } from '../types';

// Returns true when `ch` is a non-ASCII Unicode character that would continue an
// identifier (Letter, Mark, Number, or Connector Punctuation). Mirrors the
// identifier-continuation classes used by BaseBlockParser.isAdjacentToUnicodeLetter
// so backward/forward COBOL boundary scans treat e.g. αREPLACE as a single
// identifier (not a bare REPLACE keyword). ASCII letters/digits/underscore are
// expected to be handled by the caller's existing /[a-zA-Z0-9_]/ test; this
// helper covers only code points outside the ASCII range.
export function isUnicodeIdentifierChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code <= 127) return false;
  return /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(ch);
}

// Block-opening verbs (uppercase). When such a verb appears past the copybook
// name of a COPY statement, the COPY statement is over: a period-less COPY does
// not extend across a following block-opening statement. Kept in sync with
// CobolBlockParser.keywords.blockOpen.
export const COPY_TERMINATING_VERBS = new Set([
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

// Block-middle keywords (uppercase) that end a period-less COPY statement.
// Mirrors CobolBlockParser.keywords.blockMiddle. WHEN/ELSE always begin a new
// branch of the enclosing EVALUATE/IF, so a period-less COPY directly followed
// by WHEN or ELSE must terminate before that keyword — otherwise the COPY
// swallows the middle keyword (or its surrounding statement) and the enclosing
// block loses an intermediate or its close.
export const COPY_TERMINATING_MIDDLE_VERBS = new Set(['WHEN', 'ELSE']);

// Block-closing keywords (uppercase) that end a period-less COPY statement.
// Mirrors CobolBlockParser.keywords.blockClose. An END-* keyword always begins a
// new statement (the end of a structured block); without including these here, a
// period-less COPY directly followed by an END-* keyword swallowed the close as a
// copybook name (or as the library word after OF/IN), causing the enclosing block
// pair to disappear.
export const COPY_TERMINATING_CLOSE_VERBS = new Set([
  'END-PERFORM',
  'END-IF',
  'END-EVALUATE',
  'END-READ',
  'END-WRITE',
  'END-REWRITE',
  'END-DELETE',
  'END-START',
  'END-RETURN',
  'END-SEARCH',
  'END-STRING',
  'END-UNSTRING',
  'END-ACCEPT',
  'END-DISPLAY',
  'END-CALL',
  'END-INVOKE',
  'END-COMPUTE',
  'END-ADD',
  'END-SUBTRACT',
  'END-MULTIPLY',
  'END-DIVIDE'
]);

// Non-block COBOL Procedure Division verbs (uppercase) that do not open a block
// pair. A COPY statement accepts only `copybook-name [OF/IN library] [SUPPRESS]
// [REPLACING ...]`; once one of these statement verbs appears past the copybook
// name it begins a new statement, so a period-less COPY is over even though the
// verb is not a block opener. Kept distinct from COPY_TERMINATING_VERBS, which
// covers only the block-opening verbs.
export const COPY_TERMINATING_NONBLOCK_VERBS = new Set([
  'MOVE',
  'SET',
  'INITIALIZE',
  'INSPECT',
  'GO',
  'GOBACK',
  'STOP',
  'EXIT',
  'CONTINUE',
  'OPEN',
  'CLOSE',
  'CANCEL',
  'ALTER',
  'RELEASE',
  'MERGE',
  'SORT',
  'UNLOCK',
  'EXAMINE',
  'TRANSFORM'
]);

// Callbacks for parser methods that remain in CobolBlockParser. The optional cache
// callbacks are populated by the parser before each parse so that pseudo-text /
// COPY-context checks (called once per `==` delimiter) avoid re-scanning the
// entire buffer on every invocation.
export interface CobolHelperCallbacks {
  isFixedFormatCommentLine: (source: string, lineStart: number) => boolean;
  // Returns the offset of the last period outside strings/comments at or before
  // `endExclusive` (i.e., scanning `source.slice(0, endExclusive + 1)`). Cached.
  // Required when isInCopyStatementCached is omitted so isInCopyStatement can
  // still locate the prior statement boundary.
  findLastPeriodOutsideStringsBefore?: (endExclusive: number) => number;
  // Returns true if the position is inside a COPY statement. Cached.
  isInCopyStatementCached?: (posBeforeKeyword: number) => boolean;
  // Per-parse memo for walkBackThroughPseudoChain, keyed by the right-end offset
  // of a closing `==`. Without it, a long run of consecutive `=` (e.g. a divider
  // banner) makes every `==` re-walk all preceding `==` pairs, giving O(n^2) per
  // pass and O(n^3) overall. Populated by the parser before each parse.
  pseudoChainWalkCache?: Map<number, number>;
  // Returns the offset of the first character of the line containing `pos`
  // (just after the previous \n/\r, or 0). Backed by the parser's precomputed
  // newline table for O(log n) lookup. Without it, skipBackwardWhitespaceAndComments
  // walks back to the line start one char at a time, which is O(n) per call and
  // O(n^2) across a long single-line `=` run.
  findLineStart?: (pos: number) => number;
  // Returns the offset of the first `*>` inline-comment marker in [lineStart, endInclusive],
  // or -1 if none. Backed by a precomputed sorted table for O(log n) lookup so the
  // comment scan inside skipBackwardWhitespaceAndComments does not re-scan the whole
  // line on every call.
  firstInlineCommentFrom?: (lineStart: number, endInclusive: number) => number;
}

// Resolves the start offset of the line containing `pos`. Uses the parser's
// precomputed newline table (O(log n)) when available, falling back to a
// backward character scan otherwise.
function lineStartOf(source: string, pos: number, callbacks: CobolHelperCallbacks): number {
  if (callbacks.findLineStart) {
    return callbacks.findLineStart(pos);
  }
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  return lineStart;
}

// Checks if the given position is on a fixed-format comment line or >> compiler directive line
function isOnExcludedLine(source: string, pos: number, callbacks: CobolHelperCallbacks): boolean {
  const lineStart = lineStartOf(source, pos, callbacks);
  // Check fixed-format column 7 comment line
  if (callbacks.isFixedFormatCommentLine(source, lineStart)) return true;
  // Check >> compiler directive line (skip leading whitespace)
  let j = lineStart;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
  if (j + 1 < source.length && source[j] === '>' && source[j + 1] === '>') return true;
  return false;
}

// Advances j backward past whitespace, fixed-format comment lines, >> directive lines,
// and *> inline comments so the backward scan lands on real statement content.
// Used by pseudo-text context detection where COPY REPLACING ... ==X== may have
// intervening comments or directives.
export function skipBackwardWhitespaceAndComments(source: string, startPos: number, callbacks: CobolHelperCallbacks): number {
  let j = startPos;
  while (j >= 0) {
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    if (j < 0) return -1;

    const lineStart = lineStartOf(source, j, callbacks);

    if (isOnExcludedLine(source, j, callbacks)) {
      j = lineStart - 1;
      continue;
    }

    // Jump before the first inline `*>` comment on this line at or before j, if any.
    // The precomputed table answers this in O(log n); the slice/indexOf fallback is
    // O(line length) but only runs when the parser did not supply the table.
    let commentPos: number;
    if (callbacks.firstInlineCommentFrom) {
      commentPos = callbacks.firstInlineCommentFrom(lineStart, j);
    } else {
      const idx = source.slice(lineStart, j + 1).indexOf('*>');
      commentPos = idx === -1 ? -1 : lineStart + idx;
    }
    if (commentPos !== -1) {
      j = commentPos - 1;
      continue;
    }

    break;
  }
  return j;
}

// Match pseudo-text delimiters ==...==
export function matchPseudoText(source: string, pos: number): ExcludedRegion {
  // Look for closing ==
  let i = pos + 2;
  while (i + 1 < source.length) {
    if (source[i] === '=' && source[i + 1] === '=') {
      return { start: pos, end: i + 2 };
    }
    i++;
  }
  // Unterminated pseudo-text: limit the excluded region to the opening '=='
  // rather than swallowing the rest of the source, so subsequent blocks can
  // still be parsed while the user is mid-edit.
  return { start: pos, end: pos + 2 };
}

// Match EXEC/EXECUTE ... END-EXEC block
export function matchExecBlock(source: string, pos: number, callbacks: CobolHelperCallbacks): ExcludedRegion | null {
  const upper = source.slice(pos, pos + 7).toUpperCase();
  const isExec = upper.startsWith('EXEC') && (source.length <= pos + 4 || !/[a-zA-Z0-9_-]/.test(source[pos + 4]));
  const isExecute = upper.startsWith('EXECUTE') && (source.length <= pos + 7 || !/[a-zA-Z0-9_-]/.test(source[pos + 7]));

  if (!isExec && !isExecute) {
    return null;
  }

  // Check word boundary before (ASCII identifier chars + non-ASCII Unicode letters)
  if (pos > 0) {
    const prev = source[pos - 1];
    if (/[a-zA-Z0-9_-]/.test(prev) || prev.charCodeAt(0) > 127) {
      return null;
    }
  }

  // Verify a recognized sub-language keyword follows.
  // Capture the full identifier (incl. digits/_/-) so `EXEC SQL1` does not match `SQL`.
  const startWord = isExecute ? 'EXECUTE' : 'EXEC';
  const afterExec = source.slice(pos + startWord.length).match(/^[ \t]+([a-zA-Z][a-zA-Z0-9_-]*)/);
  if (!afterExec) {
    return null;
  }
  // Reject if the captured word is followed by a non-ASCII Unicode letter (e.g. `EXEC SQLé`)
  const afterWordPos = pos + startWord.length + afterExec[0].length;
  if (afterWordPos < source.length && source[afterWordPos].charCodeAt(0) > 127) {
    return null;
  }
  if (!/^(SQL|CICS|DLI|SQLIMS|HTML|XML|JAVA|ADO|ADABAS|DB2|IMS|IDMS|ORACLE|DATACOM)$/i.test(afterExec[1])) {
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
      if (lineStart < source.length && callbacks.isFixedFormatCommentLine(source, lineStart)) {
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
    // Skip pseudo-text delimiters ==...== inside EXEC block.
    // Pseudo-text content is opaque (used in COPY ... REPLACING ==X== BY ==Y==), so any
    // text inside (including what looks like END-EXEC) is data, not a real EXEC terminator.
    // If unterminated, fall back to advancing one position to keep scanning the EXEC body.
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

  // Unterminated EXEC block: only exclude the EXEC keyword itself, not the entire
  // remaining source. This allows mid-edit code with a missing END-EXEC to still
  // detect blocks in the trailing content.
  return { start: pos, end: pos + startWord.length };
}

// Walks backward over a chain of pseudo-text blocks and BY keywords starting at
// position `i` (after whitespace/comments have already been skipped). Returns the
// position of the character just before the word that terminates the chain — the
// same `j` that the inline loops in isPrecededByKeyword / findPrecedingKeywordPosition
// used to compute before extracting the preceding word. Returns -1 if the scan
// runs off the start of the source.
//
// The walk is memoized per parse (callbacks.pseudoChainWalkCache, keyed by the
// closing-`==` right-end at the start of each iteration). The result of the walk
// depends only on (source, i), and every iteration starts at another closing-`==`
// right-end whose own walk yields the identical terminating position, so caching
// each visited right-end collapses the otherwise O(n^2) re-walk on long `=` runs
// to O(n) amortized. The memo is exact: it stores the same value the un-memoized
// loop would reach, just discovered earlier.
function walkBackThroughPseudoChain(source: string, i: number, callbacks: CobolHelperCallbacks): number {
  const cache = callbacks.pseudoChainWalkCache;
  // Right-ends visited in this walk; all of them terminate at the same position,
  // so we backfill the cache for each once the terminating position is known.
  const visited: number[] = [];
  let j = i;
  // Skip multiple consecutive pseudo-text blocks and BY keywords
  // (e.g., ==a== BY ==b== ==c== BY ==d== <- need to traverse all to reach REPLACING)
  while (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
    if (cache) {
      const memoized = cache.get(j);
      if (memoized !== undefined) {
        for (const v of visited) {
          cache.set(v, memoized);
        }
        return memoized;
      }
      visited.push(j);
    }
    j -= 2;
    // Skip pseudo-text content to find opening ==
    while (j >= 1) {
      if (source[j] === '=' && source[j - 1] === '=') {
        j -= 2;
        break;
      }
      j--;
    }
    j = skipBackwardWhitespaceAndComments(source, j, callbacks);
    if (j < 0) {
      if (cache) {
        for (const v of visited) {
          cache.set(v, -1);
        }
      }
      return -1;
    }
    // If we landed on another closing ==, let the loop handle it directly
    if (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
      continue;
    }
    // Check if the preceding word is BY; if so, skip it and continue the loop.
    // Extend the backward scan across digits/underscore so identifiers like
    // `BY1` or `MY_BY` are read in full (their full spelling is not `BY`); a
    // non-ASCII Unicode letter just before the word means we are mid-identifier
    // (e.g. `αBY`), so reject the match there too.
    const byEnd = j + 1;
    let byStart = j;
    while (byStart >= 0 && /[a-zA-Z0-9_]/.test(source[byStart])) {
      byStart--;
    }
    if (byStart >= 0 && isUnicodeIdentifierChar(source[byStart])) {
      break;
    }
    const byWord = source.slice(byStart + 1, byEnd).toUpperCase();
    if (byWord !== 'BY') {
      break;
    }
    j = skipBackwardWhitespaceAndComments(source, byStart, callbacks);
    if (j < 0) {
      if (cache) {
        for (const v of visited) {
          cache.set(v, -1);
        }
      }
      return -1;
    }
  }
  if (cache) {
    for (const v of visited) {
      cache.set(v, j);
    }
  }
  return j;
}

// Scans backward from position i to check if the preceding word matches target keyword
// Skips whitespace, pseudo-text (==...==), BY keywords, inline *> comments,
// fixed-format comment lines, and >> directive lines.
export function isPrecededByKeyword(source: string, i: number, target: string, callbacks: CobolHelperCallbacks): boolean {
  let j = skipBackwardWhitespaceAndComments(source, i, callbacks);
  if (j < 0) {
    return false;
  }
  j = walkBackThroughPseudoChain(source, j, callbacks);
  if (j < 0) {
    return false;
  }
  // Extract the preceding word. Walk across ASCII letters/digits/underscore so
  // identifiers like `REPLACE5` / `MY_REPLACE` are read in full (their full
  // spelling is not `REPLACE`); a non-ASCII Unicode letter just before the word
  // means we are mid-identifier (e.g. `αREPLACE`), which is also not the bare
  // keyword.
  const wordEnd = j + 1;
  while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
    j--;
  }
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a larger
  // data name) and Unicode-prefixed identifiers like αREPLACE.
  if (j >= 0 && (source[j] === '-' || isUnicodeIdentifierChar(source[j]))) {
    return false;
  }
  const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
  return prevWord === target;
}

// Like isPrecededByKeyword but returns the position before the found keyword (for context verification)
// Returns -1 if the target keyword is not found
export function findPrecedingKeywordPosition(source: string, i: number, target: string, callbacks: CobolHelperCallbacks): number {
  let j = skipBackwardWhitespaceAndComments(source, i, callbacks);
  if (j < 0) {
    return -1;
  }
  j = walkBackThroughPseudoChain(source, j, callbacks);
  if (j < 0) {
    return -1;
  }
  // Extract the preceding word. Walk across ASCII letters/digits/underscore so
  // identifiers like `REPLACING5` / `MY_REPLACING` are read in full (their full
  // spelling is not `REPLACING`); a non-ASCII Unicode letter just before the
  // word means we are mid-identifier (e.g. `αREPLACING`), which is also not the
  // bare keyword.
  const wordEnd = j + 1;
  while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
    j--;
  }
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a larger
  // data name) and Unicode-prefixed identifiers like αREPLACING.
  if (j >= 0 && (source[j] === '-' || isUnicodeIdentifierChar(source[j]))) {
    return -1;
  }
  const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
  if (prevWord === target) {
    return j;
  }
  return -1;
}

// Returns true when the position immediately after word 0 of a COPY statement
// looks like a copybook-name boundary: either the next non-whitespace character
// is a `.` (statement terminator — word 0 is a legitimate copybook name with a
// reserved-word spelling such as `COPY IF.`) or the next word is `OF`/`IN`
// (library qualifier introducing `COPY name OF lib`). When false, a bare COPY
// has been followed directly by a block-opening verb and the verb begins a new
// statement.
function isCopybookNameContextRaw(source: string, afterWord: number): boolean {
  let pos = afterWord;
  while (pos < source.length && /\s/.test(source[pos])) pos++;
  if (pos >= source.length) return false;
  if (source[pos] === '.') return true;
  let wordEnd = pos;
  while (wordEnd < source.length && /[a-zA-Z0-9_-]/.test(source[wordEnd])) wordEnd++;
  const nextWord = source.slice(pos, wordEnd).toUpperCase();
  return nextWord === 'OF' || nextWord === 'IN';
}

// Scans from just after a COPY keyword for the first statement verb that
// appears past the copybook name. The copybook name is the first word after
// COPY; an optional `OF`/`IN <library>` qualifier may follow it. A statement
// verb is either a block-opening verb (IF, PERFORM, ...) or a non-block verb
// (MOVE, SET, ...) — both end a period-less COPY. Returns the offset of that
// verb, or -1 when none is found before `limit`. Strings, *> inline comments,
// fixed-format comment lines and >> directive lines are skipped so keywords
// inside them are not mistaken for a statement boundary.
function findBlockVerbAfterCopy(source: string, copyEnd: number, limit: number, callbacks: CobolHelperCallbacks): number {
  let i = copyEnd;
  let wordIndex = 0;
  let expectLibrary = false;
  while (i < limit) {
    const ch = source[i];
    // Skip *> inline comments to end of line
    if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      continue;
    }
    // Skip string literals (they cannot span line breaks in COBOL)
    if (ch === "'" || ch === '"') {
      i++;
      while (i < source.length && source[i] !== ch && source[i] !== '\n' && source[i] !== '\r') i++;
      if (i < source.length && source[i] === ch) i++;
      continue;
    }
    // Skip fixed-format comment lines and >> directive lines entirely
    if (ch === '\n' || ch === '\r') {
      i++;
      if (i < limit && isOnExcludedLine(source, i, callbacks)) {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
      }
      continue;
    }
    // Identifier-like word
    if (/[a-zA-Z0-9]/.test(ch)) {
      const wordStart = i;
      while (i < source.length && /[a-zA-Z0-9_-]/.test(source[i])) i++;
      if (wordStart >= limit) break;
      const upper = source.slice(wordStart, i).toUpperCase();
      // Word 0 is normally the copybook name itself — never a statement boundary.
      // Exception: a bare COPY (with no copybook name typed yet) followed directly
      // by any statement-boundary verb is best treated as a COPY with no operand,
      // with the verb starting a new statement. Include block-opening, non-block,
      // block-closing, and middle verbs — all four classes end a period-less COPY
      // when they begin word 0. Otherwise an END-IF / ELSE / WHEN / MOVE etc. at
      // word 0 is swallowed as the copybook name and the enclosing block pair or
      // intermediate disappears. Only trigger when the next significant token is
      // neither `.` (statement terminator, which makes the verb a legitimate
      // copybook name like `COPY IF.`) nor `OF`/`IN` (library qualifier, which
      // begins `COPY name OF lib`).
      if (wordIndex === 0) {
        const isBoundaryVerb =
          COPY_TERMINATING_VERBS.has(upper) ||
          COPY_TERMINATING_NONBLOCK_VERBS.has(upper) ||
          COPY_TERMINATING_CLOSE_VERBS.has(upper) ||
          COPY_TERMINATING_MIDDLE_VERBS.has(upper);
        if (isBoundaryVerb && !isCopybookNameContextRaw(source, i)) {
          return wordStart;
        }
        wordIndex++;
        continue;
      }
      // `COPY name OF lib` / `COPY name IN lib`: the library name follows the
      // OF/IN qualifier. If what we expected to be the library name is actually
      // a statement verb (block-opening, non-block, or block-closing), the COPY
      // ended at OF/IN with no library — the verb begins the next statement.
      // Without this guard `COPY ABC OF\nEND-IF` swallowed END-IF as the library.
      if (expectLibrary) {
        expectLibrary = false;
        if (
          COPY_TERMINATING_VERBS.has(upper) ||
          COPY_TERMINATING_NONBLOCK_VERBS.has(upper) ||
          COPY_TERMINATING_CLOSE_VERBS.has(upper) ||
          COPY_TERMINATING_MIDDLE_VERBS.has(upper)
        ) {
          return wordStart;
        }
        continue;
      }
      if (upper === 'OF' || upper === 'IN') {
        expectLibrary = true;
        continue;
      }
      if (
        COPY_TERMINATING_VERBS.has(upper) ||
        COPY_TERMINATING_NONBLOCK_VERBS.has(upper) ||
        COPY_TERMINATING_CLOSE_VERBS.has(upper) ||
        COPY_TERMINATING_MIDDLE_VERBS.has(upper)
      ) {
        return wordStart;
      }
      wordIndex++;
      continue;
    }
    i++;
  }
  return -1;
}

// Checks if position is within a COPY statement by looking for COPY before the last period
// Scans backward for COPY, skipping content inside strings, comments, and directive lines
export function isInCopyStatement(source: string, posBeforeKeyword: number, callbacks: CobolHelperCallbacks): boolean {
  if (callbacks.isInCopyStatementCached) {
    return callbacks.isInCopyStatementCached(posBeforeKeyword);
  }
  if (!callbacks.findLastPeriodOutsideStringsBefore) {
    return false;
  }
  const lastPeriod = callbacks.findLastPeriodOutsideStringsBefore(posBeforeKeyword);
  const beforeKeyword = source.slice(0, posBeforeKeyword + 1);
  const stmtStart = lastPeriod + 1;
  // Search for COPY word-boundary match, verifying each match is not inside a string or comment
  const copyPattern = /(?<![a-zA-Z0-9_-])COPY(?![a-zA-Z0-9_-])/gi;
  const statement = beforeKeyword.slice(stmtStart);
  for (const match of statement.matchAll(copyPattern)) {
    const absPos = stmtStart + match.index;
    // Skip if on a fixed-format comment line or >> compiler directive line
    if (isOnExcludedLine(source, absPos, callbacks)) continue;
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
    if (inString) continue;
    // A period-less COPY otherwise extends to the next period (or end of
    // source), wrongly swallowing later statements. Once a statement verb
    // (block-opening or non-block) appears past the copybook name the COPY
    // statement is over; if the queried position is at or past that verb it is
    // not inside the COPY statement.
    const verbBoundary = findBlockVerbAfterCopy(source, absPos + 4, posBeforeKeyword + 1, callbacks);
    if (verbBoundary >= 0 && posBeforeKeyword >= verbBoundary) continue;
    return true;
  }
  return false;
}

// Scans backward through pseudo-text blocks and BY keywords to find REPLACING or REPLACE
// For REPLACING, additionally verifies it is part of a COPY statement
export function isPrecededByReplacingOrReplace(source: string, posEnd: number, callbacks: CobolHelperCallbacks): boolean {
  const replacingPos = findPrecedingKeywordPosition(source, posEnd, 'REPLACING', callbacks);
  if (replacingPos >= 0) {
    return isInCopyStatement(source, replacingPos, callbacks);
  }
  if (isPrecededByKeyword(source, posEnd, 'REPLACE', callbacks)) {
    return true;
  }
  return isPrecededByKeyword(source, posEnd, 'ALSO', callbacks);
}

// Checks if == at pos is in a COPY REPLACING or REPLACE statement context
// Scans backward for REPLACING, REPLACE, or BY keywords (preceded by another ==...==)
export function isInPseudoTextContext(source: string, pos: number, callbacks: CobolHelperCallbacks): boolean {
  // Scan backward from pos, skipping whitespace, newlines, and comments
  let i = skipBackwardWhitespaceAndComments(source, pos - 1, callbacks);
  if (i < 0) return false;
  // If preceded by closing == of another pseudo-text, scan backward through the == chain
  // to find the actual context keyword (REPLACING/REPLACE) and verify COPY context
  if (i >= 1 && source[i] === '=' && source[i - 1] === '=') {
    return isPrecededByReplacingOrReplace(source, i, callbacks);
  }
  // Extract the word ending at position i. Walk across ASCII letters/digits/
  // underscore so identifiers like `REPLACE5` / `MY_REPLACING` are read in
  // full; a non-ASCII Unicode letter just before the word means we are
  // mid-identifier (e.g. `αREPLACE`), so the word is part of a larger data
  // name, not the bare keyword.
  const wordEnd = i + 1;
  while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) {
    i--;
  }
  const word = source.slice(i + 1, wordEnd).toUpperCase();
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a
  // larger data name) and Unicode-prefixed identifiers like αREPLACE.
  if (i >= 0 && (source[i] === '-' || isUnicodeIdentifierChar(source[i]))) {
    return false;
  }
  // REPLACE (in REPLACE ==old== BY ==new==) - standalone statement
  if (word === 'REPLACE') {
    return true;
  }
  // REPLACING (in COPY ... REPLACING ==old== BY ==new==) - must be in a COPY statement
  if (word === 'REPLACING') {
    return isInCopyStatement(source, i, callbacks);
  }
  // ALSO (in REPLACE ALSO ==old== BY ==new==) - must be preceded by REPLACE, not EVALUATE
  if (word === 'ALSO') {
    return isPrecededByKeyword(source, i, 'REPLACE', callbacks);
  }
  // BY (in ==old== BY ==new==) - must be preceded by REPLACING (in COPY context), REPLACE, or ALSO
  if (word === 'BY') {
    return isPrecededByReplacingOrReplace(source, i, callbacks);
  }
  return false;
}
