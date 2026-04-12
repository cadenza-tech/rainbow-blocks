# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.31] - 2026-04-12

### Fixed

- Ada: Skip `exception` keyword after `raise` and `new` in tokenize so type references like `raise Exception;` and `type T is new Exception;` no longer leak a spurious intermediate into the enclosing block
- Crystal: Support `<<~` squiggly heredoc syntax by extending `matchHeredoc` to accept tilde prefix alongside dash, and updating tokenize filter and failed-opener skip to handle `<<~` openers
- Elixir: Allow parenthesized block keywords (`if(true) do...end`, `defmodule(M) do...end`) by replacing the blanket `(` rejection in `isValidBlockOpen` with a `hasCommaInParens` check that only rejects multi-arg function call form (`if(cond, do: val)`)
- Erlang: Distinguish grouping parentheses from function call parentheses in `isInsideModuleAttributeArgs` so block expressions wrapped in grouping parens inside `-define` body (e.g., `(fun(X) -> X end)`) are no longer filtered
- Fortran: Treat `C`/`c` followed by a digit at column 1 as a fixed-form comment by narrowing the identifier heuristic from `[a-zA-Z0-9_]` to `[a-zA-Z_]`, so numbered comment markers like `C1`, `C123` are correctly excluded
- Ruby: Override `matchBlocks` to skip `in` as an intermediate when the enclosing block opener is `for`, since `in` in `for x in collection` is a syntactic separator, not a section boundary like `case`/`in` pattern matching

### Refactored

- Extract validation helpers from Pascal, Verilog, Ruby, and Bash parsers into dedicated `*Validation.ts` files using callback interface pattern
- Extract helper functions from AppleScript, COBOL, Julia, and Erlang parsers into dedicated `*Helpers.ts` files
- Extend shared test generators with common excluded region patterns (single-quoted strings, comment at end of line, escaped quotes) and Ruby/Crystal interpolation tests, replacing inline duplicates across 16 test files

## [1.1.30] - 2026-04-12

### Fixed

- Ada: Allow newlines and `--` line comments between `end` and the type keyword in `COMPOUND_END_PATTERN` so compound ends split across lines (e.g., `end\n  if`) are recognized as a single compound token, preventing nested `if` blocks from being mispaired
- AppleScript: Require logical line start for `try` in `tryMatchSingleKeywordToken` so mid-line occurrences after expressions (e.g., `doStuff() try`) no longer open a spurious block that steals the enclosing handler's `end`
- Bash: Exclude closing quotes (`"`, `'`, `` ` ``), closing parens/braces/brackets (`)`, `}`, `]`) from `isCommentStart` character class so `$(echo x)#tag`, `echo "foo"#tag`, and similar constructs no longer treat `#` as a comment start
- Crystal: Skip backtick command literals in addition to quoted strings inside `{% %}` and `{{ }}` macro templates so `{% `cmd %}` %}` no longer prematurely closes the macro at `%}` inside the backtick body
- Elixir: Treat `\\` as an escape sequence in uppercase sigil bodies (`~S`, `~R`) so `~S(\\)` correctly terminates at the closing delimiter instead of consuming the rest of the source
- Erlang: Preserve block expressions (`fun/end`, `case/end`, `try/end`) inside `-define` macro body after the first top-level comma via new `DEFINE_ATTR_PATTERN` and `sawCommaAtTopLevel`/`insideNestedCall` tracking in `isInsideModuleAttributeArgs`, while still filtering tuple atoms (`{begin, end}`) and nested function calls (`nested(begin)`)
- Fortran: Reject bare `procedure NAME` (without `::` or `module` prefix) inside generic `interface` blocks in `isValidProcedureOpen` so procedure references in generic interfaces no longer pollute the block stack with stale openers
- Pascal: Add `isInsideParens` helper and reject `class`/`interface`/`object` as block openers when they appear inside unbalanced `(`, so parenthesized comparisons like `if (x = class)` no longer misinterpret the keyword as a type declaration
- Pascal: Validate `asm` context in both `isValidBlockOpen` and `addAsmExcludedRegions` by checking the preceding character on the same physical line and the following character, rejecting `asm` used as an identifier (e.g., `var asm: Integer;`, `WriteLn(asm)`) so the enclosing `begin`/`end` block retains its pairing
- Ruby: Accept bare multi-heredoc list after an identifier in `matchHeredoc` when the rest of the line contains `, <<`, so `raise <<A, <<A` correctly exposes both heredoc bodies instead of parsing the second heredoc's content as real code
- Verilog: Skip leading whitespace before arithmetic operators in the backtick-macro branch of `skipDelayExpression` so delay expressions like `#\`CLK /2` and `#\`CLK + 2` no longer prevent `always` from pairing with its `begin`/`end`
- VHDL: Add `context` to `blockOpen` keywords and `COMPOUND_END_TYPES` to support VHDL-2008 context declarations (`context name is ... end context name;`)

## [1.1.29] - 2026-04-11

### Fixed

- Ada: Add Ada 2005+ extended return statement support (`return X : T do ... end return`) by adding `return` to `blockOpen` and `COMPOUND_END_TYPES`, with `isExtendedReturn` helper that scans forward for `NAME : TYPE ... do` pattern to distinguish from simple `return;`/`return expr;` statements
- Ada: Filter `exception` tokens immediately preceded by `:` so variable declarations like `E : exception;` no longer leak an intermediate into the enclosing block
- AppleScript: Reject compound `end`/`end tell`/`end if`/`end repeat`/`end try` and bare `end` when not at physical line start, so mid-line occurrences inside expressions (e.g., `{item 1, item 2 end tell}`) no longer close outer blocks. Added `isAtPhysicalLineStart` helper that allows continuation via `¬`
- Bash: Skip backslash-escaped characters in `scanSubshellBody` so `\"` inside `$(...)` does not start a double-quoted string and swallow the rest of the source
- COBOL: Reject hyphenated identifiers ending in `REPLACE`/`REPLACING` (e.g., `MY-REPLACE`, `X-REPLACING`) in `isPrecededByKeyword` and `findPrecedingKeywordPosition` so `==...==` after such identifiers is not treated as pseudo-text
- COBOL: Cap unterminated pseudo-text (`==unfinished...`) in `matchPseudoText` to the opening `==` so subsequent blocks remain parseable during incremental editing
- Crystal/Ruby: Reject closing bracket characters (`)`, `]`, `}`, `>`) as percent-literal opening delimiters in `getMatchingDelimiter` via new `CLOSE_BRACKET_CHARS` set, so inputs like `%}` no longer swallow following code as unterminated literal
- Fortran: Reject array-element assignments `KEYWORD(n) = value` (e.g., `do(1) = 5`, `block(i, j) = val`) in `isValidBlockOpen` by checking the text after the matching `)` for `=`
- Fortran: Reject Fortran 77 labeled DO loops (`do <label> var = ...`) as block openers since they close via labeled `continue` rather than `end do`
- Fortran: Reject `module procedure NAME` inside `interface` blocks via new `isInsideInterfaceBlock` helper that counts unclosed `interface`/`end interface` pairs, while keeping `module procedure` body in submodule `contains` sections as a real block
- Pascal: Change excluded-region skip in `isTypeDeclarationOf` from single `if` to `while` loop so multiple consecutive comments between `array`/`set`/`file` and `of` (e.g., `array { c1 } { c2 } of Integer`) no longer cause `of` to be counted twice as intermediate
- Ruby: Reject Ruby 3.0+ endless method definitions (`def foo = expr`, `def self.foo = 42`) via new `isEndlessMethodDef` helper that scans past the method name (with optional `self.`/`Class.` receiver, operator names, `?`/`!` suffixes, and parameter list) to detect a standalone `=`
- Verilog: Close malformed `(*)` attribute immediately in `matchAttribute` instead of scanning to end of source, so stray `(*)` no longer hides the rest of the file
- Verilog: Skip leading whitespace before arithmetic operators in `skipDelayExpression` so delay expressions like `#10 /2`, `#10 + 2`, and `#T / 2` no longer prevent `scanForBeginAfterControl` from finding `begin`
- VHDL: Reject null procedure declarations (`procedure noop is null;`) and VHDL-2019 expression functions (`function f(...) is (expr);`) in `isValidFuncProcOpen` by inspecting the token after `is`, so parent blocks retain their `begin` intermediate

## [1.1.28] - 2026-04-10

### Fixed

- Bash: Remove early return for `done` and `fi` in `isCasePattern` so the backward scan for `;;`/`;&`/`;;&`/`in`/`|` separators runs correctly when these keywords appear as case patterns on their own line
- COBOL: Replace `\bCOPY\b` with lookbehind/lookahead pattern in `isInCopyStatement` to prevent false matches on hyphenated identifiers like `COPY-RECORD` and `MY-COPY`
- Crystal: Add `_lastExcludedRegion` tracking in `findExcludedRegions` and pass it to `isRegexStart` so that a regex with flags (`/a/i`) followed by another regex (`/if end/`) is correctly excluded
- Fortran: Add `rank` to `blockMiddle` keywords for Fortran 2018 `select rank` construct, skip the first `rank` after `select` as opening guard, and restrict `rank` intermediates to `select` blocks only
- Fortran: Add `isFollowedByAssignmentOp` check to skip `block_middle` keywords used as variable names in assignment LHS (e.g., `else = 1`, `case = n`)
- Verilog: Reject bare backslash (`\` followed by whitespace) as escaped identifier in `trySkipLabel` to prevent false label detection
- Verilog: Add `isPrecededByExternThroughQualifiers` to handle 2+ qualifiers between `extern` and `function`/`task` (e.g., `extern protected static function`), and check for `extern` before `virtual function`/`task`
- VHDL: Add semicolon as statement boundary in `isInsideParens` to prevent unclosed `(` from prior statements from suppressing keywords
- VHDL: Skip blank lines without incrementing `linesChecked` in the `is` keyword filter backward scan to correctly handle type declarations with many blank lines before `is`

## [1.1.27] - 2026-04-09

### Fixed

- Ada: Filter `is` block_middle tokens followed by non-body keywords (`separate`, `abstract`, `new`, `null`, `<>`) to prevent leaked intermediates from filtered subprogram declarations
- COBOL: Stop pseudo-text `==` scanning at `END-EXEC`/`END-EXECUTE` boundaries inside EXEC blocks to prevent excluded region from extending past the block
- Erlang: Include digits in word scanning within `isCatchExpressionPrefix` and `isCatchFollowedByClausePattern` to correctly handle identifiers like `end2` and `error1`
- Fortran: Reject `module function` and `module subroutine` as `module` block openers (not just `module procedure`) inside submodule `contains` sections
- Ruby: Set heredoc excluded region end to terminator line end (excluding trailing newline) to prevent `isRegexStart` from misclassifying `/` as division on the following line
- VHDL: Skip multiple consecutive blank lines when scanning backward for entity instantiation colon in `isValidEntityOrConfigOpen`

## [1.1.26] - 2026-04-06

### Fixed

- AppleScript: Remove unnecessary keyword space/tab check before `of` pattern suppression in `isValidBlockClose`
- Bash: Remove `[[ ]]` double-bracket depth tracking and command position checks inside subshell scanning
- COBOL: Remove block opener verb check in `PERFORM` paragraph call detection
- Crystal: Remove macro template excluded-region check and `$?`/`$!`/`$~`/`$.` global variable check in `isPostfixConditional`
- Elixir: Remove `::` type spec operator prefix check for keyword filtering
- Erlang: Remove closing bracket/paren forward heuristic for `catch` context detection
- Fortran: Remove `end(1)%x` derived type component access check in `isValidFortranBlockClose`
- Julia: Pass keyword length to `isInsideSquareBrackets` for correct `hasUnmatchedBlockOpenerBetween` range
- Lua: Simplify `isPrecededByDotOrColon` to skip only same-line whitespace without excluded region or trailing-dot number handling
- MATLAB: Remove surrogate pair Unicode letter handling in transpose operator detection
- Octave: Remove surrogate pair Unicode letter handling in transpose operator detection
- Pascal: Remove `isIfThenElse` and `isTypeDeclarationOf` tokenize filtering for `else` and `of` intermediates
- Ruby: Remove `%%` double percent exclusion in percent literal detection
- Ruby: Remove regex-after-regex excluded region check in `isRegexStart`
- Verilog: Simplify `trySkipLabel` to skip only whitespace between identifier and colon
- Verilog: Add early return after `skipBaseSpecifierSuffix` and remove recursive arithmetic operator handling in `skipDelayExpression`
- VHDL: Restructure comment-only line detection in `isFilteredIs` to skip empty lines before checking
- VHDL: Remove `hasEndKeywordOnSameLine` check in `for` configuration specification detection
- VHDL: Remove inline comment check after `else` in signal assignment detection

## [1.1.25] - 2026-04-05

### Fixed

- Ada: Filter `block_middle` tokens (`then`, `else`, `elsif`, `when`, `is`) inside parenthesized expressions (Ada 2012 conditional/case expressions)
- AppleScript: Support nesting in chevron/guillemet (`\u00AB...\u00BB`) excluded region matcher
- Bash: Reject keywords immediately followed by an excluded region as word concatenation (e.g., `done"x"`, `fi$(cmd)`)
- Bash: Reject `keyword[` as array variable reference regardless of what follows `]`
- Bash: Recognize `coproc NAME { }` as command grouping in tokenization
- Erlang: Handle `>>` (binary close) before `catch` in `isCatchExpressionPrefix` using clause pattern disambiguation
- Fortran: Skip string literals containing `)` in `skipConsecutiveParenGroups`
- Julia: Consume suffix characters after closing backtick in prefixed command macros (`cmd\`test\`flags`)
- Julia: Skip dot-preceded `end` in `hasUnmatchedBlockOpenerBetween` (field access like `obj.end`)
- Julia: Skip dot-preceded `for` in `hasForBetween` (field access like `obj.for`)
- Julia: Use Unicode category checks (`\p{L}`, `\p{N}`) in `matchSymbolLiteral` to distinguish identifier vs operator symbols
- Pascal: Recognize `#nn` character constants as valid variant case labels in `isVariantCase`
- Pascal: Loop through multiple type modifiers before `class` in `isInsideRecord` backward scan
- Ruby: Treat range operators (`..`, `...`) as implicit line continuation in `endsWithContinuationOperator`
- Ruby: Filter keywords used as method names after `def` (e.g., `def do`, `def end`)
- VHDL: Strip excluded regions (block comments) when building statement text for `is` keyword filtering

