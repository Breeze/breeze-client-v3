import { AjaxConfig, EntityManager, SaveResult, config, configureBreeze } from '../../src/breeze';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';

import { enableSaveQueuing } from '../../src/mixins/mixin-save-queuing';

import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';

// jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000;
// configureBreeze registers in dependency order: the data service adapter resolves
// the ajax adapter when it initializes, so ajax must come first. Calling the
// individual register() methods in the wrong order throws.
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  ajax: AjaxFakeAdapter,
  dataService: DataServiceWebApiAdapter,
});
import metadata from '../support/NorthwindIBMetadata.json';

// TODO migrate tests from https://github.com/Breeze/breeze.js.samples/blob/master/net/DocCode/DocCode/tests/saveQueuingTests.js

describe("Save Queuing", () => {

  beforeEach( () => {
    
  });

  test("should save a single add", async () => {

    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);
    enableSaveQueuing(em, true);

    let cust0 = em.createEntity('Customer', { companyName: "FirstCo" });
    expect(cust0.entityType.shortName).toEqual('Customer');

    expect(cust0.entityAspect.validateEntity()).toBeTruthy();
    // console.log(cust0.entityAspect.getValidationErrors());

    const sr = await em.saveChanges();
    let rcust0 = sr.entities[0];
    expect(rcust0.getProperty('companyName')).toEqual("FirstCo");
    expect(rcust0.entityAspect.entityState.name).toEqual("Unchanged");
  });

  test("should fail simultanous saves without SaveQueuing", async () => {

    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);
    enableSaveQueuing(em, false);

    let cust0 = em.createEntity('Customer', { companyName: "FirstCo" });
    em.saveChanges();

    let cust1 = em.createEntity('Customer', { companyName: "SecondCo" });
    try {
      const sr = await em.saveChanges();
      throw new Error("should not allow concurrent saves");
    }
    catch (err) {
      expect(err.message).toMatch("Concurrent saves not allowed");
    }
  });

  test("should allow simultanous saves with SaveQueuing", async () => {

    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);
    enableSaveQueuing(em, true);

    let cust0 = em.createEntity('Customer', { companyName: "FirstCo" });
    let p0 = em.saveChanges();

    let cust1 = em.createEntity('Customer', { companyName: "SecondCo" });
    let p1 = em.saveChanges();

    const sr = await Promise.all([p0, p1]);
    expect(sr.length).toEqual(2);
    expect(sr[0].entities.length).toEqual(1);
    expect(sr[0].entities[0].getProperty('companyName')).toEqual("FirstCo");
    expect(sr[1].entities.length).toEqual(1);
    expect(sr[1].entities[0].getProperty('companyName')).toEqual("SecondCo");
  });


  test("enabling twice does not hang saveChanges", async () => {
    // enableSaveQueuing looked up a misspelled property, so a second call wrapped the
    // already-wrapped saveChanges and the save queued behind itself forever.
    let em = new EntityManager('test');
    em.metadataStore.importMetadata(metadata);
    enableSaveQueuing(em, true);
    enableSaveQueuing(em, true);
    em.createEntity('Customer', { companyName: "FirstCo" });
    const sr = await em.saveChanges();
    expect(sr.entities.length).toBe(1);
  });

  test("can be turned off again", async () => {
    let em = new EntityManager('test');
    em.metadataStore.importMetadata(metadata);
    enableSaveQueuing(em, true);
    enableSaveQueuing(em, false);
    em.createEntity('Customer', { companyName: "FirstCo" });
    const sr = await em.saveChanges();
    expect(sr.entities.length).toBe(1);
  });

});

