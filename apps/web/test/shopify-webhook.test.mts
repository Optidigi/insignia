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

test('built HTTP ingress authenticates raw bytes and durably deduplicates through PostgreSQL and queue', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 60_000,
}, async (t) => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the HTTP/PostgreSQL test');
  const database = await isolatedDatabase();
  t.after(() => database.close());
  const { connectionString } = database;
  await installQueue(connectionString);
  const secret = 'synthetic-webhook-hmac-test-secret';
  const server = await startBuilt('web', {
    ...process.env,
    DATABASE_URL: connectionString,
    SHOPIFY_WEBHOOK_SECRET: secret,
    INSIGNIA_METRICS_TOKEN: 'synthetic-metrics-token',
  });
  const pool = new Pool({ connectionString });
  const core = createDurableCore(new Pool({ connectionString }));
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopId = randomUUID();
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  let worker: BuiltProcess | undefined;
  const id = randomUUID();
  const body = Buffer.from(JSON.stringify({ id: Number(shopifyShopId), myshopify_domain: domain }));
  const headers = {
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': createHmac('sha256', secret).update(body).digest('base64'),
    'x-shopify-shop-domain': domain,
    'x-shopify-topic': 'app/uninstalled',
    'x-shopify-api-version': '2026-07',
    'x-shopify-webhook-id': id,
    'x-shopify-triggered-at': new Date().toISOString(),
  };
  const endpoint = `${server.url}/api/webhooks/shopify`;
  try {
    assert.equal((await fetch(`${server.url}/live`)).status, 200, server.output());
    const invalid = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'x-shopify-hmac-sha256': `${'A'.repeat(43)}=` },
      body,
    });
    assert.equal(invalid.status, 401);
    assert.equal(required(await fetch(`${server.url}/api/internal/metrics`)).status, 403);
    await core.transactions.run((tx) => core.tenants.createShop(tx, { shopId, shopDomain: domain, shopifyShopId }));
    headers['x-shopify-triggered-at'] = new Date().toISOString();
    const first = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(first.status, 200);
    const receipt = await first.json();
    const replay = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { inboxId: receipt.inboxId, status: 'duplicate' });
    const changedBody = Buffer.from(
      JSON.stringify({ id: Number(shopifyShopId), myshopify_domain: domain, changed: true }),
    );
    for (const conflict of [
      { headers: { ...headers, 'x-shopify-topic': 'shop/update' }, body },
      {
        headers: {
          ...headers,
          'x-shopify-triggered-at': new Date(Date.parse(headers['x-shopify-triggered-at']) + 1000).toISOString(),
        },
        body,
      },
      {
        headers: {
          ...headers,
          'x-shopify-hmac-sha256': createHmac('sha256', secret).update(changedBody).digest('base64'),
        },
        body: changedBody,
      },
    ]) {
      const response = await fetch(endpoint, { method: 'POST', ...conflict });
      assert.equal(response.status, 503);
    }
    const rows = await pool.query('select id, payload from inbox_messages where id = $1', [receipt.inboxId]);
    assert.equal(rows.rowCount, 1);
    assert.deepEqual(rows.rows[0].payload, body);
    const route = await pool.query(
      'select inbox_id from shopify_webhook_deliveries where shop_domain = $1 and delivery_id = $2',
      [domain, id],
    );
    assert.equal(route.rows[0]?.inbox_id, receipt.inboxId);
    const thirdReplay = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(thirdReplay.status, 200);
    assert.equal(text(record(await thirdReplay.json()).inboxId), receipt.inboxId);
    const metricsResponse = await fetch(`${server.url}/api/internal/metrics`, {
      headers: { authorization: 'Bearer synthetic-metrics-token' },
    });
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.text();
    assert.match(metrics, /insignia_webhook_total\{outcome="rejected"\} 4/);
    assert.match(metrics, /insignia_webhook_total\{outcome="received"\} 1/);
    assert.match(metrics, /insignia_webhook_total\{outcome="duplicate"\} 2/);
    assert.match(metrics, /insignia_inbox_ingress_resolution_total\{outcome="unresolved"\} 3/);
    assert.match(metrics, /insignia_unresolved_inbox_backlog 1/);
    worker = await startBuilt('worker', {
      ...process.env,
      DATABASE_URL: connectionString,
      APP_URL: 'https://synthetic.example',
      INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
      INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
      SHOPIFY_CLIENT_ID: 'synthetic-client-id',
      SHOPIFY_CLIENT_SECRET: 'synthetic-client-secret',
    });
    let workerReady = false;
    for (let i = 0; i < 100; i++) {
      if (worker.child.exitCode !== null) break;
      try {
        if (required(await fetch(`${worker.url}/ready`)).status === 200) {
          workerReady = true;
          break;
        }
      } catch {
        /* worker starting */
      }
      await delay(100);
    }
    assert.ok(workerReady, 'worker did not reach durable readiness');
    let completed = false;
    for (let i = 0; i < 100; i++) {
      const job = await pool.query('select state from pgboss.job where id=$1', [receipt.inboxId]);
      if (job.rows[0]?.state === 'completed') {
        completed = true;
        break;
      }
      await delay(100);
    }
    assert.ok(completed, 'worker did not settle quarantine transport');
    assert.equal(required(await core.tenants.getCurrentAdminInstallation(shopId)).active, true);
    assert.equal(required(await core.webhooks.getById(receipt.inboxId)).state, 'pending');
    assert.equal(required(await core.webhooks.getById(receipt.inboxId)).resolution, 'unqualified');
    assert.equal(required(await core.webhooks.getById(receipt.inboxId)).installationGeneration, null);
    const completedReplay = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(completedReplay.status, 200);
    assert.deepEqual(await completedReplay.json(), { inboxId: receipt.inboxId, status: 'duplicate' });
    assert.equal(
      required(
        await pool.query('select count(*)::int as n from inbox_messages where external_delivery_id = $1', [
          `${domain}:${id}`,
        ]),
      ).rows[0].n,
      1,
    );
  } finally {
    await worker?.stop();
    await server.stop();
    await core.close();
    await pool.end();
  }
});
