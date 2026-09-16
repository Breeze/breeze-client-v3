import {
  configureBreeze, EntityManager, EntityQuery, EntityState, MetadataStore, DataService, NamingConvention,
} from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// A Breeze server may report a save failure in more than one shape, and all of them have to land
// in the same place on the client: a useful `message`, an `entityErrors` array, and - the part
// that matters most - a ValidationError on the offending entity, which is how a server-side rule
// reaches the UI.
//
//   A. what Breeze servers have always sent: { Code, Message, EntityErrors } in PascalCase
//   B. RFC 9457 problem+json carrying those same members as extensions, so old clients still work
//   C. problem+json with a camelCase `entityErrors` extension and no legacy members
//   D. as C, but with the entity type name already in Breeze's internal spelling
//
// B is what lets a server become RFC 9457 conformant without a flag or a coordinated release:
// section 3.2 allows extension members, and requires consumers to ignore ones they do not know.

let respond: () => Response;

DataServiceWebApiAdapter.register();
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: async () => respond(),
});

const CUST_ID = '11111111-1111-1111-1111-111111111111';

function newManagerWithPendingSave() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  const em = new EntityManager({ dataService: ds, metadataStore: ms });
  const cust = em.createEntity('Customer',
    { customerID: CUST_ID, companyName: 'Acme' }, EntityState.Unchanged);
  cust.setProperty('companyName', 'Changed');   // Modified, so there is something to save
  return { em, cust };
}

function problemResponse(obj: any, contentType = 'application/problem+json', status = 400) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': contentType } });
}

/** Save, expect it to fail, and hand back the error plus the entity it should have marked. */
async function failedSave() {
  const { em, cust } = newManagerWithPendingSave();
  try {
    await em.saveChanges();
    throw new Error('the save should have failed');
  } catch (e: any) {
    return { err: e, cust };
  }
}

/** Every shape has to produce all of this. */
function expectFullyUnderstood({ err, cust }: { err: any, cust: any }) {
  expect(err.message).toBe('Save failed');
  expect(err.status).toBe(400);
  expect(err.entityErrors).toHaveLength(1);

  const ee = err.entityErrors[0];
  expect(ee.errorMessage).toBe('That name is taken');
  // resolved from keyValues + entityTypeName back to the instance in the cache
  expect(ee.entity).toBe(cust);
  // camelCase on the client whatever the server sent, via the naming convention
  expect(ee.propertyName).toBe('companyName');

  // the point of the whole exercise: the rule shows up on the entity
  const ves = cust.entityAspect.getValidationErrors();
  expect(ves).toHaveLength(1);
  expect(ves[0].errorMessage).toBe('That name is taken');
  expect(ves[0].isServerError).toBe(true);
}

const PASCAL_ERRORS = [{
  ErrorName: 'ServerRule', EntityTypeName: 'Foo.Customer', KeyValues: [CUST_ID],
  PropertyName: 'CompanyName', ErrorMessage: 'That name is taken', Custom: null as any,
}];

const CAMEL_ERRORS = [{
  errorName: 'ServerRule', entityTypeName: 'Foo.Customer', keyValues: [CUST_ID],
  propertyName: 'CompanyName', errorMessage: 'That name is taken', custom: null as any,
}];

