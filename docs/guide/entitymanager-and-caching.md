# EntityManager and caching

The `EntityManager` is the center of a Breeze application. It does three jobs:

1. It talks to one persistence service: fetching metadata, running queries, sending saves.
2. It holds a cache of entities: everything you have queried, created, changed or marked
   for deletion.
3. It tracks the state of every entity in that cache, so it knows what to save.

When you query, the results go into the cache. When you create an entity, it is added to
the cache. When you delete an entity, it stays in the cache, marked `Deleted`, until you
save. On `saveChanges()` the manager collects the added, modified and deleted entities,
sends them to the server, and on success updates the cache: deleted entities are removed,
and the rest become `Unchanged`.

## Creating a manager

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/NorthwindIBModel');
```

The string is the service name. It is shorthand for a configuration object:

```ts
const em = new EntityManager({ serviceName: '/breeze/NorthwindIBModel' });
```

| Option | Type | Notes |
|---|---|---|
| `serviceName` | `string` | service root; metadata comes from `<serviceName>/Metadata` |
| `dataService` | `DataService` | alternative to `serviceName` when you need more control |
| `metadataStore` | `MetadataStore` | defaults to a new, empty store; pass one to share metadata |
| `queryOptions` | `QueryOptions` | default fetch and merge strategies for queries |
| `saveOptions` | `SaveOptions` | default options for `saveChanges` — see [Saving changes](/guide/saving-changes) |
| `validationOptions` | `ValidationOptions` | when validation runs automatically — see [Validation](/guide/validation) |
| `keyGeneratorCtor` | class | generates temporary keys for new entities |

Options you omit take the class's `defaultInstance` (for example
`QueryOptions.defaultInstance`). To change settings on an existing manager, use
`setProperties`:

```ts
import { QueryOptions, MergeStrategy } from 'breeze-client';

em.setProperties({
  queryOptions: new QueryOptions({ mergeStrategy: MergeStrategy.OverwriteChanges }),
});
```

`metadataStore` can only be set in the constructor.

## What the manager can do

A summary by task. See the [EntityManager API reference](/api/classes/EntityManager) for
the full list.

### Querying

| Method | |
|---|---|
| `executeQuery(query)` | runs an `EntityQuery` (on the server by default); returns a promise of a `QueryResult` |
| `executeQueryLocally(query)` | runs an `EntityQuery` against the cache, synchronously; returns an array |
| `fetchEntityByKey(type, key, checkCacheFirst?)` | fetches one entity by key; returns a promise |
| `fetchMetadata()` | fetches metadata explicitly; normally the first query does it for you |

### Finding entities in the cache

| Method | |
|---|---|
| `getEntityByKey(type, key)` | one entity from the cache, or `null` |
| `getEntities(types?, states?)` | all cached entities, optionally filtered by type and `EntityState` |
| `getChanges(types?)` | entities that are `Added`, `Modified` or `Deleted` |
| `hasChanges(types?)` | whether there are any such entities |
| `executeQueryLocally(query)` | see above, and [Querying the cache](/query/locally) |

```ts
import { EntityState } from 'breeze-client';

const cust = em.getEntityByKey('Customer', customerId);
const newOrders = em.getEntities('Order', EntityState.Added);
const orderChanges = em.getChanges(['Order', 'OrderDetail']);

const { entity, fromCache } = await em.fetchEntityByKey('Employee', 1, true);
```

With `checkCacheFirst` set to `true`, `fetchEntityByKey` returns the cached entity if
there is one and only goes to the server if not. `fromCache` tells you which happened.

### Adding, attaching and detaching

| Method | |
|---|---|
| `createEntity(type, values?, state?)` | creates an entity and adds it (state `Added` by default) |
| `addEntity(entity)` | adds an entity created elsewhere, as `Added` |
| `attachEntity(entity, state?)` | adds an entity with any state; the default is `Unchanged` |
| `detachEntity(entity)` | removes an entity from the cache; its state becomes `Detached` |
| `clear()` | detaches everything, keeping all settings |

See [Creating entities](/guide/creating-entities).

### Saving

| Method | |
|---|---|
| `saveChanges(entities?, saveOptions?)` | saves all pending changes, or the entities you pass |

See [Saving changes](/guide/saving-changes).

### Export and import

| Method | |
|---|---|
| `exportEntities(entities?, options?)` | serializes some or all of the cache to a string or object |
| `importEntities(exported, config?)` | merges a previous export into this manager |

See [Export and import](/guide/export-import).

## Rejecting changes

`rejectChanges` rolls back pending changes: all of them with `em.rejectChanges()`, or one
entity's with `entity.entityAspect.rejectChanges()`.

What that means depends on the entity's state:

- **Modified or Deleted** — property values go back to their original values, navigation
  properties are re-linked, and the state becomes `Unchanged`.
- **Added** — there is no earlier state to go back to, so the entity is detached. Its
  state becomes `Detached`. Your code may still hold a reference to it; it is no longer in
  the cache.

`em.rejectChanges()` returns the entities it affected.

## Accepting changes

`entity.entityAspect.acceptChanges()` makes the entity look as if it has just been
saved: its state becomes `Unchanged` (or `Detached`, if it was `Deleted`) and its original
values are discarded. `em.acceptChanges()` does the same for every changed entity.

Nothing is sent to the server. Temporary keys stay temporary, and foreign keys that point
at them are not updated. Breeze does this itself after a successful save. In your own code
it is mainly useful in tests. In production code it is usually a mistake.

## Events

| Event | Fires when | Arguments |
|---|---|---|
| `entityChanged` | any entity in the cache is attached, detached, merged, changed, accepted, rejected, or the cache is cleared | `entityAction`, `entity`, `args` |
| `hasChangesChanged` | the manager goes from having no changes to having some, or back | `entityManager`, `hasChanges` |
| `validationErrorsChanged` | any cached entity's validation errors change | `entity`, `added`, `removed` |

```ts
import { EntityAction } from 'breeze-client';

