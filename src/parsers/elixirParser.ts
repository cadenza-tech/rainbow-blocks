// Elixir block parser: handles sigils, do: one-liners, keyword arguments, and atoms

import type { ExcludedRegion, LanguageKeywords, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  isAtomStart,
  matchAtomLiteral,
  matchElixirCharlist,
  matchElixirString,
  matchSigil,
  matchTripleQuotedString,
  skipNestedSigil,
  skipNestedString,
  skipNestedTripleQuotedString
} from './elixirHelpers';

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

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];
    const skipInterpolationBound = this.skipInterpolation.bind(this);

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

    // Sigil (~r, ~s, ~w, etc)
    if (char === '~' && pos + 1 < source.length) {
      const result = matchSigil(source, pos, skipInterpolationBound);
      if (result) return result;
    }

    // Atom literal
    if (char === ':' && isAtomStart(source, pos)) {
      return matchAtomLiteral(source, pos, skipInterpolationBound);
    }

    return null;
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    let depth = 1;
    let i = pos;
    const skipInterpolationBound = this.skipInterpolation.bind(this);
    while (i < source.length && depth > 0) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '{') {
        depth++;
      } else if (source[i] === '}') {
        depth--;
      } else if (source[i] === '"' && source.slice(i, i + 3) === '"""') {
        // Triple-quoted string (heredoc) inside interpolation
        i = skipNestedTripleQuotedString(source, i, '"""', skipInterpolationBound);
        continue;
      } else if (source[i] === "'" && source.slice(i, i + 3) === "'''") {
        // Triple single-quoted charlist heredoc inside interpolation
        i = skipNestedTripleQuotedString(source, i, "'''", skipInterpolationBound);
        continue;
      } else if (source[i] === '"') {
        i = skipNestedString(source, i, skipInterpolationBound);
        continue;
      } else if (source[i] === "'") {
        i = skipNestedString(source, i, skipInterpolationBound);
        continue;
      } else if (source[i] === '#') {
        // # starts a comment in interpolation code, skip to end of line
        // Nested #{} inside strings is handled by skipNestedString above
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      } else if (source[i] === '~' && i + 1 < source.length && /[a-zA-Z]/.test(source[i + 1])) {
        // Skip sigil inside interpolation (e.g. ~s(}))
        const sigilEnd = skipNestedSigil(source, i, skipInterpolationBound);
        if (sigilEnd > i) {
          i = sigilEnd;
          continue;
        }
      }
      i++;
    }
    return i;
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
    if (this.isDoColonOneLiner(keyword, source, position, excludedRegions)) {
      return false;
    }

    return true;
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
      if (token.type === 'block_middle' && token.endOffset < source.length && source[token.endOffset] === ':') {
        return false;
      }
      return true;
    });
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

      // Track parentheses depth
      if (char === '(') {
        parenDepth++;
      } else if (char === ')') {
        parenDepth--;
      } else if (char === '[') {
        bracketDepth++;
      } else if (char === ']') {
        bracketDepth--;
      } else if (char === '{') {
        braceDepth++;
      } else if (char === '}') {
        braceDepth--;
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
        if (i > 0 && (/\s/.test(source[i - 1]) || source[i - 1] === ',') && source.slice(i, i + 2) === 'do') {
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
        if (this.isBlockKeywordAt(source, i)) {
          innerBlockDepth++;
        }

        // Track fn...end nesting at depth 0
        // Exclude fn: (keyword argument syntax)
        if (
          source.slice(i, i + 2) === 'fn' &&
          (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1])) &&
          (i + 2 >= source.length || !/[a-zA-Z0-9_:]/.test(source[i + 2]))
        ) {
          fnDepth++;
        }

        // "end" closes inner blocks or fn
        if (source.slice(i, i + 3) === 'end') {
          const beforeEnd = i > 0 ? source[i - 1] : ' ';
          const afterEnd = source[i + 3];
          if (!/[a-zA-Z0-9_]/.test(beforeEnd) && (afterEnd === undefined || !/[a-zA-Z0-9_:]/.test(afterEnd))) {
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
    // Must have word boundary before
    if (pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) {
      return false;
    }

    for (const kw of ElixirBlockParser.DO_BLOCK_KEYWORDS) {
      if (source.startsWith(kw, pos)) {
        const afterKw = source[pos + kw.length];
        // Must have word boundary after, and not be a keyword argument (e.g. for:)
        if (afterKw === undefined || (!/[a-zA-Z0-9_]/.test(afterKw) && afterKw !== ':')) {
          return true;
        }
      }
    }

    return false;
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

    // Find "do" on the same line, tracking bracket/paren/brace depth
    let i = position + keyword.length;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (i < source.length) {
      // Skip excluded regions (strings, comments, etc) before checking for newline
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
      if (source[i] === '\n' || source[i] === '\r') break;

      // Track bracket depth
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;

      // Only look for "do" outside all brackets
      if (parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) {
        i++;
        continue;
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
      i++;
    }

    return false;
  }
}
