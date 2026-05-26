// Ruby excluded region helpers: heredoc and multi-line comment matching

import type { ExcludedRegion } from '../types';
import { findLineCommentAndStringRegions, isInsideRegion } from './parserUtils';

// Ruby reserved words that cannot be heredoc terminators.
// Uppercase identifiers (BEGIN, END, __ENCODING__, __LINE__, __FILE__) are
// excluded because they are canonical heredoc terminator names in real-world
// Ruby code (e.g. `raise <<END ... END`).
const RUBY_KEYWORDS: ReadonlySet<string> = new Set([
  'alias',
  'and',
  'begin',
  'break',
  'case',
  'class',
  'def',
  'defined',
  'do',
  'else',
  'elsif',
  'end',
  'ensure',
  'false',
  'for',
  'if',
  'in',
  'module',
  'next',
  'nil',
  'not',
  'or',
  'redo',
  'rescue',
  'retry',
  'return',
  'self',
  'super',
  'then',
  'true',
  'undef',
  'unless',
  'until',
  'when',
  'while',
  'yield'
]);

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
    let skippedSpace = false;
    while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
      i--;
      skippedSpace = true;
    }
    if (i >= 0 && /[a-zA-Z0-9_)\]}]/.test(source[i])) {
      // After ), ], } always allow bare heredoc (e.g., method() <<HEREDOC)
      // After identifier/number with space before <<, allow heredoc if the following
      // word is not a Ruby keyword (method call: puts <<EOF, but not 1 <<if)
      // After identifier/number with NO space (shift pattern: x<<y), reject unless flag
      if (!/[)\]}]/.test(source[i])) {
        // Special case: `class << expr` is a singleton class opener (defines methods
        // on a single object's singleton class). The `<<` here is the singleton-class
        // operator, never a heredoc opener, regardless of spacing around `<<` (the
        // following identifier may be a Ruby keyword like `self`, a class name, or an
        // arbitrary expression). Reject heredoc detection so `class`/`end` pair correctly.
        // `module << expr` is not valid Ruby, but apply the same rule defensively so a
        // mistyped `module <<X` does not swallow surrounding blocks.
        let identStart = i;
        while (identStart > 0 && /[a-zA-Z0-9_]/.test(source[identStart - 1])) {
          identStart--;
        }
        const precedingIdent = source.slice(identStart, i + 1);
        if (precedingIdent === 'class' || precedingIdent === 'module') {
          // Ensure the preceding identifier is a standalone keyword (not `myclass`,
          // `subclass`, etc.). The character before it must not be an identifier char.
          if (identStart === 0 || !/[a-zA-Z0-9_]/.test(source[identStart - 1])) {
            return null;
          }
        }
        const afterLtLt = source.slice(pos + 2);
        const isFlaggedHeredoc = /^[~-]/.test(afterLtLt);
        // Check if the following word is a Ruby keyword (shift operator, not heredoc).
        // Ruby heredoc identifiers may contain non-ASCII letters (e.g. `<<日本語`),
        // so use Unicode-aware identifier classes. Keywords themselves are all ASCII,
        // so a Unicode-only identifier will never match a keyword (which is the desired
        // behavior — `<<日本語` is treated as a heredoc, not a shift operator).
        const followingWordMatch = afterLtLt.match(/^(['"`]?)([\p{L}_][\p{L}\p{M}\p{N}\p{Pc}]*)/u);
        const followingWord = followingWordMatch ? followingWordMatch[2] : '';
        const isRubyKeyword = RUBY_KEYWORDS.has(followingWord);
        if (!isFlaggedHeredoc && (!skippedSpace || isRubyKeyword)) {
          // The first `<<` is shift-like (no space + non-keyword identifier, or follows a
          // keyword that admits a shift). A subsequent `, <<` on the same line refers to
          // its own `<<`, which is in expression-start position (after a comma) and may be
          // a heredoc — but that does NOT retroactively turn this first `<<` into a heredoc.
          // For example, `a<<b, <<C` is `(a<<b)` (shift) plus `<<C` (heredoc), not a list
          // of two heredocs. Return null so this `<<` is treated as a shift; the later
          // `<<C` will be matched at its own position by the scanner.
          //
          // The multi-heredoc list case (e.g. `raise <<A, <<A`) does not enter this branch
          // because `raise <<A` has space before `<<` and `A` is not a keyword, so
          // `(!skippedSpace || isRubyKeyword)` is false and the whole shift-rejection block
          // is skipped above.
          return null;
        }
      }
    }
  }

  // Pattern matches quoted (<<'EOF', <<"EOF", <<`EOF`) or unquoted (<<EOF) heredocs.
  // Quoted forms allow any characters except the matching quote and newline,
  // including spaces, hyphens, dots, and the empty string.
  // Unquoted form follows Ruby identifier rules: Letter or underscore start, then
  // Letter / Mark / Number / Connector Punctuation. Ruby permits non-ASCII identifiers
  // (e.g. `<<日本語`), so use Unicode property classes with the `u` flag.
  const heredocPattern = /<<([~-]?)"([^"\n\r]*)"|<<([~-]?)'([^'\n\r]*)'|<<([~-]?)`([^`\n\r]*)`|<<([~-]?)([\p{L}_][\p{L}\p{M}\p{N}\p{Pc}]*)/gu;

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
    // Pattern has four alternatives:
    //   match[1]/match[2]: double-quoted flag/terminator
    //   match[3]/match[4]: single-quoted flag/terminator
    //   match[5]/match[6]: backtick flag/terminator
    //   match[7]/match[8]: unquoted flag/terminator
    // Use explicit undefined check because quoted forms allow empty terminator (<<"").
    let terminator: string;
    let flag: string;
    if (match[2] !== undefined) {
      terminator = match[2];
      flag = match[1];
    } else if (match[4] !== undefined) {
      terminator = match[4];
      flag = match[3];
    } else if (match[6] !== undefined) {
      terminator = match[6];
      flag = match[5];
    } else {
      terminator = match[8];
      flag = match[7];
    }
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
    // Strict Ruby requires the terminator to start in column 0 under no-flag heredoc form
    // and to have no trailing characters. Best-effort parsing (anchor-set principle):
    // accept indented terminators and terminators with trailing whitespace under all
    // forms, so the heredoc closes instead of swallowing the rest of the source when
    // the user writes a slightly-malformed terminator (e.g. `EOF  \t` or `  EOF`).
    //
    // Quoted heredoc identifiers (`<<" EOF"`) may carry leading/trailing whitespace as
    // part of the terminator string itself. Match strategy in priority order:
    //   1. Exact `trimmedLine === terminator` -- standard case
    //   2. Exact `line === terminator` -- quoted identifier with required whitespace
    //   3. Trimmed-both `trimmedLine === terminator.trim()` -- fallback for quoted
    //      identifier with extra trailing whitespace on the body line
    const trimmedLine = line.trim();
    const matchesTerminator =
      trimmedLine === currentTerminator.terminator || line === currentTerminator.terminator || trimmedLine === currentTerminator.terminator.trim();

    if (matchesTerminator) {
      terminatorIndex++;
      if (terminatorIndex === terminators.length) {
        return {
          contentStart,
          end: contentLineEnd
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
