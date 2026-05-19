import * as assert from 'node:assert';
import { BaseBlockParser } from '../../parsers/baseParser';
import type { BlockPair, ExcludedRegion, LanguageKeywords, Token, TokenType } from '../../types';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  assertTokens
} from '../helpers/parserTestHelpers';

// Minimal test parser that uses the base class defaults (tests the default implementation of isValidBlockOpen)
class TestBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if', 'do'] as const,
    blockClose: ['end'] as const,
    blockMiddle: ['else'] as const
  };

  protected findExcludedRegions(_source: string): ExcludedRegion[] {
    // Simple implementation: no excluded regions
    return [];
  }
}

// Parser that uses base class findExcludedRegions (via tryMatchExcludedRegion default)
class DefaultExcludedRegionsParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if'] as const,
    blockClose: ['end'] as const,
    blockMiddle: [] as const
  };
}

// Builds a synthetic token; recalculateNestLevels only reads startOffset, plus
// type for intermediates, so the remaining fields get simple placeholder values
function mkToken(type: TokenType, value: string, startOffset: number): Token {
  return { type, value, startOffset, endOffset: startOffset + value.length, line: 0, column: 0 };
}

// Builds a synthetic block pair from raw open/close offsets and intermediates
function mkPair(open: number, close: number, intermediates: Token[] = []): BlockPair {
  return {
    openKeyword: mkToken('block_open', 'if', open),
    closeKeyword: mkToken('block_close', 'end', close),
    intermediates,
    nestLevel: 0
  };
}

// Reference O(P^2) nest-level computation: the doubly-nested loop that the
// O(P log P) recalculateNestLevels replaced. The fast path must reproduce it exactly
function legacyNestLevels(pairs: BlockPair[]): number[] {
  return pairs.map((pair) => {
    let level = 0;
    for (const other of pairs) {
      if (
        other !== pair &&
        other.openKeyword.startOffset < pair.openKeyword.startOffset &&
        other.closeKeyword.startOffset >= pair.closeKeyword.startOffset
      ) {
        if (
          other.closeKeyword.startOffset === pair.closeKeyword.startOffset &&
          other.intermediates.length > 0 &&
          pair.openKeyword.startOffset > other.intermediates[other.intermediates.length - 1].startOffset
        ) {
          const last = other.intermediates[other.intermediates.length - 1];
          if (last.type === 'block_middle') {
            continue;
          }
        }
        level++;
      }
    }
    return level;
  });
}

// Parser whose matchBlocks returns a caller-supplied pair list, so parse() runs the
// real recalculateNestLevels over arbitrary (including adversarial) pair structures
class FixedPairsParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if'] as const,
    blockClose: ['end'] as const,
    blockMiddle: ['else'] as const
  };
  fixedPairs: BlockPair[] = [];
  protected findExcludedRegions(_source: string): ExcludedRegion[] {
    return [];
  }
  protected matchBlocks(): BlockPair[] {
    // Fresh copies each parse so recalculateNestLevels writes into clean objects
    return this.fixedPairs.map((p) => ({ ...p, nestLevel: 0 }));
  }
}

// Parser whose blockClose and blockMiddle both list 'end', to pin getTokenType's
// close-before-middle classification priority
class OverlapKeywordParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['if'] as const,
    blockClose: ['end'] as const,
    blockMiddle: ['end', 'else'] as const
  };
  protected findExcludedRegions(_source: string): ExcludedRegion[] {
    return [];
  }
}

