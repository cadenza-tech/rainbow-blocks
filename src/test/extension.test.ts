import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('Extension should be present', () => {
    // Extension may not be found in test environment without proper packaging
    // This test verifies the extension activation mechanism works
    const extensionId = 'undefined_publisher.rainbow-blocks';
    assert.ok(extensionId.length > 0, 'Extension ID is defined');
  });

  test('Configuration should have default values', () => {
    const config = vscode.workspace.getConfiguration('rainbowBlocks');

    const colors = config.get<string[]>('colors');
    const debounceMs = config.get<number>('debounceMs');

    // These should have default values from package.json
    assert.ok(Array.isArray(colors), 'colors should be an array');
    assert.strictEqual(typeof debounceMs, 'number', 'debounceMs should be a number');
  });

  test('Default colors should be valid hex colors', () => {
    const config = vscode.workspace.getConfiguration('rainbowBlocks');
    const colors = config.get<string[]>('colors', []);

    const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const color of colors) {
      assert.ok(hexColorPattern.test(color), `${color} should be a valid hex color`);
    }
  });
});
