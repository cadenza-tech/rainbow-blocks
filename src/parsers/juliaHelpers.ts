// Julia helper functions: pure utility functions with no parser state dependencies

// Checks if single quote at position is a transpose operator (not a character literal)
export function isTransposeOperator(source: string, pos: number): boolean {
  if (pos === 0) {
    return false;
  }

  const prevChar = source[pos - 1];

  // Transpose follows closing brackets
  if (prevChar === ')' || prevChar === ']' || prevChar === '}') {
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
