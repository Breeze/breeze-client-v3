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
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
```

## 2. Removed: Knockout, jQuery, AngularJS, OData

| Removed | What to do |
|---|---|
| `adapter-model-library-ko` | Move models to the backing-store adapter (the default), or stay on 2.x |
| `adapter-ajax-jquery` | Use `adapter-ajax-fetch` |
| `adapter-ajax-angularjs` | AngularJS reached end of life in 2022. Stay on 2.x |
| `adapter-data-service-odata` | Stay on 2.x — Breeze's JSON query format is the supported path |
| `adapter-uri-builder-odata` | Use `adapter-uri-builder-json` with a Breeze .NET server |

### CSDL / EDMX metadata is no longer parsed

`MetadataStore.importMetadata()` used to detect a `schema` property and parse CSDL — the
OData / EDMX metadata format. That is gone, along with `DataType.fromEdmDataType`.

This matters if you fetch metadata from an **OData `$metadata` endpoint** or an older
Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata and
are unaffected. If you need CSDL, stay on 2.x, or export your metadata to Breeze JSON once
and check it in.

### Angular

There is no `adapter-ajax-httpclient` in the v3 package. A separate
`breeze-client-angular` is planned. In the meantime you can wrap `HttpClient` yourself —
see [Supplying your own transport](/server/transport).

## 3. Importing an adapter no longer registers it

**This is the change most likely to break your startup.**

```ts
// 2.x: the import alone registered the adapter
import 'breeze-client/adapter-ajax-fetch';
```

v3 modules do not touch global state on import. Registration is explicit:

```ts
configureBreeze({ ajax: AjaxFetchAdapter, /* ... */ });
// or
AjaxFetchAdapter.register();
```

If you relied on the side effect you will see errors like
`Unable to find ajax adapter for dataservice adapter 'webApi'`.

There is a second-order effect worth knowing. Because registration used to happen at
import time, it always happened *before* your `register()` calls — which hid ordering
bugs. The data service adapter resolves the ajax adapter when it initializes, so this now
throws:

```ts
DataServiceWebApiAdapter.register();   // resolves 'ajax' — not registered yet
AjaxFetchAdapter.register();
```

[`configureBreeze`](/guide/configuration) registers in dependency order and cannot go
wrong this way.

## 4. Class constructors require `new`

```ts
Predicate('CompanyName', 'StartsWith', 'B');       // 2.x: worked. v3: throws.
new Predicate('CompanyName', 'StartsWith', 'B');   // works
Predicate.create('CompanyName', 'startsWith', 'B') // works, preferred
```

v3 ships real ES2022 classes, and a class constructor cannot be invoked as a plain
function. In 2.x this appeared to work only because the *test harness* compiled the
library down to ES5; anyone consuming the `mjs` build was already affected.

Fix by adding `new`, or using the static factory where one exists.

## 5. Typed configuration (optional, recommended)

`configureBreeze` replaces the stringly-typed pairs:

```ts
// still works, now deprecated
config.registerAdapter('ajax', AjaxFetchAdapter);
config.initializeAdapterInstance('ajax', 'fetch', true);

// preferred
configureBreeze({ ajax: AjaxFetchAdapter, /* ... */ });
```

Misspell an adapter name in the old form and you get a runtime error; in the new form it
does not compile. The old API is not scheduled for removal.

If you call `config.initializeAdapterInstances` from TypeScript, you can drop any cast:
its argument is now typed as adapter names, `{ ajax: 'fetch', dataService: 'webApi' }`.

## 6. Types are stricter

v3 builds under `strictNullChecks` and `noImplicitAny`. Two declarations changed in ways
you may notice:

- `Entity.getProperty` and `Entity.setProperty` are **no longer optional**. They never
  were in practice — the model library adapter installs them on every entity — and
  marking them optional forced needless null checks on callers.
- `EntityQuery.wherePredicate`, `EntityAspect.hasTempKey` and
  `ValidationError.propertyName` are now optional, which is what they always were at
  runtime.

These are type-only changes; nothing behaves differently.

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
