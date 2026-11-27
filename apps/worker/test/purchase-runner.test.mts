import type { HistoricalPurchaseOffer, VerifiedOrder } from '@insignia/application';
import type { DurableCore } from '@insignia/database';
import { orderFixture } from './support/order-fixture.mts';
import { signedOrderFixture } from './support/signed-order-fixture.mts';

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

const plainLine = {
  lineId: 'gid://shopify/LineItem/2',
  productId: 'gid://shopify/Product/1',
  variantId: 'gid://shopify/ProductVariant/1',
  quantity: 1,
  currentQuantity: 1,
  originalUnitPriceMinor: '100',
  sellingPlanId: null,
  attributes: [],
};
const origin = { creatorAppId: 'gid://shopify/App/77', sourceName: 'web', checkoutTokenDigest: 'a'.repeat(64) };

/**
 * A correctly signed customized order without provider context, read by installation generation 2.
 * `offerGeneration` '2' is this installation's own offer (binding needs checkout admission); '1' is
 * the earlier installation's, deactivated after the order was placed.
 */
function signed(offerGeneration: '1' | '2') {
  const { order, offer } = signedOrderFixture();
  offer.quote = { ...offer.quote, installationGeneration: offerGeneration };
  offer.installationWindow = {
    generation: offerGeneration,
    startedAt: offer.installationWindow.startedAt,
    deactivatedAt: offerGeneration === '1' ? '2026-10-21T00:00:00.000Z' : null,
  };
  const customized = { ...order, country: null, marketId: null, contextVerified: false, checkoutOrigin: origin };
  return { order: customized, offer };
}

/** A runner whose release preparation rejects until `prepare()`, as on a store without its checkout Functions. */
function unpreparedRunner(
  read: (target: { orderId: string }, count: number) => VerifiedOrder,
  offer: HistoricalPurchaseOffer | null = null,
) {
  const calls: string[] = [];
  const reads = new Map<string, number>();
  const facts: Observation[] = [];
  const hint = {
    attempts: 0,
    nextAttemptAt: null,
    apiVersion: '2026-07',
    topic: 'orders/create',
    status: 'pending',
    inboxId: 'inbox',
    shopId: 'shop',
    installationGeneration: '2',
    orderId: 'gid://shopify/Order/1',
    claimToken: claimToken,
  };
  const claim = {
    shopId: 'shop',
    installationGeneration: '2',
    since: '2026-09-01T00:00:00.000Z',
    until: '2026-10-13T00:00:00.000Z',
    cursor: null,
    claimToken: 'token',
  };
  let prepared = false;
  const runner = createPurchaseRunner({
    core: durableCoreFixture({
      purchases: {
        claimPurchaseReconciliationHint: async () => hint,
        claimPurchaseDiscovery: async (_limit, seen = []) => (seen.includes(claim.shopId) ? [] : [claim]),
        completePurchaseDiscovery: async () => {
          calls.push('complete');
        },
        failPurchaseDiscovery: async () => {
          calls.push('discovery-failed');
        },
        failPurchaseReconciliation: async () => {
          calls.push('recover');
        },
        getOffer: async () => {
          calls.push('offer');
          return offer;
        },
        reconcile: async (observation) => {
          calls.push(`fact:${observation.order.orderId}`);
          facts.push(observation);
          return { kind: 'not_customized' };
        },
      },
    }),
    checkout: {
      admit: async ({ order }) => {
        calls.push('admit');
        return { creatorAppId: origin.creatorAppId, enforcementObservedAt: order.observedAt };
      },
    },
    prepareRelease: async (target) => {
      calls.push(`prepare:${target.orderId}`);
      if (!prepared) throw Error('PURCHASE_RELEASE_UNAVAILABLE');
    },
    orders: {
      async changes() {
        return {
          ...claim,
          orders: [
            { orderId: 'gid://shopify/Order/1', updatedAt: claim.since },
            { orderId: 'gid://shopify/Order/2', updatedAt: claim.since },
          ],
          observedAt: claim.until,
          nextCursor: null,
        };
      },
      async read(target) {
        const count = (reads.get(target.orderId) ?? 0) + 1;
        reads.set(target.orderId, count);
        calls.push(`order:${target.orderId}`);
        return { ...read(target, count), ...target };
      },
    },
  });
  return {
    runner,
    calls,
    facts,
    prepare: () => {
      prepared = true;
    },
  };
}

