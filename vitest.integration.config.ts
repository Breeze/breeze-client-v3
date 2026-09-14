import { defineConfig } from 'vitest/config';
import { breezeAlias } from './vitest.shared.config.js';

/**
 * Integration tier - `npm run test:integration`.
 *
 * The 27 spec files under test/integration require the .NET test server on
 * http://localhost:34377 and the BreezeTestDb database. They query and save real data.
 *
 * They share one database, so:
 *  - globalSetup rebuilds it once per run and snapshots it (test/global-setup.ts)
 *  - every file starts by reverting to that snapshot (test/integration-setup.ts), so each
 *    passes on its own and in any order
 *  - fileParallelism is off: there is one database, and a revert would pull it out from
 *    under a file running alongside
 */
export default defineConfig({
  resolve: { alias: breezeAlias },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts', './test/integration-setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    // Each integration file resets the database before it runs, so file order does not
    // matter - and shuffling keeps it that way. The seed is printed at the top of the run;
    // repeat an order with --sequence.seed=<seed>. Tests within a file keep their order.
    sequence: {
      shuffle: { files: true, tests: false },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
