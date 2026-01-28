// VS Code decoration management for block keyword highlighting

import * as vscode from 'vscode';
import type { BlockPair, ColorConfig, Token } from './types';

// Manages text decorations for block keyword highlighting
// Creates colored decorations based on nesting level and applies them to editors
export class BlockDecorator implements vscode.Disposable {
  private decorationTypes: Map<number, vscode.TextEditorDecorationType> = new Map();
  private config: ColorConfig;

  constructor(config: ColorConfig) {
    this.config = config;
    this.createDecorationTypes();
  }

  // Creates decoration types for each color in the configuration
  private createDecorationTypes(): void {
    for (let i = 0; i < this.config.colors.length; i++) {
      const decorationType = vscode.window.createTextEditorDecorationType({
        color: this.config.colors[i],
        fontWeight: 'bold'
      });
      this.decorationTypes.set(i, decorationType);
    }
  }

  // Applies decorations to block keywords based on their nesting level
  applyDecorations(editor: vscode.TextEditor, pairs: BlockPair[]): void {
    // Initialize decoration arrays for each color level
    const decorationsByLevel = new Map<number, vscode.DecorationOptions[]>();
    for (let i = 0; i < this.config.colors.length; i++) {
      decorationsByLevel.set(i, []);
    }

    // Collect decorations for each block pair
    for (const pair of pairs) {
      const colorIndex = pair.nestLevel % this.config.colors.length;
      const decorations = decorationsByLevel.get(colorIndex);
      if (!decorations) continue;

      // Add decorations for open, intermediate, and close keywords
      decorations.push(this.createDecorationOption(editor.document, pair.openKeyword));
      for (const intermediate of pair.intermediates) {
        decorations.push(this.createDecorationOption(editor.document, intermediate));
      }
      decorations.push(this.createDecorationOption(editor.document, pair.closeKeyword));
    }

    // Apply collected decorations to the editor
    for (const [level, decorations] of decorationsByLevel) {
      const decorationType = this.decorationTypes.get(level);
      if (decorationType) {
        editor.setDecorations(decorationType, decorations);
      }
    }
  }

  // Creates a decoration option from a token's position
  private createDecorationOption(document: vscode.TextDocument, token: Token): vscode.DecorationOptions {
    return {
      range: new vscode.Range(document.positionAt(token.startOffset), document.positionAt(token.endOffset))
    };
  }

  // Clears all decorations from an editor
  clearDecorations(editor: vscode.TextEditor): void {
    for (const decorationType of this.decorationTypes.values()) {
      editor.setDecorations(decorationType, []);
    }
  }

  // Disposes all decoration types (called on extension deactivation)
  dispose(): void {
    for (const decorationType of this.decorationTypes.values()) {
      decorationType.dispose();
    }
    this.decorationTypes.clear();
  }

  // Updates configuration and recreates decoration types
  updateConfig(config: ColorConfig): void {
    this.dispose();
    this.config = config;
    this.createDecorationTypes();
  }
}
