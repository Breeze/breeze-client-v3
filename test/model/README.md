# The test entity model

One TypeScript class per structural type in the Northwind test metadata, so that a spec can say
`cust.companyName` instead of `cust.getProperty("companyName")` and have TypeScript check it.

```ts
import { Customer, Order } from '../model';

const cust = em.createEntity('Customer', { companyName: 'Acme' }) as Customer;
cust.companyName = 'Beta';          // checked
cust.orders[0].orderDate;           // checked, through RelationArray<Order>
await cust.orders.load();           // relation-array members are there too
```

Casting is all most specs need. The classes are ordinary types, so `qr.results as Customer[]`
works against any `MetadataStore`, registered or not.

## Registering them

`registerModelClasses(metadataStore)` makes Breeze build every entity from these classes, which
is what gives you `instanceof` and lets you add methods that entities actually have.

```ts
import { registerModelClasses, Customer } from '../model';

registerModelClasses(em.metadataStore);
const cust = em.createEntity('Customer', {}) as Customer;
cust instanceof Customer;           // true
```

**Breeze binds a class to one `MetadataStore` for the life of the process.** Registering the same
class in a second store throws `Cannot register the same constructor for Customer:#Foo in
different metadata stores`. Vitest gives each spec file its own module graph, so each file gets
its own copy of the classes — but *within* a file, register against one store only.

Most of the suite deliberately does not register them: `test/test-fns.ts` registers no adapters
and no constructors, so the specs exercise what an unconfigured application gets.
`test/unit/model-classes.spec.ts` is the file that covers registration.

## Generated, and how to regenerate

```bash
npm run gen:model        # builds dist/, then regenerates from the checked-in metadata
```

Or drive it directly. `--out` and a metadata source are required — nothing can infer either, and
a wrong guess at `--out` overwrites a directory nobody named. Both paths are relative to the
working directory, which under `npm run` is the repo root:

```bash
# from the checked-in fixture
node scripts/generate-entity-classes.js \
  --metadata test/support/NorthwindIBMetadata.json \
  --out test/model --breeze breeze-client

# from a running service
node scripts/generate-entity-classes.js \
  --service http://localhost:34377/breeze/NorthwindIBModel \
  --out test/model --breeze breeze-client

# one type, nothing written
node scripts/generate-entity-classes.js \
  --metadata test/support/NorthwindIBMetadata.json \
  --out test/model --breeze breeze-client \
  --types Customer,Order --dry-run
```

**Applications do not run it this way.** `scripts/generate-entity-classes.js` is copied into
`dist/` by `scripts/prepare-dist.mjs` and published as the `breeze-gen-entities` bin, so anyone who
installs the package runs `npx breeze-gen-entities --service ... --out src/app/model`. That is the
spelling the user-facing docs teach — [docs/guide/generating-entities.md](../../docs/guide/generating-entities.md)
— and the two invocations run the same file. `node scripts/...` is just the in-repo shortcut that
skips a build of `dist/`.

