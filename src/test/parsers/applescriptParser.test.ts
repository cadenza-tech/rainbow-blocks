import { ApplescriptBlockParser } from '../../parsers/applescriptParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('ApplescriptBlockParser Test Suite', () => {
  let parser: ApplescriptBlockParser;

  setup(() => {
    parser = new ApplescriptBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse simple tell-end tell block', () => {
      const source = `tell application "Finder"
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should parse if-end if block', () => {
      const source = `if x > 0 then
  set result to "positive"
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse repeat-end repeat block', () => {
      const source = `repeat 5 times
  beep
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should parse try-end try block', () => {
      const source = `try
  riskyOperation()
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
    });

    test('should parse considering-end considering block', () => {
      const source = `considering case
  if text1 = text2 then
    return true
  end if
end considering`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse ignoring-end ignoring block', () => {
      const source = `ignoring case
  if text1 = text2 then
    return true
  end if
end ignoring`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse script-end script block', () => {
      const source = `script myScript
  property x : 1
end script`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'script', 'end script');
    });

    test('should parse on handler block', () => {
      const source = `on myHandler(x)
  return x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should parse to handler block', () => {
      const source = `to myHandler(x)
  return x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'to', 'end');
    });
  });

  suite('Compound open keywords', () => {
    test('should parse using terms from block', () => {
      const source = `using terms from application "Mail"
  set newMessage to make new outgoing message
end using terms from`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
    });

    test('should parse with timeout block', () => {
      const source = `with timeout of 30 seconds
  tell application "Finder"
    activate
  end tell
end timeout`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse with transaction block', () => {
      const source = `with transaction
  tell application "Database"
    doSomething()
  end tell
end transaction`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if with else', () => {
      const source = `if x > 0 then
  set result to "positive"
else
  set result to "non-positive"
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should parse if with else if and else', () => {
      const source = `if x > 0 then
  set result to "positive"
else if x < 0 then
  set result to "negative"
else
  set result to "zero"
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if', 'else']);
    });

    test('should parse try with on error', () => {
      const source = `try
  riskyOperation()
on error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should parse multiple else if clauses', () => {
      const source = `if x = 1 then
  set result to "one"
else if x = 2 then
  set result to "two"
else if x = 3 then
  set result to "three"
else
  set result to "other"
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if', 'else if', 'else']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested tell blocks', () => {
      const source = `tell application "Finder"
  tell window 1
    set name to "New Name"
  end tell
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse nested if in tell', () => {
      const source = `tell application "Finder"
  if (count windows) > 0 then
    close window 1
  end if
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse repeat in tell', () => {
      const source = `tell application "Finder"
  repeat with i from 1 to 10
    beep
  end repeat
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse deeply nested blocks', () => {
      const source = `tell application "Finder"
  tell window 1
    if (count items) > 0 then
      repeat with i from 1 to 5
        beep
      end repeat
    end if
  end tell
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });
  });

  suite('Case insensitivity', () => {
    test('should parse uppercase TELL-END TELL', () => {
      const source = `TELL application "Finder"
  activate
END TELL`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });

    test('should parse mixed case keywords', () => {
      const source = `Tell application "Finder"
  IF condition THEN
    beep
  End If
End Tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse lowercase keywords', () => {
      const source = `tell application "Finder"
  if condition then
    beep
  end if
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Generic end keyword', () => {
    test('should match generic end to most recent block', () => {
      const source = `on myHandler(x)
  return x * 2
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should match generic end in nested context', () => {
      const source = `tell application "Finder"
  on idle
    beep
  end
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should prefer specific end over generic in mixed usage', () => {
      const source = `tell application "Finder"
  if x > 0 then
    beep
  end if
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'tell');
      findBlock(pairs, 'if');
    });
  });

  suite('Excluded regions', () => {
    test('should skip keywords in double-dash comments', () => {
      const source = `tell application "Finder"
  -- tell if repeat end tell end if
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip keywords in block comments', () => {
      const source = `tell application "Finder"
  (* tell if repeat
     end tell end if *)
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle nested block comments', () => {
      const source = `tell application "Finder"
  (* outer (* inner end tell *) outer *)
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip keywords in strings', () => {
      const source = `tell application "Finder"
  set x to "tell end tell if end if"
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `tell application "Finder"
  set x to "end \\"tell\\""
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle comment at end of line', () => {
      const source = `tell application "Finder"
  activate -- this is not end tell
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      assertNoBlocks(parser.parse(''));
    });

    test('should handle source with no blocks', () => {
      assertNoBlocks(parser.parse('display dialog "Hello"'));
    });

    test('should handle unmatched tell', () => {
      assertNoBlocks(parser.parse('tell application "Finder"'));
    });

    test('should handle unmatched end tell', () => {
      assertNoBlocks(parser.parse('end tell'));
    });

    test('should handle unterminated string', () => {
      const source = `tell application "Finder
  activate
end tell`;
      const pairs = parser.parse(source);
      // Unterminated string extends to EOF
      assertNoBlocks(pairs);
    });

    test('should handle unterminated block comment', () => {
      const source = `tell application "Finder"
  (* unterminated comment
end tell`;
      const pairs = parser.parse(source);
      // Unterminated comment extends to EOF
      assertNoBlocks(pairs);
    });

    test('should handle keyword-like identifiers', () => {
      const source = `tell application "Finder"
  set tellme to 1
  set endif to 2
end tell`;
      const pairs = parser.parse(source);
      // tellme and endif should not be recognized as keywords
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle deeply nested blocks', () => {
      const source = `tell application "Finder"
  tell window 1
    tell container
      tell item 1
        tell folder 1
          activate
        end tell
      end tell
    end tell
  end tell
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
    });
  });

  suite('Token positions', () => {
    test('should report correct line and column for single line', () => {
      const source = 'tell application "Finder" end tell';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 0, 26);
    });

    test('should report correct positions for multi-line', () => {
      const source = `if x then
  y
end if`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should report correct positions for compound keywords', () => {
      const source = `tell application "Finder"
  activate
end tell`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });
  });

  suite('Keyword as substring of identifier', () => {
    test('should not match repeat inside repetition', () => {
      const source = `tell application "Finder"
  set repetition to 5
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should not match if inside notification', () => {
      const source = `tell application "Finder"
  set notification to "hello"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should not match end inside blender', () => {
      const source = `tell application "Finder"
  set blender to 1
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Handler definitions (to/on at line start)', () => {
    test('should parse to handler at line start', () => {
      const source = `to showMessage(msg)
  display dialog msg
end showMessage`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'to', 'end');
    });

    test('should not parse to in set statement as block', () => {
      const source = `tell application "Finder"
  set x to 5
  set y to 10
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should parse on handler at line start', () => {
      const source = `on run
  display dialog "Hello"
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not parse on in middle of line as block', () => {
      const source = `tell application "Finder"
  click on button 1
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Single-line if exclusion', () => {
    test('should not parse single-line if-then as block', () => {
      const source = `tell application "Finder"
  if x > 0 then set y to 1
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should parse multi-line if-then as block', () => {
      const source = `if x > 0 then
  set y to 1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not parse single-line if inside tell as block', () => {
      const source = `tell application "Finder"
  if x > 0 then doSomething()
  if y > 0 then
    set z to 1
  end if
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle if without then on same line', () => {
      const source = `if condition then
  action()
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions in if validation', () => {
    test('should not treat then in comment as single-line if', () => {
      const source = `if x -- then y
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat then in string as single-line if', () => {
      const source = `if x & "then" & y then
result
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('No hash comment', () => {
    test('should not treat # as comment character', () => {
      const source = `if true then
  set x to 5
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: compound keyword word boundary check', () => {
    test('should not match end tell compound when followed by word char', () => {
      // Tests the word boundary check for compound keywords
      // "end telling" starts with "end tell" but continues with "i"
      const source = 'tell application "Finder"\n  end telling\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end');
    });

    test('should not match on error compound when followed by word char', () => {
      // "on errors" starts with "on error" but continues with "s"
      const source = 'tell application "Finder"\n  on errors\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Tell-to one-liner', () => {
    test('should not treat tell-to one-liner as block', () => {
      const source = `tell application "Finder" to activate
if true then
  beep
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat tell-to with complex command as block', () => {
      const source = `tell application "Finder" to open file "test"
if true then
  beep
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should still parse multi-line tell block', () => {
      const source = `tell application "Finder"
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Coverage: single-line if with excluded region after then', () => {
    test('should handle excluded region after then on same line', () => {
      const source = `if x then "string with end" -- comment
tell application "Finder"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle unmatched end with empty stack', () => {
      const source = 'end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('CR-only line endings', () => {
    test('should handle isKeywordAsVariableName with \\r-only line endings', () => {
      // set repeat to 5 with \r-only line endings
      const source = 'on run\rset repeat to 5\rend run';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should handle on handler line-start check with \\r-only line endings', () => {
      // 'on' at line start with \r-only line endings
      const source = 'tell application "Finder"\r  activate\rend tell\ron myHandler()\r  beep\rend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should reject on in middle of line with \\r-only line endings', () => {
      // 'on' in middle of line should not be block opener
      const source = 'tell application "Finder"\r  click on button 1\rend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle to handler line-start check with \\r-only line endings', () => {
      const source = 'to myHandler(x)\r  return x\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'to', 'end');
    });

    test('should reject to in middle of line with \\r-only line endings', () => {
      const source = 'tell application "Finder"\r  set x to 5\rend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('v7 bug fixes - variable names as block keywords', () => {
    test('should not treat keyword in set-to as block opener', () => {
      const source = `on run
  set repeat to 5
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat keyword in copy-to as block opener', () => {
      const source = `on run
  copy script to x
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat keyword in set-to with script', () => {
      const source = `on run
  set script to "test"
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should still treat real block keywords normally', () => {
      const source = `tell application "Finder"
  if true then
    repeat 3 times
    end repeat
  end if
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should not treat tell in set-to as block opener', () => {
      const source = `on run
  set tell to 5
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat tell in copy-to as block opener', () => {
      const source = `on run
  copy tell to myVar
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });
});
