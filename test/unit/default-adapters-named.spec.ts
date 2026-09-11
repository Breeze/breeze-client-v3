import { config } from '../../src/breeze';

// 2.x registered adapters as an import side effect, so 2.x startup code often initialized
// them by name without ever calling registerAdapter. With nothing registered in this file
// (Vitest isolates modules per file), those names must resolve to the default adapters.

describe("2.x-style initialization by name, with nothing registered", () => {

  test("initializeAdapterInstance finds each default adapter by its name", () => {
    expect(config.initializeAdapterInstance("modelLibrary", "backingStore", true).name).toBe("backingStore");
    expect(config.initializeAdapterInstance("uriBuilder", "json", true).name).toBe("json");
    expect(config.initializeAdapterInstance("dataService", "webApi", true).name).toBe("webApi");
    expect(config.initializeAdapterInstance("ajax", "fetch", true).name).toBe("fetch");
  });

  test("the named 'fetch' ajax adapter sends requests through config.fetch", async () => {
    const seen: string[] = [];
    config.fetch = async (input) => {
      seen.push(String(input));
      return new Response("[]", { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ajax = config.getAdapterInstance<any>("ajax");
    await new Promise<void>((resolve, reject) => ajax.ajax({
      type: "GET", url: "http://example.invalid/breeze/Thing", success: () => resolve(), error: reject,
    }));
    expect(seen).toEqual(["http://example.invalid/breeze/Thing"]);
  });

  test("a name that is not a default still fails", () => {
    expect(() => config.initializeAdapterInstance("dataService", "noSuchAdapter", true)).toThrow(/Unregistered adapter/);
  });

});
