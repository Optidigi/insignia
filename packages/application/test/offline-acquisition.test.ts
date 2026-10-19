import { describe, expect, it, vi } from 'vitest';
import {
  bootstrapExpiringOfflineCredentials,
  type OfflineAcquisitionPort,
  OfflineAcquisitionRejectedError,
} from '../src/shopify/offline-acquisition.js';

const identity = {
  shopId: 'tenant-1',
  installationGeneration: '1',
  authorizationGeneration: 'auth-1',
  authorizationEpoch: 0,
  externalInstallationId: 'gid://shopify/AppInstallation/11',
};
const now = new Date('2026-10-14T12:00:00Z');
const pair = {
  schemaVersion: 'm3-offline-credential-v1' as const,
  accessToken: 'synthetic-access',
  refreshToken: 'synthetic-refresh',
  accessExpiresAt: new Date(+now + 3600000),
  refreshExpiresAt: new Date(+now + 86400000),
  scopes: 'write_products',
};
function fixture(kind: 'reserved' | 'existing' | 'busy' | 'unresolved' | 'inactive' = 'reserved') {
  const credentials = {
    reserveAcquisition: vi.fn<OfflineAcquisitionPort['reserveAcquisition']>(async () => ({
      kind,
      attemptId: 'attempt-1',
      shopDomain: 'alpha.myshopify.com',
    })),
    dispatchAcquisition: vi.fn<OfflineAcquisitionPort['dispatchAcquisition']>(async () => true),
    completeAcquisition: vi.fn<OfflineAcquisitionPort['completeAcquisition']>(async () => 'installed'),
    rejectAcquisition: vi.fn<OfflineAcquisitionPort['rejectAcquisition']>(async () => true),
  };
  const exchange = vi.fn(async () => pair);
  return {
    credentials,
    exchange,
    run: () => bootstrapExpiringOfflineCredentials({ credentials, identity, exchange, now: () => now }),
  };
}
describe('verified merchant bootstrap to durable offline credentials', () => {
  it('dispatches one fenced exchange and installs the complete pair atomically', async () => {
    const f = fixture();
    expect(await f.run()).toBe('installed');
    expect(f.credentials.reserveAcquisition).toHaveBeenCalledWith({ ...identity, claimLeaseMs: 30000 });
    expect(f.credentials.dispatchAcquisition).toHaveBeenCalledWith({
      shopId: identity.shopId,
      installationGeneration: '1',
      attemptId: 'attempt-1',
    });
    expect(f.exchange).toHaveBeenCalledWith('alpha.myshopify.com');
    expect(f.credentials.completeAcquisition).toHaveBeenCalledWith({
      shopId: identity.shopId,
      installationGeneration: '1',
      attemptId: 'attempt-1',
      pair,
    });
    expect(f.credentials.rejectAcquisition).not.toHaveBeenCalled();
  });
  it.each(['existing', 'busy', 'unresolved', 'inactive'] as const)(
    'never regenerates a credential when reservation says %s',
    async (kind) => {
      const f = fixture(kind);
      expect(await f.run()).toBe(kind);
      expect(f.exchange).not.toHaveBeenCalled();
    },
  );
  it('does not dispatch when installation changed before the network boundary', async () => {
    const f = fixture();
    f.credentials.dispatchAcquisition.mockResolvedValue(false);
    expect(await f.run()).toBe('inactive');
    expect(f.exchange).not.toHaveBeenCalled();
  });
  it('leaves response loss unresolved, including a new caller after restart', async () => {
    const f = fixture();
    f.exchange.mockRejectedValue(new Error('synthetic response loss'));
    expect(await f.run()).toBe('unresolved');
    expect(f.credentials.rejectAcquisition).not.toHaveBeenCalled();
    expect(f.credentials.completeAcquisition).not.toHaveBeenCalled();
    f.credentials.reserveAcquisition.mockResolvedValue({
      kind: 'unresolved',
    });
    expect(await f.run()).toBe('unresolved');
    expect(f.exchange).toHaveBeenCalledTimes(1);
  });
  it('only clears a definitely rejected exchange', async () => {
    const f = fixture();
    f.exchange.mockRejectedValue(new OfflineAcquisitionRejectedError());
    expect(await f.run()).toBe('rejected');
    expect(f.credentials.rejectAcquisition).toHaveBeenCalledTimes(1);
  });
  it('does not install a malformed or expired acquired pair or retry its issuance', async () => {
    const f = fixture();
    f.exchange.mockResolvedValue({ ...pair, accessExpiresAt: now });
    expect(await f.run()).toBe('unresolved');
    expect(f.credentials.completeAcquisition).not.toHaveBeenCalled();
    expect(f.credentials.rejectAcquisition).not.toHaveBeenCalled();
  });
  it('never claims success for stale completion or lost database acknowledgment', async () => {
    const f = fixture();
    f.credentials.completeAcquisition.mockResolvedValue('stale');
    expect(await f.run()).toBe('inactive');
    f.credentials.completeAcquisition.mockRejectedValue(new Error('lost commit acknowledgment'));
    expect(await f.run()).toBe('unresolved');
    expect(f.credentials.rejectAcquisition).not.toHaveBeenCalled();
  });
});
