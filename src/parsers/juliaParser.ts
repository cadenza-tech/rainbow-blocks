// Julia block parser: handles nested multi-line comments #= =#, prefixed strings, and transpose operator

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
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
        if (after === '!') {
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
      if (this.isInsideSquareBrackets(source, position, excludedRegions)) {
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
    return !this.isInsideIndexingBrackets(source, position, excludedRegions);
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
          // Comma at depth 0 means multiple elements, not a comprehension
          if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
            return false;
          }
          // for at start of brackets is a block, not a generator (generators need expr before for)
          if (isOnlyWhitespaceBetween(source, i + 1, position)) {
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
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Unmatched '[' (no closing ']') means the bracket is unclosed (likely during editing)
          // Keywords after it should still be valid block keywords
          if (!this.hasMatchingCloseBracket(source, position + 3, excludedRegions)) {
            return false;
          }
          return isIndexingBracket(source, i);
        }
        bracketDepth--;
      } else if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0 && bracketDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
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
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ')') {
        parenDepth++;
      } else if (char === '(') {
        if (parenDepth === 0) {
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Comma at depth 0 means multiple expressions (tuple/call), not a generator
          if (hasCommaAtDepthZero(source, i + 1, position, excludedRegions)) {
            return false;
          }
          // for at start of parentheses is a block, not a generator (generators need expr before for)
          if (isOnlyWhitespaceBetween(source, i + 1, position)) {
            return false;
          }
          // Check for named tuple context: (name = for ...)
          // If there's a '=' (not '==') between '(' and the keyword, it's assignment
          if (hasAssignmentBetween(source, i + 1, position, excludedRegions)) {
            return false;
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
  private isInsideSquareBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
          // If inside parentheses within brackets, the keyword is valid
          if (parenDepth > 0) return false;
          // If there's a block opener between [ and the keyword, the block expression is valid
          if (hasUnmatchedBlockOpenerBetween(source, i + 1, position, excludedRegions, this.keywords.blockOpen, this.juliaHelperCallbacks)) {
            return false;
          }
          // Only indexing brackets exclude block keywords, not array construction
          return isIndexingBracket(source, i);
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
    const char = source[pos];

    // Prefix must not be part of an identifier
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[\w]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
        return null;
      }
    }

    // Match any identifier prefix followed by " (Julia string macro syntax)
    if (/[a-zA-Z]/.test(char)) {
      let prefixEnd = pos + 1;
      while (prefixEnd < source.length && /[a-zA-Z0-9_]/.test(source[prefixEnd])) {
        prefixEnd++;
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

  // Matches triple backtick command string: ``` ... ```
  private matchTripleBacktickCommand(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;
    const isPrefixed = pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1]);

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
    const isPrefixed = pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1]);

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
