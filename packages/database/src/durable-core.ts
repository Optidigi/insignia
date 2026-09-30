import type {
  AcceptedQuoteResult,
  CommandRepository,
  EffectiveQuoteRevision,
  InboxRepository,
  OutboxRepository,
  QuoteAcceptanceStore,
  TransactionRunner,
} from '@insignia/application';
import type { Transaction } from 'kysely';
import type { Pool } from 'pg';
import { createDatabase, type Database } from './client/database.js';
import type { CredentialKeyRing } from './credentials/envelope.js';
import { PgAcceptedQuoteRepository } from './repositories/accepted-quote.js';
import { PgCommandRepository } from './repositories/command/pg-command-repository.js';
import { type ConfigRecord, createConfigRepository, type RevisionRecord } from './repositories/config.js';
import { PgInboxRepository } from './repositories/delivery/pg-inbox-repository.js';
import { PgOutboxRepository } from './repositories/delivery/pg-outbox-repository.js';
import {
  type ClaimIdentity,
  type CredentialAcquire,
  type CredentialIdentity,
  createShopCredentialRepository,
  type ExpiringOfflinePair,
} from './repositories/shop-credentials.js';
import {
  createShopifyWebhookRepository,
  type ShopifyWebhookReceipt,
  type ShopifyWebhookState,
  type VerifiedShopifyDelivery,
} from './repositories/shopify-webhooks.js';
import { type ActiveAuthorizationScope, createTenantRepository, type ShopRecord } from './repositories/tenant.js';

const transactionBrand: unique symbol = Symbol('insignia durable transaction');

/** A transaction may only be passed to the scoped repository methods below. */
export type DurableTransaction = { readonly [transactionBrand]: true };

export type ConfigInput = {
  shopId: string;
  configId: string;
  externalProductId: string;
  draftSchemaVersion: string;
  draftValue: unknown;
};

export interface DurableCore {
  readonly acceptedQuotes: QuoteAcceptanceStore & {
    getEffective(shopId: string, productId: string): Promise<EffectiveQuoteRevision | null>;
  };
  readonly transactions: TransactionRunner<DurableTransaction>;
  readonly commands: CommandRepository<DurableTransaction>;
  readonly inbox: InboxRepository<DurableTransaction>;
  readonly outbox: OutboxRepository<DurableTransaction>;
  readonly configs: {
    createConfig(transaction: DurableTransaction, input: ConfigInput): Promise<ConfigRecord>;
    getConfig(shopId: string, configId: string): Promise<ConfigRecord | null>;
    getConfigInTransaction(
      transaction: DurableTransaction,
      shopId: string,
      configId: string,
    ): Promise<ConfigRecord | null>;
    getByProduct(shopId: string, productId: string): Promise<ConfigRecord | null>;
    updateDraft(
      transaction: DurableTransaction,
      input: {
        shopId: string;
        configId: string;
        expectedVersion: string;
        schemaVersion: string;
        draftValue: unknown;
      },
    ): Promise<{ kind: 'updated'; config: ConfigRecord } | { kind: 'conflict' }>;
    getRevision(shopId: string, revisionId: string): Promise<RevisionRecord | null>;
    getValidatedPublishedRevision(shopId: string, revisionId: string): Promise<RevisionRecord | null>;
  };
  readonly tenants: {
    getShop(shopId: string): Promise<ShopRecord | null>;
    getActiveAuthorizationScope(input: {
      shopId: string;
      installationGeneration: string;
    }): Promise<ActiveAuthorizationScope | null>;
    lockActiveAuthorizationScope(
      transaction: DurableTransaction,
      input: { shopId: string; installationGeneration: string },
    ): Promise<ActiveAuthorizationScope | null>;
    getActiveProviderScope(input: { shopId: string; installationGeneration: string }): Promise<{
      shopId: string;
      shopDomain: string;
      shopifyShopId: string;
      installationGeneration: string;
    } | null>;
    createShop(
      transaction: DurableTransaction,
      input: { shopId: string; shopDomain: string; shopifyShopId?: string; externalInstallationId?: string },
    ): Promise<ShopRecord>;
    startInstallation(
      transaction: DurableTransaction,
      shopId: string,
      externalInstallationId?: string,
    ): Promise<string>;
    deactivateCurrent(
      transaction: DurableTransaction,
      shopId: string,
      expectedGeneration: string,
    ): Promise<'deactivated' | 'already_inactive' | 'stale'>;
  };
  readonly webhooks: {
    unresolvedBacklogCount(): Promise<number>;
    pendingUninstallIds(limit: number): Promise<string[]>;
    receive(input: VerifiedShopifyDelivery): Promise<ShopifyWebhookReceipt>;
    getById(id: string): Promise<ShopifyWebhookState | null>;
    processUninstall(
      id: string,
    ): Promise<'processed' | 'unverified' | 'already_processed' | 'unresolved' | 'stale' | 'not_found'>;
  };
  readonly credentials: {
    install(input: CredentialIdentity & { pair: ExpiringOfflinePair }): Promise<string>;
    acquire(
      input: CredentialIdentity & { minimumRemainingMs: number; claimLeaseMs: number },
    ): Promise<CredentialAcquire>;
    replaceClaim(input: ClaimIdentity & { pair: ExpiringOfflinePair }): Promise<'replaced' | 'stale' | 'inactive'>;
    releaseClaim(input: ClaimIdentity): Promise<boolean>;
    markReauthRequired(input: ClaimIdentity): Promise<boolean>;
    metadata(input: CredentialIdentity): Promise<
      | {
          shop_id: string;
          installation_generation: string;
          schema_version: number;
          credential_version: string;
          state: 'active' | 'refresh-in-progress' | 'reauth-required' | 'revoked';
          access_expires_at: Date;
          refresh_expires_at: Date;
          scopes: string | null;
          wrapping_key_id: string;
          refresh_claim_until: Date | null;
        }
      | undefined
    >;
  };
  close(): Promise<void>;
}

