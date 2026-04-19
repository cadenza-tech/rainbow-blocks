// COBOL helper functions for pseudo-text context detection and EXEC block matching

import type { ExcludedRegion } from '../types';

// Callbacks for parser methods that remain in CobolBlockParser
export interface CobolHelperCallbacks {
  isFixedFormatCommentLine: (source: string, lineStart: number) => boolean;
}

// Checks if the given position is on a fixed-format column 7 comment line (*, /, D, d)
function isOnFixedFormatCommentLine(source: string, pos: number, callbacks: CobolHelperCallbacks): boolean {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  return callbacks.isFixedFormatCommentLine(source, lineStart);
}

// Checks if the given position is on a fixed-format comment line or >> compiler directive line
function isOnExcludedLine(source: string, pos: number, callbacks: CobolHelperCallbacks): boolean {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }
  // Check fixed-format column 7 comment line
  if (callbacks.isFixedFormatCommentLine(source, lineStart)) return true;
  // Check >> compiler directive line (skip leading whitespace)
  let j = lineStart;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
  if (j + 1 < source.length && source[j] === '>' && source[j + 1] === '>') return true;
  return false;
}

// Advances j backward past whitespace, fixed-format comment lines, >> directive lines,
// and *> inline comments so the backward scan lands on real statement content.
// Used by pseudo-text context detection where COPY REPLACING ... ==X== may have
// intervening comments or directives.
function skipBackwardWhitespaceAndComments(source: string, startPos: number, callbacks: CobolHelperCallbacks): number {
  let j = startPos;
  while (j >= 0) {
    while (j >= 0 && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
      j--;
    }
    if (j < 0) return -1;

    let lineStart = j;
    while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
      lineStart--;
    }

    if (isOnExcludedLine(source, j, callbacks)) {
      j = lineStart - 1;
      continue;
    }

    const line = source.slice(lineStart, j + 1);
    const commentIdx = line.indexOf('*>');
    if (commentIdx !== -1) {
      j = lineStart + commentIdx - 1;
      continue;
    }

    break;
  }
  return j;
}

// Match pseudo-text delimiters ==...==
export function matchPseudoText(source: string, pos: number): ExcludedRegion {
  // Look for closing ==
  let i = pos + 2;
  while (i + 1 < source.length) {
    if (source[i] === '=' && source[i + 1] === '=') {
      return { start: pos, end: i + 2 };
    }
    i++;
  }
  // Unterminated pseudo-text: limit the excluded region to the opening '=='
  // rather than swallowing the rest of the source, so subsequent blocks can
  // still be parsed while the user is mid-edit.
  return { start: pos, end: pos + 2 };
}

