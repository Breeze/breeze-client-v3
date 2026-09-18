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

const authFetch: BreezeFetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${getToken()}` },
  });

configureBreeze({ fetch: authFetch });
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

configureBreeze({ fetch: fakeFetch });
```

## Angular's HttpClient

To have Breeze's requests go through Angular's `HttpClient` — its interceptors, its DI, and
`HttpTestingController` in tests — use the
[Angular HttpClient](/guide/extensions#angular-httpclient) extension:

```ts
import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';

configureBreeze({ fetch: httpClientFetch(http) });
```

One thing to get right if you write your own wrapper for another HTTP client. When the server
answers with a 4xx or 5xx status, `fetch` still returns the response, but many HTTP clients,
Angular's among them, throw an error instead. Breeze treats a thrown error as a request that never
reached the server, with no status and no body. So a wrapper that lets that error through makes a
rejected save lose its `entityErrors`, and a 409 is not seen as a concurrency conflict. Catch the
error and return a `Response` built from its status, body and headers, as `httpClientFetch` does.

## Setting it directly

`configureBreeze({ fetch })` stores the function as `config.fetch`. Breeze reads it on
every request, so assigning it later works too:

```ts
import { config } from 'breeze-client';

config.fetch = myFetch;
```

## The deprecated ajax adapter

Breeze 2.x routed requests through an *ajax adapter*. Breeze 3 does not need one, but
`AjaxFetchAdapter` is still there so that 2.x startup code keeps working. If you register
it — `configureBreeze({ ajax: AjaxFetchAdapter })`, `AjaxFetchAdapter.register()` or
`config.initializeAdapterInstance('ajax', 'fetch')` — Breeze uses it instead of
`config.fetch`, and its two older hooks still work. (With no ajax adapter registered,
`initializeAdapterInstance('ajax', 'fetch')` gets an `AjaxFetchAdapter` that sends its
requests through `config.fetch`.)

```ts
import { config, type AjaxAdapter } from 'breeze-client';
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';

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

Both hooks are deprecated. A `fetch` function does either job in one plain function —
add the header, or change the init, before calling through — and is easier to test.
