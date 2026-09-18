import { EntityManager, MetadataStore, config, configureBreeze } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { hasChanges$, propertyChanged$ } from '../../src/rxjs/breeze-rxjs';
import { collect, isReleased, pathsTo } from '../support/retention';
import metadata from '../support/NorthwindIBMetadata.json';

// Does Breeze let go of an entity once it is out of the cache?
//
// Every case here keeps the EntityManager and its MetadataStore alive, because that is the
// situation that matters: an application holds one manager for a long time, and a store for
// longer still, while entities come and go. An entity that outlives its detach is held by
// something in the library.
//
// Run with `npm run test:retention` - these need --expose-gc.

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  dataService: DataServiceWebApiAdapter,
});

/** Kept out of the test bodies so no local variable in a test frame can pin an entity. */
const held: any[] = [];

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const em = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
  held.push(em);             // the manager survives the test; the entities should not
  return em;
}

afterEach(() => { held.length = 0; });

/** One store for the cases that drop a whole manager - the store is what outlives them. */
const sharedStore = new MetadataStore();
sharedStore.importMetadata(metadata);

describe('an entity out of the cache is released', () => {

  test('after detachEntity', async () => {
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 1 });
      em.detachEntity(order);
      return new WeakRef(order);
    })).toBe(true);
  });

  test('after em.clear()', async () => {
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 2 });
      em.clear();
      return new WeakRef(order);
    })).toBe(true);
  });

  test('after rejectChanges on an Added entity', async () => {
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 3 });
      order.entityAspect.rejectChanges();          // Added -> Detached
      return new WeakRef(order);
    })).toBe(true);
  });

  test('when it had a live propertyChanged subscription', async () => {
    // The subscriber is on the entity's own aspect, so detaching should release both.
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 4 });
      order.entityAspect.propertyChanged.subscribe(() => { });
      em.detachEntity(order);
      return new WeakRef(order);
    })).toBe(true);
  });

  test('when a validator ran over it and passed', async () => {
    // A Validator lives on a DataProperty, which lives on the EntityType, which lives on the
    // MetadataStore - the longest-lived object in the system, and shared between managers. A
    // validator that keeps its last subject pins that entity, and the whole graph it reaches,
    // for the life of the application.
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 5, shipName: 'fine' });
      order.entityAspect.validateEntity();
      em.detachEntity(order);
      return new WeakRef(order);
    })).toBe(true);
  });

  test('when its foreign keys pointed at parents that were never attached', async () => {
    // A child whose parent is not in the cache is parked in _unattachedChildrenMap, under one
    // entry per absent parent, so that it can be linked if that parent arrives later. Detaching
    // the child has to take it back out: em.clear() replaces the whole map, but detachEntity
    // is the path an application uses to drop one row.
    expect(await isReleased(() => {
      const em = newManager();
      // OrderDetail's orderID and productID both name parents that do not exist here
      const detail = em.createEntity('OrderDetail', { orderID: 900, productID: 12345 });
      em.detachEntity(detail);
      return new WeakRef(detail);
    })).toBe(true);
  });

  test('and the map entry itself goes, not just the child', async () => {
    const em = newManager();
    const detail = em.createEntity('OrderDetail', { orderID: 901, productID: 12346 });
    expect((em as any)._unattachedChildrenMap.map.size).toBeGreaterThan(0);
    em.detachEntity(detail);
    // an empty tuple list left behind would grow without bound over a long session
    expect((em as any)._unattachedChildrenMap.map.size).toBe(0);
  });

  test('once a later entity has failed the same validator', async () => {
    // A FAILED validation deliberately keeps its context: getMessage() reads it, and that is a
    // documented API. So the last entity to fail each validator stays reachable. That is bounded
    // - one per validator, replaced by the next failure - and this asserts the bound, so a
    // change that accumulated contexts instead would be caught here.
    expect(await isReleased(() => {
      const em = newManager();
      const first = em.createEntity('Order', { orderID: 20, shipName: 'x'.repeat(200) });
      expect(first.entityAspect.validateEntity()).toBe(false);   // maxLength 40: it really fails
      em.detachEntity(first);
      const ref = new WeakRef(first);

      const second = em.createEntity('Order', { orderID: 21, shipName: 'y'.repeat(200) });
      second.entityAspect.validateEntity();
      held.push(second);
      return ref;
    })).toBe(true);
  });

  test('along with the whole manager, when another shares its MetadataStore', async () => {
    // Managers routinely share a store - createEmptyCopy, a per-screen manager, a sandbox for
    // an edit that may be cancelled. Dropping one must release it and its entities even while a
    // sibling keeps the store, and everything on the store, alive.
    expect(await isReleased(() => {
      const ms = new MetadataStore();
      ms.importMetadata(metadata);
      const doomed = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
      doomed.createEntity('Order', { orderID: 30 });

      const survivor = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
      survivor.createEntity('Order', { orderID: 31 });     // drives the shared store's validators
      held.push(survivor, ms);

      return new WeakRef(doomed);
    })).toBe(true);
  });

  test('when an rxjs subscription to it was unsubscribed but is still held', async () => {
    // The usual component: `this.sub = propertyChanged$(order).subscribe(...)`, then
    // `this.sub.unsubscribe()` on destroy - with the component, and so `this.sub`, still alive.
    // An unsubscribed Subscription must not keep a path to the entity it was watching.
    expect(await isReleased(() => {
      const em = newManager();
      const order = em.createEntity('Order', { orderID: 40 });
      const sub = propertyChanged$(order).subscribe(() => { });
      sub.unsubscribe();
      held.push(sub);                       // the component keeps its field
      em.detachEntity(order);
      return new WeakRef(order);
    })).toBe(true);
  });

  test('along with its manager, when an hasChanges$ subscription was unsubscribed', async () => {
    expect(await isReleased(() => {
      const em = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: sharedStore });
      em.createEntity('Order', { orderID: 41 });
      const sub = hasChanges$(em).subscribe(() => { });
      sub.unsubscribe();
      held.push(sub);
      return new WeakRef(em);
    })).toBe(true);
  });

  // The control: without one of these the suite would pass even if nothing were ever released.
  test('but an ATTACHED entity is not released', async () => {
    expect(await isReleased(() => {
      const em = newManager();
      return new WeakRef(em.createEntity('Order', { orderID: 6 }));
    })).toBe(false);
  });
});

