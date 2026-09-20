import type { ComplexObject, Entity } from '../entity/entity-aspect.js';
import type { ComplexArray } from '../entity/complex-array.js';
import type { RelationArray } from '../entity/relation-array.js';
import type { FilterQueryOp } from './entity-query.js';
import type { Predicate } from './predicate.js';

/**
The types behind the checked form of {@link EntityQuery.where}, {@link EntityQuery.orderBy},
{@link EntityQuery.expand} and {@link Predicate.for}.

Nothing here exists at runtime. A query is still built from the same strings it always was; these
only decide which of those strings the compiler accepts, and with what operator and value.

Everything is written so that an untyped query behaves exactly as it did before. `EntityQuery`
defaults its type argument to `any` and hundreds of existing call sites rely on that, so every
type here degrades to `string` / `any` when it cannot see a concrete entity type. See
{@link PropertyPath}.

@module
*/

// ---------------------------------------------------------------------------------------------
// Walking an entity type
// ---------------------------------------------------------------------------------------------

/**
`T`, in a position the compiler does not infer `T` from - so that `Predicate.create(...)` without a
type argument is a `Predicate<any>`, rather than a Predicate of whatever the arguments look like.
The built-in `NoInfer` does this, but needs TypeScript 5.4 in the application that compiles
against Breeze's .d.ts; this works in any version.
*/
export type NoInferFrom<T> = [T][T extends any ? 0 : never];

/** Property types that can be compared in a filter. */
type Scalar = string | number | boolean | Date;

/** The properties of `T` that came from the model, without the members Breeze itself supplies. */
type Own<T> = Exclude<keyof T, keyof Entity | keyof ComplexObject> & string;

/** The element type of a collection-valued property, or `never` if it is not one. */
type ElementOf<V> =
  V extends RelationArray<infer E> ? E :
  V extends ComplexArray ? ComplexObject :
  never;

/** True for a property that can be walked through: a to-one navigation, or a complex type. */
type IsWalkable<V> =
  [ElementOf<V>] extends [never]
    ? (NonNullable<V> extends Entity | ComplexObject ? true : false)
    : false;

/** @hidden The data properties of `T`: those holding a value, rather than an entity or collection. */
export type DataKeys<T> = { [K in Own<T>]-?: NonNullable<T[K]> extends Scalar ? K : never }[Own<T>];
type WalkKeys<T> = { [K in Own<T>]-?: IsWalkable<T[K]> extends true ? K : never }[Own<T>];
type CollectionKeys<T> = { [K in Own<T>]-?: [ElementOf<T[K]>] extends [never] ? never : K }[Own<T>];

type IsEntityValued<V> =
  [ElementOf<V>] extends [never]
    ? (NonNullable<V> extends Entity ? true : false)
    : (ElementOf<V> extends Entity ? true : false);
type NavigationKeys<T> = { [K in Own<T>]-?: IsEntityValued<T[K]> extends true ? K : never }[Own<T>];
type NavigationTarget<V> = [ElementOf<V>] extends [never] ? NonNullable<V> : ElementOf<V>;

/**
How many navigations a generated path may cross: `'shipCity'` is none, `'customer.companyName'`
is one.

Three covers the filters people actually write. The cost is paid in the size of the union the
compiler carries per entity type, which grows with the model and is multiplied out at every
level. A deeper path still works - it is simply not offered or checked, because a path these
types do not recognize falls through to the untyped overload rather than failing.

The counter is a tuple, and a level is one element off the front of it, rather than a number and
a lookup table of its predecessors. The two count the same way, but TypeScript 4.6 and 4.7 report
`TS2589: Type instantiation is excessively deep` against this file for the indexed-access form -
only under `skipLibCheck: false`, and the paths still type correctly, but a consumer on those two
versions should not have to see it. Tuple destructuring is understood by every version we support.
*/
type DefaultDepth = [unknown, unknown, unknown];

