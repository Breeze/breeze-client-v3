# Error handling

Every Breeze operation that talks to the server returns a promise, and a failure rejects it. This
page covers what you get when that happens, and how to tell the kinds of failure apart.

For validation rules and how errors attach to entities, see [Validation](/guide/validation). For
diagnosing a query that returns the wrong data rather than failing, see
[Debugging queries](/query/debugging).

## The error object

Breeze rejects with a real `Error`, so `e.message` and `e.stack` work as usual. It adds a few
members — the interface is [`ServerError`](/api/interfaces/ServerError):

| | |
|---|---|
| `message` | the best text Breeze could find, or a fallback |
| `status` | the HTTP status. `0` when the request never reached a server |
| `statusText` | the reason phrase. **Empty over HTTP/2**, which removed them |
| `body` | the response body as the adapter received it |
| `url` | the URL requested, without `withParameters` values |
| `httpResponse` | the whole response, for anything not covered above |

A save that failed on particular entities also has `entityErrors` — see
[Save errors](#save-errors) below.

```ts
try {
  await em.executeQuery(EntityQuery.from(Customer));
} catch (e: any) {
  console.error(`${e.status} ${e.message}`);
}
```

## Telling failures apart

The three cases worth separating, in the order you should test for them:

```ts
try {
  await em.saveChanges();
} catch (e: any) {
  if (e.entityErrors) {
    // the server rejected specific entities — usually validation
  } else if (e.status === 0) {
    // the request never arrived: offline, DNS, CORS, server down
  } else {
    // everything else: 4xx, 5xx, a server exception
  }
}
```

`status === 0` is the one people miss. The request failed before any response existed, so there is
no status to report and no body to read. Breeze wraps the transport's own text, which is usually
vague on its own:

```
HTTP response status 0: TypeError: Failed to fetch.
Likely did not or could not reach server. Is the server running?
```

A CORS rejection looks exactly like this from JavaScript, because the browser will not tell the
page why it blocked the request. If the server is definitely up, check CORS before anything else.

## Save errors

When the server rejects particular entities, `entityErrors` is an array of
[`EntityError`](/api/interfaces/EntityError):

| | |
|---|---|
| `entity` | the entity concerned, if Breeze could find it in the cache |
| `errorName` | the validator or server error name |
| `errorMessage` | the message |
| `propertyName` | the property concerned, if any |
| `isServerError` | `false` for client-side validation, `true` from the server |
| `custom` | whatever the server attached |

**Breeze also adds each one to the entity's own validation errors**, so a form bound to
`entity.entityAspect.getValidationErrors()` shows them with no extra code. That is usually the
better place to read them; the array is for logging, or for errors whose entity is not in the
cache. Breeze clears server errors from an entity at the start of its next save.

```ts
catch (e: any) {
  for (const err of e.entityErrors ?? []) {
    console.warn(`${err.propertyName ?? '(entity)'}: ${err.errorMessage}`);
  }
}
```

`entity` is `null` when the key does not match anything cached — a save can fail on an entity this
manager never held. Check it before using it.

### Client-side validation happens first

`saveChanges` validates before it sends anything. If that fails you get an error with
`entityErrors` whose entries have `isServerError: false`, **and no request is made** — so
`status` is undefined and there is no `httpResponse`. Use `isServerError` if you need to tell the
two apart.

To validate without saving, use
[`saveChangesValidateOnClient`](/api/classes/EntityManager#savechangesvalidateonclient).

## What the server sends

The Breeze ASP.NET Core server returns an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
problem details document, `Content-Type: application/problem+json`:

```json
{
  "type":   "https://breeze.github.io/problems/entity-errors",
  "title":  "Forbidden",
  "status": 403,
  "detail": "Order validation failed",

  "Code":    403,
  "Message": "Order validation failed",
  "EntityErrors": [ … ]
}
```

`type`, `title`, `status` and `detail` are the standard members. The capitalised ones are what
Breeze sent before 3.0, still present by default so that an application on an older client reads
the error unchanged — RFC 9457 §3.2 permits extension members and requires consumers to ignore
ones they do not recognise.

**You do not need to read any of this.** Breeze takes `message` from `detail`, falling back to
`title`, and finds entity errors under either spelling. It matters only if you are writing your
own client, reading the response in a network tab, or pointing Breeze at a server that is not
Breeze.

A non-Breeze server needs to do nothing special: send problem+json and the message comes through.
Send `{ "message": "…" }` and that works too.

## Status codes

| | |
|---|---|
| `0` | no response — offline, CORS, DNS, server down |
| `403` | the default for `EntityErrorsException` |
| `409` | a conflict, such as a duplicate key, if the server maps it |
| `4xx` | the request was rejected |
| `5xx` | the server failed |

Breeze does not retry, and does not treat any status specially other than to report it. Retry
policy belongs in your `fetch` function — see [Configuration](/guide/configuration).

### Getting 409 from a Breeze .NET server

Duplicate-key and foreign-key violations arrive as 500 unless the server is told to map them,
because the error codes belong to the database provider rather than to Breeze. For SQL Server it is
one line in `Startup`:

```csharp
o.Filters.Add(new GlobalExceptionFilter {
  StatusCodeForException = DbExceptionMappers.SqlServer
});
```

`StatusCodeForException` takes any `Func<Exception, HttpStatusCode?>`, so other providers — and
your own domain exceptions — are a few lines more. The server's UPGRADE.md has the equivalent for
Npgsql, MySqlConnector, Oracle and SQLite.

With it in place the client sees a real status, which is what makes the distinction below usable:

```ts
catch (e: any) {
  if (e.status === 409) {
    // the row conflicts with what is already stored - re-querying will not help,
    // and retrying will fail the same way
  }
}
```

The message is the provider's own, so it names the constraint that failed
(`…conflicted with the FOREIGN KEY constraint FK_Order_Customer…`). Useful in development,
but it discloses your schema — a public API should catch and rethrow with its own message.

## Errors in your own `fetch`

Because requests go through `config.fetch`, you can see and shape every failure in one place:

```ts
configureBreeze({
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401) redirectToLogin();
    return response;
  },
});
```

Throwing from your `fetch` rejects the Breeze call, with `status === 0` and your error's message.
Returning a non-OK `Response` goes down the normal path, so Breeze parses the body and builds the
usual error.

## Concurrency conflicts

An optimistic-concurrency failure is an ordinary save error: the server detects the stale row and
throws, and it arrives with whatever status the server chose. Breeze does not resolve it for you.
The usual recovery is to re-query the entity and let the user decide:

```ts
catch (e: any) {
  if (isConcurrencyError(e)) {          // your own check, on message or status
    await em.fetchEntityByKey(Order, orderId);   // refreshes from the server
  }
}
```

See [Change tracking](/guide/change-tracking) for `rejectChanges` and the rest of the recovery
surface.
