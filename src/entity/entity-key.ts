import { core } from '../core/core.js';
import { paramError } from '../core/assert-param.js';
import { EntityType, MetadataStore, entityTypeForCtor } from '../metadata/entity-metadata.js';
import type { Entity } from './entity-aspect.js';
import { DataType } from '../metadata/data-type.js';

/**
An EntityKey is an object that represents the unique identity of an entity.  EntityKey's are immutable.


*/
export class EntityKey {
  /** @hidden @internal */
  declare _$typeName: string; // actually placed on prototype
  /** @hidden @internal */
  static ENTITY_KEY_DELIMITER = ":::";
  /**  The 'EntityType' that this is a key for. __Read Only__ */
  entityType: EntityType;
  /**  An array of the values for this key. This will usually only have a single element, 
  unless the entity type has a multipart key. __Read Only__ */
  values: any[];
  /** @hidden @internal */
  _keyInGroup: string;
  /** @hidden @internal */
  _subtypes: EntityType[];

  /**
  Constructs a new EntityKey.  Each entity within an EntityManager will have a unique EntityKey.
  ```ts
  // assume Employee is registered with the MetadataStore
  const entityKey = new EntityKey(Employee, 1);
  ```

  EntityKey's may also be found by calling EntityAspect.getKey()
  ```ts
  // assume employee1 is an existing Employee entity
  const empKey = employee1.entityAspect.getKey();
  ```

  A key of more than one property is clearest given by name, in any order:
  ```ts
  const detailKey = new EntityKey(OrderDetail, { orderID: 10248, productID: 11 });
  ```

  or as an array, in the order of the type's {@link EntityType.keyProperties}: the order of the
  key's definition on the server - `HasKey(od => new { od.OrderID, od.ProductID })` - which a
  generated entity class states in its doc comment, as `Key: orderID, productID`.
  ```ts
  const sameKey = new EntityKey(OrderDetail, [10248, 11]);
  ```
  A wrong order is not an error - it is a valid key for another row - which is why the named form
  is better for these.
  @param entityType - The {@link EntityType} of the entity, or a class registered for it with
  {@link MetadataStore.registerEntityTypeCtor}.
  @param keyValues - The key's value; for a key of more than one property, an object of values by
  property name, or an array in key order. A named value that is not part of the key, or a key
  property with no value, throws.
  */
  constructor(entityType: EntityType | (new () => Entity), keyValues: any) {
    // A class stands for its registered type. Checked by typeof first, so the EntityType that
    // Breeze itself always passes costs one comparison.
    if (typeof entityType === "function") entityType = entityTypeForCtor(entityType);
    // Inline, not assertParam: an EntityKey is built for every entity and again for every
    // foreign key the relationship fixup resolves. Same wording.
    if (!(entityType instanceof EntityType)) {
      throw paramError('entityType', "must be an instance of 'EntityType'");
    }
    // Only types that take part in an inheritance hierarchy need this, and getSelfAndSubtypes
    // allocates an array and walks the hierarchy to find that out. Guarding on `subtypes` keeps
    // the common case - a type with no subtypes, where the walk can only return [this] -
    // allocation-free. `subtypes` is filled while metadata is built and not touched after.
    if (entityType.subtypes.length > 0) {
      let subtypes = entityType.getSelfAndSubtypes();
      if (subtypes.length > 1) {
        this._subtypes = subtypes.filter(function (st) {
          return st.isAbstract === false;
        });
      }
    }

    if (!Array.isArray(keyValues)) {
      keyValues = isPlainObject(keyValues) ? keyValuesByName(entityType, keyValues) : [keyValues];
    }

    this.entityType = entityType;
    entityType.keyProperties.forEach(function (kp, i) {
      // insure that guid keys are comparable.
      if (kp.dataType === DataType.Guid) {
        keyValues[i] = keyValues[i] && keyValues[i].toLowerCase ? keyValues[i].toLowerCase() : keyValues[i];
      }
    });

    this.values = keyValues;
    this._keyInGroup = EntityKey.createKeyString(keyValues);

  }


