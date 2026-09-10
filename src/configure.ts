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

/** Options accepted by [[configureBreeze]]. */
export interface BreezeSetupOptions {
  /** Model library adapter, e.g. `ModelLibraryBackingStoreAdapter`. */
  modelLibrary?: AdapterRegistration;
  /** Uri builder adapter, e.g. `UriBuilderJsonAdapter`. */
  uriBuilder?: AdapterRegistration;
  /** Ajax adapter, e.g. `AjaxFetchAdapter`. */
  ajax?: AjaxAdapterRegistration;
  /** Data service adapter, e.g. `DataServiceWebApiAdapter`. */
  dataService?: AdapterRegistration;

  /**
   * A custom transport, handed to the ajax adapter. Use this to add auth headers,
   * retry, or to route requests through a framework HTTP client. Defaults to
   * `globalThis.fetch`.
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
 * import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
 * import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
 * import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';
 * import { ModelLibraryBackingStoreAdapter } from 'breeze-client/adapter-model-library-backing-store';
 *
 * configureBreeze({
 *   ajax: AjaxFetchAdapter,
 *   dataService: DataServiceWebApiAdapter,
 *   uriBuilder: UriBuilderJsonAdapter,
 *   modelLibrary: ModelLibraryBackingStoreAdapter,
 *   namingConvention: NamingConvention.camelCase,
 * });
 * ```
 *
 * This replaces the stringly-typed pairs of `config.registerAdapter("ajax", Ctor)` and
 * `config.initializeAdapterInstance("ajax", "fetch", true)`. Those still work and are
 * unchanged, but are deprecated.
 *
 * Adapters are registered in dependency order: the data service adapter resolves the
 * ajax adapter when it initializes, so ajax is registered first.
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
  if (options.ajax) {
    options.ajax.register(cfg, options.fetch);
  } else if (options.fetch) {
    throw new Error("configureBreeze: 'fetch' was supplied without an 'ajax' adapter to use it.");
  }
  if (options.dataService) {
    options.dataService.register(cfg);
  }
  if (options.namingConvention) {
    options.namingConvention.setAsDefault();
  }
}
