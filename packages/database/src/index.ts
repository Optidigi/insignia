/** The package root exposes scoped durable operations, never Kysely executors. */
export { createDurableCore, type DurableCore, type DurableTransaction } from './durable-core.js';
export { canonicalJson, revisionContentHash, sha256CanonicalJson } from './hash/canonical.js';
export { CONFIG_DRAFT_STORAGE_VERSION, type ConfigRecord, type RevisionRecord } from './repositories/config.js';
export type { ShopRecord } from './repositories/tenant.js';
