// Julia block parser: handles nested multi-line comments #= =#, prefixed strings, and transpose operator

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { BracketIndex } from './bracketIndex';
import {
  isComprehensionFilterInBrackets,
  isGeneratorFilterIf,
  isInsideAnyIndexingBracket,
  isInsideBrackets,
  isInsideCurlyBraces,
  isInsideIndexingBrackets,
  isInsideParentheses,
  isInsideSquareBrackets,
  isLoneEndInArrayConstruction
} from './juliaBracketHelpers';
import type { JuliaHelperCallbacks } from './juliaHelpers';
import { isSymbolStart, isTransposeOperator, skipJuliaInterpolation } from './juliaHelpers';
import { isFollowedByBinaryOperator, isPrecededByBinaryOperator, isPrecededBySubtypeOperator } from './juliaLastindexHelpers';

export class JuliaBlockParser extends BaseBlockParser {
  // Bracket index cached per source string. Built lazily on the first bracket-context
  // check of a tokenize pass and reused for every subsequent keyword in the same
  // source, so the enclosing-bracket lookup stays O(log n) instead of rescanning
  // the prefix per keyword (which made parsing O(N^2)).
  private bracketIndexCache: { source: string; index: BracketIndex } | null = null;
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'if',
      'function',
      'for',
      'while',
      'struct',
      'begin',
      'try',
      'let',
      'module',
      'baremodule',
      'macro',
      'quote',
      'do',
      // Type definitions
      'abstract',
      'primitive'
    ],
    blockClose: ['end'],
    blockMiddle: ['elseif', 'else', 'catch', 'finally']
  };

  // Returns the bracket index for `source`, building it once and caching it by
  // source identity. Every bracket-context check in a tokenize pass shares the
  // same index, keeping enclosing-bracket lookups O(log n). excludedRegions is
  // not part of the cache key: findExcludedRegions is deterministic, so the same
  // source always yields the same regions within a parse.
  private getBracketIndex(source: string, excludedRegions: ExcludedRegion[]): BracketIndex {
    if (this.bracketIndexCache !== null && this.bracketIndexCache.source === source) {
      return this.bracketIndexCache.index;
    }
    const index = new BracketIndex(source, excludedRegions);
    this.bracketIndexCache = { source, index };
    return index;
  }

  // Builds the callbacks/context bundle passed to bracket-aware scanning helpers.
  private buildHelperCallbacks(source: string, excludedRegions: ExcludedRegion[]): JuliaHelperCallbacks {
    return {
      isAdjacentToUnicodeLetter: (s, o, l) => this.isAdjacentToUnicodeLetter(s, o, l),
      bracketIndex: this.getBracketIndex(source, excludedRegions)
    };
  }

  // Filters out keywords preceded by dot or adjacent to Unicode identifier characters
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      // Skip keywords preceded by dot (struct field access like obj.end, range.begin)
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        return false;
      }
      // Skip keywords preceded by '@' (macro names like @if, @end, @for).
      // While `@<reserved-word>` is invalid Julia (reserved words can't be macro names),
      // the keyword should not be tokenized as a block keyword in this context.
      if (token.startOffset > 0 && source[token.startOffset - 1] === '@') {
        return false;
      }
      // Skip keywords adjacent to Unicode identifier characters (e.g., αend, endβ)
      // JavaScript \b only handles ASCII word boundaries, so Unicode letters need explicit check
      // Handle surrogate pairs for characters outside the BMP (codepoints > U+FFFF)
      if (token.startOffset > 0) {
        const before = source[token.startOffset - 1];
        if (before >= '\uDC00' && before <= '\uDFFF' && token.startOffset >= 2) {
          const cp = source.codePointAt(token.startOffset - 2);
          if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) {
            return false;
          }
        } else if (/\p{L}/u.test(before)) {
          return false;
        }
      }
      const afterPos = token.endOffset;
      if (afterPos < source.length) {
        const after = source[afterPos];
        // Skip keywords followed by '!' (Julia naming convention for mutating functions: end!, push!, etc.)
        // But preserve when followed by `!=` (inequality operator) since Julia reserves keywords —
        // `end!=2` is `end` followed by `!=`, not a `end!` identifier.
        if (after === '!' && source[afterPos + 1] !== '=') {
          return false;
        }
        if (after >= '\uD800' && after <= '\uDBFF' && afterPos + 1 < source.length) {
          const cp = source.codePointAt(afterPos);
          if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) {
            return false;
          }
        } else if (/\p{L}/u.test(after)) {
          return false;
        }
      }
      return true;
    });
  }

  // Pairs blocks with context-aware intermediate handling: catch/finally only attach to
  // try, else/elseif only attach to if. Otherwise default LIFO semantics.
  // Without this override, `function f() catch e end` would attach catch to function,
  // and `try ... else ... end` would attach else to try, neither of which reflects code
  // structure (per Julia syntax, catch/finally only follow try; else/elseif only follow if).
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
            const topOpener = stack[stack.length - 1].token.value;
            if (this.isIntermediateValidForOpener(token.value, topOpener)) {
              stack[stack.length - 1].intermediates.push(token);
            }
            // Else: drop the intermediate (context mismatch).
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

  // Returns true if the intermediate keyword is valid for the given opener.
  // - catch/finally: only valid for try
  // - else: valid for if and for try (Julia 1.8+ supports try/catch/else/finally)
  // - elseif: only valid for if
  private isIntermediateValidForOpener(intermediate: string, opener: string): boolean {
    if (intermediate === 'catch' || intermediate === 'finally') {
      return opener === 'try';
    }
    if (intermediate === 'else') {
      return opener === 'if' || opener === 'try';
    }
    if (intermediate === 'elseif') {
      return opener === 'if';
    }
    return true;
  }

  // Validates block open keywords
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // abstract/primitive must be followed by 'type' keyword
    if (keyword === 'abstract' || keyword === 'primitive') {
      const afterKeyword = source.slice(position + keyword.length);
      return /^[ \t]+type\b/.test(afterKeyword);
    }

    // Keywords inside curly brace type parameters are not blocks (e.g., Dict{begin, end})
    if (this.isInsideCurlyBraces(source, position, excludedRegions)) {
      return false;
    }

    // for inside brackets or parentheses are array comprehensions/generators
    if (keyword === 'for') {
      if (this.isInsideBrackets(source, position, excludedRegions) || this.isInsideParentheses(source, position, excludedRegions)) {
        return false;
      }
    }

    // if inside brackets is a comprehension filter only when preceded by 'for'
    // [x for x in 1:10 if x > 5] -> comprehension filter (reject)
    // [if true 1 else 2 end] -> block expression in array construction (accept)
    if (keyword === 'if') {
      if (this.isComprehensionFilterInBrackets(source, position, excludedRegions)) {
        return false;
      }
      if (this.isGeneratorFilterIf(source, position, excludedRegions)) {
        return false;
      }
    }

    // Other block keywords inside parentheses are block expressions
    // Only exclude them inside square brackets
    if (keyword !== 'for' && keyword !== 'if') {
      if (this.isInsideSquareBrackets(source, position, keyword, excludedRegions)) {
        return false;
      }
    }

    return true;
  }

  // Validates block close: 'end' inside indexing brackets is array indexing, not block close
  // 'end' inside array construction brackets IS a valid block close (e.g., [begin...end])
  // 'end' inside curly brace type parameters is not a block close (e.g., Dict{begin, end})
  protected isValidBlockClose(_keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isInsideCurlyBraces(source, position, excludedRegions)) {
      return false;
    }
    if (this.isInsideIndexingBrackets(source, position, excludedRegions)) {
      return false;
    }
    // Inside indexing brackets, `end` followed by a binary operator (e.g., `end!=2`,
    // `end+1`, `end<5`) is lastindex, even when there are unmatched block openers
    // between `[` and the `end`. These appear in expressions inside block bodies
    // (e.g., `arr[if end!=2 1 else 0 end]` where `end!=2` is the if's condition).
    if (this.isFollowedByBinaryOperator(source, position) && this.isInsideAnyIndexingBracket(source, position, excludedRegions)) {
      return false;
    }
    // Inside array construction `[...]` (not indexing), an `end` without a matching
    // block opener (begin/if/for/etc.) inside the bracket is treated as lastindex
    // (or filtered as not a block close). For example, `[end]` after `return` is
    // array construction, and the `end` is not a block close.
    if (this.isLoneEndInArrayConstruction(source, position, excludedRegions)) {
      return false;
    }
    // `end` immediately after `<:` or `>:` (subtype/supertype operators) is invalid syntax
    // (end is not a type), but should not be classified as block_close so the trailing
    // real `end` can pair with the function/struct correctly. Skip this check inside
    // indexing brackets (already handled above).
    if (this.isPrecededBySubtypeOperator(source, position, excludedRegions)) {
      return false;
    }
    // `end` directly after a binary or postfix operator (e.g., `A+end`, `A*end`, `A'end`)
    // is invalid syntax outside of indexing brackets. It should not be classified as
    // block_close so the surrounding real `end` can pair with its opener correctly.
    // Newlines terminate the scan: `A\n end` is not the same case (separate lines).
    if (this.isPrecededByBinaryOperator(source, position, excludedRegions)) {
      return false;
    }
    // `end` directly followed by a binary operator (e.g., `end!=2`, `end<2`, `end+1`)
    // outside of indexing brackets is invalid syntax (`end` is not a value). It should
    // not be classified as block_close so the surrounding real `end` can pair with its
    // opener correctly. Inside indexing brackets this is `lastindex` and is already
    // handled by the earlier `isInsideAnyIndexingBracket` check above.
    if (this.isFollowedByBinaryOperator(source, position)) {
      return false;
    }
    return true;
  }

  // Checks if `end` at position is preceded by `<:` or `>:` (subtype/supertype operator)
  private isPrecededBySubtypeOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPrecededBySubtypeOperator(source, position, excludedRegions);
  }

  // Checks if `end` at position is preceded by a binary or postfix operator
  private isPrecededByBinaryOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPrecededByBinaryOperator(source, position, excludedRegions);
  }

  // Checks if `end` is a lone `end` directly inside array construction `[...]`
  private isLoneEndInArrayConstruction(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isLoneEndInArrayConstruction(
      source,
      position,
      excludedRegions,
      this.keywords.blockOpen,
      this.buildHelperCallbacks(source, excludedRegions)
    );
  }

  // Checks if the `end` at position is followed by a binary operator
  private isFollowedByBinaryOperator(source: string, position: number): boolean {
    return isFollowedByBinaryOperator(source, position);
  }

  // Checks if position is inside any indexing bracket (a[...]) at any depth
  private isInsideAnyIndexingBracket(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideAnyIndexingBracket(source, position, this.getBracketIndex(source, excludedRegions));
  }

  // Checks if position is directly inside `[]` (for for/if comprehension check)
  private isInsideBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideBrackets(source, position, excludedRegions, this.keywords.blockOpen, this.buildHelperCallbacks(source, excludedRegions));
  }

  // Checks if position is inside indexing brackets only (not array construction)
  private isInsideIndexingBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideIndexingBrackets(source, position, excludedRegions, this.keywords.blockOpen, this.buildHelperCallbacks(source, excludedRegions));
  }

  // Checks if `if` is a comprehension filter inside brackets (for...if pattern)
  private isComprehensionFilterInBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isComprehensionFilterInBrackets(
      source,
      position,
      excludedRegions,
      this.keywords.blockOpen,
      this.buildHelperCallbacks(source, excludedRegions)
    );
  }

  // Checks if `if` is a generator filter inside parentheses (for...if pattern)
  private isGeneratorFilterIf(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isGeneratorFilterIf(source, position, excludedRegions, this.keywords.blockOpen, this.buildHelperCallbacks(source, excludedRegions));
  }

  // Checks if position is inside unmatched parentheses (for generator expressions)
  private isInsideParentheses(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideParentheses(source, position, excludedRegions, this.keywords.blockOpen, this.buildHelperCallbacks(source, excludedRegions));
  }

  // Checks if position is inside indexing square brackets (for other block keywords)
  private isInsideSquareBrackets(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideSquareBrackets(
      source,
      position,
      keyword,
      excludedRegions,
      this.keywords.blockOpen,
      this.buildHelperCallbacks(source, excludedRegions)
    );
  }

  // Checks if position is inside curly braces (type parameters like Dict{begin, end})
  private isInsideCurlyBraces(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isInsideCurlyBraces(position, this.getBracketIndex(source, excludedRegions));
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Multi-line comment: #= ... =# (nestable)
    if (char === '#' && pos + 1 < source.length && source[pos + 1] === '=') {
      return this.matchMultiLineComment(source, pos);
    }

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Symbol literal
    if (char === ':' && this.isSymbolStart(source, pos)) {
      return this.matchSymbolLiteral(source, pos);
    }

    // Triple-quoted string
    if (source.slice(pos, pos + 3) === '"""') {
      return this.matchTripleQuotedString(source, pos);
    }

    // Prefixed strings: r"...", raw"...", b"...", s"...", v"..."
    const prefixedResult = this.matchPrefixedString(source, pos);
    if (prefixedResult) {
      return prefixedResult;
    }

    // Double-quoted string (with $() interpolation support)
    if (char === '"') {
      return this.matchJuliaString(source, pos);
    }

    // Character literal (not transpose operator)
    if (char === "'") {
      if (this.isTransposeOperator(source, pos)) {
        return null;
      }
      return this.matchCharLiteral(source, pos);
    }

    // Triple backtick command string (check before single backtick)
    if (char === '`' && source.slice(pos, pos + 3) === '```') {
      return this.matchTripleBacktickCommand(source, pos);
    }

    // Command string (backtick)
    if (char === '`') {
      return this.matchCommandString(source, pos);
    }

    return null;
  }

  // Matches multi-line comment with nesting support: #= ... =#
  // Caller guarantees source[pos..pos+2] === '#='
  private matchMultiLineComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length && depth > 0) {
      if (source.slice(i, i + 2) === '#=') {
        depth++;
        i += 2;
        continue;
      }
      if (source.slice(i, i + 2) === '=#') {
        depth--;
        i += 2;
        continue;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches triple-quoted string: """ ... """ with $() interpolation
  private matchTripleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        return { start: pos, end: i + 3 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches prefixed strings: r"...", raw"...", b"...", s"...", v"...", and custom macros
  private matchPrefixedString(source: string, pos: number): ExcludedRegion | null {
    // Prefix must not be part of an identifier.
    // Julia identifier start chars: ASCII letters (a-z, A-Z, _), Unicode Letters (\p{L}).
    // Note: digits cannot start an identifier in Julia. So if prevChar is a digit (e.g.,
    // `1r"text"`), the prefix is valid since `1r` cannot be a single identifier — `1`
    // is a numeric literal, `r"..."` is a separate macro call (numeric coefficient pattern).
    // Unicode Symbol_Other characters (e.g., × U+00D7) are operators, not identifier chars.
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z_]/.test(prevChar)) {
        return null;
      }
      if (prevChar.charCodeAt(0) > 127 && /\p{L}/u.test(prevChar)) {
        return null;
      }
      // Check for low surrogate (BMP-outside char's second code unit). If present, the
      // previous identifier char ends at pos - 2 (high surrogate). Reject if it's a letter.
      if (prevChar >= '\uDC00' && prevChar <= '\uDFFF' && pos >= 2) {
        const cp = source.codePointAt(pos - 2);
        if (cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp))) {
          return null;
        }
      }
    }

    // Match any identifier prefix followed by " (Julia string macro syntax).
    // Identifier start: ASCII letter/underscore or Unicode letter (digits cannot start identifiers).
    // Handle BMP-outside characters (surrogate pairs) by using codePointAt.
    const isUnicodeLetter = (c: string) => c.charCodeAt(0) > 127 && /\p{L}/u.test(c);
    const isIdentStart = (c: string) => /[a-zA-Z_]/.test(c) || isUnicodeLetter(c);
    const isIdentCont = (c: string) => /[a-zA-Z0-9_]/.test(c) || (c.charCodeAt(0) > 127 && /[\p{L}\p{N}]/u.test(c));
    // Check if pos is a high surrogate that combines with pos+1 to form a BMP-outside letter.
    const isSurrogateLetterStart = (s: string, p: number): boolean => {
      if (p + 1 >= s.length) return false;
      const high = s.charCodeAt(p);
      if (high < 0xd800 || high > 0xdbff) return false;
      const cp = s.codePointAt(p);
      return cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp));
    };
    const isSurrogateLetterOrNumberCont = (s: string, p: number): boolean => {
      if (p + 1 >= s.length) return false;
      const high = s.charCodeAt(p);
      if (high < 0xd800 || high > 0xdbff) return false;
      const cp = s.codePointAt(p);
      return cp !== undefined && cp > 0xffff && /[\p{L}\p{N}]/u.test(String.fromCodePoint(cp));
    };
    const startedBySurrogate = isSurrogateLetterStart(source, pos);
    const char = source[pos];
    if (isIdentStart(char) || startedBySurrogate) {
      let prefixEnd = startedBySurrogate ? pos + 2 : pos + 1;
      while (prefixEnd < source.length) {
        if (isIdentCont(source[prefixEnd])) {
          prefixEnd++;
          continue;
        }
        if (isSurrogateLetterOrNumberCont(source, prefixEnd)) {
          prefixEnd += 2;
          continue;
        }
        break;
      }
      if (prefixEnd < source.length && source[prefixEnd] === '"') {
        // Don't match block keywords as string macro prefixes
        const prefix = source.slice(pos, prefixEnd);
        if (this.isBlockKeyword(prefix)) {
          return null;
        }
        const prefixLength = prefixEnd - pos;
        // Check for triple-quoted prefixed string
        if (source.slice(prefixEnd, prefixEnd + 3) === '"""') {
          return this.matchPrefixedTripleQuotedString(source, pos, prefixLength);
        }
        // Regular prefixed string (no interpolation, raw content except b"...")
        let stringEnd = this.findPrefixedStringEnd(source, prefixEnd + 1, '"', prefix === 'b');
        // Consume string macro suffix characters (e.g., custom"content"flags, r"pattern"for)
        // In Julia, all identifier characters after the closing quote are part of the suffix
        while (stringEnd < source.length && /[a-zA-Z0-9_]/.test(source[stringEnd])) {
          stringEnd++;
        }
        return { start: pos, end: stringEnd };
      }
    }

    return null;
  }

  // Checks if a word is a block keyword
  private isBlockKeyword(word: string): boolean {
    return this.keywords.blockOpen.includes(word) || this.keywords.blockClose.includes(word) || this.keywords.blockMiddle.includes(word);
  }

  // Matches prefixed triple-quoted string (no interpolation, raw content except b"...")
  private matchPrefixedTripleQuotedString(source: string, pos: number, prefixLength: number): ExcludedRegion {
    const prefix = source.slice(pos, pos + prefixLength);
    const hasEscapes = prefix === 'b';
    let i = pos + prefixLength + 3;

    while (i < source.length) {
      // Only b"..." strings support escape sequences; non-b prefixed strings treat \ as literal
      if (hasEscapes && source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        let end = i + 3;
        // Consume string macro suffix characters
        // In Julia, all identifier characters after the closing quote are part of the suffix
        while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) {
          end++;
        }
        return { start: pos, end };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Finds the end of a prefixed string (no interpolation, raw content except b"...")
  private findPrefixedStringEnd(source: string, start: number, quote: string, hasEscapes = false): number {
    let i = start;
    while (i < source.length) {
      // All prefixed strings treat \" and \\ as escape sequences
      if (source[i] === '\\' && i + 1 < source.length && (hasEscapes || source[i + 1] === quote || source[i + 1] === '\\')) {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return i + 1;
      }
      i++;
    }
    return source.length;
  }

  // Checks if colon starts a symbol (not ternary operator)
  private isSymbolStart(source: string, pos: number): boolean {
    return isSymbolStart(source, pos);
  }

  // Matches symbol literal including operator symbols and Unicode
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    if (i >= source.length) {
      return { start: pos, end: i };
    }
    const firstChar = source[i];

    // Determine if this is an identifier symbol or operator symbol
    // Unicode letters/numbers (e.g., alpha, pi) are identifiers; Unicode symbols (e.g., math operators) are operators
    const isUnicodeIdent = (c: string) => c.charCodeAt(0) > 127 && /[\p{L}\p{N}]/u.test(c);
    if (/[\w]/.test(firstChar) || isUnicodeIdent(firstChar)) {
      // Identifier symbol: consume word characters, Unicode identifiers, and trailing !
      while (i < source.length) {
        const char = source[i];
        if (/[\w]/.test(char) || isUnicodeIdent(char)) {
          i++;
          continue;
        }
        // ! can only appear at the end of a Julia identifier
        if (char === '!') {
          i++;
          break;
        }
        break;
      }
    } else {
      // Operator symbol: consume ASCII and Unicode operator characters
      while (i < source.length) {
        const char = source[i];
        if (/[!%&*+\-/<=>?\\^|~@]/.test(char)) {
          i++;
          // If @ was consumed and next char starts an identifier, consume the full identifier
          // This handles :@macro_name patterns where @ is the macro prefix
          if (char === '@' && i < source.length && (/[\w]/.test(source[i]) || isUnicodeIdent(source[i]))) {
            while (i < source.length && (/[\w!]/.test(source[i]) || isUnicodeIdent(source[i]))) {
              i++;
            }
            break;
          }
          continue;
        }
        // Unicode non-letter/non-number characters are operators (e.g., math symbols like +, -, etc.)
        if (char.charCodeAt(0) > 127 && !isUnicodeIdent(char)) {
          i++;
          continue;
        }
        break;
      }
    }

    return { start: pos, end: i };
  }

  // Checks if single quote is transpose operator (not character literal)
  private isTransposeOperator(source: string, pos: number): boolean {
    return isTransposeOperator(source, pos);
  }

  // Matches character literal (doesn't span multiple lines)
  private matchCharLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        // Don't let escape skip past newline - character literals can't span lines
        if (source[i + 1] === '\n' || source[i + 1] === '\r') {
          i++;
          break;
        }
        i += 2;
        continue;
      }
      if (source[i] === "'") {
        return { start: pos, end: i + 1 };
      }
      // Character literals don't span lines
      if (source[i] === '\n' || source[i] === '\r') {
        break;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Returns true if the character could be the last char of a command macro prefix
  // (i.e., the backtick that follows it is part of a prefixed command macro call).
  // Identifier chars: ASCII word (a-zA-Z0-9_) or Unicode Letter (\p{L}).
  private isCommandMacroPrefixChar(c: string): boolean {
    if (/[a-zA-Z0-9_]/.test(c)) return true;
    return c.charCodeAt(0) > 127 && /\p{L}/u.test(c);
  }

  // Matches triple backtick command string: ``` ... ```
  private matchTripleBacktickCommand(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;
    // A backtick command is "prefixed" if preceded by an identifier char.
    // Identifier chars: ASCII word (a-zA-Z0-9_) or Unicode Letter (\p{L}).
    const isPrefixed = pos > 0 && this.isCommandMacroPrefixChar(source[pos - 1]);

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '```') {
        let end = i + 3;
        // Consume command macro suffix characters when prefixed (e.g., cmd```test```flags)
        if (isPrefixed) {
          while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) {
            end++;
          }
        }
        return { start: pos, end };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches double-quoted string with $() interpolation
  private matchJuliaString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '"') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  private skipJuliaInterpolation(source: string, pos: number): number {
    return skipJuliaInterpolation(source, pos);
  }

  // Matches command string (backtick)
  private matchCommandString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    // A backtick command is "prefixed" if preceded by an identifier char.
    // Identifier chars: ASCII word (a-zA-Z0-9_) or Unicode Letter (\p{L}).
    const isPrefixed = pos > 0 && this.isCommandMacroPrefixChar(source[pos - 1]);

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '`') {
        let end = i + 1;
        // Consume command macro suffix characters when prefixed (e.g., cmd`test`flags)
        if (isPrefixed) {
          while (end < source.length && /[a-zA-Z0-9_]/.test(source[end])) {
            end++;
          }
        }
        return { start: pos, end };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
