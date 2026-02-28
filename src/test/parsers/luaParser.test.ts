import * as assert from 'node:assert';
import { LuaBlockParser } from '../../parsers/luaParser';
import { assertBlockCount, assertIntermediates, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('LuaBlockParser Test Suite', () => {
  let parser: LuaBlockParser;

  setup(() => {
    parser = new LuaBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: "print('hello world')",
    tokenSource: 'if true then\nend',
    expectedTokenValues: ['if', 'then', 'end'],
    excludedSource: '-- comment\n"string"\n[[long string]]',
    expectedRegionCount: 3,
    twoLineSource: 'if true then\nend',
    singleLineCommentSource: '-- if then end function\nif true then\nend',
    commentBlockOpen: 'if',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'x = "if then end while"\nif true then\nend',
    stringBlockOpen: 'if',
    stringBlockClose: 'end'
  };

  suite('Simple blocks', () => {
    test('should parse if-then-end block', () => {
      const source = `if condition then
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should parse while-do-end block', () => {
      const source = `while condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should parse for-do-end block (numeric)', () => {
      const source = `for i = 1, 10 do
  print(i)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse for-in-do-end block (generic)', () => {
      const source = `for k, v in pairs(t) do
  print(k, v)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse function-end block', () => {
      const source = `function myFunc()
  return 42
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse local function-end block', () => {
      const source = `local function myFunc()
  return 42
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse anonymous function-end block', () => {
      const source = `local f = function()
  return 42
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse do-end block', () => {
      const source = `do
  local x = 10
  print(x)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('repeat-until blocks', () => {
    test('should parse repeat-until block', () => {
      const source = `repeat
  action()
until condition`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });

    test('should parse nested repeat-until blocks', () => {
      const source = `repeat
  repeat
    inner()
  until inner_condition
until outer_condition`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // Inner repeat-until
      assert.strictEqual(pairs[0].openKeyword.value, 'repeat');
      assert.strictEqual(pairs[0].nestLevel, 1);
      // Outer repeat-until
      assert.strictEqual(pairs[1].openKeyword.value, 'repeat');
      assert.strictEqual(pairs[1].nestLevel, 0);
    });

    test('should handle repeat-until with nested if-end', () => {
      const source = `repeat
  if condition then
    action()
  end
until done`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // Inner if-end
      assert.strictEqual(pairs[0].openKeyword.value, 'if');
      assert.strictEqual(pairs[0].closeKeyword.value, 'end');
      // Outer repeat-until
      assert.strictEqual(pairs[1].openKeyword.value, 'repeat');
      assert.strictEqual(pairs[1].closeKeyword.value, 'until');
    });

    test('should handle if-end inside repeat-until', () => {
      const source = `repeat
  if x > 0 then
    x = x - 1
  end
until x == 0`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // if-end closes with end
      assert.strictEqual(pairs[0].openKeyword.value, 'if');
      assert.strictEqual(pairs[0].closeKeyword.value, 'end');
      // repeat closes with until
      assert.strictEqual(pairs[1].openKeyword.value, 'repeat');
      assert.strictEqual(pairs[1].closeKeyword.value, 'until');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-then-else-end block', () => {
      const source = `if condition then
  action1()
else
  action2()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should parse if-then-elseif-then-else-end block', () => {
      const source = `if cond1 then
  action1()
elseif cond2 then
  action2()
else
  action3()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'elseif', 'then', 'else']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `function outer()
  if condition then
    for i = 1, 10 do
      print(i)
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      // Inner for-end
      assert.strictEqual(pairs[0].openKeyword.value, 'for');
      assert.strictEqual(pairs[0].nestLevel, 2);
      // Middle if-end
      assert.strictEqual(pairs[1].openKeyword.value, 'if');
      assert.strictEqual(pairs[1].nestLevel, 1);
      // Outer function-end
      assert.strictEqual(pairs[2].openKeyword.value, 'function');
      assert.strictEqual(pairs[2].nestLevel, 0);
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should ignore keywords in multi-line comments', () => {
      const source = `--[[
if condition then
  function test()
  end
end
]]
if real then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multi-line comment with equal signs', () => {
      const source = `--[=[
if condition then end
]=]
if real then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multi-line comment with multiple equal signs', () => {
      const source = `--[==[
if condition then end
]==]
if real then
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted strings', () => {
      const source = `x = 'if then end while'
if true then
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle escaped quotes in strings', () => {
      const source = `msg = "he said \\"if\\" and \\"end\\""
if condition then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Long strings', () => {
    test('should ignore keywords in long strings [[ ]]', () => {
      const source = `text = [[
if condition then
  do something
end
]]
if real then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle long strings with equal signs [=[ ]=]', () => {
      const source = `text = [=[
if condition then end
]=]
if real then
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle long strings with multiple equal signs', () => {
      const source = `text = [==[
if condition then end
]==]
if real then
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle nested brackets in long strings correctly', () => {
      const source = `text = [[
  some [text] with brackets
  if condition then end
]]
if real then
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Edge cases', () => {
    suite('General', () => {
      generateEdgeCaseTests(config);

      test('should handle complex real-world Lua code', () => {
        const source = `local function process(items)
  for i, item in ipairs(items) do
    if item.valid then
      repeat
        item:update()
      until item.done
    else
      item:skip()
    end
  end
end`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 4);

        // Find the function pair
        const funcPair = findBlock(pairs, 'function');
        assert.strictEqual(funcPair.nestLevel, 0);
      });

      test('should handle multiple functions', () => {
        const source = `function a()
end

function b()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
      });

      test('should handle method-style function', () => {
        const source = `function obj:method()
  return self.value
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });
    });

    suite('Long strings', () => {
      test('should handle unterminated long string', () => {
        const source = `text = [[
if unterminated
end`;
        const pairs = parser.parse(source);
        // Unterminated long string should exclude everything
        assertNoBlocks(pairs);
      });

      test('should handle bracket not followed by bracket', () => {
        const source = `x = [1, 2, 3]
if true then
end`;
        const pairs = parser.parse(source);
        // [1,2,3] is not a long string, if should be detected
        assertBlockCount(pairs, 1);
      });

      test('should handle bracket with equals but no second bracket', () => {
        const source = `x = [=a
if true then
end`;
        const pairs = parser.parse(source);
        // [=a is not a long string, if should be detected
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated long string with equals', () => {
        const source = `text = [=[
if unterminated
never closes`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Block matching', () => {
      test('should handle until without matching repeat', () => {
        const source = `if condition then
  action()
until x`;
        const pairs = parser.parse(source);
        // until without repeat should not match anything
        // Only if-then-end should be detected if there was an end
        assertNoBlocks(pairs);
      });

      test('should handle end when all blocks are repeat', () => {
        const source = `repeat
  repeat
    action()
  end`;
        const pairs = parser.parse(source);
        // end cannot close repeat, so nothing matches
        assertNoBlocks(pairs);
      });

      test('should handle mixed repeat and other blocks', () => {
        const source = `repeat
  if condition then
    action()
  end
until done`;
        const pairs = parser.parse(source);
        // if-end and repeat-until should both match
        assertBlockCount(pairs, 2);
      });
    });

    suite('Strings', () => {
      test('should handle unterminated double-quoted string (stops at newline)', () => {
        const source = `msg = "unterminated
if true then
end`;
        const pairs = parser.parse(source);
        // Lua regular strings cannot span lines, so unterminated string
        // stops at newline and subsequent keywords are detected
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle unterminated single-quoted string (stops at newline)', () => {
        const source = `msg = 'unterminated
if true then
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });
    });

    suite('Comments', () => {
      test('should handle unterminated multi-line comment', () => {
        const source = `--[[
if inside comment
function inside()
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Standalone do blocks', () => {
      test('should detect standalone do when string contains while', () => {
        const source = `print("while") do
  local x = 1
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'do', 'end');
      });

      test('should detect standalone do when string contains for', () => {
        const source = `print("for loop") do
  local x = 1
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'do', 'end');
      });

      test('should detect standalone do when comment contains while', () => {
        const source = `-- while this is a comment
do
  local x = 1
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'do', 'end');
      });

      test('should still detect while-do as single block', () => {
        const source = `while condition do
  action()
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'while', 'end');
      });

      test('should still detect for-do as single block', () => {
        const source = `for i = 1, 10 do
  print(i)
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'end');
      });
    });
  });

  generateCommonTests(config);

  suite('Coverage: isDoPartOfLoop edge cases', () => {
    test('should handle do keyword inside string between loop and real do', () => {
      // Tests the excluded region check for do (lines 57-58)
      // "do" inside a string after for should be skipped
      const source = `for i = 1, x("do") do
  print(i)
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'for');
    });

    test('should detect different valid do before target do on same line', () => {
      // Tests the "different valid do before our position" break branch
      // for ... do ... do on same line, second do is standalone
      const source = 'for i = 1, 10 do function() do print(i) end end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Coverage: matchLongString guard clause', () => {
    test('should handle matchLongString called with non-bracket character', () => {
      // The matchLongString guard (source[pos] !== '[') returns null
      // This is reached when matchComment checks for --[[ but position+2
      // is not [, causing matchLongString to early-return
      const source = `-- regular comment, not --[[ multiline
if true then
  print("hello")
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle [ that is not long string', () => {
      // Tests matchLongString returning null when [ is not followed by [ or =
      const source = `local x = arr[5]
if true then
  print(x)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Goto labels', () => {
    test('should not treat end inside goto label as block close', () => {
      const source = `function foo()
  ::end::
  return 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle goto label with spaces', () => {
      const source = `function foo()
  :: my_label ::
  return 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not match incomplete goto label', () => {
      const source = `if true then
  x = a::b
  print(x)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle goto label with keyword-like name', () => {
      const source = `function foo()
  ::repeat::
  ::until::
  return 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not match goto label starting with digit', () => {
      const source = `function foo()
  x = a::123
  return 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: tryMatchExcludedRegion edge cases', () => {
    test('should return null for non-special characters', () => {
      const regions = parser.getExcludedRegions('x = 1 + 2');
      assert.strictEqual(regions.length, 0);
    });
  });

  suite('Edge cases', () => {
    test('should handle repeat-until with no body', () => {
      const source = 'repeat until true';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });

    test('should handle CRLF line endings', () => {
      const source = 'if true then\r\n  x = 1\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested long strings with different levels', () => {
      const source = `x = [==[
  if true then
    [[ nested ]]
  end
]==]
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle do end immediately after for', () => {
      const source = 'for i=1,10 do end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('String escape sequences', () => {
    test('should handle \\z escape (skip whitespace including newlines)', () => {
      const source = `x = "text \\z
      continued if end"
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle \\n line continuation', () => {
      const source = `x = "line1\\
line2 if end"
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle \\r line continuation', () => {
      const source = 'x = "line1\\\rline2 if end"\rif true then\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle \\r\\n line continuation', () => {
      const source = 'x = "line1\\\r\nline2 if end"\r\nif true then\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Goto label edge cases', () => {
    test('should handle goto label with invalid format', () => {
      const source = `:: invalid
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle goto label without closing ::', () => {
      const source = `::label
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle goto label with whitespace around identifier', () => {
      const source = `::  label  ::
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle :: followed by non-identifier', () => {
      const source = `:: 123 ::
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle :: at end of source', () => {
      const source = `if true then
end
::`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle valid goto label with newlines', () => {
      const source = `::
  label
::
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: unterminated string at EOF', () => {
    test('should handle unterminated double-quoted string at EOF without newline', () => {
      // matchQuotedString line 280: return { start: pos, end: i } when EOF reached
      const source = 'x = "unterminated';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      const strRegion = regions.find((r) => r.start === 4);
      assert.ok(strRegion);
      assert.strictEqual(strRegion.end, source.length);
    });

    test('should handle unterminated single-quoted string at EOF without newline', () => {
      const source = "x = 'unterminated";
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      const strRegion = regions.find((r) => r.start === 4);
      assert.ok(strRegion);
      assert.strictEqual(strRegion.end, source.length);
    });
  });

  suite('Coverage: matchGotoLabel edge cases', () => {
    test('should return null when :: is followed by nothing (EOF immediately)', () => {
      // matchGotoLabel line 291: i >= source.length
      const source = '::';
      const regions = parser.getExcludedRegions(source);
      // :: at end of file -> matchGotoLabel returns null, then : is just a character
      assert.strictEqual(regions.length, 0);
    });

    test('should return null when :: is followed by whitespace only at EOF', () => {
      const source = '::   ';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0);
    });
  });

  suite('Long string edge cases', () => {
    // Covers lines 130-131: return null when not starting with '['
    test('should not treat -- followed by non-bracket as multi-line comment', () => {
      const source = `-- comment with = sign
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle -- followed by identifier', () => {
      const source = `--xyz
if true then
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });
});
