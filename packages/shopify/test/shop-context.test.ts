import { describe, expect, it, vi } from 'vitest';
import { readShopContext, type ShopContextError } from '../src/shop-context.js';

const target = { shopId: 'tenant-1', installationGeneration: '7', shopifyShopId: '105501393179' };
const credential = {
  kind: 'usable' as const,
  shopDomain: 'synthetic.myshopify.com',
  accessToken: 'synthetic-test-token',
  accessExpiresAt: new Date('2026-09-29T12:10:00.000Z'),
};
const now = () => new Date('2026-09-29T12:00:00.000Z');
function fixture(shop: unknown) {
  return new Response(JSON.stringify({ data: { shop } }), { status: 200 });
}

describe('read-only Shopify shop context', () => {
  it('fences acquisition and returns exact trusted shop identity, currency and IANA zone', async () => {
    const acquire = vi.fn().mockResolvedValue(credential);
    const fetchImpl = vi.fn().mockResolvedValue(
      fixture({
        id: `gid://shopify/Shop/${target.shopifyShopId}`,
        currencyCode: 'USD',
        ianaTimezone: 'America/New_York',
      }),
    );
    const result = await readShopContext(target, { credentials: { acquire }, fetchImpl, now });
    expect(acquire).toHaveBeenCalledWith({ shopId: target.shopId, installationGeneration: '7' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://synthetic.myshopify.com/admin/api/2026-07/graphql.json');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(String(options.body))).toEqual({
      query: 'query InsigniaShopContext { shop { id currencyCode ianaTimezone } }',
    });
    expect(result).toMatchObject({
      shopCurrency: 'USD',
      ianaTimezone: 'America/New_York',
      shopifyShopId: target.shopifyShopId,
    });
  });

  it('rejects mismatched shop, malformed zone and unusable credentials', async () => {
    const credentials = { acquire: vi.fn().mockResolvedValue(credential) };
    await expect(
      readShopContext(target, {
        credentials,
        fetchImpl: vi
          .fn()
          .mockResolvedValue(fixture({ id: 'gid://shopify/Shop/1', currencyCode: 'USD', ianaTimezone: 'UTC' })),
        now,
      }),
    ).rejects.toMatchObject({ kind: 'wrong_shop' } satisfies Partial<ShopContextError>);
    await expect(
      readShopContext(target, {
        credentials,
        fetchImpl: vi.fn().mockResolvedValue(
          fixture({
            id: `gid://shopify/Shop/${target.shopifyShopId}`,
            currencyCode: 'USD',
            ianaTimezone: 'Mars/Olympus',
          }),
        ),
        now,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_shape' } satisfies Partial<ShopContextError>);
    await expect(
      readShopContext(target, { credentials: { acquire: vi.fn().mockResolvedValue({ kind: 'inactive' }) }, now }),
    ).rejects.toMatchObject({ kind: 'credential_unavailable' } satisfies Partial<ShopContextError>);
  });
});
