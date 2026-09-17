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

Items 1-5 of the previous list (last 4 failures, CORS + browser mode, unit/integration
split, explicit registration + `@deprecated` string API) are done — see the sections below.

1. ~~User docs~~ **done** — every page written from breeze.github.io/doc-js and checked
   against `src/`. What that turned up is logged at the end of this file.
2. ~~Retire `AjaxAdapter`~~ **done** — an ajax adapter is optional and requests go
   through `config.fetch`. See CHANGES-DEV.md, *The ajax adapter is optional*.
3. ~~Per-file isolation for the integration tier~~ **done** — the test host takes a SQL
   Server database snapshot per run and every integration file reverts to it over HTTP, so
   it works in browser mode too. See *Per-file isolation* below.
4. ~~Explicit initialization instead of import-time side effects~~ **done** — the package is
   side-effect free apart from the entity-graph mixin. See *sideEffects* below.
5. `breeze.version` and the `null` `breeze.assertConfig` / `assertParam` — see Known issues.
6. **GitHub Actions**: typecheck + unit tier + docs build on every push; the integration
   tier separately, since it needs SQL Server and the .NET server. *Deferred for now at the
   user's request; to be raised again.*
7. ~~Regroup `src/` by concern~~ **done** — nine folders, `breeze.ts` still the barrel at
   the root. Deliberately left until last, so that moving 44 files was the only thing in
   flight and any breakage had one possible cause. See *`src/` grouped by concern* in
   CHANGES-DEV.md.


## Test coverage gaps (identified)

Found by listing the public methods of the exported classes and checking which names never appear
anywhere under `test/`. Not a substitute for line coverage — no coverage package is installed — but
it finds the methods nothing calls at all, which is the sharper signal.

`test/unit/untested-api.spec.ts` now covers the pure ones as characterisation tests:
`MetadataStore.getEntityType` / `parseTypeName` / `getEntityTypeNameForResourceName`,
`EntityType.getPropertyNames` / `isSubtypeOf` / `getSelfAndSubtypes` / `getEntityKeyFromRawEntity`,
`EntityKey.createKeyString`, `EntityAspect.setAdded` / `setEntityState` / `clearValidationErrors` /
`getParentKey` / `getPropertyPathValue` / `markNavigationPropertyAsLoaded`, and
`EntityManager.findEntityByKey`.

Writing them found one bug: `EntityAspect.isNavigationPropertyLoaded` is declared `boolean` by its
overloads but returned `undefined` when `_loadedNps` was unset, and again when the aspect had no
entity. TypeScript does not check an implementation signature against its own overloads, so callers
were told `boolean` and could be handed `undefined`. Fixed.

### Blocked on the server

Five tests were removed in `53162ca` because this host cannot run them, and they are tracked in
**breeze-server-v3 STATUS.md, "Client tests blocked on server work"** with what each needs. In
short: server-side entity validation (three tests), query-string binding for an array of complex
objects, and whether an unknown query parameter should be an error. Restore them from `53162ca~1`
when the server side lands.

Two others that looked blocked were not, and are covered now: `EntityQuery.executeCount` needed
nothing `inlineCount` does not already do, and a null `withParameters` value works - that test had
a stale `TODO` skip on it.

### Still uncovered

| Member | Why it is not covered here |
|---|---|
| `EntityQuery.executeCount` | needs the server; no integration test calls it |
| `EntityQuery.useNameOnServer` | needs a naming convention set up |
| `MetadataStore.getIncompleteNavigationProperties` | needs a partially-imported metadata fixture |
| `MetadataStore.trackUnmappedType` | unmapped-type registration |
| `MetadataStore.makeTypeHash`, `mergeProps` | plausibly internal; neither is marked `@hidden` |
| `EntityType.addValidator`, `getAllValidators` | type-level validators; only property-level ones are tested |
| `Predicate.extendFuncMap` | the extension point for custom query functions |

Also never referenced by a test, though several are hard to exercise directly: the predicate node
classes `AndOrPredicate`, `BinaryPredicate`, `UnaryPredicate`, the expression nodes `LitExpr`,
`FnExpr`, `PropExpr`, plus `ExpandClause`, `ComplexArray`, `InterfaceRegistry` and
`makeRelationArray`. They are reached indirectly through `Predicate.create` and query execution, so
the gap is that nothing pins their own behaviour.

The remaining 50-odd never-mentioned exports are type-only (`…Config` interfaces, callback types,
the path types) and have nothing to execute.

### Two tests are skipped, both deliberately

- `bugs.spec.ts` — "executeQuery returns before in-cache entities are all attached". A known issue.
- `query-named-on-server.spec.ts` — "with parameter - null", marked `// TODO: need to review this
  one later`.


## Known issues

- ~~`noImplicitAny`~~ **done** - see the section below. It is on, and the 105
  index-signature errors the 2.x build hid behind `suppressImplicitAnyIndexErrors`
  are fixed rather than re-suppressed.
- ~~`strictNullChecks`~~ **done** - see the section below. It is on, and all 166
  errors are fixed rather than suppressed.
- ~~`"sideEffects": true` must stay true~~ **done** — see *sideEffects* below. Branding a
  prototype or resolving an enum inside the module that declares it was never the problem:
  a bundler keeps that module as soon as anything uses one of its exports. What did break
  tree-shaking was code reaching into *other* modules, and that is gone.
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
npm run build          # -> dist/, including a publishable dist/package.json
npm run pack           # build, then npm pack ./dist -> breeze-client-3.0.0.tgz
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

