import { BreezeEvent } from '../core/event.js';
import { ObservableArray, ObservableArrayOps, observableArray } from './observable-array.js';
import type { StructuralObject } from './entity-aspect.js';
import type { DataProperty } from '../metadata/entity-metadata.js';

export interface PrimitiveArray extends ObservableArray<any> {
  parent?: StructuralObject;
  parentProperty?: DataProperty;
}

/**
 Primitive arrays are not a class: they are real arrays whose mutating methods are replaced, so
 that changing one updates the entity that owns it. A primitive array is a collection of primitive
 values associated with a data property on a single entity or complex object, i.e.
 customer.invoiceNumbers.
 @class {primitiveArray}
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
@param added {Array of Primitives} An array of all of the items added to this collection.
@param removed {Array of Primitives} An array of all of the items removed from this collection.
@readOnly
**/

const primitiveArrayOps: ObservableArrayOps = {

  // every value is welcome: there is nothing to attach, and no duplicate to guard against
  getGoodAdds: function (arr: PrimitiveArray, adds: any[]) {
    return adds;
  },

  beforeChange: function (arr: PrimitiveArray) {
    observableArray.updateEntityState(arr);
  },

  processAdds: function (arr: PrimitiveArray, adds: any[]) {
    // nothing needed
  },

  processRemoves: function (arr: PrimitiveArray, removes: any[]) {
    // nothing needed
  },

  getEventParent: function (arr: PrimitiveArray) {
    return observableArray.getEntityAspect(arr);
  },

  getPendingPubs: function (arr: PrimitiveArray) {
    const em = observableArray.getEntityAspect(arr).entityManager;
    return em && (em as any)._pendingPubs;
  },

  rejectChanges: function (arr: PrimitiveArray) {
    const origValues = arr._obs.origValues;
    if (!origValues) return;
    arr.length = 0;
    Array.prototype.push.apply(arr, origValues);
  },

  acceptChanges: function (arr: PrimitiveArray) {
    arr._obs.origValues = null;
  }
};

/** For use by breeze plugin authors only. The class is for use in building a {@link ModelLibraryAdapter} implementation.
@adapter (see {@link ModelLibraryAdapter})
@hidden
*/
export function makePrimitiveArray(arr: any[], parent: StructuralObject, parentProperty: DataProperty): PrimitiveArray {
  const arrX = arr as any;
  arrX.parent = parent;
  arrX.parentProperty = parentProperty;
  arrX.arrayChanged = new BreezeEvent("arrayChanged", arrX);
  observableArray.initialize(arrX, primitiveArrayOps);
  return arrX as PrimitiveArray;
}
