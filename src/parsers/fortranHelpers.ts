// Standalone helper functions for Fortran parser (no class dependency)

import type { ExcludedRegion } from '../types';
import { findLineStart, isInExcludedRegion } from './parserUtils';

// Checks if the character before a line break is & (string continuation)
// Handles inline comments: 'hello & ! comment\n&world'
function isStringContinuation(source: string, lineBreakPos: number): boolean {
  let j = lineBreakPos - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j >= 0 && source[j] === '&') {
    return true;
  }
  // Check if there's a ! comment between & and line break
  // Scan forward from line start, skipping string literals to find the real ! comment
  let lineStart = j;
  while (lineStart >= 0 && source[lineStart] !== '\n' && source[lineStart] !== '\r') {
    lineStart--;
  }
  lineStart++;
  for (let ci = lineStart; ci <= j; ci++) {
    // Skip string literals to avoid finding ! inside strings
    if (source[ci] === "'" || source[ci] === '"') {
      const q = source[ci];
      ci++;
      while (ci <= j) {
        if (source[ci] === q) {
          if (ci + 1 <= j && source[ci + 1] === q) {
            ci++;
          } else {
            break;
          }
        }
        ci++;
      }
      // If string is unterminated on this line, & inside is the continuation marker
      // Scan backward from line end for ! preceded by & (with optional whitespace)
      if (ci > j) {
        for (let si = j; si >= lineStart; si--) {
          if (source[si] === '!') {
            let k = si - 1;
            while (k >= lineStart && (source[k] === ' ' || source[k] === '\t')) {
              k--;
            }
            if (k >= lineStart && source[k] === '&') {
              return true;
            }
          }
        }
        return false;
      }
      continue;
    }
    if (source[ci] === '!') {
      let k = ci - 1;
      while (k >= lineStart && (source[k] === ' ' || source[k] === '\t')) {
        k--;
      }
      return k >= lineStart && source[k] === '&';
    }
  }
  return false;
}

// Matches Fortran string with specified quote character
// Handles & continuation: 'hello &\n      &world'
export function matchFortranString(source: string, pos: number, quote: string): ExcludedRegion {
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
    // String cannot span multiple lines unless continued with &
    if (source[i] === '\n' || source[i] === '\r') {
      // Check if the last non-whitespace char before the line break was &
      if (isStringContinuation(source, i)) {
        // Skip past line break
        if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        // Skip whitespace on next line
        while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
          i++;
        }
        // Skip optional leading & on continuation line
        if (i < source.length && source[i] === '&') {
          i++;
        }
        continue;
      }
      return { start: pos, end: i };
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Collapses Fortran & continuation lines into a single logical line
// Handles: & followed by optional trailing content and newline, intermediate comment-only
// lines, continuation-only lines (just &), and optional leading & on the next content line
export function collapseContinuationLines(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // Find next & outside string literals and comments (Fortran uses '' and "" as escaped quotes)
    let ampIdx = -1;
    for (let k = i; k < text.length; k++) {
      const ch = text[k];
      if (ch === "'" || ch === '"') {
        k++;
        while (k < text.length) {
          if (text[k] === ch) {
            if (k + 1 < text.length && text[k + 1] === ch) {
              k++;
            } else {
              break;
            }
          }
          k++;
        }
        continue;
      }
      // Skip ! inline comment to end of line (& inside comments is not continuation)
      if (ch === '!') {
        while (k < text.length && text[k] !== '\n' && text[k] !== '\r') {
          k++;
        }
        k--;
        continue;
      }
      if (ch === '&') {
        ampIdx = k;
        break;
      }
    }
    if (ampIdx < 0) {
      result += text.slice(i);
      break;
    }
    result += text.slice(i, ampIdx);
    // Skip & and trailing content (up to newline)
    let j = ampIdx + 1;
    while (j < text.length && text[j] !== '\n' && text[j] !== '\r') {
      j++;
    }
    if (j >= text.length) {
      // & at end of text with no newline
      break;
    }
    // Skip past line break
    if (text[j] === '\r' && j + 1 < text.length && text[j + 1] === '\n') {
      j += 2;
    } else {
      j++;
    }
    // Skip intermediate comment-only lines and continuation-only lines
    while (j < text.length) {
      // Skip leading whitespace
      let lineContentStart = j;
      while (lineContentStart < text.length && (text[lineContentStart] === ' ' || text[lineContentStart] === '\t')) {
        lineContentStart++;
      }
      // Comment-only line: starts with !
      if (lineContentStart < text.length && text[lineContentStart] === '!') {
        // Skip to end of line
        let lineEnd = lineContentStart;
        while (lineEnd < text.length && text[lineEnd] !== '\n' && text[lineEnd] !== '\r') {
          lineEnd++;
        }
        // Skip past line break
        if (lineEnd < text.length && text[lineEnd] === '\r' && lineEnd + 1 < text.length && text[lineEnd + 1] === '\n') {
          j = lineEnd + 2;
        } else if (lineEnd < text.length) {
          j = lineEnd + 1;
        } else {
          j = lineEnd;
        }
        continue;
      }
      // Continuation-only line: just & with optional whitespace
      if (lineContentStart < text.length && text[lineContentStart] === '&') {
        let afterAmpCheck = lineContentStart + 1;
        while (afterAmpCheck < text.length && (text[afterAmpCheck] === ' ' || text[afterAmpCheck] === '\t')) {
          afterAmpCheck++;
        }
        if (afterAmpCheck >= text.length || text[afterAmpCheck] === '\n' || text[afterAmpCheck] === '\r' || text[afterAmpCheck] === '!') {
          // Skip inline comment to find the line break
          if (afterAmpCheck < text.length && text[afterAmpCheck] === '!') {
            while (afterAmpCheck < text.length && text[afterAmpCheck] !== '\n' && text[afterAmpCheck] !== '\r') {
              afterAmpCheck++;
            }
          }
          if (afterAmpCheck < text.length && text[afterAmpCheck] === '\r' && afterAmpCheck + 1 < text.length && text[afterAmpCheck + 1] === '\n') {
            j = afterAmpCheck + 2;
          } else if (afterAmpCheck < text.length) {
            j = afterAmpCheck + 1;
          } else {
            j = afterAmpCheck;
          }
          continue;
        }
      }
      break;
    }
    // Skip optional leading & on the continuation line
    let afterSkip = j;
    while (afterSkip < text.length && (text[afterSkip] === ' ' || text[afterSkip] === '\t')) {
      afterSkip++;
    }
    if (afterSkip < text.length && text[afterSkip] === '&') {
      j = afterSkip + 1;
    } else {
      j = afterSkip;
    }
    result += ' ';
    i = j;
  }
  return result;
}

