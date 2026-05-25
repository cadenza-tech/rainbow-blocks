// MATLAB block parser: function, if, for, while, switch, try with end termination

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import type { LogicalLineInfo } from './matlabCacheHelpers';
import { computeBracketDepthAtPos, computeLogicalLineInfo, computeStatementStarts } from './matlabCacheHelpers';
import { isBlockCommentStart, matchBlockComment, matchDoubleQuotedString, matchMatlabString } from './matlabExcluded';
import {
  isAtLineStartForSectionKeyword,
  isAtLineStartWithWhitespace,
  isAtStatementStart,
  isEndFollowedByBinaryOperator,
  isFollowedByBinaryOperator,
  isFollowedByCompoundAssignment,
  isFollowedBySimpleAssignment,
  isHorizontalWhitespace,
  isKeywordUsedAsFunctionCall,
  isPrecededByAtSign,
  isPrecededByBinaryOperator,
  isPrecededByDot
} from './matlabHelpers';

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
    // Reject end used as variable name (`end = 5`) or compound-assignment target
    // (`end += 1`, `end *= 2`). Skip whitespace AND `...` line continuations so
    // `end ...\n= 5` is detected as the same assignment form as the same-line `end = 5`,
    // symmetric with the section-keyword side (isValidBlockOpen).
    const assignFrom = this.skipWhitespaceAndContinuations(source, position + keyword.length, excludedRegions);
    if (this.isFollowedBySimpleAssignment(source, assignFrom)) {
      return false;
    }
    // Comparison operators (`== ~= >= <=`) are NOT compound assignments and are
    // deliberately left alone (a real block close may be followed by a stray comparison).
    if (this.isFollowedByCompoundAssignment(source, assignFrom)) {
      return false;
    }
    // Reject end followed by an arithmetic/logical binary operator (`end + 1`, `end - 1`,
    // `end * 2`, etc.). Such forms put `end` in left-operand context — invalid MATLAB
    // outside array indexing. The same-line and `end ...\n + 1` continuation forms are
    // handled symmetrically because `assignFrom` already skips `...` continuations.
    // Comparison operators (`==`, `~=`, etc.) are deliberately left alone (above).
    if (keyword === 'end' && isEndFollowedByBinaryOperator(source, assignFrom)) {
      return false;
    }
    // Reject end followed by a single `.` (possibly preceded by whitespace or `...` line
    // continuations) that is NOT part of `..` (line continuation marker prefix or junk).
    // `end.field`, `end .field`, and `end ...\n .field` are all struct field-access syntax,
    // not block close — the `end` is an identifier in expression context. The continuation
    // skip handles the multi-line form symmetrically with the same-line form.
    if (source[assignFrom] === '.' && source[assignFrom + 1] !== '.') {
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
    // Reject end used as the value of a switch `case`/`otherwise` arm (`case end`,
    // `otherwise end`). `end` here is an operand in expression context (the case value),
    // not a block close. Treating it as block_close destroys the outer switch/end pair.
    if (keyword === 'end' && this.isPrecededByCaseOrOtherwiseOnLogicalLine(source, position, excludedRegions)) {
      return false;
    }
    // Reject end appearing on the same logical line as a leading `if`/`elseif`/`while`/
    // `switch` keyword (`if end != 0`, `while end == n`, `switch end`). The `end` here is
    // part of the header expression, not a block close. Without this guard the header
    // `end` is wrongly matched as the closer of the same if/while/switch (consuming the
    // real block close), destroying the outer block pairing.
    if (keyword === 'end' && this.isInsideHeaderExpressionOnSameLine(source, position, excludedRegions)) {
      return false;
    }
    // Reject end appearing in expression context after a value-like token on the same
    // logical line (`x = a end`, `x = [1 2] end`, `x = 10. end`, `x = foo() end`,
    // `--end`). The `end` here is the right operand of an implicit/missing operator —
    // invalid MATLAB outside indexing, but treating it as a block close consumes a real
    // inner end and destroys outer pairing. The previous statement-start kept in
    // statementStartAtPos lets us cheaply detect that something else exists on the
    // logical line before this `end`.
    if (keyword === 'end' && this.isPrecededByValueTokenOnSameLine(source, position, excludedRegions)) {
      return false;
    }
    // Check all close keywords (end, endfunction, endif, etc.) for parenthesis/bracket context
    return !this.isInsideParensOrBrackets(source, position, excludedRegions);
  }

  // Returns true when the `end` at `position` is the (sole) value of a `case` /
  // `otherwise` arm on the current logical line. Walks backward through whitespace
  // and `...`/`\` line-continuation regions to find the immediately preceding
  // identifier, then checks whether that identifier is `case` or `otherwise` and
  // sits at the very start of the logical line (allowing only leading whitespace).
  // The leading-whitespace check ensures forms like `x = case` (no real case at line
  // start) are NOT rejected — though those are caught by the operand-context check above.
  private isPrecededByCaseOrOtherwiseOnLogicalLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.statementStartAtPos === null) {
      return false;
    }
    const clamped = position < 0 ? 0 : position >= this.statementStartAtPos.length ? this.statementStartAtPos.length - 1 : position;
    const lineStart = this.statementStartAtPos[clamped];
    // Walk backward from position - 1 to find the immediately preceding identifier.
    let i = position - 1;
    while (i >= lineStart) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
        i = region.start - 1;
        continue;
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < lineStart) {
      return false;
    }
    // Scan backward over identifier characters to find the start of the preceding word.
    if (!/[a-zA-Z0-9_]/.test(source[i])) {
      return false;
    }
    const identEnd = i + 1;
    let identStart = i;
    while (identStart > lineStart && /[a-zA-Z0-9_]/.test(source[identStart - 1])) {
      identStart--;
    }
    const word = source.slice(identStart, identEnd);
    if (word !== 'case' && word !== 'otherwise') {
      return false;
    }
    // Ensure that `case`/`otherwise` itself is at the start of the logical line
    // (only whitespace and continuation regions before it). Without this guard,
    // `disp case end` would also match, but command-syntax `end` is already filtered
    // by isCommandSyntaxArgument, so this is a defensive consistency check.
    let j = identStart - 1;
    while (j >= lineStart) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\')) {
        j = region.start - 1;
        continue;
      }
      const ch = source[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        j--;
        continue;
      }
      return false;
    }
    return true;
  }

  // Returns true when the `end` at `position` is on the same logical line as another
  // non-whitespace token that came before it AND that previous token ends with a
  // value-like character (identifier letter/digit/_, closing delimiter `)`/`]`/`}`,
  // or numeric decimal point `.`). Such forms (`x = a end`, `x = [1 2] end`,
  // `x = 10. end`, `x = foo() end`) place `end` in expression context — invalid MATLAB
  // outside array indexing, but treating them as block close consumes a real inner end
  // and destroys outer pairing. The check is deliberately conservative:
  //   * `if`/`elseif`/`while`/`switch` header expressions are handled by the separate
  //     isInsideHeaderExpressionOnSameLine check, which runs before this one.
  //   * Lines whose leading token is a block opener (`function`, `for`, `parfor`,
  //     `try`, `spmd`, `classdef`, `methods`, `properties`, `events`, `enumeration`,
  //     `arguments`) are NOT matched: the `end` there is the legitimate block close
  //     (e.g. `function f ... \nend`). The leading-keyword exemption is what
  //     distinguishes a continued opener header from a value-context `end`.
  private isPrecededByValueTokenOnSameLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.statementStartAtPos === null) {
      return false;
    }
    const clamped = position < 0 ? 0 : position >= this.statementStartAtPos.length ? this.statementStartAtPos.length - 1 : position;
    const lineStart = this.statementStartAtPos[clamped];
    // Walk backward from position - 1 through whitespace and line-continuation regions
    // to find the immediately preceding non-whitespace character on the logical line.
    let i = position - 1;
    while (i >= lineStart) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.start - 1;
        continue;
      }
      if (isHorizontalWhitespace(source[i]) || source[i] === '\n' || source[i] === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < lineStart) {
      return false;
    }
    const prev = source[i];
    // A value-like token tail: identifier char, closing delimiter, or decimal point.
    // The isPrecededByBinaryOperator check (run earlier) already catches the binary
    // operator case, so this method handles only the value-token tail.
    if (!/[a-zA-Z0-9_)\]}.]/.test(prev)) {
      return false;
    }
    // Determine the leading identifier of the logical line. If it is a block opener
    // (function / for / parfor / try / spmd / classdef / section keyword), the `end`
    // is the legitimate block close even when the line spans a `...` continuation, so
    // do NOT reject. (`if`/`while`/`switch` headers were already rejected upstream.)
    let j = lineStart;
    while (j < position) {
      const region = this.findExcludedRegionAt(j, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        j = region.end;
        continue;
      }
      if (isHorizontalWhitespace(source[j]) || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    if (j < position && /[a-zA-Z_]/.test(source[j])) {
      const identStart = j;
      while (j < position && /[a-zA-Z0-9_]/.test(source[j])) j++;
      const leading = source.slice(identStart, j).toLowerCase();
      if (MatlabBlockParser.BLOCK_OPENERS_TAKING_LINE_HEADER.has(leading)) {
        return false;
      }
      // Middle keywords (else/elseif/case/otherwise/catch) introduce a new statement
      // within their enclosing block. When `end` appears on the same logical line as
      // a leading middle keyword (e.g. `else end`), it is the legitimate block close
      // for the enclosing block, not a value continuation.
      if (this.getMiddleKeywordsAsLineLeaders().has(leading)) {
        return false;
      }
    }
    return true;
  }

  // Middle keywords that may appear as the leading identifier of a logical line followed
  // by `end` on the same line (e.g. `else end`, `catch end`). Octave extends this set
  // via getMiddleKeywordsAsLineLeaders() to add `unwind_protect_cleanup`.
  protected static readonly MIDDLE_KEYWORDS_AS_LINE_LEADERS: ReadonlySet<string> = new Set(['else', 'elseif', 'case', 'otherwise', 'catch']);

  protected getMiddleKeywordsAsLineLeaders(): ReadonlySet<string> {
    return MatlabBlockParser.MIDDLE_KEYWORDS_AS_LINE_LEADERS;
  }

  // Block openers whose header may legitimately span a `...` line continuation and
  // therefore have the closing `end` on a later physical line of the SAME logical
  // line. `if`/`elseif`/`while`/`switch` are deliberately omitted: their `end`-in-
  // header is invalid (handled by isInsideHeaderExpressionOnSameLine).
  private static readonly BLOCK_OPENERS_TAKING_LINE_HEADER = new Set([
    'function',
    'for',
    'parfor',
    'try',
    'spmd',
    'classdef',
    'methods',
    'properties',
    'events',
    'enumeration',
    'arguments',
    // Octave-specific opener. Harmless on MATLAB (which does not use the keyword).
    'unwind_protect'
  ]);

  // Header keywords that take an expression on the same logical line. When `end`
  // appears later on the same logical line as one of these leading keywords, it is part
  // of the header expression rather than a block close. Lowercase comparison.
  private static readonly HEADER_EXPRESSION_KEYWORDS = new Set(['if', 'elseif', 'while', 'switch']);

  // Returns true when the `end` at `position` sits on the same logical line as a leading
  // `if`/`elseif`/`while`/`switch` keyword (possibly after horizontal whitespace and
  // `...`/`\` line continuations at line start). Such `end` is part of the header
  // expression (e.g. `if end != 0`, `switch end`), not the block close.
  // Generalises the earlier case/otherwise check: same shape (find the leading identifier
  // on the logical line, verify the keyword name), but the leading identifier must be one
  // of the header keywords above. Octave overrides HEADER_EXPRESSION_KEYWORDS via
  // getHeaderExpressionKeywords to add `until`.
  protected isInsideHeaderExpressionOnSameLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.statementStartAtPos === null) {
      return false;
    }
    const clamped = position < 0 ? 0 : position >= this.statementStartAtPos.length ? this.statementStartAtPos.length - 1 : position;
    const lineStart = this.statementStartAtPos[clamped];
    // Scan forward from lineStart through leading whitespace and `...`/`\` continuation
    // regions to reach the first significant token on the logical line.
    let i = lineStart;
    while (i < position) {
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.end;
        continue;
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f') {
        i++;
        continue;
      }
      break;
    }
    if (i >= position) {
      return false;
    }
    // The leading run must be an identifier; otherwise it's not a header keyword.
    if (!/[a-zA-Z_]/.test(source[i])) {
      return false;
    }
    const identStart = i;
    while (i < position && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    const leading = source.slice(identStart, i).toLowerCase();
    return this.getHeaderExpressionKeywords().has(leading);
  }

  // Returns the set of header keywords whose `end` operands must be rejected as block
  // closes. Overridable for Octave (adds `until` for the `do...until <expr>` form).
  protected getHeaderExpressionKeywords(): Set<string> {
    return MatlabBlockParser.HEADER_EXPRESSION_KEYWORDS;
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
    // Require at least one horizontal whitespace character (ASCII space/tab, VT/FF, or
    // Unicode horizontal whitespace such as NBSP / em space / ideographic space) between
    // the previous token and the keyword. `xend` adjacency is already handled by the word
    // boundary, but `disp\vif` etc. would otherwise be missed because the regex word
    // boundary still recognises `\v` as a non-word char.
    if (position <= 0 || !isHorizontalWhitespace(source[position - 1])) return false;
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

  // Returns true when `end` at position is preceded by an expression operator (operand context)
  private isPrecededByBinaryOperator(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    return isPrecededByBinaryOperator(source, position, excludedRegions);
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

  // Block-opener keywords that REQUIRE a non-empty header. `if`/`while`/`switch` require
  // a condition expression; `for`/`parfor` require a loop-variable assignment. `try`,
  // `spmd`, `function`, and `classdef` are deliberately omitted: `try` accepts an empty
  // header, `spmd` accepts `(n)` or nothing, and `function`/`classdef` have name-based
  // headers whose empty form is also handled elsewhere (function-name detection). The
  // section keywords are handled in their own branch above.
  private static readonly HEADER_REQUIRED_KEYWORDS = new Set(['if', 'while', 'switch', 'for', 'parfor']);

  // Returns true when `position` lies at the start of its line (only whitespace before)
  private isAtLineStartForSectionKeyword(source: string, position: number): boolean {
    return isAtLineStartForSectionKeyword(source, position);
  }

  // Advances past horizontal whitespace and `...` line continuations starting at `from`,
  // returning the offset of the first significant character. Horizontal whitespace covers
  // ASCII space/tab as well as `\v`, `\f`, and Unicode whitespace (NBSP, em space, etc.)
  // via `isHorizontalWhitespace`, mirroring the broader whitespace handling used elsewhere
  // in the parser. A `...` continuation is recorded as an excluded region whose `start` is
  // the first `.` and whose `end` is the line terminator; this skips the whole region plus
  // the trailing newline so that, e.g., `properties ...\n= 5` is seen as `properties = 5`.
  private skipWhitespaceAndContinuations(source: string, from: number, excludedRegions: ExcludedRegion[]): number {
    let i = from;
    while (i < source.length) {
      if (isHorizontalWhitespace(source[i])) {
        i++;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && region.start === i && source[region.start] === '.') {
        // Jump past the `...` continuation region and its trailing newline (CRLF, CR, or LF).
        i = region.end;
        if (i < source.length && source[i] === '\r') i++;
        if (i < source.length && source[i] === '\n') i++;
        continue;
      }
      break;
    }
    return i;
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
      // Reject `arguments(X)` where X is not an attribute keyword (Input/Output/Repeating).
      // A real `arguments` block can take `arguments`, `arguments (Input)`, `arguments (Output)`,
      // or `arguments (Repeating)` — anything else (e.g. `arguments(obj)`) is a function call.
      // Without this guard the `arguments` token is paired with an inner `end`, leaving the
      // outer function's `end` orphan and destroying outer block pairing.
      if (keyword === 'arguments' && this.isMatlabArgumentsFunctionCall(source, position, excludedRegions)) {
        return false;
      }
      // Check if keyword is used as a variable (followed by =, but not ==).
      // Skip whitespace AND `...` line continuations so `properties ...\n= 5` is
      // detected as the same assignment form as the same-line `properties = 5`.
      const afterPos = this.skipWhitespaceAndContinuations(source, position + keyword.length, excludedRegions);
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
          // and statement-empty markers ';', ',' (e.g., `properties;` is a valid empty section).
          // ':' is NOT allowed: MATLAB has no label syntax, so `properties:` is invalid usage.
          if (
            nextChar !== '\n' &&
            nextChar !== '\r' &&
            nextChar !== '(' &&
            nextChar !== '%' &&
            nextChar !== ';' &&
            nextChar !== ',' &&
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
    // Reject block opener keywords used as variable names (for = 10, if = 5). Skip
    // whitespace AND `...` line continuations so `for ...\n= 10` is detected as the same
    // assignment form as the same-line `for = 10`.
    if (!MatlabBlockParser.CLASSDEF_SECTION_KEYWORDS.has(keyword)) {
      const assignFrom = this.skipWhitespaceAndContinuations(source, position + keyword.length, excludedRegions);
      if (this.isFollowedBySimpleAssignment(source, assignFrom)) {
        return false;
      }
      // Reject empty-header block openers (`if;`, `for;`, `while,`, `if<NL>`, etc.). These
      // statements require an expression (`if`/`while`/`switch`) or a loop-variable
      // assignment (`for`/`parfor`) and cannot be valid with no header. `try` (and any
      // future opener that accepts an empty header) is exempt. Treating an empty-header
      // opener as block_open consumes the outer block's `end`, destroying outer pairing.
      if (MatlabBlockParser.HEADER_REQUIRED_KEYWORDS.has(keyword) && this.isFollowedByEmptyHeader(source, assignFrom)) {
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
      // preceding-operator check above. `assignFrom` is already past any `...` line
      // continuations, so `for ...\n  + 1;` is detected as the same operand form as the
      // same-line `for + 1;`.
      if (this.isFollowedByBinaryOperator(source, assignFrom, keyword)) {
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
  private isKeywordUsedAsFunctionCall(source: string, position: number, keyword: string): boolean {
    return isKeywordUsedAsFunctionCall(source, position, keyword);
  }

  // Attribute keywords that MATLAB's `arguments` block legitimately accepts inside its
  // optional parenthesised attribute list: `arguments (Input)` (the default), `arguments
  // (Output)`, `arguments (Repeating)`. Case-insensitive. Anything else inside the parens
  // (e.g. `arguments(obj)`) means the line is a function call, not a real arguments block.
  private static readonly ARGUMENTS_ATTRIBUTES_PATTERN = /^(?:input|output|repeating)(?:\s*,\s*(?:input|output|repeating))*$/i;

  // Returns true when `arguments` at `position` is followed by `(...)` where the inner
  // content is NOT a recognised MATLAB attribute keyword (Input/Output/Repeating, optionally
  // comma-separated). Such forms (`arguments(obj)`) are function calls — typically reflection
  // helpers — not arguments blocks. Bare `arguments`, `arguments (Input)` etc. are NOT
  // matched and remain valid block openers. Empty parens `arguments()` are treated as
  // function calls because MATLAB attribute lists are never empty in valid syntax.
  // `excludedRegions` lets the paren-matching loop skip embedded comments / strings so the
  // braces inside them do not throw off depth tracking. Octave keeps its own private
  // implementation that also detects the `arguments(obj);` semicolon-statement form and
  // supports `\<NL>` line continuations; the two names coexist via TypeScript private-name
  // semantics (each class has its own `isArgumentsFunctionCall`).
  private isMatlabArgumentsFunctionCall(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Step 1: must be followed by `(` (with optional ASCII whitespace).
    let j = position + 'arguments'.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length || source[j] !== '(') return false;
    // Step 2: find the matching `)`, tracking nesting and skipping excluded regions so
    // braces inside comments / strings don't desync depth.
    let depth = 1;
    let k = j + 1;
    while (k < source.length && depth > 0) {
      if (this.isInExcludedRegion(k, excludedRegions)) {
        const region = this.findExcludedRegionAt(k, excludedRegions);
        if (region) {
          k = region.end;
          continue;
        }
      }
      const ch = source[k];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      k++;
    }
    // Defensive: if unmatched, fall back to NOT treating as a function call so legacy
    // behaviour is preserved on malformed input.
    if (depth !== 0) return false;
    const inner = source.slice(j + 1, k).trim();
    // Step 3: empty parens — treat as function call (MATLAB attribute lists are never empty).
    if (inner.length === 0) return true;
    // Step 4: only the recognised attribute pattern remains a real block opener; otherwise
    // it's a function call.
    return !MatlabBlockParser.ARGUMENTS_ATTRIBUTES_PATTERN.test(inner);
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
        // Skip whitespace AND `...` line continuations so `case ...\n  = 5` is detected as
        // the same assignment form as the same-line `case = 5`, symmetric with the
        // block_open side (isValidBlockOpen) and the block_close side (isValidBlockClose).
        const middleAssignFrom = this.skipWhitespaceAndContinuations(source, token.startOffset + token.value.length, excludedRegions);
        if (this.isFollowedBySimpleAssignment(source, middleAssignFrom)) {
          return false;
        }
        if (this.isInsideParensOrBrackets(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject block_middle keywords immediately preceded by a binary expression
        // operator (`1 + case`, `2 * otherwise`). Such a keyword is an operand, not a
        // real intermediate; registering it would corrupt the switch/if structure.
        // Symmetric with the isValidBlockOpen operator check for block openers.
        if (this.isPrecededByBinaryOperator(source, token.startOffset, excludedRegions)) {
          return false;
        }
        // Reject block_middle keywords immediately preceded by `@` (function handle
        // prefix, e.g. `@case`). The `@` puts the keyword in identifier-reference
        // context, so it is not a real intermediate. Symmetric with isValidBlockOpen.
        if (this.isPrecededByAtSign(source, token.startOffset)) {
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
              // The non-arguments section keywords (properties/methods/events/enumeration)
              // are only valid section blocks when their CLOSEST enclosing block is the
              // classdef itself. When something like `function`/`methods`/`properties` sits
              // between the section keyword and the enclosing classdef, the keyword at
              // line-start is a function call (e.g. `properties(obj)` inside `function f`,
              // `methods(obj)` inside another `methods` section) rather than a real section.
              // Walking only the top of the stack — not the whole stack — prevents the
              // token from being paired as a section, which would otherwise consume an
              // inner `end` and orphan the outer classdef. Dropping the token (no
              // pendingSkipDepth) preserves outer block pairing.
              const closest = stack.length > 0 ? stack[stack.length - 1].token.value.toLowerCase() : '';
              if (closest !== 'classdef') {
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
              // `else` must be the last branch of an `if`: reject a duplicate
              // `else` and an `elseif` appearing after `else` — both are syntax
              // errors and must not be recorded as intermediates. `elseif` may
              // itself repeat any number of times, so only `else` is deduped.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawElse = intermediates.some((t) => t.value.toLowerCase() === 'else');
              if (sawElse) break;
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
              // Reject `case` after `otherwise` — switch semantics require `otherwise`
              // to be the last branch — and reject a duplicate `otherwise` (only one
              // is valid per switch). `case` may itself repeat, so only `otherwise`
              // is deduped.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawOtherwise = intermediates.some((t) => t.value.toLowerCase() === 'otherwise');
              if (sawOtherwise) break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
              // MATLAB allows at most one `catch` per `try` block. A duplicate is
              // a syntax error and must not be recorded as an intermediate.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawCatch = intermediates.some((t) => t.value.toLowerCase() === 'catch');
              if (sawCatch) break;
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

  // Checks if position is preceded by dot (struct field access; handles ... continuation)
  protected isPrecededByDot(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    return isPrecededByDot(source, position, excludedRegions);
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

  // Pre-computes bracket depth at every position in source (delegates to matlabCacheHelpers)
  private computeBracketDepthAtPos(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
    return computeBracketDepthAtPos(source, excludedRegions);
  }

  // Pre-computes the logical-line start offset for every position (delegates to matlabCacheHelpers)
  private computeStatementStarts(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
    return computeStatementStarts(source, excludedRegions);
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

  // Scans a single logical line and derives its command-syntax/assignment metadata
  private computeLogicalLineInfo(source: string, lineStart: number, excludedRegions: ExcludedRegion[]): LogicalLineInfo {
    return computeLogicalLineInfo(source, lineStart, excludedRegions, this.statementStartAtPos, this.getAllBlockKeywords());
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
  protected isPrecededByAtSign(source: string, position: number): boolean {
    return isPrecededByAtSign(source, position);
  }

  // Checks if keyword is followed by = (but not ==) indicating variable assignment
  protected isFollowedBySimpleAssignment(source: string, afterPos: number): boolean {
    return isFollowedBySimpleAssignment(source, afterPos);
  }

  // Returns true when the next significant character at `afterPos` is a statement
  // terminator that leaves the header empty: `;`, `,`, line break, end-of-source, or
  // the start of a single-line comment (`%`/`#`). Whitespace and `...`/`\` line
  // continuations have already been skipped by the caller (via skipWhitespaceAndContinuations).
  // A comment is treated as empty because the comment itself runs to the newline
  // without contributing any header expression; the newline that follows still
  // ends the logical line. Block comments (`%{`) at line start are NOT treated as
  // empty headers because their content can span multiple lines and may include the
  // header expression — they are extremely unusual after a block opener and are out of scope.
  private isFollowedByEmptyHeader(source: string, afterPos: number): boolean {
    if (afterPos >= source.length) {
      return true;
    }
    const ch = source[afterPos];
    if (ch === ';' || ch === ',' || ch === '\n' || ch === '\r') {
      return true;
    }
    if (ch === '%' || this.isCommentChar(ch)) {
      return true;
    }
    return false;
  }

  // Checks if a keyword end is followed by a compound assignment operator (`+=`, `.^=`, ...)
  protected isFollowedByCompoundAssignment(source: string, afterPos: number): boolean {
    return isFollowedByCompoundAssignment(source, afterPos);
  }

  // Returns true when a block-opener keyword is immediately followed by a binary operator or compound assignment
  private isFollowedByBinaryOperator(source: string, afterPos: number, keyword: string): boolean {
    return isFollowedByBinaryOperator(source, afterPos, keyword);
  }

  // Checks if a character is a comment prefix (overridden in Octave to include #)
  protected isCommentChar(_char: string): boolean {
    return false;
  }

  // Checks if position is at line start allowing leading whitespace
  protected isAtLineStartWithWhitespace(source: string, pos: number): boolean {
    return isAtLineStartWithWhitespace(source, pos);
  }

  // Checks if position is at the start of a statement (line start or after ; , )
  private isAtStatementStart(source: string, pos: number): boolean {
    return isAtStatementStart(source, pos);
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

  // Checks if %{ is alone on the line (no trailing non-whitespace content)
  private isBlockCommentStart(source: string, pos: number): boolean {
    return isBlockCommentStart(source, pos);
  }

  // Matches block comment: %{ ... %} with nesting support
  protected matchBlockComment(source: string, pos: number): ExcludedRegion {
    return matchBlockComment(source, pos);
  }

  // Matches MATLAB string: '...' with '' as escape
  private matchMatlabString(source: string, pos: number): ExcludedRegion {
    return matchMatlabString(source, pos);
  }

  // Matches double-quoted string: "..." with "" as escape
  private matchDoubleQuotedString(source: string, pos: number): ExcludedRegion {
    return matchDoubleQuotedString(source, pos);
  }
}
