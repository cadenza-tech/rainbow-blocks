# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.2]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.2...v1.0.0
[0.0.2]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/cadenza-tech/rainbow-blocks/releases/tag/v0.0.0
