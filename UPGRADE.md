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

**Done.** Breeze needs no adapter registration by default. With nothing registered, it
uses `ModelLibraryBackingStoreAdapter` (`'backingStore'`), `UriBuilderJsonAdapter`
(`'json'`) and `DataServiceWebApiAdapter` (`'webApi'`), and makes HTTP requests through
`config.fetch`, which defaults to `globalThis.fetch`. The naming convention, which is not
an adapter, now defaults to `camelCase` (see section 6). So a Breeze .NET server needs no
configuration at all:

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/Northwind');
```

No adapter imports are needed. Nothing is registered at import time: each default is
registered the first time it is needed, and only for an interface nothing has been
registered for, so anything the application registers takes precedence. Register custom
adapters at startup, **before creating any `EntityManager`** — a `DataService` resolves its
adapters once, when it is first used.

`configureBreeze` is optional. When you do replace an adapter — a subclass of
`DataServiceWebApiAdapter`, say, or your own `AbstractDataServiceAdapter` — it wires it in
one typed call:

```ts
configureBreeze({ dataService: MyWebApiAdapter });
```

instead of the stringly-typed pairs:

```ts
config.registerAdapter("dataService", MyWebApiAdapter);
config.initializeAdapterInstance("dataService", "myWebApi", true);
```

Misspell an adapter name in the old form and you get a runtime error; in the new form it
does not compile. `configureBreeze` also takes `modelLibrary`, `uriBuilder`, `fetch`,
`namingConvention`, and a `config` for targeting a non-global `BreezeConfig`. The adapter subpaths
(`breeze-client/adapter-data-service-webapi` and so on) still exist, for subclassing and
for explicit registration.

**`config.registerAdapter`, `initializeAdapterInstance` and `initializeAdapterInstances`
still work.** They are the compatibility path; existing 2.x startup code runs as-is. They
are marked `@deprecated`, because `configureBreeze` is better, but they are not scheduled
for removal. The standard names — `'backingStore'`, `'json'`, `'webApi'` and the ajax
adapter's `'fetch'` — resolve to the defaults without a `registerAdapter` call first, so
`config.initializeAdapterInstance("dataService", "webApi", true)` works on its own. An
unknown name still throws `Unregistered adapter`.

`InterfaceRegistryConfig`, the argument to `initializeAdapterInstances`, now types its
fields as adapter *names* — `{ ajax: 'fetch' }` — which is what the method always expected.
2.x declared them as internal `InterfaceDef` objects, so TypeScript callers had to cast.

### Importing an adapter no longer registers it

**Done, but it rarely matters.** In 2.x, importing an adapter module registered it as
a side effect:

```ts
// 2.x: this import alone was enough - the module called config.registerAdapter itself
import 'breeze-client/adapter-data-service-webapi';
```

v3 modules do not touch global state on import. That no longer breaks anything, because
the standard adapters need no registration at all: Breeze falls back to them. You can
delete side-effect imports. 2.x startup code that then initialized the standard adapters
by name — `config.initializeAdapterInstance("dataService", "webApi", true)`,
`config.initializeAdapterInstance("ajax", "fetch", true)` — keeps working; `"fetch"` gives
an ajax adapter that sends requests through `config.fetch`.

A custom adapter is registered explicitly: pass it to `configureBreeze`, or call its
`register()`, before creating an `EntityManager`.

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

## 6. The default naming convention is now `camelCase`

**Done. Breaking change** for applications that relied on the old default.

`NamingConvention.defaultInstance` is now `NamingConvention.camelCase`. In 2.x, and in v3
until now, it was `NamingConvention.none`. A `MetadataStore` takes the default naming
convention when it is created, so every store and every `EntityManager` created after
startup camel-cases property names unless told otherwise: `CompanyName` on the server is
`companyName` on the client. With the default adapters (section 4), this means a Breeze
.NET server needs no configuration at all.

- **You already set camelCase:** nothing to do. `NamingConvention.camelCase.setAsDefault()`,
  or `configureBreeze({ namingConvention: NamingConvention.camelCase })`, is now redundant
  but harmless.
- **You relied on `none`:** your server already sends the property names the client should
  use — a Node/Sequelize-style server, say, or one whose metadata names are already
  camelCase. Set the old behaviour explicitly at startup, before creating any
  `MetadataStore` or `EntityManager`:

  ```ts
  NamingConvention.none.setAsDefault();
  // or
  configureBreeze({ namingConvention: NamingConvention.none });
  ```

  Without it, PascalCase server names reach your code camel-cased, so code that reads
  `CompanyName` finds nothing. Server names that are already camelCase do not round-trip
  (`camelCase` turns `companyName` back into `CompanyName`), so metadata either fails to
  load with `NamingConvention for this ... property name does not roundtrip properly`, or
  Breeze sends the server upper-cased names.

`NamingConvention.none` is still named `'noChange'` in exported metadata, and metadata that
names a naming convention still sets it when imported into an empty store. A store
loaded from an `exportMetadata()` file therefore keeps the convention it was exported with.

### The observable arrays keep their public surface

`relationArray`, `complexArray` and `primitiveArray` are still real arrays, and everything an
application uses is unchanged: `push`, `pop`, `shift`, `unshift`, `splice`, `arrayChanged`,
`load()`, `parentEntity`, `navigationProperty`, `parent`, `parentProperty`, and every native array
method.

What moved is the internal machinery. It used to be copied onto each array instance and now sits
behind a single `_obs` property: `_push`, `_processAdds`, `_processRemoves`, `_getGoodAdds`,
`_beforeChange`, `_getPendingPubs`, `_rejectChanges`, `_acceptChanges`, `_origValues`,
`_addsInProcess`, `_inProgress` and `getEntityAspect()`. Those were `@hidden` internals rather than
documented API, so this reaches only a plugin or a custom `ModelLibraryAdapter` that called them
directly.

Moving them was the point of the change rather than a side effect of it: the number of properties
on each array instance was what pushed these collections onto a slow path, and removing them made
indexed reads about ten times faster. *The observable arrays* in CHANGES-DEV.md has the
measurements and the alternatives that were tried.

---

### `noEval` is removed, and Breeze no longer evaluates strings

`config.noEval` and `configureBreeze({ noEval })` are gone. Remove them - passing `noEval` to
`configureBreeze` is now a compile error, and reading `config.noEval` gives `undefined`.

Nothing replaces them, because there is nothing left to switch off. The flag existed for one
reason: 2.x built an entity constructor from a string, `Function('return function Order(){}')()`,
so that the type had a readable name in a debugger. It also probed for that ability at startup by
calling `Function('')` inside a `try`, which a strict Content Security Policy turns into a
reported violation even though the failure was caught.

Constructors are now named with `Object.defineProperty(ctor, 'name', ...)`, which produces the
same result with no dynamic code. Breeze contains no `eval` and no `new Function`, so it runs
under a policy without `'unsafe-eval'` and reports nothing at startup.

---


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
- **Local projections named nested paths differently from the server.** Only the first
  dot was replaced, so `order.customer.companyName` came back as
  `order_customer.companyName`. Local queries now name a projected path the way the .NET
  server does, joining the server property names: `order_Customer_CompanyName`.
- **A string assigned to a `DateOnly` property stayed a string.** It is now parsed as a
  local date.
- **`config.getAdapterInstance` was missing from the published type declarations.** It was
  tagged `@internal` and the build strips internal members, so TypeScript code calling it
  needed a cast. It is now public.
- **2.x startup code that initialized the standard adapters by name works again.**
  `config.initializeAdapterInstance("dataService", "webApi", true)` and the like relied on
  the adapter module having registered itself on import. Once v3 dropped that side effect
  they threw `Unregistered adapter`. The standard names now resolve to the default
  adapters without being registered first.
- `breeze.version` reported `"2.1.5"` in the 2.2.2 release. It will report the real
  version. *(planned)*
- `breeze.assertConfig` and `breeze.assertParam` were `null` on the `breeze` object
  literal, though the named ESM exports worked. *(planned)*

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
- `DataService.useJsonp` is deprecated. It has no effect on Breeze’s own transport, which has
  no JSONP support; a registered (deprecated) ajax adapter can still act on it.
