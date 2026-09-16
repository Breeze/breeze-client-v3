import { EntityManager, NamingConvention, MetadataStore, DataType, breeze, core, Entity, config } from '../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../src/adapters/adapter-model-library-backing-store';
import { UtilFns } from './util-fns';

// Choose whether to use the EmployeeTerritoriesNoPayload join table by swapping this import.
// import northwindIBMetadata from './support/NorthwindIBMetadata.json';
import northwindIBMetadata from './support/NorthwindIBMetadata_ETNOPAYLOAD.json';

export class TestFns extends UtilFns {

  static defaultServiceName: string;
  
  static metadataStoreIsBeingFetched: boolean;

  static sampleMetadata: string;
  static sampleMetadataStore = TestFns.initSampleMetadataStore();  

  static defaultMetadata: string;
  static defaultMetadataStore: MetadataStore;
  

  static wellKnownData = {
    nancyID: 1 as any,
    alfredsID: '785efa04-cbf2-4dd7-a7de-083ee17b6ad2' as any,
    dummyOrderID: 999 as any,
    dummyEmployeeID: 9999 as any,
    chaiProductID: 1 as any,
    alfredsOrderDetailKey: { orderID: 10643, productID: 28 /*R?ssle Sauerkraut*/ }, 
    // `as const` so these stay string literals rather than widening to `string`. A literal is a
    // property path the compiler can check; a `string` is not, so it would only ever reach the
    // unchecked overload.
    keyNames:  {
      order: "orderID",
      customer: "customerID",
      employee: "employeeID",
      product: "productID",
      user: "id",
      supplier: "supplierID",
      region: "regionID"
    } as const
  };

  static initNonServerEnv() {
    TestFns.initAdapters();
  }

  /** The .NET test host. It is the only server the suite runs against; the 2.x-era switch
  between ASPCORE, ASPWEBAPI and NHIBERNATE is gone, along with the flags that read it. */
  static initServerEnv() {
    TestFns.defaultServiceName = 'http://localhost:34377/breeze/NorthwindIBModel';
    TestFns.initAdapters();
  }

  private static initAdapters() {
    // No adapters are registered. Breeze falls back to its defaults - backing-store model
    // library, JSON uri builder, Web API data service, requests through config.fetch - so the
    // integration and browser tiers exercise exactly what an unconfigured application gets.

    // No naming convention is set either: the default, camelCase, is what the .NET test
    // server needs.
  }

  static async initDefaultMetadataStore() {
    if (TestFns.defaultMetadataStore == null) {
      const ms = new MetadataStore();
      await ms.fetchMetadata(TestFns.defaultServiceName);
      TestFns.defaultMetadata = ms.exportMetadata();
      TestFns.defaultMetadataStore = ms;  
    }
    return TestFns.defaultMetadataStore;
  }

  static initSampleMetadataStore(): MetadataStore {
    if (TestFns.sampleMetadataStore == null) {
      let ms = new MetadataStore();
      ModelLibraryBackingStoreAdapter.register();
      // Import is faster with a string than with an already created object.
      TestFns.sampleMetadata = JSON.stringify(northwindIBMetadata);
      ms.importMetadata(TestFns.sampleMetadata);
      TestFns.sampleMetadataStore = ms;
    }
    return TestFns.sampleMetadataStore;
  }

  static newEntityManager(metadataStore?: MetadataStore) {
    let em: EntityManager;
    if (metadataStore) {
      em = new EntityManager({ serviceName: TestFns.defaultServiceName, metadataStore: metadataStore });
    } else if (TestFns.defaultMetadataStore) {
      em = new EntityManager({ serviceName: TestFns.defaultServiceName, metadataStore: TestFns.defaultMetadataStore });
    } else if (TestFns.sampleMetadataStore) {
      em = new EntityManager({ serviceName: TestFns.defaultServiceName, metadataStore: TestFns.sampleMetadataStore });
    } else {
      em = new EntityManager({ serviceName: TestFns.defaultServiceName });
    }
    return em;
  }

  static getCustomerCtor() {
    const ctor = function () {
      this.miscData = "asdf";
      this.getNameLength = function () {
        return (this.getProperty("companyName") || "").length;
      };
    };
    return ctor;
  }
  

  static getCustomerWithES5PropsCtor() {
    const ctor = function () {    };
    TestFns.createES5Props(ctor.prototype);
    return ctor;
  }

  static createES5Props(target: any) {
    Object.defineProperty(target, "companyName", {
      get: function () {
        return this["_companyName"] || null;
      },
      set: function (value) {
        this["_companyName"] = value && value.toUpperCase();
      },
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(target, "idAndName", {
      get: function () {
        return this.customerID + ":" + (this._companyName || "");
      },
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(target, "miscData", {
      get: function () {
        return this["_miscData"] || "asdf";
      },
      set: function (value) {
        this["_miscData"] = value;
      },
      enumerable: true,
      configurable: true
    });
  }
 
  
}

export type JsonObj = {[k: string]: any};

// Vitest has test.skip and describe.skip; the conditional wrappers that used to live here were
// for switching whole files on and off per server flavour, which no longer exists.
export const expectPass = () => expect(true).toBe(true);

