// VHDL block validation helpers for isValidBlockOpen keyword checks

import type { ExcludedRegion } from '../types';

// Callbacks for base parser methods needed by validation functions
export interface VhdlValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Keywords that can be followed by 'loop'
const LOOP_PREFIX_KEYWORDS = ['for', 'while'];

// Validates 'for' keyword: rejects 'wait for' timing statements, 'use entity/configuration ... for' binding clauses,
// and configuration specifications ('for <id/all/others> : <id> use entity/configuration ... ;')
export function isValidForOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  const textBefore = source.slice(0, position).toLowerCase();
  const lastNewline = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const lineStart = lastNewline + 1;
  const rawLineBefore = textBefore.slice(lineStart);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  // Strip trailing comments (-- ...) before checking for wait
  const lineBeforeNoComment = stripTrailingComment(lineBefore, lineStart + trimOffset, excludedRegions, callbacks);
  // Reject 'for' in 'use entity ... for ...' or 'use configuration ... for ...' binding clauses
  const useEntityMatch = lineBeforeNoComment.match(/\buse[ \t]+(entity|configuration)\b/);
  if (useEntityMatch && useEntityMatch.index !== undefined) {
    const useAbsOffset = lineStart + trimOffset + useEntityMatch.index;
    if (!callbacks.isInExcludedRegion(useAbsOffset, excludedRegions)) {
      let hasSemicolon = false;
      for (let ci = useAbsOffset + useEntityMatch[0].length; ci < position; ci++) {
        if (source[ci] === ';' && !callbacks.isInExcludedRegion(ci, excludedRegions)) {
          hasSemicolon = true;
          break;
        }
      }
      if (!hasSemicolon) {
        return false;
      }
    }
  }
  if (isWaitBeforeFor(lineBeforeNoComment, lineStart, rawLineBefore, excludedRegions, callbacks)) {
    return false;
  }
  // Check previous lines for 'wait' or 'use entity/configuration' (multi-line, skip blank lines)
  if (lastNewline > 0) {
    let scanEnd = lastNewline;
    // Skip the \r in \r\n pairs
    if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
      scanEnd--;
    }
    let mapParenDepth = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const prevNl = Math.max(textBefore.lastIndexOf('\n', scanEnd - 1), textBefore.lastIndexOf('\r', scanEnd - 1));
      const rawPrevLine = textBefore.slice(prevNl + 1, scanEnd);
      const prevLine = rawPrevLine.trimStart();
      if (/^[ \t]*$/.test(prevLine)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevTrimOffset = rawPrevLine.length - prevLine.length;
      const prevLineNoComment = stripTrailingComment(prevLine, prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      // Skip comment-only lines (line content is entirely inside a comment)
      if (/^[ \t]*$/.test(prevLineNoComment)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevUseMatch = prevLineNoComment.match(/\buse[ \t]+(entity|configuration)\b/);
      if (prevUseMatch && prevUseMatch.index !== undefined) {
        const prevUseAbsOffset = prevNl + 1 + prevTrimOffset + prevUseMatch.index;
        if (!callbacks.isInExcludedRegion(prevUseAbsOffset, excludedRegions)) {
          let prevHasSemicolon = false;
          for (let ci = prevUseAbsOffset + prevUseMatch[0].length; ci < position; ci++) {
            if (source[ci] === ';' && !callbacks.isInExcludedRegion(ci, excludedRegions)) {
              prevHasSemicolon = true;
              break;
            }
          }
          if (!prevHasSemicolon) {
            return false;
          }
        }
      }
      if (isWaitBeforeFor(prevLineNoComment, prevNl + 1, rawPrevLine, excludedRegions, callbacks)) {
        return false;
      }
      // Continue scanning upward through port map / generic map lines
      if (/\b(port|generic)[ \t]+map\b/.test(prevLineNoComment)) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      // Track parenthesis depth: continue scanning upward through multi-line port/generic map content
      // Accumulate depth across lines (not reset per line)
      {
        const lineAbsStart = prevNl + 1;
        for (let ci = lineAbsStart + rawPrevLine.length - 1; ci >= lineAbsStart; ci--) {
          if (callbacks.isInExcludedRegion(ci, excludedRegions)) continue;
          if (source[ci] === ')') mapParenDepth++;
          else if (source[ci] === '(') mapParenDepth--;
        }
        if (mapParenDepth > 0) {
          if (prevNl <= 0) break;
          scanEnd = prevNl;
          if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
            scanEnd--;
          }
          continue;
        }
      }
      break;
    }
  }
  // Forward scan: reject 'for' in configuration specifications where
  // 'use entity' or 'use configuration' appears AFTER the 'for' keyword
  // Pattern: for <id/all/others> : <id> use entity/configuration ... ;
  if (hasUseEntityOrConfigAfterFor(source, position, excludedRegions, callbacks)) {
    return false;
  }
  return true;
}

