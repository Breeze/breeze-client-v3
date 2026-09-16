# Typed queries

A query built from a constructor knows its entity type, so the compiler can check what you filter,
sort and expand on:

```ts
EntityQuery.from(Customer).where('companyName', 'startsWith', 'C')   // fine

EntityQuery.from(Customer).where('compnyName', 'startsWith', 'C')
// Argument of type '"compnyName"' is not assignable to parameter of type 'DataKeys<Customer>'.

EntityQuery.from(Customer).where({ compnyName: { startsWith: 'C' } })
// 'compnyName' does not exist in type '{ … }'. Did you mean to write 'companyName'?
```

The two forms are equally strict. Only the object form can suggest the correction, for reasons
explained under [The object form](#the-object-form).

None of this exists at run time. A query is still assembled from the same strings it always was,
and the same wire format goes to the server. These are types only — see
[Typed entities](/guide/typed-entities) for where the `T` comes from.

## Three things get checked

```ts
const q = EntityQuery.from(Order);

q.where('freight', 'gt', 100)             // ok
q.where('shipCity', 'startsWith', 'Ber')  // ok
q.where('customer.companyName', 'eq', 'Acme')   // ok — through a navigation

q.where('freigt', 'gt', 100)              // the path must exist
q.where('freight', 'startsWith', 100)     // the operator must suit the property's type
q.where('freight', 'gt', 'one hundred')   // the value must match the property
```

Operators follow the property type: strings get `startsWith`, `endsWith` and `contains` as well as
comparison; numbers and dates get comparison but not the string operators; booleans get equality
only. Every alias Breeze accepts is allowed — `'gt'`, `'>'` and `'greaterthan'` are the same thing.

`null` is always a valid value, and `in` takes an array:

```ts
q.where('shipRegion', 'eq', null)
q.where('freight', 'in', [10, 20, 30])
```

### Comparing a property to another property

Breeze reads a string value as a property name when it names one, so this keeps working:

```ts
q.where('requiredDate', '<', 'shippedDate')
```

That is why a date property accepts a string. It accepts only a string that names a real property,
though, so `where('freight', 'gt', 'one hundred')` is still an error.

When the guess goes the wrong way, say which you meant:

```ts
q.where('unitsInStock', 'eq', { value: '35', isLiteral: true, dataType: 'Int32' })
q.where('unitsInStock', 'eq', { value: 'reorderLevel', isProperty: true })
```

## Collections

A collection is filtered with `any` or `all` rather than compared, and the inner property is
checked against the element type:

```ts
EntityQuery.from(Order).where('orderDetails', 'any', 'unitPrice', 'gt', 5)
EntityQuery.from(Customer).where('orders', 'all', 'freight', 'lt', 100)

EntityQuery.from(Order).where('orderDetails', 'gt', 5)      // a collection is not comparable
EntityQuery.from(Order).where('orders', 'any', …)           // orders is Customer's, not Order's
```

A prebuilt `Predicate` works in the same position:

```ts
const inner = Predicate.create('unitPrice', '>', 200).and('quantity', '>', 50);
EntityQuery.from(Customer).where('orders', 'any', 'orderDetails', 'any', inner)
```

## The object form

The object form — the docs also call it the JSON form — is checked against the same paths,
operators and values:

```ts
EntityQuery.from(Customer).where({ city: 'London', country: 'UK' });   // keys are and-ed
EntityQuery.from(Order).where({ freight: { gt: 100 } });
EntityQuery.from(Order).where({ 'customer.companyName': { startsWith: 'A' } });
EntityQuery.from(Customer).where({ or: [{ city: 'London' }, { city: 'Berlin' }] });
EntityQuery.from(Customer).where({ not: { city: 'London' } });
EntityQuery.from(Customer).where({ orders: { any: { freight: { gt: 100 } } } });
```

A bare value means equality, several keys in one object are and-ed, `and`/`or`/`not` take objects
or prebuilt `Predicate`s, and a collection takes `any` or `all` whose body is checked against the
element type. `null`, `in`, the `{ value, dataType }` escape hatch and query-function keys all work
as they do in the three-argument form.

### It gives the better error message

This is the one place where the object form is *better* than `where(path, op, value)`. A
misspelled key is an ordinary excess-property error, and that is the diagnostic that carries a
spelling suggestion:

```
Object literal may only specify known properties, but 'compnyName' does not exist
in type '{ … }'. Did you mean to write 'companyName'?
```

The three-argument form cannot produce that, because a failed overload match reports differently.
A wrong operator is also clearer:

```
Object literal may only specify known properties, and 'startsWith' does not exist
in type 'FilterValueExpression | FilterOpsObject<Order, number>'.
```

The cost is length: the compiler prints the target type into the message, so these run two to four
times longer than the equivalent from the three-argument form. The useful part — the offending key
and the suggestion — is at the start and the end.

### What it does not catch

Misspelling a *nested* key (`'customer.nope'`) is reported, but without a suggestion: the edit
distance across a dotted path does not trigger one. Errors inside `and`/`or` arrays print the union
of the element shapes, which makes them the longest of the set.

## Standalone predicates

A `Predicate` built on its own has no query to take an entity type from. `Predicate.for` supplies
one:

```ts
const p = Predicate.for(Customer);
const pred = p('companyName', 'startsWith', 'C').and(p('city', 'eq', 'Vienna'));

EntityQuery.from(Customer).where(pred);
```

The constructor is read for its type only — nothing about it is kept, and it does not have to be
registered with a `MetadataStore`. Hoist the factory and reuse it. The predicates it returns are
ordinary `Predicate`s, so `and`, `or` and `not` behave as they always have; those combinators take
any predicate and are not themselves checked.

## orderBy and expand

The same paths, with the same rules:

```ts
EntityQuery.from(Order).orderBy('freight desc')
EntityQuery.from(Order).orderBy(['shipCity', 'freight desc'])
EntityQuery.from(Order).expand('customer')
EntityQuery.from(Order).expand(['customer', 'orderDetails.product'])

EntityQuery.from(Order).orderBy('freight descending')   // not a direction
EntityQuery.from(Order).expand('freight')               // not a navigation
```

A comma-separated list is still accepted but is *not* checked — enumerating every combination of
paths is not something to ask of a compiler. Pass an array to keep the checking.

## What is not checked, and why

**A path that is only known at run time.** This is the pattern the whole design bends around, and
it has to keep working:

```ts
const sortBy: string = userPickedColumn;
EntityQuery.from(Customer).where(sortBy, 'eq', value)     // allowed
```

A misspelled *literal* is never let through this way. The overloads distinguish the two: a
`string` variable is accepted, a string literal has already been checked and finds nothing to
rescue it.

**A `FilterQueryOp` instance.** `FilterQueryOp.StartsWith` and `FilterQueryOp.GreaterThan` are the
same type, so `where('freight', FilterQueryOp.StartsWith, 1)` cannot be caught. The string form
is checked; prefer it.

**Query functions.** Anything with parentheses is passed through, because what is inside them is a
small expression language rather than a property path:

```ts
EntityQuery.from(Customer).where('toUpper(substring(companyName, 1, 2))', 'startsWith', 'OM')
```

**Paths more than three navigations deep.** Paths are enumerated as a union of string literals,
and that union grows with the model, multiplied out at every level. Three covers the filters people
actually write. A deeper path still works — it is not offered or checked, and falls through to the
unchecked overload rather than failing.

**Enum properties.** The class generator writes an enum as `string`, because that is its `dataType`
— but the server takes the numeric ordinal too, and nothing in the TypeScript type says so.
Comparing one to a number needs a cast.

## The types are only as good as the model

These checks come from the generated classes, not from the server. If a class is out of date, a
valid query can be rejected and an invalid one accepted. When the compiler insists a real property
does not exist, regenerate before assuming it is wrong — see
[Typed entities](/guide/typed-entities).

## Existing code is unaffected

`EntityQuery` still defaults its type argument to `any`, so a query built from a resource name is
exactly as permissive as it ever was:

```ts
new EntityQuery('Customers').where('anything at all', 'eq', 1)   // fine, as before
EntityQuery.from('Orders').orderBy('whatever desc')              // fine, as before
```

Nothing has to be migrated, and no runtime behaviour changed. The checking arrives on its own
wherever a query already starts from `EntityQuery.from(SomeClass)`.

There is a compile-time cost: on this repo's own test suite the change roughly doubles the
type-checking work the compiler does for queries, which came to about a fifth of a second across
450-odd specs. The depth limit is the dial that controls it.
