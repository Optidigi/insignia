import { describe, expect, it, vi } from 'vitest';
import { acceptQuote, type QuoteAuthorityPorts } from './accept-quote.js';
import { type QuoteRenewalPorts, renewQuote } from './renew-quote.js';

const hash = 'a'.repeat(64);
const now = new Date('2026-11-01T05:30:00.000Z');
const config = {
  version: 'm2-published-config-v1' as const,
  shopId: 'shop',
  productId: 'product',
  revisionId: 'revision',
  revisionContentHash: hash,
  shopCurrency: 'USD',
  methods: [{ id: 'method' }],
  placements: [{ id: 'front', allowedMethodIds: ['method'], allowedStepIds: ['step'], logoLaterAllowed: false }],
  productionOptions: [],
  pricingRules: [
    {
      id: 'final-price',
      scope: { kind: 'step' as const, placementId: 'front', stepId: 'step', methodId: 'method' },
      role: 'unit' as const,
      rate: { kind: 'fixed' as const, amount: { shopDecimal: '0.01', presentmentOverrides: [] } },
    },
  ],
};
const group = {
  version: 'm2-customization-group-v1' as const,
  shopId: 'shop',
  productId: 'product',
  configRevisionId: 'revision',
  revisionContentHash: hash,
  design: {
    placements: [
      {
        placementId: 'front',
        methodId: 'method',
        stepId: 'step',
        artwork: { kind: 'revision' as const, revisionId: 'art' },
      },
    ],
    options: [],
  },
  variants: [{ variantId: 'variant', quantity: 2 }],
};
const request = {
  shopId: 'shop',
  installationGeneration: '1',
  idempotencyKey: 'key',
  country: 'US',
  marketId: 'gid://shopify/Market/42',
  groups: [{ group, sellingPlanId: null }],
  capacity: { ordinaryLineCount: 0, inputBytes: 100 },
};

function fixture() {
  const saved: unknown[] = [];
  let issuedSets = 0;
  const ports: QuoteAuthorityPorts = {
    clock: () => now,
    tenant: {
      getActive: vi.fn(async () => ({
        shopId: 'shop',
        installationGeneration: '1',
        shopifyShopGid: 'gid://shopify/Shop/7',
        authorizationGeneration: '11111111-1111-4111-8111-111111111111',
        authorizationEpoch: 1,
      })),
    },
    shop: {
      getContext: vi.fn(async () => ({
        shopId: 'shop',
        installationGeneration: '1',
        shopifyShopGid: 'gid://shopify/Shop/7',
        currency: 'USD',
        timezone: 'America/New_York',
      })),
    },
    entitlement: {
      getFresh: vi.fn(async () => ({
        active: true,
        freshness: 'fresh' as const,
        recognizedPolicyId: 'synthetic',
        policyVersion: 'test',
        trial: true,
        qualifyingUsageDisposition: 'NOT_METERED' as const,
      })),
    },
    publication: { getEffective: vi.fn(async () => ({ config, configId: 'cfg', operationId: 'op' })) },
    artwork: {
      readUsability: vi.fn(async (input) =>
        input.choices.map((choice) => ({
          ...choice,
          shopId: input.shopId,
          installationGeneration: input.installationGeneration,
          status: 'usable' as const,
          lastFullyUsableLocalDay: 20760,
          observedAt: now.toISOString(),
        })),
      ),
    },
    catalog: {
      resolveVariantContext: vi.fn(async () => [
        {
          shopId: 'shop',
          installationGeneration: '1',
          productId: 'product',
          variantId: 'variant',
          productIdVerified: true as const,
          context: { country: 'US' },
          amount: '10.00',
          currencyCode: 'USD',
          sourceApiVersion: '2026-07',
          observedAt: '2026-11-01T05:29:00.000Z',
          freshUntil: '2026-11-01T05:34:00.000Z',
          correlation: { requestId: 'synthetic' },
        },
      ]),
    },
    currency: { exponent: () => 2 },
    leanContext: { assertSupported: vi.fn(async () => {}) },
    readiness: { assertReady: vi.fn(async () => {}) },
    authorization: {
      admit: vi.fn(),
      issue: vi.fn(async ({ quote, window }) => ({
        setId: `${(++issuedSets).toString().padStart(8, '0')}-2222-4222-8222-222222222222`,
        keyId: 7,
        publicKeyFingerprint: 'synthetic',
        firstValidDay: window?.issuedDay ?? quote.acceptedDay,
        lastValidDay: (window?.validThroughDay ?? quote.validThroughDay) + 30,
        validThroughDay: window?.validThroughDay ?? quote.validThroughDay,
        envelopeCarrier: 'envelope',
        members: quote.economics.lines.map((line: { lineIndex: number }) => ({
          lineIndex: line.lineIndex,
          carrier: `member${line.lineIndex}`,
        })),
      })),
    },
    store: {
      findCompleted: vi.fn(async () => null),
      accept: vi.fn(async (_input, commit) => {
        const value = await commit();
        saved.push(value);
        return value;
      }),
    },
    ids: { quoteId: () => '33333333-3333-4333-8333-333333333333' },
  };
  return { ports, saved };
}

