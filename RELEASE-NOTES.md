# breeze-client release notes

What changed in each release of `breeze-client` 3.x, for people using it. Converting an app
from 2.x is covered in [UPGRADE.md](./UPGRADE.md).

---

## Unreleased

### Fixed

**An empty response body failed the request with "Unexpected end of JSON input".**

A query or save whose response was successful but had no body was reported as an error,
`SyntaxError: Unexpected end of JSON input` in Chrome, Edge and Node (other browsers word
it differently), instead of resolving. This happened with:

- a **204 No Content**. ASP.NET Core sends one whenever a controller action returns `null`,
  for example a lookup that finds nothing. That made this common with .NET servers.
- a **200 with an empty body**.

The rejected error carried the real `status` (204 or 200). Its `message` was the parser's
own, as above, and its `statusText` began *Unable to read the response body:*, followed by
that same message. Search for the `statusText` to find these failures in your logs.

*Cause.* Breeze 3 sends every request through one fetch path, and it read every successful
response with `response.json()`, which throws on an empty body. It affected the default
`fetch` and `breeze-client/adapter-angular-httpclient` alike. Breeze 2's Angular
`HttpClient` adapter parsed the body with `JSON.parse`, and Angular hands over a 204's body
as `null`, so a 204 came through as `null`. Applications moving from 2.x could therefore
start failing on endpoints that had always worked.

*Fix.* An empty successful body now reads as no data (`null`): a query resolves with
`results` as an empty array. A body that is not empty must still be valid JSON. An HTML
page from a proxy, for instance, still rejects with the real HTTP status, as before.

*Workaround on 3.0.0.* Wrap the fetch function so that an empty successful response
carries a JSON `null`:

```ts
import { configureBreeze, type BreezeFetch } from 'breeze-client';
import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';

function emptyBodyAsNull(fetchFn: BreezeFetch): BreezeFetch {
  return async (input, init) => {
    const response = await fetchFn(input, init);
    const empty = response.status === 204 || response.headers.get('content-length') === '0';
    return response.ok && empty
      ? new Response('null', { status: 200, statusText: response.statusText, headers: response.headers })
      : response;
  };
}

configureBreeze({ fetch: emptyBodyAsNull(httpClientFetch(http)) });   // or wrap your own fetch
```

Remove it once you upgrade.

---

## 3.0.0 — 2026-09-30

The first release of breeze-client 3: the 2.x API, rewritten for modern TypeScript and
published as a single ESM package. Every consumer-facing change from 2.x is described in
[UPGRADE.md](./UPGRADE.md), and the defects fixed along the way are listed in its
*Fixed along the way* section.
