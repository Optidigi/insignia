/** The package root exposes scoped durable operations, never Kysely executors. */

export {
  CredentialAuthenticationError,
  type CredentialKeyRing,
  MissingCredentialKeyError,
} from './credentials/envelope.js';
export { createDurableCore, type DurableCore, type DurableTransaction } from './durable-core.js';
export { canonicalJson, revisionContentHash, sha256CanonicalJson } from './hash/canonical.js';
export { CONFIG_DRAFT_STORAGE_VERSION, type ConfigRecord, type RevisionRecord } from './repositories/config.js';
export type {
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
} from './repositories/shopify-webhooks.js';
export type { ActiveAuthorizationScope, ShopRecord } from './repositories/tenant.js';
