import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import { createArtworkUsabilityPort } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createDatabase } from '../../../packages/database/dist/client/database.js';
import { createConfigRepositoryInternal } from '../../../packages/database/dist/repositories/config.js';
import { createPublicationRepository } from '../../../packages/database/dist/repositories/publication.js';
import { createTenantRepository } from '../../../packages/database/dist/repositories/tenant.js';
import { createArtworkGuestAuthority } from '../src/server/artwork/guest.ts';
import { handleBuyerRequest } from '../src/server/buyer/http.ts';
import { createBuyerServices } from '../src/server/buyer/service.ts';
import { createQuoteAuthorityPorts } from '../src/server/quote-composition.ts';

// Real local PG18, durable repositories, HMAC ownership and Ed25519/v2 encoding.
// Only App Proxy signature validation and provider catalog/entitlement/readiness are boundary doubles.
const connectionString = process.env.DATABASE_URL;
async function fixture(t) {
  const pool = new Pool({ connectionString, max: 4 });
  const core = createDurableCore(new Pool({ connectionString, max: 8 }));
  const db = createDatabase(new Pool({ connectionString, max: 4 }));
  t.after(async () => {
    await core.close();
    await db.destroy();
    await pool.end();
  });
  const version = (await pool.query('show server_version_num')).rows[0].server_version_num;
  assert.equal(Math.floor(Number(version) / 10000), 18);
  const shopId = randomUUID(),
    shopDomain = `${shopId}.test.example`,
    shopifyShopId = (BigInt(`0x${shopId.replaceAll('-', '').slice(0, 15)}`) + 1n).toString(),
    productId = String(100000000 + Math.floor(Math.random() * 100000000)),
    configId = randomUUID(),
    revisionId = randomUUID(),
    operationId = randomUUID();
  await db
    .transaction()
    .execute((tx) => createTenantRepository(tx).createShop(tx, { shopId, shopDomain, shopifyShopId }));
  const repo = createConfigRepositoryInternal(db);
  await repo.createConfig({
    shopId,
    configId,
    externalProductId: productId,
    draftSchemaVersion: 'm3-config-draft-v1',
    draftValue: {},
  });
  const revision = await repo.createRevision({
    shopId,
    configId,
    revisionId,
    schemaVersion: 'm2-published-config-v1',
    publishedValue: {
      version: 'm2-published-config-v1',
      shopId,
      productId,
      revisionId,
      shopCurrency: 'EUR',
      methods: [{ id: 'print' }],
      placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
      productionOptions: [],
      pricingRules: [
        {
          id: 'setup',
          scope: { kind: 'general' },
          role: 'setup',
          rate: { kind: 'fixed', amount: { shopDecimal: '1.00', presentmentOverrides: [] } },
        },
      ],
    },
  });
  await db.transaction().execute((tx) =>
    createPublicationRepository(tx).request({
      shopId,
      configId,
      operationId,
      revisionId,
      installationGeneration: '1',
      expectedProjection: { synthetic: true },
    }),
  );
  await db.transaction().execute((tx) => createPublicationRepository(tx).acknowledge(shopId, configId, operationId));
  await db
    .transaction()
    .execute((tx) =>
      createPublicationRepository(tx).observe({ shopId, configId, operationId, projection: { synthetic: true } }),
    );
  await db.transaction().execute((tx) => createPublicationRepository(tx).activate(shopId, configId, operationId));
  const identity = await core.tenants.getActiveAuthorizationScope({ shopId, installationGeneration: '1' });
  assert.ok(identity);
  const keys = generateKeyPairSync('ed25519'),
    publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    fingerprint = createHash('sha256').update(publicKey).digest('hex');
  await pool.query(
    `INSERT INTO signing_keys(shop_id,installation_generation,authorization_generation,key_id,public_key,public_key_fingerprint,private_envelope,wrapping_key_id,state,first_valid_day,last_valid_day) VALUES($1,1,$2,7,$3,$4,'{"v":1}','synthetic','active',20000,21000)`,
    [shopId, identity.authorizationGeneration, publicKey, fingerprint],
  );
  let now = new Date('2026-10-12T12:00:00Z'),
    amount = '10.00',
    signings = 0,
    catalogUnavailable = false;
  const guest = createArtworkGuestAuthority({
    core,
    secret: 'synthetic-m7-http-private-capability',
    clock: () => +now,
    sessionDurationMs: 7 * 86400000,
    verifyProxy: async (url) => (url.searchParams.get('shop') === shopDomain ? { shop: shopDomain } : null),
  });
  function ports(scope) {
    const value = createQuoteAuthorityPorts({
      core,
      appId: 'synthetic',
      entitlementPolicy: {},
      readSubscription: async () => {
        throw new Error('not configured fixture boundary');
      },
      credentials: {},
      catalogTransport: {},
      artworkAuthority: scope,
      signing: {
        keyId: 7,
        signer: {
          async signWholeQuote(input) {
            signings++;
            return {
              keyId: 7,
              publicKeyFingerprint: fingerprint,
              firstValidDay: 20000,
              lastValidDay: 21000,
              signature: sign(null, input.message, keys.privateKey),
            };
          },
        },
      },
      readiness: { assertReady: async () => {} },
      clock: () => now,
    });
    return {
      ...value,
      shop: {
        getContext: async () => ({
          shopId,
          installationGeneration: '1',
          shopifyShopGid: `gid://shopify/Shop/${shopifyShopId}`,
          currency: 'EUR',
          timezone: 'UTC',
        }),
      },
      entitlement: {
        getFresh: async () => ({
          active: true,
          freshness: 'fresh',
          recognizedPolicyId: 'synthetic',
          policyVersion: 'test',
          trial: true,
          qualifyingUsageDisposition: 'WAIVE_TRIAL',
        }),
      },
      catalog: {
        resolveVariantContext: async () => {
          if (catalogUnavailable) throw new Error('Synthetic catalog outage');
          return [
            {
              shopId,
              installationGeneration: '1',
              productId,
              variantId: '222',
              productIdVerified: true,
              context: { country: 'NL', marketId: '42' },
              amount,
              currencyCode: 'EUR',
              sourceApiVersion: '2026-07',
              observedAt: now.toISOString(),
              freshUntil: new Date(+now + 60000).toISOString(),
              correlation: { requestId: 'synthetic' },
            },
          ];
        },
      },
      artwork: createArtworkUsabilityPort(core.artwork, () => now, scope),
    };
  }
  const services = createBuyerServices({
    core,
    guest,
    ports,
    clock: () => now,
    catalog: async () => ({ variants: [{ id: '222', label: 'Blue M', available: true }], imageUrls: {} }),
    configurationReady: async () => {},
  });
  async function http(route, body, method = 'POST') {
    return handleBuyerRequest(
      new Request(`https://app.test/apps/insignia/v1/${route}?shop=${shopDomain}&productId=${productId}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }),
      services,
      route,
    );
  }
  const sessionResponse = await http('sessions', {});
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const scope = await guest.verify(
    new Request(`https://app.test/guest?shop=${shopDomain}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: session.capability }),
    }),
  );
  assert.ok(scope);
  const assetId = randomUUID(),
    deadline = new Date(+now + 4 * 86400000),
    claimId = randomUUID();
  await core.artwork.create({
    assetId,
    shopId,
    installationGeneration: '1',
    ownerHash: scope.ownerHash,
    declaredMime: 'image/png',
    declaredBytes: 10,
    state: 'UPLOADING',
    quarantineKey: `synthetic/${assetId}/q`,
    originalKey: `synthetic/${assetId}/o`,
    previewKey: `synthetic/${assetId}/p`,
    collectedAt: now,
    uploadUntil: new Date(+now + 300000),
    expiresAt: deadline,
    claimId: null,
    manifest: null,
    rejection: null,
  });
  await core.artwork.complete(scope, assetId, now);
  assert.ok(await core.artwork.claim(assetId, claimId, now, new Date(+now + 360000)));
  await core.artwork.prepare(
    assetId,
    claimId,
    {
      version: 'm6-inspection-v1',
      mimeType: 'image/png',
      byteLength: 10,
      sha256: 'a'.repeat(64),
      width: 1,
      height: 1,
      previewSha256: 'b'.repeat(64),
      previewByteLength: 10,
    },
    now,
  );
  assert.equal(await core.artwork.settle(assetId, claimId, now), true);
  const group = {
    productId,
    configRevisionId: revisionId,
    revisionContentHash: revision.contentHash,
    design: {
      placements: [
        {
          placementId: 'front',
          methodId: 'print',
          stepId: 'small',
          artwork: { kind: 'revision', revisionId: assetId },
        },
      ],
      options: [],
    },
    variants: [{ variantId: '222', quantity: 2 }],
  };
  const body = {
    country: 'NL',
    marketId: '42',
    groups: [group],
    capacity: { ordinaryLineCount: 1, inputBytes: 100 },
    capability: session.capability,
  };
  return {
    core,
    pool,
    db,
    repo,
    configId,
    guest,
    scope,
    services,
    http,
    body,
    group,
    deadline,
    session,
    shopId,
    productId,
    amount: (value) => {
      amount = value;
    },
    unavailable: (value) => {
      catalogUnavailable = value;
    },
    advance: (ms) => {
      now = new Date(+now + ms);
    },
    signings: () => signings,
    now: () => now,
  };
}

