# Configuration

Breeze delegates four jobs to adapters. You choose one implementation of each at startup.

| Adapter | Job | Ships with Breeze |
|---|---|---|
| `modelLibrary` | how entities track changes | `ModelLibraryBackingStoreAdapter` |
| `dataService` | how to talk to the server | `DataServiceWebApiAdapter` |
| `uriBuilder` | how a query becomes a URL | `UriBuilderJsonAdapter` |
| `ajax` | how an HTTP request is made | `AjaxFetchAdapter` |

## configureBreeze

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from 'breeze-client/adapter-model-library-backing-store';

configureBreeze({
  ajax: AjaxFetchAdapter,
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
  namingConvention: NamingConvention.camelCase,
});
```

### Options

| Option | Type | Notes |
|---|---|---|
| `modelLibrary` | adapter class | |
| `uriBuilder` | adapter class | |
| `ajax` | adapter class | |
| `dataService` | adapter class | |
| `fetch` | `BreezeFetch` | custom transport, handed to the ajax adapter — see [Supplying your own transport](/server/transport) |
| `namingConvention` | `NamingConvention` | sets the default |
| `noEval` | `boolean` | forbid `eval`/`Function`, for strict CSP environments |
| `config` | `BreezeConfig` | target a non-global config; rarely needed |

You can call it more than once and pass only what you want to change:

```ts
configureBreeze({ namingConvention: NamingConvention.none });
```

### Order matters, and configureBreeze handles it

The data service adapter resolves the ajax adapter when it initializes, so ajax has to be
registered first. Calling the individual `register()` methods in the wrong order throws:

```ts
DataServiceWebApiAdapter.register();   // resolves 'ajax' — not registered yet
AjaxFetchAdapter.register();
// Error: Unable to find ajax adapter for dataservice adapter 'webApi'
```

`configureBreeze` registers in dependency order, so this cannot happen. That is the main
practical reason to prefer it over the individual calls.

## Importing does not register

In 2.x, importing an adapter module registered it as a side effect:

```ts
// 2.x — the import alone was enough
import 'breeze-client/adapter-ajax-fetch';
```

Breeze 3 modules do not touch global state when imported. Registration happens only when
you pass an adapter to `configureBreeze` or call its `register()`.

This makes import order irrelevant and lets bundlers reason about the package properly.
It also means that if you relied on the side effect, adapters will appear unregistered —
see [Migrating from 2.x](/guide/migrating-from-2x).

## The older API still works

```ts
config.registerAdapter('ajax', AjaxFetchAdapter);
config.initializeAdapterInstance('ajax', 'fetch', true);
```

`registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances` are all
still there and still work. They are marked `@deprecated` because `configureBreeze` is
better — a misspelled adapter name is a compile error rather than a runtime one — but
they are not scheduled for removal.

## Choosing adapters

### modelLibrary

`ModelLibraryBackingStoreAdapter` is the only one shipped, and the right choice for plain
JavaScript and TypeScript models. The Knockout adapter was removed in 3.0.

### dataService

`DataServiceWebApiAdapter` talks to a Breeze .NET server, or anything using the same JSON
shape. To target a different backend, subclass `AbstractDataServiceAdapter` — see
[DataServiceAdapter](/server/dataserviceadapter).

The OData data service adapter was removed in 3.0.

### uriBuilder

`UriBuilderJsonAdapter` encodes the query as Breeze JSON in the query string. It is the
only one shipped; the OData URI builder was removed in 3.0.

### ajax

`AjaxFetchAdapter` uses `globalThis.fetch`. To add auth headers, retry, or route requests
through a framework HTTP client, supply a `fetch` function rather than writing a new
adapter — see [Supplying your own transport](/server/transport).

## Naming conventions

A `NamingConvention` translates between server and client property names.

```ts
configureBreeze({ namingConvention: NamingConvention.camelCase });
```

- `NamingConvention.camelCase` — `CompanyName` ⟷ `companyName`. Use with a .NET server.
- `NamingConvention.none` — names pass through unchanged.

See [Naming conventions](/server/namingconvention) for custom conventions.

## Content Security Policy

If your CSP forbids `eval` and `new Function`:

```ts
configureBreeze({ noEval: true });
```

Breeze detects this automatically at startup by attempting a `Function('')` and catching
the failure, so you usually do not need to set it. Set it explicitly if you want to be
certain.
