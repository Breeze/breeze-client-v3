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

## 3. Supplying your own transport

**Done, in part.** The `AjaxAdapter` interface, `AjaxConfig` and
`config.registerAdapter("ajax", ...)` are all unchanged, so nothing you have breaks.

What is new is that the fetch adapter now takes an injectable transport:

```ts
type BreezeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

Pass one to `configureBreeze` (see below) or to `AjaxFetchAdapter.register`:

```ts
configureBreeze({
  ajax: AjaxFetchAdapter,
  fetch: async (input, init) => {
    const res = await fetch(input, { ...init, headers: { ...init?.headers, Authorization: token } });
    return res;
  },
});
```

Use it for auth headers, retry, request signing, stubbing in tests, or to route requests
through a framework HTTP client such as Angular's `HttpClient` so they pass through its
interceptors. It defaults to `globalThis.fetch`.

***Still planned:*** retiring the `AjaxAdapter` class and the `"ajax"` registry slot
altogether in favour of just this function, and replacing the callback-shaped `AjaxConfig`
(`success` / `error`) with a promise. That is a larger change and will come with its own
deprecation shim. Nothing you write against `BreezeFetch` today will be affected by it.

## 4. Typed configuration

**Done.** Adapters can now be wired in one typed call:

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

instead of the stringly-typed pairs:

```ts
config.registerAdapter("ajax", AjaxFetchAdapter);
config.initializeAdapterInstance("ajax", "fetch", true);
```

Misspell an adapter name in the old form and you get a runtime error; in the new form it
does not compile. `configureBreeze` also takes `fetch`, `noEval`, and a `config` for
targeting a non-global `BreezeConfig`, and it registers adapters in dependency order so
the data service adapter can resolve the ajax adapter when it initializes.

**`config.registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances`
are unchanged and still work.** They are the compatibility path; existing 2.x startup code
runs as-is. They will be marked `@deprecated` in a later release.

***Still planned:*** making adapter registration fully explicit. Today, importing an
adapter module still registers it as a side effect, so import order can matter. When that
changes, passing the adapter to `configureBreeze` will be the only thing that registers it.

## 5. Class constructors require `new`

**Done.** This is a real breaking change, and it is worth reading even if it looks obscure.

```ts
Predicate("CompanyName", "StartsWith", "B");      // 2.x: worked. v3: throws.
new Predicate("CompanyName", "StartsWith", "B");  // works
Predicate.create("CompanyName", "startsWith", "B"); // works, preferred
```

v3 ships real ES2022 classes. A class constructor cannot be invoked as a plain function,
so any Breeze type called without `new` now throws
`TypeError: Class constructor X cannot be invoked without 'new'`.

In 2.x this appeared to work. It did not, in any modern build — the 2.x *test harness*
compiled the library down to ES5, which turned classes back into functions and masked it.
Anyone consuming the `mjs` build was already affected.

**Fix:** add `new`, or use the static factory where one exists (`Predicate.create`,
`DataType.fromName`, and so on).

If this affects a lot of your code, say so — the constructors can be made callable again
with a small compatibility wrapper.

## 6. What has *not* changed

The public API is otherwise intended to be source-compatible with 2.x. `EntityManager`,
`EntityQuery`, `Predicate`, `MetadataStore`, `EntityType`, `EntityAspect`, `Validator`,
`DataType`, the `BreezeEnum` types, save/query options and the event model all keep their
names, shapes and semantics.

If you hit a difference that is not listed above, it is a bug — please file an issue.

---

## Fixed along the way

Small pre-existing defects corrected in v3:

- **`JsonResultsAdapter` lost its type brand.** `JsonResultsAdapter` declared
  `_$typeName: string` without TypeScript's `declare` modifier, so under ES2022 class-field
  semantics the constructor defined the field as `undefined`, shadowing the value set on
  the prototype. `EntityQuery.using(myJsonResultsAdapter)` therefore failed to recognise
  its argument. Every other Breeze class already had `declare`; this one was missed.
  Affected the 2.x `mjs` build.
- **The fetch adapter set `referrer: 'client'`**, which is the browser default and
  redundant there, but which Node's `fetch` rejects outright as an invalid URL. Breeze
  was unusable with the fetch adapter under Node. Now unset.
- `breeze.version` reported `"2.1.5"` in the 2.2.2 release. It will report the real
  version. *(planned)*
- `breeze.assertConfig` and `breeze.assertParam` were `null` on the `breeze` object
  literal, though the named ESM exports worked. *(planned)*
