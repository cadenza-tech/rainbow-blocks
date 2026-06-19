// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { buildCaseInsensitiveKeywordPattern, findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';
import type { PascalValidationCallbacks } from './pascalValidation';
import {
  buildRecordContextMap,
  COMPARISON_CONTEXT_KEYWORDS,
  CROSS_SCAN_CLOSE_KEYWORDS,
  CROSS_SCAN_OPEN_KEYWORDS,
  DECLARATION_CONTEXT_SCOPE_KEYWORDS,
  isIfThenElse,
  isInsideParens,
  isPrecededByComparisonEquals,
  isTypeDeclarationOf,
  isVariantRecordCase,
  STATEMENT_CONTEXT_SCOPE_KEYWORDS,
  TYPE_MODIFIERS
} from './pascalValidation';

export class PascalBlockParser extends BaseBlockParser {
  // Per-parse map from `case` keyword offsets to whether they sit inside a record block.
  // Built once at the start of tokenize() so variant-record-case detection is O(1) per
  // `case` rather than re-scanning the whole source each time.
  private recordContextMap: Map<number, boolean> = new Map();

  private get validationCallbacks(): PascalValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions),
      isAdjacentToUnicodeLetter: (source, startOffset, keywordLength) => this.isAdjacentToUnicodeLetter(source, startOffset, keywordLength)
    };
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'case', 'repeat', 'try', 'record', 'class', 'object', 'interface', 'asm'],
    blockClose: ['end', 'until'],
    blockMiddle: ['else', 'except', 'finally', 'of']
  };

  // Validates block open: 'interface' is only valid after '=' (type definition)
  // The unit-level 'interface' section keyword is not a block opener
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject keywords used as field-access (Foo.begin, Foo.case, Foo.try, Foo.asm, etc.)
    if (this.isPrecededByFieldDot(source, position, excludedRegions)) {
      return false;
    }
    // Reject FreePascal keyword-escape prefix (& or @ before keyword): &case is the
    // identifier `case`, not the case statement; @procedure is a procedure-pointer.
    // Also reject '$' (hex-literal prefix) and '#' (char-constant prefix) which can
    // appear immediately before a word that happens to spell a Pascal keyword.
    if (position > 0) {
      const prev = source[position - 1];
      if (prev === '&' || prev === '@' || prev === '$' || prev === '#') {
        return false;
      }
    }
    // Keyword used as left-hand-side of `:=` assignment: `try := 5;`, `record := 5;`,
    // `case := 5;`, `begin := 5;`, `repeat := 5;`. Without this guard the keyword is
    // pushed onto the stack and the surrounding `end`/`until` closes it instead of the
    // real enclosing block, leaving the outer block orphan. For `repeat`, a stray `until`
    // later in the source would otherwise pair with the spurious `repeat`. The `asm`
    // keyword already has its own forward check earlier.
    if (
      (keyword === 'try' || keyword === 'record' || keyword === 'case' || keyword === 'begin' || keyword === 'repeat') &&
      this.isFollowedByAssignment(source, position + keyword.length, excludedRegions)
    ) {
      return false;
    }

    // Keyword used as right-hand-side of `:=` assignment: `x := repeat;`, `x := begin;`,
    // `x := case;`, `x := try;`, `x := record;`. The keyword names an expression
    // identifier, not a block opener (a record type definition uses `=`, never `:=`).
    // Without this guard the keyword is pushed onto the stack and the surrounding
    // `end`/`until` closes it instead of the real enclosing block, leaving the outer
    // block orphan. For `repeat`, a stray `until` later in the source would otherwise
    // pair with the spurious `repeat`. The comparison check below does not fire for `:=`
    // because `:=` is not a comparison `=`, so this dedicated check is needed.
    if (
      (keyword === 'try' || keyword === 'record' || keyword === 'case' || keyword === 'begin' || keyword === 'repeat') &&
      this.isPrecededByAssignment(source, position, excludedRegions)
    ) {
      return false;
    }

    // Variant record case: case Tag: Type of (inside a record, no own end)
    // Also handles tagless variant: case Integer of (no colon)
    if (keyword === 'case') {
      if (isVariantRecordCase(source, position, excludedRegions, this.validationCallbacks, this.recordContextMap)) {
        return false;
      }
      // `case(x) then ...` / `case(x) do ...`: `case` is used as a function-call
      // identifier inside an expression, not as a case statement opener. A real
      // `case (expr) of` is followed by `of` after the parenthesized expression.
      // Without this guard the `case` is pushed onto the stack and the surrounding
      // `end` closes `case` instead of the enclosing block.
      if (this.isCaseUsedAsFunctionCall(source, position, excludedRegions)) {
        return false;
      }
    }

    // Generic constraint: function Bar<T: record>: T;
    // 'record' inside <> is a generic type constraint, not a block opener.
    if (keyword === 'record' && this.isInsideGenericConstraint(source, position, excludedRegions)) {
      return false;
    }

    // Field declaration: `record: Integer;` inside a record uses `record` as a field
    // name, not a nested record opener. Detect `record:` (followed by ':' that is not
    // ':=') and reject the open. A real record opener is followed by field declarations,
    // 'case', or 'end' — never an immediate ':' — so a general "`record:` is never a
    // block opener" rule is safe. Mirrors the `end:` field-declaration close guard.
    if (keyword === 'record' && this.isFollowedByColonNotAssign(source, position + keyword.length, excludedRegions)) {
      return false;
    }

    // Case label: case X of begin: Foo; end / case X of try: Foo; end
    // A keyword used as a case-label has '...of'/'...;'/'...,' before and ':' after.
    // (Excluding ':=' assignment.)
    if (
      keyword === 'begin' ||
      keyword === 'try' ||
      keyword === 'record' ||
      keyword === 'case' ||
      keyword === 'repeat' ||
      keyword === 'object' ||
      keyword === 'interface' ||
      keyword === 'class'
    ) {
      if (this.isUsedAsCaseLabel(keyword, source, position, excludedRegions)) {
        return false;
      }
    }

    // 'asm' must be at statement position (not used as identifier/field/parameter).
    if (keyword === 'asm') {
      // Reject when followed by a character that proves `asm` is an identifier rather than
      // a block opener: ':' (type annotation 'asm: Integer'), ':=' (assignment), '.'
      // (field access), '(' (function call), ',', ')', '=', ';', '[' (array indexing
      // 'asm[0]'), '<'/'>' (comparison or generic param 'asm < b' / 'asm > begin'), ']'.
      // This set must stay in sync with the forward check in addAsmExcludedRegions.
      {
        let fp = position + 3;
        while (fp < source.length) {
          if (this.isInExcludedRegion(fp, excludedRegions)) {
            const region = this.findExcludedRegionAt(fp, excludedRegions);
            if (region) {
              fp = region.end;
              continue;
            }
          }
          if (source[fp] === ' ' || source[fp] === '\t') {
            fp++;
            continue;
          }
          break;
        }
        if (fp < source.length) {
          const next = source[fp];
          if (
            next === ':' ||
            next === '.' ||
            next === ',' ||
            next === ')' ||
            next === '=' ||
            next === ';' ||
            next === '(' ||
            next === '[' ||
            next === '<' ||
            next === '>' ||
            next === ']'
          ) {
            return false;
          }
        }
      }
      // Scan backward on the same physical line; reject expression/declaration context.
      let bp = position - 1;
      while (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
        if (this.isInExcludedRegion(bp, excludedRegions)) {
          const region = this.findExcludedRegionAt(bp, excludedRegions);
          if (region) {
            bp = region.start - 1;
            continue;
          }
        }
        if (source[bp] === ' ' || source[bp] === '\t') {
          bp--;
          continue;
        }
        break;
      }
      if (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
        const prev = source[bp];
        if (prev === ';') {
          return true;
        }
        // A `:` preceding `asm` is a case-label delimiter (e.g. `case x of 1: asm ... end`)
        // when the token before `:` is a case-label-compatible value (numeric literal,
        // identifier, char constant, string literal). Without this branch, `1: asm` is
        // unconditionally treated as expression context and the asm block is missed,
        // leaving the inner `end` to mispair with the outer `case`.
        if (prev === ':' && this.isCaseLabelColon(source, bp, excludedRegions)) {
          return true;
        }
        // Expression/declaration prefixes that disqualify `asm` as a block opener.
        // `[asm]` / `arr[0] asm` (array index), `<asm>` / `a > asm` (generic param or
        // comparison), `(x) asm` (condition/expression context after a closing paren),
        // arithmetic ops are all identifier/expression contexts. The set must stay in
        // sync with the backward check in addAsmExcludedRegions.
        if (
          prev === '.' ||
          prev === ':' ||
          prev === ',' ||
          prev === '(' ||
          prev === ')' ||
          prev === '=' ||
          prev === '[' ||
          prev === ']' ||
          prev === '<' ||
          prev === '>' ||
          prev === '+' ||
          prev === '-' ||
          prev === '*' ||
          prev === '/'
        ) {
          return false;
        }
        if (/[a-zA-Z0-9_]/.test(prev)) {
          // Extract the preceding word; if it is a statement-introducing reserved
          // word (begin/then/do/else/of/try/finally/except/repeat/label),
          // 'asm' following it is a valid statement start.
          let ws = bp;
          while (ws >= 0 && /[a-zA-Z0-9_]/.test(source[ws])) {
            ws--;
          }
          const word = source.slice(ws + 1, bp + 1).toLowerCase();
          const STATEMENT_START_KEYWORDS = new Set(['begin', 'then', 'do', 'else', 'of', 'try', 'finally', 'except', 'repeat', 'label']);
          if (STATEMENT_START_KEYWORDS.has(word)) {
            return true;
          }
          return false;
        }
      }
      return true;
    }

    // Comparison-context 'record'/'try'/'case'/'begin'/'repeat': `if X = record then`
    // (and analogous forms with `try`, `case`, `begin`, `repeat`) use the keyword as a
    // comparison operand, not a block opener. Mirrors the class/object/interface
    // comparison check below. Without this guard the spurious opener is pushed onto the
    // stack and the surrounding `end`/`until` closes it instead of the real enclosing
    // block, leaving the outer block orphan. A type-definition `TFoo = record` is
    // unaffected because isPrecededByComparisonEquals only fires when the preceding `=`
    // is a comparison operator (and `try`/`case`/`begin`/`repeat` never appear in a real
    // `= keyword` type definition anyway).
    if (
      (keyword === 'record' || keyword === 'try' || keyword === 'case' || keyword === 'begin' || keyword === 'repeat') &&
      isPrecededByComparisonEquals(source, position, excludedRegions, this.validationCallbacks)
    ) {
      return false;
    }

    // 'interface', 'class', 'object' are only block opens after '=' (type definitions)
    // e.g. TMyClass = class(TObject) ... end;
    // Not: class function Create, class procedure Destroy (modifiers)
    // Not: procedure of object (method pointer syntax)
    if (keyword !== 'interface' && keyword !== 'class' && keyword !== 'object') {
      return true;
    }

    // Type declarations never appear inside parentheses. If the keyword is inside
    // unbalanced '(', it is a comparison expression like 'if (x = class)' and
    // must not be treated as a block opener.
    if (isInsideParens(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }

    // 'class of' is a class reference type, not a block.
    // Newlines and comments between `class` and `of` do not change the meaning per Pascal grammar.
    if (keyword === 'class') {
      let j = position + keyword.length;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
          j++;
          continue;
        }
        break;
      }
      if (j + 2 <= source.length && /^of\b/i.test(source.slice(j, j + 3))) {
        return false;
      }
    }

    // Forward declarations: keyword followed by ';' (e.g. class;, interface;, object;)
    // Also handles Delphi GUID bracket syntax: interface['{GUID}'];
    // Applies to class, interface, and object
    {
      let j = position + keyword.length;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          j++;
          continue;
        }
        if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r' || source[j] === '\n') {
          j++;
          continue;
        }
        break;
      }
      // Skip bracket expression [...] (Delphi GUID syntax)
      if (j < source.length && source[j] === '[') {
        let bracketDepth = 1;
        j++;
        while (j < source.length && bracketDepth > 0) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            j++;
            continue;
          }
          if (source[j] === '[') bracketDepth++;
          else if (source[j] === ']') bracketDepth--;
          j++;
        }
        // Skip whitespace and comments after ']'
        while (j < source.length) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            j++;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r' || source[j] === '\n') {
            j++;
            continue;
          }
          break;
        }
      }
      if (j < source.length && source[j] === ';') {
        return false;
      }
    }

    // Forward declaration with parent: class(TParent);, interface(IUnknown);, object(TBase);
    // Handle nested parentheses like class(TBase(TParam))
    if (keyword === 'class' || keyword === 'interface' || keyword === 'object') {
      // Skip whitespace and comments between keyword and '('
      {
        let j = position + keyword.length;
        while (j < source.length) {
          if (this.isInExcludedRegion(j, excludedRegions)) {
            j++;
            continue;
          }
          if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
            j++;
            continue;
          }
          break;
        }
        if (j < source.length && source[j] === '(') {
          let parenDepth = 1;
          j++;
          while (j < source.length && parenDepth > 0) {
            if (this.isInExcludedRegion(j, excludedRegions)) {
              j++;
              continue;
            }
            if (source[j] === '(') parenDepth++;
            else if (source[j] === ')') parenDepth--;
            j++;
          }
          // Skip whitespace and comments between ')' and ';'
          while (j < source.length) {
            if (this.isInExcludedRegion(j, excludedRegions)) {
              j++;
              continue;
            }
            if (source[j] === ' ' || source[j] === '\t' || source[j] === '\r' || source[j] === '\n') {
              j++;
              continue;
            }
            break;
          }
          if (j < source.length && source[j] === ';') {
            return false;
          }
        }
      }
    }

    // Look backward (skipping whitespace and excluded regions) for '='
    let i = position - 1;
    while (i >= 0) {
      // Skip excluded regions
      if (this.isInExcludedRegion(i, excludedRegions)) {
        i--;
        continue;
      }
      if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
        i--;
        continue;
      }
      break;
    }

    // If we found type modifier keywords (packed, sealed, abstract) before class/object/interface, scan further back for '='
    // Multiple modifiers can appear: e.g. 'packed sealed class'
    {
      let foundModifier = true;
      while (foundModifier) {
        foundModifier = false;
        for (const modifier of TYPE_MODIFIERS) {
          const len = modifier.length;
          if (i >= len - 1 && source.slice(i - len + 1, i + 1).toLowerCase() === modifier && (i < len || !/[a-zA-Z0-9_]/.test(source[i - len]))) {
            i -= len;
            while (i >= 0) {
              if (this.isInExcludedRegion(i, excludedRegions)) {
                i--;
                continue;
              }
              if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
                i--;
                continue;
              }
              break;
            }
            foundModifier = true;
            break;
          }
        }
      }
    }

    // Must be '=' but not a compound operator like ':=', '<=', '+=', '-=', '*=', '/='.
    // '>' immediately preceding '=' is normally a '>=' comparison operator and disqualifies
    // the '=' as a type-definition marker, but when the '>' is a generic close bracket
    // (i.e. it has a matching '<' on the same statement) the '=' is still a type
    // definition. Example: `TList<T>=class ... end` has no whitespace between the generic
    // close and the type-definition `=`. Distinguish these two by searching backward for a
    // matching '<'.
    if (!(i >= 0 && source[i] === '=' && (i === 0 || ![':', '<', '+', '-', '*', '/'].includes(source[i - 1])))) {
      return false;
    }
    if (i > 0 && source[i - 1] === '>' && !this.hasMatchingGenericOpen(source, i - 1, excludedRegions)) {
      return false;
    }

    // Check if '=' is in a comparison context (not a type definition)
    // e.g. 'if x = class', 'if Self.X = class', 'if a + b = class', 'while foo() = class',
    // and 'Y := X = class' (`:=` assignment makes the trailing '=' a comparison).
    // Scan backward to the start of the statement and look for any comparison-context
    // keyword along the way. Stop at statement boundaries (';' and start-of-source).
    let ci = i - 1;
    let hitSemicolon = false;
    let hitDeclarationKeyword = false;
    while (ci >= 0) {
      if (this.isInExcludedRegion(ci, excludedRegions)) {
        const region = this.findExcludedRegionAt(ci, excludedRegions);
        if (region) {
          ci = region.start - 1;
          continue;
        }
      }
      const ch = source[ci];
      if (ch === ';') {
        hitSemicolon = true;
        break;
      }
      // ':=' assignment operator: the '=' beyond it is a comparison, not a type def.
      if (ch === '=' && ci > 0 && source[ci - 1] === ':') {
        return false;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        const wordEnd = ci;
        while (ci > 0 && /[a-zA-Z0-9_]/.test(source[ci - 1])) ci--;
        // The ASCII word `ci..wordEnd` may be the tail of a larger Unicode identifier
        // (e.g. `αif` reads back to ASCII `if`). Skip such Unicode-extended identifiers
        // so they are not misclassified as comparison/declaration keywords.
        if (!this.isAdjacentToUnicodeLetter(source, ci, wordEnd + 1 - ci)) {
          const word = source.slice(ci, wordEnd + 1).toLowerCase();
          if (COMPARISON_CONTEXT_KEYWORDS.has(word)) {
            return false;
          }
          // A `type`/`var`/`const` scope keyword before the `=` (within the same
          // statement, no `;` crossed yet) confirms a declaration context. The `=`
          // is a type definition, so stop scanning and skip the cross-`;` scan.
          if (DECLARATION_CONTEXT_SCOPE_KEYWORDS.has(word)) {
            hitDeclarationKeyword = true;
            break;
          }
        }
      }
      ci--;
    }

    // If we hit ';' before finding any comparison context keyword, the immediate
    // statement boundary is ambiguous: this could be a type declaration (one of many
    // in a `type` section) or a statement inside a `begin..end`. Scan further back
    // across `;` boundaries to determine the enclosing scope. Whichever scope-introducing
    // keyword is encountered first decides the context.
    //  - statement-context keywords (begin/try/repeat/asm) => comparison
    //  - declaration-context keywords (type/var/const) => type definition
    //
    // A block that was already closed before the `=` (its `end`/`until` appears while
    // scanning backward) is NOT the enclosing scope, so its opener must be skipped.
    // Track close depth: each `end`/`until` opens a closed block, balanced by the matching
    // opener. Only an opener seen at depth 0 is the genuine enclosing scope. Mirrors the
    // matching closeDepth logic in isPrecededByComparisonEquals.
    //
    // To keep the scan O(1) amortized on long type sections (without this guard each
    // `T_k = class end;` validation walks back O(k) chars to find `type`, producing
    // O(N^2) overall), early-terminate once we have crossed several `;` boundaries with
    // closeDepth=0 and no statement-context keyword in sight. A run of `;`-separated
    // chunks at top level overwhelmingly indicates a declaration section; a statement
    // list inside `begin..end` would surface a `begin`/`try`/`repeat`/`asm` keyword much
    // sooner.
    if (hitSemicolon && !hitDeclarationKeyword) {
      let si = ci - 1;
      let closeDepth = 0;
      let semicolonsCrossed = 0;
      const SEMICOLON_BUDGET = 3;
      while (si >= 0) {
        if (this.isInExcludedRegion(si, excludedRegions)) {
          const region = this.findExcludedRegionAt(si, excludedRegions);
          if (region) {
            si = region.start - 1;
            continue;
          }
        }
        const ch = source[si];
        if (ch === ';' && closeDepth === 0) {
          semicolonsCrossed++;
          if (semicolonsCrossed >= SEMICOLON_BUDGET) {
            // Several consecutive declaration-like chunks crossed without surfacing a
            // statement-context keyword: this is a declaration section, not a statement
            // list. Treat the `=` as a type-definition marker.
            break;
          }
        }
        // `:=` assignment at depth 0 proves statement context: only statements (not
        // declarations) use the assignment operator. Without this guard a `begin..end`
        // body with several `x := y;` statements followed by a malformed `T = class`
        // exhausts the SEMICOLON_BUDGET before reaching `begin`, and the `class` is
        // pushed as a spurious block opener that the surrounding `end` closes instead
        // of the real `begin`.
        if (ch === '=' && si > 0 && source[si - 1] === ':' && closeDepth === 0) {
          return false;
        }
        if (/[a-zA-Z_]/.test(ch)) {
          const wordEnd = si;
          while (si > 0 && /[a-zA-Z0-9_]/.test(source[si - 1])) si--;
          // Same Unicode-adjacency guard as the inner scan; without it, `αbegin` etc.
          // would resolve to ASCII `begin` and force the wrong scope decision.
          if (!this.isAdjacentToUnicodeLetter(source, si, wordEnd + 1 - si)) {
            const word = source.slice(si, wordEnd + 1).toLowerCase();
            if (CROSS_SCAN_CLOSE_KEYWORDS.has(word)) {
              closeDepth++;
            } else if (CROSS_SCAN_OPEN_KEYWORDS.has(word) && closeDepth > 0) {
              // Opener of an already-closed block: balance the close and keep scanning.
              closeDepth--;
            } else if (closeDepth === 0 && STATEMENT_CONTEXT_SCOPE_KEYWORDS.has(word)) {
              return false;
            } else if (closeDepth === 0 && DECLARATION_CONTEXT_SCOPE_KEYWORDS.has(word)) {
              break;
            }
          }
        }
        si--;
      }
    }

    return true;
  }

  // Reject any close keyword (end/until) immediately after `.` (field/property access),
  // `@` (address-of operator like `@end`), `&` (FreePascal escaped-keyword identifier),
  // `$` (hex-literal prefix like `$end`), `#` (character-constant prefix like `#end`),
  // or `..` (range operator like `array[0..end]`). Also reject `until` used as a
  // case-label inside `case ... of`.
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByFieldDot(source, position, excludedRegions)) return false;
    if (position > 0) {
      const prev = source[position - 1];
      if (prev === '@' || prev === '&' || prev === '$' || prev === '#') return false;
    }
    // Reject `..end` / `..until`: the `..` range operator (e.g. `array[0..end]`) treats
    // the following token as an expression value, not a block-close keyword. Without
    // this guard the inner `end` closes the surrounding `begin`, leaving the outer
    // procedure-body `end;` orphan.
    if (position >= 2 && source[position - 1] === '.' && source[position - 2] === '.') {
      return false;
    }
    // Case label: `case X of until: foo;` / `case X of end: foo;` —
    // the close keyword belongs to the case label expression, not a block close.
    // Without this check, the inner `until` consumes the outer `repeat` and breaks
    // repeat-until pairing; the inner `end` closes the case block prematurely.
    if ((keyword === 'until' || keyword === 'end') && this.isUsedAsCaseLabel(keyword, source, position, excludedRegions)) {
      return false;
    }
    // Case label statement position: `case X of 1: until X;` / `case X of 1: end X;`
    // — the close keyword sits at the statement position right after a case-label colon.
    // Neither `until` nor `end` is a valid Pascal statement starter, so this is malformed
    // code; per the project's "prefer uncolored over wrong coloring" policy, the keyword
    // must not be treated as a block-close. Without this guard the inner `until` pops the
    // surrounding `repeat`, leaving the outer `until` orphan; the inner `end` closes the
    // enclosing `case` prematurely. Mirrors the matching branch in `isValidBlockOpen`
    // (line ~204) where `1: asm` is accepted as a block opener.
    if (keyword === 'until' || keyword === 'end') {
      const bp = this.skipBackwardWhitespace(source, position - 1, excludedRegions);
      if (bp >= 0 && source[bp] === ':' && this.isCaseLabelColon(source, bp, excludedRegions)) {
        return false;
      }
    }
    // Field declaration: `end: Integer;` inside a record uses `end` as a field name,
    // not the block-close keyword. Detect `end:` (followed by ':' that is not ':=')
    // and reject the close. The case-label check above only matches when the backward
    // token is `of`/`;`/`,`; a record-body field declaration is reached via a newline
    // after the prior field declaration (or right after `record`), so it does not
    // satisfy the case-label backward boundary. A general "`end:` is never a block
    // close" rule is safe because Pascal grammar has no construct where the block-close
    // `end` is immediately followed by a `:`.
    if (keyword === 'end' && this.isFollowedByColonNotAssign(source, position + 3, excludedRegions)) {
      return false;
    }
    return true;
  }

  // Returns true when the `case` keyword at `position` is used as a function-call
  // identifier inside an expression (e.g. `if case(x) then ...`). The check forwards
  // past whitespace/comments to the first significant character: if it is not `(`,
  // the keyword is not a function call. Otherwise the balanced `(...)` group is
  // skipped and the next significant character is inspected: if it is `of`, the
  // keyword is a real `case (expr) of` statement; anything else (`then`, `do`,
  // `;`, etc.) means the keyword is the identifier in a function call.
  private isCaseUsedAsFunctionCall(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Skip whitespace and excluded regions after `case`.
    let j = position + 4;
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    if (j >= source.length || source[j] !== '(') return false;
    // Skip the balanced `(...)` group.
    let depth = 1;
    j++;
    while (j < source.length && depth > 0) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === '(') depth++;
      else if (source[j] === ')') depth--;
      j++;
    }
    // Skip whitespace/comments after the `)` and inspect the next token.
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    // `case (expr) of` is the legitimate statement; anything else means `case`
    // names an identifier in a function call.
    if (j + 1 < source.length && /^of\b/i.test(source.slice(j, j + 3))) {
      return false;
    }
    return true;
  }

  // Returns true when the first non-whitespace, non-comment characters at or after `from`
  // form a `:=` assignment operator. Used to detect a keyword used as the left-hand-side
  // of an assignment (e.g. `try := 5`, `case := 5`) where the keyword names a variable
  // identifier rather than opening a block.
  private isFollowedByAssignment(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = from;
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    return j + 1 < source.length && source[j] === ':' && source[j + 1] === '=';
  }

  // Returns true when the keyword at `position` is immediately preceded (past whitespace,
  // newlines, and excluded regions) by a `:=` assignment operator. Used to detect a
  // keyword used as the right-hand-side of an assignment (e.g. `x := record`) where the
  // keyword names an expression identifier rather than opening a block.
  private isPrecededByAssignment(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const i = this.skipBackwardWhitespace(source, position - 1, excludedRegions);
    // `:=` ends with `=` preceded by `:`.
    return i >= 1 && source[i] === '=' && source[i - 1] === ':';
  }

  // Returns true when the first non-whitespace, non-comment character at or after `from`
  // is a `:` that is not part of a `:=` assignment operator. Used to detect `end:` field
  // declarations and `case:` labels where the keyword names a record field rather than a
  // block boundary.
  private isFollowedByColonNotAssign(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = from;
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    if (j >= source.length || source[j] !== ':') return false;
    // `:=` is the assignment operator, not a field/label colon
    if (j + 1 < source.length && source[j + 1] === '=') return false;
    return true;
  }

  // Returns true when the keyword at `position` is used as a case-label rather than a
  // block opener. Case labels look like `of begin:`, `; try:`, `, record:`, or
  // `; Foo = object:` (a constant-equality style label).
  // The check requires:
  //  (1) the next non-whitespace character after the keyword is ':' (and not ':=' assign),
  //  (2) walking backward past an optional `= identifier`, the next token must be `of`,
  //      `;`, or `,` (case-label boundary).
  private isUsedAsCaseLabel(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // (1) Forward check: must be followed by ':' (not ':=')
    let fp = position + keyword.length;
    while (fp < source.length) {
      if (this.isInExcludedRegion(fp, excludedRegions)) {
        const region = this.findExcludedRegionAt(fp, excludedRegions);
        if (region) {
          fp = region.end;
          continue;
        }
      }
      if (source[fp] === ' ' || source[fp] === '\t' || source[fp] === '\n' || source[fp] === '\r') {
        fp++;
        continue;
      }
      break;
    }
    if (fp >= source.length || source[fp] !== ':') return false;
    // ':=' is assignment, not a case-label colon
    if (fp + 1 < source.length && source[fp + 1] === '=') return false;

    // (2) Backward check: previous non-whitespace, non-comment token must be 'of', ';',
    //     or ','. If it is `=` (constant-equality case label like `Foo = object:`),
    //     also accept and skip past the preceding identifier before re-checking.
    let bp = this.skipBackwardWhitespace(source, position - 1, excludedRegions);
    if (bp < 0) return false;

    // Handle `Foo = keyword:` pattern: skip back over `=` and the preceding identifier.
    // Reject `:=` (assignment), `>=`/`<=` (comparison), `+=`/`-=`/`*=`/`/=` (compound assigns).
    if (source[bp] === '=' && (bp === 0 || ![':', '>', '<', '+', '-', '*', '/', '='].includes(source[bp - 1]))) {
      // Skip past the '=' and any whitespace/comments
      let ip = this.skipBackwardWhitespace(source, bp - 1, excludedRegions);
      // Skip past the left-hand side: a (possibly qualified) identifier such as the `Z` in
      // `Z = object:` or the `A.B` in `A.B = object:`. Walk back over each identifier segment,
      // then over a `.` qualifier separator (skipping whitespace/comments around it), and
      // repeat. A `..` range operator is not a qualifier, so stop if the dot is doubled.
      while (ip >= 0 && /[a-zA-Z0-9_]/.test(source[ip])) {
        while (ip >= 0 && /[a-zA-Z0-9_]/.test(source[ip])) ip--;
        const dotPos = this.skipBackwardWhitespace(source, ip, excludedRegions);
        if (dotPos < 0 || source[dotPos] !== '.' || (dotPos > 0 && source[dotPos - 1] === '.')) {
          ip = dotPos;
          break;
        }
        ip = this.skipBackwardWhitespace(source, dotPos - 1, excludedRegions);
      }
      bp = this.skipBackwardWhitespace(source, ip, excludedRegions);
      if (bp < 0) return false;
    }

    const prev = source[bp];
    if (prev === ';' || prev === ',') return true;
    // A `:` immediately preceding the keyword is a case-label delimiter when the token
    // before the `:` is a case-label-compatible value (numeric literal, identifier,
    // char constant, string literal). Example: `case X of 1: until: foo;` — the inner
    // `until` sits in the value position of the label `1:` and must not be treated as
    // a block-close keyword. Without this branch the inner `until` consumes the
    // surrounding `repeat`, leaving the outer `until done` orphan.
    if (prev === ':' && this.isCaseLabelColon(source, bp, excludedRegions)) return true;
    // Check for 'of' (word ending at bp)
    if (/[a-zA-Z]/.test(prev)) {
      let ws = bp;
      while (ws >= 0 && /[a-zA-Z0-9_]/.test(source[ws])) ws--;
      const word = source.slice(ws + 1, bp + 1).toLowerCase();
      if (word === 'of') return true;
    }
    return false;
  }

  // Returns true when the `:` at `colonPos` is a case-label delimiter (e.g. `1: asm`,
  // `Red: asm`, `'a': asm`). A case-label colon is preceded by a case-label-compatible
  // value: numeric literal (digit-ending), identifier (letter/underscore-ending), or
  // string/char constant (closing quote of an excluded region). Other prefixes (`)`,
  // `]`, operators, `;`, `,`, etc.) indicate expression/declaration context and are not
  // treated as case-label colons here. Whitespace immediately before the `:` is skipped
  // but excluded regions (strings, comments) are not crossed -- landing inside one
  // signals a string/char literal terminator.
  private isCaseLabelColon(source: string, colonPos: number, excludedRegions: ExcludedRegion[]): boolean {
    let bp = colonPos - 1;
    while (bp >= 0 && (source[bp] === ' ' || source[bp] === '\t' || source[bp] === '\n' || source[bp] === '\r')) {
      bp--;
    }
    if (bp < 0) {
      return false;
    }
    // Landing inside an excluded region means the previous token is a string/char
    // literal (`'...'`/`"..."`); the closing quote is included in the region span.
    if (this.isInExcludedRegion(bp, excludedRegions)) {
      return true;
    }
    const prev = source[bp];
    // Numeric literal end (`1`, `$FF`, `1..5`, `Red`+digit suffix) or identifier end
    // (letters/underscore). These are the syntactic categories of Pascal case labels.
    return /[0-9a-zA-Z_]/.test(prev);
  }

  // Skip backward over whitespace and excluded regions starting from `start` (inclusive);
  // returns the index of the first non-whitespace, non-comment character, or -1 if none.
  private skipBackwardWhitespace(source: string, start: number, excludedRegions: ExcludedRegion[]): number {
    let bp = start;
    while (bp >= 0) {
      if (this.isInExcludedRegion(bp, excludedRegions)) {
        const region = this.findExcludedRegionAt(bp, excludedRegions);
        if (region) {
          bp = region.start - 1;
          continue;
        }
      }
      if (source[bp] === ' ' || source[bp] === '\t' || source[bp] === '\n' || source[bp] === '\r') {
        bp--;
        continue;
      }
      break;
    }
    return bp;
  }

  // Returns true when the position is inside a generic constraint angle bracket, e.g.
  // `function Bar<T: record>: T;`. Scans backward from the position for a candidate
  // unbalanced '<', then forward-validates that the '<' has a matching '>' enclosing the
  // position. The scan respects excluded regions and balances nested '< >' brackets.
  // '>=' / '<=' / '>>' / '<<' are skipped to avoid mistaking comparison/shift operators
  // for generic brackets. ';' inside generics is a parameter separator (e.g.
  // `<T1; T2: record>`), not a statement boundary, so the backward scan skips it.
  //
  // Forward-validation distinguishes a real generic clause from a bare comparison '<' in
  // a prior statement: a comparison like `const C = 1 < 2;` has no matching '>' after the
  // position, so the candidate is rejected and the keyword is treated as a block opener.
  //
  // The '<' (prior comparison) / '>' (record body comparison) pair in
  //   `x := a < b; type TR = record const K = 1 > 0; end;`
  // is lexically indistinguishable from `<...; ...: record>` by the angle-bracket scan
  // alone (the prior '<' and the body '>' enclose the 'record'). To reject it, first
  // require that 'record' is the final element of a constraint: in a generic clause the
  // keyword is immediately followed (past whitespace/comments) by a constraint terminator
  // '>' (clause end), ';' (next type parameter), or ',' (next constraint). A block-opener
  // 'record' is instead followed by a field declaration, 'case', 'end', etc.
  private isInsideGenericConstraint(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (!this.isFollowedByGenericConstraintTerminator(source, position + 'record'.length, excludedRegions)) {
      return false;
    }
    let depth = 0;
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '>') {
        // Skip '>=' (comparison) and '>>' (shift)
        if (i > 0 && (source[i - 1] === '<' || source[i - 1] === '=' || source[i - 1] === '>')) {
          i -= 2;
          continue;
        }
        depth++;
      } else if (ch === '<') {
        // Skip '<=' (comparison) and '<<' (shift)
        if (i + 1 < source.length && (source[i + 1] === '=' || source[i + 1] === '<')) {
          i--;
          continue;
        }
        if (depth === 0) {
          // Candidate opening '<' found. Confirm it closes with a matching '>' that
          // appears after the position. A bare comparison '<' has no such match.
          return this.hasMatchingGenericClose(source, i, position, excludedRegions);
        }
        depth--;
      }
      i--;
    }
    return false;
  }

  // Backward-validates a candidate generic closing '>' at closePos: scans backward
  // balancing nested '< >' and returns true when a matching '<' is found before any
  // statement boundary. Skips '<=' / '>=' comparison operators and excluded regions.
  // Stops at ';' (statement boundary) so an unrelated earlier '<' in a previous
  // statement is not mistaken for the generic open.
  //
  // Used to disambiguate `TList<T>=class` (where the '>' immediately preceding '=' is a
  // generic close) from `if x >= class then` (where the '>' has no matching '<' and is
  // therefore a comparison operator). Without this check, the `>` prefix on `=` was
  // rejected unconditionally and `class` after `>=` was never detected as a block
  // opener, even when '>' was a legitimate generic close.
  private hasMatchingGenericOpen(source: string, closePos: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 1;
    let i = closePos - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ';') {
        // Statement boundary: an earlier '<' belongs to a different statement.
        return false;
      }
      if (ch === '>') {
        // Skip '>=' comparison; treat '>>' as two independent generic closes.
        if (i > 0 && source[i - 1] === '=') {
          i -= 2;
          continue;
        }
        depth++;
      } else if (ch === '<') {
        // Skip '<=' comparison; treat '<<' as two independent generic opens.
        if (i + 1 < source.length && source[i + 1] === '=') {
          i--;
          continue;
        }
        depth--;
        if (depth === 0) {
          return true;
        }
      }
      i--;
    }
    return false;
  }

  // Forward-validates a candidate generic opening '<' at openPos: scans forward balancing
  // nested '< >' and returns true only when the matching '>' is found at or after
  // enclosePos. Skips '>=' / '<=' comparison operators and excluded regions.
  //
  // Importantly, '>>' is NOT skipped as a shift operator here: inside generic context the
  // two characters are independent generic-close brackets (the Java/C++/C# `Map<List<X>>`
  // convention), and skipping them as a unit prevents the outer '<' from finding its
  // matching '>'. The next iteration naturally processes the second '>' as another
  // generic close. Likewise '<<' is not skipped on the open side. Bare comparison '<' in
  // a prior statement still rejects safely because its forward scan finds no matching '>'
  // at or after the keyword being validated.
  private hasMatchingGenericClose(source: string, openPos: number, enclosePos: number, excludedRegions: ExcludedRegion[]): boolean {
    let depth = 1;
    let i = openPos + 1;
    while (i < source.length) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.end;
          continue;
        }
      }
      const ch = source[i];
      if (ch === '<') {
        // Skip '<=' comparison; treat '<<' as two independent generic opens.
        if (i + 1 < source.length && source[i + 1] === '=') {
          i += 2;
          continue;
        }
        depth++;
      } else if (ch === '>') {
        // Skip '>=' comparison; treat '>>' as two independent generic closes.
        if (i + 1 < source.length && source[i + 1] === '=') {
          i += 2;
          continue;
        }
        depth--;
        if (depth === 0) {
          // The matching '>' must be at or after the keyword being validated.
          return i >= enclosePos;
        }
      }
      i++;
    }
    return false;
  }

  // Returns true when the first non-whitespace, non-comment character at or after `from`
  // is a generic-constraint terminator: '>' (end of the generic clause), ';' (next type
  // parameter), or ',' (next constraint on the same parameter). Used to confirm that a
  // 'record' keyword sits at the tail of a generic constraint (`<T: record>`,
  // `<T: record; U>`, `<T: record, U>`) rather than opening a record block (whose first
  // following token is a field declaration, 'case', 'end', etc.).
  private isFollowedByGenericConstraintTerminator(source: string, from: number, excludedRegions: ExcludedRegion[]): boolean {
    let j = from;
    while (j < source.length) {
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.end;
          continue;
        }
      }
      if (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r') {
        j++;
        continue;
      }
      break;
    }
    if (j >= source.length) {
      return false;
    }
    const ch = source[j];
    return ch === '>' || ch === ';' || ch === ',';
  }

  // Returns true when the position is preceded by `.` field-access dot, distinguishing
  // it from the `..` range operator (which is not field access). Also skips newlines so
  // multi-line member access like `Foo.\n  End` is recognised as a field access.
  private isPrecededByFieldDot(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      if (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i >= 0 && source[i] === '.') {
      // Distinguish field access (`Foo.End`) from a range operator (`..end`)
      if (i === 0 || source[i - 1] !== '.') {
        return true;
      }
    }
    return false;
  }

  // Extends base to add ASM block excluded regions
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions = super.findExcludedRegions(source);
    this.addAsmExcludedRegions(source, regions);
    return regions;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: // to end of line
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      return this.matchSingleLineComment(source, pos);
    }

    // Brace comment: { }
    if (char === '{') {
      return this.matchBraceComment(source, pos);
    }

    // Paren-star comment: (* *)
    if (char === '(' && pos + 1 < source.length && source[pos + 1] === '*') {
      return this.matchParenStarComment(source, pos);
    }

    // Single-quoted string with Pascal escaping ('')
    if (char === "'") {
      return this.matchPascalString(source, pos, "'");
    }

    // Double-quoted string (FreePascal) with Pascal escaping ("")
    if (char === '"') {
      return this.matchPascalString(source, pos, '"');
    }

    return null;
  }

  // Exclude the interior of asm...end blocks so assembly labels (begin:, case:) are not treated as keywords
  private addAsmExcludedRegions(source: string, regions: ExcludedRegion[]): void {
    const asmPattern = /\basm\b/gi;
    const asmRegions: ExcludedRegion[] = [];

    for (let match = asmPattern.exec(source); match !== null; match = asmPattern.exec(source)) {
      const asmStart = match.index;

      // Skip asm found inside existing excluded regions
      if (this.isInExcludedRegion(asmStart, regions)) {
        continue;
      }

      // Skip when adjacent to Unicode letters (e.g., αasm is an identifier, not a keyword).
      if (this.isAdjacentToUnicodeLetter(source, asmStart, 3)) {
        continue;
      }

      // Skip asm used as an identifier (variable, field, parameter, etc.).
      // Forward check: reject when followed by ':' (type annotation like 'asm: Integer'),
      // ':=' (assignment), '.', ',', ')', '=', ';', '(' (function call), '[' (array
      // indexing 'asm[0]'), '<'/'>' (comparison or generic param 'asm < b' / 'asm > x'),
      // or ']'. This set must stay in sync with the forward check in isValidBlockOpen.
      // Skip excluded regions (comments) and whitespace consistent with isValidBlockOpen.
      {
        let fp = asmStart + 3;
        while (fp < source.length) {
          if (this.isInExcludedRegion(fp, regions)) {
            const region = this.findExcludedRegionAt(fp, regions);
            if (region) {
              fp = region.end;
              continue;
            }
          }
          if (source[fp] === ' ' || source[fp] === '\t') {
            fp++;
            continue;
          }
          break;
        }
        if (fp < source.length) {
          const next = source[fp];
          if (
            next === ':' ||
            next === '.' ||
            next === ',' ||
            next === ')' ||
            next === '=' ||
            next === ';' ||
            next === '(' ||
            next === '[' ||
            next === '<' ||
            next === '>' ||
            next === ']'
          ) {
            continue;
          }
        }
      }
      // Backward check on the same physical line: reject expression/declaration context.
      {
        let bp = asmStart - 1;
        while (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
          if (this.isInExcludedRegion(bp, regions)) {
            const region = this.findExcludedRegionAt(bp, regions);
            if (region) {
              bp = region.start - 1;
              continue;
            }
          }
          if (source[bp] === ' ' || source[bp] === '\t') {
            bp--;
            continue;
          }
          break;
        }
        if (bp >= 0 && source[bp] !== '\n' && source[bp] !== '\r') {
          const prev = source[bp];
          if (prev !== ';') {
            // A `:` preceding `asm` is a case-label delimiter (e.g. `case x of 1: asm`)
            // when the token before `:` is a case-label-compatible value (numeric
            // literal, identifier, char constant, string literal). In that case the
            // asm block opens here and its body must be added as an excluded region;
            // skipping it would leave the asm body keywords (`mov`, `case`, etc.)
            // tokenised as Pascal keywords and corrupt the BlockPair set. This must
            // stay in sync with the corresponding branch in isValidBlockOpen.
            if (prev === ':' && this.isCaseLabelColon(source, bp, regions)) {
              // Fall through to the asm-body scan below.
            } else if (
              prev === '.' ||
              prev === ':' ||
              prev === ',' ||
              prev === '(' ||
              prev === ')' ||
              prev === '=' ||
              prev === '@' ||
              prev === '&' ||
              prev === '$' ||
              prev === '#' ||
              prev === '<' ||
              prev === '[' ||
              prev === '+' ||
              prev === '-' ||
              prev === '*' ||
              prev === '/'
            ) {
              // @asm = address-of, &asm = identifier-escape, <asm> = generic param,
              // [asm] = array indexing, (x) asm = condition/expression context after a
              // closing paren, +/-/*/asm = arithmetic, $asm = hex-literal prefix,
              // #asm = char-constant prefix. None of these can introduce an asm block;
              // treat them as non-statement context. The set must stay in sync with the
              // backward check in isValidBlockOpen.
              continue;
            } else if (/[a-zA-Z0-9_]/.test(prev)) {
              let ws = bp;
              while (ws >= 0 && /[a-zA-Z0-9_]/.test(source[ws])) {
                ws--;
              }
              const word = source.slice(ws + 1, bp + 1).toLowerCase();
              const STATEMENT_START_KEYWORDS = new Set(['begin', 'then', 'do', 'else', 'of', 'try', 'finally', 'except', 'repeat', 'label']);
              if (!STATEMENT_START_KEYWORDS.has(word)) {
                continue;
              }
            }
          }
        }
      }

      // Search for matching 'end' after asm
      const contentStart = asmStart + 3;
      const endPattern = /\bend\b/gi;
      endPattern.lastIndex = contentStart;

      let foundEnd = false;

      for (let endMatch = endPattern.exec(source); endMatch !== null; endMatch = endPattern.exec(source)) {
        const endPos = endMatch.index;

        // Skip end inside existing excluded regions
        if (this.isInExcludedRegion(endPos, regions)) {
          continue;
        }

        // Skip end preceded by `.` (field access like `foo.end` inside asm body),
        // `@` (asm local label `@end`), `$` (hex-literal prefix `$end`), `#`
        // (char-constant prefix `#end`), or `&` (FreePascal identifier-escape `&end`).
        // Must stay in sync with the reject set in isValidBlockClose: a prefix that
        // disqualifies an `end` token as a block-close keyword must also disqualify it
        // as the asm-body terminator. Without this, a prefixed `end` inside the asm
        // body is taken as the asm-closing `end`, the real asm closing `end` is left
        // dangling, and a spurious case/end pair appears with the wrong outer block.
        if (endPos > 0) {
          const prev = source[endPos - 1];
          if (prev === '.' || prev === '@' || prev === '$' || prev === '#' || prev === '&') {
            continue;
          }
        }

        // Skip end preceded by `;` on the same line. In asm bodies (Intel/AT&T syntax),
        // `;` introduces a line comment, so an `end` keyword after `;` on the same line
        // is comment text and must not terminate the asm body.
        // Important: skip positions inside Pascal excluded regions (brace comments, paren-star
        // comments, strings) — a `;` inside such a region is not an asm-style line comment.
        // Exception: an `end` on the same physical line as the `asm` keyword closes the
        // block even when a `;` precedes it. For a single-line `asm ... ; end`, applying
        // the `;`-line-comment rule would skip the closing `end` and keep skipping every
        // subsequent `end` whose line carries a `;` (statement separators of valid Pascal
        // code), swallowing the following blocks into the asm region.
        const endOnAsmLine = !this.hasLineBreakBetween(source, asmStart, endPos);
        if (!endOnAsmLine) {
          let k = endPos - 1;
          let foundSemi = false;
          while (k >= contentStart && source[k] !== '\n' && source[k] !== '\r') {
            if (this.isInExcludedRegion(k, regions)) {
              const r = this.findExcludedRegionAt(k, regions);
              if (r) {
                k = r.start - 1;
                continue;
              }
            }
            if (source[k] === ';') {
              foundSemi = true;
              break;
            }
            k--;
          }
          if (foundSemi) {
            continue;
          }
        }

        // Skip end: (assembly label) - check if followed by colon
        // Skip whitespace and excluded regions (comments) between 'end' and ':'
        let checkPos = endPos + 3;
        while (checkPos < source.length) {
          if (this.isInExcludedRegion(checkPos, regions)) {
            checkPos++;
            continue;
          }
          if (source[checkPos] === ' ' || source[checkPos] === '\t') {
            checkPos++;
            continue;
          }
          break;
        }
        if (checkPos < source.length && source[checkPos] === ':') {
          continue;
        }

        // This is the real closing 'end' - exclude from asm keyword end to end keyword start
        asmRegions.push({ start: contentStart, end: endPos });
        // Advance the outer asm scanner past this end so `asm` words inside the
        // just-confirmed asm body do not produce overlapping/duplicate regions
        asmPattern.lastIndex = endPos + 3;
        foundEnd = true;
        break;
      }

      // Unterminated asm - exclude to end of source and stop scanning
      if (!foundEnd) {
        asmRegions.push({ start: contentStart, end: source.length });
        asmPattern.lastIndex = source.length;
      }
    }

    // Merge asm regions into the main regions array
    // Remove inner regions that overlap with asm body to prevent binary search failure
    if (asmRegions.length > 0) {
      for (const asmRegion of asmRegions) {
        for (let ri = regions.length - 1; ri >= 0; ri--) {
          if (regions[ri].start >= asmRegion.start && regions[ri].end <= asmRegion.end) {
            regions.splice(ri, 1);
          }
        }
      }
      regions.push(...asmRegions);
      regions.sort((a, b) => a.start - b.start);
    }
  }

  // Returns true when a CR or LF appears in source between `start` (inclusive) and
  // `end` (exclusive). Used to test whether two offsets sit on the same physical line.
  private hasLineBreakBetween(source: string, start: number, end: number): boolean {
    for (let i = start; i < end; i++) {
      if (source[i] === '\n' || source[i] === '\r') {
        return true;
      }
    }
    return false;
  }

  // Matches brace comment: { ... }
  private matchBraceComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '}') {
        return { start: pos, end: i + 1 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches paren-star comment: (* ... *)
  private matchParenStarComment(source: string, pos: number): ExcludedRegion {
    let i = pos + 2;

    while (i < source.length) {
      if (source[i] === '*' && i + 1 < source.length && source[i + 1] === ')') {
        return { start: pos, end: i + 2 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Override tokenize to handle case-insensitivity (Pascal is case-insensitive)
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // Build the record-context map once per parse so each `case` keyword can resolve
    // "inside a record" in O(1) instead of an O(N) backward scan.
    this.recordContextMap = buildRecordContextMap(source, excludedRegions, this.validationCallbacks);

    const tokens: Token[] = [];
    const keywordPattern = buildCaseInsensitiveKeywordPattern(this.keywords);

    const newlinePositions = this.buildNewlinePositions(source);

    for (const match of source.matchAll(keywordPattern)) {
      const startOffset = match.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      // Normalize to lowercase for type lookup
      const keyword = match[1].toLowerCase();

      // JavaScript \b only handles ASCII word boundaries, so check for adjacent Unicode letters
      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = this.getTokenType(keyword);

      // Validate block open keywords
      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Validate block close keywords
      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Reject block_middle keywords (of/else/except/finally) used as field-access dot
      if (type === 'block_middle' && this.isPrecededByFieldDot(source, startOffset, excludedRegions)) {
        continue;
      }

      // Reject block_middle keywords with FreePascal keyword-escape prefix (& or @),
      // or hex-literal prefix ($) / character-constant prefix (#). This mirrors the
      // open/close keyword rejection logic to keep behavior consistent across
      // block_open, block_close, and block_middle keywords.
      if (type === 'block_middle' && startOffset > 0) {
        const prev = source[startOffset - 1];
        if (prev === '&' || prev === '@' || prev === '$' || prev === '#') {
          continue;
        }
      }

      // Filter 'else' from if-then-else (not a case/try intermediate)
      if (type === 'block_middle' && keyword === 'else') {
        if (isIfThenElse(source, startOffset, excludedRegions, this.validationCallbacks)) {
          continue;
        }
      }

      // Filter 'of' from type declarations (array of, set of, file of)
      if (type === 'block_middle' && keyword === 'of') {
        if (isTypeDeclarationOf(source, startOffset, excludedRegions, this.validationCallbacks)) {
          continue;
        }
      }

      // Filter 'of' used as a case label, e.g. `case X of\n  of: foo;`. A label-position
      // 'of' is preceded by 'of'/';'/',' and followed by ':' (and not ':=' assign). The
      // legitimate 'of' immediately following `case X` is not followed by ':' so it
      // is unaffected by this check.
      if (type === 'block_middle' && keyword === 'of' && this.isUsedAsCaseLabel(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      const { line, column } = this.getLineAndColumn(startOffset, newlinePositions);

      tokens.push({
        type,
        value: keyword,
        startOffset,
        endOffset: startOffset + keyword.length,
        line,
        column
      });
    }

    return tokens;
  }

  // Matches Pascal string with '' escape (not backslash)
  private matchPascalString(source: string, pos: number, quote: string): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === quote) {
        // Check for doubled quote (escape)
        if (i + 1 < source.length && source[i + 1] === quote) {
          i += 2;
          continue;
        }
        return { start: pos, end: i + 1 };
      }
      // Pascal strings cannot span multiple lines
      if (source[i] === '\n' || source[i] === '\r') {
        return { start: pos, end: i };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }

  // Matches blocks with special handling: until only closes repeat, end closes others
  protected matchBlocks(tokens: Token[]): BlockPair[] {
    const pairs: BlockPair[] = [];
    const stack: OpenBlock[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'block_open':
          stack.push({ token, intermediates: [] });
          break;

        case 'block_middle':
          if (stack.length > 0) {
            const topValue = stack[stack.length - 1].token.value.toLowerCase();
            const middleValue = token.value.toLowerCase();
            // 'of' only applies to 'case' blocks
            if (middleValue === 'of' && topValue !== 'case') break;
            // 'except' and 'finally' only apply to 'try' blocks
            if ((middleValue === 'except' || middleValue === 'finally') && topValue !== 'try') break;
            // 'else' applies to 'case' and 'try' blocks (if/else is not block-level in Pascal)
            if (middleValue === 'else' && topValue !== 'case' && topValue !== 'try') break;
            // try block: reject duplicate finally/except and the mutually exclusive
            // finally-then-except / except-then-finally combinations. Delphi's
            // try-except-else is still allowed because 'else' is a different keyword.
            if (topValue === 'try' && (middleValue === 'except' || middleValue === 'finally')) {
              const existing = stack[stack.length - 1].intermediates;
              const hasExcept = existing.some((t) => t.value.toLowerCase() === 'except');
              const hasFinally = existing.some((t) => t.value.toLowerCase() === 'finally');
              if (hasExcept || hasFinally) break;
            }
            // try block: reject 'else' when the body is in `finally` clause. Only
            // try-except-else is valid in Delphi; try-finally-else is not. The
            // 'else' here is malformed and would otherwise pollute the intermediates.
            // Also reject duplicate 'else' (try-except-else-else): Delphi permits at
            // most one else clause per try-except, so a second else is malformed.
            // Additionally, reject 'else' that precedes any except/finally clause
            // (`try ... else ... end` without any handler clause): Delphi has no
            // bare try-else construct, so the else is malformed and must not be
            // attached to the try intermediates.
            if (topValue === 'try' && middleValue === 'else') {
              const existing = stack[stack.length - 1].intermediates;
              const hasExcept = existing.some((t) => t.value.toLowerCase() === 'except');
              const hasFinally = existing.some((t) => t.value.toLowerCase() === 'finally');
              const hasElse = existing.some((t) => t.value.toLowerCase() === 'else');
              if (hasFinally || hasElse || !hasExcept) break;
            }
            // case block: reject duplicate 'else' and duplicate 'of'. A `case` has
            // exactly one `of` (immediately after the selector) and at most one `else`
            // clause; additional occurrences are malformed and would otherwise pollute
            // the intermediates list (mirrors the try-except-else-else rejection above).
            if (topValue === 'case' && (middleValue === 'else' || middleValue === 'of')) {
              const existing = stack[stack.length - 1].intermediates;
              const hasDuplicate = existing.some((t) => t.value.toLowerCase() === middleValue);
              if (hasDuplicate) break;
            }
            stack[stack.length - 1].intermediates.push(token);
          }
          break;

        case 'block_close': {
          // until only closes repeat
          if (token.value === 'until') {
            const repeatIndex = findLastOpenerByType(stack, 'repeat');
            if (repeatIndex >= 0) {
              const openBlock = stack.splice(repeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          } else {
            // end closes any block except repeat
            const nonRepeatIndex = findLastNonRepeatIndex(stack);
            if (nonRepeatIndex >= 0) {
              const openBlock = stack.splice(nonRepeatIndex, 1)[0];
              pairs.push({
                openKeyword: openBlock.token,
                closeKeyword: token,
                intermediates: openBlock.intermediates,
                nestLevel: stack.length
              });
            }
          }
          break;
        }
      }
    }

    return pairs;
  }
}
