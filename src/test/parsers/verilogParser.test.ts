import * as assert from 'node:assert';
import { isInExcludedRegion } from '../../parsers/parserUtils';
import { VerilogBlockParser } from '../../parsers/verilogParser';
import type { ExcludedRegion } from '../../types';
import { assertBlockCount, assertIntermediates, assertNestLevel, assertNoBlocks, assertSingleBlock, findBlock } from '../helpers/parserTestHelpers';
import type { CommonTestConfig } from '../helpers/sharedTestGenerators';
import { generateCommonTests, generateEdgeCaseTests, generateExcludedRegionTests, generateNestedBlockTests } from '../helpers/sharedTestGenerators';

// Verbatim copies of the pre-optimization brace/paren scans, kept as the
// equivalence reference. Before the BracketIndex migration, isInsideBraceExpression
// and isInsideAssignmentPattern walked the source prefix backward per keyword and
// isInsideParens scanned the prefix forward from offset 0 per `interface` keyword
// (both O(N^2)). The regression suites below assert the linearized implementations
// classify every position identically to these copies on well-formed and
// malformed input. Do not "fix" these copies — they pin the legacy behavior.

// Legacy: returns true when the `{` at `bracePos` is closed by a matching `}` at
// or after `position`. Verbatim from verilogParser.ts before the optimization.
function legacyIsBraceClosedAfter(source: string, bracePos: number, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 0;
  for (let i = bracePos; i < source.length; i++) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const ch = source[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i >= position;
      }
    }
  }
  return false;
}

// Legacy: backward brace-depth scan for `'{...}` assignment patterns.
// Verbatim from verilogParser.ts before the optimization.
function legacyIsInsideAssignmentPattern(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let braceDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const ch = source[i];
    if (ch === '}') {
      braceDepth++;
    } else if (ch === '{') {
      if (braceDepth === 0) {
        return i > 0 && source[i - 1] === "'" && legacyIsBraceClosedAfter(source, i, position, excludedRegions);
      }
      braceDepth--;
    }
  }
  return false;
}

// Legacy: backward brace-depth scan for any `{...}` brace expression.
// Verbatim from verilogParser.ts before the optimization.
function legacyIsInsideBraceExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let braceDepth = 0;
  for (let i = position - 1; i >= 0; i--) {
    if (isInExcludedRegion(i, excludedRegions)) {
      continue;
    }
    const ch = source[i];
    if (ch === '}') {
      braceDepth++;
    } else if (ch === '{') {
      if (braceDepth === 0) {
        return legacyIsBraceClosedAfter(source, i, position, excludedRegions);
      }
      braceDepth--;
    }
  }
  return false;
}

// Legacy: forward `()` -depth scan for `interface` port-list detection.
// Verbatim from verilogValidation.ts before the optimization.
function legacyIsInsideParens(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
  let depth = 0;
  for (let i = 0; i < position; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      if (depth > 0) depth--;
    }
  }
  if (depth === 0) return false;
  let forwardDepth = depth;
  for (let i = position; i < source.length; i++) {
    if (isInExcludedRegion(i, excludedRegions)) continue;
    if (source[i] === '(') {
      forwardDepth++;
    } else if (source[i] === ')') {
      forwardDepth--;
      if (forwardDepth < depth) {
        return true;
      }
    }
  }
  return false;
}

