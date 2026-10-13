import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPurchaseRunner } from '../dist/purchase-runner.js';

test('a failed order within a discovered page retains the durable window; retry finishes only after every fact is stored', async () => {
  const claim = {
    shopId: 'shop',
    installationGeneration: '1',
    since: '2026-10-12T00:00:00.000Z',
    until: '2026-10-13T00:00:00.000Z',
    cursor: 'page-1',
    claimToken: 'token',
  };
  const calls = [];
  let failing = true;
  const core = {
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
      },
    },
  };
  const orders = {
    async changes(target) {
      assert.deepEqual(target, claim);
      return {
        ...claim,
        orders: [{ orderId: 'gid://shopify/Order/1' }, { orderId: 'gid://shopify/Order/2' }],
        nextCursor: 'page-2',
      };
    },
    async read(target) {
      if (failing && target.orderId.endsWith('/2')) throw new Error('provider failure');
      return {
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
      };
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
  assert.equal(calls.at(-1)[1].cursor, 'page-1');
  assert.equal(calls.at(-1)[1].nextCursor, 'page-2');
});
