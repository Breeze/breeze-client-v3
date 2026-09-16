import { Entity, EntityQuery, EntityType, MetadataStore, Predicate, breeze, MergeStrategy, DataProperty, NavigationProperty, core, QueryOptions, EntityManager, EntityKey, RelationArray } from '../../src/breeze';
import { TestFns, skipTestIf, skipDescribeIf } from '../test-fns';
import { Customer, Employee, Order, Region, registerModelClasses } from '../model';

// function ok(a: any, b?: any) {
//   throw new Error('for test conversion purposes');
// }

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  // Types the queries below; see test/model/README.md. The unregistered default-constructor
  // path has its own coverage in test/unit/unregistered-types.spec.ts.
  registerModelClasses(TestFns.defaultMetadataStore);

});

describe("Query Alternatives", () => {

  test("using EntityManager.fetchEntityByKey", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const alfredsID = TestFns.wellKnownData.alfredsID;

    const fr1 = await em1.fetchEntityByKey("Customer", alfredsID);
    const alfred = fr1.entity;
    expect(alfred).not.toBeNull();
    // should have been from database
    expect(fr1.fromCache).toBe(false);
    const fr2 = await em1.fetchEntityByKey("Customer", alfredsID, true);

    const alfred2 = fr2.entity;
    expect(alfred2).not.toBeNull();
    expect(alfred).toBe(alfred2);
    // should have been from cache
    expect(fr2.fromCache).toBe(true);
    const fr3 = await em1.fetchEntityByKey(fr2.entityKey);
    const alfred3 = fr3.entity;
    expect(alfred3).toBe(alfred);
    expect(fr3.fromCache).toBe(false);
  });

  test("using EntityManager.fetchEntityByKey without metadata", async () => {
    expect.hasAssertions();
    const emX = new breeze.EntityManager(TestFns.defaultServiceName);
    const alfredsID = TestFns.wellKnownData.alfredsID;
    const fr1 = await emX.fetchEntityByKey("Customer", alfredsID, true);
    const alfred = fr1.entity;
    expect(alfred).not.toBeNull();
    expect(fr1.fromCache).toBe(false);
  });

  test("using EntityManager.fetchEntityByKey - deleted", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const alfredsID = TestFns.wellKnownData.alfredsID;
    const fr1 = await em1.fetchEntityByKey("Customer", alfredsID);

    const alfred = fr1.entity;
    expect(alfred).not.toBeNull();
    expect(fr1.fromCache).toBe(false);
    alfred.entityAspect.setDeleted();
    const fr2 = await em1.fetchEntityByKey("Customer", alfredsID, true);

    const alfred2 = fr2.entity;
    expect(alfred).not.toBeNull();
    expect(fr2.fromCache).toBe(true);
    const fr3 = await em1.fetchEntityByKey(fr2.entityKey, true);

    const alfred3 = fr3.entity;
    // alfred3 should not have been found because it was deleted.
    // null, not undefined: absence is null throughout Breeze, and from 3.0 this result agrees.
    expect(alfred3).toBeNull();
    expect(fr3.fromCache).toBe(true);

    em1.setProperties({ queryOptions: em1.queryOptions.using(MergeStrategy.OverwriteChanges) });

    const fr4 = await em1.fetchEntityByKey(fr3.entityKey, true);
    const alfred4 = fr4.entity;
    expect(alfred4).toBe(alfred);
    expect(fr4.fromCache).toBe(false);
  });


  test("using EntityManager.fetchEntityByKey - cache first not found", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const alfredsID = TestFns.wellKnownData.alfredsID;
    const fr1 = await em1.fetchEntityByKey("Customer", alfredsID, true);
    const alfred = fr1.entity;
    expect(alfred).not.toBeNull();
    expect(fr1.fromCache).toBe(false);
  });

  test("using EntityManager.fetchEntityByKey - missing key", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const alfredsID = '885efa04-cbf2-4dd7-a7de-083ee17b6ad7'; // not a valid key
    const fr1 = await em1.fetchEntityByKey("Customer", alfredsID, true);
    const alfred = fr1.entity;
    expect(alfred).toBeNull();
    expect(fr1.fromCache).toBe(false);
    expect(fr1.entityKey).not.toBeNull();
  });

  // Not an async method
  test("using EntityManager.getEntityByKey", async() => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const query = EntityQuery
      .from("Customers");
    const qr1 = await em1.executeQuery(query);

    const cust1 = qr1.results[0];
    const key = cust1.getProperty(TestFns.wellKnownData.keyNames.customer);
    const cust2 = em1.getEntityByKey("Customer", key);
    expect(cust1).toBe(cust2);
  });

  test("using EntityQuery.fromEntityKey without preexisting metadata", async () => {
    expect.assertions(1);
    const manager = new EntityManager(TestFns.defaultServiceName);

    await manager.fetchMetadata();
    const empType = manager.metadataStore.getAsEntityType("Employee");
    const entityKey = new EntityKey(empType, 1);
    const query = EntityQuery.fromEntityKey(entityKey);
    const qr = await manager.executeQuery(query);

    expect(qr.results.length).toBe(1);
  });

  test("using EntityQuery.fromEntityKey ", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const empType = em.metadataStore.getAsEntityType("Employee");
    const entityKey = new EntityKey(empType, TestFns.wellKnownData.nancyID);
    const query = EntityQuery.fromEntityKey(entityKey);
    const qr1 = await em.executeQuery(query);
    const emp = qr1.results[0];
    expect(emp.getProperty(TestFns.wellKnownData.keyNames.employee)).toBe(TestFns.wellKnownData.nancyID);
  });

  test("using EntityQuery.fromEntityNavigation  - (-> n) ", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const empType = em.metadataStore.getAsEntityType("Employee");
    const orderType = em.metadataStore.getAsEntityType("Order");
    const entityKey = new EntityKey(empType, TestFns.wellKnownData.nancyID);
    const query = EntityQuery.fromEntityKey(entityKey);

    const qr1 = await em.executeQuery(query);
    const emp = qr1.results[0];
    expect(emp.getProperty(TestFns.wellKnownData.keyNames.employee)).toBe(TestFns.wellKnownData.nancyID);
    const np = emp.entityType.getNavigationProperty("orders");
    const q2 = EntityQuery.fromEntityNavigation(emp, np);
    const qr2 = await em.executeQuery(q2);
    expect(qr2.results.length).toBeGreaterThan(0);
    expect(qr2.results.every(r => r.entityType === orderType)).toBe(true);
    const orders = emp.orders;
    expect(orders.length).toBe(qr2.results.length);
  });

  test("using EntityQuery.fromEntityNavigation - (-> 1) ", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const po = Predicate.for(Order);
    const pred = po("customerID", "!=", null).and(po("employeeID", "!=", null));
    const query = EntityQuery.from(Order).where(pred).take(1);
    const qr1 = await em.executeQuery(query);
    const order = qr1.results[0];
    expect(order.entityType.shortName).toBe("Order");
    const np = order.entityType.getNavigationProperty("employee");
    expect(np).toBeTruthy();
    const q2 = EntityQuery.fromEntityNavigation(order, np);
    const qr2 = await em.executeQuery(q2);
    expect(qr2.results.length).toBe(1);
    expect(qr2.results[0].entityType.shortName).toBe("Employee");
  });

  test("using EntityQuery.fromEntities", async () => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .take(2);
    const qr1 = await em.executeQuery(query);
    const orders = qr1.results;
    expect(orders.length).toBe(2);
    const q2 = EntityQuery.fromEntities(orders);
    const qr2 = await q2.execute();
    expect(qr2.results.length).toBe(2);
  });

  test("using EntityAspect.loadNavigationProperty - (-> n) ", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const empType = em.metadataStore.getAsEntityType("Employee");
    const entityKey = new EntityKey(empType, TestFns.wellKnownData.nancyID);
    const query = EntityQuery.fromEntityKey(entityKey);
    
    const qr1 = await em.executeQuery(query);
    const emp = qr1.results[0] as Employee;
    const qr2 = await emp.entityAspect.loadNavigationProperty("orders");
    expect(qr2.results.length).toBeGreaterThan(0);
    expect(qr2.results.every( (r: Entity) => r.entityType.shortName = "Order")).toBe(true);
    const orders = emp.orders;
    expect(orders.length).toBe(qr2.results.length);
  });

  test("using EntityAspect.loadNavigationProperty - (-> 1) ", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const po = Predicate.for(Order);
    const pred = po("customerID", "!=", null).and(po("employeeID", "!=", null));
    const query = EntityQuery.from(Order).where(pred).take(1);
    (em as any)["tag"] = "xxxx";

    const qr1 = await em.executeQuery(query);
    const order = qr1.results[0];
    expect(order.entityType.shortName).toBe("Order");
    const emp = order.employee as Entity;
    expect(emp).toBeNull();
    const qr2 = await order.entityAspect.loadNavigationProperty("employee");
    expect(qr2.results.length).toBe(1);
    expect(qr2.results[0].entityType.shortName).toBe("Employee");
    const sameEmp = order.employee;
    expect(qr2.results[0]).toBe(sameEmp);
    const orders = sameEmp.orders;
    const ix = orders.indexOf(order);
    expect(ix >= 0).toBe(true);
  });

  test("using EntityAspect.isNavigationPropertyLoaded on expand", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer).where("companyName", "startsWith", "An").take(2).expand("orders.orderDetails");
    const qr1 = await em1.executeQuery(query);
    const r = qr1.results;

    expect(r.length).toBe(2);
    r.forEach((cust) => {
      const ordersLoaded = cust.entityAspect.isNavigationPropertyLoaded("orders");
      expect(ordersLoaded).toBe(true);
      const orders = cust.orders as Entity[];
      expect(orders.length).toBeGreaterThan(0);
      orders.forEach((order) => {
        const detailsLoaded = order.entityAspect.isNavigationPropertyLoaded("orderDetails");
        expect(detailsLoaded).toBe(true);
      });
    });
  });

  test("using RelationArray.load from navigationProperty (-> n)", async() => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const empType = em.metadataStore.getAsEntityType("Employee");
    const orderType = em.metadataStore.getAsEntityType("Order");
    const entityKey = new EntityKey(empType, TestFns.wellKnownData.nancyID);
    const query = EntityQuery.fromEntityKey(entityKey);
    const qr1 = await em.executeQuery(query);
    const emp = qr1.results[0];
    const orders = emp.orders as RelationArray;
    expect(orders.length).toBe(0);
    const qr2 = await orders.load();
    expect(qr2.results.length).toBeGreaterThan(0);
    expect(qr2.results.every( r => r.entityType === orderType)).toBe(true);
    expect(orders.length).toBe(qr2.results.length);
  });

  test("using RelationArray.load with uni (1-n) region and territories", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const q = EntityQuery.from(Region)
      .where("regionDescription", "==", "Northern");

    const qr1 = await em1.executeQuery(q);
    expect(em1.hasChanges()).toBe(false);
    expect(em1.getChanges().length).toBe(0);
    const region = qr1.results[0];
    const terrs = region.territories as RelationArray;
    const lr1 = await terrs.load();
    expect(em1.hasChanges()).toBe(false);
    expect(em1.getChanges().length).toBe(0);
    expect(lr1.results.length).toBeGreaterThan(0);
  });


  

  

  
  
});