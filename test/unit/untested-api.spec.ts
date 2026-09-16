import {
  EntityAspect, EntityKey, EntityManager, EntityState, MetadataStore,
} from '../../src/breeze';
import { Customer, Order, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// Public API that had no test at all. Found by listing the exported classes' public methods and
// checking which names never appear in test/ - see "Test coverage gaps" in STATUS.md for the rest,
// including the ones that need a server and so are not here.
//
// These are characterisation tests: they record what the methods do today, so a change to any of
// them stops being silent.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

const newEm = () => new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });

describe("MetadataStore - previously untested", () => {

  test("getEntityType finds a type, or returns null rather than throwing", () => {
    expect(metadataStore.getEntityType('Customer')!.shortName).toBe('Customer');
    // getAsEntityType throws for an unknown name; getEntityType is the tolerant one.
    expect(metadataStore.getEntityType('NoSuchType', true)).toBeNull();
    expect(() => metadataStore.getEntityType('NoSuchType')).toThrow();
  });

  test("parseTypeName splits either spelling of a type name", () => {
    const fromClient = MetadataStore.parseTypeName('Customer:#Foo')!;
    expect(fromClient.shortTypeName).toBe('Customer');
    expect(fromClient.namespace).toBe('Foo');
    expect(fromClient.typeName).toBe('Customer:#Foo');

    // the .NET spelling, which is what a server sends
    const fromServer = MetadataStore.parseTypeName('Foo.Customer')!;
    expect(fromServer.shortTypeName).toBe('Customer');
    expect(fromServer.namespace).toBe('Foo');
  });

  test("getEntityTypeNameForResourceName is the inverse of the resource map", () => {
    expect(metadataStore.getEntityTypeNameForResourceName('Customers')).toBe('Customer:#Foo');
    expect(metadataStore.getEntityTypeNameForResourceName('NotAResource')).toBeUndefined();
  });

});

describe("EntityType - previously untested", () => {

  test("getPropertyNames lists data and navigation properties", () => {
    const names = metadataStore.getAsEntityType('Customer').getPropertyNames();
    expect(names).toContain('companyName');   // data
    expect(names).toContain('orders');        // navigation
  });

  test("isSubtypeOf and getSelfAndSubtypes for a type with no hierarchy", () => {
    const custType = metadataStore.getAsEntityType('Customer');
    const orderType = metadataStore.getAsEntityType('Order');

    expect(custType.isSubtypeOf(custType)).toBe(true);   // a type is its own subtype
    expect(custType.isSubtypeOf(orderType)).toBe(false);
    expect(custType.getSelfAndSubtypes()).toEqual([custType]);
  });

  test("getEntityKeyFromRawEntity reads the key out of server-shaped JSON", () => {
    const orderType = metadataStore.getAsEntityType('Order');
    const raw = { OrderID: 42, ShipCity: 'Berlin' };
    const key = orderType.getEntityKeyFromRawEntity(raw, (r: any, p: any) => r[p.nameOnServer]);

    expect(key.entityType).toBe(orderType);
    expect(key.values).toEqual([42]);
  });

});

describe("EntityKey - previously untested", () => {

  test("createKeyString joins composite values into one comparable string", () => {
    const single = EntityKey.createKeyString([42]);
    const composite = EntityKey.createKeyString([10643, 28]);

    expect(typeof single).toBe('string');
    expect(single).toContain('42');
    expect(composite).toContain('10643');
    expect(composite).toContain('28');
    // the point of it: equal keys give equal strings, different keys do not
    expect(EntityKey.createKeyString([10643, 28])).toBe(composite);
    expect(EntityKey.createKeyString([28, 10643])).not.toBe(composite);
  });

});

describe("EntityAspect - previously untested", () => {

  test("setAdded and setEntityState move an entity between states", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'Acme' }, EntityState.Unchanged);
    expect(cust.entityAspect.entityState.isUnchanged()).toBe(true);

    cust.entityAspect.setAdded();
    expect(cust.entityAspect.entityState.isAdded()).toBe(true);

    cust.entityAspect.setEntityState(EntityState.Modified);
    expect(cust.entityAspect.entityState.isModified()).toBe(true);

    cust.entityAspect.setEntityState(EntityState.Detached);
    expect(cust.entityAspect.entityState.isDetached()).toBe(true);
  });

  test("clearValidationErrors removes what validation put on the entity", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, {}, EntityState.Added);

    cust.entityAspect.validateEntity();
    expect(cust.entityAspect.getValidationErrors().length).toBeGreaterThan(0);

    cust.entityAspect.clearValidationErrors();
    expect(cust.entityAspect.getValidationErrors()).toHaveLength(0);
    expect(cust.entityAspect.hasValidationErrors).toBe(false);
  });

  test("getParentKey returns the key the foreign key points at", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    const order = em.createEntity(Order, { customerID: cust.customerID });

    const navProp = order.entityType.getNavigationProperty('customer');
    const parentKey = order.entityAspect.getParentKey(navProp)!;

    expect(parentKey.entityType.shortName).toBe('Customer');
    expect(parentKey.values).toEqual([cust.customerID]);
  });

  test("getPropertyPathValue walks a dotted path across entities", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    const order = em.createEntity(Order, { customerID: cust.customerID });

    // an unset string property reads as null, not undefined - Breeze gives it a default
    expect(EntityAspect.getPropertyPathValue(order, 'shipCity')).toBeNull();
    expect(EntityAspect.getPropertyPathValue(order, 'customer.companyName')).toBe('Acme');
    expect(EntityAspect.getPropertyPathValue(order, ['customer', 'companyName'])).toBe('Acme');
  });

  test("markNavigationPropertyAsLoaded stops a second fetch being needed", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });

    // false, not undefined: the overloads promise boolean, and before this test they lied.
    expect(cust.entityAspect.isNavigationPropertyLoaded('orders')).toBe(false);
    cust.entityAspect.markNavigationPropertyAsLoaded('orders');
    expect(cust.entityAspect.isNavigationPropertyLoaded('orders')).toBe(true);
  });

});

describe("EntityManager - previously untested", () => {

  test("findEntityByKey takes an EntityKey and looks only in the cache", () => {
    const em = newEm();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    const key = cust.entityAspect.getKey();

    expect(em.findEntityByKey(key)).toBe(cust);

    const missing = new EntityKey(metadataStore.getAsEntityType('Customer'),
      ['00000000-0000-0000-0000-000000000000']);
    expect(em.findEntityByKey(missing)).toBeNull();
  });

});
