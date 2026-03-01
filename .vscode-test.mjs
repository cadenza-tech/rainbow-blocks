import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  tests: [
    {
      files: 'out/test/**/*.test.js',
      mocha: {
        timeout: 60000
      },
      launchArgs: ['--disable-extensions']
    }
  ],
  coverage: {
    exclude: ['**/test/**'],
    reporter: ['text', 'html', 'json']
  }
});
