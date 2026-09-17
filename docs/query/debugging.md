# Debugging queries

A query that misbehaves usually fails in one of three places:

1. **The request.** Breeze sent something other than what you meant.
2. **The server.** It failed, or returned the wrong data.
3. **Materialization.** The right data arrived, but did not become the entities you
   expected.

Work in that order. There is no point checking metadata while the server is returning the
wrong rows.

## See the traffic

Every request Breeze makes goes through one function, the `BreezeFetch` transport. You
can see requests in the browser's network panel as ordinary `fetch` calls. To log them
from code, or outside a browser, pass a logging `fetch` to `configureBreeze`:

```ts
import { configureBreeze, BreezeFetch } from 'breeze-client';

const loggingFetch: BreezeFetch = async (input, init) => {
  const url = String(input);
  console.debug('breeze →', init?.method ?? 'GET', decodeURIComponent(url));

  const res = await fetch(input, init);

  // read a clone, so Breeze can still read the body
  const body = await res.clone().text();
  console.debug('breeze ←', res.status, url, body.slice(0, 2000));
  return res;
};

configureBreeze({ fetch: loggingFetch });
```

It is a plain function, so you can wrap your auth or retry transport in it the same way.
See [Supplying your own transport](/server/transport).

## Reading a query URL

The JSON URI builder encodes the whole query as one JSON object in the query string. This
query:

```ts
EntityQuery.from(Customer)
  .where('companyName', 'startsWith', 'C')
  .orderBy('companyName')
  .take(10);
```

is sent as:

```
GET /breeze/NorthwindIBModel/Customers?%7B%22where%22%3A%7B%22CompanyName%22%3A%7B%22startswith%22%3A%22C%22%7D%7D%2C%22orderBy%22%3A%5B%22CompanyName%22%5D%2C%22take%22%3A10%7D
```

Decoded, that reads:

```
/breeze/NorthwindIBModel/Customers?{"where":{"CompanyName":{"startswith":"C"}},"orderBy":["CompanyName"],"take":10}
```

A query with a projection, an expand and an inline count:

```ts
EntityQuery.from(Order)
  .where('freight', '>', 500)
  .select('customer.companyName, orderDate')
  .expand('customer')
  .inlineCount();
```

```
/breeze/NorthwindIBModel/Orders?{"where":{"Freight":{"gt":500}},"select":["Customer.CompanyName","OrderDate"],"expand":["Customer"],"inlineCount":true}
```

What to check:

- **The resource name** is the last path segment. Breeze appends it to the service name.
- **Property names are server names.** `companyName` became `CompanyName` through the
  [naming convention](/server/namingconvention). If the server rejects a property name,
  check which convention is in force.
- **Operators** are Breeze's short forms: `startswith`, `gt`, `eq` and so on. See
  [Where clauses](/query/predicates).
- **No clauses, no query string.** `EntityQuery.from(Customer)` requests plain
  `/Customers`.
- **`withParameters`** values are ordinary query-string parameters after the JSON, for
  example `…}&foo=bar`. They are not part of the JSON.

With `query.usePost()`, the same JSON is sent as the body of a POST to the resource URL,
and the endpoint must accept POST. `withParameters` values stay in the query string.

## When the query fails

A failed query rejects with an `Error` carrying the server's response:

```ts
import type { ServerError } from 'breeze-client';

try {
  const { results } = await em.executeQuery(query);
} catch (e) {
  const err = e as ServerError;
  console.error(err.status, err.message);
  console.error(err.httpResponse?.data);   // raw response body
}
```

| Property | Contents |
|---|---|
| `message` | The best message Breeze could find. See below |
| `status` | HTTP status code, or `0` if no response arrived |
| `httpResponse.status` | Same status |
| `httpResponse.data` | The response body as text |
| `httpResponse.config.url` | The request URL |
| `httpResponse.getHeaders(name)` | A response header, or all headers if no name is given |

Breeze also attaches `query` and `entityManager` to the error.

`message` comes from the response body:

- **A Breeze .NET error body.** Breeze uses the innermost `ExceptionMessage`, falling back
  to `Message`.
- **Another JSON body.** Breeze uses its `message` property.
- **A body that is not JSON**, such as a plain-text 404 page, is used verbatim.
- **No response at all**, because the network failed or the server is down, gives the
  transport's error text, such as `TypeError: fetch failed`, and `status` is `0`.

