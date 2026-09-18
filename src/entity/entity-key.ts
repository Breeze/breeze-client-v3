import { core } from '../core/core.js';
import { paramError } from '../core/assert-param.js';
import { EntityType, MetadataStore } from '../metadata/entity-metadata.js';
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
  >     // assume em1 is an EntityManager containing a number of existing entities.
  >     var empType = em1.metadataStore.getAsEntityType("Employee");
  >     var entityKey = new EntityKey(empType, 1);

  EntityKey's may also be found by calling EntityAspect.getKey()
  >     // assume employee1 is an existing Employee entity
  >     var empKey = employee1.entityAspect.getKey();

  Multipart keys are created by passing an array as the 'keyValues' parameter
  >     var empTerrType = em1.metadataStore.getAsEntityType("EmployeeTerritory");
  >     var empTerrKey = new EntityKey(empTerrType, [ 1, 77]);
  >     // The order of the properties in the 'keyValues' array must be the same as that
  >     // returned by empTerrType.keyProperties
  @param entityType - The {@link EntityType} of the entity.
  @param keyValues - A single value or an array of values. 
  */
  constructor(entityType: EntityType, keyValues: any) {
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
      keyValues = [keyValues];
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
  
  >      // assume em1 is an EntityManager containing a number of existing entities.
  >      var empType = em1.metadataStore.getAsEntityType("Employee");
  >      var empKey1 = new EntityKey(empType, 1);
  >      // assume employee1 is an existing Employee entity
  >      var empKey2 = employee1.entityAspect.getKey();
  >      if (empKey1.equals(empKey2)) {
  >          // do something  ...
  >      }
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
  >      // assume em1 is an EntityManager containing a number of existing entities.
  >      var empType = em1.metadataStore.getAsEntityType("Employee");
  >      var empKey1 = new EntityKey(empType, 1);
  >      // assume employee1 is an existing Employee entity
  >      var empKey2 = employee1.entityAspect.getKey();
  >      if (EntityKey.equals(empKey1, empKey2)) {
  >          // do something  ...
  >      }
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


