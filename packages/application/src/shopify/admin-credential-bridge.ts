import {
  type OfflineCredentialLifecyclePort,
  type OfflineRefreshTransport,
  refreshExpiringOfflineCredentials,
} from './offline-credentials.js';
import type { ProviderTenantScopePort } from './provider-scope.js';

/** Structural credential source for the Shopify Admin read transport, using M3's fenced lifecycle. */
export function createM3AdminReadCredentialSource(config: {
  tenants: ProviderTenantScopePort;
  credentials: OfflineCredentialLifecyclePort;
  refresh: OfflineRefreshTransport;
  now?: () => Date;
}) {
  return {
    async acquire(input: {
      shopId: string;
      installationGeneration: string;
    }): Promise<
      | { kind: 'usable'; shopDomain: string; accessToken: string; accessExpiresAt: Date }
      | { kind: 'inactive' | 'missing' | 'reauth_required' | 'temporarily_unavailable' }
    > {
      const scope = await config.tenants.getActiveProviderScope(input);
      if (!scope || scope.shopId !== input.shopId || scope.installationGeneration !== input.installationGeneration)
        return { kind: 'inactive' };
      const acquired = await refreshExpiringOfflineCredentials(
        config.credentials,
        config.refresh,
        { ...input, minimumRemainingMs: 30_000, claimLeaseMs: 30_000 },
        config.now,
      );
      if (acquired.kind === 'missing' || acquired.kind === 'inactive' || acquired.kind === 'reauth_required')
        return { kind: acquired.kind };
      if (acquired.kind !== 'usable' && acquired.kind !== 'refreshed') return { kind: 'temporarily_unavailable' };
      const current = await config.tenants.getActiveProviderScope(input);
      if (
        !current ||
        current.shopId !== scope.shopId ||
        current.installationGeneration !== scope.installationGeneration ||
        current.shopDomain !== scope.shopDomain ||
        current.shopifyShopId !== scope.shopifyShopId
      )
        return { kind: 'inactive' };
      return {
        kind: 'usable',
        shopDomain: current.shopDomain,
        accessToken: acquired.accessToken,
        accessExpiresAt: acquired.accessExpiresAt,
      };
    },
  };
}
