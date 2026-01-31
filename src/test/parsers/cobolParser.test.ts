import * as assert from 'node:assert';
import { CobolBlockParser } from '../../parsers/cobolParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  assertTokens,
  findBlock
} from '../helpers/parserTestHelpers';

suite('CobolBlockParser Test Suite', () => {
  let parser: CobolBlockParser;

  setup(() => {
    parser = new CobolBlockParser();
  });

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
    test('should ignore keywords in inline comments', () => {
      const source = `*> IF PERFORM END-IF END-PERFORM
IF CONDITION
END-IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END-IF');
    });

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

    test('should ignore keywords in double-quoted strings', () => {
      const source = `MOVE "IF PERFORM END-IF END-PERFORM" TO A
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
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('MOVE A TO B');
      assertNoBlocks(pairs);
    });

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
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `IF CONDITION
END-IF`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `PERFORM
  IF CONDITION
  END-IF
END-PERFORM`;
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'IF');
      const performPair = findBlock(pairs, 'PERFORM');
      assertTokenPosition(ifPair.openKeyword, 1, 2);
      assertTokenPosition(performPair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `IF CONDITION
ELSE
END-IF`;
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [{ value: 'IF' }, { value: 'ELSE' }, { value: 'END-IF' }]);
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `*> comment
'string'`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });
  });
});
