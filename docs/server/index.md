# Talking to the server

An `EntityManager` does three things with a server:

1. **Fetch metadata** — ask the service to describe its entity types.
2. **Query** — send an `EntityQuery`, then turn the JSON that comes back into entities in
   the cache.
3. **Save** — send every pending change in one request, then merge the server's reply
   into the cache.

That workflow is the same for every server. The details are what differ:
- Can the server provide metadata?
- Does it accept filter, order and paging instructions, and in what format?
- What shape is the JSON in a query response?
- Are property names the same on the server and the client?
- Can it save a batch of changes in one request, or only one entity at a time?
- What goes in the body of a save request, and what comes back?

Breeze keeps those details out of the `EntityManager`. They live in a small set of
replaceable pieces.

::: tip Changed in 3.0
The OData data service adapter and URI builder are gone, along with CSDL/EDMX metadata
parsing. See [Migrating from 2.x](/guide/migrating-from-2x).
:::

## The pieces

| Piece | Job | Default | More |
|---|---|---|---|
| `DataService` | which service: its URL, which adapter talks to it, whether it serves metadata | created for you from the service name | [below](#dataservice) |
| data service adapter | what requests look like and how responses are read | `DataServiceWebApiAdapter` (`'webApi'`) | [DataServiceAdapter](/server/dataserviceadapter) |
| URI builder | turns an `EntityQuery` into a URL | `UriBuilderJsonAdapter` (`'json'`) | [Configuration](/guide/configuration) |
| `fetch` function | makes the HTTP request | `globalThis.fetch`, or yours via `configureBreeze({ fetch })` | [Supplying your own transport](/server/transport) |
| `JsonResultsAdapter` | finds the entities in the JSON, and their types | supplied by the data service adapter | [Transforming JSON results](/server/jsonresultsadapter) |
| `NamingConvention` | translates property names between server and client | `camelCase` (`none` also ships) | [Naming conventions](/server/namingconvention) |

Every piece has a default, and none needs registering. A Breeze .NET server needs no
configuration at all. For a server that already sends the property names the client
should use, set `NamingConvention.none` — see [Naming conventions](/server/namingconvention).
To replace an adapter, do it once, at startup, before you create an `EntityManager`. See
[Configuration](/guide/configuration).

### A query, step by step

```ts
const { results } = await em.executeQuery(EntityQuery.from('Customers').take(10));
```

1. Breeze picks the `DataService`: the query's own if it has one, otherwise the
   manager's.
2. If the service serves metadata and the manager does not have it yet, Breeze fetches
   it first, with `GET {serviceName}/Metadata`.
3. The data service adapter builds the request. Normally the URI builder puts the query
   in the URL: `GET {serviceName}/Customers?{...}`. With `query.usePost()` the query goes
   in a POST body instead.
4. The request goes out through `config.fetch`: `globalThis.fetch`, unless you supplied
   your own.
5. The `JsonResultsAdapter` picks the results out of the response and identifies which
   nodes are entities. Breeze creates or updates those entities in the cache, reading
   property names through the `NamingConvention`.

### A save, step by step

1. `em.saveChanges()` collects the changed entities.
2. The data service adapter turns them into a request body. It posts that to
   `{serviceName}/SaveChanges`, or to the `resourceName` in the `SaveOptions`.
3. The adapter reads the response. It contains the saved entities, the real keys for new
   entities that had temporary keys, and any entities the server deleted.
4. Breeze merges all of that into the cache, fixes up the keys, and marks the saved
   entities `Unchanged`.

## DataService

A `DataService` describes one service. You rarely create one yourself:
`new EntityManager('/breeze/NorthwindIBModel')` creates it for you. Create one explicitly
when you need to set anything besides the service name:

```ts
import { DataService, EntityManager } from 'breeze-client';

const dataService = new DataService({
  serviceName: 'https://api.example.com/breeze/NorthwindIBModel',
  hasServerMetadata: false,
});

const em = new EntityManager({ dataService });
```

| Option | Default | Notes |
|---|---|---|
| `serviceName` | — | Required. The service's base URL, relative or absolute. Breeze adds a trailing `/` if there isn't one. |
| `hasServerMetadata` | `true` | Set to `false` if the server has no metadata endpoint. Breeze then never asks for metadata, so you must supply it — see [Writing metadata by hand](/metadata/by-hand). |
| `adapterName` | the default data service adapter | The name of a registered data service adapter, such as `'webApi'`. Use it to talk to one service with a different adapter. |
| `uriBuilderName` | the default URI builder | The name of a registered URI builder (`'json'`). |
| `jsonResultsAdapter` | the data service adapter's | Changes how responses from this service are read. See [Transforming JSON results](/server/jsonresultsadapter). |
| `useJsonp` | `false` | Deprecated, and has no effect: Breeze has no JSONP support. It is still read and written with a serialized `DataService`. |

A query or save against a `DataService` with no `serviceName` throws
`Unable to resolve a 'serviceName' for this dataService`.

A `DataService` is read-only. `using()` returns a copy with changes applied:

```ts
const withoutMetadata = dataService.using({ hasServerMetadata: false });
```

`qualifyUrl(suffix)` joins the service name and a path. For example,
`dataService.qualifyUrl('Metadata')` gives the metadata URL.

### More than one service

An `EntityManager` has one `DataService`, but a single query or save can target another:

```ts
const archive = new DataService({ serviceName: '/breeze/Archive' });

const query = EntityQuery.from('Orders').using(archive);
const { results } = await em.executeQuery(query);
```

For saves, `SaveOptions` has `dataService` and `resourceName` properties. See
[Saving changes](/guide/saving-changes).

A `MetadataStore` records which services it already has metadata for, so managers that
share a store fetch each service's metadata once.

## The Breeze .NET server

The companion server for Breeze 3 is
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3), for ASP.NET Core on
.NET 8, 9 and 10. A typical Entity Framework Core application installs two NuGet
packages:

