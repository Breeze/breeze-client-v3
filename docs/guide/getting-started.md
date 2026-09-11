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

With a Breeze .NET server there is nothing to configure. Go straight to
[creating an EntityManager](#create-an-entitymanager).

There are no adapters to import or register. Unless you say otherwise, Breeze talks to a
Breeze .NET server, encodes queries as Breeze JSON, tracks changes with plain properties,
makes its HTTP requests with the platform's `fetch`, and camel-cases property names:
`CompanyName` on the server is `companyName` on the client. To replace any of those, see
[Configuration](/guide/configuration); to add auth headers or logging, see
[Supplying your own transport](/server/transport).

If your server already sends the property names the client should use — a Node server,
say, or one whose names are already camelCase — turn the translation off. Do it once, at
startup, before you create any `EntityManager`:

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';

configureBreeze({ namingConvention: NamingConvention.none });
```

`NamingConvention.none.setAsDefault()` does the same thing. See
[Naming conventions](/server/namingconvention).

::: tip Changed in 3.0
In 2.x, importing an adapter module registered it. Breeze 3 registers nothing on import,
and you don't need it to: when nothing is registered, Breeze uses its standard adapters.
See [Default adapters](/guide/configuration#default-adapters).

The default naming convention was `none` in 2.x, so a .NET application had to set
`camelCase`. Breeze 3 defaults to `camelCase`. See [Migrating from 2.x](/guide/migrating-from-2x).
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

- [Configuration](/guide/configuration) — the default adapters, replacing them, and
  supplying your own HTTP transport
- [Querying](/query/) — predicates, projections, `expand`, querying the cache
- [Inside the entity](/guide/inside-the-entity) — `entityAspect`, entity state, original values
- [Migrating from 2.x](/guide/migrating-from-2x) — if you have an existing application
