import { config as globalConfig, BreezeConfig } from '../config/config.js';
import { core } from '../core/core.js';
import type { ModelLibraryAdapter } from '../config/interface-registry.js';
import { EntityAspect } from '../entity/entity-aspect.js';
import type { Entity, StructuralObject } from '../entity/entity-aspect.js';
import { DataProperty, ComplexType } from '../metadata/entity-metadata.js';
import type { StructuralType, EntityProperty } from '../metadata/entity-metadata.js';
import { makeComplexArray, makePrimitiveArray, makeRelationArray } from '../entity/array.js';

/**
 * Change tracking for plain JavaScript objects.
 *
 * Each mapped property becomes an accessor **on the prototype** - defined once per type, not per
 * instance - and the values live in a `_backingStore` object on the instance. A get reads the
 * store; a set hands the property, the new value and an accessor for the old one to the entity's
 * `_$interceptor`, which is where change tracking actually happens.
 *
 * That split is why this file is cheap and the interceptor is not: of the time spent setting a
 * tracked property, about 96% is change tracking (validation alone is around 63%) and about 2% is
 * the plumbing here. Optimise the interceptor, or turn off `validateOnPropertyChange`; there is
 * very little to win in this file.
 */
export class ModelLibraryBackingStoreAdapter implements ModelLibraryAdapter {
  name: string;

  constructor() {
    this.name = "backingStore";
  }

  static register(config?: BreezeConfig) {
    config = config || globalConfig;
    config.registerAdapter("modelLibrary", ModelLibraryBackingStoreAdapter);
    return config.initializeAdapterInstance("modelLibrary", "backingStore", true) as ModelLibraryBackingStoreAdapter;
  }

  initialize() {
  }

  getTrackablePropertyNames(entity: Entity) {
    let names: string[] = [];
    for (let p in entity) {
      if (p === "entityAspect" || p === "entityType") continue;
      if (p === "_$typeName" || p === "_backingStore") continue;
      if (typeof (entity as Record<string, any>)[p] !== "function") {
        names.push(p);
      }
    }
    return names;
  }

  // This method is called during Metadata initialization
  initializeEntityPrototype(proto: any) {

    proto.getProperty = function (propertyName: string) {
      return this[propertyName];
    };

    proto.setProperty = function (propertyName: string, value: any) {
      this[propertyName] = value;
      // allow setProperty chaining.
      return this;
    };

    movePropDefsToProto(proto);
  }

  // This method is called when an EntityAspect is first created - this will occur as part of the entityType.createEntity call.
  // which can be called either directly or via standard query materialization

  // entity is either an entity or a complexObject
  startTracking(entity: StructuralObject, proto: any) {
    // Write through the backing store rather than the accessors: the interceptor would treat
    // these initial values as changes to an entity that does not exist yet.
    let bs = movePropsToBackingStore(entity);

    // assign default values to the entity
    let stype = EntityAspect.isEntity(entity) ? entity.entityType : entity.complexType;
    forEachProperty(stype, function (prop) {

      let propName = prop.name;
      let val = (entity as Record<string, any>)[propName];

      if (prop instanceof DataProperty) {
        if (prop.isComplexProperty) {
          if (prop.isScalar) {
            val = (prop.dataType as ComplexType)._createInstanceCore(entity, prop);
          } else {
            val = makeComplexArray([], entity, prop);
          }
        } else if (!prop.isScalar) {
          val = makePrimitiveArray([], entity, prop);
        } else if (val === undefined) {
          val = prop.defaultValue;
        }

      } else if (prop.isNavigationProperty) {
        if (val !== undefined && val !== null) {
          throw new Error("Cannot assign a navigation property in an entity ctor.: " + propName);
        }
        if (prop.isScalar) {
          // TODO: change this to nullstob later.
          val = null;
        } else {
          val = makeRelationArray([], entity as Entity, prop);
        }
      } else {
        throw new Error("unknown property: " + propName);
      }
      if ((prop as DataProperty).isSettable || prop.isNavigationProperty) {
        bs[propName] = val;
      }
    });
  }
}

// NOTE: this module deliberately does NOT register itself on import.
// Registration is explicit - pass the adapter to configureBreeze, or call
// SomeAdapter.register(). Importing a module should not mutate global state.


// private methods

/**
 * Visits a type's data and navigation properties. `getProperties()` returns them concatenated
 * into a fresh array, and this runs twice for every instance created, so it walks the two arrays
 * instead. (A ComplexType has no navigation properties.)
 */
function forEachProperty(stype: StructuralType, fn: (prop: EntityProperty) => void) {
  const dataProps = stype.dataProperties;
  for (let i = 0; i < dataProps.length; i++) fn(dataProps[i]);
  const navProps = (stype as any).navigationProperties as EntityProperty[] | undefined;
  if (navProps) {
    for (let i = 0; i < navProps.length; i++) fn(navProps[i]);
  }
}

