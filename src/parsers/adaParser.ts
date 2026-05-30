// Ada block parser: procedure, function, if, loop, case with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import {
  isAdaWhitespace,
  isAdaWordAt,
  isOrElseShortCircuit,
  matchAdaString,
  matchCharacterLiteral,
  scanForwardToIs,
  skipAdaWhitespaceAndComments
} from './adaHelpers';
import type { AdaValidationCallbacks } from './adaValidation';
import {
  isInsideParens,
  isValidAcceptOpen,
  isValidForOpen,
  isValidLoopOpen,
  isValidPackageOpen,
  isValidProtectedOpen,
  isValidRecordOpen,
  isValidSubprogramOpen,
  isValidTaskOpen
} from './adaValidation';
import { BaseBlockParser } from './baseParser';
import {
  buildCaseInsensitiveKeywordPattern,
  findLastOpenerByType,
  findLastOpenerForLoop,
  getTokenTypeCaseInsensitive,
  mergeCompoundEndTokens
} from './parserUtils';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = [
  'if',
  'loop',
  'case',
  'select',
  'record',
  'procedure',
  'function',
  'package',
  'task',
  'protected',
  'accept',
  'entry',
  'return'
];

// Keywords that can precede 'begin' and are closed together with it
const BEGIN_CONTEXT_KEYWORDS = ['declare', 'procedure', 'function', 'task', 'protected', 'package', 'entry'];

// Keywords that, when immediately preceding the identifier `exception`,
// indicate that `Exception` denotes a type-mark rather than a handler-section
// intermediate. Covers raise-statement, derived type, record extension /
// aspect specification, subtype/type declaration, access type, array
// component type, and function result type contexts.
const EXCEPTION_TYPE_MARK_CONTEXTS = new Set(['raise', 'new', 'with', 'is', 'access', 'of', 'return']);

// Character class (regex source, without the enclosing brackets) for the
// separators allowed between 'end' and the type keyword of a compound end.
// Covers Ada LRM 2.1 format_effector (HT, VT, FF, CR, LF, NEL) and the Unicode
// Zs category (NBSP, U+1680, U+2000-200A, U+202F, U+205F, U+3000), plus Unicode
// line/paragraph separators (LS U+2028, PS U+2029). Defined once so tokenize
// and matchBlocks classify the same separator set: JS `\s` does not match
// U+0085 (NEL), so the two stages must not diverge on `\s` vs. this class.
const COMPOUND_END_SEPARATOR_CHARS = ' \\t\\v\\f\\r\\n\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';

// Pattern to match compound end keywords (case insensitive)
// Allows whitespace, newlines, and -- line comments between 'end' and the type keyword.
// The line-comment alternative must use the full Ada LRM 2.2 line terminator
// set (LF, CR, NEL U+0085, LS U+2028, PS U+2029) — both for the
// "comment body" character class (a comment body excludes its terminator)
// and for the terminator literal that follows. Otherwise a comment ending
// at NEL/LS/PS swallows the line terminator into its body, the trailing
// terminator alternative fails to match, and the entire compound-end
// alternative is rejected — leaving `end --comment<NEL>if` to be tokenized
// as a simple `end` followed by an orphan `if` opener.
const COMPOUND_END_PATTERN = new RegExp(
  `\\bend(?:[${COMPOUND_END_SEPARATOR_CHARS}]|--[^\\r\\n\\u0085\\u2028\\u2029]*(?:\\r\\n|\\r|\\n|\\u0085|\\u2028|\\u2029))+(${COMPOUND_END_TYPES.join('|')})\\b`,
  'gi'
);

// Re-extracts the type keyword from a compound-end token's value (e.g.,
// 'end<sep>if' -> 'if'). Uses COMPOUND_END_SEPARATOR_CHARS so it accepts the
// exact separator set tokenize used to build the token (including U+0085 NEL).
// The comment body character class mirrors COMPOUND_END_PATTERN so a comment
// ending at NEL/LS/PS does not over-consume the terminator.
const COMPOUND_END_CLOSE_PATTERN = new RegExp(`^end(?:[${COMPOUND_END_SEPARATOR_CHARS}]|--[^\\r\\n\\u0085\\u2028\\u2029]*)+(\\w+)`);

// Upper bound on the number of characters isSelectAlternativeOrAtLineStart
// scans backward from a line-start `or` while looking for the nearest delimiter
// (`;`, `=>`, `:=`, `when`, the `select` keyword, or another reserved block
// keyword). A select alternative boundary and its preceding statement or guard
// span only a few lines in real Ada code, so a generous 2048-character cap never
// rejects real code, while it keeps the scan O(1) per call — without it, a file
// with many line-start `or` operators degrades to O(n^2) (every `or` scanning
// back to offset 0). Mirrors MAX_PAREN_SCAN_CHARS / MAX_LOOP_PREFIX_SCAN_CHARS
// in adaValidation.ts.
const MAX_OR_BOUNDARY_SCAN_CHARS = 2048;

export class AdaBlockParser extends BaseBlockParser {
  // Most recent source string and excluded regions seen by parse(). Used by
  // matchBlocks to scan for non-keyword markers (e.g., `do` in accept/return
  // bodies) that are not part of the token stream.
  private currentSource = '';
  private currentExcludedRegions: ExcludedRegion[] = [];

