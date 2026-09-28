import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingProof, FakeAppEvents, TEST_PLANS, type VerifiedHistory,
  type VerifiedPurchase, type VerifiedSubmissionWindow } from '../src/index.ts';

const shopId = 'gid://shopify/Shop/101';
const appId = 'gid://shopify/App/202';

function paidHistory(): VerifiedHistory {
  return {
    source: 'PARTNER_API_2026_07', appId, shopId,
    observedAt: '2026-06-01T12:00:00.000Z',
    completeFrom: '2026-01-01T00:00:00.000Z',
    completeThrough: '2026-06-01T12:00:00.000Z',
    intervals: [{
      from: '2026-01-15T00:00:00.000Z', until: null,
      state: 'ACTIVE', planHandle: 'fixture_a',
      evidenceId: 'synthetic-contract-1',
      trial: null
    }]
  };
}

function purchase(orderId: string, quantity: number): VerifiedPurchase {
  return {
    source: 'VERIFIED_PURCHASE_FACT', appId, shopId, orderId,
    installationGeneration: 'generation-1',
    firstFullyPaidAt: '2026-05-31T12:00:00.000Z',
    fullyPaid: true, shopifyTest: false,
    verifiedCustomizationGroups: 3, customizedQuantity: quantity
  };
}

function openWindow(): VerifiedSubmissionWindow {
  return { source: 'PARTNER_API_2026_07', appId, shopId,
    observedAt: '2026-06-01T12:00:00.000Z',
    cycleFrom: '2026-05-15T00:00:00.000Z', cycleUntil: '2026-06-15T00:00:00.000Z' };
}

test('one fully paid order of 500 garments creates one stable usage fact; another order is distinct', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const first = proof.recordPaid(purchase('gid://shopify/Order/301', 500), paidHistory());
  assert.equal(first.kind, 'BILLABLE');
  assert.equal(proof.facts().length, 1);
  assert.equal(proof.outbox().length, 1);
  assert.equal(proof.outbox()[0]?.event.attributes.value, 1);
  assert.equal(proof.outbox()[0]?.event.timestamp, '2026-05-31T12:00:00.000Z');
  assert.match(proof.outbox()[0]?.event.idempotency_key ?? '', /^[0-9a-f]{64}$/);
  assert.equal(proof.recordPaid(purchase('gid://shopify/Order/301', 500), paidHistory()).kind, 'BILLABLE');
  assert.equal(proof.outbox().length, 1);
  assert.equal(proof.recordPaid(purchase('gid://shopify/Order/302', 1), paidHistory()).kind, 'BILLABLE');
  assert.equal(proof.outbox().length, 2);
});

test('new actions require a fresh active verified plan and its feature; billing loss does not revoke old offers', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const observed = paidHistory();
  assert.equal(proof.decideNewAction(observed, shopId, 'proof.alpha', '2026-06-01T12:01:00.000Z'), 'ALLOW');
  assert.equal(proof.decideNewAction(observed, shopId, 'proof.beta', '2026-06-01T12:01:00.000Z'), 'DENY_FEATURE');
  assert.equal(proof.decideNewAction(observed, shopId, 'proof.alpha', '2026-06-01T12:06:00.000Z'), 'PENDING_VERIFY');
  assert.equal(proof.decideNewAction(observed, 'gid://shopify/Shop/999', 'proof.alpha', '2026-06-01T12:01:00.000Z'), 'PENDING_VERIFY');
  const frozen: VerifiedHistory = {
    ...observed, intervals: [{ ...observed.intervals[0]!, state: 'FROZEN' }]
  };
  assert.equal(proof.decideNewAction(frozen, shopId, 'proof.alpha', '2026-06-01T12:00:00.000Z'), 'DENY_INACTIVE');
  assert.equal(proof.billingEffectOnExistingOffer(), 'NONE');
  assert.equal(proof.billingEffectOnHistoricalPurchase(), 'NONE');
});

