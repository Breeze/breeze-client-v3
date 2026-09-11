import {
  configureBreeze, EntityManager, EntityQuery, EntityState, FilterQueryOp, MetadataStore, DataService, NamingConvention,
  Predicate,
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

describe("FilterQueryOp.IsTypeOf is gone", () => {
  // It was defined, but no parser (client or server) knows 'isof', so using it always threw
  // "Unable to resolve predicate". It was removed rather than half-supported.
  test("IsTypeOf is not defined", () => {
    expect((FilterQueryOp as any).IsTypeOf).toBeUndefined();
    expect(FilterQueryOp.getSymbols().map(op => op.operator)).not.toContain("isof");
  });

  test("every FilterQueryOp that is defined can be used in a predicate", () => {
    const em = newManager();
    const custType = em.metadataStore.getAsEntityType("Customer");
    FilterQueryOp.getSymbols().forEach(op => {
      let pred: Predicate;
      if (op === FilterQueryOp.Any || op === FilterQueryOp.All) {
        pred = Predicate.create("orders", op, "freight", ">", 100);
      } else if (op === FilterQueryOp.In) {
        pred = Predicate.create("companyName", op, ["A", "B"]);
      } else {
        pred = Predicate.create("companyName", op, "A");
      }
      expect(() => pred._validate(custType)).not.toThrow();
    });
  });
});

describe("a where-value object honours isLiteral", () => {
  function managerWithEmployees() {
    const em = newManager();
    em.createEntity("Employee", { employeeID: 1, firstName: "Pat", lastName: "Pat" }, EntityState.Unchanged);
    em.createEntity("Employee", { employeeID: 2, firstName: "lastName", lastName: "Smith" }, EntityState.Unchanged);
    em.createEntity("Employee", { employeeID: 3, firstName: "Ann", lastName: "Lee" }, EntityState.Unchanged);
    return em;
  }
  function ids(results: any[]) {
    return results.map(e => e.getProperty("employeeID")).sort();
  }

  test("isLiteral: false forces a property expression", () => {
    const em = managerWithEmployees();
    const q = EntityQuery.from("Employees").where("firstName", "==", { value: "lastName", isLiteral: false });
    expect(ids(em.executeQueryLocally(q))).toEqual([1]);
  });

  test("isLiteral: true forces a literal", () => {
    const em = managerWithEmployees();
    const q = EntityQuery.from("Employees").where("firstName", "==", { value: "lastName", isLiteral: true });
    expect(ids(em.executeQueryLocally(q))).toEqual([2]);
  });

  test("the server receives a property for isLiteral: false and a literal for isLiteral: true", async () => {
    const em = newManager();
    const empType = em.metadataStore.getAsEntityType("Employee");
    const sv = (name: string) => empType.clientPropertyPathToServer(name);
    // the where clause as it goes over the wire, in the URL
    const sentWhere = async (value: any) => {
      calls.length = 0;
      await em.executeQuery(EntityQuery.from("Employees").where("firstName", "==", value));
      const url = decodeURIComponent(calls[0].url);
      return JSON.parse(url.slice(url.indexOf("?") + 1)).where;
    };

    expect(await sentWhere({ value: "lastName", isLiteral: false }))
      .toEqual({ [sv("firstName")]: { value: sv("lastName"), isProperty: true } });

    const litJson = JSON.stringify(await sentWhere({ value: "lastName", isLiteral: true }));
    expect(litJson).toContain('"lastName"');
    expect(litJson).not.toContain("isProperty");
  });
});

describe("toJSON keeps usePost", () => {
  test("usePost survives a toJSON / fromJSON round trip", () => {
    const q = EntityQuery.from("Customers").where("companyName", "startsWith", "A").usePost();
    const json = JSON.parse(JSON.stringify(q));
    expect(json.usePost).toBe(true);

    const q2 = new EntityQuery(json);
    expect(q2.usePostEnabled).toBe(true);
    expect(JSON.stringify(q2)).toEqual(JSON.stringify(q));
  });

  test("a query without usePost does not write it", () => {
    expect(EntityQuery.from("Customers").toJSON()).not.toHaveProperty("usePost");
    expect(new EntityQuery(EntityQuery.from("Customers").toJSON()).usePostEnabled).toBeFalsy();
  });
});

describe("withParameters values are sent once, as query-string arguments", () => {
  // The ASP.NET Core server binds them from the query string ([FromQuery] and plain
  // action parameters). BreezeQueryFilter reads only the JSON, and never used a
  // "parameters" copy inside it.
  function split(url: string) {
    const [path, query = ""] = url.split("?");
    const amp = query.startsWith("%7B") ? query.indexOf("&") : 0;
    const jsonPart = amp < 0 ? query : query.slice(0, amp);
    const rest = amp < 0 ? "" : query.slice(amp).replace(/^&/, "");
    return { path, json: jsonPart ? JSON.parse(decodeURIComponent(jsonPart)) : undefined, args: decodeURIComponent(rest) };
  }

  test("a GET puts them after the JSON, and not in it", async () => {
    await newManager().executeQuery(
      EntityQuery.from("SearchEmployees").withParameters({ employeeIds: [1, 4], city: "Seattle" }).take(2));
    const { path, json, args } = split(calls[0].url);
    expect(path).toBe("http://example.invalid/breeze/Northwind/SearchEmployees");
    expect(json).toEqual({ take: 2 });
    expect(args).toBe("employeeIds[0]=1&employeeIds[1]=4&city=Seattle");
  });

  test("a GET with nothing but parameters sends no JSON at all", async () => {
    await newManager().executeQuery(EntityQuery.from("CustomersStartingWith").withParameters({ companyName: "C" }));
    expect(calls[0].url).toBe("http://example.invalid/breeze/Northwind/CustomersStartingWith?companyName=C");
  });

  test("a POST keeps them in the query string and out of the body", async () => {
    await newManager().executeQuery(EntityQuery.from("CustomersStartingWith")
      .withParameters({ companyName: "C" }).where("city", "==", "London").usePost());
    expect(calls[0].init!.method).toBe("POST");
    expect(calls[0].url).toBe("http://example.invalid/breeze/Northwind/CustomersStartingWith?companyName=C");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).not.toHaveProperty("parameters");
    expect(body).not.toHaveProperty("usePost");
    expect(body.where).toBeDefined();
  });

  test("toJSON still keeps them", () => {
    const q = EntityQuery.from("CustomersStartingWith").withParameters({ companyName: "C" });
    expect(q.toJSON()).toMatchObject({ parameters: { companyName: "C" } });
    expect(new EntityQuery(q.toJSON()).parameters).toEqual({ companyName: "C" });
  });
});

