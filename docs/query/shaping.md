# Ordering, paging and expand

These query methods control the order of the results, which page of them comes back, and
which related entities come with them. This page also covers passing parameters to custom
endpoints, `noTracking` queries, and query options.

For filtering see [Where clauses](/query/predicates). For `select` see
[Projections](/query/projections).

## Ordering

`orderBy` takes a comma-separated string or an array of property paths. Add ` desc` to a
path to sort it in descending order. ` asc` is allowed but is the default.

```ts
import { EntityQuery } from 'breeze-client';
import { Customer, Employee, Order, Product } from './model';   // your generated classes

EntityQuery.from(Product).orderBy('productName');
EntityQuery.from(Product).orderBy('productName desc');
EntityQuery.from(Product).orderBy('unitPrice desc, productName');
EntityQuery.from(Product).orderBy(['unitPrice desc', 'productName']);

// Paths through navigation properties work too
EntityQuery.from(Product).orderBy('category.categoryName');
```

`orderByDesc` sorts every path it is given in descending order. So does `orderBy` with
`true` as its second argument, which overrides any ` desc` or ` asc` in the paths:

```ts
EntityQuery.from(Product).orderByDesc('productName');
EntityQuery.from(Product).orderBy('unitPrice, productName', true);   // both descending
```

Calling `orderBy` again adds sort keys after the existing ones:

```ts
// Category name ascending, then product name descending
EntityQuery.from(Product)
  .orderBy('category.categoryName')
  .orderByDesc('productName');
```

`orderBy()` with no argument removes all ordering.

A second word other than `asc` or `desc` throws immediately. An unknown property fails when
the query is validated against metadata, with `unable to locate property: ...`.

On the wire, ordering is a list of server property paths:

```json
{"orderBy":["UnitPrice desc","ProductName"]}
```

## Paging

`take(n)` returns at most *n* results. `top(n)` is a synonym. `skip(n)` skips the first *n*.

```ts
const pageSize = 10;

function pageOfProducts(pageIndex: number) {
  return EntityQuery.from(Product)
    .orderBy('productName')
    .skip(pageIndex * pageSize)
    .take(pageSize);
}
```

Always add an `orderBy` when you page. Breeze does not require it, but without it the
server's row order is not guaranteed, and pages can overlap or skip rows.

`take()` and `skip()` with no argument remove an existing take or skip. This is useful when
a function receives a query it did not build:

```ts
function withoutPaging(query: EntityQuery) {
  return query.take().skip();
}
```

A Breeze .NET server can cap how many rows an endpoint returns. `MaxTake` applies a take
when the query has none, or has a larger one:

```csharp
[HttpGet]
[BreezeQueryFilter(MaxTake = 2000)]
public IQueryable<Order> Orders() { ... }
```

### inlineCount

`inlineCount()` asks the server for the total number of rows that match the where clause,
before any `skip` or `take`. The count arrives as `inlineCount` on the query result:

```ts
const query = EntityQuery.from(Product)
  .where('productName', 'startsWith', 'C')
  .orderBy('productName')
  .skip(5)
  .take(5)
  .inlineCount();

const { results, inlineCount } = await em.executeQuery(query);
// results:     one page, 0 to 5 products starting with "C"
// inlineCount: how many products start with "C" in total
```

Without `inlineCount()`, the result's `inlineCount` is undefined. `inlineCount(false)`
turns it off again. [Cache queries](/query/locally) ignore it.

#### Getting just the count

Breeze has no aggregate queries, but `take(0)` with `inlineCount()` returns a count and no
rows:

```ts
const query = EntityQuery.from(Product)
  .where('productName', 'startsWith', 'C')
  .take(0)
  .inlineCount();

const { inlineCount } = await em.executeQuery(query);
```

## Expand

`expand` brings related entities back in the same response. Give it navigation property
names, as a comma-separated string or an array. Use a dot to go more than one level deep:

```ts
// Customers starting with "C", with their orders
EntityQuery.from(Customer)
  .where('companyName', 'startsWith', 'C')
  .expand('orders');

// Orders with their customer and their employee
EntityQuery.from(Order).expand('customer, employee');
EntityQuery.from(Order).expand(['customer', 'employee']);

// Orders with their details and each detail's product
EntityQuery.from(Order).expand('orderDetails.product');
```

The where clause filters the root entities first. `expand` then brings back what is related
to them. It does not filter the related entities.

Expanded entities are merged into the cache and wired to their navigation properties, just
like the root results. They are not in `results`, which holds only the root entities. They
are in `retrievedEntities`:

```ts
const { results, retrievedEntities } = await em.executeQuery(
  EntityQuery.from(Order).take(20).expand('customer')
);
// results:           20 orders
// retrievedEntities: those orders plus their customers
```

`expand()` with no argument removes the expand clause. An unknown navigation property
fails validation with `unable to locate property: ...`.

A Breeze .NET server can limit expand depth. With `[BreezeQueryFilter(MaxDepth = 2)]`,
`'orderDetails.product'` is allowed but a third level is not, and the server answers
`400 Bad Request` with `MaxDepth exceeded: ...`.

