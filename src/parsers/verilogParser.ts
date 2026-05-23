// Verilog block parser: module→endmodule, case→endcase, fork→join, begin→end

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { BracketIndex } from './bracketIndex';
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
  getPrecedingLabelColonWord,
  isEnclosingBlockCase,
  isFollowedByBinaryOperator,
  isFollowedByWord,
  isInsideParenHeaderControlBody,
  isInsideParenlessControlBody,
  isInsideParens,
  isOnDpiLine,
  isPrecededByAssertionVerb,
  isPrecededByAssignmentOperator,
  isPrecededByBinaryOperator,
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
// allowing whitespace and block/line comments between `::` and the keyword
// (e.g., `pkg :: end`, `pkg::/* c */end`, `pkg:: // c\nend`).
function isPrecededByScopeResolution(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
  let i = position - 1;
  while (i >= 0) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i--;
      continue;
    }
    // Skip block/line comments between `::` and the keyword. Other excluded
    // regions (strings, escaped identifiers) are real tokens and break the
    // `:: <keyword>` adjacency.
    if (excludedRegions !== undefined) {
      let inExcluded = false;
      for (const region of excludedRegions) {
        if (i >= region.start && i < region.end) {
          const isBlockComment = source[region.start] === '/' && region.start + 1 < source.length && source[region.start + 1] === '*';
          const isLineComment = source[region.start] === '/' && region.start + 1 < source.length && source[region.start + 1] === '/';
          if (isBlockComment || isLineComment) {
            i = region.start - 1;
            inExcluded = true;
            break;
          }
          return false;
        }
      }
      if (inExcluded) continue;
    }
    break;
  }
  return i >= 1 && source[i] === ':' && source[i - 1] === ':';
}

// Returns true when a keyword starting at `position` (length `keywordLength`) is followed
// by a single `:` (not `::`), indicating the keyword is being used as a label name.
// e.g., `wait : begin`, `if : begin`. Skips whitespace, line comments, and block comments.
// Does NOT skip escaped identifiers (`\name`) because they are label names — they
// represent a separate token between the keyword and the label colon
// (e.g., `always \my_label :` is `<keyword> <label> :`, not `<label> :`).
function isFollowedByLabelColon(source: string, position: number, keywordLength: number, excludedRegions: ExcludedRegion[]): boolean {
  let i = position + keywordLength;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // Skip line comments (`//`) and block comments (`/* ... */`) — both are
    // trivia between the keyword and the label colon. Other excluded regions
    // such as escaped identifiers (`\name`) and strings are real tokens that
    // break the `<keyword> :` adjacency and must not be skipped.
    let skipped = false;
    for (const region of excludedRegions) {
      if (i >= region.start && i < region.end) {
        if (
          source[region.start] === '/' &&
          region.start + 1 < source.length &&
          (source[region.start + 1] === '*' || source[region.start + 1] === '/')
        ) {
          i = region.end;
          skipped = true;
        }
        break;
      }
    }
    if (skipped) continue;
    break;
  }
  if (i >= source.length || source[i] !== ':') return false;
  // Reject `::` (scope resolution operator)
  if (i + 1 < source.length && source[i + 1] === ':') return false;
  return true;
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

// SystemVerilog declaration introducer keywords. When one of these immediately
// precedes a block-keyword identifier (e.g., `localparam endmodule = 1;`,
// `genvar case;`), the block keyword is being used as a declared name rather
// than introducing a block. Per IEEE 1800-2017 these introducers are followed
// by either a data type (already handled by DATA_TYPE_KEYWORDS) or directly by
// the declared identifier, so adding them to the suppression set does not
// break the data-type-prefixed form (`localparam int endmodule;`) which is
// already covered by the data-type word-match in isPrecededByDataTypeKeyword.
const DECLARATION_KEYWORDS: ReadonlySet<string> = new Set(['localparam', 'parameter', 'genvar']);