`configureBreeze(options)` in `src/config/configure.ts` replaces the stringly-typed
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
`SyntaxError: The requested module '/src/config/configure.ts' does not provide an export named
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

### Isolation (done)

Green was not the same as isolated: the files shared one database within a run, and an
alphabetical sequencer kept that reproducible. Each integration file now starts from a
pristine database; see [Per-file isolation](#per-file-isolation-done) below.

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

`strictNullChecks` and `noImplicitAny` are both on; the modernization of the type layer
is complete.

## Flaky test - fixed

`query-named-on-server.spec.ts` > "project objects containing entities" asserted
`results[0].orders.length > 0`. The `CompanyInfoAndOrders` endpoint had no `ORDER BY`,
so SQL could return the projected customers in any order, and plenty of Northwind
customers have no orders at all.

Fixed on both sides: the endpoint now orders by `CustomerID`, and the test no longer
assumes `results[0]` is the interesting row - it asserts entity materialization on
whichever of the five rows actually have orders. Verified over two consecutive runs.

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

## Unit / integration split (done)

`test/` is now split by what a spec actually needs:

| | files | tests | needs |
|---|---|---|---|
| `test/unit/` | 14 | 184 | nothing — **runs in 2.7s** |
| `test/integration/` | 26 | 455 | the .NET server on `:34377` and `BreezeTestDb` |

```
npm run test:unit          # 2.7s, no server, files run in parallel
npm run test:integration   # rebuilds the database, serial, shuffled, reset per file
npm test                   # both
npm run test:browser       # both, in Chromium
npm run test:watch         # watches the unit tier
```

The split is by directory rather than by the old `-ns` filename suffix, which had stopped
being reliable: `predicate.spec.ts` needs no server despite the missing suffix, and
`query-construction-ns.spec.ts` carries the suffix but calls neither init function.

The unit tier has no `globalSetup`, no database rebuild, and file parallelism left on —
nothing in it touches shared state. Shared helpers (`test-fns.ts`, `util-fns.ts`,
`save-test-fns.ts`, `support/`, `setup.ts`, `integration-setup.ts`, `global-setup.ts`) stay at
`test/` and are imported from both tiers.

### Per-file isolation (done)

Every integration file now starts from the same database. After the per-run rebuild,
`global-setup.ts` has the test server take a SQL Server database snapshot
(`POST /breeze/TestDb/Snapshot`), and `test/integration-setup.ts` reverts to it before
each file (`POST /breeze/TestDb/Reset`; about 10 s per run in all). It is an HTTP endpoint on the test
host, not `sqlcmd`, because in browser mode the files run in Chromium. The endpoints are
off unless the host is started with `--TestDb:AllowReset=true`, and answer only local
requests. `TESTING.md` has the details.

The alphabetical sequencer is gone. Files run in a shuffled order (`shuffle: { files:
true }`; the seed is printed), still one at a time, because there is one database.

Run one file at a time and in shuffled orders, three tests turned out to depend on rows
another file had inserted. Each now creates its own:

- `query-misc.spec.ts` "self-referencing entity" looked for an employee with id > 10; only
  `bugs.spec.ts` made one.
- `datatypes.spec.ts` "nullable dateTime" queried for employees with no birth date; every
  shipped employee has one.
- `query-basic.spec.ts` "expand through null child object" queried for orders with no
  employee; every shipped order has one.

## API docs: TypeDoc warnings 71 → 0 (done)

- **Stale `@param` names** fixed in the comments — rest parameters (`Predicate`'s
  `...args`) documented as `args`, renamed parameters (`stype`, `typeName`, `qoConfig`…)
  matched, leftover `@class` tags removed.
- **26 types that public signatures already used are now exported** with `export type`:
  config objects, event args, callbacks, `SaveError`, `ImportResult`, adapter-author types.
  Type-only, no runtime change. Listed in `src/breeze.ts`.
- **7 genuine internals** (`InterfaceDef`, `Op`, `Param`, `RecursiveArray`, `QueryOp`,
  `BooleanQueryOp`, core's `Predicate` alias) go in `intentionallyNotExported` in
  `typedoc.config.mjs` rather than becoming public.
- The duplicate `ValidationErrorsChangedEventArgs` is gone; `entity-aspect.ts` imports the
  one in `entity-manager.ts`.
- The TypeDoc sidebar linked to `/docs/api/...`; the site serves `/api/...`. Fixed with
  `docsRoot`.

### Found on the way: `initializeAdapterInstances` always threw

It iterated every property of the global `config` instead of its argument, and so passed
`functionRegistry` and friends to `initializeAdapterInstance` as adapter names. The code
is identical in 2.x, so this is not a v3 regression — just a deprecated path nobody tested.
Fixed, typed (`InterfaceRegistryConfig` now takes adapter names, as it always should
have), and covered by two new tests in `configure-ns.spec.ts`. With every fix from this round in: unit
196, integration 448 + 7 skipped, browser 644 + 7 skipped. All green.

## API docs: grouped by purpose, not by kind (done)

The reference was five flat buckets — Classes 32, Interfaces 60, Type aliases 21, Functions 3,
Variables 4 — so `Entity` sat beside `NodeMeta` in a sixty-item list, and only 38 of the 121
symbols are linked from any guide page.

`scripts/typedoc-categories.mjs` now assigns each symbol a category, and the sidebar is ordered
everyday-surface first: Working with data (30), Metadata (12), Validation (5), Events (8),
Configuration (11), then the plumbing — Typed query paths (16), Constructor config objects (16),
Adapters and extension points (13), 2.x compatibility (10). Every group renders collapsed, so the
last four are four unexpanded lines.

**Nothing is hidden.** `excludeCategories` works and would remove a whole category's pages, but
these are all genuinely exported: `@internal` would misrepresent the `.d.ts`, and dropping a page
leaves dangling links from the pages that reference it — hiding the adapter interfaces made
TypeDoc warn that `DataServiceConfig.uriBuilderName` pointed at a missing `UriBuilderAdapter`.
De-emphasis was what was wanted, not removal.

The categories come from one table rather than ~120 `@category` tags across the source, so the
taxonomy can be reviewed in one place. A table can drift, so the plugin warns both ways — an
export missing from it, and a table entry that no longer exists — and both warnings are verified
to fire. `categoryOrder` ends with `*`, so anything uncategorised is visible rather than lost.

One thing to know if this is ever extended: the categories must be applied on
`EVENT_CREATE_DECLARATION`. On `EVENT_RESOLVE_BEGIN` they still render, but `excludeCategories`
silently ignores them.

## Broken anchors now fail the docs build (done)

VitePress fails a build on a link to a missing *page*, but says nothing about a missing
`#anchor` — verified by deliberately breaking one and watching the build pass. So renaming a
heading silently strands every link into it, which is what had happened to three links to
`#default-adapters` after it became "Adapters and transport".

