# Querying the cache

An `EntityManager` is both a gateway to the server and a cache of entities. Entities enter
the cache when you:

- query the server
- create or attach entities — see [Creating entities](/guide/creating-entities)
- import entities from another manager or from storage — see
  [Export and import](/guide/export-import)

This page covers the ways to get them back out without a round trip.

## executeQueryLocally

`executeQueryLocally` runs an ordinary `EntityQuery` against the cache. It is synchronous
and returns an array:

```ts
import { EntityQuery } from 'breeze-client';

// Customers whose names begin with 'c'
const query = EntityQuery.from('Customers').where('companyName', 'startsWith', 'c');

const { results } = await em.executeQuery(query);   // server — async
const cached = em.executeQueryLocally(query);        // cache — immediate
```

`EntityQuery.executeLocally` does the same, for a query that already has a manager:

```ts
const cached = query.using(em).executeLocally();
```

A local query applies `where`, `orderBy`, `skip`, `take` and `select`. It does not need
`expand`, because the navigation properties of cached entities are already wired.

What it includes:

- **Unsaved entities.** A new `Customer` you have added matches just as a saved one does.
- **Subtypes.** A query for a base type also returns cached instances of its derived types.

What it leaves out:

- **Deleted entities.** Entities marked for deletion are skipped unless you set
  `includeDeleted` (see [QueryOptions](#queryoptions)).
- **Anything not in the cache.** A local query only sees what earlier queries,
  `createEntity` or imports have put there. It never goes to the server.

A local query needs metadata. If the manager has none, it throws:

```
There is no metadata available for this query. Are you querying the local cache before you've fetched metadata?
```

Call `await em.fetchMetadata()` first, or run any server query.

## The get… methods

Three methods read the cache directly without building a query. All are synchronous.

### getEntityByKey

```ts
import { EntityKey } from 'breeze-client';

const nancy = em.getEntityByKey('Employee', 1);

const key = new EntityKey(em.metadataStore.getAsEntityType('Employee'), 2);
const andrew = em.getEntityByKey(key);
```

Returns `null` if the entity is not cached.

### getEntities

Get entities by type, by state, or both:

```ts
import { EntityState } from 'breeze-client';

const customers = em.getEntities('Customer');
const everything = em.getEntities();

// deleted entities are excluded from query results, but you can find them here
someCustomer.entityAspect.setDeleted();
const deleted = em.getEntities('Customer', EntityState.Deleted);
```

Unlike a local query, `getEntities` returns **only the types you name**, not their
subtypes. To include derived types, ask the base type for them:

```ts
const baseType = em.metadataStore.getAsEntityType('Order');
const allOrders = em.getEntities(baseType.getSelfAndSubtypes());
```

### getChanges

`getChanges()` returns every entity with unsaved changes, and `getChanges('Customer')` or
`getChanges(['Customer', 'Order'])` narrows it by type. You might check these in pre-save
logic. You might also back them up so the user's work survives a crash:

```ts
const backup = em.exportEntities(em.getChanges());
localStorage.setItem('backup', backup as string);

// later
em.importEntities(localStorage.getItem('backup')!);
```

See [Export and import](/guide/export-import).

## Querying the cache asynchronously

Sometimes you do not know until runtime whether a query should go to the server. For
example, a service may fall back to the cache when the app is offline. Keep the async
shape and change the query's `FetchStrategy`:

```ts
import { EntityQuery, FetchStrategy } from 'breeze-client';

async function getCustomersStartingWith(text: string) {
  let query = EntityQuery.from('Customers').where('companyName', 'startsWith', text);
  if (isOffline()) {
    query = query.using(FetchStrategy.FromLocalCache);
  }
  const { results } = await em.executeQuery(query);
  return results;
}
```

With `FetchStrategy.FromLocalCache`, `executeQuery` runs the query against the cache and
resolves with a `QueryResult` that has `results`, `query`, `entityManager` and, if you asked
for it, `inlineCount`. It has no `httpResponse`.

One difference from `executeQueryLocally`: if the manager has no metadata yet,
`executeQuery` fetches it from the server first, even with `FromLocalCache`.

You can switch the whole manager:

```ts
em.setProperties({ queryOptions: em.queryOptions.using(FetchStrategy.FromLocalCache) });

await em.executeQuery(query);   // now runs against the cache
```

## QueryOptions

A `QueryOptions` holds three settings:

| Property | Values | Default |
|---|---|---|
| `fetchStrategy` | `FetchStrategy.FromServer`, `FetchStrategy.FromLocalCache` | `FromServer` |
| `mergeStrategy` | see below | `MergeStrategy.PreserveChanges` |
| `includeDeleted` | `boolean` — include entities marked for deletion | `false` |

Set them on a query, on a manager, or as the global default:

```ts
import { FetchStrategy, MergeStrategy, QueryOptions } from 'breeze-client';

// one query
query.using(FetchStrategy.FromLocalCache);
query.using(MergeStrategy.OverwriteChanges);
query.using(new QueryOptions({ includeDeleted: true }));

// one manager
em.queryOptions = new QueryOptions({ mergeStrategy: MergeStrategy.OverwriteChanges });

// everywhere
new QueryOptions({ mergeStrategy: MergeStrategy.OverwriteChanges }).setAsDefault();
```

`queryOptions.using(...)` returns a copy with changes applied, and never modifies the
original. A setting not given on the query comes from the manager, then from
`QueryOptions.defaultInstance`.

The `MergeStrategy` decides what happens when a query returns an entity that is already
in the cache:

| MergeStrategy | Effect |
|---|---|
| `PreserveChanges` | Update the cached entity, unless it has unsaved changes, in which case keep them |
| `OverwriteChanges` | Always update it. Pending changes are lost |
| `SkipMerge` | Ignore the incoming values. Only entities not already cached are added |
| `Disallowed` | Throw if an incoming entity is already cached |

## When a local query fails: resource names

The name you pass to `from()` is a **resource name**, the server endpoint. It is not
necessarily an entity type name. A local query needs to know which type the resource
returns. Breeze knows this for the default resource of each type, such as `Customers` →
`Customer`, but not for custom endpoints:

```ts
const query = EntityQuery.from('CustomersAndOrders');

await em.executeQuery(query);    // fine — the server's payload identifies the type
em.executeQueryLocally(query);   // throws
```

```
Cannot find an entityType for resourceName: 'CustomersAndOrders'. Add 'EntityQuery.toType()' to your query, or call 'MetadataStore.setEntityTypeForResourceName()' to register an EntityType for this resourceName.
```

Do either of those:

```ts
// for one query
em.executeQueryLocally(EntityQuery.from('CustomersAndOrders').toType('Customer'));

// once, for every query
em.metadataStore.setEntityTypeForResourceName('CustomersAndOrders', 'Customer');
```

## Fetching an entity by key

To get an entity by key from the server, use `fetchEntityByKey` rather than writing the
query:

```ts
const { entity } = await em.fetchEntityByKey('Employee', employeeID);
```

It resolves with `{ entity, entityKey, fromCache }`. `entity` is `undefined` if nothing
matched.

Pass `true` as the last argument to look in the cache first. Breeze goes to the server
only if the entity is not there:

```ts
const { entity, fromCache } = await em.fetchEntityByKey('Employee', employeeID, true);
```

The first call makes a request, and later calls return the cached entity. The call also
accepts an `EntityType` or an `EntityKey` in place of the type name.

## Combining server and cache results

Apart from `fetchEntityByKey`, a query runs either remotely or locally. To get both, you
can show the server's latest data alongside the user's unsaved additions. Run it
remotely, then run it again against the cache:

```ts
const query = EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'A')
  .orderBy('companyName')
  .using(em);

// an unsaved customer, in the cache only
em.createEntity('Customer', { companyName: 'Acme' });

await query.execute();   // server rows are now cached; ignore these results
const { results } = await query.using(FetchStrategy.FromLocalCache).execute();
// the server's 'A' customers, plus Acme
```

The second query sees everything the first one brought into the cache, and the new
customer that was already there.

### Pending changes survive the re-query

Now suppose Anne is already cached, and the user has renamed her 'Charlene' without
saving. The server query for 'A' employees still matches Anne on her saved name, so she
comes back with the remote results. Under the default `MergeStrategy.PreserveChanges`, the
merge **keeps** the user's 'Charlene'. The local re-query compares against the current
value, so it leaves her out.

Usually that is what you want. You can refresh from the server without losing unsaved
work, and a list of 'A' names does not show someone called Charlene. If you do want
database values to win, run the remote query with `MergeStrategy.OverwriteChanges`.

## String comparison: LocalQueryComparisonOptions

On the server, the database decides how strings compare. SQL Server is usually
case-insensitive and ignores trailing spaces. In the cache, Breeze follows the manager's
`MetadataStore.localQueryComparisonOptions`, so local results can match what the server
would return.

| Property | Default | Effect |
|---|---|---|
| `isCaseSensitive` | `false` | Case-sensitive `==`, `!=`, `startsWith`, `endsWith`, `contains` and `orderBy` |
| `usesSql92CompliantStringComparison` | `true` | Trim whitespace before `==` and `!=` comparisons (not `startsWith` and the like) |

The default is `LocalQueryComparisonOptions.caseInsensitiveSQL`. If your database
compares strings differently, define your own. Apply it globally with `setAsDefault()`, or
give it to a `MetadataStore`:

```ts
import { EntityManager, LocalQueryComparisonOptions, MetadataStore } from 'breeze-client';

const caseSensitive = new LocalQueryComparisonOptions({
  name: 'caseSensitive-nonSQL',
  isCaseSensitive: true,
  usesSql92CompliantStringComparison: false,
});

// every MetadataStore created from now on
caseSensitive.setAsDefault();

// or one store
const metadataStore = new MetadataStore({ localQueryComparisonOptions: caseSensitive });
const em = new EntityManager({ serviceName: '/breeze/NorthwindIBModel', metadataStore });
```

Always pass `usesSql92CompliantStringComparison`: the constructor throws if it is missing.

If imported metadata names a comparison options set, the import applies that set to an
empty store, replacing yours. Metadata exported by Breeze does this. To force your own,
assign `metadataStore.localQueryComparisonOptions` after the import.

## See also

- [EntityManager and caching](/guide/entitymanager-and-caching)
- [`EntityManager`](/api/classes/EntityManager), [`QueryOptions`](/api/classes/QueryOptions),
  [`FetchStrategy`](/api/classes/FetchStrategy), [`MergeStrategy`](/api/classes/MergeStrategy),
  [`LocalQueryComparisonOptions`](/api/classes/LocalQueryComparisonOptions)
