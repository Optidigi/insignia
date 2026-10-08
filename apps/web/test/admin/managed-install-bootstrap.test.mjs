import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDurableCore } from '@insignia/database';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { build } from 'esbuild';
import { Pool } from 'pg';

const database = process.env.DATABASE_URL;
const client = 'synthetic-bootstrap-client';
const secret = 'synthetic-bootstrap-secret';
function staffToken(shop) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: client,
      sub: '23',
      sid: 'synthetic-bootstrap-session',
      iat: now,
      nbf: now - 1,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
async function fixture(run) {
  const output = new URL('../../.astro/m5-managed-bootstrap.mjs', import.meta.url);
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
  const httpOutput = new URL('../../.astro/m5-bootstrap-http.mjs', import.meta.url);
  await build({
    entryPoints: [new URL('../../src/server/admin/http.ts', import.meta.url).pathname],
    outfile: httpOutput.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const { handleAdminRequest } = await import(httpOutput.href);
  const pool = new Pool({ connectionString: database });
  const core = createDurableCore(pool);
  const oldFetch = globalThis.fetch;
  const oldSdkFetch = abstractFetch;
  const value = randomUUID().replaceAll('-', '');
  const shop = `m${value}.myshopify.com`;
  const numericId = (BigInt(`0x${value.slice(0, 12)}`) + 1n).toString();
  const model = {
    install: 'gid://shopify/AppInstallation/31',
    shopId: `gid://shopify/Shop/${numericId}`,
    domain: shop,
    exchangeFailed: false,
    providerFailed: false,
    userScopes: 'read_products,write_products',
    installationReads: 0,
    catalogReads: 0,
    exchanges: 0,
    afterRead: null,
  };
  try {
    setAbstractFetchFunc(async (url, init) => {
      model.exchanges++;
      assert.equal(String(url), `https://${shop}/admin/oauth/access_token`);
      assert.equal(JSON.parse(String(init.body)).client_id, client);
      if (model.exchangeFailed) return Response.json({ error: 'server_error' }, { status: 503 });
      return Response.json({
        access_token: 'synthetic-bootstrap-online',
        scope: 'read_products,write_products',
        expires_in: 3600,
        associated_user_scope: model.userScopes,
        associated_user: { id: 23 },
      });
    });
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `https://${shop}/admin/api/2026-07/graphql.json`);
      const { query } = JSON.parse(String(init.body));
      assert.ok(query.startsWith('query '), 'no provider mutation is allowed in bootstrap');
      if (query.includes('M5001StaffInstallation')) {
        model.installationReads++;
        if (model.providerFailed) return Response.json({ errors: [{ message: 'synthetic secret body' }] });
        const response = Response.json({
          data: {
            shop: { id: model.shopId, myshopifyDomain: model.domain, ianaTimezone: 'America/New_York' },
            currentAppInstallation: {
              id: model.install,
              accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
            },
          },
        });
        await model.afterRead?.();
        return response;
      }
      if (query.includes('InsigniaOwnedFunctions'))
        return Response.json({
          data: {
            shop: { id: model.shopId },
            shopifyFunctions: { nodes: [], pageInfo: { hasNextPage: false } },
            cartTransforms: { nodes: [], pageInfo: { hasNextPage: false } },
            validations: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        });
      if (query.includes('InsigniaReadPublicConfig'))
        return Response.json({ data: { shop: { id: model.shopId, field: null } } });
      assert.match(query, /M5001Products/);
      model.catalogReads++;
      return Response.json({
        data: {
          products: {
            nodes: [
              {
                id: 'gid://shopify/Product/555',
                title: 'Synthetic bootstrap shirt',
                status: 'DRAFT',
                featuredMedia: null,
                variants: { nodes: [], pageInfo: { hasNextPage: false } },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    };
    const services = createProductionAdminServices(
      {
        DATABASE_URL: database,
        SHOPIFY_CLIENT_ID: client,
        SHOPIFY_CLIENT_SECRET: secret,
        APP_URL: 'https://synthetic.example',
        INSIGNIA_SHOPIFY_APP_ID: '123',
      },
      pool,
    );
    const request = () =>
      new Request('https://synthetic.example/api/admin/products?shop=wrong.myshopify.com&installationId=999', {
        headers: { Authorization: `Bearer ${staffToken(shop)}` },
      });
    await run({ core, services, model, shop, numericId, request, handleAdminRequest });
  } finally {
    globalThis.fetch = oldFetch;
    setAbstractFetchFunc(oldSdkFetch);
    await core.close();
  }
}

test(
  'production first verified staff session bootstraps and searches, repeat reuses provider identity',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ core, services, model, shop, numericId, request }) => {
      assert.equal(await core.tenants.getManagedInstallationState(shop), null);
      const actor = await services.authenticate(request());
      assert.ok(actor?.canRead && actor.canEdit);
      assert.equal(actor.shop, shop);
      assert.equal(actor.installationId, model.install);
      const state = await core.tenants.getManagedInstallationState(shop);
      assert.deepEqual(state, {
        shopId: actor.tenantShopId,
        shopDomain: shop,
        shopifyShopId: numericId,
        currentGeneration: '1',
        externalInstallationId: model.install,
        active: true,
      });
      const result = await services.catalog.list(actor, { query: 'shirt', cursor: null, limit: 10 });
      assert.equal(result.products[0].title, 'Synthetic bootstrap shirt');
      model.userScopes = 'read_products';
      const again = await services.authenticate(request());
      assert.equal(again.tenantShopId, actor.tenantShopId);
      assert.equal(again.installationGeneration, '1');
      assert.equal(again.canRead, true);
      assert.equal(again.canEdit, false, 'staff permissions come from this online grant');
      assert.deepEqual(await core.tenants.getManagedInstallationState(shop), state);
      assert.equal(await core.tenants.getShopByDomain('wrong.myshopify.com'), null);
      assert.equal(model.installationReads, 2);
      assert.equal(model.catalogReads, 1);
      const readiness = await services.inspectReadiness(again);
      assert.equal(readiness.functions.transform, 'missing');
      assert.equal(readiness.functions.validation, 'missing');
      assert.equal(readiness.trustedRelease, null);
      assert.equal(readiness.signingKeyPresent, false);
      assert.equal(readiness.publicConfigPresent, false);
      assert.equal(readiness.commercialConfigured, false);
      assert.equal(readiness.ianaTimezone, 'America/New_York');
      assert.equal(readiness.installationGeneration, '1');
      assert.doesNotMatch(
        JSON.stringify(readiness),
        /accessToken|staffId|sessionId|synthetic-bootstrap-online|privateEnvelope/,
      );
    }),
);

test(
  'uninstall during the first provider observation fences the bootstrapped generation',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ core, services, model, shop, numericId, request }) => {
      let receipt;
      model.afterRead = async () => {
        receipt = await core.webhooks.receive({
          shopDomain: shop,
          deliveryId: randomUUID(),
          topic: 'app/uninstalled',
          apiVersion: '2026-07',
          triggeredAt: new Date(),
          eventId: randomUUID(),
          name: null,
          rawBody: Buffer.from(JSON.stringify({ id: Number(numericId), myshopify_domain: shop })),
        });
        assert.equal(await core.webhooks.processUninstall(receipt.id), 'unresolved');
      };
      await assert.rejects(services.authenticate(request()), { message: 'Authentication unavailable' });
      assert.equal(await core.webhooks.processUninstall(receipt.id), 'unresolved');
      assert.equal(await core.tenants.getManagedInstallationState(shop), null);
      model.afterRead = null;
      model.providerFailed = true;
      await assert.rejects(services.authenticate(request()), { message: 'Authentication unavailable' });
      assert.equal(model.catalogReads, 0);
    }),
);

test(
  'production confirms a reinstall twice, advances once and rejects historical stale sessions',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ core, services, model, shop, request }) => {
      const first = await services.authenticate(request());
      const original = model.install;
      model.install = 'gid://shopify/AppInstallation/32';
      const next = await services.authenticate(request());
      assert.equal(next.tenantShopId, first.tenantShopId);
      assert.equal(next.installationGeneration, '2');
      assert.equal(model.installationReads, 3, 'new installation requires independent confirmation');
      model.install = original;
      await assert.rejects(services.authenticate(request()), { message: 'Authentication unavailable' });
      assert.equal((await core.tenants.getManagedInstallationState(shop)).currentGeneration, '2');
      await assert.rejects(services.catalog.list(first, { query: '', cursor: null, limit: 10 }), {
        message: 'Admin installation changed',
      });
    }),
);

