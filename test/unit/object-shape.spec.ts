import { EntityManager, EntityState } from '../../src/breeze';
import { TestFns } from '../test-fns';

TestFns.initNonServerEnv();

beforeAll(() => {
  TestFns.initSampleMetadataStore();
});

// `delete obj.prop` is not the same as `obj.prop = undefined`. The value ends up the same, but
// the delete changes the object's shape, and an engine deoptimises property access for the object
// it happened to - and, measurably, for every object of that class created afterwards:
//
//   an EntityAspect created before the first delete   8.0 ms / 10M reads
//   the EntityAspect deleted from                    31.3 ms
//   an EntityAspect created after the delete         22.8 ms
//
// In an application the first entity attaches early, so in practice every aspect in the process
// pays it. The EntityManager was worse: `core.using` restores a property it found `undefined` by
// deleting it, and `isLoading` was never initialised, so three deletes per createEntity left the
// manager reading its own `metadataStore` and `queryOptions` about 20x slower - for its lifetime.
//
// None of that is visible in behaviour, which is why it needs a test of its own. These assert the
// shape rather than the timing, for the usual reason: a timing assertion in CI is a flake waiting
// to happen, and the shape is what the fix actually changed.

const ownProp = (o: any, name: string) => Object.prototype.hasOwnProperty.call(o, name);

function newCustomer(em: EntityManager, id = crypto.randomUUID()) {
  return em.createEntity('Customer', { customerID: id, companyName: 'Acme' }) as any;
}

describe('Hot paths do not delete properties', () => {

  describe('EntityManager', () => {

    test('its scoped flags start as real values, so core.using restores rather than deletes', () => {
      const em = TestFns.newEntityManager();
      expect(ownProp(em, 'isLoading')).toBe(true);
      expect(em.isLoading).toBe(false);
      expect(ownProp(em, 'isRejectingChanges')).toBe(true);
      expect(em.isRejectingChanges).toBe(false);
    });

    test('and still has them after the operations that scope them', () => {
      const em = TestFns.newEntityManager();
      const cust = newCustomer(em);
      cust.setProperty('companyName', 'Changed');
      cust.entityAspect.rejectChanges();
      em.importEntities(em.exportEntities(undefined, { includeMetadata: false }));

      expect(ownProp(em, 'isLoading')).toBe(true);
      expect(ownProp(em, 'isRejectingChanges')).toBe(true);
      // and the flags read false outside the scope, as they always did
      expect(em.isLoading).toBe(false);
      expect(em.isRejectingChanges).toBe(false);
    });
  });

  describe('EntityAspect', () => {

    test('attaching an entity does not delete _initialized', () => {
      const em = TestFns.newEntityManager();
      const aspect = newCustomer(em).entityAspect as any;
      expect(ownProp(aspect, '_initialized')).toBe(true);
      // the flag itself is still cleared - attachEntity uses it to run the initializer once
      expect(aspect._initialized).toBeFalsy();
    });

    test('clearing a temporary key does not delete hasTempKey', () => {
      const em = TestFns.newEntityManager();
      // Order has a store-generated key, so creating one gives it a temporary key
      const order: any = em.createEntity('Order', { shipName: 'Acme' });
      expect(order.entityAspect.hasTempKey).toBe(true);
      expect(ownProp(order.entityAspect, 'hasTempKey')).toBe(true);

      order.entityAspect.setUnchanged();
      expect(order.entityAspect.hasTempKey).toBeFalsy();
      expect(ownProp(order.entityAspect, 'hasTempKey')).toBe(true);
    });

    test('every aspect keeps the same shape, however it was made', () => {
      const em = TestFns.newEntityManager();
      const type = em.metadataStore.getAsEntityType('Customer')!;

      const beforeAnyAttach: any = type.createEntity({ customerID: crypto.randomUUID() });
      const attached = newCustomer(em);
      const afterAnAttach: any = type.createEntity({ customerID: crypto.randomUUID() });
      em.attachEntity(afterAnAttach, EntityState.Unchanged);

      const keys = (e: any) => Object.keys(e.entityAspect).sort().join(',');
      expect(keys(attached)).toEqual(keys(beforeAnyAttach));
      expect(keys(afterAnAttach)).toEqual(keys(beforeAnyAttach));
    });
  });
});
