import { EntityManager, EntityState, NavigationProperty, makeComplexArray, makePrimitiveArray } from '../../src/breeze';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(async () => {
  TestFns.initSampleMetadataStore();
});

// The observable arrays are plain arrays with their mutators replaced. Two things make that
// work, and both are easy to break by accident, so they are pinned here:
//
//  1. the object stays a real array with Array.prototype - otherwise every built-in method
//     falls off its fast path;
//  2. the number of own properties stays small - past roughly a dozen, V8 moves an array to
//     dictionary properties and indexed reads get about 90x slower, which is what 2.x did by
//     copying sixteen functions onto every array.
//
// See the comment at the top of src/entity/observable-array.ts.

const MAX_OWN_PROPS = 12;

function newOrder() {
  const em: EntityManager = TestFns.newEntityManager();
  return em.createEntity("Order");
}

function firstCollectionNav(entity: any): NavigationProperty {
  const np = entity.entityType.navigationProperties.find((n: NavigationProperty) => !n.isScalar);
  expect(np).toBeTruthy();   // the sample metadata is expected to have one
  return np!;
}

// Some related types (OrderDetail) have a composite key that breeze will not generate, so fill
// the key in rather than assuming the type has an auto-generated one.
let nextKeyValue = 1000;
function createChild(em: EntityManager, np: NavigationProperty) {
  const entityType: any = np.entityType;
  const initialValues: any = {};
  entityType.keyProperties.forEach((kp: any) => {
    if (kp.dataType && kp.dataType.isNumeric) initialValues[kp.name] = nextKeyValue++;
  });
  return em.createEntity(entityType.shortName, initialValues);
}

describe("observable arrays - shape", () => {

  test("a relation array is a real array", () => {
    const order = newOrder();
    const arr = order.getProperty(firstCollectionNav(order).name);

    expect(Array.isArray(arr)).toBe(true);
    expect(arr instanceof Array).toBe(true);
    expect(Object.getPrototypeOf(arr)).toBe(Array.prototype);
  });

  test("a relation array keeps its own-property count under the dictionary-mode cliff", () => {
    const order = newOrder();
    const arr = order.getProperty(firstCollectionNav(order).name);

    const own = Object.keys(arr);   // no elements yet, so these are all named properties
    expect(own.length).toBeLessThanOrEqual(MAX_OWN_PROPS);
    // the mutators have to be here to be intercepted; everything else lives behind _obs
    expect(own).toEqual(expect.arrayContaining(['push', 'pop', 'shift', 'unshift', 'splice', '_obs']));
  });

  test("complex and primitive arrays keep their own-property count under it too", () => {
    const order = newOrder();
    const dp = order.entityType.dataProperties[0];

    for (const arr of [makeComplexArray([], order, dp), makePrimitiveArray([], order, dp)]) {
      expect(Array.isArray(arr)).toBe(true);
      expect(Object.getPrototypeOf(arr)).toBe(Array.prototype);
      expect(Object.keys(arr).length).toBeLessThanOrEqual(MAX_OWN_PROPS);
    }
  });

  test("the per-kind behaviour is shared, not copied onto each array", () => {
    const order1 = newOrder();
    const order2 = newOrder();
    const np = firstCollectionNav(order1).name;
    const arr1 = order1.getProperty(np);
    const arr2 = order2.getProperty(np);

    expect(arr1).not.toBe(arr2);
    expect(arr1._obs.ops).toBe(arr2._obs.ops);   // one ops object per kind
    expect(arr1.push).toBe(arr2.push);           // one function object per mutator
  });

});

