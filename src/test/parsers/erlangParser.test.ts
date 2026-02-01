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
});
