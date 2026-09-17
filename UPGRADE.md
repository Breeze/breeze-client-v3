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

### Entities always have plain properties

The model library used to decide the shape of an entity. With Knockout gone there is only the
backing store, so a property is just a property:

```ts
order.freight;           // 2.x with Knockout: order.freight()
order.freight = 12.5;    // 2.x with Knockout: order.freight(12.5)
```

`getProperty` and `setProperty` still work, on entities and complex objects alike.

### What else went with OData

- **`Predicate.toODataFragment` is gone.** It was never a core method: the OData URI builder
  added it to `Predicate.prototype` when you imported that adapter. Use `toJSON()`.
- **Requests no longer carry `$filter`, `$orderby`, `$select` or `$expand`.** The JSON URI builder is the
  only one left. A server that understands only OData query syntax is not supported.

### The Breeze Labs Metadata-Helper is gone

The 2.x docs used `breeze.metadata-helper.js` for hand-written metadata, with abbreviated
attribute names (`type`, `max`, `fk`) and convention-based defaults. There is no v3 version.
`MetadataStore.addEntityType` takes property maps, qualifies navigation type names and has
sensible defaults, so the native API is nearly as short.

### CSDL / EDMX metadata is no longer parsed

`MetadataStore.importMetadata()` used to detect a `schema` property and parse CSDL
(the OData / EDMX metadata format). That path is removed, along with
`DataType.fromEdmDataType`. Passing CSDL to `importMetadata()` now throws a
clear error rather than silently importing nothing.

This matters if you fetch metadata from an **OData `$metadata` endpoint**, or from an
older Breeze **WebApi2 + EF6** server. Breeze .NET Core servers emit Breeze JSON metadata
(`{"structuralTypes": [...]}`) and are unaffected.

An object with a `schema` property and no `structuralTypes` makes `importMetadata()` throw *This
looks like CSDL (OData / EDMX) metadata, which breeze-client 3 does not read*, prefixed by
*Unable to either parse or import metadata*.

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

`configureBreeze` takes `namingConvention` directly. There is no `breeze.` global, and no
`NamingConvention.instance` — the current default is `NamingConvention.defaultInstance`.

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


## 7. `fetchEntityByKey` reports a missing entity as `null`, not `undefined`

```ts
const result = await em.fetchEntityByKey(Customer, id);
result.entity;   // the Customer, or null
```

It was `undefined` in 2.x. Everywhere else in Breeze, an absent entity is `null` — an uncached
scalar navigation property, a nullable data property, `getEntityByKey` — so this one result was
the exception, and the exception was undocumented. Its own doc comment said "or null" and had
been wrong since 2.x.

**Most code is unaffected.** `if (result.entity)`, `result.entity != null` and optional chaining
all behave the same. What changes:

| your code | effect |
|---|---|
| `if (result.entity)` / `!= null` / `?.` | no change |
| `result.entity === undefined` | now always false — **and a compile error**, since the property is no longer optional |
| `const { entity = fallback } = result` | the default no longer fires; `??` or `\|\|` instead |

`IEntityByKeyResult.entity` is now `Entity \| null` rather than an optional `entity?: Entity`, so
TypeScript flags the cases that need attention rather than letting them fail silently at run time.

---

## Types are stricter

v3 builds under `strictNullChecks` and `noImplicitAny`. Two declarations changed in ways you may
notice, both type-only — nothing behaves differently:

- `getProperty` and `setProperty` are **no longer optional**, on `Entity` or on `ComplexObject`.
  The model library adapter has always installed them, and marking them optional forced needless
  null checks; drop any `!` or `?.`. A class that `implements Entity` now has to list them, with
  `declare` so the field does not shadow what Breeze installs.
- `EntityQuery.wherePredicate`, `EntityAspect.hasTempKey` and `ValidationError.propertyName` are
  now optional, which is what they always were at run time. `propertyName` in particular was
  always undefined for entity-level errors.

---

The public API is otherwise intended to be source-compatible with 2.x. `EntityManager`,
`EntityQuery`, `Predicate`, `MetadataStore`, `EntityType`, `EntityAspect`, `Validator`,
`DataType`, the `BreezeEnum` types, save/query options and the event model all keep their
names, shapes and semantics.

