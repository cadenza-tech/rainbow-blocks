// Pascal/Delphi block parser: handles repeat-until, multi-style comments, Pascal string escaping, and case-insensitivity

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { buildCaseInsensitiveKeywordPattern, findLastNonRepeatIndex, findLastOpenerByType } from './parserUtils';
import type { PascalValidationCallbacks } from './pascalValidation';
import { buildRecordContextMap, isIfThenElse, isInsideParens, isTypeDeclarationOf, isVariantRecordCase, TYPE_MODIFIERS } from './pascalValidation';

// Keywords that indicate comparison context (= is comparison, not type definition)
const COMPARISON_CONTEXT_KEYWORDS = new Set([
  'if',
  'while',
  'until',
  'then',
  'or',
  'and',
  'not',
  'xor',
  'else',
  'for',
  'in',
  'is',
  'as',
  'div',
  'mod',
  'shl',
  'shr',
  'try',
  'begin',
  'on',
  'repeat'
]);

// Statement-context scope keywords: when these appear before `X = class` (across `;`
// boundaries), the `=` is a comparison expression, not a type definition.
const STATEMENT_CONTEXT_SCOPE_KEYWORDS = new Set(['begin', 'try', 'repeat', 'asm', 'do', 'then', 'else', 'finally', 'except']);

// Declaration-context scope keywords: when these appear before `X = class`, the `=`
// is a type definition. Used to terminate the cross-`;` scope scan early so we do
// not over-shoot into a previous statement block.
const DECLARATION_CONTEXT_SCOPE_KEYWORDS = new Set(['type', 'var', 'const']);

export class PascalBlockParser extends BaseBlockParser {
  // Per-parse map from `case` keyword offsets to whether they sit inside a record block.
  // Built once at the start of tokenize() so variant-record-case detection is O(1) per
  // `case` rather than re-scanning the whole source each time.
  private recordContextMap: Map<number, boolean> = new Map();

  private get validationCallbacks(): PascalValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
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
    // Variant record case: case Tag: Type of (inside a record, no own end)
    // Also handles tagless variant: case Integer of (no colon)
    if (keyword === 'case') {
      if (isVariantRecordCase(source, position, excludedRegions, this.validationCallbacks, this.recordContextMap)) {
        return false;
      }
    }

