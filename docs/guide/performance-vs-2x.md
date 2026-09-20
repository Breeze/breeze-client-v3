# Performance vs 2.x

3.0 is a rewrite of the same design, not a new one: the same cache, the same change tracking, the
same materialization path. So the interesting question about the rewrite is whether it costs less
to run, and the answer is mostly yes — a cached entity takes **half the memory** it did, and the
paths an application spends its time in are 1.2× to 1.6× quicker.

This page compares 3.0.0 against 2.2.2. For what an individual operation costs in absolute terms,
and which options to reach for when a screen is slow, see [Performance](/guide/performance).

## What got faster

Each measurement runs the same payload against both versions and ends with the same cache.

| measurement | 2.2.2 | 3.0.0 | |
|---|---:|---:|---|
| `importMetadata`, 21 types | 4.1 ms | 3.6 ms | 1.15× |
| query: materialize 5,000 entities | 111 ms | 77 ms | **1.4×** |
| query: merge 5,000 already-cached entities | 32 ms | 25 ms | 1.3× |
| query with expand: 1,000 parents + 5,000 children | 171 ms | 112 ms | **1.5×** |
| `createEntity` × 5,000 | 124 ms | 78 ms | **1.6×** |
| set a tracked property × 5,000 | 7.2 ms | 3.2 ms | 2.2× |
| `executeQueryLocally` over 5,000 entities | 2.6 ms | 1.6 ms | 1.7× |
| `getEntityByKey` × 5,000 | 1.6 ms | 0.9 ms | 1.7× |
| `validateEntity` × 5,000 | 54 ms | 47 ms | 1.2× |
| `exportEntities`, 5,000 entities | 33 ms | 32 ms | — |
| `importEntities`, 5,000 entities | 114 ms | 77 ms | **1.5×** |
| `em.clear()`, 5,000 entities | 2.5 ms | 0.6 ms | 4.4× |

Nothing here needed a change in your code. The gains come from the rewrite itself — native classes
and prototype accessors in place of per-instance closures, `Map` and `Set` in place of object
literals used as dictionaries, and `for` loops on the hot paths.

Queries and `importEntities` are where most applications will notice it, because those are the
operations that run over thousands of rows at once.

## Memory

A cached entity is half the size it was:

| | 2.2.2 | 3.0.0 |
|---|---:|---:|
| per cached `Order` | 4.58 KB | **2.38 KB** |
| a cache of 20,000 | 87.0 MB | **44.9 MB** |

This is the largest single difference between the versions, and it is the one that changes what is
possible rather than merely how fast it is: a 20,000-row cache that used to be uncomfortable on a
modest device now is not. Two things account for most of it — an entity's properties are accessors
on the prototype rather than closures created per instance, and
[collection navigations are created on first read](/guide/performance#collections-are-created-on-first-read)
rather than eagerly for every entity.

## Bundle size

3.0 tree-shakes and 2.2 does not. In 2.2, importing only `MetadataStore`, only `Predicate` or the
whole `EntityManager` produced byte-identical bundles — nothing was ever dropped. In 3.0 the parts
are separable:

| what the application imports | 2.2.2 | 3.0.0 |
|---|---:|---:|
| `MetadataStore` only | 48.5 KB | **37.9 KB** |
| `EntityManager` | 48.5 KB | 53.3 KB |
| a typical app: `EntityManager` + the four standard adapters | 51.2 KB | 53.3 KB |

Minified and gzipped. The catch is in the second row: importing `EntityManager` in 3.0 also brings
in the four default adapters, because it registers them so that a manager works without any
configuration. That is why the last two rows are the same figure, and why a typical application —
which registers those adapters anyway — pays about **4% more** than it did under 2.2. An
application that uses Breeze's metadata without its cache pays a fifth less.

::: warning A 2.x bundling bug that 3.0 fixes
Because 2.x declared itself entirely side-effect free, a production build **silently dropped**
`import 'breeze-client/mixin-get-entity-graph'`, leaving `getEntityGraph` undefined at runtime
while working in development. 3.0 names that file as its one side-effectful module, so it survives
bundling. See [Optional extensions](/guide/extensions#entity-graphs).
:::

## Where 3.0 is slower

**Importing the library unbundled**: 21 ms under 2.2, 54 ms under 3.0. 3.0 ships 48 separate ESM
modules where 2.2 shipped one pre-flattened file, so it pays Node's per-file resolution cost. This
is what makes the tree-shaking above possible, and it disappears once the code is bundled — booting
the bundled library takes the same time in both. It is worth knowing about only for Node and SSR,
or an unbundled dev server; a built browser application never sees it.

## How these were measured

Node 24, 3.0.0 packed from `dist/` and 2.2.2 installed from npm, each in its own process, five
alternating rounds with the best median taken. Both versions are driven through the same benchmark
against the same Northwind metadata, with a fake transport that answers instantly from a fixed
payload, so nothing measured includes network or JSON parsing.

The two runs are checked against each other before they are compared: same number of entities
materialized, same local-query hit count, same number of changes, same exported byte count. A
difference there would mean the versions had not done the same work, and the timings would be
meaningless.

Bundles were built with Vite 8 targeting `es2022`, from each version as an installed package.
Absolute bundle figures move with the bundler and its settings — treat the comparison between the
columns as the durable part, not the numbers themselves. The same caution applies to the timings:
ratios survive a change of machine, milliseconds do not.
