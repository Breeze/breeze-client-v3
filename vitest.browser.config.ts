import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { breezeAlias } from './vitest.shared.config.js';
import { playwright } from '@vitest/browser-playwright';

/**
 * Drops one warning that is Vitest's to fix and not ours.
 *
 * In browser mode Vitest hands its mocking plugin to Vite through `applyToEnvironment`, and that
 * plugin carries a `configureServer` hook, which Vite 8 ignores in that position and says so on
 * every run:
 *
 *   Plugin "vitest:mocks:interceptor" defines Vite-specific hooks (configureServer) in a plugin
 *   returned from applyToEnvironment. These hooks will be ignored.
 *
 * Nothing in this suite is affected, the plugin is the same in Vitest 5.0.1, and under PowerShell
 * the line arrives dressed as a red `node.exe : ...` error record in an otherwise green run.
 *
 * Not `customLogger`: Vitest replaces that with its own logger in its config hook, so one given
 * here never takes effect. This wraps `warnOnce` on the logger Vite ends up with, once the config
 * is resolved; Vite reads the method at the moment it warns, so the wrapper applies whichever
 * plugin built the logger. Vitest silences a Vite warning of its own the same way. Only that
 * message, from that plugin, is dropped - every other warning still prints. Remove this once a
 * Vitest release stops producing it.
 */
function silenceMockerHookWarning(): Plugin {
  const isIt = (msg: string) =>
    msg.startsWith('Plugin "vitest:mocks:interceptor" defines Vite-specific hooks');
  return {
    name: 'breeze:silence-mocker-hook-warning',
    configResolved(config) {
      const logger = config.logger;
      const warnOnce = logger.warnOnce.bind(logger);
      const warn = logger.warn.bind(logger);
      logger.warnOnce = (msg, options) => { if (!isIt(msg)) warnOnce(msg, options); };
      logger.warn = (msg, options) => { if (!isIt(msg)) warn(msg, options); };
    },
  };
}

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
  plugins: [silenceMockerHookWarning()],
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
      // The test-database lock: files and child processes, and the lock is taken in Node anyway.
      'test/unit/db-lock.spec.ts',
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
