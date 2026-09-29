import { describe, expect, test, vi } from 'vitest';
import { createShopifyOfflineRefreshTransport, ShopifyRefreshError } from '../src/refresh.js';

const configuration = { clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret' };
const request = { shopDomain: 'test-shop.myshopify.com', refreshToken: 'synthetic-refresh-old' };
const valid = {
  access_token: 'synthetic-access-new',
  refresh_token: 'synthetic-refresh-new',
  expires_in: 3100,
  refresh_token_expires_in: 86400,
  scope: 'read_products,write_products',
};

describe('Shopify expiring offline refresh transport', () => {
  test('posts only to validated shop OAuth endpoint, parses provider lifetimes and scope', async () => {
    const fetchImpl = vi.fn(async () => Response.json(valid));
    const transport = createShopifyOfflineRefreshTransport({
      ...configuration,
      fetchImpl,
      now: () => new Date('2026-09-29T12:00:00Z'),
    });
    const result = await transport.refresh(request);
    expect(result).toEqual({
      schemaVersion: 'm3-offline-credential-v1',
      accessToken: valid.access_token,
      refreshToken: valid.refresh_token,
      accessExpiresAt: new Date('2026-09-29T12:51:40Z'),
      refreshExpiresAt: new Date('2026-09-30T12:00:00Z'),
      scopes: valid.scope,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://test-shop.myshopify.com/admin/oauth/access_token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
    const form = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: request.refreshToken,
    });
  });

  test('rejects endpoint host injection before network request', async () => {
    const fetchImpl = vi.fn();
    const transport = createShopifyOfflineRefreshTransport({ ...configuration, fetchImpl });
    await expect(
      transport.refresh({ ...request, shopDomain: 'test-shop.myshopify.com.evil.test' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    [429, {}, 'rate_limited'],
    [502, {}, 'server_failure'],
    [401, { error: 'invalid_request' }, 'terminal_invalid_refresh'],
    [200, { ...valid, refresh_token: undefined }, 'malformed_response'],
    [200, { ...valid, expires_in: 0 }, 'malformed_response'],
    [401, { error: 'invalid_client' }, 'unexpected_status'],
    [302, {}, 'unexpected_status'],
  ] as const)('classifies HTTP %i response', async (status, data, kind) => {
    const fetchImpl = vi.fn(async () => Response.json(data, { status }));
    const transport = createShopifyOfflineRefreshTransport({ ...configuration, fetchImpl });
    await expect(transport.refresh(request)).rejects.toMatchObject({ kind });
  });

  test('network loss remains retryable and exceptions do not include token material', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network failure synthetic-refresh-old');
    });
    const transport = createShopifyOfflineRefreshTransport({ ...configuration, fetchImpl });
    const error = await transport.refresh(request).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ShopifyRefreshError);
    expect(error).toMatchObject({ kind: 'network_or_timeout' });
    expect(String(error)).not.toContain('synthetic-refresh-old');
  });

  test('bounds success bodies before JSON parsing', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(17 * 1024), { status: 200 }));
    const transport = createShopifyOfflineRefreshTransport({ ...configuration, fetchImpl });
    await expect(transport.refresh(request)).rejects.toMatchObject({ kind: 'malformed_response' });
  });
});
