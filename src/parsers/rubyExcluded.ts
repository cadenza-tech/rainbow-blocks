// Ruby excluded region helpers: heredoc and multi-line comment matching

import type { ExcludedRegion } from '../types';
import { findLineCommentAndStringRegions, isInsideRegion } from './parserUtils';

// Matches multi-line comment: =begin ... =end
// Both =begin and =end must be at line start and followed by whitespace/newline/EOF
export function matchMultiLineComment(source: string, pos: number): ExcludedRegion | null {
  if (source.slice(pos, pos + 6) !== '=begin') {
    return null;
  }

  // =begin must be followed by whitespace, newline, or EOF
  const afterBegin = source[pos + 6];
  if (afterBegin !== undefined && afterBegin !== ' ' && afterBegin !== '\t' && afterBegin !== '\n' && afterBegin !== '\r') {
    return null;
  }

  let i = pos + 6;
  while (i < source.length) {
    const isLineStart = i === 0 || source[i - 1] === '\n' || source[i - 1] === '\r';
    if (source[i] === '=' && isLineStart && source.slice(i, i + 4) === '=end') {
      // =end must be followed by whitespace, newline, or EOF
      const afterEnd = source[i + 4];
      if (afterEnd === undefined || afterEnd === ' ' || afterEnd === '\t' || afterEnd === '\n' || afterEnd === '\r') {
        // Exclude the entire =end line (content after =end is still a comment)
        let lineEnd = i + 4;
        while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
          lineEnd++;
        }
        return { start: pos, end: lineEnd };
      }
    }
    i++;
  }
  return { start: pos, end: i };
}

// Matches heredoc, handling multiple heredocs on same line
export function matchHeredoc(source: string, pos: number): { contentStart: number; end: number } | null {
  // Reject bare <<IDENT when preceded by identifier/number/closing bracket (likely shift operator)
  if (pos > 0) {
    let i = pos - 1;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
    }
    if (i >= 0 && /[a-zA-Z0-9_)\]}]/.test(source[i])) {
      // After identifier/number, only allow heredoc with flag (- or ~)
      // Rejects ambiguous cases like x <<"EOF" (could be shift + string)
      // But after ), ], } allow bare heredoc (e.g., method() <<HEREDOC)
      if (!/[)\]}]/.test(source[i])) {
        const afterLtLt = source.slice(pos + 2);
        if (!/^[~-]/.test(afterLtLt)) {
          return null;
        }
      }
    }
  }

  // Pattern requires matching quotes: <<'EOF', <<"EOF", <<EOF (no quotes)
  // The backreference \2 ensures opening and closing quotes match
  const heredocPattern = /<<([~-]?)(['"`])([A-Za-z_][A-Za-z0-9_]*)\2|<<([~-]?)([A-Za-z_][A-Za-z0-9_]*)/g;

  // Find line end
  let lineEnd = pos;
  while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') {
    lineEnd++;
  }

  // Collect all heredoc terminators on this line, filtering out matches inside strings/comments
  const lineContent = source.slice(pos, lineEnd);
  const commentOrStringStarts = findLineCommentAndStringRegions(lineContent, ['~', '-'], ['"', "'", '`']);
  const terminators: { terminator: string; allowIndented: boolean }[] = [];

  for (const match of lineContent.matchAll(heredocPattern)) {
    if (match.index !== undefined && isInsideRegion(match.index, commentOrStringStarts)) {
      continue;
    }
    // Pattern has two alternatives: quoted (match[3]) or unquoted (match[5])
    const terminator = match[3] || match[5];
    const flag = match[1] || match[4];
    terminators.push({
      terminator,
      allowIndented: flag === '~' || flag === '-'
    });
  }

  if (terminators.length === 0) return null;

  // contentStart is the position after the line ending (skip \r\n or \r or \n)
  let contentStart = lineEnd;
  if (contentStart < source.length) {
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

    const currentTerminator = terminators[terminatorIndex];
    const trimmedLine = currentTerminator.allowIndented ? line.trimStart() : line;

    if (trimmedLine === currentTerminator.terminator) {
      terminatorIndex++;
      if (terminatorIndex === terminators.length) {
        let endPos = contentLineEnd;
        if (endPos < source.length) {
          if (source[endPos] === '\r' && endPos + 1 < source.length && source[endPos + 1] === '\n') {
            endPos += 2;
          } else {
            endPos += 1;
          }
        }
        return {
          contentStart,
          end: endPos
        };
      }
    }

    // Advance past the line ending (\r\n, \r, or \n)
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