describe("Server error shapes", () => {

  test("A. the shape Breeze servers have always sent", async () => {
    respond = () => problemResponse(
      { Code: 400, Message: 'Save failed', EntityErrors: PASCAL_ERRORS }, 'application/json');
    expectFullyUnderstood(await failedSave());
  });

  test("B. RFC 9457 problem+json carrying the legacy members as extensions", async () => {
    // What a server can start sending today: conformant problem+json that a 2.x or 3.0 client
    // still reads, because Message and EntityErrors are exactly where it looks for them.
    respond = () => problemResponse({
      type: 'https://breeze.github.io/problems/save-error',
      title: 'Save failed', status: 400, detail: 'Save failed',
      Message: 'Save failed', EntityErrors: PASCAL_ERRORS,
    });
    expectFullyUnderstood(await failedSave());
  });

  test("C. problem+json with camelCase entityErrors and no legacy members", async () => {
    // Where a server can go once no old clients remain. The message comes from `detail`, and the
    // entity type name is normalized here rather than being the server's problem.
    respond = () => problemResponse({
      type: 'https://breeze.github.io/problems/save-error',
      title: 'Save failed', status: 400, detail: 'Save failed',
      entityErrors: CAMEL_ERRORS,
    });
    expectFullyUnderstood(await failedSave());
  });

  test("D. the same, with the type name already in Breeze's internal spelling", async () => {
    respond = () => problemResponse({
      type: 'https://breeze.github.io/problems/save-error',
      title: 'Save failed', status: 400, detail: 'Save failed',
      entityErrors: [{ ...CAMEL_ERRORS[0], entityTypeName: 'Customer:#Foo' }],
    });
    expectFullyUnderstood(await failedSave());
  });

  test("`title` is used when there is no `detail`", async () => {
    respond = () => problemResponse({
      type: 'about:blank', title: 'Conflict', status: 409,
    }, 'application/problem+json', 409);
    const { err } = await failedSave();
    expect(err.message).toBe('Conflict');
    expect(err.status).toBe(409);
  });

  test("a body with none of these still reports something", async () => {
    respond = () => problemResponse({ nothing: 'recognizable' }, 'application/json', 500);
    const { err } = await failedSave();
    expect(err.status).toBe(500);
    expect(err.message).toBeTruthy();
  });

  test("entity errors are still understood when several entities failed", async () => {
    const OTHER_ID = '22222222-2222-2222-2222-222222222222';
    respond = () => problemResponse({
      type: 'https://breeze.github.io/problems/save-error',
      title: 'Save failed', status: 400, detail: 'Two entities failed',
      entityErrors: [
        CAMEL_ERRORS[0],
        { ...CAMEL_ERRORS[0], keyValues: [OTHER_ID], errorMessage: 'Not in the cache' },
      ],
    });
    const { err, cust } = await failedSave();

    expect(err.entityErrors).toHaveLength(2);
    // The first resolves to the cached entity; the second names a key this manager never saw,
    // so it comes back with no entity rather than throwing. A save can fail on entities the
    // client does not hold.
    expect(err.entityErrors[0].entity).toBe(cust);
    expect(err.entityErrors[1].entity).toBeNull();
    expect(cust.entityAspect.getValidationErrors()).toHaveLength(1);
  });

  test("a problem document with no entity errors at all", async () => {
    // What a 409 from a duplicate-key violation would look like: a plain problem document, no
    // per-property detail, because the database rejected it rather than a validation rule.
    respond = () => problemResponse({
      type: 'https://breeze.github.io/problems/duplicate-key',
      title: 'Conflict',
      status: 409,
      detail: "Violation of UNIQUE KEY constraint 'IX_Customer_CompanyName'.",
    }, 'application/problem+json', 409);

    const { err, cust } = await failedSave();
    expect(err.status).toBe(409);
    expect(err.message).toBe("Violation of UNIQUE KEY constraint 'IX_Customer_CompanyName'.");
    expect(err.entityErrors).toBeUndefined();
    // Nothing is attributable to a property, so the entity is left unmarked and still Modified.
    expect(cust.entityAspect.getValidationErrors()).toHaveLength(0);
    expect(cust.entityAspect.entityState.isModified()).toBe(true);
  });

  test("the query path reports the same message", async () => {
    // Queries have no saveContext, so entityErrors are not attached to entities - but the
    // message still has to come through, which is the part that broke for problem+json.
    const ms = new MetadataStore();
    ms.importMetadata(metadata);
    const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
    ms.addDataService(ds);
    const em = new EntityManager({ dataService: ds, metadataStore: ms });

    respond = () => problemResponse({
      type: 'about:blank', title: 'Bad Request', status: 400,
      detail: 'That query is not valid',
    }, 'application/problem+json');

    await expect(em.executeQuery(EntityQuery.from('Customers')))
      .rejects.toThrow('That query is not valid');
  });

});
