# Transforming JSON results

After a query or a save, Breeze turns the JSON from the server into entities in the
cache. This is called materialization. A `JsonResultsAdapter` tells Breeze how to read
that JSON: where the results are, which objects are entities and of what type, and what to
skip.

## Why an adapter is needed

If the server's JSON matched the client's entities exactly, Breeze could simply copy
property values across. Sometimes it nearly does. When the only difference is predictable
— `FirstName` on the server, `firstName` on the client — a
[NamingConvention](/server/namingconvention) handles it.

Real payloads usually carry more than that. Here is a Json.NET response for sales reps and
their orders:

```json
[
  {
    "$id": "1",
    "$type": "Models.Person, Models",
    "PersonID": 42,
    "FirstName": "Nancy",
    "LastName": "Davolio",
    "Orders": [
      {
        "$id": "2",
        "$type": "Models.Order, Models",
        "OrderID": 10258,
        "PersonID": 42,
        "Freight": 142.51,
        "Person": { "$ref": "1" }
      }
    ]
  }
]
```

A reader can see what this is: an array of people, each with an array of orders. The
`$` properties are not entity data but serialization artifacts:
- `$type` names the object's type.
- `$id` is a serialization counter, not the entity's key.
- `$ref` points back to an object seen earlier. Here, `Person: { "$ref": "1" }` is Nancy
  again.

Breeze cannot guess any of that. The `JsonResultsAdapter` tells it.

