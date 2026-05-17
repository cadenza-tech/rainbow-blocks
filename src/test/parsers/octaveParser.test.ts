import * as assert from 'node:assert';
import { OctaveBlockParser } from '../../parsers/octaveParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

suite('OctaveBlockParser Test Suite', () => {
  let parser: OctaveBlockParser;

  setup(() => {
    parser = new OctaveBlockParser();
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

    test('should parse function-endfunction block (Octave-specific)', () => {
      const source = `function result = myFunc(x)
  result = x * 2;
endfunction`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    test('should parse if-end block', () => {
      const source = `if condition
  action();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse if-endif block (Octave-specific)', () => {
      const source = `if condition
  action();
endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should parse for-end block', () => {
      const source = `for i = 1:10
  disp(i);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should parse for-endfor block (Octave-specific)', () => {
      const source = `for i = 1:10
  disp(i);
endfor`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'endfor');
    });

    test('should parse while-end block', () => {
      const source = `while x > 0
  x = x - 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should parse while-endwhile block (Octave-specific)', () => {
      const source = `while x > 0
  x = x - 1;
endwhile`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'endwhile');
    });

    test('should parse switch-end block', () => {
      const source = `switch value
  case 1
    disp('one');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
    });

    test('should parse switch-endswitch block (Octave-specific)', () => {
      const source = `switch value
  case 1
    disp('one');
endswitch`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'endswitch');
    });

    test('should parse try-end block', () => {
      const source = `try
  riskyOperation();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should parse try-end_try_catch block (Octave-specific)', () => {
      const source = `try
  riskyOperation();
end_try_catch`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end_try_catch');
    });

    test('should parse unwind_protect block (Octave-specific)', () => {
      const source = `unwind_protect
  riskyOperation();
unwind_protect_cleanup
  cleanup();
end_unwind_protect`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unwind_protect', 'end_unwind_protect');
      assertIntermediates(pairs[0], ['unwind_protect_cleanup']);
    });

    test('should parse parfor-end block', () => {
      const source = `parfor i = 1:10
  compute(i);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'parfor', 'end');
    });

    test('should parse classdef-end block', () => {
      const source = `classdef MyClass
  properties
    Value
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
  otherwise
    disp('other');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'otherwise']);
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

    test('should parse nested blocks with Octave-specific end keywords', () => {
      const source = `function result = outer()
  for i = 1:10
    if i > 5
      disp(i);
    endif
  endfor
endfunction`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'for', 1);
      assertNestLevel(pairs, 'function', 0);
    });

    test('should parse mixed end and Octave-specific end keywords', () => {
      const source = `function result = outer()
  for i = 1:10
    if i > 5
      disp(i);
    end
  endfor
endfunction`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Excluded regions - MATLAB-style comments', () => {
    generateExcludedRegionTests(config);

    test('should ignore keywords in %{ %} block comments', () => {
      const source = `%{
if condition
  function test()
  end
end
%}
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Octave-style comments', () => {
    test('should ignore keywords in #-style single-line comments', () => {
      const source = `# if for while end function
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore keywords in #{ #} block comments', () => {
      const source = `#{
if condition
  function test()
  end
end
#}
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle # comment at end of line', () => {
      const source = `if true # this is a comment with end in it
  action();
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should handle escaped quotes in single-quoted strings', () => {
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

    test('should handle backslash escapes in double-quoted strings', () => {
      const source = `msg = "line1\\nif\\nend";
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

    test('should not treat ! in middle of line as shell escape', () => {
      const source = 'x = 1 ! comment\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should handle complex Octave code with mixed comment styles', () => {
      const source = `function result = process(data)
  # Process the input data
  result = zeros(size(data));

  for i = 1:length(data)
    if data(i) > 0
      result(i) = sqrt(data(i));  % positive branch
    else
      result(i) = 0;  # zero or negative
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle unterminated #{ block comment', () => {
      const source = `#{
if inside comment
function inside()
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle #{ not at line start as single-line comment', () => {
      const source = `x = 1; #{ this is not a block comment #}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated single-quoted string', () => {
      const source = `msg = 'unterminated
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated double-quoted string', () => {
      const source = `msg = "unterminated
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle unterminated string at end of file', () => {
      // Tests matchOctaveString returning end of source (lines 229-231)
      const source = `x = "unterminated`;
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

    test('should handle unterminated %{ block comment', () => {
      // Tests lines 173-175 in matchMatlabBlockComment
      const source = `%{
if inside comment
function inside()
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle #{ block comment with content after #}', () => {
      // #} with trailing content does not close the block comment per Octave spec
      const source = `#{
comment
#} ignored content
if true
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unmatched Octave-specific end keyword', () => {
      // Tests findLastOpenerByType returning -1 (lines 96-97)
      const source = `endfunction
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle end inside parens within a string context', () => {
      const source = `for i = 1:10
  x = foo('end');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not apply doubled quote escape in double-quoted strings', () => {
      // "a""b" should be string "a" + string "b", not "a\"b"
      const pairs = parser.parse('"a""b"; if true; end');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still apply doubled quote escape in single-quoted strings', () => {
      // 'a''b' should be a single string containing a'b
      const pairs = parser.parse("'a''b'; if true; end");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Typed end keyword', () => {
    test('should not close wrong block with typed end keyword', () => {
      const source = `if true
endfor`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Line continuation', () => {
    test('should ignore keywords in line continuation', () => {
      const source = `function f ... if
endfunction`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
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

    test('should treat #{ with trailing text as single-line comment', () => {
      const source = `#{ not a block comment
if true
endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
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
    test('getExcludedRegions should return excluded regions for # comment', () => {
      const source = `# comment
"string"`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });

    test('getExcludedRegions should return #{ block comment', () => {
      const source = `#{
block comment
#}`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
    });
  });

  suite('Octave-specific close keywords for OOP', () => {
    test('should parse classdef-endclassdef block', () => {
      const source = `classdef MyClass
  properties
    x
  endproperties
endclassdef`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'classdef');
      findBlock(pairs, 'properties');
    });

    test('should parse methods-endmethods block', () => {
      const source = `methods
  function foo(obj)
  end
endmethods`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'methods');
    });

    test('should parse events-endevents block', () => {
      const source = `events
  StateChanged
endevents`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'events', 'endevents');
    });

    test('should parse enumeration-endenumeration block', () => {
      const source = `enumeration
  Red
  Green
endenumeration`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'enumeration', 'endenumeration');
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

    test('should handle #{ with leading whitespace', () => {
      const source = `  #{
  if inside comment
  #}
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

  suite('do-until blocks', () => {
    test('should match do-until loop', () => {
      const pairs = parser.parse('do\n  i++;\nuntil (i == 10)');
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should match nested do-until', () => {
      const pairs = parser.parse('do\n  do\n    x++;\n  until (x > 5)\nuntil (i == 10)');
      assertBlockCount(pairs, 2);
    });

    test('should not let generic end close do block', () => {
      // do should only be closed by until, not by generic end
      // When do is on top of stack, generic end cannot skip past it
      const pairs = parser.parse('for i = 1:10\n  do\n    x = 1\n  end\nend');
      // Both for and do remain unmatched since do blocks the stack
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do should not be paired with generic end');
      const forPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.strictEqual(forPair, undefined, 'for should not be paired because do blocks the stack');
    });

    test('should correctly pair do-until inside for-end', () => {
      const pairs = parser.parse('for i = 1:10\n  do\n    x = 1\n  until condition\nend');
      assertBlockCount(pairs, 2);
      const doPair = findBlock(pairs, 'do');
      assert.strictEqual(doPair.closeKeyword.value, 'until');
      const forPair = findBlock(pairs, 'for');
      assert.strictEqual(forPair.closeKeyword.value, 'end');
    });

    test('should not let end close outer block past unclosed do', () => {
      const source = 'if true\n  do\n  end\nuntil x';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should still close do-until inside function-end normally', () => {
      const source = 'function foo()\n  do\n  until x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'function', 0);
    });
  });

  suite('CRLF block comments', () => {
    test('should handle block comment with CRLF line endings', () => {
      const pairs = parser.parse('%{\r\nif inside\r\nend\r\n%}\r\nif true\r\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Nested block comment trailing content', () => {
    test('should not increment depth for %{ with trailing content inside block comment', () => {
      const pairs = parser.parse('%{\n  text about %{ braces }\n%}\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not increment depth for #{ with trailing content inside block comment', () => {
      const pairs = parser.parse('#{\n  text about #{ patterns }\n#}\nfor i = 1:10\nend');
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Nested block comments', () => {
    test('should handle nested MATLAB-style block comments', () => {
      const source = `%{
  %{
    inner comment
  %}
  if true
  end
%}
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle nested Octave-style block comments', () => {
      const source = `#{
  #{
    inner comment
  #}
  if true
  end
#}
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle string with CR-only ending', () => {
      const source = "x = 'unterminated\rif true\r  action;\rend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle MATLAB-style block comment with CR-only', () => {
      const source = '%{\rcomment\r%}\rfor i = 1:10\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle Octave-style block comment with CR-only', () => {
      const source = '#{\rcomment\r#}\rif true\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should recognize block comment start with CR-only ending', () => {
      const source = '#{\rcomment\r#}\rwhile true\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 10: double-quoted string backslash escape with CRLF', () => {
      const source = '"line1\\\r\nline2"; if true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test("Bug 15: double transpose A'' should not create false string", () => {
      const source = `function f
  x = A''; if true, end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 16: Octave-specific close keywords should check parenthesis context', () => {
      const source = `function f
  x = A(endfunction);
endfunction`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    test('should not treat if followed by assignment as block open', () => {
      // In Octave, keywords can be used as variable names when followed by assignment
      const pairs = parser.parse('if = 5;\nfor i = 1:10\n  disp(i);\nend');
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should treat single quote after Unicode variable as transpose', () => {
      // Unicode letters before ' should be recognized as identifier chars (transpose, not string)
      const pairs = parser.parse("\u03B8'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: unwind_protect_cleanup mismatched opener', () => {
    test('should reject unwind_protect_cleanup when stack top is NOT unwind_protect', () => {
      // Line 86: if (topOpener !== 'unwind_protect') break
      const source = `if true
  unwind_protect_cleanup
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'unwind_protect_cleanup should not be attached to if block');
    });

    test('should reject unwind_protect_cleanup in function block', () => {
      const source = `function foo()
  unwind_protect_cleanup
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should accept unwind_protect_cleanup in unwind_protect block', () => {
      const source = `unwind_protect
  risky();
unwind_protect_cleanup
  cleanup();
end_unwind_protect`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unwind_protect', 'end_unwind_protect');
      assertIntermediates(pairs[0], ['unwind_protect_cleanup']);
    });
  });

  suite('Coverage: %} with trailing whitespace before newline', () => {
    test('should close %{ block comment when %} has trailing spaces before newline', () => {
      // Lines 242-244: lineEnd scan after %} closer with trailing whitespace
      const source = '%{\ncomment\n%}   \nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should close %{ block comment when %} has trailing tab before newline', () => {
      const source = '%{\ncomment\n%}\t\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should close %{ block comment when %} has trailing spaces at EOF', () => {
      // Lines 242-244: lineEnd scan to EOF after trailing whitespace
      const source = '%{\ncomment\n%}   ';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: #} with trailing whitespace before newline', () => {
    test('should close #{ block comment when #} has trailing spaces before newline', () => {
      // Lines 287-289: lineEnd scan after #} closer with trailing whitespace
      const source = '#{\ncomment\n#}   \nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should close #{ block comment when #} has trailing tab before newline', () => {
      const source = '#{\ncomment\n#}\t\nfor i = 1:5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should close #{ block comment when #} has trailing spaces at EOF', () => {
      // Lines 287-289: lineEnd scan to EOF after trailing whitespace
      const source = '#{\ncomment\n#}   ';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Intermediate keyword validation', () => {
    test('should reject catch in if block', () => {
      const source = `if condition
  catch
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject case in if block', () => {
      const source = `if condition
  case 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should reject elseif in switch block', () => {
      const source = `switch x
  elseif condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should accept catch in try block', () => {
      const source = `try
  x = 1;
catch e
  x = 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should accept else in if block', () => {
      const source = `if condition
  x = 1;
else
  x = 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should accept case in switch block', () => {
      const source = `switch x
  case 1
    y = 1;
  otherwise
    y = 0;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case', 'otherwise']);
    });
  });

  suite('do as variable name', () => {
    test('should not treat do = 1 as block open', () => {
      const source = `do = 1;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat do = expr as block open', () => {
      const source = `do = getValue();
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat do  =  1 (with spaces) as block open', () => {
      const source = `do  =  1;
while true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should still treat do as block open when followed by newline', () => {
      const source = `do
  x++;
until (x > 10)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should still treat do as block open when followed by semicolon', () => {
      const source = `do;
  x++;
until (x > 10)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should not treat do == 1 as assignment (comparison is valid)', () => {
      // do == 1 is a comparison, not an assignment, so do should still be block open
      const source = `do
  x = do == 1;
until (x > 10)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should not treat do += 1 as block open (compound assignment)', () => {
      const source = `do += 1;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat do -= 1 as block open (compound assignment)', () => {
      const source = `do -= 1;
while true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not treat do *= 2 as block open (compound assignment)', () => {
      const source = `do *= 2;
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat do .+= 1 as block open (element-wise compound assignment)', () => {
      const source = `do .+= 1;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat do followed by form feed and = as block open', () => {
      // A form feed (\f) is horizontal whitespace, so `do\f= 1;` is an assignment to
      // a variable named `do` (invalid since `do` is reserved). Like `do = 1;`, `do`
      // must not open a do/until block — `do` and `until` are both orphans.
      const source = 'do\f= 1;\nuntil y';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do followed by \\f and = should not open a do/until block');
      assert.strictEqual(pairs.length, 0, 'do and until are both orphans');
    });

    test('should not treat do followed by vertical tab and compound assignment as block open', () => {
      // A vertical tab (\v) is horizontal whitespace, so `do\v+= 1;` is a compound
      // assignment to a variable named `do`. `do` must not open a do/until block.
      const source = 'do\v+= 1;\nuntil y';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do followed by \\v and += should not open a do/until block');
      assert.strictEqual(pairs.length, 0, 'do and until are both orphans');
    });
  });

  suite('end as variable name', () => {
    test('should not treat end = 5 as block close', () => {
      const source = `end = 5;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat endif as block close when followed by assignment', () => {
      const source = 'endif = 5;\nif true\n  x = 1;\nendif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should not treat end += 1 as block close (compound assignment)', () => {
      const source = `end += 1;
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still treat end == 5 as block close (comparison, not assignment)', () => {
      const source = `if true
  x = end == 5;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat end .+= 1 as block close (element-wise compound assignment, line 110)', () => {
      // isFollowedByAssignment: .+= is element-wise compound assignment -> not a block close
      const source = `end .+= 1;
for i = 1:10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat end .-= 1 as block close (element-wise subtraction assignment)', () => {
      const source = `end .-= 1;
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat end .*= 2 as block close (element-wise multiplication assignment)', () => {
      // Covers line 108: source[i + 1] === '*' branch in element-wise compound assignment
      const source = 'end .*= 2;\nfor i = 1:10\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not treat end ./= 2 as block close (element-wise division assignment)', () => {
      // Covers line 108: source[i + 1] === '/' branch in element-wise compound assignment
      const source = 'end ./= 2;\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not treat end .^= 2 as block close (element-wise power assignment)', () => {
      // Covers line 108: source[i + 1] === '^' branch in element-wise compound assignment
      const source = 'end .^= 2;\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: cross-type block comment delimiters', () => {
    test('should close %{ with #}', () => {
      const source = '%{\n  comment\n#}\nif true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should close #{ with %}', () => {
      const source = '#{\n  comment\n%}\nif true\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested cross-type block comments', () => {
      const source = '%{\n  #{\n    nested\n  #}\n  still comment\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle cross-type nested closer', () => {
      const source = '%{\n  #{\n    nested\n  %}\n  still comment\n#}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: isCommentChar', () => {
    test('should accept classdef section keyword followed by # comment (Octave)', () => {
      // Covers octaveParser.ts lines 71-72: isCommentChar returns true for '#'
      // In MATLAB, isCommentChar always returns false, but Octave overrides it
      // isCommentChar is called from isValidBlockOpen in the parent class (matlabParser)
      // when checking if a classdef section keyword is followed by valid content
      const source = `classdef MyClass
  properties # Octave comment
    Value
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'properties');
    });

    test('should accept classdef section keyword followed by % comment (Octave)', () => {
      // Covers octaveParser.ts line 71: isCommentChar returns true for '%'
      const source = `classdef MyClass
  methods % MATLAB-style comment
    function f(obj)
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'methods');
    });

    test('should reject classdef section keyword followed by operator (Octave)', () => {
      // Verifies that isCommentChar returns false for non-comment chars
      // even in Octave, triggering the rejection at lines 63-64 of matlabParser.ts
      const source = `classdef MyClass
  properties + 1
  end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'classdef', 'end');
    });

    test('should not treat properties followed by colon as block open (Octave)', () => {
      // Octave has no label syntax; `:` is the range operator, so `properties:` is
      // invalid section-keyword usage. The keyword must be rejected and the user's
      // stray inner `end` absorbed via the phantom mechanism, so classdef pairs with
      // the LAST end (line 4), producing a single classdef/end pair.
      const source = 'classdef C\nproperties:\nx\nend\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 4, 'classdef should pair with the LAST end');
      assert.strictEqual(pairs.length, 1, 'only the classdef/end pair should be produced');
    });
  });

  suite('Bug: typed close keywords skip past intervening unclosed blocks', () => {
    test('should not let endfor skip past unclosed if', () => {
      // In Octave, 'endfor' should only close 'for' if 'for' is the most recent
      // unclosed block. It should NOT skip past an unclosed 'if'.
      const pairs = parser.parse('for i = 1:10\n  if true\n    x = 1;\nendfor');
      assertNoBlocks(pairs);
    });

    test('should not let endif skip past unclosed for', () => {
      const pairs = parser.parse('if true\n  for i = 1:10\n    x = 1;\nendif');
      assertNoBlocks(pairs);
    });

    test('should not let endwhile skip past unclosed for', () => {
      const pairs = parser.parse('while true\n  for i = 1:10\n    x = 1;\nendwhile');
      assertNoBlocks(pairs);
    });

    test('should not let endfunction skip past unclosed if', () => {
      const pairs = parser.parse('function f()\n  if true\n    x = 1;\nendfunction');
      assertNoBlocks(pairs);
    });

    test('should not let end_try_catch skip past unclosed for', () => {
      const pairs = parser.parse('try\n  for i = 1:10\n    x = 1;\nend_try_catch');
      assertNoBlocks(pairs);
    });

    test('should not let until skip past unclosed if', () => {
      const pairs = parser.parse('do\n  if true\n    x = 1;\nuntil (cond)');
      assertNoBlocks(pairs);
    });

    test('should still match endfor when for is on top of stack', () => {
      // When for is the most recent unclosed block, endfor should close it
      const source = 'if true\n  for i = 1:10\n    x = 1;\n  endfor\nendif';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'if');
    });
  });

  suite('Bug: missing |= and &= compound assignment recognition', () => {
    test('should not treat end |= 1 as block close', () => {
      // |= is bitwise OR assignment in Octave; end used as variable
      // The 'end' on the second line is 'end |= 1' (variable assignment),
      // so it should not close the function block.
      // Only the 'end' on the third line should close the function.
      const source = 'function f()\n  end |= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      // Verify the correct 'end' was matched (the one at line 2, not line 1)
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by |=');
    });

    test('should not treat end &= 1 as block close', () => {
      // &= is bitwise AND assignment in Octave; end used as variable
      const source = 'function f()\n  end &= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by &=');
    });

    test('should not treat if |= 1 as block open', () => {
      // |= is bitwise OR assignment in Octave; if used as variable
      // The 'if' token should not appear when followed by |=
      const tokens = parser.getTokens('if |= 1;\nfor i = 1:10\nend');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by |= should not be tokenized as block_open');
    });

    test('should not treat if &= 1 as block open', () => {
      // &= is bitwise AND assignment in Octave; if used as variable
      const tokens = parser.getTokens('if &= 1;\nfor i = 1:10\nend');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by &= should not be tokenized as block_open');
    });
  });

  suite('Bug: missing \\=, **=, .\\=, .**= compound assignment recognition', () => {
    test('should not treat end \\= 1 as block close', () => {
      // \= is left-division assignment in Octave; end used as variable
      const source = 'function f()\n  end \\= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by \\=');
    });

    test('should not treat end **= 1 as block close', () => {
      // **= is power assignment in Octave; end used as variable
      const source = 'function f()\n  end **= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by **=');
    });

    test('should not treat end .\\= 1 as block close', () => {
      // .\= is element-wise left-division assignment in Octave; end used as variable
      const source = 'function f()\n  end .\\= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by .\\=');
    });

    test('should not treat end .**= 1 as block close', () => {
      // .**= is element-wise power assignment in Octave; end used as variable
      const source = 'function f()\n  end .**= 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should be closed by the last end, not the one followed by .**=');
    });

    test('should not treat if \\= 1 as block open', () => {
      // \= is left-division assignment in Octave; if used as variable
      const tokens = parser.getTokens('if \\= 1;\nfor i = 1:10\nend');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by \\= should not be tokenized as block_open');
    });

    test('should not treat if **= 1 as block open', () => {
      // **= is power assignment in Octave; if used as variable
      const tokens = parser.getTokens('if **= 1;\nfor i = 1:10\nend');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by **= should not be tokenized as block_open');
    });

    test('should not treat do .\\= 1 as block open', () => {
      // .\= is element-wise left-division assignment in Octave; do used as variable
      const source = 'do .\\= 1;\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat do .**= 1 as block open', () => {
      // .**= is element-wise power assignment in Octave; do used as variable
      const source = 'do .**= 1;\nif true\nend';
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

  suite('Regression: middle keywords used as variable names', () => {
    test('should not treat else followed by assignment as intermediate', () => {
      const pairs = parser.parse('if true\n  else = 5;\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not treat case followed by compound assignment as intermediate', () => {
      const pairs = parser.parse('switch x\n  case += 1;\nend');
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not treat elseif followed by assignment as intermediate', () => {
      const pairs = parser.parse('if true\n  elseif = 5;\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should still detect normal middle keywords', () => {
      const pairs = parser.parse('if true\n  x = 1;\nelse\n  x = 2;\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });
  });

  suite('Bug: middle keywords inside parentheses treated as intermediates', () => {
    test('should not treat else inside parentheses as intermediate', () => {
      // else is a reserved keyword in Octave, but if it appears inside parens
      // (e.g., as a struct field or in malformed code), it should not be
      // treated as an intermediate keyword
      const pairs = parser.parse('if true\n  x = foo(else, 1);\nelse\n  y = 1;\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should not treat case inside brackets as intermediate', () => {
      const pairs = parser.parse('switch x\n  y = [case];\n  case 1\n    z = 1;\nend');
      assertSingleBlock(pairs, 'switch', 'end');
      assertIntermediates(pairs[0], ['case']);
    });

    test('should not treat catch inside curly braces as intermediate', () => {
      const pairs = parser.parse('try\n  x = {catch};\ncatch e\n  y = 1;\nend');
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });
  });

  suite('Bug: isFollowedByAssignment does not skip line continuation', () => {
    test('should treat end followed by ... then = as variable assignment', () => {
      // "end ...\n= 5" is semantically "end = 5" due to line continuation
      const pairs = parser.parse('function f()\n  end ...\n    = 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should be closed by the last end');
    });

    test('should treat if followed by ... then = as variable assignment', () => {
      // "if ...\n= 5" is semantically "if = 5" due to line continuation
      const tokens = parser.getTokens('if ...\n  = 5;');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by ... then = should not be tokenized as block_open');
    });

    test('should treat end followed by ... then += as variable assignment', () => {
      // "end ...\n+= 5" is semantically "end += 5" due to line continuation
      const pairs = parser.parse('function f()\n  end ...\n    += 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should be closed by the last end');
    });

    test('should treat else followed by ... then = as variable assignment', () => {
      // "else ...\n= 5" is semantically "else = 5" due to line continuation
      const tokens = parser.getTokens('else ...\n  = 5;');
      const elseToken = tokens.find((t) => t.value === 'else');
      assert.strictEqual(elseToken, undefined, 'else followed by ... then = should be filtered');
    });
  });

  suite('Regression: line continuation with trailing text', () => {
    test('should treat end followed by ...+comment+newline then = as assignment', () => {
      const pairs = parser.parse('function f()\n  end ... some comment\n    = 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should treat end followed by ...+spaces+newline then = as assignment', () => {
      const pairs = parser.parse('function f()\n  end ...   \n    = 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should treat if followed by ...+comment+newline then = as variable', () => {
      const tokens = parser.getTokens('if ... comment\n  = 5;');
      assert.strictEqual(tokens.length, 0);
    });
  });

  suite('Regression: backslash line continuation with dot detects struct field access', () => {
    test('should treat end after backslash dot continuation as struct field access', () => {
      // "obj.\<newline>end;" is semantically "obj.end;" due to backslash line continuation
      const source = 'function f()\n  x = obj.\\\n  end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Bug: backslash line continuation in isFollowedByAssignment', () => {
    test('should treat end followed by backslash continuation then = as variable assignment', () => {
      // "end \<newline>= 5" is semantically "end = 5" due to backslash line continuation
      const pairs = parser.parse('function f()\n  end \\\n    = 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should be closed by the last end');
    });

    test('should treat if followed by backslash continuation then = as variable assignment', () => {
      // "if \<newline>= 5" is semantically "if = 5" due to backslash line continuation
      const tokens = parser.getTokens('if \\\n  = 5;');
      const ifToken = tokens.find((t) => t.value === 'if');
      assert.strictEqual(ifToken, undefined, 'if followed by \\ then = should not be tokenized as block_open');
    });

    test('should treat end followed by backslash continuation then += as variable assignment', () => {
      // "end \<newline>+= 5" is semantically "end += 5" due to backslash line continuation
      const pairs = parser.parse('function f()\n  end \\\n    += 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should be closed by the last end');
    });

    test('should treat else followed by backslash continuation then = as variable assignment', () => {
      // "else \<newline>= 5" is semantically "else = 5" due to backslash line continuation
      const tokens = parser.getTokens('else \\\n  = 5;');
      const elseToken = tokens.find((t) => t.value === 'else');
      assert.strictEqual(elseToken, undefined, 'else followed by \\ then = should be filtered');
    });

    test('should handle backslash with trailing whitespace before newline', () => {
      // "end \<spaces><newline>= 5" should also be recognized as line continuation
      const pairs = parser.parse('function f()\n  end \\   \n    = 5;\nend');
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'function should be closed by the last end');
    });
  });

  suite('Regression: surrogate pair Unicode letter before transpose', () => {
    test('should treat single quote after surrogate pair letter as transpose', () => {
      const pairs = parser.parse("\u{20000}'; if true; end");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: BOM at file start does not block %{ recognition', () => {
    test('should still recognise %{ as block comment opener after a leading BOM', () => {
      const source = '\u{FEFF}%{\nif keyword inside\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-04-29: keyword used as struct field / function call', () => {
    test('should not treat do.x as block opener', () => {
      const source = 'function f\n  do.x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });
    test('should not treat classdef() as block opener', () => {
      const source = 'function f\n  x = classdef();\n  if true\n    y = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: until requires statement-leading position', () => {
    test('should not tokenize until in expression context as block_close', () => {
      const source = 'do\n  body\nuntil x\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.ok(doPair, 'do should pair with until');
      assert.strictEqual(doPair.closeKeyword.value, 'until');
    });
    test('should not close do when until appears in expression position', () => {
      // `a + until` is not valid Octave, but the until in expression position should
      // not be tokenized as block_close (consistent with endif/endfor handling).
      const source = 'do\n  a + until\nuntil cond';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      // The single 'until' that pairs is the leading-position one
    });
  });

  suite('Regression: end on LHS of for-header range', () => {
    test('should not treat end in for i = end:5 as block close', () => {
      const source = 'function f(arr)\n  for i = end:5\n    x = 1;\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: block opener after ; followed by newline', () => {
    test('should detect do/until when on same line as assignment', () => {
      const source = 'x=1;do\n  y=1;\nuntil cond';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });
  });

  suite('Regression 2026-05-06: do(args) function call vs do/until block', () => {
    test('should not treat do(1, 2) as block_open inside function', () => {
      const source = 'function f()\n  do(1, 2);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still detect do as block opener when followed by newline body', () => {
      const source = 'do\n  body = 1;\nuntil cond';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });
  });

  suite('Regression 2026-05-06: typed-end after line continuation is not statement-leading', () => {
    test('should not treat endif after ... continuation as block close', () => {
      const source = 'function f()\n  if true\n    x = 1 ...\n    endif\n  endif\nendfunction';
      const pairs = parser.parse(source);
      // Only the real endif on line 4 closes the if; the endif after ... is mid-expression.
      const ifBlock = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifBlock);
      assert.strictEqual(ifBlock?.closeKeyword.line, 4);
    });

    test('should not treat until after \\\\ continuation as block close', () => {
      const source = 'do\n  body = 1 \\\n  until cond\nuntil real_cond';
      const pairs = parser.parse(source);
      // The first `until` after `\` is mid-expression; the real `until cond` on line 3 closes do.
      const doBlock = pairs.find((p) => p.openKeyword.value === 'do');
      assert.ok(doBlock);
      assert.strictEqual(doBlock?.closeKeyword.line, 3);
    });
  });

  suite('Regression 2026-05-06: case after otherwise is rejected', () => {
    test('should not register case as intermediate after otherwise in switch', () => {
      const source = 'switch x\notherwise\n  y = 1;\ncase 1\n  z = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'switch', 'end');
      const middleValues = pairs[0].intermediates.map((t) => t.value);
      assert.deepStrictEqual(middleValues, ['otherwise']);
    });
  });

  suite('Regression 2026-05-08: arguments block requires enclosing function/methods/classdef', () => {
    test('should reject standalone arguments block at top level', () => {
      const source = 'arguments\n  x = 1\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
    test('should accept arguments block inside function', () => {
      const source = 'function f\n  arguments\n    x\n  end\n  x = 1\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const argsPair = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argsPair, 'arguments inside function should pair with end');
    });
    test('should reject arguments block inside if (not function)', () => {
      const source = 'if true\n  arguments\n    x\n  end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-05-09: continuation chars inside comments do not affect statement-leading detection', () => {
    test('should treat endif after a # comment ending in ... as block close', () => {
      // The `...` inside the comment is just text, not a line continuation
      const source = 'if true\n  # comment ...\n  endif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should treat endif after a % comment ending in ... as block close', () => {
      const source = 'if true\n  % comment ...\nendif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should treat until after a # comment ending in \\ as block close', () => {
      const source = 'do\n  # comment \\\n  until cond';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should treat endfor after a comment ending in \\ as block close', () => {
      const source = 'for i = 1:10\n  # comment \\\nendfor';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'endfor');
    });
  });

  suite('Regression 2026-05-09: do[args] / do{args} reject as block_open', () => {
    test('should not treat do[1] as block_open (function-call-like indexing)', () => {
      const source = 'function f\n  x = do[1];\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      // function-end and if-end, but no do/until block
      assertBlockCount(pairs, 2);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do[1] should not open a block');
    });

    test('should not treat do{1} as block_open (function-call-like indexing)', () => {
      const source = 'function f\n  x = do{1};\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do{1} should not open a block');
    });
  });

  suite('Regression 2026-05-09: do followed by line continuation then ( is function call', () => {
    test('should not treat do ...\\n(args) as do/until block', () => {
      const source = 'function f\n  x = do ...\n  (1, 2);\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      // function-end and if-end, but no do/until block
      assertBlockCount(pairs, 2);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do ...\\n( should be a function call across continuation');
    });

    test('should not treat do \\\\\\n(args) as do/until block', () => {
      const source = 'function f\n  x = do \\\n  (1, 2);\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do \\\\\\n( should be a function call across continuation');
    });
  });

  suite('Regression 2026-05-09: vertical tab and form feed treated as whitespace for typed-close', () => {
    test('should treat endif preceded by vertical tab as block close', () => {
      const source = 'if true\nendif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should treat endif preceded by form feed as block close', () => {
      const source = 'if true\nendif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });
  });

  suite('Regression 2026-05-09: arguments(obj) function-call vs arguments block', () => {
    test('should not treat arguments(obj) as block_open in classdef methods', () => {
      const source = 'classdef A\n  methods\n    function f(obj)\n      arguments(obj);\n    end\n  end\nend';
      const pairs = parser.parse(source);
      // classdef, methods, function are 3 blocks, no arguments block
      const argumentsPair = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.strictEqual(argumentsPair, undefined, 'arguments(obj) should not open a block');
    });

    test('should still detect arguments block (no parens form) inside function', () => {
      const source = 'function f(x)\n  arguments\n    x\n  end\n  x = 1;\nend';
      const pairs = parser.parse(source);
      const argumentsPair = pairs.find((p) => p.openKeyword.value === 'arguments');
      assert.ok(argumentsPair, 'arguments<NL> inside function should still be a block');
    });
  });

  suite('Regression 2026-05-09: @end as function handle is not block close', () => {
    test('should not treat @end as block close (function handle prefix)', () => {
      // `@end` is a function handle to `end`. The `@` prefix marks the keyword as an
      // identifier reference in expression context, so `end` here must not be treated
      // as block close. Lines: 0 = function f, 1 = h = @end;, 2 = outer end.
      const source = 'function f\n  h = @end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'function should pair with the outer end');
    });
  });

  suite('Regression 2026-05-09: command-syntax with line continuation before end (Octave)', () => {
    test('should treat disp ...\\n end as command-syntax (... continuation)', () => {
      // Same as MATLAB but verifies Octave parser also handles line continuation in
      // command-syntax. `disp ...\n end` — the `end` is the string argument.
      const source = 'function f\n  disp ...\n   end\nendfunction';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should treat disp \\\\\\n end as command-syntax (\\ continuation, Octave)', () => {
      // Octave-specific: `\` at end of line is also a line continuation.
      const source = 'function f\n  disp \\\n   end\nendfunction';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });
  });

  suite('Regression 2026-05-09: phantom section keyword end skip in Octave', () => {
    test('should pair classdef with the LAST end when properties = 5 (assignment) is rejected', () => {
      // Same as MATLAB phantom section logic — when `properties = 5` is rejected as
      // a section opener, the user's stray `end` should be absorbed so classdef pairs
      // with the OUTER end, not the inner one.
      // Lines: 0 = classdef A, 1 = properties = 5, 2 = inner end (phantom skip target),
      // 3 = outer end.
      const source = 'classdef A\n  properties = 5\n  end\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 3, 'classdef should pair with the LAST end');
    });

    test('should pair classdef with the LAST end when properties + 1 (operator) is rejected', () => {
      // `properties + 1` rejects properties as section opener (operator after it).
      // Same phantom skip behaviour as `properties = 5`.
      const source = 'classdef A\n  properties + 1\n  end\nend';
      const pairs = parser.parse(source);
      const classdefBlock = findBlock(pairs, 'classdef');
      assert.strictEqual(classdefBlock.closeKeyword.line, 3, 'classdef should pair with the LAST end');
    });
  });

  suite('Regression 2026-05-09: phantom skip for arguments(obj) function call', () => {
    test('should pair function with the OUTER end when arguments(obj); is rejected', () => {
      // When `arguments(obj);` is rejected as an arguments-block opener (it is a
      // function call, not a block), the stray `end` on the next line should be
      // phantom-skipped so the outer function pairs with the OUTER end, not the
      // inner one. Lines: 0 = function f(obj), 1 = arguments(obj);, 2 = inner end
      // (phantom skip target), 3 = outer end.
      const source = 'function f(obj)\n  arguments(obj);\n  end\nend';
      const pairs = parser.parse(source);
      const functionBlock = findBlock(pairs, 'function');
      assert.strictEqual(functionBlock.closeKeyword.line, 3, 'function should pair with the LAST end');
    });
  });

  suite('Regression 2026-05-09: only one unwind_protect_cleanup per unwind_protect in Octave', () => {
    test('should accept only the first unwind_protect_cleanup as intermediate', () => {
      // The Octave language spec allows exactly one `unwind_protect_cleanup` per
      // `unwind_protect` block. A second `unwind_protect_cleanup` is a syntax error
      // and must NOT be recorded as an intermediate. Otherwise the BlockPair's
      // intermediates are corrupt.
      const source = 'unwind_protect\n  a;\nunwind_protect_cleanup\n  b;\nunwind_protect_cleanup\n  c;\nend_unwind_protect';
      const pairs = parser.parse(source);
      const block = findBlock(pairs, 'unwind_protect');
      assertIntermediates(block, ['unwind_protect_cleanup']);
    });
  });

  suite('Regression 2026-05-09: VT/FF allowed around block comment delimiters in Octave', () => {
    test('should treat %{ followed by VT as block comment start (MATLAB-symmetric)', () => {
      // MATLAB treats vertical tab (`\v`) and form feed (`\f`) as whitespace around
      // block comment delimiters. Octave parser must do the same to keep behaviour
      // symmetric and to avoid mis-parsing a comment starter as code.
      // Lines: 0 = %{<VT>, 1 = if true, 2 = end, 3 = %}.
      const source = '%{\v\nif true\nend\n%}';
      const pairs = parser.parse(source);
      // The if/end should NOT be detected as a block because the entire span is
      // inside a block comment.
      assertNoBlocks(pairs);
    });

    test('should treat %{ followed by FF as block comment start (MATLAB-symmetric)', () => {
      const source = '%{\f\nif true\nend\n%}';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat %} followed by VT as block comment end (MATLAB-symmetric)', () => {
      // Trailing-content check on `%}` must accept VT/FF as whitespace too.
      const source = '%{\nif true\nend\n%}\v';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat #{ followed by VT as block comment start (Octave-style)', () => {
      const source = '#{\v\nif true\nend\n#}';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression 2026-05-09: command-syntax do argument is not block_open', () => {
    test('should not treat do as block_open when it is a command-syntax argument', () => {
      // `disp do` is command-syntax: `disp` is a command and `do` is its string argument.
      // The `do` here must NOT be treated as a do/until block opener. The real do block
      // starts on the next line. Without this fix, the command-arg `do` opens a phantom
      // block that consumes the real `until` and breaks the outer function pairing.
      // Lines: 0 = function f, 1 = disp do, 2 = real do, 3 = body, 4 = until x>0, 5 = end.
      const source = 'function f\n  disp do\n  do\n    x = 1;\n  until x > 0\nend';
      const pairs = parser.parse(source);
      // The function should pair with the outer end on line 5.
      const functionBlock = findBlock(pairs, 'function');
      assert.strictEqual(functionBlock.closeKeyword.value, 'end');
      assert.strictEqual(functionBlock.closeKeyword.line, 5, 'function should pair with the outer end');
      // The real do-until block should pair correctly (real do on line 2 with until on line 4).
      const doPair = pairs.find((p) => p.openKeyword.value === 'do' && p.openKeyword.line === 2);
      assert.ok(doPair, 'real do (line 2) should pair with until');
      assert.strictEqual(doPair.closeKeyword.value, 'until');
      assert.strictEqual(doPair.closeKeyword.line, 4, 'do should pair with until on line 4');
      // No second `do` block should be created from the command-syntax `do` on line 1.
      const allDoPairs = pairs.filter((p) => p.openKeyword.value === 'do');
      assert.strictEqual(allDoPairs.length, 1, 'only one do block expected');
    });
  });

  suite('Regression 2026-05-15: do followed by Unicode whitespace is function call', () => {
    test('should not treat do<NBSP>(...) as do/until block', () => {
      // U+00A0 NO-BREAK SPACE between `do` and `(` should still be treated as
      // whitespace for function-call detection. Without this, the spurious `do`
      // remains a block opener and breaks outer block pairing.
      const source = 'function f\n  do (1, 2);\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do<NBSP>( should be a function call');
      // function-end and if-end should both pair correctly.
      assertBlockCount(pairs, 2);
      const functionBlock = findBlock(pairs, 'function');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(functionBlock.closeKeyword.value, 'end');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end');
    });

    test('should not treat do<U+2000>(...) as do/until block (en quad)', () => {
      // U+2000 EN QUAD is another Unicode whitespace.
      const source = 'function f\n  do (1, 2);\n  if true\n  end\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do<U+2000>( should be a function call');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-15: do followed by colon is not block open', () => {
    test('should not treat do: as do/until block opener', () => {
      // `do:` is invalid Octave syntax (Octave has no label statements; `:` here
      // would be a range operator without a left operand). Treating `do` as a
      // block opener in this context destroys the outer function pairing because
      // the orphan `do` consumes nothing and remains on the stack.
      const source = 'function f\n  do:\n    x = 1;\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do: should not open a do/until block');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat do : (with space) as do/until block opener', () => {
      // Same with whitespace between `do` and `:`.
      const source = 'function f\n  do :\n    x = 1;\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do : should not open a do/until block');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat do; ... until as a valid do/until block', () => {
      // Postfix `;` after `do` is a valid statement separator in Octave's
      // do/until form. Make sure the `:` rejection above does not regress this.
      const source = 'do;\n  x = 1;\nuntil x > 0';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });
  });

  suite('Regression 2026-05-15: end(idx) = value is indexing assignment, not block close', () => {
    test('should not treat end(1) = 5 as block close', () => {
      // `end(1) = 5;` is indexing assignment to a variable named `end`. This must
      // not be treated as a block_close that consumes the function opener;
      // otherwise the trailing real `end` becomes orphan.
      const source = 'function f\nend(1) = 5;\nend';
      const pairs = parser.parse(source);
      // Function should pair with the trailing `end` (line 2), not `end(1)` (line 1).
      const functionBlock = findBlock(pairs, 'function');
      assert.strictEqual(functionBlock.closeKeyword.line, 2, 'function should pair with trailing end on line 2');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat end(idx) = expr as block close with complex expression', () => {
      // Same pattern with a more complex assignment value.
      const source = 'function f\nend(2) = compute(x);\nend';
      const pairs = parser.parse(source);
      const functionBlock = findBlock(pairs, 'function');
      assert.strictEqual(functionBlock.closeKeyword.line, 2);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should still treat end(1) without assignment as block close (indexing read)', () => {
      // `x = end(1);` is reading the indexed end value (rare but valid Octave).
      // However, in this context we only need to ensure that bare `end` inside
      // brackets without assignment is NOT mis-pre-empted: the issue is only when
      // followed by `=`. Test that `end` followed by `(` then `==` (comparison)
      // is still a normal block close.
      const source = 'function f\n  if end(1) == 5\n  endif\nend';
      const pairs = parser.parse(source);
      // function/end pair must exist; the `end` inside `if` is inside parens so
      // already filtered (it's an `end` keyword for indexing inside `(`).
      const functionBlock = findBlock(pairs, 'function');
      assert.strictEqual(functionBlock.closeKeyword.line, 3, 'function should pair with outer end');
    });
  });

  suite('Regression 2026-05-15: do followed by line comment ends the statement', () => {
    test('should treat do followed by % comment then ( as a do/until opener', () => {
      // Octave line comments (`%...`) do not continue a statement — only `...`
      // and `\` do. So `do % comment` ends the `do` statement and `do` is a
      // do/until block opener. The next line `(1, 2);` is an independent
      // statement, not `do(1, 2)`. With no `until`, the `do` opener is an
      // orphan and blocks the stack, so function/end is not paired.
      const source = 'function f\n  do % this is a comment\n  (1, 2);\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'orphan do (no until) produces no pair');
      const functionPair = pairs.find((p) => p.openKeyword.value === 'function');
      assert.strictEqual(functionPair, undefined, 'orphan do blocks function/end pairing');
    });

    test('should treat do followed by # comment then ( as a do/until opener', () => {
      // Octave-style line comment `#` also ends the `do` statement; the next
      // line is independent and `do` is a do/until block opener.
      const source = 'function f\n  do # this is a comment\n  (1, 2);\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'orphan do (no until) produces no pair');
      const functionPair = pairs.find((p) => p.openKeyword.value === 'function');
      assert.strictEqual(functionPair, undefined, 'orphan do blocks function/end pairing');
    });

    test('should pair do/until when do has a trailing % comment and ( body', () => {
      // `do % comment` then a line starting with `(`/`[`/`{` is a valid
      // do/until block: the line comment does not continue the statement, so
      // the body line is not `do(...)`. The block must pair with `until`.
      const source = 'do  % loop start\n  [a, b] = f();\nuntil done';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });

    test('should pair do/until when do has a trailing # comment and ( body', () => {
      // Same as above with an Octave-style `#` comment.
      const source = 'do  # loop start\n  (x) = f();\nuntil done';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'until');
    });
  });

  suite('Regression 2026-05-16: do followed by field access is not block open', () => {
    test('should not treat do .x = 1 as do/until block opener', () => {
      // `do .x = 1` is a struct field assignment where `do` is a variable name
      // (`do.x = 1` with whitespace before the `.`). Treating `do` as a block
      // opener leaves a spurious opener on the stack and destroys the enclosing
      // function/end pairing.
      const source = 'function f\n  do .x = 1;\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do .x should not open a do/until block');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not treat do ...\\n.x as a do/until block (field access across continuation)', () => {
      // A `...` continuation followed by `.x` on the next line keeps `do` as the
      // statement: this is `do .x` across a line continuation, which is a field
      // access — `do` is still a variable. The `.` rejection must hold across the
      // continuation just like the `(`/`[`/`{` rejection does.
      const source = 'function f\n  do ...\n  .x = 1;\nend';
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do ...\\n.x should not open a do/until block');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression 2026-05-16: do followed by quote is not block open', () => {
    test("should not treat do' as a do/until block opener (transpose)", () => {
      // `do'` is the transpose of a variable named `do` — the `'` directly
      // follows the identifier, so it is the transpose operator. Treating `do`
      // as a do/until opener wrongly pairs it with a following `until`.
      const source = "do'\nuntil c";
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, "do' should not open a do/until block");
      assertNoBlocks(pairs);
    });

    test("should not let do' break enclosing block pairing", () => {
      // A spurious `do` opener for the transpose form `do'` would block the
      // stack and prevent the enclosing for/endfor from pairing. Rejecting `do'`
      // keeps the for/endfor pair intact.
      const source = "for i = 1:3\n  do'\n  x = 1;\nendfor";
      const pairs = parser.parse(source);
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, "do' should not open a do/until block");
      assertSingleBlock(pairs, 'for', 'endfor');
    });
  });

  suite('Regression 2026-05-16: out-of-order and duplicate intermediate keywords', () => {
    test('should not record elseif after else as an intermediate', () => {
      // `else` must be the last branch of an `if`. An `elseif` appearing after
      // `else` is a syntax error and must not be recorded as an intermediate.
      const source = 'if c\nelse\nelseif d\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should not record a duplicate else as an intermediate', () => {
      // An `if` block allows at most one `else`. A second `else` is a syntax
      // error and must not be recorded.
      const source = 'if c\nelse\nelse\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should not record a duplicate catch as an intermediate', () => {
      // A `try` block allows at most one `catch`. A second `catch` is a syntax
      // error and must not be recorded.
      const source = 'try\ncatch a\ncatch b\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['catch']);
    });

    test('should still record multiple elseif before else', () => {
      // Multiple `elseif` branches before a single `else` are valid Octave and
      // must all be recorded — the duplicate rejection must not regress this.
      const source = 'if a\nelseif b\nelseif c\nelse\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elseif', 'elseif', 'else']);
    });
  });

  suite('Coverage: typed-end keyword followed by trailing content', () => {
    test('should accept a typed end keyword followed by whitespace and a semicolon', () => {
      // `endif` followed by a space then `;` - the trailing-content scan skips
      // the whitespace and accepts `;` as a valid statement separator.
      const source = 'if x\n  y = 1;\nendif ;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should accept a typed end keyword followed by a comment', () => {
      // `endfor` followed by a `#` line comment - a comment ends the statement,
      // so the typed-end keyword is still a valid block close.
      const source = 'for i = 1:3\n  y = i;\nendfor # done';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'endfor');
    });
  });

  generateCommonTests(config);
});
