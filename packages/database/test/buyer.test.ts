import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/client/database.js';
import { PgAcceptedQuoteRepository } from '../src/repositories/accepted-quote.js';
import { BUYER_SESSION_POLICY, createBuyerRepository } from '../src/repositories/buyer.js';
import { CONFIG_DRAFT_STORAGE_VERSION, createConfigRepositoryInternal } from '../src/repositories/config.js';
import { createPublicationRepository } from '../src/repositories/publication.js';
import { signLinesV3 } from './support/line-v3.js';
import { createTestShop, openTestDatabase } from './support/postgres.js';

describe.runIf(Boolean(process.env.DATABASE_URL))('durable buyer state', () => {
  let db: Awaited<ReturnType<typeof openTestDatabase>>;
  afterAll(async () => {
    await db?.destroy();
  });
  async function waitForBlocked(queryFragment: string) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const result = await sql<{ count: string }>`SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${queryFragment}%`}`.execute(db);
      if (Number(result.rows[0]?.count) > 0) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Expected real PostgreSQL lock contention: ${queryFragment}`);
  }
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
  it('unused decline schema can roll back without changing retained commands', async () => {
    const migration = readFileSync(
      new URL('../migrations/20261109000100_buyer_acceptance_decline.sql', import.meta.url),
      'utf8',
    );
    const [up, down] = migration.split('-- migrate:down');
    await db.transaction().execute(async (tx) => {
      const schema = `decline_rollback_${randomUUID().replaceAll('-', '')}`;
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(tx);
      await sql`SET LOCAL search_path TO ${sql.id(schema)}, pg_catalog`.execute(tx);
      await sql`CREATE TABLE buyer_commands (kind text, application_id uuid, created_at timestamptz)`.execute(tx);
      await sql.raw(up ?? '').execute(tx);
      await sql`INSERT INTO buyer_commands(kind,created_at) VALUES ('accept',now())`.execute(tx);
      await sql.raw(down ?? '').execute(tx);
      expect((await sql<{ kind: string }>`SELECT kind FROM buyer_commands`.execute(tx)).rows).toEqual([
        { kind: 'accept' },
      ]);
      const columns =
        await sql`SELECT 1 FROM information_schema.columns WHERE table_schema=${schema} AND table_name='buyer_commands' AND column_name='declined_at'`.execute(
          tx,
        );
      expect(columns.rows).toHaveLength(0);
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(tx);
    });
  });
  it('terminal decline survives retries and prevents a delayed issuer from signing', async () => {
    const value = await effectiveFixture();
    const buyer = createBuyerRepository(db);
    const scope = { shopId: value.shopId, installationGeneration: value.generation, ownerHash: 'a'.repeat(64) };
    const now = new Date('2026-10-12T12:00:00Z');
    await buyer.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 600000) });
    const command = { kind: 'accept' as const, key: 'declined', requestDigest: 'b'.repeat(64), now };
    await buyer.reserveCommand(scope, command);
    const repo = new PgAcceptedQuoteRepository(db);
    const input = {
      ...scope,
      authorizationGeneration: value.authorizationGeneration,
      authorizationEpoch: value.authorizationEpoch,
      idempotencyKey: command.key,
      requestDigest: 'c'.repeat(64),
      buyerCommand: { ownerHash: scope.ownerHash, requestDigest: command.requestDigest, now },
    };
    expect(await repo.resolveBuyerAcceptance(input)).toEqual({ outcome: 'declined' });
    const down = readFileSync(
      new URL('../migrations/20261109000100_buyer_acceptance_decline.sql', import.meta.url),
      'utf8',
    ).split('-- migrate:down')[1];
    await expect(
      db.transaction().execute(async (tx) => {
        await sql.raw(down ?? '').execute(tx);
        throw new Error('rollback unexpectedly allowed');
      }),
    ).rejects.toThrow('terminal buyer declines prevent rollback');

    expect(await repo.resolveBuyerAcceptance(input)).toEqual({ outcome: 'declined' });
    let issued = false;
    await expect(
      repo.accept(
        {
          ...input,
          effectiveRevisions: [
            {
              configId: 'unused',
              operationId: 'unused',
              productId: 'unused',
              revisionId: 'unused',
              contentHash: 'unused',
            },
          ],
        },
        async () => {
          issued = true;
          throw new Error('issuer reached');
        },
      ),
    ).rejects.toThrow('buyer acceptance declined');
    expect(issued).toBe(false);
    await expect(
      repo.resolveBuyerAcceptance({ ...input, buyerCommand: { ...input.buyerCommand, requestDigest: 'd'.repeat(64) } }),
    ).rejects.toThrow();
    await expect(
      sql`UPDATE buyer_commands SET declined_at=NULL WHERE shop_id=${scope.shopId}`.execute(db),
    ).rejects.toThrow();
  });
  it('a decline holding the issuance fence wins over an overlapping delayed issuer', async () => {
    const value = await effectiveFixture();
    const buyer = createBuyerRepository(db),
      now = new Date('2026-10-12T12:00:00Z');
    const scope = { shopId: value.shopId, installationGeneration: value.generation, ownerHash: '6'.repeat(64) };
    const sessionId = randomUUID();
    await buyer.issueSession({ scope, sessionId, now, expiresAt: new Date(+now + 604800000) });
    const command = { kind: 'accept' as const, key: 'overlapping-decline', requestDigest: '7'.repeat(64), now };
    await buyer.reserveCommand(scope, command);
    const input = {
      shopId: value.shopId,
      installationGeneration: value.generation,
      authorizationGeneration: value.authorizationGeneration,
      authorizationEpoch: value.authorizationEpoch,
      idempotencyKey: command.key,
      requestDigest: '8'.repeat(64),
      buyerCommand: { ownerHash: scope.ownerHash, requestDigest: command.requestDigest, now },
    };
    let release: () => void = () => {},
      entered: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = db.transaction().execute(async (tx) => {
      await sql`SELECT 1 FROM buyer_commands WHERE session_id=${sessionId}::uuid FOR UPDATE`.execute(tx);
      entered();
      await gate;
    });
    await ready;
    const repo = new PgAcceptedQuoteRepository(db);
    const resolution = repo.resolveBuyerAcceptance(input);
    let signed = false;
    let issuance: Promise<unknown> | undefined;
    try {
      await waitForBlocked('FROM buyer_commands WHERE session_id');
      issuance = repo
        .accept(
          {
            ...input,
            effectiveRevisions: [
              {
                configId: 'unused',
                operationId: 'unused',
                productId: 'unused',
                revisionId: 'unused',
                contentHash: 'unused',
              },
            ],
          },
          async () => {
            signed = true;
            throw new Error('Unexpected signing');
          },
        )
        .then(
          () => 'unexpected success',
          (error: unknown) => error,
        );
      await waitForBlocked('FROM shops s JOIN installation_generations');
    } finally {
      release();
      await blocker;
    }
    expect(await resolution).toEqual({ outcome: 'declined' });
    expect(await issuance).toMatchObject({ message: 'buyer acceptance declined' });
    expect(signed).toBe(false);
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
    for (let i = 0; i < BUYER_SESSION_POLICY.shopIssuancePerMinute; i++)
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
    // Cleanup budgets are global; leave no bulk sessions ahead of later expiry assertions.
    await sql`DELETE FROM buyer_sessions WHERE shop_id=${shopId}`.execute(db);
  }, 60_000);
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
      currency: 'USD',
      exponent: 2,
      country: 'US',
      marketId: '42',
      validThroughDay: acceptedDay + 2,
    };
    const signedMembers = [
      { index: 0, variantId: '1', unitMinor: '1001' },
      { index: 1, variantId: '2', unitMinor: '1000' },
    ];
    const authorization = {
      setId,
      keyId: 7,
      publicKeyFingerprint: value.publicKeyFingerprint,
      firstValidDay: 20000,
      lastValidDay: 21000,
      validThroughDay: acceptedDay + 2,
      ...signLinesV3(signedHeader, signedMembers, value.keys.privateKey),
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

    const buyer = createBuyerRepository(db),
      now = new Date('2026-10-12T15:00:00Z');
    const raceScope = { shopId: value.shopId, installationGeneration: value.generation, ownerHash: 'c'.repeat(64) };
    await buyer.issueSession({ scope: raceScope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 604800000) });
    const reserved = { kind: 'accept' as const, key: input.idempotencyKey, requestDigest: '9'.repeat(64), now };
    await buyer.reserveCommand(raceScope, reserved);
    const fenced = {
      ...input,
      buyerCommand: { ownerHash: raceScope.ownerHash, requestDigest: reserved.requestDigest, now },
    };
    const repository = new PgAcceptedQuoteRepository(db);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const issuance = repository.accept(fenced, async () => {
      entered();
      await gate;
      return { quote, authorization };
    });
    await signing;
    const resolution = repository.resolveBuyerAcceptance(fenced);
    try {
      await waitForBlocked('FROM shops s JOIN installation_generations');
    } finally {
      release();
    }
    await expect(issuance).resolves.toEqual({ quote, authorization });
    await expect(resolution).resolves.toEqual({ outcome: 'accepted', result: { quote, authorization } });
    await expect(repository.resolveBuyerAcceptance(fenced)).resolves.toEqual({
      outcome: 'accepted',
      result: { quote, authorization },
    });
    const scope = { ...raceScope, ownerHash: 'd'.repeat(64) };
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
    // Renewal's stored-request read is owner, session and quote scoped like the set read.
    expect(await buyer.getOwnedRequest(scope, { quoteId, ownerBinding, now: later })).toMatchObject({
      quote: { quoteId },
    });
    expect(
      await buyer.getOwnedRequest({ ...scope, ownerHash: 'f'.repeat(64) }, { quoteId, ownerBinding, now }),
    ).toBeNull();
    expect(await buyer.getOwnedRequest(scope, { quoteId, ownerBinding: 'f'.repeat(64), now })).toBeNull();
    expect(await buyer.getOwnedRequest(scope, { quoteId: randomUUID(), ownerBinding, now })).toBeNull();
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
    const command = { kind: 'accept' as const, key: 'completed-accept', requestDigest: 'a'.repeat(64), now };
    expect(await buyer.reserveCommand(scope, command)).toEqual({ applicationId: null });
    // Proposal + two confirmations + reservation consumed four writes. Commit the remaining budget
    // before finishing; no new quota check may reject after the authoritative quote already exists.
    for (let i = 0; i < 56; i++) await buyer.admitRequest(scope, now);
    await buyer.linkQuote(scope, { quoteId, proposalId, ownerBinding, requestDigest: input.requestDigest, now });
    const finished = await Promise.all(
      [randomUUID(), randomUUID()].map((id) =>
        buyer.finishApplication(scope, { ...command, id, quoteId, ownerBinding, expectedFingerprint: 'd'.repeat(64) }),
      ),
    );
    expect(finished[0]).toEqual(finished[1]);
    expect(await buyer.reserveCommand(scope, command)).toEqual(finished[0]);
    expect(await buyer.completeCommand(scope, { ...command, applicationId: randomUUID() })).toEqual(finished[0]);
    expect(
      (
        await sql<{ n: string }>`SELECT count(*)::text n FROM cart_applications WHERE shop_id=${value.shopId}`.execute(
          db,
        )
      ).rows[0]?.n,
    ).toBe('2');
    await expect(buyer.reserveCommand(scope, { ...command, key: 'new-accept' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
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
  it('commits bounded pre-issuance reservations and throttles pending-command retries', async () => {
    const { shopId } = await createTestShop(db),
      now = new Date('2026-10-12T17:00:00Z');
    const scope = { shopId, installationGeneration: '1', ownerHash: 'e'.repeat(64) },
      repo = createBuyerRepository(db);
    await repo.issueSession({ scope, sessionId: randomUUID(), now, expiresAt: new Date(+now + 604800000) });
    for (let i = 0; i < 60; i++)
      await repo.reserveCommand(scope, { kind: 'renew', key: `renew-${i}`, requestDigest: 'a'.repeat(64), now });
    await expect(
      createBuyerRepository(db).reserveCommand(scope, {
        kind: 'renew',
        key: 'overflow',
        requestDigest: 'a'.repeat(64),
        now,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      repo.reserveCommand(scope, { kind: 'renew', key: 'renew-0', requestDigest: 'a'.repeat(64), now }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      repo.reserveCommand(scope, { kind: 'renew', key: 'renew-0', requestDigest: 'b'.repeat(64), now }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const later = new Date(+now + 60000);
    for (let i = 0; i < 60; i++)
      expect(
        await repo.reserveCommand(scope, { kind: 'renew', key: 'renew-0', requestDigest: 'a'.repeat(64), now: later }),
      ).toEqual({ applicationId: null });
    await expect(
      repo.reserveCommand(scope, { kind: 'renew', key: 'renew-0', requestDigest: 'a'.repeat(64), now: later }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_commands WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    ).toBe('60');
    const next = new Date(+later + 60000);
    for (let i = 60; i < 64; i++)
      await repo.reserveCommand(scope, { kind: 'renew', key: `renew-${i}`, requestDigest: 'a'.repeat(64), now: next });
    await expect(
      repo.reserveCommand(scope, { kind: 'accept', key: 'overflow', requestDigest: 'a'.repeat(64), now: next }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_commands WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    ).toBe('64');
    await expect(
      repo.reserveCommand(
        { ...scope, ownerHash: 'f'.repeat(64) },
        { kind: 'renew', key: 'renew-0', requestDigest: 'a'.repeat(64), now },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repo.cleanupExpired(new Date(+now + 604800000));
    expect(
      (await sql<{ n: string }>`SELECT count(*)::text n FROM buyer_commands WHERE shop_id=${shopId}`.execute(db))
        .rows[0]?.n,
    ).toBe('0');
  });
});
