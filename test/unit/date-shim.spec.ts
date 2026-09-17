import { DataType, EntityManager, EntityQuery, EntityState, MetadataStore, Validator, config, configureBreeze } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';
import metadata from '../support/NorthwindIBMetadata.json';

// Replacing `Date` with another date library is the Breeze question the API reference cannot
// answer, because the answer is a list of seams rather than one method. These tests ARE that list:
// /guide/date-and-time documents them, and each test here is the one that fails if a seam is
// missed. A new seam in Breeze means a test here and a row there.
//
// The stand-in below is shaped like Luxon's DateTime - fromISO, fromJSDate, toJSDate, toMillis,
// valueOf and toJSON are all real Luxon methods with Luxon's behaviour - so the guide can show
// Luxon code without this repository taking a dependency on it. What is pinned is the seam, not
// the library.

configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  ajax: AjaxFakeAdapter,
  dataService: DataServiceWebApiAdapter,
});

/** A third-party date type. Not a `Date`, and with none of `Date`'s methods. */
class Instant {
  constructor(readonly ms: number) { }
  static fromISO(text: string) { return new Instant(Date.parse(text)); }
  static fromJSDate(date: Date) { return new Instant(date.getTime()); }
  toJSDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
  valueOf() { return this.ms; }
  /** Luxon's toJSON is an ISO 8601 string, which is what makes the save payload work untouched. */
  toJSON() { return new Date(this.ms).toISOString(); }
}

const DATE_TYPES = [DataType.DateTime, DataType.DateTimeOffset];

/** Accepts an Instant where the stock `date` validator accepts only a Date. */
const instantValidator = (context?: any) => new Validator(
  'date',
  (v: any) => v == null || v instanceof Instant || (v instanceof Date && !isNaN(v.getTime())),
  context);

type Saved = { parse: any, parseRawValue: any, normalize: any, defaultValue: any, validatorCtor: any };
let original: Saved[];
let originalDateValidator: any;

/** Every seam a value of a date type passes through. */
function installInstantShim() {
  // Metadata names its validators - `{ "name": "date" }` - and importMetadata resolves each name
  // through this registry, so this has to happen BEFORE the metadata is imported.
  Validator.registerFactory(instantValidator, 'date');
  for (const dt of DATE_TYPES) {
    // server -> client, when a query result is materialized
    dt.parseRawValue = (val: any) =>
      val instanceof Instant ? val : Instant.fromJSDate(DataType.parseDateFromServer(val));
    // client -> client, when a value is assigned to a property
    dt.parse = (source: any, sourceTypeName: string) =>
      sourceTypeName === 'string' ? Instant.fromISO(source) : source;
    // how change tracking and local queries compare two values
    dt.normalize = (value: any) => value instanceof Instant ? value.toMillis() : value;
    // what a new entity's non-nullable property starts as
    dt.defaultValue = new Instant(Date.UTC(1900, 0, 1));
    // for types built in code rather than imported; imported ones go through the registry above
    dt.validatorCtor = instantValidator;
  }
}

/** A manager whose metadata was imported with whatever validators are registered now. */
function newManager() {
  const ms = new MetadataStore();
  ms.importMetadata(metadata);
  return new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });
}

beforeEach(() => {
  original = DATE_TYPES.map(dt => ({
    parse: dt.parse, parseRawValue: dt.parseRawValue, normalize: dt.normalize,
    defaultValue: dt.defaultValue, validatorCtor: dt.validatorCtor,
  }));
  originalDateValidator = config.getRegisteredFunction('Validator.date');
});

afterEach(() => {
  // DataType members and the validator registry are global; a shim left installed would reach
  // every later test in this file.
  DATE_TYPES.forEach((dt, i) => Object.assign(dt, original[i]));
  Validator.registerFactory(originalDateValidator, 'date');
});

