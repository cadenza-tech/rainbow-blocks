// Shared test suite generators to reduce duplication across parser tests

import * as assert from 'node:assert';
import type { BaseBlockParser } from '../../parsers/baseParser';
import { assertNoBlocks, assertSingleBlock, assertTokenPosition, assertTokens } from './parserTestHelpers';

// Configuration for common test generation
export interface CommonTestConfig {
  // Parser instance (must be set in setup() before tests run)
  getParser: () => BaseBlockParser;

  // Edge cases
  noBlockSource: string;

  // Test helper methods
  tokenSource: string;
  expectedTokenValues: string[];
  excludedSource: string;
  expectedRegionCount: number;

  // Token positions
  twoLineSource: string;
  nestedPositionSource?: string;
  nestedKeyword?: string;
  nestedLine?: number;
  nestedColumn?: number;

  // Excluded regions - comments
  singleLineCommentSource: string;
  commentBlockOpen: string;
  commentBlockClose: string;

  // Excluded regions - strings (optional, not all languages have double-quoted strings)
  doubleQuotedStringSource?: string;
  stringBlockOpen?: string;
  stringBlockClose?: string;

  // Excluded regions - single-quoted strings
  singleQuotedStringSource?: string;
  singleQuotedStringBlockOpen?: string;
  singleQuotedStringBlockClose?: string;

  // Excluded regions - comment at end of line
  commentAtEndOfLineSource?: string;
  commentAtEndOfLineBlockOpen?: string;
  commentAtEndOfLineBlockClose?: string;

  // Excluded regions - escaped quotes in strings
  escapedQuoteStringSource?: string;
  escapedQuoteStringBlockOpen?: string;
  escapedQuoteStringBlockClose?: string;
}

// Generate edge case tests (empty source, no blocks)
export function generateEdgeCaseTests(config: CommonTestConfig): void {
  test('should handle empty source', () => {
    const pairs = config.getParser().parse('');
    assertNoBlocks(pairs);
  });

  test('should handle source with no blocks', () => {
    const pairs = config.getParser().parse(config.noBlockSource);
    assertNoBlocks(pairs);
  });
}

// Generate test helper method tests (getTokens, getExcludedRegions)
export function generateHelperMethodTests(config: CommonTestConfig): void {
  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const tokens = config.getParser().getTokens(config.tokenSource);
      assertTokens(
        tokens,
        config.expectedTokenValues.map((value) => ({ value }))
      );
    });

    test('getExcludedRegions should return excluded regions', () => {
      const regions = config.getParser().getExcludedRegions(config.excludedSource);
      assert.strictEqual(regions.length, config.expectedRegionCount);
    });
  });
}

// Generate token position tests
export function generateTokenPositionTests(config: CommonTestConfig): void {
  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const pairs = config.getParser().parse(config.twoLineSource);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    if (config.nestedPositionSource && config.nestedKeyword !== undefined) {
      const nestedSource = config.nestedPositionSource;
      const nestedKw = config.nestedKeyword;
      test('should have correct positions for nested blocks', () => {
        const pairs = config.getParser().parse(nestedSource);
        const nestedPair = pairs.find((p) => p.openKeyword.value === nestedKw);
        assert.ok(nestedPair, `Expected to find pair with keyword '${nestedKw}'`);
        assertTokenPosition(nestedPair.openKeyword, config.nestedLine ?? 0, config.nestedColumn ?? 0);
      });
    }
  });
}