describe("observable arrays - behaviour", () => {

  test("push notifies, and the array behaves like an array afterwards", () => {
    const order = newOrder();
    const np = firstCollectionNav(order);
    const arr = order.getProperty(np.name);
    const em = order.entityAspect.entityManager!;

    const added: any[] = [];
    arr.arrayChanged.subscribe((args: any) => { if (args.added) added.push(...args.added); });

    const child = createChild(em, np);
    arr.push(child);

    expect(arr.length).toBe(1);
    expect(arr[0]).toBe(child);
    expect(added).toEqual([child]);
    expect([...arr]).toEqual([child]);
    expect(arr.map((c: any) => c).constructor).toBe(Array);
    expect(arr.filter(() => true).constructor).toBe(Array);
  });

  test("pushing the same entity twice does not duplicate it", () => {
    const order = newOrder();
    const np = firstCollectionNav(order);
    const arr = order.getProperty(np.name);
    const em = order.entityAspect.entityManager!;

    const child = createChild(em, np);
    arr.push(child);
    arr.push(child);

    expect(arr.length).toBe(1);
  });

  test("removing notifies with what was removed", () => {
    const order = newOrder();
    const np = firstCollectionNav(order);
    const arr = order.getProperty(np.name);
    const em = order.entityAspect.entityManager!;

    const child = createChild(em, np);
    arr.push(child);

    const removed: any[] = [];
    arr.arrayChanged.subscribe((args: any) => { if (args.removed) removed.push(...args.removed); });

    const popped = arr.pop();
    expect(popped).toBe(child);
    expect(arr.length).toBe(0);
    expect(removed).toEqual([child]);
  });

  test("a primitive array marks its entity modified, and rejectChanges puts it back", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const dp = order.entityType.dataProperties[0];
    const arr = makePrimitiveArray([], order, dp);

    order.entityAspect.setUnchanged();
    expect(order.entityAspect.entityState).toBe(EntityState.Unchanged);

    arr.push(1, 2, 3);
    expect(order.entityAspect.entityState).toBe(EntityState.Modified);
    expect([...arr]).toEqual([1, 2, 3]);
  });

  test("JSON.stringify produces a plain JSON array", () => {
    const em: EntityManager = TestFns.newEntityManager();
    const order = em.createEntity("Order");
    const arr = makePrimitiveArray([], order, order.entityType.dataProperties[0]);
    arr.push(1, 2, 3);

    expect(JSON.stringify(arr)).toBe("[1,2,3]");
    expect(JSON.stringify({ nums: arr })).toBe('{"nums":[1,2,3]}');
  });

});

// While a query or import is loading, an array's changes are collected into one arrayChanged. The
// changes were combined only under keys the first had, so a batch that began with an addition lost
// every removal after it, and the reverse.
describe("observable arrays - one event per load", () => {

  /** Runs fn the way a query or import runs its merge: with the manager's events held back. */
  function asOneLoad(em: EntityManager, fn: () => void) {
    const held: (() => void)[] = [];
    (em as any)._pendingPubs = held;
    try {
      fn();
    } finally {
      (em as any)._pendingPubs = undefined;
    }
    held.forEach(publish => publish());
  }

  function setUp() {
    const order = newOrder();
    const np = firstCollectionNav(order);
    const arr = order.getProperty(np.name);
    const em = order.entityAspect.entityManager!;
    const events: any[] = [];
    arr.arrayChanged.subscribe((args: any) => events.push({ added: args.added, removed: args.removed }));
    return { em, np, arr, events };
  }

  test("a removal after an addition is kept", () => {
    const { em, np, arr, events } = setUp();
    const existing = createChild(em, np);
    arr.push(existing);
    events.length = 0;

    const newcomer = createChild(em, np);
    asOneLoad(em, () => {
      arr.push(newcomer);
      arr.splice(arr.indexOf(existing), 1);
    });

    expect(events).toEqual([{ added: [newcomer], removed: [existing] }]);
  });

  test("an addition after a removal is kept", () => {
    const { em, np, arr, events } = setUp();
    const existing = createChild(em, np);
    arr.push(existing);
    events.length = 0;

    const newcomer = createChild(em, np);
    asOneLoad(em, () => {
      arr.splice(arr.indexOf(existing), 1);
      arr.push(newcomer);
    });

    expect(events).toEqual([{ added: [newcomer], removed: [existing] }]);
  });

  test("an item added and removed again in one load is in neither list, and alone raises nothing", () => {
    const { em, np, arr, events } = setUp();
    const a = createChild(em, np), b = createChild(em, np);
    asOneLoad(em, () => {
      arr.push(a);
      arr.push(b);
      arr.splice(arr.indexOf(b), 1);
    });
    expect(events).toEqual([{ added: [a], removed: undefined }]);

    events.length = 0;
    const c = createChild(em, np);
    asOneLoad(em, () => {
      arr.push(c);
      arr.splice(arr.indexOf(c), 1);
    });
    expect(events).toEqual([]);
  });

});