test('buyer HTTP qualifies real durable proposal, acceptance replay, owned restore, renewal and confirmation', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const response = await f.http('quote-proposals', f.body);
  assert.equal(response.status, 200, await response.clone().text());
  const proposal = await response.json();
  assert.equal(proposal.totalMinor, '2100');
  assert.equal(f.signings(), 0);
  const acceptBody = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const acceptedResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(acceptedResponse.status, 200, await acceptedResponse.clone().text());
  const accepted = await acceptedResponse.json();
  assert.equal(f.signings(), 1);
  const repeated = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(repeated.status, 200, await repeated.clone().text());
  const replay = await repeated.json();
  assert.equal(replay.quoteId, accepted.quoteId);
  assert.equal(replay.setId, accepted.setId);
  assert.deepEqual(replay.buckets, accepted.buckets);
  assert.equal(f.signings(), 1);
  f.amount('11.00');
  const changedReplay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, acceptBody);
  assert.equal(changedReplay.status, 200, await changedReplay.clone().text());
  assert.deepEqual((await changedReplay.json()).buckets, accepted.buckets);
  assert.equal(f.signings(), 1);
  f.amount('10.00');
  const lines = accepted.buckets.map((bucket, index) => ({ ...bucket, key: `key${index}`, sellingPlan: null }));
  const restoredResponse = await f.http('cart-state', { capability: f.session.capability, lines });
  assert.equal(restoredResponse.status, 200, await restoredResponse.clone().text());
  const restored = await restoredResponse.json();
  assert.deepEqual(restored.groups, [f.group]);
  assert.equal(restored.quoteId, accepted.quoteId);
  const paid = await f.http('cart-state', {
    capability: f.session.capability,
    lines: lines.map((line) => ({ ...line, sellingPlan: '99' })),
  });
  assert.equal(paid.status, 409);
  assert.equal(f.signings(), 1);
  const confirm = await f.http(`cart-applications/${accepted.applicationId}/confirm`, {
    capability: f.session.capability,
    fingerprint: 'observed-current-cart',
    vector: accepted.buckets,
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).status, 'APPLIED');
  const original = (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE quote_id=$1', [accepted.quoteId]))
    .rows[0];
  f.advance(86400000);
  const renewalKey = randomUUID();
  const renewedResponse = await f.http(`quotes/${accepted.quoteId}/renew`, { ...f.body, idempotencyKey: renewalKey });
  assert.equal(renewedResponse.status, 200, await renewedResponse.clone().text());
  const renewed = await renewedResponse.json();
  assert.equal(renewed.quoteId, accepted.quoteId);
  assert.notEqual(renewed.setId, accepted.setId);
  assert.equal(renewed.validThroughDay, accepted.validThroughDay + 1);
  assert.equal(f.signings(), 2);
  const renewalReplay = await f.http(`quotes/${accepted.quoteId}/renew`, { ...f.body, idempotencyKey: renewalKey });
  assert.equal(renewalReplay.status, 200);
  assert.equal((await renewalReplay.json()).setId, renewed.setId);
  assert.equal(f.signings(), 2);
  assert.deepEqual(
    (await f.pool.query('SELECT quote_value FROM accepted_quotes WHERE quote_id=$1', [accepted.quoteId])).rows[0],
    original,
  );
});

