import * as assert from 'node:assert';
import { RubyBlockParser } from '../../parsers/rubyParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import {
  generateCommonTests,
  generateEdgeCaseTests,
  generateExcludedRegionTests,
  generateRegexInterpolationTests,
  generateStringInterpolationTests
} from '../helpers/sharedTestGenerators';

suite('RubyBlockParser Test Suite', () => {
  let parser: RubyBlockParser;

  setup(() => {
    parser = new RubyBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'puts "hello world"',
    tokenSource: 'def foo\nend',
    expectedTokenValues: ['def', 'end'],
    excludedSource: '"string" # comment\ndef foo\nend',
    expectedRegionCount: 2,
    twoLineSource: 'def foo\nend',
    singleLineCommentSource: '# if end\ndef foo\nend',
    commentBlockOpen: 'def',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'x = "if end"\ndef foo\nend',
    stringBlockOpen: 'def',
    stringBlockClose: 'end',
    singleQuotedStringSource: "x = 'begin end'\ndef foo\nend",
    singleQuotedStringBlockOpen: 'def',
    singleQuotedStringBlockClose: 'end',
    escapedQuoteStringSource: 'x = "say \\"if\\" end"\ndef foo\nend',
    escapedQuoteStringBlockOpen: 'def',
    escapedQuoteStringBlockClose: 'end'
  };

  suite('Simple blocks', () => {
    test('should parse simple do-end block', () => {
      const source = `[1, 2, 3].each do |x|
  puts x
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should parse simple if-end block', () => {
      const source = `if condition
  do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse def-end block', () => {
      const source = `def my_method
  return 42
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse class-end block', () => {
      const source = `class MyClass
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should parse module-end block', () => {
      const source = `module MyModule
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'end');
    });
  });

  suite('Expression blocks', () => {
    test('should parse if expression assigned to variable', () => {
      const source = `value = if condition == true
  100
else
  200
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse case expression assigned to variable', () => {
      const source = `result = case x
when 1
  "one"
else
  "other"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should parse begin expression assigned to variable', () => {
      const source = `result = begin
  risky_operation
rescue
  fallback_value
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else-end block', () => {
      const source = `if condition
  do_something
else
  do_other
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse if-elsif-else-end block', () => {
      const source = `if condition1
  do_1
elsif condition2
  do_2
else
  do_3
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elsif', 'else']);
    });

    test('should parse begin-rescue-ensure-end block', () => {
      const source = `begin
  risky_operation
rescue StandardError
  handle_error
ensure
  cleanup
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue', 'ensure']);
    });

    test('should parse case-when-else-end block', () => {
      const source = `case x
when 1
  "one"
when 2
  "two"
else
  "other"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['when', 'when', 'else']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `class Foo
  def bar
    if condition
      do_something
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });

    test('should parse deeply nested blocks', () => {
      const source = `module A
  class B
    def c
      if d
        while e
          begin
            do_something
          end
        end
      end
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 6);
      assertNestLevel(pairs, 'begin', 5);
    });
  });

  suite('Postfix conditionals', () => {
    test('should ignore postfix if', () => {
      const source = `def my_method
  return value if condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore postfix unless', () => {
      const source = `def my_method
  skip unless valid
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore postfix while', () => {
      const source = `def my_method
  x += 1 while x < 10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore postfix until', () => {
      const source = `def my_method
  x += 1 until x >= 10
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect block if at start of line', () => {
      const source = `if condition
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect block if after else keyword', () => {
      const source = `if cond1
  a
else if cond2
  b
end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should detect block if after then keyword', () => {
      const source = `case x
when 1 then if y
  action
end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle complex postfix if in method', () => {
      const source = `def update_provider_info(user, auth)
  user.update(provider: auth.provider, uid: auth.uid) if user.provider.blank? || user.uid.blank?
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle multiple postfix conditionals in method', () => {
      const source = `def complex_method
  return early if precondition
  skip_step unless enabled
  retry_count += 1 while retrying
  wait until ready
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect block unless at start of line', () => {
      const source = `unless condition
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should detect block while at start of line', () => {
      const source = `while condition
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should detect block until at start of line', () => {
      const source = `until condition
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'until', 'end');
    });

    test('should detect block if after semicolon separator', () => {
      const source = `puts "hello"; if condition
  do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect block unless after semicolon separator', () => {
      const source = `puts "hello"; unless condition
  do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should treat if after not as block, not postfix', () => {
      const pairs = parser.parse('not if condition\n  body\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat while after and as block, not postfix', () => {
      const pairs = parser.parse('x = 1 and while condition\n  body\nend');
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should treat unless after or as block, not postfix', () => {
      const pairs = parser.parse('x = 1 or unless condition\n  body\nend');
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should ignore semicolon inside string when checking postfix', () => {
      const source = `x = "hello; world"; if condition
  do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still detect postfix if after expression', () => {
      const source = 'do_something if condition';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat save! if as postfix conditional', () => {
      const source = `def update
  record.save! if valid
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat valid? if as postfix conditional', () => {
      const source = `def check
  process if record.valid?
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should ignore keywords in multi-line comments', () => {
      const source = `=begin
if condition
  do_something
end
=end
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Heredocs', () => {
    test('should ignore keywords in heredocs', () => {
      const source = `x = <<~HEREDOC
if condition
  do_something
end
HEREDOC
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle heredoc with dash prefix', () => {
      const source = `x = <<-EOF
if condition
  do_something
end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle heredoc with content on same line', () => {
      const source = `x = <<EOF.strip
if end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in comment on heredoc start line', () => {
      const source = `x = <<~HEREDOC # if end
  body
HEREDOC
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match invalid heredoc syntax', () => {
      const source = '<< invalid\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not exclude code after heredoc marker on same line', () => {
      const source = `x = <<EOF + do_something
heredoc content
EOF`;
      const regions = parser.getExcludedRegions(source);
      // The excluded region should start from the next line, not from <<EOF
      const heredocRegion = regions.find((r) => r.start > source.indexOf('\n'));
      assert.ok(heredocRegion, 'should have heredoc content region');
      assert.ok(heredocRegion.start >= source.indexOf('\n'), 'excluded region should start at or after the newline');
    });

    test('should reject quoted heredoc after identifier (shift operator)', () => {
      const source = 'x = y <<"EOF"\nhello\nEOF';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should accept heredoc with flag after identifier', () => {
      const source = 'x = y <<~EOF\nhello\nEOF';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should accept heredoc with dash flag after identifier', () => {
      const source = 'x = y <<-EOF\nhello\nEOF';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });
  });

  suite('Division and regex after ? and ! characters', () => {
    test('should treat / after method ending with ? as division', () => {
      const source = `x = foo? / 2
if true
  y = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / after method ending with ! as division', () => {
      const source = `x = save! / 2
if true
  y = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / after ternary ? operator as regex start', () => {
      const source = `x = condition ? /pattern/ : /other/
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / after logical not ! operator as regex start', () => {
      const source = `x = !/pattern/
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / after standalone ! with space as regex start', () => {
      const source = `x = ! /pattern/
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / after valid? method as division (not regex)', () => {
      const source = `result = valid? / divisor
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ternary with keyword in regex', () => {
      const source = `x = cond ? /if end/ : nil
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ! before regex with keyword inside', () => {
      const source = `x = !/do end/
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Keywords with ? ! = suffix', () => {
    test('should not treat end? as block close keyword', () => {
      const source = `def end?
  true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat begin? as block open keyword', () => {
      const source = `def begin?
  true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Regex', () => {
    test('should ignore keywords in regex literals', () => {
      const source = 'x = /if end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex with flags', () => {
      const source = 'x = /if end/imxo\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex at start of file', () => {
      const source = '/if end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex after only whitespace', () => {
      const source = '   /if end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat slash as division after identifier', () => {
      const source = 'x = a / b\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat slash as division after closing paren', () => {
      const source = 'x = (a + b) / c\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat slash as division after number', () => {
      const source = 'x = 10 / 2\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex character class containing slash', () => {
      const pairs = parser.parse('if true\n  x = /[/]end/\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Percent literals', () => {
    test('should ignore keywords in percent string literals', () => {
      const source = 'x = %q{if end}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle nested braces in percent literal', () => {
      const source = 'x = %q{{if} {end}}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle percent literal with non-bracket delimiter', () => {
      const source = 'x = %q!if end!\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle percent literal without specifier', () => {
      const source = 'x = %(if end)\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match percent with alphanumeric delimiter', () => {
      const source = '%qa\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat %= as compound assignment not percent literal', () => {
      const pairs = parser.parse('if true\n  x %= 5\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Backtick strings', () => {
    test('should ignore keywords in backtick strings', () => {
      const source = 'x = `echo if end`\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Symbol strings', () => {
    test('should ignore keywords in symbol strings', () => {
      const source = 'x = :"if end"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped quotes in symbol strings', () => {
      const source = 'x = :"test\\"if\\"end"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped quotes in backtick strings', () => {
      const source = 'x = `echo \\"if\\" end`\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped delimiters in percent literals', () => {
      const source = 'x = %q{if \\} end}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - String interpolation', () => {
    generateStringInterpolationTests(config);
  });

  suite('Excluded regions - Regex interpolation', () => {
    generateRegexInterpolationTests(config);
  });

  suite('Excluded regions - Interpolation with regex inside', () => {
    test('should handle regex with } inside string interpolation', () => {
      const source = 'x = "value: #{str.match(/}/) ? "yes" : "no"}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle regex with escaped / inside string interpolation', () => {
      const source = 'x = "#{str.gsub(/\\//, "-")}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle regex after = inside interpolation', () => {
      const source = 'x = "#{y = /pattern/; y}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle regex after ( inside interpolation', () => {
      const source = 'x = "#{foo(/regex/)}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle regex after , inside interpolation', () => {
      const source = 'x = "#{foo(a, /pattern/)}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should treat / as division after identifier in interpolation', () => {
      const source = 'x = "#{a / b}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle regex with #{} interpolation inside string interpolation', () => {
      const source = 'x = "#{/pattern_#{var}/}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });
  });

  suite('Symbol literals', () => {
    test('should not match keywords inside symbol literals', () => {
      const source = `:if
:end
:for
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match :do symbol as block opener', () => {
      const source = `x = :do
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle symbol array', () => {
      const source = `symbols = [:if, :unless, :while, :end]
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle quoted symbol with keyword', () => {
      const source = `sym = :"end"
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle single-quoted symbol with keyword', () => {
      const source = `sym = :'if'
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not confuse ternary operator with symbol', () => {
      const source = `x = cond ? :yes : :no
def foo
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle hash rocket syntax with symbol', () => {
      const source = `hash = { :if => 1, :end => 2 }
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude heredoc body inside double-quoted symbol interpolation', () => {
      // Regression: matchSymbolLiteral did not propagate heredocState,
      // so heredoc body keywords were incorrectly detected as block tokens
      const source = `x = :"#{<<~HEREDOC}"
  end
HEREDOC
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat :/ as regex start', () => {
      const pairs = parser.parse('ops = [:+, :-, :*, :/]\ndef calculate(op)\n  case op\n  when :+\n    1\n  end\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'def');
      findBlock(pairs, 'case');
    });

    test('should not treat :` as backtick string start', () => {
      const pairs = parser.parse('CMDS = {exec: :`}\ndef run\n  if valid?\n    execute\n  end\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'def');
      findBlock(pairs, 'if');
    });

    test('should not treat :% in array as percent literal start', () => {
      const pairs = parser.parse('ops = [:%]\ndef foo\n  1\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Hash key syntax (keyword:)', () => {
    test('should not match keywords used as new hash keys', () => {
      const source = `hash = { if: 1, end: 2, while: 3 }
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match do: in hash', () => {
      const source = `opts = { do: :something }
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still match block keyword followed by space', () => {
      const source = `if condition
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('__END__ data section', () => {
    test('should ignore everything after __END__', () => {
      const source = `if true
end
__END__
if false
end
this is data section`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });

    test('should not match __END__ in middle of line', () => {
      const source = `x = __END__
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match __END__ inside string', () => {
      const source = `x = "__END__"
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should not match __END__ with trailing characters', () => {
      const source = `__END__xxx
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle __END__ at very end of file', () => {
      const source = `if true
end
__END__`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle __END__ with DATA content containing code-like text', () => {
      const source = `def real_method
end
__END__
def fake_method
  if condition
    while loop
    end
  end
end
class NotAClass
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle for-end block', () => {
      const source = `for i in 1..10
puts i
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should not include in as intermediate in for loop', () => {
      const pairs = parser.parse('for x in collection\n  puts x\nend');
      assertSingleBlock(pairs, 'for', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should still recognize in as intermediate in case/in pattern matching', () => {
      const source = `case value
in Integer
  puts "integer"
in String
  puts "string"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['in', 'in']);
    });

    test('should handle unless-end block', () => {
      const source = `unless condition
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should handle while-end block', () => {
      const source = `while condition
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should handle while-do-end block', () => {
      const source = `while condition do
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should handle until-do-end block', () => {
      const source = `until condition do
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'until', 'end');
    });

    test('should handle for-do-end block', () => {
      const source = `for i in 1..10 do
puts i
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle until-end block', () => {
      const source = `until condition
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'until', 'end');
    });

    test('should handle multiple sequential blocks', () => {
      const source = `def foo
end

def bar
end

def baz
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assert.ok(pairs.every((p) => p.openKeyword.value === 'def'));
      assert.ok(pairs.every((p) => p.nestLevel === 0));
    });

    test('should handle block with multiple rescue clauses', () => {
      const source = `begin
risky
rescue TypeError
handle_type_error
rescue ArgumentError
handle_argument_error
rescue => e
handle_other
ensure
cleanup
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 4);
      assert.strictEqual(pairs[0].intermediates.filter((i) => i.value === 'rescue').length, 3);
      assert.strictEqual(pairs[0].intermediates.filter((i) => i.value === 'ensure').length, 1);
    });

    test('should handle lambda with do-end', () => {
      const source = `my_lambda = -> do
puts "hello"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should handle method with rescue modifier in body', () => {
      const source = `def safe_method
risky_operation rescue nil
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle keywords that are part of method names', () => {
      const source = `def end_with_suffix
do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle complex real-world Ruby code', () => {
      const source = `module MyModule
class MyClass
  def initialize(name)
    @name = name
  end

  def process
    if valid?
      items.each do |item|
        case item.type
        when :a
          handle_a(item)
        when :b
          handle_b(item)
        else
          handle_default(item)
        end
      end
    else
      raise "Invalid"
    end
  end

  private

  def valid?
    @name != nil
  end
end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 8);

      const modulePair = findBlock(pairs, 'module');
      const classPair = findBlock(pairs, 'class');
      const casePair = findBlock(pairs, 'case');

      assert.strictEqual(modulePair.nestLevel, 0);
      assert.strictEqual(classPair.nestLevel, 1);
      assertIntermediates(casePair, ['when', 'when', 'else']);
    });

    suite('Quoted symbols', () => {
      test('should handle unterminated double-quoted symbol', () => {
        const source = `sym = :"unterminated
def foo
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unterminated single-quoted symbol', () => {
        const source = `sym = :'unterminated
def foo
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle escaped quotes in double-quoted symbol', () => {
        const source = `sym = :"escaped\\"quote"
def foo
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle escaped quotes in single-quoted symbol', () => {
        const source = `sym = :'escaped\\'quote'
def foo
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Regex literals', () => {
      test('should handle regex with escape sequences', () => {
        const source = `/regex\\/with\\/escapes/
def foo
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle multiline regex (Ruby allows multiline regex between bare / delimiters)', () => {
        const source = `/unterminated regex
def foo
end`;
        const pairs = parser.parse(source);
        // Multiline regex consumes everything until closing / or EOF
        assertNoBlocks(pairs);
      });

      test('should handle regex at end of file without terminator', () => {
        const source = 'x = /regex';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should detect regex after whitespace', () => {
        const source = `x =   /pattern/
def foo
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Percent literals', () => {
      test('should handle unterminated percent literal', () => {
        const source = `str = %q(unterminated
def foo
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle percent literal at end of file', () => {
        const source = 'x = %q';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Backtick strings', () => {
      test('should handle unterminated backtick string', () => {
        const source = 'cmd = `unterminated\ndef foo\nend';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Multi-line comments', () => {
      test('should not treat = at line start as multi-line comment if not =begin', () => {
        const source = `=other
def foo
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle unterminated multi-line comment (=begin without =end)', () => {
        const source = `=begin
if condition
  do_something
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should not treat = in middle of line as multi-line comment start', () => {
        const source = `x = begin
  1
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'begin', 'end');
      });

      test('should not treat =beginning as =begin', () => {
        const source = `=beginning
def foo
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat =ending as =end', () => {
        const source = `=begin
=ending
def foo
end
=end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle =begin followed by space and text', () => {
        const source = `=begin some comment
def foo
end
=end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should exclude content after =end on the same line', () => {
        const pairs = parser.parse('=begin\ncomment\n=end if true\ndo\nend');
        // "if true" after =end should be excluded (still part of comment)
        assertSingleBlock(pairs, 'do', 'end');
      });
    });

    suite('Heredocs', () => {
      test('should handle unterminated heredoc', () => {
        const source = `x = <<EOF
if condition
  do_something`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle heredoc terminator at end of file without newline', () => {
        const source = `x = <<EOF
content
EOF`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle heredoc with CRLF line endings', () => {
        const source = 'def foo\r\n  <<-EOF\r\ncontent\r\nEOF\r\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });
    });

    suite('Multiple heredocs on same line', () => {
      test('should handle two heredocs on same line', () => {
        const source = `x = <<A + <<B
first heredoc
A
second heredoc
B
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
        assert.strictEqual(pairs[0].openKeyword.line, 5);
      });

      test('should exclude keywords in second heredoc', () => {
        const source = `x = <<A + <<B
A
if in second heredoc
end
B
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        assert.strictEqual(pairs[0].openKeyword.line, 5);
      });

      test('should handle three heredocs on same line', () => {
        const source = `x = <<A + <<B + <<C
A
if in B
B
end in C
C
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        assert.strictEqual(pairs[0].openKeyword.line, 6);
      });

      test('should handle heredocs with indented terminators', () => {
        const source = `x = <<~A + <<~B
  first
  A
  second
  B
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });
    });

    suite('Symbol edge cases', () => {
      test('should handle colon at end of file', () => {
        const source = 'def foo\nend\n:';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after identifier as symbol in hash key', () => {
        const source = 'def foo\n  {key: value}\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after number as symbol', () => {
        const source = 'def foo\n  x = 123: value\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon after closing paren as symbol', () => {
        const source = 'def foo\n  func():symbol\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon after closing bracket as symbol', () => {
        const source = 'def foo\n  arr]:symbol\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat colon after identifier when followed by letter', () => {
        const source = 'def foo\n  x = a:b\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    test('should not treat double backslash before newline as line continuation', () => {
      // Even number of backslashes = escaped backslashes, not continuation
      const source = 'begin \\\\\nrescue\n  nil\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });

    suite('CR-only line endings in conditionals', () => {
      test('should handle \\r-only line endings in postfix conditional', () => {
        const source = 'x = 1 if condition\rdo_something\rend';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle \\r-only line endings in block conditional', () => {
        const source = 'if condition\rdo_something\rend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });
    });

    test('should not let \\x hex escape in char literal skip past newline', () => {
      const pairs = parser.parse('?\\x\ndo\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should not let \\u unicode escape in char literal skip past newline', () => {
      const pairs = parser.parse('?\\u\ndo\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should not treat $/ as regex start', () => {
      const pairs = parser.parse('puts $/\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ?{ character literal inside string interpolation', () => {
      const pairs = parser.parse('"#{?{}" + do_something\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat if after $! as postfix conditional', () => {
      const pairs = parser.parse('def foo\n  puts $! if true\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat if after $? as postfix conditional', () => {
      const pairs = parser.parse('def foo\n  puts $? if true\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat / after $? as regex start', () => {
      const pairs = parser.parse('x = $? / 100\nif condition\n  action\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat / after $! as regex start', () => {
      const pairs = parser.parse('x = $! / 2\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Rescue modifier', () => {
    test('should not treat inline rescue as intermediate', () => {
      const pairs = parser.parse('def foo\n  risky rescue nil\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat rescue as intermediate in begin block', () => {
      const pairs = parser.parse('begin\n  risky\nrescue\n  handle\nend');
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 1);
    });
  });

  suite('Regression: isLoopDo loop keyword context validation', () => {
    test('should treat x.while do as block do, not loop do', () => {
      const source = `x.while do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat x.until do as block do, not loop do', () => {
      const source = `x.until do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat x.for do as block do, not loop do', () => {
      const source = `x.for do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat Module::while do as block do, not loop do', () => {
      const source = `Module::while do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat @while do as block do, not loop do', () => {
      const source = `@while do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat $while do as block do, not loop do', () => {
      const source = `$while do |y|
  puts y
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should still detect real while do as loop do', () => {
      const source = `while condition do
  puts "loop"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Coverage: loopDo semicolon and excluded region branches', () => {
    test('should handle semicolon before loop do on same line', () => {
      // Tests the semicolon search in loopDo (lines 120-128)
      // The semicolon separates two statements, and loop do is on the second
      const source = `x = 1; while condition do
  x += 1
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'while');
    });
    test('should handle loop keyword inside string before real loop do', () => {
      // Tests the excluded region check for loop keyword (lines 141-142)
      // "while" inside a string is found by regex but in excluded region
      const source = `foo("while") + while true do
  break
end.to_s`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'while');
    });

    test('should handle do keyword inside string between loop and real do', () => {
      // Tests the excluded region check for do (lines 153-154)
      // "do" inside a string after while should be skipped
      const source = `while x = "do" do
  puts x
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'while');
    });

    test('should handle multiple do keywords on same line after loop keyword', () => {
      // Tests the "different valid do before our position" branch
      // while ... do x.each do - second do has a prior valid do on same line
      const source = `while cond do x.each do |y|
  puts y
end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle semicolon inside string before loop do', () => {
      // Tests the semicolon-in-excluded-region branch (lines 124-127)
      // The semicolon is inside a string, so it should be ignored
      const source = `x = "a;b"; while true do
  break
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'while');
    });
  });

  suite('Modulo operator vs percent literal', () => {
    test('should treat % after string as modulo, not percent literal', () => {
      const source = '"hello" % w do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat % after regex as modulo, not percent literal', () => {
      const source = '/regex/ % w do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Coverage: regex after keyword', () => {
    test('should treat / after keyword as regex start', () => {
      // Tests isRegexStart finding keyword in REGEX_PRECEDING_KEYWORDS
      const source = `x = if /pattern/
  do_something
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Heredoc vs shift operator', () => {
    test('should not treat << after identifier as heredoc', () => {
      const source = `def foo
  a << EOF
  b = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still detect quoted heredoc after identifier', () => {
      const source = `a = x << ~'EOF'
line with end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect heredoc at line start', () => {
      const source = `x = <<EOF
if end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect heredoc after operator', () => {
      const source = `x = <<EOF
if end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: heredoc at EOF without newline', () => {
    test('should handle heredoc opener on last line without newline', () => {
      const source = 'x = <<~EOF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Dot-preceded keywords', () => {
    test('should not treat obj.class as block keyword', () => {
      const source = `x = obj.class
class Foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat obj.begin as block keyword', () => {
      const source = `x = obj.begin
begin
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat obj.end as block close', () => {
      const source = `def foo
  x = obj.end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat result.if as block keyword', () => {
      const source = `def foo
  x = result.if
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse real class alongside dot method calls', () => {
      const source = `x = obj.class
class Foo
  def bar
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'class', 0);
      assertNestLevel(pairs, 'def', 1);
    });

    test('should skip class after dot on previous line', () => {
      const pairs = parser.parse('def foo\n  obj.\n  class\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip end after dot on previous line', () => {
      const pairs = parser.parse('def foo\n  x = obj.\n  end\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip keyword after dot with CRLF line ending', () => {
      const pairs = parser.parse('def foo\r\n  obj.\r\n  class\r\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip class after dot with comment in between', () => {
      const pairs = parser.parse('def foo\n  obj. # comment\n  class\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip module after dot with comment in between', () => {
      const pairs = parser.parse('def foo\n  obj. # get module\n  module\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip keyword after safe navigation with comment', () => {
      const pairs = parser.parse('def foo\n  obj&. # safe nav\n  class\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should skip keyword after dot with multiple comment lines', () => {
      const pairs = parser.parse('def foo\n  obj. # first\n  # second\n  class\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: semicolon in postfix rescue check', () => {
    test('should treat rescue after semicolon as postfix', () => {
      const pairs = parser.parse('x = 1; y rescue nil');
      assertNoBlocks(pairs);
    });

    test('should not treat rescue after block keyword and semicolon as postfix', () => {
      const pairs = parser.parse('begin\n  x = 1; then rescue nil\nend');
      assertBlockCount(pairs, 1);
    });
  });

  suite('Coverage: nested strings in heredoc interpolation', () => {
    test('should handle double-quoted string in heredoc interpolation', () => {
      const pairs = parser.parse('x = <<-EOF\n  #{y = "hello"}\nEOF\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single-quoted string in heredoc interpolation', () => {
      const pairs = parser.parse("x = <<-EOF\n  #{y = 'hello'}\nEOF\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: nested strings in regex interpolation', () => {
    test('should handle double-quoted string in regex interpolation', () => {
      const pairs = parser.parse('x = /#{y = "hello"}/\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single-quoted string in regex interpolation', () => {
      const pairs = parser.parse("x = /#{y = 'hello'}/\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Interpolation with nested constructs', () => {
    test('should handle percent literal with braces inside interpolation', () => {
      const pairs = parser.parse('x = "result: #{%w{if end do}.join(\' \')}";\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle line comment inside multi-line interpolation', () => {
      const pairs = parser.parse('x = "value: #{\n  foo # closing brace: }\n}"\ndef bar\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Complex real-world scenario', () => {
    test('should exclude keywords in heredoc and detect outer block', () => {
      const source = `x = <<~RUBY
  if true
    puts "hello"
  end
RUBY
def foo
  yield
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle multi-line comment with CR-only endings', () => {
      const source = '=begin\rcomment content\r=end\rif true\r  action\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multiline regex with CR-only ending', () => {
      const source = 'x = /unterminated\rif true\r  action\rend';
      const pairs = parser.parse(source);
      // Multiline regex consumes everything until closing / or EOF
      assertNoBlocks(pairs);
    });

    test('should handle heredoc with CR-only endings', () => {
      const source = 'x = <<EOF\rheredoc content\rEOF\rif true\r  action\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment with \\r in skipInterpolation', () => {
      // Comment inside interpolation with \r line ending should stop at \r
      const source = '"#{x # comment\r}"\rif true\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle comment with \\r in skipRegexInterpolation', () => {
      // Comment inside regex interpolation with \r line ending should stop at \r
      const source = '/#{x # comment\r}/\rdef foo\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle unterminated nested regex with \\r in skipNestedRegex', () => {
      // With multiline regex support, unterminated regex inside interpolation
      // consumes past \r (Ruby regexes can be multiline), so the entire string is excluded
      const source = '"#{x = /unterminated\r}"\rif true\rend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Backtick string inside interpolation', () => {
    test('should handle backtick string inside #{} interpolation in string', () => {
      const source = '"result = #{`echo end`}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle backtick string inside #{} interpolation in regex', () => {
      const source = '/result = #{`echo end`}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: double-quoted symbol with interpolation', () => {
    test('should handle #{} interpolation inside double-quoted symbol', () => {
      const source = 'sym = :"value_#{x}_end"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipRegexInterpolation escape and percent', () => {
    test('should handle escape sequences inside regex interpolation', () => {
      const source = '/#{x = "\\n"}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle percent literal inside regex interpolation', () => {
      const source = '/#{%w(a b)}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: nested regex inside regex interpolation', () => {
    test('should handle regex containing } inside regex interpolation', () => {
      const source = '/#{/wor}ld/}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex with flags inside regex interpolation', () => {
      const source = '/#{/test/i}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex after operator inside regex interpolation', () => {
      const source = '/#{x = /pat}/}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: heredoc CRLF handling', () => {
    test('should handle heredoc with trailing CR in content line', () => {
      const source = 'x = <<EOF\rcontent line\r\nEOF\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipInterpolation percent literal', () => {
    test('should handle percent literal with braces inside string interpolation', () => {
      const source = '"#{%q{text}}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });
  });

  suite('Coverage: isSymbolStart with colon after colon', () => {
    test('should not treat second colon in :: as symbol start', () => {
      const source = 'Foo::Bar\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat colon followed by non-letter as symbol', () => {
      const source = 'x = : \ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: matchMultiLineComment edge cases', () => {
    test('should not match =begin followed by non-whitespace', () => {
      const source = '=beginx\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle =end at line start without proper prefix', () => {
      const source = '=begin\n=endfoo\nstill in comment\n=end\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: heredoc edge cases', () => {
    test('should handle heredoc with <<~ tilde prefix', () => {
      const source = 'x = <<~EOF\n  content\n  EOF\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle bare heredoc without dash or tilde', () => {
      const source = 'x = <<EOF\ncontent\nEOF\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from comment on heredoc opener line', () => {
      const source = 'x = <<END # <<END is a heredoc\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from string on heredoc opener line', () => {
      const source = 'x = <<END, "<<OTHER"\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from comment with different term', () => {
      const source = 'x = <<END # see <<HERE for reference\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still handle real multiple heredocs on same line', () => {
      const source = 'x = <<A + <<B\nfirst\nA\nsecond\nB\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: matchPercentLiteral interpolation flags', () => {
    test('should handle %q without interpolation', () => {
      const source = '%q(#{x})\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle %w without interpolation', () => {
      const source = '%w(#{x})\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle %i without interpolation', () => {
      const source = '%i(#{x})\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle %s without interpolation', () => {
      const source = '%s(#{x})\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: scope resolution filter', () => {
    test('should filter out begin preceded by :: scope resolution', () => {
      // Lines 85-87: source[token.startOffset - 1] === ':' && source[token.startOffset - 2] === ':'
      // Use lowercase keywords since Ruby is case-sensitive
      const source = 'x = Foo::begin\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should filter out end preceded by :: scope resolution', () => {
      const source = 'x = Module::end\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should filter out class preceded by :: scope resolution', () => {
      const source = 'x = Mod::class\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: heredoc gap scanning', () => {
    test('should scan gap for excluded regions between heredoc opener and content', () => {
      // Lines 341-342: gap scanning when result.start > i
      // The heredoc opener line has a comment after the heredoc start
      const source = 'x = <<~HEREDOC # comment with end\n  body text\nHEREDOC\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should scan gap for string between heredoc opener and content', () => {
      const source = 'x = <<~HEREDOC, "a string"\n  body text\nHEREDOC\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: paired delimiter in percent literals', () => {
    test('should handle %(...) paired delimiter', () => {
      // Lines 689-690: getMatchingDelimiter returns PAIRED_DELIMITERS value
      const source = '%(if end do)\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle %[...] paired delimiter', () => {
      const source = '%[if end while]\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle %{...} paired delimiter', () => {
      const source = '%{if end begin}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle %<...> paired delimiter', () => {
      const source = '%<if end module>\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: character literal escape sequences', () => {
    test('should handle ?\\ with non-special escape character as character literal', () => {
      // Line 351: escChar is not C, M, u, or x -> generic 3-char escape literal (?\X)
      const source = '?\\n\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\u{...} without closing brace', () => {
      // Line 342-343: closeIdx < 0 fallback (unterminated \\u{...})
      const source = '?\\u{1F600\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: getMatchingDelimiter edge cases', () => {
    test('should reject percent literal with alphanumeric delimiter', () => {
      const source = '%qa\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should reject percent literal with whitespace delimiter', () => {
      const source = '% \nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: __END__ edge cases', () => {
    test('should handle __END__ with trailing space', () => {
      const source = 'if true\nend\n__END__ \ndata section';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle __END__ with trailing tab', () => {
      const source = 'if true\nend\n__END__\t\ndata section';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: skipNestedBacktickString in skipRegexInterpolation', () => {
    test('should handle backtick string with nested interpolation inside regex interpolation', () => {
      const source = '/#{`cmd #{x}`}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: isRegexStart after keyword', () => {
    test('should detect regex after "return" keyword', () => {
      const source = 'def foo\n  return /pattern/\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipRegexInterpolation edge cases', () => {
    // Covers lines 503-505: escape sequences in regex interpolation
    test('should handle escape sequences inside regex interpolation', () => {
      const source = '/#{x = "\\n"}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: matchHeredoc CRLF handling', () => {
    // Covers lines 639-640: CRLF in heredoc content
    test('should handle CRLF line endings in heredoc content', () => {
      const source = '<<EOF\r\ncontent\r\nEOF\r\ndef foo\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: matchPercentLiteral with interpolation', () => {
    // Covers lines 723-725: interpolation in percent literal
    test('should handle interpolation in %Q percent literal', () => {
      const source = '%Q{hello #{name}}; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: matchBacktickString edge cases', () => {
    // Covers lines 767-769: escape and interpolation in backtick
    test('should handle escape sequences in backtick command', () => {
      const source = '`echo \\n`; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle interpolation in backtick command', () => {
      const source = '`echo #{var}`; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipInterpolation edge cases', () => {
    // Covers lines 784-786: escape sequences in interpolation
    test('should handle escape sequences inside interpolation', () => {
      const source = '"#{x = "\\t"}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipNestedRegex', () => {
    // Covers lines 850-851: regex flags in nested regex
    test('should handle regex with flags inside interpolation', () => {
      const source = '"#{/pattern/imxo}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 859-860: EOF in nested regex
    test('should handle unterminated regex at EOF in interpolation', () => {
      const source = '"#{/pattern'; // unterminated
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: skipNestedString', () => {
    // Covers lines 880-881: unterminated nested string
    test('should handle unterminated nested string in interpolation', () => {
      const source = '"#{"unterminated}"; def foo\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: skipNestedBacktickString', () => {
    // Covers lines 888-890: escape sequences in nested backtick
    test('should handle escape sequences in nested backtick', () => {
      const source = '"#{`cmd\\n`}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 900-901: unterminated nested backtick
    test('should handle unterminated nested backtick in interpolation', () => {
      const source = '"#{`unterminated}"; def foo\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers lines 503-505: backslash escape inside regex interpolation
  suite('Regex interpolation backslash escape', () => {
    test('should handle backslash escape inside regex interpolation', () => {
      const source = 'x = /#{a\\}b}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers line 639: heredoc content with CRLF line endings
  suite('Heredoc CRLF', () => {
    test('should handle heredoc with CRLF line endings', () => {
      const source = 'x = <<~HEREDOC\r\n  hello\r\nHEREDOC\r\ndef foo\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers line 686: isModuloOperator with only whitespace before percent
  suite('Percent literal at source start', () => {
    test('should handle percent literal at position 0', () => {
      const source = '%w(foo bar)\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle percent literal with only whitespace before', () => {
      const source = '  %w(foo bar)\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers lines 783-785: backslash escape inside skipInterpolation
  suite('Interpolation backslash escape', () => {
    test('should handle backslash escape in string interpolation', () => {
      const source = '"#{a\\}b}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers lines 880-881: unterminated nested regex in interpolation
  suite('Unterminated nested regex', () => {
    test('should handle unterminated nested regex in interpolation', () => {
      const source = '"#{/abc'; // source ends without closing /
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers line 829: isRegexInInterpolation whitespace-only before /
  suite('Coverage: regex in interpolation with whitespace before slash', () => {
    test('should treat / as regex when only whitespace follows #{', () => {
      const source = '"#{   /regex/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers line 880: skipNestedString unterminated string in interpolation
  suite('Coverage: unterminated nested string in interpolation', () => {
    test('should handle source ending inside nested string in interpolation', () => {
      const source = '"#{"abc';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Fix: postfix conditional after regex literal without flags
  suite('Postfix conditional after regex literal', () => {
    test('should treat if after /regex/ as postfix', () => {
      const source = 'def foo\n  x = /hello/ if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat unless after /regex/ as postfix', () => {
      const source = 'def foo\n  puts /pattern/ unless condition\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat while after /regex/ as postfix', () => {
      const source = 'def foo\n  x = /test/ while running\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat if after regex with flags as postfix', () => {
      const source = 'def foo\n  x = /hello/i if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat if after division operator as block open', () => {
      const source = 'x = a / if true then 1 else 2 end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 11: multiline regex should be treated as excluded region', () => {
      const source = `x = /
if true
end
/
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 12: heredoc after ) should be recognized', () => {
      const source = `x = foo() <<HEREDOC
if true
end
HEREDOC
def bar
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 4: heredoc identifier matching block keyword should not be treated as keyword', () => {
      const pairs = parser.parse('def foo\n  x = <<end\n  content\nend\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 4: heredoc with tilde flag and block keyword identifier', () => {
      const pairs = parser.parse('def foo\n  x = <<~do\n  content\ndo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('Bug 15: symbol with ? should not hide adjacent keyword', () => {
      const pairs = parser.parse('x = :end?\nif true\n  y = 1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 15: symbol with ! should not hide adjacent keyword', () => {
      const pairs = parser.parse('x = :save!\nif true\n  y = 1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Multibyte character literals', () => {
    test('should handle BMP multibyte character literal', () => {
      const source = 'x = ?\u3042\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle surrogate pair character literal', () => {
      const source = 'x = ?\u{1F600}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Character literal multi-char escape sequences', () => {
    test('should handle ?\\C-x control character', () => {
      const source = 'x = ?\\C-a\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\M-x meta character', () => {
      const source = 'x = ?\\M-a\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\M-\\C-x meta-control character', () => {
      const source = 'x = ?\\M-\\C-a\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\uXXXX unicode escape', () => {
      const source = 'x = ?\\u0041\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\u{...} unicode escape', () => {
      const source = 'x = ?\\u{1F600}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle ?\\xNN hex escape', () => {
      const source = 'x = ?\\x41\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should handle \\r stripping in heredoc content lines', () => {
      // Covers lines 713-715: \r stripping in heredoc content
      const source = 'x = <<HEREDOC\r\nline1\r\nHEREDOC\r\nif true\r\n  1\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc with CR-only line endings in terminator scan', () => {
      // rubyExcluded.ts: heredoc terminator matching with CR line endings
      const source = 'x = <<~HEREDOC\r  content with if end\rHEREDOC\rif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle two-terminator heredoc (squiggly) with CRLF', () => {
      // rubyExcluded.ts: multi-terminator heredoc with CRLF
      const source = 'x = <<~HEREDOC\r\n  begin\r\nHEREDOC\r\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc inside #{} interpolation with CRLF line endings (lines 651-652)', () => {
      // rubyParser.ts skipInterpolation: heredocSkipEnd > i && source[i] === '\r' && next === '\n'
      // CRLF line ending inside #{} where there's a heredoc: i += 2 path
      const source = '"#{<<-HEREDOC}\r\n  content with }\r\nHEREDOC\r\n"\r\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc inside #{} interpolation with CR-only line endings (lines 653-655)', () => {
      // rubyParser.ts skipInterpolation: heredocSkipEnd > i && source[i] === '\r' without '\n'
      // CR-only path: i++ then jump to heredocSkipEnd
      const source = '"#{<<-HEREDOC}\r  content with }\rHEREDOC\r"\rif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc opener line with string containing backslash escape (parserUtils line 70)', () => {
      // findLineCommentAndStringRegions: string with \" escape triggers backslash skip path
      // The heredoc opener line has a string with escaped quote before <<HEREDOC
      // The 'if true' inside heredoc is excluded, so no block pair is formed
      const source = 'foo("say \\"hi\\"", <<HEREDOC)\nif true\nHEREDOC\nif false\nend';
      const pairs = parser.parse(source);
      // 'if false' after HEREDOC is the real block opener
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc inside interpolation where body is skipped at newline (lines 651-659)', () => {
      // Covers lines 650-659: heredoc skip during skipInterpolation
      // The heredoc opener is inside #{}, and the } closing brace is AFTER the heredoc body
      // so the heredoc body skip logic at line break is actually triggered
      const source = '"#{<<HEREDOC\ncontent\nHEREDOC\n}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Bug 1: backslash line continuation', () => {
    test('should treat if after backslash continuation as postfix', () => {
      const source = 'result = foo \\\nif condition';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat unless after backslash continuation as postfix', () => {
      const source = 'result = bar \\\nunless done';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat rescue after backslash continuation as postfix', () => {
      const source = 'value = dangerous_call \\\nrescue fallback';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat do after loop keyword with backslash continuation as loop do', () => {
      const source = 'while condition \\\ndo\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not affect normal line without continuation', () => {
      const source = 'if true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 2: findLogicalLineStart should not follow backslash in comments', () => {
    test('should not treat comment ending with backslash as line continuation for if', () => {
      // A comment like "# see C:\" ends with \, but it is in an excluded region
      const source = '# see C:\\\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat comment ending with backslash as line continuation for rescue', () => {
      const source = '# path: C:\\\nbegin\n  risky\nrescue\n  safe\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });

    test('should not treat comment ending with backslash as line continuation for loop do', () => {
      const source = '# backslash \\\nwhile true do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Bug 3: backslash continuation characters in beforeKeyword text', () => {
    test('should strip continuation in postfix conditional check', () => {
      // "do \\\n" joins to become "do " after stripping, so if is not postfix
      const source = 'items.each do \\\nif cond\n  x\nend\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should strip continuation in postfix rescue check', () => {
      // "begin \\\n" joins to become "begin " after stripping, so rescue is not postfix
      const source = 'begin \\\nrescue\n  nil\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
  });

  suite('Bug 6: heredoc inside string interpolation', () => {
    test('should handle heredoc inside #{} interpolation where body contains }', () => {
      // Heredoc inside interpolation with } in body should not break brace tracking
      const source = '"#{<<~HEREDOC}\n  content with }\nHEREDOC\n"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 12: unterminated ?\\u{ char literal scan', () => {
    test('should not scan entire source for } on unterminated ?\\u{', () => {
      // Unterminated ?\u{ should stop at line break, not consume everything until }
      const source = '?\\u{\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 4: keywords in $, @, @@ variable names', () => {
    test('should not detect end in $end variable', () => {
      const source = '$end = 1\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not detect if in @if instance variable', () => {
      const source = '@if = true\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not detect do in @@do class variable', () => {
      const source = '@@do = nil\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not detect begin in $begin global variable', () => {
      const source = '$begin = Time.now\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Bug: backslash continuation index mapping in postfix detection', () => {
    test('should detect block if after semicolon with backslash continuation before it', () => {
      const source = 'x = \\\n";"; if condition\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect block rescue after semicolon with backslash continuation', () => {
      const source = 'x = \\\n";"; begin\n  risky\nrescue\n  handle\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue']);
    });
  });

  // Regression: isRegexInInterpolation should recognize +, -, *, %, <, >, ^, ? as operators
  suite('Regression: regex after arithmetic/comparison operators in interpolation', () => {
    test('should treat / as regex after + in interpolation', () => {
      const source = '"#{x + /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after - in interpolation', () => {
      const source = '"#{x - /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after * in interpolation', () => {
      const source = '"#{x * /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after % in interpolation', () => {
      const source = '"#{x % /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after < in interpolation', () => {
      const source = '"#{x < /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after > in interpolation', () => {
      const source = '"#{x > /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after ^ in interpolation', () => {
      const source = '"#{x ^ /pattern/}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after ? in interpolation (ternary)', () => {
      const source = '"#{cond ? /pattern/ : nil}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: keyword followed by == != === =~', () => {
    test('should detect end followed by == as block close', () => {
      const source = 'result = if condition\n  value\nend == expected';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect end followed by != as block close', () => {
      const source = 'result = if condition\n  value\nend != other';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect end followed by === as block close', () => {
      const source = 'result = if condition\n  value\nend === expected';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect end followed by =~ as block close', () => {
      const source = 'result = if condition\n  value\nend =~ /pattern/';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still filter out method names with = suffix', () => {
      const source = 'def foo\n  obj.end = 42\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect end followed by != without spaces', () => {
      const source = 'result = if condition\n  value\nend!=other';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still filter out method names with ! suffix', () => {
      const source = 'def foo\n  end!\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect end followed by => as block close', () => {
      const source = 'result = if condition\n  value\nend => variable';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: multiline regex inside interpolation', () => {
    test('should handle multiline regex with braces inside interpolation', () => {
      const source = '"#{/pattern{\nmatch}/}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle multiline regex inside interpolation without braces', () => {
      const source = '"#{/foo\nbar/}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: ?\\xN single hex digit char literal', () => {
    test('should handle single hex digit char literal followed by keyword', () => {
      const source = '?\\x1\nif true\n  puts "hello"\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single hex digit char literal immediately before keyword', () => {
      const source = 'x = ?\\x1\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still handle two hex digit char literal', () => {
      const source = '?\\xFF\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: percent literals after identifiers', () => {
    test('should exclude keywords inside %w[] after identifier', () => {
      const source = 'puts %w[if do end]';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should exclude keywords inside %q{} after identifier', () => {
      const source = 'raise %q{if then end do}';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Branch coverage: heredoc with escaped quotes in strings on indent line', () => {
    test('should handle backslash escape in string on heredoc start line', () => {
      const source = 'x = <<~HEREDOC, "hello \\"world\\""\n  content\nHEREDOC\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: keyword= method names (not block keywords)', () => {
    test('should not treat do= as block keyword when not preceded by dot', () => {
      // self.do= would be caught by dot check; use bare method definition context
      const source = 'def foo\n  do=5\nend';
      const pairs = parser.parse(source);
      // do= is a method name assignment, not a block keyword; only def/end matched
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat end= as block keyword when not preceded by dot', () => {
      const source = 'def foo\n  end=3\n  x\nend';
      const pairs = parser.parse(source);
      // end= is a method name, not block close; def/end is the only pair
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still treat do== as block keyword followed by ==', () => {
      const source = 'items.each do==nil\nend';
      const pairs = parser.parse(source);
      // do== means do followed by ==, so do is still a block keyword
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should still treat do=~ as block keyword followed by =~', () => {
      const source = 'items.each do=~/pattern/\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should still treat do=> as block keyword followed by =>', () => {
      const source = 'items.each do=>:value\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Regression: heredoc in interpolation closing on opener line', () => {
    test('should handle heredoc in string interpolation where } follows on same line', () => {
      // When heredoc starts inside #{...} and } is on the same line as <<HEREDOC,
      // the heredoc body extends past the }, so the excluded region must cover it
      const source = '"#{<<~HEREDOC}"\n  if true\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc in backtick interpolation where } follows on same line', () => {
      const source = '`#{<<~HEREDOC}`\n  if true\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc in percent literal interpolation where } follows on same line', () => {
      const source = '%Q(#{<<~HEREDOC})\n  if true\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: %{...} percent literal without specifier', () => {
    test('should treat %{text} as percent literal not modulo', () => {
      const source = 'puts %{if end}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat %(text) as percent literal not modulo', () => {
      const source = 'raise %(if end)\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat %[text] as percent literal not modulo', () => {
      const source = 'x = %[if end]\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still treat % after number as modulo', () => {
      const source = 'x = 10 % 3\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: non-paired percent literal without specifier', () => {
    test('should exclude keywords inside non-paired percent literal after identifier', () => {
      const pairs = parser.parse('puts %|if end|\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: heredoc CRLF line endings in interpolation', () => {
    test('should handle heredoc body skip with CRLF in interpolation', () => {
      const source = '"#{<<~HEREDOC\r\nbody\r\nHEREDOC\r\n}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Branch coverage: CRLF backslash continuation', () => {
    test('should handle backslash continuation with CRLF line endings', () => {
      // Covers rubyParser.ts line 153: CRLF pair detection in backslash continuation
      const source = 'x = 1 \\\r\nif true\r\n  y = 2\r\nend';
      const pairs = parser.parse(source);
      // Backslash continuation makes 'if' a postfix modifier (not a block open)
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: percent literal on heredoc opener line', () => {
    test('should not treat << inside percent literal on heredoc line as heredoc', () => {
      const pairs = parser.parse('x = <<EOF + %w[<<BAR]\ncontent\nEOF\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: character literal in interpolation', () => {
    test("should handle character literal ?' inside string interpolation", () => {
      const pairs = parser.parse('"#{?\'}";\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: << shift operator vs heredoc in tokenize filter', () => {
    test('should not filter keyword after << shift operator', () => {
      const pairs = parser.parse('1 <<if true\n  2\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: ?# and ?/ character literals in interpolation', () => {
    test('should not treat ?# as comment start inside interpolation', () => {
      const pairs = parser.parse('"#{?# }"\nif true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?/ as regex start inside interpolation', () => {
      const pairs = parser.parse('"#{?/}"\nif true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?% as percent literal start inside interpolation', () => {
      const pairs = parser.parse('"#{?%}"\nif true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?< as heredoc operator inside interpolation', () => {
      const pairs = parser.parse('"#{?<}"\nif true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isPostfixRescue missing not/and/or', () => {
    test('should not treat rescue after not as postfix', () => {
      const pairs = parser.parse('begin\n  not rescue nil\nend');
      const block = findBlock(pairs, 'begin');
      assertIntermediates(block, ['rescue']);
    });

    test('should not treat rescue after and as postfix', () => {
      const pairs = parser.parse('begin\n  x and rescue nil\nend');
      const block = findBlock(pairs, 'begin');
      assertIntermediates(block, ['rescue']);
    });

    test('should not treat rescue after or as postfix', () => {
      const pairs = parser.parse('begin\n  x or rescue nil\nend');
      const block = findBlock(pairs, 'begin');
      assertIntermediates(block, ['rescue']);
    });
  });

  suite('Regression: ?\\u{ unterminated escape', () => {
    test('should cover ?\\u{ in excluded region', () => {
      const regions = parser.getExcludedRegions('?\\u{');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end - regions[0].start, 4);
    });
  });

  suite('Coverage: findLineCommentAndStringRegions percent literal and regex paths', () => {
    test('should handle paired percent literal with backslash escape on heredoc opener line', () => {
      // Triggers skipPairedPercentLiteral backslash escape path (parserUtils lines 52-54)
      // The %w[...] contains a backslash escape inside paired delimiters
      const source = 'x = <<HEREDOC, %w[a\\ b c]\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle paired percent literal with nested open delimiter on heredoc opener line', () => {
      // Triggers skipPairedPercentLiteral nested depth++ path (parserUtils line 56)
      // %w(a (b) c) has nested parentheses inside the paired delimiter
      const source = 'x = <<HEREDOC, %w(a (b) c)\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle non-paired percent literal with backslash escape on heredoc opener line', () => {
      // Triggers non-paired delimiter percent literal path (parserUtils lines 123-131)
      // %|...| uses pipe as non-paired delimiter, with a backslash escape inside
      const source = 'x = <<HEREDOC, %|a\\|b|\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle non-paired percent literal without specifier on heredoc opener line', () => {
      // Triggers non-paired delimiter percent literal path (parserUtils lines 123-131)
      // %!...! uses exclamation mark as non-paired delimiter
      const source = 'x = <<HEREDOC, %!hello!\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle regex literal on heredoc opener line', () => {
      // Triggers regex literal path (parserUtils lines 140-152)
      // /.../ regex on the same line as heredoc opener
      const source = 'x = <<HEREDOC if /pattern/\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle regex literal with backslash escape on heredoc opener line', () => {
      // Triggers regex literal backslash escape path (parserUtils lines 143-146)
      // /.../ regex with escaped slash inside
      const source = 'x = <<HEREDOC if /pat\\/tern/\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat << inside regex literal on heredoc opener line as heredoc', () => {
      // Regex literal on the heredoc opener line contains <<FOO which should be excluded
      const source = 'x = <<HEREDOC, /<<FOO/\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat << inside non-paired percent literal on heredoc opener line as heredoc', () => {
      // Non-paired percent literal on heredoc line contains <<BAR
      const source = 'x = <<HEREDOC, %|<<BAR|\n  content\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: heredoc identifier with backtick quote', () => {
    test('should filter keyword used as backtick-quoted heredoc identifier', () => {
      // Covers rubyParser.ts lines 101-102: backtick closing quote after heredoc identifier
      const source = 'x = <<`end`\necho hello\nend\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: heredoc identifier with CRLF', () => {
    test('should filter heredoc keyword with CRLF line ending', () => {
      // Covers rubyParser.ts line 111: CRLF line ending in heredoc tokenize filter
      const source = 'x = <<end\r\nheredoc body\r\nend\r\nif true\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: unterminated double-quoted symbol', () => {
    test('should handle unterminated double-quoted symbol literal', () => {
      // Covers rubyParser.ts lines 595-596: unterminated :"..." symbol
      const source = ':"unterminated symbol';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
    });
  });

  suite('Branch coverage: character literal in regex interpolation', () => {
    test('should handle ?-prefixed special characters in regex interpolation', () => {
      // Covers rubyFamilyHelpers.ts lines 406, 408-410: character literal in skipRegexInterpolationShared
      const source = "/#{?'}/\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: character literal \\C-x at source boundary', () => {
    test('should handle ?\\C- at end of source with no character after dash', () => {
      // Covers rubyParser.ts lines 445-446: pos + 4 < source.length is false
      // ?\C- with no character after the dash, only 4 chars total
      const source = '?\\C-';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
    });

    test('should not affect block parsing when ?\\C- is at end of source', () => {
      const source = 'if true\nend\n?\\C-';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: unterminated symbol with heredoc extending past end', () => {
    test('should extend symbol excluded region when heredoc pendingEnd exceeds source length', () => {
      // Covers rubyParser.ts lines 598-599: heredocState.pendingEnd > i in unterminated symbol
      // An unterminated :"..." symbol where interpolation contains heredoc
      // that extends past the end of the scanning loop
      const source = ':"#{<<~EOF}\nheredoc body\nEOF';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      // The symbol region should extend to cover the heredoc body
      const symbolRegion = regions.find((r) => r.start === 0);
      assert.ok(symbolRegion !== undefined);
      assert.ok(symbolRegion.end > 10);
    });
  });

  suite('Branch coverage: CRLF in findLogicalLineStart', () => {
    test('should follow backslash continuation across CRLF line endings', () => {
      // Covers rubyParser.ts line 176: prevChar === '\\n' && checkPos > 0 && source[checkPos - 1] === '\\r'
      // Backslash continuation with CRLF should merge logical lines
      const source = 'x = 1 +\\\r\n2 if true\nend';
      const pairs = parser.parse(source);
      // "x = 1 + 2 if true" has content before 'if', so it's postfix
      assertNoBlocks(pairs);
    });

    test('should handle multiple backslash continuations with CRLF', () => {
      const source = 'x = 1 +\\\r\n2 +\\\r\n3 if true\nend';
      const pairs = parser.parse(source);
      // Postfix if on continued line
      assertNoBlocks(pairs);
    });
  });

  suite('Branch coverage: character literal ? at start of string interpolation', () => {
    test('should handle ?-prefixed char literal at the very start of interpolation', () => {
      // Covers rubyFamilyHelpers.ts line 324: i - 1 === pos branch in skipInterpolationShared
      // When ? is the very first char inside #{...}, i - 1 === pos is true
      const source = '"#{?\'}" if true\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: isLoopDo should filter dot-prefixed do in inner scan', () => {
    test('should treat while x.do do as while loop with do separator', () => {
      // Bug: isLoopDo inner do scanning did not filter dot-prefixed do,
      // so x.do was mistakenly treated as the loop's do keyword
      const source = 'while x.do do\nputs x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Regression: scope resolution :: should not be filtered as hash key syntax
  suite('Regression: scope resolution operator ::', () => {
    test('should not filter end:: as hash key', () => {
      const source = 'result = if true\n  1\nend::to_s';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still filter end: as hash key', () => {
      const source = '{ end: 1 }';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug: heredoc inside regex interpolation', () => {
    test('should exclude heredoc body keywords inside regex interpolation', () => {
      const source = '/#{<<~EOF}/\n  if true\n  end\nEOF\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: postfix conditional across backslash continuation', () => {
    test('should detect postfix if after regex across line continuation', () => {
      const source = 'def foo\n  x = /pattern/ \\\nif condition\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect postfix unless after regex across line continuation', () => {
      const source = 'def foo\n  x = /pattern/ \\\nunless condition\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: $`, $\', $" global variables', () => {
    test('should not treat $` as backtick string start', () => {
      const pairs = parser.parse('def foo\n  puts $`\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test("should not treat $' as single-quoted string start", () => {
      const pairs = parser.parse("$'\ndef foo\nend");
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat $" as double-quoted string start', () => {
      const pairs = parser.parse('x = $"\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: $; global variable semicolon', () => {
    test('should not treat $; semicolon as statement separator for postfix if', () => {
      const pairs = parser.parse('def foo\n  puts $; if true\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat $; semicolon as statement separator for postfix rescue', () => {
      const pairs = parser.parse('begin\n  $; rescue nil\nend');
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should not treat $; semicolon as statement separator for loop do', () => {
      const pairs = parser.parse('x = $; while true do\n  body\nend');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: $$ global variable semicolon', () => {
    test('should recognize semicolon after $$ as statement separator', () => {
      const pairs = parser.parse('$$; if true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug: dot-space-keyword not filtered as method call', () => {
    test('should not treat obj. end (dot space end) as block close', () => {
      // Ruby allows whitespace between dot and method name: obj. end means obj.end()
      // The incorrect end at line 1 should not close the def block
      const pairs = parser.parse('def foo\n  obj. end\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat obj. if as block opener inside def', () => {
      // obj. if(cond) is a method call, not a block if
      // Without fix: produces 2 pairs (if/end:1, def/end:0) instead of 1 pair (def/end)
      const pairs = parser.parse('def bar\n  obj. if true\n    body\n  end\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat obj.  end with multiple spaces as block close', () => {
      const pairs = parser.parse('def foo\n  obj.  end\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat obj.\\tend with tab as block close', () => {
      const pairs = parser.parse('def foo\n  obj.\tend\nend');
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression tests', () => {
    test('should treat / after division operator as regex start', () => {
      const pairs = parser.parse('def foo\n  n = 10 / /if end/\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude regex after division with block keywords inside', () => {
      const pairs = parser.parse('def foo\n  n = 10 / /begin/\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: heredoc in string interpolation with string closing on same line', () => {
    test('should exclude heredoc body when heredoc opens in interpolation and string closes on same line', () => {
      const pairs = parser.parse('"#{<<~HEREDOC}"\n  if true\n  end\nHEREDOC\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: implicit line continuation with binary operators in loop-do', () => {
    test('should treat do after while with && continuation as loop do', () => {
      const source = 'while cond &&\n  other do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should treat do after until with || continuation as loop do', () => {
      const source = 'until x ||\n  y do\n  puts x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'until', 'end');
    });

    test('should treat do after for with comma continuation as loop do', () => {
      const source = 'for x in foo(a,\n  b) do\n  puts x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should treat do after while with dot continuation as loop do', () => {
      const source = 'while cond.\n  ready? do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should treat do after while with single | continuation as loop do', () => {
      const source = 'while flags |\n  mask do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not treat range operator (..) as dot continuation', () => {
      const source = 'x = (1..\n10)\nwhile true do\n  break\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not follow continuation into excluded regions', () => {
      const source = '# trailing &&\nwhile true do\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Regression: backslash as percent literal delimiter', () => {
    test('should handle backslash as percent literal delimiter', () => {
      const source = '%q\\if end\\\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle %Q with backslash delimiter', () => {
      const source = '%Q\\do while until\\\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: %r percent regex literal flags', () => {
    test('should not detect flags after %r as tokens', () => {
      const source = '%r{pattern}imx';
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 0);
    });

    test('should include single regex flag in %r excluded region', () => {
      const source = '%r{pattern}i';
      const regions = parser.getExcludedRegions(source);
      // The excluded region should cover '%r{pattern}i' (flags included)
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should include multi-character regex flags in %r excluded region', () => {
      const source = '%r{pattern}imx';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should exclude in as flag after %r preventing false intermediate', () => {
      // 'in' immediately after %r is treated as regex flags, not as keyword
      const source = 'for x %r{pat}in arr\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
      const block = findBlock(pairs, 'for');
      // 'in' is consumed as regex flag, not detected as intermediate
      assertIntermediates(block, []);
    });

    test('should not scan flags for non-regex percent literals', () => {
      const source = '%q{pattern}imx';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      // %q should NOT include trailing letters as flags
      assert.strictEqual(regions[0].end, '%q{pattern}'.length);
    });
  });

  suite('Regression: ?$ and $$ before string delimiter', () => {
    test('should not break string detection after ?$ char literal', () => {
      const pairs = parser.parse('?$"if end"\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not break string detection after $$ global variable', () => {
      const pairs = parser.parse('$$"if end"\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not break string detection after ?\\$ char literal', () => {
      const pairs = parser.parse('?\\$"if end"\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: ?/ char literal before division', () => {
    test('should treat / as division after ?/ char literal', () => {
      const pairs = parser.parse('?/ / 2\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / as division after ?! char literal', () => {
      const pairs = parser.parse('?! / 2\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: range operator as line continuation', () => {
    test('should treat .. as line continuation for while-do', () => {
      const pairs = parser.parse('while x ..\n  y do\n  body\nend');
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should treat ... as line continuation for while-do', () => {
      const pairs = parser.parse('while x ...\n  y do\n  body\nend');
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Regression: keywords as method names after def', () => {
    test('should not treat do after def as block opener', () => {
      const pairs = parser.parse('class Foo\n  def do\n    1\n  end\nend');
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'class'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'def'));
    });

    test('should not treat end after def as block closer', () => {
      const pairs = parser.parse('def end\n  1\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: double percent should not create unterminated literal', () => {
    test('should detect if/end after %% in expression', () => {
      const pairs = parser.parse('x = 5 %% 2\nif true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: second regex on same line should be excluded', () => {
    test('should not tokenize keywords inside second regex literal', () => {
      const pairs = parser.parse('/regex1/ /if end/\ndef foo\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle regex after regex with keywords', () => {
      const pairs = parser.parse('/a/ /while true do end/\ndef bar\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: regex after heredoc misclassified as division', () => {
    test('should exclude regex literal on line after heredoc terminator', () => {
      const pairs = parser.parse('<<EOF\ncontent\nEOF\n/do end/\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude regex after indented heredoc terminator', () => {
      const pairs = parser.parse('<<~EOF\n  content\n  EOF\n/do end/\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-04-11: Ruby 3.0+ endless method definitions', () => {
    test('should not treat endless def as a block opener', () => {
      const pairs = parser.parse('class X\n  def a = 1\nend');
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat endless def with self receiver as block opener', () => {
      const pairs = parser.parse('class X\n  def self.foo = 42\nend');
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should still treat normal def as a block opener alongside endless def', () => {
      const pairs = parser.parse('class X\n  def a = 1\n  def b\n    1\n  end\nend');
      assert.strictEqual(pairs.length, 2);
      const classPair = pairs.find((p) => p.openKeyword.value === 'class');
      const defPair = pairs.find((p) => p.openKeyword.value === 'def');
      assert.ok(classPair);
      assert.ok(defPair);
    });

    test('should still treat normal def as a block opener', () => {
      const pairs = parser.parse('class X\n  def foo\n    1\n  end\nend');
      assert.strictEqual(pairs.length, 2);
    });
  });

  suite('Regression: multi-heredoc with bare delimiters after identifier', () => {
    test('should accept bare multi-heredoc list after identifier', () => {
      const source = 'raise <<A, <<A\nfirst\nA\nif true\nelse\nend\nA\ndef foo\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: heredoc after bare method call (no parens)', () => {
    test('should accept <<EOF after identifier with space as heredoc', () => {
      const source = 'puts <<DONE\nif true\nend\nDONE\ndef foo\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude heredoc body for bare method call form', () => {
      const source = 'puts <<EOF\nhello world\nEOF\n';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0, 'expected heredoc region');
    });

    test('should still reject <<keyword as shift (not heredoc)', () => {
      const source = '1 <<if true\n  2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should accept bare <<END as heredoc terminator after identifier with space', () => {
      const source = 'puts <<END\nif x\n  y\nend\nEND\ndef foo\n  1\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should accept bare <<BEGIN as heredoc terminator after identifier with space', () => {
      const source = 'raise <<BEGIN\n  body\nBEGIN\ndef foo\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude heredoc body when terminator is END', () => {
      const source = 'raise <<END\nInvalid argument.\nEND\n';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0, 'expected heredoc region for bare <<END form');
    });
  });

  generateCommonTests(config);
});
