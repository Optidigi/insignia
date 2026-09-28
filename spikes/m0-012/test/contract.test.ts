import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateEffectiveZeroContract } from '../src/contract.ts';

const actual = JSON.parse(readFileSync(new URL('../evidence/baseline/partner-active-after-approval.json', import.meta.url), 'utf8'));
const expected = {
  appId: 'gid://shopify/App/429028933633',
  shopId: 'gid://shopify/Shop/105501393179',
  shopDomain: 'insignia-rewrite-dev.myshopify.com',
  subscriptionId: 'gid://shopify/AppSubscription/38085427483',
  planHandle: 'insignia-dev-zero-20260928',
  meterHandle: 'customized_order_paid',
  cycleFrom: '2026-09-28T16:53:01.000Z',
  cycleUntil: '2026-10-28T16:53:01.000Z',
  maxDistinctUnits: 3,
} as const;

function fixture() { return structuredClone(actual); }
function contract(envelope: any) { return envelope.body.data.activeSubscription; }
function read(envelope: any = fixture()) {
  return validateEffectiveZeroContract(envelope.httpStatus, envelope.body,
    { ...expected, observedAt: envelope.observedAt });
}

test('actual operator-captured Partner response admits its exact effective-zero contract', () => {
  const result = read();
  assert.equal(result.kind, 'VERIFIED');
  if (result.kind !== 'VERIFIED') return;
  assert.equal(result.contract.subscriptionId, expected.subscriptionId);
  assert.equal(result.contract.plan.catalogPriceActive, false);
  assert.equal(result.contract.meter.catalogPriceActive, false);
  assert.equal(result.contract.meter.tiersMode, 'VOLUME');
  assert.equal(result.contract.meter.tier.amountPerUnit, '0.0');
  assert.equal(result.contract.meter.tier.amount, '0.0');
  assert.equal(result.contract.meter.tier.upTo, null);
  assert.equal(result.contract.usage.kind, 'OBSERVED');
  if (result.contract.usage.kind === 'OBSERVED') {
    assert.equal(result.contract.usage.quantity, 0);
    assert.equal(result.contract.usage.cost, '0.0');
  }
});

test('both initial and final reads refuse wrong identity, missing/extra/duplicate items', () => {
  for (const stage of ['initial', 'final']) {
    for (const change of [
      (x: any) => { contract(x).app.id = 'gid://shopify/App/1'; },
      (x: any) => { contract(x).shop.id = 'gid://shopify/Shop/1'; },
      (x: any) => { contract(x).shop.myshopifyDomain = 'other.myshopify.com'; },
      (x: any) => { contract(x).legacySubscriptionId = 'gid://shopify/AppSubscription/1'; },
      (x: any) => { contract(x).items.pop(); },
      (x: any) => { contract(x).items.push(structuredClone(contract(x).items[1])); },
      (x: any) => { contract(x).items.push({ handle: 'other', price: { __typename: 'FlatRatePrice', amount: '0.0' } }); },
    ]) {
      const x = fixture(); change(x);
      assert.notEqual(read(x).kind, 'VERIFIED', stage);
    }
  }
});

test('the two required items match by unique handle and type, not order', () => {
  const x = fixture(); contract(x).items.reverse();
  assert.equal(read(x).kind, 'VERIFIED');
});

test('every effective monetary field and price metadata is independently checked', () => {
  const mutations = [
    (x: any) => { contract(x).items[0].price.amount = '0.01'; },
    (x: any) => { contract(x).items[0].price.amount = '0e0'; },
    (x: any) => { contract(x).items[1].price.tiers[0].amountPerUnit = '0.01'; },
    (x: any) => { contract(x).items[1].price.tiers[0].amount = '0.01'; },
    (x: any) => { delete contract(x).items[0].price.active; },
    (x: any) => { contract(x).items[1].price.active = true; },
    (x: any) => { contract(x).items[1].price.currency = 'EUR'; },
    (x: any) => { contract(x).items[1].discount = { amount: '1.0' }; },
    (x: any) => { contract(x).items[1].usage.cost.amount = '0.01'; },
  ];
  for (const change of mutations) {
    const x = fixture(); change(x);
    assert.notEqual(read(x).kind, 'VERIFIED');
  }
});

test('single volume tier and its capacity are explicit', () => {
  for (const change of [
    (x: any) => { contract(x).items[1].price.tiersMode = 'GRADUATED'; },
    (x: any) => { contract(x).items[1].price.tiers.push(structuredClone(contract(x).items[1].price.tiers[0])); },
    (x: any) => { contract(x).items[1].price.tiers = []; },
    (x: any) => { contract(x).items[1].price.tiers[0].upTo = 2; },
  ]) {
    const x = fixture(); change(x);
    assert.notEqual(read(x).kind, 'VERIFIED');
  }
  const finite = fixture(); contract(finite).items[1].price.tiers[0].upTo = 3;
  assert.equal(read(finite).kind, 'VERIFIED');
});

test('cycle and transition fields reject changed economics; equivalent offset spelling is canonical', () => {
  const offset = fixture();
  contract(offset).currentBillingCycle.startTime = '2026-09-28T18:53:01+02:00';
  assert.equal(read(offset).kind, 'VERIFIED');
  for (const change of [
    (x: any) => { contract(x).currentBillingCycle.endTime = '2026-10-29T16:53:01Z'; },
    (x: any) => { contract(x).trialEndsAt = '2026-09-29T16:53:01Z'; },
    (x: any) => { contract(x).pendingUpdate = { billingPeriod: 'EVERY_30_DAYS', items: [] }; },
    (x: any) => { contract(x).cancelAtEndOfCycle = true; },
    (x: any) => { x.observedAt = '2026-11-01T00:00:00Z'; },
  ]) {
    const x = fixture(); change(x);
    assert.notEqual(read(x).kind, 'VERIFIED');
  }
});

test('null or missing usage is unknown, never a fabricated zero-count observation', () => {
  for (const change of [
    (x: any) => { contract(x).items[1].usage = null; },
    (x: any) => { delete contract(x).items[1].usage; },
  ]) {
    const x = fixture(); change(x);
    const result = read(x);
    assert.equal(result.kind, 'VERIFIED');
    if (result.kind === 'VERIFIED') assert.deepEqual(result.contract.usage, { kind: 'UNKNOWN' });
  }
  const malformed = fixture(); contract(malformed).items[1].usage.quantity = 0.5;
  assert.notEqual(read(malformed).kind, 'VERIFIED');
});
