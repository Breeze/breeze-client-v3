# Export and import

An application may need to keep working when the connection drops, survive being
suspended or reloaded, or hold a user's unsaved work across sessions. It can do that by
saving cached entities locally and restoring them later.

`EntityManager.exportEntities` serializes some or all of the cache.
`importEntities` merges an export back into a manager: the same one, a new one in a
later session, or another manager in the same session.

## Export the cache

```ts
const exported = em.exportEntities() as string;
```

With no arguments, the export is a string containing every entity in the cache, with
its state and original values. It also contains the manager's metadata, data service,
and query, save and validation options.

Store it wherever you like:

```ts
localStorage.setItem('stash_everything', exported);
```

## Import it

```ts
const stash = localStorage.getItem('stash_everything');
if (stash) em.importEntities(stash);
```

Or create a new manager from the export in one step:

```ts
import { EntityManager } from 'breeze-client';

const em = EntityManager.importEntities(stash);
```

The static form returns the new manager. The instance form returns
`{ entities, tempKeyMapping }`: the imported entities, and how any temporary keys were
remapped (see [New entities and temporary keys](#new-entities-and-temporary-keys)).

When the export includes metadata, importing it also sets the target manager's data
service and its query, save and validation options to those in the export.

## Merging with what is already cached

If the target manager already holds an entity with the same key, the merge strategy
decides what happens. By default it is the manager's query merge strategy,
`MergeStrategy.PreserveChanges`:

- a cached entity that is `Unchanged` is overwritten with the imported values and state;
- a cached entity with pending changes is left as it is.

Pass a different strategy to override that:

```ts
import { MergeStrategy } from 'breeze-client';

em.importEntities(stash, { mergeStrategy: MergeStrategy.OverwriteChanges });
```

| Strategy | Cached entity with the same key |
|---|---|
| `PreserveChanges` | overwritten only if it has no pending changes |
| `OverwriteChanges` | always overwritten |
| `SkipMerge` | left alone |
| `Disallowed` | the import throws |

## Export selected entities

Pass an array of entities to export only those:

```ts
import { EntityQuery } from 'breeze-client';

em.exportEntities([someCustomer]);
em.exportEntities([cust1, cust2]);
em.exportEntities(em.getChanges());      // all pending changes

const cCustomers = em.executeQueryLocally(
  EntityQuery.from('Customers').where('companyName', 'startsWith', 'C'));
em.exportEntities(cCustomers);
```

Or pass entity types, or their names, to export every cached entity of those types:

```ts
em.exportEntities(['Customer', 'Employee']);
```

An empty array exports no entities. Detached entities cannot be exported; including one
throws.

## Export options

The second argument is an options object:

| Option | Default | |
|---|---|---|
| `includeMetadata` | `true` | include metadata, data service and options |
| `asString` | `true` | return a JSON string; `false` returns a plain object |

```ts
// A plain object, e.g. for IndexedDB, which stores objects directly.
const bundle = em.exportEntities(['Customer'], { asString: false, includeMetadata: false });
```

`importEntities` accepts either form.

::: tip Deprecated form
`exportEntities(entities, false)` — a boolean second argument meaning `includeMetadata` —
still works, but prefer the options object.
:::

## Export without metadata

The metadata for a model can be many times larger than the entity data in a small export.
If you store several exports, repeating the metadata in each wastes space. Leave it out:

```ts
const changes = em.exportEntities(em.getChanges(), { includeMetadata: false });
```

An export without metadata can only be imported into a manager that **already has the
matching metadata**. Otherwise the import throws. Load metadata first, by querying,
calling `em.fetchMetadata()`, or importing it from your own store.

## Copying entities between managers

You may keep several managers to isolate parallel work, such as editing two customers
independently. To move entities from one to another, export from one and import into the
other:

```ts
const em2 = em1.createEmptyCopy();   // same metadata and settings, no entities

const exported = em1.exportEntities(selectedEntities, { includeMetadata: false });
em2.importEntities(exported);
```

`createEmptyCopy` shares `em1`'s metadata store, so the export does not need to carry
metadata.

## Several imports

Each import merges on top of the previous ones. You might store stable reference data
under one key and pending changes under another, and import both at startup:

```ts
em.importEntities(localStorage.getItem('reference')!);
em.importEntities(localStorage.getItem('pending-changes')!);
```

## New entities and temporary keys

You can export and import entities with pending changes, including new ones. A new
entity with a store-generated key has a temporary key until it is saved. The export
records which keys are temporary.

On import, Breeze gives each such entity a temporary key from the **target** manager's
key generator. It keeps the old value if that value is free there, and picks a new one if
it is not. Foreign keys in the import that pointed at the old key are updated to match. So
an imported new entity may not have the same temporary key it had when exported:

```ts
// Session 1: a new order with temporary key -1
const acme = em1.createEntity('Order', { shipName: 'Acme' });
const exported = em1.exportEntities([acme], { includeMetadata: false });

// Session 2: another new order already has -1
const beta = em2.createEntity('Order', { shipName: 'Beta' });
const { entities, tempKeyMapping } = em2.importEntities(exported);
const acme2 = entities[0];

acme2.getProperty('shipName');   // 'Acme'
acme2.getProperty('orderID');    // not -1: that key was taken by 'beta'
```

`tempKeyMapping` maps each original key, as a string, to the `EntityKey` it was given.

Because two new entities with the same temporary key are not necessarily the same
entity, an imported `Added` entity with a temporary key is always added as a new entity
and never merged with a cached one. If you know better, `mergeAdds: true` in the import
config merges them anyway. Use it with care.

## Offline and versioning

Storing data locally is especially useful offline, and there is always some risk in data
that exists only on the device. There is another risk: days or weeks may pass between
export and import. If your model changes in between, an old export may fail to import. It
could also import without an error while leaving entities that do not match the current
model.

Detect this before you import. One way is to name the `MetadataStore` after your model
version:

```ts
const modelVersion = 'northwind-model 1.2.3';
em.metadataStore.setProperties({ name: modelVersion });
```

An export without metadata records the metadata format version
(`MetadataStore.metadataVersion`) and the store's `name`. Give `importEntities` a
`metadataVersionFn` to check them before anything is merged. It receives both values and
should throw to stop the import:

```ts
import { MetadataStore } from 'breeze-client';

const exported = em.exportEntities(null, { includeMetadata: false });

// ... much later ...

try {
  em.importEntities(exported, {
    metadataVersionFn: ({ metadataVersion, metadataStoreName }) => {
      if (metadataVersion !== MetadataStore.metadataVersion) {
        throw new Error(`Breeze metadata format ${metadataVersion}; expected ${MetadataStore.metadataVersion}`);
      }
      if (metadataStoreName !== modelVersion) {
        throw new Error(`Export is for ${metadataStoreName}; this app is ${modelVersion}`);
      }
    },
  });
} catch (e) {
  // discard the stash, or migrate it
}
```

`metadataVersionFn` is called only for exports **without** metadata. An export that
includes metadata brings its own, and that metadata is imported into the target
manager's store.

If you have custom validators, register them before importing an export that includes
metadata. See [Registering custom validators](/guide/validation#registering-custom-validators).

::: tip Unchanged from 2.x
The export format is the same as in Breeze 2.x, and the metadata format version is still
`1.0.5`. Exports stored by a 2.x application import into 3.x.
:::

## See also

- [EntityManager and caching](/guide/entitymanager-and-caching)
- [Metadata](/metadata/) — the `MetadataStore`'s own `exportMetadata` and `importMetadata`
- API: [EntityManager](/api/classes/EntityManager), [MergeStrategy](/api/classes/MergeStrategy), [MetadataStore](/api/classes/MetadataStore)
