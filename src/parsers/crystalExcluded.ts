// Crystal excluded region and validation helpers extracted from CrystalBlockParser

import type { ExcludedRegion } from '../types';
import { findLineCommentAndStringRegions, isInExcludedRegion, isInsideRegion } from './parserUtils';

// Matches macro template {% %} or {{ }}, handling strings and comments inside
export function matchMacroTemplate(source: string, pos: number): ExcludedRegion | null {
  // {% ... %}
  if (source.slice(pos, pos + 2) === '{%') {
    let i = pos + 2;
    while (i < source.length) {
      const char = source[i];
      // Skip comments inside macro template
      if (char === '#') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip strings inside macro template
      if (char === '"' || char === "'") {
        i = skipMacroString(source, i, char);
        continue;
      }
      if (source.slice(i, i + 2) === '%}') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // {{ ... }}
  if (source.slice(pos, pos + 2) === '{{') {
    let i = pos + 2;
    let depth = 1;
    let singleBraceDepth = 0;
    while (i < source.length && depth > 0) {
      const char = source[i];
      // Skip comments inside macro template
      if (char === '#') {
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        continue;
      }
      // Skip strings inside macro template
      if (char === '"' || char === "'") {
        i = skipMacroString(source, i, char);
        continue;
      }
      if (source.slice(i, i + 2) === '{{') {
        depth++;
        i += 2;
        continue;
      }
      if (source.slice(i, i + 2) === '}}') {
        if (singleBraceDepth > 0) {
          if (singleBraceDepth >= 2) {
            // Both braces close single { inside the template, not the template itself
            singleBraceDepth -= 2;
            i += 2;
            continue;
          }
          // singleBraceDepth === 1: first } closes the single {, second } needs re-evaluation
          singleBraceDepth = 0;
          i += 1;
          continue;
        }
        depth--;
        if (depth === 0) {
          return { start: pos, end: i + 2 };
        }
        i += 2;
        continue;
      }
      // Track single { and } (not part of {{ or }})
      if (char === '{') {
        singleBraceDepth++;
      } else if (char === '}') {
        if (singleBraceDepth > 0) {
          singleBraceDepth--;
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  return null;
}

// Skips a string inside macro template, returning position after closing quote
function skipMacroString(source: string, pos: number, quote: string): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation in double-quoted strings inside macros
    if (quote === '"' && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        // Skip nested strings inside interpolation to avoid counting braces inside them
        if (source[i] === '"' || source[i] === "'") {
          const nestedQuote = source[i];
          i++;
          while (i < source.length && source[i] !== nestedQuote) {
            if (source[i] === '\\' && i + 1 < source.length) {
              i += 2;
              continue;
            }
            i++;
          }
          if (i < source.length) i++;
          continue;
        }
        if (source[i] === '{') {
          depth++;
        } else if (source[i] === '}') {
          depth--;
        }
        if (depth > 0) {
          i++;
        }
      }
      if (i < source.length) {
        i++; // Skip the closing }
      }
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

// Matches Crystal char literal: 'X', '\X', '\uXXXX', '\u{XXXX}'
export function matchCharLiteral(source: string, pos: number): ExcludedRegion | null {
  let i = pos + 1;
  if (i >= source.length) return null;

  if (source[i] === '\\') {
    // Escape sequence: '\n', '\t', '\uXXXX', '\u{...}', etc.
    i++;
    if (i >= source.length) return null;
    if (source[i] === 'u') {
      i++;
      if (i < source.length && source[i] === '{') {
        // \u{XXXX} form
        i++;
        while (i < source.length && source[i] !== '}') {
          i++;
        }
        if (i < source.length) i++; // skip '}'
      } else {
        // \uXXXX form (4 hex digits)
        const end = Math.min(i + 4, source.length);
        while (i < end && /[0-9a-fA-F]/.test(source[i])) {
          i++;
        }
      }
    } else if (source[i] === 'x') {
      // \xNN form (2 hex digits)
      i++;
      const end = Math.min(i + 2, source.length);
      while (i < end && /[0-9a-fA-F]/.test(source[i])) {
        i++;
      }
    } else if (source[i] === 'o') {
      // \oNNN form (octal digits)
      i++;
      while (i < source.length && /[0-7]/.test(source[i])) {
        i++;
      }
    } else if (/[0-7]/.test(source[i])) {
      // \NNN form (octal digits, legacy)
      while (i < source.length && /[0-7]/.test(source[i])) {
        i++;
      }
    } else {
      // Single escape char: '\n', '\t', '\\', '\0', etc.
      i++;
    }
  } else {
    // Single character: 'a', 'z', etc.
    // Handle surrogate pairs (characters outside BMP)
    const code = source.codePointAt(i);
    if (code !== undefined && code > 0xffff) {
      i += 2;
    } else {
      i++;
    }
  }

  if (i < source.length && source[i] === "'") {
    return { start: pos, end: i + 1 };
  }

  // Not a valid char literal, don't exclude
  return null;
}

// Matches heredoc (Crystal doesn't have <<~ like Ruby)
export function matchHeredoc(source: string, pos: number): { contentStart: number; end: number } | null {
  // Crystal requires <<- (with dash) for heredocs; <<IDENT is not valid
  if (pos + 2 >= source.length || source[pos + 2] !== '-') {
    return null;
  }

  // Pattern requires dash: <<-'EOF', <<-"EOF", <<-EOF
  const heredocPattern = /<<-(['"])([A-Za-z_][A-Za-z0-9_]*)\1|<<-([A-Za-z_][A-Za-z0-9_]*)/g;

  // Find line end
  let lineEnd = pos;
  while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
    lineEnd++;
  }

  // Collect all heredoc terminators on this line, filtering out matches inside strings/comments
  const lineContent = source.slice(pos, lineEnd);
  const commentOrStringStarts = findLineCommentAndStringRegions(lineContent, ['-'], ['"', "'", '`']);
  const terminators: { terminator: string }[] = [];

  for (const match of lineContent.matchAll(heredocPattern)) {
    if (match.index !== undefined && isInsideRegion(match.index, commentOrStringStarts)) {
      continue;
    }
    // Pattern has two alternatives: quoted (match[2]) or unquoted (match[3])
    const terminator = match[2] || match[3];
    terminators.push({ terminator });
  }

  if (terminators.length === 0) return null;

  // contentStart is the position after the newline ending the heredoc opener line
  let contentStart = lineEnd;
  if (contentStart < source.length) {
    // Skip \r\n or \r or \n
    if (source[contentStart] === '\r' && contentStart + 1 < source.length && source[contentStart + 1] === '\n') {
      contentStart += 2;
    } else {
      contentStart += 1;
    }
  }

  // Search for terminators after current line
  let i = contentStart;

  let terminatorIndex = 0;

  while (i < source.length && terminatorIndex < terminators.length) {
    const contentLineStart = i;
    let contentLineEnd = i;
    while (contentLineEnd < source.length && source[contentLineEnd] !== '\n' && source[contentLineEnd] !== '\r') {
      contentLineEnd++;
    }

    const line = source.slice(contentLineStart, contentLineEnd);

    // Crystal <<- always allows indented terminators (strip whitespace)
    const trimmedLine = line.trim();

    if (trimmedLine === terminators[terminatorIndex].terminator) {
      terminatorIndex++;
      if (terminatorIndex === terminators.length) {
        let end = contentLineEnd;
        if (end < source.length) {
          // Skip \r\n or \r or \n
          if (source[end] === '\r' && end + 1 < source.length && source[end + 1] === '\n') {
            end += 2;
          } else {
            end += 1;
          }
        }
        return { contentStart, end };
      }
    }

    // Advance past line ending (\r\n or \r or \n)
    if (contentLineEnd < source.length) {
      if (source[contentLineEnd] === '\r' && contentLineEnd + 1 < source.length && source[contentLineEnd + 1] === '\n') {
        i = contentLineEnd + 2;
      } else {
        i = contentLineEnd + 1;
      }
    } else {
      i = contentLineEnd;
    }
  }

  return { contentStart, end: source.length };
}

// Finds the logical line start, walking back across backslash continuations
function findLogicalLineStart(source: string, position: number, excludedRegions: ExcludedRegion[]): number {
  let lineStart = position;
  while (lineStart > 0 && source[lineStart - 1] !== '\n' && source[lineStart - 1] !== '\r') {
    lineStart--;
  }

  while (lineStart >= 2) {
    const prevChar = source[lineStart - 1];
    if (prevChar !== '\n' && prevChar !== '\r') break;
    let checkPos = lineStart - 1;
    if (prevChar === '\n' && checkPos > 0 && source[checkPos - 1] === '\r') {
      checkPos--;
    }
    if (checkPos > 0 && source[checkPos - 1] === '\\') {
      if (isInExcludedRegion(checkPos - 1, excludedRegions)) {
        break;
      }
      let prevLineStart = checkPos - 1;
      while (prevLineStart > 0 && source[prevLineStart - 1] !== '\n' && source[prevLineStart - 1] !== '\r') {
        prevLineStart--;
      }
      lineStart = prevLineStart;
    } else {
      break;
    }
  }

  return lineStart;
}

// Checks if a conditional is postfix (e.g., "return value if condition")
export function isPostfixConditional(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  // Find logical line start (handles backslash continuations)
  const lineStart = findLogicalLineStart(source, position, excludedRegions);

  // Get content before keyword on this logical line, replacing backslash-newlines
  const rawBefore = source.slice(lineStart, position);
  let beforeKeyword = rawBefore.replace(/\\\r?\n|\\\r/g, ' ');

  // Find last semicolon not in excluded region on the original source
  let lastValidSemicolon = -1;
  for (let i = rawBefore.length - 1; i >= 0; i--) {
    if (rawBefore[i] === ';') {
      const absolutePos = lineStart + i;
      if (!isInExcludedRegion(absolutePos, excludedRegions)) {
        lastValidSemicolon = i;
        break;
      }
    }
  }

  if (lastValidSemicolon >= 0) {
    beforeKeyword = rawBefore.slice(lastValidSemicolon + 1).replace(/\\\r?\n|\\\r/g, ' ');
  }

  beforeKeyword = beforeKeyword.trim();

  // No content before keyword means not postfix
  if (beforeKeyword.length === 0) {
    return false;
  }

  // Block keyword before means not postfix
  const precedingBlockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in', 'not', 'and', 'or'];

  for (const kw of precedingBlockKeywords) {
    if (beforeKeyword === kw || beforeKeyword.endsWith(` ${kw}`) || beforeKeyword.endsWith(`\t${kw}`)) {
      return false;
    }
  }

  // ! and ? after identifier are method name suffixes (save!, valid?),
  // not operators - the keyword IS postfix in this case
  if (/[a-zA-Z0-9_][!?]$/.test(beforeKeyword)) {
    return true;
  }

  // Operator expecting expression means not postfix
  // Includes: assignment, logical, comparison, arithmetic, range, and other operators
  if (/[=&|,([{:?+\-*/%<>^~!.]$/.test(beforeKeyword)) {
    // If the last character before keyword is inside an excluded region
    // (e.g., closing / of a regex literal), it's a complete expression, not an operator
    let checkPos = position - 1;
    while (checkPos >= lineStart && (source[checkPos] === ' ' || source[checkPos] === '\t')) {
      checkPos--;
    }
    if (checkPos >= lineStart && isInExcludedRegion(checkPos, excludedRegions)) {
      return true;
    }
    return false;
  }

  // Non-keyword content before means postfix
  return true;
}

// Checks if 'rescue' is used as a postfix modifier (e.g., risky rescue nil)
export function isPostfixRescue(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  const lineStart = findLogicalLineStart(source, position, excludedRegions);
  const rawBefore = source.slice(lineStart, position);
  let before = rawBefore.replace(/\\\r?\n|\\\r/g, ' ');
  let lastSemicolon = -1;
  for (let i = rawBefore.length - 1; i >= 0; i--) {
    if (rawBefore[i] === ';' && !isInExcludedRegion(lineStart + i, excludedRegions)) {
      lastSemicolon = i;
      break;
    }
  }
  if (lastSemicolon >= 0) {
    before = rawBefore.slice(lastSemicolon + 1).replace(/\\\r?\n|\\\r/g, ' ');
  }
  before = before.trim();
  if (before.length === 0) return false;
  const blockKeywords = ['do', 'then', 'else', 'elsif', 'begin', 'rescue', 'ensure', 'when', 'in', 'not', 'and', 'or'];
  for (const kw of blockKeywords) {
    if (before === kw || before.endsWith(` ${kw}`) || before.endsWith(`\t${kw}`)) {
      return false;
    }
  }
  return true;
}

// Checks if 'in' is part of a for-in loop (for x in collection)
export function isForIn(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  const lineStart = findLogicalLineStart(source, position, excludedRegions);
  const rawBefore = source.slice(lineStart, position);
  let before = rawBefore.replace(/\\\r?\n|\\\r/g, ' ');
  // Find last semicolon not in excluded region
  let lastSemicolon = -1;
  for (let i = rawBefore.length - 1; i >= 0; i--) {
    if (rawBefore[i] === ';' && !isInExcludedRegion(lineStart + i, excludedRegions)) {
      lastSemicolon = i;
      break;
    }
  }
  if (lastSemicolon >= 0) {
    before = rawBefore.slice(lastSemicolon + 1).replace(/\\\r?\n|\\\r/g, ' ');
  }
  // Check if this statement starts with 'for'
  return /^[ \t]*for\b/.test(before);
}

// Checks if 'do' is a loop separator (while/until/for ... do), not a block opener
export function isLoopDo(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  const lineStart = findLogicalLineStart(source, position, excludedRegions);

  const rawBeforeDo = source.slice(lineStart, position);
  let lastValidSemicolon = -1;
  for (let i = rawBeforeDo.length - 1; i >= 0; i--) {
    if (rawBeforeDo[i] === ';') {
      const absolutePos = lineStart + i;
      if (!isInExcludedRegion(absolutePos, excludedRegions)) {
        lastValidSemicolon = i;
        break;
      }
    }
  }

  const searchStart = lastValidSemicolon >= 0 ? lineStart + lastValidSemicolon + 1 : lineStart;
  const beforeDo = source.slice(searchStart, position);

  const loopPattern = /\b(while|until|for)\b/g;
  const loopMatches = [...beforeDo.matchAll(loopPattern)];

  for (const loopMatch of loopMatches) {
    const loopAbsolutePos = searchStart + loopMatch.index;
    if (isInExcludedRegion(loopAbsolutePos, excludedRegions)) {
      continue;
    }

    const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
    const searchRange = source.slice(afterLoopStart, position + 2);
    const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

    for (const doMatch of doMatches) {
      const doAbsolutePos = afterLoopStart + doMatch.index;
      if (isInExcludedRegion(doAbsolutePos, excludedRegions)) {
        continue;
      }
      if (doAbsolutePos === position) {
        return true;
      }
      break;
    }
  }

  return false;
}
