/** Server-only integration seam. The integrator supplies verified online identity,
 * bounded catalog reads and durable config/publication commands. None of these
 * ports may trust a shop, product or staff identity from the browser body. */

import type { ExpectedFunctionBuild } from '@insignia/application';
import type { FunctionOwnership } from '@insignia/shopify';
import type { CatalogProduct, CommandOutcome, ConfigView } from '../../shared/admin-view.js';

export type { CatalogProduct, CommandOutcome, ConfigView, PublicationState } from '../../shared/admin-view.js';
export interface AdminActor {
  shop: string;
  shopId: string;
  installationId: string;
  tenantShopId: string;
  installationGeneration: string;
  staffId: string;
  sessionId: string;
  expiresAtMs: number;
  canRead: boolean;
  canEdit: boolean;
}

export interface AdminServices {
  appOrigin: string;
  /** Must verify the Shopify session token, active installation and online staff
   * grant on every request, including reinstall/deactivation invalidation. */
  authenticate(request: Request): Promise<AdminActor | null>;
  /** Read-only technical observations; presence alone is never activation admission. */
  inspectReadiness?(actor: AdminActor): Promise<{
    version: 'm5-admin-technical-readiness-v1';
    observedAt: string;
    shop: string;
    shopId: string;
    tenantShopId: string;
    installationGeneration: string;
    externalInstallationId: string;
    canRead: boolean;
    canEdit: boolean;
    ianaTimezone: string;
    merchantDay: number;
    functions: FunctionOwnership;
    trustedRelease: { recordId: string; activeAppVersionRef: string; expectedBuild: ExpectedFunctionBuild } | null;
    signingKeyPresent: boolean;
    publicConfigPresent: boolean;
    commercialConfigured: boolean;
  }>;
  catalog: {
    list(
      actor: AdminActor,
      input: { query: string; cursor: string | null; limit: number },
    ): Promise<{ products: CatalogProduct[]; nextCursor: string | null }>;
    get(actor: AdminActor, productId: string): Promise<CatalogProduct | null>;
  };
  /** Commands own M2 validation, M3 CAS/idempotency and M4 publication. */
  configs: {
    read(actor: AdminActor, productId: string): Promise<ConfigView>;
    create(actor: AdminActor, productId: string, idempotencyKey: string): Promise<CommandOutcome>;
    save(
      actor: AdminActor,
      productId: string,
      input: { configId: string; draftVersion: string; draft: unknown; idempotencyKey: string },
    ): Promise<CommandOutcome>;
    copy(
      actor: AdminActor,
      sourceProductId: string,
      targetProductId: string,
      idempotencyKey: string,
    ): Promise<CommandOutcome>;
    publish(
      actor: AdminActor,
      productId: string,
      input: { configId: string; draftVersion: string; idempotencyKey: string },
    ): Promise<CommandOutcome>;
  };
}
