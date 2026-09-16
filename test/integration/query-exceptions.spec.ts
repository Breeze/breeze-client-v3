import { Entity, EntityQuery, EntityType, MetadataStore, Predicate, breeze, MergeStrategy, DataProperty, NavigationProperty, core, QueryOptions, FilterQueryOp } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, Employee, registerModelClasses } from '../model';

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  // Types the queries below; see test/model/README.md. The unregistered default-constructor
  // path has its own coverage in test/unit/unregistered-types.spec.ts.
  registerModelClasses(TestFns.defaultMetadataStore);

});

describe("Entity Query Exceptions", () => {

  beforeEach(function () {

  });

  test("query with bad resourceName", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    try {
      const qr1 = await EntityQuery.from("EntityThatDoesnotExist")
        .using(em1)
        .execute();
      throw new Error('should not get here');
    } catch (e) {
      expect(e.status).toBe(404);
    }
  });

  test("where with bad filter operator", function () {
    expect.hasAssertions();
    try {
      const query = EntityQuery.from(Customer)
        // @ts-expect-error - the point of the test. The name is wrong, and a query built from a
        // constructor now catches that at compile time as well. The runtime assertion below still
        // matters: it is what a plain-JavaScript caller, or a query built from a string, gets.
        .where("companyName", "startsXWith", "C");
      throw new Error("shouldn't get here");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(error.message.indexOf("startsXWith") > 0).toBe(true);
    }
  });

  test("where with bad field name", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      // @ts-expect-error - the point of the test. The name is wrong, and a query built from a
      // constructor now catches that at compile time as well. The runtime assertion below still
      // matters: it is what a plain-JavaScript caller, or a query built from a string, gets.
      .where("badCompanyName", "startsWith", "C");
    try {
      await em.executeQuery(query);
      throw new Error("shouldn't get here");
    }
    catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(error.message.indexOf("badCompanyName") > 0).toBe(true);
      error.handled = true;
    }

  });

  test("where with bad orderBy property ", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("companyName", FilterQueryOp.StartsWith, "C")
      // @ts-expect-error - the point of the test. The name is wrong, and a query built from a
      // constructor now catches that at compile time as well. The runtime assertion below still
      // matters: it is what a plain-JavaScript caller, or a query built from a string, gets.
      .orderBy("badCompanyName");
    try {
      await em.executeQuery(query);
      throw new Error("shouldn't get here");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(error.message.indexOf("badCompanyName") > 0).toBe(true);
      error.handled = true;
    }
  });

  test("where with bad criteria", async () => {
    expect.assertions(1);
    const em1 = TestFns.newEntityManager();
    const query = EntityQuery.from(Employee)
      // @ts-expect-error - the point of the test. The name is wrong, and a query built from a
      // constructor now catches that at compile time as well. The runtime assertion below still
      // matters: it is what a plain-JavaScript caller, or a query built from a string, gets.
      .where("badPropName", "==", "7");
    try {
      const qr = await em1.executeQuery(query);
      throw new Error('should have thrown an error');
    } catch {
      expect(true).toBe(true);
    }
  });

  test("where with bad criteria - 2", async () => {
    expect.assertions(1);
    const em1 = TestFns.newEntityManager();
    const query = new EntityQuery()
      .from("AltCustomers")
      .where("xxxx", "<", 7);
    try {
      const qr = await em1.executeQuery(query);
      throw new Error('should have thrown an error');
    } catch {
      expect(true).toBe(true);
    }
  });

  test("fetchEntityByKey with bad args", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    try {
      await em1.fetchEntityByKey("Customer" as any);
      throw new Error('should not get here');
    } catch (e) {
      const foo = e;
      expect(e.message.indexOf("EntityKey") >= 0).toBe(true);
    }
  });

  test("query with bad resource name combined with 'startsWith P'", async () => {
    expect.hasAssertions();
    const em1 = TestFns.newEntityManager();
    // we intentionally mispelled the resource name to cause the query to fail
    const query = EntityQuery.from("Customer").where("companyName", "startsWith", "P");

    try {
      const qr1 = await em1.executeQuery(query);
      throw new Error('should not get here');
    } catch (error) {
      expect(error.status).toBe(404);
    }
  });

  test("queryOptions errors", () => {
    expect.assertions(3);
    const qo = new QueryOptions();
    try {
      qo.using(true as any);
      throw new Error("should not get here-not a config");
    } catch (e) {
      expect(true).toBe(true);
    }

    try {
      qo.using({ mergeStrategy: 6 } as any);
      throw new Error("should not get here, bad mergeStrategy");
    } catch (e) {
      expect(true).toBe(true);
    }

    try {
      qo.using({ mergeStrategy: MergeStrategy.OverwriteChanges, foo: "huh" } as any);
      throw new Error("should not get here, unknown property in config");
    } catch (e) {
      expect(true).toBe(true);
    }

  });


});