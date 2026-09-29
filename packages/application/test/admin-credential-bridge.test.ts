import { describe, expect, test, vi } from 'vitest';
import { createM3AdminReadCredentialSource } from '../src/shopify/admin-credential-bridge.js';
import type { OfflineCredentialLifecyclePort, OfflineRefreshTransport } from '../src/shopify/offline-credentials.js';

const input = { shopId: 'tenant-1', installationGeneration: '7' };
const scope = {
  ...input,
  shopDomain: 'fixture.myshopify.com',
  shopifyShopId: '456',
};
const refresh = { refresh: vi.fn() } as unknown as OfflineRefreshTransport;

describe('M3 Admin credential bridge', () => {
  test('joins the active M3 scope to its fenced usable token and rechecks before returning', async () => {
    const getActiveProviderScope = vi.fn(async () => scope);
    const acquire = vi.fn(async () => ({
      kind: 'usable' as const,
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2026-10-01T00:00:00Z'),
    }));
    const source = createM3AdminReadCredentialSource({
      tenants: { getActiveProviderScope },
      credentials: { acquire } as unknown as OfflineCredentialLifecyclePort,
      refresh,
      now: () => new Date('2026-09-29T12:00:00Z'),
    });
    await expect(source.acquire(input)).resolves.toEqual({
      kind: 'usable',
      shopDomain: scope.shopDomain,
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(acquire).toHaveBeenCalledWith({ ...input, minimumRemainingMs: 30_000, claimLeaseMs: 30_000 });
    expect(getActiveProviderScope).toHaveBeenCalledTimes(2);
    expect(refresh.refresh).not.toHaveBeenCalled();
  });
  test('rejects missing or changed active scope without returning a credential', async () => {
    const acquire = vi.fn(async () => ({
      kind: 'usable' as const,
      accessToken: 'synthetic-token',
      accessExpiresAt: new Date('2026-10-01T00:00:00Z'),
    }));
    const source = createM3AdminReadCredentialSource({
      tenants: { getActiveProviderScope: vi.fn().mockResolvedValueOnce(scope).mockResolvedValueOnce(null) },
      credentials: { acquire } as unknown as OfflineCredentialLifecyclePort,
      refresh,
    });
    await expect(source.acquire(input)).resolves.toEqual({ kind: 'inactive' });
    expect(acquire).toHaveBeenCalledTimes(1);
    const missing = createM3AdminReadCredentialSource({
      tenants: { getActiveProviderScope: async () => null },
      credentials: { acquire } as unknown as OfflineCredentialLifecyclePort,
      refresh,
    });
    await expect(missing.acquire(input)).resolves.toEqual({ kind: 'inactive' });
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
