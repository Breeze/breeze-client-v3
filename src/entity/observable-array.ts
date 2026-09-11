import { BreezeEvent } from '../core/event.js';
import type { EntityAspect } from './entity-aspect.js';
import type { DataProperty } from '../metadata/entity-metadata.js';

/**
 * The observable arrays - relation, complex and primitive - are real arrays, and have to be:
 * applications index them, iterate them, spread them and `JSON.stringify` them, and every one of
 * those is the engine's fast path only while the object stays a plain array with
 * `Array.prototype`. That rules out both of the tidier-looking alternatives: a subclass or a
 * swapped prototype costs about 20x on `forEach`/`map`/`filter`, and a `Proxy` about 400x on
 * reads.
 *
 * What is *not* free is the number of own properties. Past roughly a dozen, V8 moves the array
 * to dictionary properties and indexed reads get about 90x slower. 2.x copied sixteen functions
 * onto every array and paid exactly that.
 *
 * So only the five mutators live on the instance - they have to, to be intercepted - plus
 * `_getEventParent`, which BreezeEvent looks for on the publisher itself. Everything else, the
 * per-kind behaviour and the bookkeeping, hangs off one `_obs` property.
 * `test/unit/observable-array.spec.ts` pins the count so this cannot drift back.
 */

/** The argument to an {@link ObservableArray}'s `arrayChanged` event. */
export interface ArrayChangedArgs {
  array: any[];
  added?: any[];
  removed?: any[];
}

/**
 * What differs between a relation, complex and primitive array. One shared instance per kind,
 * reached through `arr._obs.ops`, so that none of it sits on the array itself.
 * @hidden @internal
 */
export interface ObservableArrayOps {
  /** The subset of `adds` that should actually be added. */
  getGoodAdds(arr: any, adds: any[]): any[];
  processAdds(arr: any, adds: any[]): void;
  processRemoves(arr: any, removes: any[]): void;
  /** Runs before any mutation; where an array marks its owning entity modified. */
  beforeChange(arr: any): void;
  getEventParent(arr: any): Object;
  getPendingPubs(arr: any): any[] | undefined;
  rejectChanges?(arr: any): void;
  acceptChanges?(arr: any): void;
}

/**
 * Per-array bookkeeping: one object, one own property on the array.
 * @hidden @internal
 */
export interface ObservableArrayState {
  ops: ObservableArrayOps;
  /** The contents before the first change, once the owning entity is Modified. */
  origValues?: any[] | null;
  /** Set while an arrayChanged event is queued behind an EntityManager's pending publications. */
  pendingArgs?: any;
  /** Relation arrays: the adds being processed, which stops relationship fixup recursing. */
  addsInProcess?: any[];
  /** Relation arrays: set while attaching an entity, so a re-entrant push is ignored. */
  inProgress?: boolean;
}

/**
 * A real array - every Array method is the native one - plus change notification and the links
 * back to the entity that owns it. Only the five mutators are replaced.
 * @hidden
 */
export interface ObservableArray<T = any> extends Array<T> {
  arrayChanged: BreezeEvent<ArrayChangedArgs>;
  parent?: Object;
  parentProperty?: DataProperty;

  /** @hidden @internal */
  _obs: ObservableArrayState;
  /** @hidden @internal BreezeEvent reads this off the publisher to walk the enable/disable chain. */
  _getEventParent(): Object;
}

// --- the five mutators -----------------------------------------------------------------------
// Shared function objects: every array gets the same five, so the only per-array cost is the
// property slot. Each one reads its behaviour from `this._obs.ops`.

function push(this: any, ...items: any[]): number {
  const state = this._obs as ObservableArrayState;
  if (state.inProgress) {
    return -1;
  }
  const goodAdds = state.ops.getGoodAdds(this, items);
  if (!goodAdds.length) {
    return this.length;
  }
  state.ops.beforeChange(this);
  const result = Array.prototype.push.apply(this, goodAdds);
  processAdds(this, goodAdds);
  return result;
}

function unshift(this: any, ...items: any[]): number {
  const state = this._obs as ObservableArrayState;
  const goodAdds = state.ops.getGoodAdds(this, items);
  if (!goodAdds.length) {
    return this.length;
  }
  state.ops.beforeChange(this);
  const result = Array.prototype.unshift.apply(this, goodAdds);
  processAdds(this, goodAdds);
  return result;
}

function pop(this: any): any {
  const state = this._obs as ObservableArrayState;
  state.ops.beforeChange(this);
  const result = Array.prototype.pop.call(this);
  processRemoves(this, [result]);
  return result;
}

function shift(this: any): any {
  const state = this._obs as ObservableArrayState;
  state.ops.beforeChange(this);
  const result = Array.prototype.shift.call(this);
  processRemoves(this, [result]);
  return result;
}

