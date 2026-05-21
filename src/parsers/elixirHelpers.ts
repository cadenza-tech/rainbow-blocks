// Elixir string, sigil, atom, and interpolation matching helpers

import type { ExcludedRegion } from '../types';

// Callback type for skipping #{} interpolation content
type SkipInterpolationFn = (source: string, pos: number) => number;

// Sigil delimiter pairs
const SIGIL_PAIRED_DELIMITERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>'
};

// Whitelist of valid single-character sigil delimiters per Elixir spec.
// See: https://hexdocs.pm/elixir/sigils.html — sigils accept either paired brackets
// (handled in SIGIL_PAIRED_DELIMITERS) or one of these non-paired characters.
const SIGIL_NONPAIRED_DELIMITERS = new Set(['/', '|', '"', "'"]);

// Reserved words that should not be consumed as sigil modifiers.
// Sigil modifiers in Elixir are typically short lowercase letter sequences (e.g., `u`, `i`, `m`)
// and never overlap with reserved keywords. When the modifier scanner encounters one of these
// words, it must stop before the word to avoid consuming actual code. Includes block keywords
// plus Elixir guard/operator words (when/in/and/or/not) to keep the scanner conservative.
const SIGIL_MODIFIER_RESERVED_WORDS = new Set([
  'end',
  'def',
  'defp',
  'defmodule',
  'defmacro',
  'defmacrop',
  'defguard',
  'defguardp',
  'defprotocol',
  'defimpl',
  'do',
  'fn',
  'if',
  'unless',
  'case',
  'cond',
  'for',
  'with',
  'receive',
  'try',
  'quote',
  'else',
  'rescue',
  'catch',
  'after',
  'when',
  'in',
  'and',
  'or',
  'not'
]);

// Skips letters that follow a sigil closing delimiter as sigil modifiers, but stops before
// any reserved word so that words like `end`, `def`, or `do` are not absorbed as modifiers.
function skipSigilModifiers(source: string, pos: number): number {
  if (pos >= source.length || !/[a-zA-Z]/.test(source[pos])) {
    return pos;
  }
  // Gather the contiguous letter run starting at pos.
  let runEnd = pos;
  while (runEnd < source.length && /[a-zA-Z]/.test(source[runEnd])) {
    runEnd++;
  }
  const word = source.slice(pos, runEnd);
  // If the entire run is a reserved word AND not followed by an identifier-continuation
  // char (digit, underscore, ?, !), stop before the run.
  const after = source[runEnd];
  const isWordBoundary = after === undefined || (!/[a-zA-Z0-9_]/.test(after) && after !== '?' && after !== '!');
  if (isWordBoundary && SIGIL_MODIFIER_RESERVED_WORDS.has(word)) {
    return pos;
  }
  // Otherwise, the entire letter run is part of the modifier sequence.
  return runEnd;
}

// Returns matching close delimiter for sigils. Per Elixir spec, valid sigil delimiters
// are paired ASCII brackets (defined in SIGIL_PAIRED_DELIMITERS) or one of the whitelisted
// single ASCII characters (defined in SIGIL_NONPAIRED_DELIMITERS). Other characters such as
// _, $, @, ^, ~ are NOT valid sigil delimiters; treating them as such would consume
// arbitrary subsequent code as the sigil body.
function getSigilCloseDelimiter(open: string): string | null {
  if (open in SIGIL_PAIRED_DELIMITERS) {
    return SIGIL_PAIRED_DELIMITERS[open];
  }
  if (SIGIL_NONPAIRED_DELIMITERS.has(open)) {
    return open;
  }
  return null;
}

// Multi-character operator atoms in Elixir, in order of match preference (longer first).
// Per Elixir docs, the following operators may be used as atoms with the colon prefix.
// Longer operators must be matched before shorter ones to avoid splitting (e.g., ":===" must
// match as :=== not :== then leftover =, ":&&" must match as :&& not :& then leftover &).
const OPERATOR_ATOM_MULTI = [
  // 3-char operators (must come first)
  '===',
  '!==',
  '&&&',
  '|||',
  '<<<',
  '>>>',
  // 2-char operators
  '==',
  '!=',
  '<=',
  '>=',
  '=~',
  '->',
  '<-',
  '<>',
  '&&',
  '||',
  '..',
  '|>',
  '++',
  '--',
  '**',
  '<<',
  '>>'
] as const;

