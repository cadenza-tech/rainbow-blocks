// Elixir block parser: handles sigils, do: one-liners, keyword arguments, and atoms

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  type InterpolationScanHandlers,
  isAtomStart,
  matchAtomLiteral,
  matchElixirCharlist,
  matchElixirString,
  matchOperatorAtom,
  matchSigil,
  matchTripleQuotedString,
  skipInterpolationIterative
} from './elixirHelpers';

// Definition keywords that should not be treated as block opens after '..' range operator.
// Note: fn and quote are excluded because they are value-producing expression keywords
// (e.g., 1..fn -> 1 end and 1..quote do :a end remain valid block expressions).
const DEFINITION_KEYWORDS = new Set(['def', 'defp', 'defmodule', 'defmacro', 'defmacrop', 'defguard', 'defguardp', 'defprotocol', 'defimpl']);

// Leading characters of binary/expression operators. When a middle keyword (else/rescue/
// catch/after) is immediately followed (after whitespace) by one of these, it is an operand
// in an expression (e.g. `after <> y`, `else != x`), not a try/if/receive branch. `=` is
// handled separately (assignment vs `==`/`=>`/`=~`); `.` is handled separately (field access
// vs `..` range).
const EXPRESSION_OPERATOR_LEAD_CHARS = new Set(['+', '-', '*', '/', '<', '>', '|', '^', '&', '~']);

// Which middle keywords each opener accepts. A middle keyword (else/rescue/catch/after)
// belongs to the enclosing opener only if that opener actually has that branch:
//   if/unless -> else
//   try       -> rescue/catch/after/else
//   receive   -> after
//   with      -> else
// All other openers (case/cond/fn/quote/for and the def-family/defmodule definition
// keywords) accept no middle keyword. When the opener on the stack top does not accept a
// middle keyword, that keyword is a stray identifier and is left orphaned (not attached as
// an intermediate), matching the best-effort "prefer unhighlighted over mis-highlighted"
// principle. Openers absent from this map accept nothing.
const MIDDLE_KEYWORDS_BY_OPENER: Readonly<Record<string, ReadonlySet<string>>> = {
  if: new Set(['else']),
  unless: new Set(['else']),
  try: new Set(['rescue', 'catch', 'after', 'else']),
  receive: new Set(['after']),
  with: new Set(['else'])
};

