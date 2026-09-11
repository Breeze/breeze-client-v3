# Query examples

A catalogue of common queries against the Northwind model. The details are covered in
[Where clauses](/query/predicates), [Ordering, paging and expand](/query/shaping) and
[Projections](/query/projections).

## Setup

Every example assumes Breeze is configured as in [Getting started](/guide/getting-started),
with `NamingConvention.camelCase`, and this manager:

```ts
import { EntityManager, EntityQuery, FilterQueryOp, Predicate } from 'breeze-client';

const em = new EntityManager('breeze/NorthwindIBModel');
```

## Basic queries

```ts
// Three equivalent queries for all customers
const q1 = EntityQuery.from('Customers');
const q2 = new EntityQuery('Customers');
const q3 = new EntityQuery().from('Customers');

try {
  const { results } = await em.executeQuery(q1);
  console.log(`${results.length} customers`);
} catch (err) {
  console.error(err.message);
}
```

## Filtering

### Simple conditions

```ts
// Customers whose names start with "A"
EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'A');

// ...the same, with the FilterQueryOp enum
EntityQuery.from('Customers')
  .where('companyName', FilterQueryOp.StartsWith, 'A');

// Orders with freight over $100
EntityQuery.from('Orders')
  .where('freight', '>', 100);

// ...the same, with the FilterQueryOp enum
EntityQuery.from('Orders')
  .where('freight', FilterQueryOp.GreaterThan, 100);

// Orders placed after February 1, 1998 (JavaScript months start at 0)
EntityQuery.from('Orders')
  .where('orderDate', '>', new Date(1998, 1, 1));

// Orders that have not shipped
EntityQuery.from('Orders')
  .where('shippedDate', '==', null);

// Orders shipped after they were due: compares two properties of the same order
EntityQuery.from('Orders')
  .where('shippedDate', '>', 'requiredDate');

// Customers whose name contains "market"
EntityQuery.from('Customers')
  .where('companyName', FilterQueryOp.Contains, 'market');

// Customers in either of two countries
EntityQuery.from('Customers')
  .where('country', 'in', ['Belgium', 'Germany']);
```

### Compound conditions with predicates

```ts
const baseQuery = EntityQuery.from('Orders');

// Freight over $100 AND ordered after April 1, 1998
const p1 = new Predicate('freight', '>', 100);
const p2 = new Predicate('orderDate', '>', new Date(1998, 3, 1));
baseQuery.where(p1.and(p2));

// ...AND them with the static method, passing an array
baseQuery.where(Predicate.and([p1, p2]));

// ...or fluently
baseQuery.where(
  Predicate.create('freight', '>', 100)
    .and('orderDate', '>', new Date(1998, 3, 1))
);

// Freight over $100 OR ordered after April 1, 1998
baseQuery.where(
  Predicate.create('freight', '>', 100)
    .or('orderDate', '>', new Date(1998, 3, 1))
);

// Composition runs left to right:
// (on or after Jan 1 1996 OR before Jan 1 1997) AND freight over $100
const pred = Predicate
  .create('orderDate', '>=', new Date(Date.UTC(1996, 0, 1)))
  .or('orderDate', '<', new Date(Date.UTC(1997, 0, 1)))
  .and('freight', '>', 100);
baseQuery.where(pred);

// Negation: freight NOT over $100
const big = Predicate.create('freight', '>', 100);
baseQuery.where(big.not());
baseQuery.where(Predicate.not(big));   // the same
```

`Date.UTC` gives an unambiguous UTC date with no time component.

To see what a predicate becomes, serialize it:

```ts
console.log(JSON.stringify(pred.toJSON()));
```

```json
{"and":[{"or":[{"orderDate":{"ge":"1996-01-01T00:00:00.000Z"}},{"orderDate":{"lt":"1997-01-01T00:00:00.000Z"}}]},{"freight":{"gt":100}}]}
```

::: tip Changed in 3.0
`Predicate.toODataFragment` is gone along with OData. Use `toJSON()`.
:::

### Conditions on related properties