test('without release evidence, orders with no Insignia customization still complete discovery', async () => {
  const { runner, calls, facts } = unpreparedRunner(() => orderFixture({ lines: [plainLine], totalPriceMinor: '100' }));
  assert.equal(await runner.discoverChanges(), 2);
  // Release evidence is only required by the binding that admits a customized order.
  assert.deepEqual(calls, [
    'order:gid://shopify/Order/1',
    'fact:gid://shopify/Order/1',
    'order:gid://shopify/Order/2',
    'fact:gid://shopify/Order/2',
    'complete',
  ]);
  assert.deepEqual(
    facts.map((fact) => fact.exception),
    [null, null],
  );
});

test('an order whose binding reaches checkout admission fails closed without release evidence', async () => {
  const { order, offer } = signed('2');
  const { runner, calls, facts } = unpreparedRunner(() => order, offer);
  assert.equal(await runner.discoverChanges(), 0);
  // A dry run on the observation finds that admission is needed; nothing is admitted or stored.
  assert.deepEqual(calls, [
    'order:gid://shopify/Order/1',
    'offer',
    'prepare:gid://shopify/Order/1',
    'discovery-failed',
  ]);
  calls.length = 0;
  await assert.rejects(runner.processInbox('inbox'), /PURCHASE_RECONCILIATION_UNAVAILABLE/);
  assert.deepEqual(calls, ['order:gid://shopify/Order/1', 'offer', 'prepare:gid://shopify/Order/1', 'recover']);
  assert.deepEqual(facts, []);
});

test('once prepared, an order is observed again after collection and only then admitted', async () => {
  const { order, offer } = signed('2');
  const { runner, calls, facts, prepare } = unpreparedRunner(
    (_, count) => ({ ...order, observedAt: `2027-01-01T00:0${count}:00.000Z` }),
    offer,
  );
  prepare();
  await runner.processInbox('inbox');
  assert.deepEqual(calls, [
    'order:gid://shopify/Order/1',
    'offer',
    'prepare:gid://shopify/Order/1',
    'order:gid://shopify/Order/1',
    'offer',
    'admit',
    'fact:gid://shopify/Order/1',
  ]);
  // The stored observation is the read that follows collection, never the earlier one.
  assert.equal(facts[0]?.order.observedAt, '2027-01-01T00:02:00.000Z');
  assert.equal(facts[0]?.exception, null);
  assert.equal(facts[0]?.bindings[0]?.evidence?.kind, 'signed_offer_order_match');
});

test("an earlier installation's customized order is recorded unbound without release evidence and never blocks the window", async () => {
  const { order, offer } = signed('1');
  const { runner, calls, facts } = unpreparedRunner(() => order, offer);
  assert.equal(await runner.discoverChanges(), 2);
  assert.deepEqual(calls, [
    'order:gid://shopify/Order/1',
    'offer',
    'fact:gid://shopify/Order/1',
    'order:gid://shopify/Order/2',
    'offer',
    'fact:gid://shopify/Order/2',
    'complete',
  ]);
  // Generation 2's checkout enforcement never vouches for generation 1's cart.
  assert.deepEqual(
    facts.map((fact) => [fact.exception, fact.bindings.length]),
    [
      ['CHECKOUT_ENFORCEMENT_UNVERIFIED', 0],
      ['CHECKOUT_ENFORCEMENT_UNVERIFIED', 0],
    ],
  );
});

test('a customized order whose binding fails before admission needs no release evidence', async () => {
  const { order } = signed('2');
  const { runner, calls, facts } = unpreparedRunner(() => order, null);
  await runner.processInbox('inbox');
  assert.deepEqual(calls, ['order:gid://shopify/Order/1', 'offer', 'fact:gid://shopify/Order/1']);
  assert.equal(facts[0]?.exception, 'AUTHORIZATION_HISTORY_UNAVAILABLE');
});

test('purchase webhook is processed only after an independent owned order read; failed read remains recoverable', async () => {
  const calls: (Observation | Failure)[] = [];
  const hint = {
    attempts: 0,
    nextAttemptAt: null,
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

test('the purchase runner refuses to start when the JSON parser cannot supply exact numeric ids', () => {
  const parse = JSON.parse;
  // Simulates a runtime whose reviver receives no `context` (no `context.source`).
  JSON.parse = (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) =>
    parse(text, reviver && ((key, value) => reviver(key, value)));
  try {
    assert.throws(
      () => createPurchaseRunner({ core: {} as DurableCore, orders: { read: async () => orderFixture({}) } }),
      /PURCHASE_RUNNER_JSON_SOURCE_UNSUPPORTED/,
    );
  } finally {
    JSON.parse = parse;
  }
  assert.doesNotThrow(() =>
    createPurchaseRunner({ core: {} as DurableCore, orders: { read: async () => orderFixture({}) } }),
  );
});
