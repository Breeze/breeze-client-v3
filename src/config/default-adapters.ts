import { config } from './config.js';
import type { AdapterType, DefaultAdapter } from './config.js';
import { AjaxFetchAdapter, defaultFetch } from '../adapters/http.js';
import { UriBuilderJsonAdapter } from '../adapters/adapter-uri-builder-json.js';
import { DataServiceWebApiAdapter } from '../adapters/adapter-data-service-webapi.js';

/*
 * The adapters Breeze uses when an application registers none. With no configuration at
 * all, `new EntityManager(serviceName)` tracks changes with the backing-store model library,
 * builds Breeze JSON query URLs, talks to a Breeze .NET server, and sends its requests through
 * `config.fetch` (globalThis.fetch unless set).
 *
 * Nothing is registered here. These fill a fallback table; config.ts registers a default only
 * when an interface is first asked for and nothing has been registered for it, so anything an
 * application registers - before or after - wins.
 *
 * entity-manager.ts installs them, when it loads, by passing `serverDefaultAdapters` to
 * setDefaultAdapters. Using a value from this module is what keeps it in a bundle: an import
 * for effect alone would be dropped under "sideEffects": false (see CHANGES-DEV.md). The model
 * library default is installed by entity-metadata.ts instead, because a MetadataStore needs one
 * even in a bundle with no EntityManager.
 *
 * Only entity-manager.ts imports this module, and nothing this module depends on may import it -
 * entity-metadata.ts, say, or the barrel. That is an import cycle that fails at load time whenever
 * abstract-data-service-adapter.ts loads first: DataServiceWebApiAdapter extends
 * AbstractDataServiceAdapter while its module loads.
 */

/** What a 2.x-style `initializeAdapterInstance('ajax', 'fetch')` gets: an ajax adapter that
    reads config.fetch on every request, as the default path does. */
class ConfiguredFetchAjaxAdapter extends AjaxFetchAdapter {
  constructor() {
    super((input, init) => (config.fetch || defaultFetch)(input, init));
  }
}

/** The defaults for the server-facing interfaces. @hidden @internal */
export const serverDefaultAdapters: Partial<Record<AdapterType, DefaultAdapter>> = {
  uriBuilder: { ctor: UriBuilderJsonAdapter },
  dataService: { ctor: DataServiceWebApiAdapter },
  // Never the unnamed default: with no ajax adapter, requests already go through config.fetch.
  ajax: { ctor: ConfiguredFetchAjaxAdapter, namedOnly: true },
};
