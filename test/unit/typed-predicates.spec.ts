import { EntityQuery, Predicate } from '../../src/breeze';
import { Customer, Order, Product, Role, Supplier, registerModelClasses } from '../model';
import { MetadataStore } from '../../src/breeze';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// A query built from a constructor knows its entity type, so `where`, `orderBy` and `expand` can
// check the property path, the operator and the value against it. None of that exists at run
// time - the query is still assembled from the same strings - so most of this file is the
// compile-time half, in compilerMustReject() below. The runtime tests here only confirm that the
// checked calls still build the query they always did.
//
// The rule that shapes the overloads: a path written as a *literal* is always checked, while a
// path only known at run time is let through. See src/query/property-path.ts.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

describe("Typed predicates - what is accepted", () => {

  test("a checked where builds the same query as before", () => {
    const q = EntityQuery.from(Customer).where('companyName', 'startsWith', 'C');
    expect(q.wherePredicate).toBeTruthy();
    expect(q.resourceName).toBe('Customers');
  });

  test("nested paths, through navigations and through complex types", () => {
    expect(EntityQuery.from(Order).where('customer.companyName', 'eq', 'Acme').wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Supplier).where('location.city', 'eq', 'Vienna').wherePredicate).toBeTruthy();
  });

  test("any and all over a collection, filtered on the element type", () => {
    const q = EntityQuery.from(Order).where('orderDetails', 'any', 'unitPrice', 'gt', 5);
    expect(q.wherePredicate).toBeTruthy();
  });

  test("any and all over a prebuilt Predicate", () => {
    const inner = Predicate.create('unitPrice', '>', 200).and('quantity', '>', 50);
    expect(EntityQuery.from(Customer).where('orders', 'any', inner).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Customer).where('orders', 'some', 'orderDetails', 'any', inner).wherePredicate).toBeTruthy();
  });

  test("a property may be compared against another property", () => {
    // Breeze reads a string value as a property name when it names one. The value of a Date
    // property may therefore be a string - but only one that is a real path, which is what keeps
    // `where('freight', 'gt', 'one hundred')` an error. See compilerMustReject.
    const q = EntityQuery.from(Order).where('requiredDate', '<', 'shippedDate');
    expect(q.wherePredicate).toBeTruthy();
  });

  test("the escape hatch forces an interpretation", () => {
    expect(EntityQuery.from(Order)
      .where('freight', 'gt', { value: '35', isLiteral: true, dataType: 'Decimal' })
      .wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Product)
      .where('unitsInStock', 'eq', { value: 'reorderLevel', isProperty: true })
      .wherePredicate).toBeTruthy();
  });

  test("null is a value, and `in` takes an array", () => {
    expect(EntityQuery.from(Customer).where('region', 'eq', null).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where('freight', 'in', [1, 2, 3]).wherePredicate).toBeTruthy();
  });

  test("a query function in the path is let through", () => {
    // What is inside the parentheses is an expression language of its own, not a property path.
    const q = EntityQuery.from(Customer).where('toUpper(substring(companyName, 1, 2))', 'startsWith', 'OM');
    expect(q.wherePredicate).toBeTruthy();
  });

  test("a path only known at run time is let through", () => {
    // The pattern that decides the whole overload set: this has to keep working, and it is why
    // there are escape overloads at all.
    const path: string = 'companyName';
    const op: string = 'startsWith';
    expect(EntityQuery.from(Customer).where(path, 'startsWith', 'C').wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Customer).where('companyName', op, 'C').wherePredicate).toBeTruthy();
  });

  test("an untyped query is unrestricted, exactly as before", () => {
    // EntityQuery<T = any>, which is what every query built from a resource name is.
    const q = new EntityQuery('Customers').where('anything at all', 'eq', 1);
    expect(q.wherePredicate).toBeTruthy();
    expect(EntityQuery.from('Orders').orderBy('whatever desc').orderByClause).toBeTruthy();
  });

  test("orderBy and expand are checked the same way", () => {
    expect(EntityQuery.from(Order).orderBy('freight desc').orderByClause).toBeTruthy();
    expect(EntityQuery.from(Order).orderBy(['shipCity', 'freight desc']).orderByClause).toBeTruthy();
    expect(EntityQuery.from(Order).expand('customer').expandClause).toBeTruthy();
    expect(EntityQuery.from(Order).expand(['customer', 'orderDetails.product']).expandClause).toBeTruthy();
    // A comma-separated list stays legal; it is let through rather than enumerated.
    expect(EntityQuery.from(Order).expand('customer, orderDetails').expandClause).toBeTruthy();
  });

  test("Predicate.for checks a standalone predicate", () => {
    const p = Predicate.for(Customer);
    const pred = p('companyName', 'startsWith', 'C').and(p('city', 'eq', 'Vienna'));
    expect(pred).toBeInstanceOf(Predicate);
    expect(EntityQuery.from(Customer).where(pred).wherePredicate).toBe(pred);
  });

  test("Predicate.for does not require the constructor to be registered", () => {
    // It is read for its type. Nothing about it is kept.
    class Unregistered { declare entityAspect: any; declare entityType: any;
      declare getProperty: any; declare setProperty: any; declare title: string; }
    const p = Predicate.for(Unregistered);
    expect(p('title', 'eq', 'x')).toBeInstanceOf(Predicate);
  });

});