## [1.1.24] - 2026-04-04

### Fixed

- Ada: Add Unicode letter adjacency check for compound end keywords in tokenization
- Ada: Handle `protected`/`task` preceding `type` on previous line in type declaration scanning
- Ada: Skip `type`/`subtype` inside parentheses in type declaration detection
- Ada: Restrict `begin` context merge to valid context keywords (`procedure`, `function`, etc.)
- AppleScript: Replace `isInsideIfCondition` and `isInsideTellToOneLiner` with unified `isAtLogicalLineStart` check
- AppleScript: Extend bare `end` preposition rejection to include `by`, `before`, `after`, `at`
- Bash: Distinguish brace expansion (`{a,b}`) from command group closer (`}`) in command position
- Bash: Verify whitespace between `time` command and flags (`-p`, `--`)
- Bash: Handle `+=` compound assignment operator in variable assignment detection
- Bash: Exclude `#` from assignment scan stop characters
- Bash: Handle excluded regions (strings, substitutions) adjacent to case pattern keywords
- Bash: Add `)` and `}` as command position characters, and `fi`/`done`/`esac` as preceding shell keywords
- Bash: Handle heredoc terminator followed by `)` in subshell context
- Bash: Reject keywords concatenated with preceding excluded region (no newline separator)
- COBOL: Use string/comment-aware period scanning in COPY statement context detection
- COBOL: Prevent string literals from spanning multiple lines
- Crystal: Handle character literals (`?{`, `?}`, `?"`) inside macro template strings
- Crystal: Limit octal escape sequences to 3 digits in character literals
- Crystal: Treat `?"` and `?'` as valid character literals (not ternary before string)
- Crystal: Handle surrogate pairs in character literal detection
- Elixir: Exclude `&&` operator from capture operator `&` prefix detection
- Elixir: Detect keyword followed by `do` as value context (not nested block)
- Erlang: Check for top-level comma after `::` type annotation to allow catch in function arguments
- Erlang: Distinguish comments from value expressions in catch clause backward scan
- Erlang: Check catch clause pattern after `->` to distinguish clause body from try-catch section
- Erlang: Track block nesting depth in `isCatchFollowedByClausePattern` forward scan
- Fortran: Skip comment-only lines in `isAfterDoubleColon` continuation line scanning
- Fortran: Reject block open keywords preceded by operator/expression context
- Fortran: Reject block open keywords used as variable names in assignments
- Fortran: Skip block open keywords inside parenthesized expressions in `matchBlocks`
- Julia: Detect `for` at start of brackets/parentheses as block (not generator)
- Julia: Replace `hasBlockOpenerBetween` with depth-tracking `hasUnmatchedBlockOpenerBetween`
- Julia: Handle unmatched `[` (unclosed bracket) to keep keywords valid
- Julia: Skip dot-preceded keywords (field access like `range.begin`) in block opener detection
- Julia: Include `;` in comma-at-depth-zero check for matrix literal semicolons
- Julia: Remove block keyword boundary check from string macro suffix consumption
- Lua: Restrict `isPrecededByDotOrColon` to same-line whitespace (stop at newlines)
- Lua: Track pending loop-do depths per nesting level instead of flat counter
- MATLAB: Handle hex (`0xFF`) and binary (`0b1010`) literal prefixes in numeric detection
- Octave: Support additional compound assignment operators (`\=`, `**=`, `.**=`, `.\=`)
- Pascal: Support multiple consecutive type modifiers (`packed sealed class`)
- Pascal: Detect comparison context for `=` sign (e.g., `if x = class` is not a type definition)
- Pascal: Stop `class of` detection at newlines and multi-line comments
- Pascal: Support Delphi GUID bracket syntax (`interface['{GUID}']`) in forward declaration detection
- Ruby: Track last excluded region for context-aware regex detection after comments
- Ruby: Support implicit operator line continuation in logical line start detection
- Ruby: Handle `$$` global variable in `$;` semicolon detection
- Ruby: Handle `$$` and `?$` context in `$'`/`$"`/`` $` `` global variable detection
- Ruby: Include trailing regex flags in `%r` percent regex excluded region
- Ruby: Disable backslash escaping when backslash is the percent literal delimiter
- Verilog: Skip comments between modifier keywords and block keywords in validation
- Verilog: Handle `final` and `#0` delay qualifiers in assertion verb detection
- Verilog: Reject `virtual interface` as variable type declaration (not a block)
- Verilog: Handle qualifier keywords between `extern` and `function`/`task`
- Verilog: Tighten DPI import detection to require `"DPI` after `import`/`export`
- Verilog: Add `` `include <file.vh> `` angle-bracket filename as excluded region
- VHDL: Handle `: type` pattern before `is` on same line in type declaration detection
- VHDL: Handle loop labels between `exit`/`next` and `when` keyword
- VHDL: Reject `for` in configuration specifications (`for <id> : <id> use entity ...`)
- VHDL: Verify `else` in signal assignment is not inside `if`/`elsif` then-branch

## [1.1.23] - 2026-03-31

### Fixed

- Base: Distinguish `block_middle` and `block_open` intermediates in nest level calculation for correct sibling vs child detection
- Ada: Continue type declaration backward scan past plain identifier lines (type name on its own line)
- AppleScript: Reject `if` keyword nested inside another `if`/`repeat` condition expression
- AppleScript: Fix `set`/`copy` keyword-as-variable patterns to allow preceding content on the same line
- Bash: Fix command position detection across line continuations with excluded regions
- Bash: Add `time` command with flags (`-p`, `--`) as command position prefix
- Bash: Fix environment variable assignment detection for consecutive `=` characters (`===`)
- Bash: Add glob character handling in case patterns (`if*`, `for?`, `while[abc]`)
- Bash: Handle empty case statement (`case $x in esac`) by detecting `in` before `esac`
- COBOL: Scan backward through `==...== BY ==...==` chains to find REPLACING/REPLACE context keyword
- COBOL: Verify COPY statement context for REPLACING keyword with string/comment-aware scanning
- Crystal: Fix heredoc identifier scanning to read full identifier between quotes (not assume empty)
- Crystal: Reject character literal `?` after closing brackets (`)`, `]`, `}`) as ternary operator
- Crystal: Propagate heredocState through string interpolation for correct heredoc body skipping
- Erlang: Improve `catch` context detection to distinguish clause separator from expression prefix using forward `->` scan
- Erlang: Allow newline between `fun` and `(` in type annotation context
- Fortran: Validate no executable content between closing `)` and `then` keyword
- Julia: Skip keywords followed by `!` (mutating function naming convention)
- Julia: Track unmatched block openers in bracket/paren context to distinguish completed block expressions from comprehensions
- Julia: Detect comma at depth zero to distinguish tuples/calls from generators
- Julia: Check for block openers between `[` and keyword in square bracket validation
- Lua: Skip whitespace between dot/colon operator and keyword (`obj . end`)
- Pascal: Skip `class`/`interface` forward declarations (`class;`, `class(TBase);`)
- Pascal: Skip `class of` class reference type (no matching `end`)
- Pascal: Check for `=` before `class` to distinguish type definitions from method modifiers
- Pascal: Allow newlines after `:` in variant case field detection
- Ruby: Propagate heredocState through string interpolation for correct heredoc body skipping
- Verilog: Allow `fork` to fall through to label colon and other validation checks
- Verilog: Reject `function`/`task` in DPI import/export declarations
- Verilog: Reject `interface` used as port type inside parenthesized port list
- Verilog: Only reject `pure virtual function`/`task` (not `virtual function`/`task` which has a body)
- Verilog: Skip whitespace before block comments in label colon backward scan
- VHDL: Increase backward scan limit from 2 to 5 lines for `is` context detection
- VHDL: Track parenthesis depth across lines in `for` validation to handle multi-line port/generic maps
- VHDL: Increase backward scan limit from 5 to 10 lines for `for` generate validation
- VHDL: Increase backward scan limit from 5 to 15 lines for `loop` validation

## [1.1.22] - 2026-03-29

### Fixed

- Base: Fix nest level calculation to skip sibling blocks sharing the same close offset
- Ada: Fix type/subtype detection when multiple type declarations appear mid-line
- Ada: Fix paren depth tracking to skip excluded regions in backward scan
- Ada: Fix discriminant list handling to detect balanced parens that don't bridge type declarations
- Ada: Fix standalone `loop` validation after `for` representation clause separated by semicolon
- AppleScript: Fix string literal parsing to handle doubled-quote escaping
- AppleScript: Add `tell...to` one-liner detection to reject block keywords in expression context
- AppleScript: Fix logical line boundary detection to skip excluded regions
- AppleScript: Fix `of <keyword>` property access detection across continuation lines
- AppleScript: Expand postfix conditional detection for `repeat while/until` conditions
- AppleScript: Fix `isInsideIfCondition` to accept keyword length for accurate boundary detection
- AppleScript: Fix keyword-as-variable detection with continuation character and excluded region handling
- Bash: Add `[[ ]]` double-bracket depth tracking to prevent `#` misdetection as comment
- Bash: Add environment variable assignment detection (`VAR=value` before keywords)
- Bash: Add extglob pattern detection to reject keywords inside `?(...)`, `*(...)`, `+(...)`, `@(...)`, `!(...)`
- Bash: Add hyphenated command name detection to reject keywords like `done-handler`
- Bash: Fix case pattern detection to reject block close keywords (`esac`, `fi`, `done`)
- Bash: Fix comment detection to handle additional metacharacters before `#`
- Bash: Fix double-bracket `[[` command position validation
- Bash: Fix pipe detection for block separator validation
- COBOL: Remove spurious `times` keyword from PERFORM validation
- COBOL: Add sub-language keyword verification after EXEC/EXECUTE
- COBOL: Fix pseudo-text delimiter `==...==` handling with fallback for unclosed delimiters
- COBOL: Improve REPLACING/REPLACE/ALSO/BY keyword detection with context-aware backward scan
- Crystal: Fix template delimiter parsing to reject `{%` control tag
- Crystal: Fix brace depth tracking in templates for `}}}` edge case
- Crystal: Fix character literal detection to skip when followed by quote (ternary before string)
- Crystal: Expand character escape sequence handling for `\uXXXX`, `\xNN`, `\oNNN`
- Crystal: Improve postfix conditional detection with expanded preceding block keywords
- Elixir: Add range operator `..` detection to reject definition keywords after `..`
- Elixir: Add capture operator detection (`&end`, `&fn` as function references, not keywords)
- Elixir: Add keyword-as-value detection for bare values in `do:` one-liners
- Elixir: Fix `end` boundary detection to include `:` in non-word character check
- Elixir: Fix block keyword tracking in nested `do:` one-liner contexts
- Elixir: Improve Unicode identifier detection for surrogate pairs
- Erlang: Add module attribute argument detection to filter keywords inside `-define(...)`, `-module(...)`, etc.
- Erlang: Add `catch` expression prefix detection to distinguish from try-catch separator
- Erlang: Fix triple-quoted string/atom matching for prefixed forms
- Erlang: Fix whitespace pattern in function reference matching
- Erlang: Add extended backward scan for `::` in type contexts
- Erlang: Improve record detection inside `-record(...)` brace bodies
- Fortran: Add constructor call detection for `type(name)(args)` pattern to reject as block opener
- Fortran: Fix `then` validation to ensure end-of-line position (not a variable name)
- Fortran: Fix continuation line handling across `&` boundaries
- Fortran: Add operator/assignment/statement keyword precedence detection for `end`
- Fortran: Fix column 1 comment detection for modern Fortran identifiers
- Fortran: Add string concatenation `//` detection to reject `end` in concatenation context
- Fortran: Filter block_middle keywords inside parenthesized expressions
- Julia: Add curly brace type parameter detection to reject keywords in `Dict{begin, end}`
- Julia: Fix block expression detection in array construction (`[if true 1 else 2 end]`)
- Julia: Improve comprehension filter detection with `for...if` pattern checking
- Julia: Enhance generator expression handling with named tuple context
- Julia: Fix string macro suffix to stop before block keywords
- Julia: Add assignment detection in parenthesized contexts for named tuples
- Lua: Fix concatenation operator `..` detection to distinguish from field access `.`
- MATLAB: Add variable assignment detection (`end = 5`) to reject keywords used as variables
- MATLAB: Fix section keyword validation for string literals and line continuations
- MATLAB: Fix decimal point detection to distinguish from struct field access
- MATLAB: Add Octave backslash line continuation support in dot-precedence checking
- Octave: Add line continuation handling for `...` and `\` forms
- Octave: Improve middle keyword filtering for parenthesized/bracketed contexts
- Octave: Enhance assignment detection across continuation lines
- Pascal: Add type modifier keywords (`abstract`, `sealed`, `packed`) detection for type alias checking
- Pascal: Fix forward declaration detection for Delphi GUID bracket syntax `interface['{GUID}']`
- Pascal: Add `class`/`object`/`interface` as field type reference detection (preceded by `:`)
- Pascal: Add method modifier detection for `class` keyword
- Pascal: Enhance variant case detection with char constants, ranges, and complex labels
- Pascal: Add double-quoted string support (FreePascal)
- Pascal: Improve `class of` pattern detection with newline awareness
- Ruby: Fix division operator detection for special global variables (`$?`, `$!`, `$~`, etc.)
- Ruby: Fix regex termination with character class tracking to prevent `[/]` false positives
- Ruby: Add method scope resolution detection (`class::Method`) to reject keywords after `::`
- Ruby: Fix postfix rescue/conditional to skip `$;` global variable semicolons
- Ruby: Enhance dot precedence checking with whitespace skipping and excluded region handling
- Ruby: Add operator symbol detection (`:+`, `:*`, `:-@`, etc.) for symbol literal parsing
- Ruby: Fix special global variables (`` $` ``, `$'`, `$"`) in string context
- Verilog: Expand `endmodule` to match `macromodule` openers
- Verilog: Expand `endcase` to match `randcase` openers
- Verilog: Add new block types: `covergroup/endgroup`, `specify/endspecify`, `primitive/endprimitive`, `table/endtable`, `config/endconfig`
- Verilog: Add `final` control keyword alongside `always` variants
- Verilog: Add macro name argument filtering for `` `ifdef ``/`` `ifndef ``/`` `elsif `` directives
- Verilog: Fix label detection to distinguish from scope resolution operator (`::`)
- VHDL: Fix `exit when`/`next when` in case blocks not treated as intermediates
- VHDL: Fix `for` in use-entity/configuration binding not rejected
- VHDL: Fix `is` in type/subtype/alias/attribute/file/group declarations not filtered
- VHDL: Fix `then` inside parenthesized expressions not rejected
- VHDL: Fix component instantiation vs declaration detection
- VHDL: Fix `isValidForOpen` backward scan to skip comment-only lines
- VHDL: Fix `elsif` generate treated as nested rather than sibling

## [1.1.21] - 2026-03-22

### Fixed

- AppleScript: Reject block keywords (`repeat`, `try`, `considering`, `ignoring`) used as condition values in `if ... then` pattern
- AppleScript: Reject compound block openers (`with timeout`, `with transaction`, `using terms from`) in `if ... then` condition
- COBOL: Restrict `==` pseudo-text detection to COPY REPLACING / REPLACE statement context (allow `==` as equality operator)
- Elixir: Add Unicode adjacency check for `end` keyword in `isDoColonOneLiner` scan
- Julia: Reject `end` inside double brackets `a[[end]]` as array indexing (recursive `isIndexingBracket` check)
- Octave: Filter out middle keywords (`else`, `elseif`, `case`, `otherwise`, `catch`) followed by assignment operators
- Verilog: Skip `//` single-line comments inside `` `define `` directive body (IEEE 1800-2017 section 22.5.1)