describe("untyped query results fall back to the resource's entity type", () => {
  // MappingContext asks the query for a type for each root node the JsonResultsAdapter
  // could not type (no $type, or one not in metadata). _getToEntityType computed the type
  // mapped to the resource name and then dropped it, so only toType() ever worked.
  const ids = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];

  test("root nodes without $type become entities of the resource's type", async () => {
    respond = () => json([{ CustomerID: ids[0], CompanyName: "Acme" }, { CustomerID: ids[1], CompanyName: "Bolt" }]);
    const em = newManager();
    const custType = em.metadataStore.getAsEntityType("Customer");

    const qr = await em.executeQuery(EntityQuery.from("Customers"));

    expect(qr.results).toHaveLength(2);
    qr.results.forEach((c: any) => {
      expect(c.entityType).toBe(custType);
      expect(c.entityAspect.entityState.isUnchanged()).toBe(true);
    });
    expect(qr.results.map((c: any) => c.getProperty("companyName"))).toEqual(["Acme", "Bolt"]);
    expect(em.getEntities("Customer")).toHaveLength(2);
  });

  test("a resource with no mapped type still returns plain objects", async () => {
    respond = () => json([{ CustomerID: ids[0], CompanyName: "Acme" }]);
    const em = newManager();
    const qr = await em.executeQuery(EntityQuery.from("CustomersStartingWith"));
    expect(qr.results).toEqual([{ customerID: ids[0], companyName: "Acme" }]);
    expect(em.getEntities()).toHaveLength(0);
  });

  test("a projection still returns plain objects", async () => {
    respond = () => json([{ CompanyName: "Acme" }]);
    const em = newManager();
    const qr = await em.executeQuery(EntityQuery.from("Customers").select("companyName"));
    expect(qr.results).toEqual([{ companyName: "Acme" }]);
    expect(em.getEntities()).toHaveLength(0);
  });

  test("toType still decides for an unmapped resource", async () => {
    respond = () => json([{ CustomerID: ids[0], CompanyName: "Acme" }]);
    const em = newManager();
    const qr = await em.executeQuery(EntityQuery.from("CustomersStartingWith").toType("Customer"));
    expect(qr.results[0].entityType).toBe(em.metadataStore.getAsEntityType("Customer"));
  });
});
