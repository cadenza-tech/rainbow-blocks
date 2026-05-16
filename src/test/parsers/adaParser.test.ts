import * as assert from 'node:assert';
import { isOrElseShortCircuit } from '../../parsers/adaHelpers';
import { AdaBlockParser } from '../../parsers/adaParser';
import { assertBlockCount, assertIntermediates, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

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
    stringBlockClose: 'end if',
    commentAtEndOfLineSource: 'if Condition then -- end if here\n   Action;\nend if;',
    commentAtEndOfLineBlockOpen: 'if',
    commentAtEndOfLineBlockClose: 'end if',
    escapedQuoteStringSource: 'Put("say ""if""");\nif Condition then\nend if;',
    escapedQuoteStringBlockOpen: 'if',
    escapedQuoteStringBlockClose: 'end if',
    nestedBlockSource: `procedure Outer is
begin
   for I in 1 .. 10 loop
      if I > 5 then
         Put(I);
      end if;
   end loop;
end Outer;`,
    nestedBlockCount: 3,
    nestedBlockLevels: [{ keyword: 'procedure', level: 0 }]
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

    test('should keep or and else as intermediates in select block', () => {
      const pairs = parser.parse('select\n  accept Entry1;\nor\nelse\n  null;\nend select;');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or', 'else']);
    });
  });

  suite('Nested blocks', () => {
    generateNestedBlockTests(config);

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

    test('should treat tick before paren as qualified expression not character literal', () => {
      const pairs = parser.parse("if Integer'(X) > 0 then\n  null;\nend if;");
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle four-quote character literal followed by keyword', () => {
      const pairs = parser.parse("if '''' = X then\n  null;\nend if;");
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

    test('should leave end loop unpaired without for/while/loop opener', () => {
      // Best-effort parsing: when end loop has no matching opener, leave both
      // sides unpaired rather than force-pairing with the last opener.
      // (CLAUDE.md best-effort parsing #3: prefer no color over wrong color.)
      const source = `if Condition then
  X := 1;
end loop;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should leave compound end unpaired when type does not match any opener', () => {
      const source = `if Condition then
  X := 1;
end procedure;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
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

    test('should merge begin with compound end procedure', () => {
      const source = 'procedure Foo is\nbegin\n  null;\nend procedure;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
      assert.strictEqual(pairs[0].intermediates.length, 2); // is, begin
    });

    test('should detect unterminated string with doubled-quote at end', () => {
      const source = 'Put("test""");\nif True then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should keep or and else as intermediates when or follows select directly', () => {
      const pairs = parser.parse('select\nor\nelse\n  null;\nend select;');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or', 'else']);
    });

    suite('Standalone loop after for representation clause', () => {
      test('should detect standalone loop after for-use representation clause on previous line', () => {
        const pairs = parser.parse('for T use 32;\nloop\n  null;\nend loop;');
        assertSingleBlock(pairs, 'loop', 'end loop');
      });

      test('should detect standalone loop after for-use on same line separated by semicolon', () => {
        const pairs = parser.parse('for T use 32; loop\n  null;\nend loop;');
        assertSingleBlock(pairs, 'loop', 'end loop');
      });

      test('should detect standalone loop after for-attribute representation clause', () => {
        const pairs = parser.parse("for T'Size use 32;\nloop\n  null;\nend loop;");
        assertSingleBlock(pairs, 'loop', 'end loop');
      });

      test('should still detect for-loop pair when no semicolon separates them', () => {
        const pairs = parser.parse('for I in 1 .. 10 loop\n  null;\nend loop;');
        assertSingleBlock(pairs, 'for', 'end loop');
      });
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

    test('should have is as intermediate in task type declaration', () => {
      const source = `task type Worker is
  entry Start;
end Worker;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'task', 'end');
      assertIntermediates(pairs[0], ['is']);
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
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('should not treat access procedure as block open', () => {
      const pairs = parser.parse('declare\n  type Proc_Ptr is access procedure (X : Integer);\nbegin\n  null;\nend;');
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('should not treat access function with comment as block open', () => {
      const pairs = parser.parse('declare\n  type Func_Ptr is access -- callback\n    function (X : Integer) return Integer;\nbegin\n  null;\nend;');
      assertSingleBlock(pairs, 'declare', 'end');
    });

    test('should not treat access procedure with comment as block open', () => {
      const pairs = parser.parse('declare\n  type Proc_Ptr is access -- handler\n    procedure (X : Integer);\nbegin\n  null;\nend;');
      assertSingleBlock(pairs, 'declare', 'end');
    });
  });

  suite('Boolean operator or', () => {
    test('should not treat or in if condition as intermediate', () => {
      const pairs = parser.parse('if A or B then\n  null;\nend if;');
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });
  });

  suite('Type declaration is', () => {
    test('should not treat is in type declaration as intermediate', () => {
      const pairs = parser.parse('procedure Test is\n  type T is range 1 .. 10;\nbegin\n  null;\nend Test;');
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(!intermediates.includes('is') || intermediates.filter((v) => v === 'is').length === 1, 'should have at most one is intermediate');
    });

    test('should not treat is on continuation line of type declaration as intermediate', () => {
      const source = 'procedure Test is\n  type My_Type\n    is range 1 .. 100;\nbegin\n  null;\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Only the 'is' after 'procedure Test' should be an intermediate, not the type 'is'
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should not treat is in subtype declaration on continuation line as intermediate', () => {
      const source = 'procedure Test is\n  subtype S\n    is Integer range 1 .. 10;\nbegin\n  null;\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
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
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });

    test('should skip is on continuation line with \\r-only line endings', () => {
      const source = 'procedure Test is\r  type My_Type\r    is range 1 .. 100;\rbegin\r  null;\rend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 16: is separate on separate lines', () => {
      const source = `procedure Test is
  procedure Inner is
    separate;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 16: is new on separate lines', () => {
      const source = `package body Test is
  procedure Inner is
    new Generic_Proc;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
    });

    test('should not leak is intermediate from filtered subprogram declarations', () => {
      const source = `package body Pkg is
  procedure Helper is separate;
begin
  null;
end Pkg;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
      const isIntermediates = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1);
    });

    test('should not leak is intermediate from is abstract declaration', () => {
      const source = `package body Pkg is
  procedure Helper is abstract;
begin
  null;
end Pkg;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
      const isIntermediates = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1);
    });

    test('Bug 16: is null on separate lines', () => {
      const source = `procedure Test is
  procedure Inner is
    null;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 16: is abstract with CRLF line endings', () => {
      const source = 'procedure Test is\r\n  type T is\r\n    abstract tagged limited private;\r\nbegin\r\n  null;\r\nend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('Bug 16: is abstract with \\r-only line endings', () => {
      const source = 'procedure Test is\r  type T is\r    abstract tagged limited private;\rbegin\r  null;\rend Test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat procedure with is <> as block opener', () => {
      const source = `generic
  with procedure P(X : Integer) is <>;
procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should still treat procedure with is and body as block', () => {
      const source = `procedure Test is
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
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

    test('should not treat then as and-then when and is inside a comment', () => {
      const source = `if True -- and
then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });

    test('should not treat then as and-then when and is in a string', () => {
      const source = `if X = "and"
then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });
  });

  suite('Task forward declarations', () => {
    test('should not treat task forward declaration as block opener', () => {
      const source = `procedure P is
  task Worker;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat task type forward declaration as block opener', () => {
      const source = `procedure P is
  task type Worker;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should still treat task with is as block opener', () => {
      const source = `task Worker is
  entry Start;
end Worker;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'task', 'end');
    });

    test('should still treat task body with is and begin as block', () => {
      const source = `task body Worker is
begin
  null;
end Worker;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'task', 'end');
    });

    test('should not treat incomplete task at EOF as block', () => {
      const pairs = parser.parse('task Worker');
      assertNoBlocks(pairs);
    });
  });

  suite('Package renames and instantiations', () => {
    test('should not treat package renames as block opener', () => {
      const source = `package P renames Q;
procedure Main is
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat package is new (generic instantiation) as block opener', () => {
      const source = `package P is new Generic_Pkg;
procedure Main is
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat package is new with arguments as block opener', () => {
      const source = `package P is new Generic_Pkg(Item => Integer);
procedure Main is
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat package without is as block opener', () => {
      const pairs = parser.parse('package P;');
      assertNoBlocks(pairs);
    });

    test('should still treat package with is (spec) as block opener', () => {
      const source = `package My_Pkg is
  X : Integer;
end My_Pkg;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
    });

    test('should still treat package body with is as block opener', () => {
      const source = `package body My_Pkg is
begin
  null;
end My_Pkg;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
    });
  });

  suite('Protected forward declarations', () => {
    test('should not treat protected type forward declaration as block opener', () => {
      const source = `procedure P is
  protected type Obj;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat protected forward declaration without type as block opener', () => {
      const source = `procedure P is
  protected Obj;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should still treat protected type with is as block opener', () => {
      const source = `protected type Semaphore is
  entry Acquire;
end Semaphore;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should still treat protected body with is as block opener', () => {
      const source = `protected body Semaphore is
  entry Acquire when Open is
  begin
    Open := False;
  end Acquire;
end Semaphore;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('For representation clauses', () => {
    test('should not treat for-use record representation as block opener', () => {
      const source = `procedure P is
  for T use record
    X at 0 range 0 .. 7;
  end record;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      // Only procedure and record blocks should be detected, not for
      const procBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'procedure');
      assert.ok(procBlock);
      const forBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'for');
      assert.strictEqual(forBlock, undefined, 'for-use record should not be a block opener');
    });

    test('should not treat for-use enumeration representation as block opener', () => {
      const source = `procedure P is
  for Color use (Red => 0, Green => 1, Blue => 2);
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat for-use size clause as block opener', () => {
      const source = `procedure P is
  for T use 32;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should still treat normal for loop as block opener', () => {
      const source = `for I in 1 .. 10 loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('For in quantified expressions', () => {
    test('should not treat for inside parens as block opener (quantified expression)', () => {
      const source = `if (for all I in S => I > 0) then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat for some inside parens as block opener', () => {
      const source = `if (for some I in S => I > 0) then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should still treat for outside parens as block opener', () => {
      const source = `for I in 1 .. 10 loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Or else in selective accept', () => {
    test('should not remove or and else in selective accept with or else alternative', () => {
      const source = `select
  accept Entry_Name;
or
  delay 1.0;
else
  null;
end select;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'), 'or should be an intermediate of select');
      assert.ok(intermediates.includes('else'), 'else should be an intermediate of select');
    });

    test('should still filter or else in if condition', () => {
      const source = `if A or else B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.strictEqual(pairs[0].intermediates[0].value.toLowerCase(), 'then');
    });

    test('should handle select with or and else separated by inner blocks', () => {
      const source = `select
  accept A do
    null;
  end;
or
  accept B do
    null;
  end;
else
  null;
end select;`;
      const pairs = parser.parse(source);
      const selectBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectBlock);
      const intermediates = selectBlock.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'), 'or should be an intermediate of select');
      assert.ok(intermediates.includes('else'), 'else should be an intermediate of select');
    });
  });

  suite('When as intermediate for accept', () => {
    test('should treat when as intermediate for accept block (entry guard)', () => {
      const source = `accept Read(V : out Integer)
  when Count > 0 do
  V := Value;
end Read;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('when'), 'when should be an intermediate of accept');
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
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should skip comment between is and separate in procedure declaration', () => {
      const source = `procedure Outer is
  procedure Inner is -- descriptive comment
    separate;
begin
  null;
end Outer;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should skip multi-line comment between is and new in function declaration', () => {
      const source = `package body Test is
  function Inner is -- instantiation
    new Generic_Func;
begin
  null;
end Test;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
    });

    // Covers lines 190-192: if inside parentheses (Ada 2012 conditional expression)
    test('should reject if inside parentheses as conditional expression', () => {
      const source = `procedure P is
begin
  X := (if Condition then 1 else 2);
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
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
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Only the is after procedure; the 'is new' is a generic instantiation, not an intermediate
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
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
      assertSingleBlock(pairs, 'procedure', 'end');
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

    test('should not treat for with qualified name attribute as block opener', () => {
      const source = `procedure P is
  for Pkg.Type'Size use 32;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat package body stub (is separate) as block opener', () => {
      const source = `procedure Main is
  package body My_Pkg is separate;
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat task body stub (is separate) as block opener', () => {
      const source = `procedure Main is
  task body Worker is separate;
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat protected body stub (is separate) as block opener', () => {
      const source = `procedure Main is
  protected body Obj is separate;
begin
  null;
end Main;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat package is new with comment between is and new as block opener', () => {
      const source = `procedure P is
  package My_Pkg is -- instantiation
    new Generic_Pkg;
begin
  null;
end P;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
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

    test('should handle or else inside nested block in select', () => {
      // isOrElseShortCircuit: statements between or and else prevent short-circuit removal
      const source = `select
  accept Do_Work;
  loop
    delay 1.0;
  end loop;
  or
  else
    null;
end select;`;
      const pairs = parser.parse(source);
      // 'select' block should be found; 'or else' should be recognized as intermediate
      const selectPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectPair, 'should find select block');
    });

    test('should treat or else as short-circuit when only whitespace between or and else', () => {
      // isOrElseShortCircuit: only whitespace between or and else → short-circuit removal
      const source = 'if (A or else B) then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat or as select intermediate when not preceded by select', () => {
      // or without else is kept as intermediate when inside non-select block
      const source = 'if a or b then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Bug 14: surrogate pair character literal handling', () => {
    test('should handle surrogate pair character literal without breaking parsing', () => {
      // U+1D11E (musical symbol G clef) is 2 UTF-16 code units
      const source = "if '\uD834\uDD1E' = X then\n  null;\nend if;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  // Regression: compound end keywords should merge begin from stack
  suite('Regression: compound end keywords with begin', () => {
    test('should merge begin into pair when end procedure closes procedure+begin', () => {
      const source = 'procedure Foo is\nbegin\n  null;\nend procedure Foo;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'procedure');
      assert.strictEqual(pairs[0].closeKeyword.value.toLowerCase(), 'end procedure');
      // begin should be in intermediates
      const intermediateValues = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediateValues.includes('begin'), 'begin should be in intermediates');
    });

    test('should merge begin into pair when end function closes function+begin', () => {
      const source = 'function Bar return Integer is\nbegin\n  return 42;\nend function Bar;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'function');
      assert.strictEqual(pairs[0].closeKeyword.value.toLowerCase(), 'end function');
      const intermediateValues = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediateValues.includes('begin'), 'begin should be in intermediates');
    });
  });

  suite('Regression: conditional expression inside function call arguments', () => {
    test('should not treat if inside function call parens as block opener', () => {
      const source = 'procedure Main is\nbegin\n  Put_Line(if X > 0 then "Pos" else "Neg");\n  if Real then\n    null;\n  end if;\nend Main;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const procPair = findBlock(pairs, 'procedure');
      assert.ok(procPair, 'procedure pair should exist');
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair, 'if pair should exist');
    });

    test('should not treat case inside function call parens as block opener', () => {
      const source = 'procedure Main is\nbegin\n  Put(case X is when 1 => "A", when 2 => "B");\nend Main;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const procPair = findBlock(pairs, 'procedure');
      assert.ok(procPair, 'procedure pair should exist');
    });

    test('should still detect if as block opener outside function call', () => {
      const source = 'procedure Main is\nbegin\n  if X > 0 then\n    null;\n  end if;\nend Main;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: isInsideParens multi-line conditional expressions', () => {
    test('should not detect if inside multi-line parens as block opener', () => {
      const source = `X := (
  if A > 0 then A else -A);`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should detect outer if but not inner if inside multi-line parens', () => {
      const source = `if Condition then
  X := (
    if A > 0 then A else -A);
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Regression: isInsideParens with commas', () => {
    test('should detect if after comma as inside parens', () => {
      const source = `procedure M is
begin
  F(X, if A > 0 then B else C);
end M;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should detect case after comma as inside parens', () => {
      const source = `procedure M is
begin
  F(X, case Y is when 1 => A, when 2 => B);
end M;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should detect if after nested function call args as inside parens', () => {
      const source = `procedure M is
begin
  F(G(X), if A > 0 then B else C);
end M;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should detect if after string arg on different line as inside parens', () => {
      const source = `procedure M is
begin
  Func("hello",
    if X > 0 then "Y" else "N");
end M;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Regression: and then with comments', () => {
    test('should detect and then with comment between and and then', () => {
      const source = `if X > 0 and --comment
  then Y > 0 then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should still detect normal and then without comment', () => {
      const source = `if X > 0 and then Y > 0 then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Regression: null record with comment between null and record', () => {
    test('should reject record when null is before it with comment in between', () => {
      const source = 'type T is\n  null -- this is a null record\n  record;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still reject null record on same line', () => {
      const source = 'type T is null record;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still accept record without null before it', () => {
      const source = 'type T is record\n  X : Integer;\nend record;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end record');
    });
  });

  suite('Branch coverage: isAdaWordAt boundary checks and isOrElseShortCircuit', () => {
    test('should reject is inside identifier (preceding boundary check, adaHelpers line 52)', () => {
      // 'this_value' contains 'is' substring; isAdaWordAt should reject it due to preceding char
      const source = 'function this_value is\nbegin\n  return 0;\nend this_value;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should reject is as prefix of identifier (following boundary check, adaHelpers line 53)', () => {
      // 'island' starts with 'is'; isAdaWordAt should reject it due to following char
      const source = 'procedure island is\nbegin\n  null;\nend island;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should handle or else with no preceding block_open', () => {
      // 'or else' without any preceding block_open keyword in the token stream
      const source = 'X := A or else B;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: isValidProtectedOpen cross-line access match', () => {
    test('should not suppress protected when access is on a previous line', () => {
      const source = 'type Handler is access\nprotected type Controller is\n  entry Process;\nend Controller;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'protected');
    });

    test('should still suppress protected after access on the same line', () => {
      const source = 'type Handler is access protected;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still suppress protected after access all on the same line', () => {
      const source = 'type Handler is access all protected;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: isValidLoopOpen position-based pairing', () => {
    test('should not treat loop as standalone when loop precedes for on the same line', () => {
      const source = 'loop\n  for I in 1..10 loop\n    null;\n  end loop;\nend loop;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'loop');
      findBlock(pairs, 'for');
    });

    test('should still detect standalone loop when for has its own loop', () => {
      const source = 'for I in 1..10 loop\n  null;\nend loop;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: or else short-circuit inside select block', () => {
    test('should remove or else inside when guard of select', () => {
      const source = 'select\n  when Guard1 or else Guard2 =>\n    accept Foo;\nor\n  accept Bar;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['when', 'or']);
    });

    test('should still keep or as select intermediate', () => {
      const source = 'select\n  accept Foo;\nor\n  accept Bar;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or']);
    });
  });

  suite('Regression 2026-05-16: select alternative or after a non-semicolon-terminated body', () => {
    test('should keep or as a select intermediate when the alternative body is not semicolon-terminated', () => {
      // The first select alternative body is just `X` with no trailing `;`.
      // A bare `or` starting its own line still delimits a select alternative
      // and must be tracked as an intermediate, even though the preceding
      // (incomplete) statement does not end with `;`.
      const source = 'select\n  X\nor\n  accept B;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or']);
    });

    test('should keep or as a select intermediate after an identifier-only alternative body', () => {
      const source = 'select\n  Do_Work\nor\n  delay 1.0;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or']);
    });

    test('should not treat boolean or inside an if condition as an intermediate', () => {
      // `A or B` is a boolean expression: the `or` is an operator, not a
      // select alternative delimiter, and must not become an intermediate.
      const source = 'if A or B then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should not treat boolean or inside a select guard as an intermediate', () => {
      // `when A or B =>` — the guard's `or` is a boolean operator. Only the
      // alternative-delimiting `or` should be an intermediate.
      const source = 'select\n  when A or B =>\n    accept Foo;\nor\n  accept Bar;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['when', 'or']);
    });

    test('should not treat boolean or in a select guard split across lines as an intermediate', () => {
      // The guard `A or B` is split so that `or` starts its own line; it is
      // still a boolean operator inside the `when ... =>` guard.
      const source = 'select\n  when A\n  or B =>\n    accept Foo;\nor\n  accept Bar;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['when', 'or']);
    });
  });

  suite('Branch coverage: findExcludedRegionAt null fallback and isOrElseShortCircuit comment', () => {
    // Lines 514-522: backward scan from 'then' crossing excluded regions (comments)
    // The loop at lines 515-521 calls isInExcludedRegion then findExcludedRegionAt.
    // Lines 519-521 are the defensive fallback when findExcludedRegionAt returns null.
    // We exercise the region-skipping loop by placing multiple comments between and/then.
    test('should handle and then with multiple comments between and and then', () => {
      // Multiple excluded regions (comments) between 'and' and 'then'
      // The backward scan must skip through two separate comment regions
      const source = `if A and -- first comment
-- second comment
then B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should handle and then with string literal between and and then', () => {
      // String literal (excluded region) between 'and' and 'then'
      // The backward scan crosses a string excluded region
      const source = `X := "test";
if A and "value"
then B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    // Lines 738-741: isOrElseShortCircuit encounters a comment between 'or' and 'else'
    // The '--' comment handling branch (lines 738-741) skips the comment characters
    test('should treat or else as short-circuit when comment appears between or and else', () => {
      const source = `if A or -- this is a comment
else B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      // 'or' and 'else' should be removed as short-circuit operator; only 'then' remains
      assertIntermediates(pairs[0], ['then']);
    });

    test('should treat or else as short-circuit with multiple comments between or and else', () => {
      // Two comment lines between or and else
      const source = `if X or -- first comment
-- second comment
  else Y then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Regression: multi-line for representation clause', () => {
    test('should not treat multi-line for representation clause as loop', () => {
      const pairs = parser.parse('procedure P is\n  for Color\n    use (Red => 0, Green => 1, Blue => 2);\nbegin\n  null;\nend P;');
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Regression: Unicode adjacency in tokenize', () => {
    test('should not detect keywords adjacent to Unicode letters', () => {
      const pairs = parser.parse('\u03B1end\nif True then\n  null;\nend if;');
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: matchCharacterLiteral qualified expression', () => {
    test('should treat tick before ( preceded by identifier as attribute tick, not character literal', () => {
      // Integer'(X) is a qualified expression: the tick before ( preceded by identifier
      // matchCharacterLiteral should return { start: pos, end: pos + 1 } (lines 41-42)
      const source = "if Integer'(X) > 0 then\n  null;\nend if;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should treat tick before ( in qualified expression without disrupting parsing', () => {
      // Another qualified expression pattern: Type_Name'(Value)
      const source = "procedure P is\nbegin\n  X := My_Type'(42);\nend P;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should handle qualified expression where char after ( is tick', () => {
      // Covers adaHelpers.ts lines 41-42: matchCharacterLiteral sees '(' pattern
      // where source[pos+1]='(' and source[pos+2]="'" and pos-1 is identifier char
      // T'('x') is a qualified expression T'( followed by char literal 'x' and )
      const source = "if T'('x') = C then\n  null;\nend if;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: isOrElseShortCircuit with non-excluded comment', () => {
    test('should skip -- comment between or and else when not in excluded region', () => {
      // isOrElseShortCircuit scans between or end offset and else start offset
      // Lines 73-79: encounters -- comment that is NOT in the excluded regions set
      // (because isOrElseShortCircuit gets isInExcluded callback that checks parser excluded regions,
      // but the comment between or/else tokens is in the raw source gap)
      const source = 'if A or -- inline comment\nelse B then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      // or and else should be removed as short-circuit operator; only then remains
      assertIntermediates(pairs[0], ['then']);
    });

    test('should return false from isOrElseShortCircuit when non-whitespace non-comment exists', () => {
      // Line 78: return false when non-whitespace, non-comment character found between or and else
      // In a select block, statements between or and else prevent short-circuit detection
      const source = 'select\n  accept A;\nor\n  X := 1;\nelse\n  null;\nend select;';
      const pairs = parser.parse(source);
      const selectPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectPair);
      const intermediates = selectPair.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'));
      assert.ok(intermediates.includes('else'));
    });
  });

  suite('Coverage: or else backward scan through excluded region', () => {
    test('should scan backward through comment before or to find semicolon in select', () => {
      // Lines 277-284: backward scan from 'or' hits an excluded region (comment)
      // before finding ';'. The code calls findExcludedRegionAt and skips the region.
      const source = 'select\n  accept A; -- comment before or\nor\n  delay 1.0;\nelse\n  null;\nend select;';
      const pairs = parser.parse(source);
      const selectPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectPair);
      const intermediates = selectPair.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'));
      assert.ok(intermediates.includes('else'));
    });

    test('should scan backward through string literal before or in select context', () => {
      // Lines 277-284: backward scan crosses a string excluded region before finding ;
      const source = 'select\n  accept A;\n  Put("msg"); -- done\nor\nelse\n  null;\nend select;';
      const pairs = parser.parse(source);
      const selectPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectPair);
      const intermediates = selectPair.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'));
      assert.ok(intermediates.includes('else'));
    });
  });

  suite('Regression: or else with identifiers ending in select', () => {
    test('should filter or else when preceded by identifier ending with select', () => {
      const source = 'if Aselect or else B then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should filter or else when preceded by identifier with underscore select', () => {
      const source = 'if my_select or else flag then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should still recognize or else in real select block', () => {
      const source = 'select\n  accept A;\nor\n  delay 1.0;\nelse\n  null;\nend select;';
      const pairs = parser.parse(source);
      const selectPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'select');
      assert.ok(selectPair);
      const intermediates = selectPair.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('or'));
      assert.ok(intermediates.includes('else'));
    });
  });

  suite('Coverage: and then backward scan findExcludedRegionAt null branch', () => {
    test('should handle backward scan where isInExcludedRegion is true but findExcludedRegionAt returns null', () => {
      // Lines 304-305: the else branch when findExcludedRegionAt returns null
      // This is a defensive fallback. We exercise the normal region-skipping path
      // and also ensure the j-- fallback works by having a character at the boundary
      // of an excluded region where binary search behavior may differ between the two methods.
      const source = 'if X > 0 and -- comment\nthen Y > 0 then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Coverage: isValidForOpen non-identifier after for', () => {
    test('should treat for followed by non-identifier as valid block open', () => {
      // Covers adaValidation.ts lines 188-189: isValidForOpen returns true
      // when for is not followed by an identifier (e.g., followed by a number)
      const source = 'for 123';
      const pairs = parser.parse(source);
      // for is treated as valid block open but has no matching end
      assertNoBlocks(pairs);
    });

    test('should treat for at end of source as valid block open', () => {
      // Covers adaValidation.ts lines 188-189: i >= source.length branch
      const source = 'for';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: entry with is followed by non-body keywords', () => {
    test('should not treat entry with is abstract as block opener', () => {
      // Covers adaParser.ts lines 71-72: entry is abstract
      const source = 'protected type Obj is\n  entry E is abstract;\nend Obj;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should not treat entry with is separate as block opener', () => {
      // Covers adaParser.ts lines 71-72: entry is separate
      const source = 'protected type Obj is\n  entry E is separate;\nend Obj;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should not treat entry with is new as block opener', () => {
      // Covers adaParser.ts lines 71-72: entry is new
      const source = 'protected type Obj is\n  entry E is new Generic_Entry;\nend Obj;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });

    test('should not treat entry with is null as block opener', () => {
      // Covers adaParser.ts lines 71-72: entry is null
      const source = 'protected type Obj is\n  entry E is null;\nend Obj;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'protected', 'end');
    });
  });

  suite('Coverage: entry with is <> generic default', () => {
    test('should not treat entry with is <> as block opener', () => {
      // Covers adaParser.ts lines 73-75: entry is <>
      const source = 'generic\n  with entry E is <>;\nprocedure P is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Coverage: type/subtype after semicolon on same line skips is', () => {
    test('should skip is when type appears after semicolon on same line', () => {
      // Covers adaParser.ts lines 217-218: type after semicolon
      // Line starts with "type", has ";", then another "type" before "is"
      const source = 'type A is (X); type B is range 1 .. 10;\nif True then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should skip is when subtype appears after semicolon on same line', () => {
      // Covers adaParser.ts lines 217-218: subtype after semicolon
      const source = 'type A is (X); subtype S is Integer range 1 .. 10;\nif True then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: Ada 2012 expression function', () => {
    test('should not treat expression function as block opener', () => {
      // Covers adaValidation.ts lines 94-95: function is (expr)
      const source = 'function Is_Positive(X : Integer) return Boolean is (X > 0);\nif True then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat expression function with complex expression as block opener', () => {
      // Covers adaValidation.ts lines 94-95: function is (expr) with nested parens
      const source = 'function Add(A, B : Integer) return Integer is (A + B);\nprocedure P is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
    });
  });

  suite('Coverage: isOrElseShortCircuit direct tests', () => {
    test('should return false when single dash appears between or and else', () => {
      // Covers adaHelpers.ts line 80: non-whitespace, non-comment char
      const source = 'or - else';
      const result = isOrElseShortCircuit(source, 2, 4, () => false);
      assert.strictEqual(result, false);
    });

    test('should skip -- comment and return true', () => {
      // Covers adaHelpers.ts lines 75, 77-78: comment detection within isOrElseShortCircuit
      const source = 'or -- comment\n else';
      const result = isOrElseShortCircuit(source, 2, 15, () => false);
      assert.strictEqual(result, true);
    });

    test('should return false when non-whitespace char follows comment', () => {
      // Covers adaHelpers.ts lines 75, 77-78, 80: comment then non-whitespace
      const source = 'or -- comment\nX else';
      const result = isOrElseShortCircuit(source, 2, 16, () => false);
      assert.strictEqual(result, false);
    });

    test('should return true when only whitespace exists between or and else', () => {
      const source = 'or   else';
      const result = isOrElseShortCircuit(source, 2, 5, () => false);
      assert.strictEqual(result, true);
    });
  });

  // Regression: backward type scan should not skip is when declaration keyword intervenes
  suite('Regression: type scan with intervening declarations', () => {
    test('should not skip is when procedure follows unterminated type', () => {
      const source = 'type T\nprocedure P(X : Integer) is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      const procBlock = findBlock(pairs, 'procedure');
      const isIntermediate = procBlock.intermediates.some((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediate, true, 'is should be intermediate of procedure');
    });

    test('should not skip is when function follows unterminated type', () => {
      const source = 'type T\nfunction F return Integer is\nbegin\n  return 1;\nend F;';
      const pairs = parser.parse(source);
      const funcBlock = findBlock(pairs, 'function');
      const isIntermediate = funcBlock.intermediates.some((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediate, true, 'is should be intermediate of function');
    });

    test('should still skip is for actual type declaration', () => {
      const source = 'type T is new Integer;\nprocedure P is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      const procBlock = findBlock(pairs, 'procedure');
      const isIntermediate = procBlock.intermediates.some((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediate, true, 'is should be intermediate of procedure');
    });
  });

  suite('Regression: entry in COMPOUND_END_TYPES', () => {
    test('should detect entry...end entry pair with compound close keyword', () => {
      const source = 'entry Read(V : out Integer) when Count > 0 is\nbegin\n  V := Value;\nend entry;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entry', 'end entry');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    // BUG 1: Backward scan for type declaration crosses unrelated non-type lines
    // The backward scan in the 'is' filtering logic continues past non-type, non-comment
    // lines and can find a 'type' keyword many lines back, incorrectly filtering 'is'.
    // The 'case' keyword is not in the separator keyword list, so when there's a
    // type declaration above without a semicolon, and a multi-line case statement below,
    // the 'is' after 'case' gets incorrectly filtered.
    test('BUG1: should not filter is in multi-line case when type without semicolon exists above', () => {
      const source = 'type T\ncase X\n  is\n  when 1 => null;\n  when others => null;\nend case;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('is'), 'is should be an intermediate of case (not filtered as type is)');
    });

    // Type declaration with name on a separate line between type and is
    test('BUG1: should filter is when identifier line exists between type and is', () => {
      const source = 'type T\nX_Value\n  is';
      const tokens = parser.getTokens(source);
      const isToken = tokens.find((t) => t.value.toLowerCase() === 'is');
      assert.ok(!isToken, 'is should be filtered as part of type declaration');
    });

    // BUG 2: lineBefore ending with ')' triggers backward scan that finds distant type
    // When 'is' is on the same line as an expression ending with ')', and there's a
    // type declaration on a previous line without a semicolon, the 'is' gets incorrectly
    // filtered because the backward scan finds the type and no separator keyword is found.
    test('BUG2: should not filter is when preceded by non-type paren expression and type exists above', () => {
      const source = 'type T\nMy_Func(X) is';
      const tokens = parser.getTokens(source);
      const isToken = tokens.find((t) => t.value.toLowerCase() === 'is');
      assert.ok(isToken, 'is should be present as a token (not filtered by distant type)');
    });

    // BUG 3: Backward scan crosses balanced-paren line via scanParenDepth tracking
    // When 'is' is on a line with unmatched ')', the backward scan tracks paren depth.
    // A line with balanced parens like 'func(x)' temporarily increases scanParenDepth,
    // preventing the break condition from triggering. This allows the scan to reach
    // a distant 'type' keyword that is completely unrelated to the 'is'.
    test('BUG3: should not filter is when balanced-paren line exists between type and unmatched-paren is', () => {
      const source = 'type T\nfunc(x)\nresult) is';
      const tokens = parser.getTokens(source);
      const isToken = tokens.find((t) => t.value.toLowerCase() === 'is');
      assert.ok(isToken, 'is should be present (balanced-paren line should not bridge to distant type)');
    });

    // BUG 3 variant: multiple balanced-paren lines between type and is
    test('BUG3: should not filter is when multiple balanced-paren lines exist between type and is', () => {
      const source = 'type T\nfunc1(x)\nfunc2(y)\nresult) is';
      const tokens = parser.getTokens(source);
      const isToken = tokens.find((t) => t.value.toLowerCase() === 'is');
      assert.ok(isToken, 'is should be present (multiple balanced-paren lines should not bridge)');
    });
  });

  suite('Regression: access on previous line should not suppress procedure/function', () => {
    test('should detect procedure after access type on previous line', () => {
      const source = 'type Handler is access\nprocedure P is\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should detect function after access type on previous line', () => {
      const source = 'type Handler is access\nfunction F return Integer is\nbegin\n  return 1;\nend F;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Regression: is in mid-line type declaration', () => {
    test('should filter is in mid-line type declaration', () => {
      const source = 'procedure Test is type T is range 1..10;\nbegin\n  null;\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression: is in type with multi-line discriminant filtered correctly', () => {
    test('should filter is in type with multi-line discriminant list', () => {
      const source = 'procedure P is\n  type T\n    (D1 : Integer;\n     D2 : Integer)\n    is range 1 .. 100;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const isCount = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is').length;
      assert.strictEqual(isCount, 1, 'should have exactly one is intermediate (the procedure is)');
    });
  });

  suite('Regression: paren tracking in excluded regions for is type-declaration filter', () => {
    test('should skip comment containing open paren inside discriminant list', () => {
      const source = 'procedure P is\n  type T(\n    D : Integer -- (\n    )\n    is range 1 .. 100;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should skip string containing open paren inside discriminant list', () => {
      const source = 'procedure P is\n  type T(\n    D : String := "("\n    )\n    is range 1 .. 100;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression: lineParenDepth skips excluded regions in is type-declaration filter', () => {
    test('should filter is when string containing paren is on same line as closing paren', () => {
      const source = 'procedure P is\n  type T(\n    D : Integer\n    ) "(" is range 1..100;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression: type on separate line from is', () => {
    test('should filter is when type is on its own line', () => {
      const source = 'procedure Main is\nbegin\n  type\n    Percent\n  is range 0..100;\nend Main;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should filter is when subtype is on its own line', () => {
      const source = 'procedure Main is\nbegin\n  subtype\n    Small\n  is Integer range 1..10;\nend Main;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression: compound end should not merge begin when opener is not a context keyword', () => {
    test('should not merge begin with if when end if closes if+begin', () => {
      const source = 'if X then\n  begin\n    null;\nend if;';
      const pairs = parser.parse(source);
      // if/end if should pair, begin should be left unmatched
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not merge begin with loop when end loop closes loop+begin', () => {
      const source = 'loop\n  begin\n    null;\nend loop;';
      const pairs = parser.parse(source);
      // loop/end loop should pair, begin should be left unmatched
      assertSingleBlock(pairs, 'loop', 'end loop');
    });
  });

  suite('Regression: type/subtype inside parentheses should not suppress is intermediate', () => {
    test('should include is in intermediates when Type appears as parameter type', () => {
      const source = 'procedure X(Param : Type) is\nbegin\n  null;\nend X;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should include is in intermediates when Subtype appears as parameter type', () => {
      const source = 'function F(X : Subtype) return Integer is\nbegin\n  null;\nend F;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression: is intermediate when protected/task is on previous line', () => {
    test('should detect is intermediate when protected is on previous line', () => {
      const pairs = parser.parse('protected\ntype Foo is\n  entry Bar;\nend Foo;');
      assertSingleBlock(pairs, 'protected', 'end');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should detect is intermediate when task is on previous line', () => {
      const pairs = parser.parse('task\ntype T is\n  entry E;\nend T;');
      assertSingleBlock(pairs, 'task', 'end');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should detect is intermediate when protected, type, and is are on 3 separate lines', () => {
      const pairs = parser.parse('protected\ntype Foo\nis\n  entry Bar;\nend Foo;');
      assertSingleBlock(pairs, 'protected', 'end');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should detect is intermediate when task, type, and is are on 3 separate lines', () => {
      const pairs = parser.parse('task\ntype T\nis\n  entry E;\nend T;');
      assertSingleBlock(pairs, 'task', 'end');
      assertIntermediates(pairs[0], ['is']);
    });
  });

  suite('Regression: compound end should respect Unicode letter adjacency', () => {
    test('should not match end if as compound end when type part is adjacent to Unicode letter', () => {
      const source = 'if True then\n  null;\nend if\u03b1;';
      const tokens = parser.getTokens(source);
      // 'end ifα' should NOT be tokenized as compound 'end if' (ifα is an identifier)
      const compoundEndTokens = tokens.filter((t) => t.value.toLowerCase() === 'end if');
      assert.strictEqual(compoundEndTokens.length, 0, 'should not detect compound end if');
      // 'end' alone should still be detected as block_close
      const endTokens = tokens.filter((t) => t.value.toLowerCase() === 'end');
      assert.strictEqual(endTokens.length, 1, 'standalone end should be detected');
    });
  });

  suite('Regression: parenthesized conditional expression intermediates', () => {
    test('should not leak else from parenthesized if expression', () => {
      const pairs = parser.parse('procedure P is\nbegin\n  X := (if A then B else C);\nend P;');
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should not leak then/else from parenthesized if in if block', () => {
      const pairs = parser.parse('if Condition then\n  X := (if A then B else C);\nend if;');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should not leak is/when from parenthesized case expression', () => {
      const pairs = parser.parse('procedure P is\nbegin\n  X := (case Y is when 1 => A, when others => B);\nend P;');
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });
  });

  suite('Regression 2026-04-11: extended return and exception declarations', () => {
    test('should detect extended return block (Ada 2005+)', () => {
      const source = 'function F return Integer is\nbegin\n  return R : Integer := 0 do\n    R := 42;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const returnBlock = findBlock(pairs, 'return');
      assert.strictEqual(returnBlock.closeKeyword.value.toLowerCase(), 'end return');
    });

    test('should not treat simple return statement as a block opener', () => {
      const pairs = parser.parse('procedure X is begin return; end X;');
      assertSingleBlock(pairs, 'procedure', 'end');
    });

    test('should not treat return expression as a block opener', () => {
      const pairs = parser.parse('function F return Integer is begin return 42; end F;');
      assertSingleBlock(pairs, 'function', 'end');
    });

    test('should not leak exception from variable declaration as intermediate', () => {
      const source = 'package P is\n  Stack_Overflow : exception;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should still treat exception as intermediate for handler section', () => {
      const source = 'procedure P is\n  My_Error : exception;\nbegin\n  null;\nexception\n  when My_Error => null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      assertIntermediates(pairs[0], ['is', 'begin', 'exception', 'when']);
    });

    test('should not leak exception after raise as intermediate', () => {
      const source = 'begin\n  raise Exception;\nexception\n  when others => null;\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assertIntermediates(pairs[0], ['exception', 'when']);
    });

    test('should not leak exception after new as intermediate', () => {
      const source = 'package P is\n  type My_Error is new Exception;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end');
      assertIntermediates(pairs[0], ['is']);
    });
  });

  suite('Regression: compound end split across newlines and comments', () => {
    test('should match "end\\n  if" as a compound end if token', () => {
      const source = 'if A then\n  if B then\n    null;\n  end\n  if;\nend if;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const outer = pairs.find((p) => p.openKeyword.startOffset === 0);
      assert.ok(outer, 'should find outer if block at nest 0');
      assert.strictEqual(outer.nestLevel, 0);
      const inner = pairs.find((p) => p.openKeyword.startOffset === 12);
      assert.ok(inner, 'should find inner if block at nest 1');
      assert.strictEqual(inner.nestLevel, 1);
    });

    test('should allow line comment between end and type keyword', () => {
      const source = 'if A then\n  null;\nend -- trailing comment\nif;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'if');
    });
  });

  suite('Regression: Ada 2012 expression function is should not leak as intermediate', () => {
    test('should not include is from expression function in enclosing package intermediates', () => {
      const source = 'package P is\n  function Square(X : Integer) return Integer is (X * X);\nend P;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Only the package's own 'is' should appear as an intermediate
      const isCount = intermediates.filter((v) => v === 'is').length;
      assert.strictEqual(isCount, 1, `expected exactly 1 'is' intermediate, got ${isCount}`);
    });

    test('should not leak expression function is through enclosing procedure body', () => {
      const source = 'procedure Main is\n  function Square(X : Integer) return Integer is (X * X);\nbegin\n  null;\nend Main;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      const isCount = intermediates.filter((v) => v === 'is').length;
      assert.strictEqual(isCount, 1, `expected exactly 1 'is' intermediate, got ${isCount}`);
    });
  });

  suite('Regression: comment-ending task/protected does not break is filter', () => {
    test('should not leak type-decl is when previous line ends with task in a comment', () => {
      const source =
        'package body Pkg is\n  -- This is a workhorse task\n  type Worker_Type\n    is record\n      ID : Integer;\n    end record;\nend Pkg;';
      const pairs = parser.parse(source);
      const pkgPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'package');
      assert.ok(pkgPair, 'package body should be paired');
      const isCount = pkgPair.intermediates.filter((t) => t.value.toLowerCase() === 'is').length;
      assert.strictEqual(isCount, 1, 'package body should have exactly one is intermediate');
    });

    test('should not leak type-decl is when previous line ends with protected in a comment', () => {
      const source = 'package body Pkg is\n  -- protected\n  type T is range 1..10;\nend Pkg;';
      const pairs = parser.parse(source);
      const pkgPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'package');
      assert.ok(pkgPair, 'package body should be paired');
      const isCount = pkgPair.intermediates.filter((t) => t.value.toLowerCase() === 'is').length;
      assert.strictEqual(isCount, 1, 'package body should have exactly one is intermediate');
    });
  });

  suite('Regression 2026-04-29: unterminated paren before if block', () => {
    test('should still detect if block when ( is unterminated with terminated string after', () => {
      const source = 'procedure Main is\nbegin\n   F("hello"\n   if X > 0 then\n      null;\n   end if;\nend Main;';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(ifPair, 'if block should be detected');
    });
    test('should still detect if block when ( is unterminated with newline after', () => {
      const source = 'F(\nif True then\n  null;\nend if;';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(ifPair, 'if block should be detected');
    });
  });

  suite('Regression: compound end with embedded comment / CR', () => {
    test('should pair for-loop with end loop when -- comment intervenes between end and loop', () => {
      const source = 'for I in 1..10 loop\n  if A then\n    null;\n  end -- comment\nloop;';
      const pairs = parser.parse(source);
      const forPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'for');
      assert.ok(forPair, 'for-loop should pair with end loop (compound) even with embedded comment');
    });
  });

  suite('Regression 2026-05-16: simple end followed by return statement must not merge', () => {
    test('should not merge end<newline>return<identifier> into a compound end return', () => {
      // An Ada 2012 extended return closes with `end return;` (no designator).
      // A simple `end` on one line followed by `return Tmp;` on the next is a
      // block close plus an independent return statement, and the two must not
      // be collapsed into a compound `end return`. Otherwise the enclosing
      // declare block loses its closing `end` and is orphaned.
      const source =
        'function Compute return Integer is\nbegin\n  declare\n    Tmp : Integer := 0;\n  begin\n    Tmp := 5;\n  end\n  return Tmp;\nend Compute;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const declarePair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'declare');
      assert.ok(declarePair, 'declare block must be paired');
      assert.strictEqual(declarePair.closeKeyword.value.toLowerCase(), 'end');
      const functionPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'function');
      assert.ok(functionPair, 'function block must be paired');
    });

    test('should still recognize end return; as a compound end of an extended return', () => {
      const source = 'function F return Integer is\nbegin\n  return R : Integer := 0 do\n    R := 42;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const returnBlock = findBlock(pairs, 'return');
      assert.match(returnBlock.closeKeyword.value.toLowerCase(), /^end\s+return$/);
    });

    test('should keep end; and return statement separate when on the same line', () => {
      // `end; return Foo;` — the `;` after `end` already terminates the close;
      // the following `return Foo;` is an independent statement.
      const source = 'function F return Integer is\nbegin\n  declare\n    Foo : Integer := 1;\n  begin\n    null;\n  end; return Foo;\nend F;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const declarePair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'declare');
      assert.ok(declarePair, 'declare block must be paired');
      assert.strictEqual(declarePair.closeKeyword.value.toLowerCase(), 'end');
    });
  });

  suite('Regression: when intermediate inside Ada 2012 extended-return', () => {
    test('should attach when as intermediate of return block when used in exception handler', () => {
      const source =
        'function F return Integer is\nbegin\n  return R : Integer := 0 do\n    R := 5;\n  exception\n    when others => null;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return should be paired');
      const whenIntermediates = returnPair.intermediates.filter((i) => i.value.toLowerCase() === 'when');
      assert.ok(whenIntermediates.length >= 1, 'when should attach to return block intermediates');
    });
  });

  suite('Regression: mid-line type/subtype with multi-line is continuation', () => {
    test('should not leak is from mid-line type with multi-line continuation', () => {
      const source = 'procedure P is\n  X : Integer; type T (D : Integer)\n    is range 1..100;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      // Only the procedure's own `is` (and `begin`) should appear; the inner type T is range
      // declaration's `is` should not leak.
      assert.strictEqual(intermediates.filter((v) => v === 'is').length, 1);
    });
  });

  suite('Regression 2026-05-06: extended-return with := in trailing comment', () => {
    test('should detect extended-return body when comment ends with := before do', () => {
      const source = 'function F return Integer is\nbegin\n  return X : Integer -- := \n  do\n    R := 1;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return block should still pair when := appears in a comment');
      assert.strictEqual(returnPair?.closeKeyword.value.toLowerCase(), 'end return');
    });
  });

  suite('Regression 2026-05-09: extended-return with := followed by string literal expression', () => {
    test('should detect extended-return block when := is followed by a string literal expression before do', () => {
      const source = 'function F return String is\nbegin\n  return X : String := "hello" do\n    null;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return block should pair when := is followed by a string expression');
      assert.strictEqual(returnPair?.closeKeyword.value.toLowerCase(), 'end return');
      assertBlockCount(pairs, 2);
      const functionPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'function');
      assert.ok(functionPair, 'function block should be paired');
    });

    test('should detect extended-return block when := is followed by a character literal expression before do', () => {
      const source = "function F return Character is\nbegin\n  return X : Character := 'a' do\n    null;\n  end return;\nend F;";
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return block should pair when := is followed by a character expression');
      assert.strictEqual(returnPair?.closeKeyword.value.toLowerCase(), 'end return');
    });
  });

  suite('Regression 2026-05-06: mid-line is type continuation', () => {
    test('should not leak is when type T follows is on previous line with no semicolon', () => {
      const source = 'procedure P is type T\n  is range 1..10;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      const isCount = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is').length;
      assert.strictEqual(isCount, 1, 'only procedure header is should appear; type-decl is should be filtered');
    });

    test('should not leak is when type T has trailing comment before continuation is', () => {
      const source = 'procedure P is type T --comment\n  is range 1..10;\nbegin\n  null;\nend P;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end');
      const isCount = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is').length;
      assert.strictEqual(isCount, 1);
    });
  });

  suite('Regression 2026-05-06: compound end with NBSP separator', () => {
    test('should pair if/end if when separator is U+00A0 (NBSP)', () => {
      const source = 'if A then\nnull;\nend if;';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'if');
      assert.match(pairs[0].closeKeyword.value.toLowerCase(), /^end\s+if$/);
    });
  });

  suite('Regression 2026-05-08: exit when X inside begin must not register when as intermediate', () => {
    test('should leave begin intermediates empty when exit when is used without exception handler', () => {
      const source = 'begin\n   exit when X;\nend;';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      assert.deepStrictEqual(pairs[0].intermediates, []);
    });
    test('should still register when as intermediate when exception handler is present', () => {
      const source = 'begin\n   x := 1;\nexception\n   when others => null;\nend;';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      const middleValues = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.deepStrictEqual(middleValues, ['exception', 'when']);
    });
  });

  suite('Regression 2026-05-09: extended-return with Unicode identifier', () => {
    test('should detect extended-return block when object name starts with non-ASCII letter', () => {
      const source = 'function F return Integer is\nbegin\n  return Ñame : Integer do\n    null;\n  end return;\nend F;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return block with Unicode identifier should be paired');
      assert.strictEqual(returnPair.closeKeyword.value.toLowerCase(), 'end return');
      assert.strictEqual(returnPair.nestLevel, 1);
      const functionPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'function');
      assert.ok(functionPair, 'function block should be paired');
      assert.strictEqual(functionPair.nestLevel, 0);
    });
  });

  suite('Regression 2026-05-09: compound end pattern must not consume next if', () => {
    test('should not greedily merge end<newline>if with the following independent if block', () => {
      const source = 'if A then null;\nend\nif Cond then null; end if;\n';
      const pairs = parser.parse(source);
      // Expect two independent if blocks: the first `if A then` closed by simple `end`,
      // and the second `if Cond then` closed by `end if;`.
      assertBlockCount(pairs, 2);
      const firstIf = pairs.find((p) => p.openKeyword.startOffset === 0);
      assert.ok(firstIf, 'first if block should be paired');
      // First closer is the bare `end` (not compound) — its value should be exactly "end".
      assert.strictEqual(firstIf.closeKeyword.value.toLowerCase(), 'end');
      // Second if block — its open keyword should be the second `if` and close should be `end if`.
      const secondIf = pairs.find((p) => p !== firstIf && p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(secondIf, 'second if block (independent) should also be paired');
      assert.match(secondIf.closeKeyword.value.toLowerCase(), /^end\s+if$/);
    });
  });

  suite('Regression 2026-05-09: compound end forced fallback removal', () => {
    test('should not force-pair if with end loop when no for/while/loop opener exists', () => {
      // Two opens but mismatched compound ends: outer `if` + inner `if` + `end loop` + `end if`.
      // Expected: end loop must not force-match an `if` opener (no forced fallback);
      // the LIFO close `end if` pairs with the most recent `if` (the inner one).
      // The outer if and end loop are left as orphans (best-effort parsing:
      // prefer no color over wrong color).
      const source = `if A then
  if B then
    null;
end loop;
end if;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const innerIf = pairs[0];
      assert.strictEqual(innerIf.openKeyword.value.toLowerCase(), 'if');
      assert.match(innerIf.closeKeyword.value.toLowerCase(), /^end\s+if$/);
      // The paired if must be the inner one (not the outer one which is left as orphan).
      assert.strictEqual(innerIf.openKeyword.startOffset, 12);
    });

    test('should leave end loop unpaired when the only opener is an if', () => {
      // Single opener that does not match end loop: must produce zero pairs.
      const source = `if Condition then
  X := 1;
end loop;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should leave end procedure unpaired when the only opener is an if', () => {
      const source = `if Condition then
  X := 1;
end procedure;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression 2026-05-10: and-then short-circuit only collapses a standalone and keyword', () => {
    test('should keep both then tokens for Test_and then (and is part of an identifier)', () => {
      // Malformed input: `Test_and then` is not a valid `and then` short-circuit
      // because `_and` is part of the identifier `Test_and` — `and` has no left
      // word boundary. The short-circuit collapse only fires for a standalone
      // `and` keyword, so both `then` tokens (the one after `Test_and` and the
      // genuine if-`then`) remain as intermediates. The if/end-if pair itself is
      // still correct.
      const source = 'if Test_and then B then null; end if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'then']);
    });

    test('should keep both then tokens for 1and then (and is part of an invalid identifier)', () => {
      // Malformed input: `1and` is an invalid identifier (digits cannot start an
      // identifier in Ada). `and` has no left word boundary, so the short-circuit
      // collapse does not apply and both `then` tokens are kept as intermediates.
      const source = 'if 1and then B then null; end if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'then']);
    });
  });

  suite('Regression 2026-05-15: compound end lookahead must not consume next block opener as designator', () => {
    test('should not greedily merge end<newline>loop with the following independent loop block', () => {
      // The lookahead for the optional designator after `end <type>` must not
      // consume a subsequent block opener keyword (here: `loop`). Without the
      // guard, `end\nloop\n  null;\nend loop;` is misread as `end\nloop loop`
      // (with `loop` as a designator-like identifier), which prevents pairing
      // of both the preceding `if` and the following `loop` blocks.
      const source = 'if X then\n  null;\nend\nloop\n  null;\nend loop;\n';
      const pairs = parser.parse(source);
      // Expect two independent blocks: the first `if X then` closed by simple
      // `end`, and the second `loop ... end loop;`.
      assertBlockCount(pairs, 2);
      const firstIf = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(firstIf, 'first if block should be paired');
      assert.strictEqual(firstIf.closeKeyword.value.toLowerCase(), 'end');
      const loopBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'loop');
      assert.ok(loopBlock, 'loop block (independent) should also be paired');
      assert.match(loopBlock.closeKeyword.value.toLowerCase(), /^end\s+loop$/);
    });

    test('should not greedily merge end<newline>case with the following case block', () => {
      const source = 'if X then\n  null;\nend\ncase Y is\n  when others => null;\nend case;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const firstIf = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(firstIf, 'first if block should be paired');
      assert.strictEqual(firstIf.closeKeyword.value.toLowerCase(), 'end');
      const caseBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.ok(caseBlock, 'case block (independent) should also be paired');
      assert.match(caseBlock.closeKeyword.value.toLowerCase(), /^end\s+case$/);
    });
  });

  suite('Regression 2026-05-16: same-line compound end without trailing semicolon', () => {
    test('should treat "end if" without trailing semicolon as a compound end inside a procedure', () => {
      // The inner `end if` is missing its trailing `;`. When `end` and the type
      // keyword are on the same line, treat them as a single (unterminated)
      // compound close so the type keyword is not misread as a fresh block
      // opener that swallows the enclosing procedure block.
      const source = 'procedure P is\nbegin\n  if X then\n    Do_Something;\n  end if\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(ifPair, 'if block should be paired');
      assert.match(ifPair.closeKeyword.value.toLowerCase(), /^end\s+if$/);
      const procPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'procedure');
      assert.ok(procPair, 'procedure block must survive');
      assert.strictEqual(procPair.closeKeyword.value.toLowerCase(), 'end');
    });

    test('should treat "end loop" without trailing semicolon as a compound end inside a procedure', () => {
      const source = 'procedure P is\nbegin\n  for I in 1..3 loop\n    Do_Something;\n  end loop\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'for');
      assert.ok(forPair, 'for-loop block should be paired');
      assert.match(forPair.closeKeyword.value.toLowerCase(), /^end\s+loop$/);
      const procPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'procedure');
      assert.ok(procPair, 'procedure block must survive');
      assert.strictEqual(procPair.closeKeyword.value.toLowerCase(), 'end');
    });

    test('should treat "end case" without trailing semicolon as a compound end inside a procedure', () => {
      const source = 'procedure P is\nbegin\n  case X is\n    when others => null;\n  end case\nend P;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const casePair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'case');
      assert.ok(casePair, 'case block should be paired');
      assert.match(casePair.closeKeyword.value.toLowerCase(), /^end\s+case$/);
      const procPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'procedure');
      assert.ok(procPair, 'procedure block must survive');
      assert.strictEqual(procPair.closeKeyword.value.toLowerCase(), 'end');
    });

    test('should still leave end<newline>loop as separate end and loop opener', () => {
      // Cross-line separator (`end` and `loop` on different lines): the `loop`
      // must remain an independent block opener, not be merged into a compound
      // end. Guards against the same-line rule over-reaching.
      const source = 'if X then\n  null;\nend\nloop\n  null;\nend loop;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const firstIf = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'if');
      assert.ok(firstIf, 'first if block should be paired');
      assert.strictEqual(firstIf.closeKeyword.value.toLowerCase(), 'end');
      const loopBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'loop');
      assert.ok(loopBlock, 'loop block (independent) should be paired');
      assert.match(loopBlock.closeKeyword.value.toLowerCase(), /^end\s+loop$/);
    });
  });

  suite('Regression 2026-05-15: compound end must not create crossed block pairs', () => {
    test('should not produce crossed pairs when end if and end loop are reversed', () => {
      // The inner `for ... loop` is closed by the outer `end loop`, while the
      // outer `if ... then` is closed by the inner `end if`. Pairing both
      // would produce two crossed BlockPairs (if/end if crosses for/end loop).
      // Anchor-set principle (CLAUDE.md, VS Code Bracket Pair Colorization):
      // prefer leaving constructs unpaired (no color) over a wrong color that
      // crosses an enclosing block. Expect zero or one pair, but never two
      // crossed pairs.
      const source = `if X then
  for I in 1..10 loop
    null;
end if;
end loop;
`;
      const pairs = parser.parse(source);
      // Crossed pair detection: no two pairs may cross each other.
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const a = pairs[i];
          const b = pairs[j];
          const aStart = a.openKeyword.startOffset;
          const aEnd = a.closeKeyword.startOffset;
          const bStart = b.openKeyword.startOffset;
          const bEnd = b.closeKeyword.startOffset;
          const aContainsB = aStart < bStart && bEnd < aEnd;
          const bContainsA = bStart < aStart && aEnd < bEnd;
          const disjoint = aEnd < bStart || bEnd < aStart;
          const isProperlyNested = aContainsB || bContainsA || disjoint;
          assert.ok(isProperlyNested, `BlockPairs ${i} and ${j} must not cross (anchor-set principle)`);
        }
      }
      // At most one pair survives (the inner-most match, or none).
      assert.ok(pairs.length <= 1, `Expected at most 1 pair, got ${pairs.length}`);
    });

    test('should not produce crossed pairs across three reversed compound ends', () => {
      // Triple-reversed: end if closes nothing valid (for/while/loop are
      // available), end loop should close the innermost loop, end case the
      // outermost case. The if opener and the misplaced end if must be
      // dropped to avoid crossing the loop pair.
      const source = `case X is
  when 1 =>
    if A then
      for I in 1..3 loop
        null;
end loop;
end if;
end case;
`;
      const pairs = parser.parse(source);
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const a = pairs[i];
          const b = pairs[j];
          const aStart = a.openKeyword.startOffset;
          const aEnd = a.closeKeyword.startOffset;
          const bStart = b.openKeyword.startOffset;
          const bEnd = b.closeKeyword.startOffset;
          const aContainsB = aStart < bStart && bEnd < aEnd;
          const bContainsA = bStart < aStart && aEnd < bEnd;
          const disjoint = aEnd < bStart || bEnd < aStart;
          assert.ok(aContainsB || bContainsA || disjoint, `BlockPairs ${i} and ${j} must not cross`);
        }
      }
    });
  });

  suite('Regression 2026-05-15: exit when inside accept/return body must not register when as intermediate', () => {
    test('should not register when as intermediate for accept body containing exit when', () => {
      // Inside an `accept ... do ... end` body, `exit when <cond>;` is the
      // loop-exit guard form, not an exception handler. The `when` token
      // must not leak into the accept block's intermediates list (it would
      // be misinterpreted as a handler arm). Mirrors the existing `begin`
      // exit-when handling: only accept `when` after an `exception`
      // intermediate has been observed.
      const source = `accept E do
  exit when X > 0;
end E;
`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
      assertIntermediates(pairs[0], []);
    });

    test('should not register when as intermediate for extended-return body containing exit when', () => {
      const source = `function F return Integer is
begin
  return R : Integer := 0 do
    exit when X > 0;
    R := 5;
  end return;
end F;
`;
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return should be paired');
      // No `when` intermediates: exit-when's `when` must not leak into the
      // return block's intermediate list.
      const whenIntermediates = returnPair.intermediates.filter((i) => i.value.toLowerCase() === 'when');
      assert.strictEqual(whenIntermediates.length, 0);
    });

    test('should still attach when intermediate in accept body after exception handler', () => {
      // Ada 2012 / accept with exception handler: `when` must still be tracked
      // when it follows an `exception` intermediate (it is a real handler arm).
      const source = `accept E do
  null;
exception
  when others => null;
end E;
`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'accept', 'end');
      // `exception` and `when` (the handler) should be intermediates.
      const intermediateValues = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediateValues.includes('exception'));
      assert.ok(intermediateValues.includes('when'));
    });

    test('should still attach when intermediate in return body after exception handler', () => {
      const source = `function F return Integer is
begin
  return R : Integer := 0 do
    R := 5;
  exception
    when others => null;
  end return;
end F;
`;
      const pairs = parser.parse(source);
      const returnPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'return');
      assert.ok(returnPair, 'extended-return should be paired');
      const intermediateValues = returnPair.intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediateValues.includes('exception'));
      assert.ok(intermediateValues.includes('when'));
    });
  });

  suite('Regression 2026-05-15: compound end with operator-symbol designator', () => {
    test('should recognize end function with operator-symbol designator "+"', () => {
      // Ada operator symbol designator: `function "+" ... end function "+";`.
      // The compound-end pattern must accept a string-literal designator
      // after `end function`, just as it accepts an identifier designator.
      const source = `function "+" (A, B : Integer) return Integer is
begin
  return A + B;
end function "+";
`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should recognize end function with operator-symbol designator "*"', () => {
      const source = `function "*" (A, B : Integer) return Integer is
begin
  return A * B;
end function "*";
`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should recognize end function with mixed string-literal and qualified designator', () => {
      // `end function Math."+";` is unusual but matches Ada's syntax for
      // qualified subprogram names ending in a string-literal designator.
      const source = `function "+" (A, B : Integer) return Integer is
begin
  return A + B;
end function "+";
function Other return Integer is
begin
  return 0;
end function Other;
`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      for (const pair of pairs) {
        assert.match(pair.closeKeyword.value.toLowerCase(), /^end\s+function$/);
      }
    });
  });

  suite('Regression 2026-05-09: Unicode whitespace in or else and short-circuit detection', () => {
    test('should treat or<NBSP>else as short-circuit (intermediates only contain then)', () => {
      // `or` and `else` separated by NBSP (U+00A0)
      const source = 'if A or else B then\nnull;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should treat and<U+2028>then as short-circuit (no double then)', () => {
      // `and` and `then` separated by line separator (U+2028)
      const source = 'if A and then B then\nnull;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should keep or and else as intermediates when select is followed by NBSP before or', () => {
      // `select` and `or` separated by NBSP — `or` must still be recognized as a select-block intermediate
      const source = 'select  \n  delay 1.0;\nor\n  delay 2.0;\nend select;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['or']);
    });

    test('should treat or<U+3000>else as short-circuit (ideographic space)', () => {
      // `or` and `else` separated by U+3000 (ideographic space, common in CJK editors)
      const source = 'if A or　else B then\nnull;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Regression 2026-05-16: identifier ending in and must not swallow the if-then intermediate', () => {
    test('should keep then intermediate after an identifier ending in and (Command)', () => {
      // `Command` ends with the letters `and`, but `and` here is part of the
      // identifier — not a standalone `and then` short-circuit operator. The
      // `then` after `Command` is the genuine if-`then` and must be tracked
      // as an intermediate.
      const source = `if Command then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should keep then intermediate after an identifier ending in and (Operand)', () => {
      const source = `if Operand then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should keep then intermediate after an identifier ending in and on an elsif branch', () => {
      // `elsif Demand then` — `Demand` ends with `and`; the `then` after it
      // is the elsif-branch `then` and must be tracked alongside `elsif`.
      const source = `if X then
  null;
elsif Demand then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'elsif', 'then']);
    });

    test('should still treat a standalone and then as a short-circuit operator', () => {
      // A genuine `and then` short-circuit: only the if-`then` is an
      // intermediate; the short-circuit's `then` is dropped.
      const source = `if A and then B then
  null;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Regression 2026-05-16: deeply nested blocks must not parse in quadratic time', () => {
    // Builds N nested `if X<i> then ... end if;` blocks.
    function buildNestedIfs(n: number): string {
      const lines: string[] = [];
      for (let i = 0; i < n; i++) {
        lines.push(`${'  '.repeat(i)}if X${i} then`);
      }
      lines.push(`${'  '.repeat(n)}null;`);
      for (let i = n - 1; i >= 0; i--) {
        lines.push(`${'  '.repeat(i)}end if;`);
      }
      return lines.join('\n');
    }

    test('should parse 1200 nested if blocks without quadratic slowdown', () => {
      const source = buildNestedIfs(1200);
      // Warm-up to stabilize against JIT and module init.
      parser.parse(source);
      const t0 = Date.now();
      const pairs = parser.parse(source);
      const elapsed = Date.now() - t0;
      assert.strictEqual(pairs.length, 1200, 'should pair all 1200 nested if blocks');
      // Pre-fix `isInsideParens` scanned from each opener back to offset 0,
      // giving O(n^2) behavior (~10s at this depth). The bounded backward scan
      // keeps each lookup O(1); the parse then stays well under the threshold.
      // The precise scaling guard is the ratio test below; this absolute bound
      // is generous (8000ms) so coverage instrumentation and CI contention do
      // not flake it, while still failing hard on the pre-fix ~10s blow-up.
      assert.ok(elapsed < 8000, `parse took ${elapsed}ms (expected < 8000ms; pre-fix was ~10s)`);
    });

    test('should not scale quadratically between 500 and 2000 nested if blocks', () => {
      const small = buildNestedIfs(500);
      const big = buildNestedIfs(2000);
      // Warm-up to stabilize timings against JIT and module init.
      parser.parse(small);
      parser.parse(big);
      const t1 = Date.now();
      parser.parse(small);
      const smallMs = Date.now() - t1;
      const t2 = Date.now();
      parser.parse(big);
      const bigMs = Date.now() - t2;
      // 4x depth: pre-fix `isInsideParens` quadratic behavior gives ~16x time;
      // with the bounded scan the `isInsideParens` cost is linear (a residual
      // sub-quadratic term from base nest-level recalculation remains, but is
      // far below the pre-fix curve). A baseline floor avoids tripping the
      // ratio on very fast small runs; 13x cleanly separates the post-fix
      // (~10x) from the pre-fix (~16x) curve with headroom on both sides.
      const baseline = Math.max(smallMs, 10);
      const ratio = bigMs / baseline;
      assert.ok(
        ratio < 13,
        `2000-deep parse took ${bigMs}ms vs 500-deep ${smallMs}ms (ratio ${ratio.toFixed(1)}x; expected < 13x, was ~16x with O(n^2) isInsideParens)`
      );
    });

    test('should still detect if inside a parenthesized conditional expression', () => {
      // The bound must not break genuine paren detection: an `if` keyword
      // inside an Ada 2012 conditional expression argument must still be
      // recognized as inside parentheses (and thus not a block opener).
      const source = 'X := F((if A then 1 else 2));\nif B then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  generateCommonTests(config);
});
