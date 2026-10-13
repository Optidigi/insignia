import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPurchaseRunner } from '../dist/purchase-runner.js';

test('purchase webhook is processed only after an independent owned order read; failed read remains recoverable', async () => {
  const calls = [],
    hint = {
      inboxId: 'inbox',
      shopId: 'shop',
      installationGeneration: '1',
      orderId: 'gid://shopify/Order/1',
      claimToken: 'claim',
    };
  let unavailable = true;
  const core = {
    purchases: {
      async claimPurchaseReconciliationHint(id) {
        assert.equal(id, 'inbox');
        return hint;
      },
      async getOffer() {
        throw new Error('ordinary order has no authorization');
      },
      async reconcile(input) {
        calls.push(input);
        return 'purchase';
      },
      async failPurchaseReconciliation(input) {
        calls.push(input);
      },
      async selectPurchaseRecoveryHints() {
        return [hint];
      },
    },
  };
  const runner = createPurchaseRunner({
    core,
    orders: {
      async read(target) {
        assert.equal(target.orderId, hint.orderId);
        if (unavailable) throw new Error('private provider response');
        return {
          ...target,
          complete: true,
          sourceApiVersion: '2026-07',
          createdAt: '2026-10-13T00:00:00Z',
          updatedAt: '2026-10-13T00:00:00Z',
          observedAt: '2026-10-13T00:01:00Z',
          edited: false,
          lines: [],
          transactions: [],
          refunds: [],
          totalPriceMinor: '0',
          currency: 'EUR',
        };
      },
    },
  });
  await assert.rejects(runner.processInbox('inbox'), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
  assert.deepEqual(calls, [
    { inboxId: 'inbox', claimToken: 'claim', failureClass: 'PURCHASE_RECONCILIATION_UNAVAILABLE' },
  ]);
  unavailable = false;
  assert.equal(await runner.recover(), 1);
  assert.equal(calls[1].inboxId, 'inbox');
  assert.equal(calls[1].claimToken, 'claim');
  assert.equal(calls[1].order.orderId, hint.orderId);
  assert.equal(calls[1].exception, null);
});
