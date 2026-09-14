import { defineConfig } from 'vitest/config';
import { breezeAlias } from './vitest.shared.config.js';

/**
 * Unit tier - `npm run test:unit`.
 *
 * The 14 spec files under test/unit need no server and no database. They run against
 * checked-in metadata fixtures, or against AjaxFakeAdapter where a response is required.
 *
 * Consequently: no globalSetup, no database rebuild, and files run in parallel. This is
 * the tier to iterate against.
 */
export default defineConfig({
  resolve: { alias: breezeAlias },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
  },
});
