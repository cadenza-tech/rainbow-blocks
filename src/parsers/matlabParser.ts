// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

export class MatlabBlockParser extends BaseBlockParser {
  // Validates block close: 'end' inside parentheses or brackets is array indexing, not block close
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject end preceded by dot (struct field access like s.end or s . end)
    if (this.isPrecededByDot(source, position, excludedRegions)) {
      return false;
    }
    // Reject end used as variable name (end = 5)
    if (this.isFollowedBySimpleAssignment(source, position + keyword.length)) {
      return false;
    }
    // Reject end immediately followed by a single `.` that is NOT part of `..` (line
    // continuation marker prefix). `end.field` is struct field-access syntax, not a block
    // close — the `end` is an identifier in expression context.
    const afterPos = position + keyword.length;
    if (source[afterPos] === '.' && source[afterPos + 1] !== '.') {
      return false;
    }
    // Reject end immediately after `:` on a for-loop header line. Such `end` is part of
    // the loop's range expression (e.g., `for i = 1:end`) — array-index `end`, not block close.
    if (this.isEndInForHeaderRange(source, position, excludedRegions)) {
      return false;
    }
    // Reject end immediately preceded by a binary expression operator (+, -, *, /, ^, <, >, etc.).
    // Such forms (`x = 1 + end`, `if x < end then`) are invalid MATLAB/Octave outside of array
    // indexing, but parsing them as block close destroys outer block pairing.
    if (keyword === 'end' && this.isPrecededByBinaryOperator(source, position, excludedRegions)) {
      return false;
    }
    // Reject end used as a command-syntax argument (`disp end` → `disp('end')`). The pattern
    // is `<identifier> <whitespace> end` at statement start where the identifier is not a
    // recognized keyword. Treating such `end` as block close destroys outer block pairing.
    if (keyword === 'end' && this.isCommandSyntaxArgument(source, position)) {
      return false;
    }
    // Check all close keywords (end, endfunction, endif, etc.) for parenthesis/bracket context
    return !this.isInsideParensOrBrackets(source, position, excludedRegions);
  }

  // Returns true when `end` at position is the argument of a command-syntax invocation,
  // e.g. `disp end`. Detection is conservative: requires the preceding non-whitespace to
  // form an identifier that begins at statement start (line start, or after `;`/`,`) and
  // is not one of the recognized block keywords.
  private isCommandSyntaxArgument(source: string, position: number): boolean {
    let i = position - 1;
    // Require at least one space/tab between the identifier and `end`
    if (i < 0 || (source[i] !== ' ' && source[i] !== '\t')) return false;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i < 0) return false;
    // Must end with an identifier character
    const idEnd = i;
    if (!/[a-zA-Z0-9_]/.test(source[idEnd])) return false;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const idStart = i + 1;
    const ident = source.slice(idStart, idEnd + 1);
    // Identifier must start with letter or underscore
    if (!/^[a-zA-Z_]/.test(ident)) return false;
    // Skip recognized block keywords — `if end`, `for end`, `function end` etc. are not
    // command syntax (they are syntax errors, but treating `end` as a block close in such
    // pathological inputs is at least consistent with the rest of the parser's behavior).
    if (MatlabBlockParser.ALL_BLOCK_KEYWORDS.has(ident.toLowerCase())) return false;
    // The identifier must begin at statement start: line start (only whitespace before)
    // or after a `;`/`,` separator on the same line.
    let j = idStart - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) j--;
    if (j < 0) return true;
    const ch = source[j];
    return ch === '\n' || ch === '\r' || ch === ';' || ch === ',';
  }

  // All recognized block keywords (open + close + middle), used to filter command-syntax detection.
  private static readonly ALL_BLOCK_KEYWORDS = new Set([
    'function',
    'if',
    'for',
    'while',
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
    'end',
    'else',
    'elseif',
    'case',
    'otherwise',
    'catch',
    // Octave-specific block-close keywords (subclass adds them, but listing here keeps
    // detection consistent if MATLAB code happens to use these identifiers as commands).
    'endfunction',
    'endif',
    'endfor',
    'endwhile',
    'endswitch',
    'endtry_catch',
    'endparfor',
    'endspmd',
    'endclassdef',
    'endmethods',
    'endproperties',
    'endevents',
    'endenumeration',
    'until',
    'do',
    'unwind_protect',
    'unwind_protect_cleanup',
    'end_unwind_protect'
  ]);

  // Returns true when `end` at position is preceded by an expression operator that makes
  // `end` an operand outside any array-indexing context. Such uses (`x = end`, `x = 1:end`,
  // `x = ~end`, `for i = end-1:5`) are invalid MATLAB outside indexing; treating them as
  // block_close destroys outer block pairing. The for-header range check (isEndInForHeaderRange)
  // is invoked before this and handles legitimate `for i = N:end` / `for i = end:N` cases.
  private isPrecededByBinaryOperator(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      // Skip excluded regions backward for line continuations (... in MATLAB and \ in Octave).
      // The continuation region spans from the marker through the trailing newline; jumping
      // to region.start - 1 lands us on the character that immediately precedes the
      // continuation on the previous logical line.
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === ' ' || source[i] === '\t') {
        i--;
        continue;
      }
      // A bare newline reached during backward scan may sit immediately after a `...`
      // (or `\`) line continuation. matchSingleLineComment for `...` ends at the newline
      // start, so an excluded region whose end == nlStart and which begins with `.` or `\`
      // signals a continuation; in that case we keep walking past the prior logical line.
      if ((source[i] === '\n' || source[i] === '\r') && excludedRegions) {
        let nlStart = i;
        if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') {
          nlStart = i - 1;
        }
        const regionBeforeNl = this.findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
        if (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) {
          i = regionBeforeNl.start - 1;
          continue;
        }
      }
      break;
    }
    if (i < 0) return false;
    const ch = source[i];
    // Operators that put `end` in an expression context.
    // `\` is MATLAB's left-division operator; treat it like other binary operators.
    if ('+*/^<>&|~:\\'.includes(ch)) return true;
    // `=` marks an operator. Both single `=` (assignment) and compound comparison operators
    // (`==`, `>=`, `<=`, `!=`, `~=`) put `end` in expression context (operand): `end` on the
    // RHS / after a comparison is invalid outside indexing, so return true to reject the
    // bogus block_close.
    if (ch === '=') {
      return true;
    }
    // `-` could be unary; treat it as a value-context marker (i.e. end is operand) when
    // (a) it follows a value-like char (binary minus), or
    // (b) it follows `=`, `(`, `,`, `;`, `[`, `{`, or another operator (unary minus on RHS).
    if (ch === '-') {
      let j = i - 1;
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) j--;
      if (j < 0) return false;
      const prev = source[j];
      if (/[a-zA-Z0-9_)\]}]/.test(prev)) return true;
      if (prev === '=' || prev === '(' || prev === ',' || prev === ';' || prev === '[' || prev === '{') return true;
      if ('+*/^<>&|~:\\'.includes(prev)) return true;
      return false;
    }
    return false;
  }

  // Returns true when `end` is part of a for-loop header range expression.
  // Recognizes both `for` and `parfor`, and `for` after `;`/`,` separators on the same line.
  // Skips across `...` line continuations when scanning backward for the `:`.
  // Two range positions detected:
  //   * RHS: `for i = 1:end`  — `end` directly preceded by `:`
  //   * LHS: `for i = end:5`  — `end` directly followed by `:`
  private isEndInForHeaderRange(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    // Case 1: end is preceded by `:` (RHS of range, e.g. `for i = 1:end`)
    let i = position - 1;
    while (i >= 0) {
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      if ((ch === '\n' || ch === '\r') && excludedRegions) {
        let nlStart = i;
        if (ch === '\n' && i > 0 && source[i - 1] === '\r') {
          nlStart = i - 1;
        }
        const regionBeforeNl = this.findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
        if (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) {
          i = nlStart - 1;
          continue;
        }
      }
      break;
    }
    if (i >= 0 && source[i] === ':') {
      const beforeText = this.collectLogicalLineBefore(source, i, excludedRegions);
      if (/(?:^|[;,])\s*(?:par)?for[\s(]/.test(beforeText)) return true;
    }

    // Case 2: end is followed by `:` (LHS of range, e.g. `for i = end:5`)
    let j = position + 3; // length of 'end'
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j < source.length && source[j] === ':' && j + 1 < source.length && source[j + 1] !== '=') {
      const beforeEnd = this.collectLogicalLineBefore(source, position, excludedRegions);
      // Require an `=` (assignment in for-header) before `end` on the same line, with for at start
      if (/(?:^|[;,])\s*(?:par)?for[\s(].*=\s*$/.test(beforeEnd)) return true;
    }

    return false;
  }

  // Collects the logical line content preceding `position`, following `...` (and Octave `\`)
  // continuations backward across physical line breaks. Returns the joined text with newlines
  // collapsed to single spaces so anchored regexes still match.
  private collectLogicalLineBefore(source: string, position: number, excludedRegions?: ExcludedRegion[]): string {
    const segments: string[] = [];
    let cursor = position;
    while (cursor > 0) {
      const lineStart = Math.max(source.lastIndexOf('\n', cursor - 1), source.lastIndexOf('\r', cursor - 1)) + 1;
      segments.unshift(source.slice(lineStart, cursor));
      if (lineStart === 0) break;
      // Look at the previous physical line; if it ends with a `...` (or `\`) continuation
      // excluded region, walk further back. Otherwise stop.
      let nlEnd = lineStart - 1;
      if (nlEnd > 0 && source[nlEnd] === '\n' && source[nlEnd - 1] === '\r') nlEnd--;
      if (!excludedRegions) break;
      const regionAtEnd = this.findExcludedRegionAt(nlEnd > 0 ? nlEnd - 1 : 0, excludedRegions);
      if (!regionAtEnd || regionAtEnd.end !== nlEnd) break;
      const regionStartCh = source[regionAtEnd.start];
      if (regionStartCh !== '.' && regionStartCh !== '\\') break;
      cursor = regionAtEnd.start;
    }
    return segments.join(' ');
  }

  // Classdef section keywords that can also be used as function calls
  private static readonly CLASSDEF_SECTION_KEYWORDS = new Set(['properties', 'methods', 'events', 'enumeration', 'arguments']);

  // Reject struct field access for block openers (s.if, s.for, s . if, etc)
  // Reject classdef section keywords used as function calls (properties(obj))
  // Reject keywords used as function handles (@if, @while, @function)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByDot(source, position, excludedRegions)) {
      return false;
    }
    if (this.isPrecededByAtSign(source, position)) {
      return false;
    }
    if (MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      if (this.isKeywordUsedAsFunctionCall(source, position, keyword)) {
        return false;
      }
      // Check if keyword is used as a variable (followed by =, but not ==)
      let afterPos = position + keyword.length;
      while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
        afterPos++;
      }
      if (afterPos < source.length && source[afterPos] === '=' && (afterPos + 1 >= source.length || source[afterPos + 1] !== '=')) {
        return false;
      }
      // Reject classdef section keywords inside parentheses or brackets
      if (this.isInsideParensOrBrackets(source, position, excludedRegions)) {
        return false;
      }
      // Classdef section keywords must appear at line start (after whitespace only)
      const lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
      const textBefore = source.slice(lineStart, position);
      if (/\S/.test(textBefore)) {
        return false;
      }
      // Reject if followed by operator, punctuation, or string literal (used as variable, not section keyword)
      // Valid section keywords are followed by newline, EOF, '(' (attribute list), comment (% or #), or line continuation (...)
      let nextPos = position + keyword.length;
      while (nextPos < source.length && (source[nextPos] === ' ' || source[nextPos] === '\t')) {
        nextPos++;
      }
      if (nextPos < source.length) {
        const excludedRegion = this.findExcludedRegionAt(nextPos, excludedRegions);
        if (excludedRegion) {
          // Reject if inside a string literal (starts with ' or ")
          const regionStart = source[excludedRegion.start];
          if (regionStart === "'" || regionStart === '"') {
            return false;
          }
          // Accept if inside a comment (%), line continuation (...), or shell escape (!)
        } else {
          const nextChar = source[nextPos];
          // Allowed: newline, EOF, '(' (attribute list), '%' (comment), language-specific comment chars,
          // and statement-empty markers ';', ',', ':' (e.g., `properties;` is a valid empty section)
          if (
            nextChar !== '\n' &&
            nextChar !== '\r' &&
            nextChar !== '(' &&
            nextChar !== '%' &&
            nextChar !== ';' &&
            nextChar !== ',' &&
            nextChar !== ':' &&
            !this.isCommentChar(nextChar)
          ) {
            return false;
          }
        }
      }
    }
    // Reject block opener keywords used as variable names (for = 10, if = 5)
    if (!MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      if (this.isFollowedBySimpleAssignment(source, position + keyword.length)) {
        return false;
      }
      // Reject block opener used as standalone identifier on the RHS of an assignment
      // (e.g., `r = for;`, `r = if;`, `x = while)`). Such usages have no body, so the
      // keyword cannot be a real block opener.
      if (this.isUsedAsRhsIdentifier(source, position, keyword, excludedRegions)) {
        return false;
      }
    }
    // Reject any block opener inside parentheses or brackets
    if (this.isInsideParensOrBrackets(source, position, excludedRegions)) {
      return false;
    }
    // Reject keyword followed immediately by `.` (struct field access, e.g., `do.x = 1`)
    if (source[position + keyword.length] === '.' && source[position + keyword.length + 1] !== '.') {
      return false;
    }
    // Reject reserved keywords used as function calls in expression context
    // (e.g., `x = classdef()`, `x = parfor(...)`, `x = if(...)`)
    // `function f()` is unaffected since `f` (not `function`) is followed by `(`
    if (this.isKeywordUsedAsFunctionCall(source, position, keyword)) {
      return false;
    }
    return true;
  }

  // Returns true when a block-opener keyword is being used as a standalone identifier on
  // the RHS of an assignment with no body following. Such forms (`r = for;`, `r = if,`,
  // `x = while)`) are invalid MATLAB but should not destroy outer block pairing.
  // A `;` or `,` between the `=` and the keyword terminates the assignment context, so
  // `x=1; do<NL>` should NOT treat `do` as an RHS identifier.
  // Follows `...` line continuations backward so `r = ...\n  for;` is detected correctly.
  private isUsedAsRhsIdentifier(source: string, position: number, keyword: string, excludedRegions?: ExcludedRegion[]): boolean {
    const before = this.collectLogicalLineBefore(source, position, excludedRegions);
    let hasAssignmentBefore = false;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ';' || ch === ',') {
        return false;
      }
      if (ch === '=') {
        const prev = i > 0 ? before[i - 1] : '';
        const next = i + 1 < before.length ? before[i + 1] : '';
        if (next === '=' || prev === '<' || prev === '>' || prev === '!' || prev === '~' || prev === '=') {
          continue;
        }
        hasAssignmentBefore = true;
        break;
      }
    }
    if (!hasAssignmentBefore) return false;
    let i = position + keyword.length;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
    if (i >= source.length) return true;
    const next = source[i];
    return next === ';' || next === ',' || next === ')' || next === ']' || next === '}' || next === '\n' || next === '\r';
  }

  // Checks if a classdef section keyword is used as a function call
  // Returns true if the keyword is followed by '(' and preceded by
  // assignment, expression operator, or appears inside an expression
  private isKeywordUsedAsFunctionCall(source: string, position: number, keyword: string): boolean {
    // Check if followed by '(' (skip whitespace)
    let afterPos = position + keyword.length;
    while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
      afterPos++;
    }
    if (afterPos >= source.length || source[afterPos] !== '(') {
      return false;
    }

    // Check if preceded by an expression context on the same line
    let beforePos = position - 1;
    while (beforePos >= 0 && (source[beforePos] === ' ' || source[beforePos] === '\t')) {
      beforePos--;
    }
    if (beforePos < 0 || source[beforePos] === '\n' || source[beforePos] === '\r') {
      // At start of line followed by '(' - function call like properties(obj)
      // But classdef section keywords at line start with '(' after are also
      // valid as access modifiers: properties (Access = public)
      // Check if there's a matching ')' then look at what follows
      // A simpler heuristic: if preceded by '=', ',', '(', '[', '{', or ';' it's a call
      return false;
    }

    const prevChar = source[beforePos];
    // If preceded by =, (, [, {, , or ; it's being used in an expression context
    if (prevChar === '=' || prevChar === '(' || prevChar === '[' || prevChar === '{' || prevChar === ',' || prevChar === ';') {
      return true;
    }

    return false;
  }

  // Filter out block_middle keywords that are struct field access (s.else, s . case),
  // used as variable names (e.g., `case = 5`, `else = 1`), or appear inside parens/brackets/
  // braces (e.g., `foo(case)` where `case` is a name argument).
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      if (this.isPrecededByDot(source, token.startOffset, excludedRegions)) {
        return false;
      }
      if (token.type === 'block_middle') {
        if (this.isFollowedBySimpleAssignment(source, token.startOffset + token.value.length)) {
          return false;
        }
        if (this.isInsideParensOrBrackets(source, token.startOffset, excludedRegions)) {
          return false;
        }
      }
      return true;
    });
  }

  // Validates intermediate keywords against their opener type
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];
    // Track stack depths at which a block opener was rejected, so the corresponding
    // `end` (which appears at the same depth) can be skipped without consuming a
    // legitimate inner block's close.
    const pendingSkipDepths: number[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          // Classdef section keywords (properties/methods/events/enumeration)
          // are valid block openers only inside a classdef block.
          // The 'arguments' block is special: introduced in MATLAB R2019b for
          // input/output validation, it appears inside a function body (which itself
          // may live inside classdef→methods). Therefore it is valid when an enclosing
          // function/methods/classdef is on the stack.
          if (MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(token.value.toLowerCase())) {
            const isArguments = token.value.toLowerCase() === 'arguments';
            if (isArguments) {
              const hasFunctionOrClass = stack.some((b) => {
                const v = b.token.value.toLowerCase();
                return v === 'function' || v === 'methods' || v === 'classdef';
              });
              if (!hasFunctionOrClass) {
                pendingSkipDepths.push(stack.length);
                break;
              }
            } else {
              const hasClassdef = stack.some((b) => b.token.value.toLowerCase() === 'classdef');
              if (!hasClassdef) {
                pendingSkipDepths.push(stack.length);
                break;
              }
            }
          }
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const middleValue = token.value.toLowerCase();
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            if (middleValue === 'else' || middleValue === 'elseif') {
              if (topOpener !== 'if') break;
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          // Skip the `end` only when the current stack depth matches the depth
          // recorded for a rejected opener — this preserves legitimate inner block
          // pairings even when an enclosing classdef section keyword was rejected.
          if (pendingSkipDepths.length > 0 && pendingSkipDepths[pendingSkipDepths.length - 1] === stack.length) {
            pendingSkipDepths.pop();
            break;
          }
          const openBlock = stack.pop();
          if (openBlock) {
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

  // Checks if position is preceded by dot (possibly with whitespace: s . end)
  // Handles ... line continuation: obj. ...\n    end is struct field access
  protected isPrecededByDot(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      // Skip excluded regions backward for line continuations (... and \ in Octave)
      if (excludedRegions) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === ' ' || source[i] === '\t') {
        i--;
        continue;
      }
      // Skip newlines that are immediately after an excluded region that is a ... line continuation
      // matchSingleLineComment sets region.end to the newline position, so check if any
      // excluded region ends exactly at this newline position AND starts with '.' (continuation)
      if ((source[i] === '\n' || source[i] === '\r') && excludedRegions) {
        let nlStart = i;
        if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') {
          nlStart = i - 1;
        }
        const regionBeforeNl = this.findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
        const regionBeforeLf = this.findExcludedRegionAt(i > 0 ? i - 1 : 0, excludedRegions);
        if (
          (regionBeforeNl?.end === nlStart && (source[regionBeforeNl.start] === '.' || source[regionBeforeNl.start] === '\\')) ||
          (regionBeforeLf?.end === i && (source[regionBeforeLf.start] === '.' || source[regionBeforeLf.start] === '\\'))
        ) {
          i = nlStart - 1;
          continue;
        }
        // Note: bare trailing dot without ... is NOT a continuation in MATLAB/Octave
        // obj.\nend means end is on a new line (not preceded by dot for struct access)
      }
      break;
    }
    // Distinguish struct field access dot (obj.end, data1.end) from numeric decimal point (10.)
    if (i >= 0 && source[i] === '.') {
      // Scan backward past digits, hex letters, and hex/binary prefix letters that form numeric literals
      let j = i - 1;
      while (j >= 0 && /[0-9a-fA-FxXbB_]/.test(source[j])) {
        j--;
      }
      // Check for numeric literal patterns: digits only, exponent (1e5), imaginary (1i/5j),
      // hex prefix (0xFF), binary prefix (0b1010)
      if (j < i - 1) {
        const numPart = source.slice(j + 1, i);
        // Reject when the run is preceded by another `.` — this means
        // the digits are part of a larger expression like `1.5.end`, not a clean numeric literal
        const beforeNum = j >= 0 ? source[j] : '';
        if (beforeNum === '.') {
          return true;
        }
        // Reject scientific notation followed by `.` (e.g., `1e5.end`):
        // `1e5.` is not a valid number suffix, so `.end` is struct field access
        if (/[eE]/.test(numPart)) {
          return true;
        }
        // Pure digits, hex literals (0x...), binary literals (0b...), or digits with suffixes
        // followed by `.keyword` form invalid syntax (e.g., `10.end`, `0xFF.if`).
        // When keyword directly abuts the dot (no whitespace/continuation), treat as filtered
        // to avoid breaking outer block highlighting. When separated, the dot is a decimal
        // point and the keyword is a separate statement opener.
        if (
          (/^[0-9][0-9a-fA-F_]*$/.test(numPart) || /^0[xX][0-9a-fA-F_]+$/.test(numPart) || /^0[bB][01_]+$/.test(numPart)) &&
          (j < 0 || !(/[a-zA-Z_]/.test(source[j]) || /\p{L}/u.test(source[j])))
        ) {
          if (i + 1 === position) {
            return true;
          }
          return false;
        }
      }
      return true;
    }
    return false;
  }

  // Checks if position is inside parentheses, square brackets, or curly braces
  // Verifies that the opening bracket has a matching close ahead (in-progress edits
  // with unterminated brackets should not silently swallow all subsequent `end` tokens)
  protected isInsideParensOrBrackets(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let i = position - 1; i >= 0; i--) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }
      const char = source[i];
      if (char === ')') parenDepth++;
      else if (char === '(') {
        if (parenDepth === 0) {
          return this.hasMatchingCloseAhead(source, i, ')', '(', position, excludedRegions);
        }
        parenDepth--;
      } else if (char === ']') bracketDepth++;
      else if (char === '[') {
        if (bracketDepth === 0) {
          return this.hasMatchingCloseAhead(source, i, ']', '[', position, excludedRegions);
        }
        bracketDepth--;
      } else if (char === '}') braceDepth++;
      else if (char === '{') {
        if (braceDepth === 0) {
          return this.hasMatchingCloseAhead(source, i, '}', '{', position, excludedRegions);
        }
        braceDepth--;
      }
    }
    return false;
  }

  // Scans forward from openPos+1 looking for a matching close bracket, tracking nested brackets
  private hasMatchingCloseAhead(
    source: string,
    openPos: number,
    closeCh: string,
    openCh: string,
    keywordPos: number,
    excludedRegions: ExcludedRegion[]
  ): boolean {
    let depth = 1;
    let i = openPos + 1;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) return i > keywordPos;
      }
      i++;
    }
    return false;
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'function',
      'if',
      'for',
      'while',
      'switch',
      'try',
      'parfor',
      'spmd',
      'classdef',
      'methods',
      'properties',
      'events',
      'enumeration',
      'arguments'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch']
  };

  // Checks if position is preceded by `@` (function handle prefix: @keyword)
  // Allows whitespace between `@` and keyword position is NOT allowed in MATLAB —
  // function handles must be `@name` with no space, so we only check the immediate prior char
  protected isPrecededByAtSign(source: string, position: number): boolean {
    return position > 0 && source[position - 1] === '@';
  }

  // Checks if keyword is followed by = (but not ==) indicating variable assignment
  protected isFollowedBySimpleAssignment(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    return i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=');
  }

  // Checks if a character is a comment prefix (overridden in Octave to include #)
  protected isCommentChar(_char: string): boolean {
    return false;
  }

  // Checks if position is at line start allowing leading whitespace.
  // Also skips a leading UTF-8/UTF-16 BOM (U+FEFF) so files saved with a byte-order mark
  // still recognise block comments (`%{`/`#{`) and shell escapes (`!`) at the file start.
  protected isAtLineStartWithWhitespace(source: string, pos: number): boolean {
    if (pos === 0) return true;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '﻿')) {
      i--;
    }
    return i < 0 || source[i] === '\n' || source[i] === '\r';
  }

  // Checks if position is at the start of a statement (line start or after ; , )
  // Also skips a leading UTF-8/UTF-16 BOM (U+FEFF) so files saved with a byte-order mark
  // still recognise the leading shell escape (`!`) at the file start.
  private isAtStatementStart(source: string, pos: number): boolean {
    if (pos === 0) return true;
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '﻿')) {
      i--;
    }
    if (i < 0) return true;
    const ch = source[i];
    return ch === '\n' || ch === '\r' || ch === ';' || ch === ',';
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (only if %{ is alone on the line)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Single-line comment: %
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // String literal: '...' (MATLAB uses '' for escaped single quote)
    if (char === "'") {
      return this.matchMatlabString(source, pos);
    }

    // Double-quoted string (MATLAB R2017a+)
    if (char === '"') {
      return this.matchDoubleQuotedString(source, pos);
    }

    // Line continuation: ... to end of line (treated as comment)
    if (char === '.' && pos + 2 < source.length && source[pos + 1] === '.' && source[pos + 2] === '.') {
      return this.matchSingleLineComment(source, pos);
    }

    // Shell escape command: ! to end of line (at statement start: line start or after ; ,)
    if (char === '!' && this.isAtStatementStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if %{ is alone on the line (no trailing non-whitespace content).
  // Treats space, tab, vertical tab (\v = \x0B), and form feed (\f = \x0C) as whitespace.
  private isBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      const ch = source[i];
      if (ch !== ' ' && ch !== '\t' && ch !== '\v' && ch !== '\f') {
        return false;
      }
      i++;
    }
    return true;
  }

  // Matches block comment: %{ ... %} with nesting support
  protected matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      // Look for nested %{ at the start of a line
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      // Look for %} at the start of a line (allowing leading whitespace, no trailing content)
      if (source[i] === '%' && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
          // Verify no trailing content after %} (whitespace includes space, tab, \v, \f)
          let trailingPos = i + 2;
          let hasTrailingContent = false;
          while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
            const tch = source[trailingPos];
            if (tch !== ' ' && tch !== '\t' && tch !== '\v' && tch !== '\f') {
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

  // Matches MATLAB string: '...' with '' as escape
  private matchMatlabString(source: string, pos: number): ExcludedRegion {
    // Check if this is a transpose operator (after identifier, number, ], }, or .)
    if (pos > 0) {
      const prevChar = source[pos - 1];
      // Handle surrogate pairs: low surrogate preceded by high surrogate
      const isSurrogatePairLetter =
        pos >= 2 &&
        prevChar >= '\uDC00' &&
        prevChar <= '\uDFFF' &&
        (() => {
          const cp = source.codePointAt(pos - 2);
          return cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp));
        })();
      if (/[a-zA-Z0-9_)\]}.'"]/.test(prevChar) || /\p{L}/u.test(prevChar) || isSurrogatePairLetter) {
        // After a digit, check if ' starts a string (e.g., [1'text'])
        // If immediately followed by a letter, it's more likely a string
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
          // This is transpose, not string - return minimal region
          return { start: pos, end: pos + 1 };
        }
      }
    }

    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === "'") {
        // Check for escaped quote ''
        if (i + 1 < source.length && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches double-quoted string: "..." with "" as escape (MATLAB does not support backslash escapes)
  private matchDoubleQuotedString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        // Check for escaped quote ""
        if (i + 1 < source.length && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Unterminated string ends at newline
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