// Match EXEC/EXECUTE ... END-EXEC block
export function matchExecBlock(source: string, pos: number, callbacks: CobolHelperCallbacks): ExcludedRegion | null {
  const upper = source.slice(pos, pos + 7).toUpperCase();
  const isExec = upper.startsWith('EXEC') && (source.length <= pos + 4 || !/[a-zA-Z0-9_-]/.test(source[pos + 4]));
  const isExecute = upper.startsWith('EXECUTE') && (source.length <= pos + 7 || !/[a-zA-Z0-9_-]/.test(source[pos + 7]));

  if (!isExec && !isExecute) {
    return null;
  }

  // Check word boundary before
  if (pos > 0 && /[a-zA-Z0-9_-]/.test(source[pos - 1])) {
    return null;
  }

  // Verify a recognized sub-language keyword follows
  const startWord = isExecute ? 'EXECUTE' : 'EXEC';
  const afterExec = source.slice(pos + startWord.length).match(/^[ \t]+([a-zA-Z]+)/);
  if (!afterExec || !/^(SQL|CICS|DLI|SQLIMS|HTML|XML|JAVA|ADO|ADABAS|DB2|IMS|IDMS|ORACLE|DATACOM)$/i.test(afterExec[1])) {
    return null;
  }

  // Search for END-EXEC (case-insensitive), skipping string literals and inline comments
  let i = pos + startWord.length;
  while (i < source.length) {
    const ch = source[i];
    // Skip fixed-format column 7 comment lines inside EXEC block
    if (ch === '\n' || ch === '\r') {
      let lineStart = i + 1;
      if (ch === '\r' && lineStart < source.length && source[lineStart] === '\n') {
        lineStart++;
      }
      if (lineStart < source.length && callbacks.isFixedFormatCommentLine(source, lineStart)) {
        i = lineStart;
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      i = lineStart;
      continue;
    }
    // Skip >> compiler directives inside EXEC block
    if (ch === '>' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Skip *> inline comments inside EXEC block
    if (ch === '*' && i + 1 < source.length && source[i + 1] === '>') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Skip pseudo-text delimiters ==...== inside EXEC block
    // Stop scanning at END-EXEC/END-EXECUTE to avoid extending past the EXEC block
    if (ch === '=' && i + 1 < source.length && source[i + 1] === '=') {
      const savedPos = i;
      i += 2;
      let foundClose = false;
      while (i + 1 < source.length) {
        if (source[i] === '=' && source[i + 1] === '=') {
          i += 2;
          foundClose = true;
          break;
        }
        // Stop at END-EXEC or END-EXECUTE to avoid scanning past the EXEC block
        if ((source[i] === 'E' || source[i] === 'e') && i + 7 < source.length) {
          const upperInner = source.slice(i, i + 8).toUpperCase();
          if (upperInner === 'END-EXEC') {
            const beforeOk = i === 0 || !/[a-zA-Z0-9_-]/.test(source[i - 1]);
            const afterOk = i + 8 >= source.length || !/[a-zA-Z0-9_-]/.test(source[i + 8]) || source.slice(i, i + 11).toUpperCase() === 'END-EXECUTE';
            if (beforeOk && afterOk) {
              break;
            }
          }
        }
        i++;
      }
      if (!foundClose) {
        i = savedPos + 2;
      }
      continue;
    }
    // Skip single/double-quoted strings inside EXEC block
    if (ch === "'" || ch === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === ch) {
          if (i + 1 < source.length && source[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (source[i] === '\n' || source[i] === '\r') {
          break;
        }
        i++;
      }
      continue;
    }
    // Check for END-EXECUTE keyword (11 chars, must check before END-EXEC)
    if ((ch === 'E' || ch === 'e') && i + 10 < source.length) {
      const candidate11 = source.slice(i, i + 11).toUpperCase();
      if (candidate11 === 'END-EXECUTE') {
        const beforeOk = i === 0 || !/[a-zA-Z0-9_-]/.test(source[i - 1]);
        const afterOk = i + 11 >= source.length || !/[a-zA-Z0-9_-]/.test(source[i + 11]);
        if (beforeOk && afterOk) {
          return { start: pos, end: i + 11 };
        }
      }
    }
    // Check for END-EXEC keyword (8 chars)
    if ((ch === 'E' || ch === 'e') && i + 7 < source.length) {
      const candidate = source.slice(i, i + 8).toUpperCase();
      if (candidate === 'END-EXEC') {
        // Check word boundaries
        const beforeOk = i === 0 || !/[a-zA-Z0-9_-]/.test(source[i - 1]);
        const afterOk = i + 8 >= source.length || !/[a-zA-Z0-9_-]/.test(source[i + 8]);
        if (beforeOk && afterOk) {
          return { start: pos, end: i + 8 };
        }
      }
    }
    i++;
  }

  return { start: pos, end: source.length };
}

// Scans backward from position i to check if the preceding word matches target keyword
// Skips whitespace, pseudo-text (==...==), BY keywords, inline *> comments,
// fixed-format comment lines, and >> directive lines.
export function isPrecededByKeyword(source: string, i: number, target: string, callbacks: CobolHelperCallbacks): boolean {
  let j = skipBackwardWhitespaceAndComments(source, i, callbacks);
  if (j < 0) {
    return false;
  }
  // Skip multiple consecutive pseudo-text blocks and BY keywords
  // (e.g., ==a== BY ==b== ==c== BY ==d== <- need to traverse all to reach REPLACING)
  while (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
    j -= 2;
    // Skip pseudo-text content to find opening ==
    while (j >= 1) {
      if (source[j] === '=' && source[j - 1] === '=') {
        j -= 2;
        break;
      }
      j--;
    }
    j = skipBackwardWhitespaceAndComments(source, j, callbacks);
    if (j < 0) {
      return false;
    }
    // If we landed on another closing ==, let the loop handle it directly
    if (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
      continue;
    }
    // Check if the preceding word is BY; if so, skip it and continue the loop
    const byEnd = j + 1;
    let byStart = j;
    while (byStart >= 0 && /[a-zA-Z]/.test(source[byStart])) {
      byStart--;
    }
    const byWord = source.slice(byStart + 1, byEnd).toUpperCase();
    if (byWord !== 'BY') {
      break;
    }
    j = skipBackwardWhitespaceAndComments(source, byStart, callbacks);
    if (j < 0) {
      return false;
    }
  }
  // Extract the preceding word
  const wordEnd = j + 1;
  while (j >= 0 && /[a-zA-Z]/.test(source[j])) {
    j--;
  }
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a larger data name)
  if (j >= 0 && source[j] === '-') {
    return false;
  }
  const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
  return prevWord === target;
}

// Like isPrecededByKeyword but returns the position before the found keyword (for context verification)
// Returns -1 if the target keyword is not found
export function findPrecedingKeywordPosition(source: string, i: number, target: string, callbacks: CobolHelperCallbacks): number {
  let j = skipBackwardWhitespaceAndComments(source, i, callbacks);
  if (j < 0) {
    return -1;
  }
  // Skip multiple consecutive pseudo-text blocks and BY keywords
  while (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
    j -= 2;
    // Skip pseudo-text content to find opening ==
    while (j >= 1) {
      if (source[j] === '=' && source[j - 1] === '=') {
        j -= 2;
        break;
      }
      j--;
    }
    j = skipBackwardWhitespaceAndComments(source, j, callbacks);
    if (j < 0) {
      return -1;
    }
    // If we landed on another closing ==, let the loop handle it directly
    if (j >= 1 && source[j] === '=' && source[j - 1] === '=') {
      continue;
    }
    // Check if the preceding word is BY; if so, skip it and continue the loop
    const byEnd = j + 1;
    let byStart = j;
    while (byStart >= 0 && /[a-zA-Z]/.test(source[byStart])) {
      byStart--;
    }
    const byWord = source.slice(byStart + 1, byEnd).toUpperCase();
    if (byWord !== 'BY') {
      break;
    }
    j = skipBackwardWhitespaceAndComments(source, byStart, callbacks);
    if (j < 0) {
      return -1;
    }
  }
  // Extract the preceding word
  const wordEnd = j + 1;
  while (j >= 0 && /[a-zA-Z]/.test(source[j])) {
    j--;
  }
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a larger data name)
  if (j >= 0 && source[j] === '-') {
    return -1;
  }
  const prevWord = source.slice(j + 1, wordEnd).toUpperCase();
  if (prevWord === target) {
    return j;
  }
  return -1;
}

// Finds the last period that is not inside a string literal, inline comment, compiler directive, or column-7 comment line
// Scans forward tracking quote state with COBOL doubled-quote escaping ('' and "")
export function findLastPeriodOutsideStrings(text: string, callbacks: CobolHelperCallbacks): number {
  let lastPeriod = -1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // Skip *> inline comments to end of line
    if (ch === '*' && i + 1 < text.length && text[i + 1] === '>') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Skip >> compiler directives to end of line
    if (ch === '>' && i + 1 < text.length && text[i + 1] === '>') {
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === ch) {
          if (i + 1 < text.length && text[i + 1] === ch) {
            i += 2;
            continue;
          }
          break;
        }
        // String cannot span multiple lines in COBOL
        if (text[i] === '\n' || text[i] === '\r') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '.') {
      if (!isOnFixedFormatCommentLine(text, i, callbacks)) {
        lastPeriod = i;
      }
    }
    i++;
  }
  return lastPeriod;
}

