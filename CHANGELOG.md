# Change Log

All notable changes to the "Rainbow Blocks" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.65] - 2026-06-14

### Fixed

- Ada: Limit Unicode-letter adjacency to LRM 2.3 `identifier_extend` (decimal-digit only)
- Ada: Recognize labeled `exit <Label> when X` as a loop-exit modifier
- Ada: Skip `declare` and `begin` inside parentheses for Ada 2022 declare expressions
- AppleScript: Recognize NBSP and Unicode whitespace in `isKeywordAsVariableName` regex patterns
- AppleScript: Reject `else if(x)` function-call form to avoid a spurious `else` intermediate
- AppleScript: Skip NBSP whitespace before an expression terminator
- AppleScript: Skip NBSP whitespace before a line-continuation marker
- AppleScript: Skip NBSP whitespace before a record-key colon
- Bash: Drop phantom keyword tokens occluded by a line-continuation logical word
- Crystal: Accept instance var, global var, splat, and block prefixes as `def` parameter starters
- Crystal: Prioritize macro closer over char-literal recognition in macro templates
- Crystal: Recognize method-bang suffix `?` in `end` ternary-value detection
- Crystal: Skip `do:` in a named tuple when scanning for a loop separator
- Crystal: Skip heredoc detection at the second `<` of three or more consecutive `<`
- Erlang: Recognize `@` as identifier-continuation in `isCatchFollowedByClausePattern`
- Fortran: Memoize `getSelectSubtype` to avoid `O(n²)` parse on many `select case` blocks
- Fortran: Recognize F77 type declaration across line continuation in `isAfterF77TypeDeclaration`
- Fortran: Recognize fixed-form column-6 digit continuation marker before `then` in `if`-headers
- Fortran: Treat literal closing quote as operator context across continuation
- Fortran: Walk past chained bare `&` continuation lines in `isPrecedingContinuationKeyword`
- Julia: Remove non-reserved words (`isa`, `throw`, `type`, `mutable`, `missing`, `nothing`) from the string-macro reserved-word set
- MATLAB: Push `pendingSkipDepth` for a valid `arguments` attribute form outside `function`/`methods`/`classdef`
- MATLAB: Record a phantom for `arguments` with an attempted attribute form
- MATLAB: Reject any reserved word used as a function name in a `function` header
- MATLAB: Treat VT and FF as line-start whitespace before block comment markers
- MATLAB: Treat VT and FF as statement-start whitespace before shell escape
- Octave: Preserve `@arguments` function-handle rejection in the rescue path
- Octave: Recognize SMP Unicode letters via `codePointAt` in the `do` probe
- Octave: Reject `end` followed by a value-like token (numeric/string/`[`/`{`)
- Octave: Treat `end` followed by `..` as field access
- Pascal: Reject `try`/`case`/`begin`/`repeat` as a block opener after comparison `=`
- Pascal: Skip identifier-prefixed `end` (`$end`/`#end`/`&end`) inside an `asm` body
- Ruby: Detect more value-position patterns before a stray `end` (identifier value, parens-internal `;`, backslash continuation)
- Ruby: Filter block-open keywords used as a hash key before `=>`
- Verilog: Recognize compound assignments and statement bodies in `case_item` labels
- Verilog: Suppress `block_close` keywords used as rvalue identifiers
- Verilog: Suppress close keywords in instance-type position
- VHDL: Recognize word operators (`not`/`and`/`or`/etc) as RHS markers in `isInExpressionRhsContext`

## [1.1.64] - 2026-06-13

### Fixed

- Ada: Recognize non-ASCII type names on their own line in the `is` filter
- Ada: Treat a non-ASCII suffix before the `access` keyword as part of the identifier
- Ada: Treat a non-ASCII suffix before `protected` and `task` as part of the identifier
- Ada: Keep the `then abort` intermediate after a trailing `and` in a `select` ATC
- Ada: Keep the case arm guard `when` after a semicolonless `exit` body
- Bash: Skip a command-group brace glued to a keyword without a separator
- COBOL: Track `lineStart` incrementally to keep the excluded-region scan linear on long single-line sources
- COBOL: Skip an identification-area period as a statement boundary in pseudo-text scanning
- Crystal: Skip `end` in value-expecting positions on the same line
- Crystal / Ruby: Cap interpolation nesting depth to prevent a stack overflow on deeply nested string interpolation
- Elixir: Memoize the bracket-depth prefix to keep value-position scans linear with many block-keyword conditions
- Elixir: Treat `fn` as a value when `do` follows across a newline, comment, or comma
- Erlang: Stop the forward scan at a top-level `catch` or `after` outside guards in `try` clauses
- Erlang: Allow blank lines before a map-key arrow inside a `#{}` scope
- Fortran: Handle backslash-continued preprocessor directives in the excluded-region scan
- Julia: Linearize bracket-context helpers via a per-bracket fused scan
- Pascal: Make type-section block opener validation linear for many `class`/`record`/`object`/`interface` declarations
- Pascal: Skip block-close keywords in case-label value position
- Pascal: Bound the variant-case label forward scan to avoid `O(n²)` on nested `case of` chains
- Ruby: Balance open count when filtering expression-position `end` tokens so inner `do/end` blocks survive
- Verilog: Preserve the close keyword after an rvalue identifier in instance-name detection
- VHDL: Avoid a full-source `toLowerCase` per keyword in conditional signal assignment validation

## [1.1.63] - 2026-06-13

### Fixed

- Ada: Treat `access` ending a Unicode identifier as part of the identifier before `protected`
- Ada: Treat `null` ending a Unicode identifier as part of the identifier before `record`
- Ada: Reject a following `entry` in the forward scan for an unterminated `entry` declaration
- Bash: Treat non-ASCII punctuation as word-fusing characters in keyword detection
- Bash: Apply the case pattern check to keywords split by a line continuation
- COBOL: Skip the identification area when scanning pseudo-text starts in fixed format
- COBOL: Detect newlines inside excluded regions in the expression context scan
- Crystal: Treat keywords before `!=`/`!~` and `~` operators as values
- Crystal: Filter `end` in expression position after an assignment operator
- Elixir: Pair `fn` with `end` in an immediate anonymous function invocation `end.()`
- Erlang: Accept underscore-prefixed variables as fun reference arity
- Erlang: Recognize atoms containing an at-sign in attribute and spec detection
- Fortran: Recognize concatenated `endinterface` in interface block detection
- Fortran: Precompute interface spans to avoid `O(n²)` procedure validation
- Julia: Treat brackets after Unicode operators as array construction
- Lua: Restrict varargs detection to exactly three dots in the concat operator check
- Octave: Drop parenthesized section keyword calls outside `classdef`
- Octave: Reject block keywords inside same-line control headers
- Octave: Reject Unicode digits and symbols after the `do` keyword
- Ruby: Use a Unicode-aware word boundary for `then` detection in loop `do` validation
- Ruby: Recognize hex, binary, octal, and exponent literals before an expression-position `end`
- Verilog: Stop the `default` attachment scan at scope openers
- Verilog: Stop `disable`/`wait` fork detection at escaped identifiers
- Verilog: Exclude attribute parentheses from instance name detection
- VHDL: Recognize a `view` header line in multi-line `is` detection
- VHDL: Require a preceding `is` for a `units` block opener
- VHDL: Treat reserved words after `return` as values
- VHDL: Window-slice entity and configuration validation to avoid `O(n²)` scans

## [1.1.62] - 2026-06-05

### Fixed

- Ada: End line comments at NEL/LS/PS line terminators in whitespace-and-comment skip
- AppleScript: Bound the record-key backward brace scan to avoid `O(n²)` parsing
- AppleScript: Drop colon-suffixed `else if`/`on error` from intermediates
- AppleScript: Treat a block keyword after `then` as a single-line `if` action
- Bash: Recognize compound commands after `if`/`while`/`until`
- COBOL: Skip excluded-region detection in the fixed-format identification area
- COBOL: Drop `ELSE`/`WHEN` used as a `PERFORM` paragraph name from intermediates
- Crystal: Treat receiver-like keywords in value context as identifiers
- Elixir: Treat `end` after a `->` arrow as a block close in empty-body clauses
- Erlang: Treat an empty `catch` clause as a clause separator
- Erlang: Skip a block keyword after `~` in an incomplete sigil prefix
- Fortran: Skip parentheses inside continuation-line inline comments
- Fortran: Capture `then` across a fixed-form column-6 continuation
- Fortran: Cap the `isInsideParentheses` backward scan to avoid `O(n²)` parsing
- Julia: Drop a bracket intermediate when its matching opener follows it
- Lua: Skip reserved words after a `..` concatenation in loop classification
- MATLAB: Skip a middle keyword in operand context after a value token
- Pascal: Prevent a malformed variant `case` from suppressing a later standalone `case`
- Pascal: Skip `begin`/`try`/`case`/`repeat` used on the right of a `:=` assignment
- Pascal: Sync the `asm` forward-character check for brackets and angle brackets
- Ruby: Treat a backtick as a command string after a Unicode-suffixed `def`
- Ruby: Treat a next-line `do` as a block `do` after a Unicode-suffixed `while`
- Verilog: Pair control keywords with `endcase` for a `randcase` body

## [1.1.61] - 2026-05-31

### Fixed

- Ada: Skip `exception` intermediate on openers without a handled body
- Ada: Skip `exit when` modifier from `select` intermediates
- AppleScript: Treat comma-missing multi-line record key `end` as a key, not a block close
- AppleScript: Skip colon-suffixed block middle keyword from intermediates
- Bash: Remove phantom `do` intermediate overlapping a split `done`
- Bash: Precompute last `]]` position to avoid `O(n²)` scan on many unclosed `[[`
- Bash: Enforce subshell scope barrier for middle keyword attribution
- COBOL: Skip close keyword used as a `PERFORM` paragraph reference
- Elixir: Treat `end` as a block close after a bitstring close `>>` and `?>` char literal
- Elixir: Keep middle keyword after a space-separated string or charlist close
- Erlang: Recognize `catch` clause separator past a guard `catch`
- Erlang: Skip record-field dot when finding spec declaration end
- Fortran: Handle `;` statement separator after a `where`/`forall` construct header
- Julia: Pair value-returning block `end` before a postfix marker via tentative close
- Julia: Allow a block comment between `abstract`/`primitive` and `type`
- MATLAB: Treat `end` inside an unclosed bracket on the same line as an array index
- Octave: Guard header-required openers from `case`/`elseif` value context
- Octave: Reject `do` followed by a numeric or string literal as a block opener
- Pascal: Skip `record` in a comparison context inside a record
- Pascal: Skip `record` used as a field name inside a record
- Pascal: Skip `repeat` on the left of a `:=` assignment
- Pascal: Skip `record` on the right of a `:=` assignment
- Ruby: Keep the sole closing `end` after expression-position content
- Ruby: Collect `else` after `rescue` in `def`/`class`/`module`/`do` blocks
- Ruby: Stop attaching `then` as an intermediate in `while`/`until` blocks
- VHDL: Correct nest level of blocks inside a single `generate` begin body
- VHDL: Keep `process`/`block` `is` intermediate under an enclosing block-opener line
- VHDL: Drop stray `then`/`else`/`elsif` in `for`/`while` `generate`

## [1.1.60] - 2026-05-29

### Fixed

- Ada: Recognize Ada intra-line whitespace in unterminated-string-after-paren detection
- Ada: Recognize non-ASCII letters in for-clause identifier scan
- Ada: Treat comment regions as transparent in extended-return malformed-form detection
- AppleScript: Replace linear `excludedRegions.filter` with binary search
- AppleScript: Skip record key positions for bare `end`
- Bash: Allow ASCII shell metacharacters to terminate keywords
- Bash: Require subject word between `case` and `in` for empty-case rescue
- Bash: Require whitespace before `}` when preceded by block-close keyword
- COBOL: Reset `REPLACE` pseudo-text context at statement-boundary verb
- COBOL: Skip reserved-word paragraph names in `PERFORM <verb>.`
- COBOL: Verify `REPLACE` prefix in `ALSO` walk-back for pseudo-text
- Crystal: Recognize `do` as loop separator across implicit-continuation lines
- Crystal: Stop following range operator filter from crossing newlines outside parens
- Crystal: Stop preceding range operator filter from crossing newlines outside parens
- Crystal: Suppress receiver-like keywords followed by cross-line method-chain dot
- Elixir: Skip `end` after word operators (`and`/`or`/`not`/`in`/`when`)
- Elixir: Skip middle keywords after word operators (`and`/`or`/`not`/`in`/`when`)
- Erlang: Exempt float, range, and record-field dots from terminator in catch clause scan
- Erlang: Skip comments between `fun` keyword and `(` in `-define` body analysis
- Erlang: Track all bracket nesting in `hasUnclosedOpenerInMapScope`
- Erlang: Treat `@` as identifier continuation in `hasUnclosedOpenerInMapScope`
- Fortran: Recognize continuation-split `block data` in compound end keyword
- Fortran: Reject cross-line empty parens in `select case`/`rank`/`type`
- Julia: Count nested block openers inside leading-for indexing brackets
- Lua: Anchor column at last char of multi-byte line break
- Lua: Drop reserved words after `..` concat operator
- MATLAB: Guard `pendingSkipDepths` skip with `remainingCloses` check
- MATLAB: Reject `function` used as identifier in function header
- Octave: Read parent MATLAB phantom-end positions in `matchBlocks`
- Octave: Reject block_open keywords used in `case`/`elseif` value position
- Octave: Reject `do` followed by identifier or unary operator on same line
- Octave: Treat section keyword `(...);` statement call as function call
- Octave: Treat typed-close keywords as value tokens in `case`/`elseif` headers
- Pascal: Recognize `asm` block opener after case-label colon
- Pascal: Recognize `class` after generic close directly preceding equals
- Ruby: Apply Unicode boundary check to loop keyword and `do` detection
- Ruby: Detect shift operator after Unicode identifier in heredoc
- Ruby: Filter `end` placed before range operator (`end..N`)
- Ruby: Recognize Unicode hash label colon when filtering `end` in expression position
- Ruby: Recognize Unicode identifier prefix before `class`/`module` in heredoc detection
- Verilog: Handle invalid end-label suffix on `endcase`
- Verilog: Suppress reserved words used as instance names
- VHDL: Deduplicate `begin` intermediate in single-begin block openers
- VHDL: Drop `else` inside `if` condition before `then`
- VHDL: Drop stray `else`/`elsif`/`then` for non-if/generate openers
- VHDL: Reject reserved-word type marks in type indication contexts
- VHDL: Skip `is` after `=>` in case branch arrow

## [1.1.59] - 2026-05-27

### Fixed

- Ada: Recognize Unicode line terminators in compound end designator lookahead bound
- Ada: Recognize Unicode line terminators in compound end line-comment
- Ada: Recognize Unicode line terminators in `isInsideParens` crossedNewline detection
- Ada: Recognize Unicode line terminators in multi-line type-decl `is` filter
- Ada: Reject `for` followed by non-identifier as block opener
- Ada: Restrict `is` intermediate to `is`-valid openers in `matchBlocks`
- AppleScript: Skip `tell`/`if`/`repeat` as right operand of `and`/`or`/`not`/`when`
- Bash: Push separate subshell frame for bare `(` inside `$()`
- Bash: Reject Unicode letter adjacency for `case`/`esac`/`in` keywords
- Bash: Require separator after `case` keyword inside `$()`
- Bash: Skip heredoc detection inside `[[ ]]` inside `$()`
- Bash: Treat bare `((` inside `$()` as arithmetic evaluation
- COBOL: Reject Unicode-letter-adjacent `COPY` matches
- COBOL: Treat Unicode letters as identifier boundary in `REPLACE`/`REPLACING` context detection
- Crystal: Handle missing `&` and `^` operators in receiver-like usage detection
- Crystal: Skip newlines when detecting range operator around `end`
- Crystal: Skip receiver-like keywords used as `case`/`when` pattern values
- Elixir: Reject `end` as expression-RHS of assignment or binary operator
- Elixir: Reject `end` followed by `(` or `.` as `block_close`
- Elixir: Reject middle keyword right after closing quote
- Erlang: Treat `@` as identifier continuation character in tokenizer
- Fortran: Prevent O(N²) memory consumption in `matchBlocks` compound-end tracking
- Fortran: Reject `associate` without parens as block opener
- Fortran: Suppress block keyword tokenization in F77-style type declarations without `::`
- Fortran: Treat numeric literal continuation before bare `end` as expression context
- Julia: Reject `end` followed by incomplete postfix marker (`..`, `.<digit>`, `{T}`, `.`)
- Julia: Skip intermediate keywords (`else`/`elseif`/`catch`/`finally`) inside brackets
- MATLAB: Skip `end` followed by colon range outside for-header
- MATLAB: Skip `end` preceded by closing quote or transpose operator
- MATLAB: Skip stray `end` for bare section keyword and `arguments` outside their valid context
- MATLAB: Skip stray `end` for empty-header block opener
- Octave: Accept typed-close after middle keyword on same line
- Octave: Detect `do` after condition keyword across line continuation
- Octave: Recognize shell escape `!` after statement separators
- Octave: Recognize `unwind_protect_cleanup` as middle keyword line leader
- Octave: Reject `do` in multi-identifier condition header
- Octave: Reject typed-close cell/bracket indexing assignment
- Octave: Skip Unicode horizontal whitespace before line continuation
- Pascal: Reject `else` in try block without preceding `except`
- Pascal: Skip `case` as field name in record body
- Pascal: Skip `case` missing `of` clause in record body
- Pascal: Skip `case` used as function call in expression
- Pascal: Skip `end` as field name in record body
- Pascal: Skip `try`/`record`/`case`/`begin` used as lhs of `:=` assignment
- Ruby: Detect `end` in expression position after value-like content
- Ruby: Match quoted heredoc terminator with leading or trailing whitespace
- Ruby: Recognize next-line `do` after loop keyword line without trailing comment
- Ruby: Reject `elsif` as intermediate of `unless` block
- Ruby: Skip trailing comment when detecting line continuation operator
- Ruby: Treat first `<<` as shift when followed by comma-LtLt pattern
- Verilog: Allow labeled `begin`/`fork` and end-label suffix inside `case_item` bodies
- Verilog: Skip keywords used as paren-less `#identifier` or `@identifier` operand
- Verilog: Suppress reserved word as `specparam` declaration identifier
- VHDL: Recognize all reserved-word block openers as `entity_class` in `attribute_specification`
- VHDL: Skip dot-prefixed `block_middle` keywords like `rec.then`
- VHDL: Skip reserved-word `entity_designator` after `entity` keyword

## [1.1.58] - 2026-05-26

### Fixed

- Ada: Recognize Unicode line terminators string literals
- Ada: Recognize Unicode line terminators compound end separator check
- Ada: Recognize Unicode line terminators single-line comments
- Ada: Recognize NBSP between access and subprogram keyword
- Ada: Recognize NBSP between null and record null record detection
- Ada: Recognize Unicode whitespace exception backward-scan filter
- Ada: Recognize is/access/of/return contexts exception type-mark filter
- Ada: Recognize Unicode whitespace isExtendedReturn malformed-form checks
- Ada: Reject for followed by open paren for-block validation
- Ada: Recognize Unicode line terminators line/column tracking and findLineStart
- AppleScript: Treat closed strings, pipe identifiers and chevron regions as expression terminators
- Bash: Recognize $ as literal character in heredoc delimiter
- Bash: Treat backslash-escaped character as single literal in heredoc delimiter
- Bash: Recognize time prefix split by backslash-newline
- COBOL: Recognize END-* and ELSE/WHEN after bare COPY
- COBOL: Skip reserved-word identifiers in same-line MOVE/ADD operands
- COBOL: Skip inline comments between PERFORM count and TIMES
- Crystal: Suppress receiver-like keywords in binary operator and compound assignment contexts
- Crystal: Treat / after method-like keywords (puts/print/raise) as division when separated by space
- Crystal: Close {{ }} macro template at first valid }} when singleBraceDepth is 2 and source has }}}
- Elixir: Continue backward keyword scan across newlines inside open parens
- Elixir: Reject middle keywords as binary operator RHS operands
- Erlang: Filter bare reserved words in -record type annotations
- Erlang: Detect quoted atom function head as -spec boundary
- Erlang: Treat third dot as -spec terminator in four-or-more dot runs
- Erlang: Recognize form-feed and vertical-tab as attribute leading whitespace
- Erlang: Filter bare reserved words inside binary literals in -define body
- Fortran: Allow blank lines in else continuation gap for else if/where
- Fortran: Allow continuation between is and paren in select-type guards
- Fortran: Skip fixed-form col-6 continuation marker in if-then backward scan
- Fortran: Reject cross-line empty parens in change team/submodule/associate openers
- Julia: Recognize symbol and prefixed string literals as value expressions before trailing generator
- Julia: Reject end as block close when followed by postfix index marker
- Julia: Reject end preceded by Unicode binary operator as block close
- Julia: Reject non-block reserved words as string and command macro prefix
- Julia: Skip excluded regions when scanning for binary operator after end
- Lua: Count LF+CR as single newline per Lua 5.3+ spec
- Lua: Treat comments as transparent (not opaque walls) in walk-back
- MATLAB: Treat section keywords as function calls when not directly inside classdef
- MATLAB: Strip line continuations inside arguments attribute parens
- MATLAB: Reject case/else/elseif/otherwise/catch followed by strict binary operator
- MATLAB: Reject case with empty header (case<NL>, case;) as intermediate
- Octave: Handle line continuation in arguments attribute list
- Octave: Allow typed close with trailing identifier as block close
- Pascal: Skip parameter list and return type when scanning of object
- Pascal: Reject duplicate else and of intermediates in case blocks
- Pascal: Use structural check for tagless variant case record
- Pascal: Recognize bracketed tag in variant case detection
- Ruby: Reject keyword operator RHS end (or/and/return/etc.)
- Ruby: Reject end after ternary question mark
- Ruby: Skip backslash line continuation in endless method def detection
- Ruby: Treat backslash inside comment as plain text in def detection
- Verilog: Suppress reserved word used as entity name after declaration keyword
- Verilog: Suppress block_open keyword inside parentheses
- Verilog: Suppress block_close keyword inside parentheses
- Verilog: Reject wait fork as control-keyword block opener
- Verilog: Suppress primitive/checker/sequence/property/config after extern
- Verilog: Traverse through begin/fork when detecting enclosing case for label-name
- Verilog: Suppress reserved word used as entity identifier after extends/implements
- VHDL: Handle comment-separated compound end with comments around trailing word
- VHDL: Anchor synthetic begin body nestLevel to innermost generate
- VHDL: Accept EOF and whitespace as trailing label terminator
- VHDL: Suppress all reserved-word labels in a run after compound end
- VHDL: Stop RHS context scan at unterminated strings
- VHDL: Reject reserved words after type indication colon
- VHDL: Reject reserved words in architecture/configuration of clause
- VHDL: Skip control-flow intermediates inside declaration blocks
- VHDL: Skip stray is in signal/variable/constant declarations

