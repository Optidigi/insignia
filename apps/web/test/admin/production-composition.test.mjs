import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { build } from 'esbuild';
import { Pool } from 'pg';

const database = process.env.DATABASE_URL;
const client = 'synthetic-m5-composition-client';
const secret = 'synthetic-m5-composition-secret';
const productId = 'gid://shopify/Product/555';
const appId = 'gid://shopify/App/123';
function staffToken(shop) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: client,
      sub: '23',
      sid: 'synthetic-session-23',
      iat: now,
      nbf: now - 1,
      exp: now + 3600,
      jti: 'synthetic-composition-jti',
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
function validDraft() {
  return {
    version: 'm5-merchant-draft-v1',
    mode: 'optional',
    shopCurrency: 'USD',
    methods: [{ id: 'print' }],
    placements: [{ id: 'front', allowedMethodIds: ['print'], allowedStepIds: ['small'], logoLaterAllowed: true }],
    productionOptions: [],
    pricingRules: [],
    geometry: {
      version: 'm5-geometry-v1',
      views: [
        {
          id: 'front-view',
          image: { revisionId: 'product_555', width: 800, height: 900 },
          variantImages: [],
          placements: [{ id: 'front', rect: { centerX: 0.5, centerY: 0.5, width: 0.4, height: 0.3 } }],
        },
      ],
      steps: [{ id: 'small', widthFraction: 0.5, heightFraction: 0.5 }],
    },
  };
}
test('production composition uses signed staff SDK, current feature policy and real M4 prepare with admission hold', {
  skip: !database,
  timeout: 30000,
}, async (t) => {
  const output = new URL('../../.astro/m5-production-composition.mjs', import.meta.url);
  await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
  await build({
    entryPoints: [new URL('../../src/server/admin/production.ts', import.meta.url).pathname],
    outfile: output.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const { createProductionAdminServices } = await import(output.href);
  const pool = new Pool({ connectionString: database });
  const core = createDurableCore(pool);
  const oldFetch = globalThis.fetch;
  const oldSdkFetch = abstractFetch;
  const tenantId = randomUUID();
  const shopNumber = String(BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n);
  const shopId = `gid://shopify/Shop/${shopNumber}`;
  const shop = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  let providerMode = 'current';
  let entitlementNow = '2026-09-30T23:59:59.999Z';
  let adminMutations = 0;
  let partnerReads = 0;
  let sdkExchanges = 0;
  try {
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: tenantId,
        shopDomain: shop,
        shopifyShopId: shopNumber,
        externalInstallationId: 'gid://shopify/AppInstallation/9',
      }),
    );
    const auth = await pool.query(
      'SELECT authorization_generation FROM installation_generations WHERE shop_id=$1 AND generation=1',
      [tenantId],
    );
    const pair = generateKeyPairSync('ed25519');
    const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
    await pool.query(
      'INSERT INTO signing_keys (shop_id,installation_generation,authorization_generation,key_id,public_key,public_key_fingerprint,private_envelope,wrapping_key_id,state,first_valid_day,last_valid_day) VALUES ($1,1,$2,7,$3,$4,$5,$6,$7,20000,21000)',
      [
        tenantId,
        auth.rows[0].authorization_generation,
        publicKey,
        createHash('sha256').update(publicKey).digest('hex'),
        { v: 1 },
        'synthetic',
        'pending',
      ],
    );
    setAbstractFetchFunc(async (url, init) => {
      sdkExchanges++;
      assert.equal(String(url), `https://${shop}/admin/oauth/access_token`);
      assert.equal(JSON.parse(String(init.body)).client_id, client);
      return Response.json({
        access_token: 'synthetic-online-grant',
        scope: 'read_products,write_products',
        expires_in: 3600,
        associated_user_scope: 'read_products,write_products',
        associated_user: { id: 23 },
      });
    });
    globalThis.fetch = async (url, init) => {
      const address = String(url);
      const { query } = JSON.parse(String(init.body));
      if (address.startsWith('https://partners.shopify.com/')) {
        partnerReads++;
        assert.match(query, /^query ActiveSubscription/);
        if (providerMode === 'ended') return Response.json({ data: { activeSubscription: null } });
        const active = providerMode !== 'ended';
        const planHandle = providerMode === 'unrecognized' ? 'plan.unknown' : 'plan.m5';
        return Response.json({
          data: {
            activeSubscription: {
              app: { id: appId },
              shop: { id: shopId },
              billingPeriod: 'EVERY_30_DAYS',
              cancelAtEndOfCycle: providerMode === 'cancelled',
              trialEndsAt: null,
              currentBillingCycle: { startTime: '2026-09-01T00:00:00Z', endTime: '2026-10-01T00:00:00Z' },
              items: [
                {
                  handle: planHandle,
                  price: { __typename: 'FlatRatePrice', active, currency: 'USD', amount: '29.00' },
                  discount: null,
                  usage: null,
                },
                {
                  handle: 'meter.m5',
                  price: {
                    __typename: 'TieredPrice',
                    active,
                    currency: 'USD',
                    tiersMode: 'GRADUATED',
                    tiers: [{ upTo: null, amountPerUnit: '0.00', amount: '0.00' }],
                  },
                  discount: null,
                  usage: { quantity: 0, cost: { amount: '0.00', currencyCode: 'USD' } },
                },
              ],
              pendingUpdate:
                providerMode === 'pending'
                  ? { billingPeriod: 'EVERY_30_DAYS', items: [{ handle: 'plan.future' }] }
                  : null,
            },
          },
        });
      }
      assert.equal(address, `https://${shop}/admin/api/2026-07/graphql.json`);
      assert.equal(new Headers(init.headers).get('x-shopify-access-token'), 'synthetic-online-grant');
      if (/^mutation\b/.test(query)) {
        adminMutations++;
        throw new Error('Synthetic test forbids remote mutation');
      }
      if (query.includes('M5001StaffInstallation'))
        return Response.json({
          data: {
            shop: { id: shopId, myshopifyDomain: shop },
            currentAppInstallation: {
              id: 'gid://shopify/AppInstallation/9',
              accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
            },
          },
        });
      if (query.includes('M5001Product'))
        return Response.json({
          data: {
            product: {
              id: productId,
              title: 'Synthetic shirt',
              status: 'ACTIVE',
              featuredMedia: null,
              variants: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        });
      if (query.includes('M5001ShopCurrency')) return Response.json({ data: { shop: { currencyCode: 'USD' } } });
      if (query.includes('InsigniaReadPublicConfig'))
        return Response.json({ data: { shop: { id: shopId, field: null } } });
      if (query.includes('InsigniaReadRegistration') || query.includes('InsigniaReadPolicy'))
        return Response.json({ data: { node: { __typename: 'Product', id: productId, field: null } } });
      throw new Error('Unexpected synthetic Admin document');
    };
    const policy = {
      policyVersion: 'synthetic-v1',
      maxAgeMs: 300000,
      plans: [
        {
          planHandle: 'plan.m5',
          usageHandle: 'meter.m5',
          policyId: 'synthetic-plan',
          features: ['base', 'required', 'logo', 'options', 'pricing'],
          includedUsage: 0,
        },
      ],
    };
    const features = { base: 'base', required: 'required', logoLater: 'logo', options: 'options', pricing: 'pricing' };
    const services = createProductionAdminServices(
      {
        DATABASE_URL: database,
        SHOPIFY_CLIENT_ID: client,
        SHOPIFY_CLIENT_SECRET: secret,
        APP_URL: 'https://synthetic.example',
        INSIGNIA_SHOPIFY_APP_ID: '123',
        INSIGNIA_PARTNER_ORGANIZATION_ID: '12345',
        INSIGNIA_PARTNER_ACCESS_TOKEN: 'synthetic-partner-grant',
        INSIGNIA_M5_ENTITLEMENT_POLICY_JSON: JSON.stringify(policy),
        INSIGNIA_M5_FEATURES_JSON: JSON.stringify(features),
      },
      pool,
      () => new Date(entitlementNow),
    );
    const actor = await services.authenticate(
      new Request('https://synthetic.example/api/admin/products', {
        headers: { Authorization: `Bearer ${staffToken(shop)}` },
      }),
    );
    assert.ok(actor?.canEdit && actor.tenantShopId === tenantId);
    const created = await services.configs.create(actor, productId, 'composition-create');
    assert.equal(created.kind, 'created');
    const saved = await services.configs.save(actor, productId, {
      configId: created.configId,
      draftVersion: '1',
      draft: validDraft(),
      idempotencyKey: 'composition-save',
    });
    assert.equal(saved.kind, 'saved');
    for (const [mode, allowed] of [
      ['current', true],
      ['pending', true],
      ['cancelled', true],
      ['ended', false],
      ['unrecognized', false],
    ]) {
      providerMode = mode;
      const read = await services.configs.read(actor, productId);
      assert.equal(read.config.publishEligibility.allowed, allowed, mode);
    }
    providerMode = 'cancelled';
    for (const [instant, allowed] of [
      ['2026-09-30T23:59:59.999Z', true],
      ['2026-10-01T00:00:00.000Z', false],
      ['2026-10-01T00:00:00.001Z', false],
    ]) {
      await t.test(`scheduled cancellation boundary ${instant}: allowed=${allowed}`, async () => {
        entitlementNow = instant;
        const read = await services.configs.read(actor, productId);
        assert.equal(read.config.publishEligibility.allowed, allowed);
      });
    }
    entitlementNow = '2026-09-30T23:59:59.999Z';
    providerMode = 'current';
    const published = await services.configs.publish(actor, productId, {
      configId: created.configId,
      draftVersion: saved.draftVersion,
      idempotencyKey: 'composition-publish',
    });
    assert.equal(published.kind, 'accepted');
    assert.equal(published.state, 'ACTIVATION_WAITING_RELEASE');
    assert.equal(
      (await services.configs.read(actor, productId)).config.publication.state,
      'ACTIVATION_WAITING_RELEASE',
    );
    const pending = await core.configs.getConfig(tenantId, created.configId);
    assert.equal(pending.effectiveRevisionId, null);
    assert.equal(
      (await core.configs.getCurrentPublication(tenantId, created.configId)).activationKind,
      'WAITING_RELEASE',
    );
    assert.ok(partnerReads >= 7 && sdkExchanges === 1);
    assert.equal(adminMutations, 0, 'Production M4 admission must hold before any remote mutation');
  } finally {
    globalThis.fetch = oldFetch;
    setAbstractFetchFunc(oldSdkFetch);
    await pool.end();
  }
});
