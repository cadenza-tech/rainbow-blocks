// Octave block parser: extends MATLAB with # comments, #{ #} block comments, and Octave-specific end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { isAtStatementStart } from './matlabHelpers';
import { MatlabBlockParser } from './matlabParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping of Octave-specific close keywords to their valid openers
const LINE_CONTINUATION_PATTERN = /^\.\.\.(?:[^\r\n]*)(?:\r\n|\r|\n)/;
// Backslash line continuation: `\` + optional horizontal whitespace + newline. Horizontal
// whitespace covers the same set recognized by isHorizontalWhitespace below: ASCII
// space/tab/VT/FF plus Unicode horizontal spaces (U+0085, U+00A0, U+1680, U+2000-U+200A,
// U+2028, U+2029, U+202F, U+205F, U+3000). Keeping the two definitions in lock-step means
// `\<VT>\n`, `\<NBSP>\n`, `\<U+3000>\n` etc. all behave as legitimate continuations,
// just like `\ \n` and `\\t\n`. Unicode escapes are used instead of literal characters
// because U+2028 / U+2029 are line terminators in JS source text.
const BACKSLASH_CONTINUATION_PATTERN = /^\\[ \t\v\f\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*(?:\r\n|\r|\n)/;

// Unicode whitespace characters that should be treated like ASCII space/tab when
// scanning between `do` and `(` (or other adjacency checks). Mirrors the set used
// by adaParser.ts and applescriptParser.ts. Includes U+0085 (NEL), U+00A0 (NBSP),
// U+1680 (Ogham Space Mark), U+2000-U+200A (En Quad..Hair Space), U+2028 (Line
// Separator), U+2029 (Paragraph Separator), U+202F (Narrow No-Break Space),
// U+205F (Medium Math Space), U+3000 (Ideographic Space). Excludes `\r` / `\n`
// which terminate the logical line.
const HORIZONTAL_WHITESPACE_PATTERN = /[\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;

function isHorizontalWhitespace(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return ch === ' ' || ch === '\t' || ch === '\v' || ch === '\f' || HORIZONTAL_WHITESPACE_PATTERN.test(ch);
}

// Skips horizontal whitespace (ASCII space/tab/VT/FF and Unicode horizontal whitespace)
// and Octave line continuations (`...<NL>` and `\<NL>`) starting at `from`. Returns the
// new offset past all such skippable content. Used by Octave-specific validators that
// need to look at the next "real" character in the same logical line — line continuations
// and Unicode whitespace must be transparent to those checks.
function skipHorizontalWhitespaceAndContinuations(source: string, from: number): number {
  let i = from;
  while (i < source.length) {
    if (isHorizontalWhitespace(source[i])) {
      i++;
      continue;
    }
    const rest = source.slice(i);
    const dotsCont = rest.match(LINE_CONTINUATION_PATTERN);
    if (dotsCont) {
      i += dotsCont[0].length;
      continue;
    }
    const bsCont = rest.match(BACKSLASH_CONTINUATION_PATTERN);
    if (bsCont) {
      i += bsCont[0].length;
      continue;
    }
    break;
  }
  return i;
}

const OCTAVE_CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
  endfunction: 'function',
  endif: 'if',
  endfor: 'for',
  endwhile: 'while',
  endswitch: 'switch',
  end_try_catch: 'try',
  endparfor: 'parfor',
  end_unwind_protect: 'unwind_protect',
  endclassdef: 'classdef',
  endmethods: 'methods',
  endproperties: 'properties',
  endevents: 'events',
  endenumeration: 'enumeration',
  endarguments: 'arguments',
  endspmd: 'spmd',
  until: 'do'
};

// Keywords that take a condition/header expression. A bare `do` immediately following one of
// these on the same logical line (e.g. `if do`) is `do` used in expression position, not a
// do/until opener.
const DO_CONDITION_KEYWORDS = new Set(['if', 'elseif', 'while', 'switch', 'case', 'until']);

// Middle keywords that take a value/condition expression. A block_open keyword appearing on
// the same logical line *after* one of these (e.g. `case function`, `elseif try`) is being
// used as a value/condition operand, NOT as a block opener. Treating it as a block_open
// consumes a real outer `end` and destroys outer block pairing. `else`/`otherwise`/`catch`/
// `unwind_protect_cleanup` are deliberately excluded: they take no header, so a following
// block_open like `else function` is genuinely a nested block opener.
const OCTAVE_VALUE_CONTEXT_MIDDLE_KEYWORDS = new Set(['case', 'elseif']);

// Block-open keywords whose acceptance must be guarded against `case <kw>` / `elseif <kw>`
// value-context misclassification. Section keywords (methods/properties/events/enumeration/
// arguments) are covered by the parent's line-start section detection. The parent's
// empty-header rejection only catches HEADER_REQUIRED_KEYWORDS (if/while/switch/for/parfor)
// when they have NO header, so a value operand with a header such as `case for x` (header
// `x` present) slips through and must be guarded here as well. `do` is covered separately by
// isDoInConditionContext above.
const OCTAVE_BLOCK_OPENERS_NEEDING_VALUE_CONTEXT_GUARD = new Set([
  'function',
  'try',
  'unwind_protect',
  'classdef',
  'spmd',
  'if',
  'while',
  'switch',
  'for',
  'parfor'
]);

export class OctaveBlockParser extends MatlabBlockParser {
  // Mirror of MatlabBlockParser.phantomSectionPositions for Octave's overridden matchBlocks.
  // Populated by isValidBlockOpen below in lock-step with the parent's tracking, so that
  // Octave's matchBlocks can apply the same phantom-end skip logic as MATLAB. The parent's
  // phantomSectionPositions field is private so we cannot reuse it directly.
  private octavePhantomSectionPositions: number[] = [];
  // Octave classdef section keywords (matches MATLAB CLASSDEF_SECTION_KEYWORDS — kept
  // local because the parent's static is private).
  private static readonly OCTAVE_SECTION_KEYWORDS = new Set(['properties', 'methods', 'events', 'enumeration', 'arguments']);

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'function',
      'if',
      'for',
      'while',
      'do',
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
      'unwind_protect'
    ],
    blockClose: [
      'end',
      'until',
      'endfunction',
      'endif',
      'endfor',
      'endwhile',
      'endswitch',
      'end_try_catch',
      'endparfor',
      'end_unwind_protect',
      'endclassdef',
      'endmethods',
      'endproperties',
      'endevents',
      'endenumeration',
      'endarguments',
      'endspmd'
    ],
    blockMiddle: ['else', 'elseif', 'case', 'otherwise', 'catch', 'unwind_protect_cleanup']
  };

  // Octave-specific block keywords for command-syntax filtering. Includes MATLAB
  // base keywords plus Octave-only ones (do, until, endfunction, ...).
  private static readonly OCTAVE_BLOCK_KEYWORDS = new Set([
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
    // Octave-specific
    'do',
    'until',
    'unwind_protect',
    'unwind_protect_cleanup',
    'endfunction',
    'endif',
    'endfor',
    'endwhile',
    'endswitch',
    'end_try_catch',
    'endparfor',
    'end_unwind_protect',
    'endclassdef',
    'endmethods',
    'endproperties',
    'endevents',
    'endenumeration',
    'endarguments',
    'endspmd'
  ]);

  // Override to use Octave-specific keyword set (includes `do`, `until`, etc).
  protected override getAllBlockKeywords(): Set<string> {
    return OctaveBlockParser.OCTAVE_BLOCK_KEYWORDS;
  }

  // Octave uses # as a comment character in addition to %
  protected override isCommentChar(char: string): boolean {
    return char === '#' || char === '%';
  }

  // Octave adds `unwind_protect_cleanup` to the middle-keyword line-leaders set so that
  // `unwind_protect_cleanup end` (the bare `end` after the cleanup middle keyword) is
  // accepted as a legitimate block close of the enclosing unwind_protect, mirroring how
  // `else end` / `catch end` are accepted for if/try.
  private static readonly OCTAVE_MIDDLE_KEYWORDS_AS_LINE_LEADERS: ReadonlySet<string> = new Set([
    'else',
    'elseif',
    'case',
    'otherwise',
    'catch',
    'unwind_protect_cleanup'
  ]);

  protected override getMiddleKeywordsAsLineLeaders(): ReadonlySet<string> {
    return OctaveBlockParser.OCTAVE_MIDDLE_KEYWORDS_AS_LINE_LEADERS;
  }

  // Reject block open keywords used as variable names (do = 1, if = 5, etc.)
  // Reject `do` immediately followed by `(` — `do(args)` is a function call, not a do/until block.
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
      // Mirror MATLAB phantom-section tracking: when a section keyword (properties /
      // methods / events / enumeration / arguments) at line-start is rejected because
      // it is followed by `=` or compound assignment, the user likely wrote a stray
      // `end` for it. Record the position so matchBlocks can skip one `end`.
      if (
        OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(keyword) &&
        this.isAtSectionKeywordLineStart(source, position) &&
        !this.isInsideParensOrBrackets(source, position, excludedRegions)
      ) {
        this.octavePhantomSectionPositions.push(position);
      }
      return false;
    }
    // Reject `function` / `try` / `unwind_protect` / `classdef` / `spmd` appearing on the
    // same logical line as a preceding `case` / `elseif`. The middle keyword takes a value
    // (case) or condition (elseif) expression, so the block_open keyword here is an operand,
    // NOT a block opener. Treating it as a block_open consumes a real outer `end` and
    // destroys outer block pairing. Section keywords and HEADER_REQUIRED_KEYWORDS are
    // already covered by the parent's section-keyword / empty-header rejection paths; `do`
    // is covered by isDoInConditionContext below.
    if (OCTAVE_BLOCK_OPENERS_NEEDING_VALUE_CONTEXT_GUARD.has(keyword) && this.isInValueContextMiddleKeyword(source, position, excludedRegions)) {
      return false;
    }
    if (keyword === 'do') {
      // Reject `do` used in a condition/header position such as `if do` / `while do`: the
      // preceding keyword expects an expression, so this `do` is not a do/until opener.
      // Treating it as one leaves a spurious `do` on the stack that breaks the enclosing
      // block pairing (the generic `end` cannot close `do`, so if/end would be lost).
      if (this.isDoInConditionContext(source, position, excludedRegions)) {
        return false;
      }
      // Skip horizontal whitespace (ASCII space/tab/VT/FF plus Unicode spaces such
      // as NBSP / U+2000-200A / Ideographic Space) and line continuations (... or \)
      // after `do`, then inspect the first significant character. `do (args)`,
      // `do<NBSP>(args)`, `do ...\n(args)`, `do \\\n(args)`, `do[...]`, and
      // `do{...}` are the function-call / indexing forms — `do` is a variable
      // there, not a block opener. `do .x` (field access, possibly across a
      // continuation) is likewise a variable. A trailing line comment (`%...` /
      // `#...`) ends the logical line, so reaching it confirms `do` is a real
      // do/until opener.
      let j = position + keyword.length;
      while (j < source.length) {
        if (isHorizontalWhitespace(source[j])) {
          j++;
          continue;
        }
        const lineCont = source.slice(j).match(LINE_CONTINUATION_PATTERN);
        if (lineCont) {
          j += lineCont[0].length;
          continue;
        }
        const bsCont = source.slice(j).match(BACKSLASH_CONTINUATION_PATTERN);
        if (bsCont) {
          j += bsCont[0].length;
          continue;
        }
        // Line comments (`%...` or `#...`) do NOT continue a statement in Octave —
        // only `...` and `\` do. So `do % comment` ends the `do` statement: the
        // next line is an independent statement, not `do(...)`. Consume the
        // comment body up to (but not including) the line terminator, then break:
        // reaching the newline confirms no `(` can follow `do` on the same
        // logical line, so this `do` is a do/until opener, not a function call.
        if (this.isCommentChar(source[j])) {
          while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
            j++;
          }
          break;
        }
        break;
      }
      if (j < source.length && (source[j] === '(' || source[j] === '[' || source[j] === '{')) {
        return false;
      }
      // Reject `do)`, `do]`, `do}` — a closing bracket immediately after `do` is
      // invalid Octave syntax (no matching opener for the bracket). Treating `do`
      // as a block opener here leaves a spurious `do` on the stack that consumes
      // a later `until` (or worse, the enclosing block's `end`), breaking outer
      // pairing. Reject so both `do` and the stray bracket remain orphan tokens
      // (cost-minimal — no spurious BlockPair is created).
      if (j < source.length && (source[j] === ')' || source[j] === ']' || source[j] === '}')) {
        return false;
      }
      // Reject `do .x` (struct field assignment such as `do.x = 1`) and
      // `do..x` (still field access — `..` is not a valid Octave token, so the
      // parse is `do` then `.` then `.x`): the `.` begins a field access, so
      // `do` is a variable name, not a block opener. Treating it as an opener
      // leaves a spurious `do` on the stack and breaks the enclosing block
      // pairing. Exclude only `...` (three dots), which represents a line
      // continuation that was not consumed above (e.g. at EOF without a
      // trailing newline) and must not be mistaken for field access.
      if (j < source.length && source[j] === '.' && !(source[j + 1] === '.' && source[j + 2] === '.')) {
        return false;
      }
      // Reject `do:` and `do :` — Octave has no label statements and `:` is the
      // range operator, so a `:` immediately after `do` cannot start a do/until
      // body. Treating `do` as a block opener here destroys outer block pairing
      // (the orphan `do` consumes nothing and breaks the stack).
      if (j < source.length && source[j] === ':') {
        return false;
      }
      // Reject `do'` — a `'` here is the transpose operator on a variable named
      // `do` (`do 'str'` is likewise the command-syntax call `do('str')`).
      // Either way `do` is not a do/until opener; pairing it with a following
      // `until` produces a spurious block and breaks outer pairing.
      if (j < source.length && source[j] === "'") {
        return false;
      }
      // Reject `do <unexpected-char>` on the SAME physical line — `?`, `!`, `@`, `+`, `-`,
      // `~`, or an identifier (letter or `_`) directly after `do` (skipping only horizontal
      // whitespace, NOT line continuations) indicates `do` is being used as a variable, an
      // expression typo, or a command-syntax form — never a do/until opener. Treating it as
      // block_open leaves an orphan that consumes the enclosing block's `end`, destroying
      // outer pairing. We must check BEFORE consuming any continuation because legitimate
      // do/until forms keep the body on a separate physical line via `...`/`\` continuation
      // (where the probe stops at `.` of `...` or `\`, neither matching the rejection set).
      //
      // Accepted same-line forms (already handled above): comment, `...`/`\` continuation
      // (which moves on to next physical line), EOF.
      {
        let probe = position + keyword.length;
        while (probe < source.length && isHorizontalWhitespace(source[probe])) probe++;
        if (probe < source.length) {
          const ch = source[probe];
          if (ch === '?' || ch === '!' || ch === '@' || ch === '+' || ch === '-' || ch === '~') {
            return false;
          }
          // `do 5` / `do "s"` — a numeric literal or double-quoted string after `do` on the
          // same line is an implicit-multiplication operand or command-syntax argument, not a
          // do/until block body. (`do .5` is rejected by the field-access `.` check and
          // `do 's'` by the transpose-vs-string check elsewhere, so only `[0-9]` and `"` are
          // missing from the rejection set here.)
          if (/[0-9]/.test(ch) || ch === '"') {
            return false;
          }
          // Identifier following `do` on the same physical line (`do x;`, `do foo`, etc.).
          // Includes ASCII letters/_ and Unicode letters for symmetry with the rest of the
          // parser. Do NOT skip across line continuations here — `do ...<NL>body` is a
          // legitimate continuation-based do/until form (probe stops at `.` of `...` which
          // is not an identifier char, so this branch is not entered).
          if (/[a-zA-Z_]/.test(ch) || /\p{L}/u.test(ch)) {
            return false;
          }
        }
      }
      // Reject `do` used as a command-syntax argument (`disp do` → `disp('do')`).
      // The pattern is `<identifier> <whitespace> do` at statement start where the
      // identifier is not a recognized keyword. Treating such `do` as a block open
      // destroys outer block pairing because the spurious `do` consumes the real
      // `until` / leaves a phantom block on the stack.
      if (this.isOctaveCommandSyntaxArgument(source, position, excludedRegions)) {
        return false;
      }
    }
    // Octave-specific arguments-function-call check. This must run BEFORE the parent's
    // check (which uses its own MATLAB-style detector that does not skip excluded regions
    // when computing the inner content, wrongly classifying `arguments(...<NL>  Input)`
    // as a function call). When Octave's detector returns true, the keyword is a function
    // call → reject as block opener. When false (valid block opener), we record the
    // result so we can override the parent's potential false-positive rejection below.
    let octaveSaysArgumentsIsBlock = false;
    if (keyword === 'arguments') {
      if (this.isArgumentsFunctionCall(source, position, excludedRegions)) {
        // Phantom-section tracking: when `arguments(obj);` is rejected as a block opener,
        // the user likely wrote a stray `end` for it. Record the position so matchBlocks
        // can phantom-skip one `end`. Only when the keyword is at line-start (so a stray
        // `end` would be expected to follow on a subsequent line).
        if (this.isAtSectionKeywordLineStart(source, position) && !this.isInsideParensOrBrackets(source, position, excludedRegions)) {
          this.octavePhantomSectionPositions.push(position);
        }
        return false;
      }
      octaveSaysArgumentsIsBlock = true;
    }
    // Reject `methods(obj);` / `properties(obj);` / `events(obj);` / `enumeration(obj);`
    // statement-call form (the `<section_kw>(...)` is followed by `;`). This is a function
    // call (reflection helper) rather than a section opener — the parent's check accepts
    // these at line-start because `(` is in the allowed nextChar set, but the trailing `;`
    // disambiguates the statement-call form from a real section attribute list like
    // `properties (Access = public)\n`. Without this guard the keyword opens a spurious
    // block that consumes an inner `end` and orphans the enclosing methods/end pair.
    // `arguments` is excluded here because it has its own richer detector above
    // (isArgumentsFunctionCall) that also handles the attribute pattern.
    if (
      keyword !== 'arguments' &&
      OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(keyword) &&
      this.isSectionKeywordStatementCall(source, position, keyword, excludedRegions)
    ) {
      // Phantom tracking: mirrors the arguments(obj); case above. When the user wrote a
      // stray `end` for the rejected section call, matchBlocks must absorb it via
      // octavePhantomSectionPositions; otherwise the inner `end` consumes the enclosing
      // function's `end` and destroys outer block pairing.
      if (this.isAtSectionKeywordLineStart(source, position) && !this.isInsideParensOrBrackets(source, position, excludedRegions)) {
        this.octavePhantomSectionPositions.push(position);
      }
      return false;
    }
    // Section-keyword rejection when followed by an operator across a line continuation,
    // e.g. `properties ...<NL>+ 1` or `methods \<NL>* 2`. The parent's section-keyword
    // operator-rejection check only skips ASCII whitespace and falls through when it sees
    // the `...` excluded region (line continuation), wrongly accepting the keyword as a
    // section opener. Detect the case explicitly so Octave rejects (mirroring the
    // single-line form `properties + 1`). The check must run BEFORE the parent call so
    // the parent does not accept the wrong section opener.
    if (
      OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(keyword) &&
      this.isAtSectionKeywordLineStart(source, position) &&
      !this.isInsideParensOrBrackets(source, position, excludedRegions) &&
      this.isSectionKeywordRejectedByOperatorAcrossContinuation(source, position, keyword, excludedRegions)
    ) {
      this.octavePhantomSectionPositions.push(position);
      return false;
    }
    const result = super.isValidBlockOpen(keyword, source, position, excludedRegions);
    // Mirror MATLAB phantom-section tracking for the operator/punctuation case: when a
    // section keyword at line-start is followed by something other than newline / `(` /
    // `;` / `,` / `:` / comment, the parent rejects it as a section opener and the user
    // likely wrote a stray `end` for it. Replicate the parent's check here so Octave's
    // matchBlocks can apply the phantom-end skip.
    if (
      !result &&
      OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(keyword) &&
      this.isAtSectionKeywordLineStart(source, position) &&
      !this.isInsideParensOrBrackets(source, position, excludedRegions) &&
      this.isSectionKeywordRejectedByOperator(source, position, keyword, excludedRegions)
    ) {
      this.octavePhantomSectionPositions.push(position);
    }
    // Rescue path for `if \<NL>...`, `while \<NL>...`, `for \<NL>...`, etc.: the parent's
    // isFollowedByBinaryOperator check only skips ASCII whitespace, so a `\<NL>` line
    // continuation appearing immediately after the keyword is misread as the left-division
    // binary operator (`\`), causing the parent to reject the block opener and dropping the
    // surrounding pair. When the rejection cause is only the line-continuation misread (i.e.
    // the post-continuation char is NOT a real binary operator), override the parent's
    // rejection. Section keywords are excluded here; they have their own explicit handling.
    // Pre-parent checks (assignment / `do`-specific paths) already returned false for
    // genuine rejection cases, so by here the rejection is plausibly only the operator misread.
    if (!result && !OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(keyword)) {
      if (this.isFalseOperatorRejectionDueToContinuation(keyword, source, position)) {
        return true;
      }
    }
    // Override path for `arguments(...<NL>  Input)` and `arguments(\<NL>  Output)`:
    // Octave's `isArgumentsFunctionCall` (which correctly skips excluded regions when
    // computing the inner attribute content) already determined this is a real
    // arguments block opener, but the parent's MATLAB-style detector — which uses
    // raw `source.slice(...)` for the inner content — wrongly classifies it as a
    // function call. Trust Octave's verdict so the attribute-list-across-continuation
    // form is paired with its inner `end` and the enclosing function/end pair is
    // preserved.
    if (!result && octaveSaysArgumentsIsBlock) {
      return true;
    }
    return result;
  }

  // Returns true when the parent's isFollowedByBinaryOperator likely fired only because
  // a `\<NL>` line continuation immediately follows the keyword and was misread as the
  // left-division operator. Detection:
  //   1. The first non-ASCII-whitespace char after the keyword is a `\<NL>` matching the
  //      backslash-continuation pattern, OR a `...` line continuation starting with `.`.
  //   2. After skipping the continuation(s) and horizontal whitespace, the next char is
  //      NOT one of the binary-operator chars the parent would (correctly) reject:
  //      `* / ^ \ < > & | : = ~ !` and the prefix-capable `+ - ~ !` for for/parfor/try/
  //      spmd/classdef. A genuine binary operator after the continuation still rejects
  //      (matching the parent's intent).
  // Pre-position rejection causes (dot/at-sign/preceded-by-operator/command-syntax) are
  // independent of the line-continuation case so they are not affected by this rescue.
  private isFalseOperatorRejectionDueToContinuation(keyword: string, source: string, position: number): boolean {
    const afterKw = position + keyword.length;
    let probe = afterKw;
    // Use the Unicode-aware horizontal whitespace set (VT/FF/NBSP/U+3000 etc.) so
    // forms like `if<VT>\<NL>...` and `do<NBSP>\<NL>...` are recognised as having
    // a line continuation immediately after the keyword. Without this, the
    // continuation-rescue path falls through and the parent's binary-operator
    // rejection wins, dropping the surrounding block pair.
    while (probe < source.length && isHorizontalWhitespace(source[probe])) probe++;
    if (probe >= source.length) return false;
    const restAtProbe = source.slice(probe);
    const dotsCont = restAtProbe.match(LINE_CONTINUATION_PATTERN);
    const bsCont = restAtProbe.match(BACKSLASH_CONTINUATION_PATTERN);
    if (!dotsCont && !bsCont) return false;
    const nextPos = skipHorizontalWhitespaceAndContinuations(source, afterKw);
    if (nextPos >= source.length) {
      // Continuation followed by EOF (`if \\\n` with no body). Accept the opener; if no
      // body follows, the trailing close will leave it orphan (cost-minimal). Mirrors
      // the parent's intent for `if<NL>` (which is similarly headerless).
      return true;
    }
    const ch = source[nextPos];
    const next = nextPos + 1 < source.length ? source[nextPos + 1] : '';
    // Binary operators / compound-assignment leaders that genuinely reject the opener
    // (mirroring matlabHelpers.isFollowedByBinaryOperator).
    if (next === '=' && (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^' || ch === '\\' || ch === '&' || ch === '|')) {
      return false;
    }
    if (ch === '.' && nextPos + 2 < source.length && source[nextPos + 2] === '=') {
      const op = next;
      if (op === '*' || op === '/' || op === '^' || op === '\\') return false;
    }
    if ('*/^\\<>&|:'.includes(ch)) return false;
    if (ch === '=' && next === '=') return false;
    if ((ch === '~' || ch === '!') && next === '=') return false;
    if (
      (keyword === 'for' || keyword === 'parfor' || keyword === 'try' || keyword === 'spmd' || keyword === 'classdef') &&
      (ch === '+' || ch === '-' || ch === '~' || ch === '!')
    ) {
      return false;
    }
    return true;
  }

  // Returns true when `position` lies at the start of its line (only whitespace before).
  // Used by phantom section detection (mirrors MATLAB.isAtLineStartForSectionKeyword).
  private isAtSectionKeywordLineStart(source: string, position: number): boolean {
    const lineStart = Math.max(source.lastIndexOf('\n', position - 1), source.lastIndexOf('\r', position - 1)) + 1;
    return !/\S/.test(source.slice(lineStart, position));
  }

  // Returns true when a line-start section keyword is followed by an operator /
  // punctuation that the parent rejects as a section opener. Mirrors the conditions
  // inside MatlabBlockParser.isValidBlockOpen lines 367-396.
  private isSectionKeywordRejectedByOperator(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    let nextPos = position + keyword.length;
    while (nextPos < source.length && (source[nextPos] === ' ' || source[nextPos] === '\t')) {
      nextPos++;
    }
    if (nextPos >= source.length) return false;
    const region = this.findExcludedRegionAt(nextPos, excludedRegions);
    if (region) return false;
    const nextChar = source[nextPos];
    // ':' is NOT allowed: Octave has no label syntax, so `properties:` is invalid usage.
    return (
      nextChar !== '\n' &&
      nextChar !== '\r' &&
      nextChar !== '(' &&
      nextChar !== '%' &&
      nextChar !== ';' &&
      nextChar !== ',' &&
      !this.isCommentChar(nextChar)
    );
  }

  // Returns true when a line-start section keyword is followed by an operator after a
  // `...<NL>` or `\<NL>` line continuation (after horizontal whitespace), e.g.
  // `properties ...<NL>+ 1`. The parent's check only skips ASCII whitespace and falls
  // through on the `...` excluded region, wrongly accepting such forms. Treats the same
  // operator set as the parent's section-keyword rejector — anything other than newline /
  // `(` / `;` / `,` / comment after the continuation rejects the keyword. `=` (simple
  // assignment) is excluded because the parent already handles that via
  // skipWhitespaceAndContinuations and the assignment branch above; including it here
  // would double-record the phantom-section position.
  private isSectionKeywordRejectedByOperatorAcrossContinuation(
    source: string,
    position: number,
    keyword: string,
    excludedRegions: ExcludedRegion[]
  ): boolean {
    const afterKw = position + keyword.length;
    // Only act when there is a real line continuation immediately after the keyword
    // (after horizontal whitespace). Otherwise the parent's check handles it correctly.
    let probe = afterKw;
    while (probe < source.length && isHorizontalWhitespace(source[probe])) probe++;
    if (probe >= source.length) return false;
    const restAtProbe = source.slice(probe);
    const dotsCont = restAtProbe.match(LINE_CONTINUATION_PATTERN);
    const bsCont = restAtProbe.match(BACKSLASH_CONTINUATION_PATTERN);
    if (!dotsCont && !bsCont) return false;
    // Now skip continuations and horizontal whitespace fully, then inspect the next char.
    const nextPos = skipHorizontalWhitespaceAndContinuations(source, afterKw);
    if (nextPos >= source.length) return false;
    const region = this.findExcludedRegionAt(nextPos, excludedRegions);
    if (region) return false;
    const nextChar = source[nextPos];
    return (
      nextChar !== '\n' &&
      nextChar !== '\r' &&
      nextChar !== '(' &&
      nextChar !== '%' &&
      nextChar !== ';' &&
      nextChar !== ',' &&
      nextChar !== '=' &&
      !this.isCommentChar(nextChar)
    );
  }

  // Returns true when the block_open keyword at `position` lies on a logical line that
  // contains a preceding `case` / `elseif` middle keyword (i.e. the keyword is being used as
  // a value/condition operand of that middle keyword). Walks backward over horizontal
  // whitespace, identifiers, `...`/`\` line continuations, and other expression characters
  // until a raw newline or `;`/`,` statement separator terminates the logical line. If any
  // identifier encountered on the way is in OCTAVE_VALUE_CONTEXT_MIDDLE_KEYWORDS, the
  // block_open is in value-context and must be rejected. Mirrors the structure of
  // isDoInConditionContext but with the value-context middle-keyword set.
  private isInValueContextMiddleKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (isHorizontalWhitespace(source[i])) {
        i--;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.start - 1;
        continue;
      }
      // Handle a `\n`/`\r` that immediately follows a `...` continuation excluded region.
      if (source[i] === '\n' || source[i] === '\r') {
        let nlStart = i;
        if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') nlStart = i - 1;
        if (nlStart > 0) {
          const prevRegion = this.findExcludedRegionAt(nlStart - 1, excludedRegions);
          if (prevRegion && prevRegion.end === nlStart && source[prevRegion.start] === '.' && prevRegion.end > prevRegion.start + 1) {
            i = prevRegion.start - 1;
            continue;
          }
        }
        return false;
      }
      // Statement separator terminates the logical line scan.
      if (source[i] === ';' || source[i] === ',') return false;
      // Identifier — check if it is `case` / `elseif`.
      if (/[a-zA-Z0-9_]/.test(source[i])) {
        const idEnd = i;
        while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
        const ident = source.slice(i + 1, idEnd + 1).toLowerCase();
        if (OCTAVE_VALUE_CONTEXT_MIDDLE_KEYWORDS.has(ident)) return true;
        continue;
      }
      // Any other expression character — keep scanning backward.
      i--;
    }
    return false;
  }

  // Returns true when `do` at position appears anywhere on a logical line that begins with
  // a condition/header keyword (if/elseif/while/switch/case/until). The simple form `if do`
  // (no intervening identifier) is the original case; this method also handles the
  // multi-identifier form `if x do` / `while x y do` where the `do` is part of the header
  // expression. In all such cases, the `do` is used in expression position and is not a
  // do/until opener. Treating it as a block_open leaves a spurious `do` on the stack that
  // the trailing `end` cannot close (Octave's `end` does not close `do` — only `until` does),
  // destroying the enclosing block pair. The scan walks backward over horizontal whitespace,
  // identifiers, and `...`/`\` line continuations until a line break (or statement separator)
  // is reached; if any identifier on the way is a DO_CONDITION_KEYWORD, the `do` is rejected.
  private isDoInConditionContext(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (isHorizontalWhitespace(source[i])) {
        i--;
        continue;
      }
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.start - 1;
        continue;
      }
      // Handle a `\n`/`\r` that immediately follows a `...` continuation excluded region.
      // `...` regions are matched via matchSingleLineComment, whose `end` stops at the
      // newline (the newline itself is NOT included in the region). The backward walk
      // therefore lands on the newline first; we need to look one position before to find
      // the `...` region ending exactly there. Backslash continuation regions are NOT
      // affected (their pattern consumes the newline, so the region.end is already past
      // the newline and the previous branch handles it).
      if (source[i] === '\n' || source[i] === '\r') {
        // Compute the start of the line terminator (handle CRLF as a 2-char unit).
        let nlStart = i;
        if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') nlStart = i - 1;
        if (nlStart > 0) {
          const prevRegion = this.findExcludedRegionAt(nlStart - 1, excludedRegions);
          if (prevRegion && prevRegion.end === nlStart && source[prevRegion.start] === '.' && prevRegion.end > prevRegion.start + 1) {
            i = prevRegion.start - 1;
            continue;
          }
        }
        // Raw newline (not a continuation) terminates the logical line scan — no condition
        // keyword found before `do` on the same statement, so `do` is a real opener.
        return false;
      }
      // Statement separator (`;` / `,`) also terminates the logical line scan (semantically
      // `if x; do` starts a new statement at `do`, so `do` is a real opener there).
      if (source[i] === ';' || source[i] === ',') return false;
      // Identifier (letter / digit / underscore) — read it backward, check if it is a
      // DO_CONDITION_KEYWORD. If yes, this `do` is in a condition context. Otherwise the
      // identifier is some other token on the logical line and we keep scanning backward
      // (multi-identifier headers like `if x do` or `while x y do` need the scan to
      // traverse past `x` / `y` to reach the leading keyword).
      if (/[a-zA-Z0-9_]/.test(source[i])) {
        const idEnd = i;
        while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
        const ident = source.slice(i + 1, idEnd + 1).toLowerCase();
        if (DO_CONDITION_KEYWORDS.has(ident)) return true;
        // i is now one before the identifier's first char; continue the outer loop to keep
        // scanning backward for an earlier token on the same logical line.
        continue;
      }
      // Any other non-whitespace, non-identifier, non-separator character (operators,
      // punctuation, etc.) — `do` is part of an expression. Cost-minimal: keep scanning
      // backward so multi-identifier expressions like `if x + y do` still detect the
      // leading `if`.
      i--;
    }
    return false;
  }

  // Returns true when an Octave keyword (`do`) at position is the argument of a
  // command-syntax invocation, e.g. `disp do`. Mirrors the structure of MATLAB's
  // private isCommandSyntaxArgument but is callable for any keyword (since `do` is
  // Octave-specific — MATLAB excludes it from its own command-syntax detection).
  // Detection collects the full logical line preceding the keyword (following `...`
  // and Octave `\` line continuations) and checks whether the line begins with a
  // non-keyword identifier.
  private isOctaveCommandSyntaxArgument(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    // Require at least one horizontal whitespace (space / tab / VT / FF / Unicode
    // space) between the previous token and the keyword. VT (`\v`) and FF (`\f`)
    // are valid token separators in Octave, so `disp\vdo` is the command-syntax
    // call `disp('do')` just like `disp do` and `disp\tdo`.
    if (position <= 0 || !isHorizontalWhitespace(source[position - 1])) return false;
    let i = position - 1;
    while (i >= 0) {
      if (isHorizontalWhitespace(source[i])) {
        i--;
        continue;
      }
      if (excludedRegions) {
        let region = this.findExcludedRegionAt(i, excludedRegions);
        if (!region && i >= 0) {
          let nlStart = i;
          if (source[i] === '\n' && i > 0 && source[i - 1] === '\r') nlStart = i - 1;
          const candidate = this.findExcludedRegionAt(nlStart > 0 ? nlStart - 1 : 0, excludedRegions);
          if (candidate && candidate.end === nlStart) region = candidate;
        }
        if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === '\n' || source[i] === '\r') return false;
      if (!/[a-zA-Z0-9_]/.test(source[i])) return false;
      const idEnd = i;
      while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
      const idStart = i + 1;
      const ident = source.slice(idStart, idEnd + 1);
      if (!/^[a-zA-Z_]/.test(ident)) return false;
      // A recognised block keyword breaks the command-syntax chain.
      if (this.getAllBlockKeywords().has(ident.toLowerCase())) return false;
      let j = idStart - 1;
      while (j >= 0 && (isHorizontalWhitespace(source[j]) || source[j] === '\u{FEFF}')) j--;
      if (j < 0) return true;
      const ch = source[j];
      if (ch === '\n' || ch === '\r' || ch === ';' || ch === ',') {
        return true;
      }
      i = j;
    }
    return false;
  }

  // Returns true when a non-`arguments` section keyword (methods / properties / events /
  // enumeration) at `position` is in `<keyword>(...);` statement-call form — i.e., the
  // keyword is directly followed by `(`, the parens contain any content, and the closing
  // `)` is followed by `;`. Such forms are reflection-helper function calls (Octave allows
  // calling methods/properties/events/enumeration as built-in introspection functions),
  // NOT real section openers. The trailing `;` is the disambiguator: bare attribute lists
  // (`properties (Access = public)\n`) are followed by a newline, not `;`. Skips horizontal
  // whitespace and line continuations between the keyword and `(`, and between `)` and `;`,
  // so multi-line forms like `properties(x) ...<NL>;` and `methods\<NL>(x);` are detected.
  private isSectionKeywordStatementCall(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    // Step 1: must be followed by `(` after horizontal whitespace + line continuations.
    const j = skipHorizontalWhitespaceAndContinuations(source, position + keyword.length);
    if (j >= source.length || source[j] !== '(') return false;
    // Step 2: find the matching `)` ignoring excluded regions and tracking nesting.
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
    if (depth !== 0) return false;
    // Step 3: check for trailing `;` after `)` (skipping horizontal whitespace + continuations).
    const after = skipHorizontalWhitespaceAndContinuations(source, k + 1);
    return after < source.length && source[after] === ';';
  }

  // Returns true when `arguments(...)` looks like a function call rather than an
  // arguments block attribute list. Heuristics:
  //   * Followed by `;` after `)` → almost always a function call (`arguments(obj);`).
  //   * Inside the parens, the content is something other than the recognised
  //     argument attribute keywords (Input / Output / Repeating, optionally with
  //     trailing whitespace/comma) → treat as a function call.
  // Empty parens `arguments()` and the recognised attributes preserve normal
  // block-opener semantics so existing MATLAB-style attribute lists keep working.
  private isArgumentsFunctionCall(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Skip horizontal whitespace (ASCII + Unicode) and line continuations between
    // `arguments` and `(` so `arguments ...<NL>(obj);` and `arguments \<NL>(obj);` are
    // detected as function calls (single logical line `arguments(obj);`).
    const j = skipHorizontalWhitespaceAndContinuations(source, position + 'arguments'.length);
    if (j >= source.length || source[j] !== '(') return false;
    // Find the matching `)` ignoring excluded regions and tracking nesting.
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
    if (depth !== 0) return false;
    // Build `inner` from the literal content between `(` and `)`, but skip excluded
    // regions (line continuations `...<NL>` / `\<NL>`, comments, strings) so the
    // attribute pattern test sees only the real attribute tokens. Without this, an
    // `arguments(...<NL>  Input)` would expose `...\n      Input` to the test and
    // fail the attribute regex, wrongly classifying the attribute list as a function call.
    let innerRaw = '';
    let m = j + 1;
    while (m < k) {
      if (this.isInExcludedRegion(m, excludedRegions)) {
        const region = this.findExcludedRegionAt(m, excludedRegions);
        if (region) {
          // Substitute the excluded region with a single space so adjacent identifiers
          // do not get concatenated (e.g. `Input...<NL>Output` becomes `Input Output`,
          // not `InputOutput`).
          innerRaw += ' ';
          m = region.end;
          continue;
        }
      }
      innerRaw += source[m];
      m++;
    }
    const inner = innerRaw.trim();
    // Pattern 1: trailing `;` after `)` (statement-call form, e.g. `arguments(obj);`).
    // Skip horizontal whitespace and line continuations after `)` so a continuation
    // before the `;` still detects the statement form.
    const after = skipHorizontalWhitespaceAndContinuations(source, k + 1);
    if (after < source.length && source[after] === ';') {
      return true;
    }
    // Pattern 2: inner does not look like attribute keywords. Recognised attribute
    // forms are `Input` / `Output` / `Repeating` (case-insensitive), optionally
    // followed by `,` and another attribute. Empty parens are also treated as
    // attribute form (block opener) for backwards compatibility.
    if (inner.length === 0) return false;
    const attrPattern = /^(?:input|output|repeating)(?:\s*,\s*(?:input|output|repeating))*$/i;
    if (!attrPattern.test(inner)) {
      return true;
    }
    return false;
  }

  // Walks a single balanced indexing group `(...)`, `{...}`, or `[...]` starting at
  // `pos` (which must be the opening delimiter). Returns the offset immediately after
  // the matching closer, or -1 when the group is unterminated. Nested groups inside
  // (including mixed `(` / `{` / `[`) are tracked together; excluded regions are
  // transparent. Used by isIndexingAssignment to chain indexing operations like
  // `end(1)(2)`, `end{1}.x`, `end(1){2}` (Octave permits `a()()()` style chain
  // indexing, and `{}` for cell-array indexing).
  private skipBalancedIndexingGroup(source: string, pos: number, excludedRegions: ExcludedRegion[]): number {
    const opener = source[pos];
    if (opener !== '(' && opener !== '{' && opener !== '[') return -1;
    let depth = 1;
    let k = pos + 1;
    while (k < source.length && depth > 0) {
      if (this.isInExcludedRegion(k, excludedRegions)) {
        const region = this.findExcludedRegionAt(k, excludedRegions);
        if (region) {
          k = region.end;
          continue;
        }
      }
      const ch = source[k];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      if (depth === 0) return k + 1;
      k++;
    }
    return -1;
  }

  // Returns true when the close keyword (`end` or `until`) at `position` is the target
  // of an indexing assignment such as `end(1) = 5;`, `end(1) += 5;`, `end(1).x = 5;`,
  // `until(1) = 5`, or the cell-array / chained variants `end{1} = 5`, `end{1}.x = 5`,
  // `end(1)(2) = 5`, `end(1){2} = 5`, `end[1] = 5`. Detection: directly followed (after
  // whitespace and continuations) by `(`, `{`, or `[`, then one or more balanced indexing
  // groups (any mix of `(...)` `{...}` `[...]`, Octave chain-indexing-style), then either
  // an assignment / compound assignment (covered by isFollowedByAssignment, which excludes
  // `==`) or a `.` field access — `end(1).x = 5` assigns to a field of the indexed
  // variable. A trailing `...` (line continuation) after the chain is not field access
  // and is therefore excluded. String/comment regions are skipped via `excludedRegions`
  // while scanning each group.
  private isIndexingAssignment(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Skip horizontal whitespace (ASCII + Unicode, e.g. NBSP) and line continuations
    // (`...<NL>` and `\<NL>`) between the keyword and the first indexer so
    // `end ...<NL>(1) = 5`, `end \<NL>(1) = 5`, and `end<NBSP>(1) = 5` are all detected.
    const j = skipHorizontalWhitespaceAndContinuations(source, position + keyword.length);
    if (j >= source.length) return false;
    const firstCh = source[j];
    if (firstCh !== '(' && firstCh !== '{' && firstCh !== '[') return false;
    // Walk the first indexing group plus any chained groups: `a()()()`, `a(){}`, `a[](){}`
    // are all valid Octave indexing chains. After each group we again skip horizontal
    // whitespace and continuations so `a() ...<NL>(2)` still chains correctly.
    let after = this.skipBalancedIndexingGroup(source, j, excludedRegions);
    if (after < 0) return false;
    for (;;) {
      const probe = skipHorizontalWhitespaceAndContinuations(source, after);
      if (probe >= source.length) break;
      const ch = source[probe];
      if (ch !== '(' && ch !== '{' && ch !== '[') break;
      const next = this.skipBalancedIndexingGroup(source, probe, excludedRegions);
      if (next < 0) return false;
      after = next;
    }
    // After the (possibly chained) indexing groups, skip horizontal whitespace AND line
    // continuations so `end(1) ...<NL>= 5` and `end(1)\<NL>.x = 5` are still detected.
    const tail = skipHorizontalWhitespaceAndContinuations(source, after);
    if (tail >= source.length) return false;
    // Field access (`end(1).x = ...`, `end{1}.x = ...`): a `.` here continues an lvalue,
    // so the keyword is a variable being indexed and field-assigned, not a block close.
    // `...` (line continuation) is not field access and must be excluded.
    if (source[tail] === '.' && !(source[tail + 1] === '.' && source[tail + 2] === '.')) {
      return true;
    }
    // Plain or compound assignment (`=`, `+=`, `*=`, `.^=`, ... but not `==`).
    return this.isFollowedByAssignment(source, tail);
  }

  // Reject block close keywords used as variable names (end = 5, endif = 1, etc.)
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
      return false;
    }
    // Reject `<close>(<expr>) = <value>` / `<close>{...} = <value>` / `<close>[...] = <value>`
    // indexing-assignment forms: the keyword here is a variable name being indexed and
    // assigned (or field-assigned, `end(1).x = 5`), not a block close. Without this guard
    // the indexed keyword consumes an outer block opener and the trailing real close
    // becomes orphan. Applies to ALL Octave close keywords — bare `end`, `until`, and
    // typed-close (endif / endfor / endwhile / endswitch / end_try_catch / endparfor /
    // end_unwind_protect / endclassdef / endmethods / endproperties / endevents /
    // endenumeration / endarguments / endspmd / endfunction). The `(`-after-typed-close
    // guard below handles bare `endif(...)` function-call form (where the trailing `=` may
    // be absent), but cannot detect cell/bracket indexing because `{`/`[` are valid
    // Octave indexers that the function-call guard does not cover.
    const lowerKw = keyword.toLowerCase();
    if (this.isIndexingAssignment(keyword, source, position, excludedRegions)) {
      return false;
    }
    // Reject `end` appearing on the same logical line as a preceding `until` outside
    // parens, e.g. `until end > 0` / `until end == 1`. The `end` here is an operand in
    // the until condition expression (not a block close), and treating it as a close
    // consumes an outer block opener (function/while/etc.) and orphans the real close.
    // The parent's same-line checks reject `end` after binary operators (`+`, `-`, `*`,
    // `/`, etc.) but deliberately leave comparison operators (`>`, `<`, `==`, `~=`)
    // untouched, so `until end > 0` and `until end == 1` slip through without this
    // Octave-specific guard. Only applies to bare `end` — typed Octave closes (`endif`,
    // `endfor`, ...) are already constrained by isAtStatementLeadingPosition.
    if (lowerKw === 'end' && this.isPrecededByUntilOnLogicalLine(source, position, excludedRegions)) {
      return false;
    }
    // Reject typed-end keywords (endif/endfor/endwhile/etc.) used as identifiers in
    // expression context (e.g., `if endif == 5`). When the keyword does not appear at
    // the start of a statement, it is being used as a variable/identifier rather than
    // closing a block.
    const isTypedClose = (lowerKw !== 'end' && lowerKw.startsWith('end')) || lowerKw === 'until';
    if (isTypedClose && !this.isAtStatementLeadingPosition(source, position, excludedRegions)) {
      return false;
    }
    // Typed-end keywords (endif/endfor/endwhile/...) followed immediately by `(` are
    // function calls (e.g., `endfunction()`, `endif(x)`), not block closes. Only `(`
    // unambiguously identifies the keyword as an identifier being called; trailing
    // text such as `endfunction garbage` or `endif foo` is technically a syntax error
    // in Octave but the user's intent is clearly to close the block, so accepting the
    // close is cost-minimal (1 spurious orphan identifier vs 2 spurious orphan block
    // keywords — see CLAUDE.md's coverage of the "BlockPair が壊れる場合は防御強化する"
    // principle). Assignment forms (`endif = 5`) are already rejected at the top of
    // this method by isFollowedByAssignment. `until` is excluded because it requires
    // a condition expression (`until cond`). Skip horizontal whitespace AND line
    // continuations so `endif ...<NL>` and `endif \<NL>` are still treated as bare
    // typed-close (the `...` / `\` continues to the next physical line).
    if (isTypedClose && lowerKw !== 'until') {
      const after = skipHorizontalWhitespaceAndContinuations(source, position + keyword.length);
      if (after < source.length && source[after] === '(') {
        return false;
      }
    }
    return super.isValidBlockClose(keyword, source, position, excludedRegions);
  }

  // Middle keywords that introduce a new statement within their enclosing block. A
  // typed-close keyword appearing on the same logical line *after* one of these is at a
  // statement-leading position (e.g. `else endif`, `catch end_try_catch`), mirroring how
  // `else end` / `catch end` are accepted for bare `end`.
  //
  // Excludes `case` and `elseif` because both keywords take a value/condition expression
  // (`case <value>`, `elseif <condition>`), and a typed-close keyword on the same line
  // (e.g. `case endswitch`, `elseif endif`) is therefore part of the value/condition
  // expression — NOT a block close. Treating it as a block close consumes the enclosing
  // switch/if and orphans the real outer `end`. `else`/`otherwise`/`catch`/
  // `unwind_protect_cleanup` take no header expression, so `else endif` / `catch
  // end_try_catch` etc. legitimately introduce the close.
  private static readonly OCTAVE_MIDDLE_KEYWORDS_PRECEDING_TYPED_CLOSE: ReadonlySet<string> = new Set([
    'else',
    'otherwise',
    'catch',
    'unwind_protect_cleanup'
  ]);

  // Returns true when the position is at the start of a statement (line start, after
  // a `;`/`,` separator, at the beginning of the source, or immediately following a
  // middle keyword such as `else`/`catch`/`unwind_protect_cleanup` on the same line).
  // When the previous line ended with a `...` or `\` continuation, the current line is
  // logically a continuation of the previous statement, so a typed-end keyword there is
  // mid-expression, not leading. `...` or `\` appearing inside an excluded region
  // (comment / string) is not a real continuation — it is just text — so it is ignored.
  private isAtStatementLeadingPosition(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0 && isHorizontalWhitespace(source[i])) i--;
    if (i < 0) return true;
    const ch = source[i];
    if (ch === ';' || ch === ',') return true;
    if (ch === '\n' || ch === '\r') {
      // Walk past the newline to check whether the previous physical line ended with
      // `...` or `\` continuation (which would make `position` mid-expression).
      let nlEnd = i;
      if (ch === '\n' && i > 0 && source[i - 1] === '\r') nlEnd = i - 1;
      let scan = nlEnd - 1;
      while (scan >= 0 && isHorizontalWhitespace(source[scan])) scan--;
      if (scan >= 2 && source[scan] === '.' && source[scan - 1] === '.' && source[scan - 2] === '.') {
        // `...` is recorded as an excluded region whose `start` is the first `.` of the
        // continuation. If we find a region containing `scan - 2` whose start is *before*
        // `scan - 2`, the `...` is text inside a comment/string, not a real continuation.
        const region = excludedRegions ? this.findExcludedRegionAt(scan - 2, excludedRegions) : null;
        if (!region || region.start === scan - 2) {
          return false;
        }
      }
      if (scan >= 0 && source[scan] === '\\') {
        // Same logic as `...` above: a real backslash continuation has its excluded
        // region starting exactly at the `\`. A `\` text inside an earlier comment/string
        // has a region that started before this position.
        const region = excludedRegions ? this.findExcludedRegionAt(scan, excludedRegions) : null;
        if (!region || region.start === scan) {
          return false;
        }
      }
      return true;
    }
    // When the previous non-whitespace character is an identifier-letter / `_`, the
    // preceding token may be a middle keyword (else / elseif / case / otherwise / catch /
    // unwind_protect_cleanup). In that case the typed-close at `position` is the
    // legitimate close of the enclosing block, mirroring `else end` / `catch end` for
    // bare `end`. Read the identifier backward and check the set. Cost-minimal: rejecting
    // these forms leaves both the middle keyword and the close orphan, which destroys
    // outer block pairing (e.g. `if x\nelse endif` would lose the entire if/endif pair).
    if (/[a-zA-Z_]/.test(ch)) {
      const idEnd = i;
      while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
      const ident = source.slice(i + 1, idEnd + 1).toLowerCase();
      if (OctaveBlockParser.OCTAVE_MIDDLE_KEYWORDS_PRECEDING_TYPED_CLOSE.has(ident)) {
        return true;
      }
    }
    return false;
  }

  // Returns true when `position` (pointing at a bare `end`) lies on the same logical
  // line as a preceding `until` keyword that itself sits at statement-leading position
  // and is not inside parens/brackets. Used to reject `until end > 0` / `until end == 1`
  // — comparison-operator forms that the parent's same-line operator checks deliberately
  // leave alone. Scans backward through horizontal whitespace, `...`/`\` continuations,
  // and excluded regions to locate the previous identifier; if that identifier is `until`
  // (case-insensitive) AND is at a statement-leading position AND is not inside a paren
  // context, the `end` is part of the until condition. Stops on a physical newline that
  // is NOT a continuation (the `until` would not reach a same-line `end` across a raw
  // newline) — but since `end` here is already on the same line as the `until` per the
  // statement-leading semantics, the scan naturally terminates at the `until` token.
  private isPrecededByUntilOnLogicalLine(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (isHorizontalWhitespace(source[i])) {
        i--;
        continue;
      }
      // Skip `...`/`\` line continuations transparently — they continue the logical line.
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
        i = region.start - 1;
        continue;
      }
      // A raw newline that is NOT a continuation terminates the scan: anything before is
      // on a previous logical line. Cost-minimal: do not consume an outer opener.
      if (source[i] === '\n' || source[i] === '\r') return false;
      // Reached a non-whitespace, non-continuation character. If it is an identifier
      // character, read the identifier and check whether it is `until`.
      if (!/[a-zA-Z0-9_]/.test(source[i])) return false;
      const idEnd = i;
      while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
      const ident = source.slice(i + 1, idEnd + 1).toLowerCase();
      if (ident !== 'until') return false;
      const untilStart = i + 1;
      // The `until` must itself be at statement-leading position (so we are not catching
      // `x = until_something + end`), and must not be inside parens/brackets (we already
      // know `end` is not inside parens because the parent rejects it via the trailing
      // isInsideParensOrBrackets check, but `until` could still in principle be in a
      // bracket scope — guard it for symmetry).
      if (!this.isAtStatementLeadingPosition(source, untilStart, excludedRegions)) return false;
      if (this.isInsideParensOrBrackets(source, untilStart, excludedRegions)) return false;
      return true;
    }
    return false;
  }

  // Filter out middle keywords used as variable names (else = 5, case += 1, etc.)
  // and middle keywords inside parentheses/brackets/braces
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Reset phantom section positions for this parse (populated by isValidBlockOpen).
    this.octavePhantomSectionPositions = [];
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((t) => {
      if (t.type !== 'block_middle') {
        return true;
      }
      if (this.isFollowedByAssignment(source, t.startOffset + t.value.length)) {
        return false;
      }
      if (this.isInsideParensOrBrackets(source, t.startOffset, excludedRegions)) {
        return false;
      }
      return true;
    });
  }

  // Checks if position is followed by = or compound assignment (+=, -=, *=, /=, \=, ^=, **=, .+=, .-=, .*=, ./=, .\=, .^=, .**=)
  // but not == (comparison)
  protected isFollowedByAssignment(source: string, afterPos: number): boolean {
    let i = afterPos;
    while (i < source.length) {
      // Skip horizontal whitespace using the same Unicode-aware set as the rest of the
      // parser (isHorizontalWhitespace covers ASCII space/tab/VT/FF plus Unicode spaces
      // such as NBSP / U+2000-200A / Ideographic Space). This keeps assignment detection
      // symmetric with the `do (args)` function-call check: `do<NBSP>= 1;` / `if<U+3000>= 5;`
      // are assignments to a variable named `do` / `if`, exactly like `do = 1;` / `do\f= 1;`.
      if (isHorizontalWhitespace(source[i])) {
        i++;
        continue;
      }
      // Skip ... line continuation followed by a newline
      const continuation = source.slice(i).match(LINE_CONTINUATION_PATTERN);
      if (continuation) {
        i += continuation[0].length;
        continue;
      }
      // Skip \ line continuation followed by a newline
      const backslashContinuation = source.slice(i).match(BACKSLASH_CONTINUATION_PATTERN);
      if (backslashContinuation) {
        i += backslashContinuation[0].length;
        continue;
      }
      break;
    }
    if (i >= source.length) {
      return false;
    }
    // Simple assignment: = (but not ==)
    if (source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
      return true;
    }
    // Two-character compound assignment: **=
    if (source[i] === '*' && i + 2 < source.length && source[i + 1] === '*' && source[i + 2] === '=') {
      return true;
    }
    // Single-character compound assignment: +=, -=, *=, /=, \=, ^=, |=, &=
    if (
      (source[i] === '+' ||
        source[i] === '-' ||
        source[i] === '*' ||
        source[i] === '/' ||
        source[i] === '\\' ||
        source[i] === '^' ||
        source[i] === '|' ||
        source[i] === '&') &&
      i + 1 < source.length &&
      source[i + 1] === '='
    ) {
      return true;
    }
    // Element-wise three-character compound assignment: .**=
    if (source[i] === '.' && i + 3 < source.length && source[i + 1] === '*' && source[i + 2] === '*' && source[i + 3] === '=') {
      return true;
    }
    // Element-wise two-character compound assignment: .+=, .-=, .*=, ./=, .\=, .^=
    if (
      source[i] === '.' &&
      i + 2 < source.length &&
      (source[i + 1] === '+' ||
        source[i + 1] === '-' ||
        source[i + 1] === '*' ||
        source[i + 1] === '/' ||
        source[i + 1] === '\\' ||
        source[i + 1] === '^') &&
      source[i + 2] === '='
    ) {
      return true;
    }
    return false;
  }

  // Custom block matching for Octave-specific end keywords. Octave intentionally accepts
  // properties/methods/events/enumeration as standalone block openers (older OOP convention
  // for @ClassDir/method.m files), so unlike MATLAB the parser does not require an
  // enclosing classdef. The 'arguments' block (MATLAB R2019b compatibility) is the
  // exception: it is only valid inside a function/methods/classdef body.
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];
    // Snapshot phantom section positions and process them in order. Each phantom
    // represents a section keyword that was rejected at tokenize but where the user
    // probably wrote a stray `end` to close it. We skip one `end` per phantom — but
    // only when doing so doesn't leave a real opener unmatched (defensive: prefer
    // pairing real openers with real closes).
    //
    // Union the parent MATLAB phantom positions (recorded for empty-header `if;`,
    // `while;`, `for;`, `switch;` openers via the parent's HEADER_REQUIRED_KEYWORDS
    // rejection path) with the Octave-specific phantom positions (recorded for
    // section-keyword rejections inside Octave's own isValidBlockOpen). Without
    // this, Octave's matchBlocks would only see its own phantom set, the inner
    // `end` from the user's stray write would be paired with the outer block, and
    // the real outer `end` would become orphan — destroying outer block pairing.
    // Sort the union so phantomCursor advances in source order.
    const phantomPositions = [...this.octavePhantomSectionPositions, ...this.phantomSectionPositions].sort((a, b) => a - b);
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
          if (token.value.toLowerCase() === 'arguments') {
            const hasFunctionOrClass = stack.some((b) => {
              const v = b.token.value.toLowerCase();
              return v === 'function' || v === 'methods' || v === 'classdef';
            });
            if (!hasFunctionOrClass) {
              // Drop the token: an `arguments` block outside of any function/methods/
              // classdef context is almost certainly a function call (`arguments(obj)`)
              // rather than a real block. Recording a phantom-end skip here would
              // consume a legitimate `end` from an enclosing block (e.g. an `if`
              // wrapping a single `end`), destroying outer block pairing. Mirrors
              // MatlabBlockParser.matchBlocks lines 525-532.
              break;
            }
          } else if (
            OctaveBlockParser.OCTAVE_SECTION_KEYWORDS.has(token.value.toLowerCase()) &&
            this.sectionKeywordsWithParen.has(token.startOffset) &&
            (stack.length === 0 || stack[stack.length - 1].token.value.toLowerCase() !== 'classdef')
          ) {
            // Drop a parenthesized section keyword (`properties(x)`, `methods(x)`) whose
            // closest enclosing block is NOT a classdef. The `(`-form without a trailing `;`
            // is a reflection function call (`properties(x)` lists handle x's properties),
            // not a section opener. Octave does accept BARE section keywords as standalone
            // openers (older OOP convention), so only the parenthesized form recorded in
            // sectionKeywordsWithParen is dropped here. No phantom-end skip is pushed: a
            // function call has no stray `end`, so consuming one would orphan an outer block.
            // Mirrors MatlabBlockParser.matchBlocks lines 1117-1134 for non-arguments sections.
            break;
          }
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const middleValue = token.value.toLowerCase();
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            // Validate intermediate keyword against opener type
            if (middleValue === 'else' || middleValue === 'elseif') {
              if (topOpener !== 'if') break;
              // `else` must be the last branch of an `if`: reject a duplicate
              // `else` and an `elseif` appearing after `else` — both are syntax
              // errors and must not be recorded as intermediates.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawElse = intermediates.some((t) => t.value.toLowerCase() === 'else');
              if (sawElse) break;
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
              // Reject case after otherwise — switch semantics require otherwise to be last,
              // and reject duplicate otherwise (only one is valid per switch).
              const intermediates = stack[stack.length - 1].intermediates;
              const sawOtherwise = intermediates.some((t) => t.value.toLowerCase() === 'otherwise');
              if (sawOtherwise && (middleValue === 'case' || middleValue === 'otherwise')) break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
              // Octave allows at most one `catch` per `try` block. A duplicate is
              // a syntax error and must not be recorded as an intermediate.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawCatch = intermediates.some((t) => t.value.toLowerCase() === 'catch');
              if (sawCatch) break;
            } else if (middleValue === 'unwind_protect_cleanup') {
              if (topOpener !== 'unwind_protect') break;
              // Octave allows at most one unwind_protect_cleanup per unwind_protect block.
              // A duplicate is a syntax error and must not be recorded as an intermediate.
              const intermediates = stack[stack.length - 1].intermediates;
              const sawCleanup = intermediates.some((t) => t.value.toLowerCase() === 'unwind_protect_cleanup');
              if (sawCleanup) break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          // Phantom section keyword skip (mirror of MatlabBlockParser.matchBlocks logic):
          // when `properties = 5` (or `properties + 1`) was rejected at tokenize, the user
          // likely wrote a stray `end`. If there's a phantom position between the most recent
          // block_open's offset and this close's offset, AND there are enough remaining closes
          // to still close every open block on the stack, skip this close as the phantom's
          // matching `end`. Only applies to generic `end` (not Octave-specific typed closes
          // like `endif`, `endfor` — those have a definite opener type).
          if (token.value.toLowerCase() === 'end' && phantomCursor < phantomPositions.length && stack.length > 0) {
            const topOffset = stack[stack.length - 1].token.startOffset;
            const phantomOffset = phantomPositions[phantomCursor];
            if (phantomOffset > topOffset && phantomOffset < token.startOffset && remainingCloses[idx + 1] >= stack.length) {
              phantomCursor++;
              break;
            }
          }
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's an Octave-specific end keyword
          // Only match if the opener is at the top of the stack (don't skip intervening unclosed blocks)
          const validOpener = OCTAVE_CLOSE_TO_OPEN[closeValue];
          if (validOpener) {
            const foundIndex = findLastOpenerByType(stack, validOpener, true);
            if (foundIndex === stack.length - 1) {
              matchIndex = foundIndex;
            }
          }

          // If no specific match found, only fallback for generic 'end'
          // Generic 'end' should NOT close 'do' blocks (only 'until' can)
          // Only check top of stack - don't skip past unclosed do blocks
          if (matchIndex < 0 && !validOpener && stack.length > 0) {
            if (stack[stack.length - 1].token.value.toLowerCase() !== 'do') {
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

  // Tries to match an excluded region at the given position (overrides parent)
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Block comment: %{ ... %} (MATLAB style, at line start with optional whitespace, no trailing content)
    if (char === '%' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Block comment: #{ ... #} (Octave style, at line start with optional whitespace, no trailing content)
    if (char === '#' && pos + 1 < source.length && source[pos + 1] === '{') {
      if (this.isAtLineStartWithWhitespace(source, pos) && this.isOctaveBlockCommentStart(source, pos)) {
        return this.matchBlockComment(source, pos);
      }
    }

    // Single-line comment: % (MATLAB style)
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-line comment: # (Octave style)
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // String literal: '...' (MATLAB/Octave style)
    if (char === "'") {
      return this.matchOctaveString(source, pos, "'");
    }

    // Double-quoted string: "..."
    if (char === '"') {
      return this.matchOctaveString(source, pos, '"');
    }

    // Line continuation: ... to end of line (treated as comment)
    if (char === '.' && pos + 2 < source.length && source[pos + 1] === '.' && source[pos + 2] === '.') {
      return this.matchSingleLineComment(source, pos);
    }

    // Line continuation: \ followed by optional whitespace and newline
    if (char === '\\') {
      const match = source.slice(pos).match(BACKSLASH_CONTINUATION_PATTERN);
      if (match) {
        return { start: pos, end: pos + match[0].length };
      }
    }

    // Shell escape command: ! to end of line (at statement start — line start or after `;` / `,`).
    // Octave treats `!cmd` as a shell escape just like MATLAB; the parent MATLAB parser uses
    // isAtStatementStart for the same purpose, so we mirror that here. Recognising `!` after
    // `;` / `,` is required so e.g. `y = 1; !ls if true` consumes `if true` inside the shell
    // escape and the outer block pairing is preserved (without it, the inner `if` opens a
    // spurious block that consumes a later `end`).
    if (char === '!' && isAtStatementStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if block comment opener (%{ or #{) has no trailing non-whitespace content.
  // Whitespace is defined by isHorizontalWhitespace above (ASCII space/tab/VT/FF plus
  // Unicode horizontal spaces such as NBSP / U+3000) so that `%{<NBSP>` and `#{<U+3000>`
  // open block comments just like `%{ ` and `#{\t` do.
  private isOctaveBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      if (!isHorizontalWhitespace(source[i])) {
        return false;
      }
      i++;
    }
    return true;
  }

  // Overrides parent to support cross-type delimiters: %{/%} and #{/#} are interchangeable in Octave
  protected override matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;
    let depth = 1;

    while (i < source.length) {
      // Check for nested block comment opener: %{ or #{
      if ((source[i] === '%' || source[i] === '#') && i + 1 < source.length && source[i + 1] === '{') {
        if (this.isAtLineStartWithWhitespace(source, i) && this.isOctaveBlockCommentStart(source, i)) {
          depth++;
          i += 2;
          continue;
        }
      }
      // Check for block comment closer: %} or #}
      if ((source[i] === '%' || source[i] === '#') && i + 1 < source.length && source[i + 1] === '}') {
        if (this.isAtLineStartWithWhitespace(source, i)) {
          let trailingPos = i + 2;
          let hasTrailingContent = false;
          // Whitespace check uses isHorizontalWhitespace so the closer accepts trailing
          // Unicode horizontal spaces (NBSP / U+3000 etc.) symmetrically with the opener
          // (isOctaveBlockCommentStart).
          while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
            if (!isHorizontalWhitespace(source[trailingPos])) {
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

  // Matches string with specified quote character
  private matchOctaveString(source: string, pos: number, quote: string): ExcludedRegion {
    // Check if single quote is a transpose operator (after identifier, number, ], }, or .)
    if (quote === "'" && pos > 0) {
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
        // This `'` sits in a transpose position (it follows a value-like character).
        // The transpose operator cannot be validly followed by an identifier character
        // (ASCII letter / `_` or any Unicode letter): in that case the `'` actually begins
        // a string literal, e.g. `disp'end'` is `disp` followed by the string `'end'`,
        // `disp'θ end'` is `disp` followed by `'θ end'` (θ is a Unicode letter so the `'`
        // is the string opener), and `[1'text']` is `1` followed by `'text'`. Including
        // Unicode letters via `\p{L}` is symmetric with the transpose-eligibility check
        // above (which already accepts a preceding Unicode letter as a value char). The
        // surrogate-pair case is handled explicitly so e.g. `A𝐀'foo'` (𝐀 = U+1D400 Math
        // Bold Cap A, encoded as a surrogate pair) is correctly recognised as a string.
        // `A''` (double transpose) stays transpose because the second `'` is followed by
        // another `'` (not an identifier char).
        const nextChar = pos + 1 < source.length ? source[pos + 1] : undefined;
        const isSurrogateHighStart =
          nextChar !== undefined &&
          nextChar >= '\uD800' &&
          nextChar <= '\uDBFF' &&
          pos + 2 < source.length &&
          (() => {
            const cp = source.codePointAt(pos + 1);
            return cp !== undefined && cp > 0xffff && /\p{L}/u.test(String.fromCodePoint(cp));
          })();
        const isIdentifierLikeNext = nextChar !== undefined && (/[a-zA-Z_]/.test(nextChar) || /\p{L}/u.test(nextChar) || isSurrogateHighStart);
        if (!isIdentifierLikeNext) {
          return { start: pos, end: pos + 1 };
        }
      }
    }

    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\') {
        // Octave supports backslash escapes in double-quoted strings
        if (quote === '"' && i + 1 < source.length) {
          // Handle CRLF: \<CR><LF> should skip both characters
          if (source[i + 1] === '\r' && i + 2 < source.length && source[i + 2] === '\n') {
            i += 3;
          } else {
            i += 2;
          }
          continue;
        }
      }
      if (source[i] === quote) {
        // Doubled quote escape: only for single-quoted strings
        // In double-quoted strings, backslash escapes handle quote embedding
        if (quote === "'" && i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
