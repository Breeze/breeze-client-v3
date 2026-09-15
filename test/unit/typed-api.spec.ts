import { EntityManager, EntityQuery, EntityState, MetadataStore, entityTypeForCtor } from '../../src/breeze';
import { Customer, Employee, Order, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// The generics have two entry points, and they are not equivalent:
//
//   EntityQuery.from(Customer)      - checked. T is inferred from a registered constructor.
//   EntityQuery.from<Customer>('Customers') - asserted. T is the caller's claim; nothing verifies it.
//
// Both are covered here, including what the checked one rejects and the unchecked one lets past.
// The constructor path needs registration, so this file owns a store and registers into it.
const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

function newEntityManager() {
  return new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });
}

describe("Typed API - the constructor path", () => {

  test("EntityQuery.from(ctor) takes its resource name from the metadata", () => {
    const query = EntityQuery.from(Customer);
    expect(query.resourceName).toBe('Customers');
    expect(EntityQuery.from(Order).resourceName).toBe('Orders');
  });

  test("createEntity(ctor) returns an instance of that class", () => {
    const em = newEntityManager();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });

    expect(cust).toBeInstanceOf(Customer);
    expect(cust.companyName).toBe('Acme');          // typed: no cast in this file
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

  test("getEntities(ctor) and getChanges(ctor) are typed and filtered", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' });
    em.createEntity(Customer, { companyName: 'Beta' });
    em.createEntity(Order, { shipName: 'Shipment' });

    const custs = em.getEntities(Customer);
    expect(custs.length).toBe(2);
    expect(custs.map(c => c.companyName).sort()).toEqual(['Acme', 'Beta']);

    const changed = em.getChanges(Order);
    expect(changed.length).toBe(1);
    expect(changed[0].shipName).toBe('Shipment');
  });

  test("getEntities(ctor, state) still honours the state filter", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Added one' });
    em.createEntity(Customer,
      { customerID: '11111111-1111-1111-1111-111111111111', companyName: 'Unchanged one' },
      EntityState.Unchanged);

    expect(em.getEntities(Customer, EntityState.Added).length).toBe(1);
    expect(em.getEntities(Customer, EntityState.Unchanged).length).toBe(1);
    expect(em.getEntities(Customer).length).toBe(2);
  });

  test("executeQueryLocally(query) returns the query's type", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme', city: 'Oslo' });
    em.createEntity(Customer, { companyName: 'Beta', city: 'Paris' });

    const found = em.executeQueryLocally(EntityQuery.from(Customer).where('city', 'eq', 'Oslo'));
    expect(found.length).toBe(1);
    expect(found[0].companyName).toBe('Acme');      // typed
  });

  test("an unregistered constructor is rejected with a message that says what to do", () => {
    class NeverRegistered {}
    expect(() => entityTypeForCtor(NeverRegistered))
      .toThrow(/'NeverRegistered' is not registered with a MetadataStore/);
    expect(() => entityTypeForCtor(NeverRegistered))
      .toThrow(/registerEntityTypeCtor/);
    expect(() => EntityQuery.from(NeverRegistered as any)).toThrow(/is not registered/);
    expect(() => newEntityManager().createEntity(NeverRegistered as any)).toThrow(/is not registered/);
  });

  test("entityTypeForCtor resolves a registered one", () => {
    expect(entityTypeForCtor(Customer).name).toBe('Customer:#Foo');
    expect(entityTypeForCtor(Customer).defaultResourceName).toBe('Customers');
  });

});

describe("Typed API - the resource-name path", () => {

  test("a resource name with an explicit type argument is accepted as given", () => {
    // The type parameter here is a claim, not a check: 'Customers' and Order are unrelated, and
    // nothing can tell. This is `as` with better syntax, and the docs say so.
    const query = EntityQuery.from<Order>('Customers');
    expect(query.resourceName).toBe('Customers');
  });

  test("createEntity by name still returns Entity, as it always did", () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' });
    expect(cust.getProperty('companyName')).toBe('Acme');
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

  test("getEntities by name and by EntityType are unchanged", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' });

    expect(em.getEntities('Customer').length).toBe(1);
    expect(em.getEntities(metadataStore.getAsEntityType('Customer')).length).toBe(1);
  });

  test("select() drops the type parameter, because a projection is not the entity", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme', city: 'Oslo' });

    // EntityQuery<Customer> -> EntityQuery<any>: the rows are no longer Customers.
    const projected = em.executeQueryLocally(EntityQuery.from(Customer).select('companyName'));
    expect(projected.length).toBe(1);
    expect(projected[0].companyName).toBe('Acme');
  });

});

// What the compiler must reject. `@ts-expect-error` fails the build when the line below it does
// NOT error, so these are enforced by `npm run typecheck`, not by running anything. Without them
// the type parameters could quietly become decorative and every runtime test above would still
// pass.
// Never called. It exists to be type-checked: `npm run typecheck` fails if any line below stops
// being an error, because an unused @ts-expect-error is itself an error (TS2578). Running it would
// prove nothing - half of these throw at runtime by design - so it stays out of the suite.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustReject() {
  const em = newEntityManager();

  const cust = em.createEntity(Customer, { companyName: 'Acme' });
  // @ts-expect-error - freight is an Order property, not a Customer one
  cust.freight;

  const orderQuery = EntityQuery.from(Order);
  const custQuery = EntityQuery.from(Customer);
  // @ts-expect-error - EntityQuery<Order> is not an EntityQuery<Customer>
  const mislabelled: typeof custQuery = orderQuery;

  const orders = em.executeQueryLocally(EntityQuery.from(Order));
  // @ts-expect-error - the results are Orders
  orders[0].companyName;

  // @ts-expect-error - getEntities(Customer) is Customer[], not Order[]
  const wrong: Order[] = em.getEntities(Customer);

  class NotAnEntity { declare somethingElse: number; }
  // @ts-expect-error - NotAnEntity has no entityAspect, so it is not an Entity
  EntityQuery.from(NotAnEntity);
  // @ts-expect-error - same, for createEntity
  em.createEntity(NotAnEntity);

  return [mislabelled, wrong];
}

describe("Typed API - existing untyped code is unaffected", () => {

  test("QueryResult.results defaults to any[], so untyped access still compiles", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' });

    // No type argument anywhere: this is how every 2.x spec is written.
    const query = new EntityQuery('Customers');
    const results = em.executeQueryLocally(query);
    expect(results[0].getProperty('companyName')).toBe('Acme');
    expect(results[0].anythingAtAll).toBeUndefined();   // any[], so this compiles
  });

  test("a chained query keeps its type through where/orderBy/take", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme', city: 'Oslo' });
    em.createEntity(Customer, { companyName: 'Beta', city: 'Oslo' });

    const found = em.executeQueryLocally(
      EntityQuery.from(Customer).where('city', 'eq', 'Oslo').orderBy('companyName').take(1));
    expect(found.length).toBe(1);
    expect(found[0].companyName).toBe('Acme');          // still typed after chaining
  });

  test("Employee still resolves its own navigation through the typed path", () => {
    const em = newEntityManager();
    const manager = em.createEntity(Employee, { firstName: 'Nancy', lastName: 'Davolio' });
    const report = em.createEntity(Employee, { firstName: 'Andrew', lastName: 'Fuller', manager });

    expect(report.manager).toBe(manager);
    expect(manager.directReports[0]).toBe(report);
  });

});
