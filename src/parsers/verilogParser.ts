// Verilog block parser: module→endmodule, case→endcase, fork→join, begin→end

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Mapping of close keywords to their valid openers
const CLOSE_TO_OPEN: Readonly<Record<string, readonly string[]>> = {
  endmodule: ['module'],
  endfunction: ['function'],
  endtask: ['task'],
  endcase: ['case', 'casez', 'casex'],
  endgenerate: ['generate'],
  join: ['fork'],
  join_any: ['fork'],
  join_none: ['fork'],
  // SystemVerilog constructs
  endclass: ['class'],
  endinterface: ['interface'],
  endprogram: ['program'],
  endpackage: ['package'],
  endproperty: ['property'],
  endsequence: ['sequence'],
  endchecker: ['checker'],
  endclocking: ['clocking'],
  // 'end' closes begin directly; control keywords are handled specially
  end: ['begin'],
  // Preprocessor directives
  '`endif': ['`ifdef', '`ifndef']
};

// Control keywords that can precede begin and are closed together with it
const CONTROL_KEYWORDS = ['always', 'always_comb', 'always_ff', 'always_latch', 'initial', 'if', 'else', 'for', 'while', 'repeat', 'forever'];

export class VerilogBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'module',
      'function',
      'task',
      'begin',
      'case',
      'casez',
      'casex',
      'always',
      'always_comb',
      'always_ff',
      'always_latch',
      'initial',
      'generate',
      'fork',
      'if',
      'else',
      'for',
      'while',
      'repeat',
      'forever',
      // SystemVerilog constructs
      'class',
      'interface',
      'program',
      'package',
      'property',
      'sequence',
      'checker',
      'clocking'
    ],
    blockClose: [
      'endmodule',
      'endfunction',
      'endtask',
      'end',
      'endcase',
      'endgenerate',
      'join',
      'join_any',
      'join_none',
      'endclass',
      'endinterface',
      'endprogram',
      'endpackage',
      'endproperty',
      'endsequence',
      'endchecker',
      'endclocking'
    ],
    blockMiddle: ['default']
  };

  // Override tokenize to also scan for preprocessor directives
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    // Add preprocessor directive tokens (`ifdef, `ifndef, `elsif, `else, `endif)
    const ppPattern = /`(ifdef|ifndef|elsif|else|endif)\b/g;
    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(ppPattern)) {
      const startOffset = match.index;
      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const directive = match[1];
      const fullValue = match[0];
      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      let type: 'block_open' | 'block_close' | 'block_middle';
      if (directive === 'ifdef' || directive === 'ifndef') {
        type = 'block_open';
      } else if (directive === 'endif') {
        type = 'block_close';
      } else {
        type = 'block_middle';
      }

      tokens.push({
        type,
        value: fullValue,
        startOffset,
        endOffset: startOffset + fullValue.length,
        line,
        column
      });
    }

    // Filter out 'default' when not followed by ':' (non-case context)
    const filtered = tokens.filter((token) => {
      if (token.value === 'default' && token.type === 'block_middle') {
        let j = token.endOffset;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }
        return j < source.length && source[j] === ':';
      }
      return true;
    });

    // Re-sort tokens by position
    filtered.sort((a, b) => a.startOffset - b.startOffset);
    return filtered;
  }

  // Validates block open: control keywords need a following 'begin' to be valid
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!CONTROL_KEYWORDS.includes(keyword)) {
      return true;
    }

    // Reject control keywords preceded by backtick (preprocessor directives)
    if (position > 0 && source[position - 1] === '`') {
      return false;
    }

    // Search forward for 'begin' before any statement terminator
    let i = position + keyword.length;
    while (i < source.length) {
      // Skip whitespace
      if (/\s/.test(source[i])) {
        i++;
        continue;
      }

      // Skip excluded regions
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }

      // Check for 'begin'
      if (source.slice(i, i + 5) === 'begin') {
        const afterBegin = source[i + 5];
        if (afterBegin === undefined || !/[a-zA-Z0-9_$]/.test(afterBegin)) {
          return true;
        }
      }

      // Check for another control keyword (e.g., "always @(...) if (...) begin")
      // Continue scanning past chained control keywords instead of early return
      let isControlKw = false;
      for (const ck of CONTROL_KEYWORDS) {
        if (source.slice(i, i + ck.length) === ck) {
          const afterCk = source[i + ck.length];
          if (afterCk === undefined || !/[a-zA-Z0-9_$]/.test(afterCk)) {
            i += ck.length;
            isControlKw = true;
            break;
          }
        }
      }
      if (isControlKw) {
        continue;
      }

      // Check for sensitivity list @(...) and skip it
      if (source[i] === '@') {
        i++;
        // Skip whitespace
        while (i < source.length && /\s/.test(source[i])) i++;
        if (i < source.length && source[i] === '(') {
          let depth = 1;
          i++;
          while (i < source.length && depth > 0) {
            if (this.isInExcludedRegion(i, excludedRegions)) {
              i++;
              continue;
            }
            if (source[i] === '(') depth++;
            else if (source[i] === ')') depth--;
            i++;
          }
        } else if (i < source.length && source[i] === '*') {
          i++;
        }
        continue;
      }

      // Check for condition in parentheses and skip it
      if (source[i] === '(') {
        let depth = 1;
        i++;
        while (i < source.length && depth > 0) {
          if (this.isInExcludedRegion(i, excludedRegions)) {
            i++;
            continue;
          }
          if (source[i] === '(') depth++;
          else if (source[i] === ')') depth--;
          i++;
        }
        continue;
      }

      // Any other non-whitespace, non-begin token means no begin follows
      return false;
    }

    return false;
  }

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
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: //
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      return this.matchSingleLineComment(source, pos);
    }

    // Block comment: /* ... */
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchBlockComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchVerilogString(source, pos);
    }

    return null;
  }

  // Matches Verilog string (cannot span multiple lines)
  private matchVerilogString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        // Don't skip newline - Verilog strings can't span lines
        if (source[i + 1] === '\n' || source[i + 1] === '\r') {
          return { start: pos, end: i };
        }
        i += 2;
        continue;
      }
      if (source[i] === '"') {
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in Verilog
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // Matches block comment: /* ... */
  private matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    while (i < source.length) {
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Custom block matching for Verilog-specific pairing rules
  protected matchBlocks(tokens: import('../types').Token[]): BlockPair[] {
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
          const closeValue = token.value;
          const validOpeners = CLOSE_TO_OPEN[closeValue];

          if (closeValue === 'end') {
            // Special handling for 'end' - closes begin and preceding control keyword
            const beginIndex = this.findLastValidOpener(stack, ['begin']);

            if (beginIndex >= 0) {
              // Check for control keyword immediately before begin
              const controlIndex = beginIndex - 1;
              let controlBlock: OpenBlock | null = null;

              if (controlIndex >= 0 && CONTROL_KEYWORDS.includes(stack[controlIndex].token.value)) {
                controlBlock = stack[controlIndex];
              }

              // Close the begin block first
              const beginBlock = stack.splice(beginIndex, 1)[0];
              pairs.push({
                openKeyword: beginBlock.token,
                closeKeyword: token,
                intermediates: beginBlock.intermediates,
                nestLevel: stack.length
              });

              // Close control keyword if present (index shifted after splice)
              if (controlBlock) {
                stack.splice(controlIndex, 1);

                // Check for else before control keyword
                const elseIndex = controlIndex - 1;
                if (elseIndex >= 0 && stack[elseIndex].token.value === 'else') {
                  // Merge else + control keyword into single pair
                  const elseBlock = stack.splice(elseIndex, 1)[0];
                  pairs.push({
                    openKeyword: elseBlock.token,
                    closeKeyword: token,
                    intermediates: [...elseBlock.intermediates, controlBlock.token, ...controlBlock.intermediates],
                    nestLevel: stack.length
                  });
                } else {
                  pairs.push({
                    openKeyword: controlBlock.token,
                    closeKeyword: token,
                    intermediates: controlBlock.intermediates,
                    nestLevel: stack.length
                  });
                }
              }
            }
          } else if (validOpeners) {
            const matchIndex = this.findLastValidOpener(stack, validOpeners);

            if (matchIndex >= 0) {
              const openBlock = stack.splice(matchIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Finds the index of the last opener that matches any of the valid openers
  private findLastValidOpener(stack: OpenBlock[], validOpeners: readonly string[]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (validOpeners.includes(stack[i].token.value)) {
        return i;
      }
    }
    return -1;
  }
}