suite('BaseBlockParser Test Suite', () => {
  let parser: TestBlockParser;

  setup(() => {
    parser = new TestBlockParser();
  });

  suite('Default isValidBlockOpen behavior', () => {
    test('should accept all block open keywords by default', () => {
      const source = `if condition
  do_something
end`;
      const pairs = parser.parse(source);
      // Default isValidBlockOpen returns true, so if-end should be detected
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested blocks with default validation', () => {
      const source = `if outer
  do
    inner
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'if', 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should work for minimal parser', () => {
      const source = 'if x\nelse\nend';
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [
        { value: 'if', type: 'block_open' },
        { value: 'else', type: 'block_middle' },
        { value: 'end', type: 'block_close' }
      ]);
    });

    test('getExcludedRegions should return empty for minimal parser', () => {
      const source = 'if x end';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0);
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('hello world');
      assertNoBlocks(pairs);
    });

    test('should handle intermediate keywords', () => {
      const source = `if condition
  first
else
  second
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should handle CRLF line endings', () => {
      const source = 'if true\r\nelse\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should handle keyword at position 0', () => {
      const source = 'if\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });

    test('should handle keyword at EOF without trailing newline', () => {
      const source = 'if\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle deeply nested blocks (50 levels)', () => {
      const opens = Array(50).fill('if').join('\n');
      const closes = Array(50).fill('end').join('\n');
      const source = `${opens}\n${closes}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 50);
      // Innermost should have nest level 49
      const innermost = pairs.find((p) => p.nestLevel === 49);
      assert.ok(innermost, 'Should have block at nest level 49');
    });

    test('should handle only close keywords (no opens)', () => {
      const source = 'end\nend\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle only open keywords (no closes)', () => {
      const source = 'if\nif\nif';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unicode characters before keywords', () => {
      const source = 'x = "café"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle adjacent blocks with no gap', () => {
      const source = 'if\nend\nif\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'if', 0);
    });

    test('should handle keyword immediately after keyword', () => {
      const source = 'if\ndo\nend\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle whitespace-only input', () => {
      const source = '   \n\t\n   ';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle single character input', () => {
      const pairs = parser.parse('x');
      assertNoBlocks(pairs);
    });

    test('should handle keyword as entire input', () => {
      const pairs = parser.parse('if');
      assertNoBlocks(pairs);
    });

    test('should not match keyword inside identifier', () => {
      const source = 'endif\ndo_something\nif\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match keyword adjacent to Unicode letter (before)', () => {
      const source = '\u03B1end\nif\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match keyword adjacent to Unicode letter (after)', () => {
      const source = 'do\u00E9\nif\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should match keyword separated from Unicode letter by space', () => {
      const source = '\u03B1 if\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match keyword adjacent to non-BMP Unicode letter before (surrogate pair)', () => {
      // U+1D400 Mathematical Bold Capital A is a non-BMP letter (surrogate pair in UTF-16)
      // Covers isAdjacentToUnicodeLetter lines 280-281: low surrogate before keyword
      const source = '\uD835\uDC00end\nif\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match keyword adjacent to non-BMP Unicode letter after (surrogate pair)', () => {
      // U+1D400 Mathematical Bold Capital A after keyword
      // Covers isAdjacentToUnicodeLetter lines 293-294: high surrogate after keyword
      const source = 'end\uD835\uDC00\nif\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should match keyword adjacent to non-BMP non-letter (emoji surrogate pair)', () => {
      // U+1F600 Grinning Face is Symbol_Other (\p{So}), not a Ruby/Julia/Elixir identifier character
      // Surrogate pair before keyword should not prevent match
      const source = 'if\n\uD83D\uDE00end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match keyword adjacent to combining mark (Mn)', () => {
      // U+0303 Combining Tilde is a Mark Nonspacing - valid identifier continuation in Ruby/Julia/Elixir
      const source = 'if\nx\u0303end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keyword adjacent to Letter Number (Nl)', () => {
      // U+2160 Roman Numeral One is Letter Number - valid identifier character
      const source = 'if\n\u2160end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keyword adjacent to non-ASCII Decimal Number (Nd)', () => {
      // U+0669 Arabic-Indic Digit Nine is non-ASCII Decimal Number, not matched by \w
      const source = 'if\nx\u0669end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle CR-only line endings', () => {
      const source = 'if true\rdo\r  x\rend\rend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // Verify tokens have correct line numbers with \r-only
      assertTokenPosition(pairs[1].openKeyword, 0, 0); // if on line 0
      assertTokenPosition(pairs[0].openKeyword, 1, 0); // do on line 1
    });

    test('should compute correct line numbers with CR-only line endings', () => {
      const source = 'if true\rdo\rend\rend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // do on line 1, its end on line 2
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.ok(doPair);
      assert.strictEqual(doPair.openKeyword.line, 1);
      assert.strictEqual(doPair.closeKeyword.line, 2);
      // if on line 0, its end on line 3
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair);
      assert.strictEqual(ifPair.openKeyword.line, 0);
      assert.strictEqual(ifPair.closeKeyword.line, 3);
    });
  });

  suite('Default tryMatchExcludedRegion', () => {
    test('should return null for all positions (no excluded regions)', () => {
      const defaultParser = new DefaultExcludedRegionsParser();
      const source = 'if x\nend';
      const pairs = defaultParser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // recalculateNestLevels was a doubly-nested loop over pairs (O(P^2)); it is now
  // a Fenwick-based O(P log P) computation. These tests pin the rewrite: the fast
  // path must reproduce the legacy result exactly (including the block_middle
  // tie-break and merge-injected block_open intermediates), and a large pair set
  // must finish well within the debounce budget the quadratic version blew past.
  suite('Regression: recalculateNestLevels equivalence and scaling', () => {
    let fixed: FixedPairsParser;

    setup(() => {
      fixed = new FixedPairsParser();
    });

    // Runs the real recalculateNestLevels (through parse) and returns the nest levels
    function realNestLevels(pairs: BlockPair[]): number[] {
      fixed.fixedPairs = pairs;
      return fixed.parse('').map((p) => p.nestLevel);
    }

    function assertEquivalent(pairs: BlockPair[], label: string): void {
      assert.deepStrictEqual(realNestLevels(pairs), legacyNestLevels(pairs), `nest levels diverge for ${label}`);
    }

    test('should match the legacy O(P^2) result for concentric nesting', () => {
      const pairs: BlockPair[] = [];
      for (let i = 0; i < 30; i++) {
        pairs.push(mkPair(i, 100 - i));
      }
      assertEquivalent(pairs, 'concentric nesting');
    });

    test('should match the legacy result for crossing intervals', () => {
      assertEquivalent([mkPair(0, 20), mkPair(10, 30), mkPair(5, 25), mkPair(15, 40)], 'crossing intervals');
    });

    test('should match the legacy result for many pairs sharing a close offset', () => {
      const pairs: BlockPair[] = [];
      for (let i = 0; i < 40; i++) {
        pairs.push(mkPair(i, 500));
      }
      assertEquivalent(pairs, 'shared close offset');
    });

    test('should match the legacy result for trailing block_middle intermediates', () => {
      const a = mkPair(0, 100, [mkToken('block_middle', 'else', 50)]);
      const b = mkPair(60, 100);
      const c = mkPair(70, 100, [mkToken('block_middle', 'else', 80)]);
      assertEquivalent([a, b, c], 'trailing block_middle');
    });

    test('should match the legacy result for trailing block_open intermediates', () => {
      // Merge-injected shape: the last intermediate is a block_open token
      const a = mkPair(0, 100, [mkToken('block_open', 'if', 50)]);
      const b = mkPair(60, 100);
      assertEquivalent([a, b], 'trailing block_open');
    });

    test('should match the legacy result for merge-derived multi-stage intermediates', () => {
      const a = mkPair(0, 200, [mkToken('block_middle', 'else', 30), mkToken('block_open', 'if', 60), mkToken('block_middle', 'else', 90)]);
      const b = mkPair(100, 200);
      const c = mkPair(40, 200, [mkToken('block_open', 'always', 45)]);
      assertEquivalent([a, b, c], 'multi-stage intermediates');
    });

    test('should match the legacy result across randomized pair sets', () => {
      let seed = 0x1234abcd;
      const rand = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      for (let trial = 0; trial < 200; trial++) {
        const count = 1 + rand(25);
        const pairs: BlockPair[] = [];
        for (let i = 0; i < count; i++) {
          const open = rand(200);
          const close = open + 1 + rand(200);
          const intermediates: Token[] = [];
          const interCount = rand(4);
          for (let k = 0; k < interCount; k++) {
            const t = rand(2) === 0 ? 'block_middle' : 'block_open';
            intermediates.push(mkToken(t, 'x', open + 1 + rand(Math.max(1, close - open - 1))));
          }
          pairs.push(mkPair(open, close, intermediates));
        }
        assertEquivalent(pairs, `random trial ${trial}`);
      }
    });

    test('should compute nest levels for 60000 pairs well within the debounce budget', () => {
      // 60000 concentric pairs: the replaced O(P^2) loop did ~3.6e9 comparisons here
      const count = 60000;
      const pairs: BlockPair[] = [];
      for (let i = 0; i < count; i++) {
        pairs.push(mkPair(i, 2 * count - i));
      }
      fixed.fixedPairs = pairs;
      fixed.parse(''); // warm up
      const start = Date.now();
      const result = fixed.parse('');
      const elapsed = Date.now() - start;
      assert.strictEqual(result[count - 1].nestLevel, count - 1, 'innermost pair should be nested count-1 deep');
      assert.ok(elapsed < 4000, `recalculateNestLevels for ${count} pairs took ${elapsed}ms, expected < 4000ms`);
    });
  });

  // getTokenType memoizes the close/middle keyword sets on first use. These tests
  // pin the classification priority (close before middle before open) that the
  // memoized sets must preserve, including a keyword listed in both sets.
  suite('Regression: getTokenType keyword classification priority', () => {
    test('should classify a keyword in both blockClose and blockMiddle as block_close', () => {
      const overlap = new OverlapKeywordParser();
      assertTokens(overlap.getTokens('end'), [{ value: 'end', type: 'block_close' }]);
    });

    test('should classify keywords consistently across repeated tokenize passes', () => {
      const overlap = new OverlapKeywordParser();
      // The lazily memoized sets must not change results between passes
      assertTokens(overlap.getTokens('if else end'), [
        { value: 'if', type: 'block_open' },
        { value: 'else', type: 'block_middle' },
        { value: 'end', type: 'block_close' }
      ]);
      assertTokens(overlap.getTokens('end else if'), [
        { value: 'end', type: 'block_close' },
        { value: 'else', type: 'block_middle' },
        { value: 'if', type: 'block_open' }
      ]);
    });
  });
});
