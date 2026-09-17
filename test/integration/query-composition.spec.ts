import { EntityQuery, FilterQueryOp, Predicate } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { Customer, registerModelClasses } from '../model';

// The server half of test/unit/predicate-composition.spec.ts.
//
// The unit tests prove Breeze builds and evaluates `(a or b) and c` correctly. These prove the
// server agrees, which is the part an application actually depends on: the grouping has to survive
// serialization, the URL, and whatever the back end turns the filter into.
//
// Each shape is checked against the same predicate evaluated locally over the whole table, so the
// assertion is "the database returned what the predicate means" rather than a hard-coded count
// that a change of seed data would invalidate.

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  registerModelClasses(TestFns.defaultMetadataStore);
});

describe("Boolean composition reaches the server intact", () => {

  const P = Predicate.for(Customer);
  const london = P('city', FilterQueryOp.Equals, 'London');
  const madrid = P('city', FilterQueryOp.Equals, 'Madrid');
  const uk = P('country', FilterQueryOp.Equals, 'UK');
  const spain = P('country', FilterQueryOp.Equals, 'Spain');

  /** Every customer, in one manager, so a predicate can be evaluated locally as the ground truth. */
  async function allCustomers() {
    const em = TestFns.newEntityManager();
    await em.executeQuery(EntityQuery.from(Customer));
    return em;
  }

  const shapes: Array<[string, () => Predicate]> = [
    ['(a or b) and c', () => Predicate.and(london.or(madrid), uk)],
    ['(a or b) and c, built with the instance method', () => london.or(madrid).and(uk)],
    ['a and c or b and c - the same thing distributed by hand', () => london.and(uk).or(madrid.and(uk))],
    ['(a or b) and (c or d)', () => Predicate.and(london.or(madrid), uk.or(spain))],
    ['((a or b) and c) or d', () => Predicate.and(london.or(madrid), uk).or(spain)],
    ['not (a or b)', () => london.or(madrid).not()],
    ['two conditions on one property', () => Predicate.and(london, madrid)],
  ];

  test.each(shapes)('%s', async (_name, build) => {
    const pred = build();
    const query = EntityQuery.from(Customer).where(pred);

    const local = (await allCustomers()).executeQueryLocally(query)
      .map((c: any) => c.customerID).sort();

    const em = TestFns.newEntityManager();
    const server = (await em.executeQuery(query)).results
      .map((c: any) => c.customerID).sort();

    expect(server).toEqual(local);
  });

  test("the three ways of writing (a or b) and c return the same rows", async () => {
    const em = TestFns.newEntityManager();
    const run = async (p: Predicate) =>
      (await em.executeQuery(EntityQuery.from(Customer).where(p)))
        .results.map((c: any) => c.customerID).sort();

    const viaStatic = await run(Predicate.and(london.or(madrid), uk));
    const viaInstance = await run(london.or(madrid).and(uk));
    const distributed = await run(london.and(uk).or(madrid.and(uk)));

    expect(viaStatic.length).toBeGreaterThan(0);
    expect(viaInstance).toEqual(viaStatic);
    expect(distributed).toEqual(viaStatic);
  });

});
