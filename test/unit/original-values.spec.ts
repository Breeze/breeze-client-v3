import { EntityManager, EntityState, MetadataStore } from '../../src/breeze';
import type { EntityAspect } from '../../src/breeze';
import { Order, Supplier, registerModelClasses } from '../model';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// What an entity's properties were before its pending changes. A generated class's entityAspect is
// an EntityAspectOf<this>, so the names are checked against the class and the values typed.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

function newEntityManager() {
  return new EntityManager({ serviceName: 'http://localhost:0/breeze/NorthwindIBModel', metadataStore });
}

function unchangedOrder(em = newEntityManager()) {
  return em.createEntity(Order, { orderID: 1, freight: 10, shipCity: 'Bern', orderDate: new Date(2024, 0, 1) },
    EntityState.Unchanged);
}

describe("originalValues", () => {

  test("holds, typed, each edited property's value from before the first edit", () => {
    const order = unchangedOrder();
    order.freight = 20;
    order.freight = 30;
    const before: number | undefined = order.entityAspect.originalValues.freight;
    expect(before).toBe(10);
    expect(order.entityAspect.originalValues.shipCity).toBeUndefined();   // not edited
  });

});

describe("getOriginalValue", () => {

  test("is the original value of an edited property, and the current value of one that was not", () => {
    const order = unchangedOrder();
    order.freight = 99;
    const freight: number = order.entityAspect.getOriginalValue('freight');
    expect(freight).toBe(10);
    expect(order.entityAspect.getOriginalValue('shipCity')).toBe('Bern');
  });

  test("of an Added entity is its current value: there is nothing before it", () => {
    const order = newEntityManager().createEntity(Order, { freight: 5 });
    order.freight = 6;
    expect(order.entityAspect.getOriginalValue('freight')).toBe(6);
  });

  test("takes a path into a complex property", () => {
    const supplier = newEntityManager().createEntity(Supplier,
      { supplierID: 1, companyName: 'S', location: { city: 'Oslo' } }, EntityState.Unchanged);
    supplier.location.city = 'Bergen';
    expect(supplier.entityAspect.getOriginalValue('location.city')).toBe('Oslo');
    expect(supplier.location.complexAspect.originalValues.city).toBe('Oslo');
  });

});

describe("getChangedProperties", () => {

  test("lists the properties whose value now differs from the original", () => {
    const order = unchangedOrder();
    order.freight = 99;
    order.shipCity = 'Genf';
    expect(order.entityAspect.getChangedProperties().sort()).toEqual(['freight', 'shipCity']);
  });

  test("leaves out a property set back to its original value, although originalValues keeps it", () => {
    const order = unchangedOrder();
    order.freight = 99;
    order.freight = 10;
    expect(order.entityAspect.getChangedProperties()).toEqual([]);
    expect(order.entityAspect.originalValues.freight).toBe(10);
  });

  test("compares dates by time, not by object", () => {
    const order = unchangedOrder();
    order.orderDate = new Date(2024, 0, 1);   // a new Date, the same time
    expect(order.entityAspect.getChangedProperties()).toEqual([]);
    order.orderDate = new Date(2024, 0, 2);
    expect(order.entityAspect.getChangedProperties()).toEqual(['orderDate']);
  });

  test("gives a complex property's changes as paths", () => {
    const supplier = newEntityManager().createEntity(Supplier,
      { supplierID: 1, companyName: 'S', location: { city: 'Oslo', country: 'NO' } }, EntityState.Unchanged);
    supplier.location.city = 'Bergen';
    expect(supplier.entityAspect.getChangedProperties()).toEqual(['location.city']);
  });

  test("is empty once the changes are accepted", () => {
    const order = unchangedOrder();
    order.freight = 99;
    order.entityAspect.acceptChanges();
    expect(order.entityAspect.getChangedProperties()).toEqual([]);
    expect(order.entityAspect.getOriginalValue('freight')).toBe(99);
  });

});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function compilerMustAcceptAndReject(order: Order, supplier: Supplier) {
  // A generated entity is still an Entity, and its aspect an EntityAspect.
  const aspect: EntityAspect = order.entityAspect;
  const changed: string[] = order.entityAspect.getChangedProperties();
  const city: string = supplier.entityAspect.getOriginalValue('location.city');   // a path: untyped

  // @ts-expect-error - not a property of Order
  order.entityAspect.getOriginalValue('frieght');
  // @ts-expect-error - nor here
  order.entityAspect.originalValues.frieght;
  // @ts-expect-error - freight is a number
  const wrong: string = order.entityAspect.getOriginalValue('freight');
  // @ts-expect-error - a navigation property has no original value: its foreign key does
  order.entityAspect.getOriginalValue('customer');
  return [aspect, changed, city, wrong];
}
