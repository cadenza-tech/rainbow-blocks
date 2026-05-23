// COBOL fixed-format helpers: column-7 comments, string continuation, expression-context detection

import type { ExcludedRegion } from '../types';
import type { CobolHelperCallbacks } from './cobolHelpers';
import { skipBackwardWhitespaceAndComments } from './cobolHelpers';
import { findExcludedRegionAt, findLineStart, isInExcludedRegion } from './parserUtils';

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

// Alphabetic relational operators. They are the word equivalents of the symbolic
// =/</> operators (e.g., `IF X EQUAL Y` == `IF X = Y`), so a WHEN/ELSE directly
// after one of them is the right comparison operand (a data-name position), not a
// control-flow intermediate. Stored uppercase for case-insensitive matching
// (COBOL is case-insensitive).
const RELATIONAL_WORDS = new Set(['EQUAL', 'EQUALS', 'GREATER', 'LESS', 'EXCEEDS']);

// Words that bridge a relational operator and its right operand: GREATER THAN,
// LESS THAN, EQUAL TO. When the word directly before WHEN/ELSE is one of these,
// the relational word is one hop further back (e.g., `GREATER THAN ELSE`).
const RELATIONAL_BRIDGES = new Set(['THAN', 'TO']);

// Reads the identifier-like word (letters/digits/_/-) ending at `endIndex`
// (inclusive). Returns the uppercased word and the start index of the character
// preceding it (for continued backward scanning), or null when `endIndex` is not
// an identifier character. COBOL is case-insensitive, so the word is uppercased.
function readWordBackward(source: string, endIndex: number): { word: string; before: number } | null {
  if (endIndex < 0 || !/[a-zA-Z0-9_-]/.test(source[endIndex])) {
    return null;
  }
  let start = endIndex;
  while (start > 0 && /[a-zA-Z0-9_-]/.test(source[start - 1])) {
    start--;
  }
  return { word: source.slice(start, endIndex + 1).toUpperCase(), before: start - 1 };
}

// Skips whitespace (but not newlines) backward from `from`, returning the index of
// the first non-blank character on the same physical line, or -1 when a newline or
// the buffer start is reached first. Used to walk a same-line relational phrase
// (`GREATER THAN`) without crossing into the previous line.
function skipSameLineBlanksBackward(source: string, from: number): number {
  let i = from;
  while (i >= 0) {
    const c = source[i];
    if (c === '\n' || c === '\r') return -1;
    if (c !== ' ' && c !== '\t') return i;
    i--;
  }
  return -1;
}

// Returns true when the word ending at `wordEnd` (inclusive) is an alphabetic
// relational operator, including the two-word phrases `GREATER THAN`, `LESS THAN`,
// and `EQUAL TO` (where the bridge word THAN/TO sits between the relational word
// and the keyword). The relational phrase must lie on the same physical line as
// the keyword — a relational word dangling at the end of the previous line is an
// incomplete expression, so the next line's WHEN/ELSE is a real intermediate.
function isPrecededByRelationalWord(source: string, wordEnd: number): boolean {
  const directWord = readWordBackward(source, wordEnd);
  if (!directWord) return false;
  if (RELATIONAL_WORDS.has(directWord.word)) return true;
  // Bridge word (THAN/TO): the relational word is one same-line hop further back.
  if (!RELATIONAL_BRIDGES.has(directWord.word)) return false;
  const prevEnd = skipSameLineBlanksBackward(source, directWord.before);
  if (prevEnd < 0) return false;
  const prevWord = readWordBackward(source, prevEnd);
  return prevWord !== null && RELATIONAL_WORDS.has(prevWord.word);
}

