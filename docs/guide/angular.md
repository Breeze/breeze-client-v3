# Angular

Breeze 3 needs nothing Angular-specific. There is no adapter to install or register: it makes its
requests with `fetch`, holds entities as plain objects, and returns native promises. This page is
about fitting it into an Angular application well — where the `MetadataStore` and the managers
live, how change detection sees an entity change, how requests get their auth header, and what to
unsubscribe.

## Configure once, before bootstrap

Call `configureBreeze` before `bootstrapApplication`, or in an app initializer if it needs something
from DI (see [the auth header](#requests-and-the-auth-header) below):

```ts
// main.ts
import { configureBreeze } from 'breeze-client';

configureBreeze({ /* fetch, namingConvention, ... */ });
bootstrapApplication(AppComponent, appConfig);
```

Much of what an older Breeze + Angular setup did at startup is now the default and can be deleted:
`NamingConvention.camelCase.setAsDefault()`, and `config.initializeAdapterInstance(...)` for the
JSON URI builder, the Web API data service and the model library. See
[Configuration](/guide/configuration).

## One MetadataStore, many managers

The `MetadataStore` is shared, long-lived and read-only once loaded, so it belongs in a root
service. Managers are cheap, and each should hold one piece of work.

```ts
import { Injectable } from '@angular/core';
import { EntityManager, MetadataStore } from 'breeze-client';
import metadata from './metadata.json';                       // generated from the server
import { registerModelClasses } from './model';                // written by the class generator

@Injectable({ providedIn: 'root' })
export class BreezeService {
  readonly metadataStore = new MetadataStore();
  private readonly master: EntityManager;

  constructor() {
    this.metadataStore.importMetadata(metadata);
    registerModelClasses(this.metadataStore);
    this.master = new EntityManager({ serviceName: '/breeze/Northwind', metadataStore: this.metadataStore });
  }

  /** A new, empty manager with the same settings and the same store. */
  newManager(): EntityManager {
    return this.master.createEmptyCopy();
  }
}
```

**Bundling the metadata**, as above, means no round trip before the first screen — the JSON is part
of the build. To fetch it from the server instead, do that before the application starts:

```ts
// app.config.ts
provideAppInitializer(() => inject(BreezeService).loadMetadata()),   // Angular 19+; APP_INITIALIZER before
```

where `loadMetadata()` returns `this.metadataStore.fetchMetadata(serviceName)`.

### A manager per screen

Angular's injector hierarchy fits Breeze's unit of work well. Provide an `EntityManager` on the
component that owns a piece of work, and everything beneath it shares that manager:

```ts
@Component({
  selector: 'app-order-editor',
  providers: [{ provide: EntityManager, useFactory: () => inject(BreezeService).newManager() }],
  templateUrl: './order-editor.html',
})
export class OrderEditor {
  private readonly em = inject(EntityManager);
  // child components that inject(EntityManager) get this same one
}
```

Its changes are isolated from every other screen until you save them, cancelling is
`em.rejectChanges()` — or simply leaving — and when the component is destroyed the manager and
its entities are released. That last point is checked: `test/retention/` asserts that a dropped
manager is collected even while another shares its `MetadataStore`.

## Binding to entities

Entities have plain properties, so templates read them directly and `ngModel` writes to them:

```html
<input [(ngModel)]="order.shipName" name="shipName">
@for (error of order.entityAspect.getValidationErrors('shipName'); track error.key) {
  <span class="error">{{ error.errorMessage }}</span>
}
```

Setting a property through `ngModel` is an ordinary assignment: the entity becomes `Modified`,
the value is validated, and `hasChanges()` turns true.

**Reactive forms** keep a second copy of the values in their `FormControl`s, which you then have to
copy back to the entity and keep in step with it. Binding to the entity directly avoids that; if you
use reactive forms, write the form's value to the entity on submit and treat the entity as the one
that is saved.

## Change detection

**With zone.js**, nothing extra is needed. Breeze's work completes in `fetch` and promise callbacks
that zone.js tracks, and your own edits happen in event handlers, so views update.

**Zoneless, or `OnPush`**, Angular is not told when an entity changes: assigning
`order.shipName = 'x'` is an ordinary property write, and nothing marks the view for checking.
Tell it, with the [RxJS extension](/guide/rxjs):

```ts
import { ChangeDetectorRef, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { entityChanged$, hasChanges$ } from 'breeze-client/rxjs';

export class OrderEditor {
  private readonly em = inject(EntityManager);

  // A signal of "is there anything to save". requireSync is safe: hasChanges$ emits the current
  // value the moment it is subscribed to.
  readonly dirty = toSignal(hasChanges$(this.em), { requireSync: true });

  constructor() {
    // Re-check this view whenever any entity in its manager changes.
    const cdr = inject(ChangeDetectorRef);
    entityChanged$(this.em).pipe(takeUntilDestroyed()).subscribe(() => cdr.markForCheck());
  }
}
```

```html
<button [disabled]="!dirty()" (click)="save()">Save</button>
```

`markForCheck` works with and without zone.js, so the same component is correct either way.

## Requests and the auth header

**Angular's `HttpClient` interceptors do not see Breeze's requests** — Breeze calls `fetch`, not
`HttpClient`. An auth interceptor that works for the rest of the application does nothing for
Breeze. There are two ways to handle that.

**Give Breeze its own `fetch`** that adds the header. Do it in an app initializer so it can reach
your auth service:

```ts
provideAppInitializer(() => {
  const auth = inject(AuthService);
  configureBreeze({
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${auth.token()}` },
    }),
  });
}),
```

The token is read on every request, so a refreshed token is picked up without reconfiguring.

**Or route Breeze through `HttpClient`**, so that your interceptors, and `HttpTestingController` in
tests, see its requests. The [Angular HttpClient](/guide/extensions#angular-httpclient) extension
does it:

```ts
import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';

