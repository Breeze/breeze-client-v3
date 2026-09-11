import { BreezeConfig, config } from './config.js';
import { core } from './core.js';
import { appendQueryStringParameter, encodeParams } from './adapter-core.js';
import type { AjaxAdapter, AjaxConfig, AjaxRequestInterceptor, BreezeFetch } from './interface-registry.js';
import type { HttpResponse } from './entity-manager.js';

/*
 * How Breeze makes HTTP requests.
 *
 * Breeze 3 needs no ajax adapter. Data service adapters send their requests through
 * `config.fetch` - set with `configureBreeze({ fetch })` - which defaults to
 * `globalThis.fetch`. This module is the one implementation of that path: turning Breeze's
 * description of a request into a fetch call, and reading the response back.
 *
 * The ajax adapter contract (`AjaxAdapter`, the "ajax" registry slot) remains as a
 * deprecated compatibility layer. `AjaxFetchAdapter` is built on the functions here, and so
 * is the adapter data service adapters fall back to when none is registered.
 *
 * This module imports './config' and './core' directly, never the './breeze' barrel: the
 * abstract data service adapter depends on it, and the barrel depends on that.
 */

/** The transport used when none is supplied. Wrapped so that `fetch` keeps its receiver,
    which some environments require. */
export const defaultFetch: BreezeFetch = (input, init) => globalThis.fetch(input as any, init);

/** Breeze's description of one request, without the callbacks. */
export type HttpRequestConfig = Omit<AjaxConfig, 'success' | 'error'>;

/** The outcome of one request. Failures are values, not rejections. */
export interface HttpOutcome {
  succeeded: boolean;
  httpResponse: HttpResponse;
}

/** Turns Breeze's description of a request into the arguments for a fetch call. */
export function toFetchArgs(request: HttpRequestConfig): { url: string, init: RequestInit } {
  const hasBody = request.type !== "GET" && request.type !== "HEAD";

  // Content-Type describes a body, so a GET gets none - which also keeps it a CORS
  // "simple request" with no preflight. Headers on the request are merged in last; the
  // fetch adapter used to ignore them.
  const headers: Record<string, string> = {};
  if (hasBody) {
    headers['Content-Type'] = request.contentType || 'application/json';
  }
  Object.assign(headers, request.headers);

  const init: RequestInit = {
    method: request.type,
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'include',
    headers: headers,
    redirect: 'follow',
    // 'referrer' is deliberately unset. 'client' is the browser default, but Node's fetch
    // (undici) rejects it as an invalid URL, so setting it explicitly breaks server-side
    // and test usage for no gain.
  };
  if (hasBody) {
    const data = request.data;
    init.body = typeof data === "string" ? data : JSON.stringify(data);
  }

  let url = request.url;
  if (!core.isEmpty(request.params)) {
    url = appendQueryStringParameter(url, encodeParams(request.params!));
  }
  return { url, init };
}

/**
 * Sends one request and resolves with its outcome. Never rejects: a transport failure is
 * reported with status 0, and a body that cannot be read with the real HTTP status.
 */
export async function sendFetch(fetchFn: BreezeFetch, url: string, init: RequestInit,
    request: HttpRequestConfig): Promise<HttpOutcome> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch (err) {
    return failure(request, 0, errorText(err), null, null, err);
  }

  let data: any;
  try {
    data = response.ok ? await response.json() : await response.text();
  } catch (err) {
    return failure(request, response.status, 'Unable to read the response body: ' + errorText(err),
      null, response, err);
  }

  return response.ok
    ? success(request, data, response.statusText, response)
    : failure(request, response.status, response.statusText, data, response, null);
}

function success(request: HttpRequestConfig, data: any, statusText: string, response: Response | null): HttpOutcome {
  return {
    succeeded: true,
    httpResponse: {
      config: request,
      data: data,
      getHeaders: getHeadersFn(response),
      status: response ? response.status : 200,
      statusText: statusText,
    } as HttpResponse,
  };
}

function failure(request: HttpRequestConfig, status: number, statusText: string, body: any,
    response: Response | null, errorThrown: any): HttpOutcome {
  return {
    succeeded: false,
    httpResponse: {
      config: request,
      data: body,
      error: errorThrown || statusText,
      getHeaders: getHeadersFn(response),
      status: status,
      statusText: statusText,
    } as HttpResponse,
  };
}

function errorText(err: any): string {
  return (err && err.message) || String(err);
}

