import { EntityManager, EntityState, NavigationProperty } from '../../src/breeze';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(async () => {
  TestFns.initSampleMetadataStore();
});

// Emptying a relation array wholesale - which is what detaching or deleting the parent does.
//
// The obvious way to write it is to let each child take itself out: null the child's reference to
// its parent, and the interceptor splices that child out of the collection. That is quadratic. A
// splice from the front of an array shifts everything after it, so draining n children moves n²/2
// elements, and it publishes one arrayChanged per child for what is one change to the collection.
// Detaching a customer with 16,000 orders took 239ms and fired 16,000 events; it now takes 7ms and
// fires one.
//
// These tests pin the work done rather than the time taken - a timing assertion in CI is a flake
// waiting to happen, and the counts are what the fix actually changed:
//
//   - the collection's own splice is never called while it is being emptied (that was the n² term)
//   - exactly one arrayChanged is published, carrying every child
//
// and, separately, that the children still end up in the state they were always left in.

// Breeze does not generate keys for every type here, and two Unchanged entities that both take
// the default key value collide, so fill the key in.
let nextKeyValue = 1000;

function newParentWithChildren(count: number) {
  const em: EntityManager = TestFns.newEntityManager();
  const parent = em.createEntity('Customer', { companyName: 'Acme' }, EntityState.Unchanged);
  const np: NavigationProperty = parent.entityType.navigationProperties
    .find((n: NavigationProperty) => !n.isScalar && n.inverse != null && n.inverse.isScalar)!;
  expect(np).toBeTruthy();   // the sample metadata is expected to have a 1-n with an inverse

  const collection = parent.getProperty(np.name);
  const children: any[] = [];
  for (let i = 0; i < count; i++) {
    const initialValues: any = {};
    (np.entityType as any).keyProperties.forEach((kp: any) => {
      if (kp.dataType && kp.dataType.isNumeric) initialValues[kp.name] = nextKeyValue++;
    });
    const child = em.createEntity((np.entityType as any).shortName, initialValues, EntityState.Unchanged);
    collection.push(child);
    children.push(child);
  }
  return { em, parent, np, collection, children, inverseName: np.inverse!.name };
}

/** Count calls to the array's own (intercepted) splice, which is the quadratic step. */
function countSplices(arr: any) {
  const real = arr.splice;
  const calls = { n: 0 };
  arr.splice = function (...args: any[]) { calls.n++; return real.apply(this, args); };
  return calls;
}

describe("emptying a relation array wholesale", () => {

  test("detaching the parent does not splice the collection child by child", () => {
    const { em, parent, collection } = newParentWithChildren(25);
    const splices = countSplices(collection);

    em.detachEntity(parent);

    expect(collection.length).toBe(0);
    // Before: one splice per child, each shifting the rest. This is the O(n^2) term.
    expect(splices.n).toBe(0);
  });

  test("and publishes one arrayChanged carrying every child", () => {
    const { em, parent, collection, children } = newParentWithChildren(25);

    let events = 0;
    const removed: any[] = [];
    collection.arrayChanged.subscribe((args: any) => {
      events++;
      if (args.removed) removed.push(...args.removed);
    });

    em.detachEntity(parent);

    expect(events).toBe(1);
    expect(removed).toHaveLength(25);
    expect(new Set(removed)).toEqual(new Set(children));
  });

  test("every child is unparented, and stays attached", () => {
    const { em, parent, children, inverseName } = newParentWithChildren(10);

    em.detachEntity(parent);

    for (const child of children) {
      expect(child.getProperty(inverseName)).toBeNull();
      expect(child.entityAspect.entityState.isDetached()).toBe(false);
    }
    expect(parent.entityAspect.entityState.isDetached()).toBe(true);
  });

  test("deleting the parent empties it the same way", () => {
    const { parent, collection, children, inverseName } = newParentWithChildren(10);

    let events = 0;
    collection.arrayChanged.subscribe(() => events++);

    parent.entityAspect.setDeleted();

    expect(collection.length).toBe(0);
    expect(events).toBe(1);
    expect(children.every(c => c.getProperty(inverseName) === null)).toBe(true);
    expect(parent.entityAspect.entityState.isDeleted()).toBe(true);
  });

  test("an empty collection publishes nothing", () => {
    const { em, parent, collection } = newParentWithChildren(0);
    let events = 0;
    collection.arrayChanged.subscribe(() => events++);

    em.detachEntity(parent);

    expect(events).toBe(0);
  });

  test("removing one child still goes through splice, and reports just that one", () => {
    // The bulk path must not swallow the ordinary one: a single removal is still a splice and
    // still its own event.
    const { collection, children, inverseName } = newParentWithChildren(5);
    const splices = countSplices(collection);
    const removed: any[] = [];
    collection.arrayChanged.subscribe((args: any) => { if (args.removed) removed.push(...args.removed); });

    children[2].setProperty(inverseName, null);

    expect(splices.n).toBe(1);
    expect(collection.length).toBe(4);
    expect(removed).toEqual([children[2]]);
  });

});

describe("pop and shift on an empty relation array", () => {

  // They used to hand the kind `[undefined]`, which a relation array dereferenced - so popping an
  // empty collection threw a TypeError where a plain array returns undefined.

  test("return undefined rather than throwing", () => {
    const { collection } = newParentWithChildren(0);

    expect(() => collection.pop()).not.toThrow();
    expect(collection.pop()).toBeUndefined();
    expect(collection.shift()).toBeUndefined();
  });

  test("publish nothing, because nothing was removed", () => {
    const { collection } = newParentWithChildren(0);
    let events = 0;
    collection.arrayChanged.subscribe(() => events++);

    collection.pop();
    collection.shift();

    expect(events).toBe(0);
  });

  test("still work when there is something to remove", () => {
    const { collection, children, inverseName } = newParentWithChildren(3);
    const removed: any[] = [];
    collection.arrayChanged.subscribe((args: any) => { if (args.removed) removed.push(...args.removed); });

    expect(collection.pop()).toBe(children[2]);
    expect(collection.shift()).toBe(children[0]);

    expect(collection.length).toBe(1);
    expect(collection[0]).toBe(children[1]);
    expect(removed).toEqual([children[2], children[0]]);
    // and the removed children were unparented, which is the whole point of intercepting
    expect(children[2].getProperty(inverseName)).toBeNull();
    expect(children[0].getProperty(inverseName)).toBeNull();
  });

});
