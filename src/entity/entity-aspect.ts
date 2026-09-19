import { core } from '../core/core.js';
import { config } from '../config/config.js';
import { BreezeEvent } from '../core/event.js';
import { assertParam, paramError } from '../core/assert-param.js';
import { EntityState  } from './entity-state.js';
import { EntityAction } from './entity-action.js';
import { EntityType, ComplexType, DataProperty, NavigationProperty, EntityProperty } from '../metadata/entity-metadata.js';
import { observableArray } from './observable-array.js';
import { EntityKey } from './entity-key.js';
import { EntityGroup } from './entity-group.js';
import { EntityManager, QueryResult, QueryErrorCallback, QuerySuccessCallback, ValidationErrorsChangedEventArgs } from '../manager/entity-manager.js';
import { Validator, ValidationError } from '../validation/validate.js';
import { EntityQuery } from '../query/entity-query.js';
import type { DataKeys, OriginalValues } from '../query/property-path.js';
import { DataType } from '../metadata/data-type.js';

/** An instance of an {@link EntityType}: an object with a key, tracked by an {@link EntityManager}
once attached. Breeze gives every entity these members, whether its class declares them or not. */
export interface Entity {
  /** The {@link EntityAspect} that holds this entity's Breeze state: its {@link EntityState}, key,
  original values, validation errors and manager. */
  entityAspect: EntityAspect;
  /** The {@link EntityType} that describes this entity. */
  entityType: EntityType;
  /** Get the property with the given name */
  getProperty(prop: string): any;
  /** Set the property with the given name, exactly as assigning it would.

  With the backing-store model library it returns the object itself, so calls can be chained.
  The return type is `any` rather than `this` so that a class declaring `setProperty` as returning
  `void` still implements this interface.

  A name that is not a property of the type is not an error: like an assignment, it creates an
  ordinary property, which Breeze does not track. */
  setProperty(prop: any, value: any): any;
  /** @hidden @internal */
  prototype?: { _$typeName: string };
  /** @hidden @internal */
  _$entityType?: EntityType;
}

/** An instance of a {@link ComplexType}: a value with no key of its own, held in a complex property
of an entity or of another complex object. */
export interface ComplexObject {
  /** The {@link ComplexAspect} that holds this object's parent, parent property and original values. */
  complexAspect: ComplexAspect;
  /** The {@link ComplexType} that describes this object. */
  complexType: ComplexType;
  /** Get the property with the given name */
  getProperty(prop: string): any;
  /** Set the property with the given name, exactly as assigning it would. Returns the object
  itself with the backing-store model library - see {@link Entity.setProperty}. */
  setProperty(prop: any, value: any): any;
  /** @hidden @internal */
  prototype?: { _$typeName: string };
}

/** An entity or a complex object - either kind of object Breeze tracks the properties of. Used where
either is accepted, such as {@link ComplexAspect.parent}. */
export type StructuralObject = Entity | ComplexObject;

/**
 * The type of the results of a query built from entities you already have, such as
 * {@link EntityQuery.fromEntities} or {@link RelationArray.load}: the entities' own class when it
 * is known - `QueriedAs<Customer>` is `Customer` - and `any` when all that is known is
 * {@link Entity}, so that `results[0].companyName` compiles without a cast.
 */
// `any` rather than `Entity` for the plain case: that is what these results were before the type
// parameters existed, and narrowing it would break every existing caller.
export type QueriedAs<U> = Entity extends U ? any : U;

/** The argument to an entity's {@link EntityAspect.propertyChanged} event. It is also the `args` of
an {@link EntityChangedEventArgs} for {@link EntityAction.PropertyChange}. */
export interface PropertyChangedEventArgs {
  /** The entity that changed. For a property of a complex object, the entity that holds it. */
  entity: Entity;
  /** The name of the property that changed. For a property of a complex object it is a path from
  the entity, such as `"location.city"`, with no index for an element of a complex array.

  `null` when any number of properties may have changed at once - when a query or save merges
  values into the entity, or its changes are rejected. The other members are then not set. */
  propertyName: string | null;
  /** The object whose property was set: the entity itself, or the complex object that owns the
  property. */
  parent?: StructuralObject;
  /** The {@link DataProperty} or {@link NavigationProperty} that changed. It belongs to the type of
  `parent`, which is not the entity's type when `parent` is a complex object. */
  property?: EntityProperty;
  /** The value before the change. */
  oldValue?: any;
  /** The value after the change, converted to the property's data type where Breeze can. */
  newValue?: any;
}


/**
An EntityAspect instance is associated with every attached entity and is accessed via the entity's 'entityAspect' property.

The EntityAspect itself provides properties to determine and modify the EntityState of the entity and has methods
that provide a variety of services including validation and change tracking.

An EntityAspect will almost never need to be constructed directly. You will usually get an EntityAspect by accessing
an entities 'entityAspect' property.  This property will be automatically attached when an entity is created via either
a query, import or {@link EntityManager.createEntity} call.
```ts
// assume order is an order entity attached to an EntityManager.
var aspect = order.entityAspect;
var currentState = aspect.entityState;
```

*/
export class EntityAspect {
  /** The Entity that this aspect is associated with. __Read Only__  */
  entity?: Entity;
  /** The {@link EntityManager} that contains this entity. __Read Only__ */
  entityManager?: EntityManager;
  /**  @hidden @internal */
  entityGroup?: EntityGroup;
  /** @hidden @internal */
  _entityState!: EntityState;
  // An accessor rather than a plain field because the entity's group keeps the set of its
  // entities that are not Unchanged, and this is the one place every state change passes through
  // - setEntityState, _detach, the attach and merge paths, and anything an application or plugin
  // assigns. Working the set out by scanning instead is what made hasChanges cost the size of the
  // cache, once per state change. See "Cache lookups that were scans" in CHANGES-DEV.md.
  /** The {@link EntityState} of this entity. __Read Only__ */
  get entityState(): EntityState {
    return this._entityState;
  }
  set entityState(entityState: EntityState) {
    this._entityState = entityState;
    const group = this.entityGroup;
    if (group === undefined) return;   // detached: nothing is tracking it
    if (entityState === EntityState.Unchanged || entityState === EntityState.Detached) {
      group._changedEntities.delete(this.entity!);
    } else {
      group._changedEntities.add(this.entity!);
    }
  }
  /**   Whether this entity is in the process of being saved. __Read Only__ */
  isBeingSaved: boolean;
  /** The 'original values' of this entity where they are different from the 'current values'.
  This is a map where the key is a property name and the value is the 'original value' of the property. */
  originalValues: Record<string, any>;
  /**  Whether this entity has any validation errors. __Read Only__ */
  hasValidationErrors: boolean;
  /** Whether this entity has a temporary {@link EntityKey}. */
  hasTempKey?: boolean;
  /** Whether this entity was created by being loaded from the database */
  wasLoaded?: boolean;
  /** Extra metadata about this entity such as the entity's etag.
  You may extend this object with your own metadata information.
  Breeze (de)serializes this object when importing/exporting the entity. */
  extraMetadata?: any;
  /**
  A {@link BreezeEvent} that fires whenever any of the validation errors on this entity change.
  Note that this might be the removal of an error when some data on the entity is fixed.
  @eventArgs - 
    - entity - The entity on which the validation errors are being added or removed.
    - added - An array containing any newly added {@link ValidationError}s
    - removed - An array containing any newly removed {@link ValidationError}s. This is those
      errors that have been 'fixed'.

```ts
// assume order is an order entity attached to an EntityManager.
order.entityAspect.validationErrorsChanged.subscribe(
function (validationChangeArgs) {
    // this code will be executed anytime a property value changes on the 'order' entity.
    var entity == validationChangeArgs.entity; // Note: entity === order
    var errorsAdded = validationChangeArgs.added;
    var errorsCleared = validationChangeArgs.removed;
});
```
  @event
  */
  validationErrorsChanged: BreezeEvent<ValidationErrorsChangedEventArgs>;
  /**
  A {@link BreezeEvent} that fires whenever a value of one of this entity's properties change.
  @eventArgs -
    - entity - The entity whose property has changed.
    - property - The {@link DataProperty} that changed.
    - propertyName - The name of the property that changed. This value will be 'null' for operations that replace the entire entity.  This includes
      queries, imports and saves that require a merge. The remaining parameters will not exist in this case either. This will actually be a "property path"
      for any properties of a complex type.
    - oldValue - The old value of this property before the change.
    - newValue - The new value of this property after the change.
    - parent - The immediate parent object for the changed property.  This will be a ComplexType instance as opposed to an Entity 
      for any complex type or nested complex type properties.

  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.propertyChanged.subscribe(
  function (propertyChangedArgs) {
      // this code will be executed anytime a property value changes on the 'order' entity.
      var entity = propertyChangedArgs.entity; // Note: entity === order
      var propertyNameChanged = propertyChangedArgs.propertyName;
      var oldValue = propertyChangedArgs.oldValue;
      var newValue = propertyChangedArgs.newValue;
  });
  ```
  @event
  */
  propertyChanged: BreezeEvent<PropertyChangedEventArgs>;

