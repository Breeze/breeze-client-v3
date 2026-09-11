import { EntityManager, NamingConvention, MetadataStore, DataType, breeze, core, Entity, config } from '../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../src/adapter-model-library-backing-store';
import { UtilFns } from './util-fns';

// Choose whether to use the EmployeeTerritoriesNoPayload join table by swapping this import.
// import northwindIBMetadata from './support/NorthwindIBMetadata.json';
import northwindIBMetadata from './support/NorthwindIBMetadata_ETNOPAYLOAD.json';

export class TestFns extends UtilFns {
  // Uncomment just one
  static defaultServerEnvName = "ASPCORE";
  // static defaultServerEnvName = "ASPWEBAPI";

  static serverEnvName: string;
  static defaultServiceName: string;
  
  static metadataStoreIsBeingFetched: boolean;

  static sampleMetadata: string;
  static sampleMetadataStore = TestFns.initSampleMetadataStore();  

  static defaultMetadata: string;
  static defaultMetadataStore: MetadataStore;
  
  static isAspCoreServer: boolean;
  static isAspWebApiServer: boolean;
  static isNHibernateServer: boolean;

  static wellKnownData = {
    nancyID: 1 as any,
    alfredsID: '785efa04-cbf2-4dd7-a7de-083ee17b6ad2' as any,
    dummyOrderID: 999 as any,
    dummyEmployeeID: 9999 as any,
    chaiProductID: 1 as any,
    alfredsOrderDetailKey: { orderID: 10643, productID: 28 /*R?ssle Sauerkraut*/ }, 
    keyNames:  {
      order: "orderID",
      customer: "customerID",
      employee: "employeeID",
      product: "productID",
      user: "id",
      supplier: "supplierID",
      region: "regionID"
    }
  };

  static initNonServerEnv() {
    TestFns.serverEnvName = "NO SERVER";
    TestFns.calcServerTypes(TestFns.serverEnvName);
    TestFns.initAdapters();
  }

  static initServerEnv(serverEnvName?: string) {
    if (serverEnvName == null) {
      serverEnvName = TestFns.defaultServerEnvName;
    }
    TestFns.serverEnvName = serverEnvName.toLocaleUpperCase();

    TestFns.calcServerTypes(serverEnvName);

    TestFns.initAdapters();

    if (TestFns.isAspCoreServer) {
      TestFns.defaultServiceName = 'http://localhost:34377/breeze/NorthwindIBModel';
    } else if (TestFns.isAspWebApiServer) {
      TestFns.defaultServiceName = 'http://localhost:7149/breeze/NorthwindIBModel';
      
    }

  }

  private static calcServerTypes(serverEnvName: string) {
    TestFns.isAspCoreServer = serverEnvName === 'ASPCORE';
    TestFns.isAspWebApiServer = serverEnvName === 'ASPWEBAPI';
    TestFns.isNHibernateServer = serverEnvName === 'NHIBERNATE';
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

// export const testIf = (condition: boolean) => (condition ? test : test.skip);
// export const skipTestIf = (condition: boolean) => (condition ? test.skip : test);
// export const describeIf = (condition: boolean) => (condition ? describe : describe.skip);
// export const skipDescribeIf = (condition: boolean) => (condition ? describe.skip : describe);
export const expectPass = () => expect(true).toBe(true);

export const describeIf = (condition: boolean, name: string, fn: () => void ) => {
  if (condition) {
    return describe(name, fn);
  } else {
    return describe.skip(name, fn);
  }
};

export const skipDescribeIf = (condition: boolean, name: string, fn: () => void ) => {
  if (condition) {
    return describe.skip(name, fn);
  } else {
    return describe(name, fn);
  }
};

export const testIf = (condition: boolean, name: string, fn: () => void) => {
  if (condition) {
    return test(name, fn);
  } else {
    return test.skip(name, fn);
  }
};


export const skipTestIf = (condition: boolean, name: string, fn: () => void) => {
  if (condition) {
    return test.skip(name, fn);
  } else {
    return test(name, fn);
  }
};

// Alt unused approach
// export const skipTestIf = (condition: boolean) => (condition ? { test: test.skip } : { test: test });


