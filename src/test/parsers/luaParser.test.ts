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
    stringBlockClose: 'end',
    singleQuotedStringSource: "x = 'if then end while'\nif true then\nend",
    singleQuotedStringBlockOpen: 'if',
    singleQuotedStringBlockClose: 'end',
    escapedQuoteStringSource: 'msg = "he said \\"if\\" and \\"end\\""\nif condition then\nend',
    escapedQuoteStringBlockOpen: 'if',
    escapedQuoteStringBlockClose: 'end'
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

    test('should count LF+CR as a single newline per Lua 5.3+ spec (バグ1)', () => {
      // Lua 5.3+ spec (Lexical Conventions): "A line break can be represented
      // by `\n` (LF), `\r` (CR), `\n\r` (LF+CR), or `\r\n` (CR+LF)." All four
      // forms count as a SINGLE newline for line numbering purposes.
      // Bug: BaseBlockParser.buildNewlinePositions only paired `\r\n`; an
      // `\n\r` (LF+CR) sequence pushed BOTH `\n` and `\r` as separate newlines,
      // so `end` after `then\n\r` was reported on line 2 instead of line 1.
      // Fix: override buildNewlinePositions in LuaParser to also collapse
      // `\n\r` into a single newline (does not change pair structure, only
      // the reported line numbers).
      const source = 'if true then\n\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'if must be on line 0');
      assert.strictEqual(pairs[0].closeKeyword.line, 1, 'end after LF+CR must be on line 1, not 2');
    });

    test('should count plain LF as a single newline (control for LF+CR fix)', () => {
      // Control: existing LF behaviour must not regress after the LF+CR fix.
      const source = 'if true then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });

    test('should count plain CR as a single newline (control for LF+CR fix)', () => {
      // Control: existing CR-only behaviour must not regress.
      const source = 'if true then\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });

    test('should count CRLF as a single newline (control for LF+CR fix)', () => {
      // Control: existing CRLF pairing must not regress.
      const source = 'if true then\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });

    test('should still count two LFs as two newlines after the LF+CR fix', () => {
      // The LF+CR fix must NOT collapse two consecutive `\n` chars: each
      // standalone LF is its own line break. `then\n\nend` puts `end` on line 2.
      const source = 'if true then\n\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'two LFs must remain two newlines');
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

    test('should handle \\<LF><CR> line continuation (バグ1)', () => {
      // Lua 5.4 treats all four newline forms (LF, CR, LF+CR, CR+LF) as a
      // single real newline. `\<newline>` line continuation must accept the
      // \n\r pair as well, mirroring the existing \r\n handling.
      const source = 'x = "abc\\\n\rif true then end"\nfunction f()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
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

  suite('Regression: dot/colon preceded keywords across newlines', () => {
    test('should reject end preceded by dot across LF', () => {
      const pairs = parser.parse('function f()\n  return obj.\n  end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should reject do preceded by colon across LF', () => {
      const pairs = parser.parse('function f()\n  obj:\n  do()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should reject end preceded by dot across CRLF', () => {
      const pairs = parser.parse('function f()\r\n  return t.\r\n  end\r\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not be affected by comment ending with dot', () => {
      const pairs = parser.parse('-- comment.\nif true then\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: trailing-dot number literal should not trigger field access check', () => {
    test('should detect function/end when end follows return 1.', () => {
      const pairs = parser.parse('function f()\n  return 1.\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should detect if/end with then when condition uses trailing-dot number', () => {
      const pairs = parser.parse('if 2. then\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should still detect identifier.end as field access', () => {
      const pairs = parser.parse('if true then\n  x = a1.\nend');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression 2026-04-29: shebang and goto label', () => {
    test('should treat shebang line as excluded region', () => {
      const pairs = parser.parse('#!/path/to/do/lua\nend');
      assertNoBlocks(pairs);
    });
    test('should treat goto end as label, not as block close', () => {
      const pairs = parser.parse('function f()\n  if condition then\n    goto end\n  end\nend');
      assertBlockCount(pairs, 2);
      const fnPair = pairs.find((p) => p.openKeyword.value === 'function');
      assert.ok(fnPair, 'function should pair with the outer end');
    });
  });

  suite('Regression: goto detection is case-sensitive', () => {
    test('should NOT treat keyword after Goto identifier as goto label', () => {
      // Lua is case-sensitive; `Goto` is a regular identifier, not the goto keyword.
      const pairs = parser.parse('x = Goto\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should NOT treat keyword after GOTO identifier as goto label', () => {
      const pairs = parser.parse('x = GOTO\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: goto without a label name should not consume the next reserved keyword', () => {
    test('should pair function/end when goto has no label and end appears on the next line (バグ2)', () => {
      // Lua spec requires a Name (identifier) after `goto`. When goto is followed
      // only by whitespace and then a reserved keyword, the goto statement is
      // incomplete; per best-effort parsing, the reserved keyword must NOT be
      // consumed as a goto target. Otherwise the surrounding function opener is
      // orphaned and produces no coloured block.
      const source = 'function f()\n  goto\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: goto label whitespace handling for form-feed and vertical-tab', () => {
    test('should treat goto end with form-feed whitespace as goto label', () => {
      const pairs = parser.parse('function f()\n  goto\fend\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should treat goto end with vertical-tab whitespace as goto label', () => {
      const pairs = parser.parse('function f()\n  goto\vend\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: isAfterGoto must respect excluded regions', () => {
    test('should detect function end when comment ends with goto', () => {
      const pairs = parser.parse('function f() -- goto\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should detect function end when comment line ends with goto', () => {
      const pairs = parser.parse('function f()\n  -- TODO: refactor with goto\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-08: isAfterGoto must reject .goto / :goto field/method access', () => {
    test('should pair function/end when self.goto is the last expression', () => {
      const pairs = parser.parse('function f()\n  return self.goto\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should pair function/end when self:goto is the method call', () => {
      const pairs = parser.parse('function f()\n  return self:goto()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should pair function/end when module.goto is the field access', () => {
      const pairs = parser.parse('function f()\n  return module.goto\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: isDoPartOfLoop should skip end after goto', () => {
    test('should pair for/end with the first end and do/end with the second when goto end appears between for and do', () => {
      // Lua labels are Names (identifiers); reserved keywords cannot be labels.
      // So `goto end` is malformed Lua and `end` is no longer treated as the
      // goto target. The for header is then incomplete, the inner `end` closes
      // `for`, and the trailing `do x = 1 end` pairs on its own as a standalone
      // do/end block. This matches the cost-minimisation principle: no orphans
      // are produced for either reading, and the new structure recognises both
      // keyword pairs that the user typed.
      const pairs = parser.parse('for goto end do x = 1 end');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'do');
    });

    test('should pair for...end when goto-targeted keyword appears in loop header', () => {
      // `until` only closes `repeat`, so an `until` without a matching `repeat`
      // is silently dropped during matchBlocks. The remaining tokens (for, do,
      // end) therefore still pair as a single for/end block (do is classified
      // as the loop's do).
      const pairs = parser.parse('for goto until do x = 1 end');
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should pair while/end with the first end and do/end with the second when goto end appears between while and do', () => {
      // Same shape as the `for goto end do ... end` case above.
      const pairs = parser.parse('while goto end do x = 1 end');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
      findBlock(pairs, 'do');
    });
  });

  suite('Regression: isAfterGoto must reject keywords preceded by Unicode-letter identifier ending in goto', () => {
    test('should treat αgoto as identifier and pair do/end after it', () => {
      const pairs = parser.parse('αgoto\ndo print(1) end');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should pair both for/end and inner do/end when αgoto appears between them', () => {
      const pairs = parser.parse('for i = 1, 10 do\n  αgoto\n  do\n    print(i)\n  end\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'do');
    });
  });

  suite('Regression: isDoPartOfLoop should cache loop positions per source', () => {
    test('should cache loop positions after parse (not recompute per do keyword)', () => {
      // Bug: isDoPartOfLoop rebuilt loopMatches via matchAll(prefix) on every
      // `do` keyword, yielding super-quadratic total work as the prefix grew.
      // The fix caches the filtered for/while position list per source; each
      // call to isDoPartOfLoop then binary-searches the cached positions in
      // O(log L) instead of rescanning the prefix in O(L).
      // We verify the cache is populated and contains every for/while in the
      // source. This pins the contract behind the perf fix without relying on
      // wall-clock timing assertions (V8 JIT can mask the quadratic behavior
      // in the test env, making timing-based assertions unreliable).
      const source = 'for i = 1, 10 do print(i) end\nwhile cond do break end\ndo x = 1 end';
      parser.parse(source);
      type CacheT = { source: string; positions: number[]; lengths: number[] } | null;
      const cache = (parser as unknown as { loopPositionCache: CacheT }).loopPositionCache;
      assert.ok(cache !== null, 'loopPositionCache must be populated after parse');
      assert.strictEqual(cache.source, source, 'cache must be keyed by source string');
      // The source contains exactly two for/while keywords (one for, one while)
      assert.strictEqual(cache.positions.length, 2, 'cache must hold both loop keywords');
      assert.strictEqual(cache.lengths[0], 3, 'first match is `for`');
      assert.strictEqual(cache.lengths[1], 5, 'second match is `while`');
    });

    test('should reuse cache across repeat parses of the same source', () => {
      const source = 'for i = 1, 10 do x = 1 end';
      parser.parse(source);
      type CacheT = { source: string; positions: number[]; lengths: number[] } | null;
      const cache1 = (parser as unknown as { loopPositionCache: CacheT }).loopPositionCache;
      assert.ok(cache1 !== null && cache1 !== undefined, 'cache must be populated after first parse');
      parser.parse(source);
      const cache2 = (parser as unknown as { loopPositionCache: CacheT }).loopPositionCache;
      // Same source -> cache must be reused (object identity preserved)
      assert.strictEqual(cache1, cache2, 'parsing the same source twice must reuse the cache');
    });

    test('should rebuild cache when source changes', () => {
      const sourceA = 'for i = 1, 10 do x = 1 end';
      const sourceB = 'while cond do x = 1 end';
      parser.parse(sourceA);
      type CacheT = { source: string; positions: number[]; lengths: number[] } | null;
      const cacheA = (parser as unknown as { loopPositionCache: CacheT }).loopPositionCache;
      parser.parse(sourceB);
      const cacheB = (parser as unknown as { loopPositionCache: CacheT }).loopPositionCache;
      assert.notStrictEqual(cacheA, cacheB, 'changing source must invalidate the cache');
      assert.ok(cacheB, 'cacheB must exist after parsing sourceB');
      assert.strictEqual(cacheB.source, sourceB);
      assert.strictEqual(cacheB.lengths[0], 5, 'cache for sourceB must reflect `while`');
    });
  });

  suite('Regression: trailing-dot heuristic must validate Lua number prefix', () => {
    test('should treat 1A.end as field access, not as a numeric literal trailing dot', () => {
      // Bug: the trailing-dot heuristic walked back over [a-zA-Z0-9_] and
      // accepted any range starting with a digit as a number prefix. `1A` is
      // not a valid Lua number (hex needs `0x` prefix), so `1A.end` is just
      // an identifier `1A` followed by field-access `.end`. With the bug,
      // `end` was treated as a real block close keyword and paired with
      // `function`, leaving the actual closing `end` as orphan.
      const pairs = parser.parse('function f()\n  return 1A.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      // The `end` that closes `function` is on line 2 (the trailing one),
      // not the `end` inside `1A.end` on line 1.
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 9X.if as field access on identifier 9X', () => {
      const pairs = parser.parse('function f()\n  return 9X.if\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should treat 1aZ.end as field access (Z breaks hex prefix validity)', () => {
      // `1aZ` is not a valid Lua number (Z is not hex, no `0x` prefix), so
      // `.end` is field access regardless of the leading digits/hex letters.
      const pairs = parser.parse('function f()\n  return 1aZ.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat 1.end as trailing-dot decimal numeric literal', () => {
      // Control: `1.` is a valid Lua number, so `1.end` is `1.` followed by
      // a stray `end` keyword. The dot must not be treated as field access.
      const pairs = parser.parse('function f()\n  return 1.end\nend');
      // `end` on line 1 closes `function`; the trailing `end` on line 2 is orphan.
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });

    test('should still treat 0x1A.end as trailing-dot hex numeric literal', () => {
      // Control: `0x1A.` is a valid Lua hex number prefix.
      const pairs = parser.parse('function f()\n  return 0x1A.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });
  });

  suite('Regression: trailing-dot heuristic must reject second dot when number already has one', () => {
    test('should treat 3.14.end as field access (3.14 already has a decimal point)', () => {
      // Bug: the walk-back heuristic stopped at `.`, so for `3.14.end` it only
      // saw `14` (digit-only) and accepted it as a numeric prefix. But `3.14.`
      // has TWO decimal points, which is invalid Lua. The trailing `.` is
      // field access, so `end` after it is not a real keyword.
      // Fix: extend the walk through `.` so we see the full numeric context
      // (`3.14`); the validation regex then rejects it for having an embedded `.`.
      const pairs = parser.parse('function f()\n  return 3.14.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 0.5.end as field access (already has decimal point)', () => {
      const pairs = parser.parse('function f()\n  return 0.5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat .5.end as field access (already has decimal point)', () => {
      // `.5` is a valid Lua decimal (= 0.5), but `.5.` adds a second dot.
      const pairs = parser.parse('function f()\n  return x = .5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression: trailing-dot heuristic must reject exponent forms with explicit sign', () => {
    // Bug: the walk-back loop in isPrecededByDotOrColon only stepped through
    // [a-zA-Z0-9_.] characters, so `+` and `-` inside an exponent (e.g. `1e+5`)
    // halted the walk early. For `1e+5.end`, walk-back from the dot saw only
    // `5` and accepted it as a numeric prefix, so `.end` was not field access
    // and the inner `end` was treated as a real block close. The outer `end`
    // was then orphaned and `function` got paired with the wrong `end`.
    // Fix: when walk-back hits a `+`/`-` whose preceding character is `e`/`E`
    // (decimal exponent) or `p`/`P` (hex exponent), step over the sign so the
    // validation regex sees the full numeric context. The regex itself stays
    // strict (`[0-9]+` or `0[xX][0-9a-fA-F]+`), so prefixes containing `e+`,
    // `p-`, etc. are correctly rejected as non-numeric.
    test('should treat 1e+5.end as field access (1e+5. is invalid Lua)', () => {
      // Lua forbids a fractional part after the exponent (`1e+5.` is invalid),
      // so `.end` here is field access on whatever `1e+5` denotes textually.
      // The trailing `end` on the third line must close `function`, not the
      // dropped `end` inside `1e+5.end` on the second line. line indices are
      // 0-based, so the third line of source is line 2.
      const pairs = parser.parse('function f()\n  return 1e+5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 1e-5.end as field access (negative exponent sign)', () => {
      const pairs = parser.parse('function f()\n  return 1e-5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 1E+5.end as field access (uppercase exponent marker)', () => {
      const pairs = parser.parse('function f()\n  return 1E+5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 0x1p+5.end as field access (hex exponent with sign)', () => {
      // Hex exponent uses `p`/`P`; `0x1p+5` is a valid Lua hex float literal,
      // but the trailing `.end` cannot be a fractional part of the literal
      // (the exponent has already terminated it). So `.end` is field access.
      const pairs = parser.parse('function f()\n  return 0x1p+5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat 0x1P-5.end as field access (uppercase hex exponent with negative sign)', () => {
      const pairs = parser.parse('function f()\n  return 0x1P-5.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat 1.end as trailing-dot numeric literal (no exponent involved)', () => {
      // Control: no exponent sign, so the fix must not regress the existing
      // happy path where `1.` is a valid numeric prefix. The inner `end` (on
      // line 1, 0-indexed) closes `function` here because the dot is treated
      // as a numeric trailing dot.
      const pairs = parser.parse('function f()\n  return 1.end\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });
  });

  suite('Regression: isPrecededByDotOrColon must reject leading colon for malformed label-like sequences', () => {
    // Bug: when a keyword was preceded (after whitespace) by a single `:` whose
    // own predecessor was an identifier, isPrecededByDotOrColon stopped at the
    // `:` and reported "method call colon" — dropping the keyword that follows.
    // For source like `:abc:\nif true then\nend`, the walk-back from `if`
    // skipped whitespace, landed on the second `:`, saw `c` before it (not
    // `:`), and falsely classified `if` as a method-call target. The `if` was
    // dropped from the token stream so the `if/end` pair never formed.
    // Fix: when a single `:` is found, walk back through any contiguous
    // identifier characters. If the run is bounded by another `:`, the
    // construct is an orphaned label-like sequence (`:abc:`) — not a method
    // call — and we must NOT drop the following keyword.
    test('should pair if/end when keyword is preceded by malformed :abc: label-like sequence', () => {
      const pairs = parser.parse(':abc:\nif true then\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should pair function/end when keyword is preceded by malformed :name: at file start', () => {
      const pairs = parser.parse(':name:\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should pair if/end when malformed :abc: is on the same line', () => {
      const pairs = parser.parse(':abc: if true then end');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should pair if/end when malformed :lbl: follows a semicolon', () => {
      const pairs = parser.parse('print(1); :lbl:\nif true then\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still reject genuine method call obj:end', () => {
      // Control: a real method-call colon (preceded by an identifier that is
      // NOT preceded by another `:`) must still drop the keyword. Here
      // `obj:end()` is a method call so the `end` keyword inside is not a
      // real block close.
      const pairs = parser.parse('function f()\n  obj:end()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still reject genuine method call obj:do at file start', () => {
      // Control: existing behaviour for `obj:do` is preserved (no blocks).
      // `obj` walked back lands at file-start with no preceding `:`, so the
      // colon is classified as a method-call colon and `do` is dropped.
      const pairs = parser.parse('obj:do\nend');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: isDoPartOfLoop outer scan must skip goto-target keywords', () => {
    test('should pair for/end inside function/end when goto for precedes do', () => {
      // Lua labels cannot be reserved keywords, so `goto for` is malformed Lua
      // and `for` is no longer dropped as a goto target. The `for` then opens a
      // real loop header, the following `do` becomes the loop's `do` (no
      // separate do/end pair), and the inner `end` closes the for. The outer
      // `end` pairs with the outer function. Both pairs nest properly inside
      // function.
      const pairs = parser.parse('function f()\n  goto for\n  do print(1) end\nend');
      assertBlockCount(pairs, 2);
      const fn = findBlock(pairs, 'function');
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(fn.nestLevel, 0);
      assert.strictEqual(forBlock.nestLevel, 1);
    });

    test('should pair while/end inside function/end when goto while precedes do', () => {
      const pairs = parser.parse('function f()\n  goto while\n  do print(1) end\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'function');
      findBlock(pairs, 'while');
    });
  });

  // Bug: walk-back loops in isPrecededByDotOrColon and isAfterGoto skipped
  // entire excluded regions and continued scanning the characters BEFORE the
  // region. This allowed `.`, `:`, or `goto` text on the far side of a string
  // literal, long string, comment, or goto label to leak through and falsely
  // disqualify keywords whose immediate predecessor was the excluded region.
  // Fix: treat any excluded region encountered during walk-back as a hard wall
  // and stop scanning (return false). A keyword separated from `.`/`:`/`goto`
  // by a string/long string/comment/label is NOT a field access or goto target.
  suite('Regression: walk-back must treat excluded regions as opaque walls', () => {
    test('should detect function/end when goto is followed by string literal label-like usage', () => {
      // `goto"end"` is invalid Lua syntax, but the walk-back from the next
      // `function` must NOT see `goto` through the `"end"` string and reject
      // `function` as a goto-target keyword.
      const pairs = parser.parse('goto"end"\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should detect if/then/else/end when intermediate keyword follows a string after dot', () => {
      // The `then` token is preceded (walking back) by whitespace, then a
      // string literal `"str"`, then `t.`. With the bug, walk-back sees the
      // `.` through the string and treats `then` as field access (filtered out).
      const pairs = parser.parse('if t. "str" then\n  a()\nelse\n  b()\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should detect if/then when goto label separates dot and then', () => {
      // The `then` token walks back through whitespace, then `::lbl::` (a
      // goto label / excluded region), then `t.`. With the bug, `.` leaks
      // through the label and `then` is rejected as field access.
      const pairs = parser.parse('if t.\n::lbl::\nthen a() end');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should detect function/end when goto is followed by long string label-like usage', () => {
      // Same as the string-literal case but with a long string `[[end]]`.
      const pairs = parser.parse('goto[[end]]\nfunction f()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  // Bug: isPrecededByDotOrColon's walk-back treated ALL excluded regions as
  // opaque walls (returning false). But comments are whitespace-equivalent
  // per Lua spec — a `.` followed by a comment followed by a keyword IS
  // field access on that keyword. With the bug, `t. --[[c]]end` saw `end`
  // as a real keyword (not field access), so the inner `end` was paired
  // with the enclosing `function` and the outer `end` was orphaned.
  // Fix: in isPrecededByDotOrColon's walk-back, transparently skip past
  // comment regions (jump to region.start - 1 and continue). String/long
  // string/goto label/shebang regions remain opaque walls (they are NOT
  // whitespace and a `.` on their far side does not bind through them).
  // The string/long string/label cases are pinned by the suite above.
  suite('Regression: comments must be transparent (not opaque walls) in walk-back', () => {
    test('should treat t.--[[c]]end as field access (multi-line comment is whitespace) (バグ2)', () => {
      // The inner `end` inside `t. --[[c]]end` must be recognised as field
      // access on the dot (the comment is whitespace-equivalent). Therefore
      // only the OUTER `end` (line 2) closes `function`, not the inner one.
      const source = 'function f()\n  t. --[[c]]end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function must close on outer end (line 2), not inner end');
    });

    test('should treat t. <single-line comment> end as field access (バグ2)', () => {
      // Single-line comment is also whitespace per Lua spec, so the
      // following `end` (after a newline) is field access via the dot.
      // The outer `end` on line 3 closes `function`.
      const source = 'function f()\n  t. -- comment\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function must close on outer end (line 3), not the inner end');
    });

    test('should treat t.--[[c]]then as field access (multi-line comment is whitespace)', () => {
      // The `then` inside `t.--[[c]]then` must be filtered out as field
      // access. With no `then` intermediate, `if` has no opener-shape and
      // walks unmatched; therefore no `if/end` pair exists. The orphan
      // `end` then leaves zero pairs.
      const source = 'if t.--[[c]]then\nend';
      const pairs = parser.parse(source);
      // `then` is field-accessed, so `if` lacks its intermediate. Whether
      // the if/end pair still forms is irrelevant; the key assertion is
      // that no `then` intermediate is attached.
      if (pairs.length > 0) {
        const ifPair = findBlock(pairs, 'if');
        assertIntermediates(ifPair, []);
      }
    });

    test('should treat t:--[[c]]end as method call (colon, multi-line comment)', () => {
      // Same shape but with `:` (method call) instead of `.` (field access).
      // Comment must still be transparent; inner `end` is a method-name token.
      const source = 'function f()\n  t:--[[c]]end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat string between . and keyword as opaque wall (control)', () => {
      // Regression guard: strings must remain opaque walls. `t."str"then`
      // attaches `then` to `if` (not as field access through the string).
      const pairs = parser.parse('if t. "str" then\n  a()\nelse\n  b()\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should still treat goto label between . and keyword as opaque wall (control)', () => {
      // Regression guard: goto labels must remain opaque walls.
      const pairs = parser.parse('if t.\n::lbl::\nthen a() end');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should treat long-string-comment --[==[c]==]end as field access', () => {
      // Long-bracket comment with equal signs is also a comment region and
      // must be transparent in walk-back.
      const source = 'function f()\n  t. --[==[c]==]end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat multiple comments between . and end as transparent', () => {
      // Chained comments: walk-back must skip across more than one region.
      const source = 'function f()\n  t. --[[a]] --[[b]] end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression: isDoPartOfLoop must not be super-quadratic for loops mixed with standalone do', () => {
    // Bug: isDoPartOfLoop's forward scan was O(N^2)-O(N^3) for files mixing
    // loops with standalone `do` blocks. Each standalone `do` belongs to no
    // for/while, so the outer loop scanned every preceding for/while, and each
    // iteration did a full source.slice + matchAll. With N=300 (~28KB) this
    // took ~6s; with N=800 ~24s+, effectively hanging the parser.
    //
    // The fix classifies every `do` in a single O(N) pass over pre-computed
    // keyword positions, cached per source (doClassificationCache). The two
    // tests below pin the fix from complementary angles:
    //   1. a wall-clock ceiling that the O(N^3) version blew past by ~30x;
    //   2. a cache-contract assertion that fails if the per-`do` rescan
    //      returns (timing-independent, robust against JIT / CI jitter).
    function buildMixedSource(repeats: number): string {
      // Each unit: one loop `do...end` plus one standalone `do...end`.
      return 'for i=1,1 do end\ndo x=1 end\n'.repeat(repeats);
    }

    test('should parse ~28KB of loops mixed with standalone do without super-quadratic slowdown', () => {
      // N=800 (~28KB) took ~61s with the O(N^3) bug; the linearized version is
      // a few hundred ms. An 8000ms ceiling is generous for coverage
      // instrumentation and slow/contended CI while still failing by a wide
      // margin if the cubic scan returns.
      const source = buildMixedSource(800);
      // Warm-up to stabilize against JIT and module init.
      parser.parse(source);
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      // Each unit contributes exactly 2 block pairs (loop do/end + standalone do/end)
      assertBlockCount(pairs, 1600);
      assert.ok(elapsed < 8000, `parse took ${elapsed}ms, expected < 8000ms (super-quadratic regression)`);
    });

    test('should classify every do once via a per-source cache, not rescan per do keyword', () => {
      // The O(N^3) bug came from re-deriving each `do`'s loop membership by
      // re-scanning the prefix on every `do`. The fix builds the full
      // classification in one O(N) pass and caches it by source identity.
      // We assert the cache is populated and classifies every `do` correctly,
      // pinning the contract behind the perf fix without timing assertions.
      const source = buildMixedSource(3);
      parser.parse(source);
      type CacheT = { source: string; classification: Map<number, boolean> } | null;
      const cache = (parser as unknown as { doClassificationCache: CacheT }).doClassificationCache;
      assert.ok(cache !== null, 'doClassificationCache must be populated after parse');
      assert.strictEqual(cache.source, source, 'cache must be keyed by source string');
      // 3 units => 6 `do` keywords: 3 loop dos (true) + 3 standalone dos (false)
      assert.strictEqual(cache.classification.size, 6, 'every do keyword must be classified');
      const values = [...cache.classification.values()];
      assert.strictEqual(values.filter((v) => v === true).length, 3, 'three loop dos');
      assert.strictEqual(values.filter((v) => v === false).length, 3, 'three standalone dos');
    });

    test('should reuse the do-classification cache across repeat parses of the same source', () => {
      const source = buildMixedSource(2);
      parser.parse(source);
      type CacheT = { source: string; classification: Map<number, boolean> } | undefined;
      const cache1 = (parser as unknown as { doClassificationCache: CacheT }).doClassificationCache;
      // Reject undefined too: without the fix the field does not exist at all,
      // so this also pins that the cache mechanism is actually present.
      assert.ok(cache1 !== null && cache1 !== undefined, 'doClassificationCache must be populated after first parse');
      parser.parse(source);
      const cache2 = (parser as unknown as { doClassificationCache: CacheT }).doClassificationCache;
      assert.strictEqual(cache1, cache2, 'parsing the same source twice must reuse the cache');
    });
  });

  suite('Regression: intermediates inside an open repeat must attach to the enclosing if', () => {
    // Bug: matchBlocks unconditionally pushed every block_middle (then/else/
    // elseif) onto the topmost stack entry. When a `repeat` block is open on
    // top of an `if`, an else/elseif/then that semantically belongs to the
    // `if` was wrongly attached to the `repeat`'s intermediates. `then`,
    // `else` and `elseif` are if-block section boundaries; `repeat` cannot
    // own them. The fix routes the middle keyword to the topmost non-repeat
    // opener (mirroring how `end` skips `repeat` to close the block below it).
    test('should attach else to the enclosing if, not to an open repeat', () => {
      const source = 'if a then\nrepeat\nelse\nuntil x\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      // The `else` belongs to if..end, alongside `then`
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end');
      assertIntermediates(ifBlock, ['then', 'else']);
      // The repeat..until pair owns no intermediates
      const repeatBlock = findBlock(pairs, 'repeat');
      assert.strictEqual(repeatBlock.closeKeyword.value, 'until');
      assertIntermediates(repeatBlock, []);
    });

    test('should attach elseif to the enclosing if, not to an open repeat', () => {
      const source = 'if a then\nrepeat\nelseif b then\nuntil x\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      // `then`, `elseif` and the elseif's `then` all belong to the if block
      assertIntermediates(ifBlock, ['then', 'elseif', 'then']);
      const repeatBlock = findBlock(pairs, 'repeat');
      assertIntermediates(repeatBlock, []);
    });

    test('should attach else to the inner if when an if encloses a repeat above an outer if', () => {
      // Outer if -> inner if -> repeat (all open). The `else` must land on the
      // inner if (closest non-repeat opener), not on the repeat above it.
      const source = 'if a then\nif b then\nrepeat\nelse\nuntil x\nend\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const repeatBlock = findBlock(pairs, 'repeat');
      assertIntermediates(repeatBlock, []);
      // Exactly one if block carries the `else`; the other carries only `then`
      const ifBlocks = pairs.filter((p) => p.openKeyword.value === 'if');
      assert.strictEqual(ifBlocks.length, 2);
      const withElse = ifBlocks.filter((p) => p.intermediates.some((t) => t.value === 'else'));
      assert.strictEqual(withElse.length, 1, 'exactly one if block should own the else');
    });

    test('should still attach else to a top-of-stack repeat-free if block', () => {
      // Sanity check: with no repeat on the stack, behavior is unchanged.
      const source = 'if a then\nelse\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'else']);
    });
  });

  suite('Regression: then/else/elseif must only attach to if/elseif openers', () => {
    // Bug: `then`/`else`/`elseif` are if-block section boundaries and only
    // belong to `if` or `elseif` openers. The previous implementation routed
    // every middle keyword to the topmost non-repeat opener regardless of its
    // block kind, so invalid constructs like `while x then end`, `function f()
    // else end`, `for i = 1,2 do else end`, and `do then end` wrongly attached
    // the middle keyword to the enclosing while/function/for/do block. The
    // fix drops the middle keyword when the chosen opener is not an if or
    // elseif, matching the language spec (then/else/elseif have no meaning
    // outside an if-chain).
    test('should drop then when the enclosing opener is while', () => {
      const source = 'while x then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should drop else when the enclosing opener is function', () => {
      const source = 'function f()\nelse\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should drop else when the enclosing opener is for', () => {
      const source = 'for i = 1, 2 do\nelse\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should drop then when the enclosing opener is a standalone do block', () => {
      const source = 'do then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should drop elseif when the enclosing opener is while', () => {
      const source = 'while x do\nelseif y then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
      // The elseif's own `then` is also a middle keyword with no enclosing
      // if/elseif on the stack, so it too must be dropped.
      assertIntermediates(pairs[0], []);
    });

    test('should still attach then to an elseif opener', () => {
      // elseif owns the following `then` for the elseif arm body
      const source = 'if a then\nelseif b then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['then', 'elseif', 'then']);
    });

    test('should attach else to an inner if even when an invalid outer while is open', () => {
      // Outer while (cannot own else) wraps an inner if-else-end. The else
      // must land on the inner if, and the while's intermediates must remain
      // empty.
      const source = 'while x do\nif a then\nelse\nend\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assertIntermediates(ifBlock, ['then', 'else']);
      const whileBlock = findBlock(pairs, 'while');
      assertIntermediates(whileBlock, []);
    });
  });

  generateCommonTests(config);
});
