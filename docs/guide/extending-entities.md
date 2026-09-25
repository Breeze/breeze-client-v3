# Extending entities

Breeze can build every entity from metadata alone, so an entity class — generated or written by
hand — mostly restates what the metadata already says. This page is about the rest: a client-only
flag, a display helper, a computed value, anything the server does not send. You add those by
giving Breeze your own class for the type, an initializer function, or both.

It also covers [class fields and `declare`](#class-fields-and-declare), the one rule that catches
everyone who edits an entity class.

## Why not patch instances

You could add a property to each entity after you get it. That covers entities you create
with `createEntity`. It misses entities Breeze materializes from query results, related
entities that arrive through `expand`, and entities brought in by `importEntities`, and
some of those may already be in the cache with the property set. Patching all of them after
every query and import gets messy quickly. The member belongs on the type.

## Registering a constructor

Write a class and register it with the `MetadataStore` for the entity type:

```ts
import type { Entity, EntityAspect, EntityType } from 'breeze-client';

export class Customer implements Entity {
  // Supplied by Breeze. See "Class fields and declare" below.
  declare entityAspect: EntityAspect;
  declare entityType: EntityType;
  declare getProperty: (prop: string) => any;
  declare setProperty: (prop: any, value: any) => void;

  // Mapped properties, described by metadata.
  declare customerID: string;
  declare companyName: string;
  declare orders: Order[];

  // Client-only.
  isBeingEdited = false;

  get nameLength() {
    return (this.companyName ?? '').length;
  }

  sayHi() {
    return `Hi, my name is ${this.companyName}`;
  }
}

em.metadataStore.registerEntityTypeCtor('Customer', Customer);
```

From then on, every `Customer` Breeze makes is an instance of your class. That covers
`createEntity`, query results and `importEntities`:

```ts
const cust = em.createEntity('Customer', {
  customerID: crypto.randomUUID(),
  companyName: 'Acme',
}) as Customer;

cust instanceof Customer;   // true
cust.sayHi();               // "Hi, my name is Acme"
cust.nameLength;            // 4
```

You don't have to mention mapped properties in the class. Breeze adds them to the class's
prototype when it wires up the type, as accessors that feed change tracking. Declare them
only so TypeScript knows about them.

The four members Breeze supplies can come from a base class instead. `EntityBase` from
`breeze-client` declares them, typing `entityAspect` for your class, and has no runtime
behaviour of its own; `ComplexObjectBase` is the same for complex types. The classes
[the generator](./generating-entities.md) writes extend it:

```ts
import { EntityBase } from 'breeze-client';

export class Customer extends EntityBase {
  declare customerID: string;
  declare companyName: string;
}
```

Register the class before the application creates or queries for any entities of that type.
Entities built earlier keep the default constructor. The registration can come before or
after metadata is loaded.

### One class per MetadataStore

Breeze attaches a class's prototype to one `MetadataStore`'s entity type. Registering the
same class in a second store throws:

```
Cannot register the same constructor for Customer:#… in different metadata stores.
```

If your application has several managers, have them share one `MetadataStore`, either by
passing it in the `EntityManager` config or by calling `createEmptyCopy()`. See
[EntityManager and caching](/guide/entitymanager-and-caching).

### Don't `new` it yourself

`new Customer()` produces an object with no `entityAspect`. It is not in a cache and not
change tracked. Create entities with `em.createEntity(...)` or
`entityType.createEntity(...)`, which run your constructor and then do the rest.

## Class fields and `declare`

::: warning Use `declare` for every member Breeze supplies
If your project compiles with `target` set to ES2022 or later, TypeScript's
`useDefineForClassFields` is on by default. A class field written without `declare` then
becomes a real property on every instance, set to `undefined`, even if it has no
initializer. Breeze's model library puts entity members on the **prototype**, so an
instance property with the same name hides them.
:::

Here is what happens to each kind of member when it is written as a plain field, for
example `companyName: string;`:

| Field | Result |
|---|---|
| `getProperty: …;` `setProperty: …;` | Hides the methods Breeze installs on the prototype. `createEntity` fails with `target.setProperty is not a function`. |
| A client-only field with no initializer, `isBeingEdited: boolean;` | Becomes an [unmapped property](#unmapped-properties) of `DataType.Undefined` with value `null`. It is serialized, but has no data type. |
| A mapped data or navigation property, `companyName: string;` | Works. When Breeze starts tracking an entity it removes instance values for mapped properties and moves them into its backing store. |
| `entityType: EntityType;` | Works. Breeze deletes an instance `entityType` when it attaches the `entityAspect`. |
| `entityAspect: EntityAspect;` | Works. Breeze assigns it straight after construction. |
| `orders: Order[] = [];` | Throws `Nonscalar navigation properties are readonly`. You can't assign a collection navigation property. This isn't new, but `strictPropertyInitialization` nudges you towards writing it. |

The rule that avoids all of this: write `declare` on mapped data properties, navigation
properties, `entityAspect`, `entityType`, `getProperty` and `setProperty`. `declare` emits
no JavaScript, so the instance has nothing that can hide Breeze's accessors. It also
satisfies `strictPropertyInitialization` without an initializer.

Give a real initializer only to client-only properties you want Breeze to treat as unmapped
properties. A mapped property with an initializer, such as `companyName = 'New customer'`,
is allowed. The value becomes the starting value for entities created with
`createEntity`.

The same rules apply to classes registered for complex types, whose Breeze-supplied members
are `complexAspect`, `complexType`, `getProperty` and `setProperty`.

## Unmapped properties

When Breeze wires up the type, it creates one instance of your class and looks at what it
has. Any enumerable, non-function property that isn't in metadata becomes an **unmapped**
data property. Its data type is inferred from the initial value: `false` gives `Boolean`, a
string gives `String`, a number gives `Double`, and a `Date` gives `DateTime`.

Unmapped properties are client-side only. The server has no column for them. Breeze still
carries their values around:

- A save sends them with the entity under a separate `__unmapped` key, which the server can
  read or ignore.
- `exportEntities` includes them, and `importEntities` restores them.

Changing an unmapped property does not change the entity's `entityState`.

If you don't want Breeze to keep a value, don't put it in the class. Set it in an
[initializer](#post-construction-initializer) instead.

### Accessors

Class `get` and `set` accessors live on the prototype and are not enumerable, so Breeze
ignores them. `nameLength` above is an ordinary computed property: it is not tracked and
not serialized.

To make an accessor into an unmapped property that Breeze tracks, define it with
`Object.defineProperty`. It must be `enumerable`, so Breeze can find it, and
`configurable`, so Breeze can wrap it:

```ts
Object.defineProperty(Customer.prototype, 'miscData', {
  get() { return this._miscData ?? ''; },
  set(value) { this._miscData = value; },
  enumerable: true,
  configurable: true,
});
```

## Post-construction initializer

The third argument to `registerEntityTypeCtor` is a function that runs on every entity of
the type, whether created, queried or imported, after its property values are set. It can
therefore read them:

```ts
export class Customer implements Entity {
  // ...Breeze members declared as above...
  declare isBeingEdited: boolean;
}

em.metadataStore.registerEntityTypeCtor('Customer', Customer, (c: Customer) => {
  c.isBeingEdited = false;
});
```

Here `isBeingEdited` is declared, not initialized, so it is not an unmapped property. The
initializer sets it on each instance as a plain property. Breeze doesn't track it, validate
it or serialize it, so it starts at `false` again after an export and re-import.

Pass `null` as the constructor if you only want an initializer:

```ts
em.metadataStore.registerEntityTypeCtor('Employee', null, (emp: Entity) => {
  // runs after the employee's values are populated
});
```

The initializer can also be the name of a method on your class:
`registerEntityTypeCtor('Product', Product, 'init')`. If the type has a base type, the base
type's initializer runs first.

A fourth argument, `noTrackingFn`, applies to `noTracking` queries. It is called after each
untracked object is created, and whatever it returns replaces that object in the results.

### Creation order

For `em.createEntity('Customer', { companyName: 'Acme' })` the order is:

1. your constructor
2. the initial values (`companyName: 'Acme'`)
3. the initializer
4. the entity is added to the manager

For queried and imported entities, the constructor runs first, then the values from the
server or the export bundle are applied, and then the initializer runs.

## Naming conventions

Client property names come from the naming convention in effect: `NamingConvention.camelCase`
unless you set another with `configureBreeze({ namingConvention })`. With `camelCase`, the
server's `CompanyName` is `companyName` on the client, and that is the name to declare in
your class.
See [Naming conventions](/server/namingconvention).

## Temporary keys

When the server generates keys, a new entity needs a temporary key until it is saved.
Breeze's `KeyGenerator` makes one from the key's data type:

| Key data type | Temporary value |
|---|---|
| integer and decimal types | negative numbers: -1, -2, … |
| `String` | `K_` followed by a number |
| `Guid` | a new GUID |

To change this, subclass `KeyGenerator`, override `generateTempKeyValue`, and pass the class
to the manager. Make your value, then hand it to `super.generateTempKeyValue` as its second
argument rather than returning it yourself:

```ts
import { EntityManager, EntityType, KeyGenerator } from 'breeze-client';

/** Temporary integer keys from -1000001 down, where Breeze's own go from -1. */
class MillionsKeyGenerator extends KeyGenerator {
  private next = 1000001;

  generateTempKeyValue(entityType: EntityType, valueIfAvail?: any) {
    return super.generateTempKeyValue(entityType, valueIfAvail ?? -this.next++);
  }
}

const em = new EntityManager({
  serviceName: '/breeze/NorthwindIBModel',
  keyGeneratorCtor: MillionsKeyGenerator,
});
```

The generator keeps a record of the temporary values its manager's entities hold. It is what
stops [`importEntities`](/guide/export-import) from giving an imported entity a key that one
already in the manager has: the manager calls `generateTempKeyValue` with each imported key as
`valueIfAvail`, and `KeyGenerator` keeps the key if it is free and makes a new one if it is not.
Passing your value through `super` records it the same way. Returning it yourself leaves it out
of the record, so an import can reuse it.

Each manager creates its own generator, and a new one when it is cleared, so pass the class,
not an instance, and do it before adding entities to the manager. See
[`KeyGenerator`](/api/classes/KeyGenerator) and [Creating entities](/guide/creating-entities).
