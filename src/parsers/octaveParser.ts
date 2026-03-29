// Octave block parser: extends MATLAB with # comments, #{ #} block comments, and Octave-specific end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { MatlabBlockParser } from './matlabParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping of Octave-specific close keywords to their valid openers
const LINE_CONTINUATION_PATTERN = /^\.\.\.(?:[^\r\n]*)(?:\r\n|\r|\n)/;
const BACKSLASH_CONTINUATION_PATTERN = /^\\[ \t]*(?:\r\n|\r|\n)/;

const OCTAVE_CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
  endfunction: 'function',
  endif: 'if',
  endfor: 'for',
  endwhile: 'while',
  endswitch: 'switch',
  end_try_catch: 'try',
  endparfor: 'parfor',
  end_unwind_protect: 'unwind_protect',
  endclassdef: 'classdef',
  endmethods: 'methods',
  endproperties: 'properties',
  endevents: 'events',
  endenumeration: 'enumeration',
  endarguments: 'arguments',
  endspmd: 'spmd',
  until: 'do'
};

export class OctaveBlockParser extends MatlabBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'function',
      'if',
      'for',
      'while',
      'do',
      'switch',
      'try',
      'parfor',
      'spmd',
      'classdef',
      'methods',
      'properties',
      'events',
      'enumeration',
      'arguments',
      'unwind_protect'
    ],
    blockClose: [
      'end',
      'until',
      'endfunction',
      'endif',
      'endfor',
      'endwhile',
      'endswitch',
      'end_try_catch',
      'endparfor',
      'end_unwind_protect',
      'endclassdef',
      'endmethods',
      'endproperties',
      'endevents',
      'endenumeration',
      'endarguments',
      'endspmd'
    ],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch', 'unwind_protect_cleanup']
  };

  // Octave uses # as a comment character in addition to %
  protected override isCommentChar(char: string): boolean {
    return char === '#' || char === '%';
  }

  // Reject block open keywords used as variable names (do = 1, if = 5, etc.)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
      return false;
    }
    return super.isValidBlockOpen(keyword, source, position, excludedRegions);
  }

  // Reject block close keywords used as variable names (end = 5, endif = 1, etc.)
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
      return false;
    }
    return super.isValidBlockClose(keyword, source, position, excludedRegions);
  }

  // Filter out middle keywords used as variable names (else = 5, case += 1, etc.)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((t) => t.type !== 'block_middle' || !this.isFollowedByAssignment(source, t.startOffset + t.value.length));
  }

  // Checks if position is followed by = or compound assignment (+=, -=, *=, /=, ^=, .+=, .-=, .*=, ./=, .^=)
  // but not == (comparison)
  protected isFollowedByAssignment(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length) {
      if (source[i] === ' ' || source[i] === '\t') {
        i++;
        continue;
      }
      // Skip ... line continuation followed by a newline
      const continuation = source.slice(i).match(LINE_CONTINUATION_PATTERN);
      if (continuation) {
        i += continuation[0].length;
        continue;
      }
      // Skip \ line continuation followed by a newline
      const backslashContinuation = source.slice(i).match(BACKSLASH_CONTINUATION_PATTERN);
      if (backslashContinuation) {
        i += backslashContinuation[0].length;
        continue;
      }
      break;
    }
    if (i >= source.length) {
      return false;
    }
    // Simple assignment: = (but not ==)
    if (source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
      return true;
    }
    // Compound assignment: +=, -=, *=, /=, ^=, |=, &=
    if (
      (source[i] === '+' ||
        source[i] === '-' ||
        source[i] === '*' ||
        source[i] === '/' ||
        source[i] === '^' ||
        source[i] === '|' ||
        source[i] === '&') &&
      i + 1 < source.length &&
      source[i + 1] === '='
    ) {
      return true;
    }
    // Element-wise compound assignment: .+=, .-=, .*=, ./=, .^=
    if (
      source[i] === '.' &&
      i + 2 < source.length &&
      (source[i + 1] === '+' || source[i + 1] === '-' || source[i + 1] === '*' || source[i + 1] === '/' || source[i + 1] === '^') &&
      source[i + 2] === '='
    ) {
      return true;
    }
    return false;
  }

  // Custom block matching for Octave-specific end keywords
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
            const middleValue = token.value.toLowerCase();
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            // Validate intermediate keyword against opener type
            if (middleValue === 'else' || middleValue === 'elseif') {
              if (topOpener !== 'if') break;
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
            } else if (middleValue === 'unwind_protect_cleanup') {
              if (topOpener !== 'unwind_protect') break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's an Octave-specific end keyword
          // Only match if the opener is at the top of the stack (don't skip intervening unclosed blocks)
          const validOpener = OCTAVE_CLOSE_TO_OPEN[closeValue];
          if (validOpener) {
            const foundIndex = findLastOpenerByType(stack, validOpener, true);
            if (foundIndex === stack.length - 1) {
              matchIndex = foundIndex;
            }
          }

          // If no specific match found, only fallback for generic 'end'
          // Generic 'end' should NOT close 'do' blocks (only 'until' can)
          // Only check top of stack - don't skip past unclosed do blocks
          if (matchIndex < 0 && !validOpener && stack.length > 0) {
            if (stack[stack.length - 1].token.value.toLowerCase() !== 'do') {
              matchIndex = stack.length - 1;
            }
          }

          if (matchIndex >= 0) {
            const openBlock = stack.splice(matchIndex, 1)[0];
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

  // Tries to match an excluded region at the given position (overrides parent)
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (MATLAB style, at line start with optional whitespace, no trailing content)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Block comment: #{ ... #} (Octave style, at line start with optional whitespace, no trailing content)
    if (char === '#' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Single-line comment: % (MATLAB style)
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-line comment: # (Octave style)
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // String literal: '...' (MATLAB/Octave style)
    if (char === "'") {
      return this.matchOctaveString(source, pos, "'");
    }

    // Double-quoted string: "..."
    if (char === '"') {
      return this.matchOctaveString(source, pos, '"');
    }

    // Line continuation: ... to end of line (treated as comment)
    if (char === '.' && pos + 2 < source.length && source[pos + 1] === '.' && source[pos + 2] === '.') {
      return this.matchSingleLineComment(source, pos);
    }

    // Line continuation: \ followed by optional whitespace and newline
    if (char === '\\') {
      const match = source.slice(pos).match(BACKSLASH_CONTINUATION_PATTERN);
      if (match) {
        return { start: pos, end: pos + match[0].length };
      }
    }

    // Shell escape command: ! to end of line (only at line start)
    if (char === '!' && this.isAtLineStartWithWhitespace(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if block comment opener (%{ or #{) has no trailing non-whitespace content
  private isOctaveBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      if (source[i] !== ' ' && source[i] !== '\t') {
        return false;
      }
      i++;
    }
    return true;
  }

  // Overrides parent to support cross-type delimiters: %{/%} and #{/#} are interchangeable in Octave
  protected override matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      // Check for nested block comment opener: %{ or #{
      if ((source[i] === '%' || source[i] === '#') && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isOctaveBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      // Check for block comment closer: %} or #}
      if ((source[i] === '%' || source[i] === '#') && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
          let trailingPos = i + 2;
          let hasTrailingContent = false;
          while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
            if (source[trailingPos] !== ' ' && source[trailingPos] !== '\t') {
              hasTrailingContent = true;
              break;
            }
            trailingPos++;
          }
          if (!hasTrailingContent) {
            depth--;
            if (depth === 0) {
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
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches string with specified quote character
  private matchOctaveString(source: string, pos: number, quote: string): ExcludedRegion {
    // Check if single quote is a transpose operator (after identifier, number, ], }, or .)
    if (quote === "'" && pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}.'"]/.test(prevChar) || /\p{L}/u.test(prevChar)) {
        // After a digit, check if ' starts a string (e.g., [1'text'])
        if (/[0-9]/.test(prevChar)) {
          const nextChar = pos + 1 < source.length ? source[pos + 1] : undefined;
          if (nextChar && /[a-zA-Z_]/.test(nextChar)) {
            // Fall through to string matching
          } else {
            return { start: pos, end: pos + 1 };
          }
        } else if (prevChar === "'") {
          // Quote immediately after another quote: still transpose
          // A'' = two transposes, each ' follows a value (result of prior transpose)
          return { start: pos, end: pos + 1 };
        } else {
          return { start: pos, end: pos + 1 };
        }
      }
    }

    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\') {
        // Octave supports backslash escapes in double-quoted strings
        if (quote === '"' && i + 1 < source.length) {
          // Handle CRLF: \<CR><LF> should skip both characters
          if (source[i + 1] === '\r' && i + 2 < source.length && source[i + 2] === '\n') {
            i += 3;
          } else {
            i += 2;
          }
          continue;
        }
      }
      if (source[i] === quote) {
        // Doubled quote escape: only for single-quoted strings
        // In double-quoted strings, backslash escapes handle quote embedding
        if (quote === "'" && i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
