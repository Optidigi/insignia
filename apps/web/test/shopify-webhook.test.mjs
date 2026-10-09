import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDurableCore } from '@insignia/database';
import { Pool } from 'pg';
import { installQueue } from '../../../scripts/m5-024/install-queue.mjs';

test('built HTTP ingress authenticates raw bytes and durably deduplicates through PostgreSQL and queue', {
  skip: !process.env.DATABASE_URL && process.env.INSIGNIA_REQUIRE_POSTGRES_TEST !== '1',
  timeout: 60_000,
}, async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for the HTTP/PostgreSQL test');
  await installQueue(process.env.DATABASE_URL);
  const secret = 'synthetic-webhook-hmac-test-secret';
  const port = 44000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['dist/server/entry.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      SHOPIFY_WEBHOOK_SECRET: secret,
      INSIGNIA_METRICS_TOKEN: 'synthetic-metrics-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  server.stderr.on('data', (chunk) => output.push(String(chunk)));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const core = createDurableCore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const shopId = randomUUID();
  const shopifyShopId = (BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`) + 1n).toString();
  let worker;
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
  const endpoint = `http://127.0.0.1:${port}/api/webhooks/shopify`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/live`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* the server is still starting */
      }
      await delay(100);
    }
    assert.ok(ready, `web server did not become ready: ${output.join('').slice(0, 500)}`);
    const invalid = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'x-shopify-hmac-sha256': `${'A'.repeat(43)}=` },
      body,
    });
    assert.equal(invalid.status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/internal/metrics`)).status, 403);
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
    assert.equal((await thirdReplay.json()).inboxId, receipt.inboxId);
    const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/internal/metrics`, {
      headers: { authorization: 'Bearer synthetic-metrics-token' },
    });
    assert.equal(metricsResponse.status, 200);
    const metrics = await metricsResponse.text();
    assert.match(metrics, /insignia_webhook_total\{outcome="rejected"\} 4/);
    assert.match(metrics, /insignia_webhook_total\{outcome="received"\} 1/);
    assert.match(metrics, /insignia_webhook_total\{outcome="duplicate"\} 2/);
    const workerPort = port + 1000;
    worker = spawn(
      process.execPath,
      [new URL('../../worker/dist/main.js', import.meta.url).pathname, `--port=${workerPort}`],
      {
        env: {
          ...process.env,
          INSIGNIA_CREDENTIAL_KEY_ID: 'synthetic-k1',
          INSIGNIA_CREDENTIAL_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
          SHOPIFY_CLIENT_ID: 'synthetic-client-id',
          SHOPIFY_CLIENT_SECRET: 'synthetic-client-secret',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let workerReady = false;
    for (let i = 0; i < 100; i++) {
      if (worker.exitCode !== null) break;
      try {
        if ((await fetch(`http://127.0.0.1:${workerPort}/ready`)).status === 200) {
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
      const row = await pool.query('select state from inbox_messages where id = $1', [receipt.inboxId]);
      const generation = await pool.query(
        'select deactivated_at from installation_generations where shop_id = $1 and generation = 1',
        [shopId],
      );
      if (row.rows[0]?.state === 'processed' && generation.rows[0]?.deactivated_at) {
        completed = true;
        break;
      }
      await delay(100);
    }
    assert.ok(completed, 'worker did not atomically process the current authenticated uninstall');
    const completedReplay = await fetch(endpoint, { method: 'POST', headers, body });
    assert.equal(completedReplay.status, 200);
    assert.deepEqual(await completedReplay.json(), { inboxId: receipt.inboxId, status: 'processed' });
    assert.equal(
      (
        await pool.query('select count(*)::int as n from inbox_messages where external_delivery_id = $1', [
          `${domain}:${id}`,
        ])
      ).rows[0].n,
      1,
    );
  } finally {
    worker?.kill('SIGTERM');
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), delay(5000)]);
    if (server.exitCode === null) server.kill('SIGKILL');
    if (worker) {
      await Promise.race([once(worker, 'exit'), delay(5000)]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
    await core.close();
    await pool.end();
  }
});
