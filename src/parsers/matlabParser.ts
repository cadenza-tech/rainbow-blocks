// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class MatlabBlockParser extends BaseBlockParser {
  // Validates block close: 'end' inside parentheses or brackets is array indexing, not block close
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (keyword !== 'end') {
      return true;
    }
    // Reject end preceded by dot (struct field access like s.end)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }
    return !this.isInsideParensOrBrackets(source, position, excludedRegions);
  }

  // Classdef section keywords that can also be used as function calls
  private static readonly CLASSDEF_SECTION_KEYWORDS = new Set(['properties', 'methods', 'events', 'enumeration', 'arguments']);

  // Reject struct field access for block openers (s.if, s.for, etc)
  // Reject classdef section keywords used as function calls (properties(obj))
  protected isValidBlockOpen(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }
    if (MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      if (this.isKeywordUsedAsFunctionCall(source, position, keyword)) {
        return false;
      }
      // Check if keyword is used as a variable (followed by =, but not ==)
      let afterPos = position + keyword.length;
      while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
        afterPos++;
      }
      if (afterPos < source.length && source[afterPos] === '=' && source[afterPos + 1] !== '=') {
        return false;
      }
    }
    return true;
  }

  // Checks if a classdef section keyword is used as a function call
  // Returns true if the keyword is followed by '(' and preceded by
  // assignment, expression operator, or appears inside an expression
  private isKeywordUsedAsFunctionCall(source: string, position: number, keyword: string): boolean {
    // Check if followed by '(' (skip whitespace)
    let afterPos = position + keyword.length;
    while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
      afterPos++;
    }
    if (afterPos >= source.length || source[afterPos] !== '(') {
      return false;
    }

    // Check if preceded by an expression context on the same line
    let beforePos = position - 1;
    while (beforePos >= 0 && (source[beforePos] === ' ' || source[beforePos] === '\t')) {
      beforePos--;
    }
    if (beforePos < 0 || source[beforePos] === '\n') {
      // At start of line followed by '(' - function call like properties(obj)
      // But classdef section keywords at line start with '(' after are also
      // valid as access modifiers: properties (Access = public)
      // Check if there's a matching ')' then look at what follows
      // A simpler heuristic: if preceded by '=', ',', '(', '[', '{', or ';' it's a call
      return false;
    }

    const prevChar = source[beforePos];
    // If preceded by =, (, [, {, , or ; it's being used in an expression context
    if (prevChar === '=' || prevChar === '(' || prevChar === '[' || prevChar === '{' || prevChar === ',' || prevChar === ';') {
      return true;
    }

    return false;
  }

  // Filter out block_middle keywords that are struct field access (s.else, s.case)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      if (token.startOffset > 0 && source[token.startOffset - 1] === '.') {
        return false;
      }
      return true;
    });
  }

  // Checks if position is inside parentheses, square brackets, or curly braces
  private isInsideParensOrBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ')') parenDepth++;
      else if (char === '(') {
        if (parenDepth === 0) return true;
        parenDepth--;
      } else if (char === ']') bracketDepth++;
      else if (char === '[') {
        if (bracketDepth === 0) return true;
        bracketDepth--;
      } else if (char === '}') braceDepth++;
      else if (char === '{') {
        if (braceDepth === 0) return true;
        braceDepth--;
      }
    }
    return false;
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'function',
      'if',
      'for',
      'while',
      'switch',
      'try',
      'parfor',
      'spmd',
      'classdef',
      'methods',
      'properties',
      'events',
      'enumeration',
      'arguments'
    ],
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

  // Checks if position is at line start allowing leading whitespace
  protected isAtLineStartWithWhitespace(source: string, pos: number): boolean {
    if (pos === 0) return true;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (only if %{ is alone on the line)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isBlockCommentStart(source, pos)) {
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

    // Line continuation: ... to end of line (treated as comment)
    if (char === '.' && pos + 2 < source.length && source[pos + 1] === '.' && source[pos + 2] === '.') {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if %{ is alone on the line (no trailing non-whitespace content)
  private isBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      if (source[i] !== ' ' && source[i] !== '\t') {
        return false;
      }
      i++;
    }
    return true;
  }

  // Matches block comment: %{ ... %} with nesting support
  private matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      // Look for nested %{ at the start of a line
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      // Look for %} at the start of a line (allowing leading whitespace)
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
          depth--;
          if (depth === 0) {
            // Find end of line after %}
            let lineEnd = i + 2;
            while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
              lineEnd++;
            }
            return { start: pos, end: lineEnd };
          }
          i += 2;
          continue;
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
        // After a digit, check if ' starts a string (e.g., [1'text'])
        // If immediately followed by a letter, it's more likely a string
        if (/[0-9]/.test(prevChar)) {
          const nextChar = source[pos + 1];
          if (nextChar && /[a-zA-Z_]/.test(nextChar)) {
            // Fall through to string matching
          } else {
            return { start: pos, end: pos + 1 };
          }
        } else {
          // This is transpose, not string - return minimal region
          return { start: pos, end: pos + 1 };
        }
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
      if (source[i] === '\n' || source[i] === '\r') {
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
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