export class ElixirBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      // Function/module definitions
      'def',
      'defp',
      'defmodule',
      'defmacro',
      'defmacrop',
      'defguard',
      'defguardp',
      'defprotocol',
      'defimpl',
      // Control flow
      'if',
      'case',
      'cond',
      'unless',
      'for',
      'with',
      'try',
      'receive',
      // Anonymous function
      'fn',
      // Quote
      'quote'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'rescue', 'catch', 'after']
  };

  // Per-source memoization for isKeywordUsedAsValue. The result at a given position is a
  // pure function of `source` and the position (the keyword ending there is fixed), so it
  // can be cached for the duration of a single parse. The cache is keyed by source identity
  // and rebuilt whenever a different source is seen, so it never leaks across parse() calls.
  // Without this, chained block keywords on one line ("if for for ... do") make
  // hasDoKeyword/isDoColonOneLiner re-walk the chain O(N) times each, exploding to O(N^3).
  private valueMemoSource: string | null = null;
  private valueMemo = new Map<number, boolean>();

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];
    const skipInterpolationBound = this.skipInterpolation.bind(this);

    // Character literal: ?x, ?\escape, ?\xNN, ?\uNNNN, ?\u{NNNN}
    if (char === '?' && pos + 1 < source.length && (pos === 0 || !/[a-zA-Z0-9_]/.test(source[pos - 1]))) {
      const result = this.matchCharacterLiteral(source, pos);
      if (result) return result;
    }

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Triple-quoted heredoc (check before regular string)
    if (source.slice(pos, pos + 3) === '"""') {
      return matchTripleQuotedString(source, pos, '"""', skipInterpolationBound);
    }

    // Triple single-quoted heredoc
    if (source.slice(pos, pos + 3) === "'''") {
      return matchTripleQuotedString(source, pos, "'''", skipInterpolationBound);
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return matchElixirString(source, pos, skipInterpolationBound);
    }

    // Single-quoted charlist (with #{} interpolation support)
    if (char === "'") {
      return matchElixirCharlist(source, pos, skipInterpolationBound);
    }

    // Sigil (~r, ~s, ~w, etc) - must not be preceded by identifier characters
    // Exception: sigil modifiers (letters immediately after a sigil closing delimiter) are not identifiers
    if (char === '~' && pos + 1 < source.length && /[a-zA-Z]/.test(source[pos + 1])) {
      if (pos === 0 || !this.isPrecededByIdentifier(source, pos)) {
        const result = matchSigil(source, pos, skipInterpolationBound);
        if (result) return result;
      }
    }

    // Atom literal (letter/underscore/quote-prefixed)
    if (char === ':' && isAtomStart(source, pos)) {
      return matchAtomLiteral(source, pos, skipInterpolationBound);
    }

    // Operator atom (e.g., :+, :-, :==, :->) — must be tried after the letter-atom check
    // so that :foo isn't shadowed.
    if (char === ':') {
      const opAtom = matchOperatorAtom(source, pos);
      if (opAtom) return opAtom;
    }

    return null;
  }

  // Handlers giving the iterative interpolation scanner access to this parser's
  // character-literal and identifier-context logic without a `this` dependency.
  private get interpolationScanHandlers(): InterpolationScanHandlers {
    return {
      skipCharLiteral: (source, pos) => this.skipCharLiteral(source, pos),
      isPrecededByIdentifier: (source, pos) => this.isPrecededByIdentifier(source, pos)
    };
  }

  // Skips a #{} interpolation block (pos points just after the opening "#{"), returning
  // the position after the matching "}". Delegates to an iterative scanner that tracks
  // nested strings/sigils/interpolations on an explicit stack, so deeply nested
  // interpolation cannot overflow the JS call stack.
  private skipInterpolation(source: string, pos: number): number {
    return skipInterpolationIterative(source, pos, this.interpolationScanHandlers);
  }

  // Matches Elixir character literal: ?x, ?\escape, ?\xNN, ?\uNNNN, ?\u{NNNN}
  private matchCharacterLiteral(source: string, pos: number): ExcludedRegion | null {
    const end = this.skipCharLiteral(source, pos);
    if (end > pos) {
      return { start: pos, end };
    }
    return null;
  }

  // Returns the end position after a character literal at pos, or pos if not valid
  private skipCharLiteral(source: string, pos: number): number {
    if (pos + 1 >= source.length) return pos;
    const nextChar = source[pos + 1];
    // ?\<escape>
    if (nextChar === '\\') {
      if (pos + 2 >= source.length) return pos;
      const escChar = source[pos + 2];
      // ?\<newline> is not a valid character literal
      if (escChar === '\n' || escChar === '\r') return pos;
      // ?\xNN - hex escape (requires at least one hex digit)
      if (escChar === 'x') {
        let i = pos + 3;
        const startI = i;
        const limit = Math.min(i + 2, source.length);
        while (i < limit && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        return i === startI ? pos : i;
      }
      // ?\u{NNNN} or ?\uNNNN - unicode escape (requires at least one hex digit)
      if (escChar === 'u') {
        if (pos + 3 < source.length && source[pos + 3] === '{') {
          let i = pos + 4;
          const startI = i;
          while (i < source.length && /[0-9a-fA-F]/.test(source[i])) {
            i++;
          }
          if (i === startI) return pos;
          if (i < source.length && source[i] === '}') {
            i++;
          }
          return i;
        }
        let i = pos + 3;
        const startI = i;
        const limit = Math.min(i + 4, source.length);
        while (i < limit && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
        return i === startI ? pos : i;
      }
      // Basic escape: ?\n, ?\t, ?\\, ?\s, etc
      return pos + 3;
    }
    // ?<whitespace/newline> is not a character literal
    if (nextChar === '\n' || nextChar === '\r' || nextChar === ' ' || nextChar === '\t') return pos;
    // ?x where x is any printable character (handle surrogate pairs)
    const code = source.codePointAt(pos + 1);
    const charLen = code !== undefined && code > 0xffff ? 2 : 1;
    return pos + 1 + charLen;
  }

  // Validates block open keywords, excluding do: one-liners and keyword arguments
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject identifiers ending with ? or ! (e.g., fn?, if!, end?)
    const afterKeyword = source[position + keyword.length];
    if (afterKeyword === '?' || afterKeyword === '!') {
      return false;
    }

    // A block keyword that immediately follows a definition keyword (def/defp/defmacro/...)
    // is a function name being defined (e.g., `def unless(x) do ... end`), not a block opener.
    // The def..end pair must be produced; the inner keyword must not steal the `end`.
    if (this.isFunctionNameAfterDefinitionKeyword(source, position, excludedRegions)) {
      return false;
    }

    // Reject function call form with multiple args: keyword followed by '(' containing a comma
    // e.g., if(cond, do: val) is a function call, not a block
    // But allow parenthesized condition: if(true) do...end is a valid block
    if (afterKeyword === '(') {
      if (this.hasCommaInParens(source, position + keyword.length, excludedRegions)) {
        return false;
      }
    }

    // Check for keyword argument (e.g., if:)
    if (this.isKeywordArgument(source, position + keyword.length)) {
      return false;
    }

    // Reject definition keywords preceded by '..' range operator (e.g., 1..def)
    // Control flow keywords (if, case, etc.) are valid after '..' since they return values
    if (position >= 2 && source[position - 1] === '.' && source[position - 2] === '.' && DEFINITION_KEYWORDS.has(keyword)) {
      return false;
    }

    // fn-end doesn't use "do" — it always uses arrow syntax (fn pattern -> body end).
    // Reject fn(...) followed by `do` because that is invalid Elixir; treating it as a
    // block opener would greedily pair fn with end and orphan an outer block (e.g., the
    // outer if in `if fn() do ... end`). Allow the common case (fn / fn x / fn(x) -> ...).
    if (keyword === 'fn') {
      if (afterKeyword === '(' && this.isFnParensFollowedByDo(source, position + keyword.length, excludedRegions)) {
        return false;
      }
      // Reject `fn` used as a value/variable for a preceding block keyword
      // (e.g. `case fn do ... end` — fn is a value, do belongs to case). Detected only
      // when fn is directly followed by `do` (not `->`, which is real fn arrow syntax).
      if (this.isFnDirectlyFollowedByDoAfterBlockKw(source, position, excludedRegions)) {
        return false;
      }
      return true;
    }

    // Check if "do" exists for other keywords
    if (!this.hasDoKeyword(source, position + keyword.length, excludedRegions)) {
      return false;
    }

    // Check for do: one-liner pattern
    if (this.isDoColonOneLiner(keyword, source, position, excludedRegions)) {
      return false;
    }

    // Reject keyword used as a variable for a preceding block (e.g., "if cond do" - cond is a value, do belongs to if)
    if (this.isValueForPrecedingBlockKeyword(source, position, keyword, excludedRegions)) {
      return false;
    }

    return true;
  }

  // Returns true if a character literal (excluded region starting with '?') ends exactly
  // at `position`. Used to suppress keyword tokenization for the identifier continuation
  // right after a char literal (e.g. `?#end` produces ?# excluded region; `end` at the
  // boundary must not be tokenized as block_close).
  private isPrecededByCharLiteral(position: number, source: string, excludedRegions: ExcludedRegion[]): boolean {
    // Binary search would be ideal, but a linear scan suffices: excluded regions ending
    // exactly at `position` are rare and the list is small per source.
    for (const region of excludedRegions) {
      if (region.end === position && region.start < source.length && source[region.start] === '?') {
        return true;
      }
      if (region.start > position) break;
    }
    return false;
  }

  // Checks if `fn` at `position` is a value/variable for a preceding block keyword.
  // True only when fn is directly followed by `do` (after whitespace) AND preceded by a
  // do-block keyword on the same statement. `fn ->` (arrow syntax) is real fn and returns
  // false. Used by hasDoKeyword's fn tracking to suppress fnDepth++ when fn is a value
  // (e.g. `case fn do ... end` — fn is the case value, do belongs to case).
  private isFnDirectlyFollowedByDoAfterBlockKw(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Scan forward from after `fn`. Must find `do` with word boundary before any other token.
    let j = position + 2;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
    if (source.slice(j, j + 2) !== 'do') return false;
    const afterDo = source[j + 2];
    if (afterDo !== undefined && /[a-zA-Z0-9_]/.test(afterDo)) return false;
    // Must be preceded by a do-block keyword on the same statement (use existing helper).
    return this.isValueForPrecedingBlockKeyword(source, position, 'fn', excludedRegions);
  }

  // Checks if this keyword is being used as a variable/value for a preceding block keyword.
  // Pattern: "<outer_block_kw> <this_kw> do" - this_kw is a variable, do belongs to outer.
  private isValueForPrecedingBlockKeyword(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    // The keyword position must function as a value. Use the same broad detection as isKeywordUsedAsValue.
    if (!this.isKeywordUsedAsValue(source, position + keyword.length, keyword)) {
      return false;
    }

    // Scan backward for a preceding block keyword on the current statement
    let j = position - 1;
    while (j >= 0) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start - 1;
          continue;
        }
      }
      const ch = source[j];
      if (ch === ';' || ch === '\n' || ch === '\r') break;
      if (/[a-zA-Z_]/.test(ch)) {
        let wordStart = j;
        while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) wordStart--;
        const word = source.slice(wordStart, j + 1);
        if ((ElixirBlockParser.DO_BLOCK_KEYWORDS as readonly string[]).includes(word)) {
          return true;
        }
        j = wordStart - 1;
        continue;
      }
      j--;
    }
    return false;
  }

  // Matches blocks with the default LIFO algorithm, but only attaches a block_middle token
  // (else/rescue/catch/after) to the opener on the stack top when that opener actually
  // accepts it (see MIDDLE_KEYWORDS_BY_OPENER). The base implementation attaches any middle
  // keyword to whatever opener happens to be on top, which mis-attributes e.g. the stray
  // `else` in `fn x -> :a else :b end` to the fn block. Openers that accept no middle keyword
  // (fn/quote/case/cond/for and the def-family/defmodule keywords) leave the keyword orphaned.
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
            const opener = stack[stack.length - 1].token.value;
            const accepted = MIDDLE_KEYWORDS_BY_OPENER[opener];
            if (accepted?.has(token.value)) {
              stack[stack.length - 1].intermediates.push(token);
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

  // Filter out middle keywords followed by colon, preceded by dot, or preceded by @ (module attributes)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      // Reject Module.keyword but allow 1..keyword (range operator)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        if (token.startOffset < 2 || source[token.startOffset - 2] !== '.') {
          return false;
        }
      }
      // Module attributes use @ prefix; since @ is not a word character, \b matches between @ and keyword
      if (token.startOffset > 0 && source[token.startOffset - 1] === '@') {
        return false;
      }
      // Character literal prefix: ?end, ?else, etc. are character literals, not keywords
      if (token.startOffset > 0 && source[token.startOffset - 1] === '?') {
        return false;
      }
      // Character literal ending right before token: ?#end, ?(else, ?\\nend, etc.
      // The character literal is an excluded region; if it ends at token.startOffset and
      // starts with '?', the token is the identifier continuation after the literal and
      // must not be tokenized as a keyword (it is invalid Elixir but should not steal
      // block_close/middle pairing from surrounding blocks).
      if (token.startOffset > 0 && this.isPrecededByCharLiteral(token.startOffset, source, excludedRegions)) {
        return false;
      }
      // Sigil prefix: ~end, ~else, etc. are the start of a sigil that failed to find a
      // valid delimiter (e.g. ~end<newline>). In real Elixir source the sigil is invalid
      // syntax, but we must not let the trailing keyword (end/else/rescue/catch/after)
      // be tokenized as a block keyword, because that would mis-pair with surrounding
      // openers. The block_open path is already protected by isValidBlockOpen rejecting
      // keywords without a following `do`; this guard adds the symmetric protection for
      // block_close / block_middle. We only fire when `~` is *not* preceded by an
      // identifier (otherwise `~` would not be a sigil prefix anyway).
      if (token.startOffset > 0 && source[token.startOffset - 1] === '~' && !this.isPrecededByIdentifier(source, token.startOffset - 1)) {
        return false;
      }
      // Type spec operator :: prefix: keywords after :: are type names, not block keywords
      if (token.startOffset >= 2) {
        let bi = token.startOffset - 1;
        while (bi >= 0 && (source[bi] === ' ' || source[bi] === '\t')) {
          bi--;
        }
        if (bi >= 1 && source[bi] === ':' && source[bi - 1] === ':') {
          return false;
        }
      }
      // Capture operator prefix: &end, &fn, &else, etc. are function references, not keywords
      // But not the && operator (second & of &&)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '&' && (token.startOffset < 2 || source[token.startOffset - 2] !== '&')) {
        return false;
      }
      if (token.type === 'block_middle' && token.endOffset < source.length && source[token.endOffset] === ':') {
        return false;
      }
      // Reject middle keywords with ? or ! suffix (e.g., else?, catch!, after! are function names)
      if (token.type === 'block_middle' && token.endOffset < source.length) {
        const afterChar = source[token.endOffset];
        if (afterChar === '?' || afterChar === '!') {
          return false;
        }
      }
      // Reject middle keywords that are function names being defined after a definition
      // keyword (def/defp/defmacro/...). e.g. `def rescue do ... end` defines a function named
      // `rescue`; the rescue token is an identifier, not a try-block branch. Symmetric with
      // the block_open path handled by isFunctionNameAfterDefinitionKeyword via isValidBlockOpen.
      if (token.type === 'block_middle' && this.isFunctionNameAfterDefinitionKeyword(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Reject middle keywords preceded by '..' range operator (e.g., 1..else)
      if (token.type === 'block_middle' && token.startOffset >= 2 && source[token.startOffset - 1] === '.' && source[token.startOffset - 2] === '.') {
        return false;
      }
      // Reject middle keywords used as variable names: `after = 100`, `else = nil`,
      // `rescue = ...`. Match `=` not followed by `=`/`>`/`~` (i.e., not `==`/`=>`/`=~`).
      if (token.type === 'block_middle' && token.endOffset < source.length) {
        let p = token.endOffset;
        while (p < source.length && (source[p] === ' ' || source[p] === '\t')) p++;
        if (
          p < source.length &&
          source[p] === '=' &&
          (p + 1 >= source.length || (source[p + 1] !== '=' && source[p + 1] !== '>' && source[p + 1] !== '~'))
        ) {
          return false;
        }
      }
      // Reject middle keywords used as map keys: `%{else => 1}`, `%{rescue => 1}`, etc.
      // Pattern: <middle_keyword> followed by whitespace and `=>`.
      if (token.type === 'block_middle' && token.endOffset < source.length) {
        let p = token.endOffset;
        while (p < source.length && (source[p] === ' ' || source[p] === '\t')) p++;
        if (p + 1 < source.length && source[p] === '=' && source[p + 1] === '>') {
          return false;
        }
      }
      // Reject middle keywords used in an expression rather than as a branch: a function
      // call (`else(x)`), field access (`else.bar`), or operand of a binary operator
      // (`after <> y`). These are identifiers inside the body, not try/if/receive branches.
      // A genuine same-line branch is a clause `<keyword> <pattern> -> <body>`, so it is kept
      // whenever a clause-level `->` follows (this also preserves parenthesised patterns like
      // `else (err) ->`, binary patterns `else <<b>> ->`, and negative literals `else -1 ->`).
      // `..` (range) is excluded from the field-access check; the preceding-`..` rule handles
      // `1..else`.
      if (token.type === 'block_middle' && token.endOffset < source.length) {
        let p = token.endOffset;
        while (p < source.length && (source[p] === ' ' || source[p] === '\t')) p++;
        if (p < source.length) {
          const after = source[p];
          const isFunctionCall = after === '(';
          const isFieldAccess = after === '.' && (p + 1 >= source.length || source[p + 1] !== '.');
          // `=~` (match operator) leads with `=`, which is not in EXPRESSION_OPERATOR_LEAD_CHARS
          // and is intentionally skipped by the variable-assignment check above; treat it as a
          // binary operator operand here so `rescue =~ x` / `else =~ x` are not branch keywords
          const isOperatorOperand = EXPRESSION_OPERATOR_LEAD_CHARS.has(after) || (after === '=' && p + 1 < source.length && source[p + 1] === '~');
          if ((isFunctionCall || isFieldAccess || isOperatorOperand) && !this.isFollowedByClauseArrow(source, p, excludedRegions)) {
            return false;
          }
        }
      }
      return true;
    });
  }

  // Checks whether a clause-level `->` follows position `fromPos` before the current clause
  // head ends, i.e. whether a middle keyword here heads a real `<pattern> -> <body>` branch
  // (e.g. `else (err) ->`, `else <<b>> ->`) rather than being used in an expression
  // (e.g. `else(x)`, `else.bar`, `after <> y`). Scans forward tracking ()/[]/{} depth and
  // skipping excluded regions, returning true on a depth-0 `->` and false on a depth-0
  // newline / `;` / end of source first.
  private isFollowedByClauseArrow(source: string, fromPos: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = fromPos;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    while (i < source.length) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
      } else if (ch === '[') bracketDepth++;
      else if (ch === ']') {
        if (bracketDepth > 0) bracketDepth--;
      } else if (ch === '{') braceDepth++;
      else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      } else if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (ch === '-' && source[i + 1] === '>') {
          return true;
        }
        if (ch === '\n' || ch === '\r' || ch === ';') {
          return false;
        }
      }
      i++;
    }
    return false;
  }

  // Validates block close keywords, rejecting keyword arguments (e.g., end:) and ?/! suffixes (e.g., end?, end!)
  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    // Reject identifiers ending with ? or ! (e.g., end?, end!)
    const afterKeyword = source[position + keyword.length];
    if (afterKeyword === '?' || afterKeyword === '!') {
      return false;
    }

    if (this.isKeywordArgument(source, position + keyword.length)) {
      return false;
    }

    // Reject 'end' preceded by '..' range operator (e.g., 1..end)
    if (position >= 2 && source[position - 1] === '.' && source[position - 2] === '.') {
      return false;
    }

    // Reject 'end' that is being used as a parameter / argument identifier rather than
    // a block close (e.g., `def foo(end) do ... end`). 'end' is a parameter identifier
    // only when it sits as a complete comma-separated element: bordered on both sides
    // by `(`, `,`, `[`, or `{` / `)`, `,`, `]`, or `}` (whitespace allowed).
    if (keyword === 'end' && this.isEndAsParameterIdentifier(source, position)) {
      return false;
    }

    return true;
  }

  // Returns true when 'end' at `position` is a complete comma-separated element inside
  // brackets, e.g. `foo(end)`, `foo(a, end)`, `[end]`, `{end, a}`. In these positions
  // 'end' is being used as an identifier, not as a block close.
  private isEndAsParameterIdentifier(source: string, position: number): boolean {
    let beforePos = position - 1;
    while (beforePos >= 0 && (source[beforePos] === ' ' || source[beforePos] === '\t' || source[beforePos] === '\n' || source[beforePos] === '\r')) {
      beforePos--;
    }
    if (beforePos < 0) return false;
    const charBefore = source[beforePos];
    if (charBefore !== '(' && charBefore !== ',' && charBefore !== '[' && charBefore !== '{') {
      return false;
    }

    let afterPos = position + 3;
    while (
      afterPos < source.length &&
      (source[afterPos] === ' ' || source[afterPos] === '\t' || source[afterPos] === '\n' || source[afterPos] === '\r')
    ) {
      afterPos++;
    }
    if (afterPos >= source.length) return false;
    const charAfter = source[afterPos];
    return charAfter === ')' || charAfter === ',' || charAfter === ']' || charAfter === '}';
  }

  // Checks if position is followed by colon (keyword argument syntax)
  private isKeywordArgument(source: string, position: number): boolean {
    return position < source.length && source[position] === ':';
  }

  // Block keywords that take "do" (excludes "fn")
  private static readonly DO_BLOCK_KEYWORDS = [
    'defmodule',
    'defprotocol',
    'defimpl',
    'defmacrop',
    'defmacro',
    'defguardp',
    'defguard',
    'defp',
    'def',
    'unless',
    'receive',
    'quote',
    'with',
    'cond',
    'case',
    'for',
    'try',
    'if'
  ];

  // Checks if "do" keyword exists after position (not inside parentheses)
  // Stops when too many newlines are encountered
  // Tracks inner block keywords (do: one-liners and do...end blocks) to skip them
  private hasDoKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let fnDepth = 0;
    let innerBlockDepth = 0;
    let newlineCount = 0;

    while (i < source.length) {
      // Skip to end of excluded region if inside one (using binary search)
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      const char = source[i];

      // Track parentheses depth. Clamp depths at 0 on closers so unbalanced source
      // (e.g., a stray `)` from a typo) does not push depth negative and break the
      // depth==0 checks that guard "do" detection.
      if (char === '(') {
        parenDepth++;
      } else if (char === ')') {
        if (parenDepth > 0) parenDepth--;
      } else if (char === '[') {
        bracketDepth++;
      } else if (char === ']') {
        if (bracketDepth > 0) bracketDepth--;
      } else if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        if (braceDepth > 0) braceDepth--;
      }

      // Count newlines outside all brackets; stop after 5 lines
      // Handle \n, \r\n, and \r-only line endings
      if (
        (char === '\n' || (char === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n'))) &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        newlineCount++;
        if (newlineCount > 5) {
          return false;
        }
      }

      // Only look for "do" outside all brackets
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        // Check for "do" with word boundary
        if (
          i > 0 &&
          (/\s/.test(source[i - 1]) || source[i - 1] === ',' || source[i - 1] === ')' || source[i - 1] === ']' || source[i - 1] === '}') &&
          source.slice(i, i + 2) === 'do'
        ) {
          const afterDo = source[i + 2];
          // do: is keyword syntax (one-liner) - decrements inner block depth
          if (afterDo === ':') {
            if (innerBlockDepth > 0) {
              innerBlockDepth--;
            }
            i++;
            continue;
          }
          if (afterDo === undefined || /[\s\n]/.test(afterDo) || afterDo === ';' || afterDo === '#') {
            if (innerBlockDepth === 0 && fnDepth === 0) {
              return true;
            }
          }
        }

        // Check for ", do" pattern
        if (source.slice(i, i + 4) === ', do') {
          const afterDo = source[i + 4];
          if (afterDo === ':') {
            if (innerBlockDepth > 0) {
              innerBlockDepth--;
            }
            // Skip past ", do:" to prevent the "do" from being re-matched by the whitespace+do check
            i += 4;
            continue;
          }
          if (afterDo === undefined || /[\s\n]/.test(afterDo) || afterDo === ';' || afterDo === '#') {
            if (innerBlockDepth === 0 && fnDepth === 0) {
              return true;
            }
          }
        }

        // Track inner block keywords (their do/do: will be handled above)
        // Skip function call pattern: keyword followed by '(' (e.g., if(cond, do: val))
        // because do: inside parens won't be seen at depth 0 to decrement innerBlockDepth
        // Skip value form: "if cond do" where cond is a variable name that happens to be a keyword
        // Skip function-name form: a block keyword right after a definition keyword
        // (e.g., the `cond` in `def cond x do`) is the function name, not an inner block.
        if (
          this.isBlockKeywordAt(source, i) &&
          !this.isBlockKeywordFunctionCall(source, i) &&
          !this.isFunctionNameAfterDefinitionKeyword(source, i, excludedRegions)
        ) {
          let kwLen = 0;
          let kwName = '';
          for (const kw of ElixirBlockParser.DO_BLOCK_KEYWORDS) {
            if (source.startsWith(kw, i)) {
              kwLen = kw.length;
              kwName = kw;
              break;
            }
          }
          if (kwLen > 0 && !this.isKeywordUsedAsValue(source, i + kwLen, kwName)) {
            innerBlockDepth++;
          }
        }

        // Track fn...end nesting at depth 0
        // Exclude fn: (keyword argument syntax), .fn (method call), @fn (module attribute), fn() (function call)
        // Also exclude fn used as a value/variable for a preceding block keyword
        // (e.g., `case fn do ... end` — fn is the case value, do belongs to case).
        // Detected only when fn is directly followed by `do` (not `->`, which is real fn syntax).
        // Also exclude `fn` used as the function name after a definition keyword
        // (e.g., `def fn do ... end` — fn is the function name, not anonymous fn keyword).
        if (
          source.slice(i, i + 2) === 'fn' &&
          (i === 0 ||
            (!/[a-zA-Z0-9_]/.test(source[i - 1]) &&
              source[i - 1] !== '.' &&
              source[i - 1] !== '@' &&
              !(source[i - 1] === '&' && (i < 2 || source[i - 2] !== '&')))) &&
          (i + 2 >= source.length || (!/[a-zA-Z0-9_:?!]/.test(source[i + 2]) && source[i + 2] !== '(')) &&
          !this.isAdjacentToUnicodeLetter(source, i, 2) &&
          !this.isFnDirectlyFollowedByDoAfterBlockKw(source, i, excludedRegions) &&
          !this.isFunctionNameAfterDefinitionKeyword(source, i, excludedRegions)
        ) {
          fnDepth++;
        }

        // "end" closes inner blocks or fn
        // Exclude .end (method call), @end (module attribute)
        if (source.slice(i, i + 3) === 'end') {
          const beforeEnd = i > 0 ? source[i - 1] : ' ';
          const afterEnd = source[i + 3];
          if (
            !/[a-zA-Z0-9_]/.test(beforeEnd) &&
            beforeEnd !== '.' &&
            beforeEnd !== '@' &&
            !(beforeEnd === '&' && (i < 2 || source[i - 2] !== '&')) &&
            (afterEnd === undefined || !/[a-zA-Z0-9_:?!]/.test(afterEnd)) &&
            !this.isAdjacentToUnicodeLetter(source, i, 3)
          ) {
            if (fnDepth > 0) {
              fnDepth--;
            } else if (innerBlockDepth > 0) {
              innerBlockDepth--;
            } else {
              return false;
            }
          }
        }
      }

      i++;
    }
    return false;
  }

  // Checks if a block keyword that takes "do" starts at position
  private isBlockKeywordAt(source: string, pos: number): boolean {
    // Must have word boundary before (also reject . and @ prefixes)
    if (pos > 0) {
      const before = source[pos - 1];
      if (/[a-zA-Z0-9_]/.test(before) || before === '.' || before === '@' || (before === '&' && (pos < 2 || source[pos - 2] !== '&'))) {
        return false;
      }
      // Handle surrogate pairs: low surrogate preceded by high surrogate
      if (pos >= 2 && before >= '\uDC00' && before <= '\uDFFF') {
        const cp = source.codePointAt(pos - 2);
        if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) return false;
      } else if (/\p{L}/u.test(before)) {
        return false;
      }
    }

    for (const kw of ElixirBlockParser.DO_BLOCK_KEYWORDS) {
      if (source.startsWith(kw, pos)) {
        const afterPos = pos + kw.length;
        const afterKw = source[afterPos];
        // Must have word boundary after, and not be a keyword argument (e.g. for:)
        if (afterKw === undefined || (!/[a-zA-Z0-9_]/.test(afterKw) && afterKw !== ':' && afterKw !== '?' && afterKw !== '!')) {
          // Check Unicode letter after keyword (handle surrogate pairs)
          if (afterKw !== undefined && !/[a-zA-Z0-9_:?!]/.test(afterKw)) {
            if (afterKw >= '\uD800' && afterKw <= '\uDBFF' && afterPos + 1 < source.length) {
              const cp = source.codePointAt(afterPos);
              if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) return false;
            } else if (/\p{L}/u.test(afterKw)) {
              return false;
            }
          }
          return true;
        }
      }
    }

    return false;
  }

  // Checks if the parentheses starting at pos contain a comma at depth 0
  // Used to distinguish function call form if(cond, do: val) from block form if(true).
  // Tracks (), {}, [] depths independently so commas inside map/list/tuple literals
  // inside the condition (e.g. if(%{a: 1, b: 2}) do) are not mistaken for argument
  // separators. Tracks fn-end nesting so commas inside fn parameter lists (e.g.
  // if(fn x, y -> ... end) do) are not counted either. Skips excluded regions.
  private hasCommaInParens(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    if (pos >= source.length || source[pos] !== '(') return false;
    let parenDepth = 1;
    let braceDepth = 0;
    let bracketDepth = 0;
    let fnDepth = 0;
    let i = pos + 1;
    while (i < source.length && parenDepth > 0) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      // Track fn-end nesting so commas inside fn parameter lists don't count.
      // fn must be a standalone keyword: not preceded by identifier chars, ., @, or
      // single &, and not followed by identifier-continuation chars or '('.
      if (
        source.slice(i, i + 2) === 'fn' &&
        (i === 0 ||
          (!/[a-zA-Z0-9_]/.test(source[i - 1]) &&
            source[i - 1] !== '.' &&
            source[i - 1] !== '@' &&
            !(source[i - 1] === '&' && (i < 2 || source[i - 2] !== '&')))) &&
        (i + 2 >= source.length || (!/[a-zA-Z0-9_:?!]/.test(source[i + 2]) && source[i + 2] !== '(')) &&
        !this.isAdjacentToUnicodeLetter(source, i, 2)
      ) {
        fnDepth++;
        i += 2;
        continue;
      }
      // 'end' closes a tracked fn nest; only consume when actually closing one.
      if (fnDepth > 0 && source.slice(i, i + 3) === 'end') {
        const beforeEnd = i > 0 ? source[i - 1] : ' ';
        const afterEnd = source[i + 3];
        if (
          !/[a-zA-Z0-9_]/.test(beforeEnd) &&
          beforeEnd !== '.' &&
          beforeEnd !== '@' &&
          !(beforeEnd === '&' && (i < 2 || source[i - 2] !== '&')) &&
          (afterEnd === undefined || !/[a-zA-Z0-9_:?!]/.test(afterEnd)) &&
          !this.isAdjacentToUnicodeLetter(source, i, 3)
        ) {
          fnDepth--;
          i += 3;
          continue;
        }
      }
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (parenDepth === 1 && braceDepth === 0 && bracketDepth === 0 && fnDepth === 0 && ch === ',') return true;
      i++;
    }
    return false;
  }

  // Checks if a fn(...) parameter list is immediately followed by `do` rather than `->`.
  // In Elixir, `fn` always uses arrow syntax (fn pattern -> body end) and never `do`.
  // The form `fn(...) do` is invalid Elixir; treating fn as a block opener in this case
  // would greedily pair fn with end and orphan the outer block (e.g. `if fn() do ... end`
  // should pair if/end, not fn/end).
  // pos must point at the '(' immediately after `fn`. Returns true only when a balanced
  // `(...)` is found and the next non-whitespace token is `do` (with word boundary).
  private isFnParensFollowedByDo(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    if (pos >= source.length || source[pos] !== '(') return false;
    let parenDepth = 1;
    let i = pos + 1;
    while (i < source.length && parenDepth > 0) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      i++;
    }
    if (parenDepth !== 0) return false;
    // i now points just past the matching ')'. Skip whitespace, newlines, and comments
    // (excluded regions). Newlines must be skipped because `fn(x)\ndo` is still
    // syntactically `fn(x) do` continuation in Elixir.
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      // Skip single-line comments (#... to end of line)
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      break;
    }
    // Check for `do` followed by a word boundary (so `done`/`do_x`/etc. don't match).
    if (source.slice(i, i + 2) !== 'do') return false;
    const afterDo = source[i + 2];
    return afterDo === undefined || !/[a-zA-Z0-9_?!]/.test(afterDo);
  }

  // Checks if a block keyword at pos is a function call (immediately followed by '(')
  private isBlockKeywordFunctionCall(source: string, pos: number): boolean {
    for (const kw of ElixirBlockParser.DO_BLOCK_KEYWORDS) {
      if (source.startsWith(kw, pos) && pos + kw.length < source.length && source[pos + kw.length] === '(') {
        return true;
      }
    }
    return false;
  }

  // Checks if a block keyword at `position` is the function name being defined, i.e. it
  // immediately follows a definition keyword (def/defp/defmacro/defguard/...).
  // In Elixir `def unless(x) do ... end` defines a function named `unless`; the inner
  // keyword is an identifier, not a block opener. Only the def..end pair must be produced.
  // The definition keyword and the function name are separated only by spaces/tabs/newlines
  // (no `.` so module-qualified names like `MyApp.If` are not misidentified).
  private isFunctionNameAfterDefinitionKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Scan backward over whitespace (including newlines) to the previous token's last char.
    let j = position - 1;
    while (j >= 0) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start - 1;
          continue;
        }
      }
      const ch = source[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        j--;
        continue;
      }
      break;
    }
    if (j < 0) return false;

    // The previous token must be an ASCII identifier ending here.
    if (!/[a-zA-Z0-9_]/.test(source[j])) return false;
    let wordStart = j;
    while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.slice(wordStart, j + 1);
    if (!DEFINITION_KEYWORDS.has(word)) return false;

    // Reject `.`/`@`-prefixed words (method call / module attribute) so e.g. `Foo.def`
    // is not treated as a real definition keyword.
    if (wordStart > 0) {
      const before = source[wordStart - 1];
      if (before === '.' || before === '@') return false;
    }
    return true;
  }

  // Checks if a block keyword is used as a bare value rather than starting a nested block
  // Detects multiple patterns:
  //   1. Followed by comma: "if cond, do: v" - cond is a value
  //   2. Followed by "do" keyword: "if cond do" - cond is a variable, do belongs to outer if
  //   3. Followed by newline then do: "if cond\ndo" - cond is a value across newlines
  //   4. Followed by binary operator: "if cond + 1 do" - cond is part of an expression
  //   5. Followed by method/field access: "if cond.field do" - cond is a value
  //   6. Followed by word operator (and/or/not/in/when): "if cond and other do" - cond is a value
  //
  // When `currentKeyword` is a definition keyword (def/defp/defmacro/defguard/defmodule etc.),
  // the chained "<this_kw> <ident> do\nend" heuristic is suppressed because definition
  // keywords are syntactically required to start their own block; a following "def foo do/end"
  // belongs to that inner def, not to a chained expression.
  private isKeywordUsedAsValue(source: string, afterPos: number, currentKeyword?: string): boolean {
    // Reset the memo when a new source is parsed (cache is valid only within one parse).
    if (this.valueMemoSource !== source) {
      this.valueMemoSource = source;
      this.valueMemo = new Map<number, boolean>();
    }

    // Walk the "<kw> <kw> ... do" chain iteratively. Each loop iteration evaluates the
    // value checks at `pos` for keyword `keyword`; when the next word is itself a block
    // keyword used in the chain, we advance `pos`/`keyword` to that word instead of
    // recursing. Iterating (rather than the former self-recursion) avoids stack overflow
    // when a statement chains many block keywords (e.g. "if for for ... do :ok end").
    //
    // Every position visited in a single walk shares the same final result (each
    // non-terminal link merely delegates to the next), so the result is memoized for all
    // of them. Combined with reuse across calls this keeps total chain work near-linear
    // and removes the former O(N^3) blowup. The key folds in whether the keyword is a
    // definition keyword, since that gates the chain/do-no-body branches.
    let pos = afterPos;
    let keyword = currentKeyword;
    const visitedKeys: number[] = [];

    const finish = (result: boolean): boolean => {
      for (const key of visitedKeys) {
        this.valueMemo.set(key, result);
      }
      return result;
    };

    while (true) {
      const isDefinitionKw = keyword !== undefined && DEFINITION_KEYWORDS.has(keyword);
      const memoKey = pos * 2 + (isDefinitionKw ? 1 : 0);
      const cached = this.valueMemo.get(memoKey);
      if (cached !== undefined) {
        return finish(cached);
      }
      visitedKeys.push(memoKey);

      let j = pos;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
        j++;
      }
      if (j >= source.length) return finish(false);
      const c = source[j];
      if (c === ',') {
        return finish(true);
      }
      // Followed by a closing bracket: the keyword is the last element of a
      // parenthesized condition / list / tuple (e.g., "if(cond) do", "if [case] do",
      // "if {cond} do"). cond/case is a value, do belongs to the outer block keyword.
      if (c === ')' || c === ']' || c === '}') {
        return finish(true);
      }
      // Check if directly followed by "do" with word boundary
      if (source.slice(j, j + 2) === 'do') {
        const afterDo = source[j + 2];
        if (afterDo === undefined || /[\s,;:#]/.test(afterDo)) {
          return finish(true);
        }
      }
      // Followed by inline comment or newline: skip comments and newlines, then check for `do`
      if (c === '\n' || c === '\r' || c === '#') {
        let k = j;
        while (k < source.length) {
          const ch = source[k];
          if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            k++;
            continue;
          }
          if (ch === '#') {
            while (k < source.length && source[k] !== '\n' && source[k] !== '\r') k++;
            continue;
          }
          break;
        }
        if (source.slice(k, k + 2) === 'do') {
          const afterDo = source[k + 2];
          if (afterDo === undefined || /[\s,;:#]/.test(afterDo)) {
            return finish(true);
          }
        }
      }
      // Followed by binary operator (part of an expression)
      if ('+-*/<>=!^&|'.includes(c)) {
        return finish(true);
      }
      // Followed by `.` (method/field access) — but not `..` range terminator at end of expr
      if (c === '.' && j + 1 < source.length && source[j + 1] !== '.') {
        return finish(true);
      }
      // Note: `(` (function call) is intentionally NOT treated as value here, since
      // isBlockKeywordFunctionCall in callers handles function-call form separately.
      // Followed by word-based operator (and/or/not/in/when) or another identifier+do pattern
      if (!/[a-z_]/.test(c)) {
        return finish(false);
      }
      let wordEnd = j;
      while (wordEnd < source.length && /[a-zA-Z0-9_]/.test(source[wordEnd])) wordEnd++;
      const word = source.slice(j, wordEnd);
      if (['and', 'or', 'not', 'in', 'when'].includes(word)) {
        return finish(true);
      }
      // "<this_kw> <ident> do" - this_kw is a value when the do has no body
      // (i.e., 'do' is followed immediately by 'end'). This distinguishes
      // "if cond foo do\nend" (cond is a value, do belongs to outer if) from
      // "if true do :ok end ..." (if is the inner block opener).
      // Skip this heuristic when this_kw is a definition keyword: definition keywords
      // (def/defp/defmacro/defguard/defmodule etc.) always start their own block, so a
      // following "def foo do\nend" must not be treated as a chained value expression.
      if (!isDefinitionKw) {
        let k = wordEnd;
        while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
        if (source.slice(k, k + 2) === 'do') {
          const afterDo = source[k + 2];
          if (afterDo === undefined || /[\s,;:#]/.test(afterDo)) {
            let m = k + 2;
            while (m < source.length && /\s/.test(source[m])) m++;
            if (source.slice(m, m + 3) === 'end') {
              const afterEnd = source[m + 3];
              if (afterEnd === undefined || !/[a-zA-Z0-9_?!]/.test(afterEnd)) {
                return finish(true);
              }
            }
          }
        }
      }
      // Chained pattern: "<this_kw> <next_word> <rest> do" where <next_word> is a block
      // keyword used as a value (e.g., "if for case do :ok end" or "if case x do :ok end").
      // Advance the chain to <next_word> and re-evaluate (the former tail-recursive call).
      // Suppress the chain when this_kw is a definition keyword for the same reason as above.
      if (isDefinitionKw || !this.isBlockKeywordAt(source, j)) {
        return finish(false);
      }
      pos = wordEnd;
      keyword = word;
    }
  }

  // Checks if this is a do: one-liner
  private isDoColonOneLiner(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const doColonKeywords = [
      'if',
      'unless',
      'case',
      'cond',
      'for',
      'with',
      'try',
      'receive',
      'def',
      'defp',
      'defmodule',
      'defprotocol',
      'defimpl',
      'defmacro',
      'defmacrop',
      'defguard',
      'defguardp',
      'quote'
    ];

    if (!doColonKeywords.includes(keyword)) {
      return false;
    }

    // Find "do" on the same line, tracking bracket/paren/brace depth and inner block/fn nesting
    let i = position + keyword.length;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let innerBlockDepth = 0;

    while (i < source.length) {
      // Skip excluded regions (strings, comments, etc) before checking for newline
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      if (source[i] === '\n' || source[i] === '\r') break;

      // Track bracket depth. Clamp depths at 0 on closers so unbalanced source
      // (or scans starting inside an existing bracket pair) does not push depth
      // negative and break the depth==0 checks that gate "do" detection.
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
      } else if (ch === '[') bracketDepth++;
      else if (ch === ']') {
        if (bracketDepth > 0) bracketDepth--;
      } else if (ch === '{') braceDepth++;
      else if (ch === '}') {
        if (braceDepth > 0) braceDepth--;
      }

      // Only look for "do" and inner blocks outside all brackets
      if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
        i++;
        continue;
      }

      // Track fn...end nesting and inner block keyword nesting
      if (/[a-zA-Z_]/.test(ch)) {
        const wordMatch = source.slice(i).match(/^[a-zA-Z_]\w*/);
        if (wordMatch) {
          const word = wordMatch[0];
          if (
            word === 'fn' &&
            !/[?!]/.test(source[i + word.length] || '') &&
            !(i > 0 && (source[i - 1] === '.' || source[i - 1] === '@' || (source[i - 1] === '&' && (i < 2 || source[i - 2] !== '&')))) &&
            !this.isAdjacentToUnicodeLetter(source, i, 2)
          ) {
            innerBlockDepth++;
            i += word.length;
            continue;
          }
          if (
            word === 'end' &&
            innerBlockDepth > 0 &&
            !/[?!:]/.test(source[i + word.length] || '') &&
            !(i > 0 && (source[i - 1] === '.' || source[i - 1] === '@' || (source[i - 1] === '&' && (i < 2 || source[i - 2] !== '&')))) &&
            !this.isAdjacentToUnicodeLetter(source, i, 3)
          ) {
            innerBlockDepth--;
            i += word.length;
            continue;
          }
          if (this.isBlockKeywordAt(source, i) && !this.isKeywordUsedAsValue(source, i + word.length, word)) {
            innerBlockDepth++;
            i += word.length;
            continue;
          }
          i += word.length;
          continue;
        }
      }

      const slice4 = source.slice(i, i + 4);
      const slice3 = source.slice(i, i + 3);

      let doStart = -1;
      if (slice4 === ', do') {
        doStart = i + 2;
      } else if (slice3 === ',do') {
        doStart = i + 1;
      } else if (slice3 === ' do') {
        doStart = i + 1;
      } else if (slice3 === '\tdo') {
        doStart = i + 1;
      }

      if (doStart !== -1) {
        // Verify 'do' is a standalone keyword, not a prefix (e.g., do_something)
        const afterDo = source[doStart + 2];
        if (afterDo !== undefined && /[a-zA-Z0-9_]/.test(afterDo)) {
          i++;
          continue;
        }

        // Track do/do: for inner blocks to decrement innerBlockDepth
        if (innerBlockDepth > 0) {
          let j = doStart + 2;
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
            j++;
          }
          if (source[j] === ':' && j === doStart + 2) {
            // do: one-liner for inner block
            innerBlockDepth--;
          }
          // Both do: and bare do belong to inner blocks; skip past "do"
          i = doStart + 2;
          continue;
        }

        let j = doStart + 2;

        // Skip whitespace after "do"
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }

        // Check for colon (do: syntax)
        // If colon is followed by a word character or quote, it's an atom like :ok or :"atom", not do:
        // Bare colon at EOL/EOF (do :) is NOT do: syntax
        // But if colon is immediately after "do" (no whitespace), it's always do: keyword syntax
        if (source[j] === ':') {
          if (j === doStart + 2) {
            // do: with no whitespace between do and colon = always keyword syntax
            return true;
          }
          // do : (space before colon) is NOT do: syntax
          return false;
        }
        // Bare 'do' found (not do:) - this is a block do, not a one-liner
        return false;
      }

      // Skip non-do characters that belong to inner blocks
      if (innerBlockDepth > 0) {
        i++;
        continue;
      }
      i++;
    }

    return false;
  }

  // Checks if ~ at pos is preceded by an identifier (not sigil modifiers)
  // Sigil modifiers are letter characters immediately after a sigil closing delimiter
  private isPrecededByIdentifier(source: string, pos: number): boolean {
    if (pos === 0) return false;
    const prev = source[pos - 1];
    if (!/[a-zA-Z0-9_]/.test(prev)) {
      // Check for Unicode letter (Elixir 1.5+ allows Unicode identifiers)
      if (prev.charCodeAt(0) > 127 && /\p{L}/u.test(prev)) return true;
      // Check for surrogate pair: prev may be low surrogate
      if (pos >= 2) {
        const high = source.charCodeAt(pos - 2);
        const low = prev.charCodeAt(0);
        if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
          const codePoint = (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
          if (/\p{L}/u.test(String.fromCodePoint(codePoint))) return true;
        }
      }
      return false;
    }
    // Scan back past letter characters to check if they are sigil modifiers
    let j = pos - 1;
    while (j >= 0 && /[a-zA-Z]/.test(source[j])) {
      j--;
    }
    // If preceded by a sigil closing delimiter, the letters are modifiers (not an identifier)
    if (j >= 0 && /[/|)\]}>"']/.test(source[j])) return false;
    // Digit or underscore before the letter sequence means it's an identifier
    return true;
  }
}