// Single-character operator atoms in Elixir.
const OPERATOR_ATOM_SINGLE = new Set(['+', '-', '*', '/', '<', '>', '=', '!', '?', '~', '^', '&', '|']);

// Returns an excluded region for an operator-style atom starting at pos (which must be ':'),
// or null if no operator atom is present. Operator atoms are :== :!= :<= :>= :=~ :-> :<- :<>
// and the single-char forms :+ :- :* :/ :< :> := :! :? :~ :^ :& :|. The same preceding-char
// rule as letter atoms applies (must not follow an identifier or another colon to avoid
// confusing keyword-list / type-spec syntax with an atom).
export function matchOperatorAtom(source: string, pos: number): ExcludedRegion | null {
  if (source[pos] !== ':') return null;
  // Reject when colon follows an identifier-continuation char or another colon (keyword
  // list / type spec / module attribute / etc.).
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (/[a-zA-Z0-9_)\]}?!:]/.test(prevChar)) return null;
    if (prevChar.charCodeAt(0) > 127 && /\p{L}/u.test(prevChar)) return null;
    if (pos - 2 >= 0) {
      const highSurrogate = source.charCodeAt(pos - 2);
      if (highSurrogate >= 0xd800 && highSurrogate <= 0xdbff) {
        const pair = source.slice(pos - 2, pos);
        if (/\p{L}/u.test(pair)) return null;
      }
    }
  }
  // Try multi-char operators first to avoid premature single-char match.
  for (const op of OPERATOR_ATOM_MULTI) {
    if (source.slice(pos + 1, pos + 1 + op.length) === op) {
      return { start: pos, end: pos + 1 + op.length };
    }
  }
  const next = source[pos + 1];
  if (next !== undefined && OPERATOR_ATOM_SINGLE.has(next)) {
    return { start: pos, end: pos + 2 };
  }
  return null;
}

// Checks if colon starts an atom (not keyword list key)
export function isAtomStart(source: string, pos: number): boolean {
  const nextChar = source[pos + 1];
  if (!nextChar) {
    return false;
  }

  // Atom must start with letter (including Unicode), underscore, or quote
  // Use codePointAt to handle surrogate pairs (characters outside BMP)
  const nextCodePoint = source.codePointAt(pos + 1);
  if (nextCodePoint === undefined) return false;
  if (!/[a-zA-Z_"']/.test(nextChar) && !(nextCodePoint > 127 && /\p{L}/u.test(String.fromCodePoint(nextCodePoint)))) {
    return false;
  }

  // Colon after identifier/number/closing bracket is not an atom (keyword list key)
  // Note: > is excluded from check because x>:atom is a valid comparison with atom
  // Includes ? and ! since Elixir identifiers can end with them (e.g., ok?: true)
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (/[a-zA-Z0-9_)\]}?!:]/.test(prevChar)) {
      return false;
    }
    // Check Unicode letters (BMP) not caught by ASCII regex above
    if (prevChar.charCodeAt(0) > 127 && /\p{L}/u.test(prevChar)) {
      return false;
    }
    // Check surrogate pairs (characters outside BMP)
    if (pos - 2 >= 0) {
      const highSurrogate = source.charCodeAt(pos - 2);
      if (highSurrogate >= 0xd800 && highSurrogate <= 0xdbff) {
        const pair = source.slice(pos - 2, pos);
        if (/\p{L}/u.test(pair)) {
          return false;
        }
      }
    }
  }

  return true;
}

