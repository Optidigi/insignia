import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedJson as selectedJson } from '../../../../frontend/admin/src/shared/admin-request.ts';
import { authenticatedJson } from '../../src/shared/admin-request.ts';
import { replaceWindow } from './support/browser-node.mts';
import { required } from './support/fixtures.mts';

test('401 retry obtains a fresh Bridge token independently of a concurrent token request', async () => {
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  let releaseOverlap: (() => void) | undefined;
  let overlap: ReturnType<typeof authenticatedJson> | undefined;
  const sent: { path: Parameters<typeof fetch>[0]; authorization: string | null }[] = [];
  const restoreWindow = replaceWindow({
    shopify: {
      idToken: () => {
        tokenCalls++;
        if (tokenCalls === 2)
          return new Promise<string>((resolve) => {
            releaseOverlap = () => resolve('synthetic-overlap');
          });
        return Promise.resolve(tokenCalls === 1 ? 'synthetic-first' : 'synthetic-refreshed');
      },
    },
  });
  globalThis.fetch = async (path, init) => {
    sent.push({ path, authorization: new Headers(init?.headers).get('Authorization') });
    if (path === '/save' && new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-first') {
      overlap = authenticatedJson('/read');
      await new Promise((resolve) => setImmediate(resolve));
      setTimeout(() => required(releaseOverlap)(), 10);
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (path === '/save' && new Headers(init?.headers).get('Authorization') !== 'Bearer synthetic-refreshed')
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
    restoreWindow();
    globalThis.fetch = originalFetch;
  }
});

for (const [name, request] of [
  ['retained', authenticatedJson],
  ['selected', selectedJson],
] as const) {
  test(`${name}: expired host cache is replaced before sending the exact authenticated command`, async () => {
    const syntheticToken = (exp: number) =>
      `synthetic.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.synthetic`;
    const expired = syntheticToken(Math.floor(Date.now() / 1000) - 1);
    const fresh = syntheticToken(Math.floor(Date.now() / 1000) + 60);
    const originalFetch = globalThis.fetch;
    let tokens = 0;
    const sent: { authorization: string | null; body: BodyInit | null | undefined; key: string | null }[] = [];
    const restoreWindow = replaceWindow({ shopify: { idToken: async () => (++tokens < 3 ? expired : fresh) } });
    globalThis.fetch = async (_path, init) => {
      const headers = new Headers(init?.headers);
      sent.push({ authorization: headers.get('Authorization'), body: init?.body, key: headers.get('Idempotency-Key') });
      return headers.get('Authorization') === `Bearer ${fresh}`
        ? Response.json({ kind: 'saved' })
        : Response.json({ error: 'Authentication required' }, { status: 401 });
    };
    try {
      assert.deepEqual(
        await request('/save', {
          method: 'PUT',
          body: 'synthetic-exact-command',
          headers: { 'Idempotency-Key': 'synthetic-original-key' },
        }),
        { kind: 'saved' },
      );
      assert.equal(tokens, 3);
      assert.deepEqual(sent, [
        { authorization: `Bearer ${fresh}`, body: 'synthetic-exact-command', key: 'synthetic-original-key' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreWindow();
    }
  });
}

for (const [name, request] of [
  ['retained', authenticatedJson],
  ['selected', selectedJson],
] as const) {
  test(`${name}: an unrenewed host token stops at the existing deadline without sending`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const expired = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url')}.synthetic`;
    const originalFetch = globalThis.fetch;
    let sends = 0;
    const restoreWindow = replaceWindow({ shopify: { idToken: async () => expired } });
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ kind: 'unexpected' });
    };
    try {
      const pending = assert.rejects(
        request('/save', { method: 'PUT', body: 'synthetic-command' }),
        /Admin request timed out/,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      t.mock.timers.tick(10000);
      await pending;
      assert.equal(sends, 0);
    } finally {
      globalThis.fetch = originalFetch;
      restoreWindow();
    }
  });
  test(`${name}: a current token does not bypass a real permission denial`, async () => {
    const current = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.synthetic`;
    const originalFetch = globalThis.fetch;
    let sends = 0;
    const restoreWindow = replaceWindow({ shopify: { idToken: async () => current } });
    globalThis.fetch = async () => {
      sends++;
      return Response.json({ error: 'Read permission required' }, { status: 403 });
    };
    try {
      await assert.rejects(request('/private'), { status: 403 });
      assert.equal(sends, 1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreWindow();
    }
  });
}
