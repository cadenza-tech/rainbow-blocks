// Erlang block parser: handles single-line comments, strings, and atoms

import type { ExcludedRegion, LanguageKeywords } from '../types';
import { BaseBlockParser } from './baseParser';

export class ErlangBlockParser extends BaseBlockParser {
  protected readonly keywords: LanguageKeywords = {
    blockOpen: ['begin', 'if', 'case', 'receive', 'try', 'fun'],
    blockClose: ['end'],
    blockMiddle: ['of', 'after', 'catch']
  };

  // Finds excluded regions: comments, strings, atoms
  protected findExcludedRegions(source: string): ExcludedRegion[] {
    const regions: ExcludedRegion[] = [];
    let i = 0;

    while (i < source.length) {
      const result = this.tryMatchExcludedRegion(source, i);
      if (result) {
        regions.push(result);
        i = result.end;
      } else {
        i++;
      }
    }

    return regions;
  }

  // Tries to match an excluded region at the given position
  private tryMatchExcludedRegion(source: string, pos: number): ExcludedRegion | null {
    const char = source[pos];

    // Single-line comment: % to end of line
    if (char === '%') {
      return this.matchSingleLineComment(source, pos);
    }

    // Double-quoted string
    if (char === '"') {
      return this.matchQuotedString(source, pos, '"');
    }

    // Single-quoted atom
    if (char === "'") {
      return this.matchAtom(source, pos);
    }

    return null;
  }

  // Matches single-quoted atom with escape handling
  private matchAtom(source: string, pos: number): ExcludedRegion {
    let i = pos + 1;

    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === "'") {
        return { start: pos, end: i + 1 };
      }
      i++;
    }

    return { start: pos, end: source.length };
  }
}
