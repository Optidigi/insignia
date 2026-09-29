import { PublishedConfigSchema } from '@insignia/contracts';
import { validatePublishedConfig } from '@insignia/domain';
import type { DatabaseExecutor } from '../client/database.js';
import { canonicalJson, revisionContentHash } from '../hash/canonical.js';

export const CONFIG_DRAFT_STORAGE_VERSION = 'm3-config-draft-v1' as const;

function validateDraftStorage(schemaVersion: string, draftValue: unknown): void {
  if (schemaVersion !== CONFIG_DRAFT_STORAGE_VERSION) throw new Error('unsupported draft schema version');
  if (
    draftValue === null ||
    typeof draftValue !== 'object' ||
    Array.isArray(draftValue) ||
    (Object.getPrototypeOf(draftValue) !== Object.prototype && Object.getPrototypeOf(draftValue) !== null)
  )
    throw new Error('draft must be a JSON object');
  // M3 stores incomplete merchant drafts as raw JSON objects; publication validates the M2 DTO.
  canonicalJson(draftValue);
}

export interface ConfigRecord {
  shopId: string;
  configId: string;
  externalProductId: string;
  draftSchemaVersion: string;
  draftValue: unknown;
  draftVersion: string;
  effectiveRevisionId: string | null;
  effectiveOperationId: string | null;
  publicationSequence: string;
}

export interface RevisionRecord {
  shopId: string;
  configId: string;
  revisionId: string;
  schemaVersion: string;
  publishedValue: unknown;
  contentHash: string;
  createdAt: Date;
}

function mapConfig(row: {
  shop_id: string;
  config_id: string;
  external_product_id: string;
  draft_schema_version: string;
  draft_value: unknown;
  draft_version: string;
  effective_revision_id: string | null;
  effective_operation_id: string | null;
  publication_sequence: string;
}): ConfigRecord {
  validateDraftStorage(row.draft_schema_version, row.draft_value);
  return {
    shopId: row.shop_id,
    configId: row.config_id,
    externalProductId: row.external_product_id,
    draftSchemaVersion: row.draft_schema_version,
    draftValue: row.draft_value,
    draftVersion: row.draft_version,
    effectiveRevisionId: row.effective_revision_id,
    effectiveOperationId: row.effective_operation_id,
    publicationSequence: row.publication_sequence,
  };
}

