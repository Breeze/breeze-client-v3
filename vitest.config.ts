import { defineConfig } from 'vitest/config';
import { AlphabeticalSequencer } from './test/sequencer';

/**
 * Node-environment run. This is `npm test`.
 *
 * For the browser run - which is where a browser library should ultimately be
 * tested - see vitest.browser.config.ts and `npm run test:browser`.
 */
export default defineConfig({
  test: {
    // Jest-style globals, so the ported specs keep using describe/test/expect
    // without an import in every file.
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    // Rebuilds BreezeTestDb once per run. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],
    // The integration tier shares one database and one server. Until the suite
    // is split and each file resets its own state, it must stay serial.
    fileParallelism: false,
    sequence: {
      shuffle: false,
      sequencer: AlphabeticalSequencer,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
