// Bash string, expansion, and heredoc matching helpers

import type { ExcludedRegion } from '../types';

import {
  findSingleQuoteEnd,
  isCommentStart,
  isDollarHashVariable,
  matchDollarSingleQuote,
  matchesWord,
  matchHeredocBody,
  parseHeredocOperator
} from './bashLeafHelpers';

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

// Matches arithmetic bracket $[...] (deprecated syntax)
export function matchArithmeticBracket(source: string, pos: number): ExcludedRegion {
  let i = pos + 2;
  let depth = 1;

  while (i < source.length && depth > 0) {
    const char = source[i];

    // Skip strings inside arithmetic bracket
    if (char === '"') {
      i = findBashDoubleQuoteEnd(source, i);
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
  // Quoted delimiters: match anything between quotes; unquoted: allow hyphens, dots, and numeric-only
  const heredocPattern = /^<<(-)?[\t ]*\\?(?:(['"])(.*?)\2|([A-Za-z_0-9][A-Za-z0-9_\-.]*))(?=[^A-Za-z0-9_\-.]|$)/;
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

    // Track bare { (not preceded by $) to handle patterns like ${var:+{value}}
    if (char === '{' && (i === 0 || source[i - 1] !== '$')) {
      depth++;
      i++;
      continue;
    }

    if (char === '}') {
      depth--;
    }
    i++;
  }

  return { start: pos, end: i };
}

// Matches arithmetic expansion $((...)) with string skipping
function matchArithmeticExpansion(source: string, pos: number): ExcludedRegion {
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
        // In bash, " inside ${} toggles the quoting context (quote-toggling model)
        // "${x:-"default"}" - the inner " toggles off outer quoting, } still closes expansion
        if (source[j] === '"') {
          j++;
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
        if (source[j] === '}') {
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
// Used inside scanSubshellBody where nested constructs matter
function findBashDoubleQuoteEnd(source: string, pos: number): number {
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

    // Parameter expansion ${...} - handle inline for double-quoted context
    // Single quotes inside ${} within double quotes are literal (not string delimiters)
    if (char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      let j = i + 2;
      let braceDepth = 1;
      while (j < source.length && braceDepth > 0) {
        if (source[j] === '\\' && j + 1 < source.length) {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          j++;
          continue;
        }
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === "'") {
          const region = matchDollarSingleQuote(source, j);
          j = region.end;
          continue;
        }
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === '(') {
          const nested = matchCommandSubstitution(source, j);
          j = nested.end;
          continue;
        }
        if (source[j] === '$' && j + 1 < source.length && source[j + 1] === '{') {
          j += 2;
          braceDepth++;
          continue;
        }
        if (source[j] === '`') {
          const region = matchBacktickCommand(source, j);
          j = region.end;
          continue;
        }
        if (source[j] === '}') {
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
      return i + 1;
    }

    i++;
  }
  return source.length;
}

// Shared scanning loop for command substitution $(...) and process substitution <(...) / >(...)
// Tracks parenthesis depth, case/esac nesting, heredocs, strings, and comments
interface SubshellScanConfig {
  readonly initialPos: number;
  readonly regionStart: number;
}

function scanSubshellBody(source: string, config: SubshellScanConfig): ExcludedRegion {
  const { initialPos, regionStart } = config;
  let i = initialPos;
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
        const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator, true);
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

    // Skip comments (# to end of line, but not $# special variable)
    if (char === '#' && isCommentStart(source, i) && !isDollarHashVariable(source, i)) {
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
    if (
      char === '<' &&
      i + 1 < source.length &&
      source[i + 1] === '<' &&
      (i + 2 >= source.length || source[i + 2] !== '<') &&
      (i === 0 || source[i - 1] !== '<')
    ) {
      const heredoc = parseHeredocOperator(source, i);
      if (heredoc) {
        pendingHeredocs.push({ stripTabs: heredoc.stripTabs, terminator: heredoc.terminator });
        i += heredoc.matchLength;
        continue;
      }
    }

    // Track case/esac nesting to avoid `)` in case patterns closing the substitution
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
      // the substitution boundary is a case pattern terminator
      if (caseDepth > 0 && depth === 1) {
        i++;
        continue;
      }
      depth--;
      // Flush pending heredocs when closing before a newline is encountered
      if (depth === 0 && pendingHeredocs.length > 0) {
        i++;
        // Find the next newline after the closing )
        while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
          i++;
        }
        if (i < source.length) {
          let bodyStart = i + 1;
          if (source[i] === '\r' && bodyStart < source.length && source[bodyStart] === '\n') {
            bodyStart++;
          }
          for (const hd of pendingHeredocs) {
            const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator, true);
            bodyStart = body ? body.end : bodyStart;
          }
          // Exclude the trailing newline so isAtCommandPosition can see the line boundary
          if (bodyStart > regionStart && source[bodyStart - 1] === '\n') {
            bodyStart--;
            if (bodyStart > regionStart && source[bodyStart - 1] === '\r') {
              bodyStart--;
            }
          } else if (bodyStart > regionStart && source[bodyStart - 1] === '\r') {
            bodyStart--;
          }
          return { start: regionStart, end: bodyStart };
        }
        pendingHeredocs.length = 0;
        return { start: regionStart, end: i };
      }
    }
    i++;
  }

  return { start: regionStart, end: i };
}

// Matches command substitution $(...) with nested parentheses
// Tracks case/esac nesting so `)` in case patterns doesn't close prematurely
export function matchCommandSubstitution(source: string, pos: number): ExcludedRegion {
  // Check for arithmetic expansion $((...))
  if (pos + 2 < source.length && source[pos + 2] === '(') {
    return matchArithmeticExpansion(source, pos);
  }

  return scanSubshellBody(source, { initialPos: pos + 2, regionStart: pos });
}

// Matches process substitution <(...) or >(...) with nested parens
export function matchProcessSubstitution(source: string, pos: number): ExcludedRegion {
  return scanSubshellBody(source, { initialPos: pos + 1, regionStart: pos - 1 });
}
