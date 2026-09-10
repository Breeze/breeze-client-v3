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
export class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}
