// jest-extended supplies matchers the ported suite relies on (toBeTrue,
// toEqualCaseInsensitive, ...). Vitest's expect is Chai-based but jest-compatible
// enough to take them via expect.extend.
import * as matchers from 'jest-extended';
import { expect } from 'vitest';

expect.extend(matchers as any);
