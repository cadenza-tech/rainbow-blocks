// Octave block parser: extends MATLAB with # comments, #{ #} block comments, and Octave-specific end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { MatlabBlockParser } from './matlabParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping of Octave-specific close keywords to their valid openers
const LINE_CONTINUATION_PATTERN = /^\.\.\.(?:[^\r\n]*)(?:\r\n|\r|\n)/;
const BACKSLASH_CONTINUATION_PATTERN = /^\\[ \t]*(?:\r\n|\r|\n)/;

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
    if (keyword === 'do') {
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
      // Reject `do .x` (struct field assignment such as `do.x = 1`): the `.`
      // begins a field access, so `do` is a variable name, not a block opener.
      // Treating it as an opener leaves a spurious `do` on the stack and breaks
      // the enclosing block pairing. Exclude `.` that begins `..` so a `...`
      // continuation that was not consumed above (e.g. at EOF without a trailing
      // newline) is not mistaken for field access.
      if (j < source.length && source[j] === '.' && source[j + 1] !== '.') {
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
      // Reject `do` used as a command-syntax argument (`disp do` → `disp('do')`).
      // The pattern is `<identifier> <whitespace> do` at statement start where the
      // identifier is not a recognized keyword. Treating such `do` as a block open
      // destroys outer block pairing because the spurious `do` consumes the real
      // `until` / leaves a phantom block on the stack.
      if (this.isOctaveCommandSyntaxArgument(source, position, excludedRegions)) {
        return false;
      }
    }
    if (keyword === 'arguments' && this.isArgumentsFunctionCall(source, position, excludedRegions)) {
      // Phantom-section tracking: when `arguments(obj);` is rejected as a block opener,
      // the user likely wrote a stray `end` for it. Record the position so matchBlocks
      // can phantom-skip one `end`. Only when the keyword is at line-start (so a stray
      // `end` would be expected to follow on a subsequent line).
      if (this.isAtSectionKeywordLineStart(source, position) && !this.isInsideParensOrBrackets(source, position, excludedRegions)) {
        this.octavePhantomSectionPositions.push(position);
      }
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
    return result;
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
    return (
      nextChar !== '\n' &&
      nextChar !== '\r' &&
      nextChar !== '(' &&
      nextChar !== '%' &&
      nextChar !== ';' &&
      nextChar !== ',' &&
      nextChar !== ':' &&
      !this.isCommentChar(nextChar)
    );
  }

  // Returns true when an Octave keyword (`do`) at position is the argument of a
  // command-syntax invocation, e.g. `disp do`. Mirrors the structure of MATLAB's
  // private isCommandSyntaxArgument but is callable for any keyword (since `do` is
  // Octave-specific — MATLAB excludes it from its own command-syntax detection).
  // Detection collects the full logical line preceding the keyword (following `...`
  // and Octave `\` line continuations) and checks whether the line begins with a
  // non-keyword identifier.
  private isOctaveCommandSyntaxArgument(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    // Require at least one space/tab between the previous token and the keyword.
    if (position <= 0 || (source[position - 1] !== ' ' && source[position - 1] !== '\t')) return false;
    let i = position - 1;
    while (i >= 0) {
      if (source[i] === ' ' || source[i] === '\t') {
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
      while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\u{FEFF}')) j--;
      if (j < 0) return true;
      const ch = source[j];
      if (ch === '\n' || ch === '\r' || ch === ';' || ch === ',') {
        return true;
      }
      i = j;
    }
    return false;
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
    let j = position + 'arguments'.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
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
    const inner = source.slice(j + 1, k).trim();
    // Pattern 1: trailing `;` after `)` (statement-call form, e.g. `arguments(obj);`)
    let after = k + 1;
    while (after < source.length && (source[after] === ' ' || source[after] === '\t' || source[after] === '\v' || source[after] === '\f')) after++;
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

  // Returns true when `end` at `position` is the target of an indexing assignment
  // such as `end(1) = 5;` or `end(idx, j) = expr;`. Detection: directly followed
  // (after whitespace/line-continuation) by `(`, then a balanced run to the matching
  // `)`, then `=` (but not `==`, which is comparison). String/comment regions are
  // skipped via `excludedRegions` while scanning the parens body.
  private isEndIndexingAssignment(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = position + 'end'.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
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
    // After the closing `)`, skip whitespace and check for `=` (but not `==`).
    let after = k + 1;
    while (after < source.length && (source[after] === ' ' || source[after] === '\t')) after++;
    if (after >= source.length || source[after] !== '=') return false;
    if (after + 1 < source.length && source[after + 1] === '=') return false;
    return true;
  }

  // Reject block close keywords used as variable names (end = 5, endif = 1, etc.)
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
      return false;
    }
    // Reject `end(<expr>) = <value>` indexing-assignment form: `end` here is a
    // variable name being indexed and assigned, not a block close. Without this,
    // the indexed-end consumes an outer block opener and the trailing real `end`
    // becomes orphan. Only applies to bare `end` (typed closes like `endif` are
    // already constrained by isAtStatementLeadingPosition).
    if (keyword.toLowerCase() === 'end' && this.isEndIndexingAssignment(source, position, excludedRegions)) {
      return false;
    }
    // Reject typed-end keywords (endif/endfor/endwhile/etc.) used as identifiers in
    // expression context (e.g., `if endif == 5`). When the keyword does not appear at
    // the start of a statement, it is being used as a variable/identifier rather than
    // closing a block.
    const lowerKw = keyword.toLowerCase();
    const isTypedClose = (lowerKw !== 'end' && lowerKw.startsWith('end')) || lowerKw === 'until';
    if (isTypedClose && !this.isAtStatementLeadingPosition(source, position, excludedRegions)) {
      return false;
    }
    // Typed-end keywords (endif/endfor/endwhile/...) must be the only token on their
    // statement: anything other than a separator (newline / EOF / `;` / `,`) or a comment
    // immediately after rejects them as a block close (e.g., `endif()`, `endif x = 5`).
    // `until` is excluded because it requires a condition expression (`until cond`).
    if (isTypedClose && lowerKw !== 'until') {
      let after = position + keyword.length;
      while (after < source.length && (source[after] === ' ' || source[after] === '\t' || source[after] === '\v' || source[after] === '\f')) after++;
      if (after < source.length) {
        const ch = source[after];
        if (ch !== '\n' && ch !== '\r' && ch !== ';' && ch !== ',' && ch !== '%' && ch !== '#') {
          return false;
        }
      }
    }
    return super.isValidBlockClose(keyword, source, position, excludedRegions);
  }

  // Returns true when the position is at the start of a statement (line start, after
  // a `;`/`,` separator, or at the beginning of the source). When the previous line
  // ended with a `...` or `\` continuation, the current line is logically a continuation
  // of the previous statement, so a typed-end keyword there is mid-expression, not leading.
  // `...` or `\` appearing inside an excluded region (comment / string) is not a real
  // continuation — it is just text — so it is ignored.
  private isAtStatementLeadingPosition(source: string, position: number, excludedRegions?: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\v' || source[i] === '\f')) i--;
    if (i < 0) return true;
    const ch = source[i];
    if (ch === ';' || ch === ',') return true;
    if (ch === '\n' || ch === '\r') {
      // Walk past the newline to check whether the previous physical line ended with
      // `...` or `\` continuation (which would make `position` mid-expression).
      let nlEnd = i;
      if (ch === '\n' && i > 0 && source[i - 1] === '\r') nlEnd = i - 1;
      let scan = nlEnd - 1;
      while (scan >= 0 && (source[scan] === ' ' || source[scan] === '\t' || source[scan] === '\v' || source[scan] === '\f')) scan--;
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
      if (source[i] === ' ' || source[i] === '\t') {
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
    // Track stack depths at which an `arguments` opener was rejected so the matching
    // `end` (at the same depth) is skipped instead of closing an outer block.
    const pendingSkipDepths: number[] = [];
    // Snapshot phantom section positions and process them in order. Each phantom
    // represents a section keyword that was rejected at tokenize but where the user
    // probably wrote a stray `end` to close it. We skip one `end` per phantom — but
    // only when doing so doesn't leave a real opener unmatched (defensive: prefer
    // pairing real openers with real closes).
    const phantomPositions = [...this.octavePhantomSectionPositions];
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
              pendingSkipDepths.push(stack.length);
              break;
            }
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
          // Skip this `end` if it corresponds to a rejected `arguments` opener at this depth.
          if (pendingSkipDepths.length > 0 && pendingSkipDepths[pendingSkipDepths.length - 1] === stack.length) {
            pendingSkipDepths.pop();
            break;
          }
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

    // Shell escape command: ! to end of line (only at line start)
    if (char === '!' && this.isAtLineStartWithWhitespace(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    return null;
  }

  // Checks if block comment opener (%{ or #{) has no trailing non-whitespace content.
  // Treats space, tab, vertical tab (\v = \x0B), and form feed (\f = \x0C) as whitespace
  // (symmetric with MATLAB's isBlockCommentStart).
  private isOctaveBlockCommentStart(source: string, pos: number): boolean {
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
          // Treat space, tab, vertical tab (\v = \x0B), and form feed (\f = \x0C) as whitespace
          // (symmetric with MATLAB's matchBlockComment).
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
        // After a digit, check if ' starts a string (e.g., [1'text'])
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
