import { EntityKey, EntityManager, EntityQuery, EntityState, MetadataStore, Validator, entityTypeForCtor } from '../../src/breeze';
import type { Entity } from '../../src/breeze';
import { Customer, Employee, Order, OrderDetail, Supplier, registerModelClasses } from '../model';
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

  test("a constructor works against an equivalent store it was not registered with", () => {
    // The class stands for its type *name*, resolved against whichever store the manager has.
    // Using the EntityType off the prototype would tie every call to the one store the class was
    // registered with, and a manager built from the same metadata would fail inside attachEntity
    // with a store mismatch. Several save specs create managers exactly that way.
    const otherStore = new MetadataStore();
    otherStore.importMetadata(JSON.stringify(northwindMetadata));
    const em = new EntityManager({ serviceName: 'http://localhost:0/x', metadataStore: otherStore });

    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    expect(cust.companyName).toBe('Acme');
    expect(cust.entityType.metadataStore).toBe(otherStore);
    // Built by that store's own constructor, so not an instance of the registered class.
    expect(cust).not.toBeInstanceOf(Customer);

    expect(em.getEntities(Customer).length).toBe(1);
    expect(em.getChanges(Customer).length).toBe(1);
  });

  test("entityTypeForCtor resolves a registered one", () => {
    expect(entityTypeForCtor(Customer).name).toBe('Customer:#Foo');
    expect(entityTypeForCtor(Customer).defaultResourceName).toBe('Customers');
  });

});

describe("Typed API - the second round of typed overloads", () => {

  test("getEntityByKey(ctor) returns that type", () => {
    const em = newEntityManager();
    const id = '22222222-2222-2222-2222-222222222222';
    em.createEntity(Customer, { customerID: id, companyName: 'Acme' }, EntityState.Unchanged);

    const found = em.getEntityByKey(Customer, id);
    expect(found).not.toBeNull();
    expect(found!.companyName).toBe('Acme');          // typed
    expect(em.getEntityByKey(Customer, 'no-such-id')).toBeNull();
  });

  test("a missing entity is null, the same as everywhere else in Breeze", () => {
    const em = newEntityManager();
    const order = em.createEntity(Order, { orderID: 1 });

    // Absence is null throughout Breeze: an uncached scalar navigation, a nullable data property,
    // and a key lookup that misses. fetchEntityByKey's result used to be the one exception - it
    // gave undefined - which is why IEntityByKeyResult.entity is `Entity | null` from 3.0 and no
    // longer optional. The runtime half of that is asserted in query-alt.spec.ts, which can reach
    // a server; this pins the ones that need no server.
    expect(order.customer).toBeNull();                       // uncached scalar navigation
    expect(order.shipName).toBeNull();                       // unset nullable data property
    expect(em.getEntityByKey(Customer, 'no-such-id')).toBeNull();
    expect(em.getEntityByKey('Customer', 'no-such-id')).toBeNull();
  });

  test("attachEntity and addEntity give back what they were given", () => {
    const em = newEntityManager();
    const detached = em.createEntity(Customer, { companyName: 'Acme' }, EntityState.Detached);

    // These return the entity passed in, so they should not widen it to Entity.
    const attached = em.attachEntity(detached, EntityState.Added);
    expect(attached.companyName).toBe('Acme');        // typed
    expect(attached).toBe(detached);

    const em2 = newEntityManager();
    const another = em2.createEntity(Customer, { companyName: 'Beta' }, EntityState.Detached);
    expect(em2.addEntity(another).companyName).toBe('Beta');
  });

  test("hasChanges(ctor) filters by type", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' });

    expect(em.hasChanges(Customer)).toBe(true);
    expect(em.hasChanges(Order)).toBe(false);
  });

  test("EntityQuery.fromEntities keeps the entity's type", () => {
    const em = newEntityManager();
    const cust = em.createEntity(Customer, { companyName: 'Acme' }, EntityState.Unchanged);

    const q = EntityQuery.fromEntities(cust);
    expect(q.resourceName).toBe('Customers');
    const found = em.executeQueryLocally(q);
    expect(found[0].companyName).toBe('Acme');        // typed
  });

  test("toType(ctor) names the type and types the query", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' }, EntityState.Unchanged);

    // The usual reason for toType: a resource no entity class is bound to.
    const q = EntityQuery.from('Customers').toType(Customer);
    expect(q.resultEntityType).toBe(metadataStore.getAsEntityType('Customer'));
    expect(em.executeQueryLocally(q)[0].companyName).toBe('Acme');   // typed
  });

  test("entityType.createEntity<T>() carries the type argument", () => {
    const orderType = metadataStore.getAsEntityType('Order');
    const order = orderType.createEntity<Order>({ shipName: 'Acme' });
    expect(order.shipName).toBe('Acme');              // typed
  });

});

