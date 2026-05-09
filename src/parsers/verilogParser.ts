// Verilog block parser: module→endmodule, case→endcase, fork→join, begin→end

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  hasDollarAdjacent,
  matchAttribute,
  matchBlockComment,
  matchDefineDirective,
  matchEscapedIdentifier,
  matchMacroArgList,
  matchPragmaDirective,
  matchUndefDirective,
  matchVerilogString
} from './verilogHelpers';
import type { VerilogValidationCallbacks } from './verilogValidation';
import {
  isFollowedByWord,
  isInsideParens,
  isOnDpiLine,
  isPrecededByAssertionVerb,
  isPrecededByLabelColon,
  isPrecededByModifierKeyword,
  isValidForkOpen,
  isValidWaitOpen,
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
  endsequence: ['sequence', 'randsequence'],
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

// Returns true when a keyword at `position` is preceded by `::` (scope resolution),
// allowing whitespace between `::` and the keyword (e.g., `pkg :: end`).
function isPrecededByScopeResolution(source: string, position: number): boolean {
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
    i--;
  }
  return i >= 1 && source[i] === ':' && source[i - 1] === ':';
}

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
  'foreach',
  'while',
  'repeat',
  'forever',
  'wait'
];

// SystemVerilog data type and qualifier keywords. When one of these immediately precedes
// a block-keyword identifier (e.g., `int function`, `input module`), the block keyword is
// being used as a parameter or variable name rather than introducing a block.
const DATA_TYPE_KEYWORDS: ReadonlySet<string> = new Set([
  // Integer types
  'bit',
  'byte',
  'shortint',
  'int',
  'longint',
  'integer',
  'time',
  // Real types
  'real',
  'realtime',
  'shortreal',
  // Other primitive types
  'string',
  'chandle',
  'event',
  'void',
  // Logic/net types
  'logic',
  'reg',
  'wire',
  'wand',
  'wor',
  'tri',
  'triand',
  'trior',
  'trireg',
  'tri0',
  'tri1',
  'uwire',
  'supply0',
  'supply1',
  // Sign qualifiers
  'signed',
  'unsigned',
  // Storage class qualifiers (apply to variables/properties; do NOT precede method blocks
  // legitimately on their own — see METHOD_QUALIFIER_KEYWORDS for those)
  'var',
  'ref',
  'rand',
  'randc',
  // Port directions
  'input',
  'output',
  'inout'
]);

// SystemVerilog method/lifetime qualifier keywords that legitimately precede block
// openers like `function`, `task`, and `class` (e.g., `static function int f()`).
// When `keyword` is one of these block openers, a preceding qualifier should NOT
// suppress the block.
const METHOD_QUALIFIER_KEYWORDS: ReadonlySet<string> = new Set(['static', 'automatic', 'const', 'protected', 'local', 'virtual', 'pure']);

