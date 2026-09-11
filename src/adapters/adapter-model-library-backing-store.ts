import { config as globalConfig, BreezeConfig } from '../config/config.js';
import { core } from '../core/core.js';
import type { ModelLibraryAdapter } from '../config/interface-registry.js';
import { EntityAspect } from '../entity/entity-aspect.js';
import type { Entity, StructuralObject } from '../entity/entity-aspect.js';
import { DataProperty, ComplexType } from '../metadata/entity-metadata.js';
import type { StructuralType, EntityProperty } from '../metadata/entity-metadata.js';
import { makeComplexArray, makePrimitiveArray, makeRelationArray } from '../entity/array.js';

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
      if (p === "_$typeName" || p === "_pendingSets" || p === "_backingStore") continue;
      let val = (entity as Record<string, any>)[p];
      if (!core.isFunction(val)) {
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
      //if (!this._backingStore.hasOwnProperty(propertyName)) {
      //    throw new Error("Unknown property name:" + propertyName);
      //}
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
    // can't touch the normal property sets within this method - access the backingStore directly instead.
    let bs = movePropsToBackingStore(entity);

    // assign default values to the entity
    let stype = EntityAspect.isEntity(entity) ? entity.entityType : entity.complexType;
    stype.getProperties().forEach(function (prop) {

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
      // can't touch the normal property sets within this method (IE9 Bug) - so we access the backingStore directly instead.
      // otherwise we could just do
      // entity[propName] = val
      // after all of the interception logic had been injected.
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

// This method is called during Metadata initialization to correctly "wrap" properties.
function movePropDefsToProto(proto: any) {
  let stype = (proto.entityType || proto.complexType) as StructuralType;
  let extra = stype._extra;

  let alreadyWrapped = extra.alreadyWrappedProps || {};

  stype.getProperties().forEach(function (prop) {
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

// This method is called when an instance is first created via materialization or createEntity.
// this method cannot be called while a 'defineProperty' accessor is executing
// because of IE bug mentioned above.

function movePropsToBackingStore(instance: any) {

  let bs = getBackingStore(instance);
  let proto = Object.getPrototypeOf(instance);
  let stype = (proto.entityType || proto.complexType) as StructuralType;
  stype.getProperties().forEach(function (prop) {
    let propName = prop.name;
    if (prop.isUnmapped) {
      // insure that any unmapped properties that were added after entityType
      // was first created are wrapped with a property descriptor.
      if (!core.getPropertyDescriptor(proto, propName)) {
        let descr = makePropDescription(proto, prop);
        Object.defineProperty(proto, propName, descr);
      }
    }
    if (!instance.hasOwnProperty(propName)) return;
    // pulls off the value, removes the instance property and then rewrites it via ES5 accessor
    let value = instance[propName];
    delete instance[propName];
    instance[propName] = value;
  });
  return bs;
}

function makePropDescription(proto: any, property: EntityProperty) {
  let propName = property.name;
  let pendingStores = proto._pendingBackingStores;
  if (!pendingStores) {
    pendingStores = [];
    proto._pendingBackingStores = pendingStores;
  }
  let descr = {
    get: function () {
      let bs = this._backingStore || getBackingStore(this);
      return bs[propName];
    },
    set: function (value: any) {
      // IE9 cannot touch instance._backingStore here
      let bs = this._backingStore || getPendingBackingStore(this);
      let accessorFn = getAccessorFn(bs, propName);
      this._$interceptor(property, value, accessorFn);
    },
    enumerable: true,
    configurable: true
  };

  (descr.set as any).rawSet = function (value: any) {
    let bs = this._backingStore || getPendingBackingStore(this);
    let accessorFn = getAccessorFn(bs, propName);
    accessorFn(value);
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

function wrapPropDescription(proto: any, property: EntityProperty): any {
  if (!proto.hasOwnProperty(property.name)) {
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

  let localAccessorFn = function (entity: any) {
    return function () {
      if (!propDescr) return undefined;
      if (arguments.length === 0) {
        return propDescr.get!.bind(entity)();
      } else {
        let set = propDescr.set;
        let rawSet = (set as any).rawSet || set;
        rawSet.bind(entity)(arguments[0]);
        return undefined;
      }
    };
  };

  let newDescr = {
    get: function () {
      if (!propDescr) return undefined;
      return propDescr.get!.bind(this)();
    },
    set: function (value: any) {
      this._$interceptor(property, value, localAccessorFn(this));
    },
    enumerable: propDescr.enumerable,
    configurable: true
  };
  (newDescr.set as any).rawSet = propDescr.set;
  return newDescr;
}


function getBackingStore(instance: any) {
  let proto = Object.getPrototypeOf(instance);
  processPendingStores(proto);
  let bs = instance._backingStore;
  if (!bs) {
    bs = {};
    instance._backingStore = bs;
  }
  return bs;
}

// workaround for IE9 bug where instance properties cannot be changed when executing a property 'set' method.
function getPendingBackingStore(instance: any) {
  let proto = Object.getPrototypeOf(instance);
  let pendingStores = proto._pendingBackingStores;
  let pending = core.arrayFirst(pendingStores, function (pending) {
    return pending.entity === instance;
  });
  if (pending) return (pending as any).backingStore;
  let bs = {};
  pendingStores.push({ entity: instance, backingStore: bs });
  return bs;
}

function processPendingStores(proto: any) {
  let pendingStores = proto._pendingBackingStores;
  if (pendingStores) {
    pendingStores.forEach(function (pending: any) {
      pending.entity._backingStore = pending.backingStore;
    });
    pendingStores.length = 0;
  }
}

