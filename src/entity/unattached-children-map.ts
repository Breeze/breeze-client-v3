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


  addChild(parentEntityKey: EntityKey, navigationProperty: NavigationProperty, child: Entity) {
    let tuple = this.getTuple(parentEntityKey, navigationProperty);
    if (!tuple) {
      tuple = { navigationProperty: navigationProperty, children: [] };
      core.getMapArray(this.map, parentEntityKey.toString()).push(tuple);
    }
    tuple.children.push(child);
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
