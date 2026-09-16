import { Entity, EntityQuery, EntityType, MetadataStore, Predicate, breeze, MergeStrategy, DataProperty, NavigationProperty, core } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, Employee, Order, registerModelClasses } from '../model';

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  // Types the queries below; see test/model/README.md. The unregistered default-constructor
  // path has its own coverage in test/unit/unregistered-types.spec.ts.
  registerModelClasses(TestFns.defaultMetadataStore);

});

describe("Query Functions", () => {

  beforeEach(function () {

  });


  test("function expr - date(year) function", async () => {
    expect.assertions(2);
    const em1 = TestFns.newEntityManager();
    const query = EntityQuery
      .from("Employees")
      .where("year(hireDate)", ">", 1993);
    const qr1 = await em1.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
    const emps2 = em1.executeQueryLocally(query);
    expect(emps2.length).toBe(qr1.results.length);
  });

  test("function expr - date(month) function", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const pe = Predicate.for(Employee);
    const p = pe("month(hireDate)", ">", 6).and(pe("month(hireDate)", "<", 11));
    const query = EntityQuery
      .from("Employees")
      .where(p);

    const qr1 = await em1.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
    const emps2 = em1.executeQueryLocally(query);
    expect(emps2.length).toBe(qr1.results.length);
  });

  test("function expr - date(hour) function", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    const po = Predicate.for(Order);
    const p = po("hour(shippedDate)", ">", 10).and(po("hour(shippedDate)", "<", 22));
    const query = EntityQuery
      .from("Orders")
      .where(p);
    // Note that server may interpret hour as UTC hour, while client uses local time.
    const qr1 = await em1.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
    const emps2 = em1.executeQueryLocally(query);
    expect(emps2.length).toBe(qr1.results.length);
  });

  test("function expr - toLower", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      // .where("toLower(companyName)", "startsWith", "c");
      .where({ "toLower(companyName)": { startsWith: "C" } });
    const qr1 = await em.executeQuery(query);
    const custs = qr1.results;
    expect(custs.length).toBeGreaterThan(0);
    const isOk = custs.every(function (cust) {
      const name = cust.companyName.toLowerCase();
      return core.stringStartsWith(name, "c");
    });
    expect(isOk).toBe(true);
  });


  test("function expr - toUpper/substring", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("toUpper(substring(companyName, 1, 2))", "startsWith", "OM");
    const qr1 = await em.executeQuery(query);
    const custs = qr1.results;
    expect(custs.length).toBeGreaterThan(0);
    const isOk = custs.every(function (cust) {
      const val = cust.companyName.substr(1, 2).toUpperCase();
      return val === "OM";
    });
    expect(isOk).toBe(true);
  });


  test("function expr - length", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("length(contactTitle)", ">", 17);
    const qr1 = await em.executeQuery(query);
    const custs = qr1.results;
    expect(custs.length).toBeGreaterThan(0);
    const isOk = custs.every(function (cust) {
      const val = cust.contactTitle;
      return val.length > 17;
    });
    expect(isOk).toBe(true);
  });


  test("function expr - navigation then length", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .where("length(customer.companyName)", ">", 30)
      .expand("customer");
    const qr1 = await em.executeQuery(query);
    const orders = qr1.results;
    expect(orders.length).toBeGreaterThan(0);
    const isOk = orders.every(function (order) {
      const cust = order.customer;
      const val = cust.companyName;
      return val.length > 30;
    });
    expect(isOk).toBe(true);
  });


  test("bad query function expr -  bad property name", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .where("length(customer.fooName)", ">", 30);
    try {
      const data = await em.executeQuery(query);
      throw new Error("should not get here");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(error.message.indexOf("fooName") > 0).toBe(true);
      error.handled = true;
    }
  });



});
