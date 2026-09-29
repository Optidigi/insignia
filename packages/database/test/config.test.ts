import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Database } from '../src/client/database.js';
import { withTransaction } from '../src/client/database.js';
import { canonicalJson, revisionContentHash, sha256CanonicalJson } from '../src/hash/canonical.js';
import { createConfigRepository } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
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
    const repository = createConfigRepository(database);
    await repository.createConfig({
      shopId: a.shopId,
      configId: aConfig,
      externalProductId: productId,
      draftSchemaVersion: 'm2-draft-config-v1',
      draftValue: {},
    });
    await repository.createConfig({
      shopId: b.shopId,
      configId: bConfig,
      externalProductId: productId,
      draftSchemaVersion: 'm2-draft-config-v1',
      draftValue: {},
    });
    await expect(
      repository.createConfig({
        shopId: a.shopId,
        configId: randomUUID(),
        externalProductId: productId,
        draftSchemaVersion: 'm2-draft-config-v1',
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
    const repo = createConfigRepository(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: randomUUID(),
      draftSchemaVersion: 'm2-draft-config-v1',
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
          schemaVersion: 'm2-draft-config-v1',
          draftValue: { label: 'first' },
        }),
        createConfigRepository(secondConnection).updateDraft({
          shopId,
          configId,
          expectedVersion: '1',
          schemaVersion: 'm2-draft-config-v1',
          draftValue: { label: 'second' },
        }),
      ]);
      expect(writes.map((write) => write.kind).sort()).toEqual(['conflict', 'updated']);
    } finally {
      await Promise.all([firstConnection.destroy(), secondConnection.destroy()]);
    }
    expect((await repo.getConfig(shopId, configId))?.draftVersion).toBe('2');
  });

  test('draft storage rejects malformed version or non-JSON value', async () => {
    const { shopId } = await createTestShop(database);
    const repo = createConfigRepository(database);
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: 'future version',
        draftValue: {},
      }),
    ).rejects.toThrow('invalid draft schema version');
    await expect(
      repo.createConfig({
        shopId,
        configId: randomUUID(),
        externalProductId: randomUUID(),
        draftSchemaVersion: 'm2-draft-config-v1',
        draftValue: { value: undefined },
      }),
    ).rejects.toThrow('unsupported JSON value');
  });

  test('revision hash is canonical, caller mismatch fails, and SQL mutation is refused', async () => {
    const { shopId } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const revisionId = randomUUID();
    const repo = createConfigRepository(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: 'm2-draft-config-v1',
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
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: randomUUID(),
        schemaVersion: 'm2-published-config-v1',
        publishedValue: { ...value, shopId: randomUUID() },
      }),
    ).rejects.toThrow('published config identity mismatch');
    await expect(
      repo.createRevision({
        shopId,
        configId,
        revisionId: randomUUID(),
        schemaVersion: 'm2-published-config-v1',
        publishedValue: { ...value, productId: randomUUID() },
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

  test('newer publication and reinstall fence delayed activation', async () => {
    const { shopId, generation } = await createTestShop(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const revisionA = randomUUID();
    const revisionB = randomUUID();
    const operationA = randomUUID();
    const operationB = randomUUID();
    const repo = createConfigRepository(database);
    await repo.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: 'm2-draft-config-v1',
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
});

test('canonical JSON sorts object keys and preserves array order', () => {
  expect(canonicalJson({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
  expect(sha256CanonicalJson({ b: [2, 1], a: 1 })).toBe(
    'e9d26fb0100c3f9ef569c38ced9811ec35059c3c999b8683fde59ed24e6e66e8',
  );
  expect(canonicalJson({ b: [1, 2], a: 1 })).not.toBe(canonicalJson({ b: [2, 1], a: 1 }));
});
