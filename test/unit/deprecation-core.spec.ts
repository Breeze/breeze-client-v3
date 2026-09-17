import { struckThrough, breezePath } from '../support/deprecation-probe';

// Six `core` members are now exactly a JavaScript built-in, and are marked `@deprecated` so that
// an editor says so. As in deprecation.spec.ts, `tsc` never reports deprecation - it is a
// language-service feature - so asking the language service is the only way to know the tag
// reaches anybody.
//
// These are marked on the properties of the `core` object literal rather than on the functions,
// because the deprecated thing is the *access path*: `breeze.core.stringEndsWith` is what an
// application should stop writing. Breeze itself imports the same functions by name from
// `core/core.ts`, so nothing inside the library reads a member it tells applications not to use -
// which is also why a `@deprecated` on the function itself would have been wrong.

const DEPRECATED = [
  `core.hasOwnProperty({}, 'x')`,
  `core.arraySlice([1, 2, 3], 1)`,
  `core.arrayFlatMap([[1], [2]] as any[], (x: any) => x)`,
  `core.getUuid()`,
  `core.stringStartsWith('abc', 'a')`,
  `core.stringEndsWith('abc', 'c')`,
];

// The rest of `core` is not deprecated, and a stray tag on the object literal would be easy to
// miss. A few of the ones most likely to be confused with the list above.
const NOT_DEPRECATED = [
  `core.toArray(1)`,
  `core.arrayEquals([1], [1])`,
  `core.arrayFirst([1], (x: number) => x === 1)`,
  `core.isEmpty({})`,
  `core.formatString('%1', 'a')`,
  `core.extend({}, {})`,
  `core.getMapArray(new Map<string, any[]>(), 'k')`,
  `core.durationToSeconds('PT1S')`,
];

const ALL = [...DEPRECATED, ...NOT_DEPRECATED];

const header = `
import { core } from '${breezePath}';
function probe() {
`;

describe('the deprecated core members', () => {

  let struck: Set<string>;
  beforeAll(() => {
    struck = struckThrough(header, ALL, expr => `  ${expr};`);
  }, 30_000);

  test.each(DEPRECATED)('%s is marked deprecated', expr => {
    expect(struck.has(expr)).toBe(true);
  });

  test.each(NOT_DEPRECATED)('%s is not', expr => {
    expect(struck.has(expr)).toBe(false);
  });
});
