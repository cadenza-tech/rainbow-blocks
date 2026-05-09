// Octave block parser: extends MATLAB with # comments, #{ #} block comments, and Octave-specific end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { MatlabBlockParser } from './matlabParser';
import { findLastOpenerByType } from './parserUtils';

// Mapping of Octave-specific close keywords to their valid openers
const LINE_CONTINUATION_PATTERN = /^\.\.\.(?:[^\r\n]*)(?:\r\n|\r|\n)/;
const BACKSLASH_CONTINUATION_PATTERN = /^\\[ \t]*(?:\r\n|\r|\n)/;

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
      // Skip whitespace and line continuations (... or \) between `do` and `(` so
      // `do (args)`, `do ...\n(args)`, and `do \\\n(args)` are also rejected as a
      // function-call form, not a do/until block. Also reject `do[...]` and `do{...}`
      // (indexing / cell-access forms) for the same reason.
      let j = position + keyword.length;
      while (j < source.length) {
        if (source[j] === ' ' || source[j] === '\t') {
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
        break;
      }
      if (j < source.length && (source[j] === '(' || source[j] === '[' || source[j] === '{')) {
        return false;
      }
    }
    if (keyword === 'arguments' && this.isArgumentsFunctionCall(source, position, excludedRegions)) {
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

  // Reject block close keywords used as variable names (end = 5, endif = 1, etc.)
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByAssignment(source, position + keyword.length)) {
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
            } else if (middleValue === 'case' || middleValue === 'otherwise') {
              if (topOpener !== 'switch') break;
              // Reject case after otherwise — switch semantics require otherwise to be last,
              // and reject duplicate otherwise (only one is valid per switch).
              const intermediates = stack[stack.length - 1].intermediates;
              const sawOtherwise = intermediates.some((t) => t.value.toLowerCase() === 'otherwise');
              if (sawOtherwise && (middleValue === 'case' || middleValue === 'otherwise')) break;
            } else if (middleValue === 'catch') {
              if (topOpener !== 'try') break;
            } else if (middleValue === 'unwind_protect_cleanup') {
              if (topOpener !== 'unwind_protect') break;
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

  // Checks if block comment opener (%{ or #{) has no trailing non-whitespace content
  private isOctaveBlockCommentStart(source: string, pos: number): boolean {
    let i = pos + 2;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      if (source[i] !== ' ' && source[i] !== '\t') {
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
          while (trailingPos < source.length && source[trailingPos] !== '\n' && source[trailingPos] !== '\r') {
            if (source[trailingPos] !== ' ' && source[trailingPos] !== '\t') {
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
