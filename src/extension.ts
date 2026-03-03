// Extension entry point: event listeners, parser routing, and decoration coordination

import * as vscode from 'vscode';
import { loadConfig } from './config';
import { BlockDecorator } from './decorator';
import {
  AdaBlockParser,
  ApplescriptBlockParser,
  type BaseBlockParser,
  BashBlockParser,
  CobolBlockParser,
  CrystalBlockParser,
  ElixirBlockParser,
  ErlangBlockParser,
  FortranBlockParser,
  JuliaBlockParser,
  LuaBlockParser,
  MatlabBlockParser,
  OctaveBlockParser,
  PascalBlockParser,
  RubyBlockParser,
  VerilogBlockParser,
  VhdlBlockParser
} from './parsers';

// Supported language IDs mapped to their parser factory functions
const SUPPORTED_LANGUAGES: Readonly<Record<string, () => BaseBlockParser>> = {
  ada: () => new AdaBlockParser(),
  applescript: () => new ApplescriptBlockParser(),
  bash: () => new BashBlockParser(),
  shellscript: () => new BashBlockParser(),
  cobol: () => new CobolBlockParser(),
  COBOL: () => new CobolBlockParser(),
  crystal: () => new CrystalBlockParser(),
  elixir: () => new ElixirBlockParser(),
  erlang: () => new ErlangBlockParser(),
  fortran: () => new FortranBlockParser(),
  'fortran-modern': () => new FortranBlockParser(),
  FortranFixedForm: () => new FortranBlockParser(),
  FortranFreeForm: () => new FortranBlockParser(),
  julia: () => new JuliaBlockParser(),
  lua: () => new LuaBlockParser(),
  matlab: () => new MatlabBlockParser(),
  octave: () => new OctaveBlockParser(),
  pascal: () => new PascalBlockParser(),
  objectpascal: () => new PascalBlockParser(),
  ruby: () => new RubyBlockParser(),
  verilog: () => new VerilogBlockParser(),
  systemverilog: () => new VerilogBlockParser(),
  vhdl: () => new VhdlBlockParser()
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
  const debounceTimers = new Map<vscode.TextDocument, ReturnType<typeof setTimeout>>();

  // Register decorator for automatic disposal
  context.subscriptions.push(decorator);

  // Register debounce timer cleanup
  context.subscriptions.push({
    dispose: () => {
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
    }
  });

  // Updates decorations after debounce delay for all visible editors showing the given document
  function updateDecorationsDebounced(document: vscode.TextDocument): void {
    const existing = debounceTimers.get(document);
    if (existing) {
      clearTimeout(existing);
    }

    debounceTimers.set(
      document,
      setTimeout(() => {
        debounceTimers.delete(document);
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) {
            updateDecorations(editor);
          }
        }
      }, currentConfig.debounceMs)
    );
  }

  // Updates decorations immediately for the given editor
  function updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;

    const parser = getParser(editor.document.languageId);
    if (!parser) {
      decorator.clearDecorations(editor);
      return;
    }

    try {
      const text = editor.document.getText();
      const pairs = parser.parse(text);
      decorator.applyDecorations(editor, pairs);
    } catch (error) {
      console.error('Rainbow Blocks: Failed to update decorations', error);
      decorator.clearDecorations(editor);
    }
  }

  // Listen for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateDecorations(editor);
    })
  );

  // Listen for document changes in any visible editor (with debounce)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const hasVisibleEditor = vscode.window.visibleTextEditors.some((editor) => editor.document === event.document);
      if (hasVisibleEditor) {
        updateDecorationsDebounced(event.document);
      }
    })
  );

  // Listen for document open events (handles language mode changes and newly opened files)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) {
          updateDecorations(editor);
        }
      }
    })
  );

  // Listen for document close events (clean up pending debounce timers)
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const timer = debounceTimers.get(document);
      if (timer) {
        clearTimeout(timer);
        debounceTimers.delete(document);
      }
    })
  );

  // Listen for visible editor changes (split/unsplit)
  // Skip the active editor since onDidChangeActiveTextEditor already handles it
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      const activeEditor = vscode.window.activeTextEditor;
      for (const editor of editors) {
        if (editor !== activeEditor) {
          updateDecorations(editor);
        }
      }
    })
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        for (const timer of debounceTimers.values()) {
          clearTimeout(timer);
        }
        debounceTimers.clear();
        currentConfig = loadConfig();
        decorator.updateConfig(currentConfig);
        for (const editor of vscode.window.visibleTextEditors) {
          updateDecorations(editor);
        }
      }
    })
  );

  // Apply decorations to all initially visible editors
  for (const editor of vscode.window.visibleTextEditors) {
    updateDecorations(editor);
  }
}

// Deactivates the extension (cleanup handled via subscriptions)
export function deactivate(): void {
  parserCache.clear();
}
