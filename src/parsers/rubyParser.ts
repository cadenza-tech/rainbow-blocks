// Ruby block parser: handles heredocs, percent literals, regex, symbols, and postfix conditionals

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { matchHeredoc, matchMultiLineComment } from './rubyExcluded';
import type { HeredocState, InterpolationHandlers } from './rubyFamilyHelpers';
import {
  isRegexStart,
  matchBacktickString,
  matchInterpolatedString,
  matchPercentLiteral,
  matchRegexLiteral,
  skipInterpolationShared,
  skipNestedBacktickString,
  skipNestedRegex,
  skipNestedString
} from './rubyFamilyHelpers';
import type { RubyValidationCallbacks } from './rubyValidation';
import {
  isDotPreceded as isDotPrecededShared,
  isEndlessMethodDef as isEndlessMethodDefShared,
  isLoopDo as isLoopDoShared,
  isPostfixConditional as isPostfixConditionalShared,
  isPostfixRescue as isPostfixRescueShared
} from './rubyValidation';

// Valid Ruby regex flags
const REGEX_FLAGS_PATTERN = /[imxonesu]/;

// Valid specifiers for percent literals
const PERCENT_SPECIFIERS_PATTERN = /[qQwWiIrsx]/;

// Keywords after which / starts a regex, not division.
// Includes true control keywords (`if`, `unless`, ...) plus method-like keywords
// (`puts`, `p`, `raise`, ...) that often take a regex literal as the first argument.
// The method-like subset is also listed in METHOD_LIKE_REGEX_KEYWORDS so that
// `isRegexStart` only treats them as regex starters under the method-call spacing rule
// (`puts /re/` is regex, `puts / 2` is division).
const REGEX_PRECEDING_KEYWORDS = new Set([
  'if',
  'unless',
  'while',
  'until',
  'when',
  'case',
  'and',
  'or',
  'not',
  'return',
  'yield',
  'puts',
  'print',
  'p',
  'pp',
  'warn',
  'fail',
  'abort',
  'raise',
  'in',
  'then',
  'else',
  'elsif',
  'do',
  'begin',
  'rescue',
  'ensure'
]);

// Method-like identifiers that double as keywords here but are really method names.
// For these, `/` after whitespace is division by default; only `ident /regex/` (no
// space after `/`) is treated as a regex argument.
const METHOD_LIKE_REGEX_KEYWORDS = new Set(['p', 'pp', 'puts', 'print', 'warn', 'fail', 'abort', 'raise']);

// Open keywords whose blocks can take a `then` clause separator.
// `then` is only a section boundary for if/unless/while/until/case. In
// def/class/module/begin/for/do/while-until bodies a bare `then` is not a
// syntactic element, so it must not be collected as an intermediate.
const THEN_TAKING_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['if', 'unless', 'while', 'until', 'case']);

// Open keywords whose blocks can take a `when` branch. `when` belongs to `case`
// only. A bare `when` inside a do/loop/def/... body is not a syntactic element,
// so it must not be collected as an intermediate.
const WHEN_TAKING_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['case']);

// Open keywords whose blocks can take an `else` clause. `else` belongs to
// if/unless (conditional), case (after when), and begin (after rescue, runs when
// no exception). while/until/for loops and def/class/module do not take `else`.
const ELSE_TAKING_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['if', 'unless', 'case', 'begin']);

// Open keywords whose blocks can take an `elsif` clause. `elsif` belongs to
// if/unless only.
const ELSIF_TAKING_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['if', 'unless']);

// Open keywords whose blocks can take a bare `rescue`/`ensure` clause. These are
// valid directly inside begin/def/class/module bodies, and inside `do...end`
// blocks (Ruby 2.6+). A bare `rescue`/`ensure` in a while/until/for/case body is
// a syntax error, so it must not be collected as an intermediate.
const RESCUE_ENSURE_TAKING_OPEN_KEYWORDS: ReadonlySet<string> = new Set(['begin', 'def', 'class', 'module', 'do']);

// Ruby interpolation check: %q, %w, %i, %s do not interpolate
function isRubyInterpolatingPercent(_specifier: string, hasSpecifier: boolean): boolean {
  if (!hasSpecifier) return true;
  return !/[qwis]/.test(_specifier);
}

// Unicode identifier-continuation character class: Letter (L), Mark (M), Number (N),
// and Connector Punctuation (Pc). Ruby permits non-ASCII characters in identifiers.
const UNICODE_IDENT_CONTINUE_PATTERN = /[\p{L}\p{M}\p{N}\p{Pc}]/u;

