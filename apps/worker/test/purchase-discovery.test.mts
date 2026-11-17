import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createDatabase } from '../../../packages/database/dist/client/database.js';
import { createPurchaseRunner } from '../dist/purchase-runner.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';
import { orderFixture } from './support/order-fixture.mts';
import { purchaseFixture } from './support/purchase-role-fixture.mts';

test('a failed order within a discovered page retains the durable window; retry finishes only after every fact is stored', async () => {
  const claim = {
    shopId: 'shop',
    installationGeneration: '1',
    since: '2026-10-12T00:00:00.000Z',
    until: '2026-10-13T00:00:00.000Z',
    cursor: 'page-1',
    claimToken: 'token',
  };
  const calls: ['complete' | 'failed' | 'fact', unknown][] = [];
  let failing = true;
  const core = durableCoreFixture({
    purchases: {
      async claimPurchaseDiscovery() {
        return [claim];
      },
      async completePurchaseDiscovery(x) {
        calls.push(['complete', x]);
      },
      async failPurchaseDiscovery(x) {
        calls.push(['failed', x]);
      },
      async getOffer() {
        return null;
      },
      async reconcile(x) {
        calls.push(['fact', x.order.orderId]);
        return { kind: 'not_customized' };
      },
    },
  });
  const orders: Parameters<typeof createPurchaseRunner>[0]['orders'] = {
    async changes(target) {
      assert.deepEqual(target, claim);
      return {
        ...claim,
        orders: [
          { orderId: 'gid://shopify/Order/1', updatedAt: claim.since },
          { orderId: 'gid://shopify/Order/2', updatedAt: claim.since },
        ],
        observedAt: claim.until,
        nextCursor: 'page-2',
      };
    },
    async read(target) {
      if (failing && target.orderId.endsWith('/2')) throw new Error('provider failure');
      return orderFixture({
        ...target,
        complete: true,
        sourceApiVersion: '2026-07',
        createdAt: claim.since,
        updatedAt: claim.since,
        observedAt: claim.until,
        edited: false,
        lines: [],
        transactions: [],
        refunds: [],
        totalPriceMinor: '0',
        currency: 'EUR',
      });
    },
  };
  const runner = createPurchaseRunner({ core, orders });
  assert.equal(await runner.discoverChanges(), 0);
  assert.deepEqual(
    calls.map((x) => x[0]),
    ['fact', 'failed'],
  );
  failing = false;
  assert.equal(await runner.discoverChanges(), 2);
  assert.deepEqual(
    calls.map((x) => x[0]),
    ['fact', 'failed', 'fact', 'fact', 'complete'],
  );
  const last = calls.at(-1)?.[1];
  assert(last && typeof last === 'object' && 'cursor' in last && 'nextCursor' in last);
  assert.equal(last.cursor, 'page-1');
  assert.equal(last.nextCursor, 'page-2');
});

test('a reinstalled generation without checkout Functions reconciles earlier-generation orders and completes its window', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(pool);
  const shopId = randomUUID();
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: `${shopId}.myshopify.com`, shopifyShopId: '9182736451' }),
    );
    // Generation 1 took orders, was uninstalled (Shopify removed its Functions) and the store reinstalled.
    assert.equal(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId)), '2');
    await pool.query(
      `INSERT INTO shop_credentials(shop_id,installation_generation,state,access_expires_at,refresh_expires_at,scopes,wrapping_key_id,access_envelope,refresh_envelope)
       VALUES($1,2,'active',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day','read_orders','synthetic','{}','{}')`,
      [shopId],
    );
    let collections = 0;
    const runner = createPurchaseRunner({
      core,
      checkout: { admit: async () => null },
      // No Functions on the store until its first publish: every release collection fails.
      prepareRelease: async () => {
        collections++;
        throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
      },
      orders: {
        async changes(target) {
          return {
            ...target,
            orders: ['710001', '710002'].map((id) => ({
              orderId: `gid://shopify/Order/${id}`,
              updatedAt: target.since,
            })),
            observedAt: target.until,
            nextCursor: null,
          };
        },
        async read(target) {
          return orderFixture({
            ...target,
            createdAt: target.orderId.endsWith('1') ? '2026-10-01T00:00:00.000Z' : '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
            observedAt: new Date().toISOString(),
            lines: [
              {
                lineId: target.orderId.replace('Order', 'LineItem'),
                productId: 'gid://shopify/Product/1',
                variantId: 'gid://shopify/ProductVariant/1',
                quantity: 1,
                currentQuantity: 1,
                originalUnitPriceMinor: '100',
                sellingPlanId: null,
                attributes: [],
              },
            ],
            totalPriceMinor: '100',
          });
        },
      },
    });
    // Other shops in a shared database may be claimed first; this shop's window completes within a few passes.
    const cursor = async () =>
      (
        await pool.query<{ window_until: Date | null; last_error_class: string | null; completed: boolean }>(
          `SELECT window_until, last_error_class, watermark > clock_timestamp() - interval '1 minute' AS completed
           FROM purchase_reconciliation_cursors WHERE shop_id=$1 AND installation_generation=2`,
          [shopId],
        )
      ).rows[0];
    for (let attempt = 0; attempt < 20 && !(await cursor())?.completed; attempt++) await runner.discoverChanges(20);
    assert.equal(collections, 0, 'Ordinary orders need no release evidence');
    assert.deepEqual(await cursor(), { window_until: null, last_error_class: null, completed: true });
  } finally {
    await core.close();
  }
});

