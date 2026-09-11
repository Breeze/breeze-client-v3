<p align="center"><a href="http://breeze.github.io/" target="_blank"><img src="http://breeze.github.io/images/logos/BreezeJsB.png" alt="Breeze" width="100"/></a></p>

# Breeze Data Management for JavaScript Clients

**Breeze** is a library from [IdeaBlade](https://www.ideablade.com/) that helps you manage
data in rich client applications. If you store data in a database, query and save it as
complex object graphs, and share those graphs across screens, Breeze is for you.

Client-side querying, caching, dynamic object graphs, change tracking and notification,
model validation, batch save, offline — all part of rich data management with Breeze.
Breeze clients talk to any remote service that speaks HTTP and JSON.

> **This is breeze-client v3, in development.** It is not released.
> For the current shipping version see
> [breeze-client](https://github.com/Breeze/breeze-client).

## What v3 is

Same public API, rewritten for modern TypeScript, with a build you can read in one sitting.

- **ESM only**, one package, one npm tag. No CommonJS, no UMD, no `mjs`/`cjs` dist-tags.
- **One `tsc` invocation.** No ng-packagr, no second `node_modules`, no `downlevel-dts`.
- **No runtime dependencies.**
- **Knockout, jQuery, AngularJS and OData removed**, including CSDL/EDMX metadata parsing.
- Angular support moves to its own package so Angular and RxJS stay out of the core build.

Source is 42 files / 15,630 lines, down from 51 / 19,708.

## Documentation

| | |
|---|---|
| [UPGRADE.md](./UPGRADE.md) | **Converting an app from 2.x** — every consumer-facing change |
| [TESTING.md](./TESTING.md) | **Running the tests** — creating the database, starting the server |
| [CHANGES-DEV.md](./CHANGES-DEV.md) | Structural changes, for people working on Breeze itself |
| [STATUS.md](./STATUS.md) | What is done, what is in flight, what is next |

General Breeze documentation is at [breeze.github.io](http://breeze.github.io/doc-js/).

## Install

Not yet published. When it is:

```bash
npm install breeze-client
```

```ts
import { configureBreeze, EntityManager, EntityQuery, NamingConvention } from 'breeze-client';

configureBreeze({ namingConvention: NamingConvention.camelCase });   // for a Breeze .NET server

const em = new EntityManager('/breeze/Northwind');
const { results } = await em.executeQuery(EntityQuery.from('Customers').take(10));
```

There are no adapters to import or register: Breeze uses its standard ones unless you
configure others.

## Building

```bash
npm install
npm run typecheck     # tsc --noEmit
npm run build         # -> dist/
```

## Server

The .NET server lives in
[breeze-server-v3](https://github.com/Breeze/breeze-server-v3). The integration tests in
this repo run against it.

---

If you have discovered a bug or missing feature, please create an issue.

If you have questions about using Breeze, please ask on
[Stack Overflow](https://stackoverflow.com/questions/tagged/breeze).

If you need help developing your application, please contact us at
[IdeaBlade](mailto:info@ideablade.com).