test('provider-confirmed trial qualification survives delayed processing and a plan change cannot reset it', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const history: VerifiedHistory = {
    ...paidHistory(),
    intervals: [
      { from: '2026-01-01T00:00:00.000Z', until: '2026-01-15T00:00:00.000Z',
        state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'synthetic-contract-1',
        trial: { from: '2026-01-01T00:00:00.000Z', until: '2026-01-15T00:00:00.000Z' } },
      { from: '2026-01-15T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z',
        state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'synthetic-contract-1', trial: null },
      { from: '2026-02-01T00:00:00.000Z', until: null,
        state: 'ACTIVE', planHandle: 'fixture_b', evidenceId: 'synthetic-contract-1', trial: null }
    ]
  };
  const trialOrder = { ...purchase('gid://shopify/Order/303', 1), firstFullyPaidAt: '2026-01-14T23:59:59.000Z' };
  assert.equal(proof.recordPaid(trialOrder, history).kind, 'WAIVED_TRIAL');
  assert.equal(proof.outbox().length, 0);
  assert.equal(proof.recordPaid(trialOrder, history).kind, 'WAIVED_TRIAL');
  assert.equal(proof.recordPaid({ ...purchase('gid://shopify/Order/304', 1), firstFullyPaidAt: '2026-02-02T00:00:00.000Z' }, history).kind, 'BILLABLE');
  assert.equal(proof.outbox().length, 1);
});

test('plain, partial, test and proven inactive orders do not emit usage; later reactivation does not retrocharge', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const history: VerifiedHistory = {
    ...paidHistory(),
    intervals: [
      { from: '2026-01-01T00:00:00.000Z', until: '2026-05-15T00:00:00.000Z',
        state: 'FROZEN', evidenceId: 'synthetic-frozen-1', trial: null },
      { from: '2026-05-15T00:00:00.000Z', until: null,
        state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'synthetic-contract-2', trial: null }
    ]
  };
  const base = purchase('gid://shopify/Order/305', 1);
  assert.equal(proof.recordPaid({ ...base, verifiedCustomizationGroups: 0 }, history).kind, 'IGNORED');
  assert.equal(proof.recordPaid({ ...base, fullyPaid: false }, history).kind, 'IGNORED');
  assert.equal(proof.recordPaid({ ...base, shopifyTest: true }, history).kind, 'IGNORED');
  const frozenOrder = { ...base, firstFullyPaidAt: '2026-05-14T12:00:00.000Z' };
  assert.equal(proof.recordPaid(frozenOrder, history).kind, 'UNBILLABLE_INACTIVE');
  assert.equal(proof.recordPaid(frozenOrder, paidHistory()).kind, 'UNBILLABLE_INACTIVE');
  assert.equal(proof.outbox().length, 0);
});

test('incomplete or ambiguous history stays pending until a verified interval covers the immutable paid instant', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const original = { ...purchase('gid://shopify/Order/306', 1), firstFullyPaidAt: '2026-02-01T12:00:00.000Z' };
  const shortHistory: VerifiedHistory = {
    ...paidHistory(), completeFrom: '2026-05-01T00:00:00.000Z'
  };
  assert.equal(proof.recordPaid(original, shortHistory).kind, 'PENDING_HISTORY');
  assert.equal(proof.outbox().length, 0);
  assert.throws(() => proof.recordPaid({ ...original, firstFullyPaidAt: '2026-02-02T12:00:00.000Z' }, paidHistory()), /First-paid instant changed/);
  const recovered: VerifiedHistory = {
    ...paidHistory(), intervals: [{ from: '2026-01-01T00:00:00.000Z', until: null,
      state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'synthetic-contract-1', trial: null }]
  };
  assert.equal(proof.recordPaid(original, recovered).kind, 'BILLABLE');
  assert.equal(proof.outbox()[0]?.event.timestamp, original.firstFullyPaidAt);
  assert.throws(() => proof.recordPaid({ ...purchase('gid://shopify/Order/307', 1), shopId: 'gid://shopify/Shop/999' }, paidHistory()), /tenant mismatch/);
  assert.throws(() => proof.recordPaid({ ...purchase('gid://shopify/Order/307', 1), appId: 'gid://shopify/App/999' }, paidHistory()), /tenant mismatch/);
  const unbound: VerifiedHistory = {
    ...recovered, intervals: [{ from: '2026-01-01T00:00:00.000Z', until: null,
      state: 'ACTIVE', planHandle: 'fixture_a', trial: null }]
  };
  assert.equal(proof.recordPaid(purchase('gid://shopify/Order/308', 1), unbound).kind, 'PENDING_HISTORY');
  const inactiveWithoutEvidence: VerifiedHistory = {
    ...recovered, intervals: [{ from: '2026-01-01T00:00:00.000Z', until: null,
      state: 'FROZEN', trial: null }]
  };
  assert.equal(proof.recordPaid(purchase('gid://shopify/Order/330', 1), inactiveWithoutEvidence).kind,
    'PENDING_HISTORY');
  assert.equal(proof.recordPaid(purchase('gid://shopify/Order/330', 1), {
    ...inactiveWithoutEvidence, intervals: [{ ...inactiveWithoutEvidence.intervals[0]!, evidenceId: 'synthetic-frozen-proof' }]
  }).kind, 'UNBILLABLE_INACTIVE');
});

