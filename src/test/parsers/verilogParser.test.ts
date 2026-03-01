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

  generateCommonTests(config);

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

  suite('v7 bug fixes - control keyword chaining', () => {
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

  suite('Bug fixes', () => {
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
  });
});
