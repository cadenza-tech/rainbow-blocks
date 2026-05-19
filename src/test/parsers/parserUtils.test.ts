import * as assert from 'node:assert';
import { mergeCompoundEndTokens } from '../../parsers/parserUtils';
import type { Token } from '../../types';

type CompoundInfo = { keyword: string; length: number; endType: string };

// Builds a synthetic token
function mkToken(type: Token['type'], value: string, startOffset: number): Token {
  return { type, value, startOffset, endOffset: startOffset + value.length, line: 0, column: 0 };
}

// Reference O(T*M) implementation: the per-token scan over every compound that
// mergeCompoundEndTokens replaced with a sorted-array binary search. The fast
// path must stay byte-for-byte equivalent to this
function legacyMergeCompoundEndTokens(
  tokens: Token[],
  compoundEndPositions: Map<number, CompoundInfo>
): { tokens: Token[]; processedPositions: Set<number> } {
  const result: Token[] = [];
  const processedPositions = new Set<number>();
  for (const token of tokens) {
    const compound = compoundEndPositions.get(token.startOffset);
    if (compound && token.value.toLowerCase() === 'end') {
      result.push({ ...token, value: compound.keyword, endOffset: token.startOffset + compound.length, type: 'block_close' });
      processedPositions.add(token.startOffset);
      continue;
    }
    let shouldSkip = false;
    for (const [endPos, comp] of compoundEndPositions) {
      if (token.startOffset > endPos && token.startOffset < endPos + comp.length && token.value.toLowerCase() === comp.endType) {
        shouldSkip = true;
        break;
      }
    }
    if (!shouldSkip) {
      result.push(token);
    }
  }
  return { tokens: result, processedPositions };
}

function assertSameMerge(tokens: Token[], compounds: Map<number, CompoundInfo>, label: string): void {
  const actual = mergeCompoundEndTokens(tokens, compounds);
  const expected = legacyMergeCompoundEndTokens(tokens, compounds);
  assert.deepStrictEqual(actual.tokens, expected.tokens, `merged tokens diverge for ${label}`);
  const actualPositions = [...actual.processedPositions].sort((a, b) => a - b);
  const expectedPositions = [...expected.processedPositions].sort((a, b) => a - b);
  assert.deepStrictEqual(actualPositions, expectedPositions, `processed positions diverge for ${label}`);
}

// mergeCompoundEndTokens scanned every compound for every token (O(T*M)); it now
// binary-searches the single covering compound. These tests pin the rewrite: the
// merged output must be unchanged, and a large flat compound-end list must finish
// well within the debounce budget the quadratic version blew past.
suite('parserUtils mergeCompoundEndTokens', () => {
  suite('Regression: binary-search compound lookup equivalence and scaling', () => {
    test('should match the legacy result with no compounds', () => {
      const tokens = [mkToken('block_open', 'if', 0), mkToken('block_close', 'end', 10)];
      assertSameMerge(tokens, new Map(), 'no compounds');
    });

    test('should merge a compound end and absorb its type token', () => {
      // "end if": end at 20, compound length 6, type token "if" at 24
      const tokens = [mkToken('block_open', 'if', 0), mkToken('block_close', 'end', 20), mkToken('block_open', 'if', 24)];
      const compounds = new Map<number, CompoundInfo>([[20, { keyword: 'end if', length: 6, endType: 'if' }]]);
      assertSameMerge(tokens, compounds, 'single compound');
      const { tokens: merged } = mergeCompoundEndTokens(tokens, compounds);
      assert.strictEqual(merged.length, 2, 'type token should be absorbed into the compound');
      assert.strictEqual(merged[1].value, 'end if');
    });

    test('should keep a type-like keyword that is not inside a compound span', () => {
      const tokens = [mkToken('block_close', 'end', 0), mkToken('block_open', 'if', 50)];
      const compounds = new Map<number, CompoundInfo>([[0, { keyword: 'end if', length: 6, endType: 'if' }]]);
      assertSameMerge(tokens, compounds, 'detached type keyword');
    });

    test('should match the legacy result across many adjacent compounds', () => {
      const tokens: Token[] = [];
      const compounds = new Map<number, CompoundInfo>();
      let offset = 0;
      for (let i = 0; i < 50; i++) {
        tokens.push(mkToken('block_open', 'loop', offset));
        const endPos = offset + 8;
        tokens.push(mkToken('block_close', 'end', endPos));
        compounds.set(endPos, { keyword: 'end loop', length: 8, endType: 'loop' });
        tokens.push(mkToken('block_open', 'loop', endPos + 4));
        offset = endPos + 14;
      }
      assertSameMerge(tokens, compounds, 'many adjacent compounds');
    });

    test('should merge a large flat compound-end list well within the debounce budget', () => {
      // 40000 compounds: the replaced O(T*M) loop did billions of comparisons here
      const tokens: Token[] = [];
      const compounds = new Map<number, CompoundInfo>();
      const count = 40000;
      let offset = 0;
      for (let i = 0; i < count; i++) {
        tokens.push(mkToken('block_open', 'if', offset));
        const endPos = offset + 4;
        tokens.push(mkToken('block_close', 'end', endPos));
        compounds.set(endPos, { keyword: 'end if', length: 6, endType: 'if' });
        tokens.push(mkToken('block_open', 'if', endPos + 4));
        offset = endPos + 10;
      }
      mergeCompoundEndTokens(tokens, compounds); // warm up
      const start = Date.now();
      const { tokens: merged } = mergeCompoundEndTokens(tokens, compounds);
      const elapsed = Date.now() - start;
      assert.strictEqual(merged.length, count * 2, 'each compound absorbs its type token');
      assert.ok(elapsed < 4000, `mergeCompoundEndTokens for ${count} compounds took ${elapsed}ms, expected < 4000ms`);
    });
  });
});
