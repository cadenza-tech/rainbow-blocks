// Bash block parser: if→fi, case→esac, for/while/until/select→done, {→}, with heredoc and parameter expansion exclusion

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
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
import { findLastOpenerByType } from './parserUtils';

// Keywords that are closed by `done`
const DONE_OPENERS = new Set(['for', 'while', 'until', 'select']);

export class BashBlockParser extends BaseBlockParser {
  private get validationCallbacks(): BashValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
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
    let i = 0;
    // Track [[ ]] depth: # is not a comment character inside [[ ]] conditional expressions
    let doubleBracketDepth = 0;

    while (i < source.length) {
      // Track [[ and ]] to maintain doubleBracketDepth
      // Only track [[ at command position to avoid false positives (e.g., echo [[ would poison # detection)
      if (source[i] === '[' && i + 1 < source.length && source[i + 1] === '[' && this.isDoubleBracketCommand(source, i)) {
        doubleBracketDepth++;
        i += 2;
        continue;
      }
      if (source[i] === ']' && i + 1 < source.length && source[i + 1] === ']' && doubleBracketDepth > 0) {
        doubleBracketDepth--;
        i += 2;
        continue;
      }
      // [[ ]] can span multiple lines in Bash; do not reset doubleBracketDepth on newlines
      // Skip comment detection when inside [[ ]] (# is not a comment there)
      if (doubleBracketDepth > 0 && source[i] === '#') {
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

        // Process additional heredoc bodies that follow the first one
        for (const heredocInfo of additionalHeredocs) {
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
      return matchSingleQuotedString(source, pos);
    }

    // Double-quoted string (Bash-specific: handles $(), ${}, backticks inside)
    if (char === '"') {
      return matchBashDoubleQuote(source, pos);
    }

    // Backtick command substitution
    if (char === '`') {
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
    return true;
  }

  // Checks if keyword is preceded by 'in' (for empty case: case $x in esac)
  private isPrecededByIn(source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    let j = position - 1;
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) j--;
    if (j >= 1 && source[j] === 'n' && source[j - 1] === 'i') {
      const inStart = j - 1;
      if (inStart === 0 || !/[a-zA-Z0-9_]/.test(source[inStart - 1])) {
        return true;
      }
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

  // Checks if keyword is part of a hyphenated command name (done-handler, fi-nalize)
  private isFollowedByHyphen(source: string, position: number, keyword: string): boolean {
    const afterPos = position + keyword.length;
    return afterPos < source.length && source[afterPos] === '-';
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

  // Checks if position is inside [[ ... ]] conditional expression
  // Keywords inside [[ ]] are string operands, not commands
  private isInsideDoubleBracket(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    for (let k = position - 1; k >= 0; k--) {
      if (this.isInExcludedRegion(k, excludedRegions)) continue;
      const char = source[k];
      // Found ]] before [[ -> not inside double bracket
      if (char === ']' && k > 0 && source[k - 1] === ']') {
        return false;
      }
      // Found [[ -> check if it's at command position
      if (char === '[' && k > 0 && source[k - 1] === '[') {
        return this.isDoubleBracketCommand(source, k - 1);
      }
    }
    return false;
  }

  // Checks if position is inside a Bash extglob pattern ?(…), *(…), +(…), @(…), !(…)
  private isInsideExtglob(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let parenDepth = 0;
    for (let k = position - 1; k >= 0; k--) {
      if (this.isInExcludedRegion(k, excludedRegions)) continue;
      if (source[k] === ')') {
        parenDepth++;
      } else if (source[k] === '(') {
        if (parenDepth === 0) {
          return k > 0 && '?*+@!'.includes(source[k - 1]);
        }
        parenDepth--;
      }
    }
    return false;
  }

  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
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
      return true;
    });

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

      // Command grouping '{' must be followed by whitespace and at valid position
      if (char === '{') {
        const nextChar = source[i + 1];
        if (nextChar !== undefined && nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' && nextChar !== '\r') {
          continue;
        }
        if (!this.isAtCommandPosition(source, i, excludedRegions)) {
          // Allow { in function definitions: "function name {" or "name() {"
          let j = i - 1;
          while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) j--;
          let isFuncDef = false;
          if (j >= 0 && source[j] === ')') {
            // name() { ... }
            isFuncDef = true;
          } else if (j >= 0 && /[^\s;|&(){}<>$`"'\\#]/.test(source[j])) {
            // Check for "function name {" (Bash allows hyphens, dots, colons, etc. in function names)
            while (j >= 0 && /[^\s;|&(){}<>$`"'\\#]/.test(source[j])) j--;
            let k = j;
            while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--;
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
          if (!isFuncDef) {
            continue;
          }
        }
      }

      // Command grouping '}' must be preceded by ';', newline, or block close keyword
      if (char === '}') {
        let j = i - 1;
        while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
          j--;
        }
        if (j >= 0 && source[j] !== ';' && source[j] !== '\n' && source[j] !== '\r' && source[j] !== '&' && source[j] !== ')' && source[j] !== ']') {
          // Check if preceded by block close keywords (fi, done, esac)
          const blockCloseKeywords = ['fi', 'done', 'esac', '}'];
          let isAfterBlockClose = false;
          for (const kw of blockCloseKeywords) {
            const start = j - kw.length + 1;
            if (start >= 0 && source.slice(start, j + 1) === kw) {
              // Verify word boundary before keyword
              if (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) {
                isAfterBlockClose = true;
                break;
              }
            }
          }
          if (!isAfterBlockClose) {
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
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value;
          let matchIndex = -1;

          // Find the matching opener based on the close keyword
          if (closeValue === 'fi') {
            matchIndex = findLastOpenerByType(stack, 'if');
          } else if (closeValue === 'esac') {
            matchIndex = findLastOpenerByType(stack, 'case');
          } else if (closeValue === 'done') {
            matchIndex = this.findLastDoneOpenerIndex(stack);
          } else if (closeValue === '}') {
            matchIndex = findLastOpenerByType(stack, '{');
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

  // Finds the index of the last opener that can be closed by `done`
  private findLastDoneOpenerIndex(stack: OpenBlock[]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (DONE_OPENERS.has(stack[i].token.value)) {
        return i;
      }
    }
    return -1;
  }
}
