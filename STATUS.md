# breeze-client v3 — status

Work in progress. This file is the handoff record: what is done, what is mid-flight,
and what comes next.

Companion repo: **`breeze-server-v3`** (the .NET server the integration tests run against).

## Decisions locked

| | |
|---|---|
| npm identity | stays `breeze-client`, published as `3.0.0` on the plain `latest` tag |
| Output | **ESM only**, one package, subpath `exports`. No CJS, no UMD, no dist-tags |
| Removed | **Knockout, jQuery, AngularJS, OData** — including CSDL/EDMX metadata parsing |
| Angular | deferred to its own package later; the adapter is parked in `deferred/` |
| Ajax layer | `AjaxAdapter` class + registry slot replaced by an injectable `BreezeFetch` — **transport injection done**; retiring the class and registry slot still to do |
| Config API | `configureBreeze` **done**; the string-based API still works, not yet marked `@deprecated` |
| Tests | full rewrite onto **Vitest**, eventually **browser mode**; split into unit (no server) and integration (server-backed) |

## Done

- Repo created from `breeze-client` 2.2.2 source with the four libraries eliminated.
  **51 files / 19,708 lines → 42 files / 15,630 lines.**
- Removed: 5 adapter files, `csdl-metadata-parser.ts` (430 lines),
  `DataType.fromEdmDataType`, all 20 `fmtOData` entries plus their 11 formatting helpers
  and private `throwError`, the OData v3 `Edm.Time` parse branch, the OData v3 `.results`
  unwrap in `mapping-context.ts`, and the `metadataJson.schema` branch in
  `MetadataStore.importMetadata`. Comment-only mentions were reworded.
  **`grep -ri "knockout\|jquery\|angularjs\|odata\|csdl" src/` returns nothing.**
- Self-referencing `from 'breeze-client'` imports rewritten to relative paths.
- **Builds with a single `tsc`**: `npm run build` → 42 `.js` + 42 `.d.ts` in `dist/`.
  No ng-packagr, no second `node_modules`, no `downlevel-dts`, no Angular.
- `package.json` `exports` map covers the root plus 7 subpaths; all 8 verified to resolve.

## Vitest port — DONE (node environment)

`npm test` runs the suite. **622 passing, 4 failing, 7 skipped of 633 - and it is
deterministic**: two consecutive runs produced an identical pass/fail list.

That is parity with the 2.x Jest baseline of 623–624 of 636 — the totals differ because
`odata-specific.spec.ts` and its 3 tests were dropped with OData.

What the port involved:

- `vitest.config.ts` with `globals: true` (so the ported specs keep bare `describe`/`test`/
  `expect`) and `fileParallelism: false` — the integration tier shares one database and one
  server, so it must stay serial until each file resets its own state.
- `test/setup.ts` registers the `jest-extended` matchers the suite relies on
  (`toBeTrue`, `toEqualCaseInsensitive`).
- Every Node-only dependency removed: the `node-fetch` shim and `initBrowserShims` are
  gone (Node 20+ and browsers both have native `fetch`), the five CJS `require()` calls on
  JSON fixtures are ESM imports, `node-localstorage` is a small in-memory `Map` shim, and
  the unused `assert`, `rxjs/operators` and `typescript` imports are deleted.
- The eight `done`-callback tests in `save-exceptions.spec.ts` became explicit
  `new Promise<void>((done) => {...})`. Naming the resolver `done` left the bodies
  untouched, which matters: the file's header comment warns against converting them to
  `await`, because the point is to mutate the manager *while a save is in flight*.
- `test/support/import-export-test-stash`, a fixture the suite overwrote on every run,
  is deleted.

### Two real bugs the port exposed

Both were pre-existing, and both were invisible under Jest.

1. **`JsonResultsAdapter` declared `_$typeName: string` without `declare`.** Under ES2022
   class-field semantics the constructor defines the field as `undefined`, shadowing the
   value assigned to the prototype, so `EntityQuery.using(jsonResultsAdapter)` could not
   identify its argument. Every other class in the codebase already had `declare`.
   Broke 3 tests.
2. **The fetch adapter set `referrer: 'client'`.** Valid and redundant in a browser;
   Node's `fetch` rejects it as an invalid URL. This broke metadata fetch and with it 26
   of 39 files. Now unset.

Jest hid both because `spec/tsconfig.json` set `"target": "es5"` and `breeze-client` was
excluded from `transformIgnorePatterns`, so the harness compiled the library down to ES5.

### One deliberate breaking change

Same root cause. `Predicate("x", "eq", 1)` without `new` worked in 2.x only because of
that ES5 downlevel. v3 ships real ES2022 classes, so it throws. The test now asserts the
new behaviour and `UPGRADE.md` documents it. **Reversible** — a small compatibility
wrapper can make the constructors callable again if that turns out to matter.

### Remaining 5 failures — all pre-existing, none caused by the port

| Test | Why |
|---|---|
| `where dateOnly & timeOnly` | genuine data gap: the columns exist but were never populated |
| `executeQuery returns before in-cache entities are all attached` | passes in isolation; fails after earlier files pollute the database |
| `nullable dateTime`, `nullable guid == null` | data-state dependent; they rotate between runs |

## Next steps, in order

