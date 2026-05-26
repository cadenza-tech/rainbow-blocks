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

// Matches heredoc: <<EOF, <<'EOF', <<"EOF", <<-EOF, <<-'EOF', <<-"EOF", <<\EOF, <<\}
// Also handles concatenated delimiter parts like <<"EOF"'TAIL' (terminator: EOFTAIL).
export function matchHeredoc(source: string, pos: number): ExcludedRegion | null {
  const op = parseHeredocOperator(source, pos);
  if (!op) return null;
  const { stripTabs, terminator } = op;
  let i = pos + op.matchLength;

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
      // Stop region at end of terminator line (before the newline) so the trailing
      // newline can serve as a command separator for following tokens like '}'.
      return {
        start: contentStart,
        end: lineEnd
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

// Iterative scanner for nested expansion constructs.
//
// Bash expansions ${...}, $(...), $((...)), $[...], (( )), and the double-quote
// contexts that may contain them can nest to arbitrary depth. A recursive
// implementation overflows the call stack on deeply nested (or deeply
// unterminated) input. This module instead drives every nested construct
// through a single loop with an explicit frame stack, so depth is bounded only
// by memory.

// Frame kinds, one per kind of bracketed/quoted context the scanner can enter.
type FrameKind =
  | 'subshell' // $(...), <(...), >(...): paren depth + case/heredoc/[[ ]] tracking
  | 'brace' // ${...}: brace depth, bare { increments
  | 'arithParen' // $((...)) and (( )): paren depth
  | 'arithBracket' // $[...]: bracket depth
  | 'dquote' // "...": ends at the matching "
  | 'dquoteBrace'; // ${...} inside a double-quote context: brace depth, " enters a new string

interface PendingHeredoc {
  readonly stripTabs: boolean;
  readonly terminator: string;
}

// A single nesting level. `regionStart`/`scanPos` are only meaningful for the
// bottom frame's return value; nested frames only contribute their end offset.
interface ScanFrame {
  kind: FrameKind;
  depth: number;
  regionStart: number;
  // subshell-only mutable state
  caseDepth: number;
  doubleBracketDepth: number;
  pendingHeredocs: PendingHeredoc[];
}

function createFrame(kind: FrameKind, depth: number, regionStart: number): ScanFrame {
  return {
    kind,
    depth,
    regionStart,
    caseDepth: 0,
    doubleBracketDepth: 0,
    pendingHeredocs: []
  };
}

// Detects an expansion opener at `i` and returns the frame to push for it,
// together with the offset just past the opener. Returns null when there is no
// opener. `inDoubleQuoteContext` selects double-quote-aware brace frames.
function detectNestedOpener(source: string, i: number, inDoubleQuoteContext: boolean): { frame: ScanFrame; nextPos: number } | null {
  const char = source[i];
  if (char === '$' && i + 1 < source.length) {
    const next = source[i + 1];
    if (next === '{') {
      const kind: FrameKind = inDoubleQuoteContext ? 'dquoteBrace' : 'brace';
      return { frame: createFrame(kind, 1, i), nextPos: i + 2 };
    }
    if (next === '(') {
      // $(( starts arithmetic expansion; $( starts command substitution
      if (i + 2 < source.length && source[i + 2] === '(') {
        return { frame: createFrame('arithParen', 2, i), nextPos: i + 3 };
      }
      return { frame: createFrame('subshell', 1, i), nextPos: i + 2 };
    }
    if (next === '[') {
      return { frame: createFrame('arithBracket', 1, i), nextPos: i + 2 };
    }
  }
  return null;
}

// Skips a leaf (non-recursive) construct that behaves identically in every
// context: a backslash escape or a backtick command substitution. Returns the
// offset just past the leaf, or -1 when `i` is not such a construct.
function skipUniformLeaf(source: string, i: number): number {
  const char = source[i];
  if (char === '\\' && i + 1 < source.length) {
    return i + 2;
  }
  if (char === '`') {
    return matchBacktickCommand(source, i).end;
  }
  return -1;
}

// Returns true when the position is at a command start inside a subshell body
// (after a separator, newline, opening paren/brace, backtick, or at the start).
function isAtSubshellCommandPosition(source: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j < 0) return true;
  const ch = source[j];
  return ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === '{' || ch === '\n' || ch === '\r' || ch === '`';
}

// Returns true when the word at `pos` of length `wordLen` is used as a variable
// name (`name=val`, `name+=val`, `name[i]=val`) or function definition
// (`name() { ... }`) rather than as a shell keyword.
function isWordUsedAsAssignmentOrFunction(source: string, pos: number, wordLen: number): boolean {
  const after = pos + wordLen;
  if (after >= source.length) return false;
  const ch = source[after];
  if (ch === '=' || ch === '[') return true;
  if (ch === '+' && after + 1 < source.length && source[after + 1] === '=') return true;
  // Function definition: `name()` (allow whitespace before `(`)
  let p = after;
  while (p < source.length && (source[p] === ' ' || source[p] === '\t')) p++;
  return p < source.length && source[p] === '(';
}

// Returns true when the character at `pos` is a POSIX shell command separator
// that can terminate the `case` reserved word before its subject. `case` must be
// followed by whitespace, newline, or a separator like `;`/`|`/`&` because the
// subject word comes next (`case WORD in ...`). Anything else (`)`, `+`, `#`,
// identifier characters, etc.) means `case` is fused with the following text as
// a single word, not the keyword. Used to keep the subshell scanner from
// entering case scope for malformed inputs like `$(case+x)`, `$(case#tag)`,
// `$(case)` where the trailing `)` would otherwise be misread as a case-pattern
// terminator and the subshell extended past its intended closer.
function isCaseSubjectSeparator(source: string, pos: number): boolean {
  if (pos >= source.length) return false;
  const ch = source[pos];
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ';' || ch === '|' || ch === '&';
}

// Returns true when the position is immediately preceded (after whitespace) by the bare `in` keyword.
// In bash case statements, the syntax `case word in [pattern_list] esac` allows an empty pattern list,
// so `esac` may appear directly after `in` without an intervening separator.
function isPrecededByInKeyword(source: string, pos: number): boolean {
  let j = pos - 1;
  while (j >= 0 && (source[j] === ' ' || source[j] === '\t')) {
    j--;
  }
  if (j < 1) return false;
  if (source[j] !== 'n' || source[j - 1] !== 'i') return false;
  // Word boundary: must not be part of a longer identifier (e.g., `bin`, `coin`,
  // `αin`). Reject any Unicode letter/digit, not just ASCII.
  return j - 2 < 0 || !/[\p{L}\p{N}_]/u.test(source[j - 2]);
}

// Result of processing one position within a subshell frame.
interface SubshellStep {
  // Next scan offset.
  nextPos: number;
  // When set, the subshell frame closed at this offset (its region end).
  closedEnd?: number;
  // When set, push this frame on top of the current one (used for nested
  // contexts like `((...))` inside `$()` that need independent state).
  pushFrame?: ScanFrame;
}

// Processes one position inside a subshell frame, handling heredocs, comments,
// [[ ]] depth, case/esac nesting, and parenthesis depth. Does not handle leaf
// constructs or nested expansion openers (the shared loop handles those).
function stepSubshellFrame(source: string, i: number, frame: ScanFrame): SubshellStep {
  const char = source[i];

  // At newline, skip pending heredoc bodies (multiple heredocs on same line)
  if ((char === '\n' || char === '\r') && frame.pendingHeredocs.length > 0) {
    let bodyStart = i + 1;
    if (char === '\r' && bodyStart < source.length && source[bodyStart] === '\n') {
      bodyStart++;
    }
    for (const hd of frame.pendingHeredocs) {
      const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator, true);
      bodyStart = body ? body.end : bodyStart;
    }
    frame.pendingHeredocs.length = 0;
    return { nextPos: bodyStart };
  }

  // Track [[ and ]] depth: # is not a comment inside [[ ]] conditional expressions
  if (char === '[' && i + 1 < source.length && source[i + 1] === '[' && isAtSubshellCommandPosition(source, i)) {
    frame.doubleBracketDepth++;
    return { nextPos: i + 2 };
  }
  if (char === ']' && i + 1 < source.length && source[i + 1] === ']' && frame.doubleBracketDepth > 0) {
    frame.doubleBracketDepth--;
    return { nextPos: i + 2 };
  }

  // Skip comments (# to end of line, but not $# special variable, not inside [[ ]])
  if (char === '#' && frame.doubleBracketDepth === 0 && isCommentStart(source, i) && !isDollarHashVariable(source, i)) {
    let j = i;
    while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
      j++;
    }
    return { nextPos: j };
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
      frame.pendingHeredocs.push({ stripTabs: heredoc.stripTabs, terminator: heredoc.terminator });
      return { nextPos: i + heredoc.matchLength };
    }
  }

  // Track case/esac nesting to avoid `)` in case patterns closing the substitution.
  // Only match case at command position (not as argument like `echo case`).
  // Reject when used as a variable name (case=val), array (case[i]=val), augmented
  // assignment (case+=val), or function definition (case() {...}).
  // Also require the character immediately after `case` to be a command separator,
  // so word-fused forms like `case+x`, `case#tag`, and `case)` (no subject word)
  // do not enter case scope and trap the subshell's closing `)`.
  if (
    !(i > 0 && source[i - 1] === '$') &&
    matchesWord(source, i, 'case') &&
    !isWordUsedAsAssignmentOrFunction(source, i, 4) &&
    isAtSubshellCommandPosition(source, i) &&
    isCaseSubjectSeparator(source, i + 4)
  ) {
    frame.caseDepth++;
    return { nextPos: i + 4 };
  }
  if (
    !(i > 0 && source[i - 1] === '$') &&
    matchesWord(source, i, 'esac') &&
    !isWordUsedAsAssignmentOrFunction(source, i, 4) &&
    // Allow `case x in esac` (empty pattern list): `in` directly precedes `esac`.
    (isAtSubshellCommandPosition(source, i) || (frame.caseDepth > 0 && isPrecededByInKeyword(source, i)))
  ) {
    if (frame.caseDepth > 0) frame.caseDepth--;
    return { nextPos: i + 4 };
  }

  if (char === '(') {
    // Bare `((` at a command position inside a subshell opens arithmetic
    // evaluation. Push a separate arithParen frame so its `<<` (left-shift),
    // `[[` etc. are not interpreted as heredoc operators or conditional
    // expressions by stepSubshellFrame.
    if (i + 1 < source.length && source[i + 1] === '(' && isAtSubshellCommandPosition(source, i)) {
      return { nextPos: i + 2, pushFrame: createFrame('arithParen', 2, i) };
    }
    // Bare `(` at a command position inside a subshell opens a nested
    // subshell scope. Push a separate subshell frame so its case/esac
    // nesting and [[ ]] depth do not leak into the outer subshell — the
    // outer frame must see the inner frame's matching `)` as a true paren
    // close, not as a case-pattern terminator that prolongs its region.
    if (isAtSubshellCommandPosition(source, i)) {
      return { nextPos: i + 1, pushFrame: createFrame('subshell', 1, i) };
    }
    frame.depth++;
    return { nextPos: i + 1 };
  }
  if (char === ')') {
    // Inside a case block, `)` that doesn't reduce paren depth below
    // the substitution boundary is a case pattern terminator
    if (frame.caseDepth > 0 && frame.depth === 1) {
      return { nextPos: i + 1 };
    }
    frame.depth--;
    // Flush pending heredocs when closing before a newline is encountered
    if (frame.depth === 0 && frame.pendingHeredocs.length > 0) {
      let j = i + 1;
      // Find the next newline after the closing )
      while (j < source.length && source[j] !== '\n' && source[j] !== '\r') {
        j++;
      }
      if (j < source.length) {
        let bodyStart = j + 1;
        if (source[j] === '\r' && bodyStart < source.length && source[bodyStart] === '\n') {
          bodyStart++;
        }
        for (const hd of frame.pendingHeredocs) {
          const body = matchHeredocBody(source, bodyStart, hd.stripTabs, hd.terminator, true);
          bodyStart = body ? body.end : bodyStart;
        }
        // Exclude the trailing newline so isAtCommandPosition can see the line boundary
        if (bodyStart > frame.regionStart && source[bodyStart - 1] === '\n') {
          bodyStart--;
          if (bodyStart > frame.regionStart && source[bodyStart - 1] === '\r') {
            bodyStart--;
          }
        } else if (bodyStart > frame.regionStart && source[bodyStart - 1] === '\r') {
          bodyStart--;
        }
        return { nextPos: bodyStart, closedEnd: bodyStart };
      }
      frame.pendingHeredocs.length = 0;
      return { nextPos: j, closedEnd: j };
    }
    if (frame.depth === 0) {
      return { nextPos: i + 1, closedEnd: i + 1 };
    }
    return { nextPos: i + 1 };
  }

  return { nextPos: i + 1 };
}

