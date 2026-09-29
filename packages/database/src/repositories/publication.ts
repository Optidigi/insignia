import type { Transaction } from 'kysely';
import type { Database, PublicationStatus } from '../client/database.js';
import { canonicalJson, sha256CanonicalJson } from '../hash/canonical.js';

export interface PublicationOperation {
  shopId: string;
  configId: string;
  operationId: string;
  revisionId: string;
  installationGeneration: string;
  operationSequence: string;
  expectedProjection: unknown;
  expectedProjectionDigest: string;
  observedProjection: unknown | null;
  observedProjectionDigest: string | null;
  status: PublicationStatus;
}

type OperationRow = {
  shop_id: string;
  config_id: string;
  operation_id: string;
  revision_id: string;
  installation_generation: string;
  operation_sequence: string;
  expected_projection: unknown;
  expected_projection_digest: string;
  observed_projection: unknown | null;
  observed_projection_digest: string | null;
  status: PublicationStatus;
};

function mapOperation(row: OperationRow): PublicationOperation {
  return {
    shopId: row.shop_id,
    configId: row.config_id,
    operationId: row.operation_id,
    revisionId: row.revision_id,
    installationGeneration: row.installation_generation,
    operationSequence: row.operation_sequence,
    expectedProjection: row.expected_projection,
    expectedProjectionDigest: row.expected_projection_digest,
    observedProjection: row.observed_projection,
    observedProjectionDigest: row.observed_projection_digest,
    status: row.status,
  };
}

