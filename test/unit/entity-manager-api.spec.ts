import { configureBreeze, EntityManager, EntityState, KeyGenerator, MetadataStore, NamingConvention } from '../../src/breeze';
import type { EntityType } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  namingConvention: NamingConvention.camelCase,
});

function newStore() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  return ms;
}

describe('key generator configuration', () => {

  class CountingKeyGenerator extends KeyGenerator {
    calls = 0;
    generateTempKeyValue(entityType: EntityType, valueIfAvail?: any) {
      this.calls++;
      return super.generateTempKeyValue(entityType, valueIfAvail);
    }
  }

  test('keyGeneratorCtor supplies the generator, and a new one after clear()', () => {
    const em = new EntityManager({ metadataStore: newStore(), keyGeneratorCtor: CountingKeyGenerator });
    const first = em.keyGenerator as CountingKeyGenerator;
    expect(first).toBeInstanceOf(CountingKeyGenerator);

    em.createEntity('Order');
    expect(first.calls).toBe(1);

    em.clear();
    expect(em.keyGenerator).toBeInstanceOf(CountingKeyGenerator);
    expect(em.keyGenerator).not.toBe(first);
  });

  test('a generator instance is not accepted as configuration', () => {
    // keyGenerator is no longer declared in EntityManagerConfig; it never worked at runtime.
    // @ts-expect-error
    expect(() => new EntityManager({ metadataStore: newStore(), keyGenerator: new KeyGenerator() }))
      .toThrow(/Unknown property: 'keyGenerator'/);
  });

  test('generateTempKeyValue uses valueIfAvail as the key if it is still free', () => {
    const em = new EntityManager({ metadataStore: newStore() });
    const orderType = em.metadataStore.getAsEntityType('Order')!;
    expect(em.keyGenerator.generateTempKeyValue(orderType, -1000)).toBe(-1000);
    const next = em.keyGenerator.generateTempKeyValue(orderType, -1000);
    expect(next).not.toBe(-1000);
    expect(typeof next).toBe('number');
  });

});

describe('setProperty', () => {

  test('returns the entity, so calls can be chained', () => {
    const em = new EntityManager({ metadataStore: newStore() });
    const cust = em.createEntity('Customer');
    const result = cust.setProperty('companyName', 'Chained Co').setProperty('city', 'Paris');
    expect(result).toBe(cust);
    expect(cust.getProperty('companyName')).toBe('Chained Co');
    expect(cust.getProperty('city')).toBe('Paris');
  });

  test('with a name not in the metadata, creates an untracked property, as an assignment would', () => {
    const em = new EntityManager({ metadataStore: newStore() });
    const cust = em.createEntity('Customer',
      { customerID: '11111111-1111-1111-1111-111111111111', companyName: 'Co' }, EntityState.Unchanged);

    cust.setProperty('clientOnlyNote', 'remember me');

    expect(cust.getProperty('clientOnlyNote')).toBe('remember me');
    expect(cust.entityAspect.entityState).toBe(EntityState.Unchanged);
    expect(cust.entityAspect.originalValues).toEqual({});
  });

});
