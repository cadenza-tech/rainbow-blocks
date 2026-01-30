# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/cadenza-tech/rainbow-blocks/compare/v0.0.0...HEAD
[0.0.0]: https://github.com/cadenza-tech/rainbow-blocks/releases/tag/v0.0.0