// Matches atom literal: :atom, :"quoted", :'quoted'
export function matchAtomLiteral(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  const nextChar = source[pos + 1];

  // Quoted atom
  if (nextChar === '"' || nextChar === "'") {
    const quote = nextChar;
    let i = pos + 2;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      // Handle #{} interpolation in quoted atoms
      if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i += 2;
        i = skipInterpolation(source, i);
        continue;
      }
      if (source[i] === quote) {
        return { start: pos, end: i + 1 };
      }
      i++;
    }
    return { start: pos, end: i };
  }

  // Simple atom
  let i = pos + 1;
  while (i < source.length) {
    // Use codePointAt to handle surrogate pairs (characters outside BMP)
    const cp = source.codePointAt(i);
    if (cp === undefined) break;
    const ch = cp > 0xffff ? String.fromCodePoint(cp) : source[i];
    if (/[\p{L}0-9_@]/u.test(ch)) {
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    // ! and ? can only appear as the final character of an atom name
    if (ch === '!' || ch === '?') {
      i++;
      break;
    }
    break;
  }

  return { start: pos, end: i };
}

// Matches Elixir double-quoted string with #{} interpolation
export function matchElixirString(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '"') {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Matches Elixir single-quoted charlist with #{} interpolation
export function matchElixirCharlist(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === "'") {
      return { start: pos, end: i + 1 };
    }
    i++;
  }
  return { start: pos, end: i };
}

// Checks if position is at line start allowing leading whitespace
function isAtLineStartAllowingWhitespace(source: string, pos: number): boolean {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && (source[i] === ' ' || source[i] === '\t')) {
    i--;
  }
  return i < 0 || source[i] === '\n' || source[i] === '\r';
}

// Checks if position immediately after a heredoc terminator (""" or ''') is NOT followed
// by an identifier character. The Elixir heredoc terminator must end as a token:
// `"""def` is not a terminator because `def` would be an identifier-suffix,
// but `"""}` (closing interpolation) or `""" <> "x"` (operator) is OK.
function isLineEndAfterTerminator(source: string, pos: number): boolean {
  if (pos >= source.length) return true;
  const ch = source[pos];
  return !/[a-zA-Z0-9_]/.test(ch);
}

// Checks if position after a sigil heredoc terminator (followed by optional modifier letters)
// is NOT followed by an identifier-continuation char that would indicate the """ was inside
// the heredoc body, not a real terminator. Differs from isLineEndAfterTerminator by allowing
// letters at position (since skipSigilModifiers may stop at a reserved word like `end`/`do`,
// in which case the """ should still terminate and the reserved word be parsed as a keyword).
// Rejects digits, underscores, `?`, and `!` as those indicate continued identifier content.
function isLineEndAfterSigilTerminator(source: string, pos: number): boolean {
  if (pos >= source.length) return true;
  const ch = source[pos];
  return !/[0-9_?!]/.test(ch);
}

// Matches triple-quoted string (heredoc) with #{} interpolation for """ and '''
export function matchTripleQuotedString(source: string, pos: number, delimiter: string, skipInterpolation: SkipInterpolationFn): ExcludedRegion {
  // Both """ and ''' support interpolation in Elixir
  let i = pos + 3;
  // Track whether we've passed a newline (heredoc mode vs single-line triple quote).
  // Treat LF and CRLF as newlines; an isolated CR (rare) is left as content so that
  // `"""abc<CR>def"""` is correctly recognised as a single-line triple-quoted string.
  let isHeredoc = false;
  while (i < source.length) {
    if (source[i] === '\n' || source[i] === '\r') {
      isHeredoc = true;
    }
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    // Handle #{} interpolation in """ and ''' heredocs
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (
      source.slice(i, i + 3) === delimiter &&
      (!isHeredoc || (isAtLineStartAllowingWhitespace(source, i) && isLineEndAfterTerminator(source, i + 3)))
    ) {
      return { start: pos, end: i + 3 };
    }
    i++;
  }
  return { start: pos, end: source.length };
}

