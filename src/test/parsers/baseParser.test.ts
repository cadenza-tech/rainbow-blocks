import * as assert from 'node:assert';
import { BaseBlockParser } from '../../parsers/baseParser';
import type { ExcludedRegion, LanguageKeywords } from '../../types';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
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
});