`scripts/check-doc-anchors.mjs` runs as the last step of `docs:build` and exits non-zero on a
broken one. It checks against the `id=` attributes the build actually emitted rather than
reimplementing VitePress's slug rules, so it covers the API reference too, where TypeDoc
generates the anchors: 234 links across the site, up from the 67 a guide-only check would see.
Links inside fenced code blocks are ignored, and external URLs are not its business.

Verified in both directions: a typo'd anchor fails `docs:build` with exit 1, and a fence
containing an invented anchor does not.

## Deprecated the callback arguments (done)

`saving-changes.md` already called the callback arguments "deprecated"; the source had no
`@deprecated` anywhere, and `saveChanges`'s own doc comment actively advertised them
("Callback methods can also be used"). They are now deprecated for real, on `executeQuery`,
`saveChanges`, both `fetchMetadata`s, `EntityQuery.execute`, `loadNavigationProperty` and a
relation array's `load`, plus the four callback interfaces.

**Deprecating the interfaces alone would not have reached anyone.** Callers pass a lambda and
never name `QuerySuccessCallback`, so the strikethrough would only appear for the few who write
`const cb: QuerySuccessCallback = …`. What reaches a caller is a `@deprecated` *overload*.

**The trap is overload order.** Because the callback parameters are all optional, a deprecated
overload declared first also matches `em.executeQuery(query)` — so every caller gets a
strikethrough for code that is already correct. The promise-only overload has to come first.
`test/unit/deprecation.spec.ts` pins both halves down: 7 callback calls that must be marked, and
10 promise calls that must not. Swapping the order in the source fails the second half, which is
verified, not assumed.

`tsc` never reports deprecation — it is a language-service feature — so that test drives
`ts.createLanguageService` and reads `reportsDeprecated` off the suggestion diagnostics, the way
an editor does. It is Node-only, so it joins `side-effects` and `entity-generator` in the browser
tier's exclude list.

Also: the overloads have to sit *above* the method's doc comment. Below it, the comment attaches
to the promise-only overload and TypeDoc warns that its `@param callback` is unused — eight
warnings against a reference that had been at zero.

No example in the guides or the reference uses the callback form any more.

## Found while writing the user docs — resolved

The doc agents turned up about 35 defects. Nearly all are fixed, each with a regression
test; UPGRADE.md lists what users can notice, under "Fixed along the way" and "Fixes that
change what your code sees".

Left as they are, deliberately:

- Temp integer keys share one counter across all types and managers (-1, -2, … overall).
  That guarantees uniqueness across types; the docs now say so.
- `setProperty` with an unknown name creates an untracked property, as in 2.x and as plain
  assignment does; apps use it for client-only values. Documented on the interface.
- `importMetadata` without `allowMerge` skips types already in the store. Documented:
  re-importing metadata, which `importEntities` does, must stay harmless.
- A store built from raw server `/Metadata` still requests `/Metadata` once, until
  `addDataService` is called. Skipping it would break apps that add client-only types
  before fetching.
- The `jsonp` branch in `_makeQueryGetParams` stays: a registered (deprecated) custom ajax
  adapter can still receive `dataType: 'jsonp'`.

Still open:

- The NHibernate metadata builder emits type names (`Date`, `DateTime2`, `Currency`,
  `YesNo`, …) the client does not alias; they import as `DataType.Undefined` with a
  warning. The better fix is the server's `BreezeTypeMap`.
- A query rebuilt by `EntityQuery.fromJSON` without `usePost` has `usePostEnabled`
  `undefined` rather than `false`.

## assertParam: kept at the front door, taken off the hot path (done)

Asked whether `Param` / `assertParam` / `assertConfig` still earn their place and whether they are
efficient. Useful yes, efficient no — and the two answers do not conflict, because the cost was
almost entirely Breeze checking arguments it had produced itself.

Against a zero-allocation stub, assertParam was **27% of `createEntity`** and **56% of
`new BreezeEvent`**. Counting the calls said why: one `createEntity` ran **fifteen** chains, and
only three checked anything the application had passed. The other twelve were two `BreezeEvent`
constructions per entity, four `getKey` calls, one `EntityKey`, and `attachEntity` re-checking
the `entityState` and `mergeStrategy` that `createEntity` had validated a moment earlier.

Fifteen became three:

- The per-object sites check inline and call a new `paramError(name, msg)` on the failing branch,
  which builds the identical message where an allocation no longer matters. Eighty-odd other call
  sites keep the chain — at a public entry point called once per operation, its readability is
  worth more than the objects.
- `attachEntity` split into the public method and `_attachEntity`, which is what it always did
  afterwards; `createEntity` calls the second. Every check on the *entity* still runs on both
  paths, since those depend on the manager, not on the caller.
- Four messages that were concatenated on every passing call are built lazily now. Worth about
  10% — the allocation is the rest.

Measured on Northwind `Order` with **default validation options**: `createEntity` 13.05 → 11.38 µs,
building a detached entity 2.32 → 1.90 µs, `new BreezeEvent` 7.2 → 2.2 ms per 20,000,
`new EntityKey` 7.1 → 5.1 ms per 20,000. docs/guide/performance.md's cost table is updated.

**Every message an application can see is byte-for-byte what it was**, checked by diffing twelve
misuse cases against HEAD. `test/unit/param-validation.spec.ts` pins the wording and counts the
chains one `createEntity` runs, so the two halves cannot drift apart; it fails against HEAD at 17
chains against a budget of 5.

**`assertConfig` was left alone.** `applyAll` assigns the config values and their defaults onto
the instance — it is doing the construction, not only checking it — and the check nothing else
can do is rejecting a misspelled option. Silently ignoring `{ servicName }` gives you a manager
that does not do what you asked and no clue why. It runs once per object constructed.

### The first measurements were wrong