// Handlers for the parser-instance-dependent operations the interpolation scanner needs.
// Extracted as a callback interface so the iterative scanner can live here (free of `this`)
// while still reaching ElixirBlockParser's character-literal and identifier-context logic.
export interface InterpolationScanHandlers {
  // Returns the position after a character literal at pos, or pos if not a character literal
  skipCharLiteral: (source: string, pos: number) => number;
  // Returns true if the '~' at pos is preceded by an identifier (so it is not a sigil)
  isPrecededByIdentifier: (source: string, pos: number) => boolean;
}

// One open scan context on the explicit stack used by skipInterpolationIterative.
// Each variant carries exactly the state its scanner needs to resume after a nested
// context (string/sigil/interpolation) it descended into has been fully consumed.
type ScanContext =
  | { kind: 'interp'; depth: number }
  | { kind: 'string'; quote: string }
  | { kind: 'triple'; delimiter: string; isHeredoc: boolean }
  | { kind: 'sigil'; openDelimiter: string; closeDelimiter: string; isPaired: boolean; isLowercase: boolean; depth: number }
  | { kind: 'sigilTriple'; tripleDelim: string; isLowercase: boolean; isHeredoc: boolean };

// Iteratively scans #{} interpolation content starting just after the opening "#{"
// (pos points at the first char inside the braces) and returns the position after the
// matching "}". Strings, charlists, triple-quoted heredocs, and sigils nested inside the
// interpolation are scanned on an explicit context stack instead of by mutual recursion,
// so arbitrarily deep nesting (e.g. "#{\"#{\"...\"}\"}") cannot exhaust the JS call stack.
// Behaviour is identical to the former skipInterpolation/skipNested* mutual recursion.
export function skipInterpolationIterative(source: string, pos: number, handlers: InterpolationScanHandlers): number {
  const stack: ScanContext[] = [{ kind: 'interp', depth: 1 }];
  let i = pos;

  while (stack.length > 0 && i < source.length) {
    const ctx = stack[stack.length - 1];

    switch (ctx.kind) {
      case 'interp': {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        // Character literal: ?x (Elixir character literal)
        if (source[i] === '?' && i + 1 < source.length && (i === 0 || !/[a-zA-Z0-9_]/.test(source[i - 1]))) {
          const charLitEnd = handlers.skipCharLiteral(source, i);
          if (charLitEnd > i) {
            i = charLitEnd;
            continue;
          }
        }
        if (source[i] === '{') {
          ctx.depth++;
        } else if (source[i] === '}') {
          ctx.depth--;
          if (ctx.depth === 0) {
            // Consume the closing brace and finish this interpolation context
            i++;
            stack.pop();
            continue;
          }
        } else if (source[i] === '"' && source.slice(i, i + 3) === '"""') {
          stack.push({ kind: 'triple', delimiter: '"""', isHeredoc: false });
          i += 3;
          continue;
        } else if (source[i] === "'" && source.slice(i, i + 3) === "'''") {
          stack.push({ kind: 'triple', delimiter: "'''", isHeredoc: false });
          i += 3;
          continue;
        } else if (source[i] === '"' || source[i] === "'") {
          stack.push({ kind: 'string', quote: source[i] });
          i += 1;
          continue;
        } else if (source[i] === '#') {
          // # starts a comment in interpolation code, skip to end of line
          while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
            i++;
          }
          continue;
        } else if (
          source[i] === '~' &&
          i + 1 < source.length &&
          /[a-zA-Z]/.test(source[i + 1]) &&
          (i === 0 || !handlers.isPrecededByIdentifier(source, i))
        ) {
          // Skip sigil inside interpolation (e.g. ~s(}))
          const pushed = pushSigilContext(source, i, stack);
          if (pushed > i) {
            i = pushed;
            continue;
          }
        }
        i++;
        continue;
      }

      case 'string': {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          stack.push({ kind: 'interp', depth: 1 });
          i += 2;
          continue;
        }
        if (source[i] === ctx.quote) {
          i += 1;
          stack.pop();
          continue;
        }
        i++;
        continue;
      }

      case 'triple': {
        if (source[i] === '\n' || source[i] === '\r') {
          ctx.isHeredoc = true;
        }
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          stack.push({ kind: 'interp', depth: 1 });
          i += 2;
          continue;
        }
        if (
          source.slice(i, i + 3) === ctx.delimiter &&
          (!ctx.isHeredoc || (isAtLineStartAllowingWhitespace(source, i) && isLineEndAfterTerminator(source, i + 3)))
        ) {
          i += 3;
          stack.pop();
          continue;
        }
        i++;
        continue;
      }

      case 'sigilTriple': {
        if (source[i] === '\n' || source[i] === '\r') {
          ctx.isHeredoc = true;
        }
        if (source[i] === '\\' && i + 1 < source.length) {
          if (ctx.isLowercase || source[i + 1] === ctx.tripleDelim[0] || source[i + 1] === '\\') {
            i += 2;
            continue;
          }
        }
        if (ctx.isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          stack.push({ kind: 'interp', depth: 1 });
          i += 2;
          continue;
        }
        if (source.slice(i, i + 3) === ctx.tripleDelim && (!ctx.isHeredoc || isAtLineStartAllowingWhitespace(source, i))) {
          // Tentatively skip optional modifiers (stop before reserved words like end/do/def)
          const afterModifiers = skipSigilModifiers(source, i + 3);
          // Heredoc terminator requires non-identifier-continuation char (or EOF) after
          // modifiers; otherwise the """ is not a real terminator (sigil body continues).
          if (!ctx.isHeredoc || isLineEndAfterSigilTerminator(source, afterModifiers)) {
            i = afterModifiers;
            stack.pop();
            continue;
          }
        }
        i++;
        continue;
      }

      case 'sigil': {
        if (source[i] === '\\' && i + 1 < source.length) {
          if (ctx.isLowercase || source[i + 1] === ctx.closeDelimiter || source[i + 1] === '\\') {
            i += 2;
            continue;
          }
        }
        // Handle #{} interpolation inside lowercase sigils
        if (ctx.isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
          stack.push({ kind: 'interp', depth: 1 });
          i += 2;
          continue;
        }
        if (ctx.isPaired && source[i] === ctx.openDelimiter) {
          ctx.depth++;
        } else if (source[i] === ctx.closeDelimiter) {
          ctx.depth--;
          if (ctx.depth === 0) {
            // Skip optional modifiers (stop before reserved words like end/do/def)
            i = skipSigilModifiers(source, i + 1);
            stack.pop();
            continue;
          }
        }
        i++;
        continue;
      }
    }
  }

  return i;
}

