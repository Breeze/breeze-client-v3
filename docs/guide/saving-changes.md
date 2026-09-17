# Saving changes

Call `saveChanges()` on the `EntityManager` to send pending changes to the server.

```ts
try {
  const saveResult = await em.saveChanges();
  console.log(`${saveResult.entities.length} entities saved`);
} catch (e: any) {
  console.error('Save failed', e.message);
}
```

You do not need to check `em.hasChanges()` first. If there is nothing to save,
`saveChanges()` makes no request and resolves with an empty result. Check it anyway if
you want to tell the user there was nothing to save.

## What happens in a save

1. The manager collects every entity in the cache that is `Added`, `Modified` or
   `Deleted`.
2. It clears any server validation errors left on those entities from an earlier save.
3. If `validationOptions.validateOnSave` is true (the default), it validates each entity
   that is not `Deleted`. If any entity has errors, the save is rejected before anything
   is sent. See [Validation](/guide/validation).
4. It sends all the changes in one POST to `<serviceName>/SaveChanges`. A Breeze server
   saves them in one transaction.
5. When the response arrives, it updates the cache.

`saveChanges` returns a promise. The cache stays usable while the request is in flight.

## After the save

**If the save fails,** the cache is left as it was. Entities with pending changes keep
them, and you can fix the problem and save again.

**If the save succeeds,** the server returns the saved entities, which may include
values set on the server. Breeze merges them into the cache, overwriting the client's
values. Then:

- added and modified entities become `Unchanged`, with no original values;
- deleted entities are removed from the cache and become `Detached`;
- entities listed in the response's `deletedKeys` (deleted by server logic, not by the
  client) are detached too.

The resolved [`SaveResult`](/api/interfaces/SaveResult) has:

| Property | |
|---|---|
| `entities` | the saved entities, including the ones that were deleted and are now detached |
| `keyMappings` | temporary-to-permanent key mappings — see below |
| `deletedKeys` | keys of entities the server deleted on its own |
| `httpResponse` | the raw response |

## Key fixup

A new entity with a store-generated key gets a temporary key when you create it,
typically a negative number. The database assigns the real key during the save. The
server reports each change as a [`KeyMapping`](/api/interfaces/KeyMapping)
(`entityTypeName`, `tempValue`, `realValue`), and Breeze updates the entity's key and every
foreign key in the cache that pointed at the temporary value.

If you save a new `Order` with two new `OrderDetail`s, the details' `orderID` values change
from the temporary `-1` to the new order's real ID. You do not have to do anything.

## Saving selected entities

Pass an array to save only those entities:

```ts
await em.saveChanges([order, ...order.orderDetails]);
```

The entities must belong to this manager. Each one is sent as it is, whatever its state,
except detached entities, which are skipped.

Be careful with this. It is easy to save a new `OrderDetail` without its new parent
`Order`, or leave out an entity the server needs. Saving everything is usually the safer
default.

## Save errors

This section covers errors specific to saving. For the shape of a Breeze error in general,
telling a network failure from a rejected request, and handling errors in your own `fetch`, see
[Error handling](/guide/error-handling).

A failed save rejects with an `Error`. When the failure concerns particular entities, the
error has an `entityErrors` array of [`EntityError`](/api/interfaces/EntityError)
objects:

| Property | |
|---|---|
| `entity` | the entity concerned, if Breeze could find it in the cache |
| `errorName` | the validator or server error name |
| `errorMessage` | the message |
| `propertyName` | the property concerned, if any |
| `isServerError` | `false` for client validation, `true` for errors from the server |

```ts
try {
  await em.saveChanges();
} catch (e: any) {
  if (e.entityErrors) {
    for (const err of e.entityErrors) {
      console.warn(`${err.propertyName ?? '(entity)'}: ${err.errorMessage}`);
    }
  } else {
    console.error(e.message);   // network failure, concurrency violation, server exception
  }
}
```

Both kinds of error are also added to the entity's own validation errors, so a form bound
to `entity.entityAspect.getValidationErrors()` shows them without extra code. Breeze removes
server errors from an entity automatically at the start of its next save.

On the server, you report entity-level failures by throwing `EntityErrorsException` from a
save interceptor. With the Breeze ASP.NET Core server:

```csharp
protected override Dictionary<Type, List<EntityInfo>> BeforeSaveEntities(
    Dictionary<Type, List<EntityInfo>> saveMap) {
  if (saveMap.TryGetValue(typeof(Order), out var orderInfos)) {
    var errors = orderInfos
      .Where(oi => ((Order)oi.Entity).Freight > 1000)
      .Select(oi => new EFEntityError(oi, "FreightLimit", "Freight cannot exceed 1000", "Freight"))
      .ToList();
    if (errors.Any()) throw new EntityErrorsException("Order validation failed", errors);
  }
  return base.BeforeSaveEntities(saveMap);
}
```

