import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { createM3AdminReadCredentialSource } from '@insignia/application';
import { createDurableCore } from '@insignia/database';
import { deadlineAwareOnlineFetch } from '@insignia/shopify';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { build } from 'esbuild';
import { Pool } from 'pg';
import { isolatedDatabase } from '../support/isolated-database.mjs';

const key = 'synthetic-offline-app',
  secret = 'synthetic-offline-secret';
const scopes = ['write_products', 'read_orders'];
function staffToken(shop) {
  const time = Math.floor(Date.now() / 1000);
  const unsigned = [
    { alg: 'HS256', typ: 'JWT' },
    {
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: key,
      sub: '23',
      sid: 'synthetic-offline-session',
      iat: time,
      nbf: time - 1,
      exp: time + 60,
    },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}
for (const mode of ['success', 'lost-response', 'non-owner', 'wrong-installation', 'wider-scopes'])
  test(`verified merchant bootstrap establishes buyer credentials: ${mode}`, {
    skip: !process.env.DATABASE_URL,
  }, async () => {
    const out = new URL('../../.astro/offline-bootstrap-test.mjs', import.meta.url);
    await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
    await build({
      entryPoints: [new URL('../../src/server/admin/production.ts', import.meta.url).pathname],
      outfile: out.pathname,
      platform: 'node',
      format: 'esm',
      bundle: true,
      packages: 'external',
    });
    const { createProductionAdminServices } = await import(out.href);
    const isolated = await isolatedDatabase('offline_web');
    const pool = new Pool({ connectionString: isolated.connectionString });
    const keys = { currentKeyId: 'test-offline', keys: { 'test-offline': Buffer.alloc(32, 71) } };
    const core = createDurableCore(pool, { credentialKeys: keys });
    const shop = `m${randomUUID().replaceAll('-', '')}.myshopify.com`,
      shopId = 'gid://shopify/Shop/123456',
      installationId = 'gid://shopify/AppInstallation/12345',
      tenant = randomUUID();
    const oldFetch = globalThis.fetch,
      oldSdkFetch = abstractFetch;
    let offline = 0,
      online = 0,
      offlineReads = 0;
    try {
      await core.transactions.run((tx) =>
        core.tenants.createShop(tx, {
          shopId: tenant,
          shopDomain: shop,
          shopifyShopId: '123456',
          externalInstallationId: installationId,
        }),
      );
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/admin/oauth/access_token')) {
          const body = JSON.parse(String(init.body));
          if (body.requested_token_type.endsWith('offline-access-token')) {
            offline++;
            assert.equal(body.expiring, '1');
            if (mode === 'lost-response') throw Error('synthetic lost offline response');
            return Response.json({
              access_token: 'synthetic-offline-access',
              refresh_token: 'synthetic-offline-refresh',
              expires_in: 3600,
              refresh_token_expires_in: 86400,
              scope: (mode === 'wider-scopes' ? [...scopes, 'write_orders'] : scopes).join(','),
            });
          }
          online++;
          return Response.json({
            access_token: 'synthetic-online-access',
            scope: scopes.join(','),
            expires_in: 3600,
            associated_user_scope: scopes.join(','),
            associated_user: { id: 23, account_owner: mode !== 'non-owner' },
          });
        }
        assert.equal(new URL(url).host, shop);
        if (init.headers['X-Shopify-Access-Token'] === 'synthetic-offline-access') offlineReads++;
        return Response.json({
          data: {
            shop: { id: shopId, myshopifyDomain: shop, ianaTimezone: 'UTC' },
            currentAppInstallation: {
              id:
                mode === 'wrong-installation' && init.headers['X-Shopify-Access-Token'] === 'synthetic-offline-access'
                  ? 'gid://shopify/AppInstallation/99999'
                  : installationId,
              accessScopes: scopes.map((handle) => ({ handle })),
            },
          },
        });
      };
      setAbstractFetchFunc(deadlineAwareOnlineFetch(globalThis.fetch));
      const services = createProductionAdminServices(
        {
          DATABASE_URL: isolated.connectionString,
          SHOPIFY_CLIENT_ID: key,
          SHOPIFY_CLIENT_SECRET: secret,
          APP_URL: 'https://synthetic.example',
          INSIGNIA_M7_BUYER_ENABLED: '1',
          INSIGNIA_CREDENTIAL_KEY_ID: keys.currentKeyId,
          INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 71).toString('base64'),
        },
        pool,
      );
      const request = () =>
        new Request('https://synthetic.example/api/admin/products', {
          headers: { Authorization: `Bearer ${staffToken(shop)}` },
        });
      if (['lost-response', 'wrong-installation', 'wider-scopes'].includes(mode)) {
        await assert.rejects(() => services.authenticate(request()));
        await assert.rejects(() => services.authenticate(request()));
        assert.equal(offline, 1);
        assert.equal((await pool.query('select state from shop_credential_acquisitions')).rows[0].state, 'dispatched');
        assert.equal(await core.credentials.metadata({ shopId: tenant, installationGeneration: '1' }), undefined);
      } else {
        const actor = await services.authenticate(request());
        assert.equal(actor.tenantShopId, tenant);
        assert.equal(actor.canRead, true);
        if (mode === 'non-owner') {
          assert.equal(offline, 0);
          assert.equal(await core.credentials.metadata({ shopId: tenant, installationGeneration: '1' }), undefined);
          assert.equal(actor.canReadOrders, false);
        } else {
          const source = createM3AdminReadCredentialSource({
            tenants: core.tenants,
            credentials: {
              ...core.credentials,
              install: async (input) => {
                await core.credentials.install(input);
              },
            },
            refresh: {
              refresh: async () => {
                throw Error('must reuse acquired credential');
              },
            },
          });
          const acquired = await source.acquire({ shopId: tenant, installationGeneration: '1' });
          assert.equal(acquired.kind, 'usable');
          assert.equal(acquired.accessToken, 'synthetic-offline-access');
          await services.authenticate(request());
          assert.equal(offline, 1);
          assert.equal(offlineReads, 1);
          assert.equal(online, 2);
          const rows = (await pool.query('select * from shop_credentials')).rows;
          assert.equal(rows.length, 1);
          assert.equal(JSON.stringify(rows).includes('synthetic-offline-access'), false);
          assert.equal(JSON.stringify(rows).includes('synthetic-offline-refresh'), false);
        }
      }
    } finally {
      globalThis.fetch = oldFetch;
      setAbstractFetchFunc(oldSdkFetch);
      await core.close();
      await isolated.close();
    }
  });
