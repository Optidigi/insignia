type BoundSubscription = ActiveSubscriptionSnapshot & { tenantShopId: string; installationGeneration: string };

import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { test } from 'node:test';
import type { EntitlementPolicyConfig } from '@insignia/application';
import type { ActiveSubscriptionSnapshot } from '@insignia/shopify';
import { build } from 'esbuild';
import { createMerchantBillingReader } from '../../src/server/admin/billing.ts';
import { adminActor, adminServices } from './support/fixtures.mts';

const at = new Date('2026-10-17T10:00:00Z');
const actor = adminActor({
  shop: 'example.myshopify.com',
  shopId: 'gid://shopify/Shop/1',
  tenantShopId: 'tenant',
  installationGeneration: '1',
});
const policy: EntitlementPolicyConfig = {
  policyVersion: 'lean',
  maxAgeMs: 300000,
  plans: [
    {
      billing: 'recurring-only',
      planHandle: 'standard',
      policyId: 'lean-standard',
      shopId: actor.shopId,
      features: ['configure'],
    },
  ],
};
function snapshot(extra: Partial<BoundSubscription> = {}): BoundSubscription {
  return {
    schemaVersion: 'm4-active-subscription-v1',
    sourceApiVersion: '2026-07',
    appId: 'gid://shopify/App/2',
    shopId: actor.shopId,
    tenantShopId: actor.tenantShopId,
    installationGeneration: '1',
    observedAt: at.toISOString(),
    active: true,
    billingPeriod: 'EVERY_30_DAYS',
    cancelAtEndOfCycle: false,
    trialEndsAt: '2026-10-31T08:54:46.000Z',
    currentBillingCycle: null,
    items: [
      {
        handle: 'standard',
        price: { kind: 'flat', providerTypename: 'FlatRatePrice', currency: 'USD', amount: '0.00', active: false },
        usage: null,
        discount: null,
      },
    ],
    pendingUpdate: null,
    ...extra,
  };
}
function reader(source: BoundSubscription, current: () => Promise<unknown> = async () => {}) {
  return createMerchantBillingReader({
    appId: 'gid://shopify/App/2',
    policy,
    now: () => at,
    current: async () => {
      await current();
    },
    read: async () => source,
  });
}
test('merchant sees authoritative trial and zero provider price separately from nominal Standard terms', async () => {
  const phases: string[] = [];
  const result = await reader(snapshot(), async () => phases.push('current'))(actor);
  assert.deepEqual(phases, ['current', 'current']);
  assert.equal(result.status, 'trial');
  assert.equal(result.trialEndsAt, '2026-10-31T08:54:46.000Z');
  assert.deepEqual(result.recurringPrice, { amount: '0.00', currency: 'USD' });
  assert.deepEqual(result.standardPrice, { amount: '49.99', currency: 'USD', intervalDays: 30 });
  assert.equal(result.newActionsAllowed, true);
  assert.equal(result.managementUrl, 'https://admin.shopify.com/store/example/charges/insignia-1/pricing_plans');
  assert.equal(JSON.stringify(result).includes('standard"'), false, 'provider plan handles are not exposed');
});
test('lifecycle display follows current provider boundaries without resetting trial or granting pending terms', async () => {
  const paid = snapshot({
    trialEndsAt: null,
    currentBillingCycle: { startTime: '2026-10-01T00:00:00.000Z', endTime: '2026-10-31T00:00:00.000Z' },
    cancelAtEndOfCycle: true,
    pendingUpdate: { billingPeriod: 'ANNUAL', itemHandles: ['unrecognized'] },
  });
  const result = await reader(paid)(actor);
  assert.equal(result.status, 'active');
  assert.equal(result.scheduledCancellation, true);
  assert.equal(result.pendingChange, true);
  assert.equal(result.newActionsAllowed, true);
  assert.deepEqual(result.currentCycle, paid.currentBillingCycle);
  for (const source of [
    snapshot({ observedAt: '2026-10-17T09:00:00.000Z' }),
    snapshot({ installationGeneration: '2' }),
    snapshot({ trialEndsAt: at.toISOString() }),
    snapshot({ items: [] }),
  ]) {
    const denied = await reader(source)(actor);
    assert.equal(denied.status, 'unavailable');
    assert.equal(denied.trialEndsAt, null);
    assert.equal(denied.recurringPrice, null);
    assert.equal(denied.newActionsAllowed, false);
  }
  const inactive = await reader(snapshot({ active: false, trialEndsAt: null, items: [], currentBillingCycle: null }))(
    actor,
  );
  assert.equal(inactive.status, 'inactive');
  assert.equal(inactive.newActionsAllowed, false);
});
test('installation change during provider observation rejects the entire display', async () => {
  let calls = 0;
  await assert.rejects(
    reader(snapshot(), async () => {
      if (++calls === 2) throw new Error('installation changed');
    })(actor),
    /installation changed/,
  );
});
test('zero recurring terms are development only for an explicitly shop-scoped recognized policy', async () => {
  const rewrite = { ...actor, shop: 'development-example.myshopify.com', shopId: 'gid://shopify/Shop/3' };
  const read = createMerchantBillingReader({
    appId: 'gid://shopify/App/2',
    policy: { ...policy, plans: policy.plans.map((plan) => ({ ...plan, shopId: rewrite.shopId })) },
    now: () => at,
    current: async () => {},
    read: async () => snapshot({ shopId: rewrite.shopId }),
  });
  const result = await read(rewrite);
  assert.equal(result.developmentTerms, true);
  assert.equal(
    result.managementUrl,
    'https://admin.shopify.com/store/development-example/charges/insignia-1/pricing_plans',
  );
  const generalPolicy = { ...policy, plans: policy.plans.map(({ shopId, ...plan }) => plan) };
  const general = createMerchantBillingReader({
    appId: 'gid://shopify/App/2',
    policy: generalPolicy,
    now: () => at,
    current: async () => {},
    read: async () => snapshot(),
  });
  assert.equal((await general(actor)).developmentTerms, false);
  assert.equal((await reader(snapshot())({ ...actor, shop: 'example.myshopify.com/evil' })).managementUrl, null);
});
test('normal production composition exposes the billing reader when existing provider policy is configured', async (t) => {
  const output = new URL('../../.astro/billing-production-composition.mjs', import.meta.url);
  await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
  t.after(() => rm(output, { force: true }));
  await build({
    entryPoints: [new URL('../../src/server/admin/production.ts', import.meta.url).pathname],
    outfile: output.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const { createProductionAdminServices } = await import(output.href);
  const services = createProductionAdminServices(
    {
      DATABASE_URL: 'postgresql://synthetic.invalid/db',
      SHOPIFY_CLIENT_ID: 'synthetic-client',
      SHOPIFY_CLIENT_SECRET: 'synthetic-secret',
      APP_URL: 'https://app.example',
      INSIGNIA_SHOPIFY_APP_ID: '2',
      INSIGNIA_PARTNER_ORGANIZATION_ID: '3',
      INSIGNIA_PARTNER_ACCESS_TOKEN: 'synthetic-partner',
      INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify(policy),
      INSIGNIA_M5_FEATURES_JSON: JSON.stringify({
        base: 'configure',
        required: 'configure',
        logoLater: 'configure',
        options: 'configure',
        pricing: 'configure',
      }),
    },
    {
      query: async () => {
        assert.fail('no database query during construction');
      },
    },
  );
  assert.equal(typeof services.billing, 'function');
});
test('the actual provider decoder feeds the authenticated billing response without exposing its raw financial identifiers', async () => {
  const { createActiveSubscriptionClient } = await import('@insignia/shopify');
  const { handleAdminRequest } = await import('../../src/server/admin/http.ts');
  let queries = 0;
  const provider = createActiveSubscriptionClient({
    now: () => at,
    transport: {
      query: async ({ query, variables }) => {
        queries++;
        assert.match(query, /^query ActiveSubscription/);
        assert.deepEqual(variables, { appId: 'gid://shopify/App/2', shopId: actor.shopId });
        return JSON.stringify({
          data: {
            activeSubscription: {
              app: { id: 'gid://shopify/App/2' },
              shop: { id: actor.shopId },
              billingPeriod: 'EVERY_30_DAYS',
              cancelAtEndOfCycle: false,
              trialEndsAt: '2026-10-31T08:54:46Z',
              currentBillingCycle: null,
              pendingUpdate: null,
              items: [
                {
                  handle: 'standard',
                  price: { __typename: 'FlatRatePrice', active: false, currency: 'USD', amount: '0.00' },
                  discount: null,
                  usage: null,
                },
              ],
            },
          },
        });
      },
    },
  });
  const billing = createMerchantBillingReader({
    appId: 'gid://shopify/App/2',
    policy,
    now: () => at,
    current: async () => {},
    read: async (current) => ({
      ...(await provider.read({ appId: 'gid://shopify/App/2', shopId: current.shopId })),
      tenantShopId: current.tenantShopId,
      installationGeneration: current.installationGeneration,
    }),
  });
  const response = await handleAdminRequest(
    new Request('https://app.example/api/admin/billing', { headers: { Authorization: 'Bearer synthetic' } }),
    adminServices({
      authenticate: async () => ({
        ...actor,
        staffId: 'staff',
        installationId: 'install',
        sessionId: 'session',
        expiresAtMs: Date.now() + 60000,
        canRead: true,
      }),
      billing,
    }),
    { kind: 'billing' },
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.status, 'trial');
  assert.equal(value.trialEndsAt, '2026-10-31T08:54:46.000Z');
  assert.deepEqual(value.recurringPrice, { amount: '0.00', currency: 'USD' });
  assert.equal(queries, 1);
  assert.equal('items' in value, false);
  assert.equal('shopId' in value, false);
});
