import * as assert from 'node:assert';
import { OctaveBlockParser } from '../../parsers/octaveParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  assertTokens,
  findBlock
} from '../helpers/parserTestHelpers';

suite('OctaveBlockParser Test Suite', () => {
  let parser: OctaveBlockParser;

  setup(() => {
    parser = new OctaveBlockParser();
  });

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
    test('should ignore keywords in %-style single-line comments', () => {
      const source = `% if for while end function
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

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

    test('should ignore keywords in double-quoted strings', () => {
      const source = `msg = "if for while end";
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

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('x = 1 + 2;');
      assertNoBlocks(pairs);
    });

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
      // Tests lines 165-167 in matchMatlabBlockComment
      const source = `%{
comment
%} ignored content
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
      // Tests lines 185-187 in matchOctaveBlockComment
      const source = `#{
comment
#} ignored content
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
      assertSingleBlock(pairs, 'if', 'end', 0);
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `if true
  action();
end`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `function test()
  if true
    action();
  end
end`;
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      const funcPair = findBlock(pairs, 'function');
      assertTokenPosition(ifPair.openKeyword, 1, 2);
      assertTokenPosition(funcPair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if true
else
end`;
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [{ value: 'if' }, { value: 'else' }, { value: 'end' }]);
    });

    test('getExcludedRegions should return excluded regions for % comment', () => {
      const source = `% comment
'string'`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });

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
      const pairs = parser.parse('for i = 1:10\n  do\n    x = 1\n  end\nend');
      // end should close for, not do; do should be orphaned
      const forPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forPair, 'for block should be paired');
      assert.strictEqual(forPair.closeKeyword.value, 'end');
      // do should not be paired with end
      const doPair = pairs.find((p) => p.openKeyword.value === 'do');
      assert.strictEqual(doPair, undefined, 'do should not be paired with generic end');
    });

    test('should correctly pair do-until inside for-end', () => {
      const pairs = parser.parse('for i = 1:10\n  do\n    x = 1\n  until condition\nend');
      assertBlockCount(pairs, 2);
      const doPair = findBlock(pairs, 'do');
      assert.strictEqual(doPair.closeKeyword.value, 'until');
      const forPair = findBlock(pairs, 'for');
      assert.strictEqual(forPair.closeKeyword.value, 'end');
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

  suite('v7 bug fixes', () => {
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
});
