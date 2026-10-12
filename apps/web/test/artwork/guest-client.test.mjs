import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGuestArtworkApi } from '../../src/islands/guest-artwork.ts';

test('guest calls carry their capability in a JSON body without cookies, URL secrets or original download access', async () => {
  const calls = [];
  const token = 'synthetic.token';
  const api = createGuestArtworkApi({
    proxyBase: '/apps/insignia',
    productId: '123',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify(url.includes('/session?') ? { token, expiresAt: '2099-01-01T00:00:00Z' } : { state: 'QUEUED' }),
        { status: 200 },
      );
    },
  });
  await api('/api/artwork', { method: 'POST', body: JSON.stringify({ contentType: 'image/png', byteLength: 108 }) });
  await api('/api/artwork/ae771020-1f54-47ab-a8af-48b1eb7de3d2/status');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, '/apps/insignia/guest/session?productId=123');
  for (const { url, init } of calls.slice(1)) {
    assert.equal(url.includes(token), false);
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(JSON.parse(init.body).capability, token);
  }
  await assert.rejects(api('/api/artwork/ae771020-1f54-47ab-a8af-48b1eb7de3d2/download'), /action invalid/);
});
