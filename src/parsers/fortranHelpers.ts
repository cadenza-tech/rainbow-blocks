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
    // Skip intermediate comment-only lines, blank lines, and continuation-only lines
    while (j < text.length) {
      // Skip leading whitespace
      let lineContentStart = j;
      while (lineContentStart < text.length && (text[lineContentStart] === ' ' || text[lineContentStart] === '\t')) {
        lineContentStart++;
      }
      // Blank line: only whitespace followed by line break (or EOF)
      if (lineContentStart >= text.length) {
        j = lineContentStart;
        continue;
      }
      if (text[lineContentStart] === '\n' || text[lineContentStart] === '\r') {
        if (text[lineContentStart] === '\r' && lineContentStart + 1 < text.length && text[lineContentStart + 1] === '\n') {
          j = lineContentStart + 2;
        } else {
          j = lineContentStart + 1;
        }
        continue;
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
  if (i < source.length && /^end[ \t]*(where|forall)\b/i.test(source.slice(i))) {
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
      // Process continuation lines: skip whitespace, leading &, comment-only lines, blank lines
      while (i < source.length) {
        while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
          i++;
        }
        if (i < source.length && source[i] === '&') {
          i++;
          while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
            i++;
          }
        }
        // Comment-only continuation line: skip to end and process next line
        if (i < source.length && source[i] === '!') {
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
            i++;
          }
          if (i < source.length && source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
            i += 2;
          } else if (i < source.length) {
            i++;
          }
          continue;
        }
        // Bare continuation line (empty after &): skip newline and process next line
        if (i < source.length && (source[i] === '\n' || source[i] === '\r')) {
          if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }

  // Must have opening parenthesis
  if (i >= source.length || source[i] !== '(') {
    return false;
  }

  // Reject empty parens `where ()` / `forall ()`. Both constructs require a non-empty
  // expression: where(MASK), forall(IDX = ...). Empty content (only whitespace and
  // comments / continuation lines) is invalid.
  // Note: this lookahead is a quick check for the trivial case `()`. The full
  // emptiness check below also runs after parenthesis matching to handle
  // `( ! comment\n  & \n)` etc.
  const openParenContentStart = i + 1;
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

  // Reject empty parens (only whitespace / comments / continuations between `(` and `)`).
  // i now points one past the matching `)`; (i - 1) is the `)` itself. The content span
  // is [openParenContentStart, i - 1).
  const innerContent = source.slice(openParenContentStart, i - 1);
  // Strip Fortran inline comments and `&` continuation tokens, then check for any
  // non-whitespace character. This treats `(! comment)`, `(  &\n  & )`, etc. as empty.
  const strippedInner = innerContent
    .split(/(?:\r\n|\r|\n)/)
    .map((line) => {
      const commentIdx = line.indexOf('!');
      const codeOnly = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
      // Drop `&` continuation tokens
      return codeOnly.replace(/&/g, '');
    })
    .join('');
  if (strippedInner.trim().length === 0) {
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
// Honors `;` statement separators (Fortran 2008+): only :: in the same statement counts
export function isAfterDoubleColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  const lineStart = findLineStart(source, position);
  const lineBefore = source.slice(lineStart, position);
  // Find the last `;` before position that is not inside an excluded region — statement boundary
  let stmtStart = 0;
  for (let i = lineBefore.length - 1; i >= 0; i--) {
    if (lineBefore[i] === ';' && !isInExcludedRegion(lineStart + i, excludedRegions)) {
      stmtStart = i + 1;
      break;
    }
  }
  let searchFrom = stmtStart;
  while (searchFrom < lineBefore.length) {
    const idx = lineBefore.indexOf('::', searchFrom);
    if (idx < 0) break;
    if (!isInExcludedRegion(lineStart + idx, excludedRegions)) {
      return true;
    }
    searchFrom = idx + 2;
  }
  // If a statement boundary was found within this line, do not extend the search to continuation lines
  if (stmtStart > 0) {
    return false;
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
    // Skip comment-only lines (empty after stripping comment)
    if (trimmedContent.length === 0 && commentIdx >= 0) {
      prevLineEnd = prevLineStart - 1;
      if (prevLineEnd > 0 && source[prevLineEnd] === '\n' && source[prevLineEnd - 1] === '\r') {
        prevLineEnd--;
      }
      continue;
    }
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
  const contMatch = afterElseText.match(
    /^([ \t]*&[ \t]*(?:![^\r\n]*)?(?:\r\n|\r|\n)(?:[ \t]*(?:![^\r\n]*|&[ \t]*(?:![^\r\n]*)?)(?:\r\n|\r|\n))*[ \t]*&?[ \t]*)(where)\b/i
  );
  if (contMatch) {
    const whereStart = afterElse + contMatch[1].length;
    if (!isInExcludedRegion(whereStart, excludedRegions)) {
      return { whereStart, end: whereStart + contMatch[2].length };
    }
  }
  return null;
}

// Finds the index of the continuation `&` of a physical line, i.e. an `&` that
// is the last significant token of the line (only whitespace and an optional
// inline `!` comment may follow it). String literals are skipped so an `&`
// inside a string is not mistaken for a continuation marker. Returns -1 when
// the line does not end with a continuation `&`.
function findLineContinuationAmpIndex(source: string, lineStart: number, lineEnd: number): number {
  let lastAmp = -1;
  let i = lineStart;
  while (i < lineEnd) {
    const ch = source[i];
    // Skip string literals (Fortran uses doubled quotes as escape)
    if (ch === "'" || ch === '"') {
      i++;
      while (i < lineEnd) {
        if (source[i] === ch) {
          if (i + 1 < lineEnd && source[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // An inline comment ends the line; the continuation `&` (if any) precedes it
    if (ch === '!') {
      break;
    }
    if (ch === '&') {
      lastAmp = i;
    }
    i++;
  }
  if (lastAmp < 0) {
    return -1;
  }
  // The `&` must be the last significant char: only whitespace may follow it
  // (an inline comment was already excluded by breaking at `!`).
  for (let k = lastAmp + 1; k < lineEnd; k++) {
    if (source[k] !== ' ' && source[k] !== '\t' && source[k] !== '!') {
      return -1;
    }
    if (source[k] === '!') {
      break;
    }
  }
  return lastAmp;
}

// Detects whether `position` sits on a free-form continuation line that carries
// the tail of a keyword split across the continuation (e.g. `end do` written as
// `en&` then `d do`). On such a line the bare-regex tokenizer would emit a
// phantom keyword token from a split-keyword fragment, so the caller suppresses
// keyword tokenization here.
//
// In free-form Fortran a word token is split across a continuation ONLY when no
// whitespace separates the fragments: an `&` with whitespace on either side is a
// token separator, so `change &\n  team` is two tokens (`change`, `team`) and
// must NOT be suppressed. The line therefore qualifies only when BOTH hold:
//   (1) the current physical line has NO leading whitespace and its first char
//       is an identifier char (not `&`): the fragment must abut column 1;
//   (2) the previous physical line ends with a continuation `&` whose IMMEDIATELY
//       preceding char (no whitespace skipped) is an identifier char: the word
//       token straddles the `&`, so this line's head continues that word.
export function isOnKeywordSplittingContinuationLine(source: string, position: number): boolean {
  const lineStart = findLineStart(source, position);
  // The split-keyword fragment must start at column 1 (no leading whitespace):
  // any leading whitespace makes the continuation token-separated.
  const firstChar = lineStart < source.length ? source[lineStart] : '';
  if (firstChar === '' || firstChar === '\n' || firstChar === '\r' || firstChar === ' ' || firstChar === '\t' || firstChar === '&') {
    return false;
  }
  // The continued head must be an identifier char to form a split keyword
  if (!/[A-Za-z0-9_]/.test(firstChar)) {
    return false;
  }
  // No previous physical line
  if (lineStart === 0) {
    return false;
  }
  // Locate the end of the previous physical line (char before its line break).
  // lineStart - 1 is the line break; handle CRLF (`\r\n`) as a two-char break.
  let prevLineEnd = lineStart - 1;
  if (source[prevLineEnd] === '\n' && prevLineEnd > 0 && source[prevLineEnd - 1] === '\r') {
    prevLineEnd--;
  }
  // prevLineEnd is now the line break char; the previous line is [prevLineStart, prevLineEnd)
  const prevLineStart = findLineStart(source, prevLineEnd);
  const ampIdx = findLineContinuationAmpIndex(source, prevLineStart, prevLineEnd);
  if (ampIdx < 0) {
    return false;
  }
  // The char IMMEDIATELY before the `&` (no whitespace skipped) must be an
  // identifier char: only then does a word token straddle the continuation.
  const beforeAmp = ampIdx - 1;
  return beforeAmp >= prevLineStart && /[A-Za-z0-9_]/.test(source[beforeAmp]);
}