  /** @hidden @internal */
  _validationErrors: { [index: string]: ValidationError };
  /** @hidden @internal */
  _pendingValidationResult: any;
  /**
  The async validator runs in flight, by the key of the error each would add or remove: one run
  per check, so that a newer run replaces an older one rather than racing it. Created on first use.
  @hidden @internal
  */
  declare _asyncChecks?: Map<string, AsyncCheckRun>;

  /** Whether an async validator is still running for this entity - see
  {@link EntityAspect.validateEntityAsync}. __Read Only__ */
  get isValidating(): boolean {
    return !!this._asyncChecks && this._asyncChecks.size > 0;
  }
  /** @hidden @internal */
  _entityKey: EntityKey;
  /** @hidden @internal */
  _loadedNps: any[];
  /** @hidden @internal */
  _initialized?: boolean;
  /** @hidden @internal */
  _inProcess: any[]; // used in defaultPropertyInterceptor for temp storage.
  /** @hidden @internal */
  _inProcessEntity?: Entity; // used in EntityManager
  /** @hidden @internal */
  constructor(entity?: Entity) {

    // if called without new
    // if (!(this instanceof EntityAspect)) {
    //   return new EntityAspect(entity);
    // }

    this.entity = entity;
    // TODO: keep public or not?
    this.entityGroup = undefined;
    this.entityManager = undefined;
    this.entityState = EntityState.Detached;
    this.isBeingSaved = false;
    this.originalValues = {};
    this.hasValidationErrors = false;
    this._validationErrors = {};

    // Uncomment when we implement entityAspect.isNavigationPropertyLoaded method
    // this._loadedNavPropMap = {};

    this.validationErrorsChanged = new BreezeEvent("validationErrorsChanged", this);
    this.propertyChanged = new BreezeEvent("propertyChanged", this);
    // in case this is the NULL entityAspect. - used with ComplexAspects that have no parent.

    if (entity != null) {
      // remove properties that should be on prototype but placed on instance by Babel
      if (entity.hasOwnProperty('entityType')) {
        // throw new Error("Entity instance has entityType property; should only be on prototype");
        delete (entity as any).entityType;
      }
      entity.entityAspect = this;

      // entityType should already be on the entity from 'watch'
      let entityType = entity.entityType || entity._$entityType;
      if (!entityType) {
        let typeName = entity.prototype!._$typeName;
        if (!typeName) {
          throw new Error("This entity is not registered as a valid EntityType");
        } else {
          throw new Error("Metadata for this entityType has not yet been resolved: " + typeName);
        }
      }
      let entityCtor = entityType.getCtor();
      config.interfaceRegistry.modelLibrary.getDefaultInstance().startTracking(entity, entityCtor.prototype);
    }
  }

  /** @hidden */
  // type-guard
  static isEntity(obj: StructuralObject): obj is Entity {
    return (obj as any).entityAspect != null;
  }

  // TODO: refactor this and the instance getPropertyValue method.
  /**
  Returns the value of a specified 'property path' for a specified entity.

  The propertyPath can be either a string delimited with '.' or a string array.  
  */
  // used by EntityQuery and Predicate
  static getPropertyPathValue(obj: Entity, propertyPath: string | string[]) {
    let properties = Array.isArray(propertyPath) ? propertyPath : propertyPath.split(".");
    if (properties.length === 1) {
      // properties[0], not propertyPath. Given a single-element array this used to pass the array
      // itself to getProperty, and reached the right property only because a property lookup
      // coerces ['freight'] to 'freight'. Correct by accident, and slower than the real thing.
      return obj.getProperty(properties[0]);
    } else {
      let nextValue = obj;
      // hack use of some to perform mapFirst operation.
      properties.some((prop) => {
        nextValue = nextValue.getProperty(prop);
        return nextValue == null;
      });
      return nextValue;
    }
  }

  /**
  Returns the {@link EntityKey} for this Entity.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var entityKey = order.entityAspect.getKey();
  ```
  @param forceRefresh - (boolean=false) Forces the recalculation of the key.  This should normally be unnecessary.
  @returns The {@link EntityKey} associated with this Entity.
  */
  getKey(forceRefresh: boolean = false) {
    // Inline, not assertParam: getKey runs several times per entity created and again on
    // every attach, merge and foreign key lookup. Same wording.
    if (forceRefresh != null && typeof forceRefresh !== 'boolean') {
      throw paramError('forceRefresh', "is optional or it must be a 'boolean'");
    }
    if (forceRefresh || !this._entityKey) {
      let entityType = this.entity!.entityType;
      let keyProps = entityType.keyProperties;
      let values = keyProps.map(function (p) {
        return this.entity.getProperty(p.name);
      }, this);
      this._entityKey = new EntityKey(entityType, values);
    }
    return this._entityKey;
  }

  /**
  Returns the entity to an {@link EntityState} of 'Unchanged' by committing all changes made since the entity was last queried
  had 'acceptChanges' called on it.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.acceptChanges();
  // The 'order' entity will now be in an 'Unchanged' state with any changes committed.
  ```
  */
  acceptChanges() {
    if (!this.entity) return;
    this._checkOperation("acceptChanges");
    let em = this.entityManager!;
    if (this.entityState.isDeleted()) {
      em.detachEntity(this.entity);
    } else {
      this.setUnchanged();
    }
    em.entityChanged.publish({ entityAction: EntityAction.AcceptChanges, entity: this.entity });
  }