// Finds the end of the line containing the given position
export function findLineEnd(source: string, position: number): number {
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

// Finds the index of the first inline comment (!) outside string literals
export function findInlineCommentIndex(line: string): number {
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

// Checks if the text after a type keyword is a type specifier (has :: or , or function/subroutine)
export function isTypeSpecifier(source: string, parenStart: number): boolean {
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
  // or function/subroutine keywords (type(name) function foo)
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i++;
  }
  if (i < source.length && source[i] === ':' && i + 1 < source.length && source[i + 1] === ':') {
    return true;
  }
  if (i < source.length && source[i] === ',') {
    return true;
  }
  const afterParen = source.slice(i);
  if (/^(recursive|pure|elemental|impure|function|subroutine)\b/i.test(afterParen)) {
    return true;
  }
  return false;
}

// Checks if a continuation line represents a block form (where/forall)
function isContinuationBlockForm(source: string, ampPos: number): boolean {
  let i = ampPos + 1;

  // Follow the chain of continuation lines
  while (true) {
    // Skip to next line break
    i = findLineEnd(source, i);
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
    i = findLineEnd(source, i);
    let lineContent = source.slice(lineStart, i).trim();
    // If the continuation line is empty (no & continuation), the chain has ended
    if (lineContent.length === 0) {
      break;
    }
    // Strip inline comment before checking for continuation &
    const commentIdx = findInlineCommentIndex(lineContent);
    if (commentIdx >= 0) {
      lineContent = lineContent.slice(0, commentIdx).trimEnd();
    }
    // Skip comment-only lines (empty after stripping comment)
    if (lineContent.length === 0 && commentIdx >= 0) {
      continue;
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
  // Skip past line break and comment-only lines
  while (i < source.length) {
    // Skip past line break (\r\n, \n, or standalone \r)
    if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
      i += 2;
    } else {
      i++;
    }
    while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
      i++;
    }
    // Skip comment-only lines
    if (i < source.length && source[i] === '!') {
      i = findLineEnd(source, i);
      continue;
    }
    break;
  }
  // If next line starts with 'end where' or 'end forall', it's block form
  if (i < source.length && /^end[ \t]+(where|forall)\b/i.test(source.slice(i))) {
    return true;
  }
  // If next line starts with 'end' (other), this was single-line spread
  // Match both separated (end do) and concatenated (enddo) forms
  if (
    i < source.length &&
    /^end(do|if|where|forall|program|module|submodule|function|subroutine|block|blockdata|type|select|associate|critical|team|change|enum|interface|procedure|subprogram)?\b/i.test(
      source.slice(i)
    )
  ) {
    return false;
  }
  // More statements follow, it's block form
  return true;
}

// Checks if where/forall is a block form (has condition on same or continued line, then body follows)
export function isBlockWhereOrForall(source: string, position: number, keyword: string): boolean {
  let i = position + keyword.length;

  // Skip whitespace and & continuation before opening paren
  while (i < source.length) {
    if (source[i] === ' ' || source[i] === '\t') {
      i++;
      continue;
    }
    // Handle & continuation: where &\n  (mask > 0)
    if (source[i] === '&') {
      i++;
      // Skip trailing content after & (e.g., inline comments)
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      // Skip past line break
      if (i < source.length && source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
        i += 2;
      } else if (i < source.length) {
        i++;
      }
      continue;
    }
    break;
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
      while (i < source.length) {
        if (source[i] === quote) {
          if (i + 1 < source.length && source[i + 1] === quote) {
            i += 2;
            continue;
          }
          break;
        }
        // Handle & continuation inside strings
        if (source[i] === '\n' || source[i] === '\r') {
          if (isStringContinuation(source, i)) {
            if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
              i += 2;
            } else {
              i++;
            }
            while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
              i++;
            }
            if (i < source.length && source[i] === '&') {
              i++;
            }
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
      return isContinuationBlockForm(source, i);
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

// Checks if a keyword on a continuation line was preceded by a specific keyword (e.g., select & \n type)
export function isPrecedingContinuationKeyword(source: string, position: number, keyword: string): boolean {
  const currentLineStart = findLineStart(source, position);
  if (currentLineStart === 0) return false;

  // Current line before position must be just whitespace/continuation &
  const currentLineBefore = source.slice(currentLineStart, position).trimStart();
  if (currentLineBefore !== '' && !/^&[ \t]*$/.test(currentLineBefore)) {
    return false;
  }

  // Scan backward, skipping comment-only lines
  let prevLineEnd = currentLineStart - 1;
  if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
    prevLineEnd--;
  }

  while (prevLineEnd >= 0) {
    const prevLineStart = findLineStart(source, prevLineEnd);
    let prevLine = source.slice(prevLineStart, prevLineEnd);
    if (prevLine.endsWith('\r')) {
      prevLine = prevLine.slice(0, -1);
    }
    prevLine = prevLine.trimEnd();

    // Strip inline comment
    const commentIdx = findInlineCommentIndex(prevLine);
    if (commentIdx >= 0) {
      prevLine = prevLine.slice(0, commentIdx).trimEnd();
    }

    // Skip comment-only lines (empty after stripping comment)
    if (prevLine.length === 0) {
      prevLineEnd = prevLineStart - 1;
      if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
        prevLineEnd--;
      }
      continue;
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

  return false;
}

// Checks if a keyword position is after :: (type declaration context)
export function isAfterDoubleColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  const lineStart = findLineStart(source, position);
  const lineBefore = source.slice(lineStart, position);
  let searchFrom = 0;
  while (searchFrom < lineBefore.length) {
    const idx = lineBefore.indexOf('::', searchFrom);
    if (idx < 0) break;
    if (!isInExcludedRegion(lineStart + idx, excludedRegions)) {
      return true;
    }
    searchFrom = idx + 2;
  }

  // Check preceding continuation lines connected by &
  let prevLineEnd = lineStart - 1;
  // Adjust for \r\n
  if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
    prevLineEnd--;
  }
  while (prevLineEnd >= 0) {
    const prevLineStart = findLineStart(source, prevLineEnd);
    let prevLine = source.slice(prevLineStart, prevLineEnd);
    if (prevLine.endsWith('\r')) {
      prevLine = prevLine.slice(0, -1);
    }
    // Strip inline comment before checking for continuation &
    const commentIdx = findInlineCommentIndex(prevLine);
    let contentLine = prevLine;
    if (commentIdx >= 0) {
      contentLine = prevLine.slice(0, commentIdx);
    }
    const trimmedContent = contentLine.trimEnd();
    // If previous line does not end with &, stop searching
    if (!trimmedContent.endsWith('&')) {
      break;
    }
    // Check this continuation line for ::
    const fullPrevLine = source.slice(prevLineStart, prevLineEnd);
    let prevSearchFrom = 0;
    while (prevSearchFrom < fullPrevLine.length) {
      const idx = fullPrevLine.indexOf('::', prevSearchFrom);
      if (idx < 0) break;
      if (!isInExcludedRegion(prevLineStart + idx, excludedRegions)) {
        return true;
      }
      prevSearchFrom = idx + 2;
    }
    // Move to the line before this one
    prevLineEnd = prevLineStart - 1;
    if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
      prevLineEnd--;
    }
  }

  return false;
}

// Matches 'else where' (with possible continuation) for block middle detection
export function matchElseWhere(source: string, afterElse: number, excludedRegions: ExcludedRegion[]): { whereStart: number; end: number } | null {
  const afterElseText = source.slice(afterElse);
  // Same line: whitespace then 'where' word boundary (regex anchored at ^, so index is always 0)
  const sameLineMatch = afterElseText.match(/^([ \t]+)(where)\b/i);
  if (sameLineMatch) {
    const whereStart = afterElse + sameLineMatch[1].length;
    if (!isInExcludedRegion(whereStart, excludedRegions)) {
      return { whereStart, end: whereStart + sameLineMatch[2].length };
    }
  }
  // Continuation: &[optional comment]\n[optional comment lines][optional &] where
  const contMatch = afterElseText.match(/^([ \t]*&[ \t]*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:[ \t]*![^\r\n]*(?:\r\n|\r|\n))*[ \t]*&?[ \t]*)(where)\b/i);
  if (contMatch) {
    const whereStart = afterElse + contMatch[1].length;
    if (!isInExcludedRegion(whereStart, excludedRegions)) {
      return { whereStart, end: whereStart + contMatch[2].length };
    }
  }
  return null;
}
