# Complex properties

A **complex property** is a data property whose value is a structured object rather than
a single value. The object's type is a **complex type**: a named set of data properties,
which can include further complex properties.

In Northwind, `Supplier` has a `location` property of the complex type `Location`, which
has `address`, `city`, `region`, `postalCode` and `country`. The path to a supplier's city
is `supplier.location.city`.

## How complex types differ from entity types

- **No identity.** A complex type has no key, and an instance can't stand on its own in
  the cache. It exists only as the value of a property on an entity, or on another complex
  object.
- **No navigation properties,** and no foreign keys.
- **Never null.** A scalar complex property always holds an instance. Breeze creates it
  when it creates the parent. The complex object's own simple properties can be null.
- **Assigned by value.** Assigning a complex object to a complex property copies its
  values into the instance that is already there. It doesn't replace the reference.

## complexType and complexAspect

Every complex object has two members that Breeze adds:

| Member | Analogous to | Contents |
|---|---|---|
| `complexType` | `entity.entityType` | the [`ComplexType`](/api/classes/ComplexType) metadata |
| `complexAspect` | `entity.entityAspect` | the [`ComplexAspect`](/api/classes/ComplexAspect): `parent`, `parentProperty`, `originalValues`, `getEntityAspect()` |

```ts
const location = supplier.getProperty('location');

location.complexType.shortName;              // 'Location'
location.complexAspect.parent === supplier;  // true
location.complexAspect.getEntityAspect();    // supplier.entityAspect
```

Complex objects implement the [`ComplexObject`](/api/interfaces/ComplexObject)
interface, which includes `getProperty` and `setProperty`.

## Reading and writing

```ts
const location = supplier.getProperty('location');
location.setProperty('city', 'Oslo');
// or, with the backing-store model library
location.city = 'Oslo';
```

`getProperty` takes a single property name, not a path. `supplier.getProperty('location.city')`
returns `undefined`. Go through the complex object, or use
`supplier.entityAspect.getPropertyValue('location.city')`, which accepts a path.

### Assigning a whole value

```ts
import { ComplexType } from 'breeze-client';

const locationType = em.metadataStore.getAsEntityType('Location') as ComplexType;
const newLocation = locationType.createInstance({ city: 'Paris', country: 'France' });

supplier.setProperty('location', newLocation);

supplier.getProperty('location') === newLocation;  // false: values were copied
```

`ComplexType.createInstance` makes a standalone complex object, with no parent. Use it to
build a value to assign or to push. Changing `newLocation` after the assignment doesn't
affect the supplier.

A complex property can't be set to `null`:

```ts
supplier.setProperty('location', null);
// Error: You cannot set the 'location' property to null because its datatype is the
// ComplexType: 'Location:#...'
```

An initializer passed to `createEntity` can set a complex property with a plain object:

```ts
em.createEntity('Supplier', { companyName: 'Exotic Liquids', location: { city: 'London' } });
```

## Change tracking

Changing a property of a complex object changes its owning entity:

- An `Unchanged` entity becomes `Modified`.
- The original value is recorded on the **complex object's** `complexAspect.originalValues`,
  keyed by its own property name (`city`). It isn't recorded on the entity's
  `entityAspect.originalValues`.
- The entity's `propertyChanged` event, and the manager's `entityChanged` event, report a
  **property path**, with `parent` set to the complex object:

```ts
supplier.entityAspect.propertyChanged.subscribe(args => {
  args.propertyName;  // 'location.city'
  args.parent;        // the Location object
});
```

`entityAspect.rejectChanges()` restores complex properties too, and `acceptChanges` (or a
successful save) clears their original values.

## Collections of complex objects

If metadata marks a complex property as non-scalar, its value is a complex array. You
change it with the array methods (`push`, `splice`, `pop`, `shift`, `unshift`). You can't
assign it. Northwind has no such property, so suppose a `Customer` has a `roles`
collection of a `Role` complex type:

```ts
const roleType = em.metadataStore.getAsEntityType('Role') as ComplexType;
const roles = customer.getProperty('roles');
roles.push(roleType.createInstance({ name: 'Buyer' }));
```

Changing the array marks the owning entity `Modified`, and raises `arrayChanged` on the
array. A complex object can be in one parent at a time. Pushing one that already belongs
to another parent throws, so create a new instance instead.

## Queries

Use a property path to filter on a complex property:

```ts
EntityQuery.from('Suppliers').where('location.city', 'startsWith', 'L');
```

This works against the server and against the cache.

Entities that have complex properties save like any other entity.

## Metadata

`MetadataStore.getEntityType` returns an `EntityType` or a `ComplexType`. So does its
preferred replacement, `getStructuralType`. Tell them apart with `instanceof`:

```ts
const type = em.metadataStore.getStructuralType('Location');
if (type instanceof ComplexType) { /* ... */ }
```

`getEntityTypes()`, `addEntityType()` and `registerEntityTypeCtor()` also accept or
return complex types.

## Validation

- Validating an entity validates its complex properties, and their properties in turn.
- A validation error on a complex object's property reports the full path in
  `propertyName`, for example `location.city`.

See [Validation](/guide/validation).

::: tip Changed in 3.0
`ComplexObject.getProperty` and `setProperty` are now typed as required rather than
optional. The backing-store model library has always installed them, so no runtime
behaviour changed.
:::
