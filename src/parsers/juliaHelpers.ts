// Julia helper functions: pure utility functions with no parser state dependencies

// Checks if single quote at position is a transpose operator (not a character literal)
export function isTransposeOperator(source: string, pos: number): boolean {
  if (pos === 0) {
    return false;
  }

  const prevChar = source[pos - 1];

  // Transpose follows closing brackets or dot (broadcasted adjoint: A.')
  if (prevChar === ')' || prevChar === ']' || prevChar === '}' || prevChar === '.') {
    return true;
  }

  // Double transpose: A'' (second ' is also transpose)
  if (prevChar === "'") {
    return true;
  }

  // Transpose follows identifiers or Unicode letters
  if (/[\w]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
    return true;
  }

  return false;
}

// Skips a character literal (for use inside interpolation scanning)
export function skipCharLiteral(source: string, pos: number): number {
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      // Don't let escape skip past newline - character literals can't span lines
      if (source[i + 1] === '\n' || source[i + 1] === '\r') {
        return i + 1;
      }
      i += 2;
      continue;
    }
    if (source[i] === "'") {
      return i + 1;
    }
    // Character literals don't span lines
    if (source[i] === '\n' || source[i] === '\r') {
      return i;
    }
    i++;
  }
  return i;
}

// Skips a prefixed string (no interpolation except b"...") inside interpolation
export function skipPrefixedStringInInterpolation(source: string, pos: number, hasEscapes = false): number {
  // Check for triple-quoted prefixed string
  if (source.slice(pos, pos + 3) === '"""') {
    let i = pos + 3;
    while (i < source.length) {
      if (hasEscapes && source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        i += 3;
        while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
        return i;
      }
      i++;
    }
    return source.length;
  }
  // Regular prefixed string
  let i = pos + 1;
  while (i < source.length) {
    if (hasEscapes && source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '"') {
      i++;
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      return i;
    }
    i++;
  }
  return source.length;
}

// Skips a nested string inside interpolation (handles both regular and triple-quoted)
export function skipNestedJuliaString(source: string, pos: number): number {
  // Check for triple-quoted string
  if (source.slice(pos, pos + 3) === '"""') {
    let i = pos + 3;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '"""') {
        return i + 3;
      }
      i++;
    }
    return i;
  }
  // Regular double-quoted string
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
      i = skipJuliaInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '"') {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Skips a backtick command string (for use inside interpolation/nested string scanning)
export function skipBacktickString(source: string, pos: number): number {
  // Check for triple backtick
  if (source.slice(pos, pos + 3) === '```') {
    let i = pos + 3;
    while (i < source.length) {
      if (source[i] === '\\' && i + 1 < source.length) {
        i += 2;
        continue;
      }
      if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
        i = skipJuliaInterpolation(source, i + 2);
        continue;
      }
      if (source.slice(i, i + 3) === '```') {
        return i + 3;
      }
      i++;
    }
    return i;
  }
  // Single backtick
  let i = pos + 1;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (source[i] === '$' && i + 1 < source.length && source[i + 1] === '(') {
      i = skipJuliaInterpolation(source, i + 2);
      continue;
    }
    if (source[i] === '`') {
      return i + 1;
    }
    i++;
  }
  return i;
}

// Skips $() interpolation block, tracking paren depth
export function skipJuliaInterpolation(source: string, pos: number): number {
  let depth = 1;
  let i = pos;
  while (i < source.length && depth > 0) {
    // Handle #= multi-line comments inside interpolation
    if (source[i] === '#' && i + 1 < source.length && source[i + 1] === '=') {
      i += 2;
      let commentDepth = 1;
      while (i < source.length && commentDepth > 0) {
        if (source.slice(i, i + 2) === '#=') {
          commentDepth++;
          i += 2;
          continue;
        }
        if (source.slice(i, i + 2) === '=#') {
          commentDepth--;
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    // Handle # line comments inside interpolation
    if (source[i] === '#') {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i++;
      }
      continue;
    }
    // Handle char literals inside interpolation (e.g. ')')
    if (source[i] === "'" && !isTransposeOperator(source, i)) {
      i = skipCharLiteral(source, i);
      continue;
    }
    // Handle backtick command strings inside interpolation
    if (source[i] === '`') {
      i = skipBacktickString(source, i);
      continue;
    }
    if (source[i] === '(') {
      depth++;
    } else if (source[i] === ')') {
      depth--;
    } else if (source[i] === '"') {
      // Check for prefixed string (string macro like r"...", raw"...", etc.)
      // Prefixed strings have no interpolation support
      if (i > pos) {
        let prefixStart = i - 1;
        while (prefixStart >= pos && /[a-zA-Z0-9_]/.test(source[prefixStart])) {
          prefixStart--;
        }
        prefixStart++;
        if (prefixStart < i && /[a-zA-Z]/.test(source[prefixStart])) {
          const prefixText = source.slice(prefixStart, i);
          i = skipPrefixedStringInInterpolation(source, i, prefixText === 'b');
          continue;
        }
      }
      i = skipNestedJuliaString(source, i);
      continue;
    }
    i++;
  }
  return i;
}

// Checks if colon at position starts a symbol (not ternary or type annotation)
export function isSymbolStart(source: string, pos: number): boolean {
  const nextChar = source[pos + 1];
  if (!nextChar) {
    return false;
  }

  // Symbol must start with letter, underscore, @, or certain operators
  if (!/[\w!%&*+\-/<=>?\\^|~@]/.test(nextChar) && nextChar.charCodeAt(0) <= 127) {
    return false;
  }

  // Colon after identifier/number/bracket is ternary, not symbol
  // :: (type annotation) second colon is not a symbol start
  if (pos > 0) {
    const prevChar = source[pos - 1];
    if (prevChar === ':' || /[\w)\]}]/.test(prevChar) || prevChar.charCodeAt(0) > 127) {
      return false;
    }
  }

  return true;
}