function splice(this: any, ...args: any[]): any[] {
  const state = this._obs as ObservableArrayState;
  const goodAdds = state.ops.getGoodAdds(this, args.slice(2));
  const newArgs = args.slice(0, 2).concat(goodAdds);
  state.ops.beforeChange(this);
  const result = Array.prototype.splice.apply(this, newArgs as [number, number, ...any[]]);
  processRemoves(this, result);
  if (goodAdds.length) {
    processAdds(this, goodAdds);
  }
  return result;
}

function getEventParent(this: any): Object {
  return (this._obs as ObservableArrayState).ops.getEventParent(this);
}

// --- shared machinery ------------------------------------------------------------------------

/**
 * Adds items without asking the kind whether it wants them. The merge path has already decided,
 * and re-checking would attach the same entities a second time.
 */
function pushUnchecked(arr: any, ...items: any[]): number {
  const state = arr._obs as ObservableArrayState;
  if (state.inProgress) {
    return -1;
  }
  state.ops.beforeChange(arr);
  const result = Array.prototype.push.apply(arr, items);
  processAdds(arr, items);
  return result;
}

function processAdds(arr: any, adds: any[]): void {
  (arr._obs as ObservableArrayState).ops.processAdds(arr, adds);
  publish(arr, "arrayChanged", { array: arr, added: adds });
}

function processRemoves(arr: any, removes: any[]): void {
  (arr._obs as ObservableArrayState).ops.processRemoves(arr, removes);
  publish(arr, "arrayChanged", { array: arr, removed: removes });
}

/**
 * Publishes now, or - while an EntityManager is loading - queues one event per array and folds
 * later changes into it, so that a query produces a single arrayChanged per collection.
 */
function publish(publisher: any, eventName: string, eventArgs: any): void {
  const state = publisher._obs as ObservableArrayState;
  const pendingPubs = state.ops.getPendingPubs(publisher);
  if (pendingPubs) {
    if (!state.pendingArgs) {
      state.pendingArgs = eventArgs;
      pendingPubs.push(function () {
        publisher[eventName].publish(state.pendingArgs);
        state.pendingArgs = null;
      });
    } else {
      combineArgs(state.pendingArgs, eventArgs);
    }
  } else {
    publisher[eventName].publish(eventArgs);
  }
}

/** The aspect of the entity that owns this array, whether directly or through a complex object. */
function getEntityAspect(arr: any): EntityAspect {
  const parent = arr.parent;
  return parent.entityAspect || parent.complexAspect.getEntityAspect();
}

/** Marks the owning entity Modified, and keeps a copy of the contents the first time. */
function updateEntityState(arr: any): void {
  const entityAspect = getEntityAspect(arr);
  if (entityAspect.entityState.isUnchanged()) {
    entityAspect.setModified();
  }
  const state = arr._obs as ObservableArrayState;
  if (entityAspect.entityState.isModified() && !state.origValues) {
    state.origValues = arr.slice(0);
  }
}

function combineArgs(target: Object, source: Object): void {
  const tgt = target as Record<string, any>, src = source as Record<string, any>;
  for (const key of Object.keys(src)) {
    if (key === "array" || !Object.prototype.hasOwnProperty.call(tgt, key)) continue;
    const sourceValue = src[key];
    const targetValue = tgt[key];
    if (targetValue) {
      if (!Array.isArray(targetValue)) {
        throw new Error("Cannot combine non array args");
      }
      Array.prototype.push.apply(targetValue, sourceValue);
    } else {
      tgt[key] = sourceValue;
    }
  }
}

/**
 * Turns a plain array into an observable one: the five mutators, the event-parent hook and the
 * single state property. Anything else a kind needs belongs in its `ops` or in its state.
 */
function initialize(arr: any, ops: ObservableArrayOps, state?: Partial<ObservableArrayState>): void {
  arr.push = push;
  arr.unshift = unshift;
  arr.pop = pop;
  arr.shift = shift;
  arr.splice = splice;
  arr._getEventParent = getEventParent;
  arr._obs = Object.assign({ ops: ops }, state) as ObservableArrayState;
}

/** @hidden @internal */
export const observableArray = {
  initialize: initialize,
  updateEntityState: updateEntityState,
  publish: publish,
  getEntityAspect: getEntityAspect,
  pushUnchecked: pushUnchecked,
  /** Puts back the contents the owning entity had before its changes. */
  rejectChanges: (arr: any) => (arr._obs as ObservableArrayState).ops.rejectChanges?.(arr),
  /** Forgets the saved contents: what was changed is now what is stored. */
  acceptChanges: (arr: any) => (arr._obs as ObservableArrayState).ops.acceptChanges?.(arr),
  /** True once the array has been changed away from what the server sent. */
  hasOriginalValues: (arr: any) => !!(arr._obs as ObservableArrayState)?.origValues,
};
