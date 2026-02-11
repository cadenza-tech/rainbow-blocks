import * as assert from 'node:assert';
import { ElixirBlockParser } from '../../parsers/elixirParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokens,
  findBlock
} from '../helpers/parserTestHelpers';

suite('ElixirBlockParser Test Suite', () => {
  let parser: ElixirBlockParser;

  setup(() => {
    parser = new ElixirBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse def-do-end block', () => {
      const source = `def hello do
  IO.puts("Hello")
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse defmodule-do-end block', () => {
      const source = `defmodule MyModule do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmodule', 'end');
    });

    test('should parse if-do-end block', () => {
      const source = `if condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse case-do-end block', () => {
      const source = `case value do
  :ok -> "success"
  :error -> "failure"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should parse cond-do-end block', () => {
      const source = `cond do
  x > 0 -> "positive"
  x < 0 -> "negative"
  true -> "zero"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'cond', 'end');
    });

    test('should parse fn-end block', () => {
      const source = 'fn x -> x * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });

    test('should parse unless-do-end block', () => {
      const source = `unless condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should parse for-do-end block', () => {
      const source = `for x <- list do
  x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse with-do-end block', () => {
      const source = `with {:ok, result} <- action() do
  process(result)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'with', 'end');
    });

    test('should parse receive-do-end block', () => {
      const source = `receive do
  {:message, msg} -> handle(msg)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
    });

    test('should parse quote-do-end block', () => {
      const source = `quote do
  unquote(expr)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
    });
  });

  suite('Definition keywords', () => {
    test('should parse defp-do-end block', () => {
      const source = `defp private_func do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defp', 'end');
    });

    test('should parse defmacro-do-end block', () => {
      const source = `defmacro my_macro do
  quote do: :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmacro', 'end');
    });

    test('should parse defprotocol-do-end block', () => {
      const source = `defprotocol MyProtocol do
  def my_func(value)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defprotocol', 'end');
    });

    test('should parse defimpl-do-end block', () => {
      const source = `defimpl MyProtocol, for: MyStruct do
  def my_func(value), do: value
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defimpl', 'end');
    });

    test('should parse def with multiline parameters', () => {
      const source = `def my_function(
    arg1,
    arg2
  ) do
  body
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse defmodule with do on next line', () => {
      const source = `defmodule MyApp.Module.Name
  do
  def foo do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'defmodule', 0);
      assertNestLevel(pairs, 'def', 1);
    });

    test('should parse def with multiline pattern matching', () => {
      const source = `def handle_call(
    {:get, key},
    _from,
    state
  ) do
  {:reply, Map.get(state, key), state}
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse def with multiline guard clause', () => {
      const source = `def process(value)
    when is_integer(value)
    when value > 0 do
  value * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle do: keyword argument inside parentheses', () => {
      const source = `def foo(%{do: value}) do
  value
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse if with multiline condition', () => {
      const source = `if condition1 and
   condition2 and
   condition3 do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else-end block', () => {
      const source = `if condition do
  action1()
else
  action2()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse try-rescue-end block', () => {
      const source = `try do
  risky_operation()
rescue
  e -> handle_error(e)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });

    test('should parse try-catch-end block', () => {
      const source = `try do
  throwing_function()
catch
  :throw, value -> handle_throw(value)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should parse try-after-end block', () => {
      const source = `try do
  action()
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['after']);
    });

    test('should parse try-rescue-catch-after-end block', () => {
      const source = `try do
  risky()
rescue
  e -> handle(e)
catch
  :throw, val -> val
after
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue', 'catch', 'after']);
    });

    test('should parse receive-after-end block', () => {
      const source = `receive do
  {:msg, data} -> handle(data)
after
  5000 -> :timeout
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assertIntermediates(pairs[0], ['after']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `defmodule MyModule do
  def my_func do
    if condition do
      action()
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'defmodule', 0);
    });
  });

  suite('do: one-liner exclusion', () => {
    test('should ignore if with do: one-liner', () => {
      const source = `if condition, do: action()
def real_func do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore unless with do: one-liner', () => {
      const source = `unless condition, do: action()
def real_func do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore def with do: one-liner', () => {
      const source = `def hello(name), do: "Hello, #{name}"
def real_func do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore for with do: one-liner', () => {
      const source = `for x <- list, do: x * 2
def real_func do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse do block when not followed by colon', () => {
      const source = `if condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle mixed do: and do-end', () => {
      const source = `defmodule MyModule do
  def one_liner(x), do: x * 2

  def multi_line(x) do
    x * 2
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'defmodule'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'def'));
    });
  });

  suite('Excluded regions - Comments', () => {
    test('should ignore keywords in single-line comments', () => {
      const source = `# if end def
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in double-quoted strings', () => {
      const source = `x = "if end def"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in single-quoted charlists', () => {
      const source = `x = 'if end def'
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `x = "say \\"if\\" end"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Heredocs', () => {
    test('should ignore keywords in triple-quoted heredocs', () => {
      const source = `x = """
if condition do
  action()
end
"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in triple single-quoted heredocs', () => {
      const source = `x = '''
if condition do
  action()
end
'''
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Sigils', () => {
    test('should ignore keywords in ~r regex sigil', () => {
      const source = `x = ~r/if end/
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in ~s string sigil', () => {
      const source = `x = ~s(if end def)
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in ~w word list sigil', () => {
      const source = `x = ~w[if end def]
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in ~c charlist sigil', () => {
      const source = `x = ~c{if end}
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle uppercase sigils (no interpolation)', () => {
      const source = `x = ~S(if end #{expr})
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with pipe delimiter', () => {
      const source = `x = ~r|if end|i
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with angle bracket delimiter', () => {
      const source = `x = ~s<if end>
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle heredoc-style sigil', () => {
      const source = `x = ~S"""
if condition do
  action()
end
"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle nested brackets in sigil', () => {
      const source = `x = ~s({if {end}})
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with modifiers', () => {
      const source = `x = ~r/if end/iu
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Atom literals', () => {
    test('should not match keywords inside atom literals', () => {
      const source = `:if
:end
:for
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match :do atom as block opener', () => {
      const source = `x = :do
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle atom list', () => {
      const source = `atoms = [:if, :unless, :case, :end]
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle quoted atom with keyword', () => {
      const source = `atom = :"end"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle single-quoted atom with keyword', () => {
      const source = `atom = :'if'
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle atom with special characters', () => {
      const source = `atom = :end?
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle atom with @ character', () => {
      const source = `atom = :end@foo
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not confuse ternary-like syntax with atom', () => {
      const source = `# Elixir doesn't have ternary but uses if/else expression
result = if cond, do: :yes, else: :no
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Keyword list syntax (keyword:)', () => {
    test('should not match keywords used as keyword list keys', () => {
      const source = `opts = [if: 1, end: 2, case: 3]
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still match block keyword followed by condition', () => {
      const source = `if condition do
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match end: in function call arguments', () => {
      const source = `defmodule Test do
  def foo do
    Enum.slice(list, start: 0, end: 10)
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.closeKeyword.line, 3);
      const modulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(modulePair.closeKeyword.line, 4);
    });

    test('should handle end: in keyword list with nested blocks', () => {
      const source = `defmodule Test do
  def foo do
    opts = [start: 1, end: 10]
    if condition do
      action
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.openKeyword.line, 3);
      assert.strictEqual(ifPair.closeKeyword.line, 5);
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.closeKeyword.line, 6);
    });

    test('should handle multiple end: keyword arguments', () => {
      const source = `def foo do
  func(end: 1)
  other(end: 2, start: 0)
  [end: 3]
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });
  });

  suite('Edge cases', () => {
    suite('General', () => {
      test('should handle empty source', () => {
        const pairs = parser.parse('');
        assertNoBlocks(pairs);
      });

      test('should handle source with no blocks', () => {
        const pairs = parser.parse('IO.puts("hello")');
        assertNoBlocks(pairs);
      });

      test('should handle multiple fn blocks', () => {
        const source = `list
|> Enum.map(fn x -> x * 2 end)
|> Enum.filter(fn x -> x > 5 end)`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assert.ok(pairs.every((p) => p.openKeyword.value === 'fn'));
      });

      test('should handle complex real-world Elixir code', () => {
        const source = `defmodule MyApp.User do
  defstruct [:name, :email]

  def new(name, email) do
    %__MODULE__{name: name, email: email}
  end

  def validate(%__MODULE__{} = user) do
    with {:ok, _} <- validate_name(user.name),
         {:ok, _} <- validate_email(user.email) do
      {:ok, user}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp validate_name(name) when is_binary(name) do
    if String.length(name) > 0 do
      {:ok, name}
    else
      {:error, :empty_name}
    end
  end
end`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 5);

        const modulePair = findBlock(pairs, 'defmodule');
        assert.strictEqual(modulePair.nestLevel, 0);
      });

      test('should handle empty defmodule', () => {
        const source = `defmodule Empty do
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'defmodule', 'end');
      });

      test('should handle deeply nested blocks', () => {
        const source = `defmodule A do
  def b do
    if c do
      case d do
        _ -> fn e do
          e
        end
      end
    end
  end
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 5);
      });
    });

    suite('Triple-quoted strings', () => {
      test('should handle unterminated triple-quoted string', () => {
        const source = `"""
if unterminated
def inside
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unterminated single-quoted heredoc', () => {
        const source = `'''
if unterminated
def inside
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Sigils', () => {
      test('should not match invalid sigil (non-letter after ~)', () => {
        const source = `x = ~1 invalid
def foo do
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle sigil at end of source', () => {
        const source = 'x = ~s';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle sigil with invalid delimiter (alphanumeric)', () => {
        const source = `x = ~sabc
def foo do
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle uppercase sigil with multiple letters', () => {
        const source = `x = ~NaiveDateTime[2020-01-01]
def foo do
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle heredoc-style sigil with modifiers', () => {
        const source = `x = ~S"""
if inside heredoc sigil
"""abc
def foo do
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle unterminated heredoc-style sigil', () => {
        const source = `x = ~S"""
if inside
never terminated`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle lowercase sigil with escape sequences', () => {
        const source = `x = ~s(escaped \\) paren)
def foo do
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle sigil with nested paired delimiters', () => {
        const source = `x = ~s(outer (inner) outer)
def foo do
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle single-quoted heredoc-style sigil', () => {
        const source = `x = ~S'''
content inside
'''
def foo do
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle ~ at end of file', () => {
        const source = `def foo do
  x
end
~`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat ~ after identifier as sigil', () => {
        const source = `def foo do
  var~r/test/
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat ~ after ) as sigil', () => {
        const source = `def foo do
  func()~r/test/
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat ~ after ] as sigil', () => {
        const source = `def foo do
  arr[0]~r/test/
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat ~ after } as sigil', () => {
        const source = `def foo do
  %{}~r/test/
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat ~ after > as sigil', () => {
        const source = `def foo do
  1>0~r/test/
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle escape sequence in sigil', () => {
        const source = `def foo do
  ~r/test\\/path/
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle multiple escape sequences in sigil', () => {
        const source = `def foo do
  ~r/a\\/b\\/c/
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated sigil at end of file', () => {
        const source = `def foo do
  ~r/unterminated`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('do: one-liners', () => {
      test('should detect do: with whitespace before colon', () => {
        const source = `if condition, do  :  action
def foo do
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle defmodule without do: pattern', () => {
        const source = `defmodule MyModule do
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'defmodule', 'end');
      });
    });

    suite('Strings', () => {
      test('should handle unterminated double-quoted string', () => {
        const source = `msg = "unterminated
def foo do
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unterminated single-quoted charlist', () => {
        const source = `msg = 'unterminated
def foo do
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Atoms', () => {
      test('should handle colon at end of file', () => {
        const source = 'def foo do\n  x\nend\n:';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after identifier as atom in keyword argument', () => {
        const source = 'def foo do\n  func(key: value)\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after number as atom', () => {
        const source = 'def foo do\n  x = 123: value\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon after closing paren as atom', () => {
        const source = 'def foo do\n  func():atom\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after closing bracket as atom', () => {
        const source = 'def foo do\n  list]:atom\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon after identifier when followed by letter', () => {
        const source = 'def foo do\n  x = a:b\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle escape in quoted atom', () => {
        const source = 'def foo do\n  :"escaped\\"atom"\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle unterminated quoted atom', () => {
        const source = 'def foo do\n  :"unterminated';
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });
    });

    suite('hasDoKeyword patterns', () => {
      test('should handle end at start of expression', () => {
        const source = 'end';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should not find do after end keyword', () => {
        const source = `if true do
  x
end
if false, do: y`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle comma do pattern', () => {
        const source = `Enum.map(list, fn x do
  x * 2
end)`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'fn', 'end');
      });

      test('should handle comma-do colon one-liner without space', () => {
        const source = 'if true,do: x\nif false do\n  y\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
        assert.strictEqual(pairs[0].openKeyword.line, 1);
      });

      test('should handle end followed by non-whitespace in hasDoKeyword', () => {
        // Tests the branch where afterEnd is not undefined and not whitespace
        const source = `if condition do
  something
end.chain
if true do
  x
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
      });

      test('should handle end at end of source in hasDoKeyword', () => {
        // Tests the branch where afterEnd is undefined
        const source = `if true do
  x
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should reject if without do when end is found', () => {
        // Tests hasDoKeyword finding 'end' before 'do' and returning false
        // The 'if' without 'do' should not be matched as a block
        const source = `x = if condition, do: a
if with_end end
def foo do
  y
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle tab before do keyword', () => {
        // Tests the branch for tab-do pattern in hasDoKeyword
        const source = `if true\tdo
  x
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle end at position 0 in hasDoKeyword', () => {
        // Tests beforeEnd fallback when i === 0
        const source = `end
def foo do
  x
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `def foo do
  if bar do
  end
end`;
      const pairs = parser.parse(source);
      const defPair = findBlock(pairs, 'def');
      const ifPair = findBlock(pairs, 'if');

      assert.strictEqual(defPair.openKeyword.line, 0);
      assert.strictEqual(defPair.openKeyword.column, 0);
      assert.strictEqual(ifPair.openKeyword.line, 1);
      assert.strictEqual(ifPair.openKeyword.column, 2);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = 'def foo do\nend';
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [{ value: 'def' }, { value: 'end' }]);
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = '"string" # comment\ndef foo do\nend';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 8);
      assert.strictEqual(regions[1].start, 9);
    });
  });

  suite('Triple-quoted string escape handling', () => {
    test('should handle backslash escape inside triple-quoted string', () => {
      const source = `x = """hello \\"world\\" end"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle backslash at end of triple-quoted string content', () => {
      const source = `x = """line1\\nline2"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped triple quote inside heredoc', () => {
      const source = `x = """
escaped \\"\\"\\" not end
"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });
});
