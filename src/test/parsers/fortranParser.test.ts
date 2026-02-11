import * as assert from 'node:assert';
import { FortranBlockParser } from '../../parsers/fortranParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('FortranBlockParser Test Suite', () => {
  let parser: FortranBlockParser;

  setup(() => {
    parser = new FortranBlockParser();
  });

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
    test('should ignore keywords in comments', () => {
      const source = `! if then end if do
if (condition) then
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

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

    test('should ignore keywords in double-quoted strings', () => {
      const source = `print *, "if then end if do"
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
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('x = 1');
      assertNoBlocks(pairs);
    });

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
      // end function doesn't match if, but falls back to last opener
      assertSingleBlock(pairs, 'if', 'end function');
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

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `if (condition) then
end if`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `program test
  do i = 1, 10
  end do
end program`;
      const pairs = parser.parse(source);
      const doPair = findBlock(pairs, 'do');
      const progPair = findBlock(pairs, 'program');
      assertTokenPosition(doPair.openKeyword, 1, 2);
      assertTokenPosition(progPair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if (condition) then
end if`;
      const tokens = parser.getTokens(source);
      assert.ok(tokens.some((t) => t.value === 'if'));
      assert.ok(tokens.some((t) => t.value === 'then'));
      assert.ok(tokens.some((t) => t.value === 'end if'));
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `! comment
'string'`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 2);
    });
  });

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
});
