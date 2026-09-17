import { EntityManager, EntityState, configureBreeze } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';
import metadata from '../support/NorthwindIBMetadata.json';

// configureBreeze registers in dependency order - see save-queuing.spec.ts.
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  ajax: AjaxFakeAdapter,
  dataService: DataServiceWebApiAdapter,
});

// A save of a new entity comes back with a KeyMapping: the temporary key the client invented and
// the real one the database assigned. Both values are whatever type the key is - an integer
// identity column gives integers - while the group indexes its entities by the key *string*.
//
// That index used to be an object literal, which coerced a number key to a string on the way in
// and on the way out, so the mismatch was invisible. It is a Map now, where it is not: a number
// and its string are different keys, and getting this wrong means every save of a new entity
// fails with "Internal Error in key fixup - unable to locate entity".

function newManager() {
  const em = new EntityManager('test');
  em.metadataStore.importMetadata(metadata);
  return em;
}

/** Answers a save with the entity the client sent, plus the key mapping a server would return. */
function respondWithKeyMapping(tempValue: any, realValue: any) {
  const ajax = AjaxFakeAdapter.register();
  ajax.responseFn = (config: any) => {
    const sent = JSON.parse(config.data);
    const entities = sent.entities.map((e: any) => {
      const entityTypeName = e.entityAspect.entityTypeName;
      const copy = { ...e, $type: entityTypeName };
      delete copy.entityAspect;
      copy.OrderID = realValue;
      return copy;
    });
    return {
      Entities: entities,
      KeyMappings: [{
        EntityTypeName: sent.entities[0].entityAspect.entityTypeName,
        TempValue: tempValue,
        RealValue: realValue,
      }],
    };
  };
  return ajax;
}

describe('Key fixup after a save', () => {

  test('replaces a numeric temporary key with the real one', async () => {
    const em = newManager();
    const order = em.createEntity('Order', { shipName: 'Acme' });
    const tempValue = order.getProperty('orderID');

    expect(order.entityAspect.hasTempKey).toBe(true);
    expect(typeof tempValue).toEqual('number');
    expect(em.getEntityByKey('Order', tempValue)).toBe(order);

    respondWithKeyMapping(tempValue, 42);
    await em.saveChanges();

    expect(order.getProperty('orderID')).toEqual(42);
    expect(order.entityAspect.hasTempKey).toBeFalsy();
    expect(order.entityAspect.entityState).toEqual(EntityState.Unchanged);

    // the cache now finds it by the real key, and no longer by the temporary one
    expect(em.getEntityByKey('Order', 42)).toBe(order);
    expect(em.getEntityByKey('Order', tempValue)).toBeNull();
    expect(em.getEntities().length).toEqual(1);
  });
});
