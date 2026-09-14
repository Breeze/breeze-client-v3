import { BreezeEvent } from '../core/event.js';
import { ObservableArray, ObservableArrayOps, observableArray } from './observable-array.js';
import type { ComplexObject, StructuralObject } from './entity-aspect.js';
import type { DataProperty } from '../metadata/entity-metadata.js';

export interface ComplexArray<T extends ComplexObject = ComplexObject> extends ObservableArray<T> {
  parent?: StructuralObject;
  parentProperty?: DataProperty;
}

/**
 Complex arrays are not a class: they are real arrays whose mutating methods are replaced, so that
 changing one updates the entity that owns it. A complex array is a collection of complexTypes
 associated with a data property on a single entity or other complex object, i.e. customer.orders
 or order.orderDetails.
 @class {complexArray}
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
        var addedEntities = arrayChangedArgs.added;
        var removedEntities = arrayChanged.removed;
    });
@event arrayChanged
@param added {Array of Entity} An array of all of the entities added to this collection.
@param removed {Array of Entity} An array of all of the removed from this collection.
@readOnly
**/

const complexArrayOps: ObservableArrayOps = {

  // skip any that are already attached to this same parent
  getGoodAdds: function (arr: ComplexArray, adds: ComplexObject[]) {
    return adds.filter(function (a) {
      return a.complexAspect == null || a.complexAspect.parent !== arr.parent;
    });
  },

  beforeChange: function (arr: ComplexArray) {
    observableArray.updateEntityState(arr);
  },

  processAdds: function (arr: ComplexArray, adds: ComplexObject[]) {
    adds.forEach(function (a) {
      if (a.complexAspect && a.complexAspect.parent != null) {
        throw new Error("The complexObject is already attached. Either clone it or remove it from its current owner");
      }
      setAspect(a, arr);
    });
  },

  processRemoves: function (arr: ComplexArray, removes: ComplexObject[]) {
    removes.forEach(function (a) {
      clearAspect(a, arr);
    });
  },

  getEventParent: function (arr: ComplexArray) {
    return observableArray.getEntityAspect(arr);
  },

  getPendingPubs: function (arr: ComplexArray) {
    const em = observableArray.getEntityAspect(arr).entityManager;
    return em && (em as any)._pendingPubs;
  },

  rejectChanges: function (arr: ComplexArray) {
    const origValues = arr._obs.origValues;
    if (!origValues) return;
    arr.forEach(function (co: ComplexObject) {
      clearAspect(co, arr);
    });
    arr.length = 0;
    origValues.forEach(function (co: ComplexObject) {
      arr.push(co);
    });
  },

  acceptChanges: function (arr: ComplexArray) {
    arr._obs.origValues = null;
  }
};

// local functions

function clearAspect(co: ComplexObject, arr: ComplexArray) {
  let coAspect = co.complexAspect;
  // if not already attached - exit
  if (coAspect.parent !== arr.parent) return null;

  coAspect.parent = undefined;
  coAspect.parentProperty = undefined;
  return coAspect;
}

function setAspect(co: ComplexObject, arr: ComplexArray) {
  let coAspect = co.complexAspect;
  // if already attached - exit
  if (coAspect.parent === arr.parent) return null;
  coAspect.parent = arr.parent;
  coAspect.parentProperty = arr.parentProperty;

  return coAspect;
}

/** For use by breeze plugin authors only. The class is for use in building a {@link ModelLibraryAdapter} implementation.
@adapter (see {@link ModelLibraryAdapter})
@hidden
*/
export function makeComplexArray(arr: any[], parent: StructuralObject, parentProperty: DataProperty): ComplexArray {
  const arrX = arr as any;
  arrX.parent = parent;
  arrX.parentProperty = parentProperty;
  arrX.arrayChanged = new BreezeEvent("arrayChanged", arrX);
  observableArray.initialize(arrX, complexArrayOps);
  return arrX as ComplexArray;
}
