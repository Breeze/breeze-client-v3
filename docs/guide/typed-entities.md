# Typed entities

Breeze's API was untyped: `executeQuery` gave you `results: any[]`, `createEntity` gave you an
`Entity`, and you reached properties through `getProperty("companyName")`. Breeze 3 adds a type
parameter to those APIs, so the compiler can check what you wrote.

```ts
const custs = await EntityQuery.from(Customer).where('city', 'eq', 'London').using(em).execute();
custs.results[0].companyName;     // checked: Customer has companyName
custs.results[0].freight;         // error: Property 'freight' does not exist on type 'Customer'
```

Nothing about this is required. Every call written before the type parameters existed compiles and
behaves exactly as it did — see [Existing code is unaffected](#existing-code-is-unaffected).

## Two ways to say what the type is, and they are not equivalent

::: warning One is checked, the other is asserted
`EntityQuery.from(Customer)` is verified against metadata. `EntityQuery.from<Customer>('Customers')`
is a claim the compiler takes on trust. Reach for the first wherever you can.
:::

### Passing the constructor — checked

```ts
em.metadataStore.registerEntityTypeCtor('Customer', Customer);   // once, at startup

const q = EntityQuery.from(Customer);          // EntityQuery<Customer>
const cust = em.createEntity(Customer, { companyName: 'Acme' });   // Customer
const all = em.getEntities(Customer);          // Customer[]
const changed = em.getChanges(Customer);       // Customer[]
```

`T` is inferred from a real value, so there is no type to keep in sync with a string, and the
resource name comes from the metadata (`Customer.prototype.entityType.defaultResourceName`) rather
than being written out again.

**This requires [registering the constructor](/guide/extending-entities#registering-a-constructor).**
That is what puts `entityType` on the class's prototype. A class that was never registered has
nothing to read, and Breeze says so rather than building a query against `undefined`:

```
'Customer' is not registered with a MetadataStore, so its EntityType is unknown.
Call metadataStore.registerEntityTypeCtor('Customer', Customer) before using the constructor with this API.
```

Registration also means **one class per `MetadataStore`** for the life of the process. Managers that
should share types must share a store. See
[One class per MetadataStore](/guide/extending-entities#one-class-per-metadatastore).

### Passing a resource name — asserted

```ts
const q = EntityQuery.from<Customer>('Customers');   // EntityQuery<Customer>
```

Here `T` is a promise *you* make to the compiler. Nothing checks it, so this compiles too:

```ts
const lie = EntityQuery.from<Customer>('Orders');    // no error. Returns orders, typed as customers.
```

You get full IntelliSense on properties that will be `undefined` at run time. It is `as` with
better syntax — useful, but not type safety.

It earns its place where there is no constructor to pass:

- **projections** — `select()` changes the shape to something no entity class describes
- **named server queries** that return a DTO rather than an entity type
- **anonymous results**

`select()` reflects this: it returns `EntityQuery<any>`, because the rows are no longer entities.

```ts
EntityQuery.from(Customer)          // EntityQuery<Customer>
  .select('companyName, city');     // EntityQuery<any>
```

## What gained a type parameter

| | |
|---|---|
| `EntityQuery<T>` | `from(ctor)`, and every chaining method keeps `T` |
| `QueryResult<T>` | `results: T[]` |
| `EntityManager.executeQuery(query)` | `Promise<QueryResult<T>>` |
| `EntityManager.executeQueryLocally(query)` | `T[]` |
| `EntityManager.createEntity(ctor, …)` | `T` |
| `EntityManager.getEntities(ctor, …)` | `T[]` |
| `EntityManager.getChanges(ctor)` | `T[]` |
| `EntityManager.fetchEntityByKey(ctor, …)` | `EntityByKeyResult<T>` |
| `EntityManager.getEntityByKey(ctor, …)` | `T \| null` |
| `EntityManager.attachEntity(entity)`, `addEntity(entity)` | gives back what it was given, rather than widening to `Entity` |
| `EntityManager.hasChanges(ctor)` | accepts a constructor, like `getChanges` |
| `EntityQuery.fromEntities(entities)` | `EntityQuery<T>` |
| `EntityQuery.toType(ctor)` | `EntityQuery<T>` — and unlike a type argument on `from(name)`, this one **is** checked |
| `RelationArray<T>.load()` | `Promise<QueryResult<T>>` |
| `EntityType.createEntity<T>()` | `T` (defaults to `any`, which is what it always returned) |

`entityTypeForCtor(ctor)` is exported too, for writing your own helpers over the same mechanism.

::: tip `toType` is the checked way to type a named query
`EntityQuery.from<Customer>('CustomersAndOrders')` is an assertion. `EntityQuery
.from('CustomersAndOrders').toType(Customer)` names the type through metadata, so it is verified
— and it is what `toType` was always for.
:::

### Passing a plain `Entity` never narrows anything

`fromEntities` and `RelationArray.load()` take their type from what you give them. Give them a
`Customer` and you get a `Customer` query; give them a plain `Entity` — which is all anyone had
before these type parameters existed — and the result stays `any`:

```ts
const entity: Entity = em.createEntity(Customer, { companyName: 'Acme' });
const q = EntityQuery.fromEntities(entity);          // EntityQuery<any>, not EntityQuery<Entity>
q.using(em).execute().then(d => d.results[0].anything);   // still compiles
```

Letting it infer `EntityQuery<Entity>` there would break every existing caller — it broke nine
lines of Breeze's own specs before this was fixed.

### `executeCount`

Unrelated to typing, but new alongside it: the count of matching rows without materializing any.

```ts
const howMany = await EntityQuery.from(Order).where('freight', '>', 100).using(em).executeCount();
```

It is `take(0).inlineCount(true)` and reads `inlineCount` off the result, so the server has to
support inline count.

## Existing code is unaffected

Every type parameter has a default that reproduces the type that API had before, so code written
against 2.x keeps compiling unchanged:

```ts
const qr = await em.executeQuery(new EntityQuery('Customers'));
qr.results[0].getProperty('companyName');   // results is any[], exactly as before
```

`QueryResult<T = any>` in particular defaults to **`any`**, not `Entity`. Widening it to `Entity`
would be a breaking change — every `qr.results[0].companyName` in existing code would stop
compiling.

Type parameters and overloads are erased by the compiler, so the JavaScript Breeze emits is
unchanged and there is no runtime cost to any of this.

## Generating the classes

Writing an entity class per type by hand is tedious and drifts from the server. `breeze-client`
ships a generator that writes them from your service's metadata:

```bash
npx breeze-gen-entities \
  --service http://localhost:34377/breeze/NorthwindIBModel \
  --out src/app/model
```

It updates existing files per member rather than overwriting them, so methods and getters you add
survive regeneration. See [Generating entity classes](./generating-entities.md).
