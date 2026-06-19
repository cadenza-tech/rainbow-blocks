// VHDL block parser: entity, architecture, process, if with compound end keywords

import type { BlockPair, ExcludedRegion, LanguageKeywords, OpenBlock, Token } from '../types';
import { BaseBlockParser } from './baseParser';
import { BracketIndex } from './bracketIndex';
import {
  buildCaseInsensitiveKeywordPattern,
  findLastOpenerByType,
  findLastOpenerForLoop,
  findLineStart,
  getTokenTypeCaseInsensitive,
  mergeCompoundEndTokens
} from './parserUtils';
import { matchVhdlBlockComment, matchVhdlCharacterLiteral, matchVhdlString } from './vhdlHelpers';
import type { VhdlValidationCallbacks } from './vhdlValidation';
import {
  isAtStatementBoundary,
  isInSignalAssignment,
  isInsideParens,
  isPrecededByDot,
  isValidComponentOpen,
  isValidEntityOrConfigOpen,
  isValidForOpen,
  isValidFuncProcOpen,
  isValidLoopOpen,
  isValidWhileOpen
} from './vhdlValidation';

// List of block types that have compound end keywords
const COMPOUND_END_TYPES = [
  'entity',
  'architecture',
  'process',
  'if',
  'case',
  'loop',
  'function',
  'procedure',
  'package',
  'component',
  'generate',
  'block',
  'record',
  'configuration',
  'protected',
  'for',
  'units',
  'context',
  // VHDL-2019 view declaration (LRM 6.5.2.2): `view <name> of <type> is ... end view [<name>];`
  'view'
];

// Block openers whose `is` directly opens the block's declarative part, with the opener keyword
// standing alone on the statement (no name/header in between). `process is` (LRM 11.3, sensitivity
// list omitted) and `block is` (LRM 11.2) both take an optional `is` that begins the declarative
// part; that `is` is a legitimate block intermediate. Neither keyword is an attribute entity_class
// (LRM 7.2), so a bare-word match here never collides with attribute_specification detection.
const STANDALONE_IS_BLOCK_OPENERS = new Set(['process', 'block']);

// Pattern to match compound end keywords (case insensitive)
// Only allow spaces/tabs between 'end' and the type keyword (same line only)
// Pattern includes 'postponed process' for 'end postponed process' syntax,
// 'package body' (LRM 4.8) and 'protected body' (LRM 5.6.2) compound end forms.
const COMPOUND_END_PATTERN = new RegExp(
  `\\bend[ \\t]+(postponed[ \\t]+process|package[ \\t]+body|protected[ \\t]+body|${COMPOUND_END_TYPES.join('|')})\\b`,
  'gi'
);

// Keywords that can be followed by 'generate'
const GENERATE_PREFIX_KEYWORDS = ['for', 'while', 'if', 'case'];

// Block-opener keywords whose immediate identifier-like token can legally be the prefix
// of an attribute reference (LRM §16.3). These keywords name a declarative item
// (entity/architecture/package/etc.) whose attribute can be referenced as
// `<keyword>'<attribute_name>`. Control-flow keywords (if/case/while/loop/for) start an
// expression and the apostrophe immediately following is a character literal, NEVER an
// attribute reference, so they are intentionally excluded.
const ATTRIBUTE_PREFIX_KEYWORDS: ReadonlySet<string> = new Set([
  'process',
  'function',
  'procedure',
  'entity',
  'architecture',
  'package',
  'component',
  'configuration',
  'block',
  'protected',
  'context',
  'record',
  'units',
  'view'
]);

// VHDL paren-context checks only care about '()' depth (port maps, generic maps,
// function calls). A single-kind '(' index behaves identically to a single-kind
// '()' backward scan, so '[' and '{' are deliberately not tracked.
const PAREN_OPENERS: ReadonlySet<string> = new Set(['(']);

// Detects whether an excluded region is an unterminated VHDL string literal. A string
// region starts with `"`. matchVhdlString returns the region ending at the closing `"`
// when terminated, or at the first newline / source.length when not. We only need to
// inspect the first and last char: if the region opens with `"` but does NOT close
// with `"`, the string is unterminated. Block comments and character literals are NOT
// flagged (terminated block comments may legitimately span newlines).
function isUnterminatedStringRegion(source: string, region: ExcludedRegion): boolean {
  if (source[region.start] !== '"') return false;
  if (region.end - region.start < 2) return true;
  return source[region.end - 1] !== '"';
}

// Word-form RHS markers (LRM 9.2): when an identifier word immediately precedes a
// reserved-word block opener, that word is one of VHDL's word-form operators (logical
// `not`/`and`/`or`/`xor`/`nand`/`nor`/`xnor`, shift `sll`/`srl`/`sla`/`sra`/`rol`/`ror`,
// arithmetic `mod`/`rem`, unary `abs`) or `return` (LRM 10.3), the keyword is on the
// RHS of an expression and must NOT be tokenized as a fresh block opener. Compared
// case-insensitively against the lowercase identifier extracted in
// isInExpressionRhsContext.
const RHS_WORD_OPERATORS: ReadonlySet<string> = new Set([
  'return',
  'not',
  'and',
  'or',
  'xor',
  'nand',
  'nor',
  'xnor',
  'sll',
  'srl',
  'sla',
  'sra',
  'rol',
  'ror',
  'mod',
  'rem',
  'abs'
]);

// Block-opener keywords that should NEVER appear on the RHS of an expression
// (assignment, comparison, argument list, etc.). Reserved words cannot legally be
// identifiers in VHDL, but editors regularly encounter in-progress or hand-written
// code that places one of these reserved words on the RHS (e.g., `if a = view then`).
// Without rejecting these, the keyword is tokenized as a fresh block_open and absorbs
// the surrounding control-flow block's intermediates.
// Control-flow keywords (`if`/`case`/`for`/`while`) are NOT included: they start a
// new statement and have their own dedicated validators. `record` is handled by
// isValidRecordOpen (requires preceding `is`) so it is excluded here too.
const RHS_INVALID_BLOCK_OPENERS: ReadonlySet<string> = new Set([
  'view',
  'units',
  'block',
  'protected',
  'context',
  'process',
  'loop',
  'entity',
  'architecture',
  'package',
  'configuration',
  'function',
  'procedure',
  'component',
  'generate'
]);

export class VhdlBlockParser extends BaseBlockParser {
  // Override parse to post-adjust nestLevel for blocks inside generate constructs.
  // The base recalculateNestLevels counts every pair whose offset range encloses a body
  // as a container, so two over-counts arise: (1) sibling generates in an elsif/else chain
  // each look like a parent of a body inside one branch, and (2) the control keyword and
  // generate of a single `if/for/while ... generate` (which share one `end generate`) both
  // look like parents of the synthetic begin/end body. adjustGenerateBodyNestLevels removes
  // both over-counts after the base recomputation.
  parse(source: string): BlockPair[] {
    const pairs = super.parse(source);
    this.adjustGenerateBodyNestLevels(pairs);
    return pairs;
  }

  // Paren index cached per source string. Built lazily on the first paren-context
  // check of a tokenize pass and reused for every subsequent keyword in the same
  // source, so the enclosing-paren lookup stays O(log n) instead of rescanning the
  // source prefix per keyword (which made parsing O(N^2)). Only '(' is tracked.
  private parenIndexCache: { source: string; index: BracketIndex } | null = null;

  // Returns the paren index for `source`, building it once and caching it by source
  // identity. Every isInsideParens check in a tokenize pass shares the same index.
  // excludedRegions is not part of the cache key: findExcludedRegions is
  // deterministic, so the same source always yields the same regions.
  private getParenIndex(source: string, excludedRegions: ExcludedRegion[]): BracketIndex {
    if (this.parenIndexCache !== null && this.parenIndexCache.source === source) {
      return this.parenIndexCache.index;
    }
    const index = new BracketIndex(source, excludedRegions, PAREN_OPENERS);
    this.parenIndexCache = { source, index };
    return index;
  }

  // Generate-chain siblings (if/elsif/else generate ... end generate) all close at the
  // same `end generate` token. recalculateNestLevels uses shared closeKeyword + last
  // block_middle intermediate to recognize siblings, so the generates themselves are
  // siblings of each other (correct). However, ordinary blocks nested inside each branch
  // (process/case/loop/if/nested-generate) close at their own separate `end;`/`end <type>;`
  // tokens, so the shared-close exclusion does not fire and prior sibling generates are
  // counted as parents. This method walks each such inner pair and subtracts the
  // sibling-generate over-count.
  //
  // Synthetic begin/end body pairs (openKeyword === 'begin', the alternative-label_end form)
  // are handled separately by anchoring their nestLevel to the innermost containing
  // generate. The body IS the body of that generate, so its level should match the
  // generate's own level (just like the control-prefix/generate siblings match each other).
  // This avoids over-subtraction in deeply nested generate constructs where every layer
  // contributes both a control-prefix and a generate sibling pair.
  private adjustGenerateBodyNestLevels(pairs: BlockPair[]): void {
    for (const body of pairs) {
      // Skip the generate pairs themselves (their sibling relation is handled by the
      // shared-close exclusion in recalculateNestLevels).
      if (body.openKeyword.value.toLowerCase() === 'generate') continue;
      // Find generates that appear to "contain" this body by offsets only
      const containingGenerates = pairs.filter(
        (other) =>
          other !== body &&
          other.openKeyword.value.toLowerCase() === 'generate' &&
          other.openKeyword.startOffset < body.openKeyword.startOffset &&
          other.closeKeyword.startOffset >= body.closeKeyword.startOffset
      );
      if (containingGenerates.length === 0) continue;
      // Synthetic begin/end body: anchor nestLevel to the innermost containing generate.
      // The body and the generate form one construct (the body IS the generate's body),
      // so the body's nestLevel must match the generate's nestLevel.
      if (body.openKeyword.value.toLowerCase() === 'begin') {
        const innermost = containingGenerates.reduce((best, candidate) =>
          candidate.openKeyword.startOffset > best.openKeyword.startOffset ? candidate : best
        );
        body.nestLevel = innermost.nestLevel;
        continue;
      }
      // For ordinary nested blocks (process/case/loop/if/nested-generate): group generates
      // that share the same closeKeyword (they're an elsif/else-generate chain). For each
      // chain (closeOffsetCounts > 1), there's only ONE direct parent generate; the other
      // (count - 1) generates are siblings that the base recalculation incorrectly counted.
      const closeOffsetCounts = new Map<number, number>();
      for (const gen of containingGenerates) {
        const off = gen.closeKeyword.startOffset;
        closeOffsetCounts.set(off, (closeOffsetCounts.get(off) ?? 0) + 1);
      }
      let overCount = 0;
      for (const count of closeOffsetCounts.values()) {
        if (count > 1) overCount += count - 1;
      }
      // A synthetic begin/end body anchored to its generate (handled above) sits at the same
      // nestLevel as that generate. When such a begin body also encloses this ordinary block,
      // the base recalculation counts BOTH the generate and the begin body as parents even
      // though they share one visual depth, so the block is reported one level too deep. The
      // generate-without-begin form (the block sits directly in the generate body) has no such
      // begin pair and must be left untouched, so this correction is gated on the presence of
      // an enclosing synthetic begin body. Subtract one per enclosing begin body.
      for (const other of pairs) {
        if (other === body) continue;
        if (other.openKeyword.value.toLowerCase() !== 'begin') continue;
        const enclosesBody =
          other.openKeyword.startOffset < body.openKeyword.startOffset && other.closeKeyword.startOffset >= body.closeKeyword.startOffset;
        if (!enclosesBody) continue;
        // Only begin bodies that are themselves inside a generate were anchored (collapsed onto
        // the generate's level); an ordinary begin body keeps its own depth and is a real parent.
        const beginInsideGenerate = containingGenerates.some(
          (gen) => gen.openKeyword.startOffset < other.openKeyword.startOffset && gen.closeKeyword.startOffset >= other.closeKeyword.startOffset
        );
        if (beginInsideGenerate) overCount += 1;
      }
      body.nestLevel = Math.max(0, body.nestLevel - overCount);
    }
  }

