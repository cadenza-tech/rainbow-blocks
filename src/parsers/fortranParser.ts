// Fortran block parser: program, subroutine, function, if, do with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = [
  'program',
  'subroutine',
  'function',
  'module',
  'submodule',
  'if',
  'do',
  'select',
  'block',
  'associate',
  'critical',
  'forall',
  'where',
  'interface',
  'type',
  'enum',
  'procedure'
];

// Pattern to match compound end keywords (case insensitive)
const COMPOUND_END_PATTERN = new RegExp(`\\bend[ \\t]*(${COMPOUND_END_TYPES.join('|')})\\b`, 'gi');

export class FortranBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'program',
      'subroutine',
      'function',
      'module',
      'submodule',
      'procedure',
      'if',
      'do',
      'select',
      'block',
      'associate',
      'critical',
      'forall',
      'where',
      'interface',
      'type',
      'enum'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elseif', 'case', 'then', 'contains']
  };

  // Finds excluded regions: comments and strings

  // Validates block open keywords
  // Single-line 'if' (without 'then') is not a block opener
  // 'if' preceded by 'else' on the same line is part of 'else if', not a new block
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();

    // 'type' that's part of 'select type', or 'type is(...)' guard inside select type
    if (lowerKeyword === 'type') {
      const typeLineStart = this.findLineStart(source, position);
      const lineBeforeType = source.slice(typeLineStart, position).toLowerCase().trimEnd();
      if (lineBeforeType.endsWith('select')) {
        return false;
      }
      // Check continuation: select &\n  type
      if (this.isPrecedingContinuationKeyword(source, position, 'select')) {
        return false;
      }
      // 'type is(...)' or 'type is (...)' is a guard in select type, not a block
      const afterKeyword = source.slice(position + keyword.length);
      if (/^\s+is\s*\(/i.test(afterKeyword)) {
        return false;
      }
      // type(name) as type specifier: type(identifier) followed by :: or ,
      if (/^\s*\(/i.test(afterKeyword)) {
        if (this.isTypeSpecifier(source, position + keyword.length)) {
          return false;
        }
      }
    }

    // 'select' must be followed by 'type' or 'case' to be a block opener
    // Handles line continuation with &, including comment-only lines between
    if (lowerKeyword === 'select') {
      let afterSelect = source.slice(position + keyword.length);
      // Collapse & continuation: remove & and trailing content, newline, optional leading &
      // Also collapse any comment-only lines that follow a continuation
      afterSelect = afterSelect.replace(/&[^\r\n]*(?:\r\n|\r|\n)(?:\s*![^\r\n]*(?:\r\n|\r|\n))*\s*&?/g, ' ');
      if (!/^\s+(type|case)\b/i.test(afterSelect)) {
        return false;
      }
    }

    // 'module procedure' inside submodule is not a new module block
    if (lowerKeyword === 'module') {
      const afterModule = source.slice(position + keyword.length);
      if (/^\s+procedure\b/i.test(afterModule)) {
        return false;
      }
    }

    // Type-bound procedure declaration: procedure :: name or procedure, attr :: name
    // Also handles line continuation with &
    if (lowerKeyword === 'procedure') {
      let j = position + keyword.length;
      while (j < source.length) {
        const lineEnd = this.findLineEnd(source, j);
        const lineContent = source.slice(j, lineEnd);
        const colonIdx = lineContent.indexOf('::');
        if (colonIdx >= 0 && !this.isInExcludedRegion(j + colonIdx, excludedRegions)) {
          return false;
        }
        // Strip inline comment before checking for continuation &
        let trimmedLine = lineContent.trimEnd();
        const commentPos = this.findInlineCommentIndex(trimmedLine);
        if (commentPos >= 0) {
          trimmedLine = trimmedLine.slice(0, commentPos).trimEnd();
        }
        if (!trimmedLine.endsWith('&')) {
          break;
        }
        // Skip past line break (\r\n, \n, or standalone \r)
        j = lineEnd;
        if (j < source.length && source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
          j += 2;
        } else if (j < source.length) {
          j++;
        }
      }
    }

    // Single-line where/forall: has (condition) followed by statement on same line
    if (lowerKeyword === 'where' || lowerKeyword === 'forall') {
      return this.isBlockWhereOrForall(source, position, keyword);
    }

    if (lowerKeyword !== 'if') {
      return true;
    }

    // Check if 'if' is preceded by 'else' (making it 'else if', not a new block)
    const ifLineStart = this.findLineStart(source, position);
    const lineBeforeIf = source.slice(ifLineStart, position).toLowerCase().trimEnd();
    if (lineBeforeIf.endsWith('else')) {
      return false;
    }
    // Check continuation: else &\n  if
    if (this.isPrecedingContinuationKeyword(source, position, 'else')) {
      return false;
    }

    // Check if 'then' exists after the 'if', handling & continuation lines
    let i = position + keyword.length;
    while (i < source.length) {
      // Skip excluded regions
      const region = this.findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }

      // Check for 'then' keyword
      if (
        source.slice(i, i + 4).toLowerCase() === 'then' &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1])) &&
        (i + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 4]))
      ) {
        return true;
      }

      // Handle line continuation with &
      // Detect line break: \n or standalone \r (not followed by \n)
      const isLineBreak = source[i] === '\n' || (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n'));
      if (isLineBreak) {
        let j = i - 1;
        // Skip whitespace and excluded regions (comments between & and newline)
        while (j >= 0) {
          const backRegion = this.findExcludedRegionAt(j, excludedRegions);
          if (backRegion) {
            j = backRegion.start - 1;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r') {
            j--;
            continue;
          }
          break;
        }
        if (j >= 0 && source[j] === '&') {
          i++;
          // Skip comment-only continuation lines (& ! comment \n)
          while (i < source.length) {
            // Skip whitespace at start of next line
            while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
              i++;
            }
            // Skip leading & on continuation line (Fortran free-form)
            if (i < source.length && source[i] === '&') {
              i++;
            }
            // If line starts with !, it's a comment-only continuation
            if (i < source.length && source[i] === '!') {
              const commentEnd = this.findLineEnd(source, i);
              i = commentEnd;
              // Skip past the line break
              if (i < source.length) {
                if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
                  i += 2;
                } else {
                  i++;
                }
              }
              continue;
            }
            break;
          }
          continue;
        }
        break;
      }

      i++;
    }

    return false;
  }

  // Check if where/forall is a block form (not single-line)
  // Single-line: where (condition) assignment or forall (spec) assignment
  // Block: where (condition)\n or forall (spec)\n (with optional & continuation)
  private isBlockWhereOrForall(source: string, position: number, keyword: string): boolean {
    let i = position + keyword.length;

    // Skip whitespace before opening paren
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }

    // Must have opening parenthesis
    if (i >= source.length || source[i] !== '(') {
      return false;
    }

    // Find matching closing parenthesis, skipping strings and comments
    let depth = 1;
    i++;
    while (i < source.length && depth > 0) {
      if (source[i] === "'" || source[i] === '"') {
        const quote = source[i];
        i++;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          if (source[i] === quote) {
            if (i + 1 < source.length && source[i + 1] === quote) {
              i += 2;
              continue;
            }
            break;
          }
          i++;
        }
        if (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip ! inline comments (to end of line)
      if (source[i] === '!') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }

    // If no closing paren found, not valid
    if (depth > 0) {
      return false;
    }

    // After the closing paren, check rest of the line
    // If there's non-whitespace content (excluding comments and continuations),
    // it's a single-line form
    while (i < source.length) {
      const ch = source[i];

      // Newline means block form
      if (ch === '\n') {
        return true;
      }

      // Carriage return: standalone \r (not followed by \n) is a line break
      if (ch === '\r') {
        if (i + 1 >= source.length || source[i + 1] !== '\n') {
          return true;
        }
        i++;
        continue;
      }

      // Comment means block form (rest of line is comment)
      if (ch === '!') {
        return true;
      }

      // Line continuation: check what follows on the next line
      if (ch === '&') {
        return this.isContinuationBlockForm(source, i);
      }

      // Whitespace, keep scanning
      if (ch === ' ' || ch === '\t') {
        i++;
        continue;
      }

      // Non-whitespace content after condition = single-line form
      return false;
    }

    // End of source after condition = block form (no assignment follows)
    return true;
  }

  // Validates block close keywords
  // Rejects 'end' used as variable name (followed by = but not ==)
  protected isValidBlockClose(keyword: string, source: string, position: number, _excludedRegions: ExcludedRegion[]): boolean {
    if (keyword.toLowerCase() !== 'end') {
      return true;
    }
    let i = position + keyword.length;
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // end = ... (assignment) but not end == ... (comparison)
    if (i < source.length && source[i] === '=' && (i + 1 >= source.length || source[i + 1] !== '=')) {
      return false;
    }
    // end(1) = ... or end(1)(2) = ... (array element/section assignment)
    if (i < source.length && source[i] === '(') {
      let j = i;
      // Skip consecutive parenthesized groups: end(1)(2)(3)
      while (j < source.length && source[j] === '(') {
        let depth = 1;
        j++;
        while (j < source.length && depth > 0) {
          if (source[j] === '(') depth++;
          else if (source[j] === ')') depth--;
          j++;
        }
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }
      }
      if (j < source.length && source[j] === '=' && (j + 1 >= source.length || source[j + 1] !== '=')) {
        return false;
      }
    }
    return true;
  }

  // Checks if type(name) is a type specifier (variable declaration)
  private isTypeSpecifier(source: string, parenStart: number): boolean {
    let i = parenStart;
    // Skip whitespace before (
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    if (i >= source.length || source[i] !== '(') {
      return false;
    }
    // Find matching closing paren
    let depth = 1;
    i++;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    if (depth > 0) {
      return false;
    }
    // After closing paren, check for :: or , (indicating type specifier)
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    if (i < source.length && source[i] === ':' && i + 1 < source.length && source[i + 1] === ':') {
      return true;
    }
    if (i < source.length && source[i] === ',') {
      return true;
    }
    return false;
  }

  // Checks if a continuation after where/forall paren is block form
  // Single-line spread across lines: where (mask) &\n  a = b
  // Block form: where (mask) &\n  a = b\n  c = d\nend where
  private isContinuationBlockForm(source: string, ampPos: number): boolean {
    let i = ampPos + 1;

    // Follow the chain of continuation lines
    while (true) {
      // Skip to next line break
      i = this.findLineEnd(source, i);
      if (i >= source.length) {
        return true;
      }
      // Skip past line break (\r\n, \n, or standalone \r)
      if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
      // Skip whitespace on continuation line
      while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
        i++;
      }
      // Skip leading & on continuation line
      if (i < source.length && source[i] === '&') {
        i++;
      }
      // Find the end of this continuation line
      const lineStart = i;
      i = this.findLineEnd(source, i);
      let lineContent = source.slice(lineStart, i).trim();
      // If the continuation line is empty, treat as block form
      if (lineContent.length === 0) {
        return true;
      }
      // Strip inline comment before checking for continuation &
      const commentIdx = this.findInlineCommentIndex(lineContent);
      if (commentIdx >= 0) {
        lineContent = lineContent.slice(0, commentIdx).trimEnd();
      }
      // If this line ends with &, it's another continuation - keep following
      if (lineContent.endsWith('&')) {
        continue;
      }
      break;
    }

    // Check if there is a newline after this last continuation line
    // and then more content before end where/forall
    if (i >= source.length) {
      return false;
    }
    // Look at next line to see if it's end where/forall or more statements
    // Skip past line break (\r\n, \n, or standalone \r)
    if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
      i += 2;
    } else {
      i++;
    }
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // If next line starts with 'end where' or 'end forall', it's block form
    if (i < source.length && /^end\s*(where|forall)\b/i.test(source.slice(i))) {
      return true;
    }
    // If next line starts with 'end' (other), this was single-line spread
    if (i < source.length && /^end\b/i.test(source.slice(i))) {
      return false;
    }
    // More statements follow, it's block form
    return true;
  }

  // Finds the index of '!' inline comment in a line, skipping '!' inside strings
  private findInlineCommentIndex(line: string): number {
    let inString = false;
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      if (inString) {
        if (line[i] === quote) {
          if (i + 1 < line.length && line[i + 1] === quote) {
            i++;
            continue;
          }
          inString = false;
        }
        continue;
      }
      if (line[i] === "'" || line[i] === '"') {
        inString = true;
        quote = line[i];
        continue;
      }
      if (line[i] === '!') {
        return i;
      }
    }
    return -1;
  }

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

    // Fixed-form comment: * in column 1, or C/c in column 1 followed by non-identifier char
    if (char === '*' && this.isAtLineStart(source, pos)) {
      return this.matchSingleLineComment(source, pos);
    }
    // Fixed-form: C/c in column 1 is a comment only if followed by non-alphanumeric
    // In free-form code, identifiers like call, character, count start with c/C
    if ((char === 'C' || char === 'c') && this.isAtLineStart(source, pos)) {
      const nextChar = pos + 1 < source.length ? source[pos + 1] : '';
      if (!/[a-zA-Z0-9_]/.test(nextChar)) {
        return this.matchSingleLineComment(source, pos);
      }
    }

    // Single-line comment: ! (Fortran 90+)
    if (char === '!') {
      return this.matchSingleLineComment(source, pos);
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchFortranString(source, pos, "'");
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchFortranString(source, pos, '"');
    }

    return null;
  }

  // Matches Fortran string with specified quote character
  private matchFortranString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === quote) {
        // Check for doubled quote escape
        if (i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // String cannot span multiple lines in standard Fortran
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();

    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      if (!this.isInExcludedRegion(pos, excludedRegions) && !this.isAfterDoubleColon(source, pos, excludedRegions)) {
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

      // Skip keywords on variable declaration lines (after ::)
      if (this.isAfterDoubleColon(source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block open keywords (e.g., skip single-line if)
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block close keywords (e.g., skip end used as variable)
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
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

    // Merge 'else' + 'if' into a single 'else if' blockMiddle token
    const mergedTokens: Token[] = [];
    for (let ti = 0; ti < tokens.length; ti++) {
      const current = tokens[ti];
      if (
        current.value.toLowerCase() === 'else' &&
        current.type === 'block_middle' &&
        ti + 1 < tokens.length &&
        tokens[ti + 1].value.toLowerCase() === 'if' &&
        tokens[ti + 1].type === 'block_open'
      ) {
        // Check they are on the same line
        const textBetween = source.slice(current.endOffset, tokens[ti + 1].startOffset);
        if (/^\s+$/.test(textBetween) && !textBetween.includes('\n') && !textBetween.includes('\r')) {
          mergedTokens.push({
            type: 'block_middle',
            value: source.slice(current.startOffset, tokens[ti + 1].endOffset),
            startOffset: current.startOffset,
            endOffset: tokens[ti + 1].endOffset,
            line: current.line,
            column: current.column
          });
          ti++;
          continue;
        }
      }
      mergedTokens.push(current);
    }

    // Process tokens to handle compound keywords
    const result: Token[] = [];
    const processedCompoundPositions = new Set<number>();

    for (const token of mergedTokens) {
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
        processedCompoundPositions.add(token.startOffset);
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

    // Add concatenated compound end keywords (e.g., enddo, endif) that had no
    // matching 'end' token because \b word boundary doesn't match inside them
    for (const [pos, compound] of compoundEndPositions) {
      if (!processedCompoundPositions.has(pos)) {
        const { line, column } = this.getLineAndColumn(pos, newlinePositions);
        result.push({
          type: 'block_close',
          value: compound.keyword,
          startOffset: pos,
          endOffset: pos + compound.length,
          line,
          column
        });
      }
    }

    // Re-sort by position after adding concatenated forms
    if (compoundEndPositions.size > processedCompoundPositions.size) {
      result.sort((a, b) => a.startOffset - b.startOffset);
    }

    return result;
  }

  // Checks if position is after :: on the same line (variable declaration)
  private isAfterDoubleColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lineStart = this.findLineStart(source, position);
    const lineBefore = source.slice(lineStart, position);
    let searchFrom = 0;
    while (searchFrom < lineBefore.length) {
      const idx = lineBefore.indexOf('::', searchFrom);
      if (idx < 0) return false;
      if (!this.isInExcludedRegion(lineStart + idx, excludedRegions)) {
        return true;
      }
      searchFrom = idx + 2;
    }
    return false;
  }

  // Checks if the previous continuation line ends with the given keyword
  // e.g. for `select &\n  type`, checks if 'select' precedes via &
  private isPrecedingContinuationKeyword(source: string, position: number, keyword: string): boolean {
    const lineStart = this.findLineStart(source, position);
    if (lineStart === 0) return false;

    // Current line before position must be just whitespace/continuation &
    const currentLineBefore = source.slice(lineStart, position).trimStart();
    if (currentLineBefore !== '' && currentLineBefore !== '&') {
      return false;
    }

    // Get previous line: lineStart - 1 is the line break char (\n or \r)
    // If it's \n preceded by \r (CRLF), step back one more
    let prevLineEnd = lineStart - 1;
    if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
      prevLineEnd--;
    }
    const prevLineStart = this.findLineStart(source, prevLineEnd);
    let prevLine = source.slice(prevLineStart, prevLineEnd);
    if (prevLine.endsWith('\r')) {
      prevLine = prevLine.slice(0, -1);
    }
    prevLine = prevLine.trimEnd();

    // Strip inline comment
    const commentIdx = this.findInlineCommentIndex(prevLine);
    if (commentIdx >= 0) {
      prevLine = prevLine.slice(0, commentIdx).trimEnd();
    }

    // Must end with &
    if (!prevLine.endsWith('&')) return false;

    // Check if the content before & ends with the keyword
    const beforeAmp = prevLine.slice(0, -1).trimEnd().toLowerCase();
    if (!beforeAmp.endsWith(keyword)) return false;

    // Ensure it's a whole word
    const keywordStart = beforeAmp.length - keyword.length;
    if (keywordStart > 0 && /[a-zA-Z0-9_]/.test(beforeAmp[keywordStart - 1])) {
      return false;
    }

    return true;
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
    // Track select blocks that have had their first case skipped
    const firstCaseSkipped = new Set<OpenBlock>();

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topBlock = stack[stack.length - 1];
            const middleValue = token.value.toLowerCase();
            const openerValue = topBlock.token.value.toLowerCase();
            // Skip the first case after select case (it's the opening guard)
            if (middleValue === 'case' && openerValue === 'select' && !firstCaseSkipped.has(topBlock)) {
              firstCaseSkipped.add(topBlock);
              break;
            }
            // Restrict intermediates to correct parent block types
            if (middleValue === 'then' && openerValue !== 'if') {
              break;
            }
            if (middleValue === 'case' && openerValue !== 'select') {
              break;
            }
            topBlock.intermediates.push(token);
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();
          let matchIndex = -1;

          // Check if it's a compound end (e.g., "end program", "endprogram")
          const compoundMatch = closeValue.match(/^end\s*(.+)/);
          if (compoundMatch) {
            const endType = compoundMatch[1];
            matchIndex = this.findLastOpenerByType(stack, endType);
          }

          // If no compound match found, only fallback for simple 'end' (not compound end keywords)
          if (matchIndex < 0 && !compoundMatch && stack.length > 0) {
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
          break;
        }
      }
    }

    return pairs;
  }

  // Finds the start of the line containing `position`, handling \n, \r\n, and standalone \r
  private findLineStart(source: string, position: number): number {
    for (let i = position - 1; i >= 0; i--) {
      if (source[i] === '\n') {
        return i + 1;
      }
      if (source[i] === '\r') {
        return i + 1;
      }
    }
    return 0;
  }

  // Finds the end of line from `position`, handling \n, \r\n, and standalone \r
  // Returns the index of the line break character (or source.length if none found)
  private findLineEnd(source: string, position: number): number {
    for (let i = position; i < source.length; i++) {
      if (source[i] === '\n') {
        return i;
      }
      if (source[i] === '\r') {
        return i;
      }
    }
    return source.length;
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
}
