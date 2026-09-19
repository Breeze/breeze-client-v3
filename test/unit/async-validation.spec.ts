import {
  configureBreeze, DataService, EntityManager, EntityState, MetadataStore, NamingConvention, SaveOptions, Validator,
} from '../../src/breeze';
import type { Entity, ValidationErrorsChangedEventArgs, ValidationMessageContext } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import metadata from '../support/NorthwindIBMetadata.json';

// Async validators: a validator whose function returns a promise - a uniqueness check, a rule
// only the server can answer. Breeze runs one only where the answer can be awaited: when the entity
// is saved, and from validateEntityAsync / validatePropertyAsync. Never on a property change,
// attach or query, where nothing could wait for it.

const calls: string[] = [];
DataServiceWebApiAdapter.register();
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  namingConvention: NamingConvention.camelCase,
  fetch: async (input, init) => {
    calls.push(String(input));
    // Echo the saved entities back, as the server would.
    const bundle = JSON.parse(init!.body as string);
    bundle.entities.forEach((e: any) => { e.$type = e.entityAspect.entityTypeName; delete e.entityAspect; });
    return new Response(JSON.stringify(bundle), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});

let ms: MetadataStore;
function newManager() {
  const ds = new DataService({ serviceName: 'http://example.invalid/breeze/Northwind', hasServerMetadata: false });
  ms.addDataService(ds);
  return new EntityManager({ dataService: ds, metadataStore: ms });
}

beforeEach(() => {
  calls.length = 0;
  ms = new MetadataStore();       // a store per test, so the validators one adds do not leak
  ms.importMetadata(metadata);
});

/** A promise, and the function that settles it - to decide when an async validator answers. */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise(r => setTimeout(r, 0));

/** An async "is this company name still free?" check on Customer.companyName. */
function addUniqueNameValidator(taken: string[] = ['Taken Co']) {
  const seen: { value: any, signal?: AbortSignal }[] = [];
  const validator = new Validator('uniqueName', async (value: any, ctx: ValidationMessageContext) => {
    seen.push({ value, signal: ctx.signal });
    await settle();
    return !taken.includes(value);
  }, { messageTemplate: "'%value%' is already taken" });
  ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(validator);
  return { validator, seen };
}

describe("Validator.isAsync", () => {

  test("is true for an async function, or when the context says so", () => {
    expect(new Validator('a', async () => true).isAsync).toBe(true);
    expect(new Validator('b', () => true).isAsync).toBe(false);
    expect(new Validator('c', () => Promise.resolve(true), { isAsync: true }).isAsync).toBe(true);
  });

  test("validate() refuses an async validator, and points at validateAsync()", () => {
    expect(() => new Validator('a', async () => true).validate('x')).toThrow(/validateAsync/);
  });

  // A promise is truthy, so an unmarked promise-returning validator used to pass every value.
  test("a validator that returns a promise without saying so is treated as async from then on", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
    try {
      const v = new Validator('sneaky', () => Promise.resolve(false));
      expect(v.validate('x')).toBeNull();          // this answer is ignored, not taken as a pass
      expect(v.isAsync).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('sneaky');
    } finally {
      warn.mockRestore();
    }
  });

  test("validateAsync gives each call its own context, so overlapping calls keep their messages", async () => {
    const v = new Validator('slow', async (value: any) => { await settle(); return false; },
      { messageTemplate: "'%value%' is not allowed" });
    const [a, b] = await Promise.all([v.validateAsync('first'), v.validateAsync('second')]);
    expect(a!.errorMessage).toBe("'first' is not allowed");
    expect(b!.errorMessage).toBe("'second' is not allowed");
  });

  test("validateAsync runs a sync validator too", async () => {
    expect(await Validator.maxLength({ maxLength: 3 }).validateAsync('abcd')).not.toBeNull();
    expect(await Validator.maxLength({ maxLength: 3 }).validateAsync('abc')).toBeNull();
  });

  test("a validator that rejects gives an error, as one that throws does", async () => {
    const v = new Validator('broken', async () => { throw new Error('network down'); });
    const ve = await v.validateAsync('x');
    expect(ve!.errorMessage).toContain('broken');
  });

});

