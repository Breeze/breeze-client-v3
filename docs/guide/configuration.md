# Configuration

Breeze needs no configuration for a Breeze .NET server:

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/NorthwindIBModel');
```

Every setting has a default, listed below. Change the ones you need at startup, before you
create any `MetadataStore` or `EntityManager`: stores and managers take the defaults in
force when they are created.

## Defaults

### Adapters and transport

Breeze delegates three jobs to adapters, and makes its HTTP requests through a `fetch`
function.

| Interface | Job | Default | To replace it |
|---|---|---|---|
| `modelLibrary` | how entities track changes | `ModelLibraryBackingStoreAdapter` (`'backingStore'`) | `configureBreeze({ modelLibrary })` |
| `dataService` | how to talk to the server | `DataServiceWebApiAdapter` (`'webApi'`) | `configureBreeze({ dataService })` — see [DataServiceAdapter](/server/dataserviceadapter) |
| `uriBuilder` | how a query becomes a URL | `UriBuilderJsonAdapter` (`'json'`) | `configureBreeze({ uriBuilder })` |
| HTTP | makes the request | no ajax adapter: `config.fetch`, which defaults to `globalThis.fetch` | `configureBreeze({ fetch })` — see [Supplying your own transport](/server/transport) |

Breeze registers a default adapter the first time it needs it, and only for an interface
that nothing has been registered for. Nothing is registered when you import Breeze, and
anything you register takes precedence. A `DataService` resolves its adapters once, the
first time it is used, and keeps them.

### Global settings

| Setting | Default | To change it |
|---|---|---|
| Naming convention | `NamingConvention.camelCase`: `CompanyName` on the server is `companyName` on the client | `configureBreeze({ namingConvention })`, or `NamingConvention.none.setAsDefault()`. See [Naming conventions](#naming-conventions) |
| Local string comparison | `LocalQueryComparisonOptions.caseInsensitiveSQL`: case-insensitive, and `==` / `!=` ignore leading and trailing spaces | `new LocalQueryComparisonOptions({ ... }).setAsDefault()`. See [Querying the cache](/query/locally) |
| Query options | `fetchStrategy: FetchStrategy.FromServer`, `mergeStrategy: MergeStrategy.PreserveChanges`, `includeDeleted: false` | `new QueryOptions({ ... }).setAsDefault()`; per manager with `queryOptions`; per query with `EntityQuery.using(...)` |
| Save options | `allowConcurrentSaves: false`; saves go to `SaveChanges` on the manager's service | `new SaveOptions({ ... }).setAsDefault()`; per manager with `saveOptions`; per save as the second argument to `saveChanges` |
| Validation options | `validateOnAttach: true`, `validateOnSave: true`, `validateOnQuery: false`, `validateOnPropertyChange: true` | `new ValidationOptions({ ... }).setAsDefault()`; per manager with `validationOptions` |
| Transport | `config.fetch` is unset, so requests use `globalThis.fetch` | `configureBreeze({ fetch })`, or assign `config.fetch` |

`setAsDefault()` changes the default for everything created afterwards. It does not change
stores and managers that already exist.

### EntityManager

`new EntityManager(serviceName)`, or `new EntityManager({ ... })` with any of:

| Option | Default |
|---|---|
| `serviceName` | none |
| `dataService` | the `MetadataStore`'s `DataService` for `serviceName`, if it has one; otherwise a new `DataService` for that name |
| `metadataStore` | a new `MetadataStore`, with the default naming convention and comparison options |
| `queryOptions`, `saveOptions`, `validationOptions` | the defaults in force when the manager is created |
| `keyGeneratorCtor` | `KeyGenerator` |

### DataService

| Option | Default |
|---|---|
| `serviceName` | required |
| `hasServerMetadata` | `true`: metadata is fetched from `{serviceName}/Metadata` before the first query |
| `adapterName` | the default data service adapter (`'webApi'`) |
| `uriBuilderName` | the default URI builder (`'json'`) |
| `jsonResultsAdapter` | the data service adapter's own |
| `useJsonp` | `false`. Deprecated: no effect on Breeze’s own transport |

### MetadataStore

| Option | Default |
|---|---|
| `namingConvention` | the default naming convention when the store is created. An empty store that imports metadata naming a convention adopts that one |
| `localQueryComparisonOptions` | the default comparison options when the store is created. An empty store adopts the ones named in imported metadata, unless the store was given options of its own |

## configureBreeze

`configureBreeze` is optional. Use it to replace a default adapter, supply your own
`fetch`, or set the naming convention:

```ts
import { configureBreeze } from 'breeze-client';
import { MyWebApiAdapter } from './my-web-api-adapter';   // a subclass of DataServiceWebApiAdapter