test('noninteger counts cannot become billable, and provider Z instant is stored canonically', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const candidate = purchase('gid://shopify/Order/331', 1);
  assert.equal(proof.recordPaid({ ...candidate, customizedQuantity: Number.NaN }, paidHistory()).kind, 'IGNORED');
  assert.equal(proof.recordPaid({ ...candidate, verifiedCustomizationGroups: Number.POSITIVE_INFINITY }, paidHistory()).kind, 'IGNORED');
  assert.equal(proof.recordPaid({ ...candidate, firstFullyPaidAt: '2026-05-31T12:00:00Z' }, paidHistory()).kind,
    'BILLABLE');
  assert.equal(proof.facts()[0]?.firstFullyPaidAt, candidate.firstFullyPaidAt);
});

test('restart preserves one atomic fact and outbox identity across duplicate delivery and reinstall', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const original = purchase('gid://shopify/Order/309', 500);
  proof.recordPaid(original, paidHistory());
  const before = proof.outbox()[0]!;
  const snapshot = proof.exportSnapshot();
  const restarted = BillingProof.resume(TEST_PLANS, appId, snapshot);
  restarted.recordPaid({ ...original, installationGeneration: 'generation-2' }, paidHistory());
  assert.equal(restarted.facts().length, 1);
  assert.deepEqual(restarted.outbox()[0], before);
  assert.throws(() => restarted.recordPaid({ ...original, firstFullyPaidAt: '2026-05-31T12:00:01.000Z' }, paidHistory()), /First-paid instant changed/);
  assert.throws(() => BillingProof.resume(TEST_PLANS, appId, { ...snapshot, outbox: [] }), /missing outbox/);
});

test('a key-generation failure leaves no billable fact without outbox and retry can qualify', () => {
  let fail = true;
  const proof = new BillingProof(TEST_PLANS, appId, () => {
    if (fail) throw new Error('synthetic RNG failure');
    return 'a'.repeat(64);
  });
  const candidate = purchase('gid://shopify/Order/333', 1);
  assert.throws(() => proof.recordPaid(candidate, paidHistory()), /synthetic RNG failure/);
  assert.equal(proof.facts().length, 0);
  assert.equal(proof.outbox().length, 0);
  fail = false;
  assert.equal(proof.recordPaid(candidate, paidHistory()).kind, 'BILLABLE');
  assert.equal(proof.outbox().length, 1);
});

