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
- (Adapters used to register themselves at import time as well. They no longer do:
  registration is explicit, through `configureBreeze` or an adapter's `register()`.)

The three remaining side effects keep the flag `true`. Replacing them with explicit
initialization is on the list in STATUS.md.

## Public API surface

`src/breeze.ts` exports **53 runtime values** (classes, `BreezeEnum` subclasses,
functions, `config`, `core`, `breeze`) and **75 type-only names**. The type-only ones
erase at runtime and are exported with `export type`, so browser ESM never goes looking
for them.

26 of the type exports are new in v3: config objects, event args, callbacks, `SaveError`,
`ImportResult` and adapter-author types that public signatures already used but that could
not be imported by name. Internal types that public signatures happen to mention
(`InterfaceDef`, `Op`, `Param`, `RecursiveArray`, `QueryOp`, `BooleanQueryOp`, core's
`Predicate` alias) are deliberately *not* exported; `typedoc.config.mjs` lists them in
`intentionallyNotExported`. Moving a name between those two lists is an API decision, not
a way to silence a warning.

Quirks carried over from 2.x:

- `breeze.version` is hardcoded `"2.1.5"` while the package is `2.2.2`.
- `breeze.assertConfig` / `breeze.assertParam` are `null as any` on the `breeze` object,
  though the named exports work. The fix is sitting commented out in `src/breeze.ts`.
- `Param` and `BooleanQueryOp` are reachable only via the `breeze` object, never as
  top-level exports. `BreezeEvent` appears on the object as `Event`.
- A number of `@hidden`/`@internal` symbols are exported anyway — `assertParam`,
  `assertConfig`, `MappingContext`, `SaveContext`, `SaveBundle`, the predicate internals,
  and `OrderByClause` / `SelectClause` / `ExpandClause`, which uri-builder authors need.

Fixed: `ErrorCallback` and `ValidationErrorsChangedEventArgs` were each declared twice.
Each now has one declaration.

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

## Object-as-map to Map

Where a structure is keyed by *data* rather than by fixed property names, it is now a real
`Map` (or `Set`). That removes the `delete` operator, `for...in` with `hasOwnProperty`
guards, and the prototype-collision hazard of using a plain object as a dictionary — and
Map's insertion order is defined, which one call site was already relying on implicitly.

**Converted:**

| Was | Now | Note |
|---|---|---|
| `InterfaceDef._implMap` | `Map<string, IDef<T>>` | `getFirstImpl` takes the first value directly instead of going via `core.objectFirst` |
| `FnExpr._funcMap` | `Map` | seeded from the existing object literal with `Object.entries`, so the declaration still reads as a table |
| `SaveMemo.entityMemos` | `Map` | adds, renames a key during pk fixup, deletes, iterates — the best fit of the lot |
| `BreezeEvent.__eventNameMap` | `Set<string>` | only ever recorded membership; the boolean value carried nothing |
| `MetadataStore._shortNameMap` | `Map<string, string>` | explicitly documented as not serialized |
| `MetadataStore._ctorRegistry` | `Map<string, CtorRecord>` | internal |
| `MetadataStore._incompleteTypeMap` | `Map<string, NavigationProperty[]>` | see note on import below |
| `MetadataStore._incompleteComplexTypeMap` | `Map<string, DataProperty[]>` | internal |
| `MetadataStore._deferredTypes` | `Map<string, any[]>` | internal |
| `EntityManager._entityGroupMap` | `Map<string, EntityGroup>` | the most-used of them; the export path still builds a plain object |
| `UnattachedChildrenMap.map` | `Map<string, INavTuple[]>` | get-or-create, lookup, delete |
| `KeyGenerator._tempIdMap` | `Map<string, IPropEntry>` | private |
| `IPropEntry.keyMap` | `Set<string>` | recorded which generated ids were taken; the values were always `true` |

`core.getMapArray(map, key)` was added as the Map counterpart of `core.getArray` —
get-or-create-array, which three of these needed.

`MetadataStore.getIncompleteNavigationProperties()` is public and still returns an array;
it is now `Array.from(map.values())` instead of `core.objectMap`.

`importMetadata` reads `json.incompleteTypeMap` as a plain object, because that is the
serialized shape. It now merges those entries into the Map explicitly. **The wire format
is unchanged.**

**Deliberately not converted.** A Map is wrong when the structure is public API or crosses
the wire:

- `BreezeConfig.functionRegistry` / `typeRegistry` / `objectRegistry` — public fields that
  applications read directly.
- `Validator.messageTemplates` — public, and used with dot notation
  (`Validator.messageTemplates.countryIsUS = ...`).
- `MetadataStore._resourceEntityTypeMap` / `_entityTypeResourceMap` — `exportMetadata`
  writes the first straight into the metadata JSON.
- `MetadataStore._structuralTypeMap` — serialized via `core.objectMap` in `exportMetadata`.
- `EntityAspect.originalValues`, `MappingContext.refMap` (returned to callers as
  `data.retrievedEntities`), and every JSON fragment the predicate visitors build.

The rule: **a `Map` for internal state, a plain object for anything a consumer touches or
that gets `JSON.stringify`d.** `JSON.stringify(new Map())` is `{}`, which would fail
silently.

### The trap, twice

Both times this bit, the cause was the same shape: **the object-based helper tolerated
`undefined`, and the `Map` method does not.**

- `core.objectMap(undefined, fn)` returns `[]`. `undefined.values()` throws. `EntityManager`'s
  constructor calls `clear()` *before* `_entityGroupMap` is assigned, so `clear()` runs once
  against an undefined field — by design, apparently. 572 of 639 tests failed until
  `clear()` got an optional-chaining guard.
- Earlier, in `core.ts` itself, `for (let key in null)` is a silent no-op while
  `Object.keys(null)` throws. Same 572 failures, same root cause.

When converting one of these, check whether the call site can pass `undefined` — the old
code very often relied on it silently.

## The request path is promise-based

`AbstractDataServiceAdapter`'s three entry points — `fetchMetadata`, `executeQuery` and
`saveChanges` — were each a `new Promise((resolve, reject) => ...)` wrapped around an
`ajaxImpl.ajax({ ..., success, error })` call, with error handling duplicated in six
callbacks. They are now `async` methods with linear bodies.

All the callback plumbing collapsed into **one** method:

```ts
protected _ajax(config, errorMessagePrefix?, prepareResponse?): Promise<HttpResponse>
```

This is deliberately the single seam: the only method that deals in callbacks. See
[The ajax adapter is optional](#the-ajax-adapter-is-optional).

`handleHttpError(reject, response, prefix)` split into `makeHttpError(response, prefix)`,
which *builds* the error, plus a thin deprecated `handleHttpError` that rejects with it.
Separating construction from rejection is what let the callers use `throw`.

### Two things this exposed

**`saveContext` must be attached before the error is built.** `createError` reads
`httpResponse.saveContext` to attach per-entity validation errors. The first version of
this refactor set it *after* building the error and broke two save-error tests — hence
the `prepareResponse` hook, which runs on both the success and error paths before any
error is constructed.

**A latent bug in `fetchMetadata`.** Its old catch block called `handleHttpError(reject,
...)` and then *carried on* to `metadataStore.addDataService(dataService)`. The promise
was already rejected, so the only effect was registering a data service whose metadata had
just failed to import. The `async` version throws, so that line no longer runs. This is a
behaviour change, and an intended one.

## The ajax adapter is optional

`src/http.ts` is now the one implementation of an HTTP request. `toFetchArgs` turns
Breeze's request description (`AjaxConfig` without the callbacks) into a fetch call, and
`sendFetch` reads the response into an `HttpResponse`, resolving with an outcome rather
than ever rejecting. `AjaxFetchAdapter` moved there and is built on those two functions;
`adapter-ajax-fetch.ts` is a re-export, kept for the published subpath.

`AbstractDataServiceAdapter.initialize()` takes the registered default ajax adapter if
there is one, and otherwise `builtinAjax`: an `AjaxFetchAdapter` whose transport reads
`config.fetch` on each call. It no longer throws, which removes the registration-order
trap. `_ajax` still reaches the network through `ajaxImpl` and its callbacks. That is now
only a compatibility layer, and keeping it is what lets a custom ajax adapter,
`AjaxPostWrapper`, and subclasses that call `this.ajaxImpl.ajax` directly keep working.

Not done, deliberately: the `"ajax"` registry slot, `AjaxAdapter` and
`AjaxRequestInterceptor` remain, marked `@deprecated`. Removing them would break 2.x
startup code for no runtime gain.

`http.ts` imports `./config` and `./core` directly, never the `./breeze` barrel: the
abstract data service adapter depends on it, and the barrel depends on that.

The test suite no longer registers an ajax adapter (`test/test-fns.ts`), so the
integration and browser tiers exercise the default path. `fetch-transport.spec.ts` covers
it without a server; the specs that use `AjaxFakeAdapter` keep covering the deprecated
slot.

## Dead server-backend switches removed from the tests

The 2.x suite ran against several servers and carried a flag for each in `test/test-fns.ts`.
Breeze 3 has no Sequelize, Java Hibernate, OData or Mongo server, so those flags were always
false; they, their branches and their skip conditions are gone. Where a dead flag was a
test's only skip condition, the test now simply runs (it already did). Nothing runs
differently: integration 448 + 7 skipped and browser 652 + 7 skipped, before and after.

`isNHibernateServer` stays, because `Breeze.Persistence.NH` is still a shipping package in
breeze-server-v3; whether it stays in v3 is an open decision.

Outside the tests, OData is still *named* in the migration guide, UPGRADE.md, the CSDL error
message and a few docs pages. That is deliberate: those are the notices that tell a 2.x
user OData is gone and what to use instead. `"NOdataServices"` in two metadata fixtures is
a deliberately disabled `dataServices` key, not OData.

## Packaging: Node ESM and the published types

The suite imports `src/` directly, so it never exercised the built package. A consumer
check — pack, install into a fresh Vite + TypeScript app, `tsc`, a Node import, one query
end to end — found two blocking defects.

- **Extensionless relative imports.** `moduleResolution: "bundler"` accepts
  `from './config'`; Node's ESM loader does not, so `import('breeze-client')` failed with
  `ERR_MODULE_NOT_FOUND`. Every relative specifier in `src/` now ends in `.js`, including
  the two `declare module "./…"` augmentations, and `tsconfig.json` uses `NodeNext` for
  `module` and `moduleResolution`, which makes an extensionless import a compile error.
  Vite and Vitest resolve `./x.js` to `x.ts`, so the tests are unaffected.
- **`stripInternal` versus re-exports.** `breeze.ts` re-exports `assertParam`,
  `assertConfig` and `Param`, but they were `@internal`, so the published
  `assert-param.d.ts` was empty and `breeze.d.ts` did not compile. The rule: nothing
  `breeze.ts` exports may be `@internal`. Use `@hidden` to keep it out of the docs.

Source maps now use `inlineSources`, since the package ships `dist/` only, and declaration
maps are off.

## The tests have their own TypeScript project

`tsconfig.json` covers `src/` only, so until now the specs were checked by nothing: VS Code
fell back to a default project that knew neither Vitest's globals nor the JSON fixtures,
and showed hundreds of errors. `test/tsconfig.json` extends the root config and adds
`vitest/globals`, Node types and `resolveJsonModule`. It uses `bundler` resolution, because
the specs import `../../src/...` without extensions and only ever run under Vite. The
library keeps `NodeNext`. `test/global.d.ts` puts the `jest-extended` matchers on Vitest's
`Assertion`.

The tests are checked without `strictNullChecks`. With it on there were 410 errors, almost
all null-handling in code ported from 2.x, which never had the setting. With it off, 37
remained, and they were fixed rather than relaxed away. They included a real hole:
`enum.spec.ts` called `fail()`, which Vitest does not define, inside a `try` whose `catch`
swallowed the `ReferenceError`, so that check could never fail.

`npm run typecheck` now checks both projects.

## Default adapters: nothing needs registering

With no configuration at all, `new EntityManager(serviceName)` works: Breeze falls back to
the backing-store model library, the JSON uri builder and the Web API data service, and
sends requests through `config.fetch`.

- `config.ts` keeps a fallback table (`setDefaultAdapters`). `getAdapterInstance` and
  `initializeAdapterInstance` consult it through `_registerDefaultAdapter` when an interface
  has nothing registered, and `interfaceRegistry.modelLibrary.getDefaultInstance` does the
  same. The default is registered on first use - importing Breeze still registers nothing -
  and anything an application registers wins.
- `default-adapters.ts`, imported by the barrel, fills the table. It also maps a *named*
  `ajax` `'fetch'` lookup to an adapter that reads `config.fetch`, so 2.x startup code that
  initialized the standard adapters by name, without registering them, works again. The
  unnamed ajax default stays "none": requests already go through `config.fetch`.
- **The three adapter modules import their dependencies directly, not through
  `./breeze.js`.** The barrel imports them now, and `DataServiceWebApiAdapter` extends
  `AbstractDataServiceAdapter` while its module loads, so a barrel import would be a cycle
  that fails at load time. The rule: a module the barrel imports must not import the
  barrel. (`adapter-ajax-post` and the two mixins still do; the barrel never loads them.)
- Cost: the three default adapters are always in the root bundle. Real applications always
  included them anyway; core plus the three is still about 171 KB minified, 47 KB gzip.
- `test/test-fns.ts` registers nothing, so the integration and browser tiers run on the
  defaults. `default-adapters.spec.ts` and `default-adapters-named.spec.ts` cover the
  no-registration path without a server.

## The default naming convention is camelCase

`NamingConvention.defaultInstance` is now `camelCase` (it was `none`). With the default
adapters, a Breeze .NET server needs no configuration at all. Stores and managers take the
default when they are created, and a store that imports metadata naming a convention still
adopts it while empty.

`test/test-fns.ts` no longer sets a naming convention, so the server-backed tiers run on
the default. `ajax-fake.spec.ts` and `complex-type.spec.ts` set `NamingConvention.none`
explicitly: their fixture, `ComplexTypeMetadata.json`, uses PascalCase client property
names and names no convention of its own.
