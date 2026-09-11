// import { EntityManager } from '../../src/manager/entity-manager';
// import { AjaxFakeAdapter } from '../../src/adapter-ajax-fake';
// import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
// import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
// import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
// import { EntityType, ComplexType } from '../../src/metadata/entity-metadata';
// import { assertConfig } from 'src/assert-param';

import { EntityManager, EntityType, ComplexType, configureBreeze, NamingConvention } from '../../src/breeze';

import { ModelLibraryBackingStoreAdapter } from '../../src/adapters/adapter-model-library-backing-store';
import { UriBuilderJsonAdapter } from '../../src/adapters/adapter-uri-builder-json';
import { DataServiceWebApiAdapter } from '../../src/adapters/adapter-data-service-webapi';
// import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';  // OK
import { AjaxFakeAdapter } from '../support/adapter-ajax-fake';    // OK
import '../test-fns'; // loaded for its side effects (adapter registration, sample metadata)
// import { AjaxFakeAdapter } from '../../src/adapter-ajax-fake'; // BAD

// configureBreeze registers in dependency order: the data service adapter resolves
// the ajax adapter when it initializes, so ajax must come first. Calling the
// individual register() methods in the wrong order throws.
configureBreeze({
  modelLibrary: ModelLibraryBackingStoreAdapter,
  uriBuilder: UriBuilderJsonAdapter,
  ajax: AjaxFakeAdapter,
  dataService: DataServiceWebApiAdapter,
  // ComplexTypeMetadata.json uses PascalCase client property names, so it needs 'none'.
  namingConvention: NamingConvention.none,
});

import metadata from '../support/ComplexTypeMetadata.json';

describe('ComplexType', () => {
  beforeEach(() => { 
    
  });

  test('should create entity and complex type', () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);

    let customer = em.createEntity('Customer', { CompanyName: 'ACME' });
    expect(customer).toBeTruthy();

    let locType = ms.getAsComplexType('Location');
    expect(locType).toBeTruthy();
    let loc1 = locType.createInstance({ City: 'Palookaville' });

    customer.setProperty('Location', loc1);
    let ok = customer.entityAspect.validateEntity();
    expect(ok).toBeTruthy();

    let loc2 = customer.getProperty('Location');
    expect(loc2).toBeTruthy();
    expect(loc2.City).toEqual('Palookaville');

    let errors = em.saveChangesValidateOnClient([customer]);
    expect(errors).toBeNull();
  });

  test('should set array of complex types', async () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);
    expect.assertions(5);

    let customer = em.createEntity('Customer', { CompanyName: 'ACME' });
    expect(customer).toBeTruthy();

    let roleType = ms.getAsComplexType('Role');
    expect(roleType).toBeTruthy();
    let role1 = roleType.createInstance({ Name: 'One' });
    let role2 = roleType.createInstance({ Name: 'Two' });

    let roleProp = customer.getProperty('Roles');
    roleProp.push(role1);
    roleProp.push(role2);

    let errors = em.saveChangesValidateOnClient([customer]);
    expect(errors).toBeNull();

    const sr = await em.saveChanges();

    expect(sr.entities).toBeTruthy();
    expect(sr.entities.length).toEqual(1);
  });

  test('should set array of unmapped entities', async () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);

    let customer = em.createEntity('Customer', { CompanyName: 'ACME' });
    expect(customer).toBeTruthy();

    let orderType = ms.getAsEntityType('Order');
    expect(orderType).toBeTruthy();
    let o1 = orderType.createEntity({ ShipName: 'One', Customer: customer });
    let o2 = orderType.createEntity({ ShipName: 'Two', Customer: customer });

    let orderProp = customer.getProperty('Orders');
    orderProp.push(o1);
    orderProp.push(o2);

    let uProp = customer.getProperty('UnmappedOrders');
    uProp.push(o1);
    uProp.push(o2);

    let errors = em.saveChangesValidateOnClient([customer]);
    expect(errors).toBeNull();

    try {
      const sr = await em.saveChanges();
      expect(sr.entities).toBeTruthy();
      expect(sr.entities.length).toEqual(3);
    } catch (err) {
      console.log(err);
      expect(err).toBeUndefined();
    }
  });

  test('should set array of unmapped many-to-many entities', async () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);

    let customer = em.createEntity('Customer', { CompanyName: 'ACME' });
    expect(customer).toBeTruthy();

    let regionType = ms.getAsEntityType('Region');
    expect(regionType).toBeTruthy();
    let r1 = regionType.createEntity({ Name: 'One' });
    let r2 = regionType.createEntity({ Name: 'Two' });

    let custRegionType = ms.getAsEntityType('CustomerRegion');
    expect(custRegionType).toBeTruthy();
    let cr1 = custRegionType.createEntity({ Customer: customer, Region: r1 });
    let cr2 = custRegionType.createEntity({ Customer: customer, Region: r2 });

    let uProp = customer.getProperty('UnmappedRegions');
    uProp.push(r1);
    uProp.push(r2);

    let errors = em.saveChangesValidateOnClient([customer]);
    expect(errors).toBeNull();

    try {
      const sr = await em.saveChanges();
      expect(sr.entities).toBeTruthy();
      expect(sr.entities.length).toEqual(5);
    } catch (err) {
      console.log(err);
      expect(err).toBeUndefined();
    }
  });

  test('should modify entity when complex property changes', () => {
    let em = new EntityManager('test');
    let ms = em.metadataStore;
    ms.importMetadata(metadata);

    let cust = em.createEntity('Customer', { CompanyName: 'ACME' });
    expect(cust).toBeTruthy();
    cust.entityAspect.acceptChanges();
    expect(cust.entityAspect.entityState.isModified()).toBe(false);

    const location = cust.getProperty("Location");

    location.setProperty('City', 'Foo');
    expect(cust.entityAspect.entityState.isModified()).toBe(true);

    cust.entityAspect.rejectChanges();
    expect(cust.entityAspect.entityState.isModified()).toBe(false);

    location.City = 'Foo2';
    expect(cust.entityAspect.entityState.isModified()).toBe(true);

    cust.entityAspect.rejectChanges();
    expect(cust.entityAspect.entityState.isModified()).toBe(false);

    (cust as any).Location.City = 'Foo3';
    expect(cust.entityAspect.entityState.isModified()).toBe(true);

  });

});
