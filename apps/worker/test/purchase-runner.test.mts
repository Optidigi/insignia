import type { DurableCore } from '@insignia/database';
import { orderFixture } from './support/order-fixture.mts';

type Observation = Parameters<DurableCore['purchases']['reconcile']>[0];
type Failure = Parameters<DurableCore['purchases']['failPurchaseReconciliation']>[0];
const claimToken = '00000000-0000-4000-8000-000000000001' as const;

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPurchaseRunner } from '../dist/purchase-runner.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';

function observation(value: Observation | Failure | undefined): Observation {
  assert(value && 'order' in value);
  return value;
}

test('release preparation precedes the independent order read and preparation failure preserves claim recovery', async () => {
  const calls: string[] = [];
  const hint = {
    attempts: 0,
    apiVersion: '2026-07',
    topic: 'orders/create',
    status: 'pending',
    inboxId: 'inbox',
    shopId: 'shop',
    installationGeneration: '1',
    orderId: 'order',
    claimToken: claimToken,
  };
  let unavailable = true;
  const runner = createPurchaseRunner({
    core: durableCoreFixture({
      purchases: {
        claimPurchaseReconciliationHint: async () => hint,
        failPurchaseReconciliation: async (failure) => {
          assert.equal(failure.claimToken, claimToken);
          calls.push('recover');
        },
      },
    }),
    checkout: { admit: async () => null },
    prepareRelease: async (target) => {
      assert.equal(target.orderId, 'order');
      calls.push('prepare');
      if (unavailable) throw Error('release unavailable');
    },
    orders: {
      read: async () => {
        calls.push('order');
        throw Error('independent order unavailable');
      },
    },
  });
  await assert.rejects(runner.processInbox('inbox'), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
  assert.deepEqual(calls, ['prepare', 'recover']);
  unavailable = false;
  calls.length = 0;
  await assert.rejects(runner.processInbox('inbox'), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
  assert.deepEqual(calls, ['prepare', 'order', 'recover']);
});

test('purchase webhook is processed only after an independent owned order read; failed read remains recoverable', async () => {
  const calls: (Observation | Failure)[] = [];
  const hint = {
    attempts: 0,
    apiVersion: '2026-07',
    topic: 'orders/create',
    status: 'pending',
    inboxId: 'inbox',
    shopId: 'shop',
    installationGeneration: '1',
    orderId: 'gid://shopify/Order/1',
    claimToken: claimToken,
  };
  let unavailable = true;
  const core = durableCoreFixture({
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
        return { kind: 'not_customized' };
      },
      async failPurchaseReconciliation(input) {
        calls.push(input);
      },
      async selectPurchaseRecoveryHints() {
        return [hint];
      },
    },
  });
  const runner = createPurchaseRunner({
    core,
    orders: {
      async read(target) {
        assert.equal(target.orderId, hint.orderId);
        if (unavailable) throw new Error('private provider response');
        return orderFixture({
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
        });
      },
    },
  });
  await assert.rejects(runner.processInbox('inbox'), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
  assert.deepEqual(calls, [
    { inboxId: 'inbox', claimToken: claimToken, failureClass: 'PURCHASE_RECONCILIATION_UNAVAILABLE' },
  ]);
  unavailable = false;
  assert.equal(await runner.recover(), 1);
  const reconciled = observation(calls[1]);
  assert.equal(reconciled.inboxId, 'inbox');
  assert.equal(reconciled.claimToken, claimToken);
  assert.equal(reconciled.order.orderId, hint.orderId);
  assert.equal(reconciled.exception, null);
});
