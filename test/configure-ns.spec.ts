import {
  configureBreeze, config, NamingConvention, EntityManager, MetadataStore,
  BreezeFetch, AjaxAdapter, DataServiceAdapter, UriBuilderAdapter, ModelLibraryAdapter,
} from '../src/breeze';
import { AjaxFetchAdapter } from '../src/adapter-ajax-fetch';
import { DataServiceWebApiAdapter } from '../src/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../src/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../src/adapter-model-library-backing-store';

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

  test("rejects a fetch supplied without an ajax adapter", () => {
    const fn: BreezeFetch = async () => new Response("{}");
    expect(() => configureBreeze({ fetch: fn })).toThrow(/without an 'ajax' adapter/);
  });

  test("the deprecated string-based API still works alongside it", () => {
    // This is the 2.x startup shape. It must keep working.
    config.registerAdapter("ajax", AjaxFetchAdapter);
    const inst = config.initializeAdapterInstance("ajax", "fetch", true);
    expect(inst.name).toBe("fetch");
    expect(config.getAdapterInstance<AjaxAdapter>("ajax")!.name).toBe("fetch");
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
