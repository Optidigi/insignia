import type {
  AcceptedQuoteResult,
  CommandRepository,
  EffectiveQuoteRevision,
  InboxRepository,
  OutboxRepository,
  QuoteAcceptanceStore,
  SigningKeyStore,
  TransactionRunner,
} from '@insignia/application';
import { type MerchantPresentation, MerchantPresentationSchema } from '@insignia/contracts';
import { type GeometryV1, validateGeometry, validateGeometryBridge } from '@insignia/visualizer/geometry';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Pool } from 'pg';
import { createDatabase, type Database, type DatabaseExecutor } from './client/database.js';
import type { CredentialKeyRing } from './credentials/envelope.js';
import { sha256CanonicalJson } from './hash/canonical.js';
import { PgAcceptedQuoteRepository } from './repositories/accepted-quote.js';
import { PgCommandRepository } from './repositories/command/pg-command-repository.js';
import {
  type ConfigRecord,
  createConfigRepository,
  createConfigRepositoryInternal,
  type RevisionRecord,
} from './repositories/config.js';
import { PgInboxRepository } from './repositories/delivery/pg-inbox-repository.js';
import { PgOutboxRepository } from './repositories/delivery/pg-outbox-repository.js';
import { createProductionActivation, type ProductionActivationOptions } from './repositories/production-activation.js';
import { PgProductionPublication, type ProductionPublicationRemote } from './repositories/production-publication.js';
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
import { PgSigningKeyRepository } from './repositories/signing-keys.js';
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
  readonly signingKeys: SigningKeyStore;
  readonly productionPublications: {
    create(input: {
      appId: string;
      remote: ProductionPublicationRemote;
    }): Pick<PgProductionPublication, 'prepare' | 'advance'>;
  };
  readonly productionActivations: {
    create(options: ProductionActivationOptions): ReturnType<typeof createProductionActivation>;
  };
  readonly acceptedQuotes: QuoteAcceptanceStore & {
    getEffective(shopId: string, productId: string): Promise<EffectiveQuoteRevision | null>;
  };
  readonly transactions: TransactionRunner<DurableTransaction>;
  readonly commands: CommandRepository<DurableTransaction> & {
    lookup(identity: { shopId: string; namespace: string; key: string }): Promise<{
      requestDigest: string;
      status: string;
      resultRef: string | null;
    } | null>;
  };
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
    getConfigForUpdate(transaction: DurableTransaction, shopId: string, configId: string): Promise<ConfigRecord | null>;
    getByProduct(shopId: string, productId: string): Promise<ConfigRecord | null>;
    getByProductForUpdate(
      transaction: DurableTransaction,
      shopId: string,
      productId: string,
    ): Promise<ConfigRecord | null>;
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
    createValidatedRevision(
      transaction: DurableTransaction,
      input: {
        shopId: string;
        configId: string;
        revisionId: string;
        publishedValue: unknown;
        geometry: { version: string; value: unknown };
        presentation: unknown;
        sourceDraftVersion: string;
        sourceInstallationGeneration: string;
        mode: 'required' | 'optional';
        createdByRef: string;
      },
    ): Promise<RevisionRecord>;
    getRevisionGeometry(
      shopId: string,
      revisionId: string,
    ): Promise<{
      version: string;
      value: unknown;
      contentHash: string;
      mode: 'required' | 'optional';
    } | null>;
    getRevisionPresentation(shopId: string, revisionId: string): Promise<MerchantPresentation | null>;
    getRevisionSourceScope(
      shopId: string,
      revisionId: string,
    ): Promise<{ draftVersion: string; installationGeneration: string } | null>;
    getCurrentPublication(
      shopId: string,
      configId: string,
    ): Promise<{
      operationId: string;
      revisionId: string;
      phase: string;
      sourceDraftVersion: string | null;
      requestKey: string | null;
      mode: 'required' | 'optional';
      priorMode: 'required' | 'optional' | null;
      status: string;
      activationKind: string | null;
    } | null>;
    getAvailabilityRecovery(
      shopId: string,
      configId: string,
    ): Promise<{ operationId: string; kind: string; installationGeneration: string } | null>;
    getCurrentPublicationInTransaction(
      transaction: DurableTransaction,
      shopId: string,
      configId: string,
    ): ReturnType<DurableCore['configs']['getCurrentPublication']>;
    setCurrentPublicationPointer(
      transaction: DurableTransaction,
      input: {
        shopId: string;
        configId: string;
        revisionId: string;
        installationGeneration: string;
        sourceDraftVersion: string;
        idempotencyKey: string;
      },
    ): Promise<void>;
  };
  readonly tenants: {
    getShop(shopId: string): Promise<ShopRecord | null>;
    getShopByDomain(shopDomain: string): Promise<ShopRecord | null>;
    getCurrentAdminInstallation(shopId: string): Promise<{
      generation: string;
      externalInstallationId: string | null;
      active: boolean;
    } | null>;
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
  const signingKeys = new PgSigningKeyRepository(database);
  const inbox = new PgInboxRepository(database);
  const outbox = new PgOutboxRepository(database);
  const configs = createConfigRepository(database);
  const tenants = createTenantRepository(database);
  const webhooks = createShopifyWebhookRepository(database);
  const credentials = createShopCredentialRepository(database, options.credentialKeys);
  async function currentPublication(executor: DatabaseExecutor, shopId: string, configId: string) {
    const pointer = await sql<{
      revision_id: string;
      source_draft_version: string;
      idempotency_key: string;
      mode: 'required' | 'optional';
      operation_id: string | null;
      phase: string | null;
      prior_mode: 'required' | 'optional' | null;
      status: string | null;
      activation_kind: string | null;
    }>`SELECT pointer.revision_id, pointer.source_draft_version::text,
        pointer.idempotency_key, geometry.mode, operation.operation_id,
        progress.phase, progress.prior_mode, operation.status, activation.kind AS activation_kind
      FROM m5_current_publication_pointer pointer
      JOIN shops shop ON shop.shop_id=pointer.shop_id
        AND shop.current_generation=pointer.installation_generation
      JOIN config_revision_geometry geometry
        ON geometry.shop_id=pointer.shop_id AND geometry.config_id=pointer.config_id
        AND geometry.revision_id=pointer.revision_id
      LEFT JOIN publication_operations operation
        ON operation.shop_id=pointer.shop_id AND operation.config_id=pointer.config_id
        AND operation.operation_id=pointer.revision_id AND operation.revision_id=pointer.revision_id
      LEFT JOIN m4_publication_progress progress
        ON progress.shop_id=operation.shop_id AND progress.config_id=operation.config_id
        AND progress.operation_id=operation.operation_id
      LEFT JOIN m5_activation_state activation
        ON activation.shop_id=operation.shop_id AND activation.config_id=operation.config_id
        AND activation.operation_id=operation.operation_id
      WHERE pointer.shop_id=${shopId} AND pointer.config_id=${configId}`.execute(executor);
    const selected = pointer.rows[0];
    if (selected) {
      if (selected.operation_id && !selected.phase) throw new Error('Publication progress missing');
      return {
        operationId: selected.revision_id,
        revisionId: selected.revision_id,
        phase: selected.phase ?? 'intent',
        sourceDraftVersion: selected.source_draft_version,
        requestKey: selected.idempotency_key,
        mode: selected.mode,
        priorMode: selected.prior_mode,
        status: selected.status ?? 'intent',
        activationKind: selected.activation_kind,
      };
    }
    const historical = await sql<{
      operation_id: string;
      revision_id: string;
      phase: string;
      mode: 'required' | 'optional';
      prior_mode: 'required' | 'optional' | null;
      status: string;
      activation_kind: string | null;
      source_draft_version: string | null;
    }>`SELECT operation.operation_id, operation.revision_id,
        progress.phase, progress.mode, progress.prior_mode, operation.status, activation.kind AS activation_kind,
        presentation.source_draft_version::text
      FROM publication_operations operation
      JOIN m4_publication_progress progress
        ON progress.shop_id=operation.shop_id AND progress.config_id=operation.config_id
        AND progress.operation_id=operation.operation_id
      LEFT JOIN config_revision_presentation presentation
        ON presentation.shop_id=operation.shop_id AND presentation.config_id=operation.config_id
        AND presentation.revision_id=operation.revision_id
      LEFT JOIN m5_activation_state activation
        ON activation.shop_id=operation.shop_id AND activation.config_id=operation.config_id
        AND activation.operation_id=operation.operation_id
      WHERE operation.shop_id=${shopId} AND operation.config_id=${configId}
        AND operation.installation_generation=(
          SELECT current_generation FROM shops WHERE shop_id=${shopId})
      AND (operation.availability_resolved_at IS NULL OR operation.status='activated')
      ORDER BY operation.operation_sequence DESC LIMIT 1`.execute(executor);
    const row = historical.rows[0];
    return row
      ? {
          operationId: row.operation_id,
          revisionId: row.revision_id,
          phase: row.phase,
          sourceDraftVersion: row.source_draft_version,
          requestKey: null,
          mode: row.mode,
          priorMode: row.prior_mode,
          status: row.status,
          activationKind: row.activation_kind,
        }
      : null;
  }
  return {
    signingKeys,
    productionPublications: {
      create: ({ appId, remote }) => {
        // First publication and mode changes use productionActivations' durable owned hold.
        // Extra runtime properties cannot supply admission to this fail-closed facade.
        const publication = new PgProductionPublication(database, remote, appId);
        return {
          prepare: publication.prepare.bind(publication),
          advance: publication.advance.bind(publication),
        };
      },
    },
    productionActivations: { create: (options) => createProductionActivation(database, options) },
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
      lookup: async (identity) => {
        const row = await database
          .selectFrom('idempotency_records')
          .select(['request_digest', 'status', 'result_ref'])
          .where('shop_id', '=', identity.shopId)
          .where('namespace', '=', identity.namespace)
          .where('idempotency_key', '=', identity.key)
          .executeTakeFirst();
        return row ? { requestDigest: row.request_digest, status: row.status, resultRef: row.result_ref } : null;
      },
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
      getConfigForUpdate: async (handle, shopId, configId) =>
        createConfigRepositoryInternal(resolve(handle)).getConfigForUpdate(shopId, configId),
      getByProduct: (shopId, productId) => configs.getByProduct(shopId, productId),
      getByProductForUpdate: async (handle, shopId, productId) =>
        createConfigRepositoryInternal(resolve(handle)).getByProductForUpdate(shopId, productId),
      updateDraft: async (handle, input) => createConfigRepository(resolve(handle)).updateDraft(input),
      getRevision: (shopId, revisionId) => configs.getRevision(shopId, revisionId),
      getValidatedPublishedRevision: (shopId, revisionId) => configs.getValidatedPublishedRevision(shopId, revisionId),
      createValidatedRevision: async (handle, input) => {
        if (
          input.geometry.version !== 'm5-geometry-v1' ||
          !input.createdByRef ||
          !/^[1-9][0-9]*$/.test(input.sourceDraftVersion) ||
          !/^[1-9][0-9]*$/.test(input.sourceInstallationGeneration) ||
          (input.mode !== 'required' && input.mode !== 'optional')
        )
          throw new Error('Revision geometry, mode and actor required');
        const tx = resolve(handle);
        const revision = await createConfigRepositoryInternal(tx).createRevision({
          shopId: input.shopId,
          configId: input.configId,
          revisionId: input.revisionId,
          schemaVersion: 'm2-published-config-v1',
          publishedValue: input.publishedValue,
          createdByRef: input.createdByRef,
        });
        validateGeometryBridge(
          input.geometry.value as GeometryV1,
          revision.publishedValue as Parameters<typeof validateGeometryBridge>[1],
        );
        const presentation = MerchantPresentationSchema.parse(input.presentation);
        const published = revision.publishedValue as {
          methods: { id: string }[];
          placements: { id: string }[];
          productionOptions: { id: string; allowedValueIds: string[] }[];
          pricingRules: { id: string }[];
        };
        const geometry = input.geometry.value as GeometryV1;
        const references = {
          methods: published.methods.map((item) => item.id),
          placements: published.placements.map((item) => item.id),
          steps: geometry.steps.map((item) => item.id),
          views: geometry.views.map((item) => item.id),
          options: published.productionOptions.map((item) => item.id),
          prices: published.pricingRules.map((item) => item.id),
        };
        for (const kind of Object.keys(references) as (keyof typeof references)[])
          if (Object.keys(presentation.labels[kind] ?? {}).some((id) => !references[kind].includes(id)))
            throw new Error('Presentation label references an unknown choice');
        for (const [optionId, valueLabels] of Object.entries(presentation.labels.values ?? {})) {
          const option = published.productionOptions.find((item) => item.id === optionId);
          if (!option || Object.keys(valueLabels).some((id) => !option.allowedValueIds.includes(id)))
            throw new Error('Presentation value label references an unknown choice');
        }
        await sql`INSERT INTO config_revision_geometry
          (shop_id, config_id, revision_id, schema_version, mode, geometry_value, content_hash)
          VALUES (${input.shopId}, ${input.configId}, ${input.revisionId}, ${input.geometry.version}, ${input.mode},
            ${JSON.stringify(input.geometry.value)}::jsonb, ${sha256CanonicalJson(input.geometry.value)})`.execute(tx);
        await sql`INSERT INTO config_revision_presentation
          (shop_id, config_id, revision_id, schema_version, presentation_value, content_hash,
            source_draft_version, source_installation_generation)
          VALUES (${input.shopId}, ${input.configId}, ${input.revisionId}, ${presentation.version},
            ${JSON.stringify(presentation)}::jsonb, ${sha256CanonicalJson(presentation)},
            ${input.sourceDraftVersion}::bigint, ${input.sourceInstallationGeneration}::bigint)`.execute(tx);
        return revision;
      },
      getRevisionGeometry: async (shopId, revisionId) => {
        const rows = await sql<{
          schema_version: string;
          mode: 'required' | 'optional';
          geometry_value: unknown;
          content_hash: string;
        }>`
          SELECT schema_version, mode, geometry_value, content_hash FROM config_revision_geometry
          WHERE shop_id=${shopId} AND revision_id=${revisionId}`.execute(database);
        const row = rows.rows[0];
        if (!row) return null;
        if (sha256CanonicalJson(row.geometry_value) !== row.content_hash)
          throw new Error('Revision geometry hash mismatch');
        if (row.schema_version !== 'm5-geometry-v1') throw new Error('Unsupported revision geometry version');
        validateGeometry(row.geometry_value as GeometryV1);
        const revision = await configs.getValidatedPublishedRevision(shopId, revisionId);
        if (!revision) throw new Error('Revision geometry lacks published revision');
        validateGeometryBridge(
          row.geometry_value as GeometryV1,
          revision.publishedValue as Parameters<typeof validateGeometryBridge>[1],
        );
        return {
          version: row.schema_version,
          value: row.geometry_value,
          contentHash: row.content_hash,
          mode: row.mode,
        };
      },
      getRevisionPresentation: async (shopId, revisionId) => {
        const rows = await sql<{ schema_version: string; presentation_value: unknown; content_hash: string }>`
          SELECT schema_version, presentation_value, content_hash FROM config_revision_presentation
          WHERE shop_id=${shopId} AND revision_id=${revisionId}`.execute(database);
        const row = rows.rows[0];
        if (!row) return null;
        if (
          row.schema_version !== 'm5-presentation-v1' ||
          sha256CanonicalJson(row.presentation_value) !== row.content_hash
        )
          throw new Error('Revision presentation mismatch');
        return MerchantPresentationSchema.parse(row.presentation_value);
      },
      getRevisionSourceScope: async (shopId, revisionId) => {
        const rows = await sql<{ draft_version: string; installation_generation: string }>`
          SELECT source_draft_version::text AS draft_version,
            source_installation_generation::text AS installation_generation
          FROM config_revision_presentation
          WHERE shop_id=${shopId} AND revision_id=${revisionId}
            AND source_draft_version IS NOT NULL AND source_installation_generation IS NOT NULL`.execute(database);
        return rows.rows[0]
          ? { draftVersion: rows.rows[0].draft_version, installationGeneration: rows.rows[0].installation_generation }
          : null;
      },
      getAvailabilityRecovery: async (shopId, configId) => {
        // An owned hold survives reinstall/supersession; never hide it behind the new generation's pointer.
        const rows = await sql<{ operation_id: string; kind: string; installation_generation: string }>`
          SELECT state.operation_id, state.kind, operation.installation_generation::text
          FROM m5_activation_state state JOIN publication_operations operation USING (shop_id, config_id, operation_id)
          WHERE state.shop_id=${shopId} AND state.config_id=${configId}
            AND state.hold IS NOT NULL AND state.kind NOT IN ('RESTORED','RESOLVED') LIMIT 1`.execute(database);
        const row = rows.rows[0];
        return row
          ? { operationId: row.operation_id, kind: row.kind, installationGeneration: row.installation_generation }
          : null;
      },
      getCurrentPublication: (shopId, configId) => currentPublication(database, shopId, configId),
      getCurrentPublicationInTransaction: async (handle, shopId, configId) =>
        currentPublication(resolve(handle), shopId, configId),
      setCurrentPublicationPointer: async (handle, input) => {
        await sql`INSERT INTO m5_current_publication_pointer
          (shop_id, config_id, revision_id, installation_generation, source_draft_version, idempotency_key)
          VALUES (${input.shopId}, ${input.configId}, ${input.revisionId},
            ${input.installationGeneration}::bigint, ${input.sourceDraftVersion}::bigint, ${input.idempotencyKey})
          ON CONFLICT (shop_id, config_id) DO UPDATE SET
            revision_id=EXCLUDED.revision_id,
            installation_generation=EXCLUDED.installation_generation,
            source_draft_version=EXCLUDED.source_draft_version,
            idempotency_key=EXCLUDED.idempotency_key,
            updated_at=now()`.execute(resolve(handle));
      },
    },
    tenants: {
      getShop: (shopId) => tenants.getShop(shopId),
      getShopByDomain: (shopDomain) => tenants.getShopByDomain(shopDomain),
      getCurrentAdminInstallation: (shopId) => tenants.getCurrentAdminInstallation(shopId),
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
