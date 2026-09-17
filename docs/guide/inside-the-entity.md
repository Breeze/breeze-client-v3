# Inside the entity

A domain object such as a `Customer` has data (`companyName`), relationships (`orders`),
and perhaps some business logic (`isGoldCustomer`). Those members are what your
application binds to its UI and reasons about.

A `Customer` is also an **entity**: a long-lived object with a permanent key. It can be
fetched, cached, changed, validated and saved. Questions like "has it changed?", "what
were its values?" and "is it valid?" are about its *entity nature*. Breeze handles that
part, and you reach it through two members on every entity: `entityType` and
`entityAspect`.

## entityType

`entity.entityType` returns the entity's [`EntityType`](/api/classes/EntityType): the
metadata that describes its properties, keys and associations.

```ts
const orderType = order.entityType;
orderType.shortName;                        // 'Order'
orderType.keyProperties.map(p => p.name);   // ['orderID']
```

See [Metadata](/metadata/).

## entityAspect

A Breeze entity is self-tracking. It holds its state, and the means to change that state,
in the [`EntityAspect`](/api/classes/EntityAspect) returned by `entity.entityAspect`.

An object gets its `EntityAspect`, and keeps it for the rest of its life, when any one of
these happens:

- it enters the cache as the result of a query or an import
- it is created by `em.createEntity` or `EntityType.createEntity` (see
  [Creating entities](/guide/creating-entities))
- it is added to, or attached to, an `EntityManager`

This page covers `EntityAspect` in four parts: entity state, property change
notification, validation, and everything else.

## EntityState

`entityAspect.entityState` answers two questions: is the entity in a cache, and if so,
has it changed? Its value is one of the [`EntityState`](/api/classes/EntityState) values:

| EntityState | Meaning |
|---|---|
| `Added` | A new entity in the cache that doesn't exist in the database yet. |
| `Unchanged` | An existing entity in the cache, with no changes since it was last queried or saved. |
| `Modified` | An existing entity in the cache, with pending changes. |
| `Deleted` | An existing entity in the cache that is marked for deletion. |
| `Detached` | An entity that isn't in any cache. Its state in the database is unknown. |

Compare against the enum value, or use the test methods:

```ts
import { EntityState } from 'breeze-client';

const state = order.entityAspect.entityState;

if (state === EntityState.Modified) { /* ... */ }
if (state.isModified()) { /* ... */ }
if (state.isAddedModifiedOrDeleted()) { /* ... */ }   // "has pending changes"
```

The test methods are `isAdded`, `isUnchanged`, `isModified`, `isDeleted`, `isDetached`,
`isAddedOrModified`, `isUnchangedOrModified` and `isAddedModifiedOrDeleted`. Every enum
value also has a `name` (`'Modified'`), which is useful for display.

### Transitions

Breeze updates the state as things happen to the entity:

