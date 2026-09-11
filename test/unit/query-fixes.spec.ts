import {
  configureBreeze, EntityManager, EntityQuery, EntityState, MetadataStore, DataService, NamingConvention,
} from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// Regression tests for query and predicate defects found while writing the user docs.
// No server: local queries run over entities attached in Unchanged state, and remote
// queries go through a fake config.fetch that records each request.

const calls: { url: string, init?: RequestInit }[] = [];
let respond: (url: string, init?: RequestInit) => Response;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

DataServiceWebApiAdapter.register();
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  },
});

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  return new EntityManager({ dataService: ds, metadataStore: ms });
}

beforeEach(() => {
  calls.length = 0;
  respond = () => json([]);
});

function companyNames(results: any[]) {
  return results.map(c => c.getProperty("companyName")).sort();
}

describe("local substring matches the server", () => {
  // The server maps substring(s, start, length) to .NET String.Substring(start, length):
  // the third argument is a length. Locally it used to be JS substring(start, end).
  function managerWithCustomers() {
    const em = newManager();
    ["Alfreds", "Around the Horn", "Blauer See", "Island Trading"].forEach((name, i) => {
      em.createEntity("Customer", { customerID: "00000000-0000-0000-0000-00000000000" + (i + 1), companyName: name },
        EntityState.Unchanged);
    });
    return em;
  }

  test("the third argument is a length", () => {
    const em = managerWithCustomers();
    // chars 1..3 of each name: "lfr", "rou", "lau", "sla"
    const q = EntityQuery.from("Customers").where("substring(companyName, 1, 3)", "==", "lfr");
    expect(companyNames(em.executeQueryLocally(q))).toEqual(["Alfreds"]);

    // with JS substring(1, 3) this matched "Blauer See" ("la"); as a length it cannot
    const q2 = EntityQuery.from("Customers").where("substring(companyName, 1, 2)", "==", "la");
    expect(companyNames(em.executeQueryLocally(q2))).toEqual(["Blauer See"]);
    const q3 = EntityQuery.from("Customers").where("toUpper(substring(companyName, 1, 3))", "==", "LAU");
    expect(companyNames(em.executeQueryLocally(q3))).toEqual(["Blauer See"]);
  });

  test("a start past the first character still takes 'length' characters", () => {
    const em = managerWithCustomers();
    // "Around the Horn".substring(7, 7 + 3) === "the"; JS substring(7, 3) would give "und t"
    const q = EntityQuery.from("Customers").where("substring(companyName, 7, 3)", "==", "the");
    expect(companyNames(em.executeQueryLocally(q))).toEqual(["Around the Horn"]);
  });
});
