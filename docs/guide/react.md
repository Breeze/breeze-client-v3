# React

Breeze 3 needs nothing React-specific: it makes its requests with `fetch`, holds entities as plain
objects, and returns native promises. What React does need is to be told when an entity changes,
because Breeze entities are **mutable** — `order.shipName = 'x'` changes the object in place, and
React re-renders on new state, not on a mutation. Most of this page is that one idea.

## Configure once, before rendering

```tsx
// main.tsx
import { configureBreeze } from 'breeze-client';

configureBreeze({ /* fetch, namingConvention, ... */ });
createRoot(document.getElementById('root')!).render(<App />);
```

## One MetadataStore, managers passed down by context

The `MetadataStore` is shared and read-only once loaded. Import it at module scope — bundling the
metadata JSON means no round trip before the first render:

```ts
// breeze.ts
import { EntityManager, EntityQuery, MetadataStore } from 'breeze-client';
import metadata from './metadata.json';            // generated from the server
import { registerModelClasses } from './model';     // written by the class generator

export const metadataStore = new MetadataStore();
metadataStore.importMetadata(metadata);
registerModelClasses(metadataStore);

const master = new EntityManager({ serviceName: '/breeze/Northwind', metadataStore });
let referenceData: object | undefined;

/** The lookup tables, once, before the first render - see below. */
export async function loadReferenceData() {
  const resources = ['Categories', 'Regions', 'Territories'];
  await Promise.all(resources.map(r => master.executeQuery(EntityQuery.from(r))));
  referenceData = master.exportEntities(undefined, { includeMetadata: false, asString: false });
  master.clear();
}

/** A new manager with the reference data already in its cache. */
export function newManager() {
  const em = master.createEmptyCopy();
  if (referenceData) em.importEntities(referenceData);
  return em;
}
```

**Reference data** - the small lookup tables many screens need - is loaded once, and every manager
`newManager()` makes starts with a copy in its cache, so no screen queries it again:

```tsx
// main.tsx
await loadReferenceData();
createRoot(document.getElementById('root')!).render(<App />);
```

