import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingProof, FakeAppEvents, TEST_PLANS, type VerifiedHistory,
  type VerifiedPurchase, type VerifiedSubmissionWindow } from '../src/index.ts';
import { BillingApplication, FakeSubscriptionPort } from '../src/application.ts';

const appId = 'gid://shopify/App/202';
const shopId = 'gid://shopify/Shop/101';
const history: VerifiedHistory = {
  source: 'PARTNER_API_2026_07', appId, shopId,
  observedAt: '2026-06-01T12:00:00.000Z',
  completeFrom: '2026-05-01T00:00:00.000Z',
  completeThrough: '2026-06-01T12:00:00.000Z',
  intervals: [{ from: '2026-05-01T00:00:00.000Z', until: null,
    state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'synthetic-source-event-1', trial: null }]
};
const window: VerifiedSubmissionWindow = {
  source: 'PARTNER_API_2026_07', appId, shopId, observedAt: history.observedAt,
  cycleFrom: '2026-05-15T00:00:00.000Z', cycleUntil: '2026-06-15T00:00:00.000Z'
};
const purchase: VerifiedPurchase = {
  source: 'VERIFIED_PURCHASE_FACT', appId, shopId, orderId: 'gid://shopify/Order/400',
  installationGeneration: 'generation-1', firstFullyPaidAt: '2026-05-31T12:00:00.000Z',
  fullyPaid: true, shopifyTest: false, verifiedCustomizationGroups: 2, customizedQuantity: 500
};

test('public application seam runs verified entitlement through fact, outbox, 202 and aggregate-only reconciliation', async () => {
  const subscriptions = new FakeSubscriptionPort();
  subscriptions.setHistory(shopId, history);
  subscriptions.setWindow(shopId, window);
  const fake = new FakeAppEvents();
  const app = new BillingApplication(new BillingProof(TEST_PLANS, appId), subscriptions, fake);
  assert.equal(await app.decideNewAction(shopId, 'proof.alpha', '2026-06-01T12:01:00.000Z'), 'ALLOW');
  assert.equal((await app.onVerifiedPurchase(purchase)).kind, 'BILLABLE');
  assert.equal(await app.deliverNext('2026-06-01T12:00:00.000Z'), 'TRANSPORT_ACCEPTED');
  const aggregate = fake.processCycle(appId, shopId, window.cycleFrom, window.cycleUntil, TEST_PLANS[0]!);
  assert.equal(app.reconcile(aggregate), 'AGGREGATE_MATCH_ONLY');
  assert.equal(app.ledger.outbox()[0]?.state, 'TRANSPORT_ACCEPTED');
});

test('provider read failure retains a pending immutable paid fact until verified history returns', async () => {
  const subscriptions = new FakeSubscriptionPort();
  const app = new BillingApplication(new BillingProof(TEST_PLANS, appId), subscriptions, new FakeAppEvents());
  assert.equal(await app.decideNewAction(shopId, 'proof.alpha', '2026-06-01T12:01:00.000Z'), 'PENDING_VERIFY');
  assert.equal((await app.onVerifiedPurchase(purchase)).kind, 'PENDING_HISTORY');
  assert.equal(app.ledger.outbox().length, 0);
  subscriptions.setHistory(shopId, history);
  assert.equal((await app.onVerifiedPurchase(purchase)).kind, 'BILLABLE');
  assert.equal(app.ledger.outbox().length, 1);
  assert.equal(await app.deliverNext('2026-06-01T12:00:00.000Z'), 'PENDING_VERIFY');
});

test('concurrent purchase qualification is one fact and later buyer lifecycle cannot reverse it', async () => {
  const subscriptions = new FakeSubscriptionPort();
  subscriptions.setHistory(shopId, history);
  const app = new BillingApplication(new BillingProof(TEST_PLANS, appId), subscriptions, new FakeAppEvents());
  const [first, duplicate] = await Promise.all([
    app.onVerifiedPurchase(purchase), app.onVerifiedPurchase({ ...purchase, installationGeneration: 'generation-2' })
  ]);
  assert.deepEqual([first.kind, duplicate.kind], ['BILLABLE', 'BILLABLE']);
  assert.equal(app.ledger.facts().length, 1);
  assert.equal(app.ledger.outbox().length, 1);
  const before = app.ledger.exportSnapshot();
  for (const kind of ['REFUNDED', 'CANCELLED', 'RESTOCKED'] as const) {
    const fact = app.onVerifiedPostPaymentLifecycle({ source: 'VERIFIED_POST_PAYMENT_LIFECYCLE',
      appId, shopId, orderId: purchase.orderId, kind });
    assert.equal(fact?.qualification, 'BILLABLE');
    assert.deepEqual(app.ledger.exportSnapshot(), before);
  }
});