Run in one process, `getChanges` looked like 40% assertParam — and it makes exactly **one**
assertParam call. The measurement had caught garbage collection from earlier phases, because the
variant with assertParam live allocated far more. One shape per process plus a forced collection
between setup and the timed region took that 40% to zero, and `getByKeyName` had been moving 30%
on noise alone. Worth remembering before trusting any number out of a shared-process benchmark.

## The mixins are in the API reference now (done)

Asked where save queuing is documented. One section of docs/guide/saving-changes.md, and
nothing else - **neither mixin was in the reference at all**, because `entryPoints` was
`src/breeze.ts` and that does not re-export them. So `enableSaveQueuing`, `QueuedSaveFailedError`,
`mixinEntityGraph` and `HasEntityGraph` had no page, and the guide told people to catch an error
class the reference had never heard of.

Adding the two mixins to `entryPoints` is the obvious fix and is wrong. TypeDoc gives each entry
point a module of its own, so every page moves from `/api/classes/EntityManager` to
`/api/breeze/classes/EntityManager` - 54 links in the guides - and
`scripts/typedoc-categories.mjs` only categorises reflections whose parent is the *project*,
which under modules is none of them, so the reference loses its taxonomy entirely. Both were
confirmed by running it.

Instead `scripts/docs-entry.ts` re-exports `src/breeze.ts` plus the two mixins, and is the single
entry point. Flat structure kept, every existing URL unchanged, four pages added and nothing else
in the generated set moved. It lives outside `src/` and `tsconfig.build.json` now sets its own
`include`, so it is typechecked but never compiled into `dist/` - verified against the packed
tarball.

- New category **Optional mixins**, second from the bottom. The plugin's drift check named all
  four the moment they appeared, which is the check doing its job.
- `SaveMemo` joins `intentionallyNotExported`: `QueuedSaveFailedError.failedSaveMemo` names it.
- The four symbols had `//` comments, which TypeDoc does not read, so the pages were signatures
  with no prose. They have real doc comments now.
- docs/guide/configuration.md gained **What you can import**, a table of all eight entry points.
  Nothing listed them; four pages each mentioned one in passing, which is why an earlier link to
  `mixin-get-entity-graph` had nowhere to point.

### Two stacked doc comments were silently dropping @internal

`EntityManager._setHasChanges` and `BreezeEvent.__eventNameMap` each had `/** @hidden @internal */`
followed by a *second* doc comment. Only the last one attaches, so the tags were being discarded.
`stripInternal` kept both out of the `.d.ts` anyway, and the class pages excluded them - but
`HasEntityGraph extends EntityManager` reaches inherited members by another path, and
`_setHasChanges` appeared there, linking to an anchor on the EntityManager page that does not
exist. The anchor guard from `61b7bd3` is what caught it. Both are single comments now.

## Save queuing: the SaveMemo now has tests, and one bug fewer (done)

Asked whether the mixin earns its place. It does, but not for the reason it is usually
described. Serialising concurrent saves is the smaller half; the valuable half is that it
**keeps edits made while a save is in flight**. Core Breeze lets you make one and then discards
it - the server's values overwrite it on merge, the entity lands `Unchanged` and `hasChanges()`
is `false`, so nothing tells the application a keystroke was lost. Measured both ways: the same
script ends with `companyName` back at its pre-edit value without the mixin, and at the typed
value with it.

Cost to applications that do not use it: **zero**. It is its own `exports` subpath and is not in
`sideEffects`, so nothing pulls it in. 17.4 KB raw / 4.8 KB gzipped unminified for those who do.

The imbalance was in the tests, not the code: 5 tests, all on the trivial path (one add, two
concurrent saves, enable twice, disable), and **nothing at all** on `EntityMemo` / `pkFixup` /
`fkFixup` - the ~180 lines that do the hard part. `test/unit/save-queuing-memo.spec.ts` (8 tests,
against the fake server, asserting the wire payload and not just the cache) and
`test/integration/save-queuing.spec.ts` (2 tests, against the real database) cover it now.

### The bug that found

`EntityMemo.fkFixup` compared `fkProp.parentType.name` against the key mapping's type. But
`DataProperty.parentType` is the type that **declares** the foreign key, not the type it points
at, so the two can only be equal for a self-referencing key. Of the 14 foreign keys in the
Northwind metadata exactly one - `Employee.reportsToEmployeeID` - is self-referencing, which is
why this was invisible.

The effect: point a child at a parent whose row is still being inserted, during a save, and the
queued save carried the parent's **temporary negative key**. Against the real server that is

```
The UPDATE statement conflicted with the FOREIGN KEY constraint "FK_Order_Employee"
```

It now resolves the target through `relatedNavigationProperty.entityType`, falling back to
`inverseNavigationProperty.parentType` for a unidirectional 1-n. Identical code in the 2.x
checkout, so this is long-standing and not a v3 regression. Both migration pages list it.

Also established: `EntityMemo`'s `Deleted` branch and `applyToSavedEntity`'s `setDeleted` are
**unreachable through the public API** - `EntityAspect._checkOperation` throws for `setDeleted`,
`rejectChanges` and `clear` on an entity being saved, which is core behaviour the mixin cannot
see. Rather than test dead code, a test pins that those three still throw.

The integration tests hook `config.fetch` to run the mid-flight edit between the request going
out and the response arriving, instead of racing a timer against a localhost server.

## Cache lookups: three quadratics removed (done)

Every one was the same shape - an answer re-derived by scanning, inside a loop that runs once per
entity - and every one is now a `Map` or a `Set`. Measured on Northwind entities, 40,000 of them:

| | before | after |
|---|---|---|
| `entityAspect.acceptChanges` over 40,000 changed entities | 8,478 ms | 33 ms |
| `entityAspect.rejectChanges` over the same | 9,343 ms | 61 ms |
| `detachEntity` over the same | 952 ms | 66 ms |
| `getEntityGraph(customer, 'orders.orderDetails')`, 8,000 orders / 24,000 details | 5,132 ms | 10 ms |

All four were quadratic - each doubling cost 4x - and all four are linear now.

