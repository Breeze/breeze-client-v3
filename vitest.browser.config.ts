import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { AlphabeticalSequencer } from './test/sequencer';

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
 * globalSetup still runs in Node, so the per-run database rebuild works unchanged.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    sequence: {
      shuffle: false,
      sequencer: AlphabeticalSequencer,
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
