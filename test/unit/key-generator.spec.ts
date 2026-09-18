import { EntityManager, KeyGenerator } from '../../src/breeze';
import type { Entity, EntityKey, EntityType } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { TestFns } from '../test-fns';

ModelLibraryBackingStoreAdapter.register();
TestFns.initNonServerEnv();

// The generator records every temporary key value it hands out, so that an import never reuses
// one an entity still holds. It never forgot a value, so the record grew for the manager's
// lifetime, and isTempKey/getTempKeys went on reporting keys long since saved or detached.

function newOrder(em: EntityManager) {
  const order = em.metadataStore.getAsEntityType('Order').createEntity() as Entity;
  em.addEntity(order);   // Order's key is store-generated, so this gives it a temporary one
  return order;
}

const keyOf = (e: Entity): EntityKey => e.entityAspect.getKey();

describe("KeyGenerator forgets a temporary key once no entity holds it", () => {

  test("when the entity is detached", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);
    expect(em.keyGenerator.isTempKey(key)).toBe(true);

    em.detachEntity(order);

    expect(em.keyGenerator.isTempKey(key)).toBe(false);
    expect(em.keyGenerator.getTempKeys()).toEqual([]);
  });

  test("when an added entity is rejected, which detaches it", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);

    order.entityAspect.rejectChanges();

    expect(em.keyGenerator.isTempKey(key)).toBe(false);
  });

  test("but not when its changes are accepted: it still holds the value as its key", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);

    order.entityAspect.acceptChanges();

    expect(em.keyGenerator.isTempKey(key)).toBe(true);
  });

  test("and an import can then keep that key rather than renumber it", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);
    const bundle = em.exportEntities([order]);

    em.detachEntity(order);
    const { tempKeyMapping } = em.importEntities(bundle);

    expect(tempKeyMapping[key.toString()].values[0]).toBe(key.values[0]);
  });

  // A detached entity keeps its temporary key, so attaching it again - to this manager or another -
  // has to record the value again, or an import could give a second entity the same key.
  test("and remembers it again when the entity is attached again, here or to another manager", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);
    const bundle = em.exportEntities([order]);
    em.detachEntity(order);

    em.addEntity(order);
    expect(em.keyGenerator.isTempKey(key)).toBe(true);
    expect(em.importEntities(bundle).tempKeyMapping[key.toString()].values[0]).not.toBe(key.values[0]);

    const other = TestFns.newEntityManager();
    em.detachEntity(order);
    other.addEntity(order);
    expect(other.keyGenerator.isTempKey(key)).toBe(true);
  });

  test("while one an entity still holds is not reused by an import", () => {
    const em = TestFns.newEntityManager();
    const order = newOrder(em);
    const key = keyOf(order);

    const { tempKeyMapping } = em.importEntities(em.exportEntities([order]));

    expect(tempKeyMapping[key.toString()].values[0]).not.toBe(key.values[0]);
    expect(em.keyGenerator.isTempKey(key)).toBe(true);
  });

});

// The guide's recipe for custom temporary keys: pass your value to super as valueIfAvail, so
// that it is recorded like Breeze's own, and an imported key is kept when it is free.
describe("a KeyGenerator subclass that makes its own values", () => {

  /** Temporary integer keys from -1000001 down, where Breeze's own go from -1. */
  class MillionsKeyGenerator extends KeyGenerator {
    private next = 1000001;
    generateTempKeyValue(entityType: EntityType, valueIfAvail?: any) {
      return super.generateTempKeyValue(entityType, valueIfAvail ?? -this.next++);
    }
  }

  function managerWith(ctor: new () => KeyGenerator) {
    return new EntityManager({ serviceName: TestFns.defaultServiceName, metadataStore: TestFns.sampleMetadataStore, keyGeneratorCtor: ctor });
  }

  test("gives entities its values, and records them", () => {
    const em = managerWith(MillionsKeyGenerator);
    const order = newOrder(em);
    expect(keyOf(order).values[0]).toBe(-1000001);
    expect(newOrder(em).entityAspect.getKey().values[0]).toBe(-1000002);
    expect(em.keyGenerator.isTempKey(keyOf(order))).toBe(true);
  });

  test("keeps an imported key when it is free, and replaces it when it is not", () => {
    const em = managerWith(MillionsKeyGenerator);
    const order = newOrder(em);
    const bundle = em.exportEntities([order]);
    const key = keyOf(order).toString();

    // Held: the recorded value is taken, so the import gets a new one.
    expect(em.importEntities(bundle).tempKeyMapping[key].values[0]).not.toBe(-1000001);

    // Free again: the import keeps it.
    em.clear();
    expect(em.importEntities(bundle).tempKeyMapping[key].values[0]).toBe(-1000001);
  });

});