// Checks if position is within a COPY statement by looking for COPY before the last period
// Scans backward for COPY, skipping content inside strings, comments, and directive lines
export function isInCopyStatement(source: string, posBeforeKeyword: number, callbacks: CobolHelperCallbacks): boolean {
  const beforeKeyword = source.slice(0, posBeforeKeyword + 1);
  const lastPeriod = findLastPeriodOutsideStrings(beforeKeyword, callbacks);
  const stmtStart = lastPeriod + 1;
  // Search for COPY word-boundary match, verifying each match is not inside a string or comment
  const copyPattern = /(?<![a-zA-Z0-9_-])COPY(?![a-zA-Z0-9_-])/gi;
  const statement = beforeKeyword.slice(stmtStart);
  for (const match of statement.matchAll(copyPattern)) {
    const absPos = stmtStart + match.index;
    // Skip if on a fixed-format comment line or >> compiler directive line
    if (isOnExcludedLine(source, absPos, callbacks)) continue;
    // Quick check: skip if inside a quoted string (scan backward for unmatched quote)
    let inString = false;
    for (let k = stmtStart; k < absPos; k++) {
      if (source[k] === "'" || source[k] === '"') {
        const quote = source[k];
        k++;
        while (k < absPos) {
          if (source[k] === quote) {
            if (k + 1 < source.length && source[k + 1] === quote) {
              k += 2;
              continue;
            }
            break;
          }
          // String cannot span multiple lines in COBOL
          if (source[k] === '\n' || source[k] === '\r') {
            break;
          }
          k++;
        }
        if (k >= absPos) {
          inString = true;
          break;
        }
      } else if (source[k] === '*' && k + 1 < source.length && source[k + 1] === '>') {
        // Skip inline comment *> to end of line
        k += 2;
        while (k < absPos && source[k] !== '\n' && source[k] !== '\r') k++;
        if (k >= absPos) {
          inString = true;
          break;
        }
      }
    }
    if (!inString) return true;
  }
  return false;
}

