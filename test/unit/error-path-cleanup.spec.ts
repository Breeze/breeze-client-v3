import { EntityManager, EntityQuery, JsonResultsAdapter, MetadataStore, config, configureBreeze } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import metadata from '../support/NorthwindIBMetadata.json';

// A request that fails part way must leave the manager as it found it. Every flag here is set
// for the duration of a request and restored by `core.using` or by a cleanup step, so a refactor
// of the promise chain can strip one without any test noticing: the query still rejects, the
// error still reaches the caller, and the manager is quietly wedged.
//
// A stuck `isLoading` suppresses change tracking, so later edits are silently not recorded. A
// stuck `isBeingSaved` makes an entity reject further changes. Neither raises anything.

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  dataService: DataServiceWebApiAdapter,
});

let respond: () => Promise<Response>;
config.fetch = () => respond();

const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  return new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
}

const ordersQuery = () => EntityQuery.from('Orders').toType('Order');

describe('a failed query leaves nothing behind', () => {

  test.each([
    ['a transport failure', () => { respond = () => Promise.reject(new TypeError('network down')); }],
    ['a 500', () => { respond = async () => new Response('server exploded', { status: 500 }); }],
    // Not `{"not":"an array"}`: a lone object is a valid result set of one, by the untyped
    // fallback documented in Migrating from 2.x. This is a body that cannot be parsed at all.
    ['a body that is not JSON', () => { respond = async () => json('<html>gateway timeout</html>'); }],
  ])('after %s', async (_name, arrange) => {
    const em = newManager();
    arrange();

    await expect(em.executeQuery(ordersQuery())).rejects.toBeDefined();

    // isLoading is set for the duration of a merge; leaving it set stops the manager tracking
    // any later change, with no error to say so.
    expect(em.isLoading).toBe(false);
    // _pendingPubs holds the change notifications deferred during a merge, and the entities they
    // name. It has to be emptied whether the merge finished or threw.
    expect((em as any)._pendingPubs).toBeUndefined();
    expect(em.hasChanges()).toBe(false);
  });

  // The three above fail before the merge begins, so they never reach the cleanup that restores
  // isLoading - their assertion on it is true but vacuous. This one fails INSIDE the merge, with
  // isLoading already set, which is the case the cleanup exists for. Breaking that restore in
  // entity-manager.ts fails this test and only this one.
  test('after a failure inside the merge, with isLoading already set', async () => {
    const em = newManager();
    respond = async () => json('[{ "$type": "Order:#Foo", "OrderID": 1 }]');
    const boom = new JsonResultsAdapter({
      name: 'boom',
      visitNode: () => { throw new Error('visitNode blew up'); },
    });

    await expect(em.executeQuery(ordersQuery().using(boom))).rejects.toThrow('visitNode blew up');

    expect(em.isLoading).toBe(false);
    expect((em as any)._pendingPubs).toBeUndefined();
  });

  test('and the manager still works afterwards', async () => {
    const em = newManager();
    respond = () => Promise.reject(new TypeError('network down'));
    await expect(em.executeQuery(ordersQuery())).rejects.toBeDefined();

    respond = async () => json('[{ "OrderID": 1, "ShipName": "Recovered" }]');
    const qr = await em.executeQuery(ordersQuery());

    expect(qr.results.length).toBe(1);
    expect((qr.results[0] as any).shipName).toBe('Recovered');
  });
});

describe('a failed save leaves nothing behind', () => {

  test('isBeingSaved is cleared, and the changes are still there to retry', async () => {
    const em = newManager();
    const order = em.createEntity('Order', { orderID: 1, shipName: 'Pending' }) as any;
    respond = async () => new Response('nope', { status: 500 });

    await expect(em.saveChanges()).rejects.toBeDefined();

    // Left set, the entity refuses later changes - and nothing reports why.
    expect(order.entityAspect.isBeingSaved).toBe(false);
    // The save failed, so the change must survive for the caller to retry.
    expect(em.hasChanges()).toBe(true);
    expect(order.entityAspect.entityState.isAdded()).toBe(true);
  });

  test('and a retry succeeds', async () => {
    const em = newManager();
    em.createEntity('Order', { orderID: 2, shipName: 'Retried' });
    respond = async () => new Response('nope', { status: 500 });
    await expect(em.saveChanges()).rejects.toBeDefined();

    respond = async () => json(JSON.stringify({
      Entities: [{ $type: 'Order:#Foo', OrderID: 2, ShipName: 'Retried' }], KeyMappings: [],
    }));
    const result = await em.saveChanges();

    expect(result.entities.length).toBe(1);
    expect(em.hasChanges()).toBe(false);
  });
});
