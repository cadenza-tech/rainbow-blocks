import * as assert from 'node:assert';
import { VhdlBlockParser } from '../../parsers/vhdlParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('VhdlBlockParser Test Suite', () => {
  let parser: VhdlBlockParser;

  setup(() => {
    parser = new VhdlBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'signal a : std_logic;',
    tokenSource: 'if condition then\nend if;',
    expectedTokenValues: ['if', 'then', 'end if'],
    excludedSource: '-- comment\n"string"',
    expectedRegionCount: 2,
    twoLineSource: 'if condition then\nend if;',
    nestedPositionSource: 'entity test is\n  -- body\nend entity;',
    nestedKeyword: 'entity',
    nestedLine: 0,
    nestedColumn: 0,
    singleLineCommentSource: '-- if then end if entity\nif condition then\nend if;',
    commentBlockOpen: 'if',
    commentBlockClose: 'end if',
    doubleQuotedStringSource: 'signal msg : string := "if then end if";\nif condition then\nend if;',
    stringBlockOpen: 'if',
    stringBlockClose: 'end if'
  };

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
    generateExcludedRegionTests(config);

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

    test("should handle '''' (character literal containing single quote)", () => {
      const source = `signal c : character := '''';
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test("should handle '''' as single excluded region", () => {
      const source = "x <= '''';";
      const regions = parser.getExcludedRegions(source);
      // The '''' should be one excluded region, not two
      const quoteRegion = regions.find((r) => r.start === 5);
      assert.ok(quoteRegion);
      assert.strictEqual(quoteRegion.end, 9, "'''' should be a single region of length 4");
    });

    test("should handle '''' followed by another character literal", () => {
      const source = `signal a : character := '''';
signal b : character := 'x';
if condition then
end if;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test("should not confuse '''' with regular character literal", () => {
      const source = "'a' '''' 'b'";
      const regions = parser.getExcludedRegions(source);
      // 'a' at 0..3, '''' at 4..8, 'b' at 9..12
      assert.strictEqual(regions.length, 3);
      assert.strictEqual(regions[0].end - regions[0].start, 3);
      assert.strictEqual(regions[1].end - regions[1].start, 4);
      assert.strictEqual(regions[2].end - regions[2].start, 3);
    });

    test('should handle surrogate pair in character literal', () => {
      const regions = parser.getExcludedRegions("'\u{1F600}'");
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, 4);
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
    generateEdgeCaseTests(config);

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

    test('should not detect keywords adjacent to Unicode letters', () => {
      const source = 'variable caf\u00E9entity : integer;\nentity test is\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
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

      test('should handle standalone loop inside for-generate block', () => {
        // Bug: for-generate's 'for' was incorrectly treated as a loop prefix
        const source = `gen: for i in 0 to 3 generate
  loop
    wait until clk = '1';
    exit;
  end loop;
end generate;`;
        const pairs = parser.parse(source);
        const loopPair = findBlock(pairs, 'loop');
        assert.ok(loopPair, 'standalone loop should be recognized');
        assert.strictEqual(loopPair.closeKeyword.value.toLowerCase(), 'end loop');
      });

      test('should handle standalone loop inside while-generate block', () => {
        const source = `gen: while condition generate
  loop
    null;
  end loop;
end generate;`;
        const pairs = parser.parse(source);
        const loopPair = findBlock(pairs, 'loop');
        assert.ok(loopPair, 'standalone loop should be recognized inside while-generate');
        assert.strictEqual(loopPair.closeKeyword.value.toLowerCase(), 'end loop');
      });

      test('should still reject loop after for-loop (not for-generate)', () => {
        // for-loop: 'for ... loop' should still make the 'for' the opener
        const source = `for i in 0 to 7 loop
  null;
end loop;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'end loop');
      });

      test('should handle standalone loop on next line inside for-generate', () => {
        // Multi-line case: generate on previous line, loop on next
        const source = `gen: for i in 0 to 3 generate
  process begin
    loop
      null;
    end loop;
  end process;
end generate;`;
        const pairs = parser.parse(source);
        const loopPair = findBlock(pairs, 'loop');
        assert.ok(loopPair, 'standalone loop should be recognized inside for-generate');
      });

      test('should not confuse generate in comment with real generate', () => {
        // If 'generate' is in a comment, for/while is still a loop prefix
        const source = `for i in 0 to 7 -- generate
loop
  null;
end loop;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'for', 'end loop');
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

    test('should recognize end postponed process as compound end keyword', () => {
      const pairs = parser.parse('postponed process\nbegin\n  null;\nend postponed process;');
      const processPair = findBlock(pairs, 'process');
      assert.ok(processPair, 'process should be paired');
      assert.strictEqual(processPair.closeKeyword.value.toLowerCase(), 'end postponed process');
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
      assertSingleBlock(pairs, 'package', 'end');
    });

    test('should not treat procedure declaration as block open', () => {
      const pairs = parser.parse('package my_pkg is\n  procedure do_something(x : integer);\nend;');
      assertSingleBlock(pairs, 'package', 'end');
    });

    test('should still parse function with body as block', () => {
      const pairs = parser.parse('function add(a, b : integer) return integer is\nbegin\n  return a + b;\nend;');
      assertSingleBlock(pairs, 'function', 'end');
    });
  });

  suite('Use entity', () => {
    test('should not treat use entity as block open', () => {
      const pairs = parser.parse('configuration cfg of test is\n  use entity work.impl;\nend configuration;');
      assertSingleBlock(pairs, 'configuration', 'end configuration');
    });
  });

  suite('Branch coverage', () => {
    test('should reject loop preceded by dot as record field access', () => {
      // Covers lines 247-248: record.loop treated as field access, not block open
      const source = 'process is\nbegin\n  x := record_var.loop;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should reject loop preceded by dot with spaces', () => {
      // Covers lines 243-248: dot with whitespace before loop (record . loop)
      const source = 'process is\nbegin\n  x := rec . loop;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Test helper methods - VHDL specific', () => {
    test('getExcludedRegions should return block comment', () => {
      const source = `/* block
comment */`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
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

  suite('Signal assignment and loop validation', () => {
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

  suite('Regression: exit when and next when in case blocks', () => {
    test('should not treat when in exit when as case intermediate', () => {
      const source = `case state is
  when idle =>
    null;
  when active =>
    exit when done;
  when others =>
    null;
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      const casePair = findBlock(pairs, 'case');
      const whenCount = casePair.intermediates.filter((i) => i.value.toLowerCase() === 'when').length;
      assert.strictEqual(whenCount, 3);
    });

    test('should not treat when in next when as case intermediate', () => {
      const source = `case mode is
  when running =>
    next when flag;
  when stopped =>
    null;
end case;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      const casePair = findBlock(pairs, 'case');
      const whenCount = casePair.intermediates.filter((i) => i.value.toLowerCase() === 'when').length;
      assert.strictEqual(whenCount, 2);
    });

    test('should still treat normal when as case intermediate', () => {
      const source = `case sel is
  when "00" => a <= '0';
  when "01" => a <= '1';
  when others => a <= 'X';
end case;`;
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      const whenCount = casePair.intermediates.filter((i) => i.value.toLowerCase() === 'when').length;
      assert.strictEqual(whenCount, 3);
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

  suite('CR-only line endings for wait for, loop, and entity', () => {
    test('should detect wait for with CR-only line endings', () => {
      const pairs = parser.parse('process\rbegin\r  wait for 10 ns;\rend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should detect multi-line wait for with CR-only', () => {
      const pairs = parser.parse('process\rbegin\r  wait\r    for 10 ns;\rend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should handle standalone loop with CR-only line endings', () => {
      const pairs = parser.parse('process\rbegin\r  loop\r    null;\r  end loop;\rend process;');
      assert.strictEqual(pairs.length, 2);
      findBlock(pairs, 'loop');
    });

    test('should handle for-loop with CR-only line endings', () => {
      const pairs = parser.parse('process\rbegin\r  for i in 0 to 10\r  loop\r    null;\r  end loop;\rend process;');
      assert.strictEqual(pairs.length, 2);
      findBlock(pairs, 'for');
    });

    test('should detect use entity with CR-only line endings', () => {
      const pairs = parser.parse('architecture rtl of top is\rbegin\r  u1: entity work.comp\r    port map (a => b);\rend architecture;');
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should detect entity instantiation with colon on previous line (CRLF)', () => {
      const pairs = parser.parse(
        'architecture rtl of test is\r\nbegin\r\n  inst1 :\r\n  entity work.adder\r\n    port map (a => b);\r\nend architecture;'
      );
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should detect entity instantiation with colon on previous line (CR-only)', () => {
      const pairs = parser.parse('architecture rtl of test is\rbegin\r  inst1 :\r  entity work.adder\r    port map (a => b);\rend architecture;');
      assertSingleBlock(pairs, 'architecture', 'end architecture');
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

  // Covers lines 93-94: CRLF in blank-line skip during multi-line wait for
  suite('CRLF wait for blank line', () => {
    test('should treat wait for as timing statement with CRLF blank line', () => {
      const source = 'process\r\nbegin\r\n  wait\r\n\r\n    for 10 ns;\r\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  // Covers CRLF in loop line offset calculation
  suite('CRLF loop validation', () => {
    test('should handle for loop across CRLF blank lines before loop', () => {
      const source = 'for i in 0 to 10\r\n\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle for loop with CRLF and comment near boundary', () => {
      const source = 'for i in 0 to 10 -- "range"\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should handle standalone loop with CRLF after semicolon', () => {
      const source = 'null;\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should handle while loop with multiple CRLF lines', () => {
      const source = 'while condition\r\n\r\n\r\nloop\r\n  null;\r\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });
  });

  // Covers lines 190-192: end loop before for on same line skips end loop match
  suite('End loop before for on same line', () => {
    test('should skip end loop when checking for loop pairing on same line', () => {
      const source = 'end loop; for i in 0 to 10 loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  // Covers lines 466-467: isInSignalAssignment backward scan reaches start of source
  suite('Signal assignment exhausted scan', () => {
    test('should not treat when as signal assignment when scan reaches source start', () => {
      const source = 'when others => null';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  // Fix: when keywords inside case-generate constructs
  suite('Case-generate when intermediates', () => {
    test('should attach when as intermediate in case-generate', () => {
      const source =
        "case_gen: case SOME_GENERIC generate\n  when \"00\" =>\n    sig1 <= '1';\n  when others =>\n    sig1 <= '0';\nend generate case_gen;";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const caseBlock = findBlock(pairs, 'case');
      assertIntermediates(caseBlock, ['when', 'when']);
    });

    test('should still attach when as intermediate in plain case', () => {
      const source = "case sel is\n  when \"00\" =>\n    sig1 <= '1';\n  when others =>\n    sig1 <= '0';\nend case;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      assertIntermediates(pairs[0], ['is', 'when', 'when']);
    });
  });

  suite('Bug fixes', () => {
    test('Bug 13: use configuration should not create false block opener', () => {
      const source = `configuration cfg of test is
  for all : counter
    use configuration work.counter_cfg;
  end for;
end configuration;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 19: extended identifiers should be treated as excluded regions', () => {
      const source = `signal \\entity\\ : std_logic;
entity test is
end entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('Bug 20: else should not be filtered as signal assignment with missing semicolon', () => {
      const source = `if cond then
  sig <= val
else
  null;
end if;`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('Bug 21: library path keywords should not be falsely detected', () => {
      const source = `use entity work.process;
process
begin
  null;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('Bug 3: wait on/until with for should not create block', () => {
      const pairs = parser.parse('process begin\n  wait on sig\n  for 10 ns;\nend process;');
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('Bug 13: entity instantiation with colon on previous line', () => {
      const pairs = parser.parse('architecture rtl of test is\nbegin\n  inst1 :\n  entity work.adder\n    port map (a => b);\nend architecture;');
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    suite('Bug 6: elsif/else generate chain', () => {
      test('should handle if-elsif generate chain', () => {
        const source = `gen1: if condition1 generate
  signal s1 : std_logic;
elsif condition2 generate
  signal s2 : std_logic;
end generate gen1;`;
        const pairs = parser.parse(source);
        // Should produce block pairs for the generate chain
        assert.ok(pairs.length >= 1, 'Should have at least one block pair');
        const generateBlocks = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'generate');
        assert.ok(generateBlocks.length >= 1, 'Should have generate block(s)');
        // elsif should appear as intermediate or separate block
        const allKeywords = pairs.flatMap((p) => [
          p.openKeyword.value.toLowerCase(),
          ...p.intermediates.map((i) => i.value.toLowerCase()),
          p.closeKeyword.value.toLowerCase()
        ]);
        assert.ok(
          allKeywords.some((k) => k === 'elsif'),
          'elsif should be present in block structure'
        );
      });

      test('should handle if-elsif-else generate chain', () => {
        const source = `gen1: if condition1 generate
  signal s1 : std_logic;
elsif condition2 generate
  signal s2 : std_logic;
else generate
  signal s3 : std_logic;
end generate gen1;`;
        const pairs = parser.parse(source);
        assert.ok(pairs.length >= 1, 'Should have at least one block pair');
        const allKeywords = pairs.flatMap((p) => [
          p.openKeyword.value.toLowerCase(),
          ...p.intermediates.map((i) => i.value.toLowerCase()),
          p.closeKeyword.value.toLowerCase()
        ]);
        assert.ok(
          allKeywords.some((k) => k === 'elsif'),
          'elsif should be present'
        );
        assert.ok(
          allKeywords.some((k) => k === 'else'),
          'else should be present'
        );
      });

      test('should handle nested generate with inner elsif chain', () => {
        const source = `gen_outer: for i in 0 to 7 generate
  gen_inner: if i = 0 generate
    signal s1 : std_logic;
  elsif i = 7 generate
    signal s2 : std_logic;
  end generate gen_inner;
end generate gen_outer;`;
        const pairs = parser.parse(source);
        // Should have outer for + outer generate + inner generate chain blocks
        assert.ok(pairs.length >= 3, 'Should have at least 3 block pairs for nested generate');
        // Inner end generate should not close outer generate
        const forBlock = findBlock(pairs, 'for');
        assert.ok(forBlock, 'for block should exist');
        assert.strictEqual(forBlock.closeKeyword.value.toLowerCase(), 'end generate', 'Outer for should close with end generate');
      });
    });

    suite('Bug 7: variable assignment/return conditional else', () => {
      test('should not treat else in variable assignment conditional as intermediate', () => {
        const source = `process (clk)
begin
  x := a when sel = '1' else b;
end process;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'process', 'end process');
        const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
        assert.strictEqual(nonBeginIntermediates.length, 0, 'else after when in variable assignment should not be intermediate');
      });

      test('should not treat else in return conditional as intermediate', () => {
        const source = `function max(a, b : integer) return integer is
begin
  return a when a > b else b;
end function;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'function', 'end function');
        const elseIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'else');
        assert.strictEqual(elseIntermediates.length, 0, 'else after when in return conditional should not be intermediate');
      });
    });

    suite('Bug 8: port/generic map conditional else as false intermediate', () => {
      test('should not treat else in port map conditional expression as intermediate', () => {
        const source = `entity test is
  port (clk : in std_logic);
end entity;
architecture rtl of test is
begin
  inst: entity work.comp
    port map (
      a => sig1 when sel = '1' else sig2
    );
end architecture;`;
        const pairs = parser.parse(source);
        assertBlockCount(pairs, 2);
        const archBlock = findBlock(pairs, 'architecture');
        assert.ok(archBlock);
        const elseIntermediates = archBlock.intermediates.filter((i) => i.value.toLowerCase() === 'else');
        assert.strictEqual(elseIntermediates.length, 0, 'else after => conditional should not be intermediate');
      });

      test('should not treat when in generic map conditional expression as intermediate', () => {
        const source = `architecture rtl of test is
begin
  inst: entity work.comp
    generic map (
      G => 1 when DEBUG else 0
    )
    port map (
      a => b
    );
end architecture;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'architecture', 'end architecture');
        const elseIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'else');
        assert.strictEqual(elseIntermediates.length, 0, 'else after => conditional in generic map should not be intermediate');
      });

      test('should still treat when as case intermediate not affected by =>', () => {
        const source = `case sel is
  when "00" =>
    null;
  when others =>
    null;
end case;`;
        const pairs = parser.parse(source);
        assertSingleBlock(pairs, 'case', 'end case');
        assertIntermediates(pairs[0], ['is', 'when', 'when']);
      });
    });
  });

  suite('Coverage: extended identifier edge cases', () => {
    test('should handle unterminated extended identifier at EOF', () => {
      // Line 95 / Lines 316-317: return { start: pos, end: source.length }
      const source = 'signal \\myident';
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 7);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should handle unterminated extended identifier without closing backslash', () => {
      const source = 'signal \\myident\nif condition then\nend if;';
      const regions = parser.getExcludedRegions(source);
      // Extended identifier cannot span lines, so it ends at newline
      assert.ok(regions.length >= 1);
      const extIdRegion = regions.find((r) => r.start === 7);
      assert.ok(extIdRegion);
      // Should end at newline (line 311-312)
      assert.ok(extIdRegion.end <= source.indexOf('\n') + 1);
    });

    test('should handle doubled backslash inside extended identifier', () => {
      // Lines 304-307: source[i + 1] === '\\' -> i += 2
      const source = 'signal \\my\\\\id\\ : std_logic;\nif condition then\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });

    test('should exclude extended identifier containing keywords', () => {
      const source = 'signal \\entity\\ : std_logic;\nentity test is\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should handle extended identifier with only doubled backslash content', () => {
      const source = 'signal \\\\\\\\\\ : std_logic;\nif a then\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
    });
  });

  suite('Dot-prefixed loop validation', () => {
    test('should not treat record.loop as block start', () => {
      const source = 'record.loop';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should not treat record . loop (with spaces) as block start', () => {
      const source = 'record . loop';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still recognize standalone loop ... end loop', () => {
      const source = `loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should handle early break in blank line scanning near start of file', () => {
      // Covers line 95: prevNl <= 0 break in blank-line scanning for wait...for
      const source = `for i in 0 to 3 loop
  wait;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should not break wait for when semicolon is inside excluded region', () => {
      // Covers lines 269-274: semicolon in wait for expression inside excluded region
      const source = `process
begin
  wait ";" for 10 ns;
end process;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should handle qualified expression tick-paren as attribute tick', () => {
      // Covers lines 388-390: type'( qualified expression detection
      const source = `entity t is
begin
  x <= std_logic_vector'('0');
end entity;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should reject loop preceded by dot (isValidLoopOpen line 230-231)', () => {
      // isValidLoopOpen: loop preceded by a dot (hierarchical reference)
      const source = 'architecture rtl of test is\nbegin\n  inst.loop\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should accept for loop when wait followed by semicolon precedes it (line 344-345)', () => {
      // isValidLoopOpen: wait; for ... - wait is complete (has semicolon), for is real loop
      const source = 'process is\nbegin\n  wait; for i in 0 to 3 loop\n    null;\n  end loop;\nend process;';
      const pairs = parser.parse(source);
      // for/end loop pair exists; process/end process pair also
      const loopPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(loopPair, 'should find for loop block');
    });

    test('should handle use entity with CRLF blank lines in backward scan (line 160-161)', () => {
      // isValidEntityOpen backward scan: blank line with CRLF (\r\n) causes scanEnd--
      // entity preceded by blank line with CRLF
      const source = 'use work.pkg.all;\r\n\r\nentity test is\nend entity test;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });
  });

  suite('Bug 16: COMPOUND_END_PATTERN newline handling', () => {
    test('should not match end followed by newline then type keyword as compound end', () => {
      const source = 'process\nbegin\n  null;\nend\n  process;';
      const pairs = parser.parse(source);
      // end on separate line closes process as simple end; second process is unmatched opener
      assertSingleBlock(pairs, 'process', 'end');
    });
  });

  suite('Bug 17: isInSignalAssignment missing end boundary', () => {
    test('should not treat else after end process as signal assignment else', () => {
      const source = 'process\nbegin\nend process;\nif cond then\n  null;\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'should find if block');
      // else should be an intermediate of if block, not consumed by signal assignment detection
      // (then is also an intermediate)
      assertIntermediates(ifPair, ['then', 'else']);
    });
  });

  suite('Bug 18: isInSignalAssignment <= comparison in conditional expression', () => {
    test('should filter else in signal assignment with <= comparison', () => {
      const source = "architecture rtl of test is\nbegin\n  sig <= '1' when x <= 5 else '0';\nend architecture;";
      const pairs = parser.parse(source);
      const archPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'architecture');
      assert.ok(archPair, 'should find architecture block');
      // else should be filtered (part of conditional signal assignment), not an intermediate
      assertIntermediates(archPair, ['is', 'begin']);
    });

    test('should filter else in variable assignment with <= comparison', () => {
      const source = 'process(clk)\nbegin\n  x := a when c1 <= 5 else b;\nend process;';
      const pairs = parser.parse(source);
      const procPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'process');
      assert.ok(procPair, 'should find process block');
      assertIntermediates(procPair, ['begin']);
    });

    test('should filter else with multiple <= comparisons in chain', () => {
      const source = 'architecture rtl of test is\nbegin\n  sig <= a when x <= 3 else b when y <= 7 else c;\nend architecture;';
      const pairs = parser.parse(source);
      const archPair = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'architecture');
      assert.ok(archPair, 'should find architecture block');
      assertIntermediates(archPair, ['is', 'begin']);
    });

    test('should still recognize else as intermediate in if block', () => {
      const source = 'if cond then\n  null;\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });
  });

  suite('Bug: use on separate line from entity/configuration', () => {
    test('should reject entity when use is on previous line', () => {
      const source = 'use\n  entity work.comp;\nentity real_entity is\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
      assert.strictEqual(pairs[0].openKeyword.startOffset, source.indexOf('entity real_entity'));
    });

    test('should reject configuration when use is on previous line', () => {
      const source = 'use\n  configuration work.cfg;\nconfiguration my_cfg of my_ent is\nend configuration;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'configuration', 'end configuration');
      assert.strictEqual(pairs[0].openKeyword.startOffset, source.indexOf('configuration my_cfg'));
    });
  });

  suite('Bug: spaced dot in hierarchical reference', () => {
    test('should reject process after spaced dot', () => {
      const source = 'architecture rtl of test is\nbegin\n  inst . process\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should reject block after spaced dot', () => {
      const source = 'architecture rtl of test is\nbegin\n  inst . block\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should still accept process not preceded by dot', () => {
      const source = 'process is\nbegin\n  null;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Regression: standalone loop after wait for timing statement', () => {
    test('should recognize standalone loop after wait for on same line', () => {
      const source = 'wait for 10 ns;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should recognize standalone loop after multi-line wait for', () => {
      const source = 'wait\n  for 10 ns;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should recognize standalone loop after wait for with no indent', () => {
      const source = 'wait\nfor 10 ns;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'loop', 'end loop');
    });

    test('should still recognize real for loop after wait for', () => {
      const source = 'wait for 10 ns;\nfor i in 0 to 3 loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should recognize for loop after completed wait statement', () => {
      const source = 'wait;\nfor i in 0 to 3 loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Coverage: loop preceded by dot', () => {
    test('should not treat loop preceded by dot as block opener', () => {
      // Covers lines 230-231: dot check in isValidLoopOpen
      const source = 'x := record_var.loop;\nif true then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });

    test('should not treat loop preceded by dot with spaces as block opener', () => {
      // Covers lines 230-231: dot check with whitespace between dot and loop
      const source = 'x := record_var . loop;\nif true then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then']);
    });
  });

  suite('Regression: isWaitBeforeFor with multiple wait statements on same line', () => {
    test('should not treat for as loop when preceded by terminated wait then unterminated wait', () => {
      const source = "process is\nbegin\n  wait until clk = '1'; wait for 10 ns;\nend process;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should still detect for as loop when wait is fully terminated', () => {
      const source = "process is\nbegin\n  wait until clk = '1';\n  for i in 0 to 3 loop\n    null;\n  end loop;\nend process;";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: compound end cross-line matching', () => {
    test('should not match end on one line with keyword on next line as compound end', () => {
      const source = 'process is\nbegin\n  null;\nend\nif rising_edge(clk) then\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifBlock = findBlock(pairs, 'if');
      assert.ok(ifBlock, 'if block should exist');
    });

    test('should still match compound end on same line', () => {
      const source = 'process is\nbegin\n  null;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should treat end without type on separate line as simple end', () => {
      const source =
        'architecture rtl of test is\nbegin\n  process is\n  begin\n    null;\n  end\n  if cond generate\n    null;\n  end generate;\nend architecture;';
      const pairs = parser.parse(source);
      // process+end, if+end generate, generate+end generate, architecture+end architecture
      assertBlockCount(pairs, 4);
      const ifBlock = findBlock(pairs, 'if');
      assert.ok(ifBlock, 'if block should not be consumed by end on previous line');
    });
  });

  suite('Regression: entity colon check with comment ending in colon', () => {
    test('should recognize entity when previous line comment ends with colon', () => {
      const source = 'signal my_sig : std_logic; -- init:\nentity my_entity is\n  port(a: in std_logic);\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should recognize entity when same-line comment ends with colon', () => {
      const source = '-- config:\nentity my_entity is\n  port(a: in std_logic);\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should still reject entity after actual colon (direct instantiation)', () => {
      const source = 'label:\nentity work.my_ent;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: multi-line for...generate loop detection', () => {
    test('should treat loop as standalone when generate is on next line after for', () => {
      // Bug: isValidLoopOpen only checked the same line as for/while for 'generate'.
      // Multi-line for...generate failed - for was treated as a loop prefix instead of
      // a generate prefix, causing the standalone loop inside to be rejected.
      const source = `gen: for i in 0 to 3
  generate
    loop
      null;
    end loop;
  end generate;`;
      const pairs = parser.parse(source);
      const loopPair = findBlock(pairs, 'loop');
      assert.ok(loopPair, 'standalone loop should be recognized inside multi-line for...generate');
      assert.strictEqual(loopPair.closeKeyword.value.toLowerCase(), 'end loop');
    });

    test('should treat loop as standalone when generate is on next line after while', () => {
      // Same bug: while...generate split across lines.
      const source = `gen: while condition
  generate
    loop
      null;
    end loop;
  end generate;`;
      const pairs = parser.parse(source);
      const loopPair = findBlock(pairs, 'loop');
      assert.ok(loopPair, 'standalone loop should be recognized inside multi-line while...generate');
      assert.strictEqual(loopPair.closeKeyword.value.toLowerCase(), 'end loop');
    });

    test('should treat loop as standalone when generate is separated by multiple lines from for', () => {
      const source = `gen: for i in 0 to 3
  -- comment before generate
  generate
    loop
      null;
    end loop;
  end generate;`;
      const pairs = parser.parse(source);
      const loopPair = findBlock(pairs, 'loop');
      assert.ok(loopPair, 'standalone loop should be recognized when generate is separated by comment from for');
    });

    test('should still treat loop as part of for-loop when loop is on next line (no generate)', () => {
      // Ensure the fix does not break the existing multi-line for...loop case.
      const source = `for i in 0 to 3
loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should not confuse generate in comment between for and loop as real generate', () => {
      // If 'generate' only appears in a comment, for/while is still a loop prefix.
      const source = `for i in 0 to 3 -- generate
loop
  null;
end loop;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should reject entity after use with trailing comment on same line', () => {
      // use followed by comment should still be recognized as direct instantiation
      const source = 'use -- using entity\n  entity work.my_entity\n    port map (a => b);';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should reject entity after use with trailing comment on previous line', () => {
      // Multi-line use with comment should still reject entity as block opener
      const source = 'use -- comment\n  entity work.my_entity\n    port map (a => b);';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still detect entity as block opener without use prefix', () => {
      const source = 'entity my_entity is\n  port (a : in std_logic);\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });
  });

  suite('Regression: CRLF colon detection on previous line for entity', () => {
    test('should reject entity as block opener when colon is on previous CRLF line', () => {
      const source = 'my_inst:\r\n  entity work.my_entity';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still reject entity when colon is on same line', () => {
      const source = 'my_inst: entity work.my_entity';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: multiple for loops on same line', () => {
    test('should handle multiple for loops on the same line', () => {
      const pairs = parser.parse('for a in 0 to 3 loop null; end loop; for b in 0 to 7\nloop\n  null;\nend loop;');
      assertBlockCount(pairs, 2);
    });

    test('should handle multiple while loops on the same line', () => {
      const pairs = parser.parse('while a loop null; end loop; while b\nloop\n  null;\nend loop;');
      assertBlockCount(pairs, 2);
    });

    test('should handle for and while loops on the same line', () => {
      const pairs = parser.parse('for a in 0 to 3 loop null; end loop; while b\nloop\n  null;\nend loop;');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Branch coverage: character literal at end of source', () => {
    test('should handle single quote at end of source', () => {
      // Covers vhdlHelpers.ts line 48: pos + 1 >= source.length
      const source = "signal x : std_logic := '";
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.some((r) => r.end - r.start === 1));
    });
  });

  suite('Coverage: isValidBlockClose dot-preceded end', () => {
    test('should reject end preceded by dot as hierarchical reference', () => {
      // Covers vhdlParser.ts lines 114-115: isValidBlockClose returns false
      // when end is preceded by '.'
      const source = 'entity test is\n  signal x : integer := inst.end;\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });

    test('should reject end preceded by dot with spaces', () => {
      // Covers vhdlParser.ts lines 110-114: dot with whitespace before end
      const source = 'entity test is\n  signal x : integer := inst . end;\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });
  });

  suite('Coverage: tokenize isValidBlockClose rejection', () => {
    test('should skip close keyword rejected by isValidBlockClose in tokenize', () => {
      // Covers vhdlParser.ts lines 218-219: tokenize skips block_close
      // when isValidBlockClose returns false
      const source = 'architecture rtl of test is\nbegin\n  signal x : integer := inst.end;\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Coverage: isValidLoopOpen dot-preceded loop', () => {
    test('should reject loop preceded by dot in isValidLoopOpen', () => {
      // Covers vhdlValidation.ts lines 174-175: isValidLoopOpen returns false
      // when loop is preceded by '.'
      const source = 'architecture rtl of test is\nbegin\n  x := rec.loop;\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Coverage: loop prefix preceded by dot', () => {
    test('should reject for preceded by dot when validating loop', () => {
      // Covers vhdlValidation.ts lines 214-215: prefix keyword preceded by '.'
      // is skipped as hierarchical reference
      const source = 'architecture rtl of test is\nbegin\n  inst.for loop\n    null;\n  end loop;\nend architecture;';
      const pairs = parser.parse(source);
      // inst.for is rejected as prefix, so loop should be standalone
      findBlock(pairs, 'loop');
    });

    test('should reject while preceded by dot when validating loop', () => {
      // Covers vhdlValidation.ts lines 210-214: while preceded by dot with spaces
      const source = 'architecture rtl of test is\nbegin\n  inst . while loop\n    null;\n  end loop;\nend architecture;';
      const pairs = parser.parse(source);
      findBlock(pairs, 'loop');
    });
  });

  suite('Coverage: end loop between for/while and loop position', () => {
    test('should skip end loop between for and loop when validating standalone loop', () => {
      // Covers vhdlValidation.ts lines 252-253: 'end loop' found between
      // for/while prefix and the loop being validated is skipped
      const source = 'for i in 0 to 3 loop null; end loop; for j in 0 to 7\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should track paired loop positions to avoid double-counting', () => {
      // Covers vhdlValidation.ts lines 256-257: pairedLoopPositions
      // prevents the same loop from being counted twice
      const source = 'for a in 0 to 3 loop null; end loop; while b loop null; end loop; for c in 0 to 3\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('Coverage: isCaseBranchArrow excluded region skip', () => {
    test('should skip excluded region when scanning for case branch arrow', () => {
      // Covers vhdlValidation.ts lines 331-333, 385-387: isCaseBranchArrow
      // encounters excluded region and skips over it
      const source =
        "architecture rtl of test is\nbegin\n  inst: entity work.comp\n    port map (\n      a => sig1 when sel = '1' else sig2\n    );\nend architecture;";
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });

    test('should skip comment between when and => in case branch detection', () => {
      // Covers vhdlValidation.ts lines 385-387: findExcludedRegionAt
      // returns a region during isCaseBranchArrow backward scan
      const source =
        'architecture rtl of test is\nbegin\n  inst: entity work.comp\n    port map (\n      a => sig1 when "string" -- comment\n      else sig2\n    );\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Coverage: isCaseBranchArrow when detection', () => {
    test('should detect when keyword before => in case branch', () => {
      // Covers vhdlValidation.ts lines 394-395: isCaseBranchArrow finds 'when'
      // and returns true, causing isInSignalAssignment to skip the =>
      const source = 'case sel is\n  when "00" =>\n    sig <= a when cond else b;\n  when others =>\n    null;\nend case;';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assert.ok(casePair);
      // when should be intermediate of case, not consumed by signal assignment detection
      assertIntermediates(casePair, ['is', 'when', 'when']);
    });
  });

  suite('Coverage: isCaseBranchArrow reaching start of source', () => {
    test('should return false when isCaseBranchArrow reaches start of source', () => {
      // Covers vhdlValidation.ts lines 413-414: backward scan in
      // isCaseBranchArrow reaches j < 0 and returns false
      const source = 'a => sig when cond else other;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Coverage: isWaitBeforeFor dot-preceded wait', () => {
    test('should not treat rec.wait as wait keyword before for', () => {
      // Covers vhdlValidation.ts lines 463-464: wait preceded by '.'
      // is rejected as hierarchical reference
      const source = 'process is\nbegin\n  rec.wait for i in 0 to 3 loop\n    null;\n  end loop;\nend process;';
      const pairs = parser.parse(source);
      findBlock(pairs, 'for');
    });

    test('should not treat rec . wait (with spaces) as wait keyword before for', () => {
      // Covers vhdlValidation.ts lines 459-463: wait preceded by dot with spaces
      const source = 'process is\nbegin\n  rec . wait for i in 0 to 3 loop\n    null;\n  end loop;\nend process;';
      const pairs = parser.parse(source);
      findBlock(pairs, 'for');
    });
  });

  suite('Coverage: isValidForOpen blank line at start of file', () => {
    test('should break blank-line scan when reaching start of file', () => {
      // Covers vhdlValidation.ts line 39: prevNl <= 0 break
      // when scanning blank lines reaches the beginning of the file
      const source = '\n\nfor i in 0 to 3 loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Coverage: isValidEntityOrConfigOpen blank line at start of file', () => {
    test('should break blank-line scan when reaching start of file for entity', () => {
      // Covers vhdlValidation.ts line 86: prevNl <= 0 break
      // in isValidEntityOrConfigOpen blank-line scanning
      const source = '\n\nentity test is\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
    });
  });

  suite('Coverage: isCaseBranchArrow semicolon boundary', () => {
    test('should stop at semicolon in isCaseBranchArrow scan', () => {
      // Covers vhdlValidation.ts line 389: semicolon encountered
      // during backward scan returns false
      const source = 'architecture rtl of test is\nbegin\n  null; inst: entity work.comp\n    port map (\n      a => b\n    );\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Coverage: isCaseBranchArrow when at word boundary', () => {
    test('should not match when inside longer identifier in isCaseBranchArrow', () => {
      // Covers vhdlValidation.ts line 393: when boundary check
      // where adjacent character is alphanumeric (e.g., "whenever")
      const source = 'architecture rtl of test is\nbegin\n  inst: entity work.comp\n    port map (\n      whenever => sig\n    );\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
    });
  });

  suite('Coverage: isCaseBranchArrow TRUE branch in isInSignalAssignment', () => {
    test('should skip case branch => when scanning backward for signal assignment', () => {
      // Covers vhdlValidation.ts lines 331-333: isCaseBranchArrow returns true
      // causing isInSignalAssignment to skip past the => and continue scanning
      // when choice2 => is preceded by when (making it a case branch arrow)
      // The else on the last line scans backward, encounters =>, isCaseBranchArrow
      // finds when before it and returns true, then scan continues past =>
      const source = 'case sel is\n  when choice =>\n    when choice2 =>\n      null;\nend case;';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assert.ok(casePair);
      assertIntermediates(casePair, ['is', 'when', 'when']);
    });
  });

  suite('Regression: character literal with newline should not span lines', () => {
    test('should not treat tick-LF-tick as character literal', () => {
      // Before fix: '\n' between ticks was treated as a 3-char character literal
      // After fix: newline is rejected, each tick handled separately
      const regions = parser.getExcludedRegions("'\n'");
      const charLitRegion = regions.find((r) => r.start === 0 && r.end === 3);
      assert.strictEqual(charLitRegion, undefined, 'tick-LF-tick should not be a character literal');
    });

    test('should not treat tick-CR-tick as character literal', () => {
      const regions = parser.getExcludedRegions("'\r'");
      const charLitRegion = regions.find((r) => r.start === 0 && r.end === 3);
      assert.strictEqual(charLitRegion, undefined, 'tick-CR-tick should not be a character literal');
    });

    test('should preserve attribute tick after newline-terminated tick', () => {
      // Before fix: '\n' consumed both ticks as character literal,
      // exposing 'loop' keyword that should be excluded by attribute tick
      const source = "x <= '\n'loop;\nfor i in 0 to 7 loop\n  null;\nend loop;";
      const regions = parser.getExcludedRegions(source);
      const loopExcluded = regions.some((r) => source.slice(r.start, r.end).includes('loop'));
      assert.ok(loopExcluded, "'loop should be excluded as attribute tick");
    });
  });

  suite('Regression: end postponed process pairing', () => {
    test('should pair process with end postponed process, not if with end postponed process', () => {
      const source =
        'architecture rtl of test is\nbegin\n  postponed process\n  begin\n    if cond then\n      null;\n    end postponed process;\nend architecture;';
      const pairs = parser.parse(source);
      const processPair = findBlock(pairs, 'process');
      assert.ok(processPair, 'process block should exist');
      assert.strictEqual(processPair.closeKeyword.value.toLowerCase(), 'end postponed process');
      // if should NOT pair with end postponed process
      const ifBlocks = pairs.filter((p) => p.openKeyword.value.toLowerCase() === 'if');
      for (const ifBlock of ifBlocks) {
        assert.notStrictEqual(ifBlock.closeKeyword.value.toLowerCase(), 'end postponed process');
      }
    });
  });

  suite('Bug: isValidLoopOpen ignores semicolons between for/while prefix and loop', () => {
    test('should treat loop as standalone when for is terminated by semicolon on same line', () => {
      const source = 'for i in range; loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      const loopBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'loop');
      assert.ok(loopBlock, 'loop should be standalone when for is terminated by semicolon');
    });

    test('should treat loop as standalone when for is terminated by semicolon on previous line', () => {
      const source = 'for i in range;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      const loopBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'loop');
      assert.ok(loopBlock, 'loop should be standalone when for is terminated by semicolon on previous line');
    });

    test('should treat loop as standalone when while is terminated by semicolon on same line', () => {
      const source = 'while cond; loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      const loopBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'loop');
      assert.ok(loopBlock, 'loop should be standalone when while is terminated by semicolon');
    });

    test('should still pair for with loop when no semicolon separates them', () => {
      const source = 'for i in 0 to 7 loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });

    test('should not treat semicolon in comment as terminator between for and loop', () => {
      const source = 'for i in 0 to 7 -- ;\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Wait while rejection', () => {
    test('should not treat while as block open when preceded by wait', () => {
      const source = 'process\nbegin\n  wait while running;\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end');
    });

    test('should still treat standalone while as block open', () => {
      const source = 'while running loop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'while', 'end loop');
    });
  });

  suite('Regression: isValidWhileOpen scans across newlines', () => {
    test('should reject while as block opener when wait is on previous line', () => {
      const source = 'process\nbegin\n  wait\n  while running;\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end');
    });

    test('should reject while when wait is on previous line with comment between', () => {
      const source = 'process\nbegin\n  wait -- comment\n  while running;\nend;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end');
    });
  });

  suite('Regression: keywords inside parenthesized expressions', () => {
    test('should reject if inside port map', () => {
      const source = 'process\nbegin\n  inst: entity work.my_entity\n    port map (if => a);\n  null;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });

    test('should reject case inside generic map', () => {
      const source =
        'architecture rtl of test is\nbegin\n  inst: entity work.comp\n    generic map (case => 1)\n    port map (a => b);\nend architecture;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'architecture', 'end architecture');
      assertIntermediates(pairs[0], ['is', 'begin']);
    });

    test('should reject if inside function call', () => {
      const source = 'process\nbegin\n  x := func(if);\n  null;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('BUG1: for in use-clause binding should not be detected as block opener', () => {
      // In VHDL configurations, 'use entity work.impl for all;' contains 'for'
      // that is part of the binding syntax, not a loop or generate prefix.
      // The false 'for' steals 'end for' from the real for-block opener.
      const source = `configuration cfg of test is
  for all : counter
    use entity work.impl for all;
  end for;
end configuration;`;
      const pairs = parser.parse(source);
      // Real for block (for all : counter) should be paired with end for
      const forBlock = findBlock(pairs, 'for');
      assert.ok(forBlock, 'real for block should exist');
      assert.strictEqual(forBlock.openKeyword.startOffset, source.indexOf('for all : counter'));
      assert.strictEqual(forBlock.closeKeyword.value.toLowerCase(), 'end for');
    });

    test('BUG1: for in use configuration binding should not be detected as block opener', () => {
      const source = `configuration cfg of test is
  for all : counter
    use configuration work.counter_cfg for all;
  end for;
end configuration;`;
      const pairs = parser.parse(source);
      const forBlock = findBlock(pairs, 'for');
      assert.ok(forBlock, 'real for block should exist');
      assert.strictEqual(forBlock.openKeyword.startOffset, source.indexOf('for all : counter'));
    });

    test('should filter is in multi-line type declaration', () => {
      const source = 'package my_pkg is\n  type state_t\n    is (idle, active);\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });

    test('BUG2: is in subtype declaration should not be false intermediate of package', () => {
      // 'subtype byte is integer' contains 'is' that is not the package's own 'is'
      const source = `package my_pkg is
  subtype byte is integer range 0 to 255;
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate, not 2');
    });

    test('BUG2: is in alias declaration should not be false intermediate of package', () => {
      const source = `package my_pkg is
  alias byte is integer range 0 to 255;
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate from alias');
    });

    test('BUG2: is in type declaration should not be false intermediate of package', () => {
      const source = `package my_pkg is
  constant C : integer := 10;
  subtype byte is integer range 0 to 255;
  type state_t is (idle, active);
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate, not 3');
    });

    test('BUG2: is in attribute specification should not be false intermediate of package', () => {
      const source = `package my_pkg is
  attribute keep of sig : signal is true;
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate, not 2');
    });

    test('BUG2: is in file declaration should not be false intermediate of package', () => {
      const source = `package my_pkg is
  file f : text is "data.txt";
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate, not 2');
    });

    test('BUG2: is in group template declaration should not be false intermediate of package', () => {
      const source = `package my_pkg is
  group my_group is (signal, signal);
end package;`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have only 1 is intermediate, not 2');
    });

    test('BUG3: then inside parenthesized expression should not be false intermediate', () => {
      // Reserved words cannot be identifiers in VHDL, but the parser should
      // still handle this gracefully to avoid false intermediates
      const source = 'if cond then\n  x := func(a, then, b);\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      const thenCount = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'then').length;
      assert.strictEqual(thenCount, 1, 'if block should have only 1 then intermediate, not 2');
    });

    test('BUG4: is filtering should use 5-line lookback limit', () => {
      const source = 'package my_pkg is\n  type\n    my_type\n    more_stuff\n    is (idle, active);\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((i) => i.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1, 'package should have exactly 1 is intermediate');
    });

    test('BUG5: loop should pair with preceding for within maxLines 15', () => {
      const source = 'for i in 0 to 7\n\n\n\n\nloop\n  null;\nend loop;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'for', 'end loop');
    });
  });

  suite('Regression: is filter in multi-line attribute declaration', () => {
    test('should filter is in multi-line attribute declaration', () => {
      const pairs = parser.parse('package p is\n  attribute keep\n    of sig : signal is true;\nend package;');
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });
  });

  suite('Regression: multi-line use entity/configuration for binding', () => {
    test('should reject for in multi-line use entity ... for binding', () => {
      const source = 'configuration cfg of test is\n  for all : comp\n    use entity\n      work.impl for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.line, 1, 'for block should start at line 1 (for all : comp)');
      assert.strictEqual(forBlock.closeKeyword.value.toLowerCase(), 'end for');
    });

    test('should reject for in multi-line use configuration ... for binding', () => {
      const source = 'configuration cfg of test is\n  for all : comp\n    use configuration\n      work.cfg for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.line, 1, 'for block should start at line 1 (for all : comp)');
      assert.strictEqual(forBlock.closeKeyword.value.toLowerCase(), 'end for');
    });

    test('should not treat for in use-entity binding clause with port map as block opener', () => {
      const source =
        'configuration cfg of test is\n  for all : comp\n    use entity work.impl\n      port map (a => b)\n      for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'for');
      findBlock(pairs, 'configuration');
    });
  });

  suite('Regression: is filtering with type declaration after semicolon mid-line', () => {
    test('should filter is in type declaration after semicolon on same line', () => {
      const source = 'package my_pkg is\n  signal x : integer; type state_t is (idle, active);\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should not filter is when type declaration is terminated by semicolon before block opener is', () => {
      const source = 'type byte is integer range 0 to 255; entity test is\nend entity;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'entity', 'end entity');
      assertIntermediates(pairs[0], ['is']);
    });
  });

  suite('Regression: multi-line type/subtype is filtering', () => {
    test('should filter is in multi-line type declaration', () => {
      const source = 'package my_pkg is\n  type state_t\n    is (idle, active);\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should filter is in multi-line subtype declaration', () => {
      const source = 'package my_pkg is\n  subtype my_int\n    is integer range 0 to 255;\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should filter is in type declaration with block comment between type and is', () => {
      const pairs = parser.parse('architecture rtl of test is\nbegin\n  type state_t\n  /* comment */\n  is (idle, active);\nend architecture;');
      assertSingleBlock(pairs, 'architecture', 'end architecture');
      // Intermediates should be ['is', 'begin'], not ['is', 'begin', 'is']
      const pair = pairs[0];
      assert.strictEqual(pair.intermediates.length, 2);
    });
  });

  suite('Regression: component instantiation vs declaration', () => {
    test('should not treat component instantiation with label as block opener', () => {
      // Bug: 'inst: component ...' with simple 'end' causes component/end pairing,
      // leaving architecture unpaired
      const source =
        'architecture rtl of test is\nbegin\n  inst: component my_comp port map (a => b);\n  proc: process\n  begin\n    null;\n  end;\nend;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'process');
      findBlock(pairs, 'architecture');
    });

    test('should not emit component token for component instantiation', () => {
      const source = 'inst: component my_comp;';
      const tokens = parser.getTokens(source);
      const compToken = tokens.find((t) => t.value.toLowerCase() === 'component');
      assert.strictEqual(compToken, undefined, 'component after colon should not be a token');
    });

    test('should parse component declaration without label as block', () => {
      const source = 'component counter is\n  port (clk : in std_logic);\nend component;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'component', 'end component');
    });

    test('should not emit component token for instantiation with port map', () => {
      const source = 'u1: component adder\n  port map (a => x, b => y, sum => z);';
      const tokens = parser.getTokens(source);
      const compToken = tokens.find((t) => t.value.toLowerCase() === 'component');
      assert.strictEqual(compToken, undefined, 'component after colon should not be a token');
    });

    test('should not emit component token for instantiation with generic map', () => {
      const source = 'u1: component fifo\n  generic map (DEPTH => 16)\n  port map (clk => clk, data => data);';
      const tokens = parser.getTokens(source);
      const compToken = tokens.find((t) => t.value.toLowerCase() === 'component');
      assert.strictEqual(compToken, undefined, 'component after colon should not be a token');
    });

    test('should not emit component token for instantiation with whitespace before colon', () => {
      const source = 'inst : component my_comp port map (a => b);';
      const tokens = parser.getTokens(source);
      const compToken = tokens.find((t) => t.value.toLowerCase() === 'component');
      assert.strictEqual(compToken, undefined, 'component after colon (with space) should not be a token');
    });

    test('should not emit COMPONENT token for instantiation (case insensitive)', () => {
      const source = 'inst: COMPONENT my_comp port map (a => b);';
      const tokens = parser.getTokens(source);
      const compToken = tokens.find((t) => t.value.toLowerCase() === 'component');
      assert.strictEqual(compToken, undefined, 'COMPONENT after colon should not be a token');
    });
  });

  suite('Regression: for loop after terminated use entity', () => {
    test('should allow for loop after terminated use entity on same line', () => {
      const pairs = parser.parse('use entity work.impl; for i in 0 to 3 loop\n  null;\nend loop;');
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'for');
    });

    test('should allow for loop after terminated use entity on previous line', () => {
      const pairs = parser.parse('use entity work.impl;\nfor i in 0 to 3 loop\n  null;\nend loop;');
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'for');
    });

    test('should allow for loop when use entity is inside string', () => {
      const pairs = parser.parse('report "use entity";\nfor i in 0 to 3 loop\n  null;\nend loop;');
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'for');
    });

    test('should allow for loop when use entity is inside block comment', () => {
      const pairs = parser.parse('/* use entity work.comp */ for i in 0 to 3 loop\n  null;\nend loop;');
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'for');
    });
  });

  suite('Regression: is filter multi-line scan', () => {
    test('should filter is from type declaration split across three lines', () => {
      const source = 'package pkg is\n  type\n    state_t\n    is (idle, active);\nend package;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'end package');
      const isIntermediates = pairs[0].intermediates.filter((t) => t.value.toLowerCase() === 'is');
      assert.strictEqual(isIntermediates.length, 1);
    });
  });

  suite('Regression: isValidForOpen backward scan skips comment-only lines', () => {
    test('should reject for in use entity binding with comment between', () => {
      const source =
        'configuration cfg of test is\n  for all : counter\n    use entity work.impl\n      -- binding comment\n      for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = pairs.find((p) => p.openKeyword.value.toLowerCase() === 'for');
      assert.ok(forBlock);
      assert.strictEqual(forBlock.openKeyword.line, 1);
    });
  });

  suite('Regression tests', () => {
    test('should filter exit when with newline between exit and when', () => {
      const source = 'case x is\n  when 0 =>\n    exit\n      when done;\n  when others =>\n    null;\nend case;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      assertIntermediates(pairs[0], ['is', 'when', 'when']);
    });

    test('should filter next when with newline between next and when', () => {
      const source = 'case x is\n  when 0 =>\n    next\n      when ready;\n  when others =>\n    null;\nend case;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      assertIntermediates(pairs[0], ['is', 'when', 'when']);
    });

    test('should not filter when after exit in comment', () => {
      const source = 'case x is\n-- exit\nwhen val => null;\nend case;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      assertIntermediates(pairs[0], ['is', 'when']);
    });

    test('should not filter when after next in comment', () => {
      const source = 'case x is\n-- next\nwhen val => null;\nend case;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'end case');
      assertIntermediates(pairs[0], ['is', 'when']);
    });

    test('should have flat nest levels for elsif generate siblings', () => {
      const source = 'gen1: if cond1 generate\n  null;\nelsif cond2 generate\n  null;\nend generate gen1;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const gen1 = pairs.find((p) => p.openKeyword.value === 'generate' && p.intermediates.length > 0);
      const gen2 = pairs.find((p) => p.openKeyword.value === 'generate' && p.intermediates.length === 0);
      assert.ok(gen1 && gen2);
      assert.strictEqual(gen1.nestLevel, 1);
      assert.strictEqual(gen2.nestLevel, 1);
      assertNestLevel(pairs, 'if', 0);
    });

    test('should have flat nest levels for if-elsif-else generate', () => {
      const source = 'g: if c1 generate\n  null;\nelsif c2 generate\n  null;\nelse generate\n  null;\nend generate g;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
      const generates = pairs.filter((p) => p.openKeyword.value === 'generate');
      assert.strictEqual(generates.length, 3);
      for (const gen of generates) {
        assert.strictEqual(gen.nestLevel, 1);
      }
      assertNestLevel(pairs, 'if', 0);
    });
  });

  suite('Regression: multi-line port/generic map in for binding', () => {
    test('should reject for in use entity binding with multi-line port map', () => {
      const source =
        'configuration cfg of test is\n  for all : comp\n    use entity work.impl\n      port map (\n        a => b\n      )\n      for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'configuration');
      findBlock(pairs, 'for');
    });
  });

  suite('Regression: multi-line port map in for validation', () => {
    test('should reject for in multi-line use entity port map binding', () => {
      const source =
        'configuration cfg of ent is\n  for inst : comp\n    use entity work.impl\n      port map (\n        a => b\n      )\n      for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.startOffset, source.indexOf('for inst'));
    });

    test('should reject for in multi-line generic map binding', () => {
      const source =
        'configuration cfg of ent is\n  for inst : comp\n    use entity work.impl\n      generic map (\n        N => 4\n      )\n      for rtl;\n  end for;\nend configuration;';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forBlock = findBlock(pairs, 'for');
      assert.strictEqual(forBlock.openKeyword.startOffset, source.indexOf('for inst'));
    });
  });

  suite('Regression: isInSignalAssignment false positive for else after unterminated when', () => {
    test('should treat else as intermediate when signal assignment has when but no semicolon', () => {
      const source = 'if cond then\n  sig <= val1 when sel\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should still filter else in valid conditional signal assignment', () => {
      const source = "architecture rtl of test is\nbegin\n  sig <= '1' when sel else '0';\nend architecture;";
      const pairs = parser.parse(source);
      const archPair = findBlock(pairs, 'architecture');
      assertIntermediates(archPair, ['is', 'begin']);
    });

    test('should still filter else in multi-line chained signal assignment', () => {
      const source = 'process (clk)\nbegin\n  sig <= a when c1\n         else b when c2\n         else c;\nend process;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'process', 'end process');
      const nonBeginIntermediates = pairs[0].intermediates.filter((i) => i.value !== 'begin');
      assert.strictEqual(nonBeginIntermediates.length, 0);
    });

    test('should treat else as intermediate when signal assignment with when is after then', () => {
      const source = 'if cond then\n  sig <= val when sel\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });
  });

  suite('Regression: conditional signal assignment else not filtered when first statement after then', () => {
    test('should filter else in conditional signal assignment as first statement after then', () => {
      const source = 'if cond then\n  sig <= a when cond2 else b;\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should filter else in conditional signal assignment after semicolon in then block', () => {
      const source = 'if cond then\n  x := 0;\n  sig <= a when cond2 else b;\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'else']);
    });

    test('should filter else in conditional signal assignment as first statement after elsif then', () => {
      const source = 'if a then\n  null;\nelsif b then\n  sig <= x when c else y;\nelse\n  null;\nend if;';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'if', 'end if');
      assertIntermediates(pairs[0], ['then', 'elsif', 'then', 'else']);
    });
  });

  suite('Regression: exit/next with loop label before when', () => {
    test('should filter when in next label when statement', () => {
      const source = 'case x is\n  when 0 =>\n    next my_loop when done;\n  when others =>\n    null;\nend case;';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      const whenIntermediates = casePair.intermediates.filter((i) => i.value === 'when');
      assert.strictEqual(whenIntermediates.length, 2);
    });

    test('should filter when in exit label when statement', () => {
      const source = 'case x is\n  when 0 =>\n    exit my_loop when done;\n  when others =>\n    null;\nend case;';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      const whenIntermediates = casePair.intermediates.filter((i) => i.value === 'when');
      assert.strictEqual(whenIntermediates.length, 2);
    });
  });

  suite('Regression: is filter with block comments before declaration keyword', () => {
    test('should filter is when block comment precedes type on same line', () => {
      const pairs = parser.parse('package my_pkg is\n  /* comment */ type state_t is (idle, active);\nend package;');
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });

    test('should filter is when block comment precedes type on previous line', () => {
      const pairs = parser.parse('package my_pkg is\n  /* comment */ type state_t\n    is (idle, active);\nend package;');
      assertSingleBlock(pairs, 'package', 'end package');
      assertIntermediates(pairs[0], ['is']);
    });
  });

  generateCommonTests(config);
});
