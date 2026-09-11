# Querying

A Breeze query is an `EntityQuery`. It describes what you want: which resource, which
rows, in what order, and which related entities to bring back. An `EntityManager` runs it,
either against the server or against its own cache.

```ts
import { EntityManager, EntityQuery } from 'breeze-client';

const em = new EntityManager('breeze/NorthwindIBModel');

const query = EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'B')
  .orderBy('companyName')
  .take(10);

const { results } = await em.executeQuery(query);
```

The results are entities. They are now in the manager's cache, tracking their own changes,
with navigation properties wired to any related entities already cached.

The rest of this section covers:

- [Query examples](/query/examples) — a catalogue of common queries
- [Where clauses](/query/predicates) — filtering, `Predicate`, operators, any/all, JSON syntax
- [Ordering, paging and expand](/query/shaping) — `orderBy`, `skip`/`take`, `inlineCount`,
  `expand`, `withParameters`, `noTracking` and query options
- [Projections](/query/projections) — `select`
- [Querying the cache](/query/locally) — `executeQueryLocally` and `FetchStrategy`
- [Debugging queries](/query/debugging)

## Executing a query

`executeQuery` returns a promise of a [`QueryResult`](/api/interfaces/QueryResult):

| Property | Contents |
|---|---|
| `results` | the top-level results: entities, or plain objects for a projection |
| `inlineCount` | the total number of matches ignoring `skip`/`take`, if you asked for it — see [Paging](/query/shaping#paging) |
| `retrievedEntities` | every entity the query returned, including those brought in by `expand` |
| `query` | the query that ran |
| `entityManager` | the manager that ran it |
| `httpResponse` | the raw HTTP response |

A failed query rejects the promise:

```ts
try {
  const { results } = await em.executeQuery(query);
  showCustomers(results);
} catch (err) {
  console.error('Query failed:', err.message);
}
```

A query can also carry its manager, set with `using`, and run itself:

```ts
const { results } = await EntityQuery.from('Orders').using(em).execute();
```

`execute()` throws if the query has no manager.

## Queries are immutable

Every `EntityQuery` method returns a new query. The original is unchanged, so you can keep
a base query and derive others from it:

```ts
const bigOrders = EntityQuery.from('Orders').where('freight', '>', 100);

const firstPage = bigOrders.orderBy('orderDate').take(20);
const toGermany = bigOrders.where('shipCountry', '==', 'Germany');
// bigOrders itself still has only the freight condition
```

## What goes over the wire

The `uriBuilder` adapter turns a query into a URL. Breeze 3 ships one, `UriBuilderJsonAdapter`,
and uses it by default (see [Configuration](/guide/configuration)). It serializes the query as Breeze JSON,
translates property names to their server names with the
[naming convention](/server/namingconvention), URL-encodes the JSON, and makes the result
the query string.

The query above becomes a GET to `breeze/NorthwindIBModel/Customers?%7B%22where%22...`.
Decoded, the query string is:

```json
{"where":{"CompanyName":{"startswith":"B"}},"orderBy":["CompanyName"],"take":10}
```

On a Breeze .NET server, the `[BreezeQueryFilter]` attribute reads that JSON and applies
it to the `IQueryable` your controller method returns:

```csharp
[HttpGet]
[BreezeQueryFilter]
public IQueryable<Customer> Customers() {
  return PersistenceManager.Context.Customers;
}
```

The attribute can also go on the controller class, which applies it to every method.

To see the JSON for a query without sending it, call `query.toJSON()`. It returns the same
structure, but with client property names and the resource name included. See
[Debugging queries](/query/debugging).

::: tip Changed in 3.0
The OData URI builder is gone, so queries no longer produce `$filter`, `$orderby` or
`$expand`. If you inspect requests, expect the JSON above. Servers that only understand
OData query syntax are not supported; stay on 2.x for those.
:::

### Sending the query in a POST body

A very long query can exceed URL length limits. `usePost()` sends the same JSON as the body
of a POST instead:

```ts
const query = EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'Alfreds')
  .usePost();
```

The server endpoint must accept POST and tell `BreezeQueryFilter` to read the body:

```csharp
[HttpGet, HttpPost]
[BreezeQueryFilter(UsePost = true)]
public IQueryable<Customer> Customers() {
  return PersistenceManager.Context.Customers;
}
```

## Resource names

Every query needs a target **resource**. These three are the same:

```ts
EntityQuery.from('Orders');
new EntityQuery('Orders');
new EntityQuery().from('Orders');
```

### From resource name to URL

Breeze prefixes the resource name with the service name of the query's `DataService`. With
a service name of `breeze/NorthwindIBModel`, `'Orders'` becomes `breeze/NorthwindIBModel/Orders`.
The manager normally supplies the `DataService`. Use `query.using(dataService)` to send a
single query somewhere else.

If the resource name starts with `http`, Breeze uses it as the URL as is:

```ts
EntityQuery.from('https://api.example.com/breeze/Northwind/Orders');
```

Breeze still appends the query JSON to that URL, joined with `&` if the URL already has a
query string.

### From resource name to EntityType

Breeze does not *have* to know which `EntityType` a remote query returns. The server might
return `Order` entities from any of these, and Breeze recognises them when the results
arrive:

```ts
EntityQuery.from('Orders');
EntityQuery.from('OrdersAndDetails');   // a custom endpoint
EntityQuery.from('https://api.example.com/breeze/Northwind/Orders');
```

It helps if Breeze knows the type in advance, because then it can check property names and
convert values before sending. Consider a date comparison written as a string:

```ts
EntityQuery.from('Orders').where('orderDate', '>=', 'January 1, 1998');
```

Breeze knows `'Orders'` returns `Order`. It looks up `orderDate`, sees that it is a
`DateTime`, and parses the string:

```json
{"where":{"OrderDate":{"ge":"1998-01-01T08:00:00.000Z"}}}
```

(The string was parsed in the client's local time zone, UTC-8 here. Pass a `Date` if that
matters to you.)

Target a resource Breeze does not recognise and it sends the string unchanged. The server
will probably reject it:

```json
{"where":{"OrderDate":{"ge":"January 1, 1998"}}}
```

Tell Breeze the type with `toType`:

```ts
EntityQuery.from('OrdersAndDetails')
  .where('orderDate', '>=', 'January 1, 1998')
  .toType('Order');
```

### Default resource names

Breeze knew `'Orders'` meant `Order` because of the metadata. Each entity type has a
`defaultResourceName`:

```ts
const orderType = em.metadataStore.getAsEntityType('Order');
orderType.defaultResourceName;   // "Orders"
```

A Breeze .NET server sets it from the `DbContext` collection name, which is usually the
plural of the type name and usually also the name of your controller method. If you write
[metadata by hand](/metadata/by-hand), you set it yourself.

### The type name is not a resource name

`'Order'` (the type) is not `'Orders'` (the resource). This query sends the date string
unconverted, exactly as the `'OrdersAndDetails'` query did:

```ts
EntityQuery.from('Order').where('orderDate', '>=', 'January 1, 1998');
```

For a query against the [cache](/query/locally) the distinction is stricter. There is no
endpoint there, so the resource name **must** resolve to an entity type, or the query
throws:

```
Cannot find an entityType for resourceName: 'Order'. Add 'EntityQuery.toType()' to your
query, or call 'MetadataStore.setEntityTypeForResourceName()' to register an EntityType
for this resourceName.
```

### Registering more resource names

To use other names without adding `toType` each time, register them with the
`MetadataStore`. The **resource name comes first**:

```ts
const store = em.metadataStore;
store.setEntityTypeForResourceName('Order', 'Order');
store.setEntityTypeForResourceName('OrdersAndDetails', 'Order');
```

Now `EntityQuery.from('Order')` works remotely and against the cache.

`getEntityTypeNameForResourceName` goes the other way. It returns the namespace-qualified
type name, or `undefined` if the name is not registered:

```ts
store.getEntityTypeNameForResourceName('Orders');   // "Order:#<your model namespace>"
```

There is no public API that lists every registered resource name.

## Other ways to build a query

`EntityQuery` has static factories for common cases. They are covered with examples in
[Query examples](/query/examples#by-key):

| Method | Builds a query for |
|---|---|
| `EntityQuery.fromEntityKey(key)` | the entity with that `EntityKey` |
| `EntityQuery.fromEntities(entities)` | fresh copies of entities you already have (all the same type) |
| `EntityQuery.fromEntityNavigation(entity, navProp)` | the entities at the end of a navigation property |

See the [`EntityQuery` API reference](/api/classes/EntityQuery) for the full surface.
