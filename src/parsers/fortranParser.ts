// Fortran block parser: program, subroutine, function, if, do with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import {
  collapseContinuationLines,
  findInlineCommentIndex,
  findLineEnd,
  findLogicalLineEnd,
  hasEmptyParenthesizedCondition,
  isAfterDoubleColon,
  isAfterF77TypeDeclaration,
  isBlockWhereOrForall,
  isOnKeywordSplittingContinuationLine,
  isPrecedingContinuationKeyword,
  isTypeSpecifier,
  matchElseWhere,
  matchFortranString,
  matchPreprocessorDirective
} from './fortranHelpers';
import type { InterfaceSpan, TypeContainsSpan } from './fortranValidation';
import {
  computeInterfaceSpans,
  computeTypeContainsSpans,
  isAtLineStartAllowingWhitespace,
  isInsideParentheses,
  isMiddleInExpressionContext,
  isPrecededByOperator,
  isThenAfterParen,
  isValidFortranBlockClose,
  isValidProcedureOpen
} from './fortranValidation';
import { buildCaseInsensitiveKeywordPattern, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';

// Continuation-aware word separator: same-line whitespace, or a Fortran free-form
// line continuation (`block &\n[&] data`). Trailing `&` optionally followed by an
// inline comment, then one or more newlines (with possible comment-only/blank lines
// and optional leading `&`) before the next word. Used by the `block data` compound
// in COMPOUND_END_TYPES so `end block data` is recognized even when `block` and
// `data` are split across a continuation on the close side (e.g., `end &\n  block
// &\n  data`).
const COMPOUND_END_WORD_SEPARATOR =
  '(?:[ \\t]+|[ \\t]*&[ \\t]*(?:![^\\r\\n]*)?(?:\\r\\n|\\r|\\n)(?:[ \\t]*(?:![^\\r\\n]*|&[ \\t]*(?:![^\\r\\n]*)?)?(?:\\r\\n|\\r|\\n))*[ \\t]*&?[ \\t]*)';

// List of block types that have compound end keywords
// 'block data' must be listed BEFORE 'block' for longest-first alternation matching:
// `end block data` should match the multi-word form, not `end block`.
const COMPOUND_END_TYPES = [
  'program',
  'subroutine',
  'function',
  'module',
  'submodule',
  'if',
  'do',
  'select',
  // Fortran block data program unit (legacy). Both spaced and concatenated forms.
  // The separator between `block` and `data` allows same-line whitespace OR a
  // Fortran free-form continuation (`block &\n[&] data`), so the close form
  // `end &\n block &\n data` is recognized.
  `block${COMPOUND_END_WORD_SEPARATOR}data`,
  'blockdata',
  'block',
  'associate',
  'critical',
  'forall',
  'where',
  'interface',
  'type',
  'enum',
  'procedure',
  // Fortran 2018: change team (...) ... end team
  'team'
];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

// Pattern to match compound end keywords with continuation line: end &\n[&]keyword
// Also handles comment-only lines, blank lines, and bare continuation-only lines between end & and keyword
const CONTINUATION_COMPOUND_END_PATTERN = new RegExp(
  `\\bend[ \\t]*&[ \\t]*(?:![^\\r\\n]*)?(?:\\r\\n|\\r|\\n)(?:[ \\t]*(?:![^\\r\\n]*|&[ \\t]*(?:![^\\r\\n]*)?)?(?:\\r\\n|\\r|\\n))*[ \\t]*&?[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`,
  'gi'
);

// Normalize endType for compound end matching:
// `block data`, `block  data`, `block&\n data`, `blockdata` all map to canonical
// `block data`. Used to align the captured endType (matched text) with the
// opener token value, including the continuation form `block&\n[&]?data`.
function normalizeFortranEndType(rawType: string): string {
  const lower = rawType.toLowerCase();
  // Match `block` followed by `data` with any combination of whitespace, `&`
  // continuation tokens, inline comments (`! ...`), and line breaks between them.
  // This covers `block data`, `block  data`, `block&\n data`, `block &\n & data`,
  // `block &\n ! comment\n  data`, and the concatenated `blockdata`.
  if (lower === 'blockdata' || /^block[ \t&!\r\n][\s\S]*?data$/.test(lower)) {
    return 'block data';
  }
  return lower;
}

// Pattern to detect select-type/case/rank guards:
//   `type is (...)`, `class is (...)`, `class default` (select type)
//   `case default` (select case), `rank default` (select rank)
// These are intermediates (block_middle) of their respective select block, not standalone openers.
// `type` is in keywords.blockOpen but rejected by isValidTypeOpen when followed by `is(`,
// so we inject `type is` here. `class` is not in any keyword list, so its detection is
// unique to this pass. `case` and `rank` are blockMiddle keywords already tokenized as
// 4-char tokens; the bare-keyword loop is suppressed at these positions via
// suppressedDefaultKeywordPositions so the compound `case default` / `rank default`
// token is the only token emitted there.
//
// The separator between the two words allows either same-line whitespace `[ \t]+` or a
// Fortran free-form line continuation (`type &\n[&] is`), matching the same continuation
// shape used by CONTINUATION_COMPOUND_END_PATTERN: trailing `&` optionally followed by an
// inline comment, then one or more newlines (with possible comment-only/blank lines and
// optional leading `&`) before the next word.
const GUARD_WORD_SEPARATOR =
  '(?:[ \\t]+|[ \\t]*&[ \\t]*(?:![^\\r\\n]*)?(?:\\r\\n|\\r|\\n)(?:[ \\t]*(?:![^\\r\\n]*|&[ \\t]*(?:![^\\r\\n]*)?)?(?:\\r\\n|\\r|\\n))*[ \\t]*&?[ \\t]*)';
// `type is` / `class is` guards: also allow line continuation between `is` and the type-parenthesis
// (e.g., `type is &\n  (integer)`). Use GUARD_WORD_SEPARATOR between `is` and `(`, not just plain
// whitespace, so the continuation form is detected as a guard intermediate.
const SELECT_TYPE_GUARD_PATTERN = new RegExp(
  `\\b(type${GUARD_WORD_SEPARATOR}is${GUARD_WORD_SEPARATOR}\\(|class${GUARD_WORD_SEPARATOR}is${GUARD_WORD_SEPARATOR}\\(|class${GUARD_WORD_SEPARATOR}default\\b|case${GUARD_WORD_SEPARATOR}default\\b|rank${GUARD_WORD_SEPARATOR}default\\b)`,
  'gi'
);

// Matches a line beginning, exactly 5 leading chars (blank or digit), a digit 1-9 at
// column 6 (fixed-form continuation marker that is NOT excluded by `\b` boundary
// because it shares the [0-9] character class), then `then` and a non-word break.
// Group 1 captures the line-break + cols-1-5 prefix so the marker offset is
// `match.index + match[1].length`. `isFixedFormContinuationMarkerAt` is then called
// to fully validate the col-6 position (lineStart-relative checks).
const THEN_AFTER_COL6_DIGIT_PATTERN = /((?:^|\r\n|\r|\n)[ \t0-9]{5})[1-9]then(?![a-zA-Z0-9_])/gi;

export class FortranBlockParser extends BaseBlockParser {
  // Transient source captured during tokenize() for use in matchBlocks().
  // matchBlocks() needs source access to determine `select` opener subtypes
  // (`select type` vs `select case` vs `select rank`) but the base class API
  // does not pass source to matchBlocks. Reset on each tokenize call.
  private currentSource = '';

  // Interface block spans precomputed once per tokenize() pass so isValidProcedureOpen
  // can binary-search them instead of re-scanning the whole preceding source on every
  // `procedure` keyword (which was O(N^2) on generic interfaces). Reset on each tokenize.
  private currentInterfaceSpans: InterfaceSpan[] = [];

  // Derived-type contains regions precomputed once per tokenize() pass so
  // isValidProcedureOpen can binary-search them to suppress bare `procedure NAME`
  // tokens inside `type :: t ... contains ... end type`. Same reasoning as the
  // interface span cache: avoid re-scanning the prefix per `procedure` keyword.
  private currentTypeContainsSpans: TypeContainsSpan[] = [];

  // Cache of getSelectSubtype results keyed by the opener Token reference. Without
  // caching, matchBlocks called getSelectSubtype once per `case`/`rank` intermediate
  // inside a select block, and each call sliced the source from the opener to EOF and
  // ran collapseContinuationLines over the whole suffix — O(N) per call and O(N^2) for
  // the whole file. The cache makes it O(1) per call after the first. Reset on each
  // tokenize via the WeakMap reassignment in tokenize().
  private selectSubtypeCache: WeakMap<Token, 'type' | 'case' | 'rank' | null> = new WeakMap();

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'program',
      'subroutine',
      'function',
      'module',
      'submodule',
      'procedure',
      'if',
      'do',
      'select',
      // 'block data' (with space) and 'blockdata' (concatenated) must be listed BEFORE
      // 'block' for longest-first alternation: `block data NAME` opens a block-data
      // program unit, distinct from a `block` construct.
      'block data',
      'blockdata',
      'block',
      'associate',
      'critical',
      'forall',
      'where',
      'interface',
      'type',
      'enum',
      // Fortran 2018: change team (...) ... end team
      'team'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'elsewhere', 'case', 'rank', 'then', 'contains']
  };

  // Finds excluded regions: comments and strings

  // Validates block open keywords
  // Single-line 'if' (without 'then') is not a block opener
  // 'if' preceded by 'else' on the same line is part of 'else if', not a new block
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();

    if (lowerKeyword === 'type') {
      // type in expression context (e.g., `call type(x)`) is a function call, not a block
      if (isPrecededByOperator(source, position)) {
        return false;
      }
      return this.isValidTypeOpen(keyword, source, position, excludedRegions);
    }

    // 'team' is only a block opener as part of 'change team (...)' (Fortran 2018).
    // A bare 'team' is a regular identifier. The team-value must be parenthesized
    // (`change team (TEAM_VALUE)`); without parens it is not a valid construct.
    if (lowerKeyword === 'team') {
      const lineStart = findLineStart(source, position);
      const before = source.slice(lineStart, position);
      const sameLineMatch = /(?:^|[^a-zA-Z0-9_])change[ \t]+$/i.test(before);
      // Also accept 'change &\n  team' across continuation line(s)
      const continuationMatch = isPrecedingContinuationKeyword(source, position, 'change');
      if (!sameLineMatch && !continuationMatch) {
        return false;
      }
      // Require parenthesized team-value: `change team (...)`. Reject bare `change team`.
      // Also reject empty parens `change team ()` since the team-value requires an expression.
      const afterTeamStart = position + keyword.length;
      let afterTeam = source.slice(afterTeamStart, findLogicalLineEnd(source, afterTeamStart));
      afterTeam = collapseContinuationLines(afterTeam);
      if (!/^[ \t]*\(/.test(afterTeam)) {
        return false;
      }
      // Reject empty parens including the cross-line form `change team (\n)`. The
      // `hasEmptyParenthesizedCondition` helper treats newlines as whitespace inside the
      // parens (unlike the same-line `[ \t]*` regex), so it catches both `team ()` and
      // `team (\n)`.
      if (hasEmptyParenthesizedCondition(source, position + keyword.length)) {
        return false;
      }
    }

    // 'select' must be followed by 'type'/'case'/'rank' to be a block opener.
    // 'select type' and 'select rank' must additionally be followed by '(...)'.
    // Handles line continuation with &, including comment-only lines between.
    if (lowerKeyword === 'select') {
      const afterSelectStart = position + keyword.length;
      let afterSelect = source.slice(afterSelectStart, findLogicalLineEnd(source, afterSelectStart));
      afterSelect = collapseContinuationLines(afterSelect);
      const selectMatch = afterSelect.match(/^[ \t]+(type|case|rank)\b/i);
      if (!selectMatch) {
        return false;
      }
      const subKw = selectMatch[1].toLowerCase();
      // All select sub-forms (case/type/rank) require a parenthesized expression.
      const afterSubKw = afterSelect.slice(selectMatch[0].length);
      if ((subKw === 'type' || subKw === 'rank' || subKw === 'case') && !/^[ \t]*\(/.test(afterSubKw)) {
        return false;
      }
      // Reject empty parens including the cross-line form `select case (\n)` /
      // `select rank (\n)` / `select type (\n)`. We locate the opening paren in
      // `source` (after the `case|type|rank` keyword, walking past whitespace,
      // line breaks, comments, and `&` continuation tokens) and ask
      // `hasEmptyParenthesizedCondition` to inspect the parenthesized group.
      // The helper treats newlines as whitespace inside the parens (unlike the
      // same-line `[ \t]*` regex), so it catches both `select case ()` and
      // `select case (\n)`. `afterSubKw` (collapsed) cannot be used directly
      // because `findLogicalLineEnd` stops at the first line break that lacks a
      // trailing `&`, so the slice may exclude the closing `)` for the cross-line
      // form `select case (\n)` and leave the helper unable to terminate the group.
      const parenOpenSrcPos = this.findOpenParenAfterSelectSubkw(source, position + keyword.length, subKw);
      if (parenOpenSrcPos >= 0 && hasEmptyParenthesizedCondition(source, parenOpenSrcPos)) {
        return false;
      }
    }

    // 'module procedure/function/subroutine' inside submodule is not a new module block
    if (lowerKeyword === 'module') {
      const afterModuleStart = position + keyword.length;
      let afterModule = source.slice(afterModuleStart, findLogicalLineEnd(source, afterModuleStart));
      afterModule = collapseContinuationLines(afterModule);
      if (/^[ \t]+(procedure|function|subroutine)\b/i.test(afterModule)) {
        return false;
      }
    }

    // 'enum' must be followed by `, bind(c)` clause (Fortran 2003+).
    // Plain `enum NAME` without the bind(c) attribute is not a valid enum block.
    if (lowerKeyword === 'enum') {
      const afterEnumStart = position + keyword.length;
      let afterEnum = source.slice(afterEnumStart, findLogicalLineEnd(source, afterEnumStart));
      afterEnum = collapseContinuationLines(afterEnum);
      if (!/^[ \t]*,[ \t]*bind[ \t]*\(/i.test(afterEnum)) {
        return false;
      }
    }

    // 'submodule' must be followed by `(parent)` clause (Fortran 2008+).
    // Plain `submodule name` without parens is invalid. Also reject empty parens
    // `submodule () name` (or the cross-line `submodule (\n) name`) since the parent
    // clause requires at least one identifier.
    if (lowerKeyword === 'submodule') {
      const afterSubStart = position + keyword.length;
      let afterSub = source.slice(afterSubStart, findLogicalLineEnd(source, afterSubStart));
      afterSub = collapseContinuationLines(afterSub);
      if (!/^[ \t]*\(/.test(afterSub)) {
        return false;
      }
      // Reject empty parens including the cross-line form `submodule (\n) name`. The
      // `hasEmptyParenthesizedCondition` helper treats newlines as whitespace inside the
      // parens (unlike the same-line `[ \t]*` regex), so it catches both `submodule ()`
      // and `submodule (\n)`.
      if (hasEmptyParenthesizedCondition(source, position + keyword.length)) {
        return false;
      }
    }

    // 'associate' requires at least one association `(name => selector)`. Reject the
    // missing-parens form `associate name => expr` (no `(...)`) and the empty-paren form
    // `associate ()` (or the cross-line `associate (\n)`), consistent with the
    // missing-parens / empty-paren rejection for select case/where/forall/submodule/team.
    if (lowerKeyword === 'associate') {
      const afterAssociateStart = position + keyword.length;
      let afterAssociate = source.slice(afterAssociateStart, findLogicalLineEnd(source, afterAssociateStart));
      afterAssociate = collapseContinuationLines(afterAssociate);
      if (!/^[ \t]*\(/.test(afterAssociate)) {
        return false;
      }
      // `hasEmptyParenthesizedCondition` handles both same-line and cross-line empty parens
      // uniformly (newlines inside the parens are treated as whitespace).
      if (hasEmptyParenthesizedCondition(source, position + keyword.length)) {
        return false;
      }
    }

    if (lowerKeyword === 'procedure') {
      return isValidProcedureOpen(
        keyword,
        source,
        position,
        excludedRegions,
        (pos, regions) => this.isInExcludedRegion(pos, regions),
        this.currentInterfaceSpans,
        this.currentTypeContainsSpans
      );
    }

    // Single-line where/forall: has (condition) followed by statement on same line
    if (lowerKeyword === 'where' || lowerKeyword === 'forall') {
      // where/forall in expression context (e.g., `call where(x)`, `b = where(...)`) is a function call, not a block
      if (isPrecededByOperator(source, position)) {
        return false;
      }
      return isBlockWhereOrForall(source, position, keyword);
    }

    if (lowerKeyword === 'if') {
      return this.isValidIfOpen(keyword, source, position, excludedRegions);
    }

    // Skip keywords preceded by operator/expression context (e.g., 'x = do + 1').
    // For function/subroutine, the only valid operator predecessor is `)` from a type
    // specifier like `type(integer) function f()`. Other operators (`=`, `*`, `+`, etc.)
    // followed by function/subroutine indicate the keyword is being used as a variable.
    if (isPrecededByOperator(source, position)) {
      if (lowerKeyword === 'function' || lowerKeyword === 'subroutine') {
        // Find the operator character after whitespace
        let pi = position - 1;
        while (pi >= 0 && (source[pi] === ' ' || source[pi] === '\t')) pi--;
        if (pi < 0 || source[pi] !== ')') {
          return false;
        }
      } else {
        return false;
      }
    }

    // Reject Fortran 77 labeled DO loops (e.g., 'do 100 i = 1, 10') because they
    // close at a labeled 'continue' statement, not 'end do'. Matching them would
    // require tracking labels, so we conservatively drop the block to avoid
    // stealing an unrelated 'end'.
    // Also handle continuation: `do &\n  100 i = 1, 10` — collapse continuation
    // lines before testing for the label pattern so the labeled DO is still
    // rejected when the label is on a different physical line.
    if (lowerKeyword === 'do') {
      const afterDoStart = position + keyword.length;
      const afterDo = source.slice(afterDoStart, findLogicalLineEnd(source, afterDoStart));
      const collapsedAfterDo = collapseContinuationLines(afterDo);
      if (/^[ \t]+\d+\b/.test(collapsedAfterDo)) {
        return false;
      }
    }

    // Skip keywords used as variable names in assignments (e.g., 'do = 5', 'subroutine = 1')
    // Also handles array-element assignments (e.g., 'do(1) = 5', 'block(i, j) = val')
    const afterKwStart = position + keyword.length;
    const afterKw = source.slice(afterKwStart, findLogicalLineEnd(source, afterKwStart));
    const collapsed = collapseContinuationLines(afterKw);
    if (/^[ \t]*=[^=]/.test(collapsed) || /^[ \t]*=[ \t]*$/.test(collapsed)) {
      return false;
    }
    if (/^[ \t]*\(/.test(collapsed)) {
      let depth = 0;
      let pi = 0;
      while (pi < collapsed.length) {
        const ch = collapsed[pi];
        // Skip string literals so parentheses inside strings don't affect depth.
        // Fortran uses doubled quotes as escape: 'it''s', "he said ""hi""".
        if (ch === "'" || ch === '"') {
          pi++;
          while (pi < collapsed.length) {
            if (collapsed[pi] === ch) {
              if (pi + 1 < collapsed.length && collapsed[pi + 1] === ch) {
                pi += 2;
                continue;
              }
              pi++;
              break;
            }
            pi++;
          }
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            const rest = collapsed.slice(pi + 1);
            if (/^[ \t]*=[^=]/.test(rest) || /^[ \t]*=[ \t]*$/.test(rest)) {
              return false;
            }
            break;
          }
        }
        pi++;
      }
    }

    return true;
  }

  // Walks `source` from `afterSelectStart` (the position right after the `select`
  // keyword), past whitespace / line breaks / comments / `&` continuation tokens,
  // and the `subKw` (`case` / `type` / `rank`) word, then continues skipping
  // whitespace / line breaks / comments / `&` until it finds the opening
  // parenthesis of the select-condition. Returns the paren position in `source`,
  // or -1 if no `(` is found before non-skip content. Used to anchor
  // `hasEmptyParenthesizedCondition` on the original source so it can resolve the
  // closing `)` even when the parenthesized group spans multiple physical lines.
  private findOpenParenAfterSelectSubkw(source: string, afterSelectStart: number, subKw: string): number {
    let i = afterSelectStart;
    // Skip whitespace, line breaks, `&` continuation tokens, and comment-only
    // continuation lines up to the `subKw`.
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '&' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '!') {
        i = findLineEnd(source, i);
        continue;
      }
      break;
    }
    // Verify the next word matches `subKw` (case-insensitive). If not, bail out.
    const wordSlice = source.slice(i, i + subKw.length).toLowerCase();
    if (wordSlice !== subKw) {
      return -1;
    }
    i += subKw.length;
    // After the subKw, continue skipping whitespace / line breaks / comments / `&`
    // until the opening paren.
    while (i < source.length) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '&' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      if (ch === '!') {
        i = findLineEnd(source, i);
        continue;
      }
      if (ch === '(') {
        return i;
      }
      return -1;
    }
    return -1;
  }

  // Detects construct labels: 'name: if/do/block/...' where 'name' is any identifier,
  // here specifically when the identifier happens to match a keyword
  // (e.g., 'program: if ...', 'block: do i=1,10'). The keyword is followed by ':' (not '::').
  private isFortranConstructLabel(source: string, position: number, keyword: string): boolean {
    let i = position + keyword.length;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    if (source[i] !== ':') return false;
    // '::' is a type declaration separator, not a label colon
    if (source[i + 1] === ':') return false;
    return true;
  }

  // Detects construct names following 'end <type>' (e.g., 'end if program', 'end do block').
  // The name identifier is on the same line after 'end <type>' and may match a keyword.
  // Also handles the concatenated form `endif program` / `enddo loop` where the compound
  // end keyword is written without whitespace between `end` and the type. `[ \t]*` lets
  // the `end` and `<type>` be either separated by whitespace or concatenated.
  private isFortranEndConstructName(source: string, position: number): boolean {
    const lineStart = findLineStart(source, position);
    const before = source.slice(lineStart, position);
    // Match 'end<compound-type> ' (concatenated or whitespace-separated) at the tail of `before`
    const pattern = new RegExp(`\\bend[ \\t]*(${COMPOUND_END_TYPES.join('|')})[ \\t]+$`, 'i');
    return pattern.test(before);
  }

  // Detects construct names immediately following a procedure-introducing keyword
  // (subroutine/function/program/module/submodule/'module procedure'). Such names are
  // identifiers (not block keywords) even when they happen to match a Fortran block
  // keyword like `block`, `do`, `where`, `type`, `forall`, `interface`, `enum`,
  // `associate`, `critical`. Without this filter, e.g. `subroutine block(arg)` would
  // produce a spurious `block` opener that steals a later bare `end`.
  // Also handles continuation lines: `program &\n  block` is a program named `block`,
  // not a block-construct nested inside `program`. The current physical line before
  // `position` is extended backward across `&` continuation (skipping comment-only
  // and blank lines) so the introducer can be matched even when split.
  private isFortranOpenConstructName(source: string, position: number, keyword: string): boolean {
    const lowerKeyword = keyword.toLowerCase();
    // 'module function/subroutine/procedure' inside a (sub)module body opens a block.
    // Treat the keyword as a real block opener, not as a construct name following 'module '.
    const isModuleSubprogramKeyword = lowerKeyword === 'function' || lowerKeyword === 'subroutine' || lowerKeyword === 'procedure';
    // Match a procedure-introducer at the tail of the combined text (allow trailing whitespace).
    // Covers: program, module, submodule (with optional parent in parens), subroutine,
    // function, 'module procedure'. When the keyword being tested is itself a
    // module-subprogram keyword (function/subroutine/procedure), require the explicit
    // 'module procedure' compound so plain 'module ' does not suppress it.
    const moduleAlt = isModuleSubprogramKeyword ? 'module[ \\t]+procedure' : 'module(?:[ \\t]+procedure)?';
    // `interface NAME` (generic interface) and `type NAME` (Fortran 90 derived-type without ::)
    // also introduce a name. Suppress keyword detection when NAME spells a Fortran keyword.
    const pattern = new RegExp(
      `(?:^|[^a-zA-Z0-9_])(?:program|${moduleAlt}|submodule[ \\t]*\\([^)]*\\)|subroutine|function|recursive[ \\t]+(?:subroutine|function)|pure[ \\t]+(?:subroutine|function)|elemental[ \\t]+(?:subroutine|function)|interface|type)[ \\t]+$`,
      'i'
    );
    const before = this.getLogicalLineBefore(source, position);
    return pattern.test(before);
  }

  // Builds the logical line text from the start of the (possibly multi-line)
  // statement up to `position`. Walks backward across `&` continuation lines,
  // skipping comment-only and blank lines, stripping inline comments and the
  // trailing `&`. Returns a single string joined with a space so the introducer
  // regex matches uniformly across continuations.
  private getLogicalLineBefore(source: string, position: number): string {
    const lineStart = findLineStart(source, position);
    let combined = source.slice(lineStart, position);
    // Only walk back when the current line so far is empty or just `&`(+ws):
    // the typical shape of a continuation line carrying the name token.
    if (combined !== '' && !/^[ \t]*&?[ \t]*$/.test(combined)) {
      return combined;
    }
    let prevLineEnd = lineStart - 1;
    if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
      prevLineEnd--;
    }
    while (prevLineEnd >= 0) {
      const prevLineStart = findLineStart(source, prevLineEnd);
      let prevLine = source.slice(prevLineStart, prevLineEnd);
      if (prevLine.endsWith('\r')) {
        prevLine = prevLine.slice(0, -1);
      }
      // Strip inline comment
      const commentIdx = findInlineCommentIndex(prevLine);
      if (commentIdx >= 0) {
        prevLine = prevLine.slice(0, commentIdx);
      }
      const trimmed = prevLine.trimEnd();
      // Skip blank/comment-only lines: continue walking back
      if (trimmed.length === 0) {
        prevLineEnd = prevLineStart - 1;
        if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
          prevLineEnd--;
        }
        continue;
      }
      // The prior content line must end with `&` to be a continuation
      if (!trimmed.endsWith('&')) {
        return combined;
      }
      // Strip the trailing `&` and prepend (joined with a space so the regex matches)
      const contentBeforeAmp = trimmed.slice(0, -1).trimEnd();
      combined = `${contentBeforeAmp} ${combined.replace(/^[ \t]*&?[ \t]*/, '')}`;
      // Recheck whether we need to keep walking back: only if `contentBeforeAmp`
      // is itself a continuation (i.e., its own prior line ends with `&`). For the
      // procedure-introducer case the introducer keyword should already be present
      // in `contentBeforeAmp`, so a single hop is normally enough. Continue
      // walking back when the accumulated text still has no non-continuation
      // content at the head.
      prevLineEnd = prevLineStart - 1;
      if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
        prevLineEnd--;
      }
      // Stop walking once we have non-empty content at the head of `combined`
      if (contentBeforeAmp.trim() !== '') {
        break;
      }
    }
    return combined;
  }

  // Validates 'type': rejects select type guards, type specifiers, continuation patterns
  private isValidTypeOpen(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    const typeLineStart = findLineStart(source, position);
    const lineBeforeType = source.slice(typeLineStart, position).toLowerCase().trimEnd();
    if (lineBeforeType.endsWith('select')) {
      return false;
    }
    // Check continuation: select &\n  type
    if (isPrecedingContinuationKeyword(source, position, 'select')) {
      return false;
    }
    // 'type is(...)' or 'type is (...)' is a guard in select type, not a block
    // Also handles continuation: type &\n  is (integer)
    const afterKeywordStart = position + keyword.length;
    let afterKeyword = source.slice(afterKeywordStart, findLogicalLineEnd(source, afterKeywordStart));
    afterKeyword = collapseContinuationLines(afterKeyword);
    if (/^[ \t]+is[ \t]*\(/i.test(afterKeyword)) {
      return false;
    }
    // Reject assignment forms: 'type = expr' and 'type(N) = expr' (variable / array element)
    if (/^[ \t]*=[^=]/.test(afterKeyword) || /^[ \t]*=[ \t]*$/.test(afterKeyword)) {
      return false;
    }
    if (/^[ \t]*\(/.test(afterKeyword)) {
      let pdepth = 0;
      let pi = 0;
      while (pi < afterKeyword.length) {
        const ch = afterKeyword[pi];
        if (ch === "'" || ch === '"') {
          pi++;
          while (pi < afterKeyword.length) {
            if (afterKeyword[pi] === ch) {
              if (pi + 1 < afterKeyword.length && afterKeyword[pi + 1] === ch) {
                pi += 2;
                continue;
              }
              pi++;
              break;
            }
            pi++;
          }
          continue;
        }
        if (ch === '(') pdepth++;
        else if (ch === ')') {
          pdepth--;
          if (pdepth === 0) {
            const rest = afterKeyword.slice(pi + 1);
            if (/^[ \t]*=[^=]/.test(rest) || /^[ \t]*=[ \t]*$/.test(rest)) {
              return false;
            }
            break;
          }
        }
        pi++;
      }
    }
    // type(name) as type specifier: type(identifier) followed by :: or ,
    // Use collapsed text to handle continuation lines between type and (
    if (/^[ \t]*\(/i.test(afterKeyword)) {
      if (isTypeSpecifier(afterKeyword, 0)) {
        return false;
      }
      // Check for constructor call: type(name)(args) - not a block opener
      let depth = 0;
      let j = 0;
      while (j < afterKeyword.length) {
        if (afterKeyword[j] === '(') depth++;
        else if (afterKeyword[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth === 0 && j < afterKeyword.length) {
        let k = j + 1;
        while (k < afterKeyword.length && (afterKeyword[k] === ' ' || afterKeyword[k] === '\t')) k++;
        if (k < afterKeyword.length && afterKeyword[k] === '(') {
          return false;
        }
      }
    }
    return true;
  }

  // Validates 'if': checks for 'then' keyword handling & continuation lines
  private isValidIfOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject an empty parenthesized condition `if () then`. A block-if requires a
    // non-empty condition expression, consistent with the empty-paren rejection already
    // applied to select case/where/forall/submodule.
    if (hasEmptyParenthesizedCondition(source, position + keyword.length)) {
      return false;
    }
    let i = position + keyword.length;
    let parenDepth = 0;
    // Track whether a `(` has ever been seen at top-level after `if`. A valid block-if
    // must have a parenthesized condition (`if (cond) then`); a bare `if then` without
    // parens is invalid Fortran syntax and must be rejected.
    let sawOpenParen = false;
    while (i < source.length) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      // Track parenthesis depth
      if (source[i] === '(') {
        parenDepth++;
        sawOpenParen = true;
        i++;
        continue;
      }
      if (source[i] === ')') {
        parenDepth--;
        i++;
        continue;
      }

      // Check for 'then' keyword only at top-level (not inside parentheses)
      // 'then' must directly follow ')' (with only whitespace/comments between) to be a block if
      // If other content exists between ')' and 'then', it's a single-line if with 'then' as variable
      //
      // Word boundary preceding `then`: a fixed-form col-6 continuation marker (e.g.
      // digit `1` in `     1then`) is alphanumeric, so the naive `[a-zA-Z0-9_]` check
      // would reject the boundary and misread `1then` as a single identifier. The col-6
      // marker is metadata (column 6 of a continued physical line), not part of the
      // logical word, so treat its position as a valid word boundary too.
      const precedingIsWordChar = i > 0 && /[a-zA-Z0-9_]/.test(source[i - 1]);
      const precedingIsCol6Marker = i > 0 && this.isFixedFormContinuationMarkerAt(source, i - 1);
      if (
        parenDepth === 0 &&
        sawOpenParen &&
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !precedingIsWordChar || precedingIsCol6Marker) &&
        (i + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 4]))
      ) {
        // Verify no executable content between closing ')' and 'then'.
        // Also skip a fixed-form column-6 continuation marker (e.g. `+`, `1`) that lives in
        // column 6 of a physical line and whose columns 1-5 are blank or numeric. Without
        // this, `if (a)\n     +then` is misread as having executable `+` between `)` and
        // `then`, forcing a single-line if interpretation and dropping the block.
        let hasContentBeforeThen = false;
        for (let bi = i - 1; bi >= position + keyword.length; bi--) {
          const btRegion = this.findExcludedRegionAt(bi, excludedRegions);
          if (btRegion) {
            bi = btRegion.start;
            continue;
          }
          if (source[bi] === ' ' || source[bi] === '\t' || source[bi] === '&') continue;
          if (source[bi] === ')') break;
          if (source[bi] === '\n' || source[bi] === '\r') continue;
          // Skip fixed-form col-6 continuation marker: the char at column 6 of a physical
          // line where columns 1-5 are blank/numeric and the marker is non-blank, non-letter,
          // non-0, non-comment. This is the same rule as fixedFormContinuationContentStart.
          if (this.isFixedFormContinuationMarkerAt(source, bi)) continue;
          hasContentBeforeThen = true;
          break;
        }
        if (hasContentBeforeThen) {
          i += 4;
          continue;
        }
        // Verify 'then' ends the if-construct header (whitespace, comments, &, ; or line break follow).
        // `;` is allowed because Fortran 2008+ accepts statement separators after `then`
        // (e.g., `if (x > 0) then; y = 1; end if`).
        let k = i + 4;
        let isBlockThen = true;
        while (k < source.length) {
          const thenRegion = this.findExcludedRegionAt(k, excludedRegions);
          if (thenRegion) {
            k = thenRegion.end;
            continue;
          }
          if (source[k] === ' ' || source[k] === '\t') {
            k++;
            continue;
          }
          if (source[k] === '\n' || source[k] === '\r' || source[k] === '&' || source[k] === ';') break;
          isBlockThen = false;
          break;
        }
        if (isBlockThen) return true;
      }

      // Handle line continuation with &
      // Detect line break: \n or standalone \r (not followed by \n)
      const isLineBreak = source[i] === '\n' || (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n'));
      if (isLineBreak) {
        let j = i - 1;
        // Skip whitespace and excluded regions (comments between & and newline)
        while (j >= 0) {
          const backRegion = this.findExcludedRegionAt(j, excludedRegions);
          if (backRegion) {
            j = backRegion.start - 1;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r') {
            j--;
            continue;
          }
          break;
        }
        if (j >= 0 && source[j] === '&') {
          i++;
          // Skip comment-only continuation lines (& ! comment \n) and blank lines
          while (i < source.length) {
            // Skip whitespace at start of next line
            while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
              i++;
            }
            // Skip leading & on continuation line (Fortran free-form)
            if (i < source.length && source[i] === '&') {
              i++;
            }
            // If line starts with !, it's a comment-only continuation
            if (i < source.length && source[i] === '!') {
              const commentEnd = findLineEnd(source, i);
              i = commentEnd;
              // Skip past the line break
              if (i < source.length) {
                if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
                  i += 2;
                } else {
                  i++;
                }
              }
              continue;
            }
            // If line is blank (just whitespace then newline), skip it and continue
            if (i < source.length && (source[i] === '\n' || source[i] === '\r')) {
              if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
                i += 2;
              } else {
                i++;
              }
              continue;
            }
            break;
          }
          continue;
        }
        // Fixed-form column-6 continuation: a non-blank, non-letter marker in column 6 of the
        // next physical line continues this logical line (e.g. a block-if header split across
        // lines). Reached only when there is no trailing `&` (free-form) continuation.
        const fixedContPos = this.fixedFormContinuationContentStart(source, i);
        if (fixedContPos >= 0) {
          i = fixedContPos;
          continue;
        }
        break;
      }

      i++;
    }

    return false;
  }

  // Returns the offset just after column 6 of the next physical line if that line is a fixed-form
  // continuation of the current one, otherwise -1. A fixed-form continuation has columns 1-5
  // blank or a numeric label and column 6 holding a non-blank continuation marker. To avoid
  // misreading free-form indented code, the marker must not be a letter (a letter in column 6 is
  // ordinary indented code, not a continuation marker) and must not be '0' or a comment char.
  private fixedFormContinuationContentStart(source: string, lineBreakPos: number): number {
    let lineStart = lineBreakPos + 1;
    if (source[lineBreakPos] === '\r' && source[lineBreakPos + 1] === '\n') {
      lineStart = lineBreakPos + 2;
    }
    const col6 = lineStart + 5;
    if (col6 >= source.length) {
      return -1;
    }
    // A comment marker in column 1 (C/c/*/!) disqualifies the line.
    const col1 = source[lineStart];
    if (col1 === 'C' || col1 === 'c' || col1 === '*' || col1 === '!') {
      return -1;
    }
    // Columns 1-5 must be blank or a numeric label (spaces/digits only).
    for (let c = lineStart; c < col6; c++) {
      const ch = source[c];
      if (ch !== ' ' && !(ch >= '0' && ch <= '9')) {
        return -1;
      }
    }
    const marker = source[col6];
    if (marker === ' ' || marker === '\t' || marker === '\n' || marker === '\r' || marker === '0' || marker === '!') {
      return -1;
    }
    if ((marker >= 'a' && marker <= 'z') || (marker >= 'A' && marker <= 'Z')) {
      return -1;
    }
    return col6 + 1;
  }

  // Returns true if `pos` is column 6 of a physical line whose columns 1-5 are blank or numeric
  // and whose column 6 holds a valid fixed-form continuation marker (non-blank, non-letter,
  // non-0, non-comment). Mirrors the rule used by fixedFormContinuationContentStart so the
  // backward scan in `hasContentBeforeThen` can recognize and skip a col-6 marker that
  // continues an if-header onto the next physical line.
  private isFixedFormContinuationMarkerAt(source: string, pos: number): boolean {
    // Find the start of the physical line containing `pos`.
    let lineStart = pos;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }
    // Must be exactly column 6 (0-indexed 5).
    if (pos - lineStart !== 5) {
      return false;
    }
    // Columns 1-5 must be blank or a numeric label (spaces/digits only).
    for (let c = lineStart; c < pos; c++) {
      const ch = source[c];
      if (ch !== ' ' && !(ch >= '0' && ch <= '9')) {
        return false;
      }
    }
    // Comment marker in column 1 disqualifies the line.
    const col1 = source[lineStart];
    if (col1 === 'C' || col1 === 'c' || col1 === '*' || col1 === '!') {
      return false;
    }
    const marker = source[pos];
    if (marker === ' ' || marker === '\t' || marker === '\n' || marker === '\r' || marker === '0' || marker === '!') {
      return false;
    }
    if ((marker >= 'a' && marker <= 'z') || (marker >= 'A' && marker <= 'Z')) {
      return false;
    }
    return true;
  }

  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return isValidFortranBlockClose(keyword, source, position);
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // C preprocessor directive: # at line start (after optional whitespace).
    // Backslash-newline continuations extend the directive across physical lines, so
    // multi-line macro definitions are excluded as one region (matchSingleLineComment
    // would stop at the first newline and leak continuation-line keywords as code).
    if (char === '#' && isAtLineStartAllowingWhitespace(source, pos)) {
      return matchPreprocessorDirective(source, pos);
    }

    // Fixed-form comment: * in column 1, or C/c in column 1 followed by non-identifier char
    if (char === '*' && this.isAtLineStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }
    // Fixed-form: C/c in column 1 is a comment only when followed by non-letter
    // (space, tab, digit, or line end). When followed by a letter or underscore, treat as
    // free-form code (keyword or identifier) to support modern Fortran identifiers like
    // count, compute, current, etc. Digits after C indicate numbered comment markers (C1, C123).
    if ((char === 'C' || char === 'c') && this.isAtLineStart(source, pos)) {
      const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
      if (!/[a-zA-Z_]/.test(nextChar)) {
        return this.matchSingleLineComment(source, pos);
      }
    }

    // Single-line comment: ! (Fortran 90+)
    if (char === '!') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return matchFortranString(source, pos, "'");
    }

    // Double-quoted string
    if (char === '"') {
      return matchFortranString(source, pos, '"');
    }

    return null;
  }

  // Checks if a keyword is followed by = (assignment), excluding == and =>.
  // Also handles array-element assignments (e.g., `else(1) = 5` where the keyword name is
  // a variable) and `&` line continuations to a following `=`.
  private isFollowedByAssignmentOp(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length) {
      if (source[i] === ' ' || source[i] === '\t') {
        i++;
        continue;
      }
      // `&` line continuation: skip newline + leading whitespace and any continuation `&`
      if (source[i] === '&') {
        let j = i + 1;
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
        if (j < source.length && (source[j] === '\n' || source[j] === '\r')) {
          if (source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') j += 2;
          else j++;
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
          // Optional leading `&` on continuation line
          if (j < source.length && source[j] === '&') j++;
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
          i = j;
          continue;
        }
      }
      break;
    }
    if (i >= source.length) return false;
    // Array-element assignment: `(N) = expr`
    if (source[i] === '(') {
      let depth = 1;
      let pi = i + 1;
      while (pi < source.length && depth > 0) {
        const ch = source[pi];
        if (ch === "'" || ch === '"') {
          pi++;
          while (pi < source.length) {
            if (source[pi] === ch) {
              if (pi + 1 < source.length && source[pi + 1] === ch) {
                pi += 2;
                continue;
              }
              pi++;
              break;
            }
            pi++;
          }
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        pi++;
      }
      // After `(...)` look for `=` (with whitespace skip)
      while (pi < source.length && (source[pi] === ' ' || source[pi] === '\t')) pi++;
      if (pi < source.length && source[pi] === '=') {
        if (pi + 1 < source.length && (source[pi + 1] === '=' || source[pi + 1] === '>')) return false;
        return true;
      }
      return false;
    }
    if (source[i] !== '=') return false;
    // Not == (comparison) or => (pointer assignment)
    if (i + 1 < source.length && (source[i + 1] === '=' || source[i + 1] === '>')) return false;
    return true;
  }

  // Returns the select subtype (`type`, `case`, `rank`) for a `select` opener
  // token, or null if the token is not a select opener or the subtype cannot be
  // determined. Reads from currentSource captured during tokenize(). Results are
  // memoized in selectSubtypeCache keyed by the opener Token reference so repeated
  // calls during matchBlocks (once per `case`/`rank` intermediate) run in O(1)
  // instead of re-slicing and re-collapsing the source suffix on every call.
  private getSelectSubtype(token: Token): 'type' | 'case' | 'rank' | null {
    const cached = this.selectSubtypeCache.get(token);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.computeSelectSubtype(token);
    this.selectSubtypeCache.set(token, result);
    return result;
  }

  private computeSelectSubtype(token: Token): 'type' | 'case' | 'rank' | null {
    if (token.value.toLowerCase() !== 'select') {
      return null;
    }
    let after = this.currentSource.slice(token.endOffset);
    after = collapseContinuationLines(after);
    const subMatch = after.match(/^[ \t]+(type|case|rank)\b/i);
    if (!subMatch) {
      return null;
    }
    return subMatch[1].toLowerCase() as 'type' | 'case' | 'rank';
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Capture source for use in matchBlocks (needed by getSelectSubtype).
    this.currentSource = source;
    // Precompute interface spans once so isValidProcedureOpen (invoked per `procedure`
    // keyword while validating block opens below) can binary-search them.
    this.currentInterfaceSpans = computeInterfaceSpans(source, excludedRegions, (pos, regions) => this.isInExcludedRegion(pos, regions));
    // Same idea for derived-type contains regions: precompute once, binary-search per call.
    this.currentTypeContainsSpans = computeTypeContainsSpans(source, excludedRegions, (pos, regions) => this.isInExcludedRegion(pos, regions));
    // Reset the getSelectSubtype memoization cache: tokens carry over to matchBlocks
    // but the previous parse's cache entries are stale for the new source.
    this.selectSubtypeCache = new WeakMap();

    // Find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();
    // Track positions where the compound `end <type>` was rejected due to expression
    // context (e.g., `end if = 5`). The bare `end` token at these positions must also
    // be skipped, otherwise it would phantom-close the parent if-block.
    const rejectedCompoundEndPositions = new Set<number>();

    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      if (
        !this.isInExcludedRegion(pos, excludedRegions) &&
        !isAfterDoubleColon(source, pos, excludedRegions) &&
        !isAfterF77TypeDeclaration(source, pos, excludedRegions)
      ) {
        const fullMatch = match[0];
        // Reject when the compound `end <type>` (or concatenated form like `endif`) is
        // adjacent to a non-ASCII Unicode identifier continuation character (e.g.,
        // `endif日本語` reads `endif日本語` as one identifier; `end if日本語` reads
        // `if日本語` as one identifier). The bare-keyword tokenizer applies the same
        // check; this pass must mirror it to avoid emitting a phantom block_close
        // from inside an identifier. We also record the position in
        // rejectedCompoundEndPositions so the subsequent bare-`end` token at the same
        // location is suppressed (otherwise `end if日本語` would phantom-close the
        // parent if-block via the bare `end`).
        if (this.isAdjacentToUnicodeLetter(source, pos, fullMatch.length)) {
          rejectedCompoundEndPositions.add(pos);
        } else {
          // Normalize endType so `block data` / `block  data` / `blockdata` all map to
          // canonical `block data` for stack lookup.
          const endType = normalizeFortranEndType(match[1]);
          // Validate the compound `end <type>` is not followed by =, (...) =, //, or %
          // (i.e., not a variable / array element / string concat / component access).
          // Without this check, `end if = 5` would be tokenized as a phantom block_close.
          if (isValidFortranBlockClose(fullMatch, source, pos)) {
            compoundEndPositions.set(pos, {
              keyword: fullMatch, // Preserve original case
              length: fullMatch.length,
              endType
            });
          } else {
            rejectedCompoundEndPositions.add(pos);
          }
        }
      }
      match = COMPOUND_END_PATTERN.exec(source);
    }

    // Also detect compound end with continuation line: end &\n[&]keyword
    CONTINUATION_COMPOUND_END_PATTERN.lastIndex = 0;
    let contMatch = CONTINUATION_COMPOUND_END_PATTERN.exec(source);
    while (contMatch !== null) {
      const pos = contMatch.index;
      if (
        !this.isInExcludedRegion(pos, excludedRegions) &&
        !isAfterDoubleColon(source, pos, excludedRegions) &&
        !isAfterF77TypeDeclaration(source, pos, excludedRegions) &&
        !compoundEndPositions.has(pos)
      ) {
        const fullMatch = contMatch[0];
        // Reject when the continuation-form compound `end <type>` is adjacent to a
        // non-ASCII Unicode identifier continuation character. Mirrors the bare-keyword
        // tokenizer to avoid emitting a phantom block_close from inside an identifier.
        // Record in rejectedCompoundEndPositions so the bare `end` at the same position
        // is suppressed in the keyword loop (otherwise it would phantom-close the parent).
        if (this.isAdjacentToUnicodeLetter(source, pos, fullMatch.length)) {
          rejectedCompoundEndPositions.add(pos);
        } else {
          const endType = normalizeFortranEndType(contMatch[1]);
          const normalizedKeyword = `end ${contMatch[1]}`;
          // Validate the compound `end <type>` (continuation form) is not in expression context.
          // `isValidFortranBlockClose` uses `position + keyword.length` to scan post-keyword
          // context (assignment `=`, `//`, `%`, etc). We pass `fullMatch` so the length matches
          // the actual span in source (including the `&` and newline), otherwise the validator
          // would land inside the continuation gap and miss trailing `=` / `//` / `%`.
          if (isValidFortranBlockClose(fullMatch, source, pos)) {
            // Normalize keyword to "end <type>" for consistent matching in matchBlocks
            compoundEndPositions.set(pos, {
              keyword: normalizedKeyword,
              length: fullMatch.length,
              endType
            });
          } else {
            rejectedCompoundEndPositions.add(pos);
          }
        }
      }
      contMatch = CONTINUATION_COMPOUND_END_PATTERN.exec(source);
    }

    // Pre-scan: collect positions where `case` / `rank` is the start of a `case default`
    // / `rank default` compound. The bare `case` / `rank` token at these positions must
    // be suppressed in the keyword loop so the compound token (injected later via
    // SELECT_TYPE_GUARD_PATTERN) is the only token emitted. The separator allows either
    // same-line whitespace or a continuation line, matching SELECT_TYPE_GUARD_PATTERN.
    const suppressedDefaultKeywordPositions = new Set<number>();
    const defaultGuardPattern = new RegExp(`\\b(case|rank)${GUARD_WORD_SEPARATOR}default\\b`, 'gi');
    let defaultMatch = defaultGuardPattern.exec(source);
    while (defaultMatch !== null) {
      const pos = defaultMatch.index;
      if (!this.isInExcludedRegion(pos, excludedRegions) && !isAfterDoubleColon(source, pos, excludedRegions)) {
        suppressedDefaultKeywordPositions.add(pos);
      }
      defaultMatch = defaultGuardPattern.exec(source);
    }

    // Tokenize with case-insensitive matching
    const tokens: Token[] = [];
    const keywordPattern = buildCaseInsensitiveKeywordPattern(this.keywords);
    const newlinePositions = this.buildNewlinePositions(source);

    for (const keywordMatch of source.matchAll(keywordPattern)) {
      const startOffset = keywordMatch.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = keywordMatch[1];

      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      // Skip keywords on variable declaration lines (after ::)
      if (isAfterDoubleColon(source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip identifiers in Fortran 77-style type declarations (no `::` separator).
      // Example: `INTEGER END` declares a variable named END; the bare `end` here must not
      // be tokenized as a block_close. The check excludes `function`/`subroutine`, which
      // are valid block openers preceded by a type-spec prefix (`integer function foo()`).
      if (isAfterF77TypeDeclaration(source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip identifiers used as construct labels or construct names, independent of token type.
      // Examples: 'program: if (...)' - 'program' is the label; 'end if program' - 'program'
      // is the construct name; 'subroutine block(arg)' - 'block' is the procedure name.
      // None of these should be treated as keywords.
      if (
        this.isFortranConstructLabel(source, startOffset, keyword) ||
        this.isFortranEndConstructName(source, startOffset) ||
        this.isFortranOpenConstructName(source, startOffset, keyword)
      ) {
        continue;
      }

      // Skip keywords on a free-form continuation line that carries the tail of
      // a keyword split across the continuation (e.g. `end do` written as `en&`
      // then `d do`). The bare-regex tokenizer would otherwise emit a phantom
      // keyword token from the split fragment, stealing a later close and
      // orphaning the real opener. Suppression keeps the BlockPair set sound.
      if (isOnKeywordSplittingContinuationLine(source, startOffset)) {
        continue;
      }

      // Validate block open keywords (e.g., skip single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip block_open keywords inside parenthesized expressions (function arguments, conditions)
      if (type === 'block_open' && isInsideParentheses(source, startOffset)) {
        continue;
      }

      // Validate block close keywords (e.g., skip end used as variable)
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip bare `end` when the compound `end <type>` at this position was rejected
      // (e.g., `end if = 5` where the compound is in assignment context). Without this,
      // the bare `end` would phantom-close the parent block.
      if (type === 'block_close' && keyword.toLowerCase() === 'end' && rejectedCompoundEndPositions.has(startOffset)) {
        continue;
      }

      // Skip block_middle keywords inside parenthesized expressions (conditions, function arguments)
      if (type === 'block_middle' && isInsideParentheses(source, startOffset)) {
        continue;
      }

      // Skip block_middle keywords used as variable names in assignment LHS (e.g., else = 1)
      if (type === 'block_middle' && this.isFollowedByAssignmentOp(source, startOffset + keyword.length)) {
        continue;
      }

      // Skip block_middle keywords used in expression context (e.g., `print *, then`, `x = then + 1`)
      // Exception: ')' is a valid predecessor (e.g., `if (cond) then`, `select case (x)`)
      if (type === 'block_middle' && isMiddleInExpressionContext(source, startOffset)) {
        continue;
      }

      // `then` must follow `)` from an if-construct header. A bare `then` on its own
      // line (no preceding code on the physical line, no `)` reachable across continuations)
      // is a misplaced identifier, not a real intermediate.
      if (type === 'block_middle' && keyword.toLowerCase() === 'then' && !isThenAfterParen(source, startOffset)) {
        continue;
      }

      // Suppress bare `case` / `rank` when it is the start of a `case default` / `rank default`
      // compound. The full compound token is injected later via SELECT_TYPE_GUARD_PATTERN.
      const lowerKeyword = keyword.toLowerCase();
      if (type === 'block_middle' && (lowerKeyword === 'case' || lowerKeyword === 'rank') && suppressedDefaultKeywordPositions.has(startOffset)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset: startOffset + keyword.length,
        line,
        column
      });
    }

    // Merge 'block' + 'data' (with intervening whitespace, multiple spaces, or
    // line continuation `&\n`) into a single `block data` token. The keyword
    // regex literal `block data` only matches a single space; multi-space and
    // continuation forms must be merged at this stage so `end block data` can
    // pair correctly via normalizeFortranEndType.
    const blockDataMergedTokens: Token[] = [];
    for (const current of tokens) {
      if (current.value.toLowerCase() === 'block' && current.type === 'block_open') {
        const after = source.slice(current.endOffset);
        // Match: whitespace (possibly with line continuation `&\n[&]`) then `data`
        // followed by a non-identifier (whitespace, EOL, `(`, end of file, etc.)
        const blockDataPattern =
          /^([ \t]+|[ \t]*&[ \t]*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:[ \t]*(?:![^\r\n]*|&[ \t]*(?:![^\r\n]*)?)?(?:\r\n|\r|\n))*[ \t]*&?[ \t]*)data\b/i;
        const match = after.match(blockDataPattern);
        if (match) {
          const dataEnd = current.endOffset + match[0].length;
          blockDataMergedTokens.push({
            type: 'block_open',
            value: source.slice(current.startOffset, dataEnd),
            startOffset: current.startOffset,
            endOffset: dataEnd,
            line: current.line,
            column: current.column
          });
          continue;
        }
      }
      blockDataMergedTokens.push(current);
    }

    // Merge 'else' + 'if' into a single blockMiddle token (token-based merge)
    // Also merge 'else' + 'where' by scanning source text (where may be absent
    // from token list when it failed isValidBlockOpen without a condition)
    const mergedTokens: Token[] = [];
    for (let ti = 0; ti < blockDataMergedTokens.length; ti++) {
      const current = blockDataMergedTokens[ti];
      if (current.value.toLowerCase() === 'else' && current.type === 'block_middle') {
        // Try token-based merge for else + if or else + where (when where is tokenized)
        if (ti + 1 < blockDataMergedTokens.length) {
          const nextValue = blockDataMergedTokens[ti + 1].value.toLowerCase();
          const isMergeTarget =
            (nextValue === 'if' && blockDataMergedTokens[ti + 1].type === 'block_open') ||
            (nextValue === 'where' && blockDataMergedTokens[ti + 1].type === 'block_open');
          if (isMergeTarget) {
            const textBetween = source.slice(current.endOffset, blockDataMergedTokens[ti + 1].startOffset);
            // Same line: else if / else where
            const isSameLine = /^[ \t]+$/.test(textBetween);
            // Continuation line: else &[optional comment]\n[optional comment lines or blank lines][optional &] if/where
            // The inner alternation `(?:![^\r\n]*|&[ \t]*(?:![^\r\n]*)?)?` is optional (`?`)
            // so blank lines are accepted in the continuation gap, mirroring
            // CONTINUATION_COMPOUND_END_PATTERN.
            const isContinuation =
              /^[ \t]*&[ \t]*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:[ \t]*(?:![^\r\n]*|&[ \t]*(?:![^\r\n]*)?)?(?:\r\n|\r|\n))*[ \t]*&?[ \t]*$/.test(
                textBetween
              );
            if (isSameLine || isContinuation) {
              mergedTokens.push({
                type: 'block_middle',
                value: source.slice(current.startOffset, blockDataMergedTokens[ti + 1].endOffset),
                startOffset: current.startOffset,
                endOffset: blockDataMergedTokens[ti + 1].endOffset,
                line: current.line,
                column: current.column
              });
              ti++;
              continue;
            }
          }
        }
        // Source-based merge for else + where (when where was not tokenized)
        const elseWhereMatch = matchElseWhere(source, current.endOffset, excludedRegions);
        if (elseWhereMatch) {
          // Check that no other token starts between else and where
          const nextTokenStart = ti + 1 < blockDataMergedTokens.length ? blockDataMergedTokens[ti + 1].startOffset : source.length;
          if (elseWhereMatch.whereStart >= nextTokenStart) {
            // Another token exists between; don't merge
            mergedTokens.push(current);
            continue;
          }
          mergedTokens.push({
            type: 'block_middle',
            value: source.slice(current.startOffset, elseWhereMatch.end),
            startOffset: current.startOffset,
            endOffset: elseWhereMatch.end,
            line: current.line,
            column: current.column
          });
          continue;
        }
      }
      mergedTokens.push(current);
    }

    const { tokens: result, processedPositions: processedCompoundPositions } = mergeCompoundEndTokens(mergedTokens, compoundEndPositions);

    // Add concatenated compound end keywords (e.g., enddo, endif) that had no
    // matching 'end' token because \b word boundary doesn't match inside them
    for (const [pos, compound] of compoundEndPositions) {
      if (!processedCompoundPositions.has(pos)) {
        // Defense in depth: reject when the concatenated compound end (e.g., `endif日本語`)
        // is adjacent to a non-ASCII Unicode identifier continuation character. The earlier
        // COMPOUND_END_PATTERN loop already filters such positions before they enter
        // compoundEndPositions, but mirroring the SELECT_TYPE_GUARD_PATTERN guard here
        // keeps every injection path uniform and prevents future paths from emitting a
        // phantom block_close from inside an identifier.
        if (this.isAdjacentToUnicodeLetter(source, pos, compound.length)) {
          continue;
        }
        // Validate concatenated compound end keywords (reject variable assignments like enddo = 10)
        if (!isValidFortranBlockClose(compound.keyword, source, pos)) {
          continue;
        }
        // Skip when the concatenated compound end (e.g., `endif`, `endprogram`) is being
        // used as a construct label (`endif:`), as a construct name following `end <type> `
        // (e.g., `end if endif`), or as a procedure/program/module name following an
        // open-construct introducer (e.g., `program endprogram`, `function endif`).
        // Without these guards, an identifier that happens to spell a concatenated
        // compound-end would phantom-close the parent block.
        if (
          this.isFortranConstructLabel(source, pos, compound.keyword) ||
          this.isFortranEndConstructName(source, pos) ||
          this.isFortranOpenConstructName(source, pos, compound.keyword)
        ) {
          continue;
        }
        const { line, column } = this.getLineAndColumn(pos, newlinePositions);
        result.push({
          type: 'block_close',
          value: compound.keyword,
          startOffset: pos,
          endOffset: pos + compound.length,
          line,
          column
        });
      }
    }

    // Detect select-type guards: `type is (...)`, `class is (...)`, `class default`.
    // These are intermediates of a `select type` block. `type` and `class` are
    // detected via source scan because the regex-based keyword loop cannot easily
    // express the multi-token intermediate form, and `class is`/`class default`
    // would otherwise leave a phantom `class` token in non-select-type contexts
    // (e.g., `class(t) :: x` declaration).
    let guardInjectionAdded = false;
    SELECT_TYPE_GUARD_PATTERN.lastIndex = 0;
    let guardMatch = SELECT_TYPE_GUARD_PATTERN.exec(source);
    while (guardMatch !== null) {
      const pos = guardMatch.index;
      if (!this.isInExcludedRegion(pos, excludedRegions) && !isAfterDoubleColon(source, pos, excludedRegions) && !isInsideParentheses(source, pos)) {
        const fullMatch = guardMatch[1];
        // Trim trailing `(` from `type is (` / `class is (` so the token value is
        // the keyword phrase only. `class default` has no trailing paren.
        let phraseEnd = fullMatch.length;
        if (fullMatch.endsWith('(')) {
          phraseEnd--;
          while (phraseEnd > 0 && (fullMatch[phraseEnd - 1] === ' ' || fullMatch[phraseEnd - 1] === '\t')) {
            phraseEnd--;
          }
        }
        // Reject when the guard phrase is adjacent to a non-ASCII Unicode identifier
        // continuation character (e.g., `étype is (...)` reads `étype` as one identifier).
        // The bare-keyword tokenizer applies the same check; the guard injection must
        // mirror it to avoid emitting a phantom block_middle from inside an identifier.
        if (this.isAdjacentToUnicodeLetter(source, pos, phraseEnd)) {
          guardMatch = SELECT_TYPE_GUARD_PATTERN.exec(source);
          continue;
        }
        const phrase = source.slice(pos, pos + phraseEnd);
        const { line, column } = this.getLineAndColumn(pos, newlinePositions);
        result.push({
          type: 'block_middle',
          value: phrase,
          startOffset: pos,
          endOffset: pos + phraseEnd,
          line,
          column
        });
        guardInjectionAdded = true;
      }
      guardMatch = SELECT_TYPE_GUARD_PATTERN.exec(source);
    }

    // Detect `then` whose only preceding word character on its physical line is a
    // fixed-form column-6 digit continuation marker (e.g. `     1then`). The base regex
    // tokenizer uses `\b` word boundaries, so `1then` reads as a single identifier and
    // the bare-keyword loop never emits a `then` token. The col-6 digit marker is
    // metadata (continuation indicator) and not part of the logical word, so inject the
    // `then` token here for col-6 marker positions.
    let thenInjectionAdded = false;
    THEN_AFTER_COL6_DIGIT_PATTERN.lastIndex = 0;
    let thenMatch = THEN_AFTER_COL6_DIGIT_PATTERN.exec(source);
    while (thenMatch !== null) {
      const markerPos = thenMatch.index + thenMatch[1].length;
      const thenPos = markerPos + 1;
      if (
        !this.isInExcludedRegion(thenPos, excludedRegions) &&
        this.isFixedFormContinuationMarkerAt(source, markerPos) &&
        isThenAfterParen(source, thenPos)
      ) {
        const { line, column } = this.getLineAndColumn(thenPos, newlinePositions);
        result.push({
          type: 'block_middle',
          value: source.slice(thenPos, thenPos + 4),
          startOffset: thenPos,
          endOffset: thenPos + 4,
          line,
          column
        });
        thenInjectionAdded = true;
      }
      thenMatch = THEN_AFTER_COL6_DIGIT_PATTERN.exec(source);
    }

    // Re-sort by position after adding concatenated forms or guard injections
    if (compoundEndPositions.size > processedCompoundPositions.size || guardInjectionAdded || thenInjectionAdded) {
      result.sort((a, b) => a.startOffset - b.startOffset);
    }

    return result;
  }

  // Custom matching to handle compound end keywords
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];
    // Track select blocks that have had their first case skipped
    const firstCaseSkipped = new Set<OpenBlock>();

    // Maintain a running multiset of compound-end types pending later in the
    // token stream. Used to detect when pairing a compound `end <type>` with
    // a deeper opener would cross an intervening opener whose own compound
    // close is still pending later. Memory is O(distinct end types), avoiding
    // the per-position array snapshots that previously caused O(N^2) memory
    // (and OOM on large files with thousands of independent blocks).
    //
    // Initial state: count every compound-end token in the stream. When the
    // main loop visits a compound block_close, its count is decremented before
    // the cross-pair check so `remainingCompoundEndCounts` represents the
    // multiset of compound-end types at indices strictly greater than the
    // current `tokenIndex`.
    const remainingCompoundEndCounts = new Map<string, number>();
    for (const t of tokens) {
      if (t.type === 'block_close') {
        const m = t.value.toLowerCase().match(/^end[ \t]*([\s\S]+)/);
        if (m) {
          const ty = normalizeFortranEndType(m[1]);
          remainingCompoundEndCounts.set(ty, (remainingCompoundEndCounts.get(ty) ?? 0) + 1);
        }
      }
    }

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
      const token = tokens[tokenIndex];
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topBlock = stack[stack.length - 1];
            // Normalize the middle keyword text into a single-space canonical form so that
            // continuation forms like `type &\n  is` and same-line `type is` compare equal.
            // Drop `&` line-continuation markers and inline comments (`! ...` to end of line)
            // before collapsing whitespace.
            const middleValue = token.value
              .toLowerCase()
              .replace(/![^\r\n]*/g, ' ')
              .replace(/&/g, ' ')
              .replace(/[ \t\r\n]+/g, ' ')
              .trim();
            const openerValue = topBlock.token.value.toLowerCase();
            // For `select` openers, peek at the source to determine the subtype
            // (`select type` vs `select case` vs `select rank`). This lets us
            // restrict guards (`type is`, `class is`, `class default`) to `select type`
            // and case/rank intermediates to their respective select variants.
            const selectSubtype = openerValue === 'select' ? this.getSelectSubtype(topBlock.token) : null;
            // `case default` / `rank default` are case/rank intermediates of select case / select rank.
            const isCaseRankDefault = middleValue === 'case default' || middleValue === 'rank default';
            // Skip the first case/rank after select (it's the opening guard: select case/rank (x))
            if ((middleValue === 'case' || middleValue === 'rank') && openerValue === 'select' && !firstCaseSkipped.has(topBlock)) {
              firstCaseSkipped.add(topBlock);
              break;
            }
            // Restrict intermediates to correct parent block types
            if (middleValue === 'then' && openerValue !== 'if') {
              break;
            }
            if ((middleValue === 'case' || middleValue === 'rank' || isCaseRankDefault) && openerValue !== 'select') {
              break;
            }
            // `case` / `case default` valid only in `select case`; reject in `select type`/`select rank`.
            if ((middleValue === 'case' || middleValue === 'case default') && selectSubtype !== null && selectSubtype !== 'case') {
              break;
            }
            // `rank` / `rank default` valid only in `select rank`; reject in `select case`/`select type`.
            if ((middleValue === 'rank' || middleValue === 'rank default') && selectSubtype !== null && selectSubtype !== 'rank') {
              break;
            }
            // `type is` / `class is` / `class default` are guards of `select type`.
            // Only valid when the parent opener is `select` (which itself was paired
            // with `select type (...)` via isValidBlockOpen).
            const isSelectTypeGuard = middleValue === 'type is' || middleValue === 'class is' || middleValue === 'class default';
            if (isSelectTypeGuard && openerValue !== 'select') {
              break;
            }
            // Within `select`, guards are valid only for `select type`. Reject in `select case`/`select rank`.
            if (isSelectTypeGuard && selectSubtype !== null && selectSubtype !== 'type') {
              break;
            }
            // Check if this is an else-where variant (elsewhere, else where, else &\n where)
            // The merged token value may include &, comments (!...), and newlines between else and where
            const isElseWhereVariant = /^else(?:where$|\b[\s\S]*\bwhere$)/i.test(middleValue);
            // elsewhere / else where -> only for where blocks
            if (isElseWhereVariant && openerValue !== 'where') {
              // If opener is 'if', accept just the 'else' part as intermediate
              if (openerValue === 'if') {
                topBlock.intermediates.push({
                  type: 'block_middle',
                  value: token.value.slice(0, 4),
                  startOffset: token.startOffset,
                  endOffset: token.startOffset + 4,
                  line: token.line,
                  column: token.column
                });
              }
              break;
            }
            // else / elseif / else if (but not elsewhere/else where) -> only for if blocks
            if (!isElseWhereVariant && (middleValue === 'elseif' || /^else\b/i.test(middleValue)) && openerValue !== 'if') {
              break;
            }
            if (
              middleValue === 'contains' &&
              !['program', 'module', 'submodule', 'function', 'subroutine', 'procedure', 'type'].includes(openerValue)
            ) {
              break;
            }
            topBlock.intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's a compound end (e.g., "end program", "endprogram")
          const compoundMatch = closeValue.match(/^end[ \t]*([\s\S]+)/);
          if (compoundMatch) {
            // Normalize so `endblockdata`, `end block data`, `end  block  data` all
            // map to canonical `block data` and find the matching opener.
            const endType = normalizeFortranEndType(compoundMatch[1]);

            // Decrement this token from the running compound-end multiset so the
            // subsequent cross-pair check sees only types pending at indices
            // strictly greater than `tokenIndex`.
            const currentCount = remainingCompoundEndCounts.get(endType) ?? 0;
            if (currentCount > 1) {
              remainingCompoundEndCounts.set(endType, currentCount - 1);
            } else {
              remainingCompoundEndCounts.delete(endType);
            }

            // Walk stack from top, normalizing each opener value to handle `BLOCKDATA`
            // (concatenated, fixed-form) vs `block data` (spaced, free-form) interchangeably.
            for (let si = stack.length - 1; si >= 0; si--) {
              const openerValue = normalizeFortranEndType(stack[si].token.value);
              if (openerValue === endType) {
                matchIndex = si;
                break;
              }
            }

            // Reject the match when pairing with this opener would create a
            // crossed pair: an intervening opener between matchIndex and the
            // top of the stack has its own compound-end candidate still pending
            // later in the token stream. Consuming the deeper matchIndex first
            // would force that future compound close to cross the pair we are
            // about to build. Best-effort parsing prefers leaving the outer
            // opener as an orphan (no color) over a crossed pair (CLAUDE.md
            // best-effort parsing principle #3: prefer no color over wrong
            // color; VS Code Bracket Pair Colorization anchor-set principle).
            // Each Fortran opener's compound-end type equals its normalized
            // opener value, so no opener-type-to-end-type mapping is needed.
            if (matchIndex >= 0 && matchIndex < stack.length - 1) {
              for (let s = matchIndex + 1; s < stack.length; s++) {
                const aboveType = normalizeFortranEndType(stack[s].token.value);
                if ((remainingCompoundEndCounts.get(aboveType) ?? 0) > 0) {
                  matchIndex = -1;
                  break;
                }
              }
            }
          }

          // If no compound match found, only fallback for simple 'end' (not compound end keywords)
          // Skip blocks that require their own typed close keyword (e.g., select/where/forall):
          // a bare `end` should never close a select/where/forall — the typed close must follow.
          // Fortran spec requires the typed close for:
          //   - `select` / `where` / `forall` / `critical` / `associate`
          //   - `change team` (Fortran 2018) — must close with `end team`
          //   - `block` construct (Fortran 2008) — must close with `end block`
          //   - `enum` (Fortran 2003) — must close with `end enum`
          if (matchIndex < 0 && !compoundMatch && stack.length > 0) {
            const STRICT_CLOSE_OPENERS = new Set(['select', 'where', 'forall', 'critical', 'associate', 'team', 'block', 'enum']);
            if (!STRICT_CLOSE_OPENERS.has(stack[stack.length - 1].token.value.toLowerCase())) {
              matchIndex = stack.length - 1;
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
}
