import {
  configureBreeze, DataService, EntityManager, EntityState, MetadataStore, NamingConvention,
  ValidationError, ValidationOptions,
} from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// Which validation errors stop a save.
//
// An entity's errors come from three places, and they are not treated alike:
//   - validators, which validateEntity re-runs, so it knows whether each still applies;
//   - the application, through addValidationError, which nothing can re-check;
//   - the server, after a failed save, flagged isServerError, which only the server can re-check.
//
// The rule: every error stops a save except the server's. A save clears those before validating
// and the server checks again, so they can never trap a user who has fixed the problem - and an
// edit to a property drops the server's errors about it at once, so they stop being shown too.
//
// Before this, errors the application added were ignored: validateEntity returned true with one
// standing, saveChanges sent the entity, and an application-added error beside an ordinary
// validation failure made the save's own error report throw a TypeError instead.

let respond: () => Response | Promise<Response>;
let requests = 0;

DataServiceWebApiAdapter.register();
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: async () => { requests++; return respond(); },
});

const CUST_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { requests = 0; });

/** A Modified customer, so that there is something to save. */
function managerWithChangedCustomer() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  const em = new EntityManager({ dataService: ds, metadataStore: ms });
  const cust = em.createEntity('Customer', { customerID: CUST_ID, companyName: 'Acme' }, EntityState.Unchanged) as any;
  cust.companyName = 'Changed';
  return { em, cust };
}

/** An error no validator produces, as an application adds one. */
function appError(propertyName?: string) {
  const context = propertyName ? { propertyName } : {};
  return new ValidationError(null, context, 'Ship date is in a closed period', 'closedPeriod');
}

/** The server rejects the save with one error about the customer's companyName. */
function serverRejects() {
  respond = () => new Response(JSON.stringify({
    type: 'https://breeze.github.io/problems/save-error', title: 'Save failed', status: 400, detail: 'Save failed',
    entityErrors: [{
      errorName: 'ServerRule', entityTypeName: 'Foo.Customer', keyValues: [CUST_ID],
      propertyName: 'CompanyName', errorMessage: 'That name is taken',
    }],
  }), { status: 400, headers: { 'Content-Type': 'application/problem+json' } });
}

