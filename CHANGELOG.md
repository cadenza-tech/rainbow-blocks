# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
