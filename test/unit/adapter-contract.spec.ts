import {
  configureBreeze, AbstractDataServiceAdapter, EntityManager, EntityQuery, EntityState, MetadataStore, DataService,
  NamingConvention, JsonResultsAdapter,
} from '../../src/breeze';
import type { Entity, HttpResponse, SaveBundle, SaveContext } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// The data service adapter contract, exercised end to end with a fake fetch: the errors a
// failed request produces, save responses, the change request interceptor, and
// materialization errors. No ajax adapter is registered, so requests go through config.fetch.

const calls: { url: string, init?: RequestInit }[] = [];
let respond: (url: string, init?: RequestInit) => Response;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Answers a save by echoing the saved entities back, as the server would. */
function echoSave(url: string, init?: RequestInit) {
  const bundle = JSON.parse(init!.body as string);
  bundle.entities.forEach((e: any) => {
    e.$type = e.entityAspect.entityTypeName;
    delete e.entityAspect;
  });
  return json(bundle);
}

const dsAdapter = DataServiceWebApiAdapter.register();
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(String(input), init);
  },
});

function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  return new EntityManager({ dataService: ds, metadataStore: ms });
}

function savedBundle(ix: number) {
  return JSON.parse(calls[ix].init!.body as string);
}

/** Runs fn, and collects any unhandled rejections raised while it runs or just after. */
async function collectUnhandledRejections(fn: () => Promise<unknown>) {
  const seen: unknown[] = [];
  // The suite runs in Node and in Chromium, which report unhandled rejections through
  // different hooks: process 'unhandledRejection' in Node, a window event in the browser.
  const nodeProcess = (globalThis as any).process;
  const onNode = (reason: unknown) => { seen.push(reason); };
  const onBrowser = (e: PromiseRejectionEvent) => { seen.push(e.reason); e.preventDefault(); };
  if (nodeProcess?.on) {
    nodeProcess.on('unhandledRejection', onNode);
  } else {
    globalThis.addEventListener('unhandledrejection', onBrowser);
  }
  try {
    await fn();
    // unhandled rejections are reported once the microtask queue has drained
    await new Promise(r => setTimeout(r, 20));
  } finally {
    if (nodeProcess?.off) {
      nodeProcess.off('unhandledRejection', onNode);
    } else {
      globalThis.removeEventListener('unhandledrejection', onBrowser);
    }
  }
  return seen;
}

beforeEach(() => {
  calls.length = 0;
  respond = () => json([]);
});

describe('the error from a failed request', () => {

  test('carries the status text, URL and body of the response', async () => {
    respond = () => new Response('No such resource', { status: 404, statusText: 'Not Found' });
    const err = await newManager().executeQuery(EntityQuery.from('Customers')).catch(e => e);
    expect(err).toMatchObject({
      status: 404,
      statusText: 'Not Found',
      body: 'No such resource',
      message: 'No such resource',
    });
    expect(err.url).toContain('http://example.invalid/breeze/Northwind/Customers');
    expect(err.httpResponse.statusText).toBe('Not Found');
  });

  test('says the server may be down when the transport fails, keeping its message', async () => {
    respond = () => { throw new TypeError('fetch failed'); };
    const err = await newManager().executeQuery(EntityQuery.from('Customers')).catch(e => e);
    expect(err.status).toBe(0);
    expect(err.message).toContain('fetch failed');
    expect(err.message).toContain('Is the server running?');
  });

  test('does not blame the server for an aborted request', async () => {
    respond = () => { throw new DOMException('This operation was aborted', 'AbortError'); };
    const err = await newManager().executeQuery(EntityQuery.from('Customers')).catch(e => e);
    expect(err.status).toBe(0);
    expect(err.message).toContain('aborted');
    expect(err.message).not.toContain('Is the server running?');
  });

  test('_catchNoConnectionError still fills in a missing message, and applies only once', () => {
    const err = { status: 0, message: '' } as any;
    AbstractDataServiceAdapter._catchNoConnectionError(err);
    expect(err.message).toBe('HTTP response status 0 and no message.  ' +
      'Likely did not or could not reach server. Is the server running?');
    const again = err.message;
    AbstractDataServiceAdapter._catchNoConnectionError(err);
    expect(err.message).toBe(again);
  });

  test('can be built by an adapter that makes its own requests', () => {
    const httpResponse: HttpResponse = {
      config: { url: 'http://example.invalid/api/thing' },
      data: JSON.stringify({ Message: 'Not today' }),
      status: 500,
      statusText: 'Internal Server Error',
      getHeaders: () => '',
    };
    const err = AbstractDataServiceAdapter.makeHttpError(httpResponse, 'Thing failed');
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({
      message: 'Thing failed; Not today',
      status: 500,
      statusText: 'Internal Server Error',
      url: 'http://example.invalid/api/thing',
      httpResponse,
    });
  });

});

