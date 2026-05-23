// MATLAB per-parse cache builders: bracket depth, logical-line starts, logical-line metadata

import type { ExcludedRegion } from '../types';
import { isHorizontalWhitespace } from './matlabHelpers';
import { findExcludedRegionAt, isInExcludedRegion } from './parserUtils';

// Per-logical-line metadata, computed once per parse and consulted by the
// logical-line-scanning validators (isCommandSyntaxArgument / isUsedAsRhsIdentifier)
// so they answer in O(1) instead of walking the source backward each call.
export interface LogicalLineInfo {
  // Start offset of the leading identifier of the line when the line is a
  // pure whitespace-separated identifier sequence whose first identifier is a
  // non-keyword (i.e. command-syntax like `disp end`). -1 when the line is not
  // command-syntax (leading token is a keyword, a number, an operator, etc.).
  commandLeadIdentStart: number;
  // Offset just past the last identifier of the leading pure-identifier run.
  // A keyword whose start offset is within [commandLeadIdentStart, pureRunEnd)
  // and is not the leading identifier is a command-syntax string argument.
  pureRunEnd: number;
  // Offset of the first plain assignment `=` in the line (not `==`/`<=`/`>=`/
  // `~=`/`!=`), or -1 when the line has no assignment. A block keyword appearing
  // after this offset sits on the RHS of an assignment.
  firstAssignEqOffset: number;
}

// Pre-computes bracket depth at every position in source. depth[p] = number of
// balanced (), [], or {} pairs that strictly enclose position p (i.e. start < p < end).
// Brackets inside excluded regions (comments / strings) are ignored. Unbalanced
// openers (no matching close) do NOT contribute, matching the original
// hasMatchingCloseAhead-gated semantics. Single forward pass: O(source.length).
export function computeBracketDepthAtPos(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
  const len = source.length;
  // Events list: each balanced pair contributes +1 at start+1 and -1 at end.
  const events: Array<{ pos: number; delta: number }> = [];
  const parenStack: number[] = [];
  const bracketStack: number[] = [];
  const braceStack: number[] = [];
  let i = 0;
  while (i < len) {
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        i = region.end;
        continue;
      }
    }
    const ch = source[i];
    if (ch === '(') parenStack.push(i);
    else if (ch === ')') {
      const start = parenStack.pop();
      if (start !== undefined) {
        events.push({ pos: start + 1, delta: 1 });
        events.push({ pos: i, delta: -1 });
      }
    } else if (ch === '[') bracketStack.push(i);
    else if (ch === ']') {
      const start = bracketStack.pop();
      if (start !== undefined) {
        events.push({ pos: start + 1, delta: 1 });
        events.push({ pos: i, delta: -1 });
      }
    } else if (ch === '{') braceStack.push(i);
    else if (ch === '}') {
      const start = braceStack.pop();
      if (start !== undefined) {
        events.push({ pos: start + 1, delta: 1 });
        events.push({ pos: i, delta: -1 });
      }
    }
    i++;
  }
  // Sort events by position, then accumulate prefix sum into a per-position depth array.
  events.sort((a, b) => a.pos - b.pos);
  const depthAtPos = new Int32Array(len + 1);
  let depth = 0;
  let eventIdx = 0;
  for (let p = 0; p <= len; p++) {
    while (eventIdx < events.length && events[eventIdx].pos === p) {
      depth += events[eventIdx].delta;
      eventIdx++;
    }
    depthAtPos[p] = depth;
  }
  return depthAtPos;
}

// Returns true when the physical line break at position `nlPos` is immediately
// preceded by a `...` (or Octave `\`) line continuation. matchSingleLineComment
// ends a `...` excluded region at the newline start, so a region whose `end`
// equals the newline position and whose first char is `.`/`\` is a continuation.
function isLineContinuationBeforeNewline(source: string, nlPos: number, excludedRegions: ExcludedRegion[]): boolean {
  if (nlPos <= 0) return false;
  const region = findExcludedRegionAt(nlPos - 1, excludedRegions);
  return region !== null && region.end === nlPos && (source[region.start] === '.' || source[region.start] === '\\');
}

