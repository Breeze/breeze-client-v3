# Naming conventions

Breeze moves entity data between client and server as property values, so property names
matter. A .NET server spells a property `FirstName`; most JavaScript code prefers
`firstName`. A `NamingConvention` translates between the two spellings, so the server can
keep its names and the client can use its own.

By default Breeze uses `NamingConvention.camelCase`, which is what a Breeze .NET server
needs: `FirstName` on the server is `firstName` on the client. Set a convention only if
your server is different.

## Choosing a convention

Breeze ships two conventions:

| Convention | `name` | Server → client |
|---|---|---|
| `NamingConvention.camelCase` | `'camelCase'` | first letter lower-cased: `CompanyName` → `companyName`. This is the default. |
| `NamingConvention.none` | `'noChange'` | unchanged |

`camelCase` changes only the first character, so `CustomerID` becomes `customerID`, not
`customerId`. Use it with a Breeze .NET server.

Use `none` when the server already sends the property names the client should use — a
Node/Sequelize-style server, say, or one whose metadata names are already camelCase.
(`camelCase` would turn `companyName` back into `CompanyName`, which does not
[round-trip](#round-tripping-is-required).) Set it once, at startup:

```ts
import { configureBreeze, NamingConvention } from 'breeze-client';

configureBreeze({ namingConvention: NamingConvention.none });
```

That is the same as calling `NamingConvention.none.setAsDefault()`.

::: tip Changed in 3.0
The default is `camelCase`. In 2.x it was `none`, so a .NET application had to set
`camelCase` itself; that call is now redundant but harmless. An application that relied on
`none` must now set it. See [Migrating from 2.x](/guide/migrating-from-2x).

`configureBreeze` takes `namingConvention` directly. There is no `breeze.` global, and no
`NamingConvention.instance` — the current default is `NamingConvention.defaultInstance`.
:::

### Set it before creating stores

Each `MetadataStore` takes the default convention when it is created and keeps it. An
`EntityManager` created without a `metadataStore` gets a new store, so it takes the
default too:

```ts
new EntityManager('/breeze/NorthwindIBModel').metadataStore.namingConvention.name;   // 'camelCase'

configureBreeze({ namingConvention: NamingConvention.none });

const em = new EntityManager('/api/products');
em.metadataStore.namingConvention.name;   // 'noChange'
```

Changing the default afterwards does not affect stores that already exist.

The default is always a copy — `setAsDefault()` stores one, and the built-in default is
one too — so compare conventions by `name`, not by identity:

```ts
NamingConvention.defaultInstance === NamingConvention.camelCase;   // false
NamingConvention.defaultInstance.name === 'camelCase';             // true
```

### A convention for one store

To use a different convention for one store — `none` for one service that already sends
client names, say — pass it to the `MetadataStore` and give that store to the
`EntityManager`:

```ts
const store = new MetadataStore({ namingConvention: NamingConvention.none });
const em = new EntityManager({ serviceName: '/api/legacy', metadataStore: store });
```

The default is unchanged.

## Don't fix it on the server

You can configure a server's JSON serializer to camel-case property names on the way out.
**Don't.** Breeze needs the real server names as well as the client names: it uses the
server names to build query URLs and save requests. When you query for customers whose
`companyName` starts with "B", Breeze has to send `CompanyName` in the URL. A serializer
that renames properties hides the server names from Breeze, and queries and saves then
fail.

Leave the server's names alone and let the `NamingConvention` translate on the client.
ASP.NET Core camel-cases JSON by default. On the Breeze .NET server,
`JsonSerializationFns.UpdateWithDefaults` turns that off unless you pass
`camelCasing: true` — leave it off. See [The Breeze .NET server](/server/#the-breeze-net-server).

## What the convention translates

When Breeze processes metadata, it runs the convention on every data property,
navigation property and foreign key name. Each property ends up with both spellings:

```ts
const prop = em.metadataStore.getAsEntityType('Customer').getProperty('companyName');
prop.name;           // 'companyName'
prop.nameOnServer;   // 'CompanyName'
```

After that Breeze uses `nameOnServer` when it builds query URLs, save bundles and query
results. The convention functions are also called directly in three places:
- property names in the results of projection queries (anonymous objects)
- property names in validation errors returned by a failed save
- property paths in queries against anonymous types

## Round-tripping is required

A convention has to translate reliably in both directions:

```ts
const clientName = convention.serverPropertyNameToClient(serverName);
convention.clientPropertyNameToServer(clientName) === serverName;   // must be true
```

Breeze enforces this. If a name does not survive the round trip, metadata processing
throws:

```
NamingConvention for this server property name does not roundtrip properly:ModelName-->Modelname
```

## Writing your own

```ts
new NamingConvention({
  name: 'myConvention',
  serverPropertyNameToClient: (name, prop) => /* client name */,
  clientPropertyNameToServer: (name, prop) => /* server name */,
});
```

| Option | Notes |
|---|---|
| `name` | Optional, but give one. If you omit it, Breeze generates a random id. Exported metadata records the convention by name, so a convention with a generated name cannot be found again in a later session. |
| `serverPropertyNameToClient(name, prop?)` | server name → client name |
| `clientPropertyNameToServer(name, prop?)` | client name → server name |

Creating a convention registers it by name. It does not make it the default: pass it to
`configureBreeze`, call `setAsDefault()`, or give it to a `MetadataStore`.

### Underscores to camelCase

This convention translates server names such as `first_name` to `firstName` on the
client:

```ts
const underscoreCamelCase = new NamingConvention({
  name: 'underscoreCamelCase',
  serverPropertyNameToClient: (name) =>
    name.replace(/_([a-z])/g, (_match, c: string) => c.toUpperCase()),
  clientPropertyNameToServer: (name) =>
    name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
});

configureBreeze({ namingConvention: underscoreCamelCase });
```

It assumes every server name is lower case with `_` separators. A server name such as
`Can_of_Worms` does not round-trip, and metadata processing throws.

### Using the property

The second argument to both functions is the `DataProperty` or `NavigationProperty` being
named, when Breeze has one. Use it when the translation depends on more than the name —
the property's type, say, or the entity type that owns it (`prop.parentType`).

::: warning The second argument is not always a property
It is `undefined` for anonymous (projection) results. For some names it is an empty
object. For foreign key names it is the `NavigationProperty`. Always check it before
you use it, as `instanceof DataProperty` does below.
:::

This convention camel-cases names, and also prefixes `Boolean` properties with `is`. A
server property `Enabled` becomes `isEnabled` on the client:

```ts
import { DataProperty, DataType, NamingConvention } from 'breeze-client';

const camelCase = NamingConvention.camelCase;
const isBoolean = (prop: unknown) =>
  prop instanceof DataProperty && prop.dataType === DataType.Boolean;

const booleanPrefix = new NamingConvention({
  name: 'booleanPrefix',
  serverPropertyNameToClient: (name, prop) =>
    isBoolean(prop) ? 'is' + name : camelCase.serverPropertyNameToClient(name),
  clientPropertyNameToServer: (name, prop) =>
    isBoolean(prop) ? name.substring(2) : camelCase.clientPropertyNameToServer(name),
});
```

With it, `EntityQuery.from('VendingMachines').where('isEnabled', '==', true)` sends
`Enabled` to the server.

### Stateful conventions

Sometimes a name cannot be computed in both directions. Perhaps the conversion loses
information, or a few properties just need names of their own. There are two ways to
handle this:
- **Dictionary.** Keep a map of special cases (for example, `customerName` → `CompanyName`
  for `Customer`). Try the map first, and fall back to `camelCase` for everything else.
- **Remember as you go.** Metadata is translated server → client first, so the convention
  can record each server name it translates. It then looks that name up when translating
  back.

This convention does the second. It strips underscores and remembers what it stripped:

```ts
const serverNames = new Map<string, string>();

const noUnderscore = new NamingConvention({
  name: 'noUnderscore',
  serverPropertyNameToClient: (serverName) => {
    if (!serverName.includes('_')) return serverName;
    const clientName = serverName.replace(/_/g, '');
    serverNames.set(clientName, serverName);
    return clientName;
  },
  clientPropertyNameToServer: (clientName) => serverNames.get(clientName) ?? clientName,
});
```

`Can_of_Worms` becomes `CanofWorms` and translates back correctly. This works only when
the convention has seen the server name — use it with metadata from the server, not with
metadata written by hand using client names.

## Entity type names are not translated

A `NamingConvention` translates property names only. Entity type names such as
`Customer` or `Order` are the same on both sides.

## The convention is part of exported metadata

`exportMetadata()` records the store's convention by name. Importing that metadata
follows these rules:
- **Empty store.** It adopts the imported convention, whatever it was created with. A
  convention with that name must already exist in this session, or the import throws
  `Unable to locate a registered object by the name: NamingConvention.<name>`.
- **Store that already has metadata.** If the imported convention differs from the
  store's, the import throws `Cannot import metadata with a different 'namingConvention'
  from the current MetadataStore`.

```ts
const store = new MetadataStore({ namingConvention: NamingConvention.none });
store.importMetadata(exportedWithCamelCase);
store.namingConvention.name;   // 'camelCase' — the import won
```

To import metadata under a different convention, remove the recorded name first:

```ts
const json = JSON.parse(exportedMetadata);
delete json.namingConvention;

const store = new MetadataStore({ namingConvention: NamingConvention.none });
store.importMetadata(json);
store.namingConvention.name;   // 'noChange'
```

Metadata fetched from a Breeze .NET server does not carry a convention name. The store
keeps its own convention and uses it to translate the server's names.

## Beyond property names

A `NamingConvention` handles property names only. For anything more — reshaping the
payload, working out entity types, ignoring parts of the response — use a
[JsonResultsAdapter](/server/jsonresultsadapter).

See also the API reference for [NamingConvention](/api/classes/NamingConvention).
