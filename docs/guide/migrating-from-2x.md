# Migrating from 2.x

Most applications need only a handful of changes. This page lists all of them.

The canonical version of this list lives in
[UPGRADE.md](https://github.com/Breeze/breeze-client-v3/blob/master/UPGRADE.md) in the
repository, and is kept in step with the code.

## 1. Install

```bash
npm install breeze-client   # 3.0.0
```

One package, one tag. 2.x published the same package under `latest`, `mjs`, `cjs` and
`umd`. If your `package.json` says `"breeze-client": "cjs"`, change it to `"^3.0.0"`.

**ESM only.** `require('breeze-client')` no longer works, there is no UMD bundle, and the
`<script src="breeze.debug.js">` + global `breeze` style of deployment is gone. Use a
bundler, or an import map. Node 20 or later.

Subpath imports are spelled the same as before:

```ts
import { EntityManager } from 'breeze-client';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
```

## 2. Removed: Knockout, jQuery, AngularJS, OData

| Removed | What to do |
|---|---|
| `adapter-model-library-ko` | Move models to the backing-store adapter (the default), or stay on 2.x |
| `adapter-ajax-jquery` | Remove it — Breeze 3 calls `fetch` directly |
| `adapter-ajax-angularjs` | AngularJS reached end of life in 2022. Stay on 2.x |
| `adapter-data-service-odata` | Stay on 2.x — Breeze's JSON query format is the supported path |
| `adapter-uri-builder-odata` | Use `adapter-uri-builder-json` with a Breeze .NET server |

### Entities always have plain properties

The model library used to decide the shape of an entity. With Knockout gone there is only the
backing store, so a property is just a property:

```ts
order.freight;           // 2.x with Knockout: order.freight()
order.freight = 12.5;    // 2.x with Knockout: order.freight(12.5)
```

`getProperty` and `setProperty` still work, on entities and complex objects alike. To drive a UI,
bind to the plain values and use the events in
[Change tracking](/guide/change-tracking) to find out when they change.

### What else went with OData

- **`Predicate.toODataFragment` is gone.** It was never a core method: the OData URI builder
  added it to `Predicate.prototype` when you imported that adapter. Use `toJSON()`.
- **Requests no longer carry `$filter`, `$orderby`, `$select` or `$expand`.** The JSON URI builder is the
  only one left, so if you inspect network traffic, expect Breeze's JSON query format. A server
  that understands only OData query syntax is not supported — stay on 2.x for those.

### CSDL / EDMX metadata is no longer parsed

`MetadataStore.importMetadata()` used to detect a `schema` property and parse CSDL — the
OData / EDMX metadata format. That is gone, along with `DataType.fromEdmDataType`.
Passing CSDL to `importMetadata()` now throws a clear error rather than silently importing
nothing.

This matters if you fetch metadata from an **OData `$metadata` endpoint** or an older
Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata and
are unaffected.

An object with a `schema` property and no `structuralTypes` makes `importMetadata()` throw *This
looks like CSDL (OData / EDMX) metadata, which breeze-client 3 does not read*, prefixed by
*Unable to either parse or import metadata*. So pointing Breeze 3 at such a server fails on the
first metadata fetch with that message rather than importing nothing.

If your metadata is CSDL: move the server to Breeze .NET Core, which emits native JSON. Or, while
still on 2.x, load the CSDL once, call `exportMetadata()`, and check the resulting JSON in —
Breeze 3 can [import that file](/metadata/by-hand#loading-metadata-from-a-json-file).

### The Breeze Labs Metadata-Helper is gone

The 2.x docs used `breeze.metadata-helper.js` for hand-written metadata, with abbreviated
attribute names (`type`, `max`, `fk`) and convention-based defaults. There is no v3 version. The
native API is nearly as short — it takes property maps, qualifies navigation type names for you
and has sensible defaults. See [Writing metadata by hand](/metadata/by-hand).

### Angular

There is no `adapter-ajax-httpclient` in the v3 package. A separate
`breeze-client-angular` is planned. Nothing is needed in the meantime: Breeze 3 works in an
Angular application as it is. [Angular](/guide/angular) covers setting it up, change
detection, auth headers, and routing requests through `HttpClient` if you want that.

## 3. Importing an adapter no longer registers it

```ts
// 2.x: the import alone registered the adapter
import 'breeze-client/adapter-data-service-webapi';
```

v3 modules do not touch global state on import. For the standard adapters this does not
matter, because they need no registration at all. With nothing registered, Breeze uses
`DataServiceWebApiAdapter`, `UriBuilderJsonAdapter` and `ModelLibraryBackingStoreAdapter`,
and sends requests through `fetch`. You can delete the side-effect imports.

2.x startup code that then initialized those adapters by name keeps working, even though
nothing registered them:

```ts
config.initializeAdapterInstance('modelLibrary', 'backingStore', true);
config.initializeAdapterInstance('uriBuilder', 'json', true);
config.initializeAdapterInstance('dataService', 'webApi', true);
config.initializeAdapterInstance('ajax', 'fetch', true);
```

The names `'backingStore'`, `'json'`, `'webApi'` and `'fetch'` resolve to the defaults;
`'fetch'` gives an ajax adapter that sends requests through `config.fetch`. A name that is
neither registered nor a default still throws `Unregistered adapter`.

A custom adapter still has to be registered, by your own code or with
`configureBreeze({ dataService: MyAdapter })`. Do it at startup, before you create an
`EntityManager` — see [Default adapters](/guide/configuration#adapters-and-transport).

## 4. You no longer need an ajax adapter

Breeze 3 makes every request through a `fetch` function — `globalThis.fetch` unless you
supply your own — so a normal setup has no ajax adapter:

```ts
configureBreeze({ fetch: myFetch });   // optional: auth headers, retry, logging
```

You don't have to change anything. `AjaxFetchAdapter`, `configureBreeze({ ajax })`,
`config.initializeAdapterInstance('ajax', 'fetch')` and the adapter's `defaultSettings`
and `requestInterceptor` all still work, and a registered ajax adapter is used in
preference to `config.fetch`. They are deprecated: move to a `fetch` function when
convenient — see [Supplying your own transport](/server/transport).

A custom ajax adapter still works the same way. So does a data service adapter that calls
`this.ajaxImpl.ajax(...)` directly; `_ajax()` is the promise-based alternative.

`AbstractDataServiceAdapter` is promise-based: `fetchMetadata`, `executeQuery` and `saveChanges`
are `async` and return native promises, sharing one `_ajax` helper. A 2.x subclass that overrode
only `_prepareSaveBundle`, `_prepareSaveResult` and `jsonResultsAdapter` works unchanged. An
override that returned a Q promise must return a native one.

A side effect: registration order no longer matters. In 2.x the data service adapter
needed the ajax adapter registered first, and threw
`Unable to find ajax adapter for dataservice adapter 'webApi'` otherwise.

## 5. Class constructors require `new`

```ts
Predicate('CompanyName', 'StartsWith', 'B');       // 2.x: worked. v3: throws.
new Predicate('CompanyName', 'StartsWith', 'B');   // works
Predicate.create('CompanyName', 'startsWith', 'B') // works, preferred
```

v3 ships real ES2022 classes, and a class constructor cannot be invoked as a plain
function. In 2.x this appeared to work only because the *test harness* compiled the
library down to ES5; anyone consuming the `mjs` build was already affected.

Fix by adding `new`, or using the static factory where one exists.

## 6. The default naming convention is now `camelCase`

**Breaking change.** In 2.x the default was `NamingConvention.none`: client property names
were the server's names unless you set a convention. Breeze 3 defaults to
`NamingConvention.camelCase`, which suits a Breeze .NET server: `CompanyName` on the server
is `companyName` on the client. A `MetadataStore` takes the default when it is created, so
every store, and every `EntityManager` that creates its own, uses camelCase unless told
otherwise. With the default adapters, a Breeze .NET server needs no configuration at all:

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/Northwind');
```

- **If you already set camelCase**, nothing changes. `NamingConvention.camelCase.setAsDefault()`
  or `configureBreeze({ namingConvention: NamingConvention.camelCase })` is now redundant
  but harmless; you can delete it.
- **If you relied on `none`** — your server already sends the property names the client
  should use, as a Node/Sequelize-style server does, or its metadata names are already
  camelCase — set it explicitly at startup, before you create any `MetadataStore` or
  `EntityManager`:

  ```ts
  import { configureBreeze, NamingConvention } from 'breeze-client';

  configureBreeze({ namingConvention: NamingConvention.none });
  // or: NamingConvention.none.setAsDefault();
  ```

  Without it, PascalCase server names reach your code camel-cased, so code that reads
  `CompanyName` finds nothing. Server names that are already camelCase do not round-trip
  (`camelCase` turns `companyName` back into `CompanyName`), so metadata either fails to
  load with a `does not roundtrip properly` error, or Breeze sends the server upper-cased
  names.

Metadata that names a naming convention still sets it when imported into an empty store,
so a store loaded from an `exportMetadata()` file keeps the convention it was exported
with. `NamingConvention.none` appears there as `'noChange'`. See
[Naming conventions](/server/namingconvention).

`configureBreeze` takes `namingConvention` directly. There is no `breeze.` global, and no
`NamingConvention.instance` — the current default is `NamingConvention.defaultInstance`.

## 7. Typed configuration (optional, recommended)

For the standard adapters you need neither form: they are the defaults. When you do
register an adapter of your own, `configureBreeze` replaces the stringly-typed pairs:

```ts
// still works, now deprecated
config.registerAdapter('dataService', MyWebApiAdapter);
config.initializeAdapterInstance('dataService', 'myWebApi', true);

// preferred
configureBreeze({ dataService: MyWebApiAdapter });
```

Misspell an adapter name in the old form and you get a runtime error; in the new form it
does not compile. The old API is not scheduled for removal. `configureBreeze` itself is
optional: use it for a custom adapter, a custom `fetch`, or the naming convention.

If you call `config.initializeAdapterInstances` from TypeScript, you can drop any cast:
its argument is now typed as adapter names, `{ ajax: 'fetch', dataService: 'webApi' }`.

### `noEval` is removed, and Breeze no longer evaluates strings

`config.noEval` and `configureBreeze({ noEval })` are gone. Remove them — passing `noEval` to
`configureBreeze` is a compile error, and `config.noEval` reads as `undefined`.

Nothing replaces them, because there is nothing left to switch off. The flag existed because 2.x
built entity constructors from strings, `Function('return function Order(){}')()`, so a type had
a readable name in a debugger — and probed for that ability at startup with `Function('')` inside
a `try`, which a strict Content Security Policy reports as a violation even though the failure
was caught.

Constructors are now named with `Object.defineProperty`, which gives the same result with no
dynamic code. Breeze contains no `eval` and no `new Function`, so it runs under a policy without
`'unsafe-eval'` and reports nothing at startup.

## 8. Types are stricter

v3 builds under `strictNullChecks` and `noImplicitAny`. Two declarations changed in ways
you may notice:

- `getProperty` and `setProperty` are **no longer optional**, on `Entity` or on
  `ComplexObject`. They never were in practice — the model library adapter installs them on
  every entity — and marking them optional forced needless null checks on callers. Drop the `!`
  or `?.` you may have needed. A class that `implements Entity` now has to list them, with
  `declare` so the field does not shadow what Breeze installs — see
  [Class fields and `declare`](/guide/extending-entities#class-fields-and-declare).
- `EntityQuery.wherePredicate`, `EntityAspect.hasTempKey` and
  `ValidationError.propertyName` are now optional, which is what they always were at
  runtime.

These are type-only changes; nothing behaves differently.

## 9. The callback arguments are deprecated

The async methods have always taken an optional success and failure callback alongside the
promise they return. That pair is now deprecated on `EntityManager.executeQuery`,
`saveChanges` and `fetchMetadata`, `EntityQuery.execute`,
`EntityAspect.loadNavigationProperty`, `MetadataStore.fetchMetadata` and a relation array's
`load`.

Nothing has stopped working, and none of these calls change behaviour. Your editor will
strike the call through, and the callbacks will be removed in a future major version:

```ts
// deprecated
em.executeQuery(query, data => render(data.results), err => show(err));

// supported
try {
  const data = await em.executeQuery(query);
  render(data.results);
} catch (err) {
  show(err);
}
```

The promise form is the only one that was ever fully supported: the save-queuing mixin, for
instance, has always ignored the callback arguments.

The callback types — `Callback`, `ErrorCallback`, `QuerySuccessCallback` and
`QueryErrorCallback` — are deprecated along with them.

## 10. Promises are native

Every async method returns a native `Promise`. Use `await`, or `.then`/`.catch`. The Q idiom
that 2.x code often used does not exist:

```ts
em.saveChanges().fail(handler);    // 2.x with Q — TypeError in v3
em.saveChanges().catch(handler);   // v3
```

Nothing else in the query or save contract changed.

## 11. Save errors arrive as a problem details document

A Breeze .NET server now returns [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
`application/problem+json`, with `type`, `title`, `status` and `detail`. Before 3.0 it sent
`{ Code, Message, StackTrace, EntityErrors }` with no content type of its own, always included
the stack trace, and set `Code` to `0` for anything that was not an `EntityErrorsException`.

**A client needs no changes.** Breeze reads either spelling, `e.message` comes from `detail`
falling back to `title`, and the capitalised members are still sent by default so an application
on an older client reads the error unchanged. It matters only if you parse the response yourself.
See [Error handling](/guide/error-handling#what-the-server-sends).

## What has not changed

The rest of the API is intended to be source-compatible. `EntityManager`, `EntityQuery`,
`Predicate`, `MetadataStore`, `EntityType`, `EntityAspect`, `Validator`, `DataType`, the
`BreezeEnum` types, save and query options, and the event model all keep their names,
shapes and semantics.

If you hit a difference not listed here, it is a bug — please
[file an issue](https://github.com/Breeze/breeze-client-v3/issues).

## Still there, just not in the API reference

The reference documents the surface an application uses. Two dozen exported names carry
`@hidden`, which keeps a declaration out of the reference but not out of the package: they are
in the published `.d.ts`, they compile, and they run. **Every one of them was `@hidden` in 2.x
too** — nothing was hidden in 3.0. They are listed here because the natural way to check whether
something survived the upgrade is to search the reference for it, and these are the names that
are present but will not be found.

For writing an adapter — you need these only if you implement one:

| For | Names |
|---|---|
| a `DataServiceAdapter` | `AbstractDataServiceAdapter`, `MappingContext`, `SaveContext`, `SaveBundle` |
| a `UriBuilderAdapter` | `OrderByClause`, `SelectClause`, `ExpandClause` |
| a `ModelLibraryAdapter` | `makeRelationArray`, `makePrimitiveArray`, `makeComplexArray` |
| registering either | `AdapterCtor`, `AdapterRegistration` |

For walking a predicate with `Predicate.visit`: the tree nodes `UnaryPredicate`,
`BinaryPredicate`, `AndOrPredicate`, `AnyAllPredicate`, `LitExpr`, `FnExpr` and `PropExpr`, and
the `Visitor`, `VisitContext` and `ExpressionContext` types a visitor is written against.

### `assertParam` and `assertConfig` went the other way

They are *more* available than in 2.x, not less. 2.x marked them `@hidden @internal`, and
`@internal` strips a declaration from the published `.d.ts` — so although the runtime export was
there, TypeScript could not see it. In 3.0 they are `@hidden` only: still out of the reference,
but exported by name from `breeze-client` and typed. `Param` itself stays off the barrel; reach
it as `breeze.Param`, which is typed, or let `assertParam` build one.

### Five `core` members that exist only at runtime

`assert-param.ts`, `config.ts` and `event.ts` each assign a member onto `core` at import time,
for 2.x code that reached them through the `breeze.core` global. They are not on the `core`
type, in 3.0 or in 2.x, so TypeScript rejects all five even though the call works. Use the real
export instead:

| At runtime only | Use instead |
|---|---|
| `core.assertParam`, `core.assertConfig` | the exports of the same name |
| `core.Param` | `breeze.Param` |
| `core.config` | the exported `config` |
| `core.Event` | the exported `BreezeEvent` |

Two more pieces of 2.x scaffolding are still in place: `window.breeze`, set when the module runs
unbundled, and the empty `promises.IPromiseService` that `breeze-bridge2-angular` imports.

One caveat carried over from 2.x unchanged: `breeze.assertParam` and `breeze.assertConfig` are
`null`, not functions — the lines that would have assigned them are commented out in both
versions. Call `assertParam` directly. `breeze.version` is likewise still the 2.x string.


## Fixed along the way

Long-standing defects, all present in 2.x:

- **`JsonResultsAdapter` lost its type brand.** It declared `_$typeName` without
  TypeScript's `declare` modifier, so under ES2022 class-field semantics the constructor
  overwrote the prototype value with `undefined`, and
  `EntityQuery.using(myJsonResultsAdapter)` failed to recognise its argument.
- **The fetch adapter set `referrer: 'client'`**, which is the browser default and
  redundant there, but which Node's `fetch` rejects outright — making Breeze unusable
  with the fetch adapter under Node.
- **`config.initializeAdapterInstances` always threw.** It validated its argument, copied
  it onto the global `config`, and then iterated every property of `config` rather than of
  the argument — passing values such as `functionRegistry` to `initializeAdapterInstance`
  as adapter names. Nothing tested it. It now initializes exactly the adapters named, in
  dependency order, and leaves `config` alone.
- **More types are exported.** The config objects public constructors take
  (`EntityTypeConfig`, `QueryOptionsConfig`, `SaveOptionsConfig`, …), event args,
  callbacks, `SaveError`, `ImportResult` and the types adapter authors implement against
  were used in public signatures but could not be imported by name. They can now. Type-only;
  nothing changes at runtime.
- **The fetch adapter could leave a query pending for ever.** A 200 response whose body
  was not JSON (an HTML login page from a proxy, say) failed inside the adapter without
  reaching either callback. Every path now settles, and an unreadable body reports the
  real HTTP status. A throw inside a data service adapter callback now rejects the
  promise too.
- **Calling [`enableSaveQueuing`](/guide/extensions#save-queuing) twice hung `saveChanges`**, including turning it off with
  `enableSaveQueuing(em, false)`. It looked up a misspelled property, so each call wrapped
  `saveChanges` again.
- **Save queuing sent temporary keys to the server.** With the [save-queuing mixin](/guide/extensions#save-queuing), a foreign
  key set while its parent row was still being inserted kept its temporary (negative) value in
  the follow-up save, because the fixup compared the type that *declares* the foreign key
  instead of the type it points at. Only a self-referencing key ever matched. Against SQL
  Server the queued save failed with a foreign key constraint violation.
- **`removeValidationError(validator)` removed nothing.** It now removes every error that
  validator produced on the entity.
- **An entity whose key was the string `__proto__` could not be found again.** The cache's
  key index was a plain object, so writing that one key ran `Object.prototype`'s inherited
  setter and stored nothing: the entity was attached, `getEntityByKey` returned `null`, a
  re-query added a second copy, and detaching it threw *internal error - entity cannot be
  found in group*.
- **Working with many changed entities at once is no longer quadratic.** `acceptChanges`,
  `rejectChanges` and `detachEntity` each asked the manager to work out afresh whether
  anything was still dirty, which meant walking the whole cache — once per entity. Over
  40,000 entities `acceptChanges` took 8.5 seconds; it takes 33 ms. [`getEntityGraph`](/guide/extensions#entity-graphs) with a
  two-level expand was the same shape: 5.1 seconds over 8,000 orders and their 24,000
  details, now 10 ms. See [Performance](/guide/performance#cache-operations-scale-with-what-you-touch-not-with-what-is-cached).
- **`BreezeEvent.isEnabled` ignored its object argument**, and
  **`EntityState.isDeletedOrDetached()` returned false for `Deleted`.**
- **Local projections named nested paths differently from the server.** Only the first
  dot was replaced, and the client names were used: `order.customer.companyName` came back
  as `order_customer.companyName`. A local projection now uses the name the server gives
  the path, passed through the naming convention, so it matches a remote one:
  `order_Customer_CompanyName` with camelCase. See
  [Projections](/query/projections#related-property-projections).
- **A string assigned to a `DateOnly` property stayed a string.** It is now parsed as a
  local date.
- **`config.getAdapterInstance` was missing from the published type declarations.** It was
  tagged `@internal` and the build strips internal members, so TypeScript code calling it
  needed a cast. It is now public.

### Fixes that change what your code sees

These correct long-standing defects, but code that worked around them, or relied on them,
may notice.

**Queries**

- **Local `substring` takes a length**, as the server does: `substring(s, start, length)`.
  It used JavaScript's `substring(start, end)`, so a cache query could return different
  rows from the same query on the server.
- **`{ value, isLiteral: false }` in a where clause** now makes the value a property
  expression, as documented. It was ignored.
- **`withParameters` values are sent once**, as plain query-string arguments — the copy the
  .NET server reads. They used to be sent inside the JSON query as well; a query with only
  parameters now requests `Resource?name=value` with no JSON.
- **Untyped results fall back to the resource's entity type.** When a query's resource maps
  to an entity type, result nodes the JSON results adapter cannot type (no `$type`) now
  become entities of that type instead of plain objects. The fallback was computed and then
  dropped. Typed nodes, projections and `toType()` queries are unaffected.
- **`FilterQueryOp.IsTypeOf` is removed.** The server has no such operator, so it could
  never work; code that referenced it now fails to compile instead of throwing at runtime.
- `EntityQuery.toJSON()` now includes `usePost`.

**`breeze.core` utilities**

- **Five `core` helpers are removed**, all written for a JavaScript that no longer needs them
  and none of them used by Breeze itself any more. If you call one, the replacement is a
  built-in:

  | Removed | Instead |
  |---|---|
  | `core.requireLib` | Nothing. It found jQuery, Knockout or the OData client through browser globals or AMD `require`, and all four are gone from v3. Use an `import`. |
  | `core.isES5Supported` | Nothing — it always answered `true`. |
  | `core.isNumeric(n)` | `Number.isFinite(Number(n))` |
  | `core.titleCase(s)` | Your own, or a library — it was one regex. |
  | `core.getArray(obj, name)` | `core.getMapArray(map, key)`, or `obj[name] ??= []` |

- **Six `core` helpers are deprecated**, because the language now has each of them. They still
  work, and an editor will strike them through:

  | Deprecated | Instead |
  |---|---|
  | `core.hasOwnProperty(obj, key)` | `Object.hasOwn(obj, key)` |
  | `core.arraySlice(arr, start, end)` | `arr.slice(start, end)` |
  | `core.arrayFlatMap(arr, fn)` | `arr.flatMap(fn)` |
  | `core.getUuid()` | `crypto.randomUUID()` |
  | `core.stringStartsWith(s, prefix)` | `s.startsWith(prefix)` |
  | `core.stringEndsWith(s, suffix)` | `s.endsWith(suffix)` |

  Each now calls the built-in, so behaviour is unchanged and two of them are faster —
  `endsWith` by 2.3x, `getUuid` by about 30x, which is worth a few percent of creating an
  entity with a Guid key. `crypto.randomUUID()` is also a cryptographic source where the old
  implementation used `Math.random()`.

  Two things to know before you switch:

  - **The string helpers are null-tolerant and the built-ins are not.**
    `core.stringStartsWith(null, "a")` is `false`, where `null.startsWith("a")` throws; and
    `core.stringStartsWith("abc", null)` is `true`, where the built-in looks for the text
    `"null"`. Guard the null yourself.
  - **`crypto.randomUUID()` needs a secure context in a browser** — it is unavailable over
    plain HTTP. `core.getUuid()` falls back to the old implementation there, so if you serve
    over HTTP, keep using it or supply your own fallback.

  An `Object.create` polyfill went with the five removals, so importing Breeze no longer writes
  to a global. Everything else `core` exposes is unchanged.

**Metadata and data types**

- **More server type names are understood.** `TimeSpan` maps to `DataType.Time`, `TimeOnly`
  to the new `DataType.TimeOnly` (a `"HH:mm:ss"` string), `Char` to `String`, and `SByte`
  and the unsigned integers to the next wider integer type. They all used to become
  `String` silently. A name the client still does not know imports as `DataType.Undefined`,
  with the original in `rawTypeName`, and logs a warning.
- **`DateOnly`** has the date validator, and sorts correctly across the year 2000.
- **Comparison options you choose win.** `localQueryComparisonOptions` named in imported
  metadata no longer override options passed to the `MetadataStore` or set with
  `setAsDefault()`. `LocalQueryComparisonOptions` no longer requires
  `usesSql92CompliantStringComparison` (default `true`).
- **`new EntityManager({ serviceName, metadataStore })` uses the store's `DataService`** for
  that service, with its `hasServerMetadata` and adapters, instead of building a new one.
- `importMetadata` for a new type with no `dataProperties` throws a clear error instead of
  a `TypeError`.

**Validation**

- **An error you add with `addValidationError` now stops a save.** `validateEntity()` returned
  `true` while one stood, and `saveChanges` sent the entity anyway; `validateProperty()` ignored one
  about its property. All three now treat it as an error until you remove it. Errors from the
  server still do not stop a save — every save clears them first. If you added errors as
  *warnings* that were not meant to block, remove them before saving, or keep warnings somewhere
  other than the entity's validation errors. See
  [Which errors stop a save](/guide/validation#which-errors-stop-a-save).
- **A save stopped by an added error beside an ordinary validation failure threw a `TypeError`**
  — `Cannot read properties of undefined (reading 'name')` — in place of the validation error and
  its `entityErrors`. It now rejects properly, naming the added error by its key in `errorName`.
- **A server validation error goes when the property it is about is edited**, instead of staying
  until the next save.
- `getValidationErrors('someProperty')` includes an error added with only a `propertyName` in its
  context, which it used to leave out.

**Errors and adapters**

- **A failed request's `ServerError` now carries `statusText`, `body` and `url`**, which
  it always declared. A status-0 failure's message now says the server may not be running,
  and keeps the underlying message.
- A save whose response has no body rejects with a clear error instead of a `TypeError`.
- A failed query no longer *also* raises an unhandled promise rejection.
- `ChangeRequestInterceptor.oneTime` is honoured.
- The `interfaceInitialized` event reports the real `isDefault`.

**Types**

- `EntityManagerConfig.keyGenerator` is removed. It was always rejected at runtime; use
  `keyGeneratorCtor`.
- `setProperty` is typed to return a value, so chaining compiles.
- `JsonResultsAdapterConfig.visitNode` is required in the type, as it always was at runtime.
- Published for adapter authors: the static `AbstractDataServiceAdapter.makeHttpError` and
  the protected `_createChangeRequestInterceptor`.
- `DataService.useJsonp` is deprecated. It has no effect on Breeze’s own transport, which has no JSONP support; a registered (deprecated) ajax adapter can still act on it.
