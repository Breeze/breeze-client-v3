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

// Predicate.create can be told the entity type instead of being handed a constructor. How much
// that checks depends on the form, and the reason is a limit of TypeScript rather than a choice:
// supplying T explicitly stops the remaining type parameters being inferred, so the three-argument
// form cannot tie its value back to the property in its first argument. The object form has only T
// to infer, so it is checked in full.

describe("Predicate.create with an entity type", () => {

  test("the three-argument form checks the property path", () => {
    const p = Predicate.create<Customer>('companyName', 'startsWith', 'C');
    expect(p).toBeInstanceOf(Predicate);
    expect(EntityQuery.from(Customer).where(p).wherePredicate).toBe(p);
  });

  test("the object form is checked in full", () => {
    const p = Predicate.create<Order>({ freight: { gt: 100 } });
    expect(p).toBeInstanceOf(Predicate);
  });

  test("the any/all form checks the collection path", () => {
    expect(Predicate.create<Customer>('orders', 'any', 'freight', 'gt', 100)).toBeInstanceOf(Predicate);
  });

  test("without a type argument it is exactly what it always was", () => {
    // The 80-odd existing call sites. T defaults to any, and every path type collapses to string.
    expect(Predicate.create('anything at all', 'eq', 1)).toBeInstanceOf(Predicate);
    expect(Predicate.create('freight gt 100')).toBeInstanceOf(Predicate);
    expect(Predicate.create(['freight', '>', 100])).toBeInstanceOf(Predicate);
    expect(Predicate.create({ whatever: { eq: 1 } })).toBeInstanceOf(Predicate);
    const inner = Predicate.create('a', 'eq', 1);
    expect(Predicate.create(inner)).toBe(inner);
  });

  test("Predicate.for takes a computed path and a query function", () => {
    const p = Predicate.for(Customer);
    const path: string = 'companyName';
    expect(p(path, 'eq', 'x')).toBeInstanceOf(Predicate);
    expect(p('toLower(companyName)', 'startsWith', 'c')).toBeInstanceOf(Predicate);
    expect(p({ city: 'London' })).toBeInstanceOf(Predicate);
  });

});

/** As compilerMustReject above, for Predicate.create with an entity type. */
function compilerMustRejectCreate() {
  // @ts-expect-error - misspelled path
  Predicate.create<Customer>('compnyName', 'startsWith', 'C');

  // @ts-expect-error - misspelled key, and this one suggests the correction
  Predicate.create<Customer>({ compnyName: { startsWith: 'C' } });

  // @ts-expect-error - the object form ties the operator to the property type
  Predicate.create<Order>({ freight: { startsWith: 1 } });

  // @ts-expect-error - and the value to it as well
  Predicate.create<Order>({ freight: { gt: 'one hundred' } });

  // @ts-expect-error - a collection is filtered with any/all
  Predicate.create<Order>({ orderDetails: { gt: 5 } });

  // The three-argument form cannot do those last three: naming T explicitly stops TypeScript
  // inferring the property, so the operator and value are not tied to it. Both of these compile,
  // and the object form above is how to catch them.
  Predicate.create<Order>('freight', 'startsWith', 1);
  Predicate.create<Order>('freight', 'gt', 'one hundred');
}

export const _compileTimeOnlyCreate = compilerMustRejectCreate;

// A Predicate carries the entity type it was built for: Predicate.for(Order) and
// Predicate.create<Order>(...) make a Predicate<Order>. So what is combined with it is checked,
// and a query for another type will not take it. Before, every Predicate was the same type.
describe("Typed predicates - Predicate<T>", () => {

  const o = Predicate.for(Order);

  test("and, or and not build the same predicates as before", () => {
    const typed = o('freight', 'gt', 100).and('shipCity', 'startsWith', 'B').or(o('freight', 'lt', 5)).not();
    const untyped = Predicate.create('freight', 'gt', 100).and('shipCity', 'startsWith', 'B')
      .or(Predicate.create('freight', 'lt', 5)).not();
    expect(JSON.stringify(typed)).toBe(JSON.stringify(untyped));
  });

  test("and and or take the object form too", () => {
    const pred = o('shipCity', 'startsWith', 'B').and({ freight: { gt: 100 } });
    expect(JSON.stringify(pred)).toBe(JSON.stringify(Predicate.and(
      Predicate.create('shipCity', 'startsWith', 'B'), Predicate.create({ freight: { gt: 100 } }))));
  });

  test("a typed predicate is used by a query for its type, and by an untyped one", () => {
    const pred = o('freight', 'gt', 100);
    expect(EntityQuery.from(Order).where(pred).wherePredicate).toBeTruthy();
    expect(new EntityQuery('Orders').where(pred).wherePredicate).toBeTruthy();
    expect(EntityQuery.from(Order).where(Predicate.and(pred, o('shipCity', 'eq', 'Bern'))).wherePredicate).toBeTruthy();
  });

});

/** As compilerMustReject above, for what Predicate<T> now catches. */
function compilerMustRejectTypedPredicates() {
  const o = Predicate.for(Order);
  const c = Predicate.for(Customer);
  const pOrder = o('freight', 'gt', 100);
  const pCustomer = c('companyName', 'startsWith', 'C');

  // @ts-expect-error - a Predicate<Order> on a query for Customers
  EntityQuery.from(Customer).where(pOrder);
  // @ts-expect-error - or combined with a Predicate<Customer>
  pOrder.and(pCustomer);
  // @ts-expect-error - same, statically
  Predicate.and(pOrder, pCustomer);
  // @ts-expect-error - the arguments of and() are checked: a misspelled path
  pOrder.and('shpCity', 'eq', 'Bern');
  // @ts-expect-error - an operator that does not suit the property
  pOrder.or('freight', 'startsWith', 'B');
  // @ts-expect-error - a value of the wrong type
  pOrder.and('freight', 'gt', 'lots');
  // @ts-expect-error - the object form, checked in full
  pOrder.and({ fraight: { gt: 1 } });
  // @ts-expect-error - any/all takes a predicate for the collection's element type: Order, not Customer
  EntityQuery.from(Customer).where('orders', 'any', pCustomer);
  // @ts-expect-error - same for the factory
  c('orders', 'any', pCustomer);
  // @ts-expect-error - not() keeps the type
  EntityQuery.from(Customer).where(pOrder.not());
}

/** And what must still compile. */
function compilerMustAcceptTypedPredicates(column: string) {
  const o = Predicate.for(Order);
  const pOrder = o('freight', 'gt', 100);
  const untyped = Predicate.create('freight', 'gt', 100);

  EntityQuery.from(Order).where(untyped);                       // an untyped predicate goes anywhere
  EntityQuery.from(Customer).where(Predicate.create('companyName', 'eq', 'x'));
  pOrder.and(untyped);                                          // and combines with anything untyped
  Predicate.and(pOrder, untyped);
  untyped.and('anything', 'gt', 1).or({ anything: { eq: 2 } }); // untyped arguments stay untyped
  pOrder.and(column, 'eq', 1);                                  // a path only known at run time
  pOrder.and('toLower(shipCity)', 'eq', 'bern');                // a query function
  EntityQuery.from(Customer).where('orders', 'any', pOrder);    // a Predicate<Order> for the orders
  Predicate.for(Customer)('orders', 'all', pOrder);
}

export const _compileTimeOnlyTyped = [compilerMustRejectTypedPredicates, compilerMustAcceptTypedPredicates];