// Scans forward from a 'for' keyword to detect configuration specification pattern
// Pattern: for <id/all/others> : <id> use entity/configuration ... ;
// Only matches when 'use entity' or 'use configuration' appears on the same line as 'for'
// (configuration blocks have 'use entity' on a separate indented line)
// Checks if 'end' keyword appears after current position on the same line
// Used to detect compact configuration blocks: for ... use entity ...; end for;
function hasEndKeywordOnSameLine(
  source: string,
  pos: number,
  len: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  let j = pos;
  while (j < len) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    const ch = source[j];
    if (ch === '\n' || ch === '\r') return false;
    if (/[a-zA-Z_]/.test(ch)) {
      const ws = j;
      while (j < len && /[a-zA-Z0-9_]/.test(source[j])) j++;
      if (source.slice(ws, j).toLowerCase() === 'end') return true;
      continue;
    }
    j++;
  }
  return false;
}

function hasUseEntityOrConfigAfterFor(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const forKeywordLength = 3;
  let j = position + forKeywordLength;
  const len = source.length;
  while (j < len) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    const ch = source[j];
    // Newline ends the same-line scan; config specs are single-line statements
    if (ch === '\n' || ch === '\r') {
      return false;
    }
    // Semicolon terminates the statement; no use entity/configuration found
    if (ch === ';') {
      return false;
    }
    // Check for word boundaries to detect keywords
    if (/[a-zA-Z_]/.test(ch)) {
      const wordStart = j;
      while (j < len && /[a-zA-Z0-9_]/.test(source[j])) {
        j++;
      }
      const word = source.slice(wordStart, j).toLowerCase();
      // If we hit 'loop' or 'generate', this is a real block opener (not a config spec)
      if (word === 'loop' || word === 'generate') {
        return false;
      }
      // Check for 'use' followed by 'entity' or 'configuration'
      if (word === 'use') {
        // Skip whitespace (spaces/tabs only, not newlines) after 'use'
        let k = j;
        while (k < len && (source[k] === ' ' || source[k] === '\t')) {
          k++;
        }
        if (k < len && /[a-zA-Z_]/.test(source[k])) {
          const nextWordStart = k;
          while (k < len && /[a-zA-Z0-9_]/.test(source[k])) {
            k++;
          }
          const nextWord = source.slice(nextWordStart, k).toLowerCase();
          if (nextWord === 'entity' || nextWord === 'configuration') {
            if (!callbacks.isInExcludedRegion(wordStart, excludedRegions)) {
              // Check if 'end' follows later on the same line (compact configuration block)
              // If so, this is a block, not a single-line config spec
              if (hasEndKeywordOnSameLine(source, k, len, excludedRegions, callbacks)) {
                return false;
              }
              return true;
            }
          }
        }
      }
      continue;
    }
    j++;
  }
  return false;
}

// Validates 'while' keyword: rejects 'wait while' (not a loop construct)
export function isValidWhileOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
    i--;
  }
  // Skip excluded regions backward (comments between wait and while)
  while (i >= 0 && callbacks.isInExcludedRegion(i, excludedRegions)) {
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.start - 1;
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) {
        i--;
      }
    } else {
      i--;
    }
  }
  if (i >= 3) {
    const candidate = source.slice(i - 3, i + 1).toLowerCase();
    if (candidate === 'wait' && (i - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 4]))) {
      return false;
    }
  }
  return true;
}