Breeze converts the server's property names with the naming convention, so
`"Freight"` arrives as `propertyName: 'freight'`. The response status defaults to
403 Forbidden.

### The shape of a server error response

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
  "EntityErrors": [ { "ErrorName": "FreightLimit", "EntityTypeName": "Northwind.Models.Order", … } ]
}
```

The first four members are the standard ones, and they are what to read. The capitalised
members below them are what Breeze sent before 3.0, kept so that an application on an older
client reads the error unchanged — RFC 9457 §3.2 permits extension members and requires
consumers to ignore ones they do not recognise, so the document is conformant either way.

Breeze understands all of it for you: `e.message` comes from `detail`, falling back to
`title`, and entity errors are read from either spelling. You only need this if you are
writing your own client, or reading the response in a browser's network tab.

Two server settings control it:

| `BreezeConfig` | default | |
|---|---|---|
| `IncludeStackTraceInErrors` | `false` | a stack trace names source files, line numbers and the build machine's directory layout — turn it on for development only |
| `IncludeLegacyErrorMembers` | `true` | set `false` once every client reads the RFC 9457 members |

## SaveOptions

A [`SaveOptions`](/api/classes/SaveOptions) instance controls how a save is made.

| Option | Default | |
|---|---|---|
| `resourceName` | `'SaveChanges'` | the server endpoint to POST to |
| `dataService` | the manager's | send the save to a different service |
| `allowConcurrentSaves` | `false` | whether an entity may be saved while an earlier save of it is still in flight |
| `tag` | none | any value; sent to the server as `saveOptions.tag` |

Pass options to one save:

```ts
import { SaveOptions } from 'breeze-client';

await em.saveChanges(null, new SaveOptions({ tag: 'approve' }));
```

Or set them on the manager as the default for every save:

```ts
em.setProperties({ saveOptions: new SaveOptions({ allowConcurrentSaves: true }) });
```

`using` returns a modified copy, which is handy for starting from the manager's options:

```ts
const so = em.saveOptions.using({ resourceName: 'SaveWithAudit' });
```

## Named saves

By default every save goes to the `SaveChanges` endpoint. Sometimes a set of changes is
really a command with its own server-side workflow: approve an order, close a period.
Rather than route everything through one endpoint and dispatch on the server, you can POST
to an endpoint for that command. This is a *named save*.

```ts
const so = new SaveOptions({ resourceName: 'SaveWithComment' });

await em.saveChanges(null, so);            // all pending changes
await em.saveChanges(selectedEntities, so); // or a chosen set
```

The request body is the same change-set that `SaveChanges` would receive, so the server
method has the same signature. In ASP.NET Core:

```csharp
[Route("breeze/[controller]/[action]")]
public class NorthwindIBModelController : Controller {
  private NorthwindPersistenceManager PersistenceManager;

  [HttpPost]
  public Task<SaveResult> SaveChanges([FromBody] JObject saveBundle) {
    return PersistenceManager.SaveChangesAsync(saveBundle);
  }

  [HttpPost]
  public Task<SaveResult> SaveWithComment([FromBody] JObject saveBundle) {
    PersistenceManager.BeforeSaveEntitiesDelegate = AddComment;
    return PersistenceManager.SaveChangesAsync(saveBundle);
  }
}
```

Set `SaveOptions.dataService` as well if the endpoint is on a different service.

## Sending extra information with `tag`

`tag` is a free-form value delivered to the server with the save. The server reads it
from `SaveOptions.Tag`:

```ts
await em.saveChanges(null, new SaveOptions({ tag: 'addProdOnServer' }));
```

```csharp
protected override bool BeforeSaveEntity(EntityInfo entityInfo) {
  if ((string)SaveOptions.Tag == "addProdOnServer") {
    // ...
  }
  return base.BeforeSaveEntity(entityInfo);
}
```

## Optimistic concurrency

A data property whose metadata has a `concurrencyMode` other than `"None"` is a
concurrency property, such as a `RowVersion` column. When you save a modified entity,
Breeze updates its concurrency property first, unless you already changed it. Numeric
values are incremented, and GUID and date-time values get new values. Binary values are
assumed to be database-generated rowversions and left alone.

The server compares the original value with the database. If someone else saved the row
in the meantime, the save fails. Against the ASP.NET Core server the error message
mentions an optimistic concurrency failure. The entity keeps its pending changes, so you
can re-query it and try again.

## Changes during a save

While a save is in flight, the entities in it have `entityAspect.isBeingSaved` set to
`true`.

- **Saving again.** By default, a second `saveChanges` that includes an entity from an
  in-flight save is rejected with `Concurrent saves not allowed - SaveOptions.allowConcurrentSaves is false`.
  Saves of other entities go ahead. Setting `allowConcurrentSaves` lifts the check. Do
  that only if you understand the consequences: the second save may send stale original
  values or temporary keys.
- **Editing.** You can change an entity that is being saved, but when the save completes
  the server's values overwrite your edit. Changes to entities that were not part of the
  save are untouched, and `hasChanges()` stays true afterwards.
- **Rejecting, deleting, clearing.** `rejectChanges()` on an entity being saved throws,
  and so does `em.clear()`. Deleting or detaching a new entity that is waiting for its
  server-generated key also throws. Each error says the entity is "in the process of
  being saved".

The usual answer is to disable the save button, and edits if necessary, until the save
returns.

## Save queuing

Some applications save automatically after every edit, and a user can easily make a
second change before the first save returns. Save queuing handles that: while a save is
in flight, further `saveChanges` calls are held back and sent as one follow-up save when
the first returns.

```ts
import { enableSaveQueuing } from 'breeze-client/mixin-save-queuing';

