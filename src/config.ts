// Configuration loading and validation for Rainbow Blocks extension

import * as vscode from 'vscode';
import type { ColorConfig } from './types';

// Default highlight colors (red, yellow, blue)
export const DEFAULT_COLORS = ['#E07080', '#E0E070', '#70B0E0'] as const;

// Default debounce delay in milliseconds
export const DEFAULT_DEBOUNCE_MS = 100;

// Minimum allowed debounce delay
export const MIN_DEBOUNCE_MS = 0;

// Maximum allowed debounce delay
export const MAX_DEBOUNCE_MS = 10000;

// Fallback color for invalid hex values (magenta for visibility)
export const INVALID_COLOR_FALLBACK = '#FF00FF';

// Validates whether a string is a valid hex color code
// Accepts formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color);
}

// Validates color array, replacing invalid colors with fallback
function validateColors(colors: string[]): string[] {
  return colors.map((color) => (isValidHexColor(color) ? color : INVALID_COLOR_FALLBACK));
}

// Loads and validates extension configuration from VS Code settings
export function loadConfig(): ColorConfig {
  const config = vscode.workspace.getConfiguration('rainbowBlocks');

  const rawColors = config.get<string[]>('colors', [...DEFAULT_COLORS]);
  const colors = Array.isArray(rawColors) ? rawColors : [...DEFAULT_COLORS];
  const rawDebounce = config.get<number>('debounceMs', DEFAULT_DEBOUNCE_MS);
  const debounceMs = typeof rawDebounce === 'number' && !Number.isNaN(rawDebounce) ? rawDebounce : DEFAULT_DEBOUNCE_MS;

  const validatedColors = colors.length > 0 ? validateColors(colors) : [...DEFAULT_COLORS];

  return {
    colors: validatedColors,
    debounceMs: Math.max(MIN_DEBOUNCE_MS, Math.min(MAX_DEBOUNCE_MS, debounceMs))
  };
}
