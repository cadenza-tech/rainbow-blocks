import * as assert from 'node:assert';
import { VerilogBlockParser } from '../../parsers/verilogParser';
import {
  assertBlockCount,
  assertIntermediates,
  assertNestLevel,
  assertNoBlocks,
  assertSingleBlock,
  assertTokenPosition,
  assertTokens,
  findBlock
} from '../helpers/parserTestHelpers';

suite('VerilogBlockParser Test Suite', () => {
  let parser: VerilogBlockParser;

  setup(() => {
    parser = new VerilogBlockParser();
  });

  suite('Simple blocks', () => {
    test('should parse module-endmodule block', () => {
      const source = `module counter;
  reg [7:0] count;
endmodule`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should parse function-endfunction block', () => {
      const source = `function [7:0] add;
  input [7:0] a, b;
  add = a + b;
endfunction`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    test('should parse task-endtask block', () => {
      const source = `task display_msg;
  input [8*10:1] msg;
  $display("%s", msg);
endtask`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'task', 'endtask');
    });

    test('should parse begin-end block', () => {
      const source = `begin
  a = 1;
  b = 2;
end`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should parse case-endcase block', () => {
      const source = `case (sel)
  2'b00: out = a;
  2'b01: out = b;
  default: out = 0;
endcase`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
    });

    test('should parse casez-endcase block', () => {
      const source = `casez (addr)
  4'b1???: out = high;
  default: out = low;
endcase`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'casez', 'endcase');
    });

    test('should parse casex-endcase block', () => {
      const source = `casex (data)
  4'b1xxx: out = match;
  default: out = nomatch;
endcase`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'casex', 'endcase');
    });

    test('should parse always block with begin-end', () => {
      const source = `always @(posedge clk) begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse initial block with begin-end', () => {
      const source = `initial begin
  a = 0;
  b = 0;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse generate-endgenerate block', () => {
      const source = `generate
  genvar i;
  for (i = 0; i < 4; i = i + 1) begin
    and gate(out[i], a[i], b[i]);
  end
endgenerate`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should parse fork-join block', () => {
      const source = `fork
  #10 a = 1;
  #20 b = 1;
join`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });

    test('should parse fork-join_any block', () => {
      const source = `fork
  task1();
  task2();
join_any`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join_any');
    });

    test('should parse fork-join_none block', () => {
      const source = `fork
  task1();
  task2();
join_none`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join_none');
    });

    test('should parse if block with begin-end', () => {
      const source = `if (condition) begin
  action();
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse for loop with begin-end', () => {
      const source = `for (i = 0; i < 10; i = i + 1) begin
  sum = sum + data[i];
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse while loop with begin-end', () => {
      const source = `while (count > 0) begin
  count = count - 1;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse repeat block with begin-end', () => {
      const source = `repeat (8) begin
  @(posedge clk);
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should parse forever block with begin-end', () => {
      const source = `forever begin
  #10 clk = ~clk;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Intermediate keywords', () => {
    test('should parse if-else with begin-end', () => {
      const source = `if (sel) begin
  out = a;
end else begin
  out = b;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });

    test('should parse case with default', () => {
      const source = `case (sel)
  2'b00: out = a;
  default: out = b;
endcase`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });
  });

  suite('Nested blocks', () => {
    test('should parse nested blocks with correct nest levels', () => {
      const source = `module test;
  always @(posedge clk) begin
    if (enable) begin
      data <= in;
    end
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
      assertNestLevel(pairs, 'module', 0);
    });

    test('should handle deeply nested structures', () => {
      const source = `module top;
  function calc;
    case (op)
      ADD: begin
        result = a + b;
      end
    endcase
  endfunction
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });
  });

  suite('Excluded regions - Comments', () => {
    test('should ignore keywords in single-line comments', () => {
      const source = `// module begin end endmodule
module test;
endmodule`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should ignore keywords in block comments', () => {
      const source = `/*
module fake;
  begin
  end
endmodule
*/
module real;
endmodule`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle comment at end of line', () => {
      const source = `module test; // end endmodule
  reg a;
endmodule`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle nested block comments (not supported in Verilog)', () => {
      const source = `/* outer /* inner */ still comment */
module test;
endmodule`;
      const pairs = parser.parse(source);
      // Verilog does not support nested comments
      // First */ ends the comment, "still comment */" is code
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Excluded regions - Strings', () => {
    test('should ignore keywords in strings', () => {
      const source = `module test;
  initial $display("begin end module endmodule");
endmodule`;
      const pairs = parser.parse(source);
      // Only module-endmodule pair; initial has no matching end
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle escaped quotes in strings', () => {
      const source = `module test;
  initial $display("say \\"begin\\"");
endmodule`;
      const pairs = parser.parse(source);
      // Only module-endmodule pair; initial has no matching end
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle escaped characters in strings', () => {
      const source = `module test;
  initial $display("line1\\nbegin\\nend");
endmodule`;
      const pairs = parser.parse(source);
      // Only module-endmodule pair; initial has no matching end
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Edge cases', () => {
    test('should handle empty source', () => {
      const pairs = parser.parse('');
      assertNoBlocks(pairs);
    });

    test('should handle source with no blocks', () => {
      const pairs = parser.parse('wire a, b, c;');
      assertNoBlocks(pairs);
    });

    test('should handle multiple modules', () => {
      const source = `module a;
endmodule

module b;
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle endmodule not matching begin', () => {
      const source = `module test;
  begin
    a = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      // begin-end pair and module-endmodule pair
      assertBlockCount(pairs, 2);
    });

    test('should handle end not matching module', () => {
      const source = `module test;
  always @* begin
    a = b;
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should handle complex real-world Verilog code', () => {
      const source = `module alu(
  input [7:0] a, b,
  input [1:0] op,
  output reg [7:0] result
);
  always @(*) begin
    case (op)
      2'b00: result = a + b;
      2'b01: result = a - b;
      2'b10: result = a & b;
      default: result = 8'b0;
    endcase
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 4);
    });

    test('should handle unterminated string', () => {
      const source = `module test;
  initial $display("unterminated
  begin
  end
endmodule`;
      const pairs = parser.parse(source);
      // String handling may vary
      assert.ok(pairs.length >= 1);
    });

    test('should handle unterminated string at end of file', () => {
      // Tests matchVerilogString reaching end of source
      const source = `$display("unterminated`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle unmatched compound end keyword', () => {
      // Tests findLastOpenerByType returning -1
      const source = `begin
  x = 1;
endmodule`;
      const pairs = parser.parse(source);
      // endmodule doesn't match begin, so begin stays unmatched
      assertNoBlocks(pairs);
    });

    test('should handle unterminated block comment', () => {
      const source = `/* unterminated comment
module test;
endmodule`;
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });
  });

  suite('Token positions', () => {
    test('should have correct line and column for tokens', () => {
      const source = `module test;
endmodule`;
      const pairs = parser.parse(source);
      assertTokenPosition(pairs[0].openKeyword, 0, 0);
      assertTokenPosition(pairs[0].closeKeyword, 1, 0);
    });

    test('should have correct positions for nested blocks', () => {
      const source = `module test;
  begin
    a = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      const beginPair = findBlock(pairs, 'begin');
      const modulePair = findBlock(pairs, 'module');
      assertTokenPosition(beginPair.openKeyword, 1, 2);
      assertTokenPosition(modulePair.openKeyword, 0, 0);
    });
  });

  suite('Test helper methods', () => {
    test('getTokens should return all tokens', () => {
      const source = `module test;
endmodule`;
      const tokens = parser.getTokens(source);
      assertTokens(tokens, [{ value: 'module' }, { value: 'endmodule' }]);
    });

    test('getExcludedRegions should return excluded regions', () => {
      const source = `// comment
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