provideAppInitializer(() => { configureBreeze({ fetch: httpClientFetch(inject(HttpClient)) }); }),
```

Your auth interceptor then adds the header to Breeze's requests as it does to every other one.

::: tip Why not write it yourself
It is a dozen lines, but one detail is easy to miss. When the server answers with a 4xx or 5xx
status, `fetch` still returns the response, but `HttpClient` throws an `HttpErrorResponse`
instead. A wrapper that lets that error through makes a save the server rejected look to Breeze
like a request that never reached the server: status 0, no body. The `entityErrors` never arrive,
and a 409 is not recognised as a concurrency conflict. `httpClientFetch` catches the error and
hands Breeze the real status, body and headers, and its tests check both that and the failure it
prevents.
:::

### Coming from 2.x's `AjaxHttpClientAdapter`

Breeze 2.x shipped an ajax adapter over `HttpClient`, `breeze-client/adapter-ajax-httpclient`, and
an Angular application usually registered it alongside the other adapters at startup:

```ts
// Breeze 2.x
constructor(http: HttpClient) {
  ModelLibraryBackingStoreAdapter.register();
  UriBuilderJsonAdapter.register();
  AjaxHttpClientAdapter.register(http);
  DataServiceWebApiAdapter.register();
}
```

Breeze 3 has no module by that name, so the import fails. All four lines become one: the other
three adapters are Breeze 3's defaults and need no registering, and
`breeze-client/adapter-angular-httpclient` takes the ajax adapter's place:

```ts
// Breeze 3
import { httpClientFetch } from 'breeze-client/adapter-angular-httpclient';

constructor(http: HttpClient) {
  configureBreeze({ fetch: httpClientFetch(http) });
}
```

`httpClientFetch` does what the 2.x adapter did with an error response — hands Breeze the status,
body and headers rather than a bare failure. What the adapter also carried, `defaultSettings`
headers and a `requestInterceptor`, is now simply code inside the fetch function.

## Unsubscribing

A Breeze event holds its subscribers, so a subscription you never end keeps its callback — and
the component the callback belongs to — alive as long as the manager is. With the RxJS extension,
end subscriptions the Angular way: `takeUntilDestroyed()`, as above, or the `async` pipe. With a
plain `subscribe`, keep the token and unsubscribe when the component goes:

```ts
const token = this.em.entityChanged.subscribe(handler);
inject(DestroyRef).onDestroy(() => this.em.entityChanged.unsubscribe(token));
```

A manager provided on a component, as [above](#a-manager-per-screen), goes with that component,
and so do subscriptions to its own events.

## Testing

Replace the transport in the test, with no server and no `HttpClient`:

```ts
beforeEach(() => {
  configureBreeze({
    fetch: async () => new Response(JSON.stringify([{ $type: 'Order:#Northwind', OrderID: 1 }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  });
});
```

If you route Breeze through `HttpClient`, use `HttpTestingController` as you would for any other
request. [Stubbing in tests](/server/transport#stubbing-in-tests) has more.

## See also

- [RxJS](/guide/rxjs) — every Breeze event as an observable, and how not to leak them
- [Supplying your own transport](/server/transport) — `configureBreeze({ fetch })` in general
- [Generating entity classes](/guide/generating-entities) — typed classes for your templates
- [React](/guide/react) — the same questions, answered for React
