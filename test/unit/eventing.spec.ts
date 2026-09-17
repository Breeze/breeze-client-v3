import { BreezeEvent, EntityManager, EntityState, MetadataStore } from '../../src/breeze';
import { Customer, Order, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

const newEm = () => new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });

let nextId = 1;

describe("entityChanged is published for every entity that changes state", () => {

  // _notifyStateChange defers recomputing hasChanges to the end of a load, because that means
  // scanning the whole cache. It used to defer the per-entity event along with it - into a
  // closure built once (`||`), which therefore captured the FIRST entity's arguments and
  // published for that one alone. Every entity after the first reported nothing.
  //
  // It only happened when the manager already had changes, because otherwise the branch is
  // skipped: the same operation published n events or 1 depending on unrelated state.
  //
  // test/integration/event-consistency.spec.ts is the same thing through a real query, which is
  // what sets isLoading in production.

  function threeReturningToUnchanged() {
    const em = newEm();

    // Something keeps the manager dirty throughout, so the deferral branch is taken.
    const keepDirty = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    keepDirty.setProperty('freight', 99);
    expect(em.hasChanges()).toBe(true);

    const entities = [0, 1, 2].map(() => {
      const o = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
      o.setProperty('freight', 1);
      return o;
    });
    expect(entities.every(o => o.entityAspect.entityState === EntityState.Modified)).toBe(true);

    const stateChanges: any[] = [];
    em.entityChanged.subscribe(ev => {
      if (ev.entityAction.name === 'EntityStateChange') stateChanges.push(ev.entity);
    });
    return { em, entities, stateChanges };
  }

  test("while the manager is loading and already has changes", () => {
    const { em, entities, stateChanges } = threeReturningToUnchanged();

    em.isLoading = true;
    entities.forEach(o => o.entityAspect.setUnchanged());
    em.isLoading = false;

    expect(stateChanges).toHaveLength(3);
    for (const o of entities) expect(stateChanges).toContain(o);
  });

  test("and when it is not loading - the two must agree", () => {
    const { entities, stateChanges } = threeReturningToUnchanged();

    entities.forEach(o => o.entityAspect.setUnchanged());

    expect(stateChanges).toHaveLength(3);
    for (const o of entities) expect(stateChanges).toContain(o);
  });

  test("hasChangesChanged still fires once, after the load", () => {
    const em = newEm();
    const only = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    only.setProperty('freight', 99);

    const hasChanges: boolean[] = [];
    em.hasChangesChanged.subscribe(a => hasChanges.push(a.hasChanges));

    em.isLoading = true;
    only.entityAspect.setUnchanged();
    em.isLoading = false;
    // Recomputing is what gets deferred, so nothing is reported until the load ends.
    expect(hasChanges).toEqual([]);
    expect(em._hasChangesAction).toBeDefined();

    em._hasChangesAction!();
    expect(hasChanges).toEqual([false]);
    expect(em.hasChanges()).toBe(false);
  });

});

describe("a subscriber that throws", () => {

  let reported: Error[];
  let original: ((e: Error) => void) | null;

  beforeEach(() => {
    reported = [];
    original = BreezeEvent.unhandledErrorCallback;
    BreezeEvent.unhandledErrorCallback = e => reported.push(e);
  });
  afterEach(() => { BreezeEvent.unhandledErrorCallback = original; });

  test("is reported rather than discarded", () => {
    // It used to vanish: no throw, no log, nothing. The symptom was an event that looked as
    // though it had never been published.
    const em = newEm();
    const order = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    order.entityAspect.propertyChanged.subscribe(() => { throw new Error('handler is broken'); });

    order.setProperty('freight', 1);

    expect(reported).toHaveLength(1);
    expect(reported[0].message).toBe('handler is broken');
    // and it says which event it came from
    expect((reported[0] as any).context).toContain('propertyChanged');
  });

  test("does not stop the other subscribers", () => {
    const em = newEm();
    const order = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    const ran: string[] = [];

    order.entityAspect.propertyChanged.subscribe(() => ran.push('first'));
    order.entityAspect.propertyChanged.subscribe(() => { throw new Error('boom'); });
    order.entityAspect.propertyChanged.subscribe(() => ran.push('third'));

    order.setProperty('freight', 1);

    expect(ran).toEqual(['first', 'third']);
    expect(reported).toHaveLength(1);
  });

  test("goes to an explicit error callback in preference to the default", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'A' }, EntityState.Unchanged);
    const mine: Error[] = [];

    cust.entityAspect.propertyChanged.subscribe(() => { throw new Error('boom'); });
    cust.entityAspect.propertyChanged.publish({ entity: cust, propertyName: 'x' } as any,
      false, e => mine.push(e));

    expect(mine).toHaveLength(1);
    expect(reported).toHaveLength(0);
  });

  test("can be silenced again by setting the callback to null", () => {
    BreezeEvent.unhandledErrorCallback = null;
    const em = newEm();
    const order = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    order.entityAspect.propertyChanged.subscribe(() => { throw new Error('boom'); });

    expect(() => order.setProperty('freight', 1)).not.toThrow();
    expect(reported).toHaveLength(0);
  });

});

describe("what an event instance weighs", () => {

  // Two events are built for every entity in the cache and most are never subscribed to, so
  // anything sitting on the instance is multiplied by the size of the cache. This keeps the
  // instance to the two fields that genuinely differ per event.

  test("carries only its name and its publisher", () => {
    const em = newEm();
    const order = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);

    expect(Object.getOwnPropertyNames(order.entityAspect.propertyChanged).sort())
      .toEqual(['name', 'publisher']);
  });

  test("shares its methods, including unsubscribe", () => {
    const em = newEm();
    const a = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    const b = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);

    // unsubscribe was written as a field holding a function, so every event had its own copy.
    expect(a.entityAspect.propertyChanged.unsubscribe)
      .toBe(b.entityAspect.propertyChanged.unsubscribe);
    expect(a.entityAspect.propertyChanged.unsubscribe)
      .toBe(a.entityAspect.validationErrorsChanged.unsubscribe);
  });

  test("and still subscribes and unsubscribes", () => {
    const em = newEm();
    const order = em.createEntity(Order, { orderID: nextId++ }, EntityState.Unchanged);
    const seen: any[] = [];

    const key = order.entityAspect.propertyChanged.subscribe(a => seen.push(a.propertyName));
    order.setProperty('freight', 1);
    expect(seen).toEqual(['freight']);

    expect(order.entityAspect.propertyChanged.unsubscribe(key)).toBe(true);
    order.setProperty('freight', 2);
    expect(seen).toEqual(['freight']);

    expect(order.entityAspect.propertyChanged.unsubscribe(key)).toBe(false);   // already gone
  });

});