// Validates 'component': rejects 'label: component' instantiation (not a declaration)
export function isValidComponentOpen(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  // Scan backward from component, skipping whitespace
  let i = position - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  // If preceded by ':', this is a component instantiation (label: component name ...)
  if (i >= 0 && source[i] === ':') {
    if (!callbacks.isInExcludedRegion(i, excludedRegions)) {
      return false;
    }
  }
  return true;
}

// Validates 'entity'/'configuration': rejects 'use entity', 'label: entity' direct instantiation
export function isValidEntityOrConfigOpen(
  lowerKeyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const textBefore = source.slice(0, position).toLowerCase();
  const lastNl = Math.max(textBefore.lastIndexOf('\n'), textBefore.lastIndexOf('\r'));
  const rawLineBefore = textBefore.slice(lastNl + 1);
  const lineBefore = rawLineBefore.trimStart();
  const trimOffset = rawLineBefore.length - lineBefore.length;
  const lineBeforeNoComment = stripTrailingComment(lineBefore, lastNl + 1 + trimOffset, excludedRegions, callbacks);
  if (/\buse[ \t]+$/.test(lineBeforeNoComment)) {
    return false;
  }
  // Check previous lines for 'use' (multi-line use entity/configuration)
  if (/^[ \t]*$/.test(lineBeforeNoComment) && lastNl > 0) {
    let scanEnd = lastNl;
    if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
      scanEnd--;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const prevNl = Math.max(textBefore.lastIndexOf('\n', scanEnd - 1), textBefore.lastIndexOf('\r', scanEnd - 1));
      const prevLine = textBefore.slice(prevNl + 1, scanEnd);
      const trimmedPrev = prevLine.trimStart();
      const prevTrimOffset = prevLine.length - trimmedPrev.length;
      if (trimmedPrev.trim().length === 0) {
        if (prevNl <= 0) break;
        scanEnd = prevNl;
        if (scanEnd > 0 && textBefore[scanEnd - 1] === '\r') {
          scanEnd--;
        }
        continue;
      }
      const prevNoComment = stripTrailingComment(trimmedPrev, prevNl + 1 + prevTrimOffset, excludedRegions, callbacks);
      const useMatch = prevNoComment.match(/\buse[ \t]*$/);
      if (useMatch && useMatch.index !== undefined) {
        // Check that the 'use' is not inside an excluded region (e.g., comment)
        const useOffset = prevNl + 1 + prevTrimOffset + useMatch.index;
        if (!callbacks.isInExcludedRegion(useOffset, excludedRegions)) {
          return false;
        }
      }
      break;
    }
  }
  if (lowerKeyword === 'entity') {
    const colonMatch = lineBeforeNoComment.match(/:[ \t]*$/);
    if (colonMatch) {
      const colonOffset = lastNl + 1 + trimOffset + (lineBeforeNoComment.length - colonMatch[0].length);
      if (!callbacks.isInExcludedRegion(colonOffset, excludedRegions)) {
        return false;
      }
    }
    if (/^[ \t]*$/.test(lineBeforeNoComment) && lastNl > 0) {
      // Skip blank lines to find the preceding non-blank line with a colon
      let currentEnd = lastNl;
      for (let attempt = 0; attempt < 5; attempt++) {
        let searchEnd = currentEnd - 1;
        if (searchEnd >= 0 && textBefore[searchEnd] === '\r') {
          searchEnd--;
        }
        if (searchEnd < 0) break;
        const prevNl = Math.max(textBefore.lastIndexOf('\n', searchEnd), textBefore.lastIndexOf('\r', searchEnd));
        let prevLineEnd = currentEnd;
        if (prevLineEnd > 0 && textBefore[prevLineEnd - 1] === '\r') {
          prevLineEnd--;
        }
        const prevLine = textBefore.slice(prevNl + 1, prevLineEnd);
        if (/^[ \t]*$/.test(prevLine)) {
          currentEnd = prevNl >= 0 ? prevNl : 0;
          if (currentEnd <= 0) break;
          continue;
        }
        const prevColonMatch = prevLine.match(/:[ \t]*$/);
        if (prevColonMatch) {
          const prevColonOffset = prevNl + 1 + (prevLine.length - prevColonMatch[0].length);
          if (!callbacks.isInExcludedRegion(prevColonOffset, excludedRegions)) {
            return false;
          }
        }
        break;
      }
    }
  }
  return true;
}

