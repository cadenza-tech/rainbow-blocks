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
});
