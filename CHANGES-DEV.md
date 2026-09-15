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

## `sideEffects`

`package.json` names exactly one module:

```json
"sideEffects": ["./dist/mixin-get-entity-graph.js"]
```

Everything else is side-effect free, so a bundler may drop any module whose exports the
application never uses. That was **not** true when the port started, and what made it true
is worth knowing before adding any top-level code.

**Import-time code that is safe** acts only on the module's own declarations: branding
`_$typeName` onto a class declared there, `resolveSymbols()` on its own enum,
`BreezeEvent.bubbleEvent(EntityManager.prototype)`. Whoever needs the result uses one of
that module's exports, which is exactly what keeps the module in the bundle.

Sixteen of those calls used to be written `Error['x'] = MyEnum.resolveSymbols()`. The
comment in `enum.ts` blamed Terser, which was wrong - Terser never drops a call it cannot
prove pure, and it keeps the bare form untouched. The prefix defended against *Rollup*, and
only while the package said `"sideEffects": true`: Rollup can see that
`MyEnum.resolveSymbols()` writes to nothing but `MyEnum`, so if `MyEnum` is being dropped it
deletes the call too, whereas a write to the global `Error` is observable and has to stay.

Once `sideEffects` named only the mixin, that stopped mattering - a module whose exports
nothing uses is dropped either way, and a module something does use keeps both forms. So
the prefix was removed, along with the special case it needed in `side-effects.spec.ts`.

**What is not safe** is a statement that reaches into *another* module, because the bundler
may drop the module that holds it while keeping the one that needs the effect:

- `config.interfaceRegistry` and `config.initializeAdapterInstances` were installed by
  `interface-registry.ts`, which otherwise holds only types. Nothing imports a value from
  it, so it was dropped - and every adapter lookup failed. Both now live in `config.ts`;
  `interface-registry.ts` re-exports `InterfaceRegistry`, so importers see no change.
- `default-adapters.ts` called `setDefaultAdapters(...)` at import time, and the barrel
  imported it for that effect alone - the first thing a bundler removes. It now exports
  `serverDefaultAdapters`, which `entity-manager.ts` installs, and the model-library
  default moved to `entity-metadata.ts`, because a `MetadataStore` needs one even in a
  bundle with no `EntityManager`. *Using a value* is what keeps a module.
- `mixin-get-entity-graph.ts` patches `EntityManager.prototype` and exports nothing that
  anyone imports. It is a genuine side effect, and the reason the array is not empty.

Adapters no longer register themselves at import time either: registration is explicit,
through `configureBreeze` or an adapter's `register()`.

`test/unit/side-effects.spec.ts` holds the line. It parses every module in `src/` with the
TypeScript API and fails on any top-level statement that acts on an import unless that
statement is listed there with a reason, it checks `package.json` still lists only the
mixin, and it loads each module first, on its own, to catch import cycles. New top-level
code that touches an import means a new entry in that list - or, better, an explicit call
from the code that needs it.

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

**It was not isolated.** 27 of 39 spec files need a live server and a SQL Server
database, and they mutate it. The suite both added rows (`Employee` 9 → 11) and deleted
them (`Employee` ID 7 disappeared — most likely `save-basic.spec.ts:176-213`, which
hand-assembles a key and issues a raw delete), so the pass count moved between runs:
**623–624 of 636**. One test was even designed to depend on another file's leftovers:
`query-misc.spec.ts` asserted that `Employees where employeeID > 10` returns a row, which
held only because `bugs.spec.ts` permanently inserted a "John Doe" employee whose name
does not match the cleanup predicate. The only cleanup mechanism, `SaveTestFns.cleanup()`,
was a blanket delete of anything named `Test*` or `foo*`, registered in the `afterAll` of
just three files, and it swallowed its own errors.

**Now every file starts from the same database.** `test/global-setup.ts` rebuilds
`BreezeTestDb` from the server repo's `BreezeTestDb.sql` once per run and has the test host
take a SQL Server database snapshot of it; `test/integration-setup.ts` reverts to that
snapshot before each integration file. The revert is an HTTP call to the test host
(`POST /breeze/TestDb/Reset`), so it works in Chromium too — about 0.2 s per file, roughly
10 s per run. The four tests that relied on another file's rows now create their own, and
the pinned alphabetical file order is gone: files are shuffled on every run, which is what
keeps them independent. The seed is printed, and `--sequence.seed=<n>` repeats an order.

## `src/` grouped by concern

45 modules sat flat in `src/`. They are now in nine folders:

