// Verilog block parser: module→endmodule, case→endcase, fork→join, begin→end

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  hasDollarAdjacent,
  matchAttribute,
  matchBlockComment,
  matchDefineDirective,
  matchEscapedIdentifier,
  matchUndefDirective,
  matchVerilogString,
  trySkipLabel
} from './verilogHelpers';

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

    // Filter out 'default' when not followed by ':' (non-case context) or preceded by backtick
    const filtered = tokens.filter((token) => {
      if (token.value === 'default' && token.type === 'block_middle') {
        // Reject backtick-prefixed `default (preprocessor directive)
        if (token.startOffset > 0 && source[token.startOffset - 1] === '`') {
          return false;
        }
        let j = token.endOffset;
        while (j < source.length) {
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            j++;
            continue;
          }
          // Skip excluded regions (block comments between default and :)
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
          break;
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
    // Reject keywords preceded by dot (hierarchical reference like inst.begin, .begin(signal))
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // Reject any keyword preceded by backtick (macro invocation like `begin, `module)
    if (position > 0 && source[position - 1] === '`') {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like fork$sig)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    if (keyword === 'fork') {
      return this.isValidForkOpen(source, position, excludedRegions);
    }

    if (!CONTROL_KEYWORDS.includes(keyword)) {
      return true;
    }

    return this.scanForBeginAfterControl(source, position + keyword.length, excludedRegions);
  }

  // Validates 'fork': rejects 'disable fork' and 'wait fork' statements
  private isValidForkOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = position - 1;
    while (j >= 0) {
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j--;
        continue;
      }
      // Skip over excluded regions (comments)
      let inExcluded = false;
      for (const region of excludedRegions) {
        if (j >= region.start && j < region.end) {
          j = region.start - 1;
          inExcluded = true;
          break;
        }
      }
      if (inExcluded) continue;
      break;
    }
    // Check 'disable' (7 chars): ensure it's a word boundary before it
    if (j >= 6 && source.slice(j - 6, j + 1) === 'disable') {
      const beforeDisable = j - 7;
      if (beforeDisable < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeDisable])) {
        return false;
      }
    }
    // Check 'wait' (4 chars): ensure it's a word boundary before it
    if (j >= 3 && source.slice(j - 3, j + 1) === 'wait') {
      const beforeWait = j - 4;
      if (beforeWait < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeWait])) {
        return false;
      }
    }
    return true;
  }

  // Scans forward from a control keyword to find 'begin' before any statement terminator
  private scanForBeginAfterControl(source: string, startPos: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = startPos;
    while (i < source.length) {
      // Skip whitespace
      if (/\s/.test(source[i])) {
        i++;
        continue;
      }

      // Skip excluded regions (e.g., escaped identifiers \name)
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
        i = this.skipSensitivityList(source, i + 1, excludedRegions);
        continue;
      }

      // Check for condition in parentheses and skip it
      if (source[i] === '(') {
        i = this.skipParenGroup(source, i, excludedRegions);
        continue;
      }

      // Skip #delay: #number, #(expr), #identifier
      if (source[i] === '#') {
        i = this.skipDelayExpression(source, i + 1, excludedRegions);
        continue;
      }

      // Skip label colon separator (e.g., after escaped identifier labels from excluded regions)
      // But not :: (scope resolution operator)
      if (source[i] === ':') {
        if (i + 1 < source.length && source[i + 1] === ':') {
          return false;
        }
        i++;
        continue;
      }

      // Skip labels: identifier followed by ':'
      // Support both regular identifiers and escaped identifiers (\name)
      if (/[a-zA-Z_]/.test(source[i]) || source[i] === '\\') {
        const labelEnd = trySkipLabel(source, i);
        if (labelEnd > i) {
          i = labelEnd;
          continue;
        }
      }

      // Any other non-whitespace, non-begin token means no begin follows
      return false;
    }

    return false;
  }

  // Skips a sensitivity list @(...) or @*
  private skipSensitivityList(source: string, pos: number, excludedRegions: ExcludedRegion[]): number {
    let i = pos;
    // Skip whitespace
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i < source.length && source[i] === '(') {
      return this.skipParenGroup(source, i, excludedRegions);
    }
    if (i < source.length && source[i] === '*') {
      return i + 1;
    }
    return i;
  }

  // Skips a parenthesized group, handling nested parens and excluded regions
  private skipParenGroup(source: string, pos: number, excludedRegions: ExcludedRegion[]): number {
    let depth = 1;
    let i = pos + 1;
    while (i < source.length && depth > 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    return i;
  }

  // Skips a #delay expression: #number, #(expr), #identifier
  private skipDelayExpression(source: string, pos: number, excludedRegions: ExcludedRegion[]): number {
    let i = pos;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i < source.length && source[i] === '(') {
      return this.skipParenGroup(source, i, excludedRegions);
    }
    if (i < source.length && /[0-9]/.test(source[i])) {
      while (i < source.length && /[0-9_.]/.test(source[i])) i++;
      // Handle exponent notation (e.g., 1.5e-3, 2.0E+6)
      if (i < source.length && (source[i] === 'e' || source[i] === 'E')) {
        i++;
        if (i < source.length && (source[i] === '+' || source[i] === '-')) {
          i++;
        }
        while (i < source.length && /[0-9_]/.test(source[i])) i++;
      }
      // Skip time unit (e.g., ns, ps)
      while (i < source.length && /[a-zA-Z]/.test(source[i])) i++;
      return i;
    }
    if (i < source.length && /[a-zA-Z_]/.test(source[i])) {
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
      return i;
    }
    return i;
  }

  // Validates block close: reject keywords preceded by backtick, dot, or adjacent to $
  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    // Reject close keywords preceded by dot (hierarchical reference like inst.end)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // Reject close keywords preceded by backtick (macro invocation like `end, `endmodule)
    if (position > 0 && source[position - 1] === '`') {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like end$suffix)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    return true;
  }

  // Finds excluded regions: comments and strings
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegionWithContext(source, i, regions);
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
  private tryMatchExcludedRegionWithContext(source: string, pos: number, regions: ExcludedRegion[]): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: //
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      return this.matchSingleLineComment(source, pos);
    }

    // Block comment: /* ... */
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      return matchBlockComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchVerilogString(source, pos);
    }

    // `define directive: exclude from keyword scanning (may contain keywords in macro body)
    // Word boundary check prevents matching `defined, `define_WIDTH, etc.
    if (char === '`' && source.slice(pos, pos + 7) === '`define' && (pos + 7 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 7]))) {
      return matchDefineDirective(source, pos);
    }

    // `undef directive: exclude to end of line (may contain keyword names)
    // Word boundary check prevents matching `undefine, `undef_FOO, etc.
    if (char === '`' && source.slice(pos + 1, pos + 6) === 'undef' && (pos + 6 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 6]))) {
      return matchUndefDirective(source, pos);
    }

    // SystemVerilog escaped identifier: \<chars> terminated by whitespace
    if (char === '\\' && pos + 1 < source.length && /[^\s]/.test(source[pos + 1])) {
      return matchEscapedIdentifier(source, pos);
    }

    // SystemVerilog attribute: (* ... *) but not sensitivity list @(*)
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      // Check if preceded by '@' (possibly with whitespace including newlines)
      let j = pos - 1;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      if (j >= 0 && source[j] === '@' && !this.isInExcludedRegion(j, regions)) {
        return null;
      }
      return matchAttribute(source, pos);
    }

    return null;
  }

  // Custom block matching for Verilog-specific pairing rules
  protected matchBlocks(tokens: import('../types').Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti];
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle': {
          if (stack.length > 0) {
            const isPreprocessorMiddle = token.value.startsWith('`');
            const isCaseMiddle = token.value === 'default';
            // Find the correct block to attach this intermediate to
            for (let si = stack.length - 1; si >= 0; si--) {
              const openerValue = stack[si].token.value;
              const isPreprocessorBlock = openerValue.startsWith('`');
              if (isPreprocessorMiddle === isPreprocessorBlock) {
                // 'default' only attaches to case/casex/casez blocks
                if (isCaseMiddle && openerValue !== 'case' && openerValue !== 'casex' && openerValue !== 'casez') {
                  continue;
                }
                stack[si].intermediates.push(token);
                break;
              }
            }
          }
          break;
        }

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

                // Continue consuming chained control keywords up the stack
                // e.g., always -> if -> begin: after closing if, also close always
                // BUT: if the next token is 'else', don't chain-consume because the
                // if-else construct is not complete yet
                const nextToken = ti + 1 < tokens.length ? tokens[ti + 1] : null;
                const hasElseNext = nextToken !== null && nextToken.type === 'block_open' && nextToken.value === 'else';
                if (!hasElseNext) {
                  let nextCheckIndex = stack.length > 0 ? stack.length - 1 : -1;
                  while (nextCheckIndex >= 0 && CONTROL_KEYWORDS.includes(stack[nextCheckIndex].token.value)) {
                    const chainedBlock = stack.splice(nextCheckIndex, 1)[0];
                    pairs.push({
                      openKeyword: chainedBlock.token,
                      closeKeyword: token,
                      intermediates: chainedBlock.intermediates,
                      nestLevel: stack.length
                    });
                    nextCheckIndex = stack.length > 0 ? stack.length - 1 : -1;
                  }
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
