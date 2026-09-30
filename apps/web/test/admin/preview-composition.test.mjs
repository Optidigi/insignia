import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { abstractFetch, setAbstractFetchFunc } from '@shopify/shopify-api/runtime';
import { build } from 'esbuild';
import { Pool } from 'pg';

const database = process.env.DATABASE_URL;
const client = '1443cf6d03d39edae7c101a943c5c684',
  secret = 'synthetic-m5002-secret',
  shop = 'insignia-rewrite-dev.myshopify.com',
  product = 'gid://shopify/Product/10485042479387';
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: client,
      sub: '23',
      sid: 'synthetic-session',
      iat: now,
      nbf: now - 1,
      exp: now + 60,
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const signed = `${header}.${body}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}
test('diagnostic preview requires accounting and HTTPS before any provider access', async () => {
  const out = new URL('../../.astro/m5002-preview.mjs', import.meta.url);
  await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
  await build({
    entryPoints: [new URL('../../src/server/admin/preview.ts', import.meta.url).pathname],
    outfile: out.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const { createDiagnosticPreviewServices } = await import(out.href);
  assert.throws(
    () =>
      createDiagnosticPreviewServices({
        INSIGNIA_M5_002_DIAGNOSTIC: '1',
        SHOPIFY_CLIENT_ID: client,
        SHOPIFY_CLIENT_SECRET: secret,
        DATABASE_URL: 'synthetic',
        APP_URL: 'https://synthetic.example.test',
      }),
    /configuration/,
  );
});
test('live-style SDK identity, local PG create/save/reload/CAS/exact ambiguous replay and mutation refusal', {
  skip: !database,
  timeout: 30000,
}, async () => {
  const out = new URL('../../.astro/m5002-preview.mjs', import.meta.url);
  await mkdir(new URL('../../.astro/', import.meta.url), { recursive: true });
  await build({
    entryPoints: [new URL('../../src/server/admin/preview.ts', import.meta.url).pathname],
    outfile: out.pathname,
    platform: 'node',
    format: 'esm',
    bundle: true,
    packages: 'external',
  });
  const { createDiagnosticPreviewServices } = await import(out.href + '?pg');
  const adminPool = new Pool({ connectionString: database });
  const dbName = 'm5002_' + randomUUID().replaceAll('-', '');
  await adminPool.query('CREATE DATABASE ' + dbName);
  const dbUrl = new URL(database);
  dbUrl.pathname = '/' + dbName;
  execFileSync(
    new URL('../../../../node_modules/.bin/dbmate', import.meta.url).pathname,
    [
      '--no-dump-schema',
      '--migrations-dir',
      new URL('../../../../packages/database/migrations', import.meta.url).pathname,
      'up',
    ],
    { env: { ...process.env, DATABASE_URL: dbUrl.href }, stdio: 'pipe' },
  );
  const pool = new Pool({ connectionString: dbUrl.href });
  let services;
  const oldFetch = globalThis.fetch,
    oldSdk = abstractFetch;
  let exchanges = 0,
    mutations = 0,
    active = true;
  const oldReserve = globalThis.__insigniaM5002Reserve,
    oldObserve = globalThis.__insigniaM5002Observe;
  globalThis.__insigniaM5002Reserve = () => {};
  globalThis.__insigniaM5002Observe = () => {};
  try {
    // Fixed preview target requires its own disposable DB, never a shared tenant test DB.
    assert.equal((await pool.query('SELECT count(*) AS n FROM shops')).rows[0].n, '0');
    setAbstractFetchFunc(async (url, init) => {
      exchanges++;
      assert.equal(String(url), `https://${shop}/admin/oauth/access_token`);
      assert.equal(JSON.parse(init.body).client_id, client);
      return Response.json(
        {
          access_token: 'synthetic-online-token',
          scope: 'read_products,write_products',
          expires_in: 3600,
          associated_user_scope: 'read_products,write_products',
          associated_user: { id: 23 },
        },
        { status: 200 },
      );
    });
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `https://${shop}/admin/api/2026-07/graphql.json`);
      const { query } = JSON.parse(init.body);
      if (/\bmutation\b/.test(query)) {
        mutations++;
        throw new Error('Forbidden');
      }
      if (query.includes('currentAppInstallation'))
        return Response.json({
          data: {
            shop: { id: 'gid://shopify/Shop/105501393179', myshopifyDomain: shop },
            currentAppInstallation: {
              id: active ? 'gid://shopify/AppInstallation/1054356963611' : 'gid://shopify/AppInstallation/999',
              accessScopes: [{ handle: 'read_products' }, { handle: 'write_products' }],
            },
          },
        });
      if (query.includes('currencyCode')) return Response.json({ data: { shop: { currencyCode: 'USD' } } });
      return Response.json({
        data: {
          product: {
            id: product,
            title: 'Synthetic preview fixture',
            status: 'ARCHIVED',
            featuredMedia: null,
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/54061591232795',
                  title: 'Small',
                  selectedOptions: [{ name: 'Size', value: 'Small' }],
                  image: null,
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    };
    services = createDiagnosticPreviewServices({
      INSIGNIA_M5_002_DIAGNOSTIC: '1',
      SHOPIFY_CLIENT_ID: client,
      SHOPIFY_CLIENT_SECRET: secret,
      DATABASE_URL: dbUrl.href,
      APP_URL: 'https://synthetic.example.test',
    });
    const jwt = token();
    const req = new Request('https://synthetic.example.test/api/admin/products/10485042479387/config', {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const actor = await services.authenticate(req);
    assert.equal(actor.canEdit, true);
    await services.authenticate(req);
    assert.equal(exchanges, 1, 'exact same live ID token coalesces');
    assert.equal((await services.configs.create(actor, product, 'synthetic-create-5002')).kind, 'created');
    const first = await services.configs.read(actor, product);
    assert.equal(first.config.draftVersion, '1');
    const draft = structuredClone(first.config.draft);
    draft.methods = [{ id: 'print' }];
    draft.labels = { methods: { [draft.methods[0].id]: 'Synthetic saved' } };
    const input = {
      configId: first.config.configId,
      draftVersion: first.config.draftVersion,
      draft,
      idempotencyKey: 'synthetic-save-5002',
    };
    const saved = await services.configs.save(actor, product, input);
    assert.equal(saved.kind, 'saved');
    assert.deepEqual(
      await services.configs.save(actor, product, input),
      saved,
      'lost response exact key/body is replayed',
    );
    const conflict = await services.configs.save(actor, product, {
      ...input,
      idempotencyKey: 'synthetic-conflict-5002',
    });
    assert.equal(conflict.kind, 'conflict');
    assert.equal((await services.configs.read(actor, product)).config.draftVersion, saved.draftVersion);
    assert.equal(
      (
        await services.configs.publish(actor, product, {
          configId: input.configId,
          draftVersion: saved.draftVersion,
          idempotencyKey: 'synthetic-publish-5002',
        })
      ).kind,
      'forbidden',
    );
    active = false;
    await assert.rejects(services.authenticate(req), /generation/);
    assert.equal(mutations, 0);
  } finally {
    globalThis.fetch = oldFetch;
    setAbstractFetchFunc(oldSdk);
    globalThis.__insigniaM5002Reserve = oldReserve;
    globalThis.__insigniaM5002Observe = oldObserve;
    await services?.close();
    await pool.end();
    await adminPool.query('DROP DATABASE ' + dbName);
    await adminPool.end();
  }
});
