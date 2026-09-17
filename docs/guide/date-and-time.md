# Date and time

JavaScript has one date type. A `Date` is an instant in time, and it displays in the local
time zone. Servers have several date types. This page covers how Breeze maps them, where
time zones come in, the `Date` pitfalls that affect change tracking, and how to hold dates as
something other than a `Date` — a Luxon `DateTime`, say.

If you are here because a date arrived in your database a day earlier than you saved it, start
with ["The date I saved is a day earlier in the database"](#the-date-i-saved-is-a-day-earlier-in-the-database).
To hold dates as something other than a `Date`, see [Using another date library](#using-another-date-library).

## Date and time data types

| `DataType` | .NET type | Client value | Sent to the server as |
|---|---|---|---|
| `DateTime` | `DateTime` | `Date` | ISO 8601 in UTC: `2024-03-15T17:30:00.000Z` |
| `DateTimeOffset` | `DateTimeOffset` | `Date` | ISO 8601 in UTC |
| `DateOnly` | `DateOnly` | `Date` at local midnight | `2024-03-15` |
| `Time` | `TimeSpan` | ISO 8601 duration string: `PT4H30M` | unchanged |
| `TimeOnly` | `TimeOnly` | string: `14:30:00`, `01:23:45.678` | unchanged |

This applies to saves and to values in query predicates alike. A `Date` has no offset, so
the offset of a `DateTimeOffset` value is lost on the client. It goes back to the server in
UTC.

The EF Core server writes `TimeSpan` as the data type of a `TimeSpan` property. Breeze
reads that as `DataType.Time`.

## From server to client

Breeze converts `DateTime` and `DateTimeOffset` strings from the server with
`DataType.parseDateFromServer`. By default that is `DataType.parseDateAsUTC`, which works
like this:

| Server string | Read as |
|---|---|
| has `Z` or an offset: `2024-03-15T10:30:00Z`, `…10:30:00+02:00` | as given |
| no offset, ends in fractional seconds: `2024-03-15T10:30:00.000`, `…00.1234567` | UTC. Breeze appends `Z`. |
| no offset, no fractional seconds: `2024-03-15T10:30:00` | **local time**. The string goes to `Date.parse` unchanged. |

The last row is the trap. A .NET `DateTime` whose `Kind` is `Unspecified` is usually
serialized with no offset, and without the fractional part when it is zero. Values from the
same column can then be read differently depending on whether they happen to have
milliseconds.

There are two ways to avoid it. The first is to send UTC from the server, with `Z`
(`DateTimeKind.Utc`), or to use `DateTimeOffset`. The second is to replace the parser
before the first query:

```ts
import { DataType } from 'breeze-client';

// Treat every offset-less date-time from the server as UTC.
DataType.parseDateFromServer = (value: any) => {
  if (typeof value === 'string' && !/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    value += 'Z';
  }
  return new Date(value);
};
```

Breeze calls `parseDateFromServer` whenever it materializes a `DateTime` or
`DateTimeOffset` value from a query result, so the replacement applies to both types.

## DateOnly

A `DateOnly` value is a calendar date with no time.

- **From the server:** Breeze takes the first ten characters, `YYYY-MM-DD`, and makes a
  `Date` at local midnight on that day.
- **To the server:** saves and query predicates send `YYYY-MM-DD`, taken from the local
  year, month and day.
- **Change tracking** compares only the date. Assigning a different time on the same day
  is not a change.
- **Validation:** the data type's validator is the `date` validator, as for `DateTime`.

```ts
// Suppose Task.dueDate is a DateOnly property.
task.dueDate = new Date(2024, 2, 15);   // 15 March 2024
```

A string assigned to a `DateOnly` property is parsed as a local date, so `'2024-03-15'`
becomes midnight local time on that day. Assigning a `Date` is still the clearer choice.

## Time

`DataType.Time` holds a duration as an ISO 8601 duration string, such as `PT4H30M` or
`PT0S`, and not as a `Date`.

- The default for a non-nullable property is `PT0S`.
- The data type's validator rejects anything that isn't an ISO duration, such as `'3:15'`.
- Query with duration strings: `.where('maxTime', '>', 'PT4H')`.
- For arithmetic, `core.durationToSeconds(value)` converts a duration to a number of
  seconds.

## TimeOnly

`DataType.TimeOnly` holds a time of day as the string the server sends: `HH:mm:ss`, with
fractional seconds when there are any (`01:23:45.678`). It is not converted to a `Date`.

- The default for a non-nullable property is `00:00:00`.
- The data type's validator accepts `HH:mm`, `HH:mm:ss` and `HH:mm:ss.fffffff`. The server
  lists no validator for `TimeOnly` in its metadata, so add it yourself if you want it:
  `prop.validators.push(DataType.TimeOnly.validatorCtor!())`.
- Query with the same strings: `.where('timeOnly', '==', '01:23:45.678')`. Zero-padded
  strings like these sort in time order, so local `orderBy` works.

## New entities

In a new entity, a nullable date property starts as `null`. A non-nullable `DateTime`,
`DateTimeOffset` or `DateOnly` property starts at its data type's `defaultValue`, which is
1 January 1900 at local midnight, unless the metadata specifies a default.

To start with something else, such as the current time, either pass the value to
`createEntity`:

```ts
const order = em.createEntity(Order, { orderDate: new Date() });
```

or set it in a custom constructor. See [Extending entities](/guide/extending-entities).

## "The date I saved is a day earlier in the database"

This is the most-asked Breeze date question, and almost always nothing has gone wrong. The
symptom:

```
the client holds    2024-11-11T00:00:00+01:00
saveChanges() sends 2024-11-10T23:00:00.000Z
the database row is 2024-11-10
```

Those first two lines are **the same instant**, written for two different time zones. Three
facts produce the surprise together:

1. A JavaScript `Date` is a number of milliseconds since 1 January 1970 UTC. It carries no zone
   of its own; your browser *formats* it in the local zone, which is why it looked like
   `+01:00`.
2. What crosses the wire is always an ISO 8601 serialization of that instant, in UTC. The
   formatting differs at each end; the instant does not.
3. A SQL `date` or `datetime2` column has no zone either. It stores whatever calendar day the
   serialized form carried — UTC's — so local midnight in UTC+1 lands on the previous day.

> Breeze does NOT change the dates in any way, except in the case of dates sent from the server
> without a timezone offset. […] The timezone of the server is only relevant to the formatting
> of a date, not to its actual value.
>
> — Jay Traband, [Dates/datetimes in breeze set timeszone 0:00 on SQL Server](https://stackoverflow.com/questions/20197308/dates-datetimes-in-breeze-set-timeszone-000-on-sql-server)

So nothing is lost, and reading the row back gives the instant you saved. What is wrong is the
*intent*: you stored an instant where you meant a date, or the other way round.

### What to do about it

**If you meant a calendar date** — a birth date, a due date, an invoice date — then the zone was
never meaningful and carrying one is the bug, not the symptom. Use `DateOnly` on the server and
a `date` column; Breeze reads it as a `Date` at local midnight and sends back `YYYY-MM-DD` with
no time and no zone, so there is nothing left to shift. See [DateOnly](#dateonly). This is the
real fix for the case above, and it is what .NET's `DateOnly` and SQL's `date` exist for.

**If you meant an instant**, keep UTC in the database — a `datetimeoffset` column, or a
`DateTime` whose `Kind` is `Utc` — and format for display at the edge of your UI. Do not try to
store local time; the offset is not recoverable later, least of all across a daylight-saving
change.

**If you want the client to read what the server wrote, zone and all ignored** — every value
comes back showing the wall clock the server sent — replace the inbound parser:

```ts
import { DataType } from 'breeze-client';

DataType.parseDateFromServer = DataType.parseDateAsLocal;
```

::: warning This changes only the inbound direction
Saves still send UTC. A one-sided change is what produces steady drift: read as local, write as
UTC, read back shifted again. If you change one end, change the other to match.
:::

### The server side

Breeze.NET serializes with Json.NET, whose `DateTimeZoneHandling` defaults to `RoundtripKind` —
a `DateTime` goes out as its `Kind` says, and an `Unspecified` one goes out with no offset at
all, which is the case [From server to client](#from-server-to-client) is about. To change it,
derive from `BreezeConfig` and override `CreateJsonSerializerSettings`:

```csharp
public class CustomBreezeConfig : Breeze.Persistence.BreezeConfig {
  protected override JsonSerializerSettings CreateJsonSerializerSettings() {
    var settings = base.CreateJsonSerializerSettings();
    settings.DateTimeZoneHandling = DateTimeZoneHandling.Utc;
    return settings;
  }
}
```

Nothing registers it: Breeze scans the loaded assemblies for a subclass of `BreezeConfig` and
uses the one it finds. Exactly one may be defined.

The simplest arrangement, and the one that needs no client-side change at all, is for every
`DateTime` the server sends to be `Utc` or to be a `DateTimeOffset`. Then every string carries a
zone, and the offset-less rule never comes up.

::: tip Copying the code in that StackOverflow answer?
It predates v3 in two places. The client method is `DataType.parseDateAsUTC`, not
`parseDatesAsUTC`, and the whole "parse as local" body it writes out by hand is now
`DataType.parseDateAsLocal` — which recomputes the offset per value, so it stays right on both
sides of a daylight-saving change. On the server, the base class moved from `Breeze.WebApi` to
`Breeze.Persistence`.
:::


## Date pitfalls

### Changing part of a date is invisible to Breeze

`Date` objects are mutable, and Breeze can't see changes made inside one. Only assigning a
new value to the property counts:

```ts
const d = order.orderDate;
d.setDate(d.getDate() + 1);
// The entity's own Date has changed, but it is still Unchanged.
// A save will not include it.
```

Copy the date, change the copy, then assign it:

```ts
const d = new Date(order.orderDate);
d.setDate(d.getDate() + 1);
order.orderDate = d;   // now Modified
```

The order matters. If you mutate first and then assign a copy, the entity's `Date` already
holds the new value, so the assignment looks like no change and the state stays
`Unchanged`.

### Compare with `getTime()`

`===` on two `Date` objects compares identity, not value:

```ts
new Date(2024, 0, 1) === new Date(2024, 0, 1);                       // false
new Date(2024, 0, 1).getTime() === new Date(2024, 0, 1).getTime();   // true
```

Breeze compares dates by value itself. Change tracking ignores an assignment of an equal
date, and `==` on a date in a local query matches equal values.

### Strings are converted

Assigning a string to a `DateTime` or `DateTimeOffset` property converts it with
`Date.parse`. So `'2024-06-01T00:00:00Z'` becomes a `Date`, and an offset-less string is
read as local time, following `Date.parse`'s rules rather than `parseDateFromServer`.

### The `Date` API

- Months are zero-based: `new Date(2024, 0, 1)` is 1 January.
- `getDate()` is the day of the month. `getDay()` is the day of the week.
- `Date()` without `new` returns a string, not a `Date`.

---

## Using another date library

Breeze holds `DateTime`, `DateTimeOffset` and `DateOnly` values as JavaScript `Date` objects.
To hold something else instead — a Luxon `DateTime`, a `Temporal.Instant`, a `UTCDate` from
`date-fns` — you do not subclass anything or write an adapter. You replace a fixed set of hooks
on the `DataType`, and Breeze uses your type everywhere it would have used a `Date`.

The whole list is below. It is short, but leaving one out is the usual reason a swap half-works,
and one of them fails *silently*. Each hook is pinned by a test in
`test/unit/date-shim.spec.ts`; if Breeze grows another one, that file fails.

### The hooks

Set these once at startup, before importing metadata or creating an `EntityManager`.
`DataType.DateTime` and the rest are global singletons, so this affects every `MetadataStore` in
the application.

| Hook | When Breeze calls it | What it must do |
|---|---|---|
| `DataType.<T>.parseRawValue(val)` | materializing a query result | turn the server's string into your type |
| `DataType.<T>.parse(source, sourceTypeName)` | assigning a value to a property | convert a string or number; pass your type through |
| `DataType.<T>.normalize(value)` | **every** change-tracking comparison, and local queries | return a primitive that compares with `===` |
| `DataType.<T>.defaultValue` | a new entity's non-nullable property, when the metadata names no default | a value of your type |
| `DataType.<T>.validatorCtor` | building a type in code rather than importing it | a `Validator` that accepts your type |
| `Validator.registerFactory(fn, 'date')` | `importMetadata`, for each `{ "name": "date" }` in the metadata | as above |
| `yourType.toJSON()` | saving, and serializing a query | an ISO 8601 string |
| `DataType.toDateOnlyString(val)` | saving or querying a `DateOnly` | a `YYYY-MM-DD` string |

`<T>` is each of `DataType.DateTime` and `DataType.DateTimeOffset`, plus `DataType.DateOnly` if
you use it.

### With Luxon

Luxon needs less than most, because `DateTime.toJSON()` already returns ISO 8601 — which is what
`JSON.stringify` calls when Breeze serializes a save or a query. The outbound half is free.

```ts
import { DataType, Validator } from 'breeze-client';
import { DateTime } from 'luxon';

const isLuxon = (v: unknown): v is DateTime => DateTime.isDateTime(v);

// Accepts a Luxon DateTime where the stock 'date' validator accepts only a Date.
const luxonDateValidator = (context?: any) => new Validator(
  'date',
  (v: any) => v == null || isLuxon(v) || (v instanceof Date && !isNaN(v.getTime())),
  context);

// Metadata names its validators - { "name": "date" } - and importMetadata resolves each name
// through this registry. It has to be registered BEFORE the metadata is imported.
Validator.registerFactory(luxonDateValidator, 'date');

for (const dt of [DataType.DateTime, DataType.DateTimeOffset]) {
  // Server to client. Going through parseDateFromServer rather than DateTime.fromISO is what
  // keeps the rules above: Luxon would read an offset-less string as local time.
  dt.parseRawValue = (val: any) =>
    isLuxon(val) ? val : DateTime.fromJSDate(DataType.parseDateFromServer(val));

  // Assignment. A string or a number is converted; anything else is passed through.
  dt.parse = (source: any, sourceTypeName: string) =>
    sourceTypeName === 'string' ? DateTime.fromISO(source)
      : sourceTypeName === 'number' ? DateTime.fromMillis(source)
        : source;

  // Comparison. See the warning below.
  dt.normalize = (value: any) => isLuxon(value) ? value.toMillis() : value;

  dt.defaultValue = DateTime.fromMillis(Date.UTC(1900, 0, 1));
  dt.validatorCtor = luxonDateValidator;
}
```

That is the whole shim. Queries materialize Luxon objects, assignments accept them, change
tracking works, and a save sends the ISO string the server expects.

### `normalize` is the one that fails silently

::: danger Get `normalize` wrong and nothing reports it
`normalize` is how Breeze decides whether an assignment changed anything. The stock one for
`DateTime` is:

```ts
value => value && value.getTime && value.getTime()
```

A Luxon `DateTime` has no `getTime`, so that returns `undefined` for **every** value. Both sides
of every comparison are then `undefined`, so every assignment looks like a no-op: the entity
stays `Unchanged`, `hasChanges()` stays `false`, and the save sends nothing. No error is raised
anywhere.

Local queries compare with `normalize` too, so a `where` on a date silently matches nothing.
:::

`normalize` runs on every property assignment, so keep it cheap — `toMillis()` is fine, building
an intermediate object is not.

### Validators have to be registered first

Imported metadata names its validators rather than carrying them, so `importMetadata` looks each
name up in the registry and instantiates it *then*. Registering your `date` factory after a
`MetadataStore` has imported metadata leaves that store with the stock validator, and the first
save of a changed date rejects with:

```
Client side validation errors encountered - see the entityErrors collection on this object for more detail
```

This one at least fails loudly, and at save time rather than on assignment.

### Predicates take a `Date`

Predicate values are not run through `DataType.parse`. Breeze decides whether an object is a
literal by looking for `toISOString`, which a `Date` has and a Luxon `DateTime` does not:

```ts
// throws "Unable to resolve an expression for: ..." when the query runs
EntityQuery.from('Orders').where('orderDate', '>', cutoff);

// pass a Date
EntityQuery.from('Orders').where('orderDate', '>', cutoff.toJSDate());
```

The predicate is not resolved until the query runs, so the error appears at `executeQuery` or
`executeQueryLocally`, not at `where`.

### `DateOnly`, `Time` and `TimeOnly`

`DateOnly` is the one date type Breeze serializes by hand instead of leaving to
`JSON.stringify`, because an ISO instant would carry a time the server rejects. Both outbound
paths — the save adapter and predicate serialization — go through one function, so a `DateOnly`
shim needs that as well as the hooks above:

```ts
const toDateOnly = DataType.toDateOnlyString;
DataType.toDateOnlyString = (val: any) =>
  isLuxon(val) ? val.toISODate() : toDateOnly(val);
```

`Time` and `TimeOnly` are already strings on the client — an ISO 8601 duration and `HH:mm:ss`
respectively — so there is nothing to convert unless you want them held as a `Duration` or a
`Temporal.PlainTime`. Those take the same hooks, minus `parseDateFromServer`.

### What you do not have to change

- **No adapter changes.** The data service, uri builder and ajax adapters never see a date as
  anything but the value your `toJSON` produced.
- **No change to the save payload**, as long as your type has a `toJSON` returning ISO 8601.
  `JSON.stringify` calls it.
- **No change to the metadata or the server.** The wire format is the same either way; this is
  only about what the client holds in memory.

One thing to watch outside the entity model: `withParameters` values go into the query string
through a `toISOString()` check, so pass a `Date` there too.
