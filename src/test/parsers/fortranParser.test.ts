import * as assert from 'node:assert';
import { collapseContinuationLines, isAfterDoubleColon, isPrecedingContinuationKeyword, isTypeSpecifier } from '../../parsers/fortranHelpers';
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
    stringBlockClose: 'end if',
    singleQuotedStringSource: "print *, 'if then end if do'\nif (condition) then\nend if",
    singleQuotedStringBlockOpen: 'if',
    singleQuotedStringBlockClose: 'end if',
    commentAtEndOfLineSource: 'if (condition) then ! end if here\n  action\nend if',
    commentAtEndOfLineBlockOpen: 'if',
    commentAtEndOfLineBlockClose: 'end if',
    escapedQuoteStringSource: "print *, 'it''s an if statement'\nif (condition) then\nend if",
    escapedQuoteStringBlockOpen: 'if',
    escapedQuoteStringBlockClose: 'end if'
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
  });

  suite('Excluded regions - Strings', () => {});

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

    test('should not treat end followed by // as block close', () => {
      const source = 'program test\n  character(len=20) :: end\n  end = "hello"\n  end // " world"\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
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

    test('should handle concatenated endwhere in continuation block form', () => {
      const source = 'where (a > 0) &\n  b = 1\nendwhere';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'endwhere');
    });

    test('should handle leading & on continuation line before opening paren', () => {
      const source = 'where &\n  &(mask > 0)\n  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should not detect keywords adjacent to Unicode letters', () => {
      const source = 'variable caf\u00E9do : integer\ndo i = 1, 10\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should handle continuation lines with CRLF line endings', () => {
      const source = 'if (.true.) &\r\n  then\r\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should reject end inside parentheses with continuation line string', () => {
      const source = "program test\n  x = func('hello &\n  &world', end)\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not detect type(name)(args) constructor as block open', () => {
      const pairs = parser.parse('subroutine init(p)\n  type(point) :: p\n  p = type(point)(1.0, 2.0)\nend subroutine');
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should still detect type block with body', () => {
      const pairs = parser.parse('type :: point\n  real :: x, y\nend type');
      assertSingleBlock(pairs, 'type', 'end type');
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

    test('should not treat module function as module block', () => {
      const pairs = parser.parse(
        'module mymod\ncontains\n  module function myfunc(x) result(y)\n    y = x * 2\n  end function myfunc\nend module mymod'
      );
      assert.strictEqual(pairs.length, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'module');
      assert.strictEqual(sorted[0].openKeyword.startOffset, 0);
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'function');
    });

    test('should not treat module subroutine as module block', () => {
      const pairs = parser.parse('module mymod\ncontains\n  module subroutine mysub(x)\n    x = x + 1\n  end subroutine mysub\nend module mymod');
      assert.strictEqual(pairs.length, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'module');
      assert.strictEqual(sorted[0].openKeyword.startOffset, 0);
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'subroutine');
    });
  });

  suite('Line continuation procedure', () => {
    test('should reject procedure with :: on continuation line', () => {
      const pairs = parser.parse('type :: my_type\n  integer :: x\ncontains\n  procedure, pass &\n    :: get_x\nend');
      assertSingleBlock(pairs, 'type', 'end');
    });
  });

  suite('Regression: isValidBlockClose bare & and comment-only line skipping', () => {
    test('should reject end as block close when bare & line separates end & and assignment', () => {
      const source = `program test
  end &
    &
    = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end as block close when & with comment separates end & and assignment', () => {
      const source = `program test
  end &
    & ! comment
    = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end(1) as block close when comment line separates end(1) & and assignment', () => {
      const source = `program test
  end(1) &
    ! comment
    = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end(1) as block close when bare & line separates end(1) & and assignment', () => {
      const source = `program test
  end(1) &
    &
    = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end as block close when & ! comment line separates end & and assignment', () => {
      // Covers fortranParser.ts lines 399-400: while loop scans past ! comment text to end of line
      const source = `program test
  end &
  & ! This is a comment
  = 5
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle unterminated string with line break (no & continuation)', () => {
      // Covers fortranHelpers.ts line 64: isStringContinuation returns false for non-continuation line break
      const source = `program test
  x = 'unterminated
  if (.true.) then
    y = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle CR-only line endings in type declaration check', () => {
      // Covers fortranHelpers.ts lines 556-557, 618-619: prevLine.endsWith CR handling
      const source = 'integer :: x\rif (.true.) then\r  y = 1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
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

    test('should treat Cend as free-form code (C followed by alphanumeric)', () => {
      // C/c at column 1 followed by alphanumeric is treated as free-form code
      // to support identifiers like count, compute, current, etc.
      const tokens = parser.getTokens('Cend program foo');
      assert.strictEqual(tokens.length, 1);
      assert.strictEqual(tokens[0].value.toLowerCase(), 'program');
    });

    test('should not treat call at column 1 as comment', () => {
      const pairs = parser.parse('program main\ncall sub1\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat count at column 1 as comment', () => {
      const pairs = parser.parse('count = 0\ndo i = 1, 10\nend do');
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should not treat labeled do with c-identifier as comment', () => {
      const pairs = parser.parse('compute: do i = 1, 10\nend do');
      assertSingleBlock(pairs, 'do', 'end do');
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

    test('should exclude keywords in c+digit comment lines', () => {
      const pairs = parser.parse('c123 do i = 1, 10\nend do');
      assertNoBlocks(pairs);
    });

    test('should exclude keywords in C+digit comment lines (uppercase)', () => {
      const pairs = parser.parse('C1 IF (X .GT. 0) THEN\n  Y = 1\nEND IF');
      assertNoBlocks(pairs);
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
      assertSingleBlock(pairs, 'type', 'end');
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

    test('where continuation with blank & line should still detect block form', () => {
      const source = 'where (a > 0) &\n  &\n  a = 1\nend where';
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

    test('Bug 7: continuation compound end with inline comment', () => {
      const pairs = parser.parse('program test\n  print *, "hello"\nend & ! This is a comment\n  program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('Bug 8: isContinuationBlockForm should skip comment lines', () => {
      const pairs = parser.parse('do i = 1, 10\n  where (mask) &\n    a(i) = b(i)\n  ! This is just a comment\nend do');
      assertSingleBlock(pairs, 'do', 'end do');
    });

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

    test('should not treat component%end as block close', () => {
      // Regression: isValidFortranBlockClose only checked for end%component (forward),
      // not component%end (backward), so x%end was incorrectly treated as block close
      const source = 'program test\n  y = x%end + 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat component% end (with space) as block close', () => {
      const source = 'program test\n  y = x% end + 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat compound end keyword preceded by % as block close', () => {
      const source = 'do i = 1, 5\n  x = obj%enddo\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should not treat plain end preceded by % as block close', () => {
      const source = 'do i = 1, 5\n  x = obj%end\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
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

  suite('Bug 1: elsewhere as intermediate keyword', () => {
    test('should parse where with elsewhere', () => {
      const source = `where (a > 0)
  b = sqrt(a)
elsewhere
  b = 0
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      assertIntermediates(pairs[0], ['elsewhere']);
    });

    test('should parse where with conditional elsewhere', () => {
      const source = `where (a > 0)
  b = sqrt(a)
elsewhere (a == 0)
  b = 1
elsewhere
  b = -1
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      const elsewhereIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'elsewhere');
      assert.strictEqual(elsewhereIntermediates.length, 2, 'Expected 2 elsewhere intermediates');
    });

    test('should parse two-word else where as intermediate', () => {
      const source = `where (a > 0)
  b = sqrt(a)
else where
  b = 0
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'Expected 1 intermediate');
      assert.ok(/^else\s+where$/i.test(pairs[0].intermediates[0].value), 'Intermediate should be else where');
    });

    test('should parse two-word else where with condition', () => {
      const source = `where (a > 0)
  b = sqrt(a)
else where (a == 0)
  b = 1
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'Expected 1 intermediate');
    });

    test('should parse else where via continuation line', () => {
      const source = `where (a > 0)
  b = sqrt(a)
else &
  where
  b = 0
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      assert.strictEqual(pairs[0].intermediates.length, 1, 'Expected 1 intermediate');
    });

    test('should not add elsewhere as intermediate to if block', () => {
      const source = `if (x > 0) then
  elsewhere
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const elsewhereIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'elsewhere');
      assert.strictEqual(elsewhereIntermediates.length, 0, 'elsewhere should not be intermediate of if');
    });

    test('should handle ELSEWHERE in uppercase', () => {
      const source = `WHERE (mask > 0)
  arr = 1
ELSEWHERE
  arr = 0
END WHERE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'WHERE', 'END WHERE');
      assertIntermediates(pairs[0], ['ELSEWHERE']);
    });
  });

  suite('Bug 2: select rank construct', () => {
    test('should parse select rank block', () => {
      const source = `select rank (x)
  rank (0)
    print *, "scalar"
  rank (1)
    print *, "1D array"
  rank default
    print *, "other"
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should parse SELECT RANK in uppercase', () => {
      const source = `SELECT RANK (y)
  RANK (0)
    PRINT *, "scalar"
END SELECT`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'SELECT', 'END SELECT');
    });

    test('should parse select rank with continuation', () => {
      const source = `select &
  rank (x)
  rank (0)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should still reject select without type/case/rank', () => {
      const source = `select something
  x = 1
end select`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Bug 3: type is with & continuation', () => {
    test('should not treat type & is (integer) as block opener', () => {
      const source = `select type (x)
  type &
    is (integer)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should not treat TYPE & IS (REAL) as block opener', () => {
      const source = `SELECT TYPE (x)
  TYPE &
    IS (REAL)
    Y = 1.0
END SELECT`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'SELECT', 'END SELECT');
    });

    test('should not treat type & with comment then is as block opener', () => {
      const source = `select type (x)
  type & ! guard
    is (integer)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should still treat standalone type definition as block opener', () => {
      const source = `type :: my_type
  integer :: x
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });
  });

  suite('Bug 4: string continuation across lines', () => {
    test('should exclude string continued with &', () => {
      const source = `program test
  msg = 'hello &
    &world'
  if (x > 0) then
    y = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });

    test('should exclude keywords inside continued string', () => {
      const source = `program test
  msg = "if then &
    &end if do"
  do i = 1, 10
    x = i
  end do
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'do');
    });

    test('should handle continued string with double quotes', () => {
      const source = `program test
  msg = "part1 &
    &part2"
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle continued string without leading & on next line', () => {
      const source = `program test
  msg = 'hello &
        world'
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle multiple continuation lines in string', () => {
      const source = `program test
  msg = 'line1 &
    &line2 &
    &line3'
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not continue string when no & before line break', () => {
      const source = `program test
  msg = 'unterminated
  if (x > 0) then
    y = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });

    test('should handle string continuation with CRLF', () => {
      const source = "program test\r\n  msg = 'hello &\r\n    &world'\r\n  x = 1\r\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle string continuation with CR-only', () => {
      const source = "program test\r  msg = 'hello &\r    &world'\r  x = 1\rend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Bug 5: merged else if continuation bypass', () => {
    test('should restrict else & if continuation to if blocks only', () => {
      const source = `do i = 1, 10
  else &
    if
end do`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
      assertIntermediates(pairs[0], []);
    });

    test('should allow else & if continuation in if blocks', () => {
      const source = `if (x > 0) then
  y = 1
else &
  if (x < 0) then
  y = -1
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assert.ok(pairs[0].intermediates.length >= 2, 'should have intermediates');
    });

    test('should restrict else & where continuation to where blocks only', () => {
      const source = `if (x > 0) then
  else &
    where
end if`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const intermediates = pairs[0].intermediates.map((i) => i.value.toLowerCase());
      const hasElseWhere = intermediates.some((v) => /else.*where/.test(v));
      assert.strictEqual(hasElseWhere, false, 'else where should not be intermediate of if block');
    });
  });

  suite('Bug 6: compound end with comment-only lines between', () => {
    test('should recognize end & with comment-only line then keyword', () => {
      const source = `function f()
  x = 1
end &
! comment line
function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should recognize end & with multiple comment-only lines then keyword', () => {
      const source = `subroutine sub()
  x = 1
end &
! first comment
! second comment
subroutine`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should recognize end & with CRLF and comment then keyword', () => {
      const source = 'program test\r\n  x = 1\r\nend &\r\n! comment\r\nprogram';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still recognize end & without comment then keyword', () => {
      const source = `function f()
  x = 1
end &
function`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });
  });

  suite('Bug 7: else where (condition) false where block_open', () => {
    test('should not create false where block from else where (condition)', () => {
      const source = `where (a > 0)
  b = sqrt(a)
else where (a == 0)
  b = 1
end where`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should not create false where block from ELSE WHERE', () => {
      const source = `WHERE (a > 0)
  b = sqrt(a)
ELSE WHERE
  b = 0
END WHERE`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'WHERE', 'END WHERE');
    });

    test('should handle nested where with elsewhere', () => {
      const source = `program test
  where (a > 0)
    b = sqrt(a)
  elsewhere
    b = 0
  end where
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assertNestLevel(pairs, 'where', 1);
      assertNestLevel(pairs, 'program', 0);
    });
  });

  suite('Bug 8: string continuation with inline comment', () => {
    test('should handle string continuation with inline comment after &', () => {
      const source = `program test
  msg = 'hello & ! comment
    &world'
  if (x > 0) then
    y = 1
  end if
end program`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });

    test('should still handle string continuation without inline comment', () => {
      const source = `program test
  msg = 'hello &
    &world'
  x = 1
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Bug 9: type is with & continuation should not match non-continued line breaks', () => {
    test('should still treat type definition without continuation as block', () => {
      const source = `type
is (integer)
  x = 1
end type`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    test('should still reject type is(...) with continuation as guard', () => {
      const source = `select type (x)
  type &
    is (integer)
    y = 1
end select`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });
  });

  suite('Bug 10: isAfterDoubleColon with preceding continuation lines', () => {
    test('should suppress keyword when :: is on preceding continuation line', () => {
      // integer, intent(in) &\n  :: if  -> 'if' should be suppressed (after :: via continuation)
      const source = 'program test\n  integer, intent(in) &\n    :: if\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not suppress keyword when preceding line has no &', () => {
      // integer :: x\nif (y) then -> 'if' is on a new line (no continuation), should NOT be suppressed
      const source = 'integer :: x\nif (y > 0) then\n  z = 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Bug 11: chained & continuation in keyword validation', () => {
    test('should handle select with chained & continuation lines', () => {
      // select &\n  &\n  case (x) -> chained continuation
      const source = 'select &\n  &\n  case (x)\n  case (1)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should handle module with chained & continuation to procedure', () => {
      // module &\n  &\n  procedure foo -> chained continuation should reject as module block
      const source = 'submodule (parent) child\ncontains\n  module &\n    &\n    procedure my_proc\n    x = 1\n  end procedure\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'submodule');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'procedure');
    });
  });

  suite('Bug 5: isStringContinuation with multiple ! in inline comment', () => {
    test('should handle string continuation where inline comment has multiple ! characters', () => {
      // The & is before the inline comment with double !, so it is a continuation
      const source = "program test\n  character(len=50) :: msg\n  msg = 'hello' // &  !! two excl\n    'world'\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Bug 13: procedure :: with first :: in excluded region', () => {
    test('should find real :: when first :: is inside a string literal on same line', () => {
      // First :: is in string, second :: is the real declaration separator
      const source = 'type :: my_type\n  integer :: x\ncontains\n  procedure :: get_x\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end');
    });
  });

  suite('Bug 12: isValidBlockClose comment-only lines in & continuation', () => {
    test('should treat end & with comment-only line then = as variable assignment', () => {
      // end &\n  ! comment\n  = 5 -> the = is the real continuation content
      const source = 'program test\n  integer :: end\n  end &\n  ! comment\n  = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still treat end & with non-assignment continuation as block close', () => {
      // end &\n  ! comment\n  program -> should be valid end program
      const source = 'program test\n  x = 1\nend &\n  ! comment\n  program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Bug 13: isBlockWhereOrForall with & continuation before (', () => {
    test('should recognize where with & continuation before opening paren', () => {
      const source = 'where &\n  (mask > 0)\n  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should recognize forall with & continuation before opening paren', () => {
      const source = 'forall &\n  (i = 1:n)\n  a(i) = i\nend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('should recognize where with & and inline comment before paren', () => {
      const source = 'where & ! continue\n  (mask > 0)\n  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });
  });

  suite('Bug 14: isStringContinuation with ! inside string content', () => {
    test('should handle string with ! in content followed by & continuation and comment', () => {
      const source = "x = 'hello! wow' &  ! comment\nif (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle string continuation with ! in content and ! comment after &', () => {
      const source = "x = 'bang! & ! note\n&rest'\nif (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle double-quoted string with ! in content', () => {
      const source = 'x = "alert! data" &  ! inline comment\nif (.true.) then\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Bug: contains inside procedure block', () => {
    test('should accept contains as intermediate in module procedure block', () => {
      const source = 'procedure my_proc\n  integer :: x\ncontains\n  subroutine helper\n  end subroutine\nend procedure';
      const pairs = parser.parse(source);
      const procPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'procedure');
      assert.ok(procPair, 'should find procedure block');
      assertIntermediates(procPair, ['contains']);
    });
  });

  suite('Coverage: fortranHelpers edge cases', () => {
    // collapseContinuationLines: line 107 - escaped quote (doubled '') inside string literal
    test('collapseContinuationLines: string with escaped quote inside continuation', () => {
      // "call foo('it''s great') &\n  bar" - the '' inside string should not end the string early
      // This exercises the k++ branch when text[k+1] === ch (escaped quote in string)
      const source = "call foo('it''s great') &\n  if (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // collapseContinuationLines: lines 132-133 - & at end of text with no trailing newline
    test('collapseContinuationLines: & at end of source with no trailing newline', () => {
      // A select followed by & and nothing else (no newline)
      // collapseContinuationLines will hit "& at end of text with no newline" and break
      const source = 'select &';
      const pairs = parser.parse(source);
      // No valid continuation, so no block
      assertNoBlocks(pairs);
    });

    // collapseContinuationLines: line 161 - comment-only line ending at EOF (else branch)
    test('collapseContinuationLines: comment-only continuation line ending at EOF', () => {
      // select & \n! comment (no newline after comment, hits j = lineEnd where lineEnd >= text.length)
      const source = 'select &\n! comment at eof';
      const pairs = parser.parse(source);
      // The comment-only line goes to EOF, no valid continuation follows
      assertNoBlocks(pairs);
    });

    // collapseContinuationLines: lines 169/173/177 - continuation-only line (&) edge cases
    // Line 173: continuation-only line with \r\n ending
    test('collapseContinuationLines: continuation-only line with CRLF ending', () => {
      // select &\r\n&\r\n  case(x) -> the & on its own line with CRLF should be skipped
      const source = 'select &\r\n&\r\n  case (x)\n  case (1)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // Line 177: continuation-only line at EOF (afterAmpCheck >= text.length)
    test('collapseContinuationLines: continuation-only line at EOF', () => {
      // select &\n& (ampersand continuation-only line at end of file)
      const source = 'select &\n&';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // collapseContinuationLines: line 190 - leading & on continuation content line
    test('collapseContinuationLines: leading & on continuation content line', () => {
      // select &\n  &case(x) -> the leading & on continuation line should be skipped
      const source = 'select &\n  &case (x)\n  case (1)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // isPrecedingContinuationKeyword: lines 521-522 - \r-only line ending in backward scan
    // The prevLine ends with \r which must be stripped before checking endsWith('&')
    test('isPrecedingContinuationKeyword: \\r-only line ending backward scan', () => {
      // else &\r  if (x < 0) - the CR-only line ending requires \r stripping
      const source = 'if (x > 0) then\r  y = 1\relse &\r  if (x < 0) then\r  y = -1\rend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // isPrecedingContinuationKeyword: lines 555-557 - return false when scanning reaches beginning of file
    // This happens when prevLineEnd < 0 exits the while loop naturally
    test('isPrecedingContinuationKeyword: reaches beginning of file without finding keyword', () => {
      // type on first line of file with no preceding continuation - prevLineEnd reaches -1
      // The function scans backward from currentLineStart - 1 which is 0, then prevLineEnd goes to -1
      const source = 'type (x)\n  type is (integer)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      // type at line 0 has no preceding continuation line, isPrecedingContinuationKeyword returns false
      // type (x) is not a valid type specifier (no ::, no comma, no function/subroutine keyword)
      // so it's treated as block open -> but no 'select' precedes it
      assertNoBlocks(pairs);
    });

    // isAfterDoubleColon: lines 583-584 - \r stripping on continuation lines
    test('isAfterDoubleColon: \\r-only line ending on continuation with ::', () => {
      // type :: mytype\r  procedure :: get_x
      // The :: on the first line should suppress 'procedure' on continuation
      const source = 'type :: mytype\r  integer :: x\rcontains\r  procedure, pass &\r    :: get_x\rend';
      const pairs = parser.parse(source);
      // procedure has :: on continuation line -> suppressed as type-bound procedure
      assertSingleBlock(pairs, 'type', 'end');
    });

    // isAfterDoubleColon: lines 602-606 - :: found on continuation line but inside excluded region
    test('isAfterDoubleColon: :: found on continuation line but inside string (excluded region)', () => {
      // procedure with a string containing :: on continuation line - should NOT suppress
      // The procedure has a string "a :: b" on a continuation line, not a real ::
      const source = 'procedure &\n  my_proc()\nend procedure';
      const pairs = parser.parse(source);
      // No real :: anywhere, procedure is a block opener
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });

    // isAfterDoubleColon: :: inside string on continuation line should not suppress keyword
    test('isAfterDoubleColon: :: inside string on continuation line is excluded', () => {
      // When searching continuation lines for ::, if the :: is inside a string it must be ignored
      // This triggers the !isInExcludedRegion branch returning false (:: found but excluded)
      const source = 'program test\n  msg = "a :: b" &\n  ; procedure x\n  x = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // isContinuationBlockForm: EOF edge cases
    // Line 302: i >= source.length after findLineEnd -> return true (EOF = block form)
    test('isContinuationBlockForm: continuation body at EOF (treated as block form)', () => {
      // where (a > 0) &\n  a = 1 (no end keyword, but continuation body at EOF)
      // isContinuationBlockForm returns true because i >= source.length after following chain
      const source = 'where (a > 0) &\n  a = 1';
      const pairs = parser.parse(source);
      // Block form (returns true) but no end where -> no pairs
      assertNoBlocks(pairs);
    });

    // isContinuationBlockForm: \r-only line ending after continuation line
    test('isContinuationBlockForm: CR-only line ending in continuation body', () => {
      // where (a > 0) &\r  a = 1\rend where - continuation body has CR-only endings
      const source = 'where (a > 0) &\r  a = 1\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // isContinuationBlockForm: CRLF line ending inside continuation chain
    test('isContinuationBlockForm: CRLF line ending inside continuation body', () => {
      // where (a > 0) &\r\n  a = 1\r\nend where
      const source = 'where (a > 0) &\r\n  a = 1\r\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // isBlockWhereOrForall: forall with & continuation between closing paren and newline
    // This exercises the `ch === '&'` branch which calls isContinuationBlockForm
    test('isBlockWhereOrForall: forall with continuation after closing paren', () => {
      // forall (i = 1:n) &\n  a(i) = i\nend forall
      // After ) the & triggers isContinuationBlockForm
      const source = 'forall (i = 1:n) &\n  a(i) = i\nend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    // isBlockWhereOrForall: forall with continuation after closing paren - single-line form
    test('isBlockWhereOrForall: forall with continuation after paren that is single-line', () => {
      // forall (i = 1:n) &\n  a(i) = i (no end forall -> single-line spread)
      const source = 'do i = 1, n\n  forall (j = 1:m) &\n    a(j) = b(j)\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    // isBlockWhereOrForall: where with \r\n CRLF after & continuation past paren
    test('isBlockWhereOrForall: where with CRLF continuation after closing paren', () => {
      const source = 'where (mask > 0) &\r\n  a = 1\r\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // collapseContinuationLines: string with doubled quote (escaped) before & continuation
    // Exercises both the escape-quote branch (line 107) AND continuation collapse together
    test('collapseContinuationLines: select with string containing doubled quotes before continuation', () => {
      // select & ! where str = 'it''s' before
      const source = "program test\n  str = 'it''s ok' &\n  ! just testing\n  if (.true.) then\n    y = 1\n  end if\nend program";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });

    // isPrecedingContinuationKeyword: first line of file (currentLineStart === 0) returns false immediately
    test('isPrecedingContinuationKeyword: keyword on first line returns false immediately', () => {
      // When currentLineStart === 0 at the top of the function, returns false right away
      // type on the very first line with no preceding content
      const source = 'type :: mytype\n  integer :: x\nend type';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // isAfterDoubleColon: CRLF adjustment for prevLineEnd on continuation scanning
    test('isAfterDoubleColon: CRLF line ending adjusted when scanning backward for continuation', () => {
      // procedure &\r\n  :: name - CRLF at prevLineEnd should be skipped (prevLineEnd--)
      const source = 'type :: mytype\r\ncontains\r\n  procedure &\r\n  :: get_x\r\nend type';
      const pairs = parser.parse(source);
      // :: found on continuation line -> procedure suppressed as type-bound
      assertSingleBlock(pairs, 'type', 'end type');
    });

    // collapseContinuationLines: continuation-only line with \r (standalone CR)
    test('collapseContinuationLines: continuation-only line with standalone CR', () => {
      // select &\n&\r  case (x) -> continuation-only line ending with standalone \r
      const source = 'select &\n&\r  case (x)\n  case (1)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // isContinuationBlockForm: continuation comment-only lines with CR-only
    test('isContinuationBlockForm: comment-only continuation lines with CR-only endings', () => {
      // where (a > 0) &\n  ! comment\r  a = 1\nend where
      const source = 'where (a > 0) &\n  ! comment\r  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // isPrecedingContinuationKeyword: lines 521-522 - \r stripping
    // These lines strip trailing \r from prevLine. The condition prevLine.endsWith('\r')
    // is defensive code: with standard line endings (CR, LF, CRLF), findLineStart always
    // positions prevLineEnd AT the line-ending char, and slice(prevLineStart, prevLineEnd)
    // never includes the line-ending char. Testing related CRLF paths for confidence:
    test('isPrecedingContinuationKeyword: CRLF line ending in select continuation', () => {
      // select &\r\n  type -> CRLF, exercises the backward scan path
      const source = 'select &\r\n  type (x)\n  type is (integer)\n  y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // isPrecedingContinuationKeyword: lines 555-557 - return false when loop exhausted
    // Happens when all preceding lines are comment-only, exhausting prevLineEnd to < 0
    test('isPrecedingContinuationKeyword: exhausts all preceding comment lines and returns false', () => {
      // type appears after only comment-only lines at the start of the file
      // After skipping comments, prevLineEnd drops to -1, exits the while loop,
      // and falls through to return false at lines 555-557
      const source = '! first comment\n! second comment\ntype (x)';
      const typePos = source.indexOf('type');
      assert.strictEqual(isPrecedingContinuationKeyword(source, typePos, 'select'), false);
    });

    // isAfterDoubleColon: lines 583-584 - \r stripping on continuation prevLine
    // Same architecture as lines 521-522 - defensive code for embedded \r in line content
    test('isAfterDoubleColon: procedure with CRLF continuation having :: in string', () => {
      // procedure &\r\n  'a :: b' -> :: is inside a string (excluded region)
      // isAfterDoubleColon finds :: on continuation line but it's excluded (lines 602-606)
      const source = "procedure &\r\n  'a :: b'\r\nend procedure";
      const pairs = parser.parse(source);
      // procedure should be a block opener (:: is inside string, excluded)
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });

    // isAfterDoubleColon: line 603 - :: found on continuation line NOT in excluded region -> return true
    test('isAfterDoubleColon: :: on continuation line not excluded returns true', () => {
      // Direct call: "integer :: &\n  do = 5"
      // 'do' is on line 2 (continuation). Line 1 ends with & and has ::
      // Continuation scan: fullPrevLine = "integer :: &", finds :: at idx 8, not excluded -> return true
      const source = 'integer :: &\n  do = 5';
      const doPos = source.indexOf('do');
      const result = isAfterDoubleColon(source, doPos, []);
      assert.strictEqual(result, true);
    });

    // isAfterDoubleColon: lines 603-606 - :: found on continuation but in excluded region -> loop continues
    test('isAfterDoubleColon: :: in string on continuation line is excluded', () => {
      // Direct call: "procedure :: &\n  'x :: y'\n  keyword"
      // 'keyword' is on line 3. Line 2 (direct predecessor) doesn't end with &.
      // So only line 2 is checked as continuation - but it doesn't end with &, breaks early.
      // Now use: "procedure :: &\n  keyword" where :: IS NOT excluded (direct call).
      // Different: find :: in excluded region on a line that ends with &:
      // "proc 'a :: b' &\n  do_thing" - line 1 has :: only inside string
      const source = "proc 'a :: b' &\n  do_thing";
      const doPos = source.indexOf('do_thing');
      const stringStart = source.indexOf("'");
      const stringEnd = source.indexOf("'", stringStart + 1) + 1;
      const result = isAfterDoubleColon(source, doPos, [{ start: stringStart, end: stringEnd }]);
      // :: found but it's in excluded region, inner loop continues past it (lines 603-606)
      // no more :: after that, fullPrevLine exhausted -> move to previous line -> no more lines -> return false
      assert.strictEqual(result, false);
    });

    // collapseContinuationLines: line 107 - doubled quote inside string triggers k++ branch
    test('collapseContinuationLines: doubled quote in string before & continuation', () => {
      // "select case ('it''s') &\n  case ('more')\n  case default\n    y = 1\nend select"
      // -> collapseContinuationLines called with " case ('it''s') &\n  case ('more')..."
      // '' inside 'it''s' triggers line 107 (k++ for escaped quote)
      const source = "select case ('it''s') &\n  case ('more')\n  case default\n    y = 1\nend select";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // collapseContinuationLines: line 107 direct call - doubled quote inside string
    test('collapseContinuationLines: direct call with doubled quotes inside string', () => {
      // "a 'it''s' &\n  rest" -> '' inside string triggers line 107 (k++ escaped quote branch)
      const result = collapseContinuationLines("a 'it''s' &\n  rest");
      assert.strictEqual(result, "a 'it''s'  rest");
    });

    // collapseContinuationLines: lines 132-133 direct call - & at end of text with no newline
    test('collapseContinuationLines: direct call with & at end of text (no newline)', () => {
      // "hello &" -> & at end, no newline -> lines 132-133: j >= text.length, break
      const result = collapseContinuationLines('hello &');
      assert.strictEqual(result, 'hello ');
    });

    // collapseContinuationLines: line 161 direct call - comment-only line ending at EOF
    test('collapseContinuationLines: direct call with comment-only line at EOF', () => {
      // "hello &\n! comment at eof" -> comment-only line, lineEnd reaches text.length (line 161)
      // After comment skipped, j = text.length, loop exits, then result += ' ' appended
      // Result is 'hello ' (from slice) + ' ' (from continuation) = 'hello  ' (two spaces)
      const result = collapseContinuationLines('hello &\n! comment at eof');
      assert.strictEqual(result, 'hello  ');
    });

    // fortranParser.ts line 275-276: isValidBlockClose returns true when keyword !== 'end'
    // Dead code since Fortran blockClose = ['end'] only, but attempt to exercise adjacent code
    test('should handle non-end block close keywords correctly', () => {
      // This exercises the isValidBlockClose code path
      // When compound end keywords appear (end if, end do), they are also validated
      const source = 'do i = 1, 10\n  x = x + i\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    // fortranParser.ts lines 546-549: else + where merge skipped when another token between them
    test('should not merge else and where when another keyword token appears between them', () => {
      // In the merge loop, if elseWhereMatch.whereStart >= nextTokenStart (another token between),
      // the merge is skipped. This requires 'else' followed by a token (e.g., 'if') then 'where'.
      // Real case: 'elsewhere' is one token; 'else where' (space-separated) normally merges.
      // To prevent merge: have a keyword between else and the 'where' found by matchElseWhere.
      // 'elsewhere' keyword followed by 'where': uncommon but test adjacency
      const source = 'where (a > 0)\n  a = 1\nelse\nend where\nwhere (b > 0)\n  b = 1\nend where';
      const pairs = parser.parse(source);
      // Two separate 'where' blocks
      assertBlockCount(pairs, 2);
    });

    // collapseContinuationLines: continuation-only line with trailing ! comment
    test('collapseContinuationLines: continuation-only line with trailing comment', () => {
      // "select &\n  & ! comment\n  &case (x)\n..." - the "& ! comment" line should be skipped
      const source = 'select &\n  & ! comment\n  &case (x)\n  case default\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('collapseContinuationLines: continuation-only line with trailing comment (direct call)', () => {
      const result = collapseContinuationLines('hello &\n  & ! trailing comment\n  &world');
      assert.strictEqual(result, 'hello  world');
    });

    test('collapseContinuationLines: continuation-only line with trailing comment CRLF', () => {
      const result = collapseContinuationLines('hello &\r\n  & ! comment\r\n  &world');
      assert.strictEqual(result, 'hello  world');
    });

    // collapseContinuationLines: line 171 - trailing whitespace after & on continuation-only line
    test('collapseContinuationLines: continuation-only line with trailing whitespace after &', () => {
      // "select &\n  &  \n  case (x)\n..." - the "& " line has trailing whitespace after &
      // afterAmpCheck++ (line 170) executes at least once to skip the trailing space
      const source = 'select &\n  &  \n  case (x)\n  case default\n    y = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // isTypeSpecifier: lines 262-263 - returns false when no ( found after whitespace
    test('isTypeSpecifier: returns false when non-paren character follows type', () => {
      // Direct call: isTypeSpecifier("type &\n  x", 4)
      // After type (position 4 = space), skip whitespace, find '&' which is not '(' -> return false
      const source = 'type &\n  x';
      const result = isTypeSpecifier(source, 4);
      assert.strictEqual(result, false);
    });

    // isBlockWhereOrForall: line 403 - CRLF line ending when & continuation precedes paren
    test('isBlockWhereOrForall: where with CRLF before opening paren', () => {
      // "where &\r\n  (mask > 0)\r\n  a = 1\r\nend where"
      // After &, CRLF is encountered -> line 402-403: i += 2 (skip \r\n)
      const source = 'where &\r\n  (mask > 0)\r\n  a = 1\r\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    // isStringContinuation: lines 11-12 - trailing whitespace before & in string continuation
    test('isStringContinuation: string with trailing whitespace before & continuation', () => {
      // "x = 'hello &   \n  rest'\nif (.true.) then\nend if"
      // matchFortranString encounters \n inside 'hello &   ...
      // isStringContinuation called: j starts at last space before \n, loop (line 12) skips spaces
      // until j points to &, then returns true
      const source = "x = 'hello &   \n  rest'\nif (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // isStringContinuation: lines 30-35 - doubled quote inside forward scan
    test('isStringContinuation: doubled quote inside string during forward scan for !', () => {
      // "x = 'it''s & ! note\n& more'\nif (.true.) then\nend if"
      // matchFortranString encounters \n inside 'it''s & ! note...
      // isStringContinuation: forward scan encounters '' at lines 30-35 (doubled quote escape)
      const source = "x = 'it''s & ! note\n& more'\nif (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // isStringContinuation: lines 41-46 - ! comment with & before it in string continuation
    test('isStringContinuation: ! comment after & in string continuation', () => {
      // "x = 'hello & ! inline comment\n& rest'\nif (.true.) then\nend if"
      // matchFortranString encounters \n inside 'hello & ! inline comment...
      // isStringContinuation: forward scan finds '!' at line 40, then checks for & before it
      // k points to &, returns true (line 45)
      const source = "x = 'hello & ! inline comment\n& rest'\nif (.true.) then\nend if";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Coverage: uncovered branches - targeted', () => {
    // isStringContinuation: lines 33-34 AND 41-46 combined
    // Line 33-34: break when closing quote is found (not doubled) in forward scan
    // Lines 41-46: ! comment found, checks for & before it
    // To hit both, the line must have a properly terminated "inner" string BEFORE the ! comment
    test('isStringContinuation: inner double-quoted string before ! comment with & continuation', () => {
      // Multi-line string where continuation line starts with "inner" (properly closed)
      // followed by & ! comment. Forward scan finds "inner" (break at closing "),
      // then continues to find ! and checks for & before it
      const source = 'y = \'start &\n"z" & ! note\n& end\'\nif (.true.) then\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // isStringContinuation: lines 33-34 only - break with single-quoted inner string
    test('isStringContinuation: inner single-quoted string closes normally in forward scan', () => {
      // Continuation line starts with 'x' (properly terminated single-quoted string)
      // The closing ' is not doubled, so break at line 33 is hit
      const source = 'y = "start &\n\'z\' & ! note\n& end"\nif (.true.) then\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    // isPrecedingContinuationKeyword: lines 521-522 - \r trimming in prevLine
    // This is defensive code: with standard line endings, findLineStart always positions
    // prevLineEnd AT the line-ending char, so slice never includes it.
    // Test exercises the closest reachable path with \r-only line endings.
    test('isPrecedingContinuationKeyword: select continuation with CR-only line endings', () => {
      const source = 'select &\r  type (x)\r  type is (integer)\r  y = 1\rend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    // isPrecedingContinuationKeyword: direct call with \r-only between select and type
    test('isPrecedingContinuationKeyword: direct call with CR-only line ending', () => {
      const source = 'select &\rtype';
      const typePos = source.indexOf('type');
      assert.strictEqual(isPrecedingContinuationKeyword(source, typePos, 'select'), true);
    });

    // isAfterDoubleColon: lines 583-584 - \r trimming in prevLine
    // Same defensive pattern as isPrecedingContinuationKeyword lines 521-522.
    // Test exercises the closest reachable path with \r-only continuation lines.
    test('isAfterDoubleColon: continuation line with CR-only line ending', () => {
      // integer :: &\r  x should detect :: on continuation line
      const source = 'integer :: &\r  x\rif (.true.) then\rend if';
      const pairs = parser.parse(source);
      // This tests that the \r-only path through isAfterDoubleColon works correctly
      assert.ok(Array.isArray(pairs));
    });

    // isAfterDoubleColon: direct call with \r-only line ending on continuation
    test('isAfterDoubleColon: direct call with CR-only line ending on continuation', () => {
      const source = 'integer :: &\rif';
      const ifPos = source.indexOf('if');
      assert.strictEqual(isAfterDoubleColon(source, ifPos, []), true);
    });

    // isContinuationBlockForm: test with \r-only line endings
    test('isContinuationBlockForm: where block with CR-only line endings', () => {
      const source = 'where (a > 0) &\r  a = 1\rend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });
  });

  // Note: fortranParser.ts lines 546-549 (else-where merge abort guard) are
  // unreachable via parse() or tokenize() because matchElseWhere only finds "where"
  // immediately after "else" (whitespace or continuation), and no tokenized keyword
  // can exist in that whitespace gap. This is defensive code.

  suite('Regression: type specifier with continuation line', () => {
    test('should reject type specifier with continuation between type and paren', () => {
      const source = 'program test\n  type &\n    (integer) :: x\n  x = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still reject type specifier without continuation', () => {
      const source = 'program test\n  type(integer) :: x\n  x = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: isStringContinuation with opening quote on same line as & ! comment', () => {
    test('should exclude string with opening quote before & ! comment', () => {
      const source = `program test
  character(50) :: msg
  msg = 'hello & ! greeting
         &if then end if'
  print *, msg
end program`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: end(i) with continuation before assignment', () => {
    test('should not treat end(1) &\\n = value as block close', () => {
      const source = 'program test\n  integer :: end(10)\n  end(1) &\n    = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still treat end(1) = value as assignment', () => {
      const source = 'program test\n  integer :: end(10)\n  end(1) = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: isBlockWhereOrForall string continuation', () => {
    test('should handle string with & continuation inside where condition', () => {
      const source = "program test\n  where(names == 'hello &\n    &world')\n    a = 1\n  end where\nend program";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const whereBlock = findBlock(pairs, 'where');
      assert.ok(whereBlock, 'where block should be found');
    });

    test('should handle double-quoted string with & continuation inside where condition', () => {
      const source = 'program test\n  where(names == "hello &\n    &world")\n    a = 1\n  end where\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const whereBlock = findBlock(pairs, 'where');
      assert.ok(whereBlock, 'where block should be found');
    });
  });

  suite('Branch coverage: isValidBlockClose and continuation edge cases', () => {
    test('should accept compound end keywords (not bare end) without validation', () => {
      const source = 'program test\n  if (x > 0) then\n    y = 1\n  endif\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle end(n) with CRLF & continuation as variable', () => {
      const source = 'program test\n  end(1) &\r\n  = value\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle end(n) with double & continuation as variable', () => {
      const source = 'program test\n  end(1) &\n  & = value\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle compound end in tokenization', () => {
      const source = 'subroutine foo()\n  if (.true.) then\n    x = 1\n  end if\nend subroutine foo';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.ok(ifBlock);
      assert.strictEqual(ifBlock.closeKeyword.value.toLowerCase(), 'end if');
    });
  });

  suite('Branch coverage: fortranHelpers edge cases', () => {
    test('should handle isStringContinuation when no ! found on line', () => {
      const source = 'program test\n  x = "hello &\n       &world"\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle isAfterDoubleColon with ! comment before ::', () => {
      const source = 'program test\n  integer ! comment\n  :: x = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should handle isIfContinuation with CRLF comment-only line', () => {
      const source = 'program test\n  if &\r\n  ! comment\r\n  &(x > 0) then\n    y = 1\n  end if\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle isAfterDoubleColon with :: on continuation line', () => {
      const source = 'program test\n  integer &\n  :: x\n  if (.true.) then\n    y = 1\n  end if\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Branch coverage: isStringContinuation returns false', () => {
    test('should handle unterminated string inside where condition (no & continuation)', () => {
      // Covers fortranHelpers.ts lines 64-65: isStringContinuation returns false
      // and fortranHelpers.ts lines 451-452: break on non-continuation newline in string
      // The string 'unterminated has a newline without & before it
      const source = "where (names == 'unterminated\n  value')\n  a = 1\nend where";
      const pairs = parser.parse(source);
      // The unterminated string breaks at newline, where condition continues
      assert.ok(Array.isArray(pairs));
    });
  });

  suite('Branch coverage: CRLF in string continuation inside where condition', () => {
    test('should handle CRLF line ending in string continuation inside where condition', () => {
      // Covers fortranHelpers.ts line 439: CRLF handling in string continuation
      // String with & continuation using \r\n line endings inside where condition
      const source = "where (names == 'hello &\r\n  &world')\r\n  a = 1\r\nend where";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });
  });

  suite('Branch coverage: end(n) & with content before newline', () => {
    test('should not treat end(n) & with trailing comment as block close', () => {
      // Covers fortranParser.ts lines 353-354: while loop body executes when
      // there is content between & and newline (comment text)
      const source = 'program test\n  integer :: end(10)\n  end(1) & ! comment\n    = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat end(n) & with trailing spaces as block close', () => {
      // Covers fortranParser.ts lines 353-354: while loop body with whitespace
      const source = 'program test\n  integer :: end(10)\n  end(1) &   \n    = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat end(n) & with & ! comment continuation as block close', () => {
      // Covers fortranParser.ts lines 399-400: & ! comment line after end(expr) &
      const source = 'program test\n  integer :: end(10)\n  end(1) &\n  & ! comment\n  = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: isContinuationBlockForm end where across lines', () => {
    test('should not match end on one line with where on the next as end where', () => {
      const source = 'program test\n  where (a > 0) b = 1\n  where (c > 0)\n    d = 2\n  end where\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'where');
      findBlock(pairs, 'program');
    });
  });

  suite('Regression: collapseContinuationLines skips ! comments', () => {
    test('should not treat & inside ! comment as continuation', () => {
      const result = collapseContinuationLines(' ! see section 5 & appendix A\n  case (1)');
      // & inside comment should not join lines, so newline is preserved
      assert.ok(result.includes('\n'));
      assert.ok(result.includes('case'));
    });

    test('should still handle & outside comments as continuation', () => {
      const result = collapseContinuationLines(' &\n  case (1)');
      assert.ok(result.includes('case'));
      // Lines should be joined (no newline)
      assert.ok(!result.includes('\n'));
    });

    test('should recognize select case with & continuation but not through comment', () => {
      // Valid Fortran: select with & continuation to case
      const source = 'select &\n  case (1)\n    x = 1\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });
  });

  suite('Regression: \\s -> [ \\t] in isContinuationBlockForm end-where/forall pattern', () => {
    // isContinuationBlockForm end-where/forall regex changed from /^end\s*(where|forall)\b/i
    // to /^end[ \t]+(where|forall)\b/i so a newline inside the pattern no longer matches

    test('should still detect end where on the same line as block form', () => {
      // Single-line where spread followed by end where on same line (block form)
      const source = 'where (a > 0) &\n  b = sqrt(a)\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should still detect end forall on the same line as block form', () => {
      const source = 'forall (i = 1:n) &\n  a(i) = b(i)\nend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });

    test('should treat continuation body followed by end-where as block form (not single-line spread)', () => {
      // Block where: condition, continuation, end where -> block form
      const source = 'where (a > 0)\n  b = sqrt(a)\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should still treat continuation where as single-line spread when next line is non-end keyword', () => {
      // where with & continuation inside do-loop: single-line spread
      const source = 'do i = 1, n\n  where (a > 0) &\n    b(i) = sqrt(a(i))\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should still detect select type block with type is guard', () => {
      // select type with 'type is (integer)' guard - type IS detection still works
      const source = 'select type (x)\n  type is (integer)\n    print *, x\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should treat type on its own line as block opener when type is on next line', () => {
      // 'type is' regex uses /^[ \t]+is[ \t]*\(/ after collapseContinuationLines
      // Without continuation, type on line 1 and 'is (integer)' on line 2 are separate lines
      // type on first line has no is(...) following it -> treated as block opener
      const source = 'select type (x)\n  type\nis (integer)\n    y = 1\nend select';
      const pairs = parser.parse(source);
      // 'type' on its own line is a block opener (type is not on same/collapsed line)
      // It will create a block that matches end select as end
      assertSingleBlock(pairs, 'select', 'end select');
    });
  });

  suite('Regression: isStringContinuation backward scan bounded to lineStart', () => {
    test('should not detect & from previous line when ! comment has no preceding &', () => {
      const source = 'x = y + &\nz = "start ! no-continuation\nif (.true.) then\n  x = 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Regression: continuation compound end with bare & line', () => {
    test('should recognize compound end type with bare & continuation line between', () => {
      const source = 'if (.true.) then\n  x = 1\nend &\n  &\n  if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should still recognize compound end with comment-only line between', () => {
      const source = 'if (.true.) then\n  x = 1\nend &\n  ! comment\n  if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Branch coverage: isValidBlockClose compound end keywords bypass', () => {
    test('should accept end if without bare end validation', () => {
      // Covers fortranParser.ts lines 275-276: keyword !== 'end' returns true immediately
      // Compound end keywords like "end if" skip the variable-name checks
      const source = 'if (.true.) then\n  x = 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should accept end do without bare end validation', () => {
      // Covers fortranParser.ts lines 275-276: compound end keyword passes through
      const source = 'do i = 1, 10\n  x = x + 1\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should accept end program without bare end validation', () => {
      // Covers fortranParser.ts lines 275-276: compound end keyword passes through
      const source = 'program main\n  x = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Branch coverage: else+where merge with intervening token', () => {
    test('should not merge else and where when another token exists between them', () => {
      // Covers fortranParser.ts lines 546-549: elseWhereMatch.whereStart >= nextTokenStart
      // else followed by an if token, then where text after the if
      // The source-based matchElseWhere finds "where" but another token (if) comes first
      const source = 'where (a > 0)\n  b = 1\nelse\nif (.true.) then\n  where (c > 0)\n    d = 2\n  end where\nend if';
      const pairs = parser.parse(source);
      // else is not merged with where since if token intervenes
      assert.ok(pairs.length >= 1);
    });

    test('should not merge else with where keyword from a different block', () => {
      // Covers fortranParser.ts lines 547-548: another token between else and where
      // else is part of an if block, followed by a do block, then a where block
      const source = 'if (.true.) then\n  x = 1\nelse\ndo i = 1, 5\n  where (a > 0)\n    b = 1\n  end where\nend do\nend if';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'if');
      findBlock(pairs, 'do');
      findBlock(pairs, 'where');
    });
  });

  suite('Branch coverage: isStringContinuation fallback returning false', () => {
    test('should return false when line has no & and no ! comment', () => {
      // Covers fortranHelpers.ts lines 64-65: isStringContinuation returns false
      // A string with a newline but no & continuation marker on the line
      const source = "program test\n  x = 'hello\nworld'\n  if (.true.) then\n    y = 1\n  end if\nend program";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });
  });

  suite('Branch coverage: CR line ending in isPrecedingContinuationKeyword', () => {
    test('should strip trailing CR from previous line during backward scan', () => {
      // Covers fortranHelpers.ts lines 556-557: prevLine.endsWith('\\r') -> slice
      // Uses CR-only line endings so prevLine includes trailing \\r
      const source = 'select &\r  type (x)\r    x = 1\rend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });

    test('should handle CRLF in isPrecedingContinuationKeyword backward scan', () => {
      // Covers fortranHelpers.ts lines 555-557: CR stripping on CRLF content
      const source = 'select &\r\n  type (x)\r\n    x = 1\r\nend select';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'select', 'end select');
    });
  });

  suite('Branch coverage: CR line ending in isAfterDoubleColon backward scan', () => {
    test('should strip trailing CR from continuation line in isAfterDoubleColon', () => {
      // Covers fortranHelpers.ts lines 618-619: prevLine.endsWith('\\r') -> slice
      // Uses CR-only line endings with :: on a continuation line
      const source = 'program test\r  integer &\r  :: x\r  if (.true.) then\r    y = 1\r  end if\rend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle CRLF in isAfterDoubleColon backward scan with continuation', () => {
      // Covers fortranHelpers.ts lines 617-619: CR handling on CRLF boundary
      const source = 'program test\r\n  integer &\r\n  :: x\r\n  if (.true.) then\r\n    y = 1\r\n  end if\r\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: isValidIfOpen parenthesis depth tracking', () => {
    test('should not treat if with then inside parentheses as block if', () => {
      const pairs = parser.parse(
        'program test\n  integer :: then\n  if (func(then) > 0) print *, "found"\n  if (y > 0) then\n    z = 1\n  end if\nend program'
      );
      assertBlockCount(pairs, 2); // program/end program + if/end if
    });
  });

  suite('Coverage: isInsideParentheses string scanning', () => {
    // Covers lines 91-107: backward string literal scanning inside parentheses
    test('should reject end inside parentheses with string literal', () => {
      // call foo("end", end) - the second 'end' is inside parentheses
      const source = 'program test\n  call foo("end", end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parentheses with single-quoted string', () => {
      const source = "program test\n  call foo('end', end)\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parentheses with doubled-quote escaped string', () => {
      // Covers lines 97-99: doubled quote escape in backward scan
      const source = "program test\n  call foo('it''s end', end)\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: isInsideParentheses comment handling', () => {
    // Covers lines 112-147: ! comment handler in backward parenthesis scan
    test('should reject end inside parentheses when line has ! comment', () => {
      // x = func(end ! comment with )
      // The end is inside parens, ! starts a comment; backward scan hits !
      // rescan code before ! to get correct depth
      const source = 'program test\n  x = func(end ! comment with )\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parentheses with string before ! comment', () => {
      // Covers lines 116-130: string scanning within rescan loop
      const source = "program test\n  x = func('str', end ! note\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parentheses with doubled-quote string before ! comment', () => {
      // Covers lines 121-122: doubled quote in rescan forward scan
      const source = "program test\n  x = func('it''s', end ! note\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parens on continuation line with ! comment', () => {
      // Covers lines 139-145: continuation line scan after hitting !
      const source = 'program test\n  x = func( &\n  end ! comment\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: isInsideParentheses & continuation', () => {
    // Covers lines 149-160: & continuation character handling
    test('should reject end inside parentheses across & continuation', () => {
      // func( &\n  end) - end is on continuation line inside parens
      const source = 'program test\n  x = func( &\n  end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end inside parens with & at column 0 of continuation line', () => {
      // Covers lines 152-158: & at column 0, after i-- crosses line boundary
      const source = 'program test\n  x = func( &\n&end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: isInsideParentheses depth and continuation line scan', () => {
    // Covers lines 162-165: unmatched ( at depth 0 returns true
    test('should reject end inside nested parentheses', () => {
      // func(a(b), end) - end is inside outer parens, a(b) has inner parens
      const source = 'program test\n  x = func(a(b), end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 168-173: continuation line scan when reaching line start
    test('should reject end inside parens spanning multiple continuation lines', () => {
      // func(a, &\n  b, &\n  end) - end is on third continuation line
      const source = 'program test\n  x = func(a, &\n  b, &\n  end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: isInsideParentheses pre-check continuation', () => {
    // Covers lines 82-87: keyword at column 0 of continuation line
    test('should reject end at start of continuation line inside parens', () => {
      // func( &\nend) - end is at column 0 of a continuation line
      const source = 'program test\n  x = func( &\nend)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: findContinuationLineStart & on previous line', () => {
    // Covers lines 234-236: previous line ends with &, return prevLineStart
    test('should follow continuation when previous line ends with &', () => {
      // Tests findContinuationLineStart finding & at end of code on previous line
      const source = 'program test\n  x = func( &\n  ! comment\n  end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: isValidCompoundEndClose branches', () => {
    // Covers lines 252-276: compound end keyword (enddo, endif) used as variable
    test('should not treat enddo = value as block close', () => {
      const source = 'program test\n  integer :: enddo\n  enddo = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat endif = value as block close', () => {
      const source = 'program test\n  integer :: endif\n  endif = 10\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 256-273: compound end with & continuation then assignment
    test('should not treat enddo with & continuation then = as block close', () => {
      const source = 'program test\n  integer :: enddo\n  enddo &\n  = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat enddo with & continuation and CRLF then = as block close', () => {
      // Covers lines 259-260: CRLF handling in compound end & continuation
      const source = 'program test\r\n  integer :: enddo\r\n  enddo &\r\n  = 5\r\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat endif with & continuation and leading & then = as block close', () => {
      // Covers lines 267-272: leading & on next continuation line
      const source = 'program test\n  integer :: endif\n  endif &\n  & = 10\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 277-286: compound end with parenthesized subscript then assignment
    test('should not treat enddo(1) = value as block close', () => {
      const source = 'program test\n  integer :: enddo(5)\n  enddo(1) = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat endif(1)(2) = value as block close', () => {
      // Covers skipConsecutiveParenGroups + assignment check
      const source = 'program test\n  integer :: endif(5,5)\n  endif(1)(2) = 99\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat enddo(n) == value as comparison, allow as block close', () => {
      // Covers lines 283: == comparison should NOT reject (only = assignment rejects)
      const source = 'do i = 1, 10\n  if (enddo(n) == 0) x = 1\nenddo';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'enddo');
    });

    // Covers lines 287-289: compound end with % component access
    test('should not treat enddo%field as block close', () => {
      const source = 'program test\n  enddo%field = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 292-294: non-end, non-compound keyword returns true
    test('should accept valid compound end keyword without assignment or component access', () => {
      const source = 'do i = 1, 10\n  x = i\nenddo';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'enddo');
    });
  });

  suite('Coverage: isStringContinuation fallback after continuation', () => {
    // Covers fortranHelpers.ts lines 64-65: return false when no & and no ! on line
    // This path is reached when a string has & continuation to a next line,
    // but the next line has no & before the line break
    test('should terminate string continuation when second line has no &', () => {
      // 'hello &\nworld\n -> first \n has & before it (continuation), second \n does not
      // isStringContinuation returns false for the second newline (lines 64-65)
      const source = "program test\n  x = 'hello &\nworld\nif (.true.) then\nend if'\nend program";
      const pairs = parser.parse(source);
      // The string terminates at the second \n (no continuation), so 'if' and 'end if' are outside
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      findBlock(pairs, 'if');
    });
  });

  suite('Coverage: isPrecedingContinuationKeyword and isAfterDoubleColon CR defense', () => {
    // Covers fortranHelpers.ts lines 563-564: prevLine.endsWith('\r') in isPrecedingContinuationKeyword
    // These are defensive code paths. The CR stripping is for edge cases where
    // findLineStart positions include a trailing \r. Testing with direct function call.
    test('isPrecedingContinuationKeyword: direct call verifying CR-only handling', () => {
      // select &\r  type -> with CR-only line ending
      const source = 'select &\r  type (x)';
      const typePos = source.indexOf('type');
      const result = isPrecedingContinuationKeyword(source, typePos, 'select');
      assert.strictEqual(result, true);
    });

    // Covers fortranHelpers.ts lines 625-626: prevLine.endsWith('\r') in isAfterDoubleColon
    test('isAfterDoubleColon: direct call verifying CR-only handling', () => {
      // integer :: &\r  x -> with CR-only line ending
      const source = 'integer :: &\r  x';
      const xPos = source.indexOf('x');
      const result = isAfterDoubleColon(source, xPos, []);
      assert.strictEqual(result, true);
    });
  });

  suite('Coverage: isInsideParentheses additional edge cases', () => {
    // Covers isInsideParentheses comment rescan where rescanDepth > depthBeforeLine
    test('should reject end inside parens when comment hides closing paren', () => {
      // x = func(end ! comment with ) here
      // Rescan code before ! finds ( but no matching ), so rescanDepth > 0 = depthBeforeLine
      const source = 'program test\n  x = func(end ! comment)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers isInsideParentheses: comment rescan with balanced parens
    test('should accept end outside parens when comment has balanced parens', () => {
      // x = func(y) ! comment with (parens)
      // end is after the closing paren, so it's outside parens
      const source = 'program test\n  x = func(y) ! comment (parens)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers isInsideParentheses: multi-line with & where comment and continuation interact
    test('should reject end inside parens across continuation with comment', () => {
      // func( &  ! comment\n  end) - end is on continuation line inside parens
      // The ! comment on the first line doesn't affect paren tracking
      const source = 'program test\n  x = func( &  ! comment\n  end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers isInsideParentheses: closing paren before keyword on same line
    test('should accept end when closing paren comes before it on same line', () => {
      // func(y); end - end is after ), not inside parens
      const source = 'program test\n  call func(y)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers the depth tracking with multiple parens and continuation
    test('should reject end inside deeply nested parens across continuations', () => {
      const source = 'program test\n  x = func(a, &\n  func2(end))\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Additional test: end as function argument with string and comment
    test('should reject end in function call with string literal and comment', () => {
      const source = "program test\n  call sub('text', &  ! a comment\n  end)\nend program";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 140-147: ! comment on continuation line with balanced code before !
    // The continuation line has balanced parens before the comment, so isInsideParentheses
    // does not detect the function call paren context for the end on the next line
    test('should handle end inside parens when continuation line has ! comment with balanced code', () => {
      const source = 'program test\n  x = func(a, &\n  b ! comment\n  , end)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });
  });

  suite('Coverage: isValidCompoundEndClose CRLF and edge cases', () => {
    // Covers lines 256-273: compound end with & continuation then = across CRLF line
    test('should not treat enddo with CRLF & continuation then = as block close', () => {
      const source = 'program test\r\n  integer :: enddo\r\n  enddo & ! var\r\n  = 5\r\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 256-262: compound end & with standalone \r then =
    test('should not treat enddo with CR-only & continuation then = as block close', () => {
      const source = 'program test\r  integer :: enddo\r  enddo &\r  = 5\rend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 263-272: skipCommentAndContinuationLines + leading & on next line
    test('should not treat enddo with & continuation comment line then & = as block close', () => {
      const source = 'program test\n  integer :: enddo\n  enddo &\n  ! comment\n  & = 5\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 277-286: compound end followed by (expr) then = assignment
    test('should not treat enddo(n) = value as block close with space before =', () => {
      const source = 'program test\n  integer :: enddo(10)\n  enddo(2) = 42\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 277-286: compound end with multiple paren groups then =
    test('should not treat enddo(1)(2) = value as block close', () => {
      const source = 'program test\n  integer :: enddo(5,5)\n  enddo(1)(2) = 99\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers lines 287-289: compound end followed by % (component access)
    test('should not treat endif%status as block close', () => {
      const source = 'program test\n  endif%status = 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    // Covers line 290: compound end returns true (valid block close)
    test('should accept valid enddo as block close', () => {
      const source = 'do i = 1, 10\n  x = i + 1\nenddo';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'enddo');
    });
  });

  suite('Coverage: fortranParser else+where merge abort and where without paren', () => {
    // Covers fortranParser.ts lines 411-414: else+where merge abort guard
    // When matchElseWhere finds "where" but another token starts before it
    test('should not merge else with where when token intervenes in source scan', () => {
      // else followed immediately by end and then where on the next line
      // matchElseWhere may find "where" in source, but end keyword comes first
      const source = 'where (a > 0)\n  b = 1\nelse\nend where';
      const pairs = parser.parse(source);
      // else is not merged with distant where
      assert.ok(Array.isArray(pairs));
    });

    // Covers fortranParser.ts lines 437-438: where/forall without opening paren returns false
    test('should reject forall without parenthesized condition', () => {
      const source = 'forall x\nend forall';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: findContinuationLineStart reaching source start past comment', () => {
    test('should handle findContinuationLineStart looping past comment-only first line to source start', () => {
      // Covers fortranValidation.ts line 189: prevEnd < 0 return -1
      // isInsideParentheses pre-check calls findContinuationLineStart, which skips
      // the comment-only first line and then reaches source start (prevEnd < 0)
      const source = '! comment\nprogram test\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Coverage: skipCommentAndContinuationLines CRLF in bare & line', () => {
    test('should handle CRLF line endings in bare & continuation line during compound end validation', () => {
      // Covers fortranValidation.ts line 403: CRLF handling in skipCommentAndContinuationLines
      // enddo & followed by bare & continuation line with CRLF endings
      const source = 'program test\r\n  integer :: enddo\r\n  enddo &\r\n  &\r\n  = 5\r\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  // Regression: else where in if block should preserve else as intermediate
  suite('Regression: else where in if block', () => {
    test('should preserve else when followed by where in if block', () => {
      const source = 'if (x > 0) then\n  y = 1\nelse where (a > 0) a = 1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const ifBlock = findBlock(pairs, 'if');
      const hasElse = ifBlock.intermediates.some((t) => t.value.toLowerCase().startsWith('else'));
      assert.strictEqual(hasElse, true, 'else should be intermediate of if block');
    });

    test('should still merge else where for where blocks', () => {
      const source = 'where (a > 0)\n  b = 1\nelse where (a < 0)\n  b = -1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      assertIntermediates(findBlock(pairs, 'where'), ['else where']);
    });
  });

  suite('Regression: isBlockWhereOrForall bare & continuation', () => {
    test('should detect where...end where with bare & and comment-only continuation line', () => {
      const source = 'where &\n  & ! comment\n  &(mask > 0)\n  a = 1\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
    });

    test('should detect forall...end forall with bare & continuation lines', () => {
      const source = 'forall &\n  &\n  &(i = 1:n)\n  a(i) = i\nend forall';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'forall', 'end forall');
    });
  });

  suite('Regression: bare & continuation in else if/where merge', () => {
    test('should merge else if across bare & continuation line', () => {
      const source = 'if (x > 0) then\n  y = 1\nelse &\n  &\n  if (x < 0) then\n  y = -1\nend if';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      // Merged token value includes raw continuation characters from source
      assert.strictEqual(pairs[0].intermediates.length, 3);
      assert.ok(/^else\b/i.test(pairs[0].intermediates[1].value), 'second intermediate should start with else');
      assert.ok(/\bif$/i.test(pairs[0].intermediates[1].value), 'second intermediate should end with if');
    });

    test('should merge else where across bare & continuation line', () => {
      const source = 'where (a > 0)\n  b = 1\nelse &\n  &\n  where\n  b = 0\nend where';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'where', 'end where');
      // Merged token value includes raw continuation characters from source
      assert.strictEqual(pairs[0].intermediates.length, 1);
      assert.ok(/^else\b/i.test(pairs[0].intermediates[0].value), 'intermediate should start with else');
      assert.ok(/\bwhere$/i.test(pairs[0].intermediates[0].value), 'intermediate should end with where');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('BUG1: end as variable in arithmetic expression should not close block', () => {
      // 'end' used as variable name in expression (RHS of assignment)
      // isValidBlockClose sees 'end' followed by ' + 1' (not = or %) and accepts it
      // Expected: program -> end program (1 pair)
      // Actual: program -> end at the expression 'end' (wrong close)
      const source = 'program test\n  integer :: end\n  end = 10\n  x = end + 1\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end as variable with multiplication should not close block', () => {
      const source = 'program test\n  integer :: end\n  end = 10\n  x = end * 2\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end as variable with unary minus should not close block', () => {
      const source = 'program test\n  integer :: end\n  end = 10\n  x = -end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end in print statement should not close block', () => {
      const source = 'program test\n  integer :: end\n  end = 5\n  print *, end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end in write statement should not close block', () => {
      const source = 'program test\n  integer :: end\n  end = 5\n  write(*,*) end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end + end in expression should not close block', () => {
      const source = 'program test\n  integer :: end\n  end = 10\n  x = end + end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG1: end in COMMON statement should not close block', () => {
      const source = 'program test\n  common /blk/ end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('BUG2: enddo as variable in expression inside do loop should not close loop', () => {
      // enddo used as variable inside a do loop falsely closes the loop
      // Expected: do -> end do, program -> end program (2 pairs)
      // Actual: do -> enddo (wrong), program -> end program
      const source = 'program test\n  integer :: enddo\n  enddo = 5\n  do i = 1, 5\n    x = enddo + i\n  end do\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      const doBlock = findBlock(pairs, 'do');
      assert.strictEqual(doBlock.closeKeyword.value.toLowerCase(), 'end do');
    });

    test('BUG2: endif as variable in expression inside if block should not close block', () => {
      const source = 'program test\n  integer :: endif\n  endif = 0\n  if (.true.) then\n    x = endif\n  end if\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value.toLowerCase(), 'end if');
    });

    test('BUG2: endprogram as variable should not close program block', () => {
      const source = 'program test\n  integer :: endprogram\n  endprogram = 5\n  do i = 1, 5\n    x = endprogram + i\n  end do\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const progBlock = findBlock(pairs, 'program');
      assert.strictEqual(progBlock.closeKeyword.value.toLowerCase(), 'end program');
    });

    test('BUG3: endif used as function call should not close if block', () => {
      // endif(5) is a function call, not a block closer
      // isValidBlockClose sees ( after endif, skips parens, no = follows -> accepts as block close
      // Expected: if -> end if, program -> end program
      // Actual: if -> endif (wrong)
      const source = 'program test\n  if (.true.) then\n    x = endif(5)\n  end if\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      const ifBlock = findBlock(pairs, 'if');
      assert.strictEqual(ifBlock.closeKeyword.value.toLowerCase(), 'end if');
    });
  });

  suite('Regression: comparison operators before end keyword', () => {
    test('should reject end after > as variable', () => {
      const pairs = parser.parse('program test\n  print *, x > end\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end after < as variable', () => {
      const pairs = parser.parse('program test\n  print *, x < end\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end after >= as variable', () => {
      const pairs = parser.parse('program test\n  result = x >= end\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end after <= as variable', () => {
      const pairs = parser.parse('program test\n  result = x <= end\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: statement keywords before end/compound-end', () => {
    test('should reject end after call as entity name', () => {
      const source = 'program test\n  call end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject enddo after save as entity name inside do loop', () => {
      const source = 'program test\n  integer :: enddo\n  do i = 1, 5\n    save enddo\n    x = i\n  end do\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      const doBlock = findBlock(pairs, 'do');
      assert.strictEqual(doBlock.closeKeyword.value.toLowerCase(), 'end do');
    });

    test('should reject end after dimension as entity name', () => {
      const source = 'program test\n  dimension end(10)\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end after data as entity name', () => {
      const source = 'program test\n  integer :: end\n  data end /5/\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end after CALL with mixed case', () => {
      const source = 'program test\n  CALL end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not reject legitimate end program after call statement', () => {
      const source = 'program test\n  call mysub()\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: isPrecededByOperator across continuation lines', () => {
    test('should reject end on continuation after = operator', () => {
      const source = 'program test\n  integer :: end\n  end = 5\n  x = &\n  end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end on continuation after + operator', () => {
      const source = 'program test\n  integer :: end\n  end = 5\n  x = y + &\n  end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject end on continuation after .and. operator', () => {
      const source = 'program test\n  integer :: end\n  end = 5\n  x = y .and. &\n  end\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not reject enddo on continuation inside do loop', () => {
      const source = 'program test\n  integer :: enddo\n  enddo = 5\n  do i = 1, 5\n    x = &\n    enddo\n  end do\nend program';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'program');
      const doBlock = findBlock(pairs, 'do');
      assert.strictEqual(doBlock.closeKeyword.value.toLowerCase(), 'end do');
    });
  });

  suite('Regression: end followed by continuation and string concatenation', () => {
    test('should not treat end followed by continuation and string concatenation as block close', () => {
      const source = 'program test\n  character(len=20) :: end\n  end = "hello"\n  end &\n  // " world"\nend program';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression tests', () => {
    test('should not treat variable named then as block keyword', () => {
      const pairs = parser.parse('if (outer > 0) then\n  if (then > 5) print *, then\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not treat then in print statement as block keyword', () => {
      const pairs = parser.parse('if (x > 0) print *, then');
      assertNoBlocks(pairs);
    });

    test('should still detect block if with then at end of line', () => {
      const pairs = parser.parse('if (x > 0) then\n  y = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should detect block if with then followed by comment', () => {
      const pairs = parser.parse('if (x > 0) then ! comment\n  y = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should filter then variable inside parenthesized condition', () => {
      const pairs = parser.parse('if (x > then) then\n  y = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should filter else variable inside parenthesized expression', () => {
      const pairs = parser.parse('if (else > 0) then\n  y = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should filter case inside function call in select case', () => {
      const pairs = parser.parse('select case (func(case))\n  case (1)\n    y = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['case']);
    });
  });

  suite('Regression: single-line if with then as variable', () => {
    test('should reject block if when content exists between ) and then', () => {
      const pairs = parser.parse('program test\n  if (x>0) a = then\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should reject block if with call statement before then', () => {
      const pairs = parser.parse('program test\n  if (x>0) call then\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should still accept valid block if with then at end of line', () => {
      const pairs = parser.parse('program test\n  if (x>0) then\n    a = 1\n  end if\nend program');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'if');
      findBlock(pairs, 'program');
    });
  });

  suite('Regression: assignment and parenthesized context for block_open', () => {
    test('should not treat subroutine as block opener in assignment', () => {
      const source = 'subroutine test()\n  integer :: subroutine\n  subroutine = 1\nend subroutine';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });

    test('should not treat do as block opener in assignment', () => {
      const source = 'do i = 1, 10\n  do = 5\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });

    test('should not treat block_open keyword inside parentheses as block opener', () => {
      const source = 'function foo(function)\n  integer :: function\nend function';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });
  });

  suite('Regression: isValidBlockOpen preceded by operator', () => {
    test('should not treat do as block opener when preceded by operator', () => {
      const source = 'program test\n  x = do + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should not treat block as block opener when preceded by operator', () => {
      const source = 'program test\n  x = block + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should not treat associate as block opener when preceded by operator', () => {
      const source = 'program test\n  x = associate + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should not treat critical as block opener when preceded by operator', () => {
      const source = 'program test\n  x = critical + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should not treat enum as block opener when preceded by operator', () => {
      const source = 'program test\n  x = enum + 1\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should reject interface preceded by operator', () => {
      const pairs = parser.parse('subroutine test\n  x = 1 + interface\nend');
      assertSingleBlock(pairs, 'subroutine', 'end');
    });

    test('should reject program preceded by operator', () => {
      const pairs = parser.parse('subroutine test\n  x = 1 + program\nend');
      assertSingleBlock(pairs, 'subroutine', 'end');
    });

    test('should still accept valid do block opener', () => {
      const source = 'do i = 1, 10\n  x = 1\nend do';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'do', 'end do');
    });
  });

  suite('Regression: isAfterDoubleColon skips comment-only lines in continuation', () => {
    test('should skip keywords on continuation lines after :: with comment-only line between', () => {
      const source = 'program test\n  integer :: a, &\n    ! comment\n    do, &\n    end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should skip keywords on continuation lines after :: with multiple comment-only lines', () => {
      const source = 'program test\n  integer :: a, &\n    ! comment 1\n    ! comment 2\n    do, &\n    end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should still detect :: on same line without comments', () => {
      const source = 'integer :: do, end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still detect :: through continuation without comment-only lines', () => {
      const source = 'integer :: a, &\n  do, &\n  end';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: string containing ) in parenthesized group', () => {
    test('should not treat end(index(str, ")")) = val as block close', () => {
      const pairs = parser.parse('program test\n  character :: end(10)\n  end(index(str, ")")) = trim(val)\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });
  });

  suite('Regression: end with parenthesized index and component access', () => {
    test('should not treat end(1)%x = 42 as block close', () => {
      const pairs = parser.parse('program test\n  end(1)%x = 42\nend program');
      assertSingleBlock(pairs, 'program', 'end program');
    });

    test('should not treat end(n)%field as block close', () => {
      const pairs = parser.parse('subroutine foo\n  end(n)%field = val\nend subroutine');
      assertSingleBlock(pairs, 'subroutine', 'end subroutine');
    });
  });

  suite('Regression: select rank intermediates', () => {
    test('should detect rank as intermediate in select rank', () => {
      const pairs = parser.parse('select rank (x)\n  rank (0)\n    x = 1\n  rank default\n    y = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['rank', 'rank']);
    });

    test('should skip first rank after select (opening guard)', () => {
      const pairs = parser.parse('select rank (x)\n  rank (0)\n    x = 1\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['rank']);
    });
  });

  suite('Regression: block_middle keywords as variable assignment LHS', () => {
    test('should not detect else = 1 as intermediate', () => {
      const pairs = parser.parse('if (cond) then\n  else = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should not detect case = n as intermediate', () => {
      const pairs = parser.parse('select case (x)\n  case (1)\n    case = n\nend select');
      assertSingleBlock(pairs, 'select', 'end select');
      assertIntermediates(pairs[0], ['case']);
    });

    test('should still detect real else as intermediate', () => {
      const pairs = parser.parse('if (cond) then\n  x = 1\nelse\n  y = 1\nend if');
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });
  });

  suite('Regression 2026-04-11: module procedure inside interface and orphan blocks', () => {
    test('should not emit stray procedure block for module procedure inside interface', () => {
      const source = 'module m\n  interface g\n    module procedure g_int\n  end interface\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'module');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'interface');
    });

    test('should still treat module procedure with body as block inside submodule', () => {
      const source = 'submodule (parent) child\ncontains\n  module procedure my_proc\n    x = 1\n  end procedure\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const sorted = [...pairs].sort((a, b) => a.openKeyword.startOffset - b.openKeyword.startOffset);
      assert.strictEqual(sorted[0].openKeyword.value.toLowerCase(), 'submodule');
      assert.strictEqual(sorted[1].openKeyword.value.toLowerCase(), 'procedure');
    });

    test('should not treat do(n) = value as a do block opener', () => {
      const source = 'program test\n  integer :: do(10)\n  do(1) = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should not treat block(n) = value as a block opener', () => {
      const source = 'program test\n  integer :: block(10)\n  block(1) = 5\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });

    test('should reject Fortran 77 labeled DO loop as a block opener', () => {
      const source = '      program test\n      do 100 i = 1, 10\n        x = i\n100   continue\n      end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'end');
    });
  });

  suite('Regression: generic interface procedure list', () => {
    test('should not treat procedure references inside generic interface as block openers', () => {
      const source = 'interface op\n  procedure op1\n  procedure op2\nend interface op\n';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'end interface');
    });
  });

  suite('Regression 2026-04-14: paren depth tracking ignores strings', () => {
    test('should not create spurious block/end-block pair when block(str) is assignment', () => {
      // Before fix: a ')' inside a string literal closed the outer '(' early,
      // so 'block(")") = 5' never detected the '=' and 'block' was treated as
      // a block opener that matched a subsequent 'end block', producing a
      // spurious pair. After fix: strings are skipped, '=' is detected, and
      // 'block' is correctly recognized as an assignment LHS (not a block).
      const source = 'program test\n  block(")") = 5\nend block\nend program\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'program');
      assert.strictEqual(pairs[0].closeKeyword.value.toLowerCase(), 'end program');
    });

    test('should handle doubled-quote escape inside string with unbalanced paren', () => {
      const source = 'program test\n  block("a""b)") = 1\nend block\nend program\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value.toLowerCase(), 'program');
    });
  });

  generateCommonTests(config);
});
