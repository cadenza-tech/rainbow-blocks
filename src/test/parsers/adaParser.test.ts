import * as assert from 'node:assert';
import { AdaBlockParser } from '../../parsers/adaParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('AdaBlockParser Test Suite', () => {
  let parser: AdaBlockParser;

  setup(() => {
    parser = new AdaBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse if block', () => {
      const source = `if Condition then
   Action;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse loop block', () => {
      const source = `loop
   Action;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should parse for loop block', () => {
      const source = `for I in 1 .. 10 loop
   Put(I);
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should parse while loop block', () => {
      const source = `while Count > 0 loop
   Count := Count - 1;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });

    test('should parse case block', () => {
      const source = `case Value is
   when 1 => Put("One");
   when others => Put("Other");
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
    });

    test('should parse select block', () => {
      const source = `select
   delay 1.0;
or
   delay 2.0;
end select;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should parse record block', () => {
      const source = `type Point is record
   X : Integer;
   Y : Integer;
end record;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end record');
    });

    test('should parse declare block', () => {
      const source = `declare
   X : Integer := 0;
begin
   X := X + 1;
end;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse begin block', () => {
      const source = `begin
   Put_Line("Hello");
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse procedure block', () => {
      const source = `procedure Hello is
begin
   Put_Line("Hello");
end Hello;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse function block', () => {
      const source = `function Add(A, B : Integer) return Integer is
begin
   return A + B;
end Add;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse package block', () => {
      const source = `package My_Package is
   X : Integer;
end My_Package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
    });

    test('should parse task block', () => {
      const source = `task My_Task is
begin
   null;
end My_Task;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse protected block', () => {
      const source = `protected type Semaphore is
begin
   null;
end Semaphore;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse accept block', () => {
      const source = `accept My_Entry do
begin
   null;
end;
end My_Entry;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else block', () => {
      const source = `if Condition then
   Action1;
else
   Action2;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should parse if-elsif-else block', () => {
      const source = `if Cond1 then
   Action1;
elsif Cond2 then
   Action2;
else
   Action3;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'elsif', 'then', 'else']);
    });

    test('should parse case with when', () => {
      const source = `case Value is
   when 1 => Put("One");
   when 2 => Put("Two");
   when others => Put("Other");
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
    });

    test('should parse begin with exception', () => {
      const source = `begin
   Risky_Operation;
exception
   when others => Put("Error");
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['exception', 'when']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `procedure Outer is
begin
   for I in 1 .. 10 loop
      if I > 5 then
         Put(I);
      end if;
   end loop;
end Outer;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      assertNestLevel(pairs, 'procedure', 0);
    });

    test('should handle deeply nested if statements', () => {
      const source = `if A then
   if B then
      if C then
         Action;
      end if;
   end if;
end if;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Excluded regions - Comments', () => {
    test('should ignore keywords in comments', () => {
      const source = `-- if then end if loop
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle comment at end of line', () => {
      const source = `if Condition then -- end if here
   Action;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in strings', () => {
      const source = `Put("if then end if loop");
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `Put("say ""if""");
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Character literals', () => {
    test('should handle character literals', () => {
      const source = `C : Character := 'a';
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle tick for attributes', () => {
      const source = `Len : Integer := Str'Length;
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Case insensitivity', () => {
    test('should handle uppercase keywords', () => {
      const source = `IF Condition THEN
   Action;
END IF;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END IF');
    });

    test('should handle mixed case keywords', () => {
      const source = `If Condition Then
   Action;
End If;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'If', 'End If');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('X : Integer := 0;');
      assertNoBlocks(pairs);
    });

    test('should handle multiple procedures', () => {
      const source = `procedure A is
begin
   null;
end A;

procedure B is
begin
   null;
end B;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });

    test('should handle simple end without type', () => {
      const source = `begin
   Action;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle complex real-world Ada code', () => {
      const source = `with Ada.Text_IO; use Ada.Text_IO;

procedure Main is
   Count : Integer := 0;
begin
   for I in 1 .. 10 loop
      if I mod 2 = 0 then
         Count := Count + 1;
      end if;
   end loop;
   Put_Line("Even count:" & Integer'Image(Count));
exception
   when others =>
      Put_Line("Error");
end Main;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });

    test('should handle unterminated string', () => {
      const source = `Put("unterminated
if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle unterminated string at end of file', () => {
      // Tests lines 125-127: matchAdaString reaching end of source
      const source = `Put("unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unmatched end loop without for/while/loop opener', () => {
      // Tests findLastOpenerForLoop returning -1 (lines 358-359)
      // and fallback to last opener (lines 276-277)
      const source = `if Condition then
  X := 1;
end loop;`;
      const pairs = parser.parse(source);
      // end loop doesn't match if, but falls back to last opener
      assertSingleBlock(pairs, 'if', 'end loop');
    });

    test('should handle compound end with different type', () => {
      // Tests findLastOpenerByType returning -1 and fallback (lines 276-277)
      const source = `if Condition then
  X := 1;
end procedure;`;
      const pairs = parser.parse(source);
      // end procedure doesn't match if, but fallback to last opener
      assertSingleBlock(pairs, 'if', 'end procedure');
    });

    test('should handle named end', () => {
      const source = `procedure Hello is
begin
   Put_Line("Hello");
end Hello;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `if Condition then
end if;`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `procedure Test is
begin
end Test;`;
      const pairs = parser.parse(source);
      const procPair = findBlock(pairs, 'procedure');
      assertTokenPosition(procPair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if Condition then
end if;`;
      const tokens = parser.getTokens(source);
      assert.ok(tokens.some((t) => t.value === 'if'));
      assert.ok(tokens.some((t) => t.value === 'then'));
      assert.ok(tokens.some((t) => t.value === 'end if'));
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `-- comment
"string"`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });
  });
});
