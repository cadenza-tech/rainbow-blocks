// Fuzzing tests for all parsers - systematic edge case exploration

import * as assert from 'node:assert';
import { setup, suite, test } from 'mocha';
import { AdaBlockParser } from '../../parsers/adaParser';
import { ApplescriptBlockParser } from '../../parsers/applescriptParser';
import type { BaseBlockParser } from '../../parsers/baseParser';
import { BashBlockParser } from '../../parsers/bashParser';
import { CobolBlockParser } from '../../parsers/cobolParser';
import { CrystalBlockParser } from '../../parsers/crystalParser';
import { ElixirBlockParser } from '../../parsers/elixirParser';
import { ErlangBlockParser } from '../../parsers/erlangParser';
import { FortranBlockParser } from '../../parsers/fortranParser';
import { JuliaBlockParser } from '../../parsers/juliaParser';
import { LuaBlockParser } from '../../parsers/luaParser';
import { MatlabBlockParser } from '../../parsers/matlabParser';
import { OctaveBlockParser } from '../../parsers/octaveParser';
import { PascalBlockParser } from '../../parsers/pascalParser';
import { RubyBlockParser } from '../../parsers/rubyParser';
import { VerilogBlockParser } from '../../parsers/verilogParser';
import { VhdlBlockParser } from '../../parsers/vhdlParser';

interface ParserEntry {
  name: string;
  parser: BaseBlockParser;
  // A simple valid block for this language
  simpleBlock: string;
  // Expected block count for simpleBlock
  expectedCount: number;
  // Single-line comment prefix (if any)
  lineComment: string;
  // String delimiter
  stringDelim: string;
}

function getParser(entries: ParserEntry[], name: string): BaseBlockParser {
  const entry = entries.find((p) => p.name === name);
  assert.ok(entry, `Parser '${name}' not found`);
  return entry.parser;
}

