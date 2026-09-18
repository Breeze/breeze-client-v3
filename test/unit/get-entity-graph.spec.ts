// import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
// import { EntityManager } from '../../src/manager/entity-manager';
// import '../../src/mixins/mixin-get-entity-graph';
// import { HasEntityGraph } from '../../src/mixins/mixin-get-entity-graph';

import { EntityManager, EntityQuery } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';

import '../../src/mixins/mixin-get-entity-graph';
import { HasEntityGraph } from '../../src/mixins/mixin-get-entity-graph';

import { TestFns } from '../test-fns';

ModelLibraryBackingStoreAdapter.register();


// TODO migrate tests from https://github.com/Breeze/breeze.js.samples/blob/master/net/DocCode/DocCode/tests/getEntityGraphTests.js
describe("GetEntityGraph", () => {

  beforeEach(function () {
  });

  test("should graph Order expand Customer", () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(TestFns.sampleMetadata);

    let customer = em.createEntity("Customer", { companyName: "ACME"});
    expect(customer).toBeTruthy();
    expect(customer.getProperty('companyName')).toEqual("ACME");

    let o1 = em.createEntity("Order", { shipName: "One", customer: customer });
    let o2 = em.createEntity("Order", { shipName: "Two", customer: customer });
    let orders = [o1, o2];

    let graph = (em as any as HasEntityGraph).getEntityGraph(orders, 'customer');
    expect(graph.length).toEqual(3);
  });

  test("should graph Customer expand Orders", () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(TestFns.sampleMetadata);

    let customer = em.createEntity("Customer", { companyName: "ACME"});
    expect(customer).toBeTruthy();
    expect(customer.getProperty('companyName')).toEqual("ACME");

    let o1 = em.createEntity("Order", { shipName: "One", customer: customer });
    let o2 = em.createEntity("Order", { shipName: "Two", customer: customer });

    let graph = (em as HasEntityGraph).getEntityGraph(customer, 'orders');
    expect(graph.length).toEqual(3);
  });

  // The query form takes its expand from the query. The Entity graphs guide shows exactly this
  // call, which did not compile while the signature required a second argument.
  test("should graph a query using the query's own expand", () => {
    const em = new EntityManager('test');
    em.metadataStore.importMetadata(TestFns.sampleMetadata);
    const customer = em.createEntity("Customer", { companyName: "ACME" });
    em.createEntity("Order", { shipName: "One", customer: customer });
    em.createEntity("Order", { shipName: "Two", customer: customer });

    const q = EntityQuery.from("Customers").where("companyName", "==", "ACME").expand("orders");
    const graph = (em as HasEntityGraph).getEntityGraph(q);
    expect(graph.length).toEqual(3);
  });

  // Walking a collection navigation used to look for each parent's children by filtering every
  // entity of the child type, so a two-level expand over p parents and c children cost p*c:
  // getEntityGraph(customer, 'orders.orderDetails') over 8,000 orders and 24,000 details took
  // about 5 seconds. The children are indexed by their foreign key once per path segment instead.
  //
  // Counting the work rather than timing it, as relation-array-clear.spec.ts does: a filter per
  // parent reads the foreign key off every child, so the number of getProperty calls landing on
  // the children is exactly the difference between the two.
  test("should not rescan the child type once per parent", () => {
    const em = new EntityManager('test');
    em.metadataStore.importMetadata(TestFns.sampleMetadata);

    const ORDERS = 40, DETAILS_PER_ORDER = 3;
    const customer = em.createEntity("Customer", { companyName: "ACME" });
    const details: any[] = [];
    for (let i = 0; i < ORDERS; i++) {
      const order = em.createEntity("Order", { orderID: i + 1, customer: customer });
      for (let j = 0; j < DETAILS_PER_ORDER; j++) {
        details.push(em.createEntity("OrderDetail", { orderID: i + 1, productID: j + 1, order: order }));
      }
    }

    // An own property shadows the prototype's, so this counts without touching the entity type.
    let reads = 0;
    details.forEach(d => {
      const inherited = d.getProperty;
      d.getProperty = function (this: any, ...args: any[]) { reads++; return inherited.apply(this, args); };
    });

    const graph = (em as HasEntityGraph).getEntityGraph(customer, 'orders.orderDetails');

    expect(graph.length).toEqual(1 + ORDERS + ORDERS * DETAILS_PER_ORDER);
    expect(graph).toContain(customer);
    details.forEach(d => expect(graph).toContain(d));

    // A filter per parent is ORDERS * details = 4,800 reads. Indexing them once is one read per
    // detail; allow a few times that and still be an order of magnitude below the rescan.
    expect(reads).toBeLessThan(details.length * 4);
  });
});


