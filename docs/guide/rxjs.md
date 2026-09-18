# RxJS

Breeze reports changes through its own events — `entityChanged`, `hasChangesChanged`,
`propertyChanged` and the rest, described in [Change tracking](/guide/change-tracking). If your
application is built on RxJS, as an Angular application usually is, `breeze-client/rxjs` gives you
the same events as observables, so they compose with the rest of your streams and tear down the way
the rest of your subscriptions do.

It is one of Breeze's [optional extensions](/guide/extensions): nothing changes until you
import it.

## Installing

`breeze-client` does not depend on RxJS, and installing it never installs RxJS. If you want the
observables, install RxJS yourself — you almost certainly already have it — and import from the
subpath:

```bash
npm install rxjs
```

```ts
import { entityChanged$, hasChanges$ } from 'breeze-client/rxjs';
```

Any RxJS from 7.0 on works. `breeze-client` declares it as an *optional* peer dependency, which is
what keeps it out of everyone else's `node_modules`: npm 7 and later install an ordinary peer
dependency automatically.

Applications that never import `breeze-client/rxjs` get none of it — no RxJS in the bundle and none
in the install. The test suite checks that nothing reachable from `breeze-client` imports RxJS, even
for a type, so that stays true.

## What is in it

| Function | Emits |
|---|---|
| [`hasChanges$(em)`](/api/functions/hasChanges$) | whether `em` has unsaved changes — **the current value first**, then each change |
| [`entityChanged$(em)`](/api/functions/entityChanged$) | every entity attached, detached, changed, saved or rejected in `em` |
| [`validationErrorsChanged$(em)`](/api/functions/validationErrorsChanged$) | validation errors added to or removed from any entity in `em` |
| [`propertyChanged$(entity)`](/api/functions/propertyChanged$) | each property of one entity that changes |
| [`fromBreezeEvent(event)`](/api/functions/fromBreezeEvent) | anything any `BreezeEvent` publishes — the others are this, applied to one event |

`fromBreezeEvent` covers the events the others do not, such as
`fromBreezeEvent(em.metadataStore.metadataFetched)`.

## A Save button

`hasChangesChanged` fires only when the answer changes, so on its own it cannot tell a component
that subscribes late whether the manager is dirty *now*. `hasChanges$` emits the current value as
soon as you subscribe, then each change, and never the same value twice in a row:

```ts
@Component({
  template: `<button [disabled]="!(dirty$ | async)" (click)="save()">Save</button>`,
})
export class OrderEditor {
  readonly dirty$ = hasChanges$(this.em);
  constructor(private em: EntityManager) {}
  save() { return this.em.saveChanges(); }
}
```

The current value is read when you subscribe, not when you call `hasChanges$`, so creating it in a
field initializer, as above, is fine.

## Filtering entity changes

`entityChanged$` is every change to every entity. Narrow it with RxJS as usual:

```ts
import { filter } from 'rxjs';
import { EntityAction } from 'breeze-client';

// orders the user edits, as they edit them
entityChanged$(em).pipe(
  filter(e => e.entityAction === EntityAction.PropertyChange),
  filter(e => e.entity?.entityType.shortName === 'Order'),
).subscribe(e => markRowDirty(e.entity));
```

For one entity, `propertyChanged$` is cheaper — it is subscribed to that entity alone rather than
to the whole manager:

```ts
propertyChanged$(order).pipe(
  filter(e => e.propertyName === 'shipCountry'),
).subscribe(() => recalculateTax(order));
```

