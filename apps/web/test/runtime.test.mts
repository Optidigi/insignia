import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startBuilt } from './support/built-process.mts';

async function startServer() {
  const server = await startBuilt('web', { ...process.env, SHOPIFY_CLIENT_ID: '' });
  try {
    const live = await fetch(`${server.url}/live`);
    assert.deepEqual(await live.json(), { status: 'live' }, server.output());
    return { base: server.url, stop: server.stop };
  } catch (error) {
    await server.stop();
    throw error;
  }
}

test('built SSR preserves embedded routing context and fails closed without Shopify configuration', async () => {
  const { base, stop } = await startServer();
  try {
    const query = '?shop=synthetic.myshopify.com&host=synthetic-host&embedded=1';
    const response = await fetch(base + query, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `/admin/products${query}`);
    const unavailable = await fetch(new URL(`/admin/products${query}`, base));
    assert.equal(unavailable.status, 503);
    const shell = await unavailable.text();
    assert.doesNotMatch(shell, /shopify-api|access_token|private_key/i);
  } finally {
    await stop();
  }
});
