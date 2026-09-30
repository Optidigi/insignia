import { randomUUID } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { withTransaction } from '../src/client/database.js';
import { PgAcceptedQuoteRepository } from '../src/repositories/accepted-quote.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { createTenantRepository } from '../src/repositories/tenant.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('accepted quote PostgreSQL authority', () => {
  let database: Kysely<Database>;
  beforeAll(async () => {
    database = await openTestDatabase();
  });
  afterAll(async () => {
    await database?.destroy();
  });

  async function effectiveFixture() {
    const { shopId, generation } = await createTestShop(database);
    const shopifyShopId = (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString();
    await sql`UPDATE shops SET shopify_shop_id = ${shopifyShopId} WHERE shop_id = ${shopId}`.execute(database);
    const configId = randomUUID();
    const productId = randomUUID();
    const revisionId = randomUUID();
    const repository = createConfigRepositoryInternal(database);
    await repository.createConfig({
      shopId,
      configId,
      externalProductId: productId,
      draftSchemaVersion: CONFIG_DRAFT_STORAGE_VERSION,
      draftValue: {},
    });
    const revision = await repository.createRevision({
      shopId,
      configId,
      revisionId,
      schemaVersion: 'm2-published-config-v1',
      publishedValue: {
        version: 'm2-published-config-v1',
        shopId,
        productId,
        revisionId,
        shopCurrency: 'USD',
        methods: [],
        placements: [],
        productionOptions: [],
        pricingRules: [],
      },
    });
    const operationId = randomUUID();
    await withTransaction(database, async (transaction) => {
      await createPublicationRepository(transaction).request({
        shopId,
        configId,
        operationId,
        revisionId,
        installationGeneration: generation,
        expectedProjection: { synthetic: true },
      });
    });
    await withTransaction(database, async (transaction) => {
      expect(await createPublicationRepository(transaction).acknowledge(shopId, configId, operationId)).toBe(
        'acknowledged',
      );
    });
    await withTransaction(database, async (transaction) => {
      expect(
        await createPublicationRepository(transaction).observe({
          shopId,
          configId,
          operationId,
          projection: { synthetic: true },
        }),
      ).toBe('observed');
    });
    await withTransaction(database, async (transaction) => {
      expect(await createPublicationRepository(transaction).activate(shopId, configId, operationId)).toBe('activated');
    });
    const identity = await sql<{ authorization_generation: string; authorization_epoch: string }>`
      SELECT authorization_generation::text, authorization_epoch::text FROM installation_generations
      WHERE shop_id = ${shopId} AND generation = ${generation}::bigint`.execute(database);
    const authorizationGeneration = identity.rows[0]?.authorization_generation;
    const authorizationEpoch = Number(identity.rows[0]?.authorization_epoch);
    if (!authorizationGeneration || !Number.isInteger(authorizationEpoch)) throw new Error('missing 000300 identity');
    return {
      shopId,
      shopifyShopId,
      generation,
      configId,
      productId,
      revisionId,
      operationId,
      contentHash: revision.contentHash,
      authorizationGeneration,
      authorizationEpoch,
    };
  }

  it('stores one complete quote/set, replays the same key, and forbids mutation', async () => {
    const value = await effectiveFixture();
    const quoteId = randomUUID();
    const setId = randomUUID();
    const acceptedDay = Math.floor(Date.UTC(2026, 8, 29) / 86400000);
    const effectiveRevisions = [
      {
        configId: value.configId,
        operationId: value.operationId,
        productId: value.productId,
        revisionId: value.revisionId,
        contentHash: value.contentHash,
      },
    ];
    const quote = {
      quoteId,
      schemaVersion: 'm4-accepted-quote-v1',
      shopId: value.shopId,
      installationGeneration: value.generation,
      authorizationGeneration: value.authorizationGeneration,
      authorizationEpoch: value.authorizationEpoch,
      acceptedAt: '2026-09-29T12:00:00.000Z',
      acceptedDate: '2026-09-29',
      acceptedDay,
      validThroughDay: acceptedDay + 2,
      country: 'US',
      marketId: '42',
      shopCurrency: 'USD',
      shopTimezone: 'America/New_York',
      presentmentCurrency: 'USD',
      presentmentExponent: 2,
      policyVersion: 'test',
      recognizedPolicyId: 'synthetic',
      trial: true,
      qualifyingUsageDisposition: 'WAIVE_TRIAL',
      effectiveRevisions,
      economics: {
        customizedQuantity: 2,
        totalMinor: '2001',
        lines: [
          { lineIndex: 0, quantity: 1, unitPriceMinor: '1001', lineTotalMinor: '1001' },
          { lineIndex: 1, quantity: 1, unitPriceMinor: '1000', lineTotalMinor: '1000' },
        ],
      },
    };
    const authorization = {
      setId,
      keyId: 'synthetic-key',
      publicKeyFingerprint: 'synthetic',
      firstValidDay: acceptedDay,
      lastValidDay: acceptedDay + 30,
      validThroughDay: acceptedDay + 2,
      envelopeCarrier: 'envelope',
      members: [
        { lineIndex: 0, carrier: 'first' },
        { lineIndex: 1, carrier: 'second' },
      ],
    };
    const input = {
      shopId: value.shopId,
      installationGeneration: value.generation,
      authorizationGeneration: value.authorizationGeneration,
      authorizationEpoch: value.authorizationEpoch,
      idempotencyKey: 'same-command',
      requestDigest: 'a'.repeat(64),
      effectiveRevisions,
    };
    const repo = new PgAcceptedQuoteRepository(database);
    expect(await repo.getActive(value.shopId, value.generation)).toMatchObject({
      shopifyShopGid: `gid://shopify/Shop/${value.shopifyShopId}`,
      authorizationGeneration: value.authorizationGeneration,
      authorizationEpoch: value.authorizationEpoch,
    });
    expect(await repo.getEffective(value.shopId, value.productId)).toMatchObject({
      configId: value.configId,
      operationId: value.operationId,
      config: { revisionId: value.revisionId, revisionContentHash: value.contentHash },
    });
    let signed = 0;
    const results = await Promise.all([
      repo.accept(input, async () => {
        signed++;
        return { quote, authorization };
      }),
      repo.accept(input, async () => {
        signed++;
        return { quote, authorization };
      }),
    ]);
    expect(signed).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect(await repo.findCompleted(input)).toEqual(results[0]);
    await expect(
      repo.accept({ ...input, requestDigest: 'b'.repeat(64) }, async () => ({ quote, authorization })),
    ).rejects.toThrow(/idempotency digest conflict/);
    await expect(
      sql`UPDATE accepted_quotes SET total_minor = 1 WHERE quote_id = ${quoteId}::uuid`.execute(database),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM accepted_quotes WHERE quote_id = ${quoteId}::uuid`.execute(database),
    ).rejects.toThrow();
    await expect(
      sql`UPDATE quote_authorization_sets SET key_id = 'other' WHERE set_id = ${setId}::uuid`.execute(database),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM quote_authorization_sets WHERE set_id = ${setId}::uuid`.execute(database),
    ).rejects.toThrow();
    await withTransaction(database, async (transaction) => {
      await createTenantRepository(transaction).startInstallation(transaction, value.shopId);
    });
    await expect(
      repo.accept({ ...input, idempotencyKey: 'after-reinstall' }, async () => ({ quote, authorization })),
    ).rejects.toThrow(/inactive tenant/);
  });
});
