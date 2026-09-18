// Angular's packages are partially compiled; outside an Angular build they need the JIT compiler
// loaded before anything from them is imported.
import '@angular/compiler';
import {
  HttpClient, HttpErrorResponse, HttpHeaders, HttpRequest, HttpResponse,
  type HttpEvent, type HttpHandler,
} from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import {
  configureBreeze, DataService, EntityManager, EntityQuery, EntityState, MetadataStore, NamingConvention,
  isConcurrencyError,
} from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { httpClientFetch } from '../../src/angular/adapter-angular-httpclient';
import metadata from '../support/NorthwindIBMetadata.json';

// breeze-client/adapter-angular-httpclient, run through Angular's real HttpClient, HttpErrorResponse
// and HttpHeaders. Only the backend is a stand-in: it answers the way Angular's own backends do,
// returning a 2xx as an HttpResponse and turning anything else into a thrown HttpErrorResponse.
// That throw is the whole reason the adapter exists - let through, it loses a rejected save's
// status and body, so entityErrors never arrive and a 409 is not a concurrency conflict.

interface Reply { status: number; body?: string; contentType?: string }

/** A backend that records each request and answers it as Angular's backends would. */
function backend(reply: (req: HttpRequest<any>) => Reply) {
  const requests: HttpRequest<any>[] = [];
  const handler: HttpHandler = {
    handle(req: HttpRequest<any>): Observable<HttpEvent<any>> {
      requests.push(req);
      const { status, body = '', contentType = 'application/json' } = reply(req);
      const headers = new HttpHeaders({ 'Content-Type': contentType });
      if (status === 0) {
        return throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error', error: { type: 'error' }, url: req.url }));
      }
      if (status >= 200 && status < 300) {
        return of(new HttpResponse({ status, statusText: 'OK', body, headers, url: req.url }));
      }
      return throwError(() => new HttpErrorResponse({ status, statusText: 'Error', error: body, headers, url: req.url }));
    },
  };
  return { http: new HttpClient(handler), requests };
}

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  dataService: DataServiceWebApiAdapter,
  namingConvention: NamingConvention.camelCase,
});

const CUST_ID = '11111111-1111-1111-1111-111111111111';

function manager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  return new EntityManager({ dataService: ds, metadataStore: ms });
}

/** A manager holding one changed customer, and the promise of saving it. */
function save(reply: (req: HttpRequest<any>) => Reply) {
  const { http, requests } = backend(reply);
  configureBreeze({ fetch: httpClientFetch(http) });
  const em = manager();
  const cust = em.createEntity('Customer', { customerID: CUST_ID, companyName: 'Acme' }, EntityState.Unchanged);
  cust.setProperty('companyName', 'Changed');
  return { result: em.saveChanges().then(r => r, (e: any) => e), requests, cust };
}

const problem = (status: number, type: string, extra: object = {}) => JSON.stringify({
  type, title: 'Save failed', status, detail: 'Save failed', ...extra,
});

describe('breeze-client/adapter-angular-httpclient', () => {

  test('sends a query through HttpClient, and Breeze materializes the answer', async () => {
    const { http, requests } = backend(() => ({
      status: 200, body: JSON.stringify([{ $type: 'Customer:#Foo', CustomerID: CUST_ID, CompanyName: 'Acme' }]),
    }));
    configureBreeze({ fetch: httpClientFetch(http) });

    const qr = await manager().executeQuery(EntityQuery.from('Customers').toType('Customer'));

    expect(qr.results.map((c: any) => c.companyName)).toEqual(['Acme']);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toContain('/breeze/Northwind/Customers');
  });

  test("sends a save as a POST with Breeze's JSON body and Content-Type", async () => {
    const { result, requests, cust } = save(req => ({
      status: 200,
      body: JSON.stringify({ Entities: [{ $type: 'Customer:#Foo', CustomerID: CUST_ID, CompanyName: 'Changed' }], KeyMappings: [] }),
    }));

    const saved: any = await result;

    expect(saved.entities).toHaveLength(1);
    expect(cust.entityAspect.entityState.isUnchanged()).toBe(true);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(requests[0].body).entities[0].CompanyName).toBe('Changed');
  });

  test("hands Breeze a rejected save's status and body, so entityErrors arrive", async () => {
    const err: any = await save(() => ({
      status: 400, contentType: 'application/problem+json',
      body: problem(400, 'https://breeze.github.io/problems/entity-errors', {
        entityErrors: [{ errorName: 'ServerRule', entityTypeName: 'Foo.Customer', keyValues: [CUST_ID],
          propertyName: 'CompanyName', errorMessage: 'That name is taken' }],
      }),
    })).result;

    expect(err.status).toBe(400);
    expect(err.entityErrors).toHaveLength(1);
    expect(err.entityErrors[0].errorMessage).toBe('That name is taken');
  });

  test('hands Breeze a 409, so it is recognised as a concurrency conflict', async () => {
    const err: any = await save(() => ({
      status: 409, contentType: 'application/problem+json',
      body: problem(409, 'https://breeze.github.io/problems/concurrency-conflict'),
    })).result;

    expect(err.status).toBe(409);
    expect(isConcurrencyError(err)).toBe(true);
  });

  test('leaves a request that never completed to fail, as a transport failure', async () => {
    const err: any = await save(() => ({ status: 0 })).result;
    expect(err.status).toBe(0);
  });

  test('accepts a 204 with no body - new Response() would throw if given one', async () => {
    const { http } = backend(() => ({ status: 204 }));
    const response = await httpClientFetch(http)('http://example.invalid/x', { method: 'DELETE' });
    expect(response.status).toBe(204);
  });

  test('recognises an HttpErrorResponse from another copy of Angular - by name, not instanceof', async () => {
    // Two Angular copies in one application (a library bundling its own) make instanceof fail.
    const foreign = { name: 'HttpErrorResponse', status: 400, statusText: 'Bad Request', error: '{"message":"no"}',
      headers: new HttpHeaders({ 'Content-Type': 'application/json' }) };
    const http = { request: () => throwError(() => foreign) } as unknown as HttpClient;

    const response = await httpClientFetch(http)('http://example.invalid/x', { method: 'POST' });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"message":"no"}');
  });
});
