import { defineConfig } from 'vitest/config';
import { breezeAlias } from './vitest.shared.config.js';

/**
 * Node-environment run. This is `npm test`.
 *
 * For the browser run - which is where a browser library should ultimately be
 * tested - see vitest.browser.config.ts and `npm run test:browser`.
 */
export default defineConfig({
  resolve: { alias: breezeAlias },
  test: {
    // Jest-style globals, so the ported specs keep using describe/test/expect
    // without an import in every file.
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // integration-setup.ts resets the database before each integration file.
    setupFiles: ['./test/setup.ts', './test/integration-setup.ts'],
    // Rebuilds and snapshots BreezeTestDb once per run. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],
    // The integration tier shares one database and one server. Each file reverts the
    // database before it runs, so files must not run alongside each other.
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