// case-statement opener keywords. These keywords introduce a case statement and
// never appear as an expression operand, so finding one on the right-hand side
// of an assignment (e.g., `x = case;`) indicates it is misused as an identifier.
const CASE_KEYWORDS: ReadonlySet<string> = new Set(['case', 'casex', 'casez', 'randcase']);

export class VerilogBlockParser extends BaseBlockParser {
  // Brace index cached per source string. Built lazily on the first `{}`
  // context check of a tokenize pass and reused for every subsequent keyword in
  // the same source, so the enclosing-brace lookup stays O(log n) instead of
  // rescanning the prefix per keyword (which made parsing O(N^2)).
  private braceIndexCache: { source: string; index: BracketIndex } | null = null;

  // Paren index cached per source string. Separate from the brace index because
  // it tracks only `(` openers; the `interface` port-list check needs `()` depth
  // independent of `{}` depth.
  private parenIndexCache: { source: string; index: BracketIndex } | null = null;

  // Square-bracket index cached per source string. Separate from the brace and
  // paren indexes because it tracks only `[` openers; reserved words used as
  // identifiers inside `arr[case]` / `arr[end]` subscripts are filtered using
  // this index.
  private squareBracketIndexCache: { source: string; index: BracketIndex } | null = null;

  // Source text and excluded regions of the current parse pass, captured in
  // tokenize (which always runs immediately before matchBlocks in the base
  // pipeline). matchBlocks needs them to scan the raw source after a closing
  // `end` for a single-statement `else` that was never tokenized (an `else`
  // without a following begin/fork is not a valid block opener, so it does not
  // appear in the token stream). The base matchBlocks signature only receives
  // tokens, so the source is shared via this field rather than a parameter.
  private currentParse: { source: string; excludedRegions: ExcludedRegion[] } | null = null;

  private get validationCallbacks(): VerilogValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Returns the brace-only index for `source`, building it once and caching it
  // by source identity. Tracks only `{` so the index matches a single-kind `{}`
  // backward scan exactly. Every `{}` context check in a tokenize pass shares
  // the same index, keeping enclosing-brace lookups O(log n). excludedRegions is
  // not part of the cache key: findExcludedRegions is deterministic, so the same
  // source always yields the same regions.
  private getBraceIndex(source: string, excludedRegions: ExcludedRegion[]): BracketIndex {
    if (this.braceIndexCache !== null && this.braceIndexCache.source === source) {
      return this.braceIndexCache.index;
    }
    const index = new BracketIndex(source, excludedRegions, new Set(['{']));
    this.braceIndexCache = { source, index };
    return index;
  }

  // Returns the paren-only index for `source`, building it once and caching it
  // by source identity. Tracks only `(` so the index matches a single-kind `()`
  // forward scan exactly. Used by the `interface` port-list check. excludedRegions
  // is not part of the cache key: findExcludedRegions is deterministic, so the
  // same source always yields the same regions.
  private getParenIndex(source: string, excludedRegions: ExcludedRegion[]): BracketIndex {
    if (this.parenIndexCache !== null && this.parenIndexCache.source === source) {
      return this.parenIndexCache.index;
    }
    const index = new BracketIndex(source, excludedRegions, new Set(['(']));
    this.parenIndexCache = { source, index };
    return index;
  }

  // Returns the square-bracket-only index for `source`, building it once and
  // caching it by source identity. Tracks only `[` so the index matches a
  // single-kind `[]` lookup exactly. Used to filter block keywords used as
  // identifiers inside array subscripts (`arr[case]`, `arr[end]`).
  private getSquareBracketIndex(source: string, excludedRegions: ExcludedRegion[]): BracketIndex {
    if (this.squareBracketIndexCache !== null && this.squareBracketIndexCache.source === source) {
      return this.squareBracketIndexCache.index;
    }
    const index = new BracketIndex(source, excludedRegions, new Set(['[']));
    this.squareBracketIndexCache = { source, index };
    return index;
  }