// Pre-computes the logical-line start offset for every position in source.
// statementStartAtPos[p] = start offset of the logical line containing p.
// A logical line begins at file start, just after a `;`/`,` outside excluded
// regions, or at a physical line start that is not the continuation of a
// `...`/`\` line. `;`/`,` and newlines inside excluded regions (strings,
// comments, line-continuation regions) never start a new line. Single forward
// pass: O(source.length). Lets the logical-line-scanning validators answer in
// O(1) instead of walking the source backward each call.
export function computeStatementStarts(source: string, excludedRegions: ExcludedRegion[]): Int32Array {
  const len = source.length;
  const result = new Int32Array(len + 1);
  let lineStart = 0;
  let i = 0;
  while (i < len) {
    // Skip excluded regions wholesale: separators/newlines inside strings,
    // comments, and `...`/`\` continuation regions do not split a logical line.
    if (isInExcludedRegion(i, excludedRegions)) {
      const region = findExcludedRegionAt(i, excludedRegions);
      if (region) {
        for (let p = i; p < region.end && p < len; p++) {
          result[p] = lineStart;
        }
        i = region.end;
        continue;
      }
    }
    result[i] = lineStart;
    const ch = source[i];
    if (ch === ';' || ch === ',') {
      // Statement separator: the next logical line starts right after it.
      lineStart = i + 1;
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Physical line break. Walk past a CRLF pair as a single line ending.
      let nextStart = i + 1;
      if (ch === '\r' && i + 1 < len && source[i + 1] === '\n') {
        nextStart = i + 2;
      }
      // The line break ends the logical line unless the physical line ended
      // with a `...`/`\` continuation (an excluded region ending at this break).
      if (!isLineContinuationBeforeNewline(source, i, excludedRegions)) {
        lineStart = nextStart;
      }
      for (let p = i; p < nextStart; p++) {
        result[p] = result[i];
      }
      i = nextStart;
      continue;
    }
    i++;
  }
  result[len] = lineStart;
  return result;
}

// Scans a single logical line (starting at `lineStart`) and derives its
// command-syntax and assignment metadata. Excluded regions are skipped; `...`/`\`
// continuation regions inside the leading identifier run are treated as
// whitespace so `disp ...<NL> end` is recognised as a continued command line.
// `statementStarts` is the per-position logical-line cache; `blockKeywords` is
// the recognised block keyword set (so a leading keyword is not command-syntax).
export function computeLogicalLineInfo(
  source: string,
  lineStart: number,
  excludedRegions: ExcludedRegion[],
  statementStarts: Int32Array | null,
  blockKeywords: Set<string>
): LogicalLineInfo {
  const len = source.length;
  // Walk the leading whitespace-separated identifier run.
  let commandLeadIdentStart = -1;
  let pureRunEnd = lineStart;
  let firstIdentIsKeyword = false;
  let identCount = 0;
  let i = lineStart;
  while (i < len && statementStarts !== null && statementStarts[i] === lineStart) {
    const ch = source[i];
    // Skip whitespace (ASCII + Unicode horizontal whitespace such as NBSP / em space /
    // VT / FF / ideographic space), a leading BOM, and the newline of a `...`/`\`
    // continuation. The loop guard guarantees any newline reached here belongs to this
    // logical line (a continuation break), so it is treated as whitespace within the run.
    if (isHorizontalWhitespace(ch) || ch === '\u{FEFF}' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // Treat `...`/`\` continuation regions as whitespace within the run.
    const region = findExcludedRegionAt(i, excludedRegions);
    if (region && (source[region.start] === '.' || source[region.start] === '\\') && region.end > region.start + 1) {
      i = region.end;
      continue;
    }
    if (!/[a-zA-Z0-9_]/.test(ch)) {
      break;
    }
    // An identifier run starting with a digit is a number, not an identifier.
    if (identCount === 0 && !/[a-zA-Z_]/.test(ch)) {
      break;
    }
    const identStart = i;
    while (i < len && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    if (identCount === 0) {
      commandLeadIdentStart = identStart;
      firstIdentIsKeyword = blockKeywords.has(source.slice(identStart, i).toLowerCase());
    }
    identCount++;
    pureRunEnd = i;
  }
  // A line is command-syntax only when its leading token is a non-keyword
  // identifier and at least one further token follows it in the run.
  if (firstIdentIsKeyword || identCount < 2) {
    commandLeadIdentStart = -1;
  }
  // Find the first plain assignment `=` in the line.
  let firstAssignEqOffset = -1;
  let j = lineStart;
  while (j < len && statementStarts !== null && statementStarts[j] === lineStart) {
    if (isInExcludedRegion(j, excludedRegions)) {
      const region = findExcludedRegionAt(j, excludedRegions);
      if (region) {
        j = region.end;
        continue;
      }
    }
    if (source[j] === '=') {
      const prev = j > lineStart ? source[j - 1] : '';
      const next = j + 1 < len ? source[j + 1] : '';
      if (next !== '=' && prev !== '=' && prev !== '<' && prev !== '>' && prev !== '!' && prev !== '~') {
        firstAssignEqOffset = j;
        break;
      }
    }
    j++;
  }
  return { commandLeadIdentStart, pureRunEnd, firstAssignEqOffset };
}
