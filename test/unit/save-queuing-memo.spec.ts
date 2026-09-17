import { EntityManager, EntityState, configureBreeze } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { enableSaveQueuing } from '../../src/mixins/mixin-save-queuing';
import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';
import metadata from '../support/NorthwindIBMetadata.json';

// configureBreeze registers in dependency order - see save-queuing.spec.ts.
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  ajax: AjaxFakeAdapter,
  dataService: DataServiceWebApiAdapter,
});

// save-queuing.spec.ts covers the part of the mixin people describe: two saves at once do not
// collide. This covers the part that is the actual reason to use it - the SaveMemo.
//
// Core Breeze lets you edit an entity that is being saved, and then quietly throws that edit away:
// the server's values overwrite it when the save result merges back, the entity ends up Unchanged
// and hasChanges() is false, so nothing tells the application that a keystroke was lost. The memo
// is what records those mid-flight edits and re-applies them over the server's response, then
// sends them in the follow-up save.
//
// So these assert what went *over the wire* as well as what the cache holds. An assertion on the
// cache alone would pass for a memo that re-applied the edit locally and never saved it.

/** A save request as the client sent it, parsed. */
interface SentSave { entities: any[]; }

interface KeyMappingSpec {
  /** Short type name, e.g. 'Employee'. */
  shortName: string;
  /** The key property as the server names it, e.g. 'EmployeeID'. */
  keyPropOnServer: string;
  temp: number;
  real: number;
}

/**
 * Answers every save with the entities the client sent, plus optional key mappings - and records
 * each request. The fake ajax adapter waits 500ms before responding, which is the window these
 * tests edit in.
 */
function fakeServer(em: EntityManager, keyMappings: KeyMappingSpec[] = []) {
  const qualified = (shortName: string) => em.metadataStore.getAsEntityType(shortName)!.name;
  const ajax = AjaxFakeAdapter.register();
  const requests: SentSave[] = [];

  ajax.responseFn = (config: any) => {
    const sent: SentSave = JSON.parse(config.data);
    requests.push(sent);

    // Only map keys the client actually sent as temporary, which is what a server would do -
    // the follow-up save carries real keys and must not be remapped again.
    const applicable = keyMappings.filter(km => sent.entities.some(e =>
      e.entityAspect.entityTypeName === qualified(km.shortName) && e[km.keyPropOnServer] === km.temp));

    const entities = sent.entities.map((e: any) => {
      const copy = { ...e, $type: e.entityAspect.entityTypeName };
      delete copy.entityAspect;
      applicable.forEach(km => {
        if (copy.$type === qualified(km.shortName) && copy[km.keyPropOnServer] === km.temp) {
          copy[km.keyPropOnServer] = km.real;
        }
      });
      return copy;
    });

    return {
      Entities: entities,
      KeyMappings: applicable.map(km => ({
        EntityTypeName: qualified(km.shortName), TempValue: km.temp, RealValue: km.real,
      })),
    };
  };
  return requests;
}

function newManager() {
  const em = new EntityManager('test');
  em.metadataStore.importMetadata(metadata);
  enableSaveQueuing(em, true);
  return em;
}

/** The entity of that type in a recorded request, or undefined. */
function sentEntity(em: EntityManager, save: SentSave, shortName: string) {
  const typeName = em.metadataStore.getAsEntityType(shortName)!.name;
  return save.entities.find(e => e.entityAspect.entityTypeName === typeName);
}

/** Lets the in-flight save finish and the queued one behind it complete too. */
async function settle(...promises: Promise<any>[]): Promise<void> {
  await Promise.allSettled(promises);
  await new Promise<void>(resolve => { setTimeout(resolve, 900); });
}

