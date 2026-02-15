// Octave block parser: extends MATLAB with # comments, #{ #} block comments, and Octave-specific end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { MatlabBlockParser } from './matlabParser';

// Mapping of Octave-specific close keywords to their valid openers
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
      'endenumeration'
    ],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch', 'unwind_protect_cleanup']
  };

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
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's an Octave-specific end keyword
          const validOpener = OCTAVE_CLOSE_TO_OPEN[closeValue];
          if (validOpener) {
            matchIndex = this.findLastOpenerByType(stack, validOpener);
          }

          // If no specific match found, only fallback for generic 'end'
          // Generic 'end' should NOT close 'do' blocks (only 'until' can)
          if (matchIndex < 0 && !validOpener && stack.length > 0) {
            for (let si = stack.length - 1; si >= 0; si--) {
              if (stack[si].token.value.toLowerCase() !== 'do') {
                matchIndex = si;
                break;
              }
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

  // Finds the last opener that matches the given type
  private findLastOpenerByType(stack: OpenBlock[], openerType: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value.toLowerCase() === openerType) {
        return i;
      }
    }
    return -1;
  }
  // Finds excluded regions: adds Octave-specific # comments to MATLAB regions
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

  // Tries to match an excluded region at the given position (overrides parent)
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (MATLAB style, at line start with optional whitespace, no trailing content)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchMatlabBlockComment(source, pos);
      }
    }

    // Block comment: #{ ... #} (Octave style, at line start with optional whitespace, no trailing content)
    if (char === '#' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchOctaveBlockComment(source, pos);
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

  // Matches MATLAB-style block comment: %{ ... %} with nesting support
  private matchMatlabBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isOctaveBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
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
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches Octave-style block comment: #{ ... #} with nesting support
  private matchOctaveBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isOctaveBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
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
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches string with specified quote character
  private matchOctaveString(source: string, pos: number, quote: string): ExcludedRegion {
    // Check if single quote is a transpose operator (after identifier, number, ], }, or .)
    if (quote === "'" && pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}.]/.test(prevChar)) {
        // After a digit, check if ' starts a string (e.g., [1'text'])
        if (/[0-9]/.test(prevChar)) {
          const nextChar = source[pos + 1];
          if (nextChar && /[a-zA-Z_]/.test(nextChar)) {
            // Fall through to string matching
          } else {
            return { start: pos, end: pos + 1 };
          }
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
          i += 2;
          continue;
        }
      }
      if (source[i] === quote) {
        // Check for doubled quote escape
        if (i + 1 < source.length && source[i + 1] === quote) {
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
