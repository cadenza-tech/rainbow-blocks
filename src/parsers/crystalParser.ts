// Crystal block parser: handles macro templates, heredocs, percent literals, regex, and postfix conditionals

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { isForIn, isLoopDo, isPostfixConditional, isPostfixRescue, matchCharLiteral, matchHeredoc, matchMacroTemplate } from './crystalExcluded';
import type { HeredocState, InterpolationHandlers } from './rubyFamilyHelpers';
import {
  isRegexStart,
  matchBacktickString,
  matchInterpolatedString,
  matchPercentLiteral,
  matchRegexLiteral,
  skipInterpolationShared,
  skipNestedBacktickString,
  skipNestedRegex,
  skipNestedString,
  skipRegexInterpolationShared
} from './rubyFamilyHelpers';

// Valid Crystal regex flags
const REGEX_FLAGS_PATTERN = /[imx]/;

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrx]/;

// Keywords after which / starts a regex, not division.
// Includes true control keywords (`if`, `unless`, ...) plus method-like keywords
// (`puts`, `print`, `raise`) that often take a regex literal as the first argument.
// The method-like subset is also listed in METHOD_LIKE_REGEX_KEYWORDS so that
// `isRegexStart` only treats them as regex starters under the method-call spacing
// rule (`puts /re/` is regex, `puts / 2` is division).
const REGEX_PRECEDING_KEYWORDS = new Set([
  'if',
  'unless',
  'while',
  'until',
  'when',
  'case',
  'and',
  'or',
  'not',
  'return',
  'yield',
  'puts',
  'print',
  'raise',
  'in',
  'then',
  'else',
  'elsif',
  'do',
  'begin',
  'rescue',
  'ensure',
  'select'
]);

// Method-like identifiers that double as keywords here but are really method names.
// For these, `/` after whitespace is division by default; only `ident /regex/` (no
// space after `/`) is treated as a regex argument.
const METHOD_LIKE_REGEX_KEYWORDS = new Set(['puts', 'print', 'raise']);

// `abstract def` declarations have no body and no `end`. This matches `abstract`
// immediately before `def`, allowing only spaces/tabs and backslash line
// continuations (\<LF>, \<CRLF>, \<CR>) between the two keywords.
const ABSTRACT_DEF_PATTERN = /\babstract(?:[ \t]+|[ \t]*\\(?:\r\n|\r|\n)[ \t]*)+$/;

// Maps each intermediate keyword to the set of opener keywords it can belong to.
// An intermediate keyword appearing under an incompatible opener (e.g. `rescue`
// directly inside a `class` body) is not a section of that block, so it is
// dropped from the block's intermediates instead of being mis-attributed.
// - elsif: conditional branches (if/unless)
// - rescue/ensure: exception handling, valid only in implicit-begin contexts
//   (begin, def, and do-blocks); class/module/struct bodies are not such contexts
// - when: case branches and select branches
// - in: case-in pattern matching (for-in `in` is filtered out during tokenize)
// - else: conditional else (if/unless), case/select else, and exception else
//   (begin/def/do)
// - then: one-line conditional/case bodies (if/unless and case/select branches)
const INTERMEDIATE_TO_OPENERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['elsif', new Set(['if', 'unless'])],
  ['rescue', new Set(['begin', 'def', 'do'])],
  ['ensure', new Set(['begin', 'def', 'do'])],
  ['when', new Set(['case', 'select'])],
  ['in', new Set(['case'])],
  ['else', new Set(['if', 'unless', 'case', 'select', 'begin', 'def', 'do'])],
  ['then', new Set(['if', 'unless', 'case', 'select'])]
]);

// Context-dependent keywords that double as ordinary identifiers. When written as
// `KEYWORD.method` (receiver) or `KEYWORD = expr` (assignment target) the keyword is a
// variable/value, not a block opener. Unlike `do`/`if` (guarded by isLoopDo/
// isPostfixConditional), these have no other positional guard, so an identifier use of
// one of them must suppress the block-open classification. Real openers are always
// followed by a name/newline (`enum Color`, `struct Point`), never by `.`/`=` on the
// same line, so suppressing these forms does not affect genuine blocks.
const RECEIVER_LIKE_OPENERS = new Set(['select', 'union', 'enum', 'struct', 'lib', 'macro', 'annotation']);

// Crystal interpolation check: %Q, %W, %I, %x, %r and bare % interpolate
function isCrystalInterpolatingPercent(specifier: string, hasSpecifier: boolean): boolean {
  if (!hasSpecifier) return true;
  return specifier === 'Q' || specifier === 'W' || specifier === 'I' || specifier === 'x' || specifier === 'r';
}

