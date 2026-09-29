import { newOutboxEvent } from '@insignia/application';
import type { Kysely } from 'kysely';
import type { Database } from '../client/database.js';
import { createConfigRepositoryInternal } from './config.js';
import { PgOutboxRepository } from './delivery/pg-outbox-repository.js';
import { createPublicationRepository } from './publication.js';

/** Internal M3 transaction seam. A reviewed projection builder must precede any production caller. */
export function stagePublicationIntent(
  database: Kysely<Database>,
  input: {
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
  },
) {
  return database.transaction().execute(async (transaction) => {
    const shop = await transaction
      .selectFrom('shops')
      .select('current_generation')
      .where('shop_id', '=', input.shopId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (shop.current_generation !== input.installationGeneration) throw new Error('stale installation generation');
    const config = await transaction
      .selectFrom('product_configs')
      .select('draft_version')
      .where('shop_id', '=', input.shopId)
      .where('config_id', '=', input.configId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (config.draft_version !== input.expectedDraftVersion) throw new Error('draft version conflict');
    const revision = await createConfigRepositoryInternal(transaction).createRevision({
      shopId: input.shopId,
      configId: input.configId,
      revisionId: input.revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: input.publishedValue,
    });
    const operation = await createPublicationRepository(transaction).request({
      shopId: input.shopId,
      configId: input.configId,
      operationId: input.operationId,
      revisionId: input.revisionId,
      installationGeneration: input.installationGeneration,
      expectedProjection: input.expectedProjection,
    });
    const outboxEventId = await new PgOutboxRepository(database).add(
      transaction,
      newOutboxEvent({
        shopId: input.shopId,
        installationGeneration: input.installationGeneration,
        eventType: 'publication.requested',
        schemaVersion: 1,
        aggregateRef: input.configId,
        payload: {
          configId: input.configId,
          revisionId: input.revisionId,
          operationId: input.operationId,
          expectedProjectionDigest: operation.expectedProjectionDigest,
        },
        businessKey: input.operationId,
        occurredAt: input.occurredAt,
        availableAt: input.occurredAt,
        retentionClass: 'publication-intent',
        purgeAfter: input.purgeAfter,
      }),
    );
    return { revision, operation, outboxEventId };
  });
}
