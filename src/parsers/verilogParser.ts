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
      if (!this.isValidForkOpen(source, position, excludedRegions)) {
        return false;
      }
      // Fall through to label colon and other checks below
    }

    // Reject 'property' or 'sequence' when preceded by assertion verbs
    if (keyword === 'property' || keyword === 'sequence') {
      if (this.isPrecededByAssertionVerb(source, position, excludedRegions)) {
        return false;
      }
    }

    // Reject keywords used as block labels (e.g., begin : module, fork : begin)
    if (this.isPrecededByLabelColon(source, position, excludedRegions)) {
      return false;
    }

    // Reject modifier-prefixed keywords (extern module/function/task, typedef class, pure virtual function/task)
    if (this.isPrecededByModifierKeyword(source, position, keyword, excludedRegions)) {
      return false;
    }

    // Reject function/task in DPI import/export declarations (no body)
    if ((keyword === 'function' || keyword === 'task') && this.isOnDpiLine(source, position)) {
      return false;
    }

    // Reject interface used as port type inside parenthesized port list
    if (keyword === 'interface' && this.isInsideParens(source, position, excludedRegions)) {
      return false;
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
      if (source[j] === ' ' || source[j] === '\t') {
        j--;
        continue;
      }
      // Stop at line boundaries so we don't cross lines
      if (source[j] === '\n' || source[j] === '\r') {
        break;
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

  // Returns true if 'property' or 'sequence' at the given position is preceded by an assertion verb
  // (assert, assume, cover, expect, restrict) with whitespace or comments between them.
  // Handles assertion qualifiers like 'final' and '#0' that may appear between the verb and keyword
  private isPrecededByAssertionVerb(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const ASSERTION_VERBS = ['assert', 'assume', 'cover', 'expect', 'restrict'];
    let j = this.skipBackwardWhitespaceAndComments(source, position - 1, excludedRegions);
    // Skip assertion qualifiers: 'final' and '#<digits>' (e.g., #0)
    // These can appear in any combination between the verb and property/sequence
    let skipped = true;
    while (skipped) {
      skipped = false;
      // Skip 'final' qualifier
      if (j >= 4 && source.slice(j - 4, j + 1) === 'final') {
        const beforeFinal = j - 5;
        if (beforeFinal < 0 || !/[a-zA-Z0-9_$]/.test(source[beforeFinal])) {
          j = this.skipBackwardWhitespaceAndComments(source, j - 5, excludedRegions);
          skipped = true;
          continue;
        }
      }
      // Skip '#<digits>' delay qualifier (e.g., #0)
      if (j >= 0 && /[0-9]/.test(source[j])) {
        let k = j;
        while (k >= 0 && /[0-9]/.test(source[k])) {
          k--;
        }
        if (k >= 0 && source[k] === '#') {
          j = this.skipBackwardWhitespaceAndComments(source, k - 1, excludedRegions);
          skipped = true;
        }
      }
    }
    for (const verb of ASSERTION_VERBS) {
      const verbStart = j - verb.length + 1;
      if (verbStart >= 0 && source.slice(verbStart, j + 1) === verb) {
        if (verbStart === 0 || !/[a-zA-Z0-9_$]/.test(source[verbStart - 1])) {
          if (!this.isInExcludedRegion(verbStart, excludedRegions)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Skips backward over whitespace and excluded regions (comments), returning the new position
  private skipBackwardWhitespaceAndComments(source: string, startPos: number, excludedRegions: ExcludedRegion[]): number {
    let pos = startPos;
    while (pos >= 0 && (source[pos] === ' ' || source[pos] === '\t' || source[pos] === '\n' || source[pos] === '\r')) {
      pos--;
    }
    while (pos >= 0 && this.isInExcludedRegion(pos, excludedRegions)) {
      const region = this.findExcludedRegionAt(pos, excludedRegions);
      if (region) {
        pos = region.start - 1;
        while (pos >= 0 && (source[pos] === ' ' || source[pos] === '\t' || source[pos] === '\n' || source[pos] === '\r')) {
          pos--;
        }
      } else {
        pos--;
      }
    }
    return pos;
  }

  // Returns true if keyword at position is preceded by a label colon (e.g., begin : module, end : end)
  private isPrecededByLabelColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = position - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
      j--;
    }
    if (j < 0 || source[j] !== ':') return false;
    if (j > 0 && source[j - 1] === ':') return false;
    if (this.isInExcludedRegion(j, excludedRegions)) return false;
    let k = j - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
      k--;
    }
    while (k >= 0 && this.isInExcludedRegion(k, excludedRegions)) {
      const region = this.findExcludedRegionAt(k, excludedRegions);
      if (region) {
        k = region.start - 1;
        // After skipping a block comment, skip whitespace before it
        // But not after escaped identifiers (\name) which are word-like excluded regions
        if (source[region.start] !== '\\') {
          while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
            k--;
          }
        }
      } else {
        k--;
      }
    }
    if (k < 0) return false;
    const wordEnd = k;
    while (k >= 0 && /[a-zA-Z0-9_]/.test(source[k])) {
      k--;
    }
    if (wordEnd > k) {
      const word = source.slice(k + 1, wordEnd + 1);
      const allKeywords = new Set([...this.keywords.blockOpen, ...this.keywords.blockClose]);
      return allKeywords.has(word);
    }
    return false;
  }

  // Returns true if keyword is preceded by a modifier keyword that indicates a non-block usage
  // (e.g., extern module/function/task, typedef class, pure virtual function/task)
  private isPrecededByModifierKeyword(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    const MODIFIER_MAP: Readonly<Record<string, readonly string[]>> = {
      class: ['typedef', 'extern'],
      interface: ['extern'],
      function: ['extern'],
      task: ['extern'],
      module: ['extern'],
      program: ['extern']
    };
    const validModifiers = MODIFIER_MAP[keyword];

    let j = position - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    // Skip over excluded regions (comments, strings) between modifier and keyword
    while (j >= 0 && this.isInExcludedRegion(j, excludedRegions)) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.start - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
          j--;
        }
      } else {
        j--;
      }
    }
    if (j < 0) return false;
    const wordEnd = j;
    while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
      j--;
    }
    if (wordEnd === j) return false;
    const word = source.slice(j + 1, wordEnd + 1);

    // For function/task: "pure virtual function/task" has no body, but "virtual function/task" does
    // Also check for "extern [qualifiers] virtual function/task"
    if (word === 'virtual' && (keyword === 'function' || keyword === 'task')) {
      if (this.isPrecededByWord(source, j, 'pure', excludedRegions)) {
        return true;
      }
      if (this.isPrecededByWord(source, j, 'extern', excludedRegions)) {
        return true;
      }
      // Check for "extern qualifier virtual function/task" (e.g., extern local virtual function)
      if (validModifiers?.includes('extern')) {
        if (this.isPrecededByExternThroughQualifiers(source, j, excludedRegions)) {
          return true;
        }
      }
      return false;
    }

    // Check for 'virtual interface' (variable type declaration, not a block)
    if (word === 'virtual' && keyword === 'interface') {
      if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
        return true;
      }
    }

    // Check for qualifiers between extern and keyword (e.g., extern protected static function)
    // Iteratively scan backward through all qualifiers to reach extern
    const QUALIFIER_KEYWORDS = new Set(['protected', 'local', 'static', 'virtual', 'forkjoin']);
    if (QUALIFIER_KEYWORDS.has(word) && validModifiers?.includes('extern')) {
      if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
        if (this.isPrecededByWord(source, j, 'extern', excludedRegions)) {
          return true;
        }
        // Check through additional qualifiers (e.g., extern protected static function)
        if (this.isPrecededByExternThroughQualifiers(source, j, excludedRegions)) {
          return true;
        }
      }
    }

    if (validModifiers?.includes(word)) {
      if (j < 0 || !/[a-zA-Z0-9_$]/.test(source[j])) {
        return true;
      }
    }
    return false;
  }

  // Returns true if the position is preceded (skipping whitespace and excluded regions) by the given word with a word boundary
  private isPrecededByWord(source: string, pos: number, targetWord: string, excludedRegions: ExcludedRegion[]): boolean {
    let j = pos;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    while (j >= 0 && this.isInExcludedRegion(j, excludedRegions)) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.start - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
          j--;
        }
      } else {
        j--;
      }
    }
    if (j < 0) return false;
    const wordEnd = j;
    while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
      j--;
    }
    if (wordEnd === j) return false;
    const word = source.slice(j + 1, wordEnd + 1);
    if (word === targetWord) {
      return j < 0 || !/[a-zA-Z0-9_$]/.test(source[j]);
    }
    return false;
  }

  // Iteratively scans backward through qualifier keywords to find 'extern'
  private isPrecededByExternThroughQualifiers(source: string, pos: number, excludedRegions: ExcludedRegion[]): boolean {
    const QUALIFIER_KEYWORDS = new Set(['protected', 'local', 'static', 'virtual', 'forkjoin']);
    let j = pos;
    for (let depth = 0; depth < 5; depth++) {
      // Skip whitespace and excluded regions
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
        j--;
      }
      while (j >= 0 && this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start - 1;
          while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
            j--;
          }
        } else {
          j--;
        }
      }
      if (j < 0) return false;
      const wordEnd = j;
      while (j >= 0 && /[a-zA-Z0-9_]/.test(source[j])) {
        j--;
      }
      if (wordEnd === j) return false;
      const word = source.slice(j + 1, wordEnd + 1);
      if (word === 'extern') {
        return j < 0 || !/[a-zA-Z0-9_$]/.test(source[j]);
      }
      if (!QUALIFIER_KEYWORDS.has(word)) return false;
      if (j >= 0 && /[a-zA-Z0-9_$]/.test(source[j])) return false;
    }
    return false;
  }

  // Returns true if function/task at position is on a DPI import/export line
  // (e.g., import "DPI-C" function void f(); or export "DPI-C" task t;)
  private isOnDpiLine(source: string, position: number): boolean {
    let lineStart = position;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    const lineBeforeKeyword = source.slice(lineStart, position);
    return /^\s*(?:import|export)\s+"DPI/.test(lineBeforeKeyword);
  }

  // Returns true if position is inside unmatched parentheses (e.g., port list)
  private isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 0;
    for (let i = 0; i < position; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        if (depth > 0) depth--;
      }
    }
    return depth > 0;
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
        const labelEnd = trySkipLabel(source, i, excludedRegions);
        if (labelEnd > i) {
          i = labelEnd;
          continue;
        }
      }

      // Skip backtick-prefixed preprocessor directives and macro invocations
      // (`ifdef, `endif, `include, `MY_MACRO, etc.)
      // Note: `define and `undef are excluded regions and handled above
      if (source[i] === '`') {
        let j = i + 1;
        while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) {
          j++;
        }
        if (j > i + 1) {
          const directive = source.slice(i + 1, j);
          // Directives with arguments (`ifdef, `ifndef, `elsif):
          // skip whitespace + one identifier argument
          if (/^(ifdef|ifndef|elsif)$/i.test(directive)) {
            while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
              j++;
            }
            while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) {
              j++;
            }
          }
          i = j;
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
    // @identifier: single signal sensitivity (e.g., always @clk begin)
    if (i < source.length && /[a-zA-Z_]/.test(source[i])) {
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
      return i;
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
      // Handle base-specifier format: [size]'[s/S][base]digits (e.g., 32'd0, 8'hFF, 4'sb1010)
      if (i < source.length && source[i] === "'") {
        i = this.skipBaseSpecifierSuffix(source, i);
      }
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
      // Skip arithmetic operators and continue parsing the rest of the expression
      if (i < source.length && /[+\-*/%]/.test(source[i])) {
        i++;
        return this.skipDelayExpression(source, i, excludedRegions);
      }
      return i;
    }
    // Handle unsized base-specifier literals: '[s/S][base]digits (e.g., 'd5, 'hFF)
    // and bare tick fill literals: '0, '1, 'x, 'X, 'z, 'Z
    if (i < source.length && source[i] === "'") {
      const next = i + 1 < source.length ? source[i + 1] : '';
      if (/[sS]/.test(next) || /[bBoOdDhH]/.test(next)) {
        i = this.skipBaseSpecifierSuffix(source, i);
        return i;
      }
      if (/[01xXzZ]/.test(next)) {
        return i + 2;
      }
    }
    if (i < source.length && /[a-zA-Z_]/.test(source[i])) {
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
      if (i < source.length && /[+\-*/%]/.test(source[i])) {
        i++;
        return this.skipDelayExpression(source, i, excludedRegions);
      }
      return i;
    }
    // Backtick-prefixed macro identifier: `MACRO_NAME or `(expr)
    if (i < source.length && source[i] === '`') {
      i++;
      if (i < source.length && source[i] === '(') {
        return this.skipParenGroup(source, i, excludedRegions);
      }
      while (i < source.length && /[a-zA-Z0-9_$]/.test(source[i])) i++;
      if (i < source.length && /[+\-*/%]/.test(source[i])) {
        i++;
        return this.skipDelayExpression(source, i, excludedRegions);
      }
      return i;
    }
    return i;
  }

  // Skips the tick and base-specifier portion of a Verilog number literal
  // Handles '[s/S][base]digits where base is b/B/o/O/d/D/h/H
  // Digits include hex digits (a-f, A-F), x, X, z, Z, ?, and _
  private skipBaseSpecifierSuffix(source: string, pos: number): number {
    let i = pos;
    // Skip the tick
    i++;
    // Skip optional signed indicator
    if (i < source.length && (source[i] === 's' || source[i] === 'S')) {
      i++;
    }
    // Skip base specifier
    if (i < source.length && /[bBoOdDhH]/.test(source[i])) {
      i++;
    }
    // Skip base digits (hex digits, x, z, ?, _)
    while (i < source.length && /[0-9a-fA-F_xXzZ?]/.test(source[i])) i++;
    return i;
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
    if (this.isPrecededByLabelColon(source, position, excludedRegions)) {
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