test("a reinstalled generation records an earlier generation's customized order unbound, without admission or a blocked window", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = createDatabase(new Pool({ connectionString: process.env.DATABASE_URL }));
  const core = createDurableCore(pool);
  try {
    // Generation 1 signed an offer and sold it; the customized order has no provider context.
    const fixture = await purchaseFixture(db);
    await pool.query("UPDATE installation_generations SET activated_at='2026-09-01T00:00:00Z' WHERE shop_id=$1", [
      fixture.shopId,
    ]);
    // Its retention metadata, with the production detail long erased.
    await pool.query(
      "INSERT INTO purchase_offer_payloads(shop_id,installation_generation,quote_id,collected_at,expires_at,payload,erased_at) VALUES($1,1,$2,'2026-09-29T11:00:00Z','2026-10-06T11:00:00Z',NULL,'2026-10-06T11:00:00Z')",
      [fixture.shopId, fixture.quote.quoteId],
    );
    assert.equal(await core.transactions.run((tx) => core.tenants.startInstallation(tx, fixture.shopId)), '2');
    await pool.query(
      `INSERT INTO shop_credentials(shop_id,installation_generation,state,access_expires_at,refresh_expires_at,scopes,wrapping_key_id,access_envelope,refresh_envelope)
       VALUES($1,2,'active',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day','read_orders','synthetic','{}','{}')`,
      [fixture.shopId],
    );
    const customized = 'gid://shopify/Order/720001';
    const recorded: { orderId: string; exception: string | null; bindings: number }[] = [];
    const purchases = Object.assign(Object.create(core.purchases), {
      async reconcile(observation: Parameters<typeof core.purchases.reconcile>[0]) {
        recorded.push({
          orderId: observation.order.orderId,
          exception: observation.exception,
          bindings: observation.bindings.length,
        });
        return core.purchases.reconcile(observation);
      },
    });
    let collections = 0;
    let admissions = 0;
    const runner = createPurchaseRunner({
      core: Object.assign(Object.create(core), { purchases }),
      checkout: {
        async admit({ order }) {
          admissions++;
          return { creatorAppId: 'gid://shopify/App/77', enforcementObservedAt: order.observedAt };
        },
      },
      // No Functions on the store until its first publish: every release collection fails.
      prepareRelease: async () => {
        collections++;
        throw new Error('PURCHASE_RELEASE_UNAVAILABLE');
      },
      orders: {
        async changes(target) {
          return {
            ...target,
            orders:
              target.shopId === fixture.shopId
                ? [customized, 'gid://shopify/Order/720002'].map((orderId) => ({ orderId, updatedAt: target.since }))
                : [],
            observedAt: target.until,
            nextCursor: null,
          };
        },
        async read(target) {
          const plain = target.orderId !== customized;
          return orderFixture({
            ...target,
            createdAt: '2026-09-29T13:00:00.000Z',
            updatedAt: '2026-09-29T13:00:00.000Z',
            observedAt: new Date().toISOString(),
            currency: 'USD',
            totalPriceMinor: '2001',
            checkoutOrigin: {
              creatorAppId: 'gid://shopify/App/77',
              sourceName: 'web',
              checkoutTokenDigest: 'a'.repeat(64),
            },
            lines: fixture.quote.economics.lines.map((line) => ({
              lineId: `gid://shopify/LineItem/${target.orderId.slice(-6)}${line.lineIndex}`,
              productId: '101',
              variantId: line.variantId,
              quantity: 1,
              currentQuantity: 1,
              originalUnitPriceMinor: line.unitPriceMinor,
              sellingPlanId: null,
              attributes: plain
                ? []
                : [
                    { key: '_insignia_quote_v2', value: fixture.authorization.envelopeCarrier },
                    { key: '_insignia_member_v2', value: fixture.authorization.members[line.lineIndex]?.carrier ?? '' },
                  ],
            })),
          });
        },
      },
    });
    const cursor = async () =>
      (
        await pool.query<{ window_until: Date | null; last_error_class: string | null; completed: boolean }>(
          `SELECT window_until, last_error_class, watermark > clock_timestamp() - interval '1 minute' AS completed
           FROM purchase_reconciliation_cursors WHERE shop_id=$1 AND installation_generation=2`,
          [fixture.shopId],
        )
      ).rows[0];
    for (let attempt = 0; attempt < 20 && !(await cursor())?.completed; attempt++) await runner.discoverChanges(20);
    assert.deepEqual(await cursor(), { window_until: null, last_error_class: null, completed: true });
    assert.equal(collections, 0, 'No admission is attempted, so no release evidence is needed');
    assert.equal(admissions, 0, "Generation 2's checkout enforcement never admits generation 1's order");
    assert.deepEqual(
      recorded.filter((entry) => entry.orderId.startsWith('gid://shopify/Order/72000')),
      [
        { orderId: customized, exception: 'CHECKOUT_ENFORCEMENT_UNVERIFIED', bindings: 0 },
        { orderId: 'gid://shopify/Order/720002', exception: null, bindings: 0 },
      ],
    );
  } finally {
    await db.destroy();
    await core.close();
  }
});