## [1.1.20] - 2026-03-22

### Fixed

- Ada: Add `entry` to compound end types (`end entry`)
- Ada: Fix multi-line discriminant list paren tracking in backward type declaration scan
- Ada: Fix backward type scan to stop at non-type, non-continuation lines
- Ada: Fix type-to-`is` separation check to recognize declaration keywords as separators
- Ada: Fix `or else` detection to recognize `select` keyword before `or` (not just `;`)
- Ada: Fix subprogram open validation to stop backward scan at newline
- AppleScript: Fix keyword-as-variable detection to strip excluded regions (block comments) before matching
- AppleScript: Fix continuation character regex to consume rest of line after `\u00AC`
- AppleScript: Fix `of <keyword>` pattern to detect keyword as object in property access
- AppleScript: Fix `<keyword> of` pattern to only match on same physical line
- AppleScript: Fix multi-line `if...then` detection to extend effective line end past block comments
- Bash: Add `$"..."` locale-specific double-quoted string as excluded region
- Bash: Fix `{` brace context to check for preceding block keywords (`then`, `do`, `else`, etc.)
- Bash: Fix keywords used as variable assignment (`done=`, `fi+=`, `done[0]=`) rejected as block keywords
- Bash: Fix gap excluded region clipping to not include newline before heredoc body
- Bash: Fix parameter expansion `${var:+{value}}` bare brace tracking
- Bash: Fix `${...}` inside double quotes to treat single quotes as literal characters
- COBOL: Add block close validation in tokenize
- COBOL: Fix pseudo-text `==...==` handling inside EXEC blocks
- Crystal: Add question mark char literal (`?x`, `?\n`, `?\u{XXXX}`) as excluded region
- Crystal: Filter out keywords preceded by `$` (global variables like `$end`)
- Crystal: Skip `do` preceded by `.`, `::`, `@`, or `$` in loop detection
- Crystal: Fix unbalanced `{` in macro templates to treat `}}` as template closer
- Crystal: Fix `#{}` interpolation inside nested double-quoted strings in macro templates
- Elixir: Fix escape handling in uppercase sigils to only escape closing delimiter
- Elixir: Fix Unicode atom support with surrogate pairs (codepoints outside BMP)
- Elixir: Fix sigil `~` detection to skip sigil modifier letters after closing delimiter
- Elixir: Fix character literal `?\x` and `?\u` escape validation to require hex digits
- Elixir: Reject function call form `keyword(...)` as block opener
- Elixir: Fix `do` detection to allow after `)`, `]`, `}`
- Elixir: Fix `fn`/`end` tracking to check `?!` suffixes and Unicode adjacency
- Erlang: Add OTP 27+ tilde-sigil support (`~"..."`, `~'...'`, `~s"..."`, `~S"..."`)
- Erlang: Add OTP 27+ triple-quoted string (`"""..."""`) and atom (`'''...'''`) support
- Erlang: Fix map key detection to allow multiple comment-only lines before `=>`/`:=`
- Erlang: Fix `-spec`/`-type` position offset calculation for indented declarations
- Fortran: Fix continuation line processing to skip comment-only and bare continuation lines
- Fortran: Fix `else where` continuation regex to allow `&`-only intermediate lines
- Fortran: Fix `else where` to extract `else` as intermediate for `if` blocks
- Fortran: Fix `isInsideParentheses` to search across continuation lines for opening quote
- Fortran: Fix `findContinuationLineStart` to treat CRLF as a unit
- Julia: Fix prefixed string escapes so all prefixed strings handle `\"` and `\\`
- Julia: Fix Unicode surrogate pair handling in tokenize word boundary check
- Julia: Fix `end` inside matched parentheses to be rejected as block close (`f(end + 1)`)
- Julia: Fix `hasBlockOpenerBetween` and `hasForInComprehension` to use `isAdjacentToUnicodeLetter`
- Julia: Fix symbol literal boundary check at end of source
- Lua: Skip keywords preceded by `.` or `:` (table field/method access like `t.end`, `obj:repeat`)
- Lua: Filter middle keywords preceded by `.` or `:` in tokenize
- Lua: Fix `isDoPartOfLoop` to break on `end`/`until` at depth 0 without pending closers
- MATLAB: Reject block openers inside parentheses or brackets
- MATLAB: Fix transpose detection after double-quote string closer
- Octave: Add `|=` and `&=` compound assignment operators
- Octave: Fix end keyword matching to require opener at top of stack
- Octave: Fix doubled quote escape to only apply for single-quoted strings
- Pascal: Fix variant record case detection to skip excluded regions between `case` and identifier
- Pascal: Fix `isInsideRecord` to skip `object` in method pointer syntax (`procedure of object`)
- Pascal: Fix `isInsideRecord` to track standalone `case...end` pairs in depth accounting
- Ruby: Skip `do` preceded by `.`, `::`, `@`, or `$` in loop detection
- Ruby: Fix hash key colon detection to allow `::` scope resolution after keywords
- Ruby: Fix global variables (`$!`, `$?`, etc.) recognized as complete expressions
- Ruby: Fix backslash continuation handling in postfix keyword detection
- Ruby: Fix heredoc handling inside regex interpolation
- Ruby: Fix character literal `?` detection after string/backtick closers
- Ruby: Fix `%}` inside interpolation incorrectly parsed as percent literal
- Verilog: Skip backtick-prefixed preprocessor directives in `isFollowedByBegin`
- Verilog: Handle `@identifier` single signal sensitivity (e.g., `always @clk begin`)
- Verilog: Handle backtick-prefixed macro identifiers in expression scanning
- Verilog: Fix `\`undef` directive prefix check
- Verilog: Skip preprocessor directive tokens in `matchBlocks` control keyword and else-next scanning
- Verilog: Fix block comments and single-line comments inside attributes
- Verilog: Fix unterminated block comments at `\`define` directive boundary
- VHDL: Reject block openers inside parenthesized expressions (port maps, generic maps)
- VHDL: Reject `wait while` as block opener
- VHDL: Support `end postponed process` compound end pattern
- VHDL: Fix compound end multi-word matching to use last word for type detection
- VHDL: Add semicolon check between `for`/`while` prefix and `loop` keyword
- VHDL: Reject newline inside character literals

## [1.1.19] - 2026-03-16

### Fixed

