import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';

// Characterization, not a security PASS: preserve accepted semantics until principal adjudication.
test('captured signed body with new delivery ID and later unsigned trigger can deactivate a new generation', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 40_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL);
  await installQueue(process.env.DATABASE_URL);
  const secret = 'synthetic-m5024-captured-body';
  const port = 46000 + Math.floor(Math.random() * 500);
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), SHOPIFY_WEBHOOK_SECRET: secret };
  const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'ignore',
  });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
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
    'x-shopify-triggered-at': new Date().toISOString(),
  };
  let worker;
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate().catch(() => false)) return;
      await delay(100);
    }
    throw new Error('bounded local observation did not settle');
  }
  async function post(overrides = {}) {
    return fetch(`http://127.0.0.1:${port}/api/webhooks/shopify`, {
      method: 'POST',
      headers: { ...headers, ...overrides },
      body,
    });
  }
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/live`)).ok);
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: providerId }),
    );
    headers['x-shopify-triggered-at'] = new Date().toISOString();
    const original = await post();
    assert.equal(original.status, 200);
    const first = await original.json();
    await core.webhooks.processUninstall(first.inboxId);
    assert.equal(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId)), '2');
    const activated = (
      await pool.query('select activated_at from installation_generations where shop_id=$1 and generation=2', [shopId])
    ).rows[0].activated_at;
    const changedTrigger = new Date(activated.getTime() + 1).toISOString();
    assert.equal((await post({ 'x-shopify-triggered-at': changedTrigger })).status, 503, 'same delivery ID conflicts');
    const old = await post({ 'x-shopify-webhook-id': randomUUID() });
    assert.equal(old.status, 200);
    assert.equal((await core.webhooks.getById((await old.json()).inboxId)).resolution, 'stale');
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
    const replay = await post({ 'x-shopify-webhook-id': randomUUID(), 'x-shopify-triggered-at': changedTrigger });
    assert.equal(replay.status, 200);
    const receipt = await replay.json();
    const bound = await core.webhooks.getById(receipt.inboxId);
    assert.equal(bound.installationGeneration, '2');
    assert.equal(bound.resolution, 'resolved');
    worker = spawn(
      process.execPath,
      [new URL('../../worker/dist/main.js', import.meta.url).pathname, `--port=${port + 1000}`],
      {
        env: {
          ...process.env,
          INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
          INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
          SHOPIFY_CLIENT_ID: 'synthetic-client-id',
          SHOPIFY_CLIENT_SECRET: secret,
        },
        stdio: 'ignore',
      },
    );
    await waitFor(async () => {
      const rows = await pool.query(
        'select deactivated_at from installation_generations where shop_id=$1 and generation=2',
        [shopId],
      );
      return rows.rows[0].deactivated_at !== null;
    });
    assert.equal(
      (await pool.query('select state from inbox_messages where id=$1', [receipt.inboxId])).rows[0].state,
      'processed',
    );
    assert.equal(
      (
        await pool.query('select deactivated_at from installation_generations where shop_id=$1 and generation=1', [
          wrongShopId,
        ])
      ).rows[0].deactivated_at,
      null,
    );
    console.log(
      'M5-024 REPRODUCED_LOCAL: original signed body, new unsigned delivery ID/trigger, generation 2 deactivated; no real provider used',
    );
  } finally {
    for (const child of [worker, server].filter(Boolean)) {
      const closed = new Promise((resolve) => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await core.close();
    await pool.end();
  }
});
