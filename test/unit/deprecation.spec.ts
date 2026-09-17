import { struckThrough, breezePath } from '../support/deprecation-probe';

// The callback arguments on Breeze's async methods are deprecated in favour of the promise.
// `tsc` never reports deprecation - it is a language-service feature - so the only way to know
// whether an editor actually strikes a call through is to ask the language service, the way an
// editor does. That machinery lives in test/support/deprecation-probe.ts, shared with
// deprecation-core.spec.ts.
//
// The trap this pins down: because the callback parameters are all optional, a deprecated
// overload declared FIRST also matches `em.executeQuery(query)`, and every caller gets a
// strikethrough for code that is already correct. The promise-only overload has to come first.
// Swap the order in the source and the "promise form" cases below fail.

const PROMISE_FORM = [
  `em.executeQuery(q)`,
  `em.executeQuery('Orders')`,
  `em.saveChanges()`,
  `em.saveChanges([e])`,
  `em.saveChanges([e], so)`,
  `em.fetchMetadata()`,
  `em.fetchMetadata(ds)`,
  `q.execute()`,
  `e.entityAspect.loadNavigationProperty('orders')`,
  `ms.fetchMetadata('breeze/Northwind')`,
];

const CALLBACK_FORM = [
  `em.executeQuery(q, (d: any) => d)`,
  `em.executeQuery('Orders', (d: any) => d)`,
  `em.saveChanges([e], so, (r: any) => r)`,
  `em.fetchMetadata(ds, (r: any) => r)`,
  `q.execute((d: any) => d)`,
  `e.entityAspect.loadNavigationProperty('orders', (d: any) => d)`,
  `ms.fetchMetadata('breeze/Northwind', (r: any) => r)`,
];

const header = `
import { EntityManager, EntityQuery, Entity, SaveOptions, MetadataStore, DataService } from '${breezePath}';
declare const em: EntityManager;
declare const q: EntityQuery;
declare const ms: MetadataStore;
declare const ds: DataService;
declare const e: Entity;
declare const so: SaveOptions;
async function probe() {
`;

describe("the deprecated callback arguments", () => {

  let struck: Set<string>;
  beforeAll(() => {
    struck = struckThrough(header, [...PROMISE_FORM, ...CALLBACK_FORM]);
  }, 30_000);

  test.each(CALLBACK_FORM)("%s is marked deprecated", call => {
    expect(struck.has(call)).toBe(true);
  });

  // The half that actually regresses: an overload ordering mistake flags correct code.
  test.each(PROMISE_FORM)("%s is not", call => {
    expect(struck.has(call)).toBe(false);
  });
});