// Runs the iterative scanner with a single frame already on the stack and
// returns the bottom frame's matched region. The loop processes one position at
// a time across all nesting levels, pushing/popping frames instead of recursing.
function runScanner(source: string, initialFrame: ScanFrame, scanStart: number): ExcludedRegion {
  const stack: ScanFrame[] = [initialFrame];
  let i = scanStart;
  let bottomEnd = source.length;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (i >= source.length || frame.depth <= 0) {
      // Frame ended without seeing its closer: end at the current offset.
      if (stack.length === 1) {
        bottomEnd = i;
      }
      stack.pop();
      continue;
    }

    const inDoubleQuoteContext = frame.kind === 'dquote' || frame.kind === 'dquoteBrace';

    // Backslash escapes and backticks behave identically in every context.
    const leafEnd = skipUniformLeaf(source, i);
    if (leafEnd >= 0) {
      i = leafEnd;
      continue;
    }

    const char = source[i];

    // $'...' ANSI-C quoting. It is a string scope everywhere except inside a
    // plain double-quoted string, where `$` is literal and `'` is literal too.
    if (char === '$' && i + 1 < source.length && source[i + 1] === "'") {
      if (frame.kind === 'dquote') {
        i++;
        continue;
      }
      i = matchDollarSingleQuote(source, i).end;
      continue;
    }

    // A bare single quote opens a single-quoted string outside double-quote
    // contexts; inside "..." (and ${...} within it) the quote is literal.
    if (char === "'") {
      if (inDoubleQuoteContext) {
        i++;
        continue;
      }
      i = findSingleQuoteEnd(source, i);
      continue;
    }

    // A double quote starts a new string scope in every context except inside a
    // plain dquote frame, where it is that frame's own terminator.
    if (char === '"') {
      if (frame.kind === 'dquote') {
        frame.depth = 0;
        i++;
        if (stack.length === 1) {
          bottomEnd = i;
        }
        stack.pop();
        continue;
      }
      stack.push(createFrame('dquote', 1, i));
      i++;
      continue;
    }

    // Nested expansion openers (${ $( $(( $[) push a new frame.
    // Inside a dquoteBrace frame a nested ${ is just deeper brace nesting in the
    // same context, matching the legacy double-quote-aware scanner.
    if (frame.kind === 'dquoteBrace' && char === '$' && i + 1 < source.length && source[i + 1] === '{') {
      frame.depth++;
      i += 2;
      continue;
    }
    const opener = detectNestedOpener(source, i, inDoubleQuoteContext);
    if (opener) {
      stack.push(opener.frame);
      i = opener.nextPos;
      continue;
    }

    // Frame-specific depth tracking and closing.
    if (frame.kind === 'subshell') {
      const step = stepSubshellFrame(source, i, frame);
      i = step.nextPos;
      if (step.pushFrame !== undefined) {
        stack.push(step.pushFrame);
      }
      if (step.closedEnd !== undefined) {
        if (stack.length === 1) {
          bottomEnd = step.closedEnd;
        }
        stack.pop();
      }
      continue;
    }

    if (frame.kind === 'brace' || frame.kind === 'dquoteBrace') {
      // In a plain ${...} a bare { (not preceded by $) increases brace depth,
      // e.g. ${var:+{value}}. Inside a double-quoted ${...} a bare { is literal.
      if (frame.kind === 'brace' && char === '{' && (i === 0 || source[i - 1] !== '$')) {
        frame.depth++;
        i++;
        continue;
      }
      if (char === '}') {
        frame.depth--;
        i++;
        if (frame.depth <= 0) {
          if (stack.length === 1) {
            bottomEnd = i;
          }
          stack.pop();
        }
        continue;
      }
      i++;
      continue;
    }

    if (frame.kind === 'arithParen') {
      if (char === '(') {
        frame.depth++;
      } else if (char === ')') {
        frame.depth--;
      }
      i++;
      if (frame.depth <= 0) {
        if (stack.length === 1) {
          bottomEnd = i;
        }
        stack.pop();
      }
      continue;
    }

    if (frame.kind === 'arithBracket') {
      if (char === '[') {
        frame.depth++;
      } else if (char === ']') {
        frame.depth--;
      }
      i++;
      if (frame.depth <= 0) {
        if (stack.length === 1) {
          bottomEnd = i;
        }
        stack.pop();
      }
      continue;
    }

    // dquote: every meaningful char (escapes, nested expansions, the closing
    // quote) is handled above; any other character is plain string content.
    i++;
  }

  return { start: initialFrame.regionStart, end: bottomEnd };
}

