import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGuestArtworkApi } from '../../src/islands/guest-artwork.ts';
import { record, required } from '../http-fixtures.mts';

test('guest calls carry their capability in a JSON body through the storefront gate without URL secrets or original download access', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const token = 'synthetic.token';
  const api = createGuestArtworkApi({
    proxyBase: '/apps/insignia',
    productId: '123',
    fetchImpl: async (url, init) => {
      const address = url instanceof Request ? url.url : String(url);
      calls.push({ url: address, init });
      return new Response(
        JSON.stringify(
          (url instanceof Request ? url.url : String(url)).includes('/session?')
            ? { token, expiresAt: '2099-01-01T00:00:00Z' }
            : { state: 'QUEUED' },
        ),
        { status: 200 },
      );
    },
  });
  await api('/api/artwork', { method: 'POST', body: JSON.stringify({ contentType: 'image/png', byteLength: 108 }) });
  await api('/api/artwork/ae771020-1f54-47ab-a8af-48b1eb7de3d2/status');
  assert.equal(calls.length, 3);
  assert.equal(required(calls[0]).url, '/apps/insignia/guest/session?productId=123');
  for (const { url, init } of calls.slice(1)) {
    assert.equal(url.includes(token), false);
    assert(init);
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(record(JSON.parse(String(init.body)) as unknown).capability, token);
  }
  await assert.rejects(api('/api/artwork/ae771020-1f54-47ab-a8af-48b1eb7de3d2/download'), /action invalid/);
});