- Ada: Fix character literal spanning across newlines
- Ada: Fix `entry` with `is abstract`/`is separate`/`is new`/`is null`/`is <>` incorrectly treated as block opener
- Ada: Fix multiple `type`/`subtype` declarations on the same line (semicolon-separated)
- Ada: Fix `is` after discriminant list closing paren to scan previous lines for `type`/`subtype`
- Ada: Fix parenthesis depth tracking for semicolons inside discriminant parts
- Ada: Fix Ada 2012 expression function `is (expr)` incorrectly treated as block body
- AppleScript: Fix double-quoted strings to be single-line (stop scanning at newline)
- AppleScript: Fix content detection after `then` to treat strings, pipes, and chevrons as real content
- AppleScript: Fix `on error` to only match at logical line start
- AppleScript: Fix compound keyword matching to skip comments after continuation character
- AppleScript: Fix compound keyword matching to require newline after continuation character
- AppleScript: Fix excluded region overlap handling in logical line start detection
- Bash: Fix command starters (`then`, `do`, `else`, etc.) validated for position context
- Bash: Fix block close keywords (`fi`, `done`, `esac`) validated for position context
- Bash: Fix `{` command grouping to require valid command position or function definition context
- Bash: Fix heredoc delimiter pattern to accept numeric-only delimiters (e.g., `<<123`)
- Bash: Fix double-quote handling inside `${}` parameter expansion to use quote-toggling model
- COBOL: Fix Unicode adjacency check for keywords consistent with tokenize
- COBOL: Fix PERFORM followed immediately by END-PERFORM incorrectly rejected
- COBOL: Fix PERFORM paragraph call heuristics to handle `UNTIL`/`VARYING`/`WITH` after second word
- COBOL: Fix debug indicator `D`/`d` handling in free-format COBOL
- COBOL: Add END-EXECUTE keyword support in EXEC blocks
- COBOL: Fix inline comment stripping to include `>>` compiler directives
- Crystal: Fix macro template `{}` handling when single brace depth closes
- Crystal: Fix char literal `\u{` to stop at CR line ending
- Crystal: Fix postfix conditional and rescue whitespace normalization for tabs
- Elixir: Fix sigil `~` preceded by identifier characters incorrectly treated as sigil start
- Elixir: Fix `end` preceded by `..` range operator incorrectly treated as block close
- Elixir: Fix character literal `?\` at end of source
- Elixir: Fix `fn...end` and inner block nesting inside `hasDoKeyword` scan
- Erlang: Fix macro-prefixed identifiers (`?MODULE`) not recognized in fun references
- Erlang: Fix `end` as map key detection to check `#{` and `,` context with comment skipping
- Erlang: Fix quoted atom to terminate at backslash followed by newline
- Fortran: Fix compound end keywords (`enddo`, `endif`, etc.) used as variables, subscripted arrays, or component access
- Fortran: Add `isInsideParentheses` check to reject block keywords inside function arguments
- Fortran: Fix continuation line handling for parenthesis depth tracking
- Julia: Fix char literal escape to correctly advance past newline
- Julia: Fix prefixed strings so only `b"..."` processes backslash escapes
- Julia: Fix `isInsideBrackets` to return false inside parenthesized expressions
- Lua: Fix nested loop `do...end` tracking to consume corresponding `end` keyword
- Lua: Fix standalone `do` inside non-loop blocks tracked correctly during loop scan
- MATLAB: Fix `classdef` section keywords to validate following content (newline, EOF, `(`, or comment)
- MATLAB: Fix transpose detection after consecutive quotes (`A''`)
- MATLAB: Fix Unicode letter check to use `\p{L}` instead of `charCodeAt > 127`
- Octave: Add `endarguments`, `endspmd`, and `arguments` keywords
- Octave: Add `isCommentChar` override to recognize `#` as comment prefix
- Pascal: Fix `case TypeName of` to allow `of` on a separate line
- Pascal: Fix `class of` detection to skip excluded regions between `class` and `of`
- Pascal: Fix asm `end:` label detection to skip excluded regions between `end` and `:`
- Pascal: Fix asm regions to remove overlapping inner excluded regions
- Pascal: Fix `isInsideRecord` depth tracking to stop at unmatched block openers
- Ruby: Add regex flags `n`, `e`, `s`, `u` for encoding options
- Ruby: Fix division preceders to include `/` (regex after `/` is division)
- Ruby: Fix postfix conditional and rescue whitespace normalization for tabs
- Ruby: Fix character literal `\C-` at source boundary
- Ruby: Fix CRLF handling in `findLogicalLineStart` for backslash continuation
- Verilog: Fix `default` intermediate to only attach to `case`/`casex`/`casez` blocks
- VHDL: Add `units` keyword for physical type definitions
- VHDL: Fix `end` preceded by `.` (hierarchical reference) incorrectly treated as block close
- VHDL: Fix loop prefix (`for`/`while`) preceded by `.` incorrectly matched
- VHDL: Fix case branch arrow (`when choice =>`) incorrectly detected as port map association
- VHDL: Fix `wait` preceded by `.` incorrectly treated as wait keyword
- VHDL: Fix loop validation to search between prefix and position instead of same line only

## [1.1.18] - 2026-03-15

### Fixed