  /**
  Returns the entity to an {@link EntityState} of 'Unchanged' by rejecting all changes made to it since the entity was last queried
  had 'rejectChanges' called on it.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.rejectChanges();
  // The 'order' entity will now be in an 'Unchanged' state with any changes rejected.
  ```
  */
  rejectChanges() {
    this._checkOperation("rejectChanges");
    let entity = this.entity!;
    let entityManager = this.entityManager!;
    // we do not want PropertyChange or EntityChange events to occur here
    core.using(entityManager, "isRejectingChanges", true, function () {
      rejectChangesCore(entity);
    });
    if (this.entityState.isAdded()) {
      // next line is needed because the following line will cause this.entityManager -> null;
      entityManager.detachEntity(entity);
      // need to tell em that an entity that needed to be saved no longer does.
      entityManager._notifyStateChange(entity, false);
    } else {
      if (this.entityState.isDeleted()) {
        entityManager._linkRelatedEntities(entity);
      }
      this.setUnchanged();
      // propertyChanged propertyName is not specified because more than one property may have changed.
      this.propertyChanged.publish({ entity: entity, propertyName: null });
      entityManager.entityChanged.publish({ entityAction: EntityAction.RejectChanges, entity: entity });
    }
  }

  /**  @hidden @internal */
  // TODO: rename - and use '_'; used on both EntityAspect and ComplexAspect for polymorphic reasons.
  getPropertyPath(propName: string) {
    return propName;
  }

  /**
  Sets the entity to an EntityState of 'Added'.  This is NOT the equivalent of calling {@link EntityManager.addEntity}
  because no key generation will occur for autogenerated keys as a result of this operation. As a result this operation can be problematic
  unless you are certain that the entity being marked 'Added' does not already exist in the database and does not have an autogenerated key.
  The same operation can be performed by calling {@link EntityAspect.setEntityState}.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setAdded();
  // The 'order' entity will now be in an 'Added' state.
  ```
  */
  setAdded() {
    return this.setEntityState(EntityState.Added);
  }

  /**
  Sets the entity to an EntityState of 'Unchanged'.  This is also the equivalent of calling {@link EntityAspect.acceptChanges}.
  The same operation can be performed by calling {@link EntityAspect.setEntityState}.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setUnchanged();
  // The 'order' entity will now be in an 'Unchanged' state with any changes committed.
  ```
  */
  setUnchanged = function () {
    return this.setEntityState(EntityState.Unchanged);
  };


  /**
  Sets the entity to an EntityState of 'Modified'.  This can also be achieved by changing the value of any property on an 'Unchanged' entity.
  The same operation can be performed by calling {@link EntityAspect.setEntityState}.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setModified();
  // The 'order' entity will now be in a 'Modified' state.
  ```
  */
  setModified = function () {
    return this.setEntityState(EntityState.Modified);
  };

  /**
  Sets the entity to an EntityState of 'Deleted'.  This both marks the entity as being scheduled for deletion during the next 'Save' call
  but also removes the entity from all of its related entities.  If the current entityState is 'Added', then `setDeleted()` will mark it 'Detached'
  The same operation can be performed by calling {@link EntityAspect.setEntityState}.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setDeleted();
  // The 'order' entity will now be in a 'Deleted' state and it will no longer have any 'related' entities.
  ```
  */
  setDeleted = function () {
    return this.setEntityState(EntityState.Deleted);
  };

  /**
  Sets the entity to an EntityState of 'Detached'.  This removes the entity from all of its related entities, but does NOT change the EntityState of any existing entities.
  The same operation can be performed by calling {@link EntityAspect.setEntityState}.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setDetached();
  // The 'order' entity will now be in a 'Detached' state and it will no longer have any 'related' entities.
  ```
  */
  setDetached = function () {
    return this.setEntityState(EntityState.Detached);
  };

  /**
  Sets the entity to the specified EntityState. See also 'setUnchanged', 'setModified', 'setDetached', etc.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  order.entityAspect.setEntityState(EntityState.Unchanged);
  // The 'order' entity will now be in a 'Unchanged' state.
  ```
  */
  setEntityState(entityState: EntityState) {
    if (this.entityState === entityState) return false;
    this._checkOperation("setEntityState");
    if (this.entityState.isDetached()) {
      throw new Error("You cannot set the 'entityState' of an entity when it is detached - except by first attaching it to an EntityManager");
    }
    let entity = this.entity!;
    let em = this.entityManager!;
    let needsSave = true;
    if (entityState === EntityState.Unchanged) {
      clearOriginalValues(entity);
      this.hasTempKey = undefined;   // not delete: every entity that becomes Unchanged runs this
      needsSave = false;
    } else if (entityState === EntityState.Added) {
      clearOriginalValues(entity);
      // TODO: more to do here... like regenerating key ???
    } else if (entityState === EntityState.Deleted) {
      if (this.entityState.isAdded()) {
        // turn it into a detach and exit early
        this.setEntityState(EntityState.Detached);
        return true;
      } else {
        // TODO: think about cascade deletes
        // entityState needs to be set it early in this one case to insure that fk's are not cleared.
        this.entityState = EntityState.Deleted;
        removeFromRelations(entity, EntityState.Deleted);
      }
    } else if (entityState === EntityState.Modified) {
      // nothing extra needed
    } else if (entityState === EntityState.Detached) {
      let group = this.entityGroup;
      // no group === already detached.
      if (!group) return false;
      group.detachEntity(entity);
      // An entity whose foreign keys named parents that are not in the cache is parked in the
      // unattached-children map, waiting for them. Detaching it has to take it back out, or the
      // manager holds it for good: clear() replaces the whole map, but detachEntity does not.
      em._unattachedChildrenMap.removeChild(entity);
      // needs to occur early here - so this IS deliberately redundent with the same code later in this method.
      this.entityState = entityState;
      removeFromRelations(entity, EntityState.Detached);
      this._detach();
      em.entityChanged.publish({ entityAction: EntityAction.Detach, entity: entity });
      needsSave = false;
    }
    this.entityState = entityState;
    em._notifyStateChange(entity, needsSave);
    return true;
  }