1. **`hasChanges` was recomputed, not tracked.** Turning one changed entity clean tells the
   manager it may have become clean overall, and it found out by walking the whole cache. Each
   `EntityGroup` now keeps a `Set` of its entities that are not Unchanged, so `hasChanges` is a
   size check. `EntityAspect.entityState` became an accessor to maintain it: that is the one
   place every state change passes through, so the set cannot drift.
2. **`getEntityGraph` filtered the whole child type per parent.** Expanding a collection
   navigation over p parents and c children cost p*c. The children are indexed by their foreign
   key once per path segment. Its `graph.indexOf(entity)` dedupe and its `related.concat(...)`
   per parent were quadratic too, and are a `Set` and a push.
3. **`SaveQueuing` checked `queuedChanges.indexOf(e)` per change.** Now a `Set`, which also makes
   queuing the same entity twice impossible rather than merely unlikely.

`EntityGroup._indexMap` is a `Map` as well, which is a **correctness** fix and not a speed one -
measured, the object literal was slightly faster on hits. An object inherits `Object.prototype`,
so an entity whose key was the string `__proto__` was attached but could never be found again.
Keys there are strings, which the object coerced for us, so `_fixupKey` now converts the numeric
`tempValue`/`realValue` a save returns - without that every save of a new entity throws.

What it cost: reading `entityState` went from ~2 ns to ~8 ns, so `getChanges()` over a large
cache is about 1.5x, and the Unchanged -> Modified transition about 20% dearer. Nothing else
moved - `createEntity`, `getEntityByKey` and steady-state `setProperty` are flat.

Measured and left alone: `EntityType.getProperty(name)` is a linear scan over a freshly
concatenated array, 193 ns against 57 ns for `getDataProperty`. A name index would fix it, but
nothing per-entity calls it - the query merge path goes through `dataProperties` directly - so
there is no evidence it is hot. Re-parenting is still O(collection) per child, as
docs/guide/performance.md has always said: a `Set` would find the child faster but the `splice`
would still shift the array.

Guarded by `test/unit/cache-lookups.spec.ts`, `test/unit/key-fixup.spec.ts` and a new case in
`get-entity-graph.spec.ts`, all of which count the work done rather than time it. Each was
confirmed to fail against the code it replaced.

## Observable arrays (done)

The three observable collection types are still plain arrays, but the mixin that used to be copied
onto every instance is gone: 18 own properties became 11 (relation) and 10 (complex, primitive),
which is what keeps them out of V8's dictionary-properties mode. On real entities indexed reads
went from 63.4 ms to 6.4 ms and `forEach` from 14.4 ms to 6.6 ms, with creation and push slightly
better too. A subclass and a `Proxy` were both measured and rejected - see *The observable arrays*
in CHANGES-DEV.md for the numbers and for what moved off the array.

## Backing store (done)

The change-tracking adapter lost its IE9 machinery (pending backing stores and the linear scan
that came with them), the per-instance `getProperties()` concat, and the bind-per-access in the
custom-accessor path. Creating a detached entity went 1.70 -> 1.45 µs; everything else is flat,
because the adapter is only ~2% of a property set. The measurements that say so, and the levers
that do matter (validation), are in docs/guide/performance.md - a new page.

## Lazy relation arrays (done)

Collection navigations are created on first read rather than at entity creation. Memory per
entity drops by roughly 400 bytes per collection navigation - `Employee` (three of them) went
5,822 -> 3,927 bytes - and building a detached entity went 1.74 -> 1.18 µs; attaching is
unchanged. Four places used to read collections for no reason (attach cascade, delete unhook,
validation, key propagation) and now peek via an optional `peekProperty` on the model library
adapter, falling back to `getProperty` for an adapter that lacks it. See *Lazy relation arrays*
in CHANGES-DEV.md and docs/guide/performance.md.

## noEval removed (done)

Breeze no longer evaluates strings. `createEmptyCtor` named its constructor by building one with
`Function(...)`; it uses `Object.defineProperty(ctor, 'name', ...)`, which gives the same name
(`Order:#Foo` -> `Order__Foo`, checked at runtime). The startup `Function('')` probe, the
`config.noEval` flag and the `configureBreeze({ noEval })` option are gone - a breaking change,
written up in UPGRADE.md. Nothing in src uses `eval` or `Function` on a string, so a strict CSP
needs no exception and sees no violation report.

## Packaging check (done)

Installing the packed tarball into a fresh Vite + TypeScript app found what the suite could
not, since the suite imports `src/` directly:

- **Node could not load the package.** All ~250 relative imports lacked `.js`. Fixed, and
  `tsconfig.json` now uses `NodeNext`, so `tsc` rejects an extensionless import.
- **The root `.d.ts` failed `tsc` without `skipLibCheck`.** It re-exported `assertParam`,
  `assertConfig` and `Param`, which `stripInternal` had removed. They are `@hidden` now:
  out of TypeDoc, still in the declarations.
- Source maps pointed at unshipped `src/` files; they now inline their sources, and
  declaration maps are off.

Tree-shaking works: an unimported subpath is dropped. Core plus three adapters is about
168 KB minified, 46 KB gzip.

Measured again after the `sideEffects` work, bundling the packed tarball with Vite into an
app that imports `breeze-client` by name (unminified, so the numbers compare with each
other, not with the figures above):

| the app imports | bundle | what is dropped |
|---|---|---|
| `MetadataStore` | 329.5 KB | `EntityManager`, every server adapter, `AbstractDataServiceAdapter` |
| `EntityManager` | 454.7 KB | the entity-graph mixin, the ajax-post adapter |
| `EntityManager` + the mixin subpath | 460.1 KB | nothing it uses — `"sideEffects"` keeps the mixin |

The mixin is a separate entry point, never part of the barrel, so a bundle that does not
import `breeze-client/mixin-get-entity-graph` is *supposed* to lack `getEntityGraph`.

## Test script (done)

`scripts/test-with-server.ps1` (and `test-with-server.cmd`) runs the server-backed loop in
one command: database, server, tests, shutdown. See TESTING.md.

## Default adapters (done)

