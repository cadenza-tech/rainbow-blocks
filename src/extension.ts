// Extension entry point: event listeners, parser routing, and decoration coordination

import * as vscode from 'vscode';
import { loadConfig } from './config';
import { BlockDecorator } from './decorator';
import {
  type BaseBlockParser,
  BashBlockParser,
  CrystalBlockParser,
  ElixirBlockParser,
  JuliaBlockParser,
  LuaBlockParser,
  RubyBlockParser
} from './parsers';

// Supported language IDs mapped to their parser factory functions
const SUPPORTED_LANGUAGES: Readonly<Record<string, () => BaseBlockParser>> = {
  ruby: () => new RubyBlockParser(),
  elixir: () => new ElixirBlockParser(),
  crystal: () => new CrystalBlockParser(),
  lua: () => new LuaBlockParser(),
  julia: () => new JuliaBlockParser(),
  shellscript: () => new BashBlockParser(),
  bash: () => new BashBlockParser()
};

// Configuration section name in VS Code settings
const CONFIG_SECTION = 'rainbowBlocks';

// Cache for parser instances to avoid repeated instantiation
const parserCache = new Map<string, BaseBlockParser>();

// Returns the parser for a language ID, or undefined if not supported
function getParser(languageId: string): BaseBlockParser | undefined {
  if (!(languageId in SUPPORTED_LANGUAGES)) {
    return undefined;
  }

  if (!parserCache.has(languageId)) {
    parserCache.set(languageId, SUPPORTED_LANGUAGES[languageId]());
  }

  return parserCache.get(languageId);
}

// Activates the extension: initializes decorator and registers event listeners
export function activate(context: vscode.ExtensionContext): void {
  let currentConfig = loadConfig();
  const decorator = new BlockDecorator(currentConfig);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Register decorator for automatic disposal
  context.subscriptions.push(decorator);

  // Register debounce timer cleanup
  context.subscriptions.push({
    dispose: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    }
  });

  // Updates decorations after debounce delay to avoid excessive updates
  function updateDecorationsDebounced(editor: vscode.TextEditor | undefined): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      updateDecorations(editor);
    }, currentConfig.debounceMs);
  }

  // Updates decorations immediately for the given editor
  function updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;

    const parser = getParser(editor.document.languageId);
    if (!parser) {
      decorator.clearDecorations(editor);
      return;
    }

    const text = editor.document.getText();
    const pairs = parser.parse(text);
    decorator.applyDecorations(editor, pairs);
  }

  // Listen for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateDecorations(editor);
    })
  );

  // Listen for document changes (with debounce)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        updateDecorationsDebounced(editor);
      }
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        currentConfig = loadConfig();
        decorator.updateConfig(currentConfig);
        updateDecorations(vscode.window.activeTextEditor);
      }
    })
  );

  // Apply decorations to the initially active editor
  updateDecorations(vscode.window.activeTextEditor);
}

// Deactivates the extension (cleanup handled via subscriptions)
export function deactivate(): void {
  parserCache.clear();
}
