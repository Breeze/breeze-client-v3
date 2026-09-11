import { DataType, LocalQueryComparisonOptions, MetadataStore } from '../../src/breeze';
import { TestFns } from '../test-fns';

// No server needed.
TestFns.initNonServerEnv();

describe("MetadataStore.importMetadata", () => {

  test("imports Breeze native JSON metadata", () => {
    const ms = new MetadataStore();
    ms.importMetadata(TestFns.sampleMetadata);
    expect(ms.getAsEntityType("Customer").shortName).toBe("Customer");
  });

  test("rejects CSDL instead of silently importing nothing", () => {
    // 2.x parsed CSDL (EDMX). v3 does not, and used to accept it without a word.
    const csdl = { schema: { namespace: "Northwind", entityType: [] as unknown[] } };
    expect(() => new MetadataStore().importMetadata(csdl)).toThrow(/CSDL/);
  });

});

describe("importMetadata and data types", () => {

  test("every data type name in the server fixture maps to its own client type", () => {
    const ms = new MetadataStore();
    ms.importMetadata(TestFns.sampleMetadata);
    const unusualDate = ms.getAsEntityType("UnusualDate");
    expect(unusualDate.getDataProperty("timeOnly").dataType).toBe(DataType.TimeOnly);
    expect(unusualDate.getDataProperty("dateOnly").dataType).toBe(DataType.DateOnly);
    expect(ms.getAsEntityType("TimeLimit").getDataProperty("maxTime").dataType).toBe(DataType.Time);
  });

});

describe("importMetadata and LocalQueryComparisonOptions", () => {

  const caseSensitive = new LocalQueryComparisonOptions({ name: "caseSensitive-import-test", isCaseSensitive: true });

  function metadataNaming(lqcoName: string) {
    const json = JSON.parse(TestFns.sampleMetadata);
    json.localQueryComparisonOptions = lqcoName;
    return json;
  }

  test("usesSql92CompliantStringComparison is optional and defaults to true", () => {
    // The constructor used to throw without it.
    expect(caseSensitive.usesSql92CompliantStringComparison).toBe(true);
    expect(new LocalQueryComparisonOptions({}).isCaseSensitive).toBe(false);
  });

  test("options passed to the store win over the ones the metadata names", () => {
    const ms = new MetadataStore({ localQueryComparisonOptions: caseSensitive });
    ms.importMetadata(metadataNaming("caseInsensitiveSQL"));
    expect(ms.localQueryComparisonOptions).toBe(caseSensitive);
  });

  test("options made the default with setAsDefault win over the ones the metadata names", () => {
    const original = LocalQueryComparisonOptions.defaultInstance;
    try {
      caseSensitive.setAsDefault();
      const ms = new MetadataStore();
      ms.importMetadata(metadataNaming("caseInsensitiveSQL"));
      expect(ms.localQueryComparisonOptions.isCaseSensitive).toBe(true);
    } finally {
      LocalQueryComparisonOptions.defaultInstance = original;
    }
  });

  test("a store without options of its own adopts the ones the metadata names", () => {
    const ms = new MetadataStore();
    ms.importMetadata(metadataNaming("caseSensitive-import-test"));
    expect(ms.localQueryComparisonOptions.name).toBe("caseSensitive-import-test");
    expect(ms.localQueryComparisonOptions.isCaseSensitive).toBe(true);
  });

  test("a store with its own options accepts metadata naming others, even when it already has types", () => {
    const ms = new MetadataStore({ localQueryComparisonOptions: caseSensitive });
    ms.importMetadata(TestFns.sampleMetadata);
    ms.importMetadata(metadataNaming("caseInsensitiveSQL"));
    expect(ms.localQueryComparisonOptions).toBe(caseSensitive);
  });

});

describe("importMetadata of types", () => {

  test("a type that is not in the store and has no dataProperties is a clear error", () => {
    // With allowMerge this failed with "Cannot read properties of undefined (reading 'forEach')".
    const ms = new MetadataStore();
    ms.importMetadata(TestFns.sampleMetadata);
    const custom = { structuralTypes: [{ shortName: "NoSuchType", namespace: "Foo", custom: { a: 1 } }] };
    expect(() => ms.importMetadata(custom, true)).toThrow(/'NoSuchType:#Foo'.*dataProperties.*allowMerge/);
    expect(() => ms.importMetadata(custom)).toThrow(/'NoSuchType:#Foo'.*dataProperties/);
  });

  test("with allowMerge, custom values are merged into a type already in the store", () => {
    const ms = new MetadataStore();
    ms.importMetadata(TestFns.sampleMetadata);
    const customer = ms.getAsEntityType("Customer");
    ms.importMetadata({
      structuralTypes: [{
        shortName: "Customer", namespace: customer.namespace, custom: { a: 1 },
        dataProperties: [{ name: "companyName", custom: { uiHint: "big" } }],
      }],
    }, true);
    expect(customer.custom).toEqual({ a: 1 });
    expect(customer.getDataProperty("companyName").custom).toEqual({ uiHint: "big" });
  });

  test("without allowMerge, a type already in the store is left as it is", () => {
    // Intended: importing the same metadata twice (importEntities does) must be harmless.
    const ms = new MetadataStore();
    ms.importMetadata(TestFns.sampleMetadata);
    const customer = ms.getAsEntityType("Customer");
    ms.importMetadata({ structuralTypes: [{ shortName: "Customer", namespace: customer.namespace, custom: { a: 1 } }] });
    expect(ms.getAsEntityType("Customer")).toBe(customer);
    expect(customer.custom).toBeUndefined();
  });

});