const METHOD_QUALIFIER_TARGETS: ReadonlySet<string> = new Set(['function', 'task', 'class']);

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
      'foreach',
      'while',
      'repeat',
      'forever',
      'wait',
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
      'randcase',
      'randsequence'
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
      // Skip whitespace (space/tab) and excluded regions (block comments) between
      // the directive and the macro name. Per IEEE 1800-2017, block comments are
      // valid whitespace, so `\`ifdef /* comment */ MACRO` is a valid directive form.
      while (argStart < source.length) {
        if (source[argStart] === ' ' || source[argStart] === '\t') {
          argStart++;
          continue;
        }
        const region = this.findExcludedRegionAt(argStart, excludedRegions);
        if (region) {
          argStart = region.end;
          continue;
        }
        break;
      }
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
      // Skip directives adjacent to Unicode letters (e.g., ``endifα` is an identifier)
      if (this.isAdjacentToUnicodeLetter(source, startOffset, fullValue.length)) {
        continue;
      }
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

    // Filter out 'default' when not followed by ':' (non-case context) or preceded by backtick.
    // Also reject any block keyword used as a field name inside SystemVerilog assignment
    // patterns: `'{key: value, ...}` (LRM §10.9.2/10.9.3). e.g. `'{begin: 0, end: 100}`.
    const filtered = tokens.filter((token) => {
      if (token.value === 'default' && token.type === 'block_middle') {
        // Reject backtick-prefixed `default (preprocessor directive)
        if (token.startOffset > 0 && source[token.startOffset - 1] === '`') {
          return false;
        }
        // Reject scope-resolved `pkg::default` (it's a qualified identifier, not a case label).
        // Also handles whitespace-separated `pkg :: default`.
        if (isPrecededByScopeResolution(source, token.startOffset)) {
          return false;
        }
        // Reject default inside `'{...}` assignment pattern
        if (this.isInsideAssignmentPattern(source, token.startOffset, excludedRegions)) {
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
      // Reject block_open/block_close keywords inside `'{...}` assignment patterns.
      // These are field name positions or expressions that can never legitimately
      // open or close a block, regardless of whether a `:` follows.
      if (token.type === 'block_open' || token.type === 'block_close') {
        if (this.isInsideAssignmentPattern(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      return true;
    });

    // Re-sort tokens by position
    filtered.sort((a, b) => a.startOffset - b.startOffset);
    return filtered;
  }

  // Returns true when `function` appears in covergroup `with function sample(...)` syntax.
  // The `function` keyword is preceded by the word `with` on the same line, and is
  // followed by `sample` (after whitespace).
  private isCovergroupWithFunctionSample(source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    // Check preceding word is `with`
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i < 3) return false;
    if (!(source.slice(i - 3, i + 1).toLowerCase() === 'with' && (i - 4 < 0 || !/[a-zA-Z0-9_$]/.test(source[i - 4])))) {
      return false;
    }
    // Check following word is `sample`
    let j = position + 'function'.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j + 6 > source.length) return false;
    if (source.slice(j, j + 6).toLowerCase() !== 'sample') return false;
    if (j + 6 < source.length && /[a-zA-Z0-9_$]/.test(source[j + 6])) return false;
    return true;
  }

  // Returns true when the immediately preceding word on the same line is a SystemVerilog
  // data-type or qualifier keyword. Used to filter cases like `int function` where the
  // block keyword is being used as a parameter/variable name.
  // Method qualifiers (static, automatic, etc.) before `function`/`task`/`class` are
  // legitimate block openers and are not treated as data-type-suppressing prefixes.
  private isPrecededByDataTypeKeyword(source: string, position: number, keyword?: string): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i < 0 || !/[a-zA-Z0-9_]/.test(source[i])) return false;
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_$]/.test(source[i])) i--;
    const wordStart = i + 1;
    // Reject if the word boundary touches `$` (system tasks) or `\` (escaped identifier)
    if (i >= 0 && (source[i] === '$' || source[i] === '\\')) return false;
    const word = source.slice(wordStart, wordEnd);
    if (DATA_TYPE_KEYWORDS.has(word)) return true;
    // Method qualifiers (static/automatic/const/...) only suppress when the following
    // keyword is NOT one of the legitimate qualified block openers.
    if (METHOD_QUALIFIER_KEYWORDS.has(word) && keyword !== undefined && !METHOD_QUALIFIER_TARGETS.has(keyword)) {
      return true;
    }
    return false;
  }

  // Detects `default clocking <name>;` (and `global clocking <name>;`). When `clocking` is
  // preceded by `default` or `global` and followed by `<identifier>;` (no `@(...)` event
  // control), it's a clocking specification with no body — not an opening of a clocking block.
  private isDefaultClockingSpecification(source: string, position: number): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i < 0 || !/[a-zA-Z]/.test(source[i])) return false;
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z]/.test(source[i])) i--;
    const word = source.slice(i + 1, wordEnd);
    if (word !== 'default' && word !== 'global') return false;
    // Look forward past `clocking` and an identifier; specification ends at `;`,
    // while a real clocking block has `@(...)` event control or a body.
    let j = position + 'clocking'.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    // Optional identifier
    if (j < source.length && /[a-zA-Z_]/.test(source[j])) {
      while (j < source.length && /[a-zA-Z0-9_$]/.test(source[j])) j++;
    }
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    return j < source.length && source[j] === ';';
  }

  // Detects whether position is inside a SystemVerilog assignment pattern: `'{...}`
  // Walks back tracking brace depth; returns true when the innermost unmatched `{` is preceded by `'`
  private isInsideAssignmentPattern(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let braceDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const ch = source[i];
      if (ch === '}') {
        braceDepth++;
      } else if (ch === '{') {
        if (braceDepth === 0) {
          // Innermost unmatched `{` — check for preceding `'`
          return i > 0 && source[i - 1] === "'";
        }
        braceDepth--;
      }
    }
    return false;
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

    // Reject keywords preceded by :: (scope resolution operator like pkg::begin),
    // including whitespace-separated forms like `pkg :: begin`.
    if (isPrecededByScopeResolution(source, position)) {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like fork$sig)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    // Reject keywords used as identifiers after a data type/qualifier keyword
    // (e.g., `int function`, `input module`, `bit task`)
    if (this.isPrecededByDataTypeKeyword(source, position, keyword)) {
      return false;
    }

    if (keyword === 'fork') {
      if (!isValidForkOpen(source, position, excludedRegions)) {
        return false;
      }
      // Fall through to label colon and other checks below
    }

    // Reject `wait fork;` — this is a SystemVerilog statement (wait for forked
    // processes), not a control keyword opening a block. Without this check the
    // generic CONTROL_KEYWORDS chain finds `fork` after `wait` and falsely treats
    // `wait` as opening a block that pairs with a subsequent `end`.
    if (keyword === 'wait') {
      if (!isValidWaitOpen(source, position, excludedRegions)) {
        return false;
      }
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

    // Reject `default clocking <name>;` — default-clocking specification has no body
    // (LRM §14.16.7). It is a one-line statement, not an opening of a clocking block.
    if (keyword === 'clocking' && this.isDefaultClockingSpecification(source, position)) {
      return false;
    }

    // Reject function/task in DPI import/export declarations (no body)
    if ((keyword === 'function' || keyword === 'task') && isOnDpiLine(source, position, excludedRegions)) {
      return false;
    }

    // Reject `function` in covergroup `with function sample(...)` syntax (LRM §19.8.1):
    // it is a covergroup option specifier, not a function declaration.
    if (keyword === 'function' && this.isCovergroupWithFunctionSample(source, position, excludedRegions)) {
      return false;
    }

    // Reject interface used as port type inside parenthesized port list
    if (keyword === 'interface' && isInsideParens(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }

    // Reject 'interface' that qualifies 'class' (SV-2012 interface class declaration)
    // The block is closed by endclass, not endinterface
    if (keyword === 'interface' && isFollowedByWord(source, position + keyword.length, 'class', excludedRegions, this.validationCallbacks)) {
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

    // Reject keywords preceded by :: (scope resolution operator like pkg::end),
    // including forms with whitespace between `::` and the keyword (`pkg :: end`).
    if (isPrecededByScopeResolution(source, position)) {
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

    // Reject keywords used as identifiers after a data type/qualifier keyword
    // (e.g., `int endmodule;` — endmodule is an illegal variable name preceded by `int`).
    if (this.isPrecededByDataTypeKeyword(source, position, keyword)) {
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
    // Word boundary check prevents matching `defined, `define_WIDTH, `defineα, etc.
    if (
      char === '`' &&
      source.slice(pos, pos + 7) === '`define' &&
      (pos + 7 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 7])) &&
      !this.isAdjacentToUnicodeLetter(source, pos, 7)
    ) {
      return matchDefineDirective(source, pos);
    }

    // `undef directive: exclude to end of line (may contain keyword names)
    // Word boundary check prevents matching `undefine, `undef_FOO, `undefα, etc.
    if (
      char === '`' &&
      source.slice(pos, pos + 6) === '`undef' &&
      (pos + 6 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 6])) &&
      !this.isAdjacentToUnicodeLetter(source, pos, 6)
    ) {
      return matchUndefDirective(source, pos);
    }

    // `pragma directive: exclude to end of line. Arguments may contain keyword-like
    // tokens (e.g. `pragma protect begin / end) that must not open/close blocks.
    if (
      char === '`' &&
      source.slice(pos, pos + 7) === '`pragma' &&
      (pos + 7 >= source.length || !/[a-zA-Z0-9_]/.test(source[pos + 7])) &&
      !this.isAdjacentToUnicodeLetter(source, pos, 7)
    ) {
      return matchPragmaDirective(source, pos);
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

    // `MACRO(args) — generic user-macro invocation. Exclude the argument list so
    // block keywords (begin/end, case/endcase, etc.) inside macro args are not
    // mistakenly tokenized. Specific directives (`define/`undef/`pragma/`include)
    // are matched by the dedicated handlers above and do not reach this branch.
    // Per IEEE 1800-2017 §22.5.1, whitespace (space/tab) is permitted between the
    // macro identifier and the opening paren of the actual argument list. Newlines
    // are NOT permitted because the argument list must start on the same logical line.
    if (char === '`' && pos + 1 < source.length && /[a-zA-Z_]/.test(source[pos + 1])) {
      let j = pos + 1;
      while (j < source.length && /[a-zA-Z0-9_$]/.test(source[j])) j++;
      let parenScan = j;
      while (parenScan < source.length && (source[parenScan] === ' ' || source[parenScan] === '\t')) parenScan++;
      if (parenScan < source.length && source[parenScan] === '(') {
        return matchMacroArgList(source, pos, parenScan);
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

              // For fork/join* and case/endcase, also close preceding control keyword
              // (like always, initial, if). The SV grammar allows `always_keyword statement`
              // where `statement` can be a case_statement, so the always block should pair
              // with the case's endcase the same way it does with fork/join.
              if (closeValue === 'join' || closeValue === 'join_any' || closeValue === 'join_none' || closeValue === 'endcase') {
                this.chainConsumeControlKeywords(stack, pairs, token, matchIndex, tokens, ti);
              }
            }
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Closes preceding control keywords after a fork/join pair is matched
  private chainConsumeControlKeywords(
    stack: OpenBlock[],
    pairs: BlockPair[],
    token: Token,
    closedIndex: number,
    tokens: Token[],
    currentTokenIndex: number
  ): void {
    let controlIndex = closedIndex - 1;
    while (controlIndex >= 0 && stack[controlIndex].token.value.startsWith('`')) {
      controlIndex--;
    }
    if (controlIndex < 0 || !CONTROL_KEYWORDS.includes(stack[controlIndex].token.value)) {
      return;
    }

    const controlBlock = stack.splice(controlIndex, 1)[0];

    let elseIndex = controlIndex - 1;
    while (elseIndex >= 0 && stack[elseIndex].token.value.startsWith('`')) {
      elseIndex--;
    }
    if (elseIndex >= 0 && stack[elseIndex].token.value === 'else') {
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

    let hasElseNext = false;
    for (let ni = currentTokenIndex + 1; ni < tokens.length; ni++) {
      const candidateToken = tokens[ni];
      if (candidateToken.value.startsWith('`')) continue;
      hasElseNext = candidateToken.type === 'block_open' && candidateToken.value === 'else';
      break;
    }
    if (!hasElseNext) {
      let nextCheckIndex = stack.length > 0 ? stack.length - 1 : -1;
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
        while (nextCheckIndex >= 0 && stack[nextCheckIndex].token.value.startsWith('`')) {
          nextCheckIndex--;
        }
      }
    }
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
