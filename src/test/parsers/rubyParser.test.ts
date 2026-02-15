import * as assert from 'node:assert';
import { RubyBlockParser } from '../../parsers/rubyParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokens,
  findBlock
} from '../helpers/parserTestHelpers';

suite('RubyBlockParser Test Suite', () => {
  let parser: RubyBlockParser;

  setup(() => {
    parser = new RubyBlockParser();
  });

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
      assertSingleBlock(pairs, 'if', 'end', 0);
    });

    test('should treat while after and as block, not postfix', () => {
      const pairs = parser.parse('x = 1 and while condition\n  body\nend');
      assertSingleBlock(pairs, 'while', 'end', 0);
    });

    test('should treat unless after or as block, not postfix', () => {
      const pairs = parser.parse('x = 1 or unless condition\n  body\nend');
      assertSingleBlock(pairs, 'unless', 'end', 0);
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
    test('should ignore keywords in single-line comments', () => {
      const source = '# if end\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

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

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in double-quoted strings', () => {
      const source = 'x = "if end"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in single-quoted strings', () => {
      const source = "x = 'begin end'\ndef foo\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle escaped quotes in strings', () => {
      const source = 'x = "say \\"if\\" end"\ndef foo\nend';
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

  suite('Division after ? and ! method names', () => {
    test('should treat / after method ending with ? as division', () => {
      const source = `x = foo? / 2
if true
  y = 1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
    test('should handle #{} interpolation with nested double quotes', () => {
      const source = 'x = "#{if true then "yes" else "no" end}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle nested #{} interpolation', () => {
      const source = 'x = "outer #{a + "inner #{b}" + c}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle #{} with block keywords inside', () => {
      const source = '"result: #{if x\n  y\nend}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle empty interpolation', () => {
      const source = 'x = "value: #{}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle interpolation with braces', () => {
      const source = 'x = "#{hash = {a: 1}}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should still parse blocks outside interpolated strings', () => {
      const source = '"#{x}"\nif true\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'if', 'end');
    });
  });

  suite('Excluded regions - Regex interpolation', () => {
    test('should handle #{} interpolation inside regex', () => {
      const source = 'x = /start_#{var}_end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle #{} with slash inside regex interpolation', () => {
      const source = 'x = /start_#{get_pattern("/")}_end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle #{} with nested braces inside regex', () => {
      const source = 'x = /prefix_#{hash = {a: 1}}_suffix/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle multiple #{} interpolations in regex', () => {
      const source = 'x = /#{a}_#{b}_#{c}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle empty #{} interpolation in regex', () => {
      const source = 'x = /pattern_#{}end/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
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
    suite('General', () => {
      test('should handle empty source', () => {
        const pairs = parser.parse('');
        assertNoBlocks(pairs);
      });

      test('should handle source with no blocks', () => {
        const pairs = parser.parse('puts "hello world"');
        assertNoBlocks(pairs);
      });

      test('should handle for-end block', () => {
        const source = `for i in 1..10
  puts i
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'end');
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

      test('should handle unterminated regex (newline before closing)', () => {
        const source = `/unterminated regex
def foo
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
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
        assertSingleBlock(pairs, 'do', 'end', 0);
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

    suite('CR-only line endings', () => {
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
  });

  suite('Rescue modifier', () => {
    test('should not treat inline rescue as intermediate', () => {
      const pairs = parser.parse('def foo\n  risky rescue nil\nend');
      assertSingleBlock(pairs, 'def', 'end', 0);
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should still treat rescue as intermediate in begin block', () => {
      const pairs = parser.parse('begin\n  risky\nrescue\n  handle\nend');
      assertSingleBlock(pairs, 'begin', 'end', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `def foo
  if bar
  end
end`;
      const pairs = parser.parse(source);
      const defPair = findBlock(pairs, 'def');
      const ifPair = findBlock(pairs, 'if');

      assert.strictEqual(defPair.openKeyword.line, 0);
      assert.strictEqual(defPair.openKeyword.column, 0);
      assert.strictEqual(ifPair.openKeyword.line, 1);
      assert.strictEqual(ifPair.openKeyword.column, 2);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = 'def foo\nend';
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [{ value: 'def' }, { value: 'end' }]);
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = '"string" # comment\ndef foo\nend';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 8);
      assert.strictEqual(regions[1].start, 9);
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

    test('should handle unterminated regex with CR-only ending', () => {
      const source = 'x = /unterminated\rif true\r  action\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc with CR-only endings', () => {
      const source = 'x = <<EOF\rheredoc content\rEOF\rif true\r  action\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });
});
