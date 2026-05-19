// Abstract base class for block parsers using a 2-pass algorithm

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token, TokenType } from '../types';

// Fenwick tree (binary indexed tree) for prefix-sum queries. 1-indexed: a tree
// of `size` covers ranks 1..size. recalculateNestLevels uses it to count, in
// O(log n), how many already-swept pairs have a close offset in a given range
class FenwickTree {
  private readonly tree: number[];

  constructor(size: number) {
    this.tree = new Array<number>(size + 1).fill(0);
  }

  // Adds `delta` at 1-indexed position `index`
  add(index: number, delta: number): void {
    for (let i = index; i < this.tree.length; i += i & -i) {
      this.tree[i] += delta;
    }
  }

  // Returns the sum of values at 1-indexed positions 1..index (0 when index < 1)
  prefixSum(index: number): number {
    let sum = 0;
    for (let i = index; i > 0; i -= i & -i) {
      sum += this.tree[i];
    }
    return sum;
  }
}

// Counts how many elements of the ascending-sorted array are strictly less than
// `value` (lower-bound binary search)
function countLessThan(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] < value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export abstract class BaseBlockParser {
  protected abstract readonly keywords: LanguageKeywords;

  // Close/middle keyword sets, memoized lazily on the first getTokenType call.
  // keywords is readonly and fixed per parser instance, so these never go stale
  private tokenTypeSets: { close: Set<string>; middle: Set<string> } | null = null;

  // Parses source code and returns matched block pairs
  parse(source: string): BlockPair[] {
    const excludedRegions = this.findExcludedRegions(source);
    const tokens = this.tokenize(source, excludedRegions);
    const pairs = this.matchBlocks(tokens);
    this.recalculateNestLevels(pairs);
    return pairs;
  }

  // Recalculates nest levels from actual matched-pair containment, fixing levels
  // skewed by unmatched block openers left on the stack. For each pair the nest
  // level is the count of OTHER pairs that strictly enclose it.
  //
  // The naive definition is a doubly-nested loop over pairs (O(P^2)); this gives
  // the identical result in O(P log P) as `countRaw - disqualified`:
  //   countRaw     = #{ other : other.open < pair.open && other.close >= pair.close }
  //   disqualified = #{ other : other.close === pair.close, other has intermediates,
  //                             other's last intermediate is a block_middle, and that
  //                             intermediate starts before pair.open }
  // `disqualified` is the tie-break: a pair opening after another pair's trailing
  // block_middle section (e.g. VHDL elsif) is a SIBLING, not a child. A trailing
  // block_open intermediate (e.g. a Verilog `if` merged into an `else`) does NOT
  // disqualify. Every token of other.intermediates starts after other.open — true
  // even for the merge-injected tokens in the Verilog/Ada matchBlocks overrides —
  // so `lastIntermediate.startOffset < pair.open` implies `other.open < pair.open`,
  // which is why disqualified collapses to a 1-D count and a pair never
  // disqualifies itself
  private recalculateNestLevels(pairs: BlockPair[]): void {
    const rawCounts = this.computeRawContainmentCounts(pairs);
    const disqualifiedCounts = this.computeDisqualifiedCounts(pairs);
    for (let i = 0; i < pairs.length; i++) {
      pairs[i].nestLevel = rawCounts[i] - disqualifiedCounts[i];
    }
  }

  // For every pair, counts the OTHER pairs with a strictly smaller open offset
  // and a close offset at or beyond this pair's close offset. A 2-D dominance
  // count: sweep pairs by ascending open offset and, for each, query a Fenwick
  // tree keyed by coordinate-compressed close offset. Pairs sharing an open
  // offset are queried as a run before any of them is inserted, so they never
  // count one another (the containment test is a strict `<` on open)
  private computeRawContainmentCounts(pairs: BlockPair[]): number[] {
    const counts = new Array<number>(pairs.length).fill(0);

    // Coordinate-compress close offsets into 1-based ranks
    const sortedCloses = [...new Set(pairs.map((p) => p.closeKeyword.startOffset))].sort((a, b) => a - b);
    const rankByClose = new Map<number, number>();
    for (let r = 0; r < sortedCloses.length; r++) {
      rankByClose.set(sortedCloses[r], r + 1);
    }

    // Pair indices ordered by ascending open offset (the input array is not reordered)
    const order = [...pairs.keys()].sort((a, b) => pairs[a].openKeyword.startOffset - pairs[b].openKeyword.startOffset);

    const fenwick = new FenwickTree(sortedCloses.length);
    let insertedCount = 0;
    let runStart = 0;
    while (runStart < order.length) {
      const runOpen = pairs[order[runStart]].openKeyword.startOffset;
      let runEnd = runStart;
      while (runEnd < order.length && pairs[order[runEnd]].openKeyword.startOffset === runOpen) {
        runEnd++;
      }
      // Query the whole run against pairs already inserted (strictly smaller open)
      for (let k = runStart; k < runEnd; k++) {
        const idx = order[k];
        // rankByClose has every pair's close offset, so the lookup is always defined
        const closeRank = rankByClose.get(pairs[idx].closeKeyword.startOffset) as number;
        // #{ inserted, close >= pair.close } = insertedCount - #{ inserted, close < pair.close }
        counts[idx] = insertedCount - fenwick.prefixSum(closeRank - 1);
      }
      // Then insert the whole run
      for (let k = runStart; k < runEnd; k++) {
        const closeRank = rankByClose.get(pairs[order[k]].closeKeyword.startOffset) as number;
        fenwick.add(closeRank, 1);
        insertedCount++;
      }
      runStart = runEnd;
    }
    return counts;
  }

  // For every pair, counts the tie-break exclusions: OTHER pairs sharing its
  // close offset whose last intermediate is a block_middle starting before this
  // pair's open offset. Pairs are grouped by close offset; within each group the
  // qualifying last-intermediate offsets are sorted once and binary-searched. A
  // pair never counts itself — its own last intermediate starts after its open
  private computeDisqualifiedCounts(pairs: BlockPair[]): number[] {
    const counts = new Array<number>(pairs.length).fill(0);

    // Group pair indices by shared close offset
    const groupsByClose = new Map<number, number[]>();
    for (let i = 0; i < pairs.length; i++) {
      const closeOffset = pairs[i].closeKeyword.startOffset;
      const group = groupsByClose.get(closeOffset);
      if (group) {
        group.push(i);
      } else {
        groupsByClose.set(closeOffset, [i]);
      }
    }

    for (const group of groupsByClose.values()) {
      // Last-intermediate start offsets of group members that qualify as tie-break
      // sources: have intermediates whose last token is a block_middle
      const qualifyingOffsets: number[] = [];
      for (const idx of group) {
        const intermediates = pairs[idx].intermediates;
        if (intermediates.length > 0) {
          const last = intermediates[intermediates.length - 1];
          if (last.type === 'block_middle') {
            qualifyingOffsets.push(last.startOffset);
          }
        }
      }
      if (qualifyingOffsets.length === 0) {
        continue;
      }
      qualifyingOffsets.sort((a, b) => a - b);
      for (const idx of group) {
        counts[idx] = countLessThan(qualifyingOffsets, pairs[idx].openKeyword.startOffset);
      }
    }
    return counts;
  }

  // Finds regions to exclude from keyword detection (comments, strings, etc)
  // Must return regions sorted by start position for binary search
  // Override findExcludedRegions for custom scanning, or override tryMatchExcludedRegion for simple dispatch
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  // Override to dispatch to string/comment matchers
  protected tryMatchExcludedRegion(_source: string, _pos: number): ExcludedRegion | null {
    return null;
  }

  // Validates if a block open keyword is valid at the given position
  // Override to handle postfix conditions, one-liners, etc
  protected isValidBlockOpen(_keyword: string, _source: string, _position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return true;
  }

  // Validates if a block close keyword is valid at the given position
  // Override to handle special cases like keyword arguments
  protected isValidBlockClose(_keyword: string, _source: string, _position: number, _excludedRegions: ExcludedRegion[]): boolean {
    return true;
  }

  // Builds the keyword-matching regex from the parser's block keywords
  // Longer keywords are sorted first so they match before their prefixes (e.g. `elsif` before `if`)
  private buildKeywordPattern(): RegExp {
    const allKeywords = [...this.keywords.blockOpen, ...this.keywords.blockClose, ...this.keywords.blockMiddle];
    const sortedKeywords = [...allKeywords].sort((a, b) => b.length - a.length);
    const escapedKeywords = sortedKeywords.map((kw) => this.escapeRegex(kw));
    return new RegExp(`\\b(${escapedKeywords.join('|')})\\b`, 'g');
  }

  // Tokenizes source code to find block keywords
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    const tokens: Token[] = [];
    const keywordPattern = this.buildKeywordPattern();

    // Pre-compute newline positions for O(log n) line/column lookup
    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(keywordPattern)) {
      const startOffset = match.index;

      // Skip keywords in excluded regions
      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      const keyword = match[1];

      // JavaScript \b only handles ASCII word boundaries, so check for adjacent Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }
      const type = this.getTokenType(keyword);

      // Validate block open keywords
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block close keywords
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset: startOffset + keyword.length,
        line,
        column
      });
    }

    return tokens;
  }

  // Matches blocks using a stack-based algorithm
  // Override for special cases like Lua's repeat-until or Bash's fi/esac/done
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          const openBlock = stack.pop();
          if (openBlock) {
            pairs.push({
              openKeyword: openBlock.token,
              closeKeyword: token,
              intermediates: openBlock.intermediates,
              nestLevel: stack.length
            });
          }
          break;
        }
      }
    }

    return pairs;
  }

  // Checks if a position is within an excluded region using binary search
  // See also standalone isInExcludedRegion in parserUtils.ts for use outside class context
  protected isInExcludedRegion(pos: number, regions: ExcludedRegion[]): boolean {
    return this.findExcludedRegionAt(pos, regions) !== null;
  }

  // Finds the excluded region containing the given position using binary search
  protected findExcludedRegionAt(pos: number, regions: ExcludedRegion[]): ExcludedRegion | null {
    let left = 0;
    let right = regions.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const region = regions[mid];

      if (pos >= region.start && pos < region.end) {
        return region;
      }
      if (pos < region.start) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return null;
  }

  // Returns the token type for a keyword. The close/middle keyword sets are
  // memoized on first use so classification is O(1) instead of O(K) per keyword
  protected getTokenType(keyword: string): TokenType {
    let sets = this.tokenTypeSets;
    if (sets === null) {
      sets = {
        close: new Set(this.keywords.blockClose),
        middle: new Set(this.keywords.blockMiddle)
      };
      this.tokenTypeSets = sets;
    }
    if (sets.close.has(keyword)) {
      return 'block_close';
    }
    if (sets.middle.has(keyword)) {
      return 'block_middle';
    }
    return 'block_open';
  }

  // Calculates line and column for a position using binary search
  protected getLineAndColumn(offset: number, newlinePositions: number[]): { line: number; column: number } {
    let left = 0;
    let right = newlinePositions.length - 1;
    let line = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (newlinePositions[mid] < offset) {
        line = mid + 1;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // Column is the distance from the previous newline
    const lastNewline = line > 0 ? newlinePositions[line - 1] : -1;
    return {
      line,
      column: offset - lastNewline - 1
    };
  }

  // Builds an array of newline positions for efficient line/column lookup
  protected buildNewlinePositions(source: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') {
        positions.push(i);
      } else if (source[i] === '\r' && (i + 1 >= source.length || source[i + 1] !== '\n')) {
        // CR-only line ending (not part of CRLF)
        positions.push(i);
      }
    }
    return positions;
  }

  // Matches a quoted string with escape sequence handling
  protected matchQuotedString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Matches a single-line comment (from position to end of line)
  protected matchSingleLineComment(source: string, pos: number): ExcludedRegion {
    let end = pos;
    while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
      end++;
    }
    return { start: pos, end };
  }

  // Checks if a position is at the start of a line
  protected isAtLineStart(source: string, pos: number): boolean {
    return pos === 0 || source[pos - 1] === '\n' || source[pos - 1] === '\r';
  }

  // Checks if a keyword match is adjacent to a non-ASCII Unicode identifier-continuation character
  // JavaScript \b treats non-ASCII identifier characters as non-word characters, causing false matches like `αend`
  // Recognizes Letter (L), Mark (M), Number (N), and Connector Punctuation (Pc) as identifier continuation
  // Handles surrogate pairs for characters outside the BMP (codepoints > U+FFFF)
  protected isAdjacentToUnicodeLetter(source: string, startOffset: number, keywordLength: number): boolean {
    if (startOffset > 0) {
      const before = source[startOffset - 1];
      if (!/\w/.test(before)) {
        // Handle surrogate pairs: low surrogate preceded by high surrogate
        if (startOffset >= 2 && before >= '\uDC00' && before <= '\uDFFF') {
          const cp = source.codePointAt(startOffset - 2);
          if (cp !== undefined && cp > 0xffff && /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(String.fromCodePoint(cp))) return true;
        } else if (/[\p{L}\p{M}\p{N}\p{Pc}]/u.test(before)) {
          return true;
        }
      }
    }
    const afterPos = startOffset + keywordLength;
    if (afterPos < source.length) {
      const after = source[afterPos];
      if (!/\w/.test(after)) {
        // Handle surrogate pairs: high surrogate followed by low surrogate
        if (afterPos + 1 < source.length && after >= '\uD800' && after <= '\uDBFF') {
          const cp = source.codePointAt(afterPos);
          if (cp !== undefined && cp > 0xffff && /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(String.fromCodePoint(cp))) return true;
        } else if (/[\p{L}\p{M}\p{N}\p{Pc}]/u.test(after)) {
          return true;
        }
      }
    }
    return false;
  }

  // Escapes regex metacharacters in a string
  protected escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Returns all tokens for testing purposes

  getTokens(source: string): Token[] {
    const excludedRegions = this.findExcludedRegions(source);
    return this.tokenize(source, excludedRegions);
  }

  // Returns excluded regions for testing purposes
  getExcludedRegions(source: string): ExcludedRegion[] {
    return this.findExcludedRegions(source);
  }
}