test('202 records transport receipt only; a timeout/retry reuses exact key and occurrence time', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/310', 1), paidHistory());
  const fake = new FakeAppEvents(['TIMEOUT', 'RECEIVED']);
  const first = await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z');
  assert.equal(first, 'RETRY_SCHEDULED');
  assert.equal(proof.outbox()[0]?.state, 'PENDING');
  const tooSoon = await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:02.000Z');
  assert.equal(tooSoon, 'NOT_DUE');
  const second = await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:05.000Z');
  assert.equal(second, 'TRANSPORT_ACCEPTED');
  assert.equal(proof.outbox()[0]?.state, 'TRANSPORT_ACCEPTED');
  assert.deepEqual(fake.attempts[0], fake.attempts[1]);
  assert.deepEqual(Object.keys(fake.attempts[1]!.attributes), ['value']);
  assert.equal(proof.outbox()[0]?.attempts, 2);
});

test('simultaneous dispatcher calls cannot send a second copy from one in-memory outbox', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/311', 1), paidHistory());
  const fake = new FakeAppEvents(['RECEIVED']);
  const [a, b] = await Promise.all([
    proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'),
    proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z')
  ]);
  assert.deepEqual([a, b].sort(), ['NO_PENDING', 'TRANSPORT_ACCEPTED']);
  assert.equal(fake.attempts.length, 1);
});

test('a delayed retry does not block another due event', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/321', 1), paidHistory());
  proof.recordPaid(purchase('gid://shopify/Order/322', 1), paidHistory());
  const fake = new FakeAppEvents(['TIMEOUT', 'RECEIVED']);
  assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'RETRY_SCHEDULED');
  assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:01.000Z'), 'TRANSPORT_ACCEPTED');
  assert.equal(fake.attempts.length, 2);
  assert.notEqual(fake.attempts[0]?.idempotency_key, fake.attempts[1]?.idempotency_key);
});

test('all included and overage units are sent; fake graduated band applies once after async processing', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const fake = new FakeAppEvents();
  for (const id of [312, 313, 314])
    assert.equal(proof.recordPaid(purchase(`gid://shopify/Order/${id}`, 1), paidHistory()).kind, 'BILLABLE');
  for (let i = 0; i < 3; i++)
    assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'TRANSPORT_ACCEPTED');
  assert.equal(fake.attempts.length, 3);
  assert.deepEqual(fake.attempts.map(event => event.attributes.value), [1, 1, 1]);
  assert.ok(proof.outbox().every(row => row.state === 'TRANSPORT_ACCEPTED'));
  const aggregate = fake.processCycle(appId, shopId, openWindow().cycleFrom, openWindow().cycleUntil, TEST_PLANS[0]!);
  assert.deepEqual({ quantity: aggregate.quantity, mockCostCents: aggregate.mockCostCents },
    { quantity: 3, mockCostCents: 17 });
  assert.equal(proof.reconcileAggregate(aggregate), 'AGGREGATE_MATCH_ONLY');
  assert.equal(proof.reconcileAggregate({ ...aggregate, mockCostCents: 18 }), 'REVIEW_REQUIRED');
  assert.equal(proof.reconcileAggregate({ ...aggregate, appId: 'gid://shopify/App/999' }), 'REVIEW_REQUIRED');
  assert.ok(proof.outbox().every(row => row.state === 'TRANSPORT_ACCEPTED'));
  assert.equal(proof.reconcileAggregate({ ...aggregate, shopId: 'gid://shopify/Shop/999', quantity: 0 }), 'REVIEW_REQUIRED');
});

test('another app subscription window cannot authorize same-shop delivery', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/334', 1), paidHistory());
  const fake = new FakeAppEvents();
  assert.equal(await proof.dispatchNext(fake, { ...openWindow(), appId: 'gid://shopify/App/999' },
    '2026-06-01T12:00:00.000Z'), 'RECONCILIATION_REQUIRED');
  assert.equal(fake.attempts.length, 0);
});

