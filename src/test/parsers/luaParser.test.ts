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

    test('should not treat Unicode-adjacent for as loop keyword in isDoPartOfLoop', () => {
      const pairs = parser.parse('\u03B1for = 1\ndo\n  x = 1\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat standalone do as block opener after for without do followed by end', () => {
      const pairs = parser.parse('for i = 1, 10\nend\ndo\n  x = 1\nend');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: findLastNonRepeatIndex backward scan', () => {
    test('should close function-end when repeat is on top of stack', () => {
      const source = `function f()
  repeat
    while true do
    end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
      findBlock(pairs, 'function');
    });

    test('should close if-end through multiple unmatched repeat blocks', () => {
      const source = `if true then
  repeat
  repeat
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not close anything when only repeat blocks are on the stack', () => {
      const source = 'repeat\nrepeat\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

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

  suite('Bug 1: isDoPartOfLoop nested for...do', () => {
    test('should handle nested for...do inside expression', () => {
      // Outer for has a nested for...do...end inside its iterator expression
      const source = 'for i in (for j in t do end) do\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // Both blocks should be for...end
      const forBlocks = pairs.filter((p) => p.openKeyword.value === 'for');
      assert.strictEqual(forBlocks.length, 2, 'should have two for blocks');
    });

    test('should handle nested while...do inside for loop expression', () => {
      const source = 'for i in (while cond do end) do\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle double-nested for...do', () => {
      const source = 'for a in (for b in (for c in t do end) do end) do\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should still treat standalone do as block opener with nested loops', () => {
      const source = 'do\n  for i in t do\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const doBlock = pairs.find((p) => p.openKeyword.value === 'do');
      assert.ok(doBlock, 'standalone do block should exist');
      const forBlock = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forBlock, 'for loop block should exist');
    });

    test('should handle for...do after another for...do on separate lines', () => {
      const source = 'for i in a do\nend\nfor j in b do\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: isDoPartOfLoop otherBlockDepth tracking', () => {
    test('should handle do after for with function containing for inside', () => {
      // Exercises otherBlockDepth tracking (lines 64-71):
      // Inner function opens otherBlockDepth, inner for/do/end are skipped,
      // end of function closes otherBlockDepth
      const source = `for i = 1, 10 do
  function foo()
    for j = 1, 5 do
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      // Inner for-end (inside function)
      const innerFor = pairs.find((p) => p.openKeyword.value === 'for' && p.nestLevel === 2);
      assert.ok(innerFor, 'inner for block should exist at nest level 2');
      // function-end
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.nestLevel, 1);
      // Outer for-end
      const outerFor = pairs.find((p) => p.openKeyword.value === 'for' && p.nestLevel === 0);
      assert.ok(outerFor, 'outer for block should exist at nest level 0');
    });

    test('should handle do after while with if containing while inside', () => {
      // if opens otherBlockDepth, inner while/do are skipped, end closes otherBlockDepth
      const source = `while cond do
  if true then
    while inner do
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle do after for with repeat-until containing for inside', () => {
      // repeat opens otherBlockDepth, inner for/do are skipped, until closes otherBlockDepth
      const source = `for i = 1, 10 do
  repeat
    for j = 1, 5 do
    end
  until true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle Unicode-adjacent keyword inside loop scan', () => {
      // Tests isAdjacentToUnicodeLetter check inside inner match loop (lines 59-61)
      // The Unicode-prefixed "for" should be skipped as adjacent to Unicode letter
      const source = '\u00E9for = 1\nfor i = 1, 10 do\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'for');
    });

    test('should skip Unicode-adjacent keyword in inner scan between for and do', () => {
      // Covers lines 60-61: isAdjacentToUnicodeLetter inside inner match loop
      // Between outer for and do, the inner scan encounters end preceded by Unicode letter
      const source = 'for i = \u00E9end, 10 do\n  print(i)\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'for');
    });

    test('should track otherBlockDepth for function containing loop between for and do', () => {
      // Covers lines 65, 67, 69-71: otherBlockDepth tracking in inner scan
      // Between outer for and do, function opens otherBlockDepth, inner for/do are skipped
      const source = 'for i = 1, (function() for j=1,2 do end return 1 end)() do\n  print(i)\nend';
      const pairs = parser.parse(source);
      // Outer for-do-end should be detected as a single for loop
      const forBlock = pairs.find((p) => p.openKeyword.value === 'for' && p.nestLevel === 0);
      assert.ok(forBlock, 'outer for block should exist');
    });
  });

  suite('Branch coverage: standalone do inside non-loop block in loop scan', () => {
    test('should handle standalone do inside function between for and its do', () => {
      // Covers luaParser.ts lines 85-86: otherBlockDepth > 0, word === 'do',
      // pendingLoopDo === 0 -> otherBlockDepth++ (standalone do inside function)
      // Between outer for and its do, function contains a standalone do...end
      const source = 'for i = 1, (function() do end return 1 end)() do\n  print(i)\nend';
      const pairs = parser.parse(source);
      const forBlock = pairs.find((p) => p.openKeyword.value === 'for' && p.nestLevel === 0);
      assert.ok(forBlock, 'outer for block should exist');
    });

    test('should handle standalone do inside if block between while and its do', () => {
      // Same branch: standalone do inside if block, no pending loop do
      const source = 'while (function() if true then do end end return true end)() do\n  x = 1\nend';
      const pairs = parser.parse(source);
      const whileBlock = pairs.find((p) => p.openKeyword.value === 'while' && p.nestLevel === 0);
      assert.ok(whileBlock, 'outer while block should exist');
    });
  });

  suite('Coverage: unterminated long string in comment', () => {
    test('should handle unterminated multi-line comment --[[ without closing ]]', () => {
      // Covers line 177: matchLongString returns { start: pos, end: source.length }
      // when long string [[ is never closed
      const source = '--[[ unterminated';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should handle unterminated long string [[ as standalone excluded region', () => {
      // Covers line 177: unterminated long string without closing ]]
      const source = 'x = [[ unterminated string with if end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const regions = parser.getExcludedRegions(source);
      const longStrRegion = regions.find((r) => r.start === 4);
      assert.ok(longStrRegion);
      assert.strictEqual(longStrRegion.end, source.length);
    });
  });

  suite('Regression: \\z escape with \\v and \\f whitespace', () => {
    test('should handle \\z escape with \\v whitespace', () => {
      const pairs = parser.parse('x = "hello\\z\v\n  world"\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle \\z escape with \\f whitespace', () => {
      const pairs = parser.parse('x = "hello\\z\f\n  world"\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle \\z escape with mixed \\v \\f \\t \\n whitespace', () => {
      const pairs = parser.parse('x = "hello\\z\v\f\t\n  world"\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: keywords preceded by dot or colon should not be block keywords', () => {
    test('should not treat t.end as block close', () => {
      // Bug: keywords preceded by '.' or ':' were incorrectly detected as block keywords
      const source = 'function f() print(t.end) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat t.if as block open', () => {
      const source = 'function f() x = t.if end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat t.while as block open', () => {
      const source = 'function f() x = t.while end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat t.repeat as block open', () => {
      const source = 'function f() x = t.repeat end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat obj:do as block open', () => {
      const source = 'function f() obj:do() end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat t.then as intermediate keyword', () => {
      const source = 'if true then\n  x = t.then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat t.else as intermediate keyword', () => {
      const source = 'if true then\n  x = t.else\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat .. concatenation as field access', () => {
      const pairs = parser.parse('x = "hi"..function()\n  return "lo"\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  // Regression: goto label :: should not trigger dot/colon check
  suite('Regression: goto label closing ::', () => {
    test('should detect if block after goto label', () => {
      const source = '::label::if true then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect end after goto label', () => {
      const source = 'if true then\n::lbl::end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect function after goto label', () => {
      const source = '::lbl::function f()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still reject method call colon', () => {
      const source = 'obj:do\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: isDoPartOfLoop dot/colon filter', () => {
    test('should detect for...end when t.do appears between for and real do', () => {
      const source = 'for i = 1, t.do do print(i) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should detect for...end when t.end appears between for and real do', () => {
      const source = 'for i = 1, t.end do print(i) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should detect while...end when obj:end() appears in condition', () => {
      const source = 'while obj:end() do print(1) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should detect standalone do...end when t.while precedes it', () => {
      const source = 't.while\ndo print(1) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Regression: dot/colon with whitespace before keyword', () => {
    test('should reject end after dot with space', () => {
      const pairs = parser.parse('function f() return obj . end\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should reject if after dot with space', () => {
      const pairs = parser.parse('function f() return t . if\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should reject end after colon with space', () => {
      const pairs = parser.parse('function f() obj : end()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should reject end after dot with tab', () => {
      const pairs = parser.parse('function f() return obj.\tend\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: comment ending with punctuation should not affect next line keywords', () => {
    test('should not reject keywords on line after comment ending with period', () => {
      const pairs = parser.parse('-- This is a comment.\nif true then\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not reject keywords on line after comment ending with colon', () => {
      const pairs = parser.parse('-- Note:\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still reject dot-preceded keywords on same line', () => {
      const pairs = parser.parse('t.do');
      assertNoBlocks(pairs);
    });
  });

  generateCommonTests(config);
});