// This method is called during Metadata initialization to correctly "wrap" properties.
function movePropDefsToProto(proto: any) {
  let stype = (proto.entityType || proto.complexType) as StructuralType;
  let extra = stype._extra;

  let alreadyWrapped = extra.alreadyWrappedProps || {};

  forEachProperty(stype, function (prop) {
    let propName = prop.name;
    // we only want to wrap props that haven't already been wrapped
    if (alreadyWrapped[propName]) return;

    // If property is already defined on the prototype then wrap it in another propertyDescriptor.
    // otherwise create a propDescriptor for it.
    let descr: any;
    if (propName in proto) {
      descr = wrapPropDescription(proto, prop);
    } else {
      descr = makePropDescription(proto, prop);
    }
    // descr will be null for a wrapped descr that is not configurable
    if (descr != null) {
      Object.defineProperty(proto, propName, descr);
    }
    alreadyWrapped[propName] = true;
  });
  extra.alreadyWrappedProps = alreadyWrapped;
}

/**
 * Called once per instance, as it starts being tracked. A custom constructor may have assigned
 * properties in its own body, which lands them on the instance and shadows the prototype
 * accessor; those values are moved into the backing store by writing them back through it.
 */
function movePropsToBackingStore(instance: any) {

  let bs = getBackingStore(instance);
  let proto = Object.getPrototypeOf(instance);
  let stype = (proto.entityType || proto.complexType) as StructuralType;
  forEachProperty(stype, function (prop) {
    let propName = prop.name;
    if (prop.isUnmapped) {
      // insure that any unmapped properties that were added after entityType
      // was first created are wrapped with a property descriptor.
      if (!core.getPropertyDescriptor(proto, propName)) {
        let descr = makePropDescription(proto, prop);
        Object.defineProperty(proto, propName, descr);
      }
    }
    if (!Object.prototype.hasOwnProperty.call(instance, propName)) return;
    // pulls off the value, removes the instance property and then rewrites it via the accessor
    let value = instance[propName];
    delete instance[propName];
    instance[propName] = value;
  });
  return bs;
}

function makePropDescription(proto: any, property: EntityProperty) {
  let propName = property.name;
  let descr = {
    get: function () {
      let bs = this._backingStore || getBackingStore(this);
      return bs[propName];
    },
    set: function (value: any) {
      let bs = this._backingStore || getBackingStore(this);
      // A fresh accessor per set, because `(property, newValue, rawAccessorFn)` is the
      // interceptor contract - MetadataStore.trackUnmappedType lets an application supply its
      // own. It is about 2% of a set, so the contract is worth more than the allocation.
      this._$interceptor(property, value, getAccessorFn(bs, propName));
    },
    enumerable: true,
    configurable: true
  };

  (descr.set as any).rawSet = function (value: any) {
    let bs = this._backingStore || getBackingStore(this);
    bs[propName] = value;
  };
  return descr;

}

function getAccessorFn(bsArg: {}, propName: string): any {
  const bs = bsArg as Record<string, any>;
  return function () {
    if (arguments.length === 0) {
      return bs[propName];
    } else {
      bs[propName] = arguments[0];
      return undefined;
    }
  };
}

/**
 * For a property that already has an accessor on the prototype - a custom constructor using
 * get/set - keep that accessor and route writes through the interceptor first.
 */
function wrapPropDescription(proto: any, property: EntityProperty): any {
  if (!Object.prototype.hasOwnProperty.call(proto, property.name)) {
    let nextProto = Object.getPrototypeOf(proto);
    return wrapPropDescription(nextProto, property);
  }

  let propDescr = Object.getOwnPropertyDescriptor(proto, property.name);
  if (!propDescr) return undefined;
  // if not configurable; we can't touch it - so leave.
  if (!propDescr.configurable) return undefined;
  // if a data descriptor - don't change it - this is basically a static property - i.e. defined on every instance of the type with the same value.
  if (propDescr.value) return undefined;
  // if a read only property descriptor - no need to change it.
  if (!propDescr.set) return undefined;

  const originalGet = propDescr.get!;
  const originalSet = propDescr.set;
  const rawSet = (originalSet as any).rawSet || originalSet;

  let localAccessorFn = function (entity: any) {
    return function () {
      if (arguments.length === 0) {
        return originalGet.call(entity);
      } else {
        rawSet.call(entity, arguments[0]);
        return undefined;
      }
    };
  };

  let newDescr = {
    get: function () {
      return originalGet.call(this);
    },
    set: function (value: any) {
      this._$interceptor(property, value, localAccessorFn(this));
    },
    enumerable: propDescr.enumerable,
    configurable: true
  };
  (newDescr.set as any).rawSet = originalSet;
  return newDescr;
}


function getBackingStore(instance: any) {
  let bs = instance._backingStore;
  if (!bs) {
    bs = {};
    instance._backingStore = bs;
  }
  return bs;
}
