// Bash string, expansion, and heredoc matching helpers

import type { ExcludedRegion } from '../types';

// Checks if '#' at position is a comment start (at word boundary, not mid-word)
export function isCommentStart(source: string, pos: number): boolean {
  if (pos === 0) return true;
  const prev = source[pos - 1];
  // $ before # is handled separately (for $#, ${#, $$# special cases)
  if (prev === '$') return true;
  // # after shell metacharacters or whitespace starts a comment
  // Note: < and > are excluded because >#file and <#file are redirects to files starting with #
  return /[\s;|&(){}]/.test(prev);
}

// Checks if source has a whole word match at position
export function matchesWord(source: string, pos: number, word: string): boolean {
  if (pos + word.length > source.length) return false;
  if (source.slice(pos, pos + word.length) !== word) return false;
  if (pos > 0 && /[a-zA-Z0-9_]/.test(source[pos - 1])) return false;
  const after = pos + word.length;
  if (after < source.length && /[a-zA-Z0-9_]/.test(source[after])) return false;
  return true;
}

// Parses a heredoc operator at position and extracts delimiter info
// Returns null if the position is not a valid heredoc operator
export function parseHeredocOperator(source: string, pos: number): { stripTabs: boolean; terminator: string; matchLength: number } | null {
  // Quoted delimiters: match anything between quotes; unquoted: allow hyphens, dots, etc.
  const heredocPattern = /^<<(-)?[\t ]*\\?(?:(['"])(.*?)\2|([A-Za-z_][A-Za-z0-9_\-.]*))(?=[^A-Za-z0-9_\-.]|$)/;
  const match = source.slice(pos).match(heredocPattern);
  if (!match) return null;
  return {
    stripTabs: match[1] === '-',
    terminator: match[3] ?? match[4],
    matchLength: match[0].length
  };
}

// Matches a heredoc body starting from a given position (after a previous heredoc body)
export function matchHeredocBody(source: string, bodyStart: number, stripTabs: boolean, terminator: string): ExcludedRegion | null {
  let i = bodyStart;

  while (i < source.length) {
    const lineStart = i;
    let lineEnd = i;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    const line = source.slice(lineStart, lineEnd);
    const trimmedLine = stripTabs ? line.replace(/^\t*/, '') : line;

    if (trimmedLine === terminator) {
      let regionEnd = lineEnd;
      if (regionEnd < source.length) {
        if (source[regionEnd] === '\r' && regionEnd + 1 < source.length && source[regionEnd + 1] === '\n') {
          regionEnd += 2;
        } else {
          regionEnd += 1;
        }
      }
      return {
        start: bodyStart,
        end: regionEnd
      };
    }

    // Skip past line ending
    if (lineEnd < source.length) {
      if (source[lineEnd] === '\r' && lineEnd + 1 < source.length && source[lineEnd + 1] === '\n') {
        i = lineEnd + 2;
      } else {
        i = lineEnd + 1;
      }
    } else {
      i = lineEnd;
    }
  }

  return { start: bodyStart, end: source.length };
}

// Matches $'...' ANSI-C quoting
export function matchDollarSingleQuote(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches single-quoted string (no escape sequences in bash single quotes)
export function matchSingleQuotedString(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Matches backtick command substitution with limited escape handling
export function matchBacktickCommand(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      // In backticks, only \`, \\, \$, and \newline are escape sequences
      const nextChar = source[i + 1];
      if (nextChar === '`' || nextChar === '\\' || nextChar === '$') {
        i += 2;
        continue;
      }
    }
    if (source[i] === '`') {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Finds end of double-quoted string with escape sequence handling
export function findStringEnd(source: string, pos: number, quote: string): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

// Finds end of single-quoted string (no escapes)
export function findSingleQuoteEnd(source: string, pos: number): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === "'") {
      return i + 1;
    }
    i++;
  }
  return source.length;
}

// Matches arithmetic bracket $[...] (deprecated syntax)
export function matchArithmeticBracket(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  let depth = 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Skip strings inside arithmetic bracket
    if (char === '"') {
      i = findStringEnd(source, i, '"');
      continue;
    }
    if (char === "'") {
      i = findSingleQuoteEnd(source, i);
      continue;
    }

    // Skip parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    if (char === '[') {
      depth++;
    } else if (char === ']') {
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches heredoc: <<EOF, <<'EOF', <<"EOF", <<-EOF, <<-'EOF', <<-"EOF"
export function matchHeredoc(source: string, pos: number): ExcludedRegion | null {
  // Quoted delimiters: match anything between quotes; unquoted: allow hyphens, dots, etc.
  const heredocPattern = /^<<(-)?[\t ]*\\?(?:(['"])(.*?)\2|([A-Za-z_][A-Za-z0-9_\-.]*))(?=[^A-Za-z0-9_\-.]|$)/;
  const match = source.slice(pos).match(heredocPattern);

  if (!match) return null;

  const stripTabs = match[1] === '-';
  const terminator = match[3] ?? match[4];
  let i = pos + match[0].length;

  // Find the end of the current line (\n or \r)
  while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
    i++;
  }

  // If no line ending found, heredoc has no body
  if (i >= source.length) return null;

  // Skip past line ending (\r\n counts as one)
  let contentStart: number;
  if (source[i] === '\r' && i + 1 < source.length && source[i + 1] === '\n') {
    contentStart = i + 2;
  } else {
    contentStart = i + 1;
  }
  i = contentStart;

  // Find the terminator line
  while (i < source.length) {
    const lineStart = i;
    let lineEnd = i;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
      lineEnd++;
    }

    const line = source.slice(lineStart, lineEnd);
    const trimmedLine = stripTabs ? line.replace(/^\t*/, '') : line;

    if (trimmedLine === terminator) {
      // Skip past the line ending after the terminator
      let regionEnd = lineEnd;
      if (regionEnd < source.length) {
        if (source[regionEnd] === '\r' && regionEnd + 1 < source.length && source[regionEnd + 1] === '\n') {
          regionEnd += 2;
        } else {
          regionEnd += 1;
        }
      }
      return {
        start: contentStart,
        end: regionEnd
      };
    }

    // Skip past line ending
    if (lineEnd < source.length) {
      if (source[lineEnd] === '\r' && lineEnd + 1 < source.length && source[lineEnd + 1] === '\n') {
        i = lineEnd + 2;
      } else {
        i = lineEnd + 1;
      }
    } else {
      i = lineEnd;
    }
  }

  return { start: contentStart, end: source.length };
}

// Matches parameter expansion ${...} with nested braces
export function matchParameterExpansion(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  let depth = 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Skip escaped characters (handles \{ and \} among others)
    if (char === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }

    // Skip ANSI-C quoted strings $'...'
    if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
      const region = matchDollarSingleQuote(source, i);
      i = region.end;
      continue;
    }

    // Skip double-quoted strings (Bash-aware: handles $(), ${}, backticks)
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
      continue;
    }

    // Skip single-quoted strings
    if (char === "'") {
      const stringEnd = findSingleQuoteEnd(source, i);
      i = stringEnd;
      continue;
    }

    // Skip nested command substitution $(...)
    if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
      const nested = matchCommandSubstitution(source, i);
      i = nested.end;
      continue;
    }

    // Skip nested parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    // Skip backtick command substitution
    if (char === '`') {
      const region = matchBacktickCommand(source, i);
      i = region.end;
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches arithmetic expansion $((...)) with string skipping
export function matchArithmeticExpansion(source: string, pos: number): ExcludedRegion {
  let i = pos + 3;
  let depth = 2;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Skip strings inside arithmetic expansion
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
      continue;
    }
    if (char === "'") {
      const stringEnd = findSingleQuoteEnd(source, i);
      i = stringEnd;
      continue;
    }

    // Skip parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches bare arithmetic evaluation (( ... )) (not preceded by $)
export function matchBareArithmeticEvaluation(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  let depth = 2;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Skip strings inside arithmetic evaluation
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
      continue;
    }
    if (char === "'") {
      const stringEnd = findSingleQuoteEnd(source, i);
      i = stringEnd;
      continue;
    }

    // Skip parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches double-quoted string with Bash-specific handling for $(), ${}, and backticks
export function matchBashDoubleQuote(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    const char = source[i];

    // Escape sequence
    if (char === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }

    // Command substitution $(...)
    if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
      const nested = matchCommandSubstitution(source, i);
      i = nested.end;
      continue;
    }

    // Parameter expansion ${...} - handle nested strings inside double-quoted context
    // In bash, ${var:-"default"} has nested double-quoted strings
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      let j = i + 2;
      let braceDepth = 1;
      while (j < source.length && braceDepth > 0) {
        if (source[j] === '\\' && j + 1 < source.length) {
          j += 2;
          continue;
        }
        // Nested double-quoted string: use full Bash-aware scanner to handle $(), ${}, backticks
        if (source[j] === '"') {
          const endPos = findBashDoubleQuoteEnd(source, j);
          if (endPos >= j + 2 && source[endPos - 1] === '"') {
            j = endPos;
            continue;
          }
          // No matching close quote — this " likely ends the outer string
          break;
        }
        // Single-quoted string (no escapes in bash single quotes)
        if (source[j] === "'") {
          j++;
          while (j < source.length && source[j] !== "'") {
            j++;
          }
          if (j < source.length) j++;
          continue;
        }
        // $'...' ANSI-C quoting
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === "'") {
          const region = matchDollarSingleQuote(source, j);
          j = region.end;
          continue;
        }
        // Nested command substitution $(...)
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === '(') {
          const nested = matchCommandSubstitution(source, j);
          j = nested.end;
          continue;
        }
        // Nested parameter expansion ${...}
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === '{') {
          j += 2;
          braceDepth++;
          continue;
        }
        // Backtick command substitution
        if (source[j] === '`') {
          const region = matchBacktickCommand(source, j);
          j = region.end;
          continue;
        }
        if (source[j] === '{') {
          braceDepth++;
        } else if (source[j] === '}') {
          braceDepth--;
        }
        j++;
      }
      i = j;
      continue;
    }

    // Backtick command substitution
    if (char === '`') {
      const region = matchBacktickCommand(source, i);
      i = region.end;
      continue;
    }

    // End of string
    if (char === '"') {
      return { start: pos, end: i + 1 };
    }

    i++;
  }
  return { start: pos, end: source.length };
}