| folder | what it holds |
|---|---|
| `core/` | `core`, `enum`, `event`, `assert-param` |
| `config/` | `config`, `configure`, `interface-registry`, `default-adapters` |
| `adapters/` | the five shipped adapters, `abstract-data-service-adapter`, `adapter-core`, and `http` — the one implementation of an HTTP request |
| `metadata/` | `entity-metadata`, `data-type`, `naming-convention`, `data-service`, `local-query-comparison-options` |
| `entity/` | `entity-aspect`, `entity-key`, `entity-state`, `entity-action`, `entity-group`, `default-property-interceptor`, `unattached-children-map`, `key-generator`, and the four array modules |
| `query/` | `entity-query`, `predicate`, `query-options`, `mapping-context` |
| `manager/` | `entity-manager`, `save-options` |
| `validation/` | `validate`, `validation-options` |
| `mixins/` | `mixin-get-entity-graph`, `mixin-save-queuing` |

`src/breeze.ts` stays at the root. It is the barrel, TypeDoc's entry point, and what the
package's root export resolves to.

**Nothing about the public API moved.** The `exports` map publishes the same eight entry
points; only the files behind them are in new places (`./dist/adapters/…`,
`./dist/mixins/…`), and the `"sideEffects"` entry moved with the mixin. Every file was
moved with `git mv`, so `git log --follow` still works.

The move was mechanical and scripted: 44 files relocated, 218 import specifiers inside
`src/` rewritten to the new relative paths, and 59 in the specs. Two things had to be
taught the new shape - `test/unit/side-effects.spec.ts`, which walks `src/` and keys its
list of allowed import-time statements by file, and `typedoc.config.mjs`, whose
`intentionallyNotExported` names a path.

Verified after the move: typecheck clean, unit 319, integration 450 + 7 skipped, browser
718 + 7 skipped, a docs build with no TypeDoc warning, and - against the packed tarball -
every published subpath resolving and loading, with bundle sizes unchanged: 329.6 KB for an
app using only `MetadataStore`, 455.0 KB with `EntityManager`, 460.4 KB adding the mixin
subpath.

## The observable arrays

`relationArray`, `complexArray` and `primitiveArray` are the collections that hang off an entity -
`order.orderDetails`, `customer.invoiceNumbers`. They have to notify when they change, and they
have to be *real* arrays, because applications index them, iterate them, spread them and
`JSON.stringify` them.

**Was:** `core.extend` copied a mixin onto each array **instance** - ten shared functions, four or
five more per kind, plus the data properties: **18 own properties on every array**. That is what
made them observable, and it is also what made them slow. Past roughly a dozen own properties V8
moves an array to dictionary properties, and indexed reads fall off a cliff.

**Now:** only the five mutators sit on the instance - they have to, to be intercepted - plus
`_getEventParent`, which `BreezeEvent` looks for on the publisher itself. The per-kind behaviour is
one shared `ops` object and the bookkeeping is one state object, both reached through a single
`_obs` property: **11 own properties for a relation array, 10 for the other two.**

Measured on real entities (2,000 employees with 20 orders each, Node 24, same checksum both sides):

| | own props | create | push | indexed read | forEach |
|---|---|---|---|---|---|
| before | 18 | 66.4 ms | 604.3 ms | 63.4 ms | 14.4 ms |
| after | 11 | 58.1 ms | 559.5 ms | **6.4 ms** | **6.6 ms** |

**Why not the tidier-looking options.** Both were measured, one variant per process so that
inline caches stay honest:

- `class extends Array`, or swapping the prototype with `setPrototypeOf`: indexed reads are fine,
  but `forEach`/`map`/`filter` become about 20x slower (197-240 ms against 10 ms), because the
  built-ins lose their fast path as soon as the receiver's prototype is not `Array.prototype`.
  Iterating these collections is the common case, so that trade is the wrong way round.
- `Proxy`: about 400x on reads, and it would quietly change behaviour - it would start firing
  `arrayChanged` on `arr.length = 0` and `arr[i] = x`, which `entity-aspect.ts` and
  `entity-metadata.ts` do deliberately, and which the suite asserts exact event counts around.

**What moved.** The application-facing surface is unchanged: `push`/`pop`/`shift`/`unshift`/`splice`,
`arrayChanged`, `load()`, `parentEntity`, `navigationProperty`, `parent`, `parentProperty`, and every
native array method. What is no longer *on the array* is the internal machinery - `_push`,
`_processAdds`, `_processRemoves`, `_getGoodAdds`, `_beforeChange`, `_getPendingPubs`,
`_rejectChanges`, `_acceptChanges`, `_origValues`, `_addsInProcess`, `_inProgress` and
`getEntityAspect()`. Breeze reaches them through helpers on the internal `observableArray` object;
a plugin that called them directly needs those helpers instead. Removing them from the instance
is not incidental - it is the whole point, since the cost was the property count itself.

