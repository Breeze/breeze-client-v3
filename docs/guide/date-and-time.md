# Date and time

JavaScript has one date type. A `Date` is an instant in time, and it displays in the local
time zone. Servers have several date types. This page covers how Breeze maps them, where
time zones come in, and the `Date` pitfalls that affect change tracking.

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
task.setProperty('dueDate', new Date(2024, 2, 15));   // 15 March 2024
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
const order = em.createEntity('Order', { orderDate: new Date() });
```

or set it in a custom constructor. See [Extending entities](/guide/extending-entities).

## Date pitfalls

### Changing part of a date is invisible to Breeze

`Date` objects are mutable, and Breeze can't see changes made inside one. Only assigning a
new value to the property counts:

```ts
const d = order.getProperty('orderDate') as Date;
d.setDate(d.getDate() + 1);
// The entity's own Date has changed, but it is still Unchanged.
// A save will not include it.
```

Copy the date, change the copy, then assign it:

```ts
const d = new Date(order.getProperty('orderDate'));
d.setDate(d.getDate() + 1);
order.setProperty('orderDate', d);   // now Modified
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