em.hasChangesChanged.subscribe(({ hasChanges }) => {
  saveButton.disabled = !hasChanges;
});

em.entityChanged.subscribe(({ entityAction, entity }) => {
  if (entityAction === EntityAction.PropertyChange) {
    console.log(`${entity?.entityType.shortName} changed`);
  }
});
```

`subscribe` returns a token you can pass to `unsubscribe`. `entityAction` is one of the
`EntityAction` values: `Attach`, `AttachOnQuery`, `AttachOnImport`, `Detach`,
`MergeOnQuery`, `MergeOnImport`, `MergeOnSave`, `PropertyChange`, `EntityStateChange`,
`AcceptChanges`, `RejectChanges` or `Clear`.

## More than one manager

Most applications use one manager. A second one is useful when you want to isolate a unit
of work. For example, edit a customer in its own manager so that cancelling means throwing
the manager away, without disturbing changes elsewhere.

`createEmptyCopy()` gives you a new manager with the same data service, metadata store,
query, save and validation options, and no entities:

```ts
const editManager = em.createEmptyCopy();
```

Managers that share a `MetadataStore` share metadata, so the copy does not fetch it
again. You can also share a store explicitly:

```ts
const em2 = new EntityManager({
  serviceName: '/breeze/NorthwindIBModel',
  metadataStore: em.metadataStore,
});
```

An entity belongs to one manager at a time. Attaching an entity that is already in
another manager throws. To move entities between managers, export them from one and import
them into the other. See [Export and import](/guide/export-import).

## Keeping the cache fresh

People worried about stale data sometimes avoid the cache altogether. There is no need
to. Most data is stable. For the few types that must always be current, you can re-query
and still keep the results in the cache.

### Re-query from scratch

The simplest approach is to detach every cached entity of the type, then query:

```ts
import { EntityQuery, Predicate } from 'breeze-client';

async function getOrders(where?: Predicate) {
  em.getEntities('Order').forEach(o => em.detachEntity(o));

  let query = EntityQuery.from('Orders');
  if (where) query = query.where(where);
  const { results } = await em.executeQuery(query);
  return results;
}
```

Detaching first means that orders deleted by another user since your last query
disappear from the cache. There are costs:

- **Pending changes are lost.** Detaching an added, modified or deleted order discards the
  change. Guard with `em.hasChanges('Order')` if that could happen.
- **Old references go stale.** Anything in your UI still holding a previous order object
  now holds a detached entity. After the query, every cached order is a new instance.

If orders are never hard-deleted (for example, you mark them inactive instead), you do
not need the detach step. A normal query merges fresh values into the existing instances.

To refresh a single entity, query for it:

```ts
import type { Entity } from 'breeze-client';

async function refreshOrder(order: Entity) {
  const { results } = await em.executeQuery(EntityQuery.fromEntities(order));
  return results[0];
}
```

### Refresh in place

To refresh existing instances without discarding pending changes, and still drop
entities that were deleted on the server, compare the query results with the cache:

```ts
async function refreshAllOrders() {
  const cached = new Set(em.getEntities('Order'));
  const { results } = await em.executeQuery(EntityQuery.from('Orders'));
  results.forEach(o => cached.delete(o));

  // What is left was deleted on the server, or is new and not yet saved.
  const removed = [...cached].filter(o => !o.entityAspect.entityState.isAdded());
  removed.forEach(o => em.detachEntity(o));
  return { results, removed };
}
```

The query uses the manager's default merge strategy, `MergeStrategy.PreserveChanges`, so
orders with unsaved changes keep them. Other orders are updated with the server's values.

## See also

- [Inside the entity](/guide/inside-the-entity) — `entityAspect`, `EntityState`, original values
- [Change tracking](/guide/change-tracking)
- API: [EntityManager](/api/classes/EntityManager), [EntityManagerConfig](/api/interfaces/EntityManagerConfig), [EntityAspect](/api/classes/EntityAspect)
