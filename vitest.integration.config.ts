import { defineConfig } from 'vitest/config';
import { AlphabeticalSequencer } from './test/sequencer';

/**
 * Integration tier - `npm run test:integration`.
 *
 * The 26 spec files under test/integration require the .NET test server on
 * http://localhost:34377 and the BreezeTestDb database. They query and save real data.
 *
 * They share one database, so:
 *  - globalSetup rebuilds it once per run (test/global-setup.ts)
 *  - fileParallelism is off
 *  - the file order is pinned, because several still assert on rows another file created
 *
 * Per-file isolation is the remaining work; see STATUS.md.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    sequence: {
      shuffle: false,
      sequencer: AlphabeticalSequencer,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
