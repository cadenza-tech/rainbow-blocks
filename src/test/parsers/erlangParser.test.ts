import * as assert from 'node:assert';
import { ErlangBlockParser } from '../../parsers/erlangParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('ErlangBlockParser Test Suite', () => {
  let parser: ErlangBlockParser;

  setup(() => {
    parser = new ErlangBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'foo() -> ok.',
    tokenSource: 'if true ->\n  ok\nend',
    expectedTokenValues: ['if', 'end'],
    excludedSource: '% comment\n"string"',
    expectedRegionCount: 2,
    twoLineSource: 'begin\nend',
    singleLineCommentSource: 'begin\n  % if end\nend',
    commentBlockOpen: 'begin',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'begin\n  "if end"\nend',
    stringBlockOpen: 'begin',
    stringBlockClose: 'end'
  };

  suite('Simple blocks', () => {
    test('should parse simple begin-end block', () => {
      const source = `begin
  X = 1,
  Y = 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse if-end block', () => {
      const source = `if
  X > 0 -> positive;
  true -> non_positive
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse case-end block', () => {
      const source = `case X of
  1 -> one;
  2 -> two;
  _ -> other
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should parse receive-end block', () => {
      const source = `receive
  {msg, Data} -> process(Data);
  stop -> exit(normal)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
    });

    test('should parse try-end block', () => {
      const source = `try
  risky_operation()
catch
  error:Reason -> handle_error(Reason)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should parse fun-end block', () => {
      const source = `fun(X) ->
  X * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should parse maybe-end block', () => {
      const source = `maybe
  {ok, Value} ?= get_value(),
  process(Value)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'maybe', 'end');
    });
  });

  suite('Expression blocks', () => {
    test('should parse fun assigned to variable', () => {
      const source = 'Double = fun(X) -> X * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should parse begin block in function', () => {
      const source = `foo() ->
  Result = begin
    X = compute(),
    X + 1
  end,
  Result.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse case with of', () => {
      const source = `case Value of
  ok -> success;
  error -> failure
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should parse receive with after', () => {
      const source = `receive
  {msg, Data} -> process(Data)
after
  5000 -> timeout
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assertIntermediates(pairs[0], ['after']);
    });

    test('should parse try with catch', () => {
      const source = `try
  dangerous()
catch
  throw:Term -> handle_throw(Term);
  exit:Reason -> handle_exit(Reason);
  error:Error -> handle_error(Error)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should parse try with of and catch', () => {
      const source = `try compute() of
  {ok, Result} -> Result;
  {error, _} -> default
catch
  _:_ -> error
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['of', 'catch']);
    });

    test('should parse try with catch and after', () => {
      const source = `try
  file:open(Name, [read])
catch
  error:_ -> undefined
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch', 'after']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested begin blocks', () => {
      const source = `begin
  begin
    inner
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      const innerBlocks = pairs.filter((p) => p.nestLevel === 1);
      assertBlockCount(innerBlocks, 1);
    });

    test('should parse nested case in if', () => {
      const source = `if
  X > 0 ->
    case X of
      1 -> one;
      _ -> other
    end;
  true -> zero
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse multiple levels of nesting', () => {
      const source = `try
  case receive
    {msg, Data} ->
      begin
        process(Data)
      end
  end of
    ok -> success;
    _ -> failure
  end
catch
  _:_ -> error
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });
  });

  suite('Excluded regions', () => {
    generateExcludedRegionTests(config);

    test('should skip keywords in single-quoted atoms', () => {
      const source = `begin
  A = 'if case receive end',
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `begin
  S = "end \\"end\\" more end",
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle escaped quotes in atoms', () => {
      const source = `begin
  A = 'end \\'end\\' more end',
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multiple comments', () => {
      const source = `begin
  % comment with begin
  X = 1,
  % comment with end
  Y = 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle comment at end of line with code', () => {
      const source = `begin
  X = 1 % if this is not end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Excluded regions - Character literals', () => {
    test('should handle $ character literal before string quote', () => {
      const source = '$" ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle $ character literal before comment', () => {
      const source = '$% begin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle $ character literal before atom quote', () => {
      const source = "$' begin\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle $ with escape character', () => {
      const source = '$\\ begin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle $ at end of source', () => {
      const regions = parser.getExcludedRegions('$');
      assert.strictEqual(regions.length, 0);
    });

    test('should handle $\\x{HH} hex escape with braces', () => {
      const source = '$\\x{41} ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\x{41}');
    });

    test('should handle $\\x{HHHH} multi-digit hex escape with braces', () => {
      const source = '$\\x{1F600} ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\x{1F600}');
    });

    test('should handle $\\xHH hex escape without braces', () => {
      const source = '$\\x41 ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\x41');
    });

    test('should handle $\\OOO octal escape', () => {
      const source = '$\\123 ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\123');
    });

    test('should handle $\\^X control character escape', () => {
      const source = '$\\^A ++ begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\^A');
    });

    test('should not over-consume with $\\x followed by non-hex', () => {
      const source = '$\\x begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      // $\x with no hex digits - just the 3-char escape
      assert.strictEqual(source.slice(charRegion.start, charRegion.end), '$\\x');
    });

    test('should handle surrogate pair character literal', () => {
      const source = '$\u{1F600} begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      const charRegion = regions[0];
      assert.strictEqual(charRegion.end - charRegion.start, 3);
    });

    test('should handle surrogate pair character literal before block keyword', () => {
      const source = '$\u{1F4A9}begin end';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions[0].end, 3);
    });
  });

  suite('Catch expression prefix', () => {
    test('should not treat catch expression as intermediate', () => {
      const pairs = parser.parse('begin\n  X = catch throw(hello),\n  Y\nend');
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat catch as intermediate in try block', () => {
      const pairs = parser.parse('try\n  risky()\ncatch\n  error -> ok\nend');
      assertSingleBlock(pairs, 'try', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'catch');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle unmatched begin', () => {
      assertNoBlocks(parser.parse('begin X = 1'));
    });

    test('should handle unmatched end', () => {
      assertNoBlocks(parser.parse('end'));
    });

    test('should handle unterminated string', () => {
      const source = `begin
  S = "unterminated string
end`;
      const pairs = parser.parse(source);
      // Unterminated string extends to EOF, so no pairs detected
      assertNoBlocks(pairs);
    });

    test('should handle unterminated atom', () => {
      const source = `begin
  A = 'unterminated atom
end`;
      const pairs = parser.parse(source);
      // Unterminated atom stops at newline, so begin/end pairs detected
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle keyword-like identifiers', () => {
      const source = `begin
  Begin = 1,
  End = 2,
  If_value = 3
end`;
      const pairs = parser.parse(source);
      // Keywords are case-sensitive in Erlang, Begin != begin
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle deeply nested blocks', () => {
      const source = `begin
  begin
    begin
      begin
        begin
          deep
        end
      end
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
    });
  });

  suite('Fun references', () => {
    test('should not parse fun Module:Function/Arity as block', () => {
      const source = `F = fun lists:map/2,
begin
  X = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not parse fun Function/Arity as block', () => {
      const source = `F = fun my_func/1,
begin
  X = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse fun block (anonymous function)', () => {
      const source = 'F = fun(X) -> X * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should parse fun with pattern matching', () => {
      const source = `F = fun
  (0) -> zero;
  (N) -> N
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('maybe-else-end (OTP 25+)', () => {
    test('should parse maybe-end block', () => {
      const source = `maybe
  {ok, Value} ?= get_value()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'maybe', 'end');
    });

    test('should parse maybe-else-end block with else as intermediate', () => {
      const source = `maybe
  {ok, Value} ?= get_value()
else
  {error, Reason} -> handle_error(Reason)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'maybe', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Bare atoms as map keys', () => {
    test('should not treat begin in map key as block keyword', () => {
      const source = `#{begin => 1}
begin
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat case or end in map keys as keywords', () => {
      const source = `#{case => value, end => done}
begin
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Fun in specs', () => {
    test('should not treat fun in spec as block opener', () => {
      const source = `-spec foo(fun()) -> ok.
begin
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat fun in type as block opener', () => {
      const source = `-type handler() :: fun((atom()) -> ok).
begin
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat fun in callback as block opener', () => {
      const source = `-callback init(Args) -> {ok, fun()}.
begin
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still parse regular fun block', () => {
      const source = 'fun() -> ok end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('Of intermediate restriction', () => {
    test('should not treat of as intermediate of begin', () => {
      const source = `begin
  of
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat of as intermediate of case', () => {
      const source = `case X of
  1 -> ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should not treat of as intermediate of if', () => {
      const source = `if
  X > 0 ->
    of
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });
  });

  suite('Triple-quoted strings (OTP 27+)', () => {
    test('should ignore keywords in triple-quoted strings', () => {
      const source = `begin
  X = """
  begin if case end
  """,
  Y = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle unterminated triple-quoted string', () => {
      const source = `begin
  X = """
  begin if case end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: fun type in nested spec context', () => {
    test('should not treat fun() in nested spec context as block', () => {
      const pairs = parser.parse('-spec foo() -> fun((integer()) -> boolean()).\nbegin\n  ok\nend.');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('fun() scope after period-separated declarations', () => {
    test('should treat fun() as block opener after period ends spec', () => {
      const source = `-spec foo() -> integer().

bar() ->
  F = fun() -> ok end,
  F.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should treat fun() as block opener after period ends type', () => {
      const source = `-type my_fun() :: fun((integer()) -> boolean()).

baz() ->
  fun(X) -> X + 1 end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should not treat fun() in same spec as block opener', () => {
      const source = '-spec callback() -> fun(() -> ok).';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Period in excluded region should not end spec context', () => {
    test('should not treat fun() as block when period is in string before it', () => {
      // The period inside the string "foo.bar" should not be treated as
      // a declaration-ending period that separates spec from fun()
      const source = '-spec handler(string()) -> fun(() -> ok).';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat fun() as block when period is in comment before it', () => {
      // Period in a comment between spec and fun should not end the spec context
      const source = `-spec foo() ->
  %% Returns a fn. See docs
  fun(() -> ok).`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat fun() as block when period is in atom before it', () => {
      // Period inside a quoted atom should not end the spec context
      const source = `-type my_type() :: {'result.ok', fun(() -> ok)}.`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat fun() as block when real period separates declarations', () => {
      // A real period (not in comment/string/atom) ends the spec context
      const source = `-spec foo() -> integer().
bar() ->
  fun() -> ok end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('fun() in multi-line spec with arrow', () => {
    test('should not treat fun() in multi-line spec with -> as block', () => {
      // The -> contains '-' which previously confused lastIndexOf('-')
      const source = '-spec foo() ->\n  fun(() -> ok).';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat fun() in multi-line callback with -> as block', () => {
      const source = '-callback handle(Arg) ->\n  fun((term()) -> ok).';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still treat fun() as block opener outside spec', () => {
      const source = 'foo() ->\n  F = fun() -> ok end,\n  F.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('Intermediate keyword validation by block type', () => {
    test('should not accept after as intermediate for begin block', () => {
      const source = `begin
  X = 1
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not accept after as intermediate for case block', () => {
      const source = `case X of
  1 -> ok
after
  cleanup()
end`;
      // case...end gets 'of' but not 'after'
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should not accept after as intermediate for if block', () => {
      const source = `if
  X > 0 -> ok
after
  timeout
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not accept after as intermediate for fun block', () => {
      const source = `fun() ->
  X = 1
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should accept after as intermediate for receive block', () => {
      const source = `receive
  {msg, Data} -> ok
after
  5000 -> timeout
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assertIntermediates(pairs[0], ['after']);
    });

    test('should accept after as intermediate for try block', () => {
      const source = `try
  risky()
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['after']);
    });

    test('should not accept else as intermediate for begin block', () => {
      const source = `begin
  X = 1
else
  Y = 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not accept else as intermediate for case block', () => {
      const source = `case X of
  1 -> ok
else
  default
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should not accept else as intermediate for receive block', () => {
      const source = `receive
  {msg, Data} -> ok
else
  default
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not accept else as intermediate for fun block', () => {
      const source = `fun() ->
  X = 1
else
  default
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should accept else as intermediate for maybe block', () => {
      const source = `maybe
  {ok, V} ?= get()
else
  {error, R} -> handle(R)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'maybe', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should accept else as intermediate for if block', () => {
      // Erlang if with else (OTP 25+)
      const source = `if
  X > 0 -> ok
else
  error
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should accept else as intermediate for try block', () => {
      const source = `try
  risky()
else
  default
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Of intermediate restriction for receive', () => {
    test('should not treat of as intermediate of receive', () => {
      const source = `receive
  of
  {msg, Data} -> ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat of as intermediate of try', () => {
      const source = `try compute() of
  {ok, R} -> R
catch
  _:_ -> error
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['of', 'catch']);
    });
  });

  suite('Multi-byte escapes in atoms', () => {
    test('should handle \\x27 (single quote) hex escape in atom', () => {
      // \x27 is the hex code for single quote character
      // The atom 'hello\x27world' should be treated as one atom
      const source = `'hello\\x27world' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'hello\\x27world'");
    });

    test('should handle \\x{27} hex escape with braces in atom', () => {
      const source = `'hello\\x{27}world' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'hello\\x{27}world'");
    });

    test('should handle \\047 octal escape (single quote) in atom', () => {
      // \047 is the octal code for single quote character
      const source = `'hello\\047world' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'hello\\047world'");
    });

    test('should handle \\x{1F600} unicode escape in atom', () => {
      const source = `'emoji\\x{1F600}atom' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'emoji\\x{1F600}atom'");
    });

    test('should handle control character escape in atom', () => {
      const source = `'ctrl\\^Achar' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'ctrl\\^Achar'");
    });

    test('should handle atom with keywords and hex escape for quote', () => {
      // Atom contains 'end' keyword but it is inside the atom
      const source = `'begin\\x27end' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multiple escape types in single atom', () => {
      const source = `'\\x41\\047\\x{42}' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'\\x41\\047\\x{42}'");
    });

    test('should handle basic escape in atom still works', () => {
      const source = `'it\\'s ok' begin end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('fun() with -spec in string', () => {
    test('should not reject fun() when -spec appears in a string', () => {
      const source = `foo() ->
  S = "-spec bar() -> ok.",
  F = fun() -> ok end,
  F.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('Triple-quoted string escape', () => {
    test('should handle backslash before triple quote in middle of line', () => {
      const pairs = parser.parse('begin\n  S = """\n  escaped: \\"""\n  more\n  """,\n  ok\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not close triple-quoted string at non-line-start triple quote', () => {
      const regions = parser.getExcludedRegions('"""\nfoo """bar\n"""');
      // Should close at the last """ (line start), not the middle one
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, 18);
    });
  });

  suite('CR-only line ending in isValidBlockOpen', () => {
    test('should detect -spec on same line with CR-only endings', () => {
      // With \r-only line endings, lastIndexOf('\n') would miss \r
      const source = '-spec foo() -> fun(() -> ok).\rbegin\r  ok\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject fun in -spec with CR-only line endings', () => {
      const source = '-spec bar() -> fun(() -> ok).';
      const crSource = source.replace(/\n/g, '\r');
      const pairs = parser.parse(crSource);
      assertNoBlocks(pairs);
    });

    test('should reject fun in -type with CR-only line endings', () => {
      const source = '-type handler() :: fun((atom()) -> ok).';
      const crSource = source.replace(/\n/g, '\r');
      const pairs = parser.parse(crSource);
      assertNoBlocks(pairs);
    });
  });

  suite('Token positions - language-specific', () => {
    test('should report correct line and column for single line', () => {
      const source = 'begin X end';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 0, 8);
    });

    test('should report correct column with leading spaces', () => {
      const source = '  begin X end';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 2);
      assertTokenPosition(pairs[0].closeKeyword, 0, 10);
    });
  });

  suite('Quoted atom module in fun reference', () => {
    test('should not treat fun with quoted atom module as block opener', () => {
      const source = `F = fun 'my.module':handler/2,
begin
  ok
end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle escaped quotes in quoted atom module name', () => {
      const source = `F = fun 'module\\'name':func/1,
begin
  ok
end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multiple escaped quotes in quoted atom module', () => {
      const source = `F = fun 'it\\'s a \\'module\\'':handler/2,
begin
  ok
end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle escaped backslash before quote in atom module', () => {
      const source = `F = fun 'mod\\\\':func/1,
begin
  ok
end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 8: fun() in -record should be recognized as block', () => {
      const source = '-record(state, {handler = fun() -> ok end}).';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('Bug 8: fun() with args in -record should be recognized', () => {
      const source = `-record(config, {
  callback = fun(X) -> X * 2 end
}).`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test("Bug 9: fun 'quoted-atom'/Arity should not create block", () => {
      const source = "F = fun 'my-helper'/1,\nreceive\n  Msg -> ok\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
    });

    test("Bug 9: fun 'quoted-atom-with-escape'/N should not create block", () => {
      const source = "F = fun 'it\\'s-ok'/2,\nif\n  true -> ok\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Uncovered line coverage', () => {
    // Covers lines 96-98: keywords preceded by . (record field access)
    test('should reject keyword preceded by dot (record field access)', () => {
      const source = 'begin\n  X = State.end,\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject begin preceded by dot as record field', () => {
      const source = 'begin\n  Y = Rec.begin,\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject if preceded by dot as record field', () => {
      const source = 'begin\n  Z = Config#state.if,\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    // Covers lines 100-108: keywords preceded by - at line start (preprocessor directives)
    test('should reject keyword preceded by - at line start (preprocessor -if)', () => {
      const source = '-if(FEATURE).\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject -else preprocessor directive', () => {
      const source = '-else.\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject -end preprocessor directive', () => {
      const source = '-end.\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject -if with indented whitespace before hyphen', () => {
      const source = '  -if(DEBUG).\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not reject keyword preceded by - mid-line (not preprocessor)', () => {
      // X = 5 - end should not filter out end as preprocessor
      const source = 'begin\n  X = 5 -end,\n  ok\nend';
      const pairs = parser.parse(source);
      // The -end mid-line has characters before it (not at line start), so it's NOT filtered
      // Two 'end' tokens found, the first is rejected by map key check (preceded by -end) but
      // actually the tokenize filter checks if - is at line start; here 5 precedes it so it passes
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Period in float literal / range operator in spec context', () => {
    test('should not treat float literal period as declaration terminator', () => {
      // -spec with float literal 1.5 between -spec and fun()
      // The period in 1.5 should NOT end the spec context
      const source = '-spec foo(float()) -> {1.5, fun(() -> ok)}.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat range operator (..) as declaration terminator', () => {
      // Range operator .. should not end the spec context
      const source = '-type range() :: {1..10, fun(() -> ok)}.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still treat real period as declaration terminator', () => {
      // A real declaration-ending period should still break the spec context
      const source = `-spec foo() -> ok.
bar() -> fun() -> ok end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should handle float literal with multiple digits around period', () => {
      const source = '-spec calc(float()) -> {3.14, fun(() -> ok)}.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle range operator in type spec with fun', () => {
      const source = '-type my_type() :: {0..255, fun((byte()) -> ok)}.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Macro invocations with ? prefix', () => {
    test('should not treat ?begin as block keyword', () => {
      const source = 'X = ?begin,\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat ?end as block keyword', () => {
      const source = 'begin\n  X = ?end,\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat ?if as block keyword', () => {
      const source = 'X = ?if,\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat ?case as block keyword', () => {
      const source = 'X = ?case,\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Record names with # prefix', () => {
    test('should not treat #begin as block keyword', () => {
      const source = 'X = #begin{field = 1},\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat #end as block keyword', () => {
      const source = 'begin\n  X = #end{field = 1},\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat #case as block keyword', () => {
      const source = 'X = #case{field = 1},\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat #try as block keyword', () => {
      const source = 'X = #try{field = 1},\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Triple-quoted string without newline', () => {
    test('should not treat """ followed by content as triple-quoted string', () => {
      // """hello" should be "" (empty string) + "hello" (regular string)
      const source = 'begin\n  X = """hello",\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still handle valid triple-quoted string with newline', () => {
      const source = 'begin\n  X = """\n  content\n  """,\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle """ followed by content containing keywords', () => {
      // """begin" should be "" + "begin" (keyword in string, not code)
      const source = '"""begin end"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle """ with spaces before content on same line', () => {
      // """  hello" - spaces after """ but content on same line
      const source = 'begin\n  X = """  hello",\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle """ at end of source', () => {
      const regions = parser.getExcludedRegions('"""');
      // At EOF, """ is valid (no content follows)
      assert.strictEqual(regions.length, 1);
    });

    test('should handle """ followed by newline as valid triple-quoted string', () => {
      const regions = parser.getExcludedRegions('"""\ncontent\n"""');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 15);
    });
  });

  suite('Map key/update across newlines', () => {
    test('should reject keyword as map key when => is on next line', () => {
      // #{begin\n  => true} - keyword used as map key with => on next line
      const source = '#{begin\n  => true}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject keyword as map key when := is on next line', () => {
      // #{begin\n  := true} - keyword used as map key with := on next line
      const source = '#{begin\n  := true}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not reject keyword when => is two lines away', () => {
      // begin followed by a blank line then => is not a map key
      const source = 'begin\n\n=> value\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still reject keyword when => is on same line', () => {
      const source = '#{begin => 1}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still reject keyword when := is on same line with spaces', () => {
      const source = '#{begin   := 1}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject keyword in isValidBlockOpen when => is on next line', () => {
      // Specifically test the isValidBlockOpen path (for block_open keywords)
      const source = '#{case\n  => value}\ncase X of\n  1 -> ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not reject normal block keyword followed by unrelated =>', () => {
      // begin block where => appears later (not immediately after keyword)
      const source = 'begin\n  X = #{key => val},\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject end keyword as map key with => on next line (tokenize filter)', () => {
      // end used as map key in multi-line map
      const source = '#{end\n  => done}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject keyword as map key with CRLF before =>', () => {
      const source = '#{begin\r\n  => true}\r\nbegin\r\n  ok\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject block_open keyword as map key with CR-only before =>', () => {
      // isValidBlockOpen path: begin followed by \r then => on next line
      const source = '#{begin\r  => true}\rbegin\r  ok\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject block_open keyword as map key with CR-only before :=', () => {
      // isValidBlockOpen path: case followed by \r then := on next line
      const source = '#{case\r  := value}\rcase X of\r  1 -> ok\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should reject block_close keyword as map key with CR-only before =>', () => {
      // tokenize filter path: end followed by \r then => on next line
      const source = '#{end\r  => done}\rbegin\r  ok\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject block_close keyword as map key with CR-only before :=', () => {
      // tokenize filter path: end followed by \r then := on next line
      const source = '#{end\r  := done}\rbegin\r  ok\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Coverage: new bug fix code paths', () => {
    test('should parse try-catch-end with catch as intermediate', () => {
      const source = 'try X catch _:_ -> ok end.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });
  });

  suite('Bug 15: map key with trailing comment before => on next line', () => {
    test('should reject begin as map key when comment precedes => on next line', () => {
      const source = '#{begin % comment\n  => value}\nbegin\n  ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should not treat fun() as block when -spec contains range operator ..', () => {
      // Lines 77-80: range operator (..) encountered in period scan: j++ then continue
      const source = '-spec foo(1..10) -> fun() -> ok end.\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // fun() in spec context is not a block; begin/end is the only pair
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat fun() as block when -spec contains float literal', () => {
      // Lines 85-87: float literal (digit.digit) encountered in period scan: continue
      const source = '-spec foo(float()) -> fun() -> ok end.\nbegin\n  3.14\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat fun() as block when .. range appears before it in -type', () => {
      // Line 81-83: second dot of .. (source[j-1] === '.') encountered: continue
      const source = '-type t() :: 1..100 | fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse maybe-else block', () => {
      // Lines 303-307: else intermediate for maybe block
      const source = 'maybe\n  ok\nelse\n  error\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'maybe', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Coverage: period scan branches in isValidFunOpen', () => {
    test('should skip range operator first dot and advance past second dot', () => {
      // Lines 77-80: first dot of .. detected, j incremented past second dot, continue
      // The fun() after the range should still be rejected (no period separator from -spec)
      const source = '-spec foo(1..10) -> fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // fun() in -spec context is not a block (range does not act as separator)
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip float literal period between -spec and fun', () => {
      // Lines 85-87: digit.digit detected as float literal, period is not declaration terminator
      const source = '-spec baz(3.14) -> fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // Float period doesn't terminate spec context -> fun() still rejected
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip range operator when it appears right after attribute', () => {
      // Lines 77-80: range operator directly in the spec definition
      const source = '-type byte_range() :: 0..255 | fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multiple range operators before fun in spec', () => {
      // Multiple .. operators in the same -type, all should be skipped
      const source = '-type t() :: {1..10, 20..30, fun(() -> ok)}.\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle mixed float and range in same spec before fun', () => {
      // Both float literal (3.14) and range operator (..) in same spec
      const source = '-spec foo(3.14, 1..10) -> fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should treat real period as declaration terminator even with ranges and floats before it', () => {
      // A real period (end of declaration) should still be recognized
      const source = '-type t() :: 1..10.\nfoo() -> fun() -> ok end.';
      const pairs = parser.parse(source);
      // Period after 10 terminates the spec -> fun() is a real block
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should handle range with second dot preceded by another dot', () => {
      // Lines 81-83: second dot of range operator check
      // In a scenario where we have consecutive dots: if the first dot is consumed by
      // lines 77-80, the for-loop j++ moves past the second dot. But with ...
      // (three dots, which is invalid Erlang but tests the branch), the middle dot
      // has source[j-1] === '.' triggering lines 81-83
      const source = '-type t() :: 1...10 | fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // First dot: lines 77-80 skip (j++ past second dot, continue, for j++ past third dot)
      // Actually with three dots: first dot matches source[j+1]==='.' -> j++, continue, for j++
      // Now j is at third dot. source[j-1] is second dot -> '.' -> line 81-83 fires: continue
      // Then for j++ moves past third dot. No period found -> fun rejected.
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip consecutive dots in multi-line type with fun on next line', () => {
      // Lines 82-83: fun() on a DIFFERENT line from -type, so the line-start check (line 31)
      // does not short-circuit. The period scan encounters '...' where the third dot
      // has source[j-1] === '.' triggering lines 81-83 continue.
      const source = '-type t() :: 1...10 |\n  fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // fun() is in type context (no period separator) -> rejected
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip float literal period in multi-line spec with fun on next line', () => {
      // Lines 86-87: fun() on a DIFFERENT line from -spec, so the line-start check (line 31)
      // does not short-circuit. The period scan encounters '.' in '1.5' where
      // source[j-1]='1' (digit) and source[j+1]='5' (digit), triggering lines 85-87 continue.
      const source = '-spec foo(1.5) ->\n  fun(() -> ok).\nbegin\n  ok\nend.';
      const pairs = parser.parse(source);
      // fun() is in spec context (float period is not declaration terminator) -> rejected
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: fun() after :: in -record type annotations', () => {
    test('should not detect fun() in -record type annotation as block opener', () => {
      const source = `-record(state, {
  handler :: fun((atom()) -> ok)
}).`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still detect fun() in -record default value as block opener', () => {
      const source = `-record(state, {
  handler = fun() -> ok end
}).`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('Regression: unterminated atom stops at newline', () => {
    test('should not let unterminated atom consume subsequent lines', () => {
      const source = "X = 'unterminated\nbegin\n  ok\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not let unterminated atom consume lines with CRLF', () => {
      const source = "X = 'unterminated\r\nbegin\r\n  ok\r\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not let unterminated atom consume lines with CR-only', () => {
      const source = "X = 'unterminated\rbegin\r  ok\rend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still handle properly terminated atoms', () => {
      const source = "X = 'begin',\nbegin\n  ok\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Branch coverage: unterminated atom at end of source', () => {
    test('should handle unterminated quoted atom at end of source (matchAtom lines 397-398)', () => {
      // Unterminated atom at the very end with no trailing newline
      const source = "begin\n  ok\nend,\nX = 'unterminated";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle unterminated atom with escape at end of source', () => {
      const source = "begin\n  ok\nend,\nX = 'test\\'more";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: \\s -> [ \\t] in -spec/-type attribute detection', () => {
    // The -spec/-type detection regex changed from /-\s*(?:spec|type|...)/ to /-[ \t]*(?:spec|type|...)/
    // This prevents a hyphen on one line and 'spec' on the next from being falsely matched

    test('should not suppress fun after arithmetic subtraction before spec_function call', () => {
      // "X = A -\nspec_function()" has '-' followed by newline then 'spec_function'
      // Old regex /-\s*spec/ would match (since \s includes \n).
      // New regex /-[ \t]*spec/ does NOT match (newline is not [ \t]).
      // So a 'fun' appearing later should still be treated as a block opener.
      const source = 'X = A -\nspec_function(),\nfun() ->\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should still suppress fun inside a -spec return type on the same line', () => {
      // The fix should not break the normal case: -spec on same line suppresses fun inside the spec
      // Here fun() is INSIDE the spec declaration (no period between -spec and fun)
      const source = '-spec my_fun(atom()) -> fun((atom()) -> ok)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still suppress fun inside a -type annotation on the same line', () => {
      // fun() inside a -type declaration (no period between -type and fun) is suppressed
      const source = '-type my_type() :: fun((atom()) -> ok)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not suppress fun after expression using minus operator with newline', () => {
      // A minus operator followed by newline then a word starting with 'type' should not match -type
      const source = 'X = Y -\ntype_of(Z),\nfun() ->\n  ok\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should not reject fun as function reference when identifier is on next line', () => {
      // fun followed by newline + identifier/arity should NOT match as fun reference
      const source = 'F = fun\n  (X) -> X * 2\nend,\nfoo/2.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should not reject fun as quoted function reference when atom crosses lines', () => {
      // Quoted atom in fun reference pattern should not match across newlines
      const source = "F = fun\n  'hello'/2,\nfun() ->\n  ok\nend.";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should not reject fun as type context when paren is on next line', () => {
      // fun followed by newline + ( should not trigger type context check
      const source = 'F = fun\n  (X) -> X + 1\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });
  });

  suite('Regression: block expression end as map key', () => {
    test('should pair begin-end when end is followed by =>', () => {
      const source = '#{begin ok end => value}.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should pair fun-end when end is followed by :=', () => {
      const source = 'M#{fun() -> ok end := new_value}.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fun', 'end');
    });

    test('should still filter block_open keywords used as map keys', () => {
      const source = '#{begin => 1, fun => 2}.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  generateCommonTests(config);
});
