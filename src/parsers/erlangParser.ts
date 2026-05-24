// Erlang block parser: handles single-line comments, strings, atoms, and spec types

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import type { ErlangHelperCallbacks } from './erlangHelpers';
import { hasTopLevelCommaBetween, isCatchExpressionPrefix } from './erlangHelpers';

// OTP 27 sigil paired delimiters: opening character maps to its closing character
const PAIRED_SIGIL_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Block-opening keywords used to bound backward scans for intermediate keyword validation
const BLOCK_OPENER_KEYWORDS = new Set(['begin', 'if', 'case', 'receive', 'try', 'fun', 'maybe']);

// Patterns recognizing fun-reference forms (fun Mod:Func/Arity, fun Func/Arity,
// fun 'quoted-atom'/Arity). Shared by isValidBlockOpen and hasUnclosedOpenerInMapScope so
// that a fun reference is consistently treated as NOT a block opener.
const FUN_REF_ATOM_OR_IDENT = "(?:\\??[a-zA-Z_\\p{L}][a-zA-Z0-9_\\p{L}\\p{N}]*|\\??'(?:[^'\\\\\\n\\r]|\\\\.)*')";
const FUN_REF_ARITY_PATTERN = '(?:\\d+|[A-Z\\p{Lu}][a-zA-Z0-9_\\p{L}\\p{N}]*|\\?[a-zA-Z_\\p{L}][a-zA-Z0-9_\\p{L}\\p{N}]*)';
const FUN_REF_WITH_MODULE_PATTERN = new RegExp(
  `^\\s+${FUN_REF_ATOM_OR_IDENT}\\s*:\\s*${FUN_REF_ATOM_OR_IDENT}\\s*/\\s*${FUN_REF_ARITY_PATTERN}`,
  'u'
);
const FUN_REF_NO_MODULE_PATTERN = new RegExp(`^\\s+\\??[a-zA-Z_\\p{L}][a-zA-Z0-9_\\p{L}\\p{N}]*\\s*/\\s*${FUN_REF_ARITY_PATTERN}`, 'u');
const FUN_REF_QUOTED_PATTERN = new RegExp(`^\\s+\\??'(?:[^'\\\\\\n\\r]|\\\\.)*'\\s*/\\s*${FUN_REF_ARITY_PATTERN}`, 'u');

// Pre-scanned span of a module attribute: -name(...).
interface AttributeSpan {
  // Start of the leading '-' character at line start
  dashStart: number;
  // Position of the opening '(' that immediately follows the attribute name
  openParen: number;
  // Position immediately after the matching closing ')' (exclusive)
  endParen: number;
  // Attribute name in lower case, e.g. 'define' or 'record'
  name: string;
  // Position of the body-introducing top-level ',' inside (...) or -1 if absent
  bodyCommaPos: number;
}

// Cached analysis of a -define macro body for bare-reserved-word lookups.
// The body is scanned once per parse and results are reused for every keyword query.
interface DefineBodyAnalysis {
  // Offsets of keywords that participate in a matched open/close pair (real blocks).
  realOffsets: Set<number>;
  // Offsets of openers that remained unclosed on the stack (still real openers).
  unclosedOpeners: Set<number>;
}

// Pre-scanned span of a -spec/-type/-callback/-opaque declaration without a `(`,
// such as `-spec foo() -> ok.` (terminated by a top-level period).
interface SpecLineSpan {
  // Start of the leading '-' character
  dashStart: number;
  // Start of the keyword (spec/type/callback/opaque)
  keywordStart: number;
  // Position immediately after the keyword
  keywordEnd: number;
  // Position of the terminating '.' or source.length if not terminated
  endPeriod: number;
}

