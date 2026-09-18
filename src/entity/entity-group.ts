import { Entity } from './entity-aspect.js';
import { EntityType, DataProperty  } from '../metadata/entity-metadata.js';
import { EntityKey } from './entity-key.js';
import { EntityState } from './entity-state.js';
import { EntityManager } from '../manager/entity-manager.js';
import { MergeStrategy } from '../query/query-options.js';

/** @hidden @internal */
export class EntityGroup {
  entityManager: EntityManager;
  entityType: EntityType;
  /**
   * Key string -> index into `_entities`. A `Map` and not an object literal: an object inherits
   * `Object.prototype`, so an entity whose string key happened to be `__proto__` was attached but
   * could never be found again - the assignment ran the inherited setter and stored nothing.
   * Keys here are always strings (`EntityKey.createKeyString` joins the values), which an object
   * did for us by coercion and a `Map` does not - see `_fixupKey`.
   */
  _indexMap: Map<string, number>;
  _entities: (Entity | null)[];
  _emptyIndexes: number[];
  /**
   * The entities in this group whose state is not Unchanged, maintained by `EntityAspect`'s
   * `entityState` setter. `hasChanges` is then a size check rather than a scan of the group,
   * which is what made detaching, accepting or rejecting n changed entities quadratic.
   */
  _changedEntities: Set<Entity>;

  constructor(entityManager: EntityManager, entityType: EntityType) {
    this.entityManager = entityManager;
    this.entityType = entityType;
    // freeze the entityType after the first instance of this type is either created or queried.
    this.entityType.isFrozen = true;
    this._indexMap = new Map();
    this._entities = [];
    this._emptyIndexes = [];
    this._changedEntities = new Set();
  }


  attachEntity(entity: Entity, entityState: EntityState, mergeStrategy?: MergeStrategy) {
    // entity should already have an aspect.
    let aspect = entity.entityAspect;

    if (!aspect._initialized) {
      this.entityType._initializeInstance(entity);
    }
    // Assigned, not deleted. Deleting an own property changes the object shape, and this runs
    // for every entity attached - see "delete on a hot path" in CHANGES-DEV.md.
    aspect._initialized = undefined;

    let keyInGroup = aspect.getKey()._keyInGroup;
    let ix = this._indexMap.get(keyInGroup);
    if (ix !== undefined) {
      // safecast because key was found not ix will not return a null
      let targetEntity = this._entities[ix] as Entity;
      let targetEntityState = targetEntity.entityAspect.entityState;
      let wasUnchanged = targetEntityState.isUnchanged();
      if (targetEntity === entity) {
        aspect.entityState = entityState;
      } else if (mergeStrategy === MergeStrategy.Disallowed) {
        throw new Error("A MergeStrategy of 'Disallowed' does not allow you to attach an entity when an entity with the same key is already attached: " + aspect.getKey());
      } else if (mergeStrategy === MergeStrategy.OverwriteChanges || (mergeStrategy === MergeStrategy.PreserveChanges && wasUnchanged)) {
        // unwrapInstance returns an entity with server side property names - so we need to use DataProperty.getRawValueFromServer these when we apply
        // the property values back to the target.
        let rawServerEntity = this.entityManager.helper.unwrapInstance(entity);
        this.entityType._updateTargetFromRaw(targetEntity, rawServerEntity, DataProperty.getRawValueFromServer);
        targetEntity.entityAspect.setEntityState(entityState);
      }
      return targetEntity;
    } else {
      if (this._emptyIndexes.length === 0) {
        ix = this._entities.push(entity) - 1;
      } else {
        ix = this._emptyIndexes.pop()!;
        this._entities[ix] = entity;
      }
      this._indexMap.set(keyInGroup, ix);
      // The group has to be in place before the state is: the `entityState` setter is what puts
      // this entity into `_changedEntities`, and it needs to know which group to put it in.
      aspect.entityGroup = this;
      aspect.entityManager = this.entityManager;
      aspect.entityState = entityState;
      if (aspect.hasTempKey) reserveTempKeyValue(this.entityManager, entity.entityType, aspect.getKey().values[0]);
      return entity;
    }
  }

  detachEntity(entity: Entity) {
    // by this point we have already determined that this entity
    // belongs to this group.
    let aspect = entity.entityAspect;
    let keyInGroup = aspect.getKey()._keyInGroup;
    let ix = this._indexMap.get(keyInGroup);
    if (ix === undefined) {
      // shouldn't happen.
      throw new Error("internal error - entity cannot be found in group");
    }
    this._indexMap.delete(keyInGroup);
    this._changedEntities.delete(entity);
    this._emptyIndexes.push(ix);
    this._entities[ix] = null;
    if (aspect.hasTempKey) releaseTempKeyValue(this.entityManager, entity.entityType, aspect.getKey().values[0]);
    return entity;
  }


