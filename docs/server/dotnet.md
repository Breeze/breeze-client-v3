# Using a Breeze .NET server

Breeze talks to any server that speaks HTTP and JSON, and the rest of this section is about
making it fit one. This page is about the case where you control the server too, and it is
.NET: then there is a matching server library, and most of the configuration on this page
disappears.

The server packages live in
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3), and have their own
documentation — see [Reading the server docs](#reading-the-server-docs).

## What you get for free

Against a Breeze .NET server the client needs **no configuration at all**:

```ts
import { EntityManager } from 'breeze-client';

const em = new EntityManager('/breeze/Northwind');
```

Every default already matches what the server does.

| Piece | Default | Why it fits |
|---|---|---|
| data service adapter | `'webApi'` | the request and response shapes the server produces |
| URI builder | `'json'` | the server reads Breeze JSON queries out of the URL |
| `JsonResultsAdapter` | supplied by the adapter | matches the `$type`/`$ref` JSON the server sends |
| `NamingConvention` | `camelCase` | the server sends .NET `PascalCase` names |
| metadata | fetched from the service | the server generates it from your EF or NHibernate mapping |

So the pages on [transport](/server/transport), [DataServiceAdapter](/server/dataserviceadapter),
[JSON results](/server/jsonresultsadapter) and [naming conventions](/server/namingconvention) are
about *other* servers. You need them here only to add something of your own — auth headers, say,
which is [Supplying your own transport](/server/transport).

## What the server must expose

Three things, at one service root:

| | |
|---|---|
| `GET {root}/Metadata` | the metadata document |
| `GET {root}/{ResourceName}` | one queryable endpoint per entity set |
| `POST {root}/SaveChanges` | every pending change, in one request |

`new EntityManager('/breeze/Northwind')` sets the root; `EntityQuery.from('Customers')` picks the
resource. On the server those are an action named `Customers` on a controller routed at
`breeze/Northwind` — which is what the server's default routing produces.

## Things that line up across the two sides

A few decisions have to match, and they are the usual source of confusion:

- **Naming.** The server sends `CompanyName`; the client's `camelCase` convention makes it
  `companyName`. If the server *also* camel-cases its JSON, the names get translated twice and
  stop matching the metadata. The server's JSON serializer setup takes a `camelCasing` flag that
  defaults to `false` — leave it there. See [Naming conventions](/server/namingconvention).
- **Enums.** The server can send enum values as strings or as integers. The client reads what the
  metadata says the property is, so the two have to agree; strings are the default on both sides.
- **Save errors.** The server returns an RFC 9457 problem details document carrying per-entity
  errors, and the client turns those into `ValidationError`s on the entities that failed. See
  [Error handling](/guide/error-handling).
- **Temporary keys.** The client invents a key for a new entity; the server sends back a mapping
  from that to the real one, and the client swaps it everywhere — including in the foreign keys of
  entities saved in the same batch. Nothing to configure, but it explains why a save response
  changes ids.

## Reading the server docs

The server documentation is its own site, at
**[breeze.github.io/breeze-server-v3](https://breeze.github.io/breeze-server-v3/)** — hand-written
guides plus the [.NET API reference](https://breeze.github.io/breeze-server-v3/api/), generated
from the XML doc comments. What is there:

| Page | About |
|---|---|
| [Getting started](https://breeze.github.io/breeze-server-v3/guide/getting-started.html) | from an empty ASP.NET Core project to a working Breeze endpoint |
| [The PersistenceManager](https://breeze.github.io/breeze-server-v3/guide/persistence-manager.html) | the server-side counterpart of `EntityManager` |
| [Querying](https://breeze.github.io/breeze-server-v3/guide/querying.html) | how a client's query becomes SQL, and how to bound what clients may ask for |
| [Saving](https://breeze.github.io/breeze-server-v3/guide/saving.html) | save interceptors, transactions and key mappings |
| [Metadata](https://breeze.github.io/breeze-server-v3/guide/metadata.html) | what the client is told about the model, and how to change it |
| [Error handling](https://breeze.github.io/breeze-server-v3/guide/error-handling.html) | returning validation and concurrency errors this client understands |
| [API reference](https://breeze.github.io/breeze-server-v3/api/) | every public type in the five server packages |

To build it yourself — to preview a change, or to read it offline — clone
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3) and follow its
[DOCS.md](https://github.com/Breeze/breeze-server-v3/blob/master/DOCS.md).

## See also

- [Overview](/server/) — the pieces the client uses to talk to any server
- [Getting started](/guide/getting-started) — the client side
- [Saving changes](/guide/saving-changes)
