import { describe, expect, test, vi } from 'vitest';
import {
  type ExpiringOfflineTokenPair,
  InvalidOfflineCredentialError,
  installExpiringOfflineCredentials,
  type OfflineCredentialLifecyclePort,
  refreshExpiringOfflineCredentials,
} from '../src/shopify/offline-credentials.js';

const now = new Date('2026-09-29T12:00:00Z');
const pair = (access = 'access-new', refresh = 'refresh-new'): ExpiringOfflineTokenPair => ({
  schemaVersion: 'm3-offline-credential-v1',
  accessToken: access,
  refreshToken: refresh,
  accessExpiresAt: new Date(now.getTime() + 60_000),
  refreshExpiresAt: new Date(now.getTime() + 86_400_000),
  scopes: 'read_products',
});
const target = { shopId: 'shop-uuid', installationGeneration: '2', minimumRemainingMs: 30_000, claimLeaseMs: 10_000 };

function credentials(overrides: Partial<OfflineCredentialLifecyclePort> = {}): OfflineCredentialLifecyclePort {
  return {
    install: vi.fn(async () => {}),
    acquire: vi.fn(async () => ({
      kind: 'claimed',
      shopDomain: 'test.myshopify.com',
      claimId: 'claim-1',
      credentialVersion: '4',
      refreshToken: 'refresh-old',
      refreshExpiresAt: new Date(now.getTime() + 60_000),
    })),
    replaceClaim: vi.fn(async () => 'replaced'),
    releaseClaim: vi.fn(async () => {}),
    markReauthRequired: vi.fn(async () => 'marked'),
    ...overrides,
  };
}

describe('expiring offline credential lifecycle', () => {
  test('validates complete pair before delegating atomic encrypted install', async () => {
    const port = credentials();
    await installExpiringOfflineCredentials(
      port,
      { shopId: target.shopId, installationGeneration: '2', pair: pair() },
      now,
    );
    expect(port.install).toHaveBeenCalledTimes(1);
    await expect(
      installExpiringOfflineCredentials(
        port,
        { shopId: target.shopId, installationGeneration: '1', pair: { ...pair(), refreshExpiresAt: now } },
        now,
      ),
    ).rejects.toBeInstanceOf(InvalidOfflineCredentialError);
    expect(port.install).toHaveBeenCalledTimes(1);
  });

  test('network response loss releases claim and next attempt reuses stored old refresh token', async () => {
    const port = credentials();
    const transport = {
      refresh: vi.fn().mockRejectedValueOnce({ kind: 'network_or_timeout' }).mockResolvedValueOnce(pair()),
    };
    expect(await refreshExpiringOfflineCredentials(port, transport, target, () => now)).toEqual({
      kind: 'retryable',
      failure: 'network_or_timeout',
    });
    expect(await refreshExpiringOfflineCredentials(port, transport, target, () => now)).toMatchObject({
      kind: 'refreshed',
      accessToken: 'access-new',
    });
    expect(transport.refresh).toHaveBeenNthCalledWith(1, {
      shopDomain: 'test.myshopify.com',
      refreshToken: 'refresh-old',
    });
    expect(transport.refresh).toHaveBeenNthCalledWith(2, {
      shopDomain: 'test.myshopify.com',
      refreshToken: 'refresh-old',
    });
    expect(port.replaceClaim).toHaveBeenCalledTimes(1);
    expect(port.replaceClaim).toHaveBeenCalledWith(
      expect.objectContaining({ credentialVersion: '4', claimId: 'claim-1', pair: pair() }),
    );
  });

  test('terminal refresh marks reauth; transient errors do not', async () => {
    const port = credentials();
    expect(
      await refreshExpiringOfflineCredentials(
        port,
        {
          refresh: async () => {
            throw { kind: 'terminal_invalid_refresh' };
          },
        },
        target,
        () => now,
      ),
    ).toEqual({ kind: 'reauth_required' });
    expect(port.markReauthRequired).toHaveBeenCalledTimes(1);
    expect(port.replaceClaim).not.toHaveBeenCalled();
  });

  test('stale replacement cannot leak new access token or advance chain', async () => {
    const port = credentials({ replaceClaim: vi.fn(async () => 'stale') });
    expect(await refreshExpiringOfflineCredentials(port, { refresh: async () => pair() }, target, () => now)).toEqual({
      kind: 'stale',
    });
  });

  test('inactive generation and busy claim never reach transport', async () => {
    const transport = { refresh: vi.fn() };
    const inactive = credentials({ acquire: vi.fn(async () => ({ kind: 'inactive' })) });
    expect(await refreshExpiringOfflineCredentials(inactive, transport, target, () => now)).toEqual({
      kind: 'inactive',
    });
    const busy = credentials({ acquire: vi.fn(async () => ({ kind: 'busy' })) });
    expect(await refreshExpiringOfflineCredentials(busy, transport, target, () => now)).toEqual({ kind: 'busy' });
    expect(transport.refresh).not.toHaveBeenCalled();
  });
});
