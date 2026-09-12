import { BreezeConfig, config } from './config.js';
import { BreezeFetch } from './interface-registry.js';
import { NamingConvention } from '../metadata/naming-convention.js';

/**
 * Anything with a static `register` method - which is every Breeze adapter.
 * @hidden
 */
export interface AdapterRegistration {
  register(breezeConfig?: BreezeConfig, ...rest: any[]): any;
}

/** An ajax adapter, which may additionally accept a custom transport. */
export interface AjaxAdapterRegistration {
  register(breezeConfig?: BreezeConfig, fetchFn?: BreezeFetch): any;
}

/** Options accepted by {@link configureBreeze}. */
export interface BreezeSetupOptions {
  /** Model library adapter. Defaults to `ModelLibraryBackingStoreAdapter`. */
  modelLibrary?: AdapterRegistration;
  /** Uri builder adapter. Defaults to `UriBuilderJsonAdapter`. */
  uriBuilder?: AdapterRegistration;
  /**
   * @deprecated Breeze no longer needs an ajax adapter: requests go through `fetch`.
   * Passing one still works. It is registered as in 2.x and used instead of `config.fetch`,
   * and is handed `fetch` as its transport if you supply both.
   */
  ajax?: AjaxAdapterRegistration;
  /** Data service adapter. Defaults to `DataServiceWebApiAdapter`. */
  dataService?: AdapterRegistration;

  /**
   * The function Breeze makes every HTTP request with. Use it to add auth headers, retry or
   * logging, or to route requests through a framework HTTP client. Sets `config.fetch`;
   * defaults to `globalThis.fetch`.
   */
  fetch?: BreezeFetch;

  /** Sets the default NamingConvention. Defaults to `NamingConvention.camelCase`; use `NamingConvention.none` when the server already sends the names the client should use. */
  namingConvention?: NamingConvention;

  /** Configure a BreezeConfig other than the global one. Rarely needed. */
  config?: BreezeConfig;
}

/**
 * Configures Breeze in a single typed call.
 *
 * Every option is optional, and a Breeze .NET server needs none of them. With no call at
 * all, Breeze uses its default adapters - the backing-store model library, the JSON uri
 * builder and the Web API data service - sends requests through `globalThis.fetch`, and
 * maps property names with `NamingConvention.camelCase`.
 *
 * ```ts
 * import { configureBreeze, NamingConvention } from 'breeze-client';
 *
 * // a server that already sends the names the client should use, with an auth transport
 * configureBreeze({ namingConvention: NamingConvention.none, fetch: myAuthFetch });
 * ```
 *
 * Pass an adapter to replace a default, e.g. `configureBreeze({ dataService: MyAdapter })`.
 *
 * This replaces the stringly-typed pairs of `config.registerAdapter("dataService", Ctor)`
 * and `config.initializeAdapterInstance("dataService", "webApi", true)`. Those still work and
 * are unchanged, but are deprecated.
 */
export function configureBreeze(options: BreezeSetupOptions): void {
  const cfg = options.config || config;

  if (options.modelLibrary) {
    options.modelLibrary.register(cfg);
  }
  if (options.uriBuilder) {
    options.uriBuilder.register(cfg);
  }
  if (options.fetch) {
    cfg.fetch = options.fetch;
  }
  if (options.ajax) {
    // Deprecated path. A registered ajax adapter takes precedence over config.fetch, so it
    // is handed the same transport.
    options.ajax.register(cfg, options.fetch);
  }
  if (options.dataService) {
    options.dataService.register(cfg);
  }
  if (options.namingConvention) {
    options.namingConvention.setAsDefault();
  }
}
