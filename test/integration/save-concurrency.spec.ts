import { EntityQuery, MergeStrategy, isConcurrencyError, ProblemTypes } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, registerModelClasses } from '../model';

// An optimistic concurrency conflict is the one save failure a client is expected to recover from
// rather than report, so it has to be identifiable without guessing. These tests drive a real
// conflict through SQL Server, EF Core, the server's ConcurrencyErrorsException and the filter,
// and check what the client is left holding.
//
// Customer.rowVersion is the concurrency property (concurrencyMode "Fixed" in the metadata, and
// [ConcurrencyCheck] on the server model). Breeze bumps it before sending and keeps the value it
// read in originalValues, which is what EF Core puts in the UPDATE's WHERE clause - so a second
// manager saving from a stale read matches no rows.

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  registerModelClasses(TestFns.defaultMetadataStore);
});

/** Insert a customer of our own, then read it into two managers that do not know about each other. */
async function twoStaleReaders() {
  const setup = TestFns.newEntityManager();
  const created = setup.createEntity(Customer, { companyName: 'Conflict ' + Date.now() });
  await setup.saveChanges();
  const customerID = created.customerID;

  const q = EntityQuery.from(Customer).where('customerID', 'eq', customerID);
  const em1 = TestFns.newEntityManager();
  const em2 = TestFns.newEntityManager();
  const c1 = (await q.using(em1).execute()).results[0];
  const c2 = (await q.using(em2).execute()).results[0];
  return { customerID, em1, em2, c1, c2, q };
}

describe("Save concurrency", () => {

  test("a stale save is 409, and says so in a way that can be acted on", async () => {
    expect.hasAssertions();
    const { em1, em2, c1, c2 } = await twoStaleReaders();

    c1.city = 'First';
    await em1.saveChanges();          // wins, and moves rowVersion on

    c2.city = 'Second';               // still holds the rowVersion it read
    try {
      await em2.saveChanges();
      throw new Error("the second save should have conflicted");
    } catch (e: any) {
      expect(e.status).toBe(409);
      expect(e.problemType).toBe(ProblemTypes.concurrencyConflict);
      expect(isConcurrencyError(e)).toBe(true);

      // Not EF Core's "expected to affect 1 row(s), but actually affected 0 row(s)". That text
      // is an implementation detail of the ORM, and is what an application would otherwise have
      // to match on.
      expect(e.message).toMatch(/changed or deleted by another user/i);
      expect(e.message).not.toMatch(/row\(s\)/);

      // Which row went stale, resolved back to the instance this manager already holds.
      expect(e.entityErrors).toHaveLength(1);
      expect(e.entityErrors[0].errorName).toBe('ConcurrencyError');
      expect(e.entityErrors[0].entity).toBe(c2);

      // An entity-level error: the row is stale as a whole, and rowVersion is not something the
      // user edited.
      const ves = c2.entityAspect.getValidationErrors();
      expect(ves).toHaveLength(1);
      expect(ves[0].property).toBeUndefined();

      // The edit is still there to merge against a fresh read - nothing was rolled back locally.
      expect(c2.entityAspect.entityState.isModified()).toBe(true);
      expect(c2.city).toBe('Second');
    }
  });

  test("re-reading clears the conflict and the save then succeeds", async () => {
    // The recovery the guide recommends, end to end: take the server's version, reapply, save.
    const { em1, em2, c1, c2, q } = await twoStaleReaders();

    c1.city = 'First';
    await em1.saveChanges();

    c2.city = 'Second';
    await expect(em2.saveChanges()).rejects.toThrow();
    expect(c2.entityAspect.getValidationErrors()).toHaveLength(1);

    // OverwriteChanges takes the server's row, rowVersion included, and discards the local edit.
    await q.using(em2).using(MergeStrategy.OverwriteChanges).execute();
    expect(c2.city).toBe('First');
    expect(c2.entityAspect.entityState.isUnchanged()).toBe(true);

    c2.city = 'Merged';
    const sr = await em2.saveChanges();
    expect(sr.entities).toHaveLength(1);
    // The stale-read marker from the failed attempt is gone, not left on the entity.
    expect(c2.entityAspect.getValidationErrors()).toHaveLength(0);
  });

  test("a deleted row conflicts the same way", async () => {
    // The other half of "changed or deleted": EF Core reports a DELETE or UPDATE that matched
    // nothing, so a row removed by someone else arrives as the same problem type.
    expect.hasAssertions();
    const { em1, em2, c1, c2 } = await twoStaleReaders();

    c1.entityAspect.setDeleted();
    await em1.saveChanges();

    c2.city = 'Too late';
    try {
      await em2.saveChanges();
      throw new Error("saving against a deleted row should have conflicted");
    } catch (e: any) {
      expect(isConcurrencyError(e)).toBe(true);
      expect(e.status).toBe(409);
    }
  });

});
