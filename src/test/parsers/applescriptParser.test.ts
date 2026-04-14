import * as assert from 'node:assert';
import { ApplescriptBlockParser } from '../../parsers/applescriptParser';
import { assertBlockCount, assertIntermediates, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('ApplescriptBlockParser Test Suite', () => {
  let parser: ApplescriptBlockParser;

  setup(() => {
    parser = new ApplescriptBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'display dialog "Hello"',
    tokenSource: 'if true then\nend if',
    expectedTokenValues: ['if', 'end if'],
    excludedSource: '-- comment\n"string"',
    expectedRegionCount: 2,
    twoLineSource: 'if true then\nend if',
    singleLineCommentSource: '-- if then end if repeat\nif true then\nend if',
    commentBlockOpen: 'if',
    commentBlockClose: 'end if',
    doubleQuotedStringSource: 'set x to "if then end if"\nif true then\nend if',
    stringBlockOpen: 'if',
    stringBlockClose: 'end if',
    commentAtEndOfLineSource: 'tell application "Finder"\n  activate -- this is not end tell\nend tell',
    commentAtEndOfLineBlockOpen: 'tell',
    commentAtEndOfLineBlockClose: 'end tell',
    escapedQuoteStringSource: 'tell application "Finder"\n  set x to "end \\"tell\\""\n  activate\nend tell',
    escapedQuoteStringBlockOpen: 'tell',
    escapedQuoteStringBlockClose: 'end tell'
  };

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
    generateExcludedRegionTests(config);

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

    test('should handle doubled-quote escaping in strings', () => {
      const pairs = parser.parse('tell application "Finder"\n  display dialog ""end tell""\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip keywords inside chevron/guillemet syntax', () => {
      const source = `tell application "Script Editor"
  set scriptObj to \u00ABscript end\u00BB
  tell scriptObj
    run
  end tell
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outerTell = pairs.find((p) => p.openKeyword.line === 0);
      assert.ok(outerTell);
      assert.strictEqual(outerTell.closeKeyword.value, 'end tell');
      assert.strictEqual(outerTell.closeKeyword.line, 5);
    });

    test('should skip if keyword inside chevron syntax', () => {
      const source = `if x > 0 then
  set y to \u00ABconstant if true\u00BB
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });

    test('should handle unterminated chevron syntax', () => {
      const source = `tell application "X"
  set x to \u00ABdata end tell
end tell`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect chevron as excluded region', () => {
      const source = 'set x to \u00ABclass furl\u00BB';
      const regions = parser.getExcludedRegions(source);
      const chevronRegion = regions.find((r) => source[r.start] === '\u00AB');
      assert.ok(chevronRegion);
      assert.strictEqual(source.slice(chevronRegion.start, chevronRegion.end), '\u00ABclass furl\u00BB');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

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
      // Unterminated string ends at newline (AppleScript strings are single-line)
      assertSingleBlock(pairs, 'tell', 'end tell');
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

    test('should not treat NOT sign inside comment as line continuation', () => {
      const source = 'if true then -- \u00AC\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat NOT sign inside comment as backward line continuation', () => {
      const source = 'x = 1 -- \u00AC\nscript myScript\n  property x : 1\nend script';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'script', 'end script');
    });

    test('should skip comments when scanning for continuation in isAtLogicalLineStart', () => {
      const pairs = parser.parse('set x to \u00AC -- comment\non run\nend');
      assertNoBlocks(pairs);
    });

    test('should skip comments when scanning for continuation in findLogicalLineEnd', () => {
      const pairs = parser.parse('if \u00AC -- comment\ntrue then x + 1');
      assertNoBlocks(pairs);
    });

    test('should skip comments when scanning for continuation in findLogicalLineStart', () => {
      const pairs = parser.parse('set \u00AC -- comment\nscript\nend');
      assertNoBlocks(pairs);
    });

    test('should detect set variable pattern when comment with continuation precedes line', () => {
      const pairs = parser.parse('-- comment \u00AC\nset repeat to 5');
      assertNoBlocks(pairs);
    });

    test('should not suppress block keyword when continuation character precedes of on next line', () => {
      const pairs = parser.parse('try \u00AC\nof something\n  riskyOp()\nend try');
      assertSingleBlock(pairs, 'try', 'end try');
    });
  });

  suite('Branch coverage: set/copy before middle keyword', () => {
    test('should skip compound middle keyword after set command', () => {
      // Covers applescriptParser.ts lines 269-270: set before block_middle compound keyword
      const source = `tell application "Finder"
  set on error to "default"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip compound middle keyword after copy command', () => {
      // Covers applescriptParser.ts lines 269-270: copy before block_middle compound keyword
      const source = `tell application "Finder"
  copy on error to myVar
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
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

  suite('Compound keywords with multiple spaces', () => {
    test('should match end tell with multiple spaces', () => {
      const source = `tell application "Finder"
  activate
end  tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should match end if with tab between words', () => {
      const source = `if true then
  beep
end\tif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should match end repeat with multiple spaces and tabs', () => {
      const source = `repeat 3 times
  beep
end  \t repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should match on error with multiple spaces', () => {
      const source = `try
  riskyOperation()
on  error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should match else if with multiple spaces', () => {
      const source = `if x = 1 then
  set result to "one"
else  if x = 2 then
  set result to "two"
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if']);
    });

    test('should match using terms from with extra spaces', () => {
      const source = `using  terms  from application "Mail"
  set newMessage to make new outgoing message
end  using  terms  from`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
    });
  });

  suite('on error as standalone handler', () => {
    test('should treat on error as block open outside try', () => {
      const source = `on error errMsg
  display dialog errMsg
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on error', 'end');
    });

    test('should treat on error as intermediate inside try', () => {
      const source = `try
  riskyOperation()
on error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should treat on error as block open in tell block', () => {
      const source = `tell application "Finder"
  on error errMsg
    display dialog errMsg
  end
end tell`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'tell');
      findBlock(pairs, 'on error');
    });

    test('should treat on error as block open when nested in non-try', () => {
      const source = `on run
  on error errMsg
    log errMsg
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'on');
      findBlock(pairs, 'on error');
    });
  });

  suite('Variable names as block keywords', () => {
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

    // Covers: '<keyword> of' pattern (property access)
    test('should not treat repeat in property access as block opener', () => {
      const source = `on run
  set x to name of repeat
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat end in property access as block keyword', () => {
      const source = `on run
  get value of end of list
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should treat repeat of after if/tell/repeat normally', () => {
      const source = `repeat with i from 1 to 10
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat tell after of as block opener', () => {
      const source = `on run
  set x to name of tell
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat if after of as block opener', () => {
      const source = `on run
  set x to value of if
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat script after of as block opener', () => {
      const source = `on run
  set x to name of script
end run`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  // Covers lines 420-421: keyword followed by 'of' as property access
  suite('Keyword of property access', () => {
    test('should reject block keyword followed by of as property access', () => {
      const source = `log repeat of myList
repeat 3 times
  beep
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should reject script of as property access', () => {
      const source = `log script of myApp
tell application "Finder"
  activate
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 2: end as property name should not close enclosing block', () => {
      const source = `tell application "Finder"
  set end to 5
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('Bug 2: end of myList should not close enclosing block', () => {
      const source = `tell application "Finder"
  get end of myList
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('Bug 2: copy end to x should not close enclosing block', () => {
      const source = `tell application "Finder"
  copy end to x
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('Bug 18: on after block comment should be recognized', () => {
      const source = `(* handler description *) on run
  beep
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('Bug 18: to after block comment should be recognized', () => {
      const source = `(* handler *) to doSomething()
  beep
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'to', 'end');
    });

    test("Bug 9: possessive form app's repeat should not start a block", () => {
      const source = `set x to app's repeat
tell application "Finder"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test("Bug 9: possessive form set X's end should not close a block", () => {
      const source = `set myObj's end to 5
repeat 3 times
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('possessive form with multiple spaces should not start a block', () => {
      const source = `set x to app's  repeat
tell application "Finder"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('possessive form with tab should not start a block', () => {
      const source = `set x to app's\trepeat
tell application "Finder"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('possessive form with mixed whitespace should not close a block', () => {
      const source = `set myObj's \t end to 5
repeat 3 times
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('compound close keyword in set-to should not be treated as block closer', () => {
      // Bug: 'end tell' in 'set end tell to x' bypasses isKeywordAsVariableName
      const source = `tell application "Finder"
  set end tell to x
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('compound close keyword end if in set-to should not be treated as block closer', () => {
      const source = `if true then
  set end if to 5
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('compound close keyword end repeat in copy-to should not be treated as block closer', () => {
      const source = `repeat 3 times
  copy end repeat to x
end repeat`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('compound open keyword with timeout in set-to should not be treated as block opener', () => {
      // Bug: 'with timeout' in 'set with timeout to x' bypasses isValidBlockOpen
      const source = `tell application "Finder"
  set with timeout to 30
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('compound open keyword using terms from in set-to should not be treated as block opener', () => {
      const source = `tell application "Finder"
  set using terms from to "test"
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('compound close keyword with possessive form should not be treated as block closer', () => {
      const source = `tell application "Finder"
  get app's end tell
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('compound close keyword followed by of should not be treated as block closer', () => {
      const source = `tell application "Finder"
  get end tell of myList
end tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('compound middle keyword on error in set-to should not be treated as intermediate', () => {
      const source = `try
  set on error to myHandler
on error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('compound middle keyword else if in set-to should not be treated as intermediate', () => {
      const source = `if true then
  set else if to 5
else
  beep
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else']);
    });

    test('compound middle keyword on error with possessive should not be treated as intermediate', () => {
      const source = `try
  get app's on error
on error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('compound middle keyword on error followed by of should not be treated as intermediate', () => {
      const source = `try
  get on error of myList
on error errMsg
  display dialog errMsg
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('single middle keyword else in set-to should not be treated as intermediate', () => {
      const source = `if true then
  set else to 5
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], []);
    });

    test('single middle keyword else with possessive should not be treated as intermediate', () => {
      const source = `if true then
  get app's else
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], []);
    });

    test('single middle keyword else followed by of should not be treated as intermediate', () => {
      const source = `if true then
  get else of myList
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], []);
    });
  });

  suite('on error in non-try blocks', () => {
    test('should treat on error as standalone handler when not directly inside try', () => {
      const source = `try
  repeat
    on error
      display dialog "error"
    end
  end repeat
on error
  display dialog "caught"
end try`;
      const pairs = parser.parse(source);
      // on error inside repeat is standalone (closed by end), repeat..end repeat, try..on error..end try
      const tryPair = pairs.find((p) => p.openKeyword.value === 'try');
      assert.ok(tryPair);
      // The outer on error (after end repeat) is intermediate of try (stack top is try at that point)
      assert.strictEqual(tryPair.intermediates.length, 1);
      assert.strictEqual(tryPair.intermediates[0].value, 'on error');
      // The inner on error is a standalone handler
      const handlerPair = pairs.find((p) => p.openKeyword.value === 'on error');
      assert.ok(handlerPair);
    });

    test('should correctly pair on error as intermediate of try when directly nested', () => {
      const source = `try
  set x to 1
on error
  set x to 0
end try`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value, 'on error');
    });
  });

  suite('Bug 1: line continuation character ¬', () => {
    test('should treat tell ¬ to as one-liner across continuation', () => {
      const source = `tell application "Finder" \u00AC\nto activate`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect then on continuation line for if block', () => {
      const source = 'if x > 0 \u00AC\nthen\n  log x\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should detect single-line if with then and action across continuation', () => {
      const source = 'if x > 0 \u00AC\nthen return 1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect set keyword as variable name across continuation', () => {
      const source = 'set \u00AC\nrepeat to 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle normal tell block without continuation', () => {
      const source = `tell application "Finder"\n  activate\nend tell`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip \\n in whitespace after then across continuation line', () => {
      // Bug 1: \\n was not in the whitespace skip set after 'then'
      // When if...then spans a continuation, the \\n in ¬\\n should be treated as whitespace
      const source = 'if x > 0 then \u00AC\n\n  log x\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should detect set/copy pattern across continuation for isKeywordAsVariableName', () => {
      // Bug 2: regexes in isKeywordAsVariableName fail when ¬\\n is in the joined text
      const source = 'set \u00AC\n  tell to 5\nrepeat 3 times\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should detect set pattern across continuation for compound middle keyword', () => {
      // Bug 3: compound keyword set/copy check uses simple line scan without ¬ continuations
      const source = 'try\n  set \u00AC\n  on error to myHandler\non error errMsg\n  display dialog errMsg\nend try';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should detect set pattern across continuation for compound open keyword', () => {
      // Bug 3: compound keyword set/copy check uses simple line scan without ¬ continuations
      const source = 'tell application "Finder"\n  set \u00AC\n  with timeout to 30\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Bug 7: isKeywordAsVariableName with \u00AC continuation', () => {
    test('should treat end as variable name when set end \u00AC to pattern spans continuation', () => {
      const source = 'set end \u00AC\n  to 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 8: on/to/script after \u00AC continuation should not be block opener', () => {
    test('should not treat on as block opener on a continuation line', () => {
      const source = 'set x to \u00AC\non run';
      const pairs = parser.parse(source);
      // 'on' is on a continuation line so should not be treated as block opener
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 2: multi-line block comment before on/to/script', () => {
    test('should recognize on handler after multi-line block comment spanning previous line', () => {
      // Bug 4: multi-line block comment starting on previous line has region.start < lineStart
      const source = '(* multi-line\ncomment *) on run\n  beep\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should recognize to handler after multi-line block comment spanning previous line', () => {
      const source = '(* multi-line\ncomment *) to doSomething()\n  beep\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'to', 'end');
    });

    test('should recognize script after multi-line block comment spanning previous line', () => {
      const source = '(* multi-line\ncomment *) script myScript\n  property x : 1\nend script';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'script', 'end script');
    });
  });

  suite('Bug 15: compound keywords with \u00AC continuation between words', () => {
    test('should match end \u00AC tell as end tell', () => {
      const source = 'tell application "Finder"\n  activate\nend \u00AC\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should match end \u00AC if as end if', () => {
      const source = 'if true then\n  beep\nend \u00AC\nif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should match else \u00AC if as else if', () => {
      const source = 'if x = 1 then\n  beep\nelse \u00AC\nif x = 2 then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if']);
    });

    test('should match on \u00AC error as on error', () => {
      const source = 'try\n  beep\non \u00AC\nerror errMsg\n  log errMsg\nend try';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should match with \u00AC timeout as with timeout', () => {
      const source = 'with \u00AC\ntimeout of 30 seconds\n  beep\nend timeout';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'with timeout', 'end timeout');
    });

    test('should match using \u00AC terms \u00AC from as using terms from', () => {
      const source = 'using \u00AC\nterms \u00AC\nfrom application "Mail"\n  beep\nend using terms from';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
    });

    test('should match end \u00AC tell with CRLF continuation', () => {
      const source = 'tell application "Finder"\n  activate\nend \u00AC\r\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should match end \u00AC tell with spaces before continuation', () => {
      const source = 'tell application "Finder"\n  activate\nend  \u00AC\n  tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should recognize compound keyword with block comment between words', () => {
      const source = 'tell application "Finder"\n  beep\nend (* comment *) tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Bug 15: false tell inside if condition', () => {
    test('should not treat tell in if-then condition as block opener', () => {
      const source = 'tell application "Finder"\n  if tell then\n    beep\n  end if\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'tell');
      findBlock(pairs, 'if');
    });

    test('should not treat tell in standalone if-then condition as block opener', () => {
      const source = 'if tell then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat tell in if not tell then as block opener', () => {
      const source = 'if not tell then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should still treat normal tell as block opener', () => {
      const source = 'tell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Bug: isInsideIfCondition with excluded regions', () => {
    test('should detect tell as condition value when comment appears between if and tell', () => {
      const source = 'if (* comment *) tell then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should detect tell as condition value when string appears between if and tell', () => {
      const source = 'if "test" & tell then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should follow logical line start across continuation with leading whitespace before not-sign', () => {
      // findLogicalLineStart: contentEnd hits whitespace before ¬, then contentEnd < 0 or source[contentEnd] !== ¬ branch
      // Build a continuation where previous line has trailing whitespace then ¬
      const source = 'if true \u00AC\n  tell then\n  beep\nend if';
      const pairs = parser.parse(source);
      // Should detect that tell is inside if-then condition
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle isInsideIfCondition when excluded region appears after tell keyword', () => {
      // isInsideIfCondition: lines 566-568, excluded region scanning inside the forward scan for 'then'
      const source = 'if tell (* comment *) then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle isInsideIfCondition when tell is followed by string then then', () => {
      // isInsideIfCondition: lines 574-575 fallthrough (then not found) — tell becomes block opener
      // 'if' pattern on same line, but 'then' is missing: tell becomes a real block opener
      const source = 'if something\ntell application "Finder"\n  activate\nend tell\nend if';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle matchCompoundKeyword with continuation character CRLF (lines 647-650)', () => {
      // matchCompoundKeyword continuation: ¬\r\n between words of compound keyword
      // 'end repeat' split across a line continuation with CRLF
      const source = 'repeat 3 times\n  beep\nend \u00AC\r\n  repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle matchCompoundKeyword with continuation character CR-only (line 647)', () => {
      // matchCompoundKeyword continuation: ¬\r between words
      const source = 'repeat 3 times\n  beep\nend \u00AC\r  repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Coverage: branch coverage for findLogicalLineEnd and findLogicalLineStart', () => {
    test('should handle CR-only line ending in findLogicalLineEnd continuation', () => {
      // Lines 472-474: findLogicalLineEnd encounters \r (without \n) after continuation character
      // The if block uses findLogicalLineEnd to scan for then across continuation lines
      const source = 'if x > 0 \u00AC\rthen\r  log x\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle CR-only continuation in tell-to one-liner check', () => {
      // Lines 472-474: \r-only after continuation in findLogicalLineEnd called from isTellToOneLiner
      const source = 'tell application "Finder" \u00AC\rto activate';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle CRLF continuation in findLogicalLineEnd for if block', () => {
      // Lines 472-474: \r\n after continuation character in findLogicalLineEnd
      const source = 'if x > 0 \u00AC\r\nthen\r\n  log x\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle findLogicalLineStart when continuation is at very start of file', () => {
      // Lines 504-505: contentEnd becomes < 0 when scanning backward past all whitespace
      // at the start of file. The continuation char at position 0 means contentEnd goes to -1
      const source = '\u00AC\nrepeat 3 times\n  beep\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle findLogicalLineStart with only whitespace before continuation', () => {
      // Lines 504-505: backward scan reaches contentEnd < 0
      // When the previous line content before \u00AC is empty (just the continuation at col 0)
      const source = '\u00AC\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Coverage: isInsideIfCondition return false (no then found)', () => {
    test('should not reject tell as condition when no then follows on logical line', () => {
      // Line 574: isInsideIfCondition scans forward for then after tell but reaches lineEnd
      // This means tell is not in an if-condition, so it is treated as a real block opener
      const source = 'if tell\n  activate\nend tell\nend if';
      const pairs = parser.parse(source);
      // if has no then -> treated as multi-line if block
      // tell is NOT rejected by isInsideIfCondition (no then found) -> treated as block opener
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'tell');
    });

    test('should not reject tell when if-tell line has no then keyword at all', () => {
      // Line 574: isInsideIfCondition returns false when forward scan finds no then
      const source = 'if tell application "Finder"\n  activate\nend tell\nend if';
      const pairs = parser.parse(source);
      // isInsideIfCondition: finds 'if' before 'tell', scans forward past 'tell'
      // on the logical line. '"Finder"' is an excluded region. No 'then' found -> returns false
      // tell is treated as real block opener
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: matchCompoundKeyword whitespace after continuation char', () => {
    test('should handle whitespace after continuation char before CRLF in compound keyword', () => {
      // Lines 644-646: spaces/tabs consumed after \u00AC before \r\n in matchCompoundKeyword
      const source = 'tell application "Finder"\n  activate\nend \u00AC \t\r\n  tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle whitespace after continuation char before LF in compound keyword', () => {
      // Lines 644-646: spaces consumed after \u00AC before \n in matchCompoundKeyword
      const source = 'repeat 3 times\n  beep\nend \u00AC  \n  repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle tab after continuation char before CR-only in compound keyword', () => {
      // Lines 644-646: tab consumed after \u00AC, then CR-only line ending
      const source = 'repeat 3 times\n  beep\nend \u00AC\t\r  repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Coverage: isAtLogicalLineStart with whitespace before continuation on previous line', () => {
    test('should not treat on as block opener when previous line ends with whitespace then continuation', () => {
      // Covers lines 379-380: scanning backward over whitespace before finding continuation char
      // Previous line ends with spaces/tabs then \u00AC, then newline
      const source = 'set x to   \u00AC\non run';
      const pairs = parser.parse(source);
      // 'on' is on a continuation line so should not be treated as block opener
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: findLogicalLineEnd with whitespace before continuation on line', () => {
    test('should detect single-line if when then has action after continuation with trailing whitespace', () => {
      // Covers lines 468-469: scanning backward over whitespace before finding continuation char on the line
      // The line containing 'if' ends with spaces then \u00AC
      const source = 'if x > 0   \u00AC\nthen return 1';
      const pairs = parser.parse(source);
      // then + action on continuation line makes it a single-line if
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: findLogicalLineStart with whitespace before continuation on previous line', () => {
    test('should follow logical line start across multi-line continuation with whitespace before continuation', () => {
      // Covers lines 504-505: backward scan encounters whitespace before \u00AC on previous line
      // Three lines connected by \u00AC: line1 has whitespace before \u00AC, then line2 with \u00AC, then line3 with keyword
      const source = 'set   \u00AC\nx   \u00AC\nto 5\nif true then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: nested block comments in compound keyword matching', () => {
    test('should handle nested block comments between words in compound keyword', () => {
      // Covers lines 650-651: nested block comment (* (* *) *) between words
      const source = 'tell application "Finder"\n  beep\nend (* outer (* inner *) *) tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Regression: set/copy keyword cross-line to matching', () => {
    test('should not reject keyword when to is on next line without continuation', () => {
      const source = 'set end\nto doSomething()\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should still reject keyword when to follows on same line', () => {
      const source = 'set repeat to 5\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should still reject keyword when to follows after continuation', () => {
      const source = 'set repeat \u00AC\n  to 5\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should not reject copy keyword when to is on next line without continuation', () => {
      const source = 'copy end\nto doSomething()\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Branch coverage: variable name check and tell-to one-liner', () => {
    test('should skip block_open keyword after set (variable name pattern)', () => {
      const source = 'set repeat to 5\nrepeat 3 times\n  display dialog "X"\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle tell-to one-liner with string between tell and to', () => {
      const source = 'tell "app" to activate\nrepeat 3 times\n  display dialog "X"\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle continuation character reaching end of file', () => {
      const source = 'repeat 3 times\n  display dialog "X" \u00AC\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Branch coverage: block_middle after set/copy and continuation whitespace', () => {
    test('should skip block_middle compound keyword after set without to (lines 268-270)', () => {
      // 'on error' after 'set' without 'to' bypasses isKeywordAsVariableName, reaching lines 268-270
      const source = 'tell application "Finder"\n  set on error\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip block_middle compound keyword after copy without to (lines 268-270)', () => {
      // 'on error' after 'copy' without 'to' bypasses isKeywordAsVariableName, reaching lines 268-270
      const source = 'tell application "Finder"\n  copy on error\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should handle continuation with trailing whitespace in isAtLogicalLineStart (lines 359-361)', () => {
      // Previous line ends with continuation character followed by spaces before newline
      const source = 'set x to \u00AC   \n  repeat 3 times\n  display dialog "X"\nend repeat';
      const pairs = parser.parse(source);
      // 'repeat' is not at logical line start because previous line ends with continuation
      assertBlockCount(pairs, 1);
    });

    test('should handle continuation with trailing whitespace in findLogicalLineEnd (lines 448-450)', () => {
      // tell line ends with continuation character followed by whitespace before newline
      const source = 'tell application "Finder" \u00AC   \n  to activate\nrepeat 3 times\n  display dialog "X"\nend repeat';
      const pairs = parser.parse(source);
      // tell...to one-liner should NOT create a block for tell
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should handle continuation with trailing whitespace in findLogicalLineStart (lines 484-486)', () => {
      // Multi-line continuation where previous lines end with continuation character followed by whitespace
      const source = 'set \u00AC   \nrepeat to 5\nrepeat 3 times\n  display dialog "X"\nend repeat';
      const pairs = parser.parse(source);
      // 'repeat' on the continuation line is a variable name after 'set'
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression: multiple continuation characters in compound keyword', () => {
    test('should handle double continuation between end and tell', () => {
      const source = 'tell application "Finder"\n  get name\nend \u00AC\n\u00AC\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Regression: Unicode adjacency check in tokenize', () => {
    test('should not detect keywords adjacent to Unicode letters', () => {
      const pairs = parser.parse('\u03B1tell application "Finder"\n  activate\nend tell');
      assertNoBlocks(pairs);
    });

    test('should not detect compound keywords adjacent to Unicode letters', () => {
      const pairs = parser.parse('\u03B1end tell');
      assertNoBlocks(pairs);
    });

    test('should still detect keywords not adjacent to Unicode letters', () => {
      const pairs = parser.parse('tell application "Finder"\n  activate\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Regression: pipe-delimited identifiers', () => {
    test('should exclude keywords inside pipe-delimited identifiers', () => {
      const pairs = parser.parse('tell application "Finder"\n  set x to |end|\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should exclude block open keywords inside pipe-delimited identifiers', () => {
      const pairs = parser.parse('tell application "Finder"\n  set x to |tell|\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should exclude keywords inside pipe-delimited identifiers with if', () => {
      const pairs = parser.parse('if true then\n  set x to |if|\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle unterminated pipe-delimited identifier', () => {
      const pairs = parser.parse('tell application "Finder"\n  set x to |end\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Branch coverage: line continuation inside comment', () => {
    test('should not follow continuation character inside comment (findLogicalLineEnd)', () => {
      // Covers line 509: ¬ inside excluded region (comment) should not continue to next line
      const source = 'if true then -- comment \u00AC\n  set x to 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not follow continuation character inside comment (findLogicalLineStart)', () => {
      // Covers line 561: ¬ inside excluded region (comment) should not merge with previous line
      const source = '-- comment \u00AC\nif true then\n  set x to 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle findLogicalLineStart with non-newline character before line', () => {
      // Covers line 534: prevChar is not newline/CR, breaking the while loop
      const source = 'if true then\n  set x to 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Branch coverage: possessive form before compound open keyword', () => {
    test('should skip compound open keyword with timeout after possessive form', () => {
      // Covers lines 338-339 (block_open branch): possessive pattern 's before compound open keyword
      const source = 'get app\'s with timeout\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip compound open keyword using terms from after possessive form', () => {
      const source = 'get app\'s using terms from\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip compound middle keyword on error after possessive form (set/copy branch)', () => {
      // Covers line 325 possessive branch for block_middle
      const source = "try\n  get app's on error\non error errMsg\n  display dialog errMsg\nend try";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });

    test('should skip compound middle keyword else if after set command', () => {
      // Covers line 325 set branch for block_middle
      const source = 'if true then\n  set else if to 5\nelse\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else']);
    });

    test('should skip compound open keyword with transaction after copy', () => {
      // Covers lines 338-339: copy before compound block_open keyword
      const source = 'tell application "Finder"\n  copy with transaction to myVar\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Branch coverage: comment skip after continuation in compound keyword', () => {
    test('should skip single-line comment between compound keyword words after continuation', () => {
      // Covers lines 760-764: single-line comment (--) after continuation char between compound keyword words
      const source = 'tell application "Finder"\n  activate\nend \u00AC -- comment\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip single-line comment after continuation in else if compound keyword', () => {
      const source = 'if x = 1 then\n  beep\nelse \u00AC -- remark\nif x = 2 then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if']);
    });

    test('should skip block comment between compound keyword words after continuation', () => {
      // Covers lines 766-783: block comment (* *) after continuation char between compound keyword words
      const source = 'tell application "Finder"\n  activate\nend \u00AC (* block comment *)\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip nested block comment after continuation in compound keyword', () => {
      // Covers nested block comment path in lines 770-778
      const source = 'tell application "Finder"\n  activate\nend \u00AC (* outer (* inner *) *)\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should skip block comment after continuation in on error compound keyword', () => {
      const source = 'try\n  beep\non \u00AC (* handler *)\nerror errMsg\n  log errMsg\nend try';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end try');
      assertIntermediates(pairs[0], ['on error']);
    });
  });

  suite('Branch coverage: matchCompoundKeyword no newline after continuation', () => {
    test('should reject compound keyword when continuation has no following newline', () => {
      // Covers lines 793-794: continuation char followed by comment that consumes the rest of string
      // end \u00AC -- comment (no newline) -> matchCompoundKeyword returns -1
      const source = 'tell application "Finder"\n  activate\nend \u00AC-- no newline';
      const pairs = parser.parse(source);
      // 'end' as generic close matches 'tell', but it is NOT 'end tell'
      assertSingleBlock(pairs, 'tell', 'end');
    });

    test('should reject compound keyword when continuation followed by block comment without newline', () => {
      // Covers lines 793-794 via the block comment path: after skipping comment, no newline found
      const source = 'tell application "Finder"\n  activate\nend \u00AC(* comment *)';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end');
    });
  });

  suite('Branch coverage: block comment after then in isValidBlockOpen', () => {
    test('should skip block comment region after then and treat as multi-line if', () => {
      // Covers line 132 branch: block comment (* *) after then is treated as comment (not content)
      const source = 'if x > 0 then (* block comment *)\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should skip block comment after then on continuation line', () => {
      const source = 'if x > 0 then (* explanation *) \u00AC\n(* more *)\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: set/copy pattern for compound block_middle keyword', () => {
    test('should skip compound block_middle keyword after set without to', () => {
      // Covers applescriptParser.ts line 325: set/copy pattern check for compound block_middle
      // 'else if' is a compound block_middle keyword; 'set ' prefix matches the regex
      // but isKeywordAsVariableName returns false (no 'to' after 'else if')
      const source = 'if true then\n  set else if = 5\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: block comment whitespace in continuation between compound keyword words', () => {
    test('should skip whitespace after block comment in continuation between compound keyword words', () => {
      // Covers applescriptParser.ts line 780: whitespace skip after block comment
      // between words of compound keyword separated by continuation character
      const source = 'tell application "Finder"\n  get name\nend \u00AC(* comment *) \ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });
  });

  suite('Regression: Unicode toLowerCase length change should not break parsing', () => {
    test('should parse blocks after U+0130 character', () => {
      // Before fix: source.toLowerCase() was pre-computed, but U+0130 (İ)
      // lowercases to 'i' + U+0307 (2 code units), causing position mismatch
      // and complete parsing failure
      const source = '\u0130 tell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should parse blocks after multiple U+0130 characters', () => {
      const source = '\u0130\u0130\u0130 if true then\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse compound keywords after U+0130 character', () => {
      // U+0130 on previous line; compound keyword at logical line start
      const source = '\u0130\nusing terms from application "Finder"\n  activate\nend using terms from';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
    });
  });

  suite('Regression: isInsideIfCondition with U+0130 and tell keyword', () => {
    test('should suppress tell as condition value in if...then when U+0130 precedes the line', () => {
      // Bug: isInsideIfCondition used pre-computed source.toLowerCase() causing
      // index mismatch with U+0130 (lowercases to 2 code units: 'i' + U+0307)
      // Without the fix, tell was NOT detected as inside if condition and produced
      // 2 pairs (tell...end tell and if...end if). With the fix, tell is correctly
      // suppressed as a condition value, leaving only if...end if.
      const source = '\u0130 if tell then\n  beep\nend tell\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  // Regression: isKeywordAsVariableName should strip block comments from lineBefore
  suite('Regression: block comment in set/copy pattern', () => {
    test('should detect set pattern with block comment before keyword', () => {
      // set (* comment *) repeat to 5 should treat repeat as variable name
      const source = 'set (* comment *) repeat to 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect of pattern with block comment before keyword', () => {
      // name of (* comment *) repeat should treat repeat as property target
      const source = 'on run\n  set x to name of (* comment *) repeat\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: compound block_open of-keyword check', () => {
    test('should detect on...end when with timeout is property access target', () => {
      const source = 'on run\n  set x to name of with timeout\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: compound open keywords after return/log/get/in', () => {
    test('should not treat with timeout after return as block open', () => {
      const source = 'on run\n  return with timeout\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat using terms from after log as block open', () => {
      const source = 'using terms from application "Mail"\n  log using terms from\nend using terms from';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'opener should be on line 0, not line 1');
    });

    test('should not treat with transaction after get as block open', () => {
      const source = 'on run\n  get with transaction\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat using terms from after in as block open', () => {
      const source = 'repeat with i in using terms from\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'using terms from'), 'using terms from should not be tokenized');
    });
  });

  suite('Bug: X of pattern should span line continuations', () => {
    test('should not treat repeat as block opener when followed by of on continuation line', () => {
      // 'repeat ¬\nof myList' is the same logical line as 'repeat of myList'
      // The 'X of' pattern in isKeywordAsVariableName should detect this
      const source = 'set x to repeat \u00AC\nof myList';
      const tokens = parser.getTokens(source);
      // Bug: 'repeat' should not appear as a token since it's a property access (repeat of)
      assert.ok(!tokens.some((t) => t.value === 'repeat'), 'repeat should not be tokenized when followed by of on continuation line');
    });

    test('should not treat tell as block opener when followed by of on continuation line', () => {
      // 'tell ¬\nof myApp' is property access, not a block opener
      const source = 'log tell \u00AC\nof myApp\ntell application "Finder"\n  activate\nend tell';
      const tokens = parser.getTokens(source);
      // Bug: there should be only ONE tell token (the real block opener), not two
      const tellTokens = tokens.filter((t) => t.value === 'tell');
      assert.strictEqual(tellTokens.length, 1, 'should have exactly 1 tell token');
    });

    test('should not treat end as block closer when followed by of on continuation line', () => {
      // 'end ¬\nof myList' is property access (end of myList), not a block closer
      const source = 'tell application "Finder"\n  get end \u00AC\nof myList\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
      // Verify the close keyword is on the correct line (last line, not the spurious end)
      assert.strictEqual(pairs[0].closeKeyword.line, 3);
    });

    test('should treat compound end tell at line start as block closer even with of on continuation line', () => {
      // 'end tell' at line start is a block closer, not property access
      const source = 'tell application "Finder"\n  end tell \u00AC\nof myList\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
      // The first end tell closes the tell block (line 1)
      assert.strictEqual(pairs[0].closeKeyword.line, 1);
    });

    test('should still detect X of pattern on same physical line (no continuation)', () => {
      // Sanity check: the same-line case should still work
      const source = 'set x to repeat of myList';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'repeat'), 'repeat should not be tokenized when followed by of on same line');
    });
  });

  suite('Block comment with newline between then and content', () => {
    test('should treat if as single-line when block comment with newline appears after then', () => {
      const source = 'if x then (* has\nnewline *) content\nend if';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still treat if as multi-line when only comment after then', () => {
      const source = 'if x then (* has\nnewline *)\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Regression: continuation-with-comment in set-to and compound keywords', () => {
    test('should suppress keyword in set...to with continuation and comment', () => {
      const source = 'set repeat \u00AC -- comment\nto 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should suppress compound keyword after set with continuation and comment', () => {
      const source = 'set \u00AC -- comment\nwith timeout of 30 seconds\n  beep\nend timeout';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: U+0130 toLowerCase position mismatch in set/copy pattern', () => {
    test('should suppress repeat in set pattern when block comment contains U+0130', () => {
      const source = 'set repeat (* \u0130 *) to 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should parse all blocks when U+0130 appears in block comment within if condition', () => {
      const source = 'tell application "X"\n  if (* \u0130 *) tell then\n    beep\n  end if\n  tell window 1\n    beep\n  end tell\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Regression: excluded region between keyword and of/to', () => {
    test('should suppress keyword when comment appears between keyword and of', () => {
      const source = 'on run\n  set x to repeat (* comment *) of myList\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should suppress keyword when comment appears between keyword and to in set', () => {
      const source = 'set repeat (* comment *) to 5';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should suppress keyword when string appears between keyword and of', () => {
      const source = 'on run\n  set x to repeat "label" of myList\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: block keywords in if condition', () => {
    test('should not treat repeat as block opener in if condition', () => {
      // With end repeat present, the false repeat would pair with it creating 2 blocks
      const pairs = parser.parse('if repeat then\n  beep\nend if\nend repeat');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat try as block opener in if condition', () => {
      const pairs = parser.parse('if try then\n  beep\nend if\nend try');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat considering as block opener in if condition', () => {
      const pairs = parser.parse('if considering then\n  beep\nend if\nend considering');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat ignoring as block opener in if condition', () => {
      const pairs = parser.parse('if ignoring then\n  beep\nend if\nend ignoring');
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Bug: keyword + continuation + of at line start not suppressed', () => {
    test('should suppress repeat when followed by of on continuation line at line start', () => {
      // 'repeat ¬\nof myList' is logically 'repeat of myList' (property access)
      // but the continuation-of check requires lineBefore.length > 0,
      // which fails at line start
      const tokens = parser.getTokens('repeat \u00AC\nof myList');
      assert.ok(!tokens.some((t) => t.value === 'repeat'), 'repeat should not be tokenized when followed by of on continuation line at line start');
    });

    test('should not create false block when repeat + continuation + of appears before real repeat block', () => {
      const pairs = parser.parse('repeat \u00AC\nof myList\nend repeat\nrepeat 3 times\n  beep\nend repeat');
      // The first 'repeat' is a property access (repeat of myList), NOT a block opener
      // Only the second 'repeat 3 times' should pair with 'end repeat'
      assertSingleBlock(pairs, 'repeat', 'end repeat');
      assert.strictEqual(pairs[0].openKeyword.line, 3, 'opener should be on line 3 (repeat 3 times)');
    });

    test('should suppress tell when followed by of on continuation line at line start', () => {
      const tokens = parser.getTokens('tell \u00AC\nof myApp');
      assert.ok(!tokens.some((t) => t.value === 'tell'), 'tell should not be tokenized when followed by of on continuation line at line start');
    });

    test('should suppress end when followed by of on continuation line at line start', () => {
      const source = 'tell application "Finder"\nend \u00AC\nof myList\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'end tell should be on line 3');
    });

    test('should suppress try when followed by of on continuation line at line start', () => {
      const tokens = parser.getTokens('try \u00AC\nof myList');
      assert.ok(!tokens.some((t) => t.value === 'try'), 'try should not be tokenized when followed by of on continuation line at line start');
    });

    test('should still suppress keyword of on same physical line at line start', () => {
      // Sanity check: same-line case should still work
      const tokens = parser.getTokens('repeat of myList');
      assert.ok(!tokens.some((t) => t.value === 'repeat'), 'repeat should not be tokenized for same-line of');
    });

    test('should still suppress keyword of on continuation line with preceding context', () => {
      // Sanity check: with-context case should still work
      const tokens = parser.getTokens('set x to repeat \u00AC\nof myList');
      assert.ok(!tokens.some((t) => t.value === 'repeat'), 'repeat should not be tokenized with preceding context');
    });
  });

  suite('Bug: bare end in expression context falsely closes block', () => {
    test('should not treat end after return as block closer', () => {
      // 'return end' returns the value of 'end' (last element reference)
      // The 'end' should NOT close the enclosing handler
      const pairs = parser.parse('on run\n  return end\nend');
      assertSingleBlock(pairs, 'on', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'end should close on line 2 (real end), not line 1 (return end)');
    });

    test('should not treat end after log as block closer', () => {
      const pairs = parser.parse('on run\n  log end\nend');
      assertSingleBlock(pairs, 'on', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'end should close on line 2');
    });

    test('should not treat end in if-condition as block closer', () => {
      // 'if end then' uses 'end' as a condition value
      const source = 'tell application "Finder"\n  if end then\n    beep\n  end if\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'tell');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end if', 'if block should be closed by end if');
    });

    test('should still treat end at line start as block closer', () => {
      // 'end' at line start alone IS a block closer
      const pairs = parser.parse('on run\n  beep\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should still treat end of as property access (already handled)', () => {
      // Sanity: 'end of myList' is handled by existing 'X of Y' pattern
      const pairs = parser.parse('on run\n  log end of myList\nend');
      assertSingleBlock(pairs, 'on', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression: exit repeat and expression-context keywords', () => {
    test('should not treat repeat in exit repeat as block opener', () => {
      const pairs = parser.parse('repeat\n  exit repeat\nend repeat');
      assertSingleBlock(pairs, 'repeat', 'end repeat');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'should pair with repeat on line 0');
    });

    test('should not treat repeat after log as block opener', () => {
      const pairs = parser.parse('repeat\n  log repeat\nend repeat');
      assertSingleBlock(pairs, 'repeat', 'end repeat');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'should pair with repeat on line 0');
    });

    test('should not treat tell after return as block opener', () => {
      const pairs = parser.parse('on run\n  return tell\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat tell after get as block opener', () => {
      const pairs = parser.parse('on run\n  get tell\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat if after return as block opener', () => {
      const pairs = parser.parse('on run\n  return if\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: keywords inside complex if conditions', () => {
    test('should not treat end after not as block closer in if condition', () => {
      const source = 'tell application "X"\n  if not end then\n    beep\n  end if\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end if');
      findBlock(pairs, 'tell');
    });

    test('should not treat end after and as block closer in if condition', () => {
      const source = 'tell application "X"\n  if true and end then\n    beep\n  end if\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end if');
      findBlock(pairs, 'tell');
    });

    test('should not treat end inside parentheses as block closer in if condition', () => {
      const source = 'tell application "X"\n  if (end > 0) then\n    beep\n  end if\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value, 'end if');
      findBlock(pairs, 'tell');
    });

    test('should not treat tell after not as block opener in if condition', () => {
      const source = 'if not tell then\n  beep\nend if';
      const tokens = parser.getTokens(source);
      const tellTokens = tokens.filter((t) => t.value === 'tell');
      assert.strictEqual(tellTokens.length, 0, 'tell should not appear as a token inside if condition');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat repeat after not as block opener in if condition', () => {
      const source = 'if not repeat then\n  beep\nend if';
      const tokens = parser.getTokens(source);
      const repeatTokens = tokens.filter((t) => t.value === 'repeat');
      assert.strictEqual(repeatTokens.length, 0, 'repeat should not appear as a token inside if condition');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat tell after and as block opener in if condition', () => {
      const source = 'if true and tell then\n  beep\nend if';
      const tokens = parser.getTokens(source);
      const tellTokens = tokens.filter((t) => t.value === 'tell');
      assert.strictEqual(tellTokens.length, 0, 'tell should not appear as a token inside if condition');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Regression: block keywords after in in repeat with X in', () => {
    test('should not treat tell after in as block opener', () => {
      const source = 'repeat with i in tell\n  log i\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat repeat after in as block opener', () => {
      const source = 'repeat with i in repeat\n  log i\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression: end after prepositions in expression context', () => {
    test('should not treat end after to as block closer', () => {
      const source = 'repeat with i from 1 to end\n  beep\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat end after thru as block closer', () => {
      const source = 'repeat with i from 1 to 5\n  set x to items 1 thru end of myList\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat end after through as block closer', () => {
      const source = 'repeat with i from 1 to 5\n  set x to items 1 through end of myList\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat end after from as block closer', () => {
      const source = 'repeat with i from 1 to 5\n  set x to items from end of myList\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression: repeat while/until suppresses keywords in condition', () => {
    test('should not treat end in repeat while condition as block closer', () => {
      const source = 'repeat while end\n  beep\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat end in repeat until condition as block closer', () => {
      const source = 'repeat until end\n  beep\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression: multi-line block comment disrupting line boundary scanning', () => {
    test('should treat if as single-line when multi-line block comment precedes then', () => {
      const source = 'if x (* comment\nspanning *) then doSomething()\ntell application "Finder"\n  activate\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should suppress condition keyword inside multi-line block comment context', () => {
      const source = 'if (* multi\nline *) true then\n  beep\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Regression tests', () => {
    test('should not detect with timeout inside tell...to one-liner as block opener', () => {
      const source = 'with timeout of 60 seconds\n  tell application "X" to open with timeout of 30 seconds\nend timeout';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'with timeout', 'end timeout');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });

    test('should not detect considering inside tell...to one-liner as block opener', () => {
      const source = 'considering case\n  tell application "X" to do something considering the rules\nend considering';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'considering', 'end considering');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });

    test('should not detect ignoring inside expression as block opener', () => {
      const source = 'ignoring case\n  tell application "X" to do something ignoring case\nend ignoring';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'ignoring', 'end ignoring');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });
  });

  suite('Regression: mid-line compound keyword false positive', () => {
    test('should not detect mid-line with timeout as block opener', () => {
      const pairs = parser.parse(
        'with timeout of 60 seconds\n  tell application "X"\n    activate with timeout of 30 seconds\n  end tell\nend timeout'
      );
      assertBlockCount(pairs, 2);
      const wt = findBlock(pairs, 'with timeout');
      assert.strictEqual(wt.openKeyword.line, 0);
      assert.strictEqual(wt.closeKeyword.line, 4);
    });

    test('should not detect mid-line considering as block opener', () => {
      const pairs = parser.parse('considering case\n  do something considering case\nend considering');
      assertSingleBlock(pairs, 'considering', 'end considering');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
    });
  });

  suite('Regression: keyword context validation', () => {
    test('should suppress repeat as variable in mid-line set statement', () => {
      const pairs = parser.parse('on run\n  if true then set repeat to 5\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should suppress repeat as variable in mid-line copy statement', () => {
      const pairs = parser.parse('on run\n  if true then copy repeat to x\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should handle if as condition value in if statement', () => {
      const pairs = parser.parse('if if then\n  beep\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });

    test('should handle if as condition value in repeat while', () => {
      const pairs = parser.parse('repeat while if\n  beep\nend repeat');
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression: bare end after prepositions', () => {
    test('should not treat end as block closer after by preposition', () => {
      const pairs = parser.parse('repeat with i from 1 to 10 by end\n  beep\nend repeat');
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });

    test('should not treat end as block closer after before preposition', () => {
      const pairs = parser.parse('on run\n  insert x before end\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat end as block closer after after preposition', () => {
      const pairs = parser.parse('on run\n  insert x after end\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should not treat end as block closer after at preposition', () => {
      const pairs = parser.parse('on run\n  insert x at end\nend');
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: nested chevron/guillemet syntax', () => {
    test('should handle nested chevrons without exposing inner keywords', () => {
      const pairs = parser.parse('tell application "X"\n  set x to \u00ABa \u00ABb\u00BB end tell \u00BB\nend tell');
      assertSingleBlock(pairs, 'tell', 'end tell');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression: compound close keywords should not be suppressed by of pattern', () => {
    test('should detect end tell even when followed by of on same line', () => {
      const pairs = parser.parse('tell application "Finder"\nend tell of myList');
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should detect end if even when followed by of on same line', () => {
      const pairs = parser.parse('if true then\n  beep\nend if of myList');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should detect end repeat even when followed by of on same line', () => {
      const pairs = parser.parse('repeat 3 times\n  beep\nend repeat of myList');
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression 2026-04-11: mid-line end keywords', () => {
    test('should not treat end tell in the middle of a list literal as block close', () => {
      const source = 'tell application "Finder"\n  set y to {item 1, item 2 end tell}\nend tell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat bare end mid-line as block close', () => {
      const source = 'on foo()\n  set y to 1 end 2\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should not treat end if mid-line as block close', () => {
      const source = 'if x > 0 then\n  set y to 1 end if 2\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });
  });

  suite('Regression: mid-line try should not be a block opener', () => {
    test('should not tokenize try as block opener after method call', () => {
      const source = 'on run\n  doStuff() try\n  log "x"\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });
  });

  suite('Regression: mid-line tell/if/repeat after expression terminator', () => {
    test('should reject mid-line tell after function call with parens', () => {
      const source = 'on outer()\n  doStuff() tell\n  more()\nend outer';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should reject mid-line repeat after function call with parens', () => {
      const source = 'on foo()\n  doStuff() repeat\n  bar()\nend foo';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should reject mid-line if after identifier', () => {
      const source = 'on foo()\n  x if y\n  bar()\nend foo';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'on', 'end');
    });

    test('should still accept tell after if condition keyword', () => {
      const source = 'if tell\n  activate\nend tell\nend if';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should still accept repeat while with tell condition', () => {
      const source = 'repeat while tell\n  doStuff()\nend repeat';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'end repeat');
    });
  });

  suite('Regression 2026-04-14: compound keyword continuation with comment on next line', () => {
    test('should match "end tell" split by continuation and block comment', () => {
      const source = 'tell application "X"\n  act\nend \u00AC\n(* c *)\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should match "end tell" split by continuation and line comment', () => {
      const source = 'tell application "X"\n  act\nend \u00AC\n-- comment\ntell';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'tell', 'end tell');
    });

    test('should match "using terms from" split by continuation and comment', () => {
      const source = 'using \u00AC\n(* c *)\nterms from app "X"\n  beep\nend using terms from';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'using terms from', 'end using terms from');
    });
  });

  suite('Regression 2026-04-14: else/else if only attach to if block', () => {
    test('should not attach "else if" as intermediate when parent is try block', () => {
      // Before fix: 'else if' was unconditionally added to the top stack block
      // (try), producing spurious intermediates on the enclosing block.
      // After fix: 'else if' is ignored when the parent is not an 'if' block.
      const source = 'try\n  beep\nelse if x > 0 then\n  log x\nend try';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const tryBlock = findBlock(pairs, 'try');
      assert.ok(!tryBlock.intermediates.some((t) => t.value === 'else if'), 'else if must not attach to try block');
    });

    test('should not attach "else" to a tell block', () => {
      const source = 'tell application "Finder"\n  beep\nelse\n  log "x"\nend tell';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const tellBlock = findBlock(pairs, 'tell');
      assert.ok(!tellBlock.intermediates.some((t) => t.value === 'else'), 'else must not attach to tell block');
    });

    test('should still attach "else if" as intermediate of if block', () => {
      const source = 'if x > 0 then\n  log "pos"\nelse if x < 0 then\n  log "neg"\nelse\n  log "zero"\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['else if', 'else']);
    });
  });

  generateCommonTests(config);
});
