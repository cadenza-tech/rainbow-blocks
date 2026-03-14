import * as assert from 'node:assert';
import { BaseBlockParser } from '../../parsers/baseParser';
import type { ExcludedRegion, LanguageKeywords } from '../../types';
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
      // U+1F600 Grinning Face is not a letter (\p{L} returns false)
      // Surrogate pair before keyword should not prevent match
      const source = 'if\n\uD83D\uDE00end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
});
