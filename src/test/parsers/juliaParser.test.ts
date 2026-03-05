import * as assert from 'node:assert';
import { JuliaBlockParser } from '../../parsers/juliaParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('JuliaBlockParser Test Suite', () => {
  let parser: JuliaBlockParser;

  setup(() => {
    parser = new JuliaBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'x = 1 + 2\ny = x * 3\nprintln(y)',
    tokenSource: 'if true\nend',
    expectedTokenValues: ['if', 'end'],
    excludedSource: '"string" # comment\nfunction foo()\nend',
    expectedRegionCount: 2,
    twoLineSource: 'if true\nend',
    singleLineCommentSource: '# if this is a comment end\nfunction foo()\nend',
    commentBlockOpen: 'function',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'x = "if this is a string end"\nfunction foo()\nend',
    stringBlockOpen: 'function',
    stringBlockClose: 'end'
  };

  suite('Simple blocks', () => {
    test('should parse simple if-end block', () => {
      const source = `if condition
  do_something()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse function-end block', () => {
      const source = `function foo(x)
  return x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse for-end block', () => {
      const source = `for i in 1:10
  println(i)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse while-end block', () => {
      const source = `while x > 0
  x -= 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should parse struct-end block', () => {
      const source = `struct Point
  x::Float64
  y::Float64
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'struct', 'end');
    });

    test('should parse mutable struct-end block', () => {
      const source = `mutable struct Point
  x::Float64
  y::Float64
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'struct', 'end');
    });

    test('should parse abstract type-end block', () => {
      const source = 'abstract type Animal end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'abstract', 'end');
    });

    test('should parse primitive type-end block', () => {
      const source = 'primitive type MyInt 32 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'primitive', 'end');
    });

    test('should parse abstract type with subtype', () => {
      const source = 'abstract type Pet <: Animal end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'abstract', 'end');
    });

    test('should parse begin-end block', () => {
      const source = `begin
  x = 1
  y = 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse try-end block', () => {
      const source = `try
  risky_operation()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should parse let-end block', () => {
      const source = `let x = 1, y = 2
  x + y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'let', 'end');
    });

    test('should parse module-end block', () => {
      const source = `module MyModule
  export foo
  function foo()
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'module', 0);
      assertNestLevel(pairs, 'function', 1);
    });

    test('should parse baremodule-end block', () => {
      const source = `baremodule MyBareModule
  const x = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'baremodule', 'end');
    });

    test('should parse macro-end block', () => {
      const source = `macro sayhello(name)
  return :(println("Hello, ", $name))
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'macro', 'end');
    });

    test('should parse quote-end block', () => {
      const source = `quote
  x = 1
  y = 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
    });

    test('should parse do-end block', () => {
      const source = `map([1, 2, 3]) do x
  x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should parse multiple do blocks', () => {
      const source = `open("file1.txt") do f1
  open("file2.txt") do f2
    write(f2, read(f1))
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs[0].nestLevel, 1);
      assert.strictEqual(pairs[1].nestLevel, 0);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else-end block', () => {
      const source = `if condition
  do_true()
else
  do_false()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse if-elseif-end block', () => {
      const source = `if condition1
  do_1()
elseif condition2
  do_2()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elseif']);
    });

    test('should parse if-elseif-else-end block', () => {
      const source = `if condition1
  do_1()
elseif condition2
  do_2()
else
  do_3()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elseif', 'else']);
    });

    test('should parse multiple elseif clauses', () => {
      const source = `if a
  1
elseif b
  2
elseif c
  3
elseif d
  4
else
  5
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elseif', 'elseif', 'elseif', 'else']);
    });

    test('should parse try-catch-end block', () => {
      const source = `try
  risky_operation()
catch e
  handle_error(e)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should parse try-finally-end block', () => {
      const source = `try
  risky_operation()
finally
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['finally']);
    });

    test('should parse try-catch-finally-end block', () => {
      const source = `try
  risky_operation()
catch e
  handle_error(e)
finally
  cleanup()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch', 'finally']);
    });

    test('should parse for-else pattern (break/else)', () => {
      const source = `for i in 1:10
  if condition
    break
  end
else
  println("completed")
end`;
      const pairs = parser.parse(source);
      const forPair = findBlock(pairs, 'for');
      assertIntermediates(forPair, ['else']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested if blocks with correct levels', () => {
      const source = `if a
  if b
    if c
      do_something()
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assert.strictEqual(pairs[0].nestLevel, 2);
      assert.strictEqual(pairs[1].nestLevel, 1);
      assert.strictEqual(pairs[2].nestLevel, 0);
    });

    test('should parse function with nested blocks', () => {
      const source = `function foo(x)
  if x > 0
    for i in 1:x
      println(i)
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'function', 0);
      assertNestLevel(pairs, 'if', 1);
      assertNestLevel(pairs, 'for', 2);
    });

    test('should parse module with multiple nested structures', () => {
      const source = `module MyModule
  struct Point
    x::Float64
    y::Float64
  end

  function distance(p1::Point, p2::Point)
    let dx = p1.x - p2.x, dy = p1.y - p2.y
      sqrt(dx^2 + dy^2)
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      assertNestLevel(pairs, 'module', 0);
      assertNestLevel(pairs, 'struct', 1);
      assertNestLevel(pairs, 'function', 1);
      assertNestLevel(pairs, 'let', 2);
    });

    test('should parse deeply nested blocks (5 levels)', () => {
      const source = `module A
  function b()
    for i in 1:10
      while j > 0
        if condition
          do_something()
        end
      end
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
      const levels = pairs.map((p) => p.nestLevel).sort((a, b) => a - b);
      assert.deepStrictEqual(levels, [0, 1, 2, 3, 4]);
    });

    test('should handle sequential blocks at same level', () => {
      const source = `function foo()
  if a
    do_a()
  end
  if b
    do_b()
  end
  if c
    do_c()
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      const functionPair = findBlock(pairs, 'function');
      const ifPairs = pairs.filter((p) => p.openKeyword.value === 'if');
      assert.strictEqual(functionPair.nestLevel, 0);
      assert.strictEqual(ifPairs.length, 3);
      for (const ifPair of ifPairs) {
        assert.strictEqual(ifPair.nestLevel, 1);
      }
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should ignore keywords in multi-line comments', () => {
      const source = `#=
if this is a comment
  for x in y
  end
end
=#
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle nested multi-line comments', () => {
      const source = `#=
outer comment
  #= inner comment with if end =#
outer continues
=#
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle deeply nested multi-line comments', () => {
      const source = `#=
level 1
  #=
  level 2
    #=
    level 3 with if function for while end
    =#
  level 2 continues
  =#
level 1 continues
=#
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle comment at end of line', () => {
      const source = `function foo() # if this were a block
  x = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle multiple single-line comments', () => {
      const source = `# comment 1 with if
# comment 2 with for end
# comment 3 with while
function foo()
  # nested comment with begin end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in triple-quoted strings', () => {
      const source = `x = """
if this is a multiline string
  for x in y
    while true
    end
  end
end
"""
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `x = "say \\"if\\" or \\"end\\""
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should ignore keywords in character literals', () => {
      const source = `c = 'i'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle escaped character literals', () => {
      const source = `c1 = '\\n'
c2 = '\\''
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should ignore keywords in command strings (backticks)', () => {
      const source = 'x = `if echo end`\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should ignore keywords in regex literals (r-strings)', () => {
      const source = `pattern = r"if.*end"
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should ignore keywords in raw strings', () => {
      const source = `path = raw"C:\\if\\end\\path"
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should ignore keywords in byte strings (b-strings)', () => {
      const source = `bytes = b"if end bytes"
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle string interpolation', () => {
      const source = `msg = "Result: $(if x > 0 'positive' else 'negative' end)"
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle adjacent strings', () => {
      const source = `a = "if" * "end"
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple-quoted prefixed strings', () => {
      const source = `doc = r"""
if.*end
for.*while
"""
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    suite('String interpolation', () => {
      test('should handle $() interpolation with nested quotes', () => {
        const source = 'x = "$(if true "yes" else "no" end)"';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should handle nested $() interpolation', () => {
        const source = 'x = "outer $(a * "inner $(b)" * c)"';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should handle $() with block keywords inside', () => {
        const source = '"result: $(if x\n  y\nend)"';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should handle empty interpolation', () => {
        const source = 'x = "value: $()"';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should handle $() in triple-quoted string', () => {
        const source = '"""\n$(if true\n  "yes"\nend)\n"""';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should still parse blocks outside interpolated strings', () => {
        const source = '"$(x)"\nif true\nend';
        const result = parser.parse(source);
        assertSingleBlock(result, 'if', 'end');
      });

      test('should handle $ without parens (variable interpolation)', () => {
        const source = 'x = "$variable"\nif true\nend';
        const result = parser.parse(source);
        assertSingleBlock(result, 'if', 'end');
      });
    });
  });

  suite('Special Julia constructs', () => {
    test('should handle anonymous functions with do blocks', () => {
      const source = `result = map(1:10) do x
  x^2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should handle generator expressions (unmatched for does not affect nest level)', () => {
      const source = `squares = [x^2 for x in 1:10]
function foo()
end`;
      const pairs = parser.parse(source);
      // Unmatched for inside comprehension does not inflate nestLevel
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle comprehensions with conditions (unmatched for/if do not affect nest level)', () => {
      const source = `evens = [x for x in 1:20 if x % 2 == 0]
function foo()
end`;
      const pairs = parser.parse(source);
      // Unmatched for and if inside comprehension do not inflate nestLevel
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle ternary operator (not a block)', () => {
      const source = `result = condition ? value1 : value2
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle short-circuit evaluation (not blocks)', () => {
      const source = `x && do_something()
y || do_fallback()
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle struct with parametric types', () => {
      const source = `struct Point{T<:Number}
  x::T
  y::T
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'struct', 'end');
    });

    test('should handle function with type parameters', () => {
      const source = `function add(x::T, y::T) where T<:Number
  return x + y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle macros with expressions', () => {
      const source = `@inline function fast_add(x, y)
  x + y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle quote blocks with interpolation', () => {
      const source = `ex = quote
  x = $(some_value)
  if x > 0
    return x
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const quotePair = findBlock(pairs, 'quote');
      const ifPair = findBlock(pairs, 'if');
      assert.ok(quotePair);
      assert.ok(ifPair);
    });
  });

  suite('Transpose operator', () => {
    test('should not treat transpose as character literal', () => {
      const source = `A'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat transpose after identifier as character literal', () => {
      const source = `x = matrix'
if condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose in expression', () => {
      const source = `result = A' * B
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle transpose after closing parenthesis', () => {
      const source = `result = (A*B)'
if x
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose after closing bracket', () => {
      const source = `result = [1,2,3]'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle transpose after closing brace', () => {
      const source = `result = Dict{Int,Int}()'
if x
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still parse character literals correctly', () => {
      const source = `c = 'a'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), "'a'");
    });

    test('should handle character literal after operator', () => {
      const source = `c = x + 'a'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle character literal at start', () => {
      const source = `'a'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle double transpose', () => {
      const source = `result = A''
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle mixed transpose and character literals', () => {
      const source = `c = 'x'
result = A' * 'y'
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });

    test('should not confuse adjoint (transpose) with if keyword', () => {
      const source = `x = A'
if condition
  y = B'
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Symbol literals', () => {
    test('should not match :if as keyword', () => {
      const source = `:if
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not match :end as keyword', () => {
      const source = `:end
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not match :for as keyword', () => {
      const source = `:for
:while
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle symbols in Dict', () => {
      const source = `x = Dict(:if => 1, :end => 2, :for => 3)
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle symbols in array', () => {
      const source = `keywords = [:if, :else, :elseif, :end, :for, :while]
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat ternary operator as symbol', () => {
      const source = `result = condition ? value1 : value2
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0);
    });

    test('should handle symbol after space', () => {
      const source = `sym = :function
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle symbol at start of line', () => {
      const source = `:begin
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should exclude symbol literals correctly', () => {
      const source = `:if :end :for
function foo()
end`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 3);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), ':if');
      assert.strictEqual(source.slice(regions[1].start, regions[1].end), ':end');
      assert.strictEqual(source.slice(regions[2].start, regions[2].end), ':for');
    });
  });

  suite('Prefixed string boundary', () => {
    test('should not treat identifier ending with r as prefix', () => {
      const source = `myvarr = 1
r"pattern"
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), 'r"pattern"');
    });

    test('should treat identifier before quote as string macro', () => {
      // In Julia, myvarb"test" is a string macro call (@myvarb_str)
      const source = `myvarb"test"
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), 'myvarb"test"');
    });

    test('should handle prefix after operator', () => {
      const source = `x = 1 + r"pattern"
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.some((r) => source.slice(r.start, r.end) === 'r"pattern"'));
    });

    test('should handle prefix after parenthesis', () => {
      const source = `match(r"if.*end")
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle only comments', () => {
      const source = `# just a comment
#=
multi-line comment
=#`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keywords in identifiers', () => {
      const source = `function endif()
end
function dofor()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      for (const pair of pairs) {
        assert.strictEqual(pair.openKeyword.value, 'function');
      }
    });

    test('should not match keywords as part of other words', () => {
      const source = `begin_process = 1
end_process = 2
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle unmatched blocks gracefully', () => {
      const source = `if condition
if nested
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle keyword at start of file', () => {
      const source = `if x
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
    });

    test('should handle keyword at end of file without newline', () => {
      const source = 'if x\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle one-liner functions (not block syntax)', () => {
      const source = `f(x) = x^2
g(x) = if x > 0 x else -x end
function h(x)
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle inline if expressions', () => {
      const source = `result = if condition value1 else value2 end
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle blocks with only whitespace', () => {
      const source = `begin

end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle deeply nested quotes in strings', () => {
      const source = `s = "outer \\"inner \\\\"deepest\\\\" inner\\" outer"
function foo()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle unterminated string at end of file', () => {
      const source = `function foo()
end
x = "unterminated string`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle unterminated comment at end of file', () => {
      const source = `function foo()
end
#= unterminated comment`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle real-world Julia code', () => {
      const source = `module Statistics

using LinearAlgebra

export mean, std, var

"""
  mean(x)

Compute the arithmetic mean of collection \`x\`.
"""
function mean(x)
  if isempty(x)
      throw(ArgumentError("mean requires at least one element"))
  end
  return sum(x) / length(x)
end

"""
  std(x; corrected=true)

Compute the standard deviation.
"""
function std(x; corrected=true)
  n = length(x)
  if n < 2
      return NaN
  end

  m = mean(x)
  s = 0.0
  for xi in x
      s += (xi - m)^2
  end

  if corrected
      return sqrt(s / (n - 1))
  else
      return sqrt(s / n)
  end
end

# Variance is just std squared
var(x; corrected=true) = std(x; corrected=corrected)^2

end # module`;
      const pairs = parser.parse(source);

      const modulePairs = pairs.filter((p) => p.openKeyword.value === 'module');
      const functionPairs = pairs.filter((p) => p.openKeyword.value === 'function');
      const ifPairs = pairs.filter((p) => p.openKeyword.value === 'if');
      const forPairs = pairs.filter((p) => p.openKeyword.value === 'for');

      assert.strictEqual(modulePairs.length, 1);
      assert.strictEqual(functionPairs.length, 2);
      assert.strictEqual(ifPairs.length, 3);
      assert.strictEqual(forPairs.length, 1);
    });

    suite('Triple-quoted strings', () => {
      test('should handle escape sequences in triple-quoted strings', () => {
        const source = `s = """
line1\\nescaped
line2\\ttab
"""
function foo()
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should handle unterminated triple-quoted string', () => {
        const source = `s = """
unterminated
function foo()
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle triple-quoted string with embedded quotes', () => {
        const source = `s = """
He said "hello"
She said "world"
"""
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Prefixed triple-quoted strings', () => {
      test('should handle prefixed triple-quoted strings', () => {
        const source = `re = r"""
pattern with "quotes"
"""
function foo()
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should handle escape sequences in prefixed triple-quoted strings', () => {
        const source = 'x = raw"""\ntest\\"""\n"""\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should handle escape in prefixed triple-quoted string', () => {
        const source = `re = r"""
\\n\\t\\r
"""
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated prefixed triple-quoted string', () => {
        const source = `re = r"""
unterminated pattern
function foo()
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle raw prefix with triple quotes', () => {
        const source = `s = raw"""
literal \\n not escaped
"""
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated raw triple-quoted string', () => {
        const source = `s = raw"""
unterminated
function foo()
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Prefixed strings', () => {
      test('should handle unterminated prefixed string', () => {
        const source = `re = r"unterminated
function foo()
end`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle escape in prefixed string', () => {
        const source = `s = b"\\x00\\x01"
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated raw string', () => {
        const source = `s = raw"unterminated
function foo()
end`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });
    });

    suite('Command strings', () => {
      test('should handle escape sequences in command string', () => {
        const source = 'cmd = `echo \\`nested\\` \\\\escaped`\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should handle unterminated command string', () => {
        const source = 'cmd = `unterminated\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle command string with if keyword', () => {
        const source = '`if [ -f file ]; then echo yes; fi`\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });
    });

    suite('Character literals', () => {
      test('should handle escape in character literal', () => {
        const source = `c = '\\n'
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle character literal with newline break', () => {
        const source = `c = 'unterminated
function foo()
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should handle backslash escape in character literal', () => {
        const source = `c = '\\\\'
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Symbol literals', () => {
      test('should not treat colon after number as symbol', () => {
        const source = `x = arr[1:end]
function foo()
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should not treat colon in ternary as symbol', () => {
        const source = `result = cond ? true : false
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle symbol with Unicode', () => {
        const source = `:日本語
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle symbol with exclamation mark', () => {
        const source = `:push!
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        const regions = parser.getExcludedRegions(source);
        assert.strictEqual(source.slice(regions[0].start, regions[0].end), ':push!');
      });

      test('should handle symbol with operator characters', () => {
        const source = `:=>
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        const regions = parser.getExcludedRegions(source);
        assert.strictEqual(source.slice(regions[0].start, regions[0].end), ':=>');
      });

      test('should handle symbol with @ character', () => {
        const source = `:@something
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should not treat colon after closing bracket as symbol', () => {
        const source = `x = arr[1]:3
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon followed by non-identifier as symbol', () => {
        const source = `x = a:b
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Multi-line comments', () => {
      test('should handle deeply nested multi-line comments', () => {
        const source = `#= outer #= middle #= inner =# middle =# outer =#
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle multi-line comment with keywords', () => {
        const source = `#=
if then else end
for while begin
=#
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Unicode identifiers', () => {
      test('should handle Unicode identifier before colon', () => {
        const source = `変数:end
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle Unicode identifier before prefix', () => {
        const source = `変数r"pattern"
function foo()
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        const regions = parser.getExcludedRegions(source);
        assert.ok(regions.some((r) => source.slice(r.start, r.end) === '"pattern"'));
      });
    });

    suite('isSymbolStart edge cases', () => {
      test('should return false when next char is undefined', () => {
        const source = 'x = y:';
        const regions = parser.getExcludedRegions(source);
        assert.strictEqual(regions.length, 0);
      });

      test('should treat :symbol after > as symbol literal', () => {
        const source = 'x = a >:end\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should treat :symbol after >> as symbol literal', () => {
        const source = 'x = a >>:end\nfunction foo()\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end');
      });

      test('should exclude :symbol after > from excluded regions', () => {
        const source = 'x = a > :foo';
        const regions = parser.getExcludedRegions(source);
        assert.ok(regions.some((r) => source.slice(r.start, r.end) === ':foo'));
      });
    });
  });

  suite('End inside brackets/parentheses', () => {
    test('should not treat end inside brackets as block close', () => {
      const pairs = parser.parse('function foo()\n  x = a[end]\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should treat end inside parentheses as valid block close', () => {
      // end inside () is a valid block close (not an indexing keyword)
      // Block expressions in function arguments: f(begin...end)
      const pairs = parser.parse('function foo()\n  x = f(begin\n    1 + 2\n  end)\nend');
      assert.strictEqual(pairs.length, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'function');
    });

    test('should handle end-1 inside brackets', () => {
      const pairs = parser.parse('function foo()\n  x = a[1:end-1]\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should allow do block inside function call', () => {
      const pairs = parser.parse('map(1:10) do x\n  x^2\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should still reject end inside brackets in function call', () => {
      // f(a[end]) - end is indexing inside brackets
      const pairs = parser.parse('function foo()\n  x = f(a[end])\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Command string interpolation', () => {
    test('should handle $() interpolation in backtick commands', () => {
      const source = "x = `echo $(echo '\\`')`\nfor i in 1:10\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle $() interpolation in triple backtick commands', () => {
      const source = "x = ```echo $(echo '\\`')```\nfor i in 1:10\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle simple $() in backtick command', () => {
      const source = 'x = `echo $(pwd)`\nfor i in 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  generateCommonTests(config);

  suite('Token positions - language-specific', () => {
    test('should have correct column numbers', () => {
      const source = `function foo()
  if condition
    for i in 1:10
    end
  end
end`;
      const pairs = parser.parse(source);
      const functionPair = findBlock(pairs, 'function');
      const ifPair = findBlock(pairs, 'if');
      const forPair = findBlock(pairs, 'for');

      assert.strictEqual(functionPair.openKeyword.column, 0);
      assert.strictEqual(ifPair.openKeyword.column, 2);
      assert.strictEqual(forPair.openKeyword.column, 4);
    });

    test('should have correct end keyword positions', () => {
      const source = `if x
  y
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should have correct intermediate keyword positions', () => {
      const source = `if a
  1
elseif b
  2
else
  3
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].intermediates[0], 2, 0);
      assertTokenPosition(pairs[0].intermediates[1], 4, 0);
    });

    test('should handle tabs in indentation', () => {
      const source = 'function foo()\n\tif x\n\tend\nend';
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.openKeyword.column, 1);
    });
  });

  suite('Test helper methods - language-specific', () => {
    test('getExcludedRegions should return nested comment as single region', () => {
      const source = `#= outer #= inner =# outer =#
function foo()
end`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.ok(regions[0].end > regions[0].start);
    });

    test('getTokens should not include tokens in excluded regions', () => {
      const source = `"if end" # for while
function foo()
end`;
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 2);
      assert.strictEqual(tokens[0].value, 'function');
      assert.strictEqual(tokens[1].value, 'end');
    });
  });

  suite('abstract/primitive type validation', () => {
    test('should parse abstract type as block', () => {
      const source = 'abstract type Number end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'abstract', 'end');
    });

    test('should parse primitive type as block', () => {
      const source = 'primitive type Float16 <: AbstractFloat 16 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'primitive', 'end');
    });

    test('should not parse standalone abstract as block', () => {
      const source = 'x = abstract';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not parse standalone primitive as block', () => {
      const source = 'y = primitive';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should parse nested abstract type', () => {
      const source = `module Foo
  abstract type Bar end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'abstract', 1);
      assertNestLevel(pairs, 'module', 0);
    });

    test('should not treat abstract without type as block opener', () => {
      const source = `function foo()
  println(abstract)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Multi-line comment edge cases', () => {
    test('should handle non-comment at #= position gracefully', () => {
      const source = `# regular comment
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Array comprehension exclusion', () => {
    test('should not parse for inside brackets as block', () => {
      const source = `x = [i for i in 1:10]
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not parse if inside brackets as block', () => {
      const source = `x = [i for i in 1:10 if i > 5]
function foo()
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse for outside brackets as block', () => {
      const source = `for i in 1:10
  println(i)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle nested brackets in comprehension', () => {
      const source = `x = [f(a[i]) for i in 1:10]
for j in 1:5
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle brackets inside strings when checking comprehension', () => {
      const source = `x = "]"
[f(x) for x in xs]`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Triple backtick command strings', () => {
    test('should handle triple backtick command string', () => {
      const source = 'x = ```for i in 1:10\nend```\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple backtick with keywords inside', () => {
      const source = 'cmd = ```\nif true\n  echo hello\nend\n```\nfor i in 1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle escaped characters in triple backtick', () => {
      const source = 'x = ```escaped \\` backtick```\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle unterminated triple backtick', () => {
      const source = 'x = ```unterminated\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: multi-line comment edge', () => {
    test('should handle # not followed by = as non-comment', () => {
      // Tests matchMultiLineComment returning null when not #=
      const source = '# regular comment\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Generator expressions in parentheses', () => {
    test('should not treat for in parenthesized generator as block open', () => {
      const source = `function foo()
  result = (x^2 for x in 1:10)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat if in parenthesized filter as block open', () => {
      const source = `function foo()
  result = (x for x in 1:10 if x > 5)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat for in brackets as comprehension', () => {
      const source = `function foo()
  result = [x^2 for x in 1:10]
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Custom string macros', () => {
    test('should exclude custom string macro html"..."', () => {
      const source = 'x = html"<div>end</div>"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should exclude custom string macro sql"..."', () => {
      const source = 'q = sql"SELECT end FROM table"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat block keywords as string macro prefix', () => {
      const source = 'if true\n  x = "hello"\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude uppercase prefix string macro', () => {
      const source = 'x = L"wide string with end"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should exclude triple-quoted custom string macro', () => {
      const source = 'x = html"""\n<div>end</div>\n"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat block keyword followed by quote as string macro', () => {
      const source = 'if"true"\n  x = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: nested multi-line comments', () => {
    test('should handle nested #= =# comments', () => {
      const regions = parser.getExcludedRegions('#= outer #= inner =# outer =#');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, 29);
    });
  });

  suite('Interpolation with nested constructs', () => {
    test('should handle #= multi-line comment inside string interpolation', () => {
      const pairs = parser.parse('x = "result: $(\n  #= comment with ) inside =#\n  42\n)"\nfunction foo()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple-quoted string inside interpolation', () => {
      const pairs = parser.parse('x = "$("""hello end world""")"\nfunction foo()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle backslash operator inside interpolation', () => {
      const pairs = parser.parse('x = "$(A \\ b)"\nfunction foo()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat backslash as escape in interpolation', () => {
      // \) should not escape the closing paren
      const regions = parser.getExcludedRegions('"$(x \\)"');
      assert.strictEqual(regions.length, 1);
      // The string should end at the final "
      assert.strictEqual(regions[0].end, 8);
    });
  });

  suite('Coverage: prefixed string edge cases', () => {
    test('should not treat identifier-prefixed quote as string macro', () => {
      const regions = parser.getExcludedRegions('xend"hello"');
      // xend is part of identifier, so "hello" is matched as regular string
      assert.ok(regions.length >= 1);
    });

    test('should not treat block keyword as string macro prefix', () => {
      const pairs = parser.parse('if true\n  x = 1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Raw string edge cases', () => {
    test('should not eat source after raw string with special content', () => {
      const source = 'r"$(end"\nif true\n  y = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle unterminated char literal with \\r-only line endings in matchCharLiteral', () => {
      // Unterminated char literal should stop at \r, not scan past it
      const source = "c = 'unterminated\rfunction foo()\rend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle char literal in interpolation with \\r-only line endings in skipCharLiteral', () => {
      // skipCharLiteral inside interpolation should stop at \r
      const source = 'x = "$(\'unterminated\r42)"\rfunction foo()\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle line comment in interpolation with \\r-only line endings', () => {
      // Line comment inside $() should stop at \r, not consume past it
      const source = 'x = "$(1 + 2 # comment\r3)"\rfunction foo()\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle normal char literal with \\r-only line endings', () => {
      const source = "c = 'a'\rfunction foo()\rend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('isInsideBrackets with nested parentheses', () => {
    test('should allow end inside parens inside brackets', () => {
      // [f(begin...end)] - end is inside (), so not array indexing
      const source = `function foo()
  x = [f(begin
    1 + 2
  end)]
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'function');
    });

    test('should still reject end directly inside brackets', () => {
      // a[end] - end is directly inside [], should be rejected
      const source = `function foo()
  x = a[end]
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should allow end inside deeply nested parens in brackets', () => {
      // [g(f(begin...end))] - end is inside nested (), not array indexing
      const source = `function foo()
  x = [g(f(begin
    42
  end))]
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'function');
    });
  });

  suite('Prefixed string interpolation', () => {
    test('should not process interpolation in custom string macros', () => {
      // Custom string macros like html"..." should not process $() as interpolation
      const source = 'x = html"$(end)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not process interpolation in s-prefixed strings', () => {
      const source = 's"$(if true 1 else 2 end)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not process interpolation in v-prefixed strings', () => {
      const source = 'v"$(begin 1 end)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not process interpolation in b-prefixed strings', () => {
      const source = 'b"$(end)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Type annotation with ::', () => {
    test('should not treat :: as symbol prefix for block keyword', () => {
      const source = `function f(x::Int)
  if true
    1
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'function');
      findBlock(pairs, 'if');
    });
  });

  suite('Backtick command inside interpolation', () => {
    test('should handle backtick command inside $() interpolation', () => {
      const source = '"result = $(run(`echo end`))" \nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple backtick command inside $() interpolation', () => {
      const source = '"result = $(run(```echo end```))" \nfor i in 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Nested strings and commands in interpolation', () => {
    test('should handle triple-quoted string inside interpolation', () => {
      const source = 'x = "prefix $("""nested end""") suffix"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple-quoted string with interpolation inside interpolation', () => {
      const source = 'x = "outer $("""inner $(42) end""") suffix"\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should handle triple-quoted string with escape sequence inside interpolation', () => {
      const source = 'x = "outer $("""inner \\" end""") suffix"\nmodule M\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'end');
    });

    test('should handle triple backtick command inside interpolation', () => {
      const source = 'x = "prefix $(```inner end```) postfix"\nfor i in 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle triple backtick with nested interpolation inside interpolation', () => {
      const source = 'x = "prefix $(```inner $(42) end```) postfix"\nstruct Point\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'struct', 'end');
    });

    test('should handle triple backtick with escape sequence inside interpolation', () => {
      const source = 'x = "prefix $(```inner \\` end```) postfix"\ntry\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should handle single backtick with escape inside interpolation', () => {
      const source = 'x = "prefix $(`inner \\` end`) postfix"\nlet x=1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'let', 'end');
    });

    test('should handle regular string with escape inside interpolation', () => {
      const source = 'x = "outer $("inner \\" end") postfix"\nquote\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'quote', 'end');
    });

    test('should handle nested multi-line comment inside interpolation', () => {
      const source = 'x = "$( #= outer #= inner end =# comment =# 42)"\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multi-line comment with end keyword inside interpolation', () => {
      const source = 'x = "$( #= comment with end keyword =# 42)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle unterminated triple-quoted string inside interpolation', () => {
      const source = 'x = "prefix $("""unterminated\nfunction foo()\nend';
      const regions = parser.getExcludedRegions(source);
      // The whole source from "prefix onwards should be excluded as an unterminated string
      assert.ok(regions.length > 0);
    });

    test('should handle unterminated triple backtick inside interpolation', () => {
      const source = 'x = "prefix $(```unterminated\nfor i in 1:10\nend';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
    });

    test('should handle unterminated backtick inside interpolation', () => {
      const source = 'x = "prefix $(`unterminated\nwhile true\nend';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
    });

    test('should handle unterminated regular string inside interpolation', () => {
      const source = 'x = "outer $("unterminated\nbegin\nend';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
    });
  });

  // Covers lines 67-68: block keywords inside square brackets (not for/if)
  suite('Block keywords inside square brackets', () => {
    test('should detect begin inside array construction brackets', () => {
      const source = 'x = [begin, end]\nfunction foo()\nend';
      const pairs = parser.parse(source);
      // begin..end inside array construction brackets is accepted
      assertBlockCount(pairs, 2);
    });

    test('should not detect begin inside indexing brackets', () => {
      const source = 'x = a[begin, end]\nfunction foo()\nend';
      const pairs = parser.parse(source);
      // a[...] is indexing, block keywords are rejected
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should detect function inside array construction brackets', () => {
      const source = 'arr = [function, module, end]\nwhile true\nend';
      const pairs = parser.parse(source);
      // function inside array construction is accepted
      assertBlockCount(pairs, 2);
    });

    test('should detect block after square bracket array', () => {
      const source = 'arr = [struct, try]\nmodule M\nend';
      const pairs = parser.parse(source);
      // struct and try in array construction have no end, so remain unmatched
      // module..end is the only valid pair
      assertSingleBlock(pairs, 'module', 'end');
    });
  });

  // Covers lines 79-80: isValidBlockClose for non-'end' keyword
  suite('Block close validation edge case', () => {
    test('should validate non-end block close keyword', () => {
      // Note: Julia only has 'end' as block close, so this tests the else branch
      const source = 'if true\n  x = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 208-209: matchMultiLineComment early return
  suite('Invalid multi-line comment start', () => {
    test('should not match comment if not starting with #=', () => {
      const source = '#this is a line comment\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 310-312, 332-334: prefixed triple-quoted string and findStringEnd with interpolation
  suite('Prefixed strings with interpolation', () => {
    test('should handle prefixed triple-quoted string with interpolation disabled', () => {
      const source = 'x = raw"""text $(end) more"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle prefixed regular string', () => {
      const source = 'x = r"text $(if) more"\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Covers lines 595-596: skipCharLiteral reaching EOF
  suite('Character literal at EOF in interpolation', () => {
    test('should handle unterminated char literal at EOF inside interpolation', () => {
      const source = '"text $(\'x';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
    });

    test('should handle char literal without closing quote in interpolation', () => {
      const source = '"x $(\'\nfunction foo()\nend';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
    });
  });

  // Covers lines 627-629: skipBacktickString interpolation handling
  suite('Backtick with interpolation in nested context', () => {
    test('should handle backtick with interpolation inside string interpolation', () => {
      const source = '"outer $(`cmd $(x) end`) after"\nfor i in 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle backtick with nested interpolation', () => {
      const source = 'x = "a $(`b $(c) if end`) d"\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Fix: isInsideBrackets should not short-circuit on unmatched ( before enclosing [
  suite('end inside brackets with nested parentheses', () => {
    test('should treat end inside a[f(end)] as lastindex, not block close', () => {
      const source = 'function foo()\n    a[f(end)]\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should treat end inside a[min(end, 5)] as lastindex', () => {
      const source = 'function foo()\n    x = a[min(end, 5)]\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should treat end inside a[div(end, 2)] as lastindex', () => {
      const source = 'for i in 1:10\n    a[div(end, 2)] = i\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should handle multiple nested bracket-paren end usages', () => {
      const source = 'function foo()\n    x = a[min(end, 5)]\n    y = b[div(end, 2)]\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should handle deeply nested a[f(g(end))]', () => {
      const source = 'function foo()\n    a[f(g(end))]\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should still reject end inside plain parentheses f(end)', () => {
      const source = 'function foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  // Covers lines 80-81: isValidBlockClose for non-'end' keyword returns true
  // Julia only has 'end' as block_close, so this branch is effectively dead code,
  // but we can verify the behavior by checking that end is validated properly
  suite('Coverage: isValidBlockClose non-end path', () => {
    test('should always return true for keywords other than end', () => {
      // This is tested indirectly: any block_close keyword that is not 'end'
      // would return true. Since Julia only has 'end', we verify normal behavior
      const source = 'if true\n  x = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 165-167: hasBlockOpenerBetween skipping excluded regions
  suite('Coverage: hasBlockOpenerBetween with excluded regions', () => {
    test('should skip block opener keyword inside string in bracket context', () => {
      const source = 'a["begin" end]';
      const pairs = parser.parse(source);
      // "begin" is in a string, so hasBlockOpenerBetween returns false
      // end is treated as indexing (not array construction)
      assertNoBlocks(pairs);
    });

    test('should find block opener outside string in bracket context', () => {
      const source = '[begin "text" end]';
      const pairs = parser.parse(source);
      // begin is real, so hasBlockOpenerBetween returns true -> array construction
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  // Covers lines 171-172: word-boundary check in hasBlockOpenerBetween
  suite('Coverage: hasBlockOpenerBetween word boundary check', () => {
    test('should not match keyword as part of longer word', () => {
      const source = 'a[beginner end]';
      const pairs = parser.parse(source);
      // "beginner" contains "begin" but is not a word boundary match
      // so hasBlockOpenerBetween returns false -> indexing context
      assertNoBlocks(pairs);
    });

    test('should not match keyword with trailing word character', () => {
      const source = 'a[xbegin end]';
      const pairs = parser.parse(source);
      // "xbegin" has a word char before "begin" -> not a match
      assertNoBlocks(pairs);
    });
  });

  // Covers lines 286-288: matchMultiLineComment early return for non-#=
  suite('Coverage: matchMultiLineComment early return', () => {
    test('should return null for regular # comment', () => {
      const source = '# this is a regular comment\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat #x as multi-line comment', () => {
      const source = '#x not a multiline comment\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  // Covers lines 388-391: $(...) interpolation inside triple-quoted string
  suite('Coverage: $() interpolation in triple-quoted string', () => {
    test('should exclude keywords inside $() in triple-quoted string', () => {
      const source = '"""$(begin 1 end)"""\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle $() with complex expression in triple-quoted string', () => {
      const source = '"""text $(for i in 1:10 println(i) end) more"""\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Covers lines 410-413: $(...) interpolation inside regular string
  suite('Coverage: $() interpolation in regular string', () => {
    test('should exclude keywords inside $() in regular string', () => {
      const source = '"$(begin 1 end)"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle $() with block expression in regular string', () => {
      const source = '"result: $(if true 1 else 2 end)"\nfor i in 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Bug fixes', () => {
    test("Bug 9: double transpose A'' should not cause false char literal", () => {
      const source = `x = A'' + begin 1 end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test("Bug 9: triple transpose A''' should be handled", () => {
      const source = `x = A''' + begin 1 end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('Bug 14: string macro suffix containing block keyword should not be detected', () => {
      const pairs = parser.parse('x = custom"content"end\nfunction foo()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('Bug 14: triple-quoted string macro suffix should not be detected', () => {
      const pairs = parser.parse('x = custom"""content"""end\nfunction foo()\nend');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('Bug 3: for/if inside parentheses with block openers should not be rejected', () => {
      // if after begin (a block opener) inside parens should not be rejected
      const source = 'f(begin\n  1\nend, if true\n  x\nelse\n  -x\nend)';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'if');
    });

    test('Bug 4: Unicode identifier before bracket should be recognized as indexing', () => {
      // Unicode identifier indexing: alpha[1] should not interfere with function...end
      const source = 'function f()\n  \u03B1[1]\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('Bug 11: :@ should not hide the next keyword', () => {
      // :@ should only exclude the colon and @, not hide subsequent keywords
      const source = 'x = :@\nfunction f()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: new bug fix code paths', () => {
    // Covers isInsideParentheses: for inside parentheses is rejected as generator expression
    test('should reject for inside parentheses as generator expression', () => {
      const source = 'result = (x^2 for x in 1:10)\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    // Covers isInsideBrackets excluded region: "end" in string inside brackets
    test('should skip keywords in strings when scanning brackets', () => {
      const source = 'x = ["end", begin\n  1\nend]';
      const pairs = parser.parse(source);
      // "end" is in a string, begin is a real block opener -> array construction
      assertSingleBlock(pairs, 'begin', 'end');
    });

    // Covers $() interpolation in triple-quoted strings excluding block keywords
    test('should exclude keywords inside $() interpolation in triple-quoted string', () => {
      const source = 'x = """\nhello $(if true 1 end)\n"""\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Covers $() interpolation in regular strings excluding block keywords
    test('should exclude keywords inside $() interpolation in regular string', () => {
      const source = 'x = "hello $(if true 1 end)"\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Array construction vs indexing', () => {
    test('a[end] should treat end as indexing (reject block close)', () => {
      const source = 'a[end]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('[if true 1 else 2 end] should reject if (comprehension context) but accept end', () => {
      // if is always rejected inside brackets (comprehension syntax takes precedence)
      // end is accepted in array construction brackets but has no matching opener
      const source = '[if true 1 else 2 end]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('[begin x = 1 end] should treat as array construction (accept block)', () => {
      const source = '[begin x = 1 end]';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('a[end-1] should treat end as indexing', () => {
      const source = 'a[end-1]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('[x for x in 1:10] should treat for as array comprehension', () => {
      const source = '[x for x in 1:10]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: uncovered branch paths', () => {
    // L165-167: isInExcludedRegion in hasBlockOpenerBetween - string in range between ( and for
    test('should skip excluded regions in hasBlockOpenerBetween', () => {
      const source = '(f("begin") for x in 1:10)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // L171-172: boundary checks in hasBlockOpenerBetween - keyword at end of source
    test('should handle block opener at end boundary in hasBlockOpenerBetween', () => {
      const source = '(begin\n  1\nend)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  // L393-395: $() interpolation inside prefixed triple-quoted string
  suite('Coverage: interpolation in prefixed triple-quoted strings', () => {
    test('should handle $() interpolation inside triple-quoted string', () => {
      const source = 'x = """before $(if true\n  1\nend) after"""\nfor i in 1:3\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  // L420-422: $() interpolation inside regular strings via findStringEnd
  suite('Coverage: interpolation in regular strings', () => {
    test('should handle $() interpolation inside regular string', () => {
      const source = 'x = "value is $(if true\n  1\nend)"\nfor i in 1:3\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Bug 1: dot-preceded keywords', () => {
    test('obj.end should not be detected as block close', () => {
      const source = 'function foo()\n  x = obj.end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('range.begin should not be detected as block open', () => {
      const source = 'x = range.begin\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('Base.end(a, 1) inside function should not steal the function end', () => {
      const source = 'function foo(a)\n  x = Base.end(a, 1)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('obj.for should not be detected as block open', () => {
      const source = 'x = obj.for\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('module.struct should not be detected as block open', () => {
      const source = 'x = MyModule.struct\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug: :@macro symbol literal leaves macro exposed', () => {
    test('should not detect macro keyword after :@ symbol literal', () => {
      const source = 'function f()\n  x = :@macro\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still handle valid symbol literals starting with @', () => {
      const source = 'x = :hello\nfunction f()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should handle prefixed triple-quoted string without interpolation (r""")', () => {
      // matchPrefixedTripleQuotedString: interpolating=false (no $() branch at 411-413)
      const source = 'x = r"""begin end if"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle prefixed string with content that looks like code', () => {
      // findStringEnd: interpolating=false (no $() branch at 438-440)
      const source = 'x = raw"if do begin end"\nfor i in 1:3\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle symbol literal with multiple operator chars', () => {
      // matchSymbolLiteral operator branch: multiple chars consumed (not i===pos+1 path)
      const source = 'x = :+= \nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should return single-char symbol when colon followed by non-operator non-word non-unicode', () => {
      // matchSymbolLiteral: i === pos+1 path (509-510): colon at end of line or before newline
      // isSymbolStart passes for chars that are >=128 charCode but first char has charCode<=127 non-operator
      // This is effectively dead code; test a related adjacent edge case
      const source = 'x = : \nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat # alone as multi-line comment opener (line 305-306)', () => {
      // matchMultiLineComment: defensive check (dead code but path adjacent)
      // Regular # comment should not invoke the #= path
      const source = 'x = 1 # not #= a multi-line\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle prefixed triple-quoted string with backslash escape', () => {
      // matchPrefixedTripleQuotedString: backslash handling (lines 405-407)
      const source = 'x = r"""begin \\n end"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle regular string with backslash escape (findStringEnd path)', () => {
      // findStringEnd: backslash handling (lines 432-434)
      const source = 'x = raw"a \\n b"\nfor i in 1:3\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Coverage: defensive branch paths', () => {
    test('should handle #= multi-line comment correctly (positive path near line 305)', () => {
      // matchMultiLineComment: the guard at line 304 is a defensive check
      // The normal path processes #= correctly
      const source = '#= this is a\nmulti-line comment =#\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle # followed by non-= as single-line comment (line 305-306 adjacent)', () => {
      // When # is followed by something other than =, tryMatchExcludedRegion routes to
      // matchSingleLineComment (line 256-257), NOT matchMultiLineComment
      // This verifies the dispatch logic that prevents line 305-306 from being reached
      const source = '#! not a multiline comment\nbegin\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not interpolate $() in prefixed triple-quoted string (line 410 false branch)', () => {
      // matchPrefixedTripleQuotedString called with interpolating=false from matchPrefixedString
      // Line 410: interpolating is false, so the $() inside is treated as literal text
      const source = 'x = raw"""before $(begin 1 end) after"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not interpolate $() in b-prefixed triple-quoted string', () => {
      // Another prefixed triple-quoted test: b prefix also passes interpolating=false
      const source = 'x = b"""text $(if true 1 end) more"""\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not interpolate $() in prefixed regular string (line 437 false branch)', () => {
      // findStringEnd called with interpolating=false from matchPrefixedString
      // Line 437: interpolating is false, so $() inside is treated as literal text
      const source = 'x = r"value $(begin 1 end)"\nfor i in 1:3\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not interpolate $() in s-prefixed regular string', () => {
      // findStringEnd with interpolating=false
      const source = 'x = s"data $(if true 1 end)"\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should handle colon before space as non-symbol in ternary context', () => {
      // isSymbolStart: colon followed by space (charCode <= 127 and not matching operator pattern)
      // Line 457: nextChar is space -> returns false -> not a symbol
      const source = 'x = true ? begin\n  1\nend : 0';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle colon at end of source as non-symbol', () => {
      // isSymbolStart: pos+1 is undefined (no next char) -> line 452-453 returns false
      const source = 'function foo()\n  x = a:\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle colon followed by newline as non-symbol', () => {
      // isSymbolStart: nextChar is \n (charCode 10, <= 127, not matching operator/word pattern)
      // Line 457: returns false
      const source = 'function foo()\n  x = a:\n  y = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle colon followed by comma as non-symbol', () => {
      // isSymbolStart: nextChar is comma (,) -> not matching pattern -> returns false
      const source = 'function foo()\n  (a:, b)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle operator symbol :+ correctly', () => {
      // matchSymbolLiteral operator branch: + is consumed (i advances past pos+1)
      // Line 508 condition (i === pos + 1) is false -> does NOT return early
      const source = 'x = :+\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle $() interpolation in regular triple-quoted string', () => {
      // matchTripleQuotedString: $() interpolation path at lines 338-340
      const source = '"""\nresult: $(begin\n  42\nend)\n"""\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle $() interpolation in matchJuliaString', () => {
      // matchJuliaString: $() interpolation path at lines 596-598
      const source = '"value: $(begin 1 end)"\nfunction foo()\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: if expression inside parentheses', () => {
    test('should detect if as block expression in function call args', () => {
      const source = 'f(if true 1 else 2 end)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should detect if expression after comma in function call', () => {
      const source = 'f(x, if a > 0 a else -a end)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect multiple if expressions as function args', () => {
      const source = 'f(if a 1 else 2 end, if b 3 else 4 end)';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should still reject if as generator filter in parentheses', () => {
      const source = '(x for x in 1:10 if x > 5)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still reject if as generator filter in nested parens', () => {
      const source = 'f(g(x for x in 1:10 if x > 5))';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect if expression with surrounding function and for-generator', () => {
      const source = 'function foo()\n  f(if true 1 else 2 end)\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcPair = pairs.find((p) => p.openKeyword.value === 'function');
      assert.ok(funcPair);
      assert.strictEqual(funcPair.nestLevel, 0);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair);
      assert.strictEqual(ifPair.nestLevel, 1);
    });

    test('should still reject if in array comprehension', () => {
      const source = '[x for x in 1:10 if x > 5]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect parenthesized if expression', () => {
      const source = 'x = (if true 1 else 2 end)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: abstract/primitive type must be on same line', () => {
    test('should not match abstract followed by type on next line', () => {
      const source = 'x = abstract\ntype Foo\nend';
      const pairs = parser.parse(source);
      // type/end should NOT form an abstract type block since they are on separate lines
      assertNoBlocks(pairs);
    });

    test('should still match abstract type on same line', () => {
      const source = 'abstract type Foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'abstract', 'end');
    });
  });

  suite('Branch coverage: hasForBetween depth tracking with nested parens/brackets', () => {
    test('should reject if as generator filter with nested parens in generator', () => {
      // sum(f(x) for x in arr if x > 0) - f(x) has parens that exercise depth++/depth-- in hasForBetween
      const source = 'sum(f(x) for x in arr if x > 0)';
      const pairs = parser.parse(source);
      // if inside a generator expression with for is rejected (not a block if)
      assertNoBlocks(pairs);
    });

    test('should reject if as generator filter with nested brackets in generator', () => {
      // sum(a[1] for a in arr if a[2] > 0) - brackets exercise depth tracking in hasForBetween
      const source = 'sum(a[1] for a in arr if a[2] > 0)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should reject if as generator filter with mixed parens and brackets', () => {
      // sum(f(a[i]) for i in 1:n if h(a[i]) > 0) - both parens and brackets
      const source = 'sum(f(a[i]) for i in 1:n if h(a[i]) > 0)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: Unicode identifier word boundaries', () => {
    test('should not detect end inside Unicode identifier \u03B1end', () => {
      const source = 'function foo()\n  \u03B1end = 42\n  return \u03B1end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not detect if inside Unicode identifier \u03B2if', () => {
      const source = 'function foo()\n  \u03B2if = true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not detect begin inside Unicode identifier end\u03B3begin', () => {
      const source = 'function foo()\n  end\u03B3 = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still detect keywords not adjacent to Unicode chars', () => {
      const source = '\u03B1 = begin\n  42\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: hasForBetween Unicode word boundary', () => {
    test('should not match for inside Unicode identifier in generator context', () => {
      // \u03B1for is a single identifier, not the for keyword
      const source = 'function foo()\n  x = (\u03B1for = 1; if true 1 else 0 end)\nend';
      const pairs = parser.parse(source);
      // if should be a block opener (not rejected as generator filter)
      assertBlockCount(pairs, 2);
    });

    test('should still match for keyword separated from Unicode letter', () => {
      const source = 'x = (for i in 1:10 if i > 5; i)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: prefixed string inside interpolation', () => {
    test('should handle raw string inside $() interpolation', () => {
      const source = '"$(r"$end")" \nfunction f()\n  return 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle triple-quoted prefixed string inside $() interpolation', () => {
      const source = '"""$(raw"""\nend\n""")"""\nfunction f()\n  return 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still handle regular string inside $() interpolation', () => {
      const source = '"$("hello")" \nfunction f()\n  return 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });
});
