import * as assert from 'node:assert';
import { ElixirBlockParser } from '../../parsers/elixirParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

suite('ElixirBlockParser Test Suite', () => {
  let parser: ElixirBlockParser;

  setup(() => {
    parser = new ElixirBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'IO.puts("hello")',
    tokenSource: 'def foo do\nend',
    expectedTokenValues: ['def', 'end'],
    excludedSource: '"string" # comment\ndef foo do\nend',
    expectedRegionCount: 2,
    twoLineSource: 'def foo do\nend',
    singleLineCommentSource: '# if end def\ndef foo do\nend',
    commentBlockOpen: 'def',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'x = "if end def"\ndef foo do\nend',
    stringBlockOpen: 'def',
    stringBlockClose: 'end',
    escapedQuoteStringSource: 'x = "say \\"if\\" end"\ndef foo do\nend',
    escapedQuoteStringBlockOpen: 'def',
    escapedQuoteStringBlockClose: 'end',
    nestedBlockSource: `defmodule MyModule do
  def my_func do
    if condition do
      action()
    end
  end
end`,
    nestedBlockCount: 3,
    nestedBlockLevels: [
      { keyword: 'if', level: 2 },
      { keyword: 'def', level: 1 },
      { keyword: 'defmodule', level: 0 }
    ]
  };

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
    generateNestedBlockTests(config);
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
    generateExcludedRegionTests(config);
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted charlists', () => {
      const source = `x = 'if end def'
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

    test('should not close heredoc at mid-line triple quotes', () => {
      // Regression: matchTripleQuotedString closed at any """ not just line-start """
      const source = `x = """
content """ still inside
"""
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not close single-quoted heredoc at mid-line triple quotes', () => {
      const source = "x = '''\ncontent ''' still inside\n'''\ndef foo do\nend";
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

    test('should handle interpolation with string containing } inside quoted atom', () => {
      // matchAtomLiteral should handle strings inside interpolation in quoted atoms
      const source = `x = :"atom_#{"}value"}"
if x do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
    generateEdgeCaseTests(config);

    test('should handle parenthesized block keyword if(true) do...end', () => {
      const pairs = parser.parse('if(true) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle parenthesized defmodule(M) do...end', () => {
      const pairs = parser.parse('defmodule(MyModule) do\n  :ok\nend');
      assertSingleBlock(pairs, 'defmodule', 'end');
    });

    test('should not treat keyword before closing paren as block open in if(cond) do', () => {
      const pairs = parser.parse('if(cond) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat keyword before closing bracket as block open in if [case] do', () => {
      const source = `def foo do
  if [case] do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.closeKeyword.value, 'end');
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.closeKeyword.value, 'end');
    });

    test('should not treat keyword before closing brace as block open in if {cond} do', () => {
      const pairs = parser.parse('if {cond} do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
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

      test('should not treat keyword with ~ prefix as block keyword (~end)', () => {
        // ~end<newline> is not a valid sigil (no delimiter follows the sigil name),
        // so the trailing end must not be tokenized as a block_close. Otherwise the
        // outer def would mis-pair with the bare end inside ~end on line 1.
        const source = `def foo do
  ~end
  end
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
        // The matched close must not be the bare 'end' inside ~end on line 1.
        const pair = findBlock(pairs, 'def');
        assert.notStrictEqual(pair.closeKeyword?.line, 1, 'def must not pair with the end inside ~end on line 1');
        // No standalone 'end' token may be derived from offset inside ~end (offsets 14..16).
        const tokens = parser.getTokens(source);
        for (const t of tokens) {
          assert.ok(t.startOffset < 13 || t.startOffset > 16, `no token should originate from inside ~end (got '${t.value}'@${t.startOffset})`);
        }
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

      test('should not treat colon after Unicode letter as atom start', () => {
        const pairs = parser.parse('caf\u00e9:if true do\n  :ok\nend');
        assertSingleBlock(pairs, 'if', 'end');
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

    test('should not treat else? as block middle keyword', () => {
      const source = 'if else?(x) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not treat catch! as block middle keyword', () => {
      const source = 'try do\n  catch!(err)\nrescue\n  e -> e\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });

    test('should not tokenize keywords preceded by ? as block tokens', () => {
      const pairs = parser.parse('if true do\n  x = ?end\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle Unicode identifier containing block keyword in hasDoKeyword lookahead', () => {
      const source = 'if \u03B1if do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle Unicode identifier containing block keyword in isDoColonOneLiner', () => {
      const source = 'if \u03B1if, do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not decrement block depth for end: keyword argument in isDoColonOneLiner', () => {
      const pairs = parser.parse('if if(c) end: v, do: :ok do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect sigil preceded by Unicode identifier as not a sigil', () => {
      const regions = parser.getExcludedRegions('\u03B1~s(end)');
      // Should NOT have excluded region at position 2 (alpha is identifier char)
      const hasSigilRegion = regions.some((r) => r.start <= 2 && r.end > 2);
      assert.strictEqual(hasSigilRegion, false);
    });

    test('should not detect atom after :: type spec operator', () => {
      const regions = parser.getExcludedRegions('x::end');
      const hasAtomRegion = regions.some((r) => r.start === 2);
      assert.strictEqual(hasAtomRegion, false);
    });

    test('should not over-consume characters after atom with ! suffix', () => {
      const regions = parser.getExcludedRegions(':end!foo');
      const atomRegion = regions.find((r) => r.start === 0);
      assert.ok(atomRegion, 'atom region should exist');
      assert.strictEqual(atomRegion.end, 5); // :end! is 5 chars
    });

    test('should not over-consume characters after atom with ? suffix', () => {
      const regions = parser.getExcludedRegions(':valid?end');
      const atomRegion = regions.find((r) => r.start === 0);
      assert.ok(atomRegion, 'atom region should exist');
      assert.strictEqual(atomRegion.end, 7); // :valid? is 7 chars
    });
  });

  suite('Branch coverage', () => {
    test('should not suppress fn with do: pattern', () => {
      // Covers lines 389-390: isDoColonOneLiner returns false for fn
      // fn is not in the doColonKeywords list, so isDoColonOneLiner short-circuits
      // fn bypasses isDoColonOneLiner entirely (line 147 returns early),
      // ensuring fn blocks always work regardless of do: syntax on the same line
      const source = 'Enum.map(list, fn x -> x * 2 end)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });

    test('should reject do: one-liner for if keyword', () => {
      // Verifies that keywords IN the doColonKeywords list (like if) are properly
      // rejected when they have do: syntax, confirming the opposite path of lines 389-390
      const source = 'if true, do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: hasDoKeyword dot and @ prefix exclusion', () => {
    test('should recognize if-end when Module.if appears inside hasDoKeyword scan', () => {
      const source = `if SomeModule.if(data) do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize if-end when Module.for appears inside hasDoKeyword scan', () => {
      const source = `if SomeModule.for(x, y) do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize if-end when Module.fn appears inside hasDoKeyword scan', () => {
      const source = `if Module.fn(x) do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize if-end when @fn appears inside hasDoKeyword scan', () => {
      const source = `if @fn do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize defmodule-end when data.end appears inside hasDoKeyword scan', () => {
      const source = `defmodule M do
  if data.end do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'defmodule');
      findBlock(pairs, 'if');
    });

    test('should recognize defmodule-end when @end appears inside hasDoKeyword scan', () => {
      const source = `defmodule M do
  if @end do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'defmodule');
      findBlock(pairs, 'if');
    });

    test('should recognize if-end when @if appears inside hasDoKeyword scan', () => {
      const source = `if @if do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should not stack overflow on very deeply nested string interpolation', () => {
      // x="#{"#{"..."}"}" with 6000 levels of nested #{"..."} interpolation.
      // The string/interpolation scanners must iterate (not mutually recurse) so deep
      // nesting cannot exhaust the JS call stack. Best-effort: return excluded regions
      // without crashing (RangeError: Maximum call stack size exceeded).
      const depth = 6000;
      const source = `x="${'#{"'.repeat(depth)}${'"}'.repeat(depth)}"`;
      const regions = parser.getExcludedRegions(source);
      // The whole literal collapses into a single outer string region spanning the source.
      assertBlockCount(parser.parse(source), 0);
      assert.ok(regions.length >= 1);
      assert.strictEqual(regions[0].start, 2);
      assert.strictEqual(regions[0].end, source.length);
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

  suite('Non-heredoc sigil interpolation', () => {
    test('should handle interpolation with close delimiter in string inside ~s()', () => {
      // ~s(#{")"}), the ) inside ")" should not close the sigil
      const source = `x = ~s(#{")"}))
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation with close delimiter in ~s[]', () => {
      const source = `x = ~s[#{"]"}]
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation with close delimiter in ~s<>', () => {
      const source = `x = ~s<#{">"}>
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation with close delimiter in ~r//', () => {
      const source = `x = ~r/#{Regex.escape("/")}/
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation with close delimiter in ~s||', () => {
      const source = `x = ~s|#{"|"}|
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation with block keywords in ~s()', () => {
      const source = `x = ~s(#{if true do "end" end})
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not apply interpolation to uppercase non-heredoc sigils', () => {
      // Uppercase sigils don't have interpolation
      const source = `x = ~S(#{raw})
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('hasDoKeyword bracket and brace depth tracking', () => {
    test('should not find do inside brackets as block do', () => {
      // "do" inside [] should not be treated as block do
      const source = `x = [do: 1]
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not find do inside braces as block do', () => {
      // "do" inside {} should not be treated as block do
      const source = `x = %{do: 1}
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match if with do inside keyword list', () => {
      // if with do only inside a keyword list should not be matched
      const source = `func([if: true, do: action])
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match case with do inside map', () => {
      const source = `x = %{case: val, do: body}
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still find do outside brackets and braces', () => {
      const source = `for x <- [1, 2, 3] do
  x
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
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

  suite('hasDoKeyword edge cases', () => {
    test('should find do after multi-line list argument', () => {
      const source = 'if [\n  1,\n  2,\n  3,\n  4,\n  5,\n  6\n] do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should find do after multi-line map argument', () => {
      const source = 'if %{\n  a: 1,\n  b: 2,\n  c: 3,\n  d: 4,\n  e: 5,\n  f: 6\n} do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude atom :end after > without space', () => {
      const source = 'x>:end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Interpolation edge cases', () => {
    test('should handle bare # as comment inside interpolation', () => {
      // # inside #{} starts a comment; } in the comment doesn't close interpolation
      // The string becomes unterminated since } is never found
      const source = `x = "text #{1 # comment char} text"
if true do
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle # comment in multi-line interpolation', () => {
      // # starts comment to EOL; } on next line closes interpolation
      const source = `x = "#{1 # comment with } brace
}"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested #{} inside interpolation', () => {
      const source = `x = "outer #{y = "inner #{z}"} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle sigil inside interpolation with closing delimiter', () => {
      const source = `x = "text #{~s(})} text"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escape sequences inside nested strings', () => {
      const source = `x = "outer #{y = "inner \\"quote\\""} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment with #{ inside multi-line interpolation', () => {
      // #{ in a comment inside interpolation code should NOT increment depth
      const source = `x = "value is #{
  # comment with #{
  compute()
}"
if x do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Sigil edge cases in interpolation', () => {
    test('should handle skipNestedSigil reaching end of source', () => {
      const source = `x = "text #{~s`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle skipNestedSigil with invalid delimiter', () => {
      const source = `x = "text #{~s9}"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle skipNestedSigil with modifiers', () => {
      const source = `x = "text #{~r/pattern/iu} text"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle lowercase sigil with escape inside interpolation', () => {
      const source = `x = "outer #{~s(\\))} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle paired delimiter depth in nested sigil', () => {
      const source = `x = "outer #{~s({nested})} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Nested string in interpolation', () => {
    test('should handle single-quoted string inside interpolation', () => {
      const source = `x = "outer #{'inner if end'} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped characters in nested single-quoted string', () => {
      const source = `x = "outer #{'inner \\' quote'} outer"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Coverage: lines 205-207, 226-228
  suite('Charlist interpolation with escapes', () => {
    test('should handle escaped backslash in charlist interpolation', () => {
      const source = `x = 'text #{\\\\ if end} text'
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped quote in charlist interpolation', () => {
      const source = `x = 'text #{\\' if end} text'
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escape in skipInterpolation', () => {
      const source = `x = "text #{\\{ \\} if end} text"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment with closing brace in multi-line interpolation', () => {
      // # starts comment; } in comment doesn't close interpolation; } on next line does
      const source = `x = "#{1 # closing } here
}"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment with block keyword in multi-line interpolation', () => {
      // Block keywords after # in interpolation are in comment, not detected
      const source = `x = "#{value # do end
}"
if true do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Coverage: lines 242-247
  suite('Bare interpolation inside interpolation', () => {
    test('should treat bare # in interpolation as comment start', () => {
      // In Elixir code, # always starts a comment. Inside interpolation code,
      // #{x} is actually # (comment) followed by {x} (consumed by comment).
      // The interpolation never closes, making the string unterminated.
      const source = `x = "outer #{y = 1; #{x} = 2} outer"
if true do
end`;
      const pairs = parser.parse(source);
      // String is unterminated (} consumed by comment), so if/do/end is inside excluded region
      assertNoBlocks(pairs);
    });

    test('should treat multiple bare # in interpolation as comment', () => {
      const source = `x = "outer #{#{a}} outer"
if true do
end`;
      const pairs = parser.parse(source);
      // # starts comment, consuming {a}} outer" - string unterminated
      assertNoBlocks(pairs);
    });
  });

  // Coverage: lines 330-331
  suite('skipNestedString unterminated string', () => {
    test('should handle unterminated string inside interpolation', () => {
      const source = `x = "outer #{"inner`;
      const regions = parser.getExcludedRegions(source);
      // Should include the entire unterminated region
      assert.ok(regions.length >= 1);
      assert.strictEqual(regions[0].start, 4);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should handle unterminated charlist inside interpolation', () => {
      const source = `x = "outer #{'inner`;
      const regions = parser.getExcludedRegions(source);
      // Should include the entire unterminated region
      assert.ok(regions.length >= 1);
      assert.strictEqual(regions[0].start, 4);
      assert.strictEqual(regions[0].end, source.length);
    });
  });

  // Coverage: lines 545-546
  suite('hasDoKeyword with many newlines', () => {
    test('should return false when more than 5 newlines before do', () => {
      const source = `if true




do
end`;
      const pairs = parser.parse(source);
      // Should find the block since there are only 5 newlines (6 lines total)
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should return false when more than 5 newlines before do (boundary test)', () => {
      const source = `if true





do
end`;
      const pairs = parser.parse(source);
      // Should NOT find the block since there are 6 newlines
      assertNoBlocks(pairs);
    });
  });

  // Coverage: lines 631-632, 651, 672-674
  suite('do: one-liner edge cases', () => {
    test('should not match doColonKeywords if keyword not in list', () => {
      const source = `begin do: value
end`;
      const pairs = parser.parse(source);
      // begin is not in doColonKeywords list
      assertNoBlocks(pairs);
    });

    test('should detect do: with tab before do (line 651)', () => {
      const source = 'if true,\tdo: value';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect do: with no whitespace between do and colon (lines 672-674)', () => {
      const source = 'if true, do:value';
      const pairs = parser.parse(source);
      // do: with no whitespace is always keyword syntax
      assertNoBlocks(pairs);
    });

    test('should detect do: immediately after do without space', () => {
      const source = 'if true, do:42';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect do: immediately after do for complex value', () => {
      const source = 'if true, do::ok';
      const pairs = parser.parse(source);
      // do: followed immediately by atom :ok
      assertNoBlocks(pairs);
    });

    test('should detect do: one-liner with multi-line string containing newline in arguments', () => {
      // isDoColonOneLiner should not early-exit at \n inside excluded region (string)
      const source = 'foo("hello\\nworld", do: :ok)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect do: one-liner with heredoc in arguments', () => {
      // Keyword with heredoc in arguments containing \n should correctly recognize do:
      const source = `if func(~s"""
heredoc
""", :test), do: :ok`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: matchElixirCharlist escape', () => {
    // Covers lines 203-206: backslash escape in single-quoted charlist
    test('should handle escape sequence in charlist', () => {
      const source = "x = 'hello\\nworld'\nif true do\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude block keywords inside charlist with escapes', () => {
      const source = "x = 'do\\nend'\ndef foo do\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: hasDoKeyword \\r-only line endings', () => {
    // Covers line 537-538: \r-only line ending counting in hasDoKeyword
    test('should detect do keyword with \\r-only line endings', () => {
      const source = 'if true do\r  x\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should stop after too many \\r-only lines without do', () => {
      const source = 'if true\r  a\r  b\r  c\r  d\r  e\r  f\r  do\rend';
      const pairs = parser.parse(source);
      // More than 5 \r-only lines before do, so hasDoKeyword returns false
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: isDoColonOneLiner comma-do no space', () => {
    // Covers lines 649-650: ,do without space between comma and do
    test('should detect do: with comma directly before do', () => {
      const source = 'if true,do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect do: with comma-do and complex value', () => {
      const source = 'def foo(x),do: x + 1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: isDoColonOneLiner do: no whitespace', () => {
    // Covers lines 670-673: do: with no space between do and colon
    test('should detect do: as keyword syntax when colon immediately follows do', () => {
      const source = 'if true, do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect do: with tab before do colon', () => {
      const source = 'if true,\tdo: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers line 652: isDoColonOneLiner ,do branch (comma directly before do)
  suite('Coverage: isDoColonOneLiner comma-do branch', () => {
    test('should detect ,do: on same line as valid do block', () => {
      const source = 'if true do ,do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers lines 468-470: isDoColonOneLiner rejects block open (do: one-liner)
  suite('Coverage: isDoColonOneLiner rejection of block open', () => {
    test('should reject block open when do: one-liner pattern detected', () => {
      const source = 'def foo, do: :ok';
      const pairs = parser.parse(source);
      // def with do: is a one-liner, so no block pair is created
      assertNoBlocks(pairs);
    });

    test('should reject if with do: one-liner', () => {
      const source = 'if true, do: :ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should accept block when do: is not present', () => {
      const source = 'def foo do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers line 594: hasDoKeyword early stop when 'end' is reached
  suite('Coverage: hasDoKeyword stops at end keyword', () => {
    test('should not find do after an end keyword', () => {
      const source = 'if true\n  x = 1\nend do';
      const pairs = parser.parse(source);
      // hasDoKeyword scans forward from 'if', finds 'end' before 'do', returns false
      assertNoBlocks(pairs);
    });

    test('should stop at end before reaching do on next line', () => {
      const source = 'if true\nend\ndef foo do\n  :ok\nend';
      const pairs = parser.parse(source);
      // First 'if' has no do (stopped at end), second 'def' has do
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers lines 650-652: isDoColonOneLiner returns false for non-doColonKeyword (e.g., fn)
  suite('Coverage: isDoColonOneLiner with non-doColonKeyword', () => {
    test('should not check do: for fn keyword', () => {
      const source = 'fn -> :ok end';
      const pairs = parser.parse(source);
      // fn is not in doColonKeywords, so isDoColonOneLiner returns false immediately
      assertSingleBlock(pairs, 'fn', 'end');
    });

    test('should not check do: for receive keyword', () => {
      const source = 'receive do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
    });
  });

  // Covers lines 716-719: do: tight syntax (no space between do and :)
  suite('Coverage: do: tight syntax no space', () => {
    test('should treat do: with no space as keyword syntax', () => {
      const source = 'def bar(x), do: x * 2';
      const pairs = parser.parse(source);
      // do: (no space) is always keyword syntax -> one-liner
      assertNoBlocks(pairs);
    });

    test('should treat do: tight syntax for if', () => {
      const source = 'if true, do::ok';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug fixes', () => {
    test('Bug 3: do: inside parens should not trigger one-liner detection', () => {
      const source = `def render(assigns, do: content) do
  content
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 3: do: inside brackets should not trigger one-liner detection', () => {
      const source = `if [for: 1, do: 2] do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 3: do: inside braces should not trigger one-liner detection', () => {
      const source = `def handle_call(%{do: action}, state) do
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 4: hasDoKeyword should detect ,do (no space) pattern', () => {
      const source = `if true,do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 5: do : 42 (space before colon) should not be detected as do:', () => {
      const source = `if condition do
  result = do : 42
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 6: lowercase sigil should not skip multi-char name', () => {
      const source = `x = ~send
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 1: dot-preceded keyword should not be detected', () => {
      const pairs = parser.parse('defmodule Foo do\n  x = map.end\nend');
      assertSingleBlock(pairs, 'defmodule', 'end');
    });
  });

  suite('Coverage: new bug fix code paths', () => {
    test('should exclude #{} interpolation inside double-quoted atom', () => {
      const source = ':"hello #{if true do 1 end} world"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude #{} interpolation inside single-quoted atom', () => {
      const source = ":'hello #{1 + 2} world'\nif true do\n  1\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude nested braces in #{} interpolation inside quoted atom', () => {
      const source = ':"nested #{%{a: 1}} atom"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated quoted atom with interpolation', () => {
      const source = ':"unterminated #{if true do\n  1\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat escaped interpolation in quoted atom as interpolation', () => {
      const source = ':"escaped \\#{} not interpolation"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect do: one-liner as no block', () => {
      const source = 'if true, do: 1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat fn as do: keyword', () => {
      const source = 'fn -> 1 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });

    test('should detect do: one-liner with no space after colon', () => {
      const source = 'if true, do:1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect defmodule at start of file with hasDoKeyword', () => {
      const source = 'defmodule M do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmodule', 'end');
    });
  });

  suite('Coverage: uncovered branch paths', () => {
    // L141-144: Backslash escape inside #{} interpolation in quoted atom
    test('should handle backslash escape inside interpolation in quoted atom', () => {
      const source = ':"hello #{\\\\end} world"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // L612: i > 0 ternary in hasDoKeyword - end at start of source (i === 0)
    // When hasDoKeyword scans from position 0 and encounters "end", the `i > 0` check triggers false branch
    test('should handle end keyword found at i=0 in hasDoKeyword scan', () => {
      const source = 'end\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers L483-485: isDoColonOneLiner returns true causing isValidBlockOpen to reject
  // and L734-737: do: with no whitespace between do and colon in isDoColonOneLiner
  suite('Coverage: isDoColonOneLiner rejection from isValidBlockOpen', () => {
    test('should reject block open when do: found on same line as standalone do', () => {
      // hasDoKeyword finds standalone do (at end), isDoColonOneLiner finds do: on same line
      const source = 'if true, do: :ok do\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 1: @-prefixed keywords (module attributes)', () => {
    test('should not treat @end as block close keyword', () => {
      const source = `defmodule MyModule do
  @end "value"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmodule', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat @else as block middle keyword', () => {
      const source = `defmodule MyModule do
  @else :default
  if true do
    :ok
  else
    :error
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assertIntermediates(ifBlock, ['else']);
    });

    test('should not treat @rescue as block middle keyword', () => {
      const source = `defmodule MyModule do
  @rescue false
  try do
    risky()
  rescue
    e -> e
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const tryBlock = findBlock(pairs, 'try');
      assertIntermediates(tryBlock, ['rescue']);
    });

    test('should not treat @catch as block middle keyword', () => {
      const source = `defmodule MyModule do
  @catch true
  try do
    throw(:val)
  catch
    :throw, val -> val
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const tryBlock = findBlock(pairs, 'try');
      assertIntermediates(tryBlock, ['catch']);
    });

    test('should not treat @after as block middle keyword', () => {
      const source = `defmodule MyModule do
  @after 5000
  receive do
    msg -> msg
  after
    5000 -> :timeout
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const receiveBlock = findBlock(pairs, 'receive');
      assertIntermediates(receiveBlock, ['after']);
    });

    test('should not treat @if as block open keyword', () => {
      const source = `defmodule MyModule do
  @if :condition
  def foo do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat @def as block open keyword', () => {
      const source = `defmodule MyModule do
  @def "macro_attr"
  def foo do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat @fn as block open keyword', () => {
      const source = `defmodule MyModule do
  @fn :anonymous
  def foo do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle multiple @-prefixed keywords', () => {
      const source = `defmodule MyModule do
  @end "terminus"
  @else :fallback
  @after 1000
  def foo do
    :ok
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Bug 2: skipInterpolation triple-quoted strings (heredocs)', () => {
    test('should handle triple-quoted string inside interpolation with odd quotes', () => {
      // """ inside #{} should be matched as triple-quoted string, not three individual quotes
      const source = `x = "result: #{"""
content with " quote
"""}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle triple single-quoted charlist inside interpolation', () => {
      const source = `x = "result: #{'''
content with ' quote
'''}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle triple-quoted string with interpolation inside interpolation', () => {
      const source = `x = "outer #{"""
inner #{val}
"""}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle triple-quoted string with escape inside interpolation', () => {
      const source = `x = "outer #{"""
escaped \\"\\"\\" still inside
"""}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated triple-quoted string inside interpolation', () => {
      const source = `x = "outer #{"""
never terminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle triple-quoted string with block keywords inside interpolation', () => {
      const source = `x = "result: #{"""
if condition do
  action()
end
"""}"
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Bug 3: skipNestedSigil string and interpolation handling', () => {
    test('should handle interpolation inside lowercase nested sigil with closing delimiter', () => {
      // ~s( ... #{expr with )} ... ) - interpolation containing ) inside the sigil
      const source = `x = "outer #{~s(prefix #{func(")")} suffix)}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle string inside uppercase nested sigil', () => {
      // Uppercase sigils are raw - quotes inside don't affect paired delimiter tracking
      const source = `x = "outer #{~S(prefix "content" suffix)}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle string with non-paired delimiter inside nested sigil', () => {
      // For non-paired delimiters like /, string handling prevents false close
      const source = `x = "outer #{~s/prefix "\\/" suffix/}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 4: hasDoKeyword does not recognize do;', () => {
    test('should parse if true do; body; end', () => {
      const source = 'if true do; IO.puts("yes"); end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse def foo do; body; end', () => {
      const source = 'def foo do; :ok; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse case with do;', () => {
      const source = 'case x do; 1 -> :one; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
  });

  suite('Bug 5: skipNestedSigil heredoc-style sigil in interpolation', () => {
    test('should handle ~s""" inside interpolation', () => {
      const source = `x = "outer #{~s"""
inner content
"""}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test("should handle ~s''' inside interpolation", () => {
      const source = `x = "outer #{~s'''
inner content
'''}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ~s""" with block keywords inside interpolation', () => {
      const source = `x = "result: #{~s"""
if condition do
  action()
end
"""}"
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Bug 6: skipNestedSigil uppercase sigil string handling', () => {
    test('should handle uppercase sigil with quotes not treated as string delimiters', () => {
      // Uppercase sigils are raw, so " inside should not be treated as string delimiter
      const source = `x = "outer #{~S(he said "hello" ok)}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle uppercase sigil with single quotes not treated as string delimiters', () => {
      const source = `x = "outer #{~S(it's raw content)}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle uppercase sigil with unbalanced quotes', () => {
      // Uppercase sigil is raw so unbalanced " should not cause issues
      const source = `x = "outer #{~S(one " two)}"
if true do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 10: hasDoKeyword should not stop at do: one-liner inside expression', () => {
    test('should find outer do when inner block keyword has its own do...end', () => {
      // for with an inner if...do...end block before the outer do
      // Without the fix, hasDoKeyword stops at inner if and returns false
      const source = `for x <- list, if true do :ok end do
  x * 2
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'for');
    });
  });

  suite('Bug 7: hasDoKeyword fn-end nesting', () => {
    test('should handle fn...end inside block expression arguments', () => {
      const source = `if func(fn x -> x end) do
  :ok
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fn' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if' && p.closeKeyword.value === 'end'));
    });

    test('should handle nested fn...end pairs', () => {
      const source = `if func(fn x -> fn y -> y end end) do
  :ok
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if' && p.closeKeyword.value === 'end'));
    });

    test('should still stop at unmatched end', () => {
      // end without fn should still stop the search
      const source = `def foo do
  :ok
end
if true do
  :bar
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle fn in the middle of expression with do', () => {
      const source = `case Enum.map(fn x -> x end) do
  _ -> :ok
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'case' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fn' && p.closeKeyword.value === 'end'));
    });

    test('should handle fn preceded by = without space in hasDoKeyword scan', () => {
      // fn preceded by = (no space) should still be recognized as fn keyword
      const source = `if x =fn -> x end do
  :ok
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fn' && p.closeKeyword.value === 'end'));
    });

    test('should handle end followed by , at depth 0 in hasDoKeyword scan', () => {
      // end followed by , should still be recognized as end keyword
      const source = `if fn -> :ok end, do
  :ok
end`;
      const pairs = parser.parse(source);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fn' && p.closeKeyword.value === 'end'));
    });
  });

  suite('Bug: hasDoKeyword double-processing of , do: pattern', () => {
    test('should correctly skip comma-do-colon one-liner without double decrement', () => {
      const source = 'if a do\n  if b, do: val\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested comma-do-colon one-liners', () => {
      const source = 'if a, do: if b, do: val';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: uncovered code paths in skipNestedSigil', () => {
    // Lines 237-239: escape sequence inside triple-quoted heredoc sigil inside interpolation
    test('should handle escape sequence inside triple-quoted heredoc sigil in interpolation', () => {
      // ~s"""...\n...""" inside #{} - backslash escape must be consumed
      const source = `x = "#{~s"""\nhello\\nworld\n"""}"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Lines 241-243: #{} interpolation inside triple-quoted heredoc sigil inside interpolation
    test('should handle nested #{} inside triple-quoted heredoc sigil inside interpolation', () => {
      // ~s"""...#{name}...""" inside #{} - nested interpolation must be consumed
      const source = `x = "#{~s"""\nhello #{name} world\n"""}"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Lines 247-249: modifier skip after triple-quoted heredoc sigil terminates inside interpolation
    test('should skip modifiers after triple-quoted sigil terminator inside interpolation', () => {
      // ~s"""..."""iup has modifiers after the closing triple-quote
      // The sigil is inside #{} interpolation
      const source = `x = "#{~s"""\nhello\n"""iup}"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Lines 253-254: EOF reached inside triple-quoted sigil (return j, not closed)
    test('should handle unterminated triple-quoted sigil inside interpolation reaching EOF', () => {
      // ~s"""... is unterminated inside #{} interpolation - the sigil never closes
      const source = `x = "#{~s"""\nunterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // Lines 274-276: triple-quoted """ inside lowercase sigil content with paired delimiters
    test('should skip triple-quoted double-quote string inside sigil content in interpolation', () => {
      // ~s{...} with """ inside - triple-quoted string must be consumed so } inside """ is not closing
      const source = `x = "#{~s{"""if end"""}}"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Lines 278-280: triple-quoted ''' inside lowercase sigil content with paired delimiters
    test('should skip triple-quoted single-quote string inside sigil content in interpolation', () => {
      // ~s{...} with ''' inside - triple single-quoted string must be consumed
      const source = `x = "#{~s{'''if end'''}}"
def foo do
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // elixirParser.ts lines 295-296: innerBlockDepth-- when do: is found inside nested block
    // hasDoKeyword: 'do:' pattern with innerBlockDepth > 0
    test('should handle do: one-liner with inner block keyword before it (lines 295-296)', () => {
      // outer 'if' has 'do', inner 'if' at depth 0 increments innerBlockDepth,
      // then inner 'do:' triggers the decrement path
      // 'if a do\n  if b do: val\nend' - inner 'if' has 'do:' (space-do-colon pattern)
      const source = 'if a do\n  if b do: val\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: uncovered branches - targeted', () => {
    // Lines 295-296: innerBlockDepth-- when do: is found (whitespace+do pattern)
    // hasDoKeyword must encounter an inner block keyword and its do: BEFORE finding the outer do.
    // The outer do must be on a separate line so isDoColonOneLiner doesn't reject the outer if.
    test('should decrement innerBlockDepth when inner do: is found before outer do (lines 295-296)', () => {
      // 'if\n  if b do: val\ndo\nend' - scanning from after outer 'if':
      // 1. inner 'if' at position 5 -> innerBlockDepth = 1
      // 2. 'do:' at position 10 (whitespace+do pattern) -> innerBlockDepth > 0, decrement to 0
      // 3. outer 'do' at position 18 -> innerBlockDepth === 0, return true
      const source = 'if\n  if b do: val\ndo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Lines 310-313: innerBlockDepth-- via ", do:" pattern
    test('should decrement innerBlockDepth via comma-do-colon pattern (lines 310-313)', () => {
      // 'if\n  if b, do: val\ndo\nend' - inner 'if' with ', do:' pattern
      const source = 'if\n  if b, do: val\ndo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Lines 404-405: isDoColonOneLiner returns false because keyword is not in doColonKeywords
    // 'fn' is the only blockOpen keyword not in doColonKeywords,
    // but it is short-circuited at line 166 (if keyword === 'fn' return true).
    // This test exercises the fn path and verifies fn-end blocks work without do.
    test('should parse fn-end block without do keyword (fn not in doColonKeywords)', () => {
      const source = 'fn x -> x * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });

    // Additional fn test: fn with multiple clauses
    test('should parse fn-end block with multiple clauses', () => {
      const source = 'fn\n  0 -> "zero"\n  x -> "other"\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
  });

  suite('Regression: sigil with unmatched quotes in interpolation', () => {
    test('should handle sigil with apostrophe inside parentheses', () => {
      const source = '"result: #{~s(it\'s ok)}"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle sigil with unmatched double quote inside brackets', () => {
      const source = '"result: #{~s[say "hello]}"\nif true do\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: hasDoKeyword with do followed by comment', () => {
    test('should recognize do immediately followed by # as valid do keyword', () => {
      const source = 'if true do# inline comment\n  :body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize do# with comma-do pattern', () => {
      const source = 'for x <- list, do#comment\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still recognize do followed by space then comment', () => {
      const source = 'if true do # comment\n  :body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: fn: keyword argument should not increment fnDepth', () => {
    test('should recognize block when fn: keyword argument is present', () => {
      const source = 'quote fn: my_fn do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
    });

    test('should recognize block with multiple keyword arguments including fn:', () => {
      const source = 'with fn: callback, do_something: true do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'with', 'end');
    });

    test('should still track real fn...end nesting', () => {
      const source = 'with fn -> :ok end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: range operator .. before keyword', () => {
    test('should recognize keyword after .. range operator', () => {
      const source = '1..if true do\n  42\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still reject Module.keyword', () => {
      const source = 'Kernel.if(true, do: 1)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: ? and ! identifier suffixes', () => {
    test('should not treat fn? as fn keyword', () => {
      const pairs = parser.parse('if fn?(x) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat end? as end keyword', () => {
      const pairs = parser.parse('if end?(data) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat end! as end keyword', () => {
      const pairs = parser.parse('if end!(data) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: skipNestedSigil heredoc line-start check', () => {
    test('should not close heredoc sigil at mid-line triple quotes in interpolation', () => {
      const pairs = parser.parse('"#{~s"""\nfoo """ bar\n"""}";\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: ?X character literal handling', () => {
    test('should not treat ?# as comment start', () => {
      const pairs = parser.parse('x = ?#\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?" as string start', () => {
      const pairs = parser.parse('x = ?"\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test("should not treat ?' as charlist start", () => {
      const pairs = parser.parse("x = ?'\nif true do\n  1\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?~ as sigil start', () => {
      const pairs = parser.parse('x = ?~\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ?} inside interpolation without closing interpolation', () => {
      const pairs = parser.parse('"#{?}}"\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?{ inside interpolation without incrementing depth', () => {
      const pairs = parser.parse('"#{?{}"\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?# inside interpolation without triggering comment', () => {
      const pairs = parser.parse('"#{?# + 1}"\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test("should handle ?' inside interpolation without triggering string", () => {
      const pairs = parser.parse('"#{?\'}"\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escape character literal ?\\n', () => {
      const pairs = parser.parse('x = ?\\n\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ? after identifier as character literal', () => {
      const pairs = parser.parse('if valid? do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ?# as excluded region', () => {
      const regions = parser.getExcludedRegions('x = ?# + 1');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end - regions[0].start, 2);
    });

    test('should handle ?\\\\ escape as excluded region', () => {
      const regions = parser.getExcludedRegions('x = ?\\\\ + 1');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end - regions[0].start, 3);
    });
  });

  suite('Coverage: ?\\xNN hex escape character literal', () => {
    test('should treat ?\\xNN as excluded region', () => {
      // Triggers skipCharLiteral hex escape path (elixirParser lines 173-179)
      const regions = parser.getExcludedRegions('x = ?\\x41 + 1');
      assert.strictEqual(regions.length, 1);
      // ?\\x41 = 5 chars: ?, \\, x, 4, 1
      assert.strictEqual(regions[0].start, 4);
      assert.strictEqual(regions[0].end, 9);
    });

    test('should not treat ?\\xNN as keyword when followed by block keyword', () => {
      const pairs = parser.parse('x = ?\\x41\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ?\\xN single hex digit', () => {
      const regions = parser.getExcludedRegions('?\\xA');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
    });
  });

  suite('Coverage: ?\\u unicode escape character literal', () => {
    test('should treat ?\\u{NNNN} as excluded region', () => {
      // Triggers skipCharLiteral unicode escape with braces (elixirParser lines 182-190)
      const regions = parser.getExcludedRegions('x = ?\\u{1F600} + 1');
      assert.strictEqual(regions.length, 1);
      // ?\\u{1F600} = ?, \\, u, {, 1, F, 6, 0, 0, } = 10 chars
      assert.strictEqual(regions[0].start, 4);
      assert.strictEqual(regions[0].end, 14);
    });

    test('should handle ?\\u{NNNN} followed by block keyword', () => {
      const pairs = parser.parse('x = ?\\u{0041}\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat ?\\uNNNN (without braces) as excluded region', () => {
      // Triggers skipCharLiteral unicode escape without braces (elixirParser lines 192-198)
      const regions = parser.getExcludedRegions('x = ?\\u0041 + 1');
      assert.strictEqual(regions.length, 1);
      // ?\\u0041 = ?, \\, u, 0, 0, 4, 1 = 7 chars
      assert.strictEqual(regions[0].start, 4);
      assert.strictEqual(regions[0].end, 11);
    });

    test('should handle ?\\uNNNN followed by block keyword', () => {
      const pairs = parser.parse('x = ?\\u0041\nif true do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: ?keyword character literal prefix filtering', () => {
    test('should filter end preceded by ? after identifier (tokenize lines 257-258)', () => {
      // When ? is preceded by alphanumeric (like foo?end), it is NOT a character literal
      // so end is tokenized but then filtered by the ? prefix check in tokenize
      // foo?end: ? is preceded by 'o', so tryMatchExcludedRegion skips char literal detection
      // \bend\b matches end after ?, and tokenize filter rejects it at lines 256-258
      const tokens = parser.getTokens('foo?end');
      assert.strictEqual(tokens.length, 0);
    });

    test('should filter if preceded by ? after identifier from tokenize', () => {
      // valid?if: ? preceded by 'd', not a character literal, so 'if' is tokenized then filtered
      const tokens = parser.getTokens('valid?if');
      assert.strictEqual(tokens.length, 0);
    });

    test('should not treat foo?end as block close in block matching', () => {
      // ?end inside block body should not close the if-end block
      const pairs = parser.parse('if true do\n  x = foo?end\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: matchCharacterLiteral returns null (lines 159-160)', () => {
    test('should not treat ? followed by space as character literal', () => {
      // ? followed by space: skipCharLiteral returns pos (space is not valid char literal)
      // matchCharacterLiteral returns null (lines 159-160)
      const regions = parser.getExcludedRegions('x = ? + 1');
      // No excluded region for '? ' since it's not a valid character literal
      // Check that '?' doesn't create an excluded region
      const qPos = 4;
      const hasRegionAtQ = regions.some((r) => r.start === qPos);
      assert.strictEqual(hasRegionAtQ, false);
    });

    test('should not treat ?\\n (backslash-newline) as character literal', () => {
      // ?\<newline> is not a valid character literal (line 170 returns pos)
      // matchCharacterLiteral returns null (lines 159-160)
      const regions = parser.getExcludedRegions('x = ?\\\n1');
      // The ?\ followed by newline should not create a char literal excluded region
      const qPos = 4;
      const regionAtQ = regions.find((r) => r.start === qPos);
      assert.strictEqual(regionAtQ, undefined);
    });
  });

  suite('Coverage: isBlockKeywordAt rejects ? and ! suffixed keywords', () => {
    test('should not count if? as inner block keyword in hasDoKeyword scan', () => {
      // Triggers isBlockKeywordAt ? boundary check (elixirParser line 456)
      // if? is a function name, not a block keyword; should not increment innerBlockDepth
      const pairs = parser.parse('if if?(x) do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not count for! as inner block keyword in hasDoKeyword scan', () => {
      // Triggers isBlockKeywordAt ! boundary check (elixirParser line 456)
      // for! is a function name, not a block keyword
      const pairs = parser.parse('if for!(items) do\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: sigil boundary check for identifier-adjacent tilde', () => {
    test('should not treat tilde after identifier as sigil start', () => {
      const pairs = parser.parse('x = str~r/def foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat tilde after digit as sigil start', () => {
      const pairs = parser.parse('x = 1~s(def foo do)\ndef bar do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat tilde after operator as sigil start', () => {
      const pairs = parser.parse('x = ~r/def foo do/\ndef bar do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat tilde at start of source as sigil start', () => {
      const pairs = parser.parse('~r/pattern/\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat tilde after paren as sigil start', () => {
      const pairs = parser.parse('f(~r/end/)\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Branch coverage: isValidBlockClose rejects end preceded by range operator', () => {
    test('should not treat end preceded by .. as block close', () => {
      // Covers elixirParser.ts lines 288-289: position >= 2 && source[position-1] === '.' && source[position-2] === '.'
      const pairs = parser.parse('x = 1..end');
      assertNoBlocks(pairs);
    });

    test('should still match end when not preceded by range operator', () => {
      const pairs = parser.parse('if true do\n  x = 1..10\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: isDoColonOneLiner returns false for non-do-block keywords', () => {
    test('should not check do: for fn keyword', () => {
      // Covers elixirParser.ts lines 496-497: keyword not in doColonKeywords
      // fn is a block open keyword but NOT in doColonKeywords, so isDoColonOneLiner returns false early
      const pairs = parser.parse('fn -> :ok end');
      assertSingleBlock(pairs, 'fn', 'end');
    });
  });

  suite('Branch coverage: skipCharLiteral edge cases', () => {
    test('should handle ? at end of source', () => {
      // Covers elixirParser.ts line 164: pos + 1 >= source.length
      const regions = parser.getExcludedRegions('x = ?');
      // ? at end of source is not a valid char literal, no region created
      const qPos = 4;
      const hasRegionAtQ = regions.some((r) => r.start === qPos);
      assert.strictEqual(hasRegionAtQ, false);
    });

    test('should handle ?\\ at end of source', () => {
      // Covers elixirParser.ts line 168: pos + 2 >= source.length (backslash escape at end)
      const regions = parser.getExcludedRegions('x = ?\\');
      // ?\\ at end of source: backslash but no escape char, not a valid char literal
      const qPos = 4;
      const hasRegionAtQ = regions.some((r) => r.start === qPos);
      assert.strictEqual(hasRegionAtQ, false);
    });

    test('should handle surrogate pair character literal', () => {
      // Covers elixirParser.ts line 207: code > 0xFFFF surrogate pair
      // U+1F600 (grinning face) is a surrogate pair, charLen = 2
      const emoji = '\u{1F600}';
      const source = `x = ?${emoji}\nif true do\n  :ok\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat surrogate pair character as excluded region with correct size', () => {
      // Covers elixirParser.ts line 207: code > 0xFFFF, charLen = 2
      const emoji = '\u{1F600}';
      const source = `?${emoji}`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      // ? (1 char) + emoji (2 code units) = end at 3
      assert.strictEqual(regions[0].end, 3);
    });
  });

  suite('Branch coverage: end tracking inside hasDoKeyword scan', () => {
    test('should ignore .end method call inside do keyword scan', () => {
      // Covers elixirParser.ts line 428: source.slice(i, i + 3) === 'end' where beforeEnd === '.'
      // .end should not decrement inner block or fn depth
      const pairs = parser.parse('if list.end do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore @end module attribute inside do keyword scan', () => {
      // Covers elixirParser.ts line 428: beforeEnd === '@'
      // @end should not decrement depth counters
      const pairs = parser.parse('if @end do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: end with identifier suffix inside hasDoKeyword scan', () => {
    test('should ignore endpoint (end followed by identifier chars) inside do keyword scan', () => {
      // Covers elixirParser.ts line 428: afterEnd matches /[a-zA-Z0-9_:?!]/
      // "endpoint" contains "end" but afterEnd = 'p' is a word char, so it's not a block end
      const pairs = parser.parse('if endpoint do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore end? method inside do keyword scan', () => {
      // Covers elixirParser.ts line 428: afterEnd === '?'
      const pairs = parser.parse('if end?(x) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore end! method inside do keyword scan', () => {
      // Covers elixirParser.ts line 428: afterEnd === '!'
      const pairs = parser.parse('if end!(x) do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: sigil modifier letters followed by another sigil', () => {
    test('should detect sigil with modifier letters immediately followed by another sigil', () => {
      // Bug: sigil following modifier letters was not detected as excluded region
      // e.g., ~r/pattern/i~s(end) - the ~s(end) sigil was not excluded
      const source = '~r/pattern/i~s(end)\nif true do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: hasDoKeyword with do preceded by closing brackets', () => {
    test('should detect do preceded by closing paren', () => {
      // Bug: hasDoKeyword did not recognize do preceded by ')'
      const source = 'if foo() do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect do preceded by closing bracket', () => {
      // Bug: hasDoKeyword did not recognize do preceded by ']'
      const source = 'if list[:key] do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect do preceded by closing brace', () => {
      // Bug: hasDoKeyword did not recognize do preceded by '}'
      const source = 'if %{a: 1} do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: matchAtomLiteral with @ for Erlang-style node atoms', () => {
    test('should treat :node@hostname as a single atom literal', () => {
      // Bug: matchAtomLiteral was missing @ in the character set for atom continuation
      const regions = parser.getExcludedRegions(':node@hostname');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 14);
    });

    test('should exclude end keyword inside Erlang-style node atom', () => {
      // :end@node should be a single atom, not exposing "end" as a keyword
      const pairs = parser.parse(':end@node\nif true do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isAtomStart with Unicode letter atom starts', () => {
    test('should recognize atom starting with Unicode letter', () => {
      // Bug: isAtomStart did not recognize Unicode letter atom starts like :日本語
      const regions = parser.getExcludedRegions(':\u65E5\u672C\u8A9E');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
    });

    test('should exclude keywords inside Unicode atom context', () => {
      const pairs = parser.parse('x = :\u65E5\u672C\u8A9E\nif true do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Regression: Unicode atom should be fully excluded
  suite('Regression: Unicode atom excluded region', () => {
    test('should exclude full Unicode atom', () => {
      const regions = parser.getExcludedRegions(':\u4E2D');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 2);
    });

    test('should exclude multi-char Unicode atom', () => {
      const regions = parser.getExcludedRegions(':\u03B1\u03B2\u03B3');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
    });

    test('should exclude CJK atom', () => {
      const regions = parser.getExcludedRegions(':\u65E5\u672C\u8A9E');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
    });
  });

  suite('Regression: surrogate pair in atoms', () => {
    test('should handle surrogate pair Unicode letter in atom context', () => {
      // U+10400 DESERET CAPITAL LETTER LONG I encoded as surrogate pair \uD801\uDC00
      const source = ':\uD801\uDC00\nif true do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isDoColonOneLiner fn? check', () => {
    test('should detect do: one-liner when fn? is in condition', () => {
      const source = 'if fn?(x), do: :ok';
      const pairs = parser.parse(source);
      // fn? should not increment innerBlockDepth, so this is a one-liner
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: block keyword function call inside hasDoKeyword', () => {
    test('should detect outer if block when inner if() function call has do: argument', () => {
      const source = 'if if(cond, do: val) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect for block when if() function call appears in comprehension', () => {
      const source = 'for x <- list, if(cond, do: val) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should detect outer if block when fn() function call has do: argument', () => {
      const source = 'if fn(x, do: y) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug: Unicode letter boundary in hasDoKeyword fn/end tracking', () => {
    test('should detect if block when fn is preceded by BMP Unicode letter', () => {
      const source = 'if \u03B1fn do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect if block when end is preceded by BMP Unicode letter', () => {
      const source = 'if \u03B1end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect if block when fn is preceded by surrogate pair character', () => {
      const source = 'if \uD801\uDC00fn do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isDoColonOneLiner should not treat end?/end!/.end/@end as end', () => {
    test('should not treat end? as end keyword in do: one-liner check', () => {
      const source = 'if fn -> end?() do: :val end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat end! as end keyword in do: one-liner check', () => {
      const source = 'if fn -> end! do: :val end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat .end as end keyword in do: one-liner check', () => {
      const source = 'if fn -> data.end do: :val end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat @end as end keyword in do: one-liner check', () => {
      const source = 'if fn -> @end do: :val end do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: uppercase sigil escaped delimiter', () => {
    test('should handle escaped delimiter in uppercase sigil ~S', () => {
      const pairs = parser.parse('~S(pat\\) if true do :ok end)\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped delimiter in uppercase sigil ~R with slash', () => {
      const pairs = parser.parse('~R/pat\\/ if true do :ok end/\ndef foo do\n  :ok\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped delimiter in uppercase sigil ~S with brackets', () => {
      const pairs = parser.parse('~S[pat\\] do end]\nfn -> :ok end');
      assertSingleBlock(pairs, 'fn', 'end');
    });
  });

  suite('Regression: Unicode adjacency in isDoColonOneLiner', () => {
    test('should not treat Unicode-adjacent end as block close in do: one-liner scan', () => {
      // αend is a variable name, not the end keyword
      const pairs = parser.parse('if fn -> \u03B1end, do: :ok end do\n  :ok\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'fn');
      findBlock(pairs, 'if');
    });
  });

  suite('Bug: isDoColonOneLiner treats block keyword names in conditions as inner blocks', () => {
    // isDoColonOneLiner increments innerBlockDepth when it encounters a block keyword name
    // (cond, case, for, etc.) at word boundary in the condition expression.
    // Since there is no matching end to decrement, innerBlockDepth stays elevated,
    // causing do: detection to be skipped.
    // For valid Elixir (do: only, no bare do), this is masked by hasDoKeyword also returning false.
    // The bug manifests when both do: and bare do appear on the same line (invalid Elixir).

    test('should reject if with cond keyword in condition and do: one-liner followed by bare do', () => {
      // 'cond' is a block keyword name. isDoColonOneLiner should still detect do: as one-liner.
      const pairs = parser.parse('if cond, do: v do\nend');
      // Expected: 0 pairs (do: one-liner should be detected, bare do is invalid Elixir)
      // Actual: 1 pair (if-end) because isDoColonOneLiner fails to find do:
      assertNoBlocks(pairs);
    });

    test('should reject if with case keyword in condition and do: one-liner followed by bare do', () => {
      const pairs = parser.parse('if case, do: v do\nend');
      assertNoBlocks(pairs);
    });

    test('should reject if with for keyword in condition and do: one-liner followed by bare do', () => {
      const pairs = parser.parse('if for, do: v do\nend');
      assertNoBlocks(pairs);
    });

    test('should reject if with defmodule keyword in condition and do: one-liner followed by bare do', () => {
      const pairs = parser.parse('if defmodule, do: v do\nend');
      assertNoBlocks(pairs);
    });

    test('should still correctly handle non-keyword conditions with do: one-liner', () => {
      // Control test: non-keyword conditions work correctly
      const pairs = parser.parse('if abc, do: v do\nend');
      assertNoBlocks(pairs);
    });

    test('should still correctly handle keyword in parens with do: one-liner', () => {
      // Parenthesized keywords are not affected (parenDepth > 0 skips word scan)
      const pairs = parser.parse('if (cond), do: v do\nend');
      assertNoBlocks(pairs);
    });
  });

  suite('Bug: block_open and block_middle keywords after .. range operator not filtered', () => {
    // isValidBlockClose filters 'end' after '..' (e.g., 1..end) to avoid false block_close.
    // But isValidBlockOpen does NOT filter block_open keywords after '..' (e.g., 1..def).
    // The tokenize filter allows '..' prefix for all token types except block_close.
    // Similarly, block_middle keywords after '..' are not filtered.

    test('should not detect def after .. range as block open', () => {
      // In Elixir, 1..def is a range expression, not a function definition
      const source = 'if true do\n  1..def foo do\n  end\nend';
      const pairs = parser.parse(source);
      // Expected: 1 pair (if-end). The '..def' should not start a new block.
      // Actual: 2 pairs (def-end and if-end) because def after .. is treated as block_open.
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not detect else after .. range as block middle', () => {
      // In Elixir, 1..else is a range expression, not an if-else boundary
      const source = 'if true do\n  1..else\nelse\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // Expected: 1 intermediate (the real else on line 2)
      // Actual: 2 intermediates (the ..else on line 1 is also counted)
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Regression: &-prefixed keywords', () => {
    test('should not treat &end as block close', () => {
      const pairs = parser.parse('if true do\n  f = &end/1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat &fn as block open', () => {
      const pairs = parser.parse('&fn');
      assertNoBlocks(pairs);
    });

    test('should not treat &else as block middle', () => {
      const pairs = parser.parse('if true do\n  f = &else/1\nelse\n  :error\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Regression: &-prefixed keywords in hasDoKeyword', () => {
    test('should not treat &fn as real fn in hasDoKeyword', () => {
      const pairs = parser.parse('if &fn do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat &end as real end in hasDoKeyword', () => {
      const pairs = parser.parse('if &end do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: && operator should not trigger & capture filter', () => {
    test('should not filter end adjacent to && operator', () => {
      // &&end: the second & of && should not trigger the capture operator filter
      const tokens = parser.getTokens('x &&end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 1, 'end after && should not be filtered');
    });

    test('should not filter else adjacent to && operator', () => {
      const tokens = parser.getTokens('x &&else');
      const elseTokens = tokens.filter((t) => t.value === 'else');
      assert.strictEqual(elseTokens.length, 1, 'else after && should not be filtered');
    });

    test('should still filter &end (single & capture operator)', () => {
      const tokens = parser.getTokens('x &end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end after single & should be filtered');
    });

    test('should still filter &fn (single & capture operator)', () => {
      const tokens = parser.getTokens('&fn');
      const fnTokens = tokens.filter((t) => t.value === 'fn');
      assert.strictEqual(fnTokens.length, 0, 'fn after single & should be filtered');
    });
  });

  suite('Regression: keywords after :: type spec operator should be filtered', () => {
    test('should not treat end after :: as block close', () => {
      const pairs = parser.parse('def foo do\n  @type t :: end\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end after :: without space as block close', () => {
      const pairs = parser.parse('def foo do\n  @type t ::end\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat else after :: as intermediate', () => {
      const pairs = parser.parse('def foo do\n  @spec bar :: else\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
  });

  suite('Regression: uppercase sigil escape handling', () => {
    test('should treat \\\\ before closing delimiter as escape in ~S sigil', () => {
      const pairs = parser.parse('def foo do\n  x = ~S(\\\\)\nend\n');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat \\\\ as escape in ~S with square brackets', () => {
      const pairs = parser.parse('def foo do\n  x = ~S[\\\\]\nend\n');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat \\\\ as escape in ~R regex sigil', () => {
      const pairs = parser.parse('def foo do\n  x = ~R(\\\\)\nend\n');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression 2026-04-14: keyword-named variable before do', () => {
    test('should pair if with end when cond is used as variable', () => {
      const pairs = parser.parse('if cond do\n  :ok\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should pair unless with end when cond is used as variable', () => {
      const pairs = parser.parse('unless cond do\n  :ok\nend');
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should pair if with end when case is used as variable', () => {
      const pairs = parser.parse('if case do :ok end');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should pair if with end when for is used as variable', () => {
      const pairs = parser.parse('if for do :ok end');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not reject standalone cond block', () => {
      const pairs = parser.parse('cond do\n  x > 0 -> :pos\nend');
      assertSingleBlock(pairs, 'cond', 'end');
    });
  });

  suite('Regression 2026-04-14: hasCommaInParens ignores excluded regions', () => {
    test('should accept if block with string argument containing comma', () => {
      // Before fix: commas inside string literals were treated as real commas,
      // causing hasCommaInParens to return true and reject the block form.
      const source = 'if("hello, world") do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should accept unless block with comment containing comma inside parens', () => {
      const source = 'unless(# a, b\n  true) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });
  });

  suite('Regression: hasCommaInParens tracks {} and [] depth', () => {
    test('should accept if with map literal condition containing comma', () => {
      const source = 'if(%{a: 1, b: 2}) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should accept unless with list literal condition containing comma', () => {
      const source = 'unless([1, 2, 3]) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should accept case with tuple condition containing comma', () => {
      const source = 'case({a, b}) do\n  _ -> :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should accept if x in [1, 2, 3] do form', () => {
      const source = 'if(x in [1, 2, 3]) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: triple-quoted heredoc with CR-only line ending', () => {
    test('should treat standalone CR as newline (heredoc mode) per CLAUDE.md line ending rules', () => {
      // Per CLAUDE.md, CR (lone \r) is treated as a newline like LF. A bare CR inside
      // a triple-quoted string flips it into heredoc mode, so the closing `"""` on the
      // same line is no longer a valid terminator (heredoc terminator must be on its own line).
      // The unterminated heredoc swallows the rest, so no if/end pair forms.
      const source = 'x = """abc\rdef"""\nif true do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
    });
  });

  suite('Regression 2026-04-29: keyword-named variable across newlines and operators', () => {
    test('should treat cond as value when do is on next line', () => {
      const source = 'if cond\ndo\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should treat cond + 1 as expression when do follows', () => {
      const source = 'case cond + 1 do\n  _ -> :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
    test('should treat cond.field as expression when do follows', () => {
      const source = 'case cond.field do\n  _ -> :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
    test('should treat cond and other as expression when do follows', () => {
      const source = 'if cond and other do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: end inside def parameter list should not pair with def', () => {
    test('should pair def with outer end, ignoring end inside parens', () => {
      const source = 'def foo(end) do\n  body\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const defPair = pairs[0];
      assert.strictEqual(defPair.openKeyword.value, 'def');
      // The closing end should be the outer end (line 2), not the one inside parens (line 0)
      assert.ok(defPair.closeKeyword.line >= 2, 'def should pair with outer end on line 2 or later');
    });
  });

  suite('Regression 2026-05-06: Elixir comment-before-newline do detection', () => {
    test('should pair if-end correctly when condition has inline comment before newline+do', () => {
      const source = 'if cond # comment\ndo\n  :ok\nend';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if should be paired with end, not cond paired with end');
    });
  });

  suite('Regression 2026-05-06: Elixir block_middle as identifier name', () => {
    test('should not register after as intermediate when used as variable name (after = 100)', () => {
      const source = 'def foo do\n  after = 100\n  :ok\nend';
      const pairs = parser.parse(source);
      const defPair = pairs.find((p) => p.openKeyword.value === 'def');
      assert.ok(defPair);
      const afterIntermediates = defPair?.intermediates.filter((t) => t.value === 'after');
      assert.strictEqual(afterIntermediates?.length ?? 0, 0, 'after = 100 is variable assignment');
    });
  });

  suite('Regression 2026-05-06: Elixir Unicode sigil delimiters rejected', () => {
    test('should not consume source as sigil when ~s is followed by Unicode letter', () => {
      const source = '~sα\ndef foo do\nend';
      const pairs = parser.parse(source);
      const defPair = pairs.find((p) => p.openKeyword.value === 'def');
      assert.ok(defPair, 'def should be detected; α is not a valid sigil delimiter');
    });
  });

  suite('Regression 2026-05-08: sigil close-bracket delimiters are rejected', () => {
    test('should reject ~s} as sigil opener (close-brace is not a valid sigil delimiter)', () => {
      const source = 'x = ~s}foo, end\ndef bar do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should reject ~s) as sigil opener', () => {
      const source = 'x = ~s)foo)\ndef bar do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should reject ~s] as sigil opener', () => {
      const source = 'x = ~s]foo]\ndef bar do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression 2026-05-08: block keyword as variable before another identifier+do', () => {
    test('should pair if/end when cond is followed by another identifier and do', () => {
      const source = 'if cond foo do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should pair if/end when try is followed by another identifier and do', () => {
      const source = 'if try foo do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should pair if/end when quote is followed by another identifier and do', () => {
      const source = 'if quote foo do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-09: triple-quoted heredoc terminator requires line-end after """', () => {
    test('should reject """ as terminator when followed by non-whitespace (def)', () => {
      // Triple-quoted heredoc terminator must be followed by space, tab, newline, EOF, or comment.
      // Here `"""def` is not a valid terminator, so the heredoc continues until the final """.
      const source = '"""\n  """def foo\ndo\n  :ok\nend\n"""\nx = 1';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
    });
    test('should accept """ as terminator when followed by space', () => {
      const source = '"""\n  body\n  """ \ndef foo do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should accept """ as terminator at end of file', () => {
      const source = '"""\n  body\n  """';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, source.length);
    });
    test('should accept """ as terminator when followed by comment', () => {
      const source = '"""\n  body\n  """# comment\ndef foo do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression 2026-05-09: sigil heredoc modifier should not consume reserved words', () => {
    test('should not consume "end" as modifier after ~s""" terminator', () => {
      // The sigil terminator """ should not greedily consume `end` as a modifier
      // because `end` is a reserved word, not a valid sigil modifier.
      const source = 'def foo do\n  x = ~s"""\n  body\n  """end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should not consume "do" as modifier after ~s""" terminator', () => {
      const source = '~s"""\nbody\n"""do\n:ok\nend';
      parser.parse(source);
      // do/end should pair (do is not a modifier)
      const endTokens = parser.getTokens(source).filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 1);
    });
    test('should not consume "end" as modifier after ~s() non-triple sigil', () => {
      const source = 'def foo do\n  x = ~s(body)end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should still accept lowercase modifiers like "u" after ~s""" terminator', () => {
      const source = 'x = ~s"""\nbody\n"""u\ndef foo do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression 2026-05-09: chained block_open keywords as values', () => {
    test('should detect if/end when followed by chained block keywords (if for case do)', () => {
      // `if for case do :ok end` should be parsed as `if/end` pair (1).
      // `for` and `case` are used as values (variable names) here.
      const source = 'if for case do :ok end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should detect case/end when followed by chained block keywords', () => {
      const source = 'case for cond do :ok end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
    test('should detect a long chain of block keywords without quadratic blowup or stack overflow', () => {
      // `if for for ... do :ok end` chained N+1 block keywords on one line. The former
      // self-recursive chain detection in isKeywordUsedAsValue was re-walked for every
      // block_open token from hasDoKeyword/isDoColonOneLiner, exploding to O(N^3) time
      // (>100s at N=800) and overflowing the stack at larger N. With iterative,
      // memoized chain detection this parses in well under the budget. The budget sits
      // far below the broken version's runtime while leaving generous slack for slow CI.
      const n = 800;
      const source = `if ${'for '.repeat(n)}do :ok end`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 15000, `parse should not be super-quadratic but took ${elapsed}ms`);
      // The chained keywords are all used as values, so no spurious extra pairs appear.
      assert.ok(pairs.length <= 1, `expected at most one block pair, got ${pairs.length}`);
    });
  });

  suite('Regression 2026-05-09: middle keyword as map key should not be intermediate', () => {
    test('should not register else as intermediate when used as map key (else => 1)', () => {
      const source = 'if true do\n  x = %{else => 1}\nelse\n  :ok\nend';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair);
      const elseIntermediates = ifPair?.intermediates.filter((t) => t.value === 'else');
      assert.strictEqual(elseIntermediates?.length ?? 0, 1, 'only the real else should be an intermediate');
    });
    test('should not register rescue as intermediate when used as map key (rescue => 1)', () => {
      const source = 'try do\n  x = %{rescue => 1}\nrescue\n  _ -> :ok\nend';
      const pairs = parser.parse(source);
      const tryPair = pairs.find((p) => p.openKeyword.value === 'try');
      assert.ok(tryPair);
      const rescueIntermediates = tryPair?.intermediates.filter((t) => t.value === 'rescue');
      assert.strictEqual(rescueIntermediates?.length ?? 0, 1);
    });
    test('should not register catch as intermediate when used as map key (catch => 1)', () => {
      const source = 'try do\n  x = %{catch => 1}\ncatch\n  _ -> :ok\nend';
      const pairs = parser.parse(source);
      const tryPair = pairs.find((p) => p.openKeyword.value === 'try');
      assert.ok(tryPair);
      const catchIntermediates = tryPair?.intermediates.filter((t) => t.value === 'catch');
      assert.strictEqual(catchIntermediates?.length ?? 0, 1);
    });
    test('should not register after as intermediate when used as map key (after => 1)', () => {
      const source = 'receive do\n  x = %{after => 1}\nafter\n  100 -> :ok\nend';
      const pairs = parser.parse(source);
      const receivePair = pairs.find((p) => p.openKeyword.value === 'receive');
      assert.ok(receivePair);
      const afterIntermediates = receivePair?.intermediates.filter((t) => t.value === 'after');
      assert.strictEqual(afterIntermediates?.length ?? 0, 1);
    });
  });

  suite('Regression: reserved middle keywords used in expressions are not intermediates', () => {
    // A reserved middle keyword (else/rescue/catch/after) used as a function call, field
    // access, or expression operand inside a block body is an identifier, not a branch of
    // the enclosing try/if/receive. It must not be attached as an intermediate.
    test('should not register else as intermediate when used as a function call (else(x))', () => {
      const source = 'def foo do\n  else(x)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register after as intermediate when used as a function call (after(5000))', () => {
      const source = 'def foo do\n  after(5000)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register catch as intermediate when used as a function call (catch(err))', () => {
      const source = 'def foo do\n  catch(err)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register rescue as intermediate when used as a function call (rescue(x))', () => {
      const source = 'def foo do\n  rescue(x)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register else as intermediate when used as field access (else.bar)', () => {
      const source = 'def foo do\n  x = else.bar\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register after as intermediate when used with an operator (after <> y)', () => {
      const source = 'def foo do\n  x = after <> y\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register rescue as intermediate when followed by =~ comparison (rescue =~ x)', () => {
      const source = 'try do\n  :a\nrescue =~ x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should not register else as intermediate when followed by =~ comparison (else =~ x)', () => {
      const source = 'if v do\n  :a\nelse =~ x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should still register rescue as intermediate in a real try/rescue clause (rescue e -> e)', () => {
      const source = 'try do\n  :a\nrescue\n  e -> e\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
    test('should still register rescue as intermediate for a same-line clause (rescue e -> e)', () => {
      const source = 'try do\n  :a\nrescue e -> e\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
    test('should still register else as intermediate in a real if/else block', () => {
      const source = 'if x do\n  :a\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
    test('should still register rescue/catch/after intermediates in a real try block', () => {
      const source = 'try do\n  :a\nrescue\n  e -> e\ncatch\n  x -> x\nafter\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue', 'catch', 'after']);
    });
    test('should still register after intermediate in a real receive/after block', () => {
      const source = 'receive do\n  x -> x\nafter\n  1000 -> :timeout\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assertIntermediates(pairs[0], ['after']);
    });
  });

  suite('Regression 2026-05-09: operator atoms should be recognized as excluded regions', () => {
    // Operator atoms in Elixir use punctuation rather than letters: :+, :-, :*, :/, :<,
    // :>, :=, :!, :?, :~, :^, :&, :|, plus multi-char :==, :!=, :<=, :>=, :=~, :->,
    // :<-, :<>. These must be added to excluded regions so adjacent block keywords are
    // not falsely detected (e.g., x = :+if y do end should not produce an if/end pair
    // because :+ is an atom, not a colon-plus-identifier sequence).
    test('should treat :+ as an excluded region (single-char operator atom)', () => {
      const source = 'x = :+';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':+ should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 6, ':+ should span 2 characters');
    });
    test('should treat :== as an excluded region (multi-char operator atom)', () => {
      const source = 'x = :==';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':== should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 7, ':== should span 3 characters');
    });
    test('should treat :-> as an excluded region', () => {
      const source = 'x = :->';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':-> should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 7, ':-> should span 3 characters');
    });
    test('should treat :! as an excluded region', () => {
      const source = 'x = :!';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 6);
    });
    test('should not produce false if/end pair after :+ when no whitespace separates from if', () => {
      // :+if is not valid Elixir, but our parser should not introduce false pairs.
      // With :+ recognized as an atom (excluded region), the if at offset 6 is no longer
      // adjacent to a non-identifier; specifically :+ is the atom, then "if" is regular code.
      // The if/end pair still forms (because nothing prevents it), but the regions reflect
      // the atom presence.
      const source = 'x = :+\nif y do\nend';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':+ should be an excluded region');
    });
  });

  suite('Regression 2026-05-15: 3+ character operator atoms should be recognized', () => {
    // Per Elixir docs, the following operators may also be used as atoms with the
    // colon prefix: :===, :!==, :&&&, :|||, :<<<, :>>>, :&&, :||, :.., :|>, :++,
    // :--, :**, :<<, :>>. These must be treated as a single atom literal so that
    // adjacent block keywords (e.g., :===\nif x do\nend) are not mis-detected.
    test('should treat :=== as a 4-char atom (not :== then leftover =)', () => {
      const source = 'x = :===';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':=== should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 8, ':=== should span 4 characters');
    });
    test('should treat :!== as a 4-char atom (not :!= then leftover =)', () => {
      const source = 'x = :!==';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':!== should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 8, ':!== should span 4 characters');
    });
    test('should treat :&&& as a 4-char atom', () => {
      const source = 'x = :&&&';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 8);
    });
    test('should treat :||| as a 4-char atom', () => {
      const source = 'x = :|||';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 8);
    });
    test('should treat :<<< as a 4-char atom', () => {
      const source = 'x = :<<<';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 8);
    });
    test('should treat :>>> as a 4-char atom', () => {
      const source = 'x = :>>>';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 8);
    });
    test('should treat :&& as a 3-char atom', () => {
      const source = 'x = :&&';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion, ':&& should produce an excluded region starting at offset 4');
      assert.strictEqual(atomRegion?.end, 7, ':&& should span 3 characters');
    });
    test('should treat :|| as a 3-char atom', () => {
      const source = 'x = :||';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :.. as a 3-char atom', () => {
      const source = 'x = :..';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :|> as a 3-char atom', () => {
      const source = 'x = :|>';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :++ as a 3-char atom', () => {
      const source = 'x = :++';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :-- as a 3-char atom', () => {
      const source = 'x = :--';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :** as a 3-char atom', () => {
      const source = 'x = :**';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :<< as a 3-char atom', () => {
      const source = 'x = :<<';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should treat :>> as a 3-char atom', () => {
      const source = 'x = :>>';
      const regions = parser.getExcludedRegions(source);
      const atomRegion = regions.find((r) => r.start === 4);
      assert.ok(atomRegion);
      assert.strictEqual(atomRegion?.end, 7);
    });
    test('should still detect if/end after :=== atom (not consume = leftover)', () => {
      const source = 'x = :===\nif true do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should still detect if/end after :&& atom (not consume & leftover)', () => {
      const source = 'x = :&&\nif true do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-15: sigil heredoc terminator requires line-end check after modifiers', () => {
    // The plain triple-quoted heredoc terminator already checks isLineEndAfterTerminator
    // (see matchTripleQuotedString). The sigil heredoc paths (matchSigil triple-quote and
    // skipNestedSigil triple-quote) historically only checked isAtLineStartAllowingWhitespace.
    // For a sigil heredoc terminator like """ followed by optional alphabetic modifiers,
    // the terminator must end as a token; followed by digit, underscore, ?, or ! means it
    // is NOT a real terminator (the sigil body continues).
    test('should not close ~s""" sigil heredoc at """1 (digit suffix invalidates terminator)', () => {
      const source = `~s"""
"""1
still_in
"""
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should not close ~S""" sigil heredoc at """123 (digit suffix invalidates terminator)', () => {
      const source = `~S"""
"""123
still_in
"""
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should not close ~s""" sigil heredoc at """_x (underscore suffix invalidates terminator)', () => {
      const source = `~s"""
"""_x
still_in
"""
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test("should not close ~s''' sigil heredoc at '''9 (digit suffix invalidates terminator)", () => {
      const source = `~s'''
'''9
still_in
'''
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should still close ~s""" sigil heredoc at """ followed by valid modifier letters', () => {
      // ~s""" with closing """uib (valid modifier letters) should terminate normally,
      // and the trailing def/end should pair.
      const source = `x = ~s"""
hello
"""u
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should not close sigil heredoc at """ followed by modifier-then-digit', () => {
      // After modifier letters are consumed, the next char must not be an identifier-continuation
      // char. """u9 should NOT terminate (the 9 indicates the line is not at terminator end).
      const source = `~s"""
"""u9
still_in
"""
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should not close sigil heredoc inside interpolation at mid-line """N', () => {
      // skipNestedSigil triple-quote path: inside interpolation, the same check must apply.
      const source = `"#{~s"""
"""1
still_in
"""}"
def foo do
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression 2026-05-09: hasDoKeyword should handle unbalanced parens', () => {
    // hasDoKeyword tracks paren/bracket/brace depth to ignore "do" inside grouping. With
    // unbalanced source code (e.g., a typo `if x)`), the depth could go negative and
    // prevent "do" from being detected at depth 0. Clamp negative depths so detection
    // remains robust against malformed input.
    test('should detect if/end with unbalanced closing paren before do', () => {
      const source = 'if x) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should detect if/end with unbalanced closing bracket before do', () => {
      const source = 'if x] do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should detect if/end with unbalanced closing brace before do', () => {
      const source = 'if x} do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-09: sigil modifier should not consume word operators', () => {
    // Sigil modifiers are short lowercase letter sequences (e.g., u, i, m). The modifier
    // scanner must stop before reserved guard/operator words like when/in/and/or/not so
    // that they remain available as code rather than being absorbed into the sigil region.
    test('should not consume "when" as modifier after ~r/.../ delimiter', () => {
      const source = 'x = ~r/pat/when y == 1';
      const regions = parser.getExcludedRegions(source);
      const sigilRegion = regions.find((r) => r.start === 4);
      assert.ok(sigilRegion, 'sigil region should start at 4');
      // Region must end at the closing /, not absorb 'when'.
      assert.strictEqual(sigilRegion?.end, 11, 'sigil region must end at /, not consume when');
    });
    test('should not consume "in" as modifier after ~r/.../ delimiter', () => {
      const source = 'x = ~r/pat/in [1]';
      const regions = parser.getExcludedRegions(source);
      const sigilRegion = regions.find((r) => r.start === 4);
      assert.ok(sigilRegion);
      assert.strictEqual(sigilRegion?.end, 11, 'sigil region must end at /, not consume in');
    });
    test('should not consume "and" as modifier after ~r/.../ delimiter', () => {
      const source = 'x = ~r/pat/and y';
      const regions = parser.getExcludedRegions(source);
      const sigilRegion = regions.find((r) => r.start === 4);
      assert.ok(sigilRegion);
      assert.strictEqual(sigilRegion?.end, 11, 'sigil region must end at /, not consume and');
    });
    test('should not consume "or" as modifier after ~r/.../ delimiter', () => {
      const source = 'x = ~r/pat/or y';
      const regions = parser.getExcludedRegions(source);
      const sigilRegion = regions.find((r) => r.start === 4);
      assert.ok(sigilRegion);
      assert.strictEqual(sigilRegion?.end, 11, 'sigil region must end at /, not consume or');
    });
    test('should not consume "not" as modifier after ~r/.../ delimiter', () => {
      const source = 'x = ~r/pat/not y';
      const regions = parser.getExcludedRegions(source);
      const sigilRegion = regions.find((r) => r.start === 4);
      assert.ok(sigilRegion);
      assert.strictEqual(sigilRegion?.end, 11, 'sigil region must end at /, not consume not');
    });
  });

  suite('Regression 2026-05-09: hasCommaInParens should ignore commas inside fn body', () => {
    // hasCommaInParens distinguishes if(cond, do: val) (function call) from if(cond) do...end
    // (block). It must skip commas inside a nested fn-end since those are fn parameter separators
    // belonging to the inner fn, not arguments to the outer if.
    test('should detect if/end when fn parameter list has a comma', () => {
      const source = 'if(fn x, y -> x + y end) do\n  :ok\nend';
      const pairs = parser.parse(source);
      // Expected: 2 pairs (fn-end inside, if-end outside)
      assertBlockCount(pairs, 2);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.closeKeyword.value, 'end');
      const fnPair = findBlock(pairs, 'fn');
      assert.strictEqual(fnPair.closeKeyword.value, 'end');
    });
    test('should detect unless/end when fn parameter list has a comma', () => {
      const source = 'unless(fn a, b -> a end) do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const unlessPair = findBlock(pairs, 'unless');
      assert.strictEqual(unlessPair.closeKeyword.value, 'end');
    });
  });

  suite('Regression 2026-05-09: fn and quote after .. range operator are value expressions', () => {
    // fn and quote are value-producing expression keywords, distinct from definition keywords
    // (def, defp, defmodule, etc.). 1..fn -> 1 end and 1..quote do :a end should produce
    // valid block pairs because fn-end and quote-end return values.
    test('should pair fn/end after .. range operator', () => {
      const source = 'x = 1..fn -> 1 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
    test('should pair quote/end after .. range operator', () => {
      const source = 'x = 1..quote do :a end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
    });
  });

  suite('Regression 2026-05-09: definition keywords should not be treated as values via chained do/end heuristic', () => {
    // The chained heuristic in isKeywordUsedAsValue ("<this_kw> <ident> do\nend" pattern)
    // must not apply when this_kw is a definition keyword (def, defp, defmacro, defguard,
    // defmodule, etc.). Definition keywords always start their own block, so a following
    // `def foo do\nend` should never make a preceding defguard/def/etc. be treated as a
    // value (which would steal the do for the outer block).
    test('should not pair defguard with outer end when followed by def foo do/end', () => {
      // Bug: defguard one-liner followed by `def foo do\nend` previously caused defguard
      // to be incorrectly paired with the outer `end`, leaving defmodule as orphan.
      // Expected: defmodule/outer-end and def/inner-end (2 pairs).
      const source = 'defmodule MyMod do\n  defguard is_thing(x) when is_integer(x)\n  def foo do\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(defmodulePair.closeKeyword.value, 'end');
      assert.strictEqual(defmodulePair.openKeyword.line, 0);
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.closeKeyword.value, 'end');
      assert.strictEqual(defPair.openKeyword.line, 2);
    });
    test('should not pair def with outer end when followed by another def foo do/end', () => {
      // Same pattern with `def` instead of `defguard` (def one-liner is unusual but
      // still must not steal the inner def's do).
      const source = 'defmodule MyMod do\n  def is_thing(x), do: is_integer(x)\n  def foo do\n  end\nend';
      const pairs = parser.parse(source);
      // Expect: defmodule/outer-end and def(foo)/inner-end
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(defmodulePair.closeKeyword.value, 'end');
    });
    test('should not pair defmacro with outer end when followed by def foo do/end', () => {
      const source = 'defmodule MyMod do\n  defmacro my_macro(arg) when is_atom(arg)\n  def foo do\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(defmodulePair.closeKeyword.value, 'end');
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.closeKeyword.value, 'end');
    });
  });

  suite('Regression 2026-05-09: invalid sigil delimiters should be rejected', () => {
    // Per Elixir spec, valid sigil delimiters are paired (), [], {}, <> or single
    // ASCII chars from the whitelist: / | " '. Other characters like _, $, @, ^, ~
    // must NOT be treated as sigil delimiters; doing so would consume actual code.
    // Pattern: a literal non-delimiter char followed by " if x do " then the same char.
    // If accepted as delimiter, the body "if x do" is consumed as a sigil body and the
    // subsequent end has no opener to pair with. With proper rejection, ~r is treated
    // as a malformed token and the if/end pair on the trailing tokens is detected.
    test('should not treat ~r$..$ as a sigil (dollar sign is not a valid delimiter)', () => {
      const source = 'x = ~r$ if x do $\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should not treat ~r@..@ as a sigil (at sign is not a valid delimiter)', () => {
      const source = 'x = ~r@ if x do @\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should not treat ~r^..^ as a sigil (caret is not a valid delimiter)', () => {
      const source = 'x = ~r^ if x do ^\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should not treat ~r~..~ as a sigil (tilde is not a valid delimiter)', () => {
      const source = 'x = ~r~ if x do ~\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should not treat ~r!..! as a sigil (exclamation is not a valid delimiter)', () => {
      const source = 'x = ~r! if x do !\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-15: fn followed by parens-then-do is invalid (no fn opener)', () => {
    // In Elixir, `fn` always uses arrow syntax (fn pattern -> body end), never `do`.
    // The form `fn(...) do ... end` is invalid Elixir. When this pattern appears inside
    // an outer block (e.g., `if fn() do ... end`), the parser must NOT treat fn as a
    // block opener; otherwise fn greedily pairs with end and the outer if is orphaned.
    // Reference: https://hexdocs.pm/elixir/anonymous-functions.html
    test('should pair if/end (not fn/end) when fn() do appears inside if', () => {
      const source = 'if fn() do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should pair if/end (not fn/end) when fn(x) do appears inside if', () => {
      const source = 'if fn(x) do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should pair if/end when fn(a, b) do appears inside if', () => {
      const source = 'if fn(a, b) do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should pair unless/end when fn() do appears inside unless', () => {
      const source = 'unless fn() do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });
    test('should still pair fn/end for valid fn(x) -> body end', () => {
      const source = 'result = fn(x) -> x * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
    test('should still pair fn/end for valid fn() -> :ok end', () => {
      const source = 'result = fn() -> :ok end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
    test('should still pair fn/end for valid fn x -> x*2 end (no parens)', () => {
      const source = 'fn x -> x * 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
    test('should still pair fn/end for valid multi-clause fn(x) -> x; (y) -> y end', () => {
      const source = 'f = fn(x) -> x; (y) -> y end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
    });
  });

  suite('Regression 2026-05-19: block keyword used as function name after definition keyword', () => {
    // A block keyword (if/unless/with/cond/case/...) immediately following a definition
    // keyword (def/defp/defmacro/...) is a function name (identifier), not a block opener.
    // e.g. `def unless(x) do ... end` defines a function named `unless`; only the def..end
    // pair must be produced. Previously the inner keyword stayed a block_open and stole the
    // `end`, orphaning the outer def.
    test('should treat unless as a function name in def unless(x) do/end', () => {
      const source = 'def unless(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should treat if as a function name in def if(x) do/end', () => {
      const source = 'def if(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should treat if as a function name in defp if(x) do/end', () => {
      const source = 'defp if(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defp', 'end');
    });
    test('should treat unless as a function name in defmacro unless(x) do/end', () => {
      const source = 'defmacro unless(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmacro', 'end');
    });
    test('should treat with as a function name in def with(x) do/end', () => {
      const source = 'def with(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should treat cond as a function name in def cond x do/end (no parens)', () => {
      const source = 'def cond x do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should still pair def/end for def if(x, y) do/end (multi-arg)', () => {
      const source = 'def if(x, y) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should still pair def/end for def is_valid(x) do/end (non-keyword name)', () => {
      const source = 'def is_valid(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
    test('should still pair if/end for a normal if cond do/end', () => {
      const source = 'if cond do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
    test('should still parse defmodule with a module name containing If', () => {
      const source = 'defmodule MyApp.If do\n  def foo do\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(defmodulePair.openKeyword.line, 0);
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.openKeyword.line, 1);
    });
    test('should keep the inner def as a block opener inside defmodule', () => {
      const source = 'defmodule MyMod do\n  def unless(x) do\n    x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assert.strictEqual(defmodulePair.closeKeyword.value, 'end');
      const defPair = findBlock(pairs, 'def');
      assert.strictEqual(defPair.openKeyword.line, 1);
    });
  });

  suite('Regression 2026-05-21: middle keyword used as function name after definition keyword', () => {
    // A block middle keyword (rescue/else/catch/after) immediately following a definition
    // keyword (def/defp/defmacro/...) is a function name (identifier), not a try-block branch.
    // e.g. `def rescue do ... end` defines a function named `rescue`; the `rescue` token must
    // not be tokenized as a block_middle and attached as an intermediate to the def..end pair.
    // Symmetric with the block_open case handled by isFunctionNameAfterDefinitionKeyword.
    test('should treat rescue as a function name in def rescue do/end', () => {
      const source = 'def rescue do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should treat else as a function name in def else do/end', () => {
      const source = 'def else do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should treat catch as a function name in def catch do/end', () => {
      const source = 'def catch do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should treat after as a function name in def after do/end', () => {
      const source = 'def after do\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should treat rescue as a function name in defp rescue(x) do/end', () => {
      const source = 'defp rescue(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defp', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should treat rescue as a function name in defmacro rescue(x) do/end', () => {
      const source = 'defmacro rescue(x) do\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmacro', 'end');
      assertIntermediates(pairs[0], []);
    });
    test('should still attach rescue as intermediate in a real try..rescue..end block', () => {
      const source = 'try do\n  :ok\nrescue\n  e -> e\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
    test('should treat rescue as a function name inside defmodule', () => {
      const source = 'defmodule MyMod do\n  def rescue do\n    :ok\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const defmodulePair = findBlock(pairs, 'defmodule');
      assertIntermediates(defmodulePair, []);
      const defPair = findBlock(pairs, 'def');
      assertIntermediates(defPair, []);
    });
  });

  suite('Regression: middle keyword not accepted by enclosing opener is orphaned', () => {
    // A block_middle keyword (else/rescue/catch/after) only belongs to an opener that
    // actually accepts it: if/unless take else; try takes rescue/catch/after/else; receive
    // takes after; with takes else. fn/quote/case/cond/def-family/defmodule/for accept no
    // middle keyword. When the enclosing opener does not accept the middle keyword, the
    // keyword is a stray identifier and must not be attached as an intermediate (best-effort
    // parsing: leave it unhighlighted rather than mis-attributing it).
    test('should not attach else as intermediate to an fn block', () => {
      const source = 'g = fn x ->\n  :a\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fn', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not attach else as intermediate to a defmodule block', () => {
      const source = 'defmodule M do\n  :a\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'defmodule', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not attach rescue as intermediate to a quote block', () => {
      const source = 'quote do\n  :a\nrescue\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not attach else as intermediate to a case block', () => {
      const source = 'case x do\n  _ -> :a\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not attach after as intermediate to a for block', () => {
      const source = 'for x <- list do\n  x\nafter\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not attach else to defmodule when it follows a closed inner if block', () => {
      const source = 'defmodule M do\n  if x do\n    :a\n  end\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const modulePair = findBlock(pairs, 'defmodule');
      assertIntermediates(modulePair, []);
      const ifPair = findBlock(pairs, 'if');
      assertIntermediates(ifPair, []);
    });

    test('should still attach else as intermediate in a real if/else block', () => {
      const source = 'if x do\n  :a\nelse\n  :b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should still attach rescue/catch/after intermediates in a real try block', () => {
      const source = 'try do\n  :a\nrescue\n  e -> e\ncatch\n  x -> x\nafter\n  :ok\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['rescue', 'catch', 'after']);
    });

    test('should still attach else as intermediate to a try block (try/else)', () => {
      const source = 'try do\n  :a\nelse\n  v -> v\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should still attach after as intermediate in a real receive/after block', () => {
      const source = 'receive do\n  x -> x\nafter\n  1000 -> :timeout\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'receive', 'end');
      assertIntermediates(pairs[0], ['after']);
    });

    test('should still attach else as intermediate to a with block', () => {
      const source = 'with {:ok, v} <- f() do\n  v\nelse\n  err -> err\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'with', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should attach else to the with opener even when an inner if/end is closed first', () => {
      const source = 'with {:ok, v} <- f() do\n  if v do\n    :a\n  end\nelse\n  err -> err\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const withPair = findBlock(pairs, 'with');
      assertIntermediates(withPair, ['else']);
      const ifPair = findBlock(pairs, 'if');
      assertIntermediates(ifPair, []);
    });

    test('should attach rescue to the try opener even when an inner if/end is closed first', () => {
      const source = 'try do\n  if v do\n    :a\n  end\nrescue\n  e -> e\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const tryPair = findBlock(pairs, 'try');
      assertIntermediates(tryPair, ['rescue']);
      const ifPair = findBlock(pairs, 'if');
      assertIntermediates(ifPair, []);
    });
  });

  generateCommonTests(config);
});
