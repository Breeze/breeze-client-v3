import { EntityManager, EntityState } from '../../src/breeze';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(() => {
  TestFns.initSampleMetadataStore();
});

// The EntityManager's cache answers three questions constantly: is this key in the cache, does
// this manager have changes, and which entities are related to this one. All three used to be
// answered by scanning, and because each of them runs once per entity in the surrounding loop,
// each was quadratic in the size of the cache.
//
// As in relation-array-clear.spec.ts, these pin the *work done* rather than the time taken - a
// timing assertion in CI is a flake waiting to happen. The counters below are the thing the fixes
// actually changed.

/** How many entities are not Unchanged, worked out the slow way: by looking at every one. */
function scanForChanges(em: EntityManager) {
  return em.getEntities().filter(e => !e.entityAspect.entityState.isUnchanged());
}

/** `hasChanges` and the per-group sets must agree with a scan, whatever has been done to the cache. */
function expectChangeTrackingInStep(em: EntityManager, why: string) {
  const scanned = scanForChanges(em);
  expect(`${why}: hasChanges=${em.hasChanges()}`).toEqual(`${why}: hasChanges=${scanned.length > 0}`);

  const tracked: any[] = [];
  (em as any)._entityGroupMap.forEach((group: any) => {
    group._changedEntities.forEach((e: any) => tracked.push(e));
    // nothing in the set may have left the group, or be Unchanged
    group._changedEntities.forEach((e: any) => {
      expect(`${why}: ${e.entityAspect.entityState.name}`).not.toEqual(`${why}: Unchanged`);
      expect(group._entities).toContain(e);
    });
  });
  expect(`${why}: tracked ${tracked.length}`).toEqual(`${why}: tracked ${scanned.length}`);
  scanned.forEach(e => expect(tracked).toContain(e));
}

function newCustomers(em: EntityManager, count: number, entityState = EntityState.Unchanged) {
  const custs: any[] = [];
  for (let i = 0; i < count; i++) {
    custs.push(em.createEntity('Customer',
      { customerID: `00000000-0000-0000-0000-${i.toString(16).padStart(12, '0')}`, companyName: 'C' + i },
      entityState));
  }
  return custs;
}

/**
 * Counts how many entity slots the manager's groups are read out of while `fn` runs.
 *
 * `EntityGroup._entities` is where the cache actually keeps entities, so anything that walks the
 * cache shows up here and nothing that does an indexed lookup does. That is the distinction the
 * change-tracking set exists to make: `hasChanges` used to re-derive its answer by walking the
 * group, once per state change, which is what made a loop over n changed entities quadratic.
 *
 * Counting reads of `entityState` instead would miss half of it - detaching leaves a null in the
 * slot, so the walk skips those entities without ever reading a state and is quadratic anyway.
 */
function countGroupEntityReads(em: EntityManager, fn: () => void) {
  const groups: any[] = Array.from((em as any)._entityGroupMap.values());
  const originals = groups.map(g => g._entities);
  let reads = 0;
  groups.forEach((group, i) => {
    group._entities = new Proxy(originals[i], {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && prop >= '0' && prop <= '9') reads++;
        return Reflect.get(target, prop, receiver);
      },
    });
  });
  try {
    fn();
  } finally {
    groups.forEach((group, i) => { group._entities = originals[i]; });
  }
  return reads;
}

