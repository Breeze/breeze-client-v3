import { EntityManager, EntityState, MetadataStore } from '../../src/breeze';
import { Customer, Employee, Order, Supplier, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// The generated classes bind to exactly one MetadataStore for the life of the process, so they
// are registered here against a store this file owns. Vitest gives each spec file its own module
// graph, so the classes another file registers are a different set of objects.
const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

function newEntityManager() {
  return new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });
}

describe("Generated model classes", () => {

  test("createEntity produces an instance of the generated class", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;

    expect(cust).toBeInstanceOf(Customer);
    expect(cust.entityType.shortName).toBe('Customer');
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

  test("mapped properties read and write through Breeze's accessors", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;

    expect(cust.companyName).toBe('Acme');
    expect(cust.getProperty('companyName')).toBe('Acme');

    cust.companyName = 'Beta';
    expect(cust.getProperty('companyName')).toBe('Beta');
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);

    cust.setProperty('city', 'London');
    expect(cust.city).toBe('London');
  });

  test("declare leaves no own properties to shadow the prototype accessors", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', {}) as Customer;

    // Every mapped member must come from the prototype. An own property here would mean a
    // class field was written without `declare`.
    expect(Object.prototype.hasOwnProperty.call(cust, 'companyName')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cust, 'orders')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cust, 'getProperty')).toBe(false);
  });

  test("no member of the class becomes an unmapped property", () => {
    // The generated classes declare nothing at runtime, so Breeze must find no unmapped
    // properties on any of them.
    for (const shortName of ['Customer', 'Order', 'Employee', 'Supplier']) {
      const entityType = metadataStore.getAsEntityType(shortName);
      expect(entityType.unmappedProperties.map(p => p.name)).toEqual([]);
    }
  });

  test("a scalar navigation is typed as the related class", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;
    const order = em.createEntity('Order', { customer: cust }) as Order;

    expect(order.customer).toBe(cust);
    expect(order.customer).toBeInstanceOf(Customer);
    expect(order.customer.companyName).toBe('Acme');
  });

  test("a collection navigation is a relation array of the related class", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;
    const order = em.createEntity('Order', { customer: cust }) as Order;

    expect(cust.orders.length).toBe(1);
    expect(cust.orders[0]).toBe(order);
    expect(cust.orders[0]).toBeInstanceOf(Order);
    // RelationArray members, not just Array ones.
    expect(typeof cust.orders.load).toBe('function');
    expect(cust.orders.parentEntity).toBe(cust);
  });

  test("a complex property is an instance of the generated complex class", () => {
    const em = newEntityManager();
    const supplier = em.createEntity('Supplier', { companyName: 'Acme Parts' }) as Supplier;

    supplier.location.city = 'Oslo';
    expect(supplier.location.city).toBe('Oslo');
    expect(supplier.location.complexAspect.parent).toBe(supplier);
  });

  test("a self-referencing navigation resolves to its own class", () => {
    const em = newEntityManager();
    const manager = em.createEntity('Employee', { firstName: 'Nancy', lastName: 'Davolio' }) as Employee;
    const report = em.createEntity('Employee', { firstName: 'Andrew', lastName: 'Fuller', manager }) as Employee;

    expect(report.manager).toBe(manager);
    expect(manager.directReports[0]).toBe(report);
  });

  test("the classes cover every entity type in the metadata", () => {
    const em = newEntityManager();
    for (const entityType of metadataStore.getEntityTypes()) {
      const ctor = entityType.getCtor();
      expect(ctor.name).toBe(entityType.shortName);
    }
    expect(em.metadataStore).toBe(metadataStore);
  });

});

describe("Registering the generated classes", () => {

  test("registering twice against the same store is harmless", () => {
    registerModelClasses(metadataStore);
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;
    expect(cust).toBeInstanceOf(Customer);
    expect(cust.companyName).toBe('Acme');
  });

  test("registering the same class in a second store throws", () => {
    const other = new MetadataStore();
    other.importMetadata(JSON.stringify(northwindMetadata));
    expect(() => registerModelClasses(other)).toThrow(/different metadata stores/);
  });

});

describe("Importing Breeze by its published name", () => {

  test("'breeze-client' resolves to the same module the specs import", async () => {
    // test/model/ imports 'breeze-client', because those files are what the generator writes
    // for an application. Inside this repo that name is aliased to src/ (vitest.shared.config.ts
    // and the `paths` in test/tsconfig.json). If the alias were missing it would still resolve,
    // via the package's own `exports` map, to dist/ - and the model would be typed against a
    // different copy of Breeze from the one the specs run. Two copies means two EntityState
    // enums and instanceof checks that fail for no visible reason.
    const byName = await import('breeze-client');
    const bySource = await import('../../src/breeze');
    expect(byName.EntityState).toBe(bySource.EntityState);
    expect(byName.MetadataStore).toBe(bySource.MetadataStore);
  });

});