/** Paths ending in a comparable value. */
type RawPropertyPath<T, D extends unknown[] = DefaultDepth> =
  | DataKeys<T>
  | (D extends [unknown, ...infer Rest]
      ? { [K in WalkKeys<T>]: `${K}.${RawPropertyPath<NonNullable<T[K]>, Rest>}` }[WalkKeys<T>]
      : never);

/** Paths ending in a collection, which is what `any` and `all` filter over. */
type RawCollectionPath<T, D extends unknown[] = DefaultDepth> =
  | CollectionKeys<T>
  | (D extends [unknown, ...infer Rest]
      ? { [K in WalkKeys<T>]: `${K}.${RawCollectionPath<NonNullable<T[K]>, Rest>}` }[WalkKeys<T>]
      : never);

/** Paths ending in anything a projection can return - a value, a complex object, or a navigation,
to-one or collection - walking only through to-one navigations and complex properties: a
projection cannot reach into each element of a collection. What `select` takes. */
type RawSelectPath<T, D extends unknown[] = DefaultDepth> =
  | DataKeys<T> | WalkKeys<T> | NavigationKeys<T>
  | (D extends [unknown, ...infer Rest]
      ? { [K in WalkKeys<T>]: `${K}.${RawSelectPath<NonNullable<T[K]>, Rest>}` }[WalkKeys<T>]
      : never);

/** Paths ending in a navigation, to-one or collection - what `expand` takes. */
type RawNavigationPath<T, D extends unknown[] = DefaultDepth> =
  | NavigationKeys<T>
  | (D extends [unknown, ...infer Rest]
      ? { [K in NavigationKeys<T>]: `${K}.${RawNavigationPath<NavigationTarget<T[K]>, Rest>}` }[NavigationKeys<T>]
      : never);

// ---------------------------------------------------------------------------------------------
// The public path types, each guarded so that an untyped query is unaffected
// ---------------------------------------------------------------------------------------------

/**
The property paths of `T` that name a comparable value - `'companyName'`, `'customer.city'` - as
a union of string literals, so a misspelling is a compile error and an editor can complete them.

`Entity extends T` is the guard. It is true only when `T` is `any` or bare `Entity`, which is
what an untyped query has; this is then plain `string` and nothing is restricted, exactly as
before. The same shape as {@link QueriedAs}.

Collections are absent, because a collection is filtered with `any` or `all` rather than compared
- see {@link CollectionPath}.
*/
export type PropertyPath<T> = Entity extends T ? string : RawPropertyPath<T>;

/** The property paths of `T` that name a collection, for the `any` and `all` forms of
{@link EntityQuery.where}. Plain `string` for an untyped query. */
export type CollectionPath<T> = Entity extends T ? string : RawCollectionPath<T>;

/** The property paths of `T` that name a navigation, for {@link EntityQuery.expand}. Plain
`string` for an untyped query. */
export type NavigationPath<T> = Entity extends T ? string : RawNavigationPath<T>;

/** The property paths of `T` that a projection can return, for {@link EntityQuery.select}: a value
(`'companyName'`), a complex object (`'location'`), or a navigation (`'orders'`, `'customer'`),
reached through to-one navigations and complex properties (`'customer.companyName'`). Plain
`string` for an untyped query. */
export type SelectPath<T> = Entity extends T ? string : RawSelectPath<T>;

/** The original values an {@link EntityAspect} or {@link ComplexAspect} keeps: for each data property
edited since the entity was last saved or accepted, its value before the first edit. Typed from the
entity class - `{ freight?: number; shipCity?: string; … }` - for an {@link EntityAspectOf} or
{@link ComplexAspectOf}. Only the class's own data properties: reaching another entity from here
 would make an entity class's type depend on itself. */
export type OriginalValues<T> = { [K in DataKeys<T>]?: T[K] };

