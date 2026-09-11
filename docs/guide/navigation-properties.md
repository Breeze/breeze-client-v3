# Navigation properties

Entities are connected by associations. In Northwind, an `Order` has a parent `Customer`
and many child `OrderDetail`s. An `OrderDetail` has a parent `Order` and a parent
`Product`. You move around this graph by following **navigation properties**: `customer` →
`orders` → `orderDetails` → `product`.

There are two kinds:

| Kind | Example | Returns |
|---|---|---|
| scalar (reference) | `order.customer` | one entity, or `null` |
| collection | `customer.orders` | an array of zero or more entities |

## Reading

```ts
const customer = order.getProperty('customer');   // Customer or null
const orders = customer.getProperty('orders');    // array of Order
```

With the backing-store model library, which is the only one in Breeze 3, these are also
plain properties. If you give your entities TypeScript interfaces, you can write
`order.customer` and `customer.orders`. The examples on this page use `getProperty` so
they compile without interfaces.

A navigation property returns only entities that are **in the cache**. If
`order.customer` is `null`, the customer isn't cached. It may still exist on the server.
An empty `orders` array means no orders for that customer are cached right now.

A collection navigation property returns a Breeze relation array. That is a real array,
with an `arrayChanged` event and a `load()` method (see
[`RelationArray`](/api/interfaces/RelationArray)).

## Setting

Set a scalar navigation property as you would any other property:

```ts
order.setProperty('customer', anotherCustomer);
```

Breeze keeps both ends of the association in step. After that line, `order` has left the
old customer's `orders` array, and joined `anotherCustomer.orders`. `order.customerID`
now holds the new customer's key.

You can make the same change from the other end, by pushing to the collection:

```ts
anotherCustomer.getProperty('orders').push(order);
// order.customer === anotherCustomer
// order.customerID === anotherCustomer's key
```

Remove an entity from a collection with `splice`, `pop` or `shift`. That sets the child's
navigation property to `null`, and clears its foreign key.

You can't replace the collection itself:

```ts
customer.setProperty('orders', []);
// Error: Nonscalar navigation properties are readonly - entities can be added or
// removed but the collection may not be changed.
```

### Attaching as a side effect

If you connect a cached entity to a detached one, Breeze adds the detached entity to the
cache as `Added`, whichever side you set. For example, setting a detached order's
`customer` to a cached customer brings the order into that customer's manager. An entity
can't be connected to an entity in a different `EntityManager`; if you try, Breeze
throws.

## Foreign keys

Breeze associations depend on **foreign keys**. Metadata tells Breeze which data property
holds the foreign key for each navigation property, and Breeze uses that to connect
entities in the cache.

In every association, one side is the **principal**, and the other is the **dependent**.
The dependent holds the foreign key: a property whose value is the principal's key.

- In a one-to-many association, the "many" side is the dependent. `Order` has a
  `customerID` foreign key pointing to its `Customer`. A customer has no foreign keys for
  its orders.
- An entity can be dependent in one association and principal in another. `Order` is
  dependent on `Customer`, and principal to `OrderDetail`, whose `orderID` points back
  to it.
- In a one-to-one association, either side can be the dependent. The domain decides.

If your model has no foreign key property, Breeze can't connect the entities. Navigation
properties then stay empty, even when both ends are in the cache.

A many-to-many association needs a join entity. Model it as two one-to-many
associations, the way Northwind does with `Employee` → `employeeTerritories` →
`territory`.

### Setting the foreign key directly

Setting the foreign key has the same effect as setting the navigation property:

```ts
order.setProperty('customerID', someCustomerID);

const customer = order.getProperty('customer');
// the cached Customer with that key, or null if it isn't in the cache
```

If the customer isn't cached yet, Breeze remembers the link. When a customer with that
key arrives later, through a query or an import, `order.customer` starts returning it.

### One-sided associations

You don't need a navigation property at both ends. For example, you might have
`Person.gender` but no `Gender.persons` collection. No one needs every `Person` of a
gender, and keeping that collection up to date has a cost. Leave the navigation property
out of the principal's metadata. The foreign key on the dependent is still required.

## No lazy loading

Some data frameworks go to the server the first time you touch a navigation property, and
load the related entities automatically. Breeze doesn't: navigation properties never go
to the server. You load related entities explicitly, either with `expand` on a query, or
on demand when you need them.

