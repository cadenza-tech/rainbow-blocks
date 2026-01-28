// Type definitions for Rainbow Blocks extension

// Token classification for block keyword parsing
export type TokenType =
  | 'block_open' // Opening keywords: do, if, def, class, etc
  | 'block_close' // Closing keywords: end, until (Lua), fi (Bash), etc
  | 'block_middle'; // Intermediate keywords: else, elsif, rescue, etc

// Represents a block keyword token with position information
export interface Token {
  // Token classification (open, close, or middle)
  type: TokenType;
  // The keyword string (e.g., 'do', 'end', 'if')
  value: string;
  // Start position in source (0-based byte offset)
  startOffset: number;
  // End position in source (0-based byte offset, exclusive)
  endOffset: number;
  // Line number (0-based)
  line: number;
  // Column number (0-based)
  column: number;
}

// A matched pair of block keywords with nesting information
export interface BlockPair {
  // Opening keyword token (e.g., 'if', 'do', 'def')
  openKeyword: Token;
  // Closing keyword token (e.g., 'end', 'fi')
  closeKeyword: Token;
  // Intermediate keyword tokens (e.g., 'else', 'elsif', 'rescue')
  intermediates: Token[];
  // Nesting level (0-based, used for color cycling)
  nestLevel: number;
}

// Extension configuration for block highlighting colors
export interface ColorConfig {
  // Array of hex color codes for block highlighting
  colors: string[];
  // Debounce delay in milliseconds for decoration updates
  debounceMs: number;
}

// A region in source code to exclude from keyword detection (comments, strings, etc)
export interface ExcludedRegion {
  // Start position (inclusive, 0-based byte offset)
  start: number;
  // End position (exclusive, 0-based byte offset)
  end: number;
}

// Internal state for tracking open blocks during parsing
export interface OpenBlock {
  // The opening keyword token
  token: Token;
  // Accumulated intermediate keywords for this block
  intermediates: Token[];
}

// Language-specific keyword definitions for block parsing
export interface LanguageKeywords {
  // Block opening keywords (e.g., 'do', 'if', 'def', 'class')
  readonly blockOpen: readonly string[];
  // Block closing keywords (e.g., 'end', 'fi', 'esac')
  readonly blockClose: readonly string[];
  // Intermediate keywords (e.g., 'else', 'elsif', 'rescue')
  readonly blockMiddle: readonly string[];
}
