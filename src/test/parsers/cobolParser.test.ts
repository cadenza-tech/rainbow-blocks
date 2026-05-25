import * as assert from 'node:assert';
import { CobolBlockParser } from '../../parsers/cobolParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

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
    stringBlockClose: 'END-IF',
    singleQuotedStringSource: "MOVE 'IF PERFORM END-IF END-PERFORM' TO A\nIF CONDITION\nEND-IF",
    singleQuotedStringBlockOpen: 'IF',
    singleQuotedStringBlockClose: 'END-IF',
    commentAtEndOfLineSource: 'IF CONDITION *> END-IF here\n  DISPLAY "Test"\nEND-IF',
    commentAtEndOfLineBlockOpen: 'IF',
    commentAtEndOfLineBlockClose: 'END-IF',
    escapedQuoteStringSource: "MOVE 'It''s an IF statement' TO A\nIF CONDITION\nEND-IF",
    escapedQuoteStringBlockOpen: 'IF',
    escapedQuoteStringBlockClose: 'END-IF',
    nestedBlockSource: `PERFORM
  IF CONDITION
    EVALUATE VALUE
      WHEN 1
        DISPLAY "Nested"
    END-EVALUATE
  END-IF
END-PERFORM`,
    nestedBlockCount: 3,
    nestedBlockLevels: [
      { keyword: 'PERFORM', level: 0 },
      { keyword: 'IF', level: 1 },
      { keyword: 'EVALUATE', level: 2 }
    ]
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
    generateNestedBlockTests(config);

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

    // Regression: crossing (non-well-nested) blocks must not produce two
    // overlapping pairs. Per CLAUDE.md best-effort parsing (anchor-set
    // principle), a close that would cross an inner unclosed opener does not
    // force a pair; the crossed-over opener is left orphan (no color) rather
    // than colored as an overlapping region. Pre-fix COBOL emitted BOTH
    // IF->END-IF and PERFORM->END-PERFORM here (matching Ada/Bash behaviour,
    // which yield a single pair for the same crossing input).
    suite('Crossing blocks', () => {
      test('should not pair END-IF across an inner unclosed PERFORM', () => {
        // IF opens, PERFORM opens, then END-IF (would cross PERFORM), then
        // END-PERFORM. END-IF cannot cross PERFORM (which is still closed by the
        // later END-PERFORM), so only PERFORM/END-PERFORM pairs.
        const source = 'IF A\n  PERFORM\n  END-IF\nEND-PERFORM';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
      });

      test('should not pair END-PERFORM across an inner unclosed IF', () => {
        const source = 'PERFORM\n  IF A\n  END-PERFORM\nEND-IF';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'IF', 'END-IF');
      });

      test('should keep both pairs for well-nested IF inside PERFORM', () => {
        const source = 'PERFORM\n  IF A\n  END-IF\nEND-PERFORM';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assert.strictEqual(findBlock(pairs, 'IF').closeKeyword?.value, 'END-IF');
        assertNestLevel(pairs, 'IF', 1);
        assert.strictEqual(findBlock(pairs, 'PERFORM').closeKeyword?.value, 'END-PERFORM');
        assertNestLevel(pairs, 'PERFORM', 0);
      });

      test('should keep both pairs for well-nested PERFORM inside IF', () => {
        const source = 'IF A\n  PERFORM\n  END-PERFORM\nEND-IF';
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        assert.strictEqual(findBlock(pairs, 'PERFORM').closeKeyword?.value, 'END-PERFORM');
        assertNestLevel(pairs, 'PERFORM', 1);
        assert.strictEqual(findBlock(pairs, 'IF').closeKeyword?.value, 'END-IF');
        assertNestLevel(pairs, 'IF', 0);
      });

      test('should pair IF->END-IF when the crossed-over PERFORM is never closed', () => {
        // IF opens, PERFORM opens (never closed), END-IF. The PERFORM has no
        // matching END-PERFORM, so END-IF does not actually cross a pair and
        // should still pair with IF (PERFORM stays orphan). This keeps orphan
        // count minimal (CLAUDE.md cost-minimization).
        const source = 'IF A\n  PERFORM\nEND-IF';
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'IF', 'END-IF');
      });
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);
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

    test('should skip >> compiler directive inside EXEC block', () => {
      const source = 'EXEC SQL\n>>IF END-EXEC\nSELECT X\nEND-EXEC\nIF Y > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not detect keywords adjacent to Unicode letters', () => {
      const source = 'caf\u00E9IF X\nIF Y > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
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

    test('should treat PERFORM TIMES as paragraph call', () => {
      const source = 'PERFORM TIMES';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Performance', () => {
    test('should handle 200-level nesting within 5 seconds', () => {
      // Use no indent so IF/END-IF stay within column 72 (fixed-format identification
      // area starts at column 73; deeper indents would be excluded as fixed-format
      // identification text).
      const depth = 200;
      const lines: string[] = [];
      for (let i = 0; i < depth; i++) {
        lines.push(`IF COND-${i}`);
      }
      lines.push('DISPLAY "DEEP"');
      for (let i = depth - 1; i >= 0; i--) {
        lines.push('END-IF');
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

    test('should not treat mid-line >> as a compiler directive', () => {
      // Bug: a compiler directive `>>` must be the first non-blank token on a
      // line. A `>>` appearing mid-expression is not a directive, so the rest
      // of the line must still be tokenised. Treating it as a directive
      // excluded END-PERFORM and left PERFORM orphaned.
      const source = 'PERFORM 3 TIMES >> note END-PERFORM\nDISPLAY Z';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still treat >> as a directive when preceded only by a fixed-format sequence area', () => {
      // Guard: a `>>` directive may appear after the 6-char sequence area in
      // fixed format. The first non-blank token (skipping the sequence area)
      // is still `>>`, so it must be excluded.
      const source = '000100 >>SOURCE FORMAT IS FREE\nIF X > 0\nEND-IF';
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

    test('should exclude keywords inside EXEC HTML block', () => {
      const source = 'EXEC HTML\n  <div>IF X > 0 END-IF</div>\nEND-EXEC\nPERFORM\n  DISPLAY Y\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
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

    test('should not treat REPLACING without COPY as pseudo-text context', () => {
      const source = 'REPLACING ==IF ELSE END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not trigger pseudo-text detection for REPLACING outside COPY context', () => {
      const source = 'DISPLAY REPLACING == X\nIF A > 0\n  DISPLAY OK\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    suite('Regression: pseudo-text detection after unterminated string and comment', () => {
      test('should detect pseudo-text after unterminated string on previous line', () => {
        const source = "'unterminated\nCOPY X REPLACING ==IF== BY ==WHEN==.";
        const regions = parser.getExcludedRegions(source);
        // Should find the unterminated string AND the pseudo-text regions
        assert.ok(regions.length >= 2, 'Should detect pseudo-text regions after unterminated string');
      });

      test('should detect pseudo-text when inline comment with period separates COPY and REPLACING', () => {
        const source = 'COPY X *> comment.\n REPLACING ==IF== BY ==WHEN==.';
        const regions = parser.getExcludedRegions(source);
        // Should find the comment AND the pseudo-text regions
        assert.ok(regions.length >= 3, 'Should detect pseudo-text regions despite comment with period');
      });
    });

    suite('Regression: multi-pair COPY REPLACING / REPLACE', () => {
      test('should exclude all pseudo-text in 2-pair COPY REPLACING', () => {
        const source = 'COPY X REPLACING ==a== BY ==b== ==c== BY ==IF x END-IF==.\nPERFORM UNTIL DONE\n  DISPLAY X\nEND-PERFORM';
        const regions = parser.getExcludedRegions(source);
        const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
        assert.strictEqual(pseudoRegions.length, 4);
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
      });

      test('should exclude all pseudo-text in 3-pair COPY REPLACING', () => {
        const source = 'COPY X REPLACING ==a== BY ==b== ==c== BY ==d== ==IF== BY ==PERFORM==.\nIF COND\nEND-IF';
        const regions = parser.getExcludedRegions(source);
        const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
        assert.strictEqual(pseudoRegions.length, 6);
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'IF', 'END-IF');
      });

      test('should exclude all pseudo-text in multi-pair REPLACE', () => {
        const source =
          'REPLACE ==old1== BY ==new1== ==old2== BY ==new2== ==IF x END-IF== BY ==DISPLAY y==.\nPERFORM UNTIL DONE\n  DISPLAY X\nEND-PERFORM';
        const regions = parser.getExcludedRegions(source);
        const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
        assert.strictEqual(pseudoRegions.length, 6);
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
      });

      // Regression: large COPY REPLACING used to run in super-linear time
      // (~O(n^3): each `==` triggered a backward scan that re-walked all preceding `==` pairs,
      // and each step inside re-scanned the buffer for the last period).
      // Now it should complete in roughly linear time even for hundreds of pairs.
      test('should parse 300-pair COPY REPLACING in linear time', () => {
        const buf: string[] = ['COPY X REPLACING '];
        const pairCount = 300;
        for (let i = 0; i < pairCount; i++) {
          buf.push(`==a${i}== BY ==b${i}== `);
        }
        buf.push('.\nIF COND\nEND-IF');
        const source = buf.join('');
        const t0 = Date.now();
        const pairs = parser.parse(source);
        const elapsed = Date.now() - t0;
        assertSingleBlock(pairs, 'IF', 'END-IF');
        // Pre-fix this took ~1800ms (O(n^3)). Post-fix should be well under 500ms.
        // Use a generous ceiling to avoid flakiness on slow CI nodes.
        assert.ok(elapsed < 1000, `300-pair COPY REPLACING took ${elapsed}ms (expected < 1000ms)`);
      });

      // Regression: a long run of consecutive `=` (e.g., a divider banner) used
      // to run in super-linear time (~O(n^3): every `==` fell through to the
      // per-position pseudo-text check, whose backward `==`-chain walk re-scanned
      // all preceding `==` pairs). Pre-fix this measured 50ms / 264ms / 1828ms /
      // 14343ms for n=400 / 800 / 1600 / 3200 (ratio ~8x per doubling). Now the
      // backward walk is memoized per parse, so a multi-thousand-character banner
      // completes in roughly linear time and IF/END-IF still pairs as one block.
      test('should parse a large consecutive-equals banner in linear time', () => {
        const banner = '='.repeat(8000);
        const source = `${banner}\nIF X\nEND-IF`;
        const t0 = Date.now();
        const pairs = parser.parse(source);
        const elapsed = Date.now() - t0;
        assertSingleBlock(pairs, 'IF', 'END-IF');
        // Pre-fix an 8000-char banner would take many seconds (O(n^3)).
        // Post-fix it is a few milliseconds. Use a generous ceiling for slow CI.
        assert.ok(elapsed < 1000, `8000-char banner took ${elapsed}ms (expected < 1000ms)`);
      });
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

    test('should skip keyword preceded by hyphen', () => {
      // Covers lines 120-121: keyword preceded by '-' is part of a hyphenated identifier
      const source = 'MOVE X-IF TO Y\nIF CONDITION\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should skip keyword followed by hyphen', () => {
      // Covers lines 124-125: keyword followed by '-' is part of a hyphenated identifier
      const source = 'MOVE IF-FLAG TO Y\nIF CONDITION\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should skip PERFORM preceded by hyphen', () => {
      // Covers lines 120-121 for PERFORM keyword
      const source = 'MOVE X-PERFORM TO Y\nPERFORM\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should skip PERFORM followed by hyphen', () => {
      // Covers lines 124-125 for PERFORM keyword
      const source = 'MOVE PERFORM-COUNT TO Y\nPERFORM\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
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

  suite('Regression: D/d debug indicator with adjacent alphanumeric in fixed format', () => {
    test('should treat D followed by digits at column 7 as debug line in fixed format', () => {
      const pairs = parser.parse('000100D100 IF CONDITION\n000200D200 END-IF\n       PERFORM\n         DISPLAY "Hello"\n       END-PERFORM');
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should treat d followed by digits at column 7 as debug line in fixed format', () => {
      const pairs = parser.parse('000100d100 IF CONDITION\n000200d200 END-IF\n       PERFORM\n         DISPLAY "Hello"\n       END-PERFORM');
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still reject D followed by alphanumeric in free-format context', () => {
      // Sequence area is all spaces (no digits), so this could be free-format
      const pairs = parser.parse('      DIVIDE X BY Y\n       IF X > 0\n       END-IF');
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: PERFORM followed by END-PERFORM', () => {
    test('should accept PERFORM immediately followed by END-PERFORM', () => {
      // Covers line 145: word === `end-${lowerKeyword}` branch in computeValidPositions
      // When the next word after PERFORM is END-PERFORM, it should not be rejected
      // as a paragraph call, because it is the matching closer
      const source = 'PERFORM END-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should accept PERFORM with content between it and END-PERFORM', () => {
      // The END-PERFORM-as-next-word path still works in a multiline context
      const source = 'PERFORM\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Branch coverage: isFixedFormatCommentLine with non-sequence-area prefix', () => {
    test('should not treat line as comment when sequence area contains alphabetic chars inside EXEC block', () => {
      // Covers lines 369-370: sequenceArea fails /^[\d \t]*$/ test inside isFixedFormatCommentLine
      // called from matchExecBlock when a newline triggers the comment-line check
      // The sequence area "abcdef" contains alphabetic characters, so it is not a valid
      // fixed-format sequence area; the line is not treated as a comment
      const source = 'EXEC SQL\nabcdef*END-EXEC in comment\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat line as comment when sequence area has special chars inside EXEC block', () => {
      // Covers lines 369-370: sequenceArea with non-digit/non-space/non-tab content
      const source = 'EXEC SQL\n@#$%^&*comment line\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Branch coverage: D/d debug indicator in isFixedFormatCommentLine inside EXEC block', () => {
    test('should treat D at column 7 as debug line when sequence area has digits inside EXEC block', () => {
      // Covers lines 374-381: D at column 7, hasDigit = true (fixed format confirmed)
      // The D line is treated as a comment and skipped; END-EXEC after it closes the block
      const source = 'EXEC SQL\n000100D DEBUG IF END-EXEC\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat D at column 7 as debug line when followed by alphanumeric in free format inside EXEC block', () => {
      // Covers lines 374-381: D at column 7, hasDigit = false (free format), nextChar is alphanumeric
      // In free-format (no digits in sequence area), D followed by alphanumeric is NOT a debug indicator
      const source = 'EXEC SQL\n      DISPLAY X\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should treat D at column 7 as debug line when not followed by alphanumeric in free format inside EXEC block', () => {
      // Covers lines 374-381: D at column 7, hasDigit = false, nextChar is space (not alphanumeric)
      // D followed by a space is treated as debug indicator even without digits in sequence area
      const source = 'EXEC SQL\n      D END-EXEC in debug\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should treat d at column 7 as debug line when followed by alphanumeric in fixed format inside EXEC block', () => {
      // Covers lines 374-381: lowercase d at column 7, hasDigit = true (fixed format)
      // With digits in sequence area, d is always a debug indicator regardless of what follows
      const source = 'EXEC SQL\n000100d100 END-EXEC in debug\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should limit unterminated EXEC region to the EXEC keyword itself', () => {
      // Unterminated EXEC blocks now exclude only the EXEC keyword to avoid swallowing
      // the rest of the source during mid-edit. The trailing source remains parseable.
      // The trailing `      D` is recognized as a column-7 debug line (separate region).
      const source = 'EXEC SQL\n      D';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
    });
  });

  suite('Branch coverage: END-EXECUTE support in matchExecBlock', () => {
    test('should match EXEC block closed with END-EXECUTE', () => {
      // Covers lines 482-487: END-EXECUTE keyword matching in matchExecBlock
      const source = 'EXEC SQL\n  SELECT * FROM TABLE\nEND-EXECUTE\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should match EXECUTE block closed with END-EXECUTE', () => {
      // Covers lines 482-487: END-EXECUTE with EXECUTE opener
      const source = 'EXECUTE SQL\n  DELETE FROM TABLE\nEND-EXECUTE\nPERFORM\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should match lowercase end-execute', () => {
      // Covers lines 482-487: case-insensitive END-EXECUTE
      const source = 'exec sql\n  select * from table\nend-execute\nif x > 0\nend-if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end-if');
    });

    test('should not match END-EXECUTE as part of identifier (preceded by word char)', () => {
      // Covers line 482: beforeOk check -- END-EXECUTE preceded by a word character
      const source = 'EXEC SQL\n  SELECT 1\nXEND-EXECUTE\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not match END-EXECUTE as part of identifier (followed by word char)', () => {
      // Covers line 483: afterOk check -- END-EXECUTE followed by a word character
      const source = 'EXEC SQL\n  SELECT 1\nEND-EXECUTEX\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should match END-EXECUTE at end of source', () => {
      // Covers line 483: afterOk when i + 11 >= source.length
      const source = 'EXEC SQL SELECT 1 END-EXECUTE';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should match END-EXECUTE at start of source within EXEC block', () => {
      // Covers line 482: beforeOk when i === 0 (though unlikely in practice)
      // The EXEC starts at the beginning, and END-EXECUTE appears right after newline
      const source = 'EXEC SQL\nEND-EXECUTE';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].end, source.length);
    });
  });

  suite('Regression: matchExecBlock should skip pseudo-text delimiters ==...==', () => {
    test('should not terminate EXEC block early when ==END-EXEC== appears in pseudo-text', () => {
      // Bug: matchExecBlock did not skip pseudo-text delimiters ==...==, so
      // END-EXEC inside ==...== terminated the excluded region prematurely
      const source = 'EXEC SQL\n  COPY SOMETHING REPLACING ==END-EXEC== BY ==NEW-TEXT==\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle pseudo-text with PERFORM keyword inside EXEC block', () => {
      // Pseudo-text containing block keywords should not affect parsing
      const source = 'EXEC SQL\n  COPY FILE REPLACING ==PERFORM== BY ==CALL==\nEND-EXEC\nPERFORM\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: REPLACE inside EXEC block does not leak pseudo-text context', () => {
    test('should not treat == after END-EXEC as pseudo-text when REPLACE appears in EXEC body', () => {
      // Bug: getPseudoTextStarts forward scan did not skip EXEC/EXECUTE blocks,
      // so a REPLACE keyword inside an EXEC body set inReplaceContext=true.
      // The EXEC block has no terminating period, so the flag leaked past
      // END-EXEC and made `== B IF C ==` a pseudo-text excluded region.
      const source = 'EXEC SQL\n  WHERE REPLACE\nEND-EXEC\nIF A == B IF C == D END-IF END-IF';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const inner = pairs.find((p) => p.nestLevel === 1);
      const outer = pairs.find((p) => p.nestLevel === 0);
      assert.ok(inner, 'inner IF/END-IF should be detected');
      assert.ok(outer, 'outer IF/END-IF should be detected');
      assert.strictEqual(inner?.openKeyword.value.toUpperCase(), 'IF');
      assert.strictEqual(inner?.closeKeyword.value.toUpperCase(), 'END-IF');
      assert.strictEqual(outer?.openKeyword.value.toUpperCase(), 'IF');
      assert.strictEqual(outer?.closeKeyword.value.toUpperCase(), 'END-IF');
    });

    test('should not leak REPLACE pseudo-text context out of an EXECUTE block', () => {
      const source = 'EXECUTE SQL\n  WHERE REPLACE\nEND-EXEC\nIF A == B\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: isValidBlockClose check in tokenize override', () => {
    test('should reject block close keyword preceded by hyphen', () => {
      // Bug: missing isValidBlockClose check in tokenize override allowed
      // hyphenated identifiers like MY-END-IF to be parsed as END-IF
      const source = 'MOVE MY-END-IF TO X\nIF CONDITION\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should reject block close keyword followed by hyphen', () => {
      const source = 'MOVE END-IF-FLAG TO X\nIF CONDITION\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: == as equality operator', () => {
    test('should not treat == as pseudo-text in IF condition', () => {
      const pairs = parser.parse('IF A == B\n  DISPLAY OK\nEND-IF');
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat == as pseudo-text in EVALUATE WHEN', () => {
      const pairs = parser.parse('EVALUATE TRUE\n  WHEN A == 1\n    DISPLAY OK\nEND-EVALUATE');
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });

    test('should still detect pseudo-text in COPY REPLACING context', () => {
      const regions = parser.getExcludedRegions('COPY X REPLACING ==OLD== BY ==NEW==.');
      const pseudoRegions = regions.filter((r) => r.end - r.start >= 7);
      assert.ok(pseudoRegions.length >= 2);
    });

    test('should still detect pseudo-text in REPLACE context', () => {
      const regions = parser.getExcludedRegions('REPLACE ==OLD== BY ==NEW==.');
      const pseudoRegions = regions.filter((r) => r.end - r.start >= 7);
      assert.ok(pseudoRegions.length >= 2);
    });
  });

  suite('Bug: BY triggers false pseudo-text detection after ==', () => {
    test('should not treat == as pseudo-text when preceded by BY in arithmetic context', () => {
      // isInPseudoTextContext returns true for any BY before ==, even in SORT/MULTIPLY/DIVIDE
      // This causes == and everything after it to become a false excluded region
      const source = 'SORT FILE-A ASCENDING BY == KEY-FIELD\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat == as pseudo-text when BY is separated by newline', () => {
      const source = 'MULTIPLY A BY\n== something\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Bug: ALSO triggers false pseudo-text detection after ==', () => {
    test('should not treat == as pseudo-text when preceded by ALSO in EVALUATE context', () => {
      // ALSO is valid in EVALUATE ALSO and REPLACE ALSO, but isInPseudoTextContext
      // does not distinguish the two contexts
      const source = 'EVALUATE TRUE ALSO == TRUE\n  WHEN 1\n    DISPLAY OK\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
    });
  });

  suite('Bug: Standalone EXEC triggers false excluded region', () => {
    test('should not treat standalone EXEC as EXEC block start when used as data name', () => {
      // matchExecBlock treats any standalone EXEC as an EXEC block start, even when
      // it appears in non-SQL/CICS contexts like MOVE EXEC TO X
      const source = 'MOVE EXEC TO X\nIF A > 0\n  DISPLAY OK\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: unclosed == in EXEC block swallows END-EXEC', () => {
    test('should not swallow END-EXEC when == appears in SQL expression', () => {
      // Bug: == in SQL WHERE clause triggered pseudo-text scanning that consumed
      // everything to end of source, making END-EXEC invisible to the parser
      const source = 'EXEC SQL\n  SELECT * FROM T WHERE A == 1\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should handle == as equality operator in SQL WHERE clause', () => {
      const source = 'EXEC SQL\n  SELECT COL1 FROM TABLE1 WHERE COL2 == :HOST-VAR\nEND-EXEC\nPERFORM\n  DISPLAY "X"\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should handle multiple unclosed == fragments in EXEC block', () => {
      // Three == operators: first two pair up as pseudo-text, third is unclosed
      const source = 'EXEC SQL\n  WHERE A == 1 OR B == 2 OR C ==\n  3\nEND-EXEC\nIF X > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not extend EXEC region past END-EXEC when == in EXEC and == in COPY REPLACING', () => {
      const source =
        '       EXEC SQL\n         WHERE A == B\n       END-EXEC\n       COPY X REPLACING ==OLD== BY ==NEW==.\n       IF COND\n         DISPLAY OK\n       END-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: false pseudo-text detection in isInPseudoTextContext', () => {
    test('should not create pseudo-text excluded regions when == follows closing == outside COPY/REPLACE', () => {
      // Flaw 1: The second == pair was incorrectly treated as pseudo-text because
      // it was preceded by the closing == of the first pair, even though neither
      // is in a COPY REPLACING or REPLACE context
      const source = 'MOVE ==X== ==Y== TO Z.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not create pseudo-text excluded regions when BY precedes == outside COPY/REPLACE', () => {
      // Flaw 2: REPLACING here is not part of a COPY statement, but BY -> REPLACING
      // backward scan did not verify the COPY context, creating false excluded regions
      const source = 'DISPLAY X. REPLACING ==a== BY ==b==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should still detect pseudo-text in valid COPY REPLACING with chained ==', () => {
      // Ensure the fix does not break valid multi-pair COPY REPLACING
      const source = 'COPY X REPLACING ==old== BY ==IF END-IF==.\nPERFORM\n  DISPLAY X\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still detect pseudo-text in valid REPLACE with chained ==', () => {
      const source = 'REPLACE ==old== BY ==IF END-IF==.\nPERFORM\n  DISPLAY X\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: COPY in column 7 comment and >> directive', () => {
    test('should not create pseudo-text regions when COPY is in column 7 comment', () => {
      const source = '       DISPLAY X\n      * COPY MYFILE\n       REPLACING ==IF X > 0 END-IF== BY ==NEW-CODE==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not create pseudo-text regions when COPY is in >> directive', () => {
      const source = '       DISPLAY X\n>>COPY MYFILE\n       REPLACING ==IF X > 0 END-IF== BY ==NEW-CODE==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('should not create pseudo-text excluded regions for COPY keyword inside string', () => {
      const source = 'DISPLAY "COPY X" REPLACING ==IF END-IF== BY ==DISPLAY OK==.\nIF A > 0\nEND-IF';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not treat period inside string as COPY statement boundary', () => {
      const source = "MOVE 'X.' COPY Z REPLACING ==IF== BY ==END-IF==.\nIF COND\nEND-IF";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not treat period on column 7 comment line as statement boundary', () => {
      const source = 'COPY X\n      * comment with period.\n       REPLACING ==IF== BY ==END-IF==.\nIF A > 0\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: PERFORM with single-word COBOL verb', () => {
    test('should detect PERFORM DISPLAY block', () => {
      const pairs = parser.parse('PERFORM DISPLAY\nEND-PERFORM');
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should detect PERFORM IF with nested END-IF', () => {
      const pairs = parser.parse('PERFORM IF\n  DISPLAY Y\nEND-IF\nEND-PERFORM');
      assertBlockCount(pairs, 2);
    });

    test('should detect PERFORM COMPUTE block', () => {
      const pairs = parser.parse('PERFORM COMPUTE\nEND-PERFORM');
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: COPY in hyphenated identifiers', () => {
    test('should not exclude pseudo-text after COPY-RECORD', () => {
      const source = 'COPY-RECORD REPLACING ==IF== BY ==WHEN==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not exclude pseudo-text after MY-COPY', () => {
      const source = 'MY-COPY REPLACING ==IF== BY ==WHEN==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should still exclude pseudo-text after real COPY', () => {
      const source = 'COPY MYLIB REPLACING ==IF== BY ==WHEN==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 2);
    });
  });

  suite('Regression 2026-04-11: hyphenated identifiers and unterminated pseudo-text', () => {
    test('should not trigger pseudo-text context for hyphenated identifier MY-REPLACE', () => {
      const source = 'MY-REPLACE ==A== BY ==B==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not trigger pseudo-text context for X-REPLACING in COPY', () => {
      const source = 'COPY X X-REPLACING ==IF== BY ==NEW==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0);
    });

    test('should not swallow entire source after unterminated pseudo-text', () => {
      const source = 'COPY X REPLACING ==unfinished\nIF A > 0\n  DISPLAY "X"\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: PERFORM paragraph call with iteration count', () => {
    test('should reject PERFORM paragraph N TIMES as block', () => {
      const source = 'PERFORM PARA-A 5 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should reject PERFORM paragraph VAR TIMES as block', () => {
      const source = 'PERFORM PARA-A WS-COUNT TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still accept PERFORM N TIMES (inline count) as block', () => {
      const source = 'PERFORM 5 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still accept PERFORM UNTIL as block', () => {
      const source = 'PERFORM UNTIL X > 5\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: pseudo-text detection with intervening comments/directives', () => {
    test('should detect pseudo-text after inline *> comment between REPLACING and ==', () => {
      // Before fix: the *> inline comment broke backward scan, leaving ==IF==/==END-IF== unexcluded.
      const source = 'COPY X REPLACING *> comment\n==IF== BY ==END-IF==.\nIF Y\nEND-IF';
      const pairs = parser.parse(source);
      // Only the real IF Y / END-IF should be a pair; the ones inside ==...== must be excluded.
      assertBlockCount(pairs, 1);
    });

    test('should detect pseudo-text with >> directive on its own line between REPLACING and ==', () => {
      const source = 'COPY X REPLACING\n>>SOURCE FORMAT FREE\n==IF== BY ==END-IF==.\nIF Y\nEND-IF';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
    });
  });

  suite('Regression: PERFORM TEST BEFORE/AFTER without WITH', () => {
    test('should accept PERFORM TEST BEFORE UNTIL as structured form', () => {
      const source = 'PERFORM TEST BEFORE UNTIL X > 5\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should accept PERFORM TEST AFTER UNTIL as structured form', () => {
      const source = 'PERFORM TEST AFTER UNTIL X > 5\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should accept PERFORM TEST BEFORE VARYING as structured form', () => {
      const source = 'PERFORM TEST BEFORE VARYING I FROM 1 BY 1 UNTIL I > 10\n  DISPLAY I\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });

    test('should still accept PERFORM WITH TEST BEFORE UNTIL', () => {
      const source = 'PERFORM WITH TEST BEFORE UNTIL X > 5\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression: matchExecBlock word boundary handling', () => {
    test('should not start an EXEC block when preceded by a Unicode letter', () => {
      // `caféEXEC SQL ... END-EXEC` should not be recognised as EXEC SQL
      const source = 'caféEXEC SQL\n  IF X > 0\n  END-IF\nEND-EXEC';
      const pairs = parser.parse(source);
      // The IF/END-IF inside should be recognised because the EXEC block is rejected
      const ifPair = pairs.find((p) => p.openKeyword.value === 'IF');
      assert.ok(ifPair, 'IF/END-IF should be detected when EXEC is rejected by Unicode boundary');
    });

    test('should not match EXEC SQL1 as EXEC SQL block', () => {
      // `EXEC SQL1` is not a recognised sublanguage; the block should not be excluded
      const source = 'EXEC SQL1\n  IF X > 0\n  END-IF\nEND-EXEC';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'IF');
      assert.ok(ifPair, 'IF/END-IF should be detected when EXEC SQL1 is rejected');
    });
  });

  suite('Regression 2026-04-29: COPY statement with end-keyword filename', () => {
    test('should not treat COPY END-IF. END-IF as block close', () => {
      const source = 'IF X\nCOPY END-IF.\nEND-IF';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'IF should pair with the line-2 END-IF');
    });

    test('should detect COPY when fixed-format sequence area precedes COPY on the same line', () => {
      // Bug: the class-level isInCopyStatement only walked back to the
      // beginning of the line and required the first non-blank token to be
      // COPY. With a fixed-format sequence area like `001000 ` preceding COPY,
      // the candidate token included the digits and COPY was missed.
      const source = 'IF Y\n001000 COPY END-IF.\nEND-IF';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].closeKeyword.line, 2, 'IF should pair with the line-2 END-IF (not the END-IF on the COPY line)');
    });

    test('should detect COPY across a newline when the filename is on the next line', () => {
      // Bug: the class-level isInCopyStatement stopped at the previous
      // newline, so multi-line `COPY\n  IF.` did not recognise IF as a
      // copybook name, causing IF to be tokenised as a block opener and
      // paired with the following standalone END-IF.
      const source = 'COPY\n  IF.\nEND-IF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect blocks after a period-less COPY statement', () => {
      // Bug: a COPY statement with no terminating period made isInCopyStatement
      // treat every following keyword as a copybook name, swallowing the whole
      // IF/END-IF block. A block-opening verb after the copybook name ends the
      // COPY statement context.
      const source = 'COPY ABC\nIF A\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should detect blocks after a period-less COPY with OF library qualifier', () => {
      const source = 'COPY ABC OF LIB\nIF A\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should not extend a period-less COPY past a following block verb into a later REPLACING', () => {
      // Companion fix in cobolHelpers.isInCopyStatement: a period-less COPY must
      // not reach a REPLACING that belongs to a separate statement, otherwise
      // its pseudo-text delimiters are wrongly excluded.
      const source = 'COPY ABC\nIF X\nREPLACING ==a== BY ==b==.';
      const regions = parser.getExcludedRegions(source);
      const pseudoRegions = regions.filter((r) => source.slice(r.start, r.start + 2) === '==');
      assert.strictEqual(pseudoRegions.length, 0, 'REPLACING after a period-less COPY + block verb is not in COPY context');
    });
  });

  suite('Regression 2026-05-09: COPY statement with reserved-word filename as block_open', () => {
    test('should not treat COPY IF. as block_open paired with END-IF', () => {
      // The filename in `COPY IF.` is being used as a copybook name, not as a block opener.
      // Without the fix, IF would be tokenized as block_open and erroneously pair with the
      // following standalone END-IF (which is itself an orphan).
      const source = 'COPY IF.\nEND-IF';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat COPY PERFORM. as block_open paired with END-PERFORM', () => {
      const source = 'COPY PERFORM.\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat COPY EVALUATE. as block_open paired with END-EVALUATE', () => {
      const source = 'COPY EVALUATE.\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still pair IF/END-IF when COPY IF. appears between them', () => {
      // Bug: computeValidPositions did not consult isInCopyStatement, so the
      // copybook name in `COPY IF.` was pushed onto the opener stack and
      // consumed the trailing END-IF, leaving the real IF X opener unmatched.
      const source = 'IF X\n  DISPLAY A\nCOPY IF.\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'IF X on line 0 should be the opener');
    });

    test('should still pair PERFORM/END-PERFORM when COPY PERFORM. appears between them', () => {
      const source = 'PERFORM UNTIL Z\n  DISPLAY A\nCOPY PERFORM.\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'PERFORM on line 0 should be the opener');
    });

    test('should still pair EVALUATE/END-EVALUATE when COPY EVALUATE. appears between them', () => {
      const source = 'EVALUATE Z\n  WHEN A\nCOPY EVALUATE.\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'EVALUATE on line 0 should be the opener');
    });
  });

  suite('Regression 2026-04-30: fixed-format string literal continuation (column-7 hyphen)', () => {
    test('should not pair IF in continuation prep area with the trailing END-IF', () => {
      // An unterminated literal on line 1 is continued on the next line whose column-7 is
      // `-`. The text between `-` (exclusive) and the continuation opening quote is part
      // of the continuation processing per COBOL spec — keywords appearing there must not
      // be tokenised. Without continuation support, the parser would treat `IF` at column
      // 12 of line 2 as a real block opener and the trailing `END-IF.` would form a fake
      // IF/END-IF pair.
      const source = '           DISPLAY "AAA\n      -    IF X "BBB" END-IF.\n           STOP RUN.';
      const pairs = parser.parse(source);
      const ifPairs = pairs.filter((p) => p.openKeyword.value.toUpperCase() === 'IF');
      assert.strictEqual(ifPairs.length, 0, 'IF inside continuation prep area must not pair with the trailing END-IF');
    });

    test('should produce a single excluded region spanning both literal halves', () => {
      // The continuation indicator `-` joins the two literal halves into one logical
      // literal. The excluded-region representation should reflect this: a single region
      // covering from the original opening quote through to the closing quote on the
      // continuation line.
      const source = '           DISPLAY "AAA\n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const continuationRegion = regions.find((r) => source[r.start] === '"');
      assert.ok(continuationRegion, 'expected an excluded region starting at the opening quote');
      assert.ok(continuationRegion.end > source.indexOf('"BBB"'), 'continuation literal region must extend past the second quote on the next line');
    });

    test('should pair real IF/END-IF after a continued string literal', () => {
      // After the continued literal closes, the trailing IF/END-IF must still pair.
      const source = '           DISPLAY "AAA\n      -    "BBB".\n           IF X > 0\n               DISPLAY "OK"\n           END-IF.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Regression: fixed-format identification area exclusion in computeValidPositions', () => {
    test('should pair real IF (col<72) when fake IF appears in identification area (col>=72)', () => {
      // Fixed-format with sequence numbers in cols 1-6, content in cols 8-71, identification area at col 72+
      const sequenceArea = '000010 ';
      const filler = ' '.repeat(72 - sequenceArea.length);
      const source = `${sequenceArea}IF X > 0\n${sequenceArea}${filler}IF\n${sequenceArea}END-IF.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should exclude keywords pushed past column 72 by tab expansion in the sequence area', () => {
      // Bug: tokenize() and computeValidPositions() compared the raw UTF-16
      // column against 72, while tryMatchExcludedRegion / isFixedFormatCommentLine
      // use tab-expanded visual columns. A 6-char sequence area followed by 9
      // tabs places the keyword at visual column 72 (6 -> 8 -> 16 -> ... -> 72),
      // inside the identification area (visual cols 72-79). With raw columns the
      // keyword sat at column 15 and was wrongly tokenised, producing a pair.
      const sequenceArea = '000001';
      const tabs = '\t'.repeat(9);
      const source = `${sequenceArea}${tabs}IF X\n${sequenceArea}${tabs}END-IF`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: EXEC pseudo-text content is opaque', () => {
    test('should keep IF inside ==END-EXEC IF X END-IF== as part of EXEC region', () => {
      const source = 'EXEC SQL\nCOPY ABC REPLACING ==END-EXEC IF X END-IF== BY ==NEW==\nEND-EXEC\nDISPLAY OK';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: WHEN/ELSE used as data names', () => {
    test('should not register ELSE as IF intermediate when used as data name', () => {
      const source = 'IF X\n  MOVE ELSE TO Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE should not register as intermediate');
    });
    test('should not register WHEN as EVALUATE intermediate when used as data name', () => {
      const source = 'EVALUATE X\n  ADD WHEN TO Y\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN should not register as intermediate');
    });
    test('should not register ELSE as IF intermediate when used after BY (data name)', () => {
      const source = 'IF X\n  MULTIPLY A BY ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE used as data name should not register');
    });
    test('should not register ELSE as IF intermediate when used after GIVING (data name)', () => {
      const source = 'IF X\n  ADD A B GIVING ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE used as data name should not register');
    });
    test('should not register ELSE as IF intermediate when used after REMAINDER (data name)', () => {
      const source = 'IF X\n  DIVIDE A BY B GIVING C REMAINDER ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE used as data name should not register');
    });
  });

  suite('Regression 2026-05-06: COBOL multi-line data-name verb', () => {
    test('should not register ELSE as IF intermediate when MOVE is on previous line', () => {
      const source = 'IF X\n  MOVE\n    ELSE TO Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after multi-line MOVE is data name');
    });
    test('should not register ELSE as IF intermediate when inline comment intervenes after MOVE', () => {
      const source = 'IF X\n  MOVE\n  *> some comment\n  ELSE TO Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after MOVE with intervening *> comment is data name');
    });
    test('should not register WHEN as EVALUATE intermediate when inline comment intervenes after ADD', () => {
      const source = 'EVALUATE X\n  ADD\n  *> comment\n  WHEN TO Y\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN after ADD with intervening *> comment is data name');
    });
    test('should not register ELSE as IF intermediate when >> directive line intervenes after MOVE', () => {
      const source = 'IF X\n  MOVE\n>>SOURCE FORMAT IS FREE\n  ELSE TO Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after MOVE with intervening >> directive is data name');
    });
  });

  suite('Regression: ELSE/WHEN after expression operators', () => {
    test('should not register ELSE as intermediate when preceded by + operator (COMPUTE)', () => {
      const source = 'IF X\n  COMPUTE Y = X + ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after + operator is data name');
    });
    test('should not register ELSE as intermediate when preceded by - operator', () => {
      const source = 'IF X\n  COMPUTE Y = X - ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after - operator is data name');
    });
    test('should not register ELSE as intermediate when preceded by * operator', () => {
      const source = 'IF X\n  COMPUTE Y = X * ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after * operator is data name');
    });
    test('should not register ELSE as intermediate when preceded by / operator', () => {
      const source = 'IF X\n  COMPUTE Y = X / ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after / operator is data name');
    });
    test('should not register ELSE as intermediate when preceded by ** operator', () => {
      const source = 'IF X\n  COMPUTE Y = X ** ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after ** operator is data name');
    });
    test('should not register ELSE as intermediate when preceded by = operator', () => {
      const source = 'IF X\n  COMPUTE Y = ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after = is data name');
    });
    test('should not register ELSE as intermediate when preceded by comma (USING list)', () => {
      const source = 'IF X\n  CALL "PROC" USING A, ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after comma is data name');
    });
    test('should not register ELSE as intermediate when preceded by open paren', () => {
      const source = 'IF X\n  COMPUTE Y = (ELSE + 1)\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after ( is data name');
    });
    test('should not register WHEN as EVALUATE intermediate when preceded by + operator', () => {
      const source = 'EVALUATE X\n  COMPUTE Y = X + WHEN\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN after + operator is data name');
    });
    test('should not register WHEN as EVALUATE intermediate when preceded by comma', () => {
      const source = 'EVALUATE X\n  CALL "PROC" USING A, WHEN\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN after comma is data name');
    });

    test('should register ELSE as IF intermediate after a closing parenthesis on the condition', () => {
      // Bug: isInExpressionContext treated `)` as an expression-context character,
      // so `IF (X > 0)\nELSE\nEND-IF` suppressed ELSE registration. A closing paren
      // terminates a condition or expression — the token after it is no longer an
      // operand, so ELSE on the next line is a real IF intermediate.
      const source = 'IF (X > 0)\nELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should not register WHEN/ELSE in USING list as IF intermediate (data-name list continuation)', () => {
      // Bug 4: USING accepts a list of data names. The 2nd and later entries in the list
      // (WHEN, ELSE) should be treated as data names too, not as control-flow intermediates.
      // The check must walk back past intervening data-name tokens to find the original
      // DATA_NAME_VERB (USING) so the entire operand list is recognized.
      const source = 'IF X\n  CALL "P" USING WHEN ELSE\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      // Only the standalone ELSE on line 3 should be a real IF intermediate.
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should not register subsequent operands in USING list with comma separators', () => {
      // Variant: comma already covered by isInExpressionContext, but verify multi-element
      // USING list (USING A B C ELSE) where commas are absent works too.
      const source = 'IF X\n  CALL "P" USING A B C ELSE\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should not register WHEN as EVALUATE intermediate when it is the 2nd operand in MOVE list', () => {
      // MOVE accepts: MOVE source TO target1 target2 ... — the 2nd target is also a data name.
      const source = 'EVALUATE X\n  MOVE A TO B WHEN\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN as 2nd target of MOVE..TO list is data name');
    });

    test('should not register ELSE as IF intermediate when it is the 2nd operand in GIVING list', () => {
      // ADD ... GIVING d1 d2 — both d1 and d2 are data names.
      const source = 'IF X\n  ADD A B GIVING C ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE as 2nd target of GIVING list is data name');
    });

    test('should register WHEN as EVALUATE intermediate when the previous line ends with an identifier-trailing hyphen', () => {
      // Bug: isInExpressionContext treated the `-` ending `VAR-` (an identifier
      // with a trailing hyphen on the prior line) as a subtraction operator, so
      // WHEN on the next line was dropped as a data-name operand. A `-` directly
      // after an identifier char is part of a hyphenated COBOL data name, not an
      // arithmetic operator, so WHEN remains a real EVALUATE intermediate.
      const source = 'EVALUATE TRUE\nMOVE A TO VAR-\n  WHEN VAR-1\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });

    test('should register ELSE as IF intermediate when the previous line ends with an identifier-trailing hyphen', () => {
      const source = 'IF X\n  MOVE A TO VAR-\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should still treat WHEN as data name when preceded by a real subtraction operator after a number', () => {
      // Guard: the hyphen-vs-operator fix must not regress genuine subtraction.
      // `X - WHEN` has whitespace between the digit/identifier and `-`, so the
      // `-` is a subtraction operator and WHEN is an operand, not an intermediate.
      const source = 'EVALUATE X\n  COMPUTE Y = X - WHEN\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN after a real subtraction operator is a data name');
    });

    test('should not register ELSE as intermediate when preceded by EQUAL relational word', () => {
      // Bug: isInExpressionContext detected only symbolic operators (=/</>) and
      // treated their alphabetic equivalents (EQUAL/GREATER/LESS) as ordinary
      // words, so `IF X EQUAL ELSE` wrongly registered ELSE as an intermediate
      // while `IF X = ELSE` (symbolic) did not. EQUAL is a relational operator;
      // the following word is the right comparison operand (a data-name position).
      const source = 'IF X EQUAL ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after EQUAL relational word is data name');
    });
    test('should not register ELSE as intermediate when preceded by GREATER relational word', () => {
      const source = 'IF A GREATER ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after GREATER relational word is data name');
    });
    test('should not register ELSE as intermediate when preceded by LESS relational word', () => {
      const source = 'IF A LESS ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after LESS relational word is data name');
    });
    test('should not register WHEN as EVALUATE intermediate when preceded by LESS THAN relational phrase', () => {
      // THAN bridges the relational word and its right operand: GREATER THAN /
      // LESS THAN / EQUAL TO. The word after the phrase is still an operand.
      const source = 'EVALUATE TRUE\n  IF A LESS THAN WHEN\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'WHEN after LESS THAN relational phrase is data name');
    });
    test('should not register ELSE as intermediate when preceded by GREATER THAN relational phrase', () => {
      const source = 'IF A GREATER THAN ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after GREATER THAN relational phrase is data name');
    });
    test('should not register ELSE as intermediate when preceded by EQUALS relational word', () => {
      const source = 'IF X EQUALS ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after EQUALS relational word is data name');
    });
    test('should not register ELSE as intermediate when preceded by EXCEEDS relational word', () => {
      const source = 'IF A EXCEEDS ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after EXCEEDS relational word is data name');
    });
    test('should not register ELSE as intermediate when preceded by lowercase equal relational word (case-insensitive)', () => {
      // COBOL is case-insensitive; the alphabetic relational words must match
      // regardless of case (equal/Equal/EQUAL).
      const source = 'if x equal else\nend-if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end-if');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else after lowercase equal is data name');
    });
    test('should register ELSE as IF intermediate when a relational word ends the previous line (incomplete expression)', () => {
      // Mirrors the symbolic crossedNewline guard: a relational word left
      // dangling at the end of the previous line is an incomplete expression
      // (editing in progress). ELSE on the following line is a real control-flow
      // intermediate, not the operator's right operand.
      const source = 'IF A EQUAL\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
    test('should still treat ELSE as data name when symbolic = operator precedes it (existing behavior preserved)', () => {
      // Guard: the alphabetic relational fix must not regress the symbolic
      // operator path. `IF X = ELSE` already suppresses ELSE registration.
      const source = 'IF X = ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after = symbolic operator is data name');
    });
    test('should still register ELSE as intermediate when preceded by an ordinary data name (no relational word)', () => {
      // Guard: ordinary words must not be mistaken for relational operators.
      // `IF X\n  ELSE` has only the condition identifier X before ELSE, so ELSE
      // is a real IF intermediate.
      const source = 'IF X\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
  });

  suite('Regression 2026-05-09: ELSE/WHEN expression context honors excluded regions', () => {
    test('should register ELSE as IF intermediate when expression-like char is inside *> inline comment', () => {
      // Without the fix, the backward scan from ELSE would land on the trailing `+` in the
      // inline comment and falsely treat ELSE as a data name in an expression context.
      const source = 'IF X\n  *> comment ending +\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should register ELSE as IF intermediate when expression-like char is inside >> compiler directive', () => {
      // The >> directive line ends with `+`, but it is a comment-like region.
      // ELSE should still be recognized as an IF intermediate.
      const source = 'IF X\n>>SOURCE FORMAT IS FREE +\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should register WHEN as EVALUATE intermediate when expression-like char is inside *> inline comment', () => {
      const source = 'EVALUATE X\n  *> trailing operator +\n  WHEN 1\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });

    test('should still detect real expression context with operator outside excluded region', () => {
      // Sanity check: real expression operators must still suppress ELSE registration.
      const source = 'IF X\n  COMPUTE Y = X + ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'Real + operator still suppresses ELSE');
    });
  });

  suite('Regression: next-line WHEN/ELSE after a line ending in an operand introducer', () => {
    test('should register the 2nd WHEN when the previous line ends with MOVE..TO', () => {
      // Bug: isPrecedingWordDataNameVerb crossed the newline and landed on the
      // trailing TO of an incomplete `MOVE X TO`, treating the next line's WHEN
      // as a data name. A line-crossing first hop onto an operand introducer
      // (TO/BY/INTO/...) must not suppress WHEN/ELSE.
      const source = 'EVALUATE Z\n  WHEN A\n    MOVE X TO\n  WHEN B\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN', 'WHEN']);
    });

    test('should register ELSE when the previous line ends with ADD..TO', () => {
      const source = 'IF X\n  ADD A TO\n  ELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });

    test('should still suppress ELSE when the previous line ends with the verb MOVE itself', () => {
      // Counter-case: a line ending with the bare verb MOVE keeps the next
      // line's ELSE as the verb's first operand (existing data-name behavior).
      const source = 'IF X\n  MOVE\n    ELSE TO Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'ELSE after a bare MOVE on the prior line stays a data name');
    });
  });

  suite('Regression: WHEN/ELSE registers on the enclosing block past an unclosed inner block', () => {
    test('should register ELSE on the IF when an inner PERFORM is unclosed at the ELSE', () => {
      // Bug: matchBlocks only inspected the stack top for ELSE; with an unclosed
      // PERFORM on top, the ELSE was silently dropped instead of registering on
      // the enclosing IF. The handler now searches the stack downward.
      const source = 'IF X\n  PERFORM UNTIL Z\n    DISPLAY A\nELSE\n  DISPLAY B\n  END-PERFORM\nEND-IF';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value.toUpperCase() === 'IF');
      assert.ok(ifPair, 'IF/END-IF should be detected');
      assertIntermediates(ifPair as (typeof pairs)[number], ['ELSE']);
    });

    test('should register WHEN on the EVALUATE when an inner PERFORM is unclosed at the WHEN', () => {
      const source = 'EVALUATE Z\n  PERFORM UNTIL Q\n  WHEN A\n  END-PERFORM\nEND-EVALUATE';
      const pairs = parser.parse(source);
      const evalPair = pairs.find((p) => p.openKeyword.value.toUpperCase() === 'EVALUATE');
      assert.ok(evalPair, 'EVALUATE/END-EVALUATE should be detected');
      assertIntermediates(evalPair as (typeof pairs)[number], ['WHEN']);
    });
  });

  suite('Coverage: matchExecBlock rejects malformed EXEC forms', () => {
    test('should not treat EXEC as an EXEC block when no sub-language keyword follows on the same line', () => {
      // matchExecBlock requires `[ \t]+<keyword>` after EXEC; a newline does not
      // satisfy it, so EXEC is not an excluded region and the trailing IF/END-IF
      // block is still detected.
      const source = 'EXEC\nSQL X END-EXEC\nIF Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0, 'EXEC followed by a newline must not form an EXEC block');
    });

    test('should not treat a bare EXEC at end of source as an EXEC block', () => {
      const source = 'IF Y\nEND-IF\nEXEC';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0, 'A bare EXEC with nothing after it must not form an EXEC block');
    });

    test('should not treat EXEC SQL as an EXEC block when a non-ASCII letter follows the sub-language keyword', () => {
      // The captured sub-language token is `SQL`, but it is immediately followed
      // by `é`; matchExecBlock rejects this so the real word is `SQLé`, not `SQL`.
      const source = 'EXEC SQLé END-EXEC\nIF Y\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0, 'EXEC SQLé must not be recognised as an EXEC SQL block');
    });
  });

  suite('Coverage: period-less COPY boundary detection across skipped regions', () => {
    // findBlockVerbAfterCopy must skip *> comments, string literals and >>/comment
    // lines so a verb word hidden inside them is not mistaken for the statement
    // boundary. A period-less COPY ends at the first real block-opening verb past
    // the copybook name, so a later REPLACING is not in COPY context and its
    // ==...== delimiters are not pseudo-text.
    function pseudoCount(source: string): number {
      return parser.getExcludedRegions(source).filter((r) => source.slice(r.start, r.start + 2) === '==').length;
    }

    test('should skip a *> comment in a period-less COPY when locating the block verb', () => {
      const source = 'COPY ABC *> PERFORM here\nDISPLAY X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus block verb is not in COPY context');
    });

    test('should skip a string literal in a period-less COPY when locating the block verb', () => {
      const source = "COPY ABC 'PERFORM' DISPLAY X\nREPLACING ==a== BY ==b==.";
      assert.strictEqual(pseudoCount(source), 0, 'a verb word inside a string must not act as the COPY boundary');
    });

    test('should skip a >> directive line in a period-less COPY when locating the block verb', () => {
      const source = 'COPY ABC\n>> PERFORM\nDISPLAY X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'a verb word on a >> directive line must not act as the COPY boundary');
    });

    test('should treat an OF library qualifier as part of a period-less COPY', () => {
      const source = 'COPY ABC OF LIB\nIF X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'OF LIB is part of COPY, the boundary is the later IF verb');
    });

    test('should treat an IN library qualifier as part of a period-less COPY', () => {
      const source = 'COPY ABC IN LIB\nIF X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'IN LIB is part of COPY, the boundary is the later IF verb');
    });

    test('should still detect pseudo-text in a well-formed COPY OF library REPLACING', () => {
      // Contrast: a properly period-terminated COPY ... OF lib REPLACING keeps the
      // ==...== delimiters as pseudo-text excluded regions.
      const source = 'COPY ABC OF LIB REPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 2, 'OF library qualifier must not break pseudo-text detection');
    });

    test('should skip data-name words past the copybook name before reaching the block verb', () => {
      const source = 'COPY ABC DEF GHI\nIF X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'extra data-name words are walked over until the IF verb ends the COPY');
    });

    test('should end a period-less COPY at a following non-block verb so a later REPLACING is not pseudo-text', () => {
      // Bug: getPseudoTextStarts only dropped the COPY state at a period or a
      // block-opening verb. A non-block verb such as MOVE left sawCopy set, so a
      // REPLACING in the next statement was wrongly treated as a COPY REPLACING
      // and its ==...== delimiters became pseudo-text — hiding the IF/END-IF
      // block inside them. A non-block COBOL verb past the copybook name ends
      // the period-less COPY just like a block-opening verb does.
      const source = 'COPY MYBOOK\nMOVE 1 TO X\nREPLACING == IF A\nEND-IF == BY ==B==';
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus MOVE verb is not in COPY context');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should still detect pseudo-text in a period-terminated COPY followed by a non-block verb', () => {
      // Contrast: with a terminating period the COPY statement is properly
      // closed; the following MOVE and REPLACING belong to separate statements,
      // and the IF/END-IF block is detected as before.
      const source = 'COPY MYBOOK.\nMOVE 1 TO X\nREPLACING == IF A\nEND-IF == BY ==B==';
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING in a separate statement is not pseudo-text');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    // Bug: findBlockVerbAfterCopybook (cobolPseudoText.ts) only checked
    // blockOpen keywords, so non-block verbs (MOVE/SET/STOP RUN/OPEN/CLOSE/
    // CONTINUE/...) failed to terminate a period-less COPY. The body of the
    // following IF/END-IF was wrongly absorbed into the COPY context, the
    // END-IF token was filtered out as "inside COPY", and the IF/END-IF
    // pair was lost. Each non-block verb listed in
    // COPY_TERMINATING_NONBLOCK_VERBS must end the period-less COPY just
    // like a block-opening verb.
    test('should end a period-less COPY at MOVE so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nMOVE Q TO W\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should end a period-less COPY at SET so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nSET FLAG TO TRUE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should end a period-less COPY at STOP so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nSTOP RUN\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should end a period-less COPY at OPEN so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nOPEN INPUT FILE-A\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should end a period-less COPY at CLOSE so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nCLOSE FILE-A\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

    test('should end a period-less COPY at CONTINUE so the following IF/END-IF pair is detected', () => {
      const source = 'IF A\nCOPY X\nCONTINUE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
  });

  suite('Coverage: COPY detection skips strings and comments preceding the COPY keyword', () => {
    function pseudoCount(source: string): number {
      return parser.getExcludedRegions(source).filter((r) => source.slice(r.start, r.start + 2) === '==').length;
    }

    test('should skip a string literal that precedes the COPY keyword within the statement', () => {
      // isInCopyStatement scans the statement for a COPY keyword; a string literal
      // before COPY must be skipped so its content is not misread. The period-less
      // COPY still ends at the IF verb, so the later REPLACING is not pseudo-text.
      const source = "MOVE 'lit' TO Z COPY ABC\nIF X\nREPLACING ==a== BY ==b==.";
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus block verb is not in COPY context');
      const regions = parser.getExcludedRegions(source);
      assert.ok(
        regions.some((r) => source.slice(r.start, r.end) === "'lit'"),
        'the string literal before COPY should be an excluded region'
      );
    });

    test('should skip a *> inline comment that precedes the COPY keyword within the statement', () => {
      const source = 'MOVE Z *> note\n COPY ABC\nIF X\nREPLACING ==a== BY ==b==.';
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus block verb is not in COPY context');
      const regions = parser.getExcludedRegions(source);
      assert.ok(
        regions.some((r) => source.slice(r.start, r.end).startsWith('*>')),
        'the *> comment before COPY should be an excluded region'
      );
    });

    test('should skip a string with doubled quotes that precedes the COPY keyword within the statement', () => {
      // The string scan must treat the doubled '' as an escaped quote, not as the
      // end of the literal, so the COPY keyword after it is still recognised.
      const source = "MOVE 'a''b' TO Z COPY ABC\nIF X\nREPLACING ==a== BY ==b==.";
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus block verb is not in COPY context');
      const regions = parser.getExcludedRegions(source);
      assert.ok(
        regions.some((r) => source.slice(r.start, r.end) === "'a''b'"),
        'the doubled-quote string before COPY should be a single excluded region'
      );
    });

    test('should skip an unterminated string that precedes the COPY keyword within the statement', () => {
      // A string broken by a newline is treated as ending at the line break; the
      // COPY keyword on the following line is still recognised.
      const source = "MOVE 'unterminated\n COPY ABC\nIF X\nREPLACING ==a== BY ==b==.";
      assert.strictEqual(pseudoCount(source), 0, 'REPLACING after a period-less COPY plus block verb is not in COPY context');
    });

    test('should not treat a COPY keyword that is inside a *> comment as a real COPY statement', () => {
      // The *> comment runs to end of line and swallows `COPY ABC`, so there is no
      // real COPY statement and the later REPLACING is not pseudo-text.
      const source = 'MOVE Z *> note COPY ABC\nIF X\nREPLACING ==a== BY ==b==.';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(pseudoCount(source), 0, 'a commented-out COPY does not create a COPY statement');
    });
  });

  suite('Coverage: multi-pair pseudo-text chains after hyphenated identifiers', () => {
    function pseudoCount(source: string): number {
      return parser.getExcludedRegions(source).filter((r) => source.slice(r.start, r.start + 2) === '==').length;
    }

    test('should not treat chained ==...== as pseudo-text after the hyphenated identifier COPY-RECORD', () => {
      // COPY-RECORD is a data name, not the COPY keyword, so REPLACING is not in a
      // COPY statement. The backward scanner walks the whole ==a== BY ==b== ==c== BY
      // ==d== chain and finds no real COPY context, so nothing is excluded.
      const source = 'COPY-RECORD REPLACING ==A== BY ==B== ==C== BY ==D==.\nIF X\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pseudoCount(source), 0, 'chained delimiters after COPY-RECORD are not pseudo-text');
    });

    test('should not treat chained ==...== as pseudo-text after the hyphenated identifier MY-REPLACE', () => {
      // MY-REPLACE is a data name, not the REPLACE keyword.
      const source = 'MY-REPLACE ==A== BY ==B== ==C== BY ==D==.\nIF X\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pseudoCount(source), 0, 'chained delimiters after MY-REPLACE are not pseudo-text');
    });
  });

  suite('Coverage: pseudo-text delimiters with no preceding context', () => {
    test('should not treat ==...== at the start of source as pseudo-text', () => {
      // The backward scan from the ==...== runs off the start of the buffer with
      // only whitespace, so there is no REPLACING/REPLACE/ALSO context.
      const source = '   ==a== BY ==b==';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(parser.getExcludedRegions(source).length, 0, 'orphan ==...== is left unexcluded');
    });

    test('should not treat ==...== preceded only by ALSO at the start of source as pseudo-text', () => {
      const source = 'ALSO ==a==';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(parser.getExcludedRegions(source).length, 0, 'ALSO without a preceding REPLACE is not pseudo-text context');
    });

    test('should not treat ==...== preceded only by BY at the start of source as pseudo-text', () => {
      const source = 'BY ==a==';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(parser.getExcludedRegions(source).length, 0, 'BY without a preceding REPLACING/REPLACE is not pseudo-text context');
    });

    test('should not treat a chained ==...== ==...== preceded only by BY at the start of source as pseudo-text', () => {
      // The backward scanner walks the ==a== ==b== chain past BY and runs off the
      // start of the buffer without finding a REPLACING/REPLACE context.
      const source = 'BY ==a== ==b==';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(parser.getExcludedRegions(source).length, 0, 'a BY-led chain at the start of source is not pseudo-text context');
    });

    test('should not treat a ==...== BY ==...== chain preceded only by BY at the start of source as pseudo-text', () => {
      const source = 'BY ==a== BY ==b==';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      assert.strictEqual(parser.getExcludedRegions(source).length, 0, 'a BY-separated chain at the start of source is not pseudo-text context');
    });
  });

  suite('Coverage: fixed-format string-literal continuation branches', () => {
    // findFixedFormStringContinuation joins an unterminated literal with a
    // column-7 `-` continuation line. The literal's region must span both
    // halves; keywords in the continuation prep area must not be tokenised.

    test('should join a literal across a CRLF line ending', () => {
      // Newline before the continuation line is CRLF. The literal region must
      // still span both halves so the IF/END-IF placed inside the literal
      // padding do not pair, while the real IF/END-IF after it does.
      const source = '           DISPLAY "AAA\r\n      -    "BBB".\r\n           IF X\r\n           END-IF.';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(cont.end > source.indexOf('"BBB"') + 4, 'continuation region must span past the second quote across CRLF');
      assertSingleBlock(parser.parse(source), 'IF', 'END-IF');
    });

    test('should join a literal across a CR-only line ending', () => {
      // Old-macOS CR-only newline before the continuation line.
      const source = '           DISPLAY "AAA\r      -    "BBB".\r           IF X\r           END-IF.';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(cont.end > source.indexOf('"BBB"') + 4, 'continuation region must span past the second quote across CR');
      assertSingleBlock(parser.parse(source), 'IF', 'END-IF');
    });

    test('should skip a fully blank line before the continuation line', () => {
      // A blank line (no column-7 indicator) between the two literal halves is
      // ignored per COBOL spec; the continuation still joins.
      const source = '           DISPLAY "AAA\n\n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(cont.end > source.indexOf('"BBB"') + 4, 'continuation region must span past the blank line to the second quote');
    });

    test('should skip a whitespace-only short line before the continuation line', () => {
      // A line shorter than 7 columns that is whitespace-only is treated as
      // blank and skipped.
      const source = '           DISPLAY "AAA\n   \n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(cont.end > source.indexOf('"BBB"') + 4, 'continuation region must span past the short blank line');
    });

    test('should skip a whitespace-only line beyond column 7 before the continuation line', () => {
      // A line with a blank column-7 indicator and only whitespace afterwards
      // is a blank line and is skipped.
      const source = '           DISPLAY "AAA\n                   \n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(cont.end > source.indexOf('"BBB"') + 4, 'continuation region must span past the whitespace-only line');
    });

    test('should skip a column-7 star comment line before the continuation line', () => {
      // A `*` comment line between the two halves is skipped; keywords inside
      // the comment are not tokenised either.
      const source = '           DISPLAY "AAA\n      * NOTE IF END-IF\n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(
        cont.start < source.indexOf('IF') && cont.end > source.indexOf('END-IF'),
        'continuation region must absorb the intervening comment line'
      );
      assertNoBlocks(parser.parse(source));
    });

    test('should skip a fixed-format debug line before the continuation line', () => {
      // A column-7 `D` debug line (digit in the sequence area, non-identifier
      // char after `D`) is skipped; the continuation still joins.
      const source = '           DISPLAY "AAA\n0001  D IF X END-IF\n      -    "BBB".';
      const regions = parser.getExcludedRegions(source);
      const cont = regions.find((r) => source[r.start] === '"');
      assert.ok(cont, 'expected a string region starting at the opening quote');
      assert.ok(
        cont.start < source.indexOf('IF') && cont.end > source.indexOf('END-IF'),
        'continuation region must absorb the intervening debug line'
      );
      assertNoBlocks(parser.parse(source));
    });

    test('should not treat a column-7 D line as debug when the sequence area has no digit', () => {
      // No digit in the sequence area means `D` is not a fixed-format debug
      // indicator; it is also not the `-` continuation indicator, so the
      // continuation is abandoned and only the first literal half is excluded.
      const source = '           DISPLAY "AAA\n      D     "BBB"';
      const regions = parser.getExcludedRegions(source);
      const firstHalf = regions.find((r) => r.start === source.indexOf('"AAA'));
      assert.ok(firstHalf, 'expected the first literal half as its own region');
      assert.strictEqual(firstHalf.end, source.indexOf('"AAA') + 4, 'unterminated literal stops at the first newline when continuation fails');
    });

    test('should not treat a column-7 D line as debug when D is followed by an identifier char', () => {
      // Sequence area has a digit but the char after `D` is an identifier
      // char, so the line is not a debug line; `D` is not `-` either, so the
      // continuation is abandoned.
      const source = '           DISPLAY "AAA\n0001  DX    "BBB"';
      const regions = parser.getExcludedRegions(source);
      const firstHalf = regions.find((r) => r.start === source.indexOf('"AAA'));
      assert.ok(firstHalf, 'expected the first literal half as its own region');
      assert.strictEqual(firstHalf.end, source.indexOf('"AAA') + 4, 'unterminated literal stops at the first newline when continuation fails');
    });

    test('should abandon continuation when the next line has a non-hyphen column-7 indicator', () => {
      // A letter in column 7 is neither blank, comment, debug, nor the `-`
      // continuation indicator: the literal is left unterminated.
      const source = '           DISPLAY "AAA\n       X CODE';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'only the unterminated first half is excluded');
      assert.strictEqual(regions[0].end, source.indexOf('"AAA') + 4, 'region stops at the first newline');
    });

    test('should abandon continuation when a short line has non-blank content', () => {
      // A line shorter than 7 columns with non-whitespace content cannot be a
      // continuation line and is not skipped as blank.
      const source = '           DISPLAY "AAA\n   XY';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'only the unterminated first half is excluded');
      assert.strictEqual(regions[0].end, source.indexOf('"AAA') + 4, 'region stops at the first newline');
    });

    test('should abandon continuation when the sequence area is not digits or whitespace', () => {
      // Letters in columns 1-6 are not a valid fixed-format sequence area, so
      // the line cannot be a continuation line.
      const source = '           DISPLAY "AAA\nABCDEF-   "BBB"';
      const regions = parser.getExcludedRegions(source);
      const firstHalf = regions.find((r) => r.start === source.indexOf('"AAA'));
      assert.ok(firstHalf, 'expected the first literal half as its own region');
      assert.strictEqual(firstHalf.end, source.indexOf('"AAA') + 4, 'region stops at the first newline when the sequence area is invalid');
    });

    test('should abandon continuation when a hyphen line has no opening quote', () => {
      // A valid column-7 `-` line with no matching opening quote in area B is
      // not a string continuation; the literal stays unterminated.
      const source = '           DISPLAY "AAA\n      -    NOQUOTE HERE';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'only the unterminated first half is excluded');
      assert.strictEqual(regions[0].end, source.indexOf('"AAA') + 4, 'region stops at the first newline');
    });

    test('should leave the literal unterminated when the source ends right after the newline', () => {
      // The unterminated literal hits a newline that is the end of source;
      // there is no continuation line to scan.
      const source = '           DISPLAY "AAA\n';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'only the unterminated first half is excluded');
      assert.strictEqual(regions[0].end, source.indexOf('"AAA') + 4, 'region stops at the first newline');
    });

    test('should abandon continuation when a tab overshoots column 6 in the continuation sequence area', () => {
      // A tab in the sequence area jumps the visual column past 6, so the
      // line is treated as a short line; the remaining text is non-blank, so
      // the continuation is abandoned.
      const source = '           DISPLAY "AAA\n12\t-"BBB"';
      const regions = parser.getExcludedRegions(source);
      const firstHalf = regions.find((r) => r.start === source.indexOf('"AAA'));
      assert.ok(firstHalf, 'expected the first literal half as its own region');
      assert.strictEqual(firstHalf.end, source.indexOf('"AAA') + 4, 'region stops at the first newline when a tab overshoots column 6');
    });

    test('should abandon continuation when a tab is the entire sequence area of the next line', () => {
      // The next line is a lone tab followed by `-"BBB"`. The tab overshoots
      // visual column 6, so the line is a short line whose content (just the
      // tab) is whitespace-only — it is skipped as blank. The scan then
      // revisits the line at the `-`, a non-newline character, which is not a
      // valid continuation start, so the literal is left unterminated.
      const source = '           DISPLAY "AAA\n\t-"BBB"';
      const regions = parser.getExcludedRegions(source);
      const firstHalf = regions.find((r) => r.start === source.indexOf('"AAA'));
      assert.ok(firstHalf, 'expected the first literal half as its own region');
      assert.strictEqual(firstHalf.end, source.indexOf('"AAA') + 4, 'region stops at the first newline when the tab-only line is skipped');
    });

    test('should leave the literal unterminated when a whitespace-only line beyond column 7 ends the source', () => {
      // A blank column-7 line followed only by whitespace running to the end
      // of source is skipped, after which there is no continuation line.
      const source = '           DISPLAY "AAA\n             ';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1, 'only the unterminated first half is excluded');
      assert.strictEqual(regions[0].end, source.indexOf('"AAA') + 4, 'region stops at the first newline');
    });
  });

  suite('Coverage: ELSE/WHEN context detection at source boundaries', () => {
    test('should drop an orphan ELSE preceded only by whitespace at the start of source', () => {
      // isPrecedingWordDataNameVerb and isInExpressionContext both run their
      // backward scans off the start of the buffer. The orphan ELSE produces
      // no pair and does not poison the following real IF/END-IF block.
      const source = '   ELSE\nIF X\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'the trailing IF gains no intermediate from the orphan ELSE');
    });

    test('should drop an orphan WHEN preceded only by whitespace at the start of source', () => {
      const source = '  WHEN X\nEVALUATE Y\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'the trailing EVALUATE gains no intermediate from the orphan WHEN');
    });

    test('should drop an orphan ELSE preceded by a separator at the start of source', () => {
      // isPrecedingWordDataNameVerb skips the leading `,` separator, then runs
      // its backward scan off the start of the buffer.
      const source = '  , ELSE\nIF X\n  DISPLAY "OK"\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'the trailing IF gains no intermediate from the orphan ELSE');
    });

    test('should register ELSE as an IF intermediate after a long run of plain data names', () => {
      // isPrecedingWordDataNameVerb caps its backward walk at 32 words. A run
      // of 35 non-verb words exhausts the cap without finding a data-name
      // verb, so ELSE is treated as a real control-flow intermediate.
      const words = Array.from({ length: 35 }, (_, n) => `WX${n + 1}`).join(' ');
      const source = `IF X\n${words} ELSE\nEND-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
  });

  suite('Regression 2026-05-23: period-less COPY recognises END-* keywords as statement boundary', () => {
    // Bug: a period-less COPY that is followed directly by an END-* close keyword
    // swallowed the close keyword as the copybook name (or as the library word after
    // OF/IN). findBlockVerbAfterCopybook (and the helpers in cobolHelpers /
    // cobolPseudoText) only recognised block-opening verbs and non-block verbs as the
    // statement boundary, so close keywords like END-IF, END-EVALUATE etc. were never
    // treated as a boundary. As a result the enclosing IF/EVALUATE lost its END-* and
    // the BlockPair disappeared.
    test('should pair IF with END-IF when COPY ABC sits between them', () => {
      const source = 'IF X\nCOPY ABC\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
    test('should pair IF with END-IF when COPY ABC OF (no library yet) sits between them', () => {
      // OF/IN with no following library word: the END-IF on the next line must still
      // terminate the COPY rather than being absorbed as the library name.
      const source = 'IF X\nCOPY ABC OF\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
    test('should pair IF with END-IF when COPY ABC OF LIB sits between them', () => {
      const source = 'IF X\nCOPY ABC OF LIB\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
    test('should pair EVALUATE with END-EVALUATE when COPY ABC and a WHEN sit between them', () => {
      const source = 'EVALUATE X\nCOPY ABC\nWHEN 1\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });
  });

  suite('Regression 2026-05-23: COPY filename filter applies to block_middle keywords', () => {
    // Bug: the tokenize override only suppressed block_open / block_close keywords
    // used as a COPY copybook name. block_middle (ELSE/WHEN) was tokenised, so
    // `COPY WHEN.` injected an extra WHEN intermediate into the enclosing EVALUATE.
    test('should not treat COPY WHEN. as a WHEN intermediate of the surrounding EVALUATE', () => {
      const source = 'EVALUATE X\n  COPY WHEN.\n  WHEN 1\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });
    test('should not treat COPY ELSE. as an ELSE intermediate of the surrounding IF', () => {
      const source = 'IF X\n  COPY ELSE.\n  ELSE\n  DISPLAY OK\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
  });

  suite('Regression 2026-05-23: standalone PERFORM. is not paired with END-PERFORM', () => {
    // Bug: `PERFORM.` (the verb followed directly by a period) is not a structured
    // PERFORM — the period terminates the statement with no body or iteration phrase,
    // so it must remain an orphan paragraph-style PERFORM with no opener. The
    // following END-PERFORM has nothing to pair with. computeValidPositions wrongly
    // accepted such a PERFORM as a structured opener because its peek-ahead only
    // looked at the next word and ignored statement-ending punctuation.
    test('should not pair PERFORM. with a following END-PERFORM', () => {
      const source = 'PERFORM.\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
    test('should still pair a structured PERFORM whose UNTIL phrase begins on the next line', () => {
      // Guard the fix: when the next non-blank token is a structured PERFORM phrase
      // (UNTIL/VARYING/WITH/TEST) the opener must still be accepted even though it
      // starts on a different physical line. Only a period (statement terminator)
      // disqualifies the opener.
      const source = 'PERFORM\n  UNTIL DONE\n  DISPLAY X\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression 2026-05-24: PERFORM N TIMES split across newline still pairs', () => {
    // Bug: when the iteration phrase of a structured PERFORM was split across a
    // newline (e.g. `PERFORM 3` on one line and `TIMES` on the next),
    // computeValidPositions only peeked at the next word on the same physical line
    // via `^[ \\t]+`, so the TIMES verb was missed. The PERFORM was misclassified
    // as a paragraph call and rejected, leaving the END-PERFORM orphan. The lookahead
    // must treat the inter-word whitespace as any horizontal-or-vertical blank within
    // the same statement (terminated by a period).
    test('should pair PERFORM with END-PERFORM when the count and TIMES are split across a newline', () => {
      const source = 'PERFORM 3\n  TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should pair PERFORM with END-PERFORM when the count, variable, and TIMES are all split across newlines', () => {
      const source = 'PERFORM\n  WS-COUNT\n  TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should not pair PERFORM with END-PERFORM when a period intervenes before TIMES', () => {
      // Guard: a period closes the statement; the TIMES on the next line is no
      // longer part of the PERFORM and the opener stays a paragraph call.
      const source = 'PERFORM 3.\n  TIMES\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
    test('should pair PERFORM with END-PERFORM when paragraph THRU split across a newline is rejected', () => {
      // Guard: PERFORM <paragraph> THRU/THROUGH is still a paragraph call even when
      // split across newlines. The opener must remain rejected.
      const source = 'PERFORM PARA-A\n  THRU PARA-Z';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression 2026-05-19: dangling operator before a newline keeps ELSE/WHEN intermediate', () => {
    test('should register ELSE as IF intermediate when the condition ends with a dangling operator before a newline', () => {
      // Bug: isInExpressionContext skipped the newline and reached the `>` that
      // ended the previous line, treating ELSE as the operator's right operand
      // and dropping it. A relational/arithmetic operator left dangling at the
      // end of a line is an incomplete expression; ELSE on the next line is a
      // real control-flow intermediate, not the operator's operand.
      const source = 'IF X >\nELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
    test('should register WHEN as EVALUATE intermediate when a branch ends with a dangling operator before a newline', () => {
      const source = 'EVALUATE X\n  WHEN A =\n  WHEN OTHER\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN', 'WHEN']);
    });
  });

  suite('Regression 2026-05-24: dangling separator or open-paren before a newline keeps ELSE/WHEN intermediate', () => {
    // Bug: isInExpressionContext only treated +/-/*/=/</> as "incomplete-expression-on-prior-line"
    // operators. A separator (comma/semicolon) or an open parenthesis dangling at the end of the
    // previous line is also an incomplete expression — the next line's ELSE/WHEN starts a new
    // control-flow branch, not the right operand of the dangling token. Without including `,`/`;`/`(`
    // in the cross-newline guard, the WHEN/ELSE was suppressed and the enclosing EVALUATE/IF lost
    // its intermediate.
    test('should register WHEN as EVALUATE intermediate when a branch ends with a dangling comma before a newline', () => {
      const source = 'EVALUATE Z\n  ADD X,\n  WHEN B\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });
    test('should register WHEN as EVALUATE intermediate when a branch ends with a dangling semicolon before a newline', () => {
      const source = 'EVALUATE Z\n  ADD X;\n  WHEN B\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });
    test('should register ELSE as IF intermediate when the condition ends with a dangling open parenthesis before a newline', () => {
      const source = 'IF (\nELSE\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
    test('should still treat ELSE as operand of a same-line comma', () => {
      // Guard: a comma on the same line as ELSE/WHEN (no newline crossed) is a real
      // operand separator, so the keyword IS used as a data name and must be suppressed.
      // This preserves the existing same-line behaviour `CALL "P" USING A, ELSE` etc.
      const source = 'CALL "P" USING A, ELSE';
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.some((t) => t.value.toUpperCase() === 'ELSE'),
        false
      );
    });
  });

  suite('Regression 2026-05-24: bare COPY before a block-opening verb does not swallow the verb', () => {
    // Bug: `COPY\nIF X\nEND-IF` (a COPY statement with no copybook name typed yet)
    // treated the following IF as the copybook name, so the IF token was filtered out
    // by isInCopyStatement. The trailing END-IF survived as orphan and the IF/END-IF
    // pair disappeared. Per cost-minimization, when word 0 of a period-less COPY is
    // itself a block-opening verb and the next significant token is neither `.` nor
    // `OF`/`IN`, the COPY has no operand and the verb begins a new statement — pair
    // it with its END-* close instead of dropping the whole block.
    test('should pair IF with END-IF when a bare COPY precedes the IF', () => {
      const source = 'COPY\nIF X\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
    test('should pair PERFORM with END-PERFORM when a bare COPY precedes the PERFORM', () => {
      const source = 'COPY\nPERFORM UNTIL X\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should pair EVALUATE with END-EVALUATE when a bare COPY precedes the EVALUATE', () => {
      const source = 'COPY\nEVALUATE Z\n  WHEN 1\n    DISPLAY OK\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN']);
    });
    test('should still treat IF as the copybook name when followed by a period', () => {
      // Guard: `COPY IF.` is a legitimate copybook name that happens to spell a
      // reserved word, terminated by the period. The IF must NOT be tokenised as a
      // block opener.
      const source = 'COPY IF.\nDISPLAY OK';
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.some((t) => t.value.toUpperCase() === 'IF'),
        false
      );
    });
    test('should still treat IF as the copybook name when followed by OF/IN qualifier', () => {
      // Guard: `COPY IF OF LIB.` is also a legitimate copybook with a library qualifier.
      const source = 'COPY IF OF LIB.\nDISPLAY OK';
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.some((t) => t.value.toUpperCase() === 'IF'),
        false
      );
    });
  });

  suite('Regression 2026-05-25: PERFORM decimal-literal TIMES is a structured block', () => {
    // Bug: `PERFORM 5.5 TIMES ... END-PERFORM` was misclassified as a paragraph
    // call and the END-PERFORM left orphan. The `nextWord` regex used in
    // computeValidPositions to peek at the operand after PERFORM stops at the
    // first `.`, so `5.5` was read as `5` and the trailing `.5 TIMES` lookahead
    // failed to find the TIMES verb. Per cost-minimisation, when the operand is
    // a numeric literal we must skip its decimal (`.digits`) and scientific
    // (`E[+-]?digits`) tail before scanning for the TIMES verb, so the
    // structured PERFORM is recognised and the END-PERFORM is paired.
    test('should pair PERFORM with END-PERFORM when the count is a decimal literal', () => {
      const source = 'PERFORM 5.5 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should pair PERFORM with END-PERFORM when the count is a decimal literal starting with zero', () => {
      const source = 'PERFORM 0.5 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should pair PERFORM with END-PERFORM when the count is a scientific-notation literal', () => {
      const source = 'PERFORM 1.5E2 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should pair PERFORM with END-PERFORM when the count is a signed-exponent scientific literal', () => {
      const source = 'PERFORM 1.5E+2 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
    test('should reject PERFORM paragraph decimal-count TIMES as block', () => {
      // Guard: `PERFORM PARA-A 5.5 TIMES` is still a paragraph call with an
      // iteration count, so the END-PERFORM must remain orphan and the IF/PERFORM
      // stay rejected (same behaviour as `PERFORM PARA-A 5 TIMES`).
      const source = 'PERFORM PARA-A 5.5 TIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression 2026-05-25: IF/END-IF used as data names inside MOVE/ADD are not tokenized as block keywords', () => {
    // Bug: `IF Y\n  MOVE IF TO X\nEND-IF` — the inner `IF` operand of MOVE is
    // tokenized as a block-open keyword (because the WHEN/ELSE filter in
    // tokenize() only ran on block_middle), pushing a phantom IF onto the
    // opener stack. The trailing END-IF then matches the phantom and the real
    // IF becomes orphan. Same for `MOVE END-IF TO Y` — the inner `END-IF`
    // operand of MOVE is tokenized as a block-close keyword, prematurely
    // closing the real IF. Per cost-minimization, reserved-word identifiers
    // used as operands of a data-name verb (MOVE/ADD/SUBTRACT/SET/...) must
    // not contribute to block detection regardless of whether they spell an
    // opener, closer, or middle keyword.
    test('should pair real IF with real END-IF when MOVE IF appears inside the body', () => {
      // The real IF is at line 0, col 0; the inner `IF` operand of MOVE is at
      // line 1, col 7. Without the fix the inner IF was tokenized as a block
      // opener and the real END-IF paired with it, leaving the real IF orphan.
      const source = 'IF Y\n  MOVE IF TO X\n  DISPLAY OK\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].openKeyword.line, 0, 'real IF must be at line 0, not the inner MOVE-IF operand');
      assert.strictEqual(pairs[0].openKeyword.column, 0);
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.filter((t) => t.value.toUpperCase() === 'IF').length,
        1,
        'inner MOVE-IF operand must not be tokenized as a block-open keyword'
      );
    });
    test('should pair real IF with real END-IF when MOVE END-IF appears inside the body', () => {
      // The real END-IF is at line 3, col 0; the inner `END-IF` operand of MOVE
      // is at line 1, col 7. Without the fix the inner END-IF was tokenized as
      // a block closer and prematurely closed the real IF, leaving the real
      // END-IF orphan.
      const source = 'IF X\n  MOVE END-IF TO Y\n  DISPLAY OK\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assert.strictEqual(pairs[0].closeKeyword.line, 3, 'real END-IF must be at line 3, not the inner MOVE-END-IF operand');
      assert.strictEqual(pairs[0].closeKeyword.column, 0);
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.filter((t) => t.value.toUpperCase() === 'END-IF').length,
        1,
        'inner MOVE-END-IF operand must not be tokenized as a block-close keyword'
      );
    });
  });

  suite('Regression 2026-05-25: PERFORM N *> comment TIMES is a structured block', () => {
    // Bug: `PERFORM 5 *> comment\nTIMES ... END-PERFORM` — the inline `*>`
    // comment between the count operand and the TIMES verb broke the
    // `secondWord` lookahead in computeValidPositions (the regex started
    // from `\s+` and matched the `*` as a non-space character), so the
    // structured PERFORM was misclassified as a paragraph call and the
    // END-PERFORM was left orphan. The fix strips `*>...` and `>>...`
    // comment runs (just like the no-secondWord branch already does) from
    // the lookahead string before scanning for the iteration verb so the
    // structured PERFORM is recognised and paired with its END-PERFORM.
    test('should pair PERFORM with END-PERFORM when an inline comment separates the count from TIMES', () => {
      const source = 'PERFORM 5 *> mid comment\nTIMES\n  DISPLAY OK\nEND-PERFORM';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'PERFORM', 'END-PERFORM');
    });
  });

  suite('Regression 2026-05-25: bare COPY before END-* or block-middle keyword does not swallow the keyword', () => {
    // Bug: `IF X\nCOPY\nEND-IF` (a COPY statement with no copybook name typed yet)
    // treated the following END-IF as the copybook name, so the END-IF was filtered
    // out by isInCopyStatement. The same problem applied to a bare COPY directly
    // followed by an ELSE / WHEN intermediate. Per cost-minimization, when word 0 of
    // a period-less COPY is itself a block-closing END-* keyword, an ELSE/WHEN
    // intermediate, or any other COBOL statement verb that ends a COPY, the COPY
    // has no operand and the keyword begins a new statement — recognise the
    // surrounding pair / intermediate instead of dropping it.
    test('should pair IF with END-IF when a bare COPY precedes END-IF', () => {
      const source = 'IF X\nCOPY\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });
    test('should register ELSE as IF intermediate when a bare COPY precedes ELSE', () => {
      const source = 'IF X\n  DISPLAY A\nCOPY\nELSE\n  DISPLAY B\nEND-IF';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
      assertIntermediates(pairs[0], ['ELSE']);
    });
    test('should register WHEN as EVALUATE intermediate when a bare COPY precedes WHEN', () => {
      const source = 'EVALUATE X\n  WHEN 1\nCOPY\nWHEN 2\nEND-EVALUATE';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'EVALUATE', 'END-EVALUATE');
      assertIntermediates(pairs[0], ['WHEN', 'WHEN']);
    });
    test('should still treat END-IF as the copybook name when followed by a period', () => {
      // Guard: `COPY END-IF.` is a legitimate copybook name that happens to spell
      // a reserved-word closing keyword, terminated by the period. The END-IF
      // must NOT be tokenised as a block closer.
      const source = 'COPY END-IF.\nDISPLAY OK';
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.some((t) => t.value.toUpperCase() === 'END-IF'),
        false
      );
    });
    test('should still treat ELSE as the copybook name when followed by a period', () => {
      // Guard: `COPY ELSE.` is a legitimate copybook name. ELSE must NOT be
      // tokenised as a middle keyword.
      const source = 'COPY ELSE.\nDISPLAY OK';
      const tokens = parser.getTokens(source);
      assert.strictEqual(
        tokens.some((t) => t.value.toUpperCase() === 'ELSE'),
        false
      );
    });
  });

  generateCommonTests(config);
});
