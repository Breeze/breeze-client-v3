import { EntityQuery, MetadataStore, Predicate } from '../../src/breeze';
import { Customer, Order, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// The documentation shows the object form of `where` beside the three-argument form and says they
// produce the same query. This is that claim, checked: each pair below must build an identical
// predicate. If one of these ever diverges, the docs are wrong and this fails.
//
// Comparing the built predicate rather than the request URL keeps it independent of the uri
// builder, and is where a difference would actually originate.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

const order = () => EntityQuery.from(Order);
const cust = () => EntityQuery.from(Customer);
const po = Predicate.for(Order);
const pc = Predicate.for(Customer);

/** name, the three-argument form, the object form */
const PAIRS: Array<[string, () => EntityQuery, () => EntityQuery]> = [
  ['a comparison',
    () => order().where('freight', '>', 100),
    () => order().where({ freight: { gt: 100 } })],
  ['a string operator',
    () => order().where('shipCity', 'startsWith', 'Ber'),
    () => order().where({ shipCity: { startsWith: 'Ber' } })],
  ['equality, which needs no operator at all',
    () => order().where('shipCountry', '==', 'Germany'),
    () => order().where({ shipCountry: 'Germany' })],
  ['a null test',
    () => order().where('shippedDate', '==', null),
    () => order().where({ shippedDate: null })],
  ['not null',
    () => order().where('shippedDate', '!=', null),
    () => order().where({ shippedDate: { ne: null } })],
  ['in',
    () => cust().where('country', 'in', ['Belgium', 'Germany']),
    () => cust().where({ country: { in: ['Belgium', 'Germany'] } })],
  ['a path through a navigation',
    () => order().where('customer.companyName', 'startsWith', 'A'),
    () => order().where({ 'customer.companyName': { startsWith: 'A' } })],
  ['two conditions, and-ed',
    () => order().where('freight', '>', 100).where('shipCountry', '==', 'Germany'),
    () => order().where({ freight: { gt: 100 }, shipCountry: 'Germany' })],
  ['a range on one property',
    () => order().where(po('freight', '>', 100).and(po('freight', '<', 200))),
    () => order().where({ freight: { gt: 100, lt: 200 } })],
  ['or',
    () => cust().where(Predicate.or([pc('city', '==', 'London'), pc('city', '==', 'Berlin')])),
    () => cust().where({ or: [{ city: 'London' }, { city: 'Berlin' }] })],
  ['any over a collection',
    () => cust().where('orders', 'any', 'freight', '>', 950),
    () => cust().where({ orders: { any: { freight: { gt: 950 } } } })],
  ['all over a collection',
    () => cust().where('orders', 'all', 'shippedDate', '!=', null),
    () => cust().where({ orders: { all: { shippedDate: { ne: null } } } })],
  ['not',
    () => cust().where(pc('orders', 'any', 'orderID', '!=', null).not()),
    () => cust().where({ not: { orders: { any: { orderID: { ne: null } } } } })],
  ['one property compared to another',
    () => order().where('requiredDate', '<', 'shippedDate'),
    () => order().where({ requiredDate: { lt: 'shippedDate' } })],
  ['a query function',
    () => cust().where('toLower(companyName)', 'startsWith', 'c'),
    () => cust().where({ 'toLower(companyName)': { startsWith: 'c' } })],
];

describe("The object form of where builds the same query", () => {

  test.each(PAIRS)('%s', (_name, threeArgs, objectForm) => {
    expect(objectForm().wherePredicate!.toString())
      .toBe(threeArgs().wherePredicate!.toString());
  });

  test("the documented pairs are all covered", () => {
    // A reminder to add a pair here when one is added to the docs.
    expect(PAIRS).toHaveLength(15);
  });

});
