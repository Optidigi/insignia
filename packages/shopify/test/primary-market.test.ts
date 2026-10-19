import { describe, expect, it, vi } from 'vitest';
import { readPrimaryMarketContext } from '../src/primary-market.js';
import { graphqlRequest, required } from './fixture-assertions.js';

const target = { shopId: 'tenant-1', installationGeneration: '7', shopifyShopId: '105501393179' };
const now = () => new Date('2026-10-15T12:00:00Z');
const credential = {
  kind: 'usable' as const,
  shopDomain: 'synthetic.myshopify.com',
  accessToken: 'synthetic-token',
  accessExpiresAt: new Date('2026-10-15T12:10:00Z'),
};
function page(countries: string[], next: string | null = null) {
  return {
    data: {
      shop: { id: 'gid://shopify/Shop/105501393179', currencyCode: 'USD' },
      primaryMarket: {
        id: 'gid://shopify/Market/123',
        status: 'ACTIVE',
        conditions: {
          regionsCondition: {
            regions: {
              nodes: countries.map((code) => ({ __typename: 'MarketRegionCountry', code })),
              pageInfo: { hasNextPage: next !== null, endCursor: next },
            },
          },
        },
      },
    },
  };
}
function fixture(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'x-shopify-api-version': '2026-07' } });
}

