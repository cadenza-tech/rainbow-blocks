import * as assert from 'node:assert';
import { MatlabBlockParser } from '../../parsers/matlabParser';
import { assertBlockCount, assertIntermediates, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

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
    stringBlockClose: 'end',
    singleQuotedStringSource: "msg = 'if for while end';\nif true\nend",
    singleQuotedStringBlockOpen: 'if',
    singleQuotedStringBlockClose: 'end',
    commentAtEndOfLineSource: 'if true % this is a comment with end in it\n  action();\nend',
    commentAtEndOfLineBlockOpen: 'if',
    commentAtEndOfLineBlockClose: 'end',
    escapedQuoteStringSource: "msg = 'it''s an if statement';\nif true\nend",
    escapedQuoteStringBlockOpen: 'if',
    escapedQuoteStringBlockClose: 'end',
    nestedBlockSource: `function result = outer()
  for i = 1:10
    if i > 5
      disp(i);
    end
  end
end`,
    nestedBlockCount: 3,
    nestedBlockLevels: [
      { keyword: 'if', level: 2 },
      { keyword: 'for', level: 1 },
      { keyword: 'function', level: 0 }
    ]
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
    generateNestedBlockTests(config);

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
  });

  suite('Excluded regions - Strings', () => {
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

    test('should not treat numeric decimal point with continuation as struct access', () => {
      const pairs = parser.parse('x = 1. ...\nif true\nend');
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

  suite('Identifier-letter transpose vs string', () => {
    test('should treat quote-letter after identifier as string, not transpose', () => {
      // The transpose operator cannot follow an identifier letter and then a letter:
      // `disp'end'` is `disp` followed by the string literal `'end'`. The `end` inside
      // the string must not be tokenized, so `if` pairs with the LAST `end` (line 3),
      // not the `end` inside the string on line 1.
      const source = "if a\nx = disp'end'\nb = 2\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'if should pair with the real end on line 3');
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

    test('should not filter end after scientific notation dot', () => {
      const pairs = parser.parse('if true\n  x = 1e5.end\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isPrecededByDot with digit-ending variable names', () => {
    test('should not treat data1.end as block close', () => {
      const source = `function process(data1)
  n = data1.end;
  for i = 1:n
    disp(i);
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcPair = findBlock(pairs, 'function');
      assert.strictEqual(funcPair.closeKeyword.line, 5, 'function should pair with standalone end on line 5');
      findBlock(pairs, 'for');
    });

    test('should not treat x2.end as block close', () => {
      const source = `function f
  x = x2.end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with standalone end on line 2');
    });

    test('should not treat _0.end as block close', () => {
      const source = `function f
  x = _0.end;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with standalone end on line 2');
    });

    test('should still treat numeric decimal 10.end correctly', () => {
      const source = `function f
  x = 10.end;
end`;
      const pairs = parser.parse(source);
      // 10.end: 10. is numeric decimal, end is block close matching function
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat digit-ending variable with dot keyword as block open', () => {
      const source = `function f
  x = x2.for;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
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

  suite('Regression: block opener keywords used as variable names', () => {
    test('should not treat for = as block open', () => {
      const source = 'for = 10;\nif true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat end = as block close when another end follows', () => {
      const source = 'if true\n  end = 5;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'close keyword should be the last end');
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

  suite('Coverage: classdef section keywords require enclosing classdef', () => {
    test('should not treat properties at file start as block open without classdef', () => {
      // Line 70: properties at very start is ambiguous; without classdef it is treated as
      // function call/identifier and skipped from block matching
      const source = 'properties(Access = public)\n  Value\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
    });

    test('should not treat methods at very start of file as block open without classdef', () => {
      const source = 'methods\n  function f()\n  end\nend';
      const pairs = parser.parse(source);
      // Only function/end pair survives; methods is skipped (no enclosing classdef)
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'function');
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

    test('should register at most one catch on a try block with duplicate catch', () => {
      const source = `try
catch a
catch b
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      // MATLAB allows at most one catch per try; the second catch is invalid syntax
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should register at most one else on an if block with duplicate else', () => {
      const source = `if a
else
else
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // else must be the last branch of an if; the second else is invalid syntax
      assertIntermediates(pairs[0], ['else']);
    });

    test('should reject elseif appearing after else on an if block', () => {
      const source = `if a
else
elseif b
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // elseif after else is invalid syntax; only the else is recorded
      assertIntermediates(pairs[0], ['else']);
    });

    test('should register at most one otherwise on a switch block with duplicate otherwise', () => {
      const source = `switch value
otherwise
otherwise
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // only one otherwise is valid per switch; the second is invalid syntax
      assertIntermediates(pairs[0], ['otherwise']);
    });

    test('should reject case appearing after otherwise on a switch block', () => {
      const source = `switch value
otherwise
case 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // case after otherwise is invalid; otherwise must be the last branch
      assertIntermediates(pairs[0], ['otherwise']);
    });

    test('should accept multiple elseif and multiple case', () => {
      const source = `if a
elseif b
elseif c
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // elseif is allowed to repeat
      assertIntermediates(pairs[0], ['elseif', 'elseif']);
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

  suite('Bug: classdef section keyword followed by string literal', () => {
    test('should not treat properties followed by single-quoted string as block open', () => {
      const source = "function f\nproperties 'test'\n  x = 1;\nend\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat properties followed by double-quoted string as block open', () => {
      const source = 'function f\nproperties "test"\n  x = 1;\nend\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat methods followed by empty single-quoted string as block open', () => {
      const source = "function f\nmethods ''\n  x = 1;\nend\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat events followed by single-quoted string as block open in classdef', () => {
      const source = "classdef Foo\nevents 'trigger'\nend\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should not treat enumeration followed by double-quoted string as block open', () => {
      const source = 'classdef Foo\nenumeration "Red"\nend\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should not treat arguments followed by single-quoted string as block open', () => {
      const source = "function f(x)\narguments 'test'\n  x double\nend\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still accept properties followed by comment as block open', () => {
      const source = 'classdef MyClass\n  properties % comment\n    Value\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'properties');
    });

    test('should not treat properties followed by colon as block open', () => {
      // MATLAB has no label syntax; `:` is the range operator, so `properties:` is
      // invalid section-keyword usage. The keyword must be rejected and the user's
      // stray inner `end` absorbed via the phantom mechanism, so classdef pairs with
      // the LAST end (line 4), producing a single classdef/end pair.
      const source = 'classdef C\nproperties:\nx\nend\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 4, 'classdef should pair with the LAST end');
      assert.strictEqual(pairs.length, 1, 'only the classdef/end pair should be produced');
    });

    test('should still accept methods followed by line continuation as block open', () => {
      const source = 'classdef MyClass\n  methods ...\n    (Access = public)\n    function f()\n    end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'methods');
    });
  });

  suite('Regression: isPrecededByDot with numeric and hex literal prefix', () => {
    test('should filter end after 0xFF. (invalid syntax, avoid breaking outer block)', () => {
      // 0xFF.end: invalid syntax (numeric literal + keyword); filtering avoids breaking
      // the outer block when this appears mid-expression
      const tokens = parser.getTokens('0xFF.end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end immediately after hex literal dot should be filtered');
    });

    test('should filter end after 0xAB. (invalid syntax)', () => {
      const tokens = parser.getTokens('0xAB.end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end immediately after hex literal dot should be filtered');
    });

    test('should filter end after 0b1010. (invalid syntax)', () => {
      const tokens = parser.getTokens('0b1010.end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end immediately after binary literal dot should be filtered');
    });

    test('should still filter end after obj. as struct field access', () => {
      const tokens = parser.getTokens('obj.end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end after struct dot should be filtered');
    });

    test('should filter end after 10. (invalid 10.end syntax)', () => {
      const tokens = parser.getTokens('10.end');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end immediately after numeric dot should be filtered');
    });

    test('should NOT filter keyword separated from numeric dot by whitespace/continuation', () => {
      // 1. ... <newline> if : decimal point with line continuation followed by separate statement
      const tokens = parser.getTokens('x = 1. ...\nif true\nend');
      assert.ok(
        tokens.some((t) => t.value === 'if'),
        'if after dot+continuation should be tokenized'
      );
    });
  });

  suite('Regression: surrogate pair Unicode letter before transpose', () => {
    test('should treat single quote after surrogate pair letter as transpose', () => {
      const pairs = parser.parse("\u{20000}'; if true; end");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: shell escape after statement terminator', () => {
    test('should recognize shell escape after semicolon', () => {
      const source = 'x = 1; !ls if for end\nfor i=1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should recognize shell escape after comma', () => {
      const source = 'x = 1, !ls if for end\nfor i=1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still recognize shell escape at line start', () => {
      const source = '!ls if for end\nfor i=1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Regression 2026-04-29: BOM + shell escape, struct-field-style numeric', () => {
    test('should recognize !cmd after BOM at file start', () => {
      const source = '﻿!if for end\nfor i=1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
    test('should treat 1.5.end as field access not block close', () => {
      const source = 'function f\n  if true\n    x = 1.5.end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
    test('should treat 1e5.end as field access not block close', () => {
      const source = 'function f\n  if true\n    x = 1e5.end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
    test('should accept properties; as empty section', () => {
      const source = 'classdef Foo\n  properties;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
    test('should still detect end blocks when ( is unterminated', () => {
      const source = 'function f\n  x = foo(\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: arguments block inside function body (R2019b+)', () => {
    test('should detect arguments block inside function', () => {
      const source = 'function r = myFunc(x)\n  arguments\n    x (1,1) double\n  end\n  r = x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const fnPair = pairs.find((p) => p.openKeyword.value === 'function');
      const argsPair = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(fnPair, 'function should pair with end');
      assert.ok(argsPair, 'arguments should pair with end');
    });
  });

  suite('Regression: block opener as standalone identifier on RHS of assignment', () => {
    test('should not treat for as block opener in r = for;', () => {
      const source = 'function r = make\n  r = for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should not treat if as block opener in r = if;', () => {
      const source = 'function r = make\n  r = if;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should not treat while as block opener in r = while;', () => {
      const source = 'function r = make\n  r = while;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: for loop with 1:end should not have inner end as block close', () => {
    test('should keep function/end as outer pair when for header uses 1:end', () => {
      const source = 'function f\n  for i = 1:end\n    disp(i);\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const fnPair = pairs.find((p) => p.openKeyword.value === 'function');
      const forPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(fnPair, 'function should pair with outer end');
      assert.ok(forPair, 'for should pair with inner end');
    });
  });

  suite('Regression: case keyword as variable name', () => {
    test('should not register case as intermediate when used as variable', () => {
      const source = 'switch x\n  case = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case = 5 should not register as intermediate');
    });
  });

  suite('Regression: parfor and mid-line for header', () => {
    test('should treat parfor i = 1:end as range expression, not block close', () => {
      const source = 'function f(arr)\n  parfor i = 1:end\n    arr(i) = i;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
    test('should treat for after ; as range expression', () => {
      const source = 'if true; for i = 1:end, body; end; end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: end after binary operator', () => {
    test('should not treat end after + as block close', () => {
      const source = 'function f()\n  x = 1 + end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-06: MATLAB end-as-operand outside indexing', () => {
    test('should pair function with the end on line 2, not the bogus end after =', () => {
      const source = 'function f\n  x = end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'closeKeyword should be on line 2 (the real end)');
    });

    test('should pair function with the end on line 2, not the bogus end after :', () => {
      const source = 'function f\n  x = 1:end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should pair function with the end on line 2, not the bogus end after ~', () => {
      const source = 'function f\n  x = ~end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should treat for i = end-1:5 LHS as range expression, not block close', () => {
      const source = 'function f\n  for i = end-1:5\n    disp(i);\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      // The for block should close at the end on line 3, not the end on line 1
      assert.strictEqual(forBlock.closeKeyword.line, 3);
    });

    test('should detect block_middle case inside parentheses as not an intermediate', () => {
      const source = 'switch x\n  z = foo(case);\n  case 1\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'case');
    });
  });

  suite('Regression 2026-05-06: MATLAB classdef section out-of-context', () => {
    test('should pair inner function-end correctly when methods is rejected outside classdef', () => {
      const source = 'methods\n  function f()\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // The inner end on line 2 closes function; the outer end on line 3 corresponds to rejected methods
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should pair inner if-end correctly when properties is rejected outside classdef', () => {
      const source = 'properties\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression 2026-05-06: MATLAB line-continuation in for-header and RHS identifier', () => {
    test('should treat for i = 1 then continued :end as range, not block close', () => {
      const source = 'function f\n  for i = 1 ...\n    :end\n    disp(i);\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should detect continued for; as RHS identifier, not block opener', () => {
      const source = 'function r = make\n  r = ...\n     for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-09: end after compound comparison operators', () => {
    test('should pair function with the outer end, not the bogus end after >=', () => {
      // Lines are 0-indexed. Line 0 = function f, line 4 = outer end.
      const source = 'function f\n  x = a >= end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      // The inner end-as-operand after `>=` should not be treated as block close.
      // Expected: function paired with outer end (line 4); if-end pair on lines 2-3.
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the LAST end');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should pair function with the outer end, not the bogus end after <=', () => {
      const source = 'function f\n  x = a <= end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should pair function with the outer end, not the bogus end after ==', () => {
      const source = 'function f\n  x = a == end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should pair function with the outer end, not the bogus end after ~=', () => {
      const source = 'function f\n  x = a ~= end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should pair function with the outer end, not the bogus end after != (Octave compat)', () => {
      // != is not standard MATLAB but we should still treat it as a binary operator
      // so `end` after it is operand context, not block close.
      const source = 'function f\n  x = a != end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });
  });

  suite('Regression 2026-05-09: end after binary operator with line continuation', () => {
    test('should not treat end after + ... newline as block close', () => {
      const source = 'function f\n  x = a + ...\n      end\nend';
      const pairs = parser.parse(source);
      // The `end` on line 2 is in expression context (after `+ ...`), not a block close.
      // function should pair with the outer end on line 3 (0-indexed).
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should pair with the outer end');
    });

    test('should not treat end after * ... newline as block close', () => {
      const source = 'function f\n  x = a * ...\n      end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not treat end after >= ... newline as block close', () => {
      const source = 'function f\n  x = a >= ...\n       end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not treat end after - with two-line continuation as block close', () => {
      const source = 'function f\n  x = a - ...\n      ...\n      end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });
  });

  suite('Regression 2026-05-09: end.x is struct field access, not block close', () => {
    test('should not treat end before .x as block close', () => {
      // Lines are 0-indexed. Line 0 = function f, line 2 = outer end.
      const source = 'function f\n  end.x = 1\nend';
      const pairs = parser.parse(source);
      // The `end.x` should not be treated as a block close because what follows
      // is `.x = 1`, indicating field access not block termination.
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: command-syntax disp end', () => {
    test('should not treat end after command-syntax invocation as block close', () => {
      // `disp end` is command-syntax sugar for `disp('end')` — `end` is a string argument.
      // Line 0 = function f, line 1 = disp end, line 2 = outer end.
      const source = 'function f\n  disp end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: block comment %{ followed by vertical tab or form feed', () => {
    test('should treat %{\\v as block comment start (vertical tab is whitespace)', () => {
      // `%{` followed by a vertical tab (\v) and then content should be treated as a block
      // comment start; the inner `end` keyword on the next line should not be tokenized.
      const source = '%{\v\n if true\n end\n%}\nfunction f\nend';
      const pairs = parser.parse(source);
      // Only function-end pair should be detected; the if/end inside the block comment
      // must be excluded.
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should treat %{\\f as block comment start (form feed is whitespace)', () => {
      const source = '%{\f\n if true\n end\n%}\nfunction f\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-09: end after logical NOT operator !', () => {
    test('should not treat end after ! (logical NOT) as block close', () => {
      // `!end` is logical-NOT applied to `end` (operand context). The `end` is invalid
      // outside of array indexing, but treating it as block_close destroys outer pairing.
      // Lines: 0 = function f, 1 = x = !end, 2 = if true, 3 = end, 4 = outer end.
      const source = 'function f\n  x = !end\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });
  });

  suite('Regression 2026-05-09: BOM at file start does not break command-syntax detection', () => {
    test('should not tokenize end after disp when the file starts with BOM + disp end', () => {
      // `﻿` is the byte-order-mark; some saved files include it. After the BOM the
      // very first statement is `disp end` which is command-syntax (`disp('end')`).
      // The parser must skip the BOM when checking statement-start so the `end` here is
      // not treated as block_close. Without the BOM fix the leading `end` gets tokenized
      // as block_close even though it is a string argument.
      const source = '﻿disp end';
      const tokens = parser.getTokens(source);
      // No tokens should be emitted; `end` is a command-syntax argument, not a block close.
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end after disp at file start with BOM must be filtered as command-syntax arg');
    });
  });

  suite('Regression 2026-05-09: end .field with whitespace before dot is field access', () => {
    test('should not treat end .field as block close (space before dot)', () => {
      // `end .x` (whitespace then dot then identifier) is struct field access, not a
      // block close. Lines: 0 = function f, 1 = end .x = 1, 2 = outer end.
      const source = 'function f\n  end .x = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });

    test('should not treat end\\t.field as block close (tab before dot)', () => {
      const source = 'function f\n  end\t.x = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression 2026-05-09: section keyword rejected at tokenize keeps stray end skipped', () => {
    test('should pair classdef with the LAST end when properties + 1 (operator) is rejected', () => {
      // `properties + 1` is invalid section-keyword usage — the parser rejects it at
      // tokenize. The `end` on line 2 was intended for the (rejected) properties block,
      // so classdef should pair with the LAST end on line 3, leaving the stray end
      // unmatched (defensive: avoids classdef pairing with the wrong end).
      const source = 'classdef A\n  properties + 1\n  end\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 3, 'classdef should pair with the LAST end');
    });

    test('should pair classdef with the LAST end when properties = 5 (assignment) is rejected', () => {
      const source = 'classdef A\n  properties = 5\n  end\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 3, 'classdef should pair with the LAST end');
    });
  });

  suite('Regression 2026-05-18: section keyword assignment across line continuation', () => {
    test('should reject properties as section keyword when = is after a ... line continuation', () => {
      // `properties ...\n= 5` is `properties = 5` split across a line continuation —
      // an invalid section-keyword usage just like the same-line `properties = 5`.
      // The keyword must be rejected and the user's stray inner `end` absorbed via the
      // phantom mechanism, so classdef pairs with the LAST end (line 5), leaving a
      // single classdef/end pair.
      const source = 'classdef C\nproperties ...\n= 5\nx\nend\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 5, 'classdef should pair with the LAST end');
      assert.strictEqual(pairs.length, 1, 'only the classdef/end pair should be produced');
    });
  });

  suite('Regression 2026-05-09: case as function call vs block_middle', () => {
    test('should not treat case() function call inside switch as intermediate', () => {
      // `case(value)` inside a function body that is also inside a switch should be
      // treated as a function call, not a switch-case intermediate. The expected
      // structure: switch...end with no intermediates, and the function call doesn't
      // create a phantom intermediate.
      const source = 'switch x\n  case 1\n    y = case(value);\n    z = 2;\nend';
      const pairs = parser.parse(source);
      // switch pairs with end. Only the leading `case 1` is a real intermediate.
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });
  });

  suite('Regression 2026-05-09: command-syntax with case as argument', () => {
    test('should not treat clear case as block_middle', () => {
      // `clear case` is command-syntax: `clear` is a command and `case` is its string
      // argument. The `case` here must not be tokenized as block_middle.
      const source = 'switch x\n  case 1\n    clear case\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // Only the real `case 1` should be in intermediates.
      assertIntermediates(pairs[0], ['case']);
    });
  });

  suite('Regression 2026-05-09: command-syntax with line continuation before end', () => {
    test('should treat disp ...\\n end as command-syntax (... continuation)', () => {
      // `disp ...\n end` — the `disp` is command-syntax and the `...` continues onto
      // the next line where `end` appears as the string argument. The parser must
      // recognise this and not treat the `end` as block close.
      const source = 'function f\n  disp ...\n   end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: command-syntax with multiple arguments before end', () => {
    test('should treat clear all end as command-syntax (multi-arg form)', () => {
      // `clear all end` is command-syntax: `clear` is a command and `all`, `end` are
      // string arguments. Currently the parser only checks the immediately-preceding
      // identifier — but `end` here is the LAST arg, preceded by `all` which is not
      // a recognised keyword, so the rejection should still fire.
      const source = 'function f\n  clear all end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: do is not a reserved word in MATLAB', () => {
    test('should treat do end as command-syntax (do is identifier in MATLAB)', () => {
      // In MATLAB `do` is NOT a reserved word (it is Octave-specific). When `do end`
      // appears in MATLAB the `end` is a command-syntax string argument, not a block
      // close. Lines: 0 = function f, 1 = do end, 2 = outer end.
      const source = 'function f\n  do end\nend';
      const pairs = parser.parse(source);
      // function should pair with the OUTER end, not with the `end` inside `do end`.
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: command-syntax with intermediate block_keyword args', () => {
    test('should not treat case after disp end as block_middle in switch', () => {
      // `disp end case` is command-syntax: `disp` is command, `end` and `case` are
      // string arguments. The second `case` must NOT be treated as a real switch-case
      // intermediate. Without this fix the `end` blocks command-syntax detection for
      // `case`.
      const source = 'switch x\n  case 1\n    disp end case\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // Only the real `case 1` should be in intermediates.
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not treat catch after clear end as block_middle in try', () => {
      const source = 'try\n  x = 1;\n  clear end catch\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      // `catch` after `clear end` is a command-syntax string argument, not a real catch.
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat else after disp end as block_middle in if', () => {
      const source = 'if x\n  disp end else\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still preserve real case 1, case 2 in switch', () => {
      // Sanity check: real cases must continue to work.
      const source = 'switch x\n  case 1\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'case']);
    });

    test('should still preserve real catch after if-end inside try', () => {
      // Sanity check: real if/end inside try followed by real catch should still work.
      const source = 'try\n  if x\n  end\ncatch e\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const tryBlock = findBlock(pairs, 'try');
      assertIntermediates(tryBlock, ['catch']);
    });
  });

  suite('Regression 2026-05-09: function handle @ with whitespace before keyword', () => {
    test('should not treat for after @ space as block_open', () => {
      // `@ for x` is technically invalid MATLAB (function handle requires no space after @),
      // but we should still treat the `for` here as a function handle target — not as a real
      // block opener — to avoid destroying outer block pairing.
      // Lines: 0 = function f, 1 = h = @ for x;, 2 = for i = 1:5, 3 = end (inner), 4 = outer end.
      const source = 'function f\n  h = @ for x;\n  for i=1:5\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      const forBlock = findBlock(pairs, 'for');
      // The for at line 2 (real for-loop) should pair with end at line 3.
      assert.strictEqual(forBlock.openKeyword.line, 2);
      assert.strictEqual(forBlock.closeKeyword.line, 3);
    });

    test('should not treat if after @\\t (tab) as block_open', () => {
      const source = 'function f\n  h = @\tif x;\n  if y\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat while after @ multiple spaces as block_open', () => {
      const source = 'function f\n  h = @   while x;\n  if y\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should still treat @keyword without space as function handle', () => {
      // Sanity check: existing behavior must be preserved.
      const source = 'function f\n  h = @for;\n  if y\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-09: block_middle as RHS identifier is not intermediate', () => {
    test('should not treat case as intermediate when used as RHS identifier in switch', () => {
      // `y = case;` — `case` is on the RHS of an assignment, an operand context.
      // Treating it as a switch-case intermediate would corrupt the switch structure.
      const source = 'switch x\n  y = case;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case = RHS should not register as intermediate');
    });

    test('should not treat otherwise as intermediate when used as RHS identifier in switch', () => {
      const source = 'switch x\n  y = otherwise;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat else as intermediate when used as RHS identifier in if', () => {
      const source = 'if x\n  y = else;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat elseif as intermediate when used as RHS identifier in if', () => {
      const source = 'if x\n  y = elseif;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat catch as intermediate when used as RHS identifier in try', () => {
      const source = 'try\n  y = catch;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat real case 1 as intermediate', () => {
      // Sanity check: real case at statement start should still be recognized.
      const source = 'switch x\n  case 1\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });
  });

  suite('Regression 2026-05-09: block_open after binary operator is not block_open', () => {
    test('should not treat for after == as block_open', () => {
      // `x == for;` — `for` is on the RHS of a comparison, an operand context. Treating it
      // as a real block opener would consume the next `end` and break outer pairing.
      const source = 'function f\n  x == for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat parfor after + as block_open', () => {
      const source = 'function f\n  x = parfor + 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat for after ~ (logical NOT) as block_open', () => {
      const source = 'function f\n  ~for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat if after === (triple equals) as block_open', () => {
      // Triple equals (===) is invalid MATLAB but should still place if in operand context.
      const source = 'function f\n  x === if;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat while after >= as block_open', () => {
      const source = 'function f\n  x >= while;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat switch after <= as block_open', () => {
      const source = 'function f\n  x <= switch;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat try after ~= as block_open', () => {
      const source = 'function f\n  x ~= try;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat for after * as block_open', () => {
      const source = 'function f\n  x = a * for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat top-level for at line start as block opener', () => {
      // Sanity check: real for at statement start should still be recognized.
      const source = 'for i = 1:5\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Regression 2026-05-16: block opener followed by binary operator is not block_open', () => {
    test('should not treat for followed by + as block_open', () => {
      // `for + 1;` uses the reserved word `for` as an operand of `+` — invalid MATLAB.
      // Treating `for` as a block opener consumes the `if`-block end and breaks pairing.
      // Lines: 0 = function f, 1 = for + 1, 2 = if true, 3 = inner end, 4 = outer end.
      const source = 'function f\n  for + 1;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.openKeyword.line, 2);
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should not treat while followed by * as block_open', () => {
      const source = 'function f\n  while * 2;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat for followed by compound assignment += as block_open', () => {
      const source = 'function f\n  for += 1;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat if followed by compound assignment -= as block_open', () => {
      const source = 'function f\n  if -= 1;\n  switch x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat switch followed by / as block_open', () => {
      const source = 'function f\n  switch / 2;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should still treat for followed by an identifier as block opener', () => {
      // Sanity check: a real `for` header (`for i = 1:5`) must remain a block opener.
      const source = 'function f\n  for i = 1:5\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.line, 1);
    });

    test('should still treat for followed by ( as block opener', () => {
      // `for (i = 1:5)` parenthesised header must remain a block opener.
      const source = 'function f\n  for (i = 1:5)\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.line, 1);
    });
  });

  suite('Regression 2026-05-21: statement keyword followed by prefix-capable operator is not block_open', () => {
    // `try`/`spmd`/`classdef` take no expression in their header — `try` starts a block
    // immediately, `spmd` allows a parenthesised worker-count, and `classdef` takes a name.
    // None of them can legitimately be followed by a prefix-capable operator (`+ - ~ !`),
    // so such forms (`try + 1`) are invalid MATLAB and must not register as block openers.
    // If they did, the keyword would consume a real `end` belonging to an outer block.
    // `if`/`while`/`switch` take an expression that legitimately can start with a unary
    // `+ - ~ !` (e.g. `if ~isempty(x)`), so they remain unaffected.
    test('should not treat try followed by + as block_open', () => {
      // `try + 1` is invalid MATLAB: `try` does not take an expression after it.
      // Lines: 0 = function foo(), 1 = try + 1, 2 = y = 2;, 3 = end.
      const source = 'function foo()\n  try + 1\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should pair with the outer end');
    });

    test('should not treat try followed by - as block_open', () => {
      const source = 'function foo()\n  try - 1\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat try followed by ~ as block_open', () => {
      const source = 'function foo()\n  try ~x\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat try followed by ! as block_open', () => {
      const source = 'function foo()\n  try !cmd\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat spmd followed by + as block_open', () => {
      const source = 'function foo()\n  spmd + 1\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat spmd followed by ~ as block_open', () => {
      const source = 'function foo()\n  spmd ~x\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat classdef followed by + as block_open', () => {
      const source = 'function foo()\n  classdef + 1\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat classdef followed by - as block_open', () => {
      const source = 'function foo()\n  classdef - 1\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat real try as block opener', () => {
      // Sanity check: real try block (no operator following) must remain a block opener.
      const source = 'function foo()\n  try\n    y = 1;\n  catch err\n    y = 2;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const tryBlock = findBlock(pairs, 'try');
      assert.strictEqual(tryBlock.openKeyword.line, 1);
      assertIntermediates(tryBlock, ['catch']);
    });

    test('should still treat real spmd block as block opener', () => {
      // Sanity check: real spmd block must remain a block opener.
      const source = 'function foo()\n  spmd\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const spmdBlock = findBlock(pairs, 'spmd');
      assert.strictEqual(spmdBlock.openKeyword.line, 1);
    });

    test('should still treat real classdef as block opener', () => {
      // Sanity check: real classdef block must remain a block opener.
      const source = 'classdef MyClass\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should still treat if followed by ~ (unary NOT) as block opener', () => {
      // Sanity check: `if ~isempty(x)` is a legitimate expression-bearing block opener.
      const source = 'function foo()\n  if ~isempty(x)\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.openKeyword.line, 1);
    });

    test('should still treat while followed by ~ (unary NOT) as block opener', () => {
      const source = 'function foo()\n  while ~done\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const whileBlock = findBlock(pairs, 'while');
      assert.strictEqual(whileBlock.openKeyword.line, 1);
    });
  });

  suite('Regression 2026-05-16: end followed by compound assignment is not block_close', () => {
    test('should not treat end followed by += as block close', () => {
      // `end += 1;` compound-assigns the reserved word `end` as a variable — invalid
      // MATLAB. Treating the line-1 `end` as a block close mis-pairs the if block.
      // Lines: 0 = if true, 1 = end += 1, 2 = outer end.
      const source = 'if true\n  end += 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'if should pair with the last end');
    });

    test('should not treat end followed by -= as block close', () => {
      const source = 'if true\n  end -= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end followed by *= as block close', () => {
      const source = 'if true\n  end *= 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end followed by ^= as block close', () => {
      const source = 'if true\n  end ^= 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end followed by logical-and compound assignment &= as block close', () => {
      // `end &= 1;` compound-assigns the reserved word `end` as a variable (≡ `end = end & 1`),
      // mirroring the `+=`/`-=` cases above. The line-1 `end` is a variable use, not a block
      // close, so the `if` must pair with the outer `end` on line 2.
      const source = 'if true\n  end &= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'if should pair with the last end');
    });

    test('should not treat end followed by logical-or compound assignment |= as block close', () => {
      const source = 'if true\n  end |= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat a real end as block close when followed by == comparison', () => {
      // `end == 1` is a comparison, not a compound assignment. The `end` here is a
      // genuine block close of the for loop; only the `==` follows it. The for/end
      // pair must still be detected.
      const source = 'for i = 1:3\n  x = 1;\nend == 1;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still treat a real end as block close when followed by ~= comparison', () => {
      const source = 'for i = 1:3\n  x = 1;\nend ~= 1;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still treat a real end as block close when followed by >= comparison', () => {
      const source = 'for i = 1:3\n  x = 1;\nend >= 1;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Regression 2026-05-16: block_middle after binary operator or @ handle is not an intermediate', () => {
    test('should not treat case after a binary operator as an intermediate', () => {
      // `1 + case;` uses the reserved word `case` as an operand of `+` — invalid MATLAB.
      // The fake `case` must not register as a switch intermediate; only the real
      // `case 1` on the next line is a genuine intermediate.
      const source = 'switch x\n  1 + case;\n  case 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not treat otherwise after a binary operator as an intermediate', () => {
      // No `=` here, so the RHS-identifier check does not fire — this exercises the
      // binary-operator check specifically.
      const source = 'switch x\n  case 1\n  2 * otherwise;\n  otherwise\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'otherwise']);
    });

    test('should not treat else after a binary operator as an intermediate', () => {
      const source = 'if x\n  1 - else;\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after a binary operator is not an intermediate');
    });

    test('should not treat case after an @ function handle as an intermediate', () => {
      // `@case` is a function handle to a function named `case` — invalid because
      // `case` is reserved, but the `case` here is not a switch intermediate.
      const source = 'switch x\n  @case 1\n  case 2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not treat catch after an @ function handle as an intermediate', () => {
      // No `=` here, so the @ check is exercised directly rather than the RHS check.
      const source = 'try\n  @catch;\n  x = 1;\ncatch\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should still treat a real case at statement start as an intermediate', () => {
      // Sanity check: genuine case branches must remain intermediates.
      const source = 'switch x\n  case 1\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'case']);
    });
  });

  suite('Regression 2026-05-09: command-syntax argument is not block_open', () => {
    test('should treat clear if as command-syntax (if is string argument)', () => {
      // `clear if` is command-syntax: `clear` is a command and `if` is its string argument.
      // The `if` here must not be tokenized as block_open; otherwise the inner `if/end`
      // pair is broken and the outer `function/end` pairing is destroyed.
      // Lines: 0 = function f, 1 = clear if, 2 = if x, 3 = end (inner), 4 = outer end.
      const source = 'function f\n  clear if\n  if x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.openKeyword.line, 2, 'if should be the line-2 if, not the command-syntax arg');
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should treat clear for as command-syntax (for is string argument)', () => {
      const source = 'function f\n  clear for\n  for i = 1:5\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.line, 2);
    });

    test('should treat disp while as command-syntax (while is string argument)', () => {
      const source = 'function f\n  disp while\n  while x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should treat clear switch as command-syntax (switch is string argument)', () => {
      const source = 'function f\n  clear switch\n  switch x\n    case 1\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 5);
    });

    test('should treat clear try as command-syntax (try is string argument)', () => {
      const source = 'function f\n  clear try\n  try\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 5);
    });

    test('should treat clear function as command-syntax (function is string argument)', () => {
      const source = 'function outer()\n  clear function\n  if x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      // outer function should pair with the LAST end (line 4), not the inner end (line 3)
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should treat clear classdef as command-syntax (classdef is string argument)', () => {
      const source = 'function f\n  clear classdef\n  if x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should treat clear parfor as command-syntax (parfor is string argument)', () => {
      const source = 'function f\n  clear parfor\n  parfor i = 1:5\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should still treat top-level if at line start as block opener', () => {
      // Sanity check: real if at statement start should still be recognized.
      const source = 'if x\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-15: large orphan end token list parses in linear time', () => {
    test('should parse 10000 orphan end tokens in linear time', () => {
      // Previously isInsideParensOrBrackets walked the source backward from each `end`,
      // making the worst case O(N^2). With 10000 orphan ends this took ~700ms; at 100k
      // it took ~63s. After precomputing bracket positions, the runtime is dominated by
      // tokenize and stays well under 2s for 10k.
      const N = 10000;
      const source = 'end\n'.repeat(N);
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assert.strictEqual(pairs.length, 0, 'orphan ends produce no pairs');
      assert.ok(elapsed < 3000, `expected parse to complete in <3000ms, took ${elapsed}ms (likely O(N^2) regression)`);
    });
  });

  suite('Regression 2026-05-16: space-separated keywords on one logical line parse in linear time', () => {
    test('should parse 8000 space-separated orphan end tokens in linear time', () => {
      // Previously isCommandSyntaxArgument (and the other logical-line-scanning methods)
      // walked from each keyword backward to the logical-line start. When many keywords
      // share one physical line (no `;`/`,`/newline between them), this is O(N^2): 8000
      // space-separated `end` tokens took ~4s while the same count newline-separated took
      // ~15ms. After caching logical-line boundaries in tokenize(), the same-line case is
      // linear too.
      const N = 8000;
      const source = `${'end '.repeat(N)}`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assert.strictEqual(pairs.length, 0, 'orphan ends produce no pairs');
      assert.ok(elapsed < 3000, `expected parse to complete in <3000ms, took ${elapsed}ms (likely O(N^2) regression)`);
    });

    test('should parse 8000 space-separated orphan for tokens in linear time', () => {
      // The block_open path (isUsedAsRhsIdentifier / isCommandSyntaxArgument) is O(N^2)
      // for the same reason. `for` keywords share one physical line here.
      const N = 8000;
      const source = `${'for '.repeat(N)}`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assert.strictEqual(pairs.length, 0, 'orphan for openers without end produce no pairs');
      assert.ok(elapsed < 3000, `expected parse to complete in <3000ms, took ${elapsed}ms (likely O(N^2) regression)`);
    });
  });

  suite('Regression 2026-05-15: section keyword as function call inside function should not consume function end', () => {
    test('should pair function with end when properties(obj) appears inside function body without classdef', () => {
      // `properties(obj)` inside a free function (no enclosing classdef) is a function
      // call, not a section keyword. The previous implementation pushed a pendingSkipDepth
      // entry for the rejected section keyword, which then consumed the function's `end`,
      // leaving the function/end pair missing.
      const source = 'function showProps(obj)\n  properties(obj)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should pair function with end when methods(obj) appears inside function body without classdef', () => {
      const source = 'function showMethods(obj)\n  methods(obj)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should pair function with end when events(obj) appears inside function body without classdef', () => {
      const source = 'function showEvents(obj)\n  events(obj)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should pair function with end when enumeration(obj) appears inside function body without classdef', () => {
      const source = 'function showEnum(obj)\n  enumeration(obj)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-23: assignment to keyword across ... line continuation', () => {
    test('should not treat end as block close when = follows across a ... line continuation', () => {
      // `end ...\n      = 5;` is `end = 5;` split across a line continuation — the `end`
      // is being assigned as a variable, an invalid use of the reserved word but not a
      // block close. The same-line `end = 5;` form is already rejected; the continuation
      // form must be symmetric. The `if` must therefore pair with the LAST end (line 3),
      // and the line-1 `end` must be excluded.
      const source = 'if true\n  end ...\n      = 5;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'if should pair with the last end, not the continuation-assigned end');
    });

    test('should not treat end as block close when compound assignment follows across a ... line continuation', () => {
      // `end ...\n      += 1;` ≡ `end += 1;` (≡ `end = end + 1`) split across a line
      // continuation — a compound assignment to the reserved word `end`, not a block close.
      const source = 'if true\n  end ...\n      += 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'if should pair with the last end, not the continuation-assigned end');
    });

    test('should not treat for as block open when = follows across a ... line continuation', () => {
      // `for ...\n    = 10` is `for = 10` split across a line continuation — the `for`
      // is being assigned as a variable, not a loop header. The same-line `for = 10`
      // form is already rejected; the continuation form must be symmetric. The `for`
      // must be excluded so the `if` pairs with `end`.
      const source = 'if true\n  for ...\n    = 10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat if as block open when = follows across a ... line continuation', () => {
      const source = 'function f()\n  if ...\n    = 5;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat same-line end = 5 as variable (no regression)', () => {
      // The same-line assignment form must keep working after the continuation change.
      const source = 'if true\n  end = 5;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'close keyword should be the last end');
    });

    test('should still treat same-line for = 10 as variable (no regression)', () => {
      const source = 'for = 10;\nif true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: end used as case value should not be block close', () => {
    test('should not consume end when used as case value in switch', () => {
      // `case end` uses `end` as the case value (a reserved-word abuse for some MATLAB
      // numerical constant). Currently the inner `end` is greedily consumed as a block
      // close, which destroys the outer switch/end pair. The switch must still pair with
      // the final `end` on the last line.
      const source = 'switch x\n  case end\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5, 'switch should pair with the final end');
    });

    test('should not consume end when used as otherwise value in switch', () => {
      // Symmetric form: `otherwise end` (less common but parsing should remain safe).
      const source = 'switch x\n  case 1\n    y = 1;\n  otherwise end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4, 'switch should pair with the final end');
    });
  });

  suite('Regression: invalid empty-header block opener should not start a block', () => {
    test('should not treat if; as block open', () => {
      // `if;` has an empty condition — invalid MATLAB. Treating it as a block opener
      // consumes the outer function's `end`, destroying the function/end pair.
      const source = 'function f\n  if;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat for; as block open', () => {
      // `for;` has no loop variable assignment — invalid MATLAB.
      const source = 'function f\n  for;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat while; as block open', () => {
      const source = 'function f\n  while;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat switch; as block open', () => {
      const source = 'function f\n  switch;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat parfor; as block open', () => {
      const source = 'function f\n  parfor;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat if followed by comma as block open', () => {
      const source = 'function f\n  if,\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat if followed by newline directly as block open', () => {
      // Bare `if` (no condition, just newline) is also invalid MATLAB.
      const source = 'function f\n  if\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat bare try as valid block open (no condition required)', () => {
      // `try` is the one statement that can have an empty header in MATLAB.
      const source = 'function f\n  try\n    x = 1;\n  catch\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: end followed by binary operator (same line and continuation) is not block close', () => {
    test('should not treat end + 1 as block close on the same line', () => {
      // `end + 1` puts `end` in operand context — invalid MATLAB outside indexing.
      // Treating it as a block close destroys the outer function/end pair.
      const source = 'function f\n  end + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the final end');
    });

    test('should not treat end ...\\n + 1 (continuation) as block close', () => {
      const source = 'function f\n  end ...\n      + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should pair with the final end');
    });

    test('should still treat end == 1 as valid block close (comparison, not assignment)', () => {
      // Comparison operators are NOT compound assignments; the existing code deliberately
      // allows them. Ensure this no-regression case still works.
      const source = 'if x\n  end == 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 1, 'if should pair with the first end');
    });
  });

  suite('Regression: end followed by struct field access across line continuation is not block close', () => {
    test('should not treat end ...\\n .field as block close (continuation field access)', () => {
      const source = 'function f\n  end ...\n      .field\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should pair with the final end');
    });

    test('should still treat end .field on the same line as field access (no regression)', () => {
      const source = 'function f\n  end .field\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: block_middle (case/otherwise) followed by simple assignment across line continuation', () => {
    test('should not register case as intermediate when = follows across a ... line continuation', () => {
      // `case ...\n  = 5` is `case = 5` split across a line continuation — `case` is used
      // as a variable, not as a switch intermediate. Symmetric with the block_open side
      // which already handles `for ...\n = 10`.
      const source = 'switch x\n  case ...\n     = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case should not be registered as intermediate');
    });

    test('should not register otherwise as intermediate when = follows across a ... line continuation', () => {
      const source = 'switch x\n  case 1\n  otherwise ...\n     = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      // Only `case` should appear as intermediate; `otherwise` is consumed by the line-continuation assignment.
      assert.strictEqual(pairs[0].intermediates.length, 1, 'only case should be registered');
      assert.strictEqual(pairs[0].intermediates[0].value, 'case');
    });
  });

  suite('Regression 2026-05-23: single-quote followed by Unicode letter is string-start, not transpose', () => {
    test("should treat ' followed by Unicode letter as string-start (Greek epsilon)", () => {
      // `]'ε...'` with prev=`]` (value-like) and next=Greek `ε` (Unicode letter) should be
      // a string literal, not a transpose. The ASCII counterpart `]'e...'` already works.
      // Without the fix the inner `end` is wrongly tokenized as block close, destroying outer pairing.
      const source = "function f\n  x = a]'ε end ε'\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // function should pair with the OUTER end on line 2, not the inner `end` mis-tokenised inside the string.
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });

    test("should treat ' followed by Unicode letter as string-start (Latin a-umlaut)", () => {
      // Same pattern with `ä` (Latin small letter a with diaeresis, U+00E4). Same Unicode
      // letter category, so it must be treated identically to the ASCII case.
      const source = "function f\n  x = a]'ä end ä'\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('excluded regions should span the full string when prev is value-like and next is Unicode letter', () => {
      // Direct check: the excluded region must run from the first `'` to the second `'`
      // (a single contiguous string), not be two separate transpose markers.
      const source = "x = a]'ε end ε'";
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'should be a single string region, not two transpose markers');
      assert.strictEqual(regions[0].start, 6, 'string starts at the first single quote');
      assert.strictEqual(regions[0].end, source.length, 'string ends at the second single quote');
    });

    test("should still treat ' followed by ASCII letter as string-start (sanity check)", () => {
      // The ASCII counterpart must keep working.
      const source = "function f\n  x = a]'e end e'\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression 2026-05-23: arguments(obj) inside function body is function call, not block opener', () => {
    test('should not treat arguments(obj) as block opener inside function body', () => {
      // `arguments(obj)` inside a function body is a function call (e.g. retrieving
      // argument metadata via reflection), not a `arguments` validation block.
      // Treating it as a block opener consumes the outer function's `end`, destroying
      // the function/end pair.
      const source = 'function f(obj)\n  arguments(obj)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });

    test('should not treat arguments(x) inside function body as block opener', () => {
      // Same pattern with a different argument name.
      const source = 'function r = f(x)\n  arguments(x)\n  r = x;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still detect arguments (Input) as block opener inside function (sanity check)', () => {
      // `arguments (Input)` is a valid attribute-decorated arguments block.
      const source = 'function r = f(x)\n  arguments (Input)\n    x double\n  end\n  r = x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const argsBlock = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argsBlock, 'arguments (Input) should still be recognised as a block opener');
    });

    test('should still detect arguments (Output) as block opener inside function (sanity check)', () => {
      const source = 'function r = f(x)\n  arguments (Output)\n    r double\n  end\n  r = x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const argsBlock = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argsBlock, 'arguments (Output) should still be recognised as a block opener');
    });

    test('should still detect arguments (Repeating) as block opener (sanity check)', () => {
      const source = 'function r = f(varargin)\n  arguments (Repeating)\n    varargin\n  end\n  r = varargin;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const argsBlock = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argsBlock, 'arguments (Repeating) should still be recognised as a block opener');
    });

    test('should still detect bare arguments as block opener (no parentheses, sanity check)', () => {
      const source = 'function r = f(x)\n  arguments\n    x double\n  end\n  r = x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const argsBlock = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argsBlock, 'bare arguments should still be recognised as a block opener');
    });
  });

  generateCommonTests(config);
});