Breeze works with no adapter registration: with nothing registered it falls back to the
backing-store model library, the JSON uri builder and the Web API data service, and sends
requests through `config.fetch`. Defaults are registered lazily, only for an interface
nothing has been registered for; 2.x startup that initialized them by name works without
`registerAdapter`. Design notes in CHANGES-DEV.md.

`test/test-fns.ts` registers nothing, so every server-backed test runs on the defaults:
unit 268, integration 450 + 7 skipped, browser 718 + 7 skipped. The packed tarball passes a
Node end-to-end with no configuration at all.

The test hosts in breeze-server-v3 now set `UseAppHost=false`: Windows application control
had started blocking the rebuilt, unsigned test-host `.exe`.

## Default naming convention: camelCase (done)

`NamingConvention.camelCase` is now the default, so with the default adapters a Breeze
.NET server needs no configuration at all: `new EntityManager(serviceName)`. It is a
breaking change for applications that relied on 2.x's `none`; UPGRADE.md says how to set it
back. The Configuration page now lists every startup setting with its default.

Unit 268, integration 450 + 7 skipped, browser 718 + 7 skipped, with no naming convention
set anywhere in the suite.

## Typed entity classes for the tests (in progress)

`test/model/` holds one class per structural type in the Northwind test metadata — 21 of them,
plus `entity-base.ts` and a barrel — so a spec can write `cust.companyName` instead of
`cust.getProperty("companyName")` and have TypeScript check it. Casting is all most specs need
(`qr.results as Customer[]`); `registerModelClasses(store)` additionally makes Breeze build
entities from the classes, which is what gives `instanceof`.

**The generator is published, not just internal.** `scripts/generate-entity-classes.js` is copied
into `dist/` by `scripts/prepare-dist.mjs` and declared as the `breeze-gen-entities` bin, so an
application runs `npx breeze-gen-entities --service ... --out src/app/model` after installing the
package. `--out` and `--metadata` resolve against the working directory (never the script's, which
under an install is inside `node_modules`), and `loadBreeze` prefers the `breeze.js` beside the
script — the caller's own copy — falling back to `../dist/breeze.js` in this repo.
[docs/guide/generating-entities.md](docs/guide/generating-entities.md) is the user-facing page.

**The classes are generated, and regenerated surgically.**
`npm run gen:model` reads metadata through `dist/breeze.js`
— so naming conventions, `nameOnServer`, inheritance and complex types resolve exactly as at
runtime — and owns individual *members*, not whole files:

**The metadata decides ownership, not the `// @generated` marker.** A declared property whose name
the metadata knows is a mapped property and is kept in step; anything else is the caller's. The
marker is a record of provenance and drives one decision only — whether a property the metadata has
dropped is deleted or left. That rule is what lets a hand-written class with no markers anywhere be
adopted a property at a time rather than having its whole body appended a second time.

| | |
|---|---|
| a declared property the metadata **has** | rewritten in place, marked |
| a metadata property the file does not declare | appended |
| a declared property the metadata does **not** have | left alone — unless marked, which means the column has left the schema |
| the class declaration | made to extend the base, dropping the members that base supplies |
| a marked import | kept in step; dropped only when nothing in the file still refers to it |
| hand-written imports, methods, getters, constructors, unmapped properties, comments | never touched |

Opt-outs: `// @manual` on a declaration, `// @manual-start` / `// @manual-end` around a block,
`// @manual-file` for a whole file. The last two must be alone on their own comment line, so that
prose mentioning one is not mistaken for one — the generated header named them for about an hour
and thereby opted every generated file out of the generator.

Taking over a file with no `@generated-by` header needs `--adopt`; without it the file is reported
and skipped. `test/unit/entity-generator.spec.ts` pins all of this, formatter tolerance included:
the generator compares what a declaration means rather than its exact text, so Prettier collapsing
the two spaces before the marker does not start a rewrite war.

Each file's first line stamps the generator version (`// @generated-by generate-entity-classes
v1.0.0`); a run against a file written by an older version says so, which is the hook for a
future version that has to migrate older output.

`--out` and a metadata source are required, with no defaults: nothing can infer either, and a
wrong guess at `--out` overwrites a directory nobody named. Everything else has one.

The generated files import Breeze from **`breeze-client`**, the published package name, even
though the other 40 spec files import `../../src/breeze`: these files are what the tool writes for
an application and should read that way. `paths` in `test/tsconfig.json` and a `resolve.alias` in
`vitest.shared.config.ts` (wired into all four tiers) point the name back at the sources. Without
them it would still resolve, through the package's own `exports` map, to `dist/` — binding the
model to a *different copy of Breeze* from the one the specs run, with two `EntityState` enums and
`instanceof` failing for no visible reason. Every Breeze import in these files is `import type`
today, so nothing loads either way; the alias is insurance for the first real import, and a test
asserts the two spellings resolve to one module. `--breeze` overrides the name, for a fork
republished under another one.

Metadata comes from either a checked-in fixture (`--metadata`) or a live service (`--service
http://localhost:34377/breeze/NorthwindIBModel`). Then `--ext`, `--types`, `--nullable`,
`--no-index`, `--dry-run`. The contract is written up in `test/model/README.md`.

`--base <Name>` puts a base class of the caller's own under every generated root type, so that
behaviour can be shared across the whole model without giving up code generation. The generator
scaffolds it once, extending the generated `EntityBase`, and never rewrites it; only the root of
an inheritance chain extends it, so a metadata base type still wins. `--base-module`,
`--complex-base` and `--complex-base-module` go with it. Verified end to end — `instanceof` the
custom base, a getter and a method reaching a queried entity, and no unmapped properties added.

`test/unit/model-classes.spec.ts` (11 tests) pins the runtime behaviour: `instanceof`,
property read/write through Breeze's accessors, **no own properties shadowing the prototype**
(the `declare` rule), **no member becoming an unmapped property**, scalar and collection
navigations, complex properties, self-referencing navigations, and both registration rules.

### One library change went with it

