import { defineConfig } from 'vitest/config';
import { breezeAlias } from './vitest.shared.config.js';

/**
 * Retention tier - `npm run test:retention`.
 *
 * Leak tests. They need a full garbage collection on demand, which test/support/retention.ts gets
 * from V8 directly rather than from `--expose-gc`: the flag does not reach a Vitest worker,
 * because the pool forks its children and they do not inherit it.
 *
 * Its own tier because it runs one file at a time and takes longer per test than the unit tier,
 * which is the one to iterate against.
 *
 * These assert WHAT is still reachable, never how many bytes are in use. A heap-size threshold
 * is a flake in CI - the same rule the timing assertions follow, see relation-array-clear.spec.ts.
 */
export default defineConfig({
  resolve: { alias: breezeAlias },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/retention/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
