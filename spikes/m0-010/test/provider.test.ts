import assert from 'node:assert/strict';
import test from 'node:test';
import { PARTNER_ACTIVE_QUERY, PARTNER_HISTORY_QUERY, parseActiveSubscription,
  parseHistoryPage, currentHistory } from '../src/partner.ts';

const appId = 'gid://shopify/App/202';
const shopId = 'gid://shopify/Shop/101';
const context = { appId, shopId, observedAt: '2026-06-01T12:00:00.000Z' };

function activeResponse(): unknown {
  return { data: { activeSubscription: {
    app: { id: appId },
    shop: { id: shopId, myshopifyDomain: 'fixture.myshopify.com' },
    billingPeriod: 'EVERY_30_DAYS', cancelAtEndOfCycle: false, trialEndsAt: null,
    currentBillingCycle: { startTime: '2026-05-15T00:00:00.000Z', endTime: '2026-06-15T00:00:00.000Z' },
    items: [
      { handle: 'fixture_a', price: { __typename: 'FlatRatePrice', active: true, currency: 'USD', amount: '1.01' }, usage: null },
      { handle: 'customized_order_paid', price: { __typename: 'TieredPrice', active: true, currency: 'USD',
        tiersMode: 'GRADUATED', tiers: [
          { upTo: 2, amountPerUnit: '0.00', amount: '0.00' },
          { upTo: null, amountPerUnit: '0.17', amount: '0.00' }
        ] }, usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } } }
    ], pendingUpdate: null, legacySubscriptionId: null
  } } };
}

test('documented Partner API fields normalize only a current verified observation', () => {
  assert.match(PARTNER_ACTIVE_QUERY, /activeSubscription\(appId: \$appId, shopId: \$shopId\)/);
  const result = parseActiveSubscription(200, activeResponse(), context);
  assert.equal(result.kind, 'ACTIVE');
  if (result.kind !== 'ACTIVE') return;
  assert.equal(result.observation.planHandle, 'fixture_a');
  assert.equal(result.observation.meterHandle, 'customized_order_paid');
  assert.equal(result.observation.zeroCostBandUpTo, 2);
  const history = currentHistory(result.observation);
  assert.equal(history.completeFrom, context.observedAt);
  assert.equal(history.completeThrough, context.observedAt);
  assert.equal(history.intervals[0]?.evidenceId?.length, 64);
});

test('null subscription, GraphQL errors, identity mismatch and unknown tariff refuse current entitlement', () => {
  assert.equal(parseActiveSubscription(200, { data: { activeSubscription: null } }, context).kind, 'NO_ACTIVE_CURRENT');
  assert.equal(parseActiveSubscription(200, { errors: [{ message: 'Only public apps can access active subscription' }] }, context).kind, 'PUBLIC_APP_REQUIRED');
  assert.equal(parseActiveSubscription(429, {}, context).kind, 'RATE_LIMITED');
  const wrong = activeResponse() as { data: { activeSubscription: { shop: { id: string } } } };
  wrong.data.activeSubscription.shop.id = 'gid://shopify/Shop/999';
  assert.equal(parseActiveSubscription(200, wrong, context).kind, 'MISMATCH');
  const tariff = activeResponse() as { data: { activeSubscription: { items: Array<{ price: { tiersMode?: string } }> } } };
  tariff.data.activeSubscription.items[1]!.price.tiersMode = 'VOLUME';
  assert.equal(parseActiveSubscription(200, tariff, context).kind, 'UNSUPPORTED_TARIFF');
});

test('history parser requires explicit range and scoped app/shop, returning page state for caller pagination', () => {
  assert.match(PARTNER_HISTORY_QUERY, /occurredAtMin: \$from/);
  const page = parseHistoryPage(200, { data: { events: {
    edges: [{ cursor: 'synthetic-cursor-1', node: {
      id: 'synthetic-event-1', occurredAt: '2026-01-01T00:00:00.000Z',
      eventType: 'SUBSCRIPTION_CREATED', shop: { id: shopId }, subject: { id: appId },
      state: 'ACTIVE', cancelEffectiveOn: null,
      plan: { handle: 'fixture_a', billingPeriod: 'EVERY_30_DAYS', trialDays: 14, trialDaysRemaining: 14 }
    } }], pageInfo: { hasNextPage: false, endCursor: 'synthetic-cursor-1' }
  } } }, { ...context, from: '2026-01-01T00:00:00.000Z', through: '2026-06-01T12:00:00.000Z' });
  assert.equal(page.kind, 'PAGE');
  if (page.kind !== 'PAGE') return;
  assert.equal(page.events[0]?.planHandle, 'fixture_a');
  assert.equal(page.hasNextPage, false);
  assert.equal(page.exactHistoricalTrialInterval, false);
});

