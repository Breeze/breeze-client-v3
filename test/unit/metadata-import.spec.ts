import { MetadataStore } from '../../src/breeze';
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
    const csdl = { schema: { namespace: "Northwind", entityType: [] } };
    expect(() => new MetadataStore().importMetadata(csdl)).toThrow(/CSDL/);
  });

});
