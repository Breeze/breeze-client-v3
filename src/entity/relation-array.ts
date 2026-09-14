import { BreezeEvent } from '../core/event.js';
import { ObservableArray, ObservableArrayOps, observableArray } from './observable-array.js';
import { EntityState } from './entity-state.js';
import { EntityQuery } from '../query/entity-query.js';
import type { Entity } from './entity-aspect.js';
import type { QueryErrorCallback, QueryResult, QuerySuccessCallback } from '../manager/entity-manager.js';
import type { DataProperty, NavigationProperty } from '../metadata/entity-metadata.js';

export interface RelationArray<T extends Entity = Entity> extends ObservableArray<T> {
  parentEntity: Entity;
  parentProperty?: DataProperty;
  navigationProperty: NavigationProperty;
  load(querySuccessCallback?: QuerySuccessCallback, queryErrorCallback?: QueryErrorCallback): Promise<QueryResult>;
}

/**
 Relation arrays are not a class: they are real arrays whose mutating methods are replaced, so that
 changing one updates both ends of the relationship. A relation array is a collection of entities
 associated with a navigation property on a single entity, i.e. customer.orders or
 order.orderDetails.
 @class {relationArray}
 **/

/**
An {@link BreezeEvent} that fires whenever the contents of this array changed.  This event
is fired any time a new entity is attached or added to the EntityManager and happens to belong to this collection.
Adds that occur as a result of query or import operations are batched so that all of the adds or removes to any individual
collections are collected into a single notification event for each relation array.
@example
    // assume order is an order entity attached to an EntityManager.
    orders.arrayChanged.subscribe(
    function (arrayChangedArgs) {
        let addedEntities = arrayChangedArgs.added;
        let removedEntities = arrayChanged.removed;
    });
@event arrayChanged
@param added {Array of Entity} An array of all of the entities added to this collection.
@param removed {Array of Entity} An array of all of the removed from this collection.
@readOnly
**/

/**
Performs an asynchronous load of all other the entities associated with this relationArray.
@example
    // assume orders is an empty, as yet unpopulated, relation array of orders
    // associated with a specific customer.
    orders.load().then(...)
@param [callback] {Function}
@param [errorCallback] {Function}
@returns {Promise}
**/
function load(this: RelationArray, callback?: QuerySuccessCallback, errorCallback?: QueryErrorCallback): Promise<QueryResult> {
  const parent = this.parentEntity;
  const query = EntityQuery.fromEntityNavigation(this.parentEntity, this.navigationProperty);
  const em = parent.entityAspect.entityManager!;
  return em.executeQuery(query, callback, errorCallback);
}

const relationArrayOps: ObservableArrayOps = {

  getGoodAdds: function (arr: RelationArray, adds: Entity[]) {
    return getGoodAdds(arr, adds);
  },

  beforeChange: function (arr: RelationArray) {
    // a relation array does not change the state of the entity that owns it
  },

  processAdds: function (arr: RelationArray, adds: Entity[]) {
    processAdds(arr, adds);
  },

  processRemoves: function (arr: RelationArray, removes: Entity[]) {
    processRemoves(arr, removes);
  },

  getEventParent: function (arr: RelationArray) {
    return arr.parentEntity.entityAspect;
  },

  getPendingPubs: function (arr: RelationArray) {
    const em = arr.parentEntity.entityAspect.entityManager;
    return em && (em as any)._pendingPubs;
  }
};

function getGoodAdds(relationArray: RelationArray, adds: Entity[]) {
  let goodAdds = checkForDups(relationArray, adds);
  if (!goodAdds.length) {
    return goodAdds;
  }
  let parentEntity = relationArray.parentEntity;
  let entityManager = parentEntity.entityAspect.entityManager;
  // we do not want to attach an entity during loading
  // because these will all be 'attached' at a later step.
  if (entityManager && !entityManager.isLoading) {
    goodAdds.forEach(function (add) {
      if (add.entityAspect.entityState.isDetached()) {
        relationArray._obs.inProgress = true;
        try {
          entityManager!.attachEntity(add, EntityState.Added);
        } finally {
          relationArray._obs.inProgress = false;
        }
      }
    });
  }
  return goodAdds;
}

function processAdds(relationArray: RelationArray, adds: Entity[]) {
  let parentEntity = relationArray.parentEntity;
  let np = relationArray.navigationProperty;
  let addsInProcess = relationArray._obs.addsInProcess!;

  let invNp = np.inverse;
  let startIx = addsInProcess.length;
  try {
    adds.forEach(function (childEntity) {
      addsInProcess.push(childEntity);
      if (invNp) {
        childEntity.setProperty(invNp.name, parentEntity);
      } else {
        // This occurs with a unidirectional 1-n navigation - in this case
        // we need to update the fks instead of the navProp
        let pks = parentEntity.entityType.keyProperties;
        np.invForeignKeyNames.forEach(function (fk, i) {
          childEntity.setProperty(fk, parentEntity.getProperty(pks[i].name));
        });
      }
    });
  } finally {
    addsInProcess.splice(startIx, adds.length);
  }

}

function processRemoves(relationArray: RelationArray, removes: Entity[]) {
  let inp = relationArray.navigationProperty.inverse;
  if (inp) {
    removes.forEach(function (childEntity) {
      childEntity.setProperty(inp!.name, null);
    });
  }
}

function checkForDups(relationArray: RelationArray, adds: Entity[]) {
  // don't allow dups in this array. - also prevents recursion
  let parentEntity = relationArray.parentEntity;
  let navProp = relationArray.navigationProperty;
  let inverseProp = navProp.inverse;
  let addsInProcess = relationArray._obs.addsInProcess!;
  let goodAdds: Entity[];
  if (inverseProp) {
    goodAdds = adds.filter(function (a) {
      if (addsInProcess.indexOf(a) >= 0) {
        return false;
      }
      let inverseValue = a.getProperty(inverseProp!.name);
      return inverseValue !== parentEntity;
    });
  } else {
    // This occurs with a unidirectional 1->N relation ( where there is no n -> 1)
    // in this case we compare fks.
    let fkPropNames = navProp.invForeignKeyNames;
    let keyProps = parentEntity.entityType.keyProperties;
    goodAdds = adds.filter(function (a) {
      if (addsInProcess.indexOf(a) >= 0) {
        return false;
      }
      return fkPropNames.some(function (fk, i) {
        let keyProp = keyProps[i].name;
        let keyVal = parentEntity.getProperty(keyProp);
        let fkVal = a.getProperty(fk);
        return keyVal !== fkVal;
      });
    });
  }
  return goodAdds;
}

/** For use by breeze plugin authors only. The class is for use in building a {@link ModelLibraryAdapter} implementation.
@adapter (see {@link ModelLibraryAdapter})
@hidden
*/
export function makeRelationArray(arr: any[], parentEntity: Entity, navigationProperty: NavigationProperty): RelationArray {
  const arrX = arr as any;
  arrX.parentEntity = parentEntity;
  arrX.navigationProperty = navigationProperty;
  arrX.arrayChanged = new BreezeEvent("arrayChanged", arrX);
  arrX.load = load;
  // addsInProcess: the pushes currently being processed on this array, which is what stops the
  // relationship fixup from recursing back into it.
  observableArray.initialize(arrX, relationArrayOps, { addsInProcess: [] });
  return arrX as RelationArray;
}
