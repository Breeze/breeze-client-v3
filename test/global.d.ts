// jest-extended's matchers are registered on Vitest's expect in test/setup.ts. Its types
// describe them for Jest, so hand the same interface to Vitest's Assertion as well.
import 'jest-extended';
import 'vitest';

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers<any> {}
  interface ExpectStatic extends CustomMatchers<any> {}
}
