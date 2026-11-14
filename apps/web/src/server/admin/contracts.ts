/** Server-only integration seam. The integrator supplies verified online identity,
 * bounded catalog reads and durable config/publication commands. None of these
 * ports may trust a shop, product or staff identity from the browser body. */

import type { ExpectedFunctionBuild } from '@insignia/application';
import type { MethodConfiguration, VersionedMethodConfiguration } from '@insignia/contracts';
import type { FunctionOwnership } from '@insignia/shopify';
import type { CatalogProduct, CommandOutcome, ConfigView } from '../../shared/admin-view.js';
import type { BillingView } from '../../shared/billing-view.js';
import type { MerchantMediaService } from './merchant-media.js';
import type { SigningOwnerAction } from './signing-owner-action.js';

export type { CatalogProduct, CommandOutcome, ConfigView, PublicationState } from '../../shared/admin-view.js';
/** The configuration command a 422 rejected; 'command' when the request named none validly. */
export type ConfigRejectionAction = import('@insignia/observability').AdminConfigAction;
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
  /** Private artwork uses an explicit grant; product scopes alone never suffice. */
  canReadArtwork?: boolean;
  canUploadArtwork?: boolean;
  /** Account-owner order access verified against online and installation grants. */
  canReadOrders?: boolean;
}

export type MethodTemplate = { id: string; name: string; version: string };
export type MethodOutcome =
  | { kind: 'created' | 'saved'; method: MethodTemplate }
  | { kind: 'deleted' }
  | { kind: 'conflict'; message: string };
export type MethodConfigurationOutcome =
  | { kind: 'created' | 'saved'; method: VersionedMethodConfiguration }
  | { kind: 'conflict'; message: string };
export interface MethodLibrary {
  catalog?(actor: AdminActor): Promise<{
    methods: VersionedMethodConfiguration[];
    shop?: string;
    authority?: string;
    currency?: string;
    canEdit?: boolean;
  }>;
  saveConfiguration?(
    actor: AdminActor,
    value: MethodConfiguration,
    expectedVersion: string | null,
    key: string,
    expectedAuthority?: string,
    expectedCurrency?: string,
  ): Promise<MethodConfigurationOutcome>;

  list(actor: AdminActor): Promise<{ methods: MethodTemplate[] }>;
  create(actor: AdminActor, name: string, key: string): Promise<MethodOutcome>;
  rename(actor: AdminActor, id: string, version: string, name: string, key: string): Promise<MethodOutcome>;
  delete(
    actor: AdminActor,
    id: string,
    version: string,
    key: string,
    expectedAuthority?: string,
  ): Promise<MethodOutcome>;
}
export interface AdminServices {
  media?: MerchantMediaService;
  preferences?: import('./preferences.js').MerchantPreferences;
  assertPurchaseAccess?(actor: AdminActor): Promise<void>;
  methods?: MethodLibrary;
  shopTimeZone?(actor: AdminActor): Promise<string>;
  orderNames?(actor: AdminActor, orderIds: string[]): Promise<Record<string, string | null>>;
  orderPresentation?(
    actor: AdminActor,
    target: import('@insignia/shopify').OrderPresentationTarget,
  ): Promise<import('@insignia/shopify').OrderPresentation | null>;
  appOrigin: string;
  /** Read-only authoritative subscription observation; never creates or changes a plan. */
  billing?(actor: AdminActor): Promise<BillingView>;
  /** Fixed private owner allocation; absence does not authorize key setup. */
  signingOwner?: SigningOwnerAction;
  /** Must verify the Shopify session token on every request and bind it to an online
   * staff grant and the active installation, including reinstall/deactivation
   * invalidation. A verified grant and a durably fenced installation observation may
   * be reused (see auth.ts); `fresh` (staff-sensitive actions) never reuses either. */
  authenticate(request: Request, options?: { fresh?: boolean }): Promise<AdminActor | null>;
  /** HTTP-only rejected boundary observation; no request, claims or error crosses this port. */
  recordAuthenticationRejection?(stage: 'BEARER_MISSING' | 'BEARER_MALFORMED' | 'AUTHENTICATED_ACTOR_REJECTED'): void;
  /** Configuration-route 422 observation: action and reason code only, never request or draft content. */
  recordConfigRejection?(rejection: {
    action: ConfigRejectionAction;
    code: import('../../shared/config-rejection.js').ConfigRejectionCode;
  }): void;
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
      input: import('./catalog-query.js').CatalogListInput,
    ): Promise<{ products: CatalogProduct[]; nextCursor: string | null }>;
    get(actor: AdminActor, productId: string): Promise<CatalogProduct | null>;
  };
  /** Commands own M2 validation, M3 CAS/idempotency and M4 publication. */
  configs: {
    reconcile?(
      actor: AdminActor,
      productId: string,
      input: { stage: 'create' | 'save' | 'publish'; operationKey: string; authority: string },
    ): Promise<{ kind: 'resolved'; publicationRecorded?: boolean }>;
    read(actor: AdminActor, productId: string): Promise<ConfigView>;
    create(actor: AdminActor, productId: string, idempotencyKey: string, authority?: string): Promise<CommandOutcome>;
    save(
      actor: AdminActor,
      productId: string,
      input: { configId: string; draftVersion: string; draft: unknown; idempotencyKey: string; authority?: string },
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
      input: { configId: string; draftVersion: string; idempotencyKey: string; authority?: string },
    ): Promise<CommandOutcome>;
  };
}