- Ada: Fix qualified expression `type_name'(expr)` misidentified as character literal
- Ada: Fix character literal containing single quote (`''''`)
- Ada: Fix `or` in `select` blocks incorrectly merged as short-circuit `or else`
- Ada: Fix `for` attribute/use clause detection to handle whitespace and comments between identifier parts
- Ada: Fix unterminated string detection for doubled-quote escapes
- AppleScript: Exclude pipe-delimited identifiers (`|identifier|`) from keyword matching
- AppleScript: Exclude chevron/guillemet syntax (`«...»`) from keyword matching
- AppleScript: Fix line continuation (`¬`) handling to skip excluded regions (comments)
- Bash: Fix backslash line continuation counting (even number of backslashes means no continuation)
- Bash: Fix CR-only line ending handling in subshell body scanning
- COBOL: Fix debug indicator (`D`/`d`) at column 7 in fixed-format to always treat as comment when sequence area has digits
- COBOL: Handle `>>` compiler directives inside EXEC block
- Crystal: Fix macro template `}}` closing when single brace depth is 1
- Crystal: Fix char literal `\u{XXXX}` form to stop scanning at newline
- Crystal: Fix heredoc terminator matching to use `trimStart()` instead of `trim()`
- Crystal: Fix single-quoted string escape to not skip past newline
- Crystal: Handle `%=` as compound assignment operator (not a percent literal)
- Crystal: Handle non-paired delimiter percent literals (e.g., `%|text|`)
- Elixir: Add character literal (`?x`, `?\escape`, `?\xNN`, `?\uNNNN`) as excluded region
- Elixir: Handle character literal inside string interpolation
- Elixir: Fix triple-quoted sigil closing to require line-start position in heredoc mode
- Elixir: Fix atom literal to not consume `@` character
- Elixir: Reject identifiers ending with `?` or `!` as block keywords (e.g., `fn?`, `if!`, `end?`)
- Elixir: Handle `?` prefix before keywords as character literal
- Elixir: Fix `fn`/`end` and `do:` keyword boundary to include `?` and `!` characters
- Erlang: Require `-attribute` to be at line start for module attribute detection
- Erlang: Allow `..` range operator before keywords (not treated as record field access)
- Fortran: Fix `isContinuationBlockForm` to allow optional space in `end where`/`end forall`
- Fortran: Handle `&` continuation line leading whitespace and `&` prefix in `isBlockWhereOrForall`
- Fortran: Fix `isValidIfOpen` to track parenthesis depth (don't match `then` inside parentheses)
- Julia: Handle broadcasted adjoint `A.'` as transpose operator
- Julia: Fix char literal and `matchQuotedString` to not let escape skip past newline
- Julia: Fix `isIndexingContext` to include backtick in preceding character pattern
- Julia: Fix symbol literal `!` to only appear at end of identifier
- Lua: Track non-loop block openers (`function`, `if`, `repeat`) when matching `do` to `for`/`while` loops
- Lua: Handle `\v` and `\f` whitespace in `\z` escape sequence
- MATLAB: Fix `isPrecededByDot` to only skip `...` line continuation excluded regions
- MATLAB: Handle Unicode characters before `'` as transpose operator
- Octave: Extend `isValidBlockOpen` assignment rejection to all block open keywords (not just `do`)
- Octave: Handle Unicode characters before `'` as transpose operator
- Pascal: Extend forward declaration detection to `interface` and `object` (not just `class`)
- Pascal: Skip comments between keyword and `(` in forward declaration detection
- Ruby: Fix heredoc identifier filtering to verify actual heredoc (distinguish `<<` shift operator)
- Ruby: Fix character literal hex/unicode escape scanning (`?\uNNNN`, `?\xNN`, `?\u{NNNN}`)
- Ruby: Add `not`, `and`, `or` to preceding block keywords for postfix detection
- Ruby: Handle `%=` as compound assignment operator (not a percent literal)
- Ruby: Handle non-paired delimiter percent literals (e.g., `%|text|`)
- Ruby: Handle character literals with special chars (`?'`, `?"`, `?{`, etc.) in interpolation scanning
- Ruby/Crystal: Fix backslash line continuation counting (even number of backslashes means no continuation)
- Ruby/Crystal: Fix string escape handling in `findLineCommentAndStringRegions`
- Ruby/Crystal: Handle percent literals and regex literals in `findLineCommentAndStringRegions`
- Verilog: Fix attribute string handling when terminated by newline
- Verilog: Handle block comments inside `` `define `` directive body
- Verilog: Fix backslash-newline inside string in `` `define `` directive
- Verilog: Handle exponent notation (e.g., `1.5e-3`) in numeric literal skipping
- VHDL: Fix character literal to handle surrogate pairs (codepoints > U+FFFF)
- VHDL: Fix `isValidLoopOpen` to track paired loop positions (avoid double-counting)
- Base parser: Fix `isAdjacentToUnicodeLetter` to handle surrogate pairs (codepoints > U+FFFF)
- Ada, AppleScript, COBOL, Fortran, Lua, Pascal, VHDL: Handle Unicode letter adjacency in tokenize to prevent false keyword matches (e.g., `αend`)

### Tests

- Add regression tests across 17 parsers

### Changed

- Update Node.js from 24.13.1 to 24.14.0
- Update Yarn from 4.12.0 to 4.13.0

## [1.1.17] - 2026-03-13

### Fixed

- Verilog: Fix `matchDefineDirective` string handler skipping past newline with `i += 2`
- Ruby: Fix `matchSymbolLiteral` missing `HeredocState` propagation
- Fortran: Fix `isValidFortranBlockClose` missing backward `%` check for `component%end`
- Crystal: Fix `isLoopDo` missing dot/scope/variable-prefix checks
- Elixir: Fix triple-quoted string closing `"""` not requiring line-start in heredoc mode

### Refactored

- Lua/Pascal: Extract shared `findLastNonRepeatIndex` to `parserUtils.ts`
- Ada: Extract 10 validation methods to `adaValidation.ts` with `AdaValidationCallbacks` interface
- VHDL: Extract 7 validation methods to `vhdlValidation.ts` with `VhdlValidationCallbacks` interface

### Tests

- Add regression tests across Verilog, Ruby, Fortran, Crystal, and Elixir parsers

## [1.1.16] - 2026-03-12

### Fixed

- Bash: Fix POSIX case patterns (e.g., `(pattern)`) being incorrectly treated as block structure
- MATLAB: Fix shell escape commands (`!command`) not being excluded from keyword detection
- Octave: Fix shell escape commands (`!command`) not being excluded from keyword detection

### Refactored

- Bash: Extract shared subshell scanning loop from `matchCommandSubstitution` and `matchProcessSubstitution` into `scanSubshellBody` in `bashStringHelpers.ts`
- Verilog: Extract 8 pure functions (`hasDollarAdjacent`, `matchVerilogString`, `matchEscapedIdentifier`, `matchAttribute`, `matchBlockComment`, `matchDefineDirective`, `matchUndefDirective`, `trySkipLabel`) to `verilogHelpers.ts`
- Fortran: Extract validation methods (`isValidFortranBlockClose`, `isValidProcedureOpen`, `isAtLineStartAllowingWhitespace`) to `fortranValidation.ts`
- Ada/VHDL/Fortran: Extract shared compound-end merge loop to `mergeCompoundEndTokens` in `parserUtils.ts`
- Tests: Merge duplicate test suites and relocate `generateCommonTests` to file end across 10 test files

### Tests

- Add regression tests for Bash, MATLAB, and Octave parser fixes

## [1.1.15] - 2026-03-09

### Fixed

- Bash: Fix incorrect comment detection in command/process substitution by properly handling `$#` special variable vs `#` comments
- Crystal: Fix macro string interpolation not properly tracking nested strings inside braces, causing incorrect brace depth counting
- Crystal: Fix symbol literal with interpolation not propagating heredoc state, causing incomplete exclusion regions
- Elixir: Fix `fn`/`end` keyword incorrectly matching method calls (`.fn`), scope resolution (`@fn`), and attribute access patterns
- Erlang: Fix `fun` in type specifications being incorrectly matched when preceded by `-spec`, `-type`, etc.
- Fortran: Fix compound `end &` continuation lines not properly skipping bare `&` continuation-only lines
- Lua: Fix `repeat-until` pairing by allowing `end` to close outer blocks when the topmost block is `repeat`
- Ruby: Fix loop keywords (`while`, `until`) incorrectly matching method calls (`.while`), scope resolution (`::while`), and variable prefixes (`$while`, `@while`)
- Verilog: Fix string escape sequence handling incorrectly ending excluded region before the backslash

### Refactored

- Ada: Extract `scanForwardToIs` and `isOrElseShortCircuit` to `adaHelpers.ts`
- COBOL: Remove redundant `getTokenType` override (base class handles it identically)
- VHDL: Extract excluded region helpers to `vhdlHelpers.ts`

### Tests

- Improve coverage across 10 parsers and merge duplicate suite names
- Merge duplicate Edge cases suites in baseParser test

## [1.1.14] - 2026-03-08

### Fixed

- Bash: Fix `$$#` comment detection using odd/even `$` count (`$#` is argument count variable, `$$#` is PID + comment, `$$$#` is PID + argument count)
- Bash: Skip excluded regions (comments) in `isCasePattern` backward scan to avoid false case pattern detection from `)` inside comments
- Ruby/Crystal: Extend excluded region to cover heredoc body when heredoc starts inside `#{}` interpolation and `}` closes on the same line as the heredoc opener
- Ruby/Crystal: Recognize `%{...}`, `%(...)`, `%[...]`, `%<...>` (percent literals without specifier after paired delimiters) as percent literals, not modulo operators

### Tests

- Add 12 regression tests across Bash, Ruby, and Crystal parser fixes
- Improve branch coverage across 12 parsers (61 tests added)

## [1.1.13] - 2026-03-05

### Fixed

- Ada: Rewrite `or else` short-circuit detection to check whitespace between `or` and `else` tokens instead of stack-based `select` lookup (fixes false negatives inside `select` when guards)
- AppleScript: Handle multiple consecutive continuation characters (`¬¬`) in compound keyword matching
- Bash: Prevent `<<<` here-string inside `$()`, `<()`, `>()` from being treated as heredoc operator
- Crystal: Add interpolation support (`#{}`) for double-quoted symbols (`:"`); single-quoted symbols remain interpolation-free
- Erlang: Exempt `block_close` tokens from `=>`/`:=` map key filter (allow `begin-end` as map key expression)
- Fortran: Handle bare `&` continuation-only lines and `& ! comment` lines in `CONTINUATION_COMPOUND_END_PATTERN` and `collapseContinuationLines`
- Julia: Handle prefixed strings (`r"..."`, `raw"..."`, etc.) inside `$()` interpolation blocks
- MATLAB: Fix out-of-bounds access in `isValidBlockOpen` when `=` is at end of source
- Verilog: Terminate string literals at backslash-newline inside `(* *)` attribute matching
- VHDL: Strip trailing `\r` from previous line in `isValidEntityOrConfigOpen` colon detection (CRLF line ending fix)

### Refactored

- Julia: Extract interpolation skip functions (`skipJuliaInterpolation`, `skipPrefixedStringInInterpolation`, `skipNestedJuliaString`, `skipCharLiteral`, `skipBacktickString`) to `juliaHelpers.ts`
- Lua/Pascal: Replace duplicate `findLastRepeatIndex` with shared `findLastOpenerByType` from `parserUtils.ts`

### Tests

- Add 18 tests across 11 parser test files for bug fix verification and regression coverage

### Other

- Fix missing carriage return in `.gitignore` Icon entry

## [1.1.12] - 2026-03-04

### Fixed

- Ada: Restrict `\s` to `[ \t]` in `isValidProtectedOpen`, `isValidForOpen`, and compound end pattern to avoid matching across newlines
- Ada: Use position-based `loop` pairing instead of count-based (rightmost `for`/`while` matched to following `loop`)
- AppleScript: Restrict `\s` to `[ \t]` in variable name patterns (`set`/`copy`/possessive), `isAtLogicalLineStart`, `isInsideIfCondition`, and `isUsedAsVariableName`
- Bash: Handle `\` line continuation in `isAtCommandPosition` (scan backward through continuation lines)
- Bash: Restrict `\s` to `[ \t]` in `isCasePattern` line-start and separator detection
- Bash: Flush pending heredocs when `)` closes `$()` or `<()`/`>()` before newline (heredoc body consumed correctly)
- Bash: Use Bash-specific double-quote handler in `matchArithmeticBracket` (was using generic `findStringEnd`)
- Base parser: Add `isAdjacentToUnicodeLetter` check in `tokenize` to reject keywords adjacent to non-ASCII Unicode letters (e.g., `αend`)
- COBOL: Restrict `\s` to `[ \t]` in fixed-format sequence area validation
- COBOL: Skip fixed-format column 7 comment lines and `*>` inline comments inside EXEC blocks
- Crystal: Restrict `\s` to `[ \t]` in `isForIn` statement-start detection
- Elixir: Restrict `\s` to `[ \t]` in `hasDoKeyword` `fn:` keyword argument detection (via `elixirHelpers`)
- Erlang: Restrict `\s` to `[ \t]` in `-spec`/`-type` line detection, `fun` reference patterns, `fun()` type context, and triple-quoted string line-start check
- Erlang: Stop quoted atom matching at newline characters in `fun` reference patterns
- Fortran: Restrict `\s` to `[ \t]` in `isValidTypeOpen`, `else if` continuation, `isContinuationBlockForm` end pattern, and `isPrecedingContinuationKeyword`
- Fortran: Bound `isStringContinuation` backward scan to line start (prevent unbounded scan)
- Fortran: Skip `!` inline comments in `collapseContinuationLines` (prevent `&` inside comments from being treated as continuation)
- Fortran: Restrict `\s` to `[ \t]` in `else if`/`else where` same-line and continuation detection
- Fortran: Restrict `\s` to `[ \t]` in compound end pattern
- Julia: Filter keywords adjacent to Unicode identifier characters (`\p{L}`) in `tokenize` and `hasBlockOpenerBetween`
- Julia: Add Unicode letter boundary check in `isGeneratorFilterIf` for `for` keyword detection
- Octave: Merge `matchMatlabBlockComment` and `matchOctaveBlockComment` into single `matchBlockComment` supporting cross-type delimiters (`%{`/`#}` and `#{`/`%}` are interchangeable)
- Pascal: Restrict `\s` to `[ \t]` in tagged variant case, tagless variant case, `class of`, and `class` parenthesis detection
- Pascal: Add `isInsideRecord` check for tagged variant case detection (only skip inside records)
- Verilog: Restrict `\s` to `[ \t]` in label skip whitespace scanning
- Verilog: Terminate string literals at newlines inside `(* *)` attribute matching (prevent unterminated strings from consuming past line boundaries)
- Verilog: Attach preprocessor intermediates (`` `else ``/`` `elsif ``) to matching preprocessor block (not nearest non-preprocessor block)
- VHDL: Restrict compound end pattern to same-line whitespace only (`[ \t]+` instead of allowing newlines)
- VHDL: Restrict `\s` to `[ \t]` in `isWaitFor` blank line detection and `isValidEntityOrConfigOpen` blank line detection
- VHDL: Check excluded regions in `isValidEntityOrConfigOpen` colon and `use` detection (handles comments on same line)
- VHDL: Search for `generate` between prefix keyword and `loop` across multiple lines in `isValidLoopOpen` (not just same line)
- VHDL: Restrict `\s` to `[ \t]` in compound end pattern and entity colon detection

### Refactored

- Bash: Extract `bashLeafHelpers.ts` with leaf functions (`isCommentStart`, `matchesWord`, `parseHeredocOperator`, `matchHeredocBody`, `matchDollarSingleQuote`, `matchSingleQuotedString`, `findSingleQuoteEnd`)
- Bash: Make `matchArithmeticExpansion` and `findBashDoubleQuoteEnd` module-private (not exported)
- Crystal: Delegate `skipInterpolation` and `skipRegexInterpolation` to shared helpers via `InterpolationHandlers` interface
- Crystal: Make `skipMacroString` module-private (not exported)
- Elixir: Make `getSigilCloseDelimiter` module-private (not exported)
- Fortran: Make `isStringContinuation` and `isContinuationBlockForm` module-private (not exported)
- Julia: Extract `juliaHelpers.ts` with `isSymbolStart` and `isTransposeOperator` pure functions
- MATLAB: Change `matchBlockComment` visibility from `private` to `protected` (for Octave override)
- Ruby: Delegate `skipInterpolation` and `skipRegexInterpolation` to shared helpers via `InterpolationHandlers` interface
- Ruby/Crystal: Extract shared `skipInterpolationShared`, `skipRegexInterpolationShared`, and `isRegexInInterpolation` to `rubyFamilyHelpers.ts`
- Ruby/Crystal: Make `getMatchingDelimiter` module-private (not exported)

### Tests

- Add 200+ tests across 18 parser test files for bug fix verification and regression coverage

## [1.1.11] - 2026-03-04

### Fixed

- Ada: Skip `task` without `is` (forward declarations like `task Name;`)
- Ada: Skip `package` renames and instantiations (`package X is new`, `package X renames`)
- Ada: Skip `protected` access types and forward declarations
- Ada: Validate `function`/`procedure`/`accept`/`record`/`task`/`package`/`protected`/`for`/`loop` with dedicated validators
- Ada: Rewrite `isInsideParens` with paren nesting tracking (fixes false negatives after commas and multi-line strings)
- Ada: Handle comments between `and` and `then` in short-circuit operator detection
- Ada: Extract `scanForwardToIs` helper for shared `is` keyword validation
- AppleScript: Support `U+00AC` line continuation character in compound keywords and line scanning
- AppleScript: Skip keywords inside `if ... then` conditions (e.g., `if tell then`)
- AppleScript: Handle block comments before line-start keywords with logical line scanning
- Bash: Fix `#` after `<>` redirect incorrectly treated as comment start
- Bash: Support multiple pending heredocs in command substitution and process substitution
- Bash: Use Bash-specific double-quote handler in arithmetic expansion and bare arithmetic evaluation
- Bash: Use Bash-specific double-quote handler in parameter expansion
- Bash: Fix `{` after backtick not recognized at command position
- Crystal: Handle backtick strings in heredoc line comment/string region scanning
- COBOL: Skip `END-EXEC` inside string literals in EXEC block matching
- COBOL: Handle pseudo-text delimiters (`==...==`) as excluded regions
- Elixir: Accept `#` comment after `do` keyword in `hasDoKeyword` detection
- Elixir: Skip `fn:` keyword argument (not treated as `fn` block opener)
- Elixir: Skip keywords preceded by `..` range operator
- Elixir: Skip keywords preceded by `@` module attribute
- Elixir: Track inner `do:` one-liners and `do...end` blocks in `hasDoKeyword` scope
- Erlang: Stop atom matching at newline characters
- Fortran: Handle `&` continuation after closing paren in `isValidBlockClose` (`end(i) &\n = value`)
- Fortran: Handle `&` continuation in `isBlockWhereOrForall` string scanning
- Julia: Distinguish generator filter `if` from block `if` inside parentheses (`isGeneratorFilterIf`)
- Julia: Restrict `abstract`/`primitive` type pattern to same-line whitespace only (`[ \t]+` instead of `\s+`)
- Julia: Filter out keywords preceded by `.` (struct field access like `obj.end`)
- MATLAB: Validate intermediate keywords (`else`/`elseif` for `if`, `case`/`otherwise` for `switch`)
- MATLAB: Handle `...` line continuation across dot and keyword in `isPrecededByDot`
- MATLAB: Use MATLAB-specific double-quoted string matching (no backslash escapes, `""` only)
- Octave: Reject `do` used as variable name (`do = 1`, but not `do == 1`)
- Octave: Reject block close keywords used as variable names (`end = 5`, `endif = 1`)
- Pascal: Exclude assembly block interior (`asm...end`) so labels like `begin:` are not keywords
- Pascal: Scan full stack in `findLastNonRepeatIndex` (not just stack top)
- Pascal: Check word boundary before `packed` keyword
- Verilog: Reject keywords preceded or followed by `$` (identifiers like `$end`, `fork$sig`)
- Verilog: Validate `fork`: reject `disable fork` and `wait fork` statements
- Verilog: Refactor `isFollowedByBegin` with dedicated skip helpers for sensitivity lists, paren groups, delays, and labels
- Verilog: Handle `(* ... *)` attributes when `@` is in excluded region
- Verilog: Skip string literals containing `*)` inside attributes
- Verilog: Handle `` `define `` and `` `undef `` directives as excluded regions (with backslash-newline continuation)
- Verilog: Validate block close keywords (reject backtick, dot, or `$` adjacency)
- VHDL: Restrict compound end pattern to same-line whitespace only (`[ \t]+` instead of `[ \t\r\n]+`)
- VHDL: Check excluded regions in entity/configuration colon detection
- VHDL: Find last valid `wait` on line for `wait for` detection (earlier waits may be semicolon-terminated)

### Changed

- Base parser: Make `findExcludedRegions` non-abstract with default loop-based implementation using `tryMatchExcludedRegion`
- Base parser: Add overridable `tryMatchExcludedRegion` dispatch method for simpler excluded region scanning
- Base parser: Simplify `isInExcludedRegion` to delegate to `findExcludedRegionAt`
- All parsers: Promote `tryMatchExcludedRegion` from `private` to `protected` (used by base class default implementation)
- Extension: Use per-document debounce timers instead of single global timer
- Extension: Add `onDidOpenTextDocument` listener for language mode changes and newly opened files
- Extension: Add `onDidCloseTextDocument` listener to clean up pending debounce timers
- Extension: Add `onDidChangeVisibleTextEditors` listener for split/unsplit editor handling
- Extension: Update text change listener to trigger on any visible editor (not just active editor)

### Refactored

- Ada: Extract `adaHelpers.ts` with shared utility functions (`skipAdaWhitespaceAndComments`, `isAdaWordAt`, etc.)
- Bash: Extract `bashStringHelpers.ts` with Bash-specific string matching functions
- Crystal: Extract `crystalExcluded.ts` with Crystal excluded region helpers
- Elixir: Extract `elixirHelpers.ts` with Elixir string and sigil matching functions
- Fortran: Extract `fortranHelpers.ts` with Fortran string, comment, and continuation helpers
- Ruby: Extract `rubyExcluded.ts` and `rubyFamilyHelpers.ts` with shared Ruby/Crystal helpers
- Base parser: Extract `parserUtils.ts` with standalone `isInExcludedRegion` utility function
- Ada: Split monolithic `isValidBlockOpen` into dedicated per-keyword validators
- VHDL: Split monolithic `isValidBlockOpen` into dedicated per-keyword validators
- Fortran: Split monolithic `isValidBlockOpen` into dedicated per-keyword validators
- Verilog: Split monolithic `isFollowedByBegin` into dedicated skip helpers

### Tests

- Add 880+ tests across 16 parser test files for bug fix verification and regression coverage

## [1.1.10] - 2026-03-02

### Fixed

- Ada: Filter `or else` short-circuit operator to not create false `else` intermediate
- Ada: Filter `and then` short-circuit operator to not create duplicate `then` intermediate
- AppleScript: Skip possessive form `X's <keyword>` pattern as variable name (e.g., `app's repeat`)
- COBOL: Replace O(n^2) `isValidBlockOpen` with O(n) `computeValidPositions` single-pass approach for deep nesting performance
- COBOL: Distinguish inline `PERFORM paragraph-name` from structured `PERFORM UNTIL/VARYING/WITH/TIMES` blocks
- Elixir: Reuse `skipInterpolation` for `#{}` in quoted atoms instead of inline depth tracking
- Elixir: Treat bare `#` inside interpolation code as comment start (not nested interpolation)
- Elixir: Fix `isDoColonOneLiner` to skip excluded regions before checking for newline
- Fortran: Handle CR-only (`\r`) line endings in `else if` continuation merging
- Fortran: Accept leading `&` with trailing whitespace on continuation line in `isPrecedingContinuationKeyword`
- Fortran: Add `type` to valid blocks for `contains` intermediate
- MATLAB: Handle backslash-escaped quotes (`\"`) in double-quoted strings
- VHDL: Handle `:=` variable assignment conditional (`x := a when cond else b`)
- VHDL: Handle `return` conditional expression (`return a when cond else b`)
- VHDL: Handle `elsif`/`else generate` chains by closing all stacked generate blocks with single `end generate`

### Tests

- Add 60+ tests across 10 parser test files for bug fix verification and branch coverage improvement
- Improve branch coverage from 98.95% to 99.02%

## [1.1.9] - 2026-03-01

### Fixed

- Ada: Skip `case` inside parentheses (Ada 2012 case expressions, like `(case X is when ...)`)
- Ada: Handle qualified expression `type'(expr)` in parenthesis detection (not treated as function call)
- Ada: Remove `accept` from `begin` context keywords (`accept` uses `do`/`end`, not `begin`/`end`)
- Bash: Fix `#` mid-word incorrectly treated as comment start (e.g., `file#name`, `C#`)
- Bash: Handle `$()`, `${}`, and backtick command substitution inside double-quoted strings
- Bash: Handle heredoc bodies inside command substitution `$(...)`
- Bash: Handle heredoc bodies inside process substitution `<(...)` and `>(...)`
- Bash: Handle backtick command substitution inside process substitution
- COBOL: Fix `D`/`d` at column 7 followed by identifier chars not treated as debug comment line (e.g., `DIVIDE`)
- Crystal: Fix symbol names with `?`/`!` consuming adjacent keyword (`:end?` should not hide following keyword)
- Crystal: Add `;` as valid operator before regex in string interpolation
- Elixir: Handle `#{}` interpolation inside quoted atoms (`:"hello #{expr}"`)
- Elixir: Filter out dot-preceded keywords (method calls like `map.end`)
- Erlang: Reject keywords followed by `:=` map update operator (in addition to `=>`)
- Fortran: Handle inline comments in continuation compound end (`end &! comment\nprogram`)
- Fortran: Handle `else if` with continuation line as merged intermediate (`else &\n  if`)
- Fortran: Skip comment-only lines when checking next line in `where`/`forall` block form detection
- Julia: Consume string macro suffix characters after closing quote (e.g., `custom"content"end`)
- MATLAB: Handle whitespace between dot and keyword in struct field access (e.g., `s . end`)
- Ruby: Allow block keywords after range operator `..` (not treated as method call)
- Ruby: Filter out keywords in heredoc identifiers (`<<end`, `<<-do`, `<<~if`)
- Ruby: Fix symbol names with `?`/`!` consuming adjacent keyword (`:end?` should not hide following keyword)
- Ruby: Add `;` as valid operator before regex in string interpolation
- Verilog: Allow newlines between `default` keyword and `:` separator
- VHDL: Handle `wait on`/`wait until` followed by `for` (completed wait statement does not affect `for` detection)
- VHDL: Detect entity instantiation with colon on previous line
- VHDL: Handle qualified expression `type'(expr)` (not treated as character literal)
- Extension: Fix stale editor reference in debounced decoration update
- Extension: Apply decorations to all visible editors on activation and configuration change

### Changed

- Update test configuration to `tests` array format and `exclude`-based coverage config

### Tests

- Add 88+ tests across 12 parser test files for bug fix verification and branch coverage

## [1.1.8] - 2026-02-28

### Fixed

- Ada: Skip `null record` as block opener (empty record definition)
- Ada: Skip `access protected procedure/function` (access subprogram type, not block)
- Ada: Skip `if` inside parentheses (Ada 2012 conditional expressions)
- Ada: Skip `for` representation clauses (`for X'Attribute use`)
- Ada: Increase `loop` backward scan range from 5 to 20 lines for multi-line `for`/`while` statements
- Ada: Validate `when` intermediate for `case`/`select`/`begin`/`entry` blocks only
- Ada: Validate `then` intermediate for `if`/`select` blocks only
- Ada: Fix `end` to always close top of stack instead of searching for `begin`
- AppleScript: Require `script` to be at line start (like `on`/`to`)
- AppleScript: Handle block comments before line-start keywords (`on`/`to`/`script`)
- AppleScript: Skip `end` used as variable/property name (`set end to`, `end of`, `copy end to`)
- AppleScript: Fix `on error` intermediate to only match when stack top is `try`
- AppleScript: Simplify `<keyword> of` property access pattern to same-line only
- Bash: Fix `<<<` here-string not treated as `<<` heredoc in gap scanning
- Bash: Fix heredoc pattern to properly match quoted delimiters
- Bash: Handle `$#` vs `$$#` in comment detection (allow `$$#` as comment start)
- Bash: Skip excluded regions when scanning backward in `isAtCommandPosition`
- COBOL: Support `D`/`d` debug indicator at column 7 as comment line
- COBOL: Use visual column calculation with tab expansion for column 7 detection
- COBOL: Optimize `isValidBlockOpen` with combined regex and lazy iteration for deep nesting
- Crystal: Allow keywords after `..`/`...` range operators (not filtered as method calls)
- Crystal: Distinguish `!=` and `=~` operators from `!`/`=` method suffixes after keywords
- Crystal: Filter keywords in heredoc openers (`<<-end`, `<<-'do'`)
- Crystal: Check excluded regions before filtering operator-preceded keywords (regex literal edge case)
- Elixir: Handle `?` and `!` as identifier trailing chars in atom detection
- Elixir: Restrict multi-char sigil names to uppercase sigils only
- Elixir: Allow `#{}` interpolation in single-quoted charlists (not just double-quoted)
- Elixir: Filter middle keywords followed by colon (keyword argument syntax like `else:`, `rescue:`)
- Elixir: Handle `,do` (no space before `do`) in `hasDoKeyword` detection
- Elixir: Track bracket/paren/brace depth in `isDoColonOneLiner`
- Elixir: Fix `do :` (space before colon) not treated as `do:` one-liner syntax
- Erlang: Allow `fun()` inside `-record` declarations (real anonymous functions)
- Erlang: Skip `fun 'quoted-atom'/Arity` function references
- Erlang: Reject keywords preceded by `.` (record field access like `Rec#state.end`)
- Erlang: Reject preprocessor directives (`-if`, `-else`, `-end` at line start)
- Fortran: Support compound end with continuation line (`end &\nfunction`)
- Fortran: Skip `end%component` (derived type component access)
- Fortran: Skip `end &\n%component` (derived type component across continuation)
- Fortran: Recognize `type(name) function/subroutine` as type specifier
- Fortran: Validate `else`/`elseif` intermediate for `if` blocks only
- Fortran: Validate `contains` intermediate for `program`/`module`/`submodule`/`function`/`subroutine` only
- Julia: Distinguish indexing brackets (`a[end]`) from array construction (`[begin...end]`) for `end`
- Julia: Add `isInsideIndexingBrackets` to reject `end` only in indexing context
- Julia: Handle `a[f(end)]` as indexing (not block close) via `hasBlockOpenerBetween` check
- Julia: Apply indexing-vs-construction distinction in `isInsideSquareBrackets` for other keywords
- Julia: Handle double transpose `A''` as excluded region
- MATLAB: Apply `isValidBlockClose` to all close keywords (not just `end`)
- MATLAB: Reject classdef section keywords inside parentheses or brackets
- MATLAB: Require classdef section keywords to appear at line start
- MATLAB: Handle double transpose `A''` as excluded region
- Octave: Validate intermediate keywords against opener type (`else`/`elseif` for `if`, `case`/`otherwise` for `switch`, etc.)
- Octave: Only check top of stack for generic `end` (not skip past unclosed `do` blocks)
- Octave: Handle double transpose `A''` as excluded region
- Octave: Handle CRLF in backslash escapes in double-quoted strings
- Pascal: Handle `packed` keyword before `object` in record type detection
- Pascal: Validate `of` intermediate for `case` blocks only
- Pascal: Validate `except`/`finally` intermediate for `try` blocks only
- Pascal: Validate `else` intermediate for `case`/`try` blocks only
- Pascal: Only check top of stack in `findLastNonRepeatIndex` (not skip past unclosed `repeat` blocks)
- Ruby: Check excluded regions before filtering operator-preceded keywords (regex literal edge case)
- Ruby: Add character literal (`?x`, `?\C-x`, `?\uXXXX`, etc.) as excluded regions
- Ruby: Fix symbol detection after `>` operator (allow `:symbol` after `>`)
- Ruby: Allow multiline regex between bare `/` delimiters
- Ruby: Allow bare heredoc after `)`, `]`, `}` (method call results)
- Verilog: Handle escaped identifiers (`\name`) as excluded regions
- Verilog: Handle SystemVerilog attributes (`(* ... *)`) as excluded regions (excluding `@(*)` sensitivity lists)
- Verilog: Skip label colon separator but not `::` scope resolution in `isFollowedByBegin`
- Verilog: Support escaped identifier labels in `isFollowedByBegin`
- VHDL: Reject keywords preceded by `.` (library path like `work.process`)
- VHDL: Handle `configuration` like `entity` for `use` prefix check
- VHDL: Reject `loop` preceded by dot (record field access)
- VHDL: Fix `stripTrailingComment` to verify excluded region starts at `--` position
- VHDL: Support extended identifiers (`\keyword\`) as excluded regions
- VHDL: Require `when` between `<=` and `else` for signal assignment detection
- VHDL: Handle `when` intermediate in case-generate blocks

## [1.1.7] - 2026-02-26

### Fixed

- Ada: Skip Ada `--` comments when scanning past whitespace after `is` keyword (multi-line `is abstract/separate` with comments)
- Ada: Fix `type`/`subtype is` detection to only skip when no `;` exists between keyword and `is` (allows `is` in subsequent declarations on same type block)
- AppleScript: `on error` now searches the entire stack for an enclosing `try` (not just the top), handling nested blocks inside `try`
- Bash: Treat `|` separator in case pattern alternatives as a command position
- Crystal: Filter out `::` scope resolution as block keyword (e.g., `Module::Begin`)
- Crystal: Filter out keywords followed by `?`, `!`, or `=` suffix (method names like `end?`, `begin!`)
- Elixir: Verify `do` is a standalone keyword (not a prefix like `do_something`) in `isDoColonOneLiner`
- Erlang: Suppress `fun` block detection inside `-record` attribute declarations
- Fortran: Handle `&` line continuation for assignment context (`end &\n  = ...`)
- Fortran: Allow leading whitespace before `#` preprocessor directives (fix `isAtLineStart` check)
- Fortran: Skip comment-only continuation lines in `isPrecedingContinuationKeyword`
- Julia: Fix `isInsideBrackets` to not reject `end` inside `()` when already inside `[]`
- MATLAB: Require no trailing content after `%}` to close a block comment (per MATLAB spec)
- Octave: Require no trailing content after `%}` or `#}` to close a block comment (per Octave spec)
- Pascal: Skip newlines (in addition to spaces/tabs) when scanning for `(` after `class` keyword
- Ruby: Filter out `::` scope resolution as block keyword (e.g., `Module::Begin`)
- Verilog: Skip `#delay` expressions in `isFollowedByBegin` (e.g., `always #5 begin`)
- Verilog: Skip labels in `isFollowedByBegin` (e.g., `label: begin`)

### Tests

- Update MATLAB/Octave `%}`/`#}` trailing-content tests to `assertNoBlocks` (aligned with spec)
- Update Verilog labeled `begin` test: expect 3 blocks (module + always + labeled begin)

## [1.1.6] - 2026-02-21

### Fixed

- Elixir: Treat `#` inside `#{}` interpolation as comment start (skip to end of line)
- Ada: Fix CRLF line offset calculation in `loop` backward scan for `for`/`while` validation
- VHDL: Fix CRLF line offset calculation in `loop` backward scan for `for`/`while` validation
- Erlang: Handle surrogate pair characters in `$` character literals (e.g., `$😀`)

### Tests

- Improve branch coverage: Branches 98.81% → 99.15% (+13 tests)
- Add coverage tests for Elixir `#` comment handling in interpolation and `,do:` one-liner detection
- Add coverage tests for Ada/VHDL CRLF loop validation and type declaration with comments/blank lines
- Add coverage tests for Erlang surrogate pair character literals
- Add coverage tests for Fortran `isTypeSpecifier` whitespace, `isPrecedingContinuationKeyword` false path, and `isValidBlockClose` nested parens
- Add coverage tests for Bash `isCasePattern` backward paren scan and depth tracking
- Add coverage tests for Crystal `matchHeredoc` empty terminators and `isLoopDo` excluded region handling
- Add coverage tests for Ruby regex-in-interpolation whitespace and unterminated nested string

### Refactored

- Extract shared test generators to reduce duplication across 16 parser tests

## [1.1.5] - 2026-02-18

### Fixed

- VHDL: Handle `\r`-only line endings in `for`/`entity`/`loop` validation within `isValidBlockOpen`

### Tests

- Improve overall test coverage: Statements 98.49% → 99.29%, Branches 97.29% → 98.81% (+81 tests)
- Add coverage tests for Pascal `isInsideRecord` nested block handlers (`record`, `object`, `interface`, `try`, `asm`, `case` at depth > 0)
- Add coverage tests for Fortran CRLF handling in procedure/if/where/forall continuations and `isPrecedingContinuationKeyword`
- Add coverage tests for Fortran `isValidBlockClose` variable assignment detection (`end = 5`)
- Add coverage tests for Bash heredoc EOF, `${#var}` expansion, backslash/nested braces in `${...}`, POSIX case patterns, and `;;&` separator
- Add coverage tests for Crystal escape/string handling in interpolation, char literal EOF edges, and `isLoopDo` excluded regions
- Add coverage tests for Elixir charlist escapes, `hasDoKeyword` `\r`-only, and `isDoColonOneLiner` edge cases (`,do`, `do:`)
- Add coverage tests for Ruby regex/percent interpolation escapes, CRLF heredoc, and unterminated nested regex
- Add coverage tests for VHDL `\r`-only and CRLF line endings in wait/loop/entity validation, `end loop` same-line detection, and signal assignment exhausted scan
- Add coverage tests for Ada CRLF loop validation and `isTypeDecl` blank line backward scan
- Add coverage tests for AppleScript `<keyword> of` property access pattern
- Add coverage tests for Verilog excluded regions inside parenthesized conditions

## [1.1.4] - 2026-02-17

### Fixed

- Bash: Handle `\r`-only line endings in case pattern line-start detection
- Crystal: Allow symbol after `>` operator (e.g., `x > :end`)
- Crystal: Treat `not`/`and`/`or` as preceding block keywords for postfix detection
- Elixir: Allow atom after `>` operator (e.g., `x>:atom`)
- Elixir: Count newlines only outside all bracket types in `hasDoKeyword` scope detection
- Fortran: Skip comment-only lines in `module procedure` continuation detection
- Fortran: Skip comment-only lines in procedure `::` declaration detection
- Fortran: Skip comment-only lines in continuation block form detection
- VHDL: Support `end for` compound end keyword (generate blocks)
- VHDL: Support `case generate` blocks

## [1.1.3] - 2026-02-16

### Fixed

- Ada: Skip `accept` without `do` (simple accept statements)
- Ada: Skip comment lines when scanning backward for `type`/`subtype is` declarations
- Ada: Skip `is <>` generic default declarations
- AppleScript: Support multiple spaces/tabs in compound keywords (e.g., `end  tell`)
- AppleScript: Treat `on error` as block opener when outside `try` blocks (standalone handler)
- Bash: Handle `\r`-only line endings in comment scanning inside command substitution
- Bash: Skip comments inside process substitution `<(...)` and `>(...)`
- Bash: Handle `\r`-only line endings in subshell detection for case pattern check
- Bash: Support multiple heredocs on the same line
- COBOL: Include underscore in word boundary detection for keyword validation
- Crystal: Handle `\r`-only line endings in comment scanning inside string and regex interpolation
- Crystal: Exclude keywords between invalid multi-char literals (e.g., `'end'`) from detection
- Elixir: Handle `#{}` interpolation in non-heredoc lowercase sigils (e.g., `~s()`, `~r//`)
- Elixir: Track bracket `[]` and brace `{}` depth in `hasDoKeyword` scope detection
- Erlang: Handle `\r`-only line endings in `-spec`/`-type` line detection for `fun()` context
- Fortran: Recognize concatenated end keywords (e.g., `enddo`, `endif`) in continuation block form detection
- Fortran: Exclude C preprocessor directives (`#ifdef`, `#endif`, etc.) from keyword matching
- Fortran: Handle `module &\n procedure` continuation lines
- Julia: Track parenthesis depth in bracket detection (e.g., `[f(begin...end)]`)
- Julia: Disable `$()` interpolation processing in prefixed string macros
- Pascal: Handle `class`/`interface`/`try`/`case`/`asm` blocks in record type detection
- Ruby: Handle `\r`-only line endings in comment scanning inside string and regex interpolation
- Ruby: Handle `\r`-only line endings in unterminated nested regex detection
- Verilog: Consume chained control keywords before `begin` (e.g., `always -> if -> begin -> end`)
- VHDL: Handle `\r`-only line endings in unterminated string detection
- VHDL: Support chained conditional signal assignments (e.g., `sig <= a when c1 else b when c2 else c`)

## [1.1.2] - 2026-02-15

### Added

- Octave: Support `do`/`until` loop blocks
- Octave: Add specific close keywords (`endclassdef`, `endmethods`, `endproperties`, `endevents`, `endenumeration`)
- Verilog: Support SystemVerilog constructs (`class`/`endclass`, `interface`/`endinterface`, `program`/`endprogram`, `package`/`endpackage`, `property`/`endproperty`, `sequence`/`endsequence`, `checker`/`endchecker`, `clocking`/`endclocking`)
- Verilog: Support `always_comb`, `always_ff`, `always_latch` block openers
- Verilog: Support preprocessor directives (`` `ifdef ``/`` `ifndef ``/`` `elsif ``/`` `else ``/`` `endif ``)
- Erlang: Support `maybe`/`end` blocks and `else` intermediate
- Erlang: Support triple-quoted strings (OTP 27+)
- Erlang: Support character literals (`$x`, `$\n`, etc.) as excluded regions
- Julia: Support `$()` interpolation in double-quoted, triple-quoted, and command strings
- Julia: Support any identifier prefix as string macro (e.g., `sql"..."`)
- Julia: Support triple backtick command strings
- Pascal: Support `asm`/`end` blocks
- MATLAB: Support `arguments` block keyword
- Lua: Support `\z` and `\<newline>` escape sequences in strings (Lua 5.2+)
- Lua: Exclude goto labels (`::identifier::`) from keyword matching
- Fortran: Support fixed-form comment indicators (`*`, `C`/`c` in column 1)
- MATLAB/Octave: Support line continuation (`...`) as excluded regions

### Fixed

- Ada: Skip `entry` declarations without body (ending with `;` before `is`)
- Ada: Skip `access function`/`procedure` (access subprogram types)
- Ada: Skip function/procedure declarations without body (`;` before `is`)
- Ada: Skip `is abstract`/`is separate`/`is new`/`is null` non-body declarations
- Ada: Skip `is` in `type`/`subtype` declarations (including multi-line)
- Ada: Restrict `or` intermediate to `select` blocks only
- Ada: Handle multi-line `for`/`while` statements when validating `loop`
- Ada: Merge `begin` context keyword into single pair (e.g., `procedure`/`begin`/`end` = 1 pair)
- Ada: Skip attribute name after tick to avoid false keyword matches
- AppleScript: Detect single-line `if ... then action` (not treated as block)
- AppleScript: Detect `tell ... to` one-liner form (not treated as block)
- AppleScript: Skip keywords used as variable names (`set X to`, `copy X to` patterns)
- AppleScript: Remove incorrect `#` comment support
- Bash: Exclude process substitution `<(...)` and `>(...)` from keyword matching
- Bash: Exclude bare arithmetic evaluation `((...))` from keyword matching
- Bash: Handle `case`/`esac` nesting inside `$(...)` command substitution
- Bash: Handle `${...}`, backtick commands, comments, and `$'...'` inside command substitution
- Bash: Handle `\{`/`\}` escapes and nested `${...}` inside parameter expansion
- Bash: Handle `${...}` inside arithmetic expansion `$(( ))`
- Bash: Scan heredoc opener line gap for excluded regions (comments, strings)
- COBOL: Validate block openers by checking for matching `END-keyword`
- COBOL: Validate fixed-format column 7 comment area (digits/spaces only)
- COBOL: Restrict `ELSE` intermediate to `IF` blocks, `WHEN` to `EVALUATE`/`SEARCH`
- Crystal: Handle `#{}` interpolation in double-quoted strings, regex, backtick strings, and percent literals
- Crystal: Detect `::` scope resolution (not treated as symbol start)
- Crystal: Require `<<-` (dash) for heredoc syntax
- Crystal: Skip postfix `rescue` modifier
- Crystal: Skip `for`/`in` loop keywords
- Crystal: Skip dot-preceded keywords (method calls like `obj.end`)
- Crystal: Distinguish `%` modulo operator from percent literals
- Crystal: Handle `?`/`!` characters in division preceders
- Crystal: Handle proper character literal matching (hex/octal escapes)
- Crystal: Scan heredoc opener line gap for excluded regions
- Elixir: Handle `#{}` interpolation in double-quoted strings, single-quoted charlists, triple-quoted heredocs, and sigil heredocs
- Elixir: Limit `hasDoKeyword` search scope (max 5 lines, stop at other block keywords)
- Elixir: Handle `do:value` (no space) one-liner pattern
- Elixir: Skip nested sigils inside interpolation
- Erlang: Skip `fun` in `-spec`/`-type`/`-callback`/`-opaque` type contexts
- Erlang: Skip `fun Module:Function/Arity` function references
- Erlang: Properly scope `fun()` type context (period-separated declarations)
- Erlang: Restrict `catch` to `try`, `of` to `case`/`try`, `after` to `receive`/`try`
- Erlang: Skip keywords used as map keys (followed by `=>`)
- Erlang: Handle multi-byte escape sequences in atoms (hex, octal)
- Fortran: Skip `type is(...)` guard in select type blocks
- Fortran: Skip `type(name)` type specifier (with `::` or `,`)
- Fortran: Require `select` to be followed by `type` or `case` (with `&` continuation)
- Fortran: Skip `module procedure` (not a module block)
- Fortran: Skip type-bound `procedure` declarations (with `::`)
- Fortran: Detect single-line `where`/`forall` (with `&` continuation support)
- Fortran: Skip `if` preceded by `else` (including `&` continuation)
- Fortran: Skip `end` used as variable name (followed by `=`)
- Fortran: Handle `&` continuation and comment-only lines in `if`/`then` detection
- Fortran: Check all `::` occurrences and excluded regions in `isAfterDoubleColon`
- Julia: Skip `for`/`if` inside brackets and parentheses (array comprehensions/generators)
- Julia: Skip `end` inside brackets (array indexing)
- Julia: Skip block keywords inside square brackets
- Julia: Handle `::` type annotation (not treated as symbol start)
- Julia: Improve prefixed string detection (reject block keywords as prefixes)
- Lua: Search backwards across multiple lines for `while`/`for` loop `do`
- Lua: Prevent `end` from closing `repeat` blocks (only `until` can)
- Lua: Terminate strings at unescaped newlines
- MATLAB: Skip `end` inside parentheses, brackets, and braces (array indexing)
- MATLAB: Skip struct field access for keywords (`s.end`, `s.if`, etc.)
- MATLAB: Skip classdef section keywords used as function calls or variables
- MATLAB: Support nested block comments (`%{`/`%}`)
- MATLAB: Require `%{` to be alone on line for block comments
- MATLAB: Improve digit followed by `'` detection (transpose vs string)
- Octave: Prevent generic `end` from closing `do` blocks (only `until` can)
- Octave: Support nested block comments (`%{`/`%}` and `#{`/`#}`)
- Octave: Require block comment openers to be alone on line
- Octave: Improve digit followed by `'` detection (transpose vs string)
- Pascal: Skip `class` forward declarations (with nested parentheses and qualified type names)
- Pascal: Skip `class` with modifiers (`sealed`, `abstract`, `helper`) after semicolon
- Pascal: Improve `object` detection inside record types
- Ruby: Handle `#{}` interpolation in double-quoted strings, regex, backtick strings, percent literals, and double-quoted symbols
- Ruby: Detect `::` scope resolution (not treated as symbol start)
- Ruby: Include entire `=end` line in excluded region
- Ruby: Skip postfix `rescue` modifier
- Ruby: Add `not`/`and`/`or` to preceding block keywords for postfix detection
- Ruby: Skip method name suffixes (`?`/`!`/`=`) on keywords
- Ruby: Skip dot-preceded keywords (method calls like `obj.end`)
- Ruby: Distinguish `%` modulo operator from percent literals
- Ruby: Handle `?`/`!` characters in division preceders
- Ruby: Disambiguate `<<` (shift operator vs heredoc) after identifiers
- Ruby: Scan heredoc opener line gap for excluded regions
- Verilog: Validate control keywords (require following `begin` through chained keywords)
- Verilog: Merge `else` before control keyword into single pair
- Verilog: Restrict `default` intermediate to case context (followed by `:`)
- Verilog: Reject backtick-prefixed control keywords (preprocessor directives)
- VHDL: Detect `wait for` timing statements (including multi-line)
- VHDL: Skip `use entity` and `label: entity` direct instantiation
- VHDL: Skip function/procedure declarations (ending with `;` before `is`)
- VHDL: Filter `when`/`else` in conditional signal assignments (`<=`)
- VHDL: Handle multi-line `for`/`while` statements when validating `loop`
- VHDL: Restrict `when` intermediate to `case` blocks only
- VHDL: Skip attribute name after tick to avoid false keyword matches
- Base parser: Handle `\r`-only line endings in single-line comment matching
- All parsers: Handle `\r` and `\r\n` line endings consistently throughout
- All parsers: Use `[ \t]` instead of `\s` in compound end patterns to avoid matching newlines
- Config: Validate `colors` and `debounceMs` setting types with fallback to defaults
- Extension: Clear pending debounce timer on configuration change

## [1.1.1] - 2026-02-11

### Fixed

- Base parser: Recalculate nest levels based on actual matched pair containment, fixing incorrect levels caused by unmatched block openers
- Julia: Validate that `abstract`/`primitive` are followed by `type` keyword before treating as block openers
- Ruby/Crystal: Correctly detect regex after keywords (e.g., `if /pattern/`, `when /regex/`)
- Ruby: Require whitespace, newline, or EOF after `=begin`/`=end` delimiters for stricter multi-line comment matching
- AppleScript: Treat `to`/`on` as block openers only at line start (handler definitions)
- Bash: Simplify parameter expansion handling by relying on excluded regions
- COBOL: Skip keywords inside hyphenated identifiers (e.g., `END-IF-FLAG`, `PERFORM-COUNT`)
- COBOL: Support fixed-format column 7 comment indicators (`*` and `/`)
- Elixir: Handle escape sequences in triple-quoted strings
- Elixir: Skip excluded regions when checking `do:` one-liner pattern
- Fortran: Skip single-line `if` (without `then`) as block opener
- Fortran: Support concatenated end keywords (`endif`, `enddo`, `endprogram`, etc.)

## [1.1.0] - 2026-02-01

### Added

- AppleScript support (`.applescript`, `.scpt`)
- Erlang support (`.erl`, `.hrl`)
- Pascal/Delphi support (`.pas`, `.pp`, `.dpr`)

## [1.0.1] - 2026-02-01

### Added

- Ruby/Crystal: Highlight `then` as intermediate keyword in `if`/`case`/`when` blocks

### Fixed

- Ruby/Crystal: Correctly detect `if`/`unless`/`while`/`until` after arithmetic operators (`+`, `-`, `*`, `/`, `%`), comparison operators (`<`, `>`), bitwise operators (`^`, `~`), logical NOT (`!`), and range operators (`..`, `...`)
- Ruby: Correctly handle `while`/`until`/`for ... do` as loop separators even in expression context (e.g., `x = while cond do 1 end`)
- Lua: Fix multiple `do` on same line incorrectly detected as loop separators
- Lua: Skip `do` inside strings/comments when determining loop separators
- Bash: Fix O(n²) performance in parameter expansion detection by pre-computing ranges

### Changed

- types.ts: Fix documentation comment ("byte offset" → "UTF-16 code unit offset")

## [1.0.0] - 2026-02-01

### Added

- Ada support (`.adb`, `.ads`)
- COBOL support (`.cob`, `.cbl`)
- Fortran support (`.f90`, `.f95`, `.f03`, `.f08`)
- MATLAB support (`.m`)
- Octave support (`.m`)
- Verilog support (`.v`, `.sv`)
- VHDL support (`.vhd`, `.vhdl`)

## [0.0.2] - 2026-01-31

### Changed

- Increase maximum `debounceMs` from 1000ms to 10000ms

### Fixed

- Add error handling for parser failures to prevent extension crashes
- Limit color array to 100 items maximum to prevent performance issues
- Ruby/Crystal: Fix heredoc quote mismatch (e.g., `<<'EOF"` was incorrectly matched)
- Ruby/Crystal: Exclude whitespace characters as percent literal delimiters
- Bash: Skip strings inside arithmetic expansion `$(( ))` to prevent false keyword matches
- Bash: Handle ANSI-C quotes `$'...'` and nested command substitution inside parameter expansion
- Bash: Allow command grouping `}` after block close keywords (`fi`, `done`, `esac`)
- Elixir: Detect tab character before `do:` in one-liner syntax
- Lua: Add boundary check in long string `[[ ]]` parsing to prevent out-of-bounds access
- Crystal: Improve type annotation detection by skipping whitespace before colon

## [0.0.1] - 2026-01-31

### Added

- Julia: Support for `abstract type ... end` and `primitive type ... end` blocks

### Fixed

- Julia: Symbol literal character range now correctly matches operator characters (`:=>`, `:push!`, etc.)
- All parsers: Standardized boundary checks for array access to improve robustness
- Base parser: Escape regex metacharacters in keyword patterns to prevent potential issues

## [0.0.0] - 2026-01-30

### Added

- Rainbow colorization for block pairs (`do`/`end`, `if`/`end`, `if`/`fi`, etc.) based on nesting level
- Supported languages: Ruby, Elixir, Crystal, Lua, Julia, and Bash
- Customizable color palette via `rainbowBlocks.colors` setting
- Configurable debounce delay via `rainbowBlocks.debounceMs` setting

[1.1.31]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.30...v1.1.31
[1.1.30]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.29...v1.1.30
[1.1.29]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.28...v1.1.29
[1.1.28]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.27...v1.1.28
[1.1.27]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.26...v1.1.27
[1.1.26]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.25...v1.1.26
[1.1.25]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.24...v1.1.25
[1.1.24]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.23...v1.1.24
[1.1.23]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.22...v1.1.23
[1.1.22]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.21...v1.1.22
[1.1.21]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.20...v1.1.21
[1.1.20]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.19...v1.1.20
[1.1.19]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.18...v1.1.19
[1.1.18]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.17...v1.1.18
[1.1.17]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.16...v1.1.17
[1.1.16]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.15...v1.1.16
[1.1.15]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.14...v1.1.15
[1.1.14]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.13...v1.1.14
[1.1.13]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.12...v1.1.13
[1.1.12]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.11...v1.1.12
[1.1.11]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.10...v1.1.11
[1.1.10]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.9...v1.1.10
[1.1.9]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.8...v1.1.9
[1.1.8]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.2...v1.0.0
[0.0.2]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/cadenza-tech/rainbow-blocks/releases/tag/v0.0.0
