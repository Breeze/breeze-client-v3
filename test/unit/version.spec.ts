import { breeze } from '../../src/breeze';
import pkg from '../../package.json';

// breeze.version is written into the source by hand, and stayed at 2.x's "2.1.5" for the whole of
// the 3.0 rewrite. Tying it to package.json makes a release that bumps one and not the other fail.
test("breeze.version is the package's version", () => {
  expect(breeze.version).toBe(pkg.version);
});
