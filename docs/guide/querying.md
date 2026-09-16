# Querying

A query says what you want; an `EntityManager` goes and gets it. Nothing is fetched until you
execute one, and what comes back are entities in the manager's cache — tracking their own changes,
with navigation properties wired to whatever else is already there.

```ts
import { EntityManager, EntityQuery } from 'breeze-client';
import { Customer } from './model';   // your generated classes

const em = new EntityManager('breeze/NorthwindIBModel');

const query = EntityQuery.from(Customer)
  .where('companyName', 'startsWith', 'B')
  .orderBy('companyName')
  .take(10);

const { results } = await em.executeQuery(query);
```

`results` is `Customer[]`, because the query was built from the `Customer` class. That is worth
doing everywhere: passing the class instead of the resource name `'Customers'` is what lets the
compiler check the property paths, the operators and the values — `'compnyName'` becomes a build
error rather than a server error. See [Typed entities](/guide/typed-entities) for generating the
classes and [Typed queries](/guide/typed-queries) for exactly what gets checked.

A resource name still works everywhere a class does, and is what you use for an endpoint that has
no class of its own:

```ts
EntityQuery.from('Lookups')          // a custom server method
EntityQuery.from('Customers')        // the same as from(Customer), just unchecked
```

Queries are **immutable**. Every method returns a new query, so a base query can be shared and
specialised without anyone stepping on anyone else:

```ts
const recent = EntityQuery.from(Order).where('orderDate', '>', new Date(1998, 0, 1));

const big     = recent.where('freight', '>', 500);    // recent is unchanged
const germany = recent.where('shipCountry', '==', 'Germany');
```

## Filtering

`where` takes a property, an operator and a value:

```ts
EntityQuery.from(Order).where('freight', '>', 100);
EntityQuery.from(Order).where('shipCity', 'startsWith', 'Ber');
EntityQuery.from(Order).where('shippedDate', '==', null);
EntityQuery.from(Customer).where('country', 'in', ['Belgium', 'Germany']);
```

Operators can be written as any alias Breeze accepts — `'gt'`, `'>'` and `'greaterthan'` are the
same thing — or as a `FilterQueryOp`. Which operators are available depends on the property:
strings get `startsWith`, `endsWith` and `contains`; numbers and dates get the comparisons;
booleans get equality.

Use the property names the client sees. With the default camelCase naming convention that is
`companyName`, not `CompanyName`; Breeze translates them for the server.

### Through navigations

A path may cross a navigation property, which filters on related data without fetching it:

```ts
EntityQuery.from(Order).where('customer.companyName', 'startsWith', 'A');
EntityQuery.from(Product).where('supplier.location.city', '==', 'Berlin');
```

### Several conditions

Calling `where` twice ands the conditions together:

```ts
EntityQuery.from(Order)
  .where('freight', '>', 100)
  .where('shipCountry', '==', 'Germany');
```

For anything more than that, build a `Predicate`. Naming the entity type checks it, and a
`Predicate.for` factory keeps every clause checked when you chain them:

```ts
import { Predicate } from 'breeze-client';

const p = Predicate.for(Order);

const pred = p('freight', '>', 100)
  .and(p('shipCountry', '==', 'Germany'));

EntityQuery.from(Order).where(pred);
```

`and`, `or` and `not` compose left to right, and `Predicate.and` / `Predicate.or` take an array and
drop `null` entries — handy when filters are optional:

```ts
const filters = [
  name    ? Predicate.create<Customer>('companyName', 'startsWith', name) : null,
  country ? Predicate.create<Customer>('country', '==', country)          : null,
];
EntityQuery.from(Customer).where(Predicate.and(filters));
```

There is also an object form, which is shorter and gives the best error messages:

```ts
EntityQuery.from(Customer).where({ city: 'London', country: 'UK' });   // keys are and-ed
EntityQuery.from(Order).where({ freight: { gt: 100 } });
EntityQuery.from(Customer).where({ or: [{ city: 'London' }, { city: 'Berlin' }] });
```