suite('Fuzzing Tests - All Parsers', () => {
  let parsers: ParserEntry[];

  setup(() => {
    parsers = [
      {
        name: 'Ada',
        parser: new AdaBlockParser(),
        simpleBlock: 'if X then\n  null;\nend if;',
        expectedCount: 1,
        lineComment: '--',
        stringDelim: '"'
      },
      {
        name: 'AppleScript',
        parser: new ApplescriptBlockParser(),
        simpleBlock: 'if true then\n  return\nend if',
        expectedCount: 1,
        lineComment: '--',
        stringDelim: '"'
      },
      {
        name: 'Bash',
        parser: new BashBlockParser(),
        simpleBlock: 'if true; then\n  echo ok\nfi',
        expectedCount: 1,
        lineComment: '#',
        stringDelim: '"'
      },
      {
        name: 'COBOL',
        parser: new CobolBlockParser(),
        simpleBlock: "       IF X = 1\n         DISPLAY 'HI'\n       END-IF",
        expectedCount: 1,
        lineComment: '*>',
        stringDelim: '"'
      },
      {
        name: 'Crystal',
        parser: new CrystalBlockParser(),
        simpleBlock: 'if true\n  1\nend',
        expectedCount: 1,
        lineComment: '#',
        stringDelim: '"'
      },
      {
        name: 'Elixir',
        parser: new ElixirBlockParser(),
        simpleBlock: 'if true do\n  1\nend',
        expectedCount: 1,
        lineComment: '#',
        stringDelim: '"'
      },
      {
        name: 'Erlang',
        parser: new ErlangBlockParser(),
        simpleBlock: 'begin\n  ok\nend',
        expectedCount: 1,
        lineComment: '%',
        stringDelim: '"'
      },
      {
        name: 'Fortran',
        parser: new FortranBlockParser(),
        simpleBlock: 'if (x) then\n  y = 1\nend if',
        expectedCount: 1,
        lineComment: '!',
        stringDelim: '"'
      },
      {
        name: 'Julia',
        parser: new JuliaBlockParser(),
        simpleBlock: 'if true\n  1\nend',
        expectedCount: 1,
        lineComment: '#',
        stringDelim: '"'
      },
      {
        name: 'Lua',
        parser: new LuaBlockParser(),
        simpleBlock: 'if true then\n  x = 1\nend',
        expectedCount: 1,
        lineComment: '--',
        stringDelim: '"'
      },
      {
        name: 'MATLAB',
        parser: new MatlabBlockParser(),
        simpleBlock: 'if true\n  x = 1;\nend',
        expectedCount: 1,
        lineComment: '%',
        stringDelim: "'"
      },
      {
        name: 'Octave',
        parser: new OctaveBlockParser(),
        simpleBlock: 'if true\n  x = 1;\nend',
        expectedCount: 1,
        lineComment: '%',
        stringDelim: "'"
      },
      {
        name: 'Pascal',
        parser: new PascalBlockParser(),
        simpleBlock: 'begin\n  x := 1;\nend',
        expectedCount: 1,
        lineComment: '//',
        stringDelim: "'"
      },
      {
        name: 'Ruby',
        parser: new RubyBlockParser(),
        simpleBlock: 'if true\n  1\nend',
        expectedCount: 1,
        lineComment: '#',
        stringDelim: '"'
      },
      {
        name: 'Verilog',
        parser: new VerilogBlockParser(),
        simpleBlock: 'module test;\nendmodule',
        expectedCount: 1,
        lineComment: '//',
        stringDelim: '"'
      },
      {
        name: 'VHDL',
        parser: new VhdlBlockParser(),
        simpleBlock: 'entity test is\nend entity;',
        expectedCount: 1,
        lineComment: '--',
        stringDelim: '"'
      }
    ];
  });

  suite('Empty and whitespace input', () => {
    test('should handle empty string', () => {
      for (const { name, parser } of parsers) {
        const pairs = parser.parse('');
        assert.strictEqual(pairs.length, 0, `${name}: empty string should produce 0 pairs`);
      }
    });

    test('should handle whitespace only', () => {
      for (const { name, parser } of parsers) {
        const pairs = parser.parse('   \n\t\n   ');
        assert.strictEqual(pairs.length, 0, `${name}: whitespace should produce 0 pairs`);
      }
    });

    test('should handle single newline', () => {
      for (const { name, parser } of parsers) {
        const pairs = parser.parse('\n');
        assert.strictEqual(pairs.length, 0, `${name}: single newline should produce 0 pairs`);
      }
    });

    test('should handle null character', () => {
      for (const { name, parser } of parsers) {
        const pairs = parser.parse('\0');
        assert.strictEqual(pairs.length, 0, `${name}: null char should produce 0 pairs`);
      }
    });
  });

  suite('Simple block validation', () => {
    test('should parse simple block correctly', () => {
      for (const { name, parser, simpleBlock, expectedCount } of parsers) {
        const pairs = parser.parse(simpleBlock);
        assert.strictEqual(pairs.length, expectedCount, `${name}: simple block should produce ${expectedCount} pair(s), got ${pairs.length}`);
      }
    });
  });

  suite('Deep nesting', () => {
    test('should handle 10 levels of nesting - Ruby-style', () => {
      const rubyStyleParsers = parsers.filter((p) => ['Ruby', 'Crystal', 'Julia', 'Erlang'].includes(p.name));
      for (const { name, parser } of rubyStyleParsers) {
        let source = '';
        for (let i = 0; i < 10; i++) source += 'begin\n';
        for (let i = 0; i < 10; i++) source += 'end\n';
        const pairs = parser.parse(source);
        assert.strictEqual(pairs.length, 10, `${name}: 10 nested begins should produce 10 pairs`);
        for (const pair of pairs) {
          assert.ok(pair.nestLevel >= 0 && pair.nestLevel <= 9, `${name}: nestLevel should be 0-9, got ${pair.nestLevel}`);
        }
      }
    });

    test('should handle 10 levels of nesting - Lua', () => {
      const parser = getParser(parsers, 'Lua');
      let source = '';
      for (let i = 0; i < 10; i++) source += 'if true then\n';
      source += 'x = 1\n';
      for (let i = 0; i < 10; i++) source += 'end\n';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 10);
    });

    test('should handle 10 levels of nesting - Bash', () => {
      const parser = getParser(parsers, 'Bash');
      let source = '';
      for (let i = 0; i < 10; i++) source += 'if true; then\n';
      source += 'echo ok\n';
      for (let i = 0; i < 10; i++) source += 'fi\n';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 10);
    });

    test('should handle 10 levels of nesting - Pascal', () => {
      const parser = getParser(parsers, 'Pascal');
      let source = '';
      for (let i = 0; i < 10; i++) source += 'begin\n';
      source += 'x := 1;\n';
      for (let i = 0; i < 10; i++) source += 'end;\n';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 10);
    });

    test('should handle 10 levels of nesting - Fortran', () => {
      const parser = getParser(parsers, 'Fortran');
      let source = 'program test\n';
      for (let i = 0; i < 9; i++) source += 'if (.true.) then\n';
      source += 'x = 1\n';
      for (let i = 0; i < 9; i++) source += 'end if\n';
      source += 'end program\n';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 10);
    });

    test('should handle 10 levels of nesting - Verilog', () => {
      const parser = getParser(parsers, 'Verilog');
      let source = 'module test;\n';
      for (let i = 0; i < 9; i++) source += 'begin\n';
      source += 'x = 1;\n';
      for (let i = 0; i < 9; i++) source += 'end\n';
      source += 'endmodule\n';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 10);
    });
  });

  suite('Unmatched blocks', () => {
    test('should handle only open keywords without crash', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\nif false\nif nil',
        Crystal: 'if true\nif false\nif nil',
        Elixir: 'if true do\nif false do\nif nil do',
        Lua: 'if true then\nif false then',
        Bash: 'if true; then\nif false; then',
        Julia: 'if true\nif false',
        Erlang: 'begin\nbegin\nbegin',
        Ada: 'if X then\nif Y then',
        Fortran: 'if (.true.) then\nif (.false.) then',
        Pascal: 'begin\nbegin\nbegin',
        MATLAB: 'if true\nif false',
        Octave: 'if true\nif false',
        Verilog: 'module a;\nmodule b;',
        VHDL: 'entity a is\nentity b is',
        AppleScript: 'if true then\nif false then',
        COBOL: '       IF X = 1\n       IF Y = 2'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          // Should not crash - any number of pairs is acceptable
          assert.ok(Array.isArray(pairs), `${name}: should return array for unmatched opens`);
        }
      }
    });

    test('should handle only close keywords without crash', () => {
      const testCases: Record<string, string> = {
        Ruby: 'end\nend\nend',
        Crystal: 'end\nend\nend',
        Elixir: 'end\nend\nend',
        Lua: 'end\nend\nend',
        Bash: 'fi\nfi\nfi',
        Julia: 'end\nend\nend',
        Erlang: 'end\nend\nend',
        Ada: 'end;\nend;\nend;',
        Fortran: 'end\nend\nend',
        Pascal: 'end;\nend;\nend;',
        MATLAB: 'end\nend\nend',
        Octave: 'end\nend\nend',
        Verilog: 'end\nend\nend',
        VHDL: 'end;\nend;\nend;',
        AppleScript: 'end\nend\nend',
        COBOL: '       END-IF\n       END-IF'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(Array.isArray(pairs), `${name}: should return array for unmatched closes`);
          assert.strictEqual(pairs.length, 0, `${name}: only close keywords should produce 0 pairs`);
        }
      }
    });

    test('should handle interleaved open/close without crash', () => {
      const testCases: Record<string, string> = {
        Ruby: 'end\nif true\nend\nif false\nend\nend',
        Crystal: 'end\nif true\nend\nif false\nend\nend',
        Julia: 'end\nif true\nend\nif false\nend\nend',
        Lua: 'end\nif true then\nend\nif false then\nend\nend',
        Erlang: 'end\nbegin\nend\nbegin\nend\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(Array.isArray(pairs), `${name}: should return array for interleaved blocks`);
        }
      }
    });
  });

  suite('Keywords in excluded regions', () => {
    test('should ignore keywords in line comments', () => {
      for (const { name, parser, lineComment } of parsers) {
        if (!lineComment) continue;
        const source = `${lineComment} if begin do end fi done case`;
        const pairs = parser.parse(source);
        assert.strictEqual(pairs.length, 0, `${name}: keywords in line comment should be ignored`);
      }
    });

    test('should ignore keywords in strings', () => {
      for (const { name, parser, stringDelim } of parsers) {
        const source = `x = ${stringDelim}if begin do end fi done case${stringDelim}`;
        const pairs = parser.parse(source);
        assert.strictEqual(pairs.length, 0, `${name}: keywords in string should be ignored`);
      }
    });

    test('should handle unterminated string at EOF', () => {
      for (const { name, parser, stringDelim } of parsers) {
        const source = `x = ${stringDelim}if begin do end`;
        // Should not crash
        const pairs = parser.parse(source);
        assert.ok(Array.isArray(pairs), `${name}: unterminated string should not crash`);
      }
    });

    test('should handle unterminated comment at EOF', () => {
      const blockCommentParsers: Record<string, string> = {
        Ada: '/* if begin end',
        Fortran: '! if then end\n',
        Pascal: '{ if begin end',
        Lua: '--[[ if then end',
        Julia: '#= if function end',
        MATLAB: '%{ if function end',
        Octave: '%{ if function end',
        Verilog: '/* if module end',
        VHDL: '/* if entity end'
      };
      for (const { name, parser } of parsers) {
        if (blockCommentParsers[name]) {
          const pairs = parser.parse(blockCommentParsers[name]);
          assert.ok(Array.isArray(pairs), `${name}: unterminated block comment should not crash`);
        }
      }
    });
  });

  suite('Word boundary edge cases', () => {
    test('should not match keyword as part of larger identifier', () => {
      const testCases: Record<string, string> = {
        Ruby: 'x = endif\ny = endwhile\nz = beginx',
        Crystal: 'x = endif\ny = endwhile\nz = beginx',
        Julia: 'x = endif\ny = endwhile\nz = beginx',
        Elixir: 'x = endif\ny = endwhile\nz = beginx',
        Lua: 'x = endif\ny = endwhile\nz = beginx',
        Erlang: 'x = endif\ny = endwhile\nz = beginx',
        Ada: 'x := endif;\ny := beginx;',
        Pascal: 'x := beginx;\ny := endz;',
        MATLAB: 'x = endif;\ny = beginx;',
        Octave: 'x = beginx;\ny = endz;'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 0, `${name}: keywords inside identifiers should not match`);
        }
      }
    });

    test('should match keyword preceded by non-word characters', () => {
      const testCases: Record<string, string> = {
        Ruby: '(if true\nend)',
        Crystal: '(if true\nend)',
        Julia: 'x = 1\nif true\nend',
        Lua: '(if true then\nend)',
        Pascal: '(begin\nend)'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 1, `${name}: keyword after non-word char should match`);
        }
      }
    });
  });

  suite('Unicode handling', () => {
    test('should handle unicode identifiers around keywords', () => {
      const testCases: Record<string, string> = {
        Ruby: '# \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true\n  x = "\u3053\u3093\u306b\u3061\u306f"\nend',
        Crystal: '# \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true\n  x = "\u3053\u3093\u306b\u3061\u306f"\nend',
        Julia: '# \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true\n  x = "\u3053\u3093\u306b\u3061\u306f"\nend',
        Python: '# \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true\n  x = "\u3053\u3093\u306b\u3061\u306f"\nend',
        Lua: '-- \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true then\n  x = "\u3053\u3093\u306b\u3061\u306f"\nend',
        Bash: '# \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif true; then\n  echo "\u3053\u3093\u306b\u3061\u306f"\nfi',
        Ada: '-- \u65e5\u672c\u8a9e\u30b3\u30e1\u30f3\u30c8\nif X then\n  null;\nend if;'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 1, `${name}: unicode around keywords should still parse`);
        }
      }
    });

    test('should handle emoji in strings', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\n  x = "\ud83d\ude00 if end \ud83d\ude00"\nend',
        Julia: 'if true\n  x = "\ud83d\ude00 if end \ud83d\ude00"\nend',
        Lua: 'if true then\n  x = "\ud83d\ude00 if end \ud83d\ude00"\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 1, `${name}: emoji in strings should not affect parsing`);
        }
      }
    });

    test('should handle surrogate pairs in source', () => {
      for (const { name, parser, simpleBlock } of parsers) {
        // Insert emoji before simple block
        const source = `// \ud83d\ude80\ud83c\udf1f\n${simpleBlock}`;
        const pairs = parser.parse(source);
        // Should not crash, may or may not parse depending on comment style
        assert.ok(Array.isArray(pairs), `${name}: surrogate pairs should not crash parser`);
      }
    });
  });

  suite('Long lines and large input', () => {
    test('should handle very long line with keyword at end', () => {
      const testCases: Record<string, string> = {
        Ruby: `x = ${'a'.repeat(10000)}\nif true\nend`,
        Julia: `x = ${'a'.repeat(10000)}\nif true\nend`,
        Lua: `x = ${'a'.repeat(10000)}\nif true then\nend`
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 1, `${name}: long line should not affect keyword detection`);
        }
      }
    });

    test('should handle many blocks (100)', () => {
      for (const { name, parser } of parsers) {
        let source = '';
        if (['Ruby', 'Crystal', 'Julia'].includes(name)) {
          for (let i = 0; i < 100; i++) source += 'begin\nend\n';
        } else if (name === 'Lua') {
          for (let i = 0; i < 100; i++) source += 'do\nend\n';
        } else if (name === 'Pascal') {
          for (let i = 0; i < 100; i++) source += 'begin\nend;\n';
        } else if (name === 'Bash') {
          for (let i = 0; i < 100; i++) source += 'if true; then\nfi\n';
        } else if (name === 'Erlang') {
          for (let i = 0; i < 100; i++) source += 'begin\nend,\n';
        } else {
          continue;
        }
        const pairs = parser.parse(source);
        assert.strictEqual(pairs.length, 100, `${name}: 100 sequential blocks should produce 100 pairs`);
      }
    });
  });

  suite('CRLF line endings', () => {
    test('should handle CRLF line endings', () => {
      for (const { name, parser, simpleBlock, expectedCount } of parsers) {
        const crlfSource = simpleBlock.replace(/\n/g, '\r\n');
        const pairs = parser.parse(crlfSource);
        assert.strictEqual(pairs.length, expectedCount, `${name}: CRLF line endings should parse same as LF`);
      }
    });

    test('should handle mixed line endings', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\r\n  x = 1\n  y = 2\r\nend',
        Julia: 'if true\r\n  x = 1\n  y = 2\r\nend',
        Lua: 'if true then\r\n  x = 1\n  y = 2\r\nend',
        Bash: 'if true; then\r\n  echo ok\n  echo done\r\nfi'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 1, `${name}: mixed line endings should parse correctly`);
        }
      }
    });
  });

  suite('Keywords at file boundaries', () => {
    test('should handle keyword at very start of file', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\nend',
        Crystal: 'if true\nend',
        Julia: 'if true\nend',
        Elixir: 'if true do\nend',
        Lua: 'if true then\nend',
        Bash: 'if true; then\nfi',
        Erlang: 'begin\nend',
        Pascal: 'begin\nend',
        MATLAB: 'if true\nend',
        Octave: 'if true\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 1, `${name}: keyword at file start should parse`);
        }
      }
    });

    test('should handle keyword at very end of file without newline', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\nend',
        Crystal: 'if true\nend',
        Julia: 'if true\nend',
        Lua: 'if true then\nend',
        Bash: 'if true; then\nfi',
        Erlang: 'begin\nend',
        Pascal: 'begin\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          // No trailing newline
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 1, `${name}: keyword at EOF without newline should parse`);
        }
      }
    });
  });

  suite('Consecutive identical keywords', () => {
    test('should handle consecutive open keywords on same line', () => {
      const testCases: Record<string, string> = {
        Erlang: 'begin begin\nend\nend',
        Ruby: 'begin; begin\nend\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 2, `${name}: consecutive opens should create 2 pairs`);
        }
      }
    });
  });

  suite('Case sensitivity', () => {
    test('case-insensitive parsers should handle mixed case', () => {
      const testCases: Record<string, string> = {
        Ada: 'IF X THEN\n  null;\nEnd If;',
        Fortran: 'IF (.TRUE.) THEN\n  X = 1\nEnd If',
        VHDL: 'ENTITY test IS\nEND entity;',
        Pascal: 'BEGIN\n  x := 1;\nEnd',
        COBOL: "       if X = 1\n         DISPLAY 'HI'\n       END-IF",
        AppleScript: 'IF true THEN\n  return\nEND IF'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 1, `${name}: mixed case should still parse`);
        }
      }
    });

    test('case-sensitive parsers should reject wrong case', () => {
      const testCases: Record<string, string> = {
        Ruby: 'IF true\nEND',
        Crystal: 'IF true\nEND',
        Julia: 'IF true\nEND',
        Elixir: 'IF true DO\nEND',
        Lua: 'IF true THEN\nEND',
        Erlang: 'BEGIN\nEND'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 0, `${name}: uppercase keywords should not match`);
        }
      }
    });
  });

  suite('Multiple intermediates', () => {
    test('should handle many intermediates in single block', () => {
      const testCases: Record<string, string> = {
        Ruby: 'case x\nwhen 1\nwhen 2\nwhen 3\nwhen 4\nwhen 5\nelse\nend',
        Crystal: 'case x\nwhen 1\nwhen 2\nwhen 3\nwhen 4\nwhen 5\nelse\nend',
        Bash: 'if true; then\n  echo 1\nelif true; then\n  echo 2\nelif true; then\n  echo 3\nelse\n  echo 4\nfi',
        Lua: 'if a then\nelseif b then\nelseif c then\nelseif d then\nelse\nend',
        Ada: 'if A then\n  null;\nelsif B then\n  null;\nelsif C then\n  null;\nelse\n  null;\nend if;'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 1, `${name}: block with many intermediates should be 1 pair`);
          assert.ok(pairs[0].intermediates.length >= 3, `${name}: should have multiple intermediates`);
        }
      }
    });
  });

  suite('Adjacent blocks', () => {
    test('should handle blocks on consecutive lines', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\nend\nif false\nend\nif nil\nend',
        Julia: 'if true\nend\nif false\nend\nif 0\nend',
        Lua: 'if true then\nend\nif false then\nend\nif nil then\nend',
        Bash: 'if true; then\nfi\nif false; then\nfi',
        Pascal: 'begin\nend;\nbegin\nend;\nbegin\nend;'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(pairs.length >= 2, `${name}: adjacent blocks should all be parsed`);
          // All should be nestLevel 0
          for (const pair of pairs) {
            assert.strictEqual(pair.nestLevel, 0, `${name}: adjacent blocks should all be nestLevel 0`);
          }
        }
      }
    });
  });

  suite('Escaped string delimiters', () => {
    test('should handle escaped quotes in strings', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\n  x = "hello \\"end\\" world"\nend',
        Crystal: 'if true\n  x = "hello \\"end\\" world"\nend',
        Julia: 'if true\n  x = "hello \\"end\\" world"\nend',
        Lua: 'if true then\n  x = "hello \\"end\\" world"\nend',
        Bash: 'if true; then\n  x="hello \\"end\\" world"\nfi'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 1, `${name}: escaped quotes should not break string detection`);
        }
      }
    });
  });

  suite('Tab indentation', () => {
    test('should handle tab-indented blocks', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if true\n\t\tif false\n\t\tend\nend',
        Julia: 'if true\n\t\tif false\n\t\tend\nend',
        Lua: 'if true then\n\t\tif false then\n\t\tend\nend',
        Pascal: 'begin\n\t\tbegin\n\t\tend;\nend;'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.strictEqual(pairs.length, 2, `${name}: tab indentation should parse correctly`);
        }
      }
    });
  });

  suite('Stress: keywords in every position', () => {
    test('should handle keyword immediately after string', () => {
      const testCases: Record<string, string> = {
        Ruby: '"hello"if true\nend',
        Julia: '"hello"if true\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          // Should not crash regardless of result
          const pairs = parser.parse(testCases[name]);
          assert.ok(Array.isArray(pairs), `${name}: keyword after string should not crash`);
        }
      }
    });

    test('should handle keyword immediately before string', () => {
      const testCases: Record<string, string> = {
        Ruby: 'if"hello"\nend',
        Julia: 'if"hello"\nend'
      };
      for (const { name, parser } of parsers) {
        if (testCases[name]) {
          const pairs = parser.parse(testCases[name]);
          assert.ok(Array.isArray(pairs), `${name}: keyword before string should not crash`);
        }
      }
    });
  });

  suite('Special characters in source', () => {
    test('should handle backslash in source', () => {
      for (const { name, parser, simpleBlock } of parsers) {
        const source = `x = \\\n${simpleBlock}`;
        const pairs = parser.parse(source);
        assert.ok(Array.isArray(pairs), `${name}: backslash should not crash parser`);
      }
    });

    test('should handle regex-like content', () => {
      for (const { name, parser, simpleBlock } of parsers) {
        const source = `x = /if|end|begin/\n${simpleBlock}`;
        const pairs = parser.parse(source);
        assert.ok(Array.isArray(pairs), `${name}: regex-like content should not crash parser`);
      }
    });
  });

  suite('Language-specific edge cases', () => {
    test('Ruby: heredoc with keyword delimiter', () => {
      const parser = getParser(parsers, 'Ruby');
      const source = 'x = <<~END\n  if true\n  end\nEND\nif true\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Ruby: heredoc END should not match block end');
    });

    test('Ruby: percent literal with keywords', () => {
      const parser = getParser(parsers, 'Ruby');
      const source = 'x = %w[if end begin do]\nif true\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Ruby: keywords in %w[] should be ignored');
    });

    test('Crystal: macro with keywords', () => {
      const parser = getParser(parsers, 'Crystal');
      const source = '{% if true %}\nif true\nend\n{% end %}';
      const pairs = parser.parse(source);
      // Macro keywords should be in excluded regions
      assert.ok(pairs.length >= 1, 'Crystal: macro template should not break parsing');
    });

    test('Elixir: sigil with keywords', () => {
      const parser = getParser(parsers, 'Elixir');
      const source = 'x = ~r/if|end|do/\nif true do\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Elixir: keywords in sigil should be ignored');
    });

    test('Bash: parameter expansion with keywords', () => {
      const parser = getParser(parsers, 'Bash');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing bash parameter expansion
      const source = 'x="${if}"\nif true; then\n  echo "${done}"\nfi';
      const pairs = parser.parse(source);
      // biome-ignore lint/suspicious/noTemplateCurlyInString: testing bash parameter expansion
      assert.strictEqual(pairs.length, 1, 'Bash: keywords in ${} should be ignored');
    });

    test('Bash: heredoc with keywords', () => {
      const parser = getParser(parsers, 'Bash');
      const source = 'cat <<EOF\nif then fi done esac\nEOF\nif true; then\nfi';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Bash: keywords in heredoc should be ignored');
    });

    test('Julia: triple-quoted string with keywords', () => {
      const parser = getParser(parsers, 'Julia');
      const source = 'x = """\nif true\nend\n"""\nif true\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Julia: keywords in triple-quoted string should be ignored');
    });

    test('Julia: nested comment with keywords', () => {
      const parser = getParser(parsers, 'Julia');
      const source = '#= if #= end =# function =#\nif true\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Julia: keywords in nested comment should be ignored');
    });

    test('Lua: long string with keywords', () => {
      const parser = getParser(parsers, 'Lua');
      const source = 'x = [[\nif then end while for\n]]\nif true then\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Lua: keywords in [[ ]] should be ignored');
    });

    test('Lua: long comment with keywords', () => {
      const parser = getParser(parsers, 'Lua');
      const source = '--[[\nif then end while for\n]]\nif true then\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Lua: keywords in --[[ ]] should be ignored');
    });

    test('Fortran: continuation line edge cases', () => {
      const parser = getParser(parsers, 'Fortran');
      const source = 'if &\n  (.true.) &\n  then\n  x = 1\nend if';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Fortran: multi-line continuation should parse correctly');
    });

    test('Pascal: nested comments', () => {
      const parser = getParser(parsers, 'Pascal');
      // Pascal { } comments cannot nest, but (* *) also exists
      const source = '{ if begin end }\n(* if begin end *)\nbegin\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Pascal: keywords in both comment styles should be ignored');
    });

    test('VHDL: block comment (VHDL-2008)', () => {
      const parser = getParser(parsers, 'VHDL');
      const source = '/* if entity end */\nentity test is\nend entity;';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'VHDL: keywords in block comment should be ignored');
    });

    test('Verilog: preprocessor directives', () => {
      const parser = getParser(parsers, 'Verilog');
      const source = '`ifdef TEST\nmodule test;\nendmodule\n`endif';
      const pairs = parser.parse(source);
      assert.ok(pairs.length >= 1, 'Verilog: preprocessor should not break parsing');
    });

    test('Erlang: fun in spec context should not be block', () => {
      const parser = getParser(parsers, 'Erlang');
      const source = '-spec foo(fun(() -> ok)) -> ok.\nfoo(F) -> F().';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 0, 'Erlang: fun in spec should be excluded');
    });

    test('Ada: attribute tick before keyword', () => {
      const parser = getParser(parsers, 'Ada');
      const source = "X := T'if;\nif Y then\n  null;\nend if;";
      const pairs = parser.parse(source);
      // Should not count the T'if as a block open
      assert.ok(pairs.length >= 1, 'Ada: attribute tick should exclude keyword');
    });

    test('COBOL: keywords in columns 1-6 should be ignored', () => {
      const parser = getParser(parsers, 'COBOL');
      const source = "      * IF this is a comment\n       IF X = 1\n         DISPLAY 'HI'\n       END-IF";
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'COBOL: comment line should be ignored');
    });

    test('Octave: block comment with keywords', () => {
      const parser = getParser(parsers, 'Octave');
      const source = '%{\nif true\n  end\n%}\nif true\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'Octave: keywords in %{ %} should be ignored');
    });

    test('MATLAB: transpose operator vs string', () => {
      const parser = getParser(parsers, 'MATLAB');
      const source = "x = A'\nif true\n  y = 1;\nend";
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'MATLAB: transpose should not start string');
    });

    test('AppleScript: tell one-liner should not be block', () => {
      const parser = getParser(parsers, 'AppleScript');
      const source = 'tell application "Finder" to activate\ntell application "Finder"\nend tell';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'AppleScript: tell one-liner should be excluded');
    });

    test('AppleScript: if block with CRLF', () => {
      const parser = getParser(parsers, 'AppleScript');
      const source = 'if true then\r\n  return\r\nend if';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1, 'AppleScript: CRLF if block should parse');
    });
  });

  suite('Regression: token positions with unicode', () => {
    test('should calculate correct positions after multi-byte chars', () => {
      const parser = getParser(parsers, 'Ruby');
      const source = '# \u3042\u3044\u3046\nif true\n  x = "\u3048\u304a"\nend';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 1);
      // Verify positions are reasonable
      assert.ok(pairs[0].openKeyword.line >= 0, 'open keyword line should be >= 0');
      assert.ok(pairs[0].closeKeyword.line >= 0, 'close keyword line should be >= 0');
      assert.ok(pairs[0].openKeyword.line < pairs[0].closeKeyword.line, 'open should be before close');
    });
  });
});
