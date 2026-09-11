# Configuration

Breeze delegates three jobs to adapters, and makes its HTTP requests through a `fetch`
function. Each has a default, so you register nothing. With a Breeze .NET server, the
whole setup is the naming convention:

```ts
import { configureBreeze, EntityManager, NamingConvention } from 'breeze-client';

configureBreeze({ namingConvention: NamingConvention.camelCase });

const em = new EntityManager('/breeze/NorthwindIBModel');
```

## Default adapters

| Interface | Job | Default | To replace it |
|---|---|---|---|
| `modelLibrary` | how entities track changes | `ModelLibraryBackingStoreAdapter` (`'backingStore'`) | `configureBreeze({ modelLibrary })` |
| `dataService` | how to talk to the server | `DataServiceWebApiAdapter` (`'webApi'`) | `configureBreeze({ dataService })` — see [DataServiceAdapter](/server/dataserviceadapter) |
| `uriBuilder` | how a query becomes a URL | `UriBuilderJsonAdapter` (`'json'`) | `configureBreeze({ uriBuilder })` |
| HTTP | makes the request | no ajax adapter: `config.fetch`, which defaults to `globalThis.fetch` | `configureBreeze({ fetch })` — see [Supplying your own transport](/server/transport) |

Breeze registers a default the first time it needs it, and only for an interface that
nothing has been registered for. Nothing is registered when you import Breeze, and
anything you register takes precedence.

Register custom adapters at startup, before you create any `EntityManager`. A
`DataService` resolves its adapters once, the first time it is used, and keeps them.

## configureBreeze

`configureBreeze` is optional. Use it to replace a default adapter, supply your own
`fetch`, set the naming convention, or set `noEval`:

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';
import { MyWebApiAdapter } from './my-web-api-adapter';   // a subclass of DataServiceWebApiAdapter

configureBreeze({
  dataService: MyWebApiAdapter,
  fetch: authFetch,
  namingConvention: NamingConvention.camelCase,
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
| `namingConvention` | `NamingConvention` | sets the default, which is initially `NamingConvention.none` |
| `noEval` | `boolean` | forbid `eval`/`Function`, for strict CSP environments |
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

A `NamingConvention` translates between server and client property names.

```ts
configureBreeze({ namingConvention: NamingConvention.camelCase });
```

- `NamingConvention.camelCase` — `CompanyName` ⟷ `companyName`. Use with a .NET server.
- `NamingConvention.none` — names pass through unchanged. This is the initial default.

The naming convention is not an adapter, and its default stays `none`, so with a .NET
server set `camelCase` yourself. `NamingConvention.camelCase.setAsDefault()` does the same
as passing it to `configureBreeze`.

See [Naming conventions](/server/namingconvention) for custom conventions.

## Content Security Policy

If your CSP forbids `eval` and `new Function`:

```ts
configureBreeze({ noEval: true });
```

Breeze detects this automatically at startup by attempting a `Function('')` and catching
the failure, so you usually do not need to set it. Set it explicitly if you want to be
certain.