The [change tracking](/guide/change-tracking#entitymanager-entitychanged) page lists every
`EntityAction` and the order they arrive in.

## Every validation error, kept current

A common need — and the one a hand-written unit-of-work usually builds a `BehaviorSubject` for — is
the complete list of validation errors on unsaved entities, for a summary panel or to disable
saving. `validationErrorsChanged$` reports what *changed*, not the whole set, so combine it with
`hasChanges$` and recompute:

```ts
import { map, merge } from 'rxjs';
import { hasChanges$, validationErrorsChanged$ } from 'breeze-client/rxjs';

export function allValidationErrors$(em: EntityManager) {
  return merge(validationErrorsChanged$(em), hasChanges$(em)).pipe(
    map(() => em.getChanges().flatMap(e => e.entityAspect.getValidationErrors())),
  );
}
```

Because `hasChanges$` emits straight away, so does this: a component gets the current list on
subscribing, not an empty one until something happens. When the manager has no changes left —
after a save, or `rejectChanges` — the list is empty. Errors on entities with no changes are left
out, which is usually what you want; drop the `getChanges()` for `getEntities()` if it is not.

## Unsubscribing

**Every one of these subscribes to a Breeze event, and a Breeze event holds on to its
subscribers.** A subscription you never end keeps its callback — and everything the callback can
reach — for as long as the manager or entity it is on. For a manager that lives as long as the
application, that is as long as the application.

So end them the way you end any subscription:

```ts
// Angular 16 and later. takeUntilDestroyed() with no argument needs an injection context -
// a constructor or field initializer - or pass it a DestroyRef.
constructor(private em: EntityManager) {
  entityChanged$(em).pipe(takeUntilDestroyed()).subscribe(e => this.onChange(e));
}

// earlier
private destroyed = new Subject<void>();
ngOnInit()    { entityChanged$(this.em).pipe(takeUntil(this.destroyed)).subscribe(e => this.onChange(e)); }
ngOnDestroy() { this.destroyed.next(); }
```

The `async` pipe does this for you, which is one reason to prefer it.

Ending the subscription removes the Breeze subscription with it — `unsubscribe()`, `take`,
`takeUntil` and `first` all do, as does an error or completion. Keeping the `Subscription` object
in a field afterwards holds nothing.

Nothing is subscribed until you subscribe: calling `entityChanged$(em)` only describes what to
observe. Each subscription is independent, so ten components subscribing to `hasChanges$` means ten
Breeze subscriptions, each removed when its own component goes.

### Sharing one subscription

To have many subscribers share one Breeze subscription, use `shareReplay` — **with `refCount`**:

```ts
readonly dirty$ = hasChanges$(this.em).pipe(shareReplay({ bufferSize: 1, refCount: true }));
```

::: danger `shareReplay(1)` never lets go
Without `refCount: true`, `shareReplay` keeps its own subscription to the source after every
subscriber has left, and so keeps the Breeze subscription — for good. It is the usual way an
RxJS wrapper leaks, and it looks exactly like the correct version.
:::

## From a hand-written unit of work

If your application wraps its `EntityManager` in a service that re-publishes Breeze events through
Subjects, the observables replace most of that:

```ts
// before: a Subject per event, fed by hand, never unsubscribed
private hasChangesSubject = new BehaviorSubject<boolean>(false);
constructor() {
  this.manager.hasChangesChanged.subscribe(e => this.hasChangesSubject.next(e.hasChanges));
}
get hasChangesObservable() { return this.hasChangesSubject.asObservable(); }

// after
readonly hasChanges$ = hasChanges$(this.manager);
```

The differences are worth knowing before you swap one for the other:

- **The starting value is the real one.** A `BehaviorSubject(false)` starts at `false` whatever the
  manager holds; `hasChanges$` asks the manager.
- **Nothing is left subscribed.** The Subject version subscribes to Breeze once, forever, which is
  only harmless while the service lives exactly as long as the manager.
- **It is cold.** Each subscriber gets its own Breeze subscription. Add
  `shareReplay({ bufferSize: 1, refCount: true })` if you want the Subject's single one back.
- **Errors stay in RxJS.** A subscriber that throws is reported through RxJS's
  `config.onUnhandledError`, the same as any other observable; it does not interrupt Breeze or stop
  the event's other subscribers. There is no need to wrap each handler in a `try`.

Events Breeze does not have — "a save finished, here is everything in it" — are still yours to
publish, from where you call `saveChanges`.

## Timing

Emissions are synchronous: an observable emits while Breeze is raising the event, exactly as a
plain `subscribe` callback would run.

**During a query, `entityChanged$` emits once per entity, as that entity is merged** — an
`AttachOnQuery` for a new one, a `MergeOnQuery` for one already cached. `em.isLoading` is `true`
throughout, and the rows after the current one are not in the cache yet: a subscriber that reads
`em.getEntities()` from inside the handler sees a partial result. React to the whole result from the
query's own promise instead, or skip the emissions a load produces:

```ts
entityChanged$(em).pipe(
  filter(() => !em.isLoading),        // user edits only, not rows arriving from a query
).subscribe(e => markRowDirty(e.entity));
```

If you need to leave Breeze's call stack before reacting at all, add `observeOn(asyncScheduler)`.