    // Generic constraint: function Bar<T: record>: T;
    // 'record' inside <> is a generic type constraint, not a block opener.
    if (keyword === 'record' && this.isInsideGenericConstraint(source, position, excludedRegions)) {
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
      // Reject when followed by ':' (type annotation like 'asm: Integer') or
      // ':=' (assignment), or '.' (field access), or '(' (function call), or ','.
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
          if (next === ':' || next === '.' || next === ',' || next === ')' || next === '=' || next === ';' || next === '(') {
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
        // Expression/declaration prefixes that disqualify `asm` as a block opener.
        // `[asm]` / `arr[0] asm` (array index), `<asm>` / `a > asm` (generic param or
        // comparison), arithmetic ops are all identifier/expression contexts. The set
        // must stay in sync with the backward check in addAsmExcludedRegions.
        if (
          prev === '.' ||
          prev === ':' ||
          prev === ',' ||
          prev === '(' ||
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

    // Must be '=' but not ':=' (assignment operator)
    if (!(i >= 0 && source[i] === '=' && (i === 0 || ![':', '>', '<', '+', '-', '*', '/'].includes(source[i - 1])))) {
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
      ci--;
    }

    // If we hit ';' before finding any comparison context keyword, the immediate
    // statement boundary is ambiguous: this could be a type declaration (one of many
    // in a `type` section) or a statement inside a `begin..end`. Scan further back
    // across `;` boundaries to determine the enclosing scope. Whichever scope-introducing
    // keyword is encountered first decides the context.
    //  - statement-context keywords (begin/try/repeat/asm) => comparison
    //  - declaration-context keywords (type/var/const) => type definition
    if (hitSemicolon && !hitDeclarationKeyword) {
      let si = ci - 1;
      while (si >= 0) {
        if (this.isInExcludedRegion(si, excludedRegions)) {
          const region = this.findExcludedRegionAt(si, excludedRegions);
          if (region) {
            si = region.start - 1;
            continue;
          }
        }
        const ch = source[si];
        if (/[a-zA-Z_]/.test(ch)) {
          const wordEnd = si;
          while (si > 0 && /[a-zA-Z0-9_]/.test(source[si - 1])) si--;
          const word = source.slice(si, wordEnd + 1).toLowerCase();
          if (STATEMENT_CONTEXT_SCOPE_KEYWORDS.has(word)) {
            return false;
          }
          if (DECLARATION_CONTEXT_SCOPE_KEYWORDS.has(word)) {
            break;
          }
        }
        si--;
      }
    }

    return true;
  }

  // Reject any close keyword (end/until) immediately after `.` (field/property access),
  // `@` (address-of operator like `@end`), `&` (FreePascal escaped-keyword identifier),
  // `$` (hex-literal prefix like `$end`), or `#` (character-constant prefix like `#end`).
  // Also reject `until` used as a case-label inside `case ... of`.
  protected isValidBlockClose(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByFieldDot(source, position, excludedRegions)) return false;
    if (position > 0) {
      const prev = source[position - 1];
      if (prev === '@' || prev === '&' || prev === '$' || prev === '#') return false;
    }
    // Case label: `case X of until: foo;` / `case X of end: foo;` —
    // the close keyword belongs to the case label expression, not a block close.
    // Without this check, the inner `until` consumes the outer `repeat` and breaks
    // repeat-until pairing; the inner `end` closes the case block prematurely.
    if ((keyword === 'until' || keyword === 'end') && this.isUsedAsCaseLabel(keyword, source, position, excludedRegions)) {
      return false;
    }
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
      // Skip past an identifier preceding the '=' (e.g. the `Z` in `Z = object:`)
      while (ip >= 0 && /[a-zA-Z0-9_]/.test(source[ip])) ip--;
      bp = this.skipBackwardWhitespace(source, ip, excludedRegions);
      if (bp < 0) return false;
    }

    const prev = source[bp];
    if (prev === ';' || prev === ',') return true;
    // Check for 'of' (word ending at bp)
    if (/[a-zA-Z]/.test(prev)) {
      let ws = bp;
      while (ws >= 0 && /[a-zA-Z0-9_]/.test(source[ws])) ws--;
      const word = source.slice(ws + 1, bp + 1).toLowerCase();
      if (word === 'of') return true;
    }
    return false;
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
      // ':=' (assignment), '.', ',', ')', '=', or '(' (function call).
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
            // @asm = address-of, &asm = identifier-escape, <asm> = generic param,
            // [asm] = array indexing, +/-/*/asm = arithmetic, $asm = hex-literal prefix,
            // #asm = char-constant prefix. None of these can introduce an asm block;
            // treat them as non-statement context.
            if (
              prev === '.' ||
              prev === ':' ||
              prev === ',' ||
              prev === '(' ||
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
              continue;
            }
            if (/[a-zA-Z0-9_]/.test(prev)) {
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

        // Skip end preceded by `.` (field access like `foo.end` inside asm body)
        if (endPos > 0 && source[endPos - 1] === '.') {
          continue;
        }

        // Skip end preceded by `@` (assembly local label like `@end` used as branch target).
        // Borland/Delphi asm uses `@name` for local labels; `JMP @end` references such a label.
        if (endPos > 0 && source[endPos - 1] === '@') {
          continue;
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
            if (topValue === 'try' && middleValue === 'else') {
              const existing = stack[stack.length - 1].intermediates;
              const hasFinally = existing.some((t) => t.value.toLowerCase() === 'finally');
              const hasElse = existing.some((t) => t.value.toLowerCase() === 'else');
              if (hasFinally || hasElse) break;
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