/** Internal revision writer; package consumers receive the read/draft-only facade below. */
export function createConfigRepositoryInternal(executor: DatabaseExecutor) {
  async function getRevision(shopId: string, revisionId: string): Promise<RevisionRecord | null> {
    const row = await executor
      .selectFrom('config_revisions')
      .selectAll()
      .where('shop_id', '=', shopId)
      .where('revision_id', '=', revisionId)
      .executeTakeFirst();
    return row
      ? {
          shopId: row.shop_id,
          configId: row.config_id,
          revisionId: row.revision_id,
          schemaVersion: row.schema_version,
          publishedValue: row.published_value,
          contentHash: row.content_hash,
          createdAt: row.created_at,
        }
      : null;
  }
  return {
    async createConfig(input: {
      shopId: string;
      configId: string;
      externalProductId: string;
      draftSchemaVersion: string;
      draftValue: unknown;
    }): Promise<ConfigRecord> {
      validateDraftStorage(input.draftSchemaVersion, input.draftValue);
      const row = await executor
        .insertInto('product_configs')
        .values({
          shop_id: input.shopId,
          config_id: input.configId,
          external_product_id: input.externalProductId,
          draft_schema_version: input.draftSchemaVersion,
          draft_value: input.draftValue,
          effective_revision_id: null,
          effective_operation_id: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapConfig(row);
    },

    async getConfig(shopId: string, configId: string): Promise<ConfigRecord | null> {
      const row = await executor
        .selectFrom('product_configs')
        .selectAll()
        .where('shop_id', '=', shopId)
        .where('config_id', '=', configId)
        .executeTakeFirst();
      return row ? mapConfig(row) : null;
    },

    async getByProduct(shopId: string, externalProductId: string): Promise<ConfigRecord | null> {
      const row = await executor
        .selectFrom('product_configs')
        .selectAll()
        .where('shop_id', '=', shopId)
        .where('external_product_id', '=', externalProductId)
        .executeTakeFirst();
      return row ? mapConfig(row) : null;
    },

    async updateDraft(input: {
      shopId: string;
      configId: string;
      expectedVersion: string;
      schemaVersion: string;
      draftValue: unknown;
    }): Promise<{ kind: 'updated'; config: ConfigRecord } | { kind: 'conflict' }> {
      validateDraftStorage(input.schemaVersion, input.draftValue);
      const row = await executor
        .updateTable('product_configs')
        .set({
          draft_schema_version: input.schemaVersion,
          draft_value: input.draftValue,
          draft_version: (BigInt(input.expectedVersion) + 1n).toString(),
          updated_at: new Date(),
        })
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .where('draft_version', '=', input.expectedVersion)
        .returningAll()
        .executeTakeFirst();
      return row ? { kind: 'updated', config: mapConfig(row) } : { kind: 'conflict' };
    },

    async createRevision(input: {
      shopId: string;
      configId: string;
      revisionId: string;
      schemaVersion: string;
      publishedValue: unknown;
      expectedContentHash?: string;
      createdByRef?: string;
    }): Promise<RevisionRecord> {
      if (input.schemaVersion !== 'm2-published-config-v1') throw new Error('unsupported published config version');
      const hash = revisionContentHash(input.publishedValue);
      if (input.expectedContentHash !== undefined && input.expectedContentHash !== hash)
        throw new Error('revision content hash mismatch');
      if (
        input.publishedValue !== null &&
        typeof input.publishedValue === 'object' &&
        !Array.isArray(input.publishedValue) &&
        'revisionContentHash' in input.publishedValue &&
        (input.publishedValue as Record<string, unknown>).revisionContentHash !== hash
      )
        throw new Error('revision content hash mismatch');
      let value = input.publishedValue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        value = { ...(value as Record<string, unknown>), revisionContentHash: hash };
      }
      const validated = validatePublishedConfig(PublishedConfigSchema.parse(value));
      if (
        validated.version !== input.schemaVersion ||
        validated.shopId !== input.shopId ||
        validated.revisionId !== input.revisionId
      )
        throw new Error('published config identity mismatch');
      const config = await executor
        .selectFrom('product_configs')
        .select('external_product_id')
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .executeTakeFirst();
      if (!config || config.external_product_id !== validated.productId)
        throw new Error('published product identity mismatch');
      const row = await executor
        .insertInto('config_revisions')
        .values({
          shop_id: input.shopId,
          config_id: input.configId,
          revision_id: input.revisionId,
          schema_version: input.schemaVersion,
          published_value: validated,
          content_hash: hash,
          created_by_ref: input.createdByRef ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return {
        shopId: row.shop_id,
        configId: row.config_id,
        revisionId: row.revision_id,
        schemaVersion: row.schema_version,
        publishedValue: row.published_value,
        contentHash: row.content_hash,
        createdAt: row.created_at,
      };
    },

    getRevision,

    async getValidatedPublishedRevision(shopId: string, revisionId: string) {
      const revision = await getRevision(shopId, revisionId);
      if (!revision) return null;
      if (revision.schemaVersion !== 'm2-published-config-v1') throw new Error('unsupported published config version');
      const value = validatePublishedConfig(PublishedConfigSchema.parse(revision.publishedValue));
      const config = await executor
        .selectFrom('product_configs')
        .select('external_product_id')
        .where('shop_id', '=', shopId)
        .where('config_id', '=', revision.configId)
        .executeTakeFirst();
      if (
        value.shopId !== shopId ||
        value.revisionId !== revisionId ||
        !config ||
        value.productId !== config.external_product_id ||
        value.revisionContentHash !== revision.contentHash ||
        revisionContentHash(value) !== revision.contentHash
      )
        throw new Error('invalid published revision content');
      return { ...revision, publishedValue: value };
    },
  };
}

export function createConfigRepository(executor: DatabaseExecutor) {
  const repository = createConfigRepositoryInternal(executor);
  return {
    createConfig: repository.createConfig,
    getConfig: repository.getConfig,
    getByProduct: repository.getByProduct,
    updateDraft: repository.updateDraft,
    getRevision: repository.getRevision,
    getValidatedPublishedRevision: repository.getValidatedPublishedRevision,
  };
}
