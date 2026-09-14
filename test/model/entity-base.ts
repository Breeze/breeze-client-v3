// @generated-by generate-entity-classes v1.0.0
// This whole file is generated. Put hand-written code in a separate module.
//
// The members Breeze itself supplies. Every generated class extends one of these.
//
// Each one is `declare`: with ES2022 class fields a plain field would become a real own
// property set to undefined, hiding the accessors Breeze installs on the prototype. See
// docs/guide/extending-entities.md, "Class fields and declare".
import type { ComplexAspect, ComplexObject, ComplexType, Entity, EntityAspect, EntityType } from 'breeze-client';

export abstract class EntityBase implements Entity {
  declare entityAspect: EntityAspect;
  declare entityType: EntityType;
  declare getProperty: (prop: string) => any;
  declare setProperty: (prop: any, value: any) => any;
}

export abstract class ComplexObjectBase implements ComplexObject {
  declare complexAspect: ComplexAspect;
  declare complexType: ComplexType;
  declare getProperty: (prop: string) => any;
  declare setProperty: (prop: any, value: any) => any;
}
