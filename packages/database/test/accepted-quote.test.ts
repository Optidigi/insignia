import { generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { acceptQuote } from '@insignia/application';
import {
  admitCandidate,
  currencyExponent,
  decodeEnvelope,
  decodeMemberCarrier,
  issueWholeQuote,
  wholeQuoteSignBytes,
} from '@insignia/cart-authorization';
import { type Kysely, sql } from 'kysely';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/client/database.js';
import { withTransaction } from '../src/client/database.js';
import { createDurableCore } from '../src/durable-core.js';
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
        methods: [{ id: 'method' }],
        placements: [{ id: 'front', allowedMethodIds: ['method'], allowedStepIds: ['step'], logoLaterAllowed: false }],
        productionOptions: [],
        pricingRules: [
          {
            id: 'negative-placement',
            scope: { kind: 'placement', placementId: 'front' },
            role: 'unit',
            rate: { kind: 'fixed', amount: { shopDecimal: '-0.01', presentmentOverrides: [] } },
          },
          {
            id: 'setup',
            scope: { kind: 'general' },
            role: 'setup',
            rate: { kind: 'fixed', amount: { shopDecimal: '0.03', presentmentOverrides: [] } },
          },
        ],
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
    await sql`UPDATE installation_generations SET authorization_epoch = ${value.authorizationEpoch + 1}
      WHERE shop_id = ${value.shopId} AND generation = ${value.generation}::bigint`.execute(database);
    const advanced = { ...input, authorizationEpoch: value.authorizationEpoch + 1 };
    await expect(repo.findCompleted(advanced)).rejects.toThrow(/revoked authorization identity/);
    await expect(
      repo.accept(advanced, async () => {
        signed++;
        return { quote, authorization };
      }),
    ).rejects.toThrow(/revoked authorization identity/);
    expect(signed).toBe(1);
    await withTransaction(database, async (transaction) => {
      await createTenantRepository(transaction).startInstallation(transaction, value.shopId);
    });
    await expect(
      repo.accept({ ...input, idempotencyKey: 'after-reinstall' }, async () => ({ quote, authorization })),
    ).rejects.toThrow(/inactive tenant/);
  });

  it('prices a signed negative adjustment, signs its full allocation, and persists the exact carriers', async () => {
    const value = await effectiveFixture();
    const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
    const now = new Date('2026-11-01T05:30:00.000Z');
    const keys = generateKeyPairSync('ed25519');
    const group = {
      version: 'm2-customization-group-v1' as const,
      shopId: value.shopId,
      productId: value.productId,
      configRevisionId: value.revisionId,
      revisionContentHash: value.contentHash,
      design: {
        placements: [
          {
            placementId: 'front',
            methodId: 'method',
            stepId: 'step',
            artwork: { kind: 'revision' as const, revisionId: 'art' },
          },
        ],
        options: [],
      },
      variants: [{ variantId: '700', quantity: 2 }],
    };
    const request = {
      shopId: value.shopId,
      installationGeneration: value.generation,
      idempotencyKey: randomUUID(),
      country: 'US',
      marketId: '42',
      groups: [{ group }],
      capacity: { ordinaryLineCount: 0, inputBytes: 1000 },
    };
    let signatures = 0;
    const ports = {
      clock: () => now,
      ids: { quoteId: randomUUID },
      tenant: {
        getActive: async (shopId: string, installationGeneration: string) => {
          const scope = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration });
          return (
            scope && {
              shopId: scope.shopId,
              installationGeneration: scope.installationGeneration,
              shopifyShopGid: `gid://shopify/Shop/${scope.shopifyShopId}`,
              authorizationGeneration: scope.authorizationGeneration,
              authorizationEpoch: scope.authorizationEpoch,
            }
          );
        },
      },
      shop: {
        getContext: async () => ({
          shopId: value.shopId,
          installationGeneration: value.generation,
          shopifyShopGid: `gid://shopify/Shop/${value.shopifyShopId}`,
          currency: 'USD',
          timezone: 'America/New_York',
        }),
      },
      entitlement: {
        getFresh: async () => ({
          active: true,
          freshness: 'fresh' as const,
          recognizedPolicyId: 'synthetic',
          policyVersion: 'synthetic-v1',
          trial: true,
          qualifyingUsageDisposition: 'WAIVE_TRIAL' as const,
        }),
      },
      publication: { getEffective: core.acceptedQuotes.getEffective },
      catalog: {
        resolveVariantContext: async () => [
          {
            shopId: value.shopId,
            installationGeneration: value.generation,
            productId: value.productId,
            variantId: '700',
            productIdVerified: true as const,
            context: { country: 'US' },
            amount: '0.00',
            currencyCode: 'USD',
            sourceApiVersion: '2026-07',
            observedAt: now.toISOString(),
            freshUntil: new Date(now.getTime() + 300000).toISOString(),
            correlation: { requestId: null },
          },
        ],
      },
      currency: { exponent: (code: string) => currencyExponent(code) ?? null },
      fx: {
        resolve: async () => {
          throw new Error('unexpected FX read');
        },
      },
      authorization: {
        admit: ({
          economics,
          capacity,
        }: {
          economics: { lines: { lineIndex: number; variantId: string; quantity: number; unitPriceMinor: string }[] };
          capacity: { ordinaryLineCount: number };
        }) => {
          const members = economics.lines.map((line) => ({
            index: line.lineIndex,
            variantId: line.variantId,
            quantity: line.quantity,
            unitMinor: line.unitPriceMinor,
          }));
          const decision = admitCandidate(members, { ordinaryLineHint: capacity.ordinaryLineCount });
          if (decision.status !== 'ADMIT') throw new Error(`candidate rejected: ${decision.reason}`);
        },
        issue: async ({
          quote,
        }: {
          quote: {
            quoteId: string;
            authorizationGeneration: string;
            authorizationEpoch: number;
            acceptedDay: number;
            validThroughDay: number;
            presentmentCurrency: string;
            presentmentExponent: number;
            country: string;
            marketId: string;
            economics: {
              lines: { lineIndex: number; variantId: string; quantity: number; unitPriceMinor: string }[];
              customizedQuantity: number;
              totalMinor: string;
            };
          };
        }) => {
          const setId = randomUUID();
          const members = quote.economics.lines.map((line) => ({
            index: line.lineIndex,
            variantId: line.variantId,
            quantity: line.quantity,
            unitMinor: line.unitPriceMinor,
          }));
          const issued = await issueWholeQuote(
            {
              keyId: 7,
              generationHex: quote.authorizationGeneration.replaceAll('-', ''),
              epoch: quote.authorizationEpoch,
              quoteHex: quote.quoteId.replaceAll('-', ''),
              setHex: setId.replaceAll('-', ''),
              count: members.length,
              currency: quote.presentmentCurrency,
              exponent: quote.presentmentExponent,
              country: quote.country,
              marketId: quote.marketId,
              validThroughDay: quote.validThroughDay,
              totalQuantity: quote.economics.customizedQuantity,
              totalMinor: quote.economics.totalMinor,
            },
            members,
            quote.acceptedDay,
            {
              signWholeQuote: async (input) => {
                signatures++;
                return {
                  keyId: input.keyId,
                  publicKeyFingerprint: 'synthetic',
                  firstValidDay: input.issuanceDay,
                  lastValidDay: input.validThroughDay,
                  signature: sign(null, input.message, keys.privateKey),
                };
              },
            },
          );
          return {
            setId,
            keyId: String(issued.keyId),
            publicKeyFingerprint: issued.publicKeyFingerprint,
            firstValidDay: quote.acceptedDay,
            lastValidDay: quote.validThroughDay,
            validThroughDay: quote.validThroughDay,
            envelopeCarrier: issued.envelope,
            members: issued.members.map((carrier, lineIndex) => ({ lineIndex, carrier })),
          };
        },
      },
      store: core.acceptedQuotes,
    };
    try {
      const accepted = await acceptQuote(request, ports);
      expect(accepted.quote.economics.groups[0]?.customizationUnitMinor).toBe('-1');
      expect(accepted.quote.economics.totalMinor).toBe('1');
      expect(accepted.quote.economics.lines.map((line) => line.unitPriceMinor)).toEqual(['1', '0']);
      const envelope = decodeEnvelope(accepted.authorization.envelopeCarrier);
      const members = accepted.authorization.members.map((item) => decodeMemberCarrier(item.carrier));
      expect(verify(null, wholeQuoteSignBytes(envelope.header, members), keys.publicKey, envelope.signature)).toBe(
        true,
      );
      const persisted = await sql<{ quote_value: unknown; envelope_carrier: string; member_carriers: unknown }>`
        SELECT q.quote_value, a.envelope_carrier, a.member_carriers FROM accepted_quotes q
        JOIN quote_authorization_sets a ON a.quote_id = q.quote_id
        WHERE q.quote_id = ${accepted.quote.quoteId}::uuid`.execute(database);
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]?.quote_value).toEqual(accepted.quote);
      expect(persisted.rows[0]?.envelope_carrier).toBe(accepted.authorization.envelopeCarrier);
      expect(persisted.rows[0]?.member_carriers).toEqual(accepted.authorization.members);
      expect(await acceptQuote(request, ports)).toEqual(accepted);
      expect(signatures).toBe(1);
    } finally {
      await core.close();
    }
  });
});