## [1.1.57] - 2026-05-25

### Fixed

- Ada: Restrict `else` and `elsif` intermediates to `if` and `select` blocks so they do not attach to `case`/`loop`/`begin`/`declare` openers
- Ada: Treat Unicode letters as identifier chars in the `select` keyword boundary check so `αselect` is not misread as a `select` keyword
- AppleScript: Recognize pipe-delimited handler names (`on |tell|()`) in the handler-name fallback so `on |tell|() ... end tell` pairs correctly
- AppleScript: Skip Unicode horizontal whitespace before `(` in keyword function-call checks so `if<NBSP>()` is treated as a function call
- Bash: Recognize `{`, `}`, `[`, `]`, `@`, `~`, `^`, `/` as bare heredoc delimiters so `<<{`/`<<@` etc. are detected as heredoc operators
- Bash: Treat `+`, `*`, `?` as keyword-fusing characters so `if+`, `then*`, `done?` are one-word identifiers, not reserved keywords
- Bash: Treat `{`/`}` and Unicode Symbol characters (emoji, currency, etc.) as keyword-fusing so `if😀`, `if€`, `if{` are not misread as `if` keyword
- COBOL: Recognize decimal-literal counts in `PERFORM <literal> TIMES` so `PERFORM 5.5 TIMES ... END-PERFORM` is detected as a block
- Crystal: Recognize `?<delim>` char literals inside `{% %}` and `{{ }}` macro templates so `?#`/`?"`/`?'`/`` ?` `` do not swallow the macro closer
- Crystal: Treat receiver-like keywords (`enum`, `select`, `struct`, etc.) followed by `==`/`===`/`=~`/`=>` as value expressions, not block openers
- Crystal: Reject `end` immediately after the `?` of a ternary expression (`cond ? end : a`) as a block close
- Elixir: Reject stray `block_middle` tokens (`else`/`rescue`/`catch`/`after`) inside parentheses so they do not attach to outer block openers as intermediates
- Erlang: Track bracket depth and ignore guard-sequence semicolons in `catch` clause detection so `try X catch 1; 2 -> ok end` pairs correctly
- Erlang: Cache `-define` body analysis to avoid quadratic keyword scanning so large `-define` bodies no longer freeze the parser (was `O(N²)`)
- Erlang: Recognize Unicode attribute names so `-définé(begin, end).` does not falsely pair internal `begin`/`end`
- Erlang: Detect triple-dot terminator in `-spec` declarations so `-spec foo() -> 1...` correctly ends the declaration at the third dot
- Fortran: Skip compound end keywords adjacent to a Unicode letter so `endif日本語` is not misread as `endif` block close
- Fortran: Require typed close (`end team`/`end block`/`end enum`) for `change team`/`block`/`enum` constructs so bare `end` does not falsely pair them
- Julia: Prevent stack overflow on chained brackets (`[[[[...`) in `isIndexingBracket` by converting tail recursion to iteration
- Julia: Prevent stack overflow on deeply nested string interpolation (`"$("$( ... )")"`) by replacing mutual recursion with an iterative engine
- Julia: Recognize `\`, `'`, `.+`, and Unicode operators as `lastindex` followers so `end \ 2`, `end'`, `end .+ 1`, `end ∈ S` do not steal the outer block's `end`
- Julia: Recognize `::`, `<:`, `>:` as `lastindex` followers inside indexing brackets so `arr[end::Int]` does not misclassify `end` as a block close
- Julia: Pair single-line value-returning blocks with their inner `end` so `begin x end + 1` is parsed as a block-with-trailing-stray-end
- Lua: Recognize exponent signs in the trailing-dot heuristic so `1e+5.end` is treated as field access on an invalid prefix, not a numeric literal
- Lua: Skip orphan colon-bounded label-like sequences (`:abc:keyword`) in method-call detection so the keyword still pairs as a block opener
- MATLAB: Detect a binary operator across `...` line continuations so `for ...<NL> + 1` rejects `for` as a block opener
- MATLAB: Accept Unicode horizontal whitespace in `skipWhitespaceAndContinuations` so `if<NBSP>= 5`/`end<VT>.field` are recognized correctly
- MATLAB / Octave: Pair `if`/`switch`/`try`/`unwind_protect` blocks when a middle keyword (`else`/`case`/`catch`/`unwind_protect_cleanup`) is followed by `end` on the same line
- Octave: Recognize Unicode horizontal whitespace in backslash line continuation so `if \<NBSP><NL>` is treated as a continuation
- Octave: Accept Unicode horizontal whitespace around block comment delimiters so `%{<NBSP>` and `%}<NBSP>` are recognized
- Octave: Reject `do)`/`do]`/`do}` as a block opener so the enclosing `function`/`end` pair survives
- Pascal: Skip field-access dot before `record` keyword so `X := Foo.record;` does not corrupt the record context map and break subsequent `case`/`end` pairs
- Pascal: Skip field-access dot before `object` keyword so `X := Foo.object;` does not corrupt the record context map
- Pascal: Treat `object` after `:=` as an expression value, not a type definition, so subsequent `case`/`end` pairs are preserved
- Pascal: Skip Unicode-prefixed identifiers in the record-context scan so `αrecord` is not misread as the `record` keyword
- Pascal: Treat Unicode-extended identifiers as keyword boundary in the backward `=` scan so `type αif = class ... end;` pairs correctly
- Pascal: Treat Unicode-extended identifiers as keyword boundary in `isIfThenElse` so `case x of 1: αthen else b; end;` keeps `else` as an intermediate
- Pascal: Skip `end` and `until` after `..` range operator so `array[0..end]` does not close an outer block
- Ruby: Treat `/` after a Unicode identifier as division (not regex start) so `x = メソッド / 2` is parsed correctly
- Ruby: Recognize Unicode predicate methods (`メソッド?`/`メソッド!`) in postfix conditional detection so `メソッド? if cond` is treated as a postfix `if`
- Ruby: Treat `class <<expr` (space before `<<`, no space after) as a singleton class, not a heredoc, so `class <<Foo ... end` pairs correctly
- Ruby: Skip newlines when detecting the range operator before `end` so `(1..\n  end)` does not close an outer block
- Ruby: Follow implicit line continuation when detecting `end` in expression position so `a +\n  end` does not close an outer block
- Verilog/SystemVerilog: Skip `case` suppression for sensitivity wildcard `@*` so `always @* case (sel) ... endcase` is paired
- Verilog/SystemVerilog: Skip block comments between declarator commas so `reg a /*c*/, /*c*/ endmodule;` suppresses the inner identifier
- Verilog/SystemVerilog: Skip preprocessor directive lines when scanning for `` `pragma protect end `` so a literal occurrence inside `` `define `` does not falsely terminate the protected region
- VHDL: Recognize `view` as a VHDL-2019 entity_class in attribute specification so `attribute keep of bus_view : view is true;` does not trigger a stray `view` block opener
- VHDL: Detect multi-line subprogram `is` filter via paren walk so `procedure noop(...) is null;` spanning more than 5 header lines correctly filters the `is` keyword
- VHDL: Reject reserved words (`view`/`units`/`block`/`loop`/`record`/`protected`/`context`/`process`/`entity` etc.) in expression RHS context so they are not promoted to block openers

## [1.1.56] - 2026-05-24

### Fixed

- AppleScript: Recognize `on error()` function-style handler declaration so the `on`/`end` pair is detected when `error` is used as a handler name
- AppleScript: Reject `if(condition)` function-call form so it does not open a block (`if (cond) then` with whitespace is still valid)
- AppleScript: Handle Unicode whitespace after `¬` continuation in the handler-name probe so handlers spanning Unicode-indented continuation lines are recognized
- Bash: Reject `esac` as a POSIX case pattern in paren-scope check so `(case x in esac)` inside a same-line subshell still pairs
- Bash: Detect keywords split by `\<newline>` line continuation (e.g. `i\<NL>f`, `f\<NL>i`, `do\<NL>ne`) so they are paired as `if`/`fi`/`done`
- COBOL: Support `PERFORM N TIMES` iteration phrase split across newlines so `PERFORM 3\n TIMES ... END-PERFORM` is detected as a block
- COBOL: Treat a dangling `,`/`;`/`(` before a newline as an incomplete expression so the next-line `ELSE`/`WHEN` is kept as an intermediate
- COBOL: Recognize a bare `COPY` (no copybook name) before a block-opening verb so the following `IF`/`PERFORM`/`EVALUATE` block is not swallowed as a copybook name
- Crystal: Pair `def`/`end` when a parameter has a default value without parens (`def foo x = 1`) so it is not misread as a shorthand `def`
- Crystal: Suppress receiver-like keywords (`select`, `enum`, `union`, `struct`, `lib`, `macro`, `annotation`) followed by `[` or `|` so an index access or block argument does not break the enclosing block
- Crystal: Mark an unterminated char literal trailing backslash as an excluded region so the following `if` is not misread as a postfix conditional
- Elixir: Skip `fn` as a value when followed by `do` after a block keyword (`case fn do ... end`) so the outer block keyword is not orphaned
- Elixir: Skip `fn` as a function name after a definition keyword (`def fn do ... end`) so the `def`/`end` pair is detected
- Elixir: Skip newlines and comments between `fn(...)` and `do` so `if fn(x)\ndo` does not misclassify `fn` as a block opener
- Elixir: Skip keyword tokens immediately after a `?<char>` character literal so a bare `end` after `?#` does not close an outer block
- Elixir: Reject stray `end` inside parentheses to prevent cascade pairing with an enclosing block
- Elixir: Require a word boundary after a triple-quoted string terminator so `"""abc"""end` is recognized as an unterminated triple-quoted string and `end` does not leak as a block close
- Erlang: Track nested brace depth in the map opener scan so a `begin`/`end` inside an inner map literal does not falsely close an outer block
- Erlang: Detect a real `fun`/`end` pair inside a nested function call in a `-define` body so `list:map(fun(X) -> X end, L)` is paired
- Fortran: Recognize a construct name after a concatenated compound end (`endif do`, `enddo if`) so the trailing label is not misread as a phantom block opener
- Fortran: Support line continuation in `select type` guard tokens (`type & \n is`, `class & \n is`) so the guard is added as an intermediate
- Fortran: Skip `select type` guard injection inside parentheses so `(class is (integer))` does not inject a phantom `block_middle`
- Fortran: Skip `select type` guard injection adjacent to a Unicode letter so identifiers like `étype` are not partially matched as `type is`
- Julia: Reject `end` followed by range/logical/bitwise/pair operators (`:`, `&&`, `||`, `&`, `|`, `=>`) outside indexing brackets so the inner `end` does not steal the outer block's `end`
- MATLAB: Reject `arguments(obj)` as a function call inside a function body so the outer `function`/`end` pair is not broken by a misidentified `arguments` block
- MATLAB: Treat a single-quote followed by a Unicode letter as a string-start, not transpose, so non-ASCII string literals are recognized correctly
- MATLAB: Treat VT/FF/Unicode horizontal whitespace as a command-syntax separator so `disp<VT>if` is recognized as command syntax
- MATLAB: Reject `end` inside `if`/`while`/`switch` header expressions so a stray `end` in a condition does not close the enclosing block
- MATLAB: Skip Unicode horizontal whitespace in the binary-operator detection for `end` so `1 + <NBSP>end` does not misclassify `end` as a block close
- MATLAB: Reject `end` after a value token (identifier, `)`, `]`, `}`, `.`, `--`) on the same logical line so `x = a end` does not close an outer block
- MATLAB: Skip string literals when scanning the command-syntax identifier run so `disp "end" if x` is recognized as command syntax
- Octave: Recognize cell `{}`, bracket `[]`, and chained `()()` indexing assignment so `end{1} = 5`, `end[1] = 5`, `end(1)(2) = 5`, `end{1}.x = 5` do not close an outer block
- Octave: Treat a quote followed by a Unicode letter as a string opener so `disp'θ end'` is recognized as a string and the inner `end` does not leak
- Octave: Reject `end` as a block close when used in an `until` condition so `until end > 0` does not close the enclosing block
- Pascal: Skip `class` in a comparison context (`X = class`) inside a record so it is not treated as a record-context `open-block` and the surrounding `record`/`end` pair survives
- Pascal: Skip `interface` in a comparison context inside a record so the record/end pair survives
- Pascal: Skip `object` in a comparison context inside a record so the record/end pair survives
- Pascal: Recognize `class const`/`class type`/`class threadvar` as method modifiers in a record so they are not treated as block openers
- Ruby: Skip `end` after a hash label colon (`{a: end}`) so it does not close an outer block
- Ruby: Accept an indented terminator under a no-flag heredoc (`<<EOF`) so a typo of `<<EOF` with indented `  EOF` does not swallow the rest of the source
- Ruby: Trim trailing whitespace on a heredoc terminator line so `EOF<space>` still terminates the heredoc
- Ruby: Allow newline crossing in the ternary scan for `end` value position so a multi-line ternary `cond ?\n a :\n end` does not misclassify `end` as a block close
- Ruby: Recognize Unicode and emoji symbol literals (`:Π`, `:日本語`, `:a😀b`) as excluded regions
- Verilog/SystemVerilog: Skip cast detection when `)` is inside an `(* attr *)` attribute region so attribute-prefixed module declarations parse in linear time (was `O(N²)`)
- Verilog/SystemVerilog: Treat newlines as whitespace in the `wait fork` detection so `wait\nfork;` is recognized as a free-form `wait fork` statement
- Verilog/SystemVerilog: Skip comments inside `#`-delay expressions so `always # /* delay */ N begin` is paired with `end`
- Verilog/SystemVerilog: Skip `(* attr *)` attribute regions in the data-type-keyword backward scan so `int (* attr *) endmodule;` suppresses the inner identifier
- Verilog/SystemVerilog: Skip comma-separated declaration chains in data-type detection so `reg a, endmodule;` suppresses the trailing identifier as a close keyword
- Verilog/SystemVerilog: Skip comments inside scope resolution detection so `pkg::/* c */begin` suppresses the trailing keyword
- Verilog/SystemVerilog: Filter block keywords inside array subscript brackets so `foreach (arr[case])` does not misclassify `case` as a block opener
- Verilog/SystemVerilog: Skip `default` inside a paren-less control (`forever`, `initial`, `final`, `always_*`) or `else` single-statement body so it is not attached to an outer `case`
- Verilog/SystemVerilog: Skip comments inside ``pragma protect`` directive arguments so a comment-mixed `pragma protect begin`/`end` is recognized
- VHDL: Limit the attribute reference check to declarative item keywords so `if 'a' = c then` is recognized as a control-flow opener
- VHDL: Consume 5-character backslash-escape character literals (`'\nX'`) so an unterminated tolerant char literal does not leak as an extended identifier
- VHDL: Restrict the `is null`/`is (expr)` filter to subprogram headers so the `is` intermediate of `process is null;` etc. is preserved
- VHDL: Treat attribute_specification scan-limit exhaustion as conservative-true so an entity_class keyword after a long attribute declaration is not promoted to a block opener
- VHDL: Close `generate` and its control prefix (`if`/`for`/`while`/`case`) together for a bare `end;` inside a nested if-generate so the inner `if` is not orphaned
- VHDL: Tolerate newlines between a keyword and an attribute reference apostrophe so `process\n'foreign` is recognized as an attribute reference
- VHDL: Recognize VHDL-2019 `view` declarations as block openers so `view ... end view` is paired and does not pollute the surrounding intermediates

## [1.1.55] - 2026-05-23

### Fixed

- Ada: Detect a parameter-list `;` separator inside parens so an `if`/`case` expression default value does not break the enclosing `procedure` pair
- Ada: Skip a qualified-name `Exception` identifier (`Pkg.Sub.Exception`) so it is not added to intermediates as a `block_middle`
- Ada: Skip a `with`-prefixed `Exception` identifier in type extensions so it is not added to intermediates
- AppleScript: Skip Unicode whitespace indentation after a `¬` continuation so a compound keyword (`end tell`) is correctly detected
- AppleScript: Skip single-line comments after `¬` continuation in handler name probe so `on ¬ -- comment\n handler` is recognized
- AppleScript: Stop a backslash from escaping a newline in pipe identifiers so `|a\<NL>b|` does not span lines
- Bash: Skip keywords followed by word-fusion characters (`$`, `\`, `]`) so `done$var`/`fi$var`/`done\foo`/`done]` are not treated as block closes
- Bash: Track subshell `(...)` boundaries in pair matching so a `done` inside `(echo; done)` does not steal an outer `for`'s close
- Bash: Accept Unicode letters in heredoc terminators so `<<XYΖ` is recognized as a delimiter
- Bash: Skip the terminator newline between stacked heredocs so a multi-heredoc body region does not include an extra leading newline
- COBOL: Treat `END-*`/`WHEN`/`ELSE` as a period-less `COPY` boundary so subsequent block pairs are not absorbed into the COPY range
- COBOL: Skip `block_middle` keywords (`WHEN`, `ELSE`) used as `COPY` copybook names so they are not added to intermediates
- COBOL: Reject `PERFORM.` (verb-only with period) as a structured `PERFORM` so it does not mispair with a following `END-PERFORM`
- Crystal: Close a macro template (`{{ }}`, `{% %}`) at its same-line `}}`/`%}` even when a `<<-IDENT` heredoc opener is present so the heredoc body does not swallow downstream code
- Crystal: Skip context-dependent keywords (`select`, `enum`, `union`, ...) used as a function call (`select(x)`) so they do not break the enclosing block
- Elixir: Skip keywords with a `~` sigil prefix (`~end`, `~else`) so they are not tokenized as block keywords
- Erlang: Allow newlines inside paired-delimiter sigils (`~b{...}`, `~r(...)`, ...) so multi-line sigil bodies are treated as a single excluded region
- Erlang: Skip `fun` references when counting openers in map scope so a map literal containing `fun foo/1 => ...` and `end => ...` does not mispair the outer block
- Fortran: Skip a middle keyword (`else`, `case`, `rank`, ...) preceded by a dot operator (`.and.`, `.or.`) so it is not added to intermediates
- Fortran: Treat `end[N] = 5` (coarray image selector) as an array assignment so the `end` identifier is not treated as a block close
- Fortran: Support long user-defined dot operators (over 7 characters) before `end` so the `end` identifier is not treated as a block close
- Julia: Recognize BMP-outside Unicode characters as a command-macro prefix so `𝐀\`cmd\`end` correctly absorbs `end` as a suffix
- Julia: Reject a block keyword (`if`, `for`, ...) as a command-macro prefix so `if\`cmd\`end` does not absorb `end` into the macro
- Julia: Reject a leading digit as a command-macro prefix so `1\`cmd\`end` does not absorb `end` into the macro
- Lua: Handle `\<LF><CR>` line continuation in string literals so a Lua 5.4 LF+CR line ending is treated as a continuation
- Lua: Keep a reserved keyword token after `goto` with no label name so `function f() goto end` is not stripped of its `end`
- MATLAB: Skip `end` used as a `case`/`otherwise` value so the inner `end` does not close the outer `switch`
- MATLAB: Reject empty-header block openers (`if;`, `for;`, ...) so they do not consume the outer `function`'s close
- MATLAB: Reject `end` followed by a binary operator (`end + 1`, `end ...\n * 2`) so the `end` variable use is not treated as a block close
- MATLAB: Skip `end` followed by struct field access across a `...` line continuation so `end ...\n .field` is not treated as a block close
- MATLAB: Skip `case`/`otherwise` followed by `=` across a `...` line continuation so the assignment is detected and the keyword is not added to intermediates
- Octave: Skip `\<NL>` backslash line continuation in block-open keyword validation so `if \<NL> cond ... end` is paired correctly
- Octave: Skip `...`/`\<NL>` line continuation when validating section keywords (`properties`, `methods`) followed by an operator so they are not opened as a block
- Octave: Skip `...`/`\<NL>` line continuation when detecting `end(...)` indexing assignment so `end ...\n(1) = 5` is recognized
- Octave: Skip Unicode horizontal whitespace (NBSP, etc.) when detecting `end (...)` indexing assignment so `end<NBSP>(1) = 5` is recognized
- Octave: Skip `...`/`\<NL>` line continuation when detecting `arguments(obj)` function call so `arguments ...\n(obj);` is not opened as a block
- Octave: Skip `...`/`\<NL>` line continuation in typed-close trailing-content check so `endif ...\n` is recognized as a block close
- Ruby: Treat `%%` as the modulo operator everywhere so `x=%%` does not start an unterminated percent literal that swallows following blocks
- Ruby: Treat `%=` as a compound modulo assignment so `x=%=` does not start an unterminated percent literal that swallows following blocks
- Ruby: Treat a line-leading `%%foo` as a degenerate percent literal that does not swallow following blocks
- Ruby: Filter a stray `end` in expression position (after `(`, `[`, `=`, binary operator, etc.) so `def foo(end)` and `if cond\n x = /pat/ end\n end` do not mispair the outer block
- Ruby: Accept Unicode identifiers in heredoc terminators so `<<日本語` is recognized as a delimiter
- Ruby: Recognize `do` as a loop separator when the previous line ends with a comment so `while cond # comment\ndo\n body\nend` is paired correctly
- Verilog: Handle `\<CRLF>`/`\<CR>` line continuation inside macro arg strings so `` `MACRO("text\<CR><LF>...") `` does not break the arg list
- Verilog: Skip reserved words used as `case_item` label names (`endcase: x = 1`) so they are not tokenized as block opens/closes
- Verilog: Skip reserved words used as a cast operand (`(int)endmodule`) so they are not tokenized as block closes
- Verilog: Skip reserved words inside `#(...)` delay expressions so they are not tokenized as block opens/closes
- Verilog: Allow newlines between a `` `ifdef `` directive and its macro name so the next line's keyword is not opened as a block
- Verilog: Skip `case`/`casex`/`casez` followed by a binary operator (`case == x`) so they are not opened as a block
- VHDL: Treat `'\X'` (character literal containing backslash) as a 4-character literal so `\` does not trigger extended-identifier detection
- VHDL: Treat a semicolon-terminated previous line as a statement end when validating `for` opener so `wait ... for X;` does not absorb the following independent `for` loop
- VHDL: Preserve the `is` intermediate for multi-line `package body` headers so it is correctly attached to the surrounding block
- VHDL: Skip the trailing `when` of a concurrent assertion (`assert ... when condition;`) inside a `case` branch so it is not added to case intermediates
- VHDL: Reject `end` in mid-expression so a stray `end` does not cascade-pop the enclosing block opener

## [1.1.54] - 2026-05-23

### Fixed

- Ada: Bound the line-start `or` backward scan so a `select` body with many wrapped `or` operators no longer scales quadratically
- AppleScript: Suppress a block-open keyword used as a multi-line record key (`tell:`, `script:`) so it does not steal an outer block's close
- Bash: Treat an array-literal close `)` as a non-separator before `}` so `{ x=(1)}` does not produce a phantom `{`/`}` pair
- Bash: Verify that `in` before `esac` is the case header's own keyword so an argument word `in` does not close the case early
- COBOL: Treat alphabetic relational words (`EQUAL`, `GREATER`, `LESS`) as operators so a following `ELSE`/`WHEN` is not added to intermediates
- Crystal: Skip context-dependent keywords (`select`, `union`, `enum`) used as a receiver or assignment target so they do not break the enclosing `def`/`end` pair
- Elixir: Restrict middle keyword attachment to openers that accept them so `else`/`rescue` are not added to the intermediates of `fn`/`defmodule`/`quote`
- Elixir: Skip a middle keyword used as a `=~` match operand (`rescue =~ x`) so it is not added to intermediates
- Erlang: Skip multi-character and user-defined sigil prefixes (`~r/.../`, `~json{...}`) so block keywords inside the sigil body are not detected
- Fortran: Reject `associate ()` with an empty association list so it is not opened as a block
- Fortran: Support fixed-form column-6 continuation in `if`-`then` headers so a wrapped block-if is paired with its `end if`
- Julia: Pair a nested value-returning block ending with a binary operator (`begin ... end + 1`) with its inner opener instead of the outer block
- MATLAB: Detect a variable assignment across a `...` line continuation (`end ...` then `= 5`) so the keyword is not treated as a block close or open
- Octave: Allow Unicode horizontal whitespace around typed-close keywords (`endif` followed by NBSP) so the close is recognized
- Octave: Reject an indexed `end`/`until` with a compound or field assignment (`end(1) += 5`, `end(1).x = 5`) so it is not treated as a block close
- Octave: Reject `do` used in a condition position (`if do`) so it is not opened as a do/until block
- Pascal: Handle a qualified-name constant-equality case label (`A.B = object:`) so `object`/`class` is not opened as a block
- Ruby: Prevent a line-leading `%%` from opening an unterminated percent literal that swallows following blocks
- Ruby: Restrict `rescue`/`ensure` attachment to blocks that accept them so they are not added to the intermediates of `while`/`until`/`for`/`case` blocks
- Verilog: Stop `end` from closing an outer `if` before a single-statement `else` so a dangling `else` is not mispaired
- Verilog: Suppress `fork` after `disable`/`wait` on the previous line so a newline-separated `disable fork` does not produce a phantom `fork`/`join` pair
- VHDL: Correct the nest level of a single `generate` body so the synthetic `begin` body is not over-nested
- VHDL: Skip a single-line configuration specification (`for all : comp use entity ...;`) so it does not steal an enclosing block's `end`

## [1.1.53] - 2026-05-22

### Fixed

- AppleScript: Treat U+2212 (minus sign) as a binary operator so a keyword after it (`1 − tell`) is not opened as a block
- AppleScript: Treat a stray right double quotation mark (`U+201D`) as an expression terminator so a following keyword is not opened as a block
- Bash: Skip block middle keywords (`then`, `else`, `elif`, `do`) used as function names so they are not added to intermediates
- Bash: Reject a command group close `}` after a stray `]` without a separator so `{ echo foo]}` does not produce a phantom `{`/`}` pair
- COBOL: Resolve pseudo-text `==` context in a single pass so a long run of consecutive `==` (banner lines) no longer hangs with superlinear scanning
- COBOL: Skip crossing block pairs (`IF` interleaved with `PERFORM`) so overlapping pairs are not generated
- Crystal: Bound an unterminated `<<-"FOO` heredoc opener to its own line so it no longer swallows following blocks up to a distant quote
- Elixir: Scan nested string interpolation iteratively so deeply nested interpolation no longer overflows the stack
- Elixir: Detect chained block keywords iteratively so a long keyword chain no longer overflows the stack or degrades quadratically
- Elixir: Skip reserved middle keywords used in expressions (`else(x)`, `after(5000)`, `else.bar`) so they are not added to intermediates
- Fortran: Bound opener validation to the opener's logical line so files with many blocks validate in linear time instead of `O(N²)`
- Fortran: Reject an empty parenthesized condition `if ()` so it is not opened as a block
- Julia: Pair a block-expression `end` followed by a binary operator (`begin ... end + 1`) instead of dropping the block
- MATLAB: Treat a logical compound assignment after `end` (`end &= 1`, `end |= 1`) as a variable use instead of a block close
- Octave: Skip Unicode horizontal whitespace before an assignment so `do<NBSP>= 1` is treated as a variable assignment, not a block opener
- Pascal: Stop the generic-constraint scan at a statement boundary so a `<` in a preceding statement no longer suppresses a following `record` block
- Pascal: Reject an `asm` block opener after a closing parenthesis (`if (x) asm`) so it is not opened as a block
- Ruby: Filter an `end` in a multi-line ternary value position so it is not mispaired with a preceding `def`
- Ruby: Restrict `when`/`else`/`elsif` attachment to matching block types so they are not added to the intermediates of `do`/`while`/`for` blocks
- Verilog: Scan delay expressions iteratively so a long operator chain (`#1+1+...`) no longer overflows the stack
- Verilog: Suppress `case`/`casez`/`casex` keywords after a comparison operator (`x == casez`) so they are not opened as a block