The typing improved with it: `ObservableArray<T>` now extends `Array<T>`, so `arr.forEach` is typed
rather than reachable only through an untyped `this`, the hand-written index signatures are gone,
and the three "mixin impl is not very typesafe" TODOs with them. The six mutators also lose the
`Object.getPrototypeOf(this).push ? ... : Array.prototype.push` branch they each carried, which was
dead on a plain array.

`test/unit/observable-array.spec.ts` pins the own-property count, the prototype, the sharing of the
ops and mutator objects, and the notification behaviour, so this cannot drift back over the cliff.

Verified: typecheck clean, unit 328, integration 450 + 7 skipped, browser 727 + 7 skipped.

## Calls to deprecated APIs

Breeze keeps a deprecated compatibility surface on purpose - the 2.x adapter-registration
pattern, the ajax adapter, a few misnamed metadata lookups. What it should not do is *call* that
surface itself, or teach it in examples. Both had drifted.

**The metadata lookups.** `MetadataStore.getEntityType` returns an `EntityType` *or* a
`ComplexType`, which is why it is deprecated. The specs called it 67 times, usually as
`getEntityType("Order") as EntityType` - the cast is the tell. Each call now says what it
expects: `getAsEntityType` (32 casts dropped, 31 bare calls), `getAsComplexType` (3 - `Location`
and `Role`, which are complex types in `ComplexTypeMetadata.json` but not in Northwind), and
`getStructuralType` for the one call taking a name of either kind. `getEntityCtor()` - an alias
for `getCtor()` - had one internal caller, and the webapi adapter's `visitNode` looked up
`$type` through the deprecated method; it now uses the internal `_getStructuralType`, which is
what all of these delegate to anyway. 62 JSDoc and guide examples taught `getEntityType`; they
now show `getAsEntityType`.

**`EntityManager.findEntityByKey`** is a pure alias for `getEntityByKey`. 11 calls across four
spec files moved. (`EntityGroup.findEntityByKey` is a different method and is not deprecated.)

**Two deprecations were mis-scoped, and are corrected rather than worked around:**

- `getStructuralType` was marked deprecated while `getEntityType`'s own deprecation said it had
  been *replaced by* `getStructuralType`. Nothing replaces it: it is the lookup for "entity type
  or complex type, I do not know which", which is exactly what a `JsonResultsAdapter` doing
  `$type` dispatch needs. It is no longer deprecated; `getEntityType` still is, for its name.
- `config.registerAdapter` and `config.initializeAdapterInstance` are deprecated for configuring
  an application - `configureBreeze({ ... })` replaced that. But `configureBreeze` works by
  calling an adapter's static `register()`, and `register()` has to register the adapter
  somehow. That call is now documented as the sanctioned use, so Breeze's own adapters - and
  anyone writing a custom one - are not calling something deprecated.

**`useJsonp` was documented too strongly.** "It has no effect" appeared in the type, UPGRADE.md
and three guide pages, but `_makeQueryGetParams` still sets `dataType`/`crossDomain` from it, and
a registered (deprecated) ajax adapter can act on those. The wording now says what is true: no
effect on Breeze's own transport.

**What deliberately stayed.** The specs that exercise the deprecated registration path
(`adapter-init`, parts of `configure-ns`, `default-adapters-named`) are testing the
compatibility surface, which is the point of having it. `AjaxFetchAdapter` and `ajaxImpl` remain
the bridge that lets a 2.x ajax adapter keep working, and the internal default adapter is built
on them.

Verified: typecheck clean for both source and tests, unit 328, integration 450 + 7 skipped,
browser 727 + 7 skipped.

## The backing store

`ModelLibraryBackingStoreAdapter` is how a plain object becomes a tracked entity: every mapped
property becomes an accessor **on the prototype** - defined once per type - and the values live in
a `_backingStore` object on the instance. A get reads the store; a set hands the property, the new
value and an accessor for the old one to the entity's `_$interceptor`, which is where change
tracking happens.

**The file looked expensive and is not.** Measured, of the time spent setting a tracked property:

| | share |
|---|---|
| change tracking in the interceptor | **96%** (validation alone ~63%) |
| the plumbing in this adapter | ~2% |
| the raw store write | ~1% |