describe('EntityManager cache lookups', () => {

  describe('hasChanges is tracked, not recomputed', () => {

    test('agrees with a scan of the cache through every kind of state change', () => {
      const em = TestFns.newEntityManager();
      expectChangeTrackingInStep(em, 'empty');

      const custs = newCustomers(em, 6, EntityState.Unchanged);
      expectChangeTrackingInStep(em, 'attached Unchanged');

      custs[0].setProperty('companyName', 'changed');
      expectChangeTrackingInStep(em, 'modified one');

      custs[1].entityAspect.setDeleted();
      expectChangeTrackingInStep(em, 'deleted one');

      const added = em.createEntity('Customer', { companyName: 'New' });
      expectChangeTrackingInStep(em, 'added one');

      custs[0].entityAspect.rejectChanges();
      expectChangeTrackingInStep(em, 'rejected the modified one');

      custs[1].entityAspect.rejectChanges();
      expectChangeTrackingInStep(em, 'rejected the deleted one');

      custs[2].setProperty('companyName', 'changed');
      custs[2].entityAspect.acceptChanges();
      expectChangeTrackingInStep(em, 'accepted a modified one');

      em.detachEntity(added);
      expectChangeTrackingInStep(em, 'detached the added one');
      expect(em.hasChanges()).toBe(false);

      custs[3].entityAspect.setModified();
      em.rejectChanges();
      expectChangeTrackingInStep(em, 'rejected everything');
      expect(em.hasChanges()).toBe(false);
    });

    test('survives export and import into another manager', () => {
      const em = TestFns.newEntityManager();
      const custs = newCustomers(em, 4, EntityState.Unchanged);
      custs[0].setProperty('companyName', 'changed');
      em.createEntity('Customer', { companyName: 'New' });

      const em2 = TestFns.newEntityManager();
      em2.importEntities(em.exportEntities(undefined, { includeMetadata: false }));
      expectChangeTrackingInStep(em2, 'after import');
      expect(em2.hasChanges()).toBe(true);
      expect(em2.getChanges().length).toEqual(2);
    });

    test('a re-attached entity is tracked by its new group', () => {
      const em = TestFns.newEntityManager();
      const cust = newCustomers(em, 1, EntityState.Unchanged)[0];
      cust.setProperty('companyName', 'changed');
      em.detachEntity(cust);
      expectChangeTrackingInStep(em, 'detached');
      expect(em.hasChanges()).toBe(false);

      em.attachEntity(cust, EntityState.Modified);
      expectChangeTrackingInStep(em, 're-attached Modified');
      expect(em.hasChanges()).toBe(true);
    });

    // The three operations that turn a changed entity clean. Each one used to ask the manager to
    // work out afresh whether anything was still dirty, and that answer cost a walk of the whole
    // cache - so running one per entity over n entities read n²/2 entity states. 20,000
    // acceptChanges took 2.2 s.
    test.each([
      ['detachEntity', (em: EntityManager, e: any) => em.detachEntity(e)],
      ['acceptChanges', (_em: EntityManager, e: any) => e.entityAspect.acceptChanges()],
      ['rejectChanges', (_em: EntityManager, e: any) => e.entityAspect.rejectChanges()],
    ])('%s over n changed entities stays linear', (_name, op) => {
      const n = 400;
      const em = TestFns.newEntityManager();
      const custs = newCustomers(em, n, EntityState.Unchanged);
      custs.forEach(c => c.setProperty('companyName', 'changed'));
      expect(em.hasChanges()).toBe(true);

      const reads = countGroupEntityReads(em, () => custs.forEach(c => op(em, c)));

      // A walk of the group per entity is n²/2 = 80,000 slot reads before anything else. Each
      // operation legitimately touches a few slots, so allow 50 per entity: far above what any
      // of the three needs, and far below a quadratic.
      expect(reads).toBeLessThan(n * 50);
      expect(em.hasChanges()).toBe(false);
    });
  });

  describe('the key index is keyed by string', () => {

    // `_indexMap` used to be an object literal, and so inherited Object.prototype. An entity
    // whose key was the string "__proto__" wrote through the inherited setter, storing nothing:
    // it was attached, but getEntityByKey could never find it again and detaching it threw.
    test('an entity keyed "__proto__" can be found, detached and re-attached', () => {
      const em = TestFns.newEntityManager();
      const cust = em.createEntity('Customer', { customerID: '__proto__', companyName: 'Proto' });

      expect(em.getEntityByKey('Customer', '__proto__')).toBe(cust);
      expect(em.getEntities().length).toEqual(1);

      em.detachEntity(cust);
      expect(em.getEntityByKey('Customer', '__proto__')).toBeNull();

      em.attachEntity(cust, EntityState.Unchanged);
      expect(em.getEntityByKey('Customer', '__proto__')).toBe(cust);
    });

    test.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
      'an entity keyed "%s" does not collide with Object.prototype', (key) => {
        const em = TestFns.newEntityManager();
        expect(em.getEntityByKey('Customer', key)).toBeNull();   // miss, before anything is added
        const cust = em.createEntity('Customer', { customerID: key, companyName: key });
        expect(em.getEntityByKey('Customer', key)).toBe(cust);
      });
  });
});
