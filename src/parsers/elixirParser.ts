// Elixir block parser: handles sigils, do: one-liners, keyword arguments, and atoms

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { BaseBlockParser } from './baseParser';

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

  // Finds excluded regions: comments, strings, sigils, atoms
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

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Triple-quoted heredoc (check before regular string)
    if (source.slice(pos, pos + 3) === '"""') {
      return this.matchTripleQuotedString(source, pos, '"""');
    }

    // Triple single-quoted heredoc
    if (source.slice(pos, pos + 3) === "'''") {
      return this.matchTripleQuotedString(source, pos, "'''");
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted charlist
    if (char === "'") {
      return this.matchQuotedString(source, pos, "'");
    }

    // Sigil (~r, ~s, ~w, etc)
    if (char === '~' && pos + 1 < source.length) {
      const result = this.matchSigil(source, pos);
      if (result) return result;
    }

    // Atom literal
    if (char === ':' && this.isAtomStart(source, pos)) {
      return this.matchAtomLiteral(source, pos);
    }

    return null;
  }

  // Checks if colon starts an atom (not keyword list key)
  private isAtomStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Atom must start with letter, underscore, or quote
    if (!/[a-zA-Z_"']/.test(nextChar)) {
      return false;
    }

    // Colon after identifier/number/bracket is not an atom
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}>]/.test(prevChar)) {
        return false;
      }
    }

    return true;
  }

  // Matches atom literal: :atom, :"quoted", :'quoted'
  private matchAtomLiteral(source: string, pos: number): ExcludedRegion {
    const nextChar = source[pos + 1];

    // Quoted atom
    if (nextChar === '"' || nextChar === "'") {
      const quote = nextChar;
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          return { start: pos, end: i + 1 };
        }
        i++;
      }
      return { start: pos, end: i };
    }

    // Simple atom
    let i = pos + 1;
    while (i < source.length) {
      const char = source[i];
      if (/[a-zA-Z0-9_!?@]/.test(char)) {
        i++;
        continue;
      }
      break;
    }

    return { start: pos, end: i };
  }

  // Matches triple-quoted string (heredoc)
  private matchTripleQuotedString(source: string, pos: number, delimiter: string): ExcludedRegion {
    let i = pos + 3;
    while (i < source.length) {
      if (source.slice(i, i + 3) === delimiter) {
        return { start: pos, end: i + 3 };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches sigil (~r/.../, ~s(...), ~w[...], etc)
  private matchSigil(source: string, pos: number): ExcludedRegion | null {
    const nextChar = source[pos + 1];

    // Must be a valid sigil specifier (letter)
    if (!/[a-zA-Z]/.test(nextChar)) {
      return null;
    }

    // Find delimiter position (skip additional letters for uppercase sigils)
    let delimiterPos = pos + 2;
    while (delimiterPos < source.length && /[a-zA-Z]/.test(source[delimiterPos])) {
      delimiterPos++;
    }

    if (delimiterPos >= source.length) {
      return null;
    }

    const openDelimiter = source[delimiterPos];
    const closeDelimiter = this.getSigilCloseDelimiter(openDelimiter);

    if (!closeDelimiter) {
      return null;
    }

    // Check for heredoc-style sigil (~S""")
    if (source.slice(delimiterPos, delimiterPos + 3) === '"""' || source.slice(delimiterPos, delimiterPos + 3) === "'''") {
      const tripleDelim = source.slice(delimiterPos, delimiterPos + 3);
      let i = delimiterPos + 3;
      while (i < source.length) {
        if (source.slice(i, i + 3) === tripleDelim) {
          // Skip optional modifiers after closing
          let end = i + 3;
          while (end < source.length && /[a-zA-Z]/.test(source[end])) {
            end++;
          }
          return { start: pos, end };
        }
        i++;
      }
      return { start: pos, end: source.length };
    }

    let i = delimiterPos + 1;
    let depth = 1;
    const isPaired = openDelimiter !== closeDelimiter;
    const isLowercase = /[a-z]/.test(nextChar);

    while (i < source.length && depth > 0) {
      // Handle escape sequences for lowercase sigils
      if (isLowercase && source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (isPaired && source[i] === openDelimiter) {
        depth++;
      } else if (source[i] === closeDelimiter) {
        depth--;
      }
      i++;
    }

    // Skip optional modifiers after closing delimiter
    while (i < source.length && /[a-zA-Z]/.test(source[i])) {
      i++;
    }

    return { start: pos, end: i };
  }

  // Returns matching close delimiter for sigils
  private getSigilCloseDelimiter(open: string): string | null {
    const pairs: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}',
      '<': '>'
    };

    if (open in pairs) {
      return pairs[open];
    }

    // Non-paired delimiters (/, |, ", ', etc)
    if (/[^a-zA-Z0-9\s]/.test(open)) {
      return open;
    }

    return null;
  }

  // Validates block open keywords, excluding do: one-liners and keyword arguments
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Check for keyword argument (e.g., if:)
    if (this.isKeywordArgument(source, position + keyword.length)) {
      return false;
    }

    // fn-end doesn't use "do"
    if (keyword === 'fn') {
      return true;
    }

    // Check if "do" exists for other keywords
    if (!this.hasDoKeyword(source, position + keyword.length, excludedRegions)) {
      return false;
    }

    // Check for do: one-liner pattern
    if (this.isDoColonOneLiner(keyword, source, position)) {
      return false;
    }

    return true;
  }

  // Validates block close keywords, rejecting keyword arguments (e.g., end:)
  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    if (this.isKeywordArgument(source, position + keyword.length)) {
      return false;
    }
    return true;
  }

  // Checks if position is followed by colon (keyword argument syntax)
  private isKeywordArgument(source: string, position: number): boolean {
    return position < source.length && source[position] === ':';
  }

  // Checks if "do" keyword exists after position (not inside parentheses)
  private hasDoKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position;
    let parenDepth = 0;

    while (i < source.length) {
      // Skip to end of excluded region if inside one (using binary search)
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      const char = source[i];

      // Track parentheses depth
      if (char === '(') {
        parenDepth++;
      } else if (char === ')') {
        parenDepth--;
      }

      // Only look for "do" outside parentheses
      if (parenDepth === 0) {
        // Check for "do" with word boundary
        if (i > 0 && /\s/.test(source[i - 1]) && source.slice(i, i + 2) === 'do') {
          const afterDo = source[i + 2];
          if (afterDo === undefined || /[\s\n]/.test(afterDo)) {
            return true;
          }
        }

        // Check for ", do" pattern
        if (source.slice(i, i + 4) === ', do') {
          const afterDo = source[i + 4];
          if (afterDo === undefined || /[\s\n]/.test(afterDo)) {
            return true;
          }
        }

        // Stop if "end" is reached
        if (source.slice(i, i + 3) === 'end') {
          const beforeEnd = i > 0 ? source[i - 1] : ' ';
          const afterEnd = source[i + 3];
          if (/[\s\n]/.test(beforeEnd) && (afterEnd === undefined || /[\s\n]/.test(afterEnd))) {
            return false;
          }
        }
      }

      i++;
    }
    return false;
  }

  // Checks if this is a do: one-liner
  private isDoColonOneLiner(keyword: string, source: string, position: number): boolean {
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
      'defmacro',
      'defmacrop',
      'defguard',
      'defguardp',
      'quote'
    ];

    if (!doColonKeywords.includes(keyword)) {
      return false;
    }

    // Find "do" on the same line
    let i = position + keyword.length;

    while (i < source.length && source[i] !== '\n') {
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
        let j = doStart + 2;

        // Skip whitespace after "do"
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }

        // Check for colon
        if (source[j] === ':') {
          return true;
        }
      }
      i++;
    }

    return false;
  }
}
