import type { BaseAdapter } from './config.js';
import { MappingContext } from '../query/mapping-context.js';
import { EntityQuery } from '../query/entity-query.js';
import { MetadataStore } from '../metadata/entity-metadata.js';
import { JsonResultsAdapter, DataService } from '../metadata/data-service.js';
import { Entity } from '../entity/entity-aspect.js';
import { SaveContext, SaveBundle, QueryResult, SaveResult, HttpResponse } from '../manager/entity-manager.js';

// InterfaceRegistry - and config.interfaceRegistry and config.initializeAdapterInstances with it -
// is defined in config.ts: every adapter lookup needs it, and a bundler may drop this module,
// which holds only types. See "sideEffects" in CHANGES-DEV.md.
export { InterfaceRegistry } from './config.js';

/** Adapter names for the deprecated `config.initializeAdapterInstances`. Each is the name of a previously registered adapter. */
export interface InterfaceRegistryConfig {
    /** e.g. `'fetch'` */
    ajax?: string;
    /** e.g. `'backingStore'` */
    modelLibrary?: string;
    /** e.g. `'webApi'` */
    dataService?: string;
    /** e.g. `'json'` */
    uriBuilder?: string;
}

/** DataServiceAdapter Ajax request configuration */
export interface AjaxConfig {
    url: string;
    /** GET, POST, etc. */
    type?: string;
    /** json, etc. */
    dataType?: string;
    contentType?: string;
    crossDomain?: string | boolean;
    headers?: {};
    data?: any;
    params?: {};
    success: (res: HttpResponse) => void;
    error: (res: (HttpResponse | Error)) => void;
}

/** Request sent by AjaxAdapter.
    @deprecated Part of the ajax adapter contract, which Breeze 3 no longer needs. */
export interface AjaxRequest {
    /** AjaxAdapter that initiated the request */
    adapter: AjaxAdapter;
    /** Request configuration */
    config: RequestInit;
    /** config from the DataServiceAdapter that called the AjaxAdapter */
    dsaConfig: AjaxConfig;
    /** Function called on response error */
    error: (status: number, statusText: string, body: string | null, response: Response | null, errorThrown: any) => void;
    /** Function called on response success */
    success: (data: any, statusText: string, response: Response) => void;
}

/**
 * A fetch-compatible function. This is the seam for supplying your own transport:
 * add auth headers, retry, request signing, route through a framework HTTP client
 * (Angular's HttpClient, so requests pass through its interceptors), or stub it in
 * tests. Defaults to `globalThis.fetch`.
 */
export type BreezeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Handles AJAX requests to server.
    @deprecated Breeze 3 needs no ajax adapter: requests go through `config.fetch`. Set it with
    `configureBreeze({ fetch })`. */
export interface AjaxAdapter extends BaseAdapter {
    /** Function that performs the ajax request and calls the success or error function */
    ajax(config: AjaxConfig): void;
    /** Container for headers to be added to each request */
    defaultSettings: { headers?: { [name: string]: string } };
    /** Function to allow manipulating the request before sending */
    requestInterceptor?: (req: AjaxRequest) => void;
}

/** Adapts breeze change-tracking to the UI framework */
export interface ModelLibraryAdapter extends BaseAdapter {
    getTrackablePropertyNames: (entity: any) => string[];
    initializeEntityPrototype(proto: Object): void;
    startTracking(entity: any, entityCtor: Function): void;
    /** Optional. The stored value of a property, without creating anything that reading it would
        create - the backing store builds a collection navigation's array on first read. Breeze
        falls back to `getProperty` for an adapter that does not implement this, which simply
        means the array is created as it always was. */
    peekProperty?(entity: any, propertyName: string): any;
    createCtor?: Function;
}

/** Reshapes data moving between breeze and server */
export interface DataServiceAdapter extends BaseAdapter {
    fetchMetadata(metadataStore: MetadataStore, dataService: DataService): Promise<any>;  // result of Promise is either rawMetadata or a string explaining why not.
    executeQuery(mappingContext: MappingContext): Promise<QueryResult>;   // result of executeQuery will get passed to JsonResultsAdapter extractResults method
    saveChanges(saveContext: SaveContext, saveBundle: SaveBundle): Promise<SaveResult>;
    changeRequestInterceptor: ChangeRequestInterceptorCtor;
    jsonResultsAdapter: JsonResultsAdapter;
}

/** Function called by AjaxAdapter before sending request.
    @deprecated Wrap the fetch function instead - see `configureBreeze({ fetch })`. */
export interface AjaxRequestInterceptor {
    (req: AjaxRequest) : void;
    /** Whether to remove the interceptor after it is called */
    oneTime: boolean;
}

/** Builds URI for performing queries.  Serializes the EntityQuery according to the URI syntax. */
export interface UriBuilderAdapter extends BaseAdapter {
    buildUri(query: EntityQuery, metadataStore: MetadataStore): string;
}

// -----------------------------------

export interface ChangeRequestInterceptorCtor {
    new (saveContext: SaveContext, saveBundle: SaveBundle): ChangeRequestInterceptor;
}

/** Allows manipulating data in DataServiceAdapter before sending to server */
export interface ChangeRequestInterceptor {
    oneTime?: boolean;
    /**
     Prepare and return the save data for an entity change-set.
  
     The adapter calls this method for each entity in the change-set,
     after it has prepared a "change request" for that object.
  
     The method can do anything to the request but it must return a valid, non-null request.
     @example
     this.getRequest = function (request, entity, index) {
            // alter the request that the adapter prepared for this entity
            // based on the entity, saveContext, and saveBundle
            // e.g., add a custom header or prune the originalValuesMap
            return request;
        };
     @param request {Object} The object representing the adapter's request to save this entity.
     @param entity {Entity} The entity-to-be-save as it is in cache
     @param index {Integer} The zero-based index of this entity in the change-set array
     @returns {Function} The potentially revised request.
     **/
    getRequest(request: any, entity: Entity, index: number): any;

    /**
     Last chance to change anything about the 'requests' array
     after it has been built with requests for all of the entities-to-be-saved.
  
     The 'requests' array is the same as 'saveBundle.entities' in many implementations
  
     This method can do anything to the array including add and remove requests.
     It's up to you to ensure that server will accept the requests array data as valid.
  
     Returned value is ignored.
     @example
     this.done = function (requests) {
            // alter the array of requests representing the entire change-set
            // based on the saveContext and saveBundle
        };
     @param requests {Array of Object} The adapter's array of request for this changeset.
     **/
    done(requests: Object[]): void;
}