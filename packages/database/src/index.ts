/** The package root exposes scoped durable operations, never Kysely executors. */

export {
  CredentialAuthenticationError,
  type CredentialKeyRing,
  MissingCredentialKeyError,
} from './credentials/envelope.js';
export { createDurableCore, type DurableCore, type DurableTransaction } from './durable-core.js';
export { canonicalJson, revisionContentHash, sha256CanonicalJson } from './hash/canonical.js';
export { type BuyerProposal, type BuyerRepository, type BuyerScope, BuyerStateError } from './repositories/buyer.js';
export { CONFIG_DRAFT_STORAGE_VERSION, type ConfigRecord, type RevisionRecord } from './repositories/config.js';
export type { CustomerPrivacyProcessing, CustomerPrivacyRepository } from './repositories/customer-privacy.js';
export { createMerchantPreviewRepository } from './repositories/merchant-preview.js';
export {
  applyOwnerLifecycleDecision,
  type OwnerLifecycleDecision,
  type OwnerLifecycleResult,
} from './repositories/owner-lifecycle.js';
export {
  type PurchaseDesignPayload,
  type PurchaseRecord,
  type PurchaseRepository,
  type PurchaseScope,
  PurchaseStateError,
} from './repositories/purchase.js';
export type { PurchaseDiscoveryClaim } from './repositories/purchase-cursors.js';
export type {
  AcquisitionAttempt,
  AcquisitionIdentity,
  AcquisitionReservation,
  ClaimIdentity,
  CredentialAcquire,
  CredentialIdentity,
  ExpiringOfflinePair,
} from './repositories/shop-credentials.js';
export {
  ShopifyDeliveryConflictError,
  type ShopifyWebhookReceipt,
  type ShopifyWebhookState,
  type VerifiedShopifyDelivery,
  type WebhookPayloadErasure,
  type WebhookQueueHandoffOutcome,
  type WebhookQueueHandoffState,
} from './repositories/shopify-webhooks.js';
export type {
  ActiveAuthorizationScope,
  ManagedInstallationIdentity,
  ManagedInstallationInput,
  ManagedInstallationResult,
  ManagedInstallationState,
  ShopRecord,
} from './repositories/tenant.js';
export { ManagedInstallationError } from './repositories/tenant.js';
export {
  type UsageDeliveryAttempt,
  type UsageDeliveryAttemptBegin,
  type UsageDeliveryAttemptRepository,
  UsageDeliveryAttemptStateError,
} from './repositories/usage-delivery-attempt.js';
export {
  type UsageDeliveryBinding,
  type UsageDeliveryIntent,
  type UsageDeliveryIntentRepository,
  UsageDeliveryIntentStateError,
  type UsageDeliveryPreparation,
} from './repositories/usage-delivery-intent.js';
export {
  type UsageLedgerRecord,
  type UsageLedgerRepository,
  type UsageLedgerScope,
  UsageLedgerStateError,
} from './repositories/usage-ledger.js';