// Matches arithmetic bracket $[...] (deprecated syntax)
export function matchArithmeticBracket(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('arithBracket', 1, pos), pos + 2);
}

// Matches parameter expansion ${...} with nested braces
export function matchParameterExpansion(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('brace', 1, pos), pos + 2);
}

// Matches arithmetic expansion $((...)) with string skipping
function matchArithmeticExpansion(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('arithParen', 2, pos), pos + 3);
}

// Matches bare arithmetic evaluation (( ... )) (not preceded by $)
export function matchBareArithmeticEvaluation(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('arithParen', 2, pos), pos + 2);
}

// Matches double-quoted string with Bash-specific handling for $(), ${}, and backticks
export function matchBashDoubleQuote(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('dquote', 1, pos), pos + 1);
}

// Matches command substitution $(...) with nested parentheses
// Tracks case/esac nesting so `)` in case patterns doesn't close prematurely
export function matchCommandSubstitution(source: string, pos: number): ExcludedRegion {
  // Check for arithmetic expansion $((...))
  if (pos + 2 < source.length && source[pos + 2] === '(') {
    return matchArithmeticExpansion(source, pos);
  }

  return runScanner(source, createFrame('subshell', 1, pos), pos + 2);
}

// Matches process substitution <(...) or >(...) with nested parens
export function matchProcessSubstitution(source: string, pos: number): ExcludedRegion {
  return runScanner(source, createFrame('subshell', 1, pos - 1), pos + 1);
}