test(
  'production provider drift during reinstall confirmation leaves the generation unchanged',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ core, services, model, shop, request }) => {
      await services.authenticate(request());
      const before = await core.tenants.getManagedInstallationState(shop);
      model.install = 'gid://shopify/AppInstallation/33';
      model.afterRead = () => {
        model.install = 'gid://shopify/AppInstallation/34';
      };
      await assert.rejects(services.authenticate(request()), { message: 'Authentication unavailable' });
      assert.deepEqual(await core.tenants.getManagedInstallationState(shop), before);
    }),
);

test(
  'production concurrent verified sessions converge and concurrent reinstalls advance once',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ core, services, model, shop, request }) => {
      const actors = await Promise.all(Array.from({ length: 24 }, () => services.authenticate(request())));
      assert.equal(new Set(actors.map((actor) => actor.tenantShopId)).size, 1);
      assert.ok(actors.every((actor) => actor.installationGeneration === '1'));
      model.install = 'gid://shopify/AppInstallation/35';
      const renewed = await Promise.all(Array.from({ length: 24 }, () => services.authenticate(request())));
      assert.ok(renewed.every((actor) => actor.installationGeneration === '2'));
      assert.equal((await core.tenants.getManagedInstallationState(shop)).currentGeneration, '2');
    }),
);

