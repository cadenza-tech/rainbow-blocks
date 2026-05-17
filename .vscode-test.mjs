import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const testId = process.env.VSCODE_TEST_ID;
// Resolve VS Code test profile base relative to this config file's directory.
// In each worktree, .vscode-test.mjs lives at the worktree root, so profiles end up
// under {worktree}/tmp/rb-vscode-test/{testId}/ which is gitignored and self-contained.
const profileBase = testId ? join(import.meta.dirname, 'tmp', 'rb-vscode-test', testId) : null;
const profileLaunchArgs = profileBase ? [`--user-data-dir=${join(profileBase, 'user')}`, `--extensions-dir=${join(profileBase, 'ext')}`] : [];

export default defineConfig({
  tests: [
    {
      files: 'out/test/**/*.test.js',
      mocha: {
        timeout: 60000
      },
      launchArgs: ['--disable-extensions', ...profileLaunchArgs]
    }
  ]
});