configureBreeze({
  dataService: MyWebApiAdapter,
  fetch: authFetch,
});
```

The standard adapters are still exported, from `breeze-client/adapter-model-library-backing-store`,
`breeze-client/adapter-uri-builder-json` and `breeze-client/adapter-data-service-webapi`, so
that you can subclass them or register them explicitly. Passing one to `configureBreeze`
does no harm, but it is not needed.

### Options

| Option | Type | Notes |
|---|---|---|
| `modelLibrary` | adapter class | replaces the default, `ModelLibraryBackingStoreAdapter` |
| `uriBuilder` | adapter class | replaces the default, `UriBuilderJsonAdapter` |
| `ajax` | adapter class | deprecated — see [below](#ajax-deprecated) |
| `dataService` | adapter class | replaces the default, `DataServiceWebApiAdapter` |
| `fetch` | `BreezeFetch` | the function every HTTP request goes through; defaults to `globalThis.fetch`. See [Supplying your own transport](/server/transport) |
| `namingConvention` | `NamingConvention` | sets the default, which is initially `NamingConvention.camelCase` |
| `config` | `BreezeConfig` | target a non-global config; rarely needed |

You can call it more than once and pass only what you want to change:

```ts
configureBreeze({ namingConvention: NamingConvention.none });
```

### Registration order does not matter

Instead of passing an adapter to `configureBreeze`, you can call its static `register()`.
Adapters can be registered in any order:

```ts
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';

// Either order works. So does leaving both out: these are the defaults.
UriBuilderJsonAdapter.register();
DataServiceWebApiAdapter.register();
```

What does matter is registering before you create an `EntityManager` — see
[Default adapters](#default-adapters).

::: tip Changed in 3.0
In 2.x the data service adapter needed an ajax adapter registered before it, and threw
`Unable to find ajax adapter for dataservice adapter 'webApi'` otherwise. Breeze 3 needs
no ajax adapter, so there is nothing to get out of order.
:::

## Importing does not register

In 2.x, importing an adapter module registered it as a side effect:

```ts
// 2.x — the import alone was enough
import 'breeze-client/adapter-ajax-fetch';
```

Breeze 3 modules do not touch global state when imported. An adapter is registered only
when you pass it to `configureBreeze` or call its `register()`, or when Breeze falls back
to a default.

This makes import order irrelevant and lets bundlers reason about the package properly.
It rarely matters otherwise: the adapters 2.x registered on import are the defaults, and
need no registration at all. See [Migrating from 2.x](/guide/migrating-from-2x).

## The older API still works

```ts
config.registerAdapter('dataService', DataServiceWebApiAdapter);
config.initializeAdapterInstance('dataService', 'webApi', true);
```

`registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances` are all
still there and still work. They are marked `@deprecated` because `configureBreeze` is
better — a misspelled adapter name is a compile error rather than a runtime one — but
they are not scheduled for removal.

You don't need `registerAdapter` before initializing a default adapter by name. The names
`'backingStore'`, `'json'` and `'webApi'`, and the ajax adapter's `'fetch'`, resolve to
the defaults, so 2.x startup code that relied on the import side effect runs as-is:

```ts
config.initializeAdapterInstance('dataService', 'webApi', true);
config.initializeAdapterInstance('ajax', 'fetch', true);
// or
config.initializeAdapterInstances({ dataService: 'webApi', ajax: 'fetch' });
```

`'fetch'` gives an `AjaxFetchAdapter` that sends its requests through `config.fetch`. A
name that is neither registered nor a default still throws `Unregistered adapter`.

## Choosing adapters

### modelLibrary

`ModelLibraryBackingStoreAdapter` is the default and the only one shipped, and the right
choice for plain JavaScript and TypeScript models. The Knockout adapter was removed in 3.0.

### dataService

`DataServiceWebApiAdapter`, the default, talks to a Breeze .NET server, or anything using
the same JSON shape. To target a different backend, subclass `AbstractDataServiceAdapter`
and register it — see [DataServiceAdapter](/server/dataserviceadapter).

The OData data service adapter was removed in 3.0.

### uriBuilder

`UriBuilderJsonAdapter`, the default, encodes the query as Breeze JSON in the query string.
It is the only one shipped; the OData URI builder was removed in 3.0.

### ajax (deprecated)

Breeze 3 does not need an ajax adapter. Every request goes through `config.fetch`, which
defaults to `globalThis.fetch`. To add auth headers, retry or logging, supply your own
`fetch` — see [Supplying your own transport](/server/transport).

`AjaxFetchAdapter` and the `ajax` option are kept so that 2.x startup code keeps working.
If you register an ajax adapter, Breeze uses it instead of `config.fetch`. There is no
reason to in new code.

## Naming conventions

A `NamingConvention` translates between server and client property names. The default is
`NamingConvention.camelCase`.

- `NamingConvention.camelCase` — `CompanyName` ⟷ `companyName`. The default, and what a
  .NET server needs.
- `NamingConvention.none` — names pass through unchanged. Use it when the server already
  sends the names the client should use:

```ts
configureBreeze({ namingConvention: NamingConvention.none });
// or
NamingConvention.none.setAsDefault();
```

::: tip Changed in 3.0
2.x defaulted to `none`, so 2.x applications talking to a .NET server set `camelCase`
themselves. That call is now redundant but harmless. An application that relied on the old
default must now set `none` explicitly.
:::

Metadata that names a naming convention sets it when imported into an empty
`MetadataStore`. See [Naming conventions](/server/namingconvention) for custom conventions.

## Content Security Policy

Breeze needs no Content Security Policy exception. It never evaluates a string - no `eval`,
no `new Function` - so a policy without `'unsafe-eval'` runs it without complaint and without
CSP violation reports.

::: tip Changed in 3.0
2.x probed for `eval` support at startup and exposed a `noEval` flag, because it built entity
constructors from strings to give them a readable name. Constructors are now named with
`Object.defineProperty`, so both the probe and the flag are gone. See
[Migrating from 2.x](/guide/migrating-from-2x).
:::
