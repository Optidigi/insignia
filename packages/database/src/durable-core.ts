import type { CommandRepository, InboxRepository, OutboxRepository, TransactionRunner } from '@insignia/application';
import type { Transaction } from 'kysely';
import type { Pool } from 'pg';
import { createDatabase, type Database } from './client/database.js';
import { PgCommandRepository } from './repositories/command/pg-command-repository.js';
import { type ConfigRecord, createConfigRepository, type RevisionRecord } from './repositories/config.js';
import { PgInboxRepository } from './repositories/delivery/pg-inbox-repository.js';
import { PgOutboxRepository } from './repositories/delivery/pg-outbox-repository.js';
import type { PublicationOperation } from './repositories/publication.js';
import { stagePublicationIntent } from './repositories/publication-intent.js';
import { createTenantRepository, type ShopRecord } from './repositories/tenant.js';

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
    createShop(
      transaction: DurableTransaction,
      input: { shopId: string; shopDomain: string; externalInstallationId?: string },
    ): Promise<ShopRecord>;
    startInstallation(
      transaction: DurableTransaction,
      shopId: string,
      externalInstallationId?: string,
    ): Promise<string>;
  };
  /** Atomic publication intent has no executor parameter. */
  readonly publication: {
    stageIntent(input: {
      shopId: string;
      configId: string;
      expectedDraftVersion: string;
      revisionId: string;
      operationId: string;
      installationGeneration: string;
      publishedValue: unknown;
      expectedProjection: unknown;
      occurredAt: Date;
      purgeAfter: Date;
    }): Promise<{ revision: RevisionRecord; operation: PublicationOperation; outboxEventId: string }>;
  };
  close(): Promise<void>;
}

/** The caller supplies a dedicated pool; no raw database or executor escapes. */
export function createDurableCore(pool: Pool): DurableCore {
  const database = createDatabase(pool);
  const active = new WeakMap<DurableTransaction, Transaction<Database>>();
  const resolve = (handle: DurableTransaction): Transaction<Database> => {
    const transaction = active.get(handle);
    if (!transaction) throw new TypeError('Durable transaction is invalid or expired');
    return transaction;
  };
  const commands = new PgCommandRepository();
  const inbox = new PgInboxRepository(database);
  const outbox = new PgOutboxRepository(database);
  const configs = createConfigRepository(database);
  const tenants = createTenantRepository(database);
  return {
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
      createShop: async (handle, input) => tenants.createShop(resolve(handle), input),
      startInstallation: async (handle, shopId, externalId) =>
        tenants.startInstallation(resolve(handle), shopId, externalId),
    },
    publication: { stageIntent: (input) => stagePublicationIntent(database, input) },
    close: () => database.destroy(),
  };
}
