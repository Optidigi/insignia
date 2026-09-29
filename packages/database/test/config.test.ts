import { randomUUID } from 'node:crypto';
import { newOutboxEvent } from '@insignia/application';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Database } from '../src/client/database.js';
import { withTransaction } from '../src/client/database.js';
import { canonicalJson, revisionContentHash, sha256CanonicalJson } from '../src/hash/canonical.js';
import {
  CONFIG_DRAFT_STORAGE_VERSION,
  createConfigRepository,
  createConfigRepositoryInternal,
} from '../src/repositories/config.js';
import { PgOutboxRepository } from '../src/repositories/delivery/pg-outbox-repository.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { stagePublicationIntent } from '../src/repositories/publication-intent.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

function published(shopId: string, productId: string, revisionId: string) {
  return {
    version: 'm2-published-config-v1',
    shopId,
    productId,
    revisionId,
    shopCurrency: 'USD',
    methods: [],
    placements: [],
    productionOptions: [],
    pricingRules: [],
  };
}

describe.runIf(Boolean(process.env.DATABASE_URL))('PostgreSQL tenant and publication persistence', () => {
  let database: Kysely<Database>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });

  test("two shops can own the same product but cannot read or link each other's records", async () => {
    const a = await createTestShop(database);
    const b = await createTestShop(database);
    const productId = randomUUID();
    const aConfig = randomUUID();
    const bConfig = randomUUID();
    const revisionId = randomUUID();
    const repository = createConfigRepositoryInternal(database);
    expect('createRevision' in createConfigRepository(database)).toBe(false);
    await repository.createConfig({
      shopId: a.shopId,
      configId: aConfig,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    await repository.createConfig({
      shopId: b.shopId,
      configId: bConfig,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    await expect(
      repository.createConfig({
        shopId: a.shopId,
        configId: randomUUID(),
        externalProductId: productId,
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: {},
      }),
    ).rejects.toThrow();
    const revision = await repository.createRevision({
      shopId: b.shopId,
      configId: bConfig,
      revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: published(b.shopId, productId, revisionId),
    });
    expect(revision.publishedValue).toMatchObject({ revisionContentHash: revision.contentHash });
    expect(await repository.getConfig(a.shopId, bConfig)).toBeNull();
    expect(await repository.getRevision(a.shopId, revisionId)).toBeNull();
    await expect(
      sql`INSERT INTO publication_operations (
      shop_id, config_id, operation_id, revision_id, installation_generation, operation_sequence,
      expected_projection, expected_projection_digest
    ) VALUES (${a.shopId}, ${aConfig}, ${randomUUID()}, ${revisionId}, 1, 1, '{}'::jsonb, ${'0'.repeat(64)})`.execute(
        database,
      ),
    ).rejects.toThrow();
  });

  test('independent connections racing one draft version produce one conflict', async () => {
    const { shopId } = await createTestShop(database);
    const configId = randomUUID();
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: randomUUID(),
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: { label: 'start' },
    });
    const firstConnection = await openTestDatabase();
    const secondConnection = await openTestDatabase();
    try {
      const writes = await Promise.all([
        createConfigRepository(firstConnection).updateDraft({
          shopId,
          configId,
          expectedVersion: '1',
          schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: { label: 'first' },
        }),
        createConfigRepository(secondConnection).updateDraft({
          shopId,
          configId,
          expectedVersion: '1',
          schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: { label: 'second' },
        }),
      ]);
      expect(writes.map((write) => write.kind).sort()).toEqual(['conflict', 'updated']);
    } finally {
      await Promise.all([firstConnection.destroy(), secondConnection.destroy()]);
    }
    expect((await repo.getConfig(shopId, configId))?.draftVersion).toBe('2');
  });

  test('draft storage accepts only M3 versioned JSON objects on write and read', async () => {
    const { shopId } = await createTestShop(database);
    const repo = createConfigRepositoryInternal(database);
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: 'm4-config-draft-v1',
        draftValue: {},
      }),
    ).rejects.toThrow('unsupported draft schema version');
    for (const invalid of [[], null, 'text', 1]) {
      await expect(
        repo.createConfig({
          shopId,
          configId: randomUUID(),
          externalProductId: randomUUID(),
          draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
          draftValue: invalid,
        }),
      ).rejects.toThrow('draft must be a JSON object');
    }
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: { value: undefined },
      }),
    ).rejects.toThrow('unsupported JSON value');
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: { nested: [1, undefined] },
      }),
    ).rejects.toThrow('unsupported JSON value');
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: { nested: new Array(1) },
      }),
    ).rejects.toThrow('sparse JSON array');
    const configId = randomUUID();
    const productId = randomUUID();
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    await expect(
      repo.updateDraft({ shopId, configId, expectedVersion: '1', schemaVersion: 'm4-config-draft-v1', draftValue: {} }),
    ).rejects.toThrow('unsupported draft schema version');
    await expect(
      repo.updateDraft({
        shopId,
        configId,
        expectedVersion: '1',
        schemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
        draftValue: [],
      }),
    ).rejects.toThrow('draft must be a JSON object');
    await sql`UPDATE product_configs SET draft_schema_version = 'm4-config-draft-v1' WHERE shop_id = ${shopId} AND config_id = ${configId}`.execute(
      database,
    );
    await expect(repo.getConfig(shopId, configId)).rejects.toThrow('unsupported draft schema version');
    await sql`UPDATE product_configs SET draft_schema_version = ${CONFIG_DRAFT_STORAGE_VERSION}, draft_value = '[]'::jsonb WHERE shop_id = ${shopId} AND config_id = ${configId}`.execute(
      database,
    );
    await expect(repo.getByProduct(shopId, productId)).rejects.toThrow('draft must be a JSON object');
  });

  test('revision hash is canonical, caller mismatch fails, and SQL mutation is refused', async () => {
    const { shopId } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const revisionId = randomUUID();
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    const value = published(shopId, productId, revisionId);
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: value,
        expectedContentHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('revision content hash mismatch');
    const revision = await repo.createRevision({
      shopId,
      configId,
      revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: value,
    });
    expect(revision.contentHash).toBe(revisionContentHash({ ...value, revisionContentHash: revision.contentHash }));
    await expect(
      sql`UPDATE config_revisions SET content_hash = ${'1'.repeat(64)} WHERE shop_id = ${shopId} AND revision_id = ${revisionId}`.execute(
        database,
      ),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM config_revisions WHERE shop_id = ${shopId} AND revision_id = ${revisionId}`.execute(database),
    ).rejects.toThrow();
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: randomUUID(),
        schemaVersion: 'future',
        publishedValue: value,
      }),
    ).rejects.toThrow('unsupported published config version');
    const duplicateMethodRevisionId = randomUUID();
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: duplicateMethodRevisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: {
          ...published(shopId, productId, duplicateMethodRevisionId),
          methods: [{ id: 'same' }, { id: 'same' }],
        },
      }),
    ).rejects.toThrow('duplicate method ID');
    expect(await repo.getRevision(shopId, duplicateMethodRevisionId)).toBeNull();
    const wrongShopRevisionId = randomUUID();
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: wrongShopRevisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: { ...value, shopId: randomUUID(), revisionId: wrongShopRevisionId },
      }),
    ).rejects.toThrow('published config identity mismatch');
    const wrongProductRevisionId = randomUUID();
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: wrongProductRevisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: { ...value, productId: randomUUID(), revisionId: wrongProductRevisionId },
      }),
    ).rejects.toThrow('published product identity mismatch');
    const futureRevisionId = randomUUID();
    await sql`INSERT INTO config_revisions (shop_id, config_id, revision_id, schema_version, published_value, content_hash)
      VALUES (${shopId}, ${configId}, ${futureRevisionId}, 'future-v2', '{}'::jsonb, ${'0'.repeat(64)})`.execute(
      database,
    );
    await expect(repo.getValidatedPublishedRevision(shopId, futureRevisionId)).rejects.toThrow(
      'unsupported published config version',
    );
  });

  test('publication intent commits revision, journal and outbox together after draft CAS', async () => {
    const { shopId, generation } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + 60_000);
    const revisionId = randomUUID();
    const operationId = randomUUID();
    const input = {
      shopId,
      configId,
      expectedDraftVersion: '1',
      revisionId,
      operationId,
      installationGeneration: generation,
      publishedValue: published(shopId, productId, revisionId),
      expectedProjection: { policy: 'optional', readiness: 'ready' },
      occurredAt: now,
      purgeAfter,
    };
    await expect(stagePublicationIntent(database, { ...input, expectedDraftVersion: '0' })).rejects.toThrow(
      'draft version conflict',
    );
    expect(await repo.getRevision(shopId, revisionId)).toBeNull();

    const collisionOperationId = randomUUID();
    await withTransaction(database, async (transaction) => {
      await new PgOutboxRepository(database).add(
        transaction,
        newOutboxEvent({
          shopId,
          installationGeneration: generation,
          eventType: 'publication.requested',
          schemaVersion: 1,
          aggregateRef: 'another-config',
          payload: { test: true },
          businessKey: collisionOperationId,
          occurredAt: now,
          availableAt: now,
          retentionClass: 'publication-intent',
          purgeAfter,
        }),
      );
    });
    const rolledBackRevision = randomUUID();
    await expect(
      stagePublicationIntent(database, {
        ...input,
        revisionId: rolledBackRevision,
        operationId: collisionOperationId,
        publishedValue: published(shopId, productId, rolledBackRevision),
      }),
    ).rejects.toThrow('Outbox business key conflicts');
    expect(await repo.getRevision(shopId, rolledBackRevision)).toBeNull();
    expect(
      await database
        .selectFrom('publication_operations')
        .select('operation_id')
        .where('shop_id', '=', shopId)
        .where('operation_id', '=', collisionOperationId)
        .executeTakeFirst(),
    ).toBeUndefined();
    expect((await repo.getConfig(shopId, configId))?.publicationSequence).toBe('0');

    const staged = await stagePublicationIntent(database, input);
    expect(staged.revision.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(staged.operation.operationSequence).toBe('1');
    const persisted = await database
      .selectFrom('outbox_events')
      .select(['id', 'installation_generation', 'business_key', 'payload'])
      .where('shop_id', '=', shopId)
      .where('id', '=', staged.outboxEventId)
      .executeTakeFirstOrThrow();
    expect(persisted.installation_generation).toBe(generation);
    expect(persisted.business_key).toBe(operationId);
    expect(persisted.payload).toMatchObject({
      configId,
      revisionId,
      operationId,
      expectedProjectionDigest: staged.operation.expectedProjectionDigest,
    });
    expect((await repo.getConfig(shopId, configId))?.effectiveRevisionId).toBeNull();
  });

  test('newer publication and reinstall fence delayed activation', async () => {
    const { shopId, generation } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const revisionA = randomUUID();
    const revisionB = randomUUID();
    const operationA = randomUUID();
    const operationB = randomUUID();
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    for (const revisionId of [revisionA, revisionB]) {
      await repo.createRevision({
        shopId,
        configId,
        revisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: published(shopId, productId, revisionId),
      });
    }
    const projectionA = { policy: 'optional', readiness: 'ready' };
    const projectionB = { policy: 'required', readiness: 'ready' };
    await withTransaction(database, async (tx) => {
      await createPublicationRepository(tx).request({
        shopId,
        configId,
        operationId: operationA,
        revisionId: revisionA,
        installationGeneration: generation,
        expectedProjection: projectionA,
      });
    });
    await withTransaction(database, async (tx) => {
      await createPublicationRepository(tx).request({
        shopId,
        configId,
        operationId: operationB,
        revisionId: revisionB,
        installationGeneration: generation,
        expectedProjection: projectionB,
      });
    });
    await withTransaction(database, async (tx) => {
      const publication = createPublicationRepository(tx);
      expect(await publication.acknowledge(shopId, configId, operationA)).toBe('stale');
      expect(await publication.activate(shopId, configId, operationA)).toBe('stale');
      expect(await publication.acknowledge(shopId, configId, operationB)).toBe('acknowledged');
      expect(await publication.observe({ shopId, configId, operationId: operationB, projection: projectionB })).toBe(
        'observed',
      );
      expect(await publication.activate(shopId, configId, operationB)).toBe('activated');
      expect(await publication.activate(shopId, configId, operationB)).toBe('activated');
    });
    expect((await repo.getConfig(shopId, configId))?.effectiveRevisionId).toBe(revisionB);
    await expect(
      sql`UPDATE product_configs SET effective_revision_id = ${revisionA}, effective_operation_id = ${operationA} WHERE shop_id = ${shopId} AND config_id = ${configId}`.execute(
        database,
      ),
    ).rejects.toThrow();
    await withTransaction(database, async (tx) => {
      expect(await createTenantRepository(tx).startInstallation(tx, shopId)).toBe('2');
    });
    expect((await repo.getConfig(shopId, configId))?.effectiveRevisionId).toBeNull();
    await withTransaction(database, async (tx) => {
      expect(await createPublicationRepository(tx).activate(shopId, configId, operationB)).toBe('stale');
    });
  });

  test('an already activated older operation cannot be restored by rewinding sequence and pointers', async () => {
    const { shopId, generation } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const repo = createConfigRepositoryInternal(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    const rows = [
      { revisionId: randomUUID(), operationId: randomUUID(), projection: { policy: 'optional' } },
      { revisionId: randomUUID(), operationId: randomUUID(), projection: { policy: 'required' } },
    ];
    for (const row of rows) {
      await repo.createRevision({
        shopId,
        configId,
        revisionId: row.revisionId,
        schemaVersion: 'm2-published-config-v1',
        publishedValue: published(shopId, productId, row.revisionId),
      });
      await withTransaction(database, async (transaction) => {
        const publication = createPublicationRepository(transaction);
        await publication.request({
          shopId,
          configId,
          operationId: row.operationId,
          revisionId: row.revisionId,
          installationGeneration: generation,
          expectedProjection: row.projection,
        });
        expect(await publication.acknowledge(shopId, configId, row.operationId)).toBe('acknowledged');
        expect(
          await publication.observe({ shopId, configId, operationId: row.operationId, projection: row.projection }),
        ).toBe('observed');
        expect(await publication.activate(shopId, configId, row.operationId)).toBe('activated');
      });
    }
    const older = rows[0];
    const newer = rows[1];
    if (!older || !newer) throw new Error('missing test operations');
    expect((await repo.getConfig(shopId, configId))?.effectiveOperationId).toBe(newer.operationId);
    await expect(
      sql`UPDATE product_configs SET publication_sequence = 1, effective_revision_id = ${older.revisionId}, effective_operation_id = ${older.operationId} WHERE shop_id = ${shopId} AND config_id = ${configId}`.execute(
        database,
      ),
    ).rejects.toThrow('publication sequence cannot decrease');
    expect((await repo.getConfig(shopId, configId))?.effectiveOperationId).toBe(newer.operationId);
  });
});

test('canonical JSON sorts object keys and preserves array order', () => {
  expect(canonicalJson({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
  expect(sha256CanonicalJson({ b: [2, 1], a: 1 })).toBe(
    'e9d26fb0100c3f9ef569c38ced9811ec35059c3c999b8683fde59ed24e6e66e8',
  );
  expect(canonicalJson({ b: [1, 2], a: 1 })).not.toBe(canonicalJson({ b: [2, 1], a: 1 }));
});

test('canonical JSON rejects properties that would be silently omitted', () => {
  const hidden = Object.defineProperty({ visible: 1 }, 'hidden', { value: 2 });
  expect(() => canonicalJson(hidden)).toThrow('unsupported JSON object property');
  expect(() => canonicalJson({ [Symbol('hidden')]: 2 })).toThrow('unsupported JSON object property');
});
