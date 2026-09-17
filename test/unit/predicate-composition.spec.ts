import {
  EntityManager, EntityQuery, EntityState, FilterQueryOp, MetadataStore, Predicate,
} from '../../src/breeze';
import { Customer, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// Grouping when and/or are nested.
//
// Reported from an application as a Breeze bug: `Predicate.and(p1.or(p2), other)` was said not to
// work, so the code distributed it by hand into `p1.and(other).or(p2.and(other))`. These tests are
// the check. Both forms are here, and they agree - on the JSON that goes over the wire and on what
// they actually match.
//
// The failure being guarded against is precedence: `and` binds tighter than `or`, so a filter
// language that flattens `(a or b) and c` into `a or b and c` silently means `a or (b and c)`.
// Breeze 3 cannot lose the grouping that way, because its wire format is structural JSON rather
// than a string - `{ and: [ { or: [...] }, ... ] }` nests explicitly. A string-building uri builder
// is where this bug would live, and this package ships only the JSON one.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

/** Four customers covering every combination of the two conditions. */
function managerWithCustomers() {
  const em = new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });
  let n = 0;
  const add = (city: string, country: string) =>
    em.createEntity(Customer, {
      customerID: '11111111-1111-1111-1111-00000000000' + (++n),
      companyName: city + '/' + country, city, country,
    }, EntityState.Unchanged);

  add('London', 'UK');       // a and c
  add('Madrid', 'UK');       // b and c
  add('Madrid', 'Spain');    // b, not c
  add('Paris', 'France');    // neither
  return em;
}

const matches = (em: EntityManager, p: Predicate) =>
  em.executeQueryLocally(EntityQuery.from(Customer).where(p))
    .map((c: any) => c.companyName).sort();

const P = Predicate.for(Customer);
const london = P('city', FilterQueryOp.Equals, 'London');
const madrid = P('city', FilterQueryOp.Equals, 'Madrid');
const uk = P('country', FilterQueryOp.Equals, 'UK');
const spain = P('country', FilterQueryOp.Equals, 'Spain');

describe("Predicate composition - an or nested inside an and", () => {

  test("the three ways of writing it all mean (a or b) and c", () => {
    const em = managerWithCustomers();
    const expected = ['London/UK', 'Madrid/UK'];

    // the form the application said did not work
    expect(matches(em, Predicate.and(london.or(madrid), uk))).toEqual(expected);
    // the same thing built with the instance method
    expect(matches(em, london.or(madrid).and(uk))).toEqual(expected);
    // the hand-distributed workaround it used instead
    expect(matches(em, london.and(uk).or(madrid.and(uk)))).toEqual(expected);
  });

  test("the grouping survives into the JSON that goes over the wire", () => {
    const json = Predicate.and(london.or(madrid), uk).toJSON();
    // The `or` stays a nested node. Flattened into a string it would read
    // "city eq London or city eq Madrid and country eq UK", which means something else.
    expect(json).toEqual({
      and: [{ or: [{ city: 'London' }, { city: 'Madrid' }] }, { country: 'UK' }],
    });
    expect(london.or(madrid).and(uk).toJSON()).toEqual(json);
  });

  test("and the wrong grouping would be visible here", () => {
    const em = managerWithCustomers();
    // a or (b and c) - what the precedence bug would silently produce
    const wrong = london.or(madrid.and(uk));
    expect(matches(em, wrong)).toEqual(['London/UK', 'Madrid/UK']);

    // the two are only distinguishable when `a` alone does not satisfy `c`, which is why the
    // fixture has a London/UK and not a London/France: add one and they diverge.
    const em2 = managerWithCustomers();
    em2.createEntity(Customer, {
      customerID: '11111111-1111-1111-1111-000000000009',
      companyName: 'London/France', city: 'London', country: 'France',
    }, EntityState.Unchanged);

    expect(matches(em2, Predicate.and(london.or(madrid), uk)))
      .toEqual(['London/UK', 'Madrid/UK']);                       // correct grouping
    expect(matches(em2, wrong))
      .toEqual(['London/France', 'London/UK', 'Madrid/UK']);      // the bug, had it existed
  });

  test("nesting holds up deeper, and through not", () => {
    const em = managerWithCustomers();

    expect(matches(em, Predicate.and(london.or(madrid), uk.or(spain))))
      .toEqual(['London/UK', 'Madrid/Spain', 'Madrid/UK']);

    expect(matches(em, Predicate.and(london.or(madrid), uk).or(spain)))
      .toEqual(['London/UK', 'Madrid/Spain', 'Madrid/UK']);

    expect(matches(em, london.or(madrid).not()))
      .toEqual(['Paris/France']);
  });

  test("two conditions on one property do not collide as object keys", () => {
    // The JSON form is an object, so `{ city: 'London', city: 'Madrid' }` would lose one of them.
    // Breeze puts them in the and/or array instead, which is what keeps this honest.
    expect(Predicate.and(london, madrid).toJSON())
      .toEqual({ and: [{ city: 'London' }, { city: 'Madrid' }] });

    const em = managerWithCustomers();
    expect(matches(em, Predicate.and(london, madrid))).toEqual([]);          // impossible
    expect(matches(em, Predicate.or(london, madrid)))
      .toEqual(['London/UK', 'Madrid/Spain', 'Madrid/UK']);
  });

});
