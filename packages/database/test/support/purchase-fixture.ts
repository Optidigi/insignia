import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { encodeHeader, encodeMember, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { withTransaction } from '../../src/client/database.js';
import { PgAcceptedQuoteRepository } from '../../src/repositories/accepted-quote.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../../src/repositories/config.js';
import { createPublicationRepository } from '../../src/repositories/publication.js';
import { createTestShop, type openTestDatabase } from '../support/postgres.js';

export async function purchaseFixture(db: Awaited<ReturnType<typeof openTestDatabase>>) {
  const { shopId, generation } = await createTestShop(db);
  const shopifyShopId = (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString();
  await sql`UPDATE shops SET shopify_shop_id = ${shopifyShopId} WHERE shop_id = ${shopId}`.execute(db);
  const configId = randomUUID();
  const productId = randomUUID();
  const revisionId = randomUUID();
  const repository = createConfigRepositoryInternal(db);
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
  await withTransaction(db, async (transaction) => {
    await createPublicationRepository(transaction).request({
      shopId,
      configId,
      operationId,
      revisionId,
      installationGeneration: generation,
      expectedProjection: { synthetic: true },
    });
  });
  await withTransaction(db, async (transaction) => {
    expect(await createPublicationRepository(transaction).acknowledge(shopId, configId, operationId)).toBe(
      'acknowledged',
    );
  });
  await withTransaction(db, async (transaction) => {
    expect(
      await createPublicationRepository(transaction).observe({
        shopId,
        configId,
        operationId,
        projection: { synthetic: true },
      }),
    ).toBe('observed');
  });
  await withTransaction(db, async (transaction) => {
    expect(await createPublicationRepository(transaction).activate(shopId, configId, operationId)).toBe('activated');
  });
  const identity = await sql<{ authorization_generation: string; authorization_epoch: string }>`
      SELECT authorization_generation::text, authorization_epoch::text FROM installation_generations
      WHERE shop_id = ${shopId} AND generation = ${generation}::bigint`.execute(db);
  const authorizationGeneration = identity.rows[0]?.authorization_generation;
  const authorizationEpoch = Number(identity.rows[0]?.authorization_epoch);
  if (!authorizationGeneration || !Number.isInteger(authorizationEpoch)) throw new Error('missing 000300 identity');
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const publicKeyFingerprint = createHash('sha256').update(publicKey).digest('hex');
  await sql`INSERT INTO signing_keys (shop_id, installation_generation, authorization_generation, key_id,
      public_key, public_key_fingerprint, private_envelope, wrapping_key_id, state, first_valid_day, last_valid_day)
      VALUES (${shopId}, ${generation}::bigint, ${authorizationGeneration}::uuid, 7,
        ${publicKey}, ${publicKeyFingerprint}, '{"v":1}'::jsonb, 'synthetic', 'active', 20000, 21000)`.execute(db);
  const value = {
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
    physicalGroups: [
      {
        productId: value.productId,
        configRevisionId: value.revisionId,
        revisionContentHash: value.contentHash,
        canonicalIdentitySha256: 'a'.repeat(64),
        variants: [
          { variantId: '1', quantity: 1 },
          { variantId: '2', quantity: 1 },
        ],
      },
    ],
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
        { lineIndex: 0, variantId: '1', quantity: 1, unitPriceMinor: '1001', lineTotalMinor: '1001' },
        { lineIndex: 1, variantId: '2', quantity: 1, unitPriceMinor: '1000', lineTotalMinor: '1000' },
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

  await new PgAcceptedQuoteRepository(db).accept(input, async () => ({ quote, authorization }));
  return { ...value, quote, authorization };
}