/** All publication mutations lock shop, then config, then operation within one transaction. */
export function createPublicationRepository(transaction: Transaction<Database>) {
  async function lockedOperation(shopId: string, configId: string, operationId: string) {
    const shop = await transaction
      .selectFrom('shops')
      .innerJoin('installation_generations as installation', (join) =>
        join
          .onRef('installation.shop_id', '=', 'shops.shop_id')
          .onRef('installation.generation', '=', 'shops.current_generation'),
      )
      .select(['shops.current_generation', 'installation.deactivated_at'])
      .where('shops.shop_id', '=', shopId)
      .forUpdate('shops')
      .executeTakeFirst();
    const config = await transaction
      .selectFrom('product_configs')
      .select(['publication_sequence', 'effective_operation_id'])
      .where('shop_id', '=', shopId)
      .where('config_id', '=', configId)
      .forUpdate()
      .executeTakeFirst();
    const operation = await transaction
      .selectFrom('publication_operations')
      .selectAll()
      .where('shop_id', '=', shopId)
      .where('config_id', '=', configId)
      .where('operation_id', '=', operationId)
      .forUpdate()
      .executeTakeFirst();
    return { shop, config, operation };
  }

  function isCurrent(locked: Awaited<ReturnType<typeof lockedOperation>>): boolean {
    return Boolean(
      locked.shop &&
        locked.shop.deactivated_at === null &&
        locked.config &&
        locked.operation &&
        locked.operation.installation_generation === locked.shop.current_generation &&
        locked.operation.operation_sequence === locked.config.publication_sequence,
    );
  }

  return {
    async getOperation(shopId: string, configId: string, operationId: string): Promise<PublicationOperation | null> {
      const row = await transaction
        .selectFrom('publication_operations')
        .selectAll()
        .where('shop_id', '=', shopId)
        .where('config_id', '=', configId)
        .where('operation_id', '=', operationId)
        .executeTakeFirst();
      return row ? mapOperation(row) : null;
    },

    async request(input: {
      shopId: string;
      configId: string;
      operationId: string;
      revisionId: string;
      installationGeneration: string;
      expectedProjection: unknown;
    }): Promise<PublicationOperation> {
      const digest = sha256CanonicalJson(input.expectedProjection);
      const shop = await transaction
        .selectFrom('shops')
        .innerJoin('installation_generations as installation', (join) =>
          join
            .onRef('installation.shop_id', '=', 'shops.shop_id')
            .onRef('installation.generation', '=', 'shops.current_generation'),
        )
        .select(['shops.current_generation', 'installation.deactivated_at'])
        .where('shops.shop_id', '=', input.shopId)
        .forUpdate('shops')
        .executeTakeFirstOrThrow();
      if (shop.current_generation !== input.installationGeneration) throw new Error('stale installation generation');
      if (shop.deactivated_at !== null) throw new Error('inactive installation generation');
      const config = await transaction
        .selectFrom('product_configs')
        .select('publication_sequence')
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const revision = await transaction
        .selectFrom('config_revisions')
        .select('revision_id')
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .where('revision_id', '=', input.revisionId)
        .executeTakeFirst();
      if (!revision) throw new Error('revision does not belong to config and shop');
      const sequence = (BigInt(config.publication_sequence) + 1n).toString();
      await transaction
        .updateTable('publication_operations')
        .set({ status: 'superseded', superseded_at: new Date() })
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .where('status', 'in', ['requested', 'acknowledged', 'observed'])
        .execute();
      await transaction
        .updateTable('product_configs')
        .set({ publication_sequence: sequence, updated_at: new Date() })
        .where('shop_id', '=', input.shopId)
        .where('config_id', '=', input.configId)
        .execute();
      const row = await transaction
        .insertInto('publication_operations')
        .values({
          shop_id: input.shopId,
          config_id: input.configId,
          operation_id: input.operationId,
          revision_id: input.revisionId,
          installation_generation: input.installationGeneration,
          operation_sequence: sequence,
          expected_projection: input.expectedProjection,
          expected_projection_digest: digest,
          acknowledged_at: null,
          observed_at: null,
          observed_projection: null,
          observed_projection_digest: null,
          activated_at: null,
          failed_at: null,
          failure_class: null,
          superseded_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return mapOperation(row);
    },

    async acknowledge(shopId: string, configId: string, operationId: string): Promise<'acknowledged' | 'stale'> {
      const locked = await lockedOperation(shopId, configId, operationId);
      if (!isCurrent(locked) || !locked.operation || ['failed', 'superseded'].includes(locked.operation.status))
        return 'stale';
      if (locked.operation.status !== 'requested') return 'acknowledged';
      await transaction
        .updateTable('publication_operations')
        .set({ status: 'acknowledged', acknowledged_at: new Date() })
        .where('shop_id', '=', shopId)
        .where('operation_id', '=', operationId)
        .execute();
      return 'acknowledged';
    },

    async observe(input: {
      shopId: string;
      configId: string;
      operationId: string;
      projection: unknown;
    }): Promise<'observed' | 'mismatch' | 'stale'> {
      const digest = sha256CanonicalJson(input.projection);
      const locked = await lockedOperation(input.shopId, input.configId, input.operationId);
      if (
        !isCurrent(locked) ||
        !locked.operation ||
        ['requested', 'failed', 'superseded'].includes(locked.operation.status)
      )
        return 'stale';
      if (locked.operation.status === 'observed' || locked.operation.status === 'activated') {
        return locked.operation.observed_projection_digest === digest &&
          canonicalJson(locked.operation.observed_projection) === canonicalJson(input.projection)
          ? 'observed'
          : 'mismatch';
      }
      const matches =
        locked.operation.expected_projection_digest === digest &&
        canonicalJson(locked.operation.expected_projection) === canonicalJson(input.projection);
      await transaction
        .updateTable('publication_operations')
        .set({
          status: matches ? 'observed' : 'failed',
          observed_at: new Date(),
          observed_projection: input.projection,
          observed_projection_digest: digest,
          failed_at: matches ? null : new Date(),
          failure_class: matches ? null : 'remote_projection_mismatch',
        })
        .where('shop_id', '=', input.shopId)
        .where('operation_id', '=', input.operationId)
        .execute();
      return matches ? 'observed' : 'mismatch';
    },

    async fail(
      shopId: string,
      configId: string,
      operationId: string,
      failureClass: string,
    ): Promise<'failed' | 'stale'> {
      if (!failureClass || failureClass.length > 128) throw new Error('invalid publication failure class');
      const locked = await lockedOperation(shopId, configId, operationId);
      if (
        !isCurrent(locked) ||
        !locked.operation ||
        locked.operation.status === 'superseded' ||
        locked.operation.status === 'activated'
      )
        return 'stale';
      if (locked.operation.status === 'failed') return 'failed';
      await transaction
        .updateTable('publication_operations')
        .set({ status: 'failed', failed_at: new Date(), failure_class: failureClass })
        .where('shop_id', '=', shopId)
        .where('operation_id', '=', operationId)
        .execute();
      return 'failed';
    },

    async activate(shopId: string, configId: string, operationId: string): Promise<'activated' | 'stale'> {
      const locked = await lockedOperation(shopId, configId, operationId);
      if (!isCurrent(locked) || !locked.operation || !locked.config) return 'stale';
      if (locked.operation.status === 'activated') {
        return locked.config.effective_operation_id === operationId ? 'activated' : 'stale';
      }
      if (
        locked.operation.status !== 'observed' ||
        locked.operation.observed_projection_digest !== locked.operation.expected_projection_digest ||
        canonicalJson(locked.operation.observed_projection) !== canonicalJson(locked.operation.expected_projection)
      )
        return 'stale';
      await transaction
        .updateTable('publication_operations')
        .set({ status: 'activated', activated_at: new Date() })
        .where('shop_id', '=', shopId)
        .where('operation_id', '=', operationId)
        .execute();
      await transaction
        .updateTable('product_configs')
        .set({
          effective_revision_id: locked.operation.revision_id,
          effective_operation_id: operationId,
          updated_at: new Date(),
        })
        .where('shop_id', '=', shopId)
        .where('config_id', '=', configId)
        .execute();
      return 'activated';
    },
  };
}
