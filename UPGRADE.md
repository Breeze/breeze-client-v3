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
`DataType.fromEdmDataType`. Passing CSDL to `importMetadata()` now throws a
clear error rather than silently importing nothing.

This matters if you fetch metadata from an **OData `$metadata` endpoint**, or from an
older Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata
(`{"structuralTypes": [...]}`) and are unaffected.

If you need CSDL, stay on 2.x or export your metadata to Breeze JSON once and check it in.

### Angular

`breeze-client/adapter-ajax-httpclient` is **not** in the v3 package. It is planned as a
separate `breeze-client-angular` package so that Angular and RxJS are not dependencies of
the core library. Until it ships, Angular users should stay on 2.x.

## 3. No ajax adapter — supply a `fetch` function instead

**Done.** Breeze 3 makes every HTTP request through a single function:

```ts
type BreezeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

It defaults to `globalThis.fetch`. Supply your own with `configureBreeze`; no ajax adapter
is needed:

```ts
configureBreeze({
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
  fetch: (input, init) =>
    fetch(input, { ...init, headers: { ...init?.headers, Authorization: token } }),
});
```

Use it for auth headers, retry, request signing, logging, stubbing in tests, or to route
requests through a framework HTTP client such as Angular's `HttpClient`. It is stored as
`config.fetch` and read on every request.

**Nothing you have breaks.** The ajax adapter layer is deprecated, not removed:

- `AjaxFetchAdapter`, `configureBreeze({ ajax })`, `config.registerAdapter("ajax", ...)` and
  `initializeAdapterInstance("ajax", ...)` still work. A registered ajax adapter is used in
  preference to `config.fetch`, and receives `fetch` as its transport if you pass both.
- Its `defaultSettings` and `requestInterceptor` still work.
- A custom `AjaxAdapter` still works.
- A data service adapter that calls `this.ajaxImpl.ajax(...)` still works: with no ajax
  adapter registered, `ajaxImpl` is a built-in one that uses `config.fetch`. New code
  should call the promise-based `_ajax()` instead.

**Registration order no longer matters.** The data service adapter used to resolve the
ajax adapter when it initialized, so registering it first threw `Unable to find ajax
adapter for dataservice adapter 'webApi'`. There is no longer anything to resolve.

Two small changes in how requests are built, on either path: `headers` on a request's
`AjaxConfig` are now sent (the fetch adapter used to ignore them), and a `GET` no longer
carries a `Content-Type` header, which lets browsers skip the CORS preflight for queries.

## 4. Typed configuration

**Done.** Adapters can now be wired in one typed call:

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from 'breeze-client/adapter-model-library-backing-store';

configureBreeze({
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
  namingConvention: NamingConvention.camelCase,
});
```

instead of the stringly-typed pairs:

```ts
config.registerAdapter("dataService", DataServiceWebApiAdapter);
config.initializeAdapterInstance("dataService", "webApi", true);
```

Misspell an adapter name in the old form and you get a runtime error; in the new form it
does not compile. `configureBreeze` also takes `fetch`, `noEval`, and a `config` for
targeting a non-global `BreezeConfig`.

**`config.registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances`
still work.** They are the compatibility path; existing 2.x startup code runs as-is. They
are marked `@deprecated`, because `configureBreeze` is better, but they are not scheduled
for removal.

`InterfaceRegistryConfig`, the argument to `initializeAdapterInstances`, now types its
fields as adapter *names* — `{ ajax: 'fetch' }` — which is what the method always expected.
2.x declared them as internal `InterfaceDef` objects, so TypeScript callers had to cast.

### Importing an adapter no longer registers it

**Done, and this one is breaking.** In 2.x, importing an adapter module registered it as
a side effect:

```ts
// 2.x: this import alone was enough - the module called config.registerAdapter itself
import 'breeze-client/adapter-data-service-webapi';
```

v3 modules do not touch global state on import. Registration is explicit: pass the
adapter to `configureBreeze`, or call its `register()`.

**If your startup relied on the import side effect, adapters will appear unregistered**,
and queries fail for want of a data service adapter.

In 2.x the import side effect also hid an ordering requirement: the data service adapter
needed the ajax adapter registered before it. That no longer applies — see section 3.

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
- **Local projections of nested paths replaced only the first dot:**
  `order.customer.companyName` came back as `order_customer.companyName`. It is now
  `order_customer_companyName`.
- **A string assigned to a `DateOnly` property stayed a string.** It is now parsed as a
  local date.
- **`config.getAdapterInstance` was missing from the published type declarations.** It was
  tagged `@internal` and the build strips internal members, so TypeScript code calling it
  needed a cast. It is now public.
- `breeze.version` reported `"2.1.5"` in the 2.2.2 release. It will report the real
  version. *(planned)*
- `breeze.assertConfig` and `breeze.assertParam` were `null` on the `breeze` object
  literal, though the named ESM exports worked. *(planned)*
