// Bash block parser: if→fi, case→esac, for/while/until/select→done, {→}, with heredoc and parameter expansion exclusion

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { computeEnclosingParenAtPos } from './bashCacheHelpers';
import {
  isCommentStart,
  isDollarHashVariable,
  matchDollarSingleQuote,
  matchHeredocBody,
  matchSingleQuotedString,
  parseHeredocOperator
} from './bashLeafHelpers';
import {
  matchArithmeticBracket,
  matchBacktickCommand,
  matchBareArithmeticEvaluation,
  matchBashDoubleQuote,
  matchCommandSubstitution,
  matchHeredoc,
  matchParameterExpansion,
  matchProcessSubstitution
} from './bashStringHelpers';
import type { BashValidationCallbacks } from './bashValidation';
import { isAtCommandPosition, isCasePattern } from './bashValidation';
import { findExcludedRegionAt } from './parserUtils';

// Keywords that are closed by `done`
const DONE_OPENERS = new Set(['for', 'while', 'until', 'select']);

// Map of intermediate keywords to the set of opener keywords that legally accept them.
// then/else/elif belong to `if` blocks; `do` belongs to `for`/`while`/`until`/`select` loops.
// `case` and `{` (command group) accept no intermediate keywords at all.
const INTERMEDIATE_TO_OPENERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['then', new Set(['if'])],
  ['else', new Set(['if'])],
  ['elif', new Set(['if'])],
  ['do', new Set(['for', 'while', 'until', 'select'])]
]);

// Skips whitespace and \<newline> line continuations backward from `pos`.
// Used to traverse between tokens separated by line continuations
// (e.g., `function \<newline> name { ... }`).
function skipWhitespaceAndContinuationBackwardLocal(source: string, pos: number): number {
  let p = pos;
  while (p >= 0) {
    if (source[p] === ' ' || source[p] === '\t') {
      p--;
      continue;
    }
    if (source[p] === '\n' || source[p] === '\r') {
      let bs = p - 1;
      if (source[p] === '\n' && bs >= 0 && source[bs] === '\r') {
        bs--;
      }
      if (bs >= 0 && source[bs] === '\\') {
        let count = 0;
        let scan = bs;
        while (scan >= 0 && source[scan] === '\\') {
          count++;
          scan--;
        }
        if (count % 2 === 1) {
          p = bs - 1;
          continue;
        }
      }
    }
    break;
  }
  return p;
}

export class BashBlockParser extends BaseBlockParser {
  // Per-parse cache: content regions of `[[ ]]` conditional expressions, sorted by
  // start. Populated by findExcludedRegions so isInsideDoubleBracket answers in
  // O(log N) via binary search instead of walking the source backward each call.
  private doubleBracketRegions: ExcludedRegion[] = [];
  // Start offset of the last `]]` in the most recently parsed source, or -1.
  // Lets hasDoubleBracketClose answer in O(1) instead of scanning to EOF per `[[`.
  private lastDoubleBracketCloseStart = -1;
  // Per-parse cache: innermost enclosing unmatched `(` offset for every position.
  // Populated by tokenize() before super.tokenize() so isInsideExtglob and the
  // array-literal check in isAtCommandPosition answer in O(1) instead of O(N).
  // null when no parse is in progress (defensive fallback to the slow scan).
  private enclosingParenAtPos: Int32Array | null = null;
  // The source string of the in-progress parse, cached so the isInsideArrayLiteral
  // callback (which only receives a position) can inspect characters around the
  // enclosing `(`. null when no parse is in progress.
  private cachedSource: string | null = null;

