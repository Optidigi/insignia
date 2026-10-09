import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';

async function isolatedDatabase() {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const database = `m5024_http_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${database}`;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  let created = false;
  async function close() {
    try {
      if (created) await admin.query(`DROP DATABASE ${database}`);
    } finally {
      await admin.end();
    }
  }
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    await promisify(execFile)(
      `${root}node_modules/.bin/dbmate`,
      ['--no-dump-schema', '--migrations-dir', `${root}packages/database/migrations`, 'up'],
      { cwd: root, env: { ...process.env, DATABASE_URL: url.href }, timeout: 30_000 },
    );
    return { connectionString: url.href, close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Source-only quarantine. A genuine identical-body uninstall remains unresolved.
test('M5-025 generic replay and identical later uninstall remain pending without deactivation', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 40_000,
}, async (t) => {
  assert.ok(process.env.DATABASE_URL);
  const database = await isolatedDatabase();
  t.after(() => database.close());
  const { connectionString } = database;
  await installQueue(connectionString);
  const secret = 'synthetic-m5025-captured-body';
  const port = 46000 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env,
    DATABASE_URL: connectionString,
    HOST: '127.0.0.1',
    PORT: String(port),
    SHOPIFY_WEBHOOK_SECRET: secret,
  };
  const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'ignore',
  });
  const serverClosed = new Promise((resolve) => server.once('close', resolve));
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }));
  const shopId = randomUUID();
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const providerId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  const body = Buffer.from(JSON.stringify({ id: Number(providerId), myshopify_domain: domain }));
  const headers = {
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64'),
    'x-shopify-shop-domain': domain,
    'x-shopify-topic': 'app/uninstalled',
    'x-shopify-api-version': '2026-07',
    'x-shopify-webhook-id': randomUUID(),
    'x-shopify-event-id': randomUUID(),
    'x-shopify-triggered-at': new Date().toISOString(),
  };
  let worker;
  let workerClosed;
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate().catch(() => false)) return;
      await delay(100);
    }
    throw new Error('bounded local observation did not settle');
  }
  async function post(overrides = {}, raw = body) {
    return fetch(`http://127.0.0.1:${port}/api/webhooks/shopify`, {
      method: 'POST',
      headers: { ...headers, ...overrides },
      body: raw,
    });
  }
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/live`)).ok);
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: providerId }),
    );
    headers['x-shopify-triggered-at'] = new Date().toISOString();
    assert.equal((await post({ 'x-shopify-triggered-at': '' })).status, 401);
    assert.equal((await post({ 'x-shopify-webhook-id': '' })).status, 401);
    const alteredBody = Buffer.from(body);
    alteredBody[1] ^= 1;
    assert.equal((await post({}, alteredBody)).status, 401);
    const update = await post({ 'x-shopify-topic': 'shop/update', 'x-shopify-webhook-id': randomUUID() });
    assert.equal(update.status, 200);
    const updateId = (await update.json()).inboxId;
    await assert.rejects(core.webhooks.processUninstall(updateId), /not an uninstall/);
    assert.equal((await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
    // The same authenticated Shop bytes relabelled app/uninstalled are accepted.
    const original = await post();
    assert.equal(original.status, 200);
    const first = await original.json();
    assert.equal((await post({ 'x-shopify-event-id': randomUUID() })).status, 503);
    assert.equal((await post({ 'x-shopify-topic': 'shop/update' })).status, 503);
    assert.equal(await core.webhooks.processUninstall(first.inboxId), 'unqualified');
    assert.equal(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId)), '2');
    const activated = (
      await pool.query('select activated_at from installation_generations where shop_id=$1 and generation=2', [shopId])
    ).rows[0].activated_at;
    const changedTrigger = new Date(activated.getTime() + 1).toISOString();
    assert.equal((await post({ 'x-shopify-triggered-at': changedTrigger })).status, 503, 'same delivery ID conflicts');
    const old = await post({ 'x-shopify-webhook-id': randomUUID() });
    assert.equal(old.status, 200);
    assert.equal((await core.webhooks.getById((await old.json()).inboxId)).resolution, 'unqualified');
    const wrongShopId = randomUUID();
    const wrongDomainName = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, {
        shopId: wrongShopId,
        shopDomain: wrongDomainName,
        shopifyShopId: (BigInt(providerId) + 1n).toString(),
      }),
    );
    const wrongDomain = await post({
      'x-shopify-shop-domain': wrongDomainName,
      'x-shopify-webhook-id': randomUUID(),
      'x-shopify-triggered-at': changedTrigger,
    });
    assert.equal(wrongDomain.status, 200);
    const wrong = await core.webhooks.getById((await wrongDomain.json()).inboxId);
    assert.equal(wrong.resolution, 'unverified');
    const replay = await post({
      'x-shopify-webhook-id': randomUUID(),
      'x-shopify-event-id': randomUUID(),
      'x-shopify-triggered-at': changedTrigger,
    });
    assert.equal(replay.status, 200);
    const receipt = await replay.json();
    const bound = await core.webhooks.getById(receipt.inboxId);
    assert.equal(bound.installationGeneration, null);
    assert.equal(bound.resolution, 'unqualified');
    worker = spawn(
      process.execPath,
      [new URL('../../worker/dist/main.js', import.meta.url).pathname, `--port=${port + 1000}`],
      {
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
          INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
          SHOPIFY_CLIENT_ID: 'synthetic-client-id',
          SHOPIFY_CLIENT_SECRET: secret,
        },
        stdio: 'ignore',
      },
    );
    workerClosed = new Promise((resolve) => worker.once('close', resolve));
    await waitFor(
      async () =>
        (await pool.query('select state from pgboss.job where id=$1', [receipt.inboxId])).rows[0]?.state ===
        'completed',
    );
    assert.equal(
      (await pool.query('select state from inbox_messages where id=$1', [receipt.inboxId])).rows[0].state,
      'pending',
    );
    assert.equal(
      (
        await pool.query('select deactivated_at from installation_generations where shop_id=$1 and generation=1', [
          wrongShopId,
        ])
      ).rows[0].deactivated_at,
      null,
    );
    assert.equal(
      (await core.tenants.getCurrentAdminInstallation(shopId)).active,
      true,
      'SECURITY_INVARIANT_FAILED: old authenticated body and changed unsigned metadata deactivated generation2',
    );
    // There is no new signed field by which a hypothetical genuine identical-body
    // uninstall can differ. A byte tombstone would reject that event as well.
    const genuine = await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId));
    assert.equal(genuine, '3');
    const later = await post({
      'x-shopify-webhook-id': randomUUID(),
      'x-shopify-event-id': randomUUID(),
      'x-shopify-triggered-at': new Date(Date.now() + 1).toISOString(),
    });
    assert.equal(later.status, 200);
    const identical = await later.json();
    await waitFor(
      async () =>
        (await pool.query('select state from pgboss.job where id=$1', [identical.inboxId])).rows[0]?.state ===
        'completed',
    );
    assert.equal((await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
    assert.equal((await core.webhooks.getById(identical.inboxId)).state, 'pending');
    assert.equal((await core.webhooks.getById(identical.inboxId)).installationGeneration, null);
    assert.equal(await core.webhooks.processUninstall(identical.inboxId), 'unqualified');
    const retention = (
      await pool.query('select purge_after-received_at as interval, erasure_state from inbox_messages where id=$1', [
        identical.inboxId,
      ])
    ).rows[0];
    assert.equal(retention.interval.days, 7);
    assert.equal(retention.erasure_state, 'retained');
    // Privacy admission is preserved but the M3 handler does not claim erasure.
    const privacyBody = Buffer.from(JSON.stringify({ shop_id: Number(providerId), shop_domain: domain }));
    const privacy = await post(
      {
        'x-shopify-topic': 'shop/redact',
        'x-shopify-webhook-id': randomUUID(),
        'x-shopify-hmac-sha256': createHmac('sha256', secret).update(privacyBody).digest('base64'),
      },
      privacyBody,
    );
    assert.equal(privacy.status, 200);
    const privacyId = (await privacy.json()).inboxId;
    await delay(1000);
    assert.equal((await core.webhooks.getById(privacyId)).state, 'pending');
    console.log(
      'M5-025 QUARANTINE_LOCAL: generations2 and3 remain active; generic receipts pending; genuine uninstall/privacy authority still BLOCKED; no provider used',
    );
  } finally {
    for (const [child, closed] of [
      [worker, workerClosed],
      [server, serverClosed],
    ]) {
      if (!child) continue;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([closed, delay(5000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      await closed;
    }
    await core.close();
    await pool.end();
  }
});