  // Detects whether position is inside any `[...]` subscript expression. The
  // enclosing `[` is looked up in O(log n) via the square-bracket index. An
  // unclosed `[` (an incomplete subscript still being typed) reports
  // `close === -1`: treating `position` as "inside" it would suppress every
  // later block keyword in the file, so per the best-effort parsing principle
  // only a properly closed `[...]` subscript context suppresses keywords.
  private isInsideSquareBracketExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const span = this.getSquareBracketIndex(source, excludedRegions).enclosing(position);
    return span !== null && span.close >= position;
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
    // Capture the current pass's source/regions for matchBlocks (see currentParse).
    this.currentParse = { source, excludedRegions };
    let tokens = super.tokenize(source, excludedRegions);

    // Filter out tokens that are ifdef/ifndef/elsif directive macro name arguments
    const directiveArgRanges: { start: number; end: number }[] = [];
    const directiveArgPattern = /`(?:ifdef|ifndef|elsif)\b/g;
    for (const argMatch of source.matchAll(directiveArgPattern)) {
      if (this.isInExcludedRegion(argMatch.index, excludedRegions)) continue;
      let argStart = argMatch.index + argMatch[0].length;
      // Skip whitespace (space/tab/newline) and excluded regions (block comments)
      // between the directive and the macro name. Per IEEE 1800-2017, block
      // comments are valid whitespace, so `\`ifdef /* comment */ MACRO` is a
      // valid directive form. Newlines are also accepted because real-world
      // sources sometimes wrap the directive across lines.
      while (argStart < source.length) {
        const ch = source[argStart];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
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
        if (isPrecededByScopeResolution(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject default inside `'{...}` assignment pattern or any `{...}` brace
        // expression (e.g., `{default: 1}` field-style brace expressions). Only the
        // bare `default` followed by `:` outside braces is a valid case-label
        // intermediate.
        if (this.isInsideAssignmentPattern(source, token.startOffset, excludedRegions)) {
          return false;
        }
        if (this.isInsideBraceExpression(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject `default` inside `[...]` subscript (e.g., `arr[default]`). The
        // word is a misused identifier inside the subscript expression, not a
        // case_item label.
        if (this.isInsideSquareBracketExpression(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject `default` that is the single-statement body of a parenthesized
        // control header (e.g., `if (c) default: x = 1;`). There it is inside the
        // control statement's body, not a case_item label, so it must not become
        // a case `block_middle` intermediate.
        if (isInsideParenHeaderControlBody(source, token.startOffset, excludedRegions, this.validationCallbacks)) {
          return false;
        }
        // Reject `default` that is the single-statement body of a paren-less
        // control keyword (forever, initial, final, always_*, else)
        // — e.g. `forever default: x = 1;`, `else default: y = 1;`.
        if (isInsideParenlessControlBody(source, token.startOffset, excludedRegions, this.validationCallbacks)) {
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
      // Reject block_open/block_close keywords inside any `{...}` brace expression.
      // This covers `'{...}` assignment patterns, `{a, b, c}` concatenation, streaming
      // operators, and any other brace context where reserved-word block keywords
      // cannot legitimately open or close a block.
      if (token.type === 'block_open' || token.type === 'block_close') {
        if (this.isInsideBraceExpression(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject block_open/block_close keywords inside any `[...]` subscript
        // expression (e.g., `arr[case]`, `arr[end]`). Reserved words used inside
        // a subscript are misused identifiers, not real block openers/closers.
        if (this.isInsideSquareBracketExpression(source, token.startOffset, excludedRegions)) {
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
  // Skips packed/unpacked dimension specifiers (`[size]`) and block comments (`/* */`)
  // that may appear between the data-type keyword and the identifier
  // (e.g., `reg [7:0] endmodule`, `logic /* width */ endmodule`).
  private isPrecededByDataTypeKeyword(source: string, position: number, keyword?: string, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    // Skip whitespace, dimension specifiers `[...]`, and block comments backwards.
    // Loop until a stable position is reached.
    while (i >= 0) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      // Skip dimension specifier `[...]`: walk back from `]` to its matching `[`,
      // tracking nested brackets so multi-dimensional declarations work correctly.
      if (ch === ']') {
        let depth = 1;
        i--;
        while (i >= 0 && depth > 0) {
          if (excludedRegions !== undefined && this.isInExcludedRegion(i, excludedRegions)) {
            i--;
            continue;
          }
          if (source[i] === ']') depth++;
          else if (source[i] === '[') depth--;
          if (depth > 0) i--;
        }
        if (i < 0) return false;
        // i now points to the matching `[`; step before it
        i--;
        continue;
      }
      // Cast expression `(type)`: walk back from `)` to its matching `(` and
      // examine the word INSIDE the parens. SystemVerilog casts use the form
      // `(type_name)expr`, so when the close keyword sits right after `)` the
      // type name is the word between `(` and `)`. Tokenizing the reserved-word
      // operand of a cast would falsely add a close keyword that does not exist;
      // suppressing it preserves the outer BlockPair set.
      if (ch === ')') {
        // When the `)` itself is inside an excluded region, the backward
        // depth-walk below would scan through the entire excluded region —
        // and past it — looking for a matching `(`, producing O(N^2) work
        // when many attribute-prefixed declarations appear in sequence. Handle
        // the two cases of `)` inside an excluded region specially:
        //   - SystemVerilog attribute `(* ... *)`: it is whitespace-equivalent
        //     trivia between the preceding word and the keyword, so skip the
        //     entire attribute region and continue the backward scan to look
        //     for a data-type keyword before it (e.g., `int (* attr *) endmodule`).
        //   - Any other excluded region (comments, strings): the `)` is not
        //     a cast closer, so return false directly.
        if (excludedRegions !== undefined && this.isInExcludedRegion(i, excludedRegions)) {
          const region = this.findExcludedRegionAt(i, excludedRegions);
          if (region && source[region.start] === '(' && region.start + 1 < source.length && source[region.start + 1] === '*') {
            i = region.start - 1;
            continue;
          }
          return false;
        }
        let depth = 1;
        let j = i - 1;
        while (j >= 0 && depth > 0) {
          if (excludedRegions !== undefined && this.isInExcludedRegion(j, excludedRegions)) {
            j--;
            continue;
          }
          if (source[j] === ')') depth++;
          else if (source[j] === '(') depth--;
          if (depth > 0) j--;
        }
        if (j < 0 || depth !== 0) return false;
        // j points to the matching `(`. The cast type is the word inside `(...)`.
        // Skip whitespace just after `(`, then read the identifier word, then
        // verify only whitespace remains before the closing `)`.
        let k = j + 1;
        while (k < i && (source[k] === ' ' || source[k] === '\t')) k++;
        if (k >= i || !/[a-zA-Z_]/.test(source[k])) return false;
        const wordStart = k;
        while (k < i && /[a-zA-Z0-9_$]/.test(source[k])) k++;
        const wordEnd = k;
        // Reject identifier chunks touching `$` (system task names cannot be cast types)
        if (k < i && source[k] === '$') return false;
        // Only whitespace allowed between the identifier and the closing `)`.
        while (k < i && (source[k] === ' ' || source[k] === '\t')) k++;
        if (k !== i) return false;
        const word = source.slice(wordStart, wordEnd);
        if (DATA_TYPE_KEYWORDS.has(word)) return true;
        if (METHOD_QUALIFIER_KEYWORDS.has(word) && keyword !== undefined && !METHOD_QUALIFIER_TARGETS.has(keyword)) {
          return true;
        }
        return false;
      }
      // Skip `, identifier` chains for comma-separated declarations like
      // `reg a, endmodule;`. The second identifier (`endmodule`) is preceded by
      // `, a, ` — not directly by a data-type keyword. Skip back through the
      // comma and the preceding identifier to find the data-type keyword at
      // the head of the declaration list.
      if (ch === ',') {
        let m = i - 1;
        while (m >= 0 && (source[m] === ' ' || source[m] === '\t' || source[m] === '\n' || source[m] === '\r')) m--;
        // Skip dimension specifier `[...]` on the previous identifier (e.g., `reg a[7], endmodule;`)
        while (m >= 0 && source[m] === ']') {
          let depth = 1;
          m--;
          while (m >= 0 && depth > 0) {
            if (excludedRegions !== undefined && this.isInExcludedRegion(m, excludedRegions)) {
              m--;
              continue;
            }
            if (source[m] === ']') depth++;
            else if (source[m] === '[') depth--;
            if (depth > 0) m--;
          }
          if (m < 0) return false;
          m--;
          while (m >= 0 && (source[m] === ' ' || source[m] === '\t')) m--;
        }
        // The previous element must be an identifier (the previous declared name).
        if (m < 0 || !/[a-zA-Z0-9_]/.test(source[m])) return false;
        while (m >= 0 && /[a-zA-Z0-9_$]/.test(source[m])) m--;
        // Reject if identifier boundary touches `$` or `\` (escaped id).
        if (m >= 0 && (source[m] === '$' || source[m] === '\\')) return false;
        // Continue the outer loop from just before the identifier; we expect to
        // find either another `, identifier` chain or the data-type keyword.
        i = m;
        continue;
      }
      // Skip block comment `/* ... */` backward: when current position is in an
      // excluded region whose end equals i+1, jump to just before its start.
      // Only block comments are skipped — other excluded regions (escaped
      // identifiers `\name`, strings, line comments) are real tokens that break
      // the `<data-type-keyword> <identifier>` adjacency. Treating them as
      // trivia would let constructs like `int \my_var endmodule` falsely
      // suppress the trailing `endmodule` (see isFollowedByLabelColon for the
      // mirrored constraint on the forward direction).
      if (excludedRegions !== undefined && this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region && source[region.start] === '/' && region.start + 1 < source.length && source[region.start + 1] === '*') {
          i = region.start - 1;
          continue;
        }
        // Non-block-comment excluded region: terminate the backward scan. The
        // intervening string / escaped identifier / line comment breaks
        // adjacency with any prior data-type keyword.
        return false;
      }
      break;
    }
    if (i < 0 || !/[a-zA-Z0-9_]/.test(source[i])) return false;
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_$]/.test(source[i])) i--;
    const wordStart = i + 1;
    // Reject if the word boundary touches `$` (system tasks) or `\` (escaped identifier)
    if (i >= 0 && (source[i] === '$' || source[i] === '\\')) return false;
    const word = source.slice(wordStart, wordEnd);
    if (DATA_TYPE_KEYWORDS.has(word)) return true;
    // Declaration introducer keywords (localparam/parameter/genvar) suppress the
    // immediately following keyword identifier (e.g., `localparam endmodule = 1;`).
    // The data-type-prefixed form (`localparam int endmodule;`) is already covered
    // by the data-type branch above because the immediately preceding word is `int`.
    if (DECLARATION_KEYWORDS.has(word)) return true;
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

  // Detects whether position is inside any `{...}` brace expression, regardless of
  // whether the brace is preceded by an apostrophe. This includes concatenation
  // operators (`{a, b, c}`), streaming operators, and any expression context where
  // SystemVerilog block keywords cannot legitimately appear as control-flow openers.
  //
  // The enclosing `{` is looked up in O(log n) via the brace index. An unclosed `{`
  // (an incomplete concatenation/assignment pattern still being typed) reports
  // `close === -1`: treating `position` as "inside" it would suppress every later
  // block keyword in the file, so per the best-effort parsing principle only a
  // properly closed `{...}` brace context suppresses keywords.
  //
  // Predicate `span.close >= position` is intentionally inclusive (a brace closing
  // exactly AT `position` still counts as enclosing it). This non-strict bound
  // verbatim reproduces the legacy backward scan's `i >= position` test and is
  // deliberately asymmetric with the `()`-depth `isInsideParens` check, which uses
  // a strict `>`; do not "normalize" the two.
  private isInsideBraceExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const span = this.getBraceIndex(source, excludedRegions).enclosing(position);
    return span !== null && span.close >= position;
  }

  // Detects whether position is inside a SystemVerilog assignment pattern: `'{...}`.
  // Same enclosing-brace lookup as isInsideBraceExpression, with the extra
  // requirement that the enclosing `{` is immediately preceded by an apostrophe.
  //
  // `source[span.open - 1]` is referenced unconditionally (guarded only by
  // `span.open > 0`), matching the legacy scan which read `source[i - 1]` without
  // an excluded-region check. Adding such a check here would diverge from the
  // legacy behavior, so it is intentionally omitted.
  private isInsideAssignmentPattern(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const span = this.getBraceIndex(source, excludedRegions).enclosing(position);
    return span !== null && span.close >= position && span.open > 0 && source[span.open - 1] === "'";
  }

  // Returns true when `position` is inside a `#(...)` delay/parameter expression.
  // Detection: walk back from the nearest enclosing `(` and check the immediately
  // preceding non-whitespace, non-comment character is `#`. A delay expression
  // (`#(expr)`) cannot legitimately contain reserved-word identifiers, so block
  // keywords appearing inside must be suppressed.
  private isInsideDelayExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const span = this.getParenIndex(source, excludedRegions).enclosing(position);
    if (span === null || span.close < position) return false;
    let k = span.open - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--;
    // Block comments / line comments between `#` and `(` are allowed; skip them.
    while (k >= 0 && this.isInExcludedRegion(k, excludedRegions)) {
      const region = this.findExcludedRegionAt(k, excludedRegions);
      if (!region) break;
      const isBlockComment = source[region.start] === '/' && region.start + 1 < source.length && source[region.start + 1] === '*';
      const isLineComment = source[region.start] === '/' && region.start + 1 < source.length && source[region.start + 1] === '/';
      if (!isBlockComment && !isLineComment) break;
      k = region.start - 1;
      while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--;
    }
    return k >= 0 && source[k] === '#';
  }

  // Returns true when the keyword at `position` follows a label colon whose label
  // name is itself a reserved word AND the enclosing block is a case statement.
  // In that situation the preceding `<keyword> :` is a case_item label (its name
  // happens to be a reserved word) and the keyword after the colon is the real
  // block opener, so the generic label-colon suppression must be skipped.
  private isCaseItemLabelKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const labelWord = getPrecedingLabelColonWord(source, position, excludedRegions, this.validationCallbacks);
    if (labelWord === null) {
      return false;
    }
    // Scan backward from just before the label word to find the enclosing block.
    return isEnclosingBlockCase(source, labelWord.wordStart - 1, excludedRegions, this.keywords, this.validationCallbacks);
  }

  // Returns true when a keyword at `position` is being used as the case_item label
  // NAME itself: the keyword is immediately followed by a single `:` (not `::`)
  // AND the enclosing block is a case statement. The case_item label is an
  // identifier expression and reserved words cannot legitimately be identifiers,
  // so the keyword must be treated as a misused label name rather than a real
  // block opener/closer. Restricted to case context because outside a case,
  // `<keyword> : <name>` is the named-block syntax where the leading keyword
  // really does open a block.
  private isCaseItemLabelName(source: string, position: number, keywordLength: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!isFollowedByLabelColon(source, position, keywordLength, excludedRegions)) {
      return false;
    }
    return isEnclosingBlockCase(source, position - 1, excludedRegions, this.keywords, this.validationCallbacks);
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

    // Reject any keyword inside a `#(...)` delay/parameter expression. Reserved
    // words cannot legitimately appear as delay/parameter expression operands;
    // tokenizing them would generate bogus BlockPairs against later close keywords.
    if (this.isInsideDelayExpression(source, position, excludedRegions)) {
      return false;
    }

    // Reject keywords preceded by :: (scope resolution operator like pkg::begin),
    // including whitespace-separated forms like `pkg :: begin`.
    if (isPrecededByScopeResolution(source, position, excludedRegions)) {
      return false;
    }

    // Reject keywords adjacent to $ (system tasks like $end, identifiers like fork$sig)
    if (hasDollarAdjacent(source, position, keyword)) {
      return false;
    }

    // Reject keywords used as identifiers after a data type/qualifier keyword
    // (e.g., `int function`, `input module`, `bit task`, `reg [7:0] endmodule`)
    if (this.isPrecededByDataTypeKeyword(source, position, keyword, excludedRegions)) {
      return false;
    }

    // Reject case-statement keywords misused as identifiers on the right-hand side
    // of an operator. A case keyword can only appear at statement position and
    // never as an expression operand, so a preceding operator means it is being
    // used as an identifier — regardless of whether an opening paren follows.
    // - Assignment operators: `x = case;`, `y <= casex;`, `b = randcase;`, `x = case(y);`
    // - Comparison/arithmetic/bitwise/logical operators: `if (x == casez)`,
    //   `if (a + casex)`, `b & casez`. (A following `(` does not rescue the
    //   `case (expr)` statement form here because a case statement cannot legally
    //   appear after an operator in the first place.)
    if (
      CASE_KEYWORDS.has(keyword) &&
      (isPrecededByAssignmentOperator(source, position, excludedRegions, this.validationCallbacks) ||
        isPrecededByBinaryOperator(source, position, excludedRegions, this.validationCallbacks))
    ) {
      return false;
    }

    // Reject case-statement keywords used as the LEFT operand of a binary operator
    // (e.g., `if (case == x)`). The canonical case statement form is `case (expr)`
    // so a directly-following operator means the keyword is being misused as an
    // expression operand. Mirrors the preceding-operator suppression above.
    if (CASE_KEYWORDS.has(keyword) && isFollowedByBinaryOperator(source, position, keyword.length, excludedRegions, this.validationCallbacks)) {
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

    // Reject keywords used as block labels (e.g., begin : module, fork : begin).
    // Exception: in `<keyword> : <keyword>` form, when the preceding word is itself a
    // reserved word used as a case-item label name (e.g., `case (s) begin: begin ... end`),
    // the keyword AFTER the colon is the real block opener — not a label name — so it
    // must not be suppressed. This only applies inside an enclosing case statement;
    // outside a case, `<keyword> : <name>` is a named block whose leading keyword opens it.
    if (isPrecededByLabelColon(source, position, excludedRegions, this.keywords, this.validationCallbacks)) {
      if (!this.isCaseItemLabelKeyword(source, position, excludedRegions)) {
        return false;
      }
    }

    // Reject control keywords used as a label name (e.g., `wait : begin`, `if : begin`).
    // The keyword is the label, not a control-keyword opener. Restrict to CONTROL_KEYWORDS
    // because non-control block openers (e.g., `module`, `class`) followed by `:` are not
    // typical label patterns and may have legitimate syntax meanings (e.g., parameter `:`).
    if (CONTROL_KEYWORDS.includes(keyword) && isFollowedByLabelColon(source, position, keyword.length, excludedRegions)) {
      return false;
    }

    // Inside a case statement, reject any block_open keyword used as a case_item
    // label NAME (e.g., `case (s) module: x = 1;`). The case_item label is an
    // identifier expression and reserved words cannot legitimately be identifiers.
    // Without this check the keyword would be tokenized and pair with a later
    // close keyword, breaking the BlockPair set. Restricted to case context so
    // outside a case the named-block `<keyword> : <name>` form still opens a block.
    if (!CONTROL_KEYWORDS.includes(keyword) && this.isCaseItemLabelName(source, position, keyword.length, excludedRegions)) {
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
    if (keyword === 'interface' && isInsideParens(position, this.getParenIndex(source, excludedRegions))) {
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

    // Reject any close keyword inside a `#(...)` delay/parameter expression
    // (mirrors the isValidBlockOpen check). Reserved words cannot legitimately
    // appear as delay/parameter expression operands.
    if (this.isInsideDelayExpression(source, position, excludedRegions)) {
      return false;
    }

    // Reject keywords preceded by :: (scope resolution operator like pkg::end),
    // including forms with whitespace between `::` and the keyword (`pkg :: end`).
    if (isPrecededByScopeResolution(source, position, excludedRegions)) {
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
    // (e.g., `int endmodule;` — endmodule is an illegal variable name preceded by `int`,
    // or `reg [7:0] endmodule;` — same with packed dimension specifier).
    if (this.isPrecededByDataTypeKeyword(source, position, keyword, excludedRegions)) {
      return false;
    }

    // Inside a case statement, reject any block_close keyword used as a case_item
    // label NAME (e.g., `case (s) endcase: x = 1;`). The case_item label is an
    // identifier expression and reserved words cannot legitimately be identifiers.
    // Without this check the close keyword would prematurely pair with an earlier
    // open, breaking the outer case/endcase BlockPair.
    if (this.isCaseItemLabelName(source, position, keyword.length, excludedRegions)) {
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
                // 'default' only attaches to case/casex/casez/randcase blocks
                if (isCaseMiddle && openerValue !== 'case' && openerValue !== 'casex' && openerValue !== 'casez' && openerValue !== 'randcase') {
                  // A statement-block opener (begin/fork) establishes a scope where
                  // 'default' is no longer at a case_item position. Stop scanning
                  // instead of skipping past it: attaching 'default' to a case
                  // below would be a false intermediate. Leaving it unattached
                  // (uncolored) is preferred over an incorrect attachment.
                  if (openerValue === 'begin' || openerValue === 'fork') {
                    break;
                  }
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
                const hasElseNext = this.isElseNext(token, tokens, ti);
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

    const hasElseNext = this.isElseNext(token, tokens, currentTokenIndex);
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

  // Returns true when an `else` follows the closing `end` at `token`, meaning the
  // enclosing if/else construct is not yet complete and chained control keywords
  // must NOT be consumed by this `end`.
  //
  // Two detection paths are needed because an `else` may or may not be tokenized:
  // 1. Token stream: an `else begin ... end` form tokenizes `else` as a block_open,
  //    possibly after preprocessor directives (`ifdef/`endif) that wrap the gap
  //    between `end` and `else`. Skipping those directive tokens and checking the
  //    first real token covers the preprocessor-wrapped cases.
  // 2. Raw source: a single-statement `else` (e.g., `end\nelse\n  y = 2;`) is NOT a
  //    valid block opener (no following begin/fork) so it never enters the token
  //    stream. Path 1 then sees nothing and would let `end` over-consume the outer
  //    control keyword. Scanning the source immediately after `end` for a bare
  //    `else` word recovers this case. Path 1 already handled every directive-wrapped
  //    form, so the source scan does not need to step over preprocessor directives.
  private isElseNext(token: Token, tokens: Token[], currentTokenIndex: number): boolean {
    for (let ni = currentTokenIndex + 1; ni < tokens.length; ni++) {
      const candidateToken = tokens[ni];
      // Skip preprocessor directive tokens between `end` and a tokenized `else`
      if (candidateToken.value.startsWith('`')) continue;
      if (candidateToken.type === 'block_open' && candidateToken.value === 'else') {
        return true;
      }
      break;
    }
    // Single-statement else: scan the raw source right after the closing `end`.
    if (this.currentParse !== null) {
      return isFollowedByWord(this.currentParse.source, token.endOffset, 'else', this.currentParse.excludedRegions, this.validationCallbacks);
    }
    return false;
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