1. Fix the last 4 failures. One is a genuine data gap (`UnusualDate.DateOnly`/`TimeOnly`
   were never populated). The other three are cross-file dependencies: they assert on rows
   that exist only because *another* spec file created them — employees with a null
   birthDate, orders with a null customerID, and an exact employee count. Each needs to
   create the data it asserts on.
2. Add CORS to the test server, then switch Vitest to browser mode.
3. Split the suite into unit and integration tiers.
4. Retire the `AjaxAdapter` class and the `"ajax"` registry slot in favour of `BreezeFetch`
   alone, and replace the callback-shaped `AjaxConfig` with a promise. This rewrites the
   request path all 27 server-backed spec files exercise.
5. Mark the string-based config API `@deprecated`, and make adapter registration explicit
   so that importing a module no longer registers it.
6. Then the module-by-module TypeScript modernization (see Known issues).
7. Regroup `src/` by concern (`core/`, `metadata/`, `entity/`, `query/`, `manager/`,
   `validation/`, `config/`, `adapters/`, `mixins/`). Deliberately deferred — moving 42
   files and rewriting imports at the same time as deleting code would make any breakage
   impossible to attribute.

## Known issues

- **`noImplicitAny` is `false`** in `tsconfig.json`. The 2.x build hid **106 TS7053
  index-signature errors across 20 files** behind `suppressImplicitAnyIndexErrors`, which
  TypeScript removed in 5.5. They need real fixes; re-enable per module.
- **`strictNullChecks` is `false`**, as in 2.x. Turning it on is the single largest chunk
  of the modernization pass.
- **`"sideEffects": true` in `package.json` must stay true.** 25 classes brand
  `_$typeName` onto their prototypes at import time, ten `Error['x'] = <Enum>.resolveSymbols()`
  calls exist purely to stop a minifier dropping them, and `bubbleEvent` mutates
  `EntityManager.prototype` and `MetadataStore.prototype` on load. Marking the package
  side-effect-free lets a bundler delete all of it and silently breaks serialization.
  The `configureBreeze` work should replace these with explicit initialization.
- `breeze.version` was hardcoded `"2.1.5"` in 2.2.2, and `breeze.assertConfig` /
  `breeze.assertParam` are `null as any` on the `breeze` object literal (the fix is
  sitting commented out at `src/breeze.ts:172-173`). Both carried over — fix during the
  barrel rewrite.

## Baseline the rewrite must hold

Measured against the v3 server on a freshly rebuilt database: **623–624 of 636 passing**.

It moves between runs, and that is a pre-existing property of the suite, not a regression.
The suite both adds rows (`Employee` 9 → 11) and deletes them (`Employee` ID 7 vanishes).

- `query-misc.spec.ts:337` asserts `Employees where employeeID > 10` returns a row.
  Northwind ships 9 employees. It only passes because `bugs.spec.ts:354` permanently
  inserts a "John Doe" employee whose name does not match the cleanup predicate. **A test
  that depends on another file's leftovers.**
- `Unusual Datatypes > where dateOnly & timeOnly` cannot pass at all: the old
  `Add_DateOnly_TimeOnly.sql` adds the columns but never populates them.

**There is no stable pass/fail list to use as a regression contract until the integration
tier resets the database per run.** Re-applying `tests/Databases/BreezeTestDb.sql` in the
server repo is a proven, fast reset — prefer that over patching the cleanup script.

## Running things

```bash
npm install
npm run typecheck      # tsc --noEmit
npm run build          # -> dist/
```

Integration tests need the server from `breeze-server-v3` on `http://localhost:34377`;
see that repo's `STATUS.md`.

## Database reset

`test/global-setup.ts` rebuilds `BreezeTestDb` once per run, before any test executes:
it drops and recreates the database from `BreezeTestDb.sql` in the server repo (about
1.6s), then POSTs to `/breeze/Inheritance/Seed`, because the inheritance tables carry no
data in the script and the server otherwise only seeds them at startup.

This is what makes the pass/fail list stable. Environment overrides:

| variable | default |
|---|---|
| `BREEZE_TEST_SERVER` | `http://localhost:34377` |
| `BREEZE_TEST_DB` | `BreezeTestDb` |
| `BREEZE_SQL_INSTANCE` | `.` |
| `BREEZE_TEST_DB_SCRIPT` | `../breeze-server-v3/tests/Databases/BreezeTestDb.sql` |
| `BREEZE_SKIP_DB_RESET` | unset; set to `1` to skip |

It runs in Node even when the tests themselves run in a browser, so it will keep working
in browser mode. If the script is missing it warns and continues rather than failing, so
a no-server unit run is unaffected.

## Configuration API (done)

`configureBreeze(options)` in `src/configure.ts` replaces the stringly-typed
`config.registerAdapter(...)` + `config.initializeAdapterInstance(...)` pairs:

```ts
configureBreeze({
  ajax: AjaxFetchAdapter,
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: myTransport,   // optional
});
```

It is a typed facade over the `static register()` each adapter already had, so it is thin
rather than a new mechanism. Adapters register in dependency order (ajax before
dataService, because `AbstractDataServiceAdapter.initialize` resolves the ajax adapter).

`AjaxFetchAdapter` now takes an optional `BreezeFetch` — the seam for auth headers, retry,
Angular's `HttpClient`, or a test stub. `registerAdapter` news up the constructor, so a
custom transport registers a factory instead, the same trick the Angular adapter used.

Covered by `test/configure-ns.spec.ts` (6 tests, no server needed), which also asserts the
2.x string-based startup still works.
