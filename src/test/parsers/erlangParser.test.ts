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

suite('ErlangBlockParser Test Suite', () => {
  let parser: ErlangBlockParser;

  setup(() => {
    parser = new ErlangBlockParser();
  });

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
    test('should skip keywords in single-line comments', () => {
      const source = `begin
  % if case receive try fun end
  X = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in double-quoted strings', () => {
      const source = `begin
  S = "if case receive try fun begin end",
  ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

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
  });

  suite('Catch expression prefix', () => {
    test('should not treat catch expression as intermediate', () => {
      const pairs = parser.parse('begin\n  X = catch throw(hello),\n  Y\nend');
      assertSingleBlock(pairs, 'begin', 'end', 0);
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat catch as intermediate in try block', () => {
      const pairs = parser.parse('try\n  risky()\ncatch\n  error -> ok\nend');
      assertSingleBlock(pairs, 'try', 'end', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'catch');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      assertNoBlocks(parser.parse(''));
    });

    test('should handle source with no blocks', () => {
      assertNoBlocks(parser.parse('foo() -> ok.'));
    });

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
      // Unterminated atom extends to EOF, so no pairs detected
      assertNoBlocks(pairs);
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

  suite('Token positions', () => {
    test('should report correct line and column for single line', () => {
      const source = 'begin X end';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 0, 8);
    });

    test('should report correct positions for multi-line', () => {
      const source = `begin
  X = 1
end`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should report correct column with leading spaces', () => {
      const source = '  begin X end';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 2);
      assertTokenPosition(pairs[0].closeKeyword, 0, 10);
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
});