describe('nothing grows without bound', () => {

  test('a group reuses its slots rather than growing', () => {
    // detachEntity nulls the slot and puts the index on a free list, so churning entities
    // through a manager must not leave the array at its high-water mark for ever.
    const em = newManager();
    for (let i = 0; i < 2000; i++) {
      em.detachEntity(em.createEntity('Order', { orderID: i + 1 }));
    }
    const group = (em as any)._entityGroupMap.get('Order:#Foo');
    expect(group._entities.length).toBe(1);
    expect(group._indexMap.size).toBe(0);
  });

  test('a shared MetadataStore does not grow as managers come and go', () => {
    // The store outlives every manager and is shared between them, so anything accumulated on a
    // type is accumulated for the life of the application.
    const ms = new MetadataStore();
    ms.importMetadata(metadata);
    const before = ms.getEntityTypes().length;
    const shipName = ms.getAsEntityType('Order').getDataProperty('shipName')!;
    const validatorCount = shipName.validators.length;

    for (let i = 0; i < 100; i++) {
      const em = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
      em.createEntity('Order', { orderID: i + 1 });
    }

    expect(ms.getEntityTypes().length).toBe(before);
    expect(shipName.validators.length).toBe(validatorCount);
  });

  // The KeyGenerator records the temporary key values its manager's entities hold, so that an
  // imported entity carrying one cannot collide with a live entity. It used to record every value it
  // ever handed out and never forget one, so the set grew with every entity a manager created. Now a
  // value is released when its entity is saved and given the server's key, or detached, so the set
  // is bounded by the entities in the cache that have temporary keys. clear() still replaces the
  // generator outright.
  test('the key generator records only the temp ids that attached entities hold, and clear() resets it', () => {
    const em = newManager();
    const remembered = () => {
      let n = 0;
      for (const entry of (em.keyGenerator as any)._tempIdMap.values()) n += entry.keyMap.size;
      return n;
    };

    for (let i = 0; i < 500; i++) {
      em.detachEntity(em.createEntity('Order', {}));   // Identity key: each gets a temp id, then lets it go
    }
    expect(remembered()).toBe(0);

    for (let i = 0; i < 500; i++) {
      em.createEntity('Order', {});                     // these keep theirs
    }
    expect(remembered()).toBe(500);

    em.clear();
    expect(remembered()).toBe(0);
  });

  test('re-initializing an adapter does not add a subscriber each time', () => {
    // _initializeAdapterInstanceCore subscribes the instance to interfaceInitialized so it can
    // recompose. The instance is cached, so a second call hands back the SAME adapter - and used
    // to subscribe it again. That both grew the subscriber list without bound and called
    // checkForRecomposition once per duplicate on every later initialization.
    const event = (config as any).interfaceInitialized;
    const before = (event._subscribers || []).length;
    for (let i = 0; i < 50; i++) {
      config.initializeAdapterInstance('dataService', 'webApi', true);
    }
    expect((event._subscribers || []).length).toBe(before);
  });
});

describe('diagnosis', () => {

  test('pathsTo names what holds an attached entity', () => {
    const em = newManager();
    const order = em.createEntity('Order', { orderID: 7 });
    const paths = pathsTo(em, order).join('\n');
    expect(paths).toMatch(/_entityGroupMap.*_entities/);
  });
});