// Validates 'function'/'procedure': rejects declarations (ending with ;) that are not blocks
export function isValidFuncProcOpen(
  keyword: string,
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  let j = position + keyword.length;
  let parenDepth = 0;
  while (j < source.length) {
    if (callbacks.isInExcludedRegion(j, excludedRegions)) {
      j++;
      continue;
    }
    if (source[j] === '(') parenDepth++;
    else if (source[j] === ')') parenDepth--;
    else if (parenDepth === 0) {
      if (source[j] === ';') return false;
      const twoChars = source.slice(j, j + 2).toLowerCase();
      if (twoChars === 'is' && (j === 0 || !/[a-zA-Z0-9_]/.test(source[j - 1])) && (j + 2 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 2]))) {
        return true;
      }
    }
    j++;
  }
  return false;
}

// Validates 'loop': checks for prefix keywords (for/while) and rejects standalone 'loop' in 'end loop'
export function isValidLoopOpen(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  // Reject 'loop' preceded by a dot (e.g., record.loop or record . loop)
  let dotCheck = position - 1;
  while (dotCheck >= 0 && (source[dotCheck] === ' ' || source[dotCheck] === '\t')) {
    dotCheck--;
  }
  if (dotCheck >= 0 && source[dotCheck] === '.') {
    return false;
  }

  // Look backwards across multiple lines to find if a prefix keyword precedes this
  const textBefore = source.slice(0, position).toLowerCase();
  // Split on \r\n, \r, or \n to handle all line ending types
  const lines = textBefore.split(/\r\n|\r|\n/);
  const maxLines = Math.min(lines.length, 15);

  // Track loop positions that have been paired with a preceding for/while
  const pairedLoopPositions = new Set<number>();

  // Calculate absolute offsets for each line
  let lineStartOffset = textBefore.length;
  for (let idx = 0; idx < maxLines; idx++) {
    const lineIdx = lines.length - 1 - idx;
    const lineText = lines[lineIdx];
    if (idx > 0) {
      // Account for the line terminator (1 for \n or \r, 2 for \r\n)
      if (lineStartOffset >= 2 && source[lineStartOffset - 2] === '\r' && source[lineStartOffset - 1] === '\n') {
        lineStartOffset -= 2;
      } else {
        lineStartOffset -= 1;
      }
    }
    lineStartOffset -= lineText.length;

    for (const prefix of LOOP_PREFIX_KEYWORDS) {
      const pattern = new RegExp(`\\b${prefix}\\b`, 'g');
      for (const prefixMatch of lineText.matchAll(pattern)) {
        const absolutePos = lineStartOffset + prefixMatch.index;
        if (callbacks.isInExcludedRegion(absolutePos, excludedRegions)) {
          continue;
        }
        // Reject prefix keyword preceded by '.' (hierarchical reference like inst.for)
        let prefixDotCheck = absolutePos - 1;
        while (prefixDotCheck >= 0 && (source[prefixDotCheck] === ' ' || source[prefixDotCheck] === '\t')) {
          prefixDotCheck--;
        }
        if (prefixDotCheck >= 0 && source[prefixDotCheck] === '.') {
          continue;
        }
        // Check if 'generate' appears between the for/while and 'loop' (not in excluded region)
        // Must check all lines between prefix and loop, since generate may be on a different line
        const textBetween = source.slice(absolutePos, position).toLowerCase();
        const generatePattern = /\bgenerate\b/g;
        let isGeneratePrefix = false;
        for (const genMatch of textBetween.matchAll(generatePattern)) {
          const genAbsPos = absolutePos + genMatch.index;
          if (!callbacks.isInExcludedRegion(genAbsPos, excludedRegions)) {
            isGeneratePrefix = true;
            break;
          }
        }
        if (isGeneratePrefix) {
          continue;
        }
        // Check if 'for' is part of a 'wait for' timing statement (not a loop prefix)
        if (prefix === 'for' && !isValidForOpen(source, absolutePos, excludedRegions, callbacks)) {
          continue;
        }
        // Check if there's a 'loop' between this for/while and our loop position (already paired)
        // Search the text between the prefix and our position, not just the same line
        const searchStart = absolutePos + prefix.length;
        const textBetweenPrefixAndLoop = source.slice(searchStart, position).toLowerCase();
        const loopPattern = /\bloop\b/g;
        let foundPairedLoop = false;
        for (const loopMatch of textBetweenPrefixAndLoop.matchAll(loopPattern)) {
          const loopAbsPos = searchStart + loopMatch.index;
          if (callbacks.isInExcludedRegion(loopAbsPos, excludedRegions)) {
            continue;
          }
          // Check if this 'loop' is preceded by 'end' (part of 'end loop')
          const beforeLoopText = source
            .slice(Math.max(0, loopAbsPos - 10), loopAbsPos)
            .trimEnd()
            .toLowerCase();
          if (/\bend$/.test(beforeLoopText)) {
            continue;
          }
          // Skip loop positions already paired with a previous for/while
          if (pairedLoopPositions.has(loopAbsPos)) {
            continue;
          }
          pairedLoopPositions.add(loopAbsPos);
          foundPairedLoop = true;
          break;
        }
        if (foundPairedLoop) {
          continue;
        }
        // Check if a semicolon terminates the for/while before reaching our loop
        const prefixEnd = absolutePos + prefix.length;
        const textFromPrefixToLoop = source.slice(prefixEnd, position);
        let foundSemicolon = false;
        for (let si = 0; si < textFromPrefixToLoop.length; si++) {
          if (textFromPrefixToLoop[si] === ';') {
            const semiAbsPos = prefixEnd + si;
            if (!callbacks.isInExcludedRegion(semiAbsPos, excludedRegions)) {
              foundSemicolon = true;
              break;
            }
          }
        }
        if (foundSemicolon) {
          continue;
        }
        return false;
      }
    }

    // Stop at a previous statement (indicated by semicolon not in excluded region)
    if (idx > 0) {
      for (let ci = 0; ci < lineText.length; ci++) {
        if (lineText[ci] === ';' && !callbacks.isInExcludedRegion(lineStartOffset + ci, excludedRegions)) {
          return true;
        }
      }
    }
  }

  return true;
}

