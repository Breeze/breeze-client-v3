import { config as rxConfig, map, merge, shareReplay, Subject, take, takeUntil } from 'rxjs';
import { EntityAction, EntityManager, EntityQuery, MetadataStore, config, configureBreeze } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import {
  entityChanged$, fromBreezeEvent, hasChanges$, propertyChanged$, validationErrorsChanged$,
} from '../../src/rxjs/breeze-rxjs';
import metadata from '../support/NorthwindIBMetadata.json';

// breeze-client/rxjs: Breeze events as observables. Opt-in - see "optional dependencies" in
// side-effects.spec.ts for the checks that keep rxjs out of everyone else's install.
//
// Most of what can go wrong here is teardown. A Breeze event holds its subscribers, so an
// observable that fails to remove its subscription keeps its callback - and everything the callback
// reaches - for as long as the manager lives. Several of these count the event's subscribers
// directly for that reason, and test/retention/ checks the same thing against the collector.

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  dataService: DataServiceWebApiAdapter,
});

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  return new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
}

const subscriberCount = (event: any) => (event._subscribers || []).length;

describe('fromBreezeEvent', () => {

  test('emits what the event publishes', () => {
    const em = newManager();
    const seen: string[] = [];
    const sub = fromBreezeEvent(em.entityChanged).subscribe(e => seen.push(e.entityAction.name));

    em.createEntity('Order', { orderID: 1 });

    expect(seen).toContain('Attach');
    sub.unsubscribe();
  });

  test('is lazy: nothing is subscribed until the observable is', () => {
    const em = newManager();
    const obs = fromBreezeEvent(em.entityChanged);
    expect(subscriberCount(em.entityChanged)).toBe(0);

    const sub = obs.subscribe();
    expect(subscriberCount(em.entityChanged)).toBe(1);
    sub.unsubscribe();
  });

  test('unsubscribing removes the Breeze subscription', () => {
    const em = newManager();
    const sub = fromBreezeEvent(em.entityChanged).subscribe();
    sub.unsubscribe();

    expect(subscriberCount(em.entityChanged)).toBe(0);
  });

  test('so does an operator that completes it, such as takeUntil', () => {
    const em = newManager();
    const destroyed = new Subject<void>();      // the usual Angular component teardown
    fromBreezeEvent(em.entityChanged).pipe(takeUntil(destroyed)).subscribe();
    expect(subscriberCount(em.entityChanged)).toBe(1);

    destroyed.next();

    expect(subscriberCount(em.entityChanged)).toBe(0);
  });

  test('each subscription is its own, and tears down on its own', () => {
    const em = newManager();
    const obs = fromBreezeEvent(em.entityChanged);
    const a = obs.subscribe();
    const b = obs.subscribe();
    expect(subscriberCount(em.entityChanged)).toBe(2);

    a.unsubscribe();
    expect(subscriberCount(em.entityChanged)).toBe(1);
    b.unsubscribe();
    expect(subscriberCount(em.entityChanged)).toBe(0);
  });

  test("a subscriber that throws does not stop Breeze's other subscribers", async () => {
    // rxjs catches an error thrown from a next handler and reports it on a later tick, so it never
    // reaches Breeze's publish loop. Captured here so the run does not count it as unhandled - and
    // the handler stays in place until that later tick, or the report arrives after it is gone.
    const reported: unknown[] = [];
    const previous = rxConfig.onUnhandledError;
    rxConfig.onUnhandledError = err => reported.push(err);
    try {
      const em = newManager();
      let plainSubscriberHeard = 0;
      const sub = fromBreezeEvent(em.entityChanged).subscribe(() => { throw new Error('subscriber bug'); });
      em.entityChanged.subscribe(() => { plainSubscriberHeard++; });

      em.createEntity('Order', { orderID: 2 });

      expect(plainSubscriberHeard).toBeGreaterThan(0);
      sub.unsubscribe();
      await new Promise(resolve => setTimeout(resolve, 0));
      // it went to rxjs, which is where an application's error handling for observables lives
      expect(reported.length).toBeGreaterThan(0);
      expect((reported[0] as Error).message).toBe('subscriber bug');
    } finally {
      rxConfig.onUnhandledError = previous;
    }
  });
});

describe('entityChanged$', () => {

  test('reports entities added and changed, and filters like any observable', () => {
    const em = newManager();
    const actions: EntityAction[] = [];
    const sub = entityChanged$(em).subscribe(e => actions.push(e.entityAction));

    const order = em.createEntity('Order', { orderID: 3 }) as any;
    order.shipName = 'Changed';

    expect(actions).toContain(EntityAction.Attach);
    expect(actions).toContain(EntityAction.PropertyChange);
    sub.unsubscribe();
  });
});