/**
The compile-time half. Never called: `@ts-expect-error` fails the build (TS2578, "Unused
'@ts-expect-error' directive") if the line below it starts compiling, so each one is an assertion
that the checking still bites.
*/
function compilerMustReject() {
  const cust = EntityQuery.from(Customer);
  const order = EntityQuery.from(Order);

  // @ts-expect-error - misspelled property
  cust.where('compnyName', 'startsWith', 'C');

  // @ts-expect-error - misspelled property behind a navigation
  order.where('customer.nope', 'eq', 'x');

  // @ts-expect-error - startsWith is not an operator on a number
  order.where('freight', 'startsWith', 1);

  // @ts-expect-error - a number property compared against something that is not a number or a path
  order.where('freight', 'gt', 'one hundred');

  // @ts-expect-error - a collection is filtered with any/all, not compared
  order.where('orderDetails', 'gt', 5);

  // @ts-expect-error - the inner property is checked against the element type
  order.where('orderDetails', 'any', 'nope', 'gt', 5);

  // @ts-expect-error - orders belongs to Customer, not Order
  order.where('orders', 'any', 'freight', 'gt', 5);

  // @ts-expect-error - not a sort direction
  order.orderBy('freight descending');

  // @ts-expect-error - expand takes navigations, and freight is not one
  order.expand('freight');

  // @ts-expect-error - a navigation is not a comparable value
  order.where('customer', 'eq', 'Acme');

  const p = Predicate.for(Customer);
  // @ts-expect-error - Predicate.for checks the same paths
  p('nope', 'eq', 1);

  // A path in a variable is let through, but that escape must not rescue a bad literal: these
  // two lines differ only in whether the path is a literal.
  const path: string = 'compnyName';
  cust.where(path, 'startsWith', 'C');            // allowed - not knowable
  // @ts-expect-error - knowable, and wrong
  cust.where('compnyName' as const, 'startsWith', 'C');
}

// Referenced so the function is not dead code to a linter; never invoked.
export const _compileTimeOnly = compilerMustReject;

// The object form - what the docs call the JSON form - is checked against the same paths,
// operators and values as the three-argument form. It is enumerated rather than inferred (see
// WhereObject in src/query/property-path.ts) so that a misspelled key is an ordinary
// excess-property error, which is the diagnostic that carries a spelling suggestion.

describe("Typed predicates - the object form", () => {

  test("a bare value means equality, and several keys are and-ed", () => {
    const q = EntityQuery.from(Customer).where({ city: 'London', country: 'UK' });
    expect(q.wherePredicate).toBeTruthy();
  });

  test("an operator clause, including on a nested path", () => {
    expect(EntityQuery.from(Order).where({ freight: { gt: 100 } }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where({ 'customer.companyName': { startsWith: 'A' } }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Supplier).where({ 'location.city': { eq: 'Vienna' } }).wherePredicate).toBeTruthy();
  });

  test("and, or and not, with objects or prebuilt Predicates", () => {
    expect(EntityQuery.from(Customer).where({ or: [{ city: 'London' }, { city: 'Berlin' }] }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Customer).where({ not: { city: 'London' } }).wherePredicate).toBeTruthy();
    const pre = Predicate.create('city', 'eq', 'Paris');
    expect(EntityQuery.from(Customer).where({ and: [pre, { country: 'FR' }] }).wherePredicate).toBeTruthy();
  });

  test("any and all over a collection", () => {
    const q = EntityQuery.from(Customer).where({ orders: { any: { freight: { gt: 100 } } } });
    expect(q.wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where({ orderDetails: { all: { unitPrice: { '<': 5 } } } }).wherePredicate).toBeTruthy();
  });

  test("null, `in`, the escape hatch and query functions", () => {
    expect(EntityQuery.from(Order).where({ shippedDate: null }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where({ freight: { in: [1, 2] } }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where({ freight: { value: 35, dataType: 'Decimal' } }).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Customer).where({ 'toLower(companyName)': { startsWith: 'c' } }).wherePredicate).toBeTruthy();
  });

  test("an untyped query still takes any object", () => {
    // Any property name, because an untyped query has no type to check it against. The operator
    // still has to be a real one - that is the runtime's rule, not the type system's.
    const q = new EntityQuery('Customers').where({ somethingUnmapped: { eq: 1 } });
    expect(q.wherePredicate).toBeTruthy();
  });

  test("the object form and the three-argument form build the same predicate", () => {
    const a = EntityQuery.from(Customer).where('companyName', 'startsWith', 'C');
    const b = EntityQuery.from(Customer).where({ companyName: { startsWith: 'C' } });
    expect(b.wherePredicate!.toString()).toBe(a.wherePredicate!.toString());
  });

});

/** As compilerMustReject above, for the object form. */
function compilerMustRejectObjects() {
  const cust = EntityQuery.from(Customer);
  const order = EntityQuery.from(Order);

  // @ts-expect-error - misspelled key. This one also suggests: "Did you mean to write
  // 'companyName'?", which the three-argument form cannot produce.
  cust.where({ compnyName: { startsWith: 'C' } });

  // @ts-expect-error - startsWith is not an operator on a number
  order.where({ freight: { startsWith: 1 } });

  // @ts-expect-error - a number property compared against something that is not a number or a path
  order.where({ freight: { gt: 'one hundred' } });

  // @ts-expect-error - misspelled key behind a navigation
  order.where({ 'customer.nope': { eq: 'x' } });

  // @ts-expect-error - the object inside any is checked against the element type
  cust.where({ orders: { any: { nope: 1 } } });

  // @ts-expect-error - and every element of an and/or array is checked too
  cust.where({ and: [{ city: 'London' }, { nope: 1 }] });

  // @ts-expect-error - a collection takes a quantifier, not an operator
  order.where({ orderDetails: { gt: 5 } });
}

export const _compileTimeOnlyObjects = compilerMustRejectObjects;