test('documented provider Z instants and RFC3339 offsets normalize before business use', () => {
  const response = activeResponse() as { data: { activeSubscription: {
    currentBillingCycle: { startTime: string; endTime: string }
  } } };
  response.data.activeSubscription.currentBillingCycle = {
    startTime: '2026-05-15T00:00:00Z', endTime: '2026-06-15T00:00:00+00:00'
  };
  const parsed = parseActiveSubscription(200, response,
    { ...context, observedAt: '2026-06-01T12:00:00Z' });
  assert.equal(parsed.kind, 'ACTIVE');
  if (parsed.kind === 'ACTIVE') {
    assert.equal(parsed.observation.observedAt, '2026-06-01T12:00:00.000Z');
    assert.equal(parsed.observation.currentCycle?.from, '2026-05-15T00:00:00.000Z');
  }
  const history = parseHistoryPage(200, { data: { events: {
    edges: [{ node: { id: 'synthetic-event-2', shop: { id: shopId },
      occurredAt: '2026-01-01T00:00:00Z', eventType: 'SUBSCRIPTION_CREATED', subject: { id: appId },
      state: 'ACTIVE', cancelEffectiveOn: null,
      plan: { handle: 'fixture_a', trialDays: 14, trialDaysRemaining: 14 } } }],
    pageInfo: { hasNextPage: false, endCursor: 'synthetic-cursor-2' }
  } } }, { ...context, observedAt: '2026-06-01T12:00:00Z',
    from: '2026-01-01T00:00:00Z', through: '2026-06-01T12:00:00Z' });
  assert.equal(history.kind, 'PAGE');
  if (history.kind === 'PAGE') assert.equal(history.events[0]?.occurredAt, '2026-01-01T00:00:00.000Z');
  const wrongApp = parseHistoryPage(200, { data: { events: {
    edges: [{ node: { id: 'synthetic-event-3', shop: { id: shopId },
      subject: { id: 'gid://shopify/App/999' },
      occurredAt: '2026-01-01T00:00:00Z', eventType: 'SUBSCRIPTION_CREATED',
      state: 'ACTIVE', cancelEffectiveOn: null,
      plan: { handle: 'fixture_a', trialDays: 14, trialDaysRemaining: 14 } } }],
    pageInfo: { hasNextPage: false, endCursor: 'synthetic-cursor-3' }
  } } }, { ...context, from: '2026-01-01T00:00:00Z', through: '2026-06-01T12:00:00Z' });
  assert.equal(wrongApp.kind, 'MISMATCH');
});

test('incomplete second tier or currency mismatch cannot authorize a hybrid contract', () => {
  const response = activeResponse() as { data: { activeSubscription: {
    items: Array<{ price: { currency: string; tiers?: Array<{ upTo: number | null; amountPerUnit: string }> } }>
  } } };
  response.data.activeSubscription.items[1]!.price.tiers![1]!.upTo = 100;
  assert.equal(parseActiveSubscription(200, response, context).kind, 'UNSUPPORTED_TARIFF');
  response.data.activeSubscription.items[1]!.price.tiers![1]!.upTo = null;
  response.data.activeSubscription.items[1]!.price.currency = 'EUR';
  assert.equal(parseActiveSubscription(200, response, context).kind, 'UNSUPPORTED_TARIFF');
  response.data.activeSubscription.items[1]!.price.currency = 'USD';
  response.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '-0.17';
  assert.equal(parseActiveSubscription(200, response, context).kind, 'UNSUPPORTED_TARIFF');
  response.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '0.17';
  response.data.activeSubscription.items[1]!.price.tiers!.push({ upTo: null, amountPerUnit: '0.20' });
  assert.equal(parseActiveSubscription(200, response, context).kind, 'UNSUPPORTED_TARIFF');
  response.data.activeSubscription.items[1]!.price.tiers!.pop();
  response.data.activeSubscription.items[1]!.price.tiers![1]!.amountPerUnit = '0.005';
  const fractional = parseActiveSubscription(200, response, context);
  assert.equal(fractional.kind, 'ACTIVE');
  if (fractional.kind === 'ACTIVE') assert.equal(fractional.observation.overageUnitAmount, '0.005');
});

test('trial and pending changes are current-only and inconsistent provider times refuse entitlement', () => {
  const trial = activeResponse() as { data: { activeSubscription: {
    trialEndsAt: string | null; currentBillingCycle: unknown; pendingUpdate: unknown
  } } };
  trial.data.activeSubscription.trialEndsAt = '2026-06-15T12:00:00.000Z';
  trial.data.activeSubscription.currentBillingCycle = null;
  let read = parseActiveSubscription(200, trial, context);
  assert.equal(read.kind, 'ACTIVE');
  if (read.kind === 'ACTIVE') {
    assert.equal(currentHistory(read.observation).completeFrom, context.observedAt);
    assert.equal(currentHistory(read.observation).intervals[0]?.trial?.until, '2026-06-15T12:00:00.000Z');
  }
  trial.data.activeSubscription.trialEndsAt = '2026-05-15T12:00:00.000Z';
  assert.equal(parseActiveSubscription(200, trial, context).kind, 'UNKNOWN_CONTRACT');
  const pending = activeResponse() as { data: { activeSubscription: { pendingUpdate: unknown } } };
  pending.data.activeSubscription.pendingUpdate = { billingPeriod: 'EVERY_30_DAYS', items: [{ handle: 'fixture_b' }] };
  read = parseActiveSubscription(200, pending, context);
  assert.equal(read.kind, 'ACTIVE');
  if (read.kind === 'ACTIVE') {
    assert.deepEqual(read.observation.pendingPlanHandles, ['fixture_b']);
    assert.equal(currentHistory(read.observation).intervals[0]?.until, '2026-06-15T00:00:00.000Z');
  }
});