| Before | Action | After |
|---|---|---|
| — | Materialized in the cache by a query | `Unchanged` |
| `Unchanged` | Set one of its properties | `Modified` |
| `Modified` | Save it successfully | `Unchanged` |
| `Unchanged` | [Mark it deleted](#deleting) | `Deleted` |
| `Deleted` | Save it successfully | `Detached` |
| — | Create it with `EntityType.createEntity` | `Detached` |
| `Detached` | Add it to a manager | `Added` |
| `Added` | Delete it, or [reject its changes](#rejectchanges) | `Detached` |

Two of these transitions surprise people:

- After you delete an **existing** entity and save, it becomes detached. Breeze can't make
  the object disappear, and it may still be on screen. It no longer exists on the server,
  though, so Breeze removes it from the cache.
- Deleting a **new** entity detaches it immediately. Breeze doesn't wait for a save,
  because there is nothing on the server to delete.

### Detached entities

A detached entity doesn't belong to an `EntityManager`. It is still an entity, just not
one in a cache.

Don't keep detached entities around. Either attach one to a manager, or drop your
references to it so that it can be garbage-collected. A detached entity still has its
data values, and you can still set them. But its
[navigation properties](/guide/navigation-properties) are empty, and you can't tell by
looking at it whether there is a matching record in the database. You also can't change
its state: calling `setModified`, `setDeleted` or similar on a detached entity throws.

New entities often start out detached. Create them, initialize them (if the key isn't
generated, set it, since every entity in a cache needs a unique key), and add them to a
manager straight away.

These actions detach an entity:

- `em.detachEntity(entity)` or `entity.entityAspect.setDetached()`
- `em.clear()`
- deleting, or rejecting the changes of, an `Added` entity
- a successful save of a `Deleted` entity

Detaching an entity doesn't delete it. If it existed in the database, it still does.
A detached entity keeps its foreign key values, but its navigation properties are
cleared.

### Forcing a state change

These `EntityAspect` methods change the state directly:

| Method | Effect |
|---|---|
| `setDeleted()` | Marks the entity for deletion. See [below](#deleting). |
| `rejectChanges()` | Reverts pending changes. See [below](#rejectchanges). |
| `setModified()` | Marks the entity `Modified`. |
| `setUnchanged()` | Marks the entity `Unchanged`, and clears its original values. |
| `acceptChanges()` | Like `setUnchanged()`, except that a `Deleted` entity is detached. |
| `setAdded()` | Marks the entity `Added`. Unlike `em.addEntity`, it doesn't generate a key. |
| `setDetached()` | Removes the entity from its manager. |
| `setEntityState(state)` | Any of the above, by value. |

Production code rarely calls `setModified`, `setUnchanged`, `setAdded` or `acceptChanges`,
because entities reach those states as a side effect of normal work. They are most useful
for putting test fixtures into a known state. Remember that `setUnchanged` and
`acceptChanges` discard the original values, so the entity can no longer be reverted.

`em.acceptChanges()` and `em.rejectChanges()` apply to every changed entity in the cache.

### Deleting

Deleting starts with a state change:

```ts
order.entityAspect.setDeleted();
```

`setDeleted` doesn't destroy the object, and doesn't touch the database. The entity stays
in the cache as `Deleted` until you save. It is also removed from the collections of its
related entities, and its scalar navigation properties are set to `null`, but its foreign
key values are kept. A successful save deletes the entity from the database and removes it
from the cache.

### rejectChanges

Once you change an entity, it stays changed, even if you set the old value back by hand:

```ts
const name = customer.companyName;              // Unchanged
customer.companyName = 'Something new';         // Modified
customer.companyName = name;                    // still Modified
```

`rejectChanges` cancels pending changes. It restores the original values, and sets the
entity's state back to `Unchanged` (an `Added` entity becomes `Detached`):

```ts
customer.companyName = 'Something new';         // Modified
customer.entityAspect.rejectChanges();          // Unchanged
customer.companyName === name;                  // true
```

A deleted entity whose changes are rejected goes back into the collections it was removed
from.

### Original values

When you first change a property of an `Unchanged` or `Modified` entity, Breeze records
the value it had before, in `entityAspect.originalValues`. That object is keyed by
property name. It is empty while the entity is `Unchanged`, and it contains only the
properties that have changed since the last query or save. Later changes to the same
property don't overwrite the recorded value.

```ts
const changed = Object.keys(order.entityAspect.originalValues);
// e.g. ['freight', 'shipName']
```

`Added` entities don't record original values, since they have nothing to go back to.
Original values for properties of a complex object are kept on the complex object's
`complexAspect.originalValues` (see [Complex properties](/guide/complex-properties)).

These all replace `originalValues` with an empty object: a successful save,
`rejectChanges`, `setUnchanged` and `acceptChanges`.

## propertyChanged

The `entityAspect.propertyChanged` event lets you listen for a change to any tracked
property of an entity, with a single subscription:

```ts
const token = order.entityAspect.propertyChanged.subscribe(args => {
  // args.entity, args.propertyName, args.oldValue, args.newValue
});

// later
order.entityAspect.propertyChanged.unsubscribe(token);
```

A few things to know:

- Breeze monitors only the properties defined in metadata, both mapped and unmapped. It
  doesn't track properties you add to an entity outside the metadata.
- Changes to `EntityAspect` properties don't raise the event. In particular, a change of
  `entityState` doesn't raise it. Listen to `em.entityChanged` for that.
- Some operations update many properties at once: a query or save that merges new values
  into a cached entity, or `rejectChanges`. They raise a single event, with
  `propertyName` set to `null`.

[Change tracking](/guide/change-tracking) covers this event and the manager's
`entityChanged` event in more detail.

## Validation

Properties can be validated as they change, against the rules registered in metadata.
Metadata from a Breeze .NET server already includes some of these rules: `required` for
non-nullable properties, and `maxLength` for strings with a length limit. You can add
your own as well. See [Validation](/guide/validation).

You can also validate on demand:

| Member | Purpose |
|---|---|
| `validateEntity()` | Runs every property rule and every entity-level rule. Returns `true` if all pass. |
| `validateProperty(property, context?)` | Runs every rule for one property. |
| `getValidationErrors(property?)` | A copy of the current errors, for the entity or one property. |
| `hasValidationErrors` | `true` while there are any errors. |
| `addValidationError(error)` | Adds a [`ValidationError`](/api/classes/ValidationError) yourself. |
| `removeValidationError(errorKeyOrValidator)` | Removes one error, or every error a given validator produced. |
| `clearValidationErrors()` | Removes all of them. |
| `validationErrorsChanged` | An event raised when errors are added or removed. |

A rule either passes, or fails and produces a `ValidationError`. Breeze keeps the
entity's current errors on its aspect. It adds an error when a rule fails, and removes it
when the same rule later passes.

```ts
order.entityAspect.validationErrorsChanged.subscribe(({ entity, added, removed }) => {
  // added and removed are arrays of ValidationError
});
```

## Other EntityAspect members

| Member | Purpose |
|---|---|
| `entity` | The entity this aspect belongs to. |
| `entityManager` | The manager the entity is attached to, or was last attached to. Undefined for an entity that has never been attached. |
| `getKey()` | The entity's [`EntityKey`](/api/classes/EntityKey): an object holding the entity type and the key value, or values (Breeze supports composite keys). |
| `hasTempKey` | `true` while the entity has a temporary key that the server will replace. |
| `isBeingSaved` | `true` while a save that includes this entity is in progress. Calling `acceptChanges`, `rejectChanges` or `setEntityState` meanwhile throws. |
| `loadNavigationProperty(name)` | Queries the server for a navigation property's entities. See [Navigation properties](/guide/navigation-properties). |
| `isNavigationPropertyLoaded(name)` | Whether that navigation property has been loaded. |
| `getPropertyValue(path)` | The value at a property path such as `'customer.companyName'` or `'location.city'`. |

## Members on the entity itself

Most of the Breeze infrastructure is reached through `entityAspect`, but Breeze also puts
a few members on the entity's prototype:

- **`entityType`**, the type's metadata, described [above](#entitytype).
- **`getProperty(name)`**, which returns a property's value.
- **`setProperty(name, value)`**, which sets it.

```ts
customer.setProperty('companyName', 'Ima Something Corp');
customer.getProperty('companyName');   // 'Ima Something Corp'
```

With the backing-store model library, `getProperty` and `setProperty` behave the same as
reading and assigning the property directly. `setProperty` goes through the same path as
an assignment, so it records original values, changes the entity state, validates and
raises events in the same way. Code written with them doesn't need a TypeScript
interface for the entity.

`getProperty` takes a single property name, not a path. If `setProperty` gets a name that
isn't in the metadata, it creates an ordinary untracked property instead of throwing, so
check your spelling.

To use property syntax with type checking, describe your entities with interfaces that
extend [`Entity`](/api/interfaces/Entity):

```ts
import type { Entity } from 'breeze-client';

interface Order extends Entity {
  orderID: number;
  freight: number | null;
  customer: Customer | null;
  orderDetails: OrderDetail[];
}

const order = em.createEntity('Order') as Order;
order.freight = 12.5;   // tracked, just like setProperty
```

The entity also carries internals such as `_backingStore` and `_$interceptor`. Leave them
alone.