  loadNavigationProperty(navigationProperty: string): Promise<QueryResult>;
  loadNavigationProperty(navigationProperty: NavigationProperty): Promise<QueryResult>;
  /** @deprecated Await the returned promise instead of passing callbacks. */
  loadNavigationProperty(navigationProperty: string, callback?: QuerySuccessCallback, errorCallback?: QueryErrorCallback): Promise<QueryResult>;
  /** @deprecated Await the returned promise instead of passing callbacks. */
  loadNavigationProperty(navigationProperty: NavigationProperty, callback?: QuerySuccessCallback, errorCallback?: QueryErrorCallback): Promise<QueryResult>;
  /**
  Performs a query for the value of a specified {@link NavigationProperty}. __Async__
  ```ts
  emp.entityAspect.loadNavigationProperty("Orders").then(function (data) {
      var orders = data.results;
  }).catch(function (exception) {
      // handle exception here;
  });
  ```
  @param navigationProperty - The NavigationProperty or the name of the NavigationProperty to 'load'.
  @param callback - Deprecated. Function to call on success.
  @param errorCallback - Deprecated. Function to call on failure.
  @returns Promise with shape
    - results {Array of Entity}
    - query {EntityQuery} The original query
    - httpResponse {httpResponse} The HttpResponse returned from the server.
  */
  loadNavigationProperty(navigationProperty: NavigationProperty | string, callback?: QuerySuccessCallback, errorCallback?: QueryErrorCallback): Promise<QueryResult> {
    let entity = this.entity!;
    let navProperty = entity.entityType._checkNavProperty(navigationProperty);
    let query = EntityQuery.fromEntityNavigation(entity, navProperty);
    // return entity.entityAspect.entityManager.executeQuery(query, callback, errorCallback);
    let promise = entity.entityAspect.entityManager!.executeQuery(query);

    return promise.then((data) => {
      this._markAsLoaded(navProperty.name);
      if (callback) callback(data);
      return Promise.resolve(data);
    }, (error) => {
      if (errorCallback) errorCallback(error);
      return Promise.reject(error);
    });

  }

  /**
  Marks this navigationProperty on this entity as already having been loaded.
  ```ts
  emp.entityAspect.markNavigationPropertyAsLoaded("Orders");
  ```
  @param navigationProperty - The NavigationProperty or name of NavigationProperty to 'load'.
  */
  markNavigationPropertyAsLoaded(navigationProperty: NavigationProperty | string) {
    if (!this.entity) return;
    let navProperty = this.entity.entityType._checkNavProperty(navigationProperty);
    this._markAsLoaded(navProperty.name);
  }

  isNavigationPropertyLoaded(navigationProperty: string): boolean;
  isNavigationPropertyLoaded(navigationProperty: NavigationProperty): boolean;
  /**
  Determines whether a navigationProperty on this entity has already been loaded.

  A navigation property is considered loaded when any of the following three conditions applies:

    1. It was fetched from the backend server.
        <br/>   This can be the result of an expand query or a call to the {@link EntityAspect.loadNavigationProperty} method.
        <br/>   Note that even if the fetch returns nothing the property is still marked as loaded in this case.
    1. The property is scalar and has been set to a nonnull value.
    1. The {@link EntityAspect.markNavigationPropertyAsLoaded} was called.
  
  ```ts
  var wasLoaded = emp.entityAspect.isNavigationPropertyLoaded("Orders");
  ```
  @param navigationProperty - The NavigationProperty or name of NavigationProperty to 'load'.
  */
  isNavigationPropertyLoaded(navigationProperty: NavigationProperty | string): boolean {
    // Both returns below used to hand back `undefined` - a bare `return`, and `this._loadedNps &&`
    // when nothing has been marked yet - while the overload signatures above promise `boolean`.
    // TypeScript does not check an implementation signature against its own overloads, so callers
    // were told `boolean` and could be given `undefined`.
    if (!this.entity) return false;
    let navProperty = this.entity.entityType._checkNavProperty(navigationProperty);
    if (navProperty.isScalar && this.entity.getProperty(navProperty.name) != null) {
      return true;
    }
    return !!this._loadedNps && this._loadedNps.indexOf(navProperty.name) >= 0;
  }

  /** @hidden @internal */
  _markAsLoaded(navPropName: string) {
    this._loadedNps = this._loadedNps || [];
    core.arrayAddItemUnique(this._loadedNps, navPropName);
  }


  /**
  Performs validation on the entity, any errors encountered during the validation are available via the
  {@link EntityAspect.getValidationErrors} method. Validating an entity means executing
  all of the validators on both the entity itself as well as those on each of its properties.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var isOk = order.entityAspect.validateEntity();
  // isOk will be 'true' if there are no errors on the entity.
  if (!isOk) {
      var errors = order.entityAspect.getValidationErrors();
  }
  ```
  @returns Whether the entity can be saved: every validator passes, and no error added with
  {@link EntityAspect.addValidationError} remains. Errors from the server are not counted - a save
  clears them before validating, and the server checks again. This is the check `saveChanges`
  makes, so the two always agree.
  */
  validateEntity() {
    let ok = true;
    this._processValidationOpAndPublish(function (that: any) {
      ok = validateTarget(that.entity);
    });
    // validateTarget re-runs the validators, so on its own it answers only for the errors
    // validators make. An error added with addValidationError is still an error, and the entity is
    // not valid while it stands - it used to be ignored here, and so saveChanges, which asks this,
    // sent the entity anyway. The server's errors are the exception: every save clears them before
    // validating, because the server checks again, and counting them here would make this answer
    // differ from the one a save gets.
    return ok && !this._hasBlockingErrors();
  }

  validateProperty(property: string, context?: any): boolean;
  validateProperty(property: DataProperty, context?: any): boolean;
  validateProperty(property: NavigationProperty, context?: any): boolean;
  /**
  Performs validation on a specific property of this entity, any errors encountered during the validation are available via the
  {@link EntityAspect.getValidationErrors} method. Validating a property means executing
  all of the validators on the specified property.  This call is also made automatically anytime a property
  of an entity is changed.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var isOk = order.entityAspect.validateProperty("Order");
  ```

  or
  ```ts
  var orderDateProperty = order.entityType.getProperty("OrderDate");
  var isOk = order.entityAspect.validateProperty(OrderDateProperty);
  ```
  @param property - The {@link DataProperty} or {@link NavigationProperty} to validate or a string 
  with the name of the property or a property path with the path to a property of a complex object.
  @param context -  A context object used to pass additional information to each {@link Validator}.
  @returns Whether the property can be saved: its validators pass, and no error added with
  {@link EntityAspect.addValidationError} about it remains. As with {@link EntityAspect.validateEntity},
  errors from the server are not counted.
  */
  validateProperty(property: EntityProperty | string, context: any) {
    let value = this.getPropertyValue(property); // performs validations
    // As validateEntity: an error added with addValidationError for this property counts too.
    const propertyName = typeof property === "string" ? property : property.name;
    if (value && value.complexAspect) {
      return validateTarget(value) && !this._hasBlockingErrors(propertyName);
    }
    context = context || {};
    context.entity = this.entity;
    if (typeof property === "string") {
      context.property = this.entity!.entityType.getProperty(property, true);
      context.propertyName = property;
    } else {
      context.property = property;
      context.propertyName = property.name;
    }

    return this._validateProperty(value, context) && !this._hasBlockingErrors(context.propertyName);
  }

  /**
  Validates the entity as {@link EntityAspect.validateEntity} does, and also runs its async
  validators - see {@link Validator.isAsync} - resolving when they have all answered. This is the
  check `saveChanges` makes when any of the entities it saves has an async validator.
  ```ts
  if (!await order.entityAspect.validateEntityAsync()) {
    const errors = order.entityAspect.getValidationErrors();
  }
  ```
  While it runs, {@link EntityAspect.isValidating} is true. If a property changes while one of its
  checks runs, the check is run again on the new value.
  @returns Whether the entity can be saved, as {@link EntityAspect.validateEntity} answers, once the
  async validators' answers are in.
  */
  async validateEntityAsync(): Promise<boolean> {
    this.validateEntity();
    await runAsyncChecks(this, collectAsyncChecks(this.entity));
    return !this._hasBlockingErrors();
  }

