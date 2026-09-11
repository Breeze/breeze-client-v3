# Projections

A projection query asks the server for selected properties instead of whole entities.
Use it when you need a few columns from a wide table. For example, a pick list of
customer names should not download every column of every customer.

```ts
import { EntityQuery } from 'breeze-client';

const query = EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'C')
  .select('customerID, companyName, contactName')
  .orderBy('companyName');

const { results } = await em.executeQuery(query);
// results[0] → { customerID: '…', companyName: 'Cactus Comidas para llevar', contactName: '…' }
```

`select` takes a comma-separated string or an array of property paths:

```ts
query.select('companyName, city');
query.select(['companyName', 'city']);
```

Write client-side property names. Breeze translates them to server names through the
[naming convention](/server/namingconvention), and translates the names in the results
back.

## What comes back

A projection returns **plain objects**, not entities:

- they have no `entityAspect`
- they are not added to the cache
- changes to them are not tracked or saved

```ts
const [first] = (await em.executeQuery(
  EntityQuery.from('Customers').select('companyName'),
)).results;

first.companyName;   // 'Alfreds Futterkiste'
first.entityAspect;  // undefined
```

Selecting one property still gives you objects with that property, `{ companyName }`, not
bare strings.

## Data property projections

```ts
// Names of the customers that begin with 'C'
EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'C')
  .select('companyName');

// Selected properties of those customers
EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'C')
  .select('customerID, companyName, contactName')
  .orderBy('companyName');
```

The values are copied from the JSON as-is. Metadata does not describe a projection, so
Breeze does not convert its values to their data types, and **dates arrive as ISO
strings**. Convert them yourself:

```ts
import { DataType } from 'breeze-client';

const { results } = await em.executeQuery(
  EntityQuery.from('Orders').select('orderID, orderDate'),
);
const orderDate = DataType.parseDateFromServer(results[0].orderDate);  // Date
```

To do this for every result, use a [JsonResultsAdapter](/server/jsonresultsadapter).

## Related property projections

A property path can reach through a navigation property:

```ts
// Customers with orders that have excessive freight costs
const query = EntityQuery.from('Orders')
  .where('freight', '>', 500)
  .select('customer.companyName')
  .orderBy('customer.companyName');
```

The dot becomes an underscore in the result's property name.

::: warning Remote and local names differ
When a Breeze ASP.NET Core server runs this query, it names the property
`Customer_CompanyName`. The camelCase convention lowercases only the first letter, so
the client sees `customer_CompanyName`. When the same query runs
[against the cache](/query/locally), the result is named `customer_companyName`. If a
projection has to work both ways, read the property by its exact name, or map the
results to your own shape.
:::

## Navigation property projections

Select a navigation property and the projection contains the related **entities**:

```ts
// Orders of the customers whose names begin with 'C'
const { results } = await em.executeQuery(
  EntityQuery.from('Customers')
    .where('companyName', 'startsWith', 'C')
    .select('companyName, orders'),
);

results[0].companyName;          // string
results[0].orders;               // Order[] — real entities
results[0].orders[0].entityAspect.entityState.name;   // 'Unchanged'
```

A scalar navigation property works the same way:

```ts
EntityQuery.from('Orders')
  .where('customer.companyName', 'startsWith', 'C')
  .select('customer, orderDate');
// each result: { customer: Customer, orderDate: '…' }
```

The projection object is still not an entity and is not cached. The entities **inside**
it are merged into the cache like any other query results. They are tracked, and their
navigation properties are wired to other cached entities.

**Do not add `expand` to a projection.** The projected navigation property already brings
its entities. A Breeze ASP.NET Core server rejects `expand` combined with `select` with an
error such as `Unable to cast…`.

## Filling the cache in one request

Entities in a result are cached even when the result is not an entity itself. You can
use this to load several pick lists in one round trip. Write a server endpoint that
returns one object whose properties are collections of entities:

```csharp
// ASP.NET Core, in the Breeze controller
[HttpGet]
public object Lookups() {
  var regions = PersistenceManager.Context.Regions;
  var territories = PersistenceManager.Context.Territories;
  var categories = PersistenceManager.Context.Categories;

  return new { regions, territories, categories };
}
```

Query it like any other resource:

```ts
const { results } = await em.executeQuery(EntityQuery.from('Lookups'));
const lookups = results[0];

lookups.regions;               // Region entities
em.getEntities('Category');    // also in the cache now
```

Breeze does not recognise the bag as an entity. The Breeze .NET server marks each nested
object with its `$type`, and that is how Breeze recognises the entities and merges them.
One request fills the cache with every list.

## Projecting from the cache

`select` also works in [local queries](/query/locally). There, too, it returns plain
objects, and selected navigation properties return the cached entities themselves.

## See also

- [Query examples](/query/examples)
- [Ordering, paging and expand](/query/shaping)
- [`EntityQuery.select`](/api/classes/EntityQuery)