// Inspects a sigil starting at the '~' at pos and, if it is a valid sigil, pushes the
// matching scan context (sigil or sigilTriple) onto the stack and returns the position at
// which body scanning should resume (just past the opening delimiter). Returns pos
// unchanged when the construct is not a valid sigil (caller then advances by one char).
// This mirrors the pre-scan portion of the former skipNestedSigil.
function pushSigilContext(source: string, pos: number, stack: ScanContext[]): number {
  // pos points to '~', pos+1 is the sigil letter
  const sigilChar = source[pos + 1];
  const isLowercase = /[a-z]/.test(sigilChar);

  // Skip past sigil letter(s) to find delimiter.
  // Elixir 1.18+ allows multi-letter lowercase sigils (e.g., ~html, ~json) in addition
  // to multi-letter uppercase custom sigils.
  let delimiterPos = pos + 2;
  if (/[a-zA-Z]/.test(sigilChar)) {
    while (delimiterPos < source.length && /[a-zA-Z]/.test(source[delimiterPos])) {
      delimiterPos++;
    }
  }

  if (delimiterPos >= source.length) {
    return pos;
  }

  const openDelimiter = source[delimiterPos];
  const closeDelimiter = getSigilCloseDelimiter(openDelimiter);

  if (!closeDelimiter) {
    return pos;
  }

  // Check for heredoc-style triple-quote delimiter (~s""", ~s''', ~S""", ~S''')
  if (
    (openDelimiter === '"' || openDelimiter === "'") &&
    delimiterPos + 2 < source.length &&
    source[delimiterPos + 1] === openDelimiter &&
    source[delimiterPos + 2] === openDelimiter
  ) {
    stack.push({ kind: 'sigilTriple', tripleDelim: openDelimiter.repeat(3), isLowercase, isHeredoc: false });
    return delimiterPos + 3;
  }

  stack.push({ kind: 'sigil', openDelimiter, closeDelimiter, isPaired: openDelimiter !== closeDelimiter, isLowercase, depth: 1 });
  return delimiterPos + 1;
}

