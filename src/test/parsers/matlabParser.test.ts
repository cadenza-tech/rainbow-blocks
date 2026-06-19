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

    test('should treat ! as shell escape after VT (\\v) leading whitespace', () => {
      // `\v!if foo; bar; end` is a shell escape line where the `!` is preceded only by a
      // vertical tab. isAtStatementStart must treat \v as horizontal whitespace (matching
      // the broader isHorizontalWhitespace coverage) so the `!` is recognised as the
      // start of a shell escape and the rest of the line (including `if` and `end`) is
      // excluded from tokenisation. Without the fix the inner `end` is mis-tokenised and
      // pairs with the outer `if`, leaving the real outer `end` orphan.
      const source = 'if true\n\v!if foo; bar; end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'if must pair with the outer end on line 2');
    });

    test('should treat ! as shell escape after FF (\\f) leading whitespace', () => {
      const source = 'if true\n\f!if foo; bar; end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
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

  suite('Regression: index end inside unclosed bracket on same line is not block close', () => {
    test('should treat end inside unclosed ( on same line as array index, pairing function with outer end', () => {
      const source = 'function f\n  y = A(end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const fnPair = findBlock(pairs, 'function');
      assert.strictEqual(fnPair.closeKeyword?.line, 2, 'function should close at the L2 end, not the index end inside A(');
    });
    test('should treat end inside unclosed [ on same line as array index', () => {
      const source = 'function f\n  y = A[end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(findBlock(pairs, 'function').closeKeyword?.line, 2);
    });
    test('should treat end inside unclosed { on same line as array index', () => {
      const source = 'function f\n  y = C{end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(findBlock(pairs, 'function').closeKeyword?.line, 2);
    });
    test('should treat end inside unclosed ( after a balanced ( on same line as array index', () => {
      const source = 'function f\n  y = A(1) + B(end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(findBlock(pairs, 'function').closeKeyword?.line, 2);
    });
    test('should still pair end inside balanced ( as array index without consuming outer end', () => {
      const source = 'function f\n  y = A(end)\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(findBlock(pairs, 'function').closeKeyword?.line, 2);
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

    test('should treat \\v%} as block comment end (VT leading whitespace before %})', () => {
      // `%}` preceded ONLY by a vertical tab (\v) on its line should still close the block
      // comment. isAtLineStartWithWhitespace must treat \v as horizontal whitespace just
      // like the block-comment-start side (isBlockCommentStart) already does. Without the
      // fix the `%}` is not recognised as the block-comment terminator, leaving the inner
      // `if` un-excluded and the outer block pairing destroyed. Lines: 0=%{,
      // 1=foo, 2=\v%}, 3=if true, 4=end.
      const source = '%{\nfoo\n\v%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat \\f%} as block comment end (FF leading whitespace before %})', () => {
      const source = '%{\nfoo\n\f%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat \\v%{ as nested block comment start (VT leading whitespace before nested %{)', () => {
      // Nested `%{` preceded ONLY by a vertical tab (\v) on its line should still increase
      // the block-comment nesting depth. Without the fix, the inner `\v%{` is NOT recognised
      // as a nesting open and the FIRST `%}` closes the OUTER `%{` — the second `%}` is then
      // a stray and the comment ends earlier than intended. Adding `\v`-as-whitespace to
      // isAtLineStartWithWhitespace makes the inner `%{` increase depth, so the first `%}`
      // returns the depth to 1 and only the second `%}` actually closes the outer comment.
      // Lines: 0=%{, 1=foo, 2=\v%{ (nested), 3=bar, 4=%}, 5=%}, 6=if true, 7=end.
      const source = '%{\nfoo\n\v%{\nbar\n%}\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // Verify the entire commented region (through the second %} on line 5) is excluded:
      // an excluded region whose end reaches line 5 means depth-2 nesting was applied.
      const regions = parser.getExcludedRegions(source);
      const blockCommentRegion = regions.find((r) => source[r.start] === '%' && source[r.start + 1] === '{');
      assert.ok(blockCommentRegion, 'block comment region must exist');
      // The block comment must extend at least to the position of the second `%}` (line 5).
      const secondClosePos = source.indexOf('%}', source.indexOf('%}') + 2);
      assert.ok(blockCommentRegion.end > secondClosePos, 'block comment must include the inner %} (depth-2 nesting)');
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

  suite('Regression: block_middle after a value token on the same logical line is not an intermediate', () => {
    test('should not treat otherwise as intermediate after a function call value (A(1) otherwise)', () => {
      // `A(1) otherwise` places `otherwise` in operand position after the value `A(1)` with
      // no operator between — invalid MATLAB. The fake `otherwise` must not register as an
      // intermediate; doing so also wrongly causes the real `case 1` below to be rejected
      // as a "case after otherwise". Only the genuine `case 1` is an intermediate.
      const source = 'switch x\n  A(1) otherwise\n  case 1\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not treat else as intermediate after a matrix value ([1] else)', () => {
      const source = 'if x\n  [1] else\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after a matrix value is not an intermediate');
    });

    test('should not treat else as intermediate after a cell value ({1} else)', () => {
      const source = 'if x\n  {1} else\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after a cell value is not an intermediate');
    });

    test('should not treat else as intermediate after a numeric decimal point (10. else)', () => {
      const source = 'if x\n  10. else\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after a numeric decimal point is not an intermediate');
    });

    test('should not treat else as intermediate after a string value ("ab" else)', () => {
      const source = 'if x\n  "ab" else\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after a string value is not an intermediate');
    });

    test('should not treat elseif as intermediate after a numeric value (42 elseif b)', () => {
      const source = 'if x\n  42 elseif b\n  y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'elseif after a numeric value is not an intermediate');
    });

    test('should not treat catch as intermediate after a numeric value (42 catch)', () => {
      const source = 'try\n  42 catch\n  x = 1;\ncatch\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should still treat else at statement start as an intermediate (sanity)', () => {
      const source = 'if x\n  y = 1;\nelse\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should still treat case and otherwise at statement start as intermediates (sanity)', () => {
      const source = 'switch x\n  case 1\n    y = 1;\n  otherwise\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'otherwise']);
    });

    test('should still treat else after ; on same line as an intermediate (one-liner)', () => {
      // `if x; y = 1; else y = 2; end` — `else` is after `;`, a new logical line, so it
      // must remain an intermediate even though it shares a physical line with `y = 1;`.
      const source = 'if x; y = 1; else y = 2; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
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

  suite('Regression 2026-05-23: command-syntax with embedded string literal continues past quoted argument', () => {
    test('should treat keyword after disp "..." as command-syntax argument', () => {
      // `disp "end" if x` is command-syntax: `disp` is the command, `"end"`, `if`, and
      // `x` are string arguments. The `if` keyword inside the run must NOT be tokenised
      // as a real block opener — otherwise it consumes an inner end and destroys outer
      // pairing.
      const source = 'function f\n  disp "end" if x\n  end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0, 'if after disp "end" must not be a block opener');
    });

    test("should treat keyword after disp '...' as command-syntax argument (single-quoted)", () => {
      // Same pattern with a single-quoted argument.
      const source = "function f\n  disp 'end' if x\n  end";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0);
    });

    test('should still detect real if-end block (no command-syntax) as sanity check', () => {
      // Sanity: a real if/end without leading command must still be detected.
      const source = 'function f\n  if x > 0\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-23: end preceded by value token on same logical line is not block close', () => {
    test('should not treat end after identifier as block close (x = a end)', () => {
      // `x = a end` places `end` in operand position after the identifier `a`. Invalid
      // MATLAB outside indexing, but treating it as a block close consumes the inner end.
      const source = 'function f\n  if true\n    x = a end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      assert.strictEqual(ifBlock.closeKeyword.line, 3, 'if should pair with the real inner end (line 3)');
    });

    test('should not treat end after closing bracket as block close (x = [1 2] end)', () => {
      const source = 'function f\n  if true\n    x = [1 2] end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat end after numeric decimal point as block close (x = 10. end)', () => {
      const source = 'function f\n  if true\n    x = 10. end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat end after function call as block close (x = foo() end)', () => {
      const source = 'function f\n  if true\n    x = foo() end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should not treat end after closing brace as block close (x = {1} end)', () => {
      const source = 'function f\n  if true\n    x = {1} end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should still treat real end on its own line as block close (sanity check)', () => {
      // A normal end on its own line must keep working.
      const source = 'function f\n  if true\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should still treat end after ; on same line as block close (one-liner if; body; end)', () => {
      // `if true; body; end` is a valid one-liner: the `end` is on the same physical line
      // but after `;` it's a new logical line, so it must still pair with `if`.
      const source = 'function f\n  if true; body; end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 2);
    });
  });

  suite('Regression 2026-05-23: binary operator + end with Unicode horizontal whitespace', () => {
    test('should not treat end after + NBSP (U+00A0) as block close', () => {
      // `1 +<NBSP>end` — `end` is in operand context (preceded by binary `+`), invalid
      // MATLAB outside indexing. Without the fix the NBSP is not recognised as whitespace
      // so the operator-skip loop stops at the NBSP and treats `end` as a real block close,
      // consuming the outer function's `end`.
      const source = 'function f\n  1 + end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });

    test('should not treat end after + VT (\\v) as block close', () => {
      const source = 'function f\n  1 +\vend\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end after + FF (\\f) as block close', () => {
      const source = 'function f\n  1 +\fend\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end after + U+2003 (em space) as block close', () => {
      const source = 'function f\n  1 + end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end preceded by * NBSP (U+00A0) as block close', () => {
      // Symmetric backward check: `2 *<NBSP>end` should reject end as block close.
      const source = 'function f\n  2 * end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat real end with no operator before as block close (sanity)', () => {
      const source = 'function f\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-23: end inside if/while/switch header expression is not block close', () => {
    test('should not treat end after if as block close (if end != 0)', () => {
      // `if end != 0` — `end` is part of the header expression, not a block close.
      // Without the fix the header `end` is wrongly matched as the if-block closer,
      // consuming the real inner `end` and destroying outer pairing.
      const source = 'function f\n  if end != 0\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      assert.strictEqual(ifBlock.closeKeyword.line, 3, 'if should pair with the inner end (line 3)');
    });

    test('should not treat end after if as block close (if end == 0)', () => {
      const source = 'function f\n  if end == 0\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should not treat end after if as block close (if end <= 5)', () => {
      const source = 'function f\n  if end <= 5\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should not treat end after while as block close (while end != 0)', () => {
      const source = 'function f\n  while end != 0\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const whileBlock = findBlock(pairs, 'while');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
      assert.strictEqual(whileBlock.closeKeyword.line, 3);
    });

    test('should not treat lone end after switch as block close (switch end)', () => {
      // `switch end` — the `end` is the switched-on value (often used for indexing in
      // array operations). It is not a block close. Without the fix `switch` wrongly
      // pairs with this header `end`, consuming the real inner end.
      const source = 'function f\n  switch end\n    case 1\n      body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const switchBlock = findBlock(pairs, 'switch');
      assert.strictEqual(funcBlock.closeKeyword.line, 5, 'function should pair with the outer end');
      assert.strictEqual(switchBlock.closeKeyword.line, 4, 'switch should pair with the inner end');
    });

    test('should still treat real if block close as block close (sanity check)', () => {
      // Sanity: a normal if/end block must still pair correctly.
      const source = 'function f\n  if x > 0\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-23: VT/FF/NBSP/Unicode horizontal whitespace as command-syntax separator', () => {
    test('should treat \\v (vertical tab) between disp and if as command-syntax separator', () => {
      // `disp\vif true` is command-syntax — `disp` is a command, `if` and `true` are
      // string arguments. The `if` must NOT be tokenised as a real block opener. Without
      // the fix the `if` consumes an inner `end`, destroying outer pairing.
      const source = 'function f\ndisp\vif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // The `if` keyword must NOT appear as a token (command-syntax string argument).
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0, 'if after disp<VT> must be a command-syntax argument, not a block opener');
    });

    test('should treat \\f (form feed) between disp and if as command-syntax separator', () => {
      const source = 'function f\ndisp\fif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0);
    });

    test('should treat NBSP (U+00A0) between disp and if as command-syntax separator', () => {
      const source = 'function f\ndisp if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0);
    });

    test('should treat U+2003 (em space) between disp and if as command-syntax separator', () => {
      const source = 'function f\ndisp if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0);
    });

    test('should treat U+3000 (ideographic space) between disp and if as command-syntax separator', () => {
      const source = 'function f\ndisp　if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.filter((t) => t.value === 'if').length, 0);
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

  suite('Regression: arguments with invalid attribute list should still register a phantom for the stray end', () => {
    test('should pair function with its end when arguments(Input,,Output) is rejected as a function call', () => {
      // `arguments(Input,,Output)` has an invalid attribute list (the double comma leaves
      // an empty entry). isMatlabArgumentsFunctionCall classifies it as a function call and
      // rejects it as a block opener. But the user clearly intended an arguments block (the
      // line starts with `arguments` followed by something that LOOKS like an attribute
      // list) and wrote a stray `end` for it. The parser must record a phantom for the
      // rejected `arguments` so matchBlocks can skip the stray `end` instead of pairing it
      // with the outer function. Lines: 0=function, 1=arguments(Input,,Output),
      // 2=x (1,1) double, 3=inner end, 4=outer end.
      const source = 'function foo(x)\n  arguments(Input,,Output)\n    x (1,1) double\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4, 'function must pair with the outer end on line 4');
    });
  });

  suite('Middle keyword followed by end on same line', () => {
    test('should pair if/end when else is followed by end on the same line', () => {
      const source = 'if x\nelse end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should pair switch/end when case is followed by end on the same line', () => {
      const source = 'switch x\ncase 1 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
    });

    test('should pair try/end when catch is followed by end on the same line', () => {
      const source = 'try\ncatch end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });
  });

  suite('Regression 2026-05-25: block opener followed by binary operator across ... line continuation', () => {
    test('should not treat for as block open when + follows across a ... line continuation', () => {
      // `for ...\n      + 1;` is `for + 1;` split across a ... line continuation — `for` is
      // used as an operand in a binary expression (invalid MATLAB), not a real block opener.
      // Without the fix, the followed-binary-operator check ran with the raw post-keyword
      // position, which still points at the space before `...`, so the check stopped at the
      // continuation dot and treated `for` as a real block opener. The opener then consumed
      // the inner `end`, destroying outer function/end pairing.
      const source = 'function f\n  for ...\n      + 1;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 5, 'function should pair with the outer end (line 5)');
      assert.strictEqual(ifBlock.closeKeyword.line, 4, 'if should pair with the inner end (line 4)');
      // `for` must NOT appear as a block opener in any pair.
      assert.strictEqual(
        pairs.filter((p) => p.openKeyword.value === 'for').length,
        0,
        'for in operand context across a ... line continuation must not be a block opener'
      );
    });

    test('should not treat while as block open when * follows across a ... line continuation', () => {
      // `while ...\n   * 2;` is `while * 2;` — `while` is the left operand of `*`, not a
      // real block opener. Same root cause: line-continuation-aware position must be used.
      const source = 'function f\n  while ...\n     * 2;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 5);
      assert.strictEqual(
        pairs.filter((p) => p.openKeyword.value === 'while').length,
        0,
        'while in operand context across a ... line continuation must not be a block opener'
      );
    });

    test('should not treat for as block open when compound assignment += follows across a ... line continuation', () => {
      // `for ...\n     += 1;` is `for += 1;` — `for` is a compound assignment target, not a
      // real block opener. The compound-assignment branch also needs the continuation-aware
      // position to fire.
      const source = 'function f\n  for ...\n     += 1;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(
        pairs.filter((p) => p.openKeyword.value === 'for').length,
        0,
        'for as compound-assignment target across a ... line continuation must not be a block opener'
      );
    });

    test('should still treat for as block open with normal header (sanity check)', () => {
      // A normal `for i = 1:3` header must still pair correctly.
      const source = 'function f\n  for i = 1:3\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-25: skipWhitespaceAndContinuations accepts Unicode horizontal whitespace', () => {
    test('should not treat if as block open when followed by NBSP (U+00A0) then = (variable assignment)', () => {
      // `if<NBSP>= 1` should be detected as the variable assignment `if = 1`. Without the
      // fix the NBSP was not recognised as whitespace, so the assignment-detection loop
      // stopped at the NBSP and missed the `=`, leaving `if` tokenised as a real block
      // opener. The opener then consumed the inner `end`, destroying outer pairing.
      const source = 'function f\n  if = 1\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      // `if = 1` must be rejected as a variable assignment (not a block opener).
      // Only the inner `if true ... end` and the outer `function ... end` should pair.
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      // Exactly one if-block expected (the inner one), confirming the `if<NBSP>= 1` was rejected.
      assert.strictEqual(pairs.filter((p) => p.openKeyword.value === 'if').length, 1);
    });

    test('should not treat for as block open when followed by VT (\\v) then = (variable assignment)', () => {
      // Same pattern with vertical tab.
      const source = 'function f\n  for\v= 10\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs.filter((p) => p.openKeyword.value === 'for').length, 0);
    });

    test('should not treat while as block open when followed by U+2003 (em space) then = (variable assignment)', () => {
      // Em space (U+2003) between `while` and `=`.
      const source = 'function f\n  while = 5\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs.filter((p) => p.openKeyword.value === 'while').length, 0);
    });

    test('should not treat for as block open when followed by NBSP then + (binary operator)', () => {
      // `for<NBSP>+ 1;` — same root cause: `for` is in operand context. The
      // followed-binary-operator branch needs Unicode whitespace recognition too.
      const source = 'function f\n  for + 1;\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs.filter((p) => p.openKeyword.value === 'for').length, 0);
    });

    test('should not treat end as block close when followed by VT then . (struct field access)', () => {
      // `end<VT>.field` is `end.field` separated by vertical tab — `end` is an identifier
      // used as the receiver of a struct field access, not a block close. Without the fix
      // the VT was not recognised as whitespace, so the dot-detection (in isValidBlockClose)
      // did not see the `.` and the `end` was wrongly tokenised as a block close, consuming
      // the outer function's end.
      const VT = String.fromCharCode(0x0b);
      const source = `function f\n  end${VT}.field\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // Outer end (0-indexed line 2) must be the one paired.
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end (line 2 in 0-indexed)');
    });

    test('should not treat end as block close when followed by NBSP then . (struct field access)', () => {
      // Same pattern with NBSP between `end` and `.field`.
      const NBSP = ' ';
      const source = `function f\n  end${NBSP}.field\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should still treat for as block open when followed by tab + assignment (sanity check)', () => {
      // Tab is ASCII horizontal whitespace and was already handled. Sanity-check that the
      // existing behaviour is preserved.
      const source = 'function f\n  for i\t= 1:3\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forBlock, 'normal for/end with tab-separated header must still pair');
    });
  });

  suite('Regression 2026-06-20: case/otherwise + end separated by Unicode horizontal whitespace', () => {
    test('should not treat end as block close when separated from case by NBSP (U+00A0)', () => {
      // `case<NBSP>end` is a case arm whose value is the identifier `end` — invalid MATLAB,
      // but treating that `end` as a block close consumes the outer switch's end. Without
      // the fix, the backward-scan loop in isPrecededByCaseOrOtherwiseOnLogicalLine only
      // recognised ASCII space/tab/CR/LF as whitespace, so the NBSP between `case` and
      // `end` stopped the scan and the function returned false, leaving `end` tokenised
      // as a real block close.
      const NBSP = ' ';
      const source = `switch x\n  case${NBSP}end\n    y = 1;\n  case 2\n    y = 2;\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5, 'switch should pair with the outer end on line 5');
    });

    test('should not treat end as block close when separated from case by em space (U+2003)', () => {
      // Same root cause with em space (U+2003). The Unicode horizontal whitespace set
      // covers em space, so the fix must accept it the same as NBSP.
      const source = 'switch x\n  case end\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });

    test('should not treat end as block close when separated from case by ideographic space (U+3000)', () => {
      // U+3000 (ideographic space) is full-width whitespace common in Japanese text.
      const source = 'switch x\n  case　end\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });

    test('should not treat end as block close when separated from case by vertical tab (\\v)', () => {
      // Vertical tab is ASCII but not in the original space/tab/CR/LF whitelist either.
      const VT = '\v';
      const source = `switch x\n  case${VT}end\n    y = 1;\n  case 2\n    y = 2;\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });

    test('should not treat end as block close when separated from otherwise by NBSP', () => {
      // `otherwise<NBSP>end` follows the same pattern — `otherwise` arm value is `end`,
      // an identifier; treating it as block close consumes the outer switch's end.
      const NBSP = ' ';
      const source = `switch x\n  case 1\n    y = 1;\n  otherwise${NBSP}end\n    y = 2;\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });

    test('should not treat end as block close when case is indented by NBSP only', () => {
      // The leading-whitespace branch of isPrecededByCaseOrOtherwiseOnLogicalLine also
      // needs Unicode whitespace recognition. `<NBSP>case end` puts `case` at logical-line
      // start with only NBSP before it; without the fix the leading-whitespace check
      // sees the NBSP as non-whitespace and returns false, so `end` is wrongly classified
      // as a block close.
      const NBSP = ' ';
      const source = `switch x\n${NBSP}case end\n    y = 1;\n  case 2\n    y = 2;\nend`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });

    test('should still treat case end with ASCII space as case-arm value (sanity check)', () => {
      // ASCII space between `case` and `end` already worked. Sanity-check that the
      // existing behaviour is preserved.
      const source = 'switch x\n  case end\n    y = 1;\n  case 2\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 5);
    });
  });

  suite('Regression: case/otherwise with empty header is not intermediate', () => {
    test('should not register case as intermediate when header is empty (case<NL>)', () => {
      // `case` requires a value expression. An empty header (`case\n  y = 1`) is invalid
      // MATLAB. Treating `case` here as an intermediate corrupts the switch arm structure.
      const source = 'switch x\n  case\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case with empty header must not be registered as an intermediate');
    });

    test('should not register case as intermediate when followed by ; (case;)', () => {
      const source = 'switch x\n  case;\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case; must not be registered as an intermediate');
    });

    test('should not register case as intermediate when followed by , (case,)', () => {
      const source = 'switch x\n  case,\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case, must not be registered as an intermediate');
    });

    test('should not register case as intermediate when followed by % comment only (case % comment)', () => {
      // `case % comment\n  y = 1` has no value expression — the line ends at the comment,
      // so the header is effectively empty.
      const source = 'switch x\n  case % comment\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case followed by comment only must not be registered as an intermediate');
    });

    test('should still register case as intermediate when followed by a value (sanity)', () => {
      // `case 1` is valid MATLAB. It must remain recognised as an intermediate.
      const source = 'switch x\n  case 1\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'case 1 must remain a valid intermediate');
    });

    test('should not register otherwise as intermediate when header is empty (otherwise<NL>)', () => {
      // Wait — `otherwise` typically takes NO header (just falls through to the body).
      // Let's verify what existing behaviour is. Actually `otherwise` followed by NL is
      // valid; only `case` REQUIRES a value. Skip otherwise from the rejection.
      // Sanity check that `otherwise` alone on a line still works.
      const source = 'switch x\n  case 1\n    y = 1;\n  otherwise\n    y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 2, 'case and otherwise must both remain intermediates');
    });
  });

  suite('Regression: block_middle keyword followed by strictly-binary operator is not intermediate', () => {
    test('should not register case as intermediate when followed by * operator', () => {
      // `case * 5` is invalid MATLAB: `case` requires a value expression, and `*` cannot start
      // an expression (only unary `+`/`-`/`~`/`!` may, and `*` is not in that set). Treating
      // `case` here as an intermediate corrupts the switch arm structure.
      const source = 'switch x\n  case * 5\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case * 5 must not be registered as an intermediate');
    });

    test('should not register case as intermediate when followed by / operator', () => {
      const source = 'switch x\n  case / 5\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case / 5 must not be registered as an intermediate');
    });

    test('should not register case as intermediate when followed by < operator', () => {
      const source = 'switch x\n  case < 5\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'case < 5 must not be registered as an intermediate');
    });

    test('should still register case as intermediate when followed by unary + (sanity)', () => {
      // `case +1` is valid MATLAB (`+` is unary on a numeric literal). It must remain
      // recognised as an intermediate.
      const source = 'switch x\n  case +1\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'case +1 must remain a valid intermediate');
      assert.strictEqual(pairs[0].intermediates[0].value, 'case');
    });

    test('should still register case as intermediate when followed by unary - (sanity)', () => {
      const source = 'switch x\n  case -5\n    y = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'case -5 must remain a valid intermediate');
    });
  });

  suite('Regression: arguments(...) attribute list spans ... line continuation', () => {
    test('should treat arguments(Input ...\\n) as block opener when attribute spans line continuation', () => {
      // The attribute parenthesised list `(Input ...\n)` legitimately spans a `...` line
      // continuation. The previous implementation didn't strip the continuation region
      // before checking the attribute pattern, so `Input ...` failed the
      // ARGUMENTS_ATTRIBUTES_PATTERN regex and the line was classified as a function call.
      // The real `arguments` block then went unrecognised and the inner `end` was wrongly
      // paired with the outer `function`.
      const source = 'function f(x)\n  arguments(Input ...\n  )\n    x double\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const func = pairs.find((p) => p.openKeyword.value === 'function');
      const args = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(func, 'function must pair with its end');
      assert.ok(args, 'arguments must pair with its end');
    });

    test('should treat arguments(...\\n Input) as block opener with attribute on the next line', () => {
      // Symmetric form: continuation BEFORE the attribute keyword. Both forms must be
      // recognised as valid attribute lists.
      const source = 'function f(x)\n  arguments( ...\n    Input)\n    x double\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const func = pairs.find((p) => p.openKeyword.value === 'function');
      const args = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(func, 'function must pair with its end');
      assert.ok(args, 'arguments must pair with its end');
    });

    test('should still treat arguments(obj) as function call across line continuation (sanity)', () => {
      // `arguments(obj ...\n)` is STILL a function call because `obj` is not a recognised
      // attribute keyword (Input/Output/Repeating). The continuation must not be stripped
      // in a way that causes false acceptance.
      const source = 'function showArgs(obj)\n  arguments(obj ...\n  )\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: section keyword used as function call inside non-classdef-direct scope', () => {
    test('should not treat properties(obj) inside classdef methods as section block', () => {
      // Inside `classdef A / methods / ...`, a `properties()` call (line-start function call
      // shape) must NOT be paired as a section block. The closest enclosing block is `methods`,
      // not `classdef`, so `properties` at this depth is a function call. Treating it as a
      // section opener consumes the inner `end` and leaves classdef orphan.
      const source = 'classdef A\n  methods\n    properties()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classdef = pairs.find((p) => p.openKeyword.value === 'classdef');
      const methods = pairs.find((p) => p.openKeyword.value === 'methods');
      assert.ok(classdef, 'classdef must pair with its end');
      assert.ok(methods, 'methods must pair with its end');
    });

    test('should not treat properties(obj) inside function inside methods as section block', () => {
      // Realistic scenario: `classdef / methods / function f(obj) / properties(obj) / end / end / end`.
      // The `properties(obj)` is a reflection helper call inside `function`, NOT a section
      // block. The closest enclosing block is `function`, so it must be treated as a call.
      const source = 'classdef A\n  methods\n    function f(obj)\n      properties(obj)\n    end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const classdef = pairs.find((p) => p.openKeyword.value === 'classdef');
      const methods = pairs.find((p) => p.openKeyword.value === 'methods');
      const func = pairs.find((p) => p.openKeyword.value === 'function');
      assert.ok(classdef, 'classdef must pair with its end');
      assert.ok(methods, 'methods must pair with its end');
      assert.ok(func, 'function must pair with its end');
    });

    test('should not treat methods(obj) inside another methods section as section block', () => {
      // Closest enclosing block is `methods`, so the inner `methods(obj)` call must be
      // a function call, not a section opener.
      const source = 'classdef A\n  methods\n    methods(obj)\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classdef = pairs.find((p) => p.openKeyword.value === 'classdef');
      const methodsBlocks = pairs.filter((p) => p.openKeyword.value === 'methods');
      assert.ok(classdef, 'classdef must pair with its end');
      assert.strictEqual(methodsBlocks.length, 1, 'only the outer methods must be a section block');
    });

    test('should still treat properties(...) directly inside classdef as section block (sanity check)', () => {
      // When `properties` is directly inside `classdef` (closest enclosing block is classdef),
      // it remains a valid section opener (with or without an attribute parenthesised list).
      const source = 'classdef A\n  properties (Access = public)\n    x = 5;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classdef = pairs.find((p) => p.openKeyword.value === 'classdef');
      const props = pairs.find((p) => p.openKeyword.value === 'properties');
      assert.ok(classdef, 'classdef must pair with its end');
      assert.ok(props, 'properties must pair with its end as a section block');
    });
  });

  suite('Regression 2026-05-26: end preceded by closing string quote on same logical line is not block close', () => {
    test('should not treat end after closing double-quoted string as block close (x = "abc" end)', () => {
      // `x = "abc" end` places `end` in operand position after the closing double quote.
      // Invalid MATLAB outside indexing, but treating it as a block close consumes the
      // inner if's end, leaving the outer function unmatched.
      const source = 'function f\n  if true\n    x = "abc" end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      assert.strictEqual(ifBlock.closeKeyword.line, 3, 'if should pair with the real inner end (line 3)');
    });

    test("should not treat end after closing single-quoted string as block close (x = 'abc' end)", () => {
      // `x = 'abc' end` places `end` in operand position after the closing single quote of a
      // MATLAB character vector literal. Same root cause as the double-quoted case.
      const source = "function f\n  if true\n    x = 'abc' end\n  end\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
      assert.strictEqual(ifBlock.closeKeyword.line, 3);
    });

    test('should still treat end on its own line after a string assignment as block close (sanity)', () => {
      // Sanity: a normal end on its own physical line after a string assignment must keep working.
      const source = 'function f\n  if true\n    x = "abc";\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-26: end preceded by transpose operator on same logical line is not block close', () => {
    test("should not treat end after transpose operator as block close (x = A' end)", () => {
      // `x = A' end` places `end` in operand position after the transpose operator `'`
      // (which produces a value). Same root cause as the closing-quote case but the quote
      // here is the transpose operator, not a string terminator. Without the fix the inner
      // end is consumed, leaving the outer function unmatched.
      const source = "function f\n  if true\n    x = A' end\n  end\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end');
      assert.strictEqual(ifBlock.closeKeyword.line, 3, 'if should pair with the real inner end (line 3)');
    });

    test("should not treat end after transpose of array indexing as block close (x = A(1)' end)", () => {
      const source = "function f\n  if true\n    x = A(1)' end\n  end\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });
  });

  suite('Regression 2026-05-26: empty-header block opener should not pair its end with an outer block', () => {
    test('should not pair if; with outer function end (if; rejected, inner end stays orphan)', () => {
      // `if;` is rejected as a block opener (empty header). Without the phantom-skip wiring
      // the inner `end` (intended to close the rejected `if`) is wrongly paired with the
      // outer `function`, leaving the real outer `end` orphan.
      // function should pair with the outer end on line 3 (0-indexed).
      const source = 'function f\n  if;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function must pair with the outer end on line 3 (0-indexed)');
    });

    test('should not pair for; with outer function end', () => {
      const source = 'function f\n  for;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not pair while, with outer function end', () => {
      const source = 'function f\n  while,\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not pair switch; with outer function end', () => {
      const source = 'function f\n  switch;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });
  });

  suite('Regression 2026-05-26: end followed by colon range outside for-header is not block close', () => {
    test('should not treat end:1 as block close (end:1 outside for-header)', () => {
      // `end:1` is a colon range expression where the `end` is the array-index `end`
      // (typically inside indexing), not a block close. Outside a for-header `end` is in
      // operand context (it forms the LHS of a colon range). Without the fix the `end`
      // is misclassified as block close, consuming the inner if's end and orphaning the
      // outer function. Line 3 (0-indexed) = outer end of function.
      const source = 'function f\n  if true\n    end:1\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(funcBlock.closeKeyword.line, 4, 'function should pair with the outer end on line 4');
      assert.strictEqual(ifBlock.closeKeyword.line, 3, 'if should pair with the real inner end on line 3');
    });

    test('should not treat end:n (with n variable) as block close outside for-header', () => {
      const source = 'function f\n  if true\n    end:n\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(funcBlock.closeKeyword.line, 4);
    });

    test('should still treat for i = end:5 as a valid for-header (sanity check)', () => {
      // The for-header LHS-range form `for i = end:5` is the legitimate use of `end:N`
      // and must remain unaffected. Lines: 0=function, 1=A=1:10, 2=for, 3=disp, 4=inner end, 5=outer end.
      const source = 'function f\n  A = 1:10;\n  for i = end:5\n    disp(i);\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      const funcBlock = findBlock(pairs, 'function');
      assert.strictEqual(forBlock.closeKeyword.line, 4);
      assert.strictEqual(funcBlock.closeKeyword.line, 5);
    });
  });

  suite('Regression 2026-05-26: bare section keyword outside classdef should not pair its end with an outer block', () => {
    test('should not pair stray properties...end with outer function end', () => {
      // Bare `properties` outside a classdef cannot be a valid section block but the user
      // wrote a stray `end` for it. Without the phantom-skip wiring the inner `end` is
      // wrongly paired with the outer `function`, leaving the real outer `end` orphan.
      // Lines: 0=function, 1=properties, 2=x=1, 3=inner end, 4=outer end.
      const source = 'function f\n  properties\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4, 'function must pair with the outer end on line 4');
    });

    test('should not pair stray methods...end with outer function end', () => {
      const source = 'function f\n  methods\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });

    test('should not pair stray events...end with outer function end', () => {
      const source = 'function f\n  events\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });

    test('should not pair stray enumeration...end with outer function end', () => {
      const source = 'function f\n  enumeration\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });

    test('should still treat properties() inside classdef methods as function call (sanity check, no regression)', () => {
      // The function-call shape `properties()` at line start inside `methods` must remain
      // a function call (no pendingSkipDepth pushed). Without the per-position check on
      // sectionKeywordsWithParen the matchBlocks change would consume the inner `end` and
      // orphan the classdef.
      const source = 'classdef A\n  methods\n    properties()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classdef = pairs.find((p) => p.openKeyword.value === 'classdef');
      const methods = pairs.find((p) => p.openKeyword.value === 'methods');
      assert.ok(classdef, 'classdef must pair with its end');
      assert.ok(methods, 'methods must pair with its end');
    });
  });

  suite('Regression 2026-05-26: bare arguments outside function should not pair its end with an outer block', () => {
    test('should not pair stray arguments...end with outer if end', () => {
      // Bare `arguments` outside any function/methods/classdef cannot be a real arguments
      // block, but the user wrote a stray `end` for it. Without the phantom-skip wiring
      // the inner `end` is wrongly paired with the outer `if`, leaving the real outer `end`
      // orphan. Lines: 0=if, 1=arguments, 2=y=1, 3=inner end, 4=outer end.
      const source = 'if x > 0\n  arguments\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4, 'if must pair with the outer end on line 4');
    });

    test('should not pair stray arguments...end with outer while end', () => {
      const source = 'while x > 0\n  arguments\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 4);
    });

    test('should still pair arguments inside function as a real block (sanity check)', () => {
      // Inside a function body the arguments block remains a valid opener: it must pair
      // with its own `end` and not be dropped.
      const source = 'function f(x)\n  arguments\n    x (1,1) double\n  end\n  disp(x);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const args = pairs.find((p) => p.openKeyword.value === 'arguments');
      const func = pairs.find((p) => p.openKeyword.value === 'function');
      assert.ok(args, 'arguments must pair as a real block inside a function');
      assert.ok(func, 'function must still pair with its end');
    });

    test('should not pair stray arguments(Input)...end with outer if end', () => {
      // `arguments(Input)` is a valid ATTRIBUTE form of `arguments`. Outside any
      // function/methods/classdef context it still cannot be a real arguments block,
      // but the user likely wrote a stray `end` for it. The drop path must push
      // pendingSkipDepth (like bare arguments) so the inner `end` is skipped and the
      // real outer `if`/`end` pair remains intact. Lines: 0=if, 1=arguments(Input),
      // 2=inner end, 3=outer end.
      const source = 'if true\n  arguments(Input)\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'if must pair with the outer end on line 3');
    });

    test('should not pair stray arguments(Output)...end with outer if end', () => {
      // Same pattern with the `Output` attribute keyword.
      const source = 'if true\n  arguments(Output)\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });
  });

  suite('Regression 2026-05-29: pendingSkipDepths must check remainingCloses before consuming end', () => {
    test('should pair classdef-methods-function with all three ends when nested methods is dropped', () => {
      // Lines: 0=classdef, 1=methods (real), 2=methods (nested, dropped), 3=function,
      // 4=function-end, 5=nested-methods-end (extra/stray), 6=classdef-end.
      // Without the remainingCloses guard, the nested `methods` at line 2 pushes
      // pendingSkipDepth and the function-end on line 4 is consumed by the skip,
      // leaving classdef orphan (only 2 pairs instead of 3).
      const source = 'classdef A\nmethods\n  methods\n    function f()\n    end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const classdef = findBlock(pairs, 'classdef');
      const methods = findBlock(pairs, 'methods');
      const func = findBlock(pairs, 'function');
      assert.strictEqual(func.closeKeyword.line, 4, 'function must pair with end on line 4');
      assert.strictEqual(methods.closeKeyword.line, 5, 'methods must pair with end on line 5');
      assert.strictEqual(classdef.closeKeyword.line, 6, 'classdef must pair with end on line 6');
    });
  });

  suite('Regression 2026-05-29: function as identifier inside function header', () => {
    test('should pair outer function with outer end and treat inner function-named-function as invalid', () => {
      // `function function()` uses the reserved word `function` as the function NAME.
      // MATLAB rejects this at parse time, but to keep outer-block pairing intact the
      // second `function` keyword must NOT be treated as a real block opener. The
      // expected best-effort pairing is:
      //   outer function (line 0) <-> outer end (line 3)
      //   inner function (line 1, col 2) <-> inner end (line 2)
      // Without this rejection the inner function header consumes two `end`s in a row,
      // leaving the outer function orphan.
      const source = 'function outer()\n  function function()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outer = pairs.find((p) => p.openKeyword.line === 0);
      const inner = pairs.find((p) => p.openKeyword.line === 1 && p.openKeyword.column === 2);
      assert.ok(outer, 'outer function on line 0 must pair with its end');
      assert.ok(inner, 'inner function on line 1 col 2 must pair with its end');
      assert.strictEqual(outer.closeKeyword.line, 3, 'outer function must pair with the end on line 3');
      assert.strictEqual(inner.closeKeyword.line, 2, 'inner function must pair with the end on line 2');
    });
  });

  suite('Regression: any reserved word as identifier inside function header', () => {
    test('should pair outer function with outer end when classdef is used as the inner function name', () => {
      // `function classdef()` uses the reserved word `classdef` as the function NAME.
      // MATLAB rejects this at parse time, but the inner `classdef` must NOT be treated
      // as a real block opener (a classdef block opener). Otherwise both `end`s pair
      // with `classdef`/`function` (inner) and the outer function loses its `end`.
      // Expected best-effort pairing:
      //   outer function (line 0) <-> outer end (line 3)
      //   inner function (line 1, col 2) <-> inner end (line 2)
      const source = 'function outer()\n  function classdef()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outer = pairs.find((p) => p.openKeyword.line === 0);
      const inner = pairs.find((p) => p.openKeyword.value === 'function' && p.openKeyword.line === 1 && p.openKeyword.column === 2);
      assert.ok(outer, 'outer function on line 0 must pair with its end');
      assert.ok(inner, 'inner function on line 1 col 2 must pair with its end');
      assert.strictEqual(outer.closeKeyword.line, 3, 'outer function must pair with the end on line 3');
      assert.strictEqual(inner.closeKeyword.line, 2, 'inner function must pair with the end on line 2');
    });

    test('should pair outer function with outer end when if is used as the inner function name', () => {
      // Same pattern with `if` as the function name.
      const source = 'function outer()\n  function if()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outer = pairs.find((p) => p.openKeyword.value === 'function' && p.openKeyword.line === 0);
      assert.ok(outer, 'outer function on line 0 must pair with its end');
      assert.strictEqual(outer.closeKeyword.line, 3, 'outer function must pair with the end on line 3');
    });

    test('should pair outer function with outer end when for is used as the inner function name', () => {
      // Same pattern with `for` as the function name.
      const source = 'function outer()\n  function for()\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outer = pairs.find((p) => p.openKeyword.value === 'function' && p.openKeyword.line === 0);
      assert.ok(outer, 'outer function on line 0 must pair with its end');
      assert.strictEqual(outer.closeKeyword.line, 3, 'outer function must pair with the end on line 3');
    });
  });

  generateCommonTests(config);
});
