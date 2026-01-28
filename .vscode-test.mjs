import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  mocha: {
    timeout: 60000
  },
  launchArgs: ['--disable-extensions'],
  coverage: {
    includeAll: true,
    include: ['dist/**/*.js'],
    reporter: ['text', 'html']
  }
});
