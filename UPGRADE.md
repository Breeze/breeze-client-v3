# Upgrading to breeze-client 3.0

A running list of everything that affects **applications using Breeze**. Kept current as
v3 develops. Items marked *planned* are decided but not yet implemented.

For changes that only matter if you work on Breeze itself, see [CHANGES-DEV.md](./CHANGES-DEV.md).

> **Status: v3 is in development.** Nothing here is released yet.

---

## 1. Installation and module format

**Done.**

```bash
npm install breeze-client        # 3.0.0
```

- **One package, one tag.** 2.x published the same package under `latest`, `mjs`, `cjs`
  and `umd` dist-tags. v3 publishes a single package on `latest`. If your `package.json`
  says `"breeze-client": "cjs"` or `"^2.2.2-cjs"`, change it to `"^3.0.0"`.
- **ESM only.** There is no CommonJS build and no UMD bundle.
  - `require('breeze-client')` no longer works. Use `import`.
  - The `<script src="breeze.debug.js">` + global `breeze` deployment style is gone.
    Use a bundler, or an import map.
  - Node 20 or later.
- Subpath imports are unchanged in spelling:
  ```ts
  import { EntityManager } from 'breeze-client';
  import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
  ```

## 2. Removed: Knockout, jQuery, AngularJS and OData

**Done.** These are gone entirely, along with every internal reference to them.

| Removed | If you use it |
|---|---|
| `breeze-client/adapter-model-library-ko` | Stay on 2.x, or move your models to the backing-store adapter (the default). |
| `breeze-client/adapter-ajax-jquery` | Use `adapter-ajax-fetch`. `fetch` is available in every supported browser and in Node 20+. |
| `breeze-client/adapter-ajax-angularjs` | AngularJS reached end of life in 2022. Stay on 2.x. |
| `breeze-client/adapter-data-service-odata` | Stay on 2.x. Breeze's own JSON query format is the supported path. |
| `breeze-client/adapter-uri-builder-odata` | Use `adapter-uri-builder-json` with a Breeze .NET server. |

### CSDL / EDMX metadata is no longer parsed

`MetadataStore.importMetadata()` used to detect a `schema` property and parse CSDL
(the OData / EDMX metadata format). That path is removed, along with
`DataType.fromEdmDataType`.

This matters if you fetch metadata from an **OData `$metadata` endpoint**, or from an
older Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata
(`{"structuralTypes": [...]}`) and are unaffected.

If you need CSDL, stay on 2.x or export your metadata to Breeze JSON once and check it in.

### Angular

`breeze-client/adapter-ajax-httpclient` is **not** in the v3 package. It is planned as a
separate `breeze-client-angular` package so that Angular and RxJS are not dependencies of
the core library. Until it ships, Angular users should stay on 2.x.

## 3. Ajax adapters become a plain fetch function

***Planned — not yet implemented.***

The `AjaxAdapter` interface existed so Breeze could sit on top of jQuery, AngularJS
`$http`, Angular `HttpClient` or `fetch`. With the first three gone, the abstraction has
one implementation.

It will be replaced by a single injectable function:

```ts
type BreezeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

defaulting to `globalThis.fetch`. Supply your own to add auth headers, retry, or to route
requests through Angular's `HttpClient` so they pass through its interceptors.

This also retires the callback-shaped `AjaxConfig` (`success` / `error`) in favour of a
promise.

**If you implement `AjaxAdapter` directly, or call
`config.registerAdapter("ajax", ...)`, this will affect you.** A deprecated shim is
planned for the common cases. Migration guidance will land here when it does.

## 4. Adapter configuration becomes typed

***Planned — not yet implemented.***

Today adapters are wired by string name, and importing an adapter module silently
registers it as a side effect:

```ts
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
config.registerAdapter("ajax", AjaxFetchAdapter);
config.initializeAdapterInstance("ajax", "fetch", true);
```

v3 will add a typed setup call:

```ts
configureBreeze({
  ajax: AjaxFetchAdapter,
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
});
```

`config.registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances`
will keep working, marked `@deprecated`, so existing startup code runs unchanged.

One behavioural change to be aware of: **importing an adapter will no longer register
it.** Registration becomes explicit. If you rely on the import side effect today, add the
adapter to `configureBreeze`.

## 5. What has *not* changed

The public API is otherwise intended to be source-compatible with 2.x. `EntityManager`,
`EntityQuery`, `Predicate`, `MetadataStore`, `EntityType`, `EntityAspect`, `Validator`,
`DataType`, the `BreezeEnum` types, save/query options and the event model all keep their
names, shapes and semantics.

If you hit a difference that is not listed above, it is a bug — please file an issue.

---

## Fixed along the way

Small pre-existing defects corrected in v3:

- `breeze.version` reported `"2.1.5"` in the 2.2.2 release. It will report the real
  version. *(planned)*
- `breeze.assertConfig` and `breeze.assertParam` were `null` on the `breeze` object
  literal, though the named ESM exports worked. *(planned)*
