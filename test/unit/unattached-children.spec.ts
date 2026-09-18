import { EntityManager, MetadataStore, configureBreeze } from '../../src/breeze';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// A child whose foreign key names a parent that is not in the cache is parked in
// _unattachedChildrenMap until that parent arrives. Detaching the child now takes it back out
// of the map, so that the manager does not hold it for good - see the retention tier.
//
// These are the functional half of that change: taking it out must not lose the linking the map
// exists to perform. The third case is the one a naive removal breaks.

configureBreeze({ modelLibrary: ModelLibraryBackingStoreAdapter });

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  return new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
}

const PRODUCT_ID = 12345;

describe('a child waiting for its parent', () => {

  test('links when the parent arrives', () => {
    const em = newManager();
    const detail = em.createEntity('OrderDetail', { orderID: 900, productID: PRODUCT_ID }) as any;
    expect(detail.product).toBeNull();

    const product = em.createEntity('Product', { productID: PRODUCT_ID, productName: 'Widget' });

    expect(detail.product).toBe(product);
  });

  test('does not link if it was detached first, and nothing throws', () => {
    const em = newManager();
    const detail = em.createEntity('OrderDetail', { orderID: 901, productID: PRODUCT_ID }) as any;
    em.detachEntity(detail);

    expect(() => em.createEntity('Product', { productID: PRODUCT_ID, productName: 'Widget' })).not.toThrow();
    expect(detail.product).toBeNull();
  });

  test('links again after being detached and re-attached', () => {
    // Removing the child from the map on detach must not make it unlinkable afterwards:
    // re-attaching parks it again.
    const em = newManager();
    const detail = em.createEntity('OrderDetail', { orderID: 902, productID: PRODUCT_ID }) as any;
    em.detachEntity(detail);
    em.attachEntity(detail);

    const product = em.createEntity('Product', { productID: PRODUCT_ID, productName: 'Widget' });

    expect(detail.product).toBe(product);
  });

  test('detaching one of two waiting children leaves the other linkable', () => {
    const em = newManager();
    const keep = em.createEntity('OrderDetail', { orderID: 903, productID: PRODUCT_ID }) as any;
    const drop = em.createEntity('OrderDetail', { orderID: 904, productID: PRODUCT_ID }) as any;
    em.detachEntity(drop);

    const product = em.createEntity('Product', { productID: PRODUCT_ID, productName: 'Widget' });

    expect(keep.product).toBe(product);
    expect(drop.product).toBeNull();
  });
});
