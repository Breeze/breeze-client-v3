import { EntityManager, EntityQuery } from '../../src/breeze';
import { TestFns } from '../test-fns';

/**
 * The server's ExpandPolicy - which navigations a client may expand - as seen from the client.
 *
 * These hit /breeze/ExpandPolicy rather than the Northwind controller, because ExpandPolicy is
 * keyed by entity type and is process-wide on the server: declaring rules on the Northwind types
 * would change what every other spec file is allowed to expand. That controller has its own small
 * model, served from the EF in-memory provider, so nothing here touches BreezeTestDb.
 *
 * The rules it declares, in Controllers/ExpandPolicyController.cs:
 *   PolicyCustomer  [AllowExpand(Orders)]            - so Notes is refused
 *   PolicyOrder     [DenyExpand(Agent)]              - so Lines is fine, Agent is not
 *   PolicyLine      ExpandPolicy.Allow(l => Product) - an allow-list, so Supplier is refused
 */

TestFns.initServerEnv();

const serviceName = 'http://localhost:34377/breeze/ExpandPolicy';

function newEm() {
  return new EntityManager({ serviceName });
}

/** Run a query that the server should refuse, and hand back the error it raised. */
async function expectRefused(expandPath: string) {
  const em = newEm();
  try {
    await em.executeQuery(EntityQuery.from('Customers').expand(expandPath));
  } catch (e: any) {
    return e;
  }
  throw new Error(`expand '${expandPath}' was allowed, but the server should have refused it`);
}

describe('Expand policy on the server', () => {

  test('a navigation named by AllowExpand is allowed', async () => {
    expect.hasAssertions();
    const em = newEm();

    const qr = await em.executeQuery(EntityQuery.from('Customers').expand('orders'));

    expect(qr.results.length).toBe(1);
    expect(qr.results[0].orders.length).toBe(1);
  });

  test('a navigation left out of AllowExpand is refused with 400', async () => {
    expect.hasAssertions();

    const e = await expectRefused('notes');

    expect(e.status).toBe(400);
    expect(e.message).toContain('Expand not allowed: Notes');
  });

  test('a navigation named by DenyExpand is refused, one hop in', async () => {
    expect.hasAssertions();

    const e = await expectRefused('orders.agent');

    expect(e.status).toBe(400);
    expect(e.message).toContain('Expand not allowed: Orders.Agent');
  });

  test('a path the policy permits all the way through is allowed', async () => {
    expect.hasAssertions();
    const em = newEm();

    const qr = await em.executeQuery(EntityQuery.from('Customers').expand('orders.lines'));

    expect(qr.results.length).toBe(1);
    expect(qr.results[0].orders[0].lines.length).toBe(1);
  });

  test('a rule registered in code is enforced like an attribute', async () => {
    expect.hasAssertions();

    // ExpandPolicy.Allow<PolicyLine>(l => l.Product) is an allow-list, so Product passes...
    const em = newEm();
    const qr = await em.executeQuery(
      EntityQuery.from('Customers').expand('orders.lines.product'));
    expect(qr.results.length).toBe(1);

    // ... and Supplier, which it does not name, does not.
    const e = await expectRefused('orders.lines.supplier');
    expect(e.status).toBe(400);
    expect(e.message).toContain('Expand not allowed: Orders.Lines.Supplier');
  });

  test('the refusal names the first forbidden hop, not the whole path', async () => {
    expect.hasAssertions();

    // Notes is refused at the first hop, so the rest of the path is never reported - a client
    // cannot use the message to learn what lies beyond it.
    const e = await expectRefused('notes.somethingElse');

    expect(e.status).toBe(400);
    expect(e.message).toContain('Expand not allowed: Notes');
    expect(e.message).not.toContain('somethingElse');
  });

  test('a query with no expand is unaffected', async () => {
    expect.hasAssertions();
    const em = newEm();

    const qr = await em.executeQuery(EntityQuery.from('Customers'));

    expect(qr.results.length).toBe(1);
    expect(qr.results[0].name).toBe('Acme');
  });

  test('the Northwind controller, which declares no policy, still expands freely', async () => {
    expect.hasAssertions();
    const em = TestFns.newEntityManager();

    // Nothing is declared for the Northwind types, so the policy is inert there. This is the
    // compatibility contract: adding ExpandPolicy changes nothing until you use it.
    const qr = await em.executeQuery(
      EntityQuery.from('Customers').expand('orders').take(1));

    expect(qr.results.length).toBe(1);
  });
});
