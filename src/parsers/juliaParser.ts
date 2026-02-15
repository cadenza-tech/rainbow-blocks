// Julia block parser: handles nested multi-line comments #= =#, prefixed strings, and transpose operator

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { BaseBlockParser } from './baseParser';

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

  // Finds excluded regions: comments, strings, symbols, command strings
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Validates block open keywords
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // abstract/primitive must be followed by 'type' keyword
    if (keyword === 'abstract' || keyword === 'primitive') {
      const afterKeyword = source.slice(position + keyword.length);
      return /^\s+type\b/.test(afterKeyword);
    }

    // for/if inside brackets or parentheses are array comprehensions/generators
    if (keyword === 'for' || keyword === 'if') {
      if (this.isInsideBrackets(source, position, excludedRegions) || this.isInsideParentheses(source, position, excludedRegions)) {
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

  // Validates block close: 'end' inside brackets or parens is array indexing, not block close
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (keyword === 'end') {
      return !this.isInsideBrackets(source, position, excludedRegions);
    }
    return true;
  }

  // Checks if position is inside brackets or parentheses
  private isInsideBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let bracketDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ']') {
        bracketDepth++;
      } else if (char === '[') {
        if (bracketDepth === 0) return true;
        bracketDepth--;
      }
    }
    return false;
  }

  // Checks if a position is inside unmatched parentheses (for generator expressions)
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
        if (parenDepth === 0) return true;
        parenDepth--;
      }
    }
    return false;
  }

  // Checks if position is inside square brackets only (for array comprehensions)
  // Julia allows block expressions inside parentheses, so only [] excludes for/if
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
        if (bracketDepth === 0) return true;
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

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
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
  private matchMultiLineComment(source: string, pos: number): ExcludedRegion | null {
    if (source.slice(pos, pos + 2) !== '#=') {
      return null;
    }

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
        // r"..." and raw"..." don't support $() interpolation
        const interp = prefix !== 'r' && prefix !== 'raw';
        // Check for triple-quoted prefixed string
        if (source.slice(prefixEnd, prefixEnd + 3) === '"""') {
          return this.matchPrefixedTripleQuotedString(source, pos, prefixLength, interp);
        }
        // Regular prefixed string
        const stringEnd = this.findStringEnd(source, prefixEnd + 1, '"', interp);
        return { start: pos, end: stringEnd };
      }
    }

    return null;
  }

  // Checks if a word is a block keyword
  private isBlockKeyword(word: string): boolean {
    return this.keywords.blockOpen.includes(word) || this.keywords.blockClose.includes(word) || this.keywords.blockMiddle.includes(word);
  }

  // Matches prefixed triple-quoted string with optional $() interpolation
  private matchPrefixedTripleQuotedString(source: string, pos: number, prefixLength: number, interpolating = true): ExcludedRegion {
    let i = pos + prefixLength + 3;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation
      if (interpolating && source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
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

  // Finds the end of a string with escape sequence and interpolation handling
  private findStringEnd(source: string, start: number, quote: string, interpolating = true): number {
    let i = start;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle $(...) interpolation (quotes inside don't end the string)
      if (interpolating && source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
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
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, @, or certain operators
    if (!/[\w!%&*+\-/<=>?\\^|~@]/.test(nextChar) && nextChar.charCodeAt(0) <= 127) {
      return false;
    }

    // Colon after identifier/number/bracket is ternary, not symbol
    // :: (type annotation) second colon is not a symbol start
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (prevChar === ':' || /[\w)\]}>]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
        return false;
      }
    }

    return true;
  }

  // Matches symbol literal including operator symbols and Unicode
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    const firstChar = source[i];

    // Determine if this is an identifier symbol or operator symbol
    if (/[\w]/.test(firstChar) || firstChar.charCodeAt(0) > 127) {
      // Identifier symbol: consume only word characters and Unicode
      while (i < source.length) {
        const char = source[i];
        if (/[\w!]/.test(char) || char.charCodeAt(0) > 127) {
          i++;
          continue;
        }
        break;
      }
    } else {
      // Operator symbol: consume only operator characters
      while (i < source.length) {
        const char = source[i];
        if (/[!%&*+\-/<=>?\\^|~@]/.test(char)) {
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
    if (pos === 0) {
      return false;
    }

    const prevChar = source[pos - 1];

    // Transpose follows closing brackets
    if (prevChar === ')' || prevChar === ']' || prevChar === '}') {
      return true;
    }

    // Transpose follows identifiers or Unicode letters
    if (/[\w]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
      return true;
    }

    return false;
  }

  // Matches character literal (doesn't span multiple lines)
  private matchCharLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
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
        return { start: pos, end: i + 3 };
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

  // Skips $() interpolation block, tracking paren depth
  private skipJuliaInterpolation(source: string, pos: number): number {
    let depth = 1;
    let i = pos;
    while (i < source.length && depth > 0) {
      // Handle #= multi-line comments inside interpolation
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '=') {
        i += 2;
        let commentDepth = 1;
        while (i < source.length && commentDepth > 0) {
          if (source.slice(i, i + 2) === '#=') {
            commentDepth++;
            i += 2;
            continue;
          }
          if (source.slice(i, i + 2) === '=#') {
            commentDepth--;
            i += 2;
            continue;
          }
          i++;
        }
        continue;
      }
      // Handle # line comments inside interpolation
      if (source[i] === '#') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Handle char literals inside interpolation (e.g. ')')
      if (source[i] === "'" && !this.isTransposeOperator(source, i)) {
        i = this.skipCharLiteral(source, i);
        continue;
      }
      // Handle backtick command strings inside interpolation
      if (source[i] === '`') {
        i = this.skipBacktickString(source, i);
        continue;
      }
      if (source[i] === '(') {
        depth++;
      } else if (source[i] === ')') {
        depth--;
      } else if (source[i] === '"') {
        i = this.skipNestedJuliaString(source, i);
        continue;
      }
      i++;
    }
    return i;
  }

  // Skips a nested string inside interpolation (handles both regular and triple-quoted)
  private skipNestedJuliaString(source: string, pos: number): number {
    // Check for triple-quoted string
    if (source.slice(pos, pos + 3) === '"""') {
      let i = pos + 3;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
          i = this.skipJuliaInterpolation(source, i + 2);
          continue;
        }
        if (source.slice(i, i + 3) === '"""') {
          return i + 3;
        }
        i++;
      }
      return i;
    }
    // Regular single-quoted string
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '"') {
        return i + 1;
      }
      i++;
    }
    return i;
  }

  // Skips a character literal (for use inside interpolation scanning)
  private skipCharLiteral(source: string, pos: number): number {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === "'") {
        return i + 1;
      }
      if (source[i] === '\n' || source[i] === '\r') {
        return i;
      }
      i++;
    }
    return i;
  }

  // Skips a backtick command string (for use inside interpolation/nested string scanning)
  private skipBacktickString(source: string, pos: number): number {
    // Check for triple backtick
    if (source.slice(pos, pos + 3) === '```') {
      let i = pos + 3;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
          i = this.skipJuliaInterpolation(source, i + 2);
          continue;
        }
        if (source.slice(i, i + 3) === '```') {
          return i + 3;
        }
        i++;
      }
      return i;
    }
    // Single backtick
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = this.skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source[i] === '`') {
        return i + 1;
      }
      i++;
    }
    return i;
  }

  // Matches command string (backtick)
  private matchCommandString(source: string, pos: number): ExcludedRegion {
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
      if (source[i] === '`') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