test('future-dated occurrence is deferred without changing its immutable timestamp', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const future = { ...purchase('gid://shopify/Order/332', 1),
    firstFullyPaidAt: '2026-06-01T12:10:00.000Z' };
  const history = { ...paidHistory(), observedAt: '2026-06-01T12:11:00.000Z',
    completeThrough: '2026-06-01T12:11:00.000Z' };
  assert.equal(proof.recordPaid(future, history).kind, 'BILLABLE');
  const fake = new FakeAppEvents();
  assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'NOT_DUE');
  assert.equal(fake.attempts.length, 0);
  assert.equal(proof.outbox()[0]?.nextAttemptAt, '2026-06-01T12:05:00.000Z');
  assert.equal(await proof.dispatchNext(fake,
    { ...openWindow(), observedAt: '2026-06-01T12:05:00.000Z' },
    '2026-06-01T12:05:00.000Z'), 'TRANSPORT_ACCEPTED');
  assert.equal(fake.attempts[0]?.timestamp, future.firstFullyPaidAt);
});

test('ambiguous receipt replays the same identity; 409, 429 and 5xx respect bounded retry', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/315', 1), paidHistory());
  const fake = new FakeAppEvents([
    'TIMEOUT_AFTER_RECEIPT', 'CONFLICT', { kind: 'RATE_LIMITED', retryAfterMs: 12_000 },
    'SERVER_ERROR', 'RECEIVED'
  ]);
  const times = ['12:00:00', '12:00:05', '12:00:15', '12:00:35', '12:01:15']
    .map(time => `2026-06-01T${time}.000Z`);
  for (let i = 0; i < 4; i++)
    assert.equal(await proof.dispatchNext(fake, openWindow(), times[i]!), 'RETRY_SCHEDULED');
  assert.equal(proof.outbox()[0]?.nextAttemptAt, '2026-06-01T12:01:15.000Z');
  assert.equal(await proof.dispatchNext(fake, openWindow(), times[4]!), 'TRANSPORT_ACCEPTED');
  assert.equal(fake.received.size, 1);
  assert.ok(fake.attempts.every(attempt => JSON.stringify(attempt) === JSON.stringify(fake.attempts[0])));
});

test('auth, malformed or closed-period delivery becomes reviewable without shifting the occurrence', async () => {
  for (const terminal of ['AUTH_ERROR', 'VALIDATION_ERROR'] as const) {
    const proof = new BillingProof(TEST_PLANS, appId);
    proof.recordPaid(purchase('gid://shopify/Order/316', 1), paidHistory());
    const fake = new FakeAppEvents([terminal]);
    assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'RECONCILIATION_REQUIRED');
    assert.equal(proof.outbox()[0]?.event.timestamp, '2026-05-31T12:00:00.000Z');
    assert.equal(proof.outbox()[0]?.state, 'RECONCILIATION_REQUIRED');
  }
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/317', 1), paidHistory());
  const fake = new FakeAppEvents();
  assert.equal(await proof.dispatchNext(fake, { ...openWindow(), cycleFrom: '2026-06-01T00:00:00.000Z' },
    '2026-06-01T12:00:00.000Z'), 'RECONCILIATION_REQUIRED');
  assert.equal(fake.attempts.length, 0);
  assert.equal(proof.outbox()[0]?.event.timestamp, '2026-05-31T12:00:00.000Z');
});

test('an async billing-validation failure after 202 is not reconciled as billed', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/318', 1), paidHistory());
  const fake = new FakeAppEvents();
  assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'TRANSPORT_ACCEPTED');
  const processed = fake.processCycle(appId, shopId, '2026-06-01T00:00:00.000Z',
    '2026-06-15T00:00:00.000Z', TEST_PLANS[0]!);
  assert.equal(processed.quantity, 0);
  assert.equal(processed.failedKeys.length, 1);
  assert.equal(proof.reconcileAggregate(processed), 'REVIEW_REQUIRED');
  assert.equal(proof.outbox()[0]?.state, 'TRANSPORT_ACCEPTED');
});

test('aggregate agreement cannot hide an unresolved local delivery', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/320', 1), paidHistory());
  const fake = new FakeAppEvents(['VALIDATION_ERROR']);
  assert.equal(await proof.dispatchNext(fake, openWindow(), '2026-06-01T12:00:00.000Z'), 'RECONCILIATION_REQUIRED');
  const observed = { source: 'FAKE_PROCESSED_AGGREGATE' as const, appId, planHandle: 'fixture_a',
    shopId, cycleFrom: openWindow().cycleFrom, cycleUntil: openWindow().cycleUntil,
    quantity: 0, mockCostCents: 0, failedKeys: [] };
  assert.equal(proof.reconcileAggregate(observed), 'REVIEW_REQUIRED');
});

