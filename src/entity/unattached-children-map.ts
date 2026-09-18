import { core } from '../core/core.js';
import { Entity } from './entity-aspect.js';
import { NavigationProperty } from '../metadata/entity-metadata.js';
import { EntityKey } from './entity-key.js';

/** @hidden @internal */
export interface INavTuple {
  navigationProperty: NavigationProperty;
  children: Entity[];
}

/** @hidden @internal */
// Represents entities not yet attached to navigationProperties. 
export class UnattachedChildrenMap {
  // key is EntityKey.toString(), value is array of { navigationProperty, children }
  map = new Map<string, INavTuple[]>();

  // Which keys each child is parked under, so that detaching it is a lookup rather than a scan
  // of the whole map. A WeakMap because it is only ever read for a child we are already holding,
  // and an entry that outlives its entity would be the leak this exists to close.
  private childKeys = new WeakMap<Entity, Set<string>>();

  addChild(parentEntityKey: EntityKey, navigationProperty: NavigationProperty, child: Entity) {
    let tuple = this.getTuple(parentEntityKey, navigationProperty);
    if (!tuple) {
      tuple = { navigationProperty: navigationProperty, children: [] };
      core.getMapArray(this.map, parentEntityKey.toString()).push(tuple);
    }
    tuple.children.push(child);

    // getTuple looks up the hierarchy, so the tuple just pushed into may be stored under a base
    // type's key. Record every key it could be under; removeChild ignores the ones it is not in.
    let keys = this.childKeys.get(child);
    if (!keys) { keys = new Set<string>(); this.childKeys.set(child, keys); }
    keys.add(parentEntityKey.toString());
    let entityType = parentEntityKey.entityType;
    while (entityType.baseEntityType) {
      entityType = entityType.baseEntityType;
      keys.add(parentEntityKey.toString(entityType));
    }
  }

  /**
   * Takes a child out of every entry it is parked under, and drops an entry that is left empty.
   *
   * Called when an entity is detached. Without it a child whose parent never arrived is held for
   * the life of the manager: `clear()` replaces the whole map, but `detachEntity` is how an
   * application drops one row. See the retention tier.
   */
  removeChild(child: Entity) {
    const keys = this.childKeys.get(child);
    if (!keys) return;
    for (const keyString of keys) {
      const tuples = this.map.get(keyString);
      if (!tuples) continue;
      for (let i = tuples.length - 1; i >= 0; i--) {
        const children = tuples[i].children;
        const ix = children.indexOf(child);
        if (ix >= 0) children.splice(ix, 1);
        if (children.length === 0) tuples.splice(i, 1);
      }
      if (tuples.length === 0) this.map.delete(keyString);
    }
    this.childKeys.delete(child);
  }

  removeChildren(parentEntityKeyString: string, navigationProperty: NavigationProperty) {
    let tuples = this.map.get(parentEntityKeyString);
    if (!tuples) return;
    core.arrayRemoveItem(tuples, (t: any) => {
      return t.navigationProperty === navigationProperty;
    });
    if (!tuples.length) {
      this.map.delete(parentEntityKeyString);
    }
  }

  getTuple(parentEntityKey: EntityKey, navigationProperty: NavigationProperty) {
    let tuples = this.getTuples(parentEntityKey);
    if (!tuples) return null;
    let tuple = core.arrayFirst(tuples, function (t) {
      return t.navigationProperty === navigationProperty;
    });
    return tuple;
  }

  getTuples(parentEntityKey: EntityKey) {
    let tuples = this.map.get(parentEntityKey.toString());
    let entityType = parentEntityKey.entityType;
    // Nothing above it in the hierarchy, which is the usual case: there is only one entry to
    // find, so hand back the stored array rather than copying it into a new one. addChild goes
    // through here for every child it registers.
    if (!entityType.baseEntityType) return tuples && tuples.length ? tuples : undefined;

    let allTuples: INavTuple[] | undefined;
    while (entityType.baseEntityType) {
      entityType = entityType.baseEntityType;
      let baseTuples = this.map.get(parentEntityKey.toString(entityType));
      if (baseTuples) {
        // only now is a combined array needed
        allTuples = allTuples || (tuples ? tuples.slice() : []);
        allTuples.push(...baseTuples);
      }
    }
    allTuples = allTuples || tuples;
    return allTuples && allTuples.length ? allTuples : undefined;
  }

  getTuplesByString(parentEntityKeyString: string) {
    return this.map.get(parentEntityKeyString);
  }

}