  /**
  Validates one property as {@link EntityAspect.validateProperty} does, and also runs its async
  validators, resolving when they have all answered.
  ```ts
  const isOk = await customer.entityAspect.validatePropertyAsync("companyName");
  ```
  @param property - The property, by {@link DataProperty}, {@link NavigationProperty}, name, or path
  to a property of a complex object.
  @param context - Additional context for each {@link Validator}.
  @returns Whether the property can be saved, once the async validators' answers are in.
  */
  async validatePropertyAsync(property: EntityProperty | string, context?: any): Promise<boolean> {
    this.validateProperty(property as any, context && { ...context });
    await runAsyncChecks(this, collectAsyncPropertyChecks(this, property, context));
    return !this._hasBlockingErrors(typeof property === "string" ? property : property.name);
  }

  getValidationErrors(): ValidationError[];
  getValidationErrors(property: string): ValidationError[];
  getValidationErrors(property: EntityProperty): ValidationError[];
  /**
  Returns the validation errors associated with either the entire entity or any specified property.
  
  This method can return all of the errors for an Entity
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var valErrors = order.entityAspect.getValidationErrors();
  ```

  as well as those for just a specific property.
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var orderDateErrors = order.entityAspect.getValidationErrors("OrderDate");
  ```

  which can also be expressed as
  ```ts
  // assume order is an order entity attached to an EntityManager.
  var orderDateProperty = order.entityType.getProperty("OrderDate");
  var orderDateErrors = order.entityAspect.getValidationErrors(orderDateProperty);
  ```
  @param property - The property for which validation errors should be retrieved.
  If omitted, all of the validation errors for this entity will be returned.
  @returns A array of validation errors.
  */
  getValidationErrors(property?: DataProperty | NavigationProperty | string) {
    assertParam(property, "property").isOptional().isEntityProperty().or().isString().check();
    let result = core.getOwnPropertyValues(this._validationErrors);
    if (property) {
      let propertyName = typeof (property) === 'string' ? property : property.name;
      // By propertyName as well as by the property object: an error added with only a
      // propertyName in its context - as the validation guide shows - has no property object, and
      // was missing from this list while validateProperty reported the property invalid because
      // of it. A form asking "why is this field wrong?" got an empty answer.
      result = result.filter(function (ve: ValidationError) {
        return (ve.property && ve.property.name === propertyName) || ve.propertyName === propertyName;
      });
    }
    return result;
  }

  /**
  The value a property had before the entity's pending changes: its original value if it has been
  edited since the entity was last saved or accepted, and its current value if not. So it answers
  "what was this?" without first asking whether it changed.
  ```ts
  order.freight = 99;
  order.entityAspect.getOriginalValue('freight');    // the freight before the edit
  order.entityAspect.getOriginalValue('shipCity');   // unchanged, so its current value
  ```
  Also takes a path into a complex property, such as `'location.city'`.
  @param propertyName - A data property of this entity, or a path to one in a complex property.
  */
  getOriginalValue(propertyName: string): any {
    let target: any = this.entity;
    let name = propertyName;
    const dot = name.lastIndexOf('.');
    if (dot >= 0) {
      target = this.getPropertyValue(name.slice(0, dot));
      name = name.slice(dot + 1);
    }
    const originals = (target.entityAspect || target.complexAspect).originalValues;
    return Object.prototype.hasOwnProperty.call(originals, name) ? originals[name] : target.getProperty(name);
  }

  /**
  The data properties whose value now differs from the one the entity was last saved or accepted
  with - as paths, such as `'location.city'`, for those of a complex property, and by name for an
  array property whose contents changed. A property edited and then set back is not included,
  although it stays in {@link EntityAspect.originalValues}. Dates are compared by time.
  ```ts
  order.freight = 99;
  order.shipCity = order.shipCity;              // set, but to the same value
  order.entityAspect.getChangedProperties();    // ['freight']
  ```
  Always empty for an `Added` entity, which has no original values to differ from.
  */
  getChangedProperties(): string[] {
    return this.entity ? changedPropertyPaths(this.entity, this.originalValues, '') : [];
  }

  /**
  Adds a validation error.

  An error added here stops the entity being saved - `validateEntity` returns false and
  `saveChanges` rejects - until it is removed with {@link EntityAspect.removeValidationError} or
  {@link EntityAspect.clearValidationErrors}. Editing the property does not remove it: Breeze
  cannot re-check a rule it did not run. Give the error a key, and a failed save names it by that
  key in `errorName`.
  */
  addValidationError(validationError: ValidationError) {
    assertParam(validationError, "validationError").isInstanceOf(ValidationError).check();
    this._processValidationOpAndPublish(function (that: any) {
      that._addValidationError(validationError);
    });
  }

  removeValidationError(validationError: ValidationError): void;
  removeValidationError(validationKey: string): void;
  removeValidationError(validator: Validator): void;
  /**
  Removes a validation error.
  @param validationErrorOrKey - A ValidationError, a ValidationError 'key' value, or a Validator -
  in which case every error that validator produced on this entity is removed.
  */
  removeValidationError(validationErrorOrKey: ValidationError | string | Validator) {
    assertParam(validationErrorOrKey, "validationErrorOrKey").isString().or().isInstanceOf(ValidationError).or().isInstanceOf(Validator).check();

    let keys: string[];
    if (typeof (validationErrorOrKey) === "string") {
      keys = [validationErrorOrKey];
    } else if (validationErrorOrKey instanceof Validator) {
      // A Validator has no key of its own - reading one used to remove nothing, silently.
      const errors = this._validationErrors as Record<string, ValidationError>;
      keys = Object.keys(errors).filter(k => errors[k]?.validator === validationErrorOrKey);
    } else {
      keys = [validationErrorOrKey.key];
    }
    this._processValidationOpAndPublish(function (that: any) {
      keys.forEach(key => that._removeValidationError(key));
    });
  }

  /**
  Removes all of the validation errors for a specified entity
  */
  clearValidationErrors() {
    this._processValidationOpAndPublish(function (that: any) {
      core.objectForEach(that._validationErrors, function (key: string, valError: ValidationError) {
        if (valError) {
          delete that._validationErrors[key];
          that._pendingValidationResult.removed.push(valError);
        }
      });
      that.hasValidationErrors = !core.isEmpty(that._validationErrors);
    });
  }

  /**
  Returns an {@link EntityKey} for the entity pointed to by the specified scalar NavigationProperty.
  This only returns an EntityKey if the current entity is a 'child' entity along the specified NavigationProperty. 
  i.e. has a single parent.

  @param navigationProperty - The {@link NavigationProperty} ( pointing to a parent). 
  @returns Either a parent EntityKey if this is a 'child' entity or null;  
  */
  getParentKey(navigationProperty: NavigationProperty) {
    if (!this.entity) return null;
    let fkNames = navigationProperty.foreignKeyNames;
    if (fkNames.length === 0) return null;
    let that = this;
    let fkValues = fkNames.map(function (fkn) {
      return that.entity!.getProperty(fkn);
    });
    return new EntityKey(navigationProperty.entityType, fkValues);
  }

