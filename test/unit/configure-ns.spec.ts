import {
  configureBreeze, config, NamingConvention, EntityManager, MetadataStore,
  BreezeFetch, AjaxAdapter, DataServiceAdapter, UriBuilderAdapter, ModelLibraryAdapter,
} from '../../src/breeze';
import { AjaxFetchAdapter } from '../../src/adapter-ajax-fetch';
import { DataServiceWebApiAdapter } from '../../src/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapter-model-library-backing-store';

// No server needed - this only exercises configuration.

describe("configureBreeze", () => {

  test("wires all four adapters in one typed call", () => {
    configureBreeze({
      ajax: AjaxFetchAdapter,
      dataService: DataServiceWebApiAdapter,
      uriBuilder: UriBuilderJsonAdapter,
      modelLibrary: ModelLibraryBackingStoreAdapter,
    });

    expect(config.getAdapterInstance<AjaxAdapter>("ajax")!.name).toBe("fetch");
    expect(config.getAdapterInstance<DataServiceAdapter>("dataService")!.name).toBe("webApi");
    expect(config.getAdapterInstance<UriBuilderAdapter>("uriBuilder")!.name).toBe("json");
    expect(config.getAdapterInstance<ModelLibraryAdapter>("modelLibrary")!.name).toBe("backingStore");
  });

  test("sets the default NamingConvention", () => {
    configureBreeze({
      modelLibrary: ModelLibraryBackingStoreAdapter,
      namingConvention: NamingConvention.camelCase,
    });
    expect(NamingConvention.defaultInstance.name).toBe("camelCase");

    // put it back for the rest of the suite
    configureBreeze({ namingConvention: NamingConvention.camelCase });
  });

  test("injects a custom fetch into the ajax adapter", async () => {
    const calls: string[] = [];
    const fakeFetch: BreezeFetch = async (input, init) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    configureBreeze({ ajax: AjaxFetchAdapter, fetch: fakeFetch });

    const adapter = config.getAdapterInstance<AjaxAdapter>("ajax") as AjaxFetchAdapter;
    expect(adapter.fetchFn).toBe(fakeFetch);

    // and it is actually used
    await new Promise<void>((resolve, reject) => {
      adapter.ajax({
        type: "GET",
        url: "http://example.invalid/breeze/Thing",
        success: () => resolve(),
        error: (e) => reject(e),
      });
    });
    expect(calls).toEqual(["http://example.invalid/breeze/Thing"]);

    // restore the real transport for any later file
    configureBreeze({ ajax: AjaxFetchAdapter });
    expect((config.getAdapterInstance<AjaxAdapter>("ajax") as AjaxFetchAdapter).fetchFn).not.toBe(fakeFetch);
  });

  test("a 200 whose body is not JSON fails instead of hanging", async () => {
    // e.g. a proxy or auth layer answering with an HTML login page. The body promise used
    // to be dropped, so neither callback ever ran and the query never settled.
    const htmlFetch: BreezeFetch = async () => new Response("<html>Please sign in</html>", {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    configureBreeze({ ajax: AjaxFetchAdapter, fetch: htmlFetch });
    const adapter = config.getAdapterInstance<AjaxAdapter>("ajax") as AjaxFetchAdapter;

    const outcome = await new Promise<any>((resolve) => {
      adapter.ajax({
        type: "GET",
        url: "http://example.invalid/breeze/Thing",
        success: () => resolve("success"),
        error: (httpResponse) => resolve(httpResponse),
      });
    });
    expect(outcome).not.toBe("success");
    expect(outcome.status).toBe(200);

    configureBreeze({ ajax: AjaxFetchAdapter });
  });

  test("a fetch supplied without an ajax adapter becomes config.fetch", () => {
    // This used to throw: Breeze needed an ajax adapter to hand the function to.
    const fn: BreezeFetch = async () => new Response("{}");
    configureBreeze({ fetch: fn });
    expect(config.fetch).toBe(fn);
    config.fetch = undefined;
  });

  test("the deprecated string-based API still works alongside it", () => {
    // This is the 2.x startup shape. It must keep working.
    config.registerAdapter("ajax", AjaxFetchAdapter);
    const inst = config.initializeAdapterInstance("ajax", "fetch", true);
    expect(inst.name).toBe("fetch");
    expect(config.getAdapterInstance<AjaxAdapter>("ajax")!.name).toBe("fetch");
  });

  test("the deprecated initializeAdapterInstances initializes each named adapter", () => {
    // Broken in 2.x and in v3 until this test existed: it walked every property of the
    // global config instead of its argument, and threw.
    config.registerAdapter("ajax", AjaxFetchAdapter);
    config.registerAdapter("dataService", DataServiceWebApiAdapter);
    config.initializeAdapterInstances({ dataService: "webApi", ajax: "fetch" });
    expect(config.getAdapterInstance<AjaxAdapter>("ajax")!.name).toBe("fetch");
    expect(config.getAdapterInstance<DataServiceAdapter>("dataService")!.name).toBe("webApi");
    // and does not copy its argument onto the global config
    expect(Object.keys(config)).not.toContain("dataService");
  });

  test("initializeAdapterInstances rejects an unknown interface name", () => {
    expect(() => config.initializeAdapterInstances({ ajx: "fetch" } as any)).toThrow(/Unknown property/);
  });

  test("configuration is enough to build an EntityManager", () => {
    configureBreeze({
      ajax: AjaxFetchAdapter,
      dataService: DataServiceWebApiAdapter,
      uriBuilder: UriBuilderJsonAdapter,
      modelLibrary: ModelLibraryBackingStoreAdapter,
      namingConvention: NamingConvention.camelCase,
    });
    const em = new EntityManager({ serviceName: "http://example.invalid/breeze/Test" });
    expect(em.metadataStore).toBeInstanceOf(MetadataStore);
  });

});
