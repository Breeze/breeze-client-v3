# Validation

For what a failed save looks like as an error object, and for failures that are not validation
at all, see [Error handling](/guide/error-handling).

Data must be validated on the server. Client-side validation does not replace that. It
exists for the user's benefit: tell them now that a name is required or too long, instead
of after they submit the form.

Breeze entities have validation built in. Validation rules come with the metadata, and
you can add or remove your own. Breeze runs them automatically at set points in an
entity's life, and you can run them yourself at any time. How to show errors to the user
is up to you.

## Validators and validation errors

A validation rule is a [`Validator`](/api/classes/Validator). It judges a value and does
not change it. `validate(value)` returns `null` if the value passes, or a
[`ValidationError`](/api/classes/ValidationError) if it fails.

Most validators are attached to a property: `required`, `maxLength` and so on. Some are
attached to an entity type and judge the whole entity.

Each entity keeps its current errors:

```ts
const errors = cust.entityAspect.getValidationErrors();              // all errors
const nameErrors = cust.entityAspect.getValidationErrors('companyName');
const hasErrors = cust.entityAspect.hasValidationErrors;
```

When a rule fails, Breeze adds its error to the collection. When the same rule later
passes, Breeze removes that error. An entity with an empty collection is valid.

Breeze does not stop an entity from having errors. It does one thing about them: it will
not save a change-set if any entity in it has errors.

A `ValidationError` has:

| Property | |
|---|---|
| `errorMessage` | the formatted message |
| `propertyName` | the property concerned; absent for entity-level errors |
| `property` | the `DataProperty` or `NavigationProperty`, if any |
| `validator` | the `Validator` that produced it, if any |
| `key` | identifies the error in the collection |
| `isServerError` | `true` if it came back from a failed save |

## When validation runs

The manager's [`ValidationOptions`](/api/classes/ValidationOptions) decide when it
validates automatically:

| Option | Default | Validates |
|---|---|---|
| `validateOnAttach` | `true` | the whole entity, when it is added or attached other than by a query |
| `validateOnPropertyChange` | `true` | a property, when its value changes |
| `validateOnSave` | `true` | every entity in the change-set, before it is sent |
| `validateOnQuery` | `false` | the whole entity, when a query brings it into the cache |

To change them, make a modified copy and set it on the manager:

```ts
const valOpts = em.validationOptions.using({ validateOnAttach: false });
em.setProperties({ validationOptions: valOpts });
```

`valOpts.setAsDefault()` makes the same settings the default for managers created later.

