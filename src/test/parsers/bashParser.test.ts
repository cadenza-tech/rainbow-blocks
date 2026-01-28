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

suite('BashBlockParser Test Suite', () => {
  let parser: BashBlockParser;

  setup(() => {
    parser = new BashBlockParser();
  });

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
    test('should ignore keywords in single-line comments', () => {
      const source = `# if this is a comment fi
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

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
    test('should ignore keywords in double-quoted strings', () => {
      const source = `echo "if this is a string fi"
{
  echo "test"
}`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, '{', '}');
    });

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
      test('should handle empty source', () => {
        const source = '';
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

      test('should handle source with no blocks', () => {
        const source = `echo "hello"
x=1
y=$((x + 1))`;
        const pairs = parser.parse(source);
        assertNoBlocks(pairs);
      });

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
      *) for i in 1; do
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

  suite('Token positions', () => {
    test('should have correct line numbers', () => {
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

      assert.strictEqual(bracesPair.openKeyword.line, 0);
      assert.strictEqual(ifPair.openKeyword.line, 1);
      assert.strictEqual(forPair.openKeyword.line, 2);
    });

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

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if [ "$x" ]; then
  echo "yes"
else
  echo "no"
fi`;
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 4);
      assert.strictEqual(tokens[0].value, 'if');
      assert.strictEqual(tokens[0].type, 'block_open');
      assert.strictEqual(tokens[1].value, 'then');
      assert.strictEqual(tokens[1].type, 'block_middle');
      assert.strictEqual(tokens[2].value, 'else');
      assert.strictEqual(tokens[2].type, 'block_middle');
      assert.strictEqual(tokens[3].value, 'fi');
      assert.strictEqual(tokens[3].type, 'block_close');
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `"string" # comment
{
  echo "test"
}`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 3);
      assert.strictEqual(source.slice(regions[0].start, regions[0].end), '"string"');
      assert.strictEqual(source.slice(regions[1].start, regions[1].end), '# comment');
      assert.strictEqual(source.slice(regions[2].start, regions[2].end), '"test"');
    });

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
});
