import { PascalBlockParser } from '../../parsers/pascalParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('PascalBlockParser Test Suite', () => {
  let parser: PascalBlockParser;

  setup(() => {
    parser = new PascalBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse simple begin-end block', () => {
      const source = `begin
  WriteLn('Hello');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse case-end block', () => {
      const source = `case X of
  1: WriteLn('One');
  2: WriteLn('Two');
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should parse record-end block', () => {
      const source = `record
  X: Integer;
  Y: Integer;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should parse class-end block', () => {
      const source = `class
  private
    FValue: Integer;
  public
    property Value: Integer read FValue;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should parse object-end block', () => {
      const source = `object
  X: Integer;
  Y: Integer;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should parse interface-end block', () => {
      const source = `interface
  procedure DoSomething;
  function GetValue: Integer;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should parse try-end block', () => {
      const source = `try
  RiskyOperation;
except
  HandleError;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });
  });

  suite('Repeat-until blocks', () => {
    test('should parse simple repeat-until block', () => {
      const source = `repeat
  X := X + 1;
until X > 10`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });

    test('should parse repeat-until with nested begin-end', () => {
      const source = `repeat
  begin
    X := X + 1;
    Y := Y - 1;
  end;
until X > Y`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'repeat');
      findBlock(pairs, 'begin');
      // repeat is outer (level 0), begin is inner (level 1)
    });

    test('should parse begin-end with nested repeat-until', () => {
      const source = `begin
  repeat
    X := X + 1;
  until X > 10;
  WriteLn(X);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle multiple repeat-until blocks', () => {
      const source = `begin
  repeat
    X := X + 1;
  until X > 10;
  repeat
    Y := Y + 1;
  until Y > 20;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle interleaved repeat and begin blocks', () => {
      const source = `repeat
  begin
    repeat
      X := X + 1;
    until X > 5;
  end;
until X > 10`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse case with of', () => {
      const source = `case Value of
  1: Result := 'One';
  2: Result := 'Two';
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should parse case with of and else', () => {
      const source = `case Value of
  1: Result := 'One';
  2: Result := 'Two';
else
  Result := 'Other';
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of', 'else']);
    });

    test('should parse try with except', () => {
      const source = `try
  RiskyOperation;
except
  on E: Exception do
    HandleError(E);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['except']);
    });

    test('should parse try with finally', () => {
      const source = `try
  F := OpenFile(Name);
  ProcessFile(F);
finally
  CloseFile(F);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['finally']);
    });

    test('should parse try with except and else', () => {
      const source = `try
  RiskyOperation;
except
  on E: ECustomError do
    HandleCustom(E);
else
  HandleOther;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['except', 'else']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested begin blocks', () => {
      const source = `begin
  begin
    inner;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse nested case in begin', () => {
      const source = `begin
  case X of
    1: DoOne;
    2: DoTwo;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse nested try in begin', () => {
      const source = `begin
  try
    RiskyOperation;
  except
    HandleError;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse deeply nested blocks', () => {
      const source = `begin
  begin
    begin
      begin
        deep;
      end;
    end;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });
  });

  suite('Language-specific features', () => {
    test('should handle Pascal string escaping with doubled quotes', () => {
      const source = `begin
  S := 'It''s a test with ''quotes''';
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle multiple strings with escapes', () => {
      const source = `begin
  S1 := 'begin end';
  S2 := 'It''s begin and it''s end';
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle type definition with record', () => {
      const source = `begin
  type
    TPoint = record
      X: Integer;
      Y: Integer;
    end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Excluded regions', () => {
    test('should skip keywords in single-line comments', () => {
      const source = `begin
  // begin end repeat until case
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in brace comments', () => {
      const source = `begin
  { begin end repeat until case }
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in paren-star comments', () => {
      const source = `begin
  (* begin end repeat until case *)
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in multi-line brace comments', () => {
      const source = `begin
  { this is a
    multi-line comment
    with begin and end }
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in multi-line paren-star comments', () => {
      const source = `begin
  (* this is a
     multi-line comment
     with begin and end *)
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip keywords in strings', () => {
      const source = `begin
  S := 'begin end repeat until case';
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle comment at end of line', () => {
      const source = `begin
  X := 1; // this is not end
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle mixed comment styles', () => {
      const source = `begin
  { brace comment }
  (* paren-star comment *)
  // single line comment
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      assertNoBlocks(parser.parse(''));
    });

    test('should handle source with no blocks', () => {
      assertNoBlocks(parser.parse('program Test; var X: Integer;'));
    });

    test('should handle unmatched begin', () => {
      assertNoBlocks(parser.parse('begin X := 1;'));
    });

    test('should handle unmatched end', () => {
      assertNoBlocks(parser.parse('end'));
    });

    test('should handle unmatched repeat', () => {
      assertNoBlocks(parser.parse('repeat X := 1;'));
    });

    test('should handle unmatched until', () => {
      assertNoBlocks(parser.parse('until X > 10'));
    });

    test('should handle unterminated string', () => {
      const source = `begin
  S := 'unterminated string
end`;
      const pairs = parser.parse(source);
      // Unterminated string extends to EOF
      assertNoBlocks(pairs);
    });

    test('should handle unterminated brace comment', () => {
      const source = `begin
  { unterminated comment
end`;
      const pairs = parser.parse(source);
      // Unterminated comment extends to EOF
      assertNoBlocks(pairs);
    });

    test('should handle unterminated paren-star comment', () => {
      const source = `begin
  (* unterminated comment
end`;
      const pairs = parser.parse(source);
      // Unterminated comment extends to EOF
      assertNoBlocks(pairs);
    });

    test('should handle case-insensitive keywords', () => {
      const source = `BEGIN
  X := 1;
END`;
      const pairs = parser.parse(source);
      // Pascal keywords are case-insensitive
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle mixed case keywords', () => {
      const source = `Begin
  Case X Of
    1: DoOne;
    2: DoTwo;
  End;
End`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle REPEAT-UNTIL with uppercase', () => {
      const source = `REPEAT
  X := X + 1;
UNTIL X > 10`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });

    test('should handle deeply nested blocks', () => {
      const source = `begin
  begin
    begin
      begin
        begin
          deep;
        end;
      end;
    end;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
    });
  });

  suite('Token positions', () => {
    test('should report correct line and column for single line', () => {
      const source = 'begin X end';
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 0, 8);
    });

    test('should report correct positions for multi-line', () => {
      const source = `begin
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });

    test('should report correct positions for repeat-until', () => {
      const source = `repeat
  X := X + 1;
until X > 10`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 2, 0);
    });
  });
});
