import { EntityManager, EntityState, NavigationProperty, EntityQuery, config } from '../../src/breeze';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(async () => {
  TestFns.initSampleMetadataStore();
});

// A collection navigation - order.orderDetails - is an empty relation array until something reads
// it. An array plus its arrayChanged event is ~390 bytes, and most collections on most entities
// are never touched, so they are built on first read instead of at creation.
//
// The risk is not in the accessor, it is in the code that used to rely on the array always being
// there: attaching an entity, deleting one, merging a query result. These tests pin down both
// that the laziness holds and that nothing downstream noticed.

/** What is actually stored, without creating the array the way a read would. */
function stored(entity: any, propName: string) {
  return entity._backingStore[propName];
}

function collectionNav(entity: any): NavigationProperty {
  const np = entity.entityType.navigationProperties.find((n: NavigationProperty) => !n.isScalar);
  expect(np).toBeTruthy();
  return np!;
}

let nextKey = 5000;
function createChild(em: EntityManager, np: NavigationProperty) {
  const entityType: any = np.entityType;
  const initialValues: any = {};
  entityType.keyProperties.forEach((kp: any) => {
    if (kp.dataType && kp.dataType.isNumeric) initialValues[kp.name] = nextKey++;
  });
  return em.createEntity(entityType.shortName, initialValues);
}

describe("lazy relation arrays - the array is not created until it is read", () => {

  test("a new detached entity has no array for its collection navigation", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const orderType = em.metadataStore.getAsEntityType("Order");
    const order = orderType.createEntity();

    expect(stored(order, collectionNav(order).name)).toBeUndefined();
  });

  test("attaching an entity does not create its collections", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");          // createEntity attaches

    expect(order.entityAspect.entityState).toBe(EntityState.Added);
    expect(stored(order, collectionNav(order).name)).toBeUndefined();
  });

  test("reading it creates it, and every later read is the same array", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const np = collectionNav(order).name;

    const first = order.getProperty(np);
    expect(Array.isArray(first)).toBe(true);
    expect(first.length).toBe(0);
    expect(stored(order, np)).toBe(first);
    expect(order.getProperty(np)).toBe(first);
    expect((order as any)[np]).toBe(first);           // and through the accessor directly
  });

  test("deleting an entity does not create collections it never read", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order", { orderID: 4242 }, EntityState.Unchanged);
    const np = collectionNav(order).name;
    expect(stored(order, np)).toBeUndefined();

    order.entityAspect.setDeleted();

    expect(order.entityAspect.entityState).toBe(EntityState.Deleted);
    expect(stored(order, np)).toBeUndefined();
  });

  test("detaching an entity does not create them either", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order", { orderID: 4243 }, EntityState.Unchanged);
    const np = collectionNav(order).name;

    order.entityAspect.setDetached();

    expect(order.entityAspect.entityState).toBe(EntityState.Detached);
    expect(stored(order, np)).toBeUndefined();
  });

  test("exporting does not create them", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order", { orderID: 4244 }, EntityState.Unchanged);
    const np = collectionNav(order).name;

    const exported = em.exportEntities(undefined, { includeMetadata: false });

    expect(typeof exported).toBe("string");
    expect(stored(order, np)).toBeUndefined();
  });

});

describe("lazy relation arrays - the collection still behaves", () => {

  test("a child pushed into the collection is fixed up on both ends", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const np = collectionNav(order);
    const child = createChild(em, np);

    const collection = order.getProperty(np.name);
    collection.push(child);

    expect(collection.length).toBe(1);
    expect(collection[0]).toBe(child);
    if (np.inverse) {
      expect(child.getProperty(np.inverse.name)).toBe(order);   // the inverse was set
    }
  });

  test("arrayChanged fires once the collection exists", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const np = collectionNav(order);
    const collection = order.getProperty(np.name);

    const added: any[] = [];
    collection.arrayChanged.subscribe((args: any) => { if (args.added) added.push(...args.added); });

    const child = createChild(em, np);
    collection.push(child);

    expect(added).toEqual([child]);
  });

  test("setting a collection navigation still throws", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const np = collectionNav(order);

    expect(() => order.setProperty(np.name, [])).toThrow(/readonly/);
  });

  test("attaching a parent cascades to children already in its collection", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const orderType = em.metadataStore.getAsEntityType("Order");
    const order = orderType.createEntity();                 // detached
    const np = collectionNav(order);

    const child = createChild(em, np);                      // attached to em
    child.entityAspect.setDetached();

    order.getProperty(np.name).push(child);                 // collection created here
    em.addEntity(order);

    expect(order.entityAspect.entityState).toBe(EntityState.Added);
    expect(child.entityAspect.entityState).toBe(EntityState.Added);   // cascaded
    expect(child.entityAspect.entityManager).toBe(em);
  });

  test("deleting a parent clears a collection that was read", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order", { orderID: 4245 }, EntityState.Unchanged);
    const np = collectionNav(order);
    const child = createChild(em, np);

    const collection = order.getProperty(np.name);
    collection.push(child);
    expect(collection.length).toBe(1);

    order.entityAspect.setDeleted();

    expect(collection.length).toBe(0);
    if (np.inverse) {
      expect(child.getProperty(np.inverse.name)).toBeNull();
    }
  });

});

describe("lazy relation arrays - query materialization", () => {

  test("a query fills the collections its payload carries, and leaves the rest alone", async () => {
    // an explicit serviceName: TestFns.defaultServiceName is only set in the server envs
    const em = new EntityManager({ serviceName: "http://example.invalid/breeze/Northwind", metadataStore: TestFns.sampleMetadataStore });
    const orderType = em.metadataStore.getAsEntityType("Order");
    const np = collectionNav(orderType.createEntity());

    // one Order with its child collection populated, expressed the way the server sends it
    const childType: any = np.entityType;
    const childKey = childType.keyProperties.map((kp: any) => kp.name);
    const child: any = { $type: childType.name };
    childKey.forEach((k: string, i: number) => { child[k] = 900 + i; });

    const row: any = { $type: orderType.name, orderID: 7001 };
    row[np.nameOnServer] = [child];

    const saved = config.fetch;
    config.fetch = async () => new Response(JSON.stringify([row]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
    try {
      const qr = await em.executeQuery(EntityQuery.from(orderType.defaultResourceName!));
      expect(qr.results.length).toBe(1);
      const order = qr.results[0];
      // the payload carried this collection, so it exists and is populated
      expect(stored(order, np.name)).toBeDefined();
      expect(order.getProperty(np.name).length).toBe(1);
    } finally {
      config.fetch = saved;
    }
  });

});