  // TODO: refactor this and the static getPropertyPathValue.
  /**
  Returns the value of a specified DataProperty or NavigationProperty or 'property path'.  
  */
  getPropertyValue(property: string | DataProperty | NavigationProperty) {
    assertParam(property, "property").isString().or().isEntityProperty().check();
    let value: any;
    if (typeof (property) === 'string') {
      let propNames = property.trim().split(".");
      let propName = propNames.shift();
      value = this.entity;
      value = value.getProperty(propName);
      while (propNames.length > 0) {
        propName = propNames.shift();
        value = value.getProperty(propName);
      }
    } else {
      if (!(property.parentType instanceof EntityType)) {
        throw new Error("The validateProperty method does not accept a 'property' parameter whose parentType is a ComplexType; " +
          "Pass a 'property path' string as the 'property' parameter instead ");
      }
      value = this.entity!.getProperty(property.name);
    }
    return value;
  }

  // internal methods
  /** @hidden @internal */
  _checkOperation(operationName: string) {
    if (this.isBeingSaved) {
      throw new Error("Cannot perform a '" + operationName + "' on an entity that is in the process of being saved");
    }
    // allows chaining
    return this;
  }

  /** @hidden @internal */
  _detach() {
    this.entityGroup = undefined;
    this.entityManager = undefined;
    this.entityState = EntityState.Detached;
    this.originalValues = {};
    this._validationErrors = {};
    this.hasValidationErrors = false;
    this.validationErrorsChanged.clear();
    this.propertyChanged.clear();
    if (this._asyncChecks) {
      this._asyncChecks.forEach(run => run.controller.abort());
      this._asyncChecks = undefined;
    }
  }


  // called from defaultInterceptor.
  /** @hidden @internal */
  _validateProperty(value: any, context: any) {
    let ok = true;
    this._processValidationOpAndPublish(function (that: any) {
      context.property.getAllValidators().forEach(function (validator: Validator) {
        ok = validate(that, validator, value, context) && ok;
      });
    });
    return ok;
  }

  /** @hidden @internal */
  _processValidationOpAndPublish(validationFn: any) {
    if (this._pendingValidationResult) {
      // only top level processValidations call publishes
      validationFn(this);
    } else {
      try {
        this._pendingValidationResult = { entity: this.entity, added: [], removed: [] };
        validationFn(this);
        if (this._pendingValidationResult.added.length > 0 || this._pendingValidationResult.removed.length > 0) {
          this.validationErrorsChanged.publish(this._pendingValidationResult);
          // this might be a detached entity hence the guard below.
          this.entityManager && this.entityManager.validationErrorsChanged.publish(this._pendingValidationResult);

        }
      } finally {
        this._pendingValidationResult = undefined;
      }
    }
  }

  /** @hidden @internal */
  // Whether an error stands that should stop this entity being saved - every error except the
  // server's, which a save clears before validating. With a property name, only errors about that
  // property, or about a property inside it when it is a complex property.
  _hasBlockingErrors(propertyName?: string) {
    if (!this.hasValidationErrors) return false;
    const errors = this._validationErrors;
    for (const key in errors) {
      const ve = errors[key];
      if (!ve || ve.isServerError) continue;
      if (propertyName == null || isAbout(ve, propertyName)) return true;
    }
    return false;
  }

  /** @hidden @internal */
  // Drops the errors about a property that its edit has made stale: the server's, and those of
  // async validators, which cannot run again until the next save or validateEntityAsync. Both were
  // about a value the entity no longer has. Runs on every edit that is not part of a load, so the
  // entity with no errors - nearly all of them - pays one flag check.
  _clearStaleErrors(propertyName: string) {
    if (!this.hasValidationErrors) return;
    const keys: string[] = [];
    const errors = this._validationErrors;
    for (const key in errors) {
      const ve = errors[key];
      if (ve && (ve.isServerError || ve.validator?.isAsync) && isAbout(ve, propertyName)) keys.push(key);
    }
    if (keys.length === 0) return;
    this._processValidationOpAndPublish(function (that: EntityAspect) {
      keys.forEach(key => that._removeValidationError(key));
    });
  }

  /** @hidden @internal */
  _addValidationError(validationError: ValidationError) {
    this._validationErrors[validationError.key] = validationError;
    this.hasValidationErrors = true;
    this._pendingValidationResult.added.push(validationError);
  }

  /** @hidden @internal */
  _removeValidationError(key: string) {
    let valError = this._validationErrors[key];
    if (valError) {
      delete this._validationErrors[key];
      this.hasValidationErrors = !core.isEmpty(this._validationErrors);
      this._pendingValidationResult.removed.push(valError);
    }
  }

}

BreezeEvent.bubbleEvent(EntityAspect.prototype, function () {
  return this.entityManager;
});

function rejectChangesCore(target: any) {
  let aspect = target.entityAspect || target.complexAspect;
  let stype = target.entityType || target.complexType;
  let originalValues = aspect.originalValues;
  for (let propName in originalValues) {
    target.setProperty(propName, originalValues[propName]);
  }
  stype.complexProperties.forEach(function (cp: any) {
    let cos = target.getProperty(cp.name);
    if (cp.isScalar) {
      rejectChangesCore(cos);
    } else {
      observableArray.rejectChanges(cos);
      cos.forEach(rejectChangesCore);
    }
  });
}

/**
 * The value of a property as stored, without creating anything. A collection navigation is built
 * on first read, so code that only wants to look at *existing* related entities - attaching,
 * deleting - asks with this. Falls back to getProperty for a model library that cannot peek,
 * which just means the collection is created as it was before.
 * @hidden @internal
 */
export function peekProperty(entity: StructuralObject, propertyName: string): any {
  const modelLibrary = config.interfaceRegistry.modelLibrary.getDefaultInstance() as any;
  return modelLibrary.peekProperty
    ? modelLibrary.peekProperty(entity, propertyName)
    : (entity as any).getProperty(propertyName);
}

function removeFromRelations(entity: Entity, entityState: EntityState) {
  // remove this entity from any collections.
  // mark the entity deleted or detached

  let isDeleted = entityState.isDeleted();
  if (isDeleted) {
    removeFromRelationsCore(entity);
  } else {
    core.using(entity.entityAspect.entityManager!, "isLoading", true, function () {
      removeFromRelationsCore(entity);
    });
  }
}

function removeFromRelationsCore(entity: Entity) {
  entity.entityType.navigationProperties.forEach(function (np) {
    let inverseNp = np.inverse;
    // A collection that has never been read holds no related entities, and reading it here would
    // create an array only to empty it.
    let npValue = np.isScalar ? entity.getProperty(np.name) : peekProperty(entity, np.name);
    if (np.isScalar) {
      if (npValue) {
        if (inverseNp) {
          if (inverseNp.isScalar) {
            npValue.setProperty(inverseNp.name, null);
          } else {
            let collection = npValue.getProperty(inverseNp.name);
            if (collection.length) {
              core.arrayRemoveItem(collection, entity);
            }
          }
        }
        entity.setProperty(np.name, null);
      }
    } else {
      if (npValue == null) return;
      // Empty it in one go rather than letting each child splice itself out, which is O(n) per
      // child and one event per child. clearAll nulls each child's reference to this entity
      // first - so the child still gets its navigation property and foreign key cleared - then
      // truncates and publishes a single arrayChanged. A many-to-many inverse has nothing to
      // null on the other side, so it is emptied with no per-child step. (TODO: many to many.)
      const clearChild = inverseNp != null && inverseNp.isScalar
        ? (v: any) => v.setProperty(inverseNp!.name, null)
        : undefined;
      observableArray.clearAll(npValue, clearChild);
    }
  });

}