So the reason to touch it was that it was *complicated*, not slow. What went:

- **The IE9 workarounds.** `_pendingBackingStores`, `getPendingBackingStore` - which did a linear
  scan of a per-prototype array on every set while an instance's store was "pending" - and
  `processPendingStores`, plus the two-phase dance they forced on `getBackingStore`. IE9 cannot
  load an ES2022 package; this was about fifty lines and a branch on every get and set, kept for a
  browser that cannot run the library.
- **A concatenated array per instance.** Both passes over an entity's properties called
  `getProperties()`, which returns `dataProperties.concat(navigationProperties)` - a fresh array
  each time, twice per entity created. They now walk the two arrays directly.
- **Two bound functions per access.** `wrapPropDescription` - the path for a custom constructor
  that defines its own accessors - used `descr.get.bind(this)()`; it uses `.call` now.

What deliberately stayed: the accessor closure allocated per set. `(property, newValue,
rawAccessorFn)` is the interceptor contract and `MetadataStore.trackUnmappedType` lets an
application supply its own interceptor, so the contract is worth more than the ~2%.

**Measured effect:** creating a detached entity went from 1.70 to 1.45 µs (median of four
alternating runs in fresh processes) - about 14% off that path, and about 2% of a full
`em.createEntity`. Property get and set are unchanged within run-to-run noise. That is the
expected result, not a disappointment: the file was never where the time went.

**Where the time actually goes**, for anyone who comes looking: attaching an entity to an
`EntityManager` costs ~11 µs against ~2 µs to build it, and `validateOnAttach` is 38% of that;
96% of a property set is change tracking, 63% of it validation. The new
[Performance](./docs/guide/performance.md) guide page documents this, with the two validation
options as the levers that actually matter.

Verified: typecheck clean, unit 328, integration 450 + 7 skipped, browser 727 + 7 skipped.

## Lazy relation arrays

A collection navigation - `order.orderDetails` - is now an empty relation array only once
something reads it. An array plus its `arrayChanged` event is about 400 bytes, and most
collections on most entities are never touched.

Measured over 50,000 attached entities, each type in its own process:

| type | collection navigations | eager | lazy |
|---|---|---|---|
| `Order` | 1 | 3,285 B | 2,909 B |
| `Customer` | 1 | 3,590 B | 3,190 B |
| `Employee` | 3 | 5,822 B | **3,927 B** |

Building a detached entity went from 1.74 to 1.18 µs. Attaching one is unchanged at ~10.5 µs,
which is the expected result: that cost is validation and manager bookkeeping, not collections.

**The design.** Collection navigations get a property descriptor of their own, so the accessor
that every *data* property uses is untouched and stays hot. The array is built on first read and
kept, so identity is stable afterwards. Assigning to a collection navigation throws exactly as
before ("Nonscalar navigation properties are readonly").

**The hard part was everything that assumed the array was always there.** Four places read a
collection for no reason other than that it existed, and each would have materialised every
collection of every entity, defeating the change entirely:

- `attachRelatedEntities` - cascades an attach to related entities.
- `removeFromRelationsCore` - unhooks relationships on delete or detach.
- `validateTarget` - reads every property's value *before* asking whether it has any validators,
  and `validateOnAttach` is on by default.
- the interceptor's key-propagation branch - walks every navigation on any key change, including
  the temporary key generated for every entity created.

All four now peek: they ask for the stored value and treat "not created" as "empty", which it is.
Peeking goes through a new optional `peekProperty` on the `ModelLibraryAdapter` interface, with a
fallback to `getProperty` - so a model library that does not implement it behaves exactly as
before, creating the arrays as it always did.

Only two of those four were predicted. The other two were found by trapping writes to the backing
store slot and reading the stack, after two wrong guesses - worth remembering as the cheaper
technique next time.

One self-inflicted bug is worth recording: `startTracking` read each property through
`entity[propName]`, an accessor read, which for a collection navigation *created* the array it was
supposed to leave lazy, so the "did the constructor assign this?" guard threw. 160 tests failed at
once. It reads the stored value now, which is equivalent for every other property because
constructor-assigned values have already been moved into the backing store.

`test/unit/lazy-relation-arrays.spec.ts` covers both halves: that laziness holds (not created
until read, identity stable, attach/delete/detach/export do not force it) and that nothing
downstream noticed (inverse fixup, `arrayChanged`, assignment still throwing, cascade on attach,
clearing on delete, and a query filling only the collections its payload carries).

