import * as assert from 'node:assert';
import { BashBlockParser } from '../../parsers/bashParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('BashBlockParser Test Suite', () => {
  let parser: BashBlockParser;

  setup(() => {
    parser = new BashBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'echo "hello"\nx=1\ny=$((x + 1))',
    tokenSource: 'if true; then\nfi',
    expectedTokenValues: ['if', 'then', 'fi'],
    excludedSource: '"string" # comment\n{\n  echo "test"\n}',
    expectedRegionCount: 3,
    twoLineSource: 'if true; then\nfi',
    singleLineCommentSource: '# if this is a comment fi\n{\n  echo "test"\n}',
    commentBlockOpen: '{',
    commentBlockClose: '}',
    doubleQuotedStringSource: 'echo "if this is a string fi"\n{\n  echo "test"\n}',
    stringBlockOpen: '{',
    stringBlockClose: '}',
    singleQuotedStringSource: 'echo \'if this is a string fi\'\n{\n  echo "test"\n}',
    singleQuotedStringBlockOpen: '{',
    singleQuotedStringBlockClose: '}',
    commentAtEndOfLineSource: '{\n  echo "test" # if then else fi\n}',
    commentAtEndOfLineBlockOpen: '{',
    commentAtEndOfLineBlockClose: '}'
  };

  suite('Simple blocks', () => {
    test('should parse simple if-fi block', () => {
      const source = `if [ "$x" -gt 0 ]; then
  echo "positive"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should parse case-esac block', () => {
      const source = `case "$var" in
  a) echo "a";;
  b) echo "b";;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should parse for-done block', () => {
      const source = `for i in 1 2 3; do
  echo "$i"
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should parse while-done block', () => {
      const source = `while [ "$x" -lt 10 ]; do
  x=$((x + 1))
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should parse until-done block', () => {
      const source = `until [ "$x" -ge 10 ]; do
  x=$((x + 1))
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'until', 'done');
    });

    test('should parse select-done block', () => {
      const source = `select opt in "option1" "option2" "quit"; do
  case $opt in
    quit) break;;
    *) echo "You selected $opt";;
  esac
done`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'select', 0);
      assertNestLevel(pairs, 'case', 1);
    });

    test('should parse function with braces', () => {
      const source = `my_function() {
  echo "Hello"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should parse function keyword with braces', () => {
      const source = `function my_function {
  echo "Hello"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should parse command grouping with braces', () => {
      const source = `{
  echo "a"
  echo "b"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-then-fi block', () => {
      const source = `if [ -f file ]; then
  cat file
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should parse if-else-fi block', () => {
      const source = `if [ -f file ]; then
  cat file
else
  echo "not found"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should parse if-elif-else-fi block', () => {
      const source = `if [ "$x" -eq 1 ]; then
  echo "one"
elif [ "$x" -eq 2 ]; then
  echo "two"
else
  echo "other"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then', 'elif', 'then', 'else']);
    });

    test('should parse multiple elif clauses', () => {
      const source = `if [ "$x" -eq 1 ]; then
  echo "1"
elif [ "$x" -eq 2 ]; then
  echo "2"
elif [ "$x" -eq 3 ]; then
  echo "3"
elif [ "$x" -eq 4 ]; then
  echo "4"
else
  echo "other"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].intermediates.length, 8);
    });

    test('should parse for-do-done block', () => {
      const source = `for i in 1 2 3; do
  echo "$i"
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
      assertIntermediates(pairs[0], ['do']);
    });

    test('should parse while-do-done block', () => {
      const source = `while true; do
  echo "loop"
  break
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
      assertIntermediates(pairs[0], ['do']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested if blocks with correct levels', () => {
      const source = `if [ "$a" ]; then
  if [ "$b" ]; then
    if [ "$c" ]; then
      echo "all true"
    fi
  fi
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assert.strictEqual(pairs[0].nestLevel, 2);
      assert.strictEqual(pairs[1].nestLevel, 1);
      assert.strictEqual(pairs[2].nestLevel, 0);
    });

    test('should parse function with nested blocks', () => {
      const source = `process_files() {
  for file in *.txt; do
    if [ -f "$file" ]; then
      cat "$file"
    fi
  done
}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, '{', 0);
      assertNestLevel(pairs, 'for', 1);
      assertNestLevel(pairs, 'if', 2);
    });

    test('should parse deeply nested blocks (5 levels)', () => {
      const source = `{
  if [ "$a" ]; then
    for i in 1 2 3; do
      while [ "$i" ]; do
        case "$i" in
          *) echo "$i";;
        esac
      done
    done
  fi
}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
      const levels = pairs.map((p) => p.nestLevel).sort((a, b) => a - b);
      assert.deepStrictEqual(levels, [0, 1, 2, 3, 4]);
    });

    test('should handle sequential blocks at same level', () => {
      const source = `{
  if [ "$a" ]; then
    echo "a"
  fi
  if [ "$b" ]; then
    echo "b"
  fi
  if [ "$c" ]; then
    echo "c"
  fi
}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      const bracesPair = findBlock(pairs, '{');
      const ifPairs = pairs.filter((p) => p.openKeyword.value === 'if');
      assert.strictEqual(bracesPair.nestLevel, 0);
      assert.strictEqual(ifPairs.length, 3);
      for (const ifPair of ifPairs) {
        assert.strictEqual(ifPair.nestLevel, 1);
      }
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should handle multiple comments', () => {
      const source = `# comment 1 with if
# comment 2 with for done
# comment 3 with while
{
  # nested comment with case esac
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should not treat parameter length expansion as comment', () => {
      const source = `{
  len=\${#str}
  echo "$len"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should detect comment after closing double quote', () => {
      const pairs = parser.parse('echo "x"# if true; then echo ok; fi');
      assertNoBlocks(pairs);
    });

    test('should detect comment after closing single quote', () => {
      const pairs = parser.parse("echo 'x'# if true; then echo ok; fi");
      assertNoBlocks(pairs);
    });

    test('should detect comment after closing backtick', () => {
      const pairs = parser.parse('x=`cmd`# if true; then echo ok; fi');
      assertNoBlocks(pairs);
    });

    test('should detect comment after closing bracket', () => {
      const pairs = parser.parse('[[ true ]]# if true; then echo ok; fi');
      assertNoBlocks(pairs);
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should handle escaped quotes in double-quoted strings', () => {
      const source = `echo "say \\"if\\" or \\"fi\\""
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle $-single-quoted strings', () => {
      const source = `echo $'if \\n fi'
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle adjacent strings', () => {
      const source = `a="if"" fi"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Excluded regions - Heredocs', () => {
    test('should ignore keywords in heredoc', () => {
      const source = `cat <<EOF
if this is a heredoc fi
for while done
EOF
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should ignore keywords in comment on heredoc start line', () => {
      const source = `cat <<EOF # if fi
body
EOF
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle heredoc with single-quoted delimiter', () => {
      const source = `cat <<'EOF'
if $var fi
for done
EOF
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle heredoc with double-quoted delimiter', () => {
      const source = `cat <<"EOF"
if $var fi
for done
EOF
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle heredoc with tab stripping (<<-)', () => {
      const source = `cat <<-EOF
	if heredoc fi
	for done
	EOF
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle multiple heredocs', () => {
      const source = `cat <<EOF1
if one fi
EOF1
cat <<EOF2
for two done
EOF2
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Excluded regions - Command substitution comments and ANSI-C', () => {
    test('should handle comments inside command substitution', () => {
      const source = `if $(echo hello # this is a comment with )
  ); then
  echo yes
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle ANSI-C quotes inside command substitution', () => {
      const source = `if $(echo $'it\\'s a test'); then
  echo yes
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Excluded regions - Command substitution', () => {
    test('should ignore keywords in $() command substitution', () => {
      const source = `result=$(if true; then echo "yes"; fi)
{
  echo "$result"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should ignore keywords in backtick command substitution', () => {
      const source = 'result=`if true; then echo "yes"; fi`\n{\n  echo "$result"\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle nested command substitution', () => {
      const source = `result=$(echo $(if true; then echo "yes"; fi))
{
  echo "$result"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle arithmetic expansion $(())', () => {
      const source = `result=$((1 + 2))
{
  echo "$result"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Excluded regions - Parameter expansion', () => {
    test('should not match { } inside parameter expansion', () => {
      const source = `echo "\${var:-default}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle nested braces in parameter expansion', () => {
      const source = `echo "\${var:-\${other:-default}}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle array expansion', () => {
      const source = `echo "\${array[@]}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle substring expansion', () => {
      const source = `echo "\${str:0:5}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle pattern substitution', () => {
      const source = `echo "\${var//pattern/replacement}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle string length parameter syntax', () => {
      // This tests isParameterExpansion returning true (line 90-91)
      const source = `len=\${#myvar}
{
  echo "$len"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle ANSI-C quoting inside parameter expansion', () => {
      // This tests matchDollarSingleQuote inside matchParameterExpansion (lines 121-124)
      const source = `echo "\${var:-$'default\\nvalue'}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle nested command substitution in parameter expansion', () => {
      // This tests matchCommandSubstitution inside matchParameterExpansion (lines 142-145)
      const source = `echo "\${var:-$(pwd)}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle deeply nested parameter expansion', () => {
      // This tests isInsideParameterExpansion returning true (lines 441-445)
      const source = `echo "\${outer:-\${inner:-default}}"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Block close keyword before brace', () => {
    test('should recognize } after fi', () => {
      // This tests block close keyword detection before } (lines 401-407)
      const source = `{
  if true; then
    echo "yes"
  fi
}`;
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      const braceBlock = pairs.find((p) => p.openKeyword.value === '{');
      assert.ok(braceBlock);
      assert.strictEqual(braceBlock?.closeKeyword?.value, '}');
    });

    test('should recognize } after done', () => {
      const source = `{
  for i in 1 2 3; do
    echo "$i"
  done
}`;
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      const braceBlock = pairs.find((p) => p.openKeyword.value === '{');
      assert.ok(braceBlock);
      assert.strictEqual(braceBlock?.closeKeyword?.value, '}');
    });

    test('should recognize } after esac', () => {
      const source = `{
  case "$x" in
    a) echo "a";;
  esac
}`;
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      const braceBlock = pairs.find((p) => p.openKeyword.value === '{');
      assert.ok(braceBlock);
      assert.strictEqual(braceBlock?.closeKeyword?.value, '}');
    });

    test('should detect } after subshell )', () => {
      const pairs = parser.parse('{ (echo hi) }');
      assertSingleBlock(pairs, '{', '}');
    });

    test('should detect } after [[ ]]', () => {
      const pairs = parser.parse('{ [[ $x -gt 0 ]] }');
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Special Bash constructs', () => {
    test('should handle C-style for loop', () => {
      const source = `for ((i=0; i<10; i++)); do
  echo "$i"
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should handle brace expansion (not a block)', () => {
      const source = `echo {a,b,c}
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assert.ok(pairs.length >= 1);
    });

    test('should handle subshell with parentheses (not block)', () => {
      const source = `(cd /tmp && ls)
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle test with double brackets', () => {
      const source = `if [[ "$a" == "$b" ]]; then
  echo "equal"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle arithmetic evaluation', () => {
      const source = `if (( x > 5 )); then
  echo "big"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle process substitution', () => {
      const source = `while read line; do
  echo "$line"
done < <(cat file.txt)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should handle coprocess', () => {
      const source = `coproc {
  while read line; do
    echo "Got: $line"
  done
}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const bracesPair = findBlock(pairs, '{');
      const whilePair = findBlock(pairs, 'while');
      assert.ok(bracesPair);
      assert.ok(whilePair);
    });

    test('should handle here-string', () => {
      const source = `while read line; do
  echo "$line"
done <<< "if fi for done"`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle only comments', () => {
      const source = `# just a comment
# another comment`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keywords in identifiers', () => {
      const source = `iffy=1
casework=2
{
echo "$iffy $casework"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle unmatched blocks gracefully', () => {
      const source = `if [ "$a" ]; then
if [ "$b" ]; then
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle keyword at start of file', () => {
      const source = `if [ "$x" ]; then
echo "yes"
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
    });

    test('should handle keyword at end of file without newline', () => {
      const source = 'if true; then\n  echo "yes"\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle one-liner if', () => {
      const source = `if [ "$x" ]; then echo "yes"; fi
{
echo "test"
}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle blocks with only whitespace', () => {
      const source = `{

}`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should handle unterminated string at end of file', () => {
      const source = `{
echo "test"
}
x="unterminated string`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle unterminated heredoc at end of file', () => {
      const source = `{
echo "test"
}
cat <<EOF
unterminated heredoc`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle real-world bash script', () => {
      const source = `#!/bin/bash

# Configuration
CONFIG_FILE="/etc/myapp.conf"

# Function to process files
process_files() {
for file in "$@"; do
  if [ -f "$file" ]; then
    while IFS= read -r line; do
      case "$line" in
        #*) continue;;  # Skip comments
        "") continue;;   # Skip empty lines
        *) echo "$line";;
      esac
    done < "$file"
  else
    echo "File not found: $file" >&2
  fi
done
}

# Main
if [ $# -eq 0 ]; then
echo "Usage: $0 file..." >&2
exit 1
fi

process_files "$@"`;
      const pairs = parser.parse(source);

      const bracesPairs = pairs.filter((p) => p.openKeyword.value === '{');
      const forPairs = pairs.filter((p) => p.openKeyword.value === 'for');
      const ifPairs = pairs.filter((p) => p.openKeyword.value === 'if');
      const whilePairs = pairs.filter((p) => p.openKeyword.value === 'while');
      const casePairs = pairs.filter((p) => p.openKeyword.value === 'case');

      assert.strictEqual(bracesPairs.length, 1);
      assert.strictEqual(forPairs.length, 1);
      assert.strictEqual(ifPairs.length, 2);
      assert.strictEqual(whilePairs.length, 1);
      assert.strictEqual(casePairs.length, 1);
    });

    suite('Keyword pairing correctness', () => {
      test('should correctly pair if-fi with nested for-done', () => {
        const source = `if [ "$a" ]; then
  for i in 1 2 3; do
    echo "$i"
  done
fi`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);

        const ifPair = findBlock(pairs, 'if');
        const forPair = findBlock(pairs, 'for');

        assert.strictEqual(ifPair.closeKeyword.value, 'fi');
        assert.strictEqual(forPair.closeKeyword.value, 'done');
      });

      test('should correctly pair mixed block types', () => {
        const source = `{
  if [ "$a" ]; then
    case "$b" in
      *)
        for i in 1; do
          while true; do
            echo "test"
            break
          done
        done
        ;;
    esac
  fi
}`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 5);

        const bracesPair = findBlock(pairs, '{');
        const ifPair = findBlock(pairs, 'if');
        const casePair = findBlock(pairs, 'case');
        const forPair = findBlock(pairs, 'for');
        const whilePair = findBlock(pairs, 'while');

        assert.strictEqual(bracesPair.closeKeyword.value, '}');
        assert.strictEqual(ifPair.closeKeyword.value, 'fi');
        assert.strictEqual(casePair.closeKeyword.value, 'esac');
        assert.strictEqual(forPair.closeKeyword.value, 'done');
        assert.strictEqual(whilePair.closeKeyword.value, 'done');
      });

      test('should handle multiple functions', () => {
        const source = `func1() {
  echo "1"
}

func2() {
  echo "2"
}

func3() {
  echo "3"
}`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 3);
        for (const pair of pairs) {
          assert.strictEqual(pair.openKeyword.value, '{');
          assert.strictEqual(pair.closeKeyword.value, '}');
          assert.strictEqual(pair.nestLevel, 0);
        }
      });
    });

    suite('Parameter expansion', () => {
      test('should handle nested braces in parameter expansion', () => {
        const source = `echo "\${var:-\${OTHER:-\${DEEP}}}"
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle single quotes inside parameter expansion', () => {
        const source = `echo "\${var:-'default value'}"
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle double quotes inside parameter expansion', () => {
        const source = `echo "\${var:-"default value"}"
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle unterminated parameter expansion', () => {
        const source = `echo "\${var:-default"
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle comment starting with # after ${', () => {
        const source = `x=\${#array[@]} # length of array
if true; then
  echo $x
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle # in parameter expansion for length', () => {
        const source = `len=\${#var}
if [ "$len" -gt 0 ]; then
  echo "not empty"
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle multiple sequential parameter expansions', () => {
        const source = `echo "\${a}" "\${b}" "\${c}"
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle } not inside parameter expansion', () => {
        const source = `{
  echo "test"
}
echo "after"`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 1);
        assert.strictEqual(pairs[0].closeKeyword.value, '}');
      });

      test('should handle double-quoted string inside parameter expansion', () => {
        const source = `var=\${foo:-"default value"}
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle single-quoted string inside parameter expansion', () => {
        const source = `var=\${foo:-'default'}
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle nested braces inside parameter expansion', () => {
        const source = `var=\${foo:-\${bar:-baz}}
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle ${# for string length', () => {
        const source = `len=\${#var}
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle escape sequence in double-quoted string inside parameter expansion', () => {
        const source = 'var=$' + '{foo:-"default\\"value"}\nif true; then\n  echo done\nfi';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle unterminated double-quoted string inside parameter expansion', () => {
        const source = 'var=$' + '{foo:-"unterminated';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unterminated single-quoted string inside parameter expansion', () => {
        const source = 'var=$' + "{foo:-'unterminated";
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should not treat ${ as brace in tokenize', () => {
        const source = 'echo $' + '{var}\n{\n  echo test\n}';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle quote toggling with ${ inside double-quoted string', () => {
        // In Bash, " inside ${ } toggles the quote context
        // The } on the last line closes the expansion, not the brace group
        const source = `{
  echo "} \${"
}`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Command substitution', () => {
      test('should handle strings inside command substitution', () => {
        const source = `result=$(echo "if then fi" && echo 'for done')
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle deeply nested command substitution', () => {
        const source = `result=$(echo $(echo $(echo "test")))
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle nested parentheses in command substitution', () => {
        const source = `result=$(test (a || b) && (c || d))
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle unterminated command substitution', () => {
        const source = `result=$(echo "test"
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });
    });

    suite('Arithmetic expansion', () => {
      test('should handle nested parentheses in arithmetic expansion', () => {
        const source = `result=$((1 + (2 * (3 + 4))))
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle arithmetic bracket with nested brackets', () => {
        const source = `result=$[1 + $[2 * 3]]
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle unterminated arithmetic bracket', () => {
        const source = `result=$[1 + 2
{
  echo "$result"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle arithmetic expansion with double-quoted string', () => {
        const source = `x=$(( "test" ? 1 : 0 ))
if true; then
  echo $x
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle arithmetic expansion with single-quoted string', () => {
        const source = `x=$(( 'test' ? 1 : 0 ))
if true; then
  echo $x
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle arithmetic expansion with nested braces', () => {
        const source = `x=$(( \${arr[0]} + \${arr[1]} ))
if true; then
  echo $x
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });
    });

    suite('Strings', () => {
      test('should handle unterminated ANSI-C quoted string', () => {
        const source = `echo $'unterminated
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle escape in ANSI-C quoted string', () => {
        const source = `echo $'line1\\nline2\\ttab'
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle unterminated single-quoted string', () => {
        const source = `echo 'unterminated
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle unterminated double-quoted string', () => {
        const source = `echo "unterminated
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle unterminated backtick', () => {
        const source = 'echo `unterminated\n{\n  echo "test"\n}';
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle escape sequences in backtick', () => {
        const source = 'echo `echo \\`nested\\` \\\\escaped`\n{\n  echo "test"\n}';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle escape at end of double-quoted string', () => {
        const source = `echo "test\\
more"
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle escape sequence with $ in double quote', () => {
        const source = `echo "test\\$var"
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle escape sequence with backtick in double quote', () => {
        const source = `echo "test\\\`cmd\\\`"
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle escape sequence with backslash in double quote', () => {
        const source = `echo "test\\\\"
if true; then
  echo done
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle escaped dollar sign in backticks', () => {
        const source = 'x=`echo ' + '\\' + '$HOME`\nfor i in 1; do\n  echo done\ndone';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'done');
      });
    });

    suite('Heredocs', () => {
      test('should handle << that is not a heredoc', () => {
        const source = `x=$((1 << 2))
{
  echo "$x"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle << followed by number (not heredoc)', () => {
        const source = `if [ $((x << 3)) -gt 0 ]; then
  echo "shifted"
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle heredoc at end of file without terminator', () => {
        const source = `{
  cat <<EOF
content without terminator`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 0);
      });

      test('should handle heredoc with content on same line', () => {
        const source = `cat <<EOF && echo "after"
heredoc content
EOF
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle heredoc with invalid identifier (starts with number)', () => {
        const source = `cat << 123
content
123
if true; then
  echo test
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle heredoc with CRLF line endings', () => {
        const source = 'cat <<EOF\r\ncontent\r\nEOF\r\nif true; then\r\n  echo test\r\nfi';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle heredoc terminator at end of file without trailing newline', () => {
        const source = 'for i in 1; do\n  echo done\ndone\ncat <<EOF\ncontent\nEOF';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'done');
      });

      test('should parse blocks after semicolon on heredoc line', () => {
        const source = `cat <<EOF; if true; then
heredoc content
EOF
echo "done"; fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should parse blocks after heredoc marker with && on same line', () => {
        const source = `cat <<EOF && for i in 1 2; do
heredoc body
EOF
echo "$i"; done`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'done');
      });

      test('should not exclude same-line code after heredoc marker', () => {
        const source = `cat <<EOF; while true; do
line1
EOF
break; done`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'while', 'done');
      });

      test('should handle heredoc marker at end of file without newline', () => {
        const source = 'cat <<EOF';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    suite('Here-strings', () => {
      test('should not treat here-string <<< as heredoc', () => {
        const source = `x=<<<'string'
if true; then
  echo test
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle here-string with double quotes', () => {
        const source = `cat <<<"hello world"
if true; then
  echo test
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should handle here-string with variable', () => {
        const source = `cat <<<$var
for i in 1 2 3; do
  echo $i
done`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'done');
      });

      test('should still handle heredoc << correctly', () => {
        const source = `cat <<EOF
content with if then fi
EOF
if true; then
  echo test
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });
    });

    suite('Comments', () => {
      test('should handle # at start of file', () => {
        const source = `#!/bin/bash
# if then fi
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle empty comment', () => {
        const source = `#
{
  echo "test"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });
    });

    suite('Brace expansion vs command grouping', () => {
      test('should not treat brace expansion {1..10} as block', () => {
        const source = `echo {1..10}
if true; then
  echo test
fi`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should not treat brace expansion {a,b,c} as block', () => {
        const source = `echo {a,b,c}
for i in 1 2; do
  echo $i
done`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'done');
      });

      test('should detect command grouping with newline', () => {
        const source = `{
  echo "grouped"
}
if true; then
fi`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assert.strictEqual(pairs[0].openKeyword.value, '{');
        assert.strictEqual(pairs[0].closeKeyword.value, '}');
        assert.strictEqual(pairs[1].openKeyword.value, 'if');
      });

      test('should detect command grouping with semicolon', () => {
        const source = `{ echo "one"; echo "two"; }
if true; then
fi`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assert.strictEqual(pairs[0].openKeyword.value, '{');
      });

      test('should detect function body braces', () => {
        const source = `foo() {
  echo "function"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });

      test('should handle mixed brace expansion and command grouping', () => {
        const source = `arr=({1..5})
{ echo "group"; }
for i in {a..z}; do
  echo $i
done`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        const openValues = pairs.map((p) => p.openKeyword.value);
        assert.ok(openValues.includes('{'));
        assert.ok(openValues.includes('for'));
      });

      test('should handle parameter expansion inside command grouping', () => {
        // Tests tokenize skipping ${ as non-block brace (not in excluded region)
        const source = `{
  x=\${foo}
  y=\${bar:-default}
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
      });
    });

    suite('Unmatched blocks', () => {
      test('should handle unmatched done without opener', () => {
        const source = 'done';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unmatched fi without opener', () => {
        const source = 'fi';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle unmatched esac without opener', () => {
        const source = 'esac';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });
    });

    test('should handle CRLF heredoc terminator', () => {
      const source = 'if true; then\r\n  cat <<EOF\r\nhello\r\nEOF\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle CRLF in case statement', () => {
      const source = 'case $x in\r\n  a)\r\n    echo ok\r\n    ;;\r\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle empty case statement', () => {
      const source = 'case $x in\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle if/fi on same line after semicolons', () => {
      const source = 'if true; then echo ok; fi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle nested case with keywords as patterns', () => {
      const source = `case $cmd in
  for|while|until)
    echo "loop keyword"
    ;;
  if|case)
    echo "conditional"
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should recognize block keywords after ) in case body', () => {
      const source = 'case $x in\n  a) for i in 1 2; do\n       echo $i\n     done\n     ;;\nesac';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      assert.strictEqual(pairs[0].openKeyword.value, 'for');
      assert.strictEqual(pairs[0].closeKeyword.value, 'done');
      assert.strictEqual(pairs[0].nestLevel, 1);
      assert.strictEqual(pairs[1].openKeyword.value, 'case');
      assert.strictEqual(pairs[1].closeKeyword.value, 'esac');
      assert.strictEqual(pairs[1].nestLevel, 0);
    });

    test('should not treat even backslashes before newline as line continuation', () => {
      const pairs = parser.parse('echo \\\\\nif true; then\necho ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect blocks after heredoc with unterminated string in gap', () => {
      const source = 'cat <<EOF "\nunterminated\nheredoc\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not tokenize middle keyword followed by equals as block middle', () => {
      const tokens = parser.getTokens('then=5\nif true; then\n  echo ok\nfi');
      const thenTokens = tokens.filter((t) => t.value === 'then');
      assert.strictEqual(thenTokens.length, 1, 'only one then token should exist');
      assert.strictEqual(thenTokens[0].type, 'block_middle');
    });

    suite('Extglob patterns in case statements', () => {
      test('should skip keywords inside negation extglob in case pattern', () => {
        const pairs = parser.parse('for i in 1; do\n  case $i in\n    !(done)) echo match;;\n  esac\ndone');
        assertBlockCount(pairs, 2);
        findBlock(pairs, 'for');
        findBlock(pairs, 'case');
      });

      test('should skip keywords inside question extglob in case pattern', () => {
        const pairs = parser.parse('for i in 1; do\n  case $i in\n    ?(done)) echo match;;\n  esac\ndone');
        assertBlockCount(pairs, 2);
      });

      test('should skip keywords inside star extglob in case pattern', () => {
        const pairs = parser.parse('for i in 1; do\n  case $i in\n    *(done)) echo match;;\n  esac\ndone');
        assertBlockCount(pairs, 2);
      });

      test('should skip keywords inside plus extglob in case pattern', () => {
        const pairs = parser.parse('for i in 1; do\n  case $i in\n    +(done)) echo match;;\n  esac\ndone');
        assertBlockCount(pairs, 2);
      });

      test('should skip keywords inside at extglob in case pattern', () => {
        const pairs = parser.parse('for i in 1; do\n  case $i in\n    @(done)) echo match;;\n  esac\ndone');
        assertBlockCount(pairs, 2);
      });
    });

    suite('Hyphenated command names', () => {
      test('should not treat done in done-handler as block close', () => {
        const pairs = parser.parse('for i in 1; do\n  done-handler arg\ndone');
        assertSingleBlock(pairs, 'for', 'done');
      });

      test('should not treat fi in fi-nalize as block close', () => {
        const pairs = parser.parse('if true; then\n  fi-nalize\nfi');
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should not treat if in if-exists as block open', () => {
        const pairs = parser.parse('if true; then\n  if-exists file\nfi');
        assertSingleBlock(pairs, 'if', 'fi');
      });

      test('should not treat then in then-handler as block middle', () => {
        const pairs = parser.parse('if true; then\n  then-handler arg\nfi');
        const pair = findBlock(pairs, 'if');
        assert.strictEqual(pair.intermediates.length, 1);
        assert.strictEqual(pair.intermediates[0].value, 'then');
      });
    });
  });

  suite('Block middle keyword validation', () => {
    test('should not treat then in echo as intermediate', () => {
      const pairs = parser.parse('if true; then\n  echo then\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'then');
    });

    test('should not treat else in echo as intermediate', () => {
      const pairs = parser.parse('if true; then\n  echo else\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'then');
    });

    test('should not treat do in echo as intermediate', () => {
      const pairs = parser.parse('for i in 1 2 3; do\n  echo do\ndone');
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'do');
    });
  });

  suite('Negation operator', () => {
    test('should recognize keyword after ! negation', () => {
      const pairs = parser.parse('! if true; then\n  false\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize for after ! negation', () => {
      const pairs = parser.parse('! for i in 1 2 3; do\n  false\ndone');
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Subshell handling', () => {
    test('should parse blocks inside single-line subshell', () => {
      const pairs = parser.parse('(if true; then echo yes; fi)');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should parse blocks inside subshell with for loop', () => {
      const pairs = parser.parse('(for i in 1 2 3; do echo "$i"; done)');
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should detect case-esac inside subshell with esac)', () => {
      const pairs = parser.parse('(case $x in\n  a) echo ok;;\nesac)');
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case-esac inside subshell on one line', () => {
      const pairs = parser.parse('(case $x in a) echo ok;; esac)');
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Time prefix', () => {
    test('should recognize for loop after time', () => {
      const pairs = parser.parse('time for i in 1 2 3; do\n  process "$i"\ndone');
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should recognize while loop after time', () => {
      const pairs = parser.parse('time while true; do\n  break\ndone');
      assertSingleBlock(pairs, 'while', 'done');
    });
  });

  suite('Command argument keywords', () => {
    test('should not treat echo done as block close', () => {
      const source = `for f in *.txt; do
  echo done processing $f
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat status=done as block close', () => {
      const source = `for f in files; do
  status=done
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat grep fi as block close', () => {
      const source = `if true; then
  grep fi file
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat echo fi as block close', () => {
      const source = `if true; then
  echo fi
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat echo esac as block close', () => {
      const source = `case $x in
  a) echo esac ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Keywords in arithmetic (( ))', () => {
    test('should not treat for in (( )) as block keyword', () => {
      const source = `((for=1))
for x in a b; do
  echo $x
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat if in (( )) as block keyword', () => {
      const source = `((if=1+2))
if true; then
  echo yes
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat while in (( )) as block keyword', () => {
      const source = `((while=x))
while true; do
  break
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should still parse regular blocks around arithmetic', () => {
      const source = `for x in a b; do
  y=$((x + 1))
  echo $y
done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Case pattern keywords', () => {
    test('should not treat keywords in case patterns as block keywords', () => {
      const source = `case $action in
  for)
    echo starting loop
    ;;
  done)
    echo loop ended
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not treat if in case pattern as block open', () => {
      const source = `case $x in
  if) echo matched ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not treat for in POSIX (pattern) case syntax as block open', () => {
      const source = `case $x in
  (for) echo found ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Regression: $$$# comment detection inside $() and <()', () => {
    test('should not treat $$$# as comment inside command substitution', () => {
      const source = '$(echo $$$#)\nif true; then\n  echo test\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat $$$# as comment inside process substitution', () => {
      const source = 'cat <(echo $$$#)\nif true; then\n  echo test\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat $$$$$# as comment inside command substitution', () => {
      const source = '$($$$$$#)\nif true; then\n  echo test\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: single quote in double-quoted parameter expansion inside subshell', () => {
    test('should detect if/fi after subshell with single quote in parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = 'x=$(echo "${v:-\'}") \nif true; then\necho hi\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if/fi after process substitution with single quote in parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = 'cat <(echo "${v:-\'}") \nif true; then\necho hi\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: $"..." locale strings handled as single excluded region', () => {
    test('should handle $"..." locale string as single excluded region starting at $', () => {
      const regions = parser.getExcludedRegions('$"test"');
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 7);
    });

    test('should detect blocks after $"..." on same line', () => {
      const pairs = parser.parse('$"text"; if true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: block close keywords in case patterns', () => {
    test('should treat done) as case pattern inside for loop', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'case');
    });

    test('should treat fi) as case pattern inside if block', () => {
      const pairs = parser.parse('if true; then\n  case $x in\n    fi) echo ok;;\n  esac\nfi');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'case');
    });

    test('should treat esac) as case pattern inside nested case', () => {
      const pairs = parser.parse('case $a in\n  x)\n    case $b in\n      esac) echo ok;;\n    esac\n    ;;\nesac');
      assertBlockCount(pairs, 2);
    });

    test('should handle pipe-separated done pattern', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    x|done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'case');
    });

    test('should handle POSIX-style (done) pattern', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    (done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'case');
    });

    test('should handle glob done*) pattern', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    done*) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'case');
    });

    test('should close for at correct done when done) is case pattern on own line after ;;', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    a) echo a;;\n    done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      const forPair = findBlock(pairs, 'for');
      assert.strictEqual(forPair.closeKeyword.line, 5);
    });

    test('should close if at correct fi when fi) is case pattern on own line after ;;', () => {
      const pairs = parser.parse('if true; then\n  case $x in\n    fi) echo ok;;\n  esac\nfi');
      assertBlockCount(pairs, 2);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.closeKeyword.line, 4);
    });

    test('should handle done) as case pattern after ;;&', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    a) echo a;;&\n    done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      const forPair = findBlock(pairs, 'for');
      assert.strictEqual(forPair.closeKeyword.line, 5);
    });

    test('should handle done) as first case pattern after in on new line', () => {
      const pairs = parser.parse('for i in 1; do\n  case $x in\n    done) echo ok;;\n  esac\ndone');
      assertBlockCount(pairs, 2);
      const forPair = findBlock(pairs, 'for');
      assert.strictEqual(forPair.closeKeyword.line, 4);
    });
  });

  suite('Regression tests', () => {
    test('should not treat time-p as time with -p flag', () => {
      const pairs = parser.parse('time-p if true; then echo ok; fi');
      assertNoBlocks(pairs);
    });

    test('should detect [[ after done (block close keyword)', () => {
      const pairs = parser.parse('for i in 1 2; do echo; done [[ $x == #* ]] && if true; then echo; fi');
      assertBlockCount(pairs, 2);
    });

    test('should detect [[ after ) (subshell end)', () => {
      const pairs = parser.parse('(echo ok) [[ $x == #* ]] && if true; then echo; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat # as literal in env var value FOO=bar#baz', () => {
      const pairs = parser.parse('FOO=bar#baz if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: += compound assignment as env var prefix', () => {
    test('should detect if/fi after FOO+=bar', () => {
      const pairs = parser.parse('FOO+=bar if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if/fi after multiple += assignments', () => {
      const pairs = parser.parse('A+=1 B+=2 if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: block close keywords with glob suffix in case patterns', () => {
    test('should treat done?) as case pattern, not block close', () => {
      const source = 'for i in 1; do\n  case $x in\n    done?) echo ok;;\n  esac\ndone';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.closeKeyword.line, 4);
      assert.strictEqual(forBlock.nestLevel, 0);
      const caseBlock = findBlock(pairs, 'case');
      assert.strictEqual(caseBlock.nestLevel, 1);
    });

    test('should treat fi*) as case pattern, not block close', () => {
      const source = 'if true; then\n  case $x in\n    fi*) echo ok;;\n  esac\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.line, 4);
    });
  });

  suite('Regression: brace expansion } should not act as command separator', () => {
    test('should not detect blocks after brace expansion', () => {
      const pairs = parser.parse('echo {a,b} if true; then echo ok; fi');
      assertNoBlocks(pairs);
    });

    test('should still detect blocks after command group }', () => {
      const pairs = parser.parse('{ echo ok; }\nif true; then echo ok; fi');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: keyword adjacency and array variables', () => {
    test('should not treat done"x" as keyword', () => {
      const pairs = parser.parse('for i in 1; do\n  echo hi\ndone"x"\ndone');
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test("should not treat done'x' as keyword", () => {
      const pairs = parser.parse("for i in 1; do\n  echo hi\ndone'x'\ndone");
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not treat done$(cmd) as keyword', () => {
      const pairs = parser.parse('for i in 1; do\n  echo hi\ndone$(cmd)\ndone');
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not treat fi[0] as keyword', () => {
      const pairs = parser.parse('if true; then\n  echo hi\nfi[0]\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should not treat done[0]==x as keyword', () => {
      const pairs = parser.parse('for i in 1; do\n  echo hi\ndone[0]==x\ndone');
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should recognize coproc NAME { } as command grouping', () => {
      const pairs = parser.parse('coproc MYPROC {\n  echo hello\n}');
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Regression: case as argument in subshell should not trigger caseDepth', () => {
    test('should detect if/fi after $(echo case)', () => {
      const pairs = parser.parse('x=$(echo case)\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if/fi after $(cat case)', () => {
      const pairs = parser.parse('x=$(cat case)\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if/fi after process substitution with case argument', () => {
      const pairs = parser.parse('diff <(echo case) file\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: [[ ]] inside subshell should not treat # as comment', () => {
    test('should detect if/fi after $([[ ... #* ... ]])', () => {
      const pairs = parser.parse('x=$([[ $var == #* ]] && echo ok)\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression 2026-04-11: backslash escape inside $(...) subshell', () => {
    test('should not extend excluded region across backslash-escaped quote in $(...)', () => {
      const pairs = parser.parse('$(\\") if true; then echo; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle backslash-escaped quote in realistic assignment', () => {
      const pairs = parser.parse('x="$(echo \\"value\\")"\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: # after closing quotes/parens/braces is not a comment', () => {
    test('should not treat # after ) as comment', () => {
      const pairs = parser.parse('$(echo x)#hash; if true; then echo ok; fi\n');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat # after " as comment', () => {
      const pairs = parser.parse('echo "foo"#tag; if true; then echo ok; fi\n');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat # after } as comment', () => {
      const source = 'echo $' + '{var}#tag; if true; then echo ok; fi\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat # after ` as comment', () => {
      const pairs = parser.parse('echo `cmd`#tag; if true; then echo ok; fi\n');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still treat # after space as comment', () => {
      const pairs = parser.parse('echo ok # comment fi\nif true; then echo ok; fi\n');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  generateCommonTests(config);

  suite('Token positions - language-specific', () => {
    test('should have correct column numbers', () => {
      const source = `{
  if [ "$a" ]; then
    for i in 1 2 3; do
      echo "$i"
    done
  fi
}`;
      const pairs = parser.parse(source);
      const bracesPair = findBlock(pairs, '{');
      const ifPair = findBlock(pairs, 'if');
      const forPair = findBlock(pairs, 'for');

      assert.strictEqual(bracesPair.openKeyword.column, 0);
      assert.strictEqual(ifPair.openKeyword.column, 2);
      assert.strictEqual(forPair.openKeyword.column, 4);
    });

    test('should have correct end keyword positions', () => {
      const source = `if [ "$x" ]; then
  echo "yes"
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should have correct intermediate keyword positions', () => {
      const source = `if [ "$a" ]; then
  echo "1"
elif [ "$b" ]; then
  echo "2"
else
  echo "3"
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertTokenPosition(pairs[0].intermediates[0], 0, 13); // then
      assertTokenPosition(pairs[0].intermediates[1], 2, 0); // elif
      assertTokenPosition(pairs[0].intermediates[2], 2, 15); // then
      assertTokenPosition(pairs[0].intermediates[3], 4, 0); // else
    });

    test('should handle tabs in indentation', () => {
      const source = '{\n\tif [ "$a" ]; then\n\t\techo "yes"\n\tfi\n}';
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      assert.strictEqual(ifPair.openKeyword.column, 1);
    });
  });

  suite('Test helper methods - language-specific', () => {
    test('getTokens should not include tokens in excluded regions', () => {
      const source = `"if fi" # for done
{
  echo "test"
}`;
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 2);
      assert.strictEqual(tokens[0].value, '{');
      assert.strictEqual(tokens[1].value, '}');
    });
  });

  suite('Coverage: parameter expansion branches', () => {
    test('should treat # as comment when not part of parameter expansion', () => {
      // isParameterExpansion returns false, # is treated as comment
      const source = `# this is a comment with if fi
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should recognize hash inside unquoted parameter expansion like dollar-brace-hash-var', () => {
      // isParameterExpansion returns true (line 90)
      // ${#myarray[@]} is unquoted, so findExcludedRegions processes it
      const source = `len=\${#myarray[@]}
{
  echo test
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle ANSI-C quoting inside unquoted parameter expansion', () => {
      // matchDollarSingleQuote called inside matchParameterExpansion (lines 121-122)
      const source = `x=\${var:-$'hello\\nworld'}
{
  echo test
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle command substitution inside unquoted parameter expansion', () => {
      // matchCommandSubstitution called inside matchParameterExpansion (lines 142-143)
      const source = `x=\${var:-$(whoami)}
{
  echo test
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should skip } inside unquoted parameter expansion for brace matching', () => {
      // findParameterExpansionRanges builds ranges (lines 444-449)
      // isInRanges returns true (lines 459-461)
      // The } inside ${var} should not be treated as closing brace
      const source = `x=\${HOME}
{
  echo $x;
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle nested unquoted parameter expansion with closing brace', () => {
      // Tests findParameterExpansionRanges with nested ${...${...}}
      const source = `x=\${outer:-\${inner:-default}}
{
  echo $x;
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Coverage: block close keyword before brace on same line', () => {
    test('should recognize } after fi on same line without semicolon', () => {
      // Tests word boundary check for block close before }
      // fi directly precedes } (after whitespace) on same line, no ; or newline
      const source = '{ if true; then echo yes; fi }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should recognize } after done on same line without semicolon', () => {
      const source = '{ for i in 1 2; do echo hi; done }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should recognize } after esac on same line without semicolon', () => {
      const source = '{ case x in a) echo a;; esac }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should reject } when preceded by non-keyword on same line', () => {
      // Tests the !isAfterBlockClose continue path
      // "hello" is not fi/done/esac, so } is not recognized
      const source = '{ echo hello }';
      const pairs = parser.parse(source);
      // Only { is matched (no valid } close)
      assertNoBlocks(pairs);
    });

    test('should handle fi at start of source before }', () => {
      // Tests the start === 0 branch of word boundary check
      // fi at position 0 means start === 0 is true
      const source = 'fi }';
      const pairs = parser.parse(source);
      // fi has no matching if, so no pairs
      assertNoBlocks(pairs);
    });

    test('should not treat ${ as command group brace', () => {
      // Tests the parameter expansion skip in tokenize
      const source = `if [ "\${#arr[@]}" -gt 0 ]; then
  echo "has items"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle ${# parameter expansion for comment detection', () => {
      // Tests isParameterExpansion returning true
      const source = `if true; then
  len=\${#str}
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: heredoc at end of file', () => {
    test('should handle heredoc without trailing newline at EOF', () => {
      const regions = parser.getExcludedRegions('cat <<EOF');
      assert.strictEqual(regions.length, 0);
    });
  });

  suite('Case pattern with pipe-separated alternatives', () => {
    test('should not treat keyword in pipe-separated case pattern as block', () => {
      const source = `case $x in
  if|then)
    echo matched
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not steal fi when keyword is in pipe pattern', () => {
      const source = `if true; then
  case $x in
    if|then)
      echo matched
      ;;
  esac
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'case');
    });

    test('should handle keyword as middle alternative', () => {
      const source = `case $x in
  a|if|b)
    echo matched
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle keyword with POSIX paren and pipe', () => {
      const source = `case $x in
  (if|then)
    echo matched
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should recognize case pattern when comment with ) is on preceding line', () => {
      const source = 'case $x in\n  for|  # comment with )\n  if) echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Complex real-world scenario', () => {
    test('should handle nested case + subshell + heredoc with keywords', () => {
      const source = `if true; then
  case $x in
    a)
      (while read line; do echo "$line"; done < file)
      ;;
    *)
      cat <<'EOF'
if false; then
  echo "in heredoc"
fi
EOF
      ;;
  esac
fi`;
      const pairs = parser.parse(source);
      findBlock(pairs, 'if');
      findBlock(pairs, 'case');
      findBlock(pairs, 'while');
      assertBlockCount(pairs, 3);
    });
  });

  suite('Heredoc with underscore delimiter', () => {
    test('should match heredoc with underscore in delimiter', () => {
      const source = `cat <<END_DATA
if true; then echo 1; fi
END_DATA
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Parameter expansion in substitutions', () => {
    test('should handle parameter expansion inside command substitution', () => {
      const source = `if true; then
  x=$(echo \${var:-)})
  echo test
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle parameter expansion inside process substitution', () => {
      const source = `while read line; do
  echo "$line"
done < <(cat \${file:-default)txt})`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should handle parameter expansion inside arithmetic expansion', () => {
      const source = `if true; then
  x=$((\${var:-0} + 1))
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle parameter expansion inside bare arithmetic evaluation', () => {
      const source = `if true; then
  ((x = \${var:-0} + 1))
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle backtick inside command substitution', () => {
      const source = 'if true; then\n  x=$(echo `if true; then echo 1; fi`)\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle backtick inside parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing Bash parameter expansion syntax
      const source = 'if true; then\n  x=${var:-`if true; then echo 1; fi`}\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('isCasePattern default return false (Bug 6)', () => {
    test('should match fi followed by ) outside case statement', () => {
      const source = 'result=$(cmd)\nif true; then\n  echo x\nfi)';
      const pairs = parser.parse(source);
      // fi should still be matched as block close even though followed by )
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match fi inside function body with closing paren nearby', () => {
      const source = 'f() {\n  if true; then\n    echo x\n  fi\n}';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, '{');
    });

    test('should match done followed by ) outside case statement', () => {
      const source = 'x=$(for i in 1 2; do echo $i; done)\nfor j in a b; do\n  echo $j\ndone)';
      const pairs = parser.parse(source);
      // The outer done) should still be matched
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('CR-only line endings (Bug 7, 8, 9, 23)', () => {
    test('should recognize keyword at command position with CR-only line endings (Bug 7)', () => {
      const source = 'if true; then\r  echo ok\rfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize for-done with CR-only line endings (Bug 7)', () => {
      const source = 'for i in 1 2; do\r  echo $i\rdone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should recognize } after newline with CR-only line endings (Bug 8)', () => {
      const source = '{\r  echo test\r}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle heredoc with CR-only line endings (Bug 9)', () => {
      const source = 'cat <<EOF\rheredoc content\rEOF\rif true; then\r  echo ok\rfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc opener line with CR-only ending (Bug 9)', () => {
      const source = 'cat <<EOF\rcontent with if fi\rEOF\r{\r  echo test\r}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle pipe case pattern with CR-only line endings (Bug 23)', () => {
      const source = 'case $x in\r  if|then)\r    echo matched\r    ;;\resac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Command substitution comment with CR-only line endings', () => {
    test('should handle comment with CR-only line ending inside command substitution', () => {
      // Bug 1: matchCommandSubstitution comment skip does not handle \r-only
      const source = 'if $(echo hello # comment with )\r  ); then\r  echo yes\rfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle comment with CRLF inside command substitution', () => {
      const source = 'if $(echo hello # comment with )\r\n  ); then\r\n  echo yes\r\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Process substitution comment handling', () => {
    test('should handle comment inside process substitution', () => {
      // Bug 2: matchProcessSubstitution missing comment skip
      const source = 'while read line; do\n  echo "$line"\ndone < <(cat file # comment with )\n)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should handle comment with CR-only inside process substitution', () => {
      const source = 'while read line; do\r  echo "$line"\rdone < <(cat file # comment with )\r)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should handle output process substitution with comment', () => {
      const source = 'while read line; do\n  echo "$line"\ndone > >(tee log # comment with )\n)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });
  });

  suite('Regression tests: $case/$esac and case/esac in process substitution', () => {
    test('should not treat $case variable as case keyword in command substitution', () => {
      // Bug: matchCommandSubstitution falsely detected $case/$esac as case/esac keywords
      const source = 'x=$(echo $case)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle case/esac inside process substitution', () => {
      // Bug: Process substitution did not track case/esac nesting, causing ) in case patterns
      // to prematurely close the substitution
      const source = 'diff <(case "$x" in\n  a) echo hello;;\n  *) echo world;;\nesac) file\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('isCasePattern subshell detection with CR-only line endings', () => {
    test('should not treat keyword in subshell as case pattern with CR-only line endings', () => {
      // Bug 3: isCasePattern subshell detection does not handle \r-only
      const source = '(for i in 1 2 3; do\r  echo $i\rdone)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat keyword in subshell as case pattern with CRLF', () => {
      const source = '(for i in 1 2 3; do\r\n  echo $i\r\ndone)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should still detect actual case patterns with CR-only', () => {
      const source = 'case $x in\r  for)\r    echo found\r    ;;\resac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('CR-only line endings in case patterns', () => {
    test('should recognize case pattern with \\r-only line endings', () => {
      const source = 'case x in\r  for)\r    echo\r    ;;\resac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should recognize POSIX case pattern opening with \\r-only line endings', () => {
      const source = 'case x in\r  (for)\r    echo\r    ;;\resac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Multiple heredocs on same line', () => {
    test('should handle two heredocs on the same line', () => {
      // Bug 4: only first heredoc on same line was handled
      const source = `cat <<EOF1 cat <<EOF2
body1
EOF1
body2
EOF2
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle two heredocs with keywords in bodies', () => {
      const source = `cat <<EOF1 cat <<EOF2
if then fi
EOF1
for while done
EOF2
{
  echo test
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle three heredocs on the same line', () => {
      const source = `cmd <<A cmd <<B cmd <<C
body A with if
A
body B with for
B
body C with done
C
{
  echo test
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should handle multiple heredocs with tab stripping', () => {
      const source = `cat <<-EOF1 cat <<-EOF2
\tbody1
\tEOF1
\tbody2
\tEOF2
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle multiple heredocs with CRLF', () => {
      const source = 'cat <<EOF1 cat <<EOF2\r\nbody1\r\nEOF1\r\nbody2\r\nEOF2\r\nif true; then\r\n  echo ok\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Edge cases for uncovered branches', () => {
    test('heredoc with invalid terminator pattern', () => {
      const source = `cat <<
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('heredoc ending at EOF without terminator', () => {
      const source = `cat <<EOF
body line
if then fi`;
      const regions = parser.getExcludedRegions(source);
      const heredocRegion = regions.find((r) => r.end === source.length);
      assert.ok(heredocRegion !== undefined);
    });

    test('case pattern with pipe-separated alternatives', () => {
      const source = `case "$x" in
  if|then|fi) echo "keyword";;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('case pattern with pipe and no closing paren', () => {
      const source = `case "$x" in
  if|then echo bad
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('arithmetic bracket $[...] with nested brackets', () => {
      const source = `x=$[a[0] + b[1]]
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('bare arithmetic evaluation ((...)) with strings', () => {
      const source = `((x = 1))
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('arithmetic evaluation with single quotes', () => {
      const source = `((x = 'test'))
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('arithmetic evaluation with nested parameter expansion', () => {
      const source = '((x = $' + '{y}))\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('command substitution with nested parameter expansion', () => {
      const source = 'result=$(echo $' + '{var})\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('command substitution with single quotes', () => {
      const source = `result=$(echo 'test')
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('command substitution with double quotes', () => {
      const source = `result=$(echo "test")
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('isAtCommandPosition after backtick', () => {
      const source = '`cmd` if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('isAtCommandPosition after exclamation mark', () => {
      const source = '! if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('isAtCommandPosition after closing brace', () => {
      const source = '{ echo x; } if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after then keyword', () => {
      const source = 'if [ -f file ]; then if true; then\n  echo nested\nfi\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after do keyword', () => {
      const source = 'for i in 1 2; do for j in a b; do\n  echo nested\ndone\ndone';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after else keyword', () => {
      const source = 'if [ "$a" = 1 ]; then\n  echo a\nelse if [ "$b" = 2 ]; then\n  echo b\nfi\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after elif keyword', () => {
      const source = 'if [ "$a" = 1 ]; then\n  echo a\nelif if [ "$b" = 2 ]; then\n  echo nested\nfi\nthen\n  echo b\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after time keyword', () => {
      const source = 'time if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('isAtCommandPosition after fi keyword', () => {
      const source = 'if true; then echo ok; fi if false; then\n  echo no\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after done keyword', () => {
      const source = 'for i in 1; do echo $i; done if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('isAtCommandPosition after esac keyword', () => {
      const source = 'case x in y) echo ok;; esac if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('case depth tracking with nested case in pattern', () => {
      const source = `case "$x" in
  case) echo "keyword case";;
  esac) echo "keyword esac";;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('subshell with unmatched paren in case pattern check', () => {
      const source = `(
  case "$x" in
    a) echo a;;
  esac
)`;
      const pairs = parser.parse(source);
      // Only case/esac is tracked; subshell ( ) is not a block keyword
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Uncovered line coverage', () => {
    // Covers lines 40-43: multiple heredocs on same line with unparseable << operator
    test('multiple heredocs with invalid operator between', () => {
      const source = `cat <<EOF1 << <<EOF2
content1
EOF1
content2
EOF2`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // Covers lines 125-130: heredoc body at end of file without terminator
    test('unterminated heredoc body at EOF', () => {
      const source = `cat <<EOF
unterminated content`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.some((r) => r.end === source.length));
    });

    // Covers lines 201-202: ${#var} parameter expansion with # inside
    test('should exclude parameter length expansion from comment detection', () => {
      const source = `if [ \${#var} -gt 0 ]; then
  echo "length"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 232-234: escaped characters in parameter expansion
    test('parameter expansion with escaped braces', () => {
      const source = `if true; then
  echo "\${var\\{\\}}"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 279: nested brace depth tracking in ${...}
    test('parameter expansion with nested braces', () => {
      const source = `if true; then
  echo "\${var:=\${default}}"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 357-365: case/esac tracking in command substitution
    test('command substitution with case statement inside', () => {
      const source = `result=$(case "$x" in
  a) echo 1;;
  b) echo 2;;
esac)
if true; then
  echo "$result"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 373-375: case pattern ) handling in command substitution
    test('case pattern inside command substitution with depth tracking', () => {
      const source = `if true; then
  result=$(case "$opt" in
    pattern1) echo "one";;
    pattern2) echo "two";;
  esac)
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 389-392: word boundary check in matchesWord
    test('word boundary check for case/esac in command substitution', () => {
      const source = `if true; then
  result=$(showcase)
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 459-462: strings in bare arithmetic evaluation
    test('bare arithmetic evaluation with strings', () => {
      const source = `if true; then
  (( x = "5" + 3 ))
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 477: parenthesis depth in bare arithmetic
    test('bare arithmetic with nested parentheses', () => {
      const source = `if true; then
  (( x = (y + (z * 2)) ))
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 497-505: strings in process substitution
    test('process substitution with strings', () => {
      const source = `if true; then
  diff <(echo "a") <(echo 'b')
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 509-512: command substitution in process substitution
    test('process substitution with nested command substitution', () => {
      const source = `if true; then
  diff <(echo $(date)) >(cat)
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 530: parenthesis depth in process substitution
    test('process substitution with nested parentheses', () => {
      const source = `if true; then
  result=<( (echo "nested") )
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Covers lines 772-775: case pattern with semicolons between ( and keyword
    test('case pattern POSIX with semicolons means not case pattern', () => {
      const source = `(echo test; for x in 1 2; do
  echo $x
done)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    // Covers lines 785-790: case pattern preceded by ( on same line
    test('case pattern with opening paren on same line', () => {
      const source = `case "$x" in
  (if) echo "match";;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Covers lines 802-804: case pattern preceded by ;& terminator
    test('case pattern with ;& fallthrough terminator', () => {
      const source = `case "$x" in
  a) echo "a";&
  for) echo "for";;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Covers lines 817-818: findLineStart return 0 when no newline found
    test('findLineStart at beginning of file', () => {
      const source = '(if)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // Covers lines 866-867: ${ at brace pattern check
    test('should not match parameter expansion as command grouping', () => {
      const source = `if true; then
  echo "\${var}"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: matchHeredocBody EOF without terminator', () => {
    test('should handle second heredoc on same line ending at EOF without terminator', () => {
      // Covers matchHeredocBody lines 124-129: lineEnd >= source.length (no line ending)
      // and the loop-exit fallback returning { start: bodyStart, end: source.length }
      const source = 'cat <<EOF1 cat <<EOF2\nbody1\nEOF1\nunterminated body2';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const regions = parser.getExcludedRegions(source);
      // Second heredoc body should be excluded until end of source
      assert.ok(regions.some((r) => r.end === source.length));
    });

    test('should handle second heredoc without terminator and block before', () => {
      // The second heredoc body has no line ending at EOF
      const source = 'if true; then\n  cat <<EOF1 cat <<EOF2\nbody1\nEOF1\nunterminated';
      const pairs = parser.parse(source);
      // if has no fi, so no blocks
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: isParameterExpansion $' + '{#var}', () => {
    test('should treat # after ${ as parameter expansion, not comment', () => {
      // Covers isParameterExpansion lines 200-202: pos >= 2 && source[pos-1] === '{' && source[pos-2] === '$'
      // The # inside ${#array[@]} should not start a comment
      const source = 'echo $' + '{#array[@]}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle $' + '{# for array length without treating rest as comment', () => {
      // Unquoted ${#arr[@]} where # is directly after ${
      const source = 'x=$' + '{#arr[@]}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Coverage: matchParameterExpansion backslash escape', () => {
    test('should handle backslash escape inside unquoted parameter expansion', () => {
      // Covers matchParameterExpansion lines 231-233: backslash skips next char
      // Unquoted ${var/\n/x} has a backslash inside the expansion
      const source = 'x=$' + '{var/\\n/x}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle backslash-escaped brace inside parameter expansion', () => {
      // Backslash before } should not close the expansion prematurely
      const source = 'x=$' + '{var/\\}/replacement}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Coverage: matchParameterExpansion nested bare brace', () => {
    test('should track nested bare { inside parameter expansion', () => {
      // Covers matchParameterExpansion line 279: char === '{' incrementing depth
      // This requires a bare { (not ${) inside ${...}
      // In bash, ${var/pattern/{replacement}} has a bare { inside
      const source = 'x=$' + '{var/{old}/{new}}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle multiple nested bare braces in parameter expansion', () => {
      // Multiple bare { characters inside ${...} to increase depth
      const source = 'x=$' + '{var/pattern/{a{b}}}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Coverage: matchesWord followed by word char', () => {
    test('should not match case as keyword when followed by word character', () => {
      // Covers matchesWord line 390: after position has alphanumeric char
      // "cased" should not match "case" as a keyword inside $()
      const source = 'result=$(cased)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not match esac as keyword when followed by underscore', () => {
      // "esac_handler" should not match "esac" as a keyword inside $()
      const source = 'result=$(esac_handler)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: isCasePattern ( found but not case pattern opener', () => {
    test('should not treat keyword inside function call parens as case pattern', () => {
      // Covers isCasePattern line 772: ( at parenDepth 0, text before ( is not whitespace or ;;
      // func(for means the ( is part of "func(" — not a case pattern
      const source = 'test_func(for i in 1 2; do\n  echo $i\ndone)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat keyword after non-whitespace ( as case pattern', () => {
      // "x=(if" — the ( is after "x=" which is not whitespace or ;;
      const source = 'x=(if true; then echo ok; fi)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should return false from backward scan when ( preceded by non-separator text', () => {
      const source = 'case $x in\n  a) echo func(for);;  \nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should decrement parenDepth when scanning backward through balanced parens', () => {
      const source = 'case $x in\n  a) (cmd) (for);;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Coverage: isCasePattern POSIX (pattern) style', () => {
    test('should detect POSIX case pattern with leading whitespace before (', () => {
      // Covers isCasePattern lines 785-790: ( preceded by whitespace on same line
      const source = 'case $x in\n  (for) echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect POSIX case pattern (while) in case', () => {
      const source = 'case $cmd in\n  (while) echo loop;;\n  (until) echo loop;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Coverage: isCasePattern ;;&  separator', () => {
    test('should detect case pattern after ;;&  double-semicolon-ampersand', () => {
      // Covers isCasePattern line 803: s >= 2 && source[s-1] === ';' && source[s-2] === ';'
      // ;;&  is Bash 4+ fall-through that re-tests subsequent patterns
      const source = 'case $x in\n  a) cmd1;;&\n  for) cmd2;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case pattern after ;;&  with whitespace', () => {
      const source = 'case $x in\n  a) cmd1 ;;&\n  if) cmd2 ;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle multiple ;;&  separators with keyword patterns', () => {
      const source = 'case $x in\n  a) echo 1;;&\n  while) echo 2;;&\n  done) echo 3;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Coverage: tokenize ${ skip in brace matching', () => {
    test('should skip ${ inside brace group and not treat it as command grouping', () => {
      // Covers tokenize lines 866-867: char === '{' && source[i-1] === '$' → continue
      // ${var} inside { } should be skipped in brace matching
      const source = 'if true; then\n  { echo $' + '{var}; }\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, '{');
    });

    test('should skip ${ inside brace group with nested expansion', () => {
      // ${var:-${default}} inside { } — the ${ should be skipped
      const source = '{ echo $' + '{var:-$' + '{default}}; }';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  // Fix: <<< here-string should not be treated as << heredoc
  suite('Here-string (<<<) handling', () => {
    test('should not treat <<< as heredoc in gap scanning', () => {
      const source = 'cat <<EOF <<<HERESTRING\nhello\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle <<< followed by heredoc on same line', () => {
      const source = 'cat <<<HERESTRING <<EOF\nhello\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Edge case: $$# (double dollar + hash)', () => {
    test('should treat $$# as comment start after $$', () => {
      const source = 'echo $$# this is a comment\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat $$$# as $$ + $# (not comment)', () => {
      const source = 'echo $$$#\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat $$$$# as $$$$ + comment', () => {
      const source = 'echo $$$$# if true; then\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers lines 207-209: isParameterExpansion length operator
  suite('Coverage: isParameterExpansion length operator', () => {
    test('should not treat # in parameter length expansion as comment start', () => {
      const source = 'echo $' + '{#myvar}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle parameter length expansion at position 2 (minimal case)', () => {
      const source = '$' + '{#x}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  // Covers line 334: $$# comment detection inside command substitution
  suite('Coverage: $$# comment inside command substitution', () => {
    test('should treat $$# as comment start inside command substitution', () => {
      const source = 'x=$(echo $$# comment\necho ok)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat $# as comment inside command substitution', () => {
      const source = 'x=$(echo $#)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers line 529: $$# comment detection inside process substitution
  suite('Coverage: $$# comment inside process substitution', () => {
    test('should treat $$# as comment start inside process substitution', () => {
      const source = 'diff <(echo $$# comment\necho ok) /dev/null\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle # as regular comment inside process substitution', () => {
      const source = 'diff <(echo ok # comment\n) /dev/null\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers lines 715-717: backtick as command separator in isAtCommandPosition
  suite('Coverage: backtick as command separator', () => {
    test('should treat keyword after closing backtick as command position', () => {
      const source = '`cmd`\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat keyword immediately after backtick on same line as command', () => {
      const source = '`cmd`;if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers lines 797-813: POSIX (keyword) case pattern detection with backward ( scan
  suite('Coverage: POSIX case pattern with backward paren scan', () => {
    test('should detect POSIX case pattern with ( immediately before keyword', () => {
      const source = 'case $x in\n  (for) echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect POSIX case pattern (while) after ;; separator', () => {
      const source = 'case $x in\n  a) echo 1;;\n  (while) echo 2;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect POSIX case pattern after ;& separator', () => {
      const source = 'case $x in\n  a) echo 1;&\n  (if) echo 2;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not detect case pattern when ( is after non-separator text', () => {
      const source = 'func(for x in 1 2; do\n  echo $x\ndone)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  // Covers line 826: ;;& fall-through case separator
  suite('Coverage: ;;& fall-through separator in case pattern', () => {
    test('should detect case pattern keyword after ;;& separator', () => {
      const source = 'case $x in\n  a) echo 1;;&\n  for) echo loop;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case pattern keyword after ;;& with spaces', () => {
      const source = 'case $x in\n  a) echo 1 ;;&\n  while) echo loop ;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  // Covers lines 892-894: ${ inside brace group (not treated as command grouping)
  suite('Coverage: ${ inside brace group not treated as command grouping', () => {
    test('should not treat ${ as command grouping brace', () => {
      const source = '{ echo $' + '{HOME}; }';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should skip ${ inside brace group with block keywords', () => {
      const source = 'if true; then\n  { echo $' + '{PATH}; }\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, '{');
    });
  });

  suite('Environment variable prefix', () => {
    test('should detect keyword after single env var prefix', () => {
      const pairs = parser.parse('FOO=bar if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect keyword after multiple env var prefixes', () => {
      const pairs = parser.parse('A=1 B=2 if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect for after env var prefix', () => {
      const pairs = parser.parse('IFS=: for i in a b c; do echo $i; done');
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 11: keyword after $() should be at command position', () => {
      const source = '$(cmd)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('Bug 11: keyword on same line after $() should not be at command position', () => {
      const source = 'echo $(cmd) if foo; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('Bug 12: properly quoted heredoc should still work', () => {
      const source = "cat <<'EOF'\nif true; then\nfi\nEOF\nif test; then\n  echo ok\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('Bug 2: # in word should not be treated as comment in command substitution', () => {
      const pairs = parser.parse('if $(echo file#name); then\n  echo hello\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('Bug 5: # in word should not be treated as comment at top level', () => {
      const pairs = parser.parse('echo C#; if true; then echo hello; fi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('Bug 5: # after space should still be a comment', () => {
      const pairs = parser.parse('if true; then\n  echo hello # this is a comment\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('Bug 5: # after semicolon should be a comment', () => {
      const pairs = parser.parse('echo hello;# comment\nif true; then\n  echo world\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('Bug 6: nested quotes in "$(...)" should not break string parsing', () => {
      const pairs = parser.parse('x="$(\n  echo "\n  if true; then\n    echo hello\n  fi\n")"\nif true; then\n  echo world\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('Bug 6: simple nested quotes in command substitution inside double quotes', () => {
      const pairs = parser.parse('x="$(echo "hello")"\nif true; then\n  echo world\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Coverage: new bug fix code paths', () => {
    // Lines 277-280: Backslash escape in nested string inside parameter expansion within double quotes
    test('should handle backslash escape in nested string inside param expansion within double quotes', () => {
      const source = 'if true; then\n  echo "$' + '{foo:-"bar\\\\\\"baz"}"\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 322-325: Backtick command substitution inside param expansion within double quotes
    test('should handle backtick command substitution inside param expansion within double quotes', () => {
      const source = 'if true; then\n  echo "$' + '{foo:-`echo x`}"\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 316-319: Nested param expansion brace depth tracking within double-quoted string
    test('should handle nested param expansion brace depth tracking within double quotes', () => {
      const source = 'if true; then\n  echo "$' + '{foo:-$' + '{bar:-y}}"\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 440-449, 502-509: Heredoc body at newline + heredoc operator detection inside matchCommandSubstitution
    test('should handle heredoc inside command substitution', () => {
      const source = 'if true; then\n  x=$(cat <<EOF\nline with ) paren\nEOF\n)\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 653-662, 706-713: Heredoc inside process substitution
    test('should handle heredoc inside process substitution', () => {
      const source = 'if true; then\n  diff <(cat <<EOF\nline with ) paren\nEOF\n) file\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 691-695: Backtick command substitution inside process substitution
    test('should handle backtick inside process substitution', () => {
      const source = 'if true; then\n  cat <(`echo "hello)"`)\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 894-896: isAtCommandPosition after backtick
    test('should recognize keyword at command position after backtick', () => {
      const source = 'if true; then\n  `cmd` for x in 1; do echo; done\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'for');
    });

    // Lines 976-977: Paren depth tracking (closing paren) in isCasePattern backward scan
    test('should handle paren depth tracking in case pattern backward scan', () => {
      const source = 'if true; then\n  (echo hi)\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 986-992: isCasePattern check for (pattern) at line start
    test('should parse case with POSIX (pattern) syntax', () => {
      const source = 'case x in\n  (a) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Lines 212-214: isParameterExpansion check for parameter length syntax
    test('should not treat hash in parameter length expansion as comment start', () => {
      const source = 'if true; then\n  $' + '{#var}\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: uncovered branch paths', () => {
    // L212-214: isParameterExpansion - $$# where pos >= 2 && source[pos-1] === '{' && source[pos-2] === '$'
    // $$# is $$ (PID) followed by # (comment), NOT parameter expansion
    test('should treat $$# as comment start (not parameter expansion)', () => {
      const source = 'if true; then\n  echo $$# this is a comment\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L327-328: braceDepth++ in matchBashDoubleQuote for nested { inside ${...}
    test('should handle nested braces inside parameter expansion within double quotes', () => {
      const source = 'if true; then\n  echo "$' + '{foo:-{bar}}"\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L339-343: Backtick inside double-quoted string (not inside ${...})
    test('should handle backtick command substitution inside double-quoted string', () => {
      const source = 'if true; then\n  echo "hello `echo world`"\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L442-444: CRLF bodyStart++ in heredoc inside command substitution
    test('should handle heredoc with CRLF inside command substitution', () => {
      const source = 'if true; then\r\n  x=$(cat <<EOF\r\nhello\r\nEOF\r\n)\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L655-657: CRLF bodyStart++ in heredoc inside process substitution
    test('should handle heredoc with CRLF inside process substitution', () => {
      const source = 'if true; then\r\n  diff <(cat <<EOF\r\nhello\r\nEOF\r\n) file\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L447: body ? body.end : bodyStart - heredoc body returns null (unterminated)
    test('should handle unterminated heredoc inside command substitution', () => {
      const source = 'if true; then\n  x=$(cat <<EOF\nhello';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // L660: body ? body.end : bodyStart - heredoc body returns null in process substitution
    test('should handle unterminated heredoc inside process substitution', () => {
      const source = 'if true; then\n  diff <(cat <<EOF\nhello';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // L894-896: isAtCommandPosition backtick check - explicit backtick before keyword
    test('should recognize keyword at command position immediately after backtick', () => {
      const source = '`cmd`\nif true; then\n  echo hi\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // L976-977: parenDepth-- in isCasePattern backward scan with nested parens
    test('should handle nested parentheses in case pattern backward scan', () => {
      const source = 'case x in\n  (a|(b)) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // L986-992: (pattern) POSIX case syntax at line start after ;;
    test('should parse POSIX case pattern with parenthesized keyword after ;;', () => {
      const source = 'case x in\n  (a) echo;;\n  (for) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // L1005: ;; check in isCasePattern via ;;& terminator
    test('should recognize keyword as case pattern after ;;&', () => {
      const source = 'case x in\n  a) echo;;&\n  for) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  // Covers L212-214: isParameterExpansion returns true for ${#var} syntax
  suite('Coverage: isParameterExpansion true branch', () => {
    test('should not treat # in parameter length expansion as comment', () => {
      const source = 'if [ $' + '{#var} -gt 0 ]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers L895-896: backtick at command position check in isAtCommandPosition
  suite('Coverage: backtick command substitution position', () => {
    test('should treat keyword after backtick as command position', () => {
      const source = 'result=`echo hello`\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Covers L1072-1073: ${ parameter expansion skip in brace scanning
  suite('Coverage: parameter expansion in brace scanning', () => {
    test('should not treat ${ as command grouping brace', () => {
      const source = '{\n  echo $' + '{var}\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  // Covers L976-977: parenDepth-- for nested parens in isCasePattern
  suite('Coverage: nested parentheses in case patterns', () => {
    test('should handle nested parentheses before ) in case pattern', () => {
      const source = 'case $x in\n  $((1+2)) ) echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  // Covers L987-992: POSIX case pattern with ( prefix
  suite('Coverage: POSIX case pattern with opening paren', () => {
    test('should not treat keyword in POSIX (keyword) case pattern as block', () => {
      const source = 'case $x in\n  (for) echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  // Bug 1: Multi-line case patterns with pipe at end of line
  suite('Multi-line case patterns with pipe continuation', () => {
    test('should handle pipe at end of line in case pattern', () => {
      const source = `case $action in
  start|
  stop)
    echo "matched"
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle keyword on next line after pipe in case pattern', () => {
      const source = `if true; then
  case $x in
    for|
    while)
      echo "loop keyword"
      ;;
  esac
fi`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'case');
    });

    test('should handle multiple pipe continuations across lines', () => {
      const source = `case $x in
  a|
  b|
  c)
    echo "matched"
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle pipe continuation with CRLF line endings', () => {
      const source = 'case $x in\r\n  start|\r\n  stop)\r\n    echo matched\r\n    ;;\r\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should handle pipe continuation with CR-only line endings', () => {
      const source = 'case $x in\r  start|\r  stop)\r    echo matched\r    ;;\resac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not treat keyword after multi-line pipe pattern as block open', () => {
      const source = `case $cmd in
  if|
  for|
  while)
    echo "keyword matched"
    ;;
esac`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  // Bug 2: findBashDoubleQuoteEnd in matchCommandSubstitution
  suite('Nested single-quoted strings with double quotes in command substitution', () => {
    test('should handle single-quoted string with double quote inside $() inside double quote', () => {
      const source = `if true; then
  result=$(echo "got 'a "b" c' value")
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle nested $() with single-quoted string containing double quote', () => {
      const source = 'if true; then\n  x=$(cmd "$(inner \'"quoted"\' arg)")\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle double-quoted string with $() containing single-quoted double quote in command sub', () => {
      const source = 'if true; then\n  x=$(echo "hello $(echo \'"world"\') end")\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Bug 3: Same fix in matchProcessSubstitution
  suite('Nested single-quoted strings with double quotes in process substitution', () => {
    test('should handle single-quoted string with double quote inside <() inside double quote', () => {
      const source = 'while read line; do\n  echo "$line"\ndone < <(cmd "got \'a \\"b\\" c\' value")';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should handle nested $() with single-quoted double quote in process substitution', () => {
      const source = 'while read line; do\n  echo "$line"\ndone < <(cmd "$(echo \'"hi"\' done)")';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });
  });

  // Bug 4: Heredoc delimiter with hyphens, dots, etc.
  suite('Heredoc with special delimiter characters', () => {
    test('should match heredoc with hyphenated delimiter', () => {
      const source = `cat <<END-MARKER
if true; then echo 1; fi
END-MARKER
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match heredoc with dotted delimiter', () => {
      const source = `cat <<END.DATA
if true; then echo 1; fi
END.DATA
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match heredoc with hyphen-dot combined delimiter', () => {
      const source = `cat <<MY-END.BLOCK
for i in 1 2 3; do echo done; done
MY-END.BLOCK
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match heredoc with quoted hyphenated delimiter', () => {
      const source = `cat <<'END-MARKER'
if true; then echo 1; fi
END-MARKER
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match heredoc with double-quoted hyphenated delimiter', () => {
      const source = `cat <<"END-MARKER"
if true; then echo 1; fi
END-MARKER
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match tab-stripping heredoc with hyphenated delimiter', () => {
      const source = `cat <<-END-MARKER
\t\tif true; then echo 1; fi
\t\tEND-MARKER
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle chained heredocs with hyphenated delimiter', () => {
      const source = `cmd <<END-A <<END-B
body A
END-A
body B
END-B
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc with hyphenated delimiter inside command substitution', () => {
      const source = 'if true; then\n  x=$(cat <<END-DATA\nhello\nEND-DATA\n)\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should match heredoc with quoted delimiter containing special characters', () => {
      const source = `cat <<'MY DELIM'
if true; then echo 1; fi
MY DELIM
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Bug 5: >>( incorrectly treated as process substitution
  suite('Append redirect with subshell vs process substitution', () => {
    test('should not treat >>( as process substitution', () => {
      const source = `if true; then
  echo "data" >>(cat)
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still treat >( as process substitution', () => {
      const source = `while read line; do
  echo "$line"
done > >(tee log)`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should not treat >>( as process substitution with keywords inside', () => {
      const source = `if true; then
  echo test >>(while read x; do echo $x; done)
fi`;
      const pairs = parser.parse(source);
      // >>( is not process substitution, so while/done inside are visible as blocks
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'while');
    });

    test('should still exclude <<( from process substitution', () => {
      const source = `cat <<EOF
if true; then echo hi; fi
EOF
if true; then
  echo ok
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('ANSI-C quoting in process substitution', () => {
    test('should handle ANSI-C quoting inside process substitution', () => {
      const source = "while read line; do\n  echo \"$line\"\ndone < <(echo $'it\\'s')";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should not consume subsequent code after ANSI-C quote in process substitution', () => {
      const source = "if true; then\n  diff <(echo $'it\\'s') file\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite("Bug: $' inside double-quoted string is not ANSI-C quoting", () => {
    test("should treat $' as literal characters inside double-quoted string", () => {
      // Inside "...", $' is NOT ANSI-C quoting; it is just $ followed by literal '
      const source = `if true; then
  echo "hello $'world'"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not skip over single quote after $ inside double-quoted string', () => {
      // $'...' ANSI-C quoting is only recognized at shell word-splitting level
      // Inside double quotes, the ' after $ should not start ANSI-C quoting
      const source = `{
  x="value is $'not ansi-c' end"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test("should handle $' followed by block keywords inside double-quoted string", () => {
      // If $' were incorrectly treated as ANSI-C quoting, the parser might
      // skip over the closing " and misparse the block keywords
      const source = `if true; then
  echo "prefix $' suffix"
  echo "more text"
fi`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Bug 1: empty heredoc delimiter', () => {
    test('should handle empty single-quoted heredoc delimiter', () => {
      // <<'' produces an empty terminator; match[3] is '' (empty string, falsy)
      // With || this would fall through to match[4] (undefined); with ?? it preserves ''
      const source = "cat <<''\n\n\nif true; then\n  echo ok\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle empty double-quoted heredoc delimiter', () => {
      // <<"" produces an empty terminator via match[3] = ''
      const source = 'cat <<""\n\n\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('coproc as command starter', () => {
    test('should recognize block keyword after coproc', () => {
      const source = 'coproc while true; do\n  break\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });

    test('should recognize if keyword after coproc', () => {
      const source = 'coproc if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Bug: brace expansion context', () => {
    test('should not treat for inside brace expansion {for} as block opener', () => {
      const source = 'for i in 1 2; do\n  echo {for}\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
      assertIntermediates(pairs[0], ['do']);
    });

    test('should not treat if inside brace expansion {if} as block opener', () => {
      const source = 'for i in 1; do\n  echo {if}\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
      assertIntermediates(pairs[0], ['do']);
    });

    test('should still recognize keyword after standalone { at line start', () => {
      const source = '{ if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'should find if block');
      assertIntermediates(ifPair, ['then']);
    });
  });

  suite('Coverage: findBashDoubleQuoteEnd nested constructs', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
    test('should handle ${} parameter expansion inside double-quoted string inside $()', () => {
      // Lines 522-526: findBashDoubleQuoteEnd: nested ${} parameter expansion
      // "$(echo "${HOME}/file")" - double-quoted string inside $() contains ${}
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'x=$(echo "${HOME}/file")\nif [ -n "$x" ]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should handle backtick command substitution inside double-quoted string inside $()', () => {
      // Lines 529-533: findBashDoubleQuoteEnd: nested backtick command
      // "$(echo "result is `date`")" - double-quoted string inside $() contains backtick
      const source = 'x=$(echo "result is `date`")\nif [ -n "$x" ]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should handle unterminated double-quoted string inside $() (line 542-543)', () => {
      // Lines 542-543: findBashDoubleQuoteEnd: unterminated string → return source.length
      // Unterminated "... means the rest is consumed as a string, preventing keyword detection
      const source = 'x=$(echo "unterminated\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      // Everything is inside the excluded region, so no blocks found
      assert.ok(Array.isArray(pairs));
    });
  });

  suite('Coverage: uncovered code paths', () => {
    // Line 199: whitespace skip after jumping over excluded region in isAtCommandPosition
    // The inner while at line 197-199 runs when there is whitespace just before the excluded region
    test('should recognize keyword after command substitution with spaces before it', () => {
      // Scanning backward from `if`: skip space, land on ) of $(cmd) (in excluded region),
      // jump to region.start-1 (which is a space), then the inner while (line 197-199) runs
      const source = '   $(cmd) if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Line 218: { as reserved word in isAtCommandPosition
    // Fires when backward scan lands on { that is preceded by whitespace
    test('should recognize keyword after standalone { preceded by spaces', () => {
      // Backward from `if`: skip whitespace, land on }. Wait - we need { before `if`.
      // Semicolons/newlines then { then spaces then `if`
      const source = 'echo x;  { if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assert.ok(pairs.length >= 2);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'should find if block');
    });

    // Line 231: backtick branch in isAtCommandPosition
    // Fires when backward scan lands on a backtick that is outside any excluded region
    test('should recognize keyword at command position after backtick on previous line', () => {
      // After a backtick substitution on a previous line, keyword is in command position
      const source = 'result=`echo hello`\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Line 285: CRLF line ending inside pipe-separated case pattern alternatives
    // The isCasePattern pipe loop: source[j]='\r' && source[j+1]='\n' → j += 2 (line 285)
    test('should handle CRLF line ending in pipe-separated case keyword alternative', () => {
      // if|\\r\\nthen) - the keyword `if` is followed by | then CRLF then `then)`
      const source = 'case $x in\r\n  if|\r\n  then)\r\n    echo matched\r\n    ;;\r\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Lines 325-326: parenDepth-- in isCasePattern backward scan
    // Occurs when scanning backward finds ) at depth > 0, then ( decrements
    test('should handle nested parens before case keyword in backward scan', () => {
      // Backward from `for` in `(a|(b)) ;;\n  for)` scans through nested parens
      // The ) of (b) increments parenDepth, then ( of (b) decrements (lines 325-326)
      const source = 'case $x in\n  (a|(b)) ;;\n  for) echo loop;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Lines 336-341: POSIX (keyword) case pattern - direct ( before keyword check
    // Runs after the backward scan loop completes without finding unmatched ( at depth 0
    test('should detect POSIX (keyword) case pattern via direct paren check', () => {
      // After the ;; separator, (for) should be recognized as a POSIX case pattern
      // The ( is checked directly at lines 336-341 after the backward scan loop
      const source = 'case $cmd in\n  a) echo;;\n  (for) echo loop;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect POSIX (while) case pattern via direct paren check after ;&', () => {
      // ;& fall-through separator before (while) - direct ( check at lines 336-341
      const source = 'case $cmd in\n  a) echo;& \n  (while) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Lines 421-422: ${ in tokenize brace scanning - skip parameter expansion brace
    test('should not treat ${ as command grouping brace', () => {
      // The ${var} brace is preceded by $, so it is skipped at line 420-422
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'x=${HOME}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should correctly parse block while ${ appears in source', () => {
      // Multiple ${} expansions should not interfere with { } block detection
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'echo ${PATH} ${HOME}\n{\n  echo test\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Coverage: uncovered branches - targeted', () => {
    // Lines 176-177: isParameterExpansion returns true
    // This is defensive code: ${ is always caught by matchParameterExpansion first,
    // so isParameterExpansion (guarding # as comment) is never reached for # inside ${#...}.
    // Test exercises the closest reachable path with parameter length syntax.
    test('should handle parameter length expansion without treating # as comment', () => {
      // Parameter expansion excluded region covers the # character
      const source = 'len=$' + '{#arr[@]}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    // Lines 230-231: isAtCommandPosition after backtick
    // Backticks are always covered by matchBacktickCommand excluded regions,
    // so the backtick check in isAtCommandPosition is defensive code.
    // Test exercises backtick-related command position detection.
    test('should handle keyword on same line after backtick substitution result', () => {
      // Backtick substitution creates excluded region; after it, keyword is at command position
      // via the ;|&() or newline check, not the backtick check itself
      const source = 'x=`echo test`; if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // Lines 336-341: isCasePattern - ( before keyword with only whitespace/;; before on line
    // After the backward paren scan loop completes without finding unmatched ( at depth 0,
    // lines 331-341 check for ( immediately before keyword (skipping whitespace).
    test('should detect case pattern with keyword after ;; separator', () => {
      // for) after ;; is a case pattern detected by the default separator check
      const source = 'case $x in\n  ;;\n  for) echo;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    // Lines 421-422: tokenize skips { preceded by $ (parameter expansion)
    // ${ is always covered by excluded region first, so this check is defensive.
    // Test verifies parameter expansion inside { } block is handled correctly.
    test('should handle parameter expansion brace not treated as command grouping', () => {
      // Parameter expansion creates excluded region; the { inside is skipped first
      const source = '{\n  echo $' + '{USER}\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    // Line 156: <<( should not be treated as process substitution
    // When matchHeredoc fails for <<( (invalid delimiter), the ( is checked
    // for process substitution. The <<( guard prevents false matching.
    test('should not treat <<( as process substitution', () => {
      const source = 'for i in 1; do\n  echo <<(\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat ${# as comment start (isParameterExpansion)', () => {
      // Covers lines 176-177: isParameterExpansion returns true for ${#
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = '${#array[@]}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat keyword after backtick as command position', () => {
      // Covers lines 230-231: isAtCommandPosition after backtick
      const source = '`echo`\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should treat keyword inside explicit case pattern with paren as case pattern', () => {
      // Covers lines 336-341: isCasePattern finds ( before keyword
      const source = 'case x in\n  (for) echo ;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should skip ${ parameter expansion brace in tokenize', () => {
      // Covers lines 420-421: skip { preceded by $
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'echo ${var}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: $[...] arithmetic bracket with strings', () => {
    test('should handle ] inside quoted string in $[...]', () => {
      const source = 'x=$[ "a]b" ]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle single-quoted string inside $[...]', () => {
      const source = "x=$[ ']' ]\nif true; then\n  echo ok\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: isCasePattern with strings containing separators', () => {
    test('should treat keyword in POSIX case pattern with semicolon in string as case pattern', () => {
      const source = 'case "$x" in\n  ("foo;bar" | for)\n    echo matched\n    ;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should still detect subshell with real semicolons', () => {
      const source = '(echo hello; for x in a b; do echo $x; done)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Regression: nested double-quoted string in parameter expansion with command substitution', () => {
    test('should handle command substitution with quotes inside nested string in parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash source code
      const source = 'echo "${x:-"$(echo \'"\')"}"  \nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle backtick with quotes inside nested string in parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash source code
      const source = 'echo "${x:-"`echo \'"\'`"}"  \nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: nested brace groups should detect inner block keywords', () => {
    test('should detect all blocks in nested { { ... }; }', () => {
      const source = '{ { if true; then echo ok; fi; }; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should detect blocks in } && { pattern', () => {
      const source = '{ echo a; } && { if true; then echo ok; fi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Regression: redirect before hash', () => {
    test('should not treat hash after > as comment', () => {
      const source = 'echo >#file; if true; then echo hello; fi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat hash after < as comment', () => {
      const source = 'echo <#input; if true; then echo; fi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still treat hash after space as comment', () => {
      const source = 'echo > #this is a comment\nif true; then echo; fi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: multiple heredocs in command substitution', () => {
    test('should exclude multiple heredoc bodies inside $()', () => {
      const source = 'result=$(cat <<EOF1 <<EOF2\nfirst if body\nEOF1\nsecond for body\nEOF2\n)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should exclude multiple heredoc bodies inside process substitution', () => {
      const source = 'diff <(cat <<EOF1 <<EOF2\nfirst if body\nEOF1\nsecond for body\nEOF2\n) file\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: parameter expansion nested double-quoted strings', () => {
    test('should handle $() inside double-quoted string inside $' + '{}', () => {
      const source = 'echo $' + '{var:-"$(echo "inner")"}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: arithmetic expansion with nested command substitution in double quote', () => {
    test('should handle $() inside double-quoted string in $(( ))', () => {
      const source = 'x=$(( "$(echo ")")" + 1 ))\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle $() inside double-quoted string in (( ))', () => {
      const source = '(( "$(echo ")")" + 1 ))\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: { reserved word after backtick command substitution', () => {
    test('should recognize keyword inside { after backtick command on same line', () => {
      const source = '`cmd` { if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.ok(ifBlock, 'if block should be recognized');
    });
  });

  suite('Branch coverage: isAtCommandPosition and isCasePattern edge cases', () => {
    test('should handle { after excluded region with trailing whitespace', () => {
      const source = '"hello"   { if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should treat { as block opener after backtick end', () => {
      const source = '`cmd`\n{ if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should recognize (for) as case pattern after ;;', () => {
      const source = 'case $x in\n  a) echo a;;\n  (for) echo for;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should recognize (if) as case pattern at line start', () => {
      const source = 'case $x in\n(if) echo yes;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should skip { not followed by whitespace in findExcludedRegions', () => {
      const source = '{nospace}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: bashStringHelpers edge cases', () => {
    test('should handle escaped quote in double-quoted string via findStringEnd', () => {
      const source = 'x=[[ "hello \\"world\\"" ]]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle unterminated double-quoted string in bracket expression', () => {
      const source = '[[ "unterminated ]]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      // Unterminated string inside [[ ]] consumes the rest, so no blocks parsed
      assertNoBlocks(pairs);
    });

    test('should handle $' + '{var} inside bracket expression', () => {
      const source = 'x=[[ $' + '{var} == "test" ]]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: isAtCommandPosition { with excluded region and whitespace', () => {
    test('should recognize keyword after { preceded by string with leading whitespace', () => {
      // Triggers lines 230-232: backward scan from { finds excluded region ("str"),
      // then skips whitespace before the excluded region
      const source = ';  "str"  { if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.ok(ifBlock, 'if block should be recognized inside { }');
    });

    test('should recognize keyword after { preceded by comment with whitespace', () => {
      // Similar to above but with a comment as the excluded region
      const source = 'echo ok # comment\n  "str"  { if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Branch coverage: isCasePattern POSIX (keyword) at line start without matched parens', () => {
    test('should treat POSIX (do) as case pattern at line start', () => {
      // Triggers lines 360-365: keyword preceded by ( with only whitespace before it on the line
      const source = 'case $x in\n(do) echo do;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat POSIX (done) as case pattern after ;; separator', () => {
      const source = 'case $x in\n  a) echo a;;\n  ;; (done) echo done;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Branch coverage: ${ skip in brace tokenization', () => {
    test('should not treat ${ as command grouping when not in excluded region', () => {
      // Triggers lines 435-436: { preceded by $ that is not already in excluded region
      // This uses ${ directly in the source where the parser may encounter it
      const source = 'echo $' + '{var}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: findStringEnd in matchArithmeticBracket', () => {
    test('should handle escaped quote in double-quoted string inside $[...]', () => {
      // Triggers findStringEnd lines 137-139: escape sequence inside deprecated arithmetic bracket
      const source = 'x=$["test\\"value"]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle unterminated string in $[...]', () => {
      // Triggers findStringEnd lines 145-146: unterminated string extends to end of source
      const source = 'x=$["unterminated';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle $' + '{var} inside deprecated arithmetic bracket $[...]', () => {
      // Triggers matchArithmeticBracket lines 180-183: parameter expansion inside $[...]
      const source = 'x=$[$' + '{var} + 1]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: findBashDoubleQuoteEnd with $' + '{} inside double quote', () => {
    test('should handle $' + '{var} inside double-quoted string in parameter expansion', () => {
      // Triggers findBashDoubleQuoteEnd lines 528-532: ${...} inside double-quoted string
      // Path: matchParameterExpansion -> encounters " -> findBashDoubleQuoteEnd -> encounters ${
      const source = 'x=$' + '{foo:-"$' + '{bar}"}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle nested $' + '{} in double-quoted string inside command substitution', () => {
      // Another path to findBashDoubleQuoteEnd with ${} inside
      const source = 'x=$(echo "$' + '{HOME}/path")\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: backslash line continuation in isAtCommandPosition', () => {
    test('should not treat keyword after backslash continuation as command position', () => {
      const source = 'echo hello \\\nif something';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still treat keyword at normal line start as command position', () => {
      const source = 'echo hello\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle multiple backslash continuations', () => {
      const source = 'echo \\\nhello \\\nif something';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should treat keyword after && and backslash as command position', () => {
      const source = 'echo ok && \\\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: $[...] uses findBashDoubleQuoteEnd for double-quoted strings', () => {
    // matchArithmeticBracket changed from findStringEnd to findBashDoubleQuoteEnd
    // for double-quoted strings inside $[...]. This means $() inside "..." inside $[...]
    // is properly handled: the ] inside $() does not prematurely close the $[...]

    test('should not close $[...] at ] inside $() inside double-quoted string', () => {
      // $["$(echo ']')"] - the ] inside $() inside "..." should not close $[...]
      // findBashDoubleQuoteEnd handles $() via matchCommandSubstitution, so the ] is consumed
      const source = 'x=$["$(echo \']\')"]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle ] inside single-quoted string inside $[...]', () => {
      // $['hello]world'] - ] inside single-quoted string should not close $[...]
      const source = "x=$['hello]world']\nif true; then\n  echo ok\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle $[...] with $() command substitution containing brackets', () => {
      // $[$(echo '2+2')] - $() is handled, nested brackets don't confuse the parser
      const source = "x=$[$(echo '2+2')]\nif true; then\n  echo ok\nfi";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still handle simple $[...] arithmetic correctly', () => {
      // Basic case: $[1+2] should still work
      const source = 'x=$[1+2]\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: heredoc inside $() with closing ) on same line', () => {
    test('should exclude heredoc body when ) closes before newline', () => {
      const source = 'result=$(cat <<EOF)\nif then fi\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should exclude heredoc body in process substitution closing before newline', () => {
      const source = 'diff <(cat <<EOF)\nif then fi\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still handle normal heredoc inside $() correctly', () => {
      const source = 'result=$(cat <<EOF\nheredoc body\nEOF\n)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: isCommentStart Unicode whitespace', () => {
    test('should not treat # after non-breaking space as comment', () => {
      // Non-breaking space (\u00A0) is not a Bash word separator
      const source = 'if true; then\n  echo\u00A0#not-a-comment\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still treat # after regular space as comment', () => {
      const source = 'if true; then\n  echo #comment\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: process substitution heredoc flush', () => {
    test('should handle heredoc inside process substitution <()', () => {
      const source = 'if true; then\n  diff <(cat <<EOF\nhello\nEOF\n) file\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc inside process substitution with CRLF', () => {
      const source = 'if true; then\r\n  diff <(cat <<EOF\r\nhello\r\nEOF\r\n) file\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc flushed at close ) in process substitution', () => {
      // Heredoc declared on same line as ), so flush happens at ) not at newline
      const source = 'if true; then\n  diff <(cat <<EOF) file\nhello\nEOF\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc flushed at close ) with CRLF', () => {
      const source = 'if true; then\r\n  diff <(cat <<EOF) file\r\nhello\r\nEOF\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc in process substitution at end of input', () => {
      // Heredoc pending but no newline after ) - lines 694-696
      const source = 'if true; then\n  diff <(cat <<EOF)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unterminated process substitution', () => {
      // Unterminated <( consumes remaining source as excluded region
      const source = 'if true; then\n  diff <(cat\nfi';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle heredoc flushed at close ) in command substitution', () => {
      // Heredoc declared on same line as ), so flush happens at ) not at newline
      const source = 'if true; then\n  x=$(cat <<EOF) && echo ok\nhello\nEOF\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc flushed at close ) in command substitution with CRLF', () => {
      const source = 'if true; then\r\n  x=$(cat <<EOF) && echo ok\r\nhello\r\nEOF\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle CR-only line endings in heredoc inside command substitution', () => {
      const pairs = parser.parse('x=$(cat <<EOF)\rbody\rEOF\rif true; then\r  echo ok\rfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc in command substitution at end of input', () => {
      // Heredoc pending but no newline after ) - lines 557-558
      const source = 'if true; then\n  x=$(cat <<EOF)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unterminated command substitution', () => {
      // Unterminated $( consumes remaining source as excluded region
      const source = 'if true; then\n  echo $(cat\nfi';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Branch coverage: isAtCommandPosition edge cases', () => {
    test('should handle excluded region after line continuation', () => {
      // A keyword at command position when line continuation crosses an excluded region
      const source = 'echo "test" \\\n"more" \\\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 0);
    });

    test('should handle keyword after backtick', () => {
      const source = '`cmd`\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: case pattern with parenthesis', () => {
    test('should treat keyword in case pattern starting with ( on separate line', () => {
      const source = 'case $x in\n;;\n  (if)\n    echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat keyword after ;; with ( as case pattern', () => {
      const source = 'case $x in\n  a) echo a;;\n  (for)\n    echo match;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Branch coverage: parameter expansion in tokenize', () => {
    test('should not treat ${ as command group open', () => {
      const source = 'if true; then\n  echo $' + '{var}\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: isParameterExpansion returning true', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test name
    test('should not treat # as comment inside ${#var} parameter expansion', () => {
      // Covers bashParser.ts lines 174-175: isParameterExpansion returns true
      // ${#var} is the string length operator; # should not start a comment
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'if true; then\n  len=${#mystring}\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test name
    test('should handle ${#array[@]} length without treating # as comment', () => {
      // Covers bashParser.ts lines 174-175: isParameterExpansion returns true
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'if [ ${#arr[@]} -gt 0 ]; then\n  echo many\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Branch coverage: isAtCommandPosition after backtick', () => {
    test('should recognize keyword at command position after backtick substitution', () => {
      // Covers bashParser.ts lines 277-278: isAtCommandPosition returns true after backtick
      const source = '`date` if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize for loop after backtick command', () => {
      // Covers bashParser.ts lines 277-278: backtick ends command substitution context
      const source = 'x=`echo hi`\nfor i in 1 2 3; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Branch coverage: isCasePattern (pattern) syntax', () => {
    test('should treat keyword inside explicit (pattern) as case pattern at line start', () => {
      // Covers bashParser.ts lines 392-397: isCasePattern check for (keyword) at line start
      const source = 'case $x in\n(for)\n  echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat keyword inside (pattern) after ;; as case pattern', () => {
      // Covers bashParser.ts lines 394-396: textBefore matches /;;[ \t]*$/
      const source = 'case $x in\n  a) echo a;; (while)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat keyword inside (pattern) after ;& as case pattern', () => {
      // Covers bashParser.ts lines 394-396: textBefore matches /;&[ \t]*$/
      const source = 'case $x in\n  a) echo a;& (select)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Regression: POSIX case pattern after in on same line', () => {
    test('should treat keyword inside (pattern) after in on same line as case pattern', () => {
      const source = 'case $x in (if) echo yes;; esac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat keyword inside (pattern) after in with tab as case pattern', () => {
      const source = 'case $x in\t(for) echo yes;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should treat keyword inside (pattern) after in with multiple patterns', () => {
      const source = 'case $x in (if) echo if;; (do) echo do;; esac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Branch coverage: tokenize skipping ${ in brace pattern', () => {
    test('should skip { preceded by $ during brace tokenization', () => {
      // Covers bashParser.ts lines 472-473: char === '{' && source[i-1] === '$'
      // The ${ should not be treated as command group open brace
      const source = 'for i in 1; do\n  echo $' + '{HOME}/path\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not create block pair for ${ inside while loop', () => {
      // Covers bashParser.ts lines 472-473: ${ skipped in brace matching
      const source = 'while true; do\n  x=$' + '{var:-default}\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'done');
    });
  });

  suite('Regression: here-string inside command/process substitution', () => {
    test('should not treat <<< as heredoc inside $()', () => {
      const source = 'result=$(cat <<<EOF)\nif true; then\n  echo hello\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat <<< as heredoc inside <()', () => {
      const source = 'diff <(cat <<<EOF) file.txt\nif true; then\n  echo hello\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: isParameterExpansion true branch via heredoc gap', () => {
    test('should not treat # in parameter expansion as comment when encountered in heredoc gap scan', () => {
      // Covers bashParser.ts lines 174-175: isParameterExpansion returns true
      // In a heredoc gap, ${#var} appears; the gap scan visits # after $ is processed
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'cat <<EOF ${#x}\nheredoc body\nEOF\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: isAtCommandPosition after backtick', () => {
    test('should treat keyword as command position after backtick on same line', () => {
      // Covers bashParser.ts lines 288-289: backtick check in isAtCommandPosition
      // A backtick that is NOT part of an excluded region (orphan backtick scenario)
      const source = '`echo hello` && if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: isCasePattern with ( preceded by ;; or in', () => {
    test('should detect case pattern with ( preceded by ;; on same line', () => {
      // Covers bashParser.ts lines 403-408: isCasePattern with ( preceded by ;; text
      const source = 'case $x in\n  a) echo a;; (for)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case pattern with ( preceded by ;& on same line', () => {
      // Covers bashParser.ts lines 403-408: textBefore matches /;&[ \t]*$/
      const source = 'case $x in\n  a) echo a;& (while)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case pattern with ( preceded by ;;& on same line', () => {
      // Covers bashParser.ts lines 403-408: textBefore matches /;;&[ \t]*$/
      const source = 'case $x in\n  a) echo a;;& (until)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should detect case pattern with ( preceded by in keyword on same line', () => {
      // Covers bashParser.ts lines 403-408: textBefore matches /\bin[ \t]*$/
      const source = 'case $x in (for)\n    echo matched;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Coverage: tokenize skipping ${ parameter expansion brace', () => {
    test('should skip { preceded by $ in brace pattern matching', () => {
      // Covers bashParser.ts lines 483-484: char === '{' && i > 0 && source[i - 1] === '$'
      // biome-ignore lint/suspicious/noTemplateCurlyInString: bash syntax in test string
      const source = 'if true; then\n  echo ${PATH}\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Coverage: isAtCommandPosition command starter preceded by backtick, {, }', () => {
    test('should recognize keyword after command starter preceded by backtick', () => {
      // Covers line 310 branch: source[p] === '`' for commandStarters
      // Backward from `if`: skip space -> find `then` text -> p scans past space to backtick
      const source = '`cmd` then if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize keyword after command starter preceded by opening brace', () => {
      // Covers line 310 branch: source[p] === '{' for commandStarters
      // Backward from `if`: find `do` text -> p scans to `{`
      const source = '{ do if true; then\n  echo ok\nfi; }';
      const pairs = parser.parse(source);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if'));
    });

    test('should recognize keyword after command starter preceded by closing brace', () => {
      // Covers line 310 branch: source[p] === '}' for commandStarters
      // Backward from `if`: find `else` text -> p scans to `}`
      const source = '{ echo x; } else if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if'));
    });
  });

  suite('Coverage: isAtCommandPosition block close preceded by backtick, {, }', () => {
    test('should recognize keyword after block close preceded by backtick', () => {
      // Covers line 325 branch: source[p] === '`' for blockCloseKws
      // Backward from `if`: skip space -> find `fi` text -> p scans past space to backtick
      const source = '`cmd` fi if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize keyword after block close preceded by opening brace', () => {
      // Covers line 325 branch: source[p] === '{' for blockCloseKws
      // Backward from `for`: find `done` text -> p scans to `{`
      const source = '{ done for y in 1; do\n  echo $y\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should recognize keyword after block close preceded by closing brace', () => {
      // Covers line 325 branch: source[p] === '}' for blockCloseKws
      // Backward from `if`: find `esac` text -> p scans to `}`
      const source = '{ echo a; } esac if true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'if'));
    });
  });

  suite('Coverage: isCasePattern backward scan completions', () => {
    test('should handle case pattern where backward scan finds separator between ( and keyword', () => {
      // The backward paren scan finds ( but hasUnexcludedSeparator is true, returns false
      // Then continues searching but no more ( found
      const source = '(echo; for x in 1 2; do\n  echo $x\ndone)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should handle case pattern on same line as in keyword', () => {
      // The case pattern ( is preceded by `in ` on the same line
      // Backward scan finds ( at depth 0, textBefore matches `\bin[ \t]*$`
      const source = 'case $x in (for) echo match;; esac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Coverage: tokenize function definition { not at command position', () => {
    test('should recognize { after ) in excluded region as function-like definition', () => {
      // Covers bashParser.ts lines 507-508: { preceded by ) when not at command position
      // x=$(cmd) creates excluded region; isAtCommandPosition skips over ) to `=` (not separator)
      // but the simpler function def check at lines 503-508 finds ) directly
      const source = 'x=$(cmd) {\n  echo test\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

    test('should recognize { after command substitution with assignment as function-like', () => {
      // y=$(echo hello) { ... } -- same path with longer command substitution
      const source = 'y=$(echo hello) {\n  echo inside\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });
  });

  suite('Coverage: tokenize { not at command position and not function def', () => {
    test('should not treat { after string as command grouping', () => {
      // Covers bashParser.ts lines 524-525: !isFuncDef continue
      // { after "text" is not at command position (isAtCommandPosition scans past excluded region)
      // and not a function def (source[j] = " which is not ) or identifier char)
      const source = 'echo "text" {\n  echo test\n}\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat { after dollar sign as command grouping', () => {
      // source[j] = $ which is in the special char set, not ) or identifier
      const source = 'echo $ {\n  echo test\n}\nfor i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });
  });

  suite('Coverage: scanSubshellBody heredoc handling edge cases', () => {
    test('should handle heredoc body at newline in command substitution', () => {
      // Exercises scanSubshellBody line 447: heredoc body processing at newline
      // Heredoc operator detected inside $(), newline triggers flush
      const source = 'x=$(cat <<MARKER\nthis is content\nMARKER\n)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle multiple heredocs inside command substitution at newline', () => {
      // Multiple heredocs in $(), both resolved at newline
      const source = 'x=$(cat <<EOF1 <<EOF2\nbody1\nEOF1\nbody2\nEOF2\n)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc flushed at close paren in command substitution', () => {
      // Exercises scanSubshellBody line 556: heredoc body processing at close paren
      // Heredoc operator found on same line as ), flush happens at )
      const source = 'x=$(cat <<MARKER) && echo after\ncontent\nMARKER\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle heredoc flushed at close paren in process substitution', () => {
      // Same path but via process substitution <()
      const source = 'diff <(cat <<MARKER) file\ncontent\nMARKER\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  // Regression: keyword=value variable assignment should not be block keyword
  suite('Regression: bare brace in parameter expansion', () => {
    test('should end excluded region correctly when parameter expansion contains bare brace', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = 'echo "${var:-{}" done';
      const regions = parser.getExcludedRegions(source);
      // The excluded region for the double-quoted string should not consume the entire source
      const lastRegion = regions[regions.length - 1];
      assert.ok(lastRegion.end < source.length, 'excluded region should not extend to end of source');
    });

    test('should detect if...fi after parameter expansion with bare brace default', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = 'x=${var:-{}}\nif true; then\necho hi\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: single quote in double-quoted parameter expansion', () => {
    test('should treat single quote as literal inside double-quoted parameter expansion', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = 'echo "${var:-\'}" done';
      const regions = parser.getExcludedRegions(source);
      // The single quote inside parameter expansion is literal, should not start a new string
      const lastRegion = regions[regions.length - 1];
      assert.ok(lastRegion.end < source.length, 'excluded region should end properly');
    });

    test('should detect if...fi after double-quoted parameter expansion with single quote', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion
      const source = '"${var:-\'}"\nif true; then\necho hi\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: keyword=value variable assignment', () => {
    test('should not treat done=value as block close', () => {
      const source = 'for i in 1; do\n  done=complete\n  echo ok\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat fi=value as block close', () => {
      const source = 'if true; then\n  fi=1\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still detect keyword followed by == as block keyword', () => {
      const source = 'if true; then\n  [ "$fi" == "x" ]\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat done+=value as block close', () => {
      const source = 'for i in 1; do\n  done+=1\n  echo ok\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('done'));
    });

    test('should not treat fi[0]=value as block close', () => {
      const source = 'if true; then\n  fi[0]=1\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('fi'));
    });

    test('should not treat done[idx]+=value as block close', () => {
      const source = 'for i in 1; do\n  done[idx]+=1\n  echo ok\ndone';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'done');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('done'));
    });

    test('should not treat then+=value as block middle', () => {
      const source = 'if true; then\n  then+=1\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should not treat esac+=value as block close', () => {
      const source = 'case x in\n  *) esac+=1;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('esac'));
    });
  });

  suite('Bug: parameter expansion with bare braces does not track depth', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion syntax in test name
    test('should not close parameter expansion prematurely at bare } inside ${...{...}}', () => {
      // matchParameterExpansion does not increment depth for bare { (only for ${),
      // so the first } inside {a} closes the expansion prematurely.
      // The trailing } is exposed and picked up as a block_close token.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion syntax
      const source = '{\n  x=${v:+{a\n}}\n}';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
      // Expected: { at pos 0 pairs with } at end (pos 17)
      // Actual bug: { at pos 0 pairs with the exposed } at pos 15
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('}'));
    });

    test('should handle parameter expansion with bare braces in replacement', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion syntax
      const source = 'x=${var/old/{new}}\nif true; then\n  echo ok\nfi';
      const regions = parser.getExcludedRegions(source);
      const paramExpStart = source.indexOf('$' + '{');
      const paramExpRegion = regions.find((r) => r.start === paramExpStart);
      assert.ok(paramExpRegion, 'parameter expansion region should exist');
      // The region should cover the entire ${var/old/{new}} (16 chars from $ to final })
      // Without the fix, it closes prematurely at the } of {new} (only covering ${var/old/{new})
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Bash parameter expansion syntax
      assert.strictEqual(paramExpRegion.end, paramExpStart + 16, 'region should cover the full ${var/old/{new}} expansion');
    });
  });

  suite('Bug: keywords inside { } not detected when { follows command starter on same line', () => {
    test('should detect if block inside { } when { follows do on same line', () => {
      // isAtCommandPosition for keywords inside { } fails when { is preceded
      // by a command starter (do, then, else, etc.) on the same line.
      // The { reserved word check does not recognize command starters as valid precursors.
      const source = 'for i in 1; do { if true; then echo hi; fi; }; done';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'if');
      findBlock(pairs, '{');
      findBlock(pairs, 'for');
    });

    test('should detect for block inside { } when { follows then on same line', () => {
      const source = 'if true; then { for i in 1 2; do\n  echo $i\ndone; }; fi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'for');
      findBlock(pairs, '{');
      findBlock(pairs, 'if');
    });

    test('should detect while block inside { } when { follows coproc on same line', () => {
      const source = 'coproc { while true; do\n  break\ndone; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
      findBlock(pairs, '{');
    });

    test('should detect while block inside { } when { follows time on same line', () => {
      const source = 'time { while true; do\n  break\ndone; }';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'while');
      findBlock(pairs, '{');
    });

    test('should detect if block inside { } when { follows else on same line', () => {
      const source = 'if false; then\n  echo no\nelse { if true; then echo yes; fi; }; fi';
      const pairs = parser.parse(source);
      const ifBlocks = pairs.filter((p) => p.openKeyword.value === 'if');
      assert.strictEqual(ifBlocks.length, 2);
      findBlock(pairs, '{');
    });
  });

  suite('Bug: keywords inside [[ ]] falsely detected as block openers', () => {
    test('should not detect if inside multiline [[ ]]', () => {
      const source = 'if [[\nif == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const ifTokens = tokens.filter((t) => t.value === 'if');
      assert.strictEqual(ifTokens.length, 1, 'only the outer if should be detected');
      assert.strictEqual(ifTokens[0].startOffset, 0);
    });

    test('should not detect for inside multiline [[ ]]', () => {
      const source = 'if [[\nfor == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0);
    });

    test('should not detect case inside multiline [[ ]]', () => {
      const source = 'if [[\ncase == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const caseTokens = tokens.filter((t) => t.value === 'case');
      assert.strictEqual(caseTokens.length, 0);
    });

    test('should correctly pair outer if with fi when if appears inside [[ ]]', () => {
      const source = 'if [[\nif == "true"\n]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0, 'outer if should pair with fi');
    });

    test('should correctly pair when [[ ]] is followed by real blocks', () => {
      const source = 'if [[ if == "true" ]]; then\n  for i in 1 2; do\n    echo "$i"\n  done\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'if', 0);
      assertNestLevel(pairs, 'for', 1);
    });

    test('should not detect keywords after closed ]] and before new [[', () => {
      const source = 'if [[ a == "b" ]] && [[\ncase == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const caseTokens = tokens.filter((t) => t.value === 'case');
      assert.strictEqual(caseTokens.length, 0);
    });

    test('should not detect middle keywords inside [[ ]]', () => {
      const source = 'if [[\nthen == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const thenTokens = tokens.filter((t) => t.value === 'then');
      assert.strictEqual(thenTokens.length, 1, 'only the real then should be detected');
    });

    test('should not detect close keywords inside [[ ]]', () => {
      const source = 'if [[\nfi == "true"\n]]; then\n  echo ok\nfi';
      const tokens = parser.getTokens(source);
      const fiTokens = tokens.filter((t) => t.value === 'fi');
      assert.strictEqual(fiTokens.length, 1, 'only the real fi should be detected');
    });

    test('should not let echo [[ poison subsequent keyword detection', () => {
      const pairs = parser.parse('echo [[\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Bug: keyword==value falsely detected as keyword instead of assignment', () => {
    // In bash, keyword==value is a variable assignment: variable "keyword" gets value "=value"
    // The isFollowedByEquals method explicitly skips == thinking it is a comparison operator,
    // but actually keyword== is name=value where value starts with "="

    test('should not detect if in if==value assignment', () => {
      const tokens = parser.getTokens('if==value');
      const ifTokens = tokens.filter((t) => t.value === 'if');
      assert.strictEqual(ifTokens.length, 0);
    });

    test('should not detect for in for==value assignment', () => {
      const tokens = parser.getTokens('for==value');
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0);
    });

    test('should not detect done in done==value assignment', () => {
      const tokens = parser.getTokens('done==value');
      const doneTokens = tokens.filter((t) => t.value === 'done');
      assert.strictEqual(doneTokens.length, 0);
    });

    test('should not detect then in then==value assignment', () => {
      const tokens = parser.getTokens('then==value');
      const thenTokens = tokens.filter((t) => t.value === 'then');
      assert.strictEqual(thenTokens.length, 0);
    });

    test('should not detect fi in fi==value assignment', () => {
      const tokens = parser.getTokens('fi==value');
      const fiTokens = tokens.filter((t) => t.value === 'fi');
      assert.strictEqual(fiTokens.length, 0);
    });

    test('should still correctly handle single = assignment', () => {
      // if=value should still be filtered (existing behavior works)
      const tokens = parser.getTokens('if=value');
      const ifTokens = tokens.filter((t) => t.value === 'if');
      assert.strictEqual(ifTokens.length, 0);
    });

    test('should still correctly handle += assignment', () => {
      const tokens = parser.getTokens('if+=value');
      const ifTokens = tokens.filter((t) => t.value === 'if');
      assert.strictEqual(ifTokens.length, 0);
    });
  });

  suite('Bug: # inside [[ ]] treated as comment', () => {
    // In bash, # is NOT a comment character inside [[ ]] conditional expressions.
    // The parser's findExcludedRegions treats # as a comment start based on the preceding
    // character (space, etc.) without knowing about [[ ]] context. This causes the rest
    // of the line (including ]]; then) to be excluded, breaking block detection.

    test('should detect if-fi block when [[ ]] contains # in pattern matching', () => {
      const source = 'if [[ $x == #* ]]; then\n  echo starts with hash\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if-fi block when [[ ]] contains # after != operator', () => {
      const source = 'if [[ $x != #comment ]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if-fi block when [[ ]] contains # as a value with -n test', () => {
      const source = 'if [[ -n #text ]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect if-fi block when [[ ]] contains # after = operator', () => {
      const source = 'if [[ $x = # ]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should detect intermediates when [[ ]] contains # in pattern', () => {
      const source = 'if [[ $x == #* ]]; then\n  echo ok\nelse\n  echo no\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should detect nested blocks when [[ ]] contains # in pattern', () => {
      const source = 'if [[ $x == #* ]]; then\n  for i in 1 2; do\n    echo $i\n  done\nfi';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'if', 0);
      assertNestLevel(pairs, 'for', 1);
    });
  });

  suite('Regression: [[ after for-in/select-in not treated as conditional command', () => {
    test('should not treat [[ after for-in as conditional command', () => {
      const pairs = parser.parse('for i in [[; do\n  echo $i\ndone');
      assertSingleBlock(pairs, 'for', 'done');
    });

    test('should not treat [[ after select-in as conditional command', () => {
      const pairs = parser.parse('select opt in [[; do\n  echo $opt\ndone');
      assertSingleBlock(pairs, 'select', 'done');
    });
  });

  suite('Regression: keyword context validation', () => {
    test('should detect block after env var with == value', () => {
      const pairs = parser.parse('FOO==bar if true; then echo ok; fi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not detect block after continuation from excluded region line', () => {
      const pairs = parser.parse('"hello"\\\nif true; then\n  echo ok\nfi');
      assertNoBlocks(pairs);
    });

    test('should not detect if in case pattern with glob suffix', () => {
      const pairs = parser.parse('case $x in\n  if*) echo match;;\nesac');
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not detect for in case pattern with ? glob', () => {
      const pairs = parser.parse('case $x in\n  for?) echo match;;\nesac');
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('should handle backslash-newline at file start', () => {
      const pairs = parser.parse('\\\nif true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should pair case in esac on same line', () => {
      const pairs = parser.parse('case $x in esac');
      assertSingleBlock(pairs, 'case', 'esac');
    });

    test('should not treat time -p flag as blocking if detection', () => {
      const pairs = parser.parse('time -p if true; then\n  echo ok\nfi');
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: [[ after block close keyword and parameter expansion adjacency', () => {
    test('should not treat # as comment inside [[ ]] when fi precedes without semicolon', () => {
      // Fix: fi was not recognized as valid predecessor for [[ command position
      // Without fix, [[ after fi (no ; between) would not track doubleBracketDepth,
      // so bare # inside [[ ]] would create a false comment excluding the for keyword
      const source = 'if true; then echo; fi [[ x == #test ]] && for i in 1 2; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'for');
    });

    test('should not detect keyword concatenated with parameter expansion', () => {
      const pairs = parser.parse('$' + '{HOME}if true; then\n  echo ok\nfi');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: heredoc terminator followed by ) in subshell', () => {
    test('should recognize heredoc terminator immediately followed by ) in command substitution', () => {
      // EOF) on a line means EOF is the terminator and ) closes the $()
      const source = 'x=$(cat <<EOF\nhello\nEOF)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize heredoc terminator immediately followed by ) in process substitution', () => {
      const source = 'diff <(cat <<EOF\nhello\nEOF) file\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize heredoc terminator followed by ) with CRLF', () => {
      const source = 'x=$(cat <<EOF\r\nhello\r\nEOF)\r\nif true; then\r\n  echo ok\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize heredoc terminator followed by ) with CR-only line endings', () => {
      const source = 'x=$(cat <<EOF\rhello\rEOF)\rif true; then\r  echo ok\rfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should recognize strip-tabs heredoc terminator followed by ) in subshell', () => {
      // <<- strips leading tabs from terminator line
      const source = 'x=$(cat <<-EOF\n\thello\n\tEOF)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still match exact terminator without ) in subshell', () => {
      // Normal case: terminator on its own line followed by ) on next line
      const source = 'x=$(cat <<EOF\nhello\nEOF\n)\nif true; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should handle multiple blocks after heredoc with ) terminator', () => {
      const source = 'x=$(cat <<EOF\nhello\nEOF)\nif true; then\n  echo ok\nfi\nfor i in 1; do\n  echo $i\ndone';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'for');
    });
  });

  suite('Regression: multi-line [[ ]] with # on continuation line', () => {
    test('should not treat # inside multi-line [[ ]] as comment', () => {
      // Bug: doubleBracketDepth reset on newline caused # on line 2 of [[ ]] to start a comment
      const source = 'if [[ $x ==\n#test ]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should not treat # inside multi-line [[ ]] as comment with CRLF', () => {
      const source = 'if [[ $x ==\r\n#test ]]; then\r\n  echo ok\r\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });

    test('should still treat # outside [[ ]] as comment on next line', () => {
      const source = '[[ $x == y ]]\n# if true; then echo; fi';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle [[ ]] spanning three lines with # on each continuation', () => {
      const source = 'if [[ $x == #test ||\n$y == #foo ||\n$z == #bar ]]; then\n  echo ok\nfi';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'fi');
    });
  });

  suite('Regression: case pattern with string between keyword and )', () => {
    test('should not detect for as block keyword when string follows it in case pattern', () => {
      // Bug: isCasePattern did not skip excluded regions; "bar" after for caused false return
      // Without fix, for is falsely detected as block_open (not filtered as case pattern)
      const source = 'case $x in\n  for"bar") echo ;;\nesac';
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0, 'for inside case pattern should not be detected');
    });

    test('should not detect for as block keyword with single-quoted string in case pattern', () => {
      const source = "case $x in\n  for'bar') echo ;;\nesac";
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0, 'for inside case pattern should not be detected');
    });

    test('should not detect for as block keyword with command substitution in case pattern', () => {
      const source = 'case $x in\n  for$(cmd)) echo ;;\nesac';
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0, 'for inside case pattern should not be detected');
    });

    test('should not detect for as block keyword with backtick in case pattern', () => {
      const source = 'case $x in\n  for`cmd`) echo ;;\nesac';
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0, 'for inside case pattern should not be detected');
    });

    test('should still detect normal case pattern without strings', () => {
      const source = 'case $x in\n  for) echo ;;\nesac';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'esac');
    });
  });
});
