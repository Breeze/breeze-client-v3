# breeze-client v3 — developer change log

A running summary of structural changes, for people working **on** Breeze. Consumer-facing
changes are in [UPGRADE.md](./UPGRADE.md); current task state is in [STATUS.md](./STATUS.md).

---

## Build

**Was:** `ng-packagr` — an *Angular library packager* — driving the whole build from two
sibling trees, `build-cjs/` and `build-mjs/`, each with its own `node_modules`, its own
Angular (9 vs 16) and its own TypeScript (3.8 vs 4.9). Output was post-processed by
`downlevel-dts` and six `tools/*.js` scripts, then published as two npm dist-tags of the
same package. The twelve secondary entry points existed only as `ng-package.json` stubs in
otherwise-empty top-level folders.

**Now:** one `tsc` invocation, one `tsconfig.json`, one `node_modules`.
`npm run build` → 42 `.js` + 42 `.d.ts`.

The root cause of all that machinery was narrow: exactly one file,
`adapter-ajax-httpclient.ts`, imported `@angular/common/http`. That single import is why an
Angular build tool packaged the entire library. Moving it out of the package removed the
whole apparatus.

Entry points are now a plain `exports` map: root plus seven subpaths.

## Source removals

51 files / 19,708 lines → **42 files / 15,630 lines**.

| Removed | Why |
|---|---|
| 5 adapter files (ko, jquery, angularjs, odata dataservice, odata uribuilder) | product decision |
| `csdl-metadata-parser.ts` (430 lines) | CSDL/EDMX is the OData metadata format |
| `DataType.fromEdmDataType` | only caller was the CSDL parser |
| 20 `fmtOData` entries + 11 `fmt*` helpers + private `throwError` (~85 lines of `data-type.ts`) | only callers were the two OData adapters |
| OData v3 `Edm.Time` branch in `parseTimeFromServer` | ditto |
| OData v3 `.results` unwrap in `mergeRelatedEntitiesCore` | ditto |
| `metadataJson.schema` branch in `MetadataStore.importMetadata` | ditto |

Worth knowing: of the four libraries removed, **only Angular was ever a real module
import.** jQuery, AngularJS, Knockout and the OData client were resolved at runtime through
`core.requireLib("ko;knockout")` and `declare var jQuery`, so they never appeared in the
dependency graph. Removing them was a product decision, not a build one.

## TypeScript settings

Two settings are deliberately loose, both commented at the point of use.

**`noImplicitAny: false`.** The 2.x build hid **106 `TS7053` index-signature errors across
20 files** behind `suppressImplicitAnyIndexErrors`. TypeScript removed that flag in 5.5, so
they surface now and need real fixes. Re-enable per module as each is modernized.

**`strictNullChecks: false`**, as in 2.x. Turning it on is the single biggest chunk of the
modernization pass. Note the deliberate `p2?: Entity` (not `| null`) parameter convention
documented in the old `BUILD.md` — that is intentional API design, keep it.

## `sideEffects` must stay `true`

This is the most dangerous thing in the codebase for an ESM rewrite. The obvious move for a
modern library — `"sideEffects": false` — would silently break serialization.

At import time the modules:

- brand `_$typeName` onto **25 class prototypes** (`DataService`, `EntityType`,
  `EntityQuery`, `Validator`, …). `config.registerType` and import/export depend on it.
- run ten `Error['x'] = <Enum>.resolveSymbols()` statements. The `Error['x'] =` prefix is
  not meaningful — it is an idiom to stop Terser treating the call as dead code. See the
  comment at `src/enum.ts:47`.
- call `BreezeEvent.bubbleEvent(EntityManager.prototype)` and the same for
  `MetadataStore.prototype`, and apply the entity-graph mixin.
- register every adapter **twice**: once as a module-level side effect, once via its
  static `register()`.

The `configureBreeze` work should replace these with explicit initialization. Until then,
the flag stays.

## Public API surface

92 exported names from `src/breeze.ts`: **52 runtime values** (37 classes, 7 `BreezeEnum`
subclasses, 5 functions, `config`, `core`, `breeze`) and **40 type-only** (36 interfaces,
3 type aliases, the `promises` namespace). The type-only ones erase at runtime, so the
barrel rewrite must keep the 52 as real exports and can use `export type` for the rest.

Quirks carried over from 2.x, to fix during the barrel rewrite:

- `breeze.version` is hardcoded `"2.1.5"` while the package is `2.2.2`.
- `breeze.assertConfig` / `breeze.assertParam` are `null as any` on the `breeze` object,
  though the named exports work. The fix is sitting commented out at `src/breeze.ts:172-173`.
- `Param` and `BooleanQueryOp` are reachable only via the `breeze` object, never as
  top-level exports. `BreezeEvent` appears on the object as `Event`.
- `ErrorCallback` and `ValidationErrorsChangedEventArgs` are each declared twice in
  different files.
- A number of `@hidden`/`@internal` symbols are exported anyway — `assertParam`,
  `assertConfig`, `MappingContext`, `SaveContext`, `SaveBundle`, the predicate internals,
  and `OrderByClause`, which is commented "for testing only".

## Repo layout

`src/` is still flat, matching 2.x. Regrouping by concern (`core/`, `metadata/`, `entity/`,
`query/`, `manager/`, `validation/`, `config/`, `adapters/`, `mixins/`) is deliberately
deferred: moving 42 files and rewriting imports at the same time as deleting code would
make any breakage impossible to attribute.

`deferred/` holds the Angular adapter, excluded from the build, pending its own package.

## Tests

Moving from Jest to **Vitest**, and eventually Vitest **browser mode** — Breeze is a
browser library, but the suite has always run in Node behind a `node-fetch` shim.

The port is done for the node environment: **621 passing, 5 failing, 7 skipped of 633**,
parity with the 2.x Jest baseline. Browser mode is next and needs CORS on the test server.

The port exposed two pre-existing bugs that Jest had been hiding, because
`spec/tsconfig.json` set `"target": "es5"` and did not exclude `breeze-client` from
`transformIgnorePatterns` - so the harness compiled the library down to ES5 and masked
every ES2022 class semantic. `JsonResultsAdapter` was missing a `declare` on its
`_` field, so the constructor shadowed the prototype brand with `undefined`; and
the fetch adapter set `referrer: "client"`, which Node rejects as an invalid URL. The same
downlevel is why `Predicate(...)` without `new` appeared to work in 2.x.

Two things about the existing suite that shape the rewrite:

**It is not isolated.** 27 of 39 spec files need a live server and a SQL Server database,
and they mutate it. The suite both adds rows (`Employee` 9 → 11) and deletes them
(`Employee` ID 7 disappears — most likely `save-basic.spec.ts:176-213`, which
hand-assembles a key and issues a raw delete). Consequently the pass count moves between
runs: **623–624 of 636**.

**One test is designed to depend on another file's leftovers.** `query-misc.spec.ts:337`
asserts that `Employees where employeeID > 10` returns a row. Northwind ships nine
employees. It passes only because `bugs.spec.ts:354` permanently inserts a "John Doe"
employee whose name does not match the cleanup predicate. Run the file alone, or against a
clean database, and it fails.

The only cleanup mechanism is `SaveTestFns.cleanup()`, a blanket delete of anything named
`Test*` or `foo*`, registered in the `afterAll` of just three files, and it swallows its
own errors. Filter those files out of a run and nothing is ever cleaned up.

The fix is a per-run database rebuild, not a better cleanup script — re-applying
`tests/Databases/BreezeTestDb.sql` from the server repo takes seconds and is proven to
restore a correct baseline.