// Checks if position is within a signal assignment (has <= before it in the same statement)
// keyword parameter indicates which keyword ('when' or 'else') is being checked
export function isInSignalAssignment(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  keyword: string,
  callbacks: VhdlValidationCallbacks
): boolean {
  // Search backwards for <= or statement/block boundaries
  const lowerSource = source.toLowerCase();
  let i = position - 1;
  let foundWhen = false;
  while (i >= 0) {
    // Skip over excluded regions (comments, strings)
    const region = callbacks.findExcludedRegionAt(i, excludedRegions);
    if (region) {
      i = region.start - 1;
      continue;
    }
    const ch = source[i];
    if (ch === ';') return false;
    // Track 'when' keyword presence (conditional signal assignments require when before else)
    if (i >= 3) {
      const whenSlice = lowerSource.slice(i - 3, i + 1);
      if (
        whenSlice === 'when' &&
        (i - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 4])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        foundWhen = true;
      }
    }
    if (ch === '=' && i > 0 && source[i - 1] === '<') {
      // For 'when': finding <= is sufficient (first when in conditional assignment)
      // For 'else': require a 'when' between <= and else
      // If scanning for 'else' and no 'when' found yet, this <= may be a comparison
      // operator (e.g., `sig <= '1' when x <= 5 else '0'`), so continue scanning
      if (keyword === 'when' || foundWhen) {
        // For 'else': verify the <= is not inside a then-branch of an if/elsif block
        // by scanning backward from <= looking for 'then' before ';'
        if (keyword === 'else') {
          let j = i - 2;
          let foundThenBeforeLe = false;
          while (j >= 0) {
            const rj = callbacks.findExcludedRegionAt(j, excludedRegions);
            if (rj) {
              j = rj.start - 1;
              continue;
            }
            // Semicolon means the <= starts a new statement; it's a valid signal assignment
            if (source[j] === ';') break;
            // Check for 'then' keyword boundary
            if (j >= 3) {
              const thenSlice = lowerSource.slice(j - 3, j + 1);
              if (
                thenSlice === 'then' &&
                (j - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[j - 4])) &&
                (j + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 1]))
              ) {
                foundThenBeforeLe = true;
                break;
              }
            }
            j--;
          }
          // When 'then' is found before '<=' (first statement in if/elsif block),
          // the <= IS a signal assignment. Check if this 'else' has a value expression
          // on the same line (e.g., "else b;") to confirm it is part of the signal
          // assignment, not the if-block's else on its own line
          if (foundThenBeforeLe) {
            const elseEnd = position + keyword.length;
            let k = elseEnd;
            while (k < source.length && (source[k] === ' ' || source[k] === '\t')) {
              k++;
            }
            // If next non-space character is a newline, end of source, or inline comment,
            // this else is likely the if-block's else, not part of the signal assignment
            if (k >= source.length || source[k] === '\n' || source[k] === '\r') {
              return false;
            }
            // Inline comment (--) after else means no value expression follows
            if (k + 1 < source.length && source[k] === '-' && source[k + 1] === '-') {
              return false;
            }
            // Otherwise, there's content on the same line after else (value expression),
            // so this else IS part of the conditional signal assignment
            return true;
          }
        }
        return true;
      }
      // Skip past the < of <= and continue scanning for the real signal assignment <=
      i -= 2;
      continue;
    }
    // Port/generic map association: => (e.g., sig => val when cond else other)
    // But NOT case branch arrow (when choice =>)
    if (ch === '>' && i > 0 && source[i - 1] === '=') {
      if (isCaseBranchArrow(source, i - 1, lowerSource, excludedRegions, callbacks)) {
        i -= 2;
        continue;
      }
      return keyword === 'when' || foundWhen;
    }
    // Variable assignment :=
    if (ch === '=' && i > 0 && source[i - 1] === ':') {
      return keyword === 'when' || foundWhen;
    }
    // 'return' starts a conditional expression context (return X when C else Y)
    if (i >= 5) {
      const retSlice = lowerSource.slice(i - 5, i + 1);
      if (
        retSlice === 'return' &&
        (i - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[i - 6])) &&
        (i + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[i + 1]))
      ) {
        return keyword === 'when' || foundWhen;
      }
    }
    // Stop at block boundary keywords that start a new context
    // Note: 'else'/'elsif' are NOT boundaries here because chained conditional
    // signal assignments use else (e.g., sig <= a when c1 else b when c2 else c;)
    // The 'then' keyword already acts as a boundary for if branches.
    for (const boundary of ['then', 'begin', 'loop', 'generate', 'is', 'end']) {
      const len = boundary.length;
      if (i >= len - 1) {
        const start = i - len + 1;
        if (
          lowerSource.slice(start, start + len) === boundary &&
          (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) &&
          (start + len >= source.length || !/[a-zA-Z0-9_]/.test(source[start + len]))
        ) {
          return false;
        }
      }
    }
    i--;
  }
  return false;
}

