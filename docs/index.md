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

::: warning Not yet released
Breeze 3 is in development. The API is stable in shape but not yet published to npm.
:::