// Matches sigil (~r/.../, ~s(...), ~w[...], etc)
export function matchSigil(source: string, pos: number, skipInterpolation: SkipInterpolationFn): ExcludedRegion | null {
  const nextChar = source[pos + 1];

  // Must be a valid sigil specifier (letter)
  if (!/[a-zA-Z]/.test(nextChar)) {
    return null;
  }

  // Find delimiter position. Elixir 1.18+ allows multi-letter lowercase sigils
  // (e.g., ~html, ~json) in addition to uppercase custom sigils.
  let delimiterPos = pos + 2;
  if (/[a-zA-Z]/.test(nextChar)) {
    while (delimiterPos < source.length && /[a-zA-Z]/.test(source[delimiterPos])) {
      delimiterPos++;
    }
  }

  if (delimiterPos >= source.length) {
    return null;
  }

  const openDelimiter = source[delimiterPos];
  const closeDelimiter = getSigilCloseDelimiter(openDelimiter);

  if (!closeDelimiter) {
    return null;
  }

  // Check for heredoc-style sigil (~S""")
  if (source.slice(delimiterPos, delimiterPos + 3) === '"""' || source.slice(delimiterPos, delimiterPos + 3) === "'''") {
    const tripleDelim = source.slice(delimiterPos, delimiterPos + 3);
    const isLowercase = /[a-z]/.test(nextChar);
    let i = delimiterPos + 3;
    let isSigilHeredoc = false;
    while (i < source.length) {
      if (source[i] === '\n' || source[i] === '\r') {
        isSigilHeredoc = true;
      }
      // Handle escape sequences (lowercase: all escapes; uppercase: only escaped closing delimiter)
      if (source[i] === '\\' && i + 1 < source.length) {
        if (isLowercase || source[i + 1] === tripleDelim[0] || source[i + 1] === '\\') {
          i += 2;
          continue;
        }
      }
      // Handle #{} interpolation for lowercase sigils
      if (isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
        i = skipInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === tripleDelim && (!isSigilHeredoc || isAtLineStartAllowingWhitespace(source, i))) {
        // Tentatively skip optional modifiers after closing (stop before reserved words like end/do/def)
        const end = skipSigilModifiers(source, i + 3);
        // Heredoc terminator requires non-identifier-continuation char (or EOF) after
        // modifiers; otherwise the """ is not a real terminator (sigil body continues).
        if (!isSigilHeredoc || isLineEndAfterSigilTerminator(source, end)) {
          return { start: pos, end };
        }
      }
      i++;
    }
    return { start: pos, end: source.length };
  }

  let i = delimiterPos + 1;
  let depth = 1;
  const isPaired = openDelimiter !== closeDelimiter;
  const isLowercase = /[a-z]/.test(nextChar);

  while (i < source.length && depth > 0) {
    // Handle escape sequences (lowercase: all escapes; uppercase: only escaped closing delimiter)
    if (source[i] === '\\' && i + 1 < source.length) {
      if (isLowercase || source[i + 1] === closeDelimiter || source[i + 1] === '\\') {
        i += 2;
        continue;
      }
    }
    // Handle #{} interpolation for lowercase sigils
    if (isLowercase && source[i] === '#' && i + 1 < source.length && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 2);
      continue;
    }
    if (isPaired && source[i] === openDelimiter) {
      depth++;
    } else if (source[i] === closeDelimiter) {
      depth--;
    }
    i++;
  }

  // Skip optional modifiers after closing delimiter (stop before reserved words like end/do/def)
  i = skipSigilModifiers(source, i);

  return { start: pos, end: i };
}
