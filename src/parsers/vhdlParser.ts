// VHDL block parser: entity, architecture, process, if with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastOpenerByType, findLastOpenerForLoop, findLineStart, getTokenTypeCaseInsensitive, mergeCompoundEndTokens } from './parserUtils';
import { matchVhdlBlockComment, matchVhdlCharacterLiteral, matchVhdlString } from './vhdlHelpers';
import type { VhdlValidationCallbacks } from './vhdlValidation';
import {
  isInSignalAssignment,
  isInsideParens,
  isValidComponentOpen,
  isValidEntityOrConfigOpen,
  isValidForOpen,
  isValidFuncProcOpen,
  isValidLoopOpen,
  isValidWhileOpen
} from './vhdlValidation';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = [
  'entity',
  'architecture',
  'process',
  'if',
  'case',
  'loop',
  'function',
  'procedure',
  'package',
  'component',
  'generate',
  'block',
  'record',
  'configuration',
  'protected',
  'for',
  'units'
];

// Pattern to match compound end keywords (case insensitive)
// Only allow spaces/tabs between 'end' and the type keyword (same line only)
// Pattern includes 'postponed process' for 'end postponed process' syntax
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]+(postponed[ \\t]+process|${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

// Keywords that can be followed by 'generate'
const GENERATE_PREFIX_KEYWORDS = ['for', 'while', 'if', 'case'];

export class VhdlBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'entity',
      'architecture',
      'process',
      'if',
      'case',
      'loop',
      'for',
      'while',
      'function',
      'procedure',
      'package',
      'component',
      'generate',
      'block',
      'record',
      'configuration',
      'protected',
      'units'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'is', 'begin']
  };

  private get validationCallbacks(): VhdlValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Validates if 'loop' keyword is a valid block opener
  // 'loop' is invalid if preceded by 'for' or 'while' on the same line
  // (because the 'for' or 'while' is the actual block opener for 'end loop')
  // 'generate' is always valid because we handle 'for/while/if generate' specially in matchBlocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const cb = this.validationCallbacks;

    // Reject keywords preceded by '.' (library path like work.process or work . process)
    let dotPos = position - 1;
    while (dotPos >= 0 && (source[dotPos] === ' ' || source[dotPos] === '\t')) {
      dotPos--;
    }
    if (dotPos >= 0 && source[dotPos] === '.') {
      return false;
    }

    // Reject keywords inside parenthesized expressions (port maps, generic maps, function calls)
    if (isInsideParens(source, position, excludedRegions, cb)) {
      return false;
    }

    if (lowerKeyword === 'for') {
      return isValidForOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'entity' || lowerKeyword === 'configuration') {
      return isValidEntityOrConfigOpen(lowerKeyword, source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return isValidFuncProcOpen(keyword, source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'loop') {
      return isValidLoopOpen(source, position, excludedRegions, cb);
    }

    // Reject 'while' preceded by 'wait' (wait while is not a block construct)
    if (lowerKeyword === 'while') {
      return isValidWhileOpen(source, position, excludedRegions, cb);
    }

    // Reject 'component' preceded by ':' (label: component instantiation, not declaration)
    if (lowerKeyword === 'component') {
      return isValidComponentOpen(source, position, excludedRegions, cb);
    }

    return true;
  }

  protected isValidBlockClose(_keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    // Reject 'end' preceded by '.' (hierarchical reference like inst.end)
    let dotPos = position - 1;
    while (dotPos >= 0 && (source[dotPos] === ' ' || source[dotPos] === '\t')) {
      dotPos--;
    }
    if (dotPos >= 0 && source[dotPos] === '.') {
      return false;
    }
    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Block comment: /* ... */ (VHDL-2008)
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      return matchVhdlBlockComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchVhdlString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return matchVhdlCharacterLiteral(source, pos);
    }

    // VHDL-93 extended identifier: \keyword\ (backslash-delimited)
    if (char === '\\') {
      let i = pos + 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          // Check for doubled backslash escape (\\) inside extended identifier
          if (i + 1 < source.length && source[i + 1] === '\\') {
            i += 2;
            continue;
          }
          return { start: pos, end: i + 1 };
        }
        // Extended identifiers cannot span lines
        if (source[i] === '\n' || source[i] === '\r') {
          return { start: pos, end: i };
        }
        i++;
      }
      return { start: pos, end: source.length };
    }

    return null;
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // First, find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();

    // Reset the pattern's lastIndex
    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      // Check if in excluded region
      if (!this.isInExcludedRegion(pos, excludedRegions) && this.isValidBlockClose(match[0], source, pos, excludedRegions)) {
        const fullMatch = match[0];
        // Use last word for multi-word matches like 'postponed process' -> 'process'
        const endTypeParts = match[1].toLowerCase().split(/[ \t]+/);
        const endType = endTypeParts[endTypeParts.length - 1];
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

      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Skip 'is' in type/subtype/alias declarations (not block-level 'is')
      // Uses statement-based detection: finds the last unquoted semicolon on the line
      // and checks if the text after it starts with a declaration keyword
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = findLineStart(source, startOffset);
        const lineSlice = source.slice(lineStart, startOffset);
        // Find last unquoted semicolon on the line to get the current statement start
        let stmtStart = 0;
        for (let si = 0; si < lineSlice.length; si++) {
          if (this.isInExcludedRegion(lineStart + si, excludedRegions)) continue;
          if (lineSlice[si] === ';') {
            stmtStart = si + 1;
          }
        }
        const stmtBefore = lineSlice.slice(stmtStart).toLowerCase().trimStart();
        if (/^(type|subtype|alias|attribute|file|group)\b/.test(stmtBefore)) {
          continue;
        }
        // Check previous lines for type/subtype declaration (multi-line case)
        // e.g., "type state_t\n  is (idle, active);"
        if (stmtBefore.length === 0 || /^\(/.test(stmtBefore)) {
          let skipThisIs = false;
          let scanPos = lineStart - 1;
          if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
          if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          let linesChecked = 0;
          while (scanPos >= 0 && linesChecked < 2) {
            const prevLineStart = findLineStart(source, scanPos);
            const prevLine = source
              .slice(prevLineStart, scanPos + 1)
              .toLowerCase()
              .trimStart();
            if (prevLine.length > 0) {
              // Skip comment-only lines (single-line -- or block comment /* ... */)
              const isCommentOnlyLine =
                /^--/.test(prevLine) ||
                (() => {
                  // Check if all non-whitespace characters on this line are inside excluded regions
                  for (let ci = prevLineStart; ci <= scanPos; ci++) {
                    if (source[ci] === ' ' || source[ci] === '\t' || source[ci] === '\r' || source[ci] === '\n') continue;
                    if (!this.isInExcludedRegion(ci, excludedRegions)) return false;
                  }
                  return true;
                })();
              if (isCommentOnlyLine) {
                scanPos = prevLineStart - 1;
                if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
                if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
                continue;
              }
              if (/^(type|subtype|alias|attribute|file|group)\b/.test(prevLine)) {
                // Check no semicolon between declaration and this 'is'
                let hasSemicolon = false;
                for (let si = prevLineStart; si < startOffset; si++) {
                  if (this.isInExcludedRegion(si, excludedRegions)) continue;
                  if (source[si] === ';') {
                    hasSemicolon = true;
                    break;
                  }
                }
                if (!hasSemicolon) {
                  skipThisIs = true;
                }
                break;
              }
              // Content line that doesn't match declaration → continue scanning upward
              scanPos = prevLineStart - 1;
              if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
              if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
              linesChecked++;
              continue;
            }
            scanPos = prevLineStart - 1;
            if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
            if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
            linesChecked++;
          }
          if (skipThisIs) {
            continue;
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

    // Filter out block_middle tokens inside parenthesized expressions and
    // when/else in conditional signal assignments (sig <= val when cond else val)
    const cb = this.validationCallbacks;
    return result.filter((token) => {
      if (token.type !== 'block_middle') return true;
      // Reject block_middle keywords inside parenthesized expressions (port maps, generic maps, function calls)
      if (isInsideParens(source, token.startOffset, excludedRegions, cb)) {
        return false;
      }
      const kw = token.value.toLowerCase();
      // Filter 'when' in 'exit when' and 'next when' statements (may span lines)
      if (kw === 'when') {
        let p = token.startOffset - 1;
        while (p >= 0) {
          const region = this.findExcludedRegionAt(p, excludedRegions);
          if (region) {
            p = region.start - 1;
            continue;
          }
          if (source[p] === ' ' || source[p] === '\t' || source[p] === '\n' || source[p] === '\r') {
            p--;
            continue;
          }
          break;
        }
        if (p >= 3) {
          const prevWord = source.slice(p - 3, p + 1).toLowerCase();
          if ((prevWord === 'exit' || prevWord === 'next') && (p - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[p - 4]))) {
            return false;
          }
        }
      }
      if (kw !== 'when' && kw !== 'else') return true;
      return !isInSignalAssignment(source, token.startOffset, excludedRegions, kw, cb);
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
            // 'when' is only valid as intermediate for 'case' blocks
            // In case-generate, stack is [case, generate] - attach when to case
            if (token.value.toLowerCase() === 'when') {
              if (topOpener === 'case') {
                stack[stack.length - 1].intermediates.push(token);
              } else if (topOpener === 'generate' && stack.length >= 2 && stack[stack.length - 2].token.value.toLowerCase() === 'case') {
                stack[stack.length - 2].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();

          // Check if it's a compound end
          const compoundMatch = closeValue.match(/^end[ \t]+(?:\S+[ \t]+)*(\S+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];

            // Special case: 'end generate' closes all 'generate' blocks in the chain
            // (for elsif/else generate chains, multiple generate blocks stack up)
            if (endType === 'generate') {
              let generateIndex = findLastOpenerByType(stack, 'generate', true);

              while (generateIndex >= 0) {
                // Check for control keyword immediately before generate
                const controlIndex = generateIndex - 1;
                let controlBlock: OpenBlock | null = null;

                if (controlIndex >= 0 && GENERATE_PREFIX_KEYWORDS.includes(stack[controlIndex].token.value.toLowerCase())) {
                  controlBlock = stack[controlIndex];
                }

                // Close the generate block
                const generateBlock = stack.splice(generateIndex, 1)[0];
                pairs.push({
                  openKeyword: generateBlock.token,
                  closeKeyword: token,
                  intermediates: generateBlock.intermediates,
                  nestLevel: stack.length
                });

                // Close control keyword if present (index shifted after splice)
                if (controlBlock) {
                  stack.splice(controlIndex, 1);
                  pairs.push({
                    openKeyword: controlBlock.token,
                    closeKeyword: token,
                    intermediates: controlBlock.intermediates,
                    nestLevel: stack.length
                  });
                  // Stop after closing the root control keyword (if/for/while/case)
                  // to avoid closing outer generate chains
                  break;
                }

                // Continue: close more generate blocks in the elsif/else chain
                generateIndex = findLastOpenerByType(stack, 'generate', true);
              }
            } else {
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
            // Simple 'end' without type
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
          break;
        }
      }
    }

    return pairs;
  }
}
