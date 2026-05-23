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
  'context'
];

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
  'units'
]);

// VHDL paren-context checks only care about '()' depth (port maps, generic maps,
// function calls). A single-kind '(' index behaves identically to a single-kind
// '()' backward scan, so '[' and '{' are deliberately not tracked.
const PAREN_OPENERS: ReadonlySet<string> = new Set(['(']);

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
  // (synthetic begin/end body pairs, or process/case/loop/if/nested-generate blocks)
  // close at their own separate `end;`/`end <type>;` tokens, so the shared-close
  // exclusion does not fire and prior sibling generates are counted as parents. This
  // method walks each such inner pair and subtracts the sibling-generate over-count.
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
      // Group generates that share the same closeKeyword (they're an elsif/else-generate chain)
      const closeOffsetCounts = new Map<number, number>();
      for (const gen of containingGenerates) {
        const off = gen.closeKeyword.startOffset;
        closeOffsetCounts.set(off, (closeOffsetCounts.get(off) ?? 0) + 1);
      }
      // For each chain (closeOffsetCounts > 1), there's only ONE direct parent generate
      // (the one whose body actually contains the body pair). The other (count - 1)
      // generates are siblings that the base recalculation incorrectly counted.
      let overCount = 0;
      for (const count of closeOffsetCounts.values()) {
        if (count > 1) overCount += count - 1;
      }
      // A synthetic generate body (begin/end injected for the optional alternative-label
      // form, openKeyword === 'begin') is the inner scope of a single generate construct.
      // For an `if/for/while ... generate` construct the control keyword and the generate
      // close at the SAME `end generate`, so they form one construct and must contribute a
      // single nesting level to the body. The base recalculation counts BOTH as parents, so
      // subtract every control-prefix that shares a containing generate's close offset. This
      // correction targets only synthetic begin bodies: a real block (process/nested
      // generate/loop) that genuinely sits inside the construct keeps the construct as one
      // full level above it.
      if (body.openKeyword.value.toLowerCase() === 'begin') {
        const generateCloseOffsets = new Set(containingGenerates.map((gen) => gen.closeKeyword.startOffset));
        for (const other of pairs) {
          if (other === body) continue;
          if (!GENERATE_PREFIX_KEYWORDS.includes(other.openKeyword.value.toLowerCase())) continue;
          if (other.openKeyword.startOffset >= body.openKeyword.startOffset) continue;
          if (other.closeKeyword.startOffset < body.closeKeyword.startOffset) continue;
          if (generateCloseOffsets.has(other.closeKeyword.startOffset)) {
            overCount++;
          }
        }
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
      'context'
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
    // Allow horizontal whitespace (spaces/tabs) between the keyword and the apostrophe.
    if (ATTRIBUTE_PREFIX_KEYWORDS.has(lowerKeyword)) {
      let attrPos = position + keyword.length;
      while (attrPos < source.length && (source[attrPos] === ' ' || source[attrPos] === '\t')) {
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

    // Reject entity_class keywords inside attribute_specification (LRM 7.2):
    //   `attribute X of Y : <package|architecture|configuration|procedure|function|units|...> is <expr>;`
    // The keyword is the entity_class, not a block opener.
    const entityClassKeywords = new Set(['package', 'architecture', 'configuration', 'procedure', 'function', 'units', 'component', 'entity']);
    if (entityClassKeywords.has(lowerKeyword) && this.isInAttributeSpecification(source, position, excludedRegions)) {
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

    return true;
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
    // looking for the `of` keyword followed eventually by `attribute`
    i--;
    let foundOf = false;
    let foundAttribute = false;
    let scanned = 0;
    const SCAN_LIMIT = 4096;
    while (i >= 0 && scanned < SCAN_LIMIT) {
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
    return foundAttribute;
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

    for (const [endStart, info] of compoundEndPositions) {
      let i = endStart + info.length;
      // Skip whitespace and excluded regions (comments) up to the trailing word.
      while (i < source.length) {
        if (this.isInExcludedRegion(i, excludedRegions)) {
          const region = this.findExcludedRegionAt(i, excludedRegions);
          if (region) {
            i = region.end;
            continue;
          }
        }
        const ch = source[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          i++;
          continue;
        }
        break;
      }
      if (i >= source.length) continue;
      // Already at `;` or another terminator: no label.
      if (source[i] === ';') continue;
      // Must be an identifier start.
      if (!/[a-zA-Z_]/.test(source[i])) continue;
      const wordStart = i;
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      const word = source.slice(wordStart, i).toLowerCase();
      // Skip whitespace/comments after the candidate word, expecting `;`.
      // If anything else (another word, operator, etc.) appears we conservatively
      // do not record a skip — the syntax is ambiguous and we prefer the existing
      // behavior over silently dropping tokens.
      let j = i;
      while (j < source.length) {
        if (this.isInExcludedRegion(j, excludedRegions)) {
          const region = this.findExcludedRegionAt(j, excludedRegions);
          if (region) {
            j = region.end;
            continue;
          }
        }
        const ch = source[j];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
          j++;
          continue;
        }
        break;
      }
      if (j >= source.length || source[j] !== ';') continue;
      if (reservedWords.has(word)) {
        skipPositions.add(wordStart);
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
        while (j < source.length && (source[j] === ' ' || source[j] === '\t')) j++;
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
        if (/^(type|subtype|alias|attribute|file|group)\b/.test(stmtBefore)) {
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
        // Tracks whether this `is` is the multi-line block header `is` of a block opener
        // (e.g., `package body p\nis\n  null;`). When set, the VHDL-2008 `is null/is new/
        // is (expr)` filter below is skipped so the `is` is preserved as a block intermediate.
        let isBlockHeaderIs = false;
        if (stmtBefore.length === 0 || /^\(/.test(stmtBefore) || /:\s*\w+\s*$/.test(stmtBefore) || /^\w+\s*$/.test(stmtBefore)) {
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
              if (
                /^(entity|architecture|package|configuration|context|component|block|generate|case|function|procedure|protected|units)\b/.test(
                  prevLine
                )
              ) {
                if (this.lineContainsStandaloneIs(source, prevLineStart, scanPos, excludedRegions)) {
                  skipThisIs = true;
                } else {
                  // Block opener header line without its own `is` (e.g., `package body p`).
                  // This `is` is the block's header `is`, so the VHDL-2008 `is null/is new/
                  // is (expr)` filter must not apply or it would drop the intermediate.
                  isBlockHeaderIs = true;
                }
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
        // VHDL-2008: subprogram/package declarations that have no body and thus no matching `end`:
        //   - `function f is new generic_f generic map (...);` (instantiation)
        //   - `procedure p is null;` (null procedure)
        //   - `function f(...) return T is (expr);` (expression function)
        // The `is` token here is part of a declaration, not a block intermediate, so skip it.
        // Skip this filter entirely when the `is` is the multi-line block header `is` of a
        // block opener (e.g., `package body p\nis\n  null;`). The earlier upward scan
        // confirms this by reaching a block-opener line that has no standalone `is`.
        if (!isBlockHeaderIs) {
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
            // is new <name> (instantiation)
            if (
              afterIs + 3 <= source.length &&
              source.slice(afterIs, afterIs + 3).toLowerCase() === 'new' &&
              (afterIs + 3 >= source.length || !/[a-zA-Z0-9_]/.test(source[afterIs + 3]))
            ) {
              continue;
            }
            // is null; (null procedure)
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
            // 'when' is only valid as intermediate for 'case' blocks
            // In case-generate, stack is [case, generate] - attach when to case
            if (token.value.toLowerCase() === 'when') {
              if (topOpener === 'case') {
                stack[stack.length - 1].intermediates.push(token);
              } else if (topOpener === 'generate' && stack.length >= 2 && stack[stack.length - 2].token.value.toLowerCase() === 'case') {
                stack[stack.length - 2].intermediates.push(token);
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
