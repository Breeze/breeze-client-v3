import { EntityManager, EntityQuery, SaveOptions } from '../../src/breeze';
import { TestFns } from '../test-fns';
import { SaveTestFns } from '../save-test-fns';

TestFns.initServerEnv();

beforeAll(async () => {
  await TestFns.initDefaultMetadataStore();
});

afterAll(async () => {
  await SaveTestFns.cleanup();
});

// The Northwind persistence manager can update a Produce row from inside a save, when the
// save is tagged UpdateProduceShipAddress.Before or UpdateProduceKeyMapping.After. Until the
// three test databases were merged into BreezeTestDb it opened a separate connection to a
// ProduceTPH database. That database no longer exists, and nothing exercised the path, so
// nothing noticed. These tests exercise it.

const produceId = "13F1C9F5-3189-45FA-BA6E-13314FAFAA92";

async function produceDescription(): Promise<string> {
  const produceService = TestFns.defaultServiceName.replace("NorthwindIBModel", "ProduceTPH");
  const em = new EntityManager(produceService);
  const qr = await em.executeQuery(EntityQuery.from("ItemsOfProduce").where("id", "==", produceId));
  expect(qr.results.length).toBe(1);
  return qr.results[0].getProperty("description");
}

describe("Save hooks that update the Produce data", () => {

  test("UpdateProduceShipAddress.Before writes the order's ship address to the produce item", async () => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const shipAddress = "Produce hook " + Date.now();
    em.createEntity("Order", { shipAddress });

    const sr = await em.saveChanges(null, new SaveOptions({ tag: "UpdateProduceShipAddress.Before" }));

    expect(sr.entities.length).toBe(1);
    expect(await produceDescription()).toBe(shipAddress);
  });

  test("UpdateProduceKeyMapping.After writes the order's new key to the produce item", async () => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();
    const order = em.createEntity("Order", { shipAddress: "Produce key mapping hook" });

    await em.saveChanges(null, new SaveOptions({ tag: "UpdateProduceKeyMapping.After" }));

    const orderID = order.getProperty("orderID");
    expect(orderID).toBeGreaterThan(0);
    expect(await produceDescription()).toMatch(new RegExp(":" + orderID + "$"));
  });

});