// response is null when the transport itself failed, before any response existed.
function getHeadersFn(response: Response | null): any {
  if (!response || response.status === 0) { // timeout or abort; no headers
    return function (headerName: string) {
      return (headerName && headerName.length > 0) ? "" : {};
    };
  }
  return function (headerName: string) {
    if (headerName && headerName.length > 0) {
      return response.headers.get(headerName);
    }
    const hob: Record<string, any> = {};
    response.headers.forEach((val, key) => {
      hob[key] = val;
    });
    return hob;
  };
}

/**
 * Ajax adapter using the fetch API.
 *
 * @deprecated Breeze 3 needs no ajax adapter: requests go through `config.fetch`, set with
 * `configureBreeze({ fetch })`. This class is kept so that 2.x startup code - `register()`,
 * `configureBreeze({ ajax: AjaxFetchAdapter })`, `config.initializeAdapterInstance('ajax',
 * 'fetch')` - and code using `defaultSettings` or `requestInterceptor` keeps working. It is
 * not scheduled for removal.
 */
export class AjaxFetchAdapter implements AjaxAdapter {
  static adapterName = "fetch";
  name: string;
  defaultSettings: { headers?: { [name: string]: string } };
  requestInterceptor?: AjaxRequestInterceptor;
  /** The function used to make the request. Defaults to `globalThis.fetch`. */
  fetchFn: BreezeFetch;

  constructor(fetchFn?: BreezeFetch) {
    this.name = AjaxFetchAdapter.adapterName;
    this.defaultSettings = {};
    this.requestInterceptor = undefined;
    this.fetchFn = fetchFn || defaultFetch;
  }

  /**
   * @param breezeConfig - defaults to the global breeze config
   * @param fetchFn - the transport this adapter uses. Defaults to `globalThis.fetch`.
   */
  static register(breezeConfig?: BreezeConfig, fetchFn?: BreezeFetch) {
    breezeConfig = breezeConfig || config;
    if (fetchFn) {
      // registerAdapter news up the ctor, so a custom transport needs a factory.
      breezeConfig.registerAdapter("ajax", <any>function () { return new AjaxFetchAdapter(fetchFn); });
    } else {
      breezeConfig.registerAdapter("ajax", AjaxFetchAdapter);
    }
    return breezeConfig.initializeAdapterInstance("ajax", AjaxFetchAdapter.adapterName, true) as AjaxFetchAdapter;
  }

  initialize() {
  }

  ajax(ajaxConfig: AjaxConfig) {
    if (!this.fetchFn) {
      throw new Error("fetch API not supported in this browser");
    }

    let { url, init } = toFetchArgs(ajaxConfig);

    if (!core.isEmpty(this.defaultSettings)) {
      let compositeConfig = core.extend({}, this.defaultSettings);
      init = core.extend(compositeConfig, init) as any;
      // extend is shallow; extend headers separately
      let headers = core.extend({}, this.defaultSettings.headers); // copy default headers 1st
      init.headers = core.extend(headers, init.headers) as any;
    }

    // An interceptor may change requestInfo.config (the fetch init), cancel the request by
    // setting it to null, or answer it itself through success/error.
    let requestInfo = {
      adapter: this,
      config: init as RequestInit | null,
      dsaConfig: ajaxConfig,
      success: (data: any, statusText: string, response: Response) =>
        ajaxConfig.success(success(ajaxConfig, data, statusText, response).httpResponse),
      error: (status: number, statusText: string, body: string | null, response: Response | null, errorThrown: any) =>
        ajaxConfig.error(failure(ajaxConfig, status, statusText, body, response, errorThrown).httpResponse),
    };

    if (core.isFunction(this.requestInterceptor)) {
      let ri = this.requestInterceptor as any;
      ri(requestInfo);
      if (ri.oneTime) {
        this.requestInterceptor = undefined;
      }
    }

    if (requestInfo.config) {
      sendFetch(this.fetchFn, url, requestInfo.config, ajaxConfig).then(outcome =>
        outcome.succeeded ? ajaxConfig.success(outcome.httpResponse) : ajaxConfig.error(outcome.httpResponse));
    }
  }
}

/**
 * What a data service adapter uses when no ajax adapter is registered. It sends requests
 * through `config.fetch`, read at call time, so a later `configureBreeze({ fetch })` takes
 * effect without re-initializing anything.
 * @hidden @internal
 */
export const builtinAjax: AjaxAdapter = new AjaxFetchAdapter(
  (input, init) => (config.fetch || defaultFetch)(input, init));
