import { firstValueFrom } from 'rxjs';
import type { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import type { BreezeFetch } from '../config/interface-registry.js';

// Breeze's requests through Angular's HttpClient.
//
// breeze-client/adapter-angular-httpclient. Optional, and opt-in like breeze-client/rxjs: import
// it from its own subpath. Nothing in `breeze-client` imports this module, and @angular/common is
// an optional peer dependency, so an application that is not Angular never installs it.
//
//     import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';
//     configureBreeze({ fetch: httpClientFetch(inject(HttpClient)) });
//
// It imports Angular's TYPES only. The one runtime question it asks of Angular - is this error an
// HttpErrorResponse? - it answers by the error's name rather than with instanceof, so the published
// JavaScript never loads @angular/common, and an application with two copies of Angular (a library
// bundling its own, say) cannot fail the check.
//
// This replaces breeze-client/adapter-ajax-httpclient from Breeze 2.x.

/**
 * A {@link BreezeFetch} that sends Breeze's requests through Angular's `HttpClient`, so that they
 * pass through your interceptors and, in tests, `HttpTestingController`.
 *
 * ```ts
 * // app.config.ts
 * import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';
 *
 * provideAppInitializer(() => { configureBreeze({ fetch: httpClientFetch(inject(HttpClient)) }); }),
 * ```
 *
 * `HttpClient` throws on a status outside 200-299 rather than returning the response. This hands
 * Breeze that response anyway - its status, body and headers - because that is how Breeze turns a
 * rejected save into `entityErrors` and a 409 into a concurrency conflict. A request that never
 * completed (status 0) is left to fail, and Breeze reports it as a transport failure.
 *
 * @param http - the application's `HttpClient`
 */
export function httpClientFetch(http: HttpClient): BreezeFetch {
  return async (input, init) => {
    try {
      const res = await firstValueFrom(http.request(init?.method ?? 'GET', String(input), {
        body: init?.body ?? null,
        headers: init?.headers as Record<string, string>,
        observe: 'response',
        responseType: 'text',
      }));
      return toResponse(res.body, res.status, res.statusText, res.headers);
    } catch (e) {
      if (isHttpErrorResponse(e) && e.status !== 0) {
        return toResponse(e.error, e.status, e.statusText, e.headers);
      }
      throw e;
    }
  };
}

/** By name, not instanceof: no runtime import of Angular, and no trouble with two copies of it. */
function isHttpErrorResponse(e: unknown): e is HttpErrorResponse {
  return e != null && typeof e === 'object' && (e as { name?: unknown }).name === 'HttpErrorResponse';
}

function toResponse(body: unknown, status: number, statusText: string, headers: HttpHeaders): Response {
  const h = new Headers();
  for (const name of headers.keys()) {
    const value = headers.get(name);
    if (value != null) h.set(name, value);
  }
  const text = typeof body === 'string' ? body : body == null ? null : JSON.stringify(body);
  // A 204 or 304 may not carry a body, and new Response() throws if given one.
  const bodyless = status === 204 || status === 304 || text === '';
  return new Response(bodyless ? null : text, { status, statusText, headers: h });
}
