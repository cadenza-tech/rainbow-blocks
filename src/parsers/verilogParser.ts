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
  matchVerilogString
} from './verilogHelpers';
import type { VerilogValidationCallbacks } from './verilogValidation';
import {
  isInsideParens,
  isOnDpiLine,
  isPrecededByAssertionVerb,
  isPrecededByLabelColon,
  isPrecededByModifierKeyword,
  isValidForkOpen,
  scanForBeginAfterControl
} from './verilogValidation';

// Mapping of close keywords to their valid openers
const CLOSE_TO_OPEN: Readonly<Record<string, readonly string[]>> = {
  endmodule: ['module', 'macromodule'],
  endfunction: ['function'],
  endtask: ['task'],
  endcase: ['case', 'casez', 'casex', 'randcase'],
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
  endgroup: ['covergroup'],
  endspecify: ['specify'],
  endprimitive: ['primitive'],
  endtable: ['table'],
  endconfig: ['config'],
  // 'end' closes begin directly; control keywords are handled specially
  end: ['begin'],
  // Preprocessor directives
  '`endif': ['`ifdef', '`ifndef']
};

// Control keywords that can precede begin and are closed together with it
const CONTROL_KEYWORDS = [
  'always',
  'always_comb',
  'always_ff',
  'always_latch',
  'initial',
  'final',
  'if',
  'else',
  'for',
  'while',
  'repeat',
  'forever'
];