export class CrystalBlockParser extends BaseBlockParser {
  private _lastExcludedRegion: ExcludedRegion | null = null;

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      // Ruby-like
      'do',
      'if',
      'unless',
      'while',
      'until',
      'begin',
      'def',
      'class',
      'module',
      'case',
      'for',
      // Crystal-specific
      'macro',
      'lib',
      'struct',
      'enum',
      'union',
      'annotation',
      'select'
      // Note: "fun" is excluded because inside "lib" blocks it's used
      // as a declaration without "end"
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in', 'then']
  };

  // Finds excluded regions: comments, strings, regex, heredocs, macro templates
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    this._lastExcludedRegion = null;
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        // If region starts after current position (heredoc opener line gap),
        // scan the gap for excluded regions (comments, strings)
        if (result.start > i) {
          let j = i + 1;
          while (j < result.start) {
            // Skip '<' to avoid re-matching heredoc
            if (source[j] === '<') {
              j++;
              continue;
            }
            const gapResult = this.tryMatchExcludedRegion(source, j);
            if (gapResult) {
              const gapRegion = {
                start: gapResult.start,
                end: Math.min(gapResult.end, result.start)
              };
              regions.push(gapRegion);
              this._lastExcludedRegion = gapRegion;
              j = gapResult.end;
            } else {
              j++;
            }
          }
        }
        regions.push(result);
        this._lastExcludedRegion = result;
        i = result.end;
      } else {
        // Skip past quote in failed heredoc opener (e.g., <<-"FOO or <<~"FOO without closing quote)
        // to prevent the quote from being re-scanned as a string delimiter.
        // Register the quoted span as an excluded region so that any block keywords
        // inside the quotes (e.g., `<<-"end class"`) are not tokenized.
        if (
          source[i] === '<' &&
          i + 3 < source.length &&
          source[i + 1] === '<' &&
          (source[i + 2] === '-' || source[i + 2] === '~') &&
          (source[i + 3] === '"' || source[i + 3] === "'")
        ) {
          const quoteType = source[i + 3];
          const quoteStart = i + 3;
          let j = i + 4;
          // Scan forward to skip the closing quote on the same line.
          // Honor backslash escapes (e.g. `\"`) so the actual closing quote is
          // consumed; otherwise the trailing quote stays orphaned and is later
          // mis-detected as a regular string opener that swallows downstream code.
          while (j < source.length && source[j] !== quoteType && source[j] !== '\n' && source[j] !== '\r') {
            if (source[j] === '\\' && j + 1 < source.length && source[j + 1] !== '\n' && source[j + 1] !== '\r') {
              j += 2;
              continue;
            }
            j++;
          }
          if (j < source.length && source[j] === quoteType) {
            // Found the closing quote on the same line: register from the
            // opening quote through the closing quote.
            regions.push({ start: quoteStart, end: j + 1 });
            i = j + 1;
          } else {
            // Closing quote not on the same line: the opener is unterminated.
            // Exclude only the orphan quote span up to the end of its own line
            // (`j`), then resume normal parsing from `j`. Do NOT scan forward
            // across lines for a far matching quote: an unrelated quote later in
            // the source (e.g. `puts "done"`) would otherwise make the orphan
            // opener greedily swallow every block in between, dropping valid pairs.
            // Bounding the exclusion at the opener's own line keeps the orphan
            // count minimal and makes the result independent of any trailing quote.
            regions.push({ start: quoteStart, end: j });
            i = j;
          }
        } else {
          i++;
        }
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Macro template {% %} or {{ }}
    if (char === '{') {
      const region = matchMacroTemplate(source, pos);
      if (region) return region;
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return this.matchInterpolatedString(source, pos);
    }

    // Question mark char literal (?x, ?\n, ?\uXXXX, etc.)
    // ?" and ?' are valid char literals (the quote character itself).
    // Reject when preceded by $ or @ since $?, @? are special variable references
    // and the following / is division, not part of a char literal.
    if (char === '?' && pos + 1 < source.length && (pos === 0 || !/[a-zA-Z0-9_)\]}$@]/.test(source[pos - 1]))) {
      const nextChar = source[pos + 1];
      if (nextChar === '"' || nextChar === "'") return { start: pos, end: pos + 2 };
      if (nextChar === '\\' && pos + 2 < source.length) {
        const escChar = source[pos + 2];
        // \u{XXXX} brace form
        if (escChar === 'u' && pos + 3 < source.length && source[pos + 3] === '{') {
          let j = pos + 4;
          while (j < source.length && source[j] !== '}' && source[j] !== '\n' && source[j] !== '\r') {
            j++;
          }
          if (j < source.length && source[j] === '}') return { start: pos, end: j + 1 };
          return { start: pos, end: j };
        }
        // \uXXXX: up to 4 hex digits
        if (escChar === 'u') {
          let j = pos + 3;
          while (j < source.length && j < pos + 7 && /[0-9a-fA-F]/.test(source[j])) j++;
          return { start: pos, end: j };
        }
        // \xNN: up to 2 hex digits
        if (escChar === 'x') {
          let j = pos + 3;
          while (j < source.length && j < pos + 5 && /[0-9a-fA-F]/.test(source[j])) j++;
          return { start: pos, end: j };
        }
        // \oNNN: up to 3 octal digits
        if (escChar === 'o') {
          let j = pos + 3;
          while (j < source.length && j < pos + 6 && /[0-7]/.test(source[j])) j++;
          return { start: pos, end: j };
        }
        // \NNN: legacy octal, up to 2 more octal digits
        if (/[0-7]/.test(escChar)) {
          let j = pos + 3;
          while (j < source.length && j < pos + 5 && /[0-7]/.test(source[j])) j++;
          return { start: pos, end: j };
        }
        return { start: pos, end: pos + 3 };
      }
      if (nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r') {
        const code = nextChar.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff) {
          return { start: pos, end: pos + 3 };
        }
        return { start: pos, end: pos + 2 };
      }
    }

    // Single-quoted char literal (Crystal: only single characters)
    if (char === "'") {
      const charLiteral = matchCharLiteral(source, pos);
      if (charLiteral) return charLiteral;
      // Invalid char literal (multi-char): skip to next ' on same line
      // to prevent keywords between quotes from being detected
      let j = pos + 1;
      let trailingBackslash = false;
      while (j < source.length && source[j] !== "'" && source[j] !== '\n' && source[j] !== '\r') {
        if (source[j] === '\\' && j + 1 < source.length) {
          // Don't skip past newline, but remember that we hit a trailing `\<NL>`
          // so that the backslash itself can be included in the excluded region.
          if (source[j + 1] === '\n' || source[j + 1] === '\r') {
            trailingBackslash = true;
            break;
          }
          j += 2;
          continue;
        }
        j++;
      }
      if (j < source.length && source[j] === "'") {
        return { start: pos, end: j + 1 };
      }
      // Unterminated on this line: still mark the partial literal as excluded.
      // This prevents a trailing backslash (e.g. `'a\<NL>`) from being interpreted
      // as a logical line continuation, which would merge the next line's keywords
      // (e.g. `if`) into the same logical line as a postfix conditional.
      // Include the trailing backslash itself when one stopped the scan.
      const end = trailingBackslash ? j + 1 : j;
      if (end > pos + 1) {
        return { start: pos, end };
      }
      return null;
    }

    // Regex literal
    if (char === '/' && this.isRegexStart(source, pos)) {
      return this.matchRegexLiteral(source, pos);
    }

    // Heredoc
    if (char === '<' && pos + 1 < source.length && source[pos + 1] === '<') {
      const result = matchHeredoc(source, pos);
      if (result) return { start: result.contentStart, end: result.end };
    }

    // Percent literals (skip modulo operator: number/identifier % delimiter)
    if (char === '%' && pos + 1 < source.length && !this.isModuloOperator(source, pos)) {
      const result = this.matchPercentLiteral(source, pos);
      if (result) return { start: pos, end: result.end };
    }

    // Symbol literal
    if (char === ':' && this.isSymbolStart(source, pos)) {
      return this.matchSymbolLiteral(source, pos);
    }

    // Backtick string (command) with #{} interpolation
    if (char === '`') {
      return this.matchBacktickString(source, pos);
    }

    return null;
  }

  // Checks if colon starts a symbol (not ternary, named tuple key, type annotation, or scope resolution)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // :: is scope resolution (e.g., Foo::Bar), not a symbol
    if (nextChar === ':') {
      return false;
    }

    // Check if preceded by : (second half of ::)
    if (pos > 0 && source[pos - 1] === ':') {
      return false;
    }

    // Symbol must start with letter, underscore, or quote
    if (!/[a-zA-Z_"']/.test(nextChar)) {
      return false;
    }

    // Colon after identifier/number/closing bracket is ternary, not symbol
    // Only check the immediately preceding character (do not skip whitespace)
    // because `puts :do` is a valid symbol argument to method `puts`
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}]/.test(prevChar)) {
        return false;
      }
    }

    return true;
  }

  // Matches symbol literal: :symbol, :"quoted", :'quoted'
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    const nextChar = source[pos + 1];

    // Double-quoted symbol with interpolation support (propagate heredocState)
    if (nextChar === '"') {
      const heredocState: HeredocState = { pendingEnd: -1 };
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          i = skipInterpolationShared(source, i + 2, this.interpolationHandlers, heredocState);
          continue;
        }
        if (source[i] === '"') {
          const end = i + 1;
          if (heredocState.pendingEnd > end) {
            return { start: pos, end: heredocState.pendingEnd };
          }
          return { start: pos, end };
        }
        i++;
      }
      if (heredocState.pendingEnd > i) {
        return { start: pos, end: heredocState.pendingEnd };
      }
      return { start: pos, end: i };
    }

    // Single-quoted symbol (no interpolation)
    if (nextChar === "'") {
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          return { start: pos, end: i + 1 };
        }
        i++;
      }
      return { start: pos, end: i };
    }

    // Simple symbol
    let i = pos + 1;
    while (i < source.length) {
      const char = source[i];
      if (/[a-zA-Z0-9_]/.test(char)) {
        i++;
        continue;
      }
      // ? and ! can only appear at the end of a symbol name
      if (char === '?' || char === '!') {
        i++;
        break;
      }
      break;
    }

    return { start: pos, end: i };
  }

  // Filters out keywords used as named tuple keys, rescue modifiers, and method calls
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    return tokens.filter((token) => {
      // Filter out dot-preceded tokens (method calls like obj.end, obj.rescue)
      // But NOT range operators (.., ...) - those end with '.' but are not method calls
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        if (token.startOffset < 2 || source[token.startOffset - 2] !== '.') {
          return false;
        }
      }
      // Filter out :: scope resolution (e.g., Module::Class::Begin)
      if (token.startOffset > 1 && source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':') {
        return false;
      }
      // Filter out keywords preceded by @ (instance/class variable names like @end, @@end, @do)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '@') {
        return false;
      }
      // Filter out keywords preceded by $ (global variable names like $end, $do, $begin)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '$') {
        return false;
      }
      // Filter out keywords used as method names after `def` (e.g., `def end`, `def class`,
      // `def begin`, `def do`). Without this filter, the keyword token interferes with
      // the def block's pairing.
      if (this.isAfterDefKeyword(source, token.startOffset)) {
        return false;
      }
      // Filter out keywords used as property/getter/setter macro arguments
      // (e.g., `property end : Int32 = 0`). These macros take a name argument,
      // so any block keyword in the name slot is a property name, not a block.
      if (this.isAfterPropertyMacro(source, token.startOffset, token.endOffset)) {
        return false;
      }
      // Filter out tokens immediately followed by colon (named tuple key)
      if (source[token.endOffset] === ':') {
        return false;
      }
      // Filter out keywords in heredoc openers (<<-end, <<~end, <<-'do', <<~'do', <<-"if", <<~"if" etc.)
      if (token.startOffset >= 3 && /<<[-~]$/.test(source.slice(token.startOffset - 3, token.startOffset))) {
        return false;
      }
      if (token.startOffset >= 4 && /<<[-~]['"]$/.test(source.slice(token.startOffset - 4, token.startOffset))) {
        return false;
      }
      // Filter out keywords followed by ? or = (method names like end?, do=)
      // But not != (not-equal) or == / === / =~ (comparison operators)
      const afterChar = source[token.endOffset];
      if (afterChar === '?') {
        return false;
      }
      if (
        afterChar === '=' &&
        token.endOffset + 1 < source.length &&
        source[token.endOffset + 1] !== '=' &&
        source[token.endOffset + 1] !== '~' &&
        source[token.endOffset + 1] !== '>'
      ) {
        return false;
      }
      if (afterChar === '=' && token.endOffset + 1 >= source.length) {
        return false;
      }
      // Filter out ! as method suffix but not != (not-equal operator)
      if (afterChar === '!' && (token.endOffset + 1 >= source.length || source[token.endOffset + 1] !== '=')) {
        return false;
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      // Filter out 'in' after 'for' on the same line (for x in collection)
      if (token.type === 'block_middle' && token.value === 'in') {
        return !isForIn(source, token.startOffset, excludedRegions);
      }
      // Filter out `end` placed after a range operator (.. or ...). `end` is a
      // reserved word and cannot be the RHS of a range expression, so this is
      // invalid syntax; treating it as block_close mis-pairs surrounding blocks
      // (e.g., `for x in (1..end)\n  ...\nend` would pair the inner `end` with `for`).
      if (token.value === 'end' && this.isPrecededByRangeOperator(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Symmetric case: filter out `end` placed before a range operator (.. or ...).
      // `end` is a reserved word and cannot be the LHS of a range expression either,
      // so this is invalid syntax; treating it as block_close mis-pairs surrounding
      // blocks (e.g., `if cond\n  a = (end..1)\nend` would pair the inner `end` with `if`).
      if (token.value === 'end' && this.isFollowedByRangeOperator(source, token.endOffset, excludedRegions)) {
        return false;
      }
      // Filter out `end` placed in the value position of a ternary expression
      // (`cond ? a : end`). `end` is a reserved word and cannot be a value, so this
      // is invalid syntax; treating it as block_close mis-pairs surrounding blocks.
      if (token.value === 'end' && this.isEndInTernaryValuePosition(source, token.startOffset, excludedRegions)) {
        return false;
      }
      return true;
    });
  }

  // Checks if the keyword at position is immediately preceded by a range operator
  // (.. or ...). Whitespace, including newlines (`\n`, `\r`, `\r\n`), is permitted
  // between the operator and the keyword: `(1..\n  end)` is also invalid Crystal
  // because `..` causes implicit line continuation and `end` cannot be the RHS of
  // a range. Skips characters inside excluded regions.
  private isPrecededByRangeOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    // Need at least two consecutive dots to form .. (or ...)
    if (i < 1 || source[i] !== '.' || source[i - 1] !== '.') {
      return false;
    }
    return true;
  }

  // Checks if the keyword that ends at endOffset is immediately followed by a range
  // operator (.. or ...). Whitespace, including newlines (`\n`, `\r`, `\r\n`), is
  // permitted between the keyword and the operator. Skips characters inside excluded
  // regions. Symmetric to isPrecededByRangeOperator and used to filter `end` on the
  // LHS of a range (`end..N`, including the multi-line form `end\n  ..N`).
  private isFollowedByRangeOperator(source: string, endOffset: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = endOffset;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      break;
    }
    // Need at least two consecutive dots to form .. (or ...)
    return i + 1 < source.length && source[i] === '.' && source[i + 1] === '.';
  }

  // Checks whether the keyword at `position` is the value of a case/when branch on the
  // same logical line: `when KEYWORD\n  ...`. Real opener forms (`enum Color`, `struct
  // Point`) never appear as a when value because that position requires an expression,
  // not a block-opening keyword. So a receiver-like keyword preceded only by `when`
  // (plus whitespace) on the same line is being used as an identifier/constant value
  // and must be suppressed from block-open classification. Scans backward from
  // `position`, skipping spaces, tabs, and excluded regions (no newlines), and checks
  // that the immediately preceding word is exactly `when` with a non-identifier
  // character (or start of source/line) before it.
  private isPrecededByWhen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      break;
    }
    // Need at least `when` (4 chars) before position. The character at index i must
    // be the last `n` of `when`, and the substring [i-3..i+1] must equal `when`.
    if (i < 3) {
      return false;
    }
    if (source.slice(i - 3, i + 1) !== 'when') {
      return false;
    }
    // The character before `when` (or start of source) must be a non-identifier
    // boundary so we do not match identifiers like `myWhen`/`somewhen`.
    if (i - 3 > 0) {
      const before = source[i - 4];
      if (/[A-Za-z0-9_]/.test(before)) {
        return false;
      }
    }
    return true;
  }

  // Checks whether the context-dependent keyword ending at endOffset is being used as an
  // ordinary identifier rather than a block opener. The following same-line forms qualify:
  //   1. Method-call receiver `KEYWORD.method` — a single `.` (not a range `..`/`...`).
  //   2. Assignment / `=`-led operator `KEYWORD = expr`, `KEYWORD == ...`, `KEYWORD =~ ...`,
  //      `KEYWORD => ...`.
  //   3. Compound assignment `KEYWORD += / -= / *= / /= / %= / <<= / >>= / &= / |= / ^=`.
  //   4. Function-call form `KEYWORD(args)`, indexed access `KEYWORD[idx]`, or block-arg
  //      syntax `KEYWORD|x|`.
  //   5. Binary operator / separator / expression terminator: `,`, `<`, `>`, `+`, `-`, `*`,
  //      `%`, `?`, `:`, `)`, `}`, `]`. Any of these immediately after the keyword means the
  //      keyword is the left operand of a binary expression, a hash/tuple element, or sits
  //      inside an expression that has just ended — never an opener position.
  // Spaces and tabs between the keyword and the following symbol are permitted, but newlines
  // are not crossed: a keyword alone on its line (e.g. `enum\n  Red`, `struct Point`) keeps
  // its block role because real openers are followed by a name/newline, never by any of the
  // symbols above on the same line. Excluded regions are skipped. Used to suppress the seven
  // receiver-like openers (`select`, `union`, `enum`, `struct`, `lib`, `macro`, `annotation`)
  // when used as values.
  private isReceiverOrAssignmentUsage(source: string, endOffset: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = endOffset;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      break;
    }
    if (i >= source.length) {
      return false;
    }
    const ch = source[i];
    // Method-call receiver: a single dot, not a range operator (`..`/`...`).
    if (ch === '.' && source[i + 1] !== '.') {
      return true;
    }
    // Value usage with `=`-led operator: assignment (`=`), comparison (`==`, `===`,
    // `=~`), or hash rocket (`=>`). In every case the keyword is the left-hand
    // operand and is being used as a value, not opening a block. Real opener forms
    // (`enum Color`, `struct Point`, `lib LibFoo`, ...) are followed by a type name
    // or newline, never by `=`-led punctuation on the same line.
    if (ch === '=') {
      return true;
    }
    // Function-call form: `KEYWORD(args)`. Real opener forms never take parens
    // (`enum Color`, `struct Point`, `lib LibFoo`, `macro name`, `annotation A`,
    // `union U`, `select` without arguments), so a `(` here always means the
    // keyword is being called as a method/function.
    if (ch === '(') {
      return true;
    }
    // Indexed access: `KEYWORD[idx]`. Real opener forms never take a `[` (they
    // require an uppercase type name or a body block), so a `[` here always
    // means the keyword is being used as a value (e.g. `x = select[0]`).
    if (ch === '[') {
      return true;
    }
    // Bitwise-or / block-argument syntax: `KEYWORD|x|` or `KEYWORD | x`. Real
    // opener forms never use `|` directly after the keyword; the keyword is a
    // value (e.g. `x = enum | x` or method-call block args `enum |x| ...`).
    if (ch === '|') {
      return true;
    }
    // Separators, expression terminators, and binary operators. Real opener forms
    // never have any of these directly after the keyword on the same line — the
    // opener is always followed by a type name or newline. Any of these here means
    // the keyword is being used as a value:
    //   - `,`         — hash/tuple/argument separator (e.g. `{default: enum, ...}`)
    //   - `)` `}` `]` — closes an enclosing expression (e.g. `(enum)`, `[enum]`)
    //   - `<` `>`     — comparison operator (e.g. `struct < 5`, `enum > 5`)
    //   - `+` `-` `*` `%` — binary arithmetic operator (e.g. `enum + 1`).
    //     `/` is also a binary operator, but it can also start a Crystal regex
    //     literal (excluded region) which is already skipped above; the bare `/`
    //     remaining here is always division so it is included.
    //   - `&` `^` — bitwise / logical-and / bitwise-xor operator (e.g. `enum & 1`,
    //     `enum && 1`, `enum ^ 1`). These also subsume compound assignments
    //     `&=`, `^=` since the leading operator alone disqualifies the opener
    //     position. `|` is already handled above (block-arg / bitwise-or).
    //   - `?` — ternary condition (e.g. `struct ? 1 : 2`)
    //   - `:` — type annotation or ternary alternative
    // Compound assignment forms `+=`, `-=`, `*=`, `/=`, `%=`, `<<=`, `>>=`, `&=`,
    // `|=`, `^=` are subsumed: the leading operator (e.g. `+`) matches above, but
    // for completeness the helper also accepts the bare operator regardless of
    // whether `=` follows because the operator alone is sufficient to disqualify
    // the opener position.
    if (
      ch === ',' ||
      ch === ')' ||
      ch === '}' ||
      ch === ']' ||
      ch === '<' ||
      ch === '>' ||
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '%' ||
      ch === '&' ||
      ch === '^' ||
      ch === '?' ||
      ch === ':'
    ) {
      return true;
    }
    return false;
  }

  // Checks if `end` at position sits in either value position of a ternary
  // expression: the first value (`cond ? end : a`) or the second value
  // (`cond ? a : end`). Either form is invalid because `end` is a reserved
  // word and cannot be a value. The result must not be tokenized as
  // block_close.
  //
  // First-value form: the character immediately before `end` is a `?` that is
  // the ternary operator (not a char-literal start — char literals are already
  // excluded regions, so a bare `?` surviving the scan is the ternary).
  //
  // Second-value form: the character immediately before `end` is a `:` that is
  // a standalone ternary colon (whitespace before, not part of `::`, not a
  // `label:`/symbol colon) with a matching ternary `?` earlier on the same line.
  private isEndInTernaryValuePosition(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Scan back from `end`, skipping whitespace and excluded regions
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
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0) {
      return false;
    }
    // First-value form: `end` immediately follows the ternary `?`. A `?` here
    // is the ternary operator, not a char literal: char literals are excluded
    // regions (handled by `tryMatchExcludedRegion`) and are skipped above.
    if (source[i] === '?') {
      return true;
    }
    // Second-value form: `end` immediately follows the ternary `:`. The
    // character immediately before `end` must be a colon.
    if (source[i] !== ':') {
      return false;
    }
    // Reject scope resolution `::` (colon adjacent to another colon on either side)
    if (source[i - 1] === ':' || source[i + 1] === ':') {
      return false;
    }
    // A ternary colon is whitespace-surrounded; a `label:`/symbol colon is glued to
    // its identifier. Require whitespace immediately before the colon.
    const beforeColon = source[i - 1];
    if (beforeColon === undefined || !(beforeColon === ' ' || beforeColon === '\t')) {
      return false;
    }
    // Look for a matching ternary `?` earlier on the same line (stop at newline,
    // statement separator `;`, or start of source). Skip excluded regions so that
    // `?x` character literals and `?` inside strings/comments are ignored.
    for (let j = i - 1; j >= 0; j--) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start;
          continue;
        }
      }
      const ch = source[j];
      if (ch === '\n' || ch === '\r' || ch === ';') {
        return false;
      }
      if (ch === '?') {
        return true;
      }
    }
    return false;
  }

  // Stack-based pairing that mirrors the base algorithm, but only attaches an
  // intermediate keyword to the current block when the keyword is valid for
  // that block's opener (e.g. `rescue` belongs to begin/def/do, not class).
  // An intermediate that does not fit the enclosing opener is a stray keyword
  // (invalid syntax) and is left as an orphan rather than mis-attributed.
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle': {
          if (stack.length === 0) {
            break;
          }
          const opener = stack[stack.length - 1].token.value;
          const validOpeners = INTERMEDIATE_TO_OPENERS.get(token.value);
          if (validOpeners && !validOpeners.has(opener)) {
            break;
          }
          stack[stack.length - 1].intermediates.push(token);
          break;
        }

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

  // Matches regex literal with #{} interpolation
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchRegexLiteral(
      source,
      pos,
      REGEX_FLAGS_PATTERN,
      (s, p) => skipRegexInterpolationShared(s, p, this.interpolationHandlers, heredocState),
      false,
      heredocState
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Checks if slash is regex start (not division)
  private isRegexStart(source: string, pos: number): boolean {
    return isRegexStart(source, pos, REGEX_PRECEDING_KEYWORDS, this._lastExcludedRegion ?? undefined, METHOD_LIKE_REGEX_KEYWORDS);
  }

  // Checks if % at position is a modulo operator (not a percent literal)
  private isModuloOperator(source: string, pos: number): boolean {
    if (pos === 0) return false;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    if (!/[a-zA-Z0-9_)\]}"'`/]/.test(source[i])) return false;
    // %<type><delimiter> is always a percent literal, even after identifiers
    // e.g. puts %w[a b], raise %q{error}
    const next = pos + 1;
    if (next < source.length && /[qQwWiIrx]/.test(source[next]) && next + 1 < source.length && /[^a-zA-Z0-9_ \t]/.test(source[next + 1])) {
      return false;
    }
    // %<paired_delimiter> without specifier is a percent literal, not modulo
    // e.g. puts %{text}, raise %(message)
    if (next < source.length && '({[<'.includes(source[next])) {
      return false;
    }
    // %= is always compound assignment, not a percent literal
    if (next < source.length && source[next] === '=') {
      return true;
    }
    // Non-paired delimiter without specifier is also a percent literal
    // e.g. puts %|text|, %~text~
    // Exclude %% (double percent) — treat the first % as modulo to avoid
    // consuming the rest of the source as an unterminated percent literal.
    if (next < source.length && source[next] !== '%' && /[^a-zA-Z0-9_ \t\r\n]/.test(source[next])) {
      return false;
    }
    return true;
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchPercentLiteral(source, pos, PERCENT_SPECIFIERS_PATTERN, isCrystalInterpolatingPercent, (s, p) =>
      skipInterpolationShared(s, p, this.interpolationHandlers, heredocState)
    );
    if (result && heredocState.pendingEnd > result.end) {
      return { end: heredocState.pendingEnd };
    }
    return result;
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchInterpolatedString(
      source,
      pos,
      (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState),
      heredocState
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  private get interpolationHandlers(): InterpolationHandlers {
    return {
      skipNestedString: (s, p) => this.skipNestedString(s, p),
      skipNestedBacktickString: (s, p) => this.skipNestedBacktickString(s, p),
      skipNestedRegex: (s, p) => this.skipNestedRegex(s, p),
      matchPercentLiteral: (s, p) => this.matchPercentLiteral(s, p),
      isModuloOperator: (s, p) => this.isModuloOperator(s, p),
      matchHeredoc: (s, p) => matchHeredoc(s, p)
    };
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    return skipInterpolationShared(source, pos, this.interpolationHandlers);
  }

  // Skips a regex literal inside interpolation
  private skipNestedRegex(source: string, pos: number): number {
    return skipNestedRegex(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a nested string inside interpolation
  private skipNestedString(source: string, pos: number): number {
    return skipNestedString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a backtick string inside interpolation (supports #{} interpolation)
  private skipNestedBacktickString(source: string, pos: number): number {
    return skipNestedBacktickString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Matches backtick command string with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchBacktickString(source, pos, (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState));
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Returns true when the token at `position` immediately follows the keyword `def`
  // (with spaces/tabs and backslash line continuations between). Used to filter
  // keywords used as method names (e.g., `def end`, `def class`, `def begin`,
  // including `def \<NL> end`).
  private isAfterDefKeyword(source: string, position: number): boolean {
    let i = position - 1;
    i = this.skipBackwardsWhitespaceAndContinuations(source, i);
    if (i >= 2 && source.slice(i - 2, i + 1) === 'def') {
      const defStart = i - 2;
      return defStart === 0 || !/[a-zA-Z0-9_]/.test(source[defStart - 1]);
    }
    return false;
  }

  // Returns true when the token at `position` immediately follows the property-declaration
  // macro identifiers (`property`, `getter`, `setter`, and bang/question variants) with
  // at most spaces/tabs between. These macros take a name (and optional `: Type = default`)
  // as their first argument, so any block keyword in that slot is a property name and must
  // not be tokenized. Only triggers when the identifier follows `property end` style with
  // a `:`, `=`, `,`, or newline after the keyword to avoid breaking unrelated expressions.
  // Skip spaces, tabs, and backslash line continuations (\<LF>, \<CR>, \<CRLF>) walking
  // backwards from `i`. Returns the index of the first non-whitespace, non-continuation
  // character, or -1 if the scan hits the start of the source.
  private skipBackwardsWhitespaceAndContinuations(source: string, i: number): number {
    let pos = i;
    while (pos >= 0) {
      if (source[pos] === ' ' || source[pos] === '\t') {
        pos--;
        continue;
      }
      // Detect backslash line continuation: `\<LF>`, `\<CR>`, or `\<CRLF>` immediately
      // before the current position. The newline may be CRLF (2 chars) or single LF/CR.
      // Walk back across the newline, then check for `\` before it.
      const nlEnd = pos;
      let nlStart = -1;
      if (source[nlEnd] === '\n') {
        if (nlEnd > 0 && source[nlEnd - 1] === '\r') {
          nlStart = nlEnd - 1;
        } else {
          nlStart = nlEnd;
        }
      } else if (source[nlEnd] === '\r') {
        nlStart = nlEnd;
      }
      if (nlStart >= 0 && nlStart > 0 && source[nlStart - 1] === '\\') {
        pos = nlStart - 2;
        continue;
      }
      break;
    }
    return pos;
  }

  private isAfterPropertyMacro(source: string, position: number, endOffset: number): boolean {
    let i = position - 1;
    i = this.skipBackwardsWhitespaceAndContinuations(source, i);
    // Walk back across comma-separated identifier chains (e.g., `property foo, bar, end`).
    // For each preceding `, <identifier>` segment, skip the comma and the identifier so the
    // scan ultimately lands on the macro identifier itself.
    while (i >= 0 && source[i] === ',') {
      i--;
      i = this.skipBackwardsWhitespaceAndContinuations(source, i);
      if (i < 0) return false;
      // Allow trailing ! or ? on identifier names
      if (source[i] === '!' || source[i] === '?') i--;
      // Skip identifier characters
      while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
      i = this.skipBackwardsWhitespaceAndContinuations(source, i);
    }
    if (i < 0) return false;
    // Allow trailing ! or ? on the macro identifier (property!, getter?)
    if (source[i] === '!' || source[i] === '?') i--;
    // Walk back to start of identifier
    const identEnd = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const identStart = i + 1;
    const ident = source.slice(identStart, identEnd);
    if (
      ident !== 'property' &&
      ident !== 'getter' &&
      ident !== 'setter' &&
      ident !== 'class_property' &&
      ident !== 'class_getter' &&
      ident !== 'class_setter'
    )
      return false;
    // Macro identifier must be at start of statement: preceded by line start, semicolon,
    // or whitespace following one of those. Reject method calls like `obj.property`.
    if (identStart > 0) {
      const prevChar = source[identStart - 1];
      if (prevChar === '.' || prevChar === ':' || prevChar === '@' || prevChar === '$') return false;
    }
    // Confirm this is a declaration form: name should be followed by `:`, `=`, `,`, or end of line.
    let j = endOffset;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length) return true;
    const next = source[j];
    return next === ':' || next === '=' || next === ',' || next === '\n' || next === '\r';
  }

  // Validates block open keywords, excluding postfix conditionals and loop do
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj.begin)
    // But NOT range operators (.., ...) - those end with '.' but are not method calls
    if (position > 0 && source[position - 1] === '.') {
      if (position < 2 || source[position - 2] !== '.') {
        return false;
      }
    }

    // Reject context-dependent keywords used as ordinary identifiers: method-call
    // receivers (`select.upcase`, `enum.foo`) or assignment targets (`select = "x"`).
    // In both forms the keyword is a value/variable, not a block opener.
    if (RECEIVER_LIKE_OPENERS.has(keyword) && this.isReceiverOrAssignmentUsage(source, position + keyword.length, excludedRegions)) {
      return false;
    }

    // Reject receiver-like keywords used as case/when branch values (`when enum\n ...`).
    // In this position the keyword is a constant/value expression, not a block opener.
    // Real opener forms (`enum Color`, `struct Point`) never appear in this position
    // because `when` introduces a pattern/value expression, not a block.
    if (RECEIVER_LIKE_OPENERS.has(keyword) && this.isPrecededByWhen(source, position, excludedRegions)) {
      return false;
    }

    // 'do' as loop separator (while/until/for condition do) is not a block
    if (keyword === 'do') {
      return !isLoopDo(source, position, excludedRegions);
    }

    // 'abstract def' has no body and no 'end'.
    // Allow backslash line continuation (\<LF>, \<CRLF>, \<CR>) between `abstract` and `def`.
    // Only suppress when the matched `abstract` keyword is real code: an `abstract`
    // appearing inside a comment or string ending with a trailing backslash (e.g.
    // `# abstract \`) must not suppress the genuine `def` on the following line.
    if (keyword === 'def') {
      const textBefore = source.slice(0, position);
      const abstractMatch = ABSTRACT_DEF_PATTERN.exec(textBefore);
      if (abstractMatch && !this.isInExcludedRegion(abstractMatch.index, excludedRegions)) {
        return false;
      }
      // Crystal 1.0+ shorthand: `def name [(args)] [: type] = expr` — no body, no end
      if (this.hasShorthandDefAssignment(source, position + 3, excludedRegions)) {
        return false;
      }
    }

    // if, unless, while, until can be postfix conditionals in Crystal
    if (!['if', 'unless', 'while', 'until'].includes(keyword)) {
      return true;
    }

    return !isPostfixConditional(source, position, excludedRegions);
  }

  // Detect Crystal shorthand method definition: `def name = expr` (no end keyword needed)
  // Looks for a standalone `=` (preceded by whitespace) outside of parens, on the def line.
  // Multi-line argument lists are allowed (newlines inside parens do not terminate the scan).
  // After the method name, the next non-whitespace token must be `(`, `:`, or `=`.
  // A bare identifier there indicates a no-paren parameter list like `def foo x = 1`,
  // in which case any `=` that follows is a default value, NOT the shorthand assignment.
  private hasShorthandDefAssignment(source: string, startPos: number, excludedRegions: ExcludedRegion[]): boolean {
    // Step 1: skip whitespace after `def`, then skip the method name itself.
    let i = startPos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Skip the method name: identifier chars, optionally ending with `?`, `!`, or `=`.
    while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
      i++;
    }
    if (i < source.length && (source[i] === '?' || source[i] === '!' || source[i] === '=')) {
      // Trailing `=` is part of a setter method name (e.g. `def foo=(value)`).
      // Since we just consumed identifier chars without whitespace, this `=` is attached.
      i++;
    }
    // Step 2: skip whitespace and peek at the next non-whitespace char.
    // A backslash line continuation may bridge to the next line.
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }
      if (ch === '\\' && i + 1 < source.length && (source[i + 1] === '\n' || source[i + 1] === '\r')) {
        i++;
        if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        continue;
      }
      break;
    }
    if (i >= source.length) {
      return false;
    }
    const afterName = source[i];
    // If the next token after the method name is an identifier-start char, this is a
    // no-paren parameter list (`def foo x = 1`). Not a shorthand assignment.
    if (/[A-Za-z_]/.test(afterName)) {
      return false;
    }
    // Otherwise scan for a standalone `=` outside of parens.
    let parenDepth = 0;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const c = source[i];
      // Backslash line continuation: skip backslash + the following newline
      if (c === '\\' && i + 1 < source.length && (source[i + 1] === '\n' || source[i + 1] === '\r')) {
        i++;
        if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        continue;
      }
      // Newline or semicolon outside of parens terminates the def header.
      // A `;` ends the def signature; anything after it is the body, so a
      // `=` there (e.g. `def foo; x = 1; end`) is an assignment, not the
      // Crystal 1.0 shorthand `def foo = expr`. Semicolons inside excluded
      // regions (strings, comments) are already skipped above.
      if (parenDepth === 0 && (c === '\n' || c === '\r' || c === ';')) {
        return false;
      }
      if (c === '#') {
        return false;
      }
      if (c === '(' || c === '[' || c === '{') {
        parenDepth++;
      } else if (c === ')' || c === ']' || c === '}') {
        parenDepth--;
      } else if (c === '=' && parenDepth === 0) {
        const next = i + 1 < source.length ? source[i + 1] : '';
        if (next === '=' || next === '~' || next === '>') {
          i += 2;
          continue;
        }
        const prev = i > 0 ? source[i - 1] : '';
        if (prev === ' ' || prev === '\t') {
          return true;
        }
      }
      i++;
    }
    return false;
  }
}