async function renewalFixture() {
  const { ports } = fixture();
  ports.artwork.replayBinding = () => 'b'.repeat(64);
  const accepted = await acceptQuote(request, ports);
  const original = structuredClone(accepted.quote);
  const later = new Date(+now + 3 * 86400000);
  ports.clock = () => later;
  vi.mocked(ports.catalog.resolveVariantContext).mockImplementation(async () =>
    original.catalogSnapshots.map((row) => ({
      ...row,
      observedAt: later.toISOString(),
      freshUntil: new Date(+later + 300000).toISOString(),
    })),
  );
  vi.mocked(ports.artwork.readUsability).mockImplementation(async (input) =>
    input.choices.map((choice) => ({
      ...choice,
      shopId: input.shopId,
      installationGeneration: input.installationGeneration,
      status: 'usable',
      lastFullyUsableLocalDay: 20770,
      observedAt: later.toISOString(),
    })),
  );
  const renewalStore = {
    getOwned: vi.fn(async () => original),
    findCompleted: vi.fn(async () => null),
    renew: vi.fn(async (_input, commit) => commit()),
  };
  return {
    ports,
    original,
    renewalStore,
    later,
    initialSetId: accepted.authorization.setId,
  };
}
describe('immutable quote renewal', () => {
  it('rejects renewal after entitlement changes to a usage contract', async () => {
    const { ports, original, renewalStore } = await renewalFixture();
    const tenant = await ports.tenant.getActive('shop', '1');
    if (!tenant) throw new Error('fixture tenant missing');
    const entitlement = await ports.entitlement.getFresh(tenant);
    vi.mocked(ports.entitlement.getFresh).mockResolvedValue({
      ...entitlement,
      qualifyingUsageDisposition: 'REQUIRES_EVENT_TIME',
    });
    vi.mocked(ports.authorization.issue).mockClear();
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: request }, {
        ...ports,
        renewalStore,
      } as QuoteRenewalPorts),
    ).rejects.toThrow(/recurring-only entitlement required/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(renewalStore.renew).not.toHaveBeenCalled();
  });

  it('rejects a renewal when contextual currency differs from shop currency', async () => {
    const { ports, original, renewalStore, later } = await renewalFixture();
    vi.mocked(ports.authorization.issue).mockClear();
    vi.mocked(ports.catalog.resolveVariantContext).mockResolvedValue(
      original.catalogSnapshots.map((row) => ({
        ...row,
        currencyCode: 'EUR',
        observedAt: later.toISOString(),
        freshUntil: new Date(+later + 300000).toISOString(),
      })),
    );
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: request }, { ...ports, renewalStore } as QuoteRenewalPorts),
    ).rejects.toThrow(/Lean|lean|currency/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(renewalStore.renew).not.toHaveBeenCalled();
  });

  it('issues a new window for unchanged facts without changing original acceptance', async () => {
    const { ports, original, renewalStore, later } = await renewalFixture();
    const result = await renewQuote({ quoteId: original.quoteId, desired: { ...request, idempotencyKey: 'renew' } }, {
      ...ports,
      renewalStore,
    } as QuoteRenewalPorts);
    expect(result.quote).toEqual(original);
    expect(result.authorization.validThroughDay).toBe(original.validThroughDay + 3);
    expect(result.issuance.issuedDay).toBe(original.acceptedDay + 3);
    expect(ports.authorization.issue).toHaveBeenLastCalledWith({ quote: original, window: result.issuance });
    vi.mocked(ports.catalog.resolveVariantContext).mockImplementation(async () =>
      original.catalogSnapshots.map((row) => ({
        ...row,
        amount: '11.00',
        observedAt: later.toISOString(),
        freshUntil: new Date(+later + 300000).toISOString(),
      })),
    );
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: { ...request, idempotencyKey: 'changed' } }, {
        ...ports,
        renewalStore,
      } as QuoteRenewalPorts),
    ).rejects.toThrow('REVIEW_REQUIRED');
  });
  it('checks changed facts again inside serialized signing and denies foreign ownership', async () => {
    const { ports, original, renewalStore } = await renewalFixture();
    vi.mocked(ports.authorization.issue).mockClear();
    renewalStore.renew.mockImplementation(async (_input, commit) => {
      vi.mocked(ports.shop.getContext).mockImplementation(async (tenant) => ({
        ...tenant,
        currency: 'USD',
        timezone: 'Europe/Amsterdam',
      }));
      return commit();
    });
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: { ...request, idempotencyKey: 'race' } }, {
        ...ports,
        renewalStore,
      } as QuoteRenewalPorts),
    ).rejects.toThrow('REVIEW_REQUIRED');
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    renewalStore.getOwned.mockResolvedValue(null as never);
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: request }, { ...ports, renewalStore } as QuoteRenewalPorts),
    ).rejects.toThrow('ownership');
  });

  it('returns the exact completed renewal without new issuance or repricing', async () => {
    const { ports, original, renewalStore } = await renewalFixture();
    const result = await renewQuote({ quoteId: original.quoteId, desired: { ...request, idempotencyKey: 'cached' } }, {
      ...ports,
      renewalStore,
    } as QuoteRenewalPorts);
    renewalStore.findCompleted.mockResolvedValue(result as never);
    vi.mocked(ports.authorization.issue).mockClear();
    vi.mocked(ports.entitlement.getFresh).mockClear();
    expect(
      await renewQuote({ quoteId: original.quoteId, desired: { ...request, idempotencyKey: 'cached' } }, {
        ...ports,
        renewalStore,
      } as QuoteRenewalPorts),
    ).toEqual(result);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(ports.entitlement.getFresh).not.toHaveBeenCalled();
  });
  it('bounds hostile request complexity before any tenant or quote lookup', async () => {
    const { ports, original, renewalStore } = await renewalFixture();
    vi.mocked(ports.tenant.getActive).mockClear();
    await expect(
      renewQuote({ quoteId: original.quoteId, desired: { ...request, groups: Array(4097).fill(null) } }, {
        ...ports,
        renewalStore,
      } as QuoteRenewalPorts),
    ).rejects.toThrow('invalid renewal request');
    expect(ports.tenant.getActive).not.toHaveBeenCalled();
    expect(renewalStore.getOwned).not.toHaveBeenCalled();
  });
});
