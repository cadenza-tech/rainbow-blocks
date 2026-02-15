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
      assertSingleBlock(pairs, 'declare', 'end');
      assertIntermediates(pairs[0], ['begin']);
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
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should parse function block', () => {
      const source = `function Add(A, B : Integer) return Integer is
begin
   return A + B;
end Add;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
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
      assertSingleBlock(pairs, 'task', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should parse protected block', () => {
      const source = `protected type Semaphore is
begin
   null;
end Semaphore;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should parse accept block', () => {
      const source = `accept My_Entry do
begin
   null;
end;
end My_Entry;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
      assertIntermediates(pairs[0], ['begin']);
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
      assertBlockCount(pairs, 3);
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
      assertBlockCount(pairs, 2);
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
      assertBlockCount(pairs, 3);
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

    test('should handle multi-line for loop', () => {
      const source = `for I in
   1 .. 10 loop
   Put(I);
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle named end', () => {
      const source = `procedure Hello is
begin
   Put_Line("Hello");
end Hello;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Entry declarations', () => {
    test('should not treat entry declaration as block open', () => {
      const source = `task type Worker is
  entry Start;
  entry Stop;
end Worker;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'task', 'end');
    });

    test('should not treat entry with parameters as block open', () => {
      const source = `protected type Buffer is
  entry Read(V : out Integer);
  entry Write(V : in Integer);
end Buffer;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should parse entry body in protected body as block', () => {
      const source = `entry Read(V : out Integer) when Count > 0 is
begin
  V := Value;
end Read;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entry', 'end');
    });
  });

  suite('Access subprogram types', () => {
    test('should not treat access function as block open', () => {
      const pairs = parser.parse('declare\n  type Func_Ptr is access function (X : Integer) return Integer;\nbegin\n  null;\nend;');
      assertSingleBlock(pairs, 'declare', 'end', 0);
    });

    test('should not treat access procedure as block open', () => {
      const pairs = parser.parse('declare\n  type Proc_Ptr is access procedure (X : Integer);\nbegin\n  null;\nend;');
      assertSingleBlock(pairs, 'declare', 'end', 0);
    });
  });

  suite('Boolean operator or', () => {
    test('should not treat or in if condition as intermediate', () => {
      const pairs = parser.parse('if A or B then\n  null;\nend if;');
      assertSingleBlock(pairs, 'if', 'end if', 0);
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });
  });

  suite('Type declaration is', () => {
    test('should not treat is in type declaration as intermediate', () => {
      const pairs = parser.parse('procedure Test is\n  type T is range 1 .. 10;\nbegin\n  null;\nend Test;');
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(!intermediates.includes('is') || intermediates.filter((v) => v === 'is').length === 1, 'should have at most one is intermediate');
    });

    test('should not treat is on continuation line of type declaration as intermediate', () => {
      const source = 'procedure Test is\n  type My_Type\n    is range 1 .. 100;\nbegin\n  null;\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Only the 'is' after 'procedure Test' should be an intermediate, not the type 'is'
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should not treat is in subtype declaration on continuation line as intermediate', () => {
      const source = 'procedure Test is\n  subtype S\n    is Integer range 1 .. 10;\nbegin\n  null;\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
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

  suite('Procedure/function declarations without body', () => {
    test('should not treat procedure declaration as block', () => {
      const pairs = parser.parse('procedure Foo;');
      assertNoBlocks(pairs);
    });

    test('should not treat function declaration as block', () => {
      const pairs = parser.parse('function Bar return Integer;');
      assertNoBlocks(pairs);
    });

    test('should not treat procedure with parameters as block', () => {
      const pairs = parser.parse('procedure Foo(X : Integer);');
      assertNoBlocks(pairs);
    });

    test('should still treat procedure with body as block', () => {
      const source = `procedure Foo is
begin
  null;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Compound end with multiple spaces', () => {
    test('should handle compound end with multiple spaces', () => {
      const source = `if True then
null;
end  if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end  if');
    });
  });

  suite('Labeled loops', () => {
    test('should handle labeled for loop', () => {
      const source = 'outer: for I in 1..10 loop\n  null;\nend loop;';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'for');
    });

    test('should handle labeled while loop', () => {
      const source = 'outer: while Condition loop\n  null;\nend loop;';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'while');
    });

    test('should handle standalone loop after for loop', () => {
      const source = 'for I in 1..10 loop\n  loop\n    exit;\n  end loop;\nend loop;';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 2);
    });
  });

  suite('Attribute tick handling', () => {
    test('should not match keyword after attribute tick', () => {
      const source = `for I in T'Range loop
  Put(I);
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle attribute tick with keyword-like name', () => {
      // Attribute name like 'Access should not create false keyword match
      const source = `declare
  P : access Integer := X'Access;
begin
  null;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('should handle tick followed by identifier', () => {
      const source = `if X'Length > 0 then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: excluded region in forward scan', () => {
    test('should handle comment in entry declaration', () => {
      const pairs = parser.parse('protected body Obj is\n  entry E -- comment\n    (X : Integer);\nend Obj;');
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should handle comment in procedure declaration', () => {
      const pairs = parser.parse('procedure Foo -- comment\n  (X : Integer);\nif True then\n  null;\nend if;');
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Complex real-world scenario', () => {
    test('should handle declare/begin/end with exception and nested if', () => {
      const source = `procedure Main is
  X : Integer := 0;
begin
  declare
    Y : Integer := 1;
  begin
    if X > 0 then
      null;
    end if;
  exception
    when others =>
      null;
  end;
end Main;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'procedure');
      findBlock(pairs, 'declare');
      findBlock(pairs, 'if');
    });
  });

  suite('Multiple for/while on same line', () => {
    test('should handle two for loops starting on same line', () => {
      const source = `for I in 1..10 loop  for J in 1..5
  loop
    null;
  end loop;
end loop;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('CRLF and \\r-only line endings', () => {
    test('should handle CRLF in loop backward scan', () => {
      const source = 'for I in 1 .. 10\r\nloop\r\n  Put(I);\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle \\r-only in loop backward scan', () => {
      const source = 'for I in 1 .. 10\rloop\r  Put(I);\rend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle standalone loop with CRLF', () => {
      const source = 'X := 1;\r\nloop\r\n  exit;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should skip is in type declaration with \\r-only line endings', () => {
      const source = 'procedure Test is\r  type T is range 1 .. 10;\rbegin\r  null;\rend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should skip is on continuation line with \\r-only line endings', () => {
      const source = 'procedure Test is\r  type My_Type\r    is range 1 .. 100;\rbegin\r  null;\rend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should terminate string at \\r-only line ending', () => {
      const source = 'Put("unterminated\rif Condition then\rend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should terminate string at CRLF line ending', () => {
      const source = 'Put("unterminated\r\nif Condition then\r\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 15: loop validation with \\r-only backward scan', () => {
      const source = 'for I in 1 .. 10\rloop\r  Put(I);\rend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('Bug 15: standalone loop with \\r-only', () => {
      const source = 'X := 1;\rloop\r  exit;\rend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('Bug 15: while loop with \\r-only', () => {
      const source = 'while Count > 0\rloop\r  Count := Count - 1;\rend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });

    test('Bug 16: is abstract on separate lines', () => {
      const source = `procedure Test is
  type T is
    abstract tagged limited private;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('Bug 16: is separate on separate lines', () => {
      const source = `procedure Test is
  procedure Inner is
    separate;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('Bug 16: is new on separate lines', () => {
      const source = `package body Test is
  procedure Inner is
    new Generic_Proc;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end', 0);
    });

    test('Bug 16: is null on separate lines', () => {
      const source = `procedure Test is
  procedure Inner is
    null;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('Bug 16: is abstract with CRLF line endings', () => {
      const source = 'procedure Test is\r\n  type T is\r\n    abstract tagged limited private;\r\nbegin\r\n  null;\r\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('Bug 16: is abstract with \\r-only line endings', () => {
      const source = 'procedure Test is\r  type T is\r    abstract tagged limited private;\rbegin\r  null;\rend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });
  });
});
