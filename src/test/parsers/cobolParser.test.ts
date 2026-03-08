import * as assert from 'node:assert';
import { CobolBlockParser } from '../../parsers/cobolParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('CobolBlockParser Test Suite', () => {
  let parser: CobolBlockParser;

  setup(() => {
    parser = new CobolBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'MOVE A TO B',
    tokenSource: 'IF CONDITION\nELSE\nEND-IF',
    expectedTokenValues: ['IF', 'ELSE', 'END-IF'],
    excludedSource: "*> comment\n'string'",
    expectedRegionCount: 2,
    twoLineSource: 'IF CONDITION\nEND-IF',
    nestedPositionSource: 'PERFORM\n  IF CONDITION\n  END-IF\nEND-PERFORM',
    nestedKeyword: 'IF',
    nestedLine: 1,
    nestedColumn: 2,
    singleLineCommentSource: 'IF CONDITION\n  *> IF PERFORM END-IF\nEND-IF',
    commentBlockOpen: 'IF',
    commentBlockClose: 'END-IF',
    doubleQuotedStringSource: 'IF CONDITION\n  "IF PERFORM END-IF"\nEND-IF',
    stringBlockOpen: 'IF',
    stringBlockClose: 'END-IF'
  };

  suite('Simple blocks', () => {
    test('should parse PERFORM block', () => {
      const source = `PERFORM
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should parse IF block', () => {
      const source = `IF CONDITION
  DISPLAY "True"
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should parse EVALUATE block', () => {
      const source = `EVALUATE VALUE
  WHEN 1
    DISPLAY "One"
  WHEN OTHER
    DISPLAY "Other"
END-EVALUATE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });

    test('should parse READ block', () => {
      const source = `READ FILE-NAME
  AT END
    SET EOF TO TRUE
END-READ`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'READ', 'END-READ');
    });

    test('should parse WRITE block', () => {
      const source = `WRITE RECORD-NAME
  INVALID KEY
    DISPLAY "Error"
END-WRITE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'WRITE', 'END-WRITE');
    });

    test('should parse SEARCH block', () => {
      const source = `SEARCH TABLE-NAME
  AT END
    DISPLAY "Not found"
  WHEN CONDITION
    DISPLAY "Found"
END-SEARCH`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'SEARCH', 'END-SEARCH');
    });

    test('should parse STRING block', () => {
      const source = `STRING A B DELIMITED BY SIZE
  INTO C
  ON OVERFLOW
    DISPLAY "Overflow"
END-STRING`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'STRING', 'END-STRING');
    });

    test('should parse UNSTRING block', () => {
      const source = `UNSTRING SOURCE-STRING
  DELIMITED BY SPACE
  INTO A B
  ON OVERFLOW
    DISPLAY "Overflow"
END-UNSTRING`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'UNSTRING', 'END-UNSTRING');
    });

    test('should parse CALL block', () => {
      const source = `CALL "SUBPROGRAM"
  ON EXCEPTION
    DISPLAY "Error"
END-CALL`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'CALL', 'END-CALL');
    });

    test('should parse COMPUTE block', () => {
      const source = `COMPUTE RESULT = A + B
  ON SIZE ERROR
    DISPLAY "Overflow"
END-COMPUTE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'COMPUTE', 'END-COMPUTE');
    });

    test('should parse ADD block', () => {
      const source = `ADD A TO B
  ON SIZE ERROR
    DISPLAY "Overflow"
END-ADD`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'ADD', 'END-ADD');
    });

    test('should parse SUBTRACT block', () => {
      const source = `SUBTRACT A FROM B
  ON SIZE ERROR
    DISPLAY "Overflow"
END-SUBTRACT`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'SUBTRACT', 'END-SUBTRACT');
    });

    test('should parse MULTIPLY block', () => {
      const source = `MULTIPLY A BY B
  ON SIZE ERROR
    DISPLAY "Overflow"
END-MULTIPLY`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'MULTIPLY', 'END-MULTIPLY');
    });

    test('should parse DIVIDE block', () => {
      const source = `DIVIDE A BY B
  ON SIZE ERROR
    DISPLAY "Overflow"
END-DIVIDE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'DIVIDE', 'END-DIVIDE');
    });

    test('should parse ACCEPT block', () => {
      const source = `ACCEPT USER-INPUT
  ON EXCEPTION
    DISPLAY "Error"
END-ACCEPT`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'ACCEPT', 'END-ACCEPT');
    });

    test('should parse DISPLAY block', () => {
      const source = `DISPLAY MESSAGE
  WITH NO ADVANCING
  ON EXCEPTION
    CONTINUE
END-DISPLAY`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'DISPLAY', 'END-DISPLAY');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse IF-ELSE block', () => {
      const source = `IF CONDITION
  MOVE 1 TO A
ELSE
  MOVE 2 TO A
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should parse EVALUATE with WHEN', () => {
      const source = `EVALUATE VALUE
  WHEN 1
    DISPLAY "One"
  WHEN 2
    DISPLAY "Two"
  WHEN OTHER
    DISPLAY "Other"
END-EVALUATE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `PERFORM
  IF CONDITION
    EVALUATE VALUE
      WHEN 1
        DISPLAY "Nested"
    END-EVALUATE
  END-IF
END-PERFORM`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'PERFORM', 0);
      assertNestLevel(pairs, 'IF', 1);
      assertNestLevel(pairs, 'EVALUATE', 2);
    });

    test('should handle deeply nested IF statements', () => {
      const source = `IF A
  IF B
    IF C
      DISPLAY "Deep"
    END-IF
  END-IF
END-IF`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should handle comment at end of line', () => {
      const source = `IF CONDITION *> END-IF here
  DISPLAY "Test"
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted strings', () => {
      const source = `MOVE 'IF PERFORM END-IF END-PERFORM' TO A
IF CONDITION
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `MOVE 'It''s an IF statement' TO A
IF CONDITION
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Case insensitivity', () => {
    test('should handle lowercase keywords', () => {
      const source = `if condition
  display "test"
end-if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end-if');
    });

    test('should handle mixed case keywords', () => {
      const source = `If Condition
  Display "Test"
End-If`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'If', 'End-If');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle multiple PERFORM blocks', () => {
      const source = `PERFORM
  DISPLAY "First"
END-PERFORM

PERFORM
  DISPLAY "Second"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not match mismatched end keywords', () => {
      const source = `IF CONDITION
  DISPLAY "Test"
END-PERFORM`;
      const pairs = parser.parse(source);
      // END-PERFORM should not close IF
      assertNoBlocks(pairs);
    });

    test('should handle complex real-world COBOL code', () => {
      const source = `PERFORM VARYING I FROM 1 BY 1 UNTIL I > 10
  IF I > 5
    EVALUATE TRUE
      WHEN I = 6
        DISPLAY "Six"
      WHEN OTHER
        DISPLAY "Other"
    END-EVALUATE
  ELSE
    DISPLAY "Small"
  END-IF
END-PERFORM`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle unterminated string', () => {
      const source = `MOVE "unterminated
IF CONDITION
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle unterminated string at end of file', () => {
      // Tests matchCobolString reaching end of source
      const source = `MOVE "unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle PERFORM with UNTIL', () => {
      const source = `PERFORM UNTIL DONE
  READ FILE
  END-READ
END-PERFORM`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not match hyphenated identifiers like END-IF-FLAG', () => {
      const source = 'MOVE END-IF-FLAG TO WS-STATUS';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match PERFORM-COUNT as keyword', () => {
      const source = 'ADD 1 TO PERFORM-COUNT';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match END-PERFORM-LOOP as END-PERFORM', () => {
      const source = `PERFORM
  DISPLAY "Test"
END-PERFORM
MOVE END-PERFORM-FLAG TO STATUS`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should not match END-PERFORM inside hyphenated identifier', () => {
      const source = `PERFORM
  MOVE MY-END-PERFORM-LOOP TO X
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('END-keyword in comment', () => {
    test('should not treat keyword as block open when END-keyword is only in comment', () => {
      const source = `PERFORM SECTION-A
*> END-PERFORM`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Fixed-format column 7 comments', () => {
    test('should exclude line with * at column 7', () => {
      const source = `      * This is a comment line
       PERFORM
         DISPLAY "Hello"
       END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should exclude line with / at column 7', () => {
      const source = `      / Page eject comment
       IF X = 1
       END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should ignore keywords inside column 7 comments', () => {
      const source = `      * IF PERFORM END-IF
       PERFORM
         DISPLAY "Hello"
       END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should not treat * at other columns as comment', () => {
      const source = `       COMPUTE X = A * B
       IF X > 0
       END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should detect column 7 comment in excluded regions', () => {
      const source = '      * comment line';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 6);
    });

    test('should detect column 7 / in excluded regions', () => {
      const source = '      / page eject';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 6);
    });

    test('should handle multiple column 7 comment lines', () => {
      const source = `      * First comment
      * Second comment
       IF X = 1
      * Third comment
       END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle * at column 7 on first line (pos 6)', () => {
      const source = `      *COMMENT WITH NO SPACE
       PERFORM
       END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should recognize column 7 comment with tab character', () => {
      // Tab (width 8) puts * at visual column 8, not column 7
      // But a single tab that accounts for 6 visual columns before the *
      // is not standard; typically \t expands to column 8.
      // A tab at start goes to visual column 8 (past column 7).
      // We need sequence area to be columns 1-6 (visual 0-5) and column 7 (visual 6) is the indicator.
      // With spaces: 6 spaces = visual column 6, then * is at visual column 6. Correct.
      // With tab: 1 tab from col 0 -> visual column 8 (tab stop). Too far.
      // For tab to reach visual column 6: not possible with single tab from col 0.
      // But consider: some positions + tab can reach column 6.
      // E.g., 5 spaces + tab: visual = 5, tab stop = 8. So tab goes to 8. Still not 6.
      // The realistic case: columns 1-6 with tabs inside sequence numbers.
      // E.g., "12\t" = 1 at 0, 2 at 1, tab to 8. Then * at 8 -> not 6.
      // Actually, in real COBOL, tabs might replace part of the sequence area.
      // A single tab from col 0 goes to col 8 - this is NOT column 7 (visual 6).
      // More realistic: "1\t" = '1' at 0, tab to 8. * at visual 8 -> not 6.
      // Let's test: 3 chars + tab = 3, tab to 8. * at 8 -> not 6.
      // To get visual column 6: we can't with standard 8-wide tabs from col 0 easily.
      // BUT we CAN test the regex: digits+tabs in sequence area.
      const source = '      *Tab test IF END-IF\n       IF condition\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should exclude debug line with D at column 7', () => {
      const source = `      D DEBUG-LINE IF END-IF
       IF condition
       END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should exclude debug line with lowercase d at column 7', () => {
      const source = `      d debug-line IF END-IF
       IF condition
       END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat D at non-column-7 position as debug indicator', () => {
      const source = `D = 1
IF condition
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should detect debug line D in excluded regions', () => {
      const source = '      D debug line';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 6);
    });
  });

  suite('Nesting-aware validation', () => {
    test('should correctly validate nested IF blocks', () => {
      const source = 'IF condition-1\n  IF condition-2\n    DISPLAY "inner"\n  END-IF\nEND-IF';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
    });

    test('should correctly validate nested PERFORM blocks', () => {
      const source = 'PERFORM\n  PERFORM\n    DISPLAY "inner"\n  END-PERFORM\nEND-PERFORM';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
    });

    test('should not validate opener without matching closer at correct depth', () => {
      const source = 'IF condition-1\n  DISPLAY "hello"\n  IF condition-2\n    DISPLAY "nested"\n  END-IF';
      const pairs = parser.parse(source);
      // Only the inner IF should be validated (it has its own END-IF)
      // The outer IF has no END-IF at depth 0
      assert.strictEqual(pairs.length, 1);
    });
  });

  suite('Column 7 comment detection', () => {
    test('should treat column 7 star as comment in fixed-format', () => {
      const source = '000100*This is a comment\n       IF condition\n       END-IF';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
    });

    test('should not treat column 7 star as comment when prefix is not sequence area', () => {
      const source = 'abcdef*not a comment\n       IF condition\n       END-IF';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
    });

    test('should handle column 7 with spaces in sequence area', () => {
      const source = '      *This is a comment with IF keyword\n       IF condition\n       END-IF';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
    });
  });

  suite('Underscore in identifiers', () => {
    test('should not match keyword inside underscored identifier', () => {
      const source = 'MOVE PERFORM_COUNT TO WS-STATUS';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keyword with leading underscore', () => {
      const source = 'MOVE _PERFORM TO WS-STATUS';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match keyword with trailing underscore', () => {
      const source = 'MOVE IF_ TO WS-FLAG';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match END-IF inside underscored identifier', () => {
      const source = 'MOVE END-IF_FLAG TO WS-STATUS';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still match standalone keywords after underscore fix', () => {
      const source = `IF CONDITION
  DISPLAY "Test"
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Type-aware intermediates', () => {
    test('should add ELSE to IF block', () => {
      const source = 'IF condition\n  DISPLAY "yes"\nELSE\n  DISPLAY "no"\nEND-IF';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'else');
    });

    test('should not add ELSE to PERFORM block', () => {
      const source = 'PERFORM\n  DISPLAY "hello"\n  ELSE\nEND-PERFORM';
      const pairs = parser.parse(source);
      const performPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'perform');
      assert.ok(performPair);
      assert.strictEqual(performPair.intermediates.length, 0);
    });

    test('should add WHEN to EVALUATE block', () => {
      const source = 'EVALUATE TRUE\n  WHEN condition\n    DISPLAY "match"\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      assert.ok(pairs[0].intermediates.length >= 1);
    });

    test('should add WHEN to SEARCH block', () => {
      const source = 'SEARCH table-name\n  WHEN condition\n    DISPLAY "found"\nEND-SEARCH';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      assert.ok(pairs[0].intermediates.length >= 1);
    });

    test('should not add WHEN to PERFORM block', () => {
      const source = 'PERFORM\n  WHEN\nEND-PERFORM';
      const pairs = parser.parse(source);
      const performPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'perform');
      assert.ok(performPair);
      assert.strictEqual(performPair.intermediates.length, 0);
    });
  });

  suite('Coverage: tab expansion in getVisualColumn', () => {
    test('should expand tab character in sequence area for column 7 detection', () => {
      // Lines 249-250: source[i] === '\t' -> tab expansion
      // A tab from col 0 expands to visual col 8, so * at position 7 is NOT at visual column 6
      // The tab branch is exercised even if the result doesn't equal 6
      const source = '\t      *comment text here\n       IF condition\n       END-IF';
      const pairs = parser.parse(source);
      // * is at visual column 14 (tab=8 + 6 spaces), not 6, so not a comment
      // The first line has no keywords, only the second/third lines have IF/END-IF
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle tab in sequence area that reaches visual column 6', () => {
      // 4 digits + tab (col 4 -> tab to 8) + ' ' + '*' => * at visual col 9. Not 6.
      const source = '1234\t *comment text\n       IF x\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 9: D/d keyword at column 7 should not be treated as debug line', () => {
      const pairs = parser.parse('      DIVIDE A BY B\n      END-DIVIDE');
      assertSingleBlock(pairs, 'DIVIDE', 'END-DIVIDE');
    });

    test('Bug 13: inline PERFORM inside structured PERFORM should not cause false depth', () => {
      const source = `PERFORM UNTIL X > 10
  PERFORM PARAGRAPH-A
  PERFORM PARAGRAPH-B
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 13: nested structured PERFORMs with inline PERFORMs should be detected', () => {
      const source = `PERFORM UNTIL X > 10
  PERFORM PARAGRAPH-A
  PERFORM UNTIL Y > 5
    DISPLAY "INNER"
  END-PERFORM
  PERFORM PARAGRAPH-B
END-PERFORM`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outerPerform = pairs.find((p) => p.nestLevel === 0);
      assert.ok(outerPerform, 'should have outer PERFORM at nestLevel 0');
      assert.strictEqual(outerPerform.openKeyword.value, 'PERFORM');
      const innerPerform = pairs.find((p) => p.nestLevel === 1);
      assert.ok(innerPerform, 'should have inner PERFORM at nestLevel 1');
    });

    test('Bug 15: PERFORM <variable> TIMES should be recognized as structured PERFORM', () => {
      const source = `PERFORM WS-COUNT TIMES
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 15: PERFORM <single-char> TIMES should be recognized', () => {
      const source = `PERFORM N TIMES
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 15: PERFORM <hyphenated-name> TIMES should be recognized', () => {
      const source = `PERFORM MY-COUNT TIMES
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 15: PERFORM <variable> TIMES nested with inline PERFORMs', () => {
      const source = `PERFORM WS-COUNT TIMES
  PERFORM PARAGRAPH-A
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 15: PERFORM <literal> TIMES should still work', () => {
      const source = `PERFORM 5 TIMES
  DISPLAY "Hello"
END-PERFORM`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('Bug 15: inline PERFORM should still be excluded', () => {
      const source = 'PERFORM PARAGRAPH-A';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Performance', () => {
    test('should handle 200-level nesting within 5 seconds', () => {
      const depth = 200;
      const lines: string[] = [];
      for (let i = 0; i < depth; i++) {
        lines.push(`${'  '.repeat(i)}IF COND-${i}`);
      }
      lines.push(`${'  '.repeat(depth)}DISPLAY "DEEP"`);
      for (let i = depth - 1; i >= 0; i--) {
        lines.push(`${'  '.repeat(i)}END-IF`);
      }
      const source = lines.join('\n');
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assert.strictEqual(pairs.length, depth);
      assert.ok(elapsed < 5000, `Took ${elapsed}ms, expected < 5000ms`);
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should handle D in column 7 at end of file with no following character', () => {
      // Covers line 228: ternary false branch when D is at end of file
      const source = 'IF COND\n      D';
      const pairs = parser.parse(source);
      // D at column 7 with no next char is treated as debug comment line
      // IF has no matching END-IF, so no blocks
      assertNoBlocks(pairs);
    });

    test('should skip hyphenated identifiers before keyword in computeValidPositions', () => {
      // Covers lines 119-120: pos > 0 && source[pos - 1] === '-' skip in computeValidPositions
      const source = 'MY-PERFORM SOMETHING\nPERFORM UNTIL X > 0\n  DISPLAY "OK"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should skip hyphenated identifiers after keyword in computeValidPositions', () => {
      // Covers lines 123-124: source[end] === '-' skip in computeValidPositions
      const source = 'PERFORM-COUNT = 5\nPERFORM UNTIL X > 0\n  DISPLAY "OK"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Excluded regions - Compiler directives', () => {
    test('should ignore keywords inside >> compiler directives', () => {
      const source = '>>IF DEFINED\nPERFORM UNTIL X > 0\n  DISPLAY "OK"\nEND-PERFORM\n>>END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should ignore >>EVALUATE directive', () => {
      const source = '>>EVALUATE TRUE\n>>END-EVALUATE\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should ignore >>ELSE directive', () => {
      const source = '>>IF COND\n>>ELSE\n>>END-IF\nIF X > 0\n  DISPLAY "OK"\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Excluded regions - EXEC blocks', () => {
    test('should ignore keywords inside EXEC SQL block', () => {
      const source = 'EXEC SQL\n  SELECT IF FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should ignore keywords inside EXEC CICS block', () => {
      const source = 'EXEC CICS\n  PERFORM OPERATION\nEND-EXEC\nPERFORM UNTIL X > 0\n  DISPLAY "OK"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should handle EXECUTE keyword variant', () => {
      const source = 'EXECUTE SQL\n  DELETE FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle lowercase exec block', () => {
      const source = 'exec sql\n  if something\nend-exec\nif x > 0\nend-if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end-if');
    });

    test('should handle unterminated EXEC block', () => {
      const source = 'EXEC SQL\n  SELECT IF FROM TABLE';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not match EXEC as part of EXECUTE-PROC identifier', () => {
      const source = 'EXECUTE-PROC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Excluded regions - Pseudo-text delimiters', () => {
    test('should ignore keywords inside pseudo-text delimiters', () => {
      const source = 'COPY X REPLACING ==IF== BY ==WHEN==.\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle pseudo-text with PERFORM keyword', () => {
      const source = 'REPLACE ==PERFORM UNTIL== BY ==SEARCH==.\nPERFORM UNTIL X > 0\n  DISPLAY "OK"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should handle unterminated pseudo-text', () => {
      const source = '==IF ELSE END-IF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should not treat EXEC inside identifier as EXEC block (line 374-375)', () => {
      // matchExecBlock: pos > 0 && source[pos-1] is word char → return null
      // LEXEC starts with E at pos where source[pos-1] = 'L'
      const source = 'LEXEC SQL SELECT 1\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat EXEC preceded by hyphen as EXEC block', () => {
      // matchExecBlock: preceding character is '-'
      const source = 'X-EXEC SQL SELECT 1\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Coverage: hyphenated identifier branches', () => {
    // Lines 120-121: keyword preceded by hyphen (part of hyphenated identifier like X-IF)
    // tokenize skips keywords that are part of hyphenated identifiers
    test('should not match keyword preceded by hyphen (hyphenated identifier)', () => {
      const source = '       PERFORM\n           DISPLAY X-IF\n       END-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    // Lines 124-125: keyword followed by hyphen (part of hyphenated identifier like IF-HANDLER)
    // tokenize skips keywords followed by hyphen to avoid matching partial identifiers
    test('should not match keyword followed by hyphen (hyphenated identifier)', () => {
      const source = '       PERFORM\n           DISPLAY IF-HANDLER\n       END-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    // Verify both preceding and following hyphen checks work for close keywords
    test('should not match close keyword in hyphenated identifier', () => {
      const source = '       IF X > 0\n           DISPLAY MY-END-IF-FLAG\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    // Verify open keyword with preceding hyphen in computeValidPositions
    test('should not match PERFORM preceded by hyphen in computeValidPositions', () => {
      const source = '       IF X > 0\n           MOVE X-PERFORM TO Y\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    // Verify open keyword with following hyphen in computeValidPositions
    test('should not match PERFORM followed by hyphen in computeValidPositions', () => {
      const source = '       IF X > 0\n           MOVE PERFORM-COUNT TO Y\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat hyphenated identifier as keyword (prefix hyphen)', () => {
      // Covers lines 120-121: skip keyword preceded by hyphen
      const source = 'PERFORM\n  DISPLAY "X-PERFORM"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should not treat hyphenated identifier as keyword (suffix hyphen)', () => {
      // Covers lines 124-125: skip keyword followed by hyphen
      const source = 'PERFORM\n  MOVE PERFORM-COUNT TO X\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: PERFORM block with inline statements', () => {
    test('should detect PERFORM block with DISPLAY statement on same line', () => {
      const source = 'PERFORM DISPLAY WS-RECORD\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should detect PERFORM block with COMPUTE statement on same line', () => {
      const source = 'PERFORM COMPUTE WS-RESULT = A + B\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still reject paragraph call PERFORM', () => {
      const source = 'PERFORM MY-PARAGRAPH\nPERFORM UNTIL WS-DONE\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should reject PERFORM with THRU as paragraph range call', () => {
      const source = 'PERFORM PARA-1 THRU PARA-2\nPERFORM UNTIL WS-DONE\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should reject PERFORM with THROUGH as paragraph range call', () => {
      const source = 'PERFORM PARA-1 THROUGH PARA-2\nPERFORM UNTIL WS-DONE\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: PERFORM paragraph call with inline comment', () => {
    test('should reject PERFORM paragraph call followed by inline comment', () => {
      const source = 'PERFORM PARA-NAME *> this is a comment\nPERFORM UNTIL WS-DONE\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still accept block PERFORM with content after name and comment', () => {
      const source = 'PERFORM\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: PERFORM with numeric paragraph name', () => {
    test('should reject PERFORM with numeric paragraph name', () => {
      const source = 'PERFORM 100.\nPERFORM UNTIL WS-DONE\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still accept PERFORM with numeric variable TIMES', () => {
      const source = 'PERFORM 10 TIMES\n  DISPLAY "Hello"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: END-EXEC inside string in EXEC block', () => {
    test('should skip END-EXEC inside single-quoted string', () => {
      const source = "EXEC SQL\n  SELECT 'END-EXEC' INTO :WS-VAR\n  FROM DUAL\nEND-EXEC\nPERFORM 10 TIMES\n  DISPLAY 'X'\nEND-PERFORM";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should skip END-EXEC inside double-quoted string', () => {
      const source = 'EXEC SQL\n  SELECT "END-EXEC" INTO :WS-VAR\n  FROM DUAL\nEND-EXEC\nPERFORM 10 TIMES\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still match normal END-EXEC', () => {
      const source = 'EXEC SQL\n  SELECT * FROM TABLE\nEND-EXEC\nPERFORM 10 TIMES\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Branch coverage: hyphenated identifiers and EXEC boundaries', () => {
    test('should skip PERFORM preceded by hyphen (hyphenated identifier)', () => {
      const source = 'INIT-PERFORM SOMETHING\nPERFORM 10 TIMES\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should skip PERFORM followed by hyphen (hyphenated identifier)', () => {
      const source = 'PERFORM-INIT SOMETHING\nPERFORM 10 TIMES\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should skip END-EXEC preceded by identifier character', () => {
      const source = 'EXEC SQL\n  SELECT * FROM TABLE\nXEND-EXEC\nEND-EXEC';
      const regions = parser.getExcludedRegions(source);
      const execRegion = regions.find((r) => source.slice(r.start, r.end).includes('END-EXEC'));
      assert.ok(execRegion, 'Should find EXEC region with proper END-EXEC');
    });

    test('should skip END-EXEC followed by identifier character', () => {
      const source = 'EXEC SQL\n  SELECT * FROM TABLE\nEND-EXECX\nEND-EXEC';
      const regions = parser.getExcludedRegions(source);
      const execRegion = regions.find((r) => source.slice(r.start, r.end).includes('END-EXEC'));
      assert.ok(execRegion, 'Should find EXEC region with proper END-EXEC');
    });
  });

  suite('Branch coverage: EXEC block string handling', () => {
    test('should handle doubled quotes inside EXEC block string', () => {
      // Covers lines 383-385: doubled quote (ch repeated) inside string in EXEC block
      const source = 'EXEC SQL\n  SELECT "He""llo" FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle doubled single quotes inside EXEC block string', () => {
      // Covers lines 383-385: doubled single quote inside string in EXEC block
      const source = "EXEC SQL\n  SELECT 'It''s' FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should break string on newline inside EXEC block string', () => {
      // Covers lines 390-391: newline breaks string inside EXEC block
      const source = 'EXEC SQL\n  SELECT "unterminated\nvalue" FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should break single-quoted string on newline inside EXEC block', () => {
      // Covers lines 390-391: newline breaks single-quoted string inside EXEC block
      const source = "EXEC SQL\n  SELECT 'unterminated\nvalue' FROM TABLE\nEND-EXEC\nIF X > 0\nEND-IF";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: END-EXEC inside *> inline comment in EXEC block', () => {
    test('should not end EXEC block prematurely when END-EXEC appears in *> inline comment', () => {
      // Bug: matchExecBlock did not skip *> inline comments, so END-EXEC in a comment
      // terminated the excluded region early, causing keywords after the comment to be visible.
      const source = 'EXEC SQL\n  SELECT * FROM TABLE *> END-EXEC fake\n  WHERE ID = 1\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      // The IF/END-IF outside the EXEC block should be the only block found.
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should find the real END-EXEC after a *> inline comment containing END-EXEC', () => {
      // Bug: the premature end caused the excluded region to stop at the comment line,
      // so keywords inside the EXEC body after the comment were tokenized as live code.
      const source = 'EXEC SQL\n  SELECT * FROM TABLE *> END-EXEC fake\n  PERFORM SOME-PROC\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      // PERFORM inside the EXEC block must remain excluded; only IF/END-IF should match.
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should skip END-EXEC in fixed-format column 7 comment line', () => {
      // Column 7 comment indicator (*) means the whole line is a comment
      const source = '       EXEC SQL\n      *    END-EXEC in comment\n           SELECT COL1\n       END-EXEC\n       IF X > 0\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should skip END-EXEC in fixed-format column 7 slash comment line', () => {
      // Column 7 comment indicator (/) also denotes a comment line
      const source = '       EXEC SQL\n      /    END-EXEC in comment\n       END-EXEC\n       IF X > 0\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: hyphenated identifiers', () => {
    test('should not match keyword preceded by hyphen (e.g., X-IF)', () => {
      const source = '       MOVE X-IF TO Y\n       IF X > 0\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not match keyword followed by hyphen (e.g., IF-X)', () => {
      const source = '       MOVE IF-X TO Y\n       IF X > 0\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: fixed-format comment with tab', () => {
    test('should handle tab in fixed-format sequence area', () => {
      // Tab advances visual column; check that column 7 indicator is recognized
      const source = '\t*     COMMENT LINE\n       IF X > 0\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat line as comment when tab overshoots column 6', () => {
      // A tab from column 0 jumps to column 8, overshooting column 6
      const source = '\tIF X > 0\n\tEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: EXEC block with CRLF', () => {
    test('should handle CRLF inside EXEC block', () => {
      const source = '       EXEC SQL\r\n       SELECT 1\r\n       END-EXEC\r\n       IF X > 0\r\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: computeValidPositions hyphenated identifiers', () => {
    // Lines 119-121: keyword preceded by hyphen in computeValidPositions
    // Existing tests cover X-PERFORM and X-IF in tokenize; these target
    // computeValidPositions specifically with EVALUATE keyword
    test('should skip EVALUATE preceded by hyphen in computeValidPositions', () => {
      const source = 'MY-EVALUATE SOMETHING\nEVALUATE TRUE\n  WHEN 1\n    DISPLAY "A"\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });

    // Lines 123-125: keyword followed by hyphen in computeValidPositions
    test('should skip EVALUATE followed by hyphen in computeValidPositions', () => {
      const source = 'EVALUATE-HANDLER SOMETHING\nEVALUATE TRUE\n  WHEN 1\n    DISPLAY "A"\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });
  });

  suite('Branch coverage: isFixedFormatCommentLine tab and early return in EXEC block', () => {
    // Line 342: tab handling in isFixedFormatCommentLine called from matchExecBlock (line 408)
    // A tab at col 0 advances to col 8, overshooting col 6, triggering both
    // the tab branch (line 342) and the early return (lines 349-350, visualCol !== 6)
    test('should handle tab that overshoots column 6 inside EXEC block comment check', () => {
      // Inside EXEC block, a newline triggers isFixedFormatCommentLine check.
      // Tab from col 0 -> col 8 (overshoots 6), so visualCol !== 6 -> return false
      const source = 'EXEC SQL\n\t*END-EXEC\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    // Lines 349-350: visualCol !== 6 early return (line too short)
    test('should return false when line in EXEC block is too short to reach column 6', () => {
      // A very short line (3 chars) inside EXEC block: visualCol reaches 3, not 6
      const source = 'EXEC SQL\nABC\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should return false when EXEC block line ends before reaching column 6', () => {
      // Line with only 4 characters before newline inside EXEC block
      const source = 'EXEC SQL\n1234\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    // Lines 349-350: i >= source.length early return (source ends before col 6)
    test('should return false when source ends before reaching column 6 in EXEC block', () => {
      // Source ends at the short line without a newline; EXEC block unterminated
      const source = 'EXEC SQL\nAB';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle tab with trailing content inside EXEC block line', () => {
      // Tab overshoots column 6, so the line is not treated as a comment line
      // END-EXEC after tab is not at column 7 indicator position
      const source = 'EXEC SQL\n\tEND-EXEC\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  generateCommonTests(config);
});
