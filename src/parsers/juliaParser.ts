// Julia block parser: handles nested multi-line comments #= =#, prefixed strings, and transpose operator

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import type { JuliaHelperCallbacks } from './juliaHelpers';
import {
  hasAnyBlockOpenerBetween,
  hasAssignmentBetween,
  hasCommaAtDepthZero,
  hasForBetween,
  hasUnmatchedBlockOpenerBetween,
  isIndexingBracket,
  isOnlyWhitespaceBetween,
  isSymbolStart,
  isTransposeOperator,
  skipJuliaInterpolation
} from './juliaHelpers';

export class JuliaBlockParser extends BaseBlockParser {
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

  private get juliaHelperCallbacks(): JuliaHelperCallbacks {
    return {
      isAdjacentToUnicodeLetter: (s, o, l) => this.isAdjacentToUnicodeLetter(s, o, l)
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
    return true;
  }

  // Checks if `end` at `position` is preceded by `<:` or `>:` (subtype/supertype operator).
  // Skips intervening tabs/spaces (and excluded regions like comments) but stops at newlines
  // or any other token. Used to reject `end` as a block_close in `where T<:end` and similar
  // invalid syntax where `end` is being used as a (nonexistent) type. Newlines terminate the
  // scan because `where T <:\nend` is best-effort treated as a mid-edit state where the
  // trailing `end` should still pair with the surrounding block.
  private isPrecededBySubtypeOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === '\n' || ch === '\r') {
        // Stop at newline: `<:` on a previous line should not affect this `end`.
        return false;
      }
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      // Found a non-whitespace char. Check if it's `:` preceded by `<` or `>`.
      if (ch === ':' && i > 0 && (source[i - 1] === '<' || source[i - 1] === '>')) {
        return true;
      }
      return false;
    }
    return false;
  }

  // Checks if `end` at `position` is preceded by a binary or postfix operator
  // (e.g., `+`, `-`, `*`, `/`, `%`, `^`, `==`, `!=`, `<=`, `>=`, `<`, `>`, `'` transpose).
  // Skips intervening tabs/spaces but stops at newlines (so `A\n end` is unaffected).
  // Used to reject `end` as block_close in expressions like `A+end`, `A*end`, `A'end`,
  // which are invalid syntax outside of indexing brackets but otherwise cause the inner
  // `end` to pair with the surrounding block opener.
  private isPrecededByBinaryOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === '\n' || ch === '\r') {
        return false;
      }
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      // Found a non-whitespace char. Check if it's a binary/postfix operator.
      // Single-char binary operators: + - * / % ^
      if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '^') {
        return true;
      }
      // Postfix transpose operator: ' (preceded by identifier or closing bracket).
      // We use the existing isTransposeOperator helper for accuracy.
      if (ch === "'" && isTransposeOperator(source, i)) {
        return true;
      }
      // Comparison operators: ==, !=, <=, >=, <, > (but not <:, >: which are subtype ops
      // already handled by isPrecededBySubtypeOperator).
      if (ch === '=' && i > 0 && (source[i - 1] === '=' || source[i - 1] === '!' || source[i - 1] === '<' || source[i - 1] === '>')) {
        return true;
      }
      // Bare < or >: bare comparison (not part of <: or >:, since those would have ':' here).
      if (ch === '<' || ch === '>') {
        return true;
      }
      return false;
    }
    return false;
  }

  // Checks if the `end` at `position` is directly inside an array construction `[...]`
  // (not indexing) AND there is no block opener (including for/if) inside the same
  // bracket between `[` and `position`. For example: `[end]` after `return`, `[1, end]`,
  // `f([end])` — all return true. But `[begin ... end]`, `[for ... end]`, `[if ... end]`
  // return false because there is a matching opener inside.
  private isLoneEndInArrayConstruction(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === ']') {
        bracketDepth++;
      } else if (ch === '[') {
        if (bracketDepth === 0) {
          // Found the enclosing `[`. Skip if it's indexing (already handled elsewhere).
          if (isIndexingBracket(source, i)) {
            return false;
          }
          // Array construction: check if there's ANY block opener (for/if/begin/...)
          // inside the bracket. Use hasAnyBlockOpenerBetween (includes for) to avoid
          // the generator-vs-block-form ambiguity in hasUnmatchedBlockOpenerBetween.
          if (hasAnyBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // No opener at all: this `end` is lone (lastindex / not block close).
          return true;
        }
        bracketDepth--;
      } else if (ch === ')') {
        parenDepth++;
      } else if (ch === '(') {
        if (parenDepth === 0) return false;
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if the `end` at `position` is followed by a binary operator (after optional whitespace).
  private isFollowedByBinaryOperator(source: string, position: number): boolean {
    let i = position + 3;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    if (i >= source.length) return false;
    return this.isBinaryOperatorStart(source, i);
  }

  // Checks if position is inside any indexing bracket (a[...]) at any depth.
  // Skips nested ()s and []s.
  private isInsideAnyIndexingBracket(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === ']') {
        bracketDepth++;
      } else if (ch === '[') {
        if (bracketDepth === 0) {
          if (isIndexingBracket(source, i)) {
            return true;
          }
          // Array construction: keep scanning outward.
        } else {
          bracketDepth--;
        }
      } else if (ch === ')') {
        parenDepth++;
      } else if (ch === '(') {
        if (parenDepth === 0) continue;
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if position is inside any brackets (for for/if comprehension check)
  // Returns true only when the keyword is directly inside [] without intervening () or block expressions
  private isInsideBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) {
          // Check if there's an unmatched block opener between [ and position
          // [begin for i in 1:n ... end end] → for is inside a block expression
          // [begin i^2 end for i in 1:10] → begin...end is complete, for is a comprehension
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Comma at depth 0 may indicate trailing generator: [a, b for b in iter]
          // If `for` is preceded by a value expression, treat as generator
          if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
            return this.isPrecededByValueExpression(source, position, excludedRegions);
          }
          // for at start of brackets is a block, not a generator (generators need expr before for)
          if (isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
            return false;
          }
          return true;
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          // Inside a parenthesized expression, not directly in brackets
          return false;
        }
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if `for` (or `if`) keyword is preceded by a value expression (identifier, digit,
  // closing bracket/paren, string, etc). Used to detect trailing generators like
  // `f(x, y for y in iter)` where `for` follows a value-bearing expression after a comma.
  private isPrecededByValueExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          // Strings and char literals are value expressions
          const startCh = source[region.start];
          if (startCh === '"' || startCh === '`' || startCh === "'") {
            return true;
          }
          i = region.start - 1;
          continue;
        }
      }
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i--;
        continue;
      }
      // Value-ending characters indicate a value expression
      if (/[a-zA-Z0-9_)\]}]/.test(c)) {
        return true;
      }
      if (c.charCodeAt(0) > 127 && /[\p{L}\p{N}]/u.test(c)) {
        return true;
      }
      return false;
    }
    return false;
  }

  // Checks if position is inside indexing brackets only (not array construction)
  // Used for 'end' to distinguish a[end] (indexing) from [begin...end] (array construction)
  private isInsideIndexingBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) {
          const isIndexing = isIndexingBracket(source, i);
          // For indexing brackets, use a variant that does not count `end<binary-op>`
          // as a block close (those are lastindex expressions like `end!=2`).
          const hasUnmatched = isIndexing
            ? this.hasUnmatchedBlockOpenerBetweenInIndexing(source, i + 1, position, excludedRegions)
            : hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks);
          if (hasUnmatched) {
            // In indexing brackets, the parser filters bare `begin` as firstindex
            // (whether or not followed by `:`). If every unmatched opener is such a
            // filtered `begin`, treat this `end` as lastindex too.
            if (isIndexing && this.allUnmatchedOpenersAreFilteredBegins(source, i + 1, position, excludedRegions)) {
              // fall through to return isIndexing
            } else {
              return false;
            }
          }
          // Unmatched '[' (no closing ']') means the bracket is unclosed (likely during editing).
          if (!this.hasMatchingCloseBracket(source, position + 3, excludedRegions)) {
            // For an unclosed indexing bracket, an `end` that is the first non-whitespace
            // token after `[` (e.g., `a[end`) is the lastindex reference, not a block
            // close. Treat it as inside indexing brackets so it is not mis-paired with a
            // surrounding block opener. Other `end`s after the unclosed `[` (separated by
            // identifiers, newlines, or other tokens) keep their block-keyword meaning so
            // the trailing real `end` still pairs with its opener.
            if (isIndexing && isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
              return true;
            }
            // Otherwise keep the editing-friendly behavior: the keyword after the unclosed
            // bracket is still a valid block keyword.
            return false;
          }
          return isIndexing;
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0 && bracketDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            // If all unmatched begins are firstindex form (begin:) and there are no
            // other unmatched openers, continue scanning so the outer `[` can mark
            // `end` as lastindex (e.g., arr[(begin:end)]).
            // Note: at this point we haven't yet seen the outer `[`, so we use the
            // strict firstindex check (begin: form). The looser check is applied
            // once we confirm we're inside indexing brackets above.
            if (!this.allUnmatchedBeginsAreFirstindex(source, i + 1, position, excludedRegions)) {
              // For the indexing-bracket case (bug 1a: arr[(begin x end)]), if the
              // unmatched opener is a bare `begin` (not followed by `:`), we still
              // need to check whether we're inside an outer indexing bracket. In
              // that case the parser also filters `begin` as firstindex, so we must
              // continue scanning.
              if (!this.allUnmatchedOpenersAreFilteredBeginsInsideIndexing(source, i + 1, position, excludedRegions)) {
                return false;
              }
            }
            continue;
          }
          // No block opener between ( and end: check if this paren group closes after end
          // f(end + 1) -> reject end (paren closes after end)
          // function foo(\nend -> accept end (unmatched paren)
          if (
            !hasAnyBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks) &&
            this.hasMatchingCloseParen(source, position + 3, excludedRegions)
          ) {
            return true;
          }
          parenDepth--;
        } else {
          parenDepth--;
        }
      }
    }
    return false;
  }

  // Like hasUnmatchedBlockOpenerBetween, but treats `end` followed by a binary
  // operator (e.g., `end!=`, `end+`, `end<`) as lastindex rather than block close.
  // Used inside indexing brackets where lastindex expressions are common.
  private hasUnmatchedBlockOpenerBetweenInIndexing(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    const blockOpen = this.keywords.blockOpen;
    const openersWithoutFor = blockOpen.filter((kw) => kw !== 'for');
    let depth = 0;
    let inComprehensionContext = false;
    let bracketDepth = 0;

    // Detect leading block-form 'for' (after whitespace and excluded regions)
    let firstNonWhite = start;
    while (firstNonWhite < end) {
      if (this.isInExcludedRegion(firstNonWhite, excludedRegions)) {
        firstNonWhite++;
        continue;
      }
      const ch = source[firstNonWhite];
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
      firstNonWhite++;
    }
    if (firstNonWhite + 3 <= end && source.slice(firstNonWhite, firstNonWhite + 3) === 'for') {
      const before = firstNonWhite > 0 ? source[firstNonWhite - 1] : ' ';
      const after = firstNonWhite + 3 < source.length ? source[firstNonWhite + 3] : ' ';
      if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
        if (!this.isAdjacentToUnicodeLetter(source, firstNonWhite, 3) && before !== '.') {
          depth++;
        }
      }
    }

    for (let i = start; i < end; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      if (source[i] === '[') {
        bracketDepth++;
        continue;
      }
      if (source[i] === ']') {
        if (bracketDepth > 0) bracketDepth--;
        continue;
      }
      if (
        !inComprehensionContext &&
        source[i] === 'f' &&
        i + 3 <= end &&
        source.slice(i, i + 3) === 'for' &&
        !/[a-zA-Z0-9_]/.test(i > 0 ? source[i - 1] : ' ') &&
        !/[a-zA-Z0-9_]/.test(i + 3 < source.length ? source[i + 3] : ' ') &&
        !this.isAdjacentToUnicodeLetter(source, i, 3)
      ) {
        const tail = source.slice(i + 3, end);
        if (/^[ \t]+\S+.*?(?:\bin\b|\b∈\b|=)/.test(tail)) {
          inComprehensionContext = true;
        }
      }
      // Check for 'end' keyword
      if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + 3 < source.length ? source[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) {
          if (!this.isAdjacentToUnicodeLetter(source, i, 3)) {
            if (before !== '.' && bracketDepth === 0) {
              // Check if `end` is followed by a binary operator (lastindex expression).
              // Skip whitespace after `end` to find the next non-whitespace char.
              let k = i + 3;
              while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
              const isLastindex = k < source.length && this.isBinaryOperatorStart(source, k);
              if (!isLastindex && depth > 0) depth--;
            }
            i += 2;
            continue;
          }
        }
      }
      // Check for block openers
      for (const keyword of openersWithoutFor) {
        if (i + keyword.length <= end && source[i] === keyword[0] && source.slice(i, i + keyword.length) === keyword) {
          const before = i > 0 ? source[i - 1] : ' ';
          const after = i + keyword.length < source.length ? source[i + keyword.length] : ' ';
          if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
          if (this.isAdjacentToUnicodeLetter(source, i, keyword.length)) continue;
          if (before === '.') continue;
          if (inComprehensionContext && keyword === 'if') continue;
          if (keyword === 'abstract' || keyword === 'primitive') {
            const afterKeyword = source.slice(i + keyword.length);
            if (!/^[ \t]+type\b/.test(afterKeyword)) continue;
          }
          depth++;
          i += keyword.length - 1;
          break;
        }
      }
    }
    return depth > 0;
  }

  // Checks whether the character at `pos` is the start of a binary operator that can
  // follow `end` as lastindex (e.g., `!=`, `==`, `+`, `-`, `<`, `>`, `<=`, `>=`).
  private isBinaryOperatorStart(source: string, pos: number): boolean {
    const c = source[pos];
    const c2 = pos + 1 < source.length ? source[pos + 1] : '';
    if (c === '!' && c2 === '=') return true;
    if (c === '=' && c2 === '=') return true;
    if (c === '<' && c2 === '=') return true;
    if (c === '>' && c2 === '=') return true;
    if (c === '<' && c2 !== ':') return true;
    if (c === '>' && c2 !== ':') return true;
    if (c === '+') return true;
    if (c === '-') return true;
    if (c === '*') return true;
    if (c === '/') return true;
    if (c === '%') return true;
    if (c === '^') return true;
    return false;
  }

  // Checks whether every unmatched opener in [start, end) is a `begin` keyword that
  // the parser would filter as firstindex inside indexing brackets. The parser filters
  // any bare `begin` inside indexing brackets (regardless of whether it is followed by `:`),
  // so this method counts ALL bare `begin`s as filtered. Other block openers (if/for/let/...)
  // are real block expressions in indexing brackets, and would NOT be filtered.
  private allUnmatchedOpenersAreFilteredBegins(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    const blockOpen = this.keywords.blockOpen;
    let nonBeginDepth = 0;
    let beginDepth = 0;
    let bracketDepth = 0;
    for (let i = start; i < end; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      if (source[i] === '[') {
        bracketDepth++;
        continue;
      }
      if (source[i] === ']') {
        if (bracketDepth > 0) bracketDepth--;
        continue;
      }
      if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + 3 < source.length ? source[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.') {
          if (!this.isAdjacentToUnicodeLetter(source, i, 3)) {
            if (bracketDepth === 0) {
              // Skip `end<binary-op>` (lastindex expression like `end!=2`, `end+1`).
              let k = i + 3;
              while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
              const isLastindex = k < source.length && this.isBinaryOperatorStart(source, k);
              if (isLastindex) {
                i += 2;
                continue;
              }
              // Prefer canceling non-begin openers first (they are real blocks).
              if (nonBeginDepth > 0) {
                nonBeginDepth--;
              } else if (beginDepth > 0) {
                beginDepth--;
              }
            }
            i += 2;
            continue;
          }
        }
      }
      if (bracketDepth > 0) continue;
      for (const kw of blockOpen) {
        if (i + kw.length <= end && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
          const before = i > 0 ? source[i - 1] : ' ';
          const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
          if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
          if (before === '.') continue;
          if (this.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
          if (kw === 'abstract' || kw === 'primitive') {
            const afterKeyword = source.slice(i + kw.length);
            if (!/^[ \t]+type\b/.test(afterKeyword)) continue;
          }
          if (kw === 'begin') {
            beginDepth++;
          } else {
            nonBeginDepth++;
          }
          i += kw.length - 1;
          break;
        }
      }
    }
    return nonBeginDepth === 0;
  }

  // Like allUnmatchedOpenersAreFilteredBegins, but also requires there to be an enclosing
  // indexing `[` outside the current paren scope. Used for paren-handling in
  // isInsideIndexingBrackets to recognize cases like `arr[(begin x end)]` where the
  // inner `begin` is filtered as firstindex by virtue of the outer indexing bracket.
  private allUnmatchedOpenersAreFilteredBeginsInsideIndexing(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!this.allUnmatchedOpenersAreFilteredBegins(source, start, end, excludedRegions)) {
      return false;
    }
    // Confirm there is an enclosing indexing bracket outside the current paren.
    // Scan backward from start - 1 to find `[` at depth 0, ignoring ()s and []s that close.
    let parenDepth = 0;
    let bracketDepth = 0;
    for (let i = start - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === ')') {
        parenDepth++;
      } else if (ch === '(') {
        if (parenDepth === 0) continue;
        parenDepth--;
      } else if (ch === ']') {
        bracketDepth++;
      } else if (ch === '[') {
        if (bracketDepth === 0) {
          return isIndexingBracket(source, i);
        }
        bracketDepth--;
      }
    }
    return false;
  }

  // Checks whether every unmatched `begin` in [start, end) is the firstindex keyword
  // (i.e., followed by `:`). Used to accept `arr[begin:end]` where `begin` is firstindex
  // rather than a block opener. Scans with the full blockOpen list for openers and
  // returns true only when the depth imbalance is entirely due to `begin:` occurrences.
  private allUnmatchedBeginsAreFirstindex(source: string, start: number, end: number, excludedRegions: ExcludedRegion[]): boolean {
    // Walk range; for each `begin` not followed by `:`, fail. Also count ends so that a
    // genuine block (`begin ... end`) cancels out. If no unmatched non-firstindex begin
    // remains, return true. Track [ ] bracket depth so `end` inside arr[end] (lastindex)
    // does not erroneously cancel a real block opener.
    const blockOpen = this.keywords.blockOpen;
    let depth = 0;
    let nonFirstindexBegins = 0;
    let bracketDepth = 0;
    for (let i = start; i < end; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      if (source[i] === '[') {
        bracketDepth++;
        continue;
      }
      if (source[i] === ']') {
        if (bracketDepth > 0) bracketDepth--;
        continue;
      }
      if (source[i] === 'e' && i + 3 <= end && source.slice(i, i + 3) === 'end') {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + 3 < source.length ? source[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.') {
          if (!this.isAdjacentToUnicodeLetter(source, i, 3)) {
            if (bracketDepth === 0) {
              if (depth > 0) {
                depth--;
              } else if (nonFirstindexBegins > 0) {
                nonFirstindexBegins--;
              }
            }
            i += 2;
            continue;
          }
        }
      }
      // Skip block-opener detection inside [ ] (those are value contexts, not blocks).
      if (bracketDepth > 0) continue;
      for (const kw of blockOpen) {
        if (i + kw.length <= end && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
          const before = i > 0 ? source[i - 1] : ' ';
          const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
          if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
          if (before === '.') continue;
          if (this.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
          if (kw === 'begin') {
            // Check if followed by `:` (firstindex syntax). Skip whitespace in between.
            let k = i + kw.length;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++;
            if (k < source.length && source[k] === ':' && source[k + 1] !== ':') {
              // firstindex; does not open a block
              i += kw.length - 1;
              break;
            }
            nonFirstindexBegins++;
            i += kw.length - 1;
            break;
          }
          depth++;
          i += kw.length - 1;
          break;
        }
      }
    }
    return depth === 0 && nonFirstindexBegins === 0;
  }

  // Checks if there is a matching ']' that closes the current bracket group after 'from'
  private hasMatchingCloseBracket(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 1;
    for (let i = from; i < source.length; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) return true;
      }
    }
    return false;
  }

  // Checks if there is a matching ')' that closes the current paren group after 'from'
  private hasMatchingCloseParen(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 1;
    for (let i = from; i < source.length; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const ch = source[i];
      if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) return true;
      }
    }
    return false;
  }

  // Checks if 'if' is a comprehension filter inside brackets (for...if pattern)
  // Returns true only when there's a 'for' keyword between the unmatched '[' and position
  // If there's an unmatched block opener in the range, 'if' is inside a block body, not a filter.
  private isComprehensionFilterInBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          return hasForBetween(source, i + 1, position, excludedRegions, this.juliaHelperCallbacks);
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) return false;
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if 'if' is a generator filter inside parentheses (for...if pattern)
  // If there's an unmatched block opener in the range, 'if' is inside a block body, not a filter.
  private isGeneratorFilterIf(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const char = source[i];
      if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          return hasForBetween(source, i + 1, position, excludedRegions, this.juliaHelperCallbacks);
        }
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if a position is inside unmatched parentheses (for generator expressions)
  // Returns false if there's a block opener between the unmatched '(' and position
  // (which indicates a block expression like f(if x > 0 x else -x end))
  // Also returns false for named tuple context: (a = for ...) where '=' before 'for'
  // indicates assignment, not a generator expression
  private isInsideParentheses(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let bracketDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) {
          // The keyword is directly inside `[...]` (possibly nested in `(...)`).
          // Bracket-form constructs like `[for ...]` handled separately by isInsideSquareBrackets.
          return false;
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Comma at depth 0 may indicate trailing generator: f(x, y for y in iter)
          // If `for` is preceded by a value expression, treat as generator
          if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
            return this.isPrecededByValueExpression(source, position, excludedRegions);
          }
          // for at start of parentheses is a block, not a generator (generators need expr before for)
          if (isOnlyWhitespaceBetween(source, i + 1, position, excludedRegions)) {
            return false;
          }
          // Check for named tuple context: (name = for ...)
          // If there's a '=' (not '==') between '(' and the keyword, it could be either:
          //   - Assignment with block-form RHS: (name = for ...) — keyword IS block opener.
          //   - Generator with named binding: (name = value for x in iter) — keyword is generator.
          // Distinguish by whether the keyword is preceded by a value expression.
          // For assignment-with-block-form, `for` is immediately after `=` (no value between).
          if (hasAssignmentBetween(source, i + 1, position, excludedRegions)) {
            return this.isPrecededByValueExpression(source, position, excludedRegions);
          }
          return true;
        }
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if position is inside square brackets only (for other block keywords)
  // Julia allows block expressions inside parentheses, so only [] excludes them
  // Keywords inside parentheses within brackets are valid (e.g., a[map(1:3) do x ... end])
  private isInsideSquareBrackets(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let parenDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) {
          // If inside parentheses within brackets, only `begin` (firstindex) cares about
          // the outer indexing context. Other block keywords are valid inside parens.
          if (parenDepth > 0 && keyword !== 'begin') return false;
          // If there's a block opener between [ and the keyword, the block expression is valid
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Only indexing brackets exclude block keywords, not array construction
          if (!isIndexingBracket(source, i)) {
            return false;
          }
          // `begin` inside indexing brackets is normally the firstindex keyword. But if the
          // bracket has no matching `]` (e.g., user editing in progress), treat as a real
          // block opener so the begin/end pair is detected.
          if (keyword === 'begin') {
            if (!this.hasMatchingCloseBracket(source, i + 1, excludedRegions)) {
              return false;
            }
            return true;
          }
          // Other block keywords inside indexing brackets may form a block expression
          // if a matching `end` exists before the bracket closes
          // (e.g., a[quote x = 1 end] — the `quote/end` block evaluates to a value used as the index)
          if (this.hasMatchingEndBeforeBracketClose(source, position + keyword.length, excludedRegions)) {
            return false;
          }
          return true;
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          // We've exited a paren going backward. For `begin`, continue scanning so that
          // `arr[(begin:end)]` is recognized: outer `[` makes begin a firstindex.
          if (keyword === 'begin') {
            continue;
          }
          return false;
        }
        parenDepth--;
      }
    }
    return false;
  }

  // Forward-scan from `from` looking for the `end` that matches the current opener.
  // Returns true if a matching `end` is found before the enclosing indexing `]` closes.
  private hasMatchingEndBeforeBracketClose(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    let blockDepth = 1;
    let i = from;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }
      const ch = source[i];
      if (ch === '[') {
        bracketDepth++;
        i++;
        continue;
      }
      if (ch === ']') {
        if (bracketDepth === 0) {
          return false;
        }
        bracketDepth--;
        i++;
        continue;
      }
      if (ch === 'e' && i + 3 <= source.length && source.slice(i, i + 3) === 'end') {
        const before = i > 0 ? source[i - 1] : ' ';
        const after = i + 3 < source.length ? source[i + 3] : ' ';
        if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after) && before !== '.' && !this.isAdjacentToUnicodeLetter(source, i, 3)) {
          // Inside [ ] brackets, `end` is the lastindex reference, not a block close.
          if (bracketDepth === 0) {
            blockDepth--;
            if (blockDepth === 0) {
              return true;
            }
          }
          i += 3;
          continue;
        }
      }
      let matchedOpener = false;
      // Block openers inside [ ] are also not real block-form openers (they could be value
      // names like `Dict[begin]`). Skip opener matching while inside brackets.
      if (bracketDepth === 0) {
        for (const kw of this.keywords.blockOpen) {
          if (i + kw.length <= source.length && source[i] === kw[0] && source.slice(i, i + kw.length) === kw) {
            const before = i > 0 ? source[i - 1] : ' ';
            const after = i + kw.length < source.length ? source[i + kw.length] : ' ';
            if (/[a-zA-Z0-9_]/.test(before) || /[a-zA-Z0-9_]/.test(after)) continue;
            if (before === '.') continue;
            if (this.isAdjacentToUnicodeLetter(source, i, kw.length)) continue;
            blockDepth++;
            i += kw.length;
            matchedOpener = true;
            break;
          }
        }
      }
      if (matchedOpener) continue;
      i++;
    }
    return false;
  }

  // Checks if position is inside curly braces (type parameters like Dict{begin, end})
  private isInsideCurlyBraces(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let braceDepth = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const char = source[i];
      if (char === '}') {
        braceDepth++;
      } else if (char === '{') {
        if (braceDepth === 0) return true;
        braceDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) return false;
        parenDepth--;
      } else if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) return false;
        bracketDepth--;
      }
    }
    return false;
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
