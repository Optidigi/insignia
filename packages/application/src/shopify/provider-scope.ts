/** Read-only M3 tenant identity, checked against the active installation. */
export type ActiveProviderShopScope = {
  shopId: string;
  shopDomain: string;
  shopifyShopId: string;
  installationGeneration: string;
};

export interface ProviderTenantScopePort {
  getActiveProviderScope(input: {
    shopId: string;
    installationGeneration: string;
  }): Promise<ActiveProviderShopScope | null>;
}