// Finds end of double-quoted string with Bash-aware handling for $(), ${}, single quotes, and backticks
// Used inside matchCommandSubstitution and matchProcessSubstitution where nested constructs matter
export function findBashDoubleQuoteEnd(source: string, pos: number): number {
  let i = pos + 1;
  while (i < source.length) {
    const char = source[i];

    // Escape sequence
    if (char === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }

    // Command substitution $(...)
    if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
      const nested = matchCommandSubstitution(source, i);
      i = nested.end;
      continue;
    }

    // Parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    // Backtick command substitution
    if (char === '`') {
      const region = matchBacktickCommand(source, i);
      i = region.end;
      continue;
    }

    // End of string
    if (char === '"') {
      return i + 1;
    }

    i++;
  }
  return source.length;
}

// Matches command substitution $(...) with nested parentheses
// Tracks case/esac nesting so `)` in case patterns doesn't close prematurely
export function matchCommandSubstitution(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;

  // Check for arithmetic expansion $((...))
  if (source[i] === '(') {
    return matchArithmeticExpansion(source, pos);
  }

  let depth = 1;
  let caseDepth = 0;
  const pendingHeredocs: { stripTabs: boolean; terminator: string }[] = [];

  while (i < source.length && depth > 0) {
    const char = source[i];

    // At newline, skip pending heredoc bodies (multiple heredocs on same line)
    if ((char === '\n' || char === '\r') && pendingHeredocs.length > 0) {
      let bodyStart = i + 1;
      if (char === '\r' && bodyStart < source.length && source[bodyStart] === '\n') {
        bodyStart++;
      }
      for (const hd of pendingHeredocs) {
        const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator);
        bodyStart = body ? body.end : bodyStart;
      }
      pendingHeredocs.length = 0;
      i = bodyStart;
      continue;
    }

    // Skip double-quoted strings (Bash-aware: handles $(), ${}, backticks)
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
      continue;
    }

    // Skip $'...' ANSI-C quoting (must check before single quote)
    if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
      const region = matchDollarSingleQuote(source, i);
      i = region.end;
      continue;
    }

    // Skip single-quoted strings
    if (char === "'") {
      const stringEnd = findSingleQuoteEnd(source, i);
      i = stringEnd;
      continue;
    }

    // Skip comments (# to end of line, but not $# special variable; allow $$#)
    if (char === '#' && isCommentStart(source, i) && !(i > 0 && source[i - 1] === '$' && !(i >= 2 && source[i - 2] === '$'))) {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }

    // Skip nested command substitution
    if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
      const nested = matchCommandSubstitution(source, i);
      i = nested.end;
      continue;
    }

    // Skip parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    // Skip backtick command substitution
    if (char === '`') {
      const region = matchBacktickCommand(source, i);
      i = region.end;
      continue;
    }

    // Detect heredoc operators (<<WORD, <<-WORD) and track pending body
    if (char === '<' && i + 1 < source.length && source[i + 1] === '<' && (i + 2 >= source.length || source[i + 2] !== '<')) {
      const heredoc = parseHeredocOperator(source, i);
      if (heredoc) {
        pendingHeredocs.push({ stripTabs: heredoc.stripTabs, terminator: heredoc.terminator });
        i += heredoc.matchLength;
        continue;
      }
    }

    // Track case/esac nesting to avoid `)` in case patterns closing `$(...)`
    // Skip $case/$esac (variable names, not keywords)
    if (!(i > 0 && source[i - 1] === '$') && matchesWord(source, i, 'case')) {
      caseDepth++;
      i += 4;
      continue;
    }
    if (!(i > 0 && source[i - 1] === '$') && matchesWord(source, i, 'esac')) {
      if (caseDepth > 0) caseDepth--;
      i += 4;
      continue;
    }

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      // Inside a case block, `)` that doesn't reduce paren depth below
      // the command substitution boundary is a case pattern terminator
      if (caseDepth > 0 && depth === 1) {
        i++;
        continue;
      }
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches process substitution <(...) or >(...) with nested parens
export function matchProcessSubstitution(source: string, pos: number): ExcludedRegion {
  let i = pos + 1;
  let depth = 1;
  let caseDepth = 0;
  const pendingHeredocs: { stripTabs: boolean; terminator: string }[] = [];

  while (i < source.length && depth > 0) {
    const char = source[i];

    // At newline, skip pending heredoc bodies (multiple heredocs on same line)
    if ((char === '\n' || char === '\r') && pendingHeredocs.length > 0) {
      let bodyStart = i + 1;
      if (char === '\r' && bodyStart < source.length && source[bodyStart] === '\n') {
        bodyStart++;
      }
      for (const hd of pendingHeredocs) {
        const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator);
        bodyStart = body ? body.end : bodyStart;
      }
      pendingHeredocs.length = 0;
      i = bodyStart;
      continue;
    }

    // Skip double-quoted strings (Bash-aware: handles $(), ${}, backticks)
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
      continue;
    }
    // Skip $'...' ANSI-C quoting (must check before single quote)
    if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
      const region = matchDollarSingleQuote(source, i);
      i = region.end;
      continue;
    }

    if (char === "'") {
      const stringEnd = findSingleQuoteEnd(source, i);
      i = stringEnd;
      continue;
    }

    // Skip nested command substitution
    if (char === '$' && i + 1 < source.length && source[i + 1] === '(') {
      const nested = matchCommandSubstitution(source, i);
      i = nested.end;
      continue;
    }

    // Skip parameter expansion ${...}
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      const nested = matchParameterExpansion(source, i);
      i = nested.end;
      continue;
    }

    // Skip backtick command substitution
    if (char === '`') {
      const region = matchBacktickCommand(source, i);
      i = region.end;
      continue;
    }

    // Skip comments (# to end of line, but not $# special variable; allow $$#)
    if (char === '#' && isCommentStart(source, i) && !(i > 0 && source[i - 1] === '$' && !(i >= 2 && source[i - 2] === '$'))) {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }

    // Detect heredoc operators (<<WORD, <<-WORD) and track pending body
    if (char === '<' && i + 1 < source.length && source[i + 1] === '<' && (i + 2 >= source.length || source[i + 2] !== '<')) {
      const heredoc = parseHeredocOperator(source, i);
      if (heredoc) {
        pendingHeredocs.push({ stripTabs: heredoc.stripTabs, terminator: heredoc.terminator });
        i += heredoc.matchLength;
        continue;
      }
    }

    // Track case/esac nesting to avoid `)` in case patterns closing process substitution
    // Skip $case/$esac (variable names, not keywords)
    if (!(i > 0 && source[i - 1] === '$') && matchesWord(source, i, 'case')) {
      caseDepth++;
      i += 4;
      continue;
    }
    if (!(i > 0 && source[i - 1] === '$') && matchesWord(source, i, 'esac')) {
      if (caseDepth > 0) caseDepth--;
      i += 4;
      continue;
    }

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      if (caseDepth > 0 && depth === 1) {
        i++;
        continue;
      }
      depth--;
    }
    i++;
  }

  // Include the preceding < or > in the excluded region
  return { start: pos - 1, end: i };
}