/** The key of an entity of type `T` given by property name - `{ orderID: 10248, productID: 11 }` -
in place of an array whose order must match the type's key. Accepted by
{@link EntityManager.getEntityByKey} and {@link EntityManager.fetchEntityByKey} with an entity class,
and by the {@link EntityKey} constructor. The names are checked against `T`'s data properties; which
of them form the key is known only from the metadata, and checked when the key is made. Plain
`Record<string, any>` for an untyped call. */
export type KeyValues<T> = Entity extends T ? Record<string, any> : { [K in DataKeys<T>]?: T[K] };

/**
A {@link PropertyPath}, optionally followed by ` desc` or ` asc`, for
{@link EntityQuery.orderBy}. Plain `string` for an untyped query.

A comma-separated list of clauses is still accepted, it is just not checked: enumerating every
combination of paths is not something to ask of a compiler. Pass an array instead to keep the
checking.
*/
export type OrderByPath<T> =
  Entity extends T ? string
  : RawPropertyPath<T> | `${RawPropertyPath<T>} desc` | `${RawPropertyPath<T>} asc`;

// ---------------------------------------------------------------------------------------------
// Resolving a path back to its type
// ---------------------------------------------------------------------------------------------

type RawPropertyValue<T, P> =
  P extends `${infer Head}.${infer Rest}`
    ? (Head extends keyof T ? RawPropertyValue<NonNullable<T[Head]>, Rest> : never)
    : P extends keyof T ? NonNullable<T[P]> : never;

/** The type of the value at path `P` of `T`, which is what a filter compares against. `any` for
an untyped query. */
export type PropertyValue<T, P> = Entity extends T ? any : RawPropertyValue<T, P>;

/** The element type of the collection at path `P` of `T` - what an `any` or `all` filter then
filters on. `any` for an untyped query. */
export type CollectionElement<T, P> =
  Entity extends T ? any : ElementOf<RawPropertyValue<T, P>>;

// ---------------------------------------------------------------------------------------------
// Operators and values
// ---------------------------------------------------------------------------------------------

/** Operators valid for any property type, with the aliases Breeze accepts. */
type EqualityOps = 'eq' | 'ne' | '==' | '!=' | 'equals' | 'notequals';
/** Operators valid for anything with an order to it. */
type ComparisonOps = 'gt' | 'lt' | 'ge' | 'le' | '>' | '<' | '>=' | '<='
  | 'greaterthan' | 'lessthan' | 'greaterthanorequal' | 'lessthanorequal';
/** Operators valid only on strings. */
type StringOps = 'startsWith' | 'startswith' | 'endsWith' | 'endswith'
  | 'contains' | 'substringof';
/** Membership of a set. */
type InOp = 'in';

/** The `any` and `all` quantifiers over a collection, with their aliases. */
export type QuantifierOp = 'any' | 'all' | 'some' | 'every';

/**
The operators that make sense for a value of type `V`.

Only the string form is checked. A {@link FilterQueryOp} instance is accepted against every
property type, because they are all one type: `FilterQueryOp.StartsWith` is not distinguishable
from `FilterQueryOp.GreaterThan` at compile time.
*/
export type FilterOpFor<V> = FilterQueryOp | FilterOpNameFor<V>;

/**
The operator *names* that make sense for a value of type `V`, without {@link FilterQueryOp}.

The object form of a filter needs these on their own, because an object key can only be a string:
`{ freight: { gt: 100 } }`.
*/
export type FilterOpNameFor<V> =
  [NonNullable<V>] extends [string] ? EqualityOps | ComparisonOps | StringOps | InOp
  : [NonNullable<V>] extends [number] ? EqualityOps | ComparisonOps | InOp
  : [NonNullable<V>] extends [Date] ? EqualityOps | ComparisonOps | InOp
  : [NonNullable<V>] extends [boolean] ? EqualityOps | InOp
  : EqualityOps | ComparisonOps | StringOps | InOp;

/**
The object form of a filter value, which forces an interpretation Breeze would otherwise infer:
whether to read `value` as a literal or as the name of another property, and what {@link DataType}
it has.
*/
export interface FilterValueExpression {
  /** The value to compare against: a literal, or the name of another property when `isProperty` is set or `isLiteral` is `false`. */
  value: any;
  /** Read `value` as a literal rather than as a property name. */
  isLiteral?: boolean;
  /** Read `value` as a property name rather than as a literal. The runtime honours either this
  or `isLiteral: false`; both spellings are long-standing. */
  isProperty?: boolean;
  /** Pin the {@link DataType}, for when inference from context gets it wrong. */
  dataType?: any;
}

