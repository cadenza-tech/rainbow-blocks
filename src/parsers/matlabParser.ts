// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { BaseBlockParser } from './baseParser';

export class MatlabBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['function', 'if', 'for', 'while', 'switch', 'try', 'parfor', 'spmd', 'classdef', 'methods', 'properties', 'events', 'enumeration'],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch']
  };

  // Finds excluded regions: comments and strings
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
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %}
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Single-line comment: %
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // String literal: '...' (MATLAB uses '' for escaped single quote)
    if (char === "'") {
      return this.matchMatlabString(source, pos);
    }

    // Double-quoted string (MATLAB R2017a+)
    if (char === '"') {
      return this.matchDoubleQuotedString(source, pos);
    }

    return null;
  }

  // Matches block comment: %{ ... %}
  private matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    while (i < source.length) {
      // Look for %} at the start of a line
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStart(source, i)) {
          // Find end of line after %}
          let lineEnd = i + 2;
          while (lineEnd < source.length && source[lineEnd] !== '\n') {
            lineEnd++;
          }
          return { start: pos, end: lineEnd };
        }
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches MATLAB string: '...' with '' as escape
  private matchMatlabString(source: string, pos: number): ExcludedRegion {
    // Check if this is a transpose operator (after identifier, number, ], }, or .)
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}.]/.test(prevChar)) {
        // This is transpose, not string - return minimal region
        return { start: pos, end: pos + 1 };
      }
    }

    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        // Check for escaped quote ''
        if (i + 1 < source.length && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches double-quoted string: "..." with "" as escape
  private matchDoubleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        // Check for escaped quote ""
        if (i + 1 < source.length && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
