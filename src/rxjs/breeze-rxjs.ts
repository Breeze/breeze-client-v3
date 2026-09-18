import { Observable } from 'rxjs';
import type { BreezeEvent } from '../core/event.js';
import type { Entity, PropertyChangedEventArgs } from '../entity/entity-aspect.js';
import type {
  EntityChangedEventArgs, EntityManager, ValidationErrorsChangedEventArgs,
} from '../manager/entity-manager.js';

// Breeze events as RxJS observables.
//
// Optional, and opt-in: import it from its own subpath, and install `rxjs` yourself.
//
//     import { entityChanged$, hasChanges$ } from 'breeze-client/rxjs';
//
// Nothing in `breeze-client` itself imports this module or rxjs, so an application that does not
// use it pays nothing - not a byte of bundle and not a transitive install. `rxjs` is an optional
// peer dependency for that reason: a plain peer dependency would be installed automatically by
// npm 7 and later, for everyone.
//
// Every observable here is cold and lazy. Creating one does nothing; subscribing to it subscribes
// to the Breeze event, and unsubscribing - directly, or through an operator such as `take`,
// `takeUntil` or Angular's `async` pipe - removes that subscription again. That matters: a Breeze
// event holds its subscribers, so a subscription that is never removed keeps its callback, and
// everything the callback reaches, for as long as the event's owner lives.
//
// Only the `Observable` constructor is used, no operators, so any rxjs from 7.0 on will do.

/**
 * Any {@link BreezeEvent} as an Observable: each value the event publishes is emitted, for as long
 * as the subscription lasts.
 *
 * The other functions in this module are this, applied to a particular event. Use it directly for
 * the ones they do not cover - `metadataStore.metadataFetched`, say.
 *
 * ```ts
 * fromBreezeEvent(em.metadataStore.metadataFetched).subscribe(args => console.log(args.metadata));
 * ```
 *
 * An error thrown by a subscriber does not reach Breeze: rxjs reports it on its own, and the
 * event's other subscribers still hear about the change.
 *
 * @param event - the event to observe
 * @returns an Observable that subscribes to `event` when it is subscribed to, and unsubscribes when
 * it is torn down
 */
export function fromBreezeEvent<T>(event: BreezeEvent<T>): Observable<T> {
  return new Observable<T>(subscriber => {
    const unsubKey = event.subscribe(data => subscriber.next(data));
    return () => { event.unsubscribe(unsubKey); };
  });
}

/**
 * {@link EntityManager.entityChanged} as an Observable: every entity added, attached, detached,
 * changed, saved or rejected in `em`.
 *
 * Filter for what you want with rxjs:
 *
 * ```ts
 * entityChanged$(em).pipe(
 *   filter(e => e.entityAction === EntityAction.PropertyChange),
 * ).subscribe(e => markDirty(e.entity));
 * ```
 */
export function entityChanged$(em: EntityManager): Observable<EntityChangedEventArgs> {
  return fromBreezeEvent(em.entityChanged);
}

/**
 * Whether `em` has unsaved changes, as an Observable that starts with the current value.
 *
 * {@link EntityManager.hasChangesChanged} only fires on a change, so on its own it cannot tell a
 * late subscriber what the answer is *now*. This emits `em.hasChanges()` as soon as it is
 * subscribed to, then each change after that, and never the same value twice in a row. Bind a Save
 * button to it and the button is right from the first render.
 *
 * ```ts
 * hasChanges$(em).subscribe(dirty => saveButton.disabled = !dirty);
 * ```
 *
 * The current value is read when you subscribe, not when you call this function.
 */
export function hasChanges$(em: EntityManager): Observable<boolean> {
  return new Observable<boolean>(subscriber => {
    let last = em.hasChanges();
    // Subscribe to Breeze before emitting the current value. A subscriber that reacts to that
    // first value by changing the manager - creating an entity, say - then has the change reported
    // to it rather than lost in the gap between reading the value and listening for the next one.
    const unsubKey = em.hasChangesChanged.subscribe(args => {
      if (args.hasChanges !== last) {
        last = args.hasChanges;
        subscriber.next(last);
      }
    });
    subscriber.next(last);
    // If the subscriber took only the first value, it has already unsubscribed by now, before this
    // teardown was handed back. rxjs runs a teardown returned to a closed subscriber at once, so
    // the Breeze subscription is still removed.
    return () => { em.hasChangesChanged.unsubscribe(unsubKey); };
  });
}

/**
 * {@link EntityManager.validationErrorsChanged} as an Observable: validation errors added to or
 * removed from any entity in `em`.
 *
 * Each value says what changed, not the complete set. For "every validation error in the manager
 * right now", see the recipe in the guide, which builds one from this.
 */
export function validationErrorsChanged$(em: EntityManager): Observable<ValidationErrorsChangedEventArgs> {
  return fromBreezeEvent(em.validationErrorsChanged);
}

/**
 * {@link EntityAspect.propertyChanged} as an Observable: each property of one entity that changes.
 *
 * ```ts
 * propertyChanged$(order).pipe(
 *   filter(e => e.propertyName === 'shipCountry'),
 * ).subscribe(() => recalculateTax(order));
 * ```
 *
 * A live subscription keeps `entity` reachable, as any subscription to it would. Unsubscribe when
 * the screen showing it goes away.
 */
export function propertyChanged$(entity: Entity): Observable<PropertyChangedEventArgs> {
  return fromBreezeEvent(entity.entityAspect.propertyChanged);
}
