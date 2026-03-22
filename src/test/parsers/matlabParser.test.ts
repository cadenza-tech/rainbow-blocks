import * as assert from 'node:assert';
import { MatlabBlockParser } from '../../parsers/matlabParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('MatlabBlockParser Test Suite', () => {
  let parser: MatlabBlockParser;

  setup(() => {
    parser = new MatlabBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'x = 1 + 2;',
    tokenSource: 'if true\nend',
    expectedTokenValues: ['if', 'end'],
    excludedSource: "% comment\n'string'",
    expectedRegionCount: 2,
    twoLineSource: 'if true\nend',
    nestedPositionSource: 'function test()\n  if true\n    action();\n  end\nend',
    nestedKeyword: 'if',
    nestedLine: 1,
    nestedColumn: 2,
    singleLineCommentSource: '% if for while end function\nif true\nend',
    commentBlockOpen: 'if',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'msg = "if for while end";\nif true\nend',
    stringBlockOpen: 'if',
    stringBlockClose: 'end'
  };

  suite('Simple blocks', () => {
    test('should parse function-end block', () => {
      const source = `function result = myFunc(x)
  result = x * 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should parse if-end block', () => {
      const source = `if condition
  action();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse for-end block', () => {
      const source = `for i = 1:10
  disp(i);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse while-end block', () => {
      const source = `while x > 0
  x = x - 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should parse switch-end block', () => {
      const source = `switch value
  case 1
    disp('one');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
    });

    test('should parse try-end block', () => {
      const source = `try
  riskyOperation();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should parse parfor-end block', () => {
      const source = `parfor i = 1:10
  compute(i);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'parfor', 'end');
    });

    test('should parse spmd-end block', () => {
      const source = `spmd
  labindex
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'spmd', 'end');
    });

    test('should parse classdef-end block', () => {
      const source = `classdef MyClass
  properties
    Value
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classPair = findBlock(pairs, 'classdef');
      assert.strictEqual(classPair.nestLevel, 0);
    });

    test('should parse methods-end block', () => {
      const source = `classdef MyClass
  methods
    function obj = MyClass()
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should parse properties-end block', () => {
      const source = `classdef MyClass
  properties
    X
    Y
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse events-end block', () => {
      const source = `classdef MyClass
  events
    StateChanged
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse enumeration-end block', () => {
      const source = `classdef Color
  enumeration
    Red, Green, Blue
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else-end block', () => {
      const source = `if condition
  action1();
else
  action2();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse if-elseif-else-end block', () => {
      const source = `if cond1
  action1();
elseif cond2
  action2();
else
  action3();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elseif', 'else']);
    });

    test('should parse switch-case-otherwise-end block', () => {
      const source = `switch value
  case 1
    disp('one');
  case 2
    disp('two');
  otherwise
    disp('other');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'case', 'otherwise']);
    });

    test('should parse try-catch-end block', () => {
      const source = `try
  riskyOperation();
catch ME
  disp(ME.message);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `function result = outer()
  for i = 1:10
    if i > 5
      disp(i);
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'for', 1);
      assertNestLevel(pairs, 'function', 0);
    });

    test('should handle deeply nested blocks', () => {
      const source = `function outer()
  while true
    for i = 1:10
      if condition
        switch value
          case 1
            action();
        end
      end
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should ignore keywords in block comments', () => {
      const source = `%{
if condition
  for i = 1:10
    while true
    end
  end
end
%}
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment at end of line', () => {
      const source = `if true % this is a comment with end in it
  action();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted strings', () => {
      const source = `msg = 'if for while end';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `msg = 'it''s an if statement';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped quotes in double-quoted strings', () => {
      const source = `msg = "say ""if"" please";
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should distinguish transpose operator from string', () => {
      const source = `x = A';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose after closing bracket', () => {
      const source = `x = (A + B)';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose after array indexing', () => {
      const source = `x = A(1:3)';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose after cell array indexing', () => {
      const source = `x = cell{1}';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle transpose after empty cell array', () => {
      const source = `x = cell{}';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Shell escape command', () => {
    test('should ignore keywords in shell escape command', () => {
      const source = '!if test -f foo.txt\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore keywords in shell escape with leading whitespace', () => {
      const source = '  !for file in *.m\nfor i = 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat ! in middle of line as shell escape', () => {
      const source = 'x = 1 ! comment\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle shell escape as excluded region', () => {
      const source = '!dir\nif true\nend';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      assert.strictEqual(regions[0].start, 0);
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle multiple functions', () => {
      const source = `function a()
end

function b()
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle function with multiple outputs', () => {
      const source = `function [a, b] = myFunc(x)
  a = x;
  b = x * 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle anonymous function (not a block)', () => {
      const source = `f = @(x) x^2;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle complex real-world MATLAB code', () => {
      const source = `function result = processData(data)
  % Process the input data
  result = zeros(size(data));

  for i = 1:length(data)
    if data(i) > 0
      result(i) = sqrt(data(i));
    elseif data(i) < 0
      result(i) = -sqrt(-data(i));
    else
      result(i) = 0;
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle unterminated single-quoted string', () => {
      const source = `msg = 'unterminated
if true
end`;
      const pairs = parser.parse(source);
      // String ends at newline, so if should be detected
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated single-quoted string at end of file', () => {
      // Tests lines 109-111: matchMatlabString reaching end of source
      const source = `msg = 'unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unterminated double-quoted string', () => {
      const source = `msg = "unterminated
if true
end`;
      const pairs = parser.parse(source);
      // String ends at newline, so if should be detected
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated double-quoted string at end of file', () => {
      // Tests lines 131-133: matchDoubleQuotedString reaching end of source
      const source = `msg = "unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle %{ block comment with content after %}', () => {
      // %} with trailing content does not close the block comment per MATLAB spec
      const source = `%{
comment
%} ignored content
if true
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unterminated block comment', () => {
      const source = `%{
if inside comment
function inside()
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle block comment not at line start', () => {
      const source = `x = 1; %{ this is not a block comment %}
if true
end`;
      const pairs = parser.parse(source);
      // %{ not at line start is single-line comment
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle end inside parens within a string context', () => {
      const source = `for i = 1:10
  x = foo('end');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should treat quote after Unicode identifier as transpose', () => {
      const source = "function r = f(x)\n  r = \u03B8'; if true, end\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat keyword after transpose as struct field access', () => {
      const pairs = parser.parse("A.'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('end as array index', () => {
    test('should not treat end inside parentheses as block close', () => {
      const source = `function f
A(end)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat end inside brackets as block close', () => {
      const source = `function f
A = B[end]
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle nested parentheses with end', () => {
      const source = `function f
A(B(end), 1)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Line continuation', () => {
    test('should ignore keywords in line continuation', () => {
      const source = `function f ... if
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Block comment trailing content', () => {
    test('should treat %{ with trailing text as single-line comment', () => {
      const source = `%{ not a block comment
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Digit transpose vs string', () => {
    test('should treat digit followed by quote-letter as string, not transpose', () => {
      const pairs = parser.parse("x = [1'end for while'];\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Test helper methods - language-specific', () => {
    test('getExcludedRegions should return block comment', () => {
      const source = `%{
block comment
%}`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
    });
  });

  suite('Block comment with leading whitespace', () => {
    test('should handle %{ with leading whitespace', () => {
      const source = `  %{
  if inside comment
  %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle %{ with tabs', () => {
      const source = `\t%{
if comment
\t%}
for i = 1:5
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle %} with leading whitespace', () => {
      const source = `%{
if inside
  %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Curly brace indexing', () => {
    test('should not treat end inside curly braces as block close', () => {
      const source = `function result = foo(C)
  x = C{end};
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat end inside nested curly braces as block close', () => {
      const source = `function result = foo(C)
  x = C{1}{end};
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle end inside mixed brackets and braces', () => {
      const source = `function result = foo(C)
  x = C{A(end)};
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Struct field access with end', () => {
    test('should not treat s.end as block close', () => {
      const source = `function f
  s.end = 5;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat obj.end in expression as block close', () => {
      const source = `for i = 1:10
  x = obj.end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat nested struct field end as block close', () => {
      const source = `function f
  x = a.b.end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat standalone end as block close', () => {
      const source = `if true
  x = 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 1: isPrecededByDot with line continuation', () => {
    test('should not treat end after dot with line continuation as block close', () => {
      const source = `function f
  x = obj. ...
    end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat end after dot with continuation and indentation as block close', () => {
      const source = `for i = 1:10
  result = data. ...
      end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat end after dot with multiple continuations as block close', () => {
      const source = `function f
  x = obj. ...
    ... more continuation
    end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat end without dot as block close after continuation', () => {
      const source = `function f
  x = value ...
    + 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Classdef section keywords as variables', () => {
    test('should not treat properties = as block open', () => {
      const source = `properties = 5;
if true
  x = 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat properties = at end of source as block open', () => {
      const source = 'properties =';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat events = as block open', () => {
      const source = `events = getEvents();
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Struct field access with block keywords', () => {
    test('should not treat s.if as block open', () => {
      const source = `function f
  x = s.if;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat s.for as block open', () => {
      const source = `function f
  x = s.for;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat s.else as block middle', () => {
      const source = `if true
  x = s.else;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat s.case as block middle', () => {
      const source = `switch value
  x = s.case;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should parse function containing struct field access', () => {
      const source = `function result = test()
  x = s.if;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('CRLF block comments', () => {
    test('should handle block comment with CRLF line endings', () => {
      const pairs = parser.parse('%{\r\nif inside\r\nend\r\n%}\r\nif true\r\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle comment with CR-only line endings', () => {
      const pairs = parser.parse('% comment\rif true\rend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single-quoted string with CR-only ending', () => {
      const source = "x = 'unterminated\rif true\r  action;\rend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle double-quoted string with CR-only ending', () => {
      const source = 'x = "unterminated\rif true\r  action;\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle block comment end-of-line with CR-only', () => {
      const source = '%{\rcomment\r%}\rif true\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize block comment start with CR-only ending', () => {
      const source = '%{\rcomment\r%}\rfor i = 1:10\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Coverage: transpose after number', () => {
    test('should treat apostrophe after number without letter as transpose', () => {
      const regions = parser.getExcludedRegions("x = 5'");
      assert.ok(regions.some((r) => r.end - r.start === 1));
    });

    test('should treat apostrophe after closing bracket as transpose', () => {
      const regions = parser.getExcludedRegions("x = A(1)'");
      assert.ok(regions.some((r) => r.end - r.start === 1));
    });
  });

  suite('Arguments as function call', () => {
    test('should not treat arguments(x) in expression as block open', () => {
      const source = `y = arguments(x);
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Nested block comments', () => {
    test('should handle nested block comments', () => {
      const source = `%{
outer comment
  %{
  inner comment
  %}
%}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should track depth in nested block comments', () => {
      const source = `%{
level 1
  %{
  level 2
    %{
    level 3
    %}
  %}
%}
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Classdef section keyword edge cases', () => {
    test('should handle properties at line start followed by parentheses', () => {
      const source = `classdef MyClass
  properties (Access = public)
    Value
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should reject properties as function call after equals', () => {
      const source = `x = properties(obj);
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject methods as function call in expression', () => {
      const source = `result = methods(obj);
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject events as function call after comma', () => {
      const source = `list = [func1(), events(obj)]
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject enumeration as function call after opening paren', () => {
      const source = `func(enumeration(obj))
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject arguments as function call after opening bracket', () => {
      const source = `arr = [arguments(obj)]
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject properties as function call after opening brace', () => {
      const source = `cell = {properties(obj)}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject methods as function call after semicolon', () => {
      const source = `x = 1; methods(obj)
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should accept properties at line start not in expression', () => {
      const source = `classdef MyClass
properties(obj)
end`;
      const pairs = parser.parse(source);
      // properties at line start is treated as block keyword, not function call
      assertBlockCount(pairs, 1);
    });

    // Covers lines 76-77: return false when preceded by other characters (not =,(,[,{,,,;)
    test('should accept properties(obj) after identifier as block keyword', () => {
      const source = `classdef MyClass
x properties(Access = public)
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should accept methods(obj) after dot as struct field', () => {
      const source = `classdef MyClass
obj.methods(Static = true)
  properties
  end
end`;
      const pairs = parser.parse(source);
      // methods is preceded by '.' so should be filtered out
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: isKeywordUsedAsFunctionCall at file start', () => {
    test('should not treat properties(obj) at file start as function call', () => {
      // Line 70: beforePos < 0 (keyword at very start of file)
      const source = 'properties(Access = public)\n  Value\nend';
      const pairs = parser.parse(source);
      // At file start, properties with ( is ambiguous but treated as block keyword
      assertSingleBlock(pairs, 'properties', 'end');
    });

    test('should not treat methods(obj) at very start of file as function call', () => {
      const source = 'methods\n  function f()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: classdef section keyword inside parens', () => {
    test('should not treat properties inside parentheses as block open', () => {
      // isInsideParensOrBrackets returns true for classdef section keyword
      const source = `function f
  x = foo(properties);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat events inside brackets as block open', () => {
      const source = `function f
  x = [events];
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Bug fixes', () => {
    test("Bug 15: double transpose A'' should not create false string", () => {
      const source = `function f
  x = A''; if true, end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 16: classdef section keyword used in switch should not create block', () => {
      const source = `function f
  switch methods
    case 1
      x = 1;
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const switchPair = pairs.find((p) => p.openKeyword.value === 'switch');
      assert.ok(switchPair);
    });

    test('Bug 16: classdef section keyword after other tokens on line should not create block', () => {
      const source = `function f
  disp(methods)
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('Bug 8: MATLAB does not support backslash escapes in double-quoted strings', () => {
      // MATLAB only supports "" as escape in double-quoted strings, not backslash
      const source = 'x = "hello \\";\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat backslash as literal character in double-quoted string', () => {
      // "path\\to" should be a complete string (backslash is literal, "" is the only escape)
      const source = 'x = "path\\\\to";\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat backslash-quote as escape in double-quoted string', () => {
      // In MATLAB, \" does not escape the quote; the string ends at the first unescaped "
      const source = 'x = "test\\";\nif true\nend';
      const pairs = parser.parse(source);
      // "test\" ends at the first " (backslash is literal), then ;\nif true\nend is code
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat keyword after non-continuation transpose as dot access', () => {
      // A.' is the non-conjugate transpose operator, not a line continuation
      // The transpose creates an excluded region starting with A (not .), so
      // isPrecededByDot should not skip the newline after it
      const pairs = parser.parse("function result = myFunc(A)\n  B = A.'\n  if size(B, 1) > 1\n    result = B;\n  end\nend");
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should handle block comment %} with trailing whitespace before newline', () => {
      // Covers lines 261-263: lineEnd scanning past whitespace after %} closing
      const source = `%{
comment
%}   \nif true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 2: isPrecededByDot should not cross newlines', () => {
    test('should not treat newline between dot and keyword as preceded by dot', () => {
      const source = '1.\nend';
      const pairs = parser.parse(source);
      // Newline without ... continuation means end is NOT preceded by dot
      assertNoBlocks(pairs);
    });

    test('should still recognize dot continuation with ... across newlines', () => {
      const source = `function f
  x = obj. ...
    end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Intermediate keyword validation', () => {
    test('should reject catch on if block', () => {
      const source = `if condition
  catch
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject case on for block', () => {
      const source = `for i = 1:10
  case 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject otherwise on if block', () => {
      const source = `if condition
  otherwise
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject else on switch block', () => {
      const source = `switch value
  else
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject elseif on try block', () => {
      const source = `try
  elseif condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject catch on while block', () => {
      const source = `while condition
  catch
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should accept else on if block', () => {
      const source = `if condition
  x = 1;
else
  x = 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should accept case on switch block', () => {
      const source = `switch value
  case 1
    x = 1;
  otherwise
    x = 0;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'otherwise']);
    });

    test('should accept catch on try block', () => {
      const source = `try
  x = 1;
catch e
  x = 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });
  });

  suite('Bug 2: isPrecededByDot with line continuation crossing newline', () => {
    test('should filter end after dot with line continuation (verify correct end matched)', () => {
      const source = 'function f\n  x = obj. ...\n    end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // The matched end should be the last one (line 3), not the struct field end (line 2)
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should filter end after dot with CRLF line continuation', () => {
      const source = 'function f\r\n  x = obj. ...\r\n    end;\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should filter middle keyword after dot with line continuation', () => {
      const source = 'switch x\n  case 1\n    y = s. ...\n      else;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // else after s. ... should be filtered, only case should be intermediate
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not cross newline without line continuation (no false positive)', () => {
      const source = 'function f\n  x = obj.\nend';
      const pairs = parser.parse(source);
      // obj.\n  end - no ... continuation, so end is NOT preceded by dot
      // end on the next line IS a block close (matches function)
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: isPrecededByDot with block comment before newline', () => {
    test('should skip newline after block comment when checking dot precedence', () => {
      // Covers lines 169-170: block comment %{ %} ending right before a newline
      // The block comment is between the dot and keyword, acting like a continuation
      const source = 'function f\n  x = obj. %{ comment\n%}\nend;\nend';
      const pairs = parser.parse(source);
      // obj. followed by block comment then end on next line
      // The block comment region ends at the newline position after %}
      // isPrecededByDot should skip the newline after the block comment
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle CRLF line ending in dot continuation', () => {
      const source = 'function f\n  x = obj. ...\r\n  end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: isKeywordUsedAsFunctionCall CR-only line ending', () => {
    test('should detect line start with CR-only line endings', () => {
      // properties at line start with \r-only line endings should not be a function call
      const source = 'classdef Foo\rproperties\r  Value\rend\rend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'properties');
    });
  });

  suite('Branch coverage', () => {
    test('should skip newline after inline comment when checking dot precedence', () => {
      // Covers lines 169-170: isPrecededByDot second disjunct
      // % comment creates excluded region ending at \n position (LF-only)
      // When scanning backward from 'end', the newline check finds the comment region
      const source = 'function f\n  x = obj. % field\nend;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Branch coverage: isPrecededByDot with CRLF continuation', () => {
    test('should skip CRLF newline after line continuation when checking dot precedence', () => {
      // Covers lines 168-169: isPrecededByDot with CRLF and nlStart check
      // The ... continuation on line 2 ends before \r\n, and isPrecededByDot must handle
      // the CRLF pair to find the dot on the previous line
      const source = 'function f\n  x = obj. ...\r\n    end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: isCommentChar', () => {
    test('should return false for % in MATLAB (isCommentChar is not used for comment detection)', () => {
      // Covers matlabParser.ts lines 250-251: isCommentChar always returns false in MATLAB
      // isCommentChar is called from isValidBlockOpen for classdef section keywords
      // In MATLAB, % is handled by tryMatchExcludedRegion, not isCommentChar
      // A classdef section keyword followed by a non-%, non-newline, non-( character
      // that is also not a comment char (isCommentChar returns false) should be rejected
      const source = `classdef MyClass
  properties + 1
  end
end`;
      const pairs = parser.parse(source);
      // properties is followed by '+', which is not newline/(/comment,
      // so isCommentChar('+') returns false, and the keyword is rejected
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should reject classdef section keyword followed by operator', () => {
      // Covers lines 61, 63-64: isCommentChar returns false for non-comment chars
      const source = `classdef MyClass
  methods - 1
  end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should accept classdef section keyword followed by % comment', () => {
      // Line 60: source[nextPos] !== '%' check - when it IS %, the condition short-circuits
      const source = `classdef MyClass
  properties % with access
    Value
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'properties');
    });
  });

  suite('Coverage: isInsideParensOrBrackets curly brace depth', () => {
    test('should track curly brace depth correctly for nested braces', () => {
      // Covers matlabParser.ts lines 185-186: braceDepth-- path
      const source = `function f
  x = {{end}};
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Coverage: isPrecededByDot CRLF line continuation', () => {
    test('should handle CRLF line endings with ... continuation in isPrecededByDot', () => {
      // Covers matlabParser.ts lines 185-186: CRLF handling in isPrecededByDot
      // obj. followed by ... continuation with CRLF, then end keyword
      const source = 'function f\r\n  x = obj. ...\r\n    end;\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Bug: block openers inside parentheses or brackets', () => {
    test('should not detect if inside parentheses as block opener', () => {
      const source = 'function f\n  x = foo(if);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not detect for inside brackets as block opener', () => {
      const source = 'function f\n  x = [for];\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not detect while inside braces as block opener', () => {
      const source = 'function f\n  x = {while};\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still detect if at top level as block opener', () => {
      const source = 'if true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: transpose after double-quoted string', () => {
    test('should treat single quote after closing double quote as transpose', () => {
      const regions = parser.getExcludedRegions('"x"\'');
      assert.strictEqual(regions.length, 2);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 3);
      assert.strictEqual(regions[1].start, 3);
      assert.strictEqual(regions[1].end, 4);
    });
  });

  generateCommonTests(config);
});
