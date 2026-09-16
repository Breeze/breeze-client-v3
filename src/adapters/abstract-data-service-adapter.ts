import { core } from '../core/core.js';
import { config } from '../config/config.js';
import { builtinAjax } from './http.js';
import { EntityQuery } from '../query/entity-query.js';
import { DataServiceAdapter, AjaxAdapter, AjaxConfig, ChangeRequestInterceptorCtor, ChangeRequestInterceptor } from '../config/interface-registry.js';
import { Entity } from '../entity/entity-aspect.js';
import { MappingContext } from '../query/mapping-context.js';
import { DataService, JsonResultsAdapter } from '../metadata/data-service.js';
import { HttpResponse, SaveContext, SaveBundle, ServerError, SaveResult, SaveErrorFromServer, QueryResult } from '../manager/entity-manager.js';
import { EntityType, MetadataStore } from '../metadata/entity-metadata.js';

/** For use by breeze plugin authors only.  The class is used as the base class for most {@link DataServiceAdapter} implementations
@adapter (see {@link DataServiceAdapter})    
@hidden
*/
export abstract class AbstractDataServiceAdapter implements DataServiceAdapter {
  /** @hidden @internal */
  declare _$impl?: any;
  /** The name of this adapter. */
  declare name: string;
  /**
   * The ajax adapter requests go through: the registered default if there is one, otherwise
   * a built-in one that uses `config.fetch`.
   * @deprecated Make requests with `_ajax`, and supply the transport with
   * `configureBreeze({ fetch })`.
   */
  declare ajaxImpl: AjaxAdapter;

  // TODO use interface
  checkForRecomposition(interfaceInitializedArgs: any) {
    if (interfaceInitializedArgs.interfaceName === "ajax" && interfaceInitializedArgs.isDefault) {
      this.initialize();
    }
  }

  initialize() {
    // An ajax adapter is optional. A registered one (deprecated) is used if there is one;
    // otherwise requests go through config.fetch, which defaults to globalThis.fetch. This
    // is also why registration order no longer matters: there is nothing to resolve.
    this.ajaxImpl = config.getAdapterInstance<AjaxAdapter>("ajax") || builtinAjax;
  }

