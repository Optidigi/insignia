/** Diagnostic: no network or provider operation. Optional argument = repository root.
 * Node 24: node reproduce.mjs /path/to/insignia
 * Principal runtime: node --experimental-strip-types reproduce.mjs
 * A success exit means the documented pre-fix findings were reproduced, not fixed. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = process.argv[2];
const url = name => root
  ? pathToFileURL(path.join(root, 'spikes/m0-010/src', name)).href
  : new URL(`./source/${name}`, import.meta.url).href;
const { parseActiveSubscription, currentHistory } = await import(url('partner.ts'));
let Proof;
if (root) ({ BillingProof: Proof } = await import(url('index.ts')));
else ({ EntitlementExcerpt: Proof } = await import(url('entitlement-excerpt.ts')));

const appId = 'gid://shopify/App/202', shopId = 'gid://shopify/Shop/101';
const context = { appId, shopId, observedAt: '2026-06-14T23:59:00.000Z' };
const plans = [{ handle: 'fixture_a', features: ['proof.alpha'], includedOrders: 2,
  mockMonthlyCents: 101, mockOverageCents: 17 }];
function response() {
  return { data: { activeSubscription: {
    app: { id: appId }, shop: { id: shopId, myshopifyDomain: 'fixture.myshopify.com' },
    billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: true, trialEndsAt: null,
    currentBillingCycle: { startTime: '2026-05-16T00:00:00.000Z', endTime: '2026-06-15T00:00:00.000Z' },
    items: [
      { handle: 'fixture_a', price: { __typename: 'FlatRatePrice', active: true,
        currency: 'USD', amount: '1.01' }, usage: null },
      { handle: 'customized_order_paid', price: { __typename: 'TieredPrice', active: true,
        currency: 'USD', tiersMode: 'GRADUATED', tiers: [
          { upTo: 2, amountPerUnit: '0.00', amount: '0.00' },
          { upTo: null, amountPerUnit: '0.17', amount: '0.00' }
        ] }, usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } } }
    ], pendingUpdate: null, legacySubscriptionId: null
  } } };
}
const proof = new Proof(plans, appId);
const read = parseActiveSubscription(200, response(), context);
assert.equal(read.kind, 'ACTIVE');
const history = currentHistory(read.observation);
const moments = [
  '2026-06-14T23:59:30.000Z', // before scheduled cancellation
  '2026-06-15T00:00:00.000Z', // exact cancellation boundary
  '2026-06-15T00:01:00.000Z', // after boundary but within 5-minute freshness
  '2026-06-15T00:05:00.000Z'  // old snapshot finally expires
];
const decisions = moments.map(now => ({ now, decision: proof.decideNewAction(history, shopId, 'proof.alpha', now) }));
assert.equal(history.intervals[0].until, null);
assert.deepEqual(decisions.map(x => x.decision), ['ALLOW', 'ALLOW', 'ALLOW', 'PENDING_VERIFY']);
// Control: supplying the exact boundary makes the existing business method refuse reuse.
const bounded = structuredClone(history);
bounded.intervals[0].until = read.observation.currentCycle.until;
const control = proof.decideNewAction(bounded, shopId, 'proof.alpha', moments[2]);
assert.equal(control, 'PENDING_VERIFY');

const tariffResults = [];
for (const tierIndex of [0, 1]) {
  for (const amount of ['0.00', '1.00', '-1.00', 'not-a-decimal', null, undefined]) {
    const body = response();
    const tier = body.data.activeSubscription.items[1].price.tiers[tierIndex];
    if (amount === undefined) delete tier.amount;
    else tier.amount = amount;
    const parsed = parseActiveSubscription(200, body, context);
    tariffResults.push({ tierIndex, amount: amount === undefined ? '(missing)' : amount,
      result: parsed.kind, normalizedIncludedUnits: parsed.observation?.zeroCostBandUpTo });
    assert.equal(parsed.kind, 'ACTIVE');
    assert.equal(parsed.observation.zeroCostBandUpTo, 2);
  }
}
const fractional = response();
fractional.data.activeSubscription.items[1].price.tiers[1].amountPerUnit = '0.005';
assert.equal(parseActiveSubscription(200, fractional, context).kind, 'ACTIVE');
console.log(JSON.stringify({
  runtime: process.version,
  mode: root ? 'full repository modules' : 'byte-identical partner/time plus disclosed entitlement excerpt',
  networkOrProviderOperations: 0,
  R1: { observedAt: context.observedAt, cancellationAt: read.observation.currentCycle.until,
    cancelAtEndOfCycle: read.observation.cancelAtEndOfCycle, normalizedUntil: history.intervals[0].until,
    decisions, explicitBoundaryControl: control },
  R2: { tariffResults, fractionalUnitRatePositiveControl: 'ACTIVE' }
}, null, 2));
