import type { ExpectedFunctionBuild, VerifiedOrder } from '@insignia/application';
import { describe, expect, it, vi } from 'vitest';
import { createShopifyCheckoutPurchaseAdmission } from '../../src/orders/checkout-admission.js';

const now = new Date('2026-10-13T12:00:00.000Z');
const scope = { shopId: 'tenant', installationGeneration: '1', appClientId: 'owned-client' };
function fixture() {
  const identity = (surface: 'transform' | 'validation') => ({
    functionId: `function-${surface}`,
    handle: `insignia-experimental-v2-${surface}`,
    apiType: surface === 'transform' ? ('cart_transform' as const) : ('cart_checkout_validation' as const),
    apiVersion: '2026-07',
    inputQuerySha256: (surface === 'transform' ? 'a' : 'b').repeat(64),
    wasmSha256: (surface === 'transform' ? 'c' : 'd').repeat(64),
  });
  const expectedBuild: ExpectedFunctionBuild = {
    ...scope,
    schemaVersion: 2,
    sourceCommit: '1'.repeat(40),
    appVersionRef: 'active-reviewed',
    devPreviewRef: null,
    transform: identity('transform'),
    validation: identity('validation'),
    targetModules: {
      transform: { moduleId: 'module-transform', target: 'cart.transform.run', export: 'cart_transform_run' },
      validation: {
        moduleId: 'module-validation',
        target: 'cart.validations.generate.run',
        export: 'cart_validations_generate_run',
      },
    },
  };
  const attestation = {
    ...structuredClone(expectedBuild),
    evidenceKind: 'RELEASE_BOUND',
    observedAt: now.toISOString(),
    targetObservedAt: now.toISOString(),
    expiresAt: '2026-10-13T12:00:30.000Z',
  };
  const provider = {
    shop: { id: 'gid://shopify/Shop/101' },
    shopifyFunctions: {
      nodes: [expectedBuild.transform, expectedBuild.validation].map((item) => ({
        id: item.functionId,
        handle: item.handle,
        appKey: scope.appClientId,
        apiVersion: item.apiVersion,
        apiType: item.apiType,
        inputQuery: null,
      })),
      pageInfo: { hasNextPage: false },
    },
    cartTransforms: {
      nodes: [{ id: 'transform-instance', functionId: expectedBuild.transform.functionId, blockOnFailure: true }],
      pageInfo: { hasNextPage: false },
    },
    validations: {
      nodes: [
        {
          id: 'validation-instance',
          enabled: true,
          blockOnFailure: true,
          shopifyFunction: {
            id: expectedBuild.validation.functionId,
            handle: expectedBuild.validation.handle,
            appKey: scope.appClientId,
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
  const active = {
    shopId: scope.shopId,
    installationGeneration: '1',
    shopDomain: 'owned.myshopify.com',
    shopifyShopId: '101',
  };
  const config = {
    appId: '123',
    appClientId: scope.appClientId,
    origin: {
      shopId: scope.shopId,
      installationGeneration: '1',
      creatorAppId: 'gid://shopify/App/77',
      supportedFrom: '2026-10-13T11:00:00.000Z',
    },
    tenants: { getActiveProviderScope: vi.fn(async () => active) },
    credentials: {
      acquire: vi.fn(async () => ({
        kind: 'usable' as const,
        shopDomain: active.shopDomain,
        accessToken: 'synthetic-admission-token',
        accessExpiresAt: new Date(+now + 60_000),
      })),
    },
    release: { read: vi.fn(async () => ({ expectedBuild, attestation })) },
    clock: () => now,
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: provider }))),
  };
  const order = {
    ...scope,
    orderId: 'gid://shopify/Order/900',
    createdAt: '2026-10-13T11:30:00.000Z',
    observedAt: now.toISOString(),
    checkoutOrigin: {
      creatorAppId: config.origin.creatorAppId,
      sourceName: 'web',
      checkoutTokenDigest: 'e'.repeat(64),
    },
    country: null,
    marketId: null,
    contextVerified: false,
  } as unknown as VerifiedOrder;
  return { config, order, expectedBuild, attestation, provider, active };
}

describe('current checkout purchase admission', () => {
  it.each(['unqualified', 'foreign_creator', 'other_channel', 'prequalification', 'stale_order'])(
    'rejects %s orders without provider access',
    async (caseName) => {
      const { config, order } = fixture();
      if (caseName === 'unqualified') config.origin = null as unknown as typeof config.origin;
      if (caseName === 'foreign_creator' && order.checkoutOrigin)
        order.checkoutOrigin.creatorAppId = 'gid://shopify/App/88';
      if (caseName === 'other_channel' && order.checkoutOrigin) order.checkoutOrigin.sourceName = 'pos';
      if (caseName === 'prequalification') order.createdAt = '2026-10-13T10:59:59.000Z';
      if (caseName === 'stale_order') order.observedAt = '2026-10-13T11:59:29.000Z';
      expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toBeNull();
      expect(config.release.read).not.toHaveBeenCalled();
      expect(config.fetchImpl).not.toHaveBeenCalled();
    },
  );
  it.each(['disabled', 'nonblocking', 'foreign_function', 'wrong_shop', 'incomplete', 'http_failure'])(
    'rejects %s current provider evidence without retry',
    async (caseName) => {
      const { config, order, provider } = fixture();
      if (caseName === 'disabled' && provider.validations.nodes[0]) provider.validations.nodes[0].enabled = false;
      if (caseName === 'nonblocking' && provider.cartTransforms.nodes[0])
        provider.cartTransforms.nodes[0].blockOnFailure = false;
      if (caseName === 'foreign_function' && provider.shopifyFunctions.nodes[0])
        provider.shopifyFunctions.nodes[0].appKey = 'foreign-client';
      if (caseName === 'wrong_shop') provider.shop.id = 'gid://shopify/Shop/202';
      if (caseName === 'incomplete') provider.shopifyFunctions.pageInfo.hasNextPage = true;
      if (caseName === 'http_failure')
        config.fetchImpl.mockImplementation(async () => new Response('', { status: 503 }));
      expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toBeNull();
      expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['artifact_drift', 'scope_drift', 'expired', 'slow_read'])(
    'rejects %s trusted release evidence',
    async (caseName) => {
      const { config, order, attestation } = fixture();
      if (caseName === 'artifact_drift') attestation.transform.wasmSha256 = 'f'.repeat(64);
      if (caseName === 'scope_drift') attestation.installationGeneration = '2';
      if (caseName === 'expired') attestation.expiresAt = now.toISOString();
      if (caseName === 'slow_read') {
        let reads = 0;
        config.clock = () => new Date(+now + (reads++ === 0 ? 0 : 31_000));
      }
      expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toBeNull();
    },
  );
  it('rejects an installation that changes during the authenticated provider read', async () => {
    const { config, order, active, provider } = fixture();
    config.fetchImpl.mockImplementation(async () => {
      active.installationGeneration = '2';
      return new Response(JSON.stringify({ data: provider }));
    });
    expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toBeNull();
  });
  it('rejects credentials for a different destination before sending a request', async () => {
    const { config, order } = fixture();
    config.credentials.acquire.mockImplementation(async () => ({
      kind: 'usable',
      shopDomain: 'different.myshopify.com',
      accessToken: 'synthetic-admission-token',
      accessExpiresAt: new Date(+now + 60_000),
    }));
    expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toBeNull();
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });
  it('admits a scoped qualified origin using current authenticated Function objects and independent release evidence', async () => {
    const { config, order } = fixture();
    expect(await createShopifyCheckoutPurchaseAdmission(config).admit({ order })).toEqual({
      creatorAppId: 'gid://shopify/App/77',
      enforcementObservedAt: now.toISOString(),
    });
    const [url, init] = config.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://owned.myshopify.com/admin/api/2026-07/graphql.json');
    expect(JSON.parse(init.body as string).query).toMatch(/query InsigniaOwnedFunctions/);
    expect(config.release.read).toHaveBeenCalledWith({ scope, now });
  });
});