// Checks if => at position is part of a case branch (preceded by 'when' keyword)
function isCaseBranchArrow(
  source: string,
  eqPos: number,
  lowerSource: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  let j = eqPos - 1;
  while (j >= 0) {
    const rj = callbacks.findExcludedRegionAt(j, excludedRegions);
    if (rj) {
      j = rj.start - 1;
      continue;
    }
    const c = source[j];
    if (c === ';') return false;
    // Check for 'when' keyword (4 chars ending at j)
    if (j >= 3) {
      const slice = lowerSource.slice(j - 3, j + 1);
      if (slice === 'when' && (j - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[j - 4])) && (j + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[j + 1]))) {
        return true;
      }
    }
    // Stop at block boundary keywords
    for (const boundary of ['then', 'begin', 'is', 'end']) {
      const len = boundary.length;
      if (j >= len - 1) {
        const start = j - len + 1;
        if (
          lowerSource.slice(start, start + len) === boundary &&
          (start === 0 || !/[a-zA-Z0-9_]/.test(source[start - 1])) &&
          (start + len >= source.length || !/[a-zA-Z0-9_]/.test(source[start + len]))
        ) {
          return false;
        }
      }
    }
    j--;
  }
  return false;
}

// Checks if position is inside parenthesized expression (port map, generic map, function call)
// Scans backward from position to find unmatched '('
export function isInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[], callbacks: VhdlValidationCallbacks): boolean {
  let depth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (callbacks.isInExcludedRegion(i, excludedRegions)) continue;
    const ch = source[i];
    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        return true;
      }
      depth--;
    }
  }
  return false;
}

