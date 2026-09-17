# Generating entity classes

[Typed entities](./typed-entities.md) and [typed queries](./typed-queries.md) both need one thing
first: a TypeScript class per entity type. Writing those by hand is tedious, and they drift from
the server the moment someone adds a column.

`breeze-client` ships a generator that writes them from your service's metadata. It comes with the
package — there is nothing else to install:

```bash
npm install breeze-client

npx breeze-gen-entities \
  --service http://localhost:34377/breeze/NorthwindIBModel \
  --out src/app/model
```

```
generate-entity-classes v1.0.0
21 types from http://localhost:34377/breeze/NorthwindIBModel -> src/app/model
  new  entity-base.ts
  new  customer.ts
  new  order.ts
  ...
23 file(s) written
```

That is the whole setup. The rest of this page is about living with the output — above all
[regenerating it](#regenerating) without losing the code you added.

## Where the metadata comes from

One of these is required, and there is no default:

```bash
# from a running service - it fetches <url>/Metadata
npx breeze-gen-entities --service http://localhost:34377/breeze/NorthwindIBModel --out src/app/model

# from a file you have checked in
npx breeze-gen-entities --metadata metadata.json --out src/app/model
```

`--out` is required too. Nothing can infer it, and a wrong guess overwrites a directory you did not
name. Both paths are relative to where you run the command.

::: tip Check the metadata in
`--service` needs the server up, which makes the build depend on a running database. Saving the
metadata to a file and passing `--metadata` makes generation reproducible, reviewable in a pull
request, and possible offline. Refresh it when the schema changes.
:::

A convenient shape for `package.json`:

```json
{
  "scripts": {
    "gen:model": "breeze-gen-entities --metadata metadata.json --out src/app/model"
  }
}
```

Inside an npm script the `npx` prefix is unnecessary — `node_modules/.bin` is already on the path.

## What you get

One file per structural type, named in kebab case, plus two the generator owns outright:

| | |
|---|---|
| `customer.ts`, `order.ts`, … | one class per entity or complex type |
| `entity-base.ts` | `EntityBase` and `ComplexObjectBase`: the members Breeze itself supplies |
| `index.ts` | a barrel, a `modelClasses` map, and `registerModelClasses` |

```ts
// src/app/model/customer.ts
// @generated-by generate-entity-classes v1.0.0
// Lines marked `// @generated` are written from server metadata and are rewritten on every
// run. Everything else in this file is yours and is never touched.

import type { RelationArray } from 'breeze-client'; // @generated
import { EntityBase } from './entity-base'; // @generated
import type { Order } from './order'; // @generated

/**
 * Customer:#Foo - the entity type, queried as `Customers`.
 * Key: customerID.
 */
export class Customer extends EntityBase {
  declare customerID: string;  // @generated
  declare companyName: string;  // @generated
  declare city: string;  // @generated
  declare orders: RelationArray<Order>;  // @generated
}
```

The classes import Breeze from `breeze-client`, which is right wherever the package is installed.
`--breeze <spec>` overrides the name, for a fork republished under another one. A relative
specifier is written verbatim into every file, so it has to be correct relative to `--out` rather
than to where you ran the command.

## Using them

Casting is enough for queries — `EntityQuery.from(Customer)` types the result without any
registration:

```ts
import { EntityQuery } from 'breeze-client';
import { Customer } from './model';

const qr = await EntityQuery.from(Customer).where('city', 'eq', 'London').using(em).execute();
qr.results[0].companyName;        // checked
```

Registering the classes additionally makes Breeze *construct* entities from them, which is what
gives you `instanceof` and lets methods and getters you add run on cached entities:

```ts
import { registerModelClasses } from './model';

registerModelClasses(em.metadataStore);
```

::: warning A class binds to one MetadataStore
Breeze binds a constructor to a single store for the life of the process; registering the same
class with a second store throws `Cannot register the same constructor for Customer:#Foo in
different metadata stores`. Call `registerModelClasses` once, on the store your managers share.
:::

## Regenerating

**The unit is the member, not the file, and the metadata decides what belongs to the generator.**
If a property you declared has a name the server metadata knows, it is a mapped property of that
type and the generator keeps it in step. If it does not, it is yours. That is the whole rule.

| | |
|---|---|
| a declared property the metadata **has** | rewritten in place to `declare <name>: <type>;  // @generated` |
| a metadata property the file does not declare | appended |
| a declared property the metadata does **not** have | left alone — it is yours |
| …unless it is marked `// @generated` | removed: the generator wrote it, and the column has left the schema |
| the class declaration | made to extend the generated base, dropping members that base supplies |
| `import ... // @generated` | kept in step; dropped only when nothing in the file still refers to it |
| a hand-written import | never removed |
| methods, getters, constructors, unmapped properties, comments, the class doc comment | never touched |

::: tip The `// @generated` marker is a record, not the rule
It is written so you can see at a glance which lines came from the server, and it drives exactly
one decision: whether a property the metadata has dropped should be deleted or left. Deleting a
marker does **not** make a mapped property yours — the metadata still names it, so the next run
claims it back. Use the [manual markers](#keeping-code-away-from-the-generator) instead.
:::

So all of this survives a regeneration unchanged:

```ts
export class Customer extends EntityBase {
  declare customerID: string;  // @generated
  declare companyName: string;  // @generated

  /** Client-only: an unmapped property, because it has an initializer. */
  isBeingEdited = false;

  get nameLength() {
    return (this.companyName ?? '').length;
  }
}
```

New properties are appended after the last mapped one rather than sorted into metadata order, so a
hand-written member never has generated code inserted into the middle of it.

`entity-base.ts` and `index.ts` are generated whole and say so in their headers. Anything you want
to keep belongs in another module.

`--dry-run` reports what would change and writes nothing:

```bash
npx breeze-gen-entities --metadata metadata.json --out src/app/model --dry-run
```

## Keeping code away from the generator

Three markers, at three scopes. Anything they cover is never rewritten, removed or re-pointed, and
nothing is inserted inside a region.

```ts
declare city: CityName;  // @manual          one declaration is yours

// @manual-start                             everything between the two is yours
declare phone: PhoneNumber;
get dialCode() { return this.phone.slice(0, 3); }
// @manual-end
```

```ts
// @manual-file                              the whole file; it is never even opened
```

`// @manual` goes on the declaration itself. The other two must sit on a line of their own — a
comment that merely *mentions* `// @manual-file` while talking about it, as this page does, does
not opt anything out. An unclosed `// @manual-start` runs to the end of the file, on the principle
that a typo should make the generator do less rather than something unintended.

::: tip This is how you override a mapped property
Since the metadata decides ownership, deleting the `// @generated` marker no longer means "hands
off" — the next run sees the name in the metadata and claims it back. `// @manual` is the way to
say it, and unlike a missing marker it says it out loud.
:::

## Adopting hand-written classes

If you already have entity classes, the generator can take them over rather than making you start
again. Because that rewrites lines somebody typed, it will not do it unless you ask: a file with no
`@generated-by` header is reported and skipped.

```
$ npx breeze-gen-entities --metadata metadata.json --out src/app/model
  skip customer.ts  - no generate-entity-classes header, so it is not the generator's
         14 properties in the metadata for Customer
         --adopt takes it over; --adopt --dry-run shows what that would change
```

Pair it with `--dry-run` the first time, then commit before running it for real:

```bash
npx breeze-gen-entities --metadata metadata.json --out src/app/model --adopt --dry-run
npx breeze-gen-entities --metadata metadata.json --out src/app/model --adopt
```

What adoption changes, and nothing else:

- **Mapped properties** are rewritten into the generated form — which adds the `declare` a
  hand-written class usually lacks. Without it an ES2022 class field becomes a real own property
  set to `undefined`, hiding the accessors Breeze installs on the prototype, so this is a fix and
  not a formality.
- **Missing properties** are appended, alongside the ones already there.
- **The class declaration** becomes `extends EntityBase`. `implements Entity` goes, because the
  base already implements it; an `implements` of your own is kept. The four members Breeze
  supplies — `entityAspect`, `entityType`, `getProperty`, `setProperty` — are dropped, since the
  base declares them and redeclaring shadows it.

Everything else is left exactly as it was: constructors, methods, getters, unmapped properties,
comments, and any import you wrote. A hand-written import that adoption makes redundant is reported
rather than deleted, because the generator does not remove imports it did not write:

```
  edit customer.ts
         extends EntityBase
         remove entityAspect, entityType, getProperty, setProperty - supplied by EntityBase
         adopt customerID: string
         Entity, EntityAspect, EntityType may now be unused - imported by hand, so left in place
```

Use `// @manual` on anything you want to keep out of it, before you run with `--adopt`.

## Formatters

Running Prettier over the generated files is fine. It collapses the two spaces before
`// @generated` to one and changes quote style; it does not move or drop the marker, even on a
line past 110 columns. The generator compares what a declaration *means* rather than its exact
text, so a formatted file is left alone instead of being rewritten back — the two do not fight.

## Shared behaviour on every entity: `--base`

To give every entity the same behaviour without giving up generation, name a base class of your
own:

```bash
npx breeze-gen-entities --metadata metadata.json --out src/app/model --base AppEntityBase
```

Every generated class then reads `export class Customer extends AppEntityBase`. The generator
scaffolds `app-entity-base.ts` once — extending the generated `EntityBase`, so the Breeze-supplied
members are still there — and never rewrites it:

```ts
import { EntityBase } from './entity-base';

export abstract class AppEntityBase extends EntityBase {
  get isNew() { return this.entityAspect.entityState.isAdded(); }
  describe() { return `${this.entityType.shortName} (${this.entityAspect.entityState.name})`; }
}
```

Only the root of an inheritance chain extends it: a type with a metadata base type still extends
that, so `Apple extends Fruit extends ItemOfProduce extends AppEntityBase`.

`--base-module <spec>` says where to import it from, defaulting to `./<kebab-name>` alongside the
generated classes. `--complex-base` and `--complex-base-module` do the same for complex types,
extending `ComplexObjectBase`.

::: warning A field with an initializer becomes an unmapped property
That rule applies on the base class too, where it applies to *every* entity in the model. Write
methods and getters unless an unmapped property is what you want — see
[Extending entities](./extending-entities.md).
:::

## Conventions

- **`declare` on every mapped member.** With ES2022 class fields a plain field becomes a real own
  property set to `undefined`, hiding the accessors Breeze installs on the prototype. See
  [Class fields and `declare`](./extending-entities.md).
- **Collection navigations are `RelationArray<T>`**, scalar ones the class itself.
- **Data types map as the client sees them:** `Guid` and `Binary` are `string`; `Time` and
  `TimeOnly` are `string` (an ISO 8601 duration and `"14:30:00"`); every numeric type, `Int64` and
  `Decimal` included, is `number`; `DateOnly` is a `Date`; `Undefined` is `any`.
- **Nullability is not expressed** unless you ask. `--nullable` gives `string | null` on nullable
  properties — right if you compile with `strictNullChecks`.
- **Metadata inheritance becomes class inheritance**, and a derived class declares only its own
  properties.
- **Line endings are preserved.** An existing file keeps whatever it already uses; a new one is
  written with `\n`, and git applies your `core.autocrlf`.

## Options

```
Required - one source of metadata:
  --metadata <file>   metadata JSON to read, relative to the current directory
  --service <url>     fetch <url>/Metadata from a running service instead

Required:
  --out <dir>         where the classes go, relative to the current directory

Optional:
  --ext <ext>         extension on sibling imports, e.g. .js for a NodeNext project
                      (default: none, which suits a bundler)
  --breeze <spec>     the module the generated files import Breeze types from
                      (default: breeze-client)
  --base <Name>       a base class of your own for every generated entity
  --base-module <spec>        where to import it from
  --complex-base <Name>       the same, for complex types
  --complex-base-module <spec>
  --types <A,B>       only these short names
  --nullable          add "| null" to nullable data properties
  --no-index          do not write index.ts
  --adopt             take over hand-written classes - files with no @generated-by header
  --dry-run, -n       report what would change, write nothing
  --version           print the generator version
  --help, -h          this list
```

`--ext .js` is the one worth knowing about: a project with `"moduleResolution": "nodenext"` needs
sibling imports written as `'./order.js'`. Bundlers — Vite, webpack, esbuild — want the default.

## Version stamp

Every file's first line records the generator that wrote it:

```ts
// @generated-by generate-entity-classes v1.0.0
```

When the generator moves ahead of what a file records, the run says so:

```
  edit customer.ts
         generated by v0.9.0, now v1.0.0
```

That is the hook for a future version that has to migrate what an older one emitted. A file with no
stamp at all is reported as `adopting a file the generator did not write`, and then treated
normally — which is how you bring hand-written classes under the generator.

## Troubleshooting

**`breeze.js not found`** — the generator reads metadata through Breeze itself, so naming
conventions, `nameOnServer`, inheritance and complex types resolve exactly as they will at runtime.
It looks for `breeze.js` beside itself, which is where it sits in `node_modules/breeze-client`. If
you are running from a clone of the Breeze repo rather than an install, run `npm run build` first.

**`<url>/Metadata returned 404`** — `--service` takes the service root, not the metadata endpoint;
the generator appends `/Metadata` itself.

**A property you deleted keeps coming back** — it is still in the metadata, so the generator keeps
appending it. Delete the `// @generated` marker instead of the line, or refresh the metadata file.

**A type is reported as `has no type in this metadata`** — a file is left over from a type that has
since gone. The generator never deletes files; remove it by hand once you are sure.