for (const failure of ['exchange', 'provider', 'domain', 'durable-shop-id'])
  test(
    `production ${failure} failure cannot bootstrap an installation`,
    { skip: !database, timeout: 30000 },
    async () =>
      fixture(async ({ core, services, model, shop, numericId, request }) => {
        if (failure === 'exchange') model.exchangeFailed = true;
        if (failure === 'provider') model.providerFailed = true;
        if (failure === 'domain') model.domain = 'wrong.myshopify.com';
        if (failure === 'durable-shop-id')
          await core.transactions.run((tx) =>
            core.tenants.createShop(tx, {
              shopId: randomUUID(),
              shopDomain: shop,
              shopifyShopId: `${numericId}1`,
              externalInstallationId: model.install,
            }),
          );
        const before = await core.tenants.getManagedInstallationState(shop);
        await assert.rejects(services.authenticate(request()));
        assert.deepEqual(await core.tenants.getManagedInstallationState(shop), before);
        assert.equal(model.catalogReads, 0);
        if (failure === 'exchange') assert.equal(model.installationReads, 0);
      }),
  );

test(
  'technical readiness HTTP remains authenticated, private, staff-bound and read-only',
  { skip: !database, timeout: 30000 },
  async () =>
    fixture(async ({ services, model, shop, handleAdminRequest }) => {
      const url = 'https://synthetic.example/api/admin/readiness';
      const route = { kind: 'readiness' };
      const anonymous = await handleAdminRequest(new Request(url), services, route);
      assert.equal(anonymous.status, 401);
      assert.equal(model.exchanges, 0);
      const headers = { Authorization: `Bearer ${staffToken(shop)}` };
      const response = await handleAdminRequest(new Request(url, { headers }), services, route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.match(response.headers.get('Vary'), /Authorization/);
      const body = await response.json();
      assert.equal(body.shop, shop);
      assert.equal(body.functions.transform, 'missing');
      assert.equal(body.trustedRelease, null);
      assert.equal(
        (await handleAdminRequest(new Request(`${url}?shop=wrong.myshopify.com`, { headers }), services, route)).status,
        403,
      );
      assert.equal(
        (await handleAdminRequest(new Request(url, { headers, method: 'POST' }), services, route)).status,
        405,
      );
      model.userScopes = '';
      assert.equal((await handleAdminRequest(new Request(url, { headers }), services, route)).status, 403);
      assert.equal(model.catalogReads, 0);
      assert.doesNotMatch(JSON.stringify(body), /staffId|sessionId|accessToken|privateEnvelope/);
    }),
);

test('readiness collection fingerprints match the reviewed Function query artifacts', async () => {
  const source = await readFile(new URL('../../src/server/admin/production.ts', import.meta.url), 'utf8');
  for (const path of [
    'extensions/insignia-cart-transform/src/cart_transform_run.graphql',
    'extensions/insignia-cart-validation/src/cart_validations_generate_run.graphql',
  ]) {
    const bytes = await readFile(new URL(`../../../../${path}`, import.meta.url));
    assert.ok(source.includes(createHash('sha256').update(bytes).digest('hex')));
  }
});