/** The caller supplies a dedicated pool; no raw database or executor escapes. */
export function createDurableCore(pool: Pool, options: { credentialKeys?: CredentialKeyRing } = {}): DurableCore {
  const database = createDatabase(pool);
  const active = new WeakMap<DurableTransaction, Transaction<Database>>();
  const resolve = (handle: DurableTransaction): Transaction<Database> => {
    const transaction = active.get(handle);
    if (!transaction) throw new TypeError('Durable transaction is invalid or expired');
    return transaction;
  };
  const commands = new PgCommandRepository();
  const acceptedQuotes = new PgAcceptedQuoteRepository(database);
  const inbox = new PgInboxRepository(database);
  const outbox = new PgOutboxRepository(database);
  const configs = createConfigRepository(database);
  const tenants = createTenantRepository(database);
  const webhooks = createShopifyWebhookRepository(database);
  const credentials = createShopCredentialRepository(database, options.credentialKeys);
  return {
    acceptedQuotes: {
      getEffective: (shopId, productId) => acceptedQuotes.getEffective(shopId, productId),
      findCompleted: (input) => acceptedQuotes.findCompleted<AcceptedQuoteResult>(input),
      accept: (input, commit) => acceptedQuotes.accept<AcceptedQuoteResult>(input, commit),
    },
    transactions: {
      run: (work) =>
        database.transaction().execute(async (transaction) => {
          const handle: DurableTransaction = Object.freeze({ [transactionBrand]: true });
          active.set(handle, transaction);
          try {
            return await work(handle);
          } finally {
            active.delete(handle);
          }
        }),
    },
    commands: {
      reserve: async (handle, identity) => commands.reserve(resolve(handle), identity),
      complete: async (handle, identity, resultRef) => commands.complete(resolve(handle), identity, resultRef),
    },
    inbox: {
      receive: (message) => inbox.receive(message),
      lockForProcessing: async (handle, shopId, id) => inbox.lockForProcessing(resolve(handle), shopId, id),
      markProcessed: async (handle, shopId, id) => inbox.markProcessed(resolve(handle), shopId, id),
      recordFailure: (shopId, id, failureClass) => inbox.recordFailure(shopId, id, failureClass),
    },
    outbox: {
      add: async (handle, event) => outbox.add(resolve(handle), event),
      claim: (shopId, now, owner, until, limit) => outbox.claim(shopId, now, owner, until, limit),
      acknowledge: (shopId, id, owner, attempt) => outbox.acknowledge(shopId, id, owner, attempt),
    },
    configs: {
      createConfig: async (handle, input) => createConfigRepository(resolve(handle)).createConfig(input),
      getConfig: (shopId, configId) => configs.getConfig(shopId, configId),
      getConfigInTransaction: async (handle, shopId, configId) =>
        createConfigRepository(resolve(handle)).getConfig(shopId, configId),
      getByProduct: (shopId, productId) => configs.getByProduct(shopId, productId),
      updateDraft: async (handle, input) => createConfigRepository(resolve(handle)).updateDraft(input),
      getRevision: (shopId, revisionId) => configs.getRevision(shopId, revisionId),
      getValidatedPublishedRevision: (shopId, revisionId) => configs.getValidatedPublishedRevision(shopId, revisionId),
    },
    tenants: {
      getShop: (shopId) => tenants.getShop(shopId),
      getActiveAuthorizationScope: (input) => tenants.getActiveAuthorizationScope(input),
      lockActiveAuthorizationScope: (handle, input) =>
        createTenantRepository(resolve(handle)).lockActiveAuthorizationScope(input),
      getActiveProviderScope: (input) => tenants.getActiveProviderScope(input),
      createShop: async (handle, input) => tenants.createShop(resolve(handle), input),
      startInstallation: async (handle, shopId, externalId) =>
        tenants.startInstallation(resolve(handle), shopId, externalId),
      deactivateCurrent: async (handle, shopId, generation) =>
        tenants.deactivateCurrent(resolve(handle), shopId, generation),
    },
    webhooks,
    credentials,
    close: () => database.destroy(),
  };
}