// Private-method accessor shape for the parser's brace-context predicates.
type BraceContextParser = {
  isInsideBraceExpression(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean;
  isInsideAssignmentPattern(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean;
  getExcludedRegions(source: string): ExcludedRegion[];
};

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
    stringBlockClose: 'endmodule',
    commentAtEndOfLineSource: 'module test; // end endmodule\n  reg a;\nendmodule',
    commentAtEndOfLineBlockOpen: 'module',
    commentAtEndOfLineBlockClose: 'endmodule',
    escapedQuoteStringSource: 'module test;\n  initial $display("say \\"begin\\"");\nendmodule',
    escapedQuoteStringBlockOpen: 'module',
    escapedQuoteStringBlockClose: 'endmodule',
    nestedBlockSource: `module test;
  always @(posedge clk) begin
    if (enable) begin
      data <= in;
    end
  end
endmodule`,
    nestedBlockCount: 5,
    nestedBlockLevels: [{ keyword: 'module', level: 0 }]
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
    generateNestedBlockTests(config);

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
      // (scanForBeginAfterControl encounters `::` after the control keyword and bails out).
      // Note: `:: begin` (whitespace-separated scope resolution before a block keyword)
      // is now rejected at the outer scope-resolution check, so `begin` does not pair.
      const source = `module m;
  if (cond) :: begin
  end
endmodule`;
      const pairs = parser.parse(source);
      // 'if' is rejected (:: found), 'begin' is also rejected (preceded by ::),
      // so only the outer module/endmodule remains.
      assertSingleBlock(pairs, 'module', 'endmodule');
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
    test('should let disable on previous line suppress fork (free-form newline)', () => {
      // SystemVerilog is free-form: a newline between `disable` and `fork` is
      // equivalent to a space, so `disable\nfork` is the `disable fork` statement
      // (IEEE 1800 §9.6) and `fork` must NOT open a block. Only module/endmodule pairs.
      const pairs = parser.parse('module m;\n  disable\n  fork\n    #10 a = 1;\n  join\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat fork after disable on previous line as block open', () => {
      // `disable\nfork ... join` is the free-form `disable fork` statement; fork
      // is not a par-block opener, so no fork/join pair is produced.
      const pairs = parser.parse('disable\nfork\n  x = 1;\njoin');
      assertNoBlocks(pairs);
    });

    test('should not treat fork after wait on previous line as block open', () => {
      // `wait\nfork ... join` is the free-form `wait fork` statement; neither
      // `wait` nor `fork` opens a block, so no pairs are produced.
      const pairs = parser.parse('wait\nfork\n  x = 1;\njoin');
      assertNoBlocks(pairs);
    });

    test('should still treat fork after a normal statement on previous line as block open', () => {
      // The preceding word across the newline is `;` (not disable/wait), so the
      // fork/join par-block is a real block.
      const pairs = parser.parse('a = b;\nfork\n  x = 1;\njoin');
      assertSingleBlock(pairs, 'fork', 'join');
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

  suite('Regression: matchVerilogString backslash-newline as line continuation', () => {
    // Per IEEE 1800-2017 §5.9, `\<LF>` (and `\<CR>`/`\<CRLF>`) inside a string is a line
    // continuation: the backslash and line break are consumed and the string continues.
    test('should treat backslash-LF as line continuation, not string terminator', () => {
      const source = '"test\\\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      // String continues from `\<LF>`; bare newline after `module m;` terminates the
      // unterminated string, leaving only `endmodule` outside any string region.
      // No `module`/`endmodule` pair is formed.
      assertBlockCount(pairs, 0);
    });

    test('should treat backslash-CRLF as line continuation, not string terminator', () => {
      const source = '"test\\\r\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
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

    test('should not attach default inside a single-statement if body to outer case', () => {
      // Bug: `if (c) default: x = 1;` puts `default:` inside the single-statement
      // body of `if`. That `default` is not a case_item, but the backward scan for
      // a case opener skipped past the `if` control opener (continue) and reached
      // the outer case, falsely attaching `default` as its intermediate.
      const source = 'case (s)\n  1: if (c) default: x = 1;\nendcase';
      const pairs = parser.parse(source);
      const caseBlock = findBlock(pairs, 'case');
      assert.strictEqual(caseBlock.intermediates.length, 0, 'default inside if body should not attach to outer case');
    });

    test('should not attach default inside a single-statement for body to outer case', () => {
      const source = 'case (s)\n  1: for (i=0;i<2;i=i+1) default: x = 1;\nendcase';
      const pairs = parser.parse(source);
      const caseBlock = findBlock(pairs, 'case');
      assert.strictEqual(caseBlock.intermediates.length, 0, 'default inside for body should not attach to outer case');
    });

    test('should still attach default to case nested inside a single-statement if body', () => {
      // Sanity: a real nested case inside `if`'s single-statement body still owns
      // its own `default`. The control opener is closed by endcase before the
      // backward scan from `default` runs, so the scan finds the inner case.
      const source = 'case (s)\n  1: if (c) case (t)\n    2: y = 1;\n    default: y = 0;\n  endcase\nendcase';
      const pairs = parser.parse(source);
      const inner = pairs.find((p) => p.openKeyword.value === 'case' && p.intermediates.length > 0);
      assert.ok(inner, 'inner case should own the default intermediate');
      assert.strictEqual(inner.intermediates[0].value, 'default');
      const outer = pairs.find((p) => p.openKeyword.value === 'case' && p.intermediates.length === 0);
      assert.ok(outer, 'outer case should have no intermediate');
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

  suite('Bug: default inside unclosed statement block misattributed to outer case', () => {
    test('should not attach default to outer case when inside an unclosed fork block', () => {
      // default appears inside an unclosed fork block, so it is not at a case_item
      // position. It must not become an intermediate of the case/endcase pair.
      const source = 'case(a)\nfork\ndefault: x;\njoin\nendcase';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assertIntermediates(casePair, []);
    });

    test('should not attach default to outer case when inside an unclosed begin block', () => {
      const source = 'case(a)\nbegin\ndefault: x;\nend\nendcase';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assertIntermediates(casePair, []);
    });

    test('should not attach default to outer case when inside nested unclosed begin blocks', () => {
      const source = 'case(a)\nbegin\nbegin\ndefault: x;\nend\nend\nendcase';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assertIntermediates(casePair, []);
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

  suite('Regression: assertion qualifiers between verb and property/sequence', () => {
    test('should skip final qualifier in assert final property', () => {
      const pairs = parser.parse('assert final property (@(posedge clk) a |-> b);');
      assertNoBlocks(pairs);
    });

    test('should skip #0 qualifier in assert #0 property', () => {
      const pairs = parser.parse('assert #0 property (@(posedge clk) a |-> b);');
      assertNoBlocks(pairs);
    });

    test('should skip #0 qualifier in cover #0 property', () => {
      const pairs = parser.parse('cover #0 property (@(posedge clk) a |-> b);');
      assertNoBlocks(pairs);
    });

    test('should skip final and #0 combined in assert final #0 property', () => {
      const pairs = parser.parse('assert final #0 property (@(posedge clk) a |-> b);');
      assertNoBlocks(pairs);
    });

    test('should skip #0 qualifier for sequence', () => {
      const pairs = parser.parse('cover #0 sequence (s1);');
      assertNoBlocks(pairs);
    });

    test('should still detect standalone property block', () => {
      const pairs = parser.parse('property p1;\n  a |-> b;\nendproperty');
      assertSingleBlock(pairs, 'property', 'endproperty');
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

  suite('Regression: unclosed paren must not suppress interface keyword', () => {
    test('should still detect interface block after an unclosed paren', () => {
      // Bug: an unclosed `(` (incomplete syntax) made isInsideParens report that
      // every later position is inside a port list, suppressing the `interface`
      // keyword. The standalone `interface ... endinterface` block must still pair.
      const source = 'foo(\ninterface my_if;\n  logic x;\nendinterface';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'interface', 'endinterface');
    });

    test('should still suppress interface inside a properly closed port list', () => {
      // Sanity: the real port-list suppression must keep working after the fix.
      const tokens = parser.getTokens('module test(interface bus);\nendmodule');
      assert.ok(!tokens.some((t) => t.value === 'interface'), 'interface inside a closed port list must stay suppressed');
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

  suite('Regression: keyword case-item label must not suppress the real block opener', () => {
    test('should treat begin after a begin: case-item label as the real block opener', () => {
      // Bug: `begin:` is a case-item label whose name happens to be the reserved
      // word `begin`. The label `begin` was tokenized as block_open and the real
      // `begin x=1; end` block opener was suppressed by isPrecededByLabelColon.
      const source = 'case (s)\n  begin: begin x=1; end\nendcase';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const beginPair = findBlock(pairs, 'begin');
      // The real begin opener follows the label colon, not the label itself.
      assert.strictEqual(beginPair.openKeyword.startOffset, source.indexOf('begin', source.indexOf(':')));
      assert.strictEqual(beginPair.closeKeyword?.value, 'end');
    });

    test('should treat fork after a fork: case-item label as the real block opener', () => {
      // Same bug with fork/join.
      const source = 'case (s)\n  fork: fork x=1; join\nendcase';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const forkPair = findBlock(pairs, 'fork');
      assert.strictEqual(forkPair.openKeyword.startOffset, source.indexOf('fork', source.indexOf(':')));
      assert.strictEqual(forkPair.closeKeyword?.value, 'join');
    });

    test('should still treat begin: module outside case as a named block', () => {
      // Sanity: outside a case body, `begin : <name>` is a named begin block.
      // The leading `begin` is the real opener; `module` is the block name.
      const pairs = parser.parse('begin : module\n  x = 1;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
      assert.strictEqual(pairs[0].openKeyword.startOffset, 0);
    });

    test('should still pair first fork for fork : fork outside case', () => {
      // Sanity: outside a case body, `fork : fork` is a named fork block whose
      // name is `fork`; the leading fork is the real opener.
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

  suite('Regression: dangling-else with single-statement else', () => {
    test('should not let end close outer if when a single-statement else follows', () => {
      // The `end` closes the inner `if (inner) begin ... end` only. The outer
      // `if (outer)` body continues into the single-statement `else y = 2;`, so
      // the outer `if` must NOT be chain-consumed by this `end`; it stays orphan.
      const source = 'if (outer)\n  if (inner) begin\n    x = 1;\n  end\nelse\n  y = 2;\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const beginPair = findBlock(pairs, 'begin');
      const endOffset = source.indexOf('end');
      assert.strictEqual(beginPair.closeKeyword.startOffset, endOffset);
      // The inner if (the second `if`) pairs with the same end.
      const innerIfOffset = source.indexOf('if', 1);
      const innerIfPair = pairs.find((p) => p.openKeyword.value === 'if' && p.openKeyword.startOffset === innerIfOffset);
      assert.ok(innerIfPair, 'inner if should be paired with end');
      assert.strictEqual(innerIfPair.closeKeyword.startOffset, endOffset);
      // The outer if (offset 0) is orphan: no pair has it as opener.
      const outerIfPair = pairs.find((p) => p.openKeyword.value === 'if' && p.openKeyword.startOffset === 0);
      assert.strictEqual(outerIfPair, undefined, 'outer if must remain orphan');
    });

    test('should still close both ifs when else has its own begin-end block', () => {
      // Regression guard: `else begin ... end` (else with begin) must keep the
      // existing behavior where the outer if spans to the final end.
      const source = 'if (outer)\n  if (inner) begin\n    x = 1;\n  end\nelse begin\n  y = 2;\nend\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 5);
      const lastEndOffset = source.lastIndexOf('end');
      const outerIfPair = pairs.find((p) => p.openKeyword.value === 'if' && p.openKeyword.startOffset === 0);
      assert.ok(outerIfPair, 'outer if should be paired');
      assert.strictEqual(outerIfPair.closeKeyword.startOffset, lastEndOffset);
      const elsePair = pairs.find((p) => p.openKeyword.value === 'else');
      assert.ok(elsePair, 'else should be paired with its begin-end');
    });
  });

  suite('Regression: extern, include angle brackets, and virtual interface', () => {
    test('should not detect extern protected function as block', () => {
      const pairs = parser.parse('extern protected function void f();');
      assertNoBlocks(pairs);
    });

    test('should not detect keywords in include angle brackets', () => {
      const pairs = parser.parse('module test;\n  `include <endmodule.vh>\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not detect virtual interface as block', () => {
      const pairs = parser.parse('interface real_if;\n  virtual interface my_if vif;\nendinterface');
      assertSingleBlock(pairs, 'interface', 'endinterface');
      assert.strictEqual(pairs[0].openKeyword.line, 0);
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

    test('should skip comment between typedef and class in modifier detection', () => {
      const pairs = parser.parse('typedef /* comment */ class MyClass;\nendclass');
      assertNoBlocks(pairs);
    });

    test('should skip comment between extern and module in modifier detection', () => {
      const pairs = parser.parse('extern /* comment */ module ext_mod();\nendmodule');
      assertNoBlocks(pairs);
    });
  });

  suite('DPI line false positive regression', () => {
    test('should not reject function on package import line', () => {
      const pairs = parser.parse('import my_pkg::*; function void f();\n  x = 1;\nendfunction');
      assertSingleBlock(pairs, 'function', 'endfunction');
    });

    test('should not reject task on package export line', () => {
      const pairs = parser.parse('export pkg::func; task t();\n  x = 1;\nendtask');
      assertSingleBlock(pairs, 'task', 'endtask');
    });

    test('should still skip DPI import function', () => {
      const pairs = parser.parse('import "DPI-C" function void foo();');
      assertNoBlocks(pairs);
    });
  });

  suite('Regression: label with comment between identifier and colon', () => {
    test('should skip label with block comment before colon', () => {
      const pairs = parser.parse('always @(posedge clk) my_label /* comment */ : begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
    });

    test('should skip label with line comment before colon on next line', () => {
      const pairs = parser.parse('always @(posedge clk) my_label // comment\n : begin\n  q <= d;\nend');
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: arithmetic delay expressions should not break control keyword pairing', () => {
    test('should pair always with end when delay has division', () => {
      const pairs = parser.parse('always #10/2 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });

    test('should pair always with end when macro delay has division', () => {
      const pairs = parser.parse('always #`CLK/2 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
    });

    test('should pair always with end when delay has multiplication', () => {
      const pairs = parser.parse('always #`PERIOD*2 begin\n  clk = ~clk;\nend');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
    });
  });

  suite('Regression: very long delay expression operator chain should not overflow the stack', () => {
    // Bug: skipDelayExpression recursed once per arithmetic operator (`+ - * / %`)
    // in a delay expression. A delay like `#1+1+1+...` with thousands of operators
    // grew the call stack proportionally to the operator count, throwing
    // `RangeError: Maximum call stack size exceeded` (observed at ~8000 operators).
    // The scan must iterate so any-length expression is handled without recursion.
    test('should pair always with end for a numeric delay with 10000 plus operators', () => {
      const chain = new Array(10000).fill('1').join('+');
      const source = `always #${chain} begin\n  x = 1;\nend`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });

    test('should pair always with end for an identifier delay with 10000 plus operators', () => {
      const chain = new Array(10000).fill('a').join('+');
      const source = `always #${chain} begin\n  x = 1;\nend`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });

    test('should pair always with end for a backtick-macro delay with 10000 plus operators', () => {
      const chain = new Array(10000).fill('`M').join('+');
      const source = `always #${chain} begin\n  x = 1;\nend`;
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'always');
      findBlock(pairs, 'begin');
    });
  });

  suite('Regression: trySkipLabel bare backslash', () => {
    test('should not treat bare backslash followed by colon as label', () => {
      const pairs = parser.parse('always @(posedge clk) \\ : begin\n  q <= d;\nend');
      assertSingleBlock(pairs, 'begin', 'end');
    });
  });

  suite('Regression: extern with multiple qualifiers', () => {
    test('should filter extern protected static function', () => {
      const tokens = parser.getTokens('class C;\n  extern protected static function void f();\nendclass');
      const funcTokens = tokens.filter((t) => t.value === 'function');
      assert.strictEqual(funcTokens.length, 0);
    });

    test('should filter extern local virtual function', () => {
      const tokens = parser.getTokens('class C;\n  extern local virtual function void f();\nendclass');
      const funcTokens = tokens.filter((t) => t.value === 'function');
      assert.strictEqual(funcTokens.length, 0);
    });

    test('should filter extern virtual function', () => {
      const tokens = parser.getTokens('class C;\n  extern virtual function void f();\nendclass');
      const funcTokens = tokens.filter((t) => t.value === 'function');
      assert.strictEqual(funcTokens.length, 0);
    });

    test('should still detect non-extern function', () => {
      const tokens = parser.getTokens('function void f();\n  x = 1;\nendfunction');
      const funcTokens = tokens.filter((t) => t.value === 'function');
      assert.strictEqual(funcTokens.length, 1);
    });
  });

  suite('Regression 2026-04-11: malformed attributes and delay expression whitespace', () => {
    test('should not swallow source when encountering malformed (*)', () => {
      const pairs = parser.parse('(*)\nmodule m;\nendmodule');
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should detect always block with delay expression containing leading-space operator', () => {
      const pairs = parser.parse('always #10 /2 begin\n  clk = ~clk;\nend');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin'));
    });

    test('should detect always block with delay expression containing fully-spaced operator', () => {
      const pairs = parser.parse('always #10 + 2 begin\n  clk = ~clk;\nend');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin'));
    });

    test('should detect always block with backtick delay macro and whitespace-separated operator', () => {
      const pairs = parser.parse('module m;\n  always #`CLK /2 begin\n    clk = ~clk;\n  end\nendmodule');
      assert.strictEqual(pairs.length, 3);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'begin'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'module'));
    });

    test('should detect always block with backtick delay macro and fully-spaced operator', () => {
      const pairs = parser.parse('always #`CLK / 2 begin\n  clk = ~clk;\nend');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always'));
    });
  });

  suite('Regression: control keyword body with fork/join (par_block)', () => {
    test('should pair initial with fork/join body', () => {
      const pairs = parser.parse('initial fork\n  a = 1;\n  b = 2;\njoin\n');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'initial' && p.closeKeyword.value === 'join'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fork' && p.closeKeyword.value === 'join'));
    });

    test('should pair always with fork/join_any body', () => {
      const pairs = parser.parse('always @(posedge clk) fork\n  a = 1;\njoin_any\n');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fork' && p.closeKeyword.value === 'join_any'));
    });

    test('should pair always_ff with fork/join_none body', () => {
      const pairs = parser.parse('always_ff @(posedge clk) fork\n  a = 1;\njoin_none\n');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'always_ff'));
      assert.ok(pairs.some((p) => p.openKeyword.value === 'fork' && p.closeKeyword.value === 'join_none'));
    });

    test('should still pair control keyword with begin/end body', () => {
      const pairs = parser.parse('initial begin\n  a = 1;\nend\n');
      assert.strictEqual(pairs.length, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'initial' && p.closeKeyword.value === 'end'));
    });
  });

  suite('Regression 2026-04-14: DPI declaration with leading attribute', () => {
    test('should not treat function in DPI import with leading attribute as block opener', () => {
      const pairs = parser.parse('(* pure *) import "DPI-C" function int foo();');
      assert.strictEqual(pairs.length, 0);
    });

    test('should not treat function in DPI import with leading block comment as block opener', () => {
      const pairs = parser.parse('/* attr */ import "DPI-C" function int foo();');
      assert.strictEqual(pairs.length, 0);
    });

    test('should pair module when DPI import with attribute appears inside', () => {
      const pairs = parser.parse('module m;\n  (* pure *) import "DPI-C" function int foo();\nendmodule');
      assert.strictEqual(pairs.length, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'module');
      assert.strictEqual(pairs[0].closeKeyword.value, 'endmodule');
    });
  });

  suite('Regression 2026-04-14: interface class (SV-2012)', () => {
    test('should not treat interface qualifying class as interface block', () => {
      const source =
        'interface MyIf;\n  logic clk;\n  interface class Printable;\n    pure virtual function string to_string();\n  endclass\nendinterface';
      const pairs = parser.parse(source);
      assert.strictEqual(pairs.length, 2);
      const outer = pairs.find((p) => p.openKeyword.value === 'interface' && p.closeKeyword.value === 'endinterface');
      assert.ok(outer, 'outer interface/endinterface pair should exist');
      assert.strictEqual(outer.openKeyword.startOffset, 0);
      const klass = pairs.find((p) => p.openKeyword.value === 'class' && p.closeKeyword.value === 'endclass');
      assert.ok(klass, 'class/endclass pair should exist');
    });
  });

  suite('Regression: `pragma directive arguments should not be tokenized', () => {
    test('should not tokenize begin/end keywords appearing in `pragma directive arguments', () => {
      // Verify that `begin` in `pragma protect begin / `end` in `pragma protect end
      // do not open/close a block. Note: protected content is excluded as a region;
      // see Regression 2026-05-09: pragma protect begin/end excludes content.
      const source = 'module a;\nendmodule\n`pragma protect begin\n`pragma protect end\nmodule b;\nendmodule\n';
      const pairs = parser.parse(source);
      // Two module/endmodule pairs around the pragma protect region.
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 4);
      assert.ok(moduleB, 'module b should pair');
    });
  });

  suite('Regression: attribute with backslash-newline inside closed string', () => {
    test('should not swallow source past attribute when string contains \\<LF>', () => {
      const source = '(* attr = "a\\\nb" *) module m;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'module');
      assert.strictEqual(pairs[0].closeKeyword.value, 'endmodule');
    });
  });

  suite('Regression: assertion #<digits> qualifier and extern macromodule modifier', () => {
    test('should reject property block when assert # <space> N property is used', () => {
      // `assert # 5 property p1;` is an assertion statement, not a property declaration.
      const source = 'assert # 5 property p1;\n  a |-> b;\nendproperty';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
    });

    test('should not treat extern macromodule m1(); as a block opener', () => {
      const source = 'extern macromodule m1();\nendmodule\nmacromodule m2;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].openKeyword.value, 'macromodule');
    });
  });

  suite("Regression 2026-04-29: assignment pattern '{default: ...}", () => {
    test('should not register default inside assignment pattern as case label', () => {
      const source =
        "case (sel)\n  0: my_struct = '{default: 0};\n  1: my_struct = '{default: 1, b: 2};\n  default: my_struct = '{default: 0};\nendcase";
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const defaultCount = pairs[0].intermediates.filter((i) => i.value === 'default').length;
      assert.strictEqual(defaultCount, 1, 'only the case label default should register as intermediate');
    });
  });

  suite("Regression: assignment pattern '{key: value} with block keyword as field name", () => {
    test('should not tokenize begin/end inside assignment pattern as block keywords', () => {
      const source = "module m;\n  initial begin\n    x = '{begin: 0, end: 100};\n    y = 1;\n  end\nendmodule";
      const pairs = parser.parse(source);
      // module/endmodule + initial/end + begin/end (chained control + begin shares 'end').
      // Crucially, no spurious begin/end pair from inside '{begin: 0, end: 100}.
      assertBlockCount(pairs, 3);
      const modulePair = pairs.find((p) => p.openKeyword.value === 'module');
      assert.ok(modulePair, 'module should pair with endmodule');
      // The begin token should be the one at the start of `initial begin`, not from
      // inside the assignment pattern. The 'begin' inside `'{begin: 0, ...}` should
      // not have produced a token.
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair, 'initial begin should pair with end');
      assert.strictEqual(beginPair.openKeyword.line, 1, 'begin should be on line 1 (initial begin), not line 2');
    });
  });

  suite('Regression: case-sensitive preprocessor directives', () => {
    test('should not treat uppercase `IFDEF as preprocessor directive', () => {
      // `IFDEF is a regular macro call (uppercase identifier), not the lowercase `ifdef directive.
      // The 'begin' keyword should still be detected as the body marker after 'always'.
      const source = 'always @(posedge clk) `IFDEF begin\n  x <= 1;\nend';
      const pairs = parser.parse(source);
      // Expect at least the always block detected (the always opener should pair with end)
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always block should be detected');
    });
  });

  suite('Regression: pkg::default scope-resolved identifier as case label', () => {
    test('should not register pkg::default as case intermediate', () => {
      const source = 'case (sel)\n  pkg::default: x = 1;\n  default: y = 0;\nendcase';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const defaultCount = pairs[0].intermediates.filter((i) => i.value === 'default').length;
      assert.strictEqual(defaultCount, 1, 'only the bare default should register');
    });
  });

  suite('Regression: data type filter for block_close', () => {
    test('should not treat int endmodule; identifier as block_close', () => {
      const source = 'module m;\n  int endmodule;\n  reg [7:0] data;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      // The opening module should pair with the actual trailing endmodule (line 3),
      // not the variable name on line 1.
      const modulePair = pairs[0];
      assert.strictEqual(modulePair.openKeyword.value, 'module');
      assert.ok(modulePair.closeKeyword.line >= 3, 'module should pair with trailing endmodule');
    });
  });

  suite('Regression: macro invocation argument list excludes block keywords', () => {
    test('should not tokenize begin/end inside `MACRO(...)', () => {
      const source = '`MY_MACRO(begin x = 1; end)\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: static/automatic qualifiers before function/task/class', () => {
    test('should detect static function inside class', () => {
      const source = 'class C;\n  static function int counter();\n    return 0;\n  endfunction\nendclass';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
    test('should detect automatic function inside module', () => {
      const source = 'module m;\n  automatic function int f();\n    return 0;\n  endfunction\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression: default clocking specification has no body', () => {
    test('should not open clocking block for `default clocking name;`', () => {
      const source = 'module m;\n  default clocking cb;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression 2026-05-06: case/endcase chain-consume with control keywords', () => {
    test('should pair always with endcase when case is the body of always', () => {
      const source = 'always @(posedge clk) case (sel)\n  1: x = 1;\nendcase';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always block should pair with endcase');
      assert.strictEqual(alwaysPair?.closeKeyword.value, 'endcase');
    });

    test('should pair always with begin/end when unique if is the body', () => {
      const source = 'always @(posedge clk) unique if (a) begin\n  x <= 1;\nend';
      const pairs = parser.parse(source);
      const alwaysPair = pairs.find((p) => p.openKeyword.value === 'always');
      assert.ok(alwaysPair, 'always should pair when unique qualifier precedes if');
    });

    test('should pair randsequence with endsequence', () => {
      const source = 'randsequence (s)\n  s: a b;\nendsequence';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'randsequence', 'endsequence');
    });
  });

  suite('Regression 2026-05-06: matchAttribute with bare-newline string termination', () => {
    test('should fully contain (* attr *) when string contains bare newline followed by text', () => {
      const source = '(* attr = "abc\ndef" *) module m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression 2026-05-09: macro arg list with whitespace before paren', () => {
    test('should exclude `MY_MACRO (begin x = 1; end) when space precedes paren', () => {
      const source = '`MY_MACRO (begin x = 1; end)\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should exclude `MY_MACRO\\t(begin x = 1; end) when tab precedes paren', () => {
      const source = '`MY_MACRO\t(begin x = 1; end)\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should NOT consume args when newline precedes paren (macro without args)', () => {
      // `BARE_MACRO followed by newline then `(begin)` is not a macro invocation argument list.
      // The begin/end inside the parens should be tokenized normally.
      const source = '`BARE_MACRO\n(begin) module m;\nendmodule';
      const pairs = parser.parse(source);
      // module/endmodule should still pair
      const modulePair = pairs.find((p) => p.openKeyword.value === 'module');
      assert.ok(modulePair, 'module should still pair with endmodule');
    });
  });

  suite('Regression 2026-05-09: extern automatic function/task should not open', () => {
    test('should not tokenize function in "extern static automatic function void f()"', () => {
      const source = 'class C;\n  extern static automatic function void f();\nendclass';
      const tokens = parser.getTokens(source);
      const functionTokens = tokens.filter((t) => t.value === 'function');
      assert.strictEqual(functionTokens.length, 0, 'function token should not be emitted in extern qualifier-prefixed declaration');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should not tokenize task in "extern automatic task t()"', () => {
      const source = 'class C;\n  extern automatic task t();\nendclass';
      const tokens = parser.getTokens(source);
      const taskTokens = tokens.filter((t) => t.value === 'task');
      assert.strictEqual(taskTokens.length, 0, 'task token should not be emitted in extern automatic task declaration');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'class', 'endclass');
    });

    test('should still detect non-extern automatic function as block opener', () => {
      const source = 'class C;\n  automatic function int f();\n    return 0;\n  endfunction\nendclass';
      const pairs = parser.parse(source);
      // class/endclass + function/endfunction
      assertBlockCount(pairs, 2);
    });
  });

  suite('Regression 2026-05-09: pragma protect begin/end excludes content', () => {
    test('should exclude content between `pragma protect begin and `pragma protect end', () => {
      const source = '`pragma protect begin\nbegin x = 1; end\n`pragma protect end\n';
      const pairs = parser.parse(source);
      // Inside the protect region, begin/end should NOT be tokenized.
      assertNoBlocks(pairs);
    });

    test('should still detect blocks outside `pragma protect begin/end region', () => {
      const source = 'module a;\nendmodule\n`pragma protect begin\nbegin x = 1; end\n`pragma protect end\nmodule b;\nendmodule\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 5);
      assert.ok(moduleB, 'module b should pair');
    });
  });

  suite('Regression 2026-05-09: foreach control keyword chains with begin/end', () => {
    test('should pair foreach with end via initial-foreach-begin chain', () => {
      const source = 'module m;\n  initial foreach (arr[i]) begin\n    arr[i] = 0;\n  end\nendmodule';
      const pairs = parser.parse(source);
      // Expected: module/endmodule, initial/end, foreach/end, begin/end
      assertBlockCount(pairs, 4);
      const modulePair = pairs.find((p) => p.openKeyword.value === 'module');
      assert.ok(modulePair, 'module should pair with endmodule');
      const initialPair = pairs.find((p) => p.openKeyword.value === 'initial');
      assert.ok(initialPair, 'initial should pair (chained with end)');
      const foreachPair = pairs.find((p) => p.openKeyword.value === 'foreach');
      assert.ok(foreachPair, 'foreach should pair (chained with end)');
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair, 'begin should pair with end');
    });

    test('should pair wait with end via wait(expr) begin chain', () => {
      const source = 'module m;\n  initial wait (ready) begin\n    x = 1;\n  end\nendmodule';
      const pairs = parser.parse(source);
      // Expected: module/endmodule, initial/end, wait/end, begin/end
      assertBlockCount(pairs, 4);
      const waitPair = pairs.find((p) => p.openKeyword.value === 'wait');
      assert.ok(waitPair, 'wait should pair (chained with end)');
      const beginPair = pairs.find((p) => p.openKeyword.value === 'begin');
      assert.ok(beginPair, 'begin should pair with end');
    });

    test('should still reject wait fork as block open', () => {
      // Regression check: making wait a control keyword should not break wait-fork detection
      const source = 'module test;\n  wait fork;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: macro arg string with bare newline termination', () => {
    test('should not extend macro arg region when string contains bare newline', () => {
      // Bug: a `"` inside `MACRO(...)` arg with a bare newline in it caused subsequent `"`
      // chars to be treated as a new string opening, swallowing the closing `)` and
      // extending the macro region across `endmodule` lines.
      const source = 'module a;\n`MACRO("hello\nworld")\nendmodule\nmodule b;\nendmodule\n';
      const pairs = parser.parse(source);
      // Both module/endmodule pairs should be detected
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair with endmodule');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 4);
      assert.ok(moduleB, 'module b should pair with endmodule');
    });
  });

  suite('Regression: pragma protect begin_protected/end_protected', () => {
    test('should exclude content between `pragma protect begin_protected and end_protected', () => {
      // Per IEEE 1800-2017 §28, `protect begin_protected` and `protect end_protected`
      // are alternative forms used to wrap encrypted/encoded content. Block keywords
      // inside the protected region must not be tokenized.
      const source = '`pragma protect begin_protected\nbegin x = 1; end\n`pragma protect end_protected\n';
      const pairs = parser.parse(source);
      assertNoBlocks(pairs);
    });

    test('should still detect blocks outside `pragma protect begin_protected/end_protected region', () => {
      const source = 'module a;\nendmodule\n`pragma protect begin_protected\nbegin x = 1; end\n`pragma protect end_protected\nmodule b;\nendmodule\n';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 5);
      assert.ok(moduleB, 'module b should pair');
    });
  });

  suite('Regression: wait fork; should not be a control keyword block opener', () => {
    test('should not consume control keyword chain for wait fork; statement', () => {
      // Bug: `wait fork;` is a SystemVerilog statement that does not require begin/end.
      // With wait in CONTROL_KEYWORDS, scanForBeginAfterControl runs and may find a
      // subsequent begin (wrong block), or `wait fork` may otherwise interact poorly
      // with chained control consumption. This test verifies that the only blocks are
      // the outer module/endmodule and the surrounding initial/begin/end if any.
      const source = 'module test;\n  initial begin\n    wait fork;\n    x = 1;\n  end\nendmodule';
      const pairs = parser.parse(source);
      // Expected: module/endmodule, initial/end, begin/end (3 pairs)
      assertBlockCount(pairs, 3);
      // wait should NOT appear as a block opener
      const waitPair = pairs.find((p) => p.openKeyword.value === 'wait');
      assert.strictEqual(waitPair, undefined, 'wait fork; should not open a block');
    });
  });

  suite('Regression: scope resolution with whitespace before keyword', () => {
    test('should reject block_open keyword preceded by `pkg :: ` (whitespace separated)', () => {
      // Bug: `pkg::case` is rejected by the existing direct-`::` check, but `pkg :: case`
      // (with whitespace between `::` and the keyword) bypasses it. The block_open
      // filter at line 444-447 only checks immediately-adjacent `::`.
      const source = 'module m;\n  initial begin\n    x = pkg :: case;\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      const caseTokens = tokens.filter((t) => t.value === 'case');
      assert.strictEqual(caseTokens.length, 0, '`pkg :: case` (with spaces) should not be tokenized as block_open');
    });

    test('should reject block_middle default preceded by `pkg :: ` (whitespace separated)', () => {
      // `pkg :: default` should not be treated as a case label. The existing default
      // filter at line 290-292 checks immediately-adjacent `::` but not whitespace-separated.
      // Use a context where `default` would appear in a valid case to ensure the test
      // wouldn't filter due to no following `:`.
      const source = 'case (x)\n  pkg :: default : y = 1;\n  default : y = 2;\nendcase';
      const tokens = parser.getTokens(source);
      const defaultTokens = tokens.filter((t) => t.value === 'default');
      // Only the second `default` (the real case-label default) should be tokenized
      assert.strictEqual(defaultTokens.length, 1, 'Only the real `default:` should remain after filtering');
      // The remaining default should be at the offset where `default :` appears alone (no `pkg :: ` prefix)
      assert.ok(defaultTokens[0].startOffset > 30, 'The remaining default should be the second one (after pkg :: default)');
    });
  });

  suite("Regression: assignment pattern '{key value} without colon", () => {
    test("should reject block_open used as field name in '{} without colon", () => {
      // Bug: assignment pattern `'{...}` filtering only triggered when followed by `:`.
      // A nested expression like `'{begin + 1}` would incorrectly tokenize `begin`.
      // (Here `begin` is referring to a previously declared variable.)
      const source = "module m;\n  int x = '{begin};\nendmodule";
      const tokens = parser.getTokens(source);
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      assert.strictEqual(beginTokens.length, 0, "begin inside '{} should not be tokenized");
    });
  });

  suite('Regression: ifdef with comment between directive and macro name', () => {
    test('should treat KEYWORD as macro name when comment separates `ifdef and KEYWORD', () => {
      // Bug: `ifdef /* comment */ MY_MACRO` should treat MY_MACRO as the macro arg,
      // but the existing code only skips spaces/tabs after `ifdef`. When a block
      // comment intervenes, the macro arg detection fails and downstream filtering
      // does not exclude the macro name.
      const source = '`ifdef /* comment */ end\nmodule m;\nendmodule\n`endif\n';
      const tokens = parser.getTokens(source);
      // `end` after `ifdef /* comment */` is the macro name, not a block_close
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 0, 'end should not be tokenized as block_close when it is a macro arg name');
    });
  });

  suite('Regression: data type with packed dimension or block comment before reserved-word identifier', () => {
    test('should reject reserved-word identifier in declaration after `reg [size]`', () => {
      // Bug: `reg [7:0] endmodule;` declares a variable named `endmodule`. The
      // isPrecededByDataTypeKeyword check only looks at the immediately preceding
      // word, so the `]` of the dimension specifier breaks the check and the
      // declared identifier is falsely tokenized as block_close.
      const source = 'module m;\n  reg [7:0] endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      // Only one endmodule token expected: the actual block close at end
      assert.strictEqual(endmoduleTokens.length, 1);
      assert.strictEqual(endmoduleTokens[0].startOffset, source.lastIndexOf('endmodule'));
      // And the block pair should match the outer module/endmodule
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should reject reserved-word identifier in declaration after `reg /* comment */`', () => {
      // Same bug as above but with a block comment between `reg` and the identifier.
      const source = 'module m;\n  reg /* width */ endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 1);
      assert.strictEqual(endmoduleTokens[0].startOffset, source.lastIndexOf('endmodule'));
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should reject reserved-word identifier in declaration after `logic [N-1:0]`', () => {
      // Same bug variant: SystemVerilog logic data type with dimension specifier.
      const source = 'module m;\n  logic [N-1:0] endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 1);
      assert.strictEqual(endmoduleTokens[0].startOffset, source.lastIndexOf('endmodule'));
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should reject reserved-word identifier in declaration after `reg [a:b][c:d]` (multi-dim)', () => {
      // Multiple dimension specifiers should also be skipped backward.
      const source = 'module m;\n  reg [7:0][3:0] endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 1);
      assert.strictEqual(endmoduleTokens[0].startOffset, source.lastIndexOf('endmodule'));
    });
  });

  suite('Regression: control keyword used as label name', () => {
    test('should reject `wait` as block_open when used as label (wait : begin)', () => {
      // Bug: `wait : begin` uses `wait` as a block label name, not as a control
      // keyword. Without the fix, `wait` is tokenized as block_open and falsely
      // pairs with the matching `end`.
      const source = 'module m;\n  initial begin\n    wait : begin\n      x = 1;\n    end\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      // `wait` here is a label, not a block opener
      const waitTokens = tokens.filter((t) => t.value === 'wait');
      assert.strictEqual(waitTokens.length, 0, 'wait used as label should not be tokenized as block_open');
      const pairs = parser.parse(source);
      // No `wait` block in pairs
      assert.strictEqual(
        pairs.find((p) => p.openKeyword.value === 'wait'),
        undefined
      );
    });

    test('should reject `if` as block_open when used as label (if : begin)', () => {
      // Same bug: `if : begin` uses `if` as a label name.
      const source = 'module m;\n  initial begin\n    if : begin\n      x = 1;\n    end\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      const ifTokens = tokens.filter((t) => t.value === 'if');
      assert.strictEqual(ifTokens.length, 0, 'if used as label should not be tokenized as block_open');
    });

    test('should reject `for` as block_open when used as label (for : begin)', () => {
      const source = 'module m;\n  initial begin\n    for : begin\n      x = 1;\n    end\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      const forTokens = tokens.filter((t) => t.value === 'for');
      assert.strictEqual(forTokens.length, 0, 'for used as label should not be tokenized as block_open');
    });

    test('should still accept `wait fork;` valid construct', () => {
      // Sanity check: existing valid constructs still work after the fix.
      const source = 'module m;\n  initial begin\n    wait fork;\n  end\nendmodule';
      const pairs = parser.parse(source);
      // wait fork; is rejected via isValidWaitOpen, so wait should not appear
      assert.strictEqual(
        pairs.find((p) => p.openKeyword.value === 'wait'),
        undefined
      );
    });

    test('should still accept `if (cond) begin` valid construct', () => {
      // Sanity check: `if (cond) begin ... end` is still valid block.
      const source = 'module m;\n  initial begin\n    if (cond) begin\n      x = 1;\n    end\n  end\nendmodule';
      const pairs = parser.parse(source);
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.ok(ifPair, 'if (cond) begin/end should still pair correctly');
    });

    test('should still accept `for (init; cond; incr) begin` valid construct', () => {
      // Sanity check: for loop still works.
      const source = 'module m;\n  initial begin\n    for (int i=0; i<10; i++) begin\n      x = i;\n    end\n  end\nendmodule';
      const pairs = parser.parse(source);
      const forPair = pairs.find((p) => p.openKeyword.value === 'for');
      assert.ok(forPair, 'for loop should still pair correctly');
    });

    test('should still reject scope resolution `pkg::wait`', () => {
      // Sanity check: pre-existing scope resolution rejection still works.
      const source = 'module m;\n  initial begin\n    x = pkg::wait;\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      const waitTokens = tokens.filter((t) => t.value === 'wait');
      assert.strictEqual(waitTokens.length, 0);
    });
  });

  suite('Regression: pragma protect begin without matching end', () => {
    test('should only exclude the pragma line when no matching `pragma protect end exists', () => {
      // Bug: `pragma protect begin` opens a protected region. If no matching
      // `pragma protect end is found, matchPragmaDirective falls back to excluding
      // through end of source, swallowing all subsequent code.
      // Fix: fall back to single-line exclusion (only the pragma directive line itself)
      // so subsequent valid code still parses.
      const source = '`pragma protect begin\nDATA_HERE\nmodule m2;\nendmodule';
      const regions = parser.getExcludedRegions(source);
      // The pragma region should not extend past its line end
      const pragmaRegion = regions.find((r) => r.start === 0);
      assert.ok(pragmaRegion);
      // The line ends at the first newline (offset 21: `\`pragma protect begin\n`)
      assert.strictEqual(pragmaRegion.end, source.indexOf('\n'));
      // The subsequent `module m2;...endmodule` should still parse as a block
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should exclude region between begin and end when matching `pragma protect end exists', () => {
      // Sanity check: when both begin and end exist, the entire region is excluded.
      const source = '`pragma protect begin\nKEYWORDS_HERE\n`pragma protect end\nmodule m2;\nendmodule';
      const regions = parser.getExcludedRegions(source);
      const pragmaRegion = regions.find((r) => r.start === 0);
      assert.ok(pragmaRegion);
      // The exclusion should extend to the `pragma protect end line, not to source end
      assert.ok(pragmaRegion.end < source.length);
      // The subsequent module/endmodule should still be parsed
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should only exclude the pragma line for `pragma protect begin_protected without end', () => {
      // begin_protected is also accepted as the protected-region opener
      const source = '`pragma protect begin_protected\nKEYWORDS\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: block keywords inside generic brace expression', () => {
    test('should not tokenize `begin` inside `{begin: 1}` (no apostrophe)', () => {
      // Bug: the assignment-pattern filter only suppresses block keywords when the
      // brace has a leading apostrophe (`'{...}`). A bare `{begin: 1}` would
      // incorrectly tokenize `begin` as block_open, falsely opening a new block.
      const source = 'module m;\n  initial begin\n    a = {begin: 1};\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      // Only one `begin` token (the real `initial begin`) should be tokenized
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      assert.strictEqual(beginTokens.length, 1);
      assert.strictEqual(beginTokens[0].startOffset, source.indexOf('begin'));
    });

    test('should not tokenize `end` inside `{end + 1}`', () => {
      // Same bug: `end` in a brace expression should not be tokenized as block_close.
      const source = 'module m;\n  initial begin\n    a = {end + 1, x};\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      // The `end` inside braces should not be tokenized; only the real `end` after `}` line.
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(endTokens.length, 1);
      // The real `end` is on the line `  end\nendmodule`
      assert.ok(endTokens[0].startOffset > source.indexOf('}'));
    });

    test('should not tokenize keywords in nested `{outer, {begin}}`', () => {
      // Nested braces: the inner `{begin}` is also inside an outer brace context.
      const source = 'module m;\n  initial begin\n    a = {outer, {begin}};\n  end\nendmodule';
      const tokens = parser.getTokens(source);
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      assert.strictEqual(beginTokens.length, 1);
      assert.strictEqual(beginTokens[0].startOffset, source.indexOf('begin'));
    });

    test('should still parse blocks normally outside of braces', () => {
      // Sanity check: the fix must not break normal block parsing.
      const source = 'module m;\n  initial begin\n    a = 1;\n  end\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
    });

    test("should still suppress block keywords inside `'{begin: 1}` (assignment pattern)", () => {
      // Sanity check: existing assignment pattern suppression still works.
      const source = "module m;\n  int x = '{begin: 1};\nendmodule";
      const tokens = parser.getTokens(source);
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      assert.strictEqual(beginTokens.length, 0);
    });

    test('should not register default inside {default: ...} brace expression as case label', () => {
      // Bug: `default` inside a non-apostrophe brace expression was tokenized as
      // a case-label intermediate. Only the actual `default:` case label (line 3)
      // should be registered as an intermediate.
      const source = 'case (sel)\n  1: a = {default: 1};\n  default: a = 0;\nendcase';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const defaultIntermediates = pairs[0].intermediates.filter((i) => i.value === 'default');
      assert.strictEqual(defaultIntermediates.length, 1, 'only the case label default should register as intermediate');
      assert.strictEqual(defaultIntermediates[0].line, 2, 'the registered default should be the case label on line 2');
    });
  });

  suite('Regression: unclosed brace must not suppress later block keywords', () => {
    test('should still detect module-endmodule with an unclosed concatenation brace', () => {
      // Bug: an unclosed `{` (incomplete concatenation) made the backward brace
      // scan return true for every later keyword, suppressing all subsequent
      // block tokens. The `module`/`endmodule` pair must still be detected.
      const source = 'module top;\n  assign bus = {hi,\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should still detect block keywords after an unclosed brace inside a begin block', () => {
      // Same bug reproduced inside a begin block: an unclosed `{` must not
      // suppress the trailing `end`/`endmodule` tokens.
      const source = 'module top;\n  initial begin\n    x = {a, b\n  end\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      assert.ok(
        pairs.some((p) => p.openKeyword.value === 'module' && p.closeKeyword?.value === 'endmodule'),
        'module should still pair with endmodule'
      );
    });

    test('should still suppress block keywords inside a properly closed brace', () => {
      // Sanity: closed-brace suppression must continue to work after the fix.
      const source = 'module m;\n  initial begin\n    a = {begin: 1};\n  end\nendmodule';
      const beginTokens = parser.getTokens(source).filter((t) => t.value === 'begin');
      assert.strictEqual(beginTokens.length, 1, 'only the real `initial begin` should be tokenized');
      assert.strictEqual(beginTokens[0].startOffset, source.indexOf('begin'));
    });
  });

  suite('Regression: declaration keywords suppress reserved-word identifiers', () => {
    test('should not treat endmodule as block_close after localparam', () => {
      // Bug: `localparam endmodule = 1;` declares a parameter named `endmodule`.
      // Since SystemVerilog allows reserved words as identifiers in parameter
      // declarations, the inner `endmodule` should not pair with the outer module.
      const source = 'module m;\n  localparam endmodule = 1;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      const modulePair = pairs[0];
      assert.strictEqual(modulePair.openKeyword.value, 'module');
      assert.strictEqual(modulePair.openKeyword.line, 0, 'module should be the outer module on line 0');
      assert.strictEqual(modulePair.closeKeyword?.line, 2, 'module should pair with the outer endmodule on line 2');
    });

    test('should not treat endmodule as block_close after parameter', () => {
      const source = 'module m;\n  parameter endmodule = 1;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].closeKeyword?.line, 2, 'module should pair with the outer endmodule');
    });

    test('should not treat endmodule as block_close after genvar', () => {
      const source = 'module m;\n  genvar endmodule;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 1);
      assert.strictEqual(pairs[0].closeKeyword?.line, 2, 'module should pair with the outer endmodule');
    });

    test('should not tokenize reserved keyword as block_open after localparam (case)', () => {
      // Sanity: same suppression should apply to block_open (e.g., `case` used as
      // a parameter name). The `case` keyword should not produce a token at all.
      const source = 'module m;\n  localparam case = 0;\nendmodule';
      const tokens = parser.getTokens(source);
      const caseTokens = tokens.filter((t) => t.value === 'case');
      assert.strictEqual(caseTokens.length, 0, 'case used as a parameter name should not be tokenized as block_open');
    });
  });

  suite('Regression: case keyword used as identifier in assignment right-hand side', () => {
    test('should not tokenize `case` as block_open on the right-hand side of `=`', () => {
      // Bug: `x = case;` uses the reserved word `case` as an identifier. The `case`
      // was tokenized as block_open and falsely paired with the trailing `endcase`.
      const source = 'x = case;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'case'), '`case` after `=` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should not tokenize `casex` as block_open on the right-hand side of non-blocking `<=`', () => {
      const source = 'y <= casex;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'casex'), '`casex` after `<=` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should not tokenize `randcase` as block_open on the right-hand side of `=`', () => {
      const source = 'b = randcase;';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'randcase'), '`randcase` after `=` must not be tokenized as block_open');
    });

    test('should not tokenize `case` followed by `(` as block_open on the right-hand side of `=`', () => {
      // Bug: `x = case(y);` uses `case` as an identifier. The opening paren after
      // `case` made the suppression skip (it was kept to rescue the `case (expr)`
      // statement form), so `case` was tokenized as block_open and falsely paired
      // with the trailing `endcase`. A case keyword can never be an expression
      // operand, so a preceding assignment operator must suppress it regardless of
      // a following paren.
      const source = 'x = case(y);\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'case'), '`case(y)` after `=` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should still parse a normal case statement', () => {
      // Sanity: `case (expr)` at statement position must remain a real block.
      const pairs = parser.parse('case (sel)\n  1: x = a;\n  default: x = b;\nendcase');
      assertSingleBlock(pairs, 'case', 'endcase');
    });

    test('should still parse a normal randcase statement', () => {
      // Sanity: `randcase` at statement position must remain a real block.
      const pairs = parser.parse('randcase\n  50: x = 1;\nendcase');
      assertSingleBlock(pairs, 'randcase', 'endcase');
    });

    test('should still parse a case statement as the body of always', () => {
      // Sanity: `always @(...) case (...)` keeps the case as a real block even
      // though a control keyword precedes it.
      const pairs = parser.parse('always @(posedge clk) case (sel)\n  1: x = 1;\nendcase');
      assertBlockCount(pairs, 2);
      findBlock(pairs, 'case');
    });
  });

  suite('Regression: case keyword used as identifier after a comparison operator', () => {
    test('should not tokenize `casez` as block_open on the right-hand side of `==`', () => {
      // Bug: `if (x == casez)` misuses the reserved word `casez` as an identifier.
      // The case-keyword suppression only covered assignment operators, so `casez`
      // after `==` was tokenized as block_open and stole the trailing `endcase`,
      // leaving the real `case` opener orphaned. A case keyword can only appear at
      // statement position, never as an expression operand, so a preceding binary
      // operator (comparison included) means it is misused as an identifier.
      const source = 'case (sel)\n0: if (x == casez) a = 1;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'casez'), '`casez` after `==` must not be tokenized as block_open');
      assertSingleBlock(parser.parse(source), 'case', 'endcase');
    });

    test('should not tokenize `case` as block_open on the right-hand side of `!=`', () => {
      const source = 'if (x != case) a = 1;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'case'), '`case` after `!=` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should not tokenize `casex` as block_open on the right-hand side of `>=`', () => {
      const source = 'if (x >= casex) a = 1;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'casex'), '`casex` after `>=` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should not tokenize `casez` as block_open on the right-hand side of arithmetic `+`', () => {
      const source = 'if (x + casez) a = 1;\nendcase';
      const tokens = parser.getTokens(source);
      assert.ok(!tokens.some((t) => t.value === 'casez'), '`casez` after `+` must not be tokenized as block_open');
      assertNoBlocks(parser.parse(source));
    });

    test('should still parse a normal case statement preceded by a comparison elsewhere', () => {
      // Sanity: a comparison operator on a prior line must not suppress a real
      // case statement that legitimately starts at statement position.
      const pairs = parser.parse('if (a == b) x = 1;\ncase (sel)\n  1: y = 1;\nendcase');
      assertSingleBlock(pairs, 'case', 'endcase');
    });
  });

  suite('Regression: line comments between control keyword and label colon', () => {
    test('should skip line comments when checking label-colon adjacency', () => {
      // Bug: `isFollowedByLabelColon` only skipped block comments, so a line
      // comment between a control keyword (e.g., `wait`) and a `:` would prevent
      // the keyword from being recognized as a label name. As a result, `wait`
      // was treated as a control opener and falsely paired with a subsequent `end`.
      const source = 'module m;\n  initial begin\n    wait // comment\n      : begin\n        a = 1;\n      end\n  end\nendmodule';
      const pairs = parser.parse(source);
      // Expect: module-endmodule, initial-end, begin-end (3 pairs).
      // No spurious wait-end pair from `wait` being misidentified as control opener.
      assertBlockCount(pairs, 3);
      const waitPair = pairs.find((p) => p.openKeyword.value === 'wait');
      assert.strictEqual(waitPair, undefined, 'wait should not open a block when used as a label name');
    });

    test('should skip line comments before label colon for if', () => {
      // Same bug for `if` used as a label name.
      const source = 'module m;\n  initial begin\n    if // label name\n      : begin\n        a = 1;\n      end\n  end\nendmodule';
      const pairs = parser.parse(source);
      // No spurious if-end pair.
      const ifPair = pairs.find((p) => p.openKeyword.value === 'if');
      assert.strictEqual(ifPair, undefined, 'if should not open a block when used as a label name');
    });
  });

  suite('Coverage: matchVerilogString CR-only line continuation', () => {
    test('should treat backslash-CR (no following LF) as line continuation', () => {
      // matchVerilogString: `\<CR>` where the CR is NOT followed by LF (old-Mac line
      // ending) is a line continuation. The CR at end-of-source means the `source[i+2]`
      // lookahead short-circuits, so the 2-char skip path is taken.
      const source = '"unterminated string with module keyword\\\r';
      const tokens = parser.getTokens(source);
      // The entire string (including the CR continuation) is one excluded region;
      // `module` inside it is not tokenized.
      assert.strictEqual(tokens.length, 0);
      const regions = parser.getExcludedRegions(source);
      assert.strictEqual(regions.length, 1);
      assert.strictEqual(regions[0].start, 0);
      assert.strictEqual(regions[0].end, source.length);
    });

    test('should continue string across backslash-CR back into following content', () => {
      // The string opened on line 1 continues across `\<CR>` and is only terminated by
      // the bare LF after `endmodule`. No module/endmodule pair is formed because both
      // keywords sit inside the string region.
      const source = '"line one\\\rmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
    });
  });

  suite('Coverage: matchAttribute string with CRLF line continuation', () => {
    test('should treat backslash-CRLF inside attribute string as line continuation', () => {
      // matchAttribute: a string inside `(* ... *)` whose `\<CRLF>` continuation is
      // followed by a closing `"` before the attribute closer `*)`. The CR-LF pair is
      // consumed as a 2-char newline and the string continues.
      const source = '(* attr = "line1\\\r\nline2" *) module m;\nendmodule';
      const pairs = parser.parse(source);
      // The attribute (including the continued string) is excluded; module/endmodule
      // after it pair normally.
      assertSingleBlock(pairs, 'module', 'endmodule');
      const regions = parser.getExcludedRegions(source);
      const attrRegion = regions.find((r) => r.start === 0);
      assert.ok(attrRegion, 'attribute should be an excluded region');
      assert.strictEqual(source.slice(attrRegion.end - 2, attrRegion.end), '*)');
    });

    test('should treat backslash-CR inside attribute string as line continuation', () => {
      // CR-only continuation: `\<CR>` (CR not followed by LF) consumes a 1-char newline.
      const source = '(* attr = "line1\\\rline2" *) module m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Coverage: matchAttribute string bare-newline with no closer', () => {
    test('should exclude to end of source when attribute string is unterminated and no closer follows', () => {
      // matchAttribute: a string inside `(* ... *)` terminated by a bare newline, after
      // which no `*)` exists anywhere. Per best-effort parsing the malformed attribute is
      // excluded to end of source so stray keywords are not mistakenly tokenized.
      const source = '(* attr = "unterminated has begin keyword\nmodule m here\nendmodule keyword too';
      const tokens = parser.getTokens(source);
      assert.strictEqual(tokens.length, 0);
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 0);
      const regions = parser.getExcludedRegions(source);
      const attrRegion = regions.find((r) => r.start === 0);
      assert.ok(attrRegion, 'malformed attribute should be an excluded region');
      assert.strictEqual(attrRegion.end, source.length);
    });
  });

  suite('Coverage: matchAttribute single-line comment inside attribute', () => {
    test('should skip a // line comment containing keywords inside an attribute', () => {
      // matchAttribute: `// ...` inside `(* ... *)` runs to end of line; block keywords
      // in the comment must not be tokenized.
      const source = '(* attr // begin end module endmodule\n= 1 *) module m;\nendmodule';
      const tokens = parser.getTokens(source);
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Coverage: matchDefineDirective block comment in define body', () => {
    test('should skip a terminated block comment containing keywords in define body', () => {
      // matchDefineDirective: a complete `/* ... */` block comment inside the `define
      // body; block keywords inside it are not tokenized and the define ends at EOL.
      const source = '`define M /* begin end module */ value\nmodule m;\nendmodule';
      const tokens = parser.getTokens(source);
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should continue define past backslash-LF inside an unterminated block comment', () => {
      // matchDefineDirective: an unterminated `/*` in the define body that hits a newline
      // preceded by a single backslash (odd count) is a line continuation; the define and
      // the comment both continue onto the next physical line.
      const source = '`define M /* unterminated \\\nstill comment\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      // The define region spans both continued lines; `module`/`endmodule` after it pair.
      assertSingleBlock(pairs, 'module', 'endmodule');
      const regions = parser.getExcludedRegions(source);
      const defineRegion = regions.find((r) => r.start === 0);
      assert.ok(defineRegion, '`define should be an excluded region');
      // The define ends at the second newline (no backslash before it), not the first.
      assert.strictEqual(defineRegion.end, source.indexOf('still comment') + 'still comment'.length);
    });

    test('should end define at CRLF newline inside an unterminated block comment', () => {
      // matchDefineDirective: an unterminated `/*` in the define body that hits a CRLF
      // newline with no continuation backslash ends the define at that newline. The CR is
      // consumed into the region and the LF marks the (exclusive) region end.
      const source = '`define M /* unterminated\r\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
      const regions = parser.getExcludedRegions(source);
      const defineRegion = regions.find((r) => r.start === 0);
      assert.ok(defineRegion, '`define should be an excluded region');
      // The define ends at the LF of the CRLF pair (CR included, LF excluded).
      assert.strictEqual(defineRegion.end, source.indexOf('\n'));
    });
  });

  suite('Coverage: matchPragmaDirective non-protect directives', () => {
    test('should exclude a non-protect `pragma directive line only', () => {
      // matchPragmaDirective: a `pragma directive that is not `protect begin` is excluded
      // up to end of line; arguments are not tokenized.
      const source = 'module a;\nendmodule\n`pragma reset all\nmodule b;\nendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      const regions = parser.getExcludedRegions(source);
      const pragmaRegion = regions.find((r) => source.slice(r.start, r.start + 7) === '`pragma');
      assert.ok(pragmaRegion, '`pragma should be an excluded region');
      // Single-line exclusion: ends at the newline after `pragma reset all`.
      assert.strictEqual(pragmaRegion.end, source.indexOf('\n', pragmaRegion.start));
    });

    test('should exclude `pragma protect with no whitespace after protect as a single line', () => {
      // isPragmaProtectBegin: `protect` immediately followed by end-of-line (no trailing
      // whitespace) is not `protect begin`, so the directive is a plain single-line pragma.
      const source = '`pragma protect\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should exclude `pragma protect <other> (not begin) as a single line', () => {
      // isPragmaProtectBegin: `protect` followed by a token other than `begin` /
      // `begin_protected` is a plain single-line pragma, not a protected-region opener.
      const source = '`pragma protect key_keyowner="acme"\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not treat `pragma protect beginfoo as a protected-region opener', () => {
      // isPragmaProtectBegin: `begin` followed by an identifier character (`beginfoo`)
      // fails the word-boundary check, so it is not the `begin` keyword.
      const source = '`pragma protect beginfoo\nmodule m;\nendmodule';
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should recognize `pragma protect begin/end with a tab separator', () => {
      // isPragmaProtectBegin / isPragmaProtectEnd: a tab (not just a space) is accepted
      // as the whitespace between `protect` and `begin`/`end`.
      const source = 'module a;\nendmodule\n`pragma protect\tbegin\nbegin x = 1; end\n`pragma protect\tend\nmodule b;\nendmodule';
      const pairs = parser.parse(source);
      // The protected region (with the tab-separated directives) excludes the inner
      // begin/end; both module pairs outside it still parse.
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 5);
      assert.ok(moduleB, 'module b should pair');
    });
  });

  suite('Coverage: findPragmaProtectEnd skips non-end pragma directives', () => {
    test('should find the matching `pragma protect end past intervening non-end pragmas', () => {
      // findPragmaProtectEnd: after `pragma protect begin, several `pragma directives that
      // are not `protect end` (a non-protect pragma, `protect` with no trailing whitespace,
      // `protect <other>`, and `protect end<identifier>`) are skipped until the real
      // `pragma protect end is found. The whole begin..end span is excluded.
      const source = [
        'module a;',
        'endmodule',
        '`pragma protect begin',
        '`pragma reset',
        '`pragma protect',
        '`pragma protect key_block="data"',
        '`pragma protect endgame',
        '`pragma protect end',
        'module b;',
        'endmodule'
      ].join('\n');
      const pairs = parser.parse(source);
      // Block keywords inside the protected region are excluded; the two module pairs
      // outside it still parse.
      assertBlockCount(pairs, 2);
      const moduleA = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line === 0);
      assert.ok(moduleA, 'module a should pair');
      const moduleB = pairs.find((p) => p.openKeyword.value === 'module' && p.openKeyword.line >= 8);
      assert.ok(moduleB, 'module b should pair');
      const regions = parser.getExcludedRegions(source);
      const protectRegion = regions.find((r) => r.start === source.indexOf('`pragma protect begin'));
      assert.ok(protectRegion, 'protect region should be excluded');
      // The exclusion extends through the real `pragma protect end line.
      const realEnd = source.indexOf('`pragma protect end\n');
      assert.strictEqual(protectRegion.end, source.indexOf('\n', realEnd));
    });
  });

  suite('Coverage: matchMacroArgList strings and comments in argument list', () => {
    test('should skip an escaped quote inside a macro-argument string', () => {
      // matchMacroArgList: a `\"` inside a string argument is an escape, not the string
      // terminator; the string (and any keyword inside it) stays excluded.
      const source = 'module a;\n`MY_MACRO("escaped \\" quote with begin keyword")\nendmodule';
      const tokens = parser.getTokens(source);
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should skip a // line comment inside a macro argument list', () => {
      // matchMacroArgList: `// ...` inside `MACRO(...)` runs to end of line; keywords in
      // the comment are not tokenized.
      const source = 'module a;\n`MY_MACRO(x, // begin end keyword\n y)\nendmodule';
      const tokens = parser.getTokens(source);
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should skip a block comment inside a macro argument list', () => {
      // matchMacroArgList: a `/* ... */` block comment inside `MACRO(...)` is skipped;
      // keywords in the comment are not tokenized.
      const source = 'module a;\n`MY_MACRO(x, /* begin end keyword */ y)\nendmodule';
      const tokens = parser.getTokens(source);
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should track nested parentheses inside a macro argument list', () => {
      // matchMacroArgList: a nested `(` inside the argument list increments the paren
      // depth so the inner `)` does not prematurely close the macro region.
      const source = 'module a;\n`MY_MACRO(outer(begin), tail)\nendmodule';
      const tokens = parser.getTokens(source);
      // `begin` inside the nested parens is excluded as part of the macro args.
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'endmodule']
      );
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Regression: brace-expression bracket index must not be quadratic', () => {
    // Bug: isInsideBraceExpression / isInsideAssignmentPattern ran for every
    // block_open / block_close (and every `default`) keyword. Each call walked the
    // source prefix backward to offset 0 to locate the enclosing `{`, so total work
    // was O(N^2) in the number of keywords. A brace-free file with thousands of
    // module/endmodule pairs blew past the debounce budget. The fix pre-computes a
    // `{`-only BracketIndex once per parse (cached by source identity) and looks up
    // the enclosing brace in O(log n).
    //
    // The tests below pin the fix from two angles:
    //   1. position-by-position equivalence with the verbatim legacy backward
    //      scan, on well-formed and malformed brace nesting;
    //   2. a wall-clock ceiling the quadratic version blew past by an order of
    //      magnitude.

    // Asserts the parser's (linearized) brace predicates classify every offset of
    // `source` identically to the verbatim legacy backward scans.
    function assertBracePredicateEquivalence(source: string): void {
      const accessor = parser as unknown as BraceContextParser;
      const regions = accessor.getExcludedRegions(source);
      for (let pos = 0; pos <= source.length; pos++) {
        assert.strictEqual(
          accessor.isInsideBraceExpression(source, pos, regions),
          legacyIsInsideBraceExpression(source, pos, regions),
          `isInsideBraceExpression mismatch at offset ${pos} of ${JSON.stringify(source)}`
        );
        assert.strictEqual(
          accessor.isInsideAssignmentPattern(source, pos, regions),
          legacyIsInsideAssignmentPattern(source, pos, regions),
          `isInsideAssignmentPattern mismatch at offset ${pos} of ${JSON.stringify(source)}`
        );
      }
    }

    test('should match the legacy backward scan on well-formed brace expressions', () => {
      // Concatenation, assignment pattern, nested braces, and brace-free code.
      const corpus = [
        'module m;\n  initial begin\n    a = {begin: 1};\n  end\nendmodule',
        "module m;\n  int x = '{begin: 1, end: 2};\nendmodule",
        'module m;\n  initial begin\n    a = {outer, {begin}, tail};\n  end\nendmodule',
        'case (sel)\n  1: a = {default: 1};\n  default: a = 0;\nendcase',
        'module top;\n  assign y = a & b;\nendmodule'
      ];
      for (const source of corpus) {
        assertBracePredicateEquivalence(source);
      }
    });

    test('should match the legacy backward scan on malformed brace nesting', () => {
      // Unclosed braces, stray closers, crossing brackets, braces inside comments
      // and strings, and a `}` exactly at the probed position (boundary case).
      const corpus = [
        'module top;\n  assign bus = {hi,\nendmodule',
        'module top;\n  initial begin\n    x = {a, b\n  end\nendmodule',
        'a } } { begin x end }',
        '{ a { b } begin x end',
        "module m; '{ begin x end",
        '{ ) begin x end }',
        '{ [ } begin x end ]',
        'module m;\n  // { begin in a comment }\n  initial begin x end\nendmodule',
        'module m;\n  string s = "{ begin }";\n  initial begin x end\nendmodule',
        '{}{}begin',
        "'{}begin"
      ];
      for (const source of corpus) {
        assertBracePredicateEquivalence(source);
      }
    });

    test('should produce identical tokens to the legacy scan for brace-heavy assignment patterns', () => {
      // End-to-end: the speedup must not change which keywords survive the
      // brace-context filter. A mix of suppressed (inside braces) and live
      // (outside braces) keywords.
      const source = [
        'module m;',
        '  initial begin',
        "    a = '{begin: 1, end: 2};",
        '    b = {case, endcase};',
        '    c = {outer, {default}};',
        '  end',
        'endmodule'
      ].join('\n');
      const tokens = parser.getTokens(source);
      // Only the real `initial begin` ... `end` survive; every keyword inside a
      // `{...}` brace is suppressed.
      assert.deepStrictEqual(
        tokens.map((t) => t.value),
        ['module', 'initial', 'begin', 'end', 'endmodule']
      );
      assertBlockCount(parser.parse(source), 3);
    });

    test('should parse 30000 brace-free orphan endmodule tokens well under the debounce budget', () => {
      // isInsideBraceExpression runs for every block_open / block_close token.
      // Pre-fix, a brace-free file made each call scan the whole source prefix
      // backward, so 60000 keywords cost O(N^2) (measured ~12s at this size). The
      // bracket-index lookup makes it O(log n) per keyword. Bare `endmodule`
      // tokens form zero pairs, so the unrelated O(pairs^2) in
      // recalculateNestLevels stays neutralized and only the
      // isInsideBraceExpression cost is measured.
      const warmUp = 'endmodule\n'.repeat(2000);
      for (let i = 0; i < 5; i++) {
        parser.parse(warmUp); // JIT warm-up on a small, fast source
      }
      const source = 'endmodule\n'.repeat(30000);
      const start = performance.now();
      const pairs = parser.parse(source);
      const elapsed = performance.now() - start;
      assertNoBlocks(pairs); // unmatched close keywords form zero pairs
      // Linearized parsing finishes in tens of ms; a 4000ms ceiling keeps ample
      // headroom for CI load and GC pauses while still failing by an order of
      // magnitude if the O(N^2) backward brace scan returns.
      assert.ok(elapsed < 4000, `30000-endmodule parse took ${elapsed.toFixed(0)}ms, expected < 4000ms (O(N^2) brace scan regression)`);
    });
  });

  suite('Regression: interface isInsideParens bracket index must not be quadratic', () => {
    // Bug: isInsideParens ran for every `interface` keyword and scanned the source
    // prefix from offset 0 to compute the paren depth at the keyword, so total work
    // was O(N^2) in the number of `interface` keywords. The fix pre-computes a
    // `(`-only BracketIndex once per parse (cached by source identity) and looks up
    // the enclosing paren in O(log n).
    //
    // The tests below pin the fix from two angles:
    //   1. equivalence with the verbatim legacy forward scan, observed end-to-end
    //      through the real parser, on well-formed and malformed paren nesting;
    //   2. a wall-clock ceiling the quadratic version blew past by an order of
    //      magnitude.

    // Drives the real (linearized) parser and asserts each `interface` keyword is
    // suppressed exactly when the verbatim legacy forward scan reports it inside a
    // port-list paren. Each corpus `interface` is in a context where the paren
    // check is the only thing that can suppress it (no `.`/backtick/`::`/`$`, no
    // data-type or modifier prefix, not followed by `class`, no `{...}` braces),
    // so `interface` produces a token iff isInsideParens returned false.
    function assertParenSuppressionMatchesLegacy(source: string): void {
      const accessor = parser as unknown as { getExcludedRegions(source: string): ExcludedRegion[] };
      const regions = accessor.getExcludedRegions(source);
      const interfaceTokenOffsets = new Set(
        parser
          .getTokens(source)
          .filter((t) => t.value === 'interface')
          .map((t) => t.startOffset)
      );
      const keyword = 'interface';
      const isWord = (ch: string | undefined): boolean => ch !== undefined && /[a-zA-Z0-9_$]/.test(ch);
      for (let pos = source.indexOf(keyword); pos !== -1; pos = source.indexOf(keyword, pos + 1)) {
        // Probe only standalone `interface` keyword occurrences. A substring of a
        // longer identifier (e.g. the `interface` inside `endinterface`, or
        // `interfaces`) is not a keyword the tokenizer ever emits, so it is not
        // part of the equivalence domain.
        if (isWord(source[pos - 1]) || isWord(source[pos + keyword.length])) {
          continue;
        }
        // Skip occurrences inside excluded regions (comments/strings): they never
        // produce a token and never reach isInsideParens, so they are not part of
        // the equivalence domain.
        if (isInExcludedRegion(pos, regions)) {
          continue;
        }
        const suppressed = !interfaceTokenOffsets.has(pos);
        assert.strictEqual(
          suppressed,
          legacyIsInsideParens(source, pos, regions),
          `interface suppression at offset ${pos} must match the legacy forward scan for ${JSON.stringify(source)}`
        );
      }
    }

    test('should match the legacy forward scan on well-formed paren nesting', () => {
      const corpus = [
        'module test(interface bus);\nendmodule',
        'module test(\n  input clk,\n  interface bus,\n  output valid\n);\nendmodule',
        'interface my_if;\n  logic valid;\nendinterface',
        'module test((interface a), interface b);\nendmodule',
        'module m;\n  // interface in a comment\n  logic x;\nendmodule'
      ];
      for (const source of corpus) {
        assertParenSuppressionMatchesLegacy(source);
      }
    });

    test('should match the legacy forward scan on malformed paren nesting', () => {
      // Unclosed parens, stray closers, parens inside comments/strings.
      const corpus = [
        'foo(\ninterface my_if;\n  logic x;\nendinterface',
        'module test) interface bus(;\nendmodule',
        'module test( ) interface free;\nendinterface',
        'module m;\n  // ( comment\n  interface free;\nendinterface',
        'module m;\n  string s = "(";\n  interface free;\nendinterface',
        '((interface deep'
      ];
      for (const source of corpus) {
        assertParenSuppressionMatchesLegacy(source);
      }
    });

    test('should produce the expected tokens for interface in and out of port lists', () => {
      // End-to-end: `interface` inside a closed port list stays suppressed; a
      // standalone `interface` block still opens.
      const source = 'module test(interface bus);\nendmodule\ninterface free_if;\n  logic v;\nendinterface';
      const tokens = parser.getTokens(source).map((t) => t.value);
      // The port-list `interface` is suppressed; the standalone one survives.
      assert.deepStrictEqual(tokens, ['module', 'endmodule', 'interface', 'endinterface']);
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 2);
      assert.ok(pairs.some((p) => p.openKeyword.value === 'interface' && p.closeKeyword?.value === 'endinterface'));
    });

    test('should parse 20000 orphan interface openers well under the debounce budget', () => {
      // isInsideParens runs for every `interface` keyword regardless of pairing.
      // Pre-fix it scanned the source prefix from offset 0 per keyword, making
      // parsing O(N^2) (measured ~16s at this size). The bracket-index lookup
      // makes it O(log n) per keyword. Bare `interface` openers form zero pairs,
      // so the unrelated O(pairs^2) in recalculateNestLevels stays neutralized and
      // only the isInsideParens cost is measured.
      const warmUp = 'interface\n'.repeat(2000);
      for (let i = 0; i < 5; i++) {
        parser.parse(warmUp); // JIT warm-up on a small, fast source
      }
      const source = 'interface\n'.repeat(20000);
      const start = performance.now();
      const pairs = parser.parse(source);
      const elapsed = performance.now() - start;
      assertNoBlocks(pairs); // unclosed openers form zero pairs
      // Linearized parsing finishes in tens of ms; a 4000ms ceiling keeps ample
      // headroom for CI load and GC pauses while still failing by an order of
      // magnitude if the O(N^2) prefix scan returns.
      assert.ok(elapsed < 4000, `20000-interface parse took ${elapsed.toFixed(0)}ms, expected < 4000ms (O(N^2) isInsideParens regression)`);
    });
  });

  suite('Regression: findPragmaProtectEnd ignores `pragma protect end inside strings and comments', () => {
    test('should not terminate protect region at `pragma protect end inside double-quoted string', () => {
      // Bug: findPragmaProtectEnd scans forward for `pragma\b` literally and does not
      // skip strings or comments. A string or comment containing the text
      // `` `pragma protect end `` early-terminates the protected region, leaving the
      // remainder of the file un-excluded.
      const source = 'module m;\n`pragma protect begin\n"xyz `pragma protect end zzzz"\n`pragma protect end\nendmodule';
      const regions = parser.getExcludedRegions(source);
      const protectStart = source.indexOf('`pragma protect begin');
      const protectRegion = regions.find((r) => r.start === protectStart);
      assert.ok(protectRegion, 'protect region should be excluded');
      // The exclusion must extend to the real `pragma protect end on the last line,
      // not to the fake one inside the string.
      const realEnd = source.lastIndexOf('`pragma protect end');
      assert.ok(protectRegion.end > realEnd, `protect region end ${protectRegion.end} must extend past the real \`pragma protect end at ${realEnd}`);
    });

    test('should not terminate protect region at `pragma protect end inside block comment', () => {
      const source = 'module m;\n`pragma protect begin\n/* `pragma protect end */\n`pragma protect end\nendmodule';
      const regions = parser.getExcludedRegions(source);
      const protectStart = source.indexOf('`pragma protect begin');
      const protectRegion = regions.find((r) => r.start === protectStart);
      assert.ok(protectRegion, 'protect region should be excluded');
      const realEnd = source.lastIndexOf('`pragma protect end');
      assert.ok(protectRegion.end > realEnd, `protect region end ${protectRegion.end} must extend past the real \`pragma protect end at ${realEnd}`);
    });

    test('should not terminate protect region at `pragma protect end inside line comment', () => {
      const source = 'module m;\n`pragma protect begin\n// `pragma protect end\n`pragma protect end\nendmodule';
      const regions = parser.getExcludedRegions(source);
      const protectStart = source.indexOf('`pragma protect begin');
      const protectRegion = regions.find((r) => r.start === protectStart);
      assert.ok(protectRegion, 'protect region should be excluded');
      const realEnd = source.lastIndexOf('`pragma protect end');
      assert.ok(protectRegion.end > realEnd, `protect region end ${protectRegion.end} must extend past the real \`pragma protect end at ${realEnd}`);
    });
  });

  suite('Regression: isPrecededByDataTypeKeyword treats escaped identifiers as a word boundary', () => {
    test('should not skip an escaped identifier when scanning for a preceding data-type keyword', () => {
      // Bug: isPrecededByDataTypeKeyword skips ANY excluded region (including escaped
      // identifiers and strings) and then reads the preceding word. For the source
      // `int \my_var endmodule`, it skips past `\my_var` and finds `int`, causing
      // the trailing `endmodule` to be suppressed as if it were a declared identifier.
      // The fix limits backward skipping to block comments (`/* ... */`) only.
      const source = 'module outer;\n  int \\my_var endmodule\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      // Both `endmodule` keywords must be tokenized: the one after `\my_var` and the
      // outer one on the last line.
      assert.strictEqual(endmoduleTokens.length, 2, 'both endmodule keywords must survive when an escaped identifier intervenes');
    });

    test('should not skip a string literal when scanning for a preceding data-type keyword', () => {
      // Same bug class: a string before the reserved-word identifier should also
      // break the preceding-word adjacency, not be transparently skipped.
      const source = 'module outer;\n  int "label" endmodule\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 2, 'both endmodule keywords must survive when a string intervenes');
    });

    test('should still skip block comment between data-type keyword and reserved-word identifier', () => {
      // Confirms the fix preserves the legitimate skip behavior for block comments,
      // which IS a regression-tested feature (see "data type with packed dimension or
      // block comment before reserved-word identifier"). `reg /* width */ endmodule;`
      // remains a declaration, so the trailing `endmodule` is suppressed.
      const source = 'module m;\n  reg /* width */ endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 1, 'block comment between data-type and identifier still suppresses the identifier');
    });
  });

  suite('Bug fix: case keyword used as left-side operand of binary operator', () => {
    test('should not tokenize `case` followed by `==` as a block_open', () => {
      // Bug: `case` appearing as the left-side operand of a comparison/binary
      // operator (e.g. `if (case == x)`) was tokenized as a block_open. The
      // canonical case statement form is `case (expr)`, so a directly-following
      // operator means the keyword is being misused as an expression operand.
      const source = 'module m;\n  initial if (case == x) y = 1;\nendmodule';
      const tokens = parser.getTokens(source);
      const caseTokens = tokens.filter((t) => t.value === 'case');
      assert.strictEqual(caseTokens.length, 0, '`case` followed by `==` must not be tokenized');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not tokenize `casex` followed by `+` as a block_open', () => {
      // Same bug class for casex / casez / randcase.
      const source = 'module m;\n  initial if (casex + 1 == 0) y = 1;\nendmodule';
      const tokens = parser.getTokens(source);
      const casexTokens = tokens.filter((t) => t.value === 'casex');
      assert.strictEqual(casexTokens.length, 0, '`casex` followed by `+` must not be tokenized');
    });

    test('should still tokenize valid case statement `case (expr)`', () => {
      // Sanity: the normal `case (expr) ... endcase` form must keep working.
      const source = 'module m;\n  initial case (sel)\n    0: x = 1;\n  endcase\nendmodule';
      const pairs = parser.parse(source);
      const casePair = findBlock(pairs, 'case');
      assert.strictEqual(casePair.closeKeyword?.value, 'endcase');
    });
  });

  suite('Bug fix: `ifdef macro name on next line', () => {
    test('should treat the identifier on the line after `ifdef as the macro-name argument', () => {
      // Bug: when the macro name follows `ifdef across a newline, the
      // directive-arg whitespace skip stopped at the newline, so the keyword
      // `module` on the next line was tokenized as a block_open.
      const source = '`ifdef\nmodule\n`endif\nmodule m;\nendmodule\n';
      const tokens = parser.getTokens(source);
      // The `module` on line 1 is the macro-name argument and must not appear
      // as a block_open token; only `module m;` on line 3 should.
      const moduleOpenTokens = tokens.filter((t) => t.value === 'module' && t.type === 'block_open');
      assert.strictEqual(moduleOpenTokens.length, 1, '`module` after `ifdef must be treated as the macro-name argument');
      assert.strictEqual(moduleOpenTokens[0].line, 3, 'remaining module opener should be the real one on line 3');
      const pairs = parser.parse(source);
      // The ifdef/endif and module/endmodule pairs should match correctly.
      const ifdefPair = pairs.find((p) => p.openKeyword.value === '`ifdef');
      assert.ok(ifdefPair, '`ifdef must pair with `endif');
      assert.strictEqual(ifdefPair.closeKeyword?.value, '`endif');
      assertSingleBlock(
        pairs.filter((p) => p.openKeyword.value === 'module'),
        'module',
        'endmodule'
      );
    });
  });

  suite('Bug fix: reserved word inside #(...) delay expression', () => {
    test('should not tokenize a block_open keyword inside #(...) delay expression', () => {
      // Bug: `#(module)` — `module` inside the delay expression is a misused
      // identifier (syntax error in SystemVerilog: a reserved word cannot be a
      // delay expression operand). Without suppression, the inner `module` was
      // tokenized and prematurely paired with the trailing `endmodule`, leaving
      // the outer `module sub();...endmodule` orphaned.
      const source = 'module m;\n  module sub();\n  endmodule\n  initial #(module) x = 1;\nendmodule';
      const tokens = parser.getTokens(source);
      // Only 2 module openers (outer m, inner sub) and 2 endmodule closers.
      const moduleOpenTokens = tokens.filter((t) => t.value === 'module' && t.type === 'block_open');
      assert.strictEqual(moduleOpenTokens.length, 2, '`module` inside #(...) must not be tokenized as a block_open');
      const pairs = parser.parse(source);
      // Both module-endmodule pairs must form correctly.
      const modulePairs = pairs.filter((p) => p.openKeyword.value === 'module');
      assert.strictEqual(modulePairs.length, 2, 'both inner sub and outer m must pair');
    });

    test('should not tokenize a block_close keyword inside #(...) delay expression', () => {
      // Same bug class for close keywords inside #(...). `endmodule` inside the
      // delay expression is a misused identifier.
      const source = 'module m;\n  initial #(endmodule) x = 1;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      // Only the trailing real `endmodule` must be tokenized.
      assert.strictEqual(endmoduleTokens.length, 1, '`endmodule` inside #(...) must not be tokenized');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug fix: reserved word after cast expression', () => {
    test('should not tokenize a close keyword that follows a (type) cast as the cast operand', () => {
      // Bug: `(int)endmodule` — the `endmodule` is the operand of the cast and
      // a reserved word cannot legitimately appear there. Without skipping past
      // the `(int)` cast, `endmodule` was tokenized and prematurely paired with
      // the outer module, leaving the trailing real `endmodule` orphaned.
      const source = 'module m;\n  int x;\n  initial x = (int)endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      // Only the final `endmodule` on its own line is a valid close keyword;
      // the one immediately after the cast must be suppressed.
      assert.strictEqual(endmoduleTokens.length, 1, 'cast operand `endmodule` must not be tokenized');
      assert.strictEqual(endmoduleTokens[0].startOffset, source.lastIndexOf('endmodule'));
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should not tokenize a close keyword that follows a (logic) cast', () => {
      // Same bug class with `logic` (another DATA_TYPE keyword).
      const source = 'module m;\n  initial x = (logic)endmodule;\nendmodule';
      const tokens = parser.getTokens(source);
      const endmoduleTokens = tokens.filter((t) => t.value === 'endmodule');
      assert.strictEqual(endmoduleTokens.length, 1, 'cast operand `endmodule` after (logic) must not be tokenized');
    });
  });

  suite('Bug fix: reserved word as case_item label name inside case', () => {
    test('should not tokenize a block_close keyword used as case_item label name', () => {
      // Bug: `endcase` appearing as a case_item label name (followed by `:`) was
      // tokenized as block_close, causing the outer case/endcase pair to bind
      // prematurely to the label `endcase`, breaking the BlockPair set.
      const source = 'module m;\n  initial case (sel)\n    endcase: x = 1;\n    default: y = 0;\n  endcase\nendmodule';
      const pairs = parser.parse(source);
      // The outer case must pair with the trailing `endcase` (last one),
      // not the label `endcase` on the case_item line.
      const casePair = findBlock(pairs, 'case');
      assert.ok(casePair.closeKeyword, 'case must have a closing endcase');
      const trailingEndcaseOffset = source.lastIndexOf('endcase');
      assert.strictEqual(
        casePair.closeKeyword.startOffset,
        trailingEndcaseOffset,
        'case must pair with the trailing endcase, not the case_item label `endcase`'
      );
      // module must still pair
      const modPair = findBlock(pairs, 'module');
      assert.strictEqual(modPair.closeKeyword?.value, 'endmodule');
    });

    test('should not tokenize a block_open keyword used as case_item label name', () => {
      // Same class of bug for block_open keywords: `module` used as a case_item
      // label name must not be tokenized as a block opener.
      const source = 'module m;\n  initial case (sel)\n    module: x = 1;\n    default: y = 0;\n  endcase\nendmodule';
      const pairs = parser.parse(source);
      // Only the outer `module m;` must pair with `endmodule`. If the case_item
      // label `module` were tokenized, it would pair with the trailing
      // `endmodule` and the outer module would be orphaned.
      const moduleOpeners = pairs.filter((p) => p.openKeyword.value === 'module');
      assert.strictEqual(moduleOpeners.length, 1, 'exactly one module pair is expected');
      assert.strictEqual(moduleOpeners[0].openKeyword.startOffset, 0, 'outer module (at offset 0) must be the open keyword');
    });
  });

  suite('Bug fix: macro arg list string with backslash line continuation (CRLF, CR-only)', () => {
    test('should keep macro arg list closed across backslash-CRLF line continuation inside string', () => {
      // Bug: matchMacroArgList only skipped the `\` + 1 char in the string body. For
      // `\<CRLF>` it consumed `\` + `\r` but left `\n` as a bare newline, terminating
      // the string and ending the macro arg region prematurely. Keywords inside
      // `(...)` then leaked out and got tokenized.
      const source = `\`MACRO("test\\\r\nbegin x = 1; end")\nmodule m;\nendmodule\n`;
      const tokens = parser.getTokens(source);
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(beginTokens.length, 0, 'begin inside macro arg string must not be tokenized');
      assert.strictEqual(endTokens.length, 0, 'end inside macro arg string must not be tokenized');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });

    test('should keep macro arg list closed across backslash-CR line continuation inside string', () => {
      // CR-only line ending (legacy macOS): `\<CR>` is also a line continuation
      // per IEEE 1800-2017 §5.9. The macro arg region must extend past it.
      const source = `\`MACRO("test\\\rbegin x = 1; end")\nmodule m;\nendmodule\n`;
      const tokens = parser.getTokens(source);
      const beginTokens = tokens.filter((t) => t.value === 'begin');
      const endTokens = tokens.filter((t) => t.value === 'end');
      assert.strictEqual(beginTokens.length, 0, 'begin inside macro arg string must not be tokenized');
      assert.strictEqual(endTokens.length, 0, 'end inside macro arg string must not be tokenized');
      const pairs = parser.parse(source);
      assertSingleBlock(pairs, 'module', 'endmodule');
    });
  });

  suite('Bug fix: isValidWaitOpen newline handling in wait fork statement', () => {
    // Bug: isValidWaitOpen's forward scan past `wait` only skips space/tab,
    // not `\n` or `\r`. So `wait\nfork;` slips past the `fork` detector and
    // makes the `wait` keyword falsely treated as a control-keyword opener
    // that pairs with a subsequent `end`. Since SystemVerilog is free-form,
    // a newline between `wait` and `fork` is equivalent to a space, so
    // `wait\nfork;` is the same statement as `wait fork;` and must be rejected.
    test('should not treat wait\\nfork; as a control keyword opener', () => {
      const source = 'module m;\n  initial begin\n    wait\n    fork;\n    x = 1;\n  end\nendmodule';
      const pairs = parser.parse(source);
      // Expected: module/endmodule, initial/end, begin/end (3 pairs)
      // wait must NOT pair with end
      assertBlockCount(pairs, 3);
      const waitPair = pairs.find((p) => p.openKeyword.value === 'wait');
      assert.strictEqual(waitPair, undefined, 'wait\\nfork; should not open a block');
    });

    test('should not treat wait\\rfork; as a control keyword opener (CR-only)', () => {
      const source = 'module m;\r  initial begin\r    wait\r    fork;\r    x = 1;\r  end\rendmodule';
      const pairs = parser.parse(source);
      assertBlockCount(pairs, 3);
      const waitPair = pairs.find((p) => p.openKeyword.value === 'wait');
      assert.strictEqual(waitPair, undefined, 'wait\\rfork; should not open a block');
    });
  });

  suite('Bug fix: O(N^2) cast detection on attribute-prefixed modules', () => {
    // Bug: isPrecededByDataTypeKeyword's cast-detection branch enters the `)`
    // depth-walk path whenever a close keyword (or block opener like `module`)
    // is preceded by `)`. The `)` of a SystemVerilog attribute closer `*)`
    // triggers this path: the loop scans backward through the excluded
    // attribute region looking for the matching `(`, but the `(` of `(*` is
    // itself inside the excluded region and gets skipped via j--. The loop
    // then runs past the attribute into prior source content. With N attribute-
    // prefixed modules in sequence, the loop for the Nth module scans back ~N
    // characters of prior modules, producing total O(N^2) work.
    test('should parse 4000 attribute-prefixed modules well under the debounce budget', () => {
      // Pre-fix measurement at N=4000 took >12s. Linearized parsing finishes
      // in tens of ms; a 4000ms ceiling keeps headroom for CI load and GC
      // pauses while still failing by an order of magnitude if the O(N^2)
      // cast-detection scan returns.
      const warmUp = '(* attr *) module m; endmodule\n'.repeat(100);
      for (let i = 0; i < 5; i++) {
        parser.parse(warmUp); // JIT warm-up on a small, fast source
      }
      const source = '(* attr *) module m; endmodule\n'.repeat(4000);
      const start = performance.now();
      const pairs = parser.parse(source);
      const elapsed = performance.now() - start;
      // Every (* attr *) module m; endmodule generates one module/endmodule pair.
      assertBlockCount(pairs, 4000);
      assert.ok(
        elapsed < 4000,
        `4000 attribute-prefixed modules parse took ${elapsed.toFixed(0)}ms, expected < 4000ms (O(N^2) cast-detection regression)`
      );
    });
  });

  generateCommonTests(config);
});
