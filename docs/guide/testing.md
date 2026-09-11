# Testing

This page is about testing an **application that uses Breeze**. For running Breeze's own
test suite, see [the end of this page](#breeze-s-own-tests).

Most of what your code asks of Breeze needs no server. Once metadata is loaded, the
following all run entirely on the client:

- creating entities
- navigation fix-up
- change tracking
- validation
- querying the cache
- export and import

For the parts that do talk to a server, you can hand Breeze a stub `fetch` function.

The examples use [Vitest](https://vitest.dev) and the Northwind model.

## Configure Breeze once

With a .NET server, Breeze needs no configuration: the default adapters and the default
`camelCase` naming convention are what it needs, in tests as in the application. If your
application does configure Breeze — a custom adapter, say, or `NamingConvention.none` for
a server that already sends client property names — do the same in a Vitest setup file.
Breeze configuration is global state, so the tests then use what the application uses:

```ts
// test/breeze-setup.ts
import { configureBreeze, NamingConvention } from 'breeze-client';

// the same configuration as your application's startup, for example:
configureBreeze({ namingConvention: NamingConvention.none });
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/breeze-setup.ts'],
  },
});
```

Breeze runs in Node 20+, so the default `node` environment is fine. You don't need a DOM.

## Load metadata from a fixture

Save your model's metadata as a JSON file and check it in. Either:

- request `<serviceName>/Metadata` from your running server once and save the response, or
- call `em.metadataStore.exportMetadata()` in a session that has loaded metadata. It
  returns a JSON string.

It must be Breeze JSON metadata, the kind with `structuralTypes`. Breeze 3 does not parse
CSDL/EDMX.

Build one `MetadataStore` from the file and give each test its own empty manager that
shares it:

```ts
// test/breeze-helpers.ts
import { DataService, EntityManager, MetadataStore } from 'breeze-client';
import metadata from './fixtures/metadata.json';

const serviceName = '/breeze/NorthwindIBModel';

export const metadataStore = new MetadataStore();
metadataStore.importMetadata(metadata);
metadataStore.addDataService(new DataService({ serviceName }));

export function newEntityManager() {
  return new EntityManager({ serviceName, metadataStore });
}
```

- The metadata is parsed once for the whole file.
- Each test gets a fresh cache, so no test sees another's entities.
- `addDataService` tells the store it already has metadata for `serviceName`, and a
  manager created with that `serviceName` uses this `DataService`. Without it, Breeze
  would try `GET <serviceName>/Metadata` before the first remote query, because a file
  saved from `/Metadata` names no service. A file from `exportMetadata()` carries the
  exporting store's data services, so importing it is enough.

If your application registers entity classes with `registerEntityTypeCtor`, register them
on this shared store, once. A class can only be registered with one `MetadataStore`. See
[Extending entities](/guide/extending-entities).

## Test entity logic

With metadata loaded, entity behavior is synchronous and needs no network:

```ts
import { describe, expect, test } from 'vitest';
import { EntityQuery, EntityState } from 'breeze-client';
import { newEntityManager } from './breeze-helpers';

describe('customers and orders', () => {
  test('a new order is linked to its customer', () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', {
      customerID: crypto.randomUUID(),
      companyName: 'Acme',
    });
    const order = em.createEntity('Order', { customerID: cust.getProperty('customerID') });

    expect(cust.getProperty('orders')).toContain(order);
    expect(order.entityAspect.entityState).toBe(EntityState.Added);
    expect(em.getChanges()).toHaveLength(2);
  });

  test('editing an unchanged customer marks it Modified', () => {
    const em = newEntityManager();
    const cust = em.createEntity(
      'Customer',
      { customerID: crypto.randomUUID(), companyName: 'Acme' },
      EntityState.Unchanged,
    );

    cust.setProperty('companyName', 'Bravo');

    expect(cust.entityAspect.entityState).toBe(EntityState.Modified);
    expect(cust.entityAspect.originalValues).toEqual({ companyName: 'Acme' });
  });

  test('a customer needs a company name', () => {
    const em = newEntityManager();
    const cust = em.createEntity('Customer', { customerID: crypto.randomUUID() });

    expect(cust.entityAspect.validateEntity()).toBe(false);
    expect(cust.entityAspect.getValidationErrors()[0].errorMessage)
      .toBe("'companyName' is required");
  });

  test('the cache can be queried', () => {
    const em = newEntityManager();
    em.createEntity('Customer', { customerID: crypto.randomUUID(), companyName: 'Acme' });

    const found = em.executeQueryLocally(
      EntityQuery.from('Customers').where('companyName', 'startsWith', 'Ac'),
    );

    expect(found).toHaveLength(1);
  });
});
```

Passing `EntityState.Unchanged` to `createEntity` attaches the entity as if it had come
from the server. That is useful for building "existing" data. See
[Querying the cache](/query/locally), [Change tracking](/guide/change-tracking) and
[Validation](/guide/validation).

## Seed test data with export and import

To start several tests from the same set of entities, build them once, export them, and
import the bundle into each test's manager:

```ts
import { beforeAll, test } from 'vitest';
import { EntityState } from 'breeze-client';
import { newEntityManager } from './breeze-helpers';

let seed: string;

beforeAll(() => {
  const em = newEntityManager();
  const alfreds = em.createEntity('Customer', {
    customerID: crypto.randomUUID(), companyName: 'Alfreds Futterkiste',
  }, EntityState.Unchanged);
  em.createEntity('Order', {
    orderID: 10643, customerID: alfreds.getProperty('customerID'),
  }, EntityState.Unchanged);

  seed = em.exportEntities(undefined, { includeMetadata: false }) as string;
});

test('...', () => {
  const em = newEntityManager();
  em.importEntities(seed);
  // em now holds the customer and order, both Unchanged
});
```

Imported entities keep their entity state, so pending changes can be seeded too.

A bundle can also be a fixture file. Write it out once with
`exportEntities(entities, { asString: false })`. If you leave `includeMetadata` at its
default of `true`, the static `EntityManager.importEntities(bundle)` returns a new manager
with the metadata and entities already loaded. See [Export and import](/guide/export-import).

## Stub HTTP with a fetch function

`configureBreeze` takes a `fetch` function, and Breeze uses it for every request. A test
double is an ordinary function that returns a `Response`. The basic pattern is on
[Supplying your own transport](/server/transport#stubbing-in-tests). A few details matter
when the stub has to return entities:

- **Use server property names.** Response data is what the server would send. With
  the default `NamingConvention.camelCase` that means `CompanyName`, not `companyName`. Camel-case
  names in the payload are not mapped and come through as `null`.
- **Include `$type`**, as the Breeze .NET server does, so Breeze knows which entity type
  each object is. The type name is `Namespace.TypeName, Assembly`.
- **Return an array** of entities, or `{ results, inlineCount }` for queries that use
  `inlineCount()`.
- The query is **URL-encoded JSON** after the `?` in the resource URL, in server property
  names. Decode it to assert on what was sent.

```ts
import { beforeAll, expect, test } from 'vitest';
import { configureBreeze, BreezeFetch, EntityQuery } from 'breeze-client';
import { newEntityManager } from './breeze-helpers';

const requests: string[] = [];

const fakeFetch: BreezeFetch = async (input) => {
  const url = String(input);
  requests.push(url);
  const body = url.includes('/Customers?')
    ? [{
        $type: 'Northwind.Models.Customer, Northwind',
        CustomerID: 'b5e0a4a0-0000-0000-0000-000000000001',
        CompanyName: 'Alfreds Futterkiste',
      }]
    : [];
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

beforeAll(() => {
  configureBreeze({ fetch: fakeFetch });
});

test('customer search', async () => {
  const em = newEntityManager();
  const { results } = await em.executeQuery(
    EntityQuery.from('Customers').where('companyName', 'startsWith', 'A'),
  );

  expect(results[0].getProperty('companyName')).toBe('Alfreds Futterkiste');

  const sent = JSON.parse(decodeURIComponent(requests[0].split('?')[1]));
  expect(sent).toEqual({ where: { CompanyName: { startswith: 'A' } } });
});
```

To test error handling, return a non-2xx `Response`, for example
`new Response('boom', { status: 500 })`. `executeQuery` then rejects, and you can assert
with `await expect(em.executeQuery(q)).rejects.toThrow()`.

`saveChanges` sends a `POST` to `<serviceName>/SaveChanges` with a JSON body whose
`entities` array holds each changed entity. Asserting on that body is simple. Returning a
realistic save *result* means reproducing your server's response JSON, so capture a real
one from your browser's network tab and use it as a fixture.

::: tip Changed in 3.0
Breeze 3 needs no ajax adapter at all, so there is no fake one to register. A `fetch`
function passed to `configureBreeze` stands in for the server.
:::

## Breeze's own tests

To run the Breeze client test suite itself (unit tests with no server, plus integration
tests against the .NET test server), see
[TESTING.md](https://github.com/Breeze/breeze-client-v3/blob/master/TESTING.md) in the
repository.
