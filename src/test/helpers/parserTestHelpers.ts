// Test helper functions for parser unit tests

import * as assert from 'node:assert';
import type { BlockPair, Token } from '../../types';

// Verify a single block pair with expected keywords and nest level
export function assertSingleBlock(pairs: BlockPair[], openKeyword: string, closeKeyword: string, nestLevel = 0): void {
  assert.strictEqual(pairs.length, 1, `Expected 1 pair, got ${pairs.length}`);
  assert.strictEqual(pairs[0].openKeyword.value, openKeyword);
  assert.strictEqual(pairs[0].closeKeyword.value, closeKeyword);
  assert.strictEqual(pairs[0].nestLevel, nestLevel);
}

// Verify intermediate keywords in a block pair
export function assertIntermediates(pair: BlockPair, expectedValues: string[]): void {
  assert.strictEqual(
    pair.intermediates.length,
    expectedValues.length,
    `Expected ${expectedValues.length} intermediates, got ${pair.intermediates.length}`
  );
  for (let i = 0; i < expectedValues.length; i++) {
    assert.strictEqual(pair.intermediates[i].value, expectedValues[i]);
  }
}

// Verify nest level for a block pair found by its opening keyword
export function assertNestLevel(pairs: BlockPair[], keyword: string, expectedLevel: number): void {
  const pair = pairs.find((p) => p.openKeyword.value === keyword);
  assert.ok(pair, `Expected to find pair with keyword '${keyword}'`);
  assert.strictEqual(pair.nestLevel, expectedLevel, `Expected nestLevel ${expectedLevel} for '${keyword}', got ${pair.nestLevel}`);
}

// Verify no blocks were detected
export function assertNoBlocks(pairs: BlockPair[]): void {
  assert.strictEqual(pairs.length, 0, `Expected 0 pairs, got ${pairs.length}`);
}

// Verify token position (line and column)
export function assertTokenPosition(token: Token, line: number, column: number): void {
  assert.strictEqual(token.line, line, `Expected line ${line}, got ${token.line}`);
  assert.strictEqual(token.column, column, `Expected column ${column}, got ${token.column}`);
}

// Verify the number of detected block pairs
export function assertBlockCount(pairs: BlockPair[], count: number): void {
  assert.strictEqual(pairs.length, count, `Expected ${count} pairs, got ${pairs.length}`);
}

// Find a block pair by its opening keyword
export function findBlock(pairs: BlockPair[], openKeyword: string): BlockPair {
  const pair = pairs.find((p) => p.openKeyword.value === openKeyword);
  assert.ok(pair, `Expected to find pair with keyword '${openKeyword}'`);
  return pair;
}

// Verify tokens array with expected values and optional types
export function assertTokens(tokens: Token[], expected: Array<{ value: string; type?: string }>): void {
  assert.strictEqual(tokens.length, expected.length, `Expected ${expected.length} tokens, got ${tokens.length}`);
  for (let i = 0; i < expected.length; i++) {
    assert.strictEqual(tokens[i].value, expected[i].value);
    if (expected[i].type) {
      assert.strictEqual(tokens[i].type, expected[i].type);
    }
  }
}
