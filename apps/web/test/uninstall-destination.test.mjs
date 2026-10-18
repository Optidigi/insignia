import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';
import { isolatedDatabase } from './support/isolated-database.mjs';

if (!process.env.DATABASE_URL) {
  try {
    process.env.DATABASE_URL = JSON.parse(readFileSync('/tmp/insignia-lifecycle-pg.json', 'utf8')).url;
  } catch {
    /* A database is required; no native/default target is inferred. */
  }
}

test('built exclusive uninstall callback authenticates its bound generation, settles through queue before create acknowledgement and cannot deactivate a reinstall', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 70_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  const database = await isolatedDatabase('uninstall_http');
  const connectionString = database.connectionString;
  let core, pool;
  const children = [],
    output = [];
  async function child(path, env, cwd, args = []) {
    const process = spawn(globalThis.process.execPath, [path, ...args], {
      ...(cwd ? { cwd } : {}),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = new Promise((resolve) => process.once('close', resolve));
    process.stdout.on('data', (chunk) => output.push(String(chunk)));
    process.stderr.on('data', (chunk) => output.push(String(chunk)));
    children.push({ process, closed });
    return process;
  }
  async function waitFor(predicate, message, maximum = 180) {
    for (let attempt = 0; attempt < maximum; attempt++) {
      if (await predicate().catch(() => false)) return;
      await delay(100);
    }
    assert.fail(`${message}: ${output.join('').slice(-1200)}`);
  }
  try {
    await installQueue(connectionString);
    core = createDurableCore(new Pool({ connectionString }));
    pool = new Pool({ connectionString });
    const shopId = randomUUID(),
      domain = `s${randomUUID().replaceAll('-', '')}.myshopify.com`,
      providerId = '91001';
    const wrongShop = randomUUID(),
      wrongDomain = `s${randomUUID().replaceAll('-', '')}.myshopify.com`;
    const externalInstallationId = 'gid://shopify/AppInstallation/91001';
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: providerId, externalInstallationId }),
    );
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: wrongShop,
        shopDomain: wrongDomain,
        shopifyShopId: '91002',
        externalInstallationId: 'gid://shopify/AppInstallation/91002',
      }),
    );
    const secret = 'synthetic-exclusive-uninstall-hmac';
    const port = 48000 + Math.floor(Math.random() * 800),
      origin = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      DATABASE_URL: connectionString,
      HOST: '127.0.0.1',
      PORT: String(port),
      SHOPIFY_WEBHOOK_SECRET: secret,
      APP_URL: 'https://lifecycle.example.test',
    };
    await child('dist/server/entry.mjs', env, new URL('..', import.meta.url));
    await waitFor(async () => (await fetch(`${origin}/live`)).ok, 'built server readiness');
    const body = Buffer.from(JSON.stringify({ id: Number(providerId), myshopify_domain: domain }));
    async function post(path, overrides = {}, raw = body) {
      return fetch(origin + path, {
        method: 'POST',
        body: raw,
        headers: {
          'content-type': 'application/json',
          'x-shopify-hmac-sha256': createHmac('sha256', secret).update(raw).digest('base64'),
          'x-shopify-shop-domain': domain,
          'x-shopify-topic': 'app/uninstalled',
          'x-shopify-api-version': '2026-07',
          'x-shopify-webhook-id': randomUUID(),
          'x-shopify-triggered-at': new Date().toISOString(),
          ...overrides,
        },
      });
    }
    // A captured generic receipt cannot acquire authority later from an equal body.
    const generic = await post('/api/webhooks/shopify');
    assert.equal(generic.status, 200);
    const genericId = (await generic.json()).inboxId;
    assert.equal((await core.webhooks.getById(genericId)).resolution, 'unqualified');
    const capability = randomBytes(32).toString('hex'),
      digest = createHash('sha256').update(capability).digest('hex');
    const binding = { shopId, installationGeneration: '1', externalInstallationId, capabilityDigest: digest };
    await core.uninstallLifecycle.reserve(binding);
    assert.equal(await core.uninstallLifecycle.dispatch(binding), true);
    const path = `/api/webhooks/uninstall/${capability}`;
    const wrongBody = Buffer.from(JSON.stringify({ id: 91002, myshopify_domain: wrongDomain }));
    for (const response of [
      await post(`/api/webhooks/uninstall/${randomBytes(32).toString('hex')}`),
      await post(path, { 'x-shopify-hmac-sha256': `${'A'.repeat(43)}=` }),
      await post(path, { 'x-shopify-shop-domain': wrongDomain }, wrongBody),
      await post(path, { 'x-shopify-shop-domain': wrongDomain }),
    ])
      assert.ok(response.status >= 400, `invalid callback admitted: ${response.status}`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM uninstall_delivery_authority')).rows[0].n, 0);
    assert.equal((await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
    // Topic is unsigned routing metadata. The exclusive callback fixes uninstall authority.
    const accepted = await post(path, { 'x-shopify-topic': 'orders/create' });
    assert.equal(accepted.status, 200);
    const acceptedId = (await accepted.json()).inboxId;
    assert.equal((await core.webhooks.getById(acceptedId)).topic, 'app/uninstalled');
    assert.equal((await core.webhooks.getById(acceptedId)).installationGeneration, '1');
    assert.equal(
      (await pool.query('SELECT state FROM uninstall_destinations WHERE capability_digest=$1', [digest])).rows[0].state,
      'dispatched',
      'provider create has not been acknowledged',
    );
    await child(
      new URL('../../worker/dist/main.js', import.meta.url).pathname,
      {
        ...process.env,
        DATABASE_URL: connectionString,
        PORT: String(port + 1000),
        APP_URL: 'https://lifecycle.example.test',
        INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-lifecycle-key',
        INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
        SHOPIFY_CLIENT_ID: 'synthetic-client',
        SHOPIFY_CLIENT_SECRET: secret,
      },
      undefined,
      [`--port=${port + 1000}`],
    );
    await waitFor(
      async () => !(await core.tenants.getCurrentAdminInstallation(shopId)).active,
      'exclusive callback worker deactivation',
    );
    await waitFor(
      async () =>
        (await pool.query('SELECT state FROM pgboss.job WHERE id=$1', [acceptedId])).rows[0]?.state === 'completed',
      'exclusive queue completion',
    );
    assert.equal((await core.tenants.getCurrentAdminInstallation(wrongShop)).active, true);
    assert.equal((await core.webhooks.getById(genericId)).resolution, 'unqualified');
    assert.equal((await core.webhooks.getById(genericId)).state, 'pending');
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM uninstall_delivery_authority WHERE inbox_id=$1', [genericId]))
        .rows[0].n,
      0,
    );
    assert.equal(
      await core.transactions.run((tx) =>
        core.tenants.startInstallation(tx, shopId, 'gid://shopify/AppInstallation/91003'),
      ),
      '2',
    );
    const oldCallback = await post(path, { 'x-shopify-topic': 'shop/update' });
    assert.equal(oldCallback.status, 200);
    const oldId = (await oldCallback.json()).inboxId;
    await waitFor(
      async () =>
        (await pool.query('SELECT state FROM pgboss.job WHERE id=$1', [oldId])).rows[0]?.state === 'completed',
      'old callback queue settlement',
    );
    assert.equal((await core.webhooks.getById(oldId)).installationGeneration, '1');
    assert.equal((await core.webhooks.getById(oldId)).state, 'processed');
    const current = await core.tenants.getCurrentAdminInstallation(shopId);
    assert.equal(current.generation, '2');
    assert.equal(current.active, true);
    assert.equal(
      (
        await pool.query('SELECT deactivated_at FROM installation_generations WHERE shop_id=$1 AND generation=2', [
          shopId,
        ])
      ).rows[0].deactivated_at,
      null,
    );
    assert.equal((await core.tenants.getCurrentAdminInstallation(wrongShop)).active, true);
    assert.equal(
      (
        await pool.query('SELECT count(*)::int AS n FROM uninstall_delivery_authority WHERE capability_digest=$1', [
          digest,
        ])
      ).rows[0].n,
      2,
    );
  } finally {
    for (const child of children.reverse()) {
      if (child.process.exitCode === null && child.process.signalCode === null) {
        child.process.kill('SIGTERM');
        await Promise.race([child.closed, delay(5000)]);
        if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
      }
      await child.closed;
    }
    if (core) await core.close();
    if (pool) await pool.end();
    await database.close();
  }
});
