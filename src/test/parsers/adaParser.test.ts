import * as assert from 'node:assert';
import { AdaBlockParser } from '../../parsers/adaParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('AdaBlockParser Test Suite', () => {
  let parser: AdaBlockParser;

  setup(() => {
    parser = new AdaBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'X : Integer := 0;',
    tokenSource: 'if Condition then\nend if;',
    expectedTokenValues: ['if', 'then', 'end if'],
    excludedSource: '-- comment\n"string"',
    expectedRegionCount: 2,
    twoLineSource: 'if Condition then\nend if;',
    nestedPositionSource: 'procedure Test is\nbegin\nend Test;',
    nestedKeyword: 'procedure',
    nestedLine: 0,
    nestedColumn: 0,
    singleLineCommentSource: '-- if then end if loop\nif Condition then\nend if;',
    commentBlockOpen: 'if',
    commentBlockClose: 'end if',
    doubleQuotedStringSource: 'Put("if then end if loop");\nif Condition then\nend if;',
    stringBlockOpen: 'if',
    stringBlockClose: 'end if'
  };

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
      // accept and begin are separate blocks (accept uses do...end, not begin...end)
      assert.strictEqual(pairs.length, 2);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'begin');
      assert.strictEqual(pairs[1].openKeyword.value.toLowerCase(), 'accept');
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
    generateExcludedRegionTests(config);

    test('should handle comment at end of line', () => {
      const source = `if Condition then -- end if here
   Action;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Strings', () => {
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
    generateEdgeCaseTests(config);

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

  generateCommonTests(config);

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

  suite('Accept without do', () => {
    test('should not treat accept without do as block opener', () => {
      const source = `select
  accept Entry_Name;
or
  delay 1.0;
end select;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should not treat accept with parameters but no do as block opener', () => {
      const source = `select
  accept Read(V : out Integer);
or
  delay 1.0;
end select;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should treat accept with do as block opener', () => {
      const source = `accept My_Entry do
  null;
end My_Entry;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
    });

    test('should treat accept with parameters and do as block opener', () => {
      const source = `accept Read(V : out Integer) do
  V := Buffer_Value;
end Read;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
    });

    test('should handle accept with comment before do', () => {
      const source = `accept My_Entry -- comment
  do
  null;
end My_Entry;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
    });
  });

  suite('Type/subtype is with comment lines in backward scan', () => {
    test('should skip comment line when scanning backward for type declaration', () => {
      const source = `procedure Test is
  type My_Type
    -- This is a comment
    is range 1 .. 100;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should skip multiple comment lines when scanning backward for type', () => {
      const source = `procedure Test is
  subtype My_Sub
    -- Comment line 1
    -- Comment line 2
    is Integer range 1 .. 10;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should not skip non-comment lines as type declaration', () => {
      const source = `procedure Test is
  X := 1;
    is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // 'is' after procedure should count, and the standalone 'is' should also count
      // since 'X := 1;' is not a type/subtype declaration
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 2);
    });
  });

  suite('Generic default is <>', () => {
    test('should not treat function with is <> as block opener', () => {
      const source = `generic
  with function F(X : Integer) return Integer is <>;
procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should not treat procedure with is <> as block opener', () => {
      const source = `generic
  with procedure P(X : Integer) is <>;
procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should still treat procedure with is and body as block', () => {
      const source = `procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });
  });

  // Covers lines 74-75: entry validation reaching EOF
  suite('Entry declaration at EOF', () => {
    test('should not treat incomplete entry at EOF as block', () => {
      const source = 'entry Start(X : Integer';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat entry without is or do at EOF as block', () => {
      const source = 'entry Start';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers lines 148-149: accept validation reaching EOF
  suite('Accept statement at EOF', () => {
    test('should not treat incomplete accept at EOF as block', () => {
      const source = 'accept Entry_Name(X : Integer';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat accept without do at EOF as block', () => {
      const source = 'accept Entry_Name';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers line 173: \r\n line ending handling in loop validation
  suite('Loop validation with CRLF line endings', () => {
    test('should handle for-loop with CRLF line endings', () => {
      const source = 'for I in 1..10\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle multi-line for-loop with mixed line endings', () => {
      const source = 'for I in\r\n  1..10\r\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  // Covers line 210: loop validation with semicolon in excluded regions
  suite('Loop validation with semicolon in string or comment', () => {
    test('should handle loop after line with semicolon in comment', () => {
      const source = `X : Integer; -- has semicolon;
loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should handle loop after line with semicolon in string', () => {
      const source = `Text : String := "value;";
loop
  exit;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });
  });

  // Covers lines 372-373: multi-line 'is' checking reaching start of file
  suite('Type declaration at start of file', () => {
    test('should not treat is in type declaration at file start as block middle', () => {
      const source = `type Color is (Red, Green, Blue);
procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should handle multi-line type declaration at file start', () => {
      const source = `type Range_Type
  is range 1..100;
function F return Integer is
begin
  return 1;
end F;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should handle subtype at file start', () => {
      const source = `subtype Small is Integer range 1..10;
procedure P is
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  // Covers CRLF in loop line offset calculation
  suite('CRLF loop validation', () => {
    test('should handle for loop across CRLF blank lines before loop', () => {
      const source = 'for I in 1 .. 10\r\n\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle for loop with CRLF and comment near boundary', () => {
      const source = 'for I in 1 .. 10 -- "iter"\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle standalone loop with CRLF after semicolon', () => {
      const source = 'null;\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });
  });

  // Covers lines 372-375: blank line in backward type declaration scan
  suite('Type declaration with blank line', () => {
    test('should skip is in type declaration with blank line before is', () => {
      const source = `type T

  is range 1 .. 100;
procedure P is
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  // Covers line 363: CRLF handling when skipping comment between type and is
  suite('Coverage: type declaration with comment and CRLF', () => {
    test('should skip is in type declaration with CRLF comment line between', () => {
      const source = 'type T\r\n-- comment\r\n  is range 1 .. 100;\r\nprocedure P is\r\nbegin\r\n  null;\r\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  // Covers lines 371-374: multiple blank lines between type and is
  suite('Coverage: type declaration with multiple blank lines', () => {
    test('should skip is in type declaration with two blank lines before is', () => {
      const source = 'type T\n\n\n  is range 1 .. 100;\nprocedure P is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should skip is in type declaration with multiple CRLF blank lines', () => {
      const source = 'type T\r\n\r\n\r\n  is range 1 .. 100;\r\nprocedure P is\r\nbegin\r\n  null;\r\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 1: null record should not create false block opener', () => {
      const source = `procedure P is
  type T is null record;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 1: tagged null record should not create false block opener', () => {
      const source = `procedure P is
  type T is tagged null record;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 1: abstract tagged null record should not create false block opener', () => {
      const source = `procedure P is
  type T is abstract tagged null record;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 5: for/while loop with loop more than 5 lines away', () => {
      const source = `for I in
  Very_Long_Range_Name
  .Subrange_Name
  .Another_Part
  .Yet_Another
  .Final_Part loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('Bug 6: access protected procedure should not create false block', () => {
      const source = `declare
  type P is access protected procedure;
begin
  null;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('Bug 6: access protected function should not create false block', () => {
      const source = `declare
  type F is access protected function return Integer;
begin
  null;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('Bug 7: simple end should close top of stack, not search for begin', () => {
      const source = `task body Server is
begin
  accept Request do
    null;
  end;
end Server;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const acceptPair = pairs.find((p) => p.openKeyword.value === 'accept');
      assert.ok(acceptPair);
      assert.strictEqual(acceptPair.closeKeyword.value, 'end');
      assert.strictEqual(acceptPair.nestLevel, 1);
      const taskPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'task');
      assert.ok(taskPair);
      assert.strictEqual(taskPair.nestLevel, 0);
    });

    test('Bug 7: simple end with multiple inner blocks should not skip them', () => {
      const source = `procedure P is
begin
  select
    accept A do
      null;
    end;
  or
    accept B do
      null;
    end;
  end select;
end P;`;
      const pairs = parser.parse(source);
      const acceptPairs = pairs.filter((p) => p.openKeyword.value === 'accept');
      assert.strictEqual(acceptPairs.length, 2);
      for (const ap of acceptPairs) {
        assert.strictEqual(ap.closeKeyword.value, 'end');
      }
    });

    test('Bug 8: for representation clause should not create false block opener', () => {
      const source = `procedure P is
  for T'Size use 32;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 8: for attribute alignment clause should not create false block opener', () => {
      const source = `procedure P is
  for My_Type'Alignment use 8;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 10: qualified expression if should not be detected as block', () => {
      const pairs = parser.parse("procedure Main is\nbegin\n  X := Integer'(if A > 0 then A else 0);\nend Main;");
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 4: or else short-circuit operator should not create false intermediate', () => {
      const source = `if A or else B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });

    test('Bug 4: or else with real else branch', () => {
      const source = `if A or else B then
  null;
else
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 2);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
      assert.strictEqual(pairs[0].intermediates[1].value.toLowerCase(), 'else');
    });

    test('Bug 5: and then short-circuit operator should not create duplicate intermediate', () => {
      const source = `if A and then B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });

    test('Bug 5: combined and then and or else should have only one then intermediate', () => {
      const source = `if A and then B or else C then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });
  });

  suite('Uncovered line coverage', () => {
    // Covers lines 115-121: comment between is and abstract/separate in function/procedure scanner
    test('should skip comment between is and abstract in procedure declaration', () => {
      const source = `procedure Outer is
  procedure Inner is -- this is a comment
    abstract;
begin
  null;
end Outer;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should skip comment between is and separate in procedure declaration', () => {
      const source = `procedure Outer is
  procedure Inner is -- descriptive comment
    separate;
begin
  null;
end Outer;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should skip multi-line comment between is and new in function declaration', () => {
      const source = `package body Test is
  function Inner is -- instantiation
    new Generic_Func;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end', 0);
    });

    // Covers lines 190-192: if inside parentheses (Ada 2012 conditional expression)
    test('should reject if inside parentheses as conditional expression', () => {
      const source = `procedure P is
begin
  X := (if Condition then 1 else 2);
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should not reject if after function call parenthesis', () => {
      // if after Put("...\n is on a new line, preceded by identifier+( so not conditional
      const source = `Put("text");
if Condition then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // Covers lines 400-403: semicolon between type and is on same line
    test('should treat is as intermediate when semicolon separates type and is on same line', () => {
      const source = `procedure P is
  type T; X is
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Both 'is' after procedure and the standalone 'is' should be intermediates
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 2);
    });

    // Covers lines 446-449: multi-line type/subtype with semicolon between type and is
    test('should treat is as intermediate when semicolon found in multi-line type declaration', () => {
      const source = `procedure P is
  type
    Foo; X
    is new Integer;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end', 0);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // The is after procedure + the standalone is (with semicolon before it) = 2
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 2);
    });

    // Covers line 543: then as valid intermediate for select block
    test('should handle select with then abort pattern', () => {
      const source = `select
  delay 1.0;
  then abort
    Lengthy_Operation;
end select;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('then'), 'then should be an intermediate of select');
    });

    // Covers lines 671-676: isInsideParens with excluded region before (
    test('should handle excluded region before ( in isInsideParens check', () => {
      // The excluded region (attribute tick) is between ( and if
      const source = `X := ('a'(if Cond then A else B));
procedure P is
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      // 'a' is a character literal (excluded region), followed by (
      // ( is preceded by ) from character literal, not identifier, so would be inside parens
      // But actually ) is not a-zA-Z0-9_ so the condition at line 672 is false -> return true
      // So the if inside ('a'(if...)) should be rejected as conditional expression
      assertSingleBlock(pairs, 'procedure', 'end', 0);
    });

    test('should not treat if as conditional when preceded by function call paren', () => {
      // Func(if ...) - ( preceded by identifier char -> isInsideParens returns false
      // The if is NOT rejected as conditional expression, so it becomes a block opener
      // But it has no matching end if, so it remains unmatched
      const source = `Func(if True then 1 else 0);
if Cond then
  null;
end if;`;
      const pairs = parser.parse(source);
      // First if: not rejected as conditional (function call paren), but has no end if -> unmatched
      // Second if: matched with end if
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should not skip is when semicolon separates type declarations on same line', () => {
      // Covers lines 447-450: semicolon found between type decl start and standalone is
      // "type T is (A, B);" completes the first type, so the standalone "is" is not skipped
      const source = `type T is (A, B); type U
is (C, D);
if Cond then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle excluded region before paren in isInsideParens', () => {
      // Covers line 674: excluded region scan before ( in isInsideParens
      // "op" is a string literal (excluded region) immediately before (
      const source = `X := "op"(if True then 1 else 0);
if Cond then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });
});
