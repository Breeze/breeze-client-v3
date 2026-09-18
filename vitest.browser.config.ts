import { configDefaults, defineConfig } from 'vitest/config';
import { breezeAlias } from './vitest.shared.config.js';
import { playwright } from '@vitest/browser-playwright';

/**
 * Browser run - `npm run test:browser`.
 *
 * Breeze is a browser library, but its suite has always run in Node. This executes the
 * same specs in real Chromium, against real `fetch`, a real `Response`, and the browser's
 * own CORS enforcement.
 *
 * Requires:
 *  - the test server on http://localhost:34377, which serves the BreezeTestCors policy;
 *    without it every request fails preflight
 *  - `npx playwright install chromium` once
 *
 * globalSetup still runs in Node, so the per-run database rebuild works unchanged. The
 * per-file reset (test/integration-setup.ts) runs in the browser; it goes over HTTP.
 */
export default defineConfig({
  resolve: { alias: breezeAlias },
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    // These specs check the repository rather than runtime behaviour, and none has what it needs
    // in Chromium: side-effects.spec.ts reads src/ off disk and parses it with the TypeScript
    // API, entity-generator.spec.ts runs scripts/generate-entity-classes.js as a child process
    // against a temp directory, the two deprecation specs drive the TypeScript language
    // service over src/, and the retention tier needs node:v8. There is no fs, no child_process,
    // no compiler and no forced garbage collection in a browser.
    exclude: [
      ...configDefaults.exclude,
      'test/unit/side-effects.spec.ts',
      'test/unit/entity-generator.spec.ts',
      'test/unit/deprecation.spec.ts',
      'test/unit/deprecation-core.spec.ts',
      // The retention tier asks V8 for a garbage collection through node:v8 and node:vm.
      'test/retention/**',
    ],
    setupFiles: ['./test/setup.ts', './test/integration-setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    // Each integration file resets the database before it runs, so file order does not
    // matter - and shuffling keeps it that way. The seed is printed at the top of the run;
    // repeat an order with --sequence.seed=<seed>. Tests within a file keep their order.
    sequence: {
      shuffle: { files: true, tests: false },
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
});