// Strips trailing comment content from a line using excluded regions
// textAbsOffset is the absolute offset where lineText starts in the source
function stripTrailingComment(
  lineText: string,
  textAbsOffset: number,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): string {
  for (let ci = 0; ci < lineText.length - 1; ci++) {
    if (lineText[ci] === '-' && lineText[ci + 1] === '-') {
      const absPos = textAbsOffset + ci;
      // Only strip if this is the start of a comment (excluded region starts here)
      // not if we're inside a string (excluded region starts before here)
      const region = callbacks.findExcludedRegionAt(absPos, excludedRegions);
      if (region && region.start === absPos) {
        return lineText.slice(0, ci).trimEnd();
      }
    }
  }
  return lineText;
}

// Checks if 'wait' at the end of line text is a real wait statement
// (not inside an excluded region like a string or comment)
// Finds the LAST valid wait on the line, since earlier waits may be terminated by semicolons
function isWaitBeforeFor(
  trimmedLineText: string,
  lineAbsOffset: number,
  rawLineText: string,
  excludedRegions: ExcludedRegion[],
  callbacks: VhdlValidationCallbacks
): boolean {
  const trimOffset = rawLineText.length - rawLineText.trimStart().length;
  const waitPattern = /\bwait\b/gi;
  let lastUnterminatedWait = false;
  for (const match of trimmedLineText.matchAll(waitPattern)) {
    const waitAbsPos = lineAbsOffset + trimOffset + match.index;
    if (callbacks.isInExcludedRegion(waitAbsPos, excludedRegions)) {
      continue;
    }
    // Reject wait preceded by '.' (hierarchical reference like rec.wait)
    const waitPosInRaw = waitAbsPos - lineAbsOffset;
    let waitDotCheck = waitPosInRaw - 1;
    while (waitDotCheck >= 0 && (rawLineText[waitDotCheck] === ' ' || rawLineText[waitDotCheck] === '\t')) {
      waitDotCheck--;
    }
    if (waitDotCheck >= 0 && rawLineText[waitDotCheck] === '.') {
      continue;
    }
    // Check if this wait is terminated by a semicolon
    const afterWait = trimmedLineText.slice(match.index + 4);
    let terminated = false;
    for (let ci = 0; ci < afterWait.length; ci++) {
      if (afterWait[ci] === ';') {
        const semiAbsPos = waitAbsPos + 4 + ci;
        if (!callbacks.isInExcludedRegion(semiAbsPos, excludedRegions)) {
          terminated = true;
          break;
        }
      }
    }
    lastUnterminatedWait = !terminated;
  }
  return lastUnterminatedWait;
}