  /**
   * Sends one request. Resolves with the response, or rejects with a `ServerError`.
   *
   * Subclasses should make their requests through this method rather than through
   * `ajaxImpl`, whose callback-shaped contract is kept only for compatibility. This is the
   * only place in the class that deals in success/error callbacks.
   */
  protected _ajax(
      config: Omit<AjaxConfig, 'success' | 'error'>,
      errorMessagePrefix?: string,
      prepareResponse?: (httpResponse: HttpResponse) => void): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      this.ajaxImpl.ajax({
        ...config,
        // Each callback is guarded: a throw inside one would otherwise escape into the ajax
        // adapter and leave this promise pending for ever.
        success: (httpResponse: HttpResponse) => {
          try {
            prepareResponse && prepareResponse(httpResponse);
            resolve(httpResponse);
          } catch (e) {
            reject(e);
          }
        },
        error: (httpResponse: HttpResponse) => {
          try {
            // must run before makeHttpError: createError reads httpResponse.saveContext
            // to attach per-entity validation errors.
            prepareResponse && prepareResponse(httpResponse);
            reject(AbstractDataServiceAdapter.makeHttpError(httpResponse, errorMessagePrefix));
          } catch (e) {
            reject(e);
          }
        },
      } as AjaxConfig);
    });
  }

  async fetchMetadata(metadataStore: MetadataStore, dataService: DataService) {
    const serviceName = dataService.serviceName;
    const url = dataService.qualifyUrl("Metadata");

    const httpResponse = await this._ajax(
      { type: "GET", url: url, dataType: 'json' },
      "Metadata query failed for: " + url);

    // might have been fetched by another query
    if (metadataStore.hasMetadataFor(serviceName)) {
      return "already fetched";
    }

    const data = httpResponse.data;
    let metadata: any;
    try {
      metadata = typeof (data) === "string" ? JSON.parse(data) : data;
      metadataStore.importMetadata(metadata);
    } catch (e) {
      const errMsg = "Unable to either parse or import metadata: " + (e as Error).message;
      throw AbstractDataServiceAdapter.makeHttpError(httpResponse, "Metadata query failed for: " + url + ". " + errMsg);
    }

    // import may have brought in the service.
    if (!metadataStore.hasMetadataFor(serviceName)) {
      metadataStore.addDataService(dataService);
    }

    return metadata;
  }

  /** Execute the query in the mappingContext. */
  async executeQuery(mappingContext: MappingContext): Promise<QueryResult> {
    mappingContext.adapter = this;

    const usePost = (mappingContext.query as EntityQuery).usePostEnabled;
    const params = usePost ? this._makeQueryPostParams(mappingContext) : this._makeQueryGetParams(mappingContext) as any;

    const httpResponse = await this._ajax(params);

    const data = httpResponse.data;
    try {
      const results = data && (data.results || data.Results);
      if (results) {
        return {
          results: results,
          inlineCount: data.inlineCount || data.InlineCount,
          httpResponse: httpResponse,
          query: mappingContext.query
        } as QueryResult;
      }
      return { results: data, httpResponse: httpResponse, query: mappingContext.query } as QueryResult;
    } catch (e) {
      if (e instanceof Error) { throw e; }
      throw AbstractDataServiceAdapter.makeHttpError(httpResponse);
    }
  }

  /** Set up ajax parameters for query GET.  This puts the query into the request querystring, in whatever syntax the UriBuilder produces. */
  _makeQueryGetParams(mappingContext: MappingContext) {
    const url = mappingContext.getUrl();

    const params = {
      type: "GET",
      url: url,
      params: (mappingContext.query as EntityQuery).parameters,
      dataType: 'json',
      crossDomain: false,
    };
    // useJsonp is deprecated. Breeze's own transport ignores dataType and crossDomain; this
    // stays only because a registered (deprecated) ajax adapter could still act on them.
    if (mappingContext.dataService.useJsonp) {
      params.dataType = 'jsonp';
      params.crossDomain = true;
    }
    return params;
  }

  /** Set up ajax parameters for query POST.  This put the query into the request body as JSON. */
  _makeQueryPostParams(mappingContext: MappingContext) {
    const entityQuery = mappingContext.query as EntityQuery;
    const metadataStore = mappingContext.entityManager.metadataStore;
    const url = mappingContext.dataService.qualifyUrl(entityQuery.resourceName!);

    let entityType = entityQuery._getFromEntityType(metadataStore, false);
    if (!entityType) { entityType = new EntityType(metadataStore); }
    const json = entityQuery.toJSONExt({ entityType: entityType, toNameOnServer: true}) as any;
    json.from = undefined;
    json.queryOptions = undefined;
    // withParameters values go in the query string (params, below), as for a GET.
    json.parameters = undefined;

    const params = {
      type: "POST",
      url: url,
      params: (mappingContext.query as EntityQuery).parameters,
      dataType: 'json',
      processData: false, // don't form-encode the body
      contentType: "application/json; charset=UTF-8",
      data: JSON.stringify(json),
      crossDomain: false,
    };
    return params;
  }

  async saveChanges(saveContext: SaveContext, saveBundle: SaveBundle): Promise<SaveResult> {
    let adapter = saveContext.adapter = this;

    let saveBundleSer = adapter._prepareSaveBundle(saveContext, saveBundle);
    let bundle = JSON.stringify(saveBundleSer);

    const url = saveContext.dataService.qualifyUrl(saveContext.resourceName);

    // saveContext must be on the response before any error is built from it
    const httpResponse = await this._ajax(
      {
        type: "POST",
        url: url,
        dataType: 'json',
        contentType: "application/json",
        data: bundle,
      },
      undefined,
      (r) => { r.saveContext = saveContext; });

    const data = httpResponse.data;
    if (data == null || data === "") {
      const err = AbstractDataServiceAdapter.makeHttpError(httpResponse);
      err.message = "The response to the save request to " + url + " (HTTP status " + httpResponse.status +
        ") had no body. Breeze needs the saved entities and any key mappings to complete the save.";
      throw err;
    }
    if (data.Errors || data.errors) {
      throw AbstractDataServiceAdapter.makeHttpError(httpResponse);
    }

    const saveResult = adapter._prepareSaveResult(saveContext, data);
    saveResult.httpResponse = httpResponse;
    return saveResult;
  }

  /** Abstract method that needs to be overwritten in any concrete DataServiceAdapter subclass. 
  The return value from this method should be a serializable object that will be sent to the server after calling JSON.stringify on it.
  */
  _prepareSaveBundle(saveContext: SaveContext, saveBundle: SaveBundle): any {
    // The implementor should call _createChangeRequestInterceptor
    throw new Error("Need a concrete implementation of _prepareSaveBundle");
  }

  /**
  Returns a constructor function for a "ChangeRequestInterceptor"
  that can tweak the saveBundle both as it is built and when it is completed
  by a concrete DataServiceAdapater.

  Initialized with a default, no-op implementation that developers can replace with a
  substantive implementation that changes the individual entity change requests
  or aspects of the entire 'saveBundle' without having to write their own DataService adapters.
  >     let adapter = breeze.config.getAdapterInstance('dataService');
  >     adapter.changeRequestInterceptor = function (saveContext, saveBundle) {
  >         this.getRequest = function (request, entity, index) {
  >            // alter the request that the adapter prepared for this entity
  >            // based on the entity, saveContext, and saveBundle
  >            // e.g., add a custom header or prune the originalValuesMap
  >            return request;
  >        };
  >        this.done = function (requests) {
  >            // alter the array of requests representing the entire change-set
  >            // based on the saveContext and saveBundle
  >        };
  >     }

  @param saveContext - The BreezeJS "context" for the save operation.
  @param saveBundle - Contains the array of entities-to-be-saved (AKA, the entity change-set).
  @returns Constructor for a "ChangeRequestInterceptor".
  **/
  changeRequestInterceptor: ChangeRequestInterceptorCtor = DefaultChangeRequestInterceptor;

  /**
   * Creates the change request interceptor for one save, from `changeRequestInterceptor`.
   * Call it at the start of `_prepareSaveBundle`, pass each entity's request through its
   * `getRequest`, and pass the finished array to its `done`.
   *
   * Falls back to a no-op interceptor when `changeRequestInterceptor` is not set. If the
   * interceptor it creates has `oneTime` set, the adapter goes back to the no-op
   * interceptor afterwards, so only this save is intercepted.
   * @throws if the interceptor has no `getRequest` or `done` method.
   */
  protected _createChangeRequestInterceptor(saveContext: SaveContext, saveBundle: SaveBundle): ChangeRequestInterceptor {
    let adapter = saveContext.adapter!;
    let cri = adapter.changeRequestInterceptor;
    let isFn = core.isFunction;

    if (isFn(cri)) {
      let pre = adapter.name + " DataServiceAdapter's ChangeRequestInterceptor";
      let post = " is missing or not a function.";
      let interceptor = new cri(saveContext, saveBundle);
      if (!isFn(interceptor.getRequest)) {
        throw new Error(pre + '.getRequest' + post);
      }
      if (!isFn(interceptor.done)) {
        throw new Error(pre + '.done' + post);
      }
      if (interceptor.oneTime) {
        adapter.changeRequestInterceptor = DefaultChangeRequestInterceptor;
      }
      return interceptor;
    } else {
      return new DefaultChangeRequestInterceptor(saveContext, saveBundle) as ChangeRequestInterceptor;
    }
  }

  /** Abstract method that needs to be overwritten in any concrete DataServiceAdapter sublclass. 
  This method needs to take the result returned the server and convert it into an ISaveResult. 
  */
  _prepareSaveResult(saveContext: SaveContext, data: any): SaveResult {
    throw new Error("Need a concrete implementation of _prepareSaveResult");
  }


  /** Utility method that may be used in any concrete DataServiceAdapter sublclass to handle any 
  http connection issues. For an error with status 0 - the request got no response - it says in
  the message that the server could not be reached, keeping any message the transport gave.
  An aborted request is left alone. `makeHttpError` already applies it.
  */
  // Put this at the bottom of your http error analysis
  static _catchNoConnectionError(err: ServerError) {
    if (err.status !== 0) return;
    const cause = err.httpResponse && err.httpResponse.error;
    if (cause && cause.name === "AbortError") return; // the app cancelled it; the server is irrelevant
    const hint = "Likely did not or could not reach server. Is the server running?";
    if (err.message && err.message.includes(hint)) return; // already applied
    err.message = err.message
      ? "HTTP response status 0: " + err.message + ". " + hint
      : "HTTP response status 0 and no message.  " + hint;
  }

  /**
   * Builds the Breeze error for a failed HTTP response: an `Error` carrying `status`,
   * `statusText`, `url`, `body` and `httpResponse`, whose message comes from the response
   * body (a .NET exception, or `{ message, errors }`). For a save, it also carries the
   * server's per-entity `entityErrors`, if `httpResponse.saveContext` is set.
   *
   * `_ajax` uses it for every failed request. Call it when your adapter makes a request some
   * other way, then throw or reject with the result.
   * @param httpResponse - The failed response.
   * @param messagePrefix - Put at the start of the message, followed by "; ".
   */
  static makeHttpError(httpResponse: HttpResponse, messagePrefix?: string): ServerError {
    const err = createError(httpResponse);
    AbstractDataServiceAdapter._catchNoConnectionError(err);
    if (messagePrefix) {
      err.message = messagePrefix + "; " + err.message;
    }
    return err;
  }

  jsonResultsAdapter = new JsonResultsAdapter({
    name: "noop",

    visitNode: function (/* node, mappingContext, nodeContext */) {
      return {};
    }
  });
}

