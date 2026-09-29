import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObservability } from '@insignia/observability';
import { createWorkerHealthServer } from '../dist/health.js';

test('liveness stays separate from durable readiness; loopback metrics expose bounded outcomes', async () => {
  const observability = createObservability();
  observability.metrics.webhook('received');
  let ready = false;
  let databaseReachable = true;
  const server = createWorkerHealthServer({
    observability,
    isDurableReady: () => ready,
    probeDurableReady: async () => ready && databaseReachable,
  });
  const url = await server.listen(0);
  try {
    assert.deepEqual(await (await fetch(`${url}/live`)).json(), { status: 'live', durableReady: false });
    const notReady = await fetch(`${url}/ready`);
    assert.equal(notReady.status, 503);
    assert.deepEqual(await notReady.json(), { status: 'not_ready', durableReady: false });
    ready = true;
    const healthy = await fetch(`${url}/ready`);
    assert.equal(healthy.status, 200);
    assert.deepEqual(await healthy.json(), { status: 'ready', durableReady: true });
    databaseReachable = false;
    assert.equal((await fetch(`${url}/live`)).status, 200);
    assert.equal((await fetch(`${url}/ready`)).status, 503);
    const metrics = await (await fetch(`${url}/metrics`)).text();
    assert.match(metrics, /insignia_webhook_total\{outcome="received"\} 1/);
    assert.doesNotMatch(metrics, /shop_id|webhook_id|access_token|refresh_token/);
  } finally {
    await server.close();
  }
  await assert.rejects(fetch(`${url}/live`));
});