  private get validationCallbacks(): BashValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions),
      isInsideArrayLiteral: (pos) => this.isInsideArrayLiteral(pos)
    };
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'case', 'for', 'while', 'until', 'select'],
    blockClose: ['fi', 'esac', 'done'],
    blockMiddle: ['then', 'else', 'elif', 'do']
  };

  // Finds excluded regions: comments, strings, heredocs, parameter expansions
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    // Reset the [[ ]] region cache for this parse and record content regions as
    // doubleBracketDepth transitions through 0.
    const doubleBracketRegions: ExcludedRegion[] = [];
    let doubleBracketContentStart = -1;
    let i = 0;
    // Track [[ ]] depth: # is not a comment character inside [[ ]] conditional expressions
    let doubleBracketDepth = 0;

    // Pre-compute the last `]]` start once (O(N)) so the per-`[[`
    // hasDoubleBracketClose check is O(1). Scanning to EOF for every `[[`
    // made a file with many unclosed `[[` O(N^2).
    this.lastDoubleBracketCloseStart = -1;
    for (let k = source.length - 2; k >= 0; k--) {
      if (source[k] === ']' && source[k + 1] === ']') {
        this.lastDoubleBracketCloseStart = k;
        break;
      }
    }

    while (i < source.length) {
      // Track [[ and ]] to maintain doubleBracketDepth
      // Only track [[ at command position to avoid false positives (e.g., echo [[ would poison # detection)
      // An unclosed [[ (no matching ]] ahead) must not enter double-bracket mode,
      // otherwise comment/string detection stays disabled for the rest of the source.
      if (
        source[i] === '[' &&
        i + 1 < source.length &&
        source[i + 1] === '[' &&
        this.isDoubleBracketCommand(source, i) &&
        this.hasDoubleBracketClose(i + 2)
      ) {
        // Record the content region start only when entering double-bracket mode
        // from depth 0 (the common, non-nested case).
        if (doubleBracketDepth === 0) {
          doubleBracketContentStart = i + 2;
        }
        doubleBracketDepth++;
        i += 2;
        continue;
      }
      if (source[i] === ']' && i + 1 < source.length && source[i + 1] === ']' && doubleBracketDepth > 0) {
        doubleBracketDepth--;
        // Close the content region when returning to depth 0.
        if (doubleBracketDepth === 0 && doubleBracketContentStart >= 0) {
          doubleBracketRegions.push({ start: doubleBracketContentStart, end: i });
          doubleBracketContentStart = -1;
        }
        i += 2;
        continue;
      }
      // [[ ]] can span multiple lines in Bash; do not reset doubleBracketDepth on newlines
      // Skip comment detection when inside [[ ]] (# is not a comment there)
      if (doubleBracketDepth > 0 && source[i] === '#') {
        i++;
        continue;
      }
      // Skip heredoc detection when inside [[ ]]: redirections are not allowed
      // there, so `<<` is never a heredoc operator (e.g. `[[ a << b ]]` is invalid
      // bash, but the `<<` must not extend an excluded region to EOF).
      if (doubleBracketDepth > 0 && source[i] === '<' && i + 1 < source.length && source[i + 1] === '<') {
        i++;
        continue;
      }
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        // If region starts after current position (heredoc opener line gap),
        // scan the gap for excluded regions (comments, strings)
        // and collect additional heredoc operators on the same line
        const additionalHeredocs: { stripTabs: boolean; terminator: string }[] = [];
        if (result.start > i) {
          let j = i + 1;
          while (j < result.start) {
            // Check for additional `<<` heredoc operators on the same line
            if (
              source[j] === '<' &&
              j + 1 < source.length &&
              source[j + 1] === '<' &&
              (j + 2 >= source.length || source[j + 2] !== '<') &&
              (j === 0 || source[j - 1] !== '<')
            ) {
              // Try to parse the heredoc operator and delimiter
              const heredocInfo = parseHeredocOperator(source, j);
              if (heredocInfo) {
                additionalHeredocs.push(heredocInfo);
                j += heredocInfo.matchLength;
                continue;
              }
              // Skip past the heredoc operator if not parseable
              j += 2;
              continue;
            }
            const gapResult = this.tryMatchExcludedRegion(source, j);
            if (gapResult) {
              // Clip gap region to not include the newline before heredoc body,
              // preventing adjacent regions that cause isAtCommandPosition to fail
              let gapEnd = Math.min(gapResult.end, result.start);
              while (gapEnd > gapResult.start && (source[gapEnd - 1] === '\n' || source[gapEnd - 1] === '\r')) {
                gapEnd--;
              }
              if (gapEnd > gapResult.start) {
                regions.push({ start: gapResult.start, end: gapEnd });
              }
              j = gapResult.end;
            } else {
              j++;
            }
          }
        }
        regions.push(result);
        i = result.end;

        // Process additional heredoc bodies that follow the first one. Each
        // previous body ends right before its terminator-line newline, so step
        // past that newline (handling \r\n and bare \r) before scanning the
        // next body. Without this, the next body region absorbs the previous
        // terminator's trailing newline (off-by-one start position).
        for (const heredocInfo of additionalHeredocs) {
          if (i < source.length && source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
            i += 2;
          } else if (i < source.length && (source[i] === '\n' || source[i] === '\r')) {
            i++;
          }
          const bodyRegion = matchHeredocBody(source, i, heredocInfo.stripTabs, heredocInfo.terminator);
          if (bodyRegion) {
            regions.push(bodyRegion);
            i = bodyRegion.end;
          }
        }
      } else {
        i++;
      }
    }

    // Publish the [[ ]] content regions for binary-search lookup by
    // isInsideDoubleBracket. An unclosed [[ never enters double-bracket mode
    // (hasDoubleBracketClose gate), so doubleBracketContentStart is always
    // resolved here; the regions stay sorted by construction.
    this.doubleBracketRegions = doubleBracketRegions;

    return regions;
  }

  // Tries to match an excluded region at the given position
  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment (not $# special variable or ${# parameter expansion)
    // Odd consecutive $ before # means $# variable; even means # starts comment
    if (char === '#' && isCommentStart(source, pos) && !this.isParameterExpansion(source, pos) && !isDollarHashVariable(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }

    // $'...' ANSI-C quoting (must check before single quote)
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === "'") {
      return matchDollarSingleQuote(source, pos);
    }

    // $"..." locale-specific double-quoted string (must check before double quote)
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '"') {
      const region = matchBashDoubleQuote(source, pos + 1);
      return { start: pos, end: region.end };
    }

    // Parameter expansion ${...}
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '{') {
      return matchParameterExpansion(source, pos);
    }

    // Command substitution $(...), also handles arithmetic expansion $((...))
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '(') {
      return matchCommandSubstitution(source, pos);
    }

    // Arithmetic expansion $[...] (deprecated but still used)
    if (char === '$' && pos + 1 < source.length && source[pos + 1] === '[') {
      return matchArithmeticBracket(source, pos);
    }

    // Heredoc detection: <<WORD, <<-WORD, <<'WORD', <<"WORD" (not here-string <<<)
    if (char === '<' && pos + 2 < source.length && source[pos + 1] === '<' && source[pos + 2] !== '<' && (pos === 0 || source[pos - 1] !== '<')) {
      const result = matchHeredoc(source, pos);
      if (result) return result;
    }

    // Single-quoted string (no escape sequences)
    if (char === "'") {
      if (this.isEscapedByBackslash(source, pos)) return null;
      return matchSingleQuotedString(source, pos);
    }

    // Double-quoted string (Bash-specific: handles $(), ${}, backticks inside)
    if (char === '"') {
      if (this.isEscapedByBackslash(source, pos)) return null;
      return matchBashDoubleQuote(source, pos);
    }

    // Backtick command substitution
    if (char === '`') {
      if (this.isEscapedByBackslash(source, pos)) return null;
      return matchBacktickCommand(source, pos);
    }

    // Process substitution <(...) and >(...)
    if (char === '(' && pos > 0 && (source[pos - 1] === '<' || source[pos - 1] === '>')) {
      // Make sure it's not <<( which would be heredoc-related
      if (source[pos - 1] === '<' && pos >= 2 && source[pos - 2] === '<') {
        // <<( is heredoc-related, not process substitution
      } else if (source[pos - 1] === '>' && pos >= 2 && source[pos - 2] === '>') {
        // >>( is append redirect + subshell, not process substitution
      } else {
        return matchProcessSubstitution(source, pos);
      }
    }

    // Arithmetic evaluation (( ... )) - not preceded by $
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '(' && (pos === 0 || source[pos - 1] !== '$')) {
      return matchBareArithmeticEvaluation(source, pos);
    }

    return null;
  }

  // Checks if quote at position is escaped by an odd number of preceding backslashes
  private isEscapedByBackslash(source: string, pos: number): boolean {
    let count = 0;
    let i = pos - 1;
    while (i >= 0 && source[i] === '\\') {
      count++;
      i--;
    }
    return count % 2 === 1;
  }

  // Checks if # at position is part of parameter expansion (${#var})
  private isParameterExpansion(source: string, pos: number): boolean {
    if (pos >= 2 && source[pos - 1] === '{' && source[pos - 2] === '$') {
      return true;
    }
    return false;
  }

  // Check if a keyword is at shell command position (start of a simple command)
  private isAtCommandPosition(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return isAtCommandPosition(source, position, excludedRegions, this.validationCallbacks);
  }

  // Check if keyword is followed by ) -> case pattern (e.g., for), done))
  // But not inside subshell (...) where ) closes the subshell
  private isCasePattern(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    return isCasePattern(source, position, keyword, excludedRegions, this.validationCallbacks);
  }

  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByHyphen(source, position, keyword)) {
      return false;
    }
    if (this.isFollowedByExcludedRegion(position, keyword, excludedRegions)) {
      return false;
    }
    if (this.isInsideExtglob(source, position, excludedRegions)) {
      return false;
    }
    if (this.isInsideDoubleBracket(source, position, excludedRegions)) {
      return false;
    }
    if (!this.isAtCommandPosition(source, position, excludedRegions)) {
      return false;
    }
    if (this.isCasePattern(source, position, keyword, excludedRegions)) {
      return false;
    }
    if (this.isFollowedByEquals(source, position, keyword)) {
      return false;
    }
    if (this.isFollowedByFunctionParens(source, position, keyword)) {
      return false;
    }
    return true;
  }

  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isFollowedByHyphen(source, position, keyword)) {
      return false;
    }
    if (this.isFollowedByExcludedRegion(position, keyword, excludedRegions)) {
      return false;
    }
    if (this.isInsideExtglob(source, position, excludedRegions)) {
      return false;
    }
    if (this.isInsideDoubleBracket(source, position, excludedRegions)) {
      return false;
    }
    if (!this.isAtCommandPosition(source, position, excludedRegions)) {
      // esac directly after 'in' in case statement (e.g., 'case $x in esac')
      if (!(keyword === 'esac' && this.isPrecededByIn(source, position, excludedRegions))) {
        return false;
      }
    }
    if (this.isCasePattern(source, position, keyword, excludedRegions)) {
      return false;
    }
    if (this.isFollowedByEquals(source, position, keyword)) {
      return false;
    }
    if (this.isFollowedByFunctionParens(source, position, keyword)) {
      return false;
    }
    return true;
  }

  // Checks if keyword is used as a function name: `keyword() { ... }`.
  // POSIX function definition syntax allows reserved words as function names because the `()`
  // disambiguates: `for() { ... }` is a function definition, not a for loop.
  private isFollowedByFunctionParens(source: string, position: number, keyword: string): boolean {
    let j = position + keyword.length;
    // Skip whitespace after keyword
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length || source[j] !== '(') return false;
    j++;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length || source[j] !== ')') return false;
    j++;
    // After `()`, allow whitespace, newlines, and line continuations before `{`
    while (j < source.length) {
      const c = source[j];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        j++;
        continue;
      }
      if (c === '\\' && j + 1 < source.length && (source[j + 1] === '\n' || source[j + 1] === '\r')) {
        j += 2;
        continue;
      }
      break;
    }
    return j < source.length && source[j] === '{';
  }

  // Checks if keyword is preceded by the case statement's `in` keyword (rescues the
  // empty case `case WORD in esac`). The `in` immediately before `esac` is only the
  // case header `in` when scanning further back reaches the `case` keyword with just
  // the subject word between them; if an argument word `in` is found instead (e.g.
  // `a) cmd in esac`, where the preceding `in` belongs to a command, not the header),
  // an arm separator (`)` pattern terminator, `;;`, `;&`, `;;&`) sits before it and
  // the rescue must not fire.
  private isPrecededByIn(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = position - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) j--;
    if (j >= 1 && source[j] === 'n' && source[j - 1] === 'i') {
      const inStart = j - 1;
      // Word boundary must reject any Unicode letter/digit, not just ASCII, so
      // `αin esac` is not misread as the `in` keyword preceding `esac`.
      if (inStart === 0 || !/[\p{L}\p{N}_]/u.test(source[inStart - 1])) {
        return this.isCaseHeaderIn(source, inStart, excludedRegions);
      }
    }
    return false;
  }

  // Confirms the `in` keyword at inStart is a case statement header `in` (`case WORD in`)
  // by scanning backward: skipping excluded regions, the scan must reach a `case`
  // keyword before crossing an arm boundary. A valid case subject is a single word
  // whose parentheses live only inside expansions (`$(...)`, `$((...))`, `${...}` —
  // all excluded regions, skipped here), so any bare `(`/`)` or a `;;`/`;&`/`;;&`
  // separator before `case` marks an arm boundary and means this `in` is an argument
  // word, not the header (e.g. `a) cmd in esac`). At least one subject character
  // (excluded-region content like `${x}`, or any non-whitespace character) must sit
  // between `case` and `in` — `case in esac` without a subject is a syntax error and
  // must not pair.
  private isCaseHeaderIn(source: string, inStart: number, excludedRegions: ExcludedRegion[]): boolean {
    let k = inStart - 1;
    let sawSubject = false;
    while (k >= 0) {
      if (this.isInExcludedRegion(k, excludedRegions)) {
        const region = this.findExcludedRegionAt(k, excludedRegions);
        // An excluded region (`${...}`, `$(...)`, quoted string, etc.) is a valid
        // subject word, e.g. `case ${x} in esac`.
        sawSubject = true;
        k = region ? region.start - 1 : k - 1;
        continue;
      }
      const ch = source[k];
      // Bare parenthesis or `;;`/`;&`/`;;&` arm separator: arm boundary reached.
      if (ch === '(' || ch === ')' || ch === ';' || (ch === '&' && k >= 1 && source[k - 1] === ';')) {
        return false;
      }
      // `case` keyword reached (word boundaries on both sides) with only the subject
      // word in between. Word boundaries must reject any Unicode letter/digit,
      // not just ASCII, so `αcase` and `caseα` are not misread as the keyword.
      if (
        ch === 'e' &&
        k >= 3 &&
        source.slice(k - 3, k + 1) === 'case' &&
        (k - 4 < 0 || !/[\p{L}\p{N}_]/u.test(source[k - 4])) &&
        (k + 1 >= source.length || !/[\p{L}\p{N}_]/u.test(source[k + 1]))
      ) {
        // `case in esac` (no subject between the keyword and the header `in`)
        // is a syntax error; require at least one subject character.
        return sawSubject;
      }
      // Any non-whitespace character that is not the `case` keyword itself
      // counts as subject content (`case x in esac`, `case $x in esac`, etc.).
      // Backslashes are treated as content too because `case \\... in esac`
      // is valid (the subject is the escaped value); the `case \<newline> in`
      // edge case (line continuation with no subject) is rare enough to leave
      // permissive — false positives here only affect cosmetic pairing, never
      // crash safety.
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
        sawSubject = true;
      }
      k--;
    }
    return false;
  }

  // Checks if keyword is used as variable assignment (done=value, fi+=1, done[0]=value)
  private isFollowedByEquals(source: string, position: number, keyword: string): boolean {
    const afterPos = position + keyword.length;
    if (afterPos >= source.length) return false;
    // Direct assignment: keyword=value (including keyword==value where value starts with =)
    if (source[afterPos] === '=') {
      return true;
    }
    // Append assignment: keyword+=value
    if (source[afterPos] === '+' && afterPos + 1 < source.length && source[afterPos + 1] === '=') {
      return true;
    }
    // Array element reference: keyword[...] is always a variable, not a keyword
    if (source[afterPos] === '[') {
      return true;
    }
    return false;
  }

  // Checks if keyword is immediately followed by an excluded region (word concatenation like done"x", fi$(cmd))
  private isFollowedByExcludedRegion(position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    const afterPos = position + keyword.length;
    const region = this.findExcludedRegionAt(afterPos, excludedRegions);
    return region !== null && region.start === afterPos;
  }

  // Checks if keyword is part of a fused command name (done-handler, fi.suffix, done#tag, fi:, fi/path, etc.)
  // Real bash treats `done` and `#tag` as a single word `done#tag` because `#` only starts a comment
  // when preceded by whitespace or a command separator. Similarly for other non-word but non-shell-meta
  // characters like `.`, `:`, `~`, `,`, `@`, `%`, `^`, `!`, `/`. Excludes characters that are
  // shell metacharacters or already handled (=, [) or word-boundary chars (whitespace, ;, |, &, etc).
  private isFollowedByHyphen(source: string, position: number, keyword: string): boolean {
    const afterPos = position + keyword.length;
    if (afterPos >= source.length) return false;
    const ch = source[afterPos];
    // Hyphen (existing case)
    if (ch === '-') return true;
    // Other non-word, non-shell-meta chars that fuse with the preceding word in bash
    // Exclude: shell metacharacters (\s ; | & ( ) < > ` " '), word-boundary handled (=, [)
    // and characters already covered by isFollowedByEquals
    // The set: # . : ~ , @ % ^ ! /
    if (ch === '#' || ch === '.' || ch === ':' || ch === '~' || ch === ',' || ch === '@' || ch === '%' || ch === '^' || ch === '!' || ch === '/') {
      return true;
    }
    // Glob/pattern modifiers `*` and `?` are pathname-expansion characters in bash: they
    // fuse with the preceding word (e.g. `if*` and `done?glob` expand to filenames, not
    // reserved words). `+` likewise fuses for plain `done+suffix`; the `+=` augmented-
    // assignment form is detected by isFollowedByEquals first when relevant.
    if (ch === '+' || ch === '*' || ch === '?') return true;
    // `{` and `}` fuse with the preceding word when no separator sits between them
    // (`if{` and `done}` are single POSIX words). The standalone `{` command-grouping
    // opener requires a whitespace/newline before it (handled separately during tokenize),
    // so this check only fires when `{`/`}` is immediately glued to the keyword.
    if (ch === '{' || ch === '}') return true;
    // Any NON-ASCII Unicode Symbol code point (currency like `€`, emoji like `😀`,
    // math/other symbols) is a valid word constituent in bash and fuses with the
    // preceding keyword. Restrict to non-ASCII because the Unicode Symbol category
    // also includes ASCII shell metacharacters (`<`, `>`, `|`, `\``, `=`, `+`, `~`,
    // `$`) which are POSIX word terminators, not word-fusion characters. ASCII chars
    // that legitimately fuse (`{`, `}`, `]`, `$`, etc.) are handled explicitly above.
    // Use a 2-char slice with the `u` flag so supplementary-plane code points
    // (surrogate pairs) such as emoji are matched correctly.
    if (ch.charCodeAt(0) > 127 && /^\p{S}/u.test(source.slice(afterPos, afterPos + 2))) return true;
    // `]` fuses with the preceding word: `done]` is one POSIX word, not the reserved keyword.
    if (ch === ']') return true;
    // `$` fuses with the preceding word for non-brace expansions: `done$var`, `done$1`, `done$$`,
    // etc. are all single words. `done$(cmd)`, `done${...}`, `done$'...'`, `done$"..."` are
    // already rejected via isFollowedByExcludedRegion (those starts are excluded regions),
    // so a blanket `$` check here is safe.
    if (ch === '$') return true;
    // `\` fuses with the next character: `done\foo` is the literal word `donefoo`. The one
    // exception is `\<newline>` (line continuation), which is removed by the shell and leaves
    // `done` as the keyword.
    if (ch === '\\') {
      const next = source[afterPos + 1];
      if (next === '\n' || next === '\r') return false;
      return true;
    }
    return false;
  }

  // Checks if [[ at given position is at command position (not an argument like echo [[)
  private isDoubleBracketCommand(source: string, pos: number): boolean {
    let prev = pos - 1;
    while (prev >= 0 && (source[prev] === ' ' || source[prev] === '\t')) prev--;
    if (prev < 0) return true;
    const ch = source[prev];
    if (
      ch === '\n' ||
      ch === '\r' ||
      ch === ';' ||
      ch === '|' ||
      ch === '&' ||
      ch === '(' ||
      ch === ')' ||
      ch === '`' ||
      ch === '{' ||
      ch === '}' ||
      ch === '!'
    ) {
      return true;
    }
    // Check if preceded by a shell keyword (then, else, elif, do, in)
    if (/[a-zA-Z]/.test(ch)) {
      const end = prev;
      let start = prev;
      while (start > 0 && /[a-zA-Z]/.test(source[start - 1])) start--;
      const word = source.slice(start, end + 1);
      if (
        word === 'then' ||
        word === 'else' ||
        word === 'elif' ||
        word === 'do' ||
        word === 'if' ||
        word === 'while' ||
        word === 'until' ||
        word === 'time' ||
        word === 'fi' ||
        word === 'done' ||
        word === 'esac'
      ) {
        return true;
      }
    }
    return false;
  }

  // Checks whether a matching `]]` exists at or after `from`.
  // findExcludedRegions uses this so an unclosed `[[` does not poison `#`/string
  // detection for the rest of the source. Reads the pre-computed last-`]]` offset
  // (see findExcludedRegions) for an O(1) answer; a per-`[[` scan to EOF made a
  // file with many unclosed `[[` O(N^2).
  private hasDoubleBracketClose(from: number): boolean {
    return this.lastDoubleBracketCloseStart >= from;
  }

  // Checks if position is inside [[ ... ]] conditional expression
  // Keywords inside [[ ]] are string operands, not commands.
  // The [[ ]] content regions are pre-computed by findExcludedRegions, so this is
  // an O(log N) binary search instead of a backward scan to file start.
  private isInsideDoubleBracket(_source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return findExcludedRegionAt(position, this.doubleBracketRegions) !== null;
  }

  // Checks if position is inside a Bash extglob pattern ?(…), *(…), +(…), @(…), !(…).
  // Uses the pre-computed enclosing-paren cache so the innermost unmatched `(` is
  // found in O(1); a position is inside an extglob iff that `(` is prefixed by ?*+@!.
  private isInsideExtglob(source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    if (this.enclosingParenAtPos === null || position < 0 || position >= this.enclosingParenAtPos.length) {
      return false;
    }
    const openParen = this.enclosingParenAtPos[position];
    return openParen > 0 && '?*+@!'.includes(source[openParen - 1]);
  }

  // Checks if position sits inside an unclosed `var=(...)` / `var+=(...)` array
  // literal, where keywords are array element values rather than block tokens.
  // Mirrors the former backward scan in isAtCommandPosition: the innermost
  // enclosing unmatched `(` (from the pre-computed cache) opens an array literal
  // iff it is immediately preceded by `=` of a `var=` / `var+=` assignment.
  private isInsideArrayLiteral(position: number): boolean {
    if (this.enclosingParenAtPos === null || position < 0 || position >= this.enclosingParenAtPos.length) {
      return false;
    }
    return this.isArrayLiteralOpener(this.enclosingParenAtPos[position]);
  }

  // Checks whether the `)` at pos closes a `var=(...)` / `var+=(...)` array literal.
  // For a `)` token the enclosing-paren cache holds the index of its matching `(`, so
  // the close is an array-literal close iff that `(` is an array-literal opener. Used
  // to keep a `}` after such a `)` from being treated as a command group close
  // (`{ x=(1)}` is a syntax error: the `)` ends the array literal, not a command).
  private isArrayLiteralCloseParen(pos: number): boolean {
    if (this.enclosingParenAtPos === null || pos < 0 || pos >= this.enclosingParenAtPos.length || this.cachedSource?.[pos] !== ')') {
      return false;
    }
    return this.isArrayLiteralOpener(this.enclosingParenAtPos[pos]);
  }

  // Checks whether the `(` at parenIndex opens a `var=(...)` / `var+=(...)` array
  // literal. parenIndex < 0 means no enclosing paren.
  private isArrayLiteralOpener(parenIndex: number): boolean {
    if (parenIndex <= 0) return false;
    const source = this.cachedSource;
    if (source === null || source[parenIndex - 1] !== '=') return false;
    let varEnd = parenIndex - 1;
    if (varEnd > 0 && source[varEnd - 1] === '+') {
      varEnd--;
    }
    let varPos = varEnd - 1;
    while (varPos >= 0 && /[a-zA-Z0-9_]/.test(source[varPos])) {
      varPos--;
    }
    const varStart = varPos + 1;
    return varStart < varEnd && /[a-zA-Z_]/.test(source[varStart]);
  }

  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Pre-compute the enclosing-paren cache before super.tokenize(): that call
    // runs isValidBlockOpen / isValidBlockClose for every keyword match, which in
    // turn call isInsideExtglob and (via isAtCommandPosition) isInsideArrayLiteral.
    // Without the cache those scan the source backward, making parsing O(N^2).
    this.cachedSource = source;
    this.enclosingParenAtPos = computeEnclosingParenAtPos(source, excludedRegions);

    let tokens = super.tokenize(source, excludedRegions);

    // Validate block_middle keywords at command position (echo then, echo else, etc.)
    tokens = tokens.filter((token) => {
      if (token.type !== 'block_middle') return true;
      if (this.isFollowedByHyphen(source, token.startOffset, token.value)) return false;
      // `then"foo"` etc.: keyword fused with adjacent quoted string is a single word, not a reserved keyword
      if (this.isFollowedByExcludedRegion(token.startOffset, token.value, excludedRegions)) return false;
      if (this.isInsideExtglob(source, token.startOffset, excludedRegions)) return false;
      if (this.isInsideDoubleBracket(source, token.startOffset, excludedRegions)) return false;
      if (!this.isAtCommandPosition(source, token.startOffset, excludedRegions)) return false;
      if (this.isCasePattern(source, token.startOffset, token.value, excludedRegions)) return false;
      if (this.isFollowedByEquals(source, token.startOffset, token.value)) return false;
      // `then() { ... }` etc.: reserved word used as a function name, not a block intermediate
      if (this.isFollowedByFunctionParens(source, token.startOffset, token.value)) return false;
      return true;
    });

    // Second pass: detect keywords split across `\<newline>` line continuations
    // (e.g. `i\<newline>f`). Bash collapses backslash-newline during lexing, so the
    // logical word `if` should be recognized as the if keyword. The regex-based
    // super.tokenize() misses these because the keyword text is not contiguous.
    const splitTokens = this.findSplitKeywordTokens(source, excludedRegions);
    if (splitTokens.length > 0) {
      // A split keyword such as `do\<newline>ne` (the `done` close) starts with the
      // shorter keyword `do`, which the regex tokenizer already matched as a
      // standalone token sharing the split token's start offset. That partial token
      // physically overlaps the synthesized split token, producing a duplicate
      // (e.g. a phantom `do` intermediate on top of the `done` close span). Drop any
      // existing token fully contained within a split token's source span.
      tokens = tokens.filter((token) => !this.isContainedInSplitToken(token, splitTokens));
      tokens.push(...splitTokens);
    }

    const newlinePositions = this.buildNewlinePositions(source);

    // Match { } for command grouping (not brace expansion)
    const bracePattern = /[{}]/g;
    for (const match of source.matchAll(bracePattern)) {
      const i = match.index;
      const char = match[0];

      // Skip if in excluded region (covers ${...}, strings, comments, etc)
      if (this.isInExcludedRegion(i, excludedRegions)) {
        continue;
      }

      // Skip if part of parameter expansion ${
      if (char === '{' && i > 0 && source[i - 1] === '$') {
        continue;
      }

      // Skip { } inside [[ ]] conditional expressions; they are string operands, not block tokens
      if (this.isInsideDoubleBracket(source, i, excludedRegions)) {
        continue;
      }

      // Command grouping '{' must be followed by whitespace, newline, or '(' (subshell starter)
      // Bash accepts `{(echo);}` without whitespace because the lexer can disambiguate.
      if (char === '{') {
        const nextChar = source[i + 1];
        if (nextChar !== undefined && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r' && nextChar !== '(') {
          continue;
        }
        if (!this.isAtCommandPosition(source, i, excludedRegions)) {
          // Allow { in function definitions: "function name {" or "name() {"
          // Also handle "coproc {" (anonymous coproc) and "coproc NAME {" (named coproc)
          // Skip whitespace and \<newline> line continuations between { and the preceding token
          let j = skipWhitespaceAndContinuationBackwardLocal(source, i - 1);
          let isFuncDef = false;
          if (j >= 0 && source[j] === ')') {
            // name() { ... }
            isFuncDef = true;
          } else if (j >= 0 && /[^\s;|&(){}<>$`"'\\#]/.test(source[j])) {
            // Walk back through the preceding word
            const wordEnd = j;
            while (j >= 0 && /[^\s;|&(){}<>$`"'\\#]/.test(source[j])) j--;
            const wordStart = j + 1;
            const word = source.slice(wordStart, wordEnd + 1);
            // Case: the preceding word IS `coproc` (anonymous coprocess: `coproc { ... }`)
            if (
              word === 'coproc' &&
              (wordStart === 0 || !/[a-zA-Z0-9_]/.test(source[wordStart - 1])) &&
              this.isAtCommandPosition(source, wordStart, excludedRegions)
            ) {
              isFuncDef = true;
            }
            // Otherwise treat the word as a NAME and look for `function` or `coproc` before it
            if (!isFuncDef) {
              // Skip whitespace and \<newline> line continuations between the name and the keyword
              const k = skipWhitespaceAndContinuationBackwardLocal(source, j);
              if (
                k >= 7 &&
                source.slice(k - 7, k + 1) === 'function' &&
                (k - 8 < 0 || !/[a-zA-Z0-9_]/.test(source[k - 8])) &&
                this.isAtCommandPosition(source, k - 7, excludedRegions)
              ) {
                isFuncDef = true;
              }
              // coproc NAME { ... } (Bash 4+ named coprocess)
              if (
                !isFuncDef &&
                k >= 5 &&
                source.slice(k - 5, k + 1) === 'coproc' &&
                (k - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[k - 6])) &&
                this.isAtCommandPosition(source, k - 5, excludedRegions)
              ) {
                isFuncDef = true;
              }
            }
          }
          if (!isFuncDef) {
            continue;
          }
        }
      }

      // Command grouping '}' must be preceded by ';', newline, or block close keyword.
      // Predecessor must NOT be inside an excluded region — e.g., the closing `}` of `${...}`
      // or the closing `)` of `$(...)` is not a structural separator even though it looks
      // like one (those would falsely allow `{ echo ${arr[@]} }` to be treated as a block).
      if (char === '}') {
        let j = i - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j >= 0 && this.isInExcludedRegion(j, excludedRegions)) {
          continue;
        }
        // A `)` is a valid separator only when it closes a subshell/command (e.g.
        // `{ (echo)}`), not a `var=(...)` array literal (`{ x=(1)}` is invalid bash).
        const closeParenIsSeparator = source[j] === ')' && !this.isArrayLiteralCloseParen(j);
        if (j >= 0 && source[j] !== ';' && source[j] !== '\n' && source[j] !== '\r' && source[j] !== '&' && !closeParenIsSeparator) {
          // Block close keywords (fi, done, esac, }) only count as a separator
          // when at least one whitespace/tab sits between them and the `}`.
          // Without a separator the keyword fuses into the preceding word
          // (e.g. `fi}` is a single POSIX word, not the `fi` keyword followed by
          // a structural `}`), so isFollowedByHyphen above has already rejected
          // the keyword and the `}` must stay orphan too for consistency. The
          // `i - 1 > j` check is true exactly when the whitespace-skip loop
          // moved `j` (i.e. at least one space/tab existed between predecessor
          // and `}`); mirrors the `isAfterDoubleBracketWithSep` rule below.
          const hasWhitespaceBefore = i - 1 > j;
          let isAfterBlockClose = false;
          if (hasWhitespaceBefore) {
            const blockCloseKeywords = ['fi', 'done', 'esac', '}'];
            for (const kw of blockCloseKeywords) {
              const start = j - kw.length + 1;
              if (start >= 0 && source.slice(start, j + 1) === kw) {
                // Verify word boundary before keyword and that the keyword is NOT inside an excluded region
                if ((start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) && !this.isInExcludedRegion(start, excludedRegions)) {
                  isAfterBlockClose = true;
                  break;
                }
              }
            }
          }
          // Allow `}` after a closing `]]` ONLY when a separator (space/tab) sits between them,
          // e.g. `{ [[ $x -gt 0 ]] }`. A stray bracket without a separator (`foo]}`, `]]}`,
          // `foo[0]}`) is not a command group close and must keep `{` orphan.
          const isAfterDoubleBracketWithSep = source[j] === ']' && source[j - 1] === ']' && hasWhitespaceBefore;
          if (!isAfterBlockClose && !isAfterDoubleBracketWithSep) {
            continue;
          }
        }
      }

      const { line, column } = this.getLineAndColumn(i, newlinePositions);
      tokens.push({
        type: char === '{' ? 'block_open' : 'block_close',
        value: char,
        startOffset: i,
        endOffset: i + 1,
        line,
        column
      });
    }

    // Sort by position
    return tokens.sort((a, b) => a.startOffset - b.startOffset);
  }

  // Returns true when `token` lies fully within the source span of any split
  // keyword token. The regex tokenizer can match a split keyword's leading
  // sub-keyword as a standalone token (e.g. the `do` of a `do\<newline>ne`
  // close), which then overlaps the synthesized split token; such partial
  // tokens are dropped so the split token alone represents the keyword.
  private isContainedInSplitToken(token: Token, splitTokens: Token[]): boolean {
    for (const split of splitTokens) {
      if (token.startOffset >= split.startOffset && token.endOffset <= split.endOffset) {
        return true;
      }
    }
    return false;
  }

  // Detects keywords split across `\<newline>` line continuations and returns
  // synthesized tokens. Bash collapses backslash-newline during lexical processing
  // so `i\<newline>f` is the `if` keyword, but the regex-based base tokenizer
  // misses it because the keyword text is not contiguous.
  private findSplitKeywordTokens(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const allKeywords = new Set<string>([...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle]);
    const newlinePositions = this.buildNewlinePositions(source);

    let i = 0;
    while (i < source.length - 1) {
      if (source[i] !== '\\' || (source[i + 1] !== '\n' && source[i + 1] !== '\r')) {
        i++;
        continue;
      }
      // Verify odd backslash count (so the last `\` truly escapes the newline)
      let bsCount = 0;
      let bsScan = i;
      while (bsScan >= 0 && source[bsScan] === '\\') {
        bsCount++;
        bsScan--;
      }
      if (bsCount % 2 === 0) {
        i++;
        continue;
      }
      // Skip line continuations inside excluded regions (e.g. quoted strings)
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i++;
        continue;
      }
      // Require an identifier character immediately before the backslash; without
      // one the line continuation cannot be inside a keyword (e.g. `foo \<nl>bar`
      // is two separate words, not a split keyword)
      if (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1])) {
        i++;
        continue;
      }
      // Expand left to capture the start of the keyword (preceding identifier
      // characters). The keyword may itself be preceded by other split segments,
      // so walk through `\<newline>` sequences encountered on the way too.
      let leftStart = i;
      while (leftStart > 0 && /[a-zA-Z0-9_]/.test(source[leftStart - 1])) {
        leftStart--;
      }
      // Expand right through identifier characters and any further `\<newline>`
      // sequences encountered within the same logical word
      let endInSource = i + 2;
      if (source[i + 1] === '\r' && endInSource < source.length && source[endInSource] === '\n') {
        endInSource++;
      }
      let logicalWord = source.slice(leftStart, i);
      while (endInSource < source.length) {
        const ch = source[endInSource];
        if (/[a-zA-Z0-9_]/.test(ch)) {
          logicalWord += ch;
          endInSource++;
          continue;
        }
        // Another `\<newline>` inside the keyword (e.g. `i\<nl>f` split twice)
        if (ch === '\\' && endInSource + 1 < source.length && (source[endInSource + 1] === '\n' || source[endInSource + 1] === '\r')) {
          endInSource += 2;
          if (source[endInSource - 1] === '\r' && endInSource < source.length && source[endInSource] === '\n') {
            endInSource++;
          }
          continue;
        }
        break;
      }
      // Bail early if the assembled word is not a known keyword (handles
      // `i\<nl>fx` -> `ifx`, which must not produce an `if` token)
      if (allKeywords.has(logicalWord) && this.isValidSplitKeyword(logicalWord, source, leftStart, endInSource, excludedRegions)) {
        const tokenType = this.getTokenType(logicalWord);
        const { line, column } = this.getLineAndColumn(leftStart, newlinePositions);
        tokens.push({
          type: tokenType,
          value: logicalWord,
          startOffset: leftStart,
          endOffset: endInSource,
          line,
          column
        });
      }
      // Advance past the entire logical word so the outer loop does not rescan
      // its interior `\<newline>` sequences
      i = endInSource;
    }
    return tokens;
  }

  // Validates a split keyword using the actual span (startOffset..endInSource)
  // in source. The standard isValidBlock{Open,Close} path bakes in
  // `position + keyword.length`, which is the wrong end position when the
  // keyword text is interleaved with `\<newline>` sequences.
  private isValidSplitKeyword(keyword: string, source: string, startOffset: number, endInSource: number, excludedRegions: ExcludedRegion[]): boolean {
    // After-keyword checks: look at character at endInSource (the first non-keyword
    // character after the logical word)
    if (this.isFollowedByCharAfter(source, endInSource, 'hyphen')) return false;
    if (this.isFollowedByExcludedRegionAt(endInSource, excludedRegions)) return false;
    if (this.isInsideExtglob(source, startOffset, excludedRegions)) return false;
    if (this.isInsideDoubleBracket(source, startOffset, excludedRegions)) return false;
    const tokenType = this.getTokenType(keyword);
    if (!this.isAtCommandPosition(source, startOffset, excludedRegions)) {
      if (!(tokenType === 'block_close' && keyword === 'esac' && this.isPrecededByIn(source, startOffset, excludedRegions))) {
        return false;
      }
    }
    if (this.isFollowedByCharAfter(source, endInSource, 'equals')) return false;
    if (this.isFollowedByFunctionParensAt(source, endInSource)) return false;
    return true;
  }

  // Variant of isFollowedByHyphen / isFollowedByEquals that accepts an explicit
  // afterPos (the first character index after the keyword text). Used by
  // isValidSplitKeyword because the split keyword's `endOffset` is not
  // `position + keyword.length`.
  private isFollowedByCharAfter(source: string, afterPos: number, kind: 'hyphen' | 'equals'): boolean {
    if (afterPos >= source.length) return false;
    const ch = source[afterPos];
    if (kind === 'hyphen') {
      if (ch === '-') return true;
      if (ch === '#' || ch === '.' || ch === ':' || ch === '~' || ch === ',' || ch === '@' || ch === '%' || ch === '^' || ch === '!' || ch === '/') {
        return true;
      }
      // Glob/pattern modifiers, brace fuses, and non-ASCII Unicode Symbols
      // (see isFollowedByHyphen for details, including why \p{S} is gated to non-ASCII)
      if (ch === '+' || ch === '*' || ch === '?') return true;
      if (ch === '{' || ch === '}') return true;
      if (ch.charCodeAt(0) > 127 && /^\p{S}/u.test(source.slice(afterPos, afterPos + 2))) return true;
      if (ch === ']' || ch === '$') return true;
      if (ch === '\\') {
        const next = source[afterPos + 1];
        if (next === '\n' || next === '\r') return false;
        return true;
      }
      return false;
    }
    // equals
    if (ch === '=') return true;
    if (ch === '+' && afterPos + 1 < source.length && source[afterPos + 1] === '=') return true;
    if (ch === '[') return true;
    return false;
  }

  // Variant of isFollowedByExcludedRegion that accepts an explicit afterPos
  private isFollowedByExcludedRegionAt(afterPos: number, excludedRegions: ExcludedRegion[]): boolean {
    const region = this.findExcludedRegionAt(afterPos, excludedRegions);
    return region !== null && region.start === afterPos;
  }

  // Variant of isFollowedByFunctionParens that accepts an explicit afterPos
  private isFollowedByFunctionParensAt(source: string, afterPos: number): boolean {
    let j = afterPos;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length || source[j] !== '(') return false;
    j++;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
    if (j >= source.length || source[j] !== ')') return false;
    j++;
    while (j < source.length) {
      const c = source[j];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        j++;
        continue;
      }
      if (c === '\\' && j + 1 < source.length && (source[j + 1] === '\n' || source[j + 1] === '\r')) {
        j += 2;
        continue;
      }
      break;
    }
    return j < source.length && source[j] === '{';
  }

  // Matches blocks with Bash-specific pairing: fi→if, esac→case, done→for/while/until/select, }→{
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
            const topOpener = stack[stack.length - 1].token.value;
            const allowedOpeners = INTERMEDIATE_TO_OPENERS.get(token.value);
            if (allowedOpeners?.has(topOpener)) {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value;
          // Subshell scope barrier: a close keyword inside `(...)` must not pair with
          // an opener outside it, and vice versa. The enclosing-paren cache yields
          // each position's innermost open paren (or -1) in O(1).
          const closeScope = this.getEnclosingParen(token.startOffset);
          let matchIndex = -1;

          // Find the matching opener based on the close keyword, filtering openers
          // whose enclosing paren scope differs from the close keyword.
          if (closeValue === 'fi') {
            matchIndex = this.findLastOpenerInScope(stack, 'if', closeScope);
          } else if (closeValue === 'esac') {
            matchIndex = this.findLastOpenerInScope(stack, 'case', closeScope);
          } else if (closeValue === 'done') {
            matchIndex = this.findLastDoneOpenerIndex(stack, closeScope);
          } else if (closeValue === '}') {
            matchIndex = this.findLastOpenerInScope(stack, '{', closeScope);
          }

          if (matchIndex >= 0) {
            // Openers above the matched index were opened more recently and have
            // now met a close keyword that cannot close them (e.g. `if` still open
            // when `done` arrives). Per the anchor-set principle, terminate those
            // scopes as unclosed (orphan, left uncolored) instead of letting their
            // own close keyword cross-pair past this one. Truncating the stack to
            // `matchIndex` drops them and removes the matched opener in one step.
            const openBlock = stack[matchIndex];
            stack.length = matchIndex;
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

  // Reads the precomputed enclosing-paren index for `pos`. Returns -1 when there
  // is no enclosing `(`, or when the cache is unavailable (defensive fallback so
  // matchBlocks degrades to the pre-fix LIFO behavior instead of crashing).
  private getEnclosingParen(pos: number): number {
    if (this.enclosingParenAtPos === null || pos < 0 || pos >= this.enclosingParenAtPos.length) {
      return -1;
    }
    return this.enclosingParenAtPos[pos];
  }

  // Like findLastOpenerByType, but rejects openers whose enclosing paren scope is
  // shallower than the close's. A close strictly deeper than the opener means a
  // subshell `(` was opened between them that the opener is not in -- pairing
  // would cross a subshell barrier (anchor-set principle violation).
  //
  // The reverse direction (close shallower than opener) is NOT rejected here:
  // a case pattern `)` (e.g. `(case x in a) ... esac)`) makes the enclosing-paren
  // cache report the apparent scope as -1 for tokens after the `a)` even though
  // they are still inside the outer subshell. Rejecting that direction would
  // break legitimate case-esac pairings inside subshells.
  private findLastOpenerInScope(stack: OpenBlock[], targetValue: string, closeScope: number): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value !== targetValue) continue;
      if (!this.isOpenerInSameOrOuterScope(stack[i].token.startOffset, closeScope)) continue;
      return i;
    }
    return -1;
  }

  // Finds the index of the last opener that can be closed by `done` and that is
  // not strictly outside the close's subshell scope.
  private findLastDoneOpenerIndex(stack: OpenBlock[], closeScope: number): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!DONE_OPENERS.has(stack[i].token.value)) continue;
      if (!this.isOpenerInSameOrOuterScope(stack[i].token.startOffset, closeScope)) continue;
      return i;
    }
    return -1;
  }

  // Returns true when the opener's enclosing-paren scope is the same as or
  // shallower (more outer) than the close's. A close strictly deeper than the
  // opener (closeScope > openerScope) means a subshell `(` was opened between
  // them that the opener is not in -- reject the pairing.
  private isOpenerInSameOrOuterScope(openerPos: number, closeScope: number): boolean {
    if (closeScope === -1) return true;
    const openerScope = this.getEnclosingParen(openerPos);
    if (openerScope === -1) return false;
    return openerScope <= closeScope;
  }
}
