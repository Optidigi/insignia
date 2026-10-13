import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createArtworkUsabilityPort } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { createDatabase } from '../../../../packages/database/dist/client/database.js';
import { createConfigRepositoryInternal } from '../../../../packages/database/dist/repositories/config.js';
import { createPublicationRepository } from '../../../../packages/database/dist/repositories/publication.js';
import { createTenantRepository } from '../../../../packages/database/dist/repositories/tenant.js';
import { createArtworkGuestAuthority } from '../../src/server/artwork/guest.ts';
import { handleBuyerRequest } from '../../src/server/buyer/http.ts';
import { createBuyerServices } from '../../src/server/buyer/service.ts';
import { createQuoteAuthorityPorts } from '../../src/server/quote-composition.ts';

const connectionString = process.env.DATABASE_URL;
export async function fixture(t, options = {}) {
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
  const revision = await core.transactions.run(async (tx) =>
    core.configs.createValidatedRevision(tx, {
      shopId,
      configId,
      revisionId,
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
          ...(options.demo91
            ? [
                {
                  id: 'unit',
                  scope: { kind: 'placement', placementId: 'front' },
                  role: 'unit',
                  rate: { kind: 'fixed', amount: { shopDecimal: '10.00', presentmentOverrides: [] } },
                },
              ]
            : []),
          {
            id: 'setup',
            scope: { kind: 'general' },
            role: 'setup',
            rate: { kind: 'fixed', amount: { shopDecimal: '1.00', presentmentOverrides: [] } },
          },
        ],
      },
      geometry: {
        version: 'm5-geometry-v1',
        value: {
          version: 'm5-geometry-v1',
          views: [
            {
              id: 'front',
              variantImages: [],
              placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.3, height: 0.3 } }],
            },
          ],
          steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
        },
      },
      presentation: {
        version: 'm5-presentation-v1',
        labels: { methods: { print: 'Print' }, placements: { front: 'Front' }, steps: { small: 'Small' } },
      },
      sourceDraftVersion: (await core.configs.getConfig(shopId, configId)).draftVersion,
      sourceInstallationGeneration: '1',
      mode: 'optional',
      createdByRef: 'synthetic-buyer-fixture',
    }),
  );
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
  let now = options.clock ? options.clock() : new Date('2026-10-12T12:00:00Z'),
    amount = options.demo91 ? '20.00' : '10.00',
    signings = 0,
    catalogUnavailable = false,
    available = true;
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
    catalog: async () => ({
      variants: [{ id: '222', label: 'Blue M', available: typeof available === 'function' ? available() : available }],
      imageUrls: {},
    }),
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
    shopDomain,
    amount: (value) => {
      amount = value;
    },
    unavailable: (value) => {
      catalogUnavailable = value;
    },
    availability: (value) => {
      available = value;
    },
    advance: (ms) => {
      now = new Date(+now + ms);
    },
    signings: () => signings,
    now: () => now,
  };
}
