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
    stringBlockClose: '}'
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

    test('should handle comment at end of line', () => {
      const source = `{
  echo "test" # if then else fi
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

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
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted strings', () => {
      const source = `echo 'if this is a string fi'
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

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
    suite('General', () => {
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

      test('should not treat } and ${ inside string as parameter expansion', () => {
        const source = `{
  echo "} \${"
}`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, '{', '}');
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
  });

  suite('Block middle keyword validation', () => {
    test('should not treat then in echo as intermediate', () => {
      const pairs = parser.parse('if true; then\n  echo then\nfi');
      assertSingleBlock(pairs, 'if', 'fi', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'then');
    });

    test('should not treat else in echo as intermediate', () => {
      const pairs = parser.parse('if true; then\n  echo else\nfi');
      assertSingleBlock(pairs, 'if', 'fi', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'then');
    });

    test('should not treat do in echo as intermediate', () => {
      const pairs = parser.parse('for i in 1 2 3; do\n  echo do\ndone');
      assertSingleBlock(pairs, 'for', 'done', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'do');
    });
  });

  suite('Negation operator', () => {
    test('should recognize keyword after ! negation', () => {
      const pairs = parser.parse('! if true; then\n  false\nfi');
      assertSingleBlock(pairs, 'if', 'fi', 0);
    });

    test('should recognize for after ! negation', () => {
      const pairs = parser.parse('! for i in 1 2 3; do\n  false\ndone');
      assertSingleBlock(pairs, 'for', 'done', 0);
    });
  });

  suite('Subshell handling', () => {
    test('should parse blocks inside single-line subshell', () => {
      const pairs = parser.parse('(if true; then echo yes; fi)');
      assertSingleBlock(pairs, 'if', 'fi', 0);
    });

    test('should parse blocks inside subshell with for loop', () => {
      const pairs = parser.parse('(for i in 1 2 3; do echo "$i"; done)');
      assertSingleBlock(pairs, 'for', 'done', 0);
    });
  });

  suite('Time prefix', () => {
    test('should recognize for loop after time', () => {
      const pairs = parser.parse('time for i in 1 2 3; do\n  process "$i"\ndone');
      assertSingleBlock(pairs, 'for', 'done', 0);
    });

    test('should recognize while loop after time', () => {
      const pairs = parser.parse('time while true; do\n  break\ndone');
      assertSingleBlock(pairs, 'while', 'done', 0);
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

  suite('Edge cases', () => {
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
  });
});