On an ASP.NET Core server with Breeze's `GlobalExceptionFilter` registered, an exception
in a query endpoint becomes a 500 response. The body carries a `Message`, a `StackTrace`
and, for an `EntityErrorsException`, `EntityErrors`:

```csharp
services.AddControllers()
  .AddMvcOptions(o => { o.Filters.Add(new GlobalExceptionFilter()); });
```

Read the server-side exception in `err.httpResponse.data` first. It usually explains the
failure better than anything on the client.

Some failures happen **before any request is sent**. A misspelled property in a `where`
clause, for example, rejects with an error that has no `httpResponse`:

```
The left hand side of a binary predicate cannot be a literal expression, it must be a valid property or functional predicate expression: companyNme
```

For errors from `saveChanges`, including per-entity validation errors, see
[Saving changes](/guide/saving-changes).

## The data arrived but the entities are wrong

If the logged response body contains the data you expected, the problem is in how Breeze
maps that data to entities. Start from the query's root type:

```ts
const { results } = await em.executeQuery(
  EntityQuery.from(Order).take(1).expand('customer, orderDetails'),
);
const store = em.metadataStore;
const orderType = store.getAsEntityType('Order', true);
const order = results[0];
```

### Are the types defined?

`getAsEntityType(name, true)` returns `null` instead of throwing when the type is
missing. List every type the store knows:

```ts
store.getEntityTypes().forEach(t => console.log(t.name));
```

If your type is absent, or spelled differently, the problem is in the metadata. See
[Metadata](/metadata/).

### Is the result an entity?

```ts
order.entityAspect;       // undefined → not an entity
order.entityType.name;    // should be the Order type
```

If there is no `entityAspect`, Breeze did not recognise the JSON as an entity. Two common
reasons:

- **The query is a projection.** A `select` returns plain objects. See
  [Projections](/query/projections).
- **The payload does not identify the type.** The Breeze .NET server puts a `$type` on each
  entity in the JSON, and that is how Breeze recognises it. For top-level results Breeze can
  also infer the type from the resource name, or from `toType()`. A custom server that
  sends neither needs a [JsonResultsAdapter](/server/jsonresultsadapter).

### Is the property defined?

```ts
orderType.dataProperties.forEach(p => console.log(p.name, p.nameOnServer));
orderType.navigationProperties.forEach(p => console.log(p.name, p.nameOnServer));
orderType.getProperty('orderDate');   // null if there is no such property
```

Data properties and navigation properties are listed separately, and
`getProperties()` returns both.

- **Spelling and case.** `name` is the client name and `nameOnServer` is the name in the
  JSON. If the payload has `OrderDate` but the property's `nameOnServer` is `orderDate`, the
  naming convention in force is not the one you meant. See
  [Naming conventions](/server/namingconvention).
- **Properties you added on the client.** A property defined only in your own code is not in
  metadata. Breeze neither fills it from the payload nor tracks it. Register it as an
  unmapped property instead. See [Extending entities](/guide/extending-entities).

### Is it the kind of property you expected?

Inspect it with `getProperty` and compare with this table:

| Kind | What identifies it |
|---|---|
| Simple data property | `dataType` is a `DataType` such as `DataType.DateTime`; `isScalar` is `true` |
| Unmapped property | `isUnmapped` is `true`; not sent to the server and does not change `entityState` |
| Complex property | `isComplexProperty` is `true`; `complexTypeName` names the type. See [Complex properties](/guide/complex-properties) |
| Foreign key | A data property whose `relatedNavigationProperty` is the navigation property it supports |
| Reference navigation property | Has `entityTypeName`; `isScalar` is `true`; the FK names are in `foreignKeyNames` when this type holds the key |
| Collection navigation property | Has `entityTypeName`; `isScalar` is `false`; `foreignKeyNames` is empty and the child's FK is in `invForeignKeyNames` |

For `Order.customer`, `foreignKeyNames` is `['customerID']`: the order holds the key. For
`Order.orderDetails`, `invForeignKeyNames` is `['orderID']`: each detail holds it. The two
ends of a relationship share an `associationName`. Either end may be omitted.

### When expand does not wire up

Navigation properties return what is in the cache. If `expand('customer')` brought the
customer back but `order.customer` is still `null`, check the payload. The order must
carry the foreign key (`CustomerID` in the JSON), and the metadata must list it in
`foreignKeyNames`. **Breeze associations require foreign keys.** Without one, Breeze
cannot connect the two entities in the cache.

See [Navigation properties](/guide/navigation-properties).
