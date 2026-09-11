import { config, EntityManager, EntityQuery, NamingConvention } from '../../src/breeze';
import metadata from '../support/NorthwindIBMetadata.json';

// Nothing in this file registers an adapter or calls configureBreeze: it checks what an
// unconfigured application gets. Vitest isolates modules per file, so no other spec's
// registrations leak in. (The naming convention is not an adapter; camelCase is what a
// .NET server needs.)

const serviceName = 'http://example.invalid/breeze/Northwind';
const calls: string[] = [];

NamingConvention.camelCase.setAsDefault();
config.fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  const body: unknown = url.endsWith('/Metadata') ? metadata : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

describe("with no adapters registered", () => {

  test("new EntityManager(serviceName) fetches metadata, queries and creates entities", async () => {
    const em = new EntityManager(serviceName);

    const qr = await em.executeQuery(EntityQuery.from("Customers").where("companyName", "startsWith", "B"));

    expect(qr.results).toEqual([]);
    expect(calls.some(u => u.endsWith("/Metadata"))).toBe(true);
    expect(calls.some(u => u.includes("/Customers?"))).toBe(true);

    const cust = em.createEntity("Customer", { companyName: "Test Co" });
    expect(cust.entityAspect.entityState.isAdded()).toBe(true);
    expect(cust.getProperty("companyName")).toBe("Test Co");
  });

  test("the defaults are the standard adapters", () => {
    expect(config.getAdapterInstance("modelLibrary")!.name).toBe("backingStore");
    expect(config.getAdapterInstance("uriBuilder")!.name).toBe("json");
    expect(config.getAdapterInstance("dataService")!.name).toBe("webApi");
    // No ajax adapter: requests go through config.fetch.
    expect(config.getAdapterInstance("ajax")).toBeUndefined();
  });

});
