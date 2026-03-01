// VHDL block parser: entity, architecture, process, if with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

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
  'for'
];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]+(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

// Keywords that can be followed by 'loop' or 'generate'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];
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
      'protected'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'is', 'begin']
  };

  // Validates if 'loop' keyword is a valid block opener
  // 'loop' is invalid if preceded by 'for' or 'while' on the same line
  // (because the 'for' or 'while' is the actual block opener for 'end loop')
  // 'generate' is always valid because we handle 'for/while/if generate' specially in matchBlocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();

    // Reject keywords preceded by '.' (library path like work.process)
    if (position > 0 && source[position - 1] === '.') {
      return false;
    }

    // 'wait for' is a timing statement, not a for-loop block
    if (lowerKeyword === 'for') {
      const textBefore = source.slice(0, position).toLowerCase();
      const lastNewline = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
      const lineStart = lastNewline + 1;
      const rawLineBefore = textBefore.slice(lineStart);
      const lineBefore = rawLineBefore.trimStart();
      const trimOffset = rawLineBefore.length - lineBefore.length;
      // Strip trailing comments (-- ...) before checking for wait
      const lineBeforeNoComment = this.stripTrailingComment(lineBefore, lineStart + trimOffset, excludedRegions);
      if (this.isWaitBeforeFor(lineBeforeNoComment, lineStart, rawLineBefore, excludedRegions)) {
        return false;
      }
      // Check previous lines for 'wait' (multi-line wait for, skip blank lines)
      if (/^\s*$/.test(lineBefore) && lastNewline > 0) {
        let scanEnd = lastNewline;
        // Skip the \r in \r\n pairs
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        for (let attempt = 0; attempt < 5; attempt++) {
          const prevNl = Math.max(textBefore.lastIndexOf('\n', scanEnd - 1), textBefore.lastIndexOf('\r', scanEnd - 1));
          const rawPrevLine = textBefore.slice(prevNl + 1, scanEnd);
          const prevLine = rawPrevLine.trimStart();
          if (/^\s*$/.test(prevLine)) {
            if (prevNl <= 0) break;
            scanEnd = prevNl;
            if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
              scanEnd--;
            }
            continue;
          }
          const prevTrimOffset = rawPrevLine.length - prevLine.length;
          const prevLineNoComment = this.stripTrailingComment(prevLine, prevNl + 1 + prevTrimOffset, excludedRegions);
          if (this.isWaitBeforeFor(prevLineNoComment, prevNl + 1, rawPrevLine, excludedRegions)) {
            return false;
          }
          break;
        }
      }
    }

    // 'use entity' is direct instantiation/component configuration, not entity block
    // 'label: entity' is direct entity instantiation (VHDL-93+), not entity block
    if (lowerKeyword === 'entity' || lowerKeyword === 'configuration') {
      const textBefore = source.slice(0, position).toLowerCase();
      const lastNl = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
      const lineBefore = textBefore.slice(lastNl + 1);
      if (/\buse[ \t]+$/.test(lineBefore)) {
        return false;
      }
      if (lowerKeyword === 'entity') {
        if (/:\s*$/.test(lineBefore)) {
          return false;
        }
        if (/^\s*$/.test(lineBefore.trimEnd()) && lastNl > 0) {
          const prevNl = Math.max(textBefore.lastIndexOf('\n', lastNl - 1), textBefore.lastIndexOf('\r', lastNl - 1));
          const prevLine = textBefore.slice(prevNl + 1, lastNl);
          if (/:\s*$/.test(prevLine)) {
            return false;
          }
        }
      }
    }

    // function/procedure declarations (ending with ;) are not blocks
    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      let j = position + keyword.length;
      let parenDepth = 0;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === '(') parenDepth++;
        else if (source[j] === ')') parenDepth--;
        else if (parenDepth === 0) {
          if (source[j] === ';') return false;
          const twoChars = source.slice(j, j + 2).toLowerCase();
          if (
            twoChars === 'is' &&
            (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) &&
            (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))
          ) {
            return true;
          }
        }
        j++;
      }
      return false;
    }

    if (lowerKeyword !== 'loop') {
      return true;
    }

    // Reject 'loop' preceded by a dot (e.g., record.loop or record . loop)
    let dotCheck = position - 1;
    while (dotCheck >= 0 && (source[dotCheck] === ' ' || source[dotCheck] === '\t')) {
      dotCheck--;
    }
    if (dotCheck >= 0 && source[dotCheck] === '.') {
      return false;
    }

    // Look backwards across multiple lines to find if a prefix keyword precedes this
    const textBefore = source.slice(0, position).toLowerCase();
    // Split on \r\n, \r, or \n to handle all line ending types
    const lines = textBefore.split(/\r\n|\r|\n/);
    const maxLines = Math.min(lines.length, 5);

    // Calculate absolute offsets for each line
    let lineStartOffset = textBefore.length;
    for (let idx = 0; idx < maxLines; idx++) {
      const lineIdx = lines.length - 1 - idx;
      const lineText = lines[lineIdx];
      if (idx > 0) {
        // Account for the line terminator (1 for \n or \r, 2 for \r\n)
        if (lineStartOffset >= 2 && source[lineStartOffset - 2] === '\r' && source[lineStartOffset - 1] === '\n') {
          lineStartOffset -= 2;
        } else {
          lineStartOffset -= 1;
        }
      }
      lineStartOffset -= lineText.length;

      for (const prefix of LOOP_PREFIX_KEYWORDS) {
        const pattern = new RegExp(`\\b${prefix}\\b`, 'g');
        for (const prefixMatch of lineText.matchAll(pattern)) {
          const absolutePos = lineStartOffset + prefixMatch.index;
          if (this.isInExcludedRegion(absolutePos, excludedRegions)) {
            continue;
          }
          // If the line also contains 'loop' not in excluded region, the for/while is already paired
          // Skip 'loop' that is part of 'end loop' (not a real loop opener)
          const loopPattern = /\bloop\b/g;
          for (const loopMatch of lineText.matchAll(loopPattern)) {
            const loopAbsPos = lineStartOffset + loopMatch.index;
            if (this.isInExcludedRegion(loopAbsPos, excludedRegions)) {
              continue;
            }
            // Check if this 'loop' is preceded by 'end' (part of 'end loop')
            const beforeLoop = lineText.slice(0, loopMatch.index).trimEnd();
            if (/\bend$/i.test(beforeLoop)) {
              continue;
            }
            return true;
          }
          return false;
        }
      }

      // Stop at a previous statement (indicated by semicolon not in excluded region)
      if (idx > 0) {
        for (let ci = 0; ci < lineText.length; ci++) {
          if (lineText[ci] === ';' && !this.isInExcludedRegion(lineStartOffset + ci, excludedRegions)) {
            return true;
          }
        }
      }
    }

    return true;
  }

  // Strips trailing comment content from a line using excluded regions
  // textAbsOffset is the absolute offset where lineText starts in the source
  private stripTrailingComment(lineText: string, textAbsOffset: number, excludedRegions: ExcludedRegion[]): string {
    for (let ci = 0; ci < lineText.length - 1; ci++) {
      if (lineText[ci] === '-' && lineText[ci + 1] === '-') {
        const absPos = textAbsOffset + ci;
        // Only strip if this is the start of a comment (excluded region starts here)
        // not if we're inside a string (excluded region starts before here)
        const region = this.findExcludedRegionAt(absPos, excludedRegions);
        if (region && region.start === absPos) {
          return lineText.slice(0, ci).trimEnd();
        }
      }
    }
    return lineText;
  }

  // Checks if 'wait' at the end of line text is a real wait statement
  // (not inside an excluded region like a string or comment)
  private isWaitBeforeFor(trimmedLineText: string, lineAbsOffset: number, rawLineText: string, excludedRegions: ExcludedRegion[]): boolean {
    const match = /\bwait\b/.exec(trimmedLineText);
    if (!match) {
      return false;
    }
    // Compute absolute position of 'wait' by accounting for trimmed whitespace
    const trimOffset = rawLineText.length - rawLineText.trimStart().length;
    const waitAbsPos = lineAbsOffset + trimOffset + match.index;
    if (this.isInExcludedRegion(waitAbsPos, excludedRegions)) {
      return false;
    }
    // Check if wait statement is terminated by semicolon (completed statement)
    // e.g., "wait; for ..." means the wait is complete, for is a real loop
    const afterWait = trimmedLineText.slice(match.index + 4);
    for (let ci = 0; ci < afterWait.length; ci++) {
      if (afterWait[ci] === ';') {
        const semiAbsPos = waitAbsPos + 4 + ci;
        if (!this.isInExcludedRegion(semiAbsPos, excludedRegions)) {
          return false;
        }
      }
    }
    return true;
  }

  // Finds excluded regions: comments and strings
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Block comment: /* ... */ (VHDL-2008)
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchBlockComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchVhdlString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return this.matchCharacterLiteral(source, pos);
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

  // Matches block comment: /* ... */
  private matchBlockComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    while (i < source.length) {
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === '/') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches VHDL string: "..."
  private matchVhdlString(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '"') {
        // Check for doubled quote escape ""
        if (i + 1 < source.length && source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in VHDL
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches character literal: 'x' (single character only)
  private matchCharacterLiteral(source: string, pos: number): ExcludedRegion {
    // Character literal is 'x' where x is a single character
    // It could also be an attribute tick, so we need to be careful
    if (pos + 2 < source.length && source[pos + 2] === "'") {
      // Qualified expression: type_name'(expr) — tick before '(' preceded by identifier
      // is not a character literal, treat as attribute tick
      if (source[pos + 1] === '(' && pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) {
        return { start: pos, end: pos + 1 };
      }
      return { start: pos, end: pos + 3 };
    }
    // Attribute tick: skip the attribute name to avoid matching keywords
    let i = pos + 1;
    while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    return { start: pos, end: i };
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
      if (!this.isInExcludedRegion(pos, excludedRegions)) {
        const fullMatch = match[0];
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
      const type = this.getTokenTypeCaseInsensitive(keyword);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
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

    // Process tokens to handle compound keywords
    const result: Token[] = [];

    for (const token of tokens) {
      // Check if this token is the start of a compound end
      const compound = compoundEndPositions.get(token.startOffset);
      if (compound && token.value.toLowerCase() === 'end') {
        // Replace with compound keyword
        result.push({
          ...token,
          value: compound.keyword,
          endOffset: token.startOffset + compound.length,
          type: 'block_close'
        });
        continue;
      }

      // Check if this token should be skipped (it's the type part of compound end)
      let shouldSkip = false;
      for (const [endPos, comp] of compoundEndPositions) {
        if (token.startOffset > endPos && token.startOffset < endPos + comp.length && token.value.toLowerCase() === comp.endType) {
          shouldSkip = true;
          break;
        }
      }

      if (!shouldSkip) {
        result.push(token);
      }
    }

    // Filter out when/else in conditional signal assignments (sig <= val when cond else val)
    return result.filter((token) => {
      if (token.type !== 'block_middle') return true;
      const kw = token.value.toLowerCase();
      if (kw !== 'when' && kw !== 'else') return true;
      return !this.isInSignalAssignment(source, token.startOffset, excludedRegions, kw);
    });
  }

  // Checks if position is within a signal assignment (has <= before it in the same statement)
  // keyword parameter indicates which keyword ('when' or 'else') is being checked
  private isInSignalAssignment(source: string, position: number, excludedRegions: ExcludedRegion[], keyword: string): boolean {
    // Search backwards for <= or statement/block boundaries
    const lowerSource = source.toLowerCase();
    let i = position - 1;
    let foundWhen = false;
    while (i >= 0) {
      // Skip over excluded regions (comments, strings)
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.start - 1;
        continue;
      }
      const ch = source[i];
      if (ch === ';') return false;
      // Track 'when' keyword presence (conditional signal assignments require when before else)
      if (i >= 3) {
        const whenSlice = lowerSource.slice(i - 3, i + 1);
        if (
          whenSlice === 'when' &&
          (i - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 4])) &&
          (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
        ) {
          foundWhen = true;
        }
      }
      if (ch === '=' && i > 0 && source[i - 1] === '<') {
        // For 'when': finding <= is sufficient (first when in conditional assignment)
        // For 'else': require a 'when' between <= and else
        return keyword === 'when' || foundWhen;
      }
      // Variable assignment :=
      if (ch === '=' && i > 0 && source[i - 1] === ':') {
        return keyword === 'when' || foundWhen;
      }
      // 'return' starts a conditional expression context (return X when C else Y)
      if (i >= 5) {
        const retSlice = lowerSource.slice(i - 5, i + 1);
        if (
          retSlice === 'return' &&
          (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
          (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
        ) {
          return keyword === 'when' || foundWhen;
        }
      }
      // Stop at block boundary keywords that start a new context
      // Note: 'else'/'elsif' are NOT boundaries here because chained conditional
      // signal assignments use else (e.g., sig <= a when c1 else b when c2 else c;)
      // The 'then' keyword already acts as a boundary for if branches.
      for (const boundary of ['then', 'begin', 'loop', 'generate', 'is']) {
        const len = boundary.length;
        if (i >= len - 1) {
          const start = i - len + 1;
          if (
            lowerSource.slice(start, start + len) === boundary &&
            (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) &&
            (start + len >= source.length || !/[a-zA-Z0-9_]/.test(source[start + len]))
          ) {
            return false;
          }
        }
      }
      i--;
    }
    return false;
  }

  // Returns the token type for a keyword (case-insensitive)
  private getTokenTypeCaseInsensitive(keyword: string): 'block_open' | 'block_close' | 'block_middle' {
    const lowerKeyword = keyword.toLowerCase();
    if (this.keywords.blockClose.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_close';
    }
    if (this.keywords.blockMiddle.some((k) => k.toLowerCase() === lowerKeyword)) {
      return 'block_middle';
    }
    return 'block_open';
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
          const compoundMatch = closeValue.match(/^end\s+(\S+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];

            // Special case: 'end generate' closes all 'generate' blocks in the chain
            // (for elsif/else generate chains, multiple generate blocks stack up)
            if (endType === 'generate') {
              let generateIndex = this.findLastOpenerByType(stack, 'generate');

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
                generateIndex = this.findLastOpenerByType(stack, 'generate');
              }
            } else {
              let matchIndex = -1;

              // Special case: 'end loop' can close 'for', 'while', or 'loop'
              if (endType === 'loop') {
                matchIndex = this.findLastOpenerForLoop(stack);
              } else {
                matchIndex = this.findLastOpenerByType(stack, endType);
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

  // Find the last opener that matches the given type
  private findLastOpenerByType(stack: OpenBlock[], endType: string): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].token.value.toLowerCase() === endType) {
        return i;
      }
    }
    return -1;
  }

  // Find the last opener for 'end loop' (can be 'for', 'while', or 'loop')
  private findLastOpenerForLoop(stack: OpenBlock[]): number {
    const validOpeners = ['for', 'while', 'loop'];
    for (let i = stack.length - 1; i >= 0; i--) {
      if (validOpeners.includes(stack[i].token.value.toLowerCase())) {
        return i;
      }
    }
    return -1;
  }
}
