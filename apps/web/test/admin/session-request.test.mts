import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isUnansweredRequest,
  authenticatedJson as selectedJson,
} from '../../../../frontend/admin/src/shared/admin-request.ts';
import { authenticatedJson } from '../../src/shared/admin-request.ts';
import { replaceWindow } from './support/browser-node.mts';
import { required } from './support/fixtures.mts';

for (const [name, request] of [
  ['retained', authenticatedJson],
  ['selected', selectedJson],
] as const) {
  test(`${name}: #468 a publish is sent with the ordinary token window; its continuation waits for the requested one`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-07T12:00:00Z') });
    const originalFetch = globalThis.fetch;
    const token = `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 20 })).toString('base64url')}.synthetic`;
    const restore = replaceWindow({ shopify: { idToken: async () => token } });
    let sent = 0;
    globalThis.fetch = async () => {
      sent++;
      return Response.json({ ok: true });
    };
    try {
      const init = { method: 'POST', body: JSON.stringify({ action: 'publish' }) };
      await request('/api/admin/products/111/config', init);
      assert.equal(sent, 1, 'a 20 s token is enough to send a publish');
      // The continuation asks for 30 s; the host keeps returning the 20 s token, so nothing is sent.
      const result = request('/api/admin/products/111/config', init, false, 30000);
      const rejected = assert.rejects(result, (error) => {
        assert.match(String(error), /Admin request timed out/);
        // #436: nothing was sent, so the editor must not follow it as a possibly running publish.
        assert.equal(isUnansweredRequest(error), false);
        return true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(60000);
      await rejected;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(sent, 1);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });
  test(`${name}: #436 a sent publication without an answer by its deadline is marked unanswered`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-07T12:00:00Z') });
    const originalFetch = globalThis.fetch;
    const token = `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 60 })).toString('base64url')}.synthetic`;
    const restore = replaceWindow({ shopify: { idToken: async () => token } });
    let sent = 0;
    globalThis.fetch = (_path, init) =>
      new Promise((_resolve, reject) => {
        sent++;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    try {
      const result = request('/api/admin/products/111/config', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish' }),
      });
      const rejected = assert.rejects(result, (error) => {
        assert.match(String(error), /Admin request timed out/);
        assert.equal(isUnansweredRequest(error), true);
        return true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(60000);
      await rejected;
      assert.equal(sent, 1);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });
  test(`${name}: publication token scheduling is isolated from an ordinary overlapping request`, async () => {
    const token = (seconds: number) =>
      `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + seconds })).toString('base64url')}.synthetic`;
    const short = token(20),
      sufficient = token(60);
    const originalFetch = globalThis.fetch;
    let release!: (value: string) => void;
    let calls = 0;
    const restore = replaceWindow({
      shopify: {
        idToken: () =>
          ++calls === 1
            ? new Promise<string>((resolve) => {
                release = resolve;
              })
            : Promise.resolve(sufficient),
      },
    });
    const sent = new Map<string, string | null>();
    globalThis.fetch = async (path, init) => {
      sent.set(String(path), new Headers(init?.headers).get('Authorization'));
      return Response.json({ ok: true });
    };
    try {
      const ordinary = request('/ordinary');
      const publication = request('/api/admin/products/111/config', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish' }),
      });
      release(short);
      await Promise.all([ordinary, publication]);
      assert.equal(sent.get('/ordinary'), `Bearer ${short}`);
      assert.equal(sent.get('/api/admin/products/111/config'), `Bearer ${sufficient}`);
      assert.equal(calls, 2);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });

  test(`${name}: a publication continuation's 401 refresh retains its token window and original bytes`, async () => {
    const token = (seconds: number) =>
      `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + seconds })).toString('base64url')}.synthetic`;
    const short = token(20),
      sufficient = token(60);
    const originalFetch = globalThis.fetch;
    let tokens = 0;
    const restore = replaceWindow({ shopify: { idToken: async () => (++tokens % 2 ? short : sufficient) } });
    const seen: string[] = [];
    const body = JSON.stringify({ action: 'publish', configId: 'config', draftVersion: '4' });
    globalThis.fetch = async (_path, init) => {
      assert.equal(init?.body, body);
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'same');
      seen.push(new Headers(init?.headers).get('Authorization') ?? '');
      return seen.length === 1 ? Response.json({}, { status: 401 }) : Response.json({ ok: true });
    };
    try {
      await request(
        '/api/admin/products/111/config',
        { method: 'POST', body, headers: { 'Idempotency-Key': 'same' } },
        false,
        30000,
      );
      assert.deepEqual(seen, [`Bearer ${sufficient}`, `Bearer ${sufficient}`]);
      assert.equal(tokens, 4);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });

  test(`${name}: an already cancelled publication never acquires or sends authority`, async () => {
    const originalFetch = globalThis.fetch;
    const restore = replaceWindow({
      shopify: {
        idToken: async () => {
          assert.fail('Cancelled token acquisition');
        },
      },
    });
    globalThis.fetch = async () => {
      assert.fail('Cancelled dispatch');
    };
    const controller = new AbortController();
    controller.abort();
    try {
      await assert.rejects(
        request('/api/admin/products/111/config', {
          method: 'POST',
          body: JSON.stringify({ action: 'publish' }),
          signal: controller.signal,
        }),
        { name: 'AbortError' },
      );
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });

  test(`${name}: cancelling during shared publication token acquisition fences a late completion`, async () => {
    const originalFetch = globalThis.fetch;
    let release!: (value: string) => void;
    const restore = replaceWindow({
      shopify: {
        idToken: () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      },
    });
    let sent = 0;
    globalThis.fetch = async () => {
      sent++;
      return Response.json({ ok: true });
    };
    const controller = new AbortController();
    try {
      const pending = request('/api/admin/products/111/config', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish' }),
        signal: controller.signal,
      });
      const rejected = assert.rejects(pending, { name: 'AbortError' });
      controller.abort();
      await rejected;
      release(
        `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 60 })).toString('base64url')}.synthetic`,
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(sent, 0);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });

  test(`${name}: publication keeps its exact command while a bounded native continuation exceeds ten seconds`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-11-07T12:00:00Z') });
    const originalFetch = globalThis.fetch;
    const token = `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 60 })).toString('base64url')}.synthetic`;
    const restore = replaceWindow({ shopify: { idToken: async () => token } });
    const body = JSON.stringify({ action: 'publish', configId: 'config', draftVersion: '4' });
    let sent = 0;
    globalThis.fetch = async (_path, init) => {
      sent++;
      assert.equal(init?.body, body);
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'original:publish');
      await new Promise((resolve) => setTimeout(resolve, 16500));
      init?.signal?.throwIfAborted();
      return Response.json({ kind: 'accepted', state: 'ACTIVE' });
    };
    try {
      const result = request('/api/admin/products/111/config', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': 'original:publish' },
      });
      const observed = result.then(
        (value) => ({ value }),
        (error: Error) => ({ error: error.message }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(16500);
      assert.deepEqual(await observed, { value: { kind: 'accepted', state: 'ACTIVE' } });
      assert.equal(sent, 1);
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  });
}

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
  test(`${name}: a configuration rejection reaches the caller with its code, message and field issues`, async () => {
    const current = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.synthetic`;
    const originalFetch = globalThis.fetch;
    const restoreWindow = replaceWindow({ shopify: { idToken: async () => current } });
    const issues = [{ path: 'selectedSetup.product.views.0.name', message: 'Too short' }];
    let reply: Response;
    globalThis.fetch = async () => reply;
    try {
      reply = Response.json(
        {
          kind: 'invalid',
          code: 'DRAFT_SCHEMA_INVALID',
          noEffect: true,
          message: 'Review the draft.',
          validationIssues: issues,
        },
        { status: 422 },
      );
      await assert.rejects(request('/api/admin/products/111/config'), {
        status: 422,
        code: 'DRAFT_SCHEMA_INVALID',
        noEffect: true,
        message: 'Review the draft.',
        validationIssues: issues,
      });
      reply = Response.json({ error: 'Idempotency-Key required', code: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 422 });
      await assert.rejects(request('/api/admin/products/111/config'), {
        status: 422,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key required',
      });
      reply = Response.json({ error: 'Admin service unavailable', code: 12 }, { status: 503 });
      await assert.rejects(request('/api/admin/products/111/config'), { status: 503, code: undefined });
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
  test(`${name}: a token about to expire during staff checks is renewed before dispatch`, async () => {
    const token = (exp: number) => `synthetic.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.synthetic`;
    const near = token(Math.floor(Date.now() / 1000) + 1),
      fresh = token(Math.floor(Date.now() / 1000) + 60);
    const originalFetch = globalThis.fetch;
    let reads = 0,
      sends = 0;
    const restoreWindow = replaceWindow({ shopify: { idToken: async () => (++reads < 3 ? near : fresh) } });
    globalThis.fetch = async (_path, init) => {
      sends++;
      return new Headers(init?.headers).get('Authorization') === `Bearer ${fresh}`
        ? Response.json({ kind: 'read' })
        : Response.json({ error: 'Staff check expired' }, { status: 503 });
    };
    try {
      assert.deepEqual(await request('/preferences'), { kind: 'read' });
      assert.equal(sends, 1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreWindow();
    }
  });
}

test('selected and retained consumers share one in-flight session token acquisition', async () => {
  const originalFetch = globalThis.fetch;
  let tokenCalls = 0;
  let release: (value: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const restore = replaceWindow({
    shopify: {
      idToken: () => {
        tokenCalls++;
        return pending;
      },
    },
  });
  const token = `synthetic.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString('base64url')}.synthetic`;
  const sent: string[] = [];
  globalThis.fetch = async (path) => {
    sent.push(String(path));
    return Response.json({ ok: true });
  };
  try {
    const retained = authenticatedJson('/retained-read');
    const selected = selectedJson('/selected-read');
    release(token);
    await Promise.all([retained, selected]);
    assert.equal(tokenCalls, 1);
    assert.deepEqual(sent.sort(), ['/retained-read', '/selected-read']);
  } finally {
    release(token);
    restore();
    globalThis.fetch = originalFetch;
  }
});
