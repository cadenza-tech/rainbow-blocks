import * as assert from 'node:assert';
import { VhdlBlockParser } from '../../parsers/vhdlParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  findBlock
} from '../helpers/parserTestHelpers';

suite('VhdlBlockParser Test Suite', () => {
  let parser: VhdlBlockParser;

  setup(() => {
    parser = new VhdlBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse entity block', () => {
      const source = `entity counter is
  port (clk : in std_logic);
end entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should parse architecture block', () => {
      const source = `architecture rtl of counter is
begin
  process_logic;
end architecture;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should parse process block', () => {
      const source = `process (clk)
begin
  if rising_edge(clk) then
    q <= d;
  end if;
end process;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse if block', () => {
      const source = `if condition then
  action;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should parse case block', () => {
      const source = `case sel is
  when "00" => out <= a;
  when others => out <= b;
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
    });

    test('should parse loop block', () => {
      const source = `loop
  wait until clk = '1';
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should parse for loop block', () => {
      const source = `for i in 0 to 7 loop
  data(i) <= '0';
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should parse while loop block', () => {
      const source = `while count > 0 loop
  count := count - 1;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });

    test('should parse function block', () => {
      const source = `function add(a, b : integer) return integer is
begin
  return a + b;
end function;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should parse procedure block', () => {
      const source = `procedure reset(signal s : out std_logic) is
begin
  s <= '0';
end procedure;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });

    test('should parse package block', () => {
      const source = `package my_pkg is
  constant C : integer := 10;
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
    });

    test('should parse component block', () => {
      const source = `component counter is
  port (clk : in std_logic);
end component;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'component', 'end component');
    });

    test('should parse generate block', () => {
      const source = `gen: for i in 0 to 3 generate
  inst: entity work.cell port map (data(i));
end generate;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse block statement', () => {
      const source = `blk: block is
begin
  sig <= '1';
end block;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'block', 'end block');
    });

    test('should parse record block', () => {
      const source = `type point is record
  x : integer;
  y : integer;
end record;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'record', 'end record');
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else block', () => {
      const source = `if condition then
  action1;
else
  action2;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should parse if-elsif-else block', () => {
      const source = `if cond1 then
  action1;
elsif cond2 then
  action2;
else
  action3;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'elsif', 'then', 'else']);
    });

    test('should parse case with when', () => {
      const source = `case sel is
  when "00" => out <= a;
  when "01" => out <= b;
  when others => out <= c;
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `entity test is
end entity;

architecture rtl of test is
begin
  process (clk)
  begin
    if rising_edge(clk) then
      q <= d;
    end if;
  end process;
end architecture;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      assertNestLevel(pairs, 'entity', 0);
      assertNestLevel(pairs, 'architecture', 0);
    });

    test('should handle deeply nested if statements', () => {
      const source = `if a then
  if b then
    if c then
      action;
    end if;
  end if;
end if;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Excluded regions - Comments', () => {
    test('should ignore keywords in single-line comments', () => {
      const source = `-- if then end if entity
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should ignore keywords in block comments (VHDL-2008)', () => {
      const source = `/*
entity fake is
end entity;
*/
entity real is
end entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should handle comment at end of line', () => {
      const source = `if condition then -- end if here
  action;
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in strings', () => {
      const source = `signal msg : string := "if then end if";
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `signal msg : string := "say ""if""";
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Excluded regions - Character literals', () => {
    test('should handle character literals', () => {
      const source = `signal c : character := 'a';
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle tick for attributes', () => {
      const source = `signal len : integer := data'length;
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Case insensitivity', () => {
    test('should handle uppercase keywords', () => {
      const source = `IF condition THEN
  action;
END IF;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'IF', 'END IF');
    });

    test('should handle mixed case keywords', () => {
      const source = `Entity test Is
End Entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'Entity', 'End Entity');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('signal a : std_logic;');
      assertNoBlocks(pairs);
    });

    test('should handle multiple entities', () => {
      const source = `entity a is
end entity;

entity b is
end entity;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle simple end without type', () => {
      const source = `process (clk)
begin
  q <= d;
end;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end');
    });

    test('should handle complex real-world VHDL code', () => {
      const source = `library ieee;
use ieee.std_logic_1164.all;

entity counter is
  port (
    clk   : in std_logic;
    reset : in std_logic;
    count : out std_logic_vector(7 downto 0)
  );
end entity;

architecture rtl of counter is
  signal cnt : unsigned(7 downto 0);
begin
  process (clk, reset)
  begin
    if reset = '1' then
      cnt <= (others => '0');
    elsif rising_edge(clk) then
      cnt <= cnt + 1;
    end if;
  end process;

  count <= std_logic_vector(cnt);
end architecture;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });

    test('should handle unterminated string', () => {
      const source = `signal msg : string := "unterminated
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle unterminated string at end of file', () => {
      // Tests lines 161-163: string reaching end of source
      const source = `signal msg : string := "unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unmatched end loop without for/while/loop opener', () => {
      // Tests findLastOpenerForLoop returning -1 (lines 401-402)
      // and fallback to last opener (lines 349-350)
      const source = `if condition then
  x <= 1;
end loop;`;
      const pairs = parser.parse(source);
      // end loop doesn't match if, but falls back to last opener
      assertSingleBlock(pairs, 'if', 'end loop');
    });

    test('should handle compound end with different type', () => {
      // Tests findLastOpenerByType returning -1 and fallback (lines 349-350, 390-391)
      const source = `if condition then
  x <= 1;
end process;`;
      const pairs = parser.parse(source);
      // end process doesn't match if, but fallback to last opener
      assertSingleBlock(pairs, 'if', 'end process');
    });

    test('should handle unterminated block comment', () => {
      const source = `/* unterminated comment
entity test is
end entity;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `if condition then
end if;`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `entity test is
  -- body
end entity;`;
      const pairs = parser.parse(source);
      const entityPair = findBlock(pairs, 'entity');
      assertTokenPosition(entityPair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `if condition then
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

    test('getExcludedRegions should return block comment', () => {
      const source = `/* block
comment */`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
    });
  });
});
