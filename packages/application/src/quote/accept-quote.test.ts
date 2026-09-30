import { describe, expect, it, vi } from 'vitest';
import { acceptQuote, localDay, normalizeMarketId, type QuoteAuthorityPorts } from './accept-quote.js';

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
      id: 'setup',
      scope: { kind: 'general' as const },
      role: 'setup' as const,
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
        qualifyingUsageDisposition: 'WAIVE_TRIAL' as const,
      })),
    },
    publication: { getEffective: vi.fn(async () => ({ config, configId: 'cfg', operationId: 'op' })) },
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
    fx: { resolve: vi.fn() },
    authorization: {
      admit: vi.fn(),
      issue: vi.fn(async ({ quote }) => ({
        setId: '22222222-2222-4222-8222-222222222222',
        keyId: 'key-1',
        publicKeyFingerprint: 'synthetic',
        firstValidDay: quote.acceptedDay,
        lastValidDay: quote.validThroughDay + 30,
        validThroughDay: quote.validThroughDay,
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

describe('acceptQuote', () => {
  it('uses civil dates across New York daylight-saving transitions', () => {
    expect(localDay(new Date('2026-03-08T06:30:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-03-08',
      ordinal: 20520,
    });
    expect(localDay(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-11-01',
      ordinal: 20758,
    });
    expect(localDay(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-11-01',
      ordinal: 20758,
    });
    expect(normalizeMarketId('gid://shopify/Market/42')).toBe('42');
    expect(() => normalizeMarketId('gid://shopify/Market/42/other')).toThrow();
    expect(() => normalizeMarketId('18446744073709551616')).toThrow();
  });

  it('accepts one complete subset using contextual money and a local three-day window', async () => {
    const { ports, saved } = fixture();
    const result = await acceptQuote(request, ports);
    expect(result.quote.economics.totalMinor).toBe('2001');
    expect(result.quote.economics.lines.map((line) => line.unitPriceMinor)).toEqual(['1001', '1000']);
    expect(result.quote.economics.groups[0]?.canonicalIdentitySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.quote.economics.lines[0]?.canonicalIdentitySha256).toBe(
      result.quote.economics.groups[0]?.canonicalIdentitySha256,
    );
    expect(JSON.stringify(result.quote.economics)).not.toContain('canonicalIdentity"');
    expect(result.quote.acceptedDate).toBe('2026-11-01');
    expect(result.quote.validThroughDay - result.quote.acceptedDay).toBe(2);
    expect(result.quote.marketId).toBe('42');
    expect(saved).toHaveLength(1);
    expect(ports.fx.resolve).not.toHaveBeenCalled();
  });

  it('replays a completed set without new provider reads or signing', async () => {
    const { ports } = fixture();
    const first = await acceptQuote(request, ports);
    vi.mocked(ports.store.findCompleted).mockResolvedValueOnce(first);
    vi.mocked(ports.entitlement.getFresh).mockRejectedValueOnce(new Error('provider unavailable'));
    const again = await acceptQuote(request, ports);
    expect(again).toEqual(first);
    expect(ports.entitlement.getFresh).toHaveBeenCalledTimes(2);
    expect(ports.authorization.issue).toHaveBeenCalledTimes(1);
  });

  it('rechecks tenant and entitlement after contextual provider reads, before issuing', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.tenant.getActive)
      .mockResolvedValueOnce(await ports.tenant.getActive('shop', '1'))
      .mockResolvedValueOnce(null);
    await expect(acceptQuote(request, ports)).rejects.toThrow(/inactive tenant/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('stops when entitlement becomes stale after provider reads', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.entitlement.getFresh)
      .mockResolvedValueOnce({
        active: true,
        freshness: 'fresh',
        recognizedPolicyId: 'synthetic',
        policyVersion: 'test',
        trial: true,
        qualifyingUsageDisposition: 'WAIVE_TRIAL',
      })
      .mockResolvedValueOnce({
        active: true,
        freshness: 'stale',
        recognizedPolicyId: 'synthetic',
        policyVersion: 'test',
        trial: true,
        qualifyingUsageDisposition: 'WAIVE_TRIAL',
      });
    await expect(acceptQuote(request, ports)).rejects.toThrow(/fresh recognized entitlement/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('does not sign contextual prices that expire while waiting for the persistence fence', async () => {
    const { ports } = fixture();
    let current = now;
    ports.clock = () => current;
    ports.store.accept = async (_input, commit) => {
      current = new Date('2026-11-01T05:35:00.000Z');
      return commit();
    };
    await expect(acceptQuote(request, ports)).rejects.toThrow(/Catalog context unavailable: stale/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
  });

  it('fails closed without an effective publication', async () => {
    const { ports } = fixture();
    vi.mocked(ports.publication.getEffective).mockResolvedValueOnce(null);
    await expect(acceptQuote(request, ports)).rejects.toThrow(/effective published revision/);
    expect(ports.catalog.resolveVariantContext).not.toHaveBeenCalled();
    expect(ports.authorization.issue).not.toHaveBeenCalled();
  });

  it('rejects a shop context from another installation', async () => {
    const { ports } = fixture();
    vi.mocked(ports.shop.getContext).mockResolvedValueOnce({
      shopId: 'shop',
      installationGeneration: '2',
      shopifyShopGid: 'gid://shopify/Shop/7',
      currency: 'USD',
      timezone: 'America/New_York',
    });
    await expect(acceptQuote(request, ports)).rejects.toThrow(/shop context identity/);
    expect(ports.catalog.resolveVariantContext).not.toHaveBeenCalled();
  });

  it('rejects a paid selling plan before provider reads', async () => {
    const { ports } = fixture();
    await expect(acceptQuote({ ...request, groups: [{ group, sellingPlanId: 'plan' }] }, ports)).rejects.toThrow(
      /selling plan/,
    );
    expect(ports.tenant.getActive).not.toHaveBeenCalled();
  });

  it('bounds untrusted subsets before provider reads and stores only normalized physical groups', async () => {
    const { ports } = fixture();
    await expect(acceptQuote({ ...request, groups: Array(33).fill({ group }) }, ports)).rejects.toThrow(
      /capacity exceeded before provider reads/,
    );
    expect(ports.tenant.getActive).not.toHaveBeenCalled();
    await expect(acceptQuote({ ...request, groups: [{ group, sellingPlanId: '' }] }, ports)).rejects.toThrow(
      /selling plan/,
    );
    expect(ports.tenant.getActive).not.toHaveBeenCalled();
    const withIgnoredPayload = {
      ...group,
      ignoredBuyerPayload: 'PII-SENTINEL-DO-NOT-PERSIST',
      design: { ...group.design, ignoredBuyerPayload: 'PII-SENTINEL-DO-NOT-PERSIST' },
    };
    const accepted = await acceptQuote({ ...request, groups: [{ group: withIgnoredPayload }] }, ports);
    expect(accepted.quote.physicalGroups).toEqual([
      expect.objectContaining({ productId: 'product', variants: [{ variantId: 'variant', quantity: 2 }] }),
    ]);
    expect(JSON.stringify(accepted.quote)).not.toContain('PII-SENTINEL-DO-NOT-PERSIST');
    expect('desiredGroups' in accepted.quote).toBe(false);
  });

  it('fails closed without a configured FX rate for cross-currency customization', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.catalog.resolveVariantContext).mockResolvedValueOnce([
      {
        shopId: 'shop',
        installationGeneration: '1',
        productId: 'product',
        variantId: 'variant',
        productIdVerified: true,
        context: { country: 'US' },
        amount: '10.00',
        currencyCode: 'EUR',
        sourceApiVersion: '2026-07',
        observedAt: '2026-11-01T05:29:00.000Z',
        freshUntil: '2026-11-01T05:34:00.000Z',
        correlation: { requestId: 'synthetic' },
      },
    ]);
    await expect(acceptQuote(request, ports)).rejects.toThrow(/FX unavailable: missing/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('uses a presentment override without fetching FX', async () => {
    const { ports } = fixture();
    const setupRule = config.pricingRules[0];
    if (!setupRule) throw new Error('synthetic setup rule missing');
    vi.mocked(ports.publication.getEffective).mockResolvedValueOnce({
      config: {
        ...config,
        pricingRules: [
          {
            ...setupRule,
            rate: {
              kind: 'fixed',
              amount: { shopDecimal: '0.01', presentmentOverrides: [{ currency: 'EUR', decimal: '0.02' }] },
            },
          },
        ],
      },
      configId: 'cfg',
      operationId: 'op',
    });
    vi.mocked(ports.catalog.resolveVariantContext).mockResolvedValueOnce([
      {
        shopId: 'shop',
        installationGeneration: '1',
        productId: 'product',
        variantId: 'variant',
        productIdVerified: true,
        context: { country: 'US' },
        amount: '10.00',
        currencyCode: 'EUR',
        sourceApiVersion: '2026-07',
        observedAt: '2026-11-01T05:29:00.000Z',
        freshUntil: '2026-11-01T05:34:00.000Z',
        correlation: { requestId: 'synthetic' },
      },
    ]);
    const result = await acceptQuote(request, ports);
    expect(result.quote.economics.totalMinor).toBe('2002');
    expect(result.quote.fxSnapshot).toBeNull();
    expect(ports.fx.resolve).not.toHaveBeenCalled();
  });

  it('freezes a fresh exact FX snapshot when an applicable component requires conversion', async () => {
    const { ports } = fixture();
    vi.mocked(ports.catalog.resolveVariantContext).mockResolvedValueOnce([
      {
        shopId: 'shop',
        installationGeneration: '1',
        productId: 'product',
        variantId: 'variant',
        productIdVerified: true,
        context: { country: 'US' },
        amount: '10.00',
        currencyCode: 'EUR',
        sourceApiVersion: '2026-07',
        observedAt: '2026-11-01T05:29:00.000Z',
        freshUntil: '2026-11-01T05:34:00.000Z',
        correlation: { requestId: 'synthetic' },
      },
    ]);
    vi.mocked(ports.fx.resolve).mockResolvedValueOnce({
      version: 'm4-customization-fx-v1',
      shopId: 'shop',
      installationGeneration: '1',
      shopCurrency: 'USD',
      presentmentCurrency: 'EUR',
      rateDecimal: '2',
      source: 'synthetic',
      sourceVersion: '1',
      provenance: 'fixture',
      observedAt: '2026-11-01T05:29:00.000Z',
      effectiveAt: '2026-11-01T05:29:00.000Z',
      expiresAt: '2026-11-01T05:34:00.000Z',
    });
    const result = await acceptQuote(request, ports);
    expect(result.quote.economics.totalMinor).toBe('2002');
    expect(result.quote.fxSnapshot?.provenance).toBe('fixture');
  });

  it('rejects two provider currencies across products before authorization', async () => {
    const { ports } = fixture();
    const second = {
      ...group,
      productId: 'product2',
      configRevisionId: 'revision2',
      variants: [{ variantId: 'variant2', quantity: 1 }],
    };
    vi.mocked(ports.publication.getEffective).mockImplementation(async (_shop, product) =>
      product === 'product2'
        ? {
            config: { ...config, productId: 'product2', revisionId: 'revision2' },
            configId: 'cfg2',
            operationId: 'op2',
          }
        : { config, configId: 'cfg', operationId: 'op' },
    );
    vi.mocked(ports.catalog.resolveVariantContext).mockImplementation(async (input) => {
      const variantId = input.variantIds[0];
      if (!variantId) throw new Error('synthetic variant missing');
      return [
        {
          shopId: 'shop',
          installationGeneration: '1',
          productId: input.productId,
          variantId,
          productIdVerified: true,
          context: { country: 'US' },
          amount: '10.00',
          currencyCode: input.productId === 'product2' ? 'EUR' : 'USD',
          sourceApiVersion: '2026-07',
          observedAt: '2026-11-01T05:29:00.000Z',
          freshUntil: '2026-11-01T05:34:00.000Z',
          correlation: { requestId: 'synthetic' },
        },
      ];
    });
    await expect(acceptQuote({ ...request, groups: [...request.groups, { group: second }] }, ports)).rejects.toThrow(
      /mixed presentment currency/,
    );
    expect(ports.authorization.issue).not.toHaveBeenCalled();
  });

  it('rejects incomplete member issuance without persisting a partial set', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.authorization.issue).mockImplementationOnce(async ({ quote }) => ({
      setId: '22222222-2222-4222-8222-222222222222',
      keyId: 'key-1',
      publicKeyFingerprint: 'synthetic',
      firstValidDay: quote.acceptedDay,
      lastValidDay: quote.validThroughDay,
      validThroughDay: quote.validThroughDay,
      envelopeCarrier: 'envelope',
      members: [{ lineIndex: 0, carrier: 'only-one' }],
    }));
    await expect(acceptQuote(request, ports)).rejects.toThrow(/incomplete or invalid/);
    expect(saved).toHaveLength(0);
  });

  it('rejects a signer key that does not cover D through D+2', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.authorization.issue).mockImplementationOnce(async ({ quote }) => ({
      setId: '22222222-2222-4222-8222-222222222222',
      keyId: 'key-1',
      publicKeyFingerprint: 'synthetic',
      firstValidDay: quote.acceptedDay,
      lastValidDay: quote.validThroughDay - 1,
      validThroughDay: quote.validThroughDay,
      envelopeCarrier: 'envelope',
      members: quote.economics.lines.map((line) => ({ lineIndex: line.lineIndex, carrier: 'member' })),
    }));
    await expect(acceptQuote(request, ports)).rejects.toThrow(/incomplete or invalid/);
    expect(saved).toHaveLength(0);
  });

  it('enforces customized quantity and relevant-line candidate bounds before signing', async () => {
    const { ports } = fixture();
    await expect(
      acceptQuote({ ...request, capacity: { ordinaryLineCount: 199, inputBytes: 100 } }, ports),
    ).rejects.toThrow(/candidate capacity/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    await expect(
      acceptQuote(
        { ...request, groups: [{ group: { ...group, variants: [{ variantId: 'variant', quantity: 10001 }] } }] },
        ports,
      ),
    ).rejects.toThrow(/candidate capacity/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
  });

  it('bounds nested buyer JSON and Market text before provider reads', async () => {
    const { ports } = fixture();
    await expect(acceptQuote({ ...request, marketId: '9'.repeat(256) }, ports)).rejects.toThrow(
      /invalid desired Market ID/,
    );
    await expect(
      acceptQuote(
        {
          ...request,
          groups: [{ group: { ...group, design: { ...group.design, ignoredArtwork: 'x'.repeat(128_001) } } }],
        },
        ports,
      ),
    ).rejects.toThrow(/candidate request bytes exceeded/);
    let nested: unknown = 'bottom';
    for (let depth = 0; depth < 20; depth++) nested = { next: nested };
    await expect(
      acceptQuote(
        { ...request, groups: [{ group: { ...group, design: { ...group.design, ignoredArtwork: nested } } }] },
        ports,
      ),
    ).rejects.toThrow(/candidate request complexity exceeded/);
    expect(ports.tenant.getActive).not.toHaveBeenCalled();
  });
});
