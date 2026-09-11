import {
  configureBreeze, config, EntityManager, EntityQuery, MetadataStore, DataService, NamingConvention,
} from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// No ajax adapter is registered anywhere in this file, so every request has to go through
// config.fetch. Vitest isolates modules per file, so no other spec's registrations leak in.

const calls: { url: string, init?: RequestInit }[] = [];
let respond: (url: string, init?: RequestInit) => Response;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// The data service adapter is registered FIRST, on purpose. While Breeze required an ajax
// adapter, this order threw "Unable to find ajax adapter for dataservice adapter 'webApi'".
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

describe("requests without an ajax adapter", () => {

  test("none is registered", () => {
    expect(config.getAdapterInstance("ajax")).toBeUndefined();
  });

  test("a query goes through config.fetch", async () => {
    const qr = await newManager().executeQuery(EntityQuery.from("Customers").where("companyName", "startsWith", "B"));
    expect(qr.results).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("http://example.invalid/breeze/Northwind/Customers?");
    expect(calls[0].init!.method).toBe("GET");
  });

  test("a GET carries no Content-Type, so it needs no CORS preflight", async () => {
    await newManager().executeQuery(EntityQuery.from("Customers"));
    expect((calls[0].init!.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  test("a save goes through config.fetch as a JSON POST", async () => {
    // Echo the saved entities back, the way the server would.
    respond = (url, init) => {
      const bundle = JSON.parse(init!.body as string);
      bundle.entities.forEach((e: any) => {
        e.$type = e.entityAspect.entityTypeName;
        delete e.entityAspect;
      });
      return json(bundle);
    };
    const em = newManager();
    em.createEntity("Customer", { companyName: "Test Co" });

    const sr = await em.saveChanges();

    expect(sr.entities).toHaveLength(1);
    expect(calls[0].url).toBe("http://example.invalid/breeze/Northwind/SaveChanges");
    expect(calls[0].init!.method).toBe("POST");
    expect((calls[0].init!.headers as Record<string, string>)['Content-Type']).toBe("application/json");
  });

  test("an HTTP error rejects with the server's message and status", async () => {
    respond = () => json({ Message: "Not today" }, 500);
    await expect(newManager().executeQuery(EntityQuery.from("Customers")))
      .rejects.toMatchObject({ status: 500, message: "Not today" });
  });

  test("a transport failure rejects with status 0", async () => {
    respond = () => { throw new TypeError("fetch failed"); };
    await expect(newManager().executeQuery(EntityQuery.from("Customers")))
      .rejects.toMatchObject({ status: 0 });
  });

  test("a 200 whose body is not JSON rejects instead of hanging", async () => {
    respond = () => new Response("<html>Please sign in</html>", { status: 200, headers: { 'Content-Type': 'text/html' } });
    await expect(newManager().executeQuery(EntityQuery.from("Customers")))
      .rejects.toMatchObject({ status: 200 });
  });

  test("config.fetch is read per request, so it can change after setup", async () => {
    const seen: string[] = [];
    const saved = config.fetch;
    config.fetch = async (input) => { seen.push(String(input)); return json([]); };
    try {
      await newManager().executeQuery(EntityQuery.from("Customers"));
    } finally {
      config.fetch = saved;
    }
    expect(seen).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

});

describe("a manager built from a serviceName and a MetadataStore", () => {

  const serviceName = 'http://example.invalid/breeze/Northwind';

  test("uses the store's DataService for that service, and requests no /Metadata", async () => {
    // The manager used to build a DataService of its own, ignoring the store's settings.
    const ms = new MetadataStore();
    ms.importMetadata(metadata);
    const ds = new DataService({ serviceName, hasServerMetadata: false });
    ms.addDataService(ds);

    const em = new EntityManager({ serviceName, metadataStore: ms });

    expect(em.dataService).toBe(ds);
    expect(em.dataService.hasServerMetadata).toBe(false);
    await em.executeQuery(EntityQuery.from("Customers"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("/Metadata");
  });

  test("uses the DataService that exported metadata carried, and requests no /Metadata", async () => {
    const source = new MetadataStore();
    source.importMetadata(metadata);
    source.addDataService(new DataService({ serviceName, hasServerMetadata: false }));
    const ms = MetadataStore.importMetadata(source.exportMetadata());

    const em = new EntityManager({ serviceName, metadataStore: ms });

    expect(em.dataService).toBe(ms.getDataService(serviceName));
    expect(em.dataService.hasServerMetadata).toBe(false);
    await em.executeQuery(EntityQuery.from("Customers"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain("/Metadata");
  });

  test("builds its own DataService when the store has none for that service", () => {
    const ms = new MetadataStore();
    ms.importMetadata(metadata);
    const em = new EntityManager({ serviceName, metadataStore: ms });
    expect(em.dataService.serviceName).toBe(serviceName + '/');
    expect(ms.getDataService(serviceName)).toBeFalsy();
  });

});
