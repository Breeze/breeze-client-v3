import { config, setDefaultAdapters } from './config.js';
import { AjaxFetchAdapter, defaultFetch } from './http.js';
import { ModelLibraryBackingStoreAdapter } from './adapter-model-library-backing-store.js';
import { UriBuilderJsonAdapter } from './adapter-uri-builder-json.js';
import { DataServiceWebApiAdapter } from './adapter-data-service-webapi.js';

/*
 * The adapters Breeze uses when an application registers none. With no configuration at
 * all, `new EntityManager(serviceName)` tracks changes with the backing-store model library,
 * builds Breeze JSON query URLs, talks to a Breeze .NET server, and sends its requests through
 * `config.fetch` (globalThis.fetch unless set).
 *
 * Nothing is registered here. This fills a fallback table; config.ts registers a default only
 * when an interface is first asked for and nothing has been registered for it, so anything an
 * application registers - before or after - wins.
 *
 * Only the root barrel imports this module. The adapter modules must not import the barrel,
 * or this becomes an import cycle that fails at load time: DataServiceWebApiAdapter extends
 * AbstractDataServiceAdapter while its module loads.
 */

/** What a 2.x-style `initializeAdapterInstance('ajax', 'fetch')` gets: an ajax adapter that
    reads config.fetch on every request, as the default path does. */
class ConfiguredFetchAjaxAdapter extends AjaxFetchAdapter {
  constructor() {
    super((input, init) => (config.fetch || defaultFetch)(input, init));
  }
}

setDefaultAdapters({
  modelLibrary: { ctor: ModelLibraryBackingStoreAdapter },
  uriBuilder: { ctor: UriBuilderJsonAdapter },
  dataService: { ctor: DataServiceWebApiAdapter },
  // Never the unnamed default: with no ajax adapter, requests already go through config.fetch.
  ajax: { ctor: ConfiguredFetchAjaxAdapter, namedOnly: true },
});