export class ErlangBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'if', 'case', 'receive', 'try', 'fun', 'maybe'],
    blockClose: ['end'],
    blockMiddle: ['of', 'after', 'catch', 'else']
  };

  // Per-parse caches built at the start of tokenize(). Cleared after parse.
  // Sorted by dashStart; binary search yields O(log n) per-token lookups.
  private attributeSpans: AttributeSpan[] = [];
  private specLineSpans: SpecLineSpan[] = [];
  // Lazily-populated per-parse cache of -define body analyses, keyed by AttributeSpan reference.
  // Built on first lookup and reused for every subsequent query against the same -define body.
  private defineBodyAnalyses: Map<AttributeSpan, DefineBodyAnalysis> = new Map();

  private get erlangHelperCallbacks(): ErlangHelperCallbacks {
    return {
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Validates block open: 'fun' references and spec context are not blocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords followed by => or := (map key/update: #{begin => 1, end := 2})
    // Allow one line break (possibly with trailing comment) plus zero or more comment-only lines
    // Blank lines without comments do NOT continue the map key detection
    const afterKeyword = source.slice(position + keyword.length);
    if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterKeyword)) {
      return false;
    }

    // Block keywords (begin, case, if, receive, try, maybe) inside -spec/-type/-callback/-opaque
    // declarations are reserved-word usage in type expressions, not block openers.
    // Unlike `fun`, these keywords have no type-variant syntax and are always rejected
    // in spec context.
    if (keyword !== 'fun') {
      if (this.isInSpecContext(source, position, excludedRegions)) {
        return false;
      }
      return true;
    }

    // 'fun' in -spec/-type/-callback/-opaque declarations is a type, not a block
    // Note: -record is excluded because fun() inside records defines real anonymous functions
    if (this.isOnSpecAttributeLine(source, position, excludedRegions)) {
      return false;
    }

    // Check if fun is followed by an identifier and '/' (function reference).
    // fun Module:Function/Arity / fun Function/Arity / fun 'quoted-atom'/Arity etc.
    // Module/Function may be a macro (?MODULE:handler/N, ?MY_FUNC/N) and arity may be a
    // literal (\d+), a bound variable (OTP 21+) or a macro (?MACRO).
    if (this.isFunReferenceAt(source, position)) {
      return false;
    }

    // fun in -spec/-type/-callback/-opaque declarations is always a type expression,
    // never a real anonymous-function opener. Evaluated independently of the parens-follow
    // pattern so multi-line spec contexts (with blank lines or comments between `fun` and
    // its `(...)` arguments) are still rejected.
    if (this.isInSpecContext(source, position, excludedRegions)) {
      return false;
    }

    // fun() in type annotation context (after ::)
    // Handles: handler :: fun((atom()) -> ok) in -record declarations
    const afterFun = source.slice(position + 3);
    if (/^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)?\(/.test(afterFun)) {
      let j = position - 1;
      while (j >= 0) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j--;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
          j--;
          continue;
        }
        break;
      }
      if (j > 0 && source[j] === ':' && source[j - 1] === ':' && !this.isInExcludedRegion(j - 1, excludedRegions)) {
        return false;
      }
      // Extended scan: look for :: through type expression chars (union |, tuples {}, etc.)
      if (j >= 0 && source[j] !== '=' && source[j] !== ';' && source[j] !== '.') {
        let k = j;
        let depth = 0;
        while (k >= 0) {
          if (this.isInExcludedRegion(k, excludedRegions)) {
            k--;
            continue;
          }
          const ch = source[k];
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            k--;
            continue;
          }
          // Binary close >>: in backward scan, this opens a binary scope (we are exiting it as we move backward)
          if (ch === '>' && k > 0 && source[k - 1] === '>' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            // Avoid confusing with -> (clause arrow): -> is single '>' preceded by '-', not '>>'
            depth++;
            k -= 2;
            continue;
          }
          // Binary open <<: in backward scan, this closes a binary scope
          if (ch === '<' && k > 0 && source[k - 1] === '<' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            depth = Math.max(0, depth - 1);
            k -= 2;
            continue;
          }
          if (ch === ')' || ch === '}' || ch === ']') {
            depth++;
            k--;
            continue;
          }
          if (ch === '(' || ch === '{' || ch === '[') {
            depth = Math.max(0, depth - 1);
            k--;
            continue;
          }
          if (depth > 0) {
            k--;
            continue;
          }
          if (k > 0 && ch === ':' && source[k - 1] === ':' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            if (!this.hasTopLevelCommaBetween(source, k + 1, position, excludedRegions)) {
              return false;
            }
            break;
          }
          // Skip => (map arrow) inside type expressions
          if (ch === '=' && k + 1 < source.length && source[k + 1] === '>') {
            k--;
            continue;
          }
          // Skip multi-char comparison operators that contain '=': =:=, =/=, ==, =<, >=, /=
          // and the := (map update) operator. These appear in record/type expressions like
          // `A =:= B | fun()` and must not stop the scan.
          // Check the longer 3-char operators first to avoid matching their 2-char tails.
          if (
            ch === '=' &&
            k > 1 &&
            source[k - 1] === ':' &&
            source[k - 2] === '=' &&
            !this.isInExcludedRegion(k - 1, excludedRegions) &&
            !this.isInExcludedRegion(k - 2, excludedRegions)
          ) {
            // =:= (exact equal): skip past all three characters
            k -= 3;
            continue;
          }
          if (
            ch === '=' &&
            k > 1 &&
            source[k - 1] === '/' &&
            source[k - 2] === '=' &&
            !this.isInExcludedRegion(k - 1, excludedRegions) &&
            !this.isInExcludedRegion(k - 2, excludedRegions)
          ) {
            // =/= (exact not equal): skip past all three characters
            k -= 3;
            continue;
          }
          if (ch === '=' && k > 0 && source[k - 1] === ':' && (k < 2 || source[k - 2] !== ':') && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            // := (map update): skip past both characters
            k -= 2;
            continue;
          }
          if (ch === '=' && k > 0 && source[k - 1] === '=' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            // == (equal): skip past both characters
            k -= 2;
            continue;
          }
          if (ch === '=' && k + 1 < source.length && source[k + 1] === '<') {
            // =< (less than or equal): skip the '=' (we will encounter the '<' next iteration)
            k--;
            continue;
          }
          if (ch === '=' && k > 0 && source[k - 1] === '>' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            // >= (greater than or equal): ensure preceding '>' is not part of '->' or '>>' arrow.
            // '->' would have '-' at k-2 which we already step over; '>>' is handled by the binary
            // check earlier in the loop, so reaching here with '>' at k-1 implies a true '>=' op.
            k -= 2;
            continue;
          }
          if (ch === '=' && k > 0 && source[k - 1] === '/' && !this.isInExcludedRegion(k - 1, excludedRegions)) {
            // /= (not equal): skip past both characters
            k -= 2;
            continue;
          }
          // Skip .. (range operator) and decimal points in float literals
          if (ch === '.' && ((k + 1 < source.length && source[k + 1] === '.') || (k > 0 && source[k - 1] === '.'))) {
            k--;
            continue;
          }
          if (ch === '.' && k > 0 && k + 1 < source.length && /[0-9]/.test(source[k - 1]) && /[0-9]/.test(source[k + 1])) {
            k--;
            continue;
          }
          if (ch === '=' || ch === ';' || ch === '.') break;
          k--;
        }
      }
    }

    return true;
  }

  // Returns true if 'keyword' on the same source line is preceded by a -spec/-type/-callback/-opaque
  // attribute (no declaration-ending period in between). Used to reject single-line spec usage like:
  //   -spec foo() -> begin atom() end.
  //   -type t() :: case Y of 1 -> err end.
  private isOnSpecAttributeLine(source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    const span = this.findEnclosingSpecSpan(position);
    if (!span) {
      return false;
    }
    const lineStart = Math.max(source.lastIndexOf('\n', position), source.lastIndexOf('\r', position)) + 1;
    return span.dashStart >= lineStart;
  }

  // Returns true if position is inside a -spec/-type/-callback/-opaque declaration that has not
  // yet been closed by a declaration-ending period. Uses pre-computed specLineSpans for O(log n) lookup.
  private isInSpecContext(_source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return this.findEnclosingSpecSpan(position) !== null;
  }

  // Binary-search for the spec span enclosing `position` (keywordEnd <= position < endPeriod).
  // Returns null if `position` is not inside any spec declaration.
  private findEnclosingSpecSpan(position: number): SpecLineSpan | null {
    const spans = this.specLineSpans;
    let left = 0;
    let right = spans.length - 1;
    let candidate: SpecLineSpan | null = null;
    while (left <= right) {
      const mid = (left + right) >> 1;
      const span = spans[mid];
      if (span.keywordStart <= position) {
        candidate = span;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (!candidate) return null;
    if (position >= candidate.endPeriod) return null;
    return candidate;
  }

  // Returns the position where the -spec/-type/-callback/-opaque declaration ends.
  // Preferred terminator is a top-level period `.` (skipping range operators `..` and
  // float decimal points). To prevent an unterminated declaration from absorbing the
  // rest of the file, the scan also stops at best-effort boundary signals: a line that
  // begins with another attribute (`\n-name`) at column 0, or a function head
  // (`\n[a-z_][a-zA-Z0-9_]*\s*\(`) at column 0. Whichever signal appears first wins.
  // A bare blank line is NOT a boundary: a legitimate -spec may span multiple lines
  // with blank lines between its type-expression parts.
  // Range operators (`..`), float decimal points, and signals inside excluded regions
  // are ignored.
  private findDeclarationEndingPeriod(source: string, start: number, excludedRegions: ExcludedRegion[]): number {
    for (let j = start; j < source.length; j++) {
      // Period: declaration terminator
      if (source[j] === '.' && !this.isInExcludedRegion(j, excludedRegions)) {
        if (j + 1 < source.length && source[j + 1] === '.') {
          j++;
          continue;
        }
        if (j > 0 && source[j - 1] === '.') {
          continue;
        }
        if (j > 0 && j + 1 < source.length && /[0-9]/.test(source[j - 1]) && /[0-9]/.test(source[j + 1])) {
          continue;
        }
        return j;
      }
      // Boundary detection: a line break at the top level (not inside a string/comment)
      // followed by a column-0 attribute or function head terminates the declaration when
      // no period has been seen yet.
      if (this.isLineBreak(source, j) && !this.isInExcludedRegion(j, excludedRegions)) {
        const next = this.skipLineBreak(source, j);
        // Next attribute line: '-' followed by identifier at column 0.
        if (next < source.length && source[next] === '-') {
          const id = next + 1;
          if (id < source.length && /[a-zA-Z_]/.test(source[id])) {
            return j;
          }
        }
        // Next function head: identifier followed by '(' at column 0.
        if (next < source.length && /[a-z_]/.test(source[next])) {
          let m = next + 1;
          while (m < source.length && /[a-zA-Z0-9_]/.test(source[m])) {
            m++;
          }
          while (m < source.length && (source[m] === ' ' || source[m] === '\t')) {
            m++;
          }
          if (m < source.length && source[m] === '(') {
            return j;
          }
        }
      }
    }
    return source.length;
  }

  // Returns true if `source[pos]` starts a line break (LF, CR, or CRLF).
  private isLineBreak(source: string, pos: number): boolean {
    return source[pos] === '\n' || source[pos] === '\r';
  }

  // Returns the position immediately after the line break starting at `pos`.
  // CRLF counts as a single line break (2 chars), CR-only or LF-only as 1 char.
  private skipLineBreak(source: string, pos: number): number {
    if (source[pos] === '\r' && pos + 1 < source.length && source[pos + 1] === '\n') {
      return pos + 2;
    }
    return pos + 1;
  }

  // Pre-scans source for module attribute spans -name(...) at line start. Each span
  // tracks the matching closing ')' and the position of the body-introducing top-level ','.
  // Sorted by dashStart for binary search.
  private buildAttributeSpans(source: string, excludedRegions: ExcludedRegion[]): AttributeSpan[] {
    const spans: AttributeSpan[] = [];
    // Match -name( at line start; capture name and opening paren positions.
    // Tolerates leading whitespace, whitespace between '-' and name, and between name and '('.
    // Erlang allows Unicode-identifier characters in attribute names, so the pattern matches
    // \p{L} and \p{N} in addition to ASCII letters/digits/underscore.
    const pattern = /(^|\r\n|\r|\n)([ \t]*)-[ \t]*([a-zA-Z_\p{L}][a-zA-Z0-9_\p{L}\p{N}]*)[ \t]*\(/gu;
    for (const match of source.matchAll(pattern)) {
      const dashStart = match.index + match[1].length + match[2].length;
      if (this.isInExcludedRegion(dashStart, excludedRegions)) continue;
      const openParen = match.index + match[0].length - 1;
      const name = match[3].toLowerCase();
      // Walk forward to the matching close paren, tracking nested brackets and excluded regions
      let depth = 1;
      let bodyCommaPos = -1;
      let i = openParen + 1;
      while (i < source.length) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
        const ch = source[i];
        if (ch === '(' || ch === '[' || ch === '{') {
          depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
          depth--;
          if (depth === 0) {
            // Closing paren that matches the attribute's open paren
            spans.push({ dashStart, openParen, endParen: i + 1, name, bodyCommaPos });
            break;
          }
        } else if (ch === ',' && depth === 1 && bodyCommaPos === -1) {
          bodyCommaPos = i;
        }
        i++;
      }
      if (i >= source.length) {
        // Unterminated attribute: treat as extending to end of source
        spans.push({ dashStart, openParen, endParen: source.length, name, bodyCommaPos });
      }
    }
    return spans;
  }

  // Pre-scans source for -spec/-type/-callback/-opaque declarations at line start.
  // Each span tracks the position of the terminating '.' (or source.length if unterminated).
  // Sorted by keywordStart for binary search.
  private buildSpecLineSpans(source: string, excludedRegions: ExcludedRegion[]): SpecLineSpan[] {
    const spans: SpecLineSpan[] = [];
    const pattern = /(^|\r\n|\r|\n)([ \t]*)-[ \t]*(spec|type|callback|opaque)\b/g;
    for (const match of source.matchAll(pattern)) {
      const dashStart = match.index + match[1].length + match[2].length;
      if (this.isInExcludedRegion(dashStart, excludedRegions)) continue;
      const keywordStart = match.index + match[0].length - match[3].length;
      const keywordEnd = keywordStart + match[3].length;
      // Reject if the next character is a Unicode identifier-continuation character.
      // E.g. -typeα, -callbackα should be treated as user attributes, not -type/-callback.
      // JavaScript \b only handles ASCII word boundaries so we must check explicitly here.
      if (keywordEnd < source.length) {
        const cp = source.codePointAt(keywordEnd);
        if (cp !== undefined && /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(String.fromCodePoint(cp))) {
          continue;
        }
      }
      const endPeriod = this.findDeclarationEndingPeriod(source, keywordEnd, excludedRegions);
      spans.push({ dashStart, keywordStart, keywordEnd, endPeriod });
    }
    return spans;
  }

  // Filter out keywords used as map keys (followed by =>),
  // record field access (preceded by .), and preprocessor directives (preceded by -)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Pre-compute attribute spans and spec line spans once per parse so
    // isInSpecContext / isInsideModuleAttributeArgs can use O(log n) binary
    // search instead of O(n) backward scans per token. This must run before
    // super.tokenize() because super.tokenize() invokes isValidBlockOpen()
    // (which calls isInSpecContext) per token.
    this.attributeSpans = this.buildAttributeSpans(source, excludedRegions);
    this.specLineSpans = this.buildSpecLineSpans(source, excludedRegions);
    this.defineBodyAnalyses = new Map();

    const tokens = super.tokenize(source, excludedRegions);
    const result = tokens.filter((token) => {
      const afterToken = source.slice(token.endOffset);
      // Allow at most one line break to handle multi-line map expressions
      // Also skip trailing comments (% ...) before line break
      // Filter keywords used as map keys (followed by => or :=)
      // For block_close (end), only filter when it's a bare map key (directly after #{)
      if (token.type === 'block_close') {
        if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterToken)) {
          // Check if 'end' is a map key (preceded by #{ or by comma/whitespace inside a map)
          // Skip whitespace, newlines, and excluded regions (comments) backward
          let k = token.startOffset - 1;
          while (k >= 0) {
            if (source[k] === ' ' || source[k] === '\t' || source[k] === '\n' || source[k] === '\r') {
              k--;
              continue;
            }
            const region = this.findExcludedRegionAt(k, excludedRegions);
            if (region) {
              k = region.start - 1;
              continue;
            }
            break;
          }
          if (k >= 0 && source[k] === '{' && k > 0 && source[k - 1] === '#') {
            return false;
          }
          // Also filter 'end' preceded by comma (non-first map key), but only when it is
          // not actually closing a block. An 'end' that closes an unclosed opener earlier
          // in the same #{...} scope (e.g. #{begin a, end => v}) is a real block close.
          if (k >= 0 && source[k] === ',') {
            if (!this.hasUnclosedOpenerInMapScope(source, token.startOffset, excludedRegions)) {
              return false;
            }
          }
        }
      } else if (/^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(afterToken)) {
        return false;
      }
      // Reject keywords preceded by '.' (record field access like Rec#state.end)
      // But allow '..' range operator (Erlang/OTP 26+)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        if (token.startOffset < 2 || source[token.startOffset - 2] !== '.') {
          return false;
        }
      }
      // Reject keywords preceded by '?' (macro invocations like ?begin, ?end)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '?') {
        return false;
      }
      // Reject keywords preceded by '#' (record names like #begin, #end)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '#') {
        return false;
      }
      // Reject keywords preceded by '-' at line start (preprocessor directives like -if, -else)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '-') {
        let j = token.startOffset - 2;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j < 0 || source[j] === '\n' || source[j] === '\r') {
          return false;
        }
      }
      // Reject keywords inside module attribute arguments: -define(...), -module(...), etc.
      if (this.isInsideModuleAttributeArgs(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Reject block_close/block_middle inside -spec/-type/-callback/-opaque declarations.
      // These keywords are reserved-word usage in type expressions, not real block delimiters.
      // block_open is already filtered by isValidBlockOpen() (which calls isInSpecContext).
      // Without this filter, a spec-internal `end` could be paired with an outer `begin`, and
      // spec-internal `of`/`after`/`else` could be registered as intermediates of the enclosing
      // block.
      if (token.type === 'block_close' || token.type === 'block_middle') {
        if (this.isInSpecContext(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      // Reject 'catch' expression prefix (preceded by =, (, [, {, ,, !, operator)
      if (token.value === 'catch' && token.type === 'block_middle') {
        if (this.isCatchExpressionPrefix(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      // Reject 'of'/'after'/'else' that appear inside an unclosed (), [], or {} scope
      // (record field name, function argument). Such occurrences are reserved-word usage,
      // not clause separators, and must not be registered as block intermediates.
      // 'catch' is excluded here because it has its own expression-prefix handling above.
      if (token.type === 'block_middle' && (token.value === 'of' || token.value === 'after' || token.value === 'else')) {
        if (this.isIntermediateInsideBrackets(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      return true;
    });

    // Release per-parse caches so they don't leak across calls or hold large
    // source references in memory.
    this.attributeSpans = [];
    this.specLineSpans = [];
    return result;
  }

  private isCatchExpressionPrefix(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isCatchExpressionPrefix(source, position, excludedRegions, this.erlangHelperCallbacks);
  }

  // Returns true if `fun` at `position` (where source[position..position+3] === 'fun') is a
  // function-reference form (fun Mod:Func/N, fun Func/N, fun 'quoted'/N) rather than a real
  // anonymous-function opener. Shared between isValidBlockOpen and hasUnclosedOpenerInMapScope.
  private isFunReferenceAt(source: string, position: number): boolean {
    const afterFun = source.slice(position + 3);
    return FUN_REF_WITH_MODULE_PATTERN.test(afterFun) || FUN_REF_NO_MODULE_PATTERN.test(afterFun) || FUN_REF_QUOTED_PATTERN.test(afterFun);
  }

  // Returns true if there is an unclosed block opener between the enclosing #{ and the
  // 'end' keyword at `endOffset`, meaning that 'end' closes a block rather than acting as
  // a map key. Locates the enclosing #{ by a backward brace-depth scan, then scans forward
  // counting real block openers (not map keys) against intervening block-closing 'end's.
  private hasUnclosedOpenerInMapScope(source: string, endOffset: number, excludedRegions: ExcludedRegion[]): boolean {
    // Backward scan: find the enclosing #{ start
    let braceDepth = 0;
    let mapStart = -1;
    for (let i = endOffset - 1; i >= 0; i--) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start;
        continue;
      }
      const ch = source[i];
      if (ch === '}') {
        braceDepth++;
        continue;
      }
      if (ch === '{') {
        if (braceDepth === 0) {
          if (i > 0 && source[i - 1] === '#') {
            mapStart = i + 1;
          }
          break;
        }
        braceDepth--;
      }
    }
    if (mapStart < 0) {
      return false;
    }
    // Forward scan from #{ to the 'end' token: count real openers vs block-closing 'end's
    // within the immediate map scope only. Nested '{' (including inner maps and tuples)
    // bumps nestedBraceDepth so that openers/closers found inside the nested scope are
    // excluded from this map's count: those keywords belong to the inner scope, not the
    // outer map.
    let depth = 0;
    let nestedBraceDepth = 0;
    let i = mapStart;
    while (i < endOffset) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      if (ch === '{') {
        nestedBraceDepth++;
        i++;
        continue;
      }
      if (ch === '}') {
        if (nestedBraceDepth > 0) {
          nestedBraceDepth--;
        }
        i++;
        continue;
      }
      if (/[a-z]/i.test(ch) && (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1]))) {
        let wordEnd = i;
        while (wordEnd < source.length && /[a-zA-Z0-9_]/.test(source[wordEnd])) {
          wordEnd++;
        }
        const word = source.slice(i, wordEnd);
        if (nestedBraceDepth === 0) {
          if (BLOCK_OPENER_KEYWORDS.has(word) && !this.isMapKeyKeyword(source, wordEnd)) {
            // `fun` may be a fun-reference (fun Mod:Func/N, fun Func/N, fun 'q'/N) which is
            // NOT a block opener. Match the same logic as isValidBlockOpen so that a map like
            // #{fun foo/1 => 1, end => 2} does not phantom-depth and incorrectly treat the
            // map-key `end` as a real block close.
            if (word !== 'fun' || !this.isFunReferenceAt(source, i)) {
              depth++;
            }
          } else if (word === 'end' && !this.isMapKeyKeyword(source, wordEnd)) {
            depth = Math.max(0, depth - 1);
          }
        }
        i = wordEnd;
        continue;
      }
      i++;
    }
    return depth > 0;
  }

  // Returns true if the source immediately after `pos` (the position right after a keyword)
  // is a map key/update arrow (=> or :=), allowing surrounding whitespace and comments.
  private isMapKeyKeyword(source: string, pos: number): boolean {
    return /^[ \t]*(?:(?:%[^\n\r]*)?(?:\r\n|\r|\n)[ \t]*(?:%[^\n\r]*(?:\r\n|\r|\n)[ \t]*)*)?(?:=>|:=)/.test(source.slice(pos));
  }

  // Returns true if the keyword at `position` sits inside an unclosed (), [], or {} scope
  // before reaching its enclosing block opener. Such keywords (record field names,
  // function-call arguments) are reserved-word usage, not real block intermediates.
  // Backward scan: closing brackets increase depth; an opening bracket reaching depth 0
  // means the keyword is inside that unclosed bracket. Reaching a block opener at depth 0
  // (or a declaration-ending '.') first means the keyword is a top-level intermediate.
  private isIntermediateInsideBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 0;
    for (let i = position - 1; i >= 0; i--) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start;
        continue;
      }
      const ch = source[i];
      if (ch === ')' || ch === ']' || ch === '}') {
        depth++;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        if (depth === 0) {
          // Unclosed opening bracket before any enclosing block opener: keyword is nested
          return true;
        }
        depth--;
        continue;
      }
      // Declaration-ending period at depth 0 ends the search without an enclosing block
      if (ch === '.' && depth === 0) {
        const prev = i > 0 ? source[i - 1] : '';
        const next = i + 1 < source.length ? source[i + 1] : '';
        // Skip '..' range operator and decimal points in float literals
        if (prev !== '.' && next !== '.' && !(/[0-9]/.test(prev) && /[0-9]/.test(next))) {
          return false;
        }
        continue;
      }
      // Block opener keyword reached at depth 0: keyword is a top-level intermediate
      if (depth === 0 && /[a-z]/i.test(ch)) {
        let wordStart = i;
        while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
          wordStart--;
        }
        const word = source.slice(wordStart, i + 1);
        if (BLOCK_OPENER_KEYWORDS.has(word)) {
          return false;
        }
        i = wordStart;
      }
    }
    return false;
  }

  private hasTopLevelCommaBetween(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    return hasTopLevelCommaBetween(source, start, end, excludedRegions);
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Character literal: $x (must check before %, ", ' to avoid false matches)
    if (char === '$') {
      return this.matchCharacterLiteral(source, pos);
    }

    // Single-line comment: % to end of line
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Triple-quoted string (OTP 27+): """ must be followed by a newline
    if (char === '"' && source.slice(pos, pos + 3) === '"""') {
      // Check if next non-horizontal-whitespace char on the same line is newline or EOF
      let k = pos + 3;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
        return this.matchTripleQuotedString(source, pos);
      }
      // Not a valid triple-quoted string: treat as "" (empty string) + " (regular string start)
      // Return the empty string "" as excluded region; the " will be matched on the next iteration
      return { start: pos, end: pos + 2 };
    }

    // OTP 27+ tilde-sigil: ~"...", ~'...' (verbatim, no backslash escapes)
    // Also handles triple-quoted sigils: ~""", ~'''
    // OTP 27 also allows other delimiters: paired (){}[]<> and same-char / | ` # .
    if (char === '~' && pos + 1 < source.length) {
      let offset = pos + 1;
      // Skip the optional sigil prefix. OTP 27 allows any letter sequence as a prefix
      // (standard s/S/b/B as well as user-defined names like ~r, ~json), so consume a
      // run of ASCII letters and treat the character right after it as the delimiter.
      // A prefix with no following delimiter (e.g. trailing ~r at EOF) leaves offset
      // past the source end, so no region is produced (matching prior behavior for ~b).
      while (offset < source.length && /[a-zA-Z]/.test(source[offset])) {
        offset++;
      }
      const delim = source[offset];
      if (delim === '"') {
        // Check for triple-quoted sigil string: ~""" or ~s"""
        if (source.slice(offset, offset + 3) === '"""') {
          let k = offset + 3;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
            k++;
          }
          if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
            return this.matchTripleQuotedString(source, pos, offset);
          }
        }
        return this.matchVerbatimString(source, pos, offset, '"');
      }
      if (delim === "'") {
        // Check for triple-quoted sigil atom: ~''' or ~s'''
        if (source.slice(offset, offset + 3) === "'''") {
          let k = offset + 3;
          while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
            k++;
          }
          if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
            return this.matchTripleQuotedAtom(source, pos, offset);
          }
        }
        return this.matchVerbatimString(source, pos, offset, "'");
      }
      // Paired delimiters: scan to the matching close delimiter (no nesting).
      // OTP 27 EEP-64 allows paired-delimiter sigils to span multiple lines.
      if (delim === '(' || delim === '[' || delim === '{' || delim === '<') {
        return this.matchSigilDelimited(source, pos, offset, PAIRED_SIGIL_DELIMITERS[delim], true);
      }
      // Same-char delimiters: scan to the next occurrence of the same character.
      // Newline terminates the region (verbatim-string semantics) to keep an orphan
      // delimiter from absorbing the rest of the source.
      if (delim === '/' || delim === '|' || delim === '`' || delim === '#' || delim === '.') {
        return this.matchSigilDelimited(source, pos, offset, delim, false);
      }
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Triple-quoted atom (OTP 27+): ''' must be followed by a newline
    if (char === "'" && source.slice(pos, pos + 3) === "'''") {
      let k = pos + 3;
      while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
        k++;
      }
      if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
        return this.matchTripleQuotedAtom(source, pos);
      }
      // Not a valid triple-quoted atom: treat as '' (empty atom) + ' (regular atom start)
      return { start: pos, end: pos + 2 };
    }

    // Single-quoted atom
    if (char === "'") {
      return this.matchAtom(source, pos);
    }

    return null;
  }

  // Matches OTP 27+ verbatim string/atom (no backslash escapes)
  // Unterminated at newline extends to source.length to prevent phantom string/atom from orphaned quote
  private matchVerbatimString(source: string, regionStart: number, quoteStart: number, quoteChar: string): ExcludedRegion {
    let i = quoteStart + 1;
    while (i < source.length) {
      if (source[i] === quoteChar) {
        return { start: regionStart, end: i + 1 };
      }
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: regionStart, end: source.length };
      }
      i++;
    }
    return { start: regionStart, end: source.length };
  }

  // Matches OTP 27+ sigil with non-quote delimiters (no backslash escapes, no nesting)
  // delimStart points at the opening delimiter; closeChar is the matching close character
  // (same char for /|`#. delimiters, the paired bracket for (){}[]<>)
  // allowNewlines: paired-delimiter sigils ((){}[]<>) may span multiple lines per OTP 27
  // EEP-64, so newlines are part of the body and only the closeChar terminates the region.
  // Same-char delimiters (/|`#.) treat a newline as an unterminated-region signal and
  // extend to source.length to match matchVerbatimString behavior.
  private matchSigilDelimited(source: string, regionStart: number, delimStart: number, closeChar: string, allowNewlines: boolean): ExcludedRegion {
    let i = delimStart + 1;
    while (i < source.length) {
      if (source[i] === closeChar) {
        return { start: regionStart, end: i + 1 };
      }
      if (!allowNewlines && (source[i] === '\n' || source[i] === '\r')) {
        return { start: regionStart, end: source.length };
      }
      i++;
    }
    return { start: regionStart, end: source.length };
  }

  // Matches Erlang character literal: $x, $\n, $\\, etc
  private matchCharacterLiteral(source: string, pos: number): ExcludedRegion | null {
    if (pos + 1 >= source.length) {
      return null;
    }
    // $\ followed by escape character
    if (source[pos + 1] === '\\' && pos + 2 < source.length) {
      const escChar = source[pos + 2];

      // $\x{HH...} - hex with braces
      if (escChar === 'x' && pos + 3 < source.length && source[pos + 3] === '{') {
        let i = pos + 4;
        while (i < source.length && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        // Skip closing brace if present
        if (i < source.length && source[i] === '}') {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\xHH - hex without braces (up to 2 hex digits)
      if (escChar === 'x') {
        let i = pos + 3;
        const limit = Math.min(i + 2, source.length);
        while (i < limit && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\OOO - octal (up to 3 octal digits)
      if (escChar >= '0' && escChar <= '7') {
        let i = pos + 3;
        const limit = Math.min(i + 2, source.length);
        while (i < limit && source[i] >= '0' && source[i] <= '7') {
          i++;
        }
        return { start: pos, end: i };
      }

      // $\^X - control character (4 chars total)
      if (escChar === '^' && pos + 3 < source.length) {
        return { start: pos, end: pos + 4 };
      }

      // $\<char> - basic escape; handle surrogate pairs for characters outside BMP
      const code = source.codePointAt(pos + 2);
      const charLen = code !== undefined && code > 0xffff ? 2 : 1;
      return { start: pos, end: pos + 2 + charLen };
    }
    // $x where x is any character (handle surrogate pairs for characters outside BMP)
    const code = source.codePointAt(pos + 1);
    const charLen = code !== undefined && code > 0xffff ? 2 : 1;
    return { start: pos, end: pos + 1 + charLen };
  }

  // Matches triple-quoted string (OTP 27+): """..."""
  // No escape processing; closing """ must be at start of line
  // quoteStart: position of the first " (defaults to pos for bare """, differs for ~""" or ~S""")
  private matchTripleQuotedString(source: string, pos: number, quoteStart = pos): ExcludedRegion {
    let i = quoteStart + 3;
    while (i < source.length) {
      if (source[i] === '"' && source.slice(i, i + 3) === '"""') {
        // Closing """ must be preceded only by whitespace on its line
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (/^[ \t]*$/.test(source.slice(lineStart, i))) {
          return { start: pos, end: i + 3 };
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches triple-quoted atom (OTP 27+): '''...'''
  // No escape processing; closing ''' must be at start of line
  // quoteStart: position of the first ' (defaults to pos for bare ''', differs for ~''' or ~S''')
  private matchTripleQuotedAtom(source: string, pos: number, quoteStart = pos): ExcludedRegion {
    let i = quoteStart + 3;
    while (i < source.length) {
      if (source[i] === "'" && source.slice(i, i + 3) === "'''") {
        // Closing ''' must be preceded only by whitespace on its line
        let lineStart = i;
        while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
          lineStart--;
        }
        if (/^[ \t]*$/.test(source.slice(lineStart, i))) {
          return { start: pos, end: i + 3 };
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Custom block matching: restricts intermediates to their valid block types
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
            const top = stack[stack.length - 1];
            const topOpener = top.token.value;
            // For `try` blocks the intermediates must appear in order of/catch/after,
            // each at most once. Reject duplicates and out-of-order tokens.
            if (topOpener === 'try' && (token.value === 'of' || token.value === 'catch' || token.value === 'after')) {
              const order: Readonly<Record<string, number>> = { of: 0, catch: 1, after: 2 };
              const seen = top.intermediates.map((t) => order[t.value]).filter((n): n is number => n !== undefined);
              const lastSeen = seen.length === 0 ? -1 : Math.max(...seen);
              const current = order[token.value];
              if (seen.includes(current) || current <= lastSeen) {
                break;
              }
              top.intermediates.push(token);
            } else if (token.value === 'catch') {
              if (topOpener === 'try') {
                top.intermediates.push(token);
              }
            } else if (token.value === 'of') {
              // 'of' is only valid for 'case' and 'try' blocks; reject duplicates
              if ((topOpener === 'case' || topOpener === 'try') && !top.intermediates.some((t) => t.value === 'of')) {
                top.intermediates.push(token);
              }
            } else if (token.value === 'after') {
              // 'after' is only valid for 'receive' and 'try' blocks; reject duplicates
              if ((topOpener === 'receive' || topOpener === 'try') && !top.intermediates.some((t) => t.value === 'after')) {
                top.intermediates.push(token);
              }
            } else if (token.value === 'else') {
              // Per Erlang Reference Manual, `else` is only valid as an intermediate
              // for `maybe` blocks (OTP 25+). `if` only allows guard clauses (no else),
              // and `try` allows `of`/`catch`/`after` (no else). Reject duplicates.
              if (topOpener === 'maybe' && !top.intermediates.some((t) => t.value === 'else')) {
                top.intermediates.push(token);
              }
            } else {
              top.intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const openBlock = stack.pop();
          if (openBlock) {
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

  // Checks if a position is inside parenthesized arguments of a module attribute
  // e.g. -define(begin, start), -module(begin), -export([end/0]), -ifdef(begin)
  // For -record, stops at unmatched '{' because record bodies contain real expressions (fun() -> ok end)
  // For -define and other attributes, tuple bodies inside braces still filter keywords
  private isInsideModuleAttributeArgs(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    // Fast path: binary search for the enclosing module-attribute span (-name(...).
    // If pos is not inside any -name(...) on a line-start attribute, we cannot be
    // inside module attribute args. This bounds the backward scan to the attribute
    // body instead of scanning from pos all the way back to source start.
    const span = this.findEnclosingAttributeSpan(pos);
    if (!span) {
      return false;
    }

    let parenDepth = 0;
    let braceDepth = 0;
    // List brackets are tracked separately from parens: an unmatched '[' before the
    // keyword means the keyword sits inside a -define list literal, where bare reserved
    // words must be filtered but real blocks (fun(...)/end) are kept (same as tuples).
    let listDepth = 0;
    let insideUnmatchedBrace = false;
    let insideUnmatchedList = false;
    // An unmatched '(' not preceded by an identifier is a grouping paren (e.g. -define(M, (begin))).
    // Its contents are real expressions, so bare reserved words are filtered while real
    // blocks are kept -- same treatment as tuple braces and list brackets.
    let insideGroupingParen = false;
    let sawCommaAtTopLevel = false;
    let insideNestedCall = false;
    // Stop at openParen-1: anything before that is outside the attribute and irrelevant.
    const stopAt = span.openParen;
    for (let i = pos - 1; i > stopAt; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const ch = source[i];
      if (ch === ',' && parenDepth === 0 && braceDepth === 0 && listDepth === 0) {
        sawCommaAtTopLevel = true;
        continue;
      }
      if (ch === ')') {
        parenDepth++;
      } else if (ch === ']') {
        listDepth++;
      } else if (ch === '(') {
        if (parenDepth > 0) {
          parenDepth--;
        } else {
          // Inner unmatched '(' is either a nested function call (e.g. nested( in
          // -define(MACRO, nested(begin))) or a grouping paren (e.g. ( in -define(M, (begin))).
          // It is a nested call only when preceded by an identifier; otherwise it groups.
          let prevIdx = i - 1;
          while (prevIdx >= 0 && /\s/.test(source[prevIdx])) {
            prevIdx--;
          }
          if (prevIdx >= 0 && /[a-zA-Z0-9_]/.test(source[prevIdx])) {
            insideNestedCall = true;
          } else {
            insideGroupingParen = true;
          }
          // Continue scanning back; this is not the enclosing attribute paren
          // (the loop bound stopAt = span.openParen guarantees we stop before it).
        }
      } else if (ch === '[') {
        if (listDepth > 0) {
          listDepth--;
        } else {
          // Unmatched '[' at depth 0: the keyword sits inside a -define list literal.
          insideUnmatchedList = true;
        }
      } else if (ch === '}') {
        braceDepth++;
      } else if (ch === '{') {
        if (braceDepth > 0) {
          braceDepth--;
        } else {
          // Unmatched '{' at depth 0: check if this is a record (#name{...}) or map (#{...}) literal
          // Both record and map brace bodies contain real expressions that should not be filtered
          let j = i - 1;
          while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) j--;
          if (j >= 0 && source[j] === '#') {
            return false;
          }
          // Non-record/map brace (tuple in -define): continue scanning
          insideUnmatchedBrace = true;
        }
      }
    }

    // Reached the enclosing attribute opening paren at span.openParen; apply the
    // attribute-name-specific rules using the precomputed attribute name.
    const attrName = span.name;
    // For -record, unmatched braces contain real expressions (but keywords inside
    // nested function calls inside the brace are still filtered).
    if (attrName === 'record' && insideUnmatchedBrace && !insideNestedCall) {
      return false;
    }
    // For -define, the body (after the first top-level ',') contains real expressions
    // outside nested function calls. Tuple braces ({...}), list brackets ([...]) and
    // grouping parens ((...)) inside the body still hold real expressions too: a real
    // block (fun(...)/begin/case...) is recognized while a bare reserved word stays filtered.
    // Nested function calls (e.g. list:map(fun(X) -> X end, L)) also contain real
    // expressions when wrapped in a -define body, so the opener-stack analysis applies.
    if (attrName === 'define' && sawCommaAtTopLevel) {
      if (insideNestedCall) {
        // Inside a nested call inside -define body: filter only bare reserved words; a real
        // anonymous fun (fun followed by '(') paired with its matching 'end' must remain.
        return this.isBareReservedWordInDefineBody(source, pos, span, excludedRegions);
      }
      // Bare-keyword body case: -define(NAME, KEYWORD). Here the body is just the keyword
      // itself, so it's a reserved-word reference, not a real block opener.
      if (!insideUnmatchedBrace && !insideUnmatchedList && !insideGroupingParen && this.isBareKeywordInDefineBody(source, pos, excludedRegions)) {
        return true;
      }
      // Inside a tuple brace, list bracket or grouping paren: filter only bare reserved
      // words, keep real blocks.
      if (insideUnmatchedBrace || insideUnmatchedList || insideGroupingParen) {
        return this.isBareReservedWordInDefineBody(source, pos, span, excludedRegions);
      }
      return false;
    }
    return true;
  }

  // Returns true if the block keyword at `pos` is a bare reserved word inside the body of
  // `-define` macro `span`, rather than part of a real block (fun(...)/begin.../end).
  // Backed by a per-parse cache built by `analyzeDefineBody`: each -define body is scanned
  // once and bare-keyword queries become O(1) Set lookups, so total cost stays O(body size).
  private isBareReservedWordInDefineBody(source: string, pos: number, span: AttributeSpan, excludedRegions: ExcludedRegion[]): boolean {
    if (span.bodyCommaPos < 0) {
      return false;
    }
    const analysis = this.getDefineBodyAnalysis(source, span, excludedRegions);
    // The keyword at `pos` is a real block element only if it took part in a matched pair
    // or remains on the opener stack (an unclosed but real opener).
    return !analysis.realOffsets.has(pos) && !analysis.unclosedOpeners.has(pos);
  }

  // Returns the cached analysis for `span`, building it on first request.
  // The body is scanned once: openers whose next significant character is a separator
  // (',' or a closing bracket) are bare; `fun` not followed by '(' is a reference; `end`
  // with no matching opener on the stack is bare. A keyword that participates in a matched
  // open/close pair is a real block element.
  private getDefineBodyAnalysis(source: string, span: AttributeSpan, excludedRegions: ExcludedRegion[]): DefineBodyAnalysis {
    const cached = this.defineBodyAnalyses.get(span);
    if (cached) {
      return cached;
    }
    const analysis = this.analyzeDefineBody(source, span, excludedRegions);
    this.defineBodyAnalyses.set(span, analysis);
    return analysis;
  }

  // Single-pass scan of `span`'s body that classifies every block keyword as either a
  // real block participant (paired or still on the opener stack) or a bare reserved word.
  private analyzeDefineBody(source: string, span: AttributeSpan, excludedRegions: ExcludedRegion[]): DefineBodyAnalysis {
    const bodyStart = span.bodyCommaPos + 1;
    const bodyEnd = Math.min(span.endParen, source.length);
    // Stack of real opener offsets; matched openers/closers and stack contents are real blocks.
    const openerStack: number[] = [];
    const realOffsets = new Set<number>();
    let i = bodyStart;
    while (i < bodyEnd) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      // Word start: only consider identifier-leading characters not preceded by an
      // identifier/'?'/'#'/'.' character (those are atoms, macros, record/field access).
      if (/[a-z]/i.test(ch) && (i === 0 || !/[a-zA-Z0-9_?#.]/.test(source[i - 1]))) {
        let wordEnd = i;
        while (wordEnd < source.length && /[a-zA-Z0-9_]/.test(source[wordEnd])) {
          wordEnd++;
        }
        const word = source.slice(i, wordEnd);
        if (word === 'end') {
          const opener = openerStack.pop();
          if (opener !== undefined) {
            realOffsets.add(opener);
            realOffsets.add(i);
          }
        } else if (word === 'fun') {
          // A real anonymous fun is always written `fun(`; otherwise it is a fun reference.
          let k = wordEnd;
          while (k < bodyEnd && /[ \t\r\n]/.test(source[k])) {
            k++;
          }
          if (k < bodyEnd && source[k] === '(') {
            openerStack.push(i);
          }
        } else if (BLOCK_OPENER_KEYWORDS.has(word)) {
          // begin/if/case/receive/try/maybe: a bare reserved word is immediately followed
          // by a separator (',' or a closing bracket); a real block opener is followed by
          // an expression or guard.
          let k = wordEnd;
          while (k < bodyEnd && /[ \t\r\n]/.test(source[k])) {
            k++;
          }
          const next = k < bodyEnd ? source[k] : '';
          if (next !== ',' && next !== ')' && next !== ']' && next !== '}' && next !== '') {
            openerStack.push(i);
          }
        }
        i = wordEnd;
        continue;
      }
      i++;
    }
    return { realOffsets, unclosedOpeners: new Set(openerStack) };
  }

  // Binary-search for the attribute span enclosing `position` (openParen < position < endParen).
  // Returns the innermost (largest openParen) span, or null if `position` is not inside any.
  private findEnclosingAttributeSpan(position: number): AttributeSpan | null {
    const spans = this.attributeSpans;
    let left = 0;
    let right = spans.length - 1;
    let candidate: AttributeSpan | null = null;
    while (left <= right) {
      const mid = (left + right) >> 1;
      const span = spans[mid];
      if (span.openParen < position) {
        candidate = span;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    if (!candidate) return null;
    if (position >= candidate.endParen) return null;
    return candidate;
  }

  // Returns true if the keyword at `pos` is the entire body of a -define macro: -define(NAME, KEYWORD).
  // In this case the keyword is a reserved-word reference, not a real block opener/closer.
  // Both conditions must hold:
  //   1. The keyword is immediately preceded by the body-introducing comma (only whitespace/comments between).
  //   2. The keyword is followed by ')' (only whitespace/comments/stray braces between).
  // Without (1), a real block opener like `end` in `-define(M, fun(X) -> X end)` would be
  // misclassified as bare just because it precedes ')'.
  // Stray '{'/'}' characters between the keyword and ')' are skipped as junk: they only
  // appear in malformed input like `-define(M, end}).`, where the body is invalid Erlang
  // anyway. Skipping them lets us still classify the keyword as bare and avoid pairing it
  // with a later real block closer.
  private isBareKeywordInDefineBody(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    // Backward: nearest non-whitespace/comment char must be ',' (the -define body-introducing comma)
    let b = pos - 1;
    while (b >= 0) {
      const ch = source[b];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        b--;
        continue;
      }
      const region = this.findExcludedRegionAt(b, excludedRegions);
      if (region) {
        b = region.start - 1;
        continue;
      }
      break;
    }
    if (b < 0 || source[b] !== ',') {
      return false;
    }
    // Forward: nearest non-whitespace/comment/brace char must be ')' (the -define closing paren)
    let keywordEnd = pos;
    while (keywordEnd < source.length && /[a-zA-Z0-9_]/.test(source[keywordEnd])) {
      keywordEnd++;
    }
    let i = keywordEnd;
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      // Stray '{'/'}' from malformed bodies like `-define(M, end}).` are skipped as junk
      if (ch === '{' || ch === '}') {
        i++;
        continue;
      }
      return ch === ')';
    }
    return false;
  }

  // Matches single-quoted atom with escape handling
  // Handles \xNN, \x{...}, and \OOO (octal) escape sequences
  private matchAtom(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        const escChar = source[i + 1];

        // \x{HH...} - hex with braces
        if (escChar === 'x' && i + 2 < source.length && source[i + 2] === '{') {
          let j = i + 3;
          while (j < source.length && /[0-9a-fA-F]/.test(source[j])) {
            j++;
          }
          if (j < source.length && source[j] === '}') {
            j++;
          }
          i = j;
          continue;
        }

        // \xHH - hex without braces (up to 2 hex digits)
        if (escChar === 'x') {
          let j = i + 2;
          const limit = Math.min(j + 2, source.length);
          while (j < limit && /[0-9a-fA-F]/.test(source[j])) {
            j++;
          }
          i = j;
          continue;
        }

        // \OOO - octal (up to 3 octal digits)
        if (escChar >= '0' && escChar <= '7') {
          let j = i + 2;
          const limit = Math.min(j + 2, source.length);
          while (j < limit && source[j] >= '0' && source[j] <= '7') {
            j++;
          }
          i = j;
          continue;
        }

        // \^X - control character
        if (escChar === '^' && i + 2 < source.length) {
          i += 3;
          continue;
        }

        // Per Erlang spec, `\<LF>` (and `\<CR>`/`\<CRLF>`) inside a quoted atom is a
        // line continuation: the backslash and newline are consumed and the atom
        // continues on the next line.
        if (escChar === '\n') {
          i += 2;
          continue;
        }
        if (escChar === '\r') {
          const skip = i + 2 < source.length && source[i + 2] === '\n' ? 3 : 2;
          i += skip;
          continue;
        }
        // Basic escape: \n, \t, \\, \', etc
        i += 2;
        continue;
      }
      if (source[i] === "'") {
        return { start: pos, end: i + 1 };
      }
      // Atoms cannot span multiple lines - unterminated atom ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