// Generate excluded region tests (comments and strings)
export function generateExcludedRegionTests(config: CommonTestConfig): void {
  test('should ignore keywords in single-line comments', () => {
    const pairs = config.getParser().parse(config.singleLineCommentSource);
    assertSingleBlock(pairs, config.commentBlockOpen, config.commentBlockClose);
  });

  if (config.doubleQuotedStringSource && config.stringBlockOpen && config.stringBlockClose) {
    const stringSource = config.doubleQuotedStringSource;
    const stringOpen = config.stringBlockOpen;
    const stringClose = config.stringBlockClose;
    test('should ignore keywords in double-quoted strings', () => {
      const pairs = config.getParser().parse(stringSource);
      assertSingleBlock(pairs, stringOpen, stringClose);
    });
  }

  if (config.singleQuotedStringSource && config.singleQuotedStringBlockOpen && config.singleQuotedStringBlockClose) {
    const sqSource = config.singleQuotedStringSource;
    const sqOpen = config.singleQuotedStringBlockOpen;
    const sqClose = config.singleQuotedStringBlockClose;
    test('should ignore keywords in single-quoted strings', () => {
      const pairs = config.getParser().parse(sqSource);
      assertSingleBlock(pairs, sqOpen, sqClose);
    });
  }

  if (config.commentAtEndOfLineSource && config.commentAtEndOfLineBlockOpen && config.commentAtEndOfLineBlockClose) {
    const ceolSource = config.commentAtEndOfLineSource;
    const ceolOpen = config.commentAtEndOfLineBlockOpen;
    const ceolClose = config.commentAtEndOfLineBlockClose;
    test('should handle comment at end of line', () => {
      const pairs = config.getParser().parse(ceolSource);
      assertSingleBlock(pairs, ceolOpen, ceolClose);
    });
  }

  if (config.escapedQuoteStringSource && config.escapedQuoteStringBlockOpen && config.escapedQuoteStringBlockClose) {
    const eqSource = config.escapedQuoteStringSource;
    const eqOpen = config.escapedQuoteStringBlockOpen;
    const eqClose = config.escapedQuoteStringBlockClose;
    test('should handle escaped quotes in strings', () => {
      const pairs = config.getParser().parse(eqSource);
      assertSingleBlock(pairs, eqOpen, eqClose);
    });
  }
}

// Generate string interpolation tests (Ruby/Crystal shared)
export function generateStringInterpolationTests(config: CommonTestConfig): void {
  test('should handle #{} interpolation with nested double quotes', () => {
    const pairs = config.getParser().parse('x = "#{if true then "yes" else "no" end}"');
    assertNoBlocks(pairs);
  });

  test('should handle nested #{} interpolation', () => {
    const pairs = config.getParser().parse('x = "outer #{a + "inner #{b}" + c}"');
    assertNoBlocks(pairs);
  });

  test('should handle #{} with block keywords inside', () => {
    const pairs = config.getParser().parse('"result: #{if x\n  y\nend}"');
    assertNoBlocks(pairs);
  });

  test('should handle empty interpolation', () => {
    const pairs = config.getParser().parse('x = "value: #{}"');
    assertNoBlocks(pairs);
  });

  test('should handle interpolation with braces', () => {
    const pairs = config.getParser().parse('x = "#{hash = {a: 1}}"');
    assertNoBlocks(pairs);
  });

  test('should still parse blocks outside interpolated strings', () => {
    const result = config.getParser().parse('"#{x}"\nif true\nend');
    assertSingleBlock(result, 'if', 'end');
  });
}

// Generate regex interpolation tests (Ruby/Crystal shared)
export function generateRegexInterpolationTests(config: CommonTestConfig): void {
  test('should handle #{} interpolation inside regex', () => {
    const pairs = config.getParser().parse('x = /start_#{var}_end/\ndef foo\nend');
    assertSingleBlock(pairs, 'def', 'end');
  });

  test('should handle #{} with slash inside regex interpolation', () => {
    const pairs = config.getParser().parse('x = /start_#{get_pattern("/")}_end/\ndef foo\nend');
    assertSingleBlock(pairs, 'def', 'end');
  });

  test('should handle #{} with nested braces inside regex', () => {
    const pairs = config.getParser().parse('x = /prefix_#{hash = {a: 1}}_suffix/\ndef foo\nend');
    assertSingleBlock(pairs, 'def', 'end');
  });

  test('should handle multiple #{} interpolations in regex', () => {
    const pairs = config.getParser().parse('x = /#{a}_#{b}_#{c}/\ndef foo\nend');
    assertSingleBlock(pairs, 'def', 'end');
  });

  test('should handle empty #{} interpolation in regex', () => {
    const pairs = config.getParser().parse('x = /pattern_#{}end/\ndef foo\nend');
    assertSingleBlock(pairs, 'def', 'end');
  });
}

// Generate all common tests at once
export function generateCommonTests(config: CommonTestConfig): void {
  generateHelperMethodTests(config);
  generateTokenPositionTests(config);
}