// Calculates the visual column of a position, expanding tabs to 8-character stops
export function getVisualColumn(source: string, lineStart: number, pos: number): number {
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
export function isFixedFormatCommentLine(source: string, lineStart: number): boolean {
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

// Locates a fixed-format string-literal continuation starting at or after `newlinePos`.
// Skips blank and column-7 comment lines before looking for a continuation indicator.
// Returns the position immediately after the opening quote on the continuation line, or
// null when no valid continuation is present.
function findFixedFormStringContinuation(source: string, newlinePos: number, quote: string): number | null {
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

// Matches COBOL string with specified quote character. Supports fixed-format continuation
// lines (column-7 `-`): when the literal hits a newline unterminated, the next non-blank,
// non-comment line beginning with `-` in column 7 followed by a matching opening quote
// continues the literal.
export function matchCobolString(source: string, pos: number, quote: string): ExcludedRegion {
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
      const continuation = findFixedFormStringContinuation(source, i, quote);
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

// Returns true when the keyword is preceded by an expression-context character
// (arithmetic operator, separator, or open parenthesis), indicating that the
// keyword is used as an operand/data name rather than a control-flow intermediate.
// Examples: `COMPUTE Y = X + ELSE`, `CALL "P" USING A, ELSE`, `(ELSE + 1)`.
// Skips excluded regions (*> inline comments, >> compiler directives, strings) so
// expression-like characters appearing inside them are not mistaken for real operators.
export function isInExpressionContext(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let i = position - 1;
  let crossedNewline = false;
  // Skip whitespace including newlines (continuation across lines is permitted)
  // and any excluded regions (comments, directives, strings) encountered along the way.
  while (i >= 0) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
    }
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (c === '\n' || c === '\r') crossedNewline = true;
      i--;
      continue;
    }
    break;
  }
  if (i < 0) return false;
  const ch = source[i];
  // A `-` directly after an identifier character (letter/digit/_) is the
  // trailing hyphen of a hyphenated COBOL data name (e.g., `VAR-`), not a
  // subtraction operator. Treating it as an operator would wrongly drop a
  // following WHEN/ELSE. A genuine subtraction operator is separated from its
  // left operand by whitespace, so it would not reach this branch.
  // This is `-` specific: COBOL identifiers continue with `-`, never with the
  // other arithmetic operators `+`/`*`/`/`.
  if (ch === '-' && i > 0 && /[a-zA-Z0-9_]/.test(source[i - 1])) {
    return false;
  }
  // A relational/arithmetic operator, separator (`,`/`;`), or open parenthesis
  // left dangling at the end of the previous line is an incomplete expression
  // (editing in progress). A WHEN/ELSE on the following line is a real
  // control-flow intermediate, not the operator's right operand, so operand
  // suppression for these tokens applies only when the token is on the same
  // physical line as the keyword. Comma/semicolon are COBOL operand separators
  // and `(` opens an expression — same incomplete-expression reasoning applies.
  if (
    crossedNewline &&
    (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '=' || ch === '<' || ch === '>' || ch === ',' || ch === ';' || ch === '(')
  ) {
    return false;
  }
  // Alphabetic relational operators (EQUAL/GREATER/LESS/EXCEEDS, and the phrases
  // GREATER THAN / LESS THAN / EQUAL TO) are the word equivalents of =/</>, so a
  // following WHEN/ELSE is the right comparison operand. Apply the same same-line
  // policy as the symbolic operators: a relational word ending the previous line
  // is an incomplete expression, so do not suppress a next-line WHEN/ELSE.
  // Only letters/digits start such a word; `-`/`_` are handled by the symbolic
  // and hyphen branches above/below, never as the start of a relational word.
  if (/[a-zA-Z0-9]/.test(ch)) {
    if (crossedNewline) return false;
    return isPrecededByRelationalWord(source, i);
  }
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
export function isPrecedingWordDataNameVerb(source: string, position: number, callbacks: CobolHelperCallbacks): boolean {
  const keywordLineStart = findLineStart(source, position);
  let pos = position;
  let crossedNewline = false;
  // The bound prevents pathological inputs from causing super-linear scans on each
  // ELSE/WHEN candidate. A real USING/INTO/TO list with 32 operands is far beyond
  // typical COBOL.
  for (let step = 0; step < 32; step++) {
    let i = skipBackwardWhitespaceAndComments(source, pos - 1, callbacks);
    if (i < 0) return false;
    // Skip a single `,` or `;` separator (followed by more whitespace/comments) so
    // `USING A, B` and `USING A; B` both treat B as a list continuation.
    if (source[i] === ',' || source[i] === ';') {
      i = skipBackwardWhitespaceAndComments(source, i - 1, callbacks);
      if (i < 0) return false;
    }
    // Only identifier-like chars (letters/digits/_/-) form a word. Anything else is a
    // statement boundary, operator, parenthesis, or string-literal close — stop.
    if (!/[a-zA-Z0-9_-]/.test(source[i])) return false;
    const wordEnd = i + 1;
    let wordStart = i;
    while (wordStart > 0 && /[a-zA-Z0-9_-]/.test(source[wordStart - 1])) wordStart--;
    const wordLineStart = findLineStart(source, wordStart);
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