describe('primary-Market context read', () => {
  it('fences the credential and reads complete country membership using the pinned API without enabling a currency', async () => {
    const acquire = vi.fn().mockResolvedValue(credential);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fixture(page(['US'], 'page-2')))
      .mockResolvedValueOnce(fixture(page(['CA'])));
    const result = await readPrimaryMarketContext(target, { credentials: { acquire }, fetchImpl, now });
    expect(result).toEqual({
      ...target,
      shopCurrency: 'USD',
      primaryMarketId: 'gid://shopify/Market/123',
      countryCodes: ['US', 'CA'],
      sourceApiVersion: '2026-07',
      observedAt: '2026-10-15T12:00:00.000Z',
      freshUntil: '2026-10-15T12:05:00.000Z',
    });
    expect(acquire).toHaveBeenCalledWith({ shopId: 'tenant-1', installationGeneration: '7' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://synthetic.myshopify.com/admin/api/2026-07/graphql.json');
    expect(options.redirect).toBe('error');
    const query = graphqlRequest(String(options.body));
    expect(query.variables).toEqual({ after: null });
    expect(query.query).toContain('regions(first: 250, after: $after)');
    expect(query.query).toContain('... on MarketRegionCountry { code }');
    expect(graphqlRequest(String(fetchImpl.mock.calls[1]?.[1].body)).variables).toEqual({ after: 'page-2' });
  });
  it.each([
    [
      'missing market',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket = null as never;
      },
    ],
    [
      'inactive market',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.status = 'DRAFT';
      },
    ],
    [
      'unknown market status',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.status = 'UNKNOWN';
      },
    ],
    [
      'wrong shop',
      (body: ReturnType<typeof page>) => {
        body.data.shop.id = 'gid://shopify/Shop/2';
      },
    ],
    [
      'invalid currency',
      (body: ReturnType<typeof page>) => {
        body.data.shop.currencyCode = 'usd';
      },
    ],
    [
      'missing conditions',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.conditions = null as never;
      },
    ],
    [
      'subdivision membership',
      (body: ReturnType<typeof page>) => {
        required(body.data.primaryMarket.conditions.regionsCondition.regions.nodes[0]).__typename =
          'MarketRegionSubdivision';
      },
    ],
    [
      'unknown region type',
      (body: ReturnType<typeof page>) => {
        required(body.data.primaryMarket.conditions.regionsCondition.regions.nodes[0]).__typename = 'FutureRegion';
      },
    ],
    [
      'malformed country',
      (body: ReturnType<typeof page>) => {
        required(body.data.primaryMarket.conditions.regionsCondition.regions.nodes[0]).code = 'USA';
      },
    ],
    [
      'duplicate country',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.conditions.regionsCondition.regions.nodes.push({
          __typename: 'MarketRegionCountry',
          code: 'US',
        });
      },
    ],
    [
      'empty countries',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.conditions.regionsCondition.regions.nodes = [];
      },
    ],
    [
      'missing next cursor',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.conditions.regionsCondition.regions.pageInfo.hasNextPage = true;
      },
    ],
    [
      'missing completeness flag',
      (body: ReturnType<typeof page>) => {
        body.data.primaryMarket.conditions.regionsCondition.regions.pageInfo.hasNextPage = undefined as never;
      },
    ],
  ])('fails closed for %s', async (_name, alter) => {
    const body = page(['US']);
    alter(body);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(fixture(body));
    await expect(
      readPrimaryMarketContext(target, { credentials: { acquire: async () => credential }, fetchImpl, now }),
    ).rejects.toThrow('Primary Market unavailable:');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(['duplicate country', 'changed market', 'changed currency', 'repeated cursor', 'page overflow'])(
    'rejects %s across pages without retrying a read',
    async (reason) => {
      const first = page(['US'], 'page-2');
      const second = page(['CA']);
      if (reason === 'duplicate country')
        required(second.data.primaryMarket.conditions.regionsCondition.regions.nodes[0]).code = 'US';
      if (reason === 'changed market') second.data.primaryMarket.id = 'gid://shopify/Market/999';
      if (reason === 'changed currency') second.data.shop.currencyCode = 'EUR';
      if (reason === 'repeated cursor')
        second.data.primaryMarket.conditions.regionsCondition.regions.pageInfo = {
          hasNextPage: true,
          endCursor: 'page-2',
        };
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(fixture(first))
        .mockResolvedValueOnce(fixture(second));
      if (reason === 'page overflow') {
        fetchImpl.mockReset();
        for (const [index, code] of ['US', 'CA', 'GB', 'NL'].entries())
          fetchImpl.mockResolvedValueOnce(fixture(page([code], `cursor-${index}`)));
      }
      await expect(
        readPrimaryMarketContext(target, { credentials: { acquire: async () => credential }, fetchImpl, now }),
      ).rejects.toThrow('Primary Market unavailable:');
      expect(fetchImpl).toHaveBeenCalledTimes(reason === 'page overflow' ? 4 : 2);
    },
  );

  it('does not mistake target currencies for an eligibility list and never extends credential expiry', async () => {
    const body = page(['JP']);
    body.data.shop.currencyCode = 'JPY';
    const result = await readPrimaryMarketContext(target, {
      credentials: { acquire: async () => ({ ...credential, accessExpiresAt: new Date('2026-10-15T12:01:00Z') }) },
      fetchImpl: async () => fixture(body),
      now,
    });
    expect(result.shopCurrency).toBe('JPY');
    expect(result.countryCodes).toEqual(['JP']);
    expect(result.freshUntil).toBe('2026-10-15T12:01:00.000Z');
  });

  it('rejects invalid scope, unavailable/expired credentials and unsafe domains before transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const acquire = vi.fn().mockResolvedValue(credential);
    await expect(
      readPrimaryMarketContext(
        { ...target, installationGeneration: '0' },
        { credentials: { acquire }, fetchImpl, now },
      ),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(acquire).not.toHaveBeenCalled();
    for (const value of [
      { kind: 'inactive' },
      { ...credential, accessExpiresAt: new Date('2026-10-15T12:00:30Z') },
      { ...credential, shopDomain: 'untrusted.example' },
      { ...credential, accessToken: 'token\n' },
    ]) {
      await expect(
        readPrimaryMarketContext(target, {
          credentials: { acquire: async () => value as typeof credential },
          fetchImpl,
          now,
        }),
      ).rejects.toMatchObject({ kind: 'credential_unavailable' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sanitizes HTTP, GraphQL, malformed/oversized body and network failures without retries', async () => {
    const cases = [
      async () => new Response('sensitive provider text', { status: 403 }),
      async () => fixture({ data: page(['US']).data, errors: [{ message: 'sensitive provider text' }] }),
      async () => new Response('not JSON: sensitive provider text'),
      async () => new Response('x'.repeat(128 * 1024 + 1)),
      async () => {
        throw new Error('sensitive provider text');
      },
    ];
    for (const fetchResponse of cases) {
      const fetchImpl = vi.fn<typeof fetch>(fetchResponse);
      const error = await readPrimaryMarketContext(target, {
        credentials: { acquire: async () => credential },
        fetchImpl,
        now,
      }).catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain('sensitive');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
  it('bounds an unresponsive read and never dispatches a subsequent page after timeout', async () => {
    vi.useFakeTimers();
    try {
      let settle: (response: Response) => void = () => {};
      const fetchImpl = vi.fn<typeof fetch>(
        (_url, _options) =>
          new Promise<Response>((resolve) => {
            settle = resolve;
          }),
      );
      const outcome = readPrimaryMarketContext(target, {
        credentials: { acquire: async () => credential },
        fetchImpl,
        now,
      }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await outcome).toMatchObject({ kind: 'network' });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      settle(fixture(page(['US'], 'more')));
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not return a fresh observation if the credential expired while reading', async () => {
    let timestamp = Date.parse('2026-10-15T12:00:00Z');
    await expect(
      readPrimaryMarketContext(target, {
        credentials: { acquire: async () => ({ ...credential, accessExpiresAt: new Date('2026-10-15T12:01:00Z') }) },
        fetchImpl: async () => {
          timestamp = Date.parse('2026-10-15T12:02:00Z');
          return fixture(page(['US']));
        },
        now: () => new Date(timestamp),
      }),
    ).rejects.toMatchObject({ kind: 'credential_unavailable' });
  });
  it.each(['credential acquisition', 'transport'])(
    'binds the original tenant/generation even if the caller mutates target during %s',
    async (phase) => {
      const mutable = { ...target };
      const mutate = () => {
        mutable.shopId = 'other-tenant';
        mutable.installationGeneration = '99';
      };
      const acquire = vi.fn(async () => {
        if (phase === 'credential acquisition') mutate();
        return credential;
      });
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        if (phase === 'transport') mutate();
        return fixture(page(['US']));
      });
      const result = await readPrimaryMarketContext(mutable, { credentials: { acquire }, fetchImpl, now });
      expect(acquire).toHaveBeenCalledWith({ shopId: 'tenant-1', installationGeneration: '7' });
      expect(result).toMatchObject(target);
    },
  );

  it.each(['credential acquisition', 'first page'])(
    'does not dispatch after the credential expires during %s',
    async (phase) => {
      let timestamp = Date.parse('2026-10-15T12:00:00Z');
      const expire = () => {
        timestamp = Date.parse('2026-10-15T12:11:00Z');
      };
      const acquire = async () => {
        if (phase === 'credential acquisition') expire();
        return credential;
      };
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        expire();
        return fixture(page(['US'], 'next-page'));
      });
      await expect(
        readPrimaryMarketContext(target, { credentials: { acquire }, fetchImpl, now: () => new Date(timestamp) }),
      ).rejects.toMatchObject({ kind: 'credential_unavailable' });
      expect(fetchImpl).toHaveBeenCalledTimes(phase === 'credential acquisition' ? 0 : 1);
    },
  );

  it.each([null, '2026-10'])(
    'rejects missing or substituted API version %s rather than claiming the pinned response',
    async (version) => {
      const response = fixture(page(['US']));
      if (version === null) response.headers.delete('x-shopify-api-version');
      else response.headers.set('x-shopify-api-version', version);
      await expect(
        readPrimaryMarketContext(target, {
          credentials: { acquire: async () => credential },
          fetchImpl: async () => response,
          now,
        }),
      ).rejects.toMatchObject({ kind: 'provider_error' });
    },
  );
  it.each([Number.NaN, Date.parse('2026-10-15T11:59:59Z')])(
    'rejects invalid/backward clock %s before dispatch',
    async (changedTime) => {
      let calls = 0;
      const fetchImpl = vi.fn<typeof fetch>();
      await expect(
        readPrimaryMarketContext(target, {
          credentials: { acquire: async () => credential },
          fetchImpl,
          now: () => new Date(calls++ === 0 ? Date.parse('2026-10-15T12:00:00Z') : changedTime),
        }),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
