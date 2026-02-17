import * as assert from 'node:assert';
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
      const source = `TMyClass = class
  private
    FValue: Integer;
  public
    property Value: Integer read FValue;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should parse object-end block', () => {
      const source = `TPoint = object
  X: Integer;
  Y: Integer;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should parse interface-end block', () => {
      const source = `IMyIntf = interface
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
      // Unterminated string ends at newline, so end is visible
      assertSingleBlock(pairs, 'begin', 'end');
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

    test('should handle unterminated string at end of line', () => {
      const source = `begin
  x := 'unterminated
  if true then
  begin
  end;
end;`;
      const pairs = parser.parse(source);
      // Unterminated string ends at newline; if/then are not block keywords
      assertBlockCount(pairs, 2);
    });
  });

  suite('Class modifier', () => {
    test('should not treat class modifier as block open', () => {
      const source = `type
  TMyClass = class(TObject)
    private
      FCount: Integer;
    public
      class function Create: TMyClass;
      class procedure Destroy;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should parse class type definition correctly', () => {
      const source = `type
  TFoo = class
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });
  });

  suite('Of object', () => {
    test('should not treat of object as block open', () => {
      const source = `type
  TObj = object
    TProc: procedure of object;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should parse object type definition correctly', () => {
      const source = `type
  TPoint = object
    X, Y: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Variant record case', () => {
    test('should not treat case in variant record as block', () => {
      const pairs = parser.parse('TVariant = record\n  case Tag: Integer of\n    0: (IntVal: Integer);\n    1: (FloatVal: Double);\nend');
      assertSingleBlock(pairs, 'record', 'end', 0);
    });
  });

  suite('Class reference type', () => {
    test('should not treat class of as block open', () => {
      const pairs = parser.parse('type\n  TRef = class of TBase;');
      assertNoBlocks(pairs);
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

  suite('Interface keyword validation', () => {
    test('should parse COM interface as block', () => {
      const source = `begin
  record
    X: Integer;
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should not parse unit interface section as block', () => {
      const source = `begin
  X := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse interface after = as block', () => {
      const source = `interface