Installed, the script finds `breeze.js` beside itself (`dist/` is the published package root, so
that is the caller's own copy of Breeze). In this repo it falls back to `../dist/breeze.js`, which
is why `gen:model` builds first.

The generated classes reference types that live in `breeze-client` — `RelationArray` and
`ComplexArray` for collection properties, and `Entity`, `EntityAspect`, `EntityType` and the
complex-type equivalents in `entity-base.ts` — and they import them from `breeze-client`, which
needs no saying: it is right wherever the package is installed, this repo included. `--breeze`
overrides it, for a fork republished under another name. A relative specifier is written verbatim
into every generated file, so it has to be correct relative to `--out`, not to where you run the
command.

### Why these files say `breeze-client` inside this repo

The other 40 spec files import `../../src/breeze`. `test/model/` deliberately does not: these
files are exactly what the generator writes for an application, and they should read that way.

Two pieces make the name resolve back to the sources here:

| | |
|---|---|
| `paths` in [test/tsconfig.json](../tsconfig.json) | type checking |
| `resolve.alias` from [vitest.shared.config.ts](../../vitest.shared.config.ts), used by all four tiers | running |

Without them the name would still resolve — `package.json` has an `exports` map, so Node and Vite
honour the self-reference — but to `dist/`, and the model would be bound to a **different copy of
Breeze** from the one the specs run: two `EntityState` enums, two `DataType` tables, and
`instanceof` checks that fail for no visible reason. Today every Breeze import in these files is
`import type`, which is erased, so nothing would actually load; the alias is there for the moment
someone adds a real import to a model class. `test/unit/model-classes.spec.ts` asserts the two
spellings give the same module.

It reads the metadata through `dist/breeze.js`, so naming conventions, `nameOnServer`,
inheritance and complex types resolve exactly as they do at runtime. `--help` lists every option.

### Behaviour on every entity: `--base`

To give every generated class the same behaviour without giving up code generation, name a base
class of your own:

```bash
node scripts/generate-entity-classes.js ... --base AppEntityBase
```

Every generated class then reads `export class Customer extends AppEntityBase`, and the generator
scaffolds `app-entity-base.ts` once — extending the generated `EntityBase`, so the
Breeze-supplied members are still there — and never touches it again:

```ts
import { EntityBase } from './entity-base';

export abstract class AppEntityBase extends EntityBase {
  get isNew() { return this.entityAspect.entityState.isAdded(); }
  describe() { return `${this.entityType.shortName} (${this.entityAspect.entityState.name})`; }
}
```

Only the root of an inheritance chain extends it — a type with a metadata base type still extends
that, so `Apple extends Fruit extends ItemOfProduce extends AppEntityBase`.

`--base-module <spec>` says where to import it from, defaulting to `./<kebab-name>` next to the
generated classes; `--complex-base` and `--complex-base-module` do the same for complex types,
extending `ComplexObjectBase`.

The unmapped-property rule applies here as everywhere: a field **with an initializer** on the base
class becomes an unmapped property on every entity in the model. Write methods and getters unless
that is what you want.

### What the generator owns, and what it leaves alone

The unit is the member, not the file. A line ending in `// @generated` belongs to the generator;
nothing else in the file does.

| | |
|---|---|
| `declare city: string;  // @generated` | rewritten from metadata, in place |
| a marked property no longer in the metadata | removed |
| a metadata property the file does not declare | appended, marked |
| a metadata property declared **without** the marker | left as it is, and reported — that is how you override one |
| `import ... // @generated` | kept in step; dropped only when nothing in the file still refers to it |
| a hand-written import | never removed |
| methods, getters, unmapped properties, comments, the class doc comment | never touched |

So this survives a regeneration unchanged:

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

New properties are appended after the last generated one rather than sorted into metadata order,
so that a hand-written member never has generated code inserted into the middle of it.

`entity-base.ts` and `index.ts` carry a header saying they are generated whole. Anything you want
to keep belongs in another module.

### Version stamp

Every file's first line is `// @generated-by generate-entity-classes v<version>`. When the
generator's `GENERATOR_VERSION` moves ahead of what a file records, the run reports it:

```
  edit customer.ts
         generated by v0.9.0, now v1.0.0
```

That is the hook for a future version that has to migrate what an older one emitted.

## Conventions the generator follows

- **`declare` on every mapped member.** With ES2022 class fields a plain field becomes a real own
  property set to `undefined`, hiding the accessors Breeze installs on the prototype, and a field
  with an initializer becomes an unmapped property. See
  [Class fields and `declare`](../../docs/guide/extending-entities.md).
- **Breeze-supplied members live on `EntityBase` / `ComplexObjectBase`** in `entity-base.ts`:
  `entityAspect`, `entityType`, `getProperty`, `setProperty`, and the complex-type equivalents.
- **Collection navigations are `RelationArray<T>`**, scalar ones the class itself. `RelationArray`
  and `ComplexArray` take a type parameter that defaults to `Entity` / `ComplexObject`, so
  existing untyped uses are unaffected.
- **Data types** map as the client sees them: `Guid` and `Binary` are `string`, `Time` and
  `TimeOnly` are `string` (an ISO 8601 duration and `"14:30:00"`), every numeric type including
  `Int64` and `Decimal` is `number`, `DateOnly` is a `Date`, `Undefined` is `any`.
- **Nullability is not expressed** by default, because the test tier compiles with
  `strictNullChecks: false`. Pass `--nullable` to get `string | null` on nullable properties.
- **Inheritance in the metadata becomes inheritance in the classes**, and a derived class declares
  only its own properties.