describe('entityChanged$ during a query', () => {

  // The guide's "Timing" section says this, and it is easy to assume the opposite: the events are
  // not held back until the query is done. A subscriber reading the cache mid-query sees a partial
  // result, which is why the guide suggests filtering on isLoading.
  test('emits per entity as it is merged, with isLoading set and later rows not yet cached', async () => {
    const em = newManager();
    const previousFetch = config.fetch;
    config.fetch = async () => new Response(JSON.stringify([
      { $type: 'Order:#Foo', OrderID: 101 }, { $type: 'Order:#Foo', OrderID: 102 }, { $type: 'Order:#Foo', OrderID: 103 },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
      const seen: { action: string, cached: number, loading: boolean }[] = [];
      const sub = entityChanged$(em).subscribe(e =>
        seen.push({ action: e.entityAction.name, cached: em.getEntities().length, loading: em.isLoading }));

      await em.executeQuery(EntityQuery.from('Orders').toType('Order'));

      expect(seen).toEqual([
        { action: 'AttachOnQuery', cached: 1, loading: true },
        { action: 'AttachOnQuery', cached: 2, loading: true },
        { action: 'AttachOnQuery', cached: 3, loading: true },
      ]);
      sub.unsubscribe();
    } finally {
      config.fetch = previousFetch;
    }
  });
});

describe('hasChanges$', () => {

  test('starts with the current value, then reports each change', () => {
    const em = newManager();
    const seen: boolean[] = [];
    const sub = hasChanges$(em).subscribe(v => seen.push(v));
    expect(seen).toEqual([false]);                  // synchronously, before anything happens

    const order = em.createEntity('Order', { orderID: 4 });
    expect(seen).toEqual([false, true]);

    order.entityAspect.rejectChanges();
    expect(seen).toEqual([false, true, false]);
    sub.unsubscribe();
  });

  test('reads the current value when subscribed to, not when created', () => {
    const em = newManager();
    const obs = hasChanges$(em);                    // created while clean
    em.createEntity('Order', { orderID: 5 });       // then dirtied

    const seen: boolean[] = [];
    obs.subscribe(v => seen.push(v)).unsubscribe();

    expect(seen).toEqual([true]);
  });

  test('take(1) leaves no Breeze subscription behind', () => {
    // take(1) unsubscribes during the very first emission - before hasChanges$ has handed its
    // teardown back to rxjs. rxjs runs a teardown returned to an already-closed subscriber at
    // once; if it did not, this would leak one subscription every time a component asked "is
    // the manager dirty right now?".
    const em = newManager();
    let value: boolean | undefined;
    hasChanges$(em).pipe(take(1)).subscribe(v => { value = v; });

    expect(value).toBe(false);
    expect(subscriberCount(em.hasChangesChanged)).toBe(0);
  });

  test('a change made in reaction to the first value is not lost', () => {
    // The Breeze subscription is made before the current value is emitted, so a subscriber that
    // responds to that value by changing the manager still hears about the change it made.
    const em = newManager();
    const seen: boolean[] = [];
    let reacted = false;
    const sub = hasChanges$(em).subscribe(v => {
      seen.push(v);
      if (!reacted) { reacted = true; em.createEntity('Order', { orderID: 6 }); }
    });

    expect(seen).toEqual([false, true]);
    sub.unsubscribe();
  });
});

describe('validationErrorsChanged$', () => {

  test('reports errors added to an entity', () => {
    const em = newManager();
    const added: number[] = [];
    const sub = validationErrorsChanged$(em).subscribe(e => added.push(e.added.length));

    const order = em.createEntity('Order', { orderID: 7 }) as any;
    order.shipName = 'x'.repeat(200);               // maxLength 40
    order.entityAspect.validateEntity();

    expect(added.some(n => n > 0)).toBe(true);
    sub.unsubscribe();
  });
});

// The recipes in docs/guide/rxjs.md, run as written, so the page cannot drift from what works.
describe('the guide recipes', () => {

  /** As in the guide: every validation error on a changed entity, kept current. */
  function allValidationErrors$(em: EntityManager) {
    return merge(validationErrorsChanged$(em), hasChanges$(em)).pipe(
      map(() => em.getChanges().flatMap(e => e.entityAspect.getValidationErrors())),
    );
  }

  test('allValidationErrors$ starts with the current list, tracks it, and clears on reject', () => {
    const em = newManager();
    const counts: number[] = [];
    const sub = allValidationErrors$(em).subscribe(errors => counts.push(errors.length));
    expect(counts).toEqual([0]);                    // something to render from the start

    const order = em.createEntity('Order', { orderID: 10 }) as any;
    order.shipName = 'x'.repeat(200);               // maxLength 40
    order.entityAspect.validateEntity();
    expect(counts[counts.length - 1]).toBeGreaterThan(0);

    em.rejectChanges();                             // nothing changed, so nothing to report
    expect(counts[counts.length - 1]).toBe(0);
    sub.unsubscribe();
    expect(subscriberCount(em.validationErrorsChanged)).toBe(0);
    expect(subscriberCount(em.hasChangesChanged)).toBe(0);
  });

  test('shareReplay with refCount shares one Breeze subscription and lets it go', () => {
    const em = newManager();
    const shared = hasChanges$(em).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    const a = shared.subscribe();
    const b = shared.subscribe();
    expect(subscriberCount(em.hasChangesChanged)).toBe(1);   // one, however many listen

    a.unsubscribe();
    b.unsubscribe();
    expect(subscriberCount(em.hasChangesChanged)).toBe(0);
  });

  test('but shareReplay(1) keeps it for good - the trap the guide warns about', () => {
    const em = newManager();
    const shared = hasChanges$(em).pipe(shareReplay(1));
    shared.subscribe().unsubscribe();

    expect(subscriberCount(em.hasChangesChanged)).toBe(1);   // nobody listening, still subscribed
  });
});

describe('propertyChanged$', () => {

  test("reports one entity's property changes, and only that entity's", () => {
    const em = newManager();
    const order = em.createEntity('Order', { orderID: 8 }) as any;
    const other = em.createEntity('Order', { orderID: 9 }) as any;
    const names: string[] = [];
    const sub = propertyChanged$(order).subscribe(e => names.push(e.propertyName!));

    order.shipName = 'Mine';
    other.shipName = 'Not mine';

    expect(names).toEqual(['shipName']);
    sub.unsubscribe();
    expect(subscriberCount(order.entityAspect.propertyChanged)).toBe(0);
  });
});
