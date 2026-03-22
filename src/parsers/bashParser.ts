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
import { findLastOpenerByType, findLineStart } from './parserUtils';

// Keywords that are closed by `done`
const DONE_OPENERS = new Set(['for', 'while', 'until', 'select']);

export class BashBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'case', 'for', 'while', 'until', 'select'],
    blockClose: ['fi', 'esac', 'done'],
    blockMiddle: ['then', 'else', 'elif', 'do']
  };

  // Finds excluded regions: comments, strings, heredocs, parameter expansions
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
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
    let i = position - 1;
    // Skip whitespace (spaces, tabs) but not line endings
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }

    // Skip excluded regions when scanning backward (e.g., $(...) closing paren)
    let skippedRegion = true;
    while (skippedRegion) {
      skippedRegion = false;
      for (const region of excludedRegions) {
        if (i >= region.start && i < region.end) {
          i = region.start - 1;
          skippedRegion = true;
          while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
            i--;
          }
          break;
        }
      }
    }

    // Follow backslash line continuations: if line ends with \<newline>, continue scanning the previous line
    while (i >= 0 && (source[i] === '\n' || source[i] === '\r')) {
      // Check for \<newline> continuation
      let beforeNewline = i - 1;
      if (source[i] === '\n' && beforeNewline >= 0 && source[beforeNewline] === '\r') {
        beforeNewline--;
      }
      if (beforeNewline >= 0 && source[beforeNewline] === '\\') {
        // Count consecutive backslashes before newline
        let bsCount = 0;
        let bsPos = beforeNewline;
        while (bsPos >= 0 && source[bsPos] === '\\') {
          bsCount++;
          bsPos--;
        }
        // Even number of backslashes means they are all escaped (not continuation)
        if (bsCount % 2 === 0) {
          return true;
        }
        // Backslash continuation: skip \ and continue scanning the previous line
        i = beforeNewline - 1;
        while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
          i--;
        }
        // Skip excluded regions again after crossing line continuation
        let skippedAgain = true;
        while (skippedAgain) {
          skippedAgain = false;
          for (const region of excludedRegions) {
            if (i >= region.start && i < region.end) {
              i = region.start - 1;
              skippedAgain = true;
              while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
                i--;
              }
              break;
            }
          }
        }
      } else {
        // Normal line ending (not a continuation) -> keyword is at command position
        return true;
      }
    }

    // At start of file
    if (i < 0) {
      return true;
    }

    // After command separators: ; | & ( )
    if (';|&()'.includes(source[i])) {
      return true;
    }

    // After { only when it stands alone as a reserved word (not part of brace expansion like {for})
    // { is a reserved word when preceded by whitespace, line start, or command separator
    if (source[i] === '{') {
      let k = i - 1;
      while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
        k--;
      }
      // Skip excluded regions when scanning backward from {
      let skippedExcl = true;
      while (skippedExcl) {
        skippedExcl = false;
        for (const region of excludedRegions) {
          if (k >= region.start && k < region.end) {
            k = region.start - 1;
            skippedExcl = true;
            while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
              k--;
            }
            break;
          }
        }
      }
      if (k < 0 || source[k] === '\n' || source[k] === '\r' || ';|&(){}`'.includes(source[k])) {
        return true;
      }
      // Check if { is preceded by a command starter keyword or block close keyword
      const braceContextKws = ['then', 'do', 'else', 'elif', 'time', 'coproc', 'fi', 'done', 'esac'];
      for (const kw of braceContextKws) {
        const kwStart = k - kw.length + 1;
        if (kwStart >= 0 && source.slice(kwStart, k + 1) === kw) {
          if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
            let p = kwStart - 1;
            while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
            if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
              return true;
            }
          }
        }
      }
      return false;
    }

    // After backtick (end of command substitution)
    if (source[i] === '`') {
      return true;
    }

    // After ! (pipeline negation, POSIX)
    if (source[i] === '!') {
      return true;
    }

    // After `}` (end of command group) — allows `} && if ...` or `} || for ...`
    if (source[i] === '}') {
      return true;
    }

    // After shell keywords that introduce a new command context
    // The keyword itself must be at a valid position (not a command argument like "echo then")
    const commandStarters = ['then', 'do', 'else', 'elif', 'time', 'coproc'];
    for (const kw of commandStarters) {
      const kwStart = i - kw.length + 1;
      if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
        if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
          let p = kwStart - 1;
          while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
          if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
            return true;
          }
        }
      }
    }

    // After block close keywords followed by control operators (&&, ||)
    const blockCloseKws = ['fi', 'done', 'esac'];
    for (const kw of blockCloseKws) {
      const kwStart = i - kw.length + 1;
      if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
        if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
          let p = kwStart - 1;
          while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
          if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
            return true;
          }
        }
      }
    }

    return false;
  }

  // Check if keyword is followed by ) → case pattern (e.g., for), done))
  // But not inside subshell (...) where ) closes the subshell
  private isCasePattern(source: string, position: number, keyword: string, excludedRegions: ExcludedRegion[]): boolean {
    let j = position + keyword.length;
    while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
      j++;
    }
    if (j >= source.length) return false;

    // Handle pipe-separated alternatives: if|then), for|while|until)
    // Pipe at end of line continues the pattern on the next line
    if (source[j] === '|') {
      while (j < source.length) {
        if (source[j] === ')') break;
        if (source[j] === '\n' || source[j] === '\r') {
          // Skip line ending
          if (source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
            j += 2;
          } else {
            j++;
          }
          // Skip whitespace on the next line
          while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
            j++;
          }
          continue;
        }
        j++;
      }
      if (j >= source.length || source[j] !== ')') {
        return false;
      }
    } else if (source[j] !== ')') {
      return false;
    }

    // Check if inside unmatched parentheses (subshell or POSIX case pattern)
    let parenDepth = 0;
    for (let k = position - 1; k >= 0; k--) {
      if (this.isInExcludedRegion(k, excludedRegions)) continue;
      if (source[k] === ')') parenDepth++;
      else if (source[k] === '(') {
        if (parenDepth === 0) {
          // Check if ( is a POSIX case pattern opening vs subshell
          // Case pattern: (pattern) has no semicolons/newlines between ( and keyword
          // Subshell: (commands; ...) has semicolons/newlines between ( and keyword
          // Only consider separators outside excluded regions (strings, comments)
          let hasUnexcludedSeparator = false;
          for (let m = k + 1; m < position; m++) {
            if (source[m] === ';' || source[m] === '\n' || source[m] === '\r') {
              if (!this.isInExcludedRegion(m, excludedRegions)) {
                hasUnexcludedSeparator = true;
                break;
              }
            }
          }
          if (hasUnexcludedSeparator) {
            return false;
          }
          const lineStart = findLineStart(source, k);
          const textBefore = source.slice(lineStart, k);
          if (/^[ \t]*$/.test(textBefore) || /;;[ \t]*$|;&[ \t]*$|;;&[ \t]*$/.test(textBefore) || /\bin[ \t]*$/.test(textBefore)) {
            return true;
          }
          return false;
        }
        parenDepth--;
      }
    }

    // Check if keyword is preceded by `(` on the same line (POSIX case pattern)
    // e.g., `(for)` in a case statement
    let k = position - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
      k--;
    }
    if (k >= 0 && source[k] === '(') {
      const lineStart = findLineStart(source, k);
      const textBefore = source.slice(lineStart, k);
      if (/^[ \t]*$/.test(textBefore) || /;;[ \t]*$|;&[ \t]*$|;;&[ \t]*$/.test(textBefore) || /\bin[ \t]*$/.test(textBefore)) {
        return true;
      }
    }

    // Default: check if preceded by case separator (;;, ;&, ;;&) or `in` keyword
    // to distinguish case patterns from keywords followed by stray )
    let s = position - 1;
    while (s >= 0) {
      if (this.isInExcludedRegion(s, excludedRegions)) {
        s--;
        continue;
      }
      if (source[s] !== ' ' && source[s] !== '\t' && source[s] !== '\n' && source[s] !== '\r') break;
      s--;
    }
    if (s >= 1 && source[s] === ';' && source[s - 1] === ';') {
      return true;
    }
    if (s >= 1 && source[s] === '&' && source[s - 1] === ';') {
      return true;
    }
    if (s >= 1 && source[s] === 'n' && source[s - 1] === 'i' && (s < 2 || !/[a-zA-Z0-9_]/.test(source[s - 2]))) {
      return true;
    }
    // After pipe (|) separator in case pattern alternatives (e.g., foo|for))
    if (s >= 0 && source[s] === '|') {
      return true;
    }
    return false;
  }

  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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

  // Checks if keyword is used as variable assignment (done=value, fi+=1, done[0]=value)
  private isFollowedByEquals(source: string, position: number, keyword: string): boolean {
    const afterPos = position + keyword.length;
    if (afterPos >= source.length) return false;
    // Direct assignment: keyword=value (but not keyword==)
    if (source[afterPos] === '=' && (afterPos + 1 >= source.length || source[afterPos + 1] !== '=')) {
      return true;
    }
    // Append assignment: keyword+=value
    if (source[afterPos] === '+' && afterPos + 1 < source.length && source[afterPos + 1] === '=') {
      return true;
    }
    // Array element assignment: keyword[idx]=value or keyword[idx]+=value
    if (source[afterPos] === '[') {
      let depth = 1;
      let j = afterPos + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '[') depth++;
        else if (source[j] === ']') depth--;
        j++;
      }
      if (depth === 0 && j < source.length) {
        if (source[j] === '=' && (j + 1 >= source.length || source[j + 1] !== '=')) {
          return true;
        }
        if (source[j] === '+' && j + 1 < source.length && source[j + 1] === '=') {
          return true;
        }
      }
    }
    return false;
  }

  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    let tokens = super.tokenize(source, excludedRegions);

    // Validate block_middle keywords at command position (echo then, echo else, etc.)
    tokens = tokens.filter((token) => {
      if (token.type !== 'block_middle') return true;
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
        if (j >= 0 && source[j] !== ';' && source[j] !== '\n' && source[j] !== '\r' && source[j] !== '&') {
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
