import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { handleInternalMetrics } from '../src/server/internal-metrics.ts';
import { handleShopifyWebhook, handleShopifyWebhookRoute } from '../src/server/shopify-webhook.ts';

type Dependencies = Parameters<typeof handleShopifyWebhook>[1];
const secret = 'password=SECRET-9f2c for alpha.myshopify.com gid://shopify/Order/10485042479387';
const hmacSecret = 'synthetic-webhook-secret';
const domain = 'alpha-shop.myshopify.com';
const body = Buffer.from('{"id":10485042479387,"email":"buyer@example.test"}');

function webhookRequest(signature = createHmac('sha256', hmacSecret).update(body).digest('base64')) {
  return new Request('https://app.example.test/api/webhooks/shopify', {
    method: 'POST',
    headers: {
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Shop-Domain': domain,
      'X-Shopify-Topic': 'orders/create',
      'X-Shopify-API-Version': '2026-07',
      'X-Shopify-Webhook-Id': randomUUID(),
      'X-Shopify-Triggered-At': new Date().toISOString(),
    },
    body,
  });
}
async function snapshot(response: Response) {
  return { status: response.status, headers: [...response.headers], body: await response.text() };
}
const unavailable = {
  status: 503,
  headers: [
    ['cache-control', 'no-store'],
    ['content-type', 'application/json'],
  ],
  body: JSON.stringify({ error: 'handoff_unavailable' }),
};
const leaked = /SECRET|myshopify|gid:|10485042479387|buyer@|synthetic|alpha-shop|hmac|orders\/create/i;
const rejecting = (error: unknown) => async (): Promise<never> => {
  throw error;
};

function keys(value: unknown) {
  return Object.keys(value as object).sort();
}

test('an unexpected webhook handoff failure records one system failure and keeps the exact 503', async () => {
  const recorded: unknown[] = [];
  const outcomes: string[] = [];
  const failing = (recordSystemFailure: Dependencies['recordSystemFailure'], extra: Partial<Dependencies> = {}) =>
    ({
      secrets: [hmacSecret],
      metrics: { webhook: (outcome) => outcomes.push(outcome) },
      ingress: { receive: rejecting(Object.assign(new RangeError(secret), { code: 'ERR_INJECTED_FAILURE' })) },
      queue: { ensureEnqueued: rejecting(new Error('unused')) },
      recordSystemFailure,
      ...extra,
    }) satisfies Dependencies;
  const record = (failure: unknown) => recorded.push(failure);
  assert.deepEqual(await snapshot(await handleShopifyWebhook(webhookRequest(), failing(record))), unavailable);
  // A failing per-request handoff (runtime/database) is the same unexpected branch.
  assert.deepEqual(
    await snapshot(
      await handleShopifyWebhook(webhookRequest(), failing(record, { getHandoff: rejecting(new TypeError(secret)) })),
    ),
    unavailable,
  );
  assert.deepEqual(outcomes, ['rejected', 'rejected']);
  assert.equal(recorded.length, 2);
  assert.deepEqual(keys(recorded[0]), ['errorClass', 'errorCode', 'errorSite', 'systemRoute']);
  const first = recorded[0] as Record<string, unknown>;
  assert.equal(first.systemRoute, 'shopify-webhook');
  assert.equal(first.errorClass, 'RangeError');
  assert.equal(first.errorCode, 'ERR_INJECTED_FAILURE');
  assert.match(String(first.errorSite), /^apps\/web\/test\/system-failure\.test\.mts:[1-9][0-9]*$/);
  assert.equal((recorded[1] as Record<string, unknown>).systemRoute, 'shopify-webhook');
  assert.equal((recorded[1] as Record<string, unknown>).errorClass, 'TypeError');
  assert.doesNotMatch(JSON.stringify(recorded), leaked);

  const still = await handleShopifyWebhook(
    webhookRequest(),
    failing(() => {
      throw new Error('recorder down');
    }),
  );
  assert.deepEqual(await snapshot(still), unavailable);
});

test('handled webhook outcomes, including HMAC rejection and classified handoff failures, are not recorded', async () => {
  const recorded: unknown[] = [];
  const base: Dependencies = {
    secrets: [hmacSecret],
    recordSystemFailure: (failure) => recorded.push(failure),
    ingress: {
      receive: async () => ({ kind: 'received', id: randomUUID(), shopId: null, installationGeneration: null }),
    },
    queue: { ensureEnqueued: async () => 'enqueued' },
  };
  const status = async (request: Request, extra: Partial<Dependencies> = {}) =>
    (await handleShopifyWebhook(request, { ...base, ...extra })).status;
  assert.equal(await status(webhookRequest()), 200);
  assert.equal(await status(webhookRequest(`${'A'.repeat(43)}=`)), 401);
  assert.equal(await status(new Request('https://app.example.test/api/webhooks/shopify')), 405);
  const large = webhookRequest();
  large.headers.set('content-length', String(9 * 1024 * 1024));
  assert.equal(await status(large), 413);
  // Queue loss and an expired payload are classified 503s with their own counter and body.
  assert.equal(await status(webhookRequest(), { queue: { ensureEnqueued: rejecting(new Error(secret)) } }), 503);
  const expired = await handleShopifyWebhook(webhookRequest(), {
    ...base,
    ingress: {
      receive: async () => ({ kind: 'expired', id: randomUUID(), shopId: null, installationGeneration: null }),
    },
  });
  assert.equal(expired.status, 503);
  assert.deepEqual(await expired.json(), { error: 'transient_payload_expired_unresolved' });
  assert.deepEqual(recorded, []);
});

