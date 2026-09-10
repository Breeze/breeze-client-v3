import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/**
 * Runs spec files in a fixed alphabetical order.
 *
 * Vitest's default sequencer reorders files by their durations from the previous run
 * (cached in node_modules/.vite/vitest/.../results.json), so the order drifts between
 * runs. That matters here because several tests still assert on rows that another spec
 * file created - change the order and they flip between pass and fail.
 *
 * This does not fix those tests; it makes their behaviour reproducible, so a genuinely
 * broken test can be told apart from one that merely ran before its data existed.
 */
class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

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