  protected readonly keywords: LanguageKeywords = {
    blockOpen: [
      'entity',
      'architecture',
      'process',
      'if',
      'case',
      'loop',
      'for',
      'while',
      'function',
      'procedure',
      'package',
      'component',
      'generate',
      'block',
      'record',
      'configuration',
      'protected',
      'units',
      'context',
      // VHDL-2019 view declaration (LRM 6.5.2.2)
      'view'
    ],
    blockClose: ['end'],
    blockMiddle: ['else', 'elsif', 'when', 'then', 'is', 'begin']
  };

  private get validationCallbacks(): VhdlValidationCallbacks {
    return {
      isInExcludedRegion: (pos, regions) => this.isInExcludedRegion(pos, regions),
      findExcludedRegionAt: (pos, regions) => this.findExcludedRegionAt(pos, regions)
    };
  }

  // Validates if 'loop' keyword is a valid block opener
  // 'loop' is invalid if preceded by 'for' or 'while' on the same line
  // (because the 'for' or 'while' is the actual block opener for 'end loop')
  // 'generate' is always valid because we handle 'for/while/if generate' specially in matchBlocks
  protected isValidBlockOpen(keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const lowerKeyword = keyword.toLowerCase();
    const cb = this.validationCallbacks;

    // Reject keywords preceded by '.' (library path like work.process or work . process).
    // The helper skips whitespace, newlines, and excluded regions (line/block comments)
    // so cases like `inst .  /* c */ process` are also rejected.
    if (isPrecededByDot(source, position, excludedRegions, cb)) {
      return false;
    }

    // Reject keywords followed by `'<attribute_name>` (attribute reference, LRM §16.3).
    // For example, `process'foreign` or `process 'foreign` is the foreign attribute on
    // the `process` type, not a process block opener. Only apply to keywords that can
    // legally be the prefix of an attribute reference (declarative item names).
    // Control-flow keywords (if/case/while/loop/for) start an expression and the
    // apostrophe immediately following is a character literal, never an attribute prefix.
    // VHDL is whitespace-insensitive, so allow any whitespace (spaces, tabs, newlines)
    // between the keyword and the apostrophe.
    if (ATTRIBUTE_PREFIX_KEYWORDS.has(lowerKeyword)) {
      let attrPos = position + keyword.length;
      while (
        attrPos < source.length &&
        (source[attrPos] === ' ' || source[attrPos] === '\t' || source[attrPos] === '\n' || source[attrPos] === '\r')
      ) {
        attrPos++;
      }
      if (attrPos < source.length && source[attrPos] === "'" && attrPos + 1 < source.length && /[a-zA-Z_]/.test(source[attrPos + 1])) {
        return false;
      }
    }

    // Reject keywords inside parenthesized expressions (port maps, generic maps, function calls)
    if (isInsideParens(position, this.getParenIndex(source, excludedRegions))) {
      return false;
    }

    // Reject reserved-word block openers when they appear on the RHS of an expression
    // (assignment, comparison, argument list, etc.). Without this guard a reserved word
    // like `view` in `if a = view then` would be tokenized as a fresh block_open and
    // absorb the surrounding control-flow block's `then`/`begin` intermediate. Apply only
    // to non-control-flow keywords (control-flow keywords have their own validators).
    if (RHS_INVALID_BLOCK_OPENERS.has(lowerKeyword) && this.isInExpressionRhsContext(source, position, excludedRegions)) {
      return false;
    }

    // Reject entity_class keywords inside attribute_specification (LRM 7.2):
    //   `attribute X of Y : <entity_class> is <expr>;`
    // The keyword is the entity_class, not a block opener. LRM 7.2 lists every entity_class
    // name: entity, architecture, configuration, procedure, function, package, type, subtype,
    // constant, signal, variable, component, label, literal, units, group, file. We list the
    // reserved-word block openers among them (the rest are not VHDL block keywords). `view`
    // is a VHDL-2019 entity_class (LRM 6.5.2.2). `process`, `block`, `generate`, `record`,
    // `protected`, `context`, `loop` are also reserved words that can appear in the
    // entity_class slot of malformed / editor-in-progress code; without rejecting them,
    // they would absorb the enclosing architecture's `begin` into their (orphan) intermediates.
    const entityClassKeywords = new Set([
      'package',
      'architecture',
      'configuration',
      'procedure',
      'function',
      'units',
      'component',
      'entity',
      'view',
      'process',
      'block',
      'generate',
      'record',
      'protected',
      'context',
      'loop'
    ]);
    if (entityClassKeywords.has(lowerKeyword) && this.isInAttributeSpecification(source, position, excludedRegions)) {
      return false;
    }

    // Reject reserved-word block openers that appear as a type mark in any type-indication
    // context (LRM 6.4.2). Covers signal/variable/constant/file declarations
    // (`signal x : view;`), record field declarations (`fld : view;` inside `record`),
    // subtype/alias declarations (`subtype x is view;` / `alias x is view;`), and array
    // element types (`type t is array (...) of view;`). Without rejecting these, the reserved
    // word is tokenized as a stray block_open and absorbs the surrounding architecture's
    // `begin` into its (orphan) intermediates. attribute_specification (`: view is ...`) is
    // already excluded by the entity_class check above.
    if (RHS_INVALID_BLOCK_OPENERS.has(lowerKeyword) && this.isReservedWordAsTypeMark(source, position, excludedRegions)) {
      return false;
    }

    // Reject reserved-word block openers that appear as the entity name in
    // `architecture <id> of <reserved> is ...` / `configuration <id> of <reserved> is ...`.
    // The reserved word here is (illegally) being used as the entity reference; without
    // this guard it absorbs the surrounding architecture/configuration's `is` and `begin`
    // into its (orphan) intermediates.
    if (RHS_INVALID_BLOCK_OPENERS.has(lowerKeyword) && this.isInArchitectureOrConfigEntityRef(source, position, excludedRegions)) {
      return false;
    }

    // Reject reserved-word block openers that appear as the entity_designator name in
    // `entity <reserved> is ... end entity;`. The reserved word here is (illegally) being
    // used as the entity name; without this guard it absorbs the surrounding entity's
    // `is` intermediate into its (orphan) intermediates, silently breaking the enclosing
    // entity declaration's structure. The symmetric case for `architecture/configuration
    // <id> of <reserved>` is handled above by isInArchitectureOrConfigEntityRef.
    if (RHS_INVALID_BLOCK_OPENERS.has(lowerKeyword) && this.isPrecededByEntityKeyword(source, position, excludedRegions)) {
      return false;
    }

    if (lowerKeyword === 'for') {
      return isValidForOpen(source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'entity' || lowerKeyword === 'configuration') {
      return isValidEntityOrConfigOpen(lowerKeyword, source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'function' || lowerKeyword === 'procedure') {
      return isValidFuncProcOpen(keyword, source, position, excludedRegions, cb);
    }

    if (lowerKeyword === 'loop') {
      return isValidLoopOpen(source, position, excludedRegions, cb);
    }

    // Reject 'while' preceded by 'wait' (wait while is not a block construct)
    if (lowerKeyword === 'while') {
      return isValidWhileOpen(source, position, excludedRegions, cb);
    }

    // Reject 'component' preceded by ':' (label: component instantiation, not declaration)
    if (lowerKeyword === 'component') {
      return isValidComponentOpen(source, position, excludedRegions, cb);
    }

    // Reject 'package X is new Y generic map(...)' (VHDL-2008 package instantiation).
    // Unlike a real package declaration, an instantiation ends with ';' and has no body.
    if (lowerKeyword === 'package') {
      return this.isValidPackageOpen(source, position, excludedRegions);
    }

    // Reject context_reference (`context selected_name [, ...];`) which can appear inside
    // a context_declaration body. Only a context_declaration (`context name is ... end`)
    // is a real block opener.
    if (lowerKeyword === 'context') {
      return this.isValidContextOpen(source, position, excludedRegions);
    }

    // Reject `record` not preceded by `is` (LRM 5.3.3). The only valid block opener
    // form is `type X is record ... end record;`. Anywhere else (e.g., `:= record`,
    // `(record)`, etc.) is invalid VHDL and should not be a block opener.
    if (lowerKeyword === 'record') {
      return this.isValidRecordOpen(source, position, excludedRegions);
    }

    // Reject `units` not preceded by `is` (LRM 5.2.4). The only valid block opener form is
    // `type X is units ... end units;`. Anywhere else (e.g. a case choice `when units =>`,
    // `:= units`) is invalid and must not open a block. This also covers `return units`.
    if (lowerKeyword === 'units') {
      return this.isValidUnitsOpen(source, position, excludedRegions);
    }

    return true;
  }

  // Detects whether the keyword at `position` is immediately preceded by an expression
  // operator (so the keyword is on the RHS of an assignment / comparison / argument list).
  // Reserved words cannot be identifiers in VHDL, but in-progress / hand-written test
  // fixtures sometimes place a reserved word on the RHS of an expression (e.g.,
  // `if a = view then`). Without this guard the reserved word is tokenized as a fresh
  // `block_open`, absorbing the surrounding control-flow block's intermediates.
  //
  // The scan skips whitespace, newlines, and excluded regions (block/line comments),
  // then inspects the immediately preceding non-whitespace character. The RHS markers are:
  //   `=` (equality test, end of `:=` / `<=` / `>=` / `/=`)
  //   `<` (less-than, including the `<` of `<=`)
  //   `>` (greater-than)
  //   `,` (separator inside an argument list / aggregate)
  //   `+` `-` `*` `/` `&` (arithmetic / concatenation)
  // The `=` of an association arrow `=>` is excluded explicitly: after `=>` the parser
  // enters a fresh statement (e.g., `when X => process ...`) where reserved-word block
  // openers ARE legitimate.
  private isInExpressionRhsContext(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = position - 1;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          // An unterminated string (one that ends at a newline or EOF because the closing
          // `"` is missing) signals editor-in-progress code. Crossing it backward would let
          // a stale `:=` / `<=` / `=` further up falsely classify the keyword as RHS-context
          // and silently drop legitimate block openers that the user is about to write.
          // Treat such a region as a hard stop instead. Terminated block comments may span
          // newlines legitimately and must not trigger this guard, so check only string
          // regions (start char `"`) and only by inspecting the closing char.
          if (isUnterminatedStringRegion(source, region)) {
            return false;
          }
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    // Word-form RHS markers: `return <reserved>` (return type / return statement RHS,
    // LRM 10.3) and VHDL word operators (LRM 9.2: not/and/or/xor/nand/nor/xnor, shift
    // sll/srl/sla/sra/rol/ror, mod/rem, unary abs) all establish an expression / value
    // context, so a reserved-word block opener following them must be rejected. Read the
    // identifier-like word ending at `i` (word-bounded) and consult RHS_WORD_OPERATORS.
    if (/[a-zA-Z0-9_]/.test(source[i])) {
      let wordStart = i;
      while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
        wordStart--;
      }
      const word = source.slice(wordStart, i + 1).toLowerCase();
      return RHS_WORD_OPERATORS.has(word);
    }
    const prev = source[i];
    // `=>` is the association arrow: after `=>` a fresh statement / target begins, where a
    // reserved-word block opener IS legitimate. The arrow ends with `>`, so when we land on
    // `>` we look one char back to disambiguate `=>` (NOT RHS) from bare `>` (RHS).
    if (prev === '>') {
      if (i > 0 && source[i - 1] === '=') return false;
      return true;
    }
    // `=` may be the rightmost char of `=`, `:=`, `<=`, `>=`, `/=`. Any of those are
    // RHS operators. (`=>` ends with `>`, not `=`, so it cannot reach this branch.)
    if (prev === '=') return true;
    // `<` here is the rightmost char (`<=` would have ended in `=`), so it is a bare
    // less-than operator — RHS marker.
    if (prev === '<') return true;
    // `,` is the argument list / aggregate separator; the others are arithmetic / concat
    // operators. All imply an expression context.
    // `/=` (inequality) ends with `=` and is caught above; bare `/` here is division.
    if (prev === ',' || prev === '+' || prev === '-' || prev === '*' || prev === '/' || prev === '&') return true;
    return false;
  }

  // Detects whether the keyword at `position` is the entity_designator name in
  // `entity <keyword> is ...`. Walks backward through whitespace/comments expecting
  // the `entity` keyword. The symmetric `architecture/configuration <id> of <keyword>`
  // case is handled by isInArchitectureOrConfigEntityRef.
  private isPrecededByEntityKeyword(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 5) return false;
    if (!/[a-zA-Z0-9_]/.test(source[i])) return false;
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const word = source.slice(i + 1, wordEnd).toLowerCase();
    return word === 'entity';
  }