  // Override parse() so matchBlocks can consult the original source when it
  // needs to look at non-keyword context (e.g., the `do` separator that
  // distinguishes an accept entry-guard `when` from an `exit when` modifier
  // inside the accept body).
  parse(source: string): BlockPair[] {
    this.currentSource = source;
    this.currentExcludedRegions = this.findExcludedRegions(source);
    return super.parse(source);
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'if',
      'loop',
      'for',
      'while',
      'case',
      'select',
      'record',
      'declare',
      'begin',
      'procedure',
      'function',
      'package',
      'task',
      'protected',
      'accept',
      'entry',
      'return'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'exception', 'or', 'is']
  };

  private get validationCallbacks(): AdaValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Returns a slice of `source` from [start, end) with excluded-region characters replaced by spaces.
  // Used to safely match keywords (e.g., `protected`/`task`) at line ends without picking up
  // matches that occur inside comments or strings.
  private stripExcludedRegions(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): string {
    let result = '';
    for (let i = start; i < end; i++) {
      result += this.isInExcludedRegion(i, excludedRegions) ? ' ' : source[i];
    }
    return result;
  }

  // Validates if keyword is a valid block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const cb = this.validationCallbacks;

    if (lowerKeyword === 'entry') {
      const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions));
      if (isPos < 0) return false;
      const k = skipAdaWhitespaceAndComments(source, isPos + 2);
      const afterIs = source.slice(k).match(/^([a-zA-Z_]\w*)/);
      if (afterIs && ['abstract', 'separate', 'new', 'null'].includes(afterIs[1].toLowerCase())) {
        return false;
      }
      if (k < source.length && source[k] === '<' && k + 1 < source.length && source[k + 1] === '>') {
        return false;
      }
      return true;
    }

    if (lowerKeyword === 'task') {
      return isValidTaskOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'package') {
      return isValidPackageOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return isValidSubprogramOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'accept') {
      return isValidAcceptOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'record') {
      return isValidRecordOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'protected') {
      return isValidProtectedOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'if' || lowerKeyword === 'case') {
      return !isInsideParens(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'for') {
      return isValidForOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'loop') {
      return isValidLoopOpen(source, position, excludedRegions, cb);
    }

    // 'return' is a block opener only for extended return statements:
    //   return X : T [:= E] do ... end return;
    // Simple 'return;' or 'return expr;' are statements, not blocks.
    if (lowerKeyword === 'return') {
      return this.isExtendedReturn(source, position + keyword.length, excludedRegions);
    }

    return true;
  }

  // Scans forward from after 'return' to detect extended-return form: ': TYPE ... do'
  private isExtendedReturn(source: string, start: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = skipAdaWhitespaceAndComments(source, start);
    // Ada identifiers may start with a letter (ASCII or Unicode) or underscore,
    // and may contain letters, digits (ASCII or Unicode), and underscores.
    // Use isAdaWordAt-style matching: ASCII word chars + any non-ASCII char (>127)
    // is treated as part of the identifier.
    const identStart = i;
    const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch) || ch.charCodeAt(0) > 127;
    if (i >= source.length) return false;
    const firstCh = source[i];
    // First char must be a letter (ASCII or Unicode) or underscore — not a digit.
    if (!(/[a-zA-Z_]/.test(firstCh) || firstCh.charCodeAt(0) > 127)) return false;
    while (i < source.length && isWordChar(source[i])) {
      i++;
    }
    if (i === identStart) return false;
    i = skipAdaWhitespaceAndComments(source, i);
    if (source[i] !== ':' || source[i + 1] === '=') return false;
    i++;
    let parenDepth = 0;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === ';' && parenDepth === 0) return false;
      else if (parenDepth === 0 && (ch === 'd' || ch === 'D')) {
        if (i + 1 < source.length && (source[i + 1] === 'o' || source[i + 1] === 'O') && isAdaWordAt(source, i, 'do')) {
          // Reject `:= do` (no expression between assignment and do) and `do;`
          // (no extended-return body) — both are malformed. Skip excluded regions
          // (comments / strings) when scanning backward so a comment ending in `:=`
          // is not confused with a real assignment operator. Track whether the
          // backward scan crossed a real expression-bearing region (string or
          // character literal) so that `return X : T := "expr" do` is not
          // misclassified as `:= do`: the literal between := and do is a real
          // expression and must not be ignored.
          //
          // A comment region, on the other hand, is not an expression — Ada
          // comments cannot stand in for a value — so a `:= -- comment\n do`
          // sequence is still the malformed assignment-then-body form. Treat
          // comment regions as transparent (do not set crossedExcludedRegion)
          // so the malformed-form detection continues to fire even when one or
          // more comments separate `:=` from `do`.
          let pb = i - 1;
          let crossedExcludedRegion = false;
          while (pb >= 0) {
            if (this.isInExcludedRegion(pb, excludedRegions)) {
              const region = this.findExcludedRegionAt(pb, excludedRegions);
              if (region) {
                // Ada line comments start with `--`. Anything else (a double
                // or single quote at region.start) is a string or character
                // literal that constitutes a real expression.
                const isComment = region.start + 1 < source.length && source[region.start] === '-' && source[region.start + 1] === '-';
                if (!isComment) {
                  crossedExcludedRegion = true;
                }
                pb = region.start - 1;
                continue;
              }
            }
            // Ada whitespace (LRM 2.1) covers ASCII space/tab/CR/LF/VT/FF,
            // NEL/NBSP, the Zs category, and LS/PS. Recognize all of them so
            // `:=<NBSP>do` is detected as the malformed assignment-then-body
            // form just like `:= do` with an ASCII space.
            if (isAdaWhitespace(source[pb])) {
              pb--;
              continue;
            }
            break;
          }
          if (
            !crossedExcludedRegion &&
            pb >= 1 &&
            source[pb - 1] === ':' &&
            source[pb] === '=' &&
            !this.isInExcludedRegion(pb, excludedRegions) &&
            !this.isInExcludedRegion(pb - 1, excludedRegions)
          ) {
            return false;
          }
          let pf = i + 2;
          while (pf < source.length && isAdaWhitespace(source[pf])) pf++;
          if (pf < source.length && source[pf] === ';') {
            return false;
          }
          return true;
        }
      }
      i++;
    }
    return false;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchAdaString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return matchCharacterLiteral(source, pos);
    }

    return null;
  }

  // Override to recognize Ada LRM 2.2 line terminators (LF, CR, NEL U+0085,
  // LS U+2028, PS U+2029). The default baseParser implementation only stops
  // at `\n` and `\r`, so a `-- comment<NEL>` would swallow the rest of the
  // file even though Ada considers NEL the end of the comment line.
  protected matchSingleLineComment(source: string, pos: number): ExcludedRegion {
    let end = pos;
    while (end < source.length) {
      const code = source.charCodeAt(end);
      if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) break;
      end++;
    }
    return { start: pos, end };
  }

  // Override to record Ada LRM 2.2 line terminators (LF, CR, NEL U+0085,
  // LS U+2028, PS U+2029) as line breaks. The default baseParser
  // implementation only records `\n` and bare `\r`, so Token line/column
  // metadata is wrong when the source uses Unicode line endings.
  protected buildNewlinePositions(source: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      if (code === 0x000a) {
        positions.push(i);
      } else if (code === 0x000d && (i + 1 >= source.length || source.charCodeAt(i + 1) !== 0x000a)) {
        // CR-only line ending (not part of CRLF)
        positions.push(i);
      } else if (code === 0x0085 || code === 0x2028 || code === 0x2029) {
        positions.push(i);
      }
    }
    return positions;
  }

  // Ada-aware version of parserUtils.findLineStart. The shared helper only
  // recognizes `\n`/`\r`, so a source separated by NEL/LS/PS is treated as
  // one giant line. The type-decl `is` filter and other line-relative checks
  // rely on this routine, so it must recognize the full Ada LRM 2.2 line
  // terminator set (LF, CR, NEL U+0085, LS U+2028, PS U+2029).
  private findLineStart(source: string, pos: number): number {
    for (let i = pos - 1; i >= 0; i--) {
      const code = source.charCodeAt(i);
      if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) {
        return i + 1;
      }
    }
    return 0;
  }

  // Steps `scanPos` past the line terminator that ends a previous line so
  // the next backward-scan iteration lands on the last character of that
  // previous line. Recognizes the full Ada LRM 2.2 line terminator set
  // (LF, CR, NEL U+0085, LS U+2028, PS U+2029) plus the CRLF pair, matching
  // findLineStart and buildNewlinePositions. The type-decl `is` filter
  // relies on this to walk across NEL/LS/PS-separated lines; before this
  // helper existed the decrement only matched `\n`/`\r`, so a source
  // separated by NEL/LS/PS got stuck on the terminator (scanPos unchanged
  // across iterations) and the backward scan never reached the `type`
  // keyword across blank lines or a type-name-on-its-own-line layout.
  private skipPreviousLineTerminator(source: string, scanPos: number): number {
    if (scanPos < 0) return scanPos;
    // CRLF: consume both characters as a single line terminator.
    if (scanPos >= 1 && source[scanPos] === '\n' && source[scanPos - 1] === '\r') {
      return scanPos - 2;
    }
    const code = source.charCodeAt(scanPos);
    if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) {
      return scanPos - 1;
    }
    return scanPos;
  }

  // Lowercases the slice `source[start..end)` and removes any leading Ada
  // whitespace (LRM 2.1: ASCII space/tab/CR/LF/VT/FF, NEL, NBSP, LS/PS, and
  // the Zs category). The type-decl `is` filter uses this to obtain the
  // logical content of a previous line: `String.prototype.trimStart()` does
  // not strip U+0085 (NEL), so a line consisting of one or more NELs would
  // be classified as non-empty by the naive `slice().trimStart()` and trip
  // the "stop at non-type-decl line" guard before the backward scan could
  // reach the actual `type` keyword.
  private trimStartAdaLower(source: string, start: number, end: number): string {
    let i = start;
    while (i < end && isAdaWhitespace(source[i])) {
      i++;
    }
    return source.slice(i, end).toLowerCase();
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();

    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      if (!this.isInExcludedRegion(pos, excludedRegions)) {
        const fullMatch = match[0];
        if (this.isAdjacentToUnicodeLetter(source, pos, fullMatch.length)) {
          match = COMPOUND_END_PATTERN.exec(source);
          continue;
        }
        // Reject false compound matches that span across an unrelated
        // statement boundary (e.g., `end\n  if Cond then ...`). After the
        // type keyword, an end statement is terminated by `;`, optionally
        // preceded by a designator (identifier, possibly qualified with
        // dots: `end procedure Foo;`, `end loop Outer;`,
        // `end package Pkg.Inner;`). Anything else (e.g., another
        // keyword like `then` after `Cond`) indicates the type keyword
        // belongs to a separate construct.
        const lookaheadStart = pos + fullMatch.length;
        // Limit the designator lookahead to the current logical statement —
        // i.e., everything up to the next newline (line terminator) or `;`.
        // Without this bound, `end\n<type>\n  <independent statement>;` would
        // misread the independent statement's leading identifier as the
        // designator of this end (e.g., `end\nloop\n  null;` consumed `null`
        // as the designator of `end loop`, swallowing the next block opener).
        // After the type keyword, an end statement is finished on the same
        // line; a designator on a separate line is not allowed by Ada syntax.
        let lookaheadEnd = lookaheadStart;
        while (lookaheadEnd < source.length) {
          const ch = source[lookaheadEnd];
          // Ada LRM 2.2 line terminators (LF, CR, NEL, LS, PS) — and the
          // statement terminator `;` — bound the designator lookahead to
          // the current logical line. Without NEL/LS/PS the lookahead
          // extended past the line and consumed a next-line statement as
          // a "designator", which made the reject path see `;` and accept
          // the compound end across the line break.
          const code = ch.charCodeAt(0);
          if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029 || ch === ';') {
            break;
          }
          lookaheadEnd++;
        }
        let lookahead = skipAdaWhitespaceAndComments(source, lookaheadStart);
        const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch) || ch.charCodeAt(0) > 127;
        // Ada 2012 extended return closes with a fixed `end return;` — it never
        // takes an optional designator. So a `return` immediately following an
        // `end` is only a compound end when the next non-whitespace character
        // is `;`. Otherwise (e.g., `end\n  return Tmp;`) the `return` begins an
        // independent return statement and the preceding `end` is a simple
        // block close; merging them would orphan the block that the simple
        // `end` was meant to close.
        if (match[1].toLowerCase() === 'return' && (lookahead >= source.length || source[lookahead] !== ';')) {
          match = COMPOUND_END_PATTERN.exec(source);
          continue;
        }
        // Reserved keywords that must never be consumed as a designator: any
        // block_open or block_close keyword belongs to a separate construct, so
        // encountering one before the terminating `;` indicates the compound
        // end was already complete.
        const reservedDesignatorBlockers = new Set([...this.keywords.blockOpen, ...this.keywords.blockClose].map((k) => k.toLowerCase()));
        // Skip optional designator: identifier (.identifier)* or an Ada
        // operator-symbol designator written as a string literal (e.g.,
        // `end function "+";`). Both forms may appear in qualified names
        // (e.g., `Math."+"` or `Foo.Bar`).
        while (lookahead < source.length && lookahead < lookaheadEnd) {
          if (source[lookahead] === ';') break;
          const startCh = source[lookahead];
          // Operator-symbol designator: string literal (`"+"`, `"<"`, etc.)
          if (startCh === '"') {
            const strRegion = matchAdaString(source, lookahead);
            // Reject if the string is unterminated or extends past the
            // lookahead window (it would not be a single-line designator).
            if (strRegion.end > lookaheadEnd) break;
            lookahead = strRegion.end;
            lookahead = skipAdaWhitespaceAndComments(source, lookahead);
            // Allow qualified names: '.' followed by another identifier or
            // operator-symbol designator
            if (lookahead < source.length && source[lookahead] === '.') {
              lookahead++;
              lookahead = skipAdaWhitespaceAndComments(source, lookahead);
              continue;
            }
            break;
          }
          // Identifier must start with letter or underscore
          if (!(/[a-zA-Z_]/.test(startCh) || startCh.charCodeAt(0) > 127)) break;
          // Reject if the next word is itself a block keyword (e.g., `if`,
          // `loop`, `case`, `begin`, ...) — those are independent constructs
          // and must not be consumed as the optional designator of this end.
          const wordStart = lookahead;
          let wordEnd = lookahead;
          while (wordEnd < source.length && isWordChar(source[wordEnd])) {
            wordEnd++;
          }
          const word = source.slice(wordStart, wordEnd).toLowerCase();
          if (reservedDesignatorBlockers.has(word)) {
            break;
          }
          lookahead = wordEnd;
          lookahead = skipAdaWhitespaceAndComments(source, lookahead);
          // Allow qualified names: '.' followed by another identifier or
          // operator-symbol designator
          if (lookahead < source.length && source[lookahead] === '.') {
            lookahead++;
            lookahead = skipAdaWhitespaceAndComments(source, lookahead);
            continue;
          }
          break;
        }
        if (lookahead >= source.length || source[lookahead] !== ';') {
          // The designator lookahead did not reach a terminating `;`. This is
          // either a genuinely separate construct (e.g., `end\nloop\n  null;`)
          // or a same-line compound end that is simply missing its trailing
          // `;` (e.g., `end if` on one line followed by `end P;`).
          //
          // Distinguish the two by the separator between `end` and the type
          // keyword: when it contains no line terminator, `end` and the type
          // keyword sit on the same line, which Ada syntax only permits when
          // they form a single compound end. Accept it as an (unterminated)
          // compound end so the type keyword is not misread as a fresh block
          // opener that swallows the enclosing block. When the separator spans
          // a newline, the type keyword belongs to a separate construct and
          // must remain an independent token.
          const separator = fullMatch.slice(3, fullMatch.length - match[1].length);
          // Ada LRM 2.2 line terminator set: LF, CR, NEL (U+0085), LS (U+2028),
          // PS (U+2029). JS `\s` and `[\r\n]` do not cover NEL/LS/PS, so the
          // class must enumerate them explicitly.
          const separatorHasNewline = /[\r\n\u0085\u2028\u2029]/.test(separator);
          if (separatorHasNewline) {
            match = COMPOUND_END_PATTERN.exec(source);
            continue;
          }
        }
        const endType = match[1].toLowerCase();
        // Preserve original casing and whitespace in keyword value so callers
        // (e.g., decorations) see the actual source span. matchBlocks uses a
        // regex that tolerates whitespace and Ada line comments between 'end'
        // and the type keyword for later re-extraction.
        compoundEndPositions.set(pos, {
          keyword: fullMatch,
          length: fullMatch.length,
          endType
        });
      }
      match = COMPOUND_END_PATTERN.exec(source);
    }

    // Tokenize with case-insensitive matching
    const tokens: Token[] = [];
    const keywordPattern = buildCaseInsensitiveKeywordPattern(this.keywords);
    const newlinePositions = this.buildNewlinePositions(source);

    for (const keywordMatch of source.matchAll(keywordPattern)) {
      const startOffset = keywordMatch.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = keywordMatch[1];

      // JavaScript \b only handles ASCII word boundaries, so check for adjacent Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip 'exception' used as a type reference rather than as an intermediate handler section separator.
      // Cases: 'E : exception;' (declaration), 'raise Exception;', 'type T is new Exception;'
      if (type === 'block_middle' && keyword.toLowerCase() === 'exception') {
        let bp = startOffset - 1;
        while (bp >= 0) {
          if (this.isInExcludedRegion(bp, excludedRegions)) {
            const region = this.findExcludedRegionAt(bp, excludedRegions);
            if (region) {
              bp = region.start - 1;
              continue;
            }
          }
          // Ada whitespace covers ASCII space/tab/CR/LF/VT/FF plus NEL,
          // NBSP, LS/PS and the Zs category (LRM 2.1). The backward scan
          // must accept all of them so NBSP-separated forms like
          // `X :<NBSP>exception;` are treated as a variable declaration.
          if (isAdaWhitespace(source[bp])) {
            bp--;
            continue;
          }
          break;
        }
        if (bp >= 0 && source[bp] === ':') {
          continue;
        }
        // Selected_component (qualified name): the dot makes this 'Exception'
        // the last segment of an identifier path (e.g., `raise Pkg.Sub.Exception;`),
        // not a handler-section delimiter.
        if (bp >= 0 && source[bp] === '.') {
          continue;
        }
        // Check for keywords preceding exception that indicate type-mark
        // contexts (the identifier `Exception` denotes a type rather than a
        // handler-section delimiter):
        //   - raise:   raise-statement (`raise Exception;`)
        //   - new:     derived type (`type T is new Exception;`)
        //   - with:    record extension / aspect specification
        //   - is:      subtype/type declaration (`subtype S is Exception;`)
        //   - access:  access type (`type T is access Exception;`)
        //   - of:      array component type (`type T is array(...) of Exception;`)
        //   - return:  function result type (`function F return Exception is`)
        if (bp >= 0 && /[a-zA-Z_]/.test(source[bp])) {
          let wordStart = bp;
          while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
            wordStart--;
          }
          const prevWord = source.slice(wordStart, bp + 1).toLowerCase();
          if (EXCEPTION_TYPE_MARK_CONTEXTS.has(prevWord)) {
            continue;
          }
        }
      }

      // Skip 'is' in type/subtype declarations (type T is ... / subtype S is ...)
      // Also handles multi-line: type T\n  is range 1..100;
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = this.findLineStart(source, startOffset);
        const lineBefore = source.slice(lineStart, startOffset).toLowerCase().trimStart();
        let isTypeDeclLine = /^(type|subtype)\b/.test(lineBefore);
        // When the line starts with 'type', check if 'protected' or 'task' precedes it
        // on a previous line (e.g., "protected\ntype Foo is" should be a block, not a type decl)
        if (isTypeDeclLine && /^type\b/.test(lineBefore)) {
          let scanPos = lineStart - 1;
          while (scanPos >= 0 && isAdaWhitespace(source[scanPos])) {
            scanPos--;
          }
          if (scanPos >= 0) {
            const prevEnd = scanPos + 1;
            const prevLineStart = this.findLineStart(source, prevEnd);
            const prevToken = this.stripExcludedRegions(source, prevLineStart, prevEnd, excludedRegions).toLowerCase().trimEnd();
            if (/\b(?:protected|task)$/.test(prevToken)) {
              isTypeDeclLine = false;
            }
          }
        }
        // Check for type/subtype keyword before this 'is' on the same line,
        // not separated by a semicolon
        // (e.g., "procedure Test is type T is range 1..10;")
        if (!isTypeDeclLine) {
          const lineSlice = source.slice(lineStart, startOffset);
          let lastTypeDeclPos = -1;
          for (const m of lineSlice.matchAll(/\b(type|subtype)\b/gi)) {
            const absPos = lineStart + m.index;
            if (this.isInExcludedRegion(absPos, excludedRegions)) continue;
            // Skip type/subtype inside parentheses (e.g., parameter type names)
            let parenDepthAtMatch = 0;
            for (let pi = lineStart; pi < absPos; pi++) {
              if (this.isInExcludedRegion(pi, excludedRegions)) continue;
              if (source[pi] === '(') parenDepthAtMatch++;
              else if (source[pi] === ')') parenDepthAtMatch--;
            }
            if (parenDepthAtMatch > 0) continue;
            // Skip 'type' when preceded by 'protected' or 'task' (these are block, not type decl)
            if (m[1].toLowerCase() === 'type') {
              const beforeType = this.stripExcludedRegions(source, lineStart, absPos, excludedRegions).toLowerCase().trimEnd();
              if (/\b(?:protected|task)$/.test(beforeType)) continue;
              // When 'type' is at the start of the line, check previous lines
              if (beforeType.length === 0) {
                let sp = lineStart - 1;
                while (sp >= 0 && isAdaWhitespace(source[sp])) {
                  sp--;
                }
                if (sp >= 0) {
                  const pe = sp + 1;
                  const ps = this.findLineStart(source, pe);
                  const pt = this.stripExcludedRegions(source, ps, pe, excludedRegions).toLowerCase().trimEnd();
                  if (/\b(?:protected|task)$/.test(pt)) continue;
                }
              }
            }
            lastTypeDeclPos = absPos;
          }
          if (lastTypeDeclPos >= 0) {
            // Ensure no top-level semicolon between type/subtype keyword and this 'is'
            // (track paren depth so discriminant separators like `(D : Integer; B : Boolean)`
            // are not misinterpreted as statement terminators)
            let hasSemiBetween = false;
            let parenDepth = 0;
            for (let si = lastTypeDeclPos; si < startOffset; si++) {
              if (this.isInExcludedRegion(si, excludedRegions)) continue;
              const ch = source[si];
              if (ch === '(') parenDepth++;
              else if (ch === ')') parenDepth--;
              else if (ch === ';' && parenDepth === 0) {
                hasSemiBetween = true;
                break;
              }
            }
            if (!hasSemiBetween) {
              isTypeDeclLine = true;
            }
          }
        }
        if (isTypeDeclLine) {
          // Find the last top-level semicolon before this 'is' on the same line
          // to handle multiple type declarations on one line
          let lastSemiPos = -1;
          let parenDepth = 0;
          for (let si = lineStart; si < startOffset; si++) {
            if (this.isInExcludedRegion(si, excludedRegions)) continue;
            if (source[si] === '(') parenDepth++;
            else if (source[si] === ')') parenDepth--;
            else if (source[si] === ';' && parenDepth === 0) {
              lastSemiPos = si;
            }
          }
          if (lastSemiPos < 0) {
            // No semicolon → the type/subtype at line start applies to this 'is'
            continue;
          }
          // Check if there's a type/subtype after the last semicolon
          const afterSemi = source
            .slice(lastSemiPos + 1, startOffset)
            .toLowerCase()
            .trimStart();
          if (/^(type|subtype)\b/.test(afterSemi)) {
            continue;
          }
        }
        // Check previous lines if current line has only whitespace before 'is',
        // or if 'is' follows a closing paren from a discriminant list,
        // or if lineBefore has unmatched closing parens (multi-line discriminant)
        // Count paren depth using absolute positions to skip excluded regions
        let lineParenDepth = 0;
        for (let ci = lineStart; ci < startOffset; ci++) {
          if (this.isInExcludedRegion(ci, excludedRegions)) continue;
          if (source[ci] === '(') lineParenDepth++;
          if (source[ci] === ')') lineParenDepth--;
        }
        const hasUnmatchedCloseParen = lineParenDepth < 0;
        if (lineBefore.length === 0 || /^\(.*\)\s*$/.test(lineBefore) || hasUnmatchedCloseParen) {
          let scanPos = lineStart - 1;
          // Skip line terminator (Ada LRM 2.2: LF, CR, CRLF, NEL, LS, PS).
          scanPos = this.skipPreviousLineTerminator(source, scanPos);
          let isTypeDecl = false;
          let typeDeclStart = -1;
          // Track paren depth for multi-line discriminant lists
          // Positive means we're inside a parenthesized group scanning backward
          let scanParenDepth = hasUnmatchedCloseParen ? -lineParenDepth : 0;
          while (scanPos >= 0) {
            const prevStart = this.findLineStart(source, scanPos);
            // trimStartAdaLower also strips U+0085 (NEL), which JS
            // `trimStart()` does not, so a line consisting only of NEL
            // characters is correctly classified as empty.
            const prevLine = this.trimStartAdaLower(source, prevStart, scanPos + 1);
            if (prevLine.length > 0) {
              // Skip comment lines (starting with --)
              if (/^--/.test(prevLine)) {
                scanPos = this.skipPreviousLineTerminator(source, prevStart - 1);
                continue;
              }
              // Track paren depth for multi-line discriminant lists
              // Use absolute positions to skip excluded regions (comments, strings)
              const depthBeforeLine = scanParenDepth;
              let lineHasNonExcludedParen = false;
              for (let ci = prevStart; ci <= scanPos && ci < source.length; ci++) {
                if (this.isInExcludedRegion(ci, excludedRegions)) continue;
                if (source[ci] === ')') {
                  scanParenDepth++;
                  lineHasNonExcludedParen = true;
                }
                if (source[ci] === '(') {
                  scanParenDepth--;
                  lineHasNonExcludedParen = true;
                }
              }
              // If this line has balanced parens (net zero change) but scanParenDepth
              // is still elevated from lines below, and the line doesn't start with '(',
              // it's an independent statement (e.g. a function call) that shouldn't
              // bridge the backward scan to a type declaration above.
              // Only apply when the line actually has non-excluded parens; lines with
              // parens only inside comments/strings are part of the discriminant content
              if (scanParenDepth === depthBeforeLine && depthBeforeLine > 0 && lineHasNonExcludedParen && !/^\(/.test(prevLine)) {
                break;
              }
              if (/^(type|subtype)\b/.test(prevLine)) {
                // Check if 'protected' or 'task' precedes this type/subtype on a prior line
                // (e.g., "protected\ntype Foo\nis" should be a block, not a type decl)
                if (/^type\b/.test(prevLine)) {
                  let checkPos = prevStart - 1;
                  while (checkPos >= 0 && isAdaWhitespace(source[checkPos])) {
                    checkPos--;
                  }
                  if (checkPos >= 0) {
                    const checkEnd = checkPos + 1;
                    const checkLineStart = this.findLineStart(source, checkEnd);
                    const checkToken = this.stripExcludedRegions(source, checkLineStart, checkEnd, excludedRegions).toLowerCase().trimEnd();
                    if (/\b(?:protected|task)$/.test(checkToken)) {
                      scanPos = this.skipPreviousLineTerminator(source, prevStart - 1);
                      continue;
                    }
                  }
                }
                isTypeDecl = true;
                typeDeclStart = prevStart;
              } else {
                // Detect mid-line `; type` / `; subtype` declarations whose continuation
                // produces the `is` keyword on a later line. Also detect `is type` /
                // `is subtype` (procedure body opener immediately followed by a type
                // declaration), `declare type`, `private type`, and `record type`.
                // prevLine has been trimStart-ed; compute the original-source offset
                // by adding back the leading whitespace count.
                const midDeclMatch = prevLine.match(/(?:;|\bis\b|\bdeclare\b|\bprivate\b|\brecord\b)\s+(type|subtype)\b/);
                if (midDeclMatch && midDeclMatch.index !== undefined) {
                  const originalLine = source.slice(prevStart, scanPos + 1);
                  const leadingTrim = originalLine.length - originalLine.trimStart().length;
                  const declOffsetInTrimmed = midDeclMatch.index + midDeclMatch[0].length - midDeclMatch[1].length;
                  isTypeDecl = true;
                  typeDeclStart = prevStart + leadingTrim + declOffsetInTrimmed;
                }
              }
              // Stop scanning at lines that are not type declaration continuations
              // Continue if inside parenthesized discriminant (scanParenDepth > 0) or line starts with (
              // Also continue past plain identifier lines (e.g., type name on its own line)
              if (!isTypeDecl && scanParenDepth <= 0 && !/^\(/.test(prevLine)) {
                // Allow one extra line if this line is just an identifier (type name)
                if (/^[a-zA-Z_][a-zA-Z0-9_]*[ \t]*$/.test(prevLine)) {
                  scanPos = this.skipPreviousLineTerminator(source, prevStart - 1);
                  continue;
                }
                break;
              }
              scanPos = this.skipPreviousLineTerminator(source, prevStart - 1);
              if (isTypeDecl) break;
              continue;
            }
            // Move past line terminator to previous line
            scanPos = this.skipPreviousLineTerminator(source, prevStart - 1);
          }
          // Only skip if no ';' or new declaration keyword between type/subtype and this 'is'
          // Track parenthesis depth so semicolons inside discriminant parts are ignored
          if (isTypeDecl) {
            let hasSeparator = false;
            let parenDepth = 0;
            for (let si = typeDeclStart; si < startOffset; si++) {
              if (this.isInExcludedRegion(si, excludedRegions)) continue;
              if (source[si] === '(') parenDepth++;
              else if (source[si] === ')') parenDepth--;
              else if (parenDepth === 0) {
                if (source[si] === ';') {
                  hasSeparator = true;
                  break;
                }
                // Check for declaration keywords that start a new statement
                if (/[a-zA-Z]/i.test(source[si]) && (si === 0 || !/[a-zA-Z0-9_]/i.test(source[si - 1]))) {
                  const word = source.slice(si, si + 15).toLowerCase();
                  if (/^(procedure|function|package|task|protected|entry|begin|case|select|loop|for|while|declare|record|if|accept)\b/.test(word)) {
                    hasSeparator = true;
                    break;
                  }
                }
              }
            }
            if (!hasSeparator) {
              continue;
            }
          }
        }
        // Skip 'is' that is part of a non-body declaration (is separate/abstract/new/null/<>)
        // These 'is' keywords follow subprogram/task/entry/package keywords that were filtered out
        const afterIsPos = skipAdaWhitespaceAndComments(source, startOffset + keyword.length);
        if (
          isAdaWordAt(source, afterIsPos, 'separate') ||
          isAdaWordAt(source, afterIsPos, 'abstract') ||
          isAdaWordAt(source, afterIsPos, 'new') ||
          isAdaWordAt(source, afterIsPos, 'null')
        ) {
          continue;
        }
        if (afterIsPos < source.length && source[afterIsPos] === '<' && afterIsPos + 1 < source.length && source[afterIsPos + 1] === '>') {
          continue;
        }
        // Skip 'is' that starts an Ada 2012 expression function body: `is (expression);`
        // The corresponding function/procedure was already rejected as a block opener
        // by isValidSubprogramOpen, so this 'is' should not leak as an intermediate.
        if (afterIsPos < source.length && source[afterIsPos] === '(') {
          continue;
        }
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset: startOffset + keyword.length,
        line,
        column
      });
    }

    const { tokens: result } = mergeCompoundEndTokens(tokens, compoundEndPositions);

    // Filter out 'or else' and 'and then' short-circuit operators
    const filtered: Token[] = [];
    for (let i = 0; i < result.length; i++) {
      const token = result[i];
      const lowerValue = token.value.toLowerCase();

      // 'or else' short-circuit: remove both 'or' and 'else' tokens
      // In a select block, 'or' and 'else' can be separate intermediates with statements between them.
      // To distinguish: check if only whitespace/comments exist between 'or' and 'else' in source.
      if (lowerValue === 'else' && filtered.length > 0 && filtered[filtered.length - 1].value.toLowerCase() === 'or') {
        const orToken = filtered[filtered.length - 1];
        // In select blocks, 'or' is preceded by ';' (statement-level keyword, not short-circuit)
        let prevPos = orToken.startOffset - 1;
        while (prevPos >= 0 && isAdaWhitespace(source[prevPos])) {
          prevPos--;
        }
        while (prevPos >= 0 && this.isInExcludedRegion(prevPos, excludedRegions)) {
          const region = this.findExcludedRegionAt(prevPos, excludedRegions);
          if (region) {
            prevPos = region.start - 1;
            while (prevPos >= 0 && isAdaWhitespace(source[prevPos])) {
              prevPos--;
            }
          } else {
            prevPos--;
          }
        }
        // The `select` reserved keyword must occupy the six characters ending
        // at `prevPos` with Ada word boundaries on both sides. `isAdaWordAt`
        // is Unicode-aware (Ada LRM 2.3): a non-ASCII letter such as α
        // counts as an identifier character, so identifiers ending in
        // `select` (e.g. `αselect`) are not mistaken for the reserved word.
        const selectStart = prevPos - 5;
        const atSelectKeyword = prevPos >= 5 && isAdaWordAt(source, selectStart, 'select');
        if (prevPos >= 0 && (source[prevPos] === ';' || atSelectKeyword)) {
          // 'or' follows a statement or 'select' keyword (select block context), keep both as intermediates
        } else if (isOrElseShortCircuit(source, orToken.endOffset, token.startOffset, (pos) => this.isInExcludedRegion(pos, excludedRegions))) {
          filtered.pop();
          continue;
        }
      }

      // Boolean 'or' filter: a bare 'or' is only a select-block intermediate when it
      // appears at a select alternative boundary (preceded by ';' or by the `select`
      // keyword itself). Otherwise it is a boolean operator (e.g., `Z := A or B;`,
      // `when A or B =>`) and must not be tracked as an intermediate token.
      // The 'or else' short-circuit is handled by the dedicated branch above; skip
      // bare-'or' filtering when the next token is 'else'.
      if (lowerValue === 'or') {
        const nextToken = result[i + 1];
        const nextIsElse = nextToken !== undefined && nextToken.value.toLowerCase() === 'else';
        if (!nextIsElse) {
          let prevPos = token.startOffset - 1;
          while (prevPos >= 0 && isAdaWhitespace(source[prevPos])) {
            prevPos--;
          }
          while (prevPos >= 0 && this.isInExcludedRegion(prevPos, excludedRegions)) {
            const region = this.findExcludedRegionAt(prevPos, excludedRegions);
            if (region) {
              prevPos = region.start - 1;
              while (prevPos >= 0 && isAdaWhitespace(source[prevPos])) {
                prevPos--;
              }
            } else {
              prevPos--;
            }
          }
          // Unicode-aware boundary via `isAdaWordAt` (see matching note in
          // the `or else` branch above): identifiers ending in `select`
          // after a non-ASCII letter must not be confused with the
          // `select` reserved keyword.
          const selectStart = prevPos - 5;
          const atSelectKeyword = prevPos >= 5 && isAdaWordAt(source, selectStart, 'select');
          // A select alternative body may be incomplete (no trailing `;`) while
          // the source is being edited. In that case the `or` still delimits a
          // select alternative when it begins its own line and is not part of
          // a `when ... =>` guard or an assignment expression.
          const atAlternativeBoundary =
            (prevPos >= 0 && (source[prevPos] === ';' || atSelectKeyword)) ||
            this.isSelectAlternativeOrAtLineStart(source, token.startOffset, excludedRegions);
          if (!atAlternativeBoundary) {
            continue;
          }
        }
      }

      // 'and then' short-circuit: 'and' is not a keyword, so scan backward from 'then'
      // skipping whitespace and excluded regions (comments between 'and' and 'then').
      // Discard the 'then' token only when the preceding word is a standalone
      // 'and' keyword (proper word boundaries on both sides). An identifier that
      // merely *ends* with the letters 'and' (e.g. `Command`, `Operand`,
      // `Demand`) is not the short-circuit operator, so the trailing 'then' is
      // the genuine if/elsif-`then` and must be kept as an intermediate.
      if (lowerValue === 'then') {
        let j = token.startOffset - 1;
        // Skip whitespace, newlines, and excluded regions backward
        while (j >= 0) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            const region = this.findExcludedRegionAt(j, excludedRegions);
            if (region) {
              j = region.start - 1;
            } else {
              j--;
            }
            continue;
          }
          if (isAdaWhitespace(source[j])) {
            j--;
            continue;
          }
          break;
        }
        // The word ending at j is the short-circuit 'and' only when 'and'
        // occupies positions [j-2, j] with ASCII/Unicode word boundaries on
        // both sides. isAdaWordAt rejects `Test_and`/`1and` (left side is a
        // word character) so their trailing 'then' is not collapsed away.
        if (j >= 2 && isAdaWordAt(source, j - 2, 'and') && !this.isInExcludedRegion(j - 2, excludedRegions)) {
          continue;
        }
      }

      filtered.push(token);
    }

    // Filter out block_middle tokens inside parenthesized expressions
    // (e.g., Ada 2012 conditional expressions: (if A then B else C))
    const cb = this.validationCallbacks;
    return filtered.filter((token) => {
      if (token.type === 'block_middle') {
        return !isInsideParens(source, token.startOffset, excludedRegions, cb);
      }
      return true;
    });
  }

  // Returns true if a top-level `do` keyword (Ada body separator) appears
  // between `fromOffset` (exclusive) and `toOffset` (exclusive) in the most
  // recently parsed source. Used to distinguish:
  //   - `accept E when G do ... end E;` (entry-guard `when` before `do`)
  //   - `accept E do exit when X > 0; end E;` (modifier `when` after `do`)
  // Skips characters that fall inside excluded regions (comments / strings /
  // character literals) so a `do` token inside a comment is not honored.
  private hasDoBetween(fromOffset: number, toOffset: number): boolean {
    const source = this.currentSource;
    const excluded = this.currentExcludedRegions;
    const start = Math.max(0, fromOffset);
    const end = Math.min(source.length, toOffset);
    let i = start;
    while (i < end) {
      if (this.isInExcludedRegion(i, excluded)) {
        const region = this.findExcludedRegionAt(i, excluded);
        if (region) {
          i = region.end;
          continue;
        }
        i++;
        continue;
      }
      const ch = source[i];
      // Ada identifier characters: ASCII word chars or non-ASCII Unicode chars
      const isWordChar = (c: string) => /[a-zA-Z0-9_]/.test(c) || c.charCodeAt(0) > 127;
      if ((ch === 'd' || ch === 'D') && isAdaWordAt(source, i, 'do')) {
        // Confirm a clean ASCII word boundary on the left side as well.
        // isAdaWordAt already verifies left/right boundaries against
        // ASCII word chars and non-ASCII Unicode chars.
        return true;
      }
      // Skip past the current identifier so we don't match `do` inside
      // identifier substrings like `done` or `do_something`.
      if (isWordChar(ch)) {
        while (i < end && isWordChar(source[i])) i++;
        continue;
      }
      i++;
    }
    return false;
  }

  // Returns true when the `when` token at `whenStart` is the modifier of an
  // `exit when` statement (Ada LRM 5.7) rather than a select-alternative /
  // case-arm / entry guard. `exit` is a loop-control statement and is never
  // tokenized as a block keyword, so an `exit when X;` inside a select
  // alternative body would otherwise have its `when` misattributed to the
  // enclosing select as an intermediate. Scans backward skipping whitespace,
  // comments and excluded regions; if the immediately preceding word is
  // `exit`, the `when` is a loop-exit modifier and must be ignored.
  private isExitWhen(whenStart: number): boolean {
    const source = this.currentSource;
    const excluded = this.currentExcludedRegions;
    const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch) || ch.charCodeAt(0) > 127;
    let p = whenStart - 1;
    while (p >= 0) {
      if (this.isInExcludedRegion(p, excluded)) {
        const region = this.findExcludedRegionAt(p, excluded);
        p = region ? region.start - 1 : p - 1;
        continue;
      }
      if (isAdaWhitespace(source[p])) {
        p--;
        continue;
      }
      break;
    }
    if (p < 0 || !isWordChar(source[p])) return false;
    let wordStart = p;
    while (wordStart > 0 && isWordChar(source[wordStart - 1])) wordStart--;
    return source.slice(wordStart, p + 1).toLowerCase() === 'exit';
  }

  // Decides whether an `or` token that starts its own physical line delimits a
  // select alternative (true) rather than being a boolean operator (false).
  //
  // A select alternative `or` follows either a complete statement or the
  // `select` keyword. A boolean `or` instead continues an expression: inside a
  // `when ... =>` guard, or as the operator of an assignment / condition. The
  // single-line boolean forms (`when A or B =>`, `Z := A or B;`) are already
  // filtered out because such an `or` is not at the start of its line; this
  // helper only needs to reject the boolean forms whose expression was wrapped
  // so that `or` happens to begin a line.
  //
  // It scans backward from the `or`, skipping whitespace, comments and excluded
  // regions, looking for the nearest delimiter:
  //   - `when` (with no intervening `=>`) -> boolean operator in a guard
  //   - `:=`                              -> boolean operator on an assignment RHS
  //   - `;`, `=>`, `select`, any other reserved block keyword, or start of
  //     source                           -> select alternative boundary
  private isSelectAlternativeOrAtLineStart(source: string, orStart: number, excludedRegions: ExcludedRegion[]): boolean {
    // The `or` must be the first non-whitespace token on its physical line.
    // Ada LRM 2.2 line terminators (LF, CR, NEL U+0085, LS U+2028, PS U+2029)
    // break the scan; any other Ada whitespace (ASCII space/tab and the Zs
    // category, including NBSP U+00A0) is treated as indentation and skipped.
    for (let p = orStart - 1; p >= 0; p--) {
      const ch = source[p];
      const code = ch.charCodeAt(0);
      if (code === 0x000a || code === 0x000d || code === 0x0085 || code === 0x2028 || code === 0x2029) break;
      if (isAdaWhitespace(ch)) continue;
      return false;
    }
    const reservedBlockKeywords = new Set([...this.keywords.blockOpen, ...this.keywords.blockClose].map((k) => k.toLowerCase()));
    const isWordChar = (ch: string) => /[a-zA-Z0-9_]/.test(ch) || ch.charCodeAt(0) > 127;
    let p = orStart - 1;
    let scannedChars = 0;
    while (p >= 0) {
      // Stop once the scan has visited more characters than any real delimiter
      // could be away. A delimiter farther back than MAX_OR_BOUNDARY_SCAN_CHARS
      // cannot govern this `or`, so treat it as a select alternative boundary —
      // the same answer the scan gives when it reaches the start of source, and
      // the choice that adds no orphan tokens. Counting every iteration
      // (including skipped excluded-region characters) keeps the scan O(1) per
      // call.
      scannedChars++;
      if (scannedChars > MAX_OR_BOUNDARY_SCAN_CHARS) return true;
      if (this.isInExcludedRegion(p, excludedRegions)) {
        const region = this.findExcludedRegionAt(p, excludedRegions);
        p = region ? region.start - 1 : p - 1;
        continue;
      }
      const ch = source[p];
      if (isAdaWhitespace(ch)) {
        p--;
        continue;
      }
      // `;` and `=>` mark the end of the previous statement / guard arrow:
      // the `or` after them delimits a select alternative.
      if (ch === ';') return true;
      if (ch === '>' && p >= 1 && source[p - 1] === '=') return true;
      // `:=` means the `or` continues an assignment's right-hand side.
      if (ch === '=' && p >= 1 && source[p - 1] === ':') return false;
      // Identifiers / keywords: classify `when` (guard) vs. other reserved
      // block keywords (scope boundary) vs. ordinary identifiers (operands).
      if (isWordChar(ch)) {
        const wordEnd = p + 1;
        let wordStart = p;
        while (wordStart > 0 && isWordChar(source[wordStart - 1])) {
          wordStart--;
        }
        const word = source.slice(wordStart, wordEnd).toLowerCase();
        if (word === 'when') return false;
        if (reservedBlockKeywords.has(word)) return true;
        p = wordStart - 1;
        continue;
      }
      p--;
    }
    // Reached the start of source without crossing a guard or assignment.
    return true;
  }

  // Custom matching to handle compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    // Pre-compute the multiset of compound-end types over *all* tokens. Used
    // to detect when picking a deeper opener (via findLastOpenerByType) would
    // create a crossed pair with an intervening opener that has its own
    // compound end still ahead in the token stream.
    //
    // `remainingCompoundCounts` is consumed as the count of compound-end types
    // strictly *after* the token currently being processed: the main loop
    // decrements a token's own contribution as it reaches it (see the
    // block_close case), so the map always reflects tokens at index >
    // tokenIndex. A single forward-decrement keeps both the build and every
    // crossing check O(1) per token; an earlier suffix-array implementation
    // rebuilt a growing array per compound end, which was O(n^2) on flat
    // block lists.
    const remainingCompoundCounts = new Map<string, number>();
    for (const t of tokens) {
      if (t.type === 'block_close') {
        const m = t.value.toLowerCase().match(COMPOUND_END_CLOSE_PATTERN);
        if (m) {
          remainingCompoundCounts.set(m[1], (remainingCompoundCounts.get(m[1]) ?? 0) + 1);
        }
      }
    }
    const openerCompoundEndType = (openerKw: string): string | null => {
      const k = openerKw.toLowerCase();
      if (k === 'if') return 'if';
      if (k === 'case') return 'case';
      if (k === 'select') return 'select';
      if (k === 'record') return 'record';
      if (k === 'for' || k === 'while' || k === 'loop') return 'loop';
      if (
        k === 'procedure' ||
        k === 'function' ||
        k === 'package' ||
        k === 'task' ||
        k === 'protected' ||
        k === 'accept' ||
        k === 'entry' ||
        k === 'return'
      ) {
        return k;
      }
      return null;
    };

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            const middleKw = token.value.toLowerCase();
            // 'or' is only a valid intermediate for 'select' blocks
            if (middleKw === 'or') {
              if (topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'when') {
              // 'when' is valid for 'case', 'select', and 'entry' (guard)
              // directly: every `when` inside those constructs is a section
              // delimiter (case arms / select alternatives / entry guard).
              //
              // For 'accept', 'return' (Ada 2012 extended-return), and 'begin'
              // bodies, `when` is only valid as part of an exception handler
              // *inside* the body. Outside / before the body separator (`do`
              // for accept and extended-return, the opening of the body for
              // begin), an entry-guard `when` is also valid. Distinguish the
              // two:
              //   - `when` before the body separator → entry guard intermediate
              //   - `when` after the body separator → only valid following an
              //     `exception` intermediate (otherwise it is an `exit when`
              //     or similar modifier and must be ignored)
              if (topOpener === 'case' || topOpener === 'select' || topOpener === 'entry') {
                // A genuine guard `when` heads a case arm / select alternative /
                // entry guard. An `exit when X;` inside an alternative body is a
                // loop-exit modifier (LRM 5.7), not a guard, so skip it.
                if (!this.isExitWhen(token.startOffset)) {
                  stack[stack.length - 1].intermediates.push(token);
                }
              } else if (topOpener === 'accept' || topOpener === 'return' || topOpener === 'begin') {
                const intermediates = stack[stack.length - 1].intermediates;
                const hasException = intermediates.some((t) => t.value.toLowerCase() === 'exception');
                let acceptAsIntermediate = hasException;
                if (!acceptAsIntermediate && (topOpener === 'accept' || topOpener === 'return')) {
                  // Body separator for accept / extended-return is the `do`
                  // keyword. Check if `do` appears between the opener and
                  // this `when` token; if not, treat as entry-guard / before-body
                  // intermediate.
                  acceptAsIntermediate = !this.hasDoBetween(stack[stack.length - 1].token.startOffset, token.startOffset);
                }
                if (acceptAsIntermediate) {
                  stack[stack.length - 1].intermediates.push(token);
                }
              }
            } else if (middleKw === 'then') {
              // 'then' is valid for 'if' and 'select' (select...then abort)
              if (topOpener === 'if' || topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'elsif') {
              // Ada LRM 5.3: 'elsif' is only valid inside if-statements.
              // A stray 'elsif' inside case/select/loop/etc. is invalid
              // syntax; drop it (best-effort: leave orphans uncolored).
              if (topOpener === 'if') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'else') {
              // Ada LRM 5.3 / 9.7: 'else' is valid for if-statements and
              // for select (terminate/else alternative). It is not a case
              // arm (LRM 5.4) or loop intermediate, so reject those here.
              if (topOpener === 'if' || topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'is') {
              // Whitelist of openers that take `is` as part of their syntax:
              //   - procedure / function:  `procedure P is`, `function F return T is`
              //   - package:               `package P is`
              //   - task / protected body: `task body B is`, `protected body B is`
              //   - case:                  `case X is`
              //   - entry body:            `entry E ... is`
              // Other openers (loop / for / while / declare / begin / if /
              // select / record / return / accept) never have `is` as part
              // of their construct. The tokenize-time filter drops most stray
              // `is` tokens (renaming clauses, type declarations, etc.) but
              // any survivor must not be attached to an unrelated enclosing
              // opener (e.g., a `loop\n  X : Integer is 5;\nend loop;` edit
              // would otherwise list `is` as the loop's intermediate).
              if (
                topOpener === 'procedure' ||
                topOpener === 'function' ||
                topOpener === 'package' ||
                topOpener === 'task' ||
                topOpener === 'protected' ||
                topOpener === 'case' ||
                topOpener === 'entry'
              ) {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'exception') {
              // Ada LRM 11.2: an exception handler section can only terminate a
              // handled_sequence_of_statements, i.e. the body of a begin block,
              // an `accept ... do` body, or an extended `return ... do` body.
              // if / loop / for / while / case / select / record bodies cannot
              // carry a handler, so an `exception` keyword observed while one of
              // those is the open block is not a handler section and must not be
              // recorded as that block's intermediate. In valid Ada the stack
              // top when a real handler section appears is always one of these
              // openers; keeping the whitelist tight avoids painting a stray
              // `exception` declaration / raise target as a handler.
              if (topOpener === 'begin' || topOpener === 'accept' || topOpener === 'return') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();

          // Check if it's a compound end (allow whitespace, newlines, and Ada
          // line comments between 'end' and the type keyword)
          const compoundMatch = closeValue.match(COMPOUND_END_CLOSE_PATTERN);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            let matchIndex = -1;

            // This compound end was counted in remainingCompoundCounts; remove
            // its own contribution so the map reflects only tokens *after* it
            // (index > tokenIndex) for the crossing check below.
            remainingCompoundCounts.set(endType, (remainingCompoundCounts.get(endType) ?? 0) - 1);

            // Special case: 'end loop' can close 'for', 'while', or 'loop'
            if (endType === 'loop') {
              matchIndex = findLastOpenerForLoop(stack);
            } else {
              matchIndex = findLastOpenerByType(stack, endType, true);
            }

            // No forced fallback to last opener: best-effort parsing prefers
            // leaving compound ends unpaired (no color) over wrong color when
            // no matching opener of the requested type exists. Per CLAUDE.md
            // best-effort parsing principle #3: prefer no color over wrong
            // color (anchor-set principle from VS Code Bracket Pair Colorization).

            // Reject the match when pairing with this opener would create a
            // crossed pair: i.e., another opener between matchIndex and the
            // top of the stack has its own compound-end candidate still
            // pending later in the token stream. If an intervening opener's
            // compound close (e.g., `end loop` for a `for` opener above
            // matchIndex) exists after this token, consuming the deeper
            // matchIndex first would force that future close to cross the
            // pair we are about to build.
            //
            // `begin` is excluded from the crossing check: it is closed by a
            // simple `end` or merged into the surrounding BEGIN_CONTEXT
            // opener below — never produces a compound-end pair on its own —
            // so a lone `begin` above the matched opener does not constitute
            // a crossing (it remains an orphan or merges into matchIndex via
            // the BEGIN_CONTEXT branch below).
            //
            // `declare` is excluded for the same reason: it pairs with a
            // simple `end` and has no compound-end form.
            if (matchIndex >= 0 && matchIndex < stack.length - 1) {
              for (let s = matchIndex + 1; s < stack.length; s++) {
                const above = stack[s].token.value.toLowerCase();
                if (above === 'begin' || above === 'declare') continue;
                const ty = openerCompoundEndType(above);
                if (ty !== null && (remainingCompoundCounts.get(ty) ?? 0) > 0) {
                  matchIndex = -1;
                  break;
                }
              }
            }

            if (matchIndex >= 0) {
              // Check if 'begin' is on the stack above the matched opener
              const beginIndex = matchIndex + 1;
              if (
                beginIndex < stack.length &&
                stack[beginIndex].token.value.toLowerCase() === 'begin' &&
                BEGIN_CONTEXT_KEYWORDS.includes(stack[matchIndex].token.value.toLowerCase())
              ) {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(matchIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                const openBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          } else {
            // Simple 'end' or 'end;' - always closes the top of the stack
            if (stack.length === 0) break;

            const top = stack[stack.length - 1];
            const topValue = top.token.value.toLowerCase();

            if (topValue === 'begin') {
              // Check for context keyword immediately before begin
              const beginIndex = stack.length - 1;
              const contextIndex = beginIndex - 1;

              if (contextIndex >= 0 && BEGIN_CONTEXT_KEYWORDS.includes(stack[contextIndex].token.value.toLowerCase())) {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(contextIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(contextIndex, 1)[0];

                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                // No context keyword, just close begin
                const beginBlock = stack.pop();
                if (beginBlock) {
                  pairs.push({
                    openKeyword: beginBlock.token,
                    closeKeyword: token,
                    intermediates: beginBlock.intermediates,
                    nestLevel: stack.length
                  });
                }
              }
            } else {
              // Top is not begin, just close it
              const openBlock = stack.pop();
              if (openBlock) {
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          }
          break;
        }
      }
    }

    return pairs;
  }
}