| Package | Purpose |
|---|---|
| `Breeze.AspNetCore.NetCore` | ASP.NET Core integration. `[BreezeQueryFilter]` applies a Breeze query to the `IQueryable` an action returns. |
| `Breeze.Persistence.EFCore` | Metadata and transactional saves for Entity Framework Core |

`Breeze.Persistence.NH` does the same job for NHibernate.

A controller has one endpoint for metadata, one per query resource, and one for saves:

```csharp
using Breeze.AspNetCore;
using Breeze.Persistence;
using Breeze.Persistence.EFCore;
using Microsoft.AspNetCore.Mvc;
using Newtonsoft.Json.Linq;

[Route("breeze/[controller]/[action]")]
[BreezeQueryFilter]
public class NorthwindIBModelController : Controller {
  private readonly NorthwindPersistenceManager persistenceManager;

  public NorthwindIBModelController(NorthwindIBContext context) {
    persistenceManager = new NorthwindPersistenceManager(context);
  }

  [HttpGet]
  public IActionResult Metadata() => Ok(persistenceManager.Metadata());

  [HttpGet]
  public IQueryable<Customer> Customers() => persistenceManager.Context.Customers;

  [HttpPost]
  public Task<SaveResult> SaveChanges([FromBody] JObject saveBundle) =>
    persistenceManager.SaveChangesAsync(saveBundle);
}

public class NorthwindPersistenceManager : EFPersistenceManager<NorthwindIBContext> {
  public NorthwindPersistenceManager(NorthwindIBContext context) : base(context) { }
}
```

With this controller, `new EntityManager('breeze/NorthwindIBModel')` fetches metadata from
`breeze/NorthwindIBModel/Metadata`, queries `breeze/NorthwindIBModel/Customers`, and
saves to `breeze/NorthwindIBModel/SaveChanges`.

The server uses Newtonsoft.Json, with Breeze's serializer settings:

```csharp
using Breeze.Core;

services.AddControllers().AddNewtonsoftJson(options =>
  JsonSerializationFns.UpdateWithDefaults(options.SerializerSettings));
```

Among other things, `UpdateWithDefaults` sets up the `$id`, `$ref` and `$type`
properties that the client's JSON reader relies on. It also turns off ASP.NET Core's
default camel-casing, so property names stay PascalCase on the wire. The client's default
naming convention, `NamingConvention.camelCase`, translates them.

If a query endpoint should also accept `query.usePost()`, give the action `[HttpPost]` as
well as `[HttpGet]`, and set `[BreezeQueryFilter(UsePost = true)]`.

The [breeze-server-v3 README](https://github.com/Breeze/breeze-server-v3#readme) covers
packages, building, and upgrading from the 7.x server.

## Other servers

Breeze 2.x also had Node.js and Java servers. They are not covered
here, and have not been verified with Breeze 3.

`DataServiceWebApiAdapter` works with any server that speaks the same JSON as the Breeze
.NET server. For anything else, write a data service adapter — see
[DataServiceAdapter](/server/dataserviceadapter).
