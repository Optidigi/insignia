import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingProof, FakeAppEvents, TEST_PLANS, type VerifiedHistory,
  type VerifiedPurchase, type VerifiedSubmissionWindow } from '../src/index.ts';
import { BillingApplication, FakeSubscriptionPort } from '../src/application.ts';
import { currentHistory, parseActiveSubscription } from '../src/partner.ts';

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

const boundaryContext = { appId, shopId, observedAt: '2026-06-14T23:59:00.000Z' };
const boundary = '2026-06-15T00:00:00.000Z';
function boundaryResponse(options: { cancel?: boolean; pending?: boolean; trial?: boolean } = {}) {
  return { data: { activeSubscription: {
    app: { id: appId }, shop: { id: shopId, myshopifyDomain: 'fixture.myshopify.com' },
    billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: options.cancel ?? false,
    trialEndsAt: options.trial ? boundary : null,
    currentBillingCycle: options.trial ? null : {
      startTime: '2026-05-16T00:00:00.000Z', endTime: boundary
    },
    items: [
      { handle: 'fixture_a', price: { __typename: 'FlatRatePrice', active: true,
        currency: 'USD', amount: '1.01' } },
      { handle: 'customized_order_paid', price: { __typename: 'TieredPrice', active: true,
        currency: 'USD', tiersMode: 'GRADUATED', tiers: [
          { upTo: 2 as number | null, amountPerUnit: '0.00', amount: '0.00' },
          { upTo: null as number | null, amountPerUnit: '0.005', amount: '0.00' }
        ] } }
    ],
    pendingUpdate: options.pending ? { billingPeriod: 'EVERY_30_DAYS', items: [{ handle: 'fixture_b' }] } : null,
    legacySubscriptionId: null
  } } };
}

async function decisionFromProvider(body: unknown, now: string) {
  const read = parseActiveSubscription(200, body, boundaryContext);
  const subscriptions = new FakeSubscriptionPort();
  if (read.kind === 'ACTIVE') subscriptions.setHistory(shopId, currentHistory(read.observation));
  const app = new BillingApplication(new BillingProof(TEST_PLANS, appId), subscriptions, new FakeAppEvents());
  return { read, decision: await app.decideNewAction(shopId, 'proof.alpha', now) };
}

test('known cancellation, pending-plan and trial boundaries end current new-action authority', async () => {
  const before = '2026-06-14T23:59:30.000Z';
  const after = '2026-06-15T00:01:00.000Z';
  for (const options of [{ cancel: true }, { pending: true }, { trial: true }]) {
    const body = boundaryResponse(options);
    const read = parseActiveSubscription(200, body, boundaryContext);
    assert.equal(read.kind, 'ACTIVE');
    if (read.kind !== 'ACTIVE') continue;
    assert.equal(currentHistory(read.observation).intervals[0]?.until, boundary);
    assert.equal((await decisionFromProvider(body, before)).decision, 'ALLOW');
    assert.equal((await decisionFromProvider(body, boundary)).decision, 'PENDING_VERIFY');
    assert.equal((await decisionFromProvider(body, after)).decision, 'PENDING_VERIFY');
  }
  assert.equal((await decisionFromProvider(boundaryResponse(), after)).decision, 'ALLOW');
});

test('a pending update without a plan item cannot leave authority unbounded', async () => {
  const body = boundaryResponse({ pending: true });
  body.data.activeSubscription.pendingUpdate!.items = [];
  const result = await decisionFromProvider(body, '2026-06-15T00:01:00.000Z');
  assert.equal(result.read.kind, 'UNKNOWN_CONTRACT');
  assert.equal(result.decision, 'PENDING_VERIFY');
});

test('both tier flat amounts must be exact zero before provider data can authorize a new action', async () => {
  for (const tierIndex of [0, 1]) {
    for (const amount of ['0', '0.0', '0.00', '0.000']) {
      const body = boundaryResponse();
      const tier = (body.data.activeSubscription.items[1]!.price as
        { tiers: Array<Record<string, unknown>> }).tiers[tierIndex]!;
      tier.amount = amount;
      const result = await decisionFromProvider(body, '2026-06-14T23:59:30.000Z');
      assert.equal(result.read.kind, 'ACTIVE', `tier ${tierIndex}, zero ${amount}`);
      assert.equal(result.decision, 'ALLOW', `tier ${tierIndex}, zero ${amount}`);
      if (result.read.kind === 'ACTIVE') assert.equal(result.read.observation.overageUnitAmount, '0.005');
    }
    for (const amount of ['1.00', '-1.00', 'not-a-decimal', null, undefined]) {
      const body = boundaryResponse();
      const tier = (body.data.activeSubscription.items[1]!.price as
        { tiers: Array<Record<string, unknown>> }).tiers[tierIndex]!;
      if (amount === undefined) delete tier.amount;
      else tier.amount = amount;
      const result = await decisionFromProvider(body, '2026-06-14T23:59:30.000Z');
      assert.equal(result.read.kind, 'UNSUPPORTED_TARIFF', `tier ${tierIndex}, amount ${String(amount)}`);
      assert.equal(result.decision, 'PENDING_VERIFY', `tier ${tierIndex}, amount ${String(amount)}`);
    }
  }
});

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