/** The server accepts the save. */
function serverAccepts(cust: any) {
  respond = () => new Response(JSON.stringify({
    Entities: [{ $type: 'Customer:#Foo', CustomerID: CUST_ID, CompanyName: cust.companyName }],
    KeyMappings: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('an error the application added', () => {

  test('makes validateEntity return false, until it is removed', () => {
    const { cust } = managerWithChangedCustomer();
    expect(cust.entityAspect.validateEntity()).toBe(true);

    cust.entityAspect.addValidationError(appError());
    expect(cust.entityAspect.validateEntity()).toBe(false);

    cust.entityAspect.removeValidationError('closedPeriod');
    expect(cust.entityAspect.validateEntity()).toBe(true);
  });

  test('stops the save before anything is sent, and is named in entityErrors', async () => {
    const { em, cust } = managerWithChangedCustomer();
    cust.entityAspect.addValidationError(appError());
    serverAccepts(cust);

    const err: any = await em.saveChanges().catch(e => e);

    expect(err.message).toMatch(/Client side validation errors encountered/);
    expect(requests).toBe(0);
    expect(err.entityErrors).toHaveLength(1);
    expect(err.entityErrors[0].errorName).toBe('closedPeriod');
    expect(err.entityErrors[0].errorMessage).toBe('Ship date is in a closed period');
  });

  test('beside an ordinary validation failure, is reported rather than crashing the report', async () => {
    // The save's error report read ve.validator.name, and an application-added error has no
    // validator: the report threw "Cannot read properties of undefined (reading 'name')" and the
    // caller got that instead of the validation error and its entityErrors.
    const { em, cust } = managerWithChangedCustomer();
    cust.companyName = 'x'.repeat(200);             // maxLength 40: a validator failure
    cust.entityAspect.addValidationError(appError());
    serverAccepts(cust);

    const err: any = await em.saveChanges().catch(e => e);

    expect(err).not.toBeInstanceOf(TypeError);
    expect(err.message).toMatch(/Client side validation errors encountered/);
    const names = err.entityErrors.map((e: any) => e.errorName).sort();
    expect(names).toEqual(['closedPeriod', 'maxLength']);
  });

  test('makes validateProperty false for its property, and only for that one', () => {
    const { cust } = managerWithChangedCustomer();
    cust.entityAspect.addValidationError(appError('companyName'));

    expect(cust.entityAspect.validateProperty('companyName')).toBe(false);
    expect(cust.entityAspect.validateProperty('city')).toBe(true);
  });

  test("is listed by getValidationErrors for its property, which is what explains validateProperty's false", () => {
    // Added the way the validation guide shows - a propertyName and no property object. The
    // per-property lookup matched only on the object, so a form asking "why is this field wrong?"
    // got nothing back while validateProperty said the field was wrong.
    const { cust } = managerWithChangedCustomer();
    cust.entityAspect.addValidationError(appError('companyName'));

    expect(cust.entityAspect.validateProperty('companyName')).toBe(false);
    expect(cust.entityAspect.getValidationErrors('companyName').map((e: ValidationError) => e.key))
      .toEqual(['closedPeriod']);
    expect(cust.entityAspect.getValidationErrors('city')).toEqual([]);
  });

  test('is not cleared by editing the property - only the application can remove it', () => {
    const { cust } = managerWithChangedCustomer();
    cust.entityAspect.addValidationError(appError('companyName'));

    cust.companyName = 'Edited';

    expect(cust.entityAspect.getValidationErrors().map((e: ValidationError) => e.key)).toContain('closedPeriod');
    expect(cust.entityAspect.validateEntity()).toBe(false);
  });
});

describe("an error from the server", () => {

  async function afterFailedSave() {
    const { em, cust } = managerWithChangedCustomer();
    serverRejects();
    await em.saveChanges().catch(() => { });
    return { em, cust };
  }

  test('is shown, but does not make validateEntity return false', async () => {
    const { cust } = await afterFailedSave();

    // still there to display
    expect(cust.entityAspect.hasValidationErrors).toBe(true);
    expect(cust.entityAspect.getValidationErrors()[0].isServerError).toBe(true);
    // but it is not an answer the client can re-check, and the next save clears it anyway
    expect(cust.entityAspect.validateEntity()).toBe(true);
  });

  test('does not stop the retry', async () => {
    const { em, cust } = await afterFailedSave();
    serverAccepts(cust);
    requests = 0;

    const result = await em.saveChanges();

    expect(requests).toBe(1);
    expect(result.entities).toHaveLength(1);
    expect(cust.entityAspect.hasValidationErrors).toBe(false);
  });

  test('goes as soon as the property it is about is edited', async () => {
    const { em, cust } = await afterFailedSave();
    const removed: string[] = [];
    em.validationErrorsChanged.subscribe(args => removed.push(...args.removed.map(e => e.errorMessage)));

    cust.companyName = 'Another name';

    expect(cust.entityAspect.hasValidationErrors).toBe(false);
    expect(removed).toEqual(['That name is taken']);   // and whoever shows errors is told
  });

  test('stays when a different property is edited', async () => {
    const { cust } = await afterFailedSave();

    cust.city = 'Oslo';

    expect(cust.entityAspect.getValidationErrors().map((e: ValidationError) => e.errorMessage))
      .toEqual(['That name is taken']);
  });

  test('goes on an edit even with validateOnPropertyChange turned off', async () => {
    // Turning it off stops Breeze checking the new value; the server's verdict on the old one is
    // stale either way.
    const { em, cust } = await afterFailedSave();
    em.validationOptions = new ValidationOptions({ validateOnPropertyChange: false });

    cust.companyName = 'Another name';

    expect(cust.entityAspect.hasValidationErrors).toBe(false);
  });
});
