import * as assert from 'node:assert';
import { CrystalBlockParser } from '../../parsers/crystalParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('CrystalBlockParser Test Suite', () => {
  let parser: CrystalBlockParser;

  setup(() => {
    parser = new CrystalBlockParser();
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
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should parse def-end block', () => {
      const source = `def my_method
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should parse class-end block', () => {
      const source = `class MyClass
  def initialize
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });

    test('should parse module-end block', () => {
      const source = `module MyModule
  def my_method
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Crystal-specific keywords', () => {
    test('should parse struct-end block', () => {
      const source = `struct Point
  property x : Int32
  property y : Int32
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'struct', 'end');
    });

    test('should parse enum-end block', () => {
      const source = `enum Color
  Red
  Green
  Blue
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'enum', 'end');
    });

    test('should parse macro-end block', () => {
      const source = `macro my_macro(name)
  {{name.id}}
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'macro', 'end');
    });

    test('should parse lib-end block', () => {
      const source = `lib LibC
  type SizeT = UInt64
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'lib', 'end');
    });

    test('should parse union-end block', () => {
      const source = `union IntOrFloat
  value_i : Int32
  value_f : Float32
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'union', 'end');
    });

    test('should parse annotation-end block', () => {
      const source = `annotation MyAnnotation
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'annotation', 'end');
    });

    test('should parse select-end block', () => {
      const source = `select
when ch1.receive
  puts "received from ch1"
when ch2.receive
  puts "received from ch2"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else-end block', () => {
      const source = `if condition
  action1
else
  action2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse if-elsif-else-end block', () => {
      const source = `if cond1
  action1
elsif cond2
  action2
else
  action3
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['elsif', 'else']);
    });

    test('should parse begin-rescue-ensure-end block', () => {
      const source = `begin
  risky_operation
rescue ex
  handle_error(ex)
ensure
  cleanup
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['rescue', 'ensure']);
    });

    test('should parse case-when-else-end block', () => {
      const source = `case value
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
      const source = `class MyClass
  def my_method
    if condition
      action
    end
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });
  });

  suite('Excluded regions - Comments', () => {
    test('should ignore keywords in single-line comments', () => {
      const source = `# if condition do end
def real_method
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in double-quoted strings', () => {
      const source = `x = "if end while"
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore keywords in single-quoted char literals', () => {
      const source = `ch = 'e'
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle escaped quotes in strings', () => {
      const source = `msg = "he said \\"if\\" and \\"end\\""
if condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle hex escape in char literal', () => {
      // '\x41' is a valid Crystal char literal (hex for 'A')
      const pairs = parser.parse("x = '\\x41'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end', 0);
    });

    test('should handle octal escape in char literal', () => {
      // '\o101' is a valid Crystal char literal (octal for 'A')
      const pairs = parser.parse("x = '\\o101'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end', 0);
    });

    test('should handle legacy octal escape in char literal', () => {
      // '\101' is a valid Crystal char literal (legacy octal for 'A')
      const pairs = parser.parse("x = '\\101'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end', 0);
    });
  });

  suite('Excluded regions - Heredocs', () => {
    test('should ignore keywords in heredocs', () => {
      const source = `text = <<-HEREDOC
if true
  do something
end
HEREDOC
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.line, 5);
    });

    test('should ignore keywords in comment on heredoc start line', () => {
      const source = `x = <<-HEREDOC # if end
  body
HEREDOC
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not exclude code after heredoc marker on same line', () => {
      const source = `x = <<-EOF + do_something
heredoc content
EOF`;
      const regions = parser.getExcludedRegions(source);
      const heredocRegion = regions.find((r) => r.start > source.indexOf('\n'));
      assert.ok(heredocRegion, 'should have heredoc content region');
      assert.ok(heredocRegion.start >= source.indexOf('\n'), 'excluded region should start at or after the newline');
    });
  });

  suite('Excluded regions - Regex', () => {
    test('should ignore keywords in regex literals', () => {
      const source = `/if|while|end/
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle regex with flags', () => {
      const source = `/if end/im
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Excluded regions - Macro templates', () => {
    test('should ignore keywords in {% %} macro template', () => {
      const source = `{% if flag %}
  some_code
{% end %}
if real_condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should ignore keywords in {{ }} interpolation', () => {
      const source = `x = {{if true}}
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested {{ }} correctly', () => {
      const source = `{{if condition}}
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Excluded regions - Percent literals', () => {
    test('should handle %r() regex percent literal with interpolation', () => {
      const source = '%r(#{hash = {a: 1}}_end)\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should ignore keywords in percent string literals', () => {
      const source = `arr = %w(if end while)
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested braces in percent literal', () => {
      const source = `x = %{nested {if end} here}
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Excluded regions - Symbols', () => {
    test('should ignore keywords in quoted symbols', () => {
      const source = `sym = :"if end"
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Excluded regions - Backtick strings', () => {
    test('should ignore keywords in backtick strings', () => {
      const source = 'cmd = `echo if end`\nif true\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
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
  });

  suite('Named tuple key syntax (keyword:)', () => {
    test('should not match keywords used as named tuple keys', () => {
      const source = `tuple = {if: 1, end: 2, while: 3}
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match do: in named tuple', () => {
      const source = `opts = {do: :something}
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

  suite('Macro template with strings', () => {
    test('should handle %} inside string in macro template', () => {
      const source = `{% "%}" %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle }} inside string in macro expression', () => {
      const source = `{{ "}}" }}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single-quoted string with %} in macro', () => {
      const source = `{% '%}' %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped quote in string inside macro', () => {
      const source = `{% "\\"%}" %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multiple strings in macro template', () => {
      const source = `{% "%}" + "%}" %}
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Postfix while/until', () => {
    test('should not parse postfix while as block', () => {
      const source = 'x = 1 while condition';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not parse postfix until as block', () => {
      const source = 'x = 1 until condition';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should parse standalone while as block', () => {
      const source = `while condition
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Modulo operator vs percent literal', () => {
    test('should treat % after string as modulo, not percent literal', () => {
      const source = '"hello" % w do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Edge cases', () => {
    suite('General', () => {
      test('should handle empty source', () => {
        const pairs = parser.parse('');
        assertNoBlocks(pairs);
      });

      test('should handle source with no blocks', () => {
        const pairs = parser.parse("puts 'hello world'");
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
  action
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'unless', 'end');
      });

      test('should handle while-end block', () => {
        const source = `while condition
  action
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'while', 'end');
      });

      test('should handle until-end block', () => {
        const source = `until condition
  action
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'until', 'end');
      });

      test('should handle complex real-world Crystal code', () => {
        const source = `class Server
  def initialize(@port : Int32)
  end

  def start
    server = TCPServer.new("localhost", @port)
    while client = server.accept?
      spawn do
        handle_client(client)
      end
    end
  rescue ex : Exception
    puts ex.message
  ensure
    server.close if server
  end

  private def handle_client(client)
    if message = client.gets
      client.puts "Echo: #{message}"
    end
  end
end`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 5);

        const classPair = findBlock(pairs, 'class');
        assert.strictEqual(classPair.nestLevel, 0);
      });
    });

    suite('Unterminated constructs', () => {
      test('should handle unterminated {% %} macro template', () => {
        const source = `{% if flag
if real
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unterminated {{ }} interpolation', () => {
        const source = `{{if condition
if real
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle deeply nested {{ }}', () => {
        const source = `{{outer {{inner}} outer}}
if real
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle unterminated quoted symbol', () => {
        const source = `sym = :"unterminated
if true
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle escaped quotes in quoted symbol', () => {
        const source = `sym = :"escaped\\"quote"
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle single-quoted symbol with escape', () => {
        const source = `sym = :'escaped\\'quote'
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated string in macro at end of file', () => {
        const source = `{% "unterminated`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle macro with single-quoted unterminated string at EOF', () => {
        const source = `{% 'unterminated`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Regex literals', () => {
      test('should handle regex with escape sequences', () => {
        const source = `/regex\\/with\\/escapes/
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle unterminated regex (newline before closing)', () => {
        const source = `/unterminated regex
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle regex at end of file without terminator', () => {
        const source = 'x = /regex';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should detect regex after whitespace', () => {
        const source = `x =   /pattern/
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should detect division not regex after identifier', () => {
        const source = `result = value/2
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should detect regex at start of source', () => {
        const source = `/^pattern$/
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle regex after whitespace at start of file', () => {
        const source = '   /regex/\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle / at end of file', () => {
        const source = `def foo
  x
end
/`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat / after identifier as regex', () => {
        const source = `def foo
  a/b/c
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat / after ) as regex', () => {
        const source = `def foo
  func()/2
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat / after ] as regex', () => {
        const source = `def foo
  arr[0]/2
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat / after } as regex', () => {
        const source = `def foo
  {}/2
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not treat / after > as regex', () => {
        const source = `def foo
  1>0/2
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });
    });

    suite('Heredocs', () => {
      test('should handle heredoc with content on same line after identifier', () => {
        const source = `text = <<-HEREDOC; other_code
content here
HEREDOC
if real
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle heredoc terminator at exact end of file', () => {
        const source = `text = <<-EOF
content
EOF`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle heredoc without terminator', () => {
        const source = `text = <<-HEREDOC
if inside heredoc
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle heredoc with double-quoted identifier', () => {
        const source = `text = <<-"HEREDOC"
if inside
HEREDOC
if real
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle heredoc with single-quoted identifier', () => {
        const source = `text = <<-'HEREDOC'
if inside
HEREDOC
if real
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should not match invalid heredoc pattern', () => {
        const source = `x = << invalid
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle multiple heredocs on same line', () => {
        const source = `result = <<-A + <<-B
first
A
second
B
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
        assert.strictEqual(pairs[0].openKeyword.line, 5);
      });

      test('should handle multiple heredocs with keywords inside', () => {
        const source = `result = <<-A + <<-B
if inside_first
end
A
if inside_second
end
B
def real
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle three heredocs on same line', () => {
        const source = `x = <<-A + <<-B + <<-C
a
A
b
B
c
C
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle heredocs with indentation flags on same line', () => {
        const source = `x = <<-A + <<-B
  content
  A
  more
  B
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle heredoc at very start of file', () => {
        const source = `<<-EOF
heredoc content
EOF
def foo
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle heredoc with CRLF line endings', () => {
        const source = 'def foo\r\n  <<-EOF\r\ncontent\r\nEOF\r\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should reject quoted heredoc after identifier (shift operator)', () => {
        const source = 'x = y <<"EOF"\nhello\nEOF';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });

      test('should accept heredoc with dash flag after identifier', () => {
        const source = 'x = y <<-EOF\nhello\nEOF';
        const result = parser.parse(source);
        assertNoBlocks(result);
      });
    });

    suite('Percent literals', () => {
      test('should handle percent literal with escape sequences', () => {
        const source = `arr = %w(item\\)with\\(parens)
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle percent literal with non-paired delimiter', () => {
        const source = `str = %q|if end while|
if true
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should handle percent literal with angle brackets', () => {
        const source = `str = %q<if end>
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle percent literal with square brackets', () => {
        const source = `arr = %i[one two three]
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated percent literal', () => {
        const source = `str = %q(unterminated
if true
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should reject percent literal with alphanumeric delimiter', () => {
        const source = `x = %qa
if true
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle percent literal at end of source', () => {
        const source = '%w(';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle percent literal specifier at end of source', () => {
        const source = '%q';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Postfix conditionals', () => {
      test('should not detect if after then keyword', () => {
        const source = `case x
when 1 then if y
  action
end
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
      });

      test('should not detect if after else keyword', () => {
        const source = `if cond1
  a
else if cond2
  b
end
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
      });

      test('should not detect if after rescue keyword', () => {
        const source = `begin
  risky
rescue if should_log
  log_error
end
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
      });

      test('should detect postfix if correctly', () => {
        const source = `return value if condition
if real
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        assert.strictEqual(pairs[0].openKeyword.line, 1);
      });

      test('should detect postfix unless correctly', () => {
        const source = `skip unless valid
unless real
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        assert.strictEqual(pairs[0].openKeyword.line, 1);
      });

      test('should parse if expression assigned to variable', () => {
        const source = `value = if condition
  1
else
  2
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse unless expression assigned to variable', () => {
        const source = `value = unless condition
  1
else
  2
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'unless', 'end');
      });

      test('should parse if after && operator', () => {
        const source = `result = a && if b
  c
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse if after || operator', () => {
        const source = `result = a || if b
  c
end`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse if in array literal', () => {
        const source = `arr = [
  if condition
    1
  end
]`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse if in hash literal', () => {
        const source = `hash = {
  key: if condition
    1
  end
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse if after method call with opening paren', () => {
        const source = `method(
  if condition
    1
  end
)`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should parse if in ternary operator', () => {
        const source = `result = flag ? if a
  1
end : 2`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should not detect if after in keyword (pattern matching)', () => {
        const source = `case x
in pattern
  if condition
    action
  end
end`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assertNestLevel(pairs, 'case', 0);
        assertNestLevel(pairs, 'if', 1);
      });
    });

    suite('Backtick strings', () => {
      test('should handle escaped backtick in command string', () => {
        const source = 'cmd = `echo \\`nested\\``\nif true\nend';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
      });

      test('should handle unterminated backtick string', () => {
        const source = 'cmd = `unterminated\nif true\nend';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Double-quoted strings', () => {
      test('should handle unterminated double-quoted string', () => {
        const source = `msg = "unterminated
if true
end`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Semicolon separator', () => {
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

    suite('Symbol edge cases', () => {
      test('should handle colon at end of file', () => {
        const source = 'def foo\nend\n:';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should not treat colon after identifier as symbol in named argument', () => {
        const source = 'def foo\n  func(key: value)\nend';
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

    suite('Regex after ?/! method names', () => {
      test('should not treat /regex/ after ?-method as division', () => {
        const source = 'if valid?\n  x = /pattern/\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should not treat /regex/ after !-method as division', () => {
        const source = 'if save!\n  x = /pattern/\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });
    });
  });

  suite('Loop separator do', () => {
    test('should not treat while-do as separate block', () => {
      const pairs = parser.parse('while condition do\n  action\nend');
      assertSingleBlock(pairs, 'while', 'end', 0);
    });

    test('should not treat until-do as separate block', () => {
      const pairs = parser.parse('until condition do\n  action\nend');
      assertSingleBlock(pairs, 'until', 'end', 0);
    });

    test('should not treat for-do as separate block', () => {
      const pairs = parser.parse('for item in collection do\n  action\nend');
      assertSingleBlock(pairs, 'for', 'end', 0);
    });

    test('should still treat standalone do as block', () => {
      const pairs = parser.parse('[1, 2].each do |item|\n  puts item\nend');
      assertSingleBlock(pairs, 'do', 'end', 0);
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
      const source = `if true
  do_something
end`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if true
end`;
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 2);
      assert.strictEqual(tokens[0].value, 'if');
      assert.strictEqual(tokens[1].value, 'end');
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `# comment
"string"
{% template %}`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 3);
    });
  });

  suite('Regex after keyword', () => {
    test('should treat / after if keyword as regex start', () => {
      const source = `if /pattern/
  puts "match"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / after unless keyword as regex start', () => {
      const source = `unless /skip/
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should treat / after when keyword as regex start', () => {
      const source = `case x
when /pattern/
  action
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
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
      const source = `a = x <<-'EOF'
line with end
EOF
def foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should detect heredoc at line start', () => {
      const source = `x = <<-EOF
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
      const source = 'x = <<-EOF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Abstract def', () => {
    test('should not treat abstract def as block', () => {
      const source = `abstract def method_name
class Foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat abstract def with parameters as block', () => {
      const source = `abstract def method_name(arg : Int32)
class Foo
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should still parse regular def as block', () => {
      const source = `def method_name
  :ok
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
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

  suite('Coverage: semicolon in loop do check', () => {
    test('should handle do after semicolon as block do', () => {
      const pairs = parser.parse('x = 1; do\n  puts 1\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should handle loop keyword in string before do', () => {
      const pairs = parser.parse('"while"; do\n  puts 1\nend');
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Coverage: semicolon in isValidBlockOpen', () => {
    test('should handle block keyword after semicolon as valid block', () => {
      const pairs = parser.parse('x = 1; if true\n  puts 1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Surrogate pair char literal', () => {
    test('should handle emoji char literal (surrogate pair)', () => {
      const pairs = parser.parse("ch = '\ud83d\ude00'\nif true\n  action\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 2: skipInterpolation comment/backtick/percent handling', () => {
    test('should handle line comment inside string interpolation', () => {
      // # comment inside interpolation should not cause } to close early
      const source = '"#{x # comment }"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle backtick string inside string interpolation', () => {
      const source = '"#{`echo end`}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle percent literal inside string interpolation', () => {
      const source = '"#{%w(if end while)}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle percent literal with braces inside interpolation', () => {
      const source = '"#{%q{if end}}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle backtick with interpolation inside string interpolation', () => {
      const source = '"#{`echo #{x}`}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });
  });

  suite('Bug 3: skipRegexInterpolation missing handlers', () => {
    test('should handle line comment inside regex interpolation', () => {
      // Comment consumes to end of line, closing braces must be on next line
      const source = '%r{#{x # comment\n}}\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should handle backtick inside regex interpolation', () => {
      const source = '%r{#{`echo end`}}\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should handle regex inside regex percent literal interpolation', () => {
      const source = '%r{#{x = /pattern/}}\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should handle percent literal inside regex interpolation', () => {
      const source = '%r{#{%w(a b c)}}\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });
  });

  suite('Bug 4: \\r-only line endings in backward scans', () => {
    test('should handle \\r-only line endings in postfix conditional', () => {
      // \r separates lines, so "result if condition" on same line is postfix
      const source = 'result if condition\r  action\rend';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle \\r-only line endings in block conditional', () => {
      const source = '\rif condition\r  action\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'if', 'end');
    });

    test('should handle \\r-only line endings in postfix rescue', () => {
      const source = 'def foo\r  risky rescue nil\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
      assert.strictEqual(result[0].intermediates.length, 0);
    });

    test('should handle \\r-only line endings in for-in', () => {
      const source = 'for x in list\r  action\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'for', 'end');
    });

    test('should handle \\r-only line endings in loop do', () => {
      const source = 'while cond do\r  action\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'while', 'end');
    });
  });

  suite('Bug 5: abstract def regex across newlines', () => {
    test('should not match abstract across newline before def', () => {
      const source = 'abstract\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should still match abstract def on same line', () => {
      const source = 'abstract def method_name\nclass Foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'class', 'end');
    });
  });

  suite('Bug 20: matchRegexLiteral \\r handling', () => {
    test('should handle unterminated regex with \\r-only line ending', () => {
      const source = '/unterminated\rif true\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'if', 'end');
    });
  });

  suite('Bug 21: matchHeredoc \\r handling', () => {
    test('should handle heredoc with \\r-only line endings', () => {
      const source = 'x = <<-EOF\rcontent\rEOF\rif true\rend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'if', 'end');
    });

    test('should handle heredoc with CRLF line endings', () => {
      const source = 'x = <<-EOF\r\ncontent\r\nEOF\r\nif true\r\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'if', 'end');
    });
  });

  suite('Bug 22: isSymbolStart :: scope resolution', () => {
    test('should not treat :: as symbol start', () => {
      const source = 'Foo::Bar\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should not treat second : of :: as symbol', () => {
      const source = 'x = Foo::bar\ndef foo\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });

    test('should still treat single : as symbol', () => {
      const source = 'x = :foo\ndef bar\nend';
      const result = parser.parse(source);
      assertSingleBlock(result, 'def', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle heredoc with CR-only endings', () => {
      const source = 'x = <<-EOF\rheredoc content\rEOF\rif true\r  action\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });
});
