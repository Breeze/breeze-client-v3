import { BreezeConfig, config } from './config';
import { BreezeFetch } from './interface-registry';
import { NamingConvention } from './naming-convention';

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
  /** Model library adapter, e.g. `ModelLibraryBackingStoreAdapter`. */
  modelLibrary?: AdapterRegistration;
  /** Uri builder adapter, e.g. `UriBuilderJsonAdapter`. */
  uriBuilder?: AdapterRegistration;
  /**
   * @deprecated Breeze no longer needs an ajax adapter: requests go through `fetch`.
   * Passing one still works. It is registered as in 2.x and used instead of `config.fetch`,
   * and is handed `fetch` as its transport if you supply both.
   */
  ajax?: AjaxAdapterRegistration;
  /** Data service adapter, e.g. `DataServiceWebApiAdapter`. */
  dataService?: AdapterRegistration;

  /**
   * The function Breeze makes every HTTP request with. Use it to add auth headers, retry or
   * logging, or to route requests through a framework HTTP client. Sets `config.fetch`;
   * defaults to `globalThis.fetch`.
   */
  fetch?: BreezeFetch;

  /** Sets the default NamingConvention, e.g. `NamingConvention.camelCase`. */
  namingConvention?: NamingConvention;

  /** Prohibit `eval()` and `Function()` in breeze code, for strict CSP environments. */
  noEval?: boolean;

  /** Configure a BreezeConfig other than the global one. Rarely needed. */
  config?: BreezeConfig;
}

/**
 * Configures Breeze in a single typed call.
 *
 * ```ts
 * import { configureBreeze, NamingConvention } from 'breeze-client';
 * import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
 * import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';
 * import { ModelLibraryBackingStoreAdapter } from 'breeze-client/adapter-model-library-backing-store';
 *
 * configureBreeze({
 *   dataService: DataServiceWebApiAdapter,
 *   uriBuilder: UriBuilderJsonAdapter,
 *   modelLibrary: ModelLibraryBackingStoreAdapter,
 *   namingConvention: NamingConvention.camelCase,
 * });
 * ```
 *
 * This replaces the stringly-typed pairs of `config.registerAdapter("dataService", Ctor)`
 * and `config.initializeAdapterInstance("dataService", "webApi", true)`. Those still work and
 * are unchanged, but are deprecated.
 *
 * No ajax adapter is needed. Requests go through `fetch`, which defaults to
 * `globalThis.fetch`; pass your own to add auth headers, retry or logging.
 */
export function configureBreeze(options: BreezeSetupOptions): void {
  const cfg = options.config || config;

  if (options.noEval !== undefined) {
    cfg.noEval = options.noEval;
  }
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
