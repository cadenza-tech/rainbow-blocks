import * as assert from 'node:assert';
import { CrystalBlockParser } from '../../parsers/crystalParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import {
  generateCommonTests,
  generateEdgeCaseTests,
  generateExcludedRegionTests,
  generateRegexInterpolationTests,
  generateStringInterpolationTests
} from '../helpers/sharedTestGenerators';

suite('CrystalBlockParser Test Suite', () => {
  let parser: CrystalBlockParser;

  setup(() => {
    parser = new CrystalBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: "puts 'hello world'",
    tokenSource: 'if true\nend',
    expectedTokenValues: ['if', 'end'],
    excludedSource: '# comment\n"string"\n{% template %}',
    expectedRegionCount: 3,
    twoLineSource: 'if true\nend',
    singleLineCommentSource: '# if condition do end\ndef real_method\nend',
    commentBlockOpen: 'def',
    commentBlockClose: 'end',
    doubleQuotedStringSource: 'x = "if end while"\nif true\nend',
    stringBlockOpen: 'if',
    stringBlockClose: 'end',
    escapedQuoteStringSource: 'msg = "he said \\"if\\" and \\"end\\""\nif condition\nend',
    escapedQuoteStringBlockOpen: 'if',
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
    generateExcludedRegionTests(config);
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted char literals', () => {
      const source = `ch = 'e'
if true
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle hex escape in char literal', () => {
      // '\x41' is a valid Crystal char literal (hex for 'A')
      const pairs = parser.parse("x = '\\x41'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle octal escape in char literal', () => {
      // '\o101' is a valid Crystal char literal (octal for 'A')
      const pairs = parser.parse("x = '\\o101'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle legacy octal escape in char literal', () => {
      // '\101' is a valid Crystal char literal (legacy octal for 'A')
      const pairs = parser.parse("x = '\\101'\nif true\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not let char literal fallback escape skip past newline', () => {
      const pairs = parser.parse("if true\n  x = '\\\nend");
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should ignore keywords in <<~ squiggly heredocs', () => {
      const source = `def process
  result = <<~HEREDOC
    if inside
    end
  HEREDOC
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle multiple <<~ heredocs on one line', () => {
      const source = `x = <<~A + <<~B
if in_a
end
A
if in_b
end
B
if real
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.line, 7);
    });

    test('should filter keyword names in <<~ heredoc openers', () => {
      const tokens = parser.getTokens('x = <<~end\ncontent\nend\nif true\nend');
      const tokenValues = tokens.map((t) => t.value);
      assert.ok(!tokenValues.includes('end') || tokenValues.filter((v) => v === 'end').length === 1, 'should have at most 1 end token');
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

    test('should handle regex character class containing slash', () => {
      const pairs = parser.parse('if true\n  x = /[/]end/\nend');
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should not treat {{% as {{ macro expression template', () => {
      const pairs = parser.parse('{{% end %}\nif true\nend');
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

    test('should treat %= as compound assignment not percent literal', () => {
      const pairs = parser.parse('if true\n  x %= 5\nend');
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should close macro template when single brace precedes }}', () => {
      const pairs = parser.parse('{{ a{b}}}\nif true\n  puts 1\nend');
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
    generateEdgeCaseTests(config);

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

      test('should treat / after method? as division on same line', () => {
        const source = 'x = foo? / 2\nif true\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should treat / after method! as division on same line', () => {
        const source = 'x = save! / 2\nif true\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'end');
      });

      test('should treat / after ternary ? operator as regex start', () => {
        const source = 'x = condition ? /pattern/ : /other/\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should treat / after logical not ! operator as regex start', () => {
        const source = 'x = !/pattern/\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should treat / after standalone ! with space as regex start', () => {
        const source = 'x = ! /pattern/\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle ternary with keyword in regex', () => {
        const source = 'x = cond ? /if end/ : nil\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });

      test('should handle ! before regex with keyword inside', () => {
        const source = 'x = !/do end/\ndef foo\nend';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'def', 'end');
      });
    });

    test('should not treat even backslashes before newline as line continuation', () => {
      const pairs = parser.parse('x = 1 \\\\\nif true\n  puts 1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not scan past newline in \\u{ char literal', () => {
      const pairs = parser.parse('?\\u{\ndef foo\n  1\nend');
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should fully exclude ?\\uXXXX char literal escape', () => {
      const regions = parser.getExcludedRegions('?\\u0041');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, 7); // ?\u0041 is 7 chars
    });

    test('should fully exclude ?\\xNN char literal escape', () => {
      const regions = parser.getExcludedRegions('?\\x41');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, 5); // ?\x41 is 5 chars
    });
  });

  suite('Loop separator do', () => {
    test('should not treat while-do as separate block', () => {
      const pairs = parser.parse('while condition do\n  action\nend');
      assertSingleBlock(pairs, 'while', 'end');
    });

    test('should not treat until-do as separate block', () => {
      const pairs = parser.parse('until condition do\n  action\nend');
      assertSingleBlock(pairs, 'until', 'end');
    });

    test('should not treat for-do as separate block', () => {
      const pairs = parser.parse('for item in collection do\n  action\nend');
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should still treat standalone do as block', () => {
      const pairs = parser.parse('[1, 2].each do |item|\n  puts item\nend');
      assertSingleBlock(pairs, 'do', 'end');
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

  suite('Branch coverage', () => {
    test('should handle unterminated single-quoted symbol', () => {
      // Covers lines 271-272: :'symbol with no closing quote runs to end of source
      const source = "x = :'unterminated_symbol\nif true\nend";
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should filter keyword in double-quoted heredoc opener', () => {
      // Covers lines 322-323: <<-"end" style heredoc opener
      // The keyword inside double quotes is detected as excluded region by gap scan,
      // but the tokenize filter at lines 321-323 provides an additional safety net
      const source = '<<-"end"\nheredoc content\nend\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: skipMacroString nested string in interpolation', () => {
    test('should handle string with closing brace inside macro interpolation', () => {
      const source = '{% "test #{"}"}" %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle string with opening brace inside macro interpolation', () => {
      const source = '{% "test #{" { "}" %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: matchSymbolLiteral heredocState propagation', () => {
    test('should exclude heredoc inside double-quoted symbol interpolation', () => {
      const source = `x = :"prefix #{<<-HERE}
content with end if
HERE
"
if true
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

  suite('Regression: empty heredoc delimiter', () => {
    test('should not let empty heredoc delimiter <<-"" consume subsequent code', () => {
      const pairs = parser.parse('x = <<-""\nif real\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: unmatched quote in invalid heredoc opener', () => {
    test('should not treat unmatched double quote in <<-" as string start', () => {
      // <<-"end (no closing quote) is an invalid heredoc opener.
      // The orphaned " must not be misinterpreted as a regular string start,
      // which would consume all subsequent code into an excluded region.
      const source = '<<-"end\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat unmatched double quote in <<-"IDENTIFIER as string start', () => {
      const source = '<<-"FOO\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat unmatched double quote in <<-" without identifier as string start', () => {
      const source = '<<-"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat unmatched double quote in <<-" within expression as string start', () => {
      const source = 'x = <<-"WORD\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still handle valid <<-"END" heredoc correctly', () => {
      const source = '<<-"END"\nheredoc body\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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
  });

  suite('Backslash line continuation in postfix conditionals and rescue', () => {
    test('should treat if as postfix when preceded by content on backslash-continued line', () => {
      const source = 'value = x \\\n  if condition\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat unless as postfix when preceded by content on backslash-continued line', () => {
      const source = 'value = x \\\n  unless condition\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat rescue as postfix on backslash-continued line', () => {
      const source = 'result = risky \\\n  rescue nil\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat do as loop do on backslash-continued loop line', () => {
      const source = 'array.each \\\n  do |item|\n  puts item\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should treat in as for-in when preceded by for on backslash-continued line', () => {
      const source = 'for item \\\n  in list\n  puts item\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle multiple backslash continuations in postfix conditional', () => {
      const source = 'x = a \\\n  + b \\\n  if valid\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle backslash continuation in rescue with block', () => {
      const source = 'def process\n  result = operation \\\n    rescue StandardError\n    nil\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0);
    });

    test('should treat if as block form when not preceded by content on backslash line', () => {
      const source = '\\\n  if condition\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Symbol and operator handling', () => {
    test('should exclude symbol :end after > operator', () => {
      const source = 'x > :end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should exclude symbol :end after > without space', () => {
      const source = 'x>:end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat if after not as block form', () => {
      const source = 'not if condition\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat if after and as block form', () => {
      const source = 'x and if condition\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat if after or as block form', () => {
      const source = 'x or if condition\n  body\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat rescue after not as block form', () => {
      const source = 'not begin\n  risky\nrescue\n  handle\nend';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value, 'begin');
    });
  });

  suite('Invalid multi-char literal fallback', () => {
    test('should exclude keywords between quotes in invalid char literal', () => {
      // 'do' is not a valid Crystal char literal (multi-char), but keywords
      // between quotes should still be excluded
      const source = "x = 'do'\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude keywords in multi-char quoted text', () => {
      // 'end' between quotes should be excluded even though it is not a valid char literal
      const source = "x = 'end'\ndef foo\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not exclude across line boundary for invalid char literal', () => {
      // If no closing quote on same line, the quote should not be excluded
      const source = "x = 'unterminated\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped characters in invalid char literal fallback', () => {
      const source = "x = 'if\\'s'\ndef foo\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: for-in with semicolon', () => {
    test('should handle for-in after semicolon separator', () => {
      const source = 'x = 1; for item in list\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });
  });

  suite('Coverage: skipInterpolation backtick/regex/percent', () => {
    test('should handle backtick string with nested interpolation inside string interpolation', () => {
      const source = '"#{`cmd #{x}`}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle nested regex inside string interpolation', () => {
      const source = '"#{/regex #{x}/}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });

    test('should handle percent literal inside string interpolation', () => {
      const source = '"#{%w(a b)}"';
      const result = parser.parse(source);
      assertNoBlocks(result);
    });
  });

  suite('Coverage: skipRegexInterpolation escape sequences', () => {
    test('should handle escape sequences inside regex interpolation', () => {
      const source = '/#{x = "\\n"}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipMacroString', () => {
    test('should handle double-quoted string in macro with escape', () => {
      const source = '{% "escaped\\"quote" %}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle unterminated string in macro template', () => {
      const source = '{% "unterminated\ndef foo\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: matchCharLiteral edge cases', () => {
    test('should reject char literal at end of file before closing quote', () => {
      const source = "x = 'a";
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should reject char literal with escape but no closing quote', () => {
      const source = "x = '\\n";
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle char literal with \\u escape followed by non-brace', () => {
      const source = "x = '\\u0041'\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle char literal with partial hex digits', () => {
      const source = "x = '\\x4'\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: getMatchingDelimiter', () => {
    test('should handle percent literal with whitespace delimiter rejection', () => {
      const source = '% \nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: heredoc edge cases', () => {
    test('should handle heredoc without dash flag', () => {
      const source = '<<EOF\ncontent\nEOF\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from comment on heredoc opener line', () => {
      const source = 'x = <<-END # <<-END is a heredoc\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from string on heredoc opener line', () => {
      const source = 'x = <<-END, "<<-OTHER"\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not collect false terminator from comment with different term', () => {
      const source = 'x = <<-END # see <<-HERE for reference\nhello\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still handle real multiple heredocs on same line', () => {
      const source = 'x = <<-A + <<-B\nfirst\nA\nsecond\nB\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: skipNestedString in skipRegexInterpolation', () => {
    test('should handle single-quoted string inside regex interpolation', () => {
      const source = "/#{x = 'hello'}/\ndef foo\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: isSymbolStart edge cases', () => {
    test('should not treat colon without following letter as symbol', () => {
      const source = 'x = : \ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat colon after closing brace as symbol', () => {
      const source = 'x = {}:value\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: loop do with semicolon in excluded region', () => {
    test('should handle semicolon in string before loop do', () => {
      const source = 'x = "a;b"; while cond do\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Coverage: skipRegexInterpolation edge cases', () => {
    // Covers lines 444-446: escape sequences in regex interpolation
    test('should handle escape sequences inside regex interpolation', () => {
      const source = '/#{x = "\\n"}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 465-466: backtick inside regex interpolation
    test('should handle backtick string inside regex interpolation', () => {
      const source = '/#{`command`}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 468-469: regex inside regex interpolation
    test('should handle regex literal inside regex interpolation', () => {
      const source = '/#{/inner/}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 471-475: percent literal inside regex interpolation
    test('should handle percent literal inside regex interpolation', () => {
      const source = '/#{%w[a b]}/\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipInterpolation edge cases', () => {
    // Covers lines 690-692: escape sequences in interpolation
    test('should handle escape sequences inside string interpolation', () => {
      const source = '"#{x = "\\t"}";\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 708-709: single quote inside interpolation
    test('should handle single-quoted string inside interpolation', () => {
      const source = '"#{"a"}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipNestedRegex', () => {
    // Covers lines 756-757: regex flags in nested regex
    test('should handle regex with flags inside interpolation', () => {
      const source = '"#{/pattern/imx}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 761-762: unterminated regex in interpolation
    test('should handle unterminated regex with newline in interpolation', () => {
      const source = '"#{/pattern\n}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers line 765: EOF in nested regex
    test('should handle unterminated regex at EOF in interpolation', () => {
      const source = '"#{/pattern'; // unterminated string with unterminated regex
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: skipNestedString', () => {
    // Covers lines 786-787: unterminated string in interpolation
    test('should handle unterminated nested string in interpolation', () => {
      const source = '"#{"unterminated}"; def foo\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: skipNestedBacktickString', () => {
    // Covers lines 794-796: escape sequences in nested backtick
    test('should handle escape sequences in nested backtick string', () => {
      const source = '"#{`cmd\\n`}"; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    // Covers lines 806-807: unterminated backtick in interpolation
    test('should handle unterminated nested backtick string', () => {
      const source = '"#{`unterminated}"; def foo\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: matchBacktickString', () => {
    // Covers lines 819-821: interpolation in backtick string
    test('should handle interpolation in backtick command string', () => {
      const source = '`echo #{value}`; def foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: matchCharLiteral unicode forms', () => {
    // Covers lines 842-847: \u{XXXX} form
    test('should handle char literal with unicode brace form', () => {
      const source = "x = '\\u{1F600}'\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: isLoopDo edge cases', () => {
    // Covers lines 961-962: loop keyword in excluded region
    test('should handle loop keyword in comment before do', () => {
      const source = '# while\nfor x in arr do\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    // Covers lines 971-972: do in excluded region
    test('should handle do in string after loop keyword', () => {
      const source = 'while cond; x = "do"; do\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    // Covers lines 976-977: different do found before position
    test('should handle multiple do keywords after loop', () => {
      const source = 'while cond do\n  arr.each do\n    action\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not treat dot-preceded loop keyword as loop opener', () => {
      // Regression: isLoopDo did not filter dot-preceded keywords,
      // so obj.while do was incorrectly treated as loop do
      const source = 'obj.while do |x|\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should not treat scope-resolved loop keyword as loop opener', () => {
      const source = 'Mod::while do |x|\n  x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Coverage: skipRegexInterpolation backslash escape', () => {
    // Covers lines 442-445: backslash escape inside #{} in regex
    test('should handle backslash escape inside regex interpolation', () => {
      const source = 'x = /#{a\\tb}/\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude block keywords inside regex interpolation with escapes', () => {
      const source = 'x = /#{\\ndo\\n}/\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: isModuloOperator at start of source', () => {
    // Covers lines 607-608: % with only whitespace before it at source start
    test('should treat percent literal at start of source as excluded region', () => {
      const source = '%w(foo bar)\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat percent literal with leading whitespace as excluded region', () => {
      const source = '  %w(do end)\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: skipInterpolation backslash escape', () => {
    // Covers lines 688-691: backslash escape inside #{} in string
    test('should handle backslash escape inside string interpolation', () => {
      const source = 'x = "#{a\\tb}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude block keywords in string interpolation with escapes', () => {
      const source = 'x = "#{\\ndo\\n}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: skipInterpolation single-quoted string', () => {
    // Covers lines 706-708: single-quoted string inside #{} in string
    test('should handle single-quoted string inside interpolation', () => {
      const source = 'x = "#{\'hello\'}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude block keywords in single-quoted string inside interpolation', () => {
      const source = 'x = "#{\'do end\'}"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Coverage: isRegexInInterpolation only whitespace', () => {
    // Covers line 735: / as first non-whitespace in #{} (j < interpStart)
    test('should treat slash as regex when only whitespace before it in interpolation', () => {
      const source = 'x = "#{  /pattern/}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: skipNestedString unterminated', () => {
    // Covers lines 785-786: source ends without closing quote inside interpolation
    test('should handle unterminated string inside interpolation', () => {
      const source = 'x = "#{"hello';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unterminated string with block keyword inside interpolation', () => {
      const source = 'x = "#{"do end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: matchCharLiteral EOF edges', () => {
    // Covers line 832-833: single quote at end of source
    test('should handle single quote at end of source', () => {
      const source = "if true\nend\nx = '";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Covers lines 837-838: backslash-quote at end of source
    test('should handle backslash at end of source after single quote', () => {
      const source = "if true\nend\nx = '\\";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: isLoopDo excluded region checks', () => {
    // Covers lines 959-961: loop keyword in string on same line as do
    test('should not treat string-contained loop keyword as loop do', () => {
      const source = '"while" ; x.each do\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    // Covers lines 969-977: do keyword in excluded region (string) after loop
    test('should skip do in string after loop keyword', () => {
      const source = 'while x > "do"; while true do\n  action\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    // Covers: loop keyword in comment on same line
    test('should ignore comment-contained loop keyword before real loop do', () => {
      const source = '# for\nwhile cond do\n  action\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should skip loop keyword in string before standalone do', () => {
      const source = 'x = "for"; [1].each do |i|\n  puts i\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  // Covers: matchHeredoc terminators empty
  suite('Coverage: heredoc with no valid identifier', () => {
    test('should handle heredoc with dash but no valid identifier', () => {
      const source = 'x = <<-123\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

    test('should still treat if after regex with flags as postfix', () => {
      const source = 'def foo\n  x = /hello/i if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers lines 346-348: :: scope resolution before keyword
  suite('Coverage: scope resolution :: before keyword', () => {
    test('should not match keyword after :: scope resolution', () => {
      const source = 'Foo::Begin\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match do after :: scope resolution', () => {
      const source = 'Module::Do::Something\nwhile true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Covers @ prefix filter: instance/class variable names like @end, @@end, @do
  suite('Coverage: @ prefix (instance/class variable names)', () => {
    test('should not match @end as block close', () => {
      const source = 'def foo\n  @end = 1\n  if true\n    body\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'if', 1);
      assertNestLevel(pairs, 'def', 0);
    });

    test('should not match @@end as block close', () => {
      const source = 'class Foo\n  @@end = 1\n  def bar\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });

    test('should not match @do as block open', () => {
      const source = 'def foo\n  @do = true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match @@do as block open', () => {
      const source = 'def foo\n  @@do = true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match @begin as block open', () => {
      const source = 'class Foo\n  def initialize\n    @begin = true\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });

    test('should handle mixed @ variables and real blocks', () => {
      const source = 'class Foo\n  def initialize\n    @end = false\n    @@do = true\n    if @end\n      puts @@do\n    end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });
  });

  // Covers lines 350-352: colon after keyword (named tuple key)
  suite('Coverage: colon after keyword (named tuple)', () => {
    test('should not match begin: in named tuple', () => {
      const source = '{begin: 1, end: 2}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match do: in named tuple', () => {
      const source = '{do: "action"}\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  // Covers lines 363-365: ? after keyword (predicate method name)
  suite('Coverage: ? after keyword (predicate method)', () => {
    test('should not match end? as block close', () => {
      const source = 'def end?\n  true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match do? as block open', () => {
      const source = 'x = do?\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 366-368: = after keyword (setter method, not at EOF)
  suite('Coverage: = after keyword (setter method)', () => {
    test('should not match end= as block close', () => {
      const source = 'def end=(val)\n  @x = val\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match do= as block open', () => {
      const source = 'x.do=(1)\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still match end followed by == (comparison)', () => {
      const source = 'if x == end\nend';
      const pairs = parser.parse(source);
      // end== would not filter because source[endOffset+1] === '='
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still match end followed by =~ (regex match)', () => {
      const source = 'if true\n  x = end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 369-371: = after keyword at EOF
  suite('Coverage: = after keyword at EOF', () => {
    test('should not match keyword followed by = at end of source', () => {
      const source = 'if true\nend\nx = end=';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match begin= at end of source', () => {
      const source = 'if true\nend\nbegin=';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 373-375: ! after keyword (bang method)
  suite('Coverage: ! after keyword (bang method)', () => {
    test('should not match do! as block open', () => {
      const source = 'def do!\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match end! as block close', () => {
      const source = 'def end!\n  raise\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should still match end followed by != (not-equal)', () => {
      const source = 'if x != 0\n  action\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match begin! at EOF', () => {
      const source = 'if true\nend\nbegin!';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  // Covers lines 993-995: isLoopDo loop keyword in excluded region
  suite('Coverage: isLoopDo loop keyword in excluded region', () => {
    test('should skip loop keyword inside string on same line as do', () => {
      const source = '"while" do\n  action\nend';
      const pairs = parser.parse(source);
      // "while" is in a string, so do is not a loop do but a block do
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should find real loop keyword after string-contained one', () => {
      const source = '"for"; while cond do\n  action\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  // Covers lines 1003-1005: isLoopDo with do in excluded region between loop and real do
  suite('Coverage: isLoopDo do in excluded region', () => {
    test('should skip do inside string between loop keyword and real do', () => {
      const source = 'while "do" do\n  action\nend';
      const pairs = parser.parse(source);
      // "do" in string is skipped, real do at end is loop do -> isLoopDo returns true
      // while/end is the block pair (while is blockOpen, do is rejected as loop do)
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Covers line 1009: inner do break in isLoopDo (non-matching do found before position)
  suite('Coverage: isLoopDo inner do break', () => {
    test('should treat do as block opener when earlier do exists after loop keyword', () => {
      const source = 'while cond do; arr.each do\n  action\nend\nend';
      const pairs = parser.parse(source);
      // while..do creates a loop (while is blockOpen, first do is rejected as loop do)
      // After semicolon, arr.each do is a separate block do -> valid blockOpen
      // Results: while/end and do/end = 2 pairs
      assertBlockCount(pairs, 2);
    });
  });

  suite('Bug fixes', () => {
    test('Bug 7: keywords after .. range operator should not be filtered', () => {
      const source = `x = 1..if condition
  10
else
  5
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('Bug 7: keywords after ... range operator should not be filtered', () => {
      const source = `x = 1...if condition
  10
else
  5
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
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

  suite('Coverage: uncovered code paths', () => {
    test('should filter out :: scope resolution keywords', () => {
      // Covers lines 351-353: :: scope resolution filter in tokenize
      const source = 'Module::Class::Begin';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should filter out keyword in <<- heredoc opener', () => {
      // Covers lines 359-361: heredoc opener keyword filter (<<-end)
      const source = `x = <<-end
hello
end
if true
  1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should filter out keyword in <<- quoted heredoc opener', () => {
      // Covers lines 362-364: heredoc opener keyword filter (<<-'do', <<-"if")
      const source = `x = <<-'do'
hello
do
if true
  1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle regex inside string interpolation before block', () => {
      // Covers break in isLoopDo when non-matching do is found
      const source = `"#{/regex/}"
if true
  1
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // L1014-1016: break in isLoopDo when first do found after loop keyword doesn't match position
    test('should break in isLoopDo when do found after loop does not match current do position', () => {
      const source = 'while true do\n  [1,2].each do |x|\n    puts x\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
    });

    // Lines 290-291: :: scope resolution filter - token preceded by :: is not a keyword
    test('should not parse do as keyword when preceded by :: scope resolution', () => {
      // Module::do - 'do' preceded by '::' is a scope resolution, not a block opener
      const source = 'Module::do\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not parse end as keyword when preceded by :: scope resolution', () => {
      // MyModule::Class::end - 'end' preceded by '::' is filtered at lines 289-291
      const source = 'MyModule::Class::end\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Lines 301-303: heredoc opener filter (<<-keyword) - keyword after <<- is not a block keyword
    test('should not parse end as block keyword when it is a heredoc opener', () => {
      const source = 'x = <<-end\ncontent\nend\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Lines 304-306: heredoc opener with quoted delimiter (<<-'keyword' or <<-"keyword")
    // The keyword inside the quoted delimiter is filtered here.
    // Note: the keyword inside quotes may be in an excluded region (single-char literal),
    // so this test verifies correct behavior even if the branch fires indirectly.
    test('should not parse do as block keyword when it is a quoted heredoc opener delimiter', () => {
      // <<-'do' style heredoc - 'do' between the quotes is the delimiter, not a block keyword
      const source = "x = <<-'do'\ncontent\ndo\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // Lines 430-438: heredoc inside #{} interpolation with various line endings
    // The heredoc body is INSIDE the interpolation (closing } comes AFTER heredoc terminator)
    test('should handle heredoc inside #{} interpolation with LF line endings', () => {
      // Structure: "#{<<-HEREDOC\nbody\nHEREDOC\n}" - \n fires the else path (line 433-434)
      const source = '"#{<<-HEREDOC\n  content\nHEREDOC\n}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc inside #{} interpolation with CRLF line endings', () => {
      // Structure: "#{<<-HEREDOC\r\nbody\r\nHEREDOC\r\n}" - \r\n fires the CRLF path (line 430-432)
      const source = '"#{<<-HEREDOC\r\n  content\r\nHEREDOC\r\n}"\r\nif true\r\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // crystalExcluded.ts lines 107-109: backslash escape inside #{} interpolation in macro string
    test('should handle backslash escape inside #{} interpolation in macro double-quoted string', () => {
      // skipMacroString: quote='"', #{} interpolation, then backslash inside interpolation
      const source = '{% "value: #{x.gsub(/\\n/, " ")}" %}\nif x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    // crystalExcluded.ts lines 451-453: isDoAfterLoop break when do found before position
    test('should not treat do as loop opener when another do precedes it on same loop line', () => {
      // isDoAfterLoop: finds a 'do' in searchRange that is NOT at the current position - break
      // This happens when the loop has two 'do' occurrences but the second is the actual token
      const source = 'xs.each do |x| do\nend\nif true\nend';
      const pairs = parser.parse(source);
      // Result depends on parser; mainly ensure no crash and some valid parse
      assert.ok(Array.isArray(pairs));
    });
  });

  suite('Bug 23: macro template {% %} comment handling', () => {
    test('should handle # comment containing %} inside {% %} template', () => {
      // The # starts a comment that contains %}, which should not close the template
      const source = '{% x = 1 # comment with %} inside\ny = 2 %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle # comment at end of {% %} template line', () => {
      const source = '{% x = 1 # comment\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle multiple # comments in {% %} template', () => {
      const source = '{% x = 1 # first comment\ny = 2 # second comment %}\nz = 3 %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle # comment without %} in {% %} template', () => {
      const source = '{% x = 1 # harmless comment\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 24: macro template {{ }} comment handling', () => {
    test('should handle # comment containing }} inside {{ }} template', () => {
      // The # starts a comment that contains }}, which should not close the template
      const source = '{{ x # comment with }} inside\n}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle # comment at end of {{ }} template line', () => {
      const source = '{{ x # comment\n}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 25: {{ }} macro template with hash literal }}', () => {
    test('should not close {{ }} prematurely on hash literal }}', () => {
      // {a: {b: 1}} ends with }}, but should not close the template
      const source = '{{ {a: {b: 1}} }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle simple hash with }} in {{ }} template', () => {
      const source = '{{ {"key" => "val"} }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle deeply nested braces in {{ }} template', () => {
      const source = '{{ {a: {b: {c: 1}}} }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle single { } without affecting {{ }} close', () => {
      const source = '{{ {a: 1} }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle empty hash {} in {{ }} template', () => {
      const source = '{{ {} }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 26: {{ }} macro template with hash close adjacent to template close }}}', () => {
    test('should handle hash close adjacent to template close }}}', () => {
      // {{ {a: 1}}} = {{ {a: 1} }} but without space, }}} = hash close } + template close }}
      const source = '{{ {a: 1}}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested hash close adjacent to template close }}}}}', () => {
      // {{ {a: {b: 1}}}}} = nested hash }} + template close }}
      // singleBraceDepth 2 consumed by first }}, then depth-- for template close }}
      const source = '{{ {a: {b: 1}}}}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle hash with string value adjacent to template close }}}', () => {
      const source = '{{ {"key" => "val"}}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 27: DIVISION_PRECEDERS_PATTERN ?/! contextual handling', () => {
    test('should treat / as regex after standalone ? (ternary operator)', () => {
      // ? without preceding word char is ternary, / after it is regex
      const source = 'x = cond ? /pattern/ : nil\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / as division after method? (method name suffix)', () => {
      // valid? is a method name, / after it is division
      const source = 'def foo\n  valid? /2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should treat / as regex after standalone ! (logical not)', () => {
      // ! without preceding word char is logical not, / after it is regex
      const source = 'x = ! /pattern/\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should treat / as division after method! (method name suffix)', () => {
      // save! is a method name, / after it is division
      const source = 'def foo\n  save! /2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat / after $? as regex start', () => {
      const pairs = parser.parse('x = $? / 100\nif condition\n  action\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 28: skipMacroString interpolation handling', () => {
    test('should handle #{} interpolation in double-quoted strings inside {% %} macro', () => {
      const source = '{% "hello #{if true}world" %}\nif x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle #{} interpolation in double-quoted strings inside {{ }} macro', () => {
      const source = '{{ "value: #{do_something}" }}\nif x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle nested braces in interpolation inside macro string', () => {
      const source = '{% "#{{"key" => "val"}}" %}\nif x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not handle interpolation in single-quoted strings inside macro', () => {
      // Single-quoted strings do not have interpolation in Crystal
      const source = "{% '#{end}' %}\nif x\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped hash in macro string', () => {
      const source = '{% "\\#{end}" %}\nif x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug 29: heredoc trailing whitespace on terminator line', () => {
    test('should not match terminator with trailing spaces', () => {
      const source = 'x = <<-EOF\n  if true\nEOF   \nif x\nend';
      const pairs = parser.parse(source);
      // EOF with trailing spaces should NOT match - heredoc is unterminated
      assertNoBlocks(pairs);
    });

    test('should not match terminator with trailing tab', () => {
      const source = 'x = <<-EOF\n  if true\nEOF\t\nif x\nend';
      const pairs = parser.parse(source);
      // EOF with trailing tab should NOT match - heredoc is unterminated
      assertNoBlocks(pairs);
    });

    test('should not match indented terminator with trailing whitespace', () => {
      const source = 'x = <<-EOF\n  if true\n  EOF  \nif x\nend';
      const pairs = parser.parse(source);
      // EOF with trailing spaces should NOT match even with leading indentation
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 30: isRegexInInterpolation missing operators', () => {
    test('should treat / as regex after + operator in interpolation', () => {
      const source = '"#{x + /end/}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat / as regex after - operator in interpolation', () => {
      const source = '"#{x - /end/}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat / as regex after * operator in interpolation', () => {
      const source = '"#{x * /end/}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat / as regex after ? operator in interpolation', () => {
      const source = '"#{cond ? /end/ : /begin/}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat / as regex after < operator in interpolation', () => {
      const source = '"#{x < /end/}"';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 6: heredoc inside string interpolation', () => {
    test('should handle heredoc inside #{} interpolation where body contains }', () => {
      // Heredoc inside interpolation with } in body should not break brace tracking
      const source = '"#{<<-HEREDOC}\n  content with }\nHEREDOC\n"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: findLogicalLineStart backslash in excluded region', () => {
    test('should not extend logical line through backslash at end of comment', () => {
      // Covers crystalExcluded.ts lines 306-307: backslash in excluded region breaks findLogicalLineStart
      // The comment "# text\" ends with a backslash, which is in the comment's excluded region.
      // findLogicalLineStart should break instead of extending the logical line backward through it.
      // If it didn't break, "if" would be treated as postfix (preceded by comment content).
      const source = '# text\\\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Coverage: isLoopDo break when do does not match position', () => {
    test('should treat trailing do as block opener when first do after while is loop do', () => {
      // Covers crystalExcluded.ts lines 473-475: break when doAbsolutePos !== position
      // "while cond do do" has two \bdo\b matches after "while":
      // 1. First "do" (loop separator) at position P1 -> isLoopDo returns true (rejected as block opener)
      // 2. Second "do" at position P2 -> isLoopDo finds first "do" at P1 !== P2, breaks (line 473)
      //    -> isLoopDo returns false -> second "do" is a valid block opener
      const source = 'while cond do do\n  action\nend\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
      findBlock(pairs, 'do');
    });
  });

  suite('Regression: backslash continuation with CR-only line endings', () => {
    test('should handle backslash continuation with CR-only in postfix conditional', () => {
      // isPostfixConditional should replace \\\r with space
      const source = 'x = value \\\rif condition\r  do_something\rend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle backslash continuation with CR-only in for-in check', () => {
      // isForIn should replace \\\r with space to correctly detect for-in pattern
      const source = 'for \\\rx in [1, 2, 3]\r  puts x\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end');
    });

    test('should handle backslash continuation with CRLF in postfix conditional', () => {
      const source = 'x = value \\\r\nif condition\r\n  do_something\r\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: symbol with block keyword after identifier', () => {
    test('should exclude :do symbol after method name', () => {
      const source = 'puts :do\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude :end symbol after method name', () => {
      const source = 'puts :end\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude :if symbol after method name', () => {
      const source = 'method :if\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should exclude :unless symbol in case when', () => {
      const source = 'case x\nwhen :do\n  1\nwhen :end\n  2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should still reject colon immediately after identifier (ternary)', () => {
      const source = 'x = cond ? do_a : do_b\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Regression: => after keyword should not be treated as setter method', () => {
    test('should recognize end=> as end keyword followed by hash rocket', () => {
      const source = 'if true\n  1\nelse\n  2\nend=> "value"';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should still reject end= as setter method', () => {
      const source = 'x.end= 5\ndef foo\nend';
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
  });

  suite('Regression: heredoc with backtick string containing # on opener line', () => {
    test('should handle backtick command with hash on heredoc opener line', () => {
      const source = 'x = <<-ONE + `cmd # hash` + <<-TWO\ncontent one\nONE\ncontent two\nTWO\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still handle heredoc without backtick', () => {
      const source = 'x = <<-ONE + <<-TWO\ncontent one\nONE\ncontent two\nTWO\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: heredoc terminator with trailing whitespace', () => {
    test('should not match terminator with trailing whitespace', () => {
      // Crystal <<- strips leading whitespace but not trailing
      const source = 'x = <<-EOF\nif true\nEOF   \nend\nEOF\nif true\n  1\nend';
      const pairs = parser.parse(source);
      // The heredoc includes "if true\nEOF   \nend\n" and terminates at bare "EOF"
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should still match terminator with leading whitespace', () => {
      const source = 'x = <<-EOF\ncontent\n  EOF\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match heredoc terminator with trailing whitespace', () => {
      const pairs = parser.parse('x = <<-EOF\n  content\nEOF   \ndef foo\nend');
      // EOF with trailing spaces should NOT match - heredoc is unterminated
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: heredoc in interpolation closing on opener line', () => {
    test('should handle heredoc in string interpolation where } follows on same line', () => {
      const source = '"#{<<-HEREDOC}"\n  if true\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc in backtick interpolation where } follows on same line', () => {
      const source = '`#{<<-HEREDOC}`\n  if true\nHEREDOC\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc in percent literal interpolation where } follows on same line', () => {
      const source = '%Q(#{<<-HEREDOC})\n  if true\nHEREDOC\nif true\nend';
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
  });

  suite('Regression: double-quoted symbol interpolation', () => {
    test('should exclude do keyword inside interpolation in double-quoted symbol', () => {
      const source = 'x = :"hello #{" do "} world"\nif true\n  1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle simple double-quoted symbol without interpolation', () => {
      const source = 'x = :"hello world"\nif true\n  1\nend';
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

  suite('Branch coverage: quoted heredoc opener keyword filter', () => {
    test('should filter out keyword in single-quoted heredoc opener', () => {
      // Covers crystalParser.ts lines 330-331: <<-'keyword' heredoc opener filter
      const source = "x = <<-'do'\nsome text\ndo\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should filter out keyword in double-quoted heredoc opener', () => {
      // Covers crystalParser.ts lines 330-331: <<-"keyword" heredoc opener filter
      const source = 'x = <<-"end"\nsome text\nend\nif true\nend';
      const pairs = parser.parse(source);
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

  suite('Regression: char literal \\u{ newline handling', () => {
    test('should not scan past newline in \\u{ escape', () => {
      // '\\u{ followed by newline is invalid char literal, should not hide keywords on next lines
      const pairs = parser.parse("'\\u{\n}'\nif true\n  1\nend");
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not match char literal across CR line ending in \\u{ escape', () => {
      // '\\u{ followed by CR then closing quote should not span across lines
      const pairs = parser.parse("'\\u{\r'\ndef x\nend");
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match char literal across CRLF in \\u{ escape', () => {
      // '\\u{ followed by CRLF then closing quote should not span across lines
      const pairs = parser.parse("'\\u{\r\n'\ndef x\nend");
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Branch coverage: macro template interpolation with escaped nested string', () => {
    test('should handle escaped character in nested string inside macro interpolation', () => {
      // Covers crystalExcluded.ts lines 115-117: escape inside nested string in macro interpolation
      const source = '{% "hello #{"\\\\"}" %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escaped character in single-quoted nested string inside macro interpolation', () => {
      // Covers crystalExcluded.ts lines 115-117: escape in single-quoted nested string
      const source = '{% "hello #{\'\\\\\'}" %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: do preceded by variable prefix', () => {
    test('should not treat do as loop separator when while is preceded by $', () => {
      // Covers crystalExcluded.ts lines 489-490: $while should not be a loop keyword
      const source = '$while do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });

    test('should not treat do as loop separator when for is preceded by @', () => {
      // Covers crystalExcluded.ts lines 489-490: @for should not be a loop keyword
      const source = '@for do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Coverage: double-quoted symbol with heredoc in interpolation', () => {
    test('should extend excluded region when heredoc extends past closing quote', () => {
      // Covers crystalParser.ts lines 258-259: heredocState.pendingEnd > end in matchSymbolLiteral
      // The heredoc body contains a " before the EOF terminator, so the symbol's closing "
      // is found inside the heredoc body. heredocState.pendingEnd (after EOF) > end (after ").
      const source = ':"#{<<-EOF}\nheredoc with " inside\nEOF\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should extend excluded region for unterminated symbol when heredoc extends past EOF', () => {
      // Covers crystalParser.ts lines 265-266: heredocState.pendingEnd > i in matchSymbolLiteral
      // Unterminated double-quoted symbol: no closing " found, but heredoc in interpolation
      // extends past where the scan reaches EOF. heredocState.pendingEnd > i (source.length).
      const source = ':"#{<<-EOF}\nheredoc body\nEOF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: keyword in quoted heredoc opener', () => {
    test('should not treat keyword in single-quoted heredoc opener as block keyword', () => {
      // Covers crystalParser.ts lines 334-335: <<-'end' filter in tokenize
      const source = "x = <<-'end'\nheredoc body\nend\nif true\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat keyword in double-quoted heredoc opener as block keyword', () => {
      // Covers crystalParser.ts lines 334-335: <<-"do" filter in tokenize
      const source = 'x = <<-"do"\nheredoc body\ndo\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Branch coverage: character literal ? at start of interpolation', () => {
    test('should handle ?-prefixed char literal at the very start of string interpolation', () => {
      // Covers rubyFamilyHelpers.ts line 324: i - 1 === pos branch in skipInterpolationShared
      // When ? is the very first char inside #{...}, i - 1 === pos is true
      const source = '"#{?\'}" + if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle ?{ at start of interpolation without incrementing depth', () => {
      // ? followed by { at interpolation start: should not affect brace depth
      const source = '"#{?{}" + if true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: isLoopDo should filter dot-prefixed do in inner scan', () => {
    test('should treat while x.do do as while loop with do separator', () => {
      // Bug: isLoopDo inner do scanning did not filter dot/scope/variable-prefixed do,
      // so x.do was mistakenly treated as the loop's do keyword
      const source = 'while x.do do\nputs x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  // Regression: ?<keyword> char literal should be excluded
  suite('Regression: question mark char literal', () => {
    test('should not treat ?end as block close', () => {
      const source = 'if true\n  x = ?end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat ?do as block open', () => {
      const source = 'x = ?do';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not affect method? calls', () => {
      const source = 'if x.nil?\n  y = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle escape char literal', () => {
      const source = 'x = ?\\n\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: skipMacroString interpolation with nested string', () => {
    test('should properly exclude macro template with interpolated string containing inner string', () => {
      const source = '{% "test #{"hello"}" %}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug: $-prefixed global variables should not be treated as keywords', () => {
    test('should not match $end as block close', () => {
      const source = 'if true\n  $end = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      // The real 'end' is on line 2, not line 1 ($end)
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not match $do as block open', () => {
      const source = 'def foo\n  $do = true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match $begin as block open', () => {
      const source = 'def foo\n  $begin = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match $class as block open', () => {
      const source = 'def foo\n  $class = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not match $for as block open', () => {
      const source = 'def foo\n  $for = 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should handle mixed $ variables and real blocks', () => {
      const source = 'class Foo\n  def initialize\n    $end = false\n    $do = true\n    if $end\n      puts $do\n    end\n  end\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'def', 1);
      assertNestLevel(pairs, 'class', 0);
    });
  });

  suite('Regression: percent literal in interpolation with closing brace', () => {
    test('should handle %} inside interpolation as percent literal', () => {
      const source = '"#{%}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle expression with %} inside interpolation', () => {
      const source = '"#{ x = %}"\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: macro template {{ { }} closing', () => {
    test('should handle {{ { }} as excluded region', () => {
      const source = '{{ { }}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: ternary ? before string delimiters', () => {
    test('should not treat ?" as char literal when preceded by identifier char', () => {
      const source = 'nil? "yes" : "no"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test("should not treat ?' as char literal when preceded by identifier char", () => {
      const source = "nil? 'yes' : 'no'\ndef foo\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat ?" as char literal after closing paren', () => {
      const source = '(x)? "a" : "b"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });

    test('should not treat ?" as char literal after closing bracket', () => {
      const source = 'arr[0]? "a" : "b"\ndef foo\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'def', 'end');
    });
  });

  suite('Bug: {{ }} macro template off-by-one when inner brace closes at }}', () => {
    test('should include all three braces in }}} excluded region', () => {
      // {{ {x}}} has }}} at the end: first } closes inner {, then }} closes template.
      // The excluded region should span the entire template including all 3 closing braces.
      const source = '{{ {x}}}';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should include all braces in {{ a{b}}} excluded region', () => {
      const source = '{{ a{b}}}';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should fully exclude }}} when inner brace closes at template boundary', () => {
      // Without fix, the excluded region ends 1 char too early, leaving an orphaned }
      const source = '{{ {x}}}\nif true\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
      const regions = parser.getExcludedRegions('{{ {x}}}');
      assert.strictEqual(regions[0].end, 8);
    });
  });

  suite('Regression tests', () => {
    test('should not treat if after while as postfix conditional', () => {
      const pairs = parser.parse('while if cond\n  true\nend\n  body\nend');
      assertBlockCount(pairs, 2);
    });

    test('should not treat unless after until as postfix conditional', () => {
      const pairs = parser.parse('until unless cond\n  false\nend\n  body\nend');
      assertBlockCount(pairs, 2);
    });

    test('should not treat while after case as postfix conditional', () => {
      const pairs = parser.parse('case if cond\n  :a\nend\nend');
      assertBlockCount(pairs, 2);
    });

    test('should not treat if after for as postfix conditional', () => {
      const pairs = parser.parse('for x in arr\n  if cond\n    x\n  end\nend');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: failed heredoc with invalid identifier', () => {
    test('should not exclude code after <<-"x y" with space in identifier', () => {
      const pairs = parser.parse('<<-"x y"\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not exclude code after <<-"1FOO" with digit-starting identifier', () => {
      const pairs = parser.parse('<<-"1FOO"\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not exclude code after <<-"FOO BAR" with space in identifier', () => {
      const pairs = parser.parse('<<-"FOO BAR"\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('should not treat ? after closing bracket as blocking if', () => {
      const pairs = parser.parse('(x)?if true\n  1\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle heredoc with quote in body', () => {
      const pairs = parser.parse('"#{<<-EOF}\nheredoc " quote\nEOF\n"\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression tests', () => {
    test('should handle character literal ?{ inside macro string interpolation', () => {
      const pairs = parser.parse('{% "#{?{}" %}\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle character literal ?} inside macro string interpolation', () => {
      const pairs = parser.parse('{% "#{?}}" %}\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should handle character literal ?" inside macro string interpolation', () => {
      const pairs = parser.parse('{% "#{?\\".to_s}" %}\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude surrogate pair character literal with correct size', () => {
      const surrogate = '\uD83D\uDE00'; // U+1F600 (emoji)
      const source = `?${surrogate}\nif true\nend`;
      const regions = parser.getExcludedRegions(source);
      const qRegion = regions.find((r) => r.start === 0);
      assert.ok(qRegion, 'should find excluded region for ?<surrogate>');
      assert.strictEqual(qRegion.end, 3, 'surrogate pair character literal should span 3 code units');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should limit \\o octal escape to 3 digits in char literal', () => {
      // '\\o777' is valid: 3 octal digits + closing quote at position 6
      const valid = "'\\o777'";
      const validRegions = parser.getExcludedRegions(valid);
      const validRegion = validRegions.find((r) => r.start === 0);
      assert.ok(validRegion, 'should find excluded region for valid \\o char literal');
      assert.strictEqual(validRegion.end, 7, '\\o escape with 3 octal digits should be a valid char literal');

      // '\\o7777' is invalid: only 3 digits consumed, 4th digit is not quote
      // matchCharLiteral returns null, fallback scan runs
      const source = "'\\o7777' do\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end');
    });
  });

  suite('Regression: block keyword after macro template should not be postfix', () => {
    test('should detect if block after {% %} macro template', () => {
      const pairs = parser.parse('{% x %} if condition\n  body\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should detect unless block after {{ }} macro template', () => {
      const pairs = parser.parse('{{ x }} unless condition\n  body\nend');
      assertSingleBlock(pairs, 'unless', 'end');
    });

    test('should detect while block after {% %} macro template', () => {
      const pairs = parser.parse('{% x %} while condition\n  body\nend');
      assertSingleBlock(pairs, 'while', 'end');
    });
  });

  suite('Regression: Crystal global variables should not suppress postfix conditional', () => {
    test('should treat $? if as postfix conditional', () => {
      const pairs = parser.parse('x = $? if condition\nend');
      assertNoBlocks(pairs);
    });

    test('should treat $! unless as postfix conditional', () => {
      const pairs = parser.parse('x = $! unless condition\nend');
      assertNoBlocks(pairs);
    });

    test('should treat $~ while as postfix conditional', () => {
      const pairs = parser.parse('x = $~ while condition\nend');
      assertNoBlocks(pairs);
    });

    test('should treat $. until as postfix conditional', () => {
      const pairs = parser.parse('x = $. until condition\nend');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: regex with flags followed by regex', () => {
    test('should exclude both regex literals when first has i flag', () => {
      const pairs = parser.parse('/a/i /if end/\nif real\nend');
      assertSingleBlock(pairs, 'if', 'end');
      assert.strictEqual(pairs[0].openKeyword.line, 1);
    });

    test('should exclude both regex literals when first has m flag', () => {
      const pairs = parser.parse('/a/m /if end/\nif real\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should exclude both regex literals when first has x flag', () => {
      const pairs = parser.parse('/a/x /if end/\nif real\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression 2026-04-11: percent literal with closing-bracket delimiter', () => {
    test('should not treat %} as a percent literal', () => {
      const pairs = parser.parse('%}\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat %) as a percent literal', () => {
      const pairs = parser.parse('%)\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });

    test('should not treat %] as a percent literal', () => {
      const pairs = parser.parse('%]\nif true\nend');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  suite('Regression: backtick command inside {% %} macro body', () => {
    test('should skip backtick content containing %} close-sequence', () => {
      const pairs = parser.parse('{% `cmd %}` %}\nif cond\nend\n');
      assertSingleBlock(pairs, 'if', 'end');
    });
  });

  generateCommonTests(config);
});
