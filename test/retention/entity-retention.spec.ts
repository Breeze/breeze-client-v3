import { EntityManager, MetadataStore, configureBreeze } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
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

  // The control: without one of these the suite would pass even if nothing were ever released.
  test('but an ATTACHED entity is not released', async () => {
    expect(await isReleased(() => {
      const em = newManager();
      return new WeakRef(em.createEntity('Order', { orderID: 6 }));
    })).toBe(false);
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
