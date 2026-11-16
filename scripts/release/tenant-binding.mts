import assert from 'node:assert/strict';
import type { DurableCore } from '../../packages/database/dist/index.js';

export const APP_CLIENT_ID = '1443cf6d03d39edae7c101a943c5c684';
/** A store domain as Shopify issues it. */
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/;

export type ReleaseBinding = {
  shopId: string;
  installationGeneration: string;
  appClientId: string;
  authorizationGeneration: string;
  authorizationEpoch: number;
  externalInstallationId: string;
};

/**
 * The current installation of the store a verification request names, read from the database.
 * The request only selects the store (its tenant id and generation); every other binding field,
 * the store domain and the Shopify shop id come from the active installation records. An inactive,
 * replaced or uninstalled installation has no binding.
 */
export async function currentTenantBinding(
  tenants: Pick<DurableCore['tenants'], 'getActiveAuthorizationScope' | 'getManagedInstallationState'>,
  requested: Pick<ReleaseBinding, 'shopId' | 'installationGeneration'>,
): Promise<{ shop: string; shopifyShopId: string; binding: ReleaseBinding }> {
  const scope = await tenants.getActiveAuthorizationScope({
    shopId: requested.shopId,
    installationGeneration: requested.installationGeneration,
  });
  assert.ok(scope && scope.shopId === requested.shopId && SHOP_DOMAIN.test(scope.shopDomain));
  const managed = await tenants.getManagedInstallationState(scope.shopDomain);
  assert.ok(
    managed?.active &&
      managed.shopId === scope.shopId &&
      managed.currentGeneration === scope.installationGeneration &&
      managed.shopifyShopId === scope.shopifyShopId &&
      typeof managed.externalInstallationId === 'string',
  );
  return {
    shop: scope.shopDomain,
    shopifyShopId: managed.shopifyShopId,
    binding: {
      shopId: managed.shopId,
      installationGeneration: managed.currentGeneration,
      appClientId: APP_CLIENT_ID,
      authorizationGeneration: scope.authorizationGeneration,
      authorizationEpoch: scope.authorizationEpoch,
      externalInstallationId: managed.externalInstallationId,
    },
  };
}
