# DataServiceAdapter

A data service adapter carries out the `EntityManager`'s three server operations for one
kind of service:
- **`fetchMetadata`** requests metadata and loads it into a `MetadataStore`.
- **`executeQuery`** sends a query and returns the raw results. Breeze turns those into
  entities.
- **`saveChanges`** sends pending changes and returns what the server saved.

Breeze ships one adapter, `DataServiceWebApiAdapter`, named `'webApi'`. It talks to a
Breeze .NET server, or to any server that uses the same JSON. For anything else, write
your own adapter — usually by subclassing `AbstractDataServiceAdapter` and overriding a few
methods.

::: tip Changed in 3.0
- The OData adapter is gone.
- Adapters no longer register themselves when imported.
- `AbstractDataServiceAdapter` is promise-based: `fetchMetadata`, `executeQuery` and
  `saveChanges` are `async` and return native promises. They share one `_ajax` helper.

If a 2.x subclass overrode only `_prepareSaveBundle`, `_prepareSaveResult` and
`jsonResultsAdapter`, it works unchanged. Any override that returned a Q promise must now
return a native one.
:::

## Registering an adapter

```ts
import { configureBreeze } from 'breeze-client';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';

configureBreeze({
  dataService: DataServiceWebApiAdapter,
  /* ...uriBuilder, modelLibrary */
});
```

Requests go through `config.fetch`, so there is no ajax adapter to register first. See
[Supplying your own transport](/server/transport).

`configureBreeze` makes the adapter the default for every `DataService`. To use a second
adapter for one service only, register it without making it the default, and name it in
that service's `DataService`:

```ts
import { config, DataService } from 'breeze-client';

config.registerAdapter('dataService', ChangeSetAdapter);   // registered, not the default

const legacy = new DataService({
  serviceName: '/legacy',
  adapterName: 'changeSet',
  hasServerMetadata: false,
});
```

Breeze creates the adapter the first time it is looked up by name. `registerAdapter` is
marked deprecated in favour of `configureBreeze`, but it is still the way to register an
adapter that is not the default.

## The DataServiceAdapter interface

