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

## Vitest port — DONE (node *and* browser)

`npm test` runs the suite. **632 passing, 0 failing, 7 skipped of 639 — all 40 files
green**, in both node and browser, reproducibly.
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

- ~~`noImplicitAny`~~ **done** - see the section below. It is on, and the 105
  index-signature errors the 2.x build hid behind `suppressImplicitAnyIndexErrors`
  are fixed rather than re-suppressed.
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

## Determinism — how it was actually achieved

Two things were needed, and the first alone was not enough.

**1. Rebuild the database per run** (`test/global-setup.ts`). This removed drift caused by
pollution accumulating *across* runs.

**2. Pin the file order** (`AlphabeticalSequencer` in `vitest.config.ts`). Vitest's default
sequencer reorders spec files by their durations from the previous run, cached in
`node_modules/.vite/vitest/.../results.json`. Because several tests assert on rows that a
*different* spec file created, a change in order flips them between pass and fail.

Before pinning the order, three runs gave 4, 5 and 4 failures with a shifting membership.
After, three consecutive runs gave an identical list. An earlier claim in this file that
the suite was deterministic after step 1 alone was wrong — it rested on two runs that
happened to agree.

Pinning the order also made `nullable dateTime` and `expand through null child object`
pass consistently, because alphabetically their data-creating files now run first. They are
still order-dependent; they are simply no longer *randomly* order-dependent. Making each
test create the data it asserts on is the real fix.

## Browser mode (done)

`npm run test:browser` runs the same specs in real Chromium via Playwright
(`vitest.browser.config.ts`). Results are **identical to the node run: 629 passing,
3 failing, and the same three tests**. Breeze is a browser library, so this is the run
that matters; the node run stays as the fast default.

Setup: `npm install` then `npx playwright install chromium`, once. The test server must be
running — its `BreezeTestCors` policy is what lets a browser-origin request through, and
it reflects the caller's origin rather than using a wildcard because the fetch adapter
sends `credentials: 'include'`.

`globalSetup` still runs in Node, so the per-run database rebuild is unchanged.

### What browser mode caught

The barrel re-exported **41 type-only symbols as if they were runtime values**. Node mode
tolerated it because Vite's SSR transform can drop exports it cannot resolve; a browser
loading real ES modules cannot, and every spec file failed to import with
`SyntaxError: The requested module '/src/configure.ts' does not provide an export named
'AdapterRegistration'`.

`src/breeze.ts` now separates them: 51 value exports in `export { ... }` and 41 in
`export type { ... }`, with the imports split into `import` and `import type` to match.
This is also what makes the package safe for any file-by-file transpiler, not just
browsers.

## The suite is green

**632 passing, 0 failing, 7 skipped of 639.** Verified over three consecutive node runs
and one browser run, all identical.

Getting there took four fixes, and only the last two were test changes:

1. **A silent UTF-8 corruption.** `sqlcmd -i` decodes its input as the system ANSI
   codepage, so every database rebuild was turning `México D.F.` into `MÃ©xico D.F.`.
   Invisible until a rebuild-then-regenerate cycle compounded it into column overflow.
   Fixed with `-f 65001` everywhere and a BOM on the generated script.
2. **`UnusualDate.DateOnly` / `TimeOnly` were never populated** — the old
   `Add_DateOnly_TimeOnly.sql` added the columns and stopped. Now seeded.
3. **`bugs.spec.ts` asserted an exact employee count** that an earlier test *in the same
   file* had already invalidated by inserting one. Now asserts a floor; the test is about
   attachment, not counting.
4. **`nullable guid == null` queried for an order with no customer** without creating one,
   relying on some other spec file to have made one. It creates its own now.

### About the shipped Northwind data

The pristine employee ids are **1-6, 8, 9, 10** — there is no employee 7, and there is a
10. That gap is in the `.mdf` this data came from; it predates this repo. Worth knowing
before writing an assertion about employee counts or ids.

### Still not isolated

