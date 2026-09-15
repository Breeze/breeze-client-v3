import { EntityManager, EntityQuery, EntityState, MetadataStore, entityTypeForCtor } from '../../src/breeze';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// Breeze builds a constructor for every entity type itself unless you register one. That path is
// what an application gets with no setup at all, and it is what most of this suite exercised
// before the specs started registering the generated classes to get typed property access.
//
// Registering is now common enough in the suite that the unregistered path could stop being
// covered without anyone noticing. These tests cover it on purpose: no registerEntityTypeCtor
// anywhere in this file, and nothing imported from ../model.

function newStore() {
  const ms = new MetadataStore();
  ms.importMetadata(JSON.stringify(northwindMetadata));
  return ms;
}

function newEntityManager() {
  return new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore: newStore() });
}

describe("Unregistered entity types - the default constructor path", () => {

  test("createEntity works with no constructor registered", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' });

    expect(cust.entityType.shortName).toBe('Customer');
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
    expect(cust.getProperty('companyName')).toBe('Acme');
  });

  test("the generated constructor is named after the type", () => {
    const entityType = newStore().getAsEntityType('Customer');
    const ctor = entityType.getCtor();

    expect(typeof ctor).toBe('function');
    // createEmptyCtor names it via Object.defineProperty - 'Order:#Foo' becomes 'Order__Foo'.
    expect(ctor.name).toMatch(/Customer/);
  });

  test("properties, navigations and change tracking all work through getProperty", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' });
    const order = em.createEntity('Order', { customer: cust });

    expect(order.getProperty('customer')).toBe(cust);
    expect(cust.getProperty('orders').length).toBe(1);
    expect(cust.getProperty('orders')[0]).toBe(order);

    cust.setProperty('city', 'Oslo');
    expect(cust.getProperty('city')).toBe('Oslo');
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

  test("complex properties work without a registered complex-type class", () => {
    const em = newEntityManager();
    const supplier = em.createEntity('Supplier', { companyName: 'Acme Parts' });

    supplier.getProperty('location').setProperty('city', 'Oslo');
    expect(supplier.getProperty('location').getProperty('city')).toBe('Oslo');
    expect(supplier.getProperty('location').complexAspect.parent).toBe(supplier);
  });

  test("queries by resource name return untyped results", () => {
    const em = newEntityManager();
    em.createEntity('Customer', { companyName: 'Acme', city: 'Oslo' });

    const found = em.executeQueryLocally(EntityQuery.from('Customers').where('city', 'eq', 'Oslo'));
    expect(found.length).toBe(1);
    expect(found[0].getProperty('companyName')).toBe('Acme');
  });

  test("the typed APIs refuse an unregistered constructor, and say what to do", () => {
    // What a caller sees if they reach for the constructor overloads without registering first.
    class Customer {}
    const em = newEntityManager();

    expect(() => entityTypeForCtor(Customer)).toThrow(/is not registered with a MetadataStore/);
    expect(() => entityTypeForCtor(Customer)).toThrow(/registerEntityTypeCtor\('Customer', Customer\)/);
    expect(() => EntityQuery.from(Customer as any)).toThrow(/is not registered/);
    expect(() => em.createEntity(Customer as any)).toThrow(/is not registered/);
    expect(() => em.getEntities(Customer as any)).toThrow(/is not registered/);
    expect(() => em.getChanges(Customer as any)).toThrow(/is not registered/);
  });

});
