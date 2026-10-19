import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CustomerPrivacyProcessing } from '@insignia/database';
import type { JobContext } from '../dist/runtime.js';
import { durableCoreFixture } from './support/durable-core-fixture.mts';

const context: JobContext = { jobId: 'fixture-job', attempt: 0, signal: new AbortController().signal };

import { createDurableWorkerHandlers } from '../dist/handlers.js';

function fixture(topic: string, kind: CustomerPrivacyProcessing['kind'] = 'ERASURE_STAGED') {
  const calls: string[] = [];
  const core = durableCoreFixture({
    webhooks: {
      async getById(id) {
        return {
          kind: 'received',
          id,
          shopId: 'shop',
          shopDomain: 'fixture.myshopify.com',
          installationGeneration: '1',
          topic,
          state: 'pending',
          resolution: 'unresolved',
        };
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
  });
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
    assert.equal(await erasure.handlers.processInbox('durable-inbox', context), undefined);
    assert.deepEqual(erasure.calls, ['durable-inbox']);
    const request = fixture(topic, 'DATA_REQUEST_PENDING_EXPORT');
    assert.equal(await request.handlers.processInbox('durable-inbox', context), undefined);
    assert.deepEqual(request.calls, ['durable-inbox']);
  }
});

test('privacy unavailable remains a failed queue attempt; ambiguous active shop erasure remains deferred', async () => {
  const f = fixture('customers/redact');
  f.handlers = createDurableWorkerHandlers(
    durableCoreFixture({
      webhooks: {
        async getById() {
          return {
            kind: 'received',
            id: 'durable-inbox',
            shopId: 'shop',
            shopDomain: 'fixture.myshopify.com',
            installationGeneration: '1',
            topic: 'customers/redact',
            state: 'pending',
            resolution: 'unresolved',
          };
        },
      },
      customerPrivacy: {
        async processInbox() {
          throw new Error('retained body unavailable');
        },
      },
    }),
    {
      async refresh() {
        throw new Error('Unexpected refresh');
      },
    },
  );
  await assert.rejects(f.handlers.processInbox('durable-inbox', context), /retained body unavailable/);
  const shop = fixture('shop/redact', 'SHOP_ERASURE_BLOCKED');
  assert.equal(await shop.handlers.processInbox('durable-inbox', context), 'deferred');
  assert.deepEqual(shop.calls, ['durable-inbox']);
});