enableSaveQueuing(em, true);

const p1 = em.saveChanges();   // sent now
editSomething();
const p2 = em.saveChanges();   // queued; sent when p1's save returns
```

Each promise resolves with the result of the save that included its changes. If a queued
save fails, every pending promise rejects with a `QueuedSaveFailedError`. Its
`innerError` is the underlying error.

Limitations:

- The `SaveOptions` of the first save are reused for the queued saves.
- Only the promise form works. The deprecated callback arguments are ignored.
- It does not queue parallel saves, even of independent change-sets.
- It is meant for short-latency auto-save. It does not help with offline work, and it does
  not cope with `rejectChanges`, export/import or primary-key changes while a save is in
  flight.

Turn it off again with `enableSaveQueuing(em, false)`. Calling it more than once on the
same manager is harmless.

::: tip Fixed in 3.0
In 2.x a second call to `enableSaveQueuing` on the same manager, including turning it off,
left `saveChanges` returning a promise that never settled.
:::

## What goes over the wire

You only need this if you are writing a server or a custom
[data service adapter](/server/dataserviceadapter).

The request body lists the entities as a flat array. Navigation properties are not
included; relationships are carried by foreign keys. Each entity has an `entityAspect`
describing it:

```json
{
  "entities": [
    {
      "OrderID": -1,
      "CustomerID": "785efa04-cbf2-4dd7-a7de-083ee17b6ad2",
      "EmployeeID": 1,
      "Freight": null,
      "RowVersion": 0,
      "entityAspect": {
        "entityTypeName": "Order:#Models.NorthwindIB.CF",
        "defaultResourceName": "Orders",
        "entityState": "Added",
        "originalValuesMap": {},
        "autoGeneratedKey": { "propertyName": "OrderID", "autoGeneratedKeyType": "Identity" }
      }
    },
    {
      "OrderID": -1,
      "ProductID": 1,
      "Quantity": 5,
      "entityAspect": {
        "entityTypeName": "OrderDetail:#Models.NorthwindIB.CF",
        "defaultResourceName": "OrderDetails",
        "entityState": "Added",
        "originalValuesMap": {}
      }
    }
  ],
  "saveOptions": { "tag": null }
}
```

- Property names are in server form. The naming convention has already been applied.
- `entityState` tells the server whether to insert, update or delete.
- `originalValuesMap` holds the original value of each changed property, so the server
  knows which columns to update.
- `autoGeneratedKey` is present when the key is store-generated. The `OrderID` of `-1` is
  a temporary key.
- `saveOptions` carries only the `tag`.

The response has the saved entities, key mappings, keys deleted on the server, and
errors:

```json
{
  "Entities": [
    { "$id": "1", "$type": "Models.NorthwindIB.CF.Order, Model_NorthwindIB_CF.EFCore",
      "OrderID": 11078, "CustomerID": "785efa04-cbf2-4dd7-a7de-083ee17b6ad2", "RowVersion": 0 },
    { "$id": "2", "$type": "Models.NorthwindIB.CF.OrderDetail, Model_NorthwindIB_CF.EFCore",
      "OrderID": 11078, "ProductID": 1, "Quantity": 5 }
  ],
  "KeyMappings": [
    { "EntityTypeName": "Models.NorthwindIB.CF.Order", "TempValue": -1, "RealValue": 11078 }
  ],
  "DeletedKeys": [],
  "Errors": null
}
```

Entities may be returned as a graph with `$id`/`$ref` references, like a query response.
Breeze reconnects them by foreign key in any case. The client accepts both `Entities` and
`entities` for the top-level names, and likewise for the others.

## See also

- [Validation](/guide/validation)
- [EntityManager and caching](/guide/entitymanager-and-caching)
- API: [EntityManager.saveChanges](/api/classes/EntityManager), [SaveOptions](/api/classes/SaveOptions), [SaveResult](/api/interfaces/SaveResult)
