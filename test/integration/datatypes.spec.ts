import { Entity, EntityQuery, EntityType, MetadataStore, Predicate, breeze, MergeStrategy, DataProperty, NavigationProperty, core, QueryOptions, EntityManager, EntityKey, FetchStrategy, EntityState, FilterQueryOp, DataType } from '../../src/breeze';
import { TestFns, skipDescribeIf } from '../test-fns';
import { Comment, Customer, Employee, Order, Product, Role, TimeLimit, UnusualDate, User, registerModelClasses } from '../model';

function ok(a: any, b?: any) {
  throw new Error('for test conversion purposes');
}

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  // Types the calls below; see test/model/README.md. The unregistered default-constructor
  // path has its own coverage in test/unit/unregistered-types.spec.ts.
  registerModelClasses(TestFns.defaultMetadataStore);

});

describe("Unusual Datatypes", () => {


  test("byte w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const dt = new Date();
    dt.setUTCMilliseconds(100);
    let c1 = em.createEntity(Comment, { createdOn: dt, seqNum: 11, comment1: "now is the time for" });
    c1 = em.createEntity(Comment, { createdOn: dt, seqNum: '7', comment1: "foo" });

    const sr = await em.saveChanges();
    const comments = sr.entities;
    expect(comments.length).toBe(2);
    const em2 = TestFns.newEntityManager();
    const pred2 = Predicate.create("createdOn", "==", dt).and("seqNum", "==", 11);
    const q2 = EntityQuery.from(Comment).where(pred2);
    const qr2 = await em2.executeQuery(q2);
    const comments2 = qr2.results;
    expect(comments2.length).toBe(1);
    const em3 = TestFns.newEntityManager();
    const pred3 = Predicate.create("createdOn", "==", dt).and("seqNum", "==", '7');
    const q3 = EntityQuery.from(Comment).where(pred3);
    const qr3 = await em3.executeQuery(q3);
    const comments3 = qr3.results;
    expect(comments3.length).toBe(1);
  });

  test("dateTime w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(User).take(1);
    const qr1 = await em.executeQuery(query);
    const user = qr1.results[0];
    const oldDate = user.modifiedDate;
    const modDate = new Date(oldDate.getTime() + 10000);
    user.modifiedDate = modDate;
    const sr = await em.saveChanges();
    const r = sr.entities;
    expect(r.length).toBe(1);
    const user2 = r[0];
    const q = EntityQuery.fromEntities(user2);
    const em2 = TestFns.newEntityManager();
    const qr2 = await em2.executeQuery(q);
    const user3 = qr2.results[0];
    const modDate3 = user3.modifiedDate;
    expect(modDate.getTime()).toBe(modDate3.getTime());
  });

  test("datatype coercion - null strings to empty strings", function () {
    const em = TestFns.newEntityManager(); // new empty EntityManager
    const oldParseFn = DataType.String.parse;
    const newParseFn = function (source: any, sourceTypeName: string) {
      if (source == null) {
        return "";
      } else if (sourceTypeName === "string") {
        return source.trim();
      } else {
        return source.toString();
      }
    };
    DataType.String.parse = newParseFn;
    try {
      const aType = em.metadataStore.getAsEntityType("Customer");
      // OrderID, UnitPrice, Discount
      const inst = aType.createEntity();

      inst.companyName = null;
      let val = inst.companyName;
      expect(val).toBe("");

      inst.companyName = undefined;
      val = inst.companyName;
      expect(val).toBe("");

      inst.companyName = "    now is the time    ";
      val = inst.companyName;
      expect(val).toBe("now is the time");
    } finally {
      DataType.String.parse = oldParseFn;
    }
  });




  test("nullable dateTime", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const emp = em.createEntity(Employee, { firstName: "Joe", lastName: "Smith" });
    expect(emp.entityAspect.entityState).toBe(EntityState.Added);
    const birthDate = emp.birthDate;
    expect(birthDate).toBeNull;
    // Save it: every employee in the pristine data has a birth date, so without this the
    // query only found rows other spec files had inserted.
    await em.saveChanges();

    const q = EntityQuery.from(Employee).where("birthDate", "==", null);

    const qr1 = await em.executeQuery(q);
    const empsWithNullBirthDates = qr1.results;
    expect(empsWithNullBirthDates.length).toBeGreaterThan(0);
    empsWithNullBirthDates.forEach(function (emp1) {
      const birthDate1 = emp1.birthDate;
      expect(birthDate1).toBeNull;
    });
  });

  test("dateTime w/invalid value", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(User).take(1);

    try {
      const data = await em.executeQuery(query);
      const user = data.results[0];
      const oldDate = user.modifiedDate;
      // Deliberately an invalid value, to prove the save is rejected. The generated class types
      // this as a Date, so it goes through setProperty - which is what the test always meant.
      user.setProperty("modifiedDate", "whatever");
      const sr = await em.saveChanges();
      throw new Error('should not get here');
    } catch (err) {
      expect(err.message).toEqual("Client side validation errors encountered - see the entityErrors collection on this object for more detail");
    }
  });

  test("dateTimeOffset w/invalid value", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(UnusualDate).take(1);

    try {
      const data = await em.executeQuery(query);
      const ud = data.results[0];
      const oldDate = ud.creationDate;
      // Deliberately an invalid value, to prove the save is rejected. The generated class types
      // this as a Date, so it goes through setProperty - which is what the test always meant.
      ud.setProperty("creationDate", "whatever");
      const sr = await em.saveChanges();
      throw new Error('should not get here');
    } catch (err) {
      expect(err.message).toEqual("Client side validation errors encountered - see the entityErrors collection on this object for more detail");
    }
  });

  test("dateOnly w/invalid value", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(UnusualDate).take(1);

    try {
      const data = await em.executeQuery(query);
      const ud = data.results[0];
      const oldDate = ud.dateOnly;
      // Deliberately an invalid value, to prove the save is rejected. The generated class types
      // this as a Date, so it goes through setProperty - which is what the test always meant.
      ud.setProperty("dateOnly", "whatever");
      expect(ud.dateOnly).toEqual("whatever");
      const sr = await em.saveChanges();
      throw new Error('should not get here');
    } catch (err) {
      // expect(err.message).toEqual("Client side validation errors encountered - see the entityErrors collection on this object for more detail");
      expect(err.message).toInclude("Error converting value");
    }
  });

  test("dateTimeOffset & dateTime2 w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(UnusualDate).take(10);
    const tlimitType = em.metadataStore.getAsEntityType("UnusualDate");
    const crtnDt0 = new Date(2001, 1, 1, 1, 1, 1, 135);
    const modDt0 = new Date(2002, 2, 2, 2, 2, 2, 246);
    const crtnDt2 = new Date(2003, 3, 3, 3, 3, 3, 345);
    const modDt2 = new Date(2004, 4, 4, 4, 4, 4, 456);
    const tlimit = tlimitType.createEntity();
    tlimit.creationDate = crtnDt0;
    tlimit.modificationDate = modDt0;
    em.addEntity(tlimit);

    const sr0 = await em.saveChanges();
    const sr0Ents = sr0.entities;
    expect(sr0Ents.length).toBe(1);
    const tlimit2 = sr0Ents[0];
    const q = EntityQuery.fromEntities(tlimit2);
    const qr1 = await em.executeQuery(q);
    const r1 = qr1.results;
    const tlimit1 = r1[0];
    const crtnDt1 = tlimit1.creationDate;
    const modDt1 = tlimit1.modificationDate;
    expect(crtnDt1.getTime()).toBe(crtnDt0.getTime());
    expect(modDt1.getTime()).toBe(modDt0.getTime());
    // change and save again
    tlimit1.creationDate = crtnDt2;
    tlimit1.modificationDate = modDt2;
    tlimit1.entityAspect.originalValues.creationDate = "2001-02-01T09:01:01.135456+03:15";
    tlimit1.entityAspect.setDeleted();
    const sr1 = await em.saveChanges();
    const sr1Ents = sr1.entities;
    const tlimit3 = sr1Ents[0] as UnusualDate;
    const crtnDt3 = tlimit3.creationDate;
    const modDt3 = tlimit3.modificationDate;
    expect(crtnDt3.getTime()).toBe(crtnDt2.getTime());
    expect(modDt3.getTime()).toBe(modDt2.getTime());

  });

  test("dateOnly & timeOnly w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(UnusualDate).take(10);
    const tlimitType = em.metadataStore.getAsEntityType("UnusualDate");
    const date0 = new Date(2001, 1, 1);
    const time0 = "01:23:45.678"; // TODO TimeOnly type is string on client, for now
    const date2 = new Date(2003, 3, 3);
    const time2 = "13:45:59.000";
    const tlimit = tlimitType.createEntity();
    tlimit.dateOnly = date0;
    tlimit.timeOnly = time0;
    em.addEntity(tlimit);

    const sr0 = await em.saveChanges();
    const sr0Ents = sr0.entities;
    expect(sr0Ents.length).toBe(1);
    const tlimit2 = sr0Ents[0];
    const q = EntityQuery.fromEntities(tlimit2);
    const qr1 = await em.executeQuery(q);
    const r1 = qr1.results;
    const tlimit1 = r1[0];
    const date1 = tlimit1.dateOnly;
    const time1 = tlimit1.timeOnly;
    expect(date1.getTime()).toBe(date0.getTime());
    expect(time1).toEqual(time0);
    // change and save again
    tlimit1.dateOnly = date2;
    tlimit1.timeOnly = time2;
    tlimit1.entityAspect.originalValues.dateOnly = "2001-02-01";
    tlimit1.entityAspect.setDeleted();
    const sr1 = await em.saveChanges();
    const sr1Ents = sr1.entities;
    const tlimit3 = sr1Ents[0] as UnusualDate;
    const crtnDt3 = tlimit3.dateOnly;
    const modDt3 = tlimit3.timeOnly;
    expect(crtnDt3.getTime()).toBe(date2.getTime());
    expect(modDt3).toEqual(time2);

  });

  test("where dateTimeOffset & dateTime2", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const dt1 = new Date(1950, 1, 1, 1, 1, 1);
    const p1 = Predicate.create("creationDate", ">", dt1).or("modificationDate", ">", dt1);
    const query = EntityQuery.from(UnusualDate).where(p1);
    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("where dateOnly & timeOnly", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const dt1 = new Date(2001, 1, 1); // 2001-02-01
    const tm1 = "01:23:45.678";
    const p1 = Predicate.create("dateOnly", "==", dt1).or("timeOnly", "==", tm1);
    const query = EntityQuery.from(UnusualDate).where(p1);
    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("export/import dateTimeOffset with nulls", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const p1 = Predicate.create("modificationDate2", "==", null);
    const query = EntityQuery.from(UnusualDate).where(p1).take(2);
    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBe(2);

    const exportedEntities = em.exportEntities();
    const em2 = TestFns.newEntityManager();
    em2.importEntities(exportedEntities);
    const tls = em2.getEntities(UnusualDate);
    const isOk = tls.every(function (tl) {
      const modDt = tl.modificationDate2;
      return modDt == null;
    });
    expect(isOk).toBe(true);
  });

  test("time w/save", async function () {
    expect.hasAssertions();
    const duration = "PT7H17M40S";
    const sDuration = core.durationToSeconds(duration);
    const defaultMs = await TestFns.initDefaultMetadataStore();
    const newMs = MetadataStore.importMetadata(defaultMs.exportMetadata());

    const tlimitType = newMs.getAsEntityType("TimeLimit");
    core.arrayRemoveItem(tlimitType.dataProperties, dp => dp.dataType === DataType.Undefined);

    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(TimeLimit).take(10);
    const qr1 = await em.executeQuery(query);

    const results = qr1.results;
    const maxTime = results[0].maxTime;
    expect(maxTime).toBeTruthy();
    const tlimitType1 = em.metadataStore.getAsEntityType("TimeLimit");
    const tlimit = tlimitType1.createEntity();
    tlimit.maxTime = duration;
    em.addEntity(tlimit);
    // check to insure that the default TimeSpan of 0 is used.
    const tlimit2 = tlimitType1.createEntity();
    tlimit2.minTime = "PT20H20M20S";
    let zeroTime = tlimit2.maxTime;
    em.addEntity(tlimit2);
    const sr = await em.saveChanges();

    const ents = sr.entities;
    expect(ents.length).toBe(2);
    const maxTime1 = tlimit.maxTime;
    const sMaxTime = core.durationToSeconds(maxTime1);
    expect(sMaxTime).toBe(sDuration);
    zeroTime = tlimit2.maxTime;
    const q2 = EntityQuery.fromEntities([tlimit, tlimit2]).orderBy("minTime");
    const em2 = TestFns.newEntityManager();
    const qr2 = await em2.executeQuery(q2);

    const r2 = qr2.results;
    expect(r2.length).toBe(2);
    const tl1 = r2[0];
    const tl2 = r2[1];
    const maxTime2 = tl1.maxTime;
    const sMaxTime2 = core.durationToSeconds(maxTime2);
    expect(sMaxTime2).toBe(sDuration);
    const minTime = tlimit.minTime;
    expect(minTime == null).toBe(true);

  });

  test("time 2", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(TimeLimit).where("maxTime", ">", "PT4H").take(10);
    const fourHrs = core.durationToSeconds("PT4H");

    const qr1 = await em.executeQuery(query);
    const results = qr1.results;
    results.forEach(function (tlimit) {
      const maxTime = tlimit.maxTime;
      const maxSecs = core.durationToSeconds(maxTime);
      expect(maxSecs).toBeGreaterThan(fourHrs);
    });
  });

  test("time not null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(TimeLimit).where("minTime", "!=", null).take(10);
    const qr1 = await em.executeQuery(query);
    const results = qr1.results;
    expect(results.length).toBeGreaterThan(0);
    results.forEach(function (tlimit) {
      const minTime = tlimit.minTime;
      expect(minTime).toBeTruthy();
    });
  });

  test("bad time", function () {

    const em = TestFns.newEntityManager();
    const tlimitType = em.metadataStore.getAsEntityType("TimeLimit");
    const tlimit = tlimitType.createEntity();
    em.attachEntity(tlimit);

    tlimit.maxTime = "3:15";
    let valErrs = tlimit.entityAspect.getValidationErrors();
    expect(valErrs[0].errorMessage.indexOf("maxTime") > 0).toBe(true);

    tlimit.maxTime = "PT4M";
    valErrs = tlimit.entityAspect.getValidationErrors();
    expect(valErrs.length).toBe(0);
  });

  test("timestamp w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Role).take(10);


    const data = await em.executeQuery(query);
    const results = data.results;
    const roleType = em.metadataStore.getAsEntityType("Role");
    const role = roleType.createEntity();
    role.name = "test1";
    role.description = "descr 1";
    em.addEntity(role);
    const sr = await em.saveChanges();
    const ents = sr.entities;
    expect(ents.length).toBe(1);
    const ts = role.ts;
    expect(ts).toBeTruthy();
  });

  test("enum query on Role", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Role).using(em);
    const qr1 = await query.execute();
    let roles = qr1.results;
    expect(roles.length).toBeGreaterThan(1);
    const query2 = query.expand("userRoles");
    const qr2 = await query2.execute();
    roles = qr2.results;
    const isOk = roles.some(role => role.userRoles.length > 0);
    expect(isOk).toBe(true);
  });

  test("enum query filter on Role", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Role).where("roleType", "==", 'Restricted');
    const roleType = em.metadataStore.getAsEntityType("Role");
    const qr1 = await em.executeQuery(query);
    const roles = qr1.results;
    expect(roles.length).toBeGreaterThan(1);
    const isOk = roles.every(r => r.roleType === "Restricted");
    expect(isOk).toBe(true);
  });

  test("enums w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Role).where("roleType", "==", 'Restricted');
    const roleType = em.metadataStore.getAsEntityType("Role");
    const qr1 = await em.executeQuery(query);

    expect(qr1.results.length).toBeGreaterThan(1);
    let role = roleType.createEntity();
    role.name = "test1";
    role.description = "descr 1";
    role.roleType = 'Standard';
    em.addEntity(role);
    const sr = await em.saveChanges();
    const ents = sr.entities;
    expect(ents.length).toBe(1);
    role = ents[0];
    let rt = role.roleType;
    expect(rt).toBe('Standard');
    const q = EntityQuery.fromEntities(ents);
    const em2 = TestFns.newEntityManager();
    const qr2 = await em2.executeQuery(q);
    const r2 = qr2.results;
    expect(r2.length).toBe(1);
    role = r2[0];
    rt = role.roleType;
    expect(rt).toBe('Standard');
  });

  test("enums null - w/save", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const roleType = em.metadataStore.getAsEntityType("Role");
    let role = roleType.createEntity();
    role.name = "test1";
    role.description = "descr 1";
    role.roleType = null;
    em.addEntity(role);

    const sr = await em.saveChanges();
    const ents = sr.entities;
    expect(ents.length).toBe(1);
    role = ents[0];
    let rt = role.roleType;
    expect(rt == null).toBe(true);

    let q2 = EntityQuery.fromEntities(ents);
    q2 = q2.where("roleType", "==", null);
    const em2 = TestFns.newEntityManager();
    const qr2 = await em2.executeQuery(q2);

    const r2 = qr2.results;
    expect(r2.length).toBe(1);
    role = r2[0];
    rt = role.roleType;
    expect(rt == null).toBeTruthy();
  });

  test("enums change value, detect on server", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const roleType = em.metadataStore.getAsEntityType("Role");
    let role = roleType.createEntity();
    role.name = "test2";
    role.description = null;
    role.roleType = null;
    em.addEntity(role);
    const sr1 = await em.saveChanges();

    const ents = sr1.entities;
    expect(ents.length).toBe(1);
    role = ents[0];
    let rt = role.roleType;
    expect(rt == null).toBe(true);
    const desc = role.description;
    expect(desc == null).toBe(true);
    role.description = "descr 2";
    role.roleType = "Standard";
    const sr2 = await em.saveChanges();
    const ents2 = sr2.entities;
    expect(ents2.length).toBe(1);
    role = ents2[0];
    rt = role.roleType;
    expect(rt).toBe("Standard");
    role.roleType = "Restricted";
    const sr3 = await em.saveChanges();
    const ents3 = sr3.entities;
    expect(ents3.length).toBe(1);
    role = ents3[0];
    rt = role.roleType;
    expect(rt).toBe("Restricted");
    role.roleType = "Admin";
    const sr4 = await em.saveChanges();
    const ents4 = sr4.entities;
    expect(ents4.length).toBe(1);
    role = ents4[0];
    rt = role.roleType;
    expect(rt).toBe("Admin");
  });

  test("nullable int", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("rowVersion", "==", 1)
      .take(10);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("nullable int == null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("rowVersion", "==", null)
      .take(10);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });


  test("nullable date", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .where("orderDate", ">", new Date(1998, 1, 1))
      .take(10);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("nullable date == null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .where("shippedDate", "==", null)
      .take(10);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  // we don't have a nullable book in NorthwindIB
  test("bool", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const discPropName = "discontinued";
    const query = EntityQuery.from(Product)
      .where(discPropName, "==", true)
      .take(10);

    const qr1 = await em.executeQuery(query);
    const products = qr1.results;
    expect(qr1.results.length).toBeGreaterThan(0);
    expect(products.every(p => p.getProperty(discPropName) === true)).toBe(true);
  });

  test("nonnullable bool == null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const discPropName = "discontinued";
    const query = EntityQuery.from(Product)
      .where(discPropName, "==", null)
      .take(30);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBe(0);
  });

  test("nullable guid", async function () {
    expect.hasAssertions();
    // ID of the Northwind "Alfreds Futterkiste" customer
    const alfredsID = '785efa04-cbf2-4dd7-a7de-083ee17b6ad2';
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Order)
      .where("customerID", "==", alfredsID);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("nullable guid == null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    // Northwind ships no order without a customer. This test used to depend on some
    // other spec file having created one, which made it order-dependent. Create it.
    em.createEntity(Order, { shipName: "Test order with no customer" });
    await em.saveChanges();

    const query = EntityQuery.from(Order)
      .where("customerID", "==", null)
      .take(10);

    const qr1 = await em.executeQuery(query);
    expect(qr1.results.length).toBeGreaterThan(0);
  });

  test("string equals null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const query = EntityQuery.from(Customer)
      .where("region", FilterQueryOp.Equals, null)
      .take(20);

    const qr1 = await em.executeQuery(query);
    const customers = qr1.results;
    expect(customers.length).toBeGreaterThan(0);
    customers.forEach(function (customer) {
      const region = customer.region;
      expect(region == null).toBe(true);
    });
  });

  test("string not equals null", async function () {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    const query = EntityQuery.from(Customer)
      .where("region", FilterQueryOp.NotEquals, null)
      .take(10);

    const qr1 = await em.executeQuery(query);
    const customers = qr1.results;
    expect(customers.length).toBeGreaterThan(0);
    customers.forEach(function (customer) {
      const region = customer.region;
      expect(region != null).toBe(true);
    });
  });

  test("datatype coercion - date", function () {
    const em = TestFns.newEntityManager(); // new empty EntityManager
    const userType = em.metadataStore.getAsEntityType("User");

    const user = userType.createEntity();
    const dt = new Date(2000, 2, 15); // 2 => 3 below because date ctor is 0 origin on months.
    user.createdDate = "3/15/2000";
    const sameDt = user.createdDate;
    expect(dt.getTime()).toBe(sameDt.getTime());
    user.modifiedDate = dt.getTime();
    const sameDt2 = user.modifiedDate;
    expect(dt.getTime()).toBe(sameDt2.getTime());
  });


  test("datatype coercion - integer", function () {
    const em = TestFns.newEntityManager(); // new empty EntityManager
    const odType = em.metadataStore.getAsEntityType("OrderDetail");
    // OrderID, UnitPrice, Discount
    const od = odType.createEntity();

    od.orderID = "3.4";
    let val = od.orderID;
    expect(val).toBe(3);

    od.orderID = 3.4;
    val = od.orderID;
    expect(val).toBe(3);
  });


  test("datatype coercion - decimal", function () {
    const em = TestFns.newEntityManager(); // new empty EntityManager
    const odType = em.metadataStore.getAsEntityType("OrderDetail");
    // OrderID, UnitPrice, Discount
    const od = odType.createEntity();
    od.unitPrice = "3.4";
    let val = od.unitPrice;
    expect(val).toBe(3.4);
    od.unitPrice = "3";
    val = od.unitPrice;
    expect(val).toBe(3);

    od.unitPrice = 3.4;
    val = od.unitPrice;
    expect(val).toBe(3.4);
  });

  test("datatype coercion - float", function () {
    const em = TestFns.newEntityManager(); // new empty EntityManager
    const odType = em.metadataStore.getAsEntityType("OrderDetail");
    // OrderID, UnitPrice, Discount
    const od = odType.createEntity();
    od.discount = "3.4";
    let val = od.discount;
    expect(val).toBe(3.4);

    od.discount = "3";
    val = od.discount;
    expect(val).toBe(3);

    od.discount = 3.4;
    val = od.discount;
    expect(val).toBe(3.4);
  });

  test("datatype fromValue - Guid", () => {
    expect(DataType.fromValue("foo")).toBe(DataType.String);
    expect(DataType.fromValue("f16fb858-1e02-46fb-8467-a5fb45a7067f")).toBe(
      DataType.Guid
    );
    expect(DataType.fromValue("foo-f16fb858-1e02-46fb-8467-a5fb45a7067f")).toBe(
      DataType.String
    );
  });

});