// note entityAspect only - ( no complex aspect allowed on the call).
/** Whether a validation error concerns a property: that property, or one inside it by path. */
function isAbout(ve: ValidationError, propertyName: string) {
  const name = ve.propertyName;
  return name === propertyName || (name != null && name.startsWith(propertyName + '.'));
}

function validate(entityAspect: EntityAspect, validator: Validator, value: any, context?: any) {
  // Nothing here can wait for an async validator's answer, so it is not asked; its last settled
  // answer stands. It runs from validateEntityAsync, and when the entity is saved.
  if (validator.isAsync) return true;
  let ve = validator.validate(value, context);
  if (ve) {
    entityAspect._addValidationError(ve);
    return false;
  } else {
    let key = ValidationError.getKey(validator, context ? context.propertyName : null);
    entityAspect._removeValidationError(key);
    return true;
  }
}

/** One async validator to run: the value to check, the context it gets, and how to read the value
again - to tell whether it changed while it was being checked. */
interface AsyncCheck {
  validator: Validator;
  value: any;
  context?: any;
  read: () => any;
}

/** @hidden @internal */
export interface AsyncCheckRun {
  controller: AbortController;
  done: Promise<void>;
}

/** How many times a check is run again because its value keeps changing while it is checked. */
const MAX_ASYNC_ROUNDS = 3;

/** The async validators of an entity or complex object, walked as validateTarget walks the sync ones. */
function collectAsyncChecks(target: any, coIndex?: number): AsyncCheck[] {
  const checks: AsyncCheck[] = [];
  const stype = target.entityType || target.complexType;
  const aspect = target.entityAspect || target.complexAspect;
  const entityAspect = target.entityAspect || target.complexAspect.getEntityAspect();

  stype.getProperties().forEach((p: any) => {
    const read = () => p.isNavigationProperty && !p.isScalar ? peekProperty(target, p.name) : target.getProperty(p.name);
    const value = read();
    const asyncValidators = p.getAllValidators().filter((v: Validator) => v.isAsync);
    if (asyncValidators.length > 0) {
      // A context of its own for each property: validateTarget reuses one, which an async check,
      // still reading it later, would see changed underneath it.
      const context: any = { entity: entityAspect.entity, property: p, propertyName: aspect.getPropertyPath(p.name) };
      if (coIndex !== undefined) context.index = coIndex;
      asyncValidators.forEach((validator: Validator) => checks.push({ validator, value, context, read }));
    }
    if (p.isComplexProperty) {
      if (p.isScalar) {
        checks.push(...collectAsyncChecks(value));
      } else {
        value.forEach((co: any, ix: number) => checks.push(...collectAsyncChecks(co, ix)));
      }
    }
  });

  stype.getAllValidators().filter((v: Validator) => v.isAsync).forEach((validator: Validator) => {
    checks.push({ validator, value: target, read: () => target });
  });
  return checks;
}

/** The async validators of one property, found as validateProperty finds the sync ones. */
function collectAsyncPropertyChecks(aspect: EntityAspect, property: EntityProperty | string, context?: any): AsyncCheck[] {
  const read = () => aspect.getPropertyValue(property);
  const value = read();
  if (value && value.complexAspect) return collectAsyncChecks(value);
  const prop = typeof property === "string" ? aspect.entity!.entityType.getProperty(property, true)! : property;   // throws if not found
  const propertyName = typeof property === "string" ? property : property.name;
  const checkContext = { ...context, entity: aspect.entity, property: prop, propertyName };
  return prop.getAllValidators().filter((v: Validator) => v.isAsync)
    .map((validator: Validator) => ({ validator, value, context: checkContext, read }));
}

function runAsyncChecks(aspect: EntityAspect, checks: AsyncCheck[]) {
  return Promise.all(checks.map(check => runAsyncCheck(aspect, check, 1)));
}

/**
Runs one async check and applies its answer, unless the answer is no longer wanted: a newer run of
the same check has started - whose answer is then the one waited for - or the entity was detached.
If the value changed while it was checked, the check runs again on the new value.
*/
function runAsyncCheck(aspect: EntityAspect, check: AsyncCheck, round: number): Promise<void> {
  const key = ValidationError.getKey(check.validator, check.context && check.context.propertyName);
  const runs = aspect._asyncChecks || (aspect._asyncChecks = new Map());
  runs.get(key)?.controller.abort();
  const controller = new AbortController();
  const run = { controller } as AsyncCheckRun;
  runs.set(key, run);

  run.done = check.validator.validateAsync(check.value, { ...check.context, signal: controller.signal }).then(ve => {
    const current = aspect._asyncChecks?.get(key);
    if (current !== run) return current?.done;      // replaced, or detached
    aspect._asyncChecks!.delete(key);
    const valueNow = check.read();
    if (valueNow !== check.value) {
      return round < MAX_ASYNC_ROUNDS ? runAsyncCheck(aspect, { ...check, value: valueNow }, round + 1) : undefined;
    }
    aspect._processValidationOpAndPublish((that: EntityAspect) => {
      if (ve) {
        that._addValidationError(ve);
      } else {
        that._removeValidationError(key);
      }
    });
  });
  return run.done;
}

/** The paths of target's data properties whose value differs from its original one. */
function changedPropertyPaths(target: any, originalValues: Record<string, any>, prefix: string): string[] {
  const stype = target.entityType || target.complexType;
  const paths: string[] = [];
  stype.dataProperties.forEach((dp: DataProperty) => {
    const path = prefix + dp.name;
    if (dp.isComplexProperty) {
      const value = target.getProperty(dp.name);
      if (dp.isScalar) {
        if (value) paths.push(...changedPropertyPaths(value, value.complexAspect.originalValues, path + '.'));
      } else if (arrayContentsChanged(value) ||
        (value || []).some((co: any) => changedPropertyPaths(co, co.complexAspect.originalValues, '').length > 0)) {
        paths.push(path);
      }
    } else if (!dp.isScalar) {
      if (arrayContentsChanged(target.getProperty(dp.name))) paths.push(path);
    } else if (Object.prototype.hasOwnProperty.call(originalValues, dp.name)) {
      const comparable = DataType.getComparableFn(dp.dataType as DataType);
      if (comparable(originalValues[dp.name]) !== comparable(target.getProperty(dp.name))) paths.push(path);
    }
  });
  return paths;
}

/** Whether an array property's contents differ from those it had before its entity was changed. */
function arrayContentsChanged(arr: any): boolean {
  const original = observableArray.originalContents(arr);
  if (!original) return false;
  return original.length !== arr.length || original.some((item: any, ix: number) => item !== arr[ix]);
}