`RelationArray` and `ComplexArray` now take a type parameter — `RelationArray<T extends Entity =
Entity>`, `ComplexArray<T extends ComplexObject = ComplexObject>` — so a collection navigation can
be `RelationArray<Order>` and keep `load()`, `arrayChanged` and `parentEntity` as well as typed
elements. The default argument makes every existing use compile unchanged.

### Not done yet

The 40 existing spec files still use untyped `Entity` and `getProperty`. Retrofitting them onto
these classes is the follow-on, and it is worth doing file by file rather than in one sweep.

## Typed API: generics on EntityQuery and EntityManager (done)

Breeze's public surface had **no generics at all** — `executeQuery` returned `results: any[]`,
`createEntity` returned `Entity`, `getEntities` returned `Entity[]`. That is the reason the spec
retrofit was so unsatisfying: converting `o.getProperty("freight")` to `o.freight` on an `any`
receiver compiles and checks nothing. This fixes it at the source.

Prompted by `unit-of-work.ts` in the `rifm.sa` repo, whose `TypedQuery<T>` solves the same problem
at application level. The typed facade is what came across; its RxJS layer did not (v3 has no
runtime dependencies, and the three signals are already `BreezeEvent`s — that belongs in the
Angular package parked in `deferred/`), nor its `_pendingSavePromise`, which drops the second
caller's entities and tag where `mixin-save-queuing` queues them properly.

| | |
|---|---|
| `EntityQuery<T = any>` | `from(ctor)`; every chaining method keeps `T`; `select()` drops to `any` |
| `QueryResult<T = any>` | `results: T[]` |
| `executeQuery`, `executeQueryLocally` | carry `T` through |
| `createEntity`, `getEntities`, `getChanges`, `fetchEntityByKey` | constructor overloads returning `T` |
| `entityTypeForCtor(ctor)` | exported, for building your own helpers |
| `EntityQuery.executeCount()` | new; `take(0).inlineCount(true)` |

### Two entry points, and only one is checked

`EntityQuery.from(Customer)` infers `T` from a registered constructor and reads the resource name
from metadata. `EntityQuery.from<Customer>('Customers')` is a claim nothing verifies — the docs say
so plainly, because `EntityQuery.from<Customer>('Orders')` compiles. The unchecked form stays
because projections, named server queries and anonymous results have no constructor to pass.

The checked form **requires `registerEntityTypeCtor`**, which is what puts `entityType` on the
prototype, and inherits the one-class-per-`MetadataStore` rule. An unregistered class throws a
message naming the call to make rather than querying `undefined`.

### Why it does not break existing code

Every default reproduces that API's *current* type. `QueryResult` defaults to **`any`**, not
`Entity`: measured, `T = Entity` produces 58 errors in this repo's own specs, `T = any` produces 0.
Type parameters and overloads are erased, so the emitted JavaScript is unchanged.

### Tests

`test/unit/typed-api.spec.ts` — 14 runtime tests covering both entry points, the state filter,
local execution, the unregistered-constructor error, and that untyped 2.x-style code still works.

Alongside them, `compilerMustReject()` — a function nothing calls, full of `@ts-expect-error`. An
unused `@ts-expect-error` is itself an error (TS2578), so `npm run typecheck` fails if any of them
stops being rejected. That is what stops the type parameters quietly becoming decorative: without
it, `EntityQuery<Order>` and `EntityQuery<Customer>` could become interchangeable and every runtime
test would still pass. Verified by making one line legal and watching the build fail.

Docs: `docs/guide/typed-entities.md`, plus a section in UPGRADE.md.

## dist/ is a publishable package (done)

`npm run build` stages `dist/` so it can be packed directly: `scripts/prepare-dist.mjs` writes
`dist/package.json` and copies `README.md` and `LICENSE` in. `npm run pack` then produces
`breeze-client-3.0.0.tgz`, which installs into another repo by path — a way to try the real
package without publishing.

The manifest is derived from the root `package.json`, not kept as a second file: every path
loses its `./dist/` prefix, `files` / `scripts` / `devDependencies` are dropped, and `main` and
`types` are added for tooling that does not read `exports`. Dropping `files` matters — it lists
`dist`, which from inside `dist` means `dist/dist`, and the tarball would have held only the
README and LICENSE.

**`npm pack dist` silently does the wrong thing**: npm reads a bare argument as a package spec
and downloads the registry package named `dist`. It needs `npm pack ./dist`. Hence the script.

Verified by installing the tarball into a fresh app — runtime through the root and a subpath,
and a consumer compiling against the shipped `.d.ts` under `NodeNext` + `strict` +
`skipLibCheck: false` (so the declarations themselves are checked) with no errors; `bundler`
resolution likewise. `node10` resolves the root import but not the subpaths, which is inherent
to an `exports`-only package; see CHANGES-DEV.md for why that is left alone.

## Typed API, second round (done)

A review of the rest of the public surface for methods that could carry a type. Nine more
signatures, all additive:

| | |
|---|---|
| `getEntityByKey(ctor, keys)` | `T \| null`; goes through the same `createEntityKey` helper as `fetchEntityByKey`, so the two cannot drift |
| `attachEntity(entity)`, `addEntity(entity)` | `<T extends Entity>(entity: T) => T`. They already returned the entity they were handed; the signature was throwing that away |
| `hasChanges(ctor)` | for consistency with `getChanges` / `getEntities` |
| `EntityQuery.fromEntities(entities)` | `EntityQuery<T>` |
| `EntityQuery.toType(ctor)` | `EntityQuery<T>` — the **checked** way to type a named query, as against the assertion `from<T>(name)` makes |
| `RelationArray<T>.load()` | `Promise<QueryResult<T>>` |
| `EntityType.createEntity<T>()` | `T`, defaulting to `any` — which is what it has always returned |

### The widening trap, again, and the fix

`fromEntities` inferring from its argument looked free until the test tier reported **9 errors**:
where the caller's variable is typed plain `Entity`, `U` infers as `Entity`, and the query became
`EntityQuery<Entity>` where it had been `EntityQuery<any>`. Every `results[0].whatever` in
existing code stops compiling — the same mistake as `QueryResult<T = Entity>` would have been.

