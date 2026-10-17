import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDurableWorkerHandlers } from '../dist/handlers.js';

function fixture(topic, kind = 'ERASURE_STAGED') {
  const calls = [];
  const core = {
    webhooks: {
      async getById(id) {
        return { id, topic, state: 'pending', resolution: 'unresolved' };
      },
      async processUninstall() {
        calls.push('uninstall');
        return 'unqualified';
      },
    },
    customerPrivacy: {
      async processInbox(id) {
        calls.push(id);
        return { kind, shopId: 'body-derived-shop', requestedOrderCount: 1, matchedPurchaseCount: 1 };
      },
    },
  };
  return {
    calls,
    handlers: createDurableWorkerHandlers(core, {
      async refresh() {
        throw new Error('no provider IO');
      },
    }),
  };
}

test('customer privacy dispatch uses only durable inbox identity and reports staged erasure separately from pending export', async () => {
  // Unsigned topic is only routing: the repository derives purpose and shop from retained signed bytes.
  for (const topic of ['customers/redact', 'customers/data_request']) {
    const erasure = fixture(topic);
    assert.equal(await erasure.handlers.processInbox('durable-inbox'), undefined);
    assert.deepEqual(erasure.calls, ['durable-inbox']);
    const request = fixture(topic, 'DATA_REQUEST_PENDING_EXPORT');
    assert.equal(await request.handlers.processInbox('durable-inbox'), 'deferred');
    assert.deepEqual(request.calls, ['durable-inbox']);
  }
});

test('privacy unavailable remains a failed queue attempt; shop erasure is not inferred from customer processing', async () => {
  const f = fixture('customers/redact');
  f.handlers = createDurableWorkerHandlers(
    {
      webhooks: {
        async getById() {
          return { topic: 'customers/redact', state: 'pending', resolution: 'unresolved' };
        },
      },
      customerPrivacy: {
        async processInbox() {
          throw new Error('retained body unavailable');
        },
      },
    },
    {},
  );
  await assert.rejects(f.handlers.processInbox('durable-inbox'), /retained body unavailable/);
  const shop = fixture('shop/redact');
  assert.equal(await shop.handlers.processInbox('durable-inbox'), 'deferred');
  assert.deepEqual(shop.calls, []);
});
