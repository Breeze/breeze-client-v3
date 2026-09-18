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
    /** The request URL, without `params`: `{serviceName}/Metadata`, the save URL, or the query URL the {@link UriBuilderAdapter} built. */
    url: string;
    /** GET, POST, etc. */
    type?: string;
    /** json, etc. */
    dataType?: string;
    /** The `Content-Type` of the request body. The fetch transport sends it only for a request with a body (not GET or HEAD), defaulting to `application/json`. */
    contentType?: string;
    /** Not used by Breeze's own transport. Set to `true` for the deprecated `useJsonp` option, for a registered ajax adapter that acts on it. */
    crossDomain?: string | boolean;
    /** Additional request headers, merged over the `Content-Type` header. Breeze's own adapters do not set any. */
    headers?: {};
    /** The request body. A string is sent as it is; anything else is sent as `JSON.stringify(data)`. Ignored for GET and HEAD. */
    data?: any;
    /** Query-string parameters to append to `url`: the values given to {@link EntityQuery.withParameters}. A `Date` is sent as its ISO string. */
    params?: {};
    /** Called with the response when the request succeeds: a 2xx status and a body that parses as JSON. */
    success: (res: HttpResponse) => void;
    /** Called with the response when the request fails: a non-2xx status, a body that cannot be read, or no response at all (status 0). */
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
    defaultSettings: {
        /** Headers to add to every request, by name. */
        headers?: { [name: string]: string }
    };
    /** Function to allow manipulating the request before sending */
    requestInterceptor?: (req: AjaxRequest) => void;
}

/** Adapts breeze change-tracking to the UI framework */
export interface ModelLibraryAdapter extends BaseAdapter {
    /** Returns the names of the properties on an instance of an entity or complex type that the model library would track. Breeze calls it on a new instance of the type's constructor when it prepares the constructor, and adds any names the metadata does not know as unmapped properties. */
    getTrackablePropertyNames: (entity: any) => string[];
    /** Prepares the prototype of an entity or complex type constructor for tracking - for the backing store, adding `getProperty`, `setProperty` and a property accessor for each mapped property. Called when Breeze first sets up a type's constructor, and again when a property is added to a type whose prototype has already been prepared. */
    initializeEntityPrototype(proto: Object): void;
    /** Starts tracking one new entity or complex object - for the backing store, moving its initial values into the backing store and giving each unset property its default value. Called once per instance, when its `EntityAspect` or `ComplexAspect` is created. Despite the parameter's name, Breeze passes the constructor's prototype as the second argument. */
    startTracking(entity: any, entityCtor: Function): void;
    /** Optional. The stored value of a property, without creating anything that reading it would
        create - the backing store builds a collection navigation's array on first read. Breeze
        falls back to `getProperty` for an adapter that does not implement this, which simply
        means the array is created as it always was. */
    peekProperty?(entity: any, propertyName: string): any;
    /** Optional. Called with the {@link EntityType} or {@link ComplexType} to create a constructor for a type that has none registered. Without it, Breeze creates an empty constructor. */
    createCtor?: Function;
}

/** Reshapes data moving between breeze and server */
export interface DataServiceAdapter extends BaseAdapter {
    /**
    Fetches the metadata for a service and imports it into the `MetadataStore`. Called by
    `MetadataStore.fetchMetadata`, and before the first query to a service that has server metadata.
    Resolves with the raw metadata, or with a string saying why there is none (for example, that
    another request already fetched it). Rejects with the server error if the request fails.
    */
    fetchMetadata(metadataStore: MetadataStore, dataService: DataService): Promise<any>;  // result of Promise is either rawMetadata or a string explaining why not.
    /**
    Sends the query in `mappingContext` to the server. Resolves with the raw results, the inline count
    if one was asked for, and the `httpResponse`; Breeze then merges the results into the cache
    through the {@link JsonResultsAdapter}.
    */
    executeQuery(mappingContext: MappingContext): Promise<QueryResult>;   // result of executeQuery will get passed to JsonResultsAdapter extractResults method
    /**
    Sends the entities in `saveBundle` to the server and resolves with the saved entities and any
    key mappings. Called by `EntityManager.saveChanges`. Rejects with the server error, including
    any per-entity errors, if the save fails.
    */
    saveChanges(saveContext: SaveContext, saveBundle: SaveBundle): Promise<SaveResult>;
    /**
    The constructor of the {@link ChangeRequestInterceptor} the adapter creates for each save, to let
    an application change each entity's save request and the finished array of requests without
    writing its own adapter. Defaults to a no-op interceptor.
    */
    changeRequestInterceptor: ChangeRequestInterceptorCtor;
    /**
    The {@link JsonResultsAdapter} used to read this adapter's query and save results, unless the
    {@link DataService} names one of its own.
    */
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
    /** Returns the URL for the query, relative to the service: its resource name followed by the query in this adapter's syntax. Breeze qualifies it with the service name, and sends the query's `withParameters` values separately, as request params. */
    buildUri(query: EntityQuery, metadataStore: MetadataStore): string;
}

// -----------------------------------

/**
The constructor a {@link DataServiceAdapter} calls to create a {@link ChangeRequestInterceptor}
for one save. Assign your own to the adapter's `changeRequestInterceptor` property.
*/
export interface ChangeRequestInterceptorCtor {
    /** Creates the interceptor for one save, given that save's context and the bundle about to be sent. */
    new (saveContext: SaveContext, saveBundle: SaveBundle): ChangeRequestInterceptor;
}

/** Allows manipulating data in DataServiceAdapter before sending to server */
export interface ChangeRequestInterceptor {
    /** Whether to intercept only one save. If set, the adapter goes back to its no-op interceptor after creating this one. */
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
     */
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
     */
    done(requests: Object[]): void;
}