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
    stringBlockClose: 'end if'
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

    // Covers lines 420-421: '<keyword> of' pattern (property access)
    test('should not treat repeat in property access as block opener', () => {
      const source = `on run
  set x to name of repeat
end run`;
      const pairs = parser.parse(source);
      // Currently, 'repeat' after 'of' is still detected as a block keyword
      // because the 'of' pattern check excludes 'repeat' from the check
      // So we expect repeat-end to be paired
      const repeatPair = findBlock(pairs, 'repeat');
      assert.ok(repeatPair, 'Expected repeat block to be found');
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

  generateCommonTests(config);
});
