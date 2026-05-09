// Crystal excluded region and validation helpers extracted from CrystalBlockParser

import type { ExcludedRegion } from '../types';
import { findLineCommentAndStringRegions, isInExcludedRegion, isInsideRegion } from './parserUtils';

// Binary search for the excluded region containing pos, or null when none.
function findRegionAt(pos: number, regions: readonly ExcludedRegion[]): ExcludedRegion | null {
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const r = regions[mid];
    if (pos < r.start) {
      hi = mid - 1;
    } else if (pos >= r.end) {
      lo = mid + 1;
    } else {
      return r;
    }
  }
  return null;
}

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
      // Skip strings and backtick command literals inside macro template
      if (char === '"' || char === "'" || char === '`') {
        i = skipMacroString(source, i, char);
        continue;
      }
      // Skip heredoc body (<<- or <<~) so internal %} or end keywords inside the
      // body do not prematurely close the macro template
      if (char === '<' && i + 2 < source.length && source[i + 1] === '<' && (source[i + 2] === '-' || source[i + 2] === '~')) {
        const heredocResult = matchHeredoc(source, i);
        if (heredocResult) {
          i = heredocResult.end;
          continue;
        }
      }
      // Skip regex literals (/.../) when at expression start position
      if (char === '/' && isMacroRegexStart(source, i, pos + 2)) {
        i = skipRegexLiteral(source, i);
        continue;
      }
      if (source.slice(i, i + 2) === '%}') {
        return { start: pos, end: i + 2 };
      }
      // Skip percent literals (%r(...), %w[...], %|...|, etc.) inside macro body
      if (char === '%') {
        const percentEnd = skipMacroPercentLiteral(source, i);
        if (percentEnd !== null) {
          i = percentEnd;
          continue;
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  // {{ ... }} (but not {{% which is { followed by {% ... %})
  if (source.slice(pos, pos + 2) === '{{' && (pos + 2 >= source.length || source[pos + 2] !== '%')) {
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
      // Skip strings and backtick command literals inside macro template
      if (char === '"' || char === "'" || char === '`') {
        i = skipMacroString(source, i, char);
        continue;
      }
      // Skip heredoc body (<<- or <<~) so internal }} or end keywords inside the
      // body do not prematurely close the macro template
      if (char === '<' && i + 2 < source.length && source[i + 1] === '<' && (source[i + 2] === '-' || source[i + 2] === '~')) {
        const heredocResult = matchHeredoc(source, i);
        if (heredocResult) {
          i = heredocResult.end;
          continue;
        }
      }
      // Skip regex literals (/.../) when at expression start position
      if (char === '/' && isMacroRegexStart(source, i, pos + 2)) {
        i = skipRegexLiteral(source, i);
        continue;
      }
      // Skip percent literals (%r(...), %w[...], %|...|, etc.) inside macro body.
      // Done before {{ / }} detection so a paired-{} percent literal does not bump
      // singleBraceDepth and confuse the closer.
      if (char === '%') {
        const percentEnd = skipMacroPercentLiteral(source, i);
        if (percentEnd !== null) {
          i = percentEnd;
          continue;
        }
      }
      if (source.slice(i, i + 2) === '{{') {
        depth++;
        i += 2;
        continue;
      }
      if (source.slice(i, i + 2) === '}}') {
        if (singleBraceDepth >= 2) {
          // Both braces close single { inside the template, not the template itself
          singleBraceDepth -= 2;
          i += 2;
          continue;
        }
        if (singleBraceDepth === 1) {
          if (i + 2 < source.length && source[i + 2] === '}') {
            // }}} = first } closes inner brace, then }} closes template
            singleBraceDepth = 0;
            i++;
            continue;
          }
          // Unbalanced single {: treat }} as template closer
          singleBraceDepth = 0;
          depth--;
          if (depth === 0) {
            return { start: pos, end: i + 2 };
          }
          i += 2;
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

// Skips a percent literal inside a macro template body. Percent literals can
// appear with specifiers (%w, %r, %q, etc.) or as bare %... with paired or
// non-paired delimiters. Returns position after the closing delimiter, or null
// when source[pos] is not a percent literal start (e.g., %} which is the macro
// close, or % used as modulo).
const PERCENT_LITERAL_PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

function skipMacroPercentLiteral(source: string, pos: number): number | null {
  if (pos + 1 >= source.length) return null;

  let delimPos = pos + 1;
  let next = source[delimPos];

  // %} is the macro close marker — not a percent literal
  if (next === '}') return null;

  // Specifier: q/Q/w/W/i/I/r/x followed by an actual delimiter
  if (/[qQwWiIrx]/.test(next)) {
    if (delimPos + 1 >= source.length) return null;
    delimPos++;
    next = source[delimPos];
  }

  // Delimiter must be a non-alphanumeric, non-whitespace symbol
  if (/[a-zA-Z0-9 \t\r\n]/.test(next)) return null;

  // Reject closing brackets — only the opener form is a valid percent-literal delimiter.
  if (next === ')' || next === ']' || next === '}' || next === '>') return null;

  const close = PERCENT_LITERAL_PAIRED_DELIMITERS[next] ?? next;
  const isPaired = next !== close;

  // When backslash is the delimiter, it cannot also serve as an escape character —
  // otherwise the closing `\` is consumed as part of an escape sequence and the
  // literal never terminates.
  const escapeEnabled = close !== '\\';

  let i = delimPos + 1;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (escapeEnabled && c === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (isPaired && c === next) {
      depth++;
    } else if (c === close) {
      depth--;
    }
    i++;
  }
  return i;
}

// Heuristic: is `/` at pos a regex literal start (vs division)?
// Inside a macro template, `/` is regex when preceded by an operator/separator/keyword
function isMacroRegexStart(source: string, pos: number, macroBodyStart: number): boolean {
  let i = pos - 1;
  while (i >= macroBodyStart && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
    i--;
  }
  if (i < macroBodyStart) return true;
  const c = source[i];
  if ('=,(;[{<>+-*/%&|!^~?:'.includes(c)) return true;
  // Common keyword endings (then/in/and/or/not/if/unless/while/until/case/return/yield)
  if (/[a-z]/.test(c)) {
    const wordEnd = i + 1;
    let wordStart = i;
    while (wordStart > macroBodyStart && /[a-zA-Z_0-9?!]/.test(source[wordStart - 1])) {
      wordStart--;
    }
    const word = source.slice(wordStart, wordEnd);
    const keywords = [
      'if',
      'unless',
      'while',
      'until',
      'case',
      'when',
      'then',
      'else',
      'elsif',
      'and',
      'or',
      'not',
      'in',
      'return',
      'yield',
      'break',
      'next'
    ];
    if (keywords.includes(word)) return true;
  }
  return false;
}

// Skips a regex literal /.../[flags], handling escapes and character classes
function skipRegexLiteral(source: string, pos: number): number {
  let i = pos + 1;
  let inCharClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (c === '\n' || c === '\r') break;
    if (c === '[') {
      inCharClass = true;
    } else if (c === ']') {
      inCharClass = false;
    } else if (c === '/' && !inCharClass) {
      i++;
      // Crystal regex flags are i/m/x only; consume them after the closing `/`.
      while (i < source.length && /[imx]/.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return i;
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
        // Skip nested strings, char literals, and backtick command literals inside
        // interpolation to avoid counting braces inside them
        if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
          const nestedQuote = source[i];
          i++;
          while (i < source.length && source[i] !== nestedQuote) {
            if (source[i] === '\\' && i + 1 < source.length) {
              i += 2;
              continue;
            }
            // Handle #{} inside nested interpolating literals (double-quoted strings, backticks)
            if ((nestedQuote === '"' || nestedQuote === '`') && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
              i += 2;
              let innerDepth = 1;
              while (i < source.length && innerDepth > 0) {
                if (source[i] === '\\' && i + 1 < source.length) {
                  i += 2;
                  continue;
                }
                if (source[i] === '{') innerDepth++;
                else if (source[i] === '}') innerDepth--;
                if (innerDepth > 0) i++;
              }
              if (i < source.length) i++;
              continue;
            }
            i++;
          }
          if (i < source.length) i++;
          continue;
        }
        // Character literal: ?{, ?}, ?" etc.
        if (
          (source[i] === '{' || source[i] === '}' || source[i] === '"') &&
          i > pos &&
          source[i - 1] === '?' &&
          (i - 1 === pos || !/\w/.test(source[i - 2]))
        ) {
          i++;
          continue;
        }
        // Line comment inside interpolation: skip to end of line. `#{` is nested
        // interpolation (not a comment) and is handled by the nested-string branch
        // above when needed; here a bare `#` starts a comment.
        if (source[i] === '#' && (i + 1 >= source.length || source[i + 1] !== '{')) {
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
            i++;
          }
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
        while (i < source.length && source[i] !== '}' && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        if (i < source.length && source[i] === '}') i++; // skip '}'
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
      // \oNNN form (octal digits, max 3)
      i++;
      const octalEnd = Math.min(i + 3, source.length);
      while (i < octalEnd && /[0-7]/.test(source[i])) {
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

// Matches heredoc (Crystal supports <<- and <<~)
export function matchHeredoc(source: string, pos: number): { contentStart: number; end: number } | null {
  // Crystal requires <<- or <<~ for heredocs; <<IDENT is not valid
  if (pos + 2 >= source.length || (source[pos + 2] !== '-' && source[pos + 2] !== '~')) {
    return null;
  }

  // Pattern requires dash or tilde: <<-'EOF', <<-"EOF", <<-EOF, <<~'EOF', <<~"EOF", <<~EOF.
  // Both quoted and unquoted variants use Unicode-letter classes so identifiers containing
  // non-ASCII letters (e.g. <<-Naïve, <<-"αβγ") are matched fully, preventing the terminator
  // from being a truncated ASCII prefix that never matches the actual identifier line.
  const heredocPattern =
    /<<[-~](['"])((?:[A-Za-z_]|\p{L})(?:[A-Za-z0-9_]|\p{L})*)\1|<<[-~]((?:[A-Za-z_]|\p{L})(?:[A-Za-z0-9_]|\p{L})*)/gu;

  // Find line end
  let lineEnd = pos;
  while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
    lineEnd++;
  }

  // Collect all heredoc terminators on this line, filtering out matches inside strings/comments
  const lineContent = source.slice(pos, lineEnd);
  const commentOrStringStarts = findLineCommentAndStringRegions(lineContent, ['-', '~'], ['"', "'", '`']);
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
    const trimmedLine = line.trimStart();

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
      // Count consecutive backslashes before newline
      let bsCount = 0;
      let bsPos = checkPos - 1;
      while (bsPos >= 0 && source[bsPos] === '\\') {
        bsCount++;
        bsPos--;
      }
      // Even number of backslashes means they are all escaped (not continuation)
      if (bsCount % 2 === 0) {
        break;
      }
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

  // Check if there is any meaningful content (literal value or expression) before the keyword.
  // Excluded regions other than line comments (strings, regex, percent literals, char literals,
  // sigils, macro templates) count as content because the keyword is acting as a postfix
  // modifier on them (e.g., `"hello" if cond`).
  let hasNonExcludedContent = false;
  let ci = lineStart;
  while (ci < position) {
    if (source[ci] === ' ' || source[ci] === '\t' || source[ci] === '\n' || source[ci] === '\r') {
      ci++;
      continue;
    }
    if (source[ci] === ';' && !isInExcludedRegion(ci, excludedRegions)) {
      hasNonExcludedContent = false;
      ci++;
      continue;
    }
    const region = findRegionAt(ci, excludedRegions);
    if (region) {
      // Line comments (#) and macro templates ({% %}, {{ }}) don't count as
      // content for postfix-conditional detection. Strings, literals, and
      // regex do count.
      const isComment = source[region.start] === '#';
      const isMacroTemplate = source[region.start] === '{' && (source[region.start + 1] === '%' || source[region.start + 1] === '{');
      if (!isComment && !isMacroTemplate) {
        hasNonExcludedContent = true;
      }
      ci = region.end;
      continue;
    }
    hasNonExcludedContent = true;
    ci++;
  }
  if (!hasNonExcludedContent) {
    return false;
  }

  // Block keyword before means not postfix
  const precedingBlockKeywords = [
    'if',
    'unless',
    'while',
    'until',
    'for',
    'case',
    'do',
    'then',
    'else',
    'elsif',
    'begin',
    'rescue',
    'ensure',
    'when',
    'in',
    'not',
    'and',
    'or'
  ];

  const normalizedBefore = beforeKeyword.replace(/[ \t]+/g, ' ');
  for (const kw of precedingBlockKeywords) {
    if (normalizedBefore === kw || normalizedBefore.endsWith(` ${kw}`)) {
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
    // Crystal global variables $?, $!, $~, $. are complete values, not operators
    const lastChar = beforeKeyword[beforeKeyword.length - 1];
    if (
      (lastChar === '?' || lastChar === '!' || lastChar === '~' || lastChar === '.') &&
      beforeKeyword.length >= 2 &&
      beforeKeyword[beforeKeyword.length - 2] === '$'
    ) {
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
  const normalizedRescueBefore = before.replace(/[ \t]+/g, ' ');
  for (const kw of blockKeywords) {
    if (normalizedRescueBefore === kw || normalizedRescueBefore.endsWith(` ${kw}`)) {
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

    // Reject loop keywords preceded by dot (method calls like obj.while),
    // :: (scope resolution), @ or $ (variable prefixes)
    if (loopAbsolutePos > 0) {
      const prevChar = source[loopAbsolutePos - 1];
      if (prevChar === '$' || prevChar === '@') {
        continue;
      }
      if (prevChar === ':' && loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === ':') {
        continue;
      }
      if (prevChar === '.' && !(loopAbsolutePos > 1 && source[loopAbsolutePos - 2] === '.')) {
        continue;
      }
    }

    const afterLoopStart = loopAbsolutePos + loopMatch[0].length;
    const searchRange = source.slice(afterLoopStart, position + 2);
    const doMatches = [...searchRange.matchAll(/\bdo\b/g)];

    for (const doMatch of doMatches) {
      const doAbsolutePos = afterLoopStart + doMatch.index;
      if (isInExcludedRegion(doAbsolutePos, excludedRegions)) {
        continue;
      }
      // Skip 'do' preceded by dot (method call), :: (scope resolution), @ or $ (variable prefix)
      if (doAbsolutePos > 0) {
        const prevChar = source[doAbsolutePos - 1];
        if (prevChar === '$' || prevChar === '@') {
          continue;
        }
        if (prevChar === ':' && doAbsolutePos > 1 && source[doAbsolutePos - 2] === ':') {
          continue;
        }
        if (prevChar === '.' && !(doAbsolutePos > 1 && source[doAbsolutePos - 2] === '.')) {
          continue;
        }
      }
      if (doAbsolutePos === position) {
        return true;
      }
      break;
    }
  }

  return false;
}
