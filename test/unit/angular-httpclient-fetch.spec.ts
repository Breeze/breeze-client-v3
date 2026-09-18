import { firstValueFrom, Observable, of, throwError } from 'rxjs';
import {
  configureBreeze, DataService, EntityManager, EntityQuery, EntityState, MetadataStore, NamingConvention,
} from '../../src/breeze';
import type { BreezeFetch } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// The BreezeFetch that routes Breeze through Angular's HttpClient, from docs/guide/angular.md.
//
// Angular is not a dependency of this repository, so HttpClient is played by stand-ins with its
// shape and, above all, its one behaviour that matters here: on a non-2xx status it does not
// return the response, it THROWS an HttpErrorResponse carrying the status, statusText, body
// (`error`) and headers. The sketch this replaces let that throw escape, so Breeze saw every server
// error as a transport failure: status 0, no body - no entityErrors from a failed save, no
// concurrency conflict from a 409. The bridge below is the guide's, with Angular's classes swapped
// for the stand-ins.

class HttpHeaders {
  constructor(private readonly map: Record<string, string> = {}) { }
  keys() { return Object.keys(this.map); }
  get(name: string) { return this.map[name] ?? null; }
}
class HttpErrorResponse {
  constructor(readonly status: number, readonly statusText: string, readonly error: unknown,
    readonly headers = new HttpHeaders()) { }
}
interface HttpResponse { body: string | null; status: number; statusText: string; headers: HttpHeaders }
interface HttpClientLike {
  request(method: string, url: string, options: any): Observable<HttpResponse>;
}

// --- as in docs/guide/angular.md ------------------------------------------------------------------
function httpClientFetch(http: HttpClientLike): BreezeFetch {
  return async (input, init) => {
    try {
      const res = await firstValueFrom(http.request(init?.method ?? 'GET', String(input), {
        body: init?.body ?? null,
        headers: init?.headers as Record<string, string>,
        observe: 'response',
        responseType: 'text',
      }));
      return toResponse(res.body, res.status, res.statusText, res.headers);
    } catch (e) {
      // HttpClient throws on a non-2xx status. Breeze needs that response: its status and body are
      // how a 400 becomes entityErrors and a 409 a concurrency conflict.
      if (e instanceof HttpErrorResponse && e.status !== 0) {
        return toResponse(e.error, e.status, e.statusText, e.headers);
      }
      throw e;   // status 0: the request never completed - Breeze reports a transport failure
    }
  };
}

function toResponse(body: unknown, status: number, statusText: string, headers: HttpHeaders) {
  const h = new Headers();
  headers.keys().forEach(k => h.set(k, headers.get(k)!));
  const text = typeof body === 'string' ? body : body == null ? null : JSON.stringify(body);
  // A 204 or 304 may not carry a body, and new Response() throws if given one.
  return new Response(status === 204 || status === 304 || text === '' ? null : text, { status, statusText, headers: h });
}
// -------------------------------------------------------------------------------------------------

/** The sketch that used to be in docs/server/transport.md, kept to show what it got wrong. */
function oldSketch(http: HttpClientLike): BreezeFetch {
  return async (input, init) => {
    const body = await firstValueFrom(http.request(init?.method ?? 'GET', String(input),
      { body: init?.body, headers: init?.headers as any, observe: 'response', responseType: 'text' }));
    return new Response(body.body, { status: body.status, statusText: body.statusText });
  };
}

const JSON_HEADERS = new HttpHeaders({ 'content-type': 'application/json' });
const PROBLEM_HEADERS = new HttpHeaders({ 'content-type': 'application/problem+json' });

/** Plays HttpClient: a 2xx is returned, anything else thrown - as Angular does. */
function fakeHttp(status: number, body: string, headers = JSON_HEADERS): HttpClientLike {
  return {
    request: () => status >= 200 && status < 300
      ? of({ body, status, statusText: 'OK', headers })
      : throwError(() => new HttpErrorResponse(status, status === 0 ? 'Unknown Error' : 'Bad Request', body, headers)),
  };
}

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  dataService: DataServiceWebApiAdapter,
  namingConvention: NamingConvention.camelCase,
});

const CUST_ID = '11111111-1111-1111-1111-111111111111';
const SAVE_REJECTED = JSON.stringify({
  type: 'https://breeze.github.io/problems/save-error', title: 'Save failed', status: 400, detail: 'Save failed',
  entityErrors: [{ errorName: 'ServerRule', entityTypeName: 'Foo.Customer', keyValues: [CUST_ID],
    propertyName: 'CompanyName', errorMessage: 'That name is taken' }],
});

function manager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  return new EntityManager({ dataService: ds, metadataStore: ms });
}

async function failedSave(fetchFn: BreezeFetch) {
  configureBreeze({ fetch: fetchFn });
  const em = manager();
  const cust = em.createEntity('Customer', { customerID: CUST_ID, companyName: 'Acme' }, EntityState.Unchanged);
  cust.setProperty('companyName', 'Changed');
  return em.saveChanges().then(() => { throw new Error('should have failed'); }, (e: any) => e);
}

describe('a BreezeFetch over Angular HttpClient', () => {

  test('passes a successful query through', async () => {
    configureBreeze({ fetch: httpClientFetch(fakeHttp(200, JSON.stringify([{ $type: 'Customer:#Foo', CustomerID: CUST_ID, CompanyName: 'Acme' }]))) });
    const qr = await manager().executeQuery(EntityQuery.from('Customers').toType('Customer'));
    expect(qr.results.map((c: any) => c.companyName)).toEqual(['Acme']);
  });

  test("hands Breeze a rejected save's status and body, so entityErrors arrive", async () => {
    const err = await failedSave(httpClientFetch(fakeHttp(400, SAVE_REJECTED, PROBLEM_HEADERS)));
    expect(err.status).toBe(400);
    expect(err.entityErrors).toHaveLength(1);
    expect(err.entityErrors[0].errorMessage).toBe('That name is taken');
  });

  test('reports a request that never completed as a transport failure', async () => {
    const err = await failedSave(httpClientFetch(fakeHttp(0, '')));
    expect(err.status).toBe(0);
  });

  test('where the old sketch lost the status and body entirely', async () => {
    const err = await failedSave(oldSketch(fakeHttp(400, SAVE_REJECTED, PROBLEM_HEADERS)));
    expect(err.status).toBe(0);                   // a 400 reported as "the server may not be running"
    expect(err.entityErrors).toBeUndefined();
  });
});