## Eager loading with expand

`expand` includes related entities in a query's response:

```ts
const query = EntityQuery.from('Orders')
  .where('customerID', '==', customerID)
  .expand('orderDetails');

const { results: orders } = await em.executeQuery(query);
```

The query still returns orders. Breeze also takes the order details out of the response,
merges them into the cache, and connects them to their orders. `order.orderDetails` is
now populated; without the `expand` it would be empty.

To expand several paths, separate them with commas, or pass an array. Dots follow a path
through several associations:

```ts
EntityQuery.from('Orders')
  .where('customerID', '==', customerID)
  .expand('customer, orderDetails.product');
```

- Each segment of a path is a navigation property name. Use the client-side spelling. With
  the default `NamingConvention.camelCase` that means `orderDetails`, not `OrderDetails`.
- Every entity along the path is included. `orderDetails.product` returns the details
  *and* their products.

`expand` is easy to overuse. Every expansion adds data to the response, and too much can
crush the performance of both client and server. Where you can, load related entities on
demand instead. If `expand` returns less than you expect, see
[Debugging queries](/query/debugging).

## Loading on demand

Suppose you list orders without their details. The user picks one, and now you need its
details.

### loadNavigationProperty

```ts
try {
  await order.entityAspect.loadNavigationProperty('orderDetails');
  // order.orderDetails is now populated
} catch (err) {
  // handle the error
}
```

`loadNavigationProperty` builds a query for the related entities, runs it, and returns
the query's promise. When the results arrive, they are merged into the cache, and
`order.orderDetails` fills in. A relation array has the same operation, as `load()`:

```ts
await order.getProperty('orderDetails').load();
```

After a successful `loadNavigationProperty`,
`entityAspect.isNavigationPropertyLoaded('orderDetails')` returns `true`. It also returns
`true` after you call `markNavigationPropertyAsLoaded`, and for a scalar navigation
property whenever its value is not null.

### A query of your own

`loadNavigationProperty` doesn't let you add an `expand`. If you also want each detail's
product, write the query yourself:

```ts
const query = EntityQuery.from('OrderDetails')
  .where('orderID', '==', order.getProperty('orderID'))
  .expand('product');

await em.executeQuery(query);
```

### EntityQuery.fromEntityNavigation

That query assumes you know how the association is implemented.
`fromEntityNavigation` builds the same query from metadata instead:

```ts
const query = EntityQuery
  .fromEntityNavigation(order, 'orderDetails')
  .expand('product');

await em.executeQuery(query);
```

Breeze looks up the `orderDetails` navigation property, and gets two things from it: the
foreign key (`orderID`) and the resource name (`OrderDetails`). It then builds a predicate
that matches the order's key.

### Related entities for several parents

To load the details of several orders in one request, combine the predicates from their
navigation queries:

```ts
import { EntityQuery, Predicate } from 'breeze-client';

const predicates = orders.map(o =>
  EntityQuery.fromEntityNavigation(o, 'orderDetails').wherePredicate!);

const query = EntityQuery.from('OrderDetails')
  .where(Predicate.or(predicates))
  .expand('product');

await em.executeQuery(query);
```

Before you run it, consider how much data it will fetch.

## State and events when you set a navigation property

Setting a navigation property on a dependent entity changes two of its properties: the
navigation property and its foreign key. The entity raises `propertyChanged` for each. An
`Unchanged` entity becomes `Modified`, because the new foreign key has to be saved.

The principal is **not** changed. When an order joins `customer.orders`, the customer stays
`Unchanged`, and raises no `propertyChanged` event. The contents of its collection changed,
but none of the customer's own properties did. The collection raises `arrayChanged`
instead:

```ts
customer.getProperty('orders').arrayChanged.subscribe(args => {
  // args.array, args.added?, args.removed?
});
```

From a relational point of view that is right: adding an order doesn't change any column
in the customer's row. Whether it is right for your domain depends on the domain. Few
people think of adding an order as changing the customer, but many think of adding a line
item as changing the order. Breeze can't tell the two cases apart. If your domain treats
the parent as changed, call `parent.entityAspect.setModified()` yourself.

Deleting an entity removes it from the collections of its related entities, and sets its
scalar navigation properties to `null`. Its foreign key values are kept, so that they can
be sent to the server.