test('changed authoritative price requires review before signing or immutable acceptance', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  f.amount('11.00');
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json()).code, 'REVIEW_REQUIRED');
  assert.equal(f.signings(), 0);
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    0,
  );
});

test('HTTP rejects forged capability, tenant injection, oversize and foreign draft CAS; raw design retention follows asset deadline', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  assert.equal((await f.http('quote-proposals', { ...f.body, capability: 'forged.token' })).status, 401);
  assert.equal((await f.http('quote-proposals', { ...f.body, shopId: randomUUID() })).status, 400);
  assert.equal((await f.http('quote-proposals', 'x'.repeat(128001))).status, 400);
  const designId = randomUUID();
  const body = { capability: f.session.capability, expectedVersion: 0, group: f.group };
  const saved = await f.http(`designs/${designId}`, body, 'PUT');
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await saved.json()).version, 1);
  assert.equal((await f.http(`designs/${designId}`, body, 'PUT')).status, 409);
  const another = await (await f.http('sessions', {})).json();
  assert.equal(
    (await f.http(`designs/${designId}`, { ...body, capability: another.capability, expectedVersion: 1 }, 'PUT'))
      .status,
    409,
  );
  const stored = (await f.pool.query('SELECT expires_at FROM design_drafts WHERE design_id=$1', [designId])).rows[0];
  assert.equal(+stored.expires_at, +f.deadline);
  f.advance(4 * 86400000);
  await f.core.buyers.cleanupExpired(f.now());
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM design_drafts WHERE design_id=$1', [designId])).rows[0].n,
    0,
  );
});

