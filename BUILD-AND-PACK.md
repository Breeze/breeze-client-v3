# Building and packing breeze-client

How to build the package, pack it into a tarball, and install that tarball into another
application to try it without publishing to npm.

Everything below was run end to end before being written down.

---

## TL;DR

```bash
npm run pack
```

That builds `dist/`, stages it as a complete package, and writes `breeze-client-3.0.0.tgz`
in the repo root. Then, in the app you want to test with:

```bash
npm install C:/GitHub/breeze-client-v3/breeze-client-3.0.0.tgz
```

and `import { EntityManager } from 'breeze-client'` works exactly as it would from npm.

---

## What `npm run build` does

```bash
npm run build
```

1. `tsc -p tsconfig.build.json` compiles `src/` to `dist/` — 45 `.js`, 45 `.d.ts`, and source
   maps with their sources inlined.
2. `node scripts/prepare-dist.mjs` turns `dist/` into a **package root**: it writes
   `dist/package.json` and copies `README.md` and `LICENSE` in.

After it, `dist/` looks like an installed `node_modules/breeze-client`:

```
dist/
  package.json      <- written by prepare-dist
  README.md         <- copied
  LICENSE           <- copied
  breeze.js
  breeze.d.ts
  adapters/ config/ core/ entity/ manager/ metadata/ mixins/ query/ validation/
```

`dist/` is gitignored, so none of this is committed.

### Why the manifest is generated rather than checked in

The published package has `dist/` as its root, so every path in the manifest loses its
`./dist/` prefix — `"./dist/breeze.js"` becomes `"./breeze.js"`. The exports map has nine
entries, and keeping a second copy in step by hand is exactly the kind of thing that silently
rots. So `prepare-dist` derives it from the root `package.json` instead, and throws if it
finds a path that is not under `dist/`, since such a path could not be published from there.

Three fields are deliberately **not** carried over:

| dropped | why |
|---|---|
| `files` | it lists `"dist"`, which from inside `dist` means `dist/dist`. The tarball would contain nothing but the README and LICENSE |
| `scripts` | build and test scripts mean nothing in a published package, and a stray lifecycle script would run on every install |
| `devDependencies` | not needed to consume the package |

Two are added, for tooling that does not read `exports`:

| added | value |
|---|---|
| `main` | `./breeze.js` |
| `types` | `./breeze.d.ts` |

---

## Packing

```bash
npm run pack        # = npm run build && npm pack ./dist
```

> ### `npm pack dist` is not the same thing
>
> npm reads a bare argument as a **package spec**, not a path. `npm pack dist` goes to the
> registry, finds the package actually named `dist`, and writes `dist-0.1.2.tgz` — no error,
> just the wrong tarball.
>
> The `./` is what makes it a path: `npm pack ./dist`. `npm run pack` spells it correctly.

The result is `breeze-client-3.0.0.tgz`, 138 files, with the package at the tarball root:

```
package/package.json
package/README.md
package/LICENSE
package/breeze.js
package/breeze.d.ts
package/adapters/...
```

`*.tgz` is gitignored.

---

## Installing it into another app

From the consuming app, install the tarball by path. An absolute path is the least
surprising:

```bash
npm install C:/GitHub/breeze-client-v3/breeze-client-3.0.0.tgz
```

A relative path works too, resolved from the app's directory:

```bash
npm install ../breeze-client-v3/breeze-client-3.0.0.tgz
```

npm records it in the app's `package.json` as `"breeze-client": "file:../..."`, so remember
to take that out before committing the app.

### Re-testing after a change

npm caches by path and content, so after rebuilding you usually want:

```bash
# in breeze-client-v3
npm run pack

# in the app
npm install C:/GitHub/breeze-client-v3/breeze-client-3.0.0.tgz --force
```

`--force` because the filename does not change between builds. If the app still seems to be
running the old code, delete `node_modules/breeze-client` and install again.

### What to check once it is installed

```ts
import { EntityManager, EntityQuery } from 'breeze-client';
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';

const em = new EntityManager('/breeze/NorthwindIBModel');
const q = EntityQuery.from('Customers').take(1);
const { results } = await em.executeQuery(q);
```

That covers the root import, a subpath import, and one query end to end — which is what the
suite cannot cover, because it imports `src/` directly.

---

## TypeScript resolution

The package is ESM-only with an `exports` map. Verified against a consumer:

| `moduleResolution` | root import | subpath imports |
|---|---|---|
| `NodeNext` / `node16` | yes | yes |
| `bundler` (Vite, webpack, esbuild) | yes | yes |
| `node10` / `node` | yes | **no** |

`NodeNext` was checked with `strict: true` **and `skipLibCheck: false`**, so the shipped
`.d.ts` files are themselves type-checked, not just skipped. No errors.

### Why `node10` cannot follow the subpaths

`node10` is the legacy resolution mode; it predates `exports` and cannot map
`breeze-client/adapter-ajax-fetch` to `adapters/adapter-ajax-fetch.d.ts`. The root import
works only because of the `types` field.

Supporting subpaths there would mean shipping stub `.js` and `.d.ts` pairs at the package root
for all seven subpaths, which bypasses the exports map and doubles the published surface. It is
not done: the package declares `node >= 20` and ships ESM only, so a `node10` consumer has
larger problems than the subpaths.

Adding an `index.d.ts` would not change any of this. `types` already covers the only case
`node10` can resolve, and every other mode reads `exports`.

---

## Troubleshooting

| symptom | cause |
|---|---|
| a tarball called `dist-0.1.2.tgz` | `npm pack dist` without the `./`. See above |
| `prepare-dist: dist/ does not exist` | `tsc` did not run or failed. Run `npm run build` |
| `prepare-dist: '…' is not inside dist/` | a path was added to `exports` that points outside `dist/`; it cannot be published from there |
| `ERR_MODULE_NOT_FOUND` in the consuming app | usually an extensionless relative import in `src/`. `tsconfig.json` uses `NodeNext`, which makes those a compile error — so this should not reach a build |
| `Cannot find module 'breeze-client/…'` in the app's editor | the app is on `moduleResolution: node10`. Move it to `bundler` or `NodeNext` |
| the app still runs old code | npm cached the tarball. Reinstall with `--force`, or delete `node_modules/breeze-client` |

---

## Publishing for real

Not part of this workflow, and not yet set up. When it is, the command is
`npm publish ./dist` — the same directory, so what gets published is exactly what
`npm run pack` has been producing and what you have been testing against.