  /** Returns the plain form of this key - `{ entityType, values }`, with the entity type's qualified
  name - which `JSON.stringify` uses and {@link EntityKey.fromJSON} turns back into a key. Breeze
  uses it to record temporary keys in an {@link EntityManager.exportEntities} bundle. */
  toJSON() {
    return {
      /** The qualified name of the key's entity type, such as `"Customer:#Northwind.Models"`. */
      entityType: this.entityType.name,
      /** The key's values, one per key property. */
      values: this.values
    };
  }

  /** Recreates a key from the output of {@link EntityKey.toJSON}, looking its entity type up in
  `metadataStore`. Throws if the type is not there. Used by {@link EntityManager.importEntities}. */
  static fromJSON(json: any, metadataStore: MetadataStore) {
    let et = metadataStore._getStructuralType(json.entityType, true) as EntityType;
    return new EntityKey(et, json.values);
  }

  /**
  Used to compare EntityKeys are determine if they refer to the same Entity.
  There is also an static version of 'equals' with the same functionality.

  ```ts
  // assume Employee is registered with the MetadataStore
  const empKey1 = new EntityKey(Employee, 1);
  // assume employee1 is an existing Employee entity
  const empKey2 = employee1.entityAspect.getKey();
  if (empKey1.equals(empKey2)) {
      // do something  ...
  }
  ```
  */
  equals(entityKey: EntityKey): boolean {
    if (!(entityKey instanceof EntityKey)) return false;
    return (this.entityType === entityKey.entityType) &&
      core.arrayEquals(this.values, entityKey.values);
  }

  /** Returns this key as a string: the entity type's qualified name, a hyphen, and the key values
  joined by `:::` - such as `"Order:#Northwind.Models-10248"`. Given `altEntityType`, that type's
  name is used instead. Breeze uses this form in error messages and as the property names of an
  {@link ITempKeyMap}. */
  /*
  Returns a human readable representation of this EntityKey.
  */
  toString(altEntityType?: EntityType) {
    return (altEntityType || this.entityType).name + '-' + this._keyInGroup;
  }

  /**
  Used to compare EntityKeys are determine if they refer to the same Entity.
  There is also an instance version of 'equals' with the same functionality.
  ```ts
  // assume Employee is registered with the MetadataStore
  const empKey1 = new EntityKey(Employee, 1);
  // assume employee1 is an existing Employee entity
  const empKey2 = employee1.entityAspect.getKey();
  if (EntityKey.equals(empKey1, empKey2)) {
      // do something  ...
  }
  ```
  */
  static equals(k1: EntityKey, k2: EntityKey) {
    if (!(k1 instanceof EntityKey)) return false;
    return k1.equals(k2);
  }

  /** @hidden @internal */
  // TODO: we may want to compare to default values later.
  _isEmpty() {
    return this.values.join("").length === 0;
  }

  /** hidden */
  // TODO: think about giving _ prefix or documenting.
  static createKeyString(keyValues: any[]) {
    return keyValues.join(EntityKey.ENTITY_KEY_DELIMITER);
  }

}
EntityKey.prototype._$typeName = "EntityKey";

/** An object literal - not an array, a Date, or any other object a single key value could be. */
function isPlainObject(value: any): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The key values given by name, put in the order of the type's key properties. */
function keyValuesByName(entityType: EntityType, values: Record<string, any>) {
  const keyProps = entityType.keyProperties;
  const names = keyProps.map(kp => kp.name);
  for (const name of Object.keys(values)) {
    if (!names.includes(name)) {
      throw new Error(`'${name}' is not part of the key of ${entityType.name}, which is ${names.join(', ')}.`);
    }
  }
  return keyProps.map(kp => {
    if (!(kp.name in values)) {
      throw new Error(`The key of ${entityType.name} is ${names.join(', ')}; no value was given for '${kp.name}'.`);
    }
    return values[kp.name];
  });
}


