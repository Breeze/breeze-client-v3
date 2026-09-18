// breeze-react-stores.ts - the part of the React integration in docs/guide/react.md that has no
// React in it. Each function returns what useSyncExternalStore takes: a subscribe function and a
// getSnapshot function. The hooks are one-line wrappers around these.
//
// The guide includes this file as it is, and test/unit/react-stores.spec.ts runs it, so the code a
// reader copies is the code that was tested.
import { EntityAction, EntityState, entityTypeForCtor } from 'breeze-client';
import type { Entity, EntityManager } from 'breeze-client';

/** What useSyncExternalStore takes. */
export interface Store<T> {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): T;
}

/** Whether `em` has unsaved changes. */
export function hasChangesStore(em: EntityManager): Store<boolean> {
  return {
    subscribe(onChange) {
      const key = em.hasChangesChanged.subscribe(() => onChange());
      return () => { em.hasChangesChanged.unsubscribe(key); };
    },
    // Cheap enough to call on every render: Breeze tracks the answer rather than scanning.
    getSnapshot: () => em.hasChanges(),
  };
}

/**
 * One entity. The snapshot is a number that changes whenever anything about the entity does - a
 * property, its state, a merge from a query or a save, or its validation errors - so a component
 * re-renders then and not otherwise. The entity must be attached; a detached one has no manager to
 * report its changes.
 *
 * Validation errors are listened to separately because they can change with no property changing:
 * a failed validateEntity() before a save is the usual case, and a form has to show those errors.
 */
export function entityStore(entity: Entity): Store<number> {
  let version = 0;
  return {
    subscribe(onChange) {
      const em = entity.entityAspect.entityManager;
      if (!em) return () => {};
      const changed = () => { version++; onChange(); };
      const entityKey = em.entityChanged.subscribe(e => { if (e.entity === entity) changed(); });
      const errorsKey = em.validationErrorsChanged.subscribe(e => { if (e.entity === entity) changed(); });
      return () => {
        em.entityChanged.unsubscribe(entityKey);
        em.validationErrorsChanged.unsubscribe(errorsKey);
      };
    },
    getSnapshot: () => version,
  };
}

/**
 * The cached entities of one type - not deleted ones, unless `states` says otherwise.
 *
 * The array keeps its identity until the list's membership changes. That is a requirement, not an
 * optimization: getSnapshot must return the same value when nothing has changed, and
 * em.getEntities() builds a new array on every call, which React would take for a change on every
 * render and loop on. A property edit does not change which entities are in the list, so it does
 * not rebuild it; the rows show their own values with useEntity.
 */
export function entitiesStore<T extends Entity>(
  em: EntityManager,
  type: new () => T,
  states: EntityState[] = [EntityState.Added, EntityState.Modified, EntityState.Unchanged],
): Store<T[]> {
  const typeName = entityTypeForCtor(type).name;
  let cached: T[] | undefined;
  return {
    subscribe(onChange) {
      const key = em.entityChanged.subscribe(e => {
        if (e.entityAction === EntityAction.PropertyChange) return;
        if (e.entity && e.entity.entityType.name !== typeName) return;   // no entity: em.clear()
        cached = undefined;
        onChange();
      });
      return () => { em.entityChanged.unsubscribe(key); };
    },
    getSnapshot: () => (cached ??= em.getEntities(type, states)),
  };
}
