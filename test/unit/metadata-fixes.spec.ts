import { DataProperty, DataType, MetadataStore, NavigationProperty } from '../../src/breeze';

const namespace = 'Fixes';

// Distinct association names throughout, so that nothing is paired as an inverse automatically.
function storeWithThreeTypes() {
  const store = new MetadataStore();
  store.addEntityType({
    shortName: 'Customer', namespace,
    dataProperties: { id: { dataType: DataType.Int32, isPartOfKey: true } },
    navigationProperties: { orders: { entityTypeName: 'Order', isScalar: false, associationName: 'A' } },
  });
  store.addEntityType({
    shortName: 'Supplier', namespace,
    dataProperties: { id: { dataType: DataType.Int32, isPartOfKey: true } },
  });
  store.addEntityType({
    shortName: 'Order', namespace,
    dataProperties: {
      id: { dataType: DataType.Int32, isPartOfKey: true },
      supplierId: { dataType: DataType.Int32 },
    },
    navigationProperties: {
      supplier: { entityTypeName: 'Supplier', isScalar: true, associationName: 'B', foreignKeyNames: ['supplierId'] },
    },
  });
  return store;
}

describe("MetadataStore", () => {
  // MetadataStoreConfig has always declared `name`; only setProperties accepted it.
  test("takes a name in its constructor", () => {
    expect(new MetadataStore({ name: 'Northwind v6' }).name).toBe('Northwind v6');
  });
});

describe("NavigationProperty.setInverse", () => {
  // The message concatenated the formatName method rather than calling it, so it showed the
  // function's source code.
  test("names the property that cannot be the inverse", () => {
    const store = storeWithThreeTypes();
    const orders = store.getAsEntityType('Customer').getNavigationProperty('orders');
    const supplier = store.getAsEntityType('Order').getNavigationProperty('supplier');
    expect(() => orders.setInverse(supplier)).toThrow(/Order:#Fixes--supplier is not a valid inverse/);
  });
});

describe("addEntityType", () => {
  // The config types have always allowed arrays of config objects, but an array item was passed
  // straight on as a property instance, and a config object is not one.
  test("accepts an array of property configs", () => {
    const store = new MetadataStore();
    store.addEntityType({
      shortName: 'Customer', namespace,
      dataProperties: [
        { name: 'id', dataType: DataType.Int32, isPartOfKey: true },
        { name: 'companyName', maxLength: 40 },
      ],
      navigationProperties: [
        { name: 'orders', entityTypeName: 'Order', isScalar: false, associationName: 'A' },
      ],
    });
    const customer = store.getAsEntityType('Customer');
    expect(customer.getProperty('companyName')).toBeInstanceOf(DataProperty);
    expect((customer.getProperty('companyName') as DataProperty).maxLength).toBe(40);
    expect(customer.getProperty('orders')).toBeInstanceOf(NavigationProperty);
    expect(customer.keyProperties.map(p => p.name)).toEqual(['id']);
  });

  test("still accepts an array of property instances", () => {
    const store = new MetadataStore();
    store.addEntityType({
      shortName: 'Customer', namespace,
      dataProperties: [
        new DataProperty({ name: 'id', dataType: DataType.Int32, isPartOfKey: true }),
        new DataProperty({ name: 'companyName' }),
      ],
    });
    expect(store.getAsEntityType('Customer').getPropertyNames()).toEqual(['id', 'companyName']);
  });

  // Each property's name was written into the caller's config object, so a config shared between
  // two types, or reused, came back changed.
  test("leaves the caller's property configs as they were", () => {
    const idConfig = { dataType: DataType.Int32, isPartOfKey: true };
    const store = new MetadataStore();
    store.addEntityType({ shortName: 'Customer', namespace, dataProperties: { id: idConfig } });
    expect(idConfig).toEqual({ dataType: DataType.Int32, isPartOfKey: true });
  });
});
