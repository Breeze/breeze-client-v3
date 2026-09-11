# Metadata

Before Breeze can treat your data as entities, it needs a description of it: which types
exist, their properties and data types, which properties make up the key, and how the
types relate to each other. That description is *metadata*, and it lives in a
`MetadataStore`.

Breeze uses metadata to:

- turn query results into entities and cache them by key
- create new entities with `createEntity`
- wire navigation properties from foreign keys
- validate property values
- translate property names between client and server
- work out which type a resource name returns, for [queries against the cache](/query/locally)

## Where metadata comes from

There are three sources, and you can combine them:

| Source | Use it when |
|---|---|
| The server | You have a Breeze .NET server. This is the default. |
| A JSON file | You want metadata at startup, offline or in tests, without a round trip. |
| Written by hand | The server can't supply metadata: a non-.NET backend, or a third-party API. |

### From the server

By default an `EntityManager` asks its service for metadata before its first query:

```ts
import { EntityManager, EntityQuery } from 'breeze-client';

const em = new EntityManager('/breeze/NorthwindIBModel');

// Fetches /breeze/NorthwindIBModel/Metadata first, then runs the query.
const { results } = await em.executeQuery(EntityQuery.from('Customers'));
```

If you need metadata before you query (to create entities first thing, say), fetch it
yourself:

```ts
await em.fetchMetadata();
const customer = em.createEntity('Customer', { companyName: 'Acme' });
```

A store fetches metadata for a given service only once. `fetchMetadata` rejects if the
store already has it, so check `em.metadataStore.hasMetadataFor(serviceName)` when you
aren't sure. Queries do this check for you.

Several managers can share one store:

```ts
const em2 = new EntityManager({
  serviceName: '/breeze/NorthwindIBModel',
  metadataStore: em.metadataStore,
});
```

### From a file, or by hand

To skip the server request, give the manager a `DataService` with
`hasServerMetadata: false` and fill the store yourself: either with `importMetadata`, from
JSON you saved earlier, or with `addEntityType`. Both are covered in
[Writing metadata by hand](/metadata/by-hand).

## CSDL and EDMX are not supported

::: warning Changed in 3.0
Breeze 3 reads **Breeze native JSON metadata only**. That is the format the Breeze .NET
server sends and `MetadataStore.exportMetadata()` writes, described in
[Metadata in depth](/metadata/details).

`importMetadata()` no longer detects or parses CSDL, the OData / EDMX metadata format, and
`DataType.fromEdmDataType` is gone. Instead, CSDL is rejected with a clear error: an object
with a `schema` property and no `structuralTypes` makes `importMetadata()` throw *This
looks like CSDL (OData / EDMX) metadata, which breeze-client 3 does not read*. So if you
point Breeze 3 at an OData `$metadata` endpoint, or at an older WebApi2 + EF6 server that
emits CSDL, the first metadata fetch fails with that message, prefixed by *Unable to
either parse or import metadata*.

If your metadata is CSDL, move the server to Breeze .NET Core (which emits native JSON).
Or, while you are still on Breeze 2.x, load the CSDL once, call `exportMetadata()`, and
check the resulting JSON in; Breeze 3 can [import that file](/metadata/by-hand#loading-metadata-from-a-json-file).
See [Migrating from 2.x](/guide/migrating-from-2x).
:::

## On the server

The Breeze .NET server builds metadata from your EF Core model. `EFPersistenceManager`
reads the `DbContext`'s model, not the database. The controller exposes the result as a
`Metadata` action, which is where the client looks (`<serviceName>/Metadata`):

```csharp
[Route("breeze/[controller]/[action]")]
[BreezeQueryFilter]
public class NorthwindIBModelController : Controller {
  private readonly NorthwindPersistenceManager persistenceManager;

  public NorthwindIBModelController(NorthwindIBContext_CF context) {
    persistenceManager = new NorthwindPersistenceManager(context);
  }

  [HttpGet]
  public IActionResult Metadata() {
    return Ok(persistenceManager.Metadata());
  }

  // query and SaveChanges actions ...
}

public class NorthwindPersistenceManager : EFPersistenceManager<NorthwindIBContext_CF> {
  public NorthwindPersistenceManager(NorthwindIBContext_CF dbContext) : base(dbContext) { }
}
```

The server writes property names as they are in C# (`CompanyName`) and does not send a
naming convention. The client's naming convention produces the client-side names: the
default, `NamingConvention.camelCase`, turns `CompanyName` into `companyName`. See
[Naming conventions](/server/namingconvention).

`Breeze.Persistence.NH` does the same for NHibernate. A server with neither, or a
third-party service, sends no metadata. Write it [by hand](/metadata/by-hand) or ship it
as a JSON file.

## Looking at metadata at runtime

Everything in the store is available to your code:

```ts
import { DataType } from 'breeze-client';

const orderType = em.metadataStore.getAsEntityType('Order')!;

orderType.name;                                // 'Order:#Foo' - shortName:#namespace
orderType.keyProperties.map(p => p.name);      // ['orderID']
orderType.getProperty('customer');             // a NavigationProperty
orderType.getDataProperty('orderDate').dataType === DataType.DateTime;   // true
```

`getAsEntityType` and `getAsComplexType` accept a short name (`'Order'`) or a qualified
one (`'Order:#Foo'`), and throw if the type isn't there. Pass `true` as the second
argument to get `null` instead.

The classes involved:

| Class | Describes |
|---|---|
| [`MetadataStore`](/api/classes/MetadataStore) | the whole model, plus the data services it came from |
| [`EntityType`](/api/classes/EntityType) | a type with a key, which Breeze caches and tracks |
| [`ComplexType`](/api/classes/ComplexType) | a keyless value type embedded in an entity (see [Complex properties](/guide/complex-properties)) |
| [`DataProperty`](/api/classes/DataProperty) | a property holding a value, or a complex object |
| [`NavigationProperty`](/api/classes/NavigationProperty) | a property returning a related entity or entities |
| [`DataType`](/api/classes/DataType) | the data type of a `DataProperty` |
| [`AutoGeneratedKeyType`](/api/classes/AutoGeneratedKeyType) | how new keys are assigned |

## In this section

- [Metadata in depth](/metadata/details): the JSON format, property by property
- [Writing metadata by hand](/metadata/by-hand): `addEntityType`, and loading metadata from a JSON file
- [Custom metadata](/metadata/custom): attaching your own information to types and properties