Green is not the same as isolated. Tests still share one database within a run, and the
alphabetical sequencer is what keeps that reproducible. `query-misc.spec.ts`'s
"self-referencing entity" still requires an employee with id > 10, which only exists
because `bugs.spec.ts` inserts one earlier in the run. Splitting into unit and integration
tiers, with per-file reset for the integration tier, is what actually fixes that.

## noImplicitAny (done)

`tsconfig.json` has `noImplicitAny: true`. All 105 errors the 2.x build hid behind
`suppressImplicitAnyIndexErrors` — removed from TypeScript in 5.5 — are fixed.

Approach, in order of preference:

1. **Type the map.** `BreezeConfig.functionRegistry`, `typeRegistry`, `objectRegistry`,
   `Validator.messageTemplates`, `BreezeEvent.__eventNameMap` and `FnExpr._funcMap` are
   now declared as records instead of bare `{}`.
2. **Annotate the local.** The JSON fragments the `toJSON` visitors build by string key
   are `Record<string, any>` at declaration.
3. **Cast at the one site that needs it**, with a comment, where the dynamic access is
   deliberate — visitor dispatch, `BreezeEnum`'s symbol table, the backing-store accessors.

**Exported signatures still say `Object`.** Narrowing them to `Record<string, any>` would
reject every class instance callers pass, because class types get no implicit index
signature. The cast is confined inside the function instead.

### The trap

`core.ts`'s `for...in` + `hasOwnProperty` loops became `Object.keys`, which is exactly
equivalent for own enumerable properties — except that **`Object.keys(null)` throws while
`for (let key in null)` is a silent no-op**, and these helpers are called with null by
design. That broke 572 of 639 tests on the first attempt. Every `Object.keys` call in
`core.ts` now carries a `|| {}` guard and a comment saying it is load-bearing.

`strictNullChecks` is still off and is the remaining piece of the modernization.

## Known flaky test

`query-named-on-server.spec.ts` > "project objects containing entities" asserts
`results[0].orders.length > 0`. The named server endpoint has no `ORDER BY`, so SQL may
return the projected customers in any order, and `results[0]` is whichever row comes back
first — sometimes one with no orders. Observed failing once in roughly a dozen runs and
passing on re-run.

This is independent of the database reset and the file sequencer; both are deterministic.
The fix is for the test to pick a customer it knows has orders, or for the endpoint to
order its results.

## strictNullChecks (done)

`tsconfig.json` has `strictNullChecks: true`, along with `noImplicitAny`. 166 errors
fixed, none suppressed.

**113 of the 166 came from one modelling error.** `Entity` and `ComplexObject` declared
`getProperty?` and `setProperty?` as optional. They are not: every Breeze entity has them,
installed by the model-library adapter when the type is created. Making them required —
a types-only change — cleared 82 "cannot invoke possibly undefined" plus a long tail.
Safe because nothing declares `implements Entity`; custom constructors go through
`registerEntityTypeCtor`, which takes a `Function`.

The rest fell into three kinds, in descending order of preference:

1. **The signature lied about what the code already did.** `core.extend` opens with
   `if (!source) return target;`; `getHeadersFn` opens with `if (!response ...)`;
   `AjaxRequest.error` is handed nulls for body and response when the transport fails
   before a response exists; `_updateWithConfig` guards with `if (config)`. Fixing the
   signature usually cleared several call sites at once.
2. **The field really is nullable.** `SaveQueuing`'s four deferred/memo fields are reset
   to `null` between saves; `EntityQuery.wherePredicate` was the only clause field not
   marked optional, and carried a `// TODO` saying so; `EntityAspect.hasTempKey` is
   deleted to clear it, which only type-checks when optional.
3. **A guard exists but TypeScript cannot see it.** Narrowing lost inside a callback,
   or a `throwIfNotFound: true` argument that guarantees a result. These use `!`, each
   with a comment naming the reason. `LitExpr.dataType` instead re-declares the inherited
   optional field as required, since the constructor always resolves one.

Two runtime behaviours changed, both deliberate and both covered by the suite:
`AbstractDataServiceAdapter.initialize` dropped an always-true `&& this.ajaxImpl.ajax`,
and `core.ts`'s ES5 probe dropped an always-true `Object.getPrototypeOf &&`.
