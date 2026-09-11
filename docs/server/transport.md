# Supplying your own transport

Breeze makes its HTTP calls through a single function you can replace:

```ts
type BreezeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
```

It defaults to `globalThis.fetch`. Supply your own to add authentication, retry, request
signing, logging, or to route requests through a framework's HTTP client.

## Adding an auth header

```ts
import { configureBreeze, BreezeFetch } from 'breeze-client';
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';

const authFetch: BreezeFetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${getToken()}` },
  });

configureBreeze({ ajax: AjaxFetchAdapter, fetch: authFetch, /* ...the rest */ });
```

Because the token is read inside the function, it picks up refreshes without
reconfiguring Breeze.

## Retrying

```ts
const retryingFetch: BreezeFetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init);
    if (res.status !== 503 || attempt === 2) return res;
    await new Promise(r => setTimeout(r, 250 * 2 ** attempt));
  }
};
```

## Stubbing in tests

A `BreezeFetch` is an ordinary function, so a test double is one too:

```ts
const calls: string[] = [];
const fakeFetch: BreezeFetch = async (input) => {
  calls.push(String(input));
  return new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

configureBreeze({ ajax: AjaxFetchAdapter, fetch: fakeFetch });
```

## Angular's HttpClient

Breeze 3 does not ship an Angular adapter. If you want requests to pass through Angular's
interceptors, DI and `HttpTestingController`, wrap `HttpClient` in a `BreezeFetch`:

```ts
// Sketch. Requests go through Angular's interceptor chain.
function httpClientFetch(http: HttpClient): BreezeFetch {
  return async (input, init) => {
    const body = await firstValueFrom(http.request(
      init?.method ?? 'GET',
      String(input),
      { body: init?.body, headers: init?.headers as any, observe: 'response', responseType: 'text' },
    ));
    return new Response(body.body, { status: body.status, statusText: body.statusText });
  };
}
```

This is deliberately a sketch rather than a supported adapter — the response mapping
depends on what your interceptors do. A supported `breeze-client-angular` package is
planned.

## Setting it directly on the adapter

`configureBreeze({ fetch })` hands the function to the ajax adapter. You can also pass it
to `register()`:

```ts
AjaxFetchAdapter.register(undefined, myFetch);
```

or set it on an instance:

```ts
const adapter = config.getAdapterInstance<AjaxAdapter>('ajax') as AjaxFetchAdapter;
adapter.fetchFn = myFetch;
```

## Default headers and request interception

Two older hooks remain on the adapter and still work:

```ts
const adapter = config.getAdapterInstance<AjaxAdapter>('ajax') as AjaxFetchAdapter;

// merged into every request
adapter.defaultSettings = { headers: { 'X-Tenant': tenantId } };

// called just before each request; mutate requestInfo.config, the fetch init object
adapter.requestInterceptor = (requestInfo) => {
  requestInfo.config.cache = 'no-store';
};
```

`requestInterceptor` can also cancel a request by setting `requestInfo.config` to null,
and setting `oneTime` on it makes Breeze discard it after a single use.

For new code prefer a custom `fetch` — it is one plain function, easier to test, and does
not depend on adapter internals.

## What is planned

The `AjaxAdapter` class and the `"ajax"` registry slot will eventually be retired in
favour of `BreezeFetch` alone, and the callback-shaped `AjaxConfig` replaced by a promise.
Anything written against `BreezeFetch` today is unaffected by that change; anything
implementing `AjaxAdapter` directly will need migrating, with a deprecation shim provided.