describe('save responses', () => {

  test('a response with no body rejects with a clear error', async () => {
    respond = () => json(null);
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Test Co' });
    const err = await em.saveChanges().catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('had no body');
    expect(err.status).toBe(200);
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

});

describe('the change request interceptor', () => {

  class Mark {
    constructor(public saveContext: SaveContext, public saveBundle: SaveBundle) { }
    getRequest(request: any, entity: Entity, index: number) {
      request.marked = true;
      return request;
    }
    done(requests: object[]) { }
  }

  class MarkOnce extends Mark {
    oneTime = true;
  }

  async function saveOne(em: EntityManager) {
    em.createEntity('Customer', { companyName: 'Test Co' });
    await em.saveChanges();
  }

  const original = dsAdapter.changeRequestInterceptor;
  afterEach(() => { dsAdapter.changeRequestInterceptor = original; });

  test('with oneTime set, intercepts one save and then reverts to the default', async () => {
    respond = echoSave;
    const em = newManager();
    dsAdapter.changeRequestInterceptor = MarkOnce;

    await saveOne(em);
    await saveOne(em);

    expect(savedBundle(0).entities[0].marked).toBe(true);
    expect(savedBundle(1).entities[0].marked).toBeUndefined();
    expect(dsAdapter.changeRequestInterceptor).not.toBe(MarkOnce);
  });

  test('without oneTime, intercepts every save', async () => {
    respond = echoSave;
    const em = newManager();
    dsAdapter.changeRequestInterceptor = Mark;

    await saveOne(em);
    await saveOne(em);

    expect(savedBundle(0).entities[0].marked).toBe(true);
    expect(savedBundle(1).entities[0].marked).toBe(true);
    expect(dsAdapter.changeRequestInterceptor).toBe(Mark);
  });

});

describe('materialization errors', () => {

  test('a throwing visitNode rejects the query, with no unhandled rejection', async () => {
    respond = () => json([{ $type: 'Customer', customerID: 'x' }]);
    const jra = new JsonResultsAdapter({
      name: 'throws',
      visitNode: () => { throw new Error('visitNode failed'); },
    });
    const query = EntityQuery.from('Customers').using(jra);
    const unhandled = await collectUnhandledRejections(async () => {
      await expect(newManager().executeQuery(query)).rejects.toThrow('visitNode failed');
    });
    expect(unhandled).toEqual([]);
  });

  test('an untyped navigation node rejects the query, with no unhandled rejection', async () => {
    // The case this was first seen with: the root is typed but its navigation node is not,
    // so Breeze tries to link a plain object as the related entity.
    respond = () => json([{ OrderID: 1, CustomerID: 'C1', Customer: { CustomerID: 'C1', CompanyName: 'Co' } }]);
    const jra = new JsonResultsAdapter({
      name: 'untypedNav',
      visitNode: (node, mappingContext, nodeContext) => nodeContext.nodeType === 'root'
        ? { entityType: mappingContext.metadataStore.getAsEntityType('Order')! }
        : {},
    });
    const query = EntityQuery.from('Orders').using(jra);
    const unhandled = await collectUnhandledRejections(async () => {
      await expect(newManager().executeQuery(query)).rejects.toThrow();
    });
    expect(unhandled).toEqual([]);
  });

});
