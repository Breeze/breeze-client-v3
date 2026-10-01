---
layout: home

hero:
  name: Breeze
  text: Data management for JavaScript clients
  tagline: Query, cache, track changes and save entity graphs — against any service that speaks HTTP and JSON.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Migrating from 2.x
      link: /guide/migrating-from-2x
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Rich queries, client-side
    details: Compose queries with a fluent API and real predicates, run them against the server or against the cache with the same syntax.
    link: /query/
  - title: Change tracking that knows your model
    details: Entities track their own state and original values. Save a whole graph in one transaction, and validate before you send it.
    link: /guide/change-tracking
  - title: Metadata-driven
    details: Breeze learns your model from server metadata — types, keys, relationships — so navigation properties and fixups just work.
    link: /metadata/
---

<script setup>
import ClientServerDiagram from './components/ClientServerDiagram.vue';
</script>

## How the client and server talk

<ClientServerDiagram />

1. **Metadata.** The client asks once for the model: entity types, keys, relationships and
   validation. A Breeze .NET server reads it from your Entity Framework Core or NHibernate
   mapping, so you never describe the model twice. See [Metadata](/metadata/). The same metadata
   is what `breeze-gen-entities` turns into a TypeScript class per entity type, which is what
   gives you [typed entities](/guide/typed-entities) and [typed queries](/guide/typed-queries)
   — see [Generating entity classes](/guide/generating-entities).
2. **Query.** The client composes a query — filter, sort, page, expand — and sends it in the URL.
   The server applies it to the `IQueryable` your action returns, so it runs in the database as
   SQL. The entities that come back are merged into the cache. See [Querying](/guide/querying).
3. **Save.** The client sends every pending change in one request. The server saves them in one
   transaction, and sends back the saved entities with the real keys in place of the temporary
   ones. See [Saving changes](/guide/saving-changes).

The server side is covered in [Using a Breeze .NET server](/server/dotnet). Breeze can also talk
to other back ends — see [Talking to the server](/server/).

::: info Not using .NET?
Nothing in these three exchanges is specific to .NET: they are plain HTTP and JSON, so a server
written for any platform can answer them. Today the .NET server is the only one in production.
If you need a Breeze server for another platform — Node, Java, Python or anything else —
[contact IdeaBlade](mailto:info@ideablade.com) about having one written.
:::

## Breeze 3

Version 3 is a rewrite of the 2.x codebase with the same public API. What changed:

- **ESM only**, one package, one npm tag. No CommonJS build, no UMD bundle, no
  `mjs`/`cjs` dist-tags to choose between.
- **No runtime dependencies.**
- **No adapter setup** — Breeze uses its standard adapters unless you register others.
  When you do, [`configureBreeze`](/guide/configuration) replaces the stringly-typed
  adapter registration.
- **Knockout, jQuery, AngularJS and OData support removed.** See
  [Migrating from 2.x](/guide/migrating-from-2x) for what to do if you use them.
- Built under `strictNullChecks` and `noImplicitAny`.

If you are coming from 2.x, start with [Migrating from 2.x](/guide/migrating-from-2x) —
most applications need only a handful of changes, and they are listed there.

::: tip Looking for 2.x?
The breeze-client 2.x documentation is still at
[breeze.github.io/doc-js](https://breeze.github.io/doc-js/?v2).
:::
