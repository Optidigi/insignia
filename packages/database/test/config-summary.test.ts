import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Database } from '../src/client/database.js';
import { withTransaction } from '../src/client/database.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { hasPublishedConfig, readConfigSummaries } from '../src/repositories/config-summary.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

let nextProduct = 700_000 + Math.floor(Math.random() * 100_000);
const productNumber = () => String(nextProduct++);

describe.runIf(Boolean(process.env.DATABASE_URL))('database-only published-product fact', () => {
  let database: Kysely<Database>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });

  async function draftConfig(shop: { shopId: string }, productId = productNumber()) {
    const configId = randomUUID();
    await createConfigRepositoryInternal(database).createConfig({
      shopId: shop.shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    return { configId, productId };
  }
  async function activate(shop: { shopId: string; generation: string }, configId: string, productId: string) {
    const revisionId = randomUUID();
    const operationId = randomUUID();
    await createConfigRepositoryInternal(database).createRevision({
      shopId: shop.shopId,
      configId,
      revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: {
        version: 'm2-published-config-v1',
        shopId: shop.shopId,
        productId,
        revisionId,
        shopCurrency: 'USD',
        methods: [],
        placements: [],
        productionOptions: [],
        pricingRules: [],
      },
    });
    const projection = { policy: 'optional', readiness: 'ready' };
    await withTransaction(database, async (tx) => {
      const publication = createPublicationRepository(tx);
      await publication.request({
        shopId: shop.shopId,
        configId,
        operationId,
        revisionId,
        installationGeneration: shop.generation,
        expectedProjection: projection,
      });
      await publication.acknowledge(shop.shopId, configId, operationId);
      await publication.observe({ shopId: shop.shopId, configId, operationId, projection });
      expect(await publication.activate(shop.shopId, configId, operationId)).toBe('activated');
    });
  }

  test('a draft-only tenant has no published product', async () => {
    const shop = await createTestShop(database);
    const { productId } = await draftConfig(shop);
    expect(await hasPublishedConfig(database, shop.shopId)).toBe(false);
    expect((await readConfigSummaries(database, shop.shopId, [productId]))[0]?.published).toBe(false);
  });

  test('an activated publication counts, agrees with the catalog summaries and never crosses tenants', async () => {
    const shop = await createTestShop(database);
    const other = await createTestShop(database);
    const { configId, productId } = await draftConfig(shop);
    await draftConfig(other);
    expect(await hasPublishedConfig(database, shop.shopId)).toBe(false);
    await activate(shop, configId, productId);
    expect(await hasPublishedConfig(database, shop.shopId)).toBe(true);
    expect((await readConfigSummaries(database, shop.shopId, [productId]))[0]?.published).toBe(true);
    expect(await hasPublishedConfig(database, other.shopId)).toBe(false);
  });

  test('a reinstall makes the earlier publication stale', async () => {
    const shop = await createTestShop(database);
    const { configId, productId } = await draftConfig(shop);
    await activate(shop, configId, productId);
    expect(await hasPublishedConfig(database, shop.shopId)).toBe(true);
    await withTransaction(database, async (tx) => {
      expect(await createTenantRepository(tx).startInstallation(tx, shop.shopId)).toBe('2');
    });
    expect(await hasPublishedConfig(database, shop.shopId)).toBe(false);
    expect((await readConfigSummaries(database, shop.shopId, [productId]))[0]?.published).toBe(false);
  });
});
