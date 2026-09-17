# Where clauses

`where` filters a query. You can give it a property, an operator and a value; a `Predicate` you
built earlier; or an object. They are interchangeable and build the same query - see
[the two forms side by side](#the-two-forms-side-by-side).

```ts
import { EntityQuery, FilterQueryOp, Predicate } from 'breeze-client';
import { Customer, Order } from './model';   // your generated classes

EntityQuery.from(Customer).where('companyName', 'startsWith', 'C');
EntityQuery.from(Customer).where('companyName', FilterQueryOp.StartsWith, 'C');
EntityQuery.from(Customer).where(Predicate.create<Customer>('companyName', 'startsWith', 'C'));
EntityQuery.from(Customer).where({ companyName: { startsWith: 'C' } });   // the object form
```

## Simple conditions

A simple condition has three parts:

- a **property**: a property name (`'freight'`), a path through navigation properties
  (`'customer.region'`), or a [function](#functions) of a property (`'toLower(companyName)'`)
- an **operator**: a `FilterQueryOp` or any of its string aliases (case is ignored)
- a **value**: a literal or, in some cases, [another property](#comparing-two-properties)

```ts
EntityQuery.from(Order).where('freight', '>', 100);
EntityQuery.from(Order).where('orderDate', '>', new Date(1998, 1, 1)); // Feb 1: months start at 0
EntityQuery.from(Order).where('shippedDate', '==', null);
EntityQuery.from(Order).where('customer.region', '==', 'CA');
EntityQuery.from(Customer).where('country', 'in', ['Belgium', 'Germany']);
```

Use property names as the client sees them. With the default `NamingConvention.camelCase`
that is
`companyName`. Breeze translates them to server names when it builds the request.

### Operators

| `FilterQueryOp` | Aliases | Meaning |
|---|---|---|
| `Equals` | `eq`, `==`, `equals`, `equal` | equal to |
| `NotEquals` | `ne`, `!=`, `~=`, `notequals`, `notequal` | not equal to |
| `GreaterThan` | `gt`, `>`, `greaterthan` | greater than |
| `GreaterThanOrEqual` | `ge`, `>=`, `greaterthanorequal` | greater than or equal to |
| `LessThan` | `lt`, `<`, `lessthan` | less than |
| `LessThanOrEqual` | `le`, `<=`, `lessthanorequal` | less than or equal to |
| `StartsWith` | `startswith` | string starts with |
| `EndsWith` | `endswith` | string ends with |
| `Contains` | `contains`, `substringof` | string contains |
| `In` | `in` | equal to one of the values in an array |
| `Any` | `any`, `some` | at least one related entity matches — see [Any and all](#any-and-all) |
| `All` | `all`, `every` | every related entity matches |

Aliases are case-insensitive, so `'startsWith'`, `'StartsWith'` and `'startswith'` all work.
Breeze always sends the canonical form (the first alias) to the server, so the server never
sees an alias.

`In` requires an array on the right-hand side and throws if it gets anything else.

An unknown operator throws as soon as you call `where`:

```
Unable to resolve predicate after the phrase: 'companyName' for operator: 'like'  and value: 'x'
```

An unknown property is caught when the query is validated against metadata, which is
usually when it runs. The query then fails with an error that names the property.

### Nulls and dates

Compare with `null` using `==` or `!=`.

For dates, pass a `Date`. If you pass a string and Breeze knows the property is a date, it
parses the string in the client's local time zone. If it doesn't know the type, it sends
the string as is. See [From resource name to EntityType](/query/#from-resource-name-to-entitytype).
[Date and time](/guide/date-and-time) covers time zones in general.

## The two forms, side by side

Every filter on this page can be written either way, and the two build the *identical* query —
`test/unit/where-forms.spec.ts` in the Breeze repo asserts it for every row below.

| Three arguments | Object form |
|---|---|
| `where('freight', '>', 100)` | `where({ freight: { gt: 100 } })` |
| `where('shipCity', 'startsWith', 'Ber')` | `where({ shipCity: { startsWith: 'Ber' } })` |
| `where('shipCountry', '==', 'Germany')` | `where({ shipCountry: 'Germany' })` |
| `where('shippedDate', '==', null)` | `where({ shippedDate: null })` |
| `where('shippedDate', '!=', null)` | `where({ shippedDate: { ne: null } })` |
| `where('country', 'in', ['Belgium', 'Germany'])` | `where({ country: { in: ['Belgium', 'Germany'] } })` |
| `where('customer.companyName', 'startsWith', 'A')` | `where({ 'customer.companyName': { startsWith: 'A' } })` |
| `where('freight', '>', 100).where('shipCountry', '==', 'Germany')` | `where({ freight: { gt: 100 }, shipCountry: 'Germany' })` |
| `where(p('freight', '>', 100).and(p('freight', '<', 200)))` | `where({ freight: { gt: 100, lt: 200 } })` |
| `where(Predicate.or([p('city', '==', 'London'), p('city', '==', 'Berlin')]))` | `where({ or: [{ city: 'London' }, { city: 'Berlin' }] })` |
| `where('orders', 'any', 'freight', '>', 950)` | `where({ orders: { any: { freight: { gt: 950 } } } })` |
| `where('orders', 'all', 'shippedDate', '!=', null)` | `where({ orders: { all: { shippedDate: { ne: null } } } })` |
| `where(p('orders', 'any', 'orderID', '!=', null).not())` | `where({ not: { orders: { any: { orderID: { ne: null } } } } })` |
| `where('requiredDate', '<', 'shippedDate')` | `where({ requiredDate: { lt: 'shippedDate' } })` |
| `where('toLower(companyName)', 'startsWith', 'c')` | `where({ 'toLower(companyName)': { startsWith: 'c' } })` |

`p` is a `Predicate.for(Order)` factory — see [Predicates](#predicates).

Pick whichever reads better. The object form is usually shorter once there is more than one
condition, it nests `and`/`or`/`any`/`all` without a helper, and it is the one that survives being
stored as data. It also produces the **better compile error** when a query is built from a
constructor: a misspelled key is an ordinary excess-property error, so TypeScript suggests the
correction, which the three-argument form cannot do.

```
Object literal may only specify known properties, but 'compnyName' does not exist
in type '{ … }'. Did you mean to write 'companyName'?
```

See [Typed queries](/guide/typed-queries) for the details, and
[The object form in full](#the-object-form-in-full) below for the whole grammar.


## Comparing two properties

If the value is a string that names a property of the queried type, Breeze treats it as that
property rather than as a literal:

```ts
// Orders shipped after they were due
EntityQuery.from(Order).where('shippedDate', '>', 'requiredDate');
```

Case matters, and the name must be the client name. This only works when Breeze knows the
entity type. Against an unrecognised resource, the string is a literal.

To remove the ambiguity, pass a value object instead of a bare value:

```ts
// Employees whose first name is literally "lastName"
EntityQuery.from(Employee)
  .where('firstName', '==', { value: 'lastName', isLiteral: true });

// Employees whose notes mention their own first name
EntityQuery.from(Employee)
  .where('notes', 'contains', { value: 'firstName', isProperty: true });
```

A value object with `isProperty: true` or `isLiteral: false` is a property. Any other value
object, including one with `isLiteral: true`, is a literal.

A value object can also fix the data type of a literal, as a `DataType` or its name:

```ts
EntityQuery.from(Product)
  .where('unitsInStock', '==', { value: '35', dataType: 'Int32' });
```

## Combining conditions

### Calling where more than once

Each `where` is ANDed with what is already there:

```ts
EntityQuery.from(Order)
  .where('freight', '>', 100)
  .where('shipCountry', '==', 'Germany');
```

`where()` with no argument, or with `null`, removes the whole where clause.

### Predicates

A `Predicate` is a condition you can build, combine and reuse. Naming the entity type checks it,
the same way a query built from a constructor checks its `where` - see
[Typed queries](/guide/typed-queries). The arguments are the same as `where`:

```ts
const p1 = Predicate.create<Order>('freight', '>', 100);
const p2 = Predicate.create<Order>('orderDate', '>', new Date(1998, 3, 1));
```

Combine predicates with the instance methods `and`, `or` and `not`:

```ts
const both   = p1.and(p2);
const either = p1.or(p2);
const notBig = p1.not();

EntityQuery.from(Order).where(both);
```

`and` and `or` also accept the arguments for a new condition directly. Those arguments are *not*
checked - `and` takes any predicate and knows nothing about the type - so build each clause from
a `Predicate.for` factory instead, and every clause is checked:

```ts
const p = Predicate.for(Order);
const pred = p('freight', '>', 100)
  .and(p('orderDate', '>', new Date(1998, 3, 1)));
```

Composition runs left to right. This is *(date ≥ 1996 OR date < 1997) AND freight > 100*:

```ts
const pred = p('orderDate', '>=', new Date(Date.UTC(1996, 0, 1)))
  .or(p('orderDate', '<', new Date(Date.UTC(1997, 0, 1))))
  .and(p('freight', '>', 100));
```

The static methods `Predicate.and`, `Predicate.or` and `Predicate.not` take several
predicates or one array. `null` and `undefined` entries are dropped, which helps when some
filters are optional:

```ts
const filters = [
  nameFilter ? Predicate.create<Customer>('companyName', 'startsWith', nameFilter) : null,
  countryFilter ? Predicate.create<Customer>('country', '==', countryFilter) : null,
];
const query = EntityQuery.from(Customer).where(Predicate.and(filters));
```

Predicates are immutable. `and`, `or` and `not` return new predicates.

## Any and all

`any` and `all` test a collection navigation property. The part after the operator is a
condition on the entities in the collection.

```ts
// Employees with at least one order where freight > 950
EntityQuery.from(Employee).where('orders', 'any', 'freight', '>', 950);

// the same with FilterQueryOp values
EntityQuery.from(Employee)
  .where('orders', FilterQueryOp.Any, 'freight', FilterQueryOp.GreaterThan, 950);
```

The inner condition can be a `Predicate`, including a compound one:

```ts
const po = Predicate.for(Order);
const p = po('freight', '>', 950).and(po('shipCountry', 'startsWith', 'G'));
EntityQuery.from(Employee).where('orders', 'any', p);
```

It can follow a navigation path, which is how you cross a many-to-many relationship:

```ts
// Orders containing the product "Chai"
EntityQuery.from(Order)
  .where('orderDetails', 'any', 'product.productName', '==', 'Chai');
```

Conditions can nest:

```ts
// Customers with an order whose every line has unit price > 200
EntityQuery.from(Customer)
  .where('orders', 'any', 'orderDetails', 'all', 'unitPrice', '>', 200);
```

Negate an `any` to find entities with no matches, for example customers with no orders:

```ts
const hasOrders = Predicate.create<Customer>('orders', 'any', 'orderID', '!=', null);
EntityQuery.from(Customer).where(hasOrders.not());
```

## Functions

The property side of a condition can be a function call:

```ts
// Company name starts with "c" or "C"
EntityQuery.from(Customer).where('toLower(companyName)', 'startsWith', 'c');

// 2nd and 3rd letters are "OM"
EntityQuery.from(Customer).where('toUpper(substring(companyName, 1, 2))', '==', 'OM');

// Orders placed in 1997
EntityQuery.from(Order).where('year(orderDate)', '==', 1997);
```

Breeze and the Breeze .NET server both support:

| Kind | Functions |
|---|---|
| String | `toLower`, `toUpper`, `trim`, `length`, `concat`, `substring`, `replace`, `indexOf`, `substringof`, `startsWith`, `endsWith` |
| Date | `year`, `month`, `day`, `hour`, `minute`, `second` |
| Number | `round`, `ceiling`, `floor` |

Function names are case-insensitive. An unknown function throws `Unknown function: ...`.
Other server back ends may support a different set.

## The object form in full

Anywhere you can pass a `Predicate`, you can pass a plain object instead:
`query.where(json)`, `Predicate.create(json)` and `new Predicate(json)`. This is useful when
filters are built from data, or stored and restored later.

The basic form is *property: { operator: value }*:

```js
{ freight: { gt: 100 } }
{ 'customer.region': { '==': 'CA' } }
{ country: { in: ['Belgium', 'Germany'] } }
{ 'toLower(companyName)': { startsWith: 'c' } }
```

Any alias from the [operator table](#operators) works as a key.

### Shortcuts

Leave out the operator to mean equals:

```js
{ country: 'Germany' }            // same as { country: { eq: 'Germany' } }
{ shippedDate: null }             // same as { shippedDate: { eq: null } }
```

Several properties in one object are ANDed, as are several operators on one property:

```js
{ country: 'Germany', city: 'Berlin' }
{ freight: { gt: 100, lt: 200 } }
```

### and, or, not

`and` and `or` take an array. `not` takes a single where clause:

```js
{
  or: [
    { hireDate: { lt: new Date(1993, 0, 1) } },
    { and: [
      { lastName: { startsWith: 'D' } },
      { country: 'USA' }
    ] }
  ]
}

{ not: { country: { in: ['Belgium', 'Germany'] } } }
```

`&&`, `||` and `!` are accepted as aliases for `and`, `or` and `not`.

### any and all

```js
// Customers with at least one order where freight > 100
{ orders: { any: { freight: { gt: 100 } } } }
```

### Value objects

The same value objects work here as in the fluent form:

```js
{ lastName: { startsWith: { value: 'firstName', isProperty: true } } }
{ unitsInStock: { eq: { value: '35', dataType: 'Int32' } } }
```

### Serializing predicates and queries

`toJSON()` on a `Predicate` or an `EntityQuery` returns this format with client property
names. Passing the result back to the constructor recreates the object:

```ts
const query = EntityQuery.from(Order)
  .where('freight', '>', 100)
  .orderBy('orderDate desc')
  .take(5);

const json = query.toJSON();
// { from: 'Orders', where: { freight: { gt: 100 } }, orderBy: ['orderDate desc'], take: 5 }

const copy = new EntityQuery(json);
```

A whole query in JSON can have these properties:

| Property | Type | Fluent equivalent |
|---|---|---|
| `from` | string | `from` |
| `toType` | string | `toType` |
| `where` | where-clause object | `where` |
| `orderBy` | array of strings, each a property path optionally followed by `asc` or `desc` | `orderBy` |
| `select` | array of property paths | `select` |
| `expand` | array of navigation property paths | `expand` |
| `skip` | number | `skip` |
| `take` | number | `take` |
| `inlineCount` | boolean | `inlineCount` |
| `noTracking` | boolean | `noTracking` |
| `usePost` | boolean | `usePost` |
| `parameters` | object | `withParameters` |
| `queryOptions` | `fetchStrategy` and `mergeStrategy` by name, and `includeDeleted` | `using` |

```ts
const query = new EntityQuery({
  from: 'Orders',
  where: { orderID: { lt: 10500 } },
  orderBy: ['orderDate desc'],
  expand: ['orderDetails.product'],
  skip: 20,
  take: 10,
  inlineCount: true,
  queryOptions: { fetchStrategy: 'FromServer', mergeStrategy: 'PreserveChanges' },
});
```

Use `take`. The constructor ignores `top`, even though the fluent API has a `top()` method.

## What the server receives

A where clause goes over the wire in the same JSON format, with property and function names
translated to server names and operators in their canonical form:

```ts
EntityQuery.from(Order)
  .where(Predicate.create<Order>('freight', '>', 100).or('shipCountry', '==', 'Germany'));
```

```json
{"where":{"or":[{"Freight":{"gt":100}},{"ShipCountry":"Germany"}]}}
```

See [What goes over the wire](/query/#what-goes-over-the-wire) and
[Debugging queries](/query/debugging).