test('frozen, cancelled, downgraded and reinstated states gate only new features at their verified times', () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  const intervals: VerifiedHistory['intervals'] = [
    { from: '2026-01-01T00:00:00.000Z', until: '2026-02-01T00:00:00.000Z',
      state: 'ACTIVE', planHandle: 'fixture_b', evidenceId: 'event-1', trial: null },
    { from: '2026-02-01T00:00:00.000Z', until: '2026-03-01T00:00:00.000Z',
      state: 'ACTIVE', planHandle: 'fixture_a', evidenceId: 'event-2', trial: null },
    { from: '2026-03-01T00:00:00.000Z', until: '2026-04-01T00:00:00.000Z',
      state: 'FROZEN', evidenceId: 'synthetic-frozen-2', trial: null },
    { from: '2026-04-01T00:00:00.000Z', until: '2026-05-01T00:00:00.000Z',
      state: 'CANCELLED', evidenceId: 'synthetic-cancelled-1', trial: null },
    { from: '2026-05-01T00:00:00.000Z', until: null,
      state: 'ACTIVE', planHandle: 'fixture_c', evidenceId: 'event-3', trial: null }
  ];
  const snapshotAt = (time: string): VerifiedHistory => ({
    ...paidHistory(), observedAt: time, completeThrough: time, intervals
  });
  assert.equal(proof.decideNewAction(snapshotAt('2026-01-15T12:00:00.000Z'), shopId,
    'proof.beta', '2026-01-15T12:00:00.000Z'), 'ALLOW');
  assert.equal(proof.decideNewAction(snapshotAt('2026-02-15T12:00:00.000Z'), shopId,
    'proof.beta', '2026-02-15T12:00:00.000Z'), 'DENY_FEATURE');
  assert.equal(proof.decideNewAction(snapshotAt('2026-02-15T12:00:00.000Z'), shopId,
    'proof.alpha', '2026-02-15T12:00:00.000Z'), 'ALLOW');
  assert.equal(proof.decideNewAction(snapshotAt('2026-03-15T12:00:00.000Z'), shopId,
    'proof.alpha', '2026-03-15T12:00:00.000Z'), 'DENY_INACTIVE');
  assert.equal(proof.decideNewAction(snapshotAt('2026-04-15T12:00:00.000Z'), shopId,
    'proof.alpha', '2026-04-15T12:00:00.000Z'), 'DENY_INACTIVE');
  assert.equal(proof.decideNewAction(snapshotAt('2026-05-15T12:00:00.000Z'), shopId,
    'proof.gamma', '2026-05-15T12:00:00.000Z'), 'ALLOW');
});

test('automatic attempts stop at twelve without creating a new key or date', async () => {
  const proof = new BillingProof(TEST_PLANS, appId);
  proof.recordPaid(purchase('gid://shopify/Order/319', 1), paidHistory());
  const fake = new FakeAppEvents(Array(12).fill('SERVER_ERROR'));
  let now = '2026-06-01T12:00:00.000Z';
  for (let attempt = 1; attempt <= 12; attempt++) {
    const window = { ...openWindow(), observedAt: now };
    const outcome = await proof.dispatchNext(fake, window, now);
    assert.equal(outcome, attempt === 12 ? 'RECONCILIATION_REQUIRED' : 'RETRY_SCHEDULED');
    now = proof.outbox()[0]?.nextAttemptAt ?? now;
  }
  assert.equal(fake.attempts.length, 12);
  assert.equal(new Set(fake.attempts.map(event => event.idempotency_key)).size, 1);
  assert.equal(new Set(fake.attempts.map(event => event.timestamp)).size, 1);
  assert.equal(proof.outbox()[0]?.state, 'RECONCILIATION_REQUIRED');
});
