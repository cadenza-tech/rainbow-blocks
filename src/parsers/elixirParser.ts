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

// Definition keywords that should not be treated as block opens after '..' range operator
const DEFINITION_KEYWORDS = new Set([
  'def',
  'defp',
  'defmodule',
  'defmacro',
  'defmacrop',
  'defguard',
  'defguardp',
  'defprotocol',
  'defimpl',
  'fn',
  'quote'
]);

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
      // Character literal: ?x (Elixir character literal)
      if (source[i] === '?' && i + 1 < source.length && (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1]))) {
        const charLitEnd = this.skipCharLiteral(source, i);
        if (charLitEnd > i) {
          i = charLitEnd;
          continue;
        }
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
      } else if (
        source[i] === '~' &&
        i + 1 < source.length &&
        /[a-zA-Z]/.test(source[i + 1]) &&
        (i === 0 || !this.isPrecededByIdentifier(source, i))
      ) {
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

    // Reject function call form with multiple args: keyword followed by '(' containing a comma
    // e.g., if(cond, do: val) is a function call, not a block
    // But allow parenthesized condition: if(true) do...end is a valid block
    if (afterKeyword === '(') {
      if (this.hasCommaInParens(source, position + keyword.length)) {
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
      // Character literal prefix: ?end, ?else, etc. are character literals, not keywords
      if (token.startOffset > 0 && source[token.startOffset - 1] === '?') {
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
      // Reject middle keywords preceded by '..' range operator (e.g., 1..else)
      if (token.type === 'block_middle' && token.startOffset >= 2 && source[token.startOffset - 1] === '.' && source[token.startOffset - 2] === '.') {
        return false;
      }
      return true;
    });
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
        if (this.isBlockKeywordAt(source, i) && !this.isBlockKeywordFunctionCall(source, i)) {
          innerBlockDepth++;
        }

        // Track fn...end nesting at depth 0
        // Exclude fn: (keyword argument syntax), .fn (method call), @fn (module attribute), fn() (function call)
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
  // Used to distinguish function call form if(cond, do: val) from block form if(true)
  private hasCommaInParens(source: string, pos: number): boolean {
    if (pos >= source.length || source[pos] !== '(') return false;
    let depth = 1;
    for (let i = pos + 1; i < source.length && depth > 0; i++) {
      const ch = source[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (depth === 1 && ch === ',') return true;
    }
    return false;
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

  // Checks if a block keyword is used as a bare value rather than starting a nested block
  // Detects two patterns:
  //   1. Followed by comma: "if cond, do: v" - cond is a value
  //   2. Followed by "do" keyword: "if cond do" - cond is a variable, do belongs to outer if
  private isKeywordUsedAsValue(source: string, afterPos: number): boolean {
    let j = afterPos;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
    if (j < source.length && source[j] === ',') {
      return true;
    }
    // Check if directly followed by "do" with word boundary
    if (source.slice(j, j + 2) === 'do') {
      const afterDo = source[j + 2];
      if (afterDo === undefined || /[\s,;:#]/.test(afterDo)) {
        return true;
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

      // Track bracket depth
      const ch = source[i];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;

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
          if (this.isBlockKeywordAt(source, i) && !this.isKeywordUsedAsValue(source, i + word.length)) {
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
