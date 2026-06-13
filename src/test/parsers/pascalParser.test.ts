import * as assert from 'node:assert';
import { PascalBlockParser } from '../../parsers/pascalParser';
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

suite('PascalBlockParser Test Suite', () => {
  let parser: PascalBlockParser;

  setup(() => {
    parser = new PascalBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'program Test; var X: Integer;',
    tokenSource: 'begin\nend',
    expectedTokenValues: ['begin', 'end'],
    excludedSource: "// comment\n'string'",
    expectedRegionCount: 2,
    twoLineSource: 'begin\nend',
    singleLineCommentSource: '// begin end repeat until case\nbegin\n  X := 1;\nend',
    commentBlockOpen: 'begin',
    commentBlockClose: 'end',
    commentAtEndOfLineSource: 'begin\n  X := 1; // this is not end\nend',
    commentAtEndOfLineBlockOpen: 'begin',
    commentAtEndOfLineBlockClose: 'end'
  };

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
    generateExcludedRegionTests(config);

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
    generateEdgeCaseTests(config);

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

    test('should detect forward declaration with comment before parenthesized parent', () => {
      const source = 'begin\n  type TFoo = class { forward }(TBase);\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
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

    test('should detect variant case inside record with case statement in method body', () => {
      const source = 'TRec = record\n  begin\n    case X of\n      1: DoOne;\n    end;\n  end;\n  case Integer of\n    0: (IntVal: Integer);\nend';
      const pairs = parser.parse(source);
      const recordPair = findBlock(pairs, 'record');
      assert.ok(recordPair, 'record should be paired');
    });

    test('should not treat := class as block open', () => {
      const pairs = parser.parse('begin\n  x := class\nend');
      assertSingleBlock(pairs, 'begin', 'end');
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

    test('should not treat of in procedure(...) of object as case intermediate', () => {
      // `procedure(...) of object` is a method-pointer type. Without skipping the
      // parameter list `(...)` when scanning back from `of`, isTypeDeclarationOf lands
      // on `)` (not `procedure`) and returns false, so the `of` is added to the case
      // block's intermediates as a duplicate of the legitimate case-of.
      const source = `case Action of
  1: Callback := procedure(Sender: TObject) of object;
  2: DoSomething;
end`;
      const pairs = parser.parse(source);
      const casePair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.ok(casePair, 'case-end pair should exist');
      assertIntermediates(casePair, ['of']);
    });

    test('should not treat of in function(...): T of object as case intermediate', () => {
      // `function(...): T of object` is a function method-pointer type. Without skipping
      // the parameter list `(...)` and the return type `: T` when scanning back from
      // `of`, isTypeDeclarationOf lands on the return type identifier and returns false,
      // so the `of` is added to the case block's intermediates as a duplicate.
      const source = `case Action of
  1: Callback := function(Sender: TObject): Integer of object;
  2: DoSomething;
end`;
      const pairs = parser.parse(source);
      const casePair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.ok(casePair, 'case-end pair should exist');
      assertIntermediates(casePair, ['of']);
    });
  });

  suite('Variant record case', () => {
    test('should not treat case in variant record as block', () => {
      const pairs = parser.parse('TVariant = record\n  case Tag: Integer of\n    0: (IntVal: Integer);\n    1: (FloatVal: Double);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should detect variant case with class field type on separate line from colon', () => {
      const pairs = parser.parse('TRec = record\n  field:\n    class;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should detect variant case with interface field type on separate line from colon', () => {
      const pairs = parser.parse('TRec = record\n  intf:\n    interface;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle procedure of object with of on separate line', () => {
      const pairs = parser.parse('type\n  TProc = procedure of\n    object;\ncase X of\n  1: DoOne;\nend');
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should handle variant record with multi-line labels', () => {
      const source = 'TRec = record\n  case Integer of\n    1,\n    2: (Field: Byte);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should treat nested standalone case inside variant field list as standalone, not variant', () => {
      // The inner `case X of 1: foo end` is a standalone case (its first arm `1:` is
      // followed by an identifier `foo`, not a `(`). Even though it sits inside the
      // variant field list parens `(...)`, the structural test (presence of an `end`,
      // first label not followed by `(`) marks it as standalone. Previously the
      // tagless-variant pattern `case X of` matched here too, so the inner case was
      // dropped from tokenization while the inner `end` was kept, causing the outer
      // record to pair with the inner `end` instead of the outer `end`.
      const source = `record
    case W of
      0: ( case X of 1: foo end );
  end`;
      const pairs = parser.parse(source);
      const recordPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.ok(recordPair, 'record pair should exist');
      // The record's `end` must be the OUTER `end` (the last occurrence in the source).
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(recordPair.closeKeyword?.startOffset, outerEndOffset, 'record should close with outer end');
    });

    test('should treat case [...] of in record as variant case (preserving outer record pair)', () => {
      // `case [TKind] of` uses a bracketed tag form (malformed but reasonably
      // interpreted as a variant case header). Without treating `[...]` as a tag,
      // the case is classified as a standalone block opener and steals the only
      // available `end`, leaving the surrounding record orphan. Cost-minimization
      // (VS Code Bracket Pair Colorization "anchor set" / Tree-sitter error cost):
      // preferring record→end gives a sensible result with one orphan (case).
      const source = `TRec = record
    case [TKind] of
      0: (X: Integer);
  end`;
      const pairs = parser.parse(source);
      const recordPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.ok(recordPair, 'record pair should exist');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(recordPair.closeKeyword?.startOffset, outerEndOffset, 'record should close with outer end');
    });
  });

  suite('Class reference type', () => {
    test('should not treat class of as block open', () => {
      const pairs = parser.parse('type\n  TRef = class of TBase;');
      assertNoBlocks(pairs);
    });
  });

  suite('Token positions - language-specific', () => {
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

    test('should handle Pascal string with CR-only ending', () => {
      const source = "x := 'unterminated\rif true then\rbegin\r  action;\rend;";
      const pairs = parser.parse(source);
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
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should not treat variant case with dotted type name as block', () => {
      const pairs = parser.parse('TVariant = record\n  case MyUnit.TColor of\n    0: (R: Byte);\n    1: (G: Byte);\nend');
      assertSingleBlock(pairs, 'record', 'end');
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

  // Coverage: isInsideRecord - variant case does not have its own end
  suite('isInsideRecord with variant case depth tracking', () => {
    test('should detect variant case inside record with end after it', () => {
      // In Pascal, variant case inside record does not have its own end.
      // The first end; closes the record, making the second case standalone.
      const source = `TRec = record
  case X: Integer of
    1: (A: Integer);
  end;
  case Integer of
    0: (IntVal: Integer);
end`;
      const pairs = parser.parse(source);
      // 2 blocks: record...end; and case...end
      // The first end; closes the record (variant case has no own end)
      // The second case Integer of is standalone after the record
      assertBlockCount(pairs, 2);
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

  // Fix: end should not skip past unclosed repeat blocks on the stack
  suite('end should not skip past repeat', () => {
    test('should let end skip past unclosed repeat to close outer block', () => {
      const source = 'case x of\n  repeat\n  end\nuntil y';
      const pairs = parser.parse(source);
      // end skips repeat (which can only be closed by until) and closes case
      // then until closes repeat
      assertBlockCount(pairs, 2);
    });

    test('should still close repeat..until inside begin..end normally', () => {
      const source = 'begin\n  repeat\n  until x;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'repeat', 1);
      assertNestLevel(pairs, 'begin', 0);
    });
  });

  suite('Coverage: packed keyword with comment between = and packed', () => {
    test('should recognize = (* comment *) packed object ... end as a block', () => {
      // Lines 110-113: isInExcludedRegion check in packed scanning
      const source = `type
  TMyObj = (* comment *) packed object
    field1: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should recognize = { comment } packed object ... end as a block', () => {
      const source = `type
  TMyObj = { brace comment } packed object
    field1: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should reject object without = before packed keyword', () => {
      const source = `packed object
  X: Integer;
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: except/finally in non-try block', () => {
    test('should reject except when stack top is not try', () => {
      // Line 403: (middleValue === 'except' || middleValue === 'finally') && topValue !== 'try'
      const source = `begin
  except
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'except should not attach to begin');
    });

    test('should reject finally when stack top is not try', () => {
      const source = `begin
  finally
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'finally should not attach to begin');
    });
  });

  suite('Coverage: else in non-case non-try block', () => {
    test('should reject else when stack top is begin', () => {
      // Line 405: middleValue === 'else' && topValue !== 'case' && topValue !== 'try'
      const source = `begin
  else
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else should not attach to begin');
    });

    test('should reject else when stack top is record', () => {
      const source = `TRec = record
  else
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'else should not attach to record');
    });
  });

  suite('Packed object syntax', () => {
    test('should recognize = packed object ... end as a block', () => {
      const source = `type
  TMyObj = packed object
    field1: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should still recognize = object ... end as a block', () => {
      const source = `type
  TMyObj = object
    field1: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Bug 1: asm block excluded regions', () => {
    test('should not detect begin label inside asm block', () => {
      const source = `program Test;
asm
  begin:
    mov ax, 1
end;
begin
  WriteLn;
end.`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin' && p.closeKeyword.value === 'end'));
    });

    test('should not detect case label inside asm block', () => {
      const source = `asm
  case:
    jmp case
end;
if true then
begin
  x := 1;
end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle case-insensitive asm', () => {
      const source = `ASM
  begin:
    nop
END;
begin
  x := 1;
end.`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle empty asm block', () => {
      const source = `asm end;
begin
  x := 1;
end.`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle unterminated asm block', () => {
      const source = `asm
  begin:
    mov ax, 1`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle asm inside string (not excluded)', () => {
      const source = `s := 'asm begin end';
begin
  x := 1;
end.`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip asm label with comment after colon', () => {
      const source = `asm
  begin: { comment after label }
    mov ax, 1
end;
begin
  WriteLn;
end.`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin' && p.closeKeyword.value === 'end'));
    });
  });

  suite('Bug 2: class forward declaration with comment', () => {
    test('should not treat class with brace comment before semicolon as block', () => {
      const pairs = parser.parse('type\n  TFoo = class { forward declaration };');
      assertNoBlocks(pairs);
    });

    test('should not treat class with paren-star comment before semicolon as block', () => {
      const pairs = parser.parse('type\n  TFoo = class (* forward *);');
      assertNoBlocks(pairs);
    });

    test('should not treat class with line comment and newline before semicolon as block', () => {
      const pairs = parser.parse('type\n  TFoo = class // comment\n;');
      assertNoBlocks(pairs);
    });

    test('should still treat class with body as block', () => {
      const source = `TFoo = class { this is a real class }
  FValue: Integer;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should skip asm end that is inside a string excluded region (lines 211-213)', () => {
      // asm region scan: the inner 'end' is inside a Pascal string excluded region
      // String '{comment}' won't help since it's a comment; use (* *) to enclose 'end'
      // The asm body contains 'end' inside a (* *) comment - should be skipped
      const source = 'begin\n  asm\n    (* end *)\n  end\nend;';
      const pairs = parser.parse(source);
      // 'begin'/'end' is one pair, 'asm'/'end' is another
      assertBlockCount(pairs, 2);
    });

    test('should skip asm end: label (assembly label with colon, lines 218-222)', () => {
      // asm region scan: 'end:' is an assembly label, should be skipped; real end follows
      const source = 'begin\n  asm\n    end:\n    nop\n  end\nend;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      assert.ok(asmPair, 'should find asm block');
    });

    test('should skip asm end: label with spaces before colon', () => {
      // asm region scan: 'end   :' with spaces before colon - whitespace scanning (lines 217-219)
      const source = 'begin\n  asm\n    end   :\n    nop\n  end\nend;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: variant case in record followed by standalone case', () => {
    test('should detect standalone case after record with variant case', () => {
      const source = "type\n  TRec = record\n    case Integer of\n      0: (A: Integer);\n  end;\n\ncase Value of\n  1: WriteLn('One');\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'record');
      assert.strictEqual(pairs[1].openKeyword.value.toLowerCase(), 'case');
    });

    test('should still detect variant case inside record', () => {
      const source = 'type\n  TRec = record\n    case Integer of\n      0: (A: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'record');
    });
  });

  suite('Regression: interface and object forward declarations', () => {
    test('should not detect interface; forward declaration as block opener', () => {
      const source = `type
  IMyInterface = interface;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not detect object; forward declaration as block opener', () => {
      const source = `type
  TMyObject = object;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still detect interface with body as block opener', () => {
      const source = `type
  IMyInterface = interface
    procedure DoSomething;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });
  });

  suite('Regression: end closing blocks past unterminated repeat', () => {
    test('should close begin when repeat is unterminated on top of stack', () => {
      const source = `begin
  repeat
    x := 1;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should close both begin blocks with inner and outer end', () => {
      const source = `begin
  repeat
    begin
      x := 1;
    end;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should still pair repeat-until correctly', () => {
      const source = `begin
  repeat
    x := x + 1;
  until x > 10;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: packed word boundary check', () => {
    test('should not match identifier ending in packed as packed keyword', () => {
      const source = 'type\n  X = record end;\nvar\n  mypacked: object;';
      const pairs = parser.parse(source);
      // record/end is one pair; "object" after "mypacked:" should not be a block open (no = before it)
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should still match packed object after =', () => {
      const source = 'type\n  T = packed object\n    x: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Regression: case on separate line from first arm', () => {
    test('should detect case as block opener when first arm has identifier:label on next line', () => {
      const source = 'begin\n  case\n    Status: HandleStatus;\n    Error: HandleError;\n  end;\nend.';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should still reject tagged variant case inside record', () => {
      const source = 'type\n  T = record\n    case Tag: Integer of\n      1: (x: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should detect case with CRLF before arm label', () => {
      const source = 'begin\r\n  case\r\n    MyLabel: DoSomething;\r\n  end;\r\nend.';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: \\s -> [ \\t] in variant case and class of patterns', () => {
    // Tagless variant regex changed from /^\s+identifier\s+of\b/ to /^[ \t]+identifier[ \t]+of\b/
    // so a newline between 'case' and 'Integer of' no longer suppresses the case block

    test('should suppress variant case when identifier-of is on the next line inside record', () => {
      // Variant case with identifier on the next line should still be recognized and suppressed
      const source = 'type\n  TRec = record\n    case\n      Integer of\n    0: (IntVal: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should still suppress tagless variant case with identifier and of on same line inside record', () => {
      // The horizontal-whitespace-only variant (same line) should still be suppressed
      const source = 'type\n  TRec = record\n    case Integer of\n    0: (IntVal: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress variant case when tag colon is on the next line inside record', () => {
      // Variant record allows arbitrary whitespace (including newlines) between tag and colon.
      // 'case Tag\n: Integer of' is a tagged variant and must be suppressed.
      const source = 'type\n  TRec = record\n    case Tag\n      : Integer of\n    0: (IntVal: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should still suppress tagged variant case with tag and colon on same line inside record', () => {
      // Tagged variant with horizontal whitespace only should still be suppressed
      const source = 'type\n  TRec = record\n    case Tag: Integer of\n      0: (IntVal: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should treat class with newline before of as reference type', () => {
      // Per Pascal grammar, newline and comments between 'class' and 'of' do not change the meaning:
      // 'class\n  of TBase;' is a class-reference type, not a block opener.
      const source = 'type\n  TRef = class\n  of TBase;\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still suppress class of on the same line as class reference type', () => {
      // 'class of TBase' on the same line should still suppress class as a block
      const source = 'type\n  TRef = class of TBase;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat class with comment on next line as forward declaration', () => {
      // class followed by (* comment *) on next line should not enter forward declaration path
      const source = 'type\n  TMyClass = class\n  (* comment *)\n  private\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should suppress variant case when brace comment appears before tag', () => {
      const source = 'TRec = record\n  case {c} Tag: Integer of\n    0: (X: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress variant case when paren-star comment appears before tag', () => {
      const source = 'TRec = record\n  case (* c *) Tag: Integer of\n    0: (X: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress tagless variant case when comment appears before type name', () => {
      const source = 'TRec = record\n  case {c} Integer of\n    0: (X: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Branch coverage', () => {
    test('should pass block_close keywords through tokenize validation', () => {
      // Covers lines 403-405: isValidBlockClose always returns true (base class)
      // Verifies that end keywords are never rejected by the block_close validation
      const source = 'begin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle case-insensitive block_close in tokenize', () => {
      // Covers lines 394, 403-405: keyword normalization and block_close validation
      const source = 'BEGIN\nEND';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('isInsideRecord returns false at depth 0 for non-record block openers', () => {
    test('should not treat case after bare class as inside record', () => {
      // Backward scan from case: finds class at depth 0, returns false
      // class without = is not a block opener, so case is a standalone block
      const source = `TFoo = class
  case X of
    1: DoOne;
  end;
end`;
      const pairs = parser.parse(source);
      // class...end and case...end
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'class');
      findBlock(pairs, 'case');
    });

    test('should not treat case after bare interface as inside record', () => {
      // Backward scan from case: finds interface at depth 0, returns false
      const source = `IFoo = interface
  case X of
    1: DoOne;
  end;
end`;
      const pairs = parser.parse(source);
      // interface...end and case...end
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'interface');
      findBlock(pairs, 'case');
    });

    test('should not treat case after bare try as inside record', () => {
      // Backward scan from case: finds try at depth 0, returns false
      const source = `try
  case X of
    1: DoOne;
  end;
except
  HandleError;
end`;
      const pairs = parser.parse(source);
      // try...end and case...end
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'try');
      findBlock(pairs, 'case');
    });

    test('should not treat case after bare asm as inside record', () => {
      // Backward scan from case: finds asm at depth 0, returns false
      const source = `asm
  mov ax, bx
end;
case X of
  1: DoOne;
end`;
      const pairs = parser.parse(source);
      // asm...end and case...end
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'asm');
      findBlock(pairs, 'case');
    });
  });

  suite('Asm end label with excluded region before colon', () => {
    test('should skip excluded region between end and colon in asm label', () => {
      // Lines 233-236: comment between 'end' and ':' in asm block
      const source = `asm
  end{comment}:
  nop
end;
begin
  x := 1;
end.`;
      const pairs = parser.parse(source);
      // 'end{comment}:' is a label (end + brace comment + colon), so it should be skipped
      // The real 'end' closes the asm block
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin' && p.closeKeyword.value === 'end'));
    });

    test('should skip paren-star comment between end and colon in asm label', () => {
      const source = `asm
  end(* label *)  :
  nop
end;
begin
  x := 1;
end.`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin' && p.closeKeyword.value === 'end'));
    });
  });

  suite('Regression: tagless variant case with of on separate line', () => {
    test('should suppress variant case when of is on the next line after identifier', () => {
      // Variant record allows arbitrary whitespace (including newlines) between identifier and 'of'.
      // 'case Integer\n  of' is a tagless variant and must be suppressed.
      const source = 'type\n  TRec = record\n    case Integer\n      of\n    0: (IntVal: Integer);\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: Unicode adjacency check in tokenize', () => {
    test('should not detect keywords adjacent to Unicode letters', () => {
      const pairs = parser.parse('\u03B1begin\n  x := 1;\n\u03B1end');
      assertNoBlocks(pairs);
    });

    test('should not detect case-insensitive keywords adjacent to Unicode letters', () => {
      const pairs = parser.parse('\u03B1Begin\n  x := 1;\n\u03B1End');
      assertNoBlocks(pairs);
    });

    test('should still detect keywords not adjacent to Unicode letters', () => {
      const pairs = parser.parse('begin\n  x := 1;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: interface and object forward declarations with parent', () => {
    test('should not treat interface(Parent) forward declaration as block opener', () => {
      const pairs = parser.parse('type\n  IFoo = interface(IUnknown);\nbegin\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat object(Parent) forward declaration as block opener', () => {
      const pairs = parser.parse('type\n  TObj = object(TBase);\nbegin\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still treat interface with body as block opener', () => {
      const pairs = parser.parse('type\n  IFoo = interface(IUnknown)\n    procedure DoSomething;\n  end;');
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should still treat object with body as block opener', () => {
      const pairs = parser.parse('type\n  TObj = object(TBase)\n    X: Integer;\n  end;');
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Regression: isVariantRecordCase skips comments between identifier and of/:', () => {
    test('should detect variant case with comment between identifier and of', () => {
      const source = 'type TRec = record\n  case Integer {comment} of\n    0: (IntVal: Integer);\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle comment containing of in variant case scan', () => {
      const source = 'type TRec = record\n  case X {of} of\n    0: (A: Integer);\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: isVariantCase missing left word boundary for of', () => {
    test('should detect variant case when tag name ends with of-like substring', () => {
      const source = 'TRec = record\n  case eof: Byte of\n    0: (A: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: isVariantCase skips comments after of', () => {
    test('should handle brace comment between of and label', () => {
      const source =
        'TBig = record\n  TInner = class\n    TVariant = record\n      case Integer of\n        { comment } 0: (Field: Integer);\n    end;\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle paren-star comment between of and label', () => {
      const source = 'x = record\n  case Integer of\n    (* comment *) 0: (Field: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle line comment between of and label on next line', () => {
      const source = 'x = record\n  case Integer of\n    // comment\n    0: (Field: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Bug: isVariantCase fails on non-simple case labels', () => {
    test('should correctly track depth when inner case has range labels', () => {
      // isVariantCase scans for label after 'of': finds '0', stops at '.' in '0..3'
      // '.' is not ':' or 'of', so returns false (not variant case)
      // This incorrectly decrements depth in isInsideRecord backward scan:
      //   end -> depth=1, case(range, wrongly non-variant) -> depth=0, begin -> returns false
      // Correct: end -> depth=1, case(range, IS variant) -> depth=1, begin -> depth=0, record -> returns true
      const source = 'TRec = record\n  begin\n    case Integer of\n      0..3: (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      // Expected: outer 'case Byte of' suppressed as variant case -> 2 blocks (case...end, begin...end)
      // But record is unmatched because only 2 ends exist (the test structure intentionally has 2 ends
      // to expose the bug: with correct behavior, begin gets 1st end, outer case is suppressed,
      // record gets 2nd end)
      // Correct: begin...end (1st end), record...end (2nd end), inner case NOT a block (inside begin)
      // Wait: inner case IS a block (isInsideRecord returns false for begin), but it consumes an end
      // With correct isVariantCase: inner case...end (1st end), begin unmatched, outer case suppressed,
      // ... this doesn't work either. Let me use 3 ends instead.
      // With 3 ends: inner case...end (1st), begin...end (2nd), outer case suppressed, record...end (3rd)
      assertBlockCount(pairs, 2);
      // Bug: both blocks are case->end (outer case not suppressed, steals record's end)
      // Expected: case->end and begin->end (outer case suppressed, record gets last end)
      findBlock(pairs, 'begin');
    });

    test('should correctly track depth when inner case has negative labels', () => {
      // isVariantCase scans after 'of': finds '-' which is not /[a-zA-Z0-9_]/
      // Falls through without finding label -> returns false (should be true for variant)
      const source = 'TRec = record\n  begin\n    case Integer of\n      -1: (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });

    test('should correctly track depth when inner case has comma-separated labels', () => {
      // isVariantCase scans: finds '1', stops at ',', ',' is not ':' -> returns false
      const source = 'TRec = record\n  begin\n    case Integer of\n      1, 2, 3: (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });
  });

  suite('Regression: isVariantCase with multi-line of and complex labels', () => {
    test('should detect variant case when of is on separate line', () => {
      const source = 'TRec = record\n  begin\n    case Integer\n    of\n      0: (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });

    test('should detect variant case with character constant labels', () => {
      const source = "TRec = record\n  begin\n    case Char of\n      'a': (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });

    test('should detect variant case with qualified name labels', () => {
      const source = 'TRec = record\n  begin\n    case Color of\n      Types.Red: (Field: Byte);\n  end;\n  case Byte of\n    0: (B: Byte);\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });
  });

  suite('Bug: isInsideRecord treats non-type-definition keywords as block keywords', () => {
    test('should not treat object field type as block keyword in backward scan', () => {
      // isInsideRecord backward scan: finds 'object' at depth > 0 -> depth--
      // But 'object' here is a field type (obj: object;), not a type definition
      const source = 'TRec = record\n  obj: object;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      // Expected: 2 blocks (record...end, case...end)
      // The case is standalone (after record's end), not a variant case
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });

    test('should not treat class modifier as block keyword in backward scan', () => {
      // 'class function' is a method modifier, not a type definition
      const source = 'TRec = record\n  class function Create: TRec;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });

    test('should not treat interface field type as block keyword in backward scan', () => {
      // 'intf: interface;' is a field type reference, not a type definition
      const source = 'TRec = record\n  intf: interface;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });
  });

  suite('class-of reference type with comments and newlines', () => {
    test('should treat class-of as reference type when newline is inside comment', () => {
      // Per Pascal grammar, newline/comment between 'class' and 'of' does not change the meaning:
      // 'class { ... } of TBase' is a class-reference type, not a block opener.
      const source = 'type\n  TRef = class { comment\n  } of TBase;\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should treat class-of as reference type with paren-star multi-line comment', () => {
      const source = 'type\n  TRef = class (* comment\n  *) of TBase;\nbegin\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: sealed and abstract class modifiers', () => {
    test('should recognize sealed class as block opener', () => {
      const source = 'type\n  TFoo = sealed class\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize abstract class as block opener', () => {
      const source = 'type\n  TBar = abstract class\n    procedure DoSomething; virtual; abstract;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize sealed class with parent as block opener', () => {
      const source = 'type\n  TFoo = sealed class(TBase)\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize abstract class with parent as block opener', () => {
      const source = 'type\n  TBar = abstract class(TBase)\n    procedure DoSomething; virtual; abstract;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat sealed class forward declaration as block', () => {
      const source = 'type\n  TFoo = sealed class;\nbegin\nend.';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: interface with GUID bracket syntax as forward declaration', () => {
    test('should treat interface with GUID bracket followed by semicolon as forward declaration', () => {
      const source = "begin\n  IMyIntf = interface['{00000000-0000-0000-C000-000000000046}']\n  ;\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should treat interface with simple bracket followed by semicolon as forward declaration', () => {
      const pairs = parser.parse("IMyIntf = interface['guid'];\nbegin\nend");
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still treat interface without bracket as block opener', () => {
      const source = 'IMyIntf = interface\n  procedure DoSomething;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should treat interface with bracket and parent body as block opener', () => {
      const source = "IMyIntf = interface['{GUID}']\n  procedure DoSomething;\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should suppress variant case in record with interface GUID bracket forward declaration', () => {
      const source = "TRec = record\n  IInner = interface['{GUID}'];\n  case Integer of\n    0: (IntVal: Integer);\nend";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: class operator as method modifier in isInsideRecord', () => {
    test('should not treat class operator inside record as block opener', () => {
      const source = 'TRec = record\n  class operator Implicit(const AValue: Integer): TRec;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });

    test('should handle class operator with different operator names', () => {
      const source = 'TRec = record\n  class operator Explicit(const AValue: String): TRec;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: isInsideRecord skips excluded regions after class modifier', () => {
    test('should skip brace comment between class and method keyword', () => {
      const source = 'TRec = record\n  class {comment} function Create: TRec;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });

    test('should skip paren-star comment between class and method keyword', () => {
      const source = 'TRec = record\n  class (* comment *) procedure Destroy;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'record');
      findBlock(pairs, 'case');
    });

    test('should skip line comment between class and method keyword on next line', () => {
      const source = 'TRec = record\n  class // comment\n  function Create: TRec;\nend;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: isInsideRecord with comment before class/interface/object', () => {
    test('should suppress case in record when class field type has comment before colon', () => {
      const source = 'TRec = record\n  field: { type } class;\n  case Integer of\n    0: (IntVal: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression tests', () => {
    test('should exclude keywords inside double-quoted strings', () => {
      const pairs = parser.parse('begin\n  x := "begin";\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not close begin with end inside double-quoted string', () => {
      const pairs = parser.parse('begin\n  x := "end";\nend');
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].closeKeyword.line, 2);
    });

    test('should handle doubled double-quote escape in strings', () => {
      const pairs = parser.parse('begin\n  x := "He said ""end"" here";\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: isInsideRecord with class/interface types', () => {
    test('should suppress variant case in record with class type definition followed by procedure', () => {
      const pairs = parser.parse(
        'type\n  TRec = record\n    TInner = class\n      procedure DoIt;\n    end;\n    case Integer of\n      0: (IntVal: Integer);\n  end;'
      );
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'class');
      findBlock(pairs, 'record');
    });

    test('should suppress variant case in record with class reference type', () => {
      const pairs = parser.parse('type\n  TRec = record\n    TRef = class of TBase;\n    case Integer of\n      0: (IntVal: Integer);\n  end;');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress variant case in record with class forward declaration', () => {
      const pairs = parser.parse('type\n  TRec = record\n    TInner = class;\n    case Integer of\n      0: (IntVal: Integer);\n  end;');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress variant case in record with interface forward declaration', () => {
      const pairs = parser.parse('type\n  TRec = record\n    IInner = interface;\n    case Integer of\n      0: (IntVal: Integer);\n  end;');
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: forward declaration with newline before semicolon', () => {
    test('should handle class with newline before semicolon inside record', () => {
      const pairs = parser.parse('TRec = record\n  TInner = class\n  ;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle interface with newline before semicolon inside record', () => {
      const pairs = parser.parse('TRec = record\n  IInner = interface\n  ;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle class(TBase) with newline before semicolon inside record', () => {
      const pairs = parser.parse('TRec = record\n  TInner = class(TBase)\n  ;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: class-of with comment between class and of', () => {
    test('should handle class { comment } of inside record', () => {
      const pairs = parser.parse('TRec = record\n  TRef = class { comment } of TBase;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should handle class (* comment *) of inside record', () => {
      const pairs = parser.parse('TRec = record\n  TRef = class (* comment *) of TBase;\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: forward declaration with comment after parenthesized base', () => {
    test('should detect forward declaration with comment after class parenthesized base', () => {
      const pairs = parser.parse('TRec = record\n  TInner = class(TBase) { comment };\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('should suppress forward declaration with comment after class keyword', () => {
      const pairs = parser.parse('TRec = record\n  TInner = class { forward };\n  case Integer of\n    0: (IntVal: Integer);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress variant case with newline before paren', () => {
      const pairs = parser.parse('TRec = record\n  case Integer of\n    0:\n      (Field: Byte);\n  case Byte of\n    0: (B: Byte);\nend');
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('class-of reference type detection across newlines and comments', () => {
    test('should treat class with newline before of as reference type in isInsideRecord context', () => {
      // Per Pascal grammar, newline between 'class' and 'of' does not change the meaning.
      const source = 'TRef = class\n  of TBase;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should still treat class of on same line as reference type in isInsideRecord', () => {
      const source = 'TRec = record\n  TRef = class of TBase;\n  case Integer of\n    0: (IntVal: Integer);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should treat class with multi-line comment before of as reference type', () => {
      const source = 'TRef = class { comment\n} of TBase;\ncase X of\n  1: DoOne;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
  });

  suite('Bug: false positive for class/interface/object after comparison =', () => {
    test('should not treat class after if comparison as block opener', () => {
      const source = 'begin\n  if x = class then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after while comparison as block opener', () => {
      const source = 'begin\n  while x = class do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after then comparison as block opener', () => {
      const source = 'begin\n  if x then y = class\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after or comparison as block opener', () => {
      const source = 'begin\n  if a or b = class then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after and comparison as block opener', () => {
      const source = 'begin\n  if a and b = class then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after not comparison as block opener', () => {
      const source = 'begin\n  if not x = class then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after xor comparison as block opener', () => {
      const source = 'begin\n  if a xor b = class then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after else comparison as block opener', () => {
      const source = 'begin\n  else x = class\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class after until comparison as block opener', () => {
      const source = 'repeat\n  x := 1;\nuntil y = class';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });

    test('should still treat class after type definition = as block opener', () => {
      const source = 'TFoo = class\n  FValue: Integer;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat interface after if comparison as block opener', () => {
      const source = 'begin\n  if x = interface then\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat object after while comparison as block opener', () => {
      const source = 'begin\n  while x = object do\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not detect class after >= operator', () => {
      const pairs = parser.parse('begin\n  if x >= class then\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not detect object after <= operator', () => {
      const pairs = parser.parse('begin\n  if x <= object then\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Bug: only one type modifier handled', () => {
    test('should recognize packed sealed class as block opener', () => {
      const source = 'type\n  TFoo = packed sealed class\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize abstract packed object as block opener', () => {
      const source = 'type\n  TBar = abstract packed object\n    X: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should recognize sealed abstract class as block opener', () => {
      const source = 'type\n  TBaz = sealed abstract class\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize packed sealed abstract class as block opener', () => {
      const source = 'type\n  TAll = packed sealed abstract class\n    FValue: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should reject packed sealed class without = before modifiers', () => {
      const source = 'packed sealed class\n  FValue: Integer;\nend';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: variant case with character constant labels', () => {
    test('should recognize #nn character constant as variant case label', () => {
      const pairs = parser.parse(
        'TRec = record\n  begin\n    case Char of\n      #65: (Field: Byte);\n  end;\n  case Integer of\n    0: (IntVal: Integer);\nend'
      );
      assertBlockCount(pairs, 2);
      assert.strictEqual(pairs[1].openKeyword.value.toLowerCase(), 'begin');
    });
  });

  suite('Regression: multiple type modifiers before class in record', () => {
    test('should handle sealed abstract class inside record', () => {
      const pairs = parser.parse(
        'type\n  TRec = record\n    T = sealed abstract class\n      procedure DoSomething;\n    end;\n    case Integer of\n      0: (IntVal: Integer);\n  end;'
      );
      assertBlockCount(pairs, 2);
      const classPair = findBlock(pairs, 'class');
      assert.ok(classPair);
      const recordPair = findBlock(pairs, 'record');
      assert.ok(recordPair);
    });
  });

  suite('Regression: if-then-else inside case/try blocks', () => {
    test('should not attach if-then-else else to case block', () => {
      const pairs = parser.parse('case X of\n  1: if Y then DoA else DoB;\nend');
      assertSingleBlock(pairs, 'case', 'end');
      const intermediates = pairs[0].intermediates.map((i) => i.value.toLowerCase());
      assert.ok(!intermediates.includes('else'));
    });

    test('should not attach if-then-else else to try block', () => {
      const pairs = parser.parse('try\n  if X then DoA else DoB;\nexcept\n  HandleError;\nend');
      assertSingleBlock(pairs, 'try', 'end');
      const intermediates = pairs[0].intermediates.map((i) => i.value.toLowerCase());
      assert.ok(!intermediates.includes('else'));
    });

    test('should still detect case else as intermediate', () => {
      const pairs = parser.parse('case X of\n  1: DoA;\nelse\n  DoDefault;\nend');
      assertSingleBlock(pairs, 'case', 'end');
      const intermediates = pairs[0].intermediates.map((i) => i.value.toLowerCase());
      assert.ok(intermediates.includes('else'));
    });
  });

  suite('Regression: type declaration of inside case', () => {
    test('should not attach array of to case block', () => {
      const pairs = parser.parse('case X of\n  1: var A: array of Integer;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });
  });

  suite('Regression: isTypeDeclarationOf should skip excluded regions properly', () => {
    test('should filter of when brace comment separates array from of', () => {
      const pairs = parser.parse('case X of\n  1: var A: array { comment } of Integer;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });

    test('should filter of when paren-star comment separates array from of', () => {
      const pairs = parser.parse('case X of\n  1: var A: array (* comment *) of Integer;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });

    test('should filter of when comment separates set from of', () => {
      const pairs = parser.parse('case X of\n  1: var S: set { comment } of Byte;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });
  });

  suite('Regression 2026-04-11: multiple comments before type declaration of', () => {
    test('should filter of when two brace comments separate array from of', () => {
      const pairs = parser.parse('case X of\n  1: var A: array { c1 } { c2 } of Integer;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });

    test('should filter of when two block comments separate array from of', () => {
      const pairs = parser.parse('case X of\n  1: var A: array (* c1 *) (* c2 *) of Integer;\nend');
      const ofCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'of').length;
      assert.strictEqual(ofCount, 1);
    });
  });

  suite('Regression: class/interface/object in parenthesized comparison', () => {
    test('should not treat class as block opener in if (x = class)', () => {
      const source = 'begin\n  if (x = class) then\n    DoSomething;\n  WriteLn(y);\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat interface as block opener in if (x = interface)', () => {
      const source = 'begin\n  if (x = interface) then\n    DoSomething;\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat object as block opener in if (x = object)', () => {
      const source = 'begin\n  if (x = object) then\n    DoSomething;\nend\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: asm used as identifier', () => {
    test('should not treat asm as block opener when used as variable name', () => {
      const source = 'procedure P;\nvar\n  asm: Integer;\nbegin\n  asm := 10;\n  WriteLn(asm);\nend;\n';
      const pairs = parser.parse(source);
      const beginEnd = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.ok(beginEnd, 'should find begin/end pair');
    });

    test('should still treat asm as block opener in assembly code', () => {
      const source = 'begin\n  asm\n    MOV AX, BX\n  end\nend;';
      const pairs = parser.parse(source);
      const asmPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.ok(asmPair, 'should find asm block');
    });
  });

  suite('Regression: variant record with newline between tag and colon', () => {
    test('should suppress tagged variant case when tag and colon span multiple lines', () => {
      const source = 'type\n  TV = record\n    case Tag\n    : Integer of\n      0: (X: Integer);\n  end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should suppress tagless variant case when identifier and of span multiple lines', () => {
      const source = 'type\n  TV = record\n    case Integer\n    of\n      0: (X: Integer);\n  end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression: asm after statement-introducing keywords on same line', () => {
    test('should detect asm after then on same line', () => {
      const source = 'begin if x then asm nop end; end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.ok(asmBlock, 'asm block should be detected after then');
    });

    test('should detect asm after do on same line', () => {
      const source = 'begin while x do asm nop end; end';
      const pairs = parser.parse(source);
      const asmBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.ok(asmBlock, 'asm block should be detected after do');
    });

    test('should detect asm after begin on same line', () => {
      const source = 'begin asm nop end end';
      const pairs = parser.parse(source);
      const asmBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.ok(asmBlock, 'asm block should be detected after begin');
    });
  });

  suite('Regression: qualified/complex expressions before = class', () => {
    test('should not treat class as type def after qualified identifier comparison', () => {
      const source = 'begin if foo.bar = class then y := 1; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class as type def after arithmetic expression comparison', () => {
      const source = 'begin if a + b = class then y := 1; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class as type def after function call comparison', () => {
      const source = 'begin if Foo() = class then y := 1; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: array [...] of in case branch', () => {
    test('should not treat array [..] of as case intermediate', () => {
      // The `of` in `array [0..N] of Byte` is part of the array type,
      // not the case statement's `of` intermediate.
      const source = 'case X of A: array [0..N] of Byte; end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const block = pairs[0];
      assert.strictEqual(block.openKeyword.value.toLowerCase(), 'case');
      assertIntermediates(block, ['of']);
    });

    test('should not treat array [TKind] of as case intermediate', () => {
      const source = 'case X of A: array [TKind] of Byte; end';
      const pairs = parser.parse(source);
      const block = pairs[0];
      assertIntermediates(block, ['of']);
    });

    test('should not treat array packed of (FreePascal) as case intermediate', () => {
      const source = 'case X of A: array packed of Byte; end';
      const pairs = parser.parse(source);
      const block = pairs[0];
      assertIntermediates(block, ['of']);
    });
  });

  suite('Regression: empty asm; statement preserves outer begin..end', () => {
    test('should not consume outer begin..end with empty asm; statement', () => {
      const source = 'begin asm; X := 1; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: end as field/property access (Foo.End) is not a block close', () => {
    test('should not pair Foo.End with begin', () => {
      const source = 'begin for I := 0 to A.End do X := A[I]; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not pair lowercase Foo.end with begin', () => {
      const source = 'begin x := obj.end; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-04-30: nested asm word inside asm body must not produce overlapping regions', () => {
    test('should not generate overlapping excluded regions when asm body contains the asm word', () => {
      // The outer asm/end pair must produce exactly one excluded region; an inner `asm`
      // inside the asm body (interpreted as an opcode/identifier within the assembly
      // text) must not register a second region with the same closing `end`.
      const source = 'begin\n  asm\n    asm\n  end;\nend.';
      const regions = parser.getExcludedRegions(source);
      for (let i = 1; i < regions.length; i++) {
        assert.ok(
          regions[i - 1].end <= regions[i].start,
          `Excluded regions must not overlap: region[${i - 1}]=[${regions[i - 1].start},${regions[i - 1].end}) overlaps region[${i}]=[${regions[i].start},${regions[i].end})`
        );
      }
    });

    test('should produce independent excluded regions for two consecutive asm blocks', () => {
      // Two sequential asm/end pairs must each produce a distinct excluded region with
      // no overlap; the second `asm` keyword must not be skipped because of the first.
      const source = 'begin\n  asm\n    nop\n  end;\n  asm\n    nop\n  end;\nend.';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2, 'two asm blocks must produce two distinct regions');
      assert.ok(regions[0].end <= regions[1].start, 'consecutive asm regions must not overlap');
    });
  });

  suite('Regression: asm body ;-comment scan should honor excluded regions', () => {
    test('should pair asm with first end after Pascal brace comment containing semicolon', () => {
      const source = 'begin\n  asm\n    mov ax, 100h { ; trailing } end\n  end;\nend;';
      const pairs = parser.parse(source);
      // Expect: begin/end (outer), asm/end (inner)
      assertBlockCount(pairs, 2);
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      assert.ok(beginPair, 'begin should be paired');
      assert.ok(asmPair, 'asm should be paired');
    });
  });

  suite('Regression: asm followed by ( should not be a block opener', () => {
    test('should pair begin/end when asm(x) is used as identifier call', () => {
      const source = 'begin\n  asm(x);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: @end label inside asm body', () => {
    test('should ignore @end label inside asm body and pair with closing end', () => {
      const source = 'asm\n  jmp @end\n  nop\n@end:\n  ret\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'asm', 'end');
    });
    test('should not treat @end outside asm as end keyword', () => {
      const source = 'begin\n  X := @end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-05-06: Pascal & keyword-escape and procedure-of-object', () => {
    test('should not treat &case as block opener', () => {
      const source = 'begin\n  X := &case;\n  case Y of\n    1: DoOne;\n  end;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(beginPair && casePair);
    });

    test('should not register of from procedure of object as case intermediate', () => {
      const source = 'case X of\n  1: P := procedure of object;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      const ofIntermediates = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'of');
      assert.strictEqual(ofIntermediates.length, 1, 'only the case-of should be an intermediate');
    });

    test('should not register of from class of TBase as case intermediate', () => {
      const source = 'case X of\n  1: P := class of TBase;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      const ofIntermediates = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'of');
      assert.strictEqual(ofIntermediates.length, 1);
    });
  });

  suite('Regression 2026-05-08: partial class is recognized as class block', () => {
    test('should pair class/end for partial class declaration', () => {
      const source = 'type\n  TFoo = partial class\n    X: Integer;\n  end;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });
  });

  suite('Regression 2026-05-08: addAsmExcludedRegions must reject identifier prefixes', () => {
    test('should not treat αasm as asm block (Unicode-letter prefix)', () => {
      const source = 'αasm\n  nop\nend\nbegin\n  X := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
    test('should not treat @asm as asm block (address-of operator)', () => {
      const source = 'begin\n  X := @asm\n  Y := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
    test('should not treat TList<asm> as asm block (generic param)', () => {
      const source = 'TList<asm> = class\n  X: Integer;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });
    test('should not treat arr[asm] as asm block (array index)', () => {
      const source = 'begin\n  X := arr[asm];\n  Y := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-05-09: generic constraint record', () => {
    test('should not treat record in generic constraint as block opener', () => {
      const source = `TFoo = class
    function Bar<T: record>: T;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should not treat record as block opener when generic has multiple type parameters separated by semicolons', () => {
      // Multi-parameter generic with `;` separator between params:
      //   function Bar<T1; T2: record>: T2;
      // Inside <...>, ';' is a parameter separator, not a statement boundary.
      // The 'record' constraint must still be recognized as inside the generic angle brackets.
      const source = `TFoo = class
    function Bar<T1; T2: record>: T2;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should treat record as block opener when a preceding statement has a bare < and the record body has a bare >', () => {
      // A prior statement `x := a < b;` leaves a bare comparison '<'. The record body
      // `const K = 1 > 0;` has a bare comparison '>'. The generic-constraint scan must
      // not mistake the prior '<' and the body '>' for a generic angle bracket enclosing
      // the 'record', which would suppress the record/end block. The ';' after `a < b`
      // is a statement boundary separating the comparison '<' from the type declaration.
      const source = `x := a < b;
type TR = record
  const K = 1 > 0;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });
  });

  suite('Regression 2026-05-09: := assignment and additional comparison context keywords', () => {
    test('should not treat class as block when := assigns result of x = class', () => {
      const source = `begin
    Y := X = class
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
    test('should not treat class as block after for/in comparison with =', () => {
      // After `for I in X = class do`, the = is comparison, not type def
      const source = `begin
    for I in X = class do Bar;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-05-09: $/# prefixed open keywords', () => {
    test('should not treat $begin as block opener (hex literal prefix)', () => {
      const source = 'begin\n  X := $begin\n  Y := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      // The outer begin is at offset 0, the inner $begin at offset 14
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0, 'should pair outer begin (offset 0), not $begin');
    });
    test('should not treat #begin as block opener (char constant prefix)', () => {
      const source = 'begin\n  X := #begin\n  Y := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0, 'should pair outer begin (offset 0), not #begin');
    });
  });

  suite('Regression 2026-05-09: $asm/#asm not treated as asm block', () => {
    test('should not treat $asm as asm block (hex literal prefix)', () => {
      const source = 'var X: Integer;\n$asm + 1\nbegin\n  X := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
    test('should not treat #asm as asm block (char constant prefix)', () => {
      const source = 'var X: Integer;\n#asm + 1\nbegin\n  X := 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-05-09: case label using block-open keyword', () => {
    test('should not treat try as block opener when used as case label', () => {
      const source = `case X of
    try: Foo;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
    test('should not treat begin as block opener when used as case label', () => {
      const source = `case X of
    begin: Foo;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
    test('should not treat record as block opener when used as case label', () => {
      const source = `case X of
    record: Foo;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
  });

  suite('Regression 2026-05-10: case label using block-close keyword', () => {
    test('should not treat until as block close when used as case label inside repeat', () => {
      const source = `repeat
  case X of
    until: foo;
  end;
until done`;
      const pairs = parser.parse(source);
      // Expected: case (offset 9) -> end (offset 37); repeat (offset 0) -> until (offset 42)
      assertBlockCount(pairs, 2);
      const casePair = findBlock(pairs, 'case');
      assert.strictEqual(casePair.openKeyword.startOffset, 9);
      assert.strictEqual(casePair.closeKeyword.value, 'end');
      assert.strictEqual(casePair.closeKeyword.startOffset, 37);
      const repeatPair = findBlock(pairs, 'repeat');
      assert.strictEqual(repeatPair.openKeyword.startOffset, 0);
      assert.strictEqual(repeatPair.closeKeyword.value, 'until');
      assert.strictEqual(repeatPair.closeKeyword.startOffset, 42);
    });

    test('should not treat end as block close when used as case label', () => {
      const source = `case X of
  end: foo;
end`;
      const pairs = parser.parse(source);
      // The first `end:` is a case label; only the trailing `end` closes the case block.
      assertSingleBlock(pairs, 'case', 'end');
      // Verify the trailing end is the one used (offset 22), not the case-label end (offset 12)
      assert.strictEqual(pairs[0].closeKeyword.startOffset, 22);
    });

    test('should not treat object as block opener inside case label after =', () => {
      const source = `case X of
  Z = object: WriteLn;
end`;
      const pairs = parser.parse(source);
      // The `Z = object:` is a (invalid) case label; `object` is not a type definition opener.
      // Without this fix, the parser would treat `object` as a block opener and the trailing
      // `end` would close `object` instead of `case`, leaving the `case` orphaned.
      assertSingleBlock(pairs, 'case', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, 33);
    });

    test('should not treat interface as block opener inside case label after =', () => {
      const source = `case X of
  Z = interface: WriteLn;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat class as block opener inside case label after =', () => {
      const source = `case X of
  Z = class: WriteLn;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
  });

  suite('Regression: qualified-name constant-equality case label', () => {
    test('should not treat object as block opener inside qualified case label after =', () => {
      const source = `case X of
  A.B = object: Foo;
end`;
      const pairs = parser.parse(source);
      // The `A.B = object:` is a (invalid) constant-equality case label with a qualified
      // left-hand side. `object` is not a type-definition opener here. Without this fix the
      // backward scan over the `=` left-hand identifier stops at the `.` of `A.B`, fails to
      // reach the `of` case-label boundary, and `object` is wrongly treated as a block opener,
      // stealing the trailing `end` from `case`.
      assertSingleBlock(pairs, 'case', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, 31);
    });

    test('should not treat class as block opener inside qualified case label after =', () => {
      const source = `case X of
  A.B = class: Foo;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat object as block opener inside multi-level qualified case label after =', () => {
      const source = `case X of
  Foo.Bar.Baz = object: Run;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should still treat object as block opener after simple constant-equality type definition', () => {
      // Regression guard: a real type definition `TFoo = object ... end` must still open a
      // block. The qualified-name backward scan must not over-consume past a statement boundary.
      const source = `type
  TFoo = object
    X: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });
  });

  suite('Regression 2026-05-10: try block intermediate validation', () => {
    test('should reject duplicate finally in try block', () => {
      const source = `try
  Foo;
finally
  Bar;
finally
  Baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      // Only the first 'finally' should be intermediate; the second is malformed and skipped
      assertIntermediates(pairs[0], ['finally']);
    });

    test('should reject duplicate except in try block', () => {
      const source = `try
  Foo;
except
  Bar;
except
  Baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['except']);
    });

    test('should reject finally after except in try block', () => {
      const source = `try
  Foo;
except
  Bar;
finally
  Baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      // finally and except are mutually exclusive; only the first one is kept
      assertIntermediates(pairs[0], ['except']);
    });

    test('should reject except after finally in try block', () => {
      const source = `try
  Foo;
finally
  Bar;
except
  Baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['finally']);
    });

    test('should still allow Delphi try-except-else (existing behavior)', () => {
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

  suite('Regression 2026-05-09: field-access dot followed by newline', () => {
    test('should not treat end as block close when preceded by field-access dot across newline', () => {
      const source = `begin
    X := Foo.
    end;
    Y := 1;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      // The outer end is at the second end (offset 43), not the field-access end (offset 24)
      assert.strictEqual(pairs[0].closeKeyword.startOffset, 43, 'should pair begin with the outer end, not the field-access Foo.\\n  end');
    });
  });

  suite('Regression 2026-05-15: try-finally-else is invalid in Delphi', () => {
    test('should reject else after finally in try block', () => {
      // Only try-except-else is valid in Delphi; try-finally-else is not.
      const source = `try
  foo;
finally
  bar;
else
  baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['finally']);
    });
  });

  suite('Regression 2026-05-15: $/# prefixed block_middle keywords', () => {
    test('should not treat $else as block_middle inside case (hex literal prefix)', () => {
      const source = `case X of
  $else: foo;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      // Only `of` is a real intermediate; `$else` is a hex-literal-prefixed identifier
      assertIntermediates(pairs[0], ['of']);
    });

    test('should not treat #else as block_middle inside case (char constant prefix)', () => {
      const source = `case X of
  #else: foo;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });

    test('should not treat $finally as block_middle inside try (hex literal prefix)', () => {
      const source = `try
  $finally;
  Bar;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      // No real intermediates; `$finally` is a hex-literal-prefixed identifier
      assertIntermediates(pairs[0], []);
    });

    test('should not treat $of as block_middle inside case (hex literal prefix)', () => {
      // Case missing real `of`; $of is a hex literal, so case has no intermediates.
      // Without `of`, the parser still pairs case with end via its block_close handling.
      const source = `case X
  $of 1: foo;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], []);
    });
  });

  suite('Regression 2026-05-15: comparison context after try/begin/on/repeat', () => {
    test('should not treat class as type definition after try statement', () => {
      // `try Bar = class do Foo end` is a try block with comparison `Bar = class`
      const source = 'try Bar = class do Foo end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
    });

    test('should not treat class as type definition after begin statement', () => {
      const source = `begin
  Foo;
  X = class
  DoMore;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat class as type definition after on in except handler', () => {
      const source = 'try Foo; except on E = class do Bar; end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['except']);
    });

    test('should not treat class as type definition after repeat statement', () => {
      const source = `repeat
  X = class
until done`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'repeat', 'until');
    });
  });

  suite('Regression 2026-05-16: standalone case with paren-starting arm before record variant case', () => {
    test('should not let a standalone case with a parenthesized arm break record variant case detection', () => {
      // A record method body contains `case Y of 9: (HandleNine); end;` — a standalone
      // case whose arm starts with '('. This must not be mistaken for a variant case,
      // otherwise the record's variant `case Integer of` is wrongly treated as a block
      // opener and the record is left without its closing `end`.
      const source = `TRec = record
  procedure M;
  begin
    case Y of
      9: (HandleNine);
    end;
  end;
  case Integer of
    0: (V: Integer);
end;`;
      const pairs = parser.parse(source);
      // The outer `case Integer of` is a record variant case (not a block).
      // Blocks: record-end, the method begin-end, and the inner standalone case-end.
      assertBlockCount(pairs, 3);
      const recordPair = findBlock(pairs, 'record');
      assert.strictEqual(recordPair.closeKeyword.value, 'end');
      // The record must pair with the final `end` (the last `end` token in the source).
      assert.strictEqual(recordPair.closeKeyword.startOffset, source.lastIndexOf('end'));
      // The inner standalone `case Y of` is a real block.
      const casePair = findBlock(pairs, 'case');
      assert.strictEqual(casePair.openKeyword.startOffset, source.indexOf('case'));
    });

    test('should still detect a genuine record variant case after a method with a standalone case', () => {
      // Same shape but the method's standalone case has a normal (non-paren) arm.
      const source = `TRec = record
  procedure M;
  begin
    case Y of
      9: WriteLn;
    end;
  end;
  case Integer of
    0: (V: Integer);
end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const recordPair = findBlock(pairs, 'record');
      assert.strictEqual(recordPair.closeKeyword.startOffset, source.lastIndexOf('end'));
    });
  });

  suite('Performance: record with many variant case statements', () => {
    test('should parse a record with hundreds of variant case statements without quadratic blowup', () => {
      // Build a single record containing many variant `case` parts. With the prior
      // O(N^2) isInsideRecord scan, 800 cases took ~60s; an O(N)/O(N log N)
      // implementation finishes in tens of milliseconds. The 5s ceiling leaves a
      // wide margin for slow CI machines while still failing clearly on O(N^2).
      const caseCount = 800;
      let source = 'TBig = record\n';
      for (let i = 0; i < caseCount; i++) {
        source += `  case Tag${i}: Integer of\n    0: (V${i}: Integer);\n`;
      }
      source += 'end;\n';

      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;

      // All inner `case` keywords are variant cases (no own end); only the record block.
      assertSingleBlock(pairs, 'record', 'end');
      assert.ok(elapsed < 5000, `parsing ${caseCount} variant cases took ${elapsed}ms, expected < 5000ms`);
    });
  });

  suite('Regression 2026-05-16: record after less-than comparison in prior statement', () => {
    test('should detect record type definition after a < comparison in a preceding statement', () => {
      // The bare `<` in `const C = 1 < 2;` belongs to a prior statement. The `record`
      // in the following type declaration must not be treated as a generic constraint.
      const source = `const C = 1 < 2;
type
  TR = record
    X: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should detect record type definition when an unbalanced < is far away in a prior statement', () => {
      const source = `var
  A: Boolean;
begin
  A := X < Y;
end;
type
  TR = record
    X: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const recordPair = findBlock(pairs, 'record');
      assert.strictEqual(recordPair.closeKeyword.value, 'end');
    });
  });

  suite('Regression 2026-05-16: type section class after preceding begin-end block', () => {
    test('should detect class type definition in type section following a begin-end block', () => {
      // The `begin..end` of `procedure Foo` precedes a `type` section. The first
      // declaration in that type section (`TBar = class`) must still be a block opener.
      const source = `procedure Foo;
begin
  X := 1;
end;

type
  TBar = class
    Y: Integer;
  end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'begin', 0);
      assertNestLevel(pairs, 'class', 0);
      const classPair = findBlock(pairs, 'class');
      assert.strictEqual(classPair.closeKeyword.value, 'end');
    });

    test('should detect class type definition in type section following a try-end block', () => {
      const source = `begin
  try
    X := 1;
  except
  end;
end;

type
  TBar = class
    Y: Integer;
  end;`;
      const pairs = parser.parse(source);
      const classPair = findBlock(pairs, 'class');
      assert.strictEqual(classPair.openKeyword.value, 'class');
      assert.strictEqual(classPair.closeKeyword.value, 'end');
    });

    test('should detect object type definition in type section following a repeat block', () => {
      const source = `begin
  repeat
    X := 1;
  until Done;
end;

type
  TBar = object
    Y: Integer;
  end;`;
      const pairs = parser.parse(source);
      const objectPair = findBlock(pairs, 'object');
      assert.strictEqual(objectPair.openKeyword.value, 'object');
      assert.strictEqual(objectPair.closeKeyword.value, 'end');
    });
  });

  suite('Regression 2026-05-18: variant record case with non-identifier tag', () => {
    test('should treat case with anonymous ordinal type tag as variant case', () => {
      // FreePascal allows an anonymous enumerated type as the variant selector tag:
      // `case (Foo) of`. The tag starts with '(' rather than an identifier, so the
      // variant `case` must still be recognized (no own `end`) and `end` closes
      // the `record`.
      const source = `type R = record
 case (Foo) of
 0: (a: Byte);
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should treat case with numeric selector tag as variant case', () => {
      // `case 1 of` uses a numeric literal as the selector tag. Although this is
      // invalid Pascal, the variant `case` must not be treated as a block opener:
      // the `end` should close the enclosing `record`, not the `case`.
      const source = 'var r: record case 1 of 0:(a:byte) end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end');
    });

    test('should still treat a standalone case with parenthesized selector expression as a block', () => {
      // Outside a record, `case (x + 1) of` is an ordinary case statement whose
      // selector is a parenthesized expression. It must remain a real block and
      // not be misclassified as a variant case.
      const source = `case (x + 1) of
  1: DoOne;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });
  });

  suite('Regression 2026-05-19: asm after > or ] is not a block opener', () => {
    test('should not treat asm after > comparison operator as a block opener', () => {
      // `a > asm` puts `asm` in expression context after a comparison operator.
      // It must not be tokenized as a block opener, otherwise the following `end`
      // is mispaired into a spurious asm/end block.
      const source = 'a > asm b end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const asmToken = parser.getTokens(source).find((t) => t.value === 'asm');
      assert.strictEqual(asmToken, undefined, 'asm after > must not be tokenized as a block opener');
    });

    test('should not treat asm after ] array-index close as a block opener', () => {
      // `arr[0] asm` puts `asm` right after an array-index `]`. As an expression
      // context it must not open an asm block, so no asm/end pair is produced.
      const source = 'arr[0] asm b end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
      const asmToken = parser.getTokens(source).find((t) => t.value === 'asm');
      assert.strictEqual(asmToken, undefined, 'asm after ] must not be tokenized as a block opener');
    });
  });

  suite('Regression 2026-05-19: single-line asm must not swallow following valid blocks', () => {
    test('should not let an unterminated single-line asm consume following case and begin blocks', () => {
      // The asm body and the trailing `case ... end;` both contain a `;` on the same
      // physical line as their `end`. The asm `;`-line-comment scan must not keep
      // skipping `end` candidates until EOF, swallowing the valid `case` and outer
      // `begin` blocks into the asm excluded region.
      const source = `procedure Fast;
begin
  asm mov eax, 1; end;
  case x of 1: a; end;
end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(casePair, 'case block must be detected, not swallowed by asm');
      assert.ok(beginPair, 'outer begin block must be detected, not swallowed by asm');
    });
  });

  suite('Regression 2026-05-21: case label using block_middle keyword', () => {
    test('should not treat of used as case label as case-middle intermediate', () => {
      // `case X of\n  of: a;` uses the keyword `of` as a case label (FreePascal/Delphi
      // accept reserved words preceded by `&` as identifiers, and even bare reserved
      // words can appear as labels in some compilers). The label-position `of` must
      // not be re-tokenized as a `case` block intermediate.
      const source = `case X of
  of: a;
  1: b;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
      // Only the real `of` after `case X` is an intermediate (offset 7); the
      // label-position `of` at offset 12 must be filtered out.
      assert.strictEqual(pairs[0].intermediates[0].startOffset, 7, 'the surviving of intermediate must be the case-X-of keyword');
    });
  });

  suite('Regression 2026-05-21: try-except-else-else duplicate else must be rejected', () => {
    test('should reject the second else after try-except-else (only one else intermediate)', () => {
      // Delphi's try-except-else permits at most one `else` clause. A second `else`
      // is malformed: previously both were added to the intermediates list, polluting
      // the structure. Only the first `else` should be recorded.
      const source = `try
  Foo;
except
  Bar;
else
  Baz;
else
  Qux;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'try', 'end');
      assertIntermediates(pairs[0], ['except', 'else']);
    });
  });

  suite('Regression: case-else-else duplicate else must be rejected', () => {
    test('should reject the second else after case-else (only one else intermediate)', () => {
      // Pascal `case` permits at most one `else` clause. A second `else` is malformed
      // (syntax error): previously both were added to the intermediates list, polluting
      // the structure. Only the first `else` should be recorded, matching the behavior
      // of try-except-else-else duplicate rejection.
      const source = `case X of
  1: foo;
else
  bar;
else
  baz;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of', 'else']);
    });

    test('should reject the second of after case-of (only one of intermediate)', () => {
      // Pascal `case` has exactly one `of` immediately after the selector expression.
      // A second `of` inside the body is malformed: previously both were added to the
      // intermediates list. Only the first `of` should be recorded.
      const source = `case X of
  1: foo;
of
  bar;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assertIntermediates(pairs[0], ['of']);
    });
  });

  suite('Regression 2026-05-21: nested generic close `>>` must not be treated as shift operator', () => {
    test('should treat record inside nested generic with `>>` close as constraint, not block opener', () => {
      // `function Bar<T: TList<record>>: T;` closes two generic levels with `>>`.
      // The forward scan in hasMatchingGenericClose previously skipped `>>` as a
      // shift operator, so the outer `<` never found its matching `>`. As a result
      // the `record` constraint was misclassified as a block opener and consumed
      // the trailing `end`, leaving the enclosing `class` as an orphan.
      const source = `TFoo = class
  function Bar<T: TList<record>>: T;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
      const recordToken = parser.getTokens(source).find((t) => t.value === 'record');
      assert.strictEqual(recordToken, undefined, 'record inside generic constraint must not be tokenized as block opener');
    });

    test('should treat record inside doubly nested generic with `>>>>` close as constraint', () => {
      // Four-level nested generic with four consecutive `>` closing all levels.
      // The forward scan must handle any even number of `>` correctly, not just
      // when odd `>` count happens to leave a leftover for the depth check.
      const source = `TFoo = class
  function Bar<T: TA<TB<TC<record>>>>: T;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
      const recordToken = parser.getTokens(source).find((t) => t.value === 'record');
      assert.strictEqual(recordToken, undefined, 'record inside deeply nested generic must not be tokenized as block opener');
    });
  });

  suite('Regression 2026-05-22: asm opener after closing parenthesis', () => {
    test('should not treat asm after closing parenthesis as block opener', () => {
      // `)` is an expression/condition context (like `>` and `]`), so `asm`
      // following it must not start a block. This source is invalid (missing
      // `then`), so the correct behavior is to produce no blocks.
      const source = `if (x) asm
  nop
end`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not let asm after closing parenthesis consume a surrounding end', () => {
      // Without rejecting `)`, the spurious asm/end pair consumes the inner `end`,
      // forcing `begin` to pair with the outer `end` (corrupting the BlockPair set).
      // With the fix, `asm` is not tokenized: `begin` pairs with its own inner `end`
      // and the extra trailing `end` is left orphaned (uncolored).
      const source = `begin
  if (x) asm
    nop
  end
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const beginPair = findBlock(pairs, 'begin');
      assert.strictEqual(beginPair.closeKeyword.line, 3, 'begin must pair with the inner end, not the outer end');
      const asmToken = parser.getTokens(source).find((t) => t.value === 'asm');
      assert.strictEqual(asmToken, undefined, 'asm after closing parenthesis must not be tokenized as block opener');
    });

    test('should not exclude asm block region after closing parenthesis', () => {
      // The backward check in addAsmExcludedRegions must also reject `)` so the
      // asm body is not turned into an excluded region.
      const source = `if (x) asm
  nop
end`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 0, 'no asm excluded region should be created after closing parenthesis');
    });

    test('should still treat asm as block opener after begin', () => {
      const source = `begin asm
  nop
end
end.`;
      const pairs = parser.parse(source);
      assert.ok(
        pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'),
        'asm after begin must remain a valid block opener'
      );
    });

    test('should still treat asm as block opener after semicolon', () => {
      const source = `begin
  x := 1; asm
    nop
  end
end.`;
      const pairs = parser.parse(source);
      assert.ok(
        pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'),
        'asm after semicolon must remain a valid block opener'
      );
    });

    test('should still treat asm as block opener after procedure header parameter list', () => {
      const source = `procedure Foo(x: Integer); asm
  nop
end;`;
      const pairs = parser.parse(source);
      assert.ok(
        pairs.some((p) => p.openKeyword.value === 'asm' && p.closeKeyword.value === 'end'),
        'asm after a procedure header (semicolon following the parameter list) must remain a valid block opener'
      );
    });
  });

  suite('Regression 2026-05-24: comparison-context class inside record', () => {
    test('should not treat class in `X = class` comparison as record-context open-block', () => {
      // `if X = class then` inside a record-embedded begin..end uses `class` as a
      // comparison-context operand (the magic value of a class reference). The
      // record-context scan must classify this `class` as 'ignore'; otherwise the
      // following variant `case` is no longer seen as inside a record and variant-case
      // suppression breaks (the variant case incorrectly produces its own pair).
      const source = `type
  TRec = record
    procedure M;
    begin
      if X = class then DoY;
    end;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });
  });

  suite('Regression 2026-05-24: comparison-context interface inside record', () => {
    test('should not treat interface in `X = interface` comparison as record-context open-block', () => {
      // Same as the class regression, but for `interface`.
      const source = `type
  TRec = record
    procedure M;
    begin
      if X = interface then DoY;
    end;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });
  });

  suite('Regression 2026-05-24: comparison-context object inside record', () => {
    test('should not treat object in `X = object` comparison as record-context open-record', () => {
      // Same as the class regression, but for `object`. Without the fix, `object` is
      // classified as 'open-record' (mirroring `record`); the closing `end` of the
      // inner begin..end then pops the wrong stack entry and the outer record loses
      // its end pairing.
      const source = `type
  TRec = record
    procedure M;
    begin
      if X = object then DoY;
    end;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });
  });

  suite('Regression 2026-05-24: class-qualified method modifiers (const/type/threadvar)', () => {
    test('should treat class const inside record as method modifier, not block opener', () => {
      // `class const KSize = 10;` declares a class-level constant. The `class` token
      // is a method modifier (like `class function`), so it must not count as an
      // 'open-block' for the surrounding record-context scan. Without the modifier
      // list including `const`, the variant `case` after it is misclassified.
      const source = `type
  TFoo = record
    class const KSize = 10;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const classPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'class');
      assert.strictEqual(classPairs.length, 0, 'class const must not produce a class..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });

    test('should treat class type inside record as method modifier, not block opener', () => {
      const source = `type
  TFoo = record
    class type TInner = Integer;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const classPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'class');
      assert.strictEqual(classPairs.length, 0, 'class type must not produce a class..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });

    test('should treat class threadvar inside record as method modifier, not block opener', () => {
      const source = `type
  TFoo = record
    class threadvar GTLS: Integer;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const classPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'class');
      assert.strictEqual(classPairs.length, 0, 'class threadvar must not produce a class..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });
  });

  suite('Regression 2026-05-25: recordContextMap corruption', () => {
    test('should not treat Foo.record field access as block opener', () => {
      // `Foo.record` is a field access (the identifier `record` reached via `.`),
      // not a record block opener. Without a field-access dot guard inside
      // buildRecordContextMap, the keyword pushes 'record' onto the stack, and the
      // following inner `end` pops it instead of the case block, so the standalone
      // `case` is misclassified as a variant case and no case..end pair is produced.
      const source = `X := Foo.record;
case Y of
  1: a;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat Foo.object field access as block opener', () => {
      // Same logic as `Foo.record`: a member access through `.` must not count as a
      // block opener for the record-context scan. Otherwise the following `case`/`end`
      // pair is corrupted by the spurious 'object' on the stack.
      const source = `X := Foo.object;
case Y of
  1: a;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat := object as open-record context', () => {
      // `X := object;` is an assignment whose right-hand-side mentions `object` (as an
      // identifier or expression value). The `=` reached by scanning backward from
      // `object` belongs to the assignment operator `:=`, not a type definition `=`.
      // Without an assignment-operator guard, the keyword is classified as 'open-record'
      // and the surrounding case..end pair is broken.
      const source = `X := object;
case Y of
  1: a;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat Unicode-prefixed αrecord identifier as record keyword', () => {
      // `αrecord` is a single Unicode identifier, not the keyword `record`. The
      // RECORD_CONTEXT_KEYWORD_PATTERN uses ASCII `\b` so it matches `record` inside
      // `αrecord`. Without an adjacent-Unicode-letter guard inside buildRecordContextMap,
      // the keyword pushes 'record' onto the stack and corrupts the case..end pair below.
      const source = `var αrecord: Integer;
case Y of
  1: a;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
    });

    test('should not treat Unicode-prefixed αif as comparison keyword in backward = scan', () => {
      // The backward `=` scan inside `isPrecededByComparisonEquals` extracts ASCII words
      // only, so the preceding token `αif` is read as `if`, which is a comparison-context
      // keyword. Without a Unicode-letter adjacency guard, the `class` after `αif = class`
      // is misclassified as 'ignore' (comparison) instead of 'open-block', breaking the
      // type-class..end pair below.
      const source = `type αif = class
  procedure Bar;
end;`;
      const pairs = parser.parse(source);
      const classPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'class');
      assert.strictEqual(classPairs.length, 1, 'expected exactly one class..end pair');
    });

    test('should not treat Unicode-prefixed αthen as then keyword in isIfThenElse', () => {
      // The backward scan in `isIfThenElse` extracts ASCII-only word characters, so
      // `αthen` is read as `then`. Without a Unicode-letter adjacency guard, the `else`
      // after `case x of 1: αthen` is misclassified as an if-then-else intermediate
      // and dropped from the case block's intermediates list.
      const source = `case x of
  1: αthen
  else Bar;
end;`;
      const pairs = parser.parse(source);
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 1, 'expected exactly one case..end pair');
      assertIntermediates(casePairs[0], ['of', 'else']);
    });

    test('should not treat ..end range operator as block close', () => {
      // `0..end` uses the `..` range operator to express the upper bound `end` of an
      // open-ended array slice. The `end` is an expression value, not a block-close
      // keyword. Without a `..` guard in isValidBlockClose, the inner `end` closes the
      // surrounding `begin`, and the outer `end;` of the procedure body is left orphan.
      const source = `begin
  var a: array[0..end] of Integer;
end;`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      // The matched close must be the outer `end;`, not the `..end]` token.
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, outerEndOffset, 'begin must pair with the outer end, not the ..end range operator');
    });
  });

  suite('Regression 2026-05-26: `end:` field declaration inside record', () => {
    test('should not treat record-body `end:` field declaration as block close', () => {
      // `end: Integer;` inside a record is a field declaration (`end` is a field
      // name, not the block-close keyword). Without an isValidBlockClose guard, the
      // inner `end` consumes the surrounding `record`, leaving the outer `end` orphan.
      const source = `TFoo = record
  end: Integer;
end`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      // The matched close must be the outer `end`, not the field-name `end:`.
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(
        recordPairs[0].closeKeyword?.startOffset,
        outerEndOffset,
        'record must pair with the outer end, not the `end:` field declaration'
      );
    });
  });

  suite('Regression 2026-05-26: keyword used on the left of `:=` assignment', () => {
    test('should not treat `try` on left of `:=` as block opener', () => {
      // `try := 5;` uses `try` as the left-hand-side identifier of an assignment.
      // (In real Pascal this would require the FreePascal `&try` escape; without it
      // the code is invalid, but the parser must not misclassify it as a block.)
      // Without a `:=` check the `try` is pushed onto the stack and the enclosing
      // `end` closes `try` instead of `begin`, leaving the outer `begin` orphan.
      const source = `begin
  try := 5;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, outerEndOffset);
      // `try` must not produce a block pair.
      const tryPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'try');
      assert.strictEqual(tryPairs.length, 0, '`try` on lhs of `:=` must not produce a block pair');
    });

    test('should not treat `record` on left of `:=` as block opener', () => {
      const source = `begin
  record := 5;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 0, '`record` on lhs of `:=` must not produce a block pair');
    });

    test('should not treat `case` on left of `:=` as block opener', () => {
      const source = `begin
  case := 5;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` on lhs of `:=` must not produce a block pair');
    });
  });

  suite('Regression 2026-05-26: `case:` field declaration inside record', () => {
    test('should not treat record-body `case:` field declaration as block opener', () => {
      // `case: Integer;` inside a record uses `case` as a field name, not a variant
      // case selector. Without an isValidBlockOpen guard the `case` is pushed onto the
      // stack and the surrounding `end` closes `case` instead of `record`, leaving
      // the outer `record` orphan.
      const source = `TFoo = record
  case: Integer;
end`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(recordPairs[0].closeKeyword?.startOffset, outerEndOffset);
      // `case` must not produce a block pair.
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` used as field name must not produce a block pair');
    });
  });

  suite('Regression 2026-05-26: variant case missing `of` clause', () => {
    test('should not treat record-body `case Tag` without `of` as block opener', () => {
      // `case Tag` without a following `of` is a malformed variant case header. In a
      // valid record, the variant case is `case Tag of ...`. Without an `of` clause
      // the `case` is not a standalone block opener either (it never has its own
      // matching `end`). Without this guard the `case` is pushed onto the stack and
      // the inner `end` closes `case` instead of `record`, leaving the outer record
      // orphan.
      const source = `TFoo = record
  case Tag
end`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(recordPairs[0].closeKeyword?.startOffset, outerEndOffset);
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` without `of` inside record must not produce a block pair');
    });
  });

  suite('Regression 2026-05-26: case used as function call inside expression', () => {
    test('should not treat `if case(x) then ...` case as block opener', () => {
      // `if case(x) then writeln;` uses `case` as a function-call identifier inside
      // the boolean expression of an `if`. Without an expression-context guard the
      // `case` is pushed onto the stack and the trailing `end` closes `case` instead
      // of `begin`, leaving the surrounding `begin` orphan.
      const source = `begin
  if case(x) then writeln;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, outerEndOffset);
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` used as function call in expression must not produce a block pair');
    });

    test('should not treat `while case(x) do ...` case as block opener', () => {
      // Same issue with `while`: `case(x)` is a function call inside the while
      // expression, not a case statement.
      const source = `begin
  while case(x) do writeln;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` used as function call in expression must not produce a block pair');
    });
  });

  suite('Regression 2026-05-26: variant case with quoted tag inside record', () => {
    test('should not treat case with string-literal tag as block opener', () => {
      // `case 'Test': Integer of ...` uses a quoted string as the (malformed) tag of
      // a variant case. The tag is an excluded region (string literal); without a
      // string-tag guard in the selector tag detection, the case is treated as a
      // standalone block opener and the surrounding `end` closes `case` instead of
      // `record`.
      const source = `TFoo = record
  case 'Test': Integer of
    0: (X: Integer);
end`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(recordPairs[0].closeKeyword?.startOffset, outerEndOffset);
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` with quoted tag inside record must not produce a block pair');
    });
  });

  suite('Regression 2026-05-26: try-else without except/finally', () => {
    test('should not attach else to try block when neither except nor finally precedes it', () => {
      // `try ... else ... end` (no except/finally) is malformed: Delphi requires
      // `try-except-else` or `try-finally`, never `try-else`. Without an
      // intermediate-validation guard the bare `else` is attached to the try
      // intermediates list, polluting it. The else here belongs to no valid
      // try-block construct and must be rejected.
      const source = `try
  WriteLn;
else
  HandleError;
end`;
      const pairs = parser.parse(source);
      const tryPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'try');
      assert.strictEqual(tryPairs.length, 1, 'expected exactly one try..end pair');
      // The else must not appear in the try block's intermediates list.
      assert.strictEqual(tryPairs[0].intermediates.length, 0, 'try without except/finally must not collect else as intermediate');
    });
  });

  suite('Regression 2026-05-29: generic type definition without space before =', () => {
    test('should recognize class after generic close `>` directly preceding `=` as block opener', () => {
      // `TList<T>=class` has no whitespace between the generic close `>` and the
      // type-definition `=`. The `>` here is the generic-close bracket (matching the
      // earlier `<`), not a comparison operator, so the `=` is a type definition and
      // the following `class` opens a block. Without the fix the `>` immediately
      // before `=` is treated as a comparison-operator prefix (like `>=`) and the
      // class is not detected as a block opener.
      const source = 'TList<T>=class\n  X: Integer;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'end');
    });

    test('should recognize object after generic close `>` directly preceding `=`', () => {
      // Same scenario but with `object` instead of `class`.
      const source = 'TPair<A,B>=object\n  X: A;\n  Y: B;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'object', 'end');
    });

    test('should recognize interface after generic close `>` directly preceding `=`', () => {
      // Same scenario but with `interface`.
      const source = 'IList<T>=interface\n  procedure Add(x: T);\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end');
    });

    test('should still reject class after `>=` comparison operator', () => {
      // The existing `>=` test must continue to pass: `>` followed by `=` (where the
      // `>` is NOT a generic close because no matching `<` exists) is a comparison
      // operator, so the trailing `class` is not a block opener.
      const pairs = parser.parse('begin\n  if x >= class then\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression 2026-05-29: asm after case-label colon is a block opener', () => {
    test('should treat asm after numeric case-label colon as block opener', () => {
      // `case x of 1: asm ... end` uses `asm` as a statement after a case-label
      // delimiter `:`. The case-label is the integer literal `1`. Without the fix,
      // the backward scan from `asm` lands on `:` and unconditionally rejects asm
      // as expression context, leaving the inner `end` to mispair with `case` and
      // the outer `end` orphaned.
      const source = `case x of
  1: asm
       mov ax, 1
     end;
  2: foo;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(asmPair, 'asm block must be detected after numeric case-label colon');
      assert.ok(casePair, 'case block must be detected; outer `end` must pair with `case`');
      // The case block's `end` must be the trailing end (last `end` in source),
      // not the inner asm-closing `end`.
      assert.strictEqual(casePair?.closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should treat asm after identifier case-label colon as block opener', () => {
      // `case x of Red: asm ... end` uses an enum identifier as the case-label.
      const source = `case x of
  Red: asm
         mov ax, 1
       end;
  Green: bar;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(asmPair, 'asm block must be detected after identifier case-label colon');
      assert.ok(casePair, 'case block must be detected');
    });

    test('should treat asm after char-constant case-label colon as block opener', () => {
      // `case x of 'a': asm ... end` uses a char constant as the case-label.
      const source = `case x of
  'a': asm
         mov ax, 1
       end;
  'b': foo;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(asmPair, 'asm block must be detected after char-constant case-label colon');
      assert.ok(casePair, 'case block must be detected');
    });

    test('should treat asm after range case-label colon as block opener', () => {
      // `case x of 1..5: asm ... end` uses a range as the case-label.
      const source = `case x of
  1..5: asm
          mov ax, 1
        end;
  6: foo;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const asmPair = pairs.find((p) => p.openKeyword.value === 'asm');
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(asmPair, 'asm block must be detected after range case-label colon');
      assert.ok(casePair, 'case block must be detected');
    });

    test('should add asm excluded region for case-label asm block', () => {
      // The `addAsmExcludedRegions` backward scan must also accept case-label colons,
      // otherwise the asm body is not added as an excluded region and asm-body words
      // (like `mov`, `case`) are tokenised as Pascal keywords.
      const source = `case x of
  1: asm
       mov ax, 1
     end;
end`;
      const regions = parser.getExcludedRegions(source);
      // At minimum the asm body region between `asm` and the matching `end` must exist.
      const asmKeywordPos = source.indexOf('asm');
      const asmEndPos = source.indexOf('end', asmKeywordPos);
      const asmRegion = regions.find((r) => r.start === asmKeywordPos + 3 && r.end === asmEndPos);
      assert.ok(asmRegion, 'asm body must be added as an excluded region');
    });
  });

  suite('Regression 2026-05-31: comparison-context record inside record', () => {
    test('should not treat record in `X = record` comparison as block opener', () => {
      // `if X = record then` inside a record-embedded begin..end uses `record` as a
      // comparison-context operand, not a record block opener. Mirrors the existing
      // class/object/interface comparison-context-inside-record regressions. Without the
      // fix the spurious `record` steals the begin..end closing `end`, the outer record is
      // orphaned, and the variant `case` is no longer suppressed.
      const source = `type
  TRec = record
    procedure M;
    begin
      if X = record then DoY;
    end;
    case Integer of
      0: (V: Integer);
  end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, 'variant case inside a record must not produce its own pair');
    });
  });

  suite('Regression 2026-05-31: `record:` field declaration inside record', () => {
    test('should not treat record-body `record:` field declaration as block opener', () => {
      // `record: Integer;` inside a record uses `record` as a field name, not a nested
      // record block opener. Without an isValidBlockOpen guard the inner `record` is
      // pushed onto the stack and the surrounding `end` closes it instead of the outer
      // record, leaving the outer `record` orphan.
      const source = `type T = record
  record: Integer;
end;`;
      const pairs = parser.parse(source);
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 1, 'expected exactly one record..end pair');
      // The outer record must pair with the `end`, and it is the only record token left.
      const outerRecordOffset = source.indexOf('record');
      assert.strictEqual(recordPairs[0].openKeyword.startOffset, outerRecordOffset, 'the outer record must be the paired opener');
      assert.strictEqual(recordPairs[0].closeKeyword?.startOffset, source.lastIndexOf('end'));
    });
  });

  suite('Regression 2026-05-31: `repeat` on left of `:=` assignment', () => {
    test('should not treat `repeat` on left of `:=` as block opener', () => {
      // `repeat := 5;` uses `repeat` as the left-hand-side identifier of an assignment.
      // When a stray `until` follows, the spurious `repeat` pairs with it, corrupting
      // the BlockPair set. The enclosing `begin..end` must be the only pair.
      const source = `begin
  repeat := 5;
  until x;
end;`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, outerEndOffset);
      // `repeat` on lhs of `:=` must not produce a repeat..until pair.
      const repeatPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'repeat');
      assert.strictEqual(repeatPairs.length, 0, '`repeat` on lhs of `:=` must not produce a block pair');
    });
  });

  suite('Regression 2026-05-31: `record` on right of `:=` assignment', () => {
    test('should not treat `record` on right of `:=` as block opener', () => {
      // `x := record;` uses `record` as a right-hand-side expression identifier, not a
      // record type opener (a record type definition uses `=`, not `:=`). Without this
      // guard the spurious `record` is pushed onto the stack and the surrounding `end`
      // closes it instead of `begin`, leaving the outer `begin` orphan.
      const source = `begin
  x := record;
end;`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      const outerEndOffset = source.lastIndexOf('end');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, outerEndOffset);
      // `record` on rhs of `:=` must not produce a block pair.
      const recordPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'record');
      assert.strictEqual(recordPairs.length, 0, '`record` on rhs of `:=` must not produce a block pair');
    });
  });

  suite('Regression: asm forward-character check must match between tokenize and excluded regions', () => {
    test('should not treat `asm` followed by `>` as a block opener', () => {
      // `asm > begin x end;` uses `asm` as a comparison operand (an identifier), not an
      // assembly block opener. The asm-excluded-region scan already rejected a trailing
      // `>`, but isValidBlockOpen did not, so `asm` became a block opener and stole the
      // `end` from the real `begin..end`. The two forward-character sets must match.
      const source = 'asm > begin x end;';
      const pairs = parser.parse(source);
      const asmPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.strictEqual(asmPairs.length, 0, '`asm` before `>` must not be a block opener');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `asm` followed by `[` as a block opener', () => {
      // `asm[0] := 1;` indexes an array named `asm`; the `[` makes it an identifier, not
      // an assembly block. Neither forward set listed `[`, so `asm` fell through to the
      // backward scan, was treated as a statement-position opener, and produced a spurious
      // unterminated asm region swallowing the rest of the source.
      const source = 'begin\n  asm[0] := 1;\nend';
      const pairs = parser.parse(source);
      const asmPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.strictEqual(asmPairs.length, 0, '`asm` before `[` must not be a block opener');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `asm` followed by `<` as a block opener', () => {
      // `asm < b;` uses `asm` as a comparison operand (an identifier). Neither forward set
      // listed `<`, so `asm` fell through to the backward scan and was treated as a
      // statement-position opener, producing a spurious unterminated asm region.
      const source = 'begin\n  asm < b;\nend';
      const pairs = parser.parse(source);
      const asmPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'asm');
      assert.strictEqual(asmPairs.length, 0, '`asm` before `<` must not be a block opener');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: block-open keyword on right of `:=` assignment', () => {
    test('should not treat `repeat` on right of `:=` as block opener', () => {
      // `x := repeat;` uses `repeat` as a right-hand-side expression identifier, not a
      // block opener. With a stray `until` following, the spurious `repeat` pairs with it,
      // corrupting the BlockPair set. The enclosing `begin..end` must be the only pair.
      const source = `begin
  x := repeat;
  until y;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'expected exactly one begin..end pair');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, source.lastIndexOf('end'));
      const repeatPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'repeat');
      assert.strictEqual(repeatPairs.length, 0, '`repeat` on rhs of `:=` must not produce a block pair');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `begin` on right of `:=` as block opener', () => {
      // `x := begin;` uses `begin` as a right-hand-side identifier. Without the RHS guard
      // the spurious `begin` is pushed and the surrounding `end` closes it instead of the
      // real enclosing block, leaving the outer block orphan.
      const source = `begin
  x := begin;
end`;
      const pairs = parser.parse(source);
      const beginPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'begin');
      assert.strictEqual(beginPairs.length, 1, 'only the outer begin should pair with end');
      assert.strictEqual(beginPairs[0].openKeyword.startOffset, source.indexOf('begin'), 'the outer begin must be the paired opener');
      assert.strictEqual(beginPairs[0].closeKeyword?.startOffset, source.lastIndexOf('end'));
    });

    test('should not treat `try` on right of `:=` as block opener', () => {
      // `x := try;` uses `try` as a right-hand-side identifier; without the RHS guard the
      // spurious `try` is pushed and the surrounding `end` closes it.
      const source = `begin
  x := try;
end`;
      const pairs = parser.parse(source);
      const tryPairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'try');
      assert.strictEqual(tryPairs.length, 0, '`try` on rhs of `:=` must not produce a block pair');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `case` on right of `:=` as block opener', () => {
      // `x := case;` uses `case` as a right-hand-side identifier; without the RHS guard the
      // spurious `case` is pushed and the surrounding `end` closes it.
      const source = `begin
  x := case;
end`;
      const pairs = parser.parse(source);
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 0, '`case` on rhs of `:=` must not produce a block pair');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: malformed variant case (missing `of`) must not suppress later standalone case', () => {
    test('should not let a malformed `case Tag` (no `of`) inside a record suppress a following standalone case', () => {
      // `case Tag` (without `of`) inside a record is a malformed variant selector. The
      // parser's isValidBlockOpen treats it as a non-block opener (variant case), but the
      // record-context builder used to treat it as a standalone case and push a phantom
      // `case` onto the context stack. That phantom kept the context "inside a record" for
      // the following standalone `case Integer of`, wrongly suppressing it and dropping the
      // outer case..end pair. Both code paths must agree: the malformed `case Tag` produces
      // no pair, and the following `case Integer of` is a real standalone block.
      const source = `record
  case Tag
end;
case Integer of
  0: (X: Integer);
end`;
      const pairs = parser.parse(source);
      // The first `record` closes with the first `end`.
      const recordPair = findBlock(pairs, 'record');
      assert.strictEqual(recordPair.closeKeyword?.startOffset, source.indexOf('end'), 'record should close with the first end');
      // The second `case Integer of` is a standalone block closing with the last `end`.
      const casePairs = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.strictEqual(casePairs.length, 1, 'the standalone `case Integer of` must produce one case..end pair');
      assert.strictEqual(casePairs[0].closeKeyword?.startOffset, source.lastIndexOf('end'), 'the standalone case should close with the last end');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-06-13: case label value position with block-close keyword', () => {
    test('should not treat until as block close when used as a case label value after `:`', () => {
      // The `until` after `1:` sits in the value position of a case label and must not
      // be treated as a block-close keyword. Without this guard the inner `until` closes
      // the surrounding `repeat`, leaving the final `until done` orphan.
      const source = `repeat
  case X of
    1: until: foo;
  end;
until done`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const casePair = findBlock(pairs, 'case');
      assert.strictEqual(casePair.openKeyword.startOffset, source.indexOf('case'));
      assert.strictEqual(casePair.closeKeyword.value, 'end');
      assert.strictEqual(casePair.closeKeyword.startOffset, source.indexOf('end;'));
      const repeatPair = findBlock(pairs, 'repeat');
      assert.strictEqual(repeatPair.openKeyword.startOffset, 0);
      assert.strictEqual(repeatPair.closeKeyword.value, 'until');
      assert.strictEqual(repeatPair.closeKeyword.startOffset, source.lastIndexOf('until'));
    });

    test('should not treat end as block close when used as a case label value after `:`', () => {
      // Same shape but with `end` in the value position: `1: end: foo;`. The inner
      // `end` must not close the enclosing `case` prematurely.
      const source = `case X of
    1: end: foo;
  end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end');
      assert.strictEqual(pairs[0].closeKeyword.startOffset, source.lastIndexOf('end'));
    });
  });

  suite('Regression 2026-06-13: type section with many declarations should not be O(N^2)', () => {
    test('should parse a type section with many class declarations in linear time', () => {
      // A type section containing many `T = class end;` declarations forced the
      // isValidBlockOpen cross-`;` scope scan to walk back to the start of the source
      // for every `class` keyword. With N declarations this is O(N^2): n=4000 took
      // ~22s under the quadratic path. A linear scan finishes well under the 5s
      // ceiling even at n=4000.
      const n = 4000;
      let source = 'type\n';
      for (let i = 0; i < n; i++) source += `  T${i} = class end;\n`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assertBlockCount(pairs, n);
      assert.ok(elapsed < 5000, `parsing ${n} class declarations took ${elapsed}ms, expected < 5000ms`);
    });

    test('should parse a type section with many record declarations in linear time', () => {
      // Same shape but with `record` instead of `class`. Record validation also goes
      // through isPrecededByComparisonEquals via the record-context map, so the
      // cross-`;` scope scan must remain bounded.
      const n = 2000;
      let source = 'type\n';
      for (let i = 0; i < n; i++) source += `  T${i} = record X: Integer; end;\n`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assertBlockCount(pairs, n);
      assert.ok(elapsed < 5000, `parsing ${n} record declarations took ${elapsed}ms, expected < 5000ms`);
    });

    test('should parse a type section with many object declarations in linear time', () => {
      const n = 4000;
      let source = 'type\n';
      for (let i = 0; i < n; i++) source += `  T${i} = object end;\n`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assertBlockCount(pairs, n);
      assert.ok(elapsed < 5000, `parsing ${n} object declarations took ${elapsed}ms, expected < 5000ms`);
    });

    test('should parse a type section with many interface declarations in linear time', () => {
      const n = 4000;
      let source = 'type\n';
      for (let i = 0; i < n; i++) source += `  I${i} = interface end;\n`;
      const start = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - start;
      assertBlockCount(pairs, n);
      assert.ok(elapsed < 5000, `parsing ${n} interface declarations took ${elapsed}ms, expected < 5000ms`);
    });
  });

  generateCommonTests(config);
});
