# Change tracking

Breeze entities are **self-tracking**. Each entity keeps its own change state, and
remembers the values it had before you changed it. That information lives in the entity's
`entityAspect`. This page introduces the parts of it that concern change tracking; see
[Inside the entity](/guide/inside-the-entity) for the rest.

## How properties are tracked

Breeze 3 has one model library, the **backing store**. For each data and navigation
property in the metadata, it defines an accessor property on the entity type's prototype,
and it keeps the values in a private store on each instance. As a result, an ordinary
assignment is tracked:

```ts
order.freight = 12.5;               // tracked
order.setProperty('freight', 12.5); // same thing
```

A tracked change can:

- record the old value in `entityAspect.originalValues`
- change `entityAspect.entityState` from `Unchanged` to `Modified`
- validate the new value, if `validateOnPropertyChange` is on (it is by default)
- raise `entityAspect.propertyChanged` and `EntityManager.entityChanged`

Validation is much the most expensive of these — see
[Performance](/guide/performance#automatic-validation) if you are setting properties in bulk.

Breeze tracks only the properties in the metadata, and those include any unmapped
properties you register. A property you add to an entity yourself (`order.note = 'x'`) is
an ordinary JavaScript property, and Breeze ignores it. Changing an **unmapped** property
raises events, but doesn't make an `Unchanged` entity `Modified`.

Setting a property to its current value isn't a change, so nothing happens.

## EntityState

`entity.entityAspect.entityState` tells you where the entity stands:

| State | Meaning |
|---|---|
| `Added` | New, in the cache, not yet in the database |
| `Unchanged` | In the cache, unchanged since it was queried or last saved |
| `Modified` | In the cache, with pending changes |
| `Deleted` | In the cache, marked for deletion |
| `Detached` | Not in any cache |

An [`EntityState`](/api/classes/EntityState) has methods that test for one state
(`isAdded()`, `isUnchanged()`, `isModified()`, `isDeleted()`, `isDetached()`) and for
useful combinations (`isAddedOrModified()`, `isUnchangedOrModified()`,
`isAddedModifiedOrDeleted()`).

Breeze updates the state as things happen:

| Action | New state |
|---|---|
| Arrives in the cache from a query | `Unchanged` |
| You set one of its properties | `Modified` |
| Saved successfully | `Unchanged` |

### Deleting

To delete an entity, mark it:

```ts
order.entityAspect.setDeleted();
```

This doesn't destroy the object, and it doesn't touch the database. The entity stays in
the cache as `Deleted` until you save. A successful save deletes it on the server, and
detaches it from the cache. Deleting an `Added` entity detaches it immediately, because
there is nothing on the server to delete.

## Reverting

Changing a value back by hand doesn't undo the change; the entity stays `Modified`:

```ts
const name = customer.getProperty('companyName');       // entity is Unchanged
customer.setProperty('companyName', 'Something else');  // Modified
customer.setProperty('companyName', name);              // still Modified
```

`rejectChanges` restores the original values and returns the entity to `Unchanged`:

```ts
customer.setProperty('companyName', 'Something else');
customer.entityAspect.rejectChanges();
// companyName is back to its original value; entityState is Unchanged
```

To revert every pending change in the cache, call `em.rejectChanges()`. It returns the
entities it reverted.

## propertyChanged

An entity's `entityAspect.propertyChanged` event fires whenever one of its tracked
properties changes:

```ts
const token = order.entityAspect.propertyChanged.subscribe(args => {
  args.entity;        // the order
  args.propertyName;  // e.g. 'freight', or 'location.city' for a complex property
  args.oldValue;
  args.newValue;
});
```

The arguments are a [`PropertyChangedEventArgs`](/api/interfaces/PropertyChangedEventArgs).
Some operations change many properties at once: `rejectChanges`, or a query or save that
merges new values into a cached entity. For those, Breeze raises a single
`propertyChanged` with `propertyName` set to `null`.

### It doesn't report state changes

`entityState` belongs to the `EntityAspect`, not to the entity, so a change from
`Unchanged` to `Modified` doesn't raise `propertyChanged`. To hear about state changes,
listen to [`entityChanged`](#entitymanager-entitychanged) on the manager.

### Unsubscribe when you are done

A subscription keeps its handler reachable from the entity. If the handler refers to a
view or a component, then that object can't be garbage-collected while the entity is
alive. `subscribe` returns a token. Pass it to `unsubscribe` once the listener is no
longer needed:

```ts
order.entityAspect.propertyChanged.unsubscribe(token);
```

If you are subscribing to many entities, subscribe once to the manager's `entityChanged`
instead.

## EntityManager.entityChanged

The manager raises `entityChanged` for every change to an entity in its cache. Its
arguments are an [`EntityChangedEventArgs`](/api/interfaces/EntityChangedEventArgs):

- `entityAction` says what happened
- `entity` is the entity it happened to
- `args` holds the `propertyChanged` arguments, when the action is a property change

```ts
import { EntityAction } from 'breeze-client';

const token = em.entityChanged.subscribe(({ entityAction, entity, args }) => {
  if (entityAction === EntityAction.PropertyChange) {
    console.log(`${entity!.entityType.shortName}.${args!.propertyName} changed`);
  } else if (entityAction === EntityAction.EntityStateChange) {
    console.log(`now ${entity!.entityAspect.entityState.name}`);
  }
});
```

The [`EntityAction`](/api/classes/EntityAction) values are:

| EntityAction | When |
|---|---|
| `Attach` | an entity was added or attached (`addEntity`, `attachEntity`, `createEntity`) |
| `AttachOnQuery` | a query attached an entity |
| `AttachOnImport` | an import attached an entity |
| `Detach` | an entity was detached |
| `MergeOnQuery` | a query merged new values into a cached entity |
| `MergeOnImport` | an import merged new values into a cached entity |
| `MergeOnSave` | a save merged the server's values into a cached entity |
| `PropertyChange` | a property changed |
| `EntityStateChange` | the `entityState` changed |
| `AcceptChanges` | `acceptChanges` was called |
| `RejectChanges` | `rejectChanges` was called |
| `Clear` | the manager was cleared (`entity` is undefined) |

`isAttach()`, `isDetach()` and `isModification()` group them.

## hasChanges and hasChangesChanged

```ts
em.hasChanges();                     // any Added, Modified or Deleted entities?
em.hasChanges('Order');              // ... of this type (or an array of types)
em.getChanges();                     // the changed entities
em.getChanges(['Order', 'OrderDetail']);
```

`hasChangesChanged` fires only when the answer to `hasChanges()` flips, which makes it a
good event to bind a Save button to:

```ts
em.hasChangesChanged.subscribe(({ hasChanges }) => {
  saveButton.disabled = !hasChanges;
});
```

## Validation errors

Breeze validates property values against rules from the metadata and rules you add (see
[Validation](/guide/validation)). Each `EntityAspect` holds the entity's current
validation errors. When errors are added or removed, it raises `validationErrorsChanged`:

```ts
order.entityAspect.validationErrorsChanged.subscribe(({ entity, added, removed }) => {
  // added and removed are arrays of ValidationError
});
```

The manager has a `validationErrorsChanged` event too, for every entity in its cache.

By default, Breeze validates entities before saving them. If any entity fails, it sends
none of them. Client-side validation is for the user's benefit; it doesn't replace
validation on the server.

## Turning events off

`BreezeEvent.enable` turns an event off or on, for an object and everything beneath it:

```ts
import { BreezeEvent } from 'breeze-client';

BreezeEvent.enable('propertyChanged', em, false);  // every entity in em
BreezeEvent.enable('entityChanged', em, false);
BreezeEvent.enable('propertyChanged', em, true);   // back on
```

Instead of a boolean, the third argument can be a function that receives the object and
returns a boolean. Breeze calls it each time the event fires.

::: tip Changed in 3.0
The Knockout model library is gone, and so are observable properties such as
`order.freight()` and `order.freight(12.5)`. Entity properties are always plain
properties. To drive a UI, bind to the plain values, and use the events on this page to
find out when they change.
:::

## Next

Once you have pending changes, [save them](/guide/saving-changes).
