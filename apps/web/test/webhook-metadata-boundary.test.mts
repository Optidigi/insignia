import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/database/install-queue.mts';
import { record, required, text } from './http-fixtures.mts';
import { type BuiltProcess, startBuilt } from './support/built-process.mts';
import { isolatedDatabase } from './support/isolated-database.mts';

// Generic HMAC admission is preserved; unsigned headers cannot authorize deactivation.
test('captured signed body with new delivery ID and later unsigned trigger remains quarantined', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 40_000,
}, async (t) => {
  assert.ok(process.env.DATABASE_URL);
  // Own the application inbox and default queue: global recovery must not
  // compete with pending receipts from a preceding suite in this bounded control.
  const database = await isolatedDatabase();
  t.after(() => database.close());
  const { connectionString } = database;
  await installQueue(connectionString);
  const secret = 'synthetic-m5024-captured-body';
  const server = await startBuilt('web', {
    ...process.env,
    DATABASE_URL: connectionString,
    SHOPIFY_WEBHOOK_SECRET: secret,
  });
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
    'x-shopify-triggered-at': new Date().toISOString(),
  };
  let worker: BuiltProcess | undefined;
  async function waitFor(predicate: () => Promise<unknown>, maximumPolls = 100) {
    for (let i = 0; i < maximumPolls; i++) {
      if (await predicate().catch(() => false)) return;
      await delay(100);
    }
    throw new Error('bounded local observation did not settle');
  }
  async function post(overrides = {}) {
    return fetch(`${server.url}/api/webhooks/shopify`, {
      method: 'POST',
      headers: { ...headers, ...overrides },
      body,
    });
  }
  try {
    await waitFor(async () => required(await fetch(`${server.url}/live`)).ok);
    await core.transactions.run((tx) =>
      core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId: providerId }),
    );
    headers['x-shopify-triggered-at'] = new Date().toISOString();
    const original = await post();
    assert.equal(original.status, 200);
    const first = await original.json();
    assert.equal(await core.webhooks.processUninstall(first.inboxId), 'unqualified');
    assert.equal(await core.transactions.run((tx) => core.tenants.startInstallation(tx, shopId)), '2');
    const activated = required(
      await pool.query('select activated_at from installation_generations where shop_id=$1 and generation=2', [shopId]),
    ).rows[0].activated_at;
    const changedTrigger = new Date(activated.getTime() + 1).toISOString();
    assert.equal(
      required(await post({ 'x-shopify-triggered-at': changedTrigger })).status,
      503,
      'same delivery ID conflicts',
    );
    const old = await post({ 'x-shopify-webhook-id': randomUUID() });
    assert.equal(old.status, 200);
    assert.equal(
      required(await core.webhooks.getById(text(record(await old.json()).inboxId))).resolution,
      'unqualified',
    );
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
    const wrong = await core.webhooks.getById(text(record(await wrongDomain.json()).inboxId));
    assert.equal(required(wrong).resolution, 'unverified');
    const replay = await post({ 'x-shopify-webhook-id': randomUUID(), 'x-shopify-triggered-at': changedTrigger });
    assert.equal(replay.status, 200);
    const receipt = await replay.json();
    const bound = await core.webhooks.getById(receipt.inboxId);
    assert.equal(required(bound).installationGeneration, null);
    assert.equal(required(bound).resolution, 'unqualified');
    worker = await startBuilt('worker', {
      ...process.env,
      DATABASE_URL: connectionString,
      APP_URL: 'https://synthetic.example',
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      SHOPIFY_CLIENT_ID: 'synthetic-client-id',
      SHOPIFY_CLIENT_SECRET: secret,
    });
    await waitFor(
      async () =>
        required(await pool.query('select state from pgboss.job where id=$1', [receipt.inboxId])).rows[0]?.state ===
        'completed',
      // Four queued receipts, batchSize1 and pinned pg-boss2s polling need
      // scheduling/startup margin. This is a local observation bound, not a
      // provider freshness, retry or retention contract.
      200,
    );
    assert.equal(required(await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
    assert.equal(
      required(await pool.query('select state from inbox_messages where id=$1', [receipt.inboxId])).rows[0].state,
      'pending',
    );
    assert.equal(
      required(
        await pool.query('select deactivated_at from installation_generations where shop_id=$1 and generation=1', [
          wrongShopId,
        ]),
      ).rows[0].deactivated_at,
      null,
    );
    console.log(
      'M5-024 QUARANTINE_LOCAL: generic receipt remains pending and generation2 active; no real provider used',
    );
  } finally {
    await worker?.stop();
    await server.stop();
    await core.close();
    await pool.end();
  }
});
