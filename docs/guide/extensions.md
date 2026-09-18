# Optional extensions

`breeze-client` is the whole library an application normally needs. The extensions on this page
are extra, each in a subpath of its own, and none of them does anything until you import it. A
bundler leaves out every one you do not import.

## At a glance

| Extension | Import from | What it gives you | Needs | Acts on import |
|---|---|---|---|---|
| [Save queuing](#save-queuing) | `breeze-client/mixin-save-queuing` | a save made while another is in flight waits and follows it, and edits made during a save are kept | — | no: call `enableSaveQueuing(em, true)` for each manager |
| [Entity graphs](#entity-graphs) | `breeze-client/mixin-get-entity-graph` | an entity and everything an expand path reaches from it, **including deleted entities**, from the cache | — | **yes**: adds `getEntityGraph` to every `EntityManager` |
| [RxJS](#rxjs) | `breeze-client/rxjs` | Breeze events as RxJS observables | `rxjs`, which you install | no |

**Needs** is what the extension asks you to install. `breeze-client` itself installs nothing else,
and none of these change that: RxJS is an *optional* peer dependency, so npm does not install it
for you, and an application that does not use `breeze-client/rxjs` never gets it. The test suite
checks that nothing reachable from `breeze-client` imports RxJS.

**Acts on import** matters for tree-shaking. Entity graphs is the one extension that changes
something just by being imported, which is why it is the one module named in the package's
`sideEffects`. The other two are functions: importing them does nothing until you call one.

## Save queuing

```ts
import { enableSaveQueuing } from 'breeze-client/mixin-save-queuing';
```

Some applications save automatically after every edit, and a user can easily make a
second change before the first save returns. Save queuing handles that: while a save is
in flight, further `saveChanges` calls are held back and sent as one follow-up save when
the first returns.

It also does the thing you would otherwise have to do yourself — **it keeps edits made
while the save was out**. It records what changed on each entity being saved, re-applies
those values over the server's response, and sends them in the follow-up save. Without it
they are [quietly overwritten](/guide/saving-changes#changes-during-a-save):

```ts
cust.companyName = 'Second';
em.saveChanges();               // in flight
cust.companyName = 'Third';     // the user keeps typing
// without queuing: companyName is back to 'Second' when the save returns
// with queuing:    'Third', and 'Third' is what the database ends up holding
```

A foreign key set during a save is handled too: if you point a child at a parent whose row
is still being inserted, the only key you have is the temporary one, and the queued save
substitutes the key the server assigned.

```ts
enableSaveQueuing(em, true);

const p1 = em.saveChanges();   // sent now
editSomething();
const p2 = em.saveChanges();   // queued; sent when p1's save returns
```

Each promise resolves with the result of the save that included its changes. If a queued
save fails, every pending promise rejects with a
[`QueuedSaveFailedError`](/api/classes/QueuedSaveFailedError). Its
`innerError` is the underlying error.

Limitations:

- The `SaveOptions` of the first save are reused for the queued saves.
- Only the promise form works. The deprecated callback arguments are ignored.
- It does not queue parallel saves, even of independent change-sets.
- It is meant for short-latency auto-save. It does not help with offline work, and it does
  not cope with `rejectChanges`, export/import or primary-key changes while a save is in
  flight.

Turn it off again with `enableSaveQueuing(em, false)`. Calling it more than once on the
same manager is harmless. Reference:
[`enableSaveQueuing`](/api/functions/enableSaveQueuing).

## Entity graphs

```ts
import 'breeze-client/mixin-get-entity-graph';
import type { HasEntityGraph } from 'breeze-client/mixin-get-entity-graph';
```

`getEntityGraph` returns an entity together with everything an expand path reaches from it, from
the cache, without going to the server:

```ts
const graph = (em as HasEntityGraph).getEntityGraph(customer, 'orders.orderDetails');
// customer, its orders, and their details
```

What it does that walking the navigation properties yourself does not:

- **It includes deleted entities.** Deleting an order takes it out of `customer.orders`, but not out
  of the graph — and not its details either. That is the list to hand to
  `em.saveChanges(graph)` when you want to save a customer's changes *including* what was deleted.
- **It is linear in what it returns.** Children are found by indexing them on their foreign key once
  per expand segment, so a customer with 8,000 orders and 24,000 details takes about 10 ms.

It takes one root or an array of them, and an expand path in any form a query accepts — a string,
an array of strings, or an `ExpandClause`. It also takes a query instead of roots, which it runs
against the cache, using the query's own `expand` unless you pass one:

```ts
const q = EntityQuery.from('Customers')
  .where('companyName', 'startsWith', 'Alf')
  .expand('orders');
const graph = (em as HasEntityGraph).getEntityGraph(q);
```

The result has no duplicates and no particular order. An expand segment that names something that
is not a navigation property throws, naming the segment and the type:
`'getEntityGraph' can't expand 'noSuchProperty' for Customer:#Foo`.

### Importing it

The import on its own is enough: it adds `getEntityGraph` to `EntityManager.prototype`, for every
manager. `HasEntityGraph` is the type of a manager that has it. TypeScript cannot see what an import
added to a class, so cast, or declare your manager as `HasEntityGraph` where you create it.

Because an import that only has an effect is exactly what an aggressive bundler may drop,
`breeze-client` lists this module in `sideEffects` so that bundlers keep it. If yours drops it anyway,
call the function yourself — adding it twice is harmless:

```ts
import { mixinEntityGraph } from 'breeze-client/mixin-get-entity-graph';
mixinEntityGraph(EntityManager);
```

Reference: [`HasEntityGraph`](/api/interfaces/HasEntityGraph),
[`mixinEntityGraph`](/api/functions/mixinEntityGraph).

## RxJS

```ts
import { entityChanged$, hasChanges$ } from 'breeze-client/rxjs';
```

Breeze's events — `entityChanged`, `hasChangesChanged`, `propertyChanged` and the rest — as RxJS
observables, so they compose with the rest of an application's streams and tear down with its
other subscriptions. `hasChanges$` starts with the manager's current value, which is what a Save
button needs and what a hand-written `BehaviorSubject(false)` gets wrong.

Install `rxjs` yourself; any version from 7.0 on works.

It has a page of its own, because the part that needs care — unsubscribing, and sharing one
subscription without leaking it — takes more than a paragraph: **[RxJS](/guide/rxjs)**.