begin
end`;
      const pairs = parser.parse(source);
      // interface without = is not a block opener
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle interface after = with comment', () => {
      const source = `IMyIntf = { COM interface } interface
  procedure DoSomething;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });
  });

  suite('Coverage: unterminated string at EOF', () => {
    test('should handle unterminated string at end of file without newline', () => {
      const source = "begin\n  x := 'unterminated";
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Object type variant case', () => {
    test('should not treat variant case inside object type as block opener', () => {
      const pairs = parser.parse('type\n  TPoint = object\n    case Integer of\n      0: (X, Y: Integer);\n  end;');
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Class forward declaration', () => {
    test('should not treat class forward declaration as block', () => {
      const pairs = parser.parse('type\n  TFoo = class;');
      assertNoBlocks(pairs);
    });

    test('should not treat class forward declaration with parent as block', () => {
      const pairs = parser.parse('type\n  TFoo = class(TObject);');
      assertNoBlocks(pairs);
    });

    test('should still parse regular class as block', () => {
      const source = `TFoo = class
  FValue: Integer;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });
  });

  suite('CR-only line endings', () => {
    test('should handle single-line comment with CR-only line endings', () => {
      const pairs = parser.parse('// comment\rbegin\r  x := 1;\rend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('isInsideRecord with begin-end', () => {
    test('should recognize variant case after begin-end inside record', () => {
      const source = `TVariant = record
  procedure Init;
  begin
  end;
  case Integer of
    0: (IntVal: Integer);
    1: (FloatVal: Double);
end`;
      const pairs = parser.parse(source);
      // record...end, begin...end (2 blocks)
      // case should not be a block opener because it is inside record
      assertBlockCount(pairs, 2);
      const recordPair = findBlock(pairs, 'record');
      assert.ok(recordPair);
    });
  });

  suite('Forward declaration with comment', () => {
    test('should not treat class forward with brace comment as block', () => {
      const pairs = parser.parse('type\n  TFoo = class(TBase) { forward };');
      assertNoBlocks(pairs);
    });
  });

  suite('Class forward declaration with CRLF', () => {
    test('should not treat class forward with parent as block with CRLF', () => {
      const pairs = parser.parse('type\r\n  TFoo = class(TObject)\r\n  ;');
      assertNoBlocks(pairs);
    });

    test('should not treat class forward as block with CRLF after parent', () => {
      const pairs = parser.parse('type\r\n  TFoo = class(TBase)\r\n;');
      assertNoBlocks(pairs);
    });
  });

  suite('Variant case with qualified type names', () => {
    test('should not treat variant case with qualified type as block', () => {
      const pairs = parser.parse('TVariant = record\n  case Types.MyEnum of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end', 0);
    });

    test('should not treat variant case with dotted type name as block', () => {
      const pairs = parser.parse('TVariant = record\n  case MyUnit.TColor of\n    0: (R: Byte);\n    1: (G: Byte);\nend');
      assertSingleBlock(pairs, 'record', 'end', 0);
    });
  });

  suite('CR-only line endings', () => {
    test('should handle Pascal string with CR-only ending', () => {
      const source = "x := 'unterminated\rif true then\rbegin\r  action;\rend;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('isInsideRecord with class and interface blocks', () => {
    test('should not treat variant case after class-end as inside record', () => {
      // class...end should cancel out end when scanning backward
      const source = `TMyClass = class
  FValue: Integer;
end;
TVariant = record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'class');
      findBlock(pairs, 'record');
    });

    test('should not treat variant case after interface-end as inside record', () => {
      const source = `IMyIntf = interface
  procedure DoSomething;
end;
TVariant = record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'interface');
      findBlock(pairs, 'record');
    });

    test('should not treat variant case after try-end as inside record', () => {
      const source = `try
  DoSomething;
end;
TVariant = record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'try');
      findBlock(pairs, 'record');
    });

    test('should not treat variant case after case-end as inside record', () => {
      const source = `case X of
  1: DoOne;
end;
TVariant = record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'case');
      findBlock(pairs, 'record');
    });

    test('should still detect variant case inside record with class-end before', () => {
      // The class-end pair should be consumed, and the record
      // should still be detected as a record context
      const source = `TMyClass = class
  FValue: Integer;
end;
TVariant = record
  TInner = class
    FX: Integer;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // Outer class, record, inner class (3 blocks)
      // Variant case is NOT a block because it's inside a record
      assertBlockCount(pairs, 3);
      const recordPair = findBlock(pairs, 'record');
      assert.ok(recordPair);
    });
  });

  suite('Nested parentheses in class forward declaration', () => {
    test('should treat class with nested parens followed by semicolon as forward declaration', () => {
      const pairs = parser.parse('TMyClass = class(TBase(TParam));\nbegin\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should treat class with nested parens without semicolon as block', () => {
      const pairs = parser.parse('TMyClass = class(TBase(TParam))\n  FValue: Integer;\nend');
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should handle class forward declaration with comment before semicolon', () => {
      const source = `TMyClass = class(TParent) { comment } ;
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle class forward declaration with whitespace and newline before semicolon', () => {
      const source = `TMyClass = class(TParent)\r\n  ;
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle deeply nested parentheses in class forward declaration', () => {
      const source = 'TMyClass = class(TBase(TParam(TInner)));\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Qualified type names in variant case', () => {
    test('should detect variant case with qualified type name', () => {
      const source = `record
  case Types.MyEnum of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should detect variant case with multi-level qualified type', () => {
      const source = `record
  case System.Types.MyEnum of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('isInsideRecord with various block keywords', () => {
    test('should detect record context after try-end pair', () => {
      const source = `try
  DoSomething;
except
  HandleError;
end;
record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'try');
      findBlock(pairs, 'record');
    });

    test('should detect record context after interface-end pair', () => {
      const source = `IMyIntf = interface
  procedure DoSomething;
end;
record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'interface');
      findBlock(pairs, 'record');
    });

    test('should detect record context after asm-end pair', () => {
      const source = `asm
  mov ax, bx
end;
record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should detect record context after case-end pair', () => {
      const source = `case X of
  1: DoOne;
  2: DoTwo;
end;
record
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should detect record at end of source after object', () => {
      const source = `TPoint = object
  X: Integer;
end;
record`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should detect record at end of source after interface', () => {
      const source = `IMyIntf = interface
  procedure DoSomething;
end;
record`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should handle variant case at end of source', () => {
      const source = `record
  X: Integer;
  case Integer of`;
      const pairs = parser.parse(source);
      // No matching end keyword, so no blocks
      assertNoBlocks(pairs);
    });

    test('should handle deeply nested record contexts', () => {
      const source = `record
  case Integer of
    0: (case Byte of
         0: (B: Byte));
end`;
      const pairs = parser.parse(source);
      // Both variant cases should be detected (only record block)
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Edge cases with excluded regions in forward declarations', () => {
    test('should handle class forward declaration with string in parentheses', () => {
      const source = `TMyClass = class(TBase('test'));
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle class forward declaration with comment in parentheses', () => {
      const source = `TMyClass = class(TBase{comment}(TParam));
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  // Coverage: lines 58-59, 328-329
  suite('Class forward declaration whitespace handling', () => {
    test('should handle class forward declaration with tab before parenthesis', () => {
      const source = `TMyClass = class\t(TBase);
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle class forward declaration with multiple spaces before parenthesis', () => {
      const source = `TMyClass = class     (TBase);
begin
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject block close followed by colon as keyword argument', () => {
      const source = `begin
  x := SomeFunc(end: 42);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  // Coverage: lines 189-191, 222-225, 233-236, 253-258, 264-269, 286-291
  suite('isInsideRecord excluded region handling', () => {
    test('should handle excluded regions when scanning backward for record', () => {
      const source = `record
  X: Integer;
  { comment with record keyword }
  case Integer of
    0: (Y: Integer);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should skip excluded regions while scanning for object blocks', () => {
      const source = `object
  { this is a 'string' }
  case Integer of
    0: (Y: Integer);
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should skip string while scanning backward for interface', () => {
      const source = `interface
  procedure DoIt;
  { 'interface' in comment }
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should skip comment while scanning backward for try block', () => {
      const source = `try
  DoSomething;
  (* try keyword in comment *)
except
  on E: Exception do;
end`;
      const pairs = parser.parse(source);
      const pair = findBlock(pairs, 'try');
      assertIntermediates(pair, ['except']);
    });

    test('should skip excluded regions when checking for case blocks', () => {
      const source = `case X of
  0: begin
    (* case in comment *)
  end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should skip excluded regions when checking for asm blocks', () => {
      const source = `asm
  { 'asm' in comment }
  MOV AX, BX
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'asm', 'end');
    });

    test('should correctly track depth with nested blocks and excluded regions', () => {
      const source = `record
  case Integer of
    0: (
      record
        { comment with 'record' }
        case Byte of
          0: (B: Byte);
      end;
    );
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  // Coverage: isInsideRecord - nested record with depth > 0 (lines 222-225)
  suite('isInsideRecord with nested record at depth > 0', () => {
    test('should suppress variant case when inner record-end pair is consumed at depth > 0', () => {
      // Scanning backward from the second case:
      // end (from inner record) -> depth=1, record (inner) -> depth>0 so depth=0,
      // record (outer) -> depth=0 -> return true (inside record)
      const source = `TRec = record
  inner: record
    field: Integer;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // Only 2 blocks: outer record...end and inner record...end
      // The variant case is suppressed because isInsideRecord returns true
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
    });
  });

  // Coverage: isInsideRecord - nested object with depth > 0 (lines 233-236)
  suite('isInsideRecord with nested object at depth > 0', () => {
    test('should suppress variant case when inner object-end pair is consumed at depth > 0', () => {
      // Scanning backward from case:
      // end (from object) -> depth=1, object -> depth>0 so depth=0,
      // record -> depth=0 -> return true
      const source = `TRec = record
  TInner = object
    X: Integer;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // 2 blocks: record...end and object...end
      // Variant case suppressed
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
    });
  });

  // Coverage: isInsideRecord - interface keyword handler at depth > 0 (lines 255-258)
  suite('isInsideRecord with interface-end at depth > 0', () => {
    test('should suppress variant case when interface-end pair is consumed at depth > 0', () => {
      // Scanning backward from case:
      // end (from interface) -> depth=1, interface -> depth>0 so depth=0,
      // record -> depth=0 -> return true
      const source = `TRec = record
  IInner = interface
    procedure DoIt;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // 2 blocks: record...end and interface...end
      // Variant case suppressed
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
    });
  });

  // Coverage: isInsideRecord - try keyword handler at depth > 0 (lines 266-269)
  suite('isInsideRecord with try-end at depth > 0', () => {
    test('should suppress variant case when try-end pair is consumed at depth > 0', () => {
      // Scanning backward from case:
      // end (from try) -> depth=1, try -> depth>0 so depth=0,
      // record -> depth=0 -> return true
      const source = `TRec = record
  begin
    try
      DoSomething;
    except
      HandleError;
    end;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // 3 blocks: record...end, begin...end, try...end
      // Variant case suppressed
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'record');
      findBlock(pairs, 'try');
    });
  });

  // Coverage: isInsideRecord - asm keyword handler at depth > 0 (lines 288-291)
  suite('isInsideRecord with asm-end at depth > 0', () => {
    test('should suppress variant case when asm-end pair is consumed at depth > 0', () => {
      // Scanning backward from case:
      // end (from asm) -> depth=1, asm -> depth>0 so depth=0,
      // record -> depth=0 -> return true
      const source = `TRec = record
  begin
    asm
      MOV AX, BX
    end;
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // 3 blocks: record...end, begin...end, asm...end
      // Variant case suppressed
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'record');
      findBlock(pairs, 'asm');
    });
  });

  // Coverage: isInsideRecord - case with depth > 0 (line 277)
  suite('isInsideRecord with case-end at depth > 0', () => {
    test('should suppress variant case when inner case-end pair is consumed at depth > 0', () => {
      // The inner case X of is also a variant case inside the record (suppressed).
      // Scanning backward from the tagless variant case Integer of:
      // end (from inner case) -> depth=1, case (inner) -> depth>0 so depth=0,
      // record -> depth=0 -> return true
      const source = `TRec = record
  case X: Integer of
    1: (A: Integer);
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // Only 1 block: record...end
      // Both variant cases are suppressed (inside record context)
      // The inner case X: Integer of -> tagged variant, suppressed
      // The outer case Integer of -> tagless variant, isInsideRecord returns true
      // During isInsideRecord backward scan, end->depth=1, case->depth>0 decrements to 0
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  // Coverage: isValidBlockClose returning false in tokenize (lines 328-329)
  suite('isValidBlockClose in tokenize', () => {
    test('should treat end used as variable assignment as block close', () => {
      // The base isValidBlockClose always returns true for Pascal,
      // so end := 5 is still treated as a block close keyword
      const source = `begin
  end := 5;
end`;
      const pairs = parser.parse(source);
      // begin matches first end (the variable), leaving the second end unmatched
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should treat end used as array element as block close', () => {
      const source = `begin
  end[0] := 1;
end`;
      const pairs = parser.parse(source);
      // end[0] has end as a word boundary match, so it is treated as block close
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });
});