  // Detects whether the keyword at `position` is the entity reference in
  // `architecture <id> of <keyword> is ...` or `configuration <id> of <keyword> is ...`.
  // Walks backward through whitespace/comments expecting `of`, then an identifier
  // (the architecture/configuration name), then `architecture` or `configuration`.
  private isInArchitectureOrConfigEntityRef(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const skipBackWs = (start: number): number => {
      let q = start;
      while (q >= 0) {
        if (this.isInExcludedRegion(q, excludedRegions)) {
          const region = this.findExcludedRegionAt(q, excludedRegions);
          if (region) {
            q = region.start - 1;
            continue;
          }
        }
        const ch = source[q];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          q--;
          continue;
        }
        break;
      }
      return q;
    };
    // Step 1: walk past whitespace to find the preceding word — expect `of`.
    let i = skipBackWs(position - 1);
    if (i < 1) return false;
    if (!/[a-zA-Z0-9_]/.test(source[i])) return false;
    const word1End = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const word1 = source.slice(i + 1, word1End).toLowerCase();
    if (word1 !== 'of') return false;
    // Step 2: walk past whitespace to find the identifier (architecture/configuration name).
    i = skipBackWs(i);
    if (i < 0 || !/[a-zA-Z0-9_]/.test(source[i])) return false;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    // Step 3: walk past whitespace to find `architecture` or `configuration`.
    i = skipBackWs(i);
    if (i < 0 || !/[a-zA-Z0-9_]/.test(source[i])) return false;
    const word3End = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const word3 = source.slice(i + 1, word3End).toLowerCase();
    return word3 === 'architecture' || word3 === 'configuration';
  }

  // Walks backward from `start` past whitespace, newlines, and excluded regions
  // (comments, strings). Returns the offset of the first non-whitespace, non-excluded
  // character, or -1 if no such character exists.
  private skipBackwardWsAndExcluded(source: string, start: number, excludedRegions: ExcludedRegion[]): number {
    let i = start;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    return i;
  }

  // Reads the identifier-like word ending at `end` (inclusive). Returns the word's
  // lowercased form and the offset of the character before the word's start (i.e.,
  // the position to resume backward scanning from). If no identifier is at `end`,
  // returns null.
  private readBackwardWord(source: string, end: number): { word: string; before: number } | null {
    if (end < 0 || !/[a-zA-Z0-9_]/.test(source[end])) return null;
    let i = end;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const word = source.slice(i + 1, end + 1).toLowerCase();
    return { word, before: i };
  }

  // Detects whether the keyword at `position` is being used as a type mark in any
  // type-indication context (LRM 6.4.2). Returns true for:
  //   - `signal/variable/constant/file <name> : <reserved>` (object declaration)
  //   - `fld : <reserved>` inside `record ... end record` (record field declaration)
  //   - `subtype <name> is <reserved>` (subtype declaration, LRM 6.3)
  //   - `alias <name> is <reserved>` (alias declaration, LRM 6.6)
  //   - `... array (...) of <reserved>` (array element type, LRM 5.3.2.1)
  // Caller must have already excluded attribute_specification (`: view is ...`) via
  // isInAttributeSpecification.
  private isReservedWordAsTypeMark(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    if (this.isPrecededByTypeIndicationColon(source, position, excludedRegions)) return true;
    if (this.isRecordFieldTypeMark(source, position, excludedRegions)) return true;
    if (this.isSubtypeOrAliasTypeMark(source, position, excludedRegions)) return true;
    if (this.isArrayElementTypeMark(source, position, excludedRegions)) return true;
    return false;
  }

  // Detects `fld : <reserved>` inside a record body. The immediate prefix is `<identifier> :`
  // (like isPrecededByTypeIndicationColon), but the preceding token is NOT a declaration
  // keyword (signal/variable/constant/file). Instead, we walk back further and confirm
  // the field belongs to an open `record ... end record` body by finding a `record`
  // keyword without an intervening `end record` or `;` that closes a sibling declaration.
  private isRecordFieldTypeMark(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Step 1: confirm immediate prefix is `<identifier> :`.
    let i = this.skipBackwardWsAndExcluded(source, position - 1, excludedRegions);
    if (i < 0 || source[i] !== ':') return false;
    i = this.skipBackwardWsAndExcluded(source, i - 1, excludedRegions);
    const ident = this.readBackwardWord(source, i);
    if (!ident) return false;
    // Step 2: walk further back, scanning for `record` keyword without crossing
    // `end record`. The record body uses `;` to separate fields, so we accept those.
    // Hard stop on `end record` (record body closed before reaching this declaration).
    let j = this.skipBackwardWsAndExcluded(source, ident.before, excludedRegions);
    let scanLimit = 4096;
    while (j >= 0 && scanLimit > 0) {
      scanLimit--;
      if (this.isInExcludedRegion(j, excludedRegions)) {
        const region = this.findExcludedRegionAt(j, excludedRegions);
        if (region) {
          j = region.start - 1;
          continue;
        }
      }
      const ch = source[j];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ';' || ch === ',') {
        j--;
        continue;
      }
      if (!/[a-zA-Z0-9_]/.test(ch)) {
        // Other punctuation (`:`, `(`, etc.) means we left the record field context.
        return false;
      }
      const w = this.readBackwardWord(source, j);
      if (!w) return false;
      if (w.word === 'record') return true;
      // `end` before `record` would be `end record` (body terminator) – but we walk back,
      // so we'd see `record` first if walking left within an open body. If we encounter
      // `end` first, the record body has already closed.
      if (w.word === 'end') return false;
      // Any other declaration keyword that opens a new construct stops the scan.
      if (w.word === 'signal' || w.word === 'variable' || w.word === 'constant' || w.word === 'file' || w.word === 'type' || w.word === 'subtype') {
        return false;
      }
      // architecture / process / block / etc. stop the scan: we've left the record body.
      if (
        w.word === 'architecture' ||
        w.word === 'process' ||
        w.word === 'block' ||
        w.word === 'entity' ||
        w.word === 'package' ||
        w.word === 'begin'
      ) {
        return false;
      }
      j = w.before;
    }
    return false;
  }

  // Detects `subtype <name> is <reserved>` / `alias <name> is <reserved>`. The immediate
  // prefix is `is` (case-insensitive), the next non-ws token before that is an identifier
  // (the subtype/alias name), and the next token is the `subtype`/`alias` keyword.
  private isSubtypeOrAliasTypeMark(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = this.skipBackwardWsAndExcluded(source, position - 1, excludedRegions);
    const isWord = this.readBackwardWord(source, i);
    if (!isWord || isWord.word !== 'is') return false;
    i = this.skipBackwardWsAndExcluded(source, isWord.before, excludedRegions);
    const nameWord = this.readBackwardWord(source, i);
    if (!nameWord) return false;
    i = this.skipBackwardWsAndExcluded(source, nameWord.before, excludedRegions);
    const declWord = this.readBackwardWord(source, i);
    if (!declWord) return false;
    return declWord.word === 'subtype' || declWord.word === 'alias';
  }

  // Detects `... array (...) of <reserved>` (LRM 5.3.2.1 unconstrained_array_definition,
  // 5.3.2.2 constrained_array_definition). The immediate prefix is `of` (case-insensitive);
  // the next non-ws token before that is `)` closing an index constraint or index subtype.
  private isArrayElementTypeMark(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    let i = this.skipBackwardWsAndExcluded(source, position - 1, excludedRegions);
    const ofWord = this.readBackwardWord(source, i);
    if (!ofWord || ofWord.word !== 'of') return false;
    i = this.skipBackwardWsAndExcluded(source, ofWord.before, excludedRegions);
    if (i < 0 || source[i] !== ')') return false;
    // Walk back through matching parens. Each ) increments depth, each ( decrements.
    let depth = 1;
    i--;
    let scanLimit = 4096;
    while (i >= 0 && depth > 0 && scanLimit > 0) {
      scanLimit--;
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ')') depth++;
      else if (ch === '(') depth--;
      i--;
    }
    if (depth !== 0) return false;
    // i now points to char before matching `(`. Walk back and expect `array`.
    i = this.skipBackwardWsAndExcluded(source, i, excludedRegions);
    const arrayWord = this.readBackwardWord(source, i);
    if (!arrayWord || arrayWord.word !== 'array') return false;
    return true;
  }

  // Detects whether the keyword at `position` is part of a type indication (declaration)
  // rather than a labeled statement. A declaration looks like:
  //   `<declaration_keyword> <name> : <type>` — e.g., `signal x : view`, `variable y : units`.
  // A labeled statement looks like:
  //   `<label> : <block_statement_keyword> ...` — e.g., `blk: block`, `lbl: process`.
  // The distinguishing factor is the declaration keyword (signal/variable/constant/
  // shared/file) appearing before the `name :`. attribute_specification (`attribute X of
  // Y : view is ...`) is handled separately by isInAttributeSpecification; this helper
  // assumes the caller has already excluded that case.
  private isPrecededByTypeIndicationColon(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Step 1: walk back past whitespace/comments to find the `:`.
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0 || source[i] !== ':') return false;
    // Step 2: walk back past the `:`, then past whitespace/comments, then past the
    // identifier (the declared name or label).
    i--;
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0 || !/[a-zA-Z0-9_]/.test(source[i])) return false;
    // Skip the identifier.
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    // Step 3: walk past whitespace/comments, then read the preceding word.
    while (i >= 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0) return false;
    // The preceding token must be a declaration keyword for this to be a type indication.
    if (!/[a-zA-Z0-9_]/.test(source[i])) return false;
    const wordEnd = i + 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(source[i])) i--;
    const word = source.slice(i + 1, wordEnd).toLowerCase();
    // VHDL declaration keywords that introduce a type indication (LRM 6.4.2):
    //   signal, variable, constant, file. `shared variable` ends with `variable` so the
    //   single-word check covers it. `port`/`generic` formal_part also use `:` but those
    //   are inside parens (handled by the isInsideParens check upstream).
    const DECL_KEYWORDS: ReadonlySet<string> = new Set(['signal', 'variable', 'constant', 'file']);
    return DECL_KEYWORDS.has(word);
  }

  // Validates `record` as a block opener: must be preceded by `is` keyword
  // (allowing whitespace and comments between them).
  private isValidRecordOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 1) return false;
    // Expect `is` immediately before (case-insensitive). The `s` is at position i,
    // the `i` is at position i-1.
    const isS = source[i] === 's' || source[i] === 'S';
    const isI = source[i - 1] === 'i' || source[i - 1] === 'I';
    if (!isS || !isI) return false;
    // Ensure the `is` is a standalone word (not part of a longer identifier like `axis`)
    if (i - 2 >= 0 && /[a-zA-Z0-9_]/.test(source[i - 2])) return false;
    return true;
  }

  // Validates `units` as a block opener: must be preceded by `is` keyword (LRM 5.2.4
  // physical type definition `type X is units ... end units;`), allowing whitespace and
  // comments between them. Anywhere else (e.g. a case choice `when units =>`, `:= units`)
  // is not a block opener and must be rejected so it does not swallow surrounding
  // intermediates. Mirrors isValidRecordOpen (`is record`).
  private isValidUnitsOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 1) return false;
    // Expect `is` immediately before (case-insensitive). The `s` is at position i,
    // the `i` is at position i-1.
    const isS = source[i] === 's' || source[i] === 'S';
    const isI = source[i - 1] === 'i' || source[i - 1] === 'I';
    if (!isS || !isI) return false;
    // Ensure the `is` is a standalone word (not part of a longer identifier like `axis`)
    if (i - 2 >= 0 && /[a-zA-Z0-9_]/.test(source[i - 2])) return false;
    return true;
  }

  // Distinguishes context_declaration (block opener: `context name is ... end`) from
  // context_reference (NOT a block opener: `context selected_name [, ...];`).
  // Scans forward past the keyword and the (selected) name to inspect what follows.
  private isValidContextOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    const skipWs = (p: number): number => {
      let q = p;
      while (q < source.length) {
        if (this.isInExcludedRegion(q, excludedRegions)) {
          const region = this.findExcludedRegionAt(q, excludedRegions);
          if (region) {
            q = region.end;
            continue;
          }
        }
        if (source[q] === ' ' || source[q] === '\t' || source[q] === '\n' || source[q] === '\r') {
          q++;
          continue;
        }
        break;
      }
      return q;
    };
    let i = position + 'context'.length;
    i = skipWs(i);
    while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
    i = skipWs(i);
    // Selected name: keep consuming `. identifier` chains
    while (i < source.length && source[i] === '.') {
      i++;
      i = skipWs(i);
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      i = skipWs(i);
    }
    if (i >= source.length) return true;
    const next = source[i];
    if (next === ',' || next === ';') return false;
    return true;
  }

  // Detects whether the keyword position appears inside an attribute_specification entity_class slot:
  //   `attribute <designator> of <entity_specification> : <ENTITY_CLASS> is <expr>;`
  // We scan backward (skipping excluded regions) for `:` then `of` then `attribute` keyword on the same statement.
  private isInAttributeSpecification(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Walk back through whitespace and comments to find the preceding `:`
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
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i--;
        continue;
      }
      break;
    }
    if (i < 0 || source[i] !== ':') return false;
    // Found `:`; now scan further back, skipping a contiguous run of identifier/whitespace/dot chars,
    // looking for the `of` keyword followed eventually by `attribute`. Exhaustion of SCAN_LIMIT
    // before either `;` (statement terminator) or the start of source is reached returns true
    // conservatively: the `:` already signals that we are likely inside an attribute_specification,
    // and false-promoting the entity_class keyword to a block opener would pollute the surrounding
    // block's intermediates (e.g., absorb the architecture's `begin`).
    i--;
    let foundOf = false;
    let foundAttribute = false;
    let scanLimitExhausted = false;
    let scanned = 0;
    const SCAN_LIMIT = 4096;
    while (i >= 0) {
      if (scanned >= SCAN_LIMIT) {
        scanLimitExhausted = true;
        break;
      }
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          scanned++;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ';') break;
      if (/[a-zA-Z_]/.test(ch)) {
        const wordEnd = i + 1;
        let wordStart = i;
        while (wordStart > 0 && /[a-zA-Z0-9_]/.test(source[wordStart - 1])) {
          wordStart--;
        }
        const word = source.slice(wordStart, wordEnd).toLowerCase();
        if (!foundOf && word === 'of') {
          foundOf = true;
        } else if (foundOf && word === 'attribute') {
          foundAttribute = true;
          break;
        }
        i = wordStart - 1;
        scanned++;
        continue;
      }
      i--;
      scanned++;
    }
    // On scan exhaustion, conservatively return true: the preceding `:` already strongly
    // suggests this is an attribute_specification, and false-promoting the entity_class
    // keyword to a block opener would silently corrupt the surrounding block's
    // intermediates (e.g., absorb its `begin`).
    return foundAttribute || scanLimitExhausted;
  }

  // Rejects VHDL-2008 package instantiations: `package X is new Y generic map(...);`
  // Scans forward skipping whitespace/comments to locate 'is new' after 'package <name>'.
  private isValidPackageOpen(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Step past 'package' keyword (length 7) and the package name identifier.
    let i = position + 7;
    const skipWsAndExclude = (p: number): { pos: number; skippedExclude: boolean } => {
      let q = p;
      let skippedExclude = false;
      while (q < source.length) {
        if (this.isInExcludedRegion(q, excludedRegions)) {
          const region = this.findExcludedRegionAt(q, excludedRegions);
          if (region) {
            q = region.end;
            skippedExclude = true;
            continue;
          }
        }
        if (source[q] === ' ' || source[q] === '\t' || source[q] === '\n' || source[q] === '\r') {
          q++;
          continue;
        }
        break;
      }
      return { pos: q, skippedExclude };
    };
    const skipWs = (p: number): number => skipWsAndExclude(p).pos;
    const stepResult = skipWsAndExclude(i);
    i = stepResult.pos;
    // Skip the package name. If skipWs already passed an excluded region (extended
    // identifier `\name\`), the package name is already consumed — do not skip again.
    if (stepResult.skippedExclude) {
      // Already past the extended identifier; nothing more to skip for the name.
    } else if (i < source.length && source[i] === '\\') {
      // Extended identifier not pre-skipped (e.g., adjacent to `package` with no whitespace)
      i++;
      while (i < source.length && source[i] !== '\\') i++;
      if (i < source.length) i++;
    } else {
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
    }
    i = skipWs(i);
    // Expect 'is'
    if (i + 2 > source.length || !/is/i.test(source.slice(i, i + 2))) return true;
    if (i + 2 < source.length && /[a-zA-Z0-9_]/.test(source[i + 2])) return true;
    i = skipWs(i + 2);
    // Expect 'new'
    if (i + 3 > source.length || !/new/i.test(source.slice(i, i + 3))) return true;
    if (i + 3 < source.length && /[a-zA-Z0-9_]/.test(source[i + 3])) return true;
    return false;
  }

  protected isValidBlockClose(_keyword: string, source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Reject 'end' preceded by '.' (hierarchical reference like inst.end). The dot check
    // skips whitespace, newlines, and excluded regions (line/block comments) so cases like
    // `a . /* c */ end` are also rejected.
    if (isPrecededByDot(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }
    // Reject `end` that appears in the middle of an expression (e.g., `sig <= a end b;`).
    // Without this guard, the stray `end` would greedily close a surrounding block opener
    // and cascade pairing errors across the enclosing process/architecture.
    if (!isAtStatementBoundary(source, position, excludedRegions, this.validationCallbacks)) {
      return false;
    }
    return true;
  }

  protected tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: --
    if (char === '-' && pos + 1 < source.length && source[pos + 1] === '-') {
      return this.matchSingleLineComment(source, pos);
    }

    // Block comment: /* ... */ (VHDL-2008)
    if (char === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      return matchVhdlBlockComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return matchVhdlString(source, pos);
    }

    // Character literal: 'x'
    if (char === "'") {
      return matchVhdlCharacterLiteral(source, pos);
    }

    // VHDL-93 extended identifier: \keyword\ (backslash-delimited)
    if (char === '\\') {
      let i = pos + 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          // Check for doubled backslash escape (\\) inside extended identifier
          if (i + 1 < source.length && source[i + 1] === '\\') {
            i += 2;
            continue;
          }
          return { start: pos, end: i + 1 };
        }
        // Extended identifiers cannot span lines
        if (source[i] === '\n' || source[i] === '\r') {
          return { start: pos, end: i };
        }
        i++;
      }
      return { start: pos, end: source.length };
    }

    return null;
  }

  // For each compound `end <type>` occurrence, scan forward from the end of the
  // compound keyword up to `;` (or end of source) to locate a single trailing
  // identifier-like word. If that word is itself a reserved block keyword
  // (e.g., `loop`, `if`, `for`, `while`, `case`, `process`, `generate`), return
  // its starting offset so the outer tokenize loop can ignore it. Identifiers that
  // are NOT reserved words (the normal label case) are left untouched: they never
  // hit the keyword regex anyway. Whitespace and excluded regions (comments) are
  // tolerated; if anything else is encountered (e.g., a second word, an operator),
  // we abort for that compound end without recording any skip position.
  private findTrailingLabelPositions(
    source: string,
    compoundEndPositions: Map<number, { keyword: string; length: number; endType: string }>,
    excludedRegions: ExcludedRegion[]
  ): Set<number> {
    const skipPositions = new Set<number>();
    const reservedWords = new Set<string>([
      ...this.keywords.blockOpen.map((k) => k.toLowerCase()),
      ...this.keywords.blockClose.map((k) => k.toLowerCase()),
      ...this.keywords.blockMiddle.map((k) => k.toLowerCase())
    ]);

    // Skip whitespace and excluded regions (comments) starting at `p`. Returns the
    // first non-whitespace/non-comment offset (may be source.length).
    const skipGap = (p: number): number => {
      let q = p;
      while (q < source.length) {
        if (this.isInExcludedRegion(q, excludedRegions)) {
          const region = this.findExcludedRegionAt(q, excludedRegions);
          if (region) {
            q = region.end;
            continue;
          }
        }
        const ch = source[q];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          q++;
          continue;
        }
        break;
      }
      return q;
    };

    for (const [endStart, info] of compoundEndPositions) {
      let i = skipGap(endStart + info.length);
      // Already at `;` or EOF: no label.
      if (i >= source.length || source[i] === ';') continue;
      // Must be an identifier start.
      if (!/[a-zA-Z_]/.test(source[i])) continue;
      // Walk any contiguous run of reserved-word labels. VHDL grammar allows at most
      // one trailing label after a compound end, but editor-in-progress code can place
      // multiple reserved words there (e.g. `end process loop case;`). All of them must
      // be suppressed; otherwise the later words leak as block_open tokens and may
      // false-pair with a downstream `end <kw>`. The contiguous run is terminated by
      // `;` / EOF (record the candidates) or by a non-reserved word / non-identifier
      // (the syntax becomes ambiguous; conservatively drop the candidates).
      const candidates: { wordStart: number; reserved: boolean }[] = [];
      while (i < source.length) {
        if (!/[a-zA-Z_]/.test(source[i])) break;
        const wordStart = i;
        while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
        const word = source.slice(wordStart, i).toLowerCase();
        candidates.push({ wordStart, reserved: reservedWords.has(word) });
        i = skipGap(i);
      }
      // The trailing run must end at `;` / EOF. Anything else means the labels are
      // followed by real code — leave them alone.
      if (i < source.length && source[i] !== ';') continue;
      for (const candidate of candidates) {
        if (candidate.reserved) {
          skipPositions.add(candidate.wordStart);
        }
      }
    }
    return skipPositions;
  }

  // Detects compound `end <type>` forms whose `end` and the type keyword are separated
  // by one or more block comments (`/* ... */`), e.g. `end /* note */ process`.
  // VHDL-2008 (LRM 15.9) treats a comment as whitespace, so such a form is a single
  // compound end. COMPOUND_END_PATTERN only allows spaces/tabs, so this scan supplements
  // it. The gap between `end` and the type keyword must contain ONLY spaces, tabs and
  // single-line block comments: a newline anywhere in the gap (including inside a
  // multi-line block comment, or a line comment terminator) disqualifies the form,
  // keeping it consistent with the same-line-only rule for plain whitespace separators.
  // Detected entries are merged into compoundEndPositions so the rest of tokenize and
  // mergeCompoundEndTokens handle them like any other compound end.
  private findCommentSeparatedCompoundEnds(
    source: string,
    excludedRegions: ExcludedRegion[],
    alreadyMatched: Set<number>,
    rejectedCompoundTypePositions: Set<number>
  ): Map<number, { keyword: string; length: number; endType: string }> {
    const result = new Map<number, { keyword: string; length: number; endType: string }>();
    const endPattern = /\bend\b/gi;
    for (const m of source.matchAll(endPattern)) {
      const endStart = m.index;
      // Skip `end` already covered by the same-line regex, or inside excluded regions.
      if (alreadyMatched.has(endStart)) continue;
      if (this.isInExcludedRegion(endStart, excludedRegions)) continue;
      let i = endStart + 3;
      let crossedComment = false;
      // Skip a run of spaces/tabs and single-line block comments. Abort on newline,
      // a multi-line block comment, or any other character.
      let gapValid = true;
      while (i < source.length) {
        const ch = source[i];
        if (ch === ' ' || ch === '\t') {
          i++;
          continue;
        }
        if (ch === '/' && i + 1 < source.length && source[i + 1] === '*') {
          const region = this.findExcludedRegionAt(i, excludedRegions);
          if (!region) {
            gapValid = false;
            break;
          }
          // Reject a block comment that itself spans a newline.
          if (source.slice(region.start, region.end).includes('\n') || source.slice(region.start, region.end).includes('\r')) {
            gapValid = false;
            break;
          }
          crossedComment = true;
          i = region.end;
          continue;
        }
        break;
      }
      // Require at least one comment in the gap; pure-whitespace gaps are the regex's job.
      if (!gapValid || !crossedComment || i >= source.length) continue;
      if (!/[a-zA-Z]/.test(source[i])) continue;
      const typeStart = i;
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      const firstWord = source.slice(typeStart, i).toLowerCase();
      // Resolve the (possibly two-word) compound type. `package`/`protected` may be
      // followed by `body`, and `postponed` by `process`, within the same valid gap.
      let endType = firstWord;
      let typeEnd = i;
      let trailingTypeStart = typeStart;
      if (firstWord === 'package' || firstWord === 'protected' || firstWord === 'postponed') {
        let j = i;
        // Skip spaces/tabs and single-line block comments (mirroring the gap rule
        // between `end` and the first type word). A newline anywhere in the gap
        // disqualifies the form, keeping consistency with the same-line-only rule.
        while (j < source.length) {
          const ch = source[j];
          if (ch === ' ' || ch === '\t') {
            j++;
            continue;
          }
          if (ch === '/' && j + 1 < source.length && source[j + 1] === '*') {
            const region = this.findExcludedRegionAt(j, excludedRegions);
            if (!region) break;
            const regionText = source.slice(region.start, region.end);
            if (regionText.includes('\n') || regionText.includes('\r')) break;
            j = region.end;
            continue;
          }
          break;
        }
        const secondStart = j;
        while (j < source.length && /[a-zA-Z0-9_]/.test(source[j])) j++;
        const secondWord = source.slice(secondStart, j).toLowerCase();
        if ((firstWord !== 'postponed' && secondWord === 'body') || (firstWord === 'postponed' && secondWord === 'process')) {
          endType = firstWord === 'postponed' ? 'process' : firstWord;
          typeEnd = j;
          // For `postponed process`, the trailing reserved word that would be tokenized as
          // a stray block_open is `process` (the second word). For `package body` /
          // `protected body`, the trailing word `body` is not a keyword so this only
          // matters for `postponed process`.
          if (firstWord === 'postponed') {
            trailingTypeStart = secondStart;
          }
        } else if (firstWord === 'postponed') {
          // `postponed` alone is not a compound end type.
          continue;
        }
      }
      if (!COMPOUND_END_TYPES.includes(endType)) continue;
      if (!this.isValidBlockClose(source.slice(endStart, typeEnd), source, endStart, excludedRegions)) {
        // Mirror the same-line regex path: when a comment-separated compound end is rejected
        // (typically because `end` is dot-preceded like `inst.end /* c */ process`), record
        // the offset of the trailing reserved type word so the keyword loop in tokenize()
        // skips it instead of tokenizing it as a fresh block_open. Without this, the stray
        // opener absorbs the surrounding block's `end <type>` via LIFO matching and breaks
        // pairing of the enclosing block.
        rejectedCompoundTypePositions.add(trailingTypeStart);
        continue;
      }
      result.set(endStart, {
        keyword: source.slice(endStart, typeEnd),
        length: typeEnd - endStart,
        endType
      });
    }
    return result;
  }

  // Detects a multi-line function/procedure header: `function/procedure <name> (... params ...) [return T] is`
  // where the parameter list spans more lines than the 5-line lookback used for type/subtype detection.
  // From `position` (the `is` offset), scans backward past whitespace, comments, an optional
  // `return <type>` clause, and the matching parenthesized parameter list. If the prefix before
  // the parameter list starts with `function` or `procedure` (after skipping the subprogram name
  // and optional designator characters), returns true. Returns false when no `(` is found, parens
  // are unbalanced, or the prefix is not a subprogram declaration. The scan honors excluded regions
  // (block/line comments and string literals) so paren counting is not fooled by literal `(` / `)`.
  private isPrecededByMultiLineSubprogramHeader(source: string, position: number, excludedRegions: ExcludedRegion[]): boolean {
    // Walk back from `position - 1` skipping whitespace, newlines, and excluded regions
    // until we hit a non-whitespace character.
    const skipBackwardWs = (start: number): number => {
      let i = start;
      while (i >= 0) {
        if (this.isInExcludedRegion(i, excludedRegions)) {
          const region = this.findExcludedRegionAt(i, excludedRegions);
          if (region) {
            i = region.start - 1;
            continue;
          }
        }
        const ch = source[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          i--;
          continue;
        }
        break;
      }
      return i;
    };

    let i = skipBackwardWs(position - 1);
    if (i < 0) return false;

    // Skip an optional `return <type>` clause: walk back through an identifier (the type),
    // then whitespace, then look for `return`. The type can be a selected name with `.`,
    // so allow `.` and `[a-zA-Z0-9_]` characters.
    const ident = /[a-zA-Z0-9_.]/;
    if (ident.test(source[i])) {
      const identStartExclusive = (() => {
        let j = i;
        while (j >= 0 && ident.test(source[j])) j--;
        return j;
      })();
      const word = source.slice(identStartExclusive + 1, i + 1).toLowerCase();
      i = identStartExclusive;
      // `return` itself preceding the `is` (no explicit return type) is unusual but treat as
      // matched and continue to the `)` check.
      if (word !== 'return') {
        const beforeType = skipBackwardWs(i);
        if (beforeType < 5) return false;
        const returnSlice = source.slice(beforeType - 5, beforeType + 1).toLowerCase();
        const isReturnWord =
          returnSlice === 'return' &&
          (beforeType - 6 < 0 || !/[a-zA-Z0-9_]/.test(source[beforeType - 6])) &&
          (beforeType + 1 >= source.length || !/[a-zA-Z0-9_]/.test(source[beforeType + 1]));
        if (!isReturnWord) return false;
        i = beforeType - 6;
      }
      i = skipBackwardWs(i);
    }

    // Expect `)` (end of parameter list) at position `i`.
    if (i < 0 || source[i] !== ')') return false;
    if (this.isInExcludedRegion(i, excludedRegions)) return false;
    // Walk back matching parens. Each `)` increments depth, each `(` decrements.
    let depth = 1;
    i--;
    while (i >= 0 && depth > 0) {
      if (this.isInExcludedRegion(i, excludedRegions)) {
        const region = this.findExcludedRegionAt(i, excludedRegions);
        if (region) {
          i = region.start - 1;
          continue;
        }
      }
      const ch = source[i];
      if (ch === ')') depth++;
      else if (ch === '(') depth--;
      i--;
    }
    if (depth !== 0) return false;
    // i now points to the char just before the matching `(`.
    i = skipBackwardWs(i);
    if (i < 0) return false;

    // Skip the subprogram designator: an identifier or operator-symbol (a quoted string
    // like `"="`). For an identifier walk back through `[a-zA-Z0-9_]`. For a quoted
    // designator the closing `"` is already in an excluded region, so skipBackwardWs
    // would have moved past it; check the char at i directly. If we land on either,
    // continue scanning back.
    if (ident.test(source[i])) {
      while (i >= 0 && ident.test(source[i])) i--;
    } else if (source[i] !== '"') {
      return false;
    }
    // For an operator-symbol designator (`"="` etc.), skipBackwardWs has already
    // jumped before the quoted region (it is an excluded region), so no extra step is needed.
    i = skipBackwardWs(i);
    if (i < 3) return false;

    // Check for `function` (8 chars) or `procedure` (9 chars) ending at i.
    // The keyword's last char is at position i.
    for (const kw of ['function', 'procedure']) {
      const len = kw.length;
      if (i - len + 1 < 0) continue;
      const slice = source.slice(i - len + 1, i + 1).toLowerCase();
      if (slice === kw && (i - len < 0 || !/[a-zA-Z0-9_]/.test(source[i - len]))) {
        return true;
      }
    }
    return false;
  }

  // Checks whether the inclusive source range [lineStart, lineEnd] contains a
  // standalone `is` keyword (case-insensitive, word-bounded) outside excluded regions.
  // Used to detect that a block-opener header line already has its own `is`.
  private lineContainsStandaloneIs(source: string, lineStart: number, lineEnd: number, excludedRegions: ExcludedRegion[]): boolean {
    for (let i = lineStart; i + 1 <= lineEnd; i++) {
      if (this.isInExcludedRegion(i, excludedRegions)) continue;
      const isI = source[i] === 'i' || source[i] === 'I';
      const isS = source[i + 1] === 's' || source[i + 1] === 'S';
      if (!isI || !isS) continue;
      const before = i > 0 ? source[i - 1] : '';
      const after = i + 2 <= lineEnd ? source[i + 2] : '';
      const beforeOk = before === '' || !/[a-zA-Z0-9_]/.test(before);
      const afterOk = after === '' || !/[a-zA-Z0-9_]/.test(after);
      if (beforeOk && afterOk) return true;
    }
    return false;
  }

  // Override tokenize to handle compound end keywords and case insensitivity
  protected tokenize(source: string, excludedRegions: ExcludedRegion[]): Token[] {
    // First, find all compound end keywords and their positions
    const compoundEndPositions = new Map<number, { keyword: string; length: number; endType: string }>();
    // Track positions of trailing type words (e.g., `if`, `loop`) inside compound end
    // patterns that were REJECTED by isValidBlockClose (typically because the `end` is
    // preceded by `.` like `inst.end if;`). Without this, the trailing type word is later
    // tokenized as a fresh block_open and breaks pairing with the surrounding block.
    const rejectedCompoundTypePositions = new Set<number>();

    // Reset the pattern's lastIndex
    COMPOUND_END_PATTERN.lastIndex = 0;
    let match = COMPOUND_END_PATTERN.exec(source);
    while (match !== null) {
      const pos = match.index;
      // Check if in excluded region
      if (!this.isInExcludedRegion(pos, excludedRegions)) {
        if (this.isValidBlockClose(match[0], source, pos, excludedRegions)) {
          const fullMatch = match[0];
          const matchedType = match[1].toLowerCase();
          // For 'package body' / 'protected body' compound forms, the actual opener
          // keyword is 'package' / 'protected' (not the trailing 'body').
          let endType: string;
          if (/^package[ \t]+body$/.test(matchedType)) {
            endType = 'package';
          } else if (/^protected[ \t]+body$/.test(matchedType)) {
            endType = 'protected';
          } else {
            // Use last word for multi-word matches like 'postponed process' -> 'process'
            const endTypeParts = matchedType.split(/[ \t]+/);
            endType = endTypeParts[endTypeParts.length - 1];
          }
          compoundEndPositions.set(pos, {
            keyword: fullMatch, // Preserve original case
            length: fullMatch.length,
            endType
          });
        } else {
          // Compound end was rejected (e.g., `inst.end if`). Record the offset of the
          // trailing keyword (`if`/`loop`/etc.) so the keyword loop below skips it as a
          // new block_open. Locate it relative to the match by scanning past `end` and
          // any whitespace.
          const fullMatch = match[0];
          // Skip "end"
          let trailingPos = pos + 3;
          while (trailingPos < pos + fullMatch.length && (source[trailingPos] === ' ' || source[trailingPos] === '\t')) {
            trailingPos++;
          }
          // For multi-word compound forms (`postponed process`, `package body`, `protected body`)
          // also skip the first word and whitespace to land on the final type word.
          const innerLower = match[1].toLowerCase();
          if (/^(postponed|package|protected)[ \t]+/.test(innerLower)) {
            // Skip the first inner word
            while (trailingPos < pos + fullMatch.length && /[a-zA-Z0-9_]/.test(source[trailingPos])) {
              trailingPos++;
            }
            while (trailingPos < pos + fullMatch.length && (source[trailingPos] === ' ' || source[trailingPos] === '\t')) {
              trailingPos++;
            }
          }
          rejectedCompoundTypePositions.add(trailingPos);
        }
      }
      match = COMPOUND_END_PATTERN.exec(source);
    }

    // Supplement with compound ends whose `end` and type keyword are separated by
    // block comments (e.g. `end /* c */ process`). COMPOUND_END_PATTERN only allows
    // spaces/tabs between the two words, so these forms are detected here separately.
    // Pass `rejectedCompoundTypePositions` so that rejections inside this scan (e.g.
    // `inst.end /* c */ process`) also contribute their trailing type word to the
    // skip set, mirroring the same-line regex path above.
    const commentSeparated = this.findCommentSeparatedCompoundEnds(
      source,
      excludedRegions,
      new Set(compoundEndPositions.keys()),
      rejectedCompoundTypePositions
    );
    for (const [pos, info] of commentSeparated) {
      compoundEndPositions.set(pos, info);
    }

    // Detect trailing label positions after each compound end. The grammar permits
    // an optional designator/label after the compound `end <type>` form
    // (e.g., `end process my_label;`). The label is normally an ordinary identifier,
    // but malformed inputs sometimes place a reserved word there
    // (e.g., `end generate loop;`). Without this filter the reserved word is later
    // tokenized as a fresh `block_open`, which absorbs the surrounding architecture's
    // `end <type>;` and breaks pairing. Collect the offsets of any reserved-word
    // labels so the keyword loop below can skip them.
    const labelPositionsToSkip = this.findTrailingLabelPositions(source, compoundEndPositions, excludedRegions);

    // Tokenize with case-insensitive matching
    const tokens: Token[] = [];
    const keywordPattern = buildCaseInsensitiveKeywordPattern(this.keywords);
    const newlinePositions = this.buildNewlinePositions(source);

    for (const keywordMatch of source.matchAll(keywordPattern)) {
      const startOffset = keywordMatch.index;

      if (this.isInExcludedRegion(startOffset, excludedRegions)) {
        continue;
      }

      // Skip reserved-word labels that follow a compound `end <type>` form.
      if (labelPositionsToSkip.has(startOffset)) {
        continue;
      }

      // Skip the trailing type keyword (`if`/`loop`/etc.) of any REJECTED compound end
      // (e.g., `inst.end if`). Otherwise it would be tokenized as a stray block_open and
      // absorb a surrounding `end <type>` from the enclosing block.
      if (rejectedCompoundTypePositions.has(startOffset)) {
        continue;
      }

      const keyword = keywordMatch[1];

      if (this.isAdjacentToUnicodeLetter(source, startOffset, keyword.length)) {
        continue;
      }

      const type = getTokenTypeCaseInsensitive(keyword, this.keywords);

      if (type === 'block_open' && !this.isValidBlockOpen(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      if (type === 'block_close' && !this.isValidBlockClose(keyword, source, startOffset, excludedRegions)) {
        continue;
      }

      // Reject block_middle keywords preceded by '.' (record member access like `rec.then`,
      // `rec.is`, `rec.else`). Without this guard the trailing word is tokenized as a fresh
      // block_middle and absorbed by the enclosing block's intermediates (e.g. `rec.then`
      // adds a spurious second `then` to the surrounding if-block's intermediates). The
      // helper skips whitespace, newlines, and excluded regions so cases like `rec . then`
      // are also rejected. block_open/block_close go through their own validation methods
      // which already apply isPrecededByDot.
      if (type === 'block_middle' && isPrecededByDot(source, startOffset, excludedRegions, this.validationCallbacks)) {
        continue;
      }

      // Skip 'is' in type/subtype/alias declarations (not block-level 'is')
      // Uses statement-based detection: finds the last unquoted semicolon on the line
      // and checks if the text after it starts with a declaration keyword
      if (type === 'block_middle' && keyword.toLowerCase() === 'is') {
        const lineStart = findLineStart(source, startOffset);
        const lineSlice = source.slice(lineStart, startOffset);
        // Find last unquoted semicolon on the line to get the current statement start
        let stmtStart = 0;
        for (let si = 0; si < lineSlice.length; si++) {
          if (this.isInExcludedRegion(lineStart + si, excludedRegions)) continue;
          if (lineSlice[si] === ';') {
            stmtStart = si + 1;
          }
        }
        // Build statement text skipping excluded regions (block comments like /* ... */)
        let stmtText = '';
        for (let si = lineStart + stmtStart; si < startOffset; si++) {
          if (this.isInExcludedRegion(si, excludedRegions)) continue;
          stmtText += source[si];
        }
        const stmtBefore = stmtText.toLowerCase().trimStart();
        // VHDL declaration keywords that can introduce statements containing a stray `is`
        // in editor-in-progress code (e.g. `signal x is integer;`). The grammar does not
        // permit `is` here, but the keyword should not leak into the enclosing block's
        // intermediates. `shared variable` is handled by the optional `shared\s+` prefix
        // before `variable`.
        if (/^(?:type|subtype|alias|attribute|file|group|signal|variable|constant|shared\s+variable)\b/.test(stmtBefore)) {
          continue;
        }
        // Skip `is` immediately following `=>` (case branch arrow, named association arrow).
        // For example, a malformed `when 1 => is;` inside a case branch should not leak `is`
        // as an intermediate of the surrounding case-block. trimEnd tolerates any whitespace
        // (already stripped from stmtBefore via excluded regions and trimStart, so a remaining
        // trailing `=>` is exactly the arrow we are looking for).
        if (stmtBefore.trimEnd().endsWith('=>')) {
          continue;
        }
        // Check previous lines for type/subtype declaration (multi-line case)
        // e.g., "type state_t\n  is (idle, active);"
        // Also handle attribute_specification with entity_class on its own line, e.g.:
        //   attribute keep of foo :
        //     package is true;
        // Here stmtBefore is just the entity_class keyword (single word) when the colon
        // ends the previous line. The upward scan will verify the `attribute` declaration
        // is present and act as a safety net for unrelated single-word patterns.
        // The `is null/is new/is (` filter below targets subprogram declarations
        // (`procedure p is null;`, `function f is new gen ...;`, `function f(...) return T is (expr);`)
        // which are NOT block bodies. Apply it only when the `is` belongs to a `function`/`procedure`
        // header. A same-line `function`/`procedure` keyword in `stmtBefore` is the strongest signal;
        // the upward scan below also flags multi-line function/procedure headers. For all other
        // block openers (process/block/package body/etc.), the `is null;` form is the block body's
        // first statement, NOT a declaration form — applying the filter would drop the legitimate
        // block intermediate.
        let isSubprogramHeaderIs = /^(function|procedure)\b/.test(stmtBefore);
        // Detect multi-line subprogram header (LRM 4.2): `procedure/function <name> (...) [return T] is`
        // where the parameter list pushes the header more than 5 lines above the closing `is`.
        // The 5-line lookback below is intentionally narrow for type/subtype/attribute detection
        // (BUG4), so for subprogram detection we do a separate paren-aware backward walk that
        // is unbounded by line count. This enables the `is null;` / `is (expr);` / `is new ...`
        // filters to apply to long-parameter subprograms without changing the type/subtype
        // 5-line behavior.
        if (!isSubprogramHeaderIs && this.isPrecededByMultiLineSubprogramHeader(source, startOffset, excludedRegions)) {
          isSubprogramHeaderIs = true;
        }
        // `process is` / `block is` (optionally label-prefixed: `b: block is`): the opener keyword
        // stands alone immediately before this `is`, which opens the block's declarative part
        // (LRM 11.2/11.3). This `is` is a legitimate block intermediate, so it must skip the bare-word
        // upward scan below. Without this guard the scan can hit an enclosing block-opener line carrying
        // its own `is` (e.g. `architecture ... is`) and wrongly drop this `is` from the intermediates.
        const stmtAfterLabel = stmtBefore.replace(/^\w+\s*:\s*/, '').trimEnd();
        const isStandaloneBlockOpenerIs = STANDALONE_IS_BLOCK_OPENERS.has(stmtAfterLabel);
        if (
          !isStandaloneBlockOpenerIs &&
          (stmtBefore.length === 0 || /^\(/.test(stmtBefore) || /:\s*\w+\s*$/.test(stmtBefore) || /^\w+\s*$/.test(stmtBefore))
        ) {
          let skipThisIs = false;
          let scanPos = lineStart - 1;
          if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
          if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          let linesChecked = 0;
          while (scanPos >= 0 && linesChecked < 5) {
            const prevLineStart = findLineStart(source, scanPos);
            // Build line text skipping excluded regions (block comments like /* ... */)
            let prevLineText = '';
            for (let ci = prevLineStart; ci <= scanPos; ci++) {
              if (this.isInExcludedRegion(ci, excludedRegions)) continue;
              prevLineText += source[ci];
            }
            const prevLine = prevLineText.toLowerCase().trimStart();
            // Skip comment-only lines (all non-whitespace chars are inside excluded regions)
            const isCommentOnlyLine =
              (prevLine.length > 0 && /^--/.test(prevLine)) ||
              (() => {
                let hasNonWs = false;
                for (let ci = prevLineStart; ci <= scanPos; ci++) {
                  if (source[ci] === ' ' || source[ci] === '\t' || source[ci] === '\r' || source[ci] === '\n') continue;
                  hasNonWs = true;
                  if (!this.isInExcludedRegion(ci, excludedRegions)) return false;
                }
                return hasNonWs;
              })();
            if (isCommentOnlyLine) {
              scanPos = prevLineStart - 1;
              if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
              if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
              continue;
            }
            if (prevLine.length > 0) {
              if (/^(type|subtype|alias|attribute|file|group)\b/.test(prevLine)) {
                // Check no semicolon between declaration and this 'is'
                let hasSemicolon = false;
                for (let si = prevLineStart; si < startOffset; si++) {
                  if (this.isInExcludedRegion(si, excludedRegions)) continue;
                  if (source[si] === ';') {
                    hasSemicolon = true;
                    break;
                  }
                }
                if (!hasSemicolon) {
                  skipThisIs = true;
                }
                break;
              }
              // A block-opener header line that already carries its own `is` keyword
              // (e.g. `package p is`) means that construct's header is complete. If only
              // bare-identifier content lines sit between it and the current `is`, then
              // the current `is` belongs to an invalid `identifier is ...` statement
              // (e.g. `my_signal\n  is something;`). Skip it so it does not pollute the
              // enclosing block's intermediates. A block-opener line WITHOUT its own `is`
              // (e.g. `entity counter` then `is`) is the real owner of this `is`, so we
              // do not skip in that case.
              // Strip an optional `<label>:` prefix so a labeled block opener like
              // `control: process (...)` is recognized as a block-opener line. Without
              // stripping, the labeled form would be classified as a bare-identifier
              // content line, causing the scan to walk past the process header and find
              // the enclosing block's own `is` (incorrectly dropping the process `is`).
              const prevLineNoLabel = prevLine.replace(/^\w+\s*:\s*/, '');
              if (
                /^(entity|architecture|package|configuration|context|component|block|generate|case|function|procedure|protected|units|view|process)\b/.test(
                  prevLineNoLabel
                )
              ) {
                if (this.lineContainsStandaloneIs(source, prevLineStart, scanPos, excludedRegions)) {
                  skipThisIs = true;
                } else if (/^(function|procedure)\b/.test(prevLineNoLabel)) {
                  // Multi-line function/procedure header without its own `is`. The
                  // `is null/is new/is (expr)` filter below still applies to detect
                  // null procedures, expression functions, and subprogram instantiations.
                  isSubprogramHeaderIs = true;
                }
                // For non-subprogram block openers (entity/architecture/package body/process/
                // block/etc.), this `is` is the block's header `is`. Leaving
                // isSubprogramHeaderIs at its default false ensures the filter does NOT
                // drop the legitimate block intermediate.
                break;
              }
              // Content line that doesn't match declaration → continue scanning upward
              scanPos = prevLineStart - 1;
              if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
              if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
              linesChecked++;
              continue;
            }
            // Blank lines don't count toward the line limit
            scanPos = prevLineStart - 1;
            if (scanPos >= 0 && source[scanPos] === '\n') scanPos--;
            if (scanPos >= 0 && source[scanPos] === '\r') scanPos--;
          }
          if (skipThisIs) {
            continue;
          }
        }
        // VHDL-2008: declarations that have no body and thus no matching `end`:
        //   - `function f is new generic_f generic map (...);` (subprogram instantiation)
        //   - `package p is new generic_pkg generic map (...);` (package instantiation)
        //   - `procedure p is null;` (null procedure)
        //   - `function f(...) return T is (expr);` (expression function)
        // The `is` token here is part of a declaration, not a block intermediate, so skip it.
        //
        // `is new` is unambiguous: it always denotes an instantiation regardless of the
        // surrounding keyword (subprogram or package), so the filter applies unconditionally.
        //
        // `is null;` and `is (` are valid declaration forms ONLY in subprogram
        // (function/procedure) headers. For other block openers (process/block/package body
        // /etc.) the same suffix is the block body's first statement and applying the filter
        // there would drop the legitimate block intermediate.
        {
          let afterIs = startOffset + 2;
          while (afterIs < source.length) {
            if (source[afterIs] === ' ' || source[afterIs] === '\t' || source[afterIs] === '\n' || source[afterIs] === '\r') {
              afterIs++;
              continue;
            }
            if (this.isInExcludedRegion(afterIs, excludedRegions)) {
              const region = this.findExcludedRegionAt(afterIs, excludedRegions);
              if (region) {
                afterIs = region.end;
                continue;
              }
            }
            break;
          }
          if (afterIs < source.length) {
            // is new <name> (instantiation) — applies unconditionally
            if (
              afterIs + 3 <= source.length &&
              source.slice(afterIs, afterIs + 3).toLowerCase() === 'new' &&
              (afterIs + 3 >= source.length || !/[a-zA-Z0-9_]/.test(source[afterIs + 3]))
            ) {
              continue;
            }
            // is null; (null procedure) and is (expr); (expression function)
            // are subprogram-only forms.
            if (isSubprogramHeaderIs) {
              if (
                afterIs + 4 <= source.length &&
                source.slice(afterIs, afterIs + 4).toLowerCase() === 'null' &&
                (afterIs + 4 >= source.length || !/[a-zA-Z0-9_]/.test(source[afterIs + 4]))
              ) {
                let afterNull = afterIs + 4;
                while (
                  afterNull < source.length &&
                  (source[afterNull] === ' ' || source[afterNull] === '\t' || source[afterNull] === '\n' || source[afterNull] === '\r')
                )
                  afterNull++;
                if (afterNull < source.length && source[afterNull] === ';') {
                  continue;
                }
              }
              // is (expr); (expression function)
              if (source[afterIs] === '(') {
                continue;
              }
            }
          }
        }
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

    const { tokens: result } = mergeCompoundEndTokens(tokens, compoundEndPositions);

    // Filter out block_middle and block_close tokens inside parenthesized expressions
    // (e.g., `if func(end record) > 0 then`), and when/else in conditional signal
    // assignments (sig <= val when cond else val)
    const cb = this.validationCallbacks;
    const parenIndex = this.getParenIndex(source, excludedRegions);
    return result.filter((token) => {
      // Reject block_close keywords inside parenthesized expressions
      if (token.type === 'block_close') {
        if (isInsideParens(token.startOffset, parenIndex)) {
          return false;
        }
        return true;
      }
      if (token.type !== 'block_middle') return true;
      // Reject block_middle keywords inside parenthesized expressions (port maps, generic maps, function calls)
      if (isInsideParens(token.startOffset, parenIndex)) {
        return false;
      }
      const kw = token.value.toLowerCase();
      // Filter 'when' in 'exit [label] when' and 'next [label] when' statements (may span lines)
      if (kw === 'when') {
        let p = token.startOffset - 1;
        while (p >= 0) {
          const region = this.findExcludedRegionAt(p, excludedRegions);
          if (region) {
            p = region.start - 1;
            continue;
          }
          if (source[p] === ' ' || source[p] === '\t' || source[p] === '\n' || source[p] === '\r') {
            p--;
            continue;
          }
          break;
        }
        // If we landed on an identifier, it might be a loop label — skip past it
        if (p >= 0 && /[a-zA-Z0-9_]/.test(source[p])) {
          const identEnd = p;
          while (p >= 0 && /[a-zA-Z0-9_]/.test(source[p])) {
            p--;
          }
          const ident = source.slice(p + 1, identEnd + 1).toLowerCase();
          // Check if the identifier itself is exit/next
          if ((ident === 'exit' || ident === 'next') && (p < 0 || !/[a-zA-Z0-9_]/.test(source[p]))) {
            return false;
          }
          // Otherwise skip whitespace/excluded regions again to find exit/next before the label
          while (p >= 0) {
            const region = this.findExcludedRegionAt(p, excludedRegions);
            if (region) {
              p = region.start - 1;
              continue;
            }
            if (source[p] === ' ' || source[p] === '\t' || source[p] === '\n' || source[p] === '\r') {
              p--;
              continue;
            }
            break;
          }
        }
        if (p >= 3) {
          const prevWord = source.slice(p - 3, p + 1).toLowerCase();
          if ((prevWord === 'exit' || prevWord === 'next') && (p - 4 < 0 || !/[a-zA-Z0-9_]/.test(source[p - 4]))) {
            return false;
          }
        }
      }
      if (kw !== 'when' && kw !== 'else') return true;
      return !isInSignalAssignment(source, token.startOffset, excludedRegions, kw, cb);
    });
  }

  // Returns true if the open block's intermediates already include a `then` token
  // (case-insensitive). Used to detect whether an upcoming `else`/`elsif` lies inside
  // the `if`'s condition (before `then`) or in the body (after `then`).
  private hasSeenThen(openBlock: OpenBlock): boolean {
    for (const t of openBlock.intermediates) {
      if (t.value.toLowerCase() === 'then') return true;
    }
    return false;
  }

  // With a `generate` on top of the stack, determines whether the enclosing generate construct
  // is an if-generate. An if-generate chain stacks the control keyword once with one generate
  // per branch ([if, generate, generate, ...]) because each `elsif/else generate` opens a fresh
  // generate, so the control keyword is found by skipping the contiguous run of generates beneath
  // the top. Returns true only when that underlying opener is `if`; for `for`/`while`-generate
  // there are no `then`/`else`/`elsif` keywords (LRM 11.8) so the run resolves to `for`/`while`.
  private isIfGenerateOnStack(stack: OpenBlock[]): boolean {
    for (let i = stack.length - 2; i >= 0; i--) {
      const opener = stack[i].token.value.toLowerCase();
      if (opener === 'generate') continue;
      return opener === 'if';
    }
    return false;
  }

  // Custom matching to handle compound end keywords
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
            const topOpener = stack[stack.length - 1].token.value.toLowerCase();
            const middleKw = token.value.toLowerCase();
            // 'when' is only valid as intermediate for 'case' blocks
            // In case-generate, stack is [case, generate] - attach when to case
            if (middleKw === 'when') {
              if (topOpener === 'case') {
                stack[stack.length - 1].intermediates.push(token);
              } else if (topOpener === 'generate' && stack.length >= 2 && stack[stack.length - 2].token.value.toLowerCase() === 'case') {
                stack[stack.length - 2].intermediates.push(token);
              }
            } else if (middleKw === 'else' || middleKw === 'elsif' || middleKw === 'then') {
              // `else`/`elsif`/`then` are control-flow intermediates that legitimately apply
              // ONLY to `if ... then ... end if` (top = `if`) and `if ... generate ...
              // [elsif ... generate ...] [else generate ...] end generate` (top = `generate`,
              // with an `if`/`generate` chain underneath). For any other top opener
              // (architecture/process/block/record/units/case/loop/etc.), the keyword is from
              // malformed or in-progress code (e.g., a stray `else x;` written as a statement
              // in an architecture body); absorbing it would pollute the surrounding block's
              // intermediates and visibly break structure. Drop it instead.
              if (topOpener === 'if') {
                // Inside an `if` block's condition before `then`: a `when ... else ...`
                // conditional expression (VHDL-2008 LRM 9.2.6) contains `else` tokens that
                // belong to the inner conditional expression, NOT to the surrounding `if`.
                // Drop those; retain `then` (which marks the actual transition into the body).
                if ((middleKw === 'else' || middleKw === 'elsif') && !this.hasSeenThen(stack[stack.length - 1])) {
                  // Drop
                } else {
                  stack[stack.length - 1].intermediates.push(token);
                }
              } else if (topOpener === 'generate') {
                // `then`/`else`/`elsif` only appear in an if-generate (LRM 11.8); for/while-generate
                // have no such control-flow keywords. Attach the intermediate only when the enclosing
                // generate construct is an if-generate (its control keyword is `if`). For a
                // for/while-generate the keyword is stray (malformed/in-progress code) and absorbing
                // it would pollute the generate's intermediates and break structure; drop it. This
                // mirrors the `when` handling above (which checks the underlying opener is `case`).
                if (this.isIfGenerateOnStack(stack)) {
                  stack[stack.length - 1].intermediates.push(token);
                }
              }
              // Otherwise drop (stray control-flow keyword for non-if/non-generate opener).
            } else if (middleKw === 'begin') {
              // Each block opener that has a declarative part transitions to its statement
              // part with exactly one `begin` (LRM 11.3 process_statement; LRM 4.3 entity
              // statement part; etc.). A duplicate `begin` written in the body is malformed
              // code; without deduplication it appears as a spurious second intermediate
              // (e.g. `[begin, begin]`), polluting the surrounding block's structure.
              // Other intermediates like `when` legitimately repeat (case branches), so the
              // dedup is gated on `begin` specifically.
              const hasBegin = stack[stack.length - 1].intermediates.some((t) => t.value.toLowerCase() === 'begin');
              if (!hasBegin) {
                stack[stack.length - 1].intermediates.push(token);
              }
            } else {
              stack[stack.length - 1].intermediates.push(token);
            }
          }
          break;

        case 'block_close': {
          const closeValue = token.value.toLowerCase();

          // Check if it's a compound end
          const compoundMatch = closeValue.match(/^end[ \t]+(?:\S+[ \t]+)*(\S+)/);
          if (compoundMatch) {
            let endType = compoundMatch[1];
            // 'package body' / 'protected body' compound forms: the actual opener
            // keyword is the first word, not the trailing 'body'.
            if (endType === 'body') {
              const bodyCompound = closeValue.match(/^end[ \t]+(package|protected)[ \t]+body$/);
              if (bodyCompound) {
                endType = bodyCompound[1];
              }
            }

            // Special case: 'end generate' closes all 'generate' blocks in the chain
            // (for elsif/else generate chains, multiple generate blocks stack up)
            if (endType === 'generate') {
              let generateIndex = findLastOpenerByType(stack, 'generate', true);
              const hadGenerateOpener = generateIndex >= 0;

              while (generateIndex >= 0) {
                // Check for control keyword immediately before generate
                const controlIndex = generateIndex - 1;
                let controlBlock: OpenBlock | null = null;

                if (controlIndex >= 0 && GENERATE_PREFIX_KEYWORDS.includes(stack[controlIndex].token.value.toLowerCase())) {
                  controlBlock = stack[controlIndex];
                }

                // Close the generate block
                const generateBlock = stack.splice(generateIndex, 1)[0];
                pairs.push({
                  openKeyword: generateBlock.token,
                  closeKeyword: token,
                  intermediates: generateBlock.intermediates,
                  nestLevel: stack.length
                });

                // Close control keyword if present (index shifted after splice)
                if (controlBlock) {
                  stack.splice(controlIndex, 1);
                  pairs.push({
                    openKeyword: controlBlock.token,
                    closeKeyword: token,
                    intermediates: controlBlock.intermediates,
                    nestLevel: stack.length
                  });
                  // Stop after closing the root control keyword (if/for/while/case)
                  // to avoid closing outer generate chains
                  break;
                }

                // Continue: close more generate blocks in the elsif/else chain
                generateIndex = findLastOpenerByType(stack, 'generate', true);
              }

              // No 'generate' opener anywhere on the stack: fall back to a simple-end
              // LIFO match against the most recent opener. This mirrors the non-generate
              // compound-end branch (`end loop`/`end process`) so an `end generate;`
              // written without a matching generate still produces a best-effort pair
              // instead of being silently dropped (which would orphan the opener).
              if (!hadGenerateOpener && stack.length > 0) {
                const openBlock = stack.pop();
                if (openBlock) {
                  pairs.push({
                    openKeyword: openBlock.token,
                    closeKeyword: token,
                    intermediates: openBlock.intermediates,
                    nestLevel: stack.length
                  });
                }
              }
            } else {
              let matchIndex = -1;

              // Special case: 'end loop' can close 'for', 'while', or 'loop'
              if (endType === 'loop') {
                matchIndex = findLastOpenerForLoop(stack);
              } else {
                matchIndex = findLastOpenerByType(stack, endType, true);
              }

              // If no compound match found, try simple end
              if (matchIndex < 0 && stack.length > 0) {
                matchIndex = stack.length - 1;
              }

              if (matchIndex >= 0) {
                const openBlock = stack.splice(matchIndex, 1)[0];
                pairs.push({
                  openKeyword: openBlock.token,
                  closeKeyword: token,
                  intermediates: openBlock.intermediates,
                  nestLevel: stack.length
                });
              }
            }
          } else {
            // Simple 'end' without type
            // Special case: if the top of stack is `generate`, this `end;` is the
            // optional alternative_label_end of the generate_statement_body (LRM 11.8),
            // NOT the actual end of the generate itself (which requires `end generate;`).
            // Pair the `end` with the most recent `begin` intermediate of the generate
            // (creating a synthetic body pair) and leave the generate on the stack so
            // the upcoming `end generate;` can close it.
            const topGenerate = stack.length > 0 && stack[stack.length - 1].token.value.toLowerCase() === 'generate' ? stack[stack.length - 1] : null;
            if (topGenerate) {
              const generateIntermediates = topGenerate.intermediates;
              let beginIdx = -1;
              for (let i = generateIntermediates.length - 1; i >= 0; i--) {
                if (generateIntermediates[i].value.toLowerCase() === 'begin') {
                  beginIdx = i;
                  break;
                }
              }
              if (beginIdx >= 0) {
                const beginToken = generateIntermediates[beginIdx];
                pairs.push({
                  openKeyword: beginToken,
                  closeKeyword: token,
                  intermediates: generateIntermediates.slice(beginIdx + 1),
                  nestLevel: stack.length
                });
                // Drop the begin (and any intermediates after it) from generate's list
                // so a subsequent `end;` doesn't re-pair with the same begin.
                stack[stack.length - 1] = { token: topGenerate.token, intermediates: generateIntermediates.slice(0, beginIdx) };
                break;
              }
              // No begin found: fall through to the default LIFO `stack.pop()` so the
              // generate itself is closed (best-effort pairing for malformed input that
              // uses `end;` instead of the canonical `end generate;`). Without this
              // fallthrough the `end;` would be silently dropped and the surrounding
              // architecture would lose its own end pairing.
              // If the stack entry directly below the generate is a generate-prefix
              // keyword (`if`/`for`/`while`/`case`), the bare `end;` is a malformed
              // shorthand for `end generate;` that should close BOTH the generate and
              // its control prefix — mirroring the compound-end branch's behavior so
              // the control prefix is not left orphan.
              const generateIndex = stack.length - 1;
              const controlIndex = generateIndex - 1;
              if (controlIndex >= 0 && GENERATE_PREFIX_KEYWORDS.includes(stack[controlIndex].token.value.toLowerCase())) {
                const generateBlock = stack.splice(generateIndex, 1)[0];
                pairs.push({
                  openKeyword: generateBlock.token,
                  closeKeyword: token,
                  intermediates: generateBlock.intermediates,
                  nestLevel: stack.length
                });
                const controlBlock = stack.splice(controlIndex, 1)[0];
                pairs.push({
                  openKeyword: controlBlock.token,
                  closeKeyword: token,
                  intermediates: controlBlock.intermediates,
                  nestLevel: stack.length
                });
                break;
              }
            }
            const openBlock = stack.pop();
            if (openBlock) {
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