// Checks whether the character ending at index `pos` (inclusive) is an identifier
// character: an ASCII identifier char ([a-zA-Z0-9_]) or a Unicode identifier-continuation
// character (handling surrogate pairs for codepoints outside the BMP). Used to decide
// whether a 'def' substring is a standalone keyword or part of a larger identifier.
function endsWithIdentifierChar(source: string, pos: number): boolean {
  if (pos < 0) return false;
  const ch = source[pos];
  if (/[a-zA-Z0-9_]/.test(ch)) return true;
  if (/\w/.test(ch)) return false;
  // Low surrogate: combine with preceding high surrogate to test the full codepoint
  if (pos >= 1 && ch >= '\uDC00' && ch <= '\uDFFF') {
    const cp = source.codePointAt(pos - 1);
    if (cp !== undefined && cp > 0xffff) {
      return UNICODE_IDENT_CONTINUE_PATTERN.test(String.fromCodePoint(cp));
    }
  }
  return UNICODE_IDENT_CONTINUE_PATTERN.test(ch);
}

export class RubyBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['do', 'if', 'unless', 'while', 'until', 'begin', 'def', 'class', 'module', 'case', 'for'],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'rescue', 'ensure', 'when', 'in', 'then']
  };

  // Tracks the last excluded region found during findExcludedRegions scanning,
  // so tryMatchExcludedRegion can avoid misinterpreting characters inside prior regions
  private _lastExcludedRegion: ExcludedRegion | null = null;

  private get validationCallbacks(): RubyValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Skip 'in' intermediate when attached to 'for' (for x in collection)
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topKeyword = stack[stack.length - 1].token.value;
            // 'in' is only a true intermediate inside `case` (Ruby 3.0+ pattern matching).
            // In `for x in collection` it is a syntactic separator (skip).
            // In `if/unless/while/until/begin/...` it is the pattern-matching operator
            // (Ruby 3.0+, e.g. `if x in 1`), also not a section boundary -- skip.
            if (token.value === 'in' && topKeyword !== 'case') {
              break;
            }
            // 'then' is a clause separator only for if/unless/while/until/case. A bare
            // 'then' inside a def/class/module/begin/for/do body is not a syntactic
            // element, so it must not be attached as an intermediate.
            if (token.value === 'then' && !THEN_TAKING_OPEN_KEYWORDS.has(topKeyword)) {
              break;
            }
            // 'when' belongs to `case` only; 'else'/'elsif' belong to conditional and
            // related blocks. A bare 'when'/'else'/'elsif' inside a do/loop/def/...
            // body is not a syntactic element of that block, so it must not be attached
            // as an intermediate.
            if (token.value === 'when' && !WHEN_TAKING_OPEN_KEYWORDS.has(topKeyword)) {
              break;
            }
            if (token.value === 'else' && !ELSE_TAKING_OPEN_KEYWORDS.has(topKeyword)) {
              break;
            }
            if (token.value === 'elsif' && !ELSIF_TAKING_OPEN_KEYWORDS.has(topKeyword)) {
              break;
            }
            // 'rescue'/'ensure' are valid directly in begin/def/class/module bodies and
            // in do...end blocks (Ruby 2.6+). A bare 'rescue'/'ensure' inside a
            // while/until/for/case body is a syntax error, so it must not be attached as
            // an intermediate.
            if ((token.value === 'rescue' || token.value === 'ensure') && !RESCUE_ENSURE_TAKING_OPEN_KEYWORDS.has(topKeyword)) {
              break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
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

  // Validates block open keywords, excluding postfix conditionals
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords preceded by dot (method calls like obj.class, obj. begin)
    // But allow range operator (..) — x..end is valid
    if (this.isDotPreceded(source, position, excludedRegions)) {
      return false;
    }

    // Check if 'do' is a loop separator (while/until/for ... do)
    if (keyword === 'do') {
      return !this.isLoopDo(source, position, excludedRegions);
    }

    // Reject Ruby 3.0+ endless method definitions (e.g., `def foo = expr`)
    // which have no matching `end`.
    if (keyword === 'def') {
      if (this.isEndlessMethodDef(source, position + keyword.length, excludedRegions)) {
        return false;
      }
    }

    // Only if, unless, while, until can be postfix conditionals
    if (!['if', 'unless', 'while', 'until'].includes(keyword)) {
      return true;
    }

    return !this.isPostfixConditional(source, position, excludedRegions);
  }

  private isEndlessMethodDef(source: string, start: number, excludedRegions: ExcludedRegion[]): boolean {
    return isEndlessMethodDefShared(source, start, excludedRegions, this.validationCallbacks);
  }

  // Filters out keywords used as hash keys, rescue modifiers, and method calls
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);

    return tokens.filter((token) => {
      // Filter out keywords in heredoc identifiers (<<end, <<-do, <<~if, <<'end', <<"do", etc.)
      // Only filter when the << is actually a heredoc, not a shift operator. We confirm by
      // re-running matchHeredoc at the << position rather than guessing from neighbouring
      // excluded regions (a column-0 #-comment or quoted string on the next line can
      // accidentally start exactly at the heredoc contentStart and produce a false positive).
      if (token.startOffset >= 2) {
        const prefixStart = Math.max(0, token.startOffset - 4);
        const prefix = source.slice(prefixStart, token.startOffset);
        if (/<<[~-]?['"`]?$/.test(prefix)) {
          const ltLtPosInPrefix = prefix.indexOf('<<');
          const ltLtPos = prefixStart + ltLtPosInPrefix;
          const heredocResult = matchHeredoc(source, ltLtPos);
          // Find the position after the opener line's newline (heredoc body start)
          let lineEnd = token.endOffset;
          // Skip past optional closing quote of the heredoc identifier
          if (lineEnd < source.length && (source[lineEnd] === "'" || source[lineEnd] === '"' || source[lineEnd] === '`')) {
            lineEnd++;
          }
          // Find the actual end of the line
          while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
            lineEnd++;
          }
          // Calculate contentStart (position after newline)
          let contentStart = lineEnd;
          if (contentStart < source.length) {
            if (source[contentStart] === '\r' && contentStart + 1 < source.length && source[contentStart + 1] === '\n') {
              contentStart += 2;
            } else {
              contentStart++;
            }
          }
          // Only filter when matchHeredoc confirms a real heredoc whose body starts at the
          // computed contentStart. If matchHeredoc returns null (shift operator) or the body
          // start does not match, the keyword is on the operator's line and must remain.
          if (heredocResult !== null && heredocResult.contentStart === contentStart) {
            return false;
          }
        }
      }
      // Filter out dot-preceded tokens (method calls like obj.end, obj. class)
      // The range operator (..) is excluded by isDotPreceded, but we still need to
      // reject `end` after `..` / `...`: `end` is a Ruby keyword and cannot be the
      // RHS of a range expression. Treating it as block_close mis-pairs surrounding
      // blocks (e.g., `for x in (1..end)\n  ...\nend` would pair the inner end with for).
      if (this.isDotPreceded(source, token.startOffset, excludedRegions)) {
        return false;
      }
      if (token.value === 'end' && this.isPrecededByRangeOperator(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Filter out `end` placed in the value position of a ternary expression
      // (`cond ? a : end`). `end` is a reserved word and cannot be a value, so this
      // is invalid syntax; treating it as block_close mis-pairs surrounding blocks.
      if (token.value === 'end' && this.isEndInTernaryValuePosition(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Filter out `end` directly preceded by an opening bracket or a binary operator
      // on the same physical line (skipping whitespace and excluded regions like comments
      // or regex literals). `end` is a reserved word and cannot be in expression position,
      // so cases like `def foo(end)` or `x = /pat/ end` are invalid Ruby. Treating them
      // as block_close mis-pairs surrounding blocks; per the anchor-set principle, drop
      // the stray `end` so blocks pair correctly.
      if (token.value === 'end' && this.isEndInExpressionPosition(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Filter out keywords used as method names after 'def' (e.g., def do, def begin, def end)
      if (this.isAfterDefKeyword(source, token.startOffset)) {
        return false;
      }
      // Filter out :: scope resolution (e.g., Module::Class::Begin)
      if (token.startOffset > 1 && source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':') {
        return false;
      }
      // Filter out keyword followed by :: (e.g., class::Method, module::Nested)
      // But allow end:: because end::to_s means "close the block, then call method on result"
      const afterEnd = token.endOffset;
      if (token.type !== 'block_close' && afterEnd + 1 < source.length && source[afterEnd] === ':' && source[afterEnd + 1] === ':') {
        return false;
      }
      // Filter out keywords preceded by $ or @ (variable names like $end, @end, @@end)
      if (token.startOffset > 0 && (source[token.startOffset - 1] === '$' || source[token.startOffset - 1] === '@')) {
        return false;
      }
      // Filter out =end / =begin only when `=` is at the start of a line. The `=begin`/
      // `=end` multi-line comment markers must appear at column 0 per Ruby spec.
      // Inline `x=begin\n...\nend` is a valid begin-block assignment and must not be filtered.
      if (token.startOffset > 0 && source[token.startOffset - 1] === '=' && (token.value === 'end' || token.value === 'begin')) {
        const eqPos = token.startOffset - 1;
        const isLineStart = eqPos === 0 || source[eqPos - 1] === '\n' || source[eqPos - 1] === '\r';
        if (isLineStart) {
          return false;
        }
      }
      // Filter out tokens immediately followed by colon (hash key syntax)
      // But not :: (scope resolution operator)
      if (source[token.endOffset] === ':' && source[token.endOffset + 1] !== ':') {
        return false;
      }
      // Filter out keywords followed by ? (method names like end?, begin?)
      const afterChar = source[token.endOffset];
      if (afterChar === '?') {
        return false;
      }
      // Filter out keywords followed by = but not ==, =~, => (method names like do=, end=)
      if (afterChar === '=') {
        const afterAfter = source[token.endOffset + 1];
        if (afterAfter !== '=' && afterAfter !== '~' && afterAfter !== '>') {
          return false;
        }
      }
      // Filter out keywords followed by ! but not != (method names like end!, begin!)
      if (afterChar === '!') {
        if (token.endOffset + 1 >= source.length || source[token.endOffset + 1] !== '=') {
          return false;
        }
      }
      // Filter out postfix rescue modifier (e.g., risky rescue nil)
      if (token.type === 'block_middle' && token.value === 'rescue') {
        return !this.isPostfixRescue(source, token.startOffset, excludedRegions);
      }
      return true;
    });
  }

  // Checks if keyword is used as a method name after 'def' (e.g., def do, def begin, def end).
  // Recognizes backslash line continuation: `def \<NL>do` is `def do` (a method named 'do').
  private isAfterDefKeyword(source: string, position: number): boolean {
    let i = position - 1;
    while (i >= 0) {
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      // Backslash line continuation: a newline preceded by an odd number of backslashes
      // is a line continuation. Step past the newline and the trailing backslash.
      if (ch === '\n' || ch === '\r') {
        let nlStart = i;
        if (ch === '\n' && i > 0 && source[i - 1] === '\r') {
          nlStart = i - 1;
        }
        let bs = nlStart - 1;
        let count = 0;
        while (bs >= 0 && source[bs] === '\\') {
          count++;
          bs--;
        }
        if (count % 2 === 1) {
          i = bs;
          continue;
        }
        break;
      }
      break;
    }
    if (i >= 2 && source.slice(i - 2, i + 1) === 'def') {
      const defStart = i - 2;
      // 'def' is a standalone keyword only when not preceded by an identifier
      // character. The preceding char must be checked against the full Unicode
      // identifier set: Ruby allows non-ASCII identifiers (e.g. `fooαdef` is a
      // single identifier, not the keyword `def`).
      return defStart === 0 || !endsWithIdentifierChar(source, defStart - 1);
    }
    return false;
  }

  private isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPostfixRescueShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isPostfixConditionalShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isLoopDoShared(source, position, excludedRegions, this.validationCallbacks);
  }

  private isDotPreceded(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isDotPrecededShared(source, position, excludedRegions, this.validationCallbacks);
  }

  // Checks if the keyword at position is immediately preceded by a range operator
  // (.. or ...). Whitespace is permitted between the operator and the keyword (e.g.,
  // `(1.. end)` would also be invalid Ruby). Skips characters inside excluded regions.
  private isPrecededByRangeOperator(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      break;
    }
    // Need at least two consecutive dots to form .. (or ...)
    if (i < 1 || source[i] !== '.' || source[i - 1] !== '.') {
      return false;
    }
    return true;
  }

  // Checks if `end` at position sits in the value position of a ternary expression
  // (`cond ? value : end`, including the multi-line form where the colon and `end`
  // are on separate lines). Such an `end` is preceded by a standalone ternary colon:
  // a `:` surrounded by whitespace, not part of `::` (scope resolution) and not a
  // `label:`/symbol colon, with a matching ternary `?` earlier on the colon's line.
  // Whitespace, newlines, and excluded regions are skipped while scanning back to the
  // colon (the value can wrap onto the next line). Excluded regions are skipped.
  private isEndInTernaryValuePosition(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Scan back from `end`, skipping whitespace, newlines, and excluded regions, to the
    // colon. Newlines are skipped because the value can sit on a line after the colon.
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    // The character immediately before `end` must be a colon
    if (i < 0 || source[i] !== ':') {
      return false;
    }
    // Reject scope resolution `::` (colon adjacent to another colon on either side)
    if (source[i - 1] === ':' || source[i + 1] === ':') {
      return false;
    }
    // A ternary colon is whitespace-surrounded; a `label:`/symbol colon is glued to
    // its identifier. Require whitespace immediately before the colon.
    const beforeColon = source[i - 1];
    if (beforeColon === undefined || !(beforeColon === ' ' || beforeColon === '\t')) {
      return false;
    }
    // Look for a matching ternary `?` earlier on the same line (stop at newline,
    // statement separator `;`, or start of source). Skip excluded regions so that
    // `?x` character literals and `?` inside strings/comments are ignored.
    for (let j = i - 1; j >= 0; j--) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start;
          continue;
        }
      }
      const ch = source[j];
      if (ch === '\n' || ch === '\r' || ch === ';') {
        return false;
      }
      if (ch === '?') {
        return true;
      }
    }
    return false;
  }

  // Checks if `end` at position is in expression value position on the same physical line:
  // immediately preceded (skipping spaces/tabs and excluded regions) by an opening bracket
  // (`(`, `[`, `{`) or a binary operator (`=` not part of `==`/`=~`/`=>`, `,`, `+`, `-`,
  // `*`, `/`, `%`, `<`, `>`, `&`, `|`, `^`, `~`, `!`). Since `end` is a reserved word and
  // cannot appear in expression position, such occurrences are invalid Ruby — e.g.,
  // `def foo(end)`, `[end]`, `x = /pat/ end`, `x = end`. The scan stops at the physical
  // line start (`\n`, `\r`) or at a `;`, both of which are valid statement separators
  // after which `end` is legitimate.
  private isEndInExpressionPosition(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          // If this is the first non-whitespace content encountered, treat the region's
          // ending position as the previous "token". For example, `/pat/ end` ends with
          // a regex literal — `end` follows it directly, so we must check what precedes
          // the regex region.
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    const ch = source[i];
    // Statement separators: `;`, `\n`, `\r`. `end` is legitimate here.
    if (ch === ';' || ch === '\n' || ch === '\r') {
      return false;
    }
    // Opening brackets directly before `end`: definitely expression position.
    if (ch === '(' || ch === '[' || ch === '{') {
      return true;
    }
    // Binary operators / separators directly before `end`: expression position.
    if (ch === ',' || ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      return true;
    }
    if (ch === '<' || ch === '>' || ch === '&' || ch === '|' || ch === '^' || ch === '~') {
      return true;
    }
    if (ch === '!') {
      // `!end` is invalid (unary not applied to reserved word in value position)
      return true;
    }
    if (ch === '=') {
      // `=` is a binary operator (assignment). `==`, `=~`, `=>` are handled because
      // they end with `=`, `~`, `>` respectively — but the character at `i` is the
      // trailing character of any multi-char operator. So `==` and `=~`, `=>` end with
      // a non-`=` char... wait, `==` ends with `=`. Need to distinguish.
      // - `==`/`!=`: last char is `=` and prev char is `=` or `!` → still operator → expression position
      // - `=~`: last char is `~`, already covered above
      // - `=>`: last char is `>`, already covered above
      // So bare `=` (assignment) ends with `=`. We need to check that we're not looking
      // at the trailing `=` of `==`/`!=`/`<=`/`>=`. In all of these the previous char is
      // also an operator char that we've already classified as expression position. So
      // returning true here is safe (assignment is also expression position).
      return true;
    }
    return false;
  }

  // Finds excluded regions: comments, strings, regex, heredocs, percent literals, symbols
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    this._lastExcludedRegion = null;
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        // If region starts after current position (heredoc opener line gap),
        // scan the gap for excluded regions (comments, strings)
        if (result.start > i) {
          let j = i + 1;
          while (j < result.start) {
            // Skip '<' to avoid re-matching heredoc
            if (source[j] === '<') {
              j++;
              continue;
            }
            const gapResult = this.tryMatchExcludedRegion(source, j);
            if (gapResult) {
              const gapRegion = {
                start: gapResult.start,
                end: Math.min(gapResult.end, result.start)
              };
              regions.push(gapRegion);
              this._lastExcludedRegion = gapRegion;
              j = gapResult.end;
            } else {
              j++;
            }
          }
        }
        regions.push(result);
        this._lastExcludedRegion = result;
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // __END__ marker: everything after is data
    if (char === '_' && this.isAtLineStart(source, pos)) {
      if (source.slice(pos, pos + 7) === '__END__') {
        const afterEnd = source[pos + 7];
        if (afterEnd === undefined || afterEnd === '\n' || afterEnd === '\r' || afterEnd === ' ' || afterEnd === '\t') {
          return { start: pos, end: source.length };
        }
      }
    }

    // Ruby character literal: ?x (must check before #, ", ' to prevent false matches)
    if (char === '?' && pos + 1 < source.length) {
      if (pos === 0 || !/[a-zA-Z0-9_)\]}"'`]/.test(source[pos - 1])) {
        const nextChar = source[pos + 1];
        if (nextChar === '\\' && pos + 2 < source.length) {
          const escChar = source[pos + 2];
          // \C-x, \M-x (5 chars total: ?\C-x), \M-\C-x (8 chars total: ?\M-\C-x).
          // The trailing target char must be a non-newline (printable); otherwise the
          // literal is unterminated and ends at the last `-`.
          if ((escChar === 'C' || escChar === 'M') && pos + 3 < source.length && source[pos + 3] === '-') {
            if (
              escChar === 'M' &&
              pos + 4 < source.length &&
              source[pos + 4] === '\\' &&
              pos + 5 < source.length &&
              source[pos + 5] === 'C' &&
              pos + 6 < source.length &&
              source[pos + 6] === '-'
            ) {
              // Full \M-\C-x (8 chars): require pos+7 to be a printable, non-newline char
              if (pos + 7 < source.length && source[pos + 7] !== '\n' && source[pos + 7] !== '\r') {
                // If target is a backslash, include the escape sequence char (e.g., ?\M-\C-\n is 9 chars)
                if (source[pos + 7] === '\\' && pos + 8 < source.length && source[pos + 8] !== '\n' && source[pos + 8] !== '\r') {
                  return { start: pos, end: pos + 9 };
                }
                return { start: pos, end: pos + 8 };
              }
              return { start: pos, end: pos + 7 };
            }
            // \C-x or \M-x: require pos+4 to be a printable, non-newline char
            if (pos + 4 < source.length && source[pos + 4] !== '\n' && source[pos + 4] !== '\r') {
              // If target is a backslash, include the escape sequence char (e.g., ?\C-\n is 6 chars)
              if (source[pos + 4] === '\\' && pos + 5 < source.length && source[pos + 5] !== '\n' && source[pos + 5] !== '\r') {
                return { start: pos, end: pos + 6 };
              }
              return { start: pos, end: pos + 5 };
            }
            return { start: pos, end: pos + 4 };
          }
          // \uXXXX (7 chars: ?\uXXXX) or \u{...} (variable)
          if (escChar === 'u') {
            if (pos + 3 < source.length && source[pos + 3] === '{') {
              // Scan for closing } but stop at line break to avoid scanning entire source
              let closeIdx = -1;
              for (let ci = pos + 4; ci < source.length; ci++) {
                if (source[ci] === '}') {
                  closeIdx = ci;
                  break;
                }
                if (source[ci] === '\n' || source[ci] === '\r') {
                  break;
                }
              }
              return { start: pos, end: closeIdx >= 0 ? closeIdx + 1 : pos + 4 };
            }
            // Scan up to 4 hex digits, stopping at newlines and non-hex characters
            let uEnd = pos + 3;
            const uMax = Math.min(pos + 7, source.length);
            while (uEnd < uMax && /[0-9a-fA-F]/.test(source[uEnd]) && source[uEnd] !== '\n' && source[uEnd] !== '\r') {
              uEnd++;
            }
            return { start: pos, end: uEnd };
          }
          // \xN or \xNN (4 or 5 chars: ?\xN or ?\xNN)
          if (escChar === 'x') {
            // Scan up to 2 hex digits, stopping at newlines and non-hex characters
            let hexEnd = pos + 3;
            const hexMax = Math.min(pos + 5, source.length);
            while (hexEnd < hexMax && /[0-9a-fA-F]/.test(source[hexEnd]) && source[hexEnd] !== '\n' && source[hexEnd] !== '\r') {
              hexEnd++;
            }
            return { start: pos, end: hexEnd };
          }
          return { start: pos, end: pos + 3 };
        }
        if (nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r') {
          // Handle surrogate pairs (codepoints > U+FFFF use 2 UTF-16 code units)
          const codePoint = source.codePointAt(pos + 1);
          const charLen = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
          return { start: pos, end: pos + 1 + charLen };
        }
      }
    }

    // Single-line comment
    if (char === '#') {
      return this.matchSingleLineComment(source, pos);
    }

    // Multi-line comment: =begin ... =end
    if (char === '=' && this.isAtLineStart(source, pos)) {
      const region = matchMultiLineComment(source, pos);
      if (region) return region;
    }

    // $', $", $` are global variables, not string/backtick starts
    if (pos > 0 && source[pos - 1] === '$' && (char === '"' || char === "'" || char === '`')) {
      const dollarInLastRegion =
        this._lastExcludedRegion !== null && pos - 1 >= this._lastExcludedRegion.start && pos - 1 < this._lastExcludedRegion.end;
      // Skip if $ is inside previous excluded region (e.g., ?$ char literal)
      // or if preceded by another $ not in excluded region ($$ global variable)
      if (!dollarInLastRegion && !(pos >= 2 && source[pos - 2] === '$' && !this.isPrevCharInLastRegion(pos - 2))) {
        return { start: pos, end: pos + 1 };
      }
    }

    // Double-quoted string (with #{} interpolation support)
    if (char === '"') {
      return this.matchInterpolatedString(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchQuotedString(source, pos, "'");
    }

    // Regex literal
    if (char === '/' && this.isRegexStart(source, pos)) {
      return this.matchRegexLiteral(source, pos);
    }

    // Heredoc
    if (char === '<' && pos + 1 < source.length && source[pos + 1] === '<') {
      const result = matchHeredoc(source, pos);
      if (result) return { start: result.contentStart, end: result.end };
    }

    // Percent literals (skip modulo operator: number/identifier % delimiter)
    if (char === '%' && pos + 1 < source.length && !this.isModuloOperator(source, pos)) {
      const result = this.matchPercentLiteral(source, pos);
      if (result) return { start: pos, end: result.end };
    }

    // Symbol literal
    if (char === ':' && this.isSymbolStart(source, pos)) {
      return this.matchSymbolLiteral(source, pos);
    }

    // Backtick string (command) with #{} interpolation support
    if (char === '`') {
      // Backtick can also be a method name: `def ` (cmd) ... end`, `obj.\`(...)`, `::\``
      if (this.isBacktickMethodName(source, pos)) return null;
      return this.matchBacktickString(source, pos);
    }

    return null;
  }

  // Checks if backtick at pos is being used as a method name rather than a string opener
  private isBacktickMethodName(source: string, pos: number): boolean {
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) i--;
    if (i < 0) return false;
    // Method call: obj.`, obj&.`
    if (source[i] === '.') return true;
    // Scope resolution: ClassName::`
    if (source[i] === ':' && i > 0 && source[i - 1] === ':') return true;
    // Method definition: def `
    if (i >= 2 && source.slice(i - 2, i + 1) === 'def') {
      if (i === 2 || !/[a-zA-Z0-9_]/.test(source[i - 3])) {
        return true;
      }
    }
    return false;
  }

  // Checks if colon starts a symbol (not ternary, hash key, or scope resolution)
  private isSymbolStart(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    if (!nextChar) {
      return false;
    }

    // Symbol must start with letter, underscore, quote, or operator character
    // Operator symbols: :+, :-, :*, :/, :%, :**, :<, :>, :<=, :>=, :==, :===,
    // :<=>, :!=, :=~, :!~, :&, :|, :^, :~, :<<, :>>, :[], :[]=, :-@, :+@, :`
    if (!/[a-zA-Z_"'+\-*/%<>=!~&|^[`]/.test(nextChar)) {
      return false;
    }

    // Colon after another colon is scope resolution (::), not symbol
    if (pos > 0 && source[pos - 1] === ':') {
      return false;
    }

    // Colon after identifier/number/bracket is ternary, not symbol
    if (pos > 0) {
      const prevChar = source[pos - 1];
      if (/[a-zA-Z0-9_)\]}]/.test(prevChar)) {
        return false;
      }
    }

    return true;
  }

  // Matches symbol literal: :symbol, :"quoted", :'quoted'
  private matchSymbolLiteral(source: string, pos: number): ExcludedRegion {
    const nextChar = source[pos + 1];

    // Double-quoted symbol with interpolation support (propagate heredocState)
    if (nextChar === '"') {
      const heredocState: HeredocState = { pendingEnd: -1 };
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          i = skipInterpolationShared(source, i + 2, this.interpolationHandlers, heredocState);
          continue;
        }
        if (source[i] === '"') {
          const end = i + 1;
          if (heredocState.pendingEnd > end) {
            return { start: pos, end: heredocState.pendingEnd };
          }
          return { start: pos, end };
        }
        i++;
      }
      if (heredocState.pendingEnd > i) {
        return { start: pos, end: heredocState.pendingEnd };
      }
      return { start: pos, end: i };
    }

    // Single-quoted symbol (no interpolation)
    if (nextChar === "'") {
      let i = pos + 2;
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          return { start: pos, end: i + 1 };
        }
        i++;
      }
      return { start: pos, end: i };
    }

    // Operator symbol: :+, :-, :*, :/, :%, :**, :<, :>, :<=, :>=, :==, :===,
    // :<=>, :!=, :=~, :!~, :&, :|, :^, :~, :<<, :>>, :[], :[]=, :-@, :+@, :`
    if (/[+\-*/%<>=!~&|^[`]/.test(nextChar)) {
      if (nextChar === '`') return { start: pos, end: pos + 2 };
      if (nextChar === '[') {
        let i = pos + 2;
        if (i < source.length && source[i] === ']') {
          i++;
          if (i < source.length && source[i] === '=') i++;
        }
        return { start: pos, end: i };
      }
      let i = pos + 2;
      while (i < source.length && /[+\-*/%<>=!~&|^@]/.test(source[i])) {
        i++;
      }
      return { start: pos, end: i };
    }

    // Simple symbol
    let i = pos + 1;
    while (i < source.length) {
      const char = source[i];
      if (/[a-zA-Z0-9_]/.test(char)) {
        i++;
        continue;
      }
      // ? and ! can only appear at the end of a symbol name
      if (char === '?' || char === '!') {
        i++;
        break;
      }
      break;
    }

    return { start: pos, end: i };
  }

  // Matches regex literal with flags and #{} interpolation (including heredoc support)
  private matchRegexLiteral(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchRegexLiteral(
      source,
      pos,
      REGEX_FLAGS_PATTERN,
      (s, p) => {
        return skipInterpolationShared(s, p, this.interpolationHandlers, heredocState);
      },
      true
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Checks if slash is regex start (not division)
  private isRegexStart(source: string, pos: number): boolean {
    return isRegexStart(source, pos, REGEX_PRECEDING_KEYWORDS, this._lastExcludedRegion ?? undefined, METHOD_LIKE_REGEX_KEYWORDS);
  }

  // Checks if position is inside the last excluded region
  private isPrevCharInLastRegion(charPos: number): boolean {
    return this._lastExcludedRegion !== null && charPos >= this._lastExcludedRegion.start && charPos < this._lastExcludedRegion.end;
  }

  // Checks if % at position is a modulo operator (not a percent literal)
  private isModuloOperator(source: string, pos: number): boolean {
    const nextChar = source[pos + 1];
    // `%%` is always treated as modulo, regardless of position. Ruby cannot use `%` as
    // both the literal-introducer and the delimiter (a `%`-delimited literal like
    // `%%text%` would open and immediately close as empty content, or swallow input
    // unpredictably when the close `%` is far away). Treating both `%` characters as
    // modulo operators avoids unterminated literals that swallow the rest of the source
    // (e.g. `x=%%`, `%%foo`, `x=%%\nif true\nend`).
    if (nextChar === '%') {
      return true;
    }
    // `%=` is always compound assignment (modulo-and-assign), never a percent literal,
    // regardless of position. Without this rule, `x=%=\nif true\nend` would open an
    // unterminated `%=...=` literal that swallows the rest of the source.
    if (nextChar === '=') {
      return true;
    }
    if (pos === 0) return false;
    // Look back, skipping whitespace
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i < 0) return false;
    if (!/[a-zA-Z0-9_)\]}"'`/]/.test(source[i])) return false;
    // %<type><delimiter> is always a percent literal, even after identifiers
    // e.g. puts %w[a b], raise %q{error}
    const next = pos + 1;
    if (next < source.length && /[qQwWiIrxs]/.test(source[next]) && next + 1 < source.length && /[^a-zA-Z0-9_ \t]/.test(source[next + 1])) {
      return false;
    }
    // %<paired_delimiter> without specifier is a percent literal, not modulo
    // e.g. puts %{text}, raise %(message)
    if (next < source.length && '({[<'.includes(source[next])) {
      return false;
    }
    // Non-paired delimiter without specifier is also a percent literal
    // e.g. puts %|text|, %~text~
    // (`%%` and `%=` are already handled at the top of this function as modulo.)
    if (next < source.length && /[^a-zA-Z0-9_ \t\r\n]/.test(source[next])) {
      return false;
    }
    return true;
  }

  // Matches percent literal (%q, %Q, %w, %W, etc)
  private matchPercentLiteral(source: string, pos: number): { end: number } | null {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchPercentLiteral(source, pos, PERCENT_SPECIFIERS_PATTERN, isRubyInterpolatingPercent, (s, p) =>
      skipInterpolationShared(s, p, this.interpolationHandlers, heredocState)
    );
    if (result && heredocState.pendingEnd > result.end) {
      return { end: heredocState.pendingEnd };
    }
    if (!result) return null;
    // For %r (percent regex), include trailing regex flags in excluded region
    const specifier = source[pos + 1];
    if (specifier === 'r') {
      let flagEnd = result.end;
      while (flagEnd < source.length && REGEX_FLAGS_PATTERN.test(source[flagEnd])) {
        flagEnd++;
      }
      if (flagEnd > result.end) {
        return { end: flagEnd };
      }
    }
    return result;
  }

  // Matches double-quoted string with #{} interpolation
  private matchInterpolatedString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchInterpolatedString(
      source,
      pos,
      (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState),
      heredocState
    );
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  // Matches backtick string (command) with #{} interpolation
  private matchBacktickString(source: string, pos: number): ExcludedRegion {
    const heredocState: HeredocState = { pendingEnd: -1 };
    const result = matchBacktickString(source, pos, (s, p) => skipInterpolationShared(s, p, this.interpolationHandlers, heredocState));
    if (heredocState.pendingEnd > result.end) {
      return { start: result.start, end: heredocState.pendingEnd };
    }
    return result;
  }

  private get interpolationHandlers(): InterpolationHandlers {
    return {
      skipNestedString: (s, p) => this.skipNestedString(s, p),
      skipNestedBacktickString: (s, p) => this.skipNestedBacktickString(s, p),
      skipNestedRegex: (s, p) => this.skipNestedRegex(s, p),
      matchPercentLiteral: (s, p) => this.matchPercentLiteral(s, p),
      isModuloOperator: (s, p) => this.isModuloOperator(s, p),
      matchHeredoc: (s, p) => matchHeredoc(s, p)
    };
  }

  // Skips #{} interpolation block, tracking brace depth
  private skipInterpolation(source: string, pos: number): number {
    return skipInterpolationShared(source, pos, this.interpolationHandlers);
  }

  // Skips a regex literal inside interpolation (Ruby regexes can be multiline)
  private skipNestedRegex(source: string, pos: number): number {
    return skipNestedRegex(source, pos, REGEX_FLAGS_PATTERN, (s, p) => this.skipInterpolation(s, p), true);
  }

  // Skips a nested string inside interpolation
  private skipNestedString(source: string, pos: number): number {
    return skipNestedString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }

  // Skips a backtick string inside interpolation (supports #{} interpolation)
  private skipNestedBacktickString(source: string, pos: number): number {
    return skipNestedBacktickString(source, pos, (s, p) => this.skipInterpolation(s, p));
  }
}