test('completed acceptance replay does not require another catalog observation', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const firstResponse = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  f.unavailable(true);
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(response.status, 200, await response.clone().text());
  const replay = await response.json();
  assert.equal(replay.quoteId, first.quoteId);
  assert.equal(replay.setId, first.setId);
  assert.deepEqual(replay.buckets, first.buckets);
  assert.equal(f.signings(), 1);
});
test('concurrent acceptance is one immutable quote/set and expired review permits only owned completed replay', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const body = { capability: f.session.capability, hash: proposal.hash, idempotencyKey: randomUUID() };
  const responses = await Promise.all([
    f.http(`quote-proposals/${proposal.proposalId}/accept`, body),
    f.http(`quote-proposals/${proposal.proposalId}/accept`, body),
  ]);
  for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
  const [first, second] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(first.quoteId, second.quoteId);
  assert.equal(first.setId, second.setId);
  assert.equal(f.signings(), 1);
  f.advance(300001);
  f.unavailable(true);
  const replay = await f.http(`quote-proposals/${proposal.proposalId}/accept`, body);
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal((await replay.json()).setId, first.setId);
  f.unavailable(false);
  const unreviewed = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    ...body,
    idempotencyKey: randomUUID(),
  });
  assert.equal(unreviewed.status, 409);
  assert.equal(f.signings(), 1);
  assert.equal(
    (await f.pool.query('SELECT count(*)::int n FROM accepted_quotes WHERE shop_id=$1', [f.shopId])).rows[0].n,
    1,
  );
  const owner2 = await (await f.http('sessions', {})).json();
  const lines = first.buckets.map((b, index) => ({ ...b, key: `line${index}`, sellingPlan: null }));
  assert.equal((await f.http('cart-state', { capability: owner2.capability, lines })).status, 409);
  const ownedRestore = await f.http('cart-state', { capability: f.session.capability, lines });
  assert.equal(ownedRestore.status, 200);
  assert.deepEqual((await ownedRestore.json()).groups, [f.group]);
  await f.pool.query('UPDATE installation_generations SET deactivated_at=$2 WHERE shop_id=$1 AND generation=1', [
    f.shopId,
    new Date(Date.now() + 1000),
  ]);
  assert.equal((await f.http('cart-state', { capability: f.session.capability, lines })).status, 401);
  assert.equal((await f.http(`quote-proposals/${proposal.proposalId}/accept`, body)).status, 401);
});

test('owned cart design restores from immutable historical revision after current publication changes', {
  skip: !connectionString,
}, async (t) => {
  const f = await fixture(t);
  const proposal = await (await f.http('quote-proposals', f.body)).json();
  const response = await f.http(`quote-proposals/${proposal.proposalId}/accept`, {
    capability: f.session.capability,
    hash: proposal.hash,
    idempotencyKey: randomUUID(),
  });
  assert.equal(response.status, 200);
  const accepted = await response.json();
  const revisionId = randomUUID(),
    operationId = randomUUID();
  await f.repo.createRevision({
    shopId: f.shopId,
    configId: f.configId,
    revisionId,
    schemaVersion: 'm2-published-config-v1',
    publishedValue: {
      version: 'm2-published-config-v1',
      shopId: f.shopId,
      productId: f.productId,
      revisionId,
      shopCurrency: 'EUR',
      methods: [{ id: 'embroider' }],
      placements: [
        { id: 'front', allowedMethodIds: ['embroider'], allowedStepIds: ['large'], logoLaterAllowed: false },
      ],
      productionOptions: [],
      pricingRules: [],
    },
  });
  await f.db.transaction().execute((tx) =>
    createPublicationRepository(tx).request({
      shopId: f.shopId,
      configId: f.configId,
      operationId,
      revisionId,
      installationGeneration: '1',
      expectedProjection: { synthetic: 'new' },
    }),
  );
  await f.db
    .transaction()
    .execute((tx) => createPublicationRepository(tx).acknowledge(f.shopId, f.configId, operationId));
  await f.db.transaction().execute((tx) =>
    createPublicationRepository(tx).observe({
      shopId: f.shopId,
      configId: f.configId,
      operationId,
      projection: { synthetic: 'new' },
    }),
  );
  await f.db.transaction().execute((tx) => createPublicationRepository(tx).activate(f.shopId, f.configId, operationId));
  const restored = await f.http('cart-state', {
    capability: f.session.capability,
    lines: accepted.buckets.map((bucket, index) => ({ ...bucket, key: `line${index}`, sellingPlan: null })),
  });
  assert.equal(restored.status, 200, await restored.clone().text());
  assert.deepEqual((await restored.json()).groups, [f.group]);
  assert.equal(f.signings(), 1);
});
