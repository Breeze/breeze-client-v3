import { EntityQuery, EntityState, SaveOptions } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Order, registerModelClasses } from '../model';

// The test host maps SQL Server duplicate-key and foreign-key violations to 409 Conflict, by way of
//   GlobalExceptionFilter.StatusCodeForException = DbExceptionMappers.SqlServer
// in Startup. Without that mapping these come back as a blanket 500.
//
// This exercises the whole chain: the save reaches SQL Server, the provider raises error 547, EF
// Core wraps it in a DbUpdateException, the mapper finds the SqlException through
// GetBaseException(), the filter turns it into an RFC 9457 problem document, and the client reads
// the status and message back off that document.
//
// Note that a duplicate *primary* key is no good as a probe here: Customer's key is generated on
// the client and remapped by the server, so a colliding insert never reaches the database.

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  registerModelClasses(TestFns.defaultMetadataStore);
});

describe("Save conflicts", () => {

  test("a foreign key violation is 409 Conflict, not 500", async () => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    // An Order whose customerID matches no Customer.
    em.createEntity(Order, { customerID: '00000000-0000-0000-0000-000000000009' }, EntityState.Added);

    try {
      await em.saveChanges();
      throw new Error("the save should have failed on the foreign key");
    } catch (e: any) {
      expect(e.status).toBe(409);
      expect(e.message).toMatch(/FOREIGN KEY constraint/i);
    }
  });

  test("an ordinary server exception is still 500", async () => {
    // The mapper returns null for anything it does not recognize, and the filter then falls back to
    // its default - so adding the mapper does not reclassify unrelated failures.
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const data = await EntityQuery.from(Order).take(1).using(em).execute();
    data.results[0].freight = (data.results[0].freight ?? 0) + 0.5;

    try {
      await em.saveChanges(null, new SaveOptions({ resourceName: "SaveAndThrow", tag: "SaveAndThrow" }));
      throw new Error("the save should have failed");
    } catch (e: any) {
      expect(e.status).toBe(500);
    }
  });

});