// coIndex is only used where target is a complex object that is part of an array of complex objects
// in which case ctIndex is the index of the target within the array.
function validateTarget(target: any, coIndex?: number) {
  let ok = true;
  let stype = target.entityType || target.complexType;
  let aspect = target.entityAspect || target.complexAspect;
  let entityAspect = target.entityAspect || target.complexAspect.getEntityAspect();
  let context = <any>{ entity: entityAspect.entity };
  if (coIndex !== undefined) {
    context.index = coIndex;
  }

  stype.getProperties().forEach(function (p: any) {
    let value = p.isNavigationProperty && !p.isScalar
      ? peekProperty(target, p.name)
      : target.getProperty(p.name);
    let validators = p.getAllValidators();
    if (validators.length > 0) {
      context.property = p;
      context.propertyName = aspect.getPropertyPath(p.name);
      ok = entityAspect._validateProperty(value, context) && ok;
    }
    if (p.isComplexProperty) {
      if (p.isScalar) {
        ok = validateTarget(value) && ok;
      } else {
        ok = value.reduce(function (pv: any, cv: any, ix: number) {
          return validateTarget(cv, ix) && pv;
        }, ok);
      }
    }
  });


  // then target level
  stype.getAllValidators().forEach(function (validator: Validator) {
    ok = validate(entityAspect, validator, target) && ok;
  });
  return ok;
}

/**
An ComplexAspect instance is associated with every complex object instance and is accessed via the complex object's 'complexAspect' property.

The ComplexAspect itself provides properties to determine the parent object, parent property and original values for the complex object.

A ComplexAspect will almost never need to be constructed directly. You will usually get an ComplexAspect by accessing
an entities 'complexAspect' property.  This property will be automatically attached when an complex object is created as part of an
entity via either a query, import or EntityManager.createEntity call.
```ts
// assume address is a complex property on the 'Customer' type
var aspect = aCustomer.address.complexAspect;
// aCustomer === aspect.parent;
```
*/
export class ComplexAspect {

  /** The complex object that this aspect is associated with. __Read Only__ */
  complexObject: ComplexObject;
  /** The 'original values' of this complex object where they are different from the 'current values'.
  This is a map where the key is a property name and the value is the 'original value' of the property.
  __Read Only__ */
  originalValues: Record<string, any>;
  /** The parent object that to which this aspect belongs; this will either be an entity or another complex object. __Read Only__ */
  parent?: StructuralObject;
  /** The {@link DataProperty} on the 'parent' that contains this complex object. __Read Only__ */
  parentProperty?: DataProperty;
  /** Unlike {@link EntityAspect.extraMetadata}, Breeze does not fill this in and does not export it.
  An application may use it to hold its own data about the complex object. */
  extraMetadata?: any;

  /** You will rarely, if ever, create a ComplexAspect directly. */
  constructor(complexObject: ComplexObject, parent: StructuralObject, parentProperty: DataProperty) {
    if (!complexObject) {
      throw new Error("The  ComplexAspect ctor requires an entity as its only argument.");
    }
    if (complexObject.complexAspect) {
      return complexObject.complexAspect;
    }
    // if called without new
    if (!(this instanceof ComplexAspect)) {
      return new ComplexAspect(complexObject, parent, parentProperty);
    }

    // entityType should already be on the entity from 'watch'
    this.complexObject = complexObject;
    complexObject.complexAspect = this;

    // TODO: keep public or not?
    this.originalValues = {};

    // if a standalone complexObject
    if (parent != null) {
      this.parent = parent;
      this.parentProperty = parentProperty;
    }

    let complexType = complexObject.complexType;
    if (!complexType) {
      let typeName = complexObject.prototype!._$typeName;
      if (!typeName) {
        throw new Error("This entity is not registered as a valid ComplexType");
      } else {
        throw new Error("Metadata for this complexType has not yet been resolved: " + typeName);
      }
    }
    let complexCtor = complexType.getCtor();
    config.interfaceRegistry.modelLibrary.getDefaultInstance().startTracking(complexObject, complexCtor.prototype);

  }


  /**
  Returns the EntityAspect for the top level entity that contains this complex object.
  */
  getEntityAspect() {
    let parent = <any>this.parent;
    if (!parent) return new EntityAspect();
    let entityAspect = parent.entityAspect;
    while (parent && !entityAspect) {
      parent = parent.complexAspect && parent.complexAspect.parent;
      entityAspect = parent && parent.entityAspect;
    }
    return entityAspect || new EntityAspect();
  }

  /**  @hidden @internal */
  // TODO: rename - and use '_'; used on both EntityAspect and ComplexAspect for polymorphic reasons.
  getPropertyPath(propName: string) {
    let parent = <any>this.parent;
    if (!parent) return null;
    let aspect = parent.complexAspect || parent.entityAspect;
    return aspect.getPropertyPath(this.parentProperty!.name + "." + propName);
  }

}

function clearOriginalValues(target: any) {
  let aspect = target.entityAspect || target.complexAspect;
  aspect.originalValues = {};
  let stype = target.entityType || target.complexType;
  stype.complexProperties.forEach(function (cp: any) {
    let cos = target.getProperty(cp.name);
    if (cp.isScalar) {
      clearOriginalValues(cos);
    } else {
      observableArray.acceptChanges(cos);
      cos.forEach(clearOriginalValues);
    }
  });
}



/**
An {@link EntityAspect} that knows its entity's class, `T`: the type a generated entity class gives
its `entityAspect`, as `EntityAspectOf<this>`. It is the same object; only the types are narrower -
property names are checked, and values have their properties' types:
```ts
order.freight = 99;
order.entityAspect.originalValues.freight;          // number | undefined
order.entityAspect.getOriginalValue('freight');     // number
order.entityAspect.getOriginalValue('frieght');     // error: not a property of Order
order.entityAspect.getChangedProperties();          // ('freight' | 'shipCity' | …)[]
```
An interface extending the class, rather than a type parameter on it, so that it is an
`EntityAspect` by declaration: a generic `EntityAspect<T>` whose members read `keyof T` would not be
one, and every generated class needs its aspect to be. And typed only by `T`'s own data properties:
to reach through a navigation property, the types would have to ask whether the entity at the other
end is an `Entity` - which asks about its aspect, and so about this one.
*/
export interface EntityAspectOf<T> extends EntityAspect {
  /** {@link EntityAspect.originalValues}, keyed and typed by `T`'s data properties. */
  originalValues: OriginalValues<T>;
  /** {@link EntityAspect.getOriginalValue}, with the name checked against `T` and the value typed. */
  getOriginalValue<K extends DataKeys<T>>(propertyName: K): T[K];
  /** {@link EntityAspect.getOriginalValue} for a path into a complex property, such as `'location.city'`: untyped. */
  getOriginalValue(propertyPath: `${string}.${string}`): any;
  /** {@link EntityAspect.getChangedProperties}: `T`'s data properties, and paths into its complex ones. */
  getChangedProperties(): (DataKeys<T> | `${string}.${string}`)[];
}

/**
A {@link ComplexAspect} that knows its complex object's class, `T`: the type a generated complex type
class gives its `complexAspect`, as `ComplexAspectOf<this>`. See {@link EntityAspectOf}.
*/
export interface ComplexAspectOf<T> extends ComplexAspect {
  /** {@link ComplexAspect.originalValues}, keyed and typed by `T`'s data properties. */
  originalValues: OriginalValues<T>;
}
