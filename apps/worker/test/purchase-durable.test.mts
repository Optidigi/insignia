function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createPurchaseRunner } from '../dist/purchase-runner.js';

test('real durable inbox retains failed independent reads and atomically completes provider facts on recovery', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const shopId = randomUUID(),
    shopDomain = `${shopId}.myshopify.com`,
    orderId = 'gid://shopify/Order/981234';
  try {
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain }));
    const received = await core.webhooks.receive({
      shopDomain,
      topic: 'orders/paid',
      apiVersion: '2026-07',
      deliveryId: randomUUID(),
      triggeredAt: new Date(),
      eventId: null,
      name: null,
      rawBody: Buffer.from(JSON.stringify({ id: '981234', admin_graphql_api_id: orderId, total_price: '0.01' })),
    });
    await core.webhooks.withQueueHandoff(received.id, async () => 'enqueued');
    let failed = true;
    const runner = createPurchaseRunner({
      core,
      orders: {
        async read(target) {
          assert.equal(target.shopId, shopId);
          assert.equal(target.orderId, orderId);
          if (failed) throw new Error('provider unavailable');
          return {
            ...target,
            sourceApiVersion: '2026-07',
            complete: true,
            contextVerified: false,
            country: null,
            marketId: null,
            createdAt: '2026-10-13T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
            observedAt: '2026-10-13T00:01:00.000Z',
            currency: 'EUR',
            totalPriceMinor: '9100',
            financialStatus: 'PAID',
            cancelledAt: null,
            test: true,
            edited: false,
            lines: [],
            refunds: [],
            transactions: [
              {
                transactionId: 'gid://shopify/OrderTransaction/1',
                kind: 'SALE',
                status: 'SUCCESS',
                occurredAt: '2026-10-13T00:00:01.000Z',
                currency: 'EUR',
                amountMinor: '9100',
              },
            ],
          };
        },
      },
    });
    await assert.rejects(runner.processInbox(received.id), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
    assert.equal(required(await core.webhooks.getById(received.id)).state, 'failed');
    assert.equal(required(await core.purchases.getPurchaseReconciliationHint(received.id)).attempts, 1);
    failed = false;
    await runner.processInbox(received.id);
    assert.equal(required(await core.webhooks.getById(received.id)).state, 'processed');
    const purchases = await core.purchases.list({ shopId, installationGeneration: '1', kind: 'merchant' });
    assert.equal(purchases.length, 0); // Ordinary commerce is not collected as Insignia purchase history.
    assert.equal(await runner.processInbox(received.id), 'deferred');
    assert.equal(
      required(await core.purchases.list({ shopId, installationGeneration: '1', kind: 'merchant' })).length,
      0,
    );
  } finally {
    await core.close();
  }
});
