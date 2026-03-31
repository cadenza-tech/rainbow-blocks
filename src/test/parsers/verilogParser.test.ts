import * as assert from 'node:assert';
import { VerilogBlockParser } from '../../parsers/verilogParser';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests } from '../helpers/sharedTestGenerators';

suite('VerilogBlockParser Test Suite', () => {
  let parser: VerilogBlockParser;

  setup(() => {
    parser = new VerilogBlockParser();
  });

  const config: CommonTestConfig = {
    getParser: () => parser,
    noBlockSource: 'wire a, b, c;',
    tokenSource: 'module test;\nendmodule',
    expectedTokenValues: ['module', 'endmodule'],
    excludedSource: '// comment\n"string"',
    expectedRegionCount: 2,
    twoLineSource: 'module test;\nendmodule',
    nestedPositionSource: 'module test;\n  begin\n    a = 1;\n  end\nendmodule',
    nestedKeyword: 'begin',
    nestedLine: 1,
    nestedColumn: 2,
    singleLineCommentSource: '// module begin end endmodule\nmodule test;\nendmodule',
    commentBlockOpen: 'module',
    commentBlockClose: 'endmodule',
    doubleQuotedStringSource: 'module test;\n  initial $display("begin end module endmodule");\nendmodule',
    stringBlockOpen: 'module',
    stringBlockClose: 'endmodule'
  };

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

    test('should parse else if with begin-end', () => {
      const source = `if (a) begin
  out = 1;
end else if (b) begin
  out = 2;
end else begin
  out = 3;
end`;
      const pairs = parser.parse(source);
      // 3 begin-end pairs + if pair + else-if pair + else pair = 6
      assertBlockCount(pairs, 6);
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
    generateExcludedRegionTests(config);

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

    test('should handle backslash at end of line in string', () => {
      const source = `module test;
  initial $display("line\\
module fake");
endmodule`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle block comments inside define directive', () => {
      const pairs = parser.parse('`define MACRO /* multi-line\ncomment */ value\nmodule test;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle unterminated string inside attribute across newlines', () => {
      const pairs = parser.parse('(* attr = "abc\n" *) module test;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Edge cases', () => {
    generateEdgeCaseTests(config);

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

    test('should not leak string backslash into define continuation check', () => {
      const source = '`define X "test\\"\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should calculate correct nest levels when control and begin share close keyword', () => {
      const pairs = parser.parse('module test;\n  always @(posedge clk) begin\n    q <= d;\n  end\nendmodule');
      assertBlockCount(pairs, 3);
      const modulePair = findBlock(pairs, 'module');
      const alwaysPair = findBlock(pairs, 'always');
      const beginPair = findBlock(pairs, 'begin');
      assert.strictEqual(modulePair.nestLevel, 0);
      assert.strictEqual(alwaysPair.nestLevel, 1);
      assert.strictEqual(beginPair.nestLevel, 2);
    });

    test('should recognize always with @identifier sensitivity list', () => {
      const pairs = parser.parse('always @clk begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });
  });

  suite('SystemVerilog constructs', () => {
    test('should parse class-endclass block', () => {
      const source = `class MyClass;
  int x;
endclass`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should parse interface-endinterface block', () => {
      const source = `interface my_if;
  logic valid;
endinterface`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'endinterface');
    });

    test('should parse program-endprogram block', () => {
      const source = `program test;
  int x;
endprogram`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'program', 'endprogram');
    });

    test('should parse package-endpackage block', () => {
      const source = `package my_pkg;
  int a;
endpackage`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'package', 'endpackage');
    });

    test('should parse property-endproperty block', () => {
      const source = `property p1;
  @(posedge clk) a |-> b;
endproperty`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'property', 'endproperty');
    });

    test('should parse sequence-endsequence block', () => {
      const source = `sequence s1;
  a ##1 b;
endsequence`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'sequence', 'endsequence');
    });

    test('should parse checker-endchecker block', () => {
      const source = `checker c1;
  assert property(p1);
endchecker`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'checker', 'endchecker');
    });

    test('should parse clocking-endclocking block', () => {
      const source = `clocking cb @(posedge clk);
  output data;
endclocking`;
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'clocking', 'endclocking');
    });
  });

  suite('Coverage: isValidBlockOpen branches', () => {
    test('should handle control keyword without begin', () => {
      // Tests return false at end of isValidBlockOpen
      const source = 'always @(posedge clk) q <= d;';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle nested control keywords', () => {
      // Tests the control keyword lookahead matching another control keyword
      // always -> if -> begin chain: end closes begin + if + always (3 pairs)
      const source = `always @(posedge clk) if (enable) begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test('should skip excluded region in control keyword validation', () => {
      // Tests the excluded region skip in isValidBlockOpen
      const source = `always @(posedge clk) /* comment */ begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should return false for control keyword at end of source', () => {
      // Tests return false when source ends after control keyword
      const source = 'always';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should handle whitespace between @ and parentheses', () => {
      const source = `always @ (posedge clk) begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle nested parentheses in sensitivity list', () => {
      const source = `always @((a) or (b)) begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle nested parentheses in if condition', () => {
      // always -> if -> begin chain: end closes begin + if + always (3 pairs)
      const source = `always @(posedge clk) if ((a && b)) begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });
  });

  suite('SystemVerilog always variants', () => {
    test('should parse always_comb with begin/end', () => {
      const source = 'always_comb begin\n  y = a & b;\nend';
      const result = parser.parse(source);
      assert.ok(result.length >= 1);
      const alwaysPair = result.find((p) => p.openKeyword.value === 'always_comb');
      assert.ok(alwaysPair);
    });

    test('should parse always_ff with begin/end', () => {
      const source = 'always_ff @(posedge clk) begin\n  q <= d;\nend';
      const result = parser.parse(source);
      assert.ok(result.length >= 1);
      const alwaysPair = result.find((p) => p.openKeyword.value === 'always_ff');
      assert.ok(alwaysPair);
    });

    test('should parse always_latch with begin/end', () => {
      const source = 'always_latch begin\n  if (en) q <= d;\nend';
      const result = parser.parse(source);
      assert.ok(result.length >= 1);
      const alwaysPair = result.find((p) => p.openKeyword.value === 'always_latch');
      assert.ok(alwaysPair);
    });

    test('should not match always_comb without begin', () => {
      const source = 'always_comb\n  y = a & b;';
      const result = parser.parse(source);
      const alwaysPair = result.find((p) => p.openKeyword.value === 'always_comb');
      assert.strictEqual(alwaysPair, undefined);
    });
  });

  suite('Preprocessor directives', () => {
    test('should parse ifdef/endif as block pair', () => {
      const source = '`ifdef FEATURE\n  wire x;\n`endif';
      const result = parser.parse(source);
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ppPair);
      assert.strictEqual(ppPair.closeKeyword.value, '`endif');
    });

    test('should parse ifndef/endif as block pair', () => {
      const source = '`ifndef GUARD\n  `define GUARD\n`endif';
      const result = parser.parse(source);
      const ppPair = result.find((p) => p.openKeyword.value === '`ifndef');
      assert.ok(ppPair);
      assert.strictEqual(ppPair.closeKeyword.value, '`endif');
    });

    test('should handle ifdef with else', () => {
      const source = '`ifdef FEATURE\n  wire x;\n`else\n  wire y;\n`endif';
      const result = parser.parse(source);
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ppPair);
      assert.ok(ppPair.intermediates.length > 0);
      assert.strictEqual(ppPair.intermediates[0].value, '`else');
    });

    test('should handle ifdef with elsif', () => {
      const source = '`ifdef A\n  wire x;\n`elsif B\n  wire y;\n`endif';
      const result = parser.parse(source);
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ppPair);
      assert.ok(ppPair.intermediates.length > 0);
      assert.strictEqual(ppPair.intermediates[0].value, '`elsif');
    });

    test('should handle nested ifdef blocks', () => {
      const source = '`ifdef A\n  `ifdef B\n    wire x;\n  `endif\n`endif';
      const result = parser.parse(source);
      const ppPairs = result.filter((p) => p.openKeyword.value === '`ifdef');
      assert.strictEqual(ppPairs.length, 2);
    });

    test('should ignore preprocessor in comments', () => {
      const source = '// `ifdef FEATURE\nmodule m;\nendmodule';
      const result = parser.parse(source);
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.strictEqual(ppPair, undefined);
    });

    test('should not treat else in `else directive as control keyword', () => {
      const source = `\`ifdef FEATURE
  wire x;
\`else
  always @(posedge clk) begin
    q <= d;
  end
\`endif`;
      const result = parser.parse(source);
      // Should have: `ifdef-`endif pair, always-end pair, begin-end pair
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ppPair);
      // The else inside `else should NOT create its own else->end pair
      const elsePair = result.find((p) => p.openKeyword.value === 'else');
      assert.strictEqual(elsePair, undefined);
    });

    test('should not treat if in `ifdef as control keyword', () => {
      const source = `\`ifdef FEATURE
  always @(posedge clk) begin
    q <= d;
  end
\`endif`;
      const result = parser.parse(source);
      // `ifdef should be preprocessor, not treated as 'if' control keyword
      const ifPair = result.find((p) => p.openKeyword.value === 'if');
      assert.strictEqual(ifPair, undefined);
    });

    test('should still treat standalone else with begin as control keyword', () => {
      const source = `if (sel) begin
  out = a;
end else begin
  out = b;
end`;
      const result = parser.parse(source);
      // else + begin-end should be paired
      const elsePair = result.find((p) => p.openKeyword.value === 'else');
      assert.ok(elsePair);
    });

    test('should handle `else with begin on next line correctly', () => {
      const source = `\`ifdef A
  wire x;
\`else
  wire y;
\`endif`;
      const result = parser.parse(source);
      // Only `ifdef-`endif pair with `else as intermediate
      const ppPair = result.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ppPair);
      assert.ok(ppPair.intermediates.some((i) => i.value === '`else'));
    });
  });

  suite('Parenthesized excluded regions', () => {
    test('should skip comments inside sensitivity list parentheses', () => {
      const pairs = parser.parse('always @(posedge clk /* ) */) begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Control keyword chaining', () => {
    test('should not pair orphaned else with unrelated begin-end', () => {
      const source = `module test;
  always @(posedge clk)
    if (cond)
      a <= 1;
    else
      b <= 0;
  initial begin
    c = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      const modulePair = findBlock(pairs, 'module');
      assert.ok(modulePair);
      // else without begin should not be a block opener
      const elsePair = pairs.find((p) => p.openKeyword.value === 'else');
      assert.strictEqual(elsePair, undefined);
    });

    test('should handle if-else chain with begin correctly', () => {
      const source = `module test;
  always @(posedge clk)
    if (a) begin
      x <= 1;
    end else begin
      y <= 0;
    end
endmodule`;
      const pairs = parser.parse(source);
      const modulePair = findBlock(pairs, 'module');
      assert.ok(modulePair);
    });
  });

  suite('Chained control keywords before begin', () => {
    test('should pair always and if when chained before begin', () => {
      const source = `module test;
  always @(posedge clk) if (enable) begin
    q <= d;
  end
endmodule`;
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if should be paired');
      const beginPair = findBlock(pairs, 'begin');
      assert.ok(beginPair, 'begin should be paired');
    });

    test('should pair always_ff and if when chained before begin', () => {
      const source = `always_ff @(posedge clk) if (reset) begin
  q <= 0;
end`;
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always_ff');
      assert.ok(alwaysPair, 'always_ff should be paired');
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if should be paired');
      assertBlockCount(pairs, 3);
    });

    test('should pair always_comb and for when chained before begin', () => {
      const source = `always_comb for (i = 0; i < 4; i = i + 1) begin
  sum = sum + data[i];
end`;
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always_comb');
      assert.ok(alwaysPair, 'always_comb should be paired');
      const forPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forPair, 'for should be paired');
      assertBlockCount(pairs, 3);
    });

    test('should not consume non-control keyword in chain', () => {
      const source = `module test;
  if (cond) begin
    x = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      const modulePair = findBlock(pairs, 'module');
      assert.ok(modulePair, 'module should be paired with endmodule, not consumed by end');
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if should be paired');
    });

    test('should handle else-if chain with always before', () => {
      const source = `always @(posedge clk) if (a) begin
  x <= 1;
end else if (b) begin
  x <= 2;
end`;
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
    });
  });

  suite('Default clocking', () => {
    test('should not treat default without colon as blockMiddle', () => {
      const source = `module test;
  default clocking cb @(posedge clk);
  endclocking
endmodule`;
      const pairs = parser.parse(source);
      const modulePair = findBlock(pairs, 'module');
      assert.ok(modulePair);
      // default should not appear in intermediates of module
      const hasDefault = modulePair.intermediates.some((i) => i.value === 'default');
      assert.strictEqual(hasDefault, false, 'default should not be an intermediate');
    });
  });

  suite('CR-only line endings', () => {
    test('should parse with CR-only line endings', () => {
      const source = 'module test;\r  initial $display("begin");\rendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Test helper methods - language-specific', () => {
    test('getExcludedRegions should return block comment', () => {
      const source = `/* block
comment */`;
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
    });
  });

  suite('Parentheses with excluded regions', () => {
    // Covers lines 223-224: skipping excluded regions inside parentheses
    test('should skip comments inside parentheses when checking for begin', () => {
      const source = `module test;
  always @(posedge /* comment with ( inside */ clk) begin
    x <= 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired with end');
    });

    test('should skip strings inside parentheses when checking for begin', () => {
      const source = `module test;
  initial #(10, "string ( inside") begin
    $display("test");
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair, 'begin should be paired with end');
    });
  });

  // Covers lines 223-225: excluded region inside parentheses during condition scan
  suite('Excluded region in paren tracking', () => {
    test('should skip string inside parenthesized condition', () => {
      const source = `module test;
  if ("param") begin
    a = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'if');
      findBlock(pairs, 'begin');
    });

    test('should skip comment inside parenthesized condition', () => {
      const source = `module test;
  if (a /* comment */ && b) begin
    a = 1;
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      findBlock(pairs, 'if');
      findBlock(pairs, 'begin');
    });
  });

  // Fix: escaped identifiers should be excluded regions
  suite('Escaped identifiers', () => {
    test('should not match keywords inside escaped identifiers', () => {
      const source = 'module test;\n  wire \\begin ;\n  wire \\end ;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not match module inside escaped identifier', () => {
      const source = 'module test;\n  wire \\module ;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle escaped identifier with multiple keyword-like chars', () => {
      const source = 'module test;\n  wire \\begin_end_module ;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  // Fix: (* *) attributes should be excluded regions
  suite('SystemVerilog attributes', () => {
    test('should not match keywords inside (* *) attributes', () => {
      const source = '(* begin = 1, end = 0 *)\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle attribute before module declaration', () => {
      const source = '(* synthesis *)\nmodule test;\n  (* full_case *)\n  case (sel)\n    default: out = 0;\n  endcase\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'module');
      findBlock(pairs, 'case');
    });
  });

  suite('Bug fixes', () => {
    test('Bug 4: always @ (*) with whitespace should work correctly', () => {
      const source = `always @ (*) begin
  x = a;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 4: SystemVerilog attribute (* *) should be excluded region', () => {
      const source = `(* synthesis, full_case *)
module test;
  case (state)
    default: x = 0;
  endcase
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 4: @(*) without whitespace should still work', () => {
      const source = `always @(*) begin
  x = a;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 17: escaped identifier labels should be recognized', () => {
      const source = `always @(posedge clk) \\my_label : begin
  q <= d;
end`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('Bug 18: scope resolution :: should not be treated as label colon', () => {
      const source = 'class pkg::my_class;\nbegin\n  x = 1;\nend\nendclass';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const classPair = pairs.find((p) => p.openKeyword.value === 'class');
      assert.ok(classPair);
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair);
    });

    test('Bug 12: default with colon on next line should be recognized as middle keyword', () => {
      const pairs = parser.parse('case (sel)\n  0: x = a;\n  default\n  : x = b;\nendcase');
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });

    test('Bug 9: always should span entire if-else chain, not consumed by first end', () => {
      const source = 'always @(posedge clk)\n  if (cond) begin\n    a <= 1;\n  end else begin\n    a <= 0;\n  end';
      const pairs = parser.parse(source);
      // always should pair with the last end, not the first
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'should find always block');
      assert.strictEqual(alwaysPair.closeKeyword.startOffset, source.lastIndexOf('end'));
    });
  });

  suite('Edge case: @ followed by newline and (* *)', () => {
    test('should treat @\\n(* attr *) as sensitivity list, not attribute', () => {
      const source = 'always @\n(* attr *)\nbegin\n  q <= d;\nend';
      const pairs = parser.parse(source);
      // The (* attr *) should not be confused with sensitivity list
      // @\\n should skip the newline and see (* as attribute, treating it as excluded region
      // begin..end should still be parsed as a block
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair);
    });
  });

  suite('Uncovered line coverage', () => {
    // Covers line 236: skip whitespace after # in delay
    test('should handle # with whitespace before delay value', () => {
      const source = 'always # 10 begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    // Covers line 245: nested ( depth inside #(expr)
    test('should handle nested parentheses in # delay expression', () => {
      const source = 'always #(T/2 + (offset)) begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    // Covers lines 249-252: # followed by digit (number delay with time unit)
    test('should handle #number delay with time unit', () => {
      const source = 'always #10ns begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    test('should handle #number delay without time unit', () => {
      const source = 'always #10 begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    // Covers lines 253-255: # followed by identifier (parameter delay)
    test('should handle #identifier delay', () => {
      const source = 'always #HALF_PERIOD begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    // Covers lines 262-264: double-colon :: scope resolution rejects control keyword
    test('should reject control keyword before :: scope resolution', () => {
      const source = 'module test;\n  initial pkg::my_task();\nendmodule';
      const pairs = parser.parse(source);
      // initial before :: should not be treated as block opener
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    // Covers lines 273-276: escaped identifier label
    test('should handle escaped identifier label before begin', () => {
      const source = 'always @(posedge clk) \\my-label : begin\n  q <= d;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    // Covers lines 283-286: regular label followed by : consumed and scanning continues
    test('should handle regular label before begin', () => {
      const source = 'always @(posedge clk) my_label : begin\n  q <= d;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    test('should reject control keyword followed by non-label identifier then no begin', () => {
      // task foo; begin end endtask - foo is not a label (not followed by :), so if is invalid
      const source = 'task foo;\n  begin\n    x = 1;\n  end\nendtask';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'task');
      findBlock(pairs, 'begin');
    });

    // Covers lines 398-399: unterminated (* ... *) attribute
    test('should handle unterminated (* attribute at EOF', () => {
      const source = '(* synthesis keep\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      // The unterminated attribute should exclude everything to EOF
      assertNoBlocks(pairs);
    });

    test('should handle unterminated (* attribute with block keywords inside', () => {
      const source = '(* begin = 1, end = 0';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    // Additional: # with excluded region inside #(...)
    test('should handle excluded region inside # delay parentheses', () => {
      const source = 'always #(/* comment */ 10) begin\n  clk = ~clk;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: uncovered code paths', () => {
    test('should reject control keyword when :: scope resolution follows', () => {
      // Covers lines 262-264: double-colon :: scope resolution skip returns false
      const source = `module m;
  if (cond) :: begin
  end
endmodule`;
      const pairs = parser.parse(source);
      // 'if' is rejected (:: found), 'begin'/'end' is standalone, 'module'/'endmodule' is another
      assertBlockCount(pairs, 2);
      const modulePair = pairs.find((p) => p.openKeyword.value === 'module');
      assert.ok(modulePair);
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair);
    });

    test('should handle escaped identifier label before begin', () => {
      // Covers lines 273-276: escaped identifier \name in label detection
      // always + begin + module = 3 pairs (always and begin both close with same end)
      const source = `module m;
  always \\my_label : begin
  end
endmodule`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair);
    });

    test('should handle sensitivity list @identifier (implicit sensitivity, no parens)', () => {
      // Lines 331-332: skipSensitivityList returns i when neither ( nor * follows @
      // e.g., always @clk begin - where @clk has no parens
      // The identifier 'clk' after @ causes trySkipLabel to fail (no colon) → returns false
      // So only begin-end pair is created (always is rejected)
      const source = 'always @clk begin\n  q <= d;\nend';
      const pairs = parser.parse(source);
      assert.ok(Array.isArray(pairs));
      // begin/end pair is still parsed; always may or may not be paired
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair, 'should find begin block');
    });

    test('should handle delay with no numeric or identifier after # (lines 367-368)', () => {
      // skipDelayExpression: fallthrough return i when # followed by unexpected char
      // always #;begin - # followed by ; which is not (, digit, or letter
      const source = 'always #;begin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      // Result depends on parser behavior; mainly ensure no crash
      assert.ok(Array.isArray(pairs));
    });

    test('should handle escaped identifier label before begin with non-word chars in name', () => {
      // Lines 374-376: trySkipLabel escaped path: i++ then while not-whitespace loop
      const source = 'always \\label-with-hyphen : begin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });

    test('should handle #define directive with string literal in body (lines 543-556)', () => {
      // matchDefineDirective: string handling inside #define body
      const source = '`define MY_MSG "hello begin end world"\nbegin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle #define directive with string containing backslash escape', () => {
      // matchDefineDirective: backslash escape inside string in define body
      const source = '`define MSG "say \\"hello\\" and begin"\nbegin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not let backslash-newline inside define string skip past newline', () => {
      // Regression: matchDefineDirective string handler was doing i += 2 for backslash
      // followed by newline, jumping past the line boundary into the next line.
      // The backslash also triggers define line continuation, so the define extends.
      // With even backslashes (\\<LF>), define does NOT continue.
      const source = '`define X "test\\\\\n module m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not let backslash-CRLF inside define string skip past newline', () => {
      const source = '`define X "test\\\\\r\n module m;\r\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug 1: Backtick-prefixed non-control keywords', () => {
    test('should not treat `begin as block open', () => {
      const source = 'module test;\n  `begin\n  `end\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat `module as block open', () => {
      const source = '`module\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat `fork as block open', () => {
      const source = 'module test;\n  `fork\n  `join\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat `end as block close', () => {
      const source = 'begin\n  `end\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `endmodule as block close', () => {
      const source = 'module test;\n  `endmodule\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat `class as block open', () => {
      const source = '`class\nclass MyClass;\nendclass';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should not treat `endclass as block close', () => {
      const source = 'class MyClass;\n  `endclass\nendclass';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'endclass');
    });
  });

  suite('Bug 2: Dollar sign in identifiers', () => {
    test('should not treat $end as block close keyword', () => {
      const source = 'begin\n  $end;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat $fork as block open keyword', () => {
      const source = '$fork;\nfork\n  #10 a = 1;\njoin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });

    test('should not treat fork$sig as block open keyword', () => {
      const source = 'wire fork$sig;\nfork\n  #10 a = 1;\njoin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });

    test('should not treat end$suffix as block close keyword', () => {
      const source = 'begin\n  wire end$signal;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat $module as block open', () => {
      const source = '$module;\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat module$x as block open', () => {
      const source = 'wire module$x;\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug 3: `define macro content excluded', () => {
    test('should not tokenize keywords inside `define directive', () => {
      const source = '`define MY_MACRO module test; endmodule\nmodule real;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not tokenize begin/end inside `define', () => {
      const source = '`define BLOCK begin x = 1; end\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle `define with backslash continuation', () => {
      const source = '`define MY_MACRO \\\n  module test; \\\n  endmodule\nmodule real;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle `define with multiple continuation lines', () => {
      const source = '`define COMPLEX \\\n  begin \\\n  x = 1; \\\n  end\nbegin\n  y = 2;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should handle `define at end of file', () => {
      const source = 'module test;\nendmodule\n`define TAIL begin end';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle `define with CRLF continuation', () => {
      const source = '`define MY_MACRO \\\r\n  module test; \\\r\n  endmodule\r\nmodule real;\r\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle `define with CR-only continuation', () => {
      const source = '`define MY_MACRO \\\r  begin end\rmodule test;\rendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should exclude `define regions from excluded region list', () => {
      const source = '`define FOO fork join\nfork\n  #10 a = 1;\njoin';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      const defineRegion = regions.find((r) => source.slice(r.start, r.start + 7) === '`define');
      assert.ok(defineRegion, '`define should create an excluded region');
    });
  });

  suite('Bug 9: `define backslash count', () => {
    test('should not continue `define when line ends with even backslashes (escaped backslash)', () => {
      const source = '`define MY_MACRO value\\\\\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should continue `define when line ends with odd backslashes', () => {
      const source = '`define MY_MACRO \\\n  module test; \\\n  endmodule\nmodule real;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not continue `define when line ends with four backslashes', () => {
      const source = '`define MY_MACRO value\\\\\\\\\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should continue `define when line ends with three backslashes', () => {
      const source = '`define MY_MACRO \\\\\\\n  module extra;\n  endmodule\nmodule real;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle even backslashes with CRLF', () => {
      const source = '`define MY_MACRO value\\\\\r\nmodule test;\r\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle even backslashes with CR-only', () => {
      const source = '`define MY_MACRO value\\\\\rmodule test;\rendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug 4: disable fork statement', () => {
    test('should not treat fork in "disable fork" as block open', () => {
      const source = 'module test;\n  disable fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "disable  fork" (extra space) as block open', () => {
      const source = 'module test;\n  disable  fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "disable\\tfork" as block open', () => {
      const source = 'module test;\n  disable\tfork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should still treat standalone fork as block open', () => {
      const source = 'fork\n  #10 a = 1;\njoin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });

    test('should not confuse x_disable with disable', () => {
      // x_disable is an identifier, not the keyword "disable"
      const source = 'x_disable fork\n  #10 a = 1;\njoin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });
  });

  suite('Bug 5: wait fork statement', () => {
    test('should not treat fork in "wait fork" as block open', () => {
      const source = 'module test;\n  wait fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "wait  fork" (extra space) as block open', () => {
      const source = 'module test;\n  wait  fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not confuse x_wait with wait', () => {
      // x_wait is an identifier, not the keyword "wait"
      const source = 'x_wait fork\n  #10 a = 1;\njoin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'fork', 'join');
    });
  });

  suite('Regression: isValidForkOpen line boundaries', () => {
    test('should not let disable on previous line suppress fork', () => {
      const pairs = parser.parse('module m;\n  disable\n  fork\n    #10 a = 1;\n  join\nendmodule');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'module');
      findBlock(pairs, 'fork');
    });
  });

  suite('Bug 6: backtick-prefixed `default not rejected as block_middle', () => {
    test('should not treat `default as block_middle in case block', () => {
      const source = 'case (sel)\n  1: a = 1;\n  `default: a = 0;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], []);
    });

    test('should still treat default: as block_middle in case block', () => {
      const source = 'case (sel)\n  1: a = 1;\n  default: a = 0;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });
  });

  suite('Bug 7: disable/wait + comment/newline + fork not rejected', () => {
    test('should not treat fork in "disable /* comment */ fork" as block open', () => {
      const source = 'module test;\n  disable /* comment */ fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "disable\\nfork" as block open', () => {
      const source = 'module test;\n  disable\n  fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "wait // comment\\nfork" as block open', () => {
      const source = 'module test;\n  wait // comment\n  fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork in "disable\\r\\nfork" (CRLF) as block open', () => {
      const source = 'module test;\r\n  disable\r\n  fork;\r\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug 10: dot-preceded keywords', () => {
    test('.begin(signal) in port connection should not be block open', () => {
      const source = 'module test(\n  .begin(sig_begin)\n);\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('inst.end hierarchical reference should not be block close', () => {
      const source = 'module test;\n  wire x = inst.end;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('.module(value) in port connection should not be block open', () => {
      const source = 'module top;\n  sub u1(\n    .module(val)\n  );\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('.endmodule should not be block close', () => {
      const source = 'module test;\n  wire x = inst.endmodule;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('.fork in port connection should not be block open', () => {
      const source = 'module test(\n  .fork(sig)\n);\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug 8: `undef directive not excluded', () => {
    test('should not tokenize keywords after `undef', () => {
      const source = '`undef module\nmodule real;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not tokenize begin/end after `undef', () => {
      const source = '`undef begin\nbegin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should exclude `undef regions from excluded region list', () => {
      const source = '`undef fork\nfork\n  #10 a = 1;\njoin';
      const regions = parser.getExcludedRegions(source);
      assert.ok(regions.length >= 1);
      const undefRegion = regions.find((r) => source.slice(r.start, r.start + 6) === '`undef');
      assert.ok(undefRegion, '`undef should create an excluded region');
    });

    test('should handle `undef at end of file', () => {
      const source = 'module test;\nendmodule\n`undef begin';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug: default keyword filtered when comment before colon', () => {
    test('should recognize default when block comment appears before colon', () => {
      const source = 'case (sel)\n  default /* comment */ : out = b;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });

    test('should recognize default when line comment appears before colon on next line', () => {
      const source = 'case (sel)\n  default // comment\n    : out = b;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });
  });

  suite('Regression: `define/`undef word boundary', () => {
    test('should not treat `defined macro as `define directive', () => {
      const source = '`defined(FEATURE) begin\n  assign a = b;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `define_WIDTH macro as `define directive', () => {
      const source = '`define_WIDTH begin\n  assign a = b;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat `undefine macro as `undef directive', () => {
      const source = '`undefine(OLD) begin\n  assign a = b;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should still exclude real `define directive', () => {
      const source = '`define FOO begin\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: attribute with @ in preceding comment/string', () => {
    test('should treat (* *) as attribute when @ is inside preceding comment', () => {
      const source = '// @\n(* synthesis, keep *) module m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should treat (* *) as attribute when @ is inside preceding string', () => {
      const source = 'wire x = "@";\n(* full_case *) case (sel)\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
    });

    test('should still treat @(*) as sensitivity list not attribute', () => {
      const source = 'always @(*) begin\n  a = b;\nend';
      const pairs = parser.parse(source);
      // always + begin both paired with end (Verilog matchBlocks chains control keywords)
      assertBlockCount(pairs, 2);
      const beginBlock = findBlock(pairs, 'begin');
      assert.ok(beginBlock, 'begin block should exist');
    });

    test('should still treat @ (*) with whitespace as sensitivity list', () => {
      const source = 'always @ (*) begin\n  a = b;\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const beginBlock = findBlock(pairs, 'begin');
      assert.ok(beginBlock, 'begin block should exist');
    });
  });

  suite('Regression: attribute with string containing *)', () => {
    test('should handle string with *) inside attribute', () => {
      const source = '(* message = "test*)" *)\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle escaped quote in string inside attribute', () => {
      const source = '(* msg = "a\\"*)" *)\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: preprocessor middle directives target correct block', () => {
    test('should attach `else to `ifdef block, not begin block', () => {
      const source = '`ifdef FEATURE\nbegin\n  a <= 1;\n`else\n  a <= 2;\nend\n`endif';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const ifdefBlock = findBlock(pairs, '`ifdef');
      assert.ok(ifdefBlock.intermediates.some((t) => t.value === '`else'));
      const beginBlock = findBlock(pairs, 'begin');
      assert.strictEqual(beginBlock.intermediates.length, 0);
    });

    test('should attach default to case block, not surrounding begin', () => {
      const source = "begin\n  case (sel)\n    2'b00: a = 1;\n    default: a = 0;\n  endcase\nend";
      const pairs = parser.parse(source);
      const caseBlock = findBlock(pairs, 'case');
      assert.ok(caseBlock.intermediates.some((t) => t.value === 'default'));
      const beginBlock = findBlock(pairs, 'begin');
      assert.strictEqual(beginBlock.intermediates.length, 0);
    });
  });

  suite('Regression: attribute string scan newline termination', () => {
    test('should detect module/endmodule when attribute string is unterminated before newline', () => {
      const source = '(* attr = "unterminated\n*) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should detect module/endmodule when attribute has a properly terminated string', () => {
      const source = '(* attr = "proper string" *) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat cross-line identifier-colon as label in trySkipLabel', () => {
      // identifier on one line and colon on next should not be matched as a label
      const source = 'always @(posedge clk)\n  begin\n    x <= 1;\n  end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const beginEnd = findBlock(pairs, 'begin');
      assert.strictEqual(beginEnd.closeKeyword.value, 'end');
    });
  });

  suite('Branch coverage', () => {
    test('should skip escaped identifier label in trySkipLabel', () => {
      // Covers lines 374-376: escaped identifier label like \my_label: before begin
      const source = 'always @(posedge clk)\n  \\my_label: begin\n    x <= 1;\n  end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });

    test('should skip escaped identifier label with special characters', () => {
      // Covers lines 374-376: escaped identifier with special chars terminated by whitespace
      const source = 'always @(posedge clk)\n  \\label+name : begin\n    x <= 1;\n  end';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
    });
  });

  suite('Regression: matchAttribute string escape with newline', () => {
    test('should terminate string at backslash-newline inside attribute', () => {
      const source = '(* attr = "test\\\n*) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: matchVerilogString backslash-newline excluded region', () => {
    test('should include backslash in excluded region when followed by newline', () => {
      const source = '"test\\\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should include backslash in excluded region when followed by CR-LF', () => {
      const source = '"test\\\r\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: delay expression with exponent notation', () => {
    test('should handle delay expression with exponent notation', () => {
      const pairs = parser.parse('always #1.5e-3 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
    });

    test('should handle delay expression with uppercase exponent', () => {
      const pairs = parser.parse('always #2.0E+6 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
    });

    test('should handle delay expression with exponent without sign', () => {
      const pairs = parser.parse('always #1e3 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Coverage: matchAttribute string terminated by CRLF with stray quote', () => {
    test('should handle attribute string terminated by CRLF newline', () => {
      // Lines 71-72: string inside attribute terminated by \r\n (CRLF)
      const source = '(* attr = "unterminated\r\n*) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle attribute string terminated by CRLF with stray closing quote', () => {
      // Lines 72, 76-78: string terminated by CRLF, then whitespace, then stray closing quote
      // After CRLF, the code skips whitespace and checks for stray "
      const source = '(* attr = "unterminated\r\n  " *) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle attribute string terminated by LF with stray closing quote after spaces', () => {
      // Lines 74-78: string terminated by LF (not CRLF), skip whitespace, stray "
      const source = '(* attr = "unterminated\n\t" *) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle attribute string terminated by LF without stray closing quote', () => {
      // Lines 74-78: string terminated by LF, whitespace but no stray quote
      const source = '(* attr = "unterminated\n*) module test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Coverage: matchDefineDirective backslash-newline inside string literal', () => {
    test('should end define at backslash-newline inside string literal', () => {
      // Lines 130-134: backslash before newline inside string in define body
      // The string is unterminated; define ends at the backslash position
      const source = '`define MSG "hello\\\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should end define at backslash-CR inside string literal', () => {
      // Lines 129-133: backslash before \r inside string in define body
      const source = '`define MSG "hello\\\rmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Coverage: matchUndefDirective single-line matching', () => {
    test('should exclude undef directive content up to end of line', () => {
      // Lines 197-199: matchUndefDirective scans from pos+6 to newline
      const source = '`undef MY_MACRO\nmodule test;\nendmodule';
      const regions = parser.getExcludedRegions(source);
      const undefRegion = regions.find((r) => source.slice(r.start, r.start + 6) === '`undef');
      assert.ok(undefRegion, '`undef should create an excluded region');
      assert.strictEqual(undefRegion.start, 0);
      // Region should end at the newline (pos 15), not include it
      assert.strictEqual(undefRegion.end, 15);
    });

    test('should handle undef with CR-only line ending', () => {
      // Lines 197-199: matchUndefDirective stops at \r
      const source = '`undef FOO\rmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle undef at end of file without newline', () => {
      // Lines 197-199: matchUndefDirective reaches end of source
      const source = 'module test;\nendmodule\n`undef TAIL_MACRO';
      const regions = parser.getExcludedRegions(source);
      const undefRegion = regions.find((r) => source.slice(r.start, r.start + 6) === '`undef');
      assert.ok(undefRegion, '`undef should create an excluded region');
      assert.strictEqual(undefRegion.end, source.length);
    });
  });

  suite('Coverage: trySkipLabel escaped identifier reaching EOF', () => {
    test('should handle escaped identifier label at end of source without whitespace', () => {
      // Covers verilogHelpers.ts lines 197-199: trySkipLabel escaped path
      // where the while loop exits because i reaches source.length
      const source = 'always \\label_at_eof';
      const pairs = parser.parse(source);
      // always cannot find begin after the escaped identifier, so it is rejected
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: skipDelayExpression with base specifiers', () => {
    test('should pair always with end when delay uses sized base-specifier literal', () => {
      const pairs = parser.parse("always #32'd0 begin\n  x = 1;\nend");
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });

    test('should pair always with end when delay uses unsized base-specifier literal', () => {
      const pairs = parser.parse("always #'hFF begin\n  x = 1;\nend");
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
    });
  });

  suite('Regression: skipDelayExpression with backtick-prefixed macro', () => {
    test('should handle delay expression with backtick-prefixed macro identifier', () => {
      // Bug: skipDelayExpression did not handle backtick-prefixed macro identifiers
      // like `CLK_PERIOD, causing "begin" after the delay to not be detected
      const pairs = parser.parse('always #`CLK_PERIOD begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'always');
    });

    test('should handle delay expression with backtick-prefixed macro in parentheses', () => {
      const pairs = parser.parse('always #`(CLK_PERIOD/2) begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'always');
    });
  });

  suite('Coverage: default intermediate skipping non-case blocks', () => {
    test('should not attach default to begin block when no case block exists', () => {
      // Covers verilogParser.ts lines 489-490: default found as middle keyword
      // but the opener is begin (not case/casex/casez), so continue skips it
      const source = 'begin\n  default: x = 1;\nend';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'default should not attach to begin block');
    });

    test('should not attach default to module block when no case block exists', () => {
      // Covers verilogParser.ts lines 489-490: default scans stack but finds
      // only module (not case), so continues and exhausts all openers
      const source = 'module test;\n  default: x = 1;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
      assert.strictEqual(pairs[0].intermediates.length, 0, 'default should not attach to module block');
    });
  });

  suite('Regression: matchAttribute comment skip', () => {
    test('should not close attribute prematurely when block comment appears inside', () => {
      const source = '(* /* *) */ attr = 1 *)\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug: preprocessor directives between end and else break control keyword chaining', () => {
    test('should not consume always when ifdef/endif appears between end and else', () => {
      const source = 'always @(posedge clk) if (a) begin\n  x <= 1;\nend\n`ifdef DEBUG\n`endif\nelse begin\n  y <= 2;\nend';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
      // always should be paired with the LAST end (after else begin...end), not the first
      assert.strictEqual(alwaysPair.closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should not consume always when ifdef with content appears between end and else', () => {
      const source = [
        'always @(posedge clk)',
        '  if (a) begin',
        '    x <= 1;',
        '  end',
        '  `ifdef DEBUG',
        '    // debug code',
        '  `endif',
        '  else begin',
        '    y <= 2;',
        '  end'
      ].join('\n');
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
      assert.strictEqual(alwaysPair.closeKeyword.startOffset, source.lastIndexOf('end'));
    });

    test('should not consume always when multiple ifdefs appear between end and else', () => {
      const source = 'always @(posedge clk) if (a) begin\n  x <= 1;\nend `ifdef A wire a; `endif `ifdef B wire b; `endif else begin\n  y <= 2;\nend';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
      assert.strictEqual(alwaysPair.closeKeyword.startOffset, source.lastIndexOf('end'));
    });
  });

  suite('Preprocessor directives between control keyword and begin', () => {
    test('should pair always with end when ifdef/endif appear before begin', () => {
      const source = 'always @(posedge clk) `ifdef DEBUG `endif begin\n  q <= d;\nend';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired');
    });

    test('should pair initial with end when macro appears before begin', () => {
      const source = 'initial `MY_MACRO begin\n  x = 1;\nend';
      const pairs = parser.parse(source);
      const initialPair = pairs.find((p) => p.openKeyword.value === 'initial');
      assert.ok(initialPair, 'initial should be paired');
    });

    test('should pair if with end when ifndef/endif appear before begin', () => {
      const source = 'if (cond) `ifndef X `endif begin\n  y = 1;\nend';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if should be paired');
    });
  });

  suite('Regression: unterminated block comment in define', () => {
    test('should not extend excluded region past define boundary for unterminated block comment', () => {
      const source = '`define MACRO /* unterminated\nmodule test;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: control keyword with ifdef wrapping begin', () => {
    test('should pair always with end when ifdef wraps begin-end', () => {
      const source = 'always @(posedge clk)\n`ifdef DEBUG\nbegin\n  q <= d;\nend\n`endif';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const alwaysPair = findBlock(pairs, 'always');
      assert.strictEqual(alwaysPair.closeKeyword.value, 'end');
    });

    test('should pair initial with end when ifndef wraps begin-end', () => {
      const source = 'initial\n`ifndef SYNTH\nbegin\n  q <= 0;\nend\n`endif';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const initialPair = findBlock(pairs, 'initial');
      assert.strictEqual(initialPair.closeKeyword.value, 'end');
    });
  });

  suite('Regression: single-line comment in define directive', () => {
    test('should not treat backslash in // comment as line continuation', () => {
      const pairs = parser.parse('`define MACRO value // comment \\\nmodule test;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should handle // comment in define with CRLF', () => {
      const pairs = parser.parse('`define MACRO value // comment \\\r\nmodule test;\r\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should still support line continuation without // comment', () => {
      const pairs = parser.parse('`define MACRO value \\\nmodule test;\nendmodule');
      assertNoBlocks(pairs);
    });
  });

  suite('Preprocessor directive argument filtering', () => {
    test('should not tokenize keyword used as ifdef macro name', () => {
      const pairs = parser.parse('module top;\n  `ifdef end\n    wire x;\n  `endif\nendmodule');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'module');
      findBlock(pairs, '`ifdef');
    });

    test('should not tokenize keyword used as ifndef macro name', () => {
      const pairs = parser.parse('module top;\n  `ifndef module\n    wire x;\n  `endif\nendmodule');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'module');
      findBlock(pairs, '`ifndef');
    });

    test('should not tokenize keyword used as elsif macro name', () => {
      const pairs = parser.parse('`ifdef FOO\n  wire a;\n`elsif begin\n  wire b;\n`endif');
      assertBlockCount(pairs, 1);
      findBlock(pairs, '`ifdef');
    });
  });

  suite('Additional Verilog/SystemVerilog keyword pairs', () => {
    test('should detect covergroup/endgroup pair', () => {
      const pairs = parser.parse('covergroup cg;\n  coverpoint a;\nendgroup');
      assertSingleBlock(pairs, 'covergroup', 'endgroup');
    });

    test('should detect specify/endspecify pair', () => {
      const pairs = parser.parse('specify\n  (A => Z) = 1;\nendspecify');
      assertSingleBlock(pairs, 'specify', 'endspecify');
    });

    test('should detect primitive/endprimitive pair', () => {
      const pairs = parser.parse('primitive mux(out, a, b, sel);\n  output out;\nendprimitive');
      assertSingleBlock(pairs, 'primitive', 'endprimitive');
    });

    test('should detect table/endtable pair', () => {
      const pairs = parser.parse('table\n  0 0 : 0;\nendtable');
      assertSingleBlock(pairs, 'table', 'endtable');
    });

    test('should detect macromodule/endmodule pair', () => {
      const pairs = parser.parse('macromodule test;\n  wire a;\nendmodule');
      assertSingleBlock(pairs, 'macromodule', 'endmodule');
    });

    test('should detect config/endconfig pair', () => {
      const pairs = parser.parse('config cfg;\n  design top;\nendconfig');
      assertSingleBlock(pairs, 'config', 'endconfig');
    });

    test('should detect randcase/endcase pair', () => {
      const pairs = parser.parse('randcase\n  50: x = 1;\nendcase');
      assertSingleBlock(pairs, 'randcase', 'endcase');
    });
  });

  suite('Bug: chain consumption does not skip preprocessor directives on stack', () => {
    test('should pair always when `ifdef appears between always and if on stack', () => {
      // Bug: after closing if (control keyword), the chain consumption loop at matchBlocks
      // checks stack.top for CONTROL_KEYWORDS but encounters `ifdef, which blocks the chain
      // from reaching the always keyword below it on the stack.
      const source = 'always @(posedge clk)\n`ifdef A\nif (x) begin\n  y <= 1;\nend\n`endif';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should be paired with end');
    });

    test('should pair initial when `ifdef appears between initial and if on stack', () => {
      const source = 'initial\n`ifdef A\nif (x) begin\n  y <= 1;\nend\n`endif';
      const pairs = parser.parse(source);
      const initialPair = pairs.find((p) => p.openKeyword.value === 'initial');
      assert.ok(initialPair, 'initial should be paired with end');
    });

    test('should pair always_ff when `ifdef appears between always_ff and if on stack', () => {
      const source = 'always_ff @(posedge clk)\n`ifdef A\nif (rst) begin\n  y <= 0;\nend\n`endif';
      const pairs = parser.parse(source);
      const alwaysFFPair = pairs.find((p) => p.openKeyword.value === 'always_ff');
      assert.ok(alwaysFFPair, 'always_ff should be paired with end');
    });
  });

  suite('Bug: elseIndex check does not skip preprocessor directives on stack', () => {
    test('should find else past `ifdef when closing if+begin', () => {
      // Bug: after closing if (control keyword), elseIndex = controlIndex - 1 points
      // to `ifdef instead of else. The else keyword below `ifdef is not found.
      const source = 'if (a) begin\n  x = 1;\nend else\n`ifdef X\nif (b) begin\n  y = 2;\nend\n`endif';
      const pairs = parser.parse(source);
      const elsePair = pairs.find((p) => p.openKeyword.value === 'else');
      assert.ok(elsePair, 'else should be paired with end');
    });
  });

  suite('Bug: default with :: scope resolution falsely treated as case label', () => {
    test('should not treat default:: as case label intermediate', () => {
      // Bug: the default filter checks if ":" follows but does not distinguish
      // single ":" (case label) from "::" (scope resolution operator).
      const source = 'case (sel)\n  1: x = default::method();\n  default: y = 0;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'case', 'endcase');
      // Only the real "default:" at case level should be an intermediate,
      // not the "default::" scope resolution in the expression
      assertIntermediates(pairs[0], ['default']);
    });
  });

  suite('Bug: final keyword missing from control keywords', () => {
    test('should parse final begin...end as two block pairs', () => {
      const source = 'final begin\n  $display("done");\nend';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const finalPair = findBlock(pairs, 'final');
      assert.strictEqual(finalPair.closeKeyword.value, 'end');
      const beginPair = findBlock(pairs, 'begin');
      assert.strictEqual(beginPair.closeKeyword.value, 'end');
    });

    test('should parse final block nested in module', () => {
      const source = 'module test;\n  final begin\n    $display("done");\n  end\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assertNestLevel(pairs, 'final', 1);
      assertNestLevel(pairs, 'begin', 2);
    });
  });

  suite('Bug: randcase does not support default as intermediate', () => {
    test('should attach default as intermediate to randcase', () => {
      const source = 'randcase\n  50: x = 1;\n  default: x = 0;\nendcase';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'randcase', 'endcase');
      assertIntermediates(pairs[0], ['default']);
    });

    test('should not misattribute default to outer case when inside randcase', () => {
      const source = 'case (sel)\n  1: begin\n    randcase\n      50: x = 1;\n      default: x = 0;\n    endcase\n  end\n  default: y = 0;\nendcase';
      const pairs = parser.parse(source);
      const casePair = pairs.find((p) => p.openKeyword.value === 'case');
      assert.ok(casePair, 'case block should exist');
      assertIntermediates(casePair, ['default']);
      const randcasePair = findBlock(pairs, 'randcase');
      assertIntermediates(randcasePair, ['default']);
    });
  });

  suite('Regression: assert property false positive', () => {
    test('should not detect property in assert property as block open', () => {
      const tokens = parser.getTokens('assert property (@(posedge clk) a |-> b);');
      assert.strictEqual(tokens.length, 0);
    });

    test('should not detect property in assume/cover/expect property', () => {
      const tokens = parser.getTokens('assume property (p1);\ncover property (p2);');
      assert.strictEqual(tokens.length, 0);
    });
  });

  suite('Regression: assertion verbs restrict and cover sequence', () => {
    test('should not treat restrict property as block open', () => {
      const pairs = parser.parse('restrict property (@(posedge clk) a |-> b);');
      assertNoBlocks(pairs);
    });

    test('should not treat cover sequence as block open', () => {
      const pairs = parser.parse('cover sequence (s1);');
      assertNoBlocks(pairs);
    });

    test('should handle assertion verb on separate line from property', () => {
      const pairs = parser.parse('assert\nproperty (p1);');
      assertNoBlocks(pairs);
    });

    test('should handle assertion verb with comment before property', () => {
      const pairs = parser.parse('assert /* check */ property (p1);');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: block labels should not open nested blocks', () => {
    test('should not treat keyword after label colon as block open', () => {
      const pairs = parser.parse('begin : module\n  x = 1;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should not treat keyword after label colon in fork as block open', () => {
      const pairs = parser.parse('fork : begin\n  x = 1;\njoin');
      assertSingleBlock(pairs, 'fork', 'join');
    });

    test('should allow scope resolution :: (not label colon)', () => {
      const pairs = parser.parse('module m;\n  pkg::begin x = 1;\nendmodule');
      // begin after :: should still be detected (it's scope resolution, not a label)
      // The module-endmodule pair should exist
      assertBlockCount(pairs, 1);
      findBlock(pairs, 'module');
    });
  });

  suite('Regression: virtual interface false block_open', () => {
    test('should not pair virtual interface with endinterface meant for real interface', () => {
      const pairs = parser.parse('module m;\n  virtual interface my_if vif;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: bare tick fill literals in delay', () => {
    test('should pair always with end when delay uses bare tick 1 literal', () => {
      const pairs = parser.parse("always #'1 begin\n  x = 1;\nend");
      assertBlockCount(pairs, 2);
    });

    test('should pair always with end when delay uses bare tick 0 literal', () => {
      const pairs = parser.parse("always #'0 begin\n  x = 1;\nend");
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression tests', () => {
    test('should skip end after scope resolution operator', () => {
      const pairs = parser.parse('begin\n  x = pkg::end;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should skip begin after scope resolution operator', () => {
      const pairs = parser.parse('module m;\n  always @(*) begin\n    x = pkg::begin;\n  end\nendmodule');
      assertBlockCount(pairs, 3);
    });

    test('should skip endmodule after scope resolution operator', () => {
      const pairs = parser.parse('module m;\n  x = pkg::endmodule;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should skip endcase after scope resolution operator', () => {
      const pairs = parser.parse('case (sel)\n  1: x = pkg::endcase;\n  default: y = 0;\nendcase');
      assertSingleBlock(pairs, 'case', 'endcase');
    });
  });

  suite('Regression: virtual class, function, task', () => {
    test('should parse virtual class as block (abstract class definition)', () => {
      const pairs = parser.parse('virtual class MyClass;\n  int x;\nendclass');
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should still reject typedef class (forward declaration)', () => {
      const pairs = parser.parse('module m;\n  typedef class MyClass;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should parse virtual function as block (has body)', () => {
      const pairs = parser.parse('class C;\n  virtual function void f();\n    x = 1;\n  endfunction\nendclass');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'function');
      findBlock(pairs, 'class');
    });

    test('should parse virtual task as block (has body)', () => {
      const pairs = parser.parse('class C;\n  virtual task t();\n    x = 1;\n  endtask\nendclass');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'task');
      findBlock(pairs, 'class');
    });

    test('should reject pure virtual function (no body)', () => {
      const pairs = parser.parse('class C;\n  pure virtual function void f();\nendclass');
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should reject pure virtual task (no body)', () => {
      const pairs = parser.parse('class C;\n  pure virtual task t();\nendclass');
      assertSingleBlock(pairs, 'class', 'endclass');
    });
  });

  suite('Regression: DPI import/export declarations', () => {
    test('should not tokenize function in DPI import as block open', () => {
      const tokens = parser.getTokens('import "DPI-C" function void c_func();');
      assert.ok(!tokens.some((t) => t.value === 'function'), 'DPI import function should not produce a token');
    });

    test('should not tokenize task in DPI import as block open', () => {
      const tokens = parser.getTokens('import "DPI-C" task c_task();');
      assert.ok(!tokens.some((t) => t.value === 'task'), 'DPI import task should not produce a token');
    });

    test('should not tokenize function in DPI export as block open', () => {
      const tokens = parser.getTokens('export "DPI-C" function sv_func;');
      assert.ok(!tokens.some((t) => t.value === 'function'), 'DPI export function should not produce a token');
    });

    test('should still parse normal function inside module', () => {
      const pairs = parser.parse('module m;\n  function void f();\n    x = 1;\n  endfunction\nendmodule');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'function');
    });
  });

  suite('Regression: interface in port declarations', () => {
    test('should not tokenize interface as block open inside port list', () => {
      const tokens = parser.getTokens('module test(interface bus);\nendmodule');
      assert.ok(!tokens.some((t) => t.value === 'interface'), 'interface in port list should not produce a token');
    });

    test('should not tokenize interface in multi-port list', () => {
      const tokens = parser.getTokens('module test(\n  input clk,\n  interface bus,\n  output valid\n);\nendmodule');
      assert.ok(!tokens.some((t) => t.value === 'interface'), 'interface in multi-port list should not produce a token');
    });

    test('should still parse standalone interface block', () => {
      const pairs = parser.parse('interface my_if;\n  logic valid;\nendinterface');
      assertSingleBlock(pairs, 'interface', 'endinterface');
    });
  });

  suite('Regression: label colon check with comments', () => {
    test('should reject module after label colon with block comment', () => {
      const pairs = parser.parse('begin /* comment */ : module\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should reject begin after label colon with block comment on end keyword', () => {
      const pairs = parser.parse('begin : label\n  fork /* comment */ : begin\n    x = 1;\n  join\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'begin');
      findBlock(pairs, 'fork');
    });
  });

  suite('Regression: fork bypasses label colon check', () => {
    test('should reject fork used as label name after colon', () => {
      const pairs = parser.parse('begin : fork\n  x = 1;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });

    test('should pair first fork when second fork is label name', () => {
      const pairs = parser.parse('fork : fork\n  #10 a = 1;\njoin');
      assertSingleBlock(pairs, 'fork', 'join');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });
  });

  suite('Regression: else-if chain nest level consistency', () => {
    test('should have consistent nest levels for if and else-if begin blocks', () => {
      const pairs = parser.parse('always @(posedge clk)\n  if (a) begin\n    x <= 1;\n  end else if (b) begin\n    x <= 2;\n  end');
      const begins = pairs.filter((p) => p.openKeyword.value === 'begin');
      assert.strictEqual(begins.length, 2);
      assert.strictEqual(begins[0].nestLevel, begins[1].nestLevel);
    });
  });

  suite('Bug investigation: confirmed bugs', () => {
    test('should not treat extern class as block opener', () => {
      const pairs = parser.parse('class RealClass;\n  int x;\n  extern class FwdDecl;\nendclass');
      assertSingleBlock(pairs, 'class', 'endclass');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });

    test('should not treat extern interface as block opener', () => {
      const pairs = parser.parse('interface RealIf;\n  logic valid;\n  extern interface FwdDecl;\nendinterface');
      assertSingleBlock(pairs, 'interface', 'endinterface');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });
  });

  generateCommonTests(config);
});
