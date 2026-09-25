import type { ComplexObject, Entity, EntityAspectOf, ComplexAspectOf } from './entity-aspect.js';
import type { ComplexType, EntityType } from '../metadata/entity-metadata.js';

// Every member is `declare`, so these classes compile to empty ones. With ES2022 class fields a
// plain field would become a real own property set to undefined, hiding the accessors Breeze
// installs on the prototype. Breeze never registers or writes to these classes themselves - only
// to the classes that extend them - so one copy is safely shared by every model.

/**
A base class for entity classes: it declares the members Breeze supplies, so that a class
extending it declares only its own properties. The classes `breeze-gen-entities` writes extend it.
```ts
export class Customer extends EntityBase {
  declare customerID: string;
  declare companyName: string;
}
```
Extend it with a class of your own to give every entity the same behaviour:
```ts
export abstract class AppEntityBase extends EntityBase {
  get isNew() { return this.entityAspect.entityState.isAdded(); }
}
```
It has no runtime behaviour - Breeze does not require it. A class can instead implement
{@link Entity} and declare these members itself.
*/
export abstract class EntityBase implements Entity {
  /** Called by the constructor of the class that extends it. It does nothing. */
  constructor() {}

  /** The {@link EntityAspect} Breeze attaches to the entity. Of `this`, so that `originalValues`
  and `getOriginalValue` know the class's properties. */
  declare entityAspect: EntityAspectOf<this>;
  /** The {@link EntityType} the entity's class is registered for. */
  declare entityType: EntityType;
  /** Returns the value of a property by name. Installed by the model library adapter. */
  declare getProperty: (prop: string) => any;
  /** Sets the value of a property by name. Installed by the model library adapter. */
  declare setProperty: (prop: any, value: any) => any;
}

/**
The complex-type counterpart of {@link EntityBase}: a base class for complex object classes, which
declares the members Breeze supplies.
```ts
export class Location extends ComplexObjectBase {
  declare address: string;
  declare city: string;
}
```
*/
export abstract class ComplexObjectBase implements ComplexObject {
  /** Called by the constructor of the class that extends it. It does nothing. */
  constructor() {}

  /** The {@link ComplexAspect} Breeze attaches to the complex object. */
  declare complexAspect: ComplexAspectOf<this>;
  /** The {@link ComplexType} the object's class is registered for. */
  declare complexType: ComplexType;
  /** Returns the value of a property by name. Installed by the model library adapter. */
  declare getProperty: (prop: string) => any;
  /** Sets the value of a property by name. Installed by the model library adapter. */
  declare setProperty: (prop: any, value: any) => any;
}
