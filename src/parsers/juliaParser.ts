// Julia block parser: handles nested multi-line comments #= =#, prefixed strings, and transpose operator

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { BaseBlockParser } from './baseParser';

export class JuliaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'function', 'for', 'while', 'struct', 'begin', 'try', 'let', 'module', 'baremodule', 'macro', 'quote', 'do'],
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

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Multi-line comment: #= ... =# (nestable)
    if (char === '#' && source[pos + 1] === '=') {
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

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Character literal (not transpose operator)
    if (char === "'") {
      if (this.isTransposeOperator(source, pos)) {
        return null;
      }
      return this.matchCharLiteral(source, pos);
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

  // Matches triple-quoted string: """ ... """
  private matchTripleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 3;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        return { start: pos, end: i + 3 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches prefixed strings: r"...", raw"...", b"...", s"...", v"..."
  private matchPrefixedString(source: string, pos: number): ExcludedRegion | null {
    const singlePrefixes = ['r', 'b', 's', 'v'];
    const char = source[pos];

    // Prefix must not be part of an identifier
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[\w]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
        return null;
      }
    }

    if (singlePrefixes.includes(char) && source[pos + 1] === '"') {
      // Check for triple-quoted prefixed string
      if (source.slice(pos + 1, pos + 4) === '"""') {
        return this.matchPrefixedTripleQuotedString(source, pos, 1);
      }
      // Regular prefixed string
      const stringEnd = this.findStringEnd(source, pos + 2, '"');
      return { start: pos, end: stringEnd };
    }

    // Check for "raw" prefix
    if (source.slice(pos, pos + 4) === 'raw"') {
      // Check for triple-quoted
      if (source.slice(pos + 3, pos + 6) === '"""') {
        return this.matchPrefixedTripleQuotedString(source, pos, 3);
      }
      const stringEnd = this.findStringEnd(source, pos + 4, '"');
      return { start: pos, end: stringEnd };
    }

    return null;
  }

  // Matches prefixed triple-quoted string
  private matchPrefixedTripleQuotedString(source: string, pos: number, prefixLength: number): ExcludedRegion {
    let i = pos + prefixLength + 3;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        return { start: pos, end: i + 3 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Finds the end of a string with escape sequence handling
  private findStringEnd(source: string, start: number, quote: string): number {
    let i = start;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
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
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, or certain operators
    if (!/[\w!%&*+\-/<=>?\\^|~]/.test(nextChar) && nextChar.charCodeAt(0) <= 127) {
      return false;
    }

    // Colon after identifier/number/bracket is ternary, not symbol
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[\w)\]}>]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
        return false;
      }
    }

    return true;
  }

  // Matches symbol literal including operator symbols and Unicode
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      const char = source[i];
      // Symbol can contain word characters, operators, and Unicode
      if (/[\w!%+\-*/^&|~<>@]/.test(char) || char.charCodeAt(0) > 127) {
        i++;
        continue;
      }
      break;
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
      if (source[i] === '\n') {
        break;
      }
      i++;
    }

    return { start: pos, end: i };
  }

  // Matches command string (backtick)
  private matchCommandString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
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
