import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const testId = process.env.VSCODE_TEST_ID;
const profileLaunchArgs = testId
  ? [`--user-data-dir=${join(tmpdir(), `rb-test-${testId}`, 'user')}`, `--extensions-dir=${join(tmpdir(), `rb-test-${testId}`, 'ext')}`]
  : [];

export default defineConfig({
  tests: [
    {
      files: 'out/test/**/*.test.js',
      mocha: {
        timeout: 60000
      },
      launchArgs: ['--disable-extensions', ...profileLaunchArgs]
    }
  ],
  coverage: {
    exclude: ['**/test/**'],
    reporter: ['text', 'html', 'json']
  }
});