If you hit a difference that is not listed above, it is a bug — please file an issue.

---

## Promises are native

Every async method returns a native `Promise`. Use `await`, or `.then`/`.catch`. The Q idiom
2.x code often used does not exist:

```ts
em.saveChanges().fail(handler);    // 2.x with Q — TypeError in v3
em.saveChanges().catch(handler);   // v3
```

Nothing else in the query or save contract changed.

---

## Save errors arrive as a problem details document

A Breeze .NET server now returns [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
`application/problem+json`, with `type`, `title`, `status` and `detail`. Before 3.0 it sent
`{ Code, Message, StackTrace, EntityErrors }` with no content type of its own, always included
the stack trace, and set `Code` to `0` for anything that was not an `EntityErrorsException`.

**A client needs no changes.** Breeze reads either spelling, `e.message` comes from `detail`
falling back to `title`, and the capitalised members are still sent by default so an application
on an older client reads the error unchanged. Two server settings control it,
`IncludeStackTraceInErrors` (now `false` by default) and `IncludeLegacyErrorMembers`.

---

## Deprecated: the callback arguments on the async methods

Every async method has always accepted an optional success and failure callback as well as
returning a promise. Those arguments are now deprecated on `EntityManager.executeQuery`,
`saveChanges` and `fetchMetadata`, `EntityQuery.execute`, `EntityAspect.loadNavigationProperty`,
`MetadataStore.fetchMetadata`, and a relation array's `load`.

They still work and behave exactly as before. What changes is that your editor strikes the call
through, and they will be removed in a future major version:

```ts
em.executeQuery(query, onData, onError);   // deprecated
const data = await em.executeQuery(query); // supported
```

Only the callback-taking call is marked; `em.executeQuery(query)` is not. The callback types
`Callback`, `ErrorCallback`, `QuerySuccessCallback` and `QueryErrorCallback` are deprecated too.

The promise was already the only fully supported form — the save-queuing mixin has always
ignored the callback arguments — so this makes the type declarations say what the library
already did.

---

## New, and entirely optional: typed entities

`EntityQuery`, `QueryResult` and the `EntityManager` methods that take an entity type now carry a
type parameter, so `results` can be `Customer[]` rather than `any[]`:

```ts
const custs = await EntityQuery.from(Customer).using(em).execute();
custs.results[0].companyName;    // checked
```

**Nothing changes for existing code.** Every type parameter defaults to the type that API had
before — `QueryResult<T = any>`, so `qr.results` stays `any[]` — and type parameters are erased by
the compiler, so the emitted JavaScript is identical. Passing a constructor is a new *overload*
alongside the existing name and `EntityType` ones.

The same treatment reaches `getEntityByKey`, `hasChanges`, `EntityQuery.fromEntities`,
`EntityQuery.toType`, `RelationArray.load()` and `EntityType.createEntity`. `attachEntity` and
`addEntity` now give back the type they were handed instead of widening it to `Entity`.

Where a type is *inferred* from something you pass in — `fromEntities`, `load()` — a plain
`Entity` still yields `any`, not `Entity`, so existing callers are untouched.

Using it does require [registering your classes](/guide/extending-entities#registering-a-constructor),
which is what tells Breeze which type a constructor stands for. See
[Typed entities](/guide/typed-entities) for what is checked, what is merely asserted, and why
`EntityQuery.from<Customer>('Orders')` compiles.

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
- **Save queuing sent temporary keys to the server.** With the save-queuing mixin, a foreign
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
  found in group*. The index is a `Map` now.
- **Working with many changed entities at once is no longer quadratic.** `acceptChanges`,
  `rejectChanges` and `detachEntity` each asked the manager to work out afresh whether
  anything was still dirty, which meant walking the whole cache — once per entity. Over
  40,000 entities `acceptChanges` took 8.5 seconds; it takes 33 ms. `getEntityGraph` with a
  two-level expand was the same shape: 5.1 seconds over 8,000 orders and their 24,000
  details, now 10 ms. See [Performance](/guide/performance).
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
