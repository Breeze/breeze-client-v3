import { BreezeEvent, EntityKey, EntityManager, EntityState, MergeStrategy, MetadataStore, QueryOptions } from '../../src/breeze';
import { Param } from '../../src/core/assert-param';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(() => {
  TestFns.initSampleMetadataStore();
});

// assertParam is what turns a mistake at Breeze's front door into a sentence instead of a
// TypeError six frames down. It is worth keeping - most applications are still JavaScript at
// runtime whatever they are written in, and a config object typo has no other way of being
// caught. It is not worth paying for on a path that runs per entity: the chain allocates a
// Param, a contexts array, a context object per check and a closure to run them, and
// `createEntity` was doing that fifteen times.
//
// Twelve of the fifteen were Breeze checking arguments it had produced itself - two events per
// entity, four `getKey` calls, an EntityKey, and `attachEntity` re-checking the enums
// `createEntity` had validated a moment earlier. Those check inline now, or come in through an
// internal entry point. The three that remain are the ones checking what the caller passed.
//
// So this file pins both halves: that the front door still rejects what it always rejected, with
// the same words, and that the inside is not paying for it.

/** Counts assertParam chains run by `fn` - every chain ends in exactly one `check()`. */
function countAssertParamChains(fn: () => void) {
  const original = Param.prototype.check;
  let chains = 0;
  Param.prototype.check = function (this: Param, defaultValue?: any) {
    chains++;
    return original.call(this, defaultValue);
  };
  try {
    fn();
  } finally {
    Param.prototype.check = original;
  }
  return chains;
}

function newManager() {
  return TestFns.newEntityManager();
}

describe('Parameter validation', () => {

  describe('is not paid for on per-entity paths', () => {

    test('createEntity runs only the checks on its own arguments', () => {
      const em = newManager();
      em.createEntity('Customer', { companyName: 'warm' });      // first-use costs are not the point

      const chains = countAssertParamChains(() => {
        em.createEntity('Customer', { companyName: 'Acme' });
      });

      // entityType, entityState, mergeStrategy - what the caller passed, and nothing else. It was
      // 15: the two BreezeEvents on the aspect (2 each), four getKey calls, one EntityKey, and
      // attachEntity re-checking the same entityState and mergeStrategy.
      expect(chains).toBeLessThanOrEqual(5);
    });

    test('constructing an entity aspect and its key runs none', () => {
      const em = newManager();
      const cust: any = em.createEntity('Customer', { companyName: 'Acme' });

      expect(countAssertParamChains(() => { cust.entityAspect.getKey(true); })).toEqual(0);
      expect(countAssertParamChains(() => { new BreezeEvent('someEvent', cust); })).toEqual(0);
      expect(countAssertParamChains(() => {
        new EntityKey(em.metadataStore.getAsEntityType('Customer')!, 'ALFKI');
      })).toEqual(0);
    });
  });

  // Each of these used to come from an assertParam chain and now comes from an inline check or
  // an unchanged one. The wording is what an application sees, so it is pinned verbatim.
  describe('still rejects what it always rejected', () => {

    test.each([
      ['new BreezeEvent with an empty name', () => new BreezeEvent('', {}),
        "The 'eventName' parameter  must be a nonEmpty string"],
      ['new BreezeEvent with no name', () => new BreezeEvent(undefined as any, {}),
        "The 'eventName' parameter  must be a nonEmpty string"],
      ['new BreezeEvent with no publisher', () => new BreezeEvent('x', null as any),
        "The 'publisher' parameter  must be a 'object'"],
      ['new BreezeEvent with a non-object publisher', () => new BreezeEvent('x', 5 as any),
        "The 'publisher' parameter  must be a 'object'"],
      ['new EntityKey with no type', () => new EntityKey(null as any, 1),
        "The 'entityType' parameter  must be an instance of 'EntityType'"],
      ['new EntityKey with a plain object', () => new EntityKey({} as any, 1),
        "The 'entityType' parameter  must be an instance of 'EntityType'"],
    ])('%s', (_name, fn, message) => {
      expect(fn).toThrow(message);
    });

    test('getKey rejects a non-boolean forceRefresh', () => {
      const cust: any = newManager().createEntity('Customer', { companyName: 'Acme' });
      expect(() => cust.entityAspect.getKey('nope'))
        .toThrow("The 'forceRefresh' parameter  is optional or it must be a 'boolean'");
      // null and undefined are both "not supplied", as they were
      expect(cust.entityAspect.getKey(undefined)).toBeTruthy();
      expect(cust.entityAspect.getKey(null)).toBeTruthy();
    });

    test('attachEntity rejects bad arguments, in the order it always did', () => {
      const em = newManager();
      const type = em.metadataStore.getAsEntityType('Customer')!;
      const detached = () => {
        const c: any = type.createEntity();
        c.setProperty('customerID', crypto.randomUUID());
        return c;
      };

      expect(() => em.attachEntity(null as any)).toThrow("The 'entity' parameter  is required");
      expect(() => em.attachEntity(detached(), 'bogus' as any))
        .toThrow("The 'entityState' parameter  is optional or it must be an instance of the 'EntityState' enumeration");
      expect(() => em.attachEntity(detached(), EntityState.Added, 'bogus' as any))
        .toThrow("The 'mergeStrategy' parameter  is optional or it must be an instance of the 'MergeStrategy' enumeration");

      // An object that is not an entity is reported as unregistered, ahead of the enum checks -
      // the order matters because attachEntity was split into a public and an internal half.
      expect(() => em.attachEntity({} as any, 'bogus' as any)).toThrow(/_\$typeName/);
    });

    test('createEntity rejects bad arguments', () => {
      const em = newManager();
      expect(() => em.createEntity('Nope')).toThrow(/Unable to locate a 'Type' by the name: 'Nope'/);
      expect(() => em.createEntity('Customer', {}, 'bogus' as any))
        .toThrow("The 'entityState' parameter  is optional or it must be an instance of the 'EntityState' enumeration");
      expect(() => em.createEntity('Customer', {}, EntityState.Added, 'bogus' as any))
        .toThrow("The 'mergeStrategy' parameter  is optional or it must be an instance of the 'MergeStrategy' enumeration");
    });
  });

  // assertConfig is a different animal from assertParam: applyAll also assigns the values and
  // their defaults onto the instance, so it is doing the construction, not only checking it.
  // The check it does that nothing else can is catching a misspelled option - silently ignoring
  // one gives you a manager that does not do what you asked and no clue why.
  describe('assertConfig catches a misspelled option', () => {

    test.each([
      ['EntityManager', () => new EntityManager({ servicName: '/breeze/Foo' } as any)],
      ['QueryOptions', () => new QueryOptions({ fetchStrategy_: null } as any)],
      ['MetadataStore', () => new MetadataStore({ namingConventions: null } as any)],
    ])('%s rejects an unknown property', (_name, fn) => {
      expect(fn).toThrow(/Unknown property/);
    });

    test('and names the type it was configuring', () => {
      expect(() => new EntityManager({ servicName: 'x' } as any))
        .toThrow(/Error configuring an instance of 'EntityManager'/);
    });

    test('a correctly spelled option still works', () => {
      const em = new EntityManager({ serviceName: '/breeze/Foo' });
      expect(em.serviceName).toEqual('/breeze/Foo/');   // DataService adds the trailing slash
    });
  });
});