### Filtering on a collection

`any` and `all` filter a parent by its children:

```ts
// Customers with at least one order over $950
EntityQuery.from(Customer).where('orders', 'any', 'freight', '>', 950);

// Customers all of whose orders shipped
EntityQuery.from(Customer).where('orders', 'all', 'shippedDate', '!=', null);

// Customers with no orders at all
EntityQuery.from(Customer).where(
  Predicate.create<Customer>('orders', 'any', 'orderID', '!=', null).not());
```

[Where clauses](/query/predicates) covers the rest: comparing two properties, query functions like
`toLower(companyName)`, and the full operator table.

## Sorting and paging

```ts
EntityQuery.from(Customer).orderBy('companyName');
EntityQuery.from(Order).orderBy('freight desc');
EntityQuery.from(Order).orderBy(['shipCountry', 'freight desc']);
```

`skip` and `take` page the results, and `inlineCount` asks the server how many matched before
paging:

```ts
const query = EntityQuery.from(Order)
  .orderBy('orderDate')
  .skip(20)
  .take(10)
  .inlineCount();

const { results, inlineCount } = await em.executeQuery(query);
// results.length is 10; inlineCount is the total
```

Order by before you page — paging without a sort gives the server no defined order to page through.

## Bringing back related entities

`expand` returns related entities in the same request:

```ts
EntityQuery.from(Order).expand('customer');
EntityQuery.from(Order).expand(['customer', 'orderDetails.product']);
```

They land in the cache alongside the top-level results, with navigation properties already wired,
so `order.customer` is populated without another round trip. Filtering happens before expanding —
`expand` never changes which top-level rows come back.

See [Ordering, paging, expand](/query/shaping) for `withParameters`, `noTracking` and query
options.

## One entity by key

When you know the key, ask for the entity rather than writing a filter:

```ts
const { entity } = await em.fetchEntityByKey(Customer, customerId);
if (entity) { /* … */ }
```

`fetchEntityByKey` goes to the server; `getEntityByKey` looks only in the cache. Both return `null`
when there is no such entity. Pass `true` as the last argument to `fetchEntityByKey` to use a
cached copy if there is one, and skip the request.

## Querying the cache

The same query object runs against the cache, synchronously:

```ts
const cached = em.executeQueryLocally(
  EntityQuery.from(Customer).where('companyName', 'startsWith', 'B'));
```

This is how you show what you already have without waiting. A local query sees entities you have
added but not yet saved, and matches on their *current* values, so an edited entity matches what
it looks like now; entities marked for deletion are skipped unless you ask for them.
[Querying the cache](/query/locally) covers `FetchStrategy`, which lets a normal
`executeQuery` look in the cache first.

## Getting back less than a whole entity

`select` projects, returning plain objects rather than entities:

```ts
const { results } = await em.executeQuery(
  EntityQuery.from(Customer).select(['companyName', 'city']));
// results[0] is { companyName: '…', city: '…' } - not a Customer, and not in the cache
```

Projected objects are not tracked and cannot be saved. See
[Projections](/query/projections).

## When it goes wrong

A failed query rejects. The error carries the status and the server's message:

```ts
try {
  await em.executeQuery(query);
} catch (e: any) {
  console.log(e.status, e.message);
}
```

`status === 0` means the request never arrived — offline, DNS, CORS, or the server down — and is
the one people misread. See [Error handling](/guide/error-handling) and
[Debugging queries](/query/debugging), which shows how to read the URL a query produced.

## Where to next

The [Querying section](/query/) is the reference for all of this:

- [Query examples](/query/examples) — a catalogue to copy from
- [Where clauses](/query/predicates) — every operator, `Predicate`, any/all, the object form
- [Ordering, paging, expand](/query/shaping)
- [Projections](/query/projections)
- [Querying the cache](/query/locally)
- [Debugging queries](/query/debugging)

And [Typed queries](/guide/typed-queries) explains what the compiler checks once a query starts
from a class, and what it deliberately does not.