/**
What may be compared against a property of type `V` under operator `O`.

`V` itself, or null - filtering on a missing value is ordinary - or a {@link FilterValueExpression}.
`in` takes an array of `V` instead.

Any {@link PropertyPath} of `T` is also allowed, whatever `V` is, because Breeze compares a
property to another property the same way it compares to a literal:
`where('requiredDate', '<', 'shippedDate')`. That is why the value of a number property may be a
string - but only a string that names a real property, so `where('freight', 'gt', 'one hundred')`
is still rejected.
*/
export type FilterValueFor<T, V, O> =
  O extends InOp ? readonly (V | null)[] | FilterValueExpression
  : V | null | undefined | FilterValueExpression | PropertyPath<T>;

/**
A query function applied to a property, rather than a plain property path - `toUpper(companyName)`,
`toUpper(substring(companyName, 1, 2))`. Recognized by the parentheses and let through unchecked:
what is inside one is a small expression language of its own, not a property path.
*/
export type FunctionExpressionPath = `${string}(${string})`;

// ---------------------------------------------------------------------------------------------
// The object form
// ---------------------------------------------------------------------------------------------

/**
The operator clause of an object filter: `{ gt: 100 }`, `{ startsWith: 'C' }`, `{ in: [1, 2] }`.
Several operators in one clause are and-ed, which is what the runtime does with them.
*/
export type FilterOpsObject<T, V> = { [O in FilterOpNameFor<V>]?: FilterValueFor<T, V, O> };

/**
What may stand to the right of a property key in an object filter: a bare value, which means
equality, or an operator clause, or a {@link FilterValueExpression}.
*/
export type FilterClause<T, V> =
  | V | null
  | FilterValueExpression
  | FilterOpsObject<T, V>;

/** The keys an object filter on `T` may carry. */
type WhereKey<T> =
  | PropertyPath<T>
  | CollectionPath<T>
  | FunctionExpressionPath
  | 'and' | 'or' | 'not';

/**
The object - "JSON" - form of a filter, checked against `T`.

```ts
EntityQuery.from(Customer).where({ city: 'London', country: 'UK' });
EntityQuery.from(Order).where({ freight: { gt: 100 } });
EntityQuery.from(Order).where({ 'customer.companyName': { startsWith: 'A' } });
EntityQuery.from(Customer).where({ or: [{ city: 'London' }, { city: 'Berlin' }] });
EntityQuery.from(Customer).where({ orders: { any: { freight: { gt: 100 } } } });
```

Several keys in one object are and-ed, as the runtime does with them.

This deliberately enumerates the model's paths as keys rather than validating the object the
caller wrote. Both check the same mistakes, but only this shape makes a bad key an ordinary
excess-property error - which is the diagnostic that carries a spelling suggestion:

```
Object literal may only specify known properties, but 'compnyName' does not exist
in type '{ ... }'. Did you mean to write 'companyName'?
```

The cost is that the compiler prints that type in the message, so these are longer than the
errors from the three-argument form. It is the better trade: the suggestion names the fix.

`object` for an untyped query, which restricts nothing - see {@link PropertyPath}.
*/
export type WhereObject<T> =
  Entity extends T ? object
  : {
    [K in WhereKey<T>]?:
        K extends 'and' | 'or' ? readonly (Predicate | WhereObject<T>)[]
      : K extends 'not' ? Predicate | WhereObject<T>
      : K extends FunctionExpressionPath ? FilterClause<T, any>
      : K extends CollectionPath<T>
        ? { [Q in QuantifierOp]?: Predicate | WhereObject<CollectionElement<T, K>> }
      : FilterClause<T, PropertyValue<T, K>>
  };
