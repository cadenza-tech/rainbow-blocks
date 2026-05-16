// Lua block parser: handles repeat-until, long strings [[ ]], and multi-line comments --[[ ]]

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';

// Valid Lua numeric prefix that can legitimately be followed by a trailing `.`
// (i.e., the integer part of a float). Decimal: `[0-9]+`. Hex: `0[xX][0-9a-fA-F]+`.
// Strings like `1A`, `1e5`, or `0xZ` do NOT match, so a trailing `.` after them
// must be field access, not a numeric trailing dot.
const LUA_NUMBER_TRAILING_DOT_PREFIX = /^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/;

export class LuaBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'while', 'for', 'repeat', 'function', 'do'],
    blockClose: ['end', 'until'],
    blockMiddle: ['then', 'else', 'elseif']
  };

  // Cache of filtered for/while positions for the most recently parsed source.
  // isDoPartOfLoop is called once per `do` keyword; without caching, each call
  // rebuilds the full prefix loop-position list, yielding O(N^2) total work.
  // Cache is keyed by source string identity (parse() recomputes per source).
  private loopPositionCache: { source: string; positions: number[]; lengths: number[] } | null = null;

  // Cache of the per-source classification of every `do` keyword as a loop `do`
  // (true) or a standalone `do` block opener (false). Built in a single O(N)
  // pass; without it, isDoPartOfLoop re-scanned the prefix per `do`, making a
  // file mixing loops with standalone `do` blocks O(N^2)-O(N^3) and able to
  // hang. Keyed by source string identity (parse() recomputes per source).
  private doClassificationCache: { source: string; classification: Map<number, boolean> } | null = null;

  // Validates block open keywords, excluding do that's part of while/for loop
  // Also rejects keywords preceded by '.' or ':' (table field/method access like t.end, obj:repeat)
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByDotOrColon(source, position, excludedRegions)) {
      return false;
    }

    if (keyword !== 'do') {
      return true;
    }

    return !this.isDoPartOfLoop(source, position, excludedRegions);
  }

  // Validates block close: rejects keywords preceded by '.' or ':'
  protected isValidBlockClose(_keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    return !this.isPrecededByDotOrColon(source, position, excludedRegions);
  }

  // Checks if keyword is preceded by '.' or ':' (table field/method access)
  // But not '..' (concatenation) or '::' (goto label syntax)
  // Skips only whitespace (including newlines) between operator and keyword.
  // Excluded regions (strings, long strings, comments, goto labels, shebang)
  // act as opaque walls: a `.` or `:` on the far side of an excluded region
  // is NOT field/method access on the keyword that follows the region, so we
  // stop the walk-back at the region boundary and return false.
  private isPrecededByDotOrColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r' || source[i] === '\f' || source[i] === '\v') {
        i--;
        continue;
      }
      if (this.isInExcludedRegion(i, excludedRegions)) {
        // Excluded region is an opaque wall: do not look through it.
        return false;
      }
      break;
    }
    if (i < 0) return false;
    if (source[i] === '.') {
      // .. is string concatenation operator, not field access
      if (i >= 1 && source[i - 1] === '.') return false;
      // Trailing dot after a number literal (decimal or hex) is not field access.
      // We walk back through identifier-like characters AND `.` to capture the
      // full numeric context, then validate it as a Lua number prefix. The
      // validation regex disallows `.` in the swept range, so numbers that
      // already contain a decimal point (e.g., `3.14.end`, `1.5e2.end`) are
      // rejected because adding another `.` would be invalid Lua syntax.
      if (i >= 1 && /[0-9a-fA-F]/.test(source[i - 1])) {
        let k = i - 1;
        while (k > 0 && /[a-zA-Z0-9_.]/.test(source[k - 1])) {
          k--;
        }
        if (LUA_NUMBER_TRAILING_DOT_PREFIX.test(source.slice(k, i))) {
          // Numeric literal — could be decimal (1.) or hex (0x1A.).
          return false;
        }
      }
      return true;
    }
    if (source[i] === ':') {
      // :: is goto label closing, not method call
      return !(i >= 1 && source[i - 1] === ':');
    }
    return false;
  }

  // Builds (and caches) the filtered for/while position list for the source.
  // All filters that depend solely on (source, excludedRegions) are applied
  // once here, so isDoPartOfLoop only has to binary-search this list.
  private getLoopPositions(source: string, excludedRegions: ExcludedRegion[]): { positions: number[]; lengths: number[] } {
    if (this.loopPositionCache !== null && this.loopPositionCache.source === source) {
      return this.loopPositionCache;
    }
    const loopPattern = /\b(while|for)\b/g;
    const positions: number[] = [];
    const lengths: number[] = [];
    for (const match of source.matchAll(loopPattern)) {
      const pos = match.index;
      if (this.isInExcludedRegion(pos, excludedRegions)) continue;
      if (this.isAdjacentToUnicodeLetter(source, pos, match[0].length)) continue;
      if (this.isPrecededByDotOrColon(source, pos, excludedRegions)) continue;
      if (this.isAfterGoto(source, pos, excludedRegions)) continue;
      positions.push(pos);
      lengths.push(match[0].length);
    }
    this.loopPositionCache = { source, positions, lengths };
    return this.loopPositionCache;
  }

  // Builds (and caches) the classification of every `do` keyword in the source
  // as either a loop `do` (the `do` that opens a for/while body) or a
  // standalone `do` block opener.
  //
  // Performance: a single left-to-right pass over the pre-computed block
  // keyword list assigns every `do` at once, using a block-opener stack. This
  // is O(N) for a file of N keywords. The former approach re-scanned the
  // prefix for each `do` (slicing the source and running matchAll), which made
  // a file mixing loops with standalone `do` blocks O(N^2)-O(N^3) and could
  // hang. isDoPartOfLoop now just looks up this cached map in O(1).
  //
  // Stack-pairing rules mirror matchBlocks: `end` closes the topmost non-repeat
  // block, `until` closes the topmost `repeat`. A `do` is a loop `do` exactly
  // when the topmost stack entry is a for/while still awaiting its `do`.
  private getDoClassification(source: string, excludedRegions: ExcludedRegion[]): Map<number, boolean> {
    if (this.doClassificationCache !== null && this.doClassificationCache.source === source) {
      return this.doClassificationCache.classification;
    }

    const blockPattern = /\b(do|for|while|function|if|repeat|end|until)\b/g;
    const classification = new Map<number, boolean>();
    // Stack entries: kind plus, for loops, whether their `do` was seen yet.
    const stack: { kind: 'loop' | 'function' | 'if' | 'repeat'; hasDo: boolean }[] = [];

    for (const match of source.matchAll(blockPattern)) {
      const pos = match.index;
      if (this.isInExcludedRegion(pos, excludedRegions)) continue;
      if (this.isAdjacentToUnicodeLetter(source, pos, match[0].length)) continue;
      if (this.isPrecededByDotOrColon(source, pos, excludedRegions)) continue;
      if (this.isAfterGoto(source, pos, excludedRegions)) continue;

      const word = match[1];
      if (word === 'for' || word === 'while') {
        stack.push({ kind: 'loop', hasDo: false });
      } else if (word === 'function' || word === 'if' || word === 'repeat') {
        stack.push({ kind: word, hasDo: false });
      } else if (word === 'do') {
        const top = stack.length > 0 ? stack[stack.length - 1] : null;
        if (top !== null && top.kind === 'loop' && !top.hasDo) {
          // Closes the open for/while header: this `do` belongs to the loop.
          top.hasDo = true;
          classification.set(pos, true);
        } else {
          // No loop awaiting a `do`: this is a standalone do...end block.
          stack.push({ kind: 'loop', hasDo: true });
          classification.set(pos, false);
        }
      } else if (word === 'end') {
        // `end` closes the topmost block that is not a `repeat`
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind !== 'repeat') {
            stack.splice(i, 1);
            break;
          }
        }
      } else if (word === 'until') {
        // `until` closes the topmost `repeat`
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].kind === 'repeat') {
            stack.splice(i, 1);
            break;
          }
        }
      }
    }

    this.doClassificationCache = { source, classification };
    return classification;
  }

  // Checks if do at position is part of a while/for loop (not standalone).
  // Delegates to a per-source O(N) classification map (see getDoClassification),
  // so each call is an O(1) lookup. getLoopPositions is still invoked to keep
  // the loopPositionCache populated for callers/tests that rely on it.
  private isDoPartOfLoop(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Keep the loop-position cache populated (used elsewhere and pinned by tests)
    this.getLoopPositions(source, excludedRegions);
    return this.getDoClassification(source, excludedRegions).get(position) === true;
  }

  // Filters out middle keywords preceded by '.' or ':' (table field/method access)
  // Also filters out reserved keywords used as goto labels (`goto end`, `goto do`, etc.)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens = super.tokenize(source, excludedRegions);
    return tokens.filter((token) => {
      if (token.type === 'block_middle' && this.isPrecededByDotOrColon(source, token.startOffset, excludedRegions)) {
        return false;
      }
      // Reject keywords used as the target of `goto <label>`
      if (this.isAfterGoto(source, token.startOffset, excludedRegions)) {
        return false;
      }
      return true;
    });
  }

  // Detects whether the keyword at position is the target of a `goto` statement.
  // Lua spec allows whitespace (including newlines) between `goto` and its label name.
  // Excluded regions (strings, long strings, comments, goto labels, shebang)
  // act as opaque walls: `goto` text on the far side of an excluded region does
  // NOT bind the keyword that follows the region, so we stop the walk-back at
  // the region boundary and return false.
  private isAfterGoto(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        // Excluded region is an opaque wall: do not look through it.
        return false;
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
        i--;
        continue;
      }
      break;
    }
    if (i < 3) return false;
    // Verify the four characters at [i-3..i] are 'goto' and none lie in excluded regions
    for (let j = i - 3; j <= i; j++) {
      if (this.isInExcludedRegion(j, excludedRegions)) return false;
    }
    if (source.slice(i - 3, i + 1) !== 'goto') return false;
    if (i - 3 > 0 && /[a-zA-Z0-9_]/.test(source[i - 4])) return false;
    if (this.isAdjacentToUnicodeLetter(source, i - 3, 4)) return false;
    // `obj.goto` / `obj:goto` is a field access / method call, not the goto keyword
    if (i - 3 > 0) {
      const before = source[i - 4];
      if (before === '.' || before === ':') {
        // Reject only single dot/colon, not `..` (concat) or `::` (label)
        if (i - 4 === 0 || source[i - 5] !== before) {
          return false;
        }
      }
    }
    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Shebang line (at file start or directly after a UTF-8/UTF-16 BOM, e.g.,
    // `#!/usr/bin/env lua`). Lua 5.3+ accepts a leading BOM (U+FEFF) before the shebang.
    if (char === '#' && pos + 1 < source.length && source[pos + 1] === '!') {
      const isFileStart = pos === 0 || (pos === 1 && source[0] === '﻿');
      if (isFileStart) {
        let end = pos;
        while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
          end++;
        }
        return { start: pos, end };
      }
    }

    // Comment (-- single line or --[[ multi-line)
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchComment(source, pos);
    }

    // Goto label ::identifier::
    if (char === ':' && pos + 1 < source.length && source[pos + 1] === ':') {
      const region = this.matchGotoLabel(source, pos);
      if (region) return region;
    }

    // Long string [[ ]] or [=[ ]=]
    if (char === '[') {
      const region = this.matchLongString(source, pos);
      if (region) return region;
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted string
    if (char === "'") {
      return this.matchQuotedString(source, pos, "'");
    }

    return null;
  }

  // Matches comment (single-line -- or multi-line --[[ ]])
  private matchComment(source: string, pos: number): ExcludedRegion {
    // Check for multi-line comment --[[ or --[=[ etc
    if (pos + 2 < source.length && source[pos + 2] === '[') {
      const longStringRegion = this.matchLongString(source, pos + 2);
      if (longStringRegion) {
        return { start: pos, end: longStringRegion.end };
      }
    }

    // Single-line comment
    return this.matchSingleLineComment(source, pos);
  }

  // Matches long string [[ ]] or [=[ ]=] with varying equal signs
  private matchLongString(source: string, pos: number): ExcludedRegion | null {
    if (source[pos] !== '[') {
      return null;
    }

    // Count equal signs
    let equalCount = 0;
    let i = pos + 1;
    while (i < source.length && source[i] === '=') {
      equalCount++;
      i++;
    }

    // Check bounds and opening bracket
    if (i >= source.length || source[i] !== '[') {
      return null;
    }

    // Build closing pattern
    const closePattern = `]${'='.repeat(equalCount)}]`;

    // Find closing pattern
    i++;
    while (i < source.length) {
      if (source.slice(i, i + closePattern.length) === closePattern) {
        return { start: pos, end: i + closePattern.length };
      }
      i++;
    }

    // Unterminated long string
    return { start: pos, end: source.length };
  }

  // Matches blocks with special handling: until only closes repeat, end closes others
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle': {
          // then/else/elseif are if-block section boundaries; a `repeat` block
          // cannot own them. If a repeat is open on top of the stack, route the
          // middle keyword to the topmost non-repeat opener instead, mirroring
          // how `end` skips `repeat` to close the block below it.
          const middleIndex = findLastNonRepeatIndex(stack);
          if (middleIndex >= 0) {
            stack[middleIndex].intermediates.push(token);
          }
          break;
        }

        case 'block_close': {
          // until only closes repeat
          if (token.value === 'until') {
            const repeatIndex = findLastOpenerByType(stack, 'repeat');
            if (repeatIndex >= 0) {
              const openBlock = stack.splice(repeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          } else {
            // end closes any block except repeat
            const nonRepeatIndex = findLastNonRepeatIndex(stack);
            if (nonRepeatIndex >= 0) {
              const openBlock = stack.splice(nonRepeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Matches Lua regular strings, stopping at unescaped newlines
  // Lua regular strings cannot span multiple lines (syntax error),
  // but \z (skip whitespace including newlines) and \<newline> (line
  // continuation) are supported in Lua 5.2+
  protected matchQuotedString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        const next = source[i + 1];
        // \z skips following whitespace including newlines
        if (next === 'z') {
          i += 2;
          while (
            i < source.length &&
            (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r' || source[i] === '\v' || source[i] === '\f')
          ) {
            i++;
          }
          continue;
        }
        // \<newline> is a line continuation
        if (next === '\n') {
          i += 2;
          continue;
        }
        if (next === '\r') {
          i += 2;
          // \r\n counts as single newline continuation
          if (i < source.length && source[i] === '\n') {
            i++;
          }
          continue;
        }
        // Any other escape sequence
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      // Unescaped newline terminates the string (unterminated)
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches goto label ::identifier:: allowing newlines in whitespace
  private matchGotoLabel(source: string, pos: number): ExcludedRegion | null {
    let i = pos + 2;
    // Skip whitespace (including newlines) after ::
    while (
      i < source.length &&
      (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r' || source[i] === '\f' || source[i] === '\v')
    ) {
      i++;
    }
    // Match identifier
    if (i >= source.length || !/[a-zA-Z_]/.test(source[i])) {
      return null;
    }
    while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) {
      i++;
    }
    // Skip whitespace (including newlines) before closing ::
    while (
      i < source.length &&
      (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r' || source[i] === '\f' || source[i] === '\v')
    ) {
      i++;
    }
    // Check closing ::
    if (i + 1 < source.length && source[i] === ':' && source[i + 1] === ':') {
      return { start: pos, end: i + 2 };
    }
    return null;
  }
}
