# Getting started

## Install

```bash
npm install breeze-client
```

One package, one tag. If you are used to choosing between `breeze-client`,
`breeze-client@cjs` and `breeze-client@mjs`, that is gone — there is only `latest`.

**Requirements:** Node 20+ for server-side or test use, and any browser with native
`fetch`. Breeze 3 ships ES modules only, so you will be using a bundler (Vite, webpack,
esbuild, Rollup) or native `import`. There is no UMD bundle and no `<script>` tag build.

## Configure

Breeze needs four adapters wired up before you use it. Do this once, at startup:

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';
import { AjaxFetchAdapter } from 'breeze-client/adapter-ajax-fetch';
import { DataServiceWebApiAdapter } from 'breeze-client/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from 'breeze-client/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from 'breeze-client/adapter-model-library-backing-store';

configureBreeze({
  ajax: AjaxFetchAdapter,
  dataService: DataServiceWebApiAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  modelLibrary: ModelLibraryBackingStoreAdapter,
  namingConvention: NamingConvention.camelCase,
});
```

Those four choices mean, respectively: use `fetch` for HTTP, talk to a Breeze .NET
server, encode queries as Breeze JSON, and track changes with plain properties.

`namingConvention: NamingConvention.camelCase` translates `CompanyName` on the server to
`companyName` on the client. Use it with a .NET server; omit it if your server already
sends camelCase.

::: tip Importing does not register
In Breeze 3, importing an adapter module does **not** register it — that was a
side effect in 2.x. Passing it to `configureBreeze` is what registers it. See
[Configuration](/guide/configuration).
:::

## Create an EntityManager

An `EntityManager` is a cache plus a connection to one service. Most applications have
one.

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/NorthwindIBModel');
```

The string is the service root. Breeze fetches metadata from `/breeze/NorthwindIBModel/Metadata`
the first time you query, and uses it to build entity types, keys and relationships.

## Query

```ts
import { EntityQuery } from 'breeze-client';

const query = EntityQuery
  .from('Customers')
  .where('companyName', 'startsWith', 'B')
  .orderBy('companyName')
  .take(10);

const { results } = await em.executeQuery(query);

results.forEach(c => console.log(c.getProperty('companyName')));
```

Results are **entities**, not plain objects: they are in the cache, they track their own
changes, and their navigation properties are wired to other cached entities.

See [Querying](/query/) for the full query surface.

## Change and save

```ts
const customer = results[0];
customer.setProperty('companyName', 'Bravo Foods');

console.log(customer.entityAspect.entityState.name);  // "Modified"

const saveResult = await em.saveChanges();
console.log(`${saveResult.entities.length} entities saved`);
```

`saveChanges()` sends every pending change in one request, and the server applies them in
one transaction. You can also save a subset — see [Saving changes](/guide/saving-changes).

## Create a new entity

```ts
const order = em.createEntity('Order', {
  customerID: customer.getProperty('customerID'),
  orderDate: new Date(),
});

await em.saveChanges();
```

`createEntity` gives the new entity a temporary key, adds it to the cache, and marks it
`Added`. On save, the server assigns the real key and Breeze fixes up every reference to
it.

## Where next

- [Configuration](/guide/configuration) — what `configureBreeze` does, and supplying your
  own HTTP transport
- [Querying](/query/) — predicates, projections, `expand`, querying the cache
- [Inside the entity](/guide/inside-the-entity) — `entityAspect`, entity state, original values
- [Migrating from 2.x](/guide/migrating-from-2x) — if you have an existing application
