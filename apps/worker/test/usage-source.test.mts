import assert from 'node:assert/strict';
import test from 'node:test';
import { createPurchaseUsageQualifier, normalizeCurrentCycleUsageHistory } from '@insignia/application';
import { createWorkerUsageSource } from '../dist/usage-source.js';

const appId = 'gid://shopify/App/123',
  providerShopId = 'gid://shopify/Shop/456';
const scope = { shopId: 'tenant', installationGeneration: '1' };
type Input = Parameters<typeof createWorkerUsageSource>[0];
type Row = Awaited<ReturnType<Input['tenants']['getUsageInstallationWindow']>>;
type Query = Parameters<NonNullable<Input['transport']>['query']>[0];
function required<T>(value: T | null | undefined): T {
  assert(value != null);
  return value;
}
const instant = '2026-10-15T12:00:00.000Z';
function fixture() {
  const row = {
    shopId: 'tenant',
    providerShopId,
    currentGeneration: '1',
    generation: '1',
    activatedAt: '2026-10-01T00:00:00.000Z',
    deactivatedAt: null,
  };
  const binding = {
    appId,
    shopId: providerShopId,
    planHandle: 'plan',
    usageHandle: 'meter',
    policy: { id: 'approved', version: '1' },
  };
  const f: {
    calls: Query[];
    reads: number;
    mutate(): void;
    capped: boolean;
    failure: boolean | number;
    row: Row;
    binding: typeof binding;
  } = { calls: [], reads: 0, mutate: () => {}, capped: false, failure: false, row, binding };
  const options: Input = {
    appId,
    binding: f.binding,
    now: () => new Date(instant),
    tenants: {
      getUsageInstallationWindow: async () => {
        f.reads++;
        return structuredClone(f.row);
      },
    },
    transport: {
      query: async (q) => {
        f.calls.push(q);
        f.mutate();
        if (f.failure === true || f.failure === f.calls.length) throw Error('PRIVATE_PROVIDER_DETAIL');
        if (f.calls.length === 1)
          return JSON.stringify({
            data: {
              activeSubscription: {
                app: { id: appId },
                shop: { id: providerShopId },
                billingPeriod: 'EVERY_30_DAYS',
                cancelAtEndOfCycle: false,
                trialEndsAt: null,
                currentBillingCycle: { startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-31T00:00:00Z' },
                pendingUpdate: null,
                items: [
                  {
                    handle: 'plan',
                    price: { __typename: 'FlatRatePrice', active: true, currency: 'USD', amount: '49.99' },
                    discount: null,
                    usage: null,
                  },
                  {
                    handle: 'meter',
                    price: {
                      __typename: 'TieredPrice',
                      active: true,
                      currency: 'USD',
                      tiersMode: 'VOLUME',
                      tiers: [{ upTo: null, amountPerUnit: '0.10', amount: '0.00' }],
                    },
                    discount: null,
                    usage: { quantity: 0, cost: { amount: '0', currencyCode: 'USD' } },
                  },
                ],
              },
            },
          });
        const cursor = `cursor-${f.calls.length}`;
        return JSON.stringify({
          data: {
            events: {
              edges: [
                {
                  cursor,
                  node: {
                    id: `gid://partners/SubscriptionStatus/event-${f.calls.length}`,
                    occurredAt: '2026-10-01T00:00:01Z',
                    eventType: 'SUBSCRIPTION_CREATED',
                    shop: { id: providerShopId },
                    subject: { id: appId },
                    state: 'CREATED',
                    cancelEffectiveOn: null,
                    plan: { handle: 'plan', billingPeriod: 'EVERY_30_DAYS', trialDays: 14, trialDaysRemaining: 0 },
                  },
                },
              ],
              pageInfo: { hasNextPage: f.capped, endCursor: cursor },
            },
          },
        });
      },
    },
  };
  return Object.assign(f, { options });
}
test('joins real current/history parsers with exact installation and supported current-cycle normalizer', async () => {
  const f = fixture();
  const result = await createWorkerUsageSource(f.options).load(scope);
  assert.equal(normalizeCurrentCycleUsageHistory(result).kind, 'NORMALIZED');
  assert.equal(f.reads, 2);
  assert.deepEqual(required(f.calls[0]).variables, { appId, shopId: providerShopId });
  assert.deepEqual(required(f.calls[1]).variables, {
    appId,
    shopId: providerShopId,
    from: '2026-10-01T00:00:00.000Z',
    through: instant,
    after: null,
  });
});
test('unqualified mapping and foreign, inactive, historical or missing installation make no provider calls', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.options.binding = null;
    },
    (f: ReturnType<typeof fixture>) => {
      f.binding.appId = 'gid://shopify/App/999';
    },
    (f: ReturnType<typeof fixture>) => {
      f.binding.shopId = 'gid://shopify/Shop/999';
    },
    (f: ReturnType<typeof fixture>) => {
      f.row = null;
    },
    (f: ReturnType<typeof fixture>) => {
      required(f.row).currentGeneration = '2';
    },
    (f: ReturnType<typeof fixture>) => {
      required(f.row).deactivatedAt = instant;
    },
    (f: ReturnType<typeof fixture>) => {
      required(f.row).shopId = 'foreign';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(createWorkerUsageSource(f.options).load(scope), { message: 'USAGE_SOURCE_UNAVAILABLE' });
    assert.equal(f.calls.length, 0);
  }
});
test('rejects invalid caller scope before accessing tenant or provider authority', async () => {
  const f = fixture();
  const loader = createWorkerUsageSource(f.options);
  for (const bad of [null, { ...scope, installationGeneration: '0' }, { ...scope, shopId: '' }]) {
    // @ts-expect-error Null is deliberately included to qualify the runtime scope decoder.
    await assert.rejects(loader.load(bad), { message: 'USAGE_SOURCE_UNAVAILABLE' });
  }
  assert.equal(f.reads, 0);
  assert.equal(f.calls.length, 0);
});
test('scope and nested policy are captured before asynchronous collaborators can modify them', async () => {
  const f = fixture(),
    caller = { ...scope };
  f.options.tenants.getUsageInstallationWindow = async (target) => {
    assert.deepEqual(target, scope);
    caller.shopId = 'foreign';
    f.binding.policy.id = 'changed';
    f.binding.shopId = 'gid://shopify/Shop/999';
    return structuredClone(f.row);
  };
  const result = await createWorkerUsageSource(f.options).load(caller);
  assert(result.binding);
  assert.equal(result.binding.policy.id, 'approved');
  assert(result.installation);
  assert.equal(result.installation.tenantShopId, 'tenant');
});
test('baseline drift during provider reads rejects the complete observation', async () => {
  for (const drift of [
    (f: ReturnType<typeof fixture>) => {
      required(f.row).currentGeneration = '2';
    },
    (f: ReturnType<typeof fixture>) => {
      required(f.row).activatedAt = instant;
    },
    (f: ReturnType<typeof fixture>) => {
      required(f.row).providerShopId = 'gid://shopify/Shop/999';
    },
  ]) {
    const f = fixture();
    f.mutate = () => drift(f);
    await assert.rejects(createWorkerUsageSource(f.options).load(scope), { message: 'USAGE_SOURCE_UNAVAILABLE' });
    assert.equal(f.calls.length, 2);
  }
});
test('provider failures expose no private detail, no partial source and no automatic retry', async () => {
  for (const at of [1, 2]) {
    const f = fixture();
    f.failure = at;
    await assert.rejects(createWorkerUsageSource(f.options).load(scope), { message: 'USAGE_SOURCE_UNAVAILABLE' });
    assert.equal(f.calls.length, at);
  }
});
test('bounded incomplete history remains unresolved through the real normalizer', async () => {
  const f = fixture();
  f.capped = true;
  const source = await createWorkerUsageSource(f.options).load(scope);
  assert.equal(f.calls.length, 5);
  assert.equal(source.range.pagination, 'PAGE_LIMIT');
  assert.deepEqual(normalizeCurrentCycleUsageHistory(source), {
    kind: 'UNRESOLVED',
    reason: 'INCOMPLETE_HISTORY',
    history: { kind: 'UNVERIFIED' },
  });
});

test('existing qualifier excludes a settled test purchase without invoking the composed source', async () => {
  const f = fixture(),
    purchaseId = 'test-purchase';
  const qualifier = createPurchaseUsageQualifier({
    ledger: {
      record: async () => ({ ...scope, purchaseId, decision: { kind: 'EXCLUDED', reason: 'TEST_ORDER', units: 0 } }),
    },
    loadCurrentCycleInput: createWorkerUsageSource(f.options).load,
  });
  const result = await qualifier.qualify(scope, { purchaseId });
  assert.equal(result.kind, 'RECORDED');
  assert.equal(f.reads, 0);
  assert.equal(f.calls.length, 0);
});

test('absent provider transport fails closed before installation reads even with a binding', async () => {
  const f = fixture();
  const source = createWorkerUsageSource({ ...f.options, transport: null });
  await assert.rejects(source.load(scope), /^Error: USAGE_SOURCE_UNAVAILABLE$/);
  assert.equal(f.reads, 0);
  assert.deepEqual(f.calls, []);
});
