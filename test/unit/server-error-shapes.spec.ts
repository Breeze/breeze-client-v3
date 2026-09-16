import {
  configureBreeze, EntityManager, EntityQuery, EntityState, MetadataStore, DataService, NamingConvention,
  ProblemTypes, isConcurrencyError,
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
//   A. what Breeze servers sent before 3.0: { Code, Message, EntityErrors } in PascalCase
//   B. what a 3.0 server sends by default: RFC 9457 problem+json carrying those same members as
//      extensions, so an application on an older client still reads it
//   C. what it sends once BreezeConfig.IncludeLegacyErrorMembers is off: problem+json with a
//      camelCase `entityErrors` extension and nothing capitalised
//   D. as C, but with the entity type name already in Breeze's internal spelling
//
// The RFC members - type, title, status, detail - are the ones to read; the capitalised ones are
// legacy, and C is where this is heading. B is what lets a server become conformant without a
// flag or a coordinated release: section 3.2 allows extension members, and requires consumers to
// ignore ones they do not recognize.

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

// A concurrency conflict has to be tellable from every other save failure without matching on the
// message, because the recovery is specific: re-read and let the user decide, rather than fix the
// data and retry. The status code cannot carry that on its own - a duplicate key is also 409 - so
// the discriminator is the RFC 9457 `type` member, which is stable across ORMs and server
// versions in a way that EF Core's or NHibernate's wording is not.

const CONCURRENCY_ERRORS = [{
  errorName: 'ConcurrencyError', entityTypeName: 'Foo.Customer', keyValues: [CUST_ID],
  propertyName: null as any,
  errorMessage: 'This record was changed or deleted by another user after it was read.',
}];

function concurrencyResponse(extra: any = {}) {
  return problemResponse({
    type: 'https://breeze.github.io/problems/concurrency-conflict',
    title: 'Conflict',
    status: 409,
    detail: 'The save failed because 1 record was changed or deleted by another user after it was read.',
    entityErrors: CONCURRENCY_ERRORS,
    ...extra,
  }, 'application/problem+json', 409);
}

describe("Concurrency conflicts", () => {

  test("are recognized, and name the entities that went stale", async () => {
    respond = () => concurrencyResponse();
    const { err, cust } = await failedSave();

    expect(err.status).toBe(409);
    expect(err.problemType).toBe(ProblemTypes.concurrencyConflict);
    expect(isConcurrencyError(err)).toBe(true);

    // Which rows conflicted, not just that something did - so an application can show the user
    // the records to look at instead of failing the whole save with one message.
    expect(err.entityErrors).toHaveLength(1);
    expect(err.entityErrors[0].entity).toBe(cust);
    expect(err.entityErrors[0].errorName).toBe('ConcurrencyError');

    // The error is on the entity, not on a property: the row is stale as a whole, and the
    // concurrency column is not something the user edited or can usually see.
    const ves = cust.entityAspect.getValidationErrors();
    expect(ves).toHaveLength(1);
    expect(ves[0].property).toBeUndefined();
    expect(ves[0].isServerError).toBe(true);

    // The changes survive, so the caller can merge them against a fresh read.
    expect(cust.entityAspect.entityState.isModified()).toBe(true);
  });

  test("are not confused with the other 409", async () => {
    // The isolation this whole mechanism exists for. Same status, same content type, different
    // recovery - only `type` separates them.
    respond = () => problemResponse({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: "Violation of UNIQUE KEY constraint 'IX_Customer_CompanyName'.",
    }, 'application/problem+json', 409);

    const { err } = await failedSave();
    expect(err.status).toBe(409);
    expect(isConcurrencyError(err)).toBe(false);
  });

  test("the problem type survives alongside the legacy members", async () => {
    // The default server configuration: RFC members and the pre-3.0 capitalised ones together.
    // The legacy branch of createError must not lose `type` on its way past.
    respond = () => concurrencyResponse({
      Code: 409,
      Message: 'The save failed because 1 record was changed or deleted by another user after it was read.',
      EntityErrors: [{
        ErrorName: 'ConcurrencyError', EntityTypeName: 'Foo.Customer', KeyValues: [CUST_ID],
        PropertyName: null, ErrorMessage: 'This record was changed or deleted by another user after it was read.',
      }],
      entityErrors: undefined,
    });
    const { err, cust } = await failedSave();

    expect(isConcurrencyError(err)).toBe(true);
    expect(err.entityErrors[0].entity).toBe(cust);
  });

  test("a server that sends no problem type is reported as not a concurrency error", async () => {
    // What a pre-3.0 Breeze server does with a stale row: a 500 carrying the ORM's own words.
    // There is nothing dependable to infer from, so the answer is false rather than a guess -
    // an application talking to such a server has to keep matching on the message, and should
    // know that it is doing so.
    respond = () => problemResponse({
      Code: 500,
      Message: 'The database operation was expected to affect 1 row(s), but actually affected 0 row(s)...',
    }, 'application/json', 500);

    const { err } = await failedSave();
    expect(err.problemType).toBeUndefined();
    expect(isConcurrencyError(err)).toBe(false);
  });

  test("isConcurrencyError tolerates whatever it is handed", async () => {
    expect(isConcurrencyError(undefined)).toBe(false);
    expect(isConcurrencyError(null)).toBe(false);
    expect(isConcurrencyError(new Error('boom'))).toBe(false);
    expect(isConcurrencyError({ status: 409 })).toBe(false);
    expect(isConcurrencyError('a string')).toBe(false);
  });

});