export class VerilogBlockParser extends BaseBlockParser {
  private get validationCallbacks(): VerilogValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

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
      'final',
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
      'clocking',
      'covergroup',
      'specify',
      'primitive',
      'table',
      'macromodule',
      'config',
      'randcase'
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
      'endclocking',
      'endgroup',
      'endspecify',
      'endprimitive',
      'endtable',
      'endconfig'
    ],
    blockMiddle: ['default']
  };

  // Override tokenize to also scan for preprocessor directives
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    let tokens = super.tokenize(source, excludedRegions);

    // Filter out tokens that are ifdef/ifndef/elsif directive macro name arguments
    const directiveArgRanges: { start: number; end: number }[] = [];
    const directiveArgPattern = /`(?:ifdef|ifndef|elsif)\b/g;
    for (const argMatch of source.matchAll(directiveArgPattern)) {
      if (this.isInExcludedRegion(argMatch.index, excludedRegions)) continue;
      let argStart = argMatch.index + argMatch[0].length;
      while (argStart < source.length && (source[argStart] === ' ' || source[argStart] === '\t')) argStart++;
      let argEnd = argStart;
      while (argEnd < source.length && /[a-zA-Z0-9_]/.test(source[argEnd])) argEnd++;
      if (argEnd > argStart) {
        directiveArgRanges.push({ start: argStart, end: argEnd });
      }
    }
    if (directiveArgRanges.length > 0) {
      tokens = tokens.filter((token) => !directiveArgRanges.some((range) => token.startOffset >= range.start && token.startOffset < range.end));
    }

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
        return j < source.length && source[j] === ':' && (j + 1 >= source.length || source[j + 1] !== ':');
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

    // Reject keywords preceded by :: (scope resolution operator like pkg::begin)
    if (position >= 2 && source[position - 1] === ':' && source[position - 2] === ':') {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like fork$sig)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    if (keyword === 'fork') {
      if (!isValidForkOpen(source, position, excludedRegions)) {
        return false;
      }
      // Fall through to label colon and other checks below
    }

    // Reject 'property' or 'sequence' when preceded by assertion verbs
    if (keyword === 'property' || keyword === 'sequence') {
      if (isPrecededByAssertionVerb(source, position, excludedRegions, this.validationCallbacks)) {
        return false;
      }
    }

    // Reject keywords used as block labels (e.g., begin : module, fork : begin)
    if (isPrecededByLabelColon(source, position, excludedRegions, this.keywords, this.validationCallbacks)) {
      return false;
    }

    // Reject modifier-prefixed keywords (extern module/function/task, typedef class, pure virtual function/task)
    if (isPrecededByModifierKeyword(source, position, keyword, excludedRegions, this.validationCallbacks)) {
      return false;
    }

    // Reject function/task in DPI import/export declarations (no body)
    if ((keyword === 'function' || keyword === 'task') && isOnDpiLine(source, position)) {
      return false;
    }

    // Reject interface used as port type inside parenthesized port list
    if (keyword === 'interface' && isInsideParens(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }

    if (!CONTROL_KEYWORDS.includes(keyword)) {
      return true;
    }

    return scanForBeginAfterControl(source, position + keyword.length, excludedRegions, CONTROL_KEYWORDS, this.validationCallbacks);
  }

  // Validates block close: reject keywords preceded by backtick, dot, or adjacent to $
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject close keywords preceded by dot (hierarchical reference like inst.end)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // Reject close keywords preceded by backtick (macro invocation like `end, `endmodule)
    if (position > 0 && source[position - 1] === '`') {
      return false;
    }

    // Reject keywords preceded by :: (scope resolution operator like pkg::end)
    if (position >= 2 && source[position - 1] === ':' && source[position - 2] === ':') {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like end$suffix)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    // Reject keywords used as block labels (e.g., end : end, endmodule : module_name)
    if (isPrecededByLabelColon(source, position, excludedRegions, this.keywords, this.validationCallbacks)) {
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
    if (char === '`' && source.slice(pos, pos + 6) === '`undef' && (pos + 6 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 6]))) {
      return matchUndefDirective(source, pos);
    }

    // SystemVerilog escaped identifier: \<chars> terminated by whitespace
    if (char === '\\' && pos + 1 < source.length && /[^\s]/.test(source[pos + 1])) {
      return matchEscapedIdentifier(source, pos);
    }

    // `include with angle-bracket filename: `include <file.vh>
    if (char === '`' && source.slice(pos, pos + 8) === '`include') {
      let j = pos + 8;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
      if (j < source.length && source[j] === '<') {
        let k = j + 1;
        while (k < source.length && source[k] !== '>' && source[k] !== '\n' && source[k] !== '\r') k++;
        if (k < source.length && source[k] === '>') return { start: j, end: k + 1 };
        return { start: j, end: k };
      }
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
                if (isCaseMiddle && openerValue !== 'case' && openerValue !== 'casex' && openerValue !== 'casez' && openerValue !== 'randcase') {
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
              // Scan backward through stack, skipping preprocessor directives, to find control keyword
              let controlIndex = beginIndex - 1;
              while (controlIndex >= 0 && stack[controlIndex].token.value.startsWith('`')) {
                controlIndex--;
              }
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

                // Check for else before control keyword, skipping preprocessor directives
                let elseIndex = controlIndex - 1;
                while (elseIndex >= 0 && stack[elseIndex].token.value.startsWith('`')) {
                  elseIndex--;
                }
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
                let hasElseNext = false;
                for (let ni = ti + 1; ni < tokens.length; ni++) {
                  const candidateToken = tokens[ni];
                  // Skip preprocessor directive tokens
                  if (candidateToken.value.startsWith('`')) {
                    continue;
                  }
                  // Check if the first non-preprocessor token is 'else'
                  hasElseNext = candidateToken.type === 'block_open' && candidateToken.value === 'else';
                  break;
                }
                if (!hasElseNext) {
                  let nextCheckIndex = stack.length > 0 ? stack.length - 1 : -1;
                  // Skip preprocessor directives at top of stack
                  while (nextCheckIndex >= 0 && stack[nextCheckIndex].token.value.startsWith('`')) {
                    nextCheckIndex--;
                  }
                  while (nextCheckIndex >= 0 && CONTROL_KEYWORDS.includes(stack[nextCheckIndex].token.value)) {
                    const chainedBlock = stack.splice(nextCheckIndex, 1)[0];
                    pairs.push({
                      openKeyword: chainedBlock.token,
                      closeKeyword: token,
                      intermediates: chainedBlock.intermediates,
                      nestLevel: stack.length
                    });
                    nextCheckIndex = stack.length > 0 ? stack.length - 1 : -1;
                    // Skip preprocessor directives at top of stack
                    while (nextCheckIndex >= 0 && stack[nextCheckIndex].token.value.startsWith('`')) {
                      nextCheckIndex--;
                    }
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