  // returns entity based on an entity key defined either as an array of key values or an EntityKey
  findEntityByKey(entityKey: EntityKey) {
    let keyInGroup: string;
    if (entityKey instanceof EntityKey) {
      keyInGroup = entityKey._keyInGroup;
    } else {
      keyInGroup = EntityKey.createKeyString(entityKey);
    }
    let ix = this._indexMap.get(keyInGroup);
    // can't use just (ix) below because 0 is valid
    let r = (ix !== undefined) ? this._entities[ix] : undefined;
    // coerce null to undefined
    return r == null ? undefined : r;
  }

  hasChanges() {
    return this._changedEntities.size > 0;
  }

  getChanges() {
    // Deliberately still a scan of `_entities` rather than a copy of `_changedEntities`: this is
    // what fixes the order changed entities are saved in, and `_entities` order is attach order
    // where a Set's is the order each entity first became dirty.
    let entities = this._entities;
    let unchanged = EntityState.Unchanged;
    let changes: Entity[] = [];
    for (let i = 0, len = entities.length; i < len; i++) {
      let e = entities[i];
      if (e && e.entityAspect.entityState !== unchanged) {
        changes.push(e);
      }
    }
    return changes;
  }

  getEntities(entityStates: EntityState[]) {
    let filter = getFilter(entityStates);
    return this._entities.filter(filter) as Entity[];
  }

  _checkOperation(operationName: string) {
    this._entities.forEach(function (entity) {
      entity && entity.entityAspect._checkOperation(operationName);
    });
    // for chaining;
    return this;
  }

  // do not expose this method. It is doing a special purpose INCOMPLETE fast detach operation
  // just for the entityManager clear method - the entityGroup will be in an inconsistent state
  // after this op, which is ok because it will be thrown away.
  // TODO: rename this to be clear that it is UNSAFE...
  _clear() {
    this._entities.forEach(function (entity) {
      if (entity != null) {
        entity.entityAspect._detach();
      }
    });
    (this as any)._entities = null;
    (this as any)._indexMap = null;
    (this as any)._emptyIndexes = null;
    (this as any)._changedEntities = null;
  }

  _updateFkVal(fkProp: DataProperty, oldValue: any, newValue: any) {
    let fkPropName = fkProp.name;
    this._entities.forEach(function (entity) {
      if (entity != null) {
        if (entity.getProperty(fkPropName) === oldValue) {
          entity.setProperty(fkPropName, newValue);
        }
      }
    });
  }

  _fixupKey(tempValue: any, realValue: any) {
    // Single part keys appear directly in the map. Both values arrive from the server's
    // keyMappings and are usually numbers, where the map is keyed by string - the object literal
    // this used to be coerced them on the way in and a `Map` does not.
    let tempKey = String(tempValue);
    let ix = this._indexMap.get(tempKey);
    if (ix === undefined) {
      throw new Error("Internal Error in key fixup - unable to locate entity");
    }
    let entity = this._entities[ix] as Entity;
    let keyPropName = entity.entityType.keyProperties[0].name;
    // fks on related entities will automatically get updated by this as well
    entity.setProperty(keyPropName, realValue);
    entity.entityAspect.hasTempKey = undefined;   // not delete; see attachEntity above
    releaseTempKeyValue(this.entityManager, entity.entityType, tempValue);
    this._indexMap.delete(tempKey);
    this._indexMap.set(String(realValue), ix);
  }

  _replaceKey(oldKey: EntityKey, newKey: EntityKey) {
    let ix = this._indexMap.get(oldKey._keyInGroup)!;
    this._indexMap.delete(oldKey._keyInGroup);
    this._indexMap.set(newKey._keyInGroup, ix);
  }

}

function getFilter(entityStates: EntityState[]) {
  if (entityStates.length === 0) {
    return function (e: Entity) {
      return !!e;
    };
  } else if (entityStates.length === 1) {
    let entityState = entityStates[0];
    return function (e: Entity) {
      return !!e && e.entityAspect.entityState === entityState;
    };
  } else {
    return function (e: Entity) {
      return !!e && -1 !== entityStates.indexOf(e.entityAspect.entityState);
    };
  }
}


// do not expose EntityGroup - internal only



// Keep the manager's KeyGenerator's record of temporary key values in step with the entities that
// hold them: see KeyGenerator._releaseTempKeyValue and _reserveTempKeyValue. A generator passed as
// `keyGeneratorCtor` need not extend KeyGenerator, hence the optional calls.

function releaseTempKeyValue(em: EntityManager, entityType: EntityType, value: any) {
  (em.keyGenerator as any)?._releaseTempKeyValue?.(entityType, value);
}

function reserveTempKeyValue(em: EntityManager, entityType: EntityType, value: any) {
  (em.keyGenerator as any)?._reserveTempKeyValue?.(entityType, value);
}