describe('Save queuing keeps changes made during a save', () => {

  test('an edit to a Modified entity is re-applied and saved', async () => {
    const em = newManager();
    const requests = fakeServer(em);
    const cust: any = em.createEntity('Customer', { companyName: 'First' }, EntityState.Unchanged);
    cust.setProperty('companyName', 'Second');

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    cust.setProperty('companyName', 'Third');     // typed while the save was out
    const queued = em.saveChanges();
    await settle(inFlight, queued);

    // the edit survived the server's response ...
    expect(cust.getProperty('companyName')).toEqual('Third');
    expect(cust.entityAspect.entityState).toEqual(EntityState.Unchanged);
    expect(em.hasChanges()).toBe(false);

    // ... and was actually sent, rather than only put back in the cache
    expect(requests.length).toEqual(2);
    expect(sentEntity(em, requests[0], 'Customer').CompanyName).toEqual('Second');
    expect(sentEntity(em, requests[1], 'Customer').CompanyName).toEqual('Third');
  }, 20000);

  test('an edit to an Added entity becomes a Modified follow-up save', async () => {
    const em = newManager();
    const order: any = em.createEntity('Order', { shipName: 'S1' });
    // Temporary keys come from a counter shared across types and managers, so read it rather
    // than assume it. It is what the memo is keyed by until the server replaces it.
    const tempOrderID = order.getProperty('orderID');
    expect(order.entityAspect.hasTempKey).toBe(true);
    const requests = fakeServer(em, [
      { shortName: 'Order', keyPropOnServer: 'OrderID', temp: tempOrderID, real: 77 },
    ]);

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    order.setProperty('shipName', 'S2');
    const queued = em.saveChanges();
    await settle(inFlight, queued);

    expect(order.getProperty('shipName')).toEqual('S2');
    expect(order.getProperty('orderID')).toEqual(77);      // real key from the first save
    expect(order.entityAspect.entityState).toEqual(EntityState.Unchanged);

    // The first save added it; the second updates it - under the key the server assigned, which
    // is SaveMemo.pkFixup renaming the memo. Sending it as Added again would duplicate the row.
    const added = sentEntity(em, requests[0], 'Order');
    expect(added.entityAspect.entityState).toEqual('Added');
    expect(added.ShipName).toEqual('S1');

    const modified = sentEntity(em, requests[1], 'Order');
    expect(modified.entityAspect.entityState).toEqual('Modified');
    expect(modified.ShipName).toEqual('S2');
    expect(modified.OrderID).toEqual(77);
    expect(modified.entityAspect.originalValuesMap).toEqual({ ShipName: 'S1' });
  }, 20000);

  test('a foreign key set during a save is retargeted when the parent gets its real key', async () => {
    const em = newManager();
    const emp: any = em.createEntity('Employee', { firstName: 'Ann', lastName: 'Lee' });
    const order: any = em.createEntity('Order', { shipName: 'S1' });
    const tempEmployeeID = emp.getProperty('employeeID');
    const tempOrderID = order.getProperty('orderID');
    const requests = fakeServer(em, [
      { shortName: 'Employee', keyPropOnServer: 'EmployeeID', temp: tempEmployeeID, real: 500 },
      { shortName: 'Order', keyPropOnServer: 'OrderID', temp: tempOrderID, real: 600 },
    ]);

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    // Point the order at the employee while both are in flight. The only key the client has for
    // the employee at this moment is its temporary one, so that is what the memo records.
    order.setProperty('employeeID', tempEmployeeID);
    const queued = em.saveChanges();
    await settle(inFlight, queued);

    expect(order.getProperty('employeeID')).toEqual(500);
    expect(order.entityAspect.entityState).toEqual(EntityState.Unchanged);

    // The point of EntityMemo.fkFixup: the queued save must carry the employee's real key. Sending
    // -1 would either fail the server's foreign key constraint or point the order at nothing.
    const modified = sentEntity(em, requests[1], 'Order');
    expect(modified.EmployeeID).toEqual(500);
    expect(modified.OrderID).toEqual(600);
  }, 20000);

  // The one shape the old fkFixup handled, because a self-referencing key is the only case where
  // the type that declares the foreign key and the type it points at are the same.
  test('a self-referencing foreign key is retargeted too', async () => {
    const em = newManager();
    const manager: any = em.createEntity('Employee', { firstName: 'Mo', lastName: 'Ng' });
    const report: any = em.createEntity('Employee', { firstName: 'Sam', lastName: 'Roy' });
    const tempManagerID = manager.getProperty('employeeID');
    const requests = fakeServer(em, [
      { shortName: 'Employee', keyPropOnServer: 'EmployeeID', temp: tempManagerID, real: 800 },
      { shortName: 'Employee', keyPropOnServer: 'EmployeeID', temp: report.getProperty('employeeID'), real: 801 },
    ]);

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    report.setProperty('reportsToEmployeeID', tempManagerID);
    const queued = em.saveChanges();
    await settle(inFlight, queued);

    expect(report.getProperty('reportsToEmployeeID')).toEqual(800);
    const modified = requests[1].entities.find((e: any) => e.EmployeeID === 801);
    expect(modified.ReportsToEmployeeID).toEqual(800);
  }, 20000);

  test('two edits during one save are both sent', async () => {
    const em = newManager();
    const requests = fakeServer(em);
    const cust: any = em.createEntity('Customer', { companyName: 'First', city: 'Sydney' },
      EntityState.Unchanged);
    cust.setProperty('companyName', 'Second');

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    cust.setProperty('companyName', 'Third');
    const queuedA = em.saveChanges();
    cust.setProperty('city', 'Hobart');
    const queuedB = em.saveChanges();
    await settle(inFlight, queuedA, queuedB);

    expect(cust.getProperty('companyName')).toEqual('Third');
    expect(cust.getProperty('city')).toEqual('Hobart');
    expect(em.hasChanges()).toBe(false);

    // Both edits go in the one follow-up save - queueing folds them together rather than
    // sending a save per keystroke.
    expect(requests.length).toEqual(2);
    const modified = sentEntity(em, requests[1], 'Customer');
    expect(modified.CompanyName).toEqual('Third');
    expect(modified.City).toEqual('Hobart');
  }, 20000);

  // The mixin's header lists these as limitations, and they are enforced by the core
  // EntityAspect._checkOperation rather than by the mixin - which is why EntityMemo's Deleted
  // branch, and applyToSavedEntity's setDeleted, cannot be reached through the public API.
  test.each([
    ['setDeleted', (cust: any, _em: EntityManager) => cust.entityAspect.setDeleted()],
    ['rejectChanges', (cust: any, _em: EntityManager) => cust.entityAspect.rejectChanges()],
    ['clear', (_cust: any, em: EntityManager) => em.clear()],
  ])('%s during a save still throws, queuing or not', async (_name, op) => {
    const em = newManager();
    fakeServer(em);
    const cust: any = em.createEntity('Customer', { companyName: 'First' }, EntityState.Unchanged);
    cust.setProperty('companyName', 'Second');

    const inFlight = em.saveChanges();
    await new Promise(r => setTimeout(r, 50));
    expect(cust.entityAspect.isBeingSaved).toBe(true);
    expect(() => op(cust, em)).toThrow(/in the process of being saved/);

    await settle(inFlight);
    expect(cust.entityAspect.entityState).toEqual(EntityState.Unchanged);
  }, 20000);
});