| Member | Purpose |
|---|---|
| `name` | The adapter's name, used in registration and in `DataService.adapterName`. Set it in the constructor: registration creates a throwaway instance just to read it. |
| `initialize()` | Called when Breeze creates the instance. `AbstractDataServiceAdapter` picks up a registered (deprecated) ajax adapter here if there is one; otherwise requests go through `config.fetch`. |
| `checkForRecomposition(args)` | Optional. Called whenever any adapter is initialized. `AbstractDataServiceAdapter` runs `initialize()` again when a new default ajax adapter is registered. |
| `fetchMetadata(metadataStore, dataService)` | Returns a promise for the raw metadata. |
| `executeQuery(mappingContext)` | Returns a promise for a query result. |
| `saveChanges(saveContext, saveBundle)` | Returns a promise for a save result. |
| `jsonResultsAdapter` | The [JsonResultsAdapter](/server/jsonresultsadapter) that services using this adapter get by default. |
| `changeRequestInterceptor` | A hook for adjusting save requests. See [below](#adjusting-save-requests). |

If your server cannot provide metadata or accept saves, still implement the method: throw
an error that says so, rather than letting a call fail obscurely.

### fetchMetadata

`AbstractDataServiceAdapter.fetchMetadata` sends `GET {serviceName}/Metadata`. It parses
the response, whether a string or an object, and passes it to
`metadataStore.importMetadata`. It also adds the `DataService` to the store, and resolves
with the raw metadata. If another request loaded metadata for the same service while this
one was in flight, it resolves with the string `"already fetched"` instead.

The `EntityManager` calls `fetchMetadata` automatically only when
`dataService.hasServerMetadata` is true. The adapter itself does not check that flag.

### executeQuery

The `mappingContext` describes the query:

| Member | |
|---|---|
| `query` | the `EntityQuery` (or resource name string) being executed |
| `entityManager`, `metadataStore` | the manager running it, and its store |
| `dataService` | the resolved `DataService` |
| `mergeOptions` | `mergeStrategy`, `noTracking`, `includeDeleted` |
| `jsonResultsAdapter` | the adapter that will read the results |
| `getUrl()` | the query URL, built by the URI builder |

`AbstractDataServiceAdapter.executeQuery` sends `GET getUrl()`. Any
`query.withParameters(...)` values go into the query string, and only there: the URI
builder leaves them out of the JSON. If the query has `usePost()`, it POSTs the query as
JSON to `{serviceName}/{resourceName}` instead; the parameters still go in the query string.

It resolves with this object, which Breeze then passes to the JsonResultsAdapter's
`extractResults`:

| Property | |
|---|---|
| `results` | the payload's `results` (or `Results`) property if it has one, otherwise the whole payload |
| `inlineCount` | the payload's `inlineCount` (or `InlineCount`), if present |
| `httpResponse` | the full response |
| `query` | the query |

### saveChanges

The `saveContext` carries `entityManager`, `dataService`, and `resourceName` (default
`'SaveChanges'`). `AbstractDataServiceAdapter` also sets `saveContext.adapter`. The
`saveBundle` has the `entities` to save and the `saveOptions`.

`AbstractDataServiceAdapter.saveChanges` runs the whole save:

1. It calls `_prepareSaveBundle(saveContext, saveBundle)` and `JSON.stringify`s the
   result.
2. It POSTs that to `dataService.qualifyUrl(resourceName)`.
3. It treats a response that contains `errors` or `Errors` as a failure, even when the
   HTTP status is a success.
4. It calls `_prepareSaveResult(saveContext, data)` and adds `httpResponse` to what that
   returns.

A save result has these properties:

| Property | |
|---|---|
| `entities` | the saved entities as raw data, in a shape the adapter's `jsonResultsAdapter` understands |
| `keyMappings` | one `{ entityTypeName, tempValue, realValue }` for each new entity that was saved with a temporary key |
| `deletedKeys` | optional: `{ entityTypeName, keyValues }` for entities the server deleted that were not in the bundle |
| `httpResponse` | the full response |

Breeze merges each item in `entities` into the cache, overwriting what was there. An
entity that is not in `entities` is not updated, and stays `Modified` or `Added`. The
server's copy matters, because the server may have changed values during the save — a
concurrency token, a computed total. If an item in `entities` is an entity instance
rather than raw data, Breeze accepts its changes as they are, and detaches it if it was
deleted.

### Errors

A failed request rejects with an `Error` carrying:
- `status`
- `message`
- `statusText`, `url` and `body` (the response body, as received)
- `httpResponse`
- `entityErrors`, for a failed save that reported per-entity validation errors

The adapter reads the message from a .NET exception response (the innermost
`ExceptionMessage` or `Message`), or from a plain `{ message, errors }` object. Property
names in `entityErrors` are translated with the store's `NamingConvention`. Breeze adds
those errors to the matching entities' validation errors — see
[Saving changes](/guide/saving-changes).

A status of 0 means the request got no response at all. The static helper
`AbstractDataServiceAdapter._catchNoConnectionError(err)` then adds to the message, keeping
what the transport said: "HTTP response status 0: TypeError: fetch failed. Likely did not
or could not reach server. Is the server running?" It leaves an aborted request alone.

The abstract adapter builds every error with the static
`AbstractDataServiceAdapter.makeHttpError(httpResponse, messagePrefix?)`, which does all of
the above. If your adapter makes a request some other way, build its error with the same
method and throw it. To get `entityErrors` for a save, set `httpResponse.saveContext` first.

A save whose response has no body rejects with an error that says so.

## Writing an adapter

`AbstractDataServiceAdapter` suits services that accept a batch of changes in one POST, as
the Breeze .NET server does. If your server wants one request per entity, as most REST
APIs do, override `saveChanges` entirely.

| Member | Override? |
|---|---|
| `name` | Always. Set it in the constructor. |
| static `register()` | Always, so that `configureBreeze` can register the adapter. |
| `_prepareSaveBundle(saveContext, saveBundle)` | Yes, if the adapter saves. It returns the object to send. |
| `_prepareSaveResult(saveContext, data)` | Yes, if the adapter saves. It turns the response body into a save result, without `httpResponse`. |
| `jsonResultsAdapter` | Usually. |
| `fetchMetadata` | If metadata comes from somewhere else, or in another format. |
| `executeQuery` | To change how queries are sent, or to reshape the response first. |
| `saveChanges` | Only if a save is not a single POST. |
| `initialize`, `checkForRecomposition` | Rarely. |

The base class declares `_prepareSaveBundle` and `_prepareSaveResult`, but they only
throw `Need a concrete implementation`.

### The `_ajax` helper

All three operations make their requests through one protected method:

```ts
protected _ajax(
  config: Omit<AjaxConfig, 'success' | 'error'>,
  errorMessagePrefix?: string,
  prepareResponse?: (httpResponse: HttpResponse) => void,
): Promise<HttpResponse>
```

- `config` takes `url`, `type` (the HTTP method), `data`, `contentType` and `params`, and
  `headers`, which are sent with that one request. `dataType` and `crossDomain` are
  ignored. For headers on every request, supply a custom [transport](/server/transport).
- `errorMessagePrefix` goes at the start of the error message if the request fails.
- `prepareResponse` runs on the response before the promise settles, on success or
  failure. `saveChanges` uses it to attach the `saveContext`, so that errors can report
  per-entity validation failures.

For example, suppose the server returns `{ items, total }` rather than
`{ results, inlineCount }`. You could override `executeQuery` like this:

```ts
async executeQuery(mappingContext: MappingContext): Promise<QueryResult> {
  const httpResponse = await this._ajax({ type: 'GET', url: mappingContext.getUrl() });
  const { items, total } = httpResponse.data;
  return { results: items, inlineCount: total, httpResponse, query: mappingContext.query };
}
```

### Example: a change-set server

Suppose a server accepts saves in this shape:

```json
{
  "changes": [
    { "type": "Order", "state": "Added", "values": { "OrderID": -1, "ShipName": "Box" } }
  ]
}
```

and replies like this:

```json
{
  "saved":  [ { "type": "Order", "OrderID": 10248, "ShipName": "Box" } ],
  "keyMap": [ { "type": "Order", "tempId": -1, "id": 10248 } ]
}
```

It has no metadata endpoint, and every entity in a response carries a `type` property.
Here is a complete adapter for it:

```ts
import {
  AbstractDataServiceAdapter, BreezeConfig, config, EntityType, JsonResultsAdapter,
} from 'breeze-client';
import type {
  KeyMapping, MappingContext, SaveBundle, SaveContext, SaveResult,
} from 'breeze-client';

export class ChangeSetAdapter extends AbstractDataServiceAdapter {
  constructor() {
    super();
    this.name = 'changeSet';
  }

  static register(breezeConfig: BreezeConfig = config) {
    breezeConfig.registerAdapter('dataService', ChangeSetAdapter);
    return breezeConfig.initializeAdapterInstance('dataService', 'changeSet', true) as ChangeSetAdapter;
  }

  // This server has no metadata endpoint.
  async fetchMetadata(): Promise<any> {
    throw new Error(`The '${this.name}' service has no metadata. Import it with MetadataStore.importMetadata.`);
  }

  // Entities to save  ->  request body
  _prepareSaveBundle(saveContext: SaveContext, saveBundle: SaveBundle) {
    const interceptor = this._createChangeRequestInterceptor(saveContext, saveBundle);

    const changes = saveBundle.entities.map((entity, index) => {
      const values: Record<string, unknown> = {};
      for (const dp of entity.entityType.dataProperties) {
        values[dp.nameOnServer] = entity.getProperty(dp.name);
      }
      const request = {
        type: entity.entityType.shortName,
        state: entity.entityAspect.entityState.name,
        values,
      };
      return interceptor.getRequest(request, entity, index);
    });

    interceptor.done(changes);
    return { changes };
  }

  // Response body  ->  SaveResult
  _prepareSaveResult(saveContext: SaveContext, data: any): SaveResult {
    const metadataStore = saveContext.entityManager.metadataStore;
    const keyMappings: KeyMapping[] = (data.keyMap ?? []).map((k: any) => ({
      entityTypeName: metadataStore.getEntityType(k.type)!.name,
      tempValue: k.tempId,
      realValue: k.id,
    }));
    return { entities: data.saved ?? [], keyMappings };
  }

  // Query and save results carry their type in a 'type' property.
  jsonResultsAdapter = new JsonResultsAdapter({
    name: 'changeSet',
    visitNode: (node: any, mappingContext: MappingContext) => {
      const entityType = node?.type
        ? mappingContext.entityManager.metadataStore.getEntityType(node.type, true) as EntityType
        : undefined;
      return { entityType };
    },
  });
}
```

Register it like any other adapter:

```ts
configureBreeze({
  dataService: ChangeSetAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
});

const em = new EntityManager({
  dataService: new DataService({ serviceName: '/api', hasServerMetadata: false }),
});
em.metadataStore.importMetadata(metadataJson);
```

A few details of the example:
- The values are keyed by `nameOnServer`, so the store's `NamingConvention` applies.
  Queries need no special code: the default `executeQuery` and the URI builder already
  send server names.
- After a save, Breeze uses `keyMap` to replace the temporary `OrderID` with 10248. It
  then merges the `saved` data into the cache, and the order becomes `Unchanged`.
- `_createChangeRequestInterceptor` is the protected helper the built-in adapter uses too.
  It checks that the interceptor has `getRequest` and `done`, falls back to a no-op when
  `changeRequestInterceptor` is `null`, and honours `oneTime` (see
  [Adjusting save requests](#adjusting-save-requests)).

### Deriving from the Web API adapter

When `DataServiceWebApiAdapter` is almost right, subclass it and change only what
differs. Its static `register()` registers `DataServiceWebApiAdapter` itself, so give the
subclass its own name and its own `register()`:

```ts
import { BreezeConfig, config } from 'breeze-client';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';

export class MyWebApiAdapter extends DataServiceWebApiAdapter {
  constructor() {
    super();
    this.name = 'myWebApi';
  }

  static register(breezeConfig: BreezeConfig = config) {
    breezeConfig.registerAdapter('dataService', MyWebApiAdapter);
    return breezeConfig.initializeAdapterInstance('dataService', 'myWebApi', true) as MyWebApiAdapter;
  }

  jsonResultsAdapter = myJsonResultsAdapter;
}
```

## Adjusting save requests

Sometimes an adapter's save request is nearly right, and only a detail needs to change.
Perhaps you want to drop an unmapped property, or not send the original value of a huge
text field. The `changeRequestInterceptor` handles this without a new adapter.

Set it to a class. The adapter constructs it once per save, calls `getRequest` for each
entity, then calls `done` with the finished array:

```ts
import type { ChangeRequestInterceptor, Entity, SaveBundle, SaveContext } from 'breeze-client';

class ClearOriginalNotes implements ChangeRequestInterceptor {
  constructor(private saveContext: SaveContext, private saveBundle: SaveBundle) {}

  // Called once per entity. Must return the (possibly modified) request.
  getRequest(request: any, entity: Entity, index: number) {
    const originalValues = request.entityAspect.originalValuesMap;
    if ('Notes' in originalValues) {
      // Keep the key, so the server still updates Notes; drop the large original value.
      originalValues.Notes = null;
    }
    return request;
  }

  // Called once with every request. The return value is ignored.
  done(requests: object[]) {}
}
```

To install it, you need the adapter instance, which `register()` returns. Leave
`dataService` out of `configureBreeze`, and register the adapter yourself:

```ts
configureBreeze({
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
});

const dsAdapter = DataServiceWebApiAdapter.register();
dsAdapter.changeRequestInterceptor = ClearOriginalNotes;
```

In the Web API adapter, a request is one entity's raw data, using server property names,
plus an `entityAspect` holding:
- `entityTypeName`
- `defaultResourceName`
- `entityState`
- `originalValuesMap` (also keyed by server names)
- `autoGeneratedKey`

Setting `changeRequestInterceptor` to `null` restores the default, which changes nothing.
An interceptor without `getRequest` or `done` makes the save throw.

To intercept only the next save, give the class a `oneTime = true` property. After that
save, the adapter goes back to the default interceptor.

### Which interceptor?

You can also change requests at the transport level, with a custom `fetch` — see [Supplying your own transport](/server/transport).
That sees every request, including metadata and queries, but only as a URL and a body,
with no context.

The `changeRequestInterceptor` runs only for saves. It is called per entity, with the
entity, the `saveContext` and the `saveBundle` at hand. For save-specific changes it is
far easier to work with. Use a custom `fetch` for concerns that span all requests, such
as auth headers.
