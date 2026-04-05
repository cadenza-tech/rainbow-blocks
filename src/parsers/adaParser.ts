// Ada block parser: procedure, function, if, loop, case with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { isOrElseShortCircuit, matchAdaString, matchCharacterLiteral, scanForwardToIs, skipAdaWhitespaceAndComments } from './adaHelpers';
import type { AdaValidationCallbacks } from './adaValidation';
import {
  isInsideParens,
  isValidAcceptOpen,
  isValidForOpen,
  isValidLoopOpen,
  isValidPackageOpen,
  isValidProtectedOpen,
  isValidRecordOpen,
  isValidSubprogramOpen,
  isValidTaskOpen
} from './adaValidation';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType, findLastOpenerForLoop, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = ['if', 'loop', 'case', 'select', 'record', 'procedure', 'function', 'package', 'task', 'protected', 'accept', 'entry'];

// Keywords that can precede 'begin' and are closed together with it
const BEGIN_CONTEXT_KEYWORDS = ['declare', 'procedure', 'function', 'task', 'protected', 'package', 'entry'];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]+(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

export class AdaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'if',
      'loop',
      'for',
      'while',
      'case',
      'select',
      'record',
      'declare',
      'begin',
      'procedure',
      'function',
      'package',
      'task',
      'protected',
      'accept',
      'entry'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'exception', 'or', 'is']
  };

  private get validationCallbacks(): AdaValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Validates if keyword is a valid block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const cb = this.validationCallbacks;

    if (lowerKeyword === 'entry') {
      const isPos = scanForwardToIs(source, position + keyword.length, (pos) => this.isInExcludedRegion(pos, excludedRegions));
      if (isPos < 0) return false;
      const k = skipAdaWhitespaceAndComments(source, isPos + 2);
      const afterIs = source.slice(k).match(/^([a-zA-Z_]\w*)/);
      if (afterIs && ['abstract', 'separate', 'new', 'null'].includes(afterIs[1].toLowerCase())) {
        return false;
      }
      if (k < source.length && source[k] === '<' && k + 1 < source.length && source[k + 1] === '>') {
        return false;
      }
      return true;
    }

    if (lowerKeyword === 'task') {
      return isValidTaskOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'package') {
      return isValidPackageOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return isValidSubprogramOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'accept') {
      return isValidAcceptOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'record') {
      return isValidRecordOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'protected') {
      return isValidProtectedOpen(source, position, keyword, excludedRegions, cb);
    }

    if (lowerKeyword === 'if' || lowerKeyword === 'case') {
      return !isInsideParens(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'for') {
      return isValidForOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'loop') {
      return isValidLoopOpen(source, position, excludedRegions, cb);
    }

    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchAdaString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return matchCharacterLiteral(source, pos);
    }

    return null;
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();

    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      if (!this.isInExcludedRegion(pos, excludedRegions)) {
        const fullMatch = match[0];
        if (this.isAdjacentToUnicodeLetter(source, pos, fullMatch.length)) {
          match = COMPOUND_END_PATTERN.exec(source);
          continue;
        }
        const endType = match[1].toLowerCase();
        compoundEndPositions.set(pos, {
          keyword: fullMatch, // Preserve original case
          length: fullMatch.length,
          endType
        });
      }
      match = COMPOUND_END_PATTERN.exec(source);
    }

    // Tokenize with case-insensitive matching
    const tokens: Token[] = [];
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    // Use 'gi' flag for case-insensitive global matching
    const keywordPattern = new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'gi');
    const newlinePositions = this.buildNewlinePositions(source);

    for (const keywordMatch of source.matchAll(keywordPattern)) {
      const startOffset = keywordMatch.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = keywordMatch[1];

      // JavaScript \b only handles ASCII word boundaries, so check for adjacent Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip 'is' in type/subtype declarations (type T is ... / subtype S is ...)
      // Also handles multi-line: type T\n  is range 1..100;
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = findLineStart(source, startOffset);
        const lineBefore = source.slice(lineStart, startOffset).toLowerCase().trimStart();
        let isTypeDeclLine = /^(type|subtype)\b/.test(lineBefore);
        // When the line starts with 'type', check if 'protected' or 'task' precedes it
        // on a previous line (e.g., "protected\ntype Foo is" should be a block, not a type decl)
        if (isTypeDeclLine && /^type\b/.test(lineBefore)) {
          let scanPos = lineStart - 1;
          while (scanPos >= 0 && (source[scanPos] === ' ' || source[scanPos] === '\t' || source[scanPos] === '\n' || source[scanPos] === '\r')) {
            scanPos--;
          }
          if (scanPos >= 0) {
            const prevEnd = scanPos + 1;
            const prevLineStart = findLineStart(source, prevEnd);
            const prevToken = source.slice(prevLineStart, prevEnd).toLowerCase().trimEnd();
            if (/\b(?:protected|task)$/.test(prevToken)) {
              isTypeDeclLine = false;
            }
          }
        }
        // Check for type/subtype keyword before this 'is' on the same line,
        // not separated by a semicolon
        // (e.g., "procedure Test is type T is range 1..10;")
        if (!isTypeDeclLine) {
          const lineSlice = source.slice(lineStart, startOffset);
          let lastTypeDeclPos = -1;
          for (const m of lineSlice.matchAll(/\b(type|subtype)\b/gi)) {
            const absPos = lineStart + m.index;
            if (this.isInExcludedRegion(absPos, excludedRegions)) continue;
            // Skip type/subtype inside parentheses (e.g., parameter type names)
            let parenDepthAtMatch = 0;
            for (let pi = lineStart; pi < absPos; pi++) {
              if (this.isInExcludedRegion(pi, excludedRegions)) continue;
              if (source[pi] === '(') parenDepthAtMatch++;
              else if (source[pi] === ')') parenDepthAtMatch--;
            }
            if (parenDepthAtMatch > 0) continue;
            // Skip 'type' when preceded by 'protected' or 'task' (these are block, not type decl)
            if (m[1].toLowerCase() === 'type') {
              const beforeType = source.slice(lineStart, absPos).toLowerCase().trimEnd();
              if (/\b(?:protected|task)$/.test(beforeType)) continue;
              // When 'type' is at the start of the line, check previous lines
              if (beforeType.length === 0) {
                let sp = lineStart - 1;
                while (sp >= 0 && (source[sp] === ' ' || source[sp] === '\t' || source[sp] === '\n' || source[sp] === '\r')) {
                  sp--;
                }
                if (sp >= 0) {
                  const pe = sp + 1;
                  const ps = findLineStart(source, pe);
                  const pt = source.slice(ps, pe).toLowerCase().trimEnd();
                  if (/\b(?:protected|task)$/.test(pt)) continue;
                }
              }
            }
            lastTypeDeclPos = absPos;
          }
          if (lastTypeDeclPos >= 0) {
            // Ensure no semicolon between type/subtype keyword and this 'is'
            let hasSemiBetween = false;
            for (let si = lastTypeDeclPos; si < startOffset; si++) {
              if (this.isInExcludedRegion(si, excludedRegions)) continue;
              if (source[si] === ';') {
                hasSemiBetween = true;
                break;
              }
            }
            if (!hasSemiBetween) {
              isTypeDeclLine = true;
            }
          }
        }
        if (isTypeDeclLine) {
          // Find the last top-level semicolon before this 'is' on the same line
          // to handle multiple type declarations on one line
          let lastSemiPos = -1;
          let parenDepth = 0;
          for (let si = lineStart; si < startOffset; si++) {
            if (this.isInExcludedRegion(si, excludedRegions)) continue;
            if (source[si] === '(') parenDepth++;
            else if (source[si] === ')') parenDepth--;
            else if (source[si] === ';' && parenDepth === 0) {
              lastSemiPos = si;
            }
          }
          if (lastSemiPos < 0) {
            // No semicolon → the type/subtype at line start applies to this 'is'
            continue;
          }
          // Check if there's a type/subtype after the last semicolon
          const afterSemi = source
            .slice(lastSemiPos + 1, startOffset)
            .toLowerCase()
            .trimStart();
          if (/^(type|subtype)\b/.test(afterSemi)) {
            continue;
          }
        }
        // Check previous lines if current line has only whitespace before 'is',
        // or if 'is' follows a closing paren from a discriminant list,
        // or if lineBefore has unmatched closing parens (multi-line discriminant)
        // Count paren depth using absolute positions to skip excluded regions
        let lineParenDepth = 0;
        for (let ci = lineStart; ci < startOffset; ci++) {
          if (this.isInExcludedRegion(ci, excludedRegions)) continue;
          if (source[ci] === '(') lineParenDepth++;
          if (source[ci] === ')') lineParenDepth--;
        }
        const hasUnmatchedCloseParen = lineParenDepth < 0;
        if (lineBefore.length === 0 || /^\(.*\)\s*$/.test(lineBefore) || hasUnmatchedCloseParen) {
          let scanPos = lineStart - 1;
          // Skip line terminator (\n, \r\n, or \r)
          if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
          if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          let isTypeDecl = false;
          let typeDeclStart = -1;
          // Track paren depth for multi-line discriminant lists
          // Positive means we're inside a parenthesized group scanning backward
          let scanParenDepth = hasUnmatchedCloseParen ? -lineParenDepth : 0;
          while (scanPos >= 0) {
            const prevStart = findLineStart(source, scanPos);
            const prevLine = source
              .slice(prevStart, scanPos + 1)
              .toLowerCase()
              .trimStart();
            if (prevLine.length > 0) {
              // Skip comment lines (starting with --)
              if (/^--/.test(prevLine)) {
                scanPos = prevStart - 1;
                if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
                if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
                continue;
              }
              // Track paren depth for multi-line discriminant lists
              // Use absolute positions to skip excluded regions (comments, strings)
              const depthBeforeLine = scanParenDepth;
              let lineHasNonExcludedParen = false;
              for (let ci = prevStart; ci <= scanPos && ci < source.length; ci++) {
                if (this.isInExcludedRegion(ci, excludedRegions)) continue;
                if (source[ci] === ')') {
                  scanParenDepth++;
                  lineHasNonExcludedParen = true;
                }
                if (source[ci] === '(') {
                  scanParenDepth--;
                  lineHasNonExcludedParen = true;
                }
              }
              // If this line has balanced parens (net zero change) but scanParenDepth
              // is still elevated from lines below, and the line doesn't start with '(',
              // it's an independent statement (e.g. a function call) that shouldn't
              // bridge the backward scan to a type declaration above.
              // Only apply when the line actually has non-excluded parens; lines with
              // parens only inside comments/strings are part of the discriminant content
              if (scanParenDepth === depthBeforeLine && depthBeforeLine > 0 && lineHasNonExcludedParen && !/^\(/.test(prevLine)) {
                break;
              }
              if (/^(type|subtype)\b/.test(prevLine)) {
                // Check if 'protected' or 'task' precedes this type/subtype on a prior line
                // (e.g., "protected\ntype Foo\nis" should be a block, not a type decl)
                if (/^type\b/.test(prevLine)) {
                  let checkPos = prevStart - 1;
                  while (
                    checkPos >= 0 &&
                    (source[checkPos] === ' ' || source[checkPos] === '\t' || source[checkPos] === '\n' || source[checkPos] === '\r')
                  ) {
                    checkPos--;
                  }
                  if (checkPos >= 0) {
                    const checkEnd = checkPos + 1;
                    const checkLineStart = findLineStart(source, checkEnd);
                    const checkToken = source.slice(checkLineStart, checkEnd).toLowerCase().trimEnd();
                    if (/\b(?:protected|task)$/.test(checkToken)) {
                      scanPos = prevStart - 1;
                      if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
                      if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
                      continue;
                    }
                  }
                }
                isTypeDecl = true;
                typeDeclStart = prevStart;
              }
              // Stop scanning at lines that are not type declaration continuations
              // Continue if inside parenthesized discriminant (scanParenDepth > 0) or line starts with (
              // Also continue past plain identifier lines (e.g., type name on its own line)
              if (!isTypeDecl && scanParenDepth <= 0 && !/^\(/.test(prevLine)) {
                // Allow one extra line if this line is just an identifier (type name)
                if (/^[a-zA-Z_][a-zA-Z0-9_]*[ \t]*$/.test(prevLine)) {
                  scanPos = prevStart - 1;
                  if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
                  if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
                  continue;
                }
                break;
              }
              scanPos = prevStart - 1;
              if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
              if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
              if (isTypeDecl) break;
              continue;
            }
            // Move past line terminator to previous line
            scanPos = prevStart - 1;
            if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
            if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          }
          // Only skip if no ';' or new declaration keyword between type/subtype and this 'is'
          // Track parenthesis depth so semicolons inside discriminant parts are ignored
          if (isTypeDecl) {
            let hasSeparator = false;
            let parenDepth = 0;
            for (let si = typeDeclStart; si < startOffset; si++) {
              if (this.isInExcludedRegion(si, excludedRegions)) continue;
              if (source[si] === '(') parenDepth++;
              else if (source[si] === ')') parenDepth--;
              else if (parenDepth === 0) {
                if (source[si] === ';') {
                  hasSeparator = true;
                  break;
                }
                // Check for declaration keywords that start a new statement
                if (/[a-zA-Z]/i.test(source[si]) && (si === 0 || !/[a-zA-Z0-9_]/i.test(source[si - 1]))) {
                  const word = source.slice(si, si + 15).toLowerCase();
                  if (/^(procedure|function|package|task|protected|entry|begin|case|select|loop|for|while|declare|record|if|accept)\b/.test(word)) {
                    hasSeparator = true;
                    break;
                  }
                }
              }
            }
            if (!hasSeparator) {
              continue;
            }
          }
        }
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

    const { tokens: result } = mergeCompoundEndTokens(tokens, compoundEndPositions);

    // Filter out 'or else' and 'and then' short-circuit operators
    const filtered: Token[] = [];
    for (let i = 0; i < result.length; i++) {
      const token = result[i];
      const lowerValue = token.value.toLowerCase();

      // 'or else' short-circuit: remove both 'or' and 'else' tokens
      // In a select block, 'or' and 'else' can be separate intermediates with statements between them.
      // To distinguish: check if only whitespace/comments exist between 'or' and 'else' in source.
      if (lowerValue === 'else' && filtered.length > 0 && filtered[filtered.length - 1].value.toLowerCase() === 'or') {
        const orToken = filtered[filtered.length - 1];
        // In select blocks, 'or' is preceded by ';' (statement-level keyword, not short-circuit)
        let prevPos = orToken.startOffset - 1;
        while (prevPos >= 0 && (source[prevPos] === ' ' || source[prevPos] === '\t' || source[prevPos] === '\n' || source[prevPos] === '\r')) {
          prevPos--;
        }
        while (prevPos >= 0 && this.isInExcludedRegion(prevPos, excludedRegions)) {
          const region = this.findExcludedRegionAt(prevPos, excludedRegions);
          if (region) {
            prevPos = region.start - 1;
            while (prevPos >= 0 && (source[prevPos] === ' ' || source[prevPos] === '\t' || source[prevPos] === '\n' || source[prevPos] === '\r')) {
              prevPos--;
            }
          } else {
            prevPos--;
          }
        }
        const selectStart = prevPos - 5;
        const atSelectKeyword =
          prevPos >= 5 &&
          source.slice(selectStart, prevPos + 1).toLowerCase() === 'select' &&
          (selectStart === 0 || !/[a-zA-Z0-9_]/.test(source[selectStart - 1]));
        if (prevPos >= 0 && (source[prevPos] === ';' || atSelectKeyword)) {
          // 'or' follows a statement or 'select' keyword (select block context), keep both as intermediates
        } else if (isOrElseShortCircuit(source, orToken.endOffset, token.startOffset, (pos) => this.isInExcludedRegion(pos, excludedRegions))) {
          filtered.pop();
          continue;
        }
      }

      // 'and then' short-circuit: 'and' is not a keyword, so scan backward from 'then'
      // skipping whitespace and excluded regions (comments between 'and' and 'then')
      if (lowerValue === 'then') {
        let j = token.startOffset - 1;
        // Skip whitespace, newlines, and excluded regions backward
        while (j >= 0) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            const region = this.findExcludedRegionAt(j, excludedRegions);
            if (region) {
              j = region.start - 1;
            } else {
              j--;
            }
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            j--;
            continue;
          }
          break;
        }
        // Check if the word ending at j is 'and'
        if (j >= 2 && source.slice(j - 2, j + 1).toLowerCase() === 'and') {
          const beforeAnd = j - 3;
          if (beforeAnd < 0 || !/[a-zA-Z0-9_]/.test(source[beforeAnd])) {
            if (!this.isInExcludedRegion(j - 2, excludedRegions)) {
              continue;
            }
          }
        }
      }

      filtered.push(token);
    }

    // Filter out block_middle tokens inside parenthesized expressions
    // (e.g., Ada 2012 conditional expressions: (if A then B else C))
    const cb = this.validationCallbacks;
    return filtered.filter((token) => {
      if (token.type === 'block_middle') {
        return !isInsideParens(source, token.startOffset, excludedRegions, cb);
      }
      return true;
    });
  }

  // Custom matching to handle compound end keywords
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
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            const middleKw = token.value.toLowerCase();
            // 'or' is only a valid intermediate for 'select' blocks
            if (middleKw === 'or') {
              if (topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'when') {
              // 'when' is valid for 'case', 'select', 'begin' (exception), 'entry' (guard), and 'accept' (guard)
              if (topOpener === 'case' || topOpener === 'select' || topOpener === 'begin' || topOpener === 'entry' || topOpener === 'accept') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else if (middleKw === 'then') {
              // 'then' is valid for 'if' and 'select' (select...then abort)
              if (topOpener === 'if' || topOpener === 'select') {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();

          // Check if it's a compound end
          const compoundMatch = closeValue.match(/^end[ \t]+(\S+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            let matchIndex = -1;

            // Special case: 'end loop' can close 'for', 'while', or 'loop'
            if (endType === 'loop') {
              matchIndex = findLastOpenerForLoop(stack);
            } else {
              matchIndex = findLastOpenerByType(stack, endType, true);
            }

            // If no compound match found, try simple end
            if (matchIndex < 0 && stack.length > 0) {
              matchIndex = stack.length - 1;
            }

            if (matchIndex >= 0) {
              // Check if 'begin' is on the stack above the matched opener
              const beginIndex = matchIndex + 1;
              if (
                beginIndex < stack.length &&
                stack[beginIndex].token.value.toLowerCase() === 'begin' &&
                BEGIN_CONTEXT_KEYWORDS.includes(stack[matchIndex].token.value.toLowerCase())
              ) {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(matchIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                const openBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          } else {
            // Simple 'end' or 'end;' - always closes the top of the stack
            if (stack.length === 0) break;

            const top = stack[stack.length - 1];
            const topValue = top.token.value.toLowerCase();

            if (topValue === 'begin') {
              // Check for context keyword immediately before begin
              const beginIndex = stack.length - 1;
              const contextIndex = beginIndex - 1;

              if (contextIndex >= 0 && BEGIN_CONTEXT_KEYWORDS.includes(stack[contextIndex].token.value.toLowerCase())) {
                // Merge context keyword + begin into a single pair
                const contextBlock = stack.splice(contextIndex, 1)[0];
                // beginIndex shifted by -1 after removing contextBlock
                const beginBlock = stack.splice(contextIndex, 1)[0];

                pairs.push({
                  openKeyword: contextBlock.token,
                  closeKeyword: token,
                  intermediates: [...contextBlock.intermediates, beginBlock.token, ...beginBlock.intermediates],
                  nestLevel: stack.length
                });
              } else {
                // No context keyword, just close begin
                const beginBlock = stack.pop();
                if (beginBlock) {
                  pairs.push({
                    openKeyword: beginBlock.token,
                    closeKeyword: token,
                    intermediates: beginBlock.intermediates,
                    nestLevel: stack.length
                  });
                }
              }
            } else {
              // Top is not begin, just close it
              const openBlock = stack.pop();
              if (openBlock) {
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          }
          break;
        }
      }
    }

    return pairs;
  }
}