test('a failing webhook route setup records one system failure and keeps the exact 503', async () => {
  const recorded: unknown[] = [];
  const setupFailure = () => {
    throw new Error(secret);
  };
  const response = await handleShopifyWebhookRoute(webhookRequest(), setupFailure, (failure) => recorded.push(failure));
  assert.deepEqual(await snapshot(response), unavailable);
  assert.equal(recorded.length, 1);
  assert.deepEqual(keys(recorded[0]), ['errorClass', 'errorSite', 'systemRoute']);
  assert.equal((recorded[0] as Record<string, unknown>).systemRoute, 'shopify-webhook-setup');
  assert.equal((recorded[0] as Record<string, unknown>).errorClass, 'Error');
  assert.doesNotMatch(JSON.stringify(recorded), leaked);
  const still = await handleShopifyWebhookRoute(webhookRequest(), setupFailure, () => {
    throw new Error('recorder down');
  });
  assert.deepEqual(await snapshot(still), unavailable);
  // A built route delegates every outcome, recorded or not, to the handler unchanged.
  const delegated = await handleShopifyWebhookRoute(
    webhookRequest(`${'A'.repeat(43)}=`),
    () => ({ secrets: [hmacSecret], recordSystemFailure: (failure) => recorded.push(failure) }),
    (failure) => recorded.push(failure),
  );
  assert.equal(delegated.status, 401);
  assert.equal(recorded.length, 1);
});

test('an unexpected metrics scrape failure records one system failure and keeps the exact 503', async () => {
  const recorded: unknown[] = [];
  const token = 'synthetic-metrics-token';
  const scrape = (authorization?: string) =>
    new Request('https://app.example.test/api/internal/metrics', {
      headers: authorization ? { Authorization: authorization } : {},
    });
  const failing = (
    recordSystemFailure: (failure: unknown) => void,
    unresolvedBacklog: () => Promise<number> = rejecting(new Error(secret)),
  ) => ({ token, unresolvedBacklog, observability: createObservability(), recordSystemFailure });
  const response = await handleInternalMetrics(
    scrape(`Bearer ${token}`),
    failing((value) => recorded.push(value)),
  );
  const expected = { status: 503, headers: [], body: '' };
  assert.deepEqual(await snapshot(response), expected);
  // An invalid backlog count is rejected by the metric itself; still unexpected.
  await handleInternalMetrics(
    scrape(`Bearer ${token}`),
    failing(
      (value) => recorded.push(value),
      async () => -1,
    ),
  );
  assert.equal(recorded.length, 2);
  for (const value of recorded as Record<string, unknown>[]) {
    assert.deepEqual(keys(value), ['errorClass', 'errorSite', 'systemRoute']);
    assert.equal(value.systemRoute, 'internal-metrics');
    assert.equal(value.errorClass, 'Error');
  }
  assert.doesNotMatch(JSON.stringify(recorded), leaked);
  const still = await handleInternalMetrics(
    scrape(`Bearer ${token}`),
    failing(() => {
      throw new Error('recorder down');
    }),
  );
  assert.deepEqual(await snapshot(still), expected);
});

test('handled metrics outcomes are not recorded and a healthy scrape still serves the registry', async () => {
  const recorded: unknown[] = [];
  const observability = createObservability();
  const deps = {
    token: 'synthetic-metrics-token',
    unresolvedBacklog: async () => 7,
    observability,
    recordSystemFailure: (value: unknown) => recorded.push(value),
  };
  const scrape = (authorization?: string) =>
    new Request('https://app.example.test/api/internal/metrics', {
      headers: authorization ? { Authorization: authorization } : {},
    });
  assert.equal((await handleInternalMetrics(scrape('Bearer x'), { ...deps, token: undefined })).status, 404);
  assert.equal((await handleInternalMetrics(scrape(), deps)).status, 403);
  assert.equal((await handleInternalMetrics(scrape('Bearer wrong'), deps)).status, 403);
  assert.equal((await handleInternalMetrics(scrape(`Bearer ${'x'.repeat(600)}`), deps)).status, 403);
  const ok = await handleInternalMetrics(scrape('Bearer synthetic-metrics-token'), deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), observability.registry.contentType);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.match(await ok.text(), /insignia_unresolved_inbox_backlog 7/);
  assert.deepEqual(recorded, []);
});
