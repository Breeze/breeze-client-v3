import { EntityQuery, EntityState, MergeStrategy } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, registerModelClasses } from '../model';

// Probe: does a query drop EntityStateChange events?
//
// _notifyStateChange defers its work when the manager is loading and already has changes, and
// builds the deferred closure with `||` - so only the first one is kept, and every caller after
// the first returns without publishing. A query is the one thing that sets isLoading, so this
// needs a server.

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  registerModelClasses(TestFns.defaultMetadataStore);
});

describe("entityChanged during a query", () => {

  test("every entity returning to Unchanged reports its own state change", async () => {
    const em = TestFns.newEntityManager();

    // Fill the cache, then modify several of them.
    const first = await em.executeQuery(EntityQuery.from(Customer).take(6));
    const custs = first.results as any[];
    expect(custs.length).toBeGreaterThan(3);

    // Something keeps the manager dirty for the whole test, and the re-query must not be able to
    // clean it up - so a newly added entity, whose key the server does not have.
    const keepDirty = em.createEntity(Customer, { companyName: 'stays dirty' }, EntityState.Added);

    // These three will be overwritten back to Unchanged by the re-query.
    const returning = custs.slice(1, 4);
    returning.forEach((c, i) => c.setProperty('contactName', 'dirty ' + i));
    expect(returning.every(c => c.entityAspect.entityState === EntityState.Modified)).toBe(true);
    expect(em.hasChanges()).toBe(true);

    const stateChanges: any[] = [];
    em.entityChanged.subscribe(ev => {
      if (ev.entityAction.name === 'EntityStateChange') stateChanges.push(ev.entity);
    });

    // Re-query the same rows, discarding the local edits.
    await em.executeQuery(EntityQuery.from(Customer).take(6)
      .using(MergeStrategy.OverwriteChanges));

    // All three came back to Unchanged...
    expect(returning.every(c => c.entityAspect.entityState === EntityState.Unchanged)).toBe(true);
    // ...and the one held dirty is untouched, so the manager still has changes throughout.
    expect(keepDirty.entityAspect.entityState).toBe(EntityState.Added);
    expect(em.hasChanges()).toBe(true);

    // So each of the three should have reported its own state change.
    for (const c of returning) {
      expect(stateChanges).toContain(c);
    }
  });

});