[Async validators](#async-validators) run only on save, and when you ask - not on attach, property
change or query.

### What automatic validation costs

Automatic validation is the largest single cost in Breeze's change tracking:
`validateOnPropertyChange` is roughly 63% of setting a tracked property, and
`validateOnAttach` roughly 38% of attaching an entity. That is a good trade for ordinary
screens and the wrong one for a bulk loop — see [Performance](/guide/performance#automatic-validation)
for the numbers and for how to turn it off for the duration.

Breeze only validates automatically when the entity is in a manager. This matters for
new entities. `createEntity` attaches immediately, so it validates before you have set any
values:

```ts
const cust = em.createEntity(Customer);
cust.entityAspect.getValidationErrors();   // "'companyName' is required"
```

Pass the values to `createEntity` so they are in place when validation runs:

```ts
const cust = em.createEntity(Customer, { companyName: 'Bravo Foods' });
```

Or create the entity detached, fill it in, then add it:

```ts
const custType = em.metadataStore.getAsEntityType('Customer');
const cust = custType.createEntity();
cust.companyName = 'Bravo Foods';
em.addEntity(cust);   // validates now
```

## Validating on demand

You can validate an entity at any time, attached or not:

```ts
if (!order.entityAspect.validateEntity()) {
  showErrors(order.entityAspect.getValidationErrors());
}
```

Or one property:

```ts
if (!cust.entityAspect.validateProperty('companyName')) {
  // ...
}
```

Both return `true` if nothing stands that would stop a save: the validators all pass, and no error
[you added yourself](#removing-validators-and-errors) remains. Errors from the server do not count —
see [which errors stop a save](#which-errors-stop-a-save).

## Server validation errors

Client and server errors end up in the same collection. When a save fails with entity
errors, Breeze adds each one to the entity it names and marks it `isServerError`. See
[Save errors](/guide/saving-changes#save-errors).

Breeze removes a client error when the problem is fixed, because it can re-run the rule.
It cannot re-run server logic, so a server error stays until:

- the property it is about is edited — it was about the old value, so it goes as soon as the user
  changes it, whether or not `validateOnPropertyChange` is on;
- the entity is saved again — Breeze clears server errors before validating for save — or
- you remove it.

```ts
const aspect = cust.entityAspect;
aspect.getValidationErrors()
  .filter(err => err.isServerError)
  .forEach(err => aspect.removeValidationError(err));
```

`clearValidationErrors()` removes every error, client and server.

## Which errors stop a save

An entity's errors come from three places, and Breeze can re-check only one of them:

| Where it came from | Re-checked by `validateEntity` | Stops a save | Goes away when |
|---|---|---|---|
| a validator | yes | **yes** | the value passes the rule |
| your code, through `addValidationError` | no — there is nothing to re-run | **yes** | you remove it |
| the server, after a failed save (`isServerError`) | no — only the server can | no | the property is edited, or the next save |

`validateEntity()` and `validateProperty()` answer the same question a save asks: *can this be
sent?* So an error you add yourself makes them return `false` and stops `saveChanges` until you
remove it — it is your code saying the entity is invalid, and nothing else can decide otherwise.
The server's errors do not stop a save, because every save clears them first and the server checks
again; blocking on them would leave a user who has fixed the problem unable to send the fix.

`hasValidationErrors` and `getValidationErrors()` still include the server's errors, so a form can
show everything that is currently known to be wrong.

## Validators from metadata

A Breeze .NET server includes validators in the metadata it sends, for example
`required` for non-nullable properties and `maxLength` for string lengths. Breeze
attaches them to the property definitions when it loads the metadata.

To add others, or if your metadata comes from somewhere else, add validators in client
code once the metadata is loaded.

## Built-in validators

`Validator` has static factory methods for common rules. Each returns a new `Validator`.
Most accept an optional context object with settings and message overrides.

| Validator | |
|---|---|
| `required({ allowEmptyStrings? })` | value is not null; empty strings fail unless allowed |
| `maxLength({ maxLength })` | string length at most `maxLength` |
| `stringLength({ minLength, maxLength })` | string length within range |
| `emailAddress()`, `phone()`, `url()`, `creditCard()` | common formats |
| `regularExpression({ expression })` | matches a regular expression |
| `string()`, `guid()`, `date()`, `duration()`, `bool()` | data type checks |
| `number()`, `integer()`, `int16()`, `int32()`, `byte()` | numeric checks, with range for the sized integers |

To attach one, push it onto the property's `validators` array:

```ts
import { Validator } from 'breeze-client';

const custType = em.metadataStore.getAsEntityType('Customer');
custType.getProperty('phone')!.validators.push(Validator.phone());
```

`EntityType.addValidator(validator, propertyName?)` does the same. Without a property name,
it adds an entity-level validator.

### Regular expression validators

`Validator.makeRegExpValidator` wraps a regular expression and a message in a new
validator:

```ts
const zipValidator = Validator.makeRegExpValidator(
  'zipVal',
  /^\d{5}([\-]\d{4})?$/,
  "The %displayName% '%value%' is not a valid U.S. zipcode");

custType.getProperty('postalCode')!.validators.push(zipValidator);
```

Like the other built-in format validators, it passes null and empty values. Pair it with
`required` if the value is mandatory.

## Custom validators

A custom validator is made the same way as the built-in ones. Construct a `Validator`
with:

- a **name**;
- a **validation function** `(value, context) => boolean`;
- an optional **context** object. Anything the function needs goes here, along with a
  `messageTemplate` or `message`.

```ts
const countryIsUS = new Validator(
  'countryIsUS',
  (value: string | null) => value == null || value.toUpperCase().startsWith('US'),
  { messageTemplate: "'%displayName%' must start with 'US'" });
```

A validator is a plain object, so you can unit-test it directly:

```ts
countryIsUS.validate('USA');      // null
countryIsUS.validate('Canada');   // ValidationError
```

Attach it to one or more properties. The entity type must be in the metadata store first,
so wait until metadata has loaded, either explicitly with `em.fetchMetadata()` or with the
first query:

```ts
await em.fetchMetadata();
const store = em.metadataStore;

store.getAsEntityType('Employee').getProperty('country')!.validators.push(countryIsUS);
store.getAsEntityType('Customer').getProperty('country')!.validators.push(countryIsUS);
```

### Parameterized validators

To make the rule reusable, write a factory that takes parameters and puts them in the
context:

```ts
function countryValidator(context: { country: string }) {
  return new Validator(
    'countryValidator',
    (value: string | null, ctx: any) =>
      value == null || value.toUpperCase().startsWith(ctx.country.toUpperCase()),
    {
      messageTemplate: "'%displayName%' must start with '%country%'",
      country: context.country,
    });
}

custType.getProperty('country')!.validators.push(countryValidator({ country: 'Canada' }));
```

The template can refer to anything in the context, so `%country%` fills in the parameter.

### Entity-level validators

Some rules involve more than one property, or a parent and its children. An entity-level
validator receives the whole entity as its value. Add it to the entity type's
`validators`:

```ts
const zipCodeValidator = new Validator(
  'zipCodeValidator',
  (cust: Customer, ctx: any) => {
    if (cust.country !== 'USA') return true;
    ctx.postalCode = cust.postalCode;
    return /^\d{5}([\-]\d{4})?$/.test(ctx.postalCode ?? '');
  },
  { messageTemplate: "'%postalCode%' is not a valid US zip code" });

custType.validators.push(zipCodeValidator);
```

Setting `ctx.postalCode` inside the function makes the value available to the message
template.

Entity-level validators do not run when a single property changes. They run when the
whole entity is validated: on attach, on save, and when you call `validateEntity()`.

### Required navigation properties

A navigation property can have validators too. To require an `OrderDetail`'s parent
`Order` on the client:

```ts
const detailType = em.metadataStore.getAsEntityType('OrderDetail');
detailType.getProperty('order')!.validators.push(Validator.required());
```

The foreign key is a separate problem. A new `OrderDetail` gets the default value for
its `orderID` data type, `0`, which passes a `required` check. You can create it with
`orderID: null` so `required` catches the missing value, or add a rule that rejects zero:

```ts
const nonZeroId = new Validator(
  'nonZeroId',
  (value: number | null) => value != null && value !== 0,
  { messageTemplate: "'%displayName%' is required" });

detailType.getProperty('orderID')!.validators.push(nonZeroId);
```

## Async validators

Some rules only a server can answer: is this user name still free, is this customer over their
credit limit. Write the validator's function as `async`, and Breeze waits for its answer where it
can:

```ts
const uniqueName = new Validator('uniqueName', async (name: string | null, ctx) => {
  if (!name) return true;
  const res = await fetch(`/api/customers/name-taken?name=${encodeURIComponent(name)}`,
    { signal: ctx.signal });
  return !(await res.json());
}, { messageTemplate: "'%value%' is already taken" });

em.metadataStore.getAsEntityType(Customer).getProperty('companyName')!.validators.push(uniqueName);
```

**Where it runs.** An async validator runs only where something can wait for its answer:

| | |
|---|---|
| `saveChanges()` | yes - the save waits for it, and does not send an entity that fails |
| `validateEntityAsync()`, `validatePropertyAsync()` | yes - they resolve when every answer is in |
| a property change, attach, query | no |
| `validateEntity()`, `validateProperty()` | no - they count its last answer, if it has one |

It does not run as the user types, where every keystroke would be a request. **Editing the property
clears its error**, as it clears an error from the server: the answer was about a value the entity no
longer has. The next save, or `validateEntityAsync`, asks again.

```ts
if (!await customer.entityAspect.validateEntityAsync()) {
  showErrors(customer.entityAspect.getValidationErrors());
}
```

`entityAspect.isValidating` is true while a check is running.

**Things Breeze takes care of:**

- **Overlapping runs.** Validating an entity again while a check is still out replaces that check:
  its `ctx.signal` is aborted and its answer is ignored, and both calls resolve with the newer one.
  Pass the signal to `fetch` so the abandoned request is cancelled too.
- **An edit during a check.** If the value changes while it is being checked, the check runs again
  on the new value, so the answer that sticks is about the value that is there.
- **Detaching.** Checks still out for a detached entity are aborted and their answers dropped.
- **The save.** While a save waits for its checks, its entities count as being saved: a second
  `saveChanges` is refused unless `allowConcurrentSaves` is set.

**Saying it is async.** Breeze has to know before calling a validator whether it returns a promise,
to keep it out of the places that cannot wait. An `async` function tells it. A function that returns
a promise without being declared `async` needs `{ isAsync: true }` in its context - otherwise Breeze
finds out the first time it runs one, warns, and treats it as async from then on.

A rejected promise, or an exception, fails the check, as a validator that throws does.

## Registering custom validators

Adding a validator to a property is usually all you need to do. There is one exception.

Serialized metadata records validators **by name**. That applies to
`metadataStore.exportMetadata()`, and to `em.exportEntities()` with metadata included.
When the metadata is imported again, whether in a new session or with
`EntityManager.importEntities`, Breeze must turn each name back into a validator. It knows
the built-in names. It knows yours only if you have registered them:

```ts
Validator.register(zipCodeValidator);
Validator.registerFactory(countryValidator, 'countryValidator');
```

For a factory, the second argument must be the name of the validator the factory
creates. Breeze cannot call the factory to find out, because it has no context to call it
with.

Register before importing metadata. Otherwise the import throws
`Unable to locate a validator named:…`. Registering does no harm if you never import, so
it is a reasonable habit.

Registered validators live in the Breeze configuration's function registry:

```ts
import { config } from 'breeze-client';

const factory = config.getRegisteredFunction('Validator.countryValidator');
```

## Removing validators and errors

To remove a rule, remove it from the array it was added to:

```ts
const validators = custType.validators;
validators.splice(validators.indexOf(unwantedRule), 1);
```

Errors that rule has already produced stay on the entities until you remove them.
`removeValidationError` accepts the error itself, its key, or the validator that produced
it. Given a validator, it removes every error that validator produced on the entity. The
key is the validator name, plus `:propertyName` for property errors, and
`ValidationError.getKey` builds it for you:

```ts
import { ValidationError } from 'breeze-client';

cust.entityAspect.removeValidationError(ValidationError.getKey(unwantedRule));
cust.entityAspect.removeValidationError(ValidationError.getKey(countryIsUS, 'country'));
cust.entityAspect.removeValidationError(unwantedRule);   // every error it produced
```

::: tip Fixed in 3.0
In 2.x, passing a `Validator` to `removeValidationError` was accepted but removed
nothing, because a validator has no `key` of its own.
:::

You can also add an error of your own, with or without a validator behind it:

```ts
const error = new ValidationError(null, { propertyName: 'companyName' }, 'Name already in use', 'nameInUse');
cust.entityAspect.addValidationError(error);
```

An error you add stops the entity being saved until you remove it — editing the property does not
remove it, because Breeze cannot know whether the edit fixed what your code objected to. Give it a
key, as above, so that removing it is `removeValidationError('nameInUse')`; a save that it stops
names it by that key, as `errorName` in [`entityErrors`](/guide/saving-changes#save-errors).

## Validation events

`entityAspect.validationErrorsChanged` fires when an entity's errors change.
`em.validationErrorsChanged` fires for every entity in the manager. Both provide `entity`,
`added` and `removed`:

```ts
em.validationErrorsChanged.subscribe(({ entity, added, removed }) => {
  updateErrorDisplay(entity);
});
```

With RxJS, [`validationErrorsChanged$`](/guide/rxjs) is this event as an observable, and the RxJS
page shows how to keep [every current error in one list](/guide/rxjs#every-validation-error-kept-current).

To silence these events temporarily, use `BreezeEvent.enable`. Disabling on the manager
also silences the per-entity events for entities in it. Disabling on an `entityAspect`
affects only that entity:

```ts
import { BreezeEvent } from 'breeze-client';

BreezeEvent.enable('validationErrorsChanged', em, false);
// ... bulk changes ...
BreezeEvent.enable('validationErrorsChanged', em, true);
```

## Customizing messages

Messages come from templates. `%displayName%` becomes the property's display name, which
defaults to its name. `%value%` becomes the value that failed. Any other `%name%` comes
from the validator's context. The stock templates are in `Validator.messageTemplates`,
keyed by validator name, and you can change them, for example to translate them:

```ts
Validator.messageTemplates.required = "'%displayName%' is required ... seriously";
Validator.messageTemplates.maxLength =
  "'%displayName%' must be %maxLength% characters or fewer";
```

A template change affects validators created afterwards. Existing validators keep the
template they were created with. So set templates at startup, before metadata is loaded.

To give a property a friendlier name in messages, set its `displayName`:

```ts
custType.getProperty('companyName')!.displayName = 'Company name';
```

For a single validator you can pass `messageTemplate` in its context. You can also pass
`message`: either a fixed string, or a function that takes the context and returns one.

## See also

- [Saving changes](/guide/saving-changes)
- [Metadata](/metadata/)
- API: [Validator](/api/classes/Validator), [ValidationError](/api/classes/ValidationError), [ValidationOptions](/api/classes/ValidationOptions), [EntityAspect](/api/classes/EntityAspect)
