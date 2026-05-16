// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// Per-logical-line metadata, computed once per parse and consulted by the
// logical-line-scanning validators (isCommandSyntaxArgument / isUsedAsRhsIdentifier)
// so they answer in O(1) instead of walking the source backward each call.
interface LogicalLineInfo {
  // Start offset of the leading identifier of the line when the line is a
  // pure whitespace-separated identifier sequence whose first identifier is a
  // non-keyword (i.e. command-syntax like `disp end`). -1 when the line is not
  // command-syntax (leading token is a keyword, a number, an operator, etc.).
  commandLeadIdentStart: number;
  // Offset just past the last identifier of the leading pure-identifier run.
  // A keyword whose start offset is within [commandLeadIdentStart, pureRunEnd)
  // and is not the leading identifier is a command-syntax string argument.
  pureRunEnd: number;
  // Offset of the first plain assignment `=` in the line (not `==`/`<=`/`>=`/
  // `~=`/`!=`), or -1 when the line has no assignment. A block keyword appearing
  // after this offset sits on the RHS of an assignment.
  firstAssignEqOffset: number;
}

export class MatlabBlockParser extends BaseBlockParser {
  // Positions of classdef section keywords (properties / methods / events / enumeration /
  // arguments) that appear at line-start but were rejected at tokenize because of a
  // form like `properties = 5` or `properties + 1`. The user likely wrote a stray `end`
  // intending to close a section block, so matchBlocks skips one `end` per recorded
  // position to avoid pairing it with an outer `classdef`/`function` block. Populated
  // by tokenize, consumed by matchBlocks. Not thread-safe, but parse() is synchronous.
  private phantomSectionPositions: number[] = [];
  // Per-position bracket depth cache: bracketDepthAtPos[p] is the number of balanced
  // (), [], or {} pairs that strictly enclose position p. Populated by tokenize() before
  // any isValidBlockOpen / isValidBlockClose call so that isInsideParensOrBrackets can
  // answer in O(1) instead of walking the source backward each time. null when no parse
  // is in progress (defensive: callers fall back to the slow source walk in that case).
  // Avoids the O(N^2) regression when many `end` tokens appear without enclosing brackets.
  private bracketDepthAtPos: Int32Array | null = null;
  // Per-position logical-line start cache: statementStartAtPos[p] is the start
  // offset of the logical line (statement) containing position p. A logical line
  // begins at file start, just after a `;`/`,` separator outside excluded regions,
  // or at a physical line start that is not the continuation of a `...`/`\` line.
  // Populated by tokenize() before any isValidBlockOpen / isValidBlockClose call so
  // the logical-line-scanning validators run in O(1). null when no parse is in
  // progress (defensive: callers fall back to a bounded slow walk in that case).
  private statementStartAtPos: Int32Array | null = null;
  // Per-logical-line metadata cache keyed by logical-line start offset. Computed
  // lazily (each line scanned once) and consulted by isCommandSyntaxArgument and
  // isUsedAsRhsIdentifier. null when no parse is in progress.
  private logicalLineInfoCache: Map<number, LogicalLineInfo> | null = null;
  // Validates block close: 'end' inside parentheses or brackets is array indexing, not block close
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject end preceded by `@` (function handle prefix: `@end`, `h = @end;`).
    // The `@` puts the keyword in identifier-reference context, so it is not a block close.
    if (this.isPrecededByAtSign(source, position)) {
      return false;
    }
    // Reject end preceded by dot (struct field access like s.end or s . end)
    if (this.isPrecededByDot(source, position, excludedRegions)) {
      return false;
    }
    // Reject end used as variable name (end = 5)
    if (this.isFollowedBySimpleAssignment(source, position + keyword.length)) {
      return false;
    }
    // Reject end followed by a single `.` (possibly preceded by whitespace) that is NOT
    // part of `..` (line continuation marker prefix). `end.field` and `end .field` are
    // both struct field-access syntax, not block close — the `end` is an identifier in
    // expression context. Whitespace skip handles `end .x = 1` and `end\t.x = 1` forms.
    let afterPos = position + keyword.length;
    while (afterPos < source.length && (source[afterPos] === ' ' || source[afterPos] === '\t')) {
      afterPos++;
    }
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
    if (keyword === 'end' && this.isCommandSyntaxArgument(source, position, excludedRegions)) {
      return false;
    }
    // Check all close keywords (end, endfunction, endif, etc.) for parenthesis/bracket context
    return !this.isInsideParensOrBrackets(source, position, excludedRegions);
  }

  // Returns true when the keyword at `position` is the argument of a command-syntax
  // invocation, e.g. `disp end` (sugar for `disp('end')`). A logical line is
  // command-syntax when it is a pure whitespace-separated identifier sequence
  // (crossing `...`/`\` line continuations) whose leading identifier is a
  // non-keyword. This handles:
  //   * Single-arg forms: `disp end`
  //   * Multi-arg forms: `clear all end` (the leading `clear` is the command, `all`
  //     and `end` are string arguments)
  //   * Line continuation forms: `disp ...\n end` and `disp \\\n end`
  // The leading identifier itself is the command, not an argument, so a keyword that
  // IS the leading identifier is excluded. The per-logical-line metadata is cached by
  // tokenize(), so this answers in O(1) rather than walking the source backward.
  private isCommandSyntaxArgument(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    // Require at least one space/tab between the previous token and the keyword (so
    // `xend` is not detected — though adjacency is already handled by the word boundary).
    if (position <= 0 || (source[position - 1] !== ' ' && source[position - 1] !== '\t')) return false;
    const info = this.getLogicalLineInfo(source, position, excludedRegions ?? []);
    if (info === null || info.commandLeadIdentStart < 0) {
      return false;
    }
    // The keyword must sit inside the leading pure-identifier run, after the
    // command (leading) identifier.
    return position > info.commandLeadIdentStart && position < info.pureRunEnd;
  }

  // MATLAB-specific block keywords (open + close + middle), used to filter
  // command-syntax detection. `do` is intentionally excluded — it is an Octave
  // keyword, not a MATLAB one, so MATLAB code may use `do` as an identifier.
  private static readonly MATLAB_BLOCK_KEYWORDS = new Set([
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
    'catch'
  ]);

  // Returns the set of recognised block keywords for this language. Subclasses
  // (Octave) override to add language-specific keywords like `do`, `until`,
  // `endfunction`, `unwind_protect`, etc.
  protected getAllBlockKeywords(): Set<string> {
    return MatlabBlockParser.MATLAB_BLOCK_KEYWORDS;
  }

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
    // `!` is logical-NOT (Octave) / a unary operator; `!end` puts `end` in operand context.
    if ('+*/^<>&|~:\\!'.includes(ch)) return true;
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
      if ('+*/^<>&|~:\\!'.includes(prev)) return true;
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
      // collectLogicalLineBefore returns text starting at a logical-line boundary,
      // so the for-header check anchors at `^`.
      const beforeText = this.collectLogicalLineBefore(source, i, excludedRegions);
      if (/^\s*(?:par)?for[\s(]/.test(beforeText)) return true;
    }

    // Case 2: end is followed by `:` (LHS of range, e.g. `for i = end:5`)
    let j = position + 3; // length of 'end'
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j < source.length && source[j] === ':' && j + 1 < source.length && source[j + 1] !== '=') {
      const beforeEnd = this.collectLogicalLineBefore(source, position, excludedRegions);
      // Require an `=` (assignment in for-header) before `end` on the same line, with for at start
      if (/^\s*(?:par)?for[\s(].*=\s*$/.test(beforeEnd)) return true;
    }

    return false;
  }

  // Collects the logical-line content preceding `position`, from the start of the
  // current logical line (the statementStartAtPos cache already follows `...`/`\`
  // continuations across physical line breaks and splits on `;`/`,`). Newlines are
  // collapsed to single spaces so anchored regexes still match. The returned text
  // starts exactly at a logical-line boundary, so callers anchor with `^` instead
  // of `(?:^|[;,])`.
  private collectLogicalLineBefore(source: string, position: number, _excludedRegions?: ExcludedRegion[]): string {
    let lineStart = 0;
    if (this.statementStartAtPos !== null) {
      const clamped = position < 0 ? 0 : position >= this.statementStartAtPos.length ? this.statementStartAtPos.length - 1 : position;
      lineStart = this.statementStartAtPos[clamped];
    } else {
      // Defensive fallback when no parse is in progress: current physical line only.
      lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
    }
    return source.slice(lineStart, position).replace(/[\r\n]/g, ' ');
  }

  // Classdef section keywords that can also be used as function calls
  private static readonly CLASSDEF_SECTION_KEYWORDS = new Set(['properties', 'methods', 'events', 'enumeration', 'arguments']);

  // Returns true when `position` lies at the start of its line (only whitespace before).
  // Used by phantom section detection to identify cases where a stray `end` is likely.
  private isAtLineStartForSectionKeyword(source: string, position: number): boolean {
    const lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
    return !/\S/.test(source.slice(lineStart, position));
  }

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
        // Phantom: if this section keyword is at line-start, the user may have written
        // a stray `end` for it. Record the position so matchBlocks can absorb the
        // stray close. Inside parens/brackets is checked next; we don't want to record
        // phantoms there because no `end` would be expected.
        if (this.isAtLineStartForSectionKeyword(source, position) && !this.isInsideParensOrBrackets(source, position, excludedRegions)) {
          this.phantomSectionPositions.push(position);
        }
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
            // Phantom: line-start section keyword with operator/punctuation after.
            // The user likely wrote a stray `end` for this section. Record it.
            this.phantomSectionPositions.push(position);
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
      // Reject block opener immediately preceded by a binary expression operator
      // (`x == for;`, `~for;`, `x === if;`, etc.). Block openers are only valid at
      // statement start, never as operands in an expression. Treating them as block_open
      // in operand context destroys outer block pairing.
      if (this.isPrecededByBinaryOperator(source, position, excludedRegions)) {
        return false;
      }
      // Reject block opener immediately followed by a binary expression operator or a
      // compound assignment (`for + 1;`, `while * 2`, `for += 1`, `if -= 1`). Such forms
      // use the reserved word as an operand or an assignment target, not a block opener;
      // treating them as block_open destroys outer block pairing. Symmetric to the
      // preceding-operator check above.
      if (this.isFollowedByBinaryOperator(source, position + keyword.length, keyword)) {
        return false;
      }
    }
    // Reject block opener used as a command-syntax argument (`clear if`, `clear for`,
    // `disp while`, etc.). The leading identifier is a command and the keyword is a
    // string argument, not a real block opener. Treating such keywords as block_open
    // destroys outer block pairing.
    if (this.isCommandSyntaxArgument(source, position, excludedRegions)) {
      return false;
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
  // `x=1; do<NL>` should NOT treat `do` as an RHS identifier — the logical-line cache
  // splits on `;`/`,`, so the assignment offset belongs to a different line in that case.
  // The cache also follows `...` line continuations so `r = ...\n  for;` is detected.
  private isUsedAsRhsIdentifier(source: string, position: number, keyword: string, excludedRegions?: ExcludedRegion[]): boolean {
    const info = this.getLogicalLineInfo(source, position, excludedRegions ?? []);
    if (info === null || info.firstAssignEqOffset < 0 || info.firstAssignEqOffset >= position) {
      return false;
    }
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
  // used as variable names (e.g., `case = 5`, `else = 1`), appear inside parens/brackets/
  // braces (e.g., `foo(case)` where `case` is a name argument), or are used as
  // function calls (e.g., `y = case(value)`) or command-syntax arguments (`clear case`).
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Reset phantom positions for this parse — they accumulate via isValidBlockOpen
    // side effects below.
    this.phantomSectionPositions = [];
    // Pre-compute bracket depth at each position so isInsideParensOrBrackets is O(1)
    // per query. Must run before super.tokenize() because that calls isValidBlockOpen /
    // isValidBlockClose for every keyword match, which in turn call isInsideParensOrBrackets.
    this.bracketDepthAtPos = this.computeBracketDepthAtPos(source, excludedRegions);
    // Pre-compute logical-line starts and reset the per-line metadata cache so the
    // logical-line-scanning validators run in O(1) instead of O(line length) per call.
    // Must also run before super.tokenize() for the same reason as the bracket cache.
    this.statementStartAtPos = this.computeStatementStarts(source, excludedRegions);
    this.logicalLineInfoCache = new Map<number, LogicalLineInfo>();
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
        // Reject block_middle keywords used as function calls in expression context
        // (`y = case(value)`, `z = otherwise(x)`). Treating these as intermediates
        // would corrupt switch-case structure.
        if (this.isKeywordUsedAsFunctionCall(source, token.startOffset, token.value)) {
          return false;
        }
        // Reject block_middle keywords used as command-syntax arguments (`clear case`,
        // `disp otherwise`). The leading identifier is a command and the keyword is a
        // string argument, not a real intermediate keyword.
        if (this.isCommandSyntaxArgument(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject block_middle keywords used as standalone RHS identifiers (`y = case;`,
        // `y = else;`). Such usages are operand context — the keyword cannot be a real
        // intermediate.
        if (this.isUsedAsRhsIdentifier(source, token.startOffset, token.value, excludedRegions)) {
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
    // Snapshot phantom section positions and process them in order. Each phantom
    // represents a section keyword that was rejected at tokenize but where the user
    // probably wrote a stray `end` to close it. We skip one `end` per phantom — but
    // only when doing so doesn't leave a real opener unmatched (defensive: prefer
    // pairing real openers with real closes).
    const phantomPositions = [...this.phantomSectionPositions];
    let phantomCursor = 0;
    // Pre-compute remaining block_close count from each token index forward.
    const remainingCloses: number[] = new Array(tokens.length + 1);
    remainingCloses[tokens.length] = 0;
    for (let k = tokens.length - 1; k >= 0; k--) {
      remainingCloses[k] = remainingCloses[k + 1] + (tokens[k].type === 'block_close' ? 1 : 0);
    }

    for (let idx = 0; idx < tokens.length; idx++) {
      const token = tokens[idx];
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
                // Drop the token: an `arguments` block outside of any function/methods/
                // classdef context is almost certainly a function call (`arguments(obj)`)
                // rather than a real section block. Pushing pendingSkipDepth here would
                // consume a legitimate `end` from an enclosing block (e.g. a `function`
                // wrapping a `arguments(obj)` call), destroying outer block pairing.
                break;
              }
            } else {
              const hasClassdef = stack.some((b) => b.token.value.toLowerCase() === 'classdef');
              if (!hasClassdef) {
                // Drop the token: section keywords like `properties(obj)` / `methods(obj)`
                // outside of a classdef are function calls, not section blocks. Pushing
                // pendingSkipDepth here would consume a legitimate `end` from an enclosing
                // block (e.g. a `function` body containing `properties(obj)`), destroying
                // outer block pairing.
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
          // Phantom section keyword skip: when `properties = 5` (or `properties + 1`)
          // was rejected at tokenize, the user likely wrote a stray `end`. If there's
          // a phantom position between the most recent block_open's offset and this
          // close's offset, AND there are enough remaining closes to still close every
          // open block on the stack, skip this close as the phantom's matching `end`.
          if (phantomCursor < phantomPositions.length && stack.length > 0) {
            const topOffset = stack[stack.length - 1].token.startOffset;
            const phantomOffset = phantomPositions[phantomCursor];
            // remainingCloses[idx] includes the current close; we need
            // remainingCloses[idx + 1] >= stack.length to still close every opener.
            if (phantomOffset > topOffset && phantomOffset < token.startOffset && remainingCloses[idx + 1] >= stack.length) {
              phantomCursor++;
              break;
            }
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

  // Checks if position is inside parentheses, square brackets, or curly braces.
  // Uses the bracketDepthAtPos cache (populated by tokenize()) for O(1) lookup. The
  // cache only counts BALANCED bracket pairs, matching the original semantics where
  // unmatched openers do not flag the position as "inside".
  protected isInsideParensOrBrackets(_source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    if (this.bracketDepthAtPos !== null && position >= 0 && position < this.bracketDepthAtPos.length) {
      return this.bracketDepthAtPos[position] > 0;
    }
    return false;
  }

  // Pre-computes bracket depth at every position in source. depth[p] = number of
  // balanced (), [], or {} pairs that strictly enclose position p (i.e. start < p < end).
  // Brackets inside excluded regions (comments / strings) are ignored. Unbalanced
  // openers (no matching close) do NOT contribute, matching the original
  // hasMatchingCloseAhead-gated semantics. Single forward pass: O(source.length).
  private computeBracketDepthAtPos(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
    const len = source.length;
    // Events list: each balanced pair contributes +1 at start+1 and -1 at end.
    const events: Array<{ pos: number; delta: number }> = [];
    const parenStack: number[] = [];
    const bracketStack: number[] = [];
    const braceStack: number[] = [];
    let i = 0;
    while (i < len) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '(') parenStack.push(i);
      else if (ch === ')') {
        const start = parenStack.pop();
        if (start !== undefined) {
          events.push({ pos: start + 1, delta: 1 });
          events.push({ pos: i, delta: -1 });
        }
      } else if (ch === '[') bracketStack.push(i);
      else if (ch === ']') {
        const start = bracketStack.pop();
        if (start !== undefined) {
          events.push({ pos: start + 1, delta: 1 });
          events.push({ pos: i, delta: -1 });
        }
      } else if (ch === '{') braceStack.push(i);
      else if (ch === '}') {
        const start = braceStack.pop();
        if (start !== undefined) {
          events.push({ pos: start + 1, delta: 1 });
          events.push({ pos: i, delta: -1 });
        }
      }
      i++;
    }
    // Sort events by position, then accumulate prefix sum into a per-position depth array.
    events.sort((a, b) => a.pos - b.pos);
    const depthAtPos = new Int32Array(len + 1);
    let depth = 0;
    let eventIdx = 0;
    for (let p = 0; p <= len; p++) {
      while (eventIdx < events.length && events[eventIdx].pos === p) {
        depth += events[eventIdx].delta;
        eventIdx++;
      }
      depthAtPos[p] = depth;
    }
    return depthAtPos;
  }

  // Pre-computes the logical-line start offset for every position in source.
  // statementStartAtPos[p] = start offset of the logical line containing p.
  // A logical line begins at file start, just after a `;`/`,` outside excluded
  // regions, or at a physical line start that is not the continuation of a
  // `...`/`\` line. `;`/`,` and newlines inside excluded regions (strings,
  // comments, line-continuation regions) never start a new line. Single forward
  // pass: O(source.length). Lets the logical-line-scanning validators answer in
  // O(1) instead of walking the source backward each call.
  private computeStatementStarts(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
    const len = source.length;
    const result = new Int32Array(len + 1);
    let lineStart = 0;
    let i = 0;
    while (i < len) {
      // Skip excluded regions wholesale: separators/newlines inside strings,
      // comments, and `...`/`\` continuation regions do not split a logical line.
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          for (let p = i; p < region.end && p < len; p++) {
            result[p] = lineStart;
          }
          i = region.end;
          continue;
        }
      }
      result[i] = lineStart;
      const ch = source[i];
      if (ch === ';' || ch === ',') {
        // Statement separator: the next logical line starts right after it.
        lineStart = i + 1;
        i++;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        // Physical line break. Walk past a CRLF pair as a single line ending.
        let nextStart = i + 1;
        if (ch === '\r' && i + 1 < len && source[i + 1] === '\n') {
          nextStart = i + 2;
        }
        // The line break ends the logical line unless the physical line ended
        // with a `...`/`\` continuation (an excluded region ending at this break).
        if (!this.isLineContinuationBeforeNewline(source, i, excludedRegions)) {
          lineStart = nextStart;
        }
        for (let p = i; p < nextStart; p++) {
          result[p] = result[i];
        }
        i = nextStart;
        continue;
      }
      i++;
    }
    result[len] = lineStart;
    return result;
  }

  // Returns true when the physical line break at position `nlPos` is immediately
  // preceded by a `...` (or Octave `\`) line continuation. matchSingleLineComment
  // ends a `...` excluded region at the newline start, so a region whose `end`
  // equals the newline position and whose first char is `.`/`\` is a continuation.
  private isLineContinuationBeforeNewline(source: string, nlPos: number, excludedRegions: ExcludedRegion[]): boolean {
    if (nlPos <= 0) return false;
    const region = this.findExcludedRegionAt(nlPos - 1, excludedRegions);
    return region !== null && region.end === nlPos && (source[region.start] === '.' || source[region.start] === '\\');
  }

  // Returns the logical-line metadata for the line containing `position`,
  // computing and memoizing it on first access. Each logical line is scanned at
  // most once, so total work across a parse is O(source.length).
  private getLogicalLineInfo(source: string, position: number, excludedRegions: ExcludedRegion[]): LogicalLineInfo | null {
    if (this.statementStartAtPos === null || this.logicalLineInfoCache === null) {
      return null;
    }
    const clamped = position < 0 ? 0 : position >= this.statementStartAtPos.length ? this.statementStartAtPos.length - 1 : position;
    const lineStart = this.statementStartAtPos[clamped];
    const cached = this.logicalLineInfoCache.get(lineStart);
    if (cached) {
      return cached;
    }
    const info = this.computeLogicalLineInfo(source, lineStart, excludedRegions);
    this.logicalLineInfoCache.set(lineStart, info);
    return info;
  }

  // Scans a single logical line (starting at `lineStart`) and derives its
  // command-syntax and assignment metadata. Excluded regions are skipped; `...`/`\`
  // continuation regions inside the leading identifier run are treated as
  // whitespace so `disp ...<NL> end` is recognised as a continued command line.
  private computeLogicalLineInfo(source: string, lineStart: number, excludedRegions: ExcludedRegion[]): LogicalLineInfo {
    const statementStarts = this.statementStartAtPos;
    const len = source.length;
    // Walk the leading whitespace-separated identifier run.
    let commandLeadIdentStart = -1;
    let pureRunEnd = lineStart;
    let firstIdentIsKeyword = false;
    let identCount = 0;
    let i = lineStart;
    while (i < len && statementStarts !== null && statementStarts[i] === lineStart) {
      const ch = source[i];
      // Skip whitespace, a leading BOM, and the newline of a `...`/`\` continuation.
      // The loop guard guarantees any newline reached here belongs to this logical
      // line (a continuation break), so it is treated as whitespace within the run.
      if (ch === ' ' || ch === '\t' || ch === '\u{FEFF}' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      // Treat `...`/`\` continuation regions as whitespace within the run.
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.end;
        continue;
      }
      if (!/[a-zA-Z0-9_]/.test(ch)) {
        break;
      }
      // An identifier run starting with a digit is a number, not an identifier.
      if (identCount === 0 && !/[a-zA-Z_]/.test(ch)) {
        break;
      }
      const identStart = i;
      while (i < len && /[a-zA-Z0-9_]/.test(source[i])) {
        i++;
      }
      if (identCount === 0) {
        commandLeadIdentStart = identStart;
        firstIdentIsKeyword = this.getAllBlockKeywords().has(source.slice(identStart, i).toLowerCase());
      }
      identCount++;
      pureRunEnd = i;
    }
    // A line is command-syntax only when its leading token is a non-keyword
    // identifier and at least one further token follows it in the run.
    if (firstIdentIsKeyword || identCount < 2) {
      commandLeadIdentStart = -1;
    }
    // Find the first plain assignment `=` in the line.
    let firstAssignEqOffset = -1;
    let j = lineStart;
    while (j < len && statementStarts !== null && statementStarts[j] === lineStart) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === '=') {
        const prev = j > lineStart ? source[j - 1] : '';
        const next = j + 1 < len ? source[j + 1] : '';
        if (next !== '=' && prev !== '=' && prev !== '<' && prev !== '>' && prev !== '!' && prev !== '~') {
          firstAssignEqOffset = j;
          break;
        }
      }
      j++;
    }
    return { commandLeadIdentStart, pureRunEnd, firstAssignEqOffset };
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
  // Strictly speaking MATLAB requires `@name` with no whitespace, but to avoid
  // destroying outer block pairing in code like `h = @ for x;`, we also treat
  // `@` with intervening same-line whitespace (space/tab) as a function handle
  // marker. This follows the best-effort parsing principle: invalid syntax should
  // not corrupt surrounding valid blocks.
  protected isPrecededByAtSign(source: string, position: number): boolean {
    if (position <= 0) return false;
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    return i >= 0 && source[i] === '@';
  }

  // Checks if keyword is followed by = (but not ==) indicating variable assignment
  protected isFollowedBySimpleAssignment(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    return i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=');
  }

  // Returns true when a block-opener keyword (whose end is `afterPos`) is immediately
  // followed (after whitespace) by an operator that makes the keyword an operand or an
  // assignment target rather than a real block opener:
  //   * A compound assignment (`+= -= *= /= ^= \= .^= .*=` ...) — the keyword is the
  //     assignment target (`for += 1` ≡ `for = for + 1`). Rejected for every keyword.
  //   * A strictly-binary operator (`* / ^ \ < > & |` or `:`) and the comparison
  //     operators (`== ~= != <= >=`) — these can never start an expression, so the
  //     keyword is the left operand (`while * 2`). Rejected for every keyword.
  //   * For `for`/`parfor` only, also the prefix-capable operators `+ - ~ !` — a
  //     for-header must be `for var = ...`, so it can never start with any operator
  //     (`for + 1`). `if`/`while`/`switch` take an expression that legitimately can
  //     start with a unary `+ - ~ !` (e.g. `if ~isempty(x)`), so those are NOT rejected.
  // A single `=` (plain assignment, e.g. `for = 5`) is intentionally NOT handled here —
  // isFollowedBySimpleAssignment covers that variable-name case.
  private isFollowedByBinaryOperator(source: string, afterPos: number, keyword: string): boolean {
    let i = afterPos;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    if (i >= source.length) {
      return false;
    }
    const ch = source[i];
    const next = i + 1 < source.length ? source[i + 1] : '';
    // Compound assignment: operator char (optionally `.`-prefixed) directly followed by
    // `=`, but not the comparison operators `==`/`~=`/`<=`/`>=`/`!=`.
    if (next === '=') {
      if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\' || ch === '&' || ch === '|') {
        return true;
      }
    }
    // `.`-prefixed compound assignment (`.^=`, `.*=`, `./=`, `.\=`).
    if (ch === '.' && i + 2 < source.length && source[i + 2] === '=') {
      const op = next;
      if (op === '*' || op === '/' || op === '^' || op === '\\') {
        return true;
      }
    }
    // Strictly-binary operators that can never begin an expression.
    if ('*/^\\<>&|:'.includes(ch)) {
      return true;
    }
    // Comparison operators built on `=`/`~`/`!`: `==`, `~=`, `!=`.
    if (ch === '=' && next === '=') {
      return true;
    }
    if ((ch === '~' || ch === '!') && next === '=') {
      return true;
    }
    // for/parfor headers must be `for var = ...` and can never start with any operator,
    // including the prefix-capable `+ - ~ !`.
    if ((keyword === 'for' || keyword === 'parfor') && (ch === '+' || ch === '-' || ch === '~' || ch === '!')) {
      return true;
    }
    return false;
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
