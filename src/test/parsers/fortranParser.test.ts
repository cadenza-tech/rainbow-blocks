import * as assert from 'node:assert';
import { FortranBlockParser } from '../../parsers/fortranParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('FortranBlockParser Test Suite', () => {
  let parser: FortranBlockParser;

  setup(() => {
    parser = new FortranBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'x = 1',
    tokenSource: 'if (condition) then\nend if',
    expectedTokenValues: ['if', 'then', 'end if'],
    excludedSource: "! comment\n'string'",
    expectedRegionCount: 2,
    twoLineSource: 'if (condition) then\nend if',
    nestedPositionSource: 'program test\n  do i = 1, 10\n  end do\nend program',
    nestedKeyword: 'do',
    nestedLine: 1,
    nestedColumn: 2,
    singleLineCommentSource: '! if then end if do\nif (condition) then\nend if',
    commentBlockOpen: 'if',
    commentBlockClose: 'end if',
    doubleQuotedStringSource: 'print *, "if then end if do"\nif (condition) then\nend if',
    stringBlockOpen: 'if',
    stringBlockClose: 'end if'
  };

  suite('Simple blocks', () => {
    test('should parse program block', () => {
      const source = `program hello
  print *, "Hello"
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should parse subroutine block', () => {
      const source = `subroutine mysub(x)
  integer, intent(in) :: x
  print *, x
end subroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should parse function block', () => {
      const source = `function add(a, b) result(c)
  integer, intent(in) :: a, b
  integer :: c
  c = a + b
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should parse module block', () => {
      const source = `module mymod
  implicit none
  integer :: x
end module`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'end module');
    });

    test('should parse if block', () => {
      const source = `if (condition) then
  action
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse do loop block', () => {
      const source = `do i = 1, 10
  print *, i
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should parse select case block', () => {
      const source = `select case (value)
  case (1)
    action1
  case default
    action2
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should parse block construct', () => {
      const source = `block
  integer :: x
  x = 1
end block`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'block', 'end block');
    });

    test('should parse associate block', () => {
      const source = `associate (x => array(1))
  x = x + 1
end associate`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'associate', 'end associate');
    });

    test('should parse critical block', () => {
      const source = `critical
  shared = shared + 1
end critical`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'critical', 'end critical');
    });

    test('should parse forall block', () => {
      const source = `forall (i = 1:n)
  a(i) = b(i)
end forall`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('should parse where block', () => {
      const source = `where (a > 0)
  b = sqrt(a)
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should parse interface block', () => {
      const source = `interface
  subroutine sub(x)
    integer :: x
  end subroutine
end interface`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse type block', () => {
      const source = `type :: point
  real :: x, y
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    test('should parse enum block', () => {
      const source = `enum, bind(c)
  enumerator :: red = 1, green = 2
end enum`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'enum', 'end enum');
    });

    test('should parse procedure block', () => {
      const source = `procedure myproc()
  integer :: x
end procedure`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else block', () => {
      const source = `if (condition) then
  action1
else
  action2
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should parse if-elseif-else block', () => {
      const source = `if (cond1) then
  action1
elseif (cond2) then
  action2
else
  action3
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'elseif', 'then', 'else']);
    });

    test('should parse select case with case', () => {
      const source = `select case (value)
  case (1)
    action1
  case (2)
    action2
  case default
    action3
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should parse module with contains', () => {
      const source = `module mymod
  integer :: x
contains
  subroutine mysub
  end subroutine
end module`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `program test
  do i = 1, 10
    if (i > 5) then
      print *, i
    end if
  end do
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'program', 0);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'if', 2);
    });

    test('should handle deeply nested if statements', () => {
      const source = `if (a) then
  if (b) then
    if (c) then
      action
    end if
  end if
end if`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Excluded regions - Comments', () => {
    generateExcludedRegionTests(config);

    test('should handle comment at end of line', () => {
      const source = `if (condition) then ! end if here
  action
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in single-quoted strings', () => {
      const source = `print *, 'if then end if do'
if (condition) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `print *, 'it''s an if statement'
if (condition) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Case insensitivity', () => {
    test('should handle uppercase keywords', () => {
      const source = `IF (condition) THEN
  action
END IF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END IF');
    });

    test('should handle mixed case keywords', () => {
      const source = `Program test
End Program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'Program', 'End Program');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

    test('should handle multiple subroutines', () => {
      const source = `subroutine a
end subroutine

subroutine b
end subroutine`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle simple end without type', () => {
      const source = `program test
  print *, "Hello"
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should handle named end', () => {
      const source = `program hello
  print *, "Hello"
end program hello`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle complex real-world Fortran code', () => {
      const source = `program main
  implicit none
  integer :: i, sum

  sum = 0
  do i = 1, 100
    if (mod(i, 2) == 0) then
      sum = sum + i
    end if
  end do

  print *, "Sum:", sum
end program main`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle unterminated string', () => {
      const source = `print *, 'unterminated
if (condition) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle unterminated string at end of file', () => {
      // Tests matchFortranString reaching end of source
      const source = `print *, 'unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unmatched compound end keyword', () => {
      // Tests findLastOpenerByType returning -1
      const source = `if (condition) then
  x = 1
end function`;
      const pairs = parser.parse(source);
      // end function doesn't match if - compound end no longer falls back
      assertNoBlocks(pairs);
    });

    test('should handle do while loop', () => {
      const source = `do while (condition)
  action
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should handle concatenated end keywords (endif, enddo)', () => {
      const source = `program test
  do i = 1, 10
    if (i > 5) then
      x = i
    endif
  enddo
endprogram`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair.closeKeyword.value.toLowerCase().includes('endif'));
      const doPair = findBlock(pairs, 'do');
      assert.ok(doPair.closeKeyword.value.toLowerCase().includes('enddo'));
      const progPair = findBlock(pairs, 'program');
      assert.ok(progPair.closeKeyword.value.toLowerCase().includes('endprogram'));
    });

    test('should correctly pair concatenated end with specific opener', () => {
      const source = `if (a) then
  do i = 1, 5
    x = i
  enddo
endif`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const doPair = findBlock(pairs, 'do');
      assert.ok(doPair.closeKeyword.value.toLowerCase().includes('enddo'));
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair.closeKeyword.value.toLowerCase().includes('endif'));
    });
  });

  suite('Type-bound procedure declarations', () => {
    test('should not treat type-bound procedure as block open', () => {
      const source = `type :: my_type
  integer :: x
contains
  procedure :: get_x
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    test('should not treat type-bound procedure with attribute as block open', () => {
      const source = `type :: my_type
  integer :: x
contains
  procedure, pass :: set_x
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    test('should not treat procedure with plain end', () => {
      const source = `type :: my_type
  integer :: x
contains
  procedure :: get_x
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end');
    });
  });

  suite('Module procedure', () => {
    test('should not treat module procedure as module block', () => {
      const pairs = parser.parse('submodule (parent) child\ncontains\n  module procedure my_proc\n    x = 1\n  end procedure\nend');
      assert.strictEqual(pairs.length, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'submodule');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'procedure');
    });
  });

  suite('Line continuation procedure', () => {
    test('should reject procedure with :: on continuation line', () => {
      const pairs = parser.parse('type :: my_type\n  integer :: x\ncontains\n  procedure, pass &\n    :: get_x\nend');
      assertSingleBlock(pairs, 'type', 'end', 0);
    });
  });

  generateCommonTests(config);

  suite('Concatenated compound end keywords', () => {
    test('should parse endif as block close', () => {
      const source = `if (x > 0) then
  y = 1
endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should parse enddo as block close', () => {
      const source = `do i = 1, 10
  print *, i
enddo`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'enddo');
    });

    test('should parse mixed separated and concatenated end keywords', () => {
      const source = `program main
  do i = 1, 10
    if (i > 5) then
      print *, i
    endif
  enddo
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'if', 2);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'program', 0);
    });

    test('should handle uppercase concatenated forms', () => {
      const source = `IF (X > 0) THEN
  Y = 1
ENDIF`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'ENDIF');
    });

    test('should handle concatenated endprogram', () => {
      const source = `program test
  x = 1
endprogram`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'endprogram');
    });

    test('should handle concatenated endfunction', () => {
      const source = `function foo(x)
  foo = x * 2
endfunction`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    test('should handle concatenated endsubroutine', () => {
      const source = `subroutine bar(x)
  x = x + 1
endsubroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'endsubroutine');
    });
  });

  suite('Fixed-form comments', () => {
    test('should handle * in column 1 as comment', () => {
      const source = `* This is a fixed-form comment
      program test
      end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle * at line start with keywords inside', () => {
      const source = `program test
* if then do while
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat * in middle of line as comment', () => {
      const source = `program test
  x = a * b
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Fixed-form C/c comments', () => {
    test('should ignore keywords in C column-1 comment', () => {
      const source = `C if then
program test
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should ignore keywords in lowercase c column-1 comment', () => {
      const source = `c if then
program test
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('else if handling', () => {
    test('should not treat if after else as new block', () => {
      const source = `if (x) then
else if (y) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Line continuation', () => {
    test('should parse if with then on continuation line', () => {
      const source = `if (condition) &
  then
  x = 1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse if with continuation and leading ampersand', () => {
      const source = `if (very_long_condition .and. &
  &another_condition) then
  x = 1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: if validation with excluded regions', () => {
    test('should skip excluded region when validating if-then', () => {
      // Tests the excluded region skip inside isValidBlockOpen for if
      const source = `if (x > 0) 'not then' then
  y = 1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Fixed-form C/c comment', () => {
    test('should treat C in column 1 followed by space as comment', () => {
      const source = `C this is a comment with if then
      if (x > 0) then
        y = 1
      end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should treat c in column 1 followed by number as comment', () => {
      const source = `c123 data line
      do i = 1, 10
        x = x + 1
      end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should not treat c-starting keyword as comment', () => {
      const source = `critical
  shared = shared + 1
end critical`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'critical', 'end critical');
    });

    test('should treat C followed by special char as comment', () => {
      const source = `C!---separator---
      if (x > 0) then
        y = 1
      end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should treat C at EOF as comment', () => {
      const source = `if (x > 0) then
  y = 1
end if
C`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('select type pairing', () => {
    test('should not push type as separate block opener after select', () => {
      const source = `select type (x)
  type is (integer)
    y = 1
  type is (real)
    y = 2
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should still allow standalone type block', () => {
      const source = `type :: MyType
  integer :: value
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });
  });

  suite('Select type guards', () => {
    test('should not treat type is(...) as block opener', () => {
      const source = 'select type (x)\n  type is (Integer)\n    print *, "int"\nend select';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'select');
    });

    test('should not treat TYPE IS (...) as block opener (case insensitive)', () => {
      const source = 'SELECT TYPE (x)\n  TYPE IS (REAL)\n    PRINT *, "real"\nEND SELECT';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
    });

    test('should still treat type definition as block opener', () => {
      const source = 'type :: MyType\n  integer :: x\nend type';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'type');
    });
  });

  suite('Fixed-form C/c comments (heuristic)', () => {
    test('should treat C followed by non-keyword text as comment', () => {
      const source = 'Chello world\nif (.true.) then\nend if';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'if');
    });

    test('should preserve critical keyword starting with C', () => {
      const source = 'critical\n  x = 1\nend critical';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].openKeyword.value.toLowerCase(), 'critical');
    });

    test('should preserve case keyword starting with C', () => {
      const source = 'select case (x)\n  case (1)\n    y = 1\nend select';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
    });

    test('should treat c (lowercase) as comment at line start', () => {
      const source = 'cthis is a comment\nif (.true.) then\nend if';
      const result = parser.parse(source);
      assert.strictEqual(result.length, 1);
    });

    test('should not treat call subroutine at column 1 as comment', () => {
      const source = `call subroutine()
if (.true.) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should treat c This is a comment as fixed-form comment', () => {
      const source = `c This is a comment
if (.true.) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: continuation with carriage return', () => {
    test('should handle continuation with CR before ampersand', () => {
      const source = 'if (condition) &\r\n  then\r\n  x = 1\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Variable declarations with keyword names', () => {
    test('should not treat do/end in variable declaration as block keywords', () => {
      const source = `program test
  integer :: do, end
  do = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat if/else in variable declaration as block keywords', () => {
      const source = `program test
  character :: if, else
  if = 'a'
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat function/procedure in variable declaration as block keywords', () => {
      const source = `program test
  real :: function, procedure
  function = 1.0
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still parse regular do block alongside declarations', () => {
      const source = `program test
  integer :: x
  do i = 1, 10
    x = i
  end do
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'program', 0);
    });
  });

  suite('Single-line where/forall', () => {
    test('should reject single-line where as block opener', () => {
      const source = `do i = 1, n
  where (a > 0) b = sqrt(a)
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should accept block where as block opener', () => {
      const source = `where (a > 0)
  b = sqrt(a)
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should reject single-line forall as block opener', () => {
      const source = `do i = 1, n
  forall (j = 1:m) a(j) = b(j)
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should accept block forall as block opener', () => {
      const source = `forall (i = 1:n)
  a(i) = b(i)
end forall`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('should accept where with comment after condition', () => {
      const source = `where (a > 0) ! apply sqrt
  b = sqrt(a)
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should accept where with continuation after condition', () => {
      const source = `where (a > 0) &
  b = sqrt(a)
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should reject single-line where inside nested block', () => {
      const source = `program test
  do i = 1, n
    where (a > 0) b = sqrt(a)
  end do
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'do', 1);
      assertNestLevel(pairs, 'program', 0);
    });

    test('should handle where without parenthesized condition', () => {
      const source = `where x
end where`;
      const pairs = parser.parse(source);
      // No opening paren, so rejected as invalid
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: continuation lines with whitespace', () => {
    test('should handle continuation with leading whitespace on next line', () => {
      const pairs = parser.parse('if (x .and. &\n    y) then\n  x = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle single-line function with continuation', () => {
      const pairs = parser.parse('pure function f(x) &\n    result(r)\n  r = x\nend function');
      assertSingleBlock(pairs, 'function', 'end function');
    });
  });

  suite('Double colon inside strings', () => {
    test('should recognize keyword after :: inside a string on same line', () => {
      const source = `program test
  character(len=20) :: msg
  msg = "type :: integer"
  if (x > 0) then
    msg = "ok"
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'program');
    });

    test('should still suppress keyword after real :: declaration', () => {
      const source = `program test
  integer :: if
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should find real :: when first :: is in string', () => {
      const source = `program test
  msg = "a :: b" :: type
  x = 1
end program`;
      const pairs = parser.parse(source);
      // 'type' after real :: should be suppressed (not a block)
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Procedure with :: in comment on continuation line', () => {
    test('should treat procedure as block when :: is only in comment', () => {
      const source = `procedure &  ! has :: in comment
  my_proc()
end procedure`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });

    test('should still treat procedure with real :: as declaration', () => {
      const source = 'procedure :: my_proc';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Select and where/forall edge cases', () => {
    test('should handle select with line continuation', () => {
      const pairs = parser.parse('select &\n  case (x)\n    y = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should skip ! comments inside where condition parentheses', () => {
      const pairs = parser.parse('where (a > 0 .and. &  ! note)\n       b < 10)\n  c = 1\nend where');
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should handle single-line where spread across multiple continuation lines', () => {
      const pairs = parser.parse('do i = 1, n\n  where (a > 0) &\n    b(i) = &\n    sqrt(a(i))\nend do');
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should not pair compound end with wrong opener type', () => {
      const pairs = parser.parse('if (x > 0) then\n  y = 1\nend function');
      assertNoBlocks(pairs);
    });

    test('should handle select type across continuation line', () => {
      const pairs = parser.parse('select &\n  type (my_type)\ntype is (integer)\n  x = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should handle select type across continuation with comment', () => {
      const pairs = parser.parse('select & ! comment\n  type (my_type)\ntype is (integer)\n  x = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should handle else if across continuation line', () => {
      const pairs = parser.parse('if (x > 0) then\n  y = 1\nelse &\n  if (x < 0) then\n  y = -1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle else if across continuation with leading &', () => {
      const pairs = parser.parse('if (x > 0) then\n  y = 1\nelse &\n  &if (x < 0) then\n  y = -1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Continuation with inline comment', () => {
    test('should parse if with & and inline comment before then', () => {
      const source = 'if (condition) & ! check something\n  then\n  x = 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat & in comment as continuation for where', () => {
      const source = 'where (a > 0)\n  b = sqrt(a)  ! comment with &\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should handle select with comment after &', () => {
      const source = `select & ! choose type\n  case ('hello')\n    print *, 'hello'\nend select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should detect single-line where after endif', () => {
      // endif follows continuation - should not be treated as block form
      const source = 'if (x) then\n  where (cond) &\n    a = b\nendif';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });
  });

  suite('Select case intermediates', () => {
    test('should preserve case intermediates in select case', () => {
      const source = `select case (x)
  case (1)
    y = 1
  case (2)
    y = 2
  case default
    y = 0
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      const caseIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'case');
      assert.strictEqual(caseIntermediates.length, 3, `Expected 3 case intermediates, got ${caseIntermediates.length}`);
    });
  });

  suite('Complex real-world scenario', () => {
    test('should handle continuation + string keywords + compound end', () => {
      const source = `program test
  character(len=50) :: msg
  msg = "end program"
  if (x > 0 .and. &
      y < 10) then
    msg = "type :: integer"
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });
  });

  suite('End as array variable', () => {
    test('should not treat end(1)(2) = 5 as block close', () => {
      const source = `program test
  integer :: end(3,3)
  end(1)(2) = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Intermediate keyword restriction by block type', () => {
    test('should not add then as intermediate for do block', () => {
      const source = `do i = 1, 10
  then
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
      const thenIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'then');
      assert.strictEqual(thenIntermediates.length, 0, 'then should not be intermediate of do block');
    });

    test('should not add case as intermediate for do block', () => {
      const source = `do i = 1, 10
  case
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
      const caseIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'case');
      assert.strictEqual(caseIntermediates.length, 0, 'case should not be intermediate of do block');
    });

    test('should still add then as intermediate for if block', () => {
      const source = `if (x > 0) then
  y = 1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should still add case as intermediate for select block', () => {
      const source = `select case (value)
  case (1)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
      const caseIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'case');
      assert.ok(caseIntermediates.length >= 1, 'case should be intermediate of select block');
    });
  });

  suite('CR-only line endings', () => {
    test('Bug 1: isAfterDoubleColon should handle CR-only line endings', () => {
      // With CR-only, lastIndexOf('\n') returns -1, treating file as one line
      // A :: on line 1 should NOT suppress keywords on line 2
      const source = 'integer :: x\rif (y > 0) then\r  z = 1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 1: isAfterDoubleColon should still suppress on same CR-only line', () => {
      const source = 'program test\rinteger :: if\rend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('Bug 2: isBlockWhereOrForall should treat standalone CR as line break', () => {
      // Standalone \r after condition = block form
      const source = 'where (a > 0)\r  b = sqrt(a)\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('Bug 2: forall with CR-only should be recognized as block form', () => {
      const source = 'forall (i = 1:n)\r  a(i) = b(i)\rend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('Bug 2: single-line where with CR-only should still be rejected', () => {
      const source = 'do i = 1, n\r  where (a > 0) b = sqrt(a)\rend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('Bug 3: if-then with CR-only line endings', () => {
      const source = 'if (condition) then\r  x = 1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 3: else if with CR-only should not be new block', () => {
      const source = 'if (x) then\r  y = 1\relse if (z) then\r  y = 2\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 3: if with continuation & and CR-only', () => {
      const source = 'if (condition) &\r  then\r  x = 1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 4: procedure with :: on CR-only continuation line', () => {
      const source = 'type :: my_type\r  integer :: x\rcontains\r  procedure, pass &\r    :: get_x\rend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end', 0);
    });

    test('Bug 4: procedure without :: on CR-only should be block', () => {
      const source = 'procedure myproc()\r  integer :: x\rend procedure';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });

    test('Bug 5: isContinuationBlockForm with CR-only', () => {
      // where with continuation that is block form
      const source = 'where (a > 0) &\r  b = sqrt(a)\r  c = log(a)\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('Bug 5: isPrecedingContinuationKeyword with CR-only', () => {
      // select &\r  type should be recognized as continuation
      const source = 'select &\r  type (x)\rtype is (integer)\r  y = 1\rend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('Bug 5: else &\\r if continuation with CR-only', () => {
      const source = 'if (x > 0) then\r  y = 1\relse &\r  if (x < 0) then\r  y = -1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 10: else if continuation across &\\r should merge with CR-only line endings', () => {
      const source = 'if (.true.) then\r  x = 1\relse &\rif (.false.) then\r  x = 2\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('then'), 'should have then intermediate');
      assert.strictEqual(pairs[0].intermediates.length, 3, 'should have 3 intermediates: then, else &\\rif, then');
    });

    test('Bug 13: select continuation with intermediate comment-only lines', () => {
      const source = `select &
! comment line
  type(integer)
  type is (integer)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('Bug 13: select continuation with multiple comment-only lines', () => {
      const source = `select &
! first comment
! second comment
  case (1)
    y = 1
  case default
    y = 0
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('Bug 13: select continuation with CRLF and comment lines', () => {
      const source = 'select &\r\n! comment\r\n  type(integer)\r\ntype is (integer)\r\n  y = 1\r\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('Bug 14: compound end keyword after :: should not be block close', () => {
      const source = `program test
  character(len=20) :: end program
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('Bug 14: end subroutine after :: should not be block close', () => {
      const source = `subroutine test()
  character(len=20) :: end subroutine
end subroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('Bug 14: end function after :: should not be block close', () => {
      const source = `function test() result(r)
  character(len=20) :: end function
  r = "ok"
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('Bug 24: isBlockWhereOrForall with \\r-only in parenthesized condition string', () => {
      const source = 'where (a > 0)\r  b = sqrt(a)\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('Bug 24: forall with \\r-only should detect block form', () => {
      const source = 'forall (i = 1:n)\r  a(i) = i\rend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('Bug 25: else if on separate lines with \\r-only should not merge', () => {
      // else and if on separate lines should NOT be merged
      const source = 'if (x > 0) then\r  y = 1\relse\rif (x < 0) then\r  y = -1\rend if\rend if';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 26: matchFortranString with \\r-only line ending', () => {
      const source = "'unterminated string\rif (x > 0) then\r  y = 1\rend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 26: matchFortranString with \\r-only should terminate at \\r', () => {
      const source = '"unterminated\rprogram test\r  x = 1\rend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('isContinuationBlockForm with concatenated end keywords', () => {
    test('should detect single-line where spread when next line is enddo (concatenated)', () => {
      // enddo (concatenated) should be recognized as 'end' keyword
      // making where a single-line spread, not a block
      const source = `do i = 1, n
  where (mask) &
    a(i) = b(i)
enddo`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'enddo');
    });

    test('should detect single-line forall spread when next line is endif (concatenated)', () => {
      const source = `if (x) then
  forall (i = 1:n) &
    a(i) = b(i)
endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'endif');
    });

    test('should still detect block form where with endwhere', () => {
      const source = `where (a > 0)
  b = sqrt(a)
  c = log(a)
endwhere`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'endwhere');
    });
  });

  suite('C preprocessor directives', () => {
    test('should treat #endif as excluded region, not compound end if', () => {
      const source = `#ifdef DEBUG
if (x > 0) then
  y = 1
end if
#endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should treat #if as excluded region', () => {
      const source = `#if defined(FEATURE)
program test
  x = 1
end program
#endif`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should treat #include as excluded region', () => {
      const source = `#include "header.h"
subroutine test()
  x = 1
end subroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should not treat # in middle of line as preprocessor directive', () => {
      const source = `program test
  x = 1 # 2
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Module and procedure continuation edge cases', () => {
    test('should reject module procedure with comment between continuation lines', () => {
      const source = 'module &\n  ! comment\n  procedure foo\nend module';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should reject procedure with comment between continuation and ::', () => {
      const source = 'procedure &\n  ! comment\n  :: foo';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle comment line between continuation lines in where block', () => {
      const source = 'where (a > 0) &\n  ! comment\n  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });
  });

  suite('Module procedure continuation', () => {
    test('should not treat module &\\n procedure as module block', () => {
      const source = `submodule (parent) child
contains
  module &
    procedure my_proc
    x = 1
  end procedure
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'submodule');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'procedure');
    });

    test('should not treat module & with comment then procedure as module block', () => {
      const source = `submodule (parent) child
contains
  module & ! comment
    procedure my_proc
    x = 1
  end procedure
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'submodule');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'procedure');
    });

    test('should still treat standalone module as block', () => {
      const source = `module mymod
  implicit none
end module`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'end module');
    });
  });

  suite('Edge cases for uncovered branches', () => {
    test('where with string containing quote at line end', () => {
      const source = `where (a > 0 .and. s == 'test')
  a = 1
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('where with comment inside condition', () => {
      const source = `where (a > 0 & ! comment
  .and. b > 0)
  a = 1
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('where with standalone CR line ending', () => {
      const source = 'where (a > 0)\r  a = 1\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('where with continuation at end of source', () => {
      const source = 'where (a > 0) &';
      const pairs = parser.parse(source);
      // No matching end keyword, continuation at EOF
      assertNoBlocks(pairs);
    });

    test('where continuation with empty line', () => {
      const source = 'where (a > 0) &\n\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('where continuation ending at EOF', () => {
      const source = 'where (a > 0) &\n  a = 1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('where continuation with CRLF followed by end block', () => {
      const source = 'where (a > 0) &\r\n  a = 1\r\nend do';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('where continuation with standalone CR followed by end block', () => {
      const source = 'where (a > 0) &\r  a = 1\rend if';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('forall with unmatched parenthesis', () => {
      const source = 'forall (i=1:10\n  a(i) = i\nend forall';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('select type with continuation after type keyword', () => {
      const source = `select &
  type (var)
  type is (integer)
    x = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('select case with continuation after case keyword', () => {
      const source = `select &
  case (var)
  case (1)
    x = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('function with :: in string should not trigger type check', () => {
      const source = `function test() result(x)
  character(len=20) :: x
  x = "test::value"
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('if statement with continuation to else if', () => {
      const source = `if (a > 0) then
  x = 1
else &
  if (b > 0) then
  x = 2
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('inline comment with doubled quote inside string', () => {
      const source = `program test
  s = 'it''s here' ! comment
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('string at end of source without closing quote', () => {
      const source = `program test
  s = "unclosed`;
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length > 0);
      assert.strictEqual(regions[regions.length - 1].end, source.length);
    });

    test('string with newline inside (invalid but handled)', () => {
      const source = `program test
  s = "line1
line2"
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Uncovered line coverage', () => {
    // Covers lines 82-83: type(name) as type specifier check
    test('type(name) as variable declaration type specifier', () => {
      const source = `program test
  type(mytype) :: var
  var%field = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 126, 142: CRLF line ending in procedure validation
    test('procedure declaration with CRLF line endings and comment-only lines', () => {
      const source = `module test\r
  type :: mytype\r
    procedure :: method\r
    ! comment line\r
  end type\r
end module`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 220-231: comment-only continuation lines in if validation
    test('if with comment-only continuation lines', () => {
      const source = `program test
  if (condition) &
  ! comment line
  &
  then
    x = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 271-273: string escaping in isBlockWhereOrForall
    test('where with doubled quote in condition', () => {
      const source = `program test
  where (str == 'can''t')
    arr = 0
  end where
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 316-318: carriage return handling in isBlockWhereOrForall
    test('where with standalone carriage return', () => {
      const source = 'program test\r  where (mask)\r  arr = 1\rend where\rend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 339-342: end of source after where condition
    test('where at end of source without body', () => {
      const source = `program test
  where (mask > 0)
end program`;
      const pairs = parser.parse(source);
      // where is block form (no assignment after condition), but unterminated
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 348-349: type specifier detection for end(1)
    test('end with double parentheses as array element', () => {
      const source = `program test
  integer :: end(5,5)
  end(1,1) = 42
  end(2)(1) = 10
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 356-357: end() comparison check
    test('end array with comparison operator', () => {
      const source = `program test
  integer :: end(10)
  if (end(1) == 0) then
    x = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 386-390: type specifier detection with parentheses
    test('type(...) with nested parentheses in type specifier', () => {
      const source = `program test
  type(mytype(kind=8)) :: var
  var%x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 400-401: unmatched parenthesis in type specifier
    test('type specifier with unmatched paren at EOF', () => {
      const source = `program test
  type(incomplete
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 404-405: double colon detection in type specifier
    test('type specifier followed by double colon', () => {
      const source = `program test
  type(mytype) :: x, y
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 407-408: comma in type specifier
    test('type specifier followed by comma', () => {
      const source = `program test
  type(t1), type(t2) :: x
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 410-411: no :: or comma after type specifier
    test('type definition not followed by :: returns false', () => {
      const source = `type :: mytype
  integer :: field
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // Covers lines 440-441: leading & on continuation line in isContinuationBlockForm
    test('where with continuation having leading &', () => {
      const source = `program test
  where (mask) &
  &arr = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 686-696: compound end fallback matching
    test('compound end keyword concatenated form', () => {
      const source = `program test
  do i = 1, 10
    x = i
  enddo
endprogram`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 795-796: isPrecedingContinuationKeyword with \r in prevLine
    test('select type continuation with \\r line ending', () => {
      const source = 'program test\r  select &\r  type(var)\r  end select\rend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 815-816: isPrecedingContinuationKeyword word boundary
    test('continuation keyword with word boundary check', () => {
      const source = `program test
  myselect = 1
  if (x > 0) then
    y = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('CRLF coverage for procedure, if, where/forall, and isPrecedingContinuationKeyword', () => {
    // Covers line 126: j += 2 for CRLF after comment-only continuation line in procedure scanning
    test('procedure with CRLF comment-only continuation line before ::', () => {
      // procedure & CRLF ! comment CRLF :: name -> should reject as declaration
      const source = 'type :: mytype\r\ncontains\r\n  procedure &\r\n  ! comment\r\n  :: get_x\r\nend type';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // Covers line 142: j += 2 for CRLF at end of continuation line in procedure scanning
    test('procedure with CRLF continuation ending with &', () => {
      // procedure, pass & CRLF :: name -> continuation line ends with &, CRLF skip
      const source = 'type :: mytype\r\ncontains\r\n  procedure, pass &\r\n    :: get_x\r\nend type';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // Covers line 225: i += 2 for CRLF after comment-only line during if-then scanning
    test('if with CRLF comment-only continuation line before then', () => {
      const source = 'if (condition) &\r\n! comment line\r\n  then\r\n  x = 1\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // Covers lines 316-318: CRLF pair inside where/forall after closing paren
    test('where with CRLF after condition (not standalone CR)', () => {
      const source = 'where (a > 0)\r\n  a = 1\r\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // Covers lines 316-318: CRLF in forall as well
    test('forall with CRLF after condition', () => {
      const source = 'forall (i = 1:n)\r\n  a(i) = b(i)\r\nend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    // Covers lines 339-342: source ends inside condition scanner without finding
    // non-whitespace after closing paren
    test('where condition at end of source with trailing whitespace', () => {
      const source = 'where (a > 0)   ';
      const pairs = parser.parse(source);
      // Block form detected (no assignment after condition), but no end keyword
      assertNoBlocks(pairs);
    });

    // Covers lines 339-342: source ends right after closing paren
    test('where condition at end of source without trailing content', () => {
      const source = 'where (a > 0)';
      const pairs = parser.parse(source);
      // Block form detected (end of source), but no matching end keyword
      assertNoBlocks(pairs);
    });

    // Covers lines 356-357: end = ... assignment (not ==)
    test('end used as variable name with assignment', () => {
      const source = 'program test\n  integer :: end\n  end = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 356-357: end = assignment should not be block close
    test('end = value should not close a block', () => {
      const source = 'do i = 1, 10\n  end = i\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    // Covers lines 795-796: isPrecedingContinuationKeyword with \r-only line ending
    test('isPrecedingContinuationKeyword with standalone CR line ending', () => {
      // else &\r  if (x > 0) then -> prevLine ends with \r which should be stripped
      const source = 'if (x > 0) then\r  y = 1\relse &\r  if (x < 0) then\r  y = -1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // Covers lines 815-816: non-whole-word keyword match in isPrecedingContinuationKeyword
    test('isPrecedingContinuationKeyword rejects non-whole-word match', () => {
      // "someelse &\n  if" -> someelse ends with "else" but is not a whole word match
      // so if should be treated as a new block opener
      const source = 'if (a) then\n  x = 1\nend if\nsomeelse &\n  if (b) then\n  y = 2\nend if';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    // Covers lines 316-318: CRLF where with whitespace between paren and CRLF
    test('where with whitespace then CRLF after condition', () => {
      const source = 'where (a > 0)  \r\n  a = 1\r\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // Covers line 126: multiple comment-only continuation lines with CRLF in procedure
    test('procedure with multiple CRLF comment-only continuation lines', () => {
      const source = 'type :: mytype\r\ncontains\r\n  procedure &\r\n  ! first comment\r\n  ! second comment\r\n  :: get_x\r\nend type';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // Covers line 225: multiple comment-only continuation lines with CRLF in if
    test('if with multiple CRLF comment-only continuation lines before then', () => {
      const source = 'if (cond) &\r\n! first\r\n! second\r\n  then\r\n  x = 1\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  // Covers line 385-387: isTypeSpecifier whitespace before (
  suite('Coverage: isTypeSpecifier whitespace before paren', () => {
    test('should treat type with space before paren as type specifier', () => {
      const source = 'program test\n  type (mytype) :: var\n  var = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  // Covers line 810: isPrecedingContinuationKeyword returns false
  suite('Coverage: isPrecedingContinuationKeyword false path', () => {
    test('should not treat type as continuation when previous line has non-keyword before &', () => {
      const source = 'program test\n  x = y &\n  type point\n    real :: x, y\n  end type\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'type');
      findBlock(pairs, 'program');
    });
  });

  // Covers line 366: nested paren depth++ in isValidBlockClose
  suite('Coverage: isValidBlockClose nested parens', () => {
    test('should not treat end with nested parens as block close', () => {
      const source = 'program test\n  integer :: end(5)\n  end(func(2)) = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 14: else should not be added as intermediate to do block', () => {
      const source = `do i = 1, 10
  else
end do`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertIntermediates(pairs[0], []);
    });

    test('Bug 14: elseif should not be added as intermediate to do block', () => {
      const source = `do i = 1, 10
  elseif
end do`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertIntermediates(pairs[0], []);
    });

    test('Bug 14: contains should only be intermediate for program/module/function/subroutine', () => {
      const source = `do i = 1, 10
  contains
end do`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertIntermediates(pairs[0], []);
    });

    test('Bug 14: contains should be valid intermediate for module', () => {
      const source = `module mymod
  integer :: x
contains
  subroutine sub
  end subroutine
end module`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 12: contains should be valid intermediate for type block', () => {
      const source = `type :: my_type
  integer :: x
contains
  procedure :: get_x
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
      assertIntermediates(pairs[0], ['contains']);
    });
  });

  suite('Continuation line compound end', () => {
    test('should recognize end &\\nfunction as compound end', () => {
      const source = `function f()
  x = 1
end &
function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should recognize end &\\n  subroutine with indentation', () => {
      const source = `subroutine sub()
  x = 1
end &
  subroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should recognize end &\\n  &function with double continuation marker', () => {
      const source = `function f()
  x = 1
end &
  &function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should still recognize normal end function', () => {
      const source = `function f()
  x = 1
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 9: type(name) function should not create false type block opener', () => {
      const source = `type(integer) function foo()
  foo = 42
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('Bug 9: type(real) pure function should not create false type block opener', () => {
      const source = `type(real) pure function bar(x)
  bar = x * 2.0
end function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('Bug 10: else  if with multiple spaces should be treated as intermediate', () => {
      const source = `if (x > 0) then
  y = 1
else  if (x < 0) then
  y = -1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('Bug 7: continuation compound end with inline comment', () => {
      const pairs = parser.parse('program test\n  print *, "hello"\nend & ! This is a comment\n  program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('Bug 8: isContinuationBlockForm should skip comment lines', () => {
      const pairs = parser.parse('do i = 1, 10\n  where (mask) &\n    a(i) = b(i)\n  ! This is just a comment\nend do');
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('Bug 11: else if should be merged as intermediate keyword', () => {
      const pairs = parser.parse('if (x > 0) then\n  a = 1\nelse if (x < 0) then\n  a = -1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else if', 'then']);
    });

    test('Bug 11: else if with continuation should be merged', () => {
      const pairs = parser.parse('if (x > 0) then\n  a = 1\nelse &\n  if (x < 0) then\n  a = -1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else &\n  if', 'then']);
    });

    test('Bug 11: isPrecedingContinuationKeyword with leading & on continuation line', () => {
      const source = 'if (.true.) then\n  x = 1\nelse &\n&  if (.false.) then\n  x = 2\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('then'), 'should have then intermediate');
    });
  });

  suite('Uncovered line coverage - isValidBlockClose', () => {
    // Covers lines 361-363: end%component is derived type component access
    test('should not treat end%component as block close', () => {
      const source = 'program test\n  end%field = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 368-371: end & continuation then = on next line
    test('should not treat end with & continuation then = as block close', () => {
      const source = 'program test\n  integer :: end\n  end &\n  = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers line 371: CRLF in end & continuation
    test('should not treat end with & CRLF continuation then = as block close', () => {
      const source = 'program test\r\n  integer :: end\r\n  end &\r\n  = 5\r\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 380-382: optional & on next continuation line
    test('should not treat end with & continuation and leading & on next line as block close', () => {
      const source = 'program test\n  integer :: end\n  end &\n  & = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 386-388: end &\n%component continuation
    test('should not treat end with & continuation then %component as block close', () => {
      const source = 'program test\n  end &\n  %field = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Uncovered line coverage - isTypeSpecifier', () => {
    // Covers lines 423-425: isTypeSpecifier when no ( follows type keyword
    test('should not reject type when no paren follows (type :: definition)', () => {
      const source = 'type :: mytype\n  integer :: field\nend type';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // Covers line 452-453: isTypeSpecifier returns false when nothing follows closing paren
    test('should treat type() at end of source as block opener', () => {
      const source = 'type(mytype)';
      const pairs = parser.parse(source);
      // type(mytype) at EOF - isTypeSpecifier returns false, so treated as block opener
      // but no matching end, so no pairs
      assertNoBlocks(pairs);
    });
  });

  suite('Uncovered line coverage - else if handling', () => {
    // Fortran treats 'else if' as 'else' + rejected 'if' (isValidBlockOpen returns false)
    // The 'elseif' keyword (no space) is directly supported as block_middle
    test('should treat else if as intermediate else with rejected if', () => {
      const source = `if (x > 0) then
  y = 1
else if (x < 0) then
  y = -1
else
  y = 0
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      // else if: the 'if' after 'else' is rejected by isValidBlockOpen
      // So we get else + then + else as intermediates (no merged else if token)
      const intermediates = pairs[0].intermediates.map((t) => t.value.toLowerCase());
      assert.ok(intermediates.includes('else'), 'should have else intermediate');
      assert.ok(intermediates.includes('then'), 'should have then intermediate');
    });

    test('should not merge else if across line boundaries', () => {
      const source = `if (x > 0) then
  y = 1
else
if (x < 0) then
  y = -1
end if
end if`;
      const pairs = parser.parse(source);
      // else and if on different lines should NOT be merged
      // Two separate if blocks
      assertBlockCount(pairs, 2);
    });
  });

  suite('Uncovered line coverage - isPrecedingContinuationKeyword CRLF', () => {
    // Covers lines 867-869: CRLF in backward continuation scan (prevLine ends with \r)
    test('should handle select type continuation with CRLF line endings', () => {
      const source = 'program test\r\n  select &\r\n  type(var)\r\n  end select\r\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle else if continuation with CRLF line endings', () => {
      const source = 'if (x > 0) then\r\n  y = 1\r\nelse &\r\n  if (x < 0) then\r\n  y = -1\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: new bug fix code paths', () => {
    // Covers lines 344-346: isValidBlockClose returns true for non-'end' compound keywords
    test('should parse function closed by endfunction', () => {
      const source = 'function foo()\n  x = 1\nendfunction';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    // Covers lines 414-416: isTypeSpecifier missing '(' after function/subroutine keyword
    test('should parse function without parentheses', () => {
      const source = 'function foo\n  x = 1\nend function';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    // Covers lines 544-558: findInlineCommentIndex string handling via where continuation
    test('should handle string containing ! in where continuation line', () => {
      const source = 'where (a > 0) &\n  b = "hello ! world" ! set b\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // Covers lines 546-548: findInlineCommentIndex escaped quotes in string with !
    test('should handle escaped quotes in string with ! in where continuation', () => {
      const source = "where (a > 0) &\n  b = 'it''s ! here' ! comment\nend where";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // Covers lines 870-872: \r stripping from previous line during continuation scanning
    test('should strip \\r from previous line in continuation scanning', () => {
      const source = 'select &\r\n  type(var)\r\n  end select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // Covers lines 899-901: word boundary check in isPrecedingContinuationKeyword
    test('should not match keyword as part of longer identifier in continuation', () => {
      const source = 'x = myselect &\n  type(var)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // Covers lines 905-907: final return false in isPrecedingContinuationKeyword
    test('should return false when no keyword before continuation', () => {
      const source = 'x &\n  = 1';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });
});