describe("async validators are not run where nothing could wait for them", () => {

  test("not on a property change, an attach, or validateEntity", () => {
    const { seen } = addUniqueNameValidator();
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Taken Co' });   // attach
    cust.setProperty('companyName', 'Other');                                // property change
    expect(cust.entityAspect.validateEntity()).toBe(true);
    expect(seen).toEqual([]);
  });

});

describe("EntityAspect.validateEntityAsync and validatePropertyAsync", () => {

  test("run the async validators, and add or remove their errors", async () => {
    addUniqueNameValidator();
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Taken Co' });
    const changes: ValidationErrorsChangedEventArgs[] = [];
    em.validationErrorsChanged.subscribe(args => changes.push(args));

    expect(await cust.entityAspect.validateEntityAsync()).toBe(false);
    const [error] = cust.entityAspect.getValidationErrors('companyName');
    expect(error.errorMessage).toBe("'Taken Co' is already taken");
    expect(changes.map(c => c.added.length)).toEqual([1]);

    cust.setProperty('companyName', 'Free Co');
    expect(await cust.entityAspect.validatePropertyAsync('companyName')).toBe(true);
    expect(cust.entityAspect.getValidationErrors()).toEqual([]);
  });

  test("an async validator's settled answer counts in the sync validateEntity", async () => {
    addUniqueNameValidator();
    const cust = newManager().createEntity('Customer', { companyName: 'Taken Co' });
    await cust.entityAspect.validateEntityAsync();
    expect(cust.entityAspect.validateEntity()).toBe(false);   // the async error still stands
  });

  // As with the server's errors: it was about a value the entity no longer has, and nothing
  // re-checks it until the next save or validateEntityAsync.
  test("editing the property clears its async error", async () => {
    addUniqueNameValidator();
    const cust = newManager().createEntity('Customer', { companyName: 'Taken Co' });
    await cust.entityAspect.validateEntityAsync();
    cust.setProperty('companyName', 'Taken Co, again');
    expect(cust.entityAspect.getValidationErrors()).toEqual([]);
    expect(cust.entityAspect.validateEntity()).toBe(true);
  });

  test("isValidating is true while a check runs", async () => {
    const answer = deferred<boolean>();
    ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(
      new Validator('waits', () => answer.promise, { isAsync: true }));
    const cust = newManager().createEntity('Customer', { companyName: 'Acme' });

    const done = cust.entityAspect.validateEntityAsync();
    expect(cust.entityAspect.isValidating).toBe(true);
    answer.resolve(true);
    expect(await done).toBe(true);
    expect(cust.entityAspect.isValidating).toBe(false);
  });

  test("a newer run of a check replaces an older one, which then waits for the newer answer", async () => {
    const answers = [deferred<boolean>(), deferred<boolean>()];
    const signals: AbortSignal[] = [];
    let n = 0;
    ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(new Validator('two', (v: any, ctx) => {
      signals.push(ctx.signal!);
      return answers[n++].promise;
    }, { isAsync: true }));
    const cust = newManager().createEntity('Customer', { companyName: 'Acme' });

    const first = cust.entityAspect.validateEntityAsync();
    const second = cust.entityAspect.validateEntityAsync();
    expect(signals[0].aborted).toBe(true);       // the first run's answer will not be used
    answers[0].resolve(false);                  // the old answer arrives, and is ignored
    await settle();
    expect(cust.entityAspect.getValidationErrors()).toEqual([]);
    answers[1].resolve(true);
    expect(await first).toBe(true);             // both report the newer answer
    expect(await second).toBe(true);
  });

  test("a value that changed while it was checked is checked again", async () => {
    const answer = deferred<boolean>();
    const values: any[] = [];
    ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(new Validator('recheck', (v: any) => {
      values.push(v);
      return values.length === 1 ? answer.promise : Promise.resolve(v !== 'Taken Co');
    }, { isAsync: true }));
    const cust = newManager().createEntity('Customer', { companyName: 'Acme' });

    const done = cust.entityAspect.validateEntityAsync();
    cust.setProperty('companyName', 'Taken Co');   // edited while the first check is out
    answer.resolve(true);                          // true for 'Acme' - not for what it now holds
    expect(await done).toBe(false);
    expect(values).toEqual(['Acme', 'Taken Co']);
  });

  test("detaching the entity abandons its checks", async () => {
    const answer = deferred<boolean>();
    let signal: AbortSignal | undefined;
    ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(new Validator('late', (v: any, ctx) => {
      signal = ctx.signal;
      return answer.promise;
    }, { isAsync: true }));
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Acme' });

    const done = cust.entityAspect.validateEntityAsync();
    em.detachEntity(cust);
    expect(signal!.aborted).toBe(true);
    answer.resolve(false);
    await done;
    expect(cust.entityAspect.getValidationErrors()).toEqual([]);
    expect(cust.entityAspect.isValidating).toBe(false);
  });

  test("an entity-level async validator runs too", async () => {
    ms.getAsEntityType('Customer').validators.push(new Validator('creditCheck', async (cust: Entity) => {
      await settle();
      return cust.getProperty('companyName') !== 'Deadbeat Inc';
    }));
    const cust = newManager().createEntity('Customer', { companyName: 'Deadbeat Inc' });
    expect(await cust.entityAspect.validateEntityAsync()).toBe(false);
    expect(cust.entityAspect.getValidationErrors()[0].validator!.name).toBe('creditCheck');
  });

  test("an async validator on a property of a complex type runs too", async () => {
    ms.getAsComplexType('Location').getProperty('city')!.validators.push(
      new Validator('knownCity', async (city: any) => { await settle(); return city !== 'Atlantis'; }));
    const supplier = newManager().createEntity('Supplier', { companyName: 'S', location: { city: 'Atlantis' } });
    expect(await supplier.entityAspect.validateEntityAsync()).toBe(false);
    expect(supplier.entityAspect.getValidationErrors()[0].propertyName).toBe('location.city');
  });

});

