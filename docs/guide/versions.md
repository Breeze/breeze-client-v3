# Versions

Breeze has two current packages: the JavaScript client on npm and the .NET server on NuGet. They
were released together, but their version numbers are not the same.

| | Current | Previous |
|---|---|---|
| **JavaScript client** — npm [`breeze-client`](https://www.npmjs.com/package/breeze-client) | **3.x** (3.0.0) | 2.x (2.2.2) |
| **.NET server** — NuGet [`Breeze.*`](https://www.nuget.org/packages/Breeze.AspNetCore.NetCore/), five packages | **8.x** (8.0.0) | 7.x (7.5.2) |
| **.NET versions** the server targets | .NET 8, 9 and 10 | .NET 5 to 10 |
| **Source** | [breeze-client-v3](https://github.com/Breeze/breeze-client-v3), [breeze-server-v3](https://github.com/Breeze/breeze-server-v3) | [breeze-client](https://github.com/Breeze/breeze-client), [breeze.server.net](https://github.com/Breeze/breeze.server.net) |
| **Documentation** | [Client](/) (this site), [server](https://breeze.github.io/breeze-server-v3/) | [Client 2.x](https://breeze.github.io/doc-js/?v2), [server 7.x](https://breeze.github.io/doc-net/?v2) |

::: tip The "v3" in the repository names is not a package version
`breeze-client-v3` publishes `breeze-client` 3.x, but `breeze-server-v3` publishes the .NET
packages at **8.x**. The server packages kept their own numbering, which was already at 7.
:::

## Which versions work together

| | Server 7.x | Server 8.x |
|---|---|---|
| **Client 2.x** | Yes | Yes |
| **Client 3.x** | Expected to work, not tested | **Yes** — tested together |

- **Server 8.x works with either client.** Its metadata and JSON formats are unchanged from 7.x.
  Its error responses are now RFC 9457 problem details, but they still carry the members a 2.x
  client reads, so a 2.x client sees no difference. You can upgrade the server first.
- **Client 3.x is tested against server 8.x only.** It uses the same formats as 7.x, so it is
  expected to work with a 7.x server, but that pairing is not part of the test suite.

## Installing a specific version

```bash
npm install breeze-client@3      # current
npm install breeze-client@2      # previous
```

```bash
dotnet add package Breeze.AspNetCore.NetCore --version 8.0.0
dotnet add package Breeze.Persistence.EFCore --version 8.0.0
```

For .NET 5, 6 or 7, which are out of support, stay on 7.5.2.

## Upgrading

- **Client, 2.x to 3.x:** [Migrating from 2.x](./migrating-from-2x.md). Most applications need
  only a handful of changes.
- **Server, 7.x to 8.x:** [UPGRADE.md](https://github.com/Breeze/breeze-server-v3/blob/master/UPGRADE.md)
  in breeze-server-v3.
