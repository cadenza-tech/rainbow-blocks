# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.2...v1.0.0
[0.0.2]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.0...v0.0.1
[0.0.0]: https://github.com/cadenza-tech/rainbow-blocks/releases/tag/v0.0.0
