import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { encodeHeader, encodeMember, wholeQuoteSignBytes } from '@insignia/cart-authorization';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/client/database.js';
import { PgAcceptedQuoteRepository } from '../src/repositories/accepted-quote.js';
import { createBuyerRepository } from '../src/repositories/buyer.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('durable buyer state', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  afterAll(async () => {
    await db?.destroy();
  });
  async function effectiveFixture() {
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

  it('isolates owned drafts, serializes CAS and denies expiry and obsolete generation', async () => {
    db = await openTestDatabase();
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db);
    const scope = { shopId, installationGeneration: '1', ownerHash: 'a'.repeat(64) };
    const now = new Date('2026-10-12T12:00:00Z');
    await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 600000) });
    const id = randomUUID();
    expect(await repo.saveDesign(scope, { id, expectedVersion: 0, value: { quantity: 500 }, now })).toMatchObject({
      version: 1,
    });
    const changes = await Promise.allSettled(
      [1, 2].map((quantity) => repo.saveDesign(scope, { id, expectedVersion: 1, value: { quantity }, now })),
    );
    expect(changes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await repo.getSession({ ...scope, ownerHash: 'b'.repeat(64) }, now)).toBeNull();
    expect(await repo.getSession(scope, new Date(+now + 600000))).toBeNull();
    await sql`UPDATE installation_generations SET deactivated_at=${new Date(Date.now() + 1000)} WHERE shop_id=${shopId}`.execute(
      db,
    );
    expect(await repo.getSession(scope, now)).toBeNull();
  });
  it('retains expired proposals for owned restoration until session erasure and bounds writes', async () => {
    const { shopId } = await createTestShop(db);
    const repo = createBuyerRepository(db),
      scope = { shopId, installationGeneration: '1', ownerHash: 'c'.repeat(64) };
    const now = new Date('2026-10-12T13:00:00Z'),
      expiresAt = new Date(+now + 604800000);
    await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt });
    const id = randomUUID();
    await repo.putProposal(scope, {
      id,
      requestDigest: 'd'.repeat(64),
      materialHash: 'e'.repeat(64),
      request: { privateAsset: 'owned' },
      candidate: { totalMinor: '5000' },
      now,
      expiresAt: new Date(+now + 300000),
    });
    expect(await repo.getProposal(scope, id, now)).toMatchObject({ request: { privateAsset: 'owned' } });
    expect(await repo.getProposal({ ...scope, ownerHash: 'f'.repeat(64) }, id, now)).toBeNull();
    expect(await repo.getProposal(scope, id, new Date(+now + 300000))).toBeNull();
    expect(await repo.getProposal(scope, id, new Date(+now + 300000), true)).toMatchObject({
      request: { privateAsset: 'owned' },
    });
    expect(
      await repo.getProposal({ ...scope, ownerHash: 'f'.repeat(64) }, id, new Date(+now + 300000), true),
    ).toBeNull();
    expect(await repo.getProposal(scope, id, expiresAt, true)).toBeNull();
    await repo.cleanupExpired(new Date(+now + 300000));
    expect(await repo.getSession(scope, new Date(+now + 300000))).not.toBeNull();
    const design = randomUUID();
    await repo.saveDesign(scope, { id: design, expectedVersion: 0, value: {}, now });
    for (let version = 1; version < 59; version++)
      await repo.saveDesign(scope, { id: design, expectedVersion: version, value: {}, now });
    await expect(repo.saveDesign(scope, { id: design, expectedVersion: 59, value: {}, now })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(await repo.getDesign(scope, design, now)).toMatchObject({ version: 59 });
    await repo.cleanupExpired(expiresAt);
    expect(await repo.getSession(scope, expiresAt)).toBeNull();
    expect(await repo.getDesign(scope, design, expiresAt)).toBeNull();
  });
  it('bounds tenant issuance and session draft cardinality across repository instances', async () => {
    const { shopId } = await createTestShop(db),
      now = new Date('2026-10-12T14:00:00Z');
    const scope = { shopId, installationGeneration: '1', ownerHash: '0'.repeat(64) };
    const repo = createBuyerRepository(db);
    for (let i = 0; i < 60; i++)
      await repo.issueSession({
        scope: { ...scope, ownerHash: i.toString(16).padStart(64, '0') },
        sessionId: randomUUID(),
        now,
        expiresAt: new Date(+now + 604800000),
      });
    await expect(
      createBuyerRepository(db).issueSession({
        scope: { ...scope, ownerHash: 'f'.repeat(64) },
        sessionId: randomUUID(),
        now,
        expiresAt: new Date(+now + 604800000),
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const next = new Date(+now + 60000);
    await expect(
      repo.issueSession({
        scope: { ...scope, ownerHash: 'f'.repeat(64) },
        sessionId: randomUUID(),
        now: next,
        expiresAt: new Date(+next + 604800000),
      }),
    ).resolves.toHaveProperty('sessionId');
    for (let i = 0; i < 32; i++) await repo.saveDesign(scope, { id: randomUUID(), expectedVersion: 0, value: {}, now });
    await expect(
      createBuyerRepository(db).saveDesign(scope, { id: randomUUID(), expectedVersion: 0, value: {}, now }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('restores only owned persisted sets and reconciles application vectors without changing quote history', async () => {
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
    const buyer = createBuyerRepository(db),
      now = new Date('2026-10-12T15:00:00Z');
    const scope = { shopId: value.shopId, installationGeneration: value.generation, ownerHash: 'c'.repeat(64) };
    await buyer.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 604800000) });
    const proposalId = randomUUID(),
      ownerBinding = 'b'.repeat(64);
    await buyer.putProposal(scope, {
      id: proposalId,
      requestDigest: 'd'.repeat(64),
      materialHash: 'e'.repeat(64),
      request: { privateAsset: 'owned-reference' },
      retainPrivateUntil: new Date(+now + 1200000),
      candidate: { totalMinor: '2001' },
      now,
      expiresAt: new Date(+now + 300000),
    });
    await buyer.linkQuote(scope, { quoteId, proposalId, ownerBinding, requestDigest: input.requestDigest, now });
    const later = new Date(+now + 600000);
    expect(await buyer.getLatestOwnedQuote(scope, ownerBinding, later)).toMatchObject({
      quote,
      request: { privateAsset: 'owned-reference' },
    });
    expect(await buyer.getLatestOwnedQuote({ ...scope, ownerHash: 'f'.repeat(64) }, ownerBinding, later)).toBeNull();
    expect(await buyer.getLatestOwnedQuote(scope, 'f'.repeat(64), later)).toBeNull();
    expect(await buyer.getLatestOwnedQuote(scope, ownerBinding, new Date(+now + 1200000))).toBeNull();
    expect(await buyer.getQuoteDesign(scope, quoteId, ownerBinding, later)).toMatchObject({
      request: { privateAsset: 'owned-reference' },
    });
    const restored = await buyer.getOwnedSet(scope, { quoteId, setId, ownerBinding, now: later });
    expect(restored).toMatchObject({ quote, authorization, request: { privateAsset: 'owned-reference' } });
    expect(
      await buyer.getOwnedSet({ ...scope, ownerHash: 'f'.repeat(64) }, { quoteId, setId, ownerBinding, now }),
    ).toBeNull();
    expect(await buyer.getOwnedSet(scope, { quoteId, setId: randomUUID(), ownerBinding, now })).toBeNull();
    expect(await buyer.getOwnedSet(scope, { quoteId, setId, ownerBinding: 'f'.repeat(64), now })).toBeNull();
    expect(await buyer.getQuoteDesign(scope, quoteId, ownerBinding, new Date(+now + 1200000))).toBeNull();
    const applicationId = randomUUID();
    await buyer.createApplication(scope, {
      id: applicationId,
      quoteId,
      ownerBinding,
      expectedFingerprint: 'd'.repeat(64),
      now,
    });
    expect(await buyer.getApplication({ ...scope, ownerHash: 'f'.repeat(64) }, applicationId, now)).toBeNull();
    expect(
      await buyer.confirmApplication(scope, { id: applicationId, observedFingerprint: 'e'.repeat(64), now }),
    ).toEqual({ id: applicationId, status: 'REVIEW_REQUIRED' });
    expect(
      await buyer.confirmApplication(scope, { id: applicationId, observedFingerprint: 'd'.repeat(64), now }),
    ).toEqual({ id: applicationId, status: 'APPLIED' });
    await sql`UPDATE signing_keys SET state='retiring',retired_at=${now} WHERE shop_id=${value.shopId} AND key_id=7`.execute(
      db,
    );
    expect(await buyer.getOwnedSet(scope, { quoteId, setId, ownerBinding, now })).not.toBeNull();
    await sql`UPDATE signing_keys SET state='revoked',revoked_at=${now},revocation_reason='synthetic-test',revocation_command_key='synthetic-test' WHERE shop_id=${value.shopId} AND key_id=7`.execute(
      db,
    );
    expect(await buyer.getOwnedSet(scope, { quoteId, setId, ownerBinding, now })).toBeNull();
    const privateDeadline = new Date(+now + 1200000);
    await buyer.cleanupExpired(privateDeadline);
    expect(await buyer.getSession(scope, privateDeadline)).not.toBeNull();
    expect(
      (
        await sql<{
          n: string;
        }>`SELECT count(*)::text n FROM quote_proposals WHERE proposal_id=${proposalId}::uuid`.execute(db)
      ).rows[0]?.n,
    ).toBe('0');
    await buyer.cleanupExpired(new Date(+now + 604800000));
    expect(await buyer.getQuoteDesign(scope, quoteId, ownerBinding, new Date(+now + 604800000))).toBeNull();
  });
  it('erases short-lived draft payloads without extending their original deadline on updates', async () => {
    const { shopId } = await createTestShop(db),
      now = new Date('2026-10-12T16:00:00Z');
    const scope = { shopId, installationGeneration: '1', ownerHash: 'e'.repeat(64) },
      repo = createBuyerRepository(db);
    await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 604800000) });
    const id = randomUUID(),
      deadline = new Date(+now + 600000);
    await repo.saveDesign(scope, { id, expectedVersion: 0, value: { privateAsset: 'old' }, now, expiresAt: deadline });
    await repo.saveDesign(scope, {
      id,
      expectedVersion: 1,
      value: { privateAsset: 'new' },
      now: new Date(+now + 1000),
      expiresAt: new Date(+now + 1200000),
    });
    expect(await repo.getDesign(scope, id, new Date(+deadline - 1))).toMatchObject({ version: 2 });
    expect(await repo.getDesign(scope, id, deadline)).toBeNull();
    await expect(repo.saveDesign(scope, { id, expectedVersion: 2, value: {}, now: deadline })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await repo.cleanupExpired(deadline);
    expect(await repo.getSession(scope, deadline)).not.toBeNull();
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM design_drafts WHERE design_id=${id}::uuid`.execute(db))
        .rows[0]?.n,
    ).toBe('0');
  });
});