describe("saveChanges waits for async validators", () => {

  test("an entity that fails one is not sent, and the save rejects with its errors", async () => {
    addUniqueNameValidator();
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Taken Co' });

    const err = await em.saveChanges().catch(e => e);
    expect(err.entityErrors).toHaveLength(1);
    expect(err.entityErrors[0].errorMessage).toBe("'Taken Co' is already taken");
    expect(calls).toEqual([]);
    expect(cust.entityAspect.isBeingSaved).toBe(false);
    expect(cust.entityAspect.entityState).toBe(EntityState.Added);
  });

  test("an entity that passes is sent", async () => {
    const { seen } = addUniqueNameValidator();
    const em = newManager();
    em.createEntity('Customer', { companyName: 'Free Co' });

    const result = await em.saveChanges();
    expect(seen.map(s => s.value)).toEqual(['Free Co']);
    expect(calls).toHaveLength(1);
    expect(result.entities).toHaveLength(1);
  });

  test("while it waits, the entities count as being saved, so a second save is refused", async () => {
    const answer = deferred<boolean>();
    ms.getAsEntityType('Customer').getProperty('companyName')!.validators.push(
      new Validator('waits', () => answer.promise, { isAsync: true }));
    const em = newManager();
    em.createEntity('Customer', { companyName: 'Acme' });

    const first = em.saveChanges();
    const second = await em.saveChanges(null, new SaveOptions({ allowConcurrentSaves: false })).catch(e => e);
    expect(second.message).toContain('Concurrent saves not allowed');
    answer.resolve(true);
    await first;
    expect(calls).toHaveLength(1);
  });

  test("a deleted entity is not validated", async () => {
    const { seen } = addUniqueNameValidator();
    const em = newManager();
    const cust = em.createEntity('Customer', { companyName: 'Taken Co' }, EntityState.Unchanged);
    cust.entityAspect.setDeleted();
    await em.saveChanges();
    expect(seen).toEqual([]);
  });

  test("with validateOnSave off, they are not run", async () => {
    const { seen } = addUniqueNameValidator();
    const em = newManager();
    em.validationOptions = em.validationOptions.using({ validateOnSave: false });
    em.createEntity('Customer', { companyName: 'Taken Co' });
    await em.saveChanges();
    expect(seen).toEqual([]);
    expect(calls).toHaveLength(1);
  });

});
