import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedJson } from '../../src/shared/admin-request.ts';

test('401 retry obtains a fresh Bridge token independently of a concurrent token request', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  let releaseOverlap;
  let overlap;
  const sent = [];
  globalThis.window = {
    shopify: {
      idToken: () => {
        tokenCalls++;
        if (tokenCalls === 2)
          return new Promise((resolve) => {
            releaseOverlap = () => resolve('synthetic-overlap');
          });
        return Promise.resolve(tokenCalls === 1 ? 'synthetic-first' : 'synthetic-refreshed');
      },
    },
  };
  globalThis.fetch = async (path, init) => {
    sent.push({ path, authorization: init.headers.Authorization });
    if (path === '/save' && init.headers.Authorization === 'Bearer synthetic-first') {
      overlap = authenticatedJson('/read');
      await new Promise((resolve) => setImmediate(resolve));
      setTimeout(() => releaseOverlap(), 10);
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (path === '/save' && init.headers.Authorization !== 'Bearer synthetic-refreshed')
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    return Response.json({ kind: 'saved' });
  };
  try {
    assert.deepEqual(await authenticatedJson('/save', { method: 'PUT', body: 'synthetic-exact-command' }), {
      kind: 'saved',
    });
    await overlap;
    assert.equal(tokenCalls, 3);
    assert.deepEqual(
      sent.filter((item) => item.path === '/save').map((item) => item.authorization),
      ['Bearer synthetic-first', 'Bearer synthetic-refreshed'],
    );
  } finally {
    releaseOverlap?.();
    await overlap?.catch(() => {});
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});