`QueriedAs<U> = Entity extends U ? any : U` fixes it: a specific class maps to itself, plain
`Entity` maps back to `any`. Applied to `fromEntities` and to `RelationArray.load()`, which had
the same latent problem — `RelationArray` defaults `T` to `Entity`, so an untyped relation array's
`load()` would have started returning `Entity[]`.

It lives next to `Entity` in entity-aspect.ts and is exported from the barrel, because it appears
in a public signature — the rule this repo already follows for the 26 types the docs work
exported.

### Not done, with reasons

- **`SaveResult.entities`, `ImportResult.entities`, `QueryResult.retrievedEntities`** are
  heterogeneous by nature. A save returns whatever changed; `retrievedEntities` includes
  everything `expand` pulled in. `Entity[]` is the honest type and typing them would be a lie the
  caller then has to cast away.
- **`EntityAspect<T>`** would type `entityAspect.entity`, but `EntityAspect` is on every entity and
  threading a parameter through it is a large change for something already reachable via the class.
- **`registerEntityTypeCtor(ctor)`** deriving the name from `ctor.name` breaks under minification.
  The current design avoids exactly that by going through `prototype.entityType`.
- **`loadNavigationProperty(name)`** cannot be checked — a property name carries no type. Only an
  asserted form is possible, which is not worth a new overload.

`test/unit/typed-api.spec.ts` is 23 tests now, including one asserting that a plain `Entity` into
`fromEntities` still yields `any`, and five more `@ts-expect-error` lines so the new overloads
cannot quietly stop being load-bearing.

## fetchEntityByKey now reports absence as null (done)

`fetchEntityByKey`'s result gave `entity: undefined` when there was no entity, while everything
else in Breeze says `null` — an uncached scalar navigation, a nullable data property,
`getEntityByKey`. Confirmed at runtime before changing anything:

```
absent scalar navigation  order.customer  -> null
unset nullable data prop  order.shipName  -> null
getEntityByKey miss                       -> null
```

So one method disagreed with the whole library, and its own doc comment had said "or null" since
2.x — the documentation described the behaviour we have now, not the one we had.

`IEntityByKeyResult.entity` is `Entity | null` instead of an optional `entity?: Entity`, which
makes `result.entity === undefined` a **compile error** rather than a silently-always-false test.
Truthiness, `!= null` and `?.` are unaffected. Written up as breaking change 7 in UPGRADE.md.

Two assertions in `query-alt.spec.ts` covered the old sentinel (`expect(alfred3).toBeUndefined()`)
and now assert `toBeNull()` — verified against the real server, not just typechecked. A unit test
pins the wider rule: an uncached navigation, an unset nullable property and a missed key lookup
are all `null`.

The general point for anyone weighing `T | null` against `entity?: T` later: `undefined` is the
cleaner default in modern TypeScript, and it is the one that works with destructuring defaults.
In *this* library `null` wins, because Breeze models a database, where `null` is a value with
meaning, and it already says `null` everywhere else.

## Server error shapes: the client now understands RFC 9457 (done, client side)

Groundwork for making `breeze-server-v3` emit RFC 9457 problem details. The question was whether
that needs a coordinated client/server flag. It does not, and the reason is worth recording.

RFC 9457 section 3.2 allows **extension members**, and requires consumers to ignore ones they do
not recognize. So a server can send conformant problem+json that *also* carries `Message` and
`EntityErrors` at the top level, and an unmodified 2.x or 3.0 client reads it exactly as before.
`test/unit/server-error-shapes.spec.ts` pins four shapes end to end - through a real save, as far
as the `ValidationError` landing on the entity:

| shape | before | after |
|---|---|---|
| A. `{ Code, Message, EntityErrors }` | works | works |
| B. problem+json **+** those as extensions | works | works |
| C. problem+json + camelCase `entityErrors` | **threw** | works |
| D. as C, type name pre-normalized | generic message | works |

### Two real client bugs this turned up

- **`createError`'s two branches were not symmetric.** The .NET branch runs
  `MetadataStore.normalizeTypeName` on `EntityTypeName`; the camelCase branch took the array
  as-is. A server sending the natural `Foo.Customer` in a camelCase payload got
  *"Unable to locate a 'Type' by the name: 'Foo.Customer'"* out of the entity lookup, with
  nothing connecting it to the error format. Both branches normalize now.
- **A problem+json body produced a confidently wrong message.** Not an empty one - `createError`
  ends with `message || "Server side errors encountered - see the entityErrors collection..."`,
  so a query failure reported a save-error string with no entity errors attached. It now reads
  `detail`, then `title`.

Both are pinned: reverting the first fails 1 test, reverting the second fails 3.

### What EntityErrors need, and why they matter

They are not decoration. `processServerErrors` resolves `keyValues` + `entityTypeName` back to the
cached instance and adds a `ValidationError` with `isServerError = true` to its `entityAspect` -
that is how a server-side rule reaches the UI. The shape it needs at that point is camelCase
`errorName` / `entityTypeName` / `keyValues` / `propertyName` / `errorMessage` / `custom`, with
`propertyName` converted through the naming convention. A flat RFC 9457 `errors` map cannot carry
this: it has no way to say *which instance* of a type failed, and a save can fail on several.

### Still to do, in breeze-server-v3

1. Emit `ProblemDetails` with `Message` / `EntityErrors` as extensions, content type
   `application/problem+json`. **Check the extensions serialize flattened, not nested under
   `extensions`** - the filter uses Newtonsoft, and if they nest, hybrid B silently stops working
   for old clients.
2. `ErrorDto.Code` is `0` for anything that is not an `EntityErrorsException`, while the HTTP
   status is 500. `status` replaces it.
3. `StackTrace` off unless `IWebHostEnvironment.IsDevelopment()`, with a config override. It is
   currently unconditional.
4. 409 for duplicate-key / FK violations, behind a provider hook rather than hard-coded SQL Server
   error numbers (2627/2601/547), since Breeze also supports NHibernate.

No client flag is needed for any of it. The server flag, when it comes, means "stop sending the
legacy extension members", not "switch format".
