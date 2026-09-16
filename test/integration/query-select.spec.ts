import { Entity, EntityQuery, EntityType, MetadataStore, Predicate, breeze, MergeStrategy, DataProperty, NavigationProperty, core, QueryOptions, EntityManager, EntityKey, FetchStrategy, EntityState, FilterQueryOp } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, Order, Supplier, UnusualDate, registerModelClasses } from '../model';

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  // Types the queries below; see test/model/README.md. The unregistered default-constructor
  // path has its own coverage in test/unit/unregistered-types.spec.ts.
  registerModelClasses(TestFns.defaultMetadataStore);

});

describe("Query Select clause", () => {

  test("company names of orders with Freight > 500", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    let query = EntityQuery.from(Order)
      .where("freight", FilterQueryOp.GreaterThan, 500)
      .select("customer.companyName")
      .orderBy("customer.companyName");

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);

  });

  test("complex type", async function () {
    expect.hasAssertions();

    const em = TestFns.newEntityManager();

    const query = EntityQuery.from(Supplier)
      .select(TestFns.wellKnownData.keyNames.supplier + ", companyName, location")
      .noTracking();

    const qr1 = await em.executeQuery(query);
    expect(em.metadataStore.isEmpty()).toBe(false);
    expect(qr1.results.length).toBeGreaterThan(0);
    const anons = qr1.results;
    anons.some(function (a) {
      expect(a.companyName).toBeTruthy();
      expect(a.location).toBeTruthy();
      return "city" in a.location;
    });
  });

  test("anon with jra & dateTimes", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const jra = new breeze.JsonResultsAdapter({
      name: "foo",

      visitNode: function (node) {
        if (node.$id) {
          node.CreationDate = breeze.DataType.parseDateFromServer(node.CreationDate);
          const dt = breeze.DataType.parseDateFromServer(node.ModificationDate);
          if (!isNaN(dt.getTime())) {
            node.ModificationDate = dt;
          }
        }
        return null;
      }
    });
    const query = EntityQuery.from(UnusualDate)
      .where("creationDate", "!=", null)
      .select("creationDate, modificationDate")
      .take(3)
      .using(jra);

    const qr1 = await em.executeQuery(query);
    const anons = qr1.results;
    expect(anons.length).toBe(3);
    anons.forEach(function (a) {
      expect(core.isDate(a.creationDate)).toBe(true);
      expect(core.isDate(a.modificationDate) || a.modificationDate == null).toBe(true);
    });

  });

  test("anon simple", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    const query = EntityQuery.from(Customer)
      .where("companyName", "startsWith", "C")
      .select("companyName");
    const queryUrl = query._toUri(em);

    const qr1 = await em.executeQuery(query);
    expect(em.metadataStore.isEmpty()).toBe(false);
    expect(qr1.results.length).toBeGreaterThan(0);
    const anons = qr1.results;
    anons.forEach(function (a) {
      expect(a.companyName).toBeTruthy();
    });
  });


  test("anon collection", async function () {
    expect.hasAssertions();

    const em = TestFns.newEntityManager();
    let query = EntityQuery.from(Customer)
      .where("companyName", "startsWith", "C")
      .select("orders");

    const qr1 = await em.executeQuery(query);
    expect(em.metadataStore.isEmpty()).toBe(false);
    const orderType = em.metadataStore.getAsEntityType("Order");
    expect(qr1).toBeTruthy();
    expect(qr1.results.length).toBeGreaterThan(0);
    const anons = qr1.results;
    anons.forEach(function (a) {
      expect(Array.isArray(a.orders)).toBe(true);
      a.orders.forEach((order: Entity) => {
        expect(order.entityType).toBe(orderType);
      });
    });
  });


  test("anon simple, entity collection projection", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    let query = EntityQuery.from(Customer)
      .where("companyName", "startsWith", "C")
      .orderBy("companyName")
      // .select(["companyName", "city", "orders"]) // also works
      .select("companyName, city, orders");

    // expand is neither needed nor allowed here: the select already returns the orders.

    const qr1 = await em.executeQuery(query);
    expect(em.metadataStore.isEmpty()).toBe(false);
    const orderType = em.metadataStore.getAsEntityType("Order");
    expect(qr1).toBeTruthy();
    expect(qr1.results.length).toBeGreaterThan(0);
    const anons = qr1.results;
    anons.forEach(function (a) {
      expect(Object.keys(a).length).toBe(3);
      expect(a.companyName).toBeTruthy();
      expect(Array.isArray(a.orders)).toBe(true);
      a.orders.forEach((order: Entity) => {
        expect(order.entityType).toBe(orderType);
      });
    });
  });


  test("anon simple, entity scalar projection", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    let query = EntityQuery
      .from("Orders")
      .where("customer.companyName", "startsWith", "C")
      .orderBy("customer.companyName");
    query = query.select("customer.companyName, customer, orderDate");
    const qr1 = await em.executeQuery(query);
    expect(em.metadataStore.isEmpty()).toBe(false);
    const customerType = em.metadataStore.getAsEntityType("Customer");
    expect(qr1).toBeTruthy();
    expect(qr1.results.length).toBeGreaterThan(0);
    const anons = qr1.results;
    anons.forEach(function (a) {

      expect(Object.keys(a).length).toBe(3);
      expect(typeof (a.customer_CompanyName)).toBe('string');

      expect(a.customer.entityType).toBe(customerType);
      expect(a.orderDate).not.toBeUndefined();
    });
  });


  test("anon two props", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery
      .from("Products")
      .where("category.categoryName", "startswith", "S")
      .select("productID, productName");

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });


  test("with expand should fail with good msg", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery
      .from("Products")
      .where("category.categoryName", "startswith", "S")
      .expand("category")
      .select(TestFns.wellKnownData.keyNames.product + ", productName");

    try {
      const qr1 = await em.executeQuery(query);
      throw new Error('should not get here');
    } catch (e) {
      expect(e.message).toMatch(/Unable to cast/);
    }
  });



});