```ts
// Products in a category whose name starts with "S"
EntityQuery.from('Products')
  .where('category.categoryName', 'startsWith', 'S');

// Orders sold to a customer in California
EntityQuery.from('Orders')
  .where('customer.region', '==', 'CA');
```

### Any and all

```ts
// Employees with any order where freight > 950
EntityQuery.from('Employees')
  .where('orders', 'any', 'freight', '>', 950);

// ...with FilterQueryOp values
EntityQuery.from('Employees')
  .where('orders', FilterQueryOp.Any, 'freight', FilterQueryOp.GreaterThan, 950);

// ...with the 'some' alias
EntityQuery.from('Employees')
  .where('orders', 'some', 'freight', '>', 950);

// ...built in pieces
const bigFreight = Predicate.create('freight', '>', 950);
EntityQuery.from('Employees')
  .where('orders', FilterQueryOp.Any, bigFreight);

// Customers with no orders
const hasOrders = Predicate.create('orders', 'any', 'orderID', '!=', null);
EntityQuery.from('Customers')
  .where(hasOrders.not());

// Employees with an order for a customer whose name starts with "Lazy"
EntityQuery.from('Employees')
  .where('orders', 'any', 'customer.companyName', 'startsWith', 'Lazy')
  .expand('orders.customer');

// Across a many-to-many relationship: Orders -> OrderDetails -> Product
EntityQuery.from('Orders')
  .where('orderDetails', 'any', 'product.productName', '==', 'Chai')
  .expand('orderDetails.product');

// A compound inner condition
const p = Predicate.create('freight', '>', 950).and('shipCountry', 'startsWith', 'G');
EntityQuery.from('Employees')
  .where('orders', 'any', p)
  .expand('orders');

// Nested: customers with an order where every line has unit price > $200
EntityQuery.from('Customers')
  .where('orders', 'any', 'orderDetails', 'all', 'unitPrice', '>', 200);
```

### Functions

```ts
// Company name starts with "C" or "c"
EntityQuery.from('Customers')
  .where('toLower(companyName)', 'startsWith', 'c');

// 2nd and 3rd letters are "OM"
EntityQuery.from('Customers')
  .where('toUpper(substring(companyName, 1, 2))', '==', 'OM');
```

Not every server supports every function. See [Functions](/query/predicates#functions) for
the list the Breeze .NET server understands.

### Where clauses as JSON

```ts
// Customers whose names start with "A"
EntityQuery.from('Customers')
  .where({ companyName: { startsWith: 'A' } });

// Customers in Berlin, Germany (equals is the default; properties are ANDed)
EntityQuery.from('Customers')
  .where({ country: 'Germany', city: 'Berlin' });

// Employees hired before 1993, or with a D surname in the USA
EntityQuery.from('Employees').where({
  or: [
    { hireDate: { lt: new Date(1993, 0, 1) } },
    { and: [{ lastName: { startsWith: 'D' } }, { country: 'USA' }] },
  ],
});
```

The full syntax is in [Where clauses as JSON](/query/predicates#where-clauses-as-json).

## Sorting

### By one property

```ts
// Products by name, ascending
EntityQuery.from('Products')
  .orderBy('productName');

// ...descending
EntityQuery.from('Products')
  .orderBy('productName desc');

// ...descending, another way
EntityQuery.from('Products')
  .orderByDesc('productName');
```

### By several properties

```ts
// Highest price first, then by name
EntityQuery.from('Products')
  .orderBy('unitPrice desc, productName');
```

### By related properties

```ts
// Products by category name, descending
EntityQuery.from('Products')
  .orderBy('category.categoryName desc');

// Products by category name, then by product name descending
EntityQuery.from('Products')
  .orderBy('category.categoryName, productName desc');
```

## Paging

```ts
// The first 5 products
EntityQuery.from('Products')
  .take(5);

// The first 5 products starting with "C", plus the total that start with "C"
const query = EntityQuery.from('Products')
  .where('productName', 'startsWith', 'C')
  .orderBy('productName')
  .take(5)
  .inlineCount();

const { results, inlineCount } = await em.executeQuery(query);
const pages = Math.ceil(inlineCount / 5);

// Skip the first 10 products and return the rest
EntityQuery.from('Products')
  .orderBy('productName')
  .skip(10);

// The 3rd page of 5 products
EntityQuery.from('Products')
  .orderBy('productName')
  .skip(10)
  .take(5);

// The first 10 products after sorting by category name, descending
EntityQuery.from('Products')
  .orderBy('category.categoryName desc')
  .take(10);
```

Always sort when you page. Without an `orderBy`, the server's row order is not guaranteed,
and pages can overlap or skip rows.

## Projections

`select` returns plain objects with just the properties you ask for. See
[Projections](/query/projections).

```ts
// Just the names of customers starting with "C"
EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'C')
  .select('companyName');

// The orders of customers starting with "C"
EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'C')
  .select('orders');

// Several properties
EntityQuery.from('Customers')
  .where('companyName', FilterQueryOp.StartsWith, 'C')
  .select('customerID, companyName, contactName')
  .orderBy('companyName');

// A related property: names of customers with orders over $500 freight
EntityQuery.from('Orders')
  .where('freight', FilterQueryOp.GreaterThan, 500)
  .select('customer.companyName')
  .orderBy('customer.companyName');
```

## Eager loading with expand

### One relation

```ts
// Products in categories starting with "S", with each product's Category
EntityQuery.from('Products')
  .where('category.categoryName', 'startsWith', 'S')
  .expand('category');
```

### Several relations

```ts
// The first 20 orders, with their Customer and their OrderDetails
EntityQuery.from('Orders')
  .take(20)
  .expand('customer, orderDetails');
```

### A property path

```ts
// The first 20 orders, with their OrderDetails and each detail's Product
EntityQuery.from('Orders')
  .take(20)
  .expand('orderDetails.product');
```

### One entity by key, expanded

```ts
// Order 10248 with its details: like fetchEntityByKey (below), but expanded
EntityQuery.from('Orders')
  .where('orderID', '==', 10248)
  .expand('orderDetails');
```

## By key

`fetchEntityByKey` fetches one entity from the server by its key. The result also tells you
whether it came from the cache:

```ts
const { entity, fromCache } = await em.fetchEntityByKey('Employee', 1);
```

Pass `true` as the last argument to look in the cache first, and query the server only if
the entity isn't there:

```ts
const { entity } = await em.fetchEntityByKey('Employee', 1, true);
```

`getEntityByKey` looks only in the cache. It never calls the server, so it is not really a
query. It returns the entity or `null` immediately:

```ts
const employee = em.getEntityByKey('Employee', 1);
```

To use a key in a query you can extend, for example with `expand`, use `fromEntityKey`:

```ts
const key = employee.entityAspect.getKey();
const query = EntityQuery.fromEntityKey(key).expand('orders');
```

## Related entities on demand

Load a navigation property you did not expand:

```ts
// Through the entity
await employee.entityAspect.loadNavigationProperty('orders');

// ...or build the query yourself, to add conditions
const query = EntityQuery.fromEntityNavigation(employee, 'orders')
  .where('freight', '>', 100);
const { results } = await em.executeQuery(query);
```

See [Navigation properties](/guide/navigation-properties).

## Refreshing entities you already have

`fromEntities` builds a query for fresh copies of entities, all of the same type. By
default, incoming values don't overwrite unsaved changes. Use `OverwriteChanges` to force a
refresh:

```ts
import { MergeStrategy } from 'breeze-client';

const query = EntityQuery.fromEntities(customers)
  .using(MergeStrategy.OverwriteChanges);

await em.executeQuery(query);
```

## A bag of lookups

A query can return an object whose properties hold lists of entities. This is a good way
to fill the cache with lookup lists in one call. On the server:

```csharp
[HttpGet]
public object Lookups() {
  var regions = PersistenceManager.Context.Regions;
  var territories = PersistenceManager.Context.Territories;
  var categories = PersistenceManager.Context.Categories;

  return new { regions, territories, categories };
}
```

On the client:

```ts
await EntityQuery.from('Lookups').using(em).execute();

// The Region, Territory and Category entities are in the cache now
const categories = em.executeQueryLocally(EntityQuery.from('Categories'));
```