function createError(httpResponse: HttpResponse) {
  let err = new Error() as ServerError;
  err.httpResponse = httpResponse;
  err.status = httpResponse.status;
  err.statusText = httpResponse.statusText;
  err.body = httpResponse.data;
  err.url = httpResponse.config && httpResponse.config.url;

  let errObj = httpResponse.data;

  if (!errObj) {
    err.message = httpResponse.error && httpResponse.error.toString();
    return err;
  }

  // some ajax providers convert an errant result into an object, others do not
  // if not do it here.
  if (typeof errObj === "string") {
    try {
      errObj = JSON.parse(errObj);
    } catch (e) {
      // sometimes httpResponse.data is just the error message itself
      err.message = errObj;
      return err;
    }
  }

  // The RFC 9457 `type` member, taken before the branch below because it is spelled the same
  // whichever shape the rest of the document has: a Breeze server sends it alongside the
  // capitalised pre-3.0 members as well as instead of them. This is what lets a caller tell a
  // concurrency conflict from a duplicate key, which share a status code.
  if (typeof errObj.type === "string") err.problemType = errObj.type;

  let saveContext = httpResponse.saveContext;

  // if any of the follow properties exist the source is .NET
  let tmp = errObj.Message || errObj.ExceptionMessage || errObj.EntityErrors || errObj.Errors;
  let isDotNet = !!tmp;
  let message: string, entityErrors: any[];
  if (!isDotNet) {
    // RFC 9457 (Problem Details for HTTP APIs) calls the human-readable text `detail`, with
    // `title` as the shorter summary of the problem *type*. A server that sends problem+json and
    // nothing else would otherwise fall through to the generic message at the end of this
    // function, which says entity errors were encountered whether or not any were - a confidently
    // wrong message is harder to diagnose than a missing one.
    message = errObj.message || errObj.detail || errObj.title;
    // `entityErrors` is a Breeze extension member; RFC 9457 section 3.2 allows those, and the
    // spec requires consumers to ignore members they do not recognize.
    entityErrors = errObj.errors || errObj.entityErrors;
    // Normalize the same way the .NET branch does. Without this a server sending the natural
    // "Namespace.Type" spelling gets "Unable to locate a 'Type' by the name ..." from the entity
    // lookup in processServerErrors, with nothing to connect it to the error format.
    entityErrors = entityErrors && entityErrors.map(function (e: any) {
      return e.entityTypeName
        ? { ...e, entityTypeName: MetadataStore.normalizeTypeName(e.entityTypeName) }
        : e;
    });
  } else {
    let tmp = errObj;
    do {
      // .NET exceptions can provide both ExceptionMessage and Message but ExceptionMethod if it
      // exists has a more detailed message.
      message = tmp.ExceptionMessage || tmp.Message;
      tmp = tmp.InnerException;
    } while (tmp);
    // .EntityErrors will only occur as a result of an EntityErrorsException being deliberately thrown on the server
    entityErrors = errObj.Errors || errObj.EntityErrors;
    entityErrors = entityErrors && entityErrors.map(function (e) {
      return {
        errorName: e.ErrorName,
        entityTypeName: MetadataStore.normalizeTypeName(e.EntityTypeName),
        keyValues: e.KeyValues,
        propertyName: e.PropertyName,
        errorMessage: e.ErrorMessage,
        custom: e.Custom
      };
    });
  }

  if (saveContext && entityErrors) {

    let propNameFn = saveContext.entityManager.metadataStore.namingConvention.serverPropertyNameToClient;
    entityErrors.forEach(function (e) {
      e.propertyName = e.propertyName && propNameFn(e.propertyName);
    });
    (err as SaveErrorFromServer).entityErrors = entityErrors;
  }

  err.message = message || "Server side errors encountered - see the entityErrors collection on this object for more detail";
  return err;
}


/** This is a default, no-op implementation that developers can replace. */
class DefaultChangeRequestInterceptor {
  constructor(saveContext: SaveContext, saveBundle: SaveBundle) {

  }

  getRequest(request: any, entity: Entity, index: number) {
    return request;
  }

  done(requests: Object[]) {
  }
}