describe("swapping in another date type", () => {

  test("a query result materializes as the shimmed type", async () => {
    installInstantShim();
    const em = newManager();
    const ajax = AjaxFakeAdapter.register();
    ajax.responseFn = () => [{ OrderID: 1, OrderDate: '2024-03-15T10:30:00Z' }];

    const qr = await em.executeQuery(EntityQuery.from('Orders').toType('Order'));
    const orderDate = (qr.results[0] as any).orderDate;

    expect(orderDate).toBeInstanceOf(Instant);
    expect(orderDate.toJSDate().toISOString()).toBe('2024-03-15T10:30:00.000Z');
  });

  test("parseRawValue keeps Breeze's rule for an offset-less server string", () => {
    installInstantShim();
    // Going through DataType.parseDateFromServer rather than the library's own parser is what
    // keeps the "no offset means UTC" rule: Luxon's fromISO would read this as local time.
    const utc = DataType.parseRawValue('2024-03-15T10:30:00.000', DataType.DateTime);
    expect(utc.toJSDate().toISOString()).toBe('2024-03-15T10:30:00.000Z');
  });

  test("an assigned string is converted, and an assigned instance is kept", () => {
    installInstantShim();
    const order = newManager().createEntity('Order', { orderID: 1 }) as any;

    order.orderDate = '2024-03-15T10:30:00Z';
    expect(order.orderDate).toBeInstanceOf(Instant);

    const instant = Instant.fromISO('2024-06-01T00:00:00Z');
    order.orderDate = instant;
    expect(order.orderDate).toBe(instant);
  });

  test("change tracking sees a different value and ignores an equal one", () => {
    installInstantShim();
    const order = newManager().createEntity('Order',
      { orderID: 1, orderDate: Instant.fromISO('2024-03-15T10:30:00Z') }) as any;
    order.entityAspect.setUnchanged();

    // a different instance of the same instant: equal, so not a change
    order.orderDate = Instant.fromISO('2024-03-15T10:30:00Z');
    expect(order.entityAspect.entityState).toBe(EntityState.Unchanged);

    order.orderDate = Instant.fromISO('2024-03-16T10:30:00Z');
    expect(order.entityAspect.entityState).toBe(EntityState.Modified);
  });

  // The seam that fails silently, which is why the guide leads with `normalize`.
  test("without normalize, every change is invisible and hasChanges stays false", () => {
    installInstantShim();
    for (const dt of DATE_TYPES) dt.normalize = original[0].normalize;   // the stock getTime() one
    const em = newManager();
    const order = em.createEntity('Order',
      { orderID: 1, orderDate: Instant.fromISO('2024-03-15T10:30:00Z') }) as any;
    order.entityAspect.setUnchanged();

    // The stock normalize reads value.getTime, which an Instant does not have, so both sides of
    // the comparison come out undefined and every assignment looks like a no-op.
    order.orderDate = Instant.fromISO('2099-01-01T00:00:00Z');
    expect(order.entityAspect.entityState).toBe(EntityState.Unchanged);
    expect(em.hasChanges()).toBe(false);
  });

  // The other seam that is easy to miss, and this one at least fails loudly.
  test("without a validator that knows the type, a save is rejected", async () => {
    installInstantShim();
    Validator.registerFactory(originalDateValidator, 'date');   // the stock one, which wants a Date
    const em = newManager();
    em.createEntity('Order', { orderID: 1, orderDate: Instant.fromISO('2024-03-15T10:30:00Z') });

    await expect(em.saveChanges()).rejects.toThrow(/validation errors/i);
  });

  test("a save sends the ISO string the server expects, with no adapter change", async () => {
    installInstantShim();
    const em = newManager();
    const ajax = AjaxFakeAdapter.register();
    let sent: any;
    ajax.responseFn = (cfg: any) => {
      sent = JSON.parse(cfg.data);
      // answer with what the client sent, in the shape a server would use
      const entities = sent.entities.map((e: any) => {
        const copy = { ...e, $type: e.entityAspect.entityTypeName };
        delete copy.entityAspect;
        return copy;
      });
      return { Entities: entities, KeyMappings: [] };
    };

    em.createEntity('Order', { orderID: 1, orderDate: Instant.fromISO('2024-03-15T10:30:00Z') });
    await em.saveChanges();

    // JSON.stringify calls toJSON() on the value, so a type with Luxon's toJSON needs nothing else.
    expect(sent.entities[0].OrderDate).toBe('2024-03-15T10:30:00.000Z');
  });

  test("a predicate takes a Date, not the shimmed type", () => {
    installInstantShim();
    const em = newManager();
    ['2024-03-16T00:00:00Z', '2024-03-14T00:00:00Z', '2024-03-15T00:00:00Z'].forEach((iso, i) =>
      em.createEntity('Order', { orderID: i + 1, orderDate: Instant.fromISO(iso) }));
    const cutoff = Instant.fromISO('2024-03-14T12:00:00Z');

    // Predicate values are not run through DataType.parse: an object is taken as a literal only
    // when it looks like a Date, which Breeze tests for with `toISOString`. The predicate is not
    // resolved until it runs, so this throws at execution rather than at where().
    const bad = EntityQuery.from('Orders').where('orderDate', '>', cutoff);
    expect(() => em.executeQueryLocally(bad)).toThrow(/Unable to resolve an expression/);

    const q = EntityQuery.from('Orders').where('orderDate', '>', cutoff.toJSDate()).orderBy('orderDate');
    expect((em.executeQueryLocally(q) as any[]).map(o => o.orderID)).toEqual([3, 1]);
  });

  test("a default value named in the metadata is converted by parse", () => {
    installInstantShim();
    // A Breeze .NET server writes a default for every non-nullable property, as a string.
    const user = newManager().createEntity('User', {}) as any;

    expect(user.createdDate).toBeInstanceOf(Instant);
    expect(user.createdDate.toJSDate().toISOString()).toBe('1900-01-01T08:00:00.000Z');
  });

  // DateOnly has one seam of its own: it is the only date type Breeze serializes by hand rather
  // than through JSON.stringify, because an ISO instant would carry a time the server rejects.
  test("DateOnly also needs DataType.toDateOnlyString, which both outbound paths call", async () => {
    installInstantShim();
    const originalToDateOnly = DataType.toDateOnlyString;
    const originalDateOnly = { parse: DataType.DateOnly.parse, normalize: DataType.DateOnly.normalize };
    DataType.DateOnly.parse = (source: any, t: string) => t === 'string' ? Instant.fromISO(source) : source;
    DataType.DateOnly.normalize = (v: any) => v instanceof Instant ? v.toMillis() : v;
    DataType.toDateOnlyString = (val: any) =>
      val instanceof Instant ? val.toJSDate().toISOString().substring(0, 10) : originalToDateOnly(val);
    try {
      const em = newManager();
      const ajax = AjaxFakeAdapter.register();
      let sent: any;
      ajax.responseFn = (cfg: any) => {
        sent = JSON.parse(cfg.data);
        const entities = sent.entities.map((e: any) => {
          const copy = { ...e, $type: e.entityAspect.entityTypeName };
          delete copy.entityAspect;
          return copy;
        });
        return { Entities: entities, KeyMappings: [] };
      };

      em.createEntity('UnusualDate', { id: 1, dateOnly: Instant.fromISO('2024-03-15T00:00:00Z') });
      await em.saveChanges();

      // a plain date, not an instant - without the hook this would be a full ISO string
      expect(sent.entities[0].DateOnly).toBe('2024-03-15');
    } finally {
      DataType.toDateOnlyString = originalToDateOnly;
      Object.assign(DataType.DateOnly, originalDateOnly);
    }
  });

  test("with no default in the metadata, the shimmed DataType.defaultValue is used", () => {
    installInstantShim();
    const md = JSON.parse(JSON.stringify(metadata));
    const prop = md.structuralTypes.find((t: any) => t.shortName === 'UnusualDate')
      .dataProperties.find((p: any) => p.name === 'modificationDate');
    delete prop.defaultValue;
    const ms = new MetadataStore();
    ms.importMetadata(md);
    const em = new EntityManager({ serviceName: 'breeze/Northwind', metadataStore: ms });

    const row = em.createEntity('UnusualDate', {}) as any;
    expect(row.modificationDate).toBeInstanceOf(Instant);
    expect(row.modificationDate.toJSDate().toISOString()).toBe('1900-01-01T00:00:00.000Z');
  });
});