// Scans backward through pseudo-text blocks and BY keywords to find REPLACING or REPLACE
// For REPLACING, additionally verifies it is part of a COPY statement
export function isPrecededByReplacingOrReplace(source: string, posEnd: number, callbacks: CobolHelperCallbacks): boolean {
  const replacingPos = findPrecedingKeywordPosition(source, posEnd, 'REPLACING', callbacks);
  if (replacingPos >= 0) {
    return isInCopyStatement(source, replacingPos, callbacks);
  }
  if (isPrecededByKeyword(source, posEnd, 'REPLACE', callbacks)) {
    return true;
  }
  return isPrecededByKeyword(source, posEnd, 'ALSO', callbacks);
}

// Checks if == at pos is in a COPY REPLACING or REPLACE statement context
// Scans backward for REPLACING, REPLACE, or BY keywords (preceded by another ==...==)
export function isInPseudoTextContext(source: string, pos: number, callbacks: CobolHelperCallbacks): boolean {
  // Scan backward from pos, skipping whitespace, newlines, and comments
  let i = skipBackwardWhitespaceAndComments(source, pos - 1, callbacks);
  if (i < 0) return false;
  // If preceded by closing == of another pseudo-text, scan backward through the == chain
  // to find the actual context keyword (REPLACING/REPLACE) and verify COPY context
  if (i >= 1 && source[i] === '=' && source[i - 1] === '=') {
    return isPrecededByReplacingOrReplace(source, i, callbacks);
  }
  // Extract the word ending at position i
  const wordEnd = i + 1;
  while (i >= 0 && /[a-zA-Z]/.test(source[i])) {
    i--;
  }
  const word = source.slice(i + 1, wordEnd).toUpperCase();
  // Reject hyphenated identifiers like MY-REPLACE, X-REPLACING (part of a larger data name)
  if (i >= 0 && source[i] === '-') {
    return false;
  }
  // REPLACE (in REPLACE ==old== BY ==new==) - standalone statement
  if (word === 'REPLACE') {
    return true;
  }
  // REPLACING (in COPY ... REPLACING ==old== BY ==new==) - must be in a COPY statement
  if (word === 'REPLACING') {
    return isInCopyStatement(source, i, callbacks);
  }
  // ALSO (in REPLACE ALSO ==old== BY ==new==) - must be preceded by REPLACE, not EVALUATE
  if (word === 'ALSO') {
    return isPrecededByKeyword(source, i, 'REPLACE', callbacks);
  }
  // BY (in ==old== BY ==new==) - must be preceded by REPLACING (in COPY context), REPLACE, or ALSO
  if (word === 'BY') {
    return isPrecededByReplacingOrReplace(source, i, callbacks);
  }
  return false;
}