[Reference data across pages](/guide/entitymanager-and-caching#reference-data-across-pages) explains
why a copy per manager, rather than one manager kept for the whole session.

Pass managers down with context rather than importing one global, so a screen can have its own:

```tsx
import { createContext, useContext, useState } from 'react';
import type { EntityManager } from 'breeze-client';

const EntityManagerContext = createContext<EntityManager | null>(null);

export function useEntityManager(): EntityManager {
  const em = useContext(EntityManagerContext);
  if (!em) throw new Error('useEntityManager needs an <EntityManagerContext.Provider> above it');
  return em;
}

/** A screen with its own manager: its changes stay here until saved, and go with it. */
export function EditScope({ children }: { children: React.ReactNode }) {
  // newManager() rather than a copy of the manager above: it brings the reference data with it.
  const [em] = useState(newManager);
  return <EntityManagerContext.Provider value={em}>{children}</EntityManagerContext.Provider>;
}
```

`useState` with an initializer creates the manager once for the life of the component. When the
component unmounts, the manager and its entities are released — `test/retention/` checks that a
dropped manager is collected even while another shares its `MetadataStore`.

## Re-rendering when an entity changes

React's tool for state that lives outside React is `useSyncExternalStore`: give it a `subscribe`
function and a `getSnapshot` function, and it re-renders the component when the snapshot changes.
Breeze's events are exactly what `subscribe` needs. These three stores cover what components
usually watch — they import nothing from React:

<<< @/snippets/breeze-react-stores.ts

The hooks are thin wrappers. `useMemo` keeps each store — and its `subscribe` function — the same
object from render to render, which `useSyncExternalStore` relies on:

```ts
// breeze-hooks.ts
import { useMemo, useSyncExternalStore } from 'react';
import type { Entity, EntityManager } from 'breeze-client';
import { entitiesStore, entityStore, hasChangesStore } from './breeze-react-stores';

/** Whether `em` has unsaved changes. */
export function useHasChanges(em: EntityManager): boolean {
  const store = useMemo(() => hasChangesStore(em), [em]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Re-render when anything about `entity` changes; returns the entity for convenience. */
export function useEntity<T extends Entity>(entity: T): T {
  const store = useMemo(() => entityStore(entity), [entity]);
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return entity;
}

/** The cached, not-deleted entities of one type. */
export function useEntities<T extends Entity>(em: EntityManager, type: new () => T): T[] {
  const store = useMemo(() => entitiesStore(em, type), [em, type]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
```

::: warning `getSnapshot` must return the same value until something changes
`useSyncExternalStore` compares snapshots with `Object.is`. `em.getEntities()` builds a new array on
every call, so returning it directly looks like a change on every render and React re-renders
without end — it warns *"The result of getSnapshot should be cached"*. `entitiesStore` keeps its
array until the list's membership changes, and a test holds it to that.
:::

The stores are tested as written: `test/unit/react-stores.spec.ts` runs this exact file, including
the case that is easiest to miss — `useEntity` re-renders when a failed `validateEntity()` adds
errors, even though no property changed, so a form can show why a save was refused.

## A form

The entity *is* the state. There is no `useState` copy to keep in step with it and no "apply" step:
typing writes straight to the entity, which makes it `Modified` and validates the new value, and
`useEntity` re-renders the component to show both.

```tsx
function OrderForm({ order }: { order: Order }) {
  useEntity(order);
  const errors = order.entityAspect.getValidationErrors('shipName');
  return (
    <label>
      Ship to
      <input value={order.shipName ?? ''} onChange={e => { order.shipName = e.target.value; }} />
      {errors.map(err => <span key={err.key} className="error">{err.errorMessage}</span>)}
    </label>
  );
}

function SaveButton() {
  const em = useEntityManager();
  const dirty = useHasChanges(em);
  return <button disabled={!dirty} onClick={() => em.saveChanges()}>Save</button>;
}
```

`value={order.shipName ?? ''}` keeps the input controlled when the property is `null`.

## Loading data

A query merges its results into the manager's cache, so a component that shows "the orders in
this manager" can render from the cache with `useEntities` and never hold the results itself:

```tsx
function OrderList() {
  const em = useEntityManager();
  const orders = useEntities(em, Order);

  useEffect(() => {
    em.executeQuery(EntityQuery.from(Order).where('shipCountry', '==', 'Norway'))
      .catch(showError);
  }, [em]);

  return <ul>{orders.map(o => <OrderRow key={o.orderID} order={o} />)}</ul>;
}
```

Each row calls `useEntity(order)` for its own values, so editing one order re-renders that row,
not the list.

When a component does keep the results — the rows of one particular query, say — guard against
setting state after it has unmounted. Breeze queries cannot be cancelled, so the usual flag is the
way; the query still completes and its entities still land in the cache, which is what you want:

```tsx
useEffect(() => {
  let current = true;
  em.executeQuery(query).then(qr => { if (current) setRows(qr.results); });
  return () => { current = false; };
}, [em, query]);
```

In development, `StrictMode` runs effects twice. The query simply runs twice and merges the same
rows twice; the stores subscribe and unsubscribe cleanly, as `useSyncExternalStore` expects.

## Server rendering

An `EntityManager` is one user's working state, so it belongs in the browser. In a framework that
renders on the server — Next.js, Remix — keep Breeze in client components (`'use client'`), and
never create a manager at module scope in code that also runs on the server: one module-level
manager there would be shared by every request, and every user.

## Requests and the auth header

Give Breeze a `fetch` that adds the header. Read the token inside it, so a refreshed token is
picked up without reconfiguring:

```ts
configureBreeze({
  fetch: (input, init) => fetch(input, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${getToken()}` },
  }),
});
```

See [Supplying your own transport](/server/transport) for retrying, logging and more.

## Testing

Replace the transport, and render with a manager of the test's own:

```ts
beforeEach(() => {
  configureBreeze({
    fetch: async () => new Response(JSON.stringify([{ $type: 'Order:#Northwind', OrderID: 1 }]), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  });
});
```

## See also

- [Change tracking](/guide/change-tracking) — every event these stores listen to
- [Generating entity classes](/guide/generating-entities) — typed classes for your components
- [Angular](/guide/angular) — the same questions, answered for Angular