## [1.1.52] - 2026-05-21

### Fixed

- Ada: Recognize NBSP and other Unicode whitespace at physical line start so `or` is kept as a `select` alternative intermediate
- Ada: Accept Unicode whitespace between `access` and `protected` so `access<NBSP>protected` does not open a phantom `protected` block
- AppleScript: Suppress the handler-name fallback for `using terms from` so `on from()` is not mispaired with `end using terms from`
- COBOL: End a period-less `COPY` at a following non-block verb (`MOVE`, `SET`, `STOP`, `OPEN`, `CLOSE`, `CONTINUE`) so the next block close is not absorbed into the COPY range
- Crystal: Skip an `end` on the left side of a range operator (`end..N`, `end...N`) so it is not treated as a block close
- Elixir: Treat a middle keyword used as a function name after a definition keyword (`def rescue do`, `def catch(x) do`, `def after(x) do`) as an identifier, not a block intermediate
- Erlang: Reject `fun` inside a `-spec` type context across multiple newlines so a blank-lined type expression is not opened as a block
- Erlang: Skip `end`/`of`/`after`/`else` tokens inside a `-spec`/`-type`/`-callback`/`-opaque` context so they do not mispair with surrounding blocks
- Erlang: Bound an unterminated `-spec`/`-type` declaration at the next attribute or function head instead of treating the rest of the file as type context
- Fortran: Skip `end` inside array constructors `[...]` and coarray image selectors so it is not treated as a phantom block close
- Fortran: Recognize a procedure name on a `&` continuation line (`program &` `block`) so the trailing name no longer becomes a phantom block opener
- Fortran: Skip labeled DO loops across continuation lines (`do &` `100 i = 1, 10`) so they are not treated as block openers
- Julia: Skip an `end` adjacent to a binary or unary operator outside indexing brackets (`!end`, `end!=N`, `end<N`) so it is not treated as a block close
- Lua: Drop `then`/`else`/`elseif` when the enclosing opener is not `if`/`elseif` so invalid syntax does not pollute intermediates
- MATLAB: Reject `try`/`spmd`/`classdef` followed by a prefix-capable operator (`+ - ~ !`) so they are not opened as blocks
- Octave: Drop a rejected `arguments` block instead of phantom-skipping the enclosing block's `end`, so an outer `if`/`end` pair survives
- Octave: Treat `do..` (two dots) as a field-access prefix instead of a `do` block opener
- Pascal: Treat consecutive `>` characters as nested generic closes instead of a shift operator so `record` inside `<T<U<record>>>` is not opened as a block
- Pascal: Reject a duplicate `else` after `try-except-else` so the second `else` is not added to intermediates
- Pascal: Skip `of` used as a case-label position (`of:`) so it is not added to intermediates
- Ruby: Recognize endless method definitions with Unicode method names (`def αβγ = 1`) so they are not treated as block openers
- Ruby: Recognize endless method definitions with Unicode class receivers (`def 日本語.foo = 1`) so they are not treated as block openers
- Ruby: Treat spaced division after method-like keywords (`p / 2`, `puts / 2`) as division instead of a multiline regex that swallows the rest of the file
- Verilog: Skip strings and comments when scanning for the matching `` `pragma protect end `` so a literal occurrence inside protected data does not end the region early
- Verilog: Treat escaped identifiers and strings as word boundaries when scanning for a preceding data-type keyword so `int \my_var endmodule` keeps its `endmodule` token
- VHDL: Skip the trailing type word of a comment-separated compound `end` rejected by validation (`inst.end /* c */ process`) so it does not become a stray block opener

## [1.1.51] - 2026-05-21

### Fixed

- Ada / Fortran / VHDL: Match compound `end` keywords (`end if`, `end loop`) with a binary search instead of an O(tokens × compounds) per-token scan
- All languages: Recalculate block nest levels in O(P log P) instead of O(P²) so deeply nested files colorize without quadratic slowdown
- All languages: Memoize block-keyword type classification so tokenization no longer scans the keyword list for every token
- Julia: Look up enclosing parentheses through a precomputed bracket index so generator and named-tuple validation runs in linear time instead of O(n²)
- Verilog: Look up enclosing braces through a precomputed bracket index so assignment-pattern detection runs in linear time instead of O(n²)
- Verilog: Look up enclosing parentheses through a precomputed bracket index for the `interface` port-list check instead of scanning from the source start
- VHDL: Look up enclosing parentheses through a precomputed bracket index so block validation runs in linear time instead of O(n²)
- VHDL: Scan only a bounded line window when validating `loop` and `for ... generate` openers instead of the whole source prefix

## [1.1.50] - 2026-05-19

### Fixed

- Ada / VHDL: Bound the `isValidLoopOpen` backward scan so files with many `loop` keywords validate in linear time instead of O(n²)
- AppleScript: Discard inner unclosed openers when a close keyword would otherwise produce crossing block pairs (interleaved `tell`/`if`)
- AppleScript: Close a chevron `«...»` at the first `»` instead of depth-counting, so an extra `«` no longer swallows the rest of the file
- AppleScript: Attach `else`/`else if` to the nearest ancestor `if` block when it is not the innermost open block
- COBOL: Use the tab-expanded visual column for the fixed-format identification area so tab-indented keywords there are excluded
- COBOL: Treat `>>` as a compiler directive only when it is the first non-blank token on a line, not mid-expression
- COBOL: Keep `ELSE`/`WHEN` as an intermediate keyword when the previous line ends with a dangling relational or arithmetic operator
- Crystal: Skip an `end` immediately after a range operator (`(1..end)`) so it is not treated as a block close
- Crystal: Skip an `end` in ternary value position (`cond ? a : end`) so it is not treated as a block close
- Crystal: Treat `%%` as a modulo operator instead of a percent-literal start that swallows the rest of the source
- Elixir: Treat a block keyword used as a function name after a definition keyword (`def unless(x) do`) as an identifier, not a block opener
- Erlang: Detect real blocks (`fun`/`begin`) inside a `-define` tuple body instead of filtering every keyword there
- Erlang: Filter bare reserved words inside a `-define` list literal so they do not mispair with a later `end`
- Erlang: Filter a bare reserved word inside `-define` grouping parentheses so it does not mispair with a later `end`
- Julia: Precompute a bracket index per parse so block-keyword validation runs in linear time instead of O(n²)
- MATLAB: Skip duplicate `else`/`otherwise`/`catch` intermediates so an invalid extra `catch` or `else` is not recorded twice
- Octave: Treat vertical tab and form feed as token separators when detecting a command-syntax `do` argument
- Pascal: Restrict the single-line `asm` `;`-comment scan so `; end` no longer bloats the excluded region to end-of-file and loses following blocks
- Pascal: Reject `asm` after `>` or `]` in block-open validation, matching the asm excluded-region check
- Ruby: Treat a Unicode identifier character before `def` as a keyword boundary so `fooαdef do` keeps its `do`/`end` pair
- Ruby: Treat a `rescue` after a continuation-operator line as a clause start so it is kept as a `begin` intermediate
- Verilog: Suppress a `case` keyword right after an assignment operator regardless of a following `(`
- Verilog: Skip `default` inside a single-statement control body so it is not attached to an outer `case`

## [1.1.49] - 2026-05-18

### Fixed

- Ada: Pair compound `end` keywords (`end if`, `end loop`, etc.) separated by U+0085 (NEL) or other Unicode whitespace, instead of mismatching the innermost block
- Ada: Replace the quadratic compound-end crossing precomputation so large flat block lists parse in linear time and no longer exhaust the heap
- Bash: Make keyword validation linear-time for large scripts by precomputing `[[ ]]` and parenthesis regions instead of per-keyword backward scans
- Bash: Prevent crossing block pairs when `done` or `}` closes an enclosing opener over an inner unmatched block
- COBOL: Treat an identifier-trailing hyphen as part of a data name so `WHEN`/`ELSE` after a hyphen-continued line is detected as an intermediate keyword
- COBOL: End a period-less `COPY` statement at a following non-block verb so a later `REPLACING` is not misdetected as pseudo-text
- Crystal: Stop treating a semicolon-delimited `def` body assignment (`def foo; x = 1; end`) as a bodyless shorthand definition
- Crystal: Recognize a loop `do` wrapped onto the next line (`while x` then `do`) as the loop separator
- MATLAB: Skip `...` line continuations when detecting classdef section keyword assignment (`properties ...` then `= 5`)
- MATLAB / Octave: Reject a classdef section keyword followed by `:` (`properties:`) as invalid usage instead of opening a block
- MATLAB / Octave: Treat a quote that follows an identifier letter as a string start, not a transpose operator (`disp'end'`), so keywords inside the string are excluded
- Octave: Skip form feed and vertical tab when detecting a `do` assignment so `do` is not misread as a block opener
- Pascal: Recognize a variant record `case` whose selector tag is a parenthesized anonymous type or a numeric literal
- Ruby: Skip comment and string content when detecting multi-heredoc lists so a `, <<` inside a comment no longer misdetects a shift operator as a heredoc
- Ruby: Skip `then` as an intermediate keyword for blocks (`def`, `class`, `module`, `begin`, `for`) that cannot take a `then` clause
- Verilog: Skip `default` attachment past statement-block openers (`begin`/`fork`) so a `default` inside an unclosed block is not attached to an outer `case`

## [1.1.48] - 2026-05-17

### Changed

- Switch the `test:coverage` script to c8 and mocha for accurate parser branch-coverage measurement

### Refactored

- Julia: Split `juliaParser.ts` by extracting bracket-context helpers to `juliaBracketHelpers.ts` and lastindex helpers to `juliaLastindexHelpers.ts`
- MATLAB: Split `matlabParser.ts` by extracting logical-line cache, pure scan, and excluded-region helpers to `matlabCacheHelpers.ts`, `matlabHelpers.ts`, and `matlabExcluded.ts`
- COBOL: Split `cobolParser.ts` by extracting fixed-format helpers to `cobolFixedFormat.ts` and pseudo-text helpers to `cobolPseudoText.ts`
- Ada/VHDL/Fortran/COBOL/Pascal: Extract the duplicated case-insensitive keyword pattern builder to `buildCaseInsensitiveKeywordPattern` in `parserUtils.ts`
- Base parser: Extract the keyword pattern builder in `tokenize` to a dedicated `buildKeywordPattern` method
- Extension: Extract the duplicated debounce timer cleanup into a `clearAllDebounceTimers` helper
- Tests: Extract the duplicated nested-block nest-level test into a shared `generateNestedBlockTests` generator across 10 parser test files
- Tests: Merge duplicate test suites, relocate `generateCommonTests` to file end, and remove empty suites across Bash, COBOL, Crystal, Ada, and Fortran test files

### Tests

- Improve branch coverage across the Ada, COBOL, Julia, Octave, and Verilog parser tests

## [1.1.47] - 2026-05-16

### Fixed

- Ada: Keep the if-then intermediate after an identifier ending in `and` (`Command`, `Operand`)
- Ada: Treat a same-line compound end without a trailing semicolon as a compound close
- Ada: Reject the `end return` compound merge when no trailing semicolon follows
- Ada: Keep `or` as a select intermediate after a non-semicolon-terminated alternative body
- Ada: Bound the `isInsideParens` backward scan to avoid quadratic slowdown on deep nesting
- AppleScript: Allow `tell` with a parenthesized object specifier (`tell (window 1)`)
- AppleScript: Ignore parenthesized `to` (`path to me`) in `tell` one-liner detection
- Bash: Prevent stack overflow on deeply nested `$(...)` and `${...}` expansions
- Bash: Prevent stack overflow from long `time` and environment-variable command-prefix chains
- Bash: Skip double-bracket mode for an unclosed `[[` so following comments and blocks survive
- Bash: Skip heredoc detection for `<<` inside `[[ ]]` conditionals
- COBOL: Skip EXEC blocks in the pseudo-text scan so `REPLACE` does not leak past `END-EXEC`
- COBOL: Skip `COPY` copybook names in the opener-position scan (`COPY IF.`)
- COBOL: End a period-less `COPY` statement at the following block verb
- COBOL: Keep a next-line `WHEN`/`ELSE` intermediate after a line ending in an operand introducer
- COBOL: Register `WHEN`/`ELSE` on the enclosing block past an unclosed inner block
- Crystal: Recognize a regex literal passed as a method argument (`str.match /re/`), shared with Ruby
- Crystal: Skip `abstract def` detection when `abstract` is inside a comment or string
- Crystal: Treat a keyword after a `{{ }}` macro expression as a postfix conditional
- Crystal: Skip intermediate keywords incompatible with the enclosing block
- Elixir: Treat a block keyword before a closing bracket as a value, not a block opener
- Erlang: Support all OTP 27 sigil delimiters (`()`, `[]`, `{}`, `<>`, `/`, `|`, `` ` ``, `#`, `.`)
- Erlang: Skip `of`/`after`/`else` inside brackets when collecting intermediates
- Erlang: Recognize a block-closing `end` before a comma and map arrow
- Fortran: Reject crossed compound-end pairs in `matchBlocks`
- Fortran: Skip keywords split across continuation lines (`en&` then `d do`)
- Julia: Support the `try`/`catch`/`else`/`finally` `else` clause as a `try` intermediate (Julia 1.8+)
- Julia: Treat `end` after an unclosed indexing bracket as `lastindex`
- Julia: Recognize more operators before `end` so it is not a block close
- Lua: Classify `do` keywords in a single O(N) pass to avoid a hang on loop-heavy files
- Lua: Attach intermediates to the enclosing `if` past an open `repeat` block
- MATLAB: Cache logical-line boundaries to avoid O(N^2) scanning of many keywords on one line
- MATLAB: Reject a block opener followed by a binary operator
- MATLAB: Reject `end` followed by a compound assignment
- MATLAB: Reject a block_middle keyword after a binary operator or `@` handle
- Octave: Treat a line comment after `do` as the end of the statement
- Octave: Reject `do` followed by field access as a block opener
- Octave: Reject `do` followed by a transpose quote as a block opener
- Octave: Reject out-of-order and duplicate `else`/`elseif`/`catch` intermediates
- Pascal: Detect `type`-section declarations after a `begin`/`end` block
- Pascal: Reject a bare `<` comparison as a generic-constraint bracket before `record`
- Pascal: Replace the quadratic record scan with a single-pass context map
- Pascal: Require a field-list body for variant-case detection
- Ruby: Detect endless method definitions without a space before `=` (`def a=1`)
- Ruby: Treat `do` after `then` or inside parentheses as an iterator block in loops
- Ruby: Skip `end` in a ternary value position from being a block close
- Verilog: Skip block keywords only inside closed brace expressions
- Verilog: Treat a keyword after a case-item label as a real block opener
- Verilog: Reject the `case` keyword used as an identifier in an assignment
- Verilog: Treat an unclosed `(` as not enclosing the `interface` keyword
- VHDL: Equalize nest levels of blocks in sibling generate branches
- VHDL: Recognize compound end keywords split by block comments
- VHDL: Fall back to simple-end pairing for an orphan `end generate`
- VHDL: Skip `is` in invalid bare-identifier statements

## [1.1.46] - 2026-05-16

### Fixed

- Ada: Prevent compound end lookahead from consuming the next block opener as a designator (`end\nloop`)
- Ada: Avoid crossed pairs when compound end has a pending compound close above on the stack
- Ada: Skip `exit when` as intermediate inside `accept` and extended-return bodies
- Ada: Accept operator-symbol designator after compound end (`end function "+"`)
- AppleScript: Skip block comments and `¬` continuations in handler name lookup (`on (* doc *) transaction()`)
- AppleScript: Reject `else`/`else if` as `block_middle` when not at logical line start
- AppleScript: Reject reserved words (`if`, `tell`, `repeat`, etc.) as bare handler names after `on`/`to`
- Bash: Recognize command-starter prefixes (`!`, `then`, `do`, `else`, `coproc`) before `time` for `if`/`while`/`for` detection
- Bash: Skip reserved keywords (`for`, `if`, `case`, `while`, `until`, `select`) used as function names
- Bash: Skip incompatible intermediate keywords (`then`/`else`/`elif`/`do`) inside non-matching blocks
- COBOL: Avoid O(n^3) blowup for large `COPY REPLACING` blocks via cached period positions and pseudo-text contexts
- COBOL: Detect `COPY` across newlines and sequence-area prefixes so copybook filenames are not tokenized as block keywords
- COBOL: Recognize `ELSE`/`WHEN` after closing parenthesis (`IF (X > 0)\nELSE`) as intermediate
- COBOL: Treat `WHEN`/`ELSE` as data names in multi-operand `USING`/`MOVE`/`GIVING` lists
- Crystal: Skip `%=` compound assignment and `%%` operator inside macro template body so `{% ... %}` and `{{ ... }}` terminate correctly
- Crystal: Recognize keyword method names across backslash continuation after `def` (`def \<NL>NAME`)
- Crystal: Allow combining marks (`\p{M}`) in heredoc identifier continuation for NFD-form identifiers
- Elixir: Recognize 3+ character operator atoms (`:===`, `:!==`, `:&&&`, `:|||`, `:<<<`, `:>>>`)
- Elixir: Validate sigil heredoc terminator with line-end check after modifiers (`~s"""\n"""1`)
- Elixir: Reject `fn(...)` followed by `do` as block opener while preserving valid `fn(x) -> body end`
- Erlang: Track binary syntax `<<` `>>` in type-context detection so `fun(...)` inside record `::` types is not paired with `end`
- Erlang: Precompute attribute spans for O(log n) tokenize lookups (~12x speedup at 2000 functions)
- Erlang: Reject Unicode-suffixed spec attributes like `-typeα` as user attributes
- Erlang: Reject duplicate `of`/`after`/`else` intermediates in `case`/`receive`/`maybe` blocks
- Erlang: Skip multi-char comparison operators (`=:=`, `=/=`, `==`, `=<`, `>=`, `/=`) in type-context backward scan
- Fortran: Skip concatenated compound-end keywords (`endif`, `endprogram`, `enddo`) used as construct labels and names
- Fortran: Reject bare `if then` without parenthesized condition
- Fortran: Recognize multi-space and continuation forms of `block data` (`block  data`, `block&\n data`)
- Fortran: Skip blank lines in continuation line scan so paren context survives `&\n\n  end)`
- Fortran: Reject `submodule ()` and `change team ()` with empty parens
- Fortran: Require `bind(c)` attribute for `enum` block opener
- Fortran: Restrict `class is`/`type is`/`class default` guards to `select type` blocks
- Julia: Recognize `:end` symbol literal after Unicode operators (`a × :end`)
- Julia: Stop subtype-operator scan at newline so `where T <:` on a previous line does not poison `end`
- Julia: Reject `end` as `block_close` after binary or transpose operators (`A'end`, `A+end`)
- Julia: Drop intermediate keywords (`catch`/`finally`/`else`/`elseif`) with mismatched opener context
- Lua: Treat excluded regions as opaque walls in `isAfterGoto` and `isPrecededByDotOrColon` walk-back
- MATLAB: Drop section keyword token outside `classdef` instead of consuming `end` (`function f\n  properties(obj)\nend`)
- MATLAB: Precompute bracket depth to avoid quadratic blowup with many orphan `end` tokens (~390x speedup at 100k tokens)
- Octave: Skip line comments between `do` and `(` in function-call detection
- Octave: Reject `end(idx) = value` indexing assignment as `block_close`
- Octave: Reject `do` followed by colon as block opener
- Octave: Treat Unicode whitespace (NBSP, U+2000-200A, etc.) between `do` and `(` as function-call separator
- Pascal: Skip `class` type detection in statement context after `try`/`begin`/`on`/`repeat`
- Pascal: Skip `block_middle` keywords with hex (`$`) or char-constant (`#`) prefix
- Pascal: Reject `else` after `finally` in `try` block (Delphi allows `try-except-else` only)
- Ruby: Extend control/meta char literal (`?\C-\X`, `?\M-\X`, `?\M-\C-\X`) to include escape-sequence target (`?\C-\n`)
- Ruby: Recognize regex after `p`, `pp`, `warn`, `fail`, and `abort` (`p /if end/`)
- Ruby: Skip `end` keyword after range operator (`..`/`...`) so `for x in (1..end)` pairs with the trailing `end`
- Verilog: Skip `default` keyword inside brace expressions (`{default: 1}`)
- Verilog: Skip reserved keywords (`endmodule`, `endfunction`, etc.) used as identifiers after declaration introducers (`localparam`, `parameter`, `genvar`)
- Verilog: Skip line comments when detecting label-colon adjacency for control keywords
- VHDL: Walk back through arbitrary tokens (signal names, commas) in `wait`-`while` detection (`wait on sig while running;`)
- VHDL: Skip extended_identifier package name only once in `package \X\ is new Y` instantiation check
- VHDL: Skip newlines and comments in component instantiation label check (`inst :\n-- comment\ncomponent foo`)
- VHDL: Adjust begin/end body nestLevel for elsif/else-generate sibling chains
- VHDL: Skip trailing type word of rejected compound end (`inst.end if;`) in tokenization
- VHDL: Skip comments and newlines in dot check across `isValidBlockOpen`/`Close`/`Loop`/`isWaitBeforeFor`
- VHDL: Fall through to LIFO for simple `end;` inside generate without `begin`

### Refactor

- COBOL/MATLAB: Remove unreachable fallback paths (`findLastPeriodOutsideStrings`, `isInsideParensOrBracketsSlow`, `hasMatchingCloseAhead`)

## [1.1.45] - 2026-05-10

### Fixed

- Ada: Recognize Unicode whitespace (NBSP, VT, FF, U+0085, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000) in `or else`/`and then` short-circuit detection
- Ada: Avoid forced fallback to last opener for unmatched compound end (`end loop`/`end procedure` etc.) - leave them unpaired per anchor-set principle
- Ada: Collapse malformed `Test_and then`/`1and then` short-circuit to a single `then` intermediate
- AppleScript: Skip `block_middle` keywords (`else`, `else if`, `on error`) inside multi-line record literals via brace-depth-aware `isAtRecordKeyPosition`
- AppleScript: Skip `block_close` keywords (`end if`, `end tell`, etc.) inside multi-line record literals to prevent early closure of enclosing blocks
- AppleScript: Accept pipe identifiers (`|my handler|`) and Unicode whitespace, `¬\<NL>` continuation, and block comments in handler declaration probe
- Bash: Accept `!`, `*`, `?` as heredoc terminator characters (`<<!`, `<<*`, `<<?`)
- Bash: Recognize escaped backslash (`<<\\EOF`) in heredoc delimiter
- Bash: Support line continuation (`<<\<NL>EOF`) in heredoc delimiter
- Bash: Handle chained equals in env var prefix (`A=B=C cmd`) for command-position detection
- Bash: Skip brace expansion when scanning env var prefix (`var={a,b,c} cmd`)
- COBOL: Skip reserved-word filenames in `COPY` statement as `block_open` (e.g., `COPY IF.` no longer pairs with subsequent `END-IF`)
- COBOL: Skip excluded regions (`*>` inline comments, `>>` directives) in expression-context backward scan when filtering ELSE/WHEN
- Crystal: Recognize `class_property`, `class_getter`, `class_setter` macros in `isAfterPropertyMacro`
- Crystal: Skip keywords as comma-separated property names (`property foo, end`)
- Crystal: Disable escape handling when backslash is percent-literal delimiter in macro templates
- Crystal: Skip backtick literals inside macro string interpolation depth tracking
- Crystal: Skip line comments inside macro string interpolation depth tracking
- Crystal: Skip backslash line continuations in property macro detection
- Crystal: Recognize quoted heredoc identifiers with Unicode characters (`<<-"αβγ"`)
- Crystal: Handle orphan closing quote in failed heredoc opener across multiple lines
- Elixir: Skip chained `do/end` value heuristic for definition keywords (`def`/`defp`/`defmacro`/`defguard`/`defmodule`) so they no longer become `block_open` when followed by another `def foo do/end` pattern
- Erlang: Skip stray braces in `-define` body forward scan when looking for closing `)`
- Fortran: Validate continuation-form compound end with full match length (not normalized keyword length) so `end &\n if = 5` is correctly rejected as block_close
- Fortran: Tokenize `case default` and `rank default` as compound intermediates
- Fortran: Reject `change team` without parenthesized team-value
- Fortran: Reject `where` and `forall` with empty parens
- Fortran: Reject `select case`, `rank`, and `type` with empty parens
- Julia: Treat string/char/symbol/command literals as value expressions before generator `for` (e.g., `g("x" for i in 1:10)` is now correctly recognized as generator)
- Julia: Recognize BMP-outside Unicode characters (surrogate pairs) as string macro prefix
- Julia: Skip `end` as `block_close` after `<:` and `>:` subtype operators
- Lua: Skip `goto`-target keywords (`goto for`/`goto while`) in `isDoPartOfLoop` outer scan
- Lua: Cache for/while positions to avoid super-quadratic `isDoPartOfLoop` performance
- Lua: Validate trailing-dot numeric prefix to reject invalid identifiers like `1A.end`
- Lua: Extend trailing-dot walk through `.` to reject numbers with double decimal (`1.5e2.end`)
- MATLAB: Skip `block_open` keywords used as command-syntax arguments (`clear if`, `disp for`)
- MATLAB: Skip `block_open` keywords preceded by binary operators (`x == for`, `x = parfor + 1`)
- MATLAB: Skip `block_middle` keywords used as RHS identifiers (`y = case;`)
- MATLAB: Treat function handles with whitespace after `@` as exclusion (`@ for`)
- MATLAB: Walk past block keywords in multi-arg command-syntax detection (`disp end case`)
- Octave: Inherit phantom section end skip logic in `matchBlocks` (classdef with stray `properties = 5; end`)
- Octave: Phantom-skip stray `end` after rejected `arguments(obj)` call
- Octave: Reject `do` as command-syntax argument (`disp do; do ... until ...`)
- Octave: Allow VT and FF as whitespace around block comment delimiters (MATLAB-symmetric)
- Octave: Reject duplicate `unwind_protect_cleanup` in same `unwind_protect` block
- Pascal: Skip `until` used as case label inside `repeat` block
- Pascal: Skip `end` used as case label inside `case-of` block
- Pascal: Skip `object`, `interface`, and `class` in case label after `=` (`Z = object: ...`)
- Pascal: Reject duplicate and mutually exclusive `try` intermediates (`finally`+`finally`, `finally`+`except`)
- Ruby: Verify heredoc via `matchHeredoc` when filtering keywords after `<<` (no longer drops `if`/`end` after `1<<if cond`)
- Ruby: Treat pattern-match `in` as intermediate only inside `case` (Ruby 3.0+ `if x in 1` no longer adds `in` to if intermediates)
- Verilog: Skip packed dimensions (`[N:M]`) and block comments before data type identifier filter
- Verilog: Reject control keywords (`wait`, `if`, `for`, etc.) used as label names (`wait : begin`)
- Verilog: Limit unterminated `pragma protect begin` to single line excluded region (preserves downstream code parsing)
- Verilog: Suppress block keywords inside generic brace expressions (`{begin: 1}`)
- VHDL: Skip `is` in `attribute_specification` with entity_class on separate line
- VHDL: Allow newlines between `null` and semicolon in null procedure declaration

## [1.1.44] - 2026-05-09

### Fixed

- Ada: Set a `crossedExcludedRegion` flag in the `isExtendedReturn` backward scan (`adaParser.ts`) so `:= "string" do` and `:= 'c' do` are no longer misclassified as malformed `:= do` empty-expression cases, and extended-return blocks with string/character literal initializers are correctly opened
- AppleScript: Add `isAtRecordKeyPosition` helper to suppress `else`/`else if`/`on error` block_middle detection at record-key positions (`{else: 5}`, `{on error: 5}`) in `applescriptParser.ts` so they no longer add spurious intermediates to enclosing `if`/`try` blocks
- AppleScript: Replace the `[ \t]*` line-leading whitespace regex with `LINE_LEADING_WHITESPACE_PATTERN` covering NBSP (U+00A0), zero-width/en/em/hair spaces (U+2000-U+200B), line/paragraph separators (U+2028/U+2029), narrow no-break space (U+202F), medium math space (U+205F), and ideographic space (U+3000) in `isAtPhysicalLineStart`/`isAtLogicalLineStart` (`applescriptParser.ts`) so close keywords with Unicode-whitespace indentation are detected
- AppleScript: Add `isOnContinuationLine` helper to detect when the previous physical line ends with `¬` and suppress close keywords on continuation lines (`applescriptParser.ts`) so `set x to 5 ¬\nend tell` no longer incorrectly closes the outer block
- AppleScript: Extend the compound block_open paren-rejection check at line 386-392 to also cover block_middle in `tryMatchCompoundKeywordToken` (`applescriptParser.ts`) so `on error()` is rejected as a function-call form rather than added as a try-block intermediate
- Bash: Use `skipWhitespaceAndContinuationBackwardLocal` when initializing `j` in the `{` brace-block detection in `tokenize` (`bashParser.ts`) so `function f \\<NL>{ echo; }` recognizes the line-continued brace as a function body
- Bash: Add an `isInsideDoubleBracket` guard at the top of the `{`/`}` token-injection loop in `tokenize` (`bashParser.ts`) so raw `{`/`}` inside `[[ ... ]]` are not generated as block tokens
- Bash: Extend `isFollowedByHyphen` to also cover `#`, `.`, `:`, `~`, `,`, `@`, `%`, `^`, `!`, and `/` (`bashParser.ts`) so identifiers like `done#tag`, `fi.suffix`, `fi:`, `done@x` are no longer split as block-close keywords followed by attached suffixes
- Bash: Add a dedicated branch for anonymous `coproc {` (no NAME) in the `{` function-definition fallback in `tokenize` (`bashParser.ts`) so `time coproc { echo; }` recognizes the brace as a coprocess body
- Bash: Add a `terminator !== ''` guard to the subshell-`)` shortcut in `matchHeredocBody` (`bashLeafHelpers.ts`) so empty-delimiter heredocs (`<<""`/`<<''`) require a blank line for termination and do not falsely match any line starting with `)` inside `$(...)` subshells
- COBOL: Pass `excludedRegions` and call `skipBackwardWhitespaceAndComments` from `isPrecedingWordDataNameVerb` (`cobolParser.ts`, `cobolHelpers.ts`) so multi-line `MOVE` statements with intervening `*>` inline comments, fixed-format `*` comment lines, or `>>` directive lines correctly recognize `ELSE`/`WHEN` as data-name references rather than block intermediates
- Crystal: Detect `<<-`/`<<~` heredocs inside `{% %}` and `{{ }}` macro template scan loops and skip the entire heredoc region via `matchHeredoc` in `matchMacroTemplate` (`crystalExcluded.ts`) so `%}` and `end` inside heredoc bodies no longer prematurely terminate the macro template
- Crystal: Add `\p{L}` to the heredoc identifier regex in `matchHeredoc` and add the `u` flag (`crystalExcluded.ts`) so `<<-Naïve` and other non-ASCII identifiers no longer partial-match `Na` and falsely consume the rest of the source as heredoc body
- Crystal: Add `isAfterPropertyMacro` helper to suppress `end`/`begin` detection when used as macro parameter names following `property`/`getter`/`setter`/`record` (`crystalParser.ts`) so `property end : Int32 = 0` no longer pairs `class` with the property-name `end`
- Elixir: Switch `getSigilCloseDelimiter` to a whitelist of `/`, `|`, `"`, `'` plus paired `()`/`[]`/`{}`/`<>` via new `SIGIL_NONPAIRED_DELIMITERS` constant (`elixirHelpers.ts`) so invalid delimiters like `_`, `$`, `@`, `^`, `~`, `!` are rejected and do not extend sigil regions past the intended boundary
- Elixir: Remove `fn` and `quote` from `DEFINITION_KEYWORDS` (`elixirParser.ts`) so `1..fn -> 1 end` and `1..quote do :a end` correctly pair the value-expression as the right-hand side of the range operator
- Elixir: Track `fnDepth` in `hasCommaInParens` (`elixirParser.ts`) so commas inside `fn x, y -> body end` parameter lists no longer falsely classify `if(...)`/`unless(...)` as function-call forms and miss their `if`/`end` pairs
- Elixir: Add `when`, `in`, `and`, `or`, `not` to `SIGIL_MODIFIER_RESERVED_WORDS` (`elixirHelpers.ts`) so `~r/pat/when y == 1` no longer absorbs `when` as a sigil modifier and leaves the guard expression intact
- Elixir: Clamp paren/bracket/brace depths to non-negative in `hasDoKeyword` and `isDoColonOneLiner` (`elixirParser.ts`) so unbalanced closing brackets like `if x) do ... end` still detect the `do` and pair the `if`/`end` block
- Elixir: Add `matchOperatorAtom` helper recognizing operator atoms (`:+`, `:-`, `:*`, `:/`, `:<`, `:>`, `:=`, `:!`, `:?`, `:~`, `:^`, `:&`, `:|`, `:==`, `:!=`, `:<=`, `:>=`, `:=~`, `:->`, `:<-`, `:<>`) as excluded regions in `tryMatchExcludedRegion` (`elixirHelpers.ts`, `elixirParser.ts`) so they are no longer misinterpreted as block keywords
- Erlang: Add a `!insideNestedCall` check to the `-record` branch of `isInsideModuleAttributeArgs` (`erlangParser.ts`) so block keywords inside nested function calls in record default values (e.g., `-record(s, {h = nested(begin)})`) are filtered consistently with the `-define` branch
- Erlang: Add `isBareKeywordInDefineBody` helper to detect single-keyword `-define` macro bodies and filter them in `isInsideModuleAttributeArgs` (`erlangParser.ts`) so `-define(M, begin).` no longer leaks `begin` as a block opener that pairs with subsequent unrelated `end` tokens
- Erlang: Add macro-arity form `\?<identifier>` to `arityPattern` (`erlangParser.ts`) so `fun foo/?ARITY` and `fun M:F/?ARITY` are recognized as fun references and `fun` is not tokenized as a block opener
- Fortran: Add `'end'` to `FORTRAN_STATEMENT_KEYWORDS` (`fortranValidation.ts`) so `x = end do / 2` and `x = end function` no longer generate phantom `do`/`function` block_open tokens that orphan the outer block
- Fortran: Add `block data` (with whitespace) and `blockdata` (concatenated form) to `keywords.blockOpen` and `COMPOUND_END_TYPES` (`fortranParser.ts`), with new `normalizeFortranEndType` helper canonicalizing them to `block data` for matching, so Fortran 77/90 `BLOCK DATA` program units pair correctly with `END BLOCK DATA` or `ENDBLOCKDATA`
- Fortran: Add `SELECT_TYPE_GUARD_PATTERN` and inject `type is`, `class is`, `class default` as block_middle tokens in `tokenize` (`fortranParser.ts`) so they are correctly registered as `select type` intermediates and rendered with the same nest level as the construct body
- Julia: Extend `matchPrefixedString` prefix recognition to include Unicode letters (`\p{L}`) and exclude digits from `prevChar` rejection (`juliaParser.ts`) so `αr"text"end` and `1r"text"end` correctly identify the entire string macro region including suffix flags
- Julia: Add `isCommandMacroPrefixChar` helper accepting ASCII word chars or Unicode letters in `matchTripleBacktickCommand`, `matchCommandString` (`juliaParser.ts`), and `skipBacktickString` (`juliaHelpers.ts`) so `α\`cmd\`end` and `α\`\`\`cmd\`\`\`end` correctly identify the entire command macro region
- Julia: Call `isPrecededByValueExpression` from the named-tuple context branch of `isInsideParentheses` (`juliaParser.ts`) so `(a = b for c in 1:3)` is recognized as a generator expression while `(name = for ... end)` is still treated as block-form `for`
- Lua: Add `isAdjacentToUnicodeLetter(source, i - 3, 4)` check to `isAfterGoto` (`luaParser.ts`) so identifiers like `αgoto` are recognized as a single identifier and the following `do`/`end` are not misinterpreted as goto-target labels that disappear from the token stream
- MATLAB: Add `!` to the binary-operator characters in `isPrecededByBinaryOperator` (`matlabParser.ts`) so `!end` (logical NOT operand) no longer treats `end` as a block-close token
- MATLAB: Add `\u{FEFF}` (BOM) to the whitespace skip in `isCommandSyntaxArgument` (`matlabParser.ts`) so `﻿disp end` at file start correctly classifies `end` as a command-syntax argument
- MATLAB: Skip whitespace before checking for `.` in `isValidBlockClose` (`matlabParser.ts`) so `end .field` (struct field access with intervening whitespace) is no longer misclassified as a block-close keyword
- MATLAB: Add `phantomSectionPositions` field and `isAtLineStartForSectionKeyword` helper to track classdef section keywords rejected by tokenize, then skip extra `end` tokens in `matchBlocks` (`matlabParser.ts`) so `properties # access` (rejected as MATLAB syntax error) no longer causes the outer `classdef` to pair with an inner `end`
- MATLAB: Add `isKeywordUsedAsFunctionCall` check to the block_middle filter in `tokenize` (`matlabParser.ts`) so `case(value)` (function-call form) no longer adds a spurious intermediate inside `switch` blocks
- MATLAB: Add `isCommandSyntaxArgument` check to the block_middle filter in `tokenize` (`matlabParser.ts`) so `clear case`, `clear else`, etc. no longer add spurious intermediates inside enclosing blocks
- MATLAB: Reimplement `isCommandSyntaxArgument` to accept `excludedRegions` and traverse `...`/`\` line continuations backward via region.start/region.end (`matlabParser.ts`) so `disp ...\n  end` and `disp \\\n  end` correctly classify `end` as a command-syntax argument across continuation lines and multi-argument forms (`clear all end`)
- MATLAB: Replace the static `ALL_BLOCK_KEYWORDS` constant with `MATLAB_BLOCK_KEYWORDS` plus an instance method `getAllBlockKeywords()` (`matlabParser.ts`) so subclasses can override the keyword set; MATLAB no longer treats `do`/`until`/`endfunction` as block keywords, allowing `do end` to be correctly classified as command-syntax
- Octave: Add `isPrecededByAtSign` check to `isValidBlockClose` (`matlabParser.ts`) so `@end` (function handle prefix) is rejected as a block close in both MATLAB and Octave
- Octave: Define `OCTAVE_BLOCK_KEYWORDS` and override `getAllBlockKeywords()` in `octaveParser.ts` to retain Octave-specific keywords (`do`, `until`, `endfunction`, etc.) that were removed from the base MATLAB set
- Pascal: Remove the early `return false` on `;` from the backward scan loop in `isInsideGenericConstraint` (`pascalParser.ts`) so generic-parameter separators like `<T1; T2: record>` no longer cause `record` to be falsely classified as a block opener inside class bodies
- Ruby: Add `]` (array literal close) and `}` (hash/block close) to the line-continuation-prefix check in `findLogicalLineStart` (`rubyValidation.ts`) so `for x in [\n...\n] do` correctly traverses the multi-line array literal back to the `for` keyword and pairs `for/end` instead of `do/end`
- Verilog: Stop the inner string-scan loop in `matchMacroArgList` and return early when a bare newline is encountered (`verilogHelpers.ts`) so a macro argument list with newlines inside string literals no longer extends the excluded region to the end of source by re-entering string mode at the next `"`
- Verilog: Recognize `begin_protected`/`end_protected` (alongside `begin`/`end`) in `isPragmaProtectBegin`/`isPragmaProtectEnd` (`verilogHelpers.ts`) so `\`pragma protect begin_protected ... \`pragma protect end_protected` correctly excludes the EDA-tool-emitted protected IP region
- Verilog: Add `isValidWaitOpen` helper that rejects `wait fork ;` from being treated as a block opener in `isValidBlockOpen` (`verilogParser.ts`, `verilogValidation.ts`) so `wait fork;` synchronization statements no longer cause the surrounding `begin`/`end` block to be consumed via control-keyword chain
- Verilog: Replace direct `::` checks in block_open and block_middle (default) tokenize filters with `isPrecededByScopeResolution` (`verilogParser.ts`) so whitespace-separated scope resolution like `pkg :: begin` and `pkg :: default` is rejected symmetrically with the existing block_close behavior
- Verilog: Simplify the `isInsideAssignmentPattern` filter in `tokenize` to return false unconditionally regardless of trailing `:` (`verilogParser.ts`) so block keywords used as field names in `'{begin, end}` are filtered even without a colon
- Verilog: Skip excluded regions (block comments) in the `directiveArgRanges` construction in `tokenize` (`verilogParser.ts`) so `\`ifdef /* comment */ NAME` correctly identifies `NAME` as the macro argument and prevents reserved-word names from being tokenized as block keywords
- VHDL: Add `findTrailingLabelPositions` method called from `tokenize` to identify reserved-word labels following `end <type>;` (`vhdlParser.ts`) and skip their tokenization so `end generate loop;`, `end process if;`, `end if for;`, etc. no longer create phantom block_open tokens that prevent the enclosing `architecture`/`package` from closing

