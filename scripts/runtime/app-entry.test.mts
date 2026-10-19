import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { type TestContext, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

async function app(t: TestContext, apiKey = 'synthetic_entry_key') {
  const entry = new URL('../../apps/web/dist/server/entry.mjs', import.meta.url);
  const child = spawn(process.execPath, [entry.pathname], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      SHOPIFY_CLIENT_ID: apiKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await exited;
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes: Buffer) => {
      output += bytes.toString();
      assert(output.length < 65536, 'bounded startup output');
    });
  let base: string | undefined;
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (base) break;
    await delay(20);
  }
  assert(base, 'built web server starts');
  return base;
}

test('built application entry preserves Shopify host context and opens current merchant products', async (t) => {
  const base = await app(t);
  const context = '?shop=synthetic.myshopify.com&host=c3ludGhldGlj&embedded=1';
  const response = await fetch(base + context, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/admin/products' + context);
  const page = await fetch(base + '/admin/products');
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.match(body, /shopifycloud\/polaris-1\.1\.js/);
  assert.doesNotMatch(body, /Development preview: draft saves are local/);
});

test('missing merchant configuration retains 503 with actual Polaris recovery and no invented host credentials', async (t) => {
  const base = await app(t, '');
  const page = await fetch(`${base}/admin/products`);
  assert.equal(page.status, 503);
  const body = await page.text();
  assert.match(body, /<s-page[^>]*heading="Application unavailable"/);
  assert.match(body, /<s-banner[^>]*tone="critical"/);
  assert.match(body, /shopifycloud\/polaris-1\.1\.js/);
  assert.match(body, /data-admin-ready="true"/);
  assert.doesNotMatch(body, /shopify-api-key|shopifycloud\/app-bridge|<s-app-nav/);
});
