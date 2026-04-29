// Bash block validation helpers for isAtCommandPosition and isCasePattern checks

import type { ExcludedRegion } from '../types';
import { findLineStart } from './parserUtils';

// Callbacks for base parser methods needed by validation functions
export interface BashValidationCallbacks {
  isInExcludedRegion: (pos: number, regions: ExcludedRegion[]) => boolean;
  findExcludedRegionAt: (pos: number, regions: ExcludedRegion[]) => ExcludedRegion | null;
}

// Check if a keyword is at shell command position (start of a simple command)
export function isAtCommandPosition(
  source: string,
  position: number,
  excludedRegions: ExcludedRegion[],
  callbacks: BashValidationCallbacks
): boolean {
  // Check if the keyword sits inside an unclosed array literal `var=(...)` / `var+=(...)`.
  // Inside array literals, keywords are values rather than block tokens.
  {
    let depth = 0;
    let scan = position - 1;
    while (scan >= 0) {
      if (callbacks.isInExcludedRegion(scan, excludedRegions)) {
        const region = callbacks.findExcludedRegionAt(scan, excludedRegions);
        if (region) {
          scan = region.start - 1;
          continue;
        }
      }
      const c = source[scan];
      if (c === ')') {
        depth++;
      } else if (c === '(') {
        if (depth === 0) {
          // Unmatched `(` — check if it opens an array literal
          if (scan > 0 && source[scan - 1] === '=') {
            let varEnd = scan - 1;
            if (varEnd > 0 && source[varEnd - 1] === '+') {
              varEnd--;
            }
            let varPos = varEnd - 1;
            while (varPos >= 0 && /[a-zA-Z0-9_]/.test(source[varPos])) {
              varPos--;
            }
            const varStart = varPos + 1;
            if (varStart < varEnd && /[a-zA-Z_]/.test(source[varStart])) {
              return false;
            }
          }
          break;
        }
        depth--;
      }
      scan--;
    }
  }

  let i = position - 1;
  // Skip whitespace (spaces, tabs, BOM U+FEFF) but not line endings
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t' || source[i] === '﻿')) {
    i--;
  }

  // Skip excluded regions when scanning backward (e.g., $(...) closing paren)
  let skippedRegion = true;
  while (skippedRegion) {
    skippedRegion = false;
    for (const region of excludedRegions) {
      if (i >= region.start && i < region.end) {
        // If excluded region ends immediately before the keyword with no newline separator, it's a concatenated word
        // (e.g., "string"keyword). But heredocs include trailing newline, so region.end === position with a newline is valid.
        if (region.end === position && (position === 0 || (source[position - 1] !== '\n' && source[position - 1] !== '\r'))) {
          return false;
        }
        i = region.start - 1;
        skippedRegion = true;
        while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
          i--;
        }
        break;
      }
    }
  }

  // Follow backslash line continuations: if line ends with \<newline>, continue scanning the previous line
  while (i >= 0 && (source[i] === '\n' || source[i] === '\r')) {
    // Check for \<newline> continuation
    let beforeNewline = i - 1;
    if (source[i] === '\n' && beforeNewline >= 0 && source[beforeNewline] === '\r') {
      beforeNewline--;
    }
    if (beforeNewline >= 0 && source[beforeNewline] === '\\') {
      // Count consecutive backslashes before newline
      let bsCount = 0;
      let bsPos = beforeNewline;
      while (bsPos >= 0 && source[bsPos] === '\\') {
        bsCount++;
        bsPos--;
      }
      // Even number of backslashes means they are all escaped (not continuation)
      if (bsCount % 2 === 0) {
        return true;
      }
      // Backslash continuation: skip \ and continue scanning the previous line
      i = beforeNewline - 1;
      while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
        i--;
      }
      // Skip excluded regions again after crossing line continuation
      let skippedExcludedAfterCont = false;
      let skippedAgain = true;
      while (skippedAgain) {
        skippedAgain = false;
        for (const region of excludedRegions) {
          if (i >= region.start && i < region.end) {
            i = region.start - 1;
            skippedAgain = true;
            skippedExcludedAfterCont = true;
            while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
              i--;
            }
            break;
          }
        }
      }
      // If we reached start of file after skipping excluded regions,
      // the continuation follows actual code -> not command position
      if (i < 0 && skippedExcludedAfterCont) {
        return false;
      }
    } else {
      // Normal line ending (not a continuation) -> keyword is at command position
      return true;
    }
  }

  // At start of file: always command position (even after line continuation)
  if (i < 0) {
    return true;
  }

  // After command separators: ; | & ( )
  // Note: `(` may also start an array literal `arr=(...)` or `arr+=(...)` — treat that as not command position
  if (';|&)'.includes(source[i])) {
    return true;
  }
  if (source[i] === '(') {
    // Detect array literal opener: `var=(` or `var+=(` with no whitespace between `=` and `(`
    if (i > 0 && source[i - 1] === '=') {
      let varEnd = i - 1;
      if (varEnd > 0 && source[varEnd - 1] === '+') {
        varEnd--;
      }
      let varPos = varEnd - 1;
      while (varPos >= 0 && /[a-zA-Z0-9_]/.test(source[varPos])) {
        varPos--;
      }
      const varStart = varPos + 1;
      if (varStart < varEnd && /[a-zA-Z_]/.test(source[varStart])) {
        return false;
      }
    }
    return true;
  }

  // After { only when it stands alone as a reserved word (not part of brace expansion like {for})
  // { is a reserved word when preceded by whitespace, line start, or command separator
  if (source[i] === '{') {
    let k = i - 1;
    while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
      k--;
    }
    // Skip excluded regions when scanning backward from {
    let skippedExcl = true;
    while (skippedExcl) {
      skippedExcl = false;
      for (const region of excludedRegions) {
        if (k >= region.start && k < region.end) {
          k = region.start - 1;
          skippedExcl = true;
          while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
            k--;
          }
          break;
        }
      }
    }
    if (k < 0 || source[k] === '\n' || source[k] === '\r' || ';|&(){}`'.includes(source[k])) {
      return true;
    }
    // Check if { is preceded by a command starter keyword or block close keyword
    const braceContextKws = ['then', 'do', 'else', 'elif', 'time', 'coproc', 'fi', 'done', 'esac'];
    for (const kw of braceContextKws) {
      const kwStart = k - kw.length + 1;
      if (kwStart >= 0 && source.slice(kwStart, k + 1) === kw) {
        if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
          let p = kwStart - 1;
          while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
          if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
            return true;
          }
        }
      }
    }
    return false;
  }

  // After backtick (end of command substitution)
  if (source[i] === '`') {
    return true;
  }

  // After ! (pipeline negation, POSIX)
  if (source[i] === '!') {
    return true;
  }

  // After `}` (end of command group) -- allows `} && if ...` or `} || for ...`
  // Only if } is a command group closer (preceded by ; or newline), not brace expansion ({a,b})
  if (source[i] === '}') {
    let b = i - 1;
    while (b >= 0 && (source[b] === ' ' || source[b] === '\t')) {
      b--;
    }
    if (b < 0 || source[b] === ';' || source[b] === '\n' || source[b] === '\r' || source[b] === '&') {
      return true;
    }
  }

  // After shell keywords that introduce a new command context
  // The keyword itself must be at a valid position (not a command argument like "echo then")
  const commandStarters = ['then', 'do', 'else', 'elif', 'time', 'coproc'];
  for (const kw of commandStarters) {
    const kwStart = i - kw.length + 1;
    if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
      if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
        let p = kwStart - 1;
        while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
        if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
          return true;
        }
      }
    }
  }

  // After block close keywords followed by control operators (&&, ||)
  const blockCloseKws = ['fi', 'done', 'esac'];
  for (const kw of blockCloseKws) {
    const kwStart = i - kw.length + 1;
    if (kwStart >= 0 && source.slice(kwStart, i + 1) === kw) {
      if (kwStart === 0 || !/[a-zA-Z0-9_]/.test(source[kwStart - 1])) {
        let p = kwStart - 1;
        while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
        if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
          return true;
        }
      }
    }
  }

  // time command with flags: time -p cmd, time -- cmd, time -p -- cmd
  if (i >= 0 && source[i] !== '\n' && source[i] !== '\r') {
    let ts = i;
    const beforeFlags = ts;
    // Skip backward past -p and -- flags
    while (ts >= 0) {
      const flag = source.slice(Math.max(0, ts - 1), ts + 1);
      if (flag === '-p' || flag === '--') {
        ts -= 2;
        while (ts >= 0 && (source[ts] === ' ' || source[ts] === '\t')) ts--;
        continue;
      }
      break;
    }
    // Verify whitespace between time and first flag when flags were consumed
    if (ts !== beforeFlags && (ts < 0 || (source[ts + 1] !== ' ' && source[ts + 1] !== '\t'))) {
      ts = -1;
    }
    if (ts >= 3 && source.slice(ts - 3, ts + 1) === 'time') {
      const tStart = ts - 3;
      if (tStart === 0 || !/[a-zA-Z0-9_]/.test(source[tStart - 1])) {
        let p = tStart - 1;
        while (p >= 0 && (source[p] === ' ' || source[p] === '\t')) p--;
        if (p < 0 || ';|&\n\r()'.includes(source[p]) || source[p] === '`' || source[p] === '{' || source[p] === '}') {
          return true;
        }
      }
    }
  }

  // Environment variable prefix: VAR=value before a command keyword
  // Handles: FOO=bar if, A=1 B=2 if, FOO="quoted" if, FOO= if
  // Requires whitespace between value and command keyword (e.g., `a=if` is `VAR=value`, not a command)
  if (i >= 0) {
    if (position > 0) {
      const charBeforeKeyword = source[position - 1];
      if (charBeforeKeyword !== ' ' && charBeforeKeyword !== '\t' && charBeforeKeyword !== '\n' && charBeforeKeyword !== '\r') {
        return false;
      }
    }
    let eqScan = i;
    if (source[eqScan] !== '=') {
      while (eqScan > 0 && source[eqScan - 1] !== '=' && /[^\s;|&(){}`]/.test(source[eqScan - 1])) {
        eqScan--;
      }
      eqScan = eqScan > 0 && source[eqScan - 1] === '=' ? eqScan - 1 : -1;
    }
    // Scan backward past consecutive '=' to find the first one (assignment operator)
    if (eqScan >= 0 && source[eqScan] === '=') {
      while (eqScan > 0 && source[eqScan - 1] === '=') {
        eqScan--;
      }
    }
    if (eqScan >= 0 && source[eqScan] === '=') {
      // Skip past += compound assignment operator
      let varEnd = eqScan;
      if (varEnd > 0 && source[varEnd - 1] === '+') {
        varEnd--;
      }
      let varPos = varEnd - 1;
      while (varPos >= 0 && /[a-zA-Z0-9_]/.test(source[varPos])) {
        varPos--;
      }
      const varStart = varPos + 1;
      if (varStart < varEnd && /[a-zA-Z_]/.test(source[varStart])) {
        return isAtCommandPosition(source, varStart, excludedRegions, callbacks);
      }
    }
  }

  return false;
}

// Check if keyword is followed by ) -> case pattern (e.g., for), done))
// But not inside subshell (...) where ) closes the subshell
export function isCasePattern(
  source: string,
  position: number,
  keyword: string,
  excludedRegions: ExcludedRegion[],
  callbacks: BashValidationCallbacks
): boolean {
  let j = position + keyword.length;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
    j++;
  }
  if (j >= source.length) return false;

  // Handle pipe-separated alternatives: if|then), for|while|until)
  // Pipe at end of line continues the pattern on the next line
  if (source[j] === '|') {
    while (j < source.length) {
      if (source[j] === ')') break;
      if (source[j] === '\n' || source[j] === '\r') {
        // Skip line ending
        if (source[j] === '\r' && j + 1 < source.length && source[j + 1] === '\n') {
          j += 2;
        } else {
          j++;
        }
        // Skip whitespace on the next line
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
          j++;
        }
        continue;
      }
      j++;
    }
    if (j >= source.length || source[j] !== ')') {
      return false;
    }
  } else if (source[j] !== ')') {
    // Check for glob characters or excluded regions (strings, substitutions) directly adjacent to keyword
    // Glob chars: if*, for?, while[abc]; Excluded regions: for"bar"), for'x'), for$(cmd)), for`cmd`)
    const isGlobChar = source[j] === '*' || source[j] === '?' || source[j] === '[';
    const hasExcludedRegion = callbacks.findExcludedRegionAt(j, excludedRegions) !== null;
    if (isGlobChar || hasExcludedRegion) {
      let bracketInGlob = 0;
      let found = false;
      while (j < source.length) {
        // Skip excluded regions (strings, command substitutions) inside the pattern
        const excludedRegion = callbacks.findExcludedRegionAt(j, excludedRegions);
        if (excludedRegion) {
          j = excludedRegion.end;
          continue;
        }
        if (source[j] === '[') bracketInGlob++;
        else if (source[j] === ']' && bracketInGlob > 0) bracketInGlob--;
        else if (bracketInGlob === 0 && (source[j] === ')' || source[j] === '|')) {
          found = true;
          break;
        } else if (source[j] === '\n' || source[j] === '\r' || source[j] === ';') {
          break;
        }
        j++;
      }
      if (!found) return false;
    } else {
      return false;
    }
  }

  // Check if inside unmatched parentheses (subshell or POSIX case pattern)
  let parenDepth = 0;
  for (let k = position - 1; k >= 0; k--) {
    if (callbacks.isInExcludedRegion(k, excludedRegions)) continue;
    if (source[k] === ')') parenDepth++;
    else if (source[k] === '(') {
      if (parenDepth === 0) {
        // Check if ( is a POSIX case pattern opening vs subshell
        // Case pattern: (pattern) has no semicolons/newlines between ( and keyword
        // Subshell: (commands; ...) has semicolons/newlines between ( and keyword
        // Only consider separators outside excluded regions (strings, comments)
        let hasUnexcludedSeparator = false;
        for (let m = k + 1; m < position; m++) {
          if (source[m] === ';' || source[m] === '\n' || source[m] === '\r') {
            if (!callbacks.isInExcludedRegion(m, excludedRegions)) {
              hasUnexcludedSeparator = true;
              break;
            }
          }
        }
        if (hasUnexcludedSeparator) {
          return false;
        }
        const lineStart = findLineStart(source, k);
        const textBefore = source.slice(lineStart, k);
        if (/^[ \t]*$/.test(textBefore) || /;;[ \t]*$|;&[ \t]*$|;;&[ \t]*$/.test(textBefore) || /\bin[ \t]*$/.test(textBefore)) {
          return true;
        }
        return false;
      }
      parenDepth--;
    }
  }

  // Check if keyword is preceded by `(` on the same line (POSIX case pattern)
  // e.g., `(for)` in a case statement
  let k = position - 1;
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) {
    k--;
  }
  if (k >= 0 && source[k] === '(') {
    const lineStart = findLineStart(source, k);
    const textBefore = source.slice(lineStart, k);
    if (/^[ \t]*$/.test(textBefore) || /;;[ \t]*$|;&[ \t]*$|;;&[ \t]*$/.test(textBefore) || /\bin[ \t]*$/.test(textBefore)) {
      return true;
    }
  }

  // esac) is almost always case-close + subshell-close, not a case pattern;
  // the backward scan below would falsely match ;; from the last case arm
  if (keyword === 'esac') {
    return false;
  }

  // Default: check if preceded by case separator (;;, ;&, ;;&) or `in` keyword
  // to distinguish case patterns from keywords followed by stray )
  let s = position - 1;
  while (s >= 0) {
    if (callbacks.isInExcludedRegion(s, excludedRegions)) {
      s--;
      continue;
    }
    if (source[s] !== ' ' && source[s] !== '\t' && source[s] !== '\n' && source[s] !== '\r') break;
    s--;
  }
  if (s >= 1 && source[s] === ';' && source[s - 1] === ';') {
    return true;
  }
  if (s >= 1 && source[s] === '&' && source[s - 1] === ';') {
    return true;
  }
  if (s >= 1 && source[s] === 'n' && source[s - 1] === 'i' && (s < 2 || !/[a-zA-Z0-9_]/.test(source[s - 2]))) {
    return true;
  }
  // After pipe (|) separator in case pattern alternatives (e.g., foo|for))
  if (s >= 0 && source[s] === '|') {
    return true;
  }
  return false;
}