## [1.1.43] - 2026-05-09

### Fixed

- Base: Recognize `\p{M}` (Mark), `\p{N}` (Number), and `\p{Pc}` (Connector Punctuation) characters as identifier continuation in `isAdjacentToUnicodeLetter` (`baseParser.ts`) so keywords adjacent to combining marks (Mn), Letter Numbers (Nl), or non-ASCII decimal numbers (Nd) are filtered as part of the identifier
- Ada: Replace ASCII-only `/^[a-zA-Z_]\w*/` with a Unicode-aware character loop in `isExtendedReturn` (`adaParser.ts`) so extended-return blocks declaring objects with non-ASCII identifiers (e.g., `return Ñame : Integer do ... end return`) are recognized
- Ada: Add lookahead in the `tokenize` compound-end loop to require `;` (or designator-then-`;`) after the type keyword in `COMPOUND_END_PATTERN` matches (`adaParser.ts`) so `end\nif Cond then ...` no longer greedily consumes the following independent `if` block
- AppleScript: Skip whitespace before checking for `(` in `isValidBlockOpen` for single-word block openers `tell`/`repeat`/`try`/`considering`/`ignoring` (`applescriptParser.ts`) so `try ()`, `repeat ()`, etc. are rejected as function-call forms — symmetric with the compound-keyword `(` rejection at line 380-385
- AppleScript: Replace direct-match-then-fallback in `matchBlocks` with a single reverse stack scan that treats handler-name fallback as same-level matching (`applescriptParser.ts`) so nested `tell ... on tell() ... end tell ... end tell` no longer cross-pairs and LIFO ordering is preserved
- AppleScript: Compare only the last word of compound `expectedOpener` (e.g., `with transaction` → `transaction`) against the handler name in the fallback path (`applescriptParser.ts`) so `on transaction()`/`end transaction` and `on timeout()`/`end timeout` pair via handler-name fallback
- Bash: Recognize `esac` directly after `in` (with no patterns) as a `case` close in `scanSubshellBody` via new `isPrecededByInKeyword` helper (`bashStringHelpers.ts`) so `$(case x in esac)` and `<(case x in esac)` close their subshell instead of treating the entire source as unterminated
- Bash: Move the `|` (alternative-pattern) check ahead of the `esac` early return in `isCasePattern` (`bashValidation.ts`) so `case x in foo|esac) ...;; esac` recognizes `esac` as a pattern alternative rather than a block close
- Bash: Skip backslash-newline line continuations when backscanning past `-p`/`--` flags to find `time` in `isAtCommandPosition` via new `skipWhitespaceAndContinuationBackward` helper (`bashValidation.ts`) so `time \\<NL> -p if true; then ...; fi` correctly puts `if` in command position
- Bash: Skip backslash-newline line continuations when scanning for the `function`/`coproc` keyword before `{` in `tokenize` (`bashParser.ts`) so `function \\<NL> name { ... }` recognizes the brace-block as a function body
- COBOL: Treat `ELSE`/`WHEN` as data-name references when preceded by an arithmetic operator (`+`, `-`, `*`, `/`), `=`, `<`, `>`, comma, semicolon, or paren via new `isInExpressionContext` helper (`cobolParser.ts`) so `IF X\n  COMPUTE Y = X + ELSE\nEND-IF` and `CALL "PROC" USING A, ELSE` no longer add spurious `ELSE` intermediates
- Crystal: Process `\X` as an escape (skipping 2 characters) in the invalid-heredoc-opener fallback scan loop in `findExcludedRegions` (`crystalParser.ts`) so `<<-"a\\"b"` correctly absorbs the escaped quote and the trailing standalone `"` does not consume subsequent code as a string literal
- Elixir: Add `isLineEndAfterTerminator` check in `matchTripleQuotedString` and `skipNestedTripleQuotedString` (`elixirHelpers.ts`) requiring the character after `"""` to be a non-identifier character so `"""def foo` is no longer accepted as a heredoc terminator
- Elixir: Stop sigil-modifier consumption at reserved-word boundaries (`end`, `def`, `do`, `defmodule`, etc.) via new `SIGIL_MODIFIER_RESERVED_WORDS` constant and `skipSigilModifiers` helper (`elixirHelpers.ts`) so `~s"""..."""end` no longer absorbs `end` as a sigil modifier
- Elixir: Detect chained `<this_kw> <next_kw> <rest>...` patterns recursively in `isKeywordUsedAsValue` (`elixirParser.ts`) so `if for case do :ok end` correctly pairs `if` with `end` rather than treating `for` as the block opener
- Elixir: Reject middle keywords (`else`, `rescue`, `catch`, `after`) followed by whitespace and `=>` in `tokenize` (`elixirParser.ts`) so map keys like `%{else => 1}` no longer add false intermediates to enclosing blocks
- Erlang: Reject `begin`, `case`, `if`, `receive`, `try`, `maybe` in `-spec`/`-type`/`-callback`/`-opaque` declaration bodies in `isValidBlockOpen` via extracted `isOnSpecAttributeLine`/`isInSpecContext`/`hasDeclarationEndingPeriod` helpers (`erlangParser.ts`) so phantom block pairs in spec context are eliminated
- Erlang: Use `codePointAt` and detect surrogate pairs in the basic-escape branch of `matchCharacterLiteral` (`erlangParser.ts`) so `$\\😀` (BMP-outside character with backslash escape) consumes 4 code units instead of leaving the low surrogate dangling
- Fortran: Combine same-line and continuation-line checks in `team` validation (`fortranParser.ts`) by pairing direct match with `isPrecedingContinuationKeyword(source, position, 'change')` so `change &\n team (t)` is recognized as a Fortran 2018 `change team` block opener
- Fortran: Add `'to'`, `'cycle'`, `'exit'` to `FORTRAN_STATEMENT_KEYWORDS` (`fortranValidation.ts`) so `assign N to end`, `go to end`, `cycle end`, `exit end` (label/construct-name uses) treat `end` as an identifier rather than a block close
- Fortran: Validate compound `end <type>` tokens against `isValidFortranBlockClose` after `mergeCompoundEndTokens` and skip the underlying bare `end` for rejected positions in `tokenize` (`fortranParser.ts`) so `end if = 5`, `end if(1) = 5`, `end if // "x"`, `end if%comp` are treated as variable accesses rather than block closes
- Fortran: Add `isThenAfterParen` helper requiring `)` (with whitespace/`&`-continuation/comment-line skipping) before `then` in `tokenize` (`fortranValidation.ts`, `fortranParser.ts`) so a bare standalone `then` (no preceding `if (...)`) is no longer registered as a `block_middle` token
- Julia: Treat all unmatched `begin` openers in indexing brackets as filtered firstindex (consistent with the parser's filter-only-not-pair design) via new `allUnmatchedOpenersAreFilteredBegins`/`allUnmatchedOpenersAreFilteredBeginsInsideIndexing`/`hasUnmatchedBlockOpenerBetweenInIndexing` helpers in `isInsideIndexingBrackets` (`juliaParser.ts`) so `a[(begin x end)]` and `a[begin x end]` recognize the inner `end` as lastindex rather than a block close
- Julia: Recognize `end<binary-op>` (e.g., `end!=`, `end==`, `end+`, `end-`, `end*`, `end/`, `end%`, `end^`) inside any indexing bracket as lastindex via new `isFollowedByBinaryOperator`/`isInsideAnyIndexingBracket`/`isBinaryOperatorStart` helpers in `isValidBlockClose` (`juliaParser.ts`) so `arr[if end!=2 1 else 0 end]` no longer mispairs `if` with the inner `end`
- Julia: Stricten the `prevChar` check in `matchPrefixedString` from `charCode > 127` to `/[\p{L}\p{N}]/u` (`juliaParser.ts`) so non-identifier Unicode operators like `× U+00D7` no longer prevent `r"..."` from being recognized as a prefixed string macro and the suffix from being consumed
- Julia: Reject `end` inside array-construction `[...]` (no indexing context) when there is no enclosing block opener via new `isLoneEndInArrayConstruction`/`hasAnyBlockOpenerBetween` helpers in `isValidBlockClose` (`juliaParser.ts`) so `function f()\n  return [end]\nend` no longer mispairs `function` with the inner `end`
- Lua: Add `isAfterGoto` to the filter chain inside the `isDoPartOfLoop` forward scan loop (`luaParser.ts`) so `for goto end do x = 1 end` is correctly paired as `for...end` instead of treating the standalone `do` as a top-level block
- MATLAB: Treat `==`, `<=`, `>=`, `!=`, `~=` as binary comparison operators in the `=`-prefixed branch of `isPrecededByBinaryOperator` (`matlabParser.ts`) so `x = a >= end`, `x = a <= end`, etc. recognize `end` as an expression operand and do not steal an outer `function` block's close
- MATLAB: Add `excludedRegions` parameter to `isPrecededByBinaryOperator` and skip `...` line-continuation regions when backscanning (`matlabParser.ts`) so `x = a + ...\n  end` and similar continuations are recognized as expression context
- MATLAB: Reject `end` followed by `.` (and not `..`) in `isValidBlockClose` (`matlabParser.ts`) so `end.x = 1` is treated as struct field access rather than a block close
- MATLAB: Reject `end` after a command-syntax invocation (`<identifier> <whitespace> end` where the identifier is at statement start and not a known keyword) via new `isCommandSyntaxArgument` helper and `ALL_BLOCK_KEYWORDS` constant in `isValidBlockClose` (`matlabParser.ts`) so `disp end` no longer steals an enclosing function's close
- MATLAB: Treat vertical tab (`\v`) and form feed (`\f`) as whitespace in `isBlockCommentStart` and the `%}` trailing-content check in `matchBlockComment` (`matlabParser.ts`) so `%{\v` and `%{\f` are recognized as block-comment starts
- Octave: Pass `excludedRegions` to `isAtStatementLeadingPosition` and check whether `...`/`\\` sits inside a comment region in `isValidBlockClose` (`octaveParser.ts`) so `# comment ...\n endif` and `# comment \\\n until cond` correctly tokenize the typed-close
- Octave: Reject `do` followed by `[` or `{` in `isValidBlockOpen` (`octaveParser.ts`) so `do[1]` and `do{1}` (do as variable name with array/cell indexing) are not treated as do-until block openers
- Octave: Skip `...` (`LINE_CONTINUATION_PATTERN`) and backslash (`BACKSLASH_CONTINUATION_PATTERN`) line continuations between `do` and `(` in `isValidBlockOpen` (`octaveParser.ts`) so `do ...\n(args)` is rejected as a function-call form like `do(args)`
- Octave: Treat vertical tab (`\v`) and form feed (`\f`) as whitespace in `isValidBlockClose` and `isAtStatementLeadingPosition` (`octaveParser.ts`) so `\v`/`\f` indented `endif`/`endfor`/`until` etc. are recognized as block closes
- Octave: Reject `arguments(obj);` and `arguments(...)` containing non-attribute keywords in `isValidBlockOpen` via new `isArgumentsFunctionCall` helper (`octaveParser.ts`) so function-call invocations like `arguments(obj);` inside a `function` body do not create phantom `arguments` block pairs (MATLAB attribute-list form `arguments (Input)` is preserved)
- Pascal: Add `isInsideGenericConstraint` helper to reject `record` inside unclosed `<` (e.g., `function Bar<T: record>: T;`) in `isValidBlockOpen` (`pascalParser.ts`) so generic-constraint `record` is not treated as a block opener
- Pascal: Add `for`, `in`, `is`, `as`, `div`, `mod`, `shl`, `shr` to `COMPARISON_CONTEXT_KEYWORDS` and detect `:=` (assignment) in the comparison-context backscan (`pascalParser.ts`) so `Y := X = class`, `for I in S = class do`, etc. recognize `=` as a comparison operator rather than a class-type definition
- Pascal: Extend the `&`/`@` prefix rejection to `$` and `#` in `isValidBlockOpen` and `addAsmExcludedRegions` (`pascalParser.ts`) so `$begin`, `#try`, `$asm`, `#asm` (hex-literal/character-constant prefixes) no longer create block openers or asm excluded regions
- Pascal: Add `isUsedAsCaseLabel` helper (preceded by `of`/`;`/`,` and followed by `:` non-`:=`) to `isValidBlockOpen` (`pascalParser.ts`) so `case X of try: ...; end` and similar case-label uses of reserved words are rejected as block openers
- Pascal: Skip `\n` and `\r` in addition to spaces and tabs when scanning back for `.` in `isPrecededByFieldDot` (`pascalParser.ts`) so `Foo.\n end` (newline-spanning field access) treats `end` as a field name rather than a block close
- Ruby: Split the `heredocPattern` regex into double-quoted/single-quoted/backtick/unquoted branches and allow any non-quote characters inside the quoted forms (`rubyExcluded.ts`) so `<<"my id"`, `<<""`, `<<"my-id"`, `<<"my.id"`, etc. (heredocs with non-word identifier characters or empty identifiers) correctly exclude the body
- Verilog: Add `'foreach'` and `'wait'` to `CONTROL_KEYWORDS` and `keywords.blockOpen` (`verilogParser.ts`) so `initial foreach (arr[i]) begin ... end`, `wait (cond) begin ... end`, etc. participate in control-keyword chain consumption like `if`/`for`/`while`
- Verilog: Detect `\`pragma protect begin` directives in `matchPragmaDirective` and extend the excluded region to the matching `\`pragma protect end` line via new `isPragmaProtectBegin`/`findPragmaProtectEnd`/`isPragmaProtectEnd` helpers (`verilogHelpers.ts`) so block keywords inside protected regions are not tokenized (IEEE 1800-2017 §28.10 / §32.3)
- Verilog: Add `'automatic'` to `QUALIFIER_KEYWORDS` (`verilogValidation.ts`) so compound qualifiers like `extern static automatic function` and `extern automatic task` correctly skip the `function`/`task` keyword via `isPrecededByExternThroughQualifiers`
- Verilog: Skip space and tab (but not newlines) between the macro identifier and `(` when matching `\`MACRO (...)` in `tokenize` (`verilogParser.ts`) so `\`MY_MACRO (begin x = 1; end)` excludes the argument list as a single region (IEEE 1800-2017 §22.5.1)
- VHDL: Treat simple `end;` after a `generate` opener as a `generate_statement_body` alternative-label-end in the simple-end branch of `matchBlocks` (`vhdlParser.ts`), creating a synthetic body pair from the latest intermediate `begin` while leaving `generate` on the stack so that an `if`/`for` generate followed by `begin..end;..end generate;` produces the correct pair set (LRM 11.8)
- VHDL: Allow whitespace between a keyword and `'` when checking attribute references in `isValidBlockOpen` (`vhdlParser.ts`) so `process 'foreign;` (space-separated attribute access) is recognized as an attribute reference rather than a block open
- VHDL: Add `isValidRecordOpen` helper requiring a preceding `is` keyword (with whitespace/comment/newline skipping) for `record` to be treated as a block opener (`vhdlParser.ts`) so `:= record;` (record as RHS literal) is rejected as a block open

## [1.1.42] - 2026-05-08

### Fixed

- Ada: Filter `when` from `begin` block intermediates unless an `exception` intermediate is already present in `matchBlocks` (`adaParser.ts`) so `begin\n  exit when X;\nend;` no longer registers `exit when` modifiers as exception-handler intermediates
- Ada: Extend `COMPOUND_END_PATTERN` separator class to include VT (U+000B), FF (U+000C), NEL (U+0085), Ogham space (U+1680), LS (U+2028), and PS (U+2029) per Ada LRM 2.1 format_effector (`adaParser.ts`)
- Ada: Lift the `maxLines = 200` ceiling in `isValidLoopOpen` (`adaValidation.ts`) so a `loop` separated from its `for`/`while` prefix by many comment or continuation lines is still recognized as a loop block opener
- Bash: Stop including the terminator-line newline in heredoc body excluded regions in `matchHeredocBody` (`bashLeafHelpers.ts`) and `matchHeredoc` (`bashStringHelpers.ts`) so a closing `}` on the line after `EOF` (e.g., `{\ncat <<EOF\nbody\nEOF\n}`) is no longer rejected as a predecessor inside an excluded region
- Bash: Accept empty quoted heredoc delimiters (`<<''`, `<<""`) in `parseHeredocOperator` (`bashLeafHelpers.ts`) so blank-line-terminated heredocs are recognized and their bodies excluded
- Bash: Treat `#` immediately after one or more `$` as part of the same word in `isDollarHashVariable` (`bashLeafHelpers.ts`) so `echo $$#tag` no longer truncates the line as a comment — matches real bash where `$$#tag` prints `<PID>#tag`
- COBOL: Reject `PERFORM <para-name> <stray-token>` (no `THRU`/`UNTIL`/`VARYING`/`WITH`/`AFTER`/`BEFORE`/`TIMES` keyword and not a block-opener verb) as a paragraph call in `computeValidPositions` (`cobolParser.ts`) so it no longer pairs with a following `END-PERFORM`
- Crystal: Allow newlines inside `(...)` / `[...]` / `{...}` argument lists in `hasShorthandDefAssignment` (`crystalParser.ts`) so multi-line `def name(\n  args\n) = expr` shorthand methods no longer pair `def` with the enclosing class's `end`
- Crystal: Register the quoted span of a failed heredoc opener (e.g., `<<-"end class"`) as an excluded region in `findExcludedRegions` (`crystalParser.ts`) so block keywords inside the quotes are not tokenized
- Crystal: Reject closing-bracket characters (`)`, `]`, `}`, `>`) as percent-literal delimiters in `skipMacroPercentLiteral` (`crystalExcluded.ts`) so `{% x = %) %}` no longer consumes the rest of the source as a percent literal
- Elixir: Treat `<this_kw> <ident> do` as a value reference when the `do` body is empty (immediately followed by `end`) in `isKeywordUsedAsValue` (`elixirParser.ts`) so `if cond foo do\nend` correctly pairs `if` with `end` instead of treating `cond` as the block opener — distinguishes from inner block expressions like `for x <- list, if true do :ok end do ... end`
- Elixir: Reject closing-bracket characters (`)`, `]`, `}`, `>`) as sigil delimiters in `getSigilCloseDelimiter` (`elixirHelpers.ts`) so `~s}content` no longer consumes the rest of the source as a sigil body
- Elixir: Skip newlines (`\n`/`\r`) when scanning the parameter context around `end` in `isEndAsParameterIdentifier` (`elixirParser.ts`) so `def foo(end\n)` continues to treat `end` as a parameter identifier
- Fortran: Add `interface` and `type` to `isFortranOpenConstructName` predecessor pattern (`fortranParser.ts`) so generic interface names and Fortran 90 derived-type names that spell keywords (`interface block`, `type do`, etc.) no longer create phantom block openers
- Fortran: Skip select-style openers (`select`, `where`, `forall`, `critical`, `associate`) when looking for a fallback opener for bare `end` in `matchBlocks` (`fortranParser.ts`) so a stray `end` inside a `case` branch no longer prematurely closes the enclosing `select` block
- Fortran: Extend `FORTRAN_DOT_OPERATOR_PATTERN` from built-in operators only to the general `\.<letter-list>\.` form (`fortranValidation.ts`) so user-defined operators (`x .myop. end`) put the following `end` in expression context
- Fortran: Re-check for `file`/`record`/`stream` after `&` continuation-line skipping in `isValidFortranBlockClose` (`fortranValidation.ts`) so multi-line `END FILE` / `END RECORD` / `END STREAM` I/O statements (`end &\n  file 10`) are no longer mistaken for block closers
- Julia: Continue scanning past `(` while looking for the enclosing `[` in `isInsideSquareBrackets` and `isInsideIndexingBrackets` (`juliaParser.ts`) so `arr[(begin:end)]` and `arr[(begin)]` recognize `begin`/`end` as `firstindex`/`lastindex` rather than block openers/closers
- Lua: Reject `goto` preceded by a single `.` or `:` (field access / method call) in `isAfterGoto` (`luaParser.ts`) so `function f() return self.goto end` no longer filters the trailing `end` and breaks the function pair — distinguishes single-dot/colon from `..` (concat) and `::` (label)
- Lua: Treat hex-prefixed numeric literals with trailing dot (e.g., `0x1A.`) as numbers in the trailing-dot branch of `isPrecededByDotOrColon` (`luaParser.ts`) so they are not misclassified as field access
- MATLAB: Add `\` (left-division operator) to the binary operator set and accept unary minus following `=`, `(`, `,`, `;`, `[`, `{`, or another operator in `isPrecededByBinaryOperator` (`matlabParser.ts`) so `x = -end`, `x = ...\n  end`, and `x = a\end` are recognized as expression contexts and do not steal an outer block's close
- Octave: Reject `arguments` block opener unless `function`/`methods`/`classdef` is on the stack in `matchBlocks` (`octaveParser.ts`) using the `pendingSkipDepths` pattern — top-level `arguments\n  x\nend` no longer creates a phantom block pair
- Octave: Skip whitespace between `do` and `(` in `isValidBlockOpen` (`octaveParser.ts`) so `do (1, 2);` is rejected as a function-call form just like `do(1, 2);`
- Octave: Reject typed-close keywords (`endif`, `endfor`, `endwhile`, etc., excluding `until`) when followed by tokens other than line ending, `;`, `,`, or comment in `isValidBlockClose` (`octaveParser.ts`) so `endif()`, `endif x = 5` no longer steal the enclosing block's close
- Octave: Reject duplicate `otherwise` (in addition to `case` after `otherwise`) in `matchBlocks` (`octaveParser.ts`) — switch semantics permit only one `otherwise` clause
- Pascal: Skip `asm` keywords adjacent to Unicode letters via `isAdjacentToUnicodeLetter` in `addAsmExcludedRegions` (`pascalParser.ts`) so `αasm` (Unicode identifier) does not generate a spurious asm excluded region
- Pascal: Add `@`, `&`, `<`, `[`, `+`, `-`, `*`, `/` to the rejection prefix set for `asm` in `addAsmExcludedRegions` and `isValidBlockOpen` (`pascalParser.ts`) so `@asm`, `&asm`, `TList<asm>`, `arr[asm]`, etc. no longer mark surrounding code as an asm block
- Pascal: Reject close keywords (`end`, `until`) preceded by `$` (hex literal prefix) or `#` (character constant prefix) in `isValidBlockClose` (`pascalParser.ts`) so `$end`, `$until`, `#end`, `#until` are no longer detected as block closers
- Pascal: Add `partial` to `TYPE_MODIFIERS` (`pascalValidation.ts`) so Delphi 2009+ `partial class` declarations are recognized as block openers
- Ruby: Recognize backslash line continuation (`\<newline>`) as whitespace in `isAfterDefKeyword` (`rubyParser.ts`) so `def \<NL>do`, `def \<NL>class`, `def \<NL>module`, etc. (methods named after reserved words via line continuation) correctly filter the keyword instead of treating it as a block opener
- Verilog: Skip whitespace before checking for `::` scope resolution in `isValidBlockClose` via new `isPrecededByScopeResolution` helper (`verilogParser.ts`) so `pkg :: end` is rejected as a qualified identifier reference rather than a block close

## [1.1.41] - 2026-05-06

### Fixed

- Ada: Skip excluded regions when scanning backward for `:=` before `do` in `isExtendedReturn` (`adaParser.ts`) so an extended-return body whose preceding comment ends with `:=` (e.g., `return X : Integer -- :=\n  do ...`) no longer triggers the `:= do` malformed-syntax rejection
- Ada: Detect mid-line `is type` / `is subtype` / `declare type` / `private type` / `record type` declarations whose `is` keyword appears on a continuation line in the type-decl `is` filter (`adaParser.ts`) so `procedure P is type T\n  is range 1..10;` no longer leaks the inner type's `is` as a procedure intermediate
- Ada: Accept Unicode whitespace (NBSP U+00A0, EM/EN/IDEOGRAPHIC SPACE, etc.) between `end` and the type keyword in `COMPOUND_END_PATTERN` (`adaParser.ts`) so `end if;` and similar Unicode-spaced compound-end forms are recognized
- AppleScript: Require an identifier after `to` or `on` at logical line start in `tryMatchSingleKeywordToken` (`applescriptParser.ts`) so `set x\n  to 5\nend` no longer creates a phantom `to → end` block — handler-form `to handlerName(...)` still pairs correctly
- Bash: Add backtick, `$(...)`, `$'...'`, and backslash-escape handling to `matchArithmeticExpansion`, `matchBareArithmeticEvaluation`, and `matchArithmeticBracket` (`bashStringHelpers.ts`) so `$((`echo done))`)`, `((`echo )` + 1 ))`, `$[ \`echo a]b\` + 1 ]`, and `$[ a \] b ]` are fully contained as excluded regions instead of leaking into surrounding code
- Bash: Replace quote-toggling in nested `${...}` parameter expansion with proper string-scope handling via new `scanParameterExpansionBody` helper (`bashStringHelpers.ts`) so `"${x:-"a}fi"}"` correctly treats the inner `"...}..."` as a string scope where `}` is literal
- COBOL: Skip whitespace-only lines (column 7+ blank but column 7 not in line-end) and apply identifier-character check before treating `D`/`d` indicator as debug line in `findFixedFormStringContinuation` (`cobolParser.ts`) so blank intervening lines no longer break fixed-format string continuation
- COBOL: Skip newlines (not just spaces/tabs) in `isPrecedingWordDataNameVerb` (`cobolParser.ts`) so multi-line statements like `IF X\n  MOVE\n    ELSE TO Y\nEND-IF` correctly recognize `ELSE` as data-name target rather than `IF` intermediate
- Crystal: Add `isAfterDefKeyword` filter (mirroring `rubyParser.ts`) and apply it in `tokenize` (`crystalParser.ts`) so keywords used as method names (`def end`, `def class`, `def begin`, `def do`, etc.) no longer interfere with the def block's pairing
- Elixir: Treat `#` (inline comment start) the same as `\n` in `isKeywordUsedAsValue` (`elixirParser.ts`) so `if cond # comment\ndo\n  :ok\nend` correctly pairs `if` with `end` instead of treating `cond` as the block opener
- Elixir: Recognize bare `\r` (CR-only line ending) as a heredoc-style sigil trigger in `matchSigil` (`elixirHelpers.ts`) for consistency with `matchTripleQuotedString`
- Elixir: Reject `block_middle` keywords (`after`, `rescue`, `catch`, `else`) followed by `=` in `tokenize` (`elixirParser.ts`) so `after = 100`, `rescue = nil`, etc. used as variable assignments no longer attach as false intermediates
- Elixir: Restrict `getSigilCloseDelimiter` to ASCII non-alphanumeric characters (`elixirHelpers.ts`) so `~sα` (Unicode letter) no longer accepts α as the close delimiter and consume the rest of the source as a sigil
- Fortran: Allow `function` and `subroutine` after `)` (type specifier) but reject after other operators in `isValidBlockOpen` (`fortranParser.ts`) so `f = function * 2` (variable in expression) no longer opens a block while `type(integer) function f()` continues to work
- Fortran: Detect array-element assignment (`(N) = expr`) and `&` line continuation in `isFollowedByAssignmentOp` (`fortranParser.ts`) so `else(1) = 5` and `else &\n   = 1` no longer attach `else` as an intermediate
- Fortran: Require parenthesized expression for all `select` sub-forms (`case`, `type`, `rank`) in `isValidBlockOpen` (`fortranParser.ts`) — `select case` without `(...)` is no longer accepted, matching the existing `select type` / `select rank` validation
- Julia: Track `[ ]` bracket depth in `hasUnmatchedBlockOpenerBetween` (`juliaHelpers.ts`), `hasMatchingEndBeforeBracketClose`, and `allUnmatchedBeginsAreFirstindex` (`juliaParser.ts`) so an `end` inside `arr[end]` (lastindex reference) no longer cancels out a real block opener — restores parsing of `a[do x; arr[end] end]`, `a[function f() arr[end] end]`, and similar block expressions inside indexing
- Julia: Accept `begin` as a real block opener in `isInsideSquareBrackets` (`juliaParser.ts`) when the enclosing `[` has no matching `]` (e.g., user editing in progress) so `a[begin x end` (unclosed bracket) detects the begin/end pair
- MATLAB: Reject `end` preceded by `=`, `~`, or `:` in `isPrecededByBinaryOperator` (`matlabParser.ts`) so `x = end`, `x = 1:end` (outside indexing), `x = ~end`, and `for i = end-1:5` (with `end` as range LHS expression) no longer steal an outer block's close
- MATLAB: Filter `block_middle` tokens (`case`, `else`, `elseif`, `otherwise`, `catch`) inside parentheses, brackets, or braces in `tokenize` (`matlabParser.ts`) so `switch x\n  z = foo(case);\n  case 1\nend` correctly treats `foo(case)` as a function call argument, not a switch intermediate
- MATLAB: Replace `pendingSkipEnds` counter with depth-tracking `pendingSkipDepths` stack in `matchBlocks` (`matlabParser.ts`) so a rejected `methods`/`properties`/`events`/`enumeration`/`arguments` opener correctly skips its matching `end` at the same nesting level instead of consuming an inner block's close
- MATLAB: Add `collectLogicalLineBefore` helper that follows `...`/`\` line continuations backward and apply it in `isEndInForHeaderRange` and `isUsedAsRhsIdentifier` (`matlabParser.ts`) so `for i = 1 ...\n  :end` (continuation in for-header) and `r = ...\n   for;` (continuation before RHS identifier) are detected correctly
- Octave: Reject `do` immediately followed by `(` (function-call form) in `isValidBlockOpen` (`octaveParser.ts`) so `do(args)` is treated as a function call instead of a do/until block opener that would prevent outer block pairing
- Octave: Detect `...`/`\` line continuations on the previous line in `isAtStatementLeadingPosition` (`octaveParser.ts`) so typed-end keywords (`endif`, `until`, etc.) following a continuation line are mid-expression and not block close
- Octave: Reject `case` after `otherwise` in `matchBlocks` (`octaveParser.ts`) — switch semantics require `otherwise` to be the last clause, so out-of-order `case` after `otherwise` is no longer registered as an intermediate
- Pascal: Reject keywords preceded by `&` or `@` (FreePascal keyword-escape / address-of) in `isValidBlockOpen` and the `block_middle` path of `tokenize` (`pascalParser.ts`) so `&case`, `&begin`, `&try` no longer open spurious blocks
- Pascal: Recognize `procedure of object`, `function of object` (method-pointer types), and `class of TBase` (class-reference type) in `isTypeDeclarationOf` (`pascalValidation.ts`) so `case X of\n  1: P := procedure of object;\nend` no longer registers the type-decl `of` as a case intermediate
- Ruby: Treat current-line leading `.` (method chain) and `)` (closing paren of multi-line condition) as implicit continuation in `findLogicalLineStart` (`rubyValidation.ts`) so `while x\n  .ready? do` and `while (\n  cond\n) do` correctly pair `while` with `end` instead of treating `do` as a stray block opener
- Ruby: Require non-newline target character for `?\C-x` and `?\M-\C-x` character literals (`rubyParser.ts`) so `?\C-\n` and `?\M-\C-\n` no longer consume the trailing newline as the control-character target
- Verilog: Chain-consume preceding control keywords for `endcase` (in addition to fork/join) in `matchBlocks` (`verilogParser.ts`) so `always @(posedge clk) case (sel)\n  ...\nendcase` correctly pairs `always` with `endcase`, mirroring the existing fork/join behavior
- Verilog: Skip SystemVerilog violation/check qualifiers (`unique`, `unique0`, `priority`) and recognize `case`/`casez`/`casex` as valid statement bodies in `scanForBeginAfterControl` (`verilogValidation.ts`) so `always @(posedge clk) unique if (a) begin ... end` and similar SV constructs detect the always-begin/end pairing
- Verilog: Add `randsequence` to `blockOpen` and map `endsequence` to accept both `sequence` and `randsequence` openers (`verilogParser.ts`) so `randsequence (s) ... endsequence` is recognized as a block per IEEE 1800-2017 §18.17
- Verilog: After bare-LF/CR string termination inside `(* attr *)`, scan forward for the literal `*)` close in `matchAttribute` (`verilogHelpers.ts`) without re-entering string mode so attribute strings with embedded newlines and trailing text no longer cause runaway excluded regions consuming the rest of the source
- VHDL: Verify the candidate `(` has a matching `)` ahead in `isInsideParens` (`vhdlValidation.ts`) instead of treating `;` as a hard boundary, so VHDL-2008 generic clauses with semicolon-separated subprogram declarations (`generic (\n  type T is private;\n  function compare(...) return boolean is <>\n)`) correctly recognize keywords inside as paren-bound — broken/in-progress unclosed-paren cases continue to be handled gracefully
- VHDL: Walk backward through wait-clause continuation lines (`on signal_list`, `until cond`, `for time`) in `isValidForOpen` and `isValidWhileOpen` (`vhdlValidation.ts`) so multi-line wait statements (`wait\n  on clk\n  until cond\n  for 100 ns;`) no longer mis-detect the trailing `for`/`while` as loop block openers

## [1.1.40] - 2026-05-01

### Fixed

- Ada: Preserve original casing and whitespace in compound-end token value (`adaParser.ts`) so `END IF`, `End If`, and `end  if` (multiple spaces) are no longer normalized to lowercase `end if`; the `matchBlocks` regex now tolerates whitespace and `--` line comments between `end` and the type keyword
- Ada: Detect mid-line `; type` / `; subtype` declarations whose `is` keyword appears on a continuation line (`adaParser.ts`) so `procedure P is\n  X : Integer; type T (D : Integer)\n    is range 1..100;` no longer leaks the inner type's `is` as a procedure intermediate
- Ada: Use Unicode-aware word boundaries for `do` keyword detection in `isExtendedReturn` (`adaParser.ts`) and `isValidAcceptOpen` (`adaValidation.ts`) so identifiers containing non-ASCII letters (e.g., `doβ`) are no longer mistaken for the `do` keyword
- Ada: Reject `:= do` and `do;` in `isExtendedReturn` (`adaParser.ts`) — extended-return body requires statements between `do` and `end return`, so malformed `return X : Integer := do;` no longer pairs `return` with a stray `end`
- AppleScript: Use `flexMatch` as compound-keyword `endOffset` (`applescriptParser.ts`) so `end  tell` / `end\ttell` / `end (* c *) tell` decoration spans the actual source range instead of being cut off mid-keyword
- AppleScript: Accept Unicode whitespace (NBSP U+00A0, EM/EN/IDEOGRAPHIC SPACE, ZWSP, etc.) between compound-keyword words in `matchCompoundKeyword` (`applescriptHelpers.ts`) so `end tell` and similar Unicode-spaced compounds are recognized
- AppleScript: Strip non-alphabetic prefix characters from `condMatch[0]` in `isInsideIfCondition` (`applescriptHelpers.ts`) so `(repeat while tell)` correctly recognizes `repeat while` as a condition opener and rejects `tell` as a value
- AppleScript: Validate handler name when falling back from `end <type>` to `on`/`to` opener in `matchBlocks` (`applescriptParser.ts`) so a stray `end if` inside `on run ... end` no longer closes the `on` handler — the fallback now requires the handler name to match the close-keyword type (e.g., `on tell()` legitimately pairs with `end tell`)
- AppleScript: Reject compound block-open keywords followed by whitespace + `(` in `tryMatchCompoundKeywordToken` (`applescriptParser.ts`) so `with timeout (5)` is treated as a function call (consistent with `with timeout(5)`) instead of a block opener
- Bash: Parse concatenated heredoc delimiter parts (`<<"EOF"'TAIL'`, `<<X"Y"`) by replacing the single-form regex with an iterative parser in `parseHeredocOperator` (`bashLeafHelpers.ts`) and `matchHeredoc` (`bashStringHelpers.ts`) so the actual terminator is the concatenation of all parts
- Bash: Reject `#` immediately after extglob openers (`@(`, `!(`, `?(`, `*(`, `+(`) as comment start in `isCommentStart` (`bashLeafHelpers.ts`) so `case x in @(#*)) ;; esac` and similar extglob patterns containing literal `#` are parsed correctly
- COBOL: Add `BY`, `GIVING`, and `REMAINDER` to `DATA_NAME_VERBS` (`cobolParser.ts`) so `MULTIPLY A BY ELSE`, `ADD A B GIVING ELSE`, and `DIVIDE A BY B GIVING C REMAINDER ELSE` no longer attach `ELSE` as an `IF` intermediate when used as data names
- Crystal: Skip percent literals (`%r(...)`, `%w[...]`, `%|...|`, etc.) inside `{% %}` and `{{ }}` macro template bodies via new `skipMacroPercentLiteral` (`crystalExcluded.ts`) so `{% x = %r(/) %}` and `{% %|x%}|` no longer cause the macro body parser to consume past the actual `%}` close marker
- Crystal: Propagate heredoc state through regex `#{}` interpolation by adding `heredocState` parameter to `matchRegexLiteral` and `skipRegexInterpolationShared` (`rubyFamilyHelpers.ts`, `crystalParser.ts`) so `/#{<<-EOF}/` correctly extends the excluded region across the heredoc body
- Crystal: Recognize macro templates (`{% %}`, `{{ }}`) as non-content in `isPostfixConditional` (`crystalExcluded.ts`) so `{% x %} if cond\n  body\nend` correctly opens an `if` block instead of treating `if` as a postfix modifier of the macro template
- Crystal: Reject `?` followed by `/` when preceded by `$` or `@` (`$?`, `@?`) in `tryMatchExcludedRegion` (`crystalParser.ts`) so `$?/2` correctly treats `?` as part of the global variable and `/` as division, not a char literal
- Elixir: Replace `isInsideOpenBracket` with targeted `isEndAsParameterIdentifier` (`elixirParser.ts`) — `end` is now rejected only when it sits as a complete comma-separated element bordered by `(`/`,`/`[`/`{` and `)`/`,`/`]`/`}`. This restores `Enum.map(list, fn x -> x end)`, `(fn -> 1 end)`, `[fn -> 1 end]`, and pipelines with multiple `fn..end` blocks to be parsed correctly
- Erlang: Accept variable arity (uppercase identifier) in `fun M:F/A`, `fun F/A`, and quoted-atom fun references (`erlangParser.ts`) per OTP 21+ spec so `fun lists:reverse/Arity` no longer falls through to be tokenized as a `fun..end` block opener
- Erlang: Enforce `of`/`catch`/`after` ordering and reject duplicates in `try` block intermediates (`erlangParser.ts`) so `try X catch _ -> 1 of ok -> 2 end` only registers the in-order `catch` and skips the out-of-order `of`
- Fortran: Detect `module function`, `module subroutine`, and `module procedure` inside (sub)module bodies as block openers by passing the keyword to `isFortranOpenConstructName` and requiring explicit `module procedure` to suppress (`fortranParser.ts`) — plain `module ` no longer hides these as construct names
- Fortran: Skip blank lines inside `&` continuation chain in `isValidIfOpen` (`fortranParser.ts`) so `if (x > 0 &\n\n   .and. y > 0) then` correctly detects `then` and opens the `if` block
- Fortran: Add `team` to `blockOpen` and `COMPOUND_END_TYPES` with validation that requires `change ` prefix (`fortranParser.ts`) so Fortran 2018 `change team (t) ... end team` is recognized as a block
- Fortran: Reject `select type` / `select rank` not followed by `(...)` and `submodule` not followed by `(parent)` in `isValidBlockOpen` (`fortranParser.ts`) so invalid forms `select type x` and `submodule child` no longer open spurious blocks
- Julia: Track comprehension context in `hasUnmatchedBlockOpenerBetween` (`juliaHelpers.ts`) so `if` filters appearing after a `for x in y` clause inside `[...]` or `(...)` are not counted as unmatched block openers — restores parsing of `[x for x in arr if a if b]`, `[[i+j for i in 1:n if i > 0] for j in 1:n]`, and similar nested comprehensions
- Julia: Recognize value-introducing keywords (`return`, `yield`, `throw`, `if`, `for`, `while`, `do`, `begin`, `and`, `or`, `not`, etc.) before `[` in `isIndexingBracket` (`juliaHelpers.ts`) so `return [begin x end]` is parsed as array construction containing a `begin..end` block, not as indexing brackets where `begin` would mean `firstindex`
- Lua: Pass `excludedRegions` to `isAfterGoto` and skip excluded characters during the backward scan (`luaParser.ts`) so a `goto` substring inside a comment, string, or long bracket no longer causes subsequent block keywords (`end`, `if`, etc.) to be filtered as goto label targets
- MATLAB: Recognize `parfor` and mid-line `for` after `;`/`,` separators in `isEndInForHeaderRange` (`matlabParser.ts`) so `parfor i = 1:end` and `if true; for i = 1:end, body; end; end` correctly treat the inline `end` as range expression
- MATLAB: Skip `...` line continuations when scanning backward for `:` in `isEndInForHeaderRange` (`matlabParser.ts`) so `for i = 1: ...\n   end` recognizes the `end` on the next line as part of the range expression
- MATLAB: Detect `end` as the LHS of a for-header range (`for i = end:5`) and reject `end` after binary operators (`+`, `-`, `*`, `/`, `^`, `<`, `>`, `&`, `|`) in `isValidBlockClose` (`matlabParser.ts`) so `x = 1 + end;` and similar invalid expression-context uses no longer steal an outer block's close
- MATLAB: Reject block-opener keywords used as standalone identifiers when an `=` is followed by `;`/`,` separator before the keyword in `isUsedAsRhsIdentifier` (`matlabParser.ts`) so `x=1;do\n  ...\nuntil cond` correctly opens the `do` block in Octave
- MATLAB: Increment a skip counter for rejected `arguments`/`properties`/`methods`/`events`/`enumeration` openers and consume their `end` in `matchBlocks` (`matlabParser.ts`) so an `arguments` block outside function/methods/classdef context no longer breaks outer block pairing
- Pascal: Skip `@end` (assembly local label) inside asm body in `addAsmExcludedRegions` (`pascalParser.ts`) so Borland/Delphi inline assembly with `JMP @end` / `@end:` labels no longer terminates the asm body at the label
- Pascal: Reject `@end` (address-of operator) and `&end` (FreePascal escaped-keyword identifier) outside asm context in `isValidBlockClose` (`pascalParser.ts`) so `X := @end;` and similar references no longer pair as block close
- Verilog: Add `matchMacroArgList` (`verilogHelpers.ts`) and apply it in `tryMatchExcludedRegion` (`verilogParser.ts`) so backtick macro invocations like `` `MY_MACRO(begin x = 1; end) `` exclude their argument lists, preventing block keywords inside the args from being tokenized
- Verilog: Split `static`, `automatic`, `const`, `protected`, `local`, `virtual`, `pure` into a separate `METHOD_QUALIFIER_KEYWORDS` set (`verilogParser.ts`) — these qualifiers no longer suppress `function`/`task`/`class` as identifiers, so `static function int counter()` and `automatic function int f()` open valid blocks
- Verilog: Reject `default clocking <name>;` and `global clocking <name>;` (LRM §14.16.7 specification statements) as block openers in `isValidBlockOpen` (`verilogParser.ts`) so default-clocking specifications without `@(...)` event control or body do not open spurious clocking blocks
- VHDL: Reject block-open keywords immediately followed by attribute tick (`process'foreign`, `architecture'left`, etc.) in `isValidBlockOpen` (`vhdlParser.ts`) so 17 block keywords used in attribute references are no longer mis-tokenized as block openers

## [1.1.39] - 2026-05-01

### Fixed

- Ada: Normalize compound-end token value to canonical `end <type>` in `compoundEndPositions` (`adaParser.ts`) so embedded `--comment`, CR, or LF between `end` and the type keyword no longer breaks `endType` re-extraction in `matchBlocks` (`for ... loop ... end -- comment\nloop;` now pairs the `for` with `end loop` instead of stealing the inner `if`'s `end`)
- Ada: Add `return` to the whitelist of openers that accept a `when` intermediate (`adaParser.ts`) so the Ada 2012 extended-return statement's exception handler (`return R : T do ... exception when others => ...; end return;`) records the `when` clauses as intermediates of the `return` block
- AppleScript: Add `:` (record key separator) and `^` (exponent operator) to the operator/punctuation list in `isPrecededByExpressionTerminator` (`applescriptParser.ts`) so `{action: tell, target: ...}` and `set x to 2 ^ tell` no longer treat the trailing keyword as a block opener
- AppleScript: Extend the `block_close` fallback in `matchBlocks` to accept `to` handler definitions in addition to `on` (`applescriptParser.ts`) so `to handler() ... end tell` correctly pairs with the `to` opener
- Bash: Allow `(` as a valid character after `{` for command grouping (`bashParser.ts`) so `{(echo hi);}` is recognised as a brace block containing a subshell instead of being silently dropped
- Bash: Expand the unquoted heredoc delimiter character class to include `.`, `+`, `:`, `%`, `,`, `=` (`bashLeafHelpers.ts`, `bashStringHelpers.ts`) so `<<.`, `<<+`, `<<:`, `<<%` are recognised as valid heredoc operators per Bash spec
- Bash: Skip the `}` block-close validation when the predecessor character is inside an excluded region (`bashParser.ts`) so `{ echo ${arr[@]} }` and `{ x=$(cmd) }` are no longer falsely detected as brace blocks (the trailing `}`/`)` of `${...}`/`$(...)` is not a structural separator)
- COBOL: Apply the same column ≥ 72 fixed-format identification-area exclusion in `computeValidPositions` that `tokenize` already applies (`cobolParser.ts`) so a stray keyword in the identification area no longer pairs with a real closer at column < 72, leaving the actual opener unmatched
- COBOL: Treat pseudo-text content (`==..==`) inside an EXEC block as opaque in `matchExecBlock` (`cobolHelpers.ts`) — `END-EXEC` appearing inside `==X END-EXEC Y==` is now data, not an early termination, so the EXEC block extends through the real `END-EXEC`
- COBOL: Filter `WHEN`/`ELSE` tokens immediately preceded by a COBOL data-name verb (`MOVE`, `ADD`, `SET`, `DISPLAY`, `INTO`, `TO`, etc.) in `tokenize` (`cobolParser.ts`) so `MOVE ELSE TO Y` no longer attaches `ELSE` as an intermediate of the enclosing `IF`
- Crystal: Treat literal-only expressions as content in `isPostfixConditional` (`crystalExcluded.ts`) — string, regex, symbol, char, percent, backtick, and macro-template excluded regions are now counted as content, so `"hello" if @flag` is recognised as a postfix conditional instead of opening a stray `if` block
- Elixir: Reject `end` inside an unmatched `(`, `[`, or `{` in `isValidBlockClose` (`elixirParser.ts`) so `def foo(end) do ... end` pairs `def` with the outer `end` rather than the parameter-list `end`
- Erlang: Add `bnot` (bitwise NOT) to `CATCH_EXPR_WORD_OPERATORS` (`erlangHelpers.ts`) so `try X = bnot catch err catch _:_ -> ok end` recognises the first `catch` as an expression prefix instead of a clause separator
- Fortran: Reject `type = expr` and `type(N) = expr` assignment forms in `isValidTypeOpen` (`fortranParser.ts`) so `integer :: type` followed by `type = 5` no longer opens a spurious `type` block
- Fortran: Reject `procedure = expr` and `procedure(N) = expr` assignment forms in `isValidProcedureOpen` (`fortranValidation.ts`) so `integer :: procedure` followed by `procedure = 5` no longer opens a spurious `procedure` block
- Fortran: Add `isFortranOpenConstructName` filter for procedure names following `subroutine`, `function`, `program`, `module`, `submodule(...)`, or `module procedure` (`fortranParser.ts`) so `subroutine block(arg)` and `function do() result(r)` no longer tokenise the procedure name as a block keyword that steals a later bare `end`
- Julia: Track bracket depth in `isInsideParentheses` (`juliaParser.ts`) so block-form `for` at the start of `[...]` inside `(...)` (e.g., `f([for i in 1:3; i; end])`) is correctly recognised as a block opener rather than misclassified as a generator expression
- Julia: Skip keywords preceded by `@` (e.g., `@if`, `@end`, `@for`) in `tokenize` (`juliaParser.ts`) so macro-prefixed reserved words no longer leak as block tokens
- Lua: Make `isAfterGoto` case-sensitive (`luaParser.ts`) — only literal lowercase `goto` is the keyword per Lua spec, so `Goto` / `GOTO` identifiers no longer cause subsequent block keywords to be filtered as goto label targets
- Lua: Include form-feed (`\f`) and vertical-tab (`\v`) in the whitespace skip predicates of `isPrecededByDotOrColon`, `isAfterGoto`, and `matchGotoLabel` (`luaParser.ts`) for consistency with `\z` escape handling
- MATLAB: Accept `arguments` as a `block_open` when the enclosing scope is `function`, `methods`, or `classdef` in `matchBlocks` (`matlabParser.ts`) so MATLAB R2019b+ argument-validation blocks inside function bodies are recognised
- MATLAB: Reject block-opener keywords used as standalone identifiers on the RHS of an assignment (`r = for;`, `r = if;`, `x = while)`) via new `isUsedAsRhsIdentifier` in `isValidBlockOpen` (`matlabParser.ts`) so invalid expression-context usage no longer destroys outer block pairing
- MATLAB: Reject `end` immediately after `:` on a `for`-loop header line via new `isEndInForHeaderRange` in `isValidBlockClose` (`matlabParser.ts`) so `for i = 1:end` treats the `end` as the array-index `end`, not a block close
- MATLAB: Filter block-middle keywords (`case`, `else`, `elseif`, `otherwise`, `catch`) used as variable names (`case = 5`) in `tokenize` (`matlabParser.ts`) so the assignment no longer attaches as a stray intermediate
- Octave: Add `until` to the typed-end keyword position check in `isValidBlockClose` (`octaveParser.ts`) so `until` in expression position (e.g., `a + until`) is no longer tokenised as a block close, matching the existing `endif`/`endfor`/etc. handling
- Pascal: Honor excluded regions when scanning backward for `;` in the asm-body comment-skip logic of `addAsmExcludedRegions` (`pascalParser.ts`) — a `;` inside a brace `{...}` / paren-star `(*...*)` / string region is no longer mistaken for an asm-style line comment that swallows the real closing `end`
- Pascal: Reject `asm` immediately followed by `(` (function-call form) in `isValidBlockOpen` and `addAsmExcludedRegions` (`pascalParser.ts`) — the comment said `(` rejected asm-as-call, but the rejection list omitted it; `asm(x);` is now correctly treated as a non-block usage. Also skip excluded regions in the forward whitespace check of `addAsmExcludedRegions` for consistency with `isValidBlockOpen`
- Ruby: Reject the dot in `$.` global variable as a method-call dot in `isDotPreceded` (`rubyValidation.ts`) so `puts $.` no longer causes the next line's `end`/`elsif`/`else` to be filtered as a method call
- Ruby: Reject the lone trailing backslash of `$\` global variable as a line-continuation marker in `findLogicalLineStart` (`rubyValidation.ts`) so `puts $\\\nif true\nend` is no longer joined into a single logical line that suppresses the `if` block
- Verilog: Generalize the `'{...}` assignment-pattern filter in `tokenize` to all block keywords (not only `default`) (`verilogParser.ts`) so `'{begin: 0, end: 100}` no longer tokenises the field names as block opener/closer
- Verilog: Reject `default` preceded by `::` (scope-resolved `pkg::default`) in the `default` filter of `tokenize` (`verilogParser.ts`) so the qualified identifier no longer registers as a case-label intermediate
- Verilog: Add `isPrecededByDataTypeKeyword` check to `isValidBlockClose` (`verilogParser.ts`) so `int endmodule;` (illegal SV identifier preceded by `int`) no longer steals the surrounding `module`'s closer
- Verilog: Make preprocessor-directive detection case-sensitive (`/^(ifdef|ifndef|elsif)$/` instead of `/i`) in `scanForBeginAfterControl` (`verilogValidation.ts`) per IEEE 1800-2017 §22 — uppercase macro names like `` `IFDEF `` are now recognised as user macros, not directives, so the next identifier (e.g., `begin`) is no longer consumed as a macro argument
- VHDL: Add `isValidContextOpen` to distinguish a `context_declaration` (`context name is ... end`) from a `context_reference` (`context selected_name;`) (`vhdlParser.ts`) so context references inside a context-declaration body no longer steal the enclosing `end context`
- VHDL: Extend `COMPOUND_END_PATTERN` to recognise `end package body` and `end protected body` per LRM 4.8 / 5.6.2 (`vhdlParser.ts`) and map the `body` suffix back to `package` / `protected` for `endType`-based opener matching, so the trailing `body` is no longer dropped from the close-keyword token

## [1.1.38] - 2026-04-30

### Fixed

- Ada: Allow newlines/CR between `end` and the type keyword in compound end matching (`/^end[\s]+/` instead of `[ \t]+`) (`adaParser.ts`) so `end\n  if` and `end --comment\n  if` are recognised as compound `end if`
- Ada: Track paren depth in the `is`-filter when scanning between a type/subtype keyword and `is` (`adaParser.ts`) so discriminant lists like `(D : Integer; B : Boolean)` no longer let the inner `;` disable the type-declaration filter
- Ada: Filter bare `or` to a select-intermediate only at select alternative boundaries (preceded by `;` or `select`) and skip when the next token is `else` (`adaParser.ts`) so boolean `or` in expressions and `or else` short-circuits no longer add ghost intermediates to enclosing select blocks
- AppleScript: Recognise smart double quotes (U+201C/U+201D) as string delimiters in `tryMatchExcludedRegion` (`applescriptParser.ts`) so Script Editor auto-converted strings no longer leak block keywords from inside the literal
- AppleScript: Reject compound block openers immediately followed by `(` (function-call form like `with timeout(5)`) in `tryMatchCompoundKeywordToken` (`applescriptParser.ts`) so the trailing word is no longer treated as a block opener
- AppleScript: Set compound keyword `endOffset` to `startOffset + value.length` instead of `flexMatch` (`applescriptParser.ts`) so whitespace/comments/continuations between compound-keyword words are no longer over-decorated
- AppleScript: Add binary operators (`&+-*/=<>` and Unicode `≤≥≠÷×`) to `isPrecededByExpressionTerminator` (`applescriptParser.ts`) so `set x to 1 & tell` and `if x = tell` no longer treat the keyword as a block opener
- AppleScript: Skip `¬<newline>` line continuations when scanning back from `tell`/`if`/`repeat` in `isPrecededByExpressionTerminator` (`applescriptParser.ts`) so `set x to ¬\nrepeat` correctly treats `repeat` as the right operand of `to`, not a block opener
- Bash: Reject `case`/`esac` used as variable assignment (`case=val`), array (`case[i]=val`), augmented assignment (`case+=val`), or function definition (`case() {...}`) inside subshells via new `isWordUsedAsAssignmentOrFunction` in `scanSubshellBody` (`bashStringHelpers.ts`)
- Bash: Treat trailing `\` inside excluded regions (e.g., `\` at end of a comment) as literal text rather than line continuation in `isAtCommandPosition` (`bashValidation.ts`) so the next line is still recognised as command-leading
- Bash: Verify a matching `]]` exists ahead before treating `[[` as a double-bracket command in `isInsideDoubleBracket` (`bashParser.ts`) so an unclosed `[[` no longer poisons subsequent blocks
- COBOL: Limit unterminated EXEC region to the EXEC keyword itself in `matchExecBlock` (`cobolHelpers.ts`) so mid-edit code with a missing `END-EXEC` still detects blocks in the trailing content
- COBOL: Skip keywords in the fixed-format identification area (columns 73-80) in `tokenize` (`cobolParser.ts`) when the 6-char sequence area consists of digits/whitespace, so identification text no longer registers as block keywords
- COBOL: Support fixed-format string literal continuation lines via new `findFixedFormStringContinuation` in `matchCobolString` (`cobolParser.ts`) so unterminated literals continued by a column-7 `-` indicator on the next non-blank, non-comment line are recognised as a single excluded region — preventing COBOL keywords like `IF` appearing in the continuation prep area or inside the continued literal from being tokenised as block keywords
- Crystal: Restrict regex modifier set to `i/m/x` (was `i/m/x/s`) in `skipRegexLiteral` (`crystalExcluded.ts`) per Crystal language spec
- Elixir: Recognise multi-letter lowercase sigils like `~html`/`~json` (Elixir 1.18+) alongside uppercase custom sigils in `matchSigil` and `skipNestedSigil` (`elixirHelpers.ts`)
- Elixir: Treat standalone CR as a newline (heredoc-mode marker) alongside LF in `matchTripleQuotedString`, `skipNestedTripleQuotedString`, and `skipNestedSigil` (`elixirHelpers.ts`) per CLAUDE.md line ending rules
- Erlang: Allow Unicode letters/numbers (`\p{L}\p{N}`) in atoms/identifiers within function reference patterns in `isValidBlockOpen` (`erlangParser.ts`) per OTP 19+
- Erlang: Treat `\<LF>`, `\<CR>`, and `\<CRLF>` inside a quoted atom as line continuation in `tryMatchExcludedRegion` (`erlangParser.ts`) so the atom continues on the next line per Erlang spec
- Erlang: Restrict `else` intermediate tracking to `maybe` blocks only (`erlangParser.ts`) per Erlang Reference Manual — `if` only allows guard clauses and `try` only allows `of`/`catch`/`after`
- Fortran: Reject `END` followed by `FILE`/`RECORD`/`STREAM` as block close in `isValidFortranBlockClose` (`fortranValidation.ts`) so Fortran 77/90+ I/O statements (`END FILE [unit]`) are no longer misinterpreted as block closes
- Julia: Detect trailing generator expressions inside brackets/parens via new `isPrecededByValueExpression` in `isInsideBrackets`/`isInsideParentheses` (`juliaParser.ts`) so `f(x, y for y in iter)` and `[a, b for b in iter]` correctly treat `for` as a generator rather than a block opener
- Lua: Accept shebang at offset 0 or directly after a leading UTF-8 BOM (U+FEFF) in `tryMatchExcludedRegion` (`luaParser.ts`) per Lua 5.3+ spec
- Lua: Allow whitespace including newlines between `goto` and its label name in `isAfterGoto` (`luaParser.ts`) so `goto\n  end_label` correctly skips reserved keywords used as goto targets
- MATLAB: Reject `@keyword` function handles (e.g., `@if`, `@while`, `@function`) via new `isPrecededByAtSign` in `isValidBlockOpen` (`matlabParser.ts`) so reserved keywords used as function handle names no longer steal the surrounding block's `end`
- MATLAB: Filter `end` immediately abutting numeric/hex/binary literal dots (`10.end`, `0xFF.end`, `0b1010.end`) in `isPrecededByDot` (`matlabParser.ts`) to avoid invalid syntax breaking outer block highlighting
- MATLAB: Restrict classdef section keywords (properties/methods/events/enumeration/arguments) to `block_open` only when an enclosing `classdef` is on the stack in `matchBlocks` (`matlabParser.ts`) so `properties(obj)`-style function calls outside classdef no longer open phantom blocks
- Octave: Reject typed-end keywords (`endif`/`endfor`/`endwhile`/etc.) used as identifiers in expression context via new `isAtStatementLeadingPosition` in `isValidBlockClose` (`octaveParser.ts`) so `if endif == 5` no longer treats the rhs `endif` as a block closer
- Pascal: Apply field-access dot rejection to all block keywords (open/middle/close) via shared `isPrecededByFieldDot` helper in `isValidBlockOpen`, `isValidBlockClose`, and `tokenize` (`pascalParser.ts`) so `Foo.begin`, `Foo.case`, `Foo.try`, `Foo.asm`, etc. no longer steal the surrounding block's pair
- Pascal: Skip `end` preceded by `.` (field access like `foo.end`) and `end` after `;` line comment in `addAsmExcludedRegions` (`pascalParser.ts`) so asm bodies containing dotted identifiers or trailing `;` line comments no longer terminate prematurely
- Pascal: Advance `asmPattern.lastIndex` past the matched `end` (or to `source.length` when unterminated) in `addAsmExcludedRegions` (`pascalParser.ts`) so `asm` words appearing inside an asm body (e.g., as opcodes or identifiers) no longer generate overlapping excluded regions — preserving the sorted/non-overlapping invariant of `regions`
- Ruby: Skip `$`-prefixed special global variables (`$&`, `$|`, `$+`, `$~`, etc.) in `endsWithContinuationOperator` (`rubyValidation.ts`) so the global variable suffix no longer triggers false postfix conditional detection
- Ruby: Require `=begin`/`=end` markers to appear at column 0 (after `\n`/`\r` or at file start) in the `=`-prefix tokenize filter (`rubyParser.ts`) so inline `x=begin\n...\nend` is preserved as a valid begin-block assignment
- Verilog: Treat `\<LF>`, `\<CR>`, and `\<CRLF>` inside Verilog strings as line continuation in `matchVerilogString` (`verilogHelpers.ts`) per IEEE 1800-2017 §5.9
- Verilog: Reject block keywords (function/task/module/etc.) preceded by data type or qualifier keywords (`int`, `bit`, `logic`, `wire`, `input`, `output`, `signed`, `static`, etc.) via new `isPrecededByDataTypeKeyword` and `DATA_TYPE_KEYWORDS` set in `isValidBlockOpen` (`verilogParser.ts`) so `int function` and `input module` are recognised as parameter/variable names
- Verilog: Reject `function` in covergroup `with function sample(...)` syntax via new `isCovergroupWithFunctionSample` in `isValidBlockOpen` (`verilogParser.ts`) per LRM §19.8.1, so the covergroup option specifier is no longer treated as a function declaration
- Verilog: Recognise multi-line DPI import/export by scanning back to the last unquoted semicolon in `isOnDpiLine` (`verilogValidation.ts`) so `import "DPI-C"\n  function void f();` correctly identifies the DPI declaration
- VHDL: Reject `end <type>` close keywords inside parenthesized expressions (e.g., `if func(end record) > 0 then`) via `block_close` filter in `tokenize` (`vhdlParser.ts`)
- VHDL: Extend `hasEndKeywordOnSameLine` to scan up to 10 lines forward in `isValidEntityOrConfigOpen` (`vhdlValidation.ts`) so block-form `for label: comp use entity ...; end for;` is recognised even when `end for;` appears on a separate line from the `use entity` clause

## [1.1.37] - 2026-04-29

### Fixed

- Ada: Detect unterminated `(` ahead in `isInsideParens` (`adaValidation.ts`) via new `hasMatchingCloseParen` so editing-in-progress code like `F("hello"\n   if X > 0 then ... end if;` no longer suppresses the inner `if` block
- Ada: Raise the `for/while` header backward-scan limit from 20 to 200 lines in `isValidLoopOpen` (`adaValidation.ts`) so multi-line `for` loops with extensive comments are still paired with `end loop`
- AppleScript: Reject `tell()`/`repeat()`/`if(`/etc. function-call form, `(tell)`/`{tell, repeat}` operand contexts, and modifier-keyword (`is`/`as`/`with`/`where`/`given`/`returning`/`on`) precedences in `isValidBlockOpen` and `isPrecededByExpressionTerminator` (`applescriptParser.ts`) so reserved words as values, list elements, or handler names no longer steal the surrounding block's `end`
- AppleScript: Add an on-handler fallback in `matchBlocks` (`applescriptParser.ts`) so `on tell()` ... `end tell` correctly pairs with the `on` handler when no `tell` opener is on the stack
- AppleScript: Skip backslash-escaped `\|` inside pipe-delimited identifiers in `tryMatchExcludedRegion` (`applescriptParser.ts`) so `|name\|with-pipe|` is treated as one excluded identifier
- Bash: Reject backslash-escaped quotes (`\"`, `\'`, `` \` ``) as string openers via new `isEscapedByBackslash` in `tryMatchExcludedRegion` (`bashParser.ts`) so `echo \"foo\"` no longer swallows the rest of the source as a double-quoted string
- Bash: Require whitespace between `=` and the keyword in env-var prefix detection in `isAtCommandPosition` (`bashValidation.ts`) so `a=if` and `b=fi` no longer generate ghost `if`/`fi` pairs
- Bash: Skip a leading UTF-8/UTF-16 BOM (U+FEFF) when scanning whitespace in `isAtCommandPosition` (`bashValidation.ts`) so BOM-prefixed bash scripts recognise the first keyword as a command
- Bash: Allow non-alphanumeric `<<\X` heredoc delimiters (e.g., `<<\}`) in `matchHeredoc` and `parseHeredocOperator` (`bashStringHelpers.ts` + `bashLeafHelpers.ts`) so the heredoc body is correctly excluded
- COBOL: Add `isInCopyStatement` to `tokenize` (`cobolParser.ts`) so end-keyword identifiers used as `COPY` copybook filenames (e.g., `COPY END-IF.`) no longer close the surrounding `IF` block
- Crystal: Add `isMacroRegexStart` and `skipRegexLiteral` in `matchMacroTemplate` (`crystalExcluded.ts`) so `{% x = /pat%}/ %}` and `{{ /pat}}/ }}` no longer close the macro at the regex's `%}`/`}}`
- Crystal: Detect `def name = expr` shorthand in `isValidBlockOpen` via new `hasShorthandDefAssignment` (`crystalParser.ts`) so Crystal 1.0+ shorthand methods are not treated as `def`/`end` blocks
- Elixir: Extend `isKeywordUsedAsValue` to follow newlines/comments and recognize binary operators, method/field access, and word operators (`and`/`or`/`not`/`in`/`when`) in `elixirParser.ts` so `if cond\ndo`, `case cond + 1 do`, and `if cond and other do` keep the outer block as opener
- Elixir: Replace duplicate immediate-`do` check in `isValueForPrecedingBlockKeyword` with a delegated `isKeywordUsedAsValue` call (`elixirParser.ts`) so the value-form detection stays consistent across both `hasDoKeyword` and `isValidBlockOpen`
- Erlang: Restrict tilde-sigil modifier set in `tryMatchExcludedRegion` to `s/S/b/B` per OTP 27 (`erlangParser.ts`) so invalid letters no longer extend the sigil region
- Fortran: Honor `;` statement separators when scanning for `::` in `isAfterDoubleColon` (`fortranHelpers.ts`) so `subroutine foo; integer :: x; end subroutine` and `do i = 1, 10` after a separator-`::` no longer have their close/open keywords skipped
- Fortran: Add `isPrecededByOperator` early-return guards before `isValidTypeOpen` and `isBlockWhereOrForall` in `isValidBlockOpen` (`fortranParser.ts`) so `call where(x)`, `call type(x)`, and `b = where(...)` are no longer detected as block openers and the real `where`/`type` headers stay paired
- Fortran: Add new `isMiddleInExpressionContext` in `fortranValidation.ts` and apply it during `tokenize` (`fortranParser.ts`) so `print *, then` and `x = then + 1` no longer register the trailing `then` as an extra `if` intermediate
- Julia: Allow `_` as a string-macro prefix start in both `tryMatchExcludedRegion` (`juliaParser.ts`) and `skipJuliaInterpolation` (`juliaHelpers.ts`) so user-defined macros like `_my_macro"text"end` are correctly recognised as a single string-macro region
- Julia: Preserve `end` followed by `!=` in the tokenize `!`-filter (`juliaParser.ts`) so `arr[1:end!=2]` no longer drops the `end` token
- Lua: Treat shebang lines (`#!` at offset 0) as excluded regions in `tryMatchExcludedRegion` (`luaParser.ts`) so paths like `#!/path/to/do/lua` no longer surface a `do` block opener
- Lua: Add `isAfterGoto` to `tokenize` filter (`luaParser.ts`) so reserved keywords used as `goto <label>` targets are no longer detected as block_close tokens
- MATLAB: Skip a leading UTF-8/UTF-16 BOM (U+FEFF) in `isAtStatementStart` (`matlabParser.ts`) so the first-line `!cmd` shell escape after a BOM is recognised correctly
- MATLAB: Reject numeric-followed-by-`.end` when the preceding run is itself preceded by `.` or contains an exponent (`isPrecededByDot` in `matlabParser.ts`) so `1.5.end` and `1e5.end` are treated as struct-field access and no longer steal the outer block's `end`
- MATLAB: Allow `;`/`,`/`:` after classdef section keywords in `isValidBlockOpen` (`matlabParser.ts`) so empty `properties;`/`methods,`/etc. sections are still recognised as block openers
- MATLAB: Verify a matching close bracket exists ahead in `isInsideParensOrBrackets` via new `hasMatchingCloseAhead` (`matlabParser.ts`) so editing-in-progress code with an unterminated `(` no longer filters out every subsequent `end` token
- MATLAB: Reject reserved keywords followed immediately by `.` (struct field access) and detect `isKeywordUsedAsFunctionCall` for non-section keywords in `isValidBlockOpen` (`matlabParser.ts`) so `do.x = 1` and `x = classdef()` no longer steal the surrounding block's `end`
- Octave: Inherits the MATLAB fixes for struct-field access, function-call form, and `properties;` (`matlabParser.ts`)
- Ruby: Recognise backtick as a method name when preceded by `def `, `.`, or `::` in new `isBacktickMethodName` (`rubyParser.ts`) so `def \`(cmd) ... end` and `obj.\`(...)` no longer consume the rest of the file as a backtick string
- Ruby: Filter out `=end` and `=begin` keywords in `tokenize` (`rubyParser.ts`) so an isolated `=end` or non-line-start `=begin` no longer registers as a block close/open token
- Verilog: Reject `default` inside SystemVerilog assignment patterns (`'{default: 0}`) via new `isInsideAssignmentPattern` in `tokenize` (`verilogParser.ts`) so the case-label `default` count is no longer inflated by struct/array initializers
- Verilog: Allow newlines between the label `:` and identifier in `isPrecededByLabelColon` (`verilogValidation.ts`) so multi-line labels like `begin :\nmodule` no longer let the label name be tokenised as a block opener
- Verilog: Reject backtick directives (`` `endif ``, `` `pragma ``, `` `define ``, `` `undef ``) when adjacent to a Unicode letter in `tokenize` and `tryMatchExcludedRegion` (`verilogParser.ts`) so identifiers like `` `endifα `` are not parsed as preprocessor directives
- VHDL: Reject `package`/`architecture`/`configuration`/`procedure`/`function`/`units`/`component`/`entity` keywords inside an `attribute_specification` slot (e.g., `attribute keep of foo : package is true;`) via new `isInAttributeSpecification` in `isValidBlockOpen` (`vhdlParser.ts`) so the outer block's pair is no longer stolen by the entity_class identifier

## [1.1.36] - 2026-04-28

### Fixed

- Ada: Strip excluded regions before matching trailing `task`/`protected` in `tokenize`'s `is` filter (`adaParser.ts`) via new `stripExcludedRegions` helper, so the keywords appearing only inside a comment no longer disable the type-declaration `is` filter and produce extra `is` intermediates on the enclosing package or procedure
- Ada: Treat non-ASCII Unicode letters as word characters in `isAdaWordAt` (`adaHelpers.ts`) so identifiers using Unicode letters (e.g., `αseparate`) are no longer incorrectly word-matched against keywords like `separate`/`abstract`/`new`/`null`
- AppleScript: Remove `tell` and `repeat` from `allowedPrecedingKeywords` in `tryMatchSingleKeywordToken` (`applescriptParser.ts`) so patterns like `end tell tell ...` and `end repeat repeat ...` no longer let the trailing word qualify the next mid-line `tell`/`repeat` as a new block opener
- Bash: Detect `var=(` / `var+=(` array literal openers at the start of `isAtCommandPosition` (`bashValidation.ts`) so block keywords inside multi-line array literals (e.g., `BASH_KEYWORDS=(\n  if\n  then\n  fi\n)`) are no longer detected as command-position block tokens
- Bash: Add `isFollowedByExcludedRegion` check to the block_middle filter in `tokenize` (`bashParser.ts`) so fused words like `then"foo"` are no longer recognised as `then` middle keywords
- COBOL: Special-case `PERFORM TEST BEFORE/AFTER` in `computeValidPositions` (`cobolParser.ts`) to recognise the `WITH`-omitted structured form per the COBOL standard, so `PERFORM TEST BEFORE UNTIL ... END-PERFORM` is now correctly paired
- COBOL: Extend the preceding word boundary in `matchExecBlock` to non-ASCII Unicode letters and capture the full sublanguage identifier including digits/`_`/`-` (`cobolHelpers.ts`) so `caféEXEC SQL` and `EXEC SQL1` no longer falsely open an EXEC excluded region
- Crystal: Allow backslash line continuation (`\<LF>`/`\<CRLF>`/`\<CR>`) between `abstract` and `def` in `isValidBlockOpen`'s `abstract def` regex (`crystalParser.ts`) so abstract method declarations split across lines are no longer treated as regular `def` block openers
- Elixir: Treat only LF and CRLF as heredoc-mode markers in `matchTripleQuotedString`, `skipNestedTripleQuotedString`, `matchSigil`, and `skipNestedSigil` (`elixirHelpers.ts`) so a single embedded CR in `"""abc<CR>def"""` no longer flips the string into multi-line heredoc mode
- Fortran: Skip whitespace-only blank lines between `&` continuation and the next content line in `collapseContinuationLines` (`fortranHelpers.ts`) so `module &<blank>procedure`, `select &<blank>case`, and similar patterns no longer break the enclosing submodule/select pairing
- Fortran: Accept `;` (Fortran 2008+ statement separator) after `then` in `isValidIfOpen` (`fortranParser.ts`) so single-line constructs like `if (cond) then; y = 1; end if` are recognised as if blocks
- Fortran: Make the intermediate-line content optional in `CONTINUATION_COMPOUND_END_PATTERN` (`fortranParser.ts`) so `end &<blank-line>if` and similar compound-end continuations now match consistently with `where`/`forall`
- Julia: Pass `excludedRegions` to `isOnlyWhitespaceBetween` calls in `isInsideBrackets`/`isInsideParentheses` (`juliaParser.ts` + `juliaHelpers.ts`) so block-form `for` after a leading comment (e.g., `[# comment\nfor i in 1:10\n  i\nend]`) is no longer reclassified as a generator/comprehension
- Julia: Add `hasMatchingEndBeforeBracketClose` helper in `isInsideSquareBrackets` (`juliaParser.ts`) and keep `begin` inside indexing brackets as the firstindex keyword, so block expressions like `a[quote x = 1 end]`, `a[try ... end]`, and `a[let x = 1; x end]` are now correctly paired
- Julia: Reject `:` immediately following `<` or `>` as a symbol-literal start in `isSymbolStart` (`juliaHelpers.ts`) so `T<:Number` and `T>:Number` no longer tokenise the operand as a `:Number` symbol literal
- Octave: Skip a leading UTF-8/UTF-16 BOM (U+FEFF) when checking line-start in `isAtLineStartWithWhitespace` (`matlabParser.ts`, inherited by Octave) so block comments (`%{`/`#{`) and shell escapes at the start of BOM-prefixed files are recognised correctly
- Pascal: Detect `array [...] of` and `array packed of` patterns in `isTypeDeclarationOf` (`pascalValidation.ts`) by skipping over a bracketed dimension list and an optional `packed` modifier, so the type-declaration `of` is no longer attached as a `case` intermediate
- Pascal: Add `;` to the rejection set after `asm` in both `isValidBlockOpen` and `addAsmExcludedRegions` (`pascalParser.ts`) so empty `asm;` statements no longer consume the surrounding `begin..end` block
- Pascal: Detect `class of` as a class-reference type regardless of intervening newlines or comments in `isValidBlockOpen` and `isInsideRecord` (`pascalParser.ts` + `pascalValidation.ts`) so `class\n  of TBase` and `class { comment\n} of TBase` no longer break the surrounding `record`/`begin..end` pairing
- Pascal: Override `isValidBlockClose` for Pascal to reject `end` immediately preceded by `.` (field/property access like `Foo.End`) in `pascalParser.ts`, while still allowing the range operator `..end`
- Ruby: Treat trailing binary operators (`==`, `+`, `<`, `=`, etc.) as line-continuation markers in `endsWithContinuationOperator` (`rubyValidation.ts`) so `while a ==\n  b do\n  body\nend` and similar headers correctly attach `do` to the loop and pair with the outer `end`
- Ruby: Detect trailing whitespace after `/` to distinguish division from a new regex literal in `isRegexStart` (`rubyFamilyHelpers.ts`) so `x = /a/ / 2` is no longer parsed as two regex literals that swallow the rest of the source
- Ruby: Extend the `?\M-\C-` character literal handling in `tryMatchExcludedRegion` (`rubyParser.ts`) to cover the EOF-truncated 7-character case, so the excluded region now reaches the end of the source rather than stopping at five characters
- Verilog: Allow whitespace and comments between `#` and the digits in `isPrecededByAssertionVerb`'s `#<digits>` qualifier skip (`verilogValidation.ts`) so `assert # 5 property p1; ...` is no longer misclassified as a property declaration
- Verilog: Add `macromodule: ['extern']` to `MODIFIER_MAP` (`verilogValidation.ts`) so `extern macromodule m1();` forward declarations are no longer tokenised as block openers
- VHDL: Skip the `is` token in `tokenize` when the next non-whitespace content is `new`, `null;`, or `(` (`vhdlParser.ts`) so VHDL-2008 `function/procedure/package ... is new`, `procedure ... is null;`, and `function ... return T is (expr);` declarations no longer leak an extra `is` intermediate into the enclosing block
- VHDL: Apply the colon-prefix rejection in `isValidEntityOrConfigOpen` to `configuration` as well as `entity` (`vhdlValidation.ts`) so `inst: configuration work.cfg;` is no longer detected as a block opener

## [1.1.35] - 2026-04-19

### Fixed

- Ada: Skip Ada 2012 expression function's `is` when followed by `(` in `tokenize` so `function X ... is (expr);` declarations no longer leak an extra `is` token into the enclosing package/procedure's intermediates list
- COBOL: Skip `*>` inline comments, `>>` compiler directive lines, and fixed-format column-7 comment lines when scanning backward in `isPrecededByKeyword`/`findPrecedingKeywordPosition`/`isInPseudoTextContext` (via new `skipBackwardWhitespaceAndComments` helper), so `COPY X REPLACING *> comment\n==IF== BY ==END-IF==` correctly detects the pseudo-text context and excludes `IF`/`END-IF` inside delimiters instead of producing a phantom block pair
- Elixir: Track `{}` and `[]` depth alongside `()` depth in `hasCommaInParens` so block forms with map, list, or tuple literal conditions (e.g., `if(%{a: 1, b: 2}) do...end`, `unless([1, 2, 3]) do...end`, `case({a, b}) do _ -> :ok end`) are no longer misclassified as function-call form and correctly open a block
- Fortran: Skip construct labels (e.g., `program: if`, `block: do`) and construct names following `end <type>` (e.g., `end if program`) in `tokenize` via new `isFortranConstructLabel` and `isFortranEndConstructName` helpers, so keyword-matching identifiers in labeled constructs no longer open spurious blocks or orphan the real outer `program`/`do`/`block`
- Julia: Treat `begin` followed by `:` inside indexing brackets as the firstindex keyword (not a block opener) in `isInsideIndexingBrackets` via new `allUnmatchedBeginsAreFirstindex` helper, so `arr[begin:end]` correctly pairs the outer `function`/`end` instead of letting the inner `end` inside the brackets steal the close
- Pascal: Detect `asm` after statement-introducing reserved words (`begin`/`then`/`do`/`else`/`of`/`try`/`finally`/`except`/`repeat`/`label`) on the same line in both `isValidBlockOpen` and `addAsmExcludedRegions` so constructs like `begin if x then asm nop end; end` correctly open the assembly block instead of rejecting `asm` because the preceding keyword ends in an identifier character
- Pascal: Scan backward to the start of the statement when checking whether `=` precedes `class`/`interface`/`object` in a comparison context, so qualified identifiers (`if foo.bar = class then`), arithmetic expressions (`if a + b = class then`), and function calls (`if Foo() = class then`) no longer mis-detect the comparison as a type definition and mispair the outer `begin`/`end`
- Ruby: Remove uppercase identifiers (`BEGIN`, `END`, `__ENCODING__`, `__LINE__`, `__FILE__`) from the heredoc terminator rejection list `RUBY_KEYWORDS`, so canonical heredoc forms like `raise <<END ... END` and `puts <<END ... END` are no longer incorrectly rejected after a bare method call
- Verilog: Add `matchPragmaDirective` and wire it through `tryMatchExcludedRegionWithContext` so `` `pragma protect begin `` / `` `pragma protect end `` directives no longer tokenize their `begin`/`end` arguments as block keywords
- Verilog: Look ahead for a closing `"` before `*)` when a string inside an attribute encounters `\<LF>` in `matchAttribute`, treating it as a line continuation when a later closing quote exists and as a terminator otherwise, so valid multi-line strings like `(* attr = "a\<LF>b" *)` no longer extend the attribute region to EOF
- VHDL: Add `isValidPackageOpen` to reject VHDL-2008 package instantiations (`package X is new Y generic map(...)`) as block openers in `isValidBlockOpen`, so the outer `package` is no longer orphaned when an inner instantiation is present
- VHDL: Recognize `is new` after `function`/`procedure` in `isValidFuncProcOpen` and reject VHDL-2008 subprogram instantiations as block openers, so enclosing `architecture` blocks correctly keep their `begin` intermediate instead of having it absorbed by the instantiation

## [1.1.34] - 2026-04-15

### Fixed

- AppleScript: Restrict `else` and `else if` middle keywords to attach only to `if` blocks in `matchBlocks`, so they no longer produce spurious intermediates on unrelated parent blocks (e.g. `try`) where they appear as syntax errors
- Elixir: Skip excluded regions (strings, comments, sigils) when checking for commas inside parentheses in `hasCommaInParens`, so block forms like `if("hello, world") do...end` with string arguments containing commas are no longer rejected as function-call form
- Fortran: Skip string literals (including Fortran's doubled-quote escapes `''`/`""`) when tracking parenthesis depth in `isValidBlockOpen`'s assignment detection, so `block(")") = 5` with an unbalanced paren inside a string is correctly recognized as an assignment rather than as a block opener

## [1.1.33] - 2026-04-14

### Fixed

- AppleScript: Consume single-line (`--`) and block (`(* *)`) comments, whitespace, and additional newlines after the continuation character (`¬`) in `matchCompoundKeyword` so compound keywords like `end tell`, `using terms from`, `with timeout`, and `else if` still match when a comment appears on the line following the continuation
- Elixir: Skip incrementing `innerBlockDepth` in `hasDoKeyword` when a block keyword is used as a value (immediately followed by `do`), and reject block keyword tokenization in `isValidBlockOpen` via new `isValueForPrecedingBlockKeyword` so patterns like `if cond do`, `unless case do`, and `if cond or other do` pair the outer `if`/`unless` with `end` instead of the inner variable-named keyword
- Erlang: Recognize Erlang word operators (`div`, `rem`, `band`, `bor`, `bxor`, `bsl`, `bsr`, `not`, `and`, `or`, `xor`, `andalso`, `orelse`) preceding `catch` as expression-prefix indicators via new `CATCH_EXPR_WORD_OPERATORS` set in `isCatchExpressionPrefix`, so `try X div catch err catch _:_ -> ok end` no longer classifies the first `catch` as a clause separator and inflates the `try` block's intermediate list
- Julia: Count a leading block-form `for` as an unmatched opener in `hasUnmatchedBlockOpenerBetween` and skip it in `hasForBetween` (adding `end` pairing to track completed blocks), and add `hasUnmatchedBlockOpenerBetween` guard to `isGeneratorFilterIf`/`isComprehensionFilterInBrackets`, so `(for i in 1:3 for j in 1:3 1 end end)`, `(for ... end; if ... end)`, and `(for ... if ... end end)` correctly pair both nested and parallel block-form blocks instead of silently dropping them as generators
- Verilog: Strip leading `(* ... *)` attributes and block comments from the line prefix in `isOnDpiLine` (adding `excludedRegions` parameter) so DPI declarations like `(* pure *) import "DPI-C" function int foo();` no longer tokenize `function` as a block opener, and add `isFollowedByWord` helper plus a new check in `isValidBlockOpen` to reject `interface` when it qualifies `class` (SV-2012 `interface class` declarations close with `endclass`, so the outer `interface` block is no longer orphaned)

## [1.1.32] - 2026-04-13

### Fixed

- AppleScript: Reject mid-line `tell`/`if`/`repeat` preceded by an expression terminator (`)`, `]`, `}`, or a non-control-keyword identifier) in `tryMatchSingleKeywordToken` so occurrences like `doStuff() tell` no longer open a spurious block that consumes the enclosing handler's `end`
- COBOL: Extend `secondWord` regex in `computeValidPositions` to accept numeric-leading counts and check the third word for `TIMES` so paragraph calls with iteration counts (`PERFORM PARA-A 5 TIMES`, `PERFORM PARA-A WS-COUNT TIMES`) are no longer misclassified as block `PERFORM`, and add `after`/`before` to the rejection keyword list
- Julia: Require ` type` to follow `abstract`/`primitive` when counting depth in `hasUnmatchedBlockOpenerBetween` so `arr[abstract:end]` and `arr[primitive:end]` no longer treat the variable reference as a block opener, which previously caused `function`/`end` to pair with the `end` inside the brackets
- MATLAB: Recognize shell escape (`!cmd`) at statement start (after `;`, `,`, or line start) via new `isAtStatementStart` helper, so `x = 1; !ls if for end` correctly excludes the entire shell command instead of exposing keywords to tokenization
- Pascal: Allow `\n`/`\r` when scanning past the tag identifier in `isVariantRecordCase` (`pascalValidation.ts`) so multi-line variant records like `case Tag\n: Integer of` and `case Integer\nof` correctly suppress the inner `case` as a block opener
- Ruby: Accept bare `<<IDENT` heredoc after an identifier with whitespace (e.g., `puts <<DONE`) in `matchHeredoc` while still rejecting shift operators via a new `RUBY_KEYWORDS` set (`1 <<if`, `x << y` remain classified as shift)
- Verilog: Accept `fork` alongside `begin` as a par_block body in `scanForBeginAfterControl`, and add `chainConsumeControlKeywords` in `matchBlocks` so control keywords paired with `fork`/`join`/`join_any`/`join_none` (e.g., `initial fork...join`, `always @(posedge clk) fork...join_any`) close the preceding `initial`/`always`/`if`/etc. together with the `join*` closer

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

[1.1.65]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.64...v1.1.65
[1.1.64]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.63...v1.1.64
[1.1.63]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.62...v1.1.63
[1.1.62]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.61...v1.1.62
[1.1.61]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.60...v1.1.61
[1.1.60]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.59...v1.1.60
[1.1.59]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.58...v1.1.59
[1.1.58]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.57...v1.1.58
[1.1.57]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.56...v1.1.57
[1.1.56]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.55...v1.1.56
[1.1.55]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.54...v1.1.55
[1.1.54]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.53...v1.1.54
[1.1.53]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.52...v1.1.53
[1.1.52]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.51...v1.1.52
[1.1.51]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.50...v1.1.51
[1.1.50]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.49...v1.1.50
[1.1.49]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.48...v1.1.49
[1.1.48]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.47...v1.1.48
[1.1.47]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.46...v1.1.47
[1.1.46]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.45...v1.1.46
[1.1.45]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.44...v1.1.45
[1.1.44]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.43...v1.1.44
[1.1.43]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.42...v1.1.43
[1.1.42]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.41...v1.1.42
[1.1.41]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.40...v1.1.41
[1.1.40]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.39...v1.1.40
[1.1.39]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.38...v1.1.39
[1.1.38]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.37...v1.1.38
[1.1.37]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.36...v1.1.37
[1.1.36]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.35...v1.1.36
[1.1.35]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.34...v1.1.35
[1.1.34]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.33...v1.1.34
[1.1.33]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.32...v1.1.33
[1.1.32]: https://github.com/cadenza-tech/rainbow-blocks/compare/v1.1.31...v1.1.32
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
