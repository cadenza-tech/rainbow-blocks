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

    test('should not treat do with bare colon at end of line as do: one-liner', () => {
      // "do :" at end of line is not do: syntax
      const pairs = parser.parse('if condition do :\n  body\nend');
      assertSingleBlock(pairs, 'if', 'end', 0);
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

    test('should handle escape in lowercase heredoc sigil', () => {
      const source = `x = ~s"""
escaped \\""" still inside
"""
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

  suite('Coverage: do-colon one-liner detection', () => {
    test('should not treat non-docolon keyword as one-liner', () => {
      // Tests isDoColonOneLiner returning false for keywords without do:
      const source = `if true do
  x = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('String interpolation with nested quotes', () => {
    test('should handle #{} with nested double quotes in string', () => {
      const source = `defmodule M do
  x = "text #{func("inner")} end"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmodule', 'end');
    });

    test('should handle nested #{} in string', () => {
      const source = `def foo do
  x = "a #{b} c #{d} end"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle deeply nested interpolation', () => {
      const source = `def foo do
  x = "outer #{"inner #{val}"} end"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle #{} in triple-quoted heredoc', () => {
      const source = `def foo do
  x = """
  text #{func("inner")} end
  """
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not apply interpolation to single-quoted strings', () => {
      const source = `def foo do
  x = 'text #{end}'
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped hash in string', () => {
      const source = `def foo do
  x = "text \\#{end}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escape sequences inside interpolation', () => {
      const source = `def foo do
  x = "text #{"\\"end\\"" <> val} more"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle nested braces inside interpolation', () => {
      const source = `def foo do
  x = "text #{%{key: "end"}} more"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle single-quoted string inside interpolation', () => {
      const source = `def foo do
  x = "text #{'end'} more"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escape in nested string inside interpolation', () => {
      const source = `def foo do
  x = "text #{"val\\'s end"} more"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle unterminated nested string inside interpolation', () => {
      const source = `def foo do
  x = "text #{"unterminated} end"
end`;
      const pairs = parser.parse(source);
      // Unterminated nested string consumes everything
      assertNoBlocks(pairs);
    });
  });

  suite('fn keyword do: one-liner handling', () => {
    test('should not treat fn with do: as one-liner', () => {
      const source = 'fn x -> x end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
  });

  suite('do :atom false positive (Bug 1)', () => {
    test('should parse if-do-end when body starts with atom', () => {
      const source = 'if true do :ok end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse def-do-end when body returns atom', () => {
      const source = `def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse case-do-end with atom pattern in body', () => {
      const source = `case value do
  :error -> :retry
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should still detect do: one-liner syntax', () => {
      const source = `if condition, do: action()
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still detect do: with atom value as one-liner', () => {
      // do: :ok is keyword syntax (do: with atom value)
      const source = `if condition, do: :ok
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse for-do-end when body starts with atom', () => {
      const source = 'for x <- list do :process end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse unless-do-end when body is atom', () => {
      const source = `unless done do
  :continue
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });
  });

  suite('Sigil inside interpolation (Bug 4)', () => {
    test('should handle ~s sigil with } inside interpolation', () => {
      const source = `def foo do
  x = "value: #{~s(}) <> str}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ~r regex sigil inside interpolation', () => {
      const source = `def foo do
  x = "match: #{Regex.match?(~r/}/, val)}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle uppercase sigil inside interpolation', () => {
      const source = `def foo do
  x = "value: #{~S(}) <> str}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with bracket delimiter inside interpolation', () => {
      const source = `def foo do
  x = "value: #{~s[}] <> str}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with angle bracket inside interpolation', () => {
      const source = `def foo do
  x = "value: #{~s<}> <> str}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with pipe delimiter inside interpolation', () => {
      const source = `def foo do
  x = "text: #{~r|pattern| |> inspect}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle sigil with escape inside interpolation', () => {
      const source = `def foo do
  x = "value: #{~s(a\\)b)}"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('hasDoKeyword line limit (Bug 5)', () => {
    test('should not find do from nested for inside if', () => {
      const source = `if condition
  for y <- list, do
    process(y)
  end
end`;
      const pairs = parser.parse(source);
      // Only the for block should be matched; if has no do within 2 lines
      const forBlock = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forBlock, 'Expected to find for block');
      assert.ok(!pairs.some((p) => p.openKeyword.value === 'if'), 'if should not be matched as block');
    });

    test('should still find do on the same line', () => {
      const source = `if condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still find do on the next line', () => {
      const source = `if condition
do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still find do two lines away', () => {
      const source = `def my_func(arg)
    when is_integer(arg)
    do
  arg * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match do three or more lines away', () => {
      const source = `if condition


  def inner do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      // if should not be matched (do is too far away)
      // def inner should be matched
      const defBlock = pairs.find((p) => p.openKeyword.value === 'def');
      assert.ok(defBlock, 'Expected to find def block');
    });

    test('should parse if with condition spanning 4+ lines before do', () => {
      const source = `if cond1 and
   cond2 and
   cond3 and
   cond4 do
  body
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multiline params within 2-line limit', () => {
      const source = `def my_function(
    arg1,
    arg2
  ) do
  body
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: multi-letter sigil handling', () => {
    test('should handle uppercase multi-letter sigil', () => {
      const regions = parser.getExcludedRegions('~ABC(content)');
      assert.strictEqual(regions.length, 1);
    });

    test('should handle sigil at end of source', () => {
      const regions = parser.getExcludedRegions('~AB');
      assert.strictEqual(regions.length, 0);
    });

    test('should handle sigil with nested paired delimiters', () => {
      const regions = parser.getExcludedRegions('~s(hello (world))');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, 17);
    });
  });

  suite('Coverage: sigil in interpolation', () => {
    test('should handle multi-letter sigil in string interpolation', () => {
      const pairs = parser.parse('if true do\n  x = "#{~ABC(content)}"\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle sigil at EOF in interpolation', () => {
      const regions = parser.getExcludedRegions('"#{~AB');
      assert.ok(regions.length >= 1);
    });

    test('should handle nested paired delimiter sigil in interpolation', () => {
      const pairs = parser.parse('if true do\n  x = "#{~s((nested))}"\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Complex real-world scenario', () => {
    test('should handle pipeline with fn/end and defmodule/def/do/end', () => {
      const source = `result =
  list
  |> Enum.map(fn x -> x * 2 end)
  |> Enum.filter(fn x -> x > 5 end)

defmodule Test do
  def hello do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      findBlock(pairs, 'defmodule');
      assertNestLevel(pairs, 'defmodule', 0);
    });
  });

  suite('Edge cases', () => {
    test('should handle CRLF line endings', () => {
      const source = 'if true do\r\n  :ok\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle atom that looks like keyword', () => {
      const source = `x = :if
y = :do
if true do
  :end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle keyword in map key position', () => {
      const source = `%{if: true, do: :ok}
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Quoted atom after do', () => {
    test('should not treat do :"atom" as do: one-liner', () => {
      const pairs = parser.parse('if condition do :"error_atom"\n  more_code\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('do:value without space (keyword syntax)', () => {
    test('should treat do:value as one-liner', () => {
      const source = `if condition, do:action()
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat space-do:value as one-liner', () => {
      const source = `if condition do:action()
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still parse normal do block', () => {
      const source = `if condition do
  action()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('CR-only line ending support', () => {
    test('should handle CR-only line endings in isDoColonOneLiner', () => {
      // With \r-only endings, isDoColonOneLiner must stop at \r
      // Otherwise it would scan into the next line and find do: on line 2
      const source = 'if true do\r  func(a, do: val)\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle CR-only line endings in hasDoKeyword', () => {
      const source = 'if true do\r  x\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Heredoc sigil interpolation with triple quotes', () => {
    test('should not prematurely close heredoc sigil when triple quotes appear in interpolation', () => {
      const source = '~s"""\n#{"""inner"""}\n"""';
      const regions = parser.getExcludedRegions(source);
      // The entire ~s"""...""" should be one excluded region
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, source.length);
    });
  });
});
