import { EntityManager, MetadataStore, EntityState } from '../../src/breeze';
import { Customer, Order, registerModelClasses } from '../model';
import { entitiesStore, entityStore, hasChangesStore } from '../../docs/snippets/breeze-react-stores';
import northwindMetadata from '../support/NorthwindIBMetadata_ETNOPAYLOAD.json';

// The stores behind the React hooks in docs/guide/react.md. The guide includes
// docs/snippets/breeze-react-stores.ts as it is, and this runs it, so the page cannot show code
// that was not tested.
//
// React is not needed to test them. What useSyncExternalStore requires of a store is all here:
// subscribe calls back on a change and returns a function that undoes it; getSnapshot returns the
// same value until something changes - Object.is equal - or React re-renders forever.

const metadataStore = new MetadataStore();
metadataStore.importMetadata(JSON.stringify(northwindMetadata));
registerModelClasses(metadataStore);

const newManager = () => new EntityManager({ serviceName: 'http://localhost:0/x', metadataStore });
const subscribers = (event: any) => (event._subscribers || []).length;

describe('hasChangesStore', () => {

  test('reports the current value, and calls back when it flips', () => {
    const em = newManager();
    const store = hasChangesStore(em);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    expect(store.getSnapshot()).toBe(false);

    em.createEntity(Customer, { companyName: 'Acme' });

    expect(calls).toBe(1);
    expect(store.getSnapshot()).toBe(true);
    unsubscribe();
    expect(subscribers(em.hasChangesChanged)).toBe(0);
  });
});

describe('entityStore', () => {

  test('changes its snapshot on a property edit and a state change, and holds it otherwise', () => {
    const em = newManager();
    const cust = em.createEntity(Customer,
      { customerID: '11111111-1111-1111-1111-111111111111', companyName: 'Acme' }, EntityState.Unchanged);
    const store = entityStore(cust);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);           // nothing changed: the same value

    cust.companyName = 'Acme Ltd';                       // a property, and Unchanged -> Modified
    expect(store.getSnapshot()).not.toBe(before);
    const afterEdit = store.getSnapshot();

    cust.entityAspect.setDeleted();                      // state only
    expect(store.getSnapshot()).not.toBe(afterEdit);
    expect(calls).toBeGreaterThanOrEqual(2);

    unsubscribe();
    expect(subscribers(em.entityChanged)).toBe(0);
  });

  test('changes its snapshot when validation fails with no property edited - the Save button case', () => {
    // validateEntity() adds errors without changing a property, so entityChanged never fires. A
    // form listening only to that would not re-render to show why the save was refused.
    const em = newManager();
    const cust = em.createEntity(Customer, { companyName: 'x'.repeat(100) });   // maxLength 40
    cust.entityAspect.clearValidationErrors();
    const store = entityStore(cust);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    const before = store.getSnapshot();

    expect(cust.entityAspect.validateEntity()).toBe(false);

    expect(calls).toBeGreaterThan(0);
    expect(store.getSnapshot()).not.toBe(before);
    unsubscribe();
    expect(subscribers(em.validationErrorsChanged)).toBe(0);
  });

  test('is not woken by a different entity', () => {
    const em = newManager();
    const mine = em.createEntity(Customer, { companyName: 'Mine' });
    const other = em.createEntity(Customer, { companyName: 'Other' });
    const store = entityStore(mine);
    let calls = 0;
    store.subscribe(() => calls++);

    other.companyName = 'Changed';

    expect(calls).toBe(0);
  });
});

describe('entitiesStore', () => {

  test('keeps the same array until membership changes - the useSyncExternalStore requirement', () => {
    const em = newManager();
    em.createEntity(Customer, { companyName: 'First' });
    const store = entitiesStore(em, Customer);
    store.subscribe(() => { });

    const list = store.getSnapshot();
    expect(store.getSnapshot()).toBe(list);             // em.getEntities() alone would fail this
    expect(list.map(c => c.companyName)).toEqual(['First']);
  });

  test('rebuilds on an attach, a delete and a detach of its type', () => {
    const em = newManager();
    const first = em.createEntity(Customer, { companyName: 'First' });
    const store = entitiesStore(em, Customer);
    let calls = 0;
    store.subscribe(() => calls++);
    let list = store.getSnapshot();

    const second = em.createEntity(Customer, { companyName: 'Second' });
    expect(store.getSnapshot()).not.toBe(list);
    expect(store.getSnapshot()).toContain(second);
    list = store.getSnapshot();

    first.entityAspect.setDeleted();                    // an Added entity deleted is detached
    expect(store.getSnapshot()).not.toContain(first);

    em.detachEntity(second);
    expect(store.getSnapshot()).toEqual([]);
    expect(calls).toBeGreaterThan(0);
  });

  test('leaves the list alone on a property edit, or on a change to another type', () => {
    const em = newManager();
    const cust = em.createEntity(Customer, { companyName: 'Acme' });
    const store = entitiesStore(em, Customer);
    let calls = 0;
    store.subscribe(() => calls++);
    const list = store.getSnapshot();

    cust.companyName = 'Acme Ltd';
    em.createEntity(Order, { shipName: 'Not a customer' });

    expect(store.getSnapshot()).toBe(list);
    expect(calls).toBe(0);
  });

  test('leaves out deleted entities by default, which a list on screen usually wants', () => {
    const em = newManager();
    const cust = em.createEntity(Customer,
      { customerID: '22222222-2222-2222-2222-222222222222', companyName: 'Acme' }, EntityState.Unchanged);
    const store = entitiesStore(em, Customer);
    store.subscribe(() => { });

    cust.entityAspect.setDeleted();                     // Unchanged -> Deleted: still cached

    expect(em.getEntities(Customer)).toContain(cust);
    expect(store.getSnapshot()).not.toContain(cust);
  });

  test('stops listening when unsubscribed', () => {
    const em = newManager();
    const unsubscribe = entitiesStore(em, Customer).subscribe(() => { });
    unsubscribe();
    expect(subscribers(em.entityChanged)).toBe(0);
  });
});