describe("Typed API - the second round does not widen existing code", () => {

  test("fromEntities on a plain Entity stays untyped", () => {
    const em = newEntityManager();
    // What a caller had before any of this existed: a variable typed Entity.
    const entity: Entity = em.createEntity(Customer, { companyName: 'Acme' }, EntityState.Unchanged);

    // QueriedAs maps Entity back to any, so `.results[0].anything` still compiles. Inferring
    // EntityQuery<Entity> here would break every existing caller - it did, in 9 places in
    // datatypes.spec.ts, before the conditional type was added.
    const q = EntityQuery.fromEntities(entity);
    const found = em.executeQueryLocally(q);
    expect(found[0].companyName).toBe('Acme');
    expect(found[0].anythingAtAll).toBeUndefined();
  });

  test("entityType.createEntity() with no type argument is still any", () => {
    const orderType = metadataStore.getAsEntityType('Order');
    const order = orderType.createEntity({ shipName: 'Acme' });
    expect(order.shipName).toBe('Acme');
    expect(order.nothingLikeThis).toBeUndefined();    // any, as it has always been
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

describe("Typed API - createEntity's initial values", () => {

  // The shapes compilerMustAccept lets through, run: each is what createEntity really does with it.
  test("navigation, collection and complex values are all set", () => {
    const em = newEntityManager();
    const customer = em.createEntity(Customer);
    const detail = em.createEntity(OrderDetail, { orderID: 7, productID: 1 });

    const order = em.createEntity(Order, { orderID: 7, shipName: 'Acme', customer, orderDetails: [detail] });
    const supplier = em.createEntity(Supplier, { supplierID: 1, location: { city: 'Oslo' } });

    expect(order.shipName).toBe('Acme');
    expect(order.customer).toBe(customer);
    expect(order.orderDetails).toContain(detail);
    expect(supplier.location.city).toBe('Oslo');
  });

  // Why the property names are checked: at runtime one Breeze does not know is dropped silently.
  test("a property the type does not have is ignored at runtime, not reported", () => {
    const em = newEntityManager();
    const order = em.createEntity('Order', { orderID: 8, OrderID: 99, shipNmae: 'Acme' }) as Order;

    expect(order.orderID).toBe(8);
    expect(order.shipName).toBeFalsy();
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

  // the second round of overloads has to be load-bearing too
  // @ts-expect-error - getEntityByKey(Customer, ...) is Customer | null, not an Order
  em.getEntityByKey(Customer, 'id')!.freight;
  // @ts-expect-error - attachEntity gives back what it was given, so still a Customer
  em.attachEntity(cust).freight;
  // @ts-expect-error - fromEntities(Customer) makes a Customer query
  em.executeQueryLocally(EntityQuery.fromEntities(cust))[0].freight;
  // @ts-expect-error - toType(Customer) says the results are Customers
  em.executeQueryLocally(EntityQuery.from('Orders').toType(Customer))[0].freight;
  // @ts-expect-error - the type argument on createEntity is honoured
  em.metadataStore.getAsEntityType('Order').createEntity<Order>().companyName;

  // createEntity's initial values, with the constructor. At runtime each of these property names
  // would be ignored without a word, so the entity would be created without the value.
  // @ts-expect-error - server casing: the property is orderID
  em.createEntity(Order, { OrderID: 1 });
  // @ts-expect-error - a misspelling
  em.createEntity(Order, { shipNmae: 'Acme' });
  // @ts-expect-error - a Customer property, not an Order one
  em.createEntity(Order, { companyName: 'Acme' });
  // @ts-expect-error - the declared type, as assigning the property would require
  em.createEntity(Order, { freight: 'lots' });
  // @ts-expect-error - a member every entity has is not an initial value; passing it throws
  em.createEntity(Order, { entityAspect: cust.entityAspect });
  // @ts-expect-error - a navigation property takes the right type of entity
  em.createEntity(Order, { customer: em.createEntity(Employee) });

  return [mislabelled, wrong];
}

// And what must still compile. Called by nothing either - the runtime half is the test below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustAccept(detail: OrderDetail, supplier: Supplier) {
  const em = newEntityManager();
  const customer = em.createEntity(Customer);
  // data and navigation properties, each optional
  em.createEntity(Order, { orderID: 1, shipName: 'Acme', customer });
  // a collection navigation property takes a plain array, as it does at runtime
  em.createEntity(Order, { orderDetails: [detail] });
  // a complex property takes a plain object of its own values
  em.createEntity(Supplier, { location: { city: 'Oslo' } });
  // or the complex object itself
  em.createEntity(Supplier, { location: supplier.location });
  // values built at runtime still go through, as a Record carries no property names to check
  const dynamic: Record<string, any> = { ['order' + 'ID']: 2 };
  em.createEntity(Order, dynamic);
  // and the name overload is untyped, for values the compiler cannot see
  em.createEntity('Order', { anything: 'goes' });
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

// Methods that took plain strings or type names where the rest of the typed API takes checked
// paths and constructors.
describe("Typed API - orderByDesc and select check their paths", () => {

  test("orderByDesc sorts descending, whichever form it is given", () => {
    const em = newEntityManager();
    ['Beta', 'Acme', 'Cody'].forEach(companyName => em.createEntity(Customer, { companyName }));
    const names = (q: EntityQuery<Customer>) => em.executeQueryLocally(q).map(c => c.companyName);

    expect(names(EntityQuery.from(Customer).orderByDesc('companyName'))).toEqual(['Cody', 'Beta', 'Acme']);
    expect(names(EntityQuery.from(Customer).orderByDesc(['companyName']))).toEqual(['Cody', 'Beta', 'Acme']);
  });

  test("select takes a value, a complex object or a navigation, by checked path", () => {
    const paths = (q: EntityQuery) => q.selectClause!.propertyPaths;
    expect(paths(EntityQuery.from(Order).select(['orderDate', 'customer', 'customer.companyName', 'orderDetails'])))
      .toEqual(['orderDate', 'customer', 'customer.companyName', 'orderDetails']);
    expect(paths(EntityQuery.from(Supplier).select(['location', 'location.city']))).toEqual(['location', 'location.city']);
    expect(paths(EntityQuery.from(Customer).select('companyName, city'))).toEqual(['companyName', 'city']);
  });

});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustRejectPaths() {
  // @ts-expect-error - a misspelling, which orderByDesc used to accept
  EntityQuery.from(Order).orderByDesc('freigt');
  // @ts-expect-error - same, in an array
  EntityQuery.from(Order).orderByDesc(['freight', 'shipCty']);
  // @ts-expect-error - select checks its paths
  EntityQuery.from(Customer).select('compnyName');
  // @ts-expect-error - a projection cannot reach into each element of a collection
  EntityQuery.from(Customer).select('orders.freight');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustAcceptPaths(column: string) {
  EntityQuery.from(Order).orderByDesc('customer.companyName');
  EntityQuery.from(Order).orderByDesc('freight, shipCity');   // a comma-separated list is not checked
  EntityQuery.from(Order).orderByDesc(column);                // nor is a path only known at run time
  EntityQuery.from(Customer).select('companyName, orders');
  EntityQuery.from(Customer).select(column);
  EntityQuery.from(Customer).select([column]);
  EntityQuery.from(Customer).select();                        // removes the projection
  new EntityQuery('Customers').select('anything.at.all');     // untyped, as before
}

describe("Typed API - several classes at once, and exports", () => {

  test("getEntities, getChanges and hasChanges take an array of classes", () => {
    const em = newEntityManager();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    const order = em.createEntity(Order, { shipName: 'Acme' });
    em.createEntity(Employee, { lastName: 'Fuller' });

    const both = em.getEntities([Customer, Order]);    // (Customer | Order)[]
    expect(both).toHaveLength(2);
    expect(both).toContain(cust);
    expect(em.getChanges([Customer, Order])).toHaveLength(2);
    expect(em.hasChanges([Customer, Order])).toBe(true);
    order.entityAspect.acceptChanges();
    cust.entityAspect.acceptChanges();
    expect(em.hasChanges([Customer, Order])).toBe(false);
  });

  test("exportEntities takes classes, and its result is a string unless asString is false", () => {
    const em = newEntityManager();
    em.createEntity(Customer, { companyName: 'Acme' });
    em.createEntity(Order, { shipName: 'Acme' });

    const bundle: string = em.exportEntities([Customer], { includeMetadata: false });
    const other = newEntityManager();
    other.importEntities(bundle);
    expect(other.getEntities(Customer)).toHaveLength(1);
    expect(other.getEntities(Order)).toHaveLength(0);

    const asObject: Object = em.exportEntities(undefined, { asString: false });
    expect(typeof asObject).toBe('object');
  });

});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustRejectArrays(asString: boolean) {
  const em = newEntityManager();
  // @ts-expect-error - [Customer, Order] gives (Customer | Order)[], not Order[]
  const orders: Order[] = em.getEntities([Customer, Order]);
  class NotAnEntity { declare somethingElse: number; }
  // @ts-expect-error - every class in the array must be an entity
  em.getChanges([Customer, NotAnEntity]);
  // @ts-expect-error - asString: false gives the bundle as an object, not a string
  const s: string = em.exportEntities(undefined, { asString: false });
  // @ts-expect-error - with asString only known at run time, it could be either
  const t: string = em.exportEntities(undefined, { asString });
  return [orders, s, t];
}

describe("Typed API - classes for keys and types, and validator contexts", () => {

  test("an EntityKey and getAsEntityType take a registered class", () => {
    const em = newEntityManager();
    const emp = em.createEntity(Employee, { employeeID: 7, lastName: 'Fuller' }, EntityState.Unchanged);

    expect(new EntityKey(Employee, 7).equals(emp.entityAspect.getKey())).toBe(true);
    expect(em.getEntityByKey(new EntityKey(Employee, 7))).toBe(emp);
    expect(em.metadataStore.getAsEntityType(Employee)).toBe(em.metadataStore.getAsEntityType('Employee'));
  });

  test("a validation function reads its own settings from the context, without a cast", () => {
    const atLeast = new Validator('atLeast', (value, ctx) => value == null || value >= ctx.min, { min: 10 });
    expect(atLeast.validate(12)).toBeNull();
    expect(atLeast.validate(5)).not.toBeNull();
  });

});
