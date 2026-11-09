import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedJson } from '../../../../frontend/admin/src/shared/admin-request.ts';
import { replaceWindow } from './support/browser-node.mts';

test('signing POST never resends a 401', async () => {
  const restore = replaceWindow({
    shopify: {
      idToken: async () =>
        `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 120 })).toString('base64url')}.synthetic`,
    },
  });
  const original = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async (_path, init) => {
    sent++;
    assert.equal(init?.body, '{"action":"setup"}');
    return Response.json({}, { status: 401 });
  };
  try {
    await assert.rejects(authenticatedJson('/api/admin/signing', { method: 'POST', body: '{"action":"setup"}' }));
    assert.equal(sent, 1);
  } finally {
    restore();
    globalThis.fetch = original;
  }
});

import { createSigningOperator } from '../../../../frontend/admin/src/islands/signing-operator.ts';

const ready = {
  version: 'm5-signing-owner-action-v1',
  state: 'READY',
  actionAvailable: true,
  retryAuthorized: false,
  quoteIssuanceAuthorized: false,
};
test('load and refresh only read; double action and lost acknowledgement stay latched after reload and READY', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  const calls: RequestInit[] = [];
  const request = async (_path: string, init: RequestInit = {}) => {
    calls.push(init);
    if (init.method === 'POST') throw new Error('lost acknowledgement');
    return ready;
  };
  const operator = createSigningOperator(request, storage);
  await operator.refresh();
  await operator.refresh();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(operator.view().canSetup, true);
  await Promise.all([operator.setup(), operator.setup()]);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(calls.find((c) => c.method === 'POST')?.body, '{"action":"setup"}');
  await operator.refresh();
  assert.equal(operator.view().canSetup, false);
  const reload = createSigningOperator(request, storage);
  await reload.refresh();
  await reload.setup();
  assert.equal(reload.view().canSetup, false);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  assert.deepEqual([...data.values()], ['read-only']);
});
test('malformed status and unknown secret fields fail closed and never render response text', async () => {
  for (const value of [
    { ...ready, privateKey: 'secret' },
    { ...ready, actionAvailable: false },
    { message: 'secret' },
    null,
  ]) {
    const operator = createSigningOperator(async () => value, { getItem: () => null, setItem: () => {} });
    await operator.refresh();
    await operator.setup();
    assert.equal(operator.view().canSetup, false);
    assert.ok(!JSON.stringify(operator.view()).includes('secret'));
  }
});

test('signing GET retains forced-fresh 401 recovery', async () => {
  let tokens = 0,
    sent = 0;
  const restore = replaceWindow({
    shopify: {
      idToken: async () => {
        tokens++;
        return `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 120 })).toString('base64url')}.synthetic`;
      },
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => (++sent === 1 ? Response.json({}, { status: 401 }) : Response.json(ready));
  try {
    assert.deepEqual(await authenticatedJson('/api/admin/signing'), ready);
    assert.equal(sent, 2);
    assert.equal(tokens, 2);
  } finally {
    restore();
    globalThis.fetch = original;
  }
});
test('terminal statuses are read-only; unavailable custody prevents submission', async () => {
  for (const state of ['PENDING', 'PROVISIONED', 'STOPPED', 'UNCERTAIN']) {
    const operator = createSigningOperator(async () => ({ ...ready, state, actionAvailable: false }), {
      getItem: () => null,
      setItem: () => {},
    });
    await operator.refresh();
    assert.equal(operator.view().canSetup, false);
    assert.equal(operator.view().readOnly, true);
  }
  let posts = 0;
  const operator = createSigningOperator(
    async (_path, init) => {
      if (init?.method === 'POST') posts++;
      return ready;
    },
    {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    },
  );
  await operator.refresh();
  await operator.setup();
  await operator.refresh();
  await operator.setup();
  assert.equal(posts, 0);
  assert.equal(operator.view().canSetup, false);
});
