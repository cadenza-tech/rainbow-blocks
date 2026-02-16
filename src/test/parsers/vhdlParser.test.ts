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

    test('should handle attribute tick with keyword-like name', () => {
      // Attribute tick followed by a keyword-like name should be excluded
      const source = `signal x : integer := data'for;
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should handle attribute tick followed by block middle keyword', () => {
      const source = `signal x : boolean := val'is;
entity test is
end entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
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

    suite('Standalone loop', () => {
      test('should handle standalone loop after for loop', () => {
        const source = 'for I in 0 to 9 loop\n  loop\n    exit;\n  end loop;\nend loop;';
        const result = parser.parse(source);
        assert.strictEqual(result.length, 2);
      });

      test('should handle standalone loop after while loop', () => {
        const source = 'while running loop\n  loop\n    exit;\n  end loop;\nend loop;';
        const result = parser.parse(source);
        assert.strictEqual(result.length, 2);
      });
    });

    test('should handle unterminated block comment', () => {
      const source = `/* unterminated comment
entity test is
end entity;`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat entity after use on previous line as use entity', () => {
      // use on a different line should not prevent entity from being a block
      const pairs = parser.parse('library ieee;\nuse ieee.std_logic_1164.all;\n\nentity my_entity is\nend entity;');
      const entityPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'entity');
      assert.ok(entityPair, 'entity should be detected as block');
    });

    test('should not treat entity after use in comment as use entity', () => {
      const pairs = parser.parse('-- use\nentity my_entity is\nend entity;');
      const entityPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'entity');
      assert.ok(entityPair, 'entity after use-in-comment should be a block');
    });

    test('should detect wait for spanning two lines as not a block', () => {
      const pairs = parser.parse('wait\n  for 10 ns;');
      assertNoBlocks(pairs);
    });

    test('should not treat loop in end loop as standalone loop', () => {
      const source = `end loop;
for i in 0 to 7 loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should detect wait for with comment between wait and for', () => {
      const source = `process
begin
  wait -- timing
    for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should detect multi-line wait for with multiple blank lines as not a block', () => {
      const source = `process
begin
  wait

    for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should not treat entity after colon in component instantiation as block', () => {
      const source = `architecture rtl of test is
begin
  inst1: entity work.adder;
end architecture;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Wait for timing statement', () => {
    test('should not treat wait for as block open', () => {
      const source = `process
begin
  wait for 10 ns;
  x <= '1';
  wait for 20 ns;
  x <= '0';
end;`;
      const pairs = parser.parse(source);
      // Should have 1 block: process/end (not for/end)
      assertSingleBlock(pairs, 'process', 'end');
    });

    test('should not treat wait for as block open with compound end', () => {
      const source = `process
begin
  wait for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should still parse regular for loop', () => {
      const source = `for i in 0 to 7 loop
  x(i) <= '0';
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Function/procedure declarations', () => {
    test('should not treat function declaration as block open', () => {
      const pairs = parser.parse('package my_pkg is\n  function add(a, b : integer) return integer;\nend;');
      assertSingleBlock(pairs, 'package', 'end', 0);
    });

    test('should not treat procedure declaration as block open', () => {
      const pairs = parser.parse('package my_pkg is\n  procedure do_something(x : integer);\nend;');
      assertSingleBlock(pairs, 'package', 'end', 0);
    });

    test('should still parse function with body as block', () => {
      const pairs = parser.parse('function add(a, b : integer) return integer is\nbegin\n  return a + b;\nend;');
      assertSingleBlock(pairs, 'function', 'end', 0);
    });
  });

  suite('Use entity', () => {
    test('should not treat use entity as block open', () => {
      const pairs = parser.parse('configuration cfg of test is\n  use entity work.impl;\nend configuration;');
      assertSingleBlock(pairs, 'configuration', 'end configuration', 0);
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

  suite('Compound end with multiple spaces', () => {
    test('should handle compound end with multiple spaces', () => {
      const source = `entity test is
end  entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end  entity');
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

  suite('Conditional signal assignment when/else', () => {
    test('should not treat when/else in signal assignment as intermediates', () => {
      const source = `process (clk)
begin
  sig <= '1' when cond else '0';
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      assert.strictEqual(pairs[0].intermediates.filter((i) => i.value === 'when').length, 0, 'when should not be intermediate of process');
      assert.strictEqual(pairs[0].intermediates.filter((i) => i.value === 'else').length, 0, 'else should not be intermediate of process');
    });

    test('should have 0 intermediates for process with conditional signal assignment', () => {
      const source = `process (clk)
begin
  sig <= '1' when cond else '0';
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
      assert.strictEqual(nonBeginIntermediates.length, 0);
    });

    test('should not treat when/else in multi-line signal assignment as intermediates', () => {
      const source = `process (clk)
begin
  sig <= val1 when cond1
         else val2;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
      assert.strictEqual(nonBeginIntermediates.length, 0, 'when/else from multi-line signal assignment should not be intermediates');
    });

    test('should still treat when as intermediate in case block', () => {
      const source = `case x is
  when "00" =>
    y <= '1';
  when others =>
    y <= '0';
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      const whenIntermediates = pairs[0].intermediates.filter((i) => i.value === 'when');
      assert.ok(whenIntermediates.length >= 1, 'when should be intermediate of case');
    });
  });

  suite('Multi-line for...loop', () => {
    test('should handle multi-line for loop', () => {
      const source = `for i in 0 to 7
  loop
    x <= '1';
  end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle multi-line while loop', () => {
      const source = `while condition
  loop
    x <= '1';
  end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });

    test('should stop lookback at semicolon', () => {
      const source = `x <= '1';
loop
  y <= '0';
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should handle for across 3 lines before loop', () => {
      const source = `for i in
  0
  to 7 loop
    x <= '1';
  end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Coverage: use entity and function declaration', () => {
    test('should not treat use entity as entity block', () => {
      const pairs = parser.parse('use entity work.my_entity;\nprocess\nbegin\n  null;\nend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should not treat function declaration without body as block', () => {
      const pairs = parser.parse('function f(x : integer) return integer;\nprocess\nbegin\n  null;\nend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Signal assignment detection with excluded regions', () => {
    test('should not filter when after comment containing <=', () => {
      const source = `process
begin
  -- x <= y
  case state is
    when idle =>
      null;
  end case;
end process;`;
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assertIntermediates(casePair, ['is', 'when']);
    });

    test('should still filter when in real signal assignment', () => {
      const source = `process
begin
  sig <= value when condition else other;
end process;`;
      const pairs = parser.parse(source);
      // when and else should be filtered (signal assignment)
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Complex real-world scenario', () => {
    test('should handle generate + process + case with signal assignment', () => {
      const source = `architecture rtl of test is
begin
  gen: for i in 0 to 7 generate
    proc: process(clk)
    begin
      -- x <= y
      case state is
        when idle =>
          sig <= value when condition else other;
        when active =>
          null;
      end case;
    end process;
  end generate;
end architecture;`;
      const pairs = parser.parse(source);
      // for + generate both pair with 'end generate' (5 total)
      findBlock(pairs, 'for');
      findBlock(pairs, 'generate');
      findBlock(pairs, 'process');
      findBlock(pairs, 'case');
      findBlock(pairs, 'architecture');
      assertBlockCount(pairs, 5);
    });
  });

  suite('v7 bug fixes', () => {
    test('should not treat <= in preceding signal assignment as affecting later block', () => {
      const source = `process is
begin
  sig <= value;
  if a = b then
    null;
  end if;
end process;`;
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair);
      assert.strictEqual(ifPair.intermediates.length, 1);
      assert.strictEqual(ifPair.intermediates[0].value.toLowerCase(), 'then');
    });

    test('should stop isInSignalAssignment at block boundary keyword then', () => {
      const source = `process is
begin
  sig <= '1';
  if ready then
    sig <= '0';
  else
    null;
  end if;
end process;`;
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair);
      assert.ok(ifPair.intermediates.some((i) => i.value.toLowerCase() === 'else'));
    });

    test('should ignore for/while in comments when validating loop', () => {
      const source = `architecture test of test is
begin
  -- for testing purposes
  loop
    null;
  end loop;
end architecture;`;
      const pairs = parser.parse(source);
      findBlock(pairs, 'loop');
    });

    test('should treat loop after for in comment as standalone', () => {
      const source = `process is
begin
  -- while waiting
  loop
    exit when done;
  end loop;
end process;`;
      const pairs = parser.parse(source);
      findBlock(pairs, 'loop');
    });
  });

  suite('CRLF handling for wait for', () => {
    test('should detect wait for with CRLF line endings', () => {
      const pairs = parser.parse('process\r\nbegin\r\n  wait for 10 ns;\r\nend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should detect multi-line wait for with CRLF', () => {
      const pairs = parser.parse('process\r\nbegin\r\n  wait\r\n    for 10 ns;\r\nend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Wait for with wait in excluded region', () => {
    test('should not falsely detect wait in string as wait for', () => {
      const source = `process
begin
  msg := "wait";
  for i in 0 to 7 loop
    null;
  end loop;
end process;`;
      const pairs = parser.parse(source);
      findBlock(pairs, 'for');
    });

    test('should not falsely detect wait in comment as wait for', () => {
      const source = `process
begin
  -- wait
  for i in 0 to 7 loop
    null;
  end loop;
end process;`;
      const pairs = parser.parse(source);
      findBlock(pairs, 'for');
    });

    test('should still detect real wait for correctly', () => {
      const source = `process
begin
  wait for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('matchVhdlString CR-only line endings', () => {
    test('should terminate string at CR-only line ending', () => {
      const source = 'signal msg : string := "if then end if\r\nif condition then\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should not leak string across CR-only line boundary', () => {
      const source = 'signal s : string := "entity\rif a then\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Chained conditional signal assignment', () => {
    test('should not treat when/else in chained signal assignment as intermediates', () => {
      const source = `process (clk)
begin
  sig <= a when c1 else b when c2 else c;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
      assert.strictEqual(nonBeginIntermediates.length, 0, 'when/else from chained signal assignment should not be intermediates');
    });

    test('should not treat when/else in multi-line chained signal assignment as intermediates', () => {
      const source = `process (clk)
begin
  sig <= a when c1
         else b when c2
         else c;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
      assert.strictEqual(nonBeginIntermediates.length, 0, 'when/else from multi-line chained signal assignment should not be intermediates');
    });

    test('should still treat else as intermediate in if block (then acts as boundary)', () => {
      const source = `process is
begin
  sig <= '1';
  if ready then
    sig <= '0';
  else
    null;
  end if;
end process;`;
      const pairs = parser.parse(source);
      const ifPair = findBlock(pairs, 'if');
      assert.ok(ifPair);
      assert.ok(
        ifPair.intermediates.some((i) => i.value.toLowerCase() === 'else'),
        'else should still be intermediate of if block'
      );
    });
  });

  suite('VHDL-2008 case generate and end for', () => {
    test('should handle end for in configuration', () => {
      const source = 'configuration cfg of ent is\n  for label : comp\n    use entity work.impl;\n  end for;\nend configuration;';
      const result = parser.parse(source);
      // configuration block should be matched, and for block inside it
      assert.ok(result.length >= 1);
      // Make sure 'for' in 'end for' is not a stray token
      const forBlocks = result.filter((b) => b.openKeyword.value.toLowerCase() === 'for');
      assert.strictEqual(forBlocks.length, 1, 'Should have exactly one for block');
    });

    test('should handle case generate (VHDL-2008)', () => {
      const source = 'label: case expr generate\n  when choice =>\n    signal_assign;\nend generate label;';
      const result = parser.parse(source);
      assert.ok(result.length >= 1);
      // case should be consumed as generate prefix, not as standalone block
      const generateBlocks = result.filter((b) => b.openKeyword.value.toLowerCase() === 'generate');
      assert.ok(generateBlocks.length >= 1, 'Should have generate block');
    });
  });

  suite('stripTrailingComment position with indentation', () => {
    test('should handle indented wait for with trailing comment', () => {
      const source = `process
begin
    wait -- some comment
    for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should handle deeply indented wait for with comment', () => {
      const source = `process
begin
        wait   -- timing wait
        for 5 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should not treat indented for-loop with comment as wait for', () => {
      const source = `process
begin
    for i in 0 to 7 loop -- iterate
      null;
    end loop;
end process;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  // Covers lines 120-122: function/procedure validation with excluded regions in parens
  suite('Function/procedure with comments in parameters', () => {
    test('should handle function with comment in parameter list', () => {
      const source = `function calc(
  a : integer; -- first param
  b : integer  -- second param
) return integer is
begin
  return a + b;
end function;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'end function');
    });

    test('should handle procedure with string in parameter list', () => {
      const source = `procedure print(
  msg : string := "default;"
) is
begin
  report msg;
end procedure;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'procedure', 'end procedure');
    });
  });

  // Covers lines 138-139: function/procedure reaching EOF without is or semicolon
  suite('Function/procedure at EOF', () => {
    test('should not treat incomplete function at EOF as block', () => {
      const source = 'function calc(a : integer)';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat incomplete procedure at EOF as block', () => {
      const source = 'procedure test(x : integer';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Covers lines 173-174, 178-179: loop validation with excluded regions and end loop check
  suite('Loop validation with comments and end loop', () => {
    test('should handle for-loop with comment containing loop keyword', () => {
      const source = `for i in 0 to 7 -- this is a loop
loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should recognize standalone loop when for-loop on same line', () => {
      const source = `for i in 0 to 7 loop null; end loop;
loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'loop');
    });

    test('should handle loop after end loop on same line', () => {
      const source = `for i in 0 to 7 loop end loop; loop
  wait;
end loop;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  // Covers lines 453-454: isInSignalAssignment reaching start of file
  suite('Signal assignment at start of file', () => {
    test('should detect when/else in signal assignment at file start', () => {
      const source = 'sig <= a when cond else b;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat when at start as signal assignment if no <=', () => {
      const source = `case x is
  when 0 =>
    null;
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
    });
  });
});
