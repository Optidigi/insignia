import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { handleShopifyWebhook } from '../src/server/shopify-webhook.ts';

test('HTTP 5xx after durable inbox commit leads to same-ID retry and a single queue handoff', async () => {
  const secret = 'synthetic-secret';
  const body = Buffer.from('{"one":1}');
  const domain = `m${randomUUID().replaceAll('-', '')}.myshopify.com`;
  const id = randomUUID();
  const headers = {
    'X-Shopify-Hmac-Sha256': createHmac('sha256', secret).update(body).digest('base64'),
    'X-Shopify-Shop-Domain': domain,
    'X-Shopify-Topic': 'app/uninstalled',
    'X-Shopify-API-Version': '2026-07',
    'X-Shopify-Webhook-Id': id,
    'X-Shopify-Triggered-At': new Date().toISOString(),
  };
  const rows = new Map();
  let receives = 0;
  let enqueues = 0;
  let failQueue = true;
  const outcomes = [];
  const accepted = [];
  const dependencies = {
    secrets: [secret],
    metrics: {
      webhook(outcome) {
        outcomes.push(outcome);
      },
    },
    async onAccepted(input) {
      accepted.push(input);
    },
    ingress: {
      async receive(delivery) {
        receives++;
        assert.deepEqual(Buffer.from(delivery.rawBody), body);
        const existing = rows.get(delivery.deliveryId);
        if (existing) return { ...existing, kind: 'duplicate' };
        const receipt = { kind: 'received', id: randomUUID(), shopId: null, installationGeneration: null };
        rows.set(delivery.deliveryId, receipt);
        return receipt;
      },
    },
    queue: {
      async ensureEnqueued() {
        if (failQueue) throw new Error('synthetic queue loss');
        enqueues++;
        return enqueues === 1 ? 'enqueued' : 'already_enqueued';
      },
    },
  };
  const send = (data = body, values = headers) =>
    handleShopifyWebhook(
      new Request('http://local/api/webhooks/shopify', {
        method: 'POST',
        headers: values,
        body: data,
      }),
      dependencies,
    );
  assert.equal((await send()).status, 503);
  assert.equal(rows.size, 1);
  failQueue = false;
  const retried = await send();
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).inboxId, rows.get(id).id);
  assert.equal((await send()).status, 200);
  assert.equal(rows.size, 1);
  assert.equal(enqueues, 2);
  assert.equal(receives, 3);
  assert.equal((await send(Buffer.from('{"one":2}'))).status, 401);
  assert.equal((await send(body, { ...headers, 'X-Shopify-Hmac-Sha256': undefined })).status, 401);
  assert.equal(receives, 3);
  assert.deepEqual(outcomes, ['enqueue_failure', 'duplicate', 'duplicate', 'rejected', 'rejected']);
  assert.equal(accepted.length, 2);
});

test('stream bound rejects a lying or absent Content-Length before trusted metadata is stored', async () => {
  const raw = Buffer.alloc(8 * 1024 * 1024 + 1);
  let called = false;
  const response = await handleShopifyWebhook(
    new Request('http://local/api/webhooks/shopify', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(raw);
          controller.close();
        },
      }),
      duplex: 'half',
    }),
    {
      secrets: ['synthetic-secret'],
      ingress: {
        async receive() {
          called = true;
          throw new Error('unexpected');
        },
      },
      queue: {
        async ensureEnqueued() {
          throw new Error('unexpected');
        },
      },
    },
  );
  assert.equal(response.status, 413);
  assert.equal(called, false);
});