Verified: typecheck clean, unit 340, integration 450 + 7 skipped, browser 739 + 7 skipped, docs
build with no dead links and zero TypeDoc warnings.

## No eval, and no `noEval`

Breeze contained exactly one piece of dynamic code, and a flag to switch it off.

`createEmptyCtor` built the constructor for a type that has no registered one:

```ts
return Function('return function ' + name + '(){}')();
```

The string was the point - a constructor built that way carries the entity's name, which is what
a debugger shows. `BreezeConfig`'s constructor probed for the ability at startup by calling
`Function('')` inside a try/catch, stored the answer in `config.noEval`, and
`configureBreeze({ noEval: true })` could force the safe path, which returned an anonymous
function instead.

So the whole mechanism - two code paths, a config flag, a `configureBreeze` option, a startup
probe and five documentation mentions - bought a label in a debugger, and cost more than it
looks: the probe runs on *every* import in every environment, and under a strict Content Security
Policy a caught failure is still a **reported** violation. An application with CSP reporting saw
one at startup from a library that never needed to evaluate a string.

`Function.prototype.name` is configurable, so the name can simply be set:

```ts
const ctor = function () { };
Object.defineProperty(ctor, 'name', { value: type.name.replace(/W/g, '_'), configurable: true });
```

Verified at runtime, not just by inspection: entity type `Order:#Foo` still produces a constructor
named `Order__Foo`, exactly as the string-built one did.

`config.noEval` and the `noEval` option are **removed** rather than left inert - there is nothing
left for them to switch. That is a breaking change and UPGRADE.md carries an entry for it;
`configureBreeze({ noEval: true })` is now `TS2353`, and `config.noEval` is `undefined`. `src`
contains no `eval` and no `Function` built from a string, so Breeze runs under a policy without
`'unsafe-eval'` and reports nothing.

Verified: typecheck clean, unit 340, integration 450 + 7 skipped, browser 739 + 7 skipped, docs
build with no dead links and zero TypeDoc warnings, and against the packed package a consumer
compiles valid `configureBreeze` usage while `noEval` is rejected.

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

`src/adapters/http.ts` is now the one implementation of an HTTP request. `toFetchArgs` turns
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

### The package is staged in `dist/`, and `dist/` is the package root

`npm run build` now also runs `scripts/prepare-dist.mjs`, which writes `dist/package.json`
and copies `README.md` and `LICENSE` in. So `dist/` is a complete package:

```bash
npm run pack          # build, then npm pack ./dist -> breeze-client-3.0.0.tgz

# in another repo, to try it without publishing:
npm install /github/Breeze/breeze-client-v3/breeze-client-3.0.0.tgz
```

**`npm pack dist` does not do this.** npm reads a bare argument as a package spec, so it
downloads the package *named* `dist` from the registry and writes `dist-0.1.2.tgz`. It needs
the `./`: `npm pack ./dist`. That is what `npm run pack` does.

The published manifest is derived from the root `package.json` rather than kept as a second
file, because the exports map has nine entries and is the thing most likely to drift. Every
path loses its `./dist/` prefix — `"./dist/breeze.js"` becomes `"./breeze.js"` — and
`prepare-dist` throws if a path is not under `dist/`, since such a path could not be
published from there.

Three fields are deliberately dropped:

| | |
|---|---|
| `files` | it lists `dist`, which from inside `dist` means `dist/dist`. The tarball would contain only the README and LICENSE |
| `scripts` | meaningless in a published package, and a stray lifecycle script would run on every install |
| `devDependencies` | not needed to consume the package |

Two fields are added, for tooling that does not read `exports`: `main` and `types`, both
pointing at `breeze.js` / `breeze.d.ts`.

Verified by installing the tarball into a fresh app: the runtime works through both the root
and a subpath, and a consumer compiles against the shipped `.d.ts` under `NodeNext` with
`strict` and **`skipLibCheck: false`** — which type-checks the declarations themselves — with
no errors. `moduleResolution: "bundler"` is clean too.

**`moduleResolution: "node10"` resolves the root import but not the subpaths.** The `types`
field is what makes the root work; node10 predates `exports` and cannot follow
`breeze-client/adapter-ajax-fetch` to `adapters/adapter-ajax-fetch.d.ts`. Supporting it would
mean shipping stub `.js` and `.d.ts` pairs at the package root for all seven subpaths, which
bypasses the exports map. Not done: the package is ESM-only and declares `node >= 20`, so a
node10 consumer has bigger problems. An `index.d.ts` would not help — `types` already covers
the only case node10 can resolve.

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
