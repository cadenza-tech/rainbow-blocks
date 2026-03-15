import * as assert from 'node:assert';
import { OctaveBlockParser } from '../../parsers/octaveParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

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
    test('should ignore keywords in single-quoted strings', () => {
      const source = `msg = 'if for while end';
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

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
  });

  generateCommonTests(config);
});