Expanding a collection can make a large response. Loading related entities on demand is
often better. See [Related entities on demand](/query/examples#related-entities-on-demand).

On the wire:

```json
{"expand":["Customer","OrderDetails.Product"],"take":20}
```

## Passing parameters to the server

Some endpoints take their own arguments. `withParameters` passes them:

```ts
const query = EntityQuery.from('EmployeesFilteredByCountryAndBirthdate')
  .withParameters({ birthDate: new Date(1960, 0, 1), country: 'USA' });
```

```csharp
[HttpGet]
public IQueryable<Employee> EmployeesFilteredByCountryAndBirthdate(DateTime birthDate, string country) {
  return PersistenceManager.Context.Employees
    .Where(emp => emp.BirthDate >= birthDate && emp.Country == country);
}
```

Breeze adds each parameter to the URL as an ordinary query-string argument, spelled as you
wrote it, so the names must match the server method's parameter names. `Date` values are
sent as ISO strings. Arrays are sent as `name[0]=...&name[1]=...`, which ASP.NET Core binds
to an array parameter marked `[FromQuery]`:

```ts
const query = EntityQuery.from('SearchEmployees')
  .withParameters({ employeeIds: [1, 4] });
```

```csharp
[HttpGet]
public IQueryable<Employee> SearchEmployees([FromQuery] int[] employeeIds) {
  var query = PersistenceManager.Context.Employees.AsQueryable();
  if (employeeIds.Length > 0) {
    query = query.Where(emp => employeeIds.Contains(emp.EmployeeID));
  }
  return query;
}
```

If the method returns an `IQueryable` and has `[BreezeQueryFilter]` (on the method or the
controller), the rest of the query is applied on top of it. You can filter, sort and page
the results of a parameterized endpoint:

```ts
EntityQuery.from('EmployeesFilteredByCountryAndBirthdate')
  .withParameters({ birthDate: new Date(1960, 0, 1), country: 'USA' })
  .where('lastName', 'startsWith', 'S')
  .orderBy('birthDate');
```

A query holds one set of parameters. Calling `withParameters` again replaces the earlier
set; it does not merge with it.

`query.toJSON()` writes the parameters under `parameters`, so a serialized query keeps
them. They are not part of the query JSON sent to the server; they travel only as the
query-string arguments described above.

## noTracking

`noTracking()` makes a query return plain JavaScript objects instead of entities. They are
not added to the cache, and entities already in the cache are not updated. Such queries are
faster than tracked ones, so they suit read-only data.

```ts
const query = EntityQuery.from(Order)
  .where('customer.companyName', 'startsWith', 'C')
  .expand('customer')
  .noTracking();

const { results } = await em.executeQuery(query);
// results: plain objects, each with a plain 'customer' object
```

Breeze still does some of the work it does for entities:

- property names are converted from server to client names
- values are converted to their data types (dates become `Date` objects, for example)
- objects that appear more than once in the response are resolved to the same object

`expand` works, and nests the related data as plain objects. `noTracking(false)` turns it
off again.

### Turning results into entities later

You can make entities from some of the results later and attach them to a manager:

```ts
import { EntityState, MergeStrategy } from 'breeze-client';

const empType = em.metadataStore.getAsEntityType('Employee');
const { results: rawEmps } = await em.executeQuery(
  EntityQuery.from(Employee).noTracking()
);

const employees = rawEmps.map(raw => {
  const emp = empType.createEntity(raw);
  // returns the cached employee instead, if one with this key is already there
  return em.attachEntity(emp, EntityState.Unchanged, MergeStrategy.SkipMerge);
});
```

## Query options

A [`QueryOptions`](/api/classes/QueryOptions) object controls how a query runs:

| Option | Values | Default |
|---|---|---|
| `fetchStrategy` | [`FetchStrategy`](/api/classes/FetchStrategy): `FromServer`, `FromLocalCache` | `FromServer` |
| `mergeStrategy` | [`MergeStrategy`](/api/classes/MergeStrategy): `PreserveChanges`, `OverwriteChanges`, `SkipMerge` | `PreserveChanges` |
| `includeDeleted` | whether cached entities marked for deletion are included | `false` |

The merge strategy decides what happens when a queried entity is already in the cache:

- `PreserveChanges` updates the cached entity, unless it has unsaved changes. In that case
  it is left alone.
- `OverwriteChanges` always updates it, discarding unsaved changes.
- `SkipMerge` leaves the cached entity as it is. It is the fastest, but the cached data can
  be stale.

Set a strategy for one query with `using`:

```ts
import { FetchStrategy, MergeStrategy } from 'breeze-client';

query.using(MergeStrategy.OverwriteChanges);
query.using(FetchStrategy.FromLocalCache);
```

Or for every query a manager runs:

```ts
import { EntityManager, MergeStrategy, QueryOptions } from 'breeze-client';

const em = new EntityManager({
  serviceName: 'breeze/NorthwindIBModel',
  queryOptions: new QueryOptions({ mergeStrategy: MergeStrategy.OverwriteChanges }),
});
```

A query's own options take precedence over the manager's, and the manager's over
`QueryOptions.defaultInstance`.

`FetchStrategy.FromLocalCache` runs the query against the cache, asynchronously. See
[Querying the cache](/query/locally). For more on merging, see
[EntityManager and caching](/guide/entitymanager-and-caching).
