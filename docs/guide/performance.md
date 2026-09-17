# Performance

Breeze does a lot per entity: change tracking, validation, relationship fixup, key management,
events. Most applications never need to think about it. When you do — a grid over thousands of
rows, a bulk import, a generated data set — it helps to know which parts are expensive, because
the answers are not where people usually look.

Everything below is measured, not estimated. See [How these were measured](#how-these-were-measured).

## What an operation costs

Per entity, using the Northwind `Order` type (14 data properties, 4 navigation properties):

| operation | cost | made up of |
|---|---|---|
| `em.createEntity('Order')` | ~13 µs | building it ~2 µs, **attaching it to the manager ~11 µs** |
| the same entity from a query | ~6 µs | queries skip validation and batch their events |
| setting a tracked property | ~0.7 µs | **96% change tracking**, ~2% the backing store |
| reading a tracked property | ~9 ns | an accessor over a plain object |
| relating two entities | ~3 µs | the same either way you say it — see below |

Two things follow. Attaching to an `EntityManager` costs several times more than creating the
object, and setting a property is almost entirely change tracking — the property accessors
themselves barely register.

## Automatic validation

Validation is the largest single cost in change tracking:

| option | default | share of the operation |
|---|---|---|
| `validateOnPropertyChange` | `true` | about **63%** of setting a tracked property |
| `validateOnAttach` | `true` | about **38%** of attaching an entity |

For ordinary screens that is a good trade and you should leave it alone. For a loop over
thousands of entities it is the first thing to turn off — then validate deliberately at the end:

```ts
const saved = em.validationOptions;
em.setProperties({
  validationOptions: saved.using({ validateOnPropertyChange: false, validateOnAttach: false }),
});
try {
  // ... build or edit many entities ...
} finally {
  em.setProperties({ validationOptions: saved });
}
em.getEntities().forEach(e => e.entityAspect.validateEntity());   // once, at the end
```

`validateOnSave` is different: it runs once per changed entity at save time, and turning it off
means sending data the server may reject. Leave it on. See [Validation](/guide/validation).

## Let queries build entities

An entity that arrives from a query costs about half what the same entity costs through
`createEntity`, because the loading path suppresses per-property events and does not validate
(unless you turn on `validateOnQuery`). If you have a choice between querying data and
constructing the equivalent entities in a loop, query.

## Collections are created on first read

A collection navigation - `order.orderDetails` - is an empty relation array until something
reads it. Creating one costs about 0.5 µs and 400 bytes, including the array's `arrayChanged`
event, and most collections on most entities are never touched, so an entity only pays for the
ones it uses.

Measured over 50,000 attached entities, each type in its own process:

| type | collection navigations | eager | lazy |
|---|---|---|---|
| `Order` | 1 | 3,285 B | 2,909 B |
| `Customer` | 1 | 3,590 B | 3,190 B |
| `Employee` | 3 | 5,822 B | 3,927 B |

Building a detached entity drops from about 1.74 µs to 1.18 µs with it. Attaching one is
unchanged - that cost is validation and manager bookkeeping, not collections.

The array is created on the first read and kept, so its identity is stable from then on:

```ts
const a = order.orderDetails;
const b = order.orderDetails;   // the same array
a.push(detail);                 // and normal in every other way
```

Reading is the only thing that creates it. Attaching an entity, deleting one, validating one or
propagating a key change all skip collections that do not exist yet - there is nothing in an
uncreated collection for any of them to act on. A query creates only the collections its payload
actually carries.

## Relating entities

The three ways of saying it cost the same, because they all end in the same place — each sets the
other, and the recursion is cut off once the state is consistent:

```ts
customer.orders.push(order);              // ~3.2 µs
order.customer = customer;                // ~3.2 µs
order.customerID = customer.customerID;   // ~2.7 µs
```

About 4× a plain property set, for two entities updated, a foreign key kept in step, and the
events. Pick whichever reads best.

Adding to a collection does not get slower as the collection fills: Breeze checks the child's own
back-reference rather than searching the array, so a push into a 16,000-element collection costs
what a push into an empty one does.

**Moving a child from one parent to another** is the exception. Breeze has to find it in the old
parent's collection and take it out, and removing from the front of a large array shifts
everything after it. Re-parenting thousands of children one at a time is around 4× the cost of
attaching the same children to a parent for the first time. If you are reassigning a large
collection wholesale, it is cheaper to detach the old parent than to move each child.

**Emptying a collection** — which is what detaching or deleting the parent does — is one
operation, not one per child. All the children are unparented, the collection is truncated in one
go, and a single `arrayChanged` is published carrying every one of them. Detaching a customer with
16,000 orders takes about 6 ms.

::: tip One event, not one per child
If you subscribe to `arrayChanged`, a detach or delete gives you a single notification whose
`removed` holds the whole collection. Handle it as a batch rather than assuming one entity per
event — the same as for the adds a query produces.
:::

## Reads are cheap

Reading a tracked property goes through an accessor on the prototype to a plain backing object:
about 9 ns, or 1.7× a direct property read. Iterating results, reading properties in a template
or a grid cell renderer — none of that needs avoiding.

The collections are real arrays, so `forEach`, `map`, indexing and spreading are the engine's
native operations rather than anything Breeze interposes on.

## Bundle size

The package is side-effect free apart from the entity-graph mixin, so a bundler drops what you
do not use. Bundled with Vite from the published package, unminified:

| the app imports | bundle |
|---|---|
| `MetadataStore` only | 330 KB |
| `EntityManager` | 455 KB |
| `EntityManager` + `breeze-client/mixin-get-entity-graph` | 460 KB |

Minified, a typical application — core plus the three standard adapters — is about 168 KB, or
46 KB gzipped. Import the [adapter subpaths](/guide/configuration) you use rather than pulling
in ones you do not.

## How these were measured

Node 24, 20,000 entities per run, each variant in its own process so that one shape does not
pollute another's inline caches. Ratios are more durable than absolute figures: your engine,
your metadata and the number of validators on your properties all move the numbers, and a
micro-benchmark never matches an application exactly. Measure your own workload before
optimising it — and be prepared for the answer to be somewhere other than where you expected,
which is how this page came about.
