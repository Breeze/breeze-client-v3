// Stage dist/ as a publishable package: `npm pack dist` produces breeze-client-<version>.tgz,
// and installing that tarball elsewhere is the same as installing from npm.
//
// The published package has dist/ as its ROOT, so every path in the manifest loses the `./dist/`
// prefix. That is why this is a transformation of the root package.json rather than a second file
// to keep in step - the exports map has nine entries and is the thing most likely to drift.
//
// Run by `npm run build`.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

if (!existsSync(dist)) {
  console.error('prepare-dist: dist/ does not exist - run tsc first');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** './dist/breeze.js' -> './breeze.js'; anything outside dist/ is a mistake, so it throws. */
const reroot = (p) => {
  if (typeof p !== 'string') return p;
  if (p === './package.json') return p;          // the exports entry for the manifest itself
  if (!p.startsWith('./dist/')) {
    throw new Error(`prepare-dist: '${p}' is not inside dist/, so it cannot be published from there`);
  }
  return './' + p.slice('./dist/'.length);
};

const rerootDeep = (v) =>
  typeof v === 'string' ? reroot(v)
  : Array.isArray(v) ? v.map(rerootDeep)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rerootDeep(x)]))
  : v;

const published = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  author: pkg.author,
  contributors: pkg.contributors,
  homepage: pkg.homepage,
  repository: pkg.repository,
  bugs: pkg.bugs,
  keywords: pkg.keywords,
  engines: pkg.engines,
  type: pkg.type,
  // For tooling that predates `exports`: bundlers on their old resolution path, and TypeScript
  // with moduleResolution "node". `exports` wins wherever it is understood.
  main: reroot(pkg.exports['.'].default),
  types: reroot(pkg.exports['.'].types),
  exports: rerootDeep(pkg.exports),
  sideEffects: rerootDeep(pkg.sideEffects),
  // `npx breeze-gen-entities`. The script is copied into dist/ below; npm sets the exec bit on
  // whatever `bin` points at, so the shebang is all it needs.
  bin: rerootDeep(pkg.bin),
};

// Deliberately NOT carried over:
//   files           - it lists "dist", and from inside dist that means dist/dist. The tarball
//                     would contain nothing but the README and LICENSE.
//   scripts         - build and test scripts have no meaning in the published package, and a
//                     stray lifecycle script would run on every install.
//   devDependencies - not needed to consume the package.
for (const dropped of ['files', 'scripts', 'devDependencies']) {
  if (dropped in published) throw new Error(`prepare-dist: ${dropped} should not be published`);
}

mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'package.json'), JSON.stringify(published, null, 2) + '\n', 'utf8');

const copied = [];
for (const name of ['README.md', 'LICENSE']) {
  const from = join(root, name);
  if (existsSync(from)) {
    copyFileSync(from, join(dist, name));
    copied.push(name);
  } else {
    console.warn(`prepare-dist: ${name} not found at the repo root`);
  }
}

// The bin scripts are hand-written JavaScript in scripts/, not tsc output, so they have to be
// copied in. The destination comes from the manifest rather than being spelled twice: whatever
// `bin` points at inside dist/ is what gets copied there.
for (const [command, distPath] of Object.entries(pkg.bin ?? {})) {
  const name = distPath.slice('./dist/'.length);          // reroot() already vetted the prefix
  const from = join(root, 'scripts', name);
  if (!existsSync(from)) {
    console.error(`prepare-dist: bin '${command}' needs scripts/${name}, which does not exist`);
    process.exit(1);
  }
  copyFileSync(from, join(dist, name));
  copied.push(`${name} (bin: ${command})`);
}

console.log(`prepare-dist: dist/package.json written (${Object.keys(published.exports).length} exports), copied ${copied.join(', ')}`);
console.log('             `npm pack dist` now produces a tarball you can npm install from a path.');
