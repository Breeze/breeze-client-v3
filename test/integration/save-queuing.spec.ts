import { EntityQuery, EntityState, config, configureBreeze } from '../../src/breeze';
import { enableSaveQueuing } from '../../src/mixins/mixin-save-queuing';
import { TestFns } from '../test-fns';
import { SaveTestFns } from '../save-test-fns';
import { Customer, Employee, Order, registerModelClasses } from '../model';

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
  registerModelClasses(TestFns.defaultMetadataStore);
});

afterAll(async () => {
  restoreFetch();
  await SaveTestFns.cleanup();
});

// test/unit/save-queuing-memo.spec.ts covers the SaveMemo against a fake server. This runs the
// same thing against the real one, because the part that matters most - a foreign key set while
// its parent is still being inserted - is only really proved by a database with the constraint
// on it. Sending a temporary key (a negative integer) there fails the insert.

/**
 * Runs `duringSave` after a save request has gone out and before its response comes back.
 *
 * Scheduling the edit on a timer instead would race the server: against localhost a save can
 * return in a few milliseconds. Hooking the transport makes "while the save is in flight" exact.
 */
let duringSave: (() => void) | undefined;
let originalFetch: typeof config.fetch;
let fetchWrapped = false;

function wrapFetch() {
  if (fetchWrapped) return;
  originalFetch = config.fetch;
  const base = originalFetch ?? ((input: any, init: any) => globalThis.fetch(input, init));
  configureBreeze({
    fetch: (input: any, init: any) => {
      const response = base(input, init);
      if (duringSave && init && init.method === 'POST') {
        const hook = duringSave;
        duringSave = undefined;
        hook();          // the request is out; the entities are isBeingSaved
      }
      return response;
    },
  });
  fetchWrapped = true;
}

function restoreFetch() {
  if (!fetchWrapped) return;
  configureBreeze({ fetch: originalFetch });
  fetchWrapped = false;
}

beforeEach(() => { wrapFetch(); duringSave = undefined; });
afterEach(() => { duringSave = undefined; });

describe('Save queuing against the server', () => {

  test('an edit made during a save reaches the database', async () => {
    const em = SaveTestFns.newEntityManager();
    enableSaveQueuing(em, true);

    const cust = em.createEntity(Customer, { companyName: 'Test SaveQueuing Co' });
    await em.saveChanges();                       // insert it first, so this save is an update

    cust.contactName = 'First';
    let queued!: Promise<any>;
    duringSave = () => {
      cust.contactName = 'Second';
      queued = em.saveChanges();
    };
    await em.saveChanges();
    await queued;

    expect(cust.contactName).toEqual('Second');
    expect(em.hasChanges()).toBe(false);

    // the database, not the cache
    const em2 = SaveTestFns.newEntityManager();
    const { results } = await em2.executeQuery(
      EntityQuery.from(Customer).where('customerID', '==', cust.customerID));
    expect(results.length).toEqual(1);
    expect(results[0].contactName).toEqual('Second');
  });

  test('a foreign key set during a save is saved as the real key, not the temporary one', async () => {
    const em = SaveTestFns.newEntityManager();
    enableSaveQueuing(em, true);

    const emp = em.createEntity(Employee, { firstName: 'Test', lastName: 'TestQueuing' });
    // The order belongs to a "Test..." customer so that SaveTestFns.cleanup, which deletes those
    // customers with their orders, deletes this order too. Without one it deleted the employee and
    // left the order pointing at it: the cleanup's save hit FK_Order_Employee and, being all or
    // nothing, removed nothing - and printed a 409 into every run's output.
    const cust = em.createEntity(Customer, { companyName: 'Test SaveQueuing order customer' });
    const order = em.createEntity(Order, { shipName: 'Test SaveQueuing order', customer: cust });
    const tempEmployeeID = emp.employeeID;
    expect(tempEmployeeID).toBeLessThan(0);
    expect(emp.entityAspect.hasTempKey).toBe(true);

    let queued!: Promise<any>;
    duringSave = () => {
      // The employee's row does not exist yet, so its temporary key is the only one the client
      // has. EntityMemo.fkFixup has to replace it with the identity the server assigns before
      // the queued save goes out - a negative key would fail the foreign key constraint.
      order.employeeID = tempEmployeeID;
      queued = em.saveChanges();
    };
    await em.saveChanges();
    await queued;

    expect(emp.employeeID).toBeGreaterThan(0);
    expect(order.employeeID).toEqual(emp.employeeID);
    expect(order.entityAspect.entityState).toEqual(EntityState.Unchanged);
    expect(em.hasChanges()).toBe(false);

    const em2 = SaveTestFns.newEntityManager();
    const { results } = await em2.executeQuery(
      EntityQuery.from(Order).where('orderID', '==', order.orderID).expand('employee'));
    expect(results.length).toEqual(1);
    expect(results[0].employeeID).toEqual(emp.employeeID);
    expect(results[0].employee.lastName).toEqual('TestQueuing');
  });
});
