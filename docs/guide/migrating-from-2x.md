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

### CSDL / EDMX metadata is no longer parsed

`MetadataStore.importMetadata()` used to detect a `schema` property and parse CSDL — the
OData / EDMX metadata format. That is gone, along with `DataType.fromEdmDataType`.
Passing CSDL to `importMetadata()` now throws a clear error rather than silently importing
nothing.

This matters if you fetch metadata from an **OData `$metadata` endpoint** or an older
Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata and
are unaffected. If you need CSDL, stay on 2.x, or export your metadata to Breeze JSON once
and check it in.

### Angular

There is no `adapter-ajax-httpclient` in the v3 package. A separate
`breeze-client-angular` is planned. In the meantime you can wrap `HttpClient` yourself —
see [Supplying your own transport](/server/transport).

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
`EntityManager` — see [Default adapters](/guide/configuration#default-adapters).

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

## 8. Types are stricter

v3 builds under `strictNullChecks` and `noImplicitAny`. Two declarations changed in ways
you may notice:

- `Entity.getProperty` and `Entity.setProperty` are **no longer optional**. They never
  were in practice — the model library adapter installs them on every entity — and
  marking them optional forced needless null checks on callers.
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

## What has not changed

The rest of the API is intended to be source-compatible. `EntityManager`, `EntityQuery`,
`Predicate`, `MetadataStore`, `EntityType`, `EntityAspect`, `Validator`, `DataType`, the
`BreezeEnum` types, save and query options, and the event model all keep their names,
shapes and semantics.

If you hit a difference not listed here, it is a bug — please
[file an issue](https://github.com/Breeze/breeze-client-v3/issues).

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
- **Calling `enableSaveQueuing` twice hung `saveChanges`**, including turning it off with
  `enableSaveQueuing(em, false)`. It looked up a misspelled property, so each call wrapped
  `saveChanges` again.
- **`removeValidationError(validator)` removed nothing.** It now removes every error that
  validator produced on the entity.
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
