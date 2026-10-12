import { describe, expect, it, vi } from 'vitest';
import { createArtworkUsabilityPort } from '../artwork/artwork.js';
import { acceptQuote, localDay, normalizeMarketId, prepareQuote, type QuoteAuthorityPorts } from './accept-quote.js';

import { materialHash } from './material.js';

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
    fx: { resolve: vi.fn() },
    readiness: { assertReady: vi.fn(async () => {}) },
    authorization: {
      admit: vi.fn(),
      issue: vi.fn(async ({ quote }) => ({
        setId: '22222222-2222-4222-8222-222222222222',
        keyId: 7,
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
  it('material comparison ignores refreshed evidence but detects changed allocation at the same total', async () => {
    const { ports } = fixture();
    const original = (await prepareQuote(request, ports)).quote;
    const refreshed = structuredClone(original);
    refreshed.quoteId = '44444444-4444-4444-8444-444444444444';
    refreshed.acceptedAt = '2026-11-02T05:30:00.000Z';
    refreshed.acceptedDate = '2026-11-02';
    refreshed.acceptedDay++;
    refreshed.validThroughDay++;
    refreshed.economics = {
      ...refreshed.economics,
      effectiveAt: refreshed.acceptedAt,
      groups: refreshed.economics.groups.map((entry) => ({
        ...entry,
        variants: entry.variants.map((variant) => ({ ...variant, contextId: 'new-observation' })),
      })),
    };
    refreshed.catalogSnapshots = refreshed.catalogSnapshots.map((entry) => ({
      ...entry,
      observedAt: refreshed.acceptedAt,
      freshUntil: '2026-11-02T05:35:00.000Z',
      correlation: { requestId: 'new' },
    }));
    refreshed.artworkChecks = refreshed.artworkChecks.map((entry) => ({ ...entry, observedAt: refreshed.acceptedAt }));
    refreshed.effectiveRevisions = refreshed.effectiveRevisions.map((entry) => ({
      ...entry,
      operationId: 'new-operation',
    }));
    expect(materialHash(refreshed)).toBe(materialHash(original));
    const changed = structuredClone(refreshed);
    changed.economics = {
      ...changed.economics,
      lines: changed.economics.lines.map((line, index) => ({
        ...line,
        unitPriceMinor: index === 0 ? '999' : '1002',
        lineTotalMinor: index === 0 ? '999' : '1002',
      })),
    };
    expect(changed.economics.totalMinor).toBe(original.economics.totalMinor);
    expect(materialHash(changed)).not.toBe(materialHash(original));
    expect(materialHash({ ...refreshed, shopTimezone: 'Europe/Amsterdam' })).not.toBe(materialHash(original));
  });

  it('prepares authoritative pricing without issuing or persisting an accepted offer', async () => {
    const { ports, saved } = fixture();
    const candidate = await prepareQuote(request, ports);
    expect(candidate.quote.economics.totalMinor).toBe('2001');
    expect(candidate.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.quote.artworkChecks).toHaveLength(1);
    expect(ports.readiness.assertReady).toHaveBeenCalledWith({ quote: candidate.quote });
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(ports.store.accept).not.toHaveBeenCalled();
    expect(ports.store.findCompleted).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('cached authorization and transactional replay remain bound to verified artwork owner authority', async () => {
    const { ports } = fixture();
    const scope = { shopId: 'shop', installationGeneration: '1', kind: 'guest' as const, ownerHash: 'a'.repeat(64) };
    const row = {
      assetId: 'art',
      ownerHash: scope.ownerHash,
      state: 'USABLE',
      manifest: {},
      expiresAt: new Date(+now + 7 * 86400000),
    };
    const store = { readUsability: async () => [row] } as never;
    ports.artwork = createArtworkUsabilityPort(store, () => now, scope);
    let cached: Awaited<ReturnType<typeof acceptQuote>> | undefined,
      digest = '';
    vi.mocked(ports.store.accept).mockImplementation(async (input, commit) => {
      if (cached) {
        if (input.requestDigest !== digest) throw new Error('idempotency digest conflict');
        return cached;
      }
      digest = input.requestDigest;
      cached = await commit();
      return cached;
    });
    vi.mocked(ports.store.findCompleted).mockImplementation(async (input) => {
      if (!cached) return null;
      if (input.requestDigest !== digest) throw new Error('idempotency digest conflict');
      return cached;
    });
    const first = await acceptQuote(request, ports);
    expect(await acceptQuote(request, ports)).toEqual(first);
    ports.artwork = createArtworkUsabilityPort(store, () => now, { ...scope, ownerHash: 'b'.repeat(64) });
    await expect(acceptQuote(request, ports)).rejects.toThrow('idempotency digest conflict');
    ports.artwork = createArtworkUsabilityPort(store, () => now, { ...scope, kind: 'merchant' });
    vi.mocked(ports.store.findCompleted).mockResolvedValueOnce(null);
    await expect(acceptQuote(request, ports)).rejects.toThrow('idempotency digest conflict');
    ports.artwork = createArtworkUsabilityPort(store, () => now);
    const reads = vi.mocked(ports.store.findCompleted).mock.calls.length;
    await expect(acceptQuote(request, ports)).rejects.toThrow();
    expect(ports.store.findCompleted).toHaveBeenCalledTimes(reads);
  });

  it('validates actual artwork observations against a post-read clock without changing quote expiry', async () => {
    const { ports } = fixture();
    let tick = +now;
    const clock = () => new Date(tick++);
    ports.clock = clock;
    ports.artwork = createArtworkUsabilityPort(
      {
        readUsability: async () => [
          { assetId: 'art', state: 'USABLE', manifest: {}, expiresAt: new Date(+now + 7 * 86400000) },
        ],
      } as never,
      clock,
      { shopId: 'shop', installationGeneration: '1', kind: 'merchant' },
    );
    const accepted = await acceptQuote(request, ports);
    expect(accepted.quote.artworkChecks[0]?.observedAt).not.toBe(accepted.quote.acceptedAt);
    expect(accepted.quote.validThroughDay).toBe(20760);
  });

  it('post-read freshness still rejects future and stale artwork observations before signing', async () => {
    for (const observedAt of [new Date(+now + 1).toISOString(), new Date(+now - 300001).toISOString()]) {
      const { ports } = fixture();
      vi.mocked(ports.artwork.readUsability).mockImplementation(async (input) =>
        input.choices.map((choice) => ({
          ...choice,
          shopId: input.shopId,
          installationGeneration: input.installationGeneration,
          status: 'usable' as const,
          lastFullyUsableLocalDay: 20760,
          observedAt,
        })),
      );
      await expect(acceptQuote(request, ports)).rejects.toThrow('artwork unavailable through complete quote window');
      expect(ports.authorization.issue).not.toHaveBeenCalled();
    }
  });

  it('admits explicit logo-later only under the effective published placement policy', async () => {
    const deferred = {
      ...group,
      design: {
        ...group.design,
        placements: group.design.placements.map((p) => ({
          ...p,
          artwork: { kind: 'deferred' as const, intentId: 'independent-design-nonce' },
        })),
      },
    };
    const { ports } = fixture();
    await expect(acceptQuote({ ...request, groups: [{ group: deferred }] }, ports)).rejects.toThrow();
    expect(ports.artwork.readUsability).not.toHaveBeenCalled();
    vi.mocked(ports.publication.getEffective).mockResolvedValue({
      config: { ...config, placements: config.placements.map((p) => ({ ...p, logoLaterAllowed: true })) },
      configId: 'cfg',
      operationId: 'op',
    });
    vi.mocked(ports.artwork.readUsability).mockImplementation(async (input) =>
      input.choices.map((choice) => ({
        ...choice,
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        status: input.permittedDeferredIntentIds?.includes(choice.id) ? 'usable' : 'unavailable',
        lastFullyUsableLocalDay: 20760,
        observedAt: now.toISOString(),
      })),
    );
    const accepted = await acceptQuote({ ...request, groups: [{ group: deferred }] }, ports);
    expect(accepted.quote.artworkChecks[0]?.kind).toBe('deferred');
  });

  it('admits ISO country codes and rejects reserved two-letter claims before provider reads', async () => {
    for (const country of ['XX', 'ZZ', 'XK', 'us']) {
      const { ports } = fixture();
      await expect(acceptQuote({ ...request, country }, ports)).rejects.toThrow(/invalid quote request/);
      expect(ports.tenant.getActive).not.toHaveBeenCalled();
    }
    const { ports } = fixture();
    const accepted = await acceptQuote(
      { ...request, country: 'GB' },
      {
        ...ports,
        catalog: {
          resolveVariantContext: async () => [
            {
              shopId: 'shop',
              installationGeneration: '1',
              productId: 'product',
              variantId: 'variant',
              productIdVerified: true,
              context: { country: 'GB' },
              amount: '10.00',
              currencyCode: 'USD',
              sourceApiVersion: '2026-07',
              observedAt: '2026-11-01T05:29:00.000Z',
              freshUntil: '2026-11-01T05:34:00.000Z',
              correlation: { requestId: 'synthetic' },
            },
          ],
        },
      },
    );
    expect(accepted.quote.country).toBe('GB');
  });

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
    expect(result.quote.artworkChecks).toHaveLength(1);
    expect(result.quote.artworkChecks[0]?.choiceSha256).toMatch(/^[0-9a-f]{64}$/);
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

  it('rejects artwork that expires during D+2 or belongs to another installation before signing', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.artwork.readUsability).mockImplementationOnce(async (input) =>
      input.choices.map((choice) => ({
        ...choice,
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        status: 'usable' as const,
        lastFullyUsableLocalDay: 20759,
        observedAt: now.toISOString(),
      })),
    );
    await expect(acceptQuote(request, ports)).rejects.toThrow(/artwork unavailable/);
    vi.mocked(ports.artwork.readUsability).mockImplementationOnce(async (input) =>
      input.choices.map((choice) => ({
        ...choice,
        shopId: input.shopId,
        installationGeneration: '999',
        status: 'usable' as const,
        lastFullyUsableLocalDay: 20760,
        observedAt: now.toISOString(),
      })),
    );
    await expect(acceptQuote(request, ports)).rejects.toThrow(/artwork unavailable/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('rechecks artwork inside acceptance and refuses a newly shortened lifetime', async () => {
    const { ports, saved } = fixture();
    vi.mocked(ports.artwork.readUsability)
      .mockImplementationOnce(async (input) =>
        input.choices.map((choice) => ({
          ...choice,
          shopId: input.shopId,
          installationGeneration: input.installationGeneration,
          status: 'usable' as const,
          lastFullyUsableLocalDay: 20760,
          observedAt: now.toISOString(),
        })),
      )
      .mockImplementationOnce(async (input) =>
        input.choices.map((choice) => ({
          ...choice,
          shopId: input.shopId,
          installationGeneration: input.installationGeneration,
          status: 'unavailable' as const,
          lastFullyUsableLocalDay: 20759,
          observedAt: now.toISOString(),
        })),
      );
    await expect(acceptQuote(request, ports)).rejects.toThrow(/artwork unavailable/);
    expect(ports.authorization.issue).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
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
      keyId: 7,
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
      keyId: 7,
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
    const oversizedVariants = new Array(100_000);
    Object.defineProperty(oversizedVariants, 0, {
      enumerable: true,
      get() {
        throw new Error('oversized variants were iterated');
      },
    });
    await expect(
      acceptQuote({ ...request, groups: [{ group: { ...group, variants: oversizedVariants } }] }, ports),
    ).rejects.toThrow(/candidate capacity exceeded/);
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
