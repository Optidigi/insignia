import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { type AcceptedQuote, materialHash } from '@insignia/application';
import { decodeEnvelope, encodeHeader, encodeMember, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { type Kysely, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Database, withTransaction } from '../src/client/database.js';
import { PgAcceptedQuoteRepository } from '../src/repositories/accepted-quote.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { PgQuoteRenewalRepository } from '../src/repositories/quote-renewal.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('immutable owned quote renewal PostgreSQL', () => {
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
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    const publicKeyFingerprint = createHash('sha256').update(publicKey).digest('hex');
    await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
      public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
      VALUES (${shopId}, ${generation}::bigint, ${authorizationGeneration}::uuid, 7,
        ${publicKey}, ${publicKeyFingerprint}, '{"v":1}'::jsonb, 'synthetic', 'active', 20000, 21000)`.execute(
      database,
    );
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
      keys,
      publicKeyFingerprint,
    };
  }

  it('serializes one signed renewal, preserves history, rejects foreign replay and expired signer coverage', async () => {
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
    const quote: AcceptedQuote = {
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
      physicalGroups: [],
      artworkChecks: [],
      catalogSnapshots: [],
      fxSnapshot: null,
      economics: {
        version: 'm4-quote-economics-v1',
        groups: [],
        fx: null,
        customizedQuantity: 2,
        totalMinor: '2001',
        shopId: value.shopId,
        pricingEngineVersion: 'm2-pricing-v1',
        roundingPolicy: 'm2-half-even-v1',
        currency: { version: 'm2-currency-resolution-v1', presentmentCurrency: 'USD', exponents: { USD: 2 } },
        effectiveAt: '2026-09-29T12:00:00.000Z',
        marketContext: '42',
        lines: [
          {
            lineIndex: 0,
            unitOrdinalStart: 1,
            unitOrdinalEnd: 1,
            setupPerUnitMinor: '2',
            shopId: value.shopId,
            productId: value.productId,
            configRevisionId: value.revisionId,
            revisionContentHash: value.contentHash,
            canonicalIdentitySha256: 'a'.repeat(64),
            variantId: '1',
            quantity: 1,
            unitPriceMinor: '1001',
            lineTotalMinor: '1001',
          },
          {
            lineIndex: 1,
            unitOrdinalStart: 1,
            unitOrdinalEnd: 1,
            setupPerUnitMinor: '1',
            shopId: value.shopId,
            productId: value.productId,
            configRevisionId: value.revisionId,
            revisionContentHash: value.contentHash,
            canonicalIdentitySha256: 'a'.repeat(64),
            variantId: '2',
            quantity: 1,
            unitPriceMinor: '1000',
            lineTotalMinor: '1000',
          },
        ],
      },
    };
    const signedHeader = {
      keyId: 7,
      generationHex: value.authorizationGeneration.replaceAll('-', ''),
      epoch: value.authorizationEpoch,
      quoteHex: quoteId.replaceAll('-', ''),
      setHex: setId.replaceAll('-', ''),
      count: 2,
      currency: 'USD',
      exponent: 2,
      country: 'US',
      marketId: '42',
      validThroughDay: acceptedDay + 2,
      totalQuantity: 2,
      totalMinor: '2001',
    };
    const signedMembers = [
      { index: 0, variantId: '1', quantity: 1, unitMinor: '1001' },
      { index: 1, variantId: '2', quantity: 1, unitMinor: '1000' },
    ];
    const authorization = {
      setId,
      keyId: 7,
      publicKeyFingerprint: value.publicKeyFingerprint,
      firstValidDay: 20000,
      lastValidDay: 21000,
      validThroughDay: acceptedDay + 2,
      envelopeCarrier: Buffer.concat([
        encodeHeader(signedHeader),
        sign(null, wholeQuoteSignBytes(signedHeader, signedMembers), value.keys.privateKey),
      ]).toString('base64url'),
      members: signedMembers.map((member, lineIndex) => ({
        lineIndex,
        carrier: encodeMember(member).toString('base64url'),
      })),
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

    const initialRepo = new PgAcceptedQuoteRepository(database);
    await initialRepo.accept(input, async () => ({ quote, authorization }));
    const ownerBinding = 'b'.repeat(64);
    await sql`INSERT INTO buyer_quote_ownership(shop_id,installation_generation,quote_id,proposal_id,owner_binding,request_digest,created_at)
      VALUES(${value.shopId},${value.generation}::bigint,${quoteId}::uuid,${randomUUID()}::uuid,${ownerBinding},${input.requestDigest},clock_timestamp())`.execute(
      database,
    );
    const repo = new PgQuoteRenewalRepository(database);
    const command = {
      ...input,
      quoteId,
      ownerBinding,
      idempotencyKey: 'renew',
      materialHash: materialHash(quote),
      requestDigest: 'c'.repeat(64),
    };
    const issuance = {
      issuedAt: '2026-10-02T12:00:00.000Z',
      issuedDay: acceptedDay + 3,
      validThroughDay: acceptedDay + 5,
      shopTimezone: quote.shopTimezone,
    };
    const renewedSetId = randomUUID();
    const renewedHeader = {
      ...signedHeader,
      setHex: renewedSetId.replaceAll('-', ''),
      validThroughDay: issuance.validThroughDay,
    };
    const result = {
      quote: quote,
      issuance,
      authorization: {
        ...authorization,
        setId: renewedSetId,
        validThroughDay: issuance.validThroughDay,
        envelopeCarrier: Buffer.concat([
          encodeHeader(renewedHeader),
          sign(null, wholeQuoteSignBytes(renewedHeader, signedMembers), value.keys.privateKey),
        ]).toString('base64url'),
      },
    };
    let signatures = 0;
    const commit = async () => {
      signatures++;
      return result;
    };
    const results = await Promise.all([repo.renew(command, commit), repo.renew(command, commit)]);
    expect(signatures).toBe(1);
    expect(results[0]).toEqual(results[1]);
    expect(await repo.findCompleted(command)).toEqual(result);
    expect(await repo.getOwned({ ...command, ownerBinding: 'e'.repeat(64) })).toBeNull();
    await expect(repo.findCompleted({ ...command, ownerBinding: 'e'.repeat(64) })).rejects.toThrow('ownership');
    await expect(repo.renew({ ...command, requestDigest: 'e'.repeat(64) }, commit)).rejects.toThrow('digest');
    expect(await initialRepo.findCompleted(input)).toEqual({ quote, authorization });
    const persisted = await sql<{
      quote_value: unknown;
    }>`SELECT quote_value FROM accepted_quotes WHERE quote_id=${quoteId}::uuid`.execute(database);
    expect(persisted.rows[0]?.quote_value).toEqual(quote);
    await expect(
      sql`UPDATE quote_authorization_renewals SET issued_day=issued_day+1 WHERE set_id=${renewedSetId}::uuid`.execute(
        database,
      ),
    ).rejects.toThrow('immutable');
    await expect(
      repo.renew({ ...command, idempotencyKey: 'bad-window' }, async () => ({
        ...result,
        authorization: { ...result.authorization, setId: randomUUID(), lastValidDay: acceptedDay + 2 },
      })),
    ).rejects.toThrow();

    const unauthorizedSetId = randomUUID();
    await expect(
      sql`INSERT INTO quote_authorization_sets(set_id,quote_id,shop_id,installation_generation,
      authorization_generation,authorization_epoch,key_id,public_key_fingerprint,first_valid_day,last_valid_day,
      valid_through_day,envelope_carrier,member_carriers)
      VALUES(${unauthorizedSetId}::uuid,${quoteId}::uuid,${value.shopId},${value.generation}::bigint,
        ${value.authorizationGeneration}::uuid,${value.authorizationEpoch},7,${value.publicKeyFingerprint},20000,21000,
        ${issuance.validThroughDay},${result.authorization.envelopeCarrier},${JSON.stringify(authorization.members)}::jsonb)`.execute(
        database,
      ),
    ).rejects.toThrow('fixed accepted quote');
    await expect(
      repo.renew({ ...command, idempotencyKey: 'history-tamper' }, async () => ({
        ...result,
        quote: { ...result.quote, acceptedAt: issuance.issuedAt },
      })),
    ).rejects.toThrow('modified accepted history');
    await sql`UPDATE signing_keys SET state='revoked',revoked_at=clock_timestamp(),
      revocation_command_key='renew-test',revocation_reason='test' WHERE shop_id=${value.shopId} AND key_id=7`.execute(
      database,
    );
    await expect(repo.findCompleted(command)).rejects.toThrow('revoked');
    expect(decodeEnvelope(result.authorization.envelopeCarrier).header.quoteHex).toBe(quoteId.replaceAll('-', ''));
  });
});