A `JsonResultsAdapter` works in one direction only: server JSON to entities. Turning
entities into a save request is the data service adapter's job — see
[`_prepareSaveBundle`](/server/dataserviceadapter#writing-an-adapter).

## Where the adapter comes from

Every data service adapter has a `jsonResultsAdapter`, and services that use it get that
one by default. `DataServiceWebApiAdapter`'s adapter is named `'webApi_default'`. It
understands the Breeze .NET server's JSON, and is essentially this:

```ts
import { JsonResultsAdapter, MetadataStore, EntityType } from 'breeze-client';
import type { MappingContext, NodeContext } from 'breeze-client';

const webApiLike = new JsonResultsAdapter({
  name: 'webApiLike',
  visitNode: (node: any, mappingContext: MappingContext, nodeContext: NodeContext) => {
    if (node == null) return {};
    const typeName = node.$type && MetadataStore.normalizeTypeName(node.$type);
    const entityType = typeName
      ? mappingContext.entityManager.metadataStore.getEntityType(typeName, true) as EntityType
      : undefined;
    return {
      entityType,
      nodeId: node.$id,
      nodeRefId: node.$ref,
      ignore: !!nodeContext.propertyName?.startsWith('$'),
    };
  },
});
```

To use a different adapter, set it at the scope you need:

**One query.**

```ts
const query = EntityQuery.from('Search').using(searchResultsAdapter);
```

**One service.** Every query against the service uses it. With `DataServiceWebApiAdapter`,
so do saves: its `extractSaveResults`, `extractKeyMappings` and `extractDeletedKeys` read
the save response.

```ts
const searchService = new DataService({
  serviceName: '/api/search',
  hasServerMetadata: false,
  jsonResultsAdapter: searchResultsAdapter,
});
const em = new EntityManager({ dataService: searchService });
```

**Every service that uses a data service adapter.** Set `jsonResultsAdapter` on the
adapter instance that `register()` returns. Or subclass the adapter — see
[Deriving from the Web API adapter](/server/dataserviceadapter#deriving-from-the-web-api-adapter).

::: tip Changed in 3.0
`EntityQuery.using(jsonResultsAdapter)` now works in ES module builds. In the 2.x `mjs`
build, a `JsonResultsAdapter` lost its type brand, and `using` did not recognise it. See
[Migrating from 2.x](/guide/migrating-from-2x#fixed-along-the-way).
:::

## Creating a JsonResultsAdapter

```ts
const adapter = new JsonResultsAdapter({
  name: 'myAdapter',
  extractResults: (data: any) => data.results,
  visitNode: (node: any, mappingContext: MappingContext, nodeContext: NodeContext) => ({ /* ... */ }),
});
```

| Option | Default | Notes |
|---|---|---|
| `name` | — | Required. Adapters are registered by name, and an exported `DataService` refers to its adapter by name. |
| `visitNode(node, mappingContext, nodeContext)` | — | Required. Called for each node; see [below](#visitnode). |
| `extractResults(data)` | `data.results` | Called once per query to find the results. |
| `extractSaveResults(data)` | `data.entities` or `data.Entities` | Used by `DataServiceWebApiAdapter` to read a save response. |
| `extractKeyMappings(data)` | `data.keyMappings` or `data.KeyMappings` | Same. |
| `extractDeletedKeys(data)` | `data.deletedKeys` or `data.DeletedKeys` | Same. |

All four `extract*` functions return an empty array when there is nothing to find. A
custom data service adapter may ignore the three save extractors — its own
`_prepareSaveResult` reads the response.

### extractResults

`extractResults` is called once per query. Its argument is **not** the raw response
body. It gets the object that the data service adapter's `executeQuery` resolved with:

| Property | |
|---|---|
| `results` | the payload's `results` property if it has one, otherwise the whole payload |
| `inlineCount` | the payload's `inlineCount`, if present |
| `httpResponse` | the response; the raw body is `httpResponse.data` |
| `query` | the query |

Return a single node or an array of nodes. For a payload shaped like
`{ items: [...], count: 3 }`, that is `data.results.items`.

The query result's `inlineCount` comes from the data service adapter, not from
`extractResults`. To take a count from another property, override `executeQuery` — see
[The `_ajax` helper](/server/dataserviceadapter#the-ajax-helper).

### visitNode

Breeze walks the nodes that `extractResults` returned, depth first, and calls `visitNode`
on each one. It uses the return value to decide what to do with the node.

The `mappingContext` has `query`, `entityManager`, `metadataStore`, `dataService` and
`mergeOptions`. `query` is `undefined` when the nodes come from a save.

The `nodeContext.nodeType` says where the node came from:

| `nodeType` | The node is | Also in `nodeContext` |
|---|---|---|
| `'root'` | a top-level node, from `extractResults` or a save response | — |
| `'navProp'` | the value of an entity's scalar navigation property | `navigationProperty` |
| `'navPropItem'` | an item in an entity's collection navigation property | `navigationProperty` |
| `'anonProp'` | the value of a property of an anonymous node | `propertyName` (the client name) |
| `'anonPropItem'` | an item in an array property of an anonymous node | `propertyName` |

`visitNode` is **not** called for an entity's data properties, only for its navigation
properties. For an anonymous node, it is called for every property value, including
strings, numbers and `null`. For an array property, it is called once with the array and
then once per item. Guard against values that are not objects.

`visitNode` returns an object that may contain these properties:

| Property | Meaning |
|---|---|
| `entityType` | The node is an entity of this `EntityType`. Without it the node is anonymous. |
| `nodeId` | The node's serialization id, such as `$id`. |
| `nodeRefId` | The node is a reference to the node with this id, such as `$ref`. A reference may appear before its target; Breeze resolves it after the walk. |
| `ignore` | Skip this node and everything beneath it. |
| `passThru` | Return this anonymous node exactly as it is, with no name translation and no recursion. Ignored for entity nodes. |
| `node` | Use this object in place of the node. |
| `extraMetadata` | Stored on the entity as `entityAspect.extraMetadata`. |

Working out `entityType` is the adapter's most important job. It is easy when the node
names its type. Otherwise, work it out from the node's shape or from the context.

::: warning Navigation property nodes need a type too
Breeze does not infer the type of a `navProp` or `navPropItem` node from the navigation
property. If `visitNode` returns no `entityType` for one, the query fails. When the JSON
carries no type information, use the property's:

```ts
if (nodeContext.navigationProperty) {
  return { entityType: nodeContext.navigationProperty.entityType };
}
```
:::

If a `'root'` node from a query gets no `entityType`, Breeze uses the query's
`toType()`, if it has one. It does not work out a type from the resource name.

### What Breeze does with each node

- **Entity node.** Breeze reads each data property from the node by its `nameOnServer`,
  and ignores anything metadata doesn't know. It merges the entity into the cache by key,
  following the query's `MergeStrategy`. It then visits each navigation property's value
  as a node.
- **Anonymous node.** Breeze builds a new object. Each property name is translated with
  the `NamingConvention`, and each value is visited as a node. With `passThru`, it
  returns the node itself instead.

Either way Breeze copies the data. The JSON objects themselves are discarded — they are
never the objects a query returns.

### Changing the node

`visitNode` may change an entity node before Breeze reads it. You might rename a property,
or fill one in:

```ts
node.Foo = node.Bar;   // the server calls it Bar; the entity has Foo
delete node.Bar;
```

Keep three things in mind:
1. **Use server property names.** Breeze reads the node through each property's
   `nameOnServer`, so write `node.Foo`, not `node.foo`. Don't rename properties that the
   `NamingConvention` already translates.
2. **Unknown properties are dropped.** A property that metadata doesn't know, mapped or
   unmapped, is ignored.
3. **This works in one direction only.** Renaming `Bar` to `Foo` is fine for reading. To
   save `Foo` back as `Bar`, handle that in the data service adapter's
   `_prepareSaveBundle`, or in a
   [change request interceptor](/server/dataserviceadapter#adjusting-save-requests).

## Example: a non-Breeze search endpoint

Suppose a search endpoint returns mixed results with a `kind` property:

```json
{
  "items": [
    { "kind": "Customer", "CustomerID": "7e1c...", "CompanyName": "Acme" },
    { "kind": "Order", "OrderID": 7, "ShipName": "Box" },
    { "kind": "stats", "Total": 2 }
  ],
  "count": 3
}
```

This adapter finds the items, turns `Customer` and `Order` items into entities, and passes
anything else through untouched:

```ts
import { EntityType, JsonResultsAdapter } from 'breeze-client';
import type { MappingContext, NodeContext } from 'breeze-client';

const searchResultsAdapter = new JsonResultsAdapter({
  name: 'search',
  extractResults: (data: any) => data.results.items,
  visitNode: (node: any, mappingContext: MappingContext, nodeContext: NodeContext) => {
    if (nodeContext.nodeType !== 'root') return {};
    const metadataStore = mappingContext.entityManager.metadataStore;
    const entityType = metadataStore.getEntityType(node.kind, true) as EntityType | null;
    return entityType ? { entityType } : { passThru: true };
  },
});

const { results } = await em.executeQuery(EntityQuery.from('Search').using(searchResultsAdapter));
// results[0]: a Customer entity, results[1]: an Order entity,
// results[2]: { kind: 'stats', Total: 2 }, exactly as sent
```

`getEntityType(name, true)` returns `null` rather than throwing when there is no such
type. Without `passThru`, the stats object would still come back, as an anonymous object
with translated names: `{ kind: 'stats', total: 2 }`.

`count` does not become the query's `inlineCount`. See [extractResults](#extractresults).

See also the API reference for [JsonResultsAdapter](/api/classes/JsonResultsAdapter),
[NodeMeta](/api/interfaces/NodeMeta) and [NodeContext](/api/interfaces/NodeContext